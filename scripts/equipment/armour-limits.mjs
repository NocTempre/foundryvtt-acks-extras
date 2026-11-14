/**
 * Armour limits on abilities (JJ ch. 12, p. 292): which abilities refuse a
 * heavy suit or a shield, read from the Judge's own book.
 *
 * The limit is a `limitation` row on the ability itself, `gate.kind`
 * `armourCeiling`. A row the importer wrote carries no figure: it names no
 * rung and no shield rule, and resolves both at read time from the imported
 * `thiefLimits` table (`resolveArmourGate`), so a Judge's edit of that table in
 * the Ruledata Browser reaches every ability at once and reverts the same way.
 * A row a Judge writes on an ability of their own carries its own `armourMax`
 * and `noShield`, which win over the table. Which skills the table restricts
 * is the importer's to stamp (`importer/thief-limit-binding.mjs`); this file
 * never names a skill, a rung or a rule.
 *
 * The table's raw phrases are parsed here, as pure functions: the vocabulary is
 * the module's armour ladder and its notion of a shield, and everything a
 * phrase states beyond that is the book's. With no table, or a phrase that
 * names no ladder word, no rung exists and a limit answers null: the surface
 * says "not imported" and shows no figure in its place.
 */
import { ARMOR_LADDER } from "./config.mjs";
import { MODULE_ID } from "./constants.mjs";
import { armourCeiling } from "./proficiency.mjs";
import { ITEM_TYPE, slug } from "../lib/vocab.mjs";
import { BUILDER_DOC_ID } from "../classes/builder-logic.mjs";
import { getDoc, getLayer, hasDoc, citeOf, PRIORITY } from "../lib/tables.mjs";

/** The raw table of the class-builder document the limits are read into. */
export const THIEF_LIMITS_TABLE = "thiefLimits";

/** The `gate.kind` of a limitation row that limits an ability by the armour worn. */
export const ARMOUR_LIMIT_KIND = "armourCeiling";

/** The cookbook id namespace of the skills the importer stamps a limit on. */
const SKILL_ID = /^def\.skill\./;

/** The neutral label an imported limit row carries in its `condition`. */
const LIMIT_CONDITION = "in some armour";

/** A ladder rung as the pattern its printed words take: "veryLight" reads "very light". */
const rungPattern = (rung) =>
  new RegExp(`\\b${rung.replace(/([A-Z])/g, " $1").toLowerCase().replace("armored", "armou?red").replace(/ /g, "[\\s-]*")}\\b`, "g");

/**
 * The armour rung a limit may not be exceeded at, from the phrase naming what
 * the character may not wear: the rung below the lowest ladder word the phrase
 * names. Words are matched longest first so "very light" is not also "light".
 * Null where the phrase names no rung, or names the lowest one (nothing is
 * below it).
 * @param {string} phrase
 * @returns {string|null}
 */
export function ceilingBelow(phrase) {
  let text = String(phrase ?? "").toLowerCase();
  let lowest = -1;
  const order = ARMOR_LADDER.map((rung, i) => ({ rung, i })).sort((a, b) => b.rung.length - a.rung.length);
  for (const { rung, i } of order) {
    const re = rungPattern(rung);
    if (re.test(text)) {
      lowest = lowest < 0 ? i : Math.min(lowest, i);
      text = text.replace(re, " ");
    }
  }
  return lowest >= 1 ? ARMOR_LADDER[lowest - 1] : null;
}

/**
 * The heaviest armour rung a clause allows, from the phrase naming what may be
 * worn: the highest ladder word the phrase names, with "no armour" counted as
 * the lowest rung. The reading an importer locator applies to an allowance
 * ("wearing X, Y or no armour"), where `ceilingBelow` reads a prohibition.
 * Words match longest first so "very light" is not also "light". Null where the
 * phrase names no rung.
 * @param {string} phrase
 * @returns {string|null}
 */
export function ceilingOf(phrase) {
  let text = String(phrase ?? "").toLowerCase().replace(/\bno\s*armou?r\b/g, " unarmored ");
  let highest = -1;
  const order = ARMOR_LADDER.map((rung, i) => ({ rung, i })).sort((a, b) => b.rung.length - a.rung.length);
  for (const { rung, i } of order) {
    const re = rungPattern(rung);
    if (re.test(text)) {
      highest = Math.max(highest, i);
      text = text.replace(re, " ");
    }
  }
  return highest >= 0 ? ARMOR_LADDER[highest] : null;
}

/**
 * What the raw `thiefLimits` table states, each part only where it was read:
 * `names` the printed skill names (split on commas and "and"), `armourMax` the
 * rung from `forbidden`, `noShield` whether the page also refuses a shield.
 * Null for a table that holds none of them (a placeholder, or no table).
 * @param {object|null} table
 * @returns {{names: string[], armourMax: string|null, noShield: boolean|null}|null}
 */
export function parseArmourLimits(table) {
  if (!table || typeof table !== "object") return null;
  const names = typeof table.skills === "string" ? table.skills.split(/,|\band\b/i).map((s) => s.trim()).filter(Boolean) : [];
  const armourMax = typeof table.forbidden === "string" ? ceilingBelow(table.forbidden) : null;
  const noShield = typeof table.noShield === "string" && table.noShield.trim() ? /\bshield/i.test(table.noShield) : null;
  if (!names.length && !armourMax && noShield === null) return null;
  return { names, armourMax, noShield };
}

/** The merged `thiefLimits` table (an override beats the import), or null. */
function limitsTable() {
  try {
    return hasDoc(BUILDER_DOC_ID) ? (getDoc(BUILDER_DOC_ID).tables?.[THIEF_LIMITS_TABLE] ?? null) : null;
  } catch {
    return null;
  }
}

/** The parsed limits the registry holds now, or null until a table is imported. */
export const armourLimitsOf = () => parseArmourLimits(limitsTable());

/**
 * Where the limits came from, at render: `{judge: true}` where the Judge's own
 * edit holds the table, `{cite}` where the import recorded the page it read,
 * or null where neither is so.
 */
export function armourLimitSource() {
  if (getLayer(BUILDER_DOC_ID, PRIORITY.OVERRIDE)?.tables?.[THIEF_LIMITS_TABLE] != null) return { judge: true };
  const cite = citeOf(BUILDER_DOC_ID, THIEF_LIMITS_TABLE);
  return cite ? { cite } : null;
}

/** A limitation row of the armour kind. */
export const isArmourLimitRow = (effect) => effect?.type === "limitation" && effect?.gate?.kind === ARMOUR_LIMIT_KIND;

/**
 * An armour limit row that states its own figures, as a Judge writes one: it
 * names a rung. A shield rule alone is no figure, since a limit with no rung
 * says nothing about any suit, and the row editor submits the shield box with
 * every change.
 */
const statesOwnFigures = (gate) => !!gate?.armourMax;

/**
 * The figures a limit row applies: its own where it states any, else the
 * imported table's. Both are empty until something supplies them.
 * @param {{armourMax?: string, noShield?: boolean|null}} [gate]
 * @returns {{armourMax: string, noShield: boolean|null}}
 */
export function resolveArmourGate(gate) {
  if (statesOwnFigures(gate)) return { armourMax: gate.armourMax, noShield: gate.noShield ?? null };
  const read = armourLimitsOf();
  return { armourMax: read?.armourMax ?? "", noShield: read?.noShield ?? null };
}

/** The row the importer stamps on a restricted skill: it names no figure. */
export const importedLimitRow = () => ({ type: "limitation", condition: LIMIT_CONDITION, gate: { kind: ARMOUR_LIMIT_KIND } });

/** Whether a cookbook id is a skill's. */
export const isSkillId = (id) => SKILL_ID.test(String(id ?? ""));

/** Whether a printed skill name is one the imported table restricts. */
export function limitsSkill(name, limits = armourLimitsOf()) {
  const key = slug(String(name ?? "").replace(/\([^)]*\)\s*$/, ""));
  return !!key && !!limits?.names.some((n) => slug(n) === key);
}

/**
 * An effect list with the imported limit row upserted for a skill, or removed
 * where the skill is no longer restricted. Rows a Judge wrote (those that
 * state their own figures) and every other row are kept as they are.
 * @param {object[]} effects
 * @param {boolean} restricted
 * @returns {object[]}
 */
export function withImportedLimit(effects, restricted) {
  const kept = (effects ?? []).filter((e) => !(isArmourLimitRow(e) && !statesOwnFigures(e.gate)));
  return restricted ? [...kept, importedLimitRow()] : kept;
}

/**
 * The limit rows a freshly built ability carries: the imported one where the
 * table restricts this skill, none otherwise.
 * @param {string} name the printed name
 * @param {string} id the cookbook id
 * @returns {object[]}
 */
export function limitRowsFor(name, id) {
  return isSkillId(id) && limitsSkill(name) ? [importedLimitRow()] : [];
}

/**
 * The actor's abilities whose armour limit the loadout breaks (`blocked`) and
 * those whose limit cannot be judged for want of an imported rung
 * (`undecided`), by ability name. An ability with no armour limit row is in
 * neither; a row the table has not supplied is never answered from a default.
 * @param {Actor} actor
 * @param {{armor?: Item|null, shield?: Item|null}} loadout
 * @returns {{blocked: string[], undecided: string[]}}
 */
export function armourLimitedAbilities(actor, loadout) {
  const blocked = new Set();
  const undecided = new Set();
  for (const item of actor?.items ?? []) {
    if (item.type !== ITEM_TYPE.ability) continue;
    const extras = item.getFlag?.(MODULE_ID, "extras") ?? item.flags?.[MODULE_ID]?.extras;
    const rows = Array.isArray(extras?.effects) ? extras.effects.filter(isArmourLimitRow) : [];
    for (const row of rows) {
      const verdict = armourCeiling(loadout, resolveArmourGate(row.gate));
      if (verdict === true) blocked.add(item.name);
      else if (verdict === null) undecided.add(item.name);
    }
  }
  return { blocked: [...blocked].sort(), undecided: [...undecided].sort() };
}
