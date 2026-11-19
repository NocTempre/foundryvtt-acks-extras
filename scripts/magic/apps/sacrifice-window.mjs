/* global game, foundry, fromUuid, ui */
/**
 * The Blood sacrifice window: a caster, a bucket of victims dropped from the sidebar or the canvas, what a Judge
 * says of each (willing or helpless, the traits that apply, the value, young) inside the victim's own row and of the
 * sacrifice (the site, the class power), the yield, and the verdicts that stand in the way. ApplicationV2 over a
 * scrolling body and a pinned footer, the cast dialog's shape. `sacrifice.mjs` answers every question the window asks
 * (`panelModel`) and decides the act; the live half (`sacrifice-live.mjs`) reads the documents and makes the writes.
 *
 * The window holds nothing of its own. Everything it draws is the caster's shared record (`sacrifice-record.mjs`),
 * written through `writeRecord` and drawn again by the update hook whenever it changes, so every window open for
 * the caster shows the same facts as the Judge sets them. The checks are a Judge's: a Player's seat reads them as
 * text and its Sacrifice button is disabled with the reason in the footer, the way the cast plan's verdicts disable
 * the cast button, until nothing waits on the Judge. The record goes when the sacrifice is made, and when a Judge
 * closes the window. One window serves one caster.
 */
import { MODULE_ID, LANG_PREFIX } from "../constants.mjs";
import { entryFromDrop, BUCKET_ACTIONS, BUCKET_TEMPLATE, BUCKET_ROW_TEMPLATE, BUCKET_LANG_PREFIX } from "../../lib/bucket.mjs";
import { makeLoc } from "../../lib/util.mjs";
import { panelModel, planOf, VICTIM_KINDS } from "../sacrifice.mjs";
import { OP, stateOf, diffJudge } from "../sacrifice-record.mjs";
import { casterFacts, victimsOf, tablesNow, sacrificeCites, sacrifice, creatureOf, holdsCreature, loc, announce } from "../sacrifice-live.mjs";
import { openWindows, readRecord, writeRecord, clearRecord, refusal } from "../sacrifice-record-live.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** The partial a victim's checks are drawn by inside its bucket row. */
const ROW_PARTIAL = `modules/${MODULE_ID}/templates/magic/sacrifice-victim.hbs`;

/** The Blood sacrifice window. */
export class SacrificeWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  #actor;
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
    let window = openWindows.get(actor.uuid);
    if (!window) {
      window = new SacrificeWindow(actor, { id: `acks-extras-sacrifice-${actor.id}` });
      openWindows.set(actor.uuid, window);
    }
    await window.render({ force: true });
    window.bringToFront?.();
    return window;
  }

  /** @override */
  get title() {
    return loc("title", { name: this.#actor.name });
  }

  /** The shared record as the model's state: what every window for this caster draws. */
  get #shared() {
    return stateOf(readRecord(this.#actor));
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    try {
      await foundry.applications.handlebars.loadTemplates([BUCKET_TEMPLATE, BUCKET_ROW_TEMPLATE, ROW_PARTIAL]);
    } catch (err) {
      console.error(`${MODULE_ID} | the sacrifice's partials could not be loaded`, err);
    }
    const caster = await casterFacts(this.#actor);
    const state = this.#shared;
    const victims = await victimsOf(state.list, state);
    const panel = panelModel({ caster, victims, state, tables: tablesNow(), judge: game.user.isGM === true, loc, bucketLoc: makeLoc(BUCKET_LANG_PREFIX), cites: sacrificeCites(), rowPartial: ROW_PARTIAL });
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
    // Leave the registry first: the clear this close writes is a change the update hook draws, and it must not find this window.
    openWindows.delete(this.#actor.uuid);
    if (game.user.isGM) void clearRecord(this.#actor);
  }

  /* -------------------------------------------- */
  /*  What the seat sets                          */
  /* -------------------------------------------- */

  /**
   * Read the Judge's controls off the window as the model's `read` (`diffJudge`): the site and the class power where they
   * were drawn enabled, and each victim's checks, trait rows and value. A control that is disabled or not on the page is
   * left out, so it is never sent. A node is told by `nodeType`, never `instanceof`, so a window built in a browser window
   * of its own reads the same.
   */
  #read() {
    const form = this.element;
    if (form?.nodeType !== 1) return null;
    const read = { victims: {} };
    for (const key of ["site", "power"]) {
      const box = form.querySelector(`input[name="${key}"]`);
      if (box && !box.disabled) read[key] = box.checked;
    }
    for (const el of form.querySelectorAll("[data-victim]")) {
      if (el.disabled) continue;
      const mine = (read.victims[el.dataset.victim] ??= {});
      if (el.dataset.field) mine[el.dataset.field] = el.checked;
      else if (el.dataset.trait !== undefined) {
        const ticked = (mine.traits ??= []);
        if (el.checked) ticked.push(Number(el.dataset.trait));
      } else if (el.dataset.value !== undefined) mine.value = el.value;
    }
    return read;
  }

  /** Tell the user a write of the record was refused. */
  #refused(result) {
    if (result?.ok === false) ui.notifications?.warn(refusal(result.reason));
  }

  /** A drop on the bucket: a creature or a token, once, other than the caster itself; it is written through the record, which a Player's seat has the GM's client do. */
  async #onDrop(event) {
    event.currentTarget?.classList?.remove("drop-hover");
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    const list = this.#shared.list;
    const made = await entryFromDrop(data, fromUuid, { policy: { accepts: { kinds: VICTIM_KINDS } }, present: list });
    if (!made.entry) {
      if (made.refused !== "noDrop") announce(made.refused === "kind" ? "kind" : made.refused, { name: made.name ?? "" });
      return;
    }
    const doc = await fromUuid(made.entry.uuid).catch(() => null);
    if (creatureOf(doc)?.uuid === this.#actor.uuid) {
      announce("self");
      return;
    }
    if (await holdsCreature(list, doc)) {
      announce("duplicate");
      return;
    }
    this.#refused(await writeRecord(this.#actor, { op: OP.add, uuid: made.entry.uuid }));
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /** A change in a Judge's control: only what differs from the record is written, and the record's update draws every window again. */
  static async #onForm() {
    if (!game.user.isGM) return;
    const read = this.#read();
    const op = read ? diffJudge(readRecord(this.#actor), read) : null;
    if (op) this.#refused(await writeRecord(this.#actor, op));
    else this.render();
  }

  /** X on a victim row: it leaves the record, and what was set for it with it. */
  static async #onRemove(_event, target) {
    this.#refused(await writeRecord(this.#actor, { op: OP.remove, uuid: target.dataset.uuid }));
  }

  static #onCancel() {
    this.close();
  }

  /**
   * Make the sacrifice. The gates are asked again on what the record holds now, so a stale window cannot act on a plan
   * that no longer stands. A sacrifice that yielded something ends the open sacrifice and its record; one that yielded
   * nothing changes nothing, and the record stays for the Judge to correct.
   */
  static async #onSacrifice() {
    if (this.#acting) return;
    this.#acting = true;
    try {
      const state = this.#shared;
      const caster = await casterFacts(this.#actor);
      const victims = await victimsOf(state.list, state);
      const plan = planOf({ caster, victims, state, tables: tablesNow(), judge: game.user.isGM === true, loc });
      if (!plan.canAct) {
        this.render();
        return;
      }
      const result = await sacrifice(this.#actor, state);
      if (!result.ok) {
        announce("act", { why: loc(`hold.${result.reason}`, { cite: "" }) });
        return;
      }
      if (!result.nothing) await clearRecord(this.#actor);
    } catch (err) {
      console.error(`${MODULE_ID} | the sacrifice failed`, err);
      ui.notifications?.error(game.i18n.localize(`${LANG_PREFIX}.sacrifice.refused.failed`));
    } finally {
      this.#acting = false;
      this.render();
    }
  }
}
