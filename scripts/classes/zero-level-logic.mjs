/**
 * Leaving 0th level (RR ch. 6, 0th Level Characters and Experience from
 * Adventuring; JJ ch. 9, Advancement to 1st Level): the experience it takes,
 * and the first answer for each proficiency the character already held.
 * Every figure is the imported `experience` table's and is passed in.
 * Foundry-free.
 */

/** What advancing makes of one proficiency the character held. */
export const SETTLE = Object.freeze({
  keep: "keep",
  replaced: "replaced", // a class power of the new class stands in its place
  lost: "lost", // a class proficiency the new class does not list
  erodes: "erodes", // a general one over the limit, lost a month at a time
});

/** The ability buckets (`sheet-tabs.mjs` `abilityBucket`) that hold proficiencies. */
export const PROFICIENCY_BUCKETS = Object.freeze(["general", "class", "fighting"]);

/**
 * The experience a 0th-level character needs for 1st level: the imported
 * figure per proficiency short of the imported base, where both were read and
 * the character holds any proficiency; otherwise the figure printed for a
 * count nobody knows. A character holding the base or more is ready at once.
 * Null with no table.
 * @param {{assumed?: number, base?: number, perProficiency?: number}|null} table
 * @param {number} count proficiencies held; none reads as unknown
 */
export function zeroLevelThreshold(table, count) {
  if (!table) return null;
  const n = Number(count) || 0;
  if (n > 0 && Number.isFinite(table.base) && Number.isFinite(table.perProficiency)) {
    return Math.max(0, (table.base - n) * table.perProficiency);
  }
  return Number.isFinite(table.assumed) ? table.assumed : null;
}

/**
 * How many general proficiencies a 1st-level character may hold: the general
 * picks the class grants through 1st, the Intellect bonus, and the implicit
 * slots time and training fill. Null where the implicit slots were never
 * imported, since the limit cannot then be counted.
 */
export function generalLimit({ levelPicks = 0, intBonus = 0, implicitSlots = null } = {}) {
  if (!Number.isFinite(implicitSlots)) return null;
  return Math.max(0, Number(levelPicks) || 0) + Math.max(0, Number(intBonus) || 0) + implicitSlots;
}

/** A name folded for matching: case, punctuation and spacing dropped. */
export const foldName = (name) =>
  String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** A test for "is this one of these", by ref or by folded name. */
function memberOf(list) {
  const refs = new Set(list.map((x) => x.ref).filter(Boolean));
  const names = new Set(list.map((x) => foldName(x.name)).filter(Boolean));
  return (p) => (!!p.ref && refs.has(p.ref)) || names.has(foldName(p.name));
}

/**
 * The first answer for each proficiency a 0th-level character held, before
 * the Judge changes any. One matching a class power the new class grants is
 * replaced by it; a class proficiency the new class does not list is lost;
 * every other one is kept. Equivalence beyond a shared ref or name is the
 * Judge's call, which is why these are only the first answers.
 * @param {object} args
 * @param {Array<{id: string, name: string, ref?: string, bucket: string}>} args.held
 * @param {Array<{name: string, ref?: string}>} args.powers what the class grants through 1st
 * @param {Array<{name: string, ref?: string}>} args.classList the class proficiencies it lists
 * @param {number|null} args.limit general proficiencies a 1st-level character may hold
 * @returns {{rows: Array<{id: string, name: string, bucket: string, answer: string}>, general: number, over: number|null}}
 *   `general` counts the general rows not replaced; `over` is how many of
 *   them are past the limit, null where there is no limit to count against
 */
export function settleProficiencies({ held = [], powers = [], classList = [], limit = null } = {}) {
  const isPower = memberOf(powers);
  const listed = memberOf(classList);
  const rows = held.map((p) => ({
    id: p.id,
    name: p.name,
    bucket: p.bucket,
    answer: isPower(p) ? SETTLE.replaced : p.bucket === "class" && !listed(p) ? SETTLE.lost : SETTLE.keep,
  }));
  const general = rows.filter((r) => r.bucket === "general" && r.answer !== SETTLE.replaced).length;
  return { rows, general, over: Number.isFinite(limit) ? Math.max(0, general - limit) : null };
}
