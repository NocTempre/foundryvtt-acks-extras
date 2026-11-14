/**
 * A market whose class is not known answers null and nothing reads a figure
 * for it. Every table below is invented, so a figure left in source fails.
 *
 * Run: node tools/test-market-class-unknown.mjs
 */
import assert from "node:assert";

class Field {
  constructor(options = {}) {
    this.options = options;
  }
}
const fieldsProxy = new Proxy({}, { get: () => Field });
globalThis.foundry = { abstract: { TypeDataModel: class {} }, data: { fields: fieldsProxy } };
globalThis.game = { i18n: { localize: (k) => k, format: (k) => k }, time: { worldTime: 0 }, settings: { get: () => null } };
globalThis.Hooks = { once() {}, on() {}, callAll() {} };

const availability = await import("../scripts/henchmen/rules/availability.mjs");
const { clampMarketClass, marketClassFromFamilies, shiftMarketClass, searchFeeFormula, henchmanExpr, mercenaryExpr, specialistExpr, rarityExpr, rollMonthlyPool } = availability;
const { LocationData } = await import("../scripts/location/data/location-data.mjs");
const { exchangeTermsAt } = await import("../scripts/lib/money.mjs");
const { characteristicsFor } = await import("../scripts/markets/engine/gate.mjs");
const { rangeOfTradeFor } = await import("../scripts/markets/engine/printed.mjs");

/** The registry seam: tables by `doc.table`, bracket lookup by a row's own edges. */
const withTables = (tables, fn) => {
  const saved = globalThis.acksExtras;
  globalThis.acksExtras = {
    lib: {
      tables: {
        hasDoc: (doc) => Object.keys(tables).some((k) => k.startsWith(`${doc}.`)),
        getTable: (doc, id) => {
          const t = tables[`${doc}.${id}`];
          if (!t) throw new Error(`no table ${doc}.${id}`);
          return t;
        },
        bracketRow: (rows, value) => rows.find((r) => value >= (r.min ?? -Infinity) && value <= (r.max ?? Infinity)) ?? null,
      },
    },
  };
  try {
    return fn();
  } finally {
    globalThis.acksExtras = saved;
  }
};

// Invented figures: the bracket bottoms at 40 families, classes are 2 and 5.
const TABLES = {
  "settlement.marketClassByFamilies": { rows: [{ min: 40, max: 99, marketClass: 5 }, { min: 100, max: null, marketClass: 2 }] },
  "availability.searchFees": { byMarketClass: { 1: "7d7", 2: "6d6", 3: "5d5", 4: "4d4", 5: "3d3", 6: "2d2" } },
  "availability.henchmanAvailability": { rows: [{ level: 1, wage: 3, byMarketClass: ["11", "12", "13", "14", "15", "16"] }] },
  "availability.mercenaryAvailability": { rows: [{ type: "troop", byMarketClass: ["21", "22", "23", "24", "25", "26"] }] },
  "availability.specialistAvailability": { rows: [{ type: "smith", wage: 1, wageUnit: "month", byMarketClass: ["31", "32", "33", "34", "35", "36"] }] },
  "rarity.rarityAvailability": { rows: [{ rarity: "common", byMarketClass: ["41", "42", "43", "44", "45", "46"] }] },
};

// ---- the clamp keeps a null a null; the range is the count of classes ----
for (const unknown of [null, undefined, "", "x", NaN]) assert.strictEqual(clampMarketClass(unknown), null, `${String(unknown)} is no class, and never the largest market`);
assert.deepStrictEqual([clampMarketClass(0), clampMarketClass(3), clampMarketClass(9), clampMarketClass("4")], [1, 3, 6, 4], "a known class clamps to 1..6");
assert.strictEqual(shiftMarketClass(null, 1), null, "an unknown class shifted is unknown");
assert.strictEqual(shiftMarketClass(null, 0), null, "an unknown class unshifted is unknown");
assert.strictEqual(shiftMarketClass(4, 2), 2, "a known class shifts one step per point");

// ---- the families table decides; a count outside every bracket decides nothing ----
withTables(TABLES, () => {
  assert.strictEqual(marketClassFromFamilies(60), 5, "a count inside a bracket takes its row's class");
  assert.strictEqual(marketClassFromFamilies(500), 2, "the open bracket takes its row's class");
  assert.strictEqual(marketClassFromFamilies(10), null, "a count below the smallest bracket is no class");
  assert.strictEqual(marketClassFromFamilies(0), null, "no families is no class");
});
withTables({ ...TABLES, "settlement.marketClassByFamilies": { rows: [{ min: 0, max: null }] } }, () => {
  assert.strictEqual(marketClassFromFamilies(5), null, "a row that names no class names none");
});

// ---- every figure that reads by class answers null for an unknown one ----
withTables(TABLES, () => {
  assert.strictEqual(searchFeeFormula(null), null, "no search fee for an unknown class");
  assert.strictEqual(searchFeeFormula(3), "5d5", "the class's own fee");
  assert.strictEqual(henchmanExpr(1, null), null, "no henchman availability");
  assert.strictEqual(mercenaryExpr("troop", undefined), null, "no troop availability");
  assert.strictEqual(specialistExpr("smith", null), null, "no specialist availability");
  assert.strictEqual(rarityExpr("common", null), null, "no rarity availability");
  assert.deepStrictEqual(henchmanExpr(1, 1), { expr: "11", wage: 3 }, "a known class reads its own column");
  assert.strictEqual(henchmanExpr(1, 9).expr, "16", "a class past the last clamps to the last column");
});
{
  let rolled = 0;
  const roll = async () => ++rolled;
  const pool = await withTables(TABLES, () => rollMonthlyPool({ kind: "henchman", level: 1 }, null, roll));
  assert.deepStrictEqual([pool, rolled], [{ error: "no-market-class" }, 0], "a pool is not rolled for an unknown class");
}

// ---- the real getter: override, then families, then nothing ----
const marketClassOf = (market, tables = TABLES) => {
  const getter = Object.getOwnPropertyDescriptor(LocationData.prototype, "marketClass").get;
  return withTables(tables, () => getter.call({ market }));
};
assert.strictEqual(marketClassOf(null), null, "a place with no market has no class");
assert.strictEqual(marketClassOf({ marketClassOverride: 3, urbanFamilies: 500 }), 3, "the Judge's override wins");
assert.strictEqual(marketClassOf({ urbanFamilies: 500 }), 2, "the families table decides without an override");
assert.strictEqual(marketClassOf({}), null, "a market with no override and no families has no class");
assert.strictEqual(marketClassOf({ urbanFamilies: null, marketClassOverride: null }), null, "and a blank override and families the same");
assert.strictEqual(marketClassOf({ urbanFamilies: 10 }), null, "families below the table's smallest bracket decide nothing");
assert.strictEqual(marketClassOf({ urbanFamilies: 500 }, {}), null, "no imported table decides nothing");
const hasMarket = Object.getOwnPropertyDescriptor(LocationData.prototype, "hasMarket").get;
assert.strictEqual(hasMarket.call({ market: {} }), true, "a market with no class is still a market");

// ---- the henchmen engine: nothing is posted, rolled or charged at an unknown class ----
{
  const { createPosting, effectiveMarketClass, rollMonth } = await import("../scripts/henchmen/engine/recruitment.mjs");
  const classless = { system: { hasMarket: true, marketClass: null, market: {} } };
  assert.strictEqual(effectiveMarketClass(classless, null), null, "no class is read for a recruiter either");
  assert.deepStrictEqual(await createPosting(classless, { kind: "henchman", level: 1 }, null), { error: "no-market-class" }, "a generic search is refused");
  assert.deepStrictEqual(
    await createPosting(classless, { kind: "henchmanByClass", level: 1, classKey: "alpha" }, null, { requestUserId: "u1" }),
    { error: "no-market-class" },
    "a player's directed search is refused"
  );
  assert.deepStrictEqual(
    await createPosting(classless, { kind: "henchmanByClass", classKey: "alpha" }, null, { requestUserId: null }),
    { error: "no-market-class" },
    "a Judge's placement that leaves the level to a roll is refused"
  );
  assert.deepStrictEqual(await createPosting({ system: { hasMarket: false } }, { kind: "henchman", level: 1 }, null), { error: "no-market" }, "no market is still its own refusal");
  assert.deepStrictEqual(await rollMonth(classless, 0), { error: "no-market-class" }, "a month is not rolled");
}

// ---- a market with no class is a market for coin, and no class reads a table row ----
assert.deepStrictEqual(exchangeTermsAt({ documentName: "Actor", type: "acks-extras.location", system: { hasMarket: true, marketClass: null } }), { mode: "market" }, "a classless market still changes money");
assert.strictEqual(characteristicsFor(null), null, "no characteristics row for an unknown class");
assert.strictEqual(rangeOfTradeFor(null), null, "no range of trade for an unknown class");

console.log("test-market-class-unknown: OK (the clamp, the families table, each availability reader, the pool, the getter, coin, table rows)");
