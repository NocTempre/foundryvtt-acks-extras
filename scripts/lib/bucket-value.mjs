/**
 * What a bucket row is worth, as pure functions over figures the caller
 * passes in. No price, multiplier, level table or exclusion is stated here:
 * an item's cost is the item's own, a creature's award is the actor's, and
 * the multiplier, the award-by-level table and the predicates that bar a
 * creature are the caller's (magic reads them from the imported tables and
 * its own flags). A figure not read is `null`, never zero and never one, so
 * a row without one reaches the screen blank with its page reference in the
 * tooltip.
 *
 * A VALUE is `{gp, each?, source, cite, basis?, effects?, reason?}`:
 * `source` says where the figure came from (`cost`, `components`, `xp`,
 * `unimported`, `excluded`), `basis` the figures it was made of for the
 * tooltip, `effects` the names a monster part answers to (the fit match reads
 * them; they are never added to the figure), `reason` why a creature is barred.
 *
 * Foundry-free.
 */
import { stackCountOf } from "./item-model.mjs";

/** A figure as a finite number, else null. */
const figure = (n) => (n === null || n === undefined || n === "" || !Number.isFinite(Number(n)) ? null : Number(n));

/** A value that was not read: `gp` null, with the page the figure is printed on. */
export const blankValue = (cite = null, source = "unimported") => ({ gp: null, source, cite });

/**
 * An item: its own `system.cost` times the stack count.
 * @param {{cost: *, count?: number, cite?: string|null}} item `count` is how many of the stack count
 */
export function itemValue({ cost, count = 1, cite = null } = {}) {
  const each = figure(cost);
  const n = Math.max(1, Math.floor(Number(count)) || 1);
  if (each === null) return blankValue(cite);
  return { gp: each * n, each, source: "cost", cite, basis: { qty: n } };
}

/**
 * A monster part: its imported spoil's cost times the stack count. Its
 * `researchEffects` are carried beside the figure, not added to it: they name
 * the effects the part serves, which the fit match reads.
 * @param {{cost: *, count?: number, effects?: string[], cite?: string|null}} part
 */
export function partValue({ cost, count = 1, effects = [], cite = null } = {}) {
  return { ...itemValue({ cost, count, cite }), effects: (Array.isArray(effects) ? effects : []).map((e) => String(e).trim()).filter(Boolean) };
}

/**
 * The XP award as a figure in gold, through the multiplier.
 * `multiplier` is three-valued: `undefined` means this reading has none, `null`
 * means it applies and is not imported (the value is blank), a number is applied.
 */
function awardValue(xp, multiplier, cite) {
  const award = figure(xp);
  if (award === null) return blankValue(cite);
  if (multiplier === undefined) return { gp: award, source: "xp", cite, basis: { xp: award } };
  const k = figure(multiplier);
  if (k === null) return blankValue(cite);
  return { gp: award * k, source: "xp", cite, basis: { xp: award, multiplier: k } };
}

/**
 * Why a creature's XP may not stand in for its value, or null: the first of
 * `animal`, `summoned`, `young` its predicates answer. The predicates are the
 * caller's (summoned is the family's `SUMMON_FLAG` read; an ordinary animal and
 * a young creature are the caller's own tests); one not supplied bars nothing.
 * @param {object} actor
 * @param {{isAnimal?: Function, isSummoned?: Function, isYoung?: Function}} bars
 */
export function fallbackBar(actor, { isAnimal, isSummoned, isYoung } = {}) {
  if (isAnimal?.(actor)) return "animal";
  if (isSummoned?.(actor)) return "summoned";
  if (isYoung?.(actor)) return "young";
  return null;
}

/**
 * A creature: the sum of its component-flagged items, else its XP award, the
 * award only where no bar applies. The sum is not barred, since a creature that
 * carries priced parts is worth them whatever it is.
 * @param {object} actor
 * @param {object} figures
 * @param {object[]} [figures.items] the creature's items
 * @param {(item: object) => boolean} figures.isComponent the caller's reading of the component flag
 * @param {(item: object) => *} [figures.costOf] an item's cost (`system.cost`)
 * @param {(item: object) => number} [figures.countOf] an item's stack count; its own stack by default
 * @param {(actor: object) => *} figures.xpOf the creature's XP award (Judge-editable)
 * @param {number|null} [figures.multiplier] see `awardValue`
 * @param {object} [figures.bars] the predicates `fallbackBar` takes
 * @param {string|null} [figures.cite]
 */
export function creatureValue(actor, { items = [...(actor?.items ?? [])], isComponent, costOf = (i) => i?.system?.cost, countOf = (i) => stackCountOf(i) ?? 1, xpOf, multiplier, bars = {}, cite = null } = {}) {
  const priced = items.filter((i) => isComponent?.(i) && figure(costOf(i)) !== null);
  if (priced.length) {
    const gp = priced.reduce((sum, i) => sum + figure(costOf(i)) * Math.max(1, Math.floor(Number(countOf(i))) || 1), 0);
    return { gp, source: "components", cite, basis: { parts: priced.length } };
  }
  const reason = fallbackBar(actor, bars);
  if (reason) return { gp: 0, source: "excluded", cite, reason };
  return awardValue(xpOf?.(actor), multiplier, cite);
}

/**
 * A character victim: the XP award for its level, read from the imported
 * table the caller holds, through the multiplier. `award(level)` answers a
 * figure or null; with no table imported the value is blank.
 * @param {number} level
 * @param {{award?: (level: number) => *, multiplier?: number|null, cite?: string|null}} figures
 */
export function characterValue(level, { award, multiplier, cite = null } = {}) {
  const xp = typeof award === "function" ? award(level) : null;
  return awardValue(xp, multiplier, cite);
}
