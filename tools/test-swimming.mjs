/**
 * Swimming: the procedure runs on whatever the `formation` document holds and
 * names the missing figure when it holds nothing. Every figure here is invented;
 * the printed ones arrive through the importer.
 */
import assert from "node:assert/strict";
import { registerTable, resetTables, PRIORITY } from "../scripts/lib/tables.mjs";
import { FORMATION_DOC } from "../scripts/formation/constants.mjs";
import { WATER, holdsSwimming, partySwim, swimmingThrow, waterPenaltyAllowed, waterPenaltySteps } from "../scripts/formation/swimming.mjs";

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok   " + name); };

/** Invented figures for the registered swimming magnitudes. */
const FIGURES = { swimmingBonus: 7, swimWaterPenaltySteps: [13, 11], breathRounds: 17, sinkFeetPerStone: 19 };

const load = (tables = FIGURES) => registerTable(
  { id: FORMATION_DOC, source: "invented", tables },
  { priority: PRIORITY.WORLD, source: "test" },
);

ok("a holder whose target is nothing needs no throw", () => {
  load();
  const got = swimmingThrow({ encumbrance: 2, proficient: true });
  assert.equal(got.target, -5);
  assert.equal(got.needed, false);
  resetTables();
});

ok("a non-holder whose target is nothing still throws", () => {
  load();
  for (const encumbrance of [0, 2]) {
    const got = swimmingThrow({ encumbrance, proficient: false });
    assert.equal(got.needed, true, `stone ${encumbrance}`);
    assert.equal(got.target, encumbrance, `stone ${encumbrance}`);
  }
  // Leaving the input out is the same as not holding.
  assert.equal(swimmingThrow({ encumbrance: 0 }).needed, true);
  resetTables();
});

ok("a target above nothing is a throw for anyone", () => {
  load();
  assert.equal(swimmingThrow({ encumbrance: 9, proficient: true }).needed, true);
  assert.equal(swimmingThrow({ encumbrance: 9, proficient: false }).needed, true);
  resetTables();
});

ok("the conditions are three keys; calm is none ticked", () => {
  assert.deepEqual(Object.keys(WATER).sort(), ["cold", "fast", "rough"]);
});

ok("the imported steps read back in printed order, unsorted", () => {
  load();
  assert.deepEqual(waterPenaltySteps(), [13, 11]);
  resetTables();
});

ok("a chosen imported step raises the target and names its reason", () => {
  load();
  const [first, second] = waterPenaltySteps();
  const got = swimmingThrow({ encumbrance: 5, proficient: true, penalty: second, conditions: ["cold", "fast"] });
  assert.equal(got.target, 5 - 7 + 11);
  assert.deepEqual(got.conditions, ["cold", "fast"]);
  assert.deepEqual(got.parts.find((p) => p.key === "water"), { key: "water", value: -11, conditions: ["cold", "fast"] });
  assert.equal(swimmingThrow({ encumbrance: 5, penalty: first, conditions: ["rough"] }).target, 5 + 13);
  resetTables();
});

ok("a larger typed figure prices the throw as a step does", () => {
  load();
  const got = swimmingThrow({ encumbrance: 5, proficient: true, penalty: 20, conditions: ["rough"] });
  assert.equal(got.target, 5 - 7 + 20);
  assert.deepEqual(got.unknown, []);
  // A size is a size whatever sign it was typed with.
  assert.equal(swimmingThrow({ encumbrance: 5, penalty: -20 }).target, 25);
  resetTables();
});

ok("no penalty is no water term; a stray condition key is not a reason", () => {
  load();
  const got = swimmingThrow({ encumbrance: 5, conditions: ["cold", "cold", "bogus"] });
  assert.equal(got.target, 5);
  assert.deepEqual(got.conditions, ["cold"]);
  assert.equal(got.parts.some((p) => p.key === "water"), false);
  for (const penalty of [0, null, "x", NaN]) assert.equal(swimmingThrow({ encumbrance: 5, penalty }).target, 5);
  resetTables();
});

ok("a figure not imported is named, and neither needed nor skipped", () => {
  resetTables();
  const holder = swimmingThrow({ encumbrance: 0, proficient: true });
  assert.equal(holder.needed, null);
  assert.deepEqual(holder.unknown, ["swimmingBonus"]);
  // The steps are not what a throw needs: the Judge's figure is passed in.
  const typed = swimmingThrow({ encumbrance: 0, penalty: 8, conditions: ["rough"] });
  assert.equal(typed.needed, true);
  assert.equal(typed.target, 8);
  assert.deepEqual(typed.unknown, []);
  // A non-holder at nothing still throws.
  const calm = swimmingThrow({ encumbrance: 0 });
  assert.equal(calm.needed, true);
  assert.deepEqual(calm.unknown, []);
});

ok("with nothing imported the steps are null, and an empty or malformed list is null", () => {
  resetTables();
  assert.equal(waterPenaltySteps(), null);
  load({ swimWaterPenaltySteps: [] });
  assert.equal(waterPenaltySteps(), null);
  resetTables();
  load({ swimWaterPenaltySteps: "6, 11" });
  assert.equal(waterPenaltySteps(), null);
  resetTables();
});

ok("a penalty is allowed as none, an imported step or a figure above every step, whatever its sign", () => {
  load();
  for (const penalty of [0, null, "x", 13, 11, -11, 14, 99]) assert.equal(waterPenaltyAllowed(penalty).ok, true, String(penalty));
  assert.deepEqual(waterPenaltyAllowed(-11), { ok: true, size: 11, reason: null });
  for (const penalty of [1, 10, 12, 12.5]) assert.deepEqual(waterPenaltyAllowed(penalty), { ok: false, size: penalty, reason: "size" }, String(penalty));
  resetTables();
});

ok("with the steps not imported any size is allowed, there being no step to fall short of", () => {
  resetTables();
  assert.deepEqual(waterPenaltyAllowed(5), { ok: true, size: 5, reason: null });
  load({ swimWaterPenaltySteps: [] });
  assert.equal(waterPenaltyAllowed(5).ok, true);
  resetTables();
});

ok("a hand-made ability of that name makes a holder", () => {
  const withAbility = { items: [{ type: "ability", name: "Swimming" }] };
  const without = { items: [{ type: "ability", name: "Climbing" }] };
  assert.equal(holdsSwimming(withAbility), true);
  assert.equal(holdsSwimming(without), false);
  assert.equal(holdsSwimming(null), false);
});

ok("a party row says whether it holds the proficiency, or its actor does", () => {
  load();
  const rows = partySwim([
    { name: "A", encumbrance: 2, proficient: true },
    { name: "B", encumbrance: 2, proficient: false },
    { name: "C", encumbrance: 2, actor: { items: [{ type: "ability", name: "Swimming" }] } },
    { name: "D", encumbrance: 2 },
  ]);
  assert.deepEqual(rows.map((r) => r.needed), [false, true, false, true]);
  resetTables();
});

ok("a party row takes the one water every member swims in", () => {
  load();
  const rows = partySwim([{ name: "A", encumbrance: 2, proficient: true }, { name: "B", encumbrance: 2 }], { penalty: 9, conditions: ["fast"] });
  assert.deepEqual(rows.map((r) => r.target), [2 - 7 + 9, 2 + 9]);
  assert.deepEqual(rows.map((r) => r.conditions), [["fast"], ["fast"]]);
  resetTables();
});

ok("the Judge's modifier moves the target and never whether a holder throws", () => {
  load();
  const got = swimmingThrow({ encumbrance: 9, proficient: true, judgeMod: 3 });
  assert.equal(got.target, 9 - 7 - 3);
  assert.deepEqual(got.parts.at(-1), { key: "judge", value: 3 });
  const low = swimmingThrow({ encumbrance: 2, proficient: true, judgeMod: -20 });
  assert.equal(low.needed, false, "a holder whose bare target is nothing needs no throw, whatever the Judge adds");
  assert.equal(swimmingThrow({ encumbrance: 4 }).parts.some((p) => p.key === "judge"), false, "no modifier, no part");
  resetTables();
});

console.log(`test-swimming: all ${passed} checks passed`);
