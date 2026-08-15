/**
 * Naming a published LADDER from a progression target.
 *
 * The registry needs `game` only to list class ITEMS; the ladder path reads
 * the published tables instead, so it runs here against a registered doc with
 * no world at all.
 */
import assert from "node:assert/strict";
import { registerTable, unregisterTable, PRIORITY } from "../scripts/lib/tables.mjs";

globalThis.game ??= { items: [] };
const { ladderValue, laddersOf, resolveLevelValue } = await import("../scripts/classes/registry.mjs");

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; } catch (err) { console.error(`FAIL ${name}`); throw err; }
};

const DOC = {
  id: "acks.class.thief",
  source: { book: "rr" },
  tables: {
    "ladder.climbWalls": [
      { atLevel: 1, value: 6 },
      { atLevel: 4, value: 5 },
      { atLevel: 7, value: 4 },
    ],
    "ladder.hideInShadows": [{ atLevel: 1, value: 19 }],
  },
};
registerTable(DOC, { priority: PRIORITY.WORLD, source: "test" });

test("a rung holds until the next one is reached", () => {
  assert.equal(ladderValue("thief", "climbWalls", "full", 1), 6);
  assert.equal(ladderValue("thief", "climbWalls", "full", 3), 6); // still the rung climbed at 1
  assert.equal(ladderValue("thief", "climbWalls", "full", 4), 5);
  assert.equal(ladderValue("thief", "climbWalls", "full", 6), 5); // NOT back to 6
  assert.equal(ladderValue("thief", "climbWalls", "full", 99), 4);
});

test("a fraction of level reads the ladder at the reduced level", () => {
  // Half of 8 is 4, so the rung at 4.
  assert.equal(ladderValue("thief", "climbWalls", "half", 8), 5);
  // Half of 14 is 7.
  assert.equal(ladderValue("thief", "climbWalls", "half", 14), 4);
});

test("rounding is the rule's own, and up by default", () => {
  // Half of 7 is 3.5: up reaches rung 4, down stays on rung 1.
  assert.equal(ladderValue("thief", "climbWalls", "half", 7, "up"), 5);
  assert.equal(ladderValue("thief", "climbWalls", "half", 7, "down"), 6);
});

test("an unpublished class or ladder resolves to nothing, never to a guess", () => {
  assert.equal(ladderValue("mage", "climbWalls", "full", 5), null);
  assert.equal(ladderValue("thief", "pickPockets", "full", 5), null);
  assert.equal(ladderValue("", "climbWalls", "full", 5), null);
});

test("a picker can ask what a class publishes", () => {
  assert.deepEqual(laddersOf("thief").sort(), ["climbWalls", "hideInShadows"]);
  assert.deepEqual(laddersOf("mage"), []);
});

test("naming a table reads the ladder; naming none keeps the old meaning", () => {
  const ladder = resolveLevelValue({ kind: "progression", as: "thief", table: "climbWalls" }, 4);
  assert.equal(ladder, 5);
  // No table named: the attack path, which needs class ITEMS this test has none
  // of — so it resolves to null rather than silently reading a ladder.
  assert.equal(resolveLevelValue({ kind: "progression", as: "thief" }, 4), null);
});

unregisterTable(DOC.id, { priority: PRIORITY.WORLD });
console.log(`test-ladders: OK (${passed} checks — rungs hold, fractions, rounding, unpublished, picker)`);
