/**
 * Setting-book market profiles: the pure half of binding a regional demand
 * grid and its domain records onto places.
 *
 * Every grid, record and figure here is INVENTED. What is pinned is the
 * SHAPE: a printed cell parses or is skipped; a column translates through the
 * Judge's alias before the default map, and one that translates nowhere is
 * reported rather than dropped; the domain record's class outranks the
 * grid's and a disagreement is flagged; an import never overwrites a class,
 * a family count or a base demand the Judge already set; and a later
 * printing's base replaces an earlier one's, never the reverse.
 */
import assert from "node:assert/strict";
import { MODULE_ID } from "../../scripts/importer/constants.mjs";
import {
  ACKS1_GOODS, baseIsImportable, erratumStamp, goodsResolver, heldErratumNotes, marketActorData, marketEntryId, marketOrdinal,
  marketProfileUpdate, marketProfiles, parseDm, parseFamilies, parseMarketClass, placeName, unprintedMarketUpdate, withErratumNote,
} from "../../scripts/importer/market-profile-binding.mjs";
import { MERCHANDISE_TYPES } from "../../scripts/markets/config.mjs";

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

ok("every default translation lands on a merchandise type; cloth and tea or coffee feed two of them", () => {
  const types = new Set(MERCHANDISE_TYPES.map((t) => t.key));
  for (const [column, key] of Object.entries(ACKS1_GOODS)) assert.ok(types.has(key), `${column} → ${key}`);
  const stocked = goodsResolver(MERCHANDISE_TYPES);
  assert.equal(stocked("cloth"), "clothing");
  assert.equal(stocked("teaCoffee"), "botanicals");
  assert.equal(stocked("animals"), null);
  assert.equal(stocked("mounts"), null);
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

ok("a record that declares the grid's class a misprint keeps its class with no conflict", () => {
  const records = { mkt1: { marketClass: "III", gridClassErratum: "bk-p9-class" } };
  const [p] = marketProfiles({ grids: [GRID], records, resolve: goodsResolver([]) });
  assert.equal(p.marketClass, 3);
  assert.equal(p.gridClass, 5);
  assert.equal(p.classConflict, false);
});

ok("a corrected market whose base this page stocked takes the class with it; any other keeps its class", () => {
  const [p] = marketProfiles({ grids: [GRID], resolve: goodsResolver([]) });
  const stocked = (source) => ({ marketClassOverride: 4, urbanFamilies: null, goods: { demand: [{ category: "salt", modifier: 1 }], dmProfile: { source } } });
  const plain = marketProfileUpdate(stocked({ ...SOURCE }), p, SOURCE).update;
  assert.equal("system.market.marketClassOverride" in plain, false);
  assert.deepEqual(plain["system.market.goods.demand"], p.demand);
  const fixed = marketProfileUpdate(stocked({ ...SOURCE }), p, SOURCE, { corrected: true }).update;
  assert.equal(fixed["system.market.marketClassOverride"], 5);
  const elsewhere = marketProfileUpdate(stocked({ book: "bk", page: "BK p.10" }), p, SOURCE, { corrected: true }).update;
  assert.deepEqual(elsewhere, {});
  const judged = marketProfileUpdate(stocked(null), p, SOURCE, { corrected: true }).update;
  assert.deepEqual(judged, {});
});

ok("a corrected market no band holds loses only what this page wrote", () => {
  const market = (source) => ({ marketClassOverride: 4, goods: { demand: [{ category: "salt", modifier: 1 }], dmProfile: { source } } });
  assert.deepEqual(unprintedMarketUpdate(market({ ...SOURCE }), SOURCE), {
    "system.market.goods.demand": [], "system.market.goods.dmProfile.source": null, "system.market.marketClassOverride": null,
  });
  assert.deepEqual(unprintedMarketUpdate(market({ book: "bk", page: "BK p.10" }), SOURCE), {});
  assert.deepEqual(unprintedMarketUpdate(market(null), SOURCE), {});
  assert.deepEqual(unprintedMarketUpdate(null, SOURCE), {});
});

ok("an erratum note cites the page it corrects, lands once, and follows the notes held", () => {
  const note = { entryId: "bk.mkt4", text: "Corrected.", cite: "BK p.9", book: "bk", page: 11 };
  const once = withErratumNote("<p>Judge</p>", note);
  assert.ok(once.startsWith("<p>Judge</p>"));
  assert.ok(once.includes(`data-acks-entry="${erratumStamp("bk.mkt4")}"`));
  assert.ok(once.includes('data-book="bk"') && once.includes('data-page="11"'));
  assert.equal(withErratumNote(once, note), null);
  const held = heldErratumNotes(once, ["bk.mkt4"]);
  assert.equal(held.blocks.length, 1);
  assert.equal(held.rest, "<p>Judge</p>");
  assert.equal(heldErratumNotes(withErratumNote("", note), ["bk.mkt4"]).rest, "");
  assert.deepEqual(heldErratumNotes(once, ["bk.mkt5"]).blocks, []);
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

ok("a later printing's base replaces an earlier one's; never the reverse, a tie, or the Judge's", () => {
  const held = (book) => ({ demand: [{ category: "salt", modifier: 1 }], dmProfile: { source: book ? { book, page: `${book} p.1` } : null } });
  const from = (book) => ({ book, page: `${book} p.2` });
  // ax1 is printed before ax3; ax5 and ax6 share a year.
  assert.equal(baseIsImportable(held("ax1"), from("ax3")), true);
  assert.equal(baseIsImportable(held("ax3"), from("ax1")), false);
  assert.equal(baseIsImportable(held("ax5"), from("ax6")), false);
  assert.equal(baseIsImportable(held("ax6"), from("ax5")), false);
  assert.equal(baseIsImportable(held("bk"), from("ax3")), false);
  assert.equal(baseIsImportable(held(null), from("ax3")), false);
});

ok("a sideways grid's market carries no class, and lands without one", () => {
  const sideways = { rows: [{ key: "mkt2", cells: { salt: "+1", gems: "-2" } }], header: { mkt2: "Header Name" } };
  const [p] = marketProfiles({ grids: [sideways], resolve: goodsResolver([]) });
  assert.equal(p.marketClass, null);
  assert.deepEqual(p.unmapped, []);
  const { update, wrote } = marketProfileUpdate(null, p, SOURCE);
  assert.equal(wrote.marketClass, false);
  assert.equal("marketClassOverride" in update["system.market"], false);
  assert.equal(update["system.market"].goods.demand.length, 2);
});

ok("a market place keeps the name it was built under", () => {
  const data = marketActorData({ name: "Market 4", entryId: "bk.mkt4", book: "bk" });
  assert.equal(data.flags[MODULE_ID].cookbook.printed, "Market 4");
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
