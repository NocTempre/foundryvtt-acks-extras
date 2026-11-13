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
const { FORMATION_DOC } = await import("../scripts/formation/constants.mjs");
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
/** A deploy spot standing on a cell alone, as an unspaced column gives it. */
const spot = (cell) => ({ point: null, cell });
/** A cell's centre. */
const ctr = (cell) => column.cellCentre(cell, GS);

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
  assert.deepEqual(bent, [[spot(at(4, 4))], [spot(at(4, 3))], [spot(at(3, 3))]], "one spot list per member, along the bend, none standing off its cell");
});

test("a deploy that walked nowhere lays the column where a wall cuts the block, and the block where none does", () => {
  const f = party(2, 2);
  // Rotation 180 faces north: the files spread east.
  const cut = { ...scene("w"), walls: [wallX(5)] };
  assert.deepEqual(column.columnPlacement(f, partyToken(cut, 4, 4, null, 180)), [[spot(at(4, 4))], [spot(at(3, 4))]], "the second file steps west of the wall");
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
/*  The column spaced as the book spaces it     */
/* -------------------------------------------- */

// Invented figures, registered the way an import registers them: 2 ft of march
// frontage, 4 ft wide, 1.5 ft between ranks, on a grid of 5 ft to 100 px.
const FIGURES = { marchFrontageFeet: 2, wideFrontageFeet: 4, rankIntervalFeet: 1.5 };
const withFigures = (figures, fn) => {
  tables.registerTable({ id: FORMATION_DOC, tables: figures }, { priority: tables.PRIORITY.WORLD });
  try {
    return fn();
  } finally {
    tables.unregisterTable(FORMATION_DOC);
  }
};
/** A 5 ft grid scene, so 2 / 4 / 1.5 ft are 40 / 80 / 30 px. */
const spaced = (id, extra = {}) => ({ ...scene(id, { distance: 5 }), ...extra });
/** The spacing literal the pure layout takes, in pixels. */
const SPACING = { marchPx: 40, widePx: 80, intervalPx: 30 };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);
const pointsAre = (got, want) => {
  assert.equal(got.length, want.length);
  got.forEach((p, i) => {
    near(p.x, want[i].x);
    near(p.y, want[i].y);
  });
};

test("the spacing needs all three figures and a scene that says what a cell is worth", () => {
  assert.equal(column.columnSpacing(spaced("s")), null, "nothing registered");
  withFigures(FIGURES, () => {
    assert.deepEqual(column.columnSpacing(spaced("s")), { march: 2, wide: 4, interval: 1.5, feetPerCell: 5, marchPx: 40, widePx: 80, intervalPx: 30 });
    assert.equal(column.columnSpacing({ id: "n", grid: { type: 1, size: GS } }), null, "a scene with no cell distance");
  });
  withFigures({ marchFrontageFeet: 2, wideFrontageFeet: 4 }, () => assert.equal(column.columnSpacing(spaced("s")), null, "two of the three"));
  withFigures({ ...FIGURES, rankIntervalFeet: 0 }, () => assert.equal(column.columnSpacing(spaced("s")), null, "a figure of nothing"));
});

test("ranks stand an interval apart along the line, not a cell", () => {
  const f = party(4, 1);
  pointsAre(column.columnPoints(f, { anchor: at(5, 5), heading: "north", gs: GS, spacing: SPACING }), [0, 30, 60, 90].map((d) => ({ x: 550, y: 550 + d })));
});

test("files stand at the sum of their half-frontages, and a wide body widens its file", () => {
  const f = party(3, 3);
  // Facing north the right hand is east.
  pointsAre(column.columnPoints(f, { anchor: at(5, 5), heading: "north", gs: GS, spacing: SPACING }), [{ x: 550, y: 550 }, { x: 590, y: 550 }, { x: 630, y: 550 }]);
  pointsAre(column.columnPoints(f, { anchor: at(5, 5), heading: "north", gs: GS, spacing: SPACING, wide: [false, true, false] }), [{ x: 550, y: 550 }, { x: 610, y: 550 }, { x: 670, y: 550 }]);
  pointsAre(column.columnPoints(f, { anchor: at(5, 5), heading: "north", gs: GS, spacing: SPACING, wide: [true, false, false] }), [{ x: 550, y: 550 }, { x: 610, y: 550 }, { x: 650, y: 550 }]);
});

test("a file a wall shuts out takes the other hand, and one neither hand reaches goes to the next rank", () => {
  const f = party(3, 3);
  const one = column.nearWalls([wallX(6)], { near: { x: 550, y: 550 }, reach: 2000 });
  pointsAre(column.columnPoints(f, { anchor: at(5, 5), heading: "north", gs: GS, spacing: SPACING, walls: one }), [{ x: 550, y: 550 }, { x: 510, y: 550 }, { x: 470, y: 550 }]);
  const both = column.nearWalls([wallX(5), wallX(6)], { near: { x: 550, y: 550 }, reach: 2000 });
  pointsAre(column.columnPoints(f, { anchor: at(5, 5), heading: "north", gs: GS, spacing: SPACING, walls: both }), [{ x: 550, y: 550 }, { x: 550, y: 580 }, { x: 550, y: 610 }]);
  const edge = { minX: 0, minY: 0, maxX: 500, maxY: 900 };
  pointsAre(column.columnPoints(f, { anchor: at(5, 5), heading: "north", gs: GS, spacing: SPACING, bounds: edge }), [{ x: 550, y: 550 }, { x: 510, y: 550 }, { x: 470, y: 550 }]);
});

test("the line bends where the trail does, and files follow the way each rank walks", () => {
  const f = party(4, 1);
  const trail = [at(7, 7), at(7, 6), at(7, 5), at(6, 5), at(5, 5)];
  const wide = { marchPx: 40, widePx: 80, intervalPx: 70 };
  // 70 px a rank: 70 down the first leg, 140 reaches 40 into the second, 210 is 10 into the third.
  pointsAre(column.columnPoints(f, { anchor: at(7, 7), trail, heading: "south", gs: GS, spacing: wide }), [{ x: 750, y: 750 }, { x: 750, y: 680 }, { x: 750, y: 610 }, { x: 740, y: 550 }]);
  const two = party(2, 2);
  // A rank walking east has its right hand to the south: the second file stands 40 px south.
  pointsAre(column.columnPoints(two, { anchor: at(7, 5), trail: [at(7, 5), at(6, 5)], heading: "east", gs: GS, spacing: { ...SPACING, intervalPx: 70 }, count: 2 }), [{ x: 750, y: 550 }, { x: 750, y: 590 }]);
});

test("a body is wide with an equipped large melee weapon that crushes or cuts and does not pierce", () => {
  const weapon = (system) => ({ type: "weapon", system: { equipped: true, melee: true, size: "large", damage: { base: { types: ["slashing"] }, alternate: { types: [] } }, ...system } });
  const wields = (...items) => column.isWideBearer({ items });
  assert.equal(wields(weapon({})), true, "a large slashing weapon");
  assert.equal(wields(weapon({ damage: { base: { types: new Set(["bludgeoning"]) }, alternate: { types: [] } } })), true, "a large bludgeoning one, types held as a set");
  assert.equal(wields(weapon({ damage: { base: { types: ["slashing"] }, alternate: { types: ["piercing"] } } })), false, "one that also pierces");
  assert.equal(wields(weapon({ damage: { base: { types: ["piercing"] }, alternate: { types: [] } } })), false, "a piercing one");
  assert.equal(wields(weapon({ equipped: false })), false, "not equipped");
  assert.equal(wields(weapon({ size: "medium" })), false, "not large");
  assert.equal(wields(weapon({ melee: false })), false, "not a melee weapon");
  assert.equal(wields({ type: "item", system: { equipped: true, melee: true, size: "large", damage: { base: { types: ["slashing"] } } } }), false, "not a weapon");
  assert.equal(column.isWideBearer(null), false, "nobody");
  globalThis.game.actors = new Map([["w", { id: "w", items: [weapon({})] }], ["g", { id: "g", type: "acks-extras.group", system: { stacks: [{ size: { current: 2 } }] }, items: [weapon({})] }]]);
  try {
    const f = { frontage: 2, members: [{ actorId: "w" }, { blank: true }, { actorId: "g" }, { actorId: "x" }] };
    assert.deepEqual(column.bodyWides(f), [true, false, false, false, false], "a stack's bodies, a blank and an unknown actor march");
  } finally {
    globalThis.game.actors = new Map();
  }
});

test("a scene with nothing registered lays today's column: points are the cells' centres, one cell wide", () => {
  const sq = spaced("s");
  const f = party(3, 1);
  const tok = partyToken(sq, 7, 7, { sceneId: "s", points: [at(7, 7), at(7, 6), at(6, 6)] });
  const out = column.columnFor(f, tok);
  assert.deepEqual(out.cells, [at(7, 7), at(7, 6), at(6, 6)]);
  assert.deepEqual(out.points, out.cells.map(ctr));
  assert.deepEqual(out.sizes, [GS, GS, GS]);
  assert.deepEqual(column.columnPlacement(f, tok), out.cells.map((cell) => [spot(cell)]));
  for (const sc of [scene("h", { type: 2 }), scene("m", { units: "mi", distance: 6 })]) {
    const none = column.columnFor(f, partyToken(sc, 2, 2));
    assert.deepEqual(none.points, [ctr(at(2, 2)), ctr(at(2, 2)), ctr(at(2, 2))], `${sc.id}: no column, every body at the head`);
  }
});

test("a spaced scene answers points and widths, and keeps the one-per-cell cells beside them", () => {
  withFigures(FIGURES, () => {
    const sq = spaced("s");
    const f = party(3, 1);
    const tok = partyToken(sq, 7, 7, { sceneId: "s", points: [at(7, 7), at(7, 6), at(6, 6)] });
    const out = column.columnFor(f, tok);
    assert.deepEqual(out.cells, [at(7, 7), at(7, 6), at(6, 6)], "the cells a world with no figures stands on");
    pointsAre(out.points, [{ x: 750, y: 750 }, { x: 750, y: 720 }, { x: 750, y: 690 }]);
    assert.deepEqual(out.sizes, [40, 40, 40]);
    assert.deepEqual(out.head, at(7, 7));
    for (const sc of [scene("h", { type: 2, distance: 5 }), scene("m", { units: "mi", distance: 6 })]) {
      assert.equal(column.columnFor(f, partyToken(sc, 2, 2)).column, false, `${sc.id} lays no column even with figures`);
    }
  });
});

test("a spaced deploy with no step walked is still the column, never the straight block", () => {
  withFigures(FIGURES, () => {
    const f = party(2, 1);
    const placed = column.columnPlacement(f, partyToken(spaced("s"), 4, 4));
    assert.equal(placed.length, 2);
    pointsAre(placed.map(([s]) => s.point), [{ x: 450, y: 450 }, { x: 450, y: 420 }]);
    assert.deepEqual(placed.map(([s]) => s.cell), [at(4, 4), at(4, 3)], "each body's one-per-cell cell, behind the facing");
  });
});

test("a deploy stands the token on its point where it fits, and on its own cell where it does not", () => {
  const cellOf = at(5, 5);
  const point = { x: 560, y: 540 };
  const opts = (w, h, fits) => ({ w, h, gs: GS, fits });
  const on = (fits, w = 1, h = 1) => column.deploySpot({ point, cell: cellOf }, opts(w, h, fits));
  assert.deepEqual(on(() => true), { x: 510, y: 490 }, "open ground: the token centred on the point");
  assert.deepEqual(on(() => false), cellOf, "a wall cuts it: its own cell");
  assert.deepEqual(column.deploySpot({ point: null, cell: cellOf }, opts(1, 1, () => true)), cellOf, "no point: its own cell");
  assert.deepEqual(on(null), cellOf, "no footprint test: its own cell");
  const seen = [];
  on((box) => (seen.push(box), true));
  assert.deepEqual(seen[0], { minX: 511, minY: 491, maxX: 609, maxY: 589 }, "the footprint is shrunk a pixel on every side");
  assert.deepEqual(on(() => true, 2, 2), { x: 460, y: 440 }, "a token two cells wide is centred by its own size");
});

test("the footprint test: a wall touching the token cuts it, a token flush against a wall fits, a 2x2 fits at 1x1 but not at its own size", () => {
  withFigures(FIGURES, () => {
    const f = party(1, 1);
    const fitsAgainst = (walls, scn = {}) => column.spotFits(f, partyToken({ ...spaced("d", { walls }), ...scn }, 5, 5));
    const put = (fits, w, h) => column.deploySpot({ point: { x: 550, y: 550 }, cell: at(5, 5) }, { w, h, gs: GS, fits });
    assert.deepEqual(put(fitsAgainst([wallX(20)]), 1, 1), { x: 500, y: 500 }, "no wall near");
    assert.deepEqual(put(fitsAgainst([wallX(6)]), 1, 1), { x: 500, y: 500 }, "flush against a wall");
    assert.deepEqual(put(fitsAgainst([wallX(5.8)]), 1, 1), at(5, 5), "a wall through the token's footprint: the cell");
    assert.deepEqual(put(fitsAgainst([wallX(6.4)]), 1, 1), { x: 500, y: 500 }, "a wall past the footprint");
    assert.deepEqual(put(fitsAgainst([wallX(6.4)]), 2, 2), at(5, 5), "the same wall touches a token twice the size");
    assert.deepEqual(put(fitsAgainst([wallX(5.8, { door: 1, ds: 1 })]), 1, 1), { x: 500, y: 500 }, "an open door stops nothing");
    assert.deepEqual(put(fitsAgainst([wallX(5.8, { dir: 2 })]), 1, 1), at(5, 5), "a one-way wall stops by its line, whichever way it faces");
    assert.deepEqual(put(fitsAgainst([wallX(5.8, { move: 0 })]), 1, 1), { x: 500, y: 500 }, "a wall that stops no one");
    const small = { dimensions: { sceneRect: { x: 0, y: 0, width: 600, height: 600 } } };
    assert.deepEqual(put(fitsAgainst([], small), 1, 1), { x: 500, y: 500 }, "a token flush with the scene's edge fits");
    assert.deepEqual(put(fitsAgainst([], { dimensions: { sceneRect: { x: 0, y: 0, width: 580, height: 600 } } }), 1, 1), at(5, 5), "a token past the scene's edge does not");
  });
});

test("the trail bound grows only past a cell per body", () => {
  const f = party(6, 2);
  assert.equal(trailBound(f), 7, "no scene: one per body and one more");
  withFigures(FIGURES, () => assert.equal(trailBound(f, spaced("s")), 7, "an interval under a cell keeps one per body"));
  withFigures({ ...FIGURES, rankIntervalFeet: 5 }, () => assert.equal(trailBound(f, spaced("s")), 7, "an interval of a cell keeps one per body"));
  withFigures({ ...FIGURES, rankIntervalFeet: 7.5 }, () => assert.equal(trailBound(f, spaced("s")), 10, "an interval of one and a half cells reaches nine cells"));
  assert.equal(trailBound(f, spaced("s")), 7, "nothing registered");
});

test("a column longer than its trail runs on straight to reach every rank", () => {
  const f = party(4, 1);
  const long = { marchPx: 40, widePx: 80, intervalPx: 150 };
  pointsAre(column.columnPoints(f, { anchor: at(5, 5), heading: "north", gs: GS, spacing: long }), [0, 150, 300, 450].map((d) => ({ x: 550, y: 550 + d })));
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
  const points = columnLights(f, cells.map(ctr));
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
  const points = columnLights(f, cells.map(ctr), (id) => reach[id]);
  assert.deepEqual(points.map((p) => p.bearerId), ["a", "b"]);
  assert.deepEqual(points[0], { bearerId: "a", x: 550, y: 550, bright: 20, dim: 11, kind: "magic" });
  assert.deepEqual(points[1], { bearerId: "b", x: 550, y: 650, bright: 15, dim: 30, kind: "magic" });
  assert.deepEqual(columnLights(f, cells.map(ctr), () => null).map((p) => p.bearerId), ["a"], "no effect light leaves the flame alone");
});

test("a deployed member's effect light is not the column's", () => {
  const f = { frontage: 1, members: [{ actorId: "a", deployedTokenId: "t1" }], lights: [] };
  const cells = columnCells(f, { anchor: at(5, 5), heading: "north", gs: GS });
  assert.deepEqual(columnLights(f, cells.map(ctr), () => ({ bright: 10, dim: 20 })), []);
});

test("a deployed bearer and a shuttered lantern shed nothing in the column", () => {
  const f = { frontage: 1, members: [{ actorId: "a", deployedTokenId: "t1" }, { actorId: "b" }], lights: [
    { id: "l1", type: "torch", bearerId: "a", lit: true },
    { id: "l2", type: "lantern", bearerId: "b", lit: true, shielded: true },
  ] };
  const cells = columnCells(f, { anchor: at(5, 5), heading: "north", gs: GS });
  assert.deepEqual(columnLights(f, cells.map(ctr)), []);
});

test("with no light figures imported a lit torch sheds nothing", () => {
  tables.unregisterTable(LIGHT_DOC);
  const f = { frontage: 1, members: [{ actorId: "a" }], lights: [{ id: "l1", type: "torch", bearerId: "a", lit: true }] };
  const cells = columnCells(f, { anchor: at(1, 1), heading: "north", gs: GS });
  assert.deepEqual(columnLights(f, cells.map(ctr)), []);
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
  tables.registerTable({ id: FORMATION_DOC, tables: FIGURES });
  assert.equal(laid, 3, "registered frontage figures lay the columns again");
  tables.unregisterTable(FORMATION_DOC);
  assert.equal(laid, 4, "removing them lays the columns again");
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
