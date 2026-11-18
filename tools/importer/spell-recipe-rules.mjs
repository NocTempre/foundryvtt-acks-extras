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
 *
 * A row's scope is structure too: `vsKinds`, `vsAlignment`, `vsAlignmentOf`,
 * `vsAlignmentMode`, `vsEnemy` and an `anyOf` list of branches that hold those
 * keys and never a `sign` mode. An area's `measure` and `unit` are structure;
 * its size and width are located, and a located size names the measure word in
 * its pattern so the locator proves the page uses that measure.
 */
import { LOCATABLE_FIELDS } from "../../scripts/importer/executor.mjs";
import {
  AREA_SHAPES, CONDITION_KEYS, EFFECT_DELIVERIES, EFFECT_LASTS, EFFECT_RECURRENCES, EFFECT_RECUR_MOMENTS, EFFECT_RECUR_SAVES, EFFECT_RECUR_TARGETS,
  EFFECT_MODES, EFFECT_SUBJECTS, EFFECT_TYPES, HEAL_KINDS, MODIFIER_TARGETS,
  SAVE_EFFECTS, SAVE_KINDS, TARGET_MODELS, ALIGNMENTS, SCOPE_ALIGNMENT_MODES, SCOPE_ALIGNMENT_REFERENCES, SCOPE_BRANCH_FIELDS, hasScope, isCapabilityToken,
} from "../../scripts/lib/vocab.mjs";
import { ENDS_ON_CAUSES } from "../../scripts/lib/ends-on.mjs";
import { ATTACK_KINDS } from "../../scripts/lib/conditions.mjs";
import { AREA_MEASURES, CONTROL_KINDS, DISTANCE_UNITS, REGISTER_KEY, SAVE_CATEGORIES, SPELL_TYPES, SUMMON_FORMATS } from "../../scripts/lib/magic-vocab.mjs";

/** The keys a spell row spec may carry besides what the vocabulary tables below check. */
const ROW_KEYS = new Set([
  "key", "type", "appliesTo", "target", "mode", "healKind", "conditions", "saveEffect", "delivery", "lasts", "recur", "recurAt", "recurSave", "recurTarget",
  "pick", "pickOption", "reversed", "summonFormat", "control",
  "vsAlignment", "vsAlignmentMode", "vsAlignmentOf", "vsEnemy", "vsKinds", "anyOf", "stacksWith", "notStacksWith", "ref", "refs", "forWhat", "condition", "note", "from", "onMiss",
  "conditionFrom", "noteFrom", "audited", "gate", "each", "endsOn", "untimed",
  "ifHas", "appliesToRoll", "attackKinds", "ownSave", "pickKind",
]);

/**
 * The gate kinds a spell row may name. A gate says WHEN a row stands, and its
 * evaluator is registered by lib (`registerGate`, lib/typed-modifiers.mjs); a
 * kind here whose evaluator has not landed leaves the row listed, not applied.
 * `weaponMundane` and `weaponMagical` split a weapon buff by whether the weapon
 * is already magic; their evaluators are lib's (slice S2b).
 */
export const SPELL_GATE_KINDS = Object.freeze(["weaponMundane", "weaponMagical"]);

/**
 * The type words beside `SPELL_TYPES` a `spellcastingMod` row may narrow on.
 * A spell's `schools` keeps every word its stat line printed, and a word the
 * book prints as a type for some spells without the module naming it a type is
 * listed here, folded and lowercase. A word outside both lists never matches
 * a spell the importer wrote, so the lint refuses it.
 */
export const SPELL_NARROWING_WORDS = Object.freeze(["necromancy"]);
/** The keys a `values` spec may carry. */
const VALUE_KEYS = new Set(["save", "target", "from", "onMiss", "note", "reversedDurationFromNote"]);
/** The loc keys that hold a literal figure; a spell locator never carries one. */
const FIGURE_LOC_KEYS = ["per", "steps", "flat", "base", "count", "increment", "rungs"];

const inTable = (table, key) => key === undefined || Object.hasOwn(table, key);

/** Every number or boolean-free leaf problem: a number outside a locator is a printed figure shipped. */
function figureProblems(node, path, out) {
  if (typeof node === "number") out.push(`${path} is a literal figure; a spell's figures are located from the page`);
  else if (Array.isArray(node)) node.forEach((v, i) => figureProblems(v, `${path}[${i}]`, out));
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) figureProblems(v, `${path}.${k}`, out);
}

/** The problems in one scope's keys: its kinds, its alignment fields and its enemy test. */
function scopeProblems(scope, label, out) {
  if (scope.vsKinds !== undefined && !(Array.isArray(scope.vsKinds) && scope.vsKinds.every((k) => typeof k === "string" && k))) out.push(`${label}.vsKinds is a list of kind tokens`);
  if (!inTable(ALIGNMENTS, scope.vsAlignment)) out.push(`${label}.vsAlignment "${scope.vsAlignment}" is not an alignment`);
  if (!inTable(SCOPE_ALIGNMENT_REFERENCES, scope.vsAlignmentOf)) out.push(`${label}.vsAlignmentOf "${scope.vsAlignmentOf}" is not an alignment reference`);
  if (!inTable(SCOPE_ALIGNMENT_MODES, scope.vsAlignmentMode)) out.push(`${label}.vsAlignmentMode "${scope.vsAlignmentMode}" is not a scope mode`);
  if (scope.vsEnemy !== undefined && typeof scope.vsEnemy !== "boolean") out.push(`${label}.vsEnemy is true or false`);
}

/** The problems in a row's `anyOf`: a non-empty list of branches, each a scope of its own keys and no `sign`. */
function anyOfProblems(anyOf, label, out) {
  if (!Array.isArray(anyOf) || !anyOf.length) {
    out.push(`${label}.anyOf is a non-empty list of branches`);
    return;
  }
  for (const [i, branch] of anyOf.entries()) {
    const at = `${label}.anyOf[${i}]`;
    if (!branch || typeof branch !== "object" || Array.isArray(branch)) {
      out.push(`${at} is not an object`);
      continue;
    }
    for (const key of Object.keys(branch)) if (!SCOPE_BRANCH_FIELDS.includes(key)) out.push(`${at} carries "${key}", which a branch does not (it holds ${SCOPE_BRANCH_FIELDS.join(", ")})`);
    if (branch.vsAlignmentMode === "sign") out.push(`${at}.vsAlignmentMode is "sign"; a branch never takes sign`);
    scopeProblems(branch, at, out);
    if (!hasScope({ ...branch, anyOf: undefined })) out.push(`${at} declares no clause`);
  }
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
    // A reading option is a switch, never a figure: `articles` reads "a" or "an" as one
    // inside this locator, and `accumulate` adds each captured rung's value to the one before.
    for (const key of ["articles", "accumulate"]) if (loc?.[key] !== undefined && loc[key] !== true) out.push(`${at}.${key} is true or absent`);
    if (loc?.accumulate === true && !loc.on) out.push(`${at}.accumulate reads a ladder and needs "on"`);
  }
}

/**
 * The problems in a row's `each` (the template locator that expands it once per
 * match of a printed option list): a compiling pattern and a capture group that
 * is a whole number. The row then needs the `pick` group its options share and
 * the `key` its rows are numbered from, and never a `pickOption`, which `each`
 * writes itself.
 */
function eachProblems(spec, each, label, out) {
  if (!each || typeof each !== "object" || Array.isArray(each)) {
    out.push(`${label}.each is a locator object`);
  } else if (typeof each.pattern !== "string" || !each.pattern) {
    out.push(`${label}.each needs a pattern`);
  } else {
    try {
      new RegExp(each.pattern, each.flags ?? "i");
    } catch (e) {
      out.push(`${label}.each.pattern does not compile (${e.message.split(":").pop().trim()})`);
    }
  }
  if (each?.group !== undefined && !Number.isInteger(each.group)) out.push(`${label}.each.group is a capture group number`);
  if (!spec.pick) out.push(`${label}.each expands into the options of a pick group and the row names no pick`);
  if (spec.key === undefined) out.push(`${label}.each numbers its rows from the row's key and the row carries none`);
  if (spec.pickOption !== undefined) out.push(`${label}.each writes each row's pickOption and the row names one`);
}

/**
 * The problems in how a `values` spec locates an area: a located size needs the
 * authored measure and a pattern naming that measure's word (so the locator
 * proves the page prints the size as that measure), a length needs a located
 * width, and a width belongs to a length.
 */
function areaLocatorProblems(area, from, label, out) {
  const list = (Array.isArray(from) ? from : from === undefined ? [] : [from]).filter(Boolean);
  const sizes = list.filter((loc) => loc.into === "target.area.size");
  const widths = list.filter((loc) => loc.into === "target.area.width");
  if (sizes.length && !area.measure) out.push(`${label} locates target.area.size and states no target.area.measure`);
  if (area.measure && Object.hasOwn(AREA_MEASURES, area.measure)) {
    for (const loc of sizes) {
      if (typeof loc.pattern === "string" && !loc.pattern.toLowerCase().includes(area.measure)) out.push(`${label} locates target.area.size for a ${area.measure} but its pattern never says "${area.measure}"`);
    }
    if (area.measure === "length" && sizes.length && !widths.length) out.push(`${label} states a length and locates no target.area.width`);
  }
  if (widths.length && area.measure !== "length") out.push(`${label} locates target.area.width, which only a length measure reads`);
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
  const seen = new Map();
  for (const [i, spec] of (effects ?? []).entries()) {
    const label = `effects[${i}]`;
    if (!spec || typeof spec !== "object") {
      out.push(`${label} is not an object`);
      continue;
    }
    if (spec.key === undefined) out.push(`${label} carries no key; a repair tells the row apart by it`);
    else if (typeof spec.key !== "string" || !REGISTER_KEY.test(spec.key)) out.push(`${label}.key "${spec.key}" is not a key (a lowercase letter, then letters and digits)`);
    else if (seen.has(spec.key)) out.push(`${label}.key "${spec.key}" repeats effects[${seen.get(spec.key)}]; a reversed twin takes a key of its own`);
    else seen.set(spec.key, i);
    const { from, conditionFrom, noteFrom, each, ...structure } = spec;
    for (const key of Object.keys(spec)) if (!ROW_KEYS.has(key)) out.push(`${label} carries "${key}", which a spell row recipe does not (located fields ride in \`from\`; \`origin\` and \`unread\` are the importer's)`);
    if (spec.onMiss !== undefined && spec.onMiss !== "blank") out.push(`${label}.onMiss is "blank" or absent`);
    if (!Object.hasOwn(EFFECT_TYPES, spec.type)) out.push(`${label}.type "${spec.type}" is not an effect kind`);
    if (!inTable(EFFECT_SUBJECTS, spec.appliesTo)) out.push(`${label}.appliesTo "${spec.appliesTo}" is not a subject`);
    if (!inTable(SAVE_EFFECTS, spec.saveEffect)) out.push(`${label}.saveEffect "${spec.saveEffect}" is not a save effect`);
    if (!inTable(EFFECT_DELIVERIES, spec.delivery)) out.push(`${label}.delivery "${spec.delivery}" is not a delivery`);
    if (!inTable(EFFECT_LASTS, spec.lasts)) out.push(`${label}.lasts "${spec.lasts}" is not a duration kind`);
    if (!inTable(EFFECT_RECURRENCES, spec.recur)) out.push(`${label}.recur "${spec.recur}" is not a recurrence`);
    if (!inTable(HEAL_KINDS, spec.healKind)) out.push(`${label}.healKind "${spec.healKind}" is not a heal kind`);
    if (!inTable(SUMMON_FORMATS, spec.summonFormat)) out.push(`${label}.summonFormat "${spec.summonFormat}" is not a summon format`);
    if (!inTable(CONTROL_KINDS, spec.control)) out.push(`${label}.control "${spec.control}" is not a control kind`);
    if (spec.type === "modifier" && !inTable(MODIFIER_TARGETS, spec.target)) out.push(`${label}.target "${spec.target}" is not a modifier target`);
    scopeProblems(spec, label, out);
    if (spec.anyOf !== undefined) anyOfProblems(spec.anyOf, label, out);
    if (spec.gate !== undefined) {
      if (Object.keys(spec.gate ?? {}).some((k) => k !== "kind")) out.push(`${label}.gate carries only a kind; a spell gate's arguments are not located`);
      if (!SPELL_GATE_KINDS.includes(spec.gate?.kind)) out.push(`${label}.gate.kind "${spec.gate?.kind}" is not a spell gate kind`);
    }
    for (const key of spec.conditions ?? []) if (!Object.hasOwn(CONDITION_KEYS, key)) out.push(`${label}.conditions names "${key}", which is no condition key`);
    // What a row's record ends on, and the conditions it writes with no clock: words of lib's tables, never located.
    if (spec.endsOn !== undefined && !(Array.isArray(spec.endsOn) && spec.endsOn.length && spec.endsOn.every((c) => ENDS_ON_CAUSES.includes(c)))) out.push(`${label}.endsOn is a non-empty list of ${ENDS_ON_CAUSES.join(", ")}`);
    if (spec.untimed !== undefined) {
      if (!Array.isArray(spec.untimed) || !spec.untimed.length) out.push(`${label}.untimed is a non-empty list of condition keys`);
      else for (const key of spec.untimed) if (!Object.hasOwn(CONDITION_KEYS, key)) out.push(`${label}.untimed names "${key}", which is no condition key`);
    }
    for (const key of ["pick", "pickOption", "appliesToRoll"]) if (spec[key] !== undefined && typeof spec[key] !== "string") out.push(`${label}.${key} is a string`);
    // What a part of a record narrows on, in words of lib's own tables: a definition id or a kw: capability, an attack kind, a switch.
    if (!inTable(EFFECT_MODES, spec.mode)) out.push(`${label}.mode "${spec.mode}" is not a combination mode`);
    for (const key of ["ref", "refs", "ifHas"]) {
      const named = key === "ref" ? (spec.ref === undefined ? undefined : [spec.ref]) : spec[key];
      if (named !== undefined && !(Array.isArray(named) && named.length && named.every((t) => typeof t === "string" && t))) out.push(`${label}.${key} is ${key === "ref" ? "a token" : "a non-empty list of tokens"} (a definition id or a kw: capability)`);
    }
    if (spec.attackKinds !== undefined && !(Array.isArray(spec.attackKinds) && spec.attackKinds.length && spec.attackKinds.every((k) => ATTACK_KINDS.includes(k)))) out.push(`${label}.attackKinds is a non-empty list of ${ATTACK_KINDS.join(", ")}`);
    for (const key of ["ownSave", "pickKind"]) if (spec[key] !== undefined && spec[key] !== true) out.push(`${label}.${key} is true or absent`);
    if (spec.ownSave === true && !(spec.type === "modifier" && spec.target === "save")) out.push(`${label}.ownSave marks a modifier on a save and the row is not one`);
    if (spec.pickKind === true && !(Array.isArray(spec.vsKinds) && spec.vsKinds.length)) out.push(`${label}.pickKind offers the row's vsKinds and the row names none`);
    if (each !== undefined) eachProblems(spec, each, label, out);
    if (spec.pickOption !== undefined && !spec.pick) out.push(`${label}.pickOption names an option of a pick group and the row names no pick`);
    if (!inTable(EFFECT_RECUR_MOMENTS, spec.recurAt)) out.push(`${label}.recurAt "${spec.recurAt}" is not a recurrence moment`);
    if (!inTable(EFFECT_RECUR_SAVES, spec.recurSave)) out.push(`${label}.recurSave "${spec.recurSave}" is not a recurrence save`);
    if (!inTable(EFFECT_RECUR_TARGETS, spec.recurTarget)) out.push(`${label}.recurTarget "${spec.recurTarget}" is not a recurrence target`);
    const recurs = spec.recur === "eachRound" || spec.recur === "laterRounds";
    for (const key of ["recurAt", "recurSave", "recurTarget"]) if (spec[key] !== undefined && !recurs) out.push(`${label}.${key} needs a recur of eachRound or laterRounds`);
    // A `rounds` lasting counts a located formula, and a located formula is read for nothing else.
    const locatesRounds = (Array.isArray(from) ? from : from === undefined ? [] : [from]).some((loc) => loc?.into === "rounds");
    if (spec.lasts === "rounds" && !locatesRounds) out.push(`${label}.lasts is rounds and no locator reads its rounds`);
    if (locatesRounds && spec.lasts !== "rounds") out.push(`${label} locates rounds and its lasts is not rounds`);
    figureProblems(structure, label, out);
    locatorProblems(from, null, label, out);
    // A located field is never also written as a literal: a spell's printed words
    // and figures arrive from the page or stay blank.
    // `conditions` is the exception: a row may author its condition keys as structure,
    // and only one that also locates them states the field twice.
    const locatesConditions = (Array.isArray(from) ? from : from === undefined ? [] : [from]).some((loc) => loc?.into === "conditions");
    if (locatesConditions && spec.conditions !== undefined) out.push(`${label}.conditions is located from the page and also written in the recipe`);
    for (const into of Object.keys(LOCATABLE_FIELDS)) {
      const head = into.split(".")[0];
      if (head === "conditions") continue;
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
    const area = target.area ?? {};
    for (const key of Object.keys(area)) if (!["shape", "measure", "unit"].includes(key)) out.push(`${label}.target.area.${key} is not structure a recipe states (the size and the width are located)`);
    if (!inTable(AREA_MEASURES, area.measure)) out.push(`${label}.target.area.measure "${area.measure}" is not an area measure`);
    if (!inTable(DISTANCE_UNITS, area.unit)) out.push(`${label}.target.area.unit "${area.unit}" is not a distance unit`);
    areaLocatorProblems(area, from, label, out);
    if (!inTable(SAVE_EFFECTS, save.effect)) out.push(`${label}.save.effect "${save.effect}" is not a save effect`);
    if (!inTable(SAVE_KINDS, save.kind)) out.push(`${label}.save.kind "${save.kind}" is not a save kind`);
    if (!inTable(TARGET_MODELS, target.model)) out.push(`${label}.target.model "${target.model}" is not a target model`);
    if (!inTable(AREA_SHAPES, target.area?.shape)) out.push(`${label}.target.area.shape "${target.area?.shape}" is not an area shape`);
    if (spec.reversedDurationFromNote !== undefined && spec.reversedDurationFromNote !== true) out.push(`${label}.reversedDurationFromNote is true or absent`);
    figureProblems(structure, label, out);
    locatorProblems(from, (into) => into.startsWith("save.") || into.startsWith("target."), label, out);
  }
  return out;
}

/** The three things a `spellcastingMod` row changes; the cast matcher reads no other target. */
const SPELLCASTING_TARGETS = Object.freeze(["casterLevel", "save", "damage"]);

/** The narrowing keys that carry a list of words, each one a folded, lowercase word. */
const WORD_LISTS = ["schools", "elements", "saveCategories"];

/** A list of non-empty strings, or false. */
const isWordList = (v) => Array.isArray(v) && v.length > 0 && v.every((w) => typeof w === "string" && w.trim() !== "");

/**
 * The problems in the `spellcastingMod` rows of an ability's `effects` recipe,
 * and in its `progressionAs` rows' fractions, whatever the kind of entry: a
 * proficiency or a power buffs spells as a spell's own rows do.
 *
 * A row is structure and one located figure. It names what it changes (`target`),
 * what spells it concerns (at least one narrowing field, or the matcher reads it
 * as narrowing on nothing and applies nothing), and what it stacks with; its size
 * rides in `from`, never as a literal `value`. `schools` and `elements` hold
 * `SPELL_TYPES` keys or `SPELL_NARROWING_WORDS`, and `saveCategories` hold
 * save-category keys. A stacking or holding token is a definition id or a `kw:`
 * capability that the register defines, when `tokenKnown` is given.
 *
 * @param {object[]} effects an entry's `effects` specs
 * @param {{selfId?: string, tokenKnown?: (token: string) => boolean}} [options] `selfId` bars a row naming its own ability
 */
export function spellcastingModProblems(effects, { selfId, tokenKnown } = {}) {
  const out = [];
  for (const [i, spec] of (effects ?? []).entries()) {
    const label = `effects[${i}]`;
    if (spec?.type === "progressionAs") {
      for (const key of ["atLevelNum", "atLevelDen"]) if (spec[key] !== undefined) out.push(`${label}.${key} is a literal fraction; read it from the page (\`from.into\` "atLevel")`);
      continue;
    }
    if (spec?.type !== "spellcastingMod") continue;
    if (!SPELLCASTING_TARGETS.includes(spec.target)) out.push(`${label}.target "${spec.target}" is not one of ${SPELLCASTING_TARGETS.join(", ")}`);
    for (const key of ["value", "casterLevelDelta"]) if (spec[key] !== undefined) out.push(`${label}.${key} is a literal figure; a spellcasting row's size is located from the page`);
    const { from, ...structure } = spec;
    figureProblems(structure, label, out);
    const locators = Array.isArray(from) ? from : from === undefined ? [] : [from];
    if (!locators.some((loc) => (loc?.into ?? "value") === "value")) out.push(`${label} locates no value; a row with no figure to read applies nothing`);
    locatorProblems(from, (into) => into === "value", label, out);
    if (spec.onMiss !== undefined && spec.onMiss !== "blank") out.push(`${label}.onMiss is "blank" or absent`);
    for (const key of WORD_LISTS) if (spec[key] !== undefined && !isWordList(spec[key])) out.push(`${label}.${key} is a non-empty list of words`);
    for (const word of isWordList(spec.schools) ? spec.schools : []) {
      if (!Object.hasOwn(SPELL_TYPES, word) && !SPELL_NARROWING_WORDS.includes(word)) out.push(`${label}.schools names "${word}", which is no spell type and not an allowed narrowing word`);
    }
    for (const word of isWordList(spec.elements) ? spec.elements : []) {
      if (!SPELL_NARROWING_WORDS.includes(word)) out.push(`${label}.elements names "${word}", which is not an allowed narrowing word`);
    }
    for (const word of isWordList(spec.saveCategories) ? spec.saveCategories : []) {
      if (word === "none" || !Object.hasOwn(SAVE_CATEGORIES, word)) out.push(`${label}.saveCategories names "${word}", which is no save category`);
    }
    if (spec.bySelection !== undefined && spec.bySelection !== true) out.push(`${label}.bySelection is true or absent`);
    if (spec.perDie !== undefined && (spec.perDie !== true || spec.target !== "damage")) out.push(`${label}.perDie is true on a damage row, and absent elsewhere`);
    const named = isWordList(spec.schools) || isWordList(spec.elements) || isWordList(spec.saveCategories) || spec.bySelection === true || Boolean(spec.spellRef) || Boolean(spec.spell);
    if (!named) out.push(`${label} narrows on no spell (schools, elements, saveCategories, bySelection or a named spell); an unnarrowed row matches nothing`);
    for (const key of ["ifHas", "stacksWith", "notStacksWith"]) {
      if (spec[key] === undefined) continue;
      if (!isWordList(spec[key])) {
        out.push(`${label}.${key} is a non-empty list of ability tokens`);
        continue;
      }
      for (const token of spec[key]) {
        if (token === selfId) out.push(`${label}.${key} names the ability the row is on`);
        else if (tokenKnown && !tokenKnown(token)) out.push(`${label}.${key} names "${token}", which no register row defines${isCapabilityToken(token) ? " or provides" : ""}`);
      }
    }
  }
  return out;
}
