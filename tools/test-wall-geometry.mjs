/**
 * Segments, and the graph a set of them draws.
 *
 * No printed values: this is geometry. What it pins is the reason the graph
 * exists — a walk ALONG a bent line is longer than the chord across it, a line
 * closed or continued by eye is still one network, and a point nowhere near the
 * lines is not on them.
 *
 * The moved segment helpers (`chainWalls`, `segmentCrossing`,
 * `pointSegmentDistance`, `segmentDistance`) stay covered by
 * `test-trap-rules.mjs`, which exercises them through the trap api that
 * re-exports them.
 */
import assert from "node:assert/strict";
import {
  joinSegments,
  nearestOnGraph,
  nearestPointOnSegment,
  pathLengthAlong,
  shortestPath,
} from "../scripts/lib/wall-geometry.mjs";

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok   " + name); };
/** Pixels compared to within a thousandth: these are projections, not integers. */
const close = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-3, `${what}: ${a} is not ${b}`);

/** A horizontal leg then a vertical one, meeting at (100, 0): an L. */
const BEND = [[0, 0, 100, 0], [100, 0, 100, 100]];

ok("a projection is clamped to the segment it is on", () => {
  const seg = [0, 0, 100, 0];
  const beside = nearestPointOnSegment(50, 30, seg);
  assert.deepEqual([beside.x, beside.y], [50, 0]);
  assert.equal(beside.distance, 30);
  assert.equal(beside.t, 0.5, "half way along");
  // Off past one end projects onto that END, not onto the infinite line.
  const past = nearestPointOnSegment(160, 0, seg);
  assert.deepEqual([past.x, past.y], [100, 0]);
  assert.equal(past.distance, 60);
  assert.equal(past.t, 1);
  // A segment of no length is a point, and everything projects onto it.
  const dot = nearestPointOnSegment(3, 4, [0, 0, 0, 0]);
  assert.equal(dot.distance, 5);
  assert.equal(dot.t, 0);
});

ok("endpoints within the tolerance are one node", () => {
  // The far end of the first leg and the near end of the second are three
  // pixels apart — what dragging two lengths by hand actually produces.
  const graph = joinSegments([[0, 0, 100, 0], [103, 0, 103, 100]], 8);
  assert.equal(graph.edges.length, 2);
  assert.equal(graph.nodes.length, 3, "the seam is ONE node, not two");
  assert.ok(shortestPath(graph, 0, 2), "so the network is connected");
});

ok("outside the tolerance they are two networks", () => {
  const graph = joinSegments([[0, 0, 100, 0], [140, 0, 140, 100]], 8);
  assert.equal(graph.nodes.length, 4);
  assert.equal(shortestPath(graph, 0, 3), null, "nothing joins them");
});

ok("a segment shorter than the tolerance is no edge at all", () => {
  const graph = joinSegments([[0, 0, 100, 0], [100, 0, 103, 0]], 8);
  assert.equal(graph.edges.length, 1, "a self-loop of no length is not a step");
});

ok("what a segment carries rides along on its edge", () => {
  const graph = joinSegments([{ c: [0, 0, 100, 0], surface: "paved", street: "avenue" }], 8);
  assert.equal(graph.edges[0].meta.surface, "paved");
  assert.equal(graph.edges[0].meta.street, "avenue");
  // A bare array carries nothing, and asking for what is not there is not an
  // error: a wall with no layer is still geometry.
  assert.deepEqual(joinSegments([[0, 0, 50, 0]]).edges[0].meta, {});
});

ok("the shortest walk is the shortest, not the first found", () => {
  // Two ways round a rectangle: 100 + 40 + 100 the long way, 40 the short.
  const graph = joinSegments([
    [0, 0, 0, 40],
    [0, 0, 100, 0], [100, 0, 100, 40], [100, 40, 0, 40],
  ], 8);
  const from = graph.nodes.findIndex((n) => n.x === 0 && n.y === 0);
  const to = graph.nodes.findIndex((n) => n.x === 0 && n.y === 40);
  const path = shortestPath(graph, from, to);
  assert.equal(path.length, 40);
  assert.equal(path.edges.length, 1);
  assert.equal(shortestPath(graph, from, from).length, 0, "standing still costs nothing");
});

ok("a bend is measured along its legs, never across them", () => {
  const graph = joinSegments(BEND, 8);
  const along = pathLengthAlong(graph, { from: { x: 0, y: 0 }, to: { x: 100, y: 100 }, reach: 10 });
  close(along.along, 200, "100 down and 100 across");
  // The whole reason this exists: the straight line between the two ends is
  // ~141, and a party charged for that walked through the corner of a block.
  assert.ok(along.along > Math.hypot(100, 100));
  assert.equal(along.offRoadFrom, 0);
  assert.equal(along.offRoadTo, 0);
  assert.deepEqual(along.edges, [0, 1], "both legs named");
});

ok("two points on one leg are measured within it", () => {
  const graph = joinSegments(BEND, 8);
  // Neither end is a node, so no search over nodes would find this walk.
  const along = pathLengthAlong(graph, { from: { x: 20, y: 0 }, to: { x: 70, y: 0 }, reach: 10 });
  close(along.along, 50, "along one leg");
  assert.deepEqual(along.edges, [0]);
});

ok("stepping onto the lines reports the step separately", () => {
  const graph = joinSegments(BEND, 8);
  const along = pathLengthAlong(graph, { from: { x: 20, y: 25 }, to: { x: 100, y: 60 }, reach: 40 });
  close(along.offRoadFrom, 25, "the walk out to the street");
  close(along.offRoadTo, 0, "and none at the far end");
  close(along.along, 80 + 60, "along the first leg, round the corner, up the second");
});

ok("neither end near the lines is not a walk along them", () => {
  const graph = joinSegments(BEND, 8);
  // A party crossing open ground on a map that happens to have a street on it
  // is not on that street.
  assert.equal(
    pathLengthAlong(graph, { from: { x: 0, y: 300 }, to: { x: 300, y: 300 }, reach: 40 }),
    null,
  );
  // One end within reach IS enough — that is stepping off the road.
  assert.ok(pathLengthAlong(graph, { from: { x: 0, y: 10 }, to: { x: 300, y: 300 }, reach: 40 }));
});

ok("two networks that do not meet have no distance between them", () => {
  const graph = joinSegments([[0, 0, 100, 0], [0, 500, 100, 500]], 8);
  assert.equal(
    pathLengthAlong(graph, { from: { x: 10, y: 0 }, to: { x: 10, y: 500 }, reach: 10 }),
    null,
    "a bridge and a ford are two ways through, and neither reaches the other",
  );
});

ok("an empty network answers nothing rather than zero", () => {
  const graph = joinSegments([], 8);
  assert.equal(nearestOnGraph(graph, { x: 0, y: 0 }), null);
  assert.equal(pathLengthAlong(graph, { from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, reach: 10 }), null);
  assert.equal(shortestPath(graph, 0, 1), null);
});

ok("a far end makes the walk along LONGER than the straight line", () => {
  const graph = joinSegments(BEND, 8);
  // The fact a travel caller has to act on: with one end on the lines and the
  // other well off them, the legs are reported large enough to see, and the sum
  // exceeds the chord the party could simply have walked. The geometry answers
  // for one end on purpose (stepping onto a road, or off it); deciding that a
  // road was the ROUTE needs both ends, and this is why.
  const reach = 40;
  const walk = pathLengthAlong(graph, { from: { x: 0, y: 10 }, to: { x: 300, y: 300 }, reach });
  assert.ok(walk, "one end within reach still measures");
  assert.ok(walk.offRoadFrom <= reach, "the near end is on the lines");
  assert.ok(walk.offRoadTo > reach, "the far end is not, and says so");
  const straight = Math.hypot(300, 290);
  assert.ok(
    walk.along + walk.offRoadFrom + walk.offRoadTo > straight,
    "the sum beats the chord, so a caller charging it would overcharge",
  );
});

console.log("\ntest-wall-geometry: all " + passed + " checks passed");
