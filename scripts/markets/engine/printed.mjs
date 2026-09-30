/* global game */
/**
 * The one reader of the printed figures the market rules run on. Every number
 * the pure rules need beyond structure (the shopping crowd, the all-parties
 * multiple, the Bargaining swing, a magic-item price, an impact cap, a result
 * band, a merchant's profile) is the Judge's own, imported from their books
 * into a prose table; this module reads each table through the registry and
 * hands the engine plain numbers to pass to the rules.
 *
 * Every accessor answers `null` for anything absent — a table that is not
 * imported, a key the page did not yield, a value that is not a number — and
 * never a default: a caller that gets `null` refuses its action with
 * `printedError`, naming the table. A figure the market does not have is not
 * a figure to guess.
 */
import { LANG } from "../constants.mjs";
import { RARITIES } from "../config.mjs";
import { optTable } from "../../henchmen/rules/tables.mjs";
import { numOrNull } from "../../lib/util.mjs";
import { tiersNamed } from "../rules/identification.mjs";
import { stepFractionOf } from "../rules/pricing.mjs";
import { merchandiseFor } from "./merchandise.mjs";

/** A prose table is a flat object of keys; anything else is not one. */
const flat = (table) => (table && typeof table === "object" && !Array.isArray(table) ? table : null);

/** The named keys of a prose table as numbers, or null when the table or any key is absent. */
function numbersOf(table, names) {
  const t = flat(table);
  if (!t) return null;
  const out = {};
  for (const name of names) {
    const n = numOrNull(t[name]);
    if (n === null) return null;
    out[name] = n;
  }
  return out;
}

/** A five-rung result column as `{min, max}` pairs (null = open end), or null when it is not one. */
function bandsOf(table) {
  const bands = flat(table)?.bands;
  if (!Array.isArray(bands) || bands.length !== 5) return null;
  const out = bands.map((b) => ({ min: numOrNull(b?.min), max: numOrNull(b?.max) }));
  return out.every((b) => b.min !== null || b.max !== null) ? out : null;
}

/* ---------------------------------- errors ---------------------------------- */

/** The localized name of an imported table, for a message that says which one is missing. */
export const tableLabel = (tableId) => game.i18n.localize(`${LANG}.ventures.table.${tableId}`);

/** The result an action returns when a table it needs is unread: `{error, table}` with the table named. */
export const printedError = (tableId) => ({ error: "printedMissing", table: tableLabel(tableId) });

/* ------------------------------- availability ------------------------------- */

/**
 * Named whole numbers from the market rules (`crowdSize`, `crowdMultiplier`,
 * `marketTotalMultiplier`, `localHubShift`, `regionalHubShift`, `lostOnRoll`).
 * @param {string[]} names - only the ones the caller needs
 * @returns {Record<string, number>|null}
 */
export const marketRules = (names) => numbersOf(optTable("availability", "marketRulesProse"), names);

/** The Bargaining proficiency's printed swing: `{buyPct, sellPct, rankBonus}`, or null. */
export const bargaining = () => numbersOf(optTable("availability", "bargainingProse"), ["buyPct", "sellPct", "rankBonus"]);

/* ------------------------------- magic items -------------------------------- */

/**
 * Named magic-item price figures (`selfMadeTimes`, `buyPct`).
 * @param {string[]} names
 * @returns {Record<string, number>|null}
 */
export const magicPrices = (names) => numbersOf(optTable("magicItems", "priceProse"), names);

/**
 * The identification ladder's printed thresholds. Each field is null when the
 * page did not yield it, so a method that needs only some of them still works.
 * @returns {{researchCasterLevel: number|null, engineeringTiers: Set<string>|null, dabblingBackfire: [number, number]|null}}
 */
export function identification() {
  const t = flat(optTable("magicItems", "identifyProse")) ?? {};
  const band = Array.isArray(t.dabblingBackfire) ? t.dabblingBackfire.map(numOrNull) : [];
  return {
    researchCasterLevel: numOrNull(t.researchCasterLevel),
    engineeringTiers: typeof t.engineeringTiers === "string" ? tiersNamed(t.engineeringTiers, RARITIES) : null,
    dabblingBackfire: band.length === 2 && band.every((n) => n !== null) ? band : null,
  };
}

/* -------------------------------- mercantile -------------------------------- */

/** Market impact's printed limits: `{impactCap, familyScaledClass, familiesPerImpact}`, or null. */
export const impactLimits = () => numbersOf(optTable("mercantile", "impactProse"), ["impactCap", "familyScaledClass", "familiesPerImpact"]);

/** The Assessment of Supply and Demand's five result bands, or null. */
export const assessmentBands = () => bandsOf(optTable("mercantile", "assessmentProse"));

/** The monthly price's class and season shifts, or null. */
export const priceShifts = () =>
  numbersOf(optTable("mercantile", "priceShiftProse"), ["largeClassEdge", "largeClassShift", "smallClassEdge", "smallClassShift", "sowingShift", "harvestShift"]);

/**
 * The spot-price negotiation's printed figures: the typical merchant per tier,
 * the extra ranks a well-served market adds, the per-rank step and the five
 * result bands. Null when any is absent.
 * @returns {{common: {cha: number, ranks: number}, precious: {cha: number, ranks: number}, extraRanks: number, rankStep: number, bands: {min: number|null, max: number|null}[]}|null}
 */
export function negotiation() {
  const table = optTable("mercantile", "negotiationProse");
  const n = numbersOf(table, ["commonCha", "commonRanks", "preciousCha", "preciousRanks", "extraRanks", "rankStep"]);
  const bands = bandsOf(table);
  if (!n || !bands) return null;
  return {
    common: { cha: n.commonCha, ranks: n.commonRanks },
    precious: { cha: n.preciousCha, ranks: n.preciousRanks },
    extraRanks: n.extraRanks,
    rankStep: n.rankStep,
    bands,
  };
}

/**
 * One demand step as a fraction of value for an item's merchandise category,
 * derived from the catalogue row (`priceStepGp / pricePerStoneGp`, so a Judge's
 * own good takes part); null when the item has no category or the category no
 * priced row (no demand shift applies).
 */
export function stepFractionFor(category) {
  const row = category ? merchandiseFor(category) : null;
  return row ? stepFractionOf({ pricePerStone: row.pricePerStoneGp, priceStep: row.priceStepGp }) : null;
}
