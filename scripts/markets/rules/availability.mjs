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
 * twice as much. House extension (setting-gated, DECISIONS): each extended
 * dedicated search day adds one further increment of the base value.
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
  return cell.kind === "pct" ? Math.max(pctStock, exists ? 1 : 0) : 0;
}

/**
 * Roll the market-wide monthly stock for a %-cell: ten times the cell's
 * chance, split into guaranteed units plus a d100 for the remainder
 * (230% → 2 units + 30% chance of a third). Once per item per month.
 * @param {number} chance - the cell's percent (1–99)
 * @param {() => number} [rand] - percentile source, injectable for tests
 */
export function pctMarketStock(chance, rand = Math.random) {
  const total = Math.max(0, Number(chance) || 0) * MARKET_CAP_MULTIPLIER;
  const base = Math.floor(total / 100);
  const rem = total % 100;
  if (rem <= 0) return { stock: base, detail: `${chance}%×${MARKET_CAP_MULTIPLIER} → ${base}` };
  const d100 = Math.floor(rand() * 100) + 1;
  const stock = base + (d100 <= rem ? 1 : 0);
  return { stock, detail: `${chance}%×${MARKET_CAP_MULTIPLIER} = ${base} + ${rem}%: d100 ${d100} → ${stock}` };
}

/**
 * How many existence rolls a party may make on a %-cell this month: the
 * base one, plus one per extended search day.
 */
export function existenceRollsAllowed(cell, { extraSearchDays = 0 } = {}) {
  return cell.kind === "pct" ? 1 + Math.max(0, extraSearchDays) : 0;
}

/**
 * Remaining units a party may trade for one distinct item this month, in
 * one direction, clamped by the cross-party market total.
 *
 * @param {object} o
 * @param {{kind:string}} o.cell - parsed availability cell
 * @param {"bought"|"sold"} o.direction - ledger counter to charge
 * @param {object|null} o.ledgerRow - this party's month row (bought/sold/doubled)
 * @param {object|null} o.totalsRow - the market's month row (bought/sold)
 * @param {number} o.extraSearchDays - party's extended-search days this month
 * @param {boolean} o.exists - %-cells: whether the cached roll found the unit
 * @param {number} [o.pctStock] - %-cells: the market's rolled monthly stock
 * @returns {{remaining:number, capParty:number, capMarket:number}}
 */
export function remainingFor({ cell, direction, ledgerRow, totalsRow, extraSearchDays = 0, exists = false, pctStock = 0 }) {
  const used = Number(ledgerRow?.[direction] ?? 0);
  const usedMarket = Number(totalsRow?.[direction] ?? 0);
  if (cell.kind === "pct") {
    // Buying needs the party's own find; selling only needs the town to
    // have capacity — a failed contact roll does not empty the market of
    // buyers, so the location's rolled stock carries a sale through.
    const capM = marketCap(cell, { pctStock, exists });
    const cap = direction === "sold" ? (exists || pctStock > 0 ? 1 : 0) : exists ? 1 : 0;
    return { remaining: Math.max(0, Math.min(cap - used, capM - usedMarket)), capParty: cap, capMarket: capM };
  }
  const capParty = partyCap(cell, { doubled: !!ledgerRow?.doubled, extraSearchDays });
  const capMarket = marketCap(cell);
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
