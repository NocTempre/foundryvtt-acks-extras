/* global foundry, game */
/**
 * The effect-row editor — one window per row of an `effectsField()` list,
 * and the sheet actions that add, open, delete and reorder rows.
 *
 * A list of effect rows is an INVENTORY: the sheet shows one line per row and
 * this window edits one row. The window knows nothing about where the rows
 * live: it is handed a STORE — `{key, label, domain, read(), write(rows)}` —
 * and every write goes through `store.write`, so the spell primitive, an
 * ability's extras and any later carrier of effect rows share one editor.
 * The `domain` decides which kinds and subjects the pickers offer
 * (`effectTypesFor`, `effectSubjectsFor`); a stored row keeps its type
 * whatever the picker shows.
 *
 * Edits apply as they are made, the way an item sheet applies them; there is
 * no Save button. A row is addressed by index, so the sheet closes every
 * editor on the store when it deletes or reorders a row — an index that
 * survived a splice would edit whichever row slid into its place.
 */
import { MODULE_ID, LANG_PREFIX } from "../constants.mjs";
import * as V from "../vocab.mjs";
import { vocabChoices } from "../magic-vocab.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

const loc = (key, data) => game.i18n.format(`${LANG_PREFIX}.effectEditor.${key}`, data ?? {});

/**
 * How each field of `effectField()` is edited. `set` renders one box per
 * member; `levelValue` the flat / per-level pair; `list` a comma line.
 */
const FIELD_SPECS = {
  appliesTo: { kind: "select", choices: (domain) => V.choicesOf(V.effectSubjectsFor(domain)) },
  target: { kind: "text", list: () => V.choicesOf(V.MODIFIER_TARGETS) },
  mode: { kind: "select", choices: () => V.choicesOf(V.EFFECT_MODES) },
  value: { kind: "levelValue" },
  forWhat: { kind: "text" },
  roll: { kind: "text" },
  rollType: { kind: "select", choices: () => V.choicesOf(V.ROLL_TYPES) },
  damage: { kind: "set", choices: () => V.choicesOf(V.DAMAGE_TYPES) },
  effects: { kind: "set", choices: () => V.choicesOf(V.EFFECT_KEYS) },
  conditions: { kind: "set", choices: () => V.choicesOf(V.CONDITION_KEYS) },
  healKind: { kind: "select", choices: () => vocabChoices("healKind") },
  summonFormat: { kind: "select", choices: () => vocabChoices("summonFormat") },
  control: { kind: "select", choices: () => vocabChoices("controlKind") },
  ref: { kind: "text" },
  refs: { kind: "list" },
  amount: { kind: "number" },
  range: { kind: "number" },
  sense: { kind: "select", choices: () => V.choicesOf(V.SENSE_TYPES) },
  vision: { kind: "select", choices: () => V.choicesOf(V.VISION_TYPES) },
  movementMode: { kind: "select", choices: () => V.choicesOf(V.MOVEMENT_TYPES) },
  spell: { kind: "text" },
  frequency: { kind: "select", choices: () => vocabChoices("spellLikeFreq") },
  castingTime: { kind: "text" },
  school: { kind: "text" },
  casterLevelDelta: { kind: "number" },
  resource: { kind: "select", choices: () => V.choicesOf(V.RESOURCE_KINDS) },
  action: { kind: "select", choices: () => ({ spend: loc("field.actionSpend"), gain: loc("field.actionGain") }) },
  unit: { kind: "text" },
  period: { kind: "text" },
  restriction: { kind: "text" },
  trigger: { kind: "select", choices: () => V.choicesOf(V.OUTCOME_TRIGGERS) },
  consequence: { kind: "text" },
  naturalMax: { kind: "number" },
  belowFraction: { kind: "number" },
  keep: { kind: "select", choices: () => V.choicesOf(V.REROLL_KEEP) },
  times: { kind: "number" },
  choose: { kind: "number" },
  attribute: { kind: "select", choices: () => V.choicesOf(V.ATTRIBUTES) },
  insteadOf: { kind: "select", choices: () => V.choicesOf(V.ATTRIBUTES) },
  as: { kind: "text" },
  atLevel: { kind: "select", choices: () => V.choicesOf(V.PROGRESSION_LEVELS) },
  domain: { kind: "select", choices: () => V.choicesOf(V.PROFICIENCY_DOMAINS) },
  breadth: { kind: "select", choices: () => V.choicesOf(V.PROFICIENCY_BREADTH) },
  group: { kind: "text" },
  naturalWeapon: { kind: "select", choices: () => V.choicesOf(V.NATURAL_WEAPONS) },
  routine: { kind: "text" },
  condition: { kind: "text" },
  note: { kind: "text" },
};

/** Which fields each kind edits, in the order they are shown; the tail is shared. */
const TYPE_FIELDS = {
  modifier: ["appliesTo", "target", "mode", "value", "forWhat"],
  attributeSubstitution: ["attribute", "insteadOf", "target"],
  throw: ["forWhat", "roll", "rollType", "value"],
  progressionAs: ["as", "atLevel"],
  proficiencyGrant: ["domain", "breadth", "group"],
  limitation: ["restriction"],
  outcome: ["trigger", "naturalMax", "belowFraction", "consequence"],
  requires: ["refs", "choose"],
  grants: ["refs", "choose"],
  modifies: ["refs", "target", "mode", "value"],
  reroll: ["forWhat", "target", "keep", "times"],
  companion: ["ref", "amount"],
  immunity: ["appliesTo", "damage", "effects", "conditions"],
  resistance: ["appliesTo", "damage", "effects", "conditions"],
  susceptibility: ["appliesTo", "damage", "effects", "conditions"],
  sense: ["appliesTo", "sense", "vision", "range"],
  movement: ["appliesTo", "movementMode", "value"],
  naturalAttack: ["naturalWeapon", "routine"],
  spellLike: ["spell", "frequency", "castingTime"],
  spellcastingMod: ["school", "casterLevelDelta"],
  resource: ["resource", "action", "amount"],
  conditionGrant: ["appliesTo", "conditions"],
  conditionRemove: ["appliesTo", "conditions"],
  economic: ["amount", "unit", "period"],
  capability: ["frequency", "restriction"],
  damage: ["appliesTo", "roll", "damage", "value"],
  heal: ["appliesTo", "healKind", "roll", "value"],
  summon: ["summonFormat", "ref", "amount", "value", "control"],
  control: ["appliesTo", "control"],
};
const DEFAULT_FIELDS = ["appliesTo", "value", "range"];
const TAIL_FIELDS = ["condition", "note"];
const SET_FIELDS = new Set(["damage", "effects", "conditions"]);
const LIST_FIELDS = new Set(["refs"]);

/** The fields a row of this type edits. */
export const fieldsForType = (type) => [...(TYPE_FIELDS[type] ?? DEFAULT_FIELDS), ...TAIL_FIELDS];

/** One row of one list, in a window of its own. */
export class EffectRowEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * @param {object} options
   * @param {{key: string, label: string, domain: string, read: Function, write: Function}} options.store
   * @param {number} options.index the row's position in `store.read()`
   */
  constructor({ store, index, ...options } = {}) {
    super({ id: `acks-extras-effect-${foundry.utils.randomID(8)}`, ...options });
    this.store = store;
    this.index = index;
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["acks-ui", "acks", "acks-extras", "acks-extras-scroll", "acks-extras-effect-editor"],
    position: { width: 480, height: "auto" },
    window: { icon: "fa-solid fa-gears", contentClasses: ["standard-form"], resizable: true },
    form: { handler: EffectRowEditor.#onChange, submitOnChange: true, closeOnSubmit: false },
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/lib/effect-row-editor.hbs`, scrollable: [""] },
  };

  /** The type the window rendered with, so a change event reads the fields that are on screen. */
  #shownType = null;

  /** @override */
  get title() {
    const row = this.#row();
    const kind = V.EFFECT_TYPES[row?.type]?.label ?? row?.type ?? "";
    return `${this.store.label} — ${kind}`;
  }

  #row() {
    return this.store.read()[this.index] ?? null;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const row = this.#row();
    // The row went away underneath us — deleted from the sheet, or the item
    // rebuilt. Close rather than render an editor over nothing.
    if (!row) {
      this.close();
      return context;
    }
    const domain = this.store.domain ?? "ability";
    this.#shownType = row.type;
    context.row = row;
    context.types = V.choicesOf(V.effectTypesFor(domain));
    // A stored kind outside the domain's picker stays selectable, or the
    // select would fall to its first option and the next change rewrite it.
    if (row.type && !context.types[row.type]) context.types[row.type] = V.EFFECT_TYPES[row.type]?.label ?? row.type;
    context.none = loc("none");
    context.fields = fieldsForType(row.type).map((name) => {
      const spec = FIELD_SPECS[name] ?? { kind: "text" };
      const value = row[name];
      const field = { name, kind: spec.kind, label: loc(`field.${name}`) };
      if (spec.kind === "select") {
        field.choices = spec.choices(domain);
        field.value = value ?? "";
      } else if (spec.kind === "set") {
        const have = new Set([...(value ?? [])]);
        field.options = Object.entries(spec.choices()).map(([key, label]) => ({ key, label, checked: have.has(key) }));
      } else if (spec.kind === "levelValue") {
        const v = value ?? {};
        const kind = v.kind || "flat";
        field.value = v;
        field.isFlat = kind === "flat";
        field.isPerLevel = kind === "perLevel";
        field.kinds = V.choicesOf(V.VALUE_KINDS);
        field.rounds = V.choicesOf(V.VALUE_ROUNDING);
      } else if (spec.kind === "list") {
        field.value = [...(value ?? [])].join(", ");
      } else {
        field.value = value ?? "";
        if (spec.list) field.list = Object.entries(spec.list()).map(([key, label]) => ({ key, label }));
      }
      return field;
    });
    return context;
  }

  /** The window's fields as a row fragment: sets and lists as arrays, everything else as typed. */
  #fromForm() {
    const form = this.element;
    if (!form) return null;
    const data = foundry.utils.expandObject(new foundry.applications.ux.FormDataExtended(form).object);
    for (const name of SET_FIELDS) {
      const v = data[name];
      if (v && typeof v === "object" && !Array.isArray(v)) {
        data[name] = Object.entries(v)
          .filter(([, on]) => on === true)
          .map(([key]) => key);
      }
    }
    for (const name of LIST_FIELDS) {
      if (typeof data[name] === "string") {
        data[name] = data[name]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }
    }
    return data;
  }

  /**
   * Write the window's current state back to the row and re-render. The
   * fields not on screen keep what the row holds — switching kinds costs
   * nothing that was typed under the previous one.
   */
  async #apply() {
    const rows = this.store.read();
    const current = rows[this.index];
    if (!current) return this.close();
    const form = this.#fromForm() ?? {};
    const next = { ...current, ...form };
    if (form.value && typeof form.value === "object") next.value = { ...(current.value ?? {}), ...form.value };
    rows[this.index] = next;
    await this.store.write(rows);
    this.render();
  }

  static async #onChange() {
    await this.#apply();
  }
}

/* -------------------------------------------- */

/** Every open editor on one store. */
function editorsOn(storeKey) {
  const open = foundry.applications.instances?.values?.() ?? [];
  return [...open].filter((app) => app instanceof EffectRowEditor && app.store?.key === storeKey);
}

/** Open (or focus) the editor for one row of a store. */
export function openEffectEditor(store, index) {
  const existing = editorsOn(store.key).find((app) => app.index === index);
  if (existing) {
    existing.bringToFront?.();
    return existing;
  }
  const editor = new EffectRowEditor({ store, index });
  editor.render(true);
  return editor;
}

/** Close every editor on a store — after a delete or a reorder, no index it holds is still true. */
export async function closeEffectEditors(store) {
  await Promise.all(editorsOn(store.key).map((app) => app.close()));
}

/**
 * The sheet actions over one store of effect rows, mixed into a sheet's
 * `DEFAULT_OPTIONS.actions`. `storeOf(document)` returns the store for the
 * sheet's document; the template's controls carry `data-index`.
 */
export function effectRowActions(storeOf) {
  async function effectAdd() {
    const store = storeOf(this.document);
    const rows = store.read();
    rows.push({ type: store.domain === "spell" ? "damage" : "modifier" });
    const written = (await store.write(rows)) ?? rows;
    openEffectEditor(store, written.length - 1);
  }
  function effectEdit(event, target) {
    openEffectEditor(storeOf(this.document), Number(target.dataset.index));
  }
  async function effectDelete(event, target) {
    const store = storeOf(this.document);
    const index = Number(target.dataset.index);
    const rows = store.read();
    if (!(index >= 0 && index < rows.length)) return;
    const kind = V.EFFECT_TYPES[rows[index].type]?.label ?? rows[index].type ?? "";
    const ok = await foundry.applications.api.DialogV2.confirm({
      classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
      window: { title: loc("deleteTitle") },
      content: `<p>${foundry.utils.escapeHTML(loc("deleteConfirm", { kind }))}</p>`,
      rejectClose: false,
    });
    if (!ok) return;
    await closeEffectEditors(store);
    rows.splice(index, 1);
    await store.write(rows);
  }
  async function move(document, index, delta) {
    const store = storeOf(document);
    const rows = store.read();
    const to = index + delta;
    if (!(index >= 0 && index < rows.length) || to < 0 || to >= rows.length) return;
    await closeEffectEditors(store);
    const [moved] = rows.splice(index, 1);
    rows.splice(to, 0, moved);
    await store.write(rows);
  }
  function effectMoveUp(event, target) {
    return move(this.document, Number(target.dataset.index), -1);
  }
  function effectMoveDown(event, target) {
    return move(this.document, Number(target.dataset.index), 1);
  }
  return { effectAdd, effectEdit, effectDelete, effectMoveUp, effectMoveDown };
}
