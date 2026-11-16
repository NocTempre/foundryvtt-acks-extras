/**
 * Swimming: the procedure runs on whatever the `formation` document holds and
 * names the missing figure when it holds nothing. Every figure here is invented;
 * the printed ones arrive through the importer.
 */
import assert from "node:assert/strict";
import { registerTable, resetTables, PRIORITY } from "../scripts/lib/tables.mjs";
import { FORMATION_DOC } from "../scripts/formation/constants.mjs";
import { holdsSwimming, partySwim, swimmingThrow } from "../scripts/formation/swimming.mjs";

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok   " + name); };

/** Invented figures for the registered swimming magnitudes. */
const FIGURES = { swimmingBonus: 7, swimWaterModifiers: { calm: 0, cold: -11, rough: -13 }, breathRounds: 17, sinkFeetPerStone: 19 };

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

ok("water prices the target: a penalty is stored negative and raises it", () => {
  load();
  assert.equal(swimmingThrow({ encumbrance: 5, proficient: true, water: "cold" }).target, 5 - 7 + 11);
  assert.equal(swimmingThrow({ encumbrance: 5, water: "rough" }).target, 5 + 13);
  resetTables();
});

ok("a figure not imported is named, and neither needed nor skipped", () => {
  resetTables();
  const holder = swimmingThrow({ encumbrance: 0, proficient: true });
  assert.equal(holder.needed, null);
  assert.deepEqual(holder.unknown, ["swimmingBonus"]);
  const rough = swimmingThrow({ encumbrance: 0, water: "rough" });
  assert.equal(rough.needed, null);
  assert.deepEqual(rough.unknown, ["swimWaterModifiers"]);
  // Calm water needs no import, and a non-holder at nothing still throws.
  const calm = swimmingThrow({ encumbrance: 0 });
  assert.equal(calm.needed, true);
  assert.deepEqual(calm.unknown, []);
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

console.log(`test-swimming: all ${passed} checks passed`);
