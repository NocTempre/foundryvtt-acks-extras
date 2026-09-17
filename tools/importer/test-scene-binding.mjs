/**
 * A printed map stands up as a scene from GEOMETRY alone.
 *
 * What this guards is arithmetic a Judge would otherwise meet as a wrong map:
 * a quarter turn that mirrors instead of turning puts every place across the
 * city from where it is drawn; a place that maps a pixel outside its quarter
 * is priced as the neighbour's; two quarters whose shared border stops sharing
 * its corners stop being adjacent. None of it shows in a green compile.
 *
 * The recipe checks are walked over an invented book, so a defect is named by
 * its own sentence and no printed page is needed. The foot of the file reads
 * the shipped AX3 recipe: it must hold over the entries compiled beside it,
 * every place must stand in its own quarter once carried into scene pixels,
 * and every quarter must still touch a neighbour corner to corner.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  SCENE_KIND, PLACE_TOKEN_SIZE, isSceneRecipe, sceneFrame, ringToScene, pointInRing, bandOfSection, formulaMax,
  afterDarkShift, placementMatches, placementHolding, recipeContext, recipeProblems, sceneData, districtRegionData,
  placeTokenAt, worldCopySource, turnMatrix, pictureKey,
} from "../../scripts/importer/scene-binding.mjs";
import { MODULE_ID } from "../../scripts/importer/constants.mjs";

let failed = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    console.error(`FAIL ${name}\n  got:  ${g}\n  want: ${w}`);
    failed++;
  }
};
const ok = (name, cond, detail = "") => {
  if (!cond) {
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
};

/* ---------------- the frame ---------------- */

const base = { crop: { x: 10, y: 20, w: 100, h: 50 }, feetPerPoint: 2 };
const corners = { topLeft: [10, 20], topRight: [110, 20], bottomRight: [110, 70], bottomLeft: [10, 70] };
const carried = (turn) => {
  const f = sceneFrame({ ...base, turn });
  return Object.fromEntries(Object.entries(corners).map(([k, [x, y]]) => [k, f.toScene(x, y)]));
};

const upright = sceneFrame({ ...base, turn: 0 });
check("an unturned picture is the crop at scale", [upright.width, upright.height, upright.scale], [200, 100, 2]);
check("unturned corners stay where they are", carried(0), { topLeft: [0, 0], topRight: [200, 0], bottomRight: [200, 100], bottomLeft: [0, 100] });

const quarter = sceneFrame({ ...base, turn: 1 });
check("a quarter turn swaps the sides", [quarter.width, quarter.height], [100, 200]);
check("the cut is still the unturned crop", quarter.cut, { w: 200, h: 100 });
check("one turn counter-clockwise carries the top-right corner to the top-left", carried(1), {
  topLeft: [0, 200], topRight: [0, 0], bottomRight: [100, 0], bottomLeft: [100, 200],
});
check("two turns stand it on its head", carried(2), { topLeft: [200, 100], topRight: [0, 100], bottomRight: [0, 0], bottomLeft: [200, 0] });
check("three turns is one clockwise", carried(3), { topLeft: [100, 0], topRight: [100, 200], bottomRight: [0, 200], bottomLeft: [0, 0] });
check("a turn past the fourth wraps", carried(5), carried(1));
check("a turn backwards is three forwards", carried(-1), carried(3));

// A turn must TURN: a mirror keeps every corner on the picture too, and only
// the handedness of three points tells the two apart.
const handed = (pts) => Math.sign((pts[1][0] - pts[0][0]) * (pts[2][1] - pts[0][1]) - (pts[1][1] - pts[0][1]) * (pts[2][0] - pts[0][0]));
for (const turn of [0, 1, 2, 3]) {
  const c = carried(turn);
  check(`turn ${turn} keeps the map's handedness`, handed([c.topLeft, c.topRight, c.bottomRight]), 1);
}

const scaled = sceneFrame({ ...base, turn: 0 }, { pixelsPerFoot: 0.5 });
check("fewer pixels to the foot draws a smaller picture", [scaled.width, scaled.height, scaled.toScene(110, 70)], [100, 50, [100, 50]]);
check("a ring is carried point by point, to whole pixels", ringToScene([10, 20, 60.3, 20, 60.3, 45.2], upright), [0, 0, 101, 0, 101, 50]);

/* ---------------- a point inside a ring ---------------- */

const square = [0, 0, 10, 0, 10, 10, 0, 10];
ok("the middle is inside", pointInRing(5, 5, square));
ok("beside it is outside", !pointInRing(15, 5, square));
const notch = [0, 0, 10, 0, 10, 10, 5, 5, 0, 10];
ok("a notch is outside the ring that has it", !pointInRing(5, 8, notch));
ok("an empty ring holds nothing", !pointInRing(1, 1, []));

/* ---------------- a list's band and what it adds after dark ---------------- */

check("a band is read off the row section that names it", bandOfSection("r89-100"), { from: 89, to: 100 });
check("a padded single row is a band of one", bandOfSection("r07"), { from: 7, to: 7 });
check("zero is no row", bandOfSection("r0"), null);
check("a band that runs backwards is none", bandOfSection("r10-5"), null);
check("a word is no band", bandOfSection("rows"), null);

check("a plain throw tops out at its faces", formulaMax("1d100"), 100);
check("dice and an addition", formulaMax("2d6+1"), 13);
check("a bare die is one die", formulaMax("d20"), 20);
check("a subtraction lowers the top", formulaMax("1d8-1"), 7);
check("anything else is not a plain throw", formulaMax("1d6x10"), null);

check("a list that runs past its die says how far", afterDarkShift([[1, 4], [127, 130]], "1d100"), 30);
check("a list its die covers adds nothing", afterDarkShift([[1, 50], [51, 100]], "1d100"), 0);
check("an unreadable formula adds nothing", afterDarkShift([[1, 130]], "see text"), 0);
check("no rows adds nothing", afterDarkShift([], "1d100"), 0);

/* ---------------- the anchor ---------------- */

const onPage = [{ x: 40, y: 40, w: 20, h: 20 }, { x: -1.2, y: 11.9, w: 579.9, h: 758.3 }, { x: -1.2, y: 11.9, w: 579.9, h: 758.3 }];
check("the image a crop is cut from is the smallest one that holds it", placementHolding(onPage, { x: 0, y: 75, w: 578, h: 695 }), { x: -1.2, y: 11.9, w: 579.9, h: 758.3 });
check("a crop no image holds has no anchor", placementHolding(onPage, { x: 0, y: 0, w: 600, h: 800 }), null);
check("a hair outside still counts as held", placementHolding([{ x: 0.3, y: 0, w: 100, h: 100 }], { x: 0, y: 0, w: 100, h: 100 }), { x: 0.3, y: 0, w: 100, h: 100 });
ok("the same page answers to its anchor", placementMatches(onPage, { x: -1.22, y: 11.9, w: 579.88, h: 758.29 }));
ok("a printing that lays the map out elsewhere does not", !placementMatches(onPage, { x: 20, y: 11.9, w: 579.88, h: 758.29 }));
ok("no anchor matches nothing", !placementMatches(onPage, null));
ok("a page with no images matches nothing", !placementMatches([], { x: 0, y: 0, w: 1, h: 1 }));

/* ---------------- the recipe checks, over an invented book ---------------- */

const book = {
  "zz.northOverview": { kind: "kind.location", meta: { group: "North Quarter — Overview" } },
  "zz.southOverview": { kind: "kind.location", meta: { group: "South Quarter — Overview" } },
  "zz.well": { kind: "kind.location", meta: { group: "North Quarter — Points of Interest" } },
  "zz.mill": { kind: "kind.location", meta: { group: "South Quarter — Points of Interest" } },
  "zz.den": { kind: "kind.location", meta: { group: "South Quarter — Den" } },
  "zz.streets": { kind: "kind.rolltable", meta: {}, fields: { rows: { paras: [{ section: "r01-50" }, { section: "r51-100" }] } } },
  "zz.northList": { kind: "kind.rolltable", meta: {}, fields: { rows: { paras: [{ section: "r1" }] } } },
};
const known = recipeContext(book);
check("a list's sections are read off its rows", known["zz.streets"].sections, ["r01-50", "r51-100"]);
check("a place carries no sections", known["zz.well"].sections, undefined);

const sound = () => ({
  crop: { x: 0, y: 0, w: 100, h: 100 },
  turn: 1,
  feetPerPoint: 4,
  blockFeet: 120,
  incidents: { table: "zz.streets", band: "r51-100" },
  districts: [
    { place: "zz.northOverview", color: "#aabbcc", special: "zz.northList", outline: [0, 0, 100, 0, 100, 50, 0, 50] },
    { place: "zz.southOverview", color: "#112233", outline: [0, 50, 100, 50, 100, 100, 0, 100] },
  ],
  places: [{ id: "zz.well", at: [20, 20] }, { id: "zz.mill", at: [20, 80] }],
});
check("a sound recipe has nothing wrong with it", recipeProblems(sound(), known), []);

const broken = (change) => {
  const r = sound();
  change(r);
  return recipeProblems(r, known);
};
const says = (name, problems, fragment) => ok(name, problems.length === 1 && problems[0].includes(fragment), JSON.stringify(problems));

says("a crop with no width", broken((r) => { r.crop.w = 0; }), "crop needs");
says("a scale of nothing", broken((r) => { r.feetPerPoint = 0; }), "feetPerPoint");
says("a turn that is no quarter", broken((r) => { r.turn = 1.5; }), "turn must be");
says("a block of nothing", broken((r) => { r.blockFeet = -1; }), "blockFeet");
says("a list that is a place", broken((r) => { r.incidents.table = "zz.well"; }), "is not a roll table");
says("a band that is no range", broken((r) => { r.incidents.band = "late"; }), "names no range");
says("a band the list has no row for", broken((r) => { r.incidents.band = "r90-100"; }), "is not a row of zz.streets");
says("a quarter named by a keyed place", broken((r) => { r.districts[0].place = "zz.well"; r.places.shift(); }), "is not a quarter's overview entry");
ok("a quarter drawn twice", broken((r) => { r.districts[1].place = "zz.northOverview"; }).some((p) => p.includes("repeats a quarter")));
says("a quarter's list that is a place", broken((r) => { r.districts[0].special = "zz.mill"; }), "is not a roll table");
says("a colour that is a word", broken((r) => { r.districts[0].color = "red"; }), "#rrggbb");
ok("an outline of two points", broken((r) => { r.districts[0].outline = [0, 0, 10, 10]; }).some((p) => p.includes("at least three")));
says("an outline that leaves the picture", broken((r) => { r.districts[1].outline = [0, 50, 100, 50, 100, 120, 0, 100]; }), "leaves the crop");
says("a place that is an overview", broken((r) => { r.places[0].id = "zz.northOverview"; }), "is not a keyed place");
says("a place from another kind of group", broken((r) => { r.places[0].id = "zz.den"; }), "is not a keyed place");
says("a place this book does not hold", broken((r) => { r.places[0].id = "zz.gone"; }), "is not a keyed place");
says("a place set down twice", broken((r) => { r.places.push({ id: "zz.well", at: [30, 30] }); }), "placed twice");
says("a place with half a position", broken((r) => { r.places[0].at = [20]; }), "must be [x, y]");
says("a place off the picture", broken((r) => { r.places[0].at = [20, 140]; }), "outside the crop");
says("a place drawn over its neighbour", broken((r) => { r.places[0].at = [20, 70]; }), "belongs to North Quarter and stands in South Quarter");
ok("a place in the gap between quarters", broken((r) => { r.districts[1].outline = [0, 60, 100, 60, 100, 100, 0, 100]; r.places[0].at = [20, 55]; }).some((p) => p.includes("no quarter")));
check("a recipe with no list and no places is still a map", recipeProblems({ crop: { x: 0, y: 0, w: 10, h: 10 }, feetPerPoint: 1 }, known), []);

ok("a compiled row with a crop is a recipe", isSceneRecipe({ kind: SCENE_KIND, scene: sound() }));
ok("a row of another kind is not", !isSceneRecipe({ kind: "kind.location", scene: sound() }));
ok("a scene row with no crop is not", !isSceneRecipe({ kind: SCENE_KIND, scene: {} }));

/* ---------------- what is written ---------------- */

const data = sceneData({
  id: "zz.map", book: "zz", name: "Map", recipe: sound(), src: "art/zz-map.webp",
  incidents: { tableUuid: "RollTable.abc", afterDark: 30, band: { from: 51, to: 100 } }, folderId: "f1",
  locationUuid: "Actor.city", level: { id: "lvl0", name: "Ground" },
  regions: [{ name: "North" }], tokens: [{ name: "Well", x: 1, y: 2 }, { name: "Mill", x: 3, y: 4, level: "stale" }],
});
check("a pixel is a foot, so the picture is the crop in feet, turned", [data.width, data.height, data.padding], [400, 400, 0]);
check("the grid is gridless at a hundred feet to the cell", data.grid, { type: 0, size: 100, distance: 100, units: "ft" });
check("a plan is read, not seen from", [data.tokenVision, data.fog], [false, { mode: 0 }]);
check("it is filed, and stays out of the navigation bar until the Judge puts it there", [data.folder, data.navigation], ["f1", false]);
check("the picture is the scene's first level, spelled out", [data.levels, data.initialLevel], [[{ _id: "lvl0", name: "Ground", background: { src: "art/zz-map.webp", color: "#ffffff" } }], "lvl0"]);
ok("and never the top-level background core strips before it reads it", !("background" in data) && !("backgroundColor" in data));
check("the map says it is not the active scene, so core does not make it one", data.active, false);
check("the quarters ride in the same create", data.regions, [{ name: "North" }]);
check("and so do the places, each put on the level the picture is on", data.tokens, [{ name: "Well", x: 1, y: 2, level: "lvl0" }, { name: "Mill", x: 3, y: 4, level: "lvl0" }]);
check("the map is linked to its place from its first write", data.flags[MODULE_ID].location, "Actor.city");
check("the scene answers to its recipe", data.flags[MODULE_ID].cookbook, { id: "zz.map", book: "zz", kind: SCENE_KIND });
check("the settlement figures ride the battlemap flag", data.flags[MODULE_ID].battlemap, {
  calibrated: true, distance: 100, autoScale: false, mapSystem: "settlement", blockFeet: 120,
  incidents: { tableUuid: "RollTable.abc", afterDark: 30, bandFrom: 51, bandTo: 100 },
});
const bare = sceneData({ id: "zz.map", book: "zz", name: "Map", recipe: { ...sound(), blockFeet: undefined }, src: "a.webp" });
ok("a map with no place of its own carries no link", !("location" in bare.flags[MODULE_ID]));
check("and core's own first level when it is told no other", [bare.levels[0]._id, bare.initialLevel, bare.regions, bare.tokens], ["defaultLevel0000", "defaultLevel0000", [], []]);
check("a world without the list gets a map with no list on it", Object.keys(bare.flags[MODULE_ID].battlemap), ["calibrated", "distance", "autoScale", "mapSystem", "blockFeet"]);
check("and no block it was not given", bare.flags[MODULE_ID].battlemap.blockFeet, null);
const unshifted = sceneData({ id: "zz.map", book: "zz", name: "Map", recipe: sound(), src: "a.webp", incidents: { tableUuid: "RollTable.abc", afterDark: 0, band: null } });
check("a list with no addition and no band says so with nulls", unshifted.flags[MODULE_ID].battlemap.incidents, { tableUuid: "RollTable.abc", afterDark: null, bandFrom: null, bandTo: null });

const frame = sceneFrame(sound());
const region = districtRegionData(sound().districts[0], frame, { name: "North", districtType: "acks-extras.district", specialTableUuid: "RollTable.n" });
check("a quarter is one locked polygon everyone can see", [region.name, region.color, region.visibility, region.locked, region.shapes.length, region.shapes[0].type, region.shapes[0].hole], ["North", "#aabbcc", 2, true, 1, "polygon", false]);
check("its outline is turned with the picture", region.shapes[0].points, [0, 400, 0, 0, 200, 0, 200, 400]);
check("it carries the District behaviour and the quarter's own list", region.behaviors, [{ type: "acks-extras.district", name: "North", system: { specialTableUuid: "RollTable.n" } }]);
check("and remembers which quarter it is", region.flags[MODULE_ID], { cookbook: { place: "zz.northOverview" } });
const linked = districtRegionData(sound().districts[0], frame, { name: "North", districtType: "acks-extras.district", locationUuid: "Actor.north" });
check("a quarter whose place the world holds is linked to it from its first write", linked.flags[MODULE_ID], { cookbook: { place: "zz.northOverview" }, location: "Actor.north" });
const plain = districtRegionData({ place: "zz.southOverview", outline: [0, 50, 100, 50, 100, 100] }, frame, { name: "South", districtType: "acks-extras.district" });
check("a quarter with no list of its own carries an empty behaviour", plain.behaviors[0].system, {});
ok("and no colour it was not given", !("color" in plain));

const token = placeTokenAt([20, 20], frame);
check("a place's token is set down by its corner so its middle is the point", token, { x: 80 - 25, y: 320 - 25, width: PLACE_TOKEN_SIZE, height: PLACE_TOKEN_SIZE });

/* ---------------- a library document made again in the world ---------------- */

const A = "AAAAAAAAAAAAAAAA";
const B = "BBBBBBBBBBBBBBBB";
const C = "CCCCCCCCCCCCCCCC";
const W = "WWWWWWWWWWWWWWWW";
const lib = (id) => `Compendium.world.lib-places.Actor.${id}`;
// A keeps its id on the way across; the world already held its own B, as W.
const worldIds = new Map([[A, A], [B, W]]);
const library = {
  _id: C,
  name: "Seated",
  folder: "packFolder",
  ownership: { default: 3, someGm: 3 },
  flags: { [MODULE_ID]: { cookbook: { id: "zz.faction.one" } }, other: { kept: 1 } },
  system: {
    parentUuid: lib(A),
    seatUuid: lib(C),
    holdings: [{ uuid: lib(B), name: "held" }, { uuid: lib(C), name: "left" }],
    relations: [{ uuid: lib(A), stance: "rival" }],
    members: [{ uuid: lib(C) }],
  },
};
const before = JSON.stringify(library);
const copy = worldCopySource(library, worldIds, { folderId: "f9", sourceUuid: lib(C) });
check("the library's own source is not touched", JSON.stringify(library), before);
check("the copy keeps the id it had", copy._id, C);
check("a reference to something coming across is rewritten to the world's form", copy.system.parentUuid, `Actor.${A}`);
check("a reference to something staying behind is left alone", copy.system.seatUuid, lib(C));
check("a reference to a place the world already held follows the world's id", copy.system.holdings, [{ uuid: `Actor.${W}`, name: "held" }, { uuid: lib(C), name: "left" }]);
check("relations too", copy.system.relations, [{ uuid: `Actor.${A}`, stance: "rival" }]);
check("a roster is not touched", copy.system.members, [{ uuid: lib(C) }]);
check("the copy is filed, marked as a copy, and keeps its cookbook identity", [copy.folder, copy.flags[MODULE_ID]], ["f9", { cookbook: { id: "zz.faction.one" }, worldCopy: true }]);
check("another module's flags ride along", copy.flags.other, { kept: 1 });
check("it says what it is a copy of", copy._stats, { compendiumSource: lib(C) });
check("a copy is owned by nobody, whatever the library's document said", copy.ownership, { default: 0 });
const bareCopy = worldCopySource({ system: {} }, worldIds);
check("a document with nothing to rewrite is only filed, owned by nobody and marked", bareCopy, { system: {}, folder: null, ownership: { default: 0 }, flags: { [MODULE_ID]: { worldCopy: true } } });
check("a world reference is never touched", worldCopySource({ system: { parentUuid: `Actor.${C}` } }, worldIds).system.parentUuid, `Actor.${C}`);

/* ---------------- the picture and the geometry turn by one rule ---------------- */

// The renderer draws the cut picture through `turnMatrix`; everything else is
// set down through `toScene`. The two must send every point to the same place.
const through = ([ma, mb, mc, md, me, mf], u, v) => [ma * u + mc * v + me, mb * u + md * v + mf];
for (const turn of [0, 1, 2, 3]) {
  const f = sceneFrame({ ...base, turn });
  const disagree = Object.values(corners).concat([[37, 41]]).filter(([x, y]) => {
    const cut = [(x - base.crop.x) * f.scale, (y - base.crop.y) * f.scale];
    return JSON.stringify(through(turnMatrix(f), cut[0], cut[1])) !== JSON.stringify(f.toScene(x, y));
  });
  check(`turn ${turn}: the picture's transform agrees with the geometry's`, disagree, []);
}

const keyed = pictureKey({ page: 9, crop: base.crop, turn: 1, feetPerPoint: 2 });
ok("a picture key is short and safe in a file name", /^[a-z0-9]{1,8}$/.test(keyed), keyed);
check("the same picture has the same key", pictureKey({ page: 9, crop: { ...base.crop }, turn: 5, feetPerPoint: 2, places: [1] }), keyed);
const changed = [
  { page: 10, crop: base.crop, turn: 1, feetPerPoint: 2 },
  { page: 9, crop: { ...base.crop, w: 101 }, turn: 1, feetPerPoint: 2 },
  { page: 9, crop: base.crop, turn: 2, feetPerPoint: 2 },
  { page: 9, crop: base.crop, turn: 1, feetPerPoint: 2.5 },
].filter((r) => pictureKey(r) === keyed);
check("a changed page, crop, turn or scale is another picture", changed, []);

/* ---------------- the shipped recipe ---------------- */

const HERE = dirname(fileURLToPath(import.meta.url));
const cb = JSON.parse(readFileSync(join(HERE, "..", "..", "cookbook", "ax3.json"), "utf8"));
const scenes = Object.entries(cb.scenes ?? {});
ok("AX3 ships a city map", scenes.length >= 1);
for (const [id, row] of scenes) {
  const recipe = row.scene;
  ok(`${id} is a recipe a seat can build`, isSceneRecipe(row));
  check(`${id} holds over the entries compiled beside it`, recipeProblems(recipe, recipeContext(cb.entries)), []);
  ok(`${id} carries its anchor and no authoring note`, !!recipe.placement && recipe.note === undefined);
  check(`${id}'s crop is cut from its own anchor`, placementHolding([recipe.placement], recipe.crop), recipe.placement);
  ok(`${id} names no entry id of its own`, !cb.entries[id]);

  // Carried into scene pixels and rounded, the geometry must still say what
  // it said in points: rounding is where a place slips across a border.
  const f = sceneFrame(recipe);
  const rings = recipe.districts.map((d) => ({ place: d.place, ring: ringToScene(d.outline, f) }));
  const stray = [];
  for (const p of recipe.places) {
    const [x, y] = f.toScene(p.at[0], p.at[1]);
    if (x < 0 || y < 0 || x > f.width || y > f.height) stray.push(`${p.id} off the picture`);
    const quarterOf = (eid) => cb.entries[eid]?.meta?.group?.split(" — ")[0];
    const under = rings.filter((r) => pointInRing(x, y, r.ring)).map((r) => quarterOf(r.place));
    if (under.length !== 1 || under[0] !== quarterOf(p.id)) stray.push(`${p.id} under ${under.join("+") || "nothing"}`);
  }
  check(`${id}: every place stands in its own quarter in scene pixels`, stray, []);

  // Two quarters are adjacent at the table when a corner of one lies on the
  // other's edge, so borders that share corners EXACTLY are adjacent whatever
  // the tolerance. Every quarter must touch at least one other that way.
  const key = (ring, i) => `${ring[i]},${ring[i + 1]}`;
  const cornerSets = rings.map((r) => new Set(Array.from({ length: r.ring.length / 2 }, (_, i) => key(r.ring, i * 2))));
  const alone = rings.filter((r, i) => !cornerSets.some((other, j) => j !== i && [...cornerSets[i]].some((c) => other.has(c)))).map((r) => r.place);
  check(`${id}: every quarter shares a corner with a neighbour`, alone, []);
  ok(`${id}: the picture is a city's size in feet`, f.width > 1000 && f.height > 1000 && f.width < 8000 && f.height < 8000, `${f.width}x${f.height}`);
}

if (failed) {
  console.error(`\nscene-binding: ${failed} failure(s)`);
  process.exit(1);
}
console.error("scene-binding: OK");
