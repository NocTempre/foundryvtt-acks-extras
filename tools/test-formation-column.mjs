/**
 * The marching column: where each body stands along the ground the party token
 * walked (`formation/column.mjs`), the trail that records that ground, and the
 * column's lights.
 *
 * Pure geometry over invented parties on a 100-px grid. Every light figure here
 * is invented and registered for the test; none is read off a page.
 */
import assert from "node:assert/strict";

// The smallest world the model reaches for: an actor directory, so a member
// counts as the one body it is and a group as its headcount.
globalThis.game = { actors: new Map(), scenes: new Map(), settings: { get: () => undefined } };

const { HEADINGS, formationOffset } = await import("../scripts/formation/formation-model.mjs");
const column = await import("../scripts/formation/column.mjs");
const { columnCells, memberCells, extendTrail, nextTrail, pathCells, trailBound, trailDecision, usableTrail, cellUnder, stepCells } = column;
const { columnLights } = await import("../scripts/formation/column-light-logic.mjs");
const tables = await import("../scripts/lib/tables.mjs");
const { LIGHT_DOC, LIGHT_TABLE } = await import("../scripts/lib/light.mjs");

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

const GS = 100;
/** A formation of `count` plain members at the given frontage. */
const party = (count, frontage) => ({
  frontage,
  members: Array.from({ length: count }, (_, i) => ({ actorId: `a${i}`, roles: [] })),
});
/** A cell `cx`,`cy` cells from the origin. */
const at = (cx, cy) => ({ x: cx * GS, y: cy * GS });

/* -------------------------------------------- */
/*  A straight column                           */
/* -------------------------------------------- */

for (const heading of Object.keys(HEADINGS)) {
  test(`a column that has walked nowhere is formationOffset, facing ${heading}`, () => {
    const f = party(7, 3);
    const anchor = at(10, 10);
    const cells = columnCells(f, { anchor, heading, gs: GS });
    assert.equal(cells.length, 7);
    cells.forEach((cell, i) => {
      const { dx, dy } = formationOffset(f, i, heading);
      assert.deepEqual(cell, { x: anchor.x + dx * GS, y: anchor.y + dy * GS }, `body ${i}`);
    });
  });
}

test("a straight trail behind the head gives the same column as no trail", () => {
  const f = party(6, 2);
  // Walked south three cells: newest first.
  const trail = [at(5, 8), at(5, 7), at(5, 6), at(5, 5)];
  const walked = columnCells(f, { anchor: at(5, 8), trail, heading: "south", gs: GS });
  const still = columnCells(f, { anchor: at(5, 8), heading: "south", gs: GS });
  assert.deepEqual(walked, still);
});

/* -------------------------------------------- */
/*  Around a corner                             */
/* -------------------------------------------- */

test("around an L-bend every rank stands on a walked cell", () => {
  const f = party(4, 1);
  // Walked east along y=5 to x=7, then south down to y=7.
  const trail = [at(7, 7), at(7, 6), at(7, 5), at(6, 5), at(5, 5)];
  const cells = columnCells(f, { anchor: at(7, 7), trail, heading: "south", gs: GS });
  assert.deepEqual(cells, [at(7, 7), at(7, 6), at(7, 5), at(6, 5)]);
});

test("files stand on the local right hand of the way each rank walks", () => {
  const f = party(6, 2);
  // Walking south at the head (right is west, -x), walked east before the turn
  // (right is south, +y).
  const trail = [at(7, 7), at(7, 6), at(7, 5), at(6, 5)];
  const cells = columnCells(f, { anchor: at(7, 7), trail, heading: "south", gs: GS });
  assert.deepEqual(cells[1], at(6, 7), "rank 0's second file is west of the head");
  assert.deepEqual(cells[5], at(7, 6), "rank 2, walked east, puts its second file to the south");
});

test("past the trail's end the column runs on away from the oldest step", () => {
  const f = party(4, 1);
  // Two cells walked east: the tail continues west of the oldest cell.
  const trail = [at(6, 5), at(5, 5)];
  const cells = columnCells(f, { anchor: at(6, 5), trail, heading: "north", gs: GS });
  assert.deepEqual(cells, [at(6, 5), at(5, 5), at(4, 5), at(3, 5)]);
});

test("a cell off the scene is shut like a wall: the column turns along the edge", () => {
  const f = party(3, 1);
  const bounds = { minX: 0, minY: 0, maxX: 900, maxY: 900 };
  const cells = columnCells(f, { anchor: at(0, 1), heading: "south", gs: GS, bounds });
  assert.deepEqual(cells, [at(0, 1), at(0, 0), at(1, 0)]);
});

/* -------------------------------------------- */
/*  Walls                                       */
/* -------------------------------------------- */

/** A wall along the grid line x = `cx` cells, the whole height of the test map. */
const wallX = (cx, extra = {}) => ({ c: [cx * GS, 0, cx * GS, 30 * GS], move: 20, ...extra });
/** A wall along the grid line y = `cy` cells, the whole width of the test map. */
const wallY = (cy, extra = {}) => ({ c: [0, cy * GS, 30 * GS, cy * GS], move: 20, ...extra });
/** The column's wall test over `walls`, read around cell `cx`,`cy`. */
const walled = (walls, cx = 5, cy = 5, level = null) => column.wallTest(walls, { level, gs: GS, near: column.cellCentre(at(cx, cy), GS), reach: 20 * GS });

test("a wall on the right hand sends the files to the left", () => {
  const f = party(4, 2);
  // Facing north, the right hand is east; the wall stands on the line east of column 5.
  const cells = columnCells(f, { anchor: at(5, 5), heading: "north", gs: GS, blocked: walled([wallX(6)]) });
  assert.deepEqual(cells, [at(5, 5), at(4, 5), at(5, 6), at(4, 6)]);
});

test("a passage one cell wide runs the party single file, deeper by the files it lost", () => {
  const f = party(4, 4);
  const cells = columnCells(f, { anchor: at(5, 5), heading: "north", gs: GS, blocked: walled([wallX(5), wallX(6)]) });
  assert.deepEqual(cells, [at(5, 5), at(5, 6), at(5, 7), at(5, 8)]);
});

test("sixteen four abreast, the head against a wall on its right hand, all stand on its side", () => {
  const f = party(16, 4);
  const blocked = walled([wallX(6)]);
  const cells = columnCells(f, { anchor: at(5, 5), heading: "north", gs: GS, blocked });
  assert.equal(cells.length, 16);
  assert.ok(cells.every((c) => c.x < 6 * GS), "no body east of the wall");
});

test("an open door lets the files through, and a shut one does not", () => {
  const f = party(2, 2);
  const open = columnCells(f, { anchor: at(5, 5), heading: "north", gs: GS, blocked: walled([wallX(6, { door: 1, ds: 1 })]) });
  assert.deepEqual(open, [at(5, 5), at(6, 5)]);
  for (const ds of [0, 2]) {
    const shut = columnCells(f, { anchor: at(5, 5), heading: "north", gs: GS, blocked: walled([wallX(6, { door: 1, ds })]) });
    assert.deepEqual(shut, [at(5, 5), at(4, 5)], `door state ${ds}`);
  }
});

test("a one-way wall stops only a step from its shut side", () => {
  const f = party(2, 2);
  // Seen from the head's centre west of it, the line x=6 drawn top to bottom
  // has the head on its left (core's orientation).
  const fromLeftPasses = columnCells(f, { anchor: at(5, 5), heading: "north", gs: GS, blocked: walled([wallX(6, { dir: 1 })]) });
  assert.deepEqual(fromLeftPasses, [at(5, 5), at(6, 5)]);
  const fromLeftShut = columnCells(f, { anchor: at(5, 5), heading: "north", gs: GS, blocked: walled([wallX(6, { dir: 2 })]) });
  assert.deepEqual(fromLeftShut, [at(5, 5), at(4, 5)]);
});

test("a wall standing on another level does not stop the column; one on every level does", () => {
  const f = party(2, 2);
  const other = columnCells(f, { anchor: at(5, 5), heading: "north", gs: GS, blocked: walled([wallX(6, { levels: ["upper"] })], 5, 5, "ground") });
  assert.deepEqual(other, [at(5, 5), at(6, 5)]);
  const every = columnCells(f, { anchor: at(5, 5), heading: "north", gs: GS, blocked: walled([wallX(6, { levels: [] })], 5, 5, "ground") });
  assert.deepEqual(every, [at(5, 5), at(4, 5)]);
});

test("a wall that stops nothing, or one out of reach, gives no wall test", () => {
  assert.equal(walled([wallX(6, { move: 0 })]), null, "movement passes it");
  assert.equal(column.wallTest([{ c: [9000, 9000, 9100, 9000], move: 20 }], { gs: GS, near: { x: 550, y: 550 }, reach: 500 }), null);
});

test("with its way back shut, the column turns a quarter, right hand first", () => {
  const f = party(3, 1);
  // Facing north, the column runs south behind the head; the wall under row 5 shuts it.
  const cells = columnCells(f, { anchor: at(5, 5), heading: "north", gs: GS, blocked: walled([wallY(6)]) });
  assert.deepEqual(cells, [at(5, 5), at(4, 5), at(3, 5)]);
});

test("boxed in, the ranks left stand on the last cell reached", () => {
  const f = party(3, 1);
  const box = [wallX(5), wallX(6), wallY(5), wallY(6)];
  const cells = columnCells(f, { anchor: at(5, 5), heading: "north", gs: GS, blocked: walled(box) });
  assert.deepEqual(cells, [at(5, 5), at(5, 5), at(5, 5)]);
});

test("a step whose start lies on a wall's line is not stopped by it", () => {
  const walls = column.movementWalls([wallX(5)]);
  assert.equal(column.stepCrosses(walls, { x: 500, y: 550 }, { x: 450, y: 550 }), false);
  assert.equal(column.stepCrosses(walls, { x: 550, y: 550 }, { x: 450, y: 550 }), true);
});

/* -------------------------------------------- */
/*  Stacks                                      */
/* -------------------------------------------- */

test("a stack fills a body per head, and the member after it starts after its last", () => {
  globalThis.game.actors = new Map([["g", { id: "g", type: "acks-extras.group", system: { stacks: [{ size: { current: 3 } }] } }]]);
  try {
    const f = { frontage: 2, members: [{ actorId: "a" }, { actorId: "g" }, { actorId: "b" }] };
    const cells = columnCells(f, { anchor: at(5, 5), heading: "north", gs: GS });
    assert.equal(cells.length, 5);
    const byMember = memberCells(f, cells);
    assert.deepEqual(byMember.map((c) => c.length), [1, 3, 1]);
    assert.deepEqual(byMember[2][0], cells[4]);
  } finally {
    globalThis.game.actors = new Map();
  }
});

/* -------------------------------------------- */
/*  The trail                                   */
/* -------------------------------------------- */

test("a trail keeps one cell per body, as deep as a column squeezed to single file, and one more", () => {
  const f = party(6, 2);
  assert.equal(trailBound(f), 7);
  const walked = pathCells([at(0, 0), at(0, 9)], GS);
  const trail = extendTrail([at(0, 0)], walked, trailBound(f));
  assert.equal(trail.length, 7);
  assert.deepEqual(trail[0], at(0, 9));
  assert.deepEqual(trail[6], at(0, 3));
});

test("stepping back over the column turns it: the cell just left is behind the head", () => {
  const trail = extendTrail([at(0, 3), at(0, 2), at(0, 1)], [at(0, 2)], 10);
  assert.deepEqual(trail, [at(0, 2), at(0, 3)]);
});

test("a rank that stepped diagonally walks the vertical: its files spread across it", () => {
  const f = party(2, 2);
  // The head stepped south-east from (5,5) onto (6,6).
  const cells = columnCells(f, { anchor: at(6, 6), trail: [at(6, 6), at(5, 5)], heading: "north", gs: GS });
  assert.deepEqual(cells, [at(6, 6), at(5, 6)], "south's right hand is west");
});

test("a scripted jump is filled one step at a time, diagonals included", () => {
  assert.deepEqual(stepCells(at(0, 0), at(2, 1), GS), [at(1, 1), at(2, 1)]);
});

test("the cell under a token is read by its centre", () => {
  assert.deepEqual(cellUnder({ x: 100, y: 200 }, GS), at(1, 2));
  assert.deepEqual(cellUnder({ x: 100, y: 200, width: 2, height: 2 }, GS), at(2, 3));
});

test("a trail from another scene, or one that does not start under the head, is ignored", () => {
  const stored = { sceneId: "s1", points: [at(1, 1), at(1, 0)] };
  assert.deepEqual(usableTrail(stored, at(1, 1), "s2"), [at(1, 1)]);
  assert.deepEqual(usableTrail(stored, at(4, 4), "s1"), [at(4, 4)]);
  assert.deepEqual(usableTrail(stored, at(1, 1), "s1"), stored.points);
});

test("each early return of the movement hook treats the trail its own way", () => {
  assert.equal(trailDecision({ moved: true, resize: true }), "keep", "a resize the module made");
  assert.equal(trailDecision({ moved: true, halt: true }), "extend", "a trap's halt: the party walked that ground");
  assert.equal(trailDecision({ moved: true, travel: true }), "reset", "a priced walk to a point of interest");
  assert.equal(trailDecision({ moved: true, truth: true }), "reset", "onto the lost party's true position");
  assert.equal(trailDecision({ moved: true, teleport: true }), "reset", "a teleport");
  assert.equal(trailDecision({ rotated: true }), "reset", "a hand turn aims the column");
  assert.equal(trailDecision({ moved: true }), "extend", "a walk");
  assert.equal(trailDecision({}), "keep", "nothing moved");
});

test("nextTrail extends from where the move started and resets to the head", () => {
  const stored = { sceneId: "s", points: [at(2, 2), at(2, 1)] };
  const walked = nextTrail(stored, { decision: "extend", origin: at(2, 2), waypoints: [at(2, 3)], head: at(3, 3), sceneId: "s", gs: GS, bound: 5 });
  assert.deepEqual(walked.points, [at(3, 3), at(2, 3), at(2, 2), at(2, 1)]);
  const reset = nextTrail(stored, { decision: "reset", origin: at(2, 2), head: at(9, 9), sceneId: "s", gs: GS, bound: 5 });
  assert.deepEqual(reset, { sceneId: "s", points: [at(9, 9)] });
  assert.equal(nextTrail(stored, { decision: "keep", head: at(0, 0), sceneId: "s", gs: GS, bound: 5 }), null);
});

/* -------------------------------------------- */
/*  A party token on a scene                    */
/* -------------------------------------------- */

/** A square-gridded scene of 100-px cells measured in `distance` `units`. */
const scene = (id, { type = 1, units = "ft", distance = 10 } = {}) => ({
  id,
  grid: { type, size: GS, units, distance },
  dimensions: { sceneRect: { x: 0, y: 0, width: 30 * GS, height: 30 * GS } },
});
/** A one-cell party token on `onScene` at cell `cx`,`cy`, carrying `trail`. */
const partyToken = (onScene, cx, cy, trail = null, rotation = 0) => {
  const src = { x: cx * GS, y: cy * GS, width: 1, height: 1, rotation };
  return { ...src, _source: src, parent: onScene, getFlag: (scope, key) => (key === "trail" ? trail : undefined) };
};

test("columnFor lays the column from the stored trail on a square grid", () => {
  const sq = scene("s");
  const f = party(3, 1);
  const tok = partyToken(sq, 7, 7, { sceneId: "s", points: [at(7, 7), at(7, 6), at(6, 6)] });
  const out = column.columnFor(f, tok);
  assert.equal(out.column, true);
  assert.deepEqual(out.head, at(7, 7));
  assert.deepEqual(out.cells, [at(7, 7), at(7, 6), at(6, 6)]);
});

test("a hex scene and a mile-scale scene lay no column: every body stands at the head", () => {
  const f = party(3, 1);
  for (const sc of [scene("h", { type: 2 }), scene("m", { units: "mi", distance: 6 })]) {
    const out = column.columnFor(f, partyToken(sc, 2, 2));
    assert.equal(out.column, false, sc.id);
    assert.deepEqual(out.cells, [at(2, 2), at(2, 2), at(2, 2)], sc.id);
  }
});

test("a deploy takes the column's cells only once the trail has a step", () => {
  const sq = scene("s");
  const f = party(3, 1);
  assert.equal(column.columnPlacement(f, partyToken(sq, 4, 4)), null, "no trail: the straight block");
  assert.equal(column.columnPlacement(f, partyToken(sq, 4, 4, { sceneId: "other", points: [at(4, 4), at(3, 4)] })), null, "a trail from another scene");
  assert.equal(column.columnPlacement(f, partyToken(scene("h", { type: 2 }), 4, 4, { sceneId: "h", points: [at(4, 4), at(3, 4)] })), null, "no column on a hex map");
  const bent = column.columnPlacement(f, partyToken(sq, 4, 4, { sceneId: "s", points: [at(4, 4), at(4, 3), at(3, 3)] }));
  assert.deepEqual(bent, [[at(4, 4)], [at(4, 3)], [at(3, 3)]], "one cell list per member, along the bend");
});

test("a deploy that walked nowhere lays the column where a wall cuts the block, and the block where none does", () => {
  const f = party(2, 2);
  // Rotation 180 faces north: the files spread east.
  const cut = { ...scene("w"), walls: [wallX(5)] };
  assert.deepEqual(column.columnPlacement(f, partyToken(cut, 4, 4, null, 180)), [[at(4, 4)], [at(3, 4)]], "the second file steps west of the wall");
  const far = { ...scene("f"), walls: [wallX(20)] };
  assert.equal(column.columnPlacement(f, partyToken(far, 4, 4, null, 180)), null, "a wall the block never meets");
});

test("columnFor reads the scene's walls on the party token's level", () => {
  const f = party(2, 2);
  const sc = { ...scene("l"), walls: [wallX(5, { levels: ["upper"] })] };
  const tok = (level) => ({ ...partyToken(sc, 4, 4, null, 180), level });
  assert.deepEqual(column.columnFor(f, tok("upper")).cells, [at(4, 4), at(3, 4)]);
  assert.deepEqual(column.columnFor(f, tok("ground")).cells, [at(4, 4), at(5, 4)]);
});

/* -------------------------------------------- */
/*  The column's lights                         */
/* -------------------------------------------- */

// Invented figures, registered the way an import registers them.
tables.registerTable(
  { id: LIGHT_DOC, tables: { [LIGHT_TABLE]: { torch: { bright: 7, dim: 11, turns: 3 }, lantern: { bright: 9, dim: 13, turns: 4 } } } },
  { priority: tables.PRIORITY.WORLD },
);

test("two bearers give two light points, each at its bearer's cell centre", () => {
  const f = { frontage: 1, members: [{ actorId: "a" }, { actorId: "b" }, { actorId: "c" }], lights: [
    { id: "l1", type: "torch", bearerId: "a", lit: true },
    { id: "l2", type: "lantern", bearerId: "c", lit: true },
  ] };
  const cells = columnCells(f, { anchor: at(5, 5), heading: "north", gs: GS });
  const points = columnLights(f, cells, GS);
  assert.deepEqual(points.map((p) => p.bearerId), ["a", "c"]);
  assert.deepEqual(points[0], { bearerId: "a", x: 550, y: 550, bright: 7, dim: 11, kind: "flame" });
  assert.deepEqual(points[1], { bearerId: "c", x: 550, y: 750, bright: 9, dim: 13, kind: "flame" });
});

test("a member's effect light gives a point, and joins a flame at the larger of each radius", () => {
  const f = { frontage: 1, members: [{ actorId: "a" }, { actorId: "b" }, { actorId: "c" }], lights: [
    { id: "l1", type: "torch", bearerId: "a", lit: true },
  ] };
  const cells = columnCells(f, { anchor: at(5, 5), heading: "north", gs: GS });
  // Invented reaches: "b" has nothing but an effect, "a" a flame beaten by one, "c" nothing at all.
  const reach = { a: { bright: 20, dim: 8 }, b: { bright: 15, dim: 30 }, c: { bright: 0, dim: 0 } };
  const points = columnLights(f, cells, GS, (id) => reach[id]);
  assert.deepEqual(points.map((p) => p.bearerId), ["a", "b"]);
  assert.deepEqual(points[0], { bearerId: "a", x: 550, y: 550, bright: 20, dim: 11, kind: "magic" });
  assert.deepEqual(points[1], { bearerId: "b", x: 550, y: 650, bright: 15, dim: 30, kind: "magic" });
  assert.deepEqual(columnLights(f, cells, GS, () => null).map((p) => p.bearerId), ["a"], "no effect light leaves the flame alone");
});

test("a deployed member's effect light is not the column's", () => {
  const f = { frontage: 1, members: [{ actorId: "a", deployedTokenId: "t1" }], lights: [] };
  const cells = columnCells(f, { anchor: at(5, 5), heading: "north", gs: GS });
  assert.deepEqual(columnLights(f, cells, GS, () => ({ bright: 10, dim: 20 })), []);
});

test("a deployed bearer and a shuttered lantern shed nothing in the column", () => {
  const f = { frontage: 1, members: [{ actorId: "a", deployedTokenId: "t1" }, { actorId: "b" }], lights: [
    { id: "l1", type: "torch", bearerId: "a", lit: true },
    { id: "l2", type: "lantern", bearerId: "b", lit: true, shielded: true },
  ] };
  const cells = columnCells(f, { anchor: at(5, 5), heading: "north", gs: GS });
  assert.deepEqual(columnLights(f, cells, GS), []);
});

test("with no light figures imported a lit torch sheds nothing", () => {
  tables.unregisterTable(LIGHT_DOC);
  const f = { frontage: 1, members: [{ actorId: "a" }], lights: [{ id: "l1", type: "torch", bearerId: "a", lit: true }] };
  const cells = columnCells(f, { anchor: at(1, 1), heading: "north", gs: GS });
  assert.deepEqual(columnLights(f, cells, GS), []);
});

{
  // The column's view subscribes at install; `canvas.tokens` is read once per
  // laying of the columns, so its reads count the layings.
  let laid = 0;
  globalThis.Hooks = { on: () => {} };
  globalThis.canvas = {
    ready: true,
    get tokens() {
      laid++;
      return { placeables: [] };
    },
  };
  const { installColumnView } = await import("../scripts/formation/column-view.mjs");
  installColumnView();
  tables.registerTable({ id: "invented-other", tables: { t: {} } });
  assert.equal(laid, 0, "another document leaves the column alone");
  tables.registerTable({ id: LIGHT_DOC, tables: { [LIGHT_TABLE]: { torch: { radius: 1 } } } });
  assert.equal(laid, 1, "a registered light document lays the columns again");
  tables.unregisterTable(LIGHT_DOC, { priority: tables.PRIORITY.OVERRIDE });
  assert.equal(laid, 1, "removing a layer that was never there changes nothing");
  tables.unregisterTable(LIGHT_DOC);
  assert.equal(laid, 2, "removing the document lays them again");
  tables.unregisterTable("invented-other");
  delete globalThis.Hooks;
  delete globalThis.canvas;
  passed++;
}

test("a table listener hears each change once, and a throwing one blocks nobody", () => {
  const heard = [];
  const silence = console.error;
  console.error = () => {};
  const off = tables.onTablesChanged(() => {
    throw new Error("listener fault");
  });
  const offSecond = tables.onTablesChanged((docId) => heard.push(docId));
  try {
    tables.registerTable({ id: "invented-doc", tables: {} });
    tables.unregisterTable("invented-doc", { priority: tables.PRIORITY.WORLD });
    tables.unregisterTable("invented-doc", { priority: tables.PRIORITY.SAMPLE });
  } finally {
    off();
    offSecond();
    console.error = silence;
  }
  assert.deepEqual(heard, ["invented-doc", "invented-doc"], "register and an effective removal each notify once");
  tables.registerTable({ id: "invented-doc", tables: {} });
  assert.equal(heard.length, 2, "an unsubscribed listener hears nothing more");
  tables.unregisterTable("invented-doc");
});

console.log(`test-formation-column: ${passed} passed`);
