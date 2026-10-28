/** The register rules between an adventure's rows, fed invented rows. No PDFs, no Foundry. */
import assert from "node:assert";
import {
  KEY_NUMBER, bareKey, erratumProblems, errataIdsOf, marketColumnProblems, ordinalProblems, pairProblems, regionMapProblems, rowMetaProblems, sceneLinkProblems,
  siteProblems, spaceKeyed, spaceProblems,
} from "./register-rules.mjs";

let pass = 0;
const check = (label, cond) => { assert.ok(cond, label); pass++; };
const none = (label, problems) => { assert.deepEqual(problems, [], `${label}: ${problems.join(" / ")}`); pass++; };
const flags = (label, problems, re) => { assert.ok(problems.some((p) => re.test(p)), `${label}: got ${JSON.stringify(problems)}`); pass++; };
const rowsOf = (...rows) => new Map(rows.map((r) => [r.id, r]));
const loc = (id, extra = {}) => ({ id, book: id.split(".")[0], kind: "kind.location", name: "x", anchor: { hash: "abc" }, ...extra });

/* --- key numbers: ranges and run-in keys are keys of their own --- */

for (const k of ["30.", "36U.", "20/20U.", "1-3.", "1–3.", "9a.", "12", "19r.", "11c-l.", "11m–p."]) check(`"${k}" is a key number`, KEY_NUMBER.test(k));
for (const k of ["1-.", "-3.", "1--3.", "a1.", "1-3-5.", "30 .", "1-a.", "11c-.", "11c-l-p."]) check(`"${k}" is not a key number`, !KEY_NUMBER.test(k));
check("a printed en dash is written as a hyphen", bareKey("1–3.") === "1-3");
check("the closing stop is dropped", bareKey("9a.") === "9a");

/* --- key spaces: id and label come from the space --- */

const fort = loc("ax1.fort", { name: "Fort" });
const level1 = loc("ax1.l1", { name: "Level 1" });
check("a stem ending in a letter takes no hyphen", spaceKeyed(fort, "9a.").id === "ax1.fort9a");
check("a stem ending in a digit takes a hyphen", spaceKeyed(level1, "12.").id === "ax1.l1-12");
check("a range keeps its hyphen in the id", spaceKeyed(fort, "1–3.").id === "ax1.fort1-3");
check("a range of lettered rooms keeps its hyphen in the id", spaceKeyed(fort, "11c-l.").id === "ax1.fort11c-l");
check("the label is the space's name and the key", spaceKeyed(level1, "12.").label === "Level 1 12");

const keyed = (id, name, number, meta) => loc(id, { name, anchor: { number, as: "runin" }, meta });
const building = keyed("ax1.fort9", "Fort 9", "9.", { space: "ax1.fort", parent: "ax1.fort" });
const subKey = keyed("ax1.fort9a", "Fort 9a", "9a.", { space: "ax1.fort", parent: "ax1.fort9" });
const room = keyed("ax1.l1-12", "Level 1 12", "12.", { space: "ax1.l1", parent: "ax1.l1" });
none("a well-formed space, building, sub-key and room", spaceProblems(rowsOf(fort, level1, building, subKey, room)));

flags("a keyed area under a POI label", spaceProblems(rowsOf(fort, keyed("ax1.fort9", "POI 9", "9.", { space: "ax1.fort" }))), /is named "Fort 9"/);
flags("a keyed area under an unscoped id", spaceProblems(rowsOf(level1, keyed("ax1.l112", "Level 1 12", "12.", { space: "ax1.l1" }))), /has the id "ax1\.l1-12"/);
flags("a space that names no row", spaceProblems(rowsOf(keyed("ax1.fort9", "Fort 9", "9.", { space: "ax1.keep" }))), /no row defines/);
flags("a space of another book", spaceProblems(rowsOf(loc("ax3.fort", { name: "Fort" }), keyed("ax1.fort9", "Fort 9", "9.", { space: "ax3.fort" }))), /another book/);
flags("a space anchored by its words", spaceProblems(rowsOf({ ...fort, anchor: { display: "x" } }, building)), /key space anchors by hash/);
flags("spaces do not nest", spaceProblems(rowsOf(fort, { ...level1, meta: { space: "ax1.fort" } }, keyed("ax1.l1-12", "Level 1 12", "12.", { space: "ax1.l1" }))), /do not nest/);
flags("a row in a space anchored by its words", spaceProblems(rowsOf(fort, loc("ax1.fortGate", { anchor: { display: "x" }, meta: { space: "ax1.fort" } }))), /key number or by hash/);
none("a section of a space anchors by hash", spaceProblems(rowsOf(level1, loc("ax1.l1-area1", { meta: { space: "ax1.l1", parent: "ax1.l1" } }))));
flags("meta.space on a person", spaceProblems(rowsOf(fort, { ...loc("ax1.npc1"), kind: "kind.npc", meta: { space: "ax1.fort" } })), /location row only/);

/* --- parents: same book, same space, no cycle --- */

flags("a parent in another space", spaceProblems(rowsOf(fort, level1, building, keyed("ax1.l1-12", "Level 1 12", "12.", { space: "ax1.l1", parent: "ax1.fort9" }))), /in the key space ax1\.fort/);
flags("a keyed area parented outside its space", spaceProblems(rowsOf(fort, loc("ax1.region"), keyed("ax1.fort9", "Fort 9", "9.", { space: "ax1.fort", parent: "ax1.region" }))), /outside every key space/);
flags("a row outside spaces parented inside one", spaceProblems(rowsOf(fort, building, loc("ax1.region", { meta: { parent: "ax1.fort9" } }))), /this row is outside every key space/);
none("a space parented by a place outside spaces", spaceProblems(rowsOf(loc("ax1.region"), { ...fort, meta: { parent: "ax1.region" } }, building)));
flags("a parent of another book", spaceProblems(rowsOf(loc("ax3.region"), loc("ax1.site1", { meta: { parent: "ax3.region" } }))), /row of another book/);
flags("a parent that names no row", spaceProblems(rowsOf(loc("ax1.site1", { meta: { parent: "ax1.nowhere" } }))), /no row defines/);
flags("a row parented by itself", spaceProblems(rowsOf(loc("ax1.site1", { meta: { parent: "ax1.site1" } }))), /the row itself/);
const cycle = spaceProblems(rowsOf(loc("ax1.a", { meta: { parent: "ax1.b" } }), loc("ax1.b", { meta: { parent: "ax1.a" } }), loc("ax1.c", { meta: { parent: "ax1.a" } })));
check("each row on a cycle reports it", cycle.filter((p) => /cycle/.test(p)).length === 2);
check("a row leading into a cycle does not", !cycle.some((p) => p.startsWith("ax1.c:")));

/* --- pairs: on the earlier book's row, with the reviewer's unique list --- */

const later = loc("ax3.site27");
const earlier = (meta, id = "ax1.fortPlace") => loc(id, { meta });
none("a pair from the earlier book", pairProblems(rowsOf(later, earlier({ sameAs: "ax3.site27", unique: [2, 5] }))));
none("an earlier printing that adds nothing", pairProblems(rowsOf(later, earlier({ sameAs: "ax3.site27", unique: [] }))));
flags("a pair declared on the later book's row", pairProblems(rowsOf(loc("ax1.fortPlace"), loc("ax3.site27", { meta: { sameAs: "ax1.fortPlace", unique: [] } }))), /earlier book's row/);
flags("a pair between books whose years tie", pairProblems(rowsOf(loc("ax4.x"), loc("ax2.x", { meta: { sameAs: "ax4.x", unique: [] } }))), /no printing year orders/);
flags("a pair with a book of no year", pairProblems(rowsOf(loc("qd1.x"), earlier({ sameAs: "qd1.x", unique: [] }))), /no printing year orders/);
flags("a pair within one book", pairProblems(rowsOf(loc("ax1.other"), earlier({ sameAs: "ax1.other", unique: [] }))), /another book's row/);
flags("a pair without the reviewer's list", pairProblems(rowsOf(later, earlier({ sameAs: "ax3.site27" }))), /carries meta\.unique/);
flags("a unique list of words", pairProblems(rowsOf(later, earlier({ sameAs: "ax3.site27", unique: ["intro"] }))), /paragraph ordinals/);
flags("a unique list counting from 0", pairProblems(rowsOf(later, earlier({ sameAs: "ax3.site27", unique: [0] }))), /paragraph ordinals/);
flags("a unique list that repeats", pairProblems(rowsOf(later, earlier({ sameAs: "ax3.site27", unique: [2, 2] }))), /repeats/);
flags("a unique list with no pair", pairProblems(rowsOf(earlier({ unique: [1] }))), /beside meta\.sameAs/);
flags("a pair with a missing row", pairProblems(rowsOf(earlier({ sameAs: "ax3.site99", unique: [] }))), /no row defines/);
flags("a pair with a row of another kind", pairProblems(rowsOf({ ...later, kind: "kind.npc" }, earlier({ sameAs: "ax3.site27", unique: [] }))), /another kind/);
flags("a pair with a place of another role", pairProblems(rowsOf({ ...later, meta: { role: "gate" } }, earlier({ sameAs: "ax3.site27", unique: [] }))), /another role/);
flags("a pair onto a market's site", pairProblems(rowsOf({ ...later, meta: { market: "mkt20" } }, earlier({ sameAs: "ax3.site27", unique: [] }))), /builds no place to pair/);
flags("a pair onto an adventure's site", pairProblems(rowsOf({ ...later, meta: { place: "adventure" } }, earlier({ sameAs: "ax3.site27", unique: [] }))), /builds no place to pair/);
flags("a pair from a market's site", pairProblems(rowsOf(later, earlier({ sameAs: "ax3.site27", unique: [], market: "mkt1" }))), /builds no place to pair/);
flags("a pair from a person", pairProblems(rowsOf(later, { ...earlier({ sameAs: "ax3.site27", unique: [] }), kind: "kind.npc" })), /location row only/);
flags("a list of pairs", pairProblems(rowsOf(later, earlier({ sameAs: ["ax3.site27"], unique: [] }))), /one row id/);
flags("two rows of one book on one place", pairProblems(rowsOf(later, earlier({ sameAs: "ax3.site27", unique: [] }), earlier({ sameAs: "ax3.site27", unique: [] }, "ax1.fortGate"))), /already paired with ax1\.fortPlace/);

/* --- the places a market grid's columns name --- */

const record = (id, meta = {}) => ({ id, book: id.split(".")[0], kind: "kind.marketRecord", meta: { market: id.split(".")[1], ...meta } });
const demandGrid = (markets, id = "ax1.marketGrid1") => ({
  id, book: id.split(".")[0], kind: "kind.marketGrid", meta: { markets },
  assists: { grids: { markets: { transpose: true, cols: [{ key: "mkt1" }, { key: "mkt2" }, { key: "mkt3" }] } } },
});
// A grid printed the other way round: its markets are its row bands, its columns goods.
const bandGrid = (meta, id = "ax3.marketGrid2") => ({
  id, book: id.split(".")[0], kind: "kind.marketGrid", meta,
  assists: { grids: { markets: { rowBands: [{ key: "mkt1" }, { key: "mkt2" }], cols: [{ key: "salt" }, { key: "marketClass" }] } } },
});
const ownPlace = loc("ax1.home");
const columns = (...rows) => marketColumnProblems(rowsOf(...rows));
none("a column paired with a later market, one on a place of its book, one on its settlement",
  columns(record("ax3.mkt9"), ownPlace, demandGrid({ mkt1: { sameAs: "ax3.mkt9" }, mkt2: { place: "ax1.home" }, mkt3: { place: "adventure" } })));
flags("a market the grid does not print", columns(ownPlace, demandGrid({ mkt7: { place: "ax1.home" } })), /no market of the grid/);
flags("a column naming both", columns(record("ax3.mkt9"), ownPlace, demandGrid({ mkt1: { sameAs: "ax3.mkt9", place: "ax1.home" } })), /exactly one of sameAs or place/);
flags("a column naming neither", columns(demandGrid({ mkt1: {} })), /exactly one of sameAs or place/);
flags("meta.markets on a place", columns({ ...ownPlace, meta: { markets: {} } }), /market grid row only/);
flags("a pair with a book printed earlier", columns(record("ax1.mkt9"), demandGrid({ mkt1: { sameAs: "ax1.mkt9" } }, "ax3.marketGrid9")), /earlier book's grid/);
flags("a pair within one book", columns(record("ax1.mkt9"), demandGrid({ mkt1: { sameAs: "ax1.mkt9" } })), /another book's market/);
flags("a pair between books whose years tie", columns(record("ax6.mkt9"), demandGrid({ mkt1: { sameAs: "ax6.mkt9" } }, "ax5.marketGrid1")), /no printing year orders/);
flags("a pair with a row no record defines", columns(demandGrid({ mkt1: { sameAs: "ax3.mkt9" } })), /no row defines/);
flags("a pair with a row that is no record", columns(loc("ax3.mkt9"), demandGrid({ mkt1: { sameAs: "ax3.mkt9" } })), /no market record/);
flags("a pair with a record that is its book's settlement", columns(record("ax3.mkt9", { place: "adventure" }), demandGrid({ mkt1: { sameAs: "ax3.mkt9" } })), /builds no market to pair/);
flags("two columns of one book on one market", columns(record("ax3.mkt9"), demandGrid({ mkt1: { sameAs: "ax3.mkt9" }, mkt2: { sameAs: "ax3.mkt9" } })), /already paired with ax1\.marketGrid1 mkt1/);
flags("a column and a place of one book on one market", columns(record("ax3.mkt9"), earlier({ sameAs: "ax3.mkt9", unique: [] }), demandGrid({ mkt1: { sameAs: "ax3.mkt9" } })), /already paired with ax1\.fortPlace/);
flags("a place of another book", columns(loc("ax3.home"), demandGrid({ mkt1: { place: "ax3.home" } })), /a row of ax1/);
flags("a place no row defines", columns(demandGrid({ mkt1: { place: "ax1.nowhere" } })), /no row defines/);
flags("a place that builds none", columns(loc("ax1.home", { meta: { market: "mkt2" } }), demandGrid({ mkt1: { place: "ax1.home" } })), /builds none/);
none("a row band of a grid printed the other way round lands on a place", columns(loc("ax3.home"), bandGrid({ markets: { mkt2: { place: "ax3.home" } } })));
flags("a goods column of that grid is no market", columns(loc("ax3.home"), bandGrid({ markets: { salt: { place: "ax3.home" } } })), /no market of the grid/);

/* --- the printing errors a market row declares --- */

const ERRATA_IDS = errataIdsOf("# Errata\n\n## bk-p9-offset\n\ntext\n\n### not-an-entry\n");
const errata = (...rows) => erratumProblems(rowsOf(...rows), ERRATA_IDS);
none("ERRATA.md defines its level-two headings only", ERRATA_IDS.has("not-an-entry") ? ["defined"] : []);
none("a corrected market of the grid, and one only a row claims",
  errata(loc("ax3.home", { meta: { market: "mkt5" } }), bandGrid({ errata: { mkt1: "bk-p9-offset", mkt5: "bk-p9-offset" } })));
flags("an erratum ERRATA.md does not define", errata(bandGrid({ errata: { mkt1: "bk-p9-nothing" } })), /does not define/);
flags("a market nobody claims", errata(bandGrid({ errata: { mkt7: "bk-p9-offset" } })), /no row of ax3 claims it/);
flags("a market another grid bands", errata(bandGrid({ errata: { mkt9: "bk-p9-offset" } }), {
  ...bandGrid({}, "ax3.marketGrid1"), assists: { grids: { markets: { rowBands: [{ key: "mkt9" }], cols: [] } } },
}), /another grid of ax3 bands/);
flags("errata on a place", errata(loc("ax3.home", { meta: { errata: {} } })), /market grid row only/);
none("a record whose grid class is the misprint", errata(record("ax3.mkt1", { gridClassErratum: "bk-p9-offset" })));
flags("a grid-class erratum ERRATA.md does not define", errata(record("ax3.mkt1", { gridClassErratum: "bk-p9-class" })), /does not define/);
flags("a grid-class erratum on a grid", errata(bandGrid({ gridClassErratum: "bk-p9-offset" })), /market record only/);

/* --- one row's own meta: revisions and character binding --- */

none("a revision into a later book", rowMetaProblems({ id: "ax2.m1", book: "ax2", kind: "kind.monster", meta: { revisedBy: "mm.m1" } }));
flags("a revision into an earlier book", rowMetaProblems({ id: "mm.m1", book: "mm", kind: "kind.monster", meta: { revisedBy: "ax2.m1" } }), /not a later printing/);
flags("a revision between same-year books", rowMetaProblems({ id: "ax2.m1", book: "ax2", kind: "kind.monster", meta: { revisedBy: "ax6.m1" } }), /not a later printing/);
none("a person bound to a character", rowMetaProblems({ id: "ax1.npc1", book: "ax1", kind: "kind.npc", meta: { actor: "character" } }));
flags("an actor of another sort", rowMetaProblems({ id: "ax1.npc1", book: "ax1", kind: "kind.npc", meta: { actor: "monster" } }), /not an actor/);
flags("an actor on a place", rowMetaProblems({ id: "ax1.poi1", book: "ax1", kind: "kind.location", meta: { actor: "character" } }), /npc row only/);

/* --- the kinds labelled by ordinal --- */

none("a pregen", ordinalProblems({ id: "ax1.pc3", kind: "kind.pregen", name: "PC 3", anchor: { hash: "abc" } }, "ax1"));
none("a prose section", ordinalProblems({ id: "ax1.prose1", kind: "kind.prose", name: "Prose 1", anchor: { hash: "abc" } }, "ax1"));
none("an adventure item", ordinalProblems({ id: "ax1.item2", kind: "kind.adventureItem", name: "Item 2", anchor: { hash: "abc" } }, "ax1"));
none("a link", ordinalProblems({ id: "ax1.link4", kind: "kind.sceneLink", name: "Link 4" }, "ax1"));
flags("a pregen under its printed name", ordinalProblems({ id: "ax1.pc3", kind: "kind.pregen", name: "Somebody", anchor: { hash: "abc" } }, "ax1"), /named "PC <n>"/);
flags("an item under another ordinal's id", ordinalProblems({ id: "ax1.item1", kind: "kind.adventureItem", name: "Item 2", anchor: { hash: "abc" } }, "ax1"), /has the id "ax1\.item2"/);
flags("a prose section anchored by its words", ordinalProblems({ id: "ax1.prose1", kind: "kind.prose", name: "Prose 1", anchor: { display: "x" } }, "ax1"), /anchors by hash/);
flags("a link with a text anchor", ordinalProblems({ id: "ax1.link1", kind: "kind.sceneLink", name: "Link 1", anchor: { hash: "abc" } }, "ax1"), /no text anchor/);

/* --- sites: by number where keyed, else by a run-in hash under an ordinal --- */

none("a site keyed by number", siteProblems({ id: "ax3.site4", anchor: { number: "4." } }, "ax3"));
none("a site printed under a run-in title", siteProblems({ id: "ax1.site2", name: "Site 2", anchor: { hash: "abc", as: "runin" } }, "ax1"));
flags("a hash site sought among display headings", siteProblems({ id: "ax1.site2", name: "Site 2", anchor: { hash: "abc" } }, "ax1"), /as "runin"/);
flags("a site anchored by its words", siteProblems({ id: "ax1.site2", name: "Site 2", anchor: { runin: "x" } }, "ax1"), /never by its printed words/);
flags("a hash site under its printed name", siteProblems({ id: "ax1.site2", name: "Somewhere", anchor: { hash: "abc", as: "runin" } }, "ax1"), /named "Site <n>"/);
flags("a hash site under another ordinal's id", siteProblems({ id: "ax1.site3", name: "Site 2", anchor: { hash: "abc", as: "runin" } }, "ax1"), /has the id "ax1\.site2"/);

/* --- scene links --- */

const box = { x0: 1, x1: 2, y0: 1, y1: 2 };
const above = { x0: 1, x1: 2, y0: 21, y1: 22 };
const scene = (id, levels) => ({ id, book: id.split(".")[0], kind: "kind.scene", scene: levels ? { crop: { x: 0, y: 0, w: 10, h: 10 }, levels } : {} });
const scenes = rowsOf(scene("ax1.fortMap"), scene("ax1.level1Map"), scene("ax3.regionMap"), scene("ax1.fort9Map", [{ x: 0, y: 20 }]),
  loc("ax1.fort9"), { id: "ax1.link9", kind: "kind.sceneLink", name: "Link 9" });
const link = (l) => ({ id: "ax1.link1", kind: "kind.sceneLink", name: "Link 1", link: l });
none("a teleport between two books' maps", sceneLinkProblems(link({ mode: "teleport", ends: [{ scene: "ax1.fortMap", box }, { scene: "ax3.regionMap", box }], both: true }), scenes));
none("a stair between two storeys", sceneLinkProblems(link({ mode: "level", ends: [{ scene: "ax1.fort9Map", box, level: 0 }, { scene: "ax1.fort9Map", box: above, level: 1 }] }), scenes));
none("an end standing for a place", sceneLinkProblems(link({ mode: "teleport", ends: [{ scene: "ax1.fortMap", box, place: "ax1.fort9" }, { scene: "ax1.fort9Map", box: above, level: 1 }] }), scenes));
flags("an end standing for a row that is no place", sceneLinkProblems(link({ mode: "teleport", ends: [{ scene: "ax1.fortMap", box, place: "ax1.link9" }, { scene: "ax1.level1Map", box }] }), scenes), /no location row/);
flags("a stair whose storeys' boxes stand on two spots", sceneLinkProblems(link({ mode: "level", ends: [{ scene: "ax1.fort9Map", box, level: 0 }, { scene: "ax1.fort9Map", box: { ...above, x0: 3, x1: 4 }, level: 1 }] }), scenes), /coincide/);
flags("a box off its storey", sceneLinkProblems(link({ mode: "teleport", ends: [{ scene: "ax1.fort9Map", box: above }, { scene: "ax1.level1Map", box }] }), scenes), /does not lie on ax1\.fort9Map's picture/);
flags("a link with no block", sceneLinkProblems({ id: "ax1.link1" }, scenes), /needs a "link" block/);
flags("an unknown mode", sceneLinkProblems(link({ mode: "walk", ends: [{ scene: "ax1.fortMap", box }, { scene: "ax1.level1Map", box }] }), scenes), /not a way a link moves/);
flags("one end", sceneLinkProblems(link({ mode: "teleport", ends: [{ scene: "ax1.fortMap", box }] }), scenes), /two or more ends/);
flags("an end on no scene row", sceneLinkProblems(link({ mode: "teleport", ends: [{ scene: "ax1.fortMap", box }, { scene: "ax1.nowhere", box }] }), scenes), /no scene row/);
flags("an end named by a word", sceneLinkProblems(link({ mode: "teleport", ends: [{ scene: "ax1.fortMap", box }, { scene: "the cellar", box }] }), scenes), /scene row's id/);
flags("an inverted box", sceneLinkProblems(link({ mode: "teleport", ends: [{ scene: "ax1.fortMap", box: { x0: 2, x1: 1, y0: 1, y1: 2 } }, { scene: "ax1.level1Map", box }] }), scenes), /x0 < x1/);
flags("an end key the link does not know", sceneLinkProblems(link({ mode: "teleport", ends: [{ scene: "ax1.fortMap", box, label: "Stairs" }, { scene: "ax1.level1Map", box }] }), scenes), /unknown key "label"/);
flags("a level named by a word", sceneLinkProblems(link({ mode: "level", ends: [{ scene: "ax1.fort9Map", box, level: "cellar" }, { scene: "ax1.fort9Map", box, level: 1 }] }), scenes), /storey ordinal/);
flags("a level the scene does not have", sceneLinkProblems(link({ mode: "level", ends: [{ scene: "ax1.fort9Map", box, level: 0 }, { scene: "ax1.fort9Map", box, level: 2 }] }), scenes), /not a level of ax1\.fort9Map/);
flags("a level on a scene without levels", sceneLinkProblems(link({ mode: "teleport", ends: [{ scene: "ax1.fortMap", box, level: 0 }, { scene: "ax1.level1Map", box }] }), scenes), /not a level of ax1\.fortMap/);
flags("a level link across scenes", sceneLinkProblems(link({ mode: "level", ends: [{ scene: "ax1.fort9Map", box, level: 0 }, { scene: "ax1.fortMap", box }] }), scenes), /levels of one scene/);
flags("a level link onto one level", sceneLinkProblems(link({ mode: "level", ends: [{ scene: "ax1.fort9Map", box, level: 1 }, { scene: "ax1.fort9Map", box, level: 1 }] }), scenes), /different level/);
flags("a confirm that is not a flag", sceneLinkProblems(link({ mode: "teleport", confirm: "yes", ends: [{ scene: "ax1.fortMap", box }, { scene: "ax1.level1Map", box }] }), scenes), /confirm is true or false/);

/* --- a book's one region map --- */

const grid = { family: "hexCols", box: { w: 2, h: 2 }, centre: [1, 1], distance: 6, units: "mi" };
const mapRow = (id, s) => ({ id, book: id.split(".")[0], kind: "kind.scene", scene: { crop: box, ...s } });
none("one region map beside plans, quarters and another book's region map", regionMapProblems(rowsOf(
  mapRow("ax1.regionMap", { grid }), mapRow("ax1.fort19Map", { grid, place: "ax1.fort19" }), mapRow("ax1.fortMap", {}),
  mapRow("ax1.cityMap", { grid, districts: [{ place: "ax1.p1" }] }), mapRow("ax3.regionMap", { grid }))));
flags("a grid plan that names no place beside the region map", regionMapProblems(rowsOf(mapRow("ax1.regionMap", { grid }), mapRow("ax1.fort19Map", { grid }))),
  /ax1\.fort19Map: .*ax1's region map, and ax1\.regionMap already is one/);
flags("two grid plans that name no place, with no region map", regionMapProblems(rowsOf(mapRow("ax1.fort19Map", { grid }), mapRow("ax1.fort20Map", { grid }))),
  /ax1\.fort20Map: .*names the place it draws/);

console.log(`test-register-rules: all ${pass} checks passed`);
