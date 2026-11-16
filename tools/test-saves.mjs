/**
 * A saving throw as named parts (scripts/lib/saves.mjs): the formula, the
 * target and the parts a throw is made from, and the throw made from them.
 *
 * Every figure below is INVENTED. What this pins is the composition: which
 * parts reach the roll, which lower the target, that a part of zero is not
 * listed, that the conditions' circumstance-bound rows are handed back rather
 * than applied, and that the throw never takes a state off its creature.
 */
import assert from "node:assert/strict";
import { saveSpec, saveThrow } from "../scripts/lib/saves.mjs";

let passed = 0;
const ok = async (name, fn) => {
  await fn();
  passed++;
  console.log("ok   " + name);
};

/** Invented sizes for the conditions below. */
const VALUES = { hungry: { all: -3 }, covered: { blast: 3 }, blessed: { all: 3 } };

const character = ({ mod = 0, wis = 0, saves = { blast: { value: 14 } }, statuses = [] } = {}) => ({
  type: "character",
  uuid: "Actor.hero",
  statuses: new Set(statuses),
  system: { save: { mod }, scores: { wis: { mod: wis } }, saves },
});
const monster = ({ saves = { blast: { value: 14 } }, statuses = [] } = {}) => ({
  type: "monster",
  uuid: "Actor.beast",
  statuses: new Set(statuses),
  system: { saves },
});

await ok("a character's roll adds its own modifier and its Wisdom modifier against magic, as one signed term", () => {
  const spec = saveSpec(character({ mod: 2, wis: 1 }), "blast", { values: VALUES });
  assert.equal(spec.formula, "1d20 + 3");
  assert.deepEqual(spec.parts.map((p) => [p.key, p.value, p.side]), [["saveMod", 2, "roll"], ["wis", 1, "roll"]]);
  assert.equal(spec.baseTarget, 14);
  assert.equal(spec.target, 14);
  assert.equal(spec.save, "blast");
  assert.equal(saveSpec(character({ mod: -1, wis: -2 }), "blast").formula, "1d20 - 3");
  assert.equal(saveSpec(character({ mod: 0, wis: 0 }), "blast").formula, "1d20");
  const cancelled = saveSpec(character({ mod: 2, wis: -2 }), "blast");
  assert.equal(cancelled.formula, "1d20", "parts that cancel leave the bare die");
  assert.deepEqual(cancelled.parts.map((p) => p.key), ["saveMod", "wis"], "and both are still named");
});

await ok("a zero part is not listed, and the mundane throw and a monster carry no modifier", () => {
  assert.deepEqual(saveSpec(character({ mod: 0, wis: 2 }), "blast").parts.map((p) => p.key), ["wis"]);
  assert.equal(saveSpec(character({ mod: 2, wis: 1 }), "blast", { magical: false }).formula, "1d20");
  assert.deepEqual(saveSpec(character({ mod: 2, wis: 1 }), "blast", { magical: false }).parts, []);
  assert.equal(saveSpec(monster(), "blast").formula, "1d20", "a monster has neither");
});

await ok("a situational figure and the caller's parts join the roll: numbers sum into the one term, a die is appended", () => {
  const spec = saveSpec(character({ mod: 2, wis: 1 }), "blast", {
    situational: "-2",
    parts: [{ key: "ring", label: "Ring", value: 1 }, { key: "die", label: "Die", value: "+1d4" }],
  });
  assert.equal(spec.formula, "1d20 + 2 + 1d4", "3 - 2 + 1 = 2, then the die");
  assert.deepEqual(spec.parts.map((p) => p.key), ["saveMod", "wis", "situational", "ring", "die"]);
  assert.equal(saveSpec(monster(), "blast", { situational: "1d6" }).formula, "1d20 + 1d6");
  assert.equal(saveSpec(monster(), "blast", { situational: "-1d6" }).formula, "1d20 - 1d6");
  assert.equal(saveSpec(monster(), "blast", { situational: 4 }).formula, "1d20 + 4");
  assert.equal(saveSpec(monster(), "blast", { situational: "  " }).formula, "1d20", "blank is none");
  assert.equal(saveSpec(monster(), "blast", { situational: null, parts: [{ key: "x", label: "X", value: null }] }).formula, "1d20");
});

await ok("the conditions lower the target as the system's own throw lowers it, and are left out when asked", () => {
  const spec = saveSpec(character({ statuses: ["hungry"] }), "blast", { values: VALUES });
  assert.equal(spec.baseTarget, 14);
  assert.equal(spec.target, 17, "a penalty of 3 on the roll raises the number to roll");
  assert.deepEqual(spec.parts.filter((p) => p.side === "target").map((p) => [p.key, p.value]), [["hungry", -3]]);
  const covered = saveSpec(monster({ statuses: ["covered"] }), "blast", { values: VALUES });
  assert.equal(covered.target, 11, "a bonus of 3 lowers it");
  assert.equal(saveSpec(monster({ saves: { blast: { value: 14 }, death: { value: 14 } }, statuses: ["covered"] }), "death", { values: VALUES }).target, 14, "a row that names its saves reaches only those");
  const left = saveSpec(character({ statuses: ["hungry"] }), "blast", { values: VALUES, conditions: false });
  assert.equal(left.target, 14, "the party's throw reads the stored number alone");
  assert.deepEqual(left.parts, []);
  assert.deepEqual([left.pending, left.unpriced], [[], []]);
});

await ok("a circumstance-bound row is handed back pending, an unimported figure is named unpriced, and neither moves the target", () => {
  const blessed = saveSpec(character({ statuses: ["blessed"] }), "blast", { values: VALUES });
  assert.deepEqual(blessed.pending, [{ condition: "blessed", value: 3, when: "fear" }]);
  assert.equal(blessed.target, 14);
  const bare = saveSpec(character({ statuses: ["hungry"] }), "blast", { values: {} });
  assert.deepEqual(bare.unpriced, ["hungry"]);
  assert.equal(bare.target, 14, "no figure stands in for the missing one");
});

await ok("a creature with no stored target has no throw to make", async () => {
  const none = saveSpec(character({ saves: {} }), "blast");
  assert.deepEqual([none.baseTarget, none.target], [null, null]);
  assert.equal(none.formula, "1d20", "the formula is still composed");
  let rolled = false;
  const made = await saveThrow(character({ saves: {} }), "blast", { roll: async () => { rolled = true; return { total: 20 }; } });
  assert.deepEqual([made.roll, made.total, made.success, rolled], [null, null, null, false]);
  assert.equal(saveSpec(character({ saves: { blast: { value: "14" } } }), "blast").target, null, "text is no stored target");
  assert.equal(saveSpec(null, "blast").target, null);
});

await ok("a saving-throw key an earlier schema used reaches the throw the conditions name it", () => {
  const spec = saveSpec(monster({ saves: { breath: { value: 15 } }, statuses: ["covered"] }), "breath", { values: VALUES });
  assert.equal(spec.kind, "blast");
  assert.equal(spec.target, 12, "cover's row for Blast reaches the earlier key");
});

await ok("saveThrow rolls the composed formula, and a total at or above the target succeeds", async () => {
  const seen = [];
  const rollOf = (total) => async (formula) => { seen.push(formula); return { total }; };
  const hero = character({ mod: 2, wis: 1 });
  const hit = await saveThrow(hero, "blast", { roll: rollOf(14), values: VALUES });
  assert.equal(hit.success, true, "equal to the target succeeds");
  assert.equal(hit.total, 14);
  assert.equal(hit.formula, "1d20 + 3");
  const miss = await saveThrow(hero, "blast", { roll: rollOf(13), values: VALUES });
  assert.equal(miss.success, false);
  assert.deepEqual(seen, ["1d20 + 3", "1d20 + 3"], "the roll is handed exactly the spec's formula");
  const held = await saveThrow(character({ statuses: ["hungry"] }), "blast", { roll: rollOf(16), values: VALUES });
  assert.equal(held.success, false, "16 against 17");
  assert.equal(held.target, 17);
  const mundane = await saveThrow(hero, "blast", { roll: rollOf(14), magical: false });
  assert.equal(seen.at(-1), "1d20");
  assert.equal(mundane.success, true);
});

await ok("saveThrow rolls a Foundry Roll when no roll is given", async () => {
  const prior = globalThis.Roll;
  globalThis.Roll = class { constructor(f) { this.formula = f; } async evaluate() { this.total = 15; return this; } };
  try {
    const made = await saveThrow(character({ mod: 1 }), "blast");
    assert.deepEqual([made.formula, made.total, made.success], ["1d20 + 1", 15, true]);
    assert.equal(made.roll.formula, "1d20 + 1");
  } finally {
    globalThis.Roll = prior;
  }
});

await ok("a failed save costs the creature nothing here: the throw never lifts a state", async () => {
  const lifted = [];
  const caster = character({ statuses: ["casting", "readied"] });
  caster.toggleStatusEffect = async (id) => { lifted.push(id); };
  const made = await saveThrow(caster, "blast", { roll: async () => ({ total: 1 }), values: VALUES });
  assert.equal(made.success, false);
  assert.deepEqual(lifted, [], "the loss is the applier's, through loseStates");
  assert.deepEqual([...caster.statuses], ["casting", "readied"]);
});

console.log(`\n${passed} passed`);
