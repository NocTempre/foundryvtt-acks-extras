/* global Roll */
/**
 * The gate a party passes to enter a market (RR ch. 8, Entering the Market,
 * step 3): the toll on the cargo capacity it brings, the tariff on the
 * merchandise it carries in, and the Ruler's Privilege that waives both. One
 * quote serves the Enter dialog's preview and the entry that pays it, so the
 * trader is shown what the gate takes; the entry quotes again on the seat
 * that writes, which can see every load the previewing seat may not.
 */
import { parseTollCpPerSt, parseTariffPct, tariffOn, diceRange } from "../rules/arbitrage.mjs";
import { merchandiseTierOf } from "../merchandise-keys.mjs";
import { getSetting } from "../settings.mjs";
import { optTable } from "../../henchmen/rules/tables.mjs";
import { findRow } from "../../lib/tables.mjs";
import { holdOf } from "../../vehicles/hold.mjs";
import { merchandiseFor } from "./merchandise.mjs";
import { manifestOf } from "./manifest.mjs";
import { partyOf, partyMembers } from "./parties.mjs";
import { tariffDice, printedError } from "./printed.mjs";

const TIERS = Object.freeze(["precious", "common"]);
const tierOf = (load) => (load.tier === "precious" ? "precious" : "common");

/** The imported Market Characteristics row for a class (null when absent). */
export function characteristicsFor(marketClass) {
  const rows = optTable("mercantile", "marketCharacteristics")?.rows ?? [];
  return findRow(rows, (r) => Number(r.marketClass) === Number(marketClass)) ?? null;
}

/**
 * The domain the market lies in, where the trader or a member of the trader's
 * party rules it. Read through the domains feature's api at call time; null
 * without that feature, where no domain holds the market or anything it
 * stands in, or where its ruler is none of them.
 */
export function privilegeDomain(location, trader) {
  let domain = null;
  try {
    domain = globalThis.acksExtras?.domains?.domainOf?.(location) ?? null;
  } catch {
    domain = null;
  }
  const ruler = domain?.system?.rulerUuid;
  if (!ruler || !trader) return null;
  const party = new Set([trader.uuid, ...partyMembers(partyOf(trader).id).map((a) => a.uuid)]);
  return party.has(ruler) ? domain : null;
}

/**
 * The loads the gate charges a tariff on: every merchandise load in the
 * entering trader's own packs and in the holds of the vehicles entering with
 * them — the holds the venture's trades buy into and sell from — less goods
 * kept aboard for anyone else. Each carries its good's base price per stone
 * (the catalogue's, else the load's own cost), its tier and its exemption.
 * @returns {{category: string, label: string, holderName: string, stones: number, basePriceGp: number, tier: string, exempt: boolean}[]}
 */
export function enteringLoads(trader, vehicles = []) {
  const { rows } = manifestOf([trader, ...vehicles], { traderUuid: trader.uuid });
  return rows.map((row) => {
    const good = merchandiseFor(row.category);
    return {
      category: row.category,
      label: row.label,
      holderName: row.holderName,
      stones: row.stones,
      basePriceGp: Number(good?.pricePerStoneGp) || row.unitGp,
      tier: good?.tier ?? merchandiseTierOf(row.category) ?? "common",
      exempt: !!good?.tariffExempt,
    };
  });
}

/**
 * What the gate charges `trader` entering `location` with `vehicles` and
 * `otherSt` stone of other capacity (porters, pack animals).
 *
 * The toll is the class's per-stone toll on the whole capacity. The tariff is
 * `tariffOn` the entering loads at the class's printed rates — or, where the
 * Judge randomizes it (`marketsRandomTariff`) and a load is taxable, at rates
 * thrown per tier at the gate: `dice` names each tier's throw (null for a
 * tier the class does not tariff), `range` the totals they can come to, and
 * `tariff` is null until `settleTariff` throws them. A party one of whose
 * members rules the market's domain pays neither (`privilege`).
 *
 * Refuses `noCharacteristics` where the class's row is unread, and the
 * printed error where its tariff cell, or the dice a randomized tariff needs,
 * cannot be read.
 * @returns {{error: string, table?: string}|{capacitySt: number, privilege: {uuid: string, name: string}|null, tollCp: number, loads: object[], rates: {precious: number, common: number}|null, dice: {precious: string|null, common: string|null}|null, range: {minCp: number, maxCp: number}|null, tariff: {totalCp: number, lines: object[]}|null}}
 */
export function entryQuote(location, trader, { vehicles = [], otherSt = 0 } = {}) {
  const capacitySt = Math.round(Math.round(Math.max(0, Number(otherSt) || 0)) + vehicles.reduce((n, v) => n + Math.max(0, holdOf(v)?.capacity ?? 0), 0));
  const ch = characteristicsFor(location.system.marketClass);
  if (!ch) return { error: "noCharacteristics" };
  const loads = enteringLoads(trader, vehicles);
  const quote = { capacitySt, privilege: null, tollCp: 0, loads, rates: null, dice: null, range: null, tariff: null };
  const domain = privilegeDomain(location, trader);
  if (domain) {
    const free = { precious: 0, common: 0 };
    return { ...quote, privilege: { uuid: domain.uuid, name: domain.name }, rates: free, tariff: tariffOn(loads, free) };
  }
  quote.tollCp = Math.ceil(parseTollCpPerSt(ch.toll) * capacitySt);
  const printed = parseTariffPct(ch.tariff);
  if (!printed) return printedError("marketCharacteristics");
  const taxable = loads.some((l) => !l.exempt && l.stones > 0 && l.basePriceGp > 0 && printed[tierOf(l)] > 0);
  if (!taxable || !getSetting("marketsRandomTariff")) return { ...quote, rates: printed, tariff: tariffOn(loads, printed) };
  const thrown = tariffDice();
  if (!thrown) return printedError("tariffProse");
  const dice = Object.fromEntries(TIERS.map((tier) => [tier, printed[tier] > 0 ? thrown[tier] : null]));
  const at = (end) => Object.fromEntries(TIERS.map((tier) => [tier, dice[tier] ? diceRange(dice[tier])[end] : 0]));
  return { ...quote, dice, range: { minCp: tariffOn(loads, at("min")).totalCp, maxCp: tariffOn(loads, at("max")).totalCp } };
}

/**
 * The tariff the gate takes on a quote: its own where the rates are printed,
 * or thrown now — once per tier the quote has dice for and a load to tax —
 * where the Judge randomizes it. `rolls` records each throw.
 * @returns {Promise<{totalCp: number, lines: object[], rates: {precious: number, common: number}, rolls: {tier: string, formula: string, total: number}[]}>}
 */
export async function settleTariff(quote) {
  if (!quote.dice) return { ...quote.tariff, rates: quote.rates, rolls: [] };
  const rates = { precious: 0, common: 0 };
  const rolls = [];
  for (const tier of TIERS) {
    const formula = quote.dice[tier];
    if (!formula || !quote.loads.some((l) => tierOf(l) === tier && !l.exempt && l.stones > 0)) continue;
    const total = (await new Roll(formula).evaluate()).total;
    rates[tier] = total;
    rolls.push({ tier, formula, total });
  }
  return { ...tariffOn(quote.loads, rates), rates, rolls };
}
