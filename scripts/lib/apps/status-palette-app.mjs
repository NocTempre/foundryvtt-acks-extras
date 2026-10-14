/* global foundry, game, ui, fromUuid, CSS */
/**
 * The palette editor: the statuses a token's HUD offers, in the order the
 * Judge drags them into, over the ones kept off it, grouped by where each
 * comes from. A status is moved by dragging its tile, by the buttons on it, or
 * from the keyboard with the tile focused. An Active Effect dropped on the
 * window becomes a status of the Judge's own that carries the effect's changes
 * and duration. The draft lives on the instance and nothing is written until
 * Save, which stores the arrangement in one world setting. One window per
 * world, however it was opened.
 */
import { MODULE_ID, LANG_PREFIX } from "../constants.mjs";
import { makeLoc } from "../util.mjs";
import { STATUS_PALETTE_SETTING, knownStatuses, takenStatusIds } from "../status-effects.mjs";
import {
  CUSTOM_EFFECT_FIELDS, PALETTE_SOURCES, isArranged, normalizeCustom, normalizePalette, paletteSetting,
  resolvePalette, slugStatusId, statusIdError,
} from "../status-palette.mjs";

const { HandlebarsApplicationMixin, ApplicationV2, DialogV2 } = foundry.applications.api;
const LANG_KEY_PREFIX = `${LANG_PREFIX}.statusPalette`;
const loc = makeLoc(LANG_KEY_PREFIX);

/** The drag payload's type for a tile of this window. */
const DRAG_TYPE = `${MODULE_ID}.status`;
const TILE = ".acks-extras-palette-tile";
const DEFAULT_ICON = "icons/svg/aura.svg";
const EDIT_TEMPLATE = `modules/${MODULE_ID}/templates/lib/status-palette-edit.hbs`;
const DIALOG_CLASSES = ["acks-ui", "acks-extras", "acks-extras-scroll", "acks-extras-palette-dialog"];

const nameOf = (status) => game.i18n.localize(status.name ?? status.id);
/** By name, as a token's HUD lists a palette that carries no places. */
const byName = (statuses) => [...statuses].sort((a, b) => nameOf(a).localeCompare(nameOf(b), game.i18n.lang));
/** The element an event landed on: a text node answers with its parent. */
const elementOf = (node) => (node?.nodeType === 1 ? node : (node?.parentElement ?? null));

let instance = null;

/** The palette editor window. */
export class StatusPaletteApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "acks-extras-status-palette",
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll", "acks-extras-palette"],
    position: { width: 760, height: 680 },
    window: { title: `${LANG_PREFIX}.statusPalette.title`, icon: "fa-solid fa-table-cells", resizable: true },
    actions: {
      moveEarlier: StatusPaletteApp.#onMoveEarlier,
      moveLater: StatusPaletteApp.#onMoveLater,
      takeOff: StatusPaletteApp.#onTakeOff,
      putOn: StatusPaletteApp.#onPutOn,
      addAll: StatusPaletteApp.#onAddAll,
      newStatus: StatusPaletteApp.#onNewStatus,
      editStatus: StatusPaletteApp.#onEditStatus,
      deleteStatus: StatusPaletteApp.#onDeleteStatus,
      reset: StatusPaletteApp.#onReset,
      save: StatusPaletteApp.#onSave,
    },
  };

  // The body is its own scroller so a re-render after each move keeps its
  // place; the footer is a second part so Save never scrolls away.
  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/lib/status-palette.hbs`, scrollable: [""] },
    footer: { template: `modules/${MODULE_ID}/templates/lib/status-palette-footer.hbs` },
  };

  /** The ids on the palette, in order. */
  #layout = [];
  /** The Judge-made statuses, as they are stored. */
  #custom = [];
  /** False while the palette carries no order of the Judge's and is listed by name. */
  #arranged = false;
  #dirty = false;
  #filter = "";
  /** The status whose tile takes the focus once the next render lands. */
  #focus = null;
  /** The status being dragged from this window, or null. */
  #dragging = null;

  constructor(options = {}) {
    super(options);
    this.#load();
  }

  /** True while the draft differs from what is stored. */
  get dirty() {
    return this.#dirty;
  }

  /** Replace the draft with the stored arrangement. */
  #load() {
    const stored = game.settings.get(MODULE_ID, STATUS_PALETTE_SETTING) ?? {};
    this.#custom = normalizePalette(stored).custom;
    this.#arranged = isArranged(stored);
    const on = resolvePalette(stored, knownStatuses(stored)).filter((entry) => entry.on);
    this.#layout = (this.#arranged ? on : byName(on)).map((entry) => entry.id);
    this.#dirty = false;
  }

  /** Take up the stored arrangement again and redraw. */
  reload() {
    this.#load();
    return this.render();
  }

  /** Every status the draft can offer, by id. */
  #known() {
    return new Map(knownStatuses({ custom: this.#custom }).map((status) => [status.id, status]));
  }

  /** One status as its tile shows it; `place` is its index on the palette, or null off it. */
  #tile(status, place) {
    const name = nameOf(status);
    const custom = status.source === "custom";
    return {
      id: status.id,
      name,
      img: status.img,
      sourceLabel: loc(`source.${status.source}`),
      custom,
      carries: custom && !!status.data,
      key: `${name} ${status.id}`.toLowerCase(),
      aria: place == null ? loc("tile.off", { name }) : loc("tile.on", { name, place: place + 1, count: this.#layout.length }),
    };
  }

  /** @override */
  async _prepareContext() {
    const known = this.#known();
    // A status that stopped being known since the draft was taken drops out of it.
    this.#layout = this.#layout.filter((id) => known.has(id));
    const onSet = new Set(this.#layout);
    const on = this.#layout.map((id, place) => this.#tile(known.get(id), place));
    const groups = [];
    for (const source of PALETTE_SOURCES) {
      const off = [...known.values()].filter((status) => status.source === source && !onSet.has(status.id));
      if (off.length) groups.push({ source, label: loc(`source.${source}`), entries: byName(off).map((s) => this.#tile(s, null)) });
    }
    return {
      on,
      groups,
      onLabel: loc("onLabel", { count: on.length }),
      filter: this.#filter,
      clean: !this.#dirty,
      stateLabel: this.#dirty ? loc("unsaved") : "",
    };
  }

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    const root = this.element;
    root.addEventListener("dragstart", (event) => this.#onDragStart(event));
    root.addEventListener("dragover", (event) => this.#onDragOver(event));
    root.addEventListener("drop", (event) => this.#onDrop(event));
    root.addEventListener("dragend", () => this.#endDrag());
    root.addEventListener("keydown", (event) => this.#onKey(event));
    root.addEventListener("input", (event) => this.#onFilter(event));
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.#applyFilter();
    if (!this.#focus) return;
    const tile = this.element.querySelector(`${TILE}[data-status="${CSS.escape(this.#focus)}"]`);
    this.#focus = null;
    tile?.focus();
  }

  /**
   * Close the window. With unsaved changes the Judge is asked first, and a
   * refusal leaves it open.
   * @override
   */
  async close(options = {}) {
    if (this.#dirty) {
      const discard = await DialogV2.confirm({
        window: { title: loc("discardTitle") },
        classes: DIALOG_CLASSES,
        content: `<p>${foundry.utils.escapeHTML(loc("discard"))}</p>`,
      }).catch(() => null);
      if (!discard) return this;
      this.#dirty = false;
    }
    return super.close(options);
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    if (instance === this) instance = null;
  }

  /* -------------------------------------------- */
  /*  The draft                                    */
  /* -------------------------------------------- */

  /** Mark the draft changed and redraw, with the focus on `id`'s tile. */
  #changed(id = null) {
    this.#dirty = true;
    this.#focus = id;
    return this.render();
  }

  /**
   * Put `id` on the palette before the status now at `index`, wherever it was;
   * `index` counts the palette as it stands, the moved status included.
   */
  #place(id, index) {
    const from = this.#layout.indexOf(id);
    let at = Math.max(0, Math.min(index, this.#layout.length));
    if (from >= 0) {
      if (from < at) at -= 1;
      if (from === at) return null;
      this.#layout.splice(from, 1);
    }
    this.#layout.splice(at, 0, id);
    this.#arranged = true;
    return this.#changed(id);
  }

  /** Move `id` one place earlier (`step` -1) or later (+1). */
  #moveBy(id, step) {
    const from = this.#layout.indexOf(id);
    if (from < 0) return null;
    return this.#place(id, step < 0 ? from - 1 : from + 2);
  }

  /** Take `id` off the palette. */
  #takeOff(id) {
    const from = this.#layout.indexOf(id);
    if (from < 0) return null;
    this.#layout.splice(from, 1);
    return this.#changed(id);
  }

  /**
   * Put `ids` on the palette. A palette still listed by name stays so while
   * every one of them is on it by default; any other joins at the end, and the
   * order shown becomes the Judge's.
   */
  #putOn(ids) {
    const known = this.#known();
    const fresh = ids.filter((id) => known.has(id) && !this.#layout.includes(id));
    if (!fresh.length) return null;
    this.#layout.push(...fresh);
    if (!this.#arranged) {
      if (fresh.every((id) => known.get(id).defaultOn)) {
        this.#layout = byName(this.#layout.map((id) => known.get(id))).map((status) => status.id);
      } else this.#arranged = true;
    }
    return this.#changed(fresh[0]);
  }

  /* -------------------------------------------- */
  /*  Dragging                                     */
  /* -------------------------------------------- */

  #onDragStart(event) {
    const tile = elementOf(event.target)?.closest?.(TILE);
    if (!tile || !event.dataTransfer) return;
    this.#dragging = tile.dataset.status;
    event.dataTransfer.setData("text/plain", JSON.stringify({ type: DRAG_TYPE, id: this.#dragging }));
    event.dataTransfer.effectAllowed = "move";
  }

  /**
   * Where a drop at the pointer lands on the palette: before the first shown
   * tile the pointer precedes in reading order, or at the end.
   * @returns {{tile: Element|null, index: number}}
   */
  #placeAt(event) {
    for (const tile of this.element.querySelectorAll(`[data-zone="on"] ${TILE}:not([hidden])`)) {
      const box = tile.getBoundingClientRect();
      const before = event.clientY < box.top || (event.clientY <= box.bottom && event.clientX < box.left + box.width / 2);
      if (before) return { tile, index: this.#layout.indexOf(tile.dataset.status) };
    }
    return { tile: null, index: this.#layout.length };
  }

  #clearMarks() {
    for (const marked of this.element.querySelectorAll(".acks-extras-palette-before, .acks-extras-palette-end, .acks-extras-palette-drop")) {
      marked.classList.remove("acks-extras-palette-before", "acks-extras-palette-end", "acks-extras-palette-drop");
    }
  }

  #endDrag() {
    this.#dragging = null;
    this.#clearMarks();
  }

  #onDragOver(event) {
    const zone = elementOf(event.target)?.closest?.("[data-zone]");
    if (!zone) return;
    // Accepting the drag is what makes the drop arrive; what it carries cannot be read until then.
    event.preventDefault();
    if (this.#dragging && event.dataTransfer) event.dataTransfer.dropEffect = "move";
    this.#clearMarks();
    if (zone.dataset.zone !== "on") {
      zone.classList.add("acks-extras-palette-drop");
      return;
    }
    const { tile } = this.#placeAt(event);
    if (tile) tile.classList.add("acks-extras-palette-before");
    else zone.classList.add("acks-extras-palette-end");
  }

  async #onDrop(event) {
    const zone = elementOf(event.target)?.closest?.("[data-zone]");
    if (!zone) return;
    event.preventDefault();
    const onPalette = zone.dataset.zone === "on";
    const index = onPalette ? this.#placeAt(event).index : null;
    let data = null;
    try {
      data = JSON.parse(event.dataTransfer?.getData("text/plain") || "null");
    } catch {
      data = null;
    }
    this.#endDrag();
    if (data?.type === DRAG_TYPE && typeof data.id === "string") {
      if (onPalette) this.#place(data.id, index);
      else this.#takeOff(data.id);
    } else if (data?.type === "ActiveEffect" && data.uuid) await this.#adoptEffect(data.uuid, index);
    else ui.notifications.warn(loc("notice.notDroppable"));
  }

  /**
   * Make a status of the Judge's own from a dropped Active Effect, keeping what
   * the effect does. It lands on the palette at `index`, or off it when null.
   */
  async #adoptEffect(uuid, index) {
    const effect = await Promise.resolve(fromUuid(uuid)).catch(() => null);
    if (effect?.documentName !== "ActiveEffect") return ui.notifications.warn(loc("notice.notDroppable"));
    const data = effect.toObject();
    const kept = {};
    for (const field of CUSTOM_EFFECT_FIELDS) if (data[field] != null && data[field] !== "") kept[field] = data[field];
    // Whether the dropped effect had run out is that effect's state, not the status's.
    if (kept.duration) delete kept.duration.expired;
    const custom = normalizeCustom({
      id: slugStatusId(data.name, takenStatusIds({ custom: this.#custom })),
      name: data.name,
      img: data.img || DEFAULT_ICON,
      effect: kept,
    });
    if (!custom) return ui.notifications.warn(loc("notice.notDroppable"));
    this.#custom.push(custom);
    ui.notifications.info(loc("notice.adopted", { name: custom.name }));
    if (index == null) return this.#changed(custom.id);
    return this.#place(custom.id, index);
  }

  /* -------------------------------------------- */
  /*  Keys and the filter                          */
  /* -------------------------------------------- */

  /** A key on a focused tile: arrows move it, Home and End send it to an end, Delete takes it off, Enter puts it on. */
  #onKey(event) {
    const tile = event.target;
    if (!tile?.matches?.(TILE)) return;
    const id = tile.dataset.status;
    const on = this.#layout.includes(id);
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
    if (on && step) this.#moveBy(id, step);
    else if (on && event.key === "Home") this.#place(id, 0);
    else if (on && event.key === "End") this.#place(id, this.#layout.length);
    else if (on && (event.key === "Delete" || event.key === "Backspace")) this.#takeOff(id);
    else if (!on && (event.key === "Enter" || event.key === " ")) this.#putOn([id]);
    else return;
    event.preventDefault();
  }

  /** Show only the tiles whose name or id holds the filter's text. No re-render, so the box keeps the caret. */
  #applyFilter() {
    const want = this.#filter.trim().toLowerCase();
    for (const tile of this.element.querySelectorAll(TILE)) tile.hidden = !!want && !tile.dataset.key.includes(want);
  }

  #onFilter(event) {
    const box = event.target;
    if (!box?.matches?.("input[data-filter]")) return;
    this.#filter = box.value;
    this.#applyFilter();
  }

  /* -------------------------------------------- */
  /*  Statuses of the Judge's own                  */
  /* -------------------------------------------- */

  /** Ask for a status's name, icon and (while new) id. Resolves the form's values, or a falsy value when dismissed. */
  async #askCustom(values, isNew) {
    const content = await foundry.applications.handlebars.renderTemplate(EDIT_TEMPLATE, {
      ...values,
      isNew,
      carries: !!values.effect,
    });
    return DialogV2.wait({
      classes: DIALOG_CLASSES,
      window: { title: loc(isNew ? "edit.newTitle" : "edit.editTitle"), icon: "fa-solid fa-pen" },
      position: { width: 440 },
      content,
      buttons: [
        {
          action: "ok",
          default: true,
          icon: "fa-solid fa-check",
          label: loc("edit.ok"),
          callback: (_event, button) => new foundry.applications.ux.FormDataExtended(button.form).object,
        },
        { action: "cancel", icon: "fa-solid fa-xmark", label: loc("edit.cancel"), callback: () => false },
      ],
      rejectClose: false,
    }).catch(() => null);
  }

  /**
   * Make a status, or change the name and icon of `existing`. An id that
   * cannot be used is said and the question asked again with what was typed.
   * @returns {Promise<object|null>} the status as stored, or null when dismissed
   */
  async #editCustom(existing = null) {
    const taken = takenStatusIds({ custom: this.#custom });
    let values = existing ? { ...existing } : { id: "", name: "", img: DEFAULT_ICON };
    for (;;) {
      const answer = await this.#askCustom(values, !existing);
      if (!answer || typeof answer !== "object") return null;
      const name = String(answer.name ?? "").trim();
      const img = String(answer.img ?? "").trim() || DEFAULT_ICON;
      values = { ...values, name, img, id: existing ? existing.id : String(answer.id ?? "").trim() };
      if (!name) {
        ui.notifications.warn(loc("edit.needName"));
        continue;
      }
      if (existing) return normalizeCustom({ ...existing, name, img });
      const id = values.id || slugStatusId(name, taken);
      const error = statusIdError(id, taken);
      if (!error) return normalizeCustom({ id, name, img });
      ui.notifications.warn(loc(`edit.idError.${error}`, { id }));
    }
  }

  /* -------------------------------------------- */
  /*  Actions                                      */
  /* -------------------------------------------- */

  static #statusOf(target) {
    return target.closest(TILE)?.dataset.status ?? null;
  }

  static #onMoveEarlier(_event, target) {
    this.#moveBy(StatusPaletteApp.#statusOf(target), -1);
  }

  static #onMoveLater(_event, target) {
    this.#moveBy(StatusPaletteApp.#statusOf(target), 1);
  }

  static #onTakeOff(_event, target) {
    this.#takeOff(StatusPaletteApp.#statusOf(target));
  }

  static #onPutOn(_event, target) {
    this.#putOn([StatusPaletteApp.#statusOf(target)]);
  }

  /** Put every status of one source on the palette, the ones the filter hides included. */
  static #onAddAll(_event, target) {
    const source = target.dataset.source;
    const off = [...this.#known().values()].filter((status) => status.source === source && !this.#layout.includes(status.id));
    this.#putOn(byName(off).map((status) => status.id));
  }

  static async #onNewStatus() {
    const made = await this.#editCustom();
    if (!made) return;
    this.#custom.push(made);
    this.#putOn([made.id]);
  }

  static async #onEditStatus(_event, target) {
    const id = StatusPaletteApp.#statusOf(target);
    const at = this.#custom.findIndex((status) => status.id === id);
    if (at < 0) return;
    const edited = await this.#editCustom(this.#custom[at]);
    if (!edited) return;
    this.#custom[at] = edited;
    this.#changed(id);
  }

  static async #onDeleteStatus(_event, target) {
    const id = StatusPaletteApp.#statusOf(target);
    const at = this.#custom.findIndex((status) => status.id === id);
    if (at < 0) return;
    const sure = await DialogV2.confirm({
      window: { title: loc("deleteTitle") },
      classes: DIALOG_CLASSES,
      content: `<p>${foundry.utils.escapeHTML(loc("delete", { name: this.#custom[at].name }))}</p>`,
    }).catch(() => null);
    if (!sure) return;
    this.#custom.splice(at, 1);
    this.#layout = this.#layout.filter((other) => other !== id);
    this.#changed();
  }

  /** Back to the palette as it comes: every default status, listed by name. The Judge's own statuses stay. */
  static #onReset() {
    const on = [...this.#known().values()].filter((status) => status.defaultOn);
    this.#layout = byName(on).map((status) => status.id);
    this.#arranged = false;
    this.#changed();
  }

  static async #onSave() {
    const known = this.#known();
    const onSet = new Set(this.#layout);
    const entries = [
      ...this.#layout.filter((id) => known.has(id)).map((id) => ({ id, on: true, defaultOn: known.get(id).defaultOn })),
      ...[...known.values()].filter((s) => !onSet.has(s.id)).map((s) => ({ id: s.id, on: false, defaultOn: s.defaultOn })),
    ];
    const setting = paletteSetting(entries, this.#custom, { arranged: this.#arranged });
    try {
      await game.settings.set(MODULE_ID, STATUS_PALETTE_SETTING, setting);
    } catch (err) {
      return void ui.notifications.error(err.message);
    }
    // The setting's own change handler redraws a clean window, and is not
    // called for a write that changed nothing.
    this.reload();
  }
}

/** The settings-menu entry: Foundry builds its own instance, which hands off to the open one. */
export class StatusPaletteMenu extends StatusPaletteApp {
  async render(...args) {
    if (instance && instance !== this && instance.rendered) {
      instance.bringToFront();
      return this;
    }
    instance = this;
    return super.render(...args);
  }
}

/**
 * Open the palette editor. GM only; a second call raises the open window
 * instead of making another.
 * @returns {StatusPaletteApp|null}
 */
export function openStatusPalette() {
  if (!game.user?.isGM) {
    ui.notifications.warn(loc("gmOnly"));
    return null;
  }
  if (instance?.rendered) {
    instance.bringToFront();
    return instance;
  }
  instance = new StatusPaletteApp();
  instance.render(true);
  return instance;
}

/**
 * The stored arrangement changed: an open editor with nothing unsaved takes it
 * up. One with unsaved changes keeps its draft, which the Judge's Save writes.
 */
export function refreshStatusPalette() {
  if (instance?.rendered && !instance.dirty) instance.reload();
}
