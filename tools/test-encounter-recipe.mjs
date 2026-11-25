/**
 * Offline tests for the encounter recipe evaluator
 * (scripts/monsters/encounter-recipe.mjs): a recipe rolled for a unit into a tree
 * of units of units. Every unit word, rank, creature word, figure and page
 * reference in here is invented, and the dice are rigged: what this pins is the
 * procedure. A unit is sized by the line that carries its noun, shares divide the
 * first level with more than one unit by their printed roundings, a leader
 * attaches to each unit of its word, a chance and a branch of alternatives gate a
 * part, a dependant is a share of another part's bodies under it, a count read
 * per unit is rolled for each, the lair chance chooses the side, and a figure
 * that is missing leaves a blank and a note, never a throw.
 *
 * Run: node tools/test-encounter-recipe.mjs
 */
import assert from "node:assert/strict";
import { DEFAULT_CHOICES, apportion, evaluateRecipe, rollFormula, sidesOf, unitWord, walk } from "../scripts/monsters/encounter-recipe.mjs";

const tests = [];
const t = (name, fn) => tests.push([name, fn]);

/** An rng that yields the listed values and then 0.5 for ever. */
const rngOf = (...values) => {
  const queue = [...values];
  return () => (queue.length ? queue.shift() : 0.5);
};
/** The rng value that makes a die of `faces` land on `n`. */
const face = (n, faces) => (n - 0.5) / faces;

const ENCOUNTER = {
  dungeon: { wandering: { noun: "Cell", number: "2d4", unit: "" }, lair: { noun: "Den", number: "1", unit: "band" } },
  wilderness: { wandering: { noun: "Band", number: "1d6", unit: "cells" }, lair: { noun: "Hold", number: "1d10", unit: "bands" } },
  lairChance: 40,
};

const part = (key, role, over = {}) => ({
  key,
  label: key,
  role,
  source: { uuid: "", templateCell: "", stat: "", name: "" },
  count: { dice: "", literal: null, ratioOf: "", percent: null, round: "", perUnit: "" },
  chance: null,
  when: { state: "", place: "", units: [] },
  branch: { group: "", band: "" },
  moraleWhileAlive: null,
  cite: "XX p. 1",
  basis: "page",
  ...over,
  ...(over.count ? { count: { dice: "", literal: null, ratioOf: "", percent: null, round: "", perUnit: "", ...over.count } } : {}),
  ...(over.when ? { when: { state: "", place: "", units: [], ...over.when } } : {}),
});

const RECIPE = [
  part("archers", "body", { count: { ratioOf: "unit", percent: 50, round: "up" }, when: { units: ["cell", "band"] } }),
  part("warriors", "body", { count: { ratioOf: "unit", percent: 50, round: "down" }, when: { units: ["cell", "band"] } }),
  part("leader-a", "leader", { source: { templateCell: "alba|a" }, count: { literal: 1 }, when: { units: ["cell"] } }),
  part("leader-b", "leader", { source: { templateCell: "alba|b" }, count: { literal: 1 }, when: { units: ["band"] } }),
  part("leader-c", "leader", { source: { templateCell: "alba|c" }, count: { literal: 1 }, when: { units: ["den", "hold"] }, moraleWhileAlive: 2 }),
  part("dependant-x", "dependant", { source: { templateCell: "alba|x" }, count: { ratioOf: "warriors", percent: 100 }, when: { units: ["hold"] } }),
  part("guard-1", "guard", { source: { name: "zorps" }, count: { dice: "2d4" }, chance: 60, when: { units: ["hold"] }, branch: { group: "g1" } }),
  part("guard-2", "guard", { source: { name: "quuxes" }, count: { dice: "1d4" }, chance: 60, when: { units: ["hold"] }, branch: { group: "g1" } }),
  part("captives", "captive", { source: { name: "folk" }, count: { dice: "1d10", perUnit: "band" }, chance: 50, when: { units: ["hold"] } }),
];

const partsOf = (node, key) => node.parts.filter((p) => p.part === key);

/* -------------------------------------------- */
/*  Dice and shares                              */
/* -------------------------------------------- */

t("a count formula reads dice, a figure, and either under a multiplier; the rest is null", () => {
  assert.equal(rollFormula("4", rngOf()), 4);
  assert.equal(rollFormula("2d4+1", rngOf(face(3, 4), face(2, 4))), 6);
  assert.equal(rollFormula("(1d4+1)*10", rngOf(face(2, 4))), 30);
  assert.equal(rollFormula("2*3", rngOf()), 6);
  assert.equal(rollFormula("lots", rngOf()), null);
});

t("a share takes its percent of the units rounded as printed, at 1, 2 and 3 units", () => {
  const shares = [{ key: "a", percent: 50, round: "up" }, { key: "w", percent: 50, round: "down" }];
  assert.deepEqual(apportion(1, shares).counts, { a: 1, w: 0 });
  assert.deepEqual(apportion(2, shares).counts, { a: 1, w: 1 });
  assert.deepEqual(apportion(3, shares).counts, { a: 2, w: 1 });
  assert.deepEqual(apportion(5, shares).counts, { a: 3, w: 2 });
});

t("shares whose roundings do not sum to the units leave the rest by the largest dropped fraction, or none", () => {
  const three = [{ key: "a", percent: 40, round: "down" }, { key: "w", percent: 40, round: "down" }, { key: "s", percent: 20, round: "up" }];
  assert.deepEqual(apportion(2, three).counts, { a: 1, w: 0, s: 1 }, "0.8 of a dropped 0.8 first; a tie goes to the earlier share");
  assert.deepEqual(apportion(3, three).counts, { a: 1, w: 1, s: 1 });
  assert.deepEqual(apportion(4, three).counts, { a: 2, w: 1, s: 1 });
  const none = apportion(4, three, { remainder: "none" });
  assert.deepEqual(none.counts, { a: 1, w: 1, s: 1 });
  assert.equal(none.left, 1, "the unit no share took is left, not invented");
  assert.equal(Object.values(apportion(7, three).counts).reduce((a, b) => a + b, 0), 7);
});

t("a rounding the page does not print takes the Judge's default", () => {
  const share = [{ key: "a", percent: 50 }];
  assert.equal(apportion(3, share, { remainder: "none" }).counts.a, 2, "nearest, half up");
  assert.equal(apportion(3, share, { unprintedRound: "down", remainder: "none" }).counts.a, 1);
  assert.equal(apportion(3, share, { unprintedRound: "up", remainder: "none" }).counts.a, 2);
});

/* -------------------------------------------- */
/*  The tree                                     */
/* -------------------------------------------- */

t("a unit's own sides: a size part of the recipe stands in for the line it was read from", () => {
  const sides = sidesOf([part("size-wilderness-wandering", "unit", { label: "band", source: { name: "cell" }, count: { dice: "2d6" }, when: { place: "wilderness", state: "wandering", units: ["band"] } })], ENCOUNTER);
  const side = sides.find((s) => s.place === "wilderness" && s.state === "wandering");
  assert.deepEqual([side.number, side.word, side.childWord], ["2d6", "band", "cell"]);
  assert.equal(sides.length, 4);
});

t("a wandering unit that counts bodies is a node with its bodies and the share of one unit", () => {
  const out = evaluateRecipe({ recipe: RECIPE, encounter: ENCOUNTER, context: "dungeon", state: "wandering", rng: rngOf(face(3, 4), face(2, 4)) });
  assert.equal(out.ok, true);
  assert.equal(out.top.unit, "cell");
  assert.equal(out.top.children.length, 0);
  assert.equal(out.top.kind, "archers", "alone in its level, the printed rounding gives it to the share that rounds up");
  assert.deepEqual(out.top.parts.map((p) => [p.part, p.role, p.count]), [["archers", "body", 5]]);
  assert.deepEqual(out.top.leaders.map((l) => [l.part, l.count]), [["leader-a", 1]]);
});

t("a lone unit may take its kind by a percentile over the shares instead (a Judge's choice)", () => {
  const rolled = (die) => evaluateRecipe({ recipe: RECIPE, encounter: ENCOUNTER, context: "dungeon", state: "wandering", rng: rngOf(face(1, 4), face(1, 4), face(die, 100)), choices: { loneSplit: "roll" } });
  assert.equal(rolled(30).top.kind, "archers");
  assert.equal(rolled(80).top.kind, "warriors");
  assert.equal(DEFAULT_CHOICES.loneSplit, "printed");
});

t("a unit of units is sized by the lines of its sub-units, and the shares divide the sub-units by their rounding", () => {
  for (const [cells, archers, warriors] of [[1, 1, 0], [2, 1, 1], [3, 2, 1]]) {
    const out = evaluateRecipe({ recipe: RECIPE, encounter: ENCOUNTER, context: "wilderness", state: "wandering", rng: rngOf(face(cells, 6)) });
    assert.equal(out.top.unit, "band");
    assert.equal(out.top.children.length, cells);
    assert.equal(out.top.children.filter((c) => c.kind === "archers").length, archers, `${cells} cells`);
    assert.equal(out.top.children.filter((c) => c.kind === "warriors").length, warriors, `${cells} cells`);
    assert.ok(out.top.children.every((c) => c.unit === "cell" && c.parts.length === 1 && c.leaders.length === 1), "each cell holds its bodies and its leader");
    assert.deepEqual(out.top.leaders.map((l) => l.part), ["leader-b"], "the band's own leader, once");
  }
});

t("a unit that holds one unit passes the division down to the first level with more than one", () => {
  const out = evaluateRecipe({ recipe: RECIPE, encounter: ENCOUNTER, context: "dungeon", state: "lair", rng: rngOf(face(3, 6)) });
  assert.equal(out.top.unit, "den");
  assert.equal(out.top.children.length, 1);
  assert.equal(out.top.children[0].children.length, 3, "the one band holds the three cells the die gave");
  assert.equal(out.top.children[0].kind, "", "the lone band is not itself divided");
  assert.deepEqual(out.top.children[0].children.map((c) => c.kind), ["archers", "archers", "warriors"]);
  assert.deepEqual(out.top.leaders.map((l) => [l.part, l.moraleWhileAlive]), [["leader-c", 2]], "the printed morale part rides the rank's leader");
});

/** Every die lands at a fifth of its faces, so each throw of a chance passes and a size is the same each time. */
const steady = () => 0.2;

t("a whole village: leaders of each unit, kinds inherited down, a dependant share of the warriors under it", () => {
  const out = evaluateRecipe({ recipe: RECIPE, encounter: ENCOUNTER, context: "wilderness", state: "lair", rng: steady });
  const nodes = walk(out.top);
  const bands = nodes.filter((n) => n.unit === "band");
  assert.equal(out.top.unit, "hold");
  assert.equal(bands.length, out.top.count.total);
  assert.equal(nodes.filter((n) => n.unit === "cell").length, bands.reduce((s, b) => s + b.count.total, 0));
  assert.equal(bands.filter((n) => n.leaders.some((l) => l.part === "leader-b")).length, bands.length, "a leader for each band");
  const warriors = nodes.flatMap((n) => partsOf(n, "warriors")).reduce((s, p) => s + p.count, 0);
  assert.ok(warriors > 0);
  const dep = partsOf(out.top, "dependant-x");
  assert.equal(dep.length, 1);
  assert.equal(dep[0].count, warriors, "100% of every warrior body under the village");
  assert.equal(partsOf(bands[0], "dependant-x").length, 0, "a unit its word does not name takes none");
});

t("a branch group is one alternative, the first unless the Judge chose another, behind one chance throw", () => {
  const village = (choices, recipe = RECIPE) => evaluateRecipe({ recipe, encounter: ENCOUNTER, context: "wilderness", state: "lair", rng: steady, choices });
  const guards = (out) => out.top.parts.filter((p) => p.role === "guard").map((p) => p.part);
  assert.deepEqual(guards(village({})), ["guard-1"]);
  assert.equal(village({}).choices.branch.g1, undefined, "the default is the first part, and no choice is invented");
  assert.deepEqual(guards(village({ branch: { g1: "guard-2" } })), ["guard-2"]);
  assert.deepEqual(guards(village({ branch: { g1: "nope" } })), ["guard-1"], "a choice naming no part falls to the first");
  const never = RECIPE.map((p) => (p.branch.group ? { ...p, chance: 0 } : p));
  assert.deepEqual(guards(village({}, never)), [], "a throw above the chance makes none");
});

t("a count read per unit is rolled once for each unit of that word under the unit", () => {
  const out = evaluateRecipe({ recipe: RECIPE, encounter: ENCOUNTER, context: "wilderness", state: "lair", rng: steady });
  const captives = partsOf(out.top, "captives");
  assert.equal(out.steps.filter((s) => s.why === "captives count").length, out.top.count.total, "a throw of the count for each band");
  assert.equal(captives.length, 1);
  assert.equal(captives[0].perUnit, "band");
  assert.equal(captives[0].count, out.steps.filter((s) => s.why === "captives count").reduce((s, x) => s + x.total, 0));
});

t("the lair chance chooses the side before anything is sized", () => {
  const throwDie = (die, enc = ENCOUNTER) => evaluateRecipe({ recipe: RECIPE, encounter: enc, context: "wilderness", state: "chance", rng: rngOf(face(die, 100)) });
  const inLair = throwDie(30);
  assert.deepEqual([inLair.state, inLair.requested, inLair.lair.inLair, inLair.top.unit], ["lair", "chance", true, "hold"]);
  const out = throwDie(70);
  assert.deepEqual([out.state, out.lair.die, out.lair.inLair, out.top.unit], ["wandering", 70, false, "band"]);
  assert.equal(throwDie(40).state, "lair", "a die equal to the chance is in the lair");
  assert.deepEqual(evaluateRecipe({ recipe: RECIPE, encounter: { ...ENCOUNTER, lairChance: null }, state: "chance", rng: rngOf() }), { ok: false, reason: "noChance" });
});

t("a side that states no count rolls nothing, and an empty row of a unit word is rolled from the line that carries it", () => {
  const sparse = { wilderness: { wandering: { noun: "Band", number: "", unit: "" } } };
  assert.equal(evaluateRecipe({ recipe: [], encounter: sparse, context: "wilderness", state: "wandering", rng: rngOf() }).reason, "side");
  const out = evaluateRecipe({ recipe: RECIPE, encounter: ENCOUNTER, context: "wilderness", state: "lair", unit: "band", rng: rngOf(face(2, 6)) });
  assert.equal(out.top.unit, "band");
  assert.equal(out.top.children.length, 2, "the band line, not the village's");
});

t("a figure the recipe lacks leaves a blank and a note, and nothing throws", () => {
  const holes = [
    part("leader-b", "leader", { count: {}, when: { units: ["band"] } }),
    part("guard-1", "guard", { count: {}, when: { units: ["band"] } }),
  ];
  const out = evaluateRecipe({ recipe: holes, encounter: ENCOUNTER, context: "wilderness", state: "wandering", rng: rngOf(face(1, 6)) });
  assert.equal(out.ok, true);
  assert.deepEqual(out.missing.map((m) => [m.what, m.part ?? m.unit]).sort(), [["count", "guard-1"], ["count", "leader-b"]]);
  assert.equal(out.top.leaders[0].count, 0);
  const noLine = evaluateRecipe({ recipe: [], encounter: { wilderness: { wandering: { noun: "Band", number: "2", unit: "cells" } } }, context: "wilderness", state: "wandering", rng: rngOf() });
  assert.deepEqual(noLine.missing.map((m) => [m.what, m.unit]), [["size", "cell"], ["size", "cell"]], "a sub-unit no line sizes stays a blank unit");
  assert.equal(noLine.top.children.length, 2);
});

t("lines that name each other end the tree", () => {
  const loop = { wilderness: { wandering: { noun: "Aa", number: "1", unit: "bbs" }, lair: { noun: "Bb", number: "1", unit: "aas" } } };
  const out = evaluateRecipe({ recipe: [], encounter: loop, context: "wilderness", state: "wandering", rng: rngOf() });
  assert.equal(out.ok, true);
  assert.ok(walk(out.top).length <= 4);
});

t("shares a caller hands in replace the recipe's own, and a unit taking a share the recipe has no part for keeps the key", () => {
  const three = [{ key: "archers", percent: 40, round: "down" }, { key: "warriors", percent: 40, round: "down" }, { key: "special", percent: 20, round: "up" }];
  const out = evaluateRecipe({ recipe: RECIPE, encounter: ENCOUNTER, context: "wilderness", state: "wandering", rng: rngOf(face(3, 6)), shares: three });
  assert.deepEqual(out.top.children.map((c) => c.kind), ["archers", "warriors", "special"]);
  assert.deepEqual(out.top.children[2].parts.map((p) => p.part), ["special"]);
});

t("a unit word folds its plural and case", () => {
  assert.equal(unitWord("Bands"), "band");
  assert.equal(unitWord(" CELLS "), "cell");
  assert.equal(unitWord(""), "");
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
console.log(`\ntest-encounter-recipe: ${tests.length - failures}/${tests.length} passed`);
if (failures) process.exit(1);
