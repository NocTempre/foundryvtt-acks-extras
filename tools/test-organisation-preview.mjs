/**
 * Offline tests for what a Roll's panel shows before rolling (scripts/monsters/organisation-preview.mjs):
 * the choices a recipe can reach, what a Roll will make, and the slots a unit's row carries.
 * Every part, unit word and figure here is invented; the suite pins that nothing is rolled.
 *
 * Run: node tools/test-organisation-preview.mjs
 */
import assert from "node:assert/strict";
import { evaluateRecipe, reachedWords, walk } from "../scripts/monsters/encounter-recipe.mjs";
import { silentChoices, slotOptions, slotUnit, willMake } from "../scripts/monsters/organisation-preview.mjs";

const tests = [];
const t = (name, fn) => tests.push([name, fn]);

const RECIPE = [
  { key: "size-a", role: "unit", label: "Hold", source: { name: "bands" }, when: { place: "wilderness", state: "lair", units: ["hold"] }, count: { dice: "2d4" } },
  { key: "guard", role: "guard", label: "Guards", cite: "XX p. 3", chance: 40, when: { units: ["hold"] }, count: { dice: "1d6" } },
  { key: "split-a", role: "body", label: "Archers", cite: "XX p. 4", when: { units: ["band"] }, count: { ratioOf: "unit", percent: 30 } },
  { key: "split-b", role: "body", label: "Specials", when: { units: ["band"] }, count: { ratioOf: "unit", percent: 70, round: "down" } },
  { key: "dep", role: "dependant", label: "Dependants", when: { units: ["band"] }, count: { percent: 20, ratioOf: "body" } },
  { key: "alt1", role: "captive", label: "Folk", when: { units: ["hold", "band"] }, branch: { group: "g1" }, count: { dice: "1d4" } },
  { key: "alt2", role: "captive", label: "Beasts", when: { units: ["hold", "band"] }, branch: { group: "g1" }, count: { literal: 2 } },
];
const ENCOUNTER = { wilderness: { lair: { noun: "Hold", number: "1d3", unit: "bands" }, wandering: { noun: "Band", number: "2d4", unit: "" } } };
const IMPORTED = [{ key: "archers", percent: 20 }, { key: "warriors", percent: 50 }, { key: "special", percent: 30 }];

t("the choices this recipe can reach are listed with their current pick, and a recipe with no split lists none of its", () => {
  const list = silentChoices({ recipe: RECIPE });
  assert.deepEqual(list.map((c) => c.key + (c.group ? `:${c.group}` : "")), ["unprintedRound", "loneSplit", "remainder", "branch:g1"]);
  assert.equal(list.find((c) => c.key === "unprintedRound").current, "nearest", "the evaluator's own default is shown");
  assert.deepEqual(list.at(-1).options.map((o) => o.label), ["Folk", "Beasts"]);
  assert.equal(list.at(-1).current, "alt1", "a group not named takes its first part");
  assert.deepEqual(silentChoices({ recipe: [RECIPE[0], RECIPE[1]] }), [], "nothing reachable, nothing asked");
  assert.equal(silentChoices({ recipe: [RECIPE[1]], rules: { troops: true } }).length, 3, "the troops rule makes its own shares");
  assert.deepEqual(silentChoices({ recipe: [RECIPE[1]], rules: { troops: true }, splitting: false }), [], "a Roll that divides no level asks nothing of a split, the troops rule on or not");
  assert.equal(silentChoices({ recipe: [RECIPE[1]], rules: { troops: true }, splitting: true }).length, 3, "a Roll that divides a level asks its split choices");
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
    assert.equal(willMake({ recipe: RECIPE, encounter: ENCOUNTER, state: "lair", chosen: { branch: { g1: "alt2" } } }).rows.at(-1).formula, "2");
    assert.equal(willMake({ recipe: RECIPE, encounter: ENCOUNTER, state: "chance" }).line.noun, "hold", "the chance state reads the lair line");
    assert.equal(willMake({ recipe: RECIPE, encounter: ENCOUNTER, context: "dungeon", state: "wandering" }).line, null, "a line the import did not read is blank");
  } finally {
    Math.random = real;
  }
});

t("a part is listed only in the state whose tree it applies to: a lair part is absent from a wandering roll, and chance lists what either side could make", () => {
  const keys = (state) => willMake({ recipe: RECIPE, encounter: ENCOUNTER, state }).rows.map((r) => r.key);
  assert.deepEqual(keys("lair"), ["guard", "split-a", "split-b", "dep", "alt1"]);
  assert.deepEqual(keys("wandering"), ["split-a", "split-b", "dep", "alt1"], "the guard names a unit only the lair tree stands on");
  assert.deepEqual(keys("chance"), keys("lair"), "the chance throw can land on the lair side");
  const bare = [...RECIPE, { key: "orphan", role: "guard", label: "Nobody's", count: { dice: "1d2" } }];
  assert.equal(willMake({ recipe: bare, encounter: ENCOUNTER, state: "lair" }).rows.some((r) => r.key === "orphan"), false, "a part that names no unit applies to none, as the evaluator reads it");
});

t("the list is what the evaluator makes: every part it lists is one the evaluator's tree carries, in both states", () => {
  for (const state of ["lair", "wandering"]) {
    const made = evaluateRecipe({ recipe: RECIPE, encounter: ENCOUNTER, state, rng: () => 0.001 });
    const made_ = new Set(walk(made.top).flatMap((n) => n.parts.map((p) => p.part)));
    const listed = willMake({ recipe: RECIPE, encounter: ENCOUNTER, state }).rows.map((r) => r.key).filter((k) => k !== "split-a" && k !== "split-b");
    for (const k of listed) assert.ok(made_.has(k), `${state}: ${k} is made`);
    assert.deepEqual(reachedWords({ recipe: RECIPE, encounter: ENCOUNTER, state }).map((w) => w.word), [...new Set(walk(made.top).map((n) => n.unit))], `${state}: the same unit words`);
  }
});

t("the troops rule's imported shares replace the recipe's in the list, and no share is listed where no level is one the shares name", () => {
  const out = willMake({ recipe: RECIPE, encounter: ENCOUNTER, state: "lair", shares: IMPORTED, shareCite: "XX p. 9" });
  assert.deepEqual(out.rows.filter((r) => r.role === "body").map((r) => [r.key, r.formula, r.cite]), [["archers", "20%", "XX p. 9"], ["warriors", "50%", "XX p. 9"], ["special", "30%", "XX p. 9"]]);
  const holdOnly = RECIPE.map((p) => (p.count?.ratioOf === "unit" ? { ...p, when: { units: ["hold"] } } : p));
  assert.equal(willMake({ recipe: holdOnly, encounter: ENCOUNTER, state: "wandering" }).rows.some((r) => r.role === "body"), false, "a wandering band has no hold for the split to divide");
  assert.equal(willMake({ recipe: holdOnly, encounter: ENCOUNTER, state: "wandering", shares: IMPORTED }).rows.some((r) => r.role === "body"), false, "nor do imported shares");
});

t("the share a slot offers is the evaluator's: the recipe's with the rule off, the imported three with it on, none where nothing splits, and a troop only for the special one", () => {
  const off = slotOptions({ recipe: RECIPE, encounter: ENCOUNTER, state: "lair" });
  assert.deepEqual(off.shares.map((s) => s.key), ["split-a", "split-b"]);
  assert.equal(off.troopShare, "", "no special share: a troop pick would never be read");
  const on = slotOptions({ recipe: RECIPE, encounter: ENCOUNTER, state: "lair", shares: IMPORTED });
  assert.deepEqual(on.shares.map((s) => s.key), ["archers", "warriors", "special"], "the troops rule's shares replace the recipe's");
  assert.equal(on.troopShare, "special");
  const holdOnly = RECIPE.map((p) => (p.count?.ratioOf === "unit" ? { ...p, when: { units: ["hold"] } } : p));
  assert.deepEqual(slotOptions({ recipe: holdOnly, encounter: ENCOUNTER, state: "wandering", shares: IMPORTED }), { shares: [], troopShare: "" }, "no level of a wandering band is one the shares name");
  assert.equal(slotOptions({ recipe: holdOnly, encounter: ENCOUNTER, state: "lair", shares: IMPORTED }).shares.length, 3);
});

t("a slot's unit is the level the top unit is made of, read from the side's line, and a slot the line cannot name is not sure", () => {
  const at = (extra) => slotUnit({ recipe: RECIPE, encounter: ENCOUNTER, ...extra });
  assert.deepEqual(at({ state: "lair", depth: 1 }), { word: "band", sure: true }, "a hold is made of bands");
  assert.deepEqual(at({ state: "lair", depth: 1, topKind: "hold" }), { word: "band", sure: true }, "started from the word the top row holds");
  assert.deepEqual(at({ state: "lair", depth: 2 }), { word: "", sure: false }, "bands hold bodies: no unit a level lower");
  assert.deepEqual(at({ state: "wandering", depth: 1 }), { word: "", sure: false }, "a wandering band has no unit beneath it");
  assert.deepEqual(at({ state: "chance", depth: 1 }), { word: "", sure: false }, "the two sides of a chance throw word the level differently");
});

t("a slot's Roll is a Roll of that one row at its level: the evaluator started from the slot's unit word makes that unit and nothing above it", () => {
  const { word } = slotUnit({ recipe: RECIPE, encounter: ENCOUNTER, state: "lair", depth: 1 });
  const whole = evaluateRecipe({ recipe: RECIPE, encounter: ENCOUNTER, state: "lair", rng: () => 0.001 });
  const one = evaluateRecipe({ recipe: RECIPE, encounter: ENCOUNTER, state: "lair", unit: word, rng: () => 0.001 });
  assert.equal(whole.top.unit, "hold", "a blank kind rolls the whole line");
  assert.equal(one.ok, true);
  assert.deepEqual(walk(one.top).map((n) => n.unit), ["band"], "the slot's unit alone");
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
