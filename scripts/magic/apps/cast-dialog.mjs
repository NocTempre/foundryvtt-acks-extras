/* global game, foundry, CONFIG, Hooks, fromUuid, ui */
/**
 * The cast dialog: what the seat decides before a spell spends anything, as an
 * ApplicationV2 over a scrolling body and a pinned footer (the shape of the
 * influence window). The body holds the header (caster, spell, level, and the
 * form of a reversible spell), the spell's choices drawn as effect rows in the
 * character sheet's tones, the tradition's band (the fields and the band of its
 * procedure, `cast-procedure.mjs`, headed by the tradition's name), the saves, and the targets bucket; the footer holds
 * what stands in the way, the visibility, Cancel and Cast (or Declare). A
 * verdict that blocks a Player disables the button, and a Judge reads it as a
 * warning. Cancel and a closed window both answer null, so nothing is spent.
 *
 * The bucket IS the seat's `game.user.targets`, and nothing else is kept: X
 * releases that token's target, a dropped Actor or Token targets it, "Add my
 * token" targets the caster's, and the window re-renders on `targetToken` for
 * this user (debounced, unhooked on close), so a T pressed on the canvas while
 * it is open shows too. `game.user.targets` is per user, so a Player's window
 * reads and writes its own. What the seat typed lives on the instance and
 * survives every re-render. All the questions the window asks of the cast are
 * answered by `cast-dialog-model.mjs`.
 */
import { MODULE_ID } from "../constants.mjs";
import { BUCKETS_KEY } from "../cast-procedure.mjs";
import { dialogContext, initialState, answerOf, resolveDrop, resolveActor, addTarget, untarget } from "./cast-dialog-model.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const loc = (key, data = {}) => game.i18n.format(`ACKS-MAGIC.cast.${key}`, data);

/** How long a burst of target changes is allowed to settle before the window reads them. */
const REFRESH_MS = 40;

/** The cast dialog. */
export class CastDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  /** The cast's context; `refresh()` on it reads the bucket again. */
  #ctx;
  /** The seat's answer so far. Never named `state`: ApplicationV2 owns that name. */
  #answer;
  #resolve;
  #settled = false;
  #hook = null;
  #timer = null;
  #dragDrop;

  constructor(ctx, resolve, options = {}) {
    super(options);
    this.#ctx = ctx;
    this.#resolve = resolve;
    this.#answer = initialState(ctx, { visibility: game.settings.get("core", "messageMode") });
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
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll", "acks-extras-frame-vars", "acks-extras-cast"],
    tag: "form",
    window: { icon: "fa-solid fa-wand-sparkles", resizable: true },
    position: { width: 580, height: "auto" },
    form: { handler: CastDialog.#onForm, submitOnChange: true, closeOnSubmit: false },
    actions: { cast: CastDialog.#onCast, cancel: CastDialog.#onCancel, untarget: CastDialog.#onUntarget, pickWeapon: CastDialog.#onPickWeapon, addMine: CastDialog.#onAddMine },
    // An Actor or a Token dropped anywhere on the bucket is targeted.
    dragDrop: [{ dropSelector: ".acks-extras-cast-targets" }],
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/magic/cast-dialog.hbs`, scrollable: [""] },
    footer: { template: `modules/${MODULE_ID}/templates/magic/cast-dialog-footer.hbs` },
  };

  /**
   * Ask for a cast's choices. Resolves with the answer (`answerOf`) or null where
   * the seat cancels or closes the window.
   * @param {object} ctx  the cast's context (`askContext` in `cast-spell.mjs`)
   * @returns {Promise<ReturnType<typeof answerOf>|null>}
   */
  static wait(ctx) {
    return new Promise((resolve) => {
      new CastDialog(ctx, resolve).render({ force: true });
    });
  }

  /** @override */
  get title() {
    return this.#ctx.spell?.name ?? loc("dialog.title");
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const modeLabel = (key) => loc(`dialog.mode.${key}`);
    const visibilityLabel = (key) => game.i18n.localize(CONFIG.ChatMessage.modes?.[key]?.label ?? key);
    const statusImg = (id) => CONFIG.statusEffects?.find?.((s) => s.id === id)?.img ?? null;
    const view = dialogContext(this.#ctx, this.#answer, { modeLabel, visibilityLabel, statusImg });
    // A band partial that cannot be loaded is left out, so the dialog still opens and the cast is not lost with it.
    if (view.invocation.band) {
      try {
        await foundry.applications.handlebars.loadTemplates([view.invocation.band.template]);
      } catch (err) {
        console.error(`${MODULE_ID} | a cast procedure's band could not be loaded`, err);
        view.invocation.band = null;
        view.invocation.show = view.invocation.fields.length > 0;
      }
    }
    return { ...context, ...view };
  }

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender?.(context, options);
    // A target of this user, changed anywhere (the canvas's T, a drop, the bucket's X), re-reads the bucket.
    this.#hook = Hooks.on("targetToken", (user) => {
      if (user === game.user) this.#scheduleRefresh();
    });
  }

  /** @override */
  _onRender(context, options) {
    super._onRender?.(context, options);
    for (const dragDrop of this.#dragDrop) dragDrop.bind(this.element);
  }

  /** @override */
  _onClose(options) {
    super._onClose?.(options);
    this.#unhook();
    this.#settle(null);
  }

  /* -------------------------------------------- */
  /*  The answer                                  */
  /* -------------------------------------------- */

  /** Settle the cast's question once; every later settle is ignored. */
  #settle(value) {
    if (this.#settled) return;
    this.#settled = true;
    this.#resolve(value);
  }

  #unhook() {
    if (this.#hook !== null) Hooks.off("targetToken", this.#hook);
    this.#hook = null;
    clearTimeout(this.#timer);
    this.#timer = null;
  }

  /**
   * Read the window's controls into the answer. A control that is not on the
   * page (another form's, a field that was not shown) leaves what the answer
   * already holds. A node is told by `nodeType`, never `instanceof`, so a window
   * built in a browser window of its own reads the same.
   */
  #capture() {
    const form = this.element;
    if (form?.nodeType !== 1) return;
    const a = this.#answer;
    const field = (name) => form.querySelector(`[name="${name}"]`);
    const mode = form.querySelector('input[name="mode"]:checked');
    if (mode) a.mode = mode.value;
    for (const radio of form.querySelectorAll("input[data-pick]:checked")) a.picks[radio.dataset.pick] = radio.value;
    for (const name of ["pickKind", "casterLevel", "situational", "visibility"]) {
      const el = field(name);
      if (el) a[name] = el.value;
    }
    // The tradition's controls, by the name `procedure.<key>`: a field of its band, or a control of its own band partial. The buckets' key is no control's: an entry comes by a drag alone.
    for (const el of form.querySelectorAll('[name^="procedure."]')) {
      const key = el.name.slice("procedure.".length);
      if (!key || key === BUCKETS_KEY) continue;
      if (el.type === "radio") {
        if (el.checked) a.procedure[key] = el.value;
      } else a.procedure[key] = el.type === "checkbox" ? el.checked : el.value;
    }
    const toggle = field("saveMod");
    if (toggle && !toggle.disabled) a.saveMod = toggle.checked;
    const typed = {};
    for (const input of form.querySelectorAll("input[data-alloc-row]")) (typed[input.dataset.allocRow] ??= {})[input.dataset.allocUuid] = input.value;
    for (const [row, figures] of Object.entries(typed)) a.allocation[row] = { ...(a.allocation[row] ?? {}), ...figures };
  }

  /** Read the bucket again after a burst of target changes, then draw. */
  #scheduleRefresh() {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      if (this.#settled) return;
      this.#capture();
      this.#ctx = this.#ctx.refresh?.() ?? this.#ctx;
      this.render();
    }, REFRESH_MS);
  }

  /* -------------------------------------------- */
  /*  The bucket                                  */
  /* -------------------------------------------- */

  /** Take what a drop or a button resolved to: target the token, or say why none. */
  #take(found) {
    if (found.token) {
      if (!addTarget(found.token)) ui.notifications?.warn(loc("notice.drop.offScene"));
      this.#scheduleRefresh();
    } else if (found.notice && found.notice !== "noDrop") ui.notifications?.warn(loc(`notice.drop.${found.notice}`, { name: found.name ?? "" }));
  }

  async #onDrop(event) {
    event.currentTarget?.classList?.remove("drop-hover");
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    this.#take(await resolveDrop(data, { fromUuid }));
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /** A change in any control: keep the answer and draw it again. */
  static #onForm() {
    this.#capture();
    this.render();
  }

  static #onCast() {
    this.#capture();
    if (dialogContext(this.#ctx, this.#answer).footer.blocked) return;
    this.#settle(answerOf(this.#ctx, this.#answer));
    this.close();
  }

  static #onCancel() {
    this.#settle(null);
    this.close();
  }

  static #onUntarget(_event, target) {
    untarget(game.user.targets, target.dataset.uuid);
    this.#scheduleRefresh();
  }

  static #onPickWeapon(_event, target) {
    this.#capture();
    this.#answer.items[target.dataset.uuid] = target.dataset.weapon;
    this.render();
  }

  static #onAddMine() {
    this.#take(resolveActor(this.#ctx.caster));
  }
}
