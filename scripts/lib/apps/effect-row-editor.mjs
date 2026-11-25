/* global foundry, game, fromUuid, fromUuidSync, ui */
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
 * Edits apply as they are made. A row is addressed by index, so the sheet closes
 * every editor on the store when it deletes or reorders a row. The one exception
 * is a figure on the invocation scale: a spell's kind switch (a button group)
 * offers "By invocation level", and the rungs of the ladder it holds are edited
 * inline and kept as a draft until the pinned footer's "Save row", which writes
 * every changed ladder of the row at once. A figure that is no ladder, and every
 * other field, keeps applying on change. A Player sees the rungs read-only, with
 * no footer (`rung-view.mjs`).
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
 *
 * In a spell, a summon row's `ref` and `amount` give way to the list of the
 * creatures the spell may call (`lib/summon-list.mjs`): the summon rows that
 * share the open row's invocation band, format and control, one line each with
 * its creature, where it is from, a Number box and Remove, and under them the
 * drop zone and a uuid box with Add. The list is edited as rows: a Number box
 * writes its row's `amount`, and Add and Remove change the row list, so they
 * close every editor on the store and reopen this row at its new index. Each
 * creature reads as the seat can open it: a seat with no Observer on it reads
 * the neutral label and no source, never the name or the ref. The boxes carry
 * no `name`, so the form never submits them; a Number box writes through
 * `writeOnChange`, and a press on Add or Remove folds the other boxes' typed
 * figures into its own write.
 *
 * A spell row's cast behaviour is edited here too: what a passed save does
 * (`saveEffect`), the attack throw it waits on (`delivery`), whether it lasts
 * or repeats (with where a repeat resolves, what its bearer throws first and
 * who it meets), the choice group it belongs to and its option within it
 * (`pick`, `pickOption`), the ceiling on an instance count (`max`), the
 * rounds a `rounds` lasting counts, the size at which a target is exempt, and
 * the reversed form (`reversed`). A spell's modifier row edits what narrows it
 * beyond its scope: the attack kinds it answers, the creature kind the caster
 * picks (`pickKind`), whether it is on the spell's own save (`ownSave`), and a
 * status gate (`gate.status`, `gate.occasion`), shown disabled under a gate of
 * another kind like the light level. A condition row also edits what ends its
 * record (`endsOn`), the conditions written with no clock (`untimed`, offered
 * from the row's own conditions) and the size strictly above which a target is
 * exempt. A tracked kind (`TRACKED_KINDS`) edits `lasts` as the spell's
 * duration or the instant, and the delayed affliction picks the effects it
 * holds back (`effects`). A spellcasting row edits its target, figure and the words it narrows
 * on. A store that names a `cite` (the page the row is read from) puts it in
 * the tooltip of a located figure left blank. `extraordinary` is nullable, since a capture that read none is
 * not a "no": its select offers unset, yes and no, and unset stores null. A
 * row's `key` is shown and never edited.
 */
import { MODULE_ID, LANG_PREFIX, TEMPLATE_TYPE } from "../constants.mjs";
import * as V from "../vocab.mjs";
import { vocabChoices } from "../magic-vocab.mjs";
import { SUMMON_SOURCE_TYPES, packIdOfUuid, summonRefName } from "../summons-logic.mjs";
import { addSummonCreature, amountFromBox, amountTip, creatureView, removeSummonCreature, resolveCreature, summonListOf } from "../summon-list.mjs";
import { writeOnChange } from "../press-safe-change.mjs";
import { byCookbookId } from "../library.mjs";
import { SLOT_VOCAB } from "../proficiency-strip.mjs";
import { LIGHT_LEVELS } from "../light.mjs";
import { ATTACK_KINDS } from "../conditions.mjs";
import { ENDS_ON_CAUSES } from "../ends-on.mjs";
import { RungDrafts, isInvocationLadder, withKindChoice } from "../rung-ladder.mjs";
import { RUNG_ACTIONS, actionsContext, isJudge, kindAllowed, kindContext, ladderContext, wireRungs } from "../rung-view.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

const loc = (key, data) => game.i18n.format(`${LANG_PREFIX}.effectEditor.${key}`, data ?? {});

const RUNG_LADDER = `modules/${MODULE_ID}/templates/lib/rung-ladder.hbs`;
const FIGURE_KIND = `modules/${MODULE_ID}/templates/lib/figure-kind.hbs`;
const RUNG_ACTIONS_PARTIAL = `modules/${MODULE_ID}/templates/lib/rung-actions.hbs`;

/**
 * How each field of `effectField()` is edited. `set` renders one box per
 * member; `levelValue` the flat / per-level pair; `list` a comma line.
 */
const FIELD_SPECS = {
  appliesTo: { kind: "select", choices: (domain) => V.choicesOf(V.effectSubjectsFor(domain)) },
  // A spellcasting row's target is one of the caster's three figures; every other row's a modifier target.
  target: { kind: "text", list: (domain, row) => (row?.type === "spellcastingMod" ? bucketChoices() : V.choicesOf(V.MODIFIER_TARGETS)) },
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
  controlEnd: { kind: "select", choices: () => vocabChoices("controlEnd") },
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
  key: { kind: "readonly" },
  saveEffect: { kind: "select", choices: () => vocabChoices("saveEffect") },
  delivery: { kind: "select", choices: () => vocabChoices("effectDelivery") },
  extraordinary: { kind: "select", choices: () => ({ true: loc("field.extraordinaryYes"), false: loc("field.extraordinaryNo") }) },
  lasts: { kind: "select", choices: (domain, row) => lastsChoices(row) },
  recur: { kind: "select", choices: () => vocabChoices("effectRecur") },
  recurAt: { kind: "select", choices: () => vocabChoices("effectRecurMoment") },
  recurSave: { kind: "select", choices: () => vocabChoices("effectRecurSave") },
  recurTarget: { kind: "select", choices: () => vocabChoices("effectRecurTarget") },
  // The dice a `rounds` lasting counts: a formula the importer reads from the page.
  rounds: { kind: "text" },
  // A monsters size key, offered from the size vocabulary where the client has it; free text keeps any stored key.
  exemptSizeFrom: { kind: "text", list: () => sizeChoices() },
  // The size key a target must be strictly above to be exempt, beside the at-or-above one.
  exemptSizeOver: { kind: "text", list: () => sizeChoices() },
  // A modifier on the saving throw made against the spell itself.
  ownSave: { kind: "boolean" },
  // A modifier whose creature kind the caster picks at the cast, from the row's `vsKinds`.
  pickKind: { kind: "boolean" },
  // The kinds of attack made against the bearer that a row narrows to; blank is every kind.
  attackKinds: { kind: "set", choices: () => Object.fromEntries(ATTACK_KINDS.map((kind) => [kind, loc(`attackKind.${kind}`)])) },
  // What ends the record a row writes: the bearer's hurt or the bearer's own attack.
  endsOn: { kind: "set", choices: () => Object.fromEntries(ENDS_ON_CAUSES.map((cause) => [cause, loc(`endsOn.${cause}`)])) },
  // The row's own conditions that are written with no clock; offered only once the row lists a condition.
  untimed: { kind: "set", hideEmpty: true, choices: (domain, row) => untimedChoices(row) },
  ifHas: { kind: "list" },
  appliesToRoll: { kind: "text" },
  // What a spellcasting row narrows on: authored words, a comma line each.
  schools: { kind: "list" },
  elements: { kind: "list" },
  saveCategories: { kind: "list" },
  bySelection: { kind: "boolean" },
  perDie: { kind: "boolean" },
  max: { kind: "levelValue" },
  pick: { kind: "text" },
  pickOption: { kind: "text" },
  // The invocation levels a row applies at, both inclusive; a blank side is open.
  invocationFrom: { kind: "number", step: "1" },
  invocationTo: { kind: "number", step: "1" },
  reversed: { kind: "boolean" },
  stacksWith: { kind: "list" },
  notStacksWith: { kind: "list" },
  // A limitation's armour limit, written on the row's `gate`: the rung the worn
  // suit may not exceed and whether a shield breaks it. Setting either marks
  // the row an `armourCeiling` limit (`GATE_KIND`).
  "gate.armourMax": { kind: "select", choices: () => Object.fromEntries(SLOT_VOCAB.armour.map((r) => [r.token, game.i18n.localize(r.label)])) },
  "gate.noShield": { kind: "boolean" },
  // A modifier's light gate: the dimmest level at which the row counts, read at
  // the roll. Shown disabled while the row carries a gate of another kind.
  "gate.light": { kind: "select", choices: () => Object.fromEntries(LIGHT_LEVELS.map((level) => [level, game.i18n.localize(`${LANG_PREFIX}.light.level.${level}`)])) },
  // A modifier's status gate: the status the bearer must carry, and whether it
  // holds only where the roll names that occasion. Disabled under another kind of gate.
  "gate.status": { kind: "text", list: () => V.choicesOf(V.CONDITION_KEYS) },
  "gate.occasion": { kind: "boolean" },
};

/** The three figures of a spellcasting row's `target`, each with the lang label it is offered under. */
function bucketChoices() {
  return Object.fromEntries(SPELLCASTING_TARGETS.map((key) => [key, loc(`bucket.${key}`)]));
}

/**
 * The spell kinds the cast tracks without computing them (a card line and a
 * record, `magic/cast-kinds.mjs` `APPLY_KINDS`), which the library cannot
 * import from the feature above it. Their row edits `lasts` as a choice of the
 * spell's duration or the instant of the cast; `afflictionDelay` also names
 * the effects it holds back, and `purify` is left out since it ends at the
 * cast and keeps its quantity field.
 */
const TRACKED_KINDS = ["transform", "wall", "detect", "dispel", "illusion", "light", "teleport", "createObject", "structural", "curse", "afflictionDelay", "seal"];

/** The `lasts` values a tracked kind's select offers, in the order shown. */
const TRACKED_LASTS = ["duration", "instant"];

/** Is this row a tracked kind whose `lasts` select is the short one? */
const isTrackedRow = (row) => TRACKED_KINDS.includes(row?.type);

/**
 * The choices of a row's `lasts`: a tracked kind offers the spell's duration
 * and the instant, under words that name the record; any other kind offers the
 * whole vocabulary. A stored value outside the short list stays selectable, or
 * the select would fall to blank and the next change rewrite it.
 */
function lastsChoices(row) {
  const all = vocabChoices("effectLasts");
  if (!isTrackedRow(row)) return all;
  const choices = Object.fromEntries(TRACKED_LASTS.map((key) => [key, loc(`lastsTracked.${key}`)]));
  if (row.lasts && !choices[row.lasts]) choices[row.lasts] = all[row.lasts] ?? row.lasts;
  return choices;
}

/** The conditions a row may write with no clock: the ones it lists, and any the row already stores. */
function untimedChoices(row) {
  const keys = new Set([...(row?.conditions ?? []), ...(row?.untimed ?? [])]);
  return Object.fromEntries([...keys].map((key) => [key, V.CONDITION_KEYS[key]?.label ?? key]));
}

/**
 * The size keys a size field offers, `{key: label}`. Lib sits below the
 * monsters feature, so the vocabulary is read off the feature's published
 * config when it is there and is empty otherwise; the field is free text
 * either way.
 */
function sizeChoices() {
  const sizes = globalThis.acksExtras?.monsters?.config?.SIZES ?? {};
  return Object.fromEntries(Object.entries(sizes).map(([key, v]) => [key, game.i18n.localize(v.label ?? key)]));
}

/** The gate kind a limitation row takes once an armour limit field is set on it. */
const GATE_KIND = "armourCeiling";

/** The gate kind a modifier row takes once a light level is chosen on it. */
const LIGHT_GATE_KIND = "light";

/** The figures a spellcasting row's `target` names; `magic/cast-abilities.mjs` `ABILITY_BUCKETS` is the reader. */
const SPELLCASTING_TARGETS = ["casterLevel", "save", "damage"];

/** The gate kind a modifier row takes once a status is named on it. */
const STATUS_GATE_KIND = "status";

/** The page reference the store names for its row, where it names one: a string or a function of nothing. */
function citeOfStore(store) {
  const cite = typeof store?.cite === "function" ? store.cite() : store?.cite;
  return typeof cite === "string" ? cite.trim() : "";
}

/** The scope fields a modifier or a ward row edits, in the order they are shown. */
const SCOPE_FIELDS = ["vsKinds", "vsAlignment", "vsAlignmentOf", "vsAlignmentMode", "vsEnemy", "anyOf"];

/** The fields of a kind with no entry of its own in `TYPE_FIELDS`. */
const DEFAULT_FIELDS = ["appliesTo", "value", "range"];

/** Which fields each kind edits, in the order they are shown; the tail is shared. */
const TYPE_FIELDS = {
  // A modifier's tail groups what narrows it: scope, the kind the caster picks, the attack kinds, then the gates.
  modifier: ["appliesTo", "target", "mode", "value", "forWhat", "ownSave", "stacksWith", "notStacksWith", "ifHas", ...SCOPE_FIELDS, "pickKind", "attackKinds", "gate.light", "gate.status", "gate.occasion", "endsOn"],
  ward: ["appliesTo", "value", "range", "saveEffect", ...SCOPE_FIELDS, "endsOn"],
  attributeSubstitution: ["attribute", "insteadOf", "target"],
  throw: ["forWhat", "roll", "rollType", "value"],
  progressionAs: ["as", "atLevelNum", "atLevelDen"],
  proficiencyGrant: ["domain", "breadth", "group"],
  limitation: ["restriction", "gate.armourMax", "gate.noShield"],
  outcome: ["trigger", "naturalMax", "belowFraction", "consequence"],
  requires: ["refs", "choose"],
  grants: ["refs", "choose", "appliesTo", "mode", "value", "atLevelNum", "atLevelDen"],
  modifies: ["refs", "domain", "target", "mode", "value", "appliesTo", "appliesToRoll", "ifHas"],
  reroll: ["forWhat", "target", "keep", "times"],
  companion: ["ref", "amount"],
  immunity: ["appliesTo", "damage", "effects", "conditions"],
  resistance: ["appliesTo", "damage", "effects", "conditions"],
  susceptibility: ["appliesTo", "damage", "effects", "conditions"],
  sense: ["appliesTo", "sense", "vision", "range"],
  movement: ["appliesTo", "movementMode", "value"],
  naturalAttack: ["naturalWeapon", "routine"],
  spellLike: ["spell", "frequency", "castingTime"],
  spellcastingMod: ["target", "value", "school", "casterLevelDelta", "schools", "elements", "bySelection", "saveCategories", "perDie", "stacksWith", "notStacksWith", "ifHas"],
  resource: ["resource", "action", "amount"],
  conditionGrant: ["appliesTo", "conditions", "saveEffect", "lasts", "rounds", "untimed", "endsOn", "recur", "recurAt", "recurSave", "recurTarget", "exemptSizeFrom", "exemptSizeOver", "reversed"],
  conditionRemove: ["appliesTo", "conditions"],
  ignite: ["appliesTo", "lasts", "rounds", "endsOn", "reversed"],
  economic: ["amount", "unit", "period"],
  capability: ["frequency", "restriction"],
  damage: ["appliesTo", "roll", "damage", "value", "max", "saveEffect", "delivery", "extraordinary", "recur", "recurAt", "recurSave", "recurTarget", "exemptSizeFrom", "exemptSizeOver", "reversed"],
  heal: ["appliesTo", "healKind", "roll", "value", "max", "saveEffect", "reversed"],
  summon: ["summonFormat", "ref", "amount", "value", "control", "controlEnd"],
  control: ["appliesTo", "control"],
  // Neither kind reads a figure: a save decides whether it lands, and `appliesTo` names who it meets.
  slay: ["appliesTo", "saveEffect", "reversed"],
  destroyItem: ["appliesTo", "saveEffect", "reversed"],
  // A delayed affliction names the effects it holds back for as long as it lasts.
  afflictionDelay: ["appliesTo", "effects", "lasts"],
  // The other tracked kinds keep the default figure fields and add how long the record stands.
  ...Object.fromEntries(TRACKED_KINDS.filter((kind) => kind !== "afflictionDelay").map((kind) => [kind, [...DEFAULT_FIELDS, "lasts"]])),
};
const TAIL_FIELDS = ["condition", "note"];
const SET_FIELDS = new Set(["damage", "effects", "conditions", "attackKinds", "endsOn", "untimed"]);
const LIST_FIELDS = new Set(["refs", "vsKinds", "stacksWith", "notStacksWith", "ifHas", "schools", "elements", "saveCategories"]);
/** The fields edited as a level value, which a merge lays over the stored one rather than replacing. */
const LEVEL_VALUE_FIELDS = ["value", "max"];

/** The choice group a row belongs to and its option within it: offered on every kind a spell's row can be. */
const PICK_FIELDS = ["pick", "pickOption"];

/** The invocation levels a spell's row applies at, offered beside the pick fields on every kind a spell's row can be. */
const INVOCATION_FIELDS = ["invocationFrom", "invocationTo"];

/** The fields whose control carries a tooltip saying what the field does; each reads `tip.<name>`. */
const TIPPED_FIELDS = new Set([
  "key", "saveEffect", "delivery", "extraordinary", "lasts", "recur", "pick", "reversed", "stacksWith", "notStacksWith",
  "max", "pickOption", "recurAt", "recurSave", "recurTarget", "rounds", "exemptSizeFrom",
  "exemptSizeOver", "ownSave", "pickKind", "attackKinds", "endsOn", "untimed", "ifHas", "appliesToRoll",
  "schools", "elements", "bySelection", "saveCategories", "perDie", "gate.occasion",
  "invocationFrom", "invocationTo", "controlEnd",
]);

/** The located figures: while one is blank its tooltip carries the page reference of the store's row, when the store names one. */
const LOCATED_FIELDS = new Set(["rounds", "exemptSizeFrom", "exemptSizeOver"]);

/** The fields only a spell's row edits: what a cast does with the row, which no ability row has. */
const SPELL_ONLY_FIELDS = new Set([
  "saveEffect", "delivery", "extraordinary", "lasts", "recur", "pick", "reversed",
  "max", "pickOption", "recurAt", "recurSave", "recurTarget", "rounds", "exemptSizeFrom", "stacksWith",
  "exemptSizeOver", "ownSave", "pickKind", "endsOn", "untimed", "controlEnd", ...INVOCATION_FIELDS,
]);

/** What a spell-only field is still offered on, outside a spell: an ability's spellcasting row stacks by it. */
const ABILITY_KEEPS = { spellcastingMod: new Set(["stacksWith"]) };

/** The fields a row of this type edits in a store of this domain; outside a spell the cast's fields are left out. */
export const fieldsForType = (type, domain = "spell") => [
  ...new Set([...(TYPE_FIELDS[type] ?? DEFAULT_FIELDS), ...PICK_FIELDS, ...INVOCATION_FIELDS, ...TAIL_FIELDS].filter((name) => domain === "spell" || !SPELL_ONLY_FIELDS.has(name) || ABILITY_KEEPS[type]?.has(name))),
];

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
  // The row's key names it for a repair and is never an edit; an unset mark is null, not a "no".
  if (current.key !== undefined) next.key = current.key;
  if ("extraordinary" in form) next.extraordinary = form.extraordinary === true || form.extraordinary === "true" ? true : form.extraordinary === false || form.extraordinary === "false" ? false : null;
  // A level value arrives as the fragment its controls hold, merged into the stored one
  // so a ladder the controls do not show keeps its rungs. The kind switch's invocation
  // choice becomes the conditional on that scale (`withKindChoice`).
  for (const name of LEVEL_VALUE_FIELDS) {
    if (form[name] && typeof form[name] === "object") next[name] = { ...(current[name] ?? {}), ...withKindChoice(current[name], form[name]) };
  }
  // A frequency picked here is the Judge's own: the phrase the importer read
  // for the previous one no longer describes it.
  if ("frequency" in form && form.frequency !== (current.frequency ?? "")) delete next.frequencyText;
  // The gate's fields arrive as a fragment: merged into the row's gate, never
  // over it, and the row keeps its kind or takes the armour limit's once a
  // field of it is set; a row that sets none stays a plain limitation.
  // The status gate's fields are set apart: they never ride into another kind's gate.
  const { status, occasion, ...fragment } = form.gate && typeof form.gate === "object" ? form.gate : {};
  if (form.gate && typeof form.gate === "object" && (current.gate?.kind || fragment.armourMax || fragment.noShield)) next.gate = { ...(current.gate ?? {}), ...fragment, kind: current.gate?.kind || GATE_KIND };
  if (form.gate && typeof form.gate === "object" && "light" in fragment) {
    const gate = lightGateOf(current.gate, fragment.light);
    if (gate) next.gate = gate;
    else delete next.gate;
  }
  if (form.gate && typeof form.gate === "object" && "status" in form.gate) {
    const gate = statusGateOf(next.gate, status, occasion);
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
 * A row's gate once its status is named or cleared. A status makes the gate a
 * `status` gate, carrying `occasion` only while it is on; a blank one removes
 * the status gate and leaves whatever else the stored gate holds. A gate of
 * another kind is returned as stored: a status never replaces it.
 * @param {object|undefined} stored the row's gate so far
 * @param {string} status the status id, "" for none
 * @param {boolean} occasion whether the gate holds only where the roll names its status
 * @returns {object|undefined} the gate the row now holds, undefined for none
 */
function statusGateOf(stored, status, occasion) {
  if (stored?.kind && stored.kind !== STATUS_GATE_KIND) return stored;
  const rest = { ...(stored ?? {}) };
  delete rest.status;
  delete rest.occasion;
  const named = String(status ?? "").trim();
  if (named) return { ...rest, kind: STATUS_GATE_KIND, status: named, ...(occasion === true || occasion === "true" ? { occasion: true } : {}) };
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

/** The Number boxes whose typed figure a write has already taken, so the press-held write that follows it does nothing. */
const taken = new WeakSet();

/** The compendium a uuid is in, from the world's pack registry; null with none. */
const worldPackOf = (uuid) => game.packs?.get?.(packIdOfUuid(uuid)) ?? null;

/** A stored `amount` as a Number box compares it: blank is null. */
const storedAmount = (value) => (String(value ?? "").trim() === "" ? null : Number(value));

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
    actions: { ...RUNG_ACTIONS, figureKind: EffectRowEditor.#onFigureKind, summonAdd: EffectRowEditor.#onSummonAdd, summonRemove: EffectRowEditor.#onSummonRemove },
  };

  // The body is the scroller and the footer a part of its own, so the rungs' Save row stays pinned below the fields.
  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/lib/effect-row-editor.hbs`, templates: [RUNG_LADDER, FIGURE_KIND], scrollable: [""] },
    footer: { template: `modules/${MODULE_ID}/templates/lib/rung-footer.hbs`, templates: [RUNG_ACTIONS_PARTIAL] },
  };

  /**
   * The rungs of this row's ladders as drafts, keyed by field (`value`, `max`).
   * They live on the window, apart from the form, so a redraw after any other
   * field's write keeps them; closing the window drops them.
   */
  rungs = new RungDrafts({ read: (field) => foundry.utils.getProperty(this.store.read()[this.index] ?? {}, field), editable: isJudge });

  /** The type the window rendered with, so a change event reads the fields that are on screen. */
  #shownType = null;

  /** Set once the window is closing: a write held from a press waits for nothing after it. */
  #gone = false;

  /** @override */
  async close(options) {
    this.#gone = true;
    return super.close(options);
  }

  /** @override — a box of the creature list is written by the list, never by the form's submit. */
  _onChangeForm(formConfig, event) {
    if (event?.target?.closest?.("[data-acks-extras-summon-list]")) return;
    return super._onChangeForm(formConfig, event);
  }

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
    // A spell's summon row lists its creatures in one block where `ref` stood, and its number rides on each line.
    const listed = domain === "spell" && row.type === "summon";
    const names = [...(row.key ? ["key"] : []), ...fieldsForType(row.type, domain)].filter((name) => !(listed && name === "amount"));
    const cite = citeOfStore(this.store);
    // The row's ladders, in the order shown: one Save row writes every changed one.
    const ladders = domain === "spell" ? names.filter((name) => FIELD_SPECS[name]?.kind === "levelValue" && isInvocationLadder(foundry.utils.getProperty(row, name))) : [];
    context.fields = names.filter((name) => name !== "anyOf" || row.anyOf?.length).map((name) => {
      if (listed && name === "ref") return { name, kind: "creatures", label: loc("creatures"), lines: this.#creatureLines(cite) };
      const spec = FIELD_SPECS[name] ?? { kind: "text" };
      const value = foundry.utils.getProperty(row, name);
      const field = { name, kind: spec.kind, label: loc(`field.${name}`) };
      if (spec.kind === "readonly") {
        field.text = name === "anyOf" ? anyOfText(value, loc) : String(value ?? "");
      } else if (spec.kind === "boolean") {
        field.checked = value === true;
      } else if (spec.kind === "select") {
        field.choices = spec.choices(domain, row);
        field.value = typeof value === "boolean" ? String(value) : (value ?? "");
      } else if (spec.kind === "set") {
        const have = new Set([...(value ?? [])]);
        field.options = Object.entries(spec.choices(domain, row)).map(([key, label]) => ({ key, label, checked: have.has(key) }));
      } else if (spec.kind === "levelValue") {
        // A bare number is a valid flat value; it is shown in the flat box.
        const v = typeof value === "number" ? { kind: "flat", flat: value } : (value ?? {});
        const kind = v.kind || "flat";
        field.value = v;
        // An ability's switch has no invocation choice, so a ladder on that scale there is shown as the kind it is stored under.
        field.isInvocation = domain === "spell" && isInvocationLadder(v);
        field.isFlat = kind === "flat";
        field.isPerLevel = kind === "perLevel";
        field.kindGroup = kindContext(name, field.label, v, { invocation: domain === "spell", field: name });
        field.rounds = V.choicesOf(V.VALUE_ROUNDING);
        if (field.isInvocation) field.ladder = ladderContext(this.rungs, name, { group: "row", keys: ladders, cite, idBase: this.id });
      } else if (spec.kind === "list") {
        field.value = [...(value ?? [])].join(", ");
      } else {
        field.value = value ?? "";
        if (spec.kind === "number") {
          field.step = spec.step ?? "any";
          field.min = spec.min ?? "";
        }
        if (spec.list) field.list = Object.entries(spec.list(domain, row)).map(([key, label]) => ({ key, label }));
      }
      if (TIPPED_FIELDS.has(name)) field.tip = loc(`tip.${name}`);
      // A located figure left blank carries the page it is read from, and no figure.
      if (LOCATED_FIELDS.has(name) && cite && !String(field.value ?? "").trim()) field.tip = [field.tip, loc("tip.cite", { cite })].join(" · ");
      // A tracked kind's tooltips name what the field does to its record, and carry the store's page where it names one.
      if (name === "lasts" && isTrackedRow(row)) field.tip = [loc("tip.lastsTracked"), cite && loc("tip.cite", { cite })].filter(Boolean).join(" · ");
      // The end of a summons' control names the store's page beside the chapter the tooltip cites.
      if (name === "controlEnd" && cite) field.tip = [field.tip, loc("tip.cite", { cite })].join(" · ");
      if (name === "effects" && row.type === "afflictionDelay") field.tip = [loc("tip.effectsDelay"), cite && loc("tip.cite", { cite })].filter(Boolean).join(" · ");
      if (name === "gate.light") {
        field.disabled = Boolean(row.gate?.kind) && row.gate.kind !== LIGHT_GATE_KIND;
        field.tip = loc(field.disabled ? "lightLocked" : "lightTip");
      }
      if (name === "gate.status" || name === "gate.occasion") {
        field.disabled = Boolean(row.gate?.kind) && row.gate.kind !== STATUS_GATE_KIND;
        field.tip = loc(field.disabled ? "statusLocked" : name === "gate.status" ? "statusTip" : "tip.gate.occasion");
      }
      if (name === "ref" && row.type === "summon") {
        field.drop = true;
        const named = field.value ? summonRefName(field.value, { fromUuidSync: (uuid) => fromUuidSync(uuid), byCookbookId }) : null;
        field.refLine = !field.value ? "" : named ? loc("refNames", { name: named }) : loc("refUnknown");
      }
      return field;
    });
    // A set offering nothing (conditions the row does not list) is left off the window.
    context.fields = context.fields.filter((field) => !(FIELD_SPECS[field.name]?.hideEmpty && !field.options?.length));
    context.footer = { show: ladders.length > 0 && isJudge(), ...actionsContext(this.rungs, { group: "row", keys: ladders, idBase: this.id, saveLabel: "saveRow" }) };
    return context;
  }

  /**
   * One line per creature of the open row's list, as this seat reads it. A row
   * that names no creature reads as the empty list does and keeps its Number
   * box; Remove is offered on a line that names a creature and on any line of
   * a list of more than one.
   */
  #creatureLines(cite) {
    const rows = this.store.read();
    const list = summonListOf(rows, this.index);
    const lookups = { fromUuidSync: (uuid) => fromUuidSync(uuid), byCookbookId };
    const seat = { resolve: (ref) => resolveCreature(ref, lookups), user: game.user, packOf: worldPackOf, neutral: game.i18n.localize("ACKS-LIB.summons.neutral") };
    const from = (source) => {
      if (source?.kind === "pack") return game.packs?.get?.(source.pack)?.title ?? source.pack;
      if (source?.kind === "world") return loc("worldActor");
      return source?.kind === "unknown" ? loc("refUnknown") : "";
    };
    return list.map((at) => {
      const row = rows[at];
      const seen = creatureView(row, seat);
      const label = seen.blank ? loc("noCreature") : seen.label;
      return {
        index: at,
        blank: seen.blank,
        label,
        source: from(seen.source),
        note: seen.opens ? "" : game.i18n.localize("ACKS-LIB.summons.refused.unreadable"),
        amount: row.amount ?? "",
        tip: amountTip(row, { cite, say: loc }),
        amountAria: loc("amountOf", { name: label }),
        removeAria: loc("remove", { name: label }),
        removable: !seen.blank || list.length > 1,
      };
    });
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    wireRungs(this);
    for (const group of this.element?.querySelectorAll?.("[data-acks-extras-ref-drop]") ?? []) {
      group.addEventListener("dragover", (event) => event.preventDefault());
      group.addEventListener("drop", (event) => this.#onDropRef(event, group));
    }
    for (const list of this.element?.querySelectorAll?.("[data-acks-extras-summon-list]") ?? []) this.#wireCreatureList(list);
  }

  /**
   * The creature list's listeners. Its block is replaced on every render, so
   * binding on it never stacks. Enter in the uuid box adds and never submits.
   */
  #wireCreatureList(list) {
    list.addEventListener("dragover", (event) => event.preventDefault());
    list.addEventListener("drop", (event) => this.#onDropCreature(event));
    list.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || !event.target?.matches?.("[data-summon-add]")) return;
      event.preventDefault();
      return this.#addTyped();
    });
    writeOnChange(list, (field) => this.#writeAmount(field));
  }

  /**
   * An Actor or a Token dropped on the list is added as a creature, as the
   * cast window reads a drop on its summon band: an unlinked token's creature
   * is its base actor, and only a creature type a summon is made from, or a
   * family, is taken. A creature this seat cannot open is listed under the
   * neutral label and refused at the cast, so no ownership check is made here.
   */
  async #onDropCreature(event) {
    event.preventDefault();
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (!data?.uuid || (data.type !== "Actor" && data.type !== "Token")) return;
    const found = await fromUuid(data.uuid).catch(() => null);
    const actor = data.type === "Token" ? (found?.actorLink ? found.actor : (found?.baseActor ?? found?.actor ?? null)) : found;
    if (!actor) return;
    if (actor.documentName !== "Actor" || ![...SUMMON_SOURCE_TYPES, TEMPLATE_TYPE].includes(actor.type)) {
      ui.notifications?.warn(game.i18n.localize("ACKS-LIB.summons.refused.badSource"));
      return;
    }
    await this.#addCreature(actor.uuid);
  }

  /** Add what the uuid box holds. */
  async #addTyped() {
    const box = this.element?.querySelector?.("[data-summon-add]");
    await this.#addCreature(box?.value ?? "");
  }

  /**
   * The typed figure of every Number box laid over its row, in `rows`: one
   * write then carries them with the change a press makes.
   * @returns {boolean} whether a row changed
   */
  #takeAmounts(rows) {
    let changed = false;
    for (const box of this.element?.querySelectorAll?.("[data-summon-amount]") ?? []) {
      const row = rows[Number(box.dataset.index)];
      const amount = amountFromBox(box.value);
      if (amount === undefined || row?.type !== "summon" || storedAmount(row.amount) === amount) continue;
      rows[Number(box.dataset.index)] = mergeRowEdit(row, { amount });
      changed = true;
    }
    return changed;
  }

  /**
   * Mark every Number box as written by the press that is about to write the
   * rows, before its first await: the write a box's own change event holds runs
   * on the next task and must find it taken.
   */
  #markTaken() {
    for (const box of this.element?.querySelectorAll?.("[data-summon-amount]") ?? []) taken.add(box);
  }

  /**
   * Write the figure a Number box changed to its own row. A box a write has
   * taken, or one in a window that has closed, writes nothing: its row index
   * may mean another row by now. A box left behind by a redraw writes what it
   * holds, since the redraw changed no index.
   */
  async #writeAmount(field) {
    if (this.#gone || taken.has(field) || !field?.matches?.("[data-summon-amount]")) return;
    const rows = this.store.read();
    const at = Number(field.dataset.index);
    const amount = amountFromBox(field.value);
    const row = rows[at];
    if (amount === undefined || row?.type !== "summon" || storedAmount(row.amount) === amount) return;
    rows[at] = mergeRowEdit(row, { amount });
    await this.store.write(rows);
    this.render();
  }

  /**
   * Add a creature to the list: the rows change, every editor on the store
   * closes, and this row opens again at its index. A blank or repeated ref adds
   * nothing, and a Number box typed into meanwhile is still written.
   */
  async #addCreature(ref) {
    const rows = this.store.read();
    const typed = this.#takeAmounts(rows);
    const out = addSummonCreature(rows, this.index, ref, { newKey: () => `_${foundry.utils.randomID(8)}` });
    if (!out.added && !typed) return;
    this.#markTaken();
    if (!out.added) {
      await this.store.write(rows);
      this.render();
      return;
    }
    await this.#rewrite(out.rows, out.index);
  }

  /** Write a changed row list, close the store's editors (their indexes are stale) and open this row at its new place. */
  async #rewrite(rows, index, options) {
    const { store } = this;
    await closeEffectEditors(store);
    await store.write(rows, options);
    openEffectEditor(store, index);
  }

  static async #onSummonAdd() {
    await this.#addTyped();
  }

  /** Remove a line from the list; the row that went is handed to the store, so a register's row is retired. */
  static async #onSummonRemove(event, target) {
    const rows = this.store.read();
    const typed = this.#takeAmounts(rows);
    const out = removeSummonCreature(rows, this.index, Number(target.dataset.index));
    if (out.rows === rows && !typed) return;
    this.#markTaken();
    if (out.rows === rows) {
      await this.store.write(rows);
      this.render();
      return;
    }
    await this.#rewrite(out.rows, out.index, out.removed ? { removed: out.removed } : undefined);
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
  async #apply(patch = {}) {
    const rows = this.store.read();
    const current = rows[this.index];
    if (!current) return this.close();
    const form = { ...(this.#fromForm() ?? {}), ...patch };
    rows[this.index] = mergeRowEdit(current, form);
    await this.store.write(rows);
    this.render();
  }

  static async #onChange() {
    await this.#apply();
  }

  /**
   * A kind button of a level-value figure: applies the kind at once, as any
   * other field does, and drops the figure's drafted rungs, since the figure
   * is no longer the ladder they were drafted for. A Player's switch is refused
   * where it would move a figure on or off the invocation scale.
   */
  static async #onFigureKind(event, target) {
    const field = target.dataset.field;
    const kind = target.dataset.kind;
    if (!LEVEL_VALUE_FIELDS.includes(field) || !kind) return;
    if (!kindAllowed(this.store.read()[this.index]?.[field], kind)) return;
    const form = this.#fromForm() ?? {};
    this.rungs.discard([field]);
    await this.#apply({ [field]: { ...(form[field] ?? {}), kind } });
  }

  /** The page the store cites for the row, for a rung's tooltip. */
  rungCite() {
    return citeOfStore(this.store);
  }

  /** Redraw the body and the footer from the drafts. */
  rungRedraw() {
    this.render();
  }

  /**
   * Write every changed ladder of the row through the store in one write, as
   * any edit of the row is (`mergeRowEdit`, then `store.write`).
   * @param {Record<string, object>} values the level values, by field
   */
  async rungWrite(values) {
    const rows = this.store.read();
    const current = rows[this.index];
    if (!current) return;
    rows[this.index] = mergeRowEdit(current, values);
    await this.store.write(rows);
  }
}

/* -------------------------------------------- */

/** Every open row editor on one store. */
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

/**
 * Close every editor on a store — after a delete or a reorder, no index it
 * holds is still true. Rungs drafted in a closed editor are dropped with it.
 */
export async function closeEffectEditors(store) {
  await Promise.all(editorsOn(store.key).map((app) => app.close()));
}

/**
 * The sheet actions over one store of effect rows, mixed into a sheet's
 * `DEFAULT_OPTIONS.actions`. `storeOf(document)` returns the store for the
 * sheet's document; the template's controls carry `data-index`. A store's
 * `write(rows, {removed})` is told the row a delete took out, so a store that
 * keeps a register's rows can retire it.
 */
export function effectRowActions(storeOf) {
  async function effectAdd() {
    const store = storeOf(this.document);
    const rows = store.read();
    // A spell row carries a key a repair matches by; a Judge's starts with `_`, which no register key does.
    rows.push(store.domain === "spell" ? { key: `_${foundry.utils.randomID(8)}`, type: "damage" } : { type: "modifier" });
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
    const [removed] = rows.splice(index, 1);
    await store.write(rows, { removed });
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
