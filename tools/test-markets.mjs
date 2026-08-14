/**
 * Pure-rules regression tests for the markets feature: availability cell
 * grammar, price-band bracketing, cap math (doubling, extended search, the
 * tenfold market clamp, distinct items), pricing order and copper rounding,
 * magic-item pricing bases, and import arrival/loss arithmetic.
 *
 * Run: npm test
 */
import assert from "node:assert";

const { parseCell, priceBandOf, cellFor, partyCap, marketCap, pctMarketStock, remainingFor, itemKeyOf, MARKET_CAP_MULTIPLIER } =
  await import(new URL("../scripts/markets/rules/availability.mjs", import.meta.url));
const { quote, magicQuote, magicBandValueGp, bargainWinner, toCopper, toGp } =
  await import(new URL("../scripts/markets/rules/pricing.mjs", import.meta.url));
const { importPlan, dueImports, hubClass, SECONDS_PER_DAY, SECONDS_PER_WEEK } =
  await import(new URL("../scripts/markets/rules/imports.mjs", import.meta.url));
const { parseMoneyCp, commissionPlan } =
  await import(new URL("../scripts/markets/rules/commissions.mjs", import.meta.url));

/* ------------------------- cell grammar ------------------------- */

assert.deepStrictEqual(parseCell("2,750"), { kind: "qty", n: 2750 }, "comma quantity");
assert.deepStrictEqual(parseCell("1"), { kind: "qty", n: 1 }, "unit quantity");
assert.deepStrictEqual(parseCell("25%"), { kind: "pct", chance: 25 }, "percent cell");
assert.deepStrictEqual(parseCell("-"), { kind: "none" }, "dash");
assert.deepStrictEqual(parseCell("NA"), { kind: "none" }, "JJ NA cell");
assert.deepStrictEqual(parseCell(""), { kind: "none" }, "empty");
assert.deepStrictEqual(parseCell("0.4"), { kind: "none" }, "sub-unit merchandise cells are not item stock");

/* ------------------------- band bracketing ------------------------- */

// Shape mirrors the imported grid (values here are fixture data, not book data).
const BANDS = [
  { band: "le1", minCost: 0, maxCost: 1, byMarketClass: ["100", "50", "25", "10", "5", "2"] },
  { band: "2to10", minCost: 2, maxCost: 10, byMarketClass: ["30", "7", "3", "1", "1", "1"] },
  { band: "11to100", minCost: 11, maxCost: 100, byMarketClass: ["2", "1", "1", "1", "25%", "10%"] },
  { band: "ge101", minCost: 101, maxCost: null, byMarketClass: ["25%", "10%", "3%", "1%", "-", "-"] },
];

assert.strictEqual(priceBandOf(0.3, BANDS).band, "le1", "sub-gp price falls in the floor band");
assert.strictEqual(priceBandOf(1, BANDS).band, "le1", "band edge inclusive");
assert.strictEqual(priceBandOf(1.5, BANDS).band, "2to10", "between integer bounds rounds into the band above the floor");
assert.strictEqual(priceBandOf(10, BANDS).band, "2to10", "upper edge inclusive");
assert.strictEqual(priceBandOf(5000, BANDS).band, "ge101", "open top band");
assert.strictEqual(priceBandOf(0, BANDS), null, "zero cost is not tradeable");
assert.strictEqual(priceBandOf(-4, BANDS), null, "negative cost is not tradeable");

assert.deepStrictEqual(cellFor(BANDS[0], 1), { kind: "qty", n: 100 }, "class I column");
assert.deepStrictEqual(cellFor(BANDS[2], 5), { kind: "pct", chance: 25 }, "class V percent");
assert.deepStrictEqual(cellFor(BANDS[3], 6), { kind: "none" }, "class VI dash");

/* ------------------------- cap math ------------------------- */

const q10 = { kind: "qty", n: 10 };
assert.strictEqual(partyCap(q10), 10, "base cap");
assert.strictEqual(partyCap(q10, { doubled: true }), 20, "12+ dedicated shopping doubles");
assert.strictEqual(partyCap(q10, { extraSearchDays: 2 }), 30, "each extended day adds one base increment");
assert.strictEqual(partyCap(q10, { doubled: true, extraSearchDays: 1 }), 30, "doubling and search stack additively");
assert.strictEqual(marketCap(q10), 10 * MARKET_CAP_MULTIPLIER, "tenfold market total");

// Party remaining clamps against both its own cap and the market total.
assert.deepStrictEqual(
  remainingFor({ cell: q10, direction: "bought", ledgerRow: { bought: 4 }, totalsRow: { bought: 4 } }),
  { remaining: 6, capParty: 10, capMarket: 100 },
  "own purchases decrement"
);
assert.strictEqual(
  remainingFor({ cell: q10, direction: "bought", ledgerRow: { bought: 0 }, totalsRow: { bought: 97 } }).remaining,
  3,
  "other parties' purchases clamp through the market total"
);
assert.strictEqual(
  remainingFor({ cell: q10, direction: "sold", ledgerRow: { bought: 10, sold: 2 }, totalsRow: { sold: 2 } }).remaining,
  8,
  "sold counter is independent of bought"
);
assert.strictEqual(
  remainingFor({ cell: { kind: "pct", chance: 25 }, direction: "bought", ledgerRow: null, totalsRow: null, exists: true }).remaining,
  1,
  "existing percent unit is one unit even before the market stock rolls"
);
assert.strictEqual(
  remainingFor({ cell: { kind: "pct", chance: 25 }, direction: "bought", ledgerRow: null, totalsRow: null, exists: false, pctStock: 3 }).remaining,
  0,
  "market stock without a party success is still out of the party's reach"
);
assert.strictEqual(
  remainingFor({ cell: { kind: "pct", chance: 25 }, direction: "bought", ledgerRow: { bought: 1 }, totalsRow: { bought: 1 }, exists: true, pctStock: 3 }).remaining,
  0,
  "the party's one percent unit cannot be bought twice even with market stock left"
);

assert.strictEqual(
  remainingFor({ cell: { kind: "pct", chance: 10 }, direction: "sold", ledgerRow: null, totalsRow: null, exists: false, pctStock: 2 }).remaining,
  1,
  "a failed contact roll still sells into the location's rolled capacity"
);
assert.strictEqual(
  remainingFor({ cell: { kind: "pct", chance: 10 }, direction: "sold", ledgerRow: null, totalsRow: { sold: 2 }, exists: false, pctStock: 2 }).remaining,
  0,
  "the location's sale capacity exhausts across parties"
);
assert.strictEqual(
  remainingFor({ cell: { kind: "pct", chance: 10 }, direction: "sold", ledgerRow: null, totalsRow: null, exists: false, pctStock: 0 }).remaining,
  0,
  "no capacity and no find sells nothing"
);

// A venturer's effective class widens the party's share, not the market:
// party cell reads at the effective class, the total stays the true class.
assert.strictEqual(
  remainingFor({
    cell: { kind: "qty", n: 2 }, // effective class III
    marketCell: { kind: "qty", n: 1 }, // true class IV
    direction: "bought",
    ledgerRow: null,
    totalsRow: { bought: 9 },
  }).remaining,
  1,
  "the true-class tenfold total clamps a venturer's wider access"
);
assert.strictEqual(
  remainingFor({
    cell: { kind: "qty", n: 1 }, // effective class guarantees the find
    marketCell: { kind: "pct", chance: 25 }, // true class only chances it
    direction: "bought",
    ledgerRow: null,
    totalsRow: null,
    exists: true, // the guaranteed find floors the market stock
    pctStock: 0,
  }).remaining,
  1,
  "a guaranteed effective-class find stands even when the town's stock rolled zero"
);
assert.strictEqual(
  marketCap({ kind: "none" }, { exists: true }),
  1,
  "a party's find floors even a none cell at the town's class"
);

// Market-wide %-stock: tenfold chance as guaranteed whole units plus at
// most one roll for the fractional remainder, party roll first.
{
  assert.strictEqual(pctMarketStock(23, { d100: 30 }).stock, 3, "230%: remainder d100 30 ≤ 30 stocks a third unit");
  assert.strictEqual(pctMarketStock(23, { d100: 31 }).stock, 2, "230%: remainder failure keeps the two whole units");
  assert.strictEqual(pctMarketStock(10, {}).stock, 1, "100% is one whole unit, no roll spent");
  assert.strictEqual(pctMarketStock(5, {}), null, "50% remainder demands a roll when the floor cannot answer");
  assert.strictEqual(pctMarketStock(5, { partyFound: true }).stock, 1, "the party's find answers a floor-only cell without a roll");
  assert.strictEqual(pctMarketStock(5, { d100: 80 }).stock, 0, "a failed remainder with no find stocks nothing");
  assert.strictEqual(pctMarketStock(15, { partyFound: true, d100: 90 }).stock, 1, "a rolled failure still floors at the party's find");
  assert.strictEqual(
    marketCap({ kind: "pct", chance: 5 }, { pctStock: 0, exists: true }),
    1,
    "a party's successful roll floors the market stock at one"
  );
}

assert.strictEqual(itemKeyOf("  Sword "), "sword", "distinct-item key case-folds and trims");
assert.notStrictEqual(itemKeyOf("Sword"), itemKeyOf("Battle Axe"), "distinct items ledger separately");

/* ------------------------- pricing ------------------------- */

assert.strictEqual(toCopper(10), 1000, "gp to copper");
assert.strictEqual(toGp(1234), 12.34, "copper to gp");

assert.strictEqual(quote({ costGp: 10, direction: "buy" }).unitCp, 1000, "base buy");
assert.strictEqual(quote({ costGp: 10, direction: "buy", bargain: "party" }).unitCp, 900, "party bargain buys 10% cheaper");
assert.strictEqual(quote({ costGp: 10, direction: "sell", bargain: "party" }).unitCp, 1100, "party bargain sells 10% dearer");
assert.strictEqual(quote({ costGp: 10, direction: "buy", bargain: "merchant" }).unitCp, 1100, "merchant bargain raises the buy");
assert.strictEqual(quote({ costGp: 10, direction: "sell", bargain: "merchant" }).unitCp, 900, "merchant bargain lowers the sale");
assert.strictEqual(quote({ costGp: 10, direction: "sell", demandSteps: 3 }).unitCp, 1300, "positive demand steps raise price");
assert.strictEqual(quote({ costGp: 10, direction: "buy", demandSteps: -2 }).unitCp, 800, "negative demand steps lower price");
assert.strictEqual(quote({ costGp: 10, direction: "sell", valueMult: 1 / 3 }).unitCp, 333, "condition multiplier rounds to copper");
{
  const q = quote({ costGp: 10, direction: "sell", valueMult: 0.34, demandSteps: 1, bargain: "party" });
  // 1000 → 340 → 374 → 411 (each stage rounds to copper before the next)
  assert.strictEqual(q.unitCp, 411, "stages apply in order: condition, demand, bargaining");
  assert.deepStrictEqual(q.breakdown.map((b) => b.label), ["base", "condition", "demand", "bargaining"], "breakdown names each stage");
}
assert.strictEqual(quote({ costGp: 1, direction: "sell", demandSteps: -20 }).unitCp, 0, "price never goes negative");

assert.strictEqual(bargainWinner({ partyRanks: 1, merchantRanks: 0 }), "party", "only proficient side wins outright");
assert.strictEqual(bargainWinner({ partyRanks: 0, merchantRanks: 2 }), "merchant", "merchant-only likewise");
assert.strictEqual(bargainWinner({ partyRanks: 1, merchantRanks: 1, opposedWinner: "merchant" }), "merchant", "both proficient defers to the opposed roll");
assert.strictEqual(bargainWinner({}), null, "nobody proficient, no swing");

/* ------------------------- magic pricing ------------------------- */

assert.deepStrictEqual(
  magicQuote({ baseCostGp: 5000, apparentValueGp: 200, identified: "none", direction: "sell" }),
  { unitCp: 20000, basis: "apparent" },
  "unidentified sells at apparent value"
);
assert.deepStrictEqual(
  magicQuote({ baseCostGp: 5000, apparentValueGp: 200, identified: "partial", direction: "sell" }),
  { unitCp: 20000, basis: "apparent" },
  "partial identification still sells at apparent value"
);
assert.deepStrictEqual(
  magicQuote({ baseCostGp: 5000, apparentValueGp: 200, identified: "full", direction: "sell" }),
  { unitCp: 500000, basis: "base" },
  "full identification sells at base cost"
);
assert.deepStrictEqual(
  magicQuote({ baseCostGp: 1500, identified: "full", selfMade: true, direction: "sell" }),
  { unitCp: 300000, basis: "selfMade" },
  "self-made sells at twice base"
);
assert.deepStrictEqual(
  magicQuote({ baseCostGp: 500, identified: "full", direction: "buy" }),
  { unitCp: 112500, basis: "buyPremium" },
  "buying costs 225% of base"
);
assert.strictEqual(magicBandValueGp({ baseCostGp: 5000, apparentValueGp: 200, identified: "none" }), 200, "unidentified band by apparent value");
assert.strictEqual(magicBandValueGp({ baseCostGp: 5000, apparentValueGp: 200, identified: "full" }), 5000, "identified band by base cost");

/* ------------------------- imports ------------------------- */

assert.strictEqual(hubClass(4, 1), 3, "local hub is one class larger");
assert.strictEqual(hubClass(4, 2), 2, "regional hub is two classes larger");
assert.strictEqual(hubClass(1, 2), 1, "hub class never exceeds I");

{
  const p = importPlan({ roll2d6: 7, hubShift: 1, placedTime: 1000 });
  assert.strictEqual(p.lost, false, "7 arrives");
  assert.strictEqual(p.arrivalTime, 1000 + 7 * SECONDS_PER_DAY, "local hub counts days");
}
{
  const p = importPlan({ roll2d6: 5, hubShift: 2, placedTime: 0 });
  assert.strictEqual(p.arrivalTime, 5 * SECONDS_PER_WEEK, "regional hub counts weeks");
}
{
  const p = importPlan({ roll2d6: 12, hubShift: 2, placedTime: 0 });
  assert.strictEqual(p.lost, true, "12 is lost in transit");
  assert.strictEqual(p.arrivalTime, 12 * SECONDS_PER_WEEK, "loss reveals at the would-be arrival");
}

const orders = [
  { id: "a", status: "ordered", arrivalTime: 100 },
  { id: "b", status: "ordered", arrivalTime: 200 },
  { id: "c", status: "delivered", arrivalTime: 50 },
];
assert.deepStrictEqual(dueImports(orders, 150).map((o) => o.id), ["a"], "due picks only ripe ordered rows");
assert.deepStrictEqual(dueImports(orders, 500).map((o) => o.id), ["a", "b"], "delivered rows never re-resolve");

/* ------------------------- arbitrage ------------------------- */

const { parseStones, parseTollCpPerSt, marketImpact, assessmentOutcome, merchMarketPriceCp, negotiationOutcome, solicitedStones } =
  await import(new URL("../scripts/markets/rules/arbitrage.mjs", import.meta.url));

assert.strictEqual(parseStones("30,000 st"), 30000, "stones with commas");
assert.strictEqual(parseTollCpPerSt("0.2cp/st"), 0.2, "toll per stone");
assert.strictEqual(parseTollCpPerSt("none"), 0, "no toll at class VI");

{
  // Fixture baselines, not book data.
  const baselines = { 3: 4000, 4: 1000, 5: 400, 6: 150 };
  const of = (cls) => baselines[cls];
  assert.deepStrictEqual(
    marketImpact({ cargoSt: 25600, baselineCargoSt: 30000, marketClass: 1, urbanFamilies: 3000 }),
    { impact: 1, effectiveClass: 1 },
    "0.85 rounds to impact 1"
  );
  assert.strictEqual(
    marketImpact({ cargoSt: 25600, baselineCargoSt: 150, marketClass: 6 }).impact,
    10,
    "small markets cap impact at 10"
  );
  assert.strictEqual(
    marketImpact({ cargoSt: 50000, baselineCargoSt: 30000, marketClass: 1, urbanFamilies: 40000 }).impact,
    2,
    "class I cap rises with families over 2,000"
  );
  const drop = marketImpact({ cargoSt: 300, baselineCargoSt: 4000, marketClass: 3, baselineOfClass: of });
  assert.deepStrictEqual(drop, { impact: 1, effectiveClass: 5 }, "impact 0 trades down the classes until 1");
  assert.deepStrictEqual(
    marketImpact({ cargoSt: 0, baselineCargoSt: 150, marketClass: 6, baselineOfClass: of }),
    { impact: 1, effectiveClass: 6 },
    "class VI always trades at impact 1"
  );
}

assert.strictEqual(assessmentOutcome(2), "false", "2- is a false assessment");
assert.strictEqual(assessmentOutcome(5), "failed", "3-5 fails");
assert.strictEqual(assessmentOutcome(8), "expertise", "6-8 needs expertise");
assert.strictEqual(assessmentOutcome(11), "partial", "9-11 is partial");
assert.strictEqual(assessmentOutcome(12), "success", "12+ succeeds");

{
  // 0.15gp base, 0.02gp step (the RULES.md salt worked example shapes).
  const base = { basePriceCp: 15, stepCp: 2 };
  assert.strictEqual(
    merchMarketPriceCp({ ...base, roll4d4: 9, dm: -3, marketClass: 1 }).priceCp,
    15 - 2 + 2 - 6,
    "steps stack: 4d4-10, class I bump, demand"
  );
  assert.strictEqual(
    merchMarketPriceCp({ ...base, roll4d4: 10, dm: 0, marketClass: 5 }).priceCp,
    13,
    "class V/VI shifts one step down"
  );
  assert.strictEqual(
    merchMarketPriceCp({ ...base, roll4d4: 4, dm: -6, marketClass: 6 }).priceCp,
    2,
    "price never falls below one step"
  );
  assert.strictEqual(
    merchMarketPriceCp({ basePriceCp: 12, stepCp: 1, roll4d4: 10, dm: 0, marketClass: 3, grain: true, season: "autumn" }).priceCp,
    11,
    "harvest season shifts grain down"
  );
}

assert.strictEqual(negotiationOutcome(1, 5), "outrage", "adjusted 2- is outrage");
assert.strictEqual(negotiationOutcome(9, 12), "agreement", "natural 12 always agrees");
assert.strictEqual(negotiationOutcome(9, 2), "outrage", "natural 2 always outrages");
assert.strictEqual(negotiationOutcome(10, 7), "grudging", "9-11 is grudging");
assert.strictEqual(negotiationOutcome(7, 7), "continue", "6-8 continues");

assert.strictEqual(solicitedStones({ baseStones: 0.4, impact: 2 }), 0.8, "fractional stones accumulate");

/* ------------------------- commissions ------------------------- */

assert.strictEqual(parseMoneyCp("3gp"), 300, "gp money string");
assert.strictEqual(parseMoneyCp("2sp"), 20, "sp money string");
assert.strictEqual(parseMoneyCp("33cp"), 33, "cp money string");
assert.strictEqual(parseMoneyCp("1gp, 33cp"), 133, "compound money string");
assert.strictEqual(parseMoneyCp("10gp / 15gp"), 1000, "dual-rate cell takes the primary variant");
assert.strictEqual(parseMoneyCp("1gp, 33cp / 1gp"), 133, "compound primary before the slash");
assert.strictEqual(parseMoneyCp("-"), 0, "unreadable money is zero");

{
  // Fixture rates, not book data: 66cp/day rate, 20gp/month wage.
  const rateRow = { ratePerDay: "66cp", wagePerMonth: "20gp" };
  const plan = commissionPlan({ costCp: 1000, rateRow, daysPerMonth: 28 });
  assert.strictEqual(plan.days, 16, "days = ceil(cost / daily rate)");
  assert.strictEqual(plan.wagesCp, Math.round((2000 / 28) * 16), "wages prorate the monthly wage over the build");
  assert.strictEqual(commissionPlan({ costCp: 0, rateRow }), null, "no cost, no plan");
  assert.strictEqual(commissionPlan({ costCp: 100, rateRow: { ratePerDay: "-" } }), null, "unreadable rate, no plan");
}

console.log("test-markets: OK (availability, caps, pricing, magic pricing, imports, commissions, arbitrage)");
