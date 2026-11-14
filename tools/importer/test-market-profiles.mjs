/**
 * Setting-book market profiles: the pure half of binding a regional demand
 * grid and its domain records onto places.
 *
 * Every grid, record and figure here is INVENTED. What is pinned is the
 * SHAPE: a printed cell parses or is skipped; a column translates through the
 * Judge's alias before the default map, and one that translates nowhere is
 * reported rather than dropped; the domain record's class outranks the
 * grid's and a disagreement is flagged; an import never overwrites a class,
 * a family count or a base demand the Judge already set; a record that
 * declares its family count a misprint supplies none; and a later printing's
 * base replaces an earlier one's, never the reverse.
 */
import assert from "node:assert/strict";
import { MODULE_ID } from "../../scripts/importer/constants.mjs";
import { executeEntry } from "../../scripts/importer/executor.mjs";
import {
  ACKS1_GOODS, baseIsForceable, baseIsImportable, erratumStamp, goodsResolver, heldErratumNotes, marketActorData, marketEntryId, marketOrdinal,
  marketProfileUpdate, marketProfiles, parseDm, parseFamilies, parseMarketClass, placeName, unprintedMarketUpdate, withErratumNote,
} from "../../scripts/importer/market-profile-binding.mjs";
import { MERCHANDISE_TYPES } from "../../scripts/markets/config.mjs";

let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

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

ok("a record that declares its family count a misprint supplies none, and its place keeps the count it holds", () => {
  const records = { mkt1: { families: "1,204", marketClass: "V", familiesErratum: "bk-p9-families" } };
  const [p] = marketProfiles({ grids: [GRID], records, resolve: goodsResolver([]) });
  assert.equal(p.families, null);
  assert.equal(p.familiesErratum, "bk-p9-families");
  // The record still supplies its class, which agrees with its row.
  assert.equal(p.marketClass, 5);
  assert.equal(p.classConflict, false);
  const fresh = marketProfileUpdate(null, p, SOURCE);
  assert.equal(fresh.wrote.families, false);
  assert.equal("urbanFamilies" in fresh.update["system.market"], false);
  const held = { marketClassOverride: null, urbanFamilies: 88, goods: {} };
  for (const force of [false, true]) {
    const { update, wrote } = marketProfileUpdate(held, p, SOURCE, { force });
    assert.equal(wrote.families, false);
    assert.equal("system.market.urbanFamilies" in update, false);
  }
  // A record that declares nothing still supplies its count.
  const [plain] = marketProfiles({ grids: [GRID], records: { mkt1: { families: "1,204", marketClass: "V" } }, resolve: goodsResolver([]) });
  assert.equal(plain.families, 1204);
  assert.equal(plain.familiesErratum, null);
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
  assert.deepEqual(wrote, { marketClass: true, families: true, demand: true, gateToll: false });
  assert.equal(update["system.market"].marketClassOverride, 5);
  assert.equal(update["system.market"].urbanFamilies, 90);
  assert.deepEqual(update["system.market"].goods.dmProfile.source, SOURCE);
});

ok("an import never overwrites what the Judge set", () => {
  const [p] = marketProfiles({ grids: [GRID], records: { mkt1: { families: "90", marketClass: "V" } }, resolve: goodsResolver([]) });
  const judged = { marketClassOverride: 2, urbanFamilies: 12, goods: { demand: [{ category: "salt", modifier: -1 }], dmProfile: { source: null } } };
  const { update, wrote } = marketProfileUpdate(judged, p, SOURCE);
  assert.deepEqual(wrote, { marketClass: false, families: false, demand: false, gateToll: false });
  assert.deepEqual(update, {});
});

ok("a record's gate toll lands where the place holds none, and never over the Judge's choice unless forced", () => {
  const records = { mkt1: { families: "90", marketClass: "V", gateToll: "city" } };
  const [p] = marketProfiles({ grids: [GRID], records, resolve: goodsResolver([]) });
  assert.equal(p.gateToll, "city");
  assert.equal(marketProfiles({ grids: [GRID], resolve: goodsResolver([]) })[0].gateToll, null);
  // A fresh market subtree gains it beside the base.
  const fresh = marketProfileUpdate(null, p, SOURCE);
  assert.equal(fresh.wrote.gateToll, true);
  assert.equal(fresh.update["system.market"].goods.gateToll, "city");
  // A market that holds none, null or absent, takes it.
  for (const goods of [{ gateToll: null }, {}]) {
    const { update, wrote } = marketProfileUpdate({ marketClassOverride: 2, urbanFamilies: 12, goods }, p, SOURCE);
    assert.equal(wrote.gateToll, true);
    assert.equal(update["system.market.goods.gateToll"], "city");
  }
  // An explicit "class" is the Judge's and stands; force writes over it.
  const judged = { marketClassOverride: 2, urbanFamilies: 12, goods: { gateToll: "class" } };
  const kept = marketProfileUpdate(judged, p, SOURCE);
  assert.equal(kept.wrote.gateToll, false);
  assert.equal("system.market.goods.gateToll" in kept.update, false);
  const forced = marketProfileUpdate(judged, p, SOURCE, { force: true });
  assert.equal(forced.wrote.gateToll, true);
  assert.equal(forced.update["system.market.goods.gateToll"], "city");
  // A record that names none writes none, even under force.
  const [plain] = marketProfiles({ grids: [GRID], resolve: goodsResolver([]) });
  const none = marketProfileUpdate(judged, plain, SOURCE, { force: true });
  assert.equal(none.wrote.gateToll, false);
  assert.equal("system.market.goods.gateToll" in none.update, false);
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

ok("a later printing's base replaces an earlier one's; never the reverse, an unordered tie, or the Judge's", () => {
  const held = (book) => ({ demand: [{ category: "salt", modifier: 1 }], dmProfile: { source: book ? { book, page: `${book} p.1` } : null } });
  const from = (book) => ({ book, page: `${book} p.2` });
  // ax1 is printed before ax3; ax5 and ax6 share a year and the series order puts ax6 later;
  // the Compendium shares it and is placed against no AX book.
  assert.equal(baseIsImportable(held("ax1"), from("ax3")), true);
  assert.equal(baseIsImportable(held("ax3"), from("ax1")), false);
  assert.equal(baseIsImportable(held("ax5"), from("ax6")), true);
  assert.equal(baseIsImportable(held("ax6"), from("ax5")), false);
  assert.equal(baseIsImportable(held("ax2"), from("ax6")), true);
  assert.equal(baseIsImportable(held("axc"), from("ax6")), false);
  assert.equal(baseIsImportable(held("ax6"), from("axc")), false);
  assert.equal(baseIsImportable(held("rr"), from("jj")), false);
  assert.equal(baseIsImportable(held("bk"), from("ax3")), false);
  assert.equal(baseIsImportable(held(null), from("ax3")), false);
});

ok("a forced repair writes the class, families and base over the Judge's, but never over a later printing's base", () => {
  const [p] = marketProfiles({ grids: [GRID], records: { mkt1: { families: "90", marketClass: "V" } }, resolve: goodsResolver([]) });
  const judged = { marketClassOverride: 2, urbanFamilies: 12, goods: { demand: [{ category: "salt", modifier: -1 }], dmProfile: { source: null } } };
  const { update, wrote } = marketProfileUpdate(judged, p, SOURCE, { force: true });
  assert.deepEqual(wrote, { marketClass: true, families: true, demand: true, gateToll: false });
  assert.equal(update["system.market.marketClassOverride"], 5);
  assert.deepEqual(update["system.market.goods.demand"], p.demand);
  const later = { ...judged, goods: { demand: [{ category: "salt", modifier: 1 }], dmProfile: { source: { book: "ax3", page: "ax3 p.1" } } } };
  const earlier = marketProfileUpdate(later, p, { book: "ax1", page: "ax1 p.2" }, { force: true });
  assert.equal(earlier.wrote.demand, false);
  assert.equal(earlier.wrote.marketClass, true);
  assert.equal(baseIsForceable(later.goods, { book: "ax1", page: "ax1 p.2" }), false);
  assert.equal(baseIsForceable(later.goods, { book: "ax5", page: "ax5 p.2" }), true);
  assert.equal(baseIsForceable({ ...later.goods, dmProfile: { source: { book: "ax6", page: "ax6 p.1" } } }, { book: "ax5", page: "ax5 p.2" }), false);
  assert.equal(baseIsForceable({ ...later.goods, dmProfile: { source: { book: "axc", page: "axc p.1" } } }, { book: "ax5", page: "ax5 p.2" }), true);
  assert.equal(baseIsForceable({ demand: [] }, SOURCE), true);
  const unforced = marketProfileUpdate(judged, p, SOURCE);
  assert.deepEqual(unforced.update, {});
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

// --- a sideways grid, one market per column ---------------------------------------------------
// Three invented markets printed as columns: each row is a market keyed as its
// column, each cell a modifier for one banded good, each column headed.
const SIDEWAYS = {
  header: { mkt1: "Alder Quay", mkt2: "Birch Ford", mkt3: "Cedar Row", salt: "Salt", textiles: "Weave", gems: "Stones" },
  rows: [
    { key: "mkt1", cells: { salt: "+2", textiles: "-1", gems: "0" } },
    { key: "mkt2", cells: { salt: "-3", textiles: "+1", gems: "+4" } },
    { key: "mkt3", cells: { salt: "0", textiles: "+2", gems: "-2" } },
  ],
};
const STOCKED = goodsResolver([{ key: "salt" }, { key: "textiles" }, { key: "gems" }]);

ok("a sideways grid reads one profile per column, keyed as the column, one demand row per banded good", () => {
  const profiles = marketProfiles({ grids: [SIDEWAYS], resolve: STOCKED });
  assert.deepEqual(profiles.map((p) => p.market), ["mkt1", "mkt2", "mkt3"]);
  for (const p of profiles) {
    assert.equal(p.demand.length, 3);
    assert.deepEqual(p.unmapped, []);
    assert.deepEqual(p.duplicates, []);
    assert.equal(p.marketClass, null);
  }
  assert.deepEqual(profiles[1].demand, [{ category: "salt", modifier: -3 }, { category: "textiles", modifier: 1 }, { category: "gems", modifier: 4 }]);
  // Every cell is a modifier; every column carries a header that names its market.
  for (const row of SIDEWAYS.rows) for (const cell of Object.values(row.cells)) assert.notEqual(parseDm(cell), null);
  for (const row of SIDEWAYS.rows) assert.notEqual(placeName(SIDEWAYS.header[row.key]), "");
});

ok("a market's base lands only where the catalogue answers its goods", () => {
  const noneStocked = marketProfiles({ grids: [SIDEWAYS], resolve: goodsResolver([{ key: "unrelated" }]) });
  for (const p of noneStocked) {
    assert.equal(p.demand.length, 0);
    assert.equal(p.unmapped.length, 3);
    assert.equal(marketProfileUpdate(null, p, SOURCE).wrote.demand, false);
  }
  const stocked = marketProfiles({ grids: [SIDEWAYS], resolve: STOCKED });
  for (const p of stocked) assert.equal(marketProfileUpdate(null, p, SOURCE).wrote.demand, true);
});

ok("a market made from a column is a location stamped as the column's market, named for its header", () => {
  const [p] = marketProfiles({ grids: [SIDEWAYS], resolve: STOCKED });
  const name = placeName(SIDEWAYS.header[p.market]);
  const data = marketActorData({ name, entryId: marketEntryId("bk", p.market), book: "bk" });
  assert.equal(data.type, "acks-extras.location");
  assert.equal(data.name, "Alder Quay");
  const stamp = data.flags[MODULE_ID].cookbook;
  assert.equal(stamp.id, "bk.mkt1");
  assert.equal(stamp.book, "bk");
  assert.equal(stamp.kind, "kind.marketRecord");
  assert.equal(stamp.printed, data.name);
  // The neutral label is the fallback the header replaces, never the other way round.
  assert.notEqual(data.name, `ACKS-IMPORTER.markets.label ${marketOrdinal(p.market)}`);
});

ok("a made market carries its column's base and the page it was read from, nothing the grid does not print", () => {
  const profiles = marketProfiles({ grids: [SIDEWAYS], resolve: STOCKED });
  for (const p of profiles) {
    const { update, wrote } = marketProfileUpdate(null, p, SOURCE);
    assert.deepEqual(wrote, { marketClass: false, families: false, demand: true, gateToll: false });
    const goods = update["system.market"].goods;
    assert.deepEqual(goods.demand, p.demand);
    assert.deepEqual(goods.dmProfile.source, SOURCE);
    assert.deepEqual(Object.keys(update["system.market"]), ["goods"]);
  }
});

ok("a column joined onto a place that held no base gives it the base alone; a place's own fields are never in the update", () => {
  const [p] = marketProfiles({ grids: [SIDEWAYS], resolve: STOCKED });
  const held = { marketClassOverride: 4, urbanFamilies: 55, goods: { demand: [], dmProfile: { source: null } } };
  const { update, wrote } = marketProfileUpdate(held, p, SOURCE);
  assert.equal(wrote.demand, true);
  assert.deepEqual(update["system.market.goods.demand"], p.demand);
  assert.deepEqual(update["system.market.goods.dmProfile.source"], SOURCE);
  // Name, notes, parent and region are not part of this update; the class and count the place holds stand.
  assert.deepEqual(Object.keys(update).sort(), ["system.market.goods.demand", "system.market.goods.dmProfile.source"]);
});

ok("a hand-moved base stands through every later run, and an untouched one is written again", () => {
  const [p] = marketProfiles({ grids: [SIDEWAYS], resolve: STOCKED });
  const first = marketProfileUpdate(null, p, SOURCE).update["system.market"];
  // A run over what the last run wrote refreshes the base.
  const again = marketProfileUpdate({ goods: structuredClone(first.goods) }, p, SOURCE);
  assert.equal(again.wrote.demand, true);
  assert.deepEqual(again.update["system.market.goods.demand"], p.demand);
  // A hand write moves one row and clears the source: the next two runs leave it alone.
  const moved = structuredClone(first.goods);
  moved.demand[0].modifier += 1;
  moved.dmProfile.source = null;
  for (let run = 0; run < 2; run++) {
    const { update, wrote } = marketProfileUpdate({ goods: moved }, p, SOURCE);
    assert.equal(wrote.demand, false);
    assert.deepEqual(update, {});
  }
});

// A sideways grid read through the real executor from an invented page: the header is keyed by
// column and the goods' printed names ride in `labels`.
const run = (str, x, y) => ({ str, x, y, w: str.length * 5, h: 9 });
const sidewaysPage = {
  width: 612,
  height: 792,
  items: [
    run("Qa", 110, 88), run("Qb", 210, 88),
    run("Brine Casks", 10, 110), run("+1", 110, 110), run("-2", 210, 110),
    run("Wool Bolts", 10, 130), run("0", 110, 130), run("3", 210, 130),
    run("Salt Lumps", 10, 150), run("+2", 110, 150), run("+1", 210, 150),
  ],
};
const readSideways = async () => {
  const cookbook = {
    schema: "acks-cookbook/3",
    entries: { "qq.grid": { kind: "kind.marketGrid", fields: { "grids.markets": {
      op: "grid", page: 1, transpose: true, box: { x0: 0, x1: 300, y0: 100, y1: 160 }, label: { x0: 0, x1: 90 },
      headerBand: { y0: 82, y1: 95 }, rowBands: [{ y0: 105, y1: 115 }, { y0: 125, y1: 135 }, { y0: 145, y1: 155 }],
      cols: [{ key: "mkt1", x0: 100, x1: 190 }, { key: "mkt2", x0: 200, x1: 290 }],
    } } } },
  };
  const node = await executeEntry(null, cookbook, {}, "qq.grid", { pageCache: new Map([[1, sidewaysPage]]) });
  return node.fields["grids.markets"] ?? node.fields.grids?.markets;
};

await ok("a sideways grid's unmapped goods are reported by their printed label, not their key", async () => {
  const grid = await readSideways();
  assert.deepEqual(Object.keys(grid.header), ["mkt1", "mkt2"], "the header is keyed by column and names no good");
  assert.deepEqual(grid.labels, { brineCasks: "Brine Casks", woolBolts: "Wool Bolts", saltLumps: "Salt Lumps" });
  const resolve = goodsResolver([{ key: "clothing", aliases: ["woolBolts"] }, { key: "salt", aliases: ["saltLumps"] }]);
  const [one, two] = marketProfiles({ grids: [grid], resolve });
  assert.deepEqual(one.unmapped, [{ column: "brineCasks", header: "Brine Casks" }]);
  assert.deepEqual(two.unmapped, [{ column: "brineCasks", header: "Brine Casks" }]);
  assert.deepEqual(one.demand, [{ category: "clothing", modifier: 0 }, { category: "salt", modifier: 2 }]);
  // The label reports; it never maps: the resolver is handed the column's own header, which a sideways grid lacks.
  const seen = [];
  const spy = (column, header) => { seen.push(header); return null; };
  marketProfiles({ grids: [grid], resolve: spy });
  assert.equal(seen.length > 0 && seen.every((h) => h === undefined), true);
});

await ok("a grid with no property labels reports a good by its column key", () => {
  const bare = { rows: [{ key: "mkt1", cells: { brineCasks: "+1" } }], header: { mkt1: "Qa" } };
  const [p] = marketProfiles({ grids: [bare], resolve: goodsResolver([]) });
  assert.deepEqual(p.unmapped, [{ column: "brineCasks", header: "brineCasks" }]);
});

console.log(`\ntest-market-profiles: ${passed} passed`);
