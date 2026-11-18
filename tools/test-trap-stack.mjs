/**
 * Traps stack: the order a move's traps are met in, and which of them stop the
 * party. Pure functions over stand-in placements; no Foundry, no world. The
 * live half (cards, the halt, the dice) is walked in a world.
 */
import assert from "node:assert/strict";
import { stackStops, trapStack, walkTrapStack } from "../scripts/formation/trap-rules.mjs";
import { behaviorsUnder } from "../scripts/lib/regions.mjs";
import { mockRegion, rect } from "./region-fixture.mjs";

let passed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    passed++;
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
};

const wall = (uuid, t) => ({ placement: { kind: "wall", uuid }, haltAt: { x: t * 100, y: 0, t }, approach: { x: 0, y: 0 }, t });
const zone = (uuid) => ({ kind: "zone", uuid });
const uuids = (stack) => stack.map((entry) => entry.placement.uuid);

/** Walk a stack whose traps each answer as scripted, noting which were resolved. */
const walk = async (stack, answers) => {
  const met = [];
  const results = await walkTrapStack(stack, async ({ placement }) => {
    met.push(placement.uuid);
    return answers[placement.uuid] ?? { outcome: "crossed" };
  });
  return { met, results };
};

await test("walls come before zones, and two walls are ordered by distance along the path", () => {
  const stack = trapStack({ walls: [wall("far", 0.8), wall("near", 0.2)], zones: [zone("zone-a")] });
  assert.deepEqual(uuids(stack), ["near", "far", "zone-a"]);
  assert.deepEqual(stack[0].haltAt, { x: 20, y: 0, t: 0.2 }, "a wall keeps its own halt point");
  assert.deepEqual(stack[0].approach, { x: 0, y: 0 });
  assert.equal(stack[2].haltAt, null, "a zone halts nothing");
  assert.equal(stack[2].approach, null);
});

await test("two walls at one point keep the scene's order", () => {
  assert.deepEqual(uuids(trapStack({ walls: [wall("first", 0.5), wall("second", 0.5)] })), ["first", "second"]);
});

await test("a move with nothing armed has an empty stack", () => {
  assert.deepEqual(trapStack(), []);
  assert.deepEqual(trapStack({ walls: [], zones: [] }), []);
});

await test("one region with two trap behaviors yields two placements, each its own", () => {
  const trapType = "acks-extras.trapZone";
  const region = mockRegion({
    id: "twin",
    rings: [rect(0, 0, 100, 100)],
    behaviors: [
      { type: trapType, disabled: false, uuid: "twin.a" },
      { type: trapType, disabled: false, uuid: "twin.b" },
    ],
  });
  const token = { parent: { regions: [region] }, regions: new Set([region]) };
  const zones = behaviorsUnder(token, trapType).map(({ behavior }) => zone(behavior.uuid));
  assert.deepEqual(uuids(trapStack({ zones })), ["twin.a", "twin.b"]);
});

await test("two zones both resolve: a sprung zone does not stop the next", async () => {
  const stack = trapStack({ zones: [zone("a"), zone("b")] });
  const { met, results } = await walk(stack, { a: { outcome: "sprung" }, b: { outcome: "crossed" } });
  assert.deepEqual(met, ["a", "b"]);
  assert.deepEqual(results.map((r) => r.outcome), ["sprung", "crossed"]);
});

await test("a found zone does not stop the next either", async () => {
  const { met } = await walk(trapStack({ zones: [zone("a"), zone("b")] }), { a: { outcome: "found" } });
  assert.deepEqual(met, ["a", "b"]);
});

await test("a halting wall before a zone stops the zone", async () => {
  for (const outcome of ["sprung", "found"]) {
    const stack = trapStack({ walls: [wall("w", 0.5)], zones: [zone("z")] });
    const { met, results } = await walk(stack, { w: { outcome } });
    assert.deepEqual(met, ["w"], `a wall that answers ${outcome} ends the walk there`);
    assert.deepEqual(results.map((r) => r.outcome), [outcome]);
  }
});

await test("a halting wall stops every later wall, too", async () => {
  const stack = trapStack({ walls: [wall("late", 0.9), wall("early", 0.1)], zones: [zone("z")] });
  const { met } = await walk(stack, { early: { outcome: "sprung" } });
  assert.deepEqual(met, ["early"]);
});

await test("a crossed wall continues to the next trap", async () => {
  const stack = trapStack({ walls: [wall("w1", 0.3), wall("w2", 0.6)], zones: [zone("z")] });
  const { met, results } = await walk(stack, { w1: { outcome: "crossed" }, w2: { outcome: "crossed" }, z: { outcome: "sprung" } });
  assert.deepEqual(met, ["w1", "w2", "z"]);
  assert.deepEqual(results.map((r) => r.outcome), ["crossed", "crossed", "sprung"]);
});

await test("a wall left to the Judge's hand does not halt the party", async () => {
  const stack = trapStack({ walls: [wall("w", 0.5)], zones: [zone("z")] });
  const { met } = await walk(stack, { w: { outcome: "byHand" } });
  assert.deepEqual(met, ["w", "z"]);
});

await test("a trap with no document answers nothing and the walk goes on", async () => {
  const stack = trapStack({ walls: [wall("w", 0.5)], zones: [zone("z")] });
  const met = [];
  const results = await walkTrapStack(stack, async ({ placement }) => {
    met.push(placement.uuid);
    return placement.uuid === "w" ? null : { outcome: "crossed" };
  });
  assert.deepEqual(met, ["w", "z"]);
  assert.deepEqual(results.map((r) => r.outcome), ["crossed"], "no result is made for the empty answer");
});

await test("stackStops is a wall's found or sprung, and nothing else", () => {
  assert.equal(stackStops({ outcome: "found" }, { kind: "wall" }), true);
  assert.equal(stackStops({ outcome: "sprung" }, { kind: "wall" }), true);
  assert.equal(stackStops({ outcome: "crossed" }, { kind: "wall" }), false);
  assert.equal(stackStops({ outcome: "byHand" }, { kind: "wall" }), false);
  assert.equal(stackStops({ outcome: "sprung" }, { kind: "zone" }), false);
  assert.equal(stackStops({ outcome: "found" }, { kind: "zone" }), false);
  assert.equal(stackStops(null, { kind: "wall" }), false);
});

console.log(`test-trap-stack: OK (${passed} checks — wall then zone order, distance order, two behaviors in one region, zones that do not halt, walls that do)`);
