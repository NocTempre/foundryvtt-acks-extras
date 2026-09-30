/**
 * Setting-book market profiles: the pure half of binding a regional demand
 * grid and its domain records onto places.
 *
 * Every grid, record and figure here is INVENTED. What is pinned is the
 * SHAPE: a printed cell parses or is skipped; a column translates through the
 * Judge's alias before the default map, and one that translates nowhere is
 * reported rather than dropped; the domain record's class outranks the
 * grid's and a disagreement is flagged; and an import never overwrites a
 * class, a family count or a base demand the Judge already set.
 */
import assert from "node:assert/strict";
import {
  ACKS1_GOODS, baseIsImportable, goodsResolver, marketEntryId, marketOrdinal, marketProfileUpdate,
  marketProfiles, parseDm, parseFamilies, parseMarketClass, placeName,
} from "../../scripts/importer/market-profile-binding.mjs";

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok   " + name); };

const SOURCE = { book: "bk", page: "BK p.9" };

ok("parseDm reads signed and unsigned integers, any minus glyph", () => {
  assert.equal(parseDm("+3"), 3);
  assert.equal(parseDm("2"), 2);
  assert.equal(parseDm("-1"), -1);
  assert.equal(parseDm("−4"), -4);
  assert.equal(parseDm("0"), 0);
  assert.equal(parseDm(""), null);
  assert.equal(parseDm("—"), null);
  assert.equal(parseDm("1/2"), null);
});

ok("parseMarketClass reads roman and arabic I–VI only", () => {
  assert.equal(parseMarketClass("iii"), 3);
  assert.equal(parseMarketClass("VI"), 6);
  assert.equal(parseMarketClass("5"), 5);
  assert.equal(parseMarketClass("VII"), null);
  assert.equal(parseMarketClass(""), null);
});

ok("parseFamilies strips thousands separators", () => {
  assert.equal(parseFamilies("7,301"), 7301);
  assert.equal(parseFamilies("42"), 42);
  assert.equal(parseFamilies("about 40"), null);
});

ok("the default map only names keys a stocked catalogue holds", () => {
  const none = goodsResolver([]);
  assert.equal(none("fishPreserved"), ACKS1_GOODS.fishPreserved);
  const thin = goodsResolver([{ key: "salt" }]);
  assert.equal(thin("salt"), "salt");
  assert.equal(thin("fishPreserved"), null);
  assert.equal(none("animals"), null);
});

ok("a Judge alias wins over the default map, by column key or printed header", () => {
  const resolve = goodsResolver([
    { key: "salt" }, { key: "textiles" },
    { key: "clothing", aliases: ["cloth"] },
    { key: "herdBeasts", aliases: ["Beasts of Burden"] },
    { key: "brine", aliases: ["salt"] },
  ]);
  assert.equal(resolve("cloth", "Bolts"), "clothing");
  assert.equal(resolve("animals", "Beasts of burden"), "herdBeasts");
  assert.equal(resolve("salt", "Salt"), "brine");
});

const GRID = {
  header: { salt: "Salt", animals: "Beasts", textiles: "Weave", cloth: "Bolts", marketClass: "Class" },
  rows: [
    { key: "mkt1", label: "", cells: { salt: "+2", animals: "-1", textiles: "0", cloth: "1", marketClass: "V" } },
    { key: "mkt2", label: "", cells: { salt: "-3", animals: "", textiles: "+1", cloth: "-1", marketClass: "IV" } },
  ],
};

ok("profiles translate, report unmapped columns, and a Judge alias outranks the default map", () => {
  const resolve = goodsResolver([{ key: "salt" }, { key: "textiles", aliases: ["cloth"] }]);
  const [one, two] = marketProfiles({ grids: [GRID], resolve });
  // "cloth" is aliased onto textiles on purpose, so its cell stands and the
  // default-mapped textiles column is the reported duplicate.
  assert.deepEqual(one.demand, [{ category: "textiles", modifier: 1 }, { category: "salt", modifier: 2 }]);
  assert.deepEqual(one.unmapped, [{ column: "animals", header: "Beasts" }]);
  assert.deepEqual(one.duplicates, ["textiles"]);
  assert.equal(one.marketClass, 5);
  assert.equal(one.families, null);
  // An empty cell is no modifier, not an unmapped good.
  assert.deepEqual(two.unmapped, []);
});

ok("with no Judge alias involved, page order decides a duplicate", () => {
  const resolve = (column) => ({ salt: "salt", animals: "salt" })[column] ?? null;
  const [one] = marketProfiles({ grids: [GRID], resolve });
  assert.deepEqual(one.demand, [{ category: "salt", modifier: 2 }]);
  assert.deepEqual(one.duplicates, ["animals"]);
});

ok("the domain record's class and families outrank the grid, and a disagreement is flagged", () => {
  const resolve = goodsResolver([]);
  const profiles = marketProfiles({ grids: [GRID], records: { mkt1: { families: "1,204", marketClass: "III" }, mkt2: { marketClass: "IV" } }, resolve });
  assert.equal(profiles[0].marketClass, 3);
  assert.equal(profiles[0].gridClass, 5);
  assert.equal(profiles[0].families, 1204);
  assert.equal(profiles[0].classConflict, true);
  assert.equal(profiles[1].classConflict, false);
});

ok("a place with no market gains the whole subtree", () => {
  const [p] = marketProfiles({ grids: [GRID], records: { mkt1: { families: "90", marketClass: "V" } }, resolve: goodsResolver([]) });
  const { update, wrote } = marketProfileUpdate(null, p, SOURCE);
  assert.deepEqual(wrote, { marketClass: true, families: true, demand: true });
  assert.equal(update["system.market"].marketClassOverride, 5);
  assert.equal(update["system.market"].urbanFamilies, 90);
  assert.deepEqual(update["system.market"].goods.dmProfile.source, SOURCE);
});

ok("an import never overwrites what the Judge set", () => {
  const [p] = marketProfiles({ grids: [GRID], records: { mkt1: { families: "90", marketClass: "V" } }, resolve: goodsResolver([]) });
  const judged = { marketClassOverride: 2, urbanFamilies: 12, goods: { demand: [{ category: "salt", modifier: -1 }], dmProfile: { source: null } } };
  const { update, wrote } = marketProfileUpdate(judged, p, SOURCE);
  assert.deepEqual(wrote, { marketClass: false, families: false, demand: false });
  assert.deepEqual(update, {});
});

ok("a base from the same source refreshes; from another source it stands", () => {
  const same = { demand: [{ category: "salt", modifier: 1 }], dmProfile: { source: { ...SOURCE } } };
  const other = { demand: [{ category: "salt", modifier: 1 }], dmProfile: { source: { book: "bk", page: "BK p.10" } } };
  assert.equal(baseIsImportable(same, SOURCE), true);
  assert.equal(baseIsImportable(other, SOURCE), false);
  assert.equal(baseIsImportable({ demand: [] }, SOURCE), true);
  const [p] = marketProfiles({ grids: [GRID], resolve: goodsResolver([]) });
  const { update } = marketProfileUpdate({ marketClassOverride: null, urbanFamilies: null, goods: same }, p, SOURCE);
  assert.deepEqual(update["system.market.goods.demand"], p.demand);
  assert.equal(update["system.market.marketClassOverride"], 5);
  assert.equal("system.market.urbanFamilies" in update, false);
});

ok("a record heading's trailing parenthetical is not the place's name", () => {
  assert.equal(placeName("Northwatch (Keep Record)"), "Northwatch");
  assert.equal(placeName("Two Rivers"), "Two Rivers");
  assert.equal(placeName("A (b) Ford"), "A (b) Ford");
  assert.equal(placeName(""), "");
});

ok("market ids and ordinals", () => {
  assert.equal(marketEntryId("bk", "mkt7"), "bk.mkt7");
  assert.equal(marketOrdinal("mkt12"), 12);
});

console.log(`\ntest-market-profiles: ${passed} passed`);
