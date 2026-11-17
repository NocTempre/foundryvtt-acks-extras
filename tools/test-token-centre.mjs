/**
 * `lib/token-centre.mjs`: a token's centre is the document's own
 * `getCenterPoint` when it has one, else the footprint from the grid's own
 * `sizeX` / `sizeY`; read as an offset, so any corner can be asked and the
 * inverse puts the corner back. Every document and number is invented.
 */
import assert from "node:assert/strict";
import { brightestLightReaching } from "../scripts/lib/light.mjs";
import { centreOffset, tokenCentre, tokenCorner } from "../scripts/lib/token-centre.mjs";

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok   " + name); };

const square = { grid: { size: 100, sizeX: 100, sizeY: 100 } };
const hex = { grid: { size: 100, sizeX: 100, sizeY: 87 } };

ok("a document's own getCenterPoint answers, and the grid is not read", () => {
  const doc = { x: 200, y: 300, width: 1, height: 1, getCenterPoint: () => ({ x: 250, y: 343 }) };
  assert.deepEqual(tokenCentre(doc, { grid: { size: 9999 } }), { x: 250, y: 343 });
  assert.deepEqual(centreOffset(doc), { dx: 50, dy: 43 });
});

ok("the offset moves to another corner, so both ends of a move are measured alike", () => {
  const doc = { x: 200, y: 300, getCenterPoint: () => ({ x: 250, y: 343 }) };
  assert.deepEqual(tokenCentre(doc, null, { x: 0, y: 0 }), { x: 50, y: 43 });
});

ok("a getCenterPoint that answers no point falls back to the footprint", () => {
  const doc = { x: 0, y: 0, width: 1, height: 1, getCenterPoint: () => null, parent: square };
  assert.deepEqual(tokenCentre(doc), { x: 50, y: 50 });
});

ok("without getCenterPoint the footprint is sizeX by sizeY, not size twice", () => {
  const doc = { x: 10, y: 20, width: 1, height: 1 };
  assert.deepEqual(tokenCentre(doc, hex), { x: 60, y: 20 + 43.5 });
});

ok("a non-square size scales each axis by its own extent", () => {
  const doc = { x: 0, y: 0, width: 2, height: 3 };
  assert.deepEqual(tokenCentre(doc, hex), { x: 100, y: (3 * 87) / 2 });
});

ok("a grid that states only size takes it on both axes", () => {
  assert.deepEqual(tokenCentre({ x: 0, y: 0, width: 2, height: 1 }, { grid: { size: 50 } }), { x: 50, y: 25 });
});

ok("the scene defaults to the document's parent; a missing width is one cell", () => {
  assert.deepEqual(tokenCentre({ x: 100, y: 100, parent: square }), { x: 150, y: 150 });
});

ok("a width of zero is a point, not a cell", () => {
  assert.deepEqual(tokenCentre({ x: 7, y: 9, width: 0, height: 0 }, square), { x: 7, y: 9 });
});

ok("no scene and no getCenterPoint leaves the corner, never a throw", () => {
  assert.deepEqual(tokenCentre({ x: 4, y: 5, width: 1, height: 1 }), { x: 4, y: 5 });
});

ok("tokenCorner is the inverse of tokenCentre, on both paths", () => {
  const plain = { x: 10, y: 20, width: 2, height: 1 };
  const own = { x: 10, y: 20, getCenterPoint: () => ({ x: 55, y: 63 }) };
  for (const [doc, scene] of [[plain, hex], [own, null]]) {
    const centre = tokenCentre(doc, scene);
    assert.deepEqual(tokenCorner(centre, doc, scene), { x: doc.x, y: doc.y });
  }
  assert.deepEqual(tokenCorner({ x: 500, y: 500 }, own, null), { x: 455, y: 457 });
});

ok("a light reader measures a hex token from its own centre", () => {
  // 100 px across and 87 down a hex, 10 units apiece on the wide axis: 10 px is a unit.
  const scene = { grid: { size: 100, sizeX: 100, sizeY: 87, distance: 10 }, lights: [], tokens: [] };
  const me = { x: 0, y: 0, width: 1, height: 1, parent: scene };
  // Centred at (50, 43.5); a lamp point 52 units (520 px) right of it is out of a
  // 50-unit reach, and in reach of 52 only when the centre is the hex's, not (50, 50).
  scene.lights = [{ x: 570, y: 43.5, config: { bright: 52 } }];
  assert.equal(brightestLightReaching(me), 52);
  scene.lights = [{ x: 570, y: 43.5, config: { bright: 51.9 } }];
  assert.equal(brightestLightReaching(me), 0);
});

console.log(`\n${passed} passed`);
