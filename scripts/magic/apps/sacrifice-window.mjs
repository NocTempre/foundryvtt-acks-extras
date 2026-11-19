/* global game, foundry, fromUuid, ui */
/**
 * The Blood sacrifice window: a caster, a bucket of victims dropped from the sidebar or the canvas, what a Judge
 * says of each (willing or helpless, the traits that apply, the value, young) and of the sacrifice (the site, the
 * class power), the yield, and the verdicts that stand in the way. ApplicationV2 over a scrolling body and a pinned
 * footer, the cast dialog's shape. `sacrifice.mjs` answers every question the window asks (`panelModel`) and
 * decides the act; the live half (`sacrifice-live.mjs`) reads the documents and makes the writes.
 *
 * The toggles are a Judge's: a Player's seat draws them disabled and its Sacrifice button is disabled with the
 * reason in the footer, the way the cast plan's verdicts disable the cast button. What was typed lives on the
 * instance, and survives every re-render. One window serves one caster.
 */
import { MODULE_ID, LANG_PREFIX } from "../constants.mjs";
import { entryFromDrop, BUCKET_ACTIONS, BUCKET_TEMPLATE, BUCKET_ROW_TEMPLATE, BUCKET_LANG_PREFIX } from "../../lib/bucket.mjs";
import { makeLoc } from "../../lib/util.mjs";
import { panelModel, planOf, cleanState, VICTIM_KINDS } from "../sacrifice.mjs";
import { casterFacts, victimsOf, tablesNow, sacrificeCites, sacrifice, creatureOf, holdsCreature, loc, announce } from "../sacrifice-live.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** The windows open now, by the caster's uuid. */
const OPEN = new Map();

/** The Blood sacrifice window. */
export class SacrificeWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  #actor;
  /** What the seat has set so far. Never named `state`: ApplicationV2 owns that name. */
  #held = { list: [], site: false, power: false, victims: {} };
  #acting = false;
  #dragDrop;

  constructor(actor, options = {}) {
    super(options);
    this.#actor = actor;
    this.#dragDrop = (this.options.dragDrop ?? []).map(
      (config) =>
        new foundry.applications.ux.DragDrop.implementation({
          ...config,
          callbacks: {
            dragover: (event) => event.currentTarget.classList.add("drop-hover"),
            dragleave: (event) => event.currentTarget.classList.remove("drop-hover"),
            drop: (event) => this.#onDrop(event),
          },
        }),
    );
  }

  static DEFAULT_OPTIONS = {
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll", "acks-extras-frame-vars", "acks-extras-sacrifice"],
    tag: "form",
    window: { icon: "fa-solid fa-droplet", resizable: true },
    position: { width: 480, height: "auto" },
    form: { handler: SacrificeWindow.#onForm, submitOnChange: true, closeOnSubmit: false },
    actions: {
      sacrifice: SacrificeWindow.#onSacrifice,
      cancel: SacrificeWindow.#onCancel,
      [BUCKET_ACTIONS.remove]: SacrificeWindow.#onRemove,
    },
    dragDrop: [{ dropSelector: "[data-bucket-drop]" }],
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/magic/sacrifice.hbs`, scrollable: [""] },
    footer: { template: `modules/${MODULE_ID}/templates/magic/sacrifice-footer.hbs` },
  };

  /**
   * Open the window for a caster, or bring the one already open to the front.
   * @param {Actor} actor
   * @returns {Promise<SacrificeWindow>}
   */
  static async open(actor) {
    let window = OPEN.get(actor.uuid);
    if (!window) {
      window = new SacrificeWindow(actor, { id: `acks-extras-sacrifice-${actor.id}` });
      OPEN.set(actor.uuid, window);
    }
    await window.render({ force: true });
    window.bringToFront?.();
    return window;
  }

  /** @override */
  get title() {
    return loc("title", { name: this.#actor.name });
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    try {
      await foundry.applications.handlebars.loadTemplates([BUCKET_TEMPLATE, BUCKET_ROW_TEMPLATE]);
    } catch (err) {
      console.error(`${MODULE_ID} | the bucket partials could not be loaded`, err);
    }
    const caster = await casterFacts(this.#actor);
    const victims = await victimsOf(this.#held.list, this.#held);
    // A victim whose document is gone leaves the list, so the bucket never holds a row nothing backs.
    this.#held.list = this.#held.list.filter((row) => victims.some((v) => v.uuid === row.uuid));
    const panel = panelModel({ caster, victims, state: this.#held, tables: tablesNow(), judge: game.user.isGM === true, loc, bucketLoc: makeLoc(BUCKET_LANG_PREFIX), cites: sacrificeCites() });
    const { plan, ...view } = panel;
    return { ...context, ...view, caster: { name: caster.name, img: caster.img }, acting: this.#acting };
  }

  /** @override */
  _onRender(context, options) {
    super._onRender?.(context, options);
    for (const dragDrop of this.#dragDrop) dragDrop.bind(this.element);
  }

  /** @override */
  _onClose(options) {
    super._onClose?.(options);
    OPEN.delete(this.#actor.uuid);
  }

  /* -------------------------------------------- */
  /*  What the seat has set                       */
  /* -------------------------------------------- */

  /**
   * Read the window's controls into what is held. A control that is disabled (a Player's seat) or not on the page
   * leaves what is held as it is. A node is told by `nodeType`, never `instanceof`, so a window built in a browser
   * window of its own reads the same.
   */
  #capture() {
    const form = this.element;
    if (form?.nodeType !== 1) return;
    const held = this.#held;
    for (const key of ["site", "power"]) {
      const box = form.querySelector(`input[name="${key}"]`);
      if (box && !box.disabled) held[key] = box.checked;
    }
    const byVictim = {};
    for (const el of form.querySelectorAll("[data-victim]")) {
      if (el.disabled) continue;
      const mine = (byVictim[el.dataset.victim] ??= {});
      if (el.dataset.field) mine[el.dataset.field] = el.checked;
      else if (el.dataset.trait !== undefined) {
        const ticked = (mine.traits ??= []);
        if (el.checked) ticked.push(Number(el.dataset.trait));
      }
      else if (el.dataset.value !== undefined) mine.value = el.value;
    }
    for (const [uuid, mine] of Object.entries(byVictim)) {
      const before = cleanState(held.victims[uuid]);
      // A victim's traits are read whole where its trait checks were drawn enabled, and left alone where they were not.
      held.victims[uuid] = cleanState({ ...before, ...mine, traits: mine.traits ?? before.traits });
    }
  }

  /** A drop on the bucket: a creature or a token, once, other than the caster itself. */
  async #onDrop(event) {
    event.currentTarget?.classList?.remove("drop-hover");
    this.#capture();
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    const made = await entryFromDrop(data, fromUuid, { policy: { accepts: { kinds: VICTIM_KINDS } }, present: this.#held.list });
    if (!made.entry) {
      if (made.refused !== "noDrop") announce(made.refused === "kind" ? "kind" : made.refused, { name: made.name ?? "" });
      return;
    }
    const doc = await fromUuid(made.entry.uuid).catch(() => null);
    if (creatureOf(doc)?.uuid === this.#actor.uuid) {
      announce("self");
      return;
    }
    if (await holdsCreature(this.#held.list, doc)) {
      announce("duplicate");
      return;
    }
    this.#held.list.push({ uuid: made.entry.uuid, qty: 1, fit: "" });
    this.render();
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /** A change in any control: keep what is held and draw it again. */
  static #onForm() {
    this.#capture();
    this.render();
  }

  /** X on a victim row: it leaves the bucket, and what was set for it with it. */
  static #onRemove(_event, target) {
    this.#capture();
    const uuid = target.dataset.uuid;
    this.#held.list = this.#held.list.filter((row) => row.uuid !== uuid);
    delete this.#held.victims[uuid];
    this.render();
  }

  static #onCancel() {
    this.close();
  }

  /**
   * Make the sacrifice. The gates are asked again on what the world holds now, so a stale window cannot act on a plan
   * that no longer stands. What was acted on leaves the bucket; a victim that counted for nothing stays.
   */
  static async #onSacrifice() {
    this.#capture();
    if (this.#acting) return;
    this.#acting = true;
    try {
      const caster = await casterFacts(this.#actor);
      const victims = await victimsOf(this.#held.list, this.#held);
      const plan = planOf({ caster, victims, state: this.#held, tables: tablesNow(), judge: game.user.isGM === true, loc });
      if (!plan.canAct) {
        this.render();
        return;
      }
      const result = await sacrifice(this.#actor, this.#held);
      if (!result.ok) {
        announce("act", { why: loc(`hold.${result.reason}`, { cite: "" }) });
        return;
      }
      const gone = new Set([...(result.marked ?? [])]);
      this.#held.list = this.#held.list.filter((row) => !gone.has(row.uuid));
      for (const uuid of gone) delete this.#held.victims[uuid];
    } catch (err) {
      console.error(`${MODULE_ID} | the sacrifice failed`, err);
      ui.notifications?.error(game.i18n.localize(`${LANG_PREFIX}.sacrifice.refused.failed`));
    } finally {
      this.#acting = false;
      this.render();
    }
  }
}
