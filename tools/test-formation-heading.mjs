/**
 * Which way a marching block points.
 *
 * The offsets and the clamp are pure geometry, so every cardinal is exercised by
 * passing the heading in. Only the last block needs a world, and it needs just
 * enough of one to prove the heading really is read off the party token.
 */
import assert from "node:assert/strict";
import {
  DEFAULT_HEADING,
  HEADINGS,
  blockOrigin,
  bodyPosition,
  formationHeading,
  formationOffset,
  snapHeading,
} from "../scripts/formation/formation-model.mjs";

// The smallest world these functions reach for: an empty actor directory (so a
// member counts as the one body it is) and a scene directory the last block
// fills in. Nothing else here touches Foundry.
globalThis.game = { actors: new Map(), scenes: new Map() };

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

/** A formation of `count` plain members at the given frontage. */
const party = (count, frontage) => ({
  frontage,
  members: Array.from({ length: count }, (_, i) => ({ actorId: `a${i}`, roles: [] })),
});

/** A 20x20 scene of 100px squares starting at the origin. */
const scene = (cols = 20, rows = 20) => ({
  grid: { size: 100, distance: 5 },
  dimensions: { sceneRect: { x: 0, y: 0, width: cols * 100, height: rows * 100 } },
});

/** Every body's offset, in order. */
const shape = (formation, heading, bodies) =>
  Array.from({ length: bodies }, (_, i) => formationOffset(formation, i, heading));

/* -------------------------------------------- */
/*  Snapping a rotation to a cardinal            */
/* -------------------------------------------- */

test("Foundry's zero rotation is southward, and the quarters run through west", () => {
  assert.equal(snapHeading(0), "south");
  assert.equal(snapHeading(90), "west");
  assert.equal(snapHeading(180), "north");
  assert.equal(snapHeading(270), "east");
  assert.equal(snapHeading(360), "south");
});

test("a rotation off the cardinals snaps to the nearest one", () => {
  assert.equal(snapHeading(20), "south");
  assert.equal(snapHeading(100), "west");
  assert.equal(snapHeading(200), "north");
  assert.equal(snapHeading(-90), "east");
  assert.equal(snapHeading(-180), "north");
  // Well past a full turn still lands on the right quarter.
  assert.equal(snapHeading(810), "west");
});

test("a rotation that is not a number is not a facing of zero", () => {
  // A token that never answered takes the default; it does not point south by
  // accident, which is what reading `undefined` as 0 would do.
  assert.equal(snapHeading(undefined), DEFAULT_HEADING);
  assert.equal(snapHeading(null), DEFAULT_HEADING);
  assert.equal(snapHeading("northish"), DEFAULT_HEADING);
  assert.equal(snapHeading(NaN), DEFAULT_HEADING);
});

test("forward and right are perpendicular unit vectors at every cardinal", () => {
  for (const [name, { forward, right }] of Object.entries(HEADINGS)) {
    assert.equal(Math.abs(forward.x) + Math.abs(forward.y), 1, `${name} forward is a unit step`);
    assert.equal(Math.abs(right.x) + Math.abs(right.y), 1, `${name} right is a unit step`);
    const dot = forward.x * right.x + forward.y * right.y;
    assert.equal(dot + 0, 0, `${name} axes are perpendicular`);
  }
});

/* -------------------------------------------- */
/*  The block turns with the heading             */
/* -------------------------------------------- */

test("a single file trails BEHIND the party at all four cardinals", () => {
  const file = party(4, 1);
  // The head of the column is always at the anchor, and the rest string out
  // the way the party came from — never always to the south.
  assert.deepEqual(shape(file, "north", 3), [
    { dx: 0, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: 2 },
  ]);
  assert.deepEqual(shape(file, "south", 3), [
    { dx: 0, dy: 0 },
    { dx: 0, dy: -1 },
    { dx: 0, dy: -2 },
  ]);
  assert.deepEqual(shape(file, "east", 3), [
    { dx: 0, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: -2, dy: 0 },
  ]);
  // The roadmap's case: marching west, the column trails east.
  assert.deepEqual(shape(file, "west", 3), [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 2, dy: 0 },
  ]);
});

test("files spread across the line of march, never along it", () => {
  const two = party(4, 2);
  // Marching north or south the rank is horizontal; east or west, vertical.
  assert.deepEqual(shape(two, "north", 2), [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ]);
  assert.deepEqual(shape(two, "south", 2), [
    { dx: 0, dy: 0 },
    { dx: -1, dy: 0 },
  ]);
  assert.deepEqual(shape(two, "east", 2), [
    { dx: 0, dy: 0 },
    { dx: 0, dy: 1 },
  ]);
  assert.deepEqual(shape(two, "west", 2), [
    { dx: 0, dy: 0 },
    { dx: 0, dy: -1 },
  ]);
});

test("the second file is always on the party's right hand", () => {
  // Facing north on screen, your right is east; turn a quarter and it follows.
  const two = party(2, 2);
  const rightOf = (heading) => formationOffset(two, 1, heading);
  assert.deepEqual(rightOf("north"), { dx: 1, dy: 0 });
  assert.deepEqual(rightOf("east"), { dx: 0, dy: 1 });
  assert.deepEqual(rightOf("south"), { dx: -1, dy: 0 });
  assert.deepEqual(rightOf("west"), { dx: 0, dy: -1 });
});

test("a wide block keeps its shape through a quarter turn", () => {
  const six = party(6, 3);
  const north = shape(six, "north", 6);
  const east = shape(six, "east", 6);
  // Turning the party east rotates the whole block clockwise on screen: what
  // was (dx, dy) becomes (-dy, dx). The `+ 0` folds the negative zero that
  // negating an offset of nothing produces on this side of the comparison.
  east.forEach((cell, i) => {
    assert.deepEqual(cell, { dx: -north[i].dy + 0, dy: north[i].dx }, `body ${i}`);
  });
  // And a half turn is the same block negated.
  shape(six, "south", 6).forEach((cell, i) => {
    assert.deepEqual(cell, { dx: -north[i].dx + 0, dy: -north[i].dy + 0 }, `body ${i}`);
  });
});

test("no two bodies of a block ever share a square", () => {
  const eight = party(8, 3);
  for (const heading of Object.keys(HEADINGS)) {
    const seen = new Set(shape(eight, heading, 8).map((o) => `${o.dx},${o.dy}`));
    assert.equal(seen.size, 8, `${heading} places eight bodies on eight squares`);
  }
});

/* -------------------------------------------- */
/*  The clamp turns with it too                  */
/* -------------------------------------------- */

test("the whole block lands on the map at every cardinal", () => {
  // Six abreast, three deep, anchored in each corner in turn: whichever way it
  // faces and whichever corner it starts from, no body may leave the scene.
  const block = party(18, 6);
  const map = scene(20, 20);
  const corners = [
    { x: 0, y: 0 },
    { x: 1900, y: 0 },
    { x: 0, y: 1900 },
    { x: 1900, y: 1900 },
  ];
  for (const heading of Object.keys(HEADINGS)) {
    for (const anchor of corners) {
      const origin = blockOrigin(block, map, anchor, { heading });
      for (let body = 0; body < 18; body++) {
        const { dx, dy } = formationOffset(block, body, heading);
        const x = origin.x + dx * 100;
        const y = origin.y + dy * 100;
        assert.ok(x >= 0 && x <= 1900, `${heading} @ ${anchor.x},${anchor.y}: body ${body} x=${x}`);
        assert.ok(y >= 0 && y <= 1900, `${heading} @ ${anchor.x},${anchor.y}: body ${body} y=${y}`);
      }
    }
  }
});

test("span and depth swap axes for an east-west heading", () => {
  // Ten abreast and two deep, anchored in the top-right corner region.
  const wide = party(20, 10);
  const map = scene(20, 20);
  const corner = { x: 1900, y: 100 };
  const north = blockOrigin(wide, map, corner, { heading: "north" });
  const west = blockOrigin(wide, map, corner, { heading: "west" });

  // Marching north, the nine squares of SPAN are horizontal, so the origin is
  // dragged nine squares back from the right edge — and the single rank behind
  // fits below without moving it down at all.
  assert.deepEqual(north, { x: 1000, y: 100 });

  // Turn the party west and the two measures exchange axes: only the one square
  // of DEPTH is horizontal now (so x barely moves), while the ten-wide line runs
  // up the map and has to be pushed nine squares clear of the top edge. Under
  // the old clamp, which took span for horizontal and depth for vertical, y was
  // never moved at all and nine ranks marched off the top of the scene.
  assert.deepEqual(west, { x: 1800, y: 900 });
});

test("a block reaching up and left is held off those edges, not the far ones", () => {
  // Marching south the block extends up and to the LEFT, so the top-left corner
  // is the one it cannot start in — the exact case the old clamp never checked,
  // because it only ever pushed blocks away from the right and bottom edges.
  const block = party(9, 3);
  const map = scene(20, 20);
  const origin = blockOrigin(block, map, { x: 0, y: 0 }, { heading: "south" });
  assert.deepEqual(origin, { x: 200, y: 200 });
  // Anchored well inside the map it is not moved at all.
  assert.deepEqual(blockOrigin(block, map, { x: 900, y: 900 }, { heading: "south" }), { x: 900, y: 900 });
});

test("marching north is laid out exactly as an unrotated block always was", () => {
  // The historic shape (`dx = index % frontage`, `dy = floor(index / frontage)`)
  // is the north case, so nothing about a north-facing party moved.
  const block = party(7, 3);
  for (let i = 0; i < 7; i++) {
    assert.deepEqual(formationOffset(block, i, "north"), { dx: i % 3, dy: Math.floor(i / 3) });
  }
  const map = scene(20, 20);
  assert.deepEqual(blockOrigin(block, map, { x: 1900, y: 1900 }, { heading: "north" }), { x: 1700, y: 1700 });
});

test("a block bigger than the scene is pinned, and the per-cell clamp takes over", () => {
  const huge = party(60, 30);
  const small = scene(4, 4);
  for (const heading of Object.keys(HEADINGS)) {
    const origin = blockOrigin(huge, small, { x: 0, y: 0 }, { heading });
    for (let body = 0; body < 60; body++) {
      const { x, y } = bodyPosition(huge, small, origin, body, heading);
      assert.ok(x >= 0 && x <= 300, `${heading}: body ${body} clamped to x=${x}`);
      assert.ok(y >= 0 && y <= 300, `${heading}: body ${body} clamped to y=${y}`);
    }
  }
});

test("a scene with no grid places the block where it was asked to", () => {
  const block = party(4, 2);
  assert.deepEqual(blockOrigin(block, null, { x: 55, y: 66 }, { heading: "west" }), { x: 55, y: 66 });
});

/* -------------------------------------------- */
/*  Read off the party token                     */
/* -------------------------------------------- */

test("the heading is the party token's own facing", () => {
  // The smallest world that answers `getPartyToken`: no stored heading field
  // exists, so this read is the whole of the feature's state.
  const token = { rotation: 270 };
  game.scenes.set("s1", { tokens: new Map([["t1", token]]) });
  const formation = { ...party(4, 2), sceneId: "s1", tokenId: "t1" };
  assert.equal(formationHeading(formation), "east");

  // Turning the token turns the block, with nothing written anywhere.
  token.rotation = 90;
  assert.equal(formationHeading(formation), "west");
  assert.deepEqual(formationOffset(formation, 1), { dx: 0, dy: -1 });

  // A formation whose token is not on a scene falls back rather than throwing.
  assert.equal(formationHeading({ ...formation, tokenId: null }), DEFAULT_HEADING);
});

console.log(`test-formation-heading: OK (${passed} checks — snapping, four cardinals, clamp, token read)`);
