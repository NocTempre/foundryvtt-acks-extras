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
import { optTable, optCite } from "../../henchmen/rules/tables.mjs";
import { numOrNull } from "../../lib/util.mjs";
import { tiersNamed } from "../rules/identification.mjs";
import { stepFractionOf } from "../rules/pricing.mjs";
import { HUBS, parseHubWait } from "../rules/imports.mjs";
import { diceRange, parseStayFee } from "../rules/arbitrage.mjs";
import { parseDiceTerm } from "../rules/gate-toll.mjs";
import { parseMiles } from "../rules/routes.mjs";
import { findRow, isMissingRow } from "../../lib/tables.mjs";
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

/** The localized name of an imported table, carried in a refusal's `table` for the caller that wants to name it. */
export const tableLabel = (tableId) => game.i18n.localize(`${LANG}.ventures.table.${tableId}`);

/** The result an action returns when a table it needs is unread: `{error, table}` with the table named; the shown text is blank (`refusal.mjs`). */
export const printedError = (tableId) => ({ error: "printedMissing", table: tableLabel(tableId) });

/* ------------------------------- availability ------------------------------- */

/**
 * Named whole numbers from the market rules (`crowdSize`, `crowdMultiplier`,
 * `marketTotalMultiplier`, `localHubShift`, `regionalHubShift`, `lostOnRoll`).
 * A hub's wait is a phrase, not a number: `hubWait`.
 * @param {string[]} names - only the ones the caller needs
 * @returns {Record<string, number>|null}
 */
export const marketRules = (names) => numbersOf(optTable("availability", "marketRulesProse"), names);

/**
 * How long an order from a hub waits, as the page prints it: `{dice, unit,
 * seconds}`, or null when the market rules are not imported or hold no wait
 * for that hub.
 * @param {string} hub - a key of `HUBS`
 */
export const hubWait = (hub) => {
  const key = Object.hasOwn(HUBS, hub) ? HUBS[hub].waitKey : null;
  return key ? parseHubWait(flat(optTable("availability", "marketRulesProse"))?.[key]) : null;
};

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
 * the extra ranks a well-served market adds, the per-rank step, how many
 * price steps an agreement moves the price, and the five result bands. Null
 * when any is absent.
 * @returns {{common: {cha: number, ranks: number}, precious: {cha: number, ranks: number}, extraRanks: number, rankStep: number, priceSteps: number, bands: {min: number|null, max: number|null}[]}|null}
 */
export function negotiation() {
  const table = optTable("mercantile", "negotiationProse");
  const n = numbersOf(table, ["commonCha", "commonRanks", "preciousCha", "preciousRanks", "extraRanks", "rankStep", "priceSteps"]);
  const bands = bandsOf(table);
  if (!n || !bands) return null;
  return {
    common: { cha: n.commonCha, ranks: n.commonRanks },
    precious: { cha: n.preciousCha, ranks: n.preciousRanks },
    extraRanks: n.extraRanks,
    rankStep: n.rankStep,
    priceSteps: n.priceSteps,
    bands,
  };
}

/**
 * The dice the Judge's optional randomized tariff throws per tier, as
 * `{precious, common}` formulas, or null when either is absent or is not one
 * plain die term.
 * @returns {{precious: string, common: string}|null}
 */
export function tariffDice() {
  const t = flat(optTable("mercantile", "tariffProse"));
  const precious = typeof t?.preciousDie === "string" ? t.preciousDie.trim() : "";
  const common = typeof t?.commonDie === "string" ? t.commonDie.trim() : "";
  return diceRange(precious) && diceRange(common) ? { precious, common } : null;
}

/**
 * The Moorage and Stabling daily rates by kind (`ship`, `wagon`,
 * `cartElephant`, `horse`, `camelDonkeyOx`), each `{berth, anchor}` as
 * `parseStayFee` reads its cell, or null when the table is not imported. A
 * kind whose row is missing or whose cells do not read is left out, so a
 * caller that needs it refuses.
 * @returns {Record<string, {berth: {cp: number, perShp: number|null}, anchor: {cp: number, perShp: number|null}}>|null}
 */
export function stayRates() {
  const rows = optTable("mercantile", "moorageRates")?.rows;
  if (!Array.isArray(rows)) return null;
  const out = {};
  for (const row of rows) {
    if (isMissingRow(row) || !row.kind) continue;
    const berth = parseStayFee(row.berth);
    const anchor = parseStayFee(row.anchor);
    if (berth && anchor) out[row.kind] = { berth, anchor };
  }
  return out;
}

/* ------------------------------- trade routes ------------------------------- */

/**
 * A market class's Range of Trade (JJ ch. 6, Step 7E): `{road, water}` in
 * miles, or null when the table is not imported, the class has no row, or
 * either cell does not read as miles. The class is taken as given, never
 * clamped: a class the table does not print has no range.
 * @param {number|string} marketClass
 * @returns {{road: number, water: number}|null}
 */
export function rangeOfTradeFor(marketClass) {
  const rows = optTable("demand", "rangeOfTrade")?.rows;
  if (!Array.isArray(rows)) return null;
  const row = findRow(rows, (r) => Number(r.marketClass) === Number(marketClass));
  const road = parseMiles(row?.road);
  const water = parseMiles(row?.water);
  return road !== null && water !== null ? { road, water } : null;
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

/* ------------------------------- city gates -------------------------------- */

/**
 * The city gate's imported toll and duty: the toll's dice in gp and the
 * stones one throw covers, and the duty's percent dice where the page prints
 * one (`duty` is null where it does not), with the page they were read from.
 * Null when the table is not imported, its toll dice do not read as one dice
 * term or its stones are not above none, or it holds a duty that does not
 * read: a charge the gate cannot read is never a free one.
 * @returns {{toll: {dice: string, perStones: number}, duty: {dicePercent: string}|null, cite: string|null}|null}
 */
export function cityGateTolls() {
  const t = flat(optTable("cityTravel", "gateTolls"));
  const dice = typeof t?.toll?.dice === "string" ? t.toll.dice.trim() : "";
  const perStones = numOrNull(t?.toll?.perStones);
  if (!parseDiceTerm(dice) || !(perStones > 0)) return null;
  const hasDuty = t.duty !== undefined && t.duty !== null;
  const dutyDice = typeof t.duty?.dicePercent === "string" ? t.duty.dicePercent.trim() : "";
  if (hasDuty && !parseDiceTerm(dutyDice)) return null;
  return { toll: { dice, perStones }, duty: hasDuty ? { dicePercent: dutyDice } : null, cite: optCite("cityTravel", "gateTolls") };
}
