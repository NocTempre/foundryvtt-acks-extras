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

ok("a side street ending on an avenue makes a junction node", () => {
  // The T: a stem whose END lands mid-span of the avenue. Neither line has an
  // endpoint the other shares, so noding the ends alone leaves two networks.
  const graph = joinSegments([[0, 0, 1000, 0], [500, 500, 500, 0]], 10);
  const junction = graph.nodes.findIndex((n) => n.x === 500 && n.y === 0);
  // NOT merely that a node sits there — the stem's own endpoint is one whether
  // the avenue was ever cut or not. What proves the junction is that THREE
  // edges meet at it: the stem, and the avenue either side.
  assert.equal(graph.nodes[junction]?.edges.length, 3, "the avenue is cut, and the stem joins it");
  assert.equal(graph.edges.length, 3, "the avenue is cut in two, the stem stays whole");
  const walk = pathLengthAlong(graph, {
    from: { x: 500, y: 250 }, to: { x: 100, y: 0 }, reach: 100,
  });
  // 250 down the stem to the junction, then 400 back along the avenue.
  close(walk.along, 650, "down the side street and along the avenue");
  assert.equal(walk.offRoadFrom, 0);
  assert.equal(walk.offRoadTo, 0);
});

ok("a stem that STARTS on the avenue joins it too", () => {
  // The same T drawn the other way round. The trap crossing rule refuses `t <= 0`
  // — a mover starting on a line has not crossed it — and that refusal must not
  // reach the junction test, or half of every drawn T is dropped.
  const graph = joinSegments([[0, 0, 1000, 0], [500, 0, 500, 500]], 10);
  assert.ok(graph.nodes.some((n) => n.x === 500 && n.y === 0), "still one junction");
  close(
    pathLengthAlong(graph, { from: { x: 500, y: 250 }, to: { x: 100, y: 0 }, reach: 100 }).along,
    650,
    "and the same walk",
  );
});

ok("two streets crossing meet where they cross", () => {
  // The X: no endpoint anywhere near the crossing, so the point itself has to
  // become a node or the two streets never meet.
  const graph = joinSegments([[0, 0, 1000, 0], [500, -500, 500, 500]], 10);
  assert.ok(graph.nodes.some((n) => n.x === 500 && n.y === 0), "the crossing is a node");
  assert.equal(graph.edges.length, 4, "each street cut in two");
  close(
    pathLengthAlong(graph, { from: { x: 500, y: 250 }, to: { x: 100, y: 0 }, reach: 100 }).along,
    650,
    "up to the crossing and away along the other street",
  );
});

ok("two OBLIQUE streets crossing meet where they cross", () => {
  // An X at an angle to the grid, which is the shape an axis-aligned case
  // cannot stand in for: a horizontal line fills a whole row of the pairing
  // index and a vertical one a whole column, so such a pair shares a cell of
  // that index however it is built. Two oblique lines share one only if the
  // index covers every cell each line TRAVERSES.
  const avenue = [270, 271, 2190, 1711];
  const street = [1343, -103, 1117, 2085];
  const graph = joinSegments([avenue, street], 10);
  const junction = graph.nodes.findIndex((n) => Math.abs(n.x - 1230) < 1 && Math.abs(n.y - 991) < 1);
  assert.ok(junction >= 0, "the oblique crossing is a node");
  assert.equal(graph.nodes[junction].edges.length, 4, "and both streets are cut at it");
  assert.equal(graph.edges.length, 4, "two halves each");
  const walk = pathLengthAlong(graph, {
    from: { x: avenue[0], y: avenue[1] }, to: { x: street[2], y: street[3] }, reach: 10,
  });
  assert.ok(walk, "so a distance across the pair exists at all");
  // Half the avenue then half the street. The chord is ~2002 — shorter, which
  // is what a caller reports when the walk comes back null.
  close(walk.along, 1200 + 1099.8204398900758, "along one street and away down the other");
  assert.ok(walk.along > Math.hypot(street[2] - avenue[0], street[3] - avenue[1]) + 200);
});

ok("an OBLIQUE side street ending on an avenue makes a junction", () => {
  // The T at an angle: the stem's end lands at (1000, 800), mid-span of an
  // avenue that has no endpoint anywhere near it.
  const graph = joinSegments([[200, 200, 1800, 1400], [1000, 800, 1400, 200]], 10);
  const junction = graph.nodes.findIndex((n) => n.x === 1000 && n.y === 800);
  assert.equal(graph.nodes[junction]?.edges.length, 3, "the avenue is cut, and the stem joins it");
  assert.equal(graph.edges.length, 3, "two halves of the avenue and the whole stem");
  const walk = pathLengthAlong(graph, {
    from: { x: 1400, y: 200 }, to: { x: 200, y: 200 }, reach: 10,
  });
  // 721.11 down the stem, then 1000 along the avenue; the chord is 1200.
  close(walk.along, 721.1102550927978 + 1000, "down the side street and along the avenue");
});

ok("how the net was DRAWN does not change the net", () => {
  // Two parallel avenues joined by ONE cross street that meets each of them
  // mid-span. Drawn whole, the only link between the avenues is that pair of
  // T-junctions; drawn as the four block faces a Judge drags, every junction is
  // an endpoint. The two must be the same network, and the whole-drawn one is
  // the shape that had no route at all.
  const whole = joinSegments([[0, 0, 200, 0], [0, 100, 200, 100], [100, 0, 100, 100]], 8);
  const dragged = joinSegments([
    [0, 0, 100, 0], [100, 0, 200, 0], [0, 100, 100, 100], [100, 100, 200, 100],
    [100, 0, 100, 100],
  ], 8);
  assert.equal(whole.nodes.length, dragged.nodes.length, "same six corners and junctions");
  assert.equal(whole.edges.length, dragged.edges.length, "same five spans between them");
  const trip = (g) => pathLengthAlong(g, { from: { x: 200, y: 0 }, to: { x: 0, y: 100 }, reach: 8 });
  close(trip(whole).along, trip(dragged).along, "the same walk either way");
  // 100 west to the junction, 100 down the cross street, 100 west again. The
  // chord is ~224, which is what a caller falls back to when the walk is null.
  close(trip(whole).along, 300, "along the avenue, down the street, along again");
});

ok("the pieces of one wall share the one meta object", () => {
  // A consumer naming the roads a route used dedupes on `meta`, because the
  // edge indices of one drawn wall are now several.
  const avenue = { c: [0, 0, 1000, 0], surface: "paved", street: "Kings Way" };
  const graph = joinSegments([avenue, [500, 500, 500, 0]], 10);
  const pieces = graph.edges.filter((e) => e.meta === avenue);
  assert.equal(pieces.length, 2, "cut at the junction");
  close(pieces[0].length + pieces[1].length, 1000, "and no length invented or lost");
  assert.equal(new Set(pieces.map((e) => e.meta)).size, 1, "one object, not a copy each");
});

ok("a segment shorter than the tolerance is no edge at all", () => {
  const graph = joinSegments([[0, 0, 100, 0], [100, 0, 103, 0]], 8);
  assert.equal(graph.edges.length, 1, "a self-loop of no length is not a step");
});

ok("the stub is no edge, but its node still cuts the street it sits on", () => {
  // The dropped stub's ends merge to ONE node, and that node is a real point of
  // the avenue, so the avenue is two edges either side of it rather than one.
  // The total walk is unchanged; the edge COUNT is not, which is why a consumer
  // naming the roads a route used dedupes on `meta`.
  const avenue = { c: [0, 0, 1000, 0], street: "Kings Way" };
  const graph = joinSegments([avenue, [500, 0, 503, 0]], 8);
  const pieces = graph.edges.filter((e) => e.meta === avenue);
  assert.equal(pieces.length, 2, "cut where the stub sits");
  close(pieces[0].length, 500, "half");
  close(pieces[1].length, 500, "and half");
  close(
    pathLengthAlong(graph, { from: { x: 0, y: 0 }, to: { x: 1000, y: 0 }, reach: 8 }).along,
    1000,
    "and the walk over it is the whole street",
  );
});

ok("a span of no length is kept where it is the only join", () => {
  // Two side streets ending on OPPOSITE flanks of an avenue, each within the
  // tolerance of it and 14 apart from each other — so two distinct nodes that
  // project to one point of the avenue. The span between them has zero length
  // and is emitted anyway: it is the whole of what ties the avenue's two halves
  // together, and dropping it would sever the street at exactly the place the
  // planarization exists to join.
  const graph = joinSegments([
    [0, 0, 1000, 0],
    [500, -400, 500, -7],
    [500, 7, 500, 400],
  ], 10);
  const zero = graph.edges.filter((e) => e.length < 1e-9);
  assert.equal(zero.length, 1, "one span of no length, between two distinct nodes");
  assert.notEqual(zero[0].a, zero[0].b, "never a self-loop");
  // Walk the whole avenue across it, and from one side street to the other.
  close(
    pathLengthAlong(graph, { from: { x: 0, y: 0 }, to: { x: 1000, y: 0 }, reach: 10 }).along,
    1000,
    "the avenue is still one street end to end",
  );
  close(
    pathLengthAlong(graph, {
      from: { x: 500, y: -400 }, to: { x: 500, y: 400 }, reach: 10,
    }).along,
    786,
    "and the two side streets meet across it, adding nothing",
  );
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
