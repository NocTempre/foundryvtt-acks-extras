/**
 * A hex's sides, corners and middle, and the roads declared between them.
 *
 * No printed values at all — this is geometry and bookkeeping. What it pins is
 * the ruling: a road applies only ALONG a declared path, several unconnected
 * ways may cross one hex, and the bends cost distance the straight crossing
 * does not.
 */
import assert from "node:assert/strict";
import {
  NODE_KINDS, nodeId, parseNode, hexOf, makeLink, hasLink, withLink, withoutLink,
  hubs, connected, routeCost, onRoad,
} from "../scripts/battlemap/hex-topology.mjs";

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok   " + name); };

const S = (i, j, n) => nodeId(i, j, "side", n);
const C = (i, j, n) => nodeId(i, j, "corner", n);
const M = (i, j) => nodeId(i, j, "centre");

ok("a hex has six sides, six corners and one middle", () => {
  assert.deepEqual(Object.keys(NODE_KINDS), ["side", "corner", "centre"]);
  assert.equal(NODE_KINDS.side.count, 6);
  assert.equal(NODE_KINDS.corner.count, 6);
  assert.equal(NODE_KINDS.centre.count, 1);
});

ok("a node id names its hex, its kind and its place around it", () => {
  assert.equal(S(3, 4, 2), "3:4:s2");
  assert.equal(C(3, 4, 0), "3:4:c0");
  assert.equal(M(3, 4), "3:4:m0");
  assert.equal(nodeId(3, 4, "centre", 5), "3:4:m0", "a middle has no index to vary");
  // "corner" and "centre" both begin with c: sharing a prefix would make a
  // hex's middle and its first corner the same node.
  assert.notEqual(M(3, 4), C(3, 4, 0), "the middle is NOT the first corner");
  assert.equal(parseNode(M(3, 4)).kind, "centre");
  assert.equal(parseNode(C(3, 4, 0)).kind, "corner");
  assert.equal(nodeId(3, 4, "nose", 1), null);
});

ok("indices wrap the way a hex does", () => {
  assert.equal(S(0, 0, 6), "0:0:s0", "six sides round is back where you started");
  assert.equal(S(0, 0, -1), "0:0:s5", "and widdershins works too");
});

ok("a node reads back apart, and knows its hex", () => {
  assert.deepEqual(parseNode("3:4:s2"), { i: 3, j: 4, kind: "side", index: 2 });
  assert.equal(hexOf("3:4:s2"), "3:4", "matching the terrain layer's own cell key");
  assert.equal(parseNode("rubbish"), null);
  assert.equal(hexOf("rubbish"), null);
});

ok("a link is undirected, so a road runs both ways", () => {
  const there = makeLink(S(1, 1, 0), S(1, 1, 3));
  const back = makeLink(S(1, 1, 3), S(1, 1, 0));
  assert.deepEqual([there.a, there.b], [back.a, back.b], "ends sort, so identity is a compare");
  assert.equal(hasLink([there], back), true, "and a duplicate is caught either way round");
});

ok("a link refuses nonsense and refuses to loop", () => {
  assert.equal(makeLink("rubbish", S(1, 1, 0)), null);
  assert.equal(makeLink(S(1, 1, 0), S(1, 1, 0)), null, "a node does not connect to itself");
  assert.equal(makeLink(S(1, 1, 0), S(1, 1, 1), { winding: 0.2 }).winding, 1,
    "a link is never SHORTER than the crossing it replaces");
});

ok("adding replaces rather than duplicating; removing is exact", () => {
  let links = withLink([], makeLink(S(1, 1, 0), S(1, 1, 3), { road: "earth" }));
  links = withLink(links, makeLink(S(1, 1, 3), S(1, 1, 0), { road: "paved" }));
  assert.equal(links.length, 1, "the same two ends are one link");
  assert.equal(links[0].road, "paved", "and the later declaration wins");
  links = withoutLink(links, S(1, 1, 0), S(1, 1, 3));
  assert.deepEqual(links, []);
});

/* --- the ruling: several ways through one hex, and they need not meet ----- */
ok("a hex may hold two unconnected ways — a bridge and a ford", () => {
  const bridge = makeLink(S(2, 2, 0), S(2, 2, 3), { road: "paved" });
  const ford = makeLink(S(2, 2, 1), S(2, 2, 4), { road: "earth" });
  const links = withLink(withLink([], bridge), ford);
  const found = hubs(links);
  assert.equal(found.length, 2, "two hubs in one cell");
  assert.equal(connected(links, S(2, 2, 0), S(2, 2, 3)), true, "along the bridge");
  assert.equal(connected(links, S(2, 2, 0), S(2, 2, 1)), false, "but you cannot step across to the ford");
});

ok("a shared node joins two ways into one hub", () => {
  const a = makeLink(S(2, 2, 0), M(2, 2));
  const b = makeLink(M(2, 2), S(2, 2, 3));
  const links = withLink(withLink([], a), b);
  assert.equal(hubs(links).length, 1, "meeting in the middle is meeting");
  assert.equal(connected(links, S(2, 2, 0), S(2, 2, 3)), true);
});

/* --- the ruling: a road is followed, not possessed ------------------------ */
ok("being in a hex with a road is not being ON it", () => {
  const links = withLink([], makeLink(S(5, 5, 0), S(5, 5, 3), { road: "paved" }));
  assert.equal(onRoad(links, S(5, 5, 0), S(5, 5, 3)).on, true, "following it");
  assert.equal(onRoad(links, S(5, 5, 1), S(5, 5, 4)).on, false,
    "crossing the same hex another way earns nothing");
  assert.equal(onRoad(links, S(5, 5, 0), S(5, 5, 3)).road, "paved");
});

/* --- the ruling: bends cost distance -------------------------------------- */
ok("a straight run is taxed nothing", () => {
  const links = withLink([], makeLink(S(0, 0, 0), S(0, 0, 3), { winding: 1 }));
  const cost = routeCost(links, [S(0, 0, 0), S(0, 0, 3)]);
  assert.equal(cost.distance, 1);
  assert.equal(cost.tax, 0);
});

ok("a winding road is longer than the hex is wide, and says by how much", () => {
  let links = withLink([], makeLink(S(0, 0, 0), M(0, 0), { winding: 1.5, road: "earth" }));
  links = withLink(links, makeLink(M(0, 0), S(0, 0, 2), { winding: 1.5, road: "earth" }));
  const cost = routeCost(links, [S(0, 0, 0), M(0, 0), S(0, 0, 2)]);
  assert.equal(cost.distance, 3);
  assert.equal(cost.tax, 1, "two steps of 1.5 against two straight steps");
  assert.deepEqual(cost.roads, ["earth"]);
  // The tax is reported apart from what the road saves in speed: different
  // currencies, and netting them would hide the trade.
  assert.ok(!("multiplier" in cost));
});

ok("a route nobody could walk is not priced", () => {
  const links = withLink([], makeLink(S(0, 0, 0), S(0, 0, 3)));
  assert.equal(routeCost(links, [S(0, 0, 0), S(0, 0, 1)]), null, "no link, no price");
  assert.deepEqual(routeCost(links, [S(0, 0, 0)]), { hexes: 0, distance: 0, tax: 0, roads: [] });
});

ok("a route counts the hexes it actually crosses", () => {
  let links = withLink([], makeLink(S(0, 0, 3), S(0, 1, 0)));
  links = withLink(links, makeLink(S(0, 1, 0), S(0, 1, 3)));
  const cost = routeCost(links, [S(0, 0, 3), S(0, 1, 0), S(0, 1, 3)]);
  assert.equal(cost.hexes, 2, "two cells touched, not three steps");
});

console.log("\ntest-hex-topology: all " + passed + " checks passed");
