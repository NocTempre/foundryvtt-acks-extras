/* global foundry, game, fromUuidSync */
/**
 * The effect-row editor — one window per row of an `effectsField()` list,
 * and the sheet actions that add, open, delete and reorder rows.
 *
 * The sheet shows one line per row and this window edits one row. The window
 * is handed a STORE — `{key, label, domain, read(), write(rows)}` — and every
 * write goes through `store.write`, so the spell primitive and an ability's
 * extras share one editor. The `domain` decides which kinds and subjects the
 * pickers offer (`effectTypesFor`, `effectSubjectsFor`); a stored row keeps
 * its type whatever the picker shows.
 *
 * Edits apply as they are made; there is no Save button. A row is addressed by
 * index, so the sheet closes every editor on the store when it deletes or
 * reorders a row.
 *
 * A modifier or ward row edits its scope: the kinds it applies against, an
 * alignment (a fixed one or the source's) with its mode, and the enemy test. A
 * nested `anyOf` is shown as text and kept exactly as stored on every edit; it
 * is authored by the importer's recipe, not here. A modifier row also edits a
 * light level, which becomes its `light` gate; a row that already carries a
 * gate of another kind shows the select disabled and keeps that gate.
 *
 * A summon row's creature field takes a dropped Actor, from the sidebar or a
 * compendium, as its uuid, and says under it which creature the ref names.
 * A companion row's `ref` is the importer's entry id and takes no drop.
 */
import { MODULE_ID, LANG_PREFIX } from "../constants.mjs";
import * as V from "../vocab.mjs";
import { vocabChoices } from "../magic-vocab.mjs";
import { summonRefName } from "../summons-logic.mjs";
import { byCookbookId } from "../library.mjs";
import { SLOT_VOCAB } from "../proficiency-strip.mjs";
import { LIGHT_LEVELS } from "../light.mjs";

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
  // The fraction of class level a borrowed table is read at, typed as the page
  // writes it. Blank is the whole level.
  atLevelNum: { kind: "number", step: "1", min: "1" },
  atLevelDen: { kind: "number", step: "1", min: "1" },
  domain: { kind: "select", choices: () => V.choicesOf(V.PROFICIENCY_DOMAINS) },
  breadth: { kind: "select", choices: () => V.choicesOf(V.PROFICIENCY_BREADTH) },
  group: { kind: "text" },
  naturalWeapon: { kind: "select", choices: () => V.choicesOf(V.NATURAL_WEAPONS) },
  routine: { kind: "text" },
  condition: { kind: "text" },
  note: { kind: "text" },
  // Scope: the target-side clauses `scopeApplies` decides. `anyOf` is read-only.
  vsKinds: { kind: "list" },
  vsAlignment: { kind: "select", choices: () => V.choicesOf(V.ALIGNMENTS) },
  vsAlignmentOf: { kind: "select", choices: () => V.choicesOf(V.SCOPE_ALIGNMENT_REFERENCES) },
  vsAlignmentMode: { kind: "select", choices: () => V.choicesOf(V.SCOPE_ALIGNMENT_MODES) },
  vsEnemy: { kind: "boolean" },
  anyOf: { kind: "readonly" },
  // A limitation's armour limit, written on the row's `gate`: the rung the worn
  // suit may not exceed and whether a shield breaks it. Setting either marks
  // the row an `armourCeiling` limit (`GATE_KIND`).
  "gate.armourMax": { kind: "select", choices: () => Object.fromEntries(SLOT_VOCAB.armour.map((r) => [r.token, game.i18n.localize(r.label)])) },
  "gate.noShield": { kind: "boolean" },
  // A modifier's light gate: the dimmest level at which the row counts, read at
  // the roll. Shown disabled while the row carries a gate of another kind.
  "gate.light": { kind: "select", choices: () => Object.fromEntries(LIGHT_LEVELS.map((level) => [level, game.i18n.localize(`${LANG_PREFIX}.light.level.${level}`)])) },
};

/** The gate kind a limitation row takes once an armour limit field is set on it. */
const GATE_KIND = "armourCeiling";

/** The gate kind a modifier row takes once a light level is chosen on it. */
const LIGHT_GATE_KIND = "light";

/** The scope fields a modifier or a ward row edits, in the order they are shown. */
const SCOPE_FIELDS = ["vsKinds", "vsAlignment", "vsAlignmentOf", "vsAlignmentMode", "vsEnemy", "anyOf"];

/** Which fields each kind edits, in the order they are shown; the tail is shared. */
const TYPE_FIELDS = {
  modifier: ["appliesTo", "target", "mode", "value", "forWhat", ...SCOPE_FIELDS, "gate.light"],
  ward: ["appliesTo", "value", "range", ...SCOPE_FIELDS],
  attributeSubstitution: ["attribute", "insteadOf", "target"],
  throw: ["forWhat", "roll", "rollType", "value"],
  progressionAs: ["as", "atLevelNum", "atLevelDen"],
  proficiencyGrant: ["domain", "breadth", "group"],
  limitation: ["restriction", "gate.armourMax", "gate.noShield"],
  outcome: ["trigger", "naturalMax", "belowFraction", "consequence"],
  requires: ["refs", "choose"],
  grants: ["refs", "choose"],
  modifies: ["refs", "domain", "target", "mode", "value"],
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
const LIST_FIELDS = new Set(["refs", "vsKinds"]);

/** The fields a row of this type edits. */
export const fieldsForType = (type) => [...(TYPE_FIELDS[type] ?? DEFAULT_FIELDS), ...TAIL_FIELDS];

/**
 * The row an edit makes: the window's fields laid over the stored row, so a
 * field the window does not show keeps what the row holds, and an `anyOf`
 * the window only displays is carried over as stored. Any edit makes the row
 * the Judge's, since a repair replaces the importer's rows (`origin:
 * "register"`) and keeps the others.
 * @param {object} current the stored row
 * @param {object} form the fields the window holds, as `FormDataExtended` reads them
 */
export function mergeRowEdit(current, form) {
  const next = { ...current, ...form };
  if (current.origin) next.origin = "";
  if (current.anyOf !== undefined) next.anyOf = current.anyOf;
  if (form.value && typeof form.value === "object") next.value = { ...(current.value ?? {}), ...form.value };
  // A frequency picked here is the Judge's own: the phrase the importer read
  // for the previous one no longer describes it.
  if ("frequency" in form && form.frequency !== (current.frequency ?? "")) delete next.frequencyText;
  // The gate's fields arrive as a fragment: merged into the row's gate, never
  // over it, and the row keeps its kind or takes the armour limit's once a
  // field of it is set; a row that sets none stays a plain limitation.
  if (form.gate && typeof form.gate === "object" && (current.gate?.kind || form.gate.armourMax || form.gate.noShield)) next.gate = { ...(current.gate ?? {}), ...form.gate, kind: current.gate?.kind || GATE_KIND };
  if (form.gate && typeof form.gate === "object" && "light" in form.gate) {
    const gate = lightGateOf(current.gate, form.gate.light);
    if (gate) next.gate = gate;
    else delete next.gate;
  }
  return next;
}

/**
 * A row's gate once its light level is set or cleared. A level makes the gate
 * a `light` gate; a blank one removes the light gate and leaves whatever else
 * the stored gate holds. A gate of another kind is returned as stored: the
 * light level never replaces it.
 * @param {object|undefined} stored the row's stored gate
 * @param {string} light the chosen level, "" for none
 * @returns {object|undefined} the gate the row now holds, undefined for none
 */
function lightGateOf(stored, light) {
  if (stored?.kind && stored.kind !== LIGHT_GATE_KIND) return stored;
  const rest = { ...(stored ?? {}) };
  delete rest.light;
  if (light) return { ...rest, kind: LIGHT_GATE_KIND, light };
  delete rest.kind;
  return Object.keys(rest).length ? rest : undefined;
}

/**
 * An `anyOf` as the one line the editor shows: each branch's clauses joined,
 * the branches joined by "or". Alignment words come from the lang, never from
 * a stored string.
 * @param {object[]} anyOf the stored branches
 * @param {(key: string, data?: object) => string} say the editor's lang reader, `scope.<key>`
 */
export function anyOfText(anyOf, say) {
  const branchText = (branch) => {
    const parts = [];
    if (branch.vsEnemy === true) parts.push(say("scope.enemy"));
    if (branch.vsKinds?.length) parts.push(say("scope.kinds", { kinds: [...branch.vsKinds].join(", ") }));
    const except = branch.vsAlignmentMode === "except";
    if (branch.vsAlignmentOf === "source") parts.push(say(except ? "scope.sourceExcept" : "scope.source"));
    if (branch.vsAlignment) parts.push(say(except ? "scope.alignmentExcept" : "scope.alignment", { alignment: V.ALIGNMENTS[branch.vsAlignment]?.label ?? branch.vsAlignment }));
    return parts.join(" · ");
  };
  return (anyOf ?? []).map(branchText).join(` ${say("scope.or")} `);
}

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
    context.fields = fieldsForType(row.type).filter((name) => name !== "anyOf" || row.anyOf?.length).map((name) => {
      const spec = FIELD_SPECS[name] ?? { kind: "text" };
      const value = foundry.utils.getProperty(row, name);
      const field = { name, kind: spec.kind, label: loc(`field.${name}`) };
      if (spec.kind === "readonly") {
        field.text = anyOfText(value, loc);
      } else if (spec.kind === "boolean") {
        field.checked = value === true;
      } else if (spec.kind === "select") {
        field.choices = spec.choices(domain);
        field.value = value ?? "";
      } else if (spec.kind === "set") {
        const have = new Set([...(value ?? [])]);
        field.options = Object.entries(spec.choices()).map(([key, label]) => ({ key, label, checked: have.has(key) }));
      } else if (spec.kind === "levelValue") {
        // A bare number is a valid flat value; it is shown in the flat box.
        const v = typeof value === "number" ? { kind: "flat", flat: value } : (value ?? {});
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
        if (spec.kind === "number") {
          field.step = spec.step ?? "any";
          field.min = spec.min ?? "";
        }
        if (spec.list) field.list = Object.entries(spec.list()).map(([key, label]) => ({ key, label }));
      }
      if (name === "gate.light") {
        field.disabled = Boolean(row.gate?.kind) && row.gate.kind !== LIGHT_GATE_KIND;
        field.tip = loc(field.disabled ? "lightLocked" : "lightTip");
      }
      if (name === "ref" && row.type === "summon") {
        field.drop = true;
        const named = field.value ? summonRefName(field.value, { fromUuidSync: (uuid) => fromUuidSync(uuid), byCookbookId }) : null;
        field.refLine = !field.value ? "" : named ? loc("refNames", { name: named }) : loc("refUnknown");
      }
      return field;
    });
    return context;
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    for (const group of this.element?.querySelectorAll?.("[data-acks-extras-ref-drop]") ?? []) {
      group.addEventListener("dragover", (event) => event.preventDefault());
      group.addEventListener("drop", (event) => this.#onDropRef(event, group));
    }
  }

  /** A dropped Actor becomes the row's creature, by uuid; anything else is ignored. */
  async #onDropRef(event, group) {
    event.preventDefault();
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (data?.type !== "Actor" || !data.uuid) return;
    const input = group.querySelector('input[name="ref"]');
    if (!input) return;
    input.value = data.uuid;
    await this.#apply();
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
    rows[this.index] = mergeRowEdit(current, form);
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
