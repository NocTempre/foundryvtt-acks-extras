/**
 * Water too deep to stand in. Pure functions; no Foundry, no world.
 */
import assert from "node:assert";
import {
  WATER,
  SWIMMING_BONUS,
  swimmingThrow,
  swimSpeed,
  drowning,
  rescueStone,
  partySwim,
} from "../scripts/formation/swimming.mjs";

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; } catch (err) { console.error(`FAIL ${name}`); throw err; }
};

test("the target is what you are carrying", () => {
  assert.equal(swimmingThrow({ encumbrance: 8 }).target, 8);
  assert.equal(swimmingThrow({ encumbrance: 3 }).target, 3);
});

test("a swimmer carrying nothing does not roll at all", () => {
  const naked = swimmingThrow({ encumbrance: 0 });
  assert.equal(naked.needed, false);
  // And neither does one whose proficiency covers what they carry.
  assert.equal(swimmingThrow({ encumbrance: 4, proficient: true }).needed, false);
  assert.equal(swimmingThrow({ encumbrance: 3, proficient: true }).target, -1);
});

test("knowing how to swim is worth four", () => {
  assert.equal(SWIMMING_BONUS, 4);
  assert.equal(swimmingThrow({ encumbrance: 10, proficient: true }).target, 6);
});

test("cold and rough water make the throw harder, not easier", () => {
  assert.equal(WATER.cold.modifier, -2);
  assert.equal(WATER.rough.modifier, -4);
  assert.equal(swimmingThrow({ encumbrance: 6, water: "cold" }).target, 8);
  assert.equal(swimmingThrow({ encumbrance: 6, water: "rough" }).target, 10);
  // Proficiency and rough water pull in opposite directions and both land.
  assert.equal(swimmingThrow({ encumbrance: 6, water: "rough", proficient: true }).target, 6);
});

test("a swimmer makes a quarter of their speed", () => {
  assert.equal(swimSpeed(120), 30);
  assert.equal(swimSpeed(0), 0);
});

test("breath is Constitution's and the sink rate is encumbrance's", () => {
  assert.equal(drowning({ conMod: 0, encumbrance: 4 }).rounds, 5);
  assert.equal(drowning({ conMod: 2, encumbrance: 4 }).rounds, 7);
  assert.equal(drowning({ conMod: 0, encumbrance: 4 }).feetPerRound, 40);
  // The heavy swimmer ends up deeper, which is why a late rescue cannot reach them.
  assert.ok(drowning({ conMod: 0, encumbrance: 8 }).depthAtDeath > drowning({ conMod: 0, encumbrance: 2 }).depthAtDeath);
});

test("a bad Constitution never takes the breath below one round", () => {
  assert.equal(drowning({ conMod: -9, encumbrance: 1 }).rounds, 1);
});

test("a rescuer lifts the whole body and half its baggage", () => {
  assert.equal(rescueStone(0), 7.5);
  assert.equal(rescueStone(5), 10);
});

test("the party is read before anyone enters the water", () => {
  const rows = partySwim(
    [
      { name: "Naked", encumbrance: 0, conMod: 0 },
      { name: "Mailed", encumbrance: 9, conMod: 0 },
      { name: "Sailor", encumbrance: 5, proficient: true, conMod: 1 },
    ],
    "cold",
  );
  // Cold water gives even an unencumbered swimmer something to make: the
  // penalty applies to everyone, not only to those already struggling.
  assert.equal(rows[0].target, 2);
  assert.equal(rows[0].needed, true);
  assert.equal(rows[1].target, 11); // 9 encumbrance, +2 for the cold
  assert.equal(rows[2].target, 3); // 5 - 4 proficient + 2 cold
  assert.equal(rows[1].ifDrowning.feetPerRound, 90);
});

console.log(`test-swimming: OK (${passed} checks — target, proficiency, water, pace, drowning, rescue)`);
