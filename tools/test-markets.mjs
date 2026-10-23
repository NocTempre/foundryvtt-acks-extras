/**
 * Pure-rules regression tests for the markets feature: availability cell
 * grammar, price-band bracketing, cap math (the crowd multiple, extended
 * search, the all-parties clamp, distinct items), pricing order and copper
 * rounding, magic-item pricing bases, import arrival/loss arithmetic, and the
 * result-band mapping of the arbitrage rules.
 *
 * Every printed figure the rules take is passed in here as a deliberately
 * invented value (never the book's), so a passing test proves the rule reads
 * its argument instead of assuming a number.
 *
 * Run: npm test
 */
import assert from "node:assert";

const { parseCell, priceBandOf, cellFor, partyCap, marketCap, pctMarketStock, remainingFor, itemKeyOf } =
  await import(new URL("../scripts/markets/rules/availability.mjs", import.meta.url));
const { quote, magicQuote, magicBandValueGp, bargainWinner, stepFractionOf, toCopper, toGp } =
  await import(new URL("../scripts/markets/rules/pricing.mjs", import.meta.url));
const { importPlan, dueImports, hubClass, HUBS, SECONDS_PER_DAY, SECONDS_PER_WEEK } =
  await import(new URL("../scripts/markets/rules/imports.mjs", import.meta.url));
const { tiersNamed, inBackfireBand } = await import(new URL("../scripts/markets/rules/identification.mjs", import.meta.url));
const { requireNumber } = await import(new URL("../scripts/markets/rules/required.mjs", import.meta.url));

// The printed figures, invented. The engine reads the real ones from the
// imported tables; nothing here is a book value.
const CAPS = { crowdMultiplier: 3, marketTotalMultiplier: 6 };
const SWING = { buy: 15, sell: 20 };
const { parseMoneyCp, commissionPlan } =
  await import(new URL("../scripts/markets/rules/commissions.mjs", import.meta.url));

const { isMasterwork, isTemplateCopy, magicBasisOf, marketsFlagOf, capVerdict } =
  await import(new URL("../scripts/markets/rules/goods.mjs", import.meta.url));

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
assert.strictEqual(partyCap(q10, { doubled: true, crowdMultiplier: CAPS.crowdMultiplier }), 30, "a claimed crowd month multiplies by the passed multiple");
assert.strictEqual(partyCap(q10, { extraSearchDays: 2 }), 30, "each extended day adds one base increment");
assert.strictEqual(
  partyCap(q10, { doubled: true, crowdMultiplier: CAPS.crowdMultiplier, extraSearchDays: 1 }),
  40,
  "the crowd multiple and search days stack additively"
);
assert.throws(() => partyCap(q10, { doubled: true }), /crowdMultiplier/, "a crowd claim with no printed multiple is refused, not assumed");
assert.strictEqual(marketCap(q10, { marketTotalMultiplier: CAPS.marketTotalMultiplier }), 60, "the all-parties total is the passed multiple of the cell");
assert.throws(() => marketCap(q10), /marketTotalMultiplier/, "a quantity cell with no printed all-parties multiple is refused");

// Party remaining clamps against both its own cap and the market total.
assert.deepStrictEqual(
  remainingFor({ cell: q10, direction: "bought", ledgerRow: { bought: 4 }, totalsRow: { bought: 4 }, ...CAPS }),
  { remaining: 6, capParty: 10, capMarket: 60 },
  "own purchases decrement"
);
assert.strictEqual(
  remainingFor({ cell: q10, direction: "bought", ledgerRow: { bought: 0 }, totalsRow: { bought: 57 }, ...CAPS }).remaining,
  3,
  "other parties' purchases clamp through the market total"
);
assert.strictEqual(
  remainingFor({ cell: q10, direction: "sold", ledgerRow: { bought: 10, sold: 2 }, totalsRow: { sold: 2 }, ...CAPS }).remaining,
  8,
  "sold counter is independent of bought"
);
assert.strictEqual(
  remainingFor({ cell: { kind: "pct", chance: 25 }, direction: "bought", ledgerRow: null, totalsRow: null, exists: true, ...CAPS }).remaining,
  1,
  "existing percent unit is one unit even before the market stock rolls"
);
assert.strictEqual(
  remainingFor({ cell: { kind: "pct", chance: 25 }, direction: "bought", ledgerRow: null, totalsRow: null, exists: false, pctStock: 3, ...CAPS }).remaining,
  0,
  "market stock without a party success is still out of the party's reach"
);
assert.strictEqual(
  remainingFor({ cell: { kind: "pct", chance: 25 }, direction: "bought", ledgerRow: { bought: 1 }, totalsRow: { bought: 1 }, exists: true, pctStock: 3, ...CAPS }).remaining,
  0,
  "the party's one percent unit cannot be bought twice even with market stock left"
);

assert.strictEqual(
  remainingFor({ cell: { kind: "pct", chance: 10 }, direction: "sold", ledgerRow: null, totalsRow: null, exists: false, pctStock: 2, ...CAPS }).remaining,
  1,
  "a failed contact roll still sells into the location's rolled capacity"
);
assert.strictEqual(
  remainingFor({ cell: { kind: "pct", chance: 10 }, direction: "sold", ledgerRow: null, totalsRow: { sold: 2 }, exists: false, pctStock: 2, ...CAPS }).remaining,
  0,
  "the location's sale capacity exhausts across parties"
);
assert.strictEqual(
  remainingFor({ cell: { kind: "pct", chance: 10 }, direction: "sold", ledgerRow: null, totalsRow: null, exists: false, pctStock: 0, ...CAPS }).remaining,
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
    totalsRow: { bought: 5 },
    ...CAPS,
  }).remaining,
  1,
  "the true-class total clamps a venturer's wider access"
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
    ...CAPS,
  }).remaining,
  1,
  "a guaranteed effective-class find stands even when the town's stock rolled zero"
);
assert.strictEqual(
  marketCap({ kind: "none" }, { exists: true }),
  1,
  "a party's find floors even a none cell at the town's class"
);

// Market-wide %-stock: the passed multiple of the chance as guaranteed whole
// units plus at most one roll for the fractional remainder, party roll first.
{
  const m = { marketTotalMultiplier: 7 };
  assert.strictEqual(pctMarketStock(30, { ...m, d100: 10 }).stock, 3, "210%: remainder d100 10 ≤ 10 stocks a third unit");
  assert.strictEqual(pctMarketStock(30, { ...m, d100: 11 }).stock, 2, "210%: remainder failure keeps the two whole units");
  assert.strictEqual(pctMarketStock(100, { marketTotalMultiplier: 3 }).stock, 3, "a whole multiple is whole units, no roll spent");
  assert.strictEqual(pctMarketStock(5, { ...m }), null, "a fractional remainder demands a roll when the floor cannot answer");
  assert.strictEqual(pctMarketStock(5, { ...m, partyFound: true }).stock, 1, "the party's find answers a floor-only cell without a roll");
  assert.strictEqual(pctMarketStock(5, { ...m, d100: 80 }).stock, 0, "a failed remainder with no find stocks nothing");
  assert.strictEqual(pctMarketStock(30, { ...m, partyFound: true, d100: 90 }).stock, 2, "a rolled failure keeps the whole units");
  assert.throws(() => pctMarketStock(5, {}), /marketTotalMultiplier/, "no printed multiple, no stock");
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

// A step is derived from a merchandise row: one price step over the price per stone.
assert.strictEqual(stepFractionOf({ pricePerStone: 20, priceStep: 3 }), 0.15, "the step fraction is priceStep / pricePerStone");
assert.strictEqual(stepFractionOf({ pricePerStone: 8, priceStep: 2 }), 0.25, "each category derives its own fraction");
assert.strictEqual(stepFractionOf(null), null, "no row, no step");
assert.strictEqual(stepFractionOf({ pricePerStone: 20 }), null, "a row with no step prints none");
assert.strictEqual(stepFractionOf({ pricePerStone: 0, priceStep: 3 }), null, "a zero price has no step fraction");
const STEP = stepFractionOf({ pricePerStone: 20, priceStep: 3 });

assert.strictEqual(quote({ costGp: 10, direction: "buy" }).unitCp, 1000, "base buy");
assert.strictEqual(quote({ costGp: 10, direction: "buy", bargain: "party", bargainPct: SWING }).unitCp, 850, "party bargain buys cheaper by the passed buy percentage");
assert.strictEqual(quote({ costGp: 10, direction: "sell", bargain: "party", bargainPct: SWING }).unitCp, 1200, "party bargain sells dearer by the passed sell percentage");
assert.strictEqual(quote({ costGp: 10, direction: "buy", bargain: "merchant", bargainPct: SWING }).unitCp, 1150, "merchant bargain raises the buy by the buy percentage");
assert.strictEqual(quote({ costGp: 10, direction: "sell", bargain: "merchant", bargainPct: SWING }).unitCp, 800, "merchant bargain lowers the sale by the sell percentage");
assert.throws(() => quote({ costGp: 10, direction: "buy", bargain: "party" }), /bargainPct/, "a Bargaining swing with no printed percentage is refused, not assumed");
assert.strictEqual(quote({ costGp: 10, direction: "sell", demandSteps: 3, stepFraction: STEP }).unitCp, 1450, "positive demand steps raise price by the derived fraction");
assert.strictEqual(quote({ costGp: 10, direction: "buy", demandSteps: -2, stepFraction: STEP }).unitCp, 700, "negative demand steps lower price");
{
  const none = quote({ costGp: 10, direction: "sell", demandSteps: 3 });
  assert.strictEqual(none.unitCp, 1000, "no merchandise row: no demand shift is applied");
  assert.deepStrictEqual(none.breakdown.map((b) => b.label), ["base", "demandUnpriced"], "the breakdown says the demand stage was unpriced");
  assert.strictEqual(quote({ costGp: 10, direction: "sell", demandSteps: 0 }).breakdown.length, 1, "no demand modifier, no demand stage");
}
assert.strictEqual(quote({ costGp: 10, direction: "sell", valueMult: 1 / 3 }).unitCp, 333, "condition multiplier rounds to copper");
{
  const q = quote({ costGp: 10, direction: "sell", valueMult: 0.34, demandSteps: 1, stepFraction: STEP, bargain: "party", bargainPct: SWING });
  // 1000 → 340 → 391 → 469 (each stage rounds to copper before the next)
  assert.strictEqual(q.unitCp, 469, "stages apply in order: condition, demand, bargaining");
  assert.deepStrictEqual(q.breakdown.map((b) => b.label), ["base", "condition", "demand", "bargaining"], "breakdown names each stage");
}
assert.strictEqual(quote({ costGp: 1, direction: "sell", demandSteps: -20, stepFraction: STEP }).unitCp, 0, "price never goes negative");

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
  magicQuote({ baseCostGp: 1500, identified: "full", selfMade: true, direction: "sell", selfMadeTimes: 3 }),
  { unitCp: 450000, basis: "selfMade" },
  "self-made sells at the passed multiple of base"
);
assert.deepStrictEqual(
  magicQuote({ baseCostGp: 500, identified: "full", direction: "buy", buyPct: 130 }),
  { unitCp: 65000, basis: "buyPremium" },
  "buying costs the passed percentage of base"
);
assert.deepStrictEqual(
  magicQuote({ baseCostGp: 500, identified: "full", direction: "buy" }),
  { unitCp: 0, basis: "buyPremium", unpriced: true },
  "a buy with no printed percentage is unpriced, never guessed"
);
assert.deepStrictEqual(
  magicQuote({ baseCostGp: 1500, identified: "full", selfMade: true, direction: "sell" }),
  { unitCp: 0, basis: "selfMade", unpriced: true },
  "a maker's sale with no printed multiple is unpriced"
);
assert.strictEqual(magicBandValueGp({ baseCostGp: 5000, apparentValueGp: 200, identified: "none" }), 200, "unidentified band by apparent value");
assert.strictEqual(magicBandValueGp({ baseCostGp: 5000, apparentValueGp: 200, identified: "full" }), 5000, "identified band by base cost");

/* ------------------------- imports ------------------------- */

// Invented hub shifts and losing result: the shift is whatever the table says.
assert.strictEqual(hubClass(5, 2), 3, "a hub is the passed number of classes larger");
assert.strictEqual(hubClass(5, 3), 2, "a larger passed shift reaches further");
assert.strictEqual(hubClass(2, 3), 1, "hub class never exceeds I");
assert.strictEqual(hubClass(6, 0), 6, "a zero shift stays put");
assert.throws(() => hubClass(4), /hubShift/, "no printed shift, no hub class");
assert.deepStrictEqual(Object.keys(HUBS), ["local", "regional"], "the hub kinds an order can name");

{
  const p = importPlan({ roll2d6: 7, hub: "local", lostOnRoll: 11, placedTime: 1000 });
  assert.strictEqual(p.lost, false, "a roll other than the printed loss arrives");
  assert.strictEqual(p.arrivalTime, 1000 + 7 * SECONDS_PER_DAY, "local hub counts days");
}
{
  const p = importPlan({ roll2d6: 5, hub: "regional", lostOnRoll: 11, placedTime: 0 });
  assert.strictEqual(p.arrivalTime, 5 * SECONDS_PER_WEEK, "regional hub counts weeks");
}
{
  const p = importPlan({ roll2d6: 11, hub: "regional", lostOnRoll: 11, placedTime: 0 });
  assert.strictEqual(p.lost, true, "the printed result is lost in transit");
  assert.strictEqual(p.arrivalTime, 11 * SECONDS_PER_WEEK, "loss reveals at the would-be arrival");
  assert.strictEqual(importPlan({ roll2d6: 12, hub: "local", lostOnRoll: 11, placedTime: 0 }).lost, false, "a roll of 12 is not the loss unless the table says so");
}
assert.throws(() => importPlan({ roll2d6: 7, hub: "local", placedTime: 0 }), /lostOnRoll/, "no printed losing result, no plan");
assert.throws(() => importPlan({ roll2d6: 7, hub: "orbital", lostOnRoll: 11, placedTime: 0 }), /hub/, "an unknown hub kind is refused");

const orders = [
  { id: "a", status: "ordered", arrivalTime: 100 },
  { id: "b", status: "ordered", arrivalTime: 200 },
  { id: "c", status: "delivered", arrivalTime: 50 },
];
assert.deepStrictEqual(dueImports(orders, 150).map((o) => o.id), ["a"], "due picks only ripe ordered rows");
assert.deepStrictEqual(dueImports(orders, 500).map((o) => o.id), ["a", "b"], "delivered rows never re-resolve");

/* ------------------------- arbitrage ------------------------- */

const {
  parseStones,
  parseTollCpPerSt,
  marketImpact,
  assessmentOutcome,
  merchMarketPriceCp,
  negotiationOutcome,
  solicitedStones,
  parseTariffPct,
  diceRange,
  tariffOn,
  ASSESSMENT_RESULTS,
  NEGOTIATION_RESULTS,
} = await import(new URL("../scripts/markets/rules/arbitrage.mjs", import.meta.url));

// The cells below are invented in the printed formats; none is a page's.
assert.strictEqual(parseStones("12,345 st"), 12345, "stones with commas");
assert.strictEqual(parseTollCpPerSt("0.7cp/st"), 0.7, "toll per stone");
assert.strictEqual(parseTollCpPerSt("none"), 0, "the word none is no toll");

/* ------------------------- the gate's tariff ------------------------- */

// Every rate, price and die below is invented for these checks.
assert.deepStrictEqual(parseTariffPct("15% and 3%"), { precious: 15, common: 3 }, "the first percentage is the precious rate, the second the common");
assert.deepStrictEqual(parseTariffPct("12.5% and 1.5%"), { precious: 12.5, common: 1.5 }, "decimal rates");
assert.deepStrictEqual(parseTariffPct("None"), { precious: 0, common: 0 }, "the word none charges nothing");
assert.deepStrictEqual(parseTariffPct("-"), { precious: 0, common: 0 }, "a dash charges nothing");
assert.strictEqual(parseTariffPct("15%"), null, "one percentage is not a tariff the gate can read");
assert.strictEqual(parseTariffPct(""), null, "an empty cell is unread, never free");
assert.strictEqual(parseTariffPct(undefined), null, "an absent cell is unread");
assert.deepStrictEqual(diceRange("3d6"), { min: 3, max: 18 }, "a die term's ends");
assert.deepStrictEqual(diceRange(" 1D12 "), { min: 1, max: 12 }, "case and space are forgiven");
assert.strictEqual(diceRange("2d6+1"), null, "a modified throw is not one die term");
assert.strictEqual(diceRange(""), null, "no formula");
{
  const loads = [
    { category: "a", label: "A", stones: 4, basePriceGp: 30, tier: "precious", exempt: false },
    { category: "b", label: "B", stones: 10, basePriceGp: 0.7, tier: "common", exempt: false },
    { category: "c", label: "C", stones: 50, basePriceGp: 0.3, tier: "common", exempt: true },
  ];
  const t = tariffOn(loads, { precious: 15, common: 3 });
  // A: 4 × 30gp × 15% = 18gp = 1800cp; B: 10 × 0.7gp × 3% = 0.21gp = 21cp; C exempt.
  assert.deepStrictEqual(t.lines.map((l) => l.cp), [1800, 21, 0], "each load at its tier's rate, the exempt good at none");
  assert.strictEqual(t.totalCp, 1821, "the tariff is the sum of the loads'");
  assert.strictEqual(t.lines[2].pct, 0, "an exempt load is charged at no rate");
  assert.strictEqual(tariffOn(loads, { precious: 0, common: 0 }).totalCp, 0, "a class with no tariff charges nothing");
  assert.strictEqual(tariffOn([{ category: "d", label: "D", stones: 1, basePriceGp: 0.33, tier: "common", exempt: false }], { precious: 9, common: 3 }).totalCp, 1, "a fraction of a copper rounds up, as the toll does");
  assert.strictEqual(tariffOn([{ category: "e", label: "E", stones: 2, basePriceGp: 10, tier: "", exempt: false }], { precious: 9, common: 3 }).totalCp, 60, "a load of no stated tier is charged as common");
  assert.strictEqual(tariffOn([], { precious: 9, common: 3 }).totalCp, 0, "nothing aboard, nothing charged");
}

{
  // Every figure in this block is invented for it, none of them a page's.
  // The family-scaled class is deliberately NOT the largest, so the test
  // proves the class is read.
  const baselines = { 3: 4200, 4: 1100, 5: 450, 6: 130 };
  const of = (cls) => baselines[cls];
  const LIMITS = { impactCap: 7, familyScaledClass: 2, familiesPerImpact: 900 };
  assert.deepStrictEqual(
    marketImpact({ cargoSt: 1300, baselineCargoSt: 2000, marketClass: 1, urbanFamilies: 3000, ...LIMITS }),
    { impact: 1, effectiveClass: 1, rawImpact: 1, cap: 7 },
    "0.65 rounds to impact 1"
  );
  assert.strictEqual(
    marketImpact({ cargoSt: 5000, baselineCargoSt: 130, marketClass: 6, ...LIMITS }).impact,
    7,
    "small markets cap impact at the passed cap"
  );
  assert.strictEqual(
    marketImpact({ cargoSt: 600000, baselineCargoSt: 2500, marketClass: 1, urbanFamilies: 72000, ...LIMITS }).impact,
    7,
    "only the passed family-scaled class scales its cap; another class keeps the plain cap"
  );
  assert.strictEqual(
    marketImpact({ cargoSt: 600000, baselineCargoSt: 2500, marketClass: 2, urbanFamilies: 9900, ...LIMITS }).impact,
    11,
    "the scaled class takes families over the passed rate (9900 / 900) when larger than the cap"
  );
  assert.strictEqual(
    marketImpact({ cargoSt: 600000, baselineCargoSt: 2500, marketClass: 2, urbanFamilies: 1800, ...LIMITS }).impact,
    7,
    "the scaled class never falls below the plain cap"
  );
  const drop = marketImpact({ cargoSt: 300, baselineCargoSt: 4200, marketClass: 3, baselineOfClass: of, ...LIMITS });
  assert.deepStrictEqual(drop, { impact: 1, effectiveClass: 5, rawImpact: 0, cap: 7 }, "impact 0 trades down the classes until 1, and the raw figure stays 0");
  assert.deepStrictEqual(
    marketImpact({ cargoSt: 0, baselineCargoSt: 130, marketClass: 6, baselineOfClass: of, ...LIMITS }),
    { impact: 1, effectiveClass: 6, rawImpact: 0, cap: 7 },
    "the smallest class always trades at impact 1"
  );
  assert.throws(() => marketImpact({ cargoSt: 10, baselineCargoSt: 10, marketClass: 3 }), /impactCap/, "no printed limits, no impact");

  // A mercantile network's options, with invented steps and an invented maximum.
  const { networkOptions, pickNetworkOption } = await import(new URL("../scripts/markets/rules/arbitrage.mjs", import.meta.url));
  const entry = { impact: 3, effectiveClass: 4, rawImpact: 3, trueClass: 4, cap: 7 };
  assert.deepStrictEqual(
    networkOptions({ ...entry, classStep: 2, impactStep: 3 }),
    { classOption: { cls: 2, imp: 3 }, impactOption: { cls: 4, imp: 6 } },
    "the class option reads larger at the earned impact; the impact option adds at the market's own class"
  );
  assert.deepStrictEqual(networkOptions({ ...entry, impact: 6, rawImpact: 6, classStep: 2, impactStep: 3 }).impactOption, { cls: 4, imp: 7 }, "the maximum binds the impact option");
  assert.deepStrictEqual(networkOptions({ ...entry, effectiveClass: 1, trueClass: 1, classStep: 2 }).classOption, { cls: 1, imp: 3 }, "Class I stays Class I");
  assert.deepStrictEqual(
    networkOptions({ impact: 1, effectiveClass: 5, rawImpact: 0, trueClass: 3, cap: 7, impactStep: 3 }).impactOption,
    { cls: 3, imp: 3 },
    "a party with no impact takes the step at the market's own class instead of dropping"
  );
  assert.deepStrictEqual(networkOptions({ ...entry, classStep: 0, impactStep: null }), { classOption: null, impactOption: null }, "an absent step is no option");

  // Invented daily stones by class: one good favours the class, the other the impact.
  const columns = { favoursClass: [90, 40, 20, 10, 5, 2], favoursImpact: [12, 11, 10, 10, 5, 2] };
  const at = (good) => (cls, imp) => columns[good][cls - 1] * imp;
  const opts = networkOptions({ ...entry, classStep: 2, impactStep: 3 });
  const base = { cls: entry.effectiveClass, imp: entry.impact };
  assert.strictEqual(pickNetworkOption({ base, ...opts, stonesAt: at("favoursClass") }).used, "class", "auto picks the class where it opens more");
  assert.strictEqual(pickNetworkOption({ base, ...opts, stonesAt: at("favoursImpact") }).used, "impact", "and the impact where that opens more");
  assert.deepStrictEqual(pickNetworkOption({ base, ...opts, mode: "impact", stonesAt: at("favoursClass") }), { cls: 4, imp: 6, used: "impact" }, "a pinned mode takes its option");
  assert.strictEqual(pickNetworkOption({ base, classOption: null, impactOption: null, mode: "class", stonesAt: at("favoursClass") }).used, "base", "a pinned mode with no option trades plain");
  const classOne = networkOptions({ ...entry, effectiveClass: 1, trueClass: 1, classStep: 2, impactStep: 3 });
  assert.strictEqual(pickNetworkOption({ base: { cls: 1, imp: 3 }, ...classOne, stonesAt: at("favoursClass") }).used, "impact", "in Class I the class option opens nothing more, so auto takes the impact");
  for (const good of Object.keys(columns)) {
    const pick = pickNetworkOption({ base, ...opts, stonesAt: at(good) });
    assert.ok(at(good)(pick.cls, pick.imp) >= at(good)(base.cls, base.imp), `auto never opens less than the plain entry (${good})`);
  }
}

// Result columns map BY POSITION: the same total lands in a different named
// band under a different printed column. Bands here are invented, and deliberately
// unlike any book column.
{
  const ASSESS = [
    { min: null, max: 4 },
    { min: 5, max: 7 },
    { min: 8, max: 9 },
    { min: 10, max: 12 },
    { min: 13, max: null },
  ];
  assert.deepStrictEqual(ASSESSMENT_RESULTS, ["false", "failed", "expertise", "partial", "success"], "assessment rungs, printed order");
  assert.deepStrictEqual(NEGOTIATION_RESULTS, ["outrage", "refusal", "continue", "grudging", "agreement"], "negotiation rungs, printed order");
  assert.strictEqual(assessmentOutcome(-3, ASSESS), "false", "an open lower end catches anything below");
  assert.strictEqual(assessmentOutcome(4, ASSESS), "false", "a band's upper edge is inclusive");
  assert.strictEqual(assessmentOutcome(5, ASSESS), "failed", "a band's lower edge is inclusive");
  assert.strictEqual(assessmentOutcome(9, ASSESS), "expertise", "third band");
  assert.strictEqual(assessmentOutcome(11, ASSESS), "partial", "fourth band");
  assert.strictEqual(assessmentOutcome(13, ASSESS), "success", "an open upper end catches anything above");
  assert.strictEqual(assessmentOutcome(40, ASSESS), "success", "far above still lands in the last band");
  // The same total under another column names another rung.
  const SHIFTED = [{ min: null, max: 1 }, { min: 2, max: 3 }, { min: 4, max: 5 }, { min: 6, max: 7 }, { min: 8, max: null }];
  assert.strictEqual(assessmentOutcome(9, SHIFTED), "success", "the mapping follows the passed bands, not fixed thresholds");
  assert.throws(() => assessmentOutcome(7, ASSESS.slice(0, 4)), /five printed bands/, "a column of the wrong length is refused");

  const NEGOTIATE = [
    { min: null, max: 3 },
    { min: 4, max: 6 },
    { min: 7, max: 10 },
    { min: 11, max: 13 },
    { min: 14, max: null },
  ];
  assert.strictEqual(negotiationOutcome(2, 6, NEGOTIATE), "outrage", "lowest band");
  assert.strictEqual(negotiationOutcome(5, 6, NEGOTIATE), "refusal", "second band");
  assert.strictEqual(negotiationOutcome(8, 6, NEGOTIATE), "continue", "third band");
  assert.strictEqual(negotiationOutcome(12, 6, NEGOTIATE), "grudging", "fourth band");
  assert.strictEqual(negotiationOutcome(15, 6, NEGOTIATE), "agreement", "highest band");
  // Natural extremes of 2d6 stand whatever the modifiers made of the total.
  assert.strictEqual(negotiationOutcome(20, 2, NEGOTIATE), "outrage", "a natural minimum counts as the first band despite a high total");
  assert.strictEqual(negotiationOutcome(-5, 12, NEGOTIATE), "agreement", "a natural maximum counts as the last band despite a low total");
  assert.strictEqual(negotiationOutcome(8, 3, NEGOTIATE), "continue", "a natural that is not an extreme leaves the total to decide");
}

{
  // 0.15gp base, 0.02gp step (the RULES.md salt worked example shapes); shifts invented.
  const base = { basePriceCp: 15, stepCp: 2 };
  const SHIFTS = { largeClassEdge: 3, largeClassShift: 2, smallClassEdge: 4, smallClassShift: 3, sowingShift: 2, harvestShift: 3 };
  assert.strictEqual(
    merchMarketPriceCp({ ...base, roll4d4: 9, dm: -3, marketClass: 1, ...SHIFTS }).priceCp,
    15 - 2 + 4 - 6,
    "steps stack: 4d4-10, the large-class shift, demand"
  );
  assert.strictEqual(
    merchMarketPriceCp({ ...base, roll4d4: 10, dm: 0, marketClass: 3, ...SHIFTS }).steps,
    2,
    "the large-class edge is inclusive"
  );
  assert.strictEqual(
    merchMarketPriceCp({ ...base, roll4d4: 10, dm: 0, marketClass: 4, ...SHIFTS }).priceCp,
    15 - 6,
    "the small-class edge is inclusive and shifts by its own amount"
  );
  assert.strictEqual(
    merchMarketPriceCp({ ...base, roll4d4: 10, dm: 0, marketClass: 4, ...SHIFTS, smallClassEdge: 5 }).steps,
    0,
    "a class between the edges shifts nothing"
  );
  assert.strictEqual(
    merchMarketPriceCp({ ...base, roll4d4: 4, dm: -6, marketClass: 6, ...SHIFTS }).priceCp,
    2,
    "price never falls below one step"
  );
  assert.strictEqual(
    merchMarketPriceCp({ basePriceCp: 20, stepCp: 1, roll4d4: 10, dm: 0, marketClass: 3.5, ...SHIFTS, grain: true, season: "autumn" }).priceCp,
    17,
    "harvest season shifts grain down by the passed amount"
  );
  assert.strictEqual(
    merchMarketPriceCp({ basePriceCp: 20, stepCp: 1, roll4d4: 10, dm: 0, marketClass: 3.5, ...SHIFTS, grain: true, season: "spring" }).priceCp,
    22,
    "sowing season shifts grain up by the passed amount"
  );
  assert.throws(() => merchMarketPriceCp({ ...base, roll4d4: 10, marketClass: 3 }), /largeClassEdge/, "no printed shifts, no price");
}

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

/* ------------------------- item flags: masterwork, magic basis, cap verdict ------------------------- */

{
  const withFlags = (flags, name = "Plain Thing") => ({ name, flags: { "acks-extras": flags } });

  assert.strictEqual(isMasterwork({ name: "Plain Thing" }), false, "no flags, ordinary name: not masterwork");
  assert.strictEqual(isMasterwork({ name: "Masterwork Thing" }), true, "the name still gates");
  assert.strictEqual(isMasterwork(withFlags({ markets: { masterwork: true } })), true, "markets flag gates");
  assert.strictEqual(isMasterwork(withFlags({ markets: { masterwork: false } }, "Masterwork Thing")), false, "markets override beats the name");
  assert.strictEqual(isMasterwork(withFlags({ masterwork: { tier: "someTier" } })), true, "an equipment-sheet tier gates");
  assert.strictEqual(isMasterwork(withFlags({ masterwork: { tier: "none" } })), false, "tier none does not gate");
  assert.strictEqual(isMasterwork(withFlags({ masterwork: { tier: "" } })), false, "an empty tier does not gate");
  assert.strictEqual(isMasterwork(withFlags({ masterwork: { tier: "none" } }, "Masterwork Thing")), true, "tier none falls through to the name");
  assert.strictEqual(
    isMasterwork(withFlags({ markets: { masterwork: false }, masterwork: { tier: "someTier" } })),
    false,
    "an explicit markets override beats the sheet's tier"
  );

  assert.strictEqual(isTemplateCopy({ name: "Sword" }), false, "a plain shop item is a catalogue good");
  assert.strictEqual(isTemplateCopy(withFlags({ skin: { base: "uuid:x", descriptor: "Ornate sword" } }, "Ornate sword")), true, "a kit skin is not");
  assert.strictEqual(isTemplateCopy(withFlags({ templatePart: { kind: "gear" } })), true, "nor is any template part");

  assert.deepStrictEqual(magicBasisOf({ system: { cost: 40 } }), { magic: false, baseGp: 0 }, "mundane items report no magic basis");
  assert.deepStrictEqual(
    magicBasisOf({ system: { cost: 40 }, flags: { "acks-extras": { markets: { magic: true, baseCostGp: 900 } } } }),
    { magic: true, baseGp: 900 },
    "a magic item bands and prices on its flagged base cost"
  );
  assert.deepStrictEqual(
    magicBasisOf({ system: { cost: 40 }, flags: { "acks-extras": { markets: { magic: true } } } }),
    { magic: true, baseGp: 40 },
    "a magic item with no flagged base falls back to its own cost"
  );
  assert.deepStrictEqual(marketsFlagOf(null), {}, "an absent item has an empty flag bag");

  assert.strictEqual(capVerdict({ qty: 3, remaining: 3, enforce: true }), "ok", "a quantity that fits is ok");
  assert.strictEqual(capVerdict({ qty: 4, remaining: 3, enforce: true }), "exceeded", "over the room, enforced: refused");
  assert.strictEqual(capVerdict({ qty: 4, remaining: 3, enforce: false }), "waived", "over the room, not enforced: waived");
  assert.strictEqual(capVerdict({ qty: 1, remaining: 0, enforce: false }), "waived", "an empty shelf is waived, not ok, when not enforced");
}

/* ------------------------- identification thresholds ------------------------- */

{
  const RARITY_KEYS = ["common", "uncommon", "rare", "veryRare", "legendary"];
  // Invented windows: the parse reads whichever tiers the imported text names.
  assert.deepStrictEqual(
    [...tiersNamed("... a common, uncommon, or rare item ...", RARITY_KEYS)].sort(),
    ["common", "rare", "uncommon"],
    "the tiers a window names are the tiers covered"
  );
  assert.deepStrictEqual(
    [...tiersNamed("only rare and very rare things", RARITY_KEYS)].sort(),
    ["rare", "veryRare"],
    "a longer phrase is matched before the phrase inside it, and both can be named"
  );
  assert.deepStrictEqual([...tiersNamed("only very rare things", RARITY_KEYS)], ["veryRare"], "very rare is never also read as rare");
  assert.deepStrictEqual([...tiersNamed("an uncommon one", RARITY_KEYS)], ["uncommon"], "uncommon is never also read as common");
  assert.deepStrictEqual([...tiersNamed("LEGENDARY", RARITY_KEYS)], ["legendary"], "case does not matter");
  assert.strictEqual(tiersNamed("nothing recognizable here", RARITY_KEYS), null, "a window that names no tier yields none");
  assert.strictEqual(tiersNamed(undefined, RARITY_KEYS), null, "no window, no tiers");
  assert.strictEqual(inBackfireBand(2, [2, 4]), true, "a die on the band's floor backfires");
  assert.strictEqual(inBackfireBand(4, [2, 4]), true, "a die on the band's ceiling backfires");
  assert.strictEqual(inBackfireBand(1, [2, 4]), false, "below the band does not");
  assert.strictEqual(inBackfireBand(5, [2, 4]), false, "above the band does not");
  assert.strictEqual(inBackfireBand(3, null), false, "no printed band, no backfire");
  assert.strictEqual(requireNumber("x", "7"), 7, "a numeric string is a number");
  assert.throws(() => requireNumber("x", null), /"x"/, "null is not a printed value");
  assert.throws(() => requireNumber("x", ""), /"x"/, "blank is not a printed value");
  assert.strictEqual(requireNumber("x", 0), 0, "zero is a value");
}

/* ------------------------- the engine's reader of imported figures ------------------------- */

{
  // A stand-in registry holding invented prose tables: what the importer
  // would have stored, with every key optional.
  const STORE = {
    availability: {
      marketRulesProse: { crowdSize: 7, crowdMultiplier: 3, marketTotalMultiplier: 6, localHubShift: 2 },
      bargainingProse: { buyPct: 15, sellPct: 20, rankBonus: 3 },
    },
    magicItems: {
      priceProse: { buyPct: 130 },
      identifyProse: { researchCasterLevel: 9, engineeringTiers: "legendary or very rare", dabblingBackfire: [1, 2] },
    },
    mercantile: {
      merchandiseTypes: { rows: [{ type: "salt", pricePerStone: 20, priceStep: 3 }, { type: "silk", pricePerStone: 0, priceStep: 0 }, { __missing: true, type: "tools" }] },
      impactProse: { impactCap: 7, familyScaledClass: 2 },
      assessmentProse: { bands: [{ min: null, max: 4 }, { min: 5, max: 7 }, { min: 8, max: 9 }, { min: 10, max: 12 }, { min: 13, max: null }] },
      negotiationProse: {
        commonCha: 3, commonRanks: 2, preciousCha: 4, preciousRanks: 5, extraRanks: 2, rankStep: 3,
        bands: [{ min: null, max: 3 }, { min: 4, max: 6 }, { min: 7, max: 10 }, { min: 11, max: 13 }, { min: 14, max: null }],
      },
      tariffProse: { preciousDie: "3d8", commonDie: "1d6" },
    },
  };
  globalThis.acksExtras = {
    lib: {
      tables: {
        hasDoc: (doc) => !!STORE[doc],
        getTable: (doc, table) => {
          if (!STORE[doc]?.[table]) throw new Error("no such table");
          return STORE[doc][table];
        },
      },
    },
  };
  globalThis.game = { i18n: { localize: (key) => `«${key}»` } };
  const printed = await import(new URL("../scripts/markets/engine/printed.mjs", import.meta.url));

  assert.deepStrictEqual(printed.marketRules(["crowdSize", "marketTotalMultiplier"]), { crowdSize: 7, marketTotalMultiplier: 6 }, "named figures are read from the table");
  assert.strictEqual(printed.marketRules(["crowdSize", "lostOnRoll"]), null, "a figure the page did not yield makes the whole request null");
  assert.strictEqual(printed.impactLimits(), null, "a table missing one of its keys reads as absent");
  assert.strictEqual(printed.priceShifts(), null, "a table that is not imported reads as absent");
  assert.deepStrictEqual(printed.bargaining(), { buyPct: 15, sellPct: 20, rankBonus: 3 }, "the Bargaining swing and rank bonus");
  assert.deepStrictEqual(printed.magicPrices(["buyPct"]), { buyPct: 130 }, "a magic-item price figure");
  assert.strictEqual(printed.magicPrices(["selfMadeTimes"]), null, "a magic-item figure not yielded is null");
  assert.strictEqual(printed.assessmentBands().length, 5, "a five-band column reads whole");
  assert.deepStrictEqual(
    printed.negotiation().common,
    { cha: 3, ranks: 2 },
    "the typical common merchant is the imported one"
  );
  assert.deepStrictEqual(printed.negotiation().precious, { cha: 4, ranks: 5 }, "the typical precious merchant is the imported one");
  assert.strictEqual(printed.negotiation().rankStep, 3, "the per-rank step");
  assert.deepStrictEqual(printed.tariffDice(), { precious: "3d8", common: "1d6" }, "the randomized tariff's dice per tier");
  STORE.mercantile.tariffProse.commonDie = "a few";
  assert.strictEqual(printed.tariffDice(), null, "a die the page did not yield as one die term reads as absent");
  STORE.mercantile.tariffProse.commonDie = "1d6";

  const id = printed.identification();
  assert.strictEqual(id.researchCasterLevel, 9, "the research caster level");
  assert.deepStrictEqual([...id.engineeringTiers].sort(), ["legendary", "veryRare"], "the tiers named by the imported window");
  assert.deepStrictEqual(id.dabblingBackfire, [1, 2], "the backfire band");

  // The step fraction is derived per category; no row means no step.
  assert.strictEqual(printed.stepFractionFor("salt"), 0.15, "a category with a row derives priceStep / pricePerStone");
  assert.strictEqual(printed.stepFractionFor("clothing"), null, "a category with no imported row has no step");
  assert.strictEqual(printed.stepFractionFor("silk"), null, "a row whose prices are zero has no step");
  assert.strictEqual(printed.stepFractionFor("tools"), null, "a missing-row placeholder is no row");
  assert.strictEqual(printed.stepFractionFor(null), null, "an item with no category has no step");
  assert.deepStrictEqual(printed.printedError("priceProse"), { error: "printedMissing", table: "«ACKS-MARKETS.ventures.table.priceProse»" }, "a refusal names the table");

  // Losing the registry: every reader answers null, none throws.
  for (const doc of Object.keys(STORE)) delete STORE[doc];
  assert.strictEqual(printed.marketRules(["crowdSize"]), null, "no registry document, no figure");
  assert.strictEqual(printed.bargaining(), null, "no registry document, no swing");
  assert.strictEqual(printed.negotiation(), null, "no registry document, no profile");
  assert.strictEqual(printed.tariffDice(), null, "no registry document, no dice");
  assert.deepStrictEqual(printed.identification(), { researchCasterLevel: null, engineeringTiers: null, dabblingBackfire: null }, "no registry document, every threshold null");
  assert.strictEqual(printed.stepFractionFor("salt"), null, "no registry document, no step");
  delete globalThis.acksExtras;
  delete globalThis.game;
}

// ---- the venture queue: duplicates, withdrawal, the page's bands ----
{
  const { pendingDuplicate, cancelVerdict, assessmentPageBands, ASSESSMENT_RESULTS } = await import(
    new URL("../scripts/markets/rules/arbitrage.mjs", import.meta.url)
  );
  const queue = [
    { id: "a1", kind: "assess", actorUuid: "Actor.A", category: "", status: "pending" },
    { id: "s1", kind: "solicit", actorUuid: "Actor.A", category: "salt", status: "pending" },
    { id: "s0", kind: "solicit", actorUuid: "Actor.A", category: "wool", status: "done" },
    { id: "b1", kind: "assess", actorUuid: "Actor.B", category: "", status: "cancelled" },
  ];
  assert.strictEqual(pendingDuplicate(queue, { kind: "assess", actorUuid: "Actor.A" })?.id, "a1", "a second assessment while one waits is a duplicate");
  assert.strictEqual(pendingDuplicate(queue, { kind: "assess", actorUuid: "Actor.B" }), undefined, "a withdrawn day is no duplicate");
  assert.strictEqual(pendingDuplicate(queue, { kind: "solicit", actorUuid: "Actor.A", category: "salt" })?.id, "s1", "the same merchandise solicited twice");
  assert.strictEqual(pendingDuplicate(queue, { kind: "solicit", actorUuid: "Actor.A", category: "wool" }), undefined, "a resolved solicitation may be repeated");
  assert.strictEqual(pendingDuplicate(queue, { kind: "solicit", actorUuid: "Actor.A", category: "silk" }), undefined, "another merchandise is another day");
  assert.strictEqual(pendingDuplicate(queue, { kind: "assess", actorUuid: "Actor.C" }), undefined, "another trader's day is theirs");

  const owns = (uuid) => uuid === "Actor.A";
  assert.strictEqual(cancelVerdict(queue[0], { isGM: false, ownsActor: owns }), "ok", "a player withdraws their own pending day");
  assert.strictEqual(cancelVerdict(queue[2], { isGM: false, ownsActor: owns }), "notPending", "a resolved day cannot be withdrawn");
  assert.strictEqual(cancelVerdict(queue[3], { isGM: true, ownsActor: () => false }), "notPending", "nor a withdrawn one, even by the Judge");
  assert.strictEqual(cancelVerdict({ status: "pending", actorUuid: "Actor.B" }, { isGM: false, ownsActor: owns }), "notYours", "another trader's day is refused");
  assert.strictEqual(cancelVerdict({ status: "pending", actorUuid: "Actor.B" }, { isGM: true, ownsActor: owns }), "ok", "the Judge withdraws anyone's");
  assert.strictEqual(cancelVerdict(undefined, { isGM: true, ownsActor: owns }), "notPending", "no such day");

  const page = assessmentPageBands([{ min: null, max: 2 }, { min: 3, max: 5 }, { min: 6, max: 8 }, { min: 9, max: 11 }, { min: 12, max: null }]);
  assert.deepStrictEqual(page.map((b) => b.key), [...ASSESSMENT_RESULTS], "the page's rows carry the outcome names, worst first");
  assert.deepStrictEqual(page[0], { key: "false", max: 2 }, "an open low end is omitted");
  assert.deepStrictEqual(page[4], { key: "success", min: 12 }, "an open high end is omitted");
  assert.strictEqual(assessmentPageBands(null), null, "an unread column gives no page");
  assert.strictEqual(assessmentPageBands([{ min: 1, max: 2 }]), null, "a short column is not the table");

  // Leaving: the row stays, entered no longer; the party's waiting days go with it, and its solicitations.
  const { leaveMarket } = await import(new URL("../scripts/markets/rules/arbitrage.mjs", import.meta.url));
  const state = {
    ventures: [
      { partyId: "p1", monthStartTime: 1000, cargoSt: 40, impact: 2, effectiveClass: 3, tollCp: 400, entered: true },
      { partyId: "p2", monthStartTime: 1000, cargoSt: 10, impact: 1, effectiveClass: 3, tollCp: 100, entered: true },
    ],
    actions: [
      { id: "q1", kind: "solicit", partyId: "p1", actorUuid: "Actor.A", category: "salt", status: "pending" },
      { id: "q2", kind: "assess", partyId: "p1", actorUuid: "Actor.A", category: "", status: "pending" },
      { id: "q3", kind: "extraSearch", partyId: "p1", actorUuid: "Actor.A", category: "", status: "pending" },
      { id: "q4", kind: "solicit", partyId: "p2", actorUuid: "Actor.B", category: "salt", status: "pending" },
      { id: "q5", kind: "solicit", partyId: "p1", actorUuid: "Actor.A", category: "wool", status: "done" },
    ],
    solicitations: [
      { partyId: "p1", category: "salt", monthStartTime: 1000, stones: 5 },
      { partyId: "p1", category: "wool", monthStartTime: 900, stones: 5 },
      { partyId: "p2", category: "salt", monthStartTime: 1000, stones: 3 },
    ],
  };
  const left = leaveMarket(state, { partyId: "p1", monthStart: 1000 });
  assert.deepStrictEqual(left, { ok: true, cancelledIds: ["q1", "q2"], droppedSolicitations: 1 }, "the party's own waiting venture days and this month's solicitations go");
  assert.strictEqual(state.ventures[0].entered, false, "the row stays, entered no longer");
  assert.strictEqual(state.ventures[0].tollCp, 400, "the toll paid is still on record");
  assert.strictEqual(state.ventures[1].entered, true, "another party's entry stands");
  assert.deepStrictEqual(
    state.actions.map((a) => a.status),
    ["cancelled", "cancelled", "pending", "pending", "done"],
    "an extended search, another party's day and a resolved day are untouched"
  );
  assert.deepStrictEqual(
    state.solicitations.map((s) => `${s.partyId}:${s.category}:${s.monthStartTime}`),
    ["p1:wool:900", "p2:salt:1000"],
    "only this party's rows for this month are dropped"
  );
  assert.deepStrictEqual(leaveMarket(state, { partyId: "p1", monthStart: 1000 }), { error: "notEntered" }, "leaving twice is refused");
  assert.deepStrictEqual(leaveMarket(state, { partyId: "p3", monthStart: 1000 }), { error: "notEntered" }, "a party never in is refused");
}

// ---- known markets: where a mercantile network's shift applies ----
{
  const { marketKnownTo, knownSource, visitStartDay } = await import(new URL("../scripts/markets/rules/known.mjs", import.meta.url));
  const L = "Actor.M1";
  const who = { actorUuid: "Actor.A", partyId: "p1", locationUuid: L };
  // An invented day of 10 seconds; the month opens at 1000 (day 100).
  const dayOf = (t) => Math.floor(t / 10);
  const month = 1000;
  const on = (day) => ({ visitStartDay: day, monthStart: month, dayOf });
  assert.strictEqual(marketKnownTo({}, who, on(102)), false, "a market with no record of the trader is unknown");
  assert.strictEqual(marketKnownTo({ ledger: [{ actorUuid: "Actor.A", time: 1015 }] }, who, on(101)), false, "a row from the visit's own day is the visit itself");
  assert.strictEqual(marketKnownTo({ ledger: [{ actorUuid: "Actor.A", time: 1005 }] }, who, on(101)), true, "a row from an earlier day is a visit before");
  assert.strictEqual(marketKnownTo({ ledger: [{ actorUuid: "Actor.B", time: 1005 }] }, who, on(101)), false, "another trader's rows say nothing");
  assert.strictEqual(marketKnownTo({ ledger: [{ actorUuid: "Actor.A", time: 1050 }] }, who, on(101)), false, "a row dated after the visit began (a clock wound back) is not a visit before");
  assert.strictEqual(marketKnownTo({ actions: [{ kind: "assess", actorUuid: "Actor.A", partyId: "p9", postedTime: 1002 }] }, who, on(101)), true, "a day the trader posted earlier counts");
  assert.strictEqual(marketKnownTo({ actions: [{ kind: "enter", actorUuid: "Actor.Z", partyId: "p1", postedTime: 1002 }] }, who, on(101)), true, "an entry the party posted earlier counts");
  assert.strictEqual(marketKnownTo({ actions: [{ kind: "solicit", actorUuid: "Actor.Z", partyId: "p1", postedTime: 1002 }] }, who, on(101)), false, "another member's other days are theirs");
  assert.strictEqual(marketKnownTo({ actions: [{ kind: "enter", actorUuid: "Actor.Z", partyId: "p1", postedTime: 1012 }] }, who, on(101)), false, "an entry on the visit's own day does not");
  assert.strictEqual(marketKnownTo({ ventures: [{ partyId: "p1", monthStartTime: 700 }] }, who, on(101)), true, "the party's row from an earlier month counts");
  assert.strictEqual(marketKnownTo({ ventures: [{ partyId: "p1", monthStartTime: month }] }, who, on(101)), false, "this month's row alone is the visit itself");
  assert.strictEqual(marketKnownTo({ ventures: [{ partyId: "p2", monthStartTime: 700 }] }, who, on(101)), false, "another party's entry is theirs");
  assert.strictEqual(marketKnownTo({ ventures: [{ partyId: "p1", monthStartTime: 700 }] }, { ...who, partyId: null }, on(101)), false, "no party, no party evidence");
  assert.strictEqual(knownSource({ knownMarkets: [L] }, who, on(100)), "judge", "the Judge's list counts on the first day");
  assert.strictEqual(knownSource({ ledger: [{ actorUuid: "Actor.A", time: 1005 }] }, who, on(101)), "record", "the record says where knowledge came from");
  assert.strictEqual(marketKnownTo({ knownMarkets: ["Actor.M2"] }, who, on(101)), false, "a listing of another market does not");
  assert.strictEqual(marketKnownTo({ knownMarkets: [L] }, { ...who, actorUuid: "" }, on(101)), false, "no trader, nothing known");

  // The current visit: an entered party is on the visit its entry opened.
  const at = 1035; // day 103
  assert.strictEqual(visitStartDay({ partyId: "p1", monthStart: month, at, dayOf }), 103, "a party not entered is on a visit of one day");
  assert.strictEqual(visitStartDay({ ventures: [{ partyId: "p1", monthStartTime: month, entered: true, enteredTime: 1012 }], partyId: "p1", monthStart: month, at, dayOf }), 101, "an entered party's visit began the day its entry was posted");
  const oldRow = [{ partyId: "p1", monthStartTime: month, entered: true, enteredTime: 0 }];
  const entries = [
    { kind: "enter", partyId: "p1", status: "done", postedTime: 1004 },
    { kind: "enter", partyId: "p1", status: "done", postedTime: 1021 },
    { kind: "enter", partyId: "p1", status: "cancelled", postedTime: 1031 },
  ];
  assert.strictEqual(visitStartDay({ ventures: oldRow, actions: entries, partyId: "p1", monthStart: month, at, dayOf }), 102, "a row with no entry time reads the latest entry posted");
  assert.strictEqual(visitStartDay({ ventures: oldRow, partyId: "p1", monthStart: month, at, dayOf }), 100, "and with none, the month's start");
  assert.strictEqual(visitStartDay({ ventures: [{ partyId: "p1", monthStartTime: month, entered: false }], partyId: "p1", monthStart: month, at, dayOf }), 103, "a party that left is on a fresh visit");

  // Enter on one day, leave and enter again on a later one: the first entry is a visit before.
  const plan = { actions: [{ kind: "enter", actorUuid: "Actor.A", partyId: "p1", status: "done", postedTime: 1003 }] };
  assert.strictEqual(marketKnownTo(plan, who, on(101)), true, "the second entry finds the first");
  assert.strictEqual(marketKnownTo(plan, who, on(100)), false, "and the first entry never finds itself");

  // The day a past row falls on: the calendar's own day length, else 86400 s.
  const { dayOfWorldTime } = await import(new URL("../scripts/lib/world-time.mjs", import.meta.url));
  const savedGame = globalThis.game;
  globalThis.game = { ...(savedGame ?? {}), time: { worldTime: 0, calendar: { days: { hoursPerDay: 2, minutesPerHour: 10, secondsPerMinute: 6 } } } };
  assert.strictEqual(dayOfWorldTime(5 * 120 + 1), 5, "a calendar's own day length counts the days");
  globalThis.game = { ...(savedGame ?? {}), time: { worldTime: 0 } };
  assert.strictEqual(dayOfWorldTime(86400 * 3 + 5), 3, "a clock with no calendar counts days of 86400 seconds");
  assert.strictEqual(dayOfWorldTime(undefined), null, "a reading that is no number is no day");
  globalThis.game = savedGame;

  // One ledger length for every writer.
  const { appendMarketLog, MARKET_LOG_CAP } = await import(new URL("../scripts/location/data/market-log.mjs", import.meta.url));
  const full = Array.from({ length: MARKET_LOG_CAP }, (_, i) => ({ time: i }));
  const appended = appendMarketLog(full, { time: "a" }, { time: "b" });
  assert.strictEqual(appended.length, MARKET_LOG_CAP, "the ledger keeps its cap");
  assert.deepStrictEqual([appended[0].time, appended.at(-1).time], [2, "b"], "and cuts from the oldest end");
  assert.deepStrictEqual(appendMarketLog(undefined, { time: 1 }), [{ time: 1 }], "an empty ledger takes its first row");
}

// ---- a trader's history out of the markets' ledgers ----
{
  const { historyRows, historyNetGp, HISTORY_TYPES } = await import(new URL("../scripts/markets/rules/ledger.mjs", import.meta.url));
  const ledgers = [
    {
      marketUuid: "Actor.M1",
      marketName: "First",
      rows: [
        { time: 100, type: "purchase", note: "A bought", actorUuid: "Actor.A", gp: -12 },
        { time: 300, type: "sale", note: "A sold", actorUuid: "Actor.A", gp: 30 },
        { time: 200, type: "monthRoll", note: "the month rolled", actorUuid: "", gp: 0 },
        { time: 250, type: "purchase", note: "B bought", actorUuid: "Actor.B", gp: -5 },
        { time: 260, type: "hire", note: "A hired someone", actorUuid: "Actor.A" },
      ],
    },
    { marketUuid: "Actor.M2", marketName: "Second", rows: [{ time: 400, type: "ventureAction", note: "A: assess posted", actorUuid: "Actor.A", gp: -3 }] },
  ];
  const mine = historyRows(ledgers, { actorUuids: ["Actor.A"] });
  assert.deepStrictEqual(mine.map((r) => [r.time, r.marketName]), [[400, "Second"], [300, "First"], [100, "First"]], "own rows only, newest first, across markets");
  assert.ok(!HISTORY_TYPES.includes("hire"), "a hire is the market's business, not trade history");
  assert.strictEqual(historyNetGp(mine), 15, "the net coin movement, paid negative");
  assert.deepStrictEqual(historyRows(ledgers, { actorUuids: ["Actor.A", "Actor.B"], limit: 2 }).map((r) => r.time), [400, 300], "the cap keeps the newest");
  assert.deepStrictEqual(historyRows(ledgers, { actorUuids: [] }), [], "nobody, nothing");
  assert.deepStrictEqual(historyRows(ledgers, { actorUuids: ["Actor.Z"] }), [], "a stranger sees nothing");
}

// ---- a sale draws its loads across a hold's stacks, or takes nothing ----
{
  const { planLoadDraw } = await import(new URL("../scripts/markets/rules/arbitrage.mjs", import.meta.url));
  const sacks = [{ id: "a", qty: 3 }, { id: "b", qty: 4 }, { id: "c", qty: 2 }];
  assert.deepStrictEqual(planLoadDraw(sacks, 5), { updates: [{ id: "b", qty: 2 }], deletes: ["a"], held: 9, short: false },
    "the first stack empties and the second breaks");
  assert.deepStrictEqual(planLoadDraw(sacks, 7), { updates: [], deletes: ["a", "b"], held: 9, short: false },
    "a draw that lands on a stack's edge breaks nothing");
  assert.deepStrictEqual(planLoadDraw(sacks, 10), { updates: [], deletes: [], held: 9, short: true },
    "short: the plan says what is held and takes nothing");
  assert.deepStrictEqual(planLoadDraw([{ id: "x", qty: 0 }, { id: "y", qty: 2.5 }], 2), { updates: [{ id: "y", qty: 0.5 }], deletes: [], held: 2, short: false },
    "an empty stack is passed over; a fraction of a load is not sold, and not thrown away");
  assert.strictEqual(planLoadDraw([{ id: "y", qty: 2.5 }], 3).short, true, "half a load does not make up a third");
  assert.deepStrictEqual(planLoadDraw(null, 0), { updates: [], deletes: [], held: 0, short: false }, "nothing asked, nothing taken");
}

console.log("test-markets: OK (availability, caps, pricing, magic pricing, imports, commissions, arbitrage, result bands, venture queue, ledger, item flags, identification, printed reader, load draws)");
