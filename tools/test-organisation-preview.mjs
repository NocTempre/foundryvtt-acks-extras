/**
 * Offline tests for what a Roll's panel shows before rolling (scripts/monsters/organisation-preview.mjs):
 * the choices a recipe can reach, what a Roll will make, and the slots a unit's row carries.
 * Every part, unit word and figure here is invented; the suite pins that nothing is rolled.
 *
 * Run: node tools/test-organisation-preview.mjs
 */
import assert from "node:assert/strict";
import { silentChoices, slotOptions, willMake } from "../scripts/monsters/organisation-preview.mjs";

const tests = [];
const t = (name, fn) => tests.push([name, fn]);

const RECIPE = [
  { key: "size-a", role: "unit", label: "Hold", when: { place: "wilderness", state: "lair", units: ["hold"] }, count: { dice: "2d4" } },
  { key: "guard", role: "guard", label: "Guards", cite: "XX p. 3", chance: 40, when: { units: ["hold"] }, count: { dice: "1d6" } },
  { key: "split-a", role: "body", label: "Archers", cite: "XX p. 4", count: { ratioOf: "unit", percent: 30 } },
  { key: "split-b", role: "body", label: "Specials", count: { ratioOf: "unit", percent: 70, round: "down" } },
  { key: "dep", role: "dependant", label: "Dependants", count: { percent: 20, ratioOf: "body" } },
  { key: "alt1", role: "captive", label: "Folk", branch: { group: "g1" }, count: { dice: "1d4" } },
  { key: "alt2", role: "captive", label: "Beasts", branch: { group: "g1" }, count: { literal: 2 } },
];
const ENCOUNTER = { wilderness: { lair: { noun: "Hold", number: "1d3", unit: "bands" } } };

t("the choices this recipe can reach are listed with their current pick, and a recipe with no split lists none of its", () => {
  const list = silentChoices({ recipe: RECIPE });
  assert.deepEqual(list.map((c) => c.key + (c.group ? `:${c.group}` : "")), ["unprintedRound", "loneSplit", "remainder", "branch:g1"]);
  assert.equal(list.find((c) => c.key === "unprintedRound").current, "nearest", "the evaluator's own default is shown");
  assert.deepEqual(list.at(-1).options.map((o) => o.label), ["Folk", "Beasts"]);
  assert.equal(list.at(-1).current, "alt1", "a group not named takes its first part");
  assert.deepEqual(silentChoices({ recipe: [RECIPE[0], RECIPE[1]] }), [], "nothing reachable, nothing asked");
  assert.equal(silentChoices({ recipe: [RECIPE[1]], rules: { troops: true } }).length, 3, "the troops rule makes its own shares");
});

t("a pick already made, in the choices recorded with an earlier roll, is the one shown", () => {
  const list = silentChoices({ recipe: RECIPE, chosen: { unprintedRound: "up", branch: { g1: "alt2" } } });
  assert.equal(list.find((c) => c.key === "unprintedRound").current, "up");
  assert.equal(list.find((c) => c.group === "g1").current, "alt2");
  assert.equal(silentChoices({ recipe: RECIPE, chosen: { branch: { g1: "nope" } } }).find((c) => c.group === "g1").current, "alt1");
});

t("what a Roll will make is read from the parts as expressions and page references, rolls nothing and lists only the branch chosen", () => {
  const real = Math.random;
  Math.random = () => {
    throw new Error("a die was thrown");
  };
  try {
    const out = willMake({ recipe: RECIPE, encounter: ENCOUNTER, context: "wilderness", state: "lair" });
    assert.equal(out.line.noun, "hold", "the corrected size part stands in for the imported line");
    assert.equal(out.line.number, "2d4");
    assert.deepEqual(out.rows.map((r) => r.key), ["guard", "split-a", "split-b", "dep", "alt1"], "size parts stand in the line, a branch lists its chosen part only");
    assert.deepEqual(out.rows[0], { key: "guard", role: "guard", label: "Guards", formula: "1d6", chance: 40, cite: "XX p. 3", perUnit: "" });
    assert.equal(out.rows.find((r) => r.key === "dep").formula, "20%", "a share is shown as its percentage, not a thrown number");
    assert.equal(willMake({ recipe: RECIPE, encounter: ENCOUNTER, chosen: { branch: { g1: "alt2" } } }).rows.at(-1).formula, "2");
    assert.equal(willMake({ recipe: RECIPE, encounter: ENCOUNTER, state: "chance" }).line.noun, "hold", "the chance state reads the lair line");
    assert.equal(willMake({ recipe: RECIPE, encounter: ENCOUNTER, context: "dungeon", state: "wandering" }).line, null, "a line the import did not read is blank");
  } finally {
    Math.random = real;
  }
});

t("a troop pick is offered only where the troops rule is on and the unit's share is the special one", () => {
  const share = slotOptions({ recipe: RECIPE, troops: true, share: "special" });
  assert.deepEqual(share.shares.map((s) => s.key), ["split-a", "split-b"]);
  assert.equal(share.troopApplies, true);
  assert.equal(slotOptions({ recipe: RECIPE, troops: false, share: "special" }).troopApplies, false, "the troops rule off: the pick would be ignored");
  assert.equal(slotOptions({ recipe: RECIPE, troops: true, share: "archers" }).troopApplies, false, "another share: ignored");
  assert.equal(slotOptions({ recipe: RECIPE, troops: true }).troopApplies, false, "no share chosen yet");
});

let failures = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`ok    ${name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL  ${name}\n      ${err.message}`);
  }
}
console.log(`\ntest-organisation-preview: ${tests.length - failures}/${tests.length} passed`);
if (failures) process.exit(1);
