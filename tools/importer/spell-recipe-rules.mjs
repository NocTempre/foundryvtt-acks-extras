/**
 * The shape rules for a SPELL entry's authored recipes — `effects` (rows of the
 * spell's effect list) and `values` (fragments of its SpellExtras) — pure and
 * Foundry-free, so `lint-register.mjs` and the suite both import it.
 *
 * What a spell recipe may ship is structure: the row kind, who it applies to,
 * the delivery, what a passed save does, the condition keys, the modifier
 * target, the fragment's model and shape. Every figure and every word a page
 * prints (dice, damage type, extraordinary mark, save category, filters) is
 * located at import (`materializeEffects`), so no number appears outside a
 * locator's `from` and no located field appears as a literal. See
 * docs/importer/MODEL.md, "Spell recipes".
 */
import { LOCATABLE_FIELDS } from "../../scripts/importer/executor.mjs";
import {
  AREA_SHAPES, CONDITION_KEYS, EFFECT_DELIVERIES, EFFECT_LASTS, EFFECT_RECURRENCES, EFFECT_SUBJECTS, EFFECT_TYPES, HEAL_KINDS, MODIFIER_TARGETS,
  SAVE_EFFECTS, SAVE_KINDS, TARGET_MODELS, ALIGNMENTS, SCOPE_ALIGNMENT_MODES,
} from "../../scripts/lib/vocab.mjs";

/** The keys a spell row spec may carry besides what the vocabulary tables below check. */
const ROW_KEYS = new Set([
  "type", "appliesTo", "target", "mode", "healKind", "conditions", "saveEffect", "delivery", "lasts", "recur", "pick", "reversed",
  "vsAlignment", "vsAlignmentMode", "vsKinds", "stacksWith", "notStacksWith", "ref", "refs", "forWhat", "condition", "note", "from", "onMiss",
  "conditionFrom", "noteFrom", "audited", "gate",
]);

/**
 * The gate kinds a spell row may name. A gate says WHEN a row stands, and its
 * evaluator is registered by lib (`registerGate`, lib/typed-modifiers.mjs); a
 * kind here whose evaluator has not landed leaves the row listed, not applied.
 * `weaponMundane` and `weaponMagical` split a weapon buff by whether the weapon
 * is already magic; their evaluators are lib's (slice S2b).
 */
export const SPELL_GATE_KINDS = Object.freeze(["weaponMundane", "weaponMagical"]);
/** The keys a `values` spec may carry. */
const VALUE_KEYS = new Set(["save", "target", "from", "onMiss", "note"]);
/** The loc keys that hold a literal figure; a spell locator never carries one. */
const FIGURE_LOC_KEYS = ["per", "steps", "flat", "base"];

const inTable = (table, key) => key === undefined || Object.hasOwn(table, key);

/** Every number or boolean-free leaf problem: a number outside a locator is a printed figure shipped. */
function figureProblems(node, path, out) {
  if (typeof node === "number") out.push(`${path} is a literal figure; a spell's figures are located from the page`);
  else if (Array.isArray(node)) node.forEach((v, i) => figureProblems(v, `${path}[${i}]`, out));
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) figureProblems(v, `${path}.${k}`, out);
}

/** The problems in one spec's `from` (one locator or a list): known `into`, a compiling pattern, no literal figure. */
function locatorProblems(from, allow, label, out) {
  const list = Array.isArray(from) ? from : from === undefined ? [] : [from];
  for (const [i, loc] of list.entries()) {
    const at = `${label}.from[${i}]`;
    const into = loc?.into ?? "value";
    if (!Object.hasOwn(LOCATABLE_FIELDS, into)) out.push(`${at}.into "${into}" is not a locatable field`);
    else if (allow && !allow(into)) out.push(`${at}.into "${into}" is not a field this recipe fills`);
    if (typeof loc?.pattern !== "string" || !loc.pattern) {
      out.push(`${at} needs a pattern`);
    } else {
      try {
        new RegExp(loc.pattern, loc.flags ?? "i");
      } catch (e) {
        out.push(`${at}.pattern does not compile (${e.message.split(":").pop().trim()})`);
      }
    }
    for (const key of FIGURE_LOC_KEYS) if (loc?.[key] !== undefined) out.push(`${at}.${key} is a literal figure; read it from the page`);
  }
}

/**
 * The problems in a spell entry's `effects` and `values` recipes, as strings
 * naming the spec at fault. Empty when the entry carries neither or both are
 * well formed.
 *
 * @param {{effects?: object[], values?: object[]}} entry a register row, or a cookbook entry's `fields.effects.specs` and `fields.values.specs` as `{effects, values}`
 */
export function spellRecipeProblems({ effects, values } = {}) {
  const out = [];
  for (const [i, spec] of (effects ?? []).entries()) {
    const label = `effects[${i}]`;
    if (!spec || typeof spec !== "object") {
      out.push(`${label} is not an object`);
      continue;
    }
    const { from, conditionFrom, noteFrom, ...structure } = spec;
    for (const key of Object.keys(spec)) if (!ROW_KEYS.has(key)) out.push(`${label} carries "${key}", which a spell row recipe does not (located fields ride in \`from\`; \`origin\` and \`unread\` are the importer's)`);
    if (spec.onMiss !== undefined && spec.onMiss !== "blank") out.push(`${label}.onMiss is "blank" or absent`);
    if (!Object.hasOwn(EFFECT_TYPES, spec.type)) out.push(`${label}.type "${spec.type}" is not an effect kind`);
    if (!inTable(EFFECT_SUBJECTS, spec.appliesTo)) out.push(`${label}.appliesTo "${spec.appliesTo}" is not a subject`);
    if (!inTable(SAVE_EFFECTS, spec.saveEffect)) out.push(`${label}.saveEffect "${spec.saveEffect}" is not a save effect`);
    if (!inTable(EFFECT_DELIVERIES, spec.delivery)) out.push(`${label}.delivery "${spec.delivery}" is not a delivery`);
    if (!inTable(EFFECT_LASTS, spec.lasts)) out.push(`${label}.lasts "${spec.lasts}" is not a duration kind`);
    if (!inTable(EFFECT_RECURRENCES, spec.recur)) out.push(`${label}.recur "${spec.recur}" is not a recurrence`);
    if (!inTable(HEAL_KINDS, spec.healKind)) out.push(`${label}.healKind "${spec.healKind}" is not a heal kind`);
    if (spec.type === "modifier" && !inTable(MODIFIER_TARGETS, spec.target)) out.push(`${label}.target "${spec.target}" is not a modifier target`);
    if (!inTable(ALIGNMENTS, spec.vsAlignment)) out.push(`${label}.vsAlignment "${spec.vsAlignment}" is not an alignment`);
    if (!inTable(SCOPE_ALIGNMENT_MODES, spec.vsAlignmentMode)) out.push(`${label}.vsAlignmentMode "${spec.vsAlignmentMode}" is not a scope mode`);
    if (spec.gate !== undefined) {
      if (Object.keys(spec.gate ?? {}).some((k) => k !== "kind")) out.push(`${label}.gate carries only a kind; a spell gate's arguments are not located`);
      if (!SPELL_GATE_KINDS.includes(spec.gate?.kind)) out.push(`${label}.gate.kind "${spec.gate?.kind}" is not a spell gate kind`);
    }
    for (const key of spec.conditions ?? []) if (!Object.hasOwn(CONDITION_KEYS, key)) out.push(`${label}.conditions names "${key}", which is no condition key`);
    for (const key of ["pick"]) if (spec[key] !== undefined && typeof spec[key] !== "string") out.push(`${label}.${key} is a string`);
    figureProblems(structure, label, out);
    locatorProblems(from, null, label, out);
    // A located field is never also written as a literal: a spell's printed words
    // and figures arrive from the page or stay blank.
    for (const into of Object.keys(LOCATABLE_FIELDS)) {
      const head = into.split(".")[0];
      if (!into.includes(".") && spec[head] !== undefined) out.push(`${label}.${head} is located from the page, never written in the recipe`);
    }
  }
  for (const [i, spec] of (values ?? []).entries()) {
    const label = `values[${i}]`;
    if (!spec || typeof spec !== "object") {
      out.push(`${label} is not an object`);
      continue;
    }
    const { from, conditionFrom, noteFrom, ...structure } = spec;
    for (const key of Object.keys(spec)) if (!VALUE_KEYS.has(key)) out.push(`${label} carries "${key}", which a spell values recipe does not`);
    if (spec.onMiss !== undefined && spec.onMiss !== "blank") out.push(`${label}.onMiss is "blank" or absent`);
    const save = spec.save ?? {};
    const target = spec.target ?? {};
    for (const key of Object.keys(save)) if (!["effect", "kind", "perTarget"].includes(key)) out.push(`${label}.save.${key} is not structure a recipe states (category, modifier and the rest are located)`);
    for (const key of Object.keys(target)) if (!["model", "area", "beholding"].includes(key)) out.push(`${label}.target.${key} is not structure a recipe states (count, cap and filters are located)`);
    for (const key of Object.keys(target.area ?? {})) if (key !== "shape") out.push(`${label}.target.area.${key} is not structure a recipe states (the size is located)`);
    if (!inTable(SAVE_EFFECTS, save.effect)) out.push(`${label}.save.effect "${save.effect}" is not a save effect`);
    if (!inTable(SAVE_KINDS, save.kind)) out.push(`${label}.save.kind "${save.kind}" is not a save kind`);
    if (!inTable(TARGET_MODELS, target.model)) out.push(`${label}.target.model "${target.model}" is not a target model`);
    if (!inTable(AREA_SHAPES, target.area?.shape)) out.push(`${label}.target.area.shape "${target.area?.shape}" is not an area shape`);
    figureProblems(structure, label, out);
    locatorProblems(from, (into) => into.startsWith("save.") || into.startsWith("target."), label, out);
  }
  return out;
}
