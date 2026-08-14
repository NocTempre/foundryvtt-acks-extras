/**
 * Equipment availability math (RR §IV.3). Pure module — no Foundry imports;
 * the engine feeds it table rows, ledger rows and month starts, and rolls
 * dice itself.
 *
 * Cell language (the imported Equipment Availability / Magic Item
 * Transaction grids): "2,750" — monthly units of each specific item per
 * party; "25%" — chance exactly ONE unit exists in the market this month;
 * "-" / "NA" — never available. This grammar is narrower than the
 * recruitment tables' dice expressions (henchmen rules/dice.mjs), which is
 * why it is parsed here and not there.
 */
import { bracketRow } from "../../lib/tables.mjs";

/** Cross-party monthly market total, as a multiple of the per-party value. */
export const MARKET_CAP_MULTIPLIER = 10;

/**
 * @returns {{kind:"qty",n:number}|{kind:"pct",chance:number}|{kind:"none"}}
 */
export function parseCell(cell) {
  const t = String(cell ?? "").trim();
  if (!t || t === "-" || t === "—" || /^n\/?a$/i.test(t)) return { kind: "none" };
  const pct = t.match(/^(\d+)\s*%$/);
  if (pct) return { kind: "pct", chance: parseInt(pct[1], 10) };
  // Sub-unit values (the merchandise grid's fractional stones) are not item
  // stock — floor first so "0.4" reads as none, not a zero quantity.
  const n = Math.floor(Number(t.replace(/,/g, "")));
  if (Number.isFinite(n) && n > 0) return { kind: "qty", n };
  return { kind: "none" };
}

/**
 * The availability band row for a price, from the imported grid's rows
 * (each `{band, minCost, maxCost, byMarketClass}`). Prices below the lowest
 * band's floor fall into it (a 4sp flask is "1gp or less"); a non-positive
 * price is not tradeable.
 */
export function priceBandOf(costGp, rows) {
  const gp = Number(costGp);
  if (!Number.isFinite(gp) || gp <= 0) return null;
  // Band bounds are the book's integers ("2 – 10gp"); a 1.5gp price belongs
  // to the band above the floor it exceeds, so bracket the ceiling.
  return bracketRow(rows, Math.ceil(gp), "minCost", "maxCost") ?? null;
}

/** The parsed cell for a band row at a market class (1–6). */
export function cellFor(bandRow, marketClass) {
  const cells = bandRow?.byMarketClass ?? [];
  return parseCell(cells[marketClass - 1]);
}

/**
 * A party's monthly cap for one distinct item on a quantity cell.
 * RAW: 12+ adventurers devoting a dedicated activity to shopping purchase
 * twice as much (RR §IV.3); further dedicated days of soliciting expand the
 * daily supply a trader can reach (RR §VIII.6), applied here as one base
 * increment per extended search day (setting-gated).
 */
export function partyCap(cell, { doubled = false, extraSearchDays = 0 } = {}) {
  if (cell.kind !== "qty") return cell.kind === "pct" ? 1 : 0;
  return cell.n * ((doubled ? 2 : 1) + Math.max(0, extraSearchDays));
}

/**
 * The whole market's monthly cap for one distinct item (all parties).
 * %-cells pass the market's rolled stock (see `pctMarketStock`) and any
 * party's own successful existence roll, which floors it — the market
 * cannot hold fewer units than a party has already found.
 */
export function marketCap(cell, { pctStock = 0, exists = false } = {}) {
  if (cell.kind === "qty") return cell.n * MARKET_CAP_MULTIPLIER;
  if (cell.kind === "pct") return Math.max(pctStock, exists ? 1 : 0);
  // A party's find stands even where the town's own class stocks none (a
  // venturer's network reaches past the local stalls).
  return exists ? 1 : 0;
}

/**
 * The market-wide monthly stock for a %-cell: ten times the cell's chance,
 * as guaranteed whole units plus AT MOST ONE roll for the fractional
 * remainder (230% → 2 units, d100 vs 30 for a third). The party's own
 * existence roll comes FIRST: it floors the stock, and when the floor
 * already decides the answer (no whole units, party found one) no market
 * roll is made at all.
 *
 * Returns null when a d100 is required and not supplied — the caller rolls
 * and asks again. Once per item per month.
 *
 * @param {number} chance - the cell's percent (1–99)
 * @param {object} [o]
 * @param {boolean} [o.partyFound] - the asking party's existence roll succeeded
 * @param {number|null} [o.d100] - percentile result for the remainder
 * @returns {{stock:number, detail:string}|null}
 */
export function pctMarketStock(chance, { partyFound = false, d100 = null } = {}) {
  const tenfold = Math.max(0, Number(chance) || 0) * MARKET_CAP_MULTIPLIER;
  const base = Math.floor(tenfold / 100);
  const rem = tenfold % 100;
  if (rem <= 0) return { stock: base, detail: `${chance}% ×${MARKET_CAP_MULTIPLIER} → ${base}` };
  if (base === 0 && partyFound) return { stock: 1, detail: "party find floors the stock" };
  if (d100 == null) return null;
  const stock = Math.max(base + (d100 <= rem ? 1 : 0), partyFound ? 1 : 0);
  return { stock, detail: `${chance}% ×${MARKET_CAP_MULTIPLIER} = ${base} + ${rem}%: d100 ${d100} → ${stock}` };
}

/**
 * Remaining units a party may trade for one distinct item this month, in
 * one direction, clamped by the cross-party market total.
 *
 * A venturer treating the market as a higher class dips into a GREATER SHARE
 * of the same market: their party cell reads at the effective class, but the
 * market total stays the town's true class (`marketCell`).
 *
 * @param {object} o
 * @param {{kind:string}} o.cell - parsed cell at the party's EFFECTIVE class
 * @param {{kind:string}} [o.marketCell] - parsed cell at the town's TRUE class
 * @param {"bought"|"sold"} o.direction - ledger counter to charge
 * @param {object|null} o.ledgerRow - this party's month row (bought/sold)
 * @param {object|null} o.totalsRow - the market's month row (bought/sold)
 * @param {boolean} [o.doubled] - party claimed the 12+ dedicated-shopping day
 * @param {number} o.extraSearchDays - party's extended-search days this month
 * @param {boolean} o.exists - %-cells: whether the cached roll found the unit
 * @param {number} [o.pctStock] - the market's rolled monthly stock (true-class %-cells)
 * @returns {{remaining:number, capParty:number, capMarket:number}}
 */
export function remainingFor({ cell, marketCell = null, direction, ledgerRow, totalsRow, doubled = false, extraSearchDays = 0, exists = false, pctStock = 0 }) {
  const mCell = marketCell ?? cell;
  const used = Number(ledgerRow?.[direction] ?? 0);
  const usedMarket = Number(totalsRow?.[direction] ?? 0);
  const capMarket = marketCap(mCell, { pctStock, exists });
  if (cell.kind === "pct") {
    // Buying needs the party's own find; selling only needs the town to
    // have capacity — a failed contact roll does not empty the market of
    // buyers, so the location's rolled stock carries a sale through.
    const cap = direction === "sold" ? (exists || capMarket > 0 ? 1 : 0) : exists ? 1 : 0;
    return { remaining: Math.max(0, Math.min(cap - used, capMarket - usedMarket)), capParty: cap, capMarket };
  }
  const capParty = partyCap(cell, { doubled, extraSearchDays });
  return {
    remaining: Math.max(0, Math.min(capParty - used, capMarket - usedMarket)),
    capParty,
    capMarket,
  };
}

/**
 * The distinct-item ledger key: case-folded trimmed name, the same identity
 * the gear-grant lookup matches on. A bundle item (20 arrows) is one key.
 */
export function itemKeyOf(name) {
  return String(name ?? "").trim().toLowerCase();
}
