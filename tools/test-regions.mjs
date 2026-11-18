/**
 * The Region readers: who is standing in a zone, what is drawn over a point,
 * and the outline and area of a Region, all answered by core's Region
 * documents (stood up by `region-fixture.mjs`). Pure functions; no Foundry,
 * no world.
 */
import assert from "node:assert/strict";
import { behaviorsUnder, regionArea, regionRings, regionsAt, regionsUnder } from "../scripts/lib/regions.mjs";
import { containmentPoints, mockRegion, rect, standOnRegions } from "./region-fixture.mjs";

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
};

const ZONE = "acks-extras.encounterZone";
const OTHER = "acks-extras.trapZone";
const behavior = (type = ZONE, disabled = false) => ({ type, disabled });
/** A zone over a rectangle, named by `id`, carrying the behaviors given. */
const zone = (id, ring, over = {}) => mockRegion({ id, rings: [ring], behaviors: [behavior()], ...over });
const sceneOf = (...regions) => ({ regions });
const ids = (found) => found.map(({ region }) => region.id);

/* -------------------------------------------- */
/*  regionsAt                                   */
/* -------------------------------------------- */

test("regionsAt answers every zone over the point, in the scene's order", () => {
  const big = zone("big", rect(0, 0, 400, 400));
  const small = zone("small", rect(100, 100, 100, 100));
  const away = zone("away", rect(300, 300, 50, 50));
  const found = regionsAt(sceneOf(big, small, away), { x: 150, y: 150 }, {}, ZONE);
  assert.deepEqual(ids(found), ["big", "small"]);
  assert.equal(found[0].behavior, big.behaviors[0], "the behavior is the Region's own");
});

test("regionsAt keeps only enabled behaviors of the type, answering a Region once", () => {
  const twice = mockRegion({ id: "twice", rings: [rect(0, 0, 100, 100)], behaviors: [behavior(ZONE, true), behavior(ZONE), behavior(ZONE)] });
  const trap = mockRegion({ id: "trap", rings: [rect(0, 0, 100, 100)], behaviors: [behavior(OTHER)] });
  const off = mockRegion({ id: "off", rings: [rect(0, 0, 100, 100)], behaviors: [behavior(ZONE, true)] });
  const found = regionsAt(sceneOf(twice, trap, off), { x: 50, y: 50 }, {}, ZONE);
  assert.deepEqual(ids(found), ["twice"]);
  assert.equal(found[0].behavior, twice.behaviors[1], "the first ENABLED behavior");
  assert.deepEqual(ids(regionsAt(sceneOf(twice, trap, off), { x: 50, y: 50 }, {}, OTHER)), ["trap"]);
});

test("regionsAt reads a grid shape through core's merged outline", () => {
  // A `grid` shape carries cell offsets and no points of its own: the Region's
  // polygon tree is where the cells' merged outline lives, and membership reads
  // that tree, so a cell of the picture is in the zone.
  const cells = mockRegion({
    id: "cells",
    shapes: [{ type: "grid", hole: false, offsets: [{ i: 0, j: 0 }, { i: 1, j: 0 }] }],
    rings: [rect(0, 0, 200, 100)],
    behaviors: [behavior()],
  });
  assert.deepEqual(ids(regionsAt(sceneOf(cells), { x: 150, y: 50 }, {}, ZONE)), ["cells"]);
  assert.deepEqual(ids(regionsAt(sceneOf(cells), { x: 250, y: 50 }, {}, ZONE)), []);
});

test("regionsAt honours holes and disjoint pieces", () => {
  const ring = mockRegion({
    id: "ring",
    rings: [rect(0, 0, 300, 300), rect(500, 0, 100, 100)],
    holes: [rect(100, 100, 100, 100)],
    behaviors: [behavior()],
  });
  const at = (x, y) => ids(regionsAt(sceneOf(ring), { x, y }, {}, ZONE));
  assert.deepEqual(at(50, 50), ["ring"]);
  assert.deepEqual(at(150, 150), [], "inside the hole");
  assert.deepEqual(at(550, 50), ["ring"], "the second piece");
});

test("regionsAt applies the Region's elevation range through core", () => {
  const deep = zone("deep", rect(0, 0, 100, 100), { elevation: { bottom: 0, top: 10, topInclusive: false } });
  const flat = zone("flat", rect(0, 0, 100, 100), { elevation: { bottom: 5, top: 5 } });
  const at = (elevation) => ids(regionsAt(sceneOf(deep, flat), { x: 50, y: 50 }, { elevation }, ZONE));
  assert.deepEqual(at(0), ["deep"], "the floor is inside");
  assert.deepEqual(at(5), ["deep", "flat"], "a flat Region holds its one elevation");
  assert.deepEqual(at(10), [], "the ceiling is outside unless the Region says it is inside");
  assert.deepEqual(at(-1), []);
  assert.deepEqual(ids(regionsAt(sceneOf(deep), { x: 50, y: 50 }, undefined, ZONE)), ["deep"], "elevation defaults to the ground");
  assert.deepEqual(ids(regionsAt(sceneOf(zone("closed", rect(0, 0, 100, 100), { elevation: { bottom: 0, top: 10, topInclusive: true } })), { x: 50, y: 50 }, { elevation: 10 }, ZONE)), ["closed"]);
});

test("regionsAt drops a Region on another Level, and asks no Level when none is given", () => {
  const upstairs = zone("upstairs", rect(0, 0, 100, 100), { levels: ["L2"] });
  const downstairs = zone("downstairs", rect(0, 0, 100, 100), { levels: ["L1"] });
  const everywhere = zone("everywhere", rect(0, 0, 100, 100));
  const scene = sceneOf(upstairs, downstairs, everywhere);
  const here = { x: 50, y: 50 };
  assert.deepEqual(ids(regionsAt(scene, here, { level: "L1" }, ZONE)), ["downstairs", "everywhere"]);
  assert.deepEqual(ids(regionsAt(scene, here, { level: "L2" }, ZONE)), ["upstairs", "everywhere"]);
  assert.deepEqual(ids(regionsAt(scene, here, {}, ZONE)), ["upstairs", "downstairs", "everywhere"], "core's Level test throws without a Level, so none is asked");
  assert.deepEqual(ids(regionsAt(sceneOf(everywhere), here, { level: "L9" }, ZONE)), ["everywhere"], "a Region naming no Level is on every one");
});

test("regionsAt on a scene with no Regions, or no scene, answers nothing", () => {
  assert.deepEqual(regionsAt(sceneOf(), { x: 0, y: 0 }, {}, ZONE), []);
  assert.deepEqual(regionsAt(null, { x: 0, y: 0 }, {}, ZONE), []);
});

/* -------------------------------------------- */
/*  regionsUnder                                */
/* -------------------------------------------- */

test("regionsUnder reads core's token.regions, answered in the scene's order", () => {
  const a = zone("a", rect(0, 0, 100, 100));
  const b = zone("b", rect(0, 0, 100, 100));
  const c = zone("c", rect(0, 0, 100, 100));
  const scene = sceneOf(a, b, c);
  // The Set is in order of arrival; the answer is in the scene's.
  const token = { parent: scene, regions: new Set([c, a]) };
  assert.deepEqual(ids(regionsUnder(token, ZONE)), ["a", "c"]);
});

test("regionsUnder keeps only enabled behaviors of the type", () => {
  const trap = mockRegion({ id: "trap", rings: [rect(0, 0, 10, 10)], behaviors: [behavior(OTHER)] });
  const off = mockRegion({ id: "off", rings: [rect(0, 0, 10, 10)], behaviors: [behavior(ZONE, true)] });
  const on = zone("on", rect(0, 0, 10, 10));
  const scene = sceneOf(trap, off, on);
  const token = { parent: scene, regions: new Set([trap, off, on]) };
  assert.deepEqual(ids(regionsUnder(token, ZONE)), ["on"]);
  assert.deepEqual(ids(regionsUnder(token, OTHER)), ["trap"]);
});

test("behaviorsUnder answers every enabled behavior of the type, in region then behavior order", () => {
  const twice = mockRegion({ id: "twice", rings: [rect(0, 0, 10, 10)], behaviors: [behavior(OTHER), behavior(ZONE, true), behavior(OTHER), behavior(ZONE)] });
  const once = mockRegion({ id: "once", rings: [rect(0, 0, 10, 10)], behaviors: [behavior(OTHER)] });
  const off = mockRegion({ id: "off", rings: [rect(0, 0, 10, 10)], behaviors: [behavior(OTHER, true)] });
  const away = mockRegion({ id: "away", rings: [rect(500, 0, 10, 10)], behaviors: [behavior(OTHER)] });
  const scene = sceneOf(twice, once, off, away);
  const token = { parent: scene, regions: new Set([once, off, twice]) };
  const found = behaviorsUnder(token, OTHER);
  assert.deepEqual(ids(found), ["twice", "twice", "once"], "a Region carrying two answers twice; a disabled one and one not stood in answer none");
  assert.equal(found[0].behavior, twice.behaviors[0]);
  assert.equal(found[1].behavior, twice.behaviors[2], "the Region's own behavior order");
  assert.equal(found[2].behavior, once.behaviors[0]);
  assert.deepEqual(ids(regionsUnder(token, OTHER)), ["twice", "once"], "regionsUnder keeps its once-per-Region answer");
  assert.deepEqual(behaviorsUnder({ parent: scene, regions: new Set() }, OTHER), []);
  assert.deepEqual(behaviorsUnder(null, OTHER), []);
});

test("regionsUnder does not read the geometry: membership is whatever core recorded", () => {
  // The token's corner lies outside the Region; core says it stands in it (a
  // footprint test), and that answer stands.
  const region = zone("room", rect(0, 0, 100, 100));
  const token = { parent: sceneOf(region), regions: new Set([region]), x: 500, y: 500 };
  assert.deepEqual(ids(regionsUnder(token, ZONE)), ["room"]);
});

test("a footprint holds a token a centre test misses, and the reverse of a clipped edge", () => {
  // A token of three cells on a 100 px grid spans x 0..300, y 0..100: its centre
  // is (150, 50) and core tests the middle of each cell, x 50, 150 and 250.
  const scene = sceneOf();
  scene.grid = { size: 100 };
  const token = standOnRegions({ parent: scene, x: 0, y: 0, width: 3, height: 1 });
  const last = zone("last", rect(200, 0, 100, 100));
  const edge = zone("edge", rect(280, 0, 20, 100));
  const middle = zone("middle", rect(100, 0, 100, 100));
  scene.regions = [last, edge, middle];
  assert.deepEqual(regionsAt(scene, { x: 150, y: 50 }, {}, ZONE).map(({ region }) => region.id), ["middle"], "a centre test holds the middle zone only");
  assert.deepEqual(ids(regionsUnder(token, ZONE)), ["last", "middle"], "the footprint holds the last cell's zone too, and not the sliver beside no cell's middle");
  assert.deepEqual(containmentPoints(token, 100).map((p) => p.x).sort((a, b) => a - b), [50, 150, 250], "the centre is one of the cell middles");
  // One cell or less tests the centre alone.
  const small = standOnRegions({ parent: scene, x: 0, y: 0, width: 1, height: 1 });
  assert.deepEqual(containmentPoints(small, 100), [{ x: 50, y: 50 }]);
  assert.deepEqual(ids(regionsUnder(small, ZONE)), [], "so a one-cell token at the same corner holds none of the three");
  // A square token tests every cell's middle: the centre and four more.
  const square = { parent: scene, x: 0, y: 0, width: 2, height: 2 };
  assert.equal(containmentPoints(square, 100).length, 5);
  assert.deepEqual(containmentPoints(square, 100).slice(1).map((p) => [p.x, p.y]), [[50, 50], [150, 50], [50, 150], [150, 150]]);
});

test("a token's Regions follow its stored corner, not the prepared one", () => {
  const scene = sceneOf();
  scene.grid = { size: 100 };
  const room = zone("room", rect(500, 0, 100, 100));
  scene.regions = [room];
  // Prepared x is mid-tween; the stored corner is the destination.
  const token = standOnRegions({ parent: scene, x: 100, y: 0, width: 1, height: 1, _source: { x: 500, y: 0 } });
  assert.deepEqual(ids(regionsUnder(token, ZONE)), ["room"]);
});

test("regionsUnder answers nothing for a token in no Region or on no scene", () => {
  const region = zone("room", rect(0, 0, 100, 100));
  assert.deepEqual(regionsUnder({ parent: sceneOf(region), regions: new Set() }, ZONE), []);
  assert.deepEqual(regionsUnder({ parent: null, regions: new Set([region]) }, ZONE), []);
  assert.deepEqual(regionsUnder(null, ZONE), []);
});

/* -------------------------------------------- */
/*  regionRings, regionArea                     */
/* -------------------------------------------- */

test("regionRings is the solid nodes of core's polygon tree", () => {
  const region = mockRegion({
    rings: [rect(0, 0, 300, 200), rect(500, 0, 100, 100)],
    holes: [rect(100, 50, 100, 100)],
  });
  assert.deepEqual(regionRings(region), [rect(0, 0, 300, 200), rect(500, 0, 100, 100)]);
});

test("regionRings returns copies, drops degenerate nodes, and tolerates no geometry", () => {
  const ring = rect(0, 0, 10, 10);
  const region = mockRegion({ rings: [ring, [0, 0, 5, 5]] });
  const [out] = regionRings(region);
  assert.deepEqual(out, ring);
  assert.notEqual(out, ring, "a caller cannot mutate core's points");
  assert.equal(regionRings(region).length, 1, "a two-point node is no ring");
  assert.deepEqual(regionRings(mockRegion()), []);
  assert.deepEqual(regionRings({}), []);
  assert.deepEqual(regionRings(null), []);
});

test("regionArea is core's, holes taken out", () => {
  assert.equal(regionArea(mockRegion({ rings: [rect(0, 0, 300, 200)] })), 60000);
  assert.equal(regionArea(mockRegion({ rings: [rect(0, 0, 300, 200)], holes: [rect(100, 50, 100, 100)] })), 50000);
  assert.equal(regionArea(mockRegion()), 0);
  assert.equal(regionArea(null), 0);
});

console.log(`test-regions: OK (${passed} checks — zones over a point, grid shapes, holes, elevation, Levels, a token's Regions, outlines, area)`);
