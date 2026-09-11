/**
 * Companion slots — the pure half: which creature the familiar rule allows,
 * how a slot is read off an ability, and how a hit-dice rating is read
 * whichever way it was recorded. Foundry-free; the globals below are the
 * minimum the module's imports touch at load time. Every rating here is a
 * SHAPE ("half a die", "one die with a penalty"), never a creature's printed
 * value.
 *
 * Usage: node tools/test-companions.mjs
 */
import assert from "node:assert/strict";

globalThis.game = { packs: [], actors: [], items: [], journal: [], tables: [], folders: [], i18n: { localize: (k) => k, format: (k) => k } };
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), escapeHTML: (s) => String(s) } };
globalThis.Hooks = { on() {}, once() {}, call() {}, callAll() {} };

const { companionSlots, isAnimal, hitDiceOf, underOneHitDie, FLAG_COMPANION } = await import("../scripts/abilities/companions.mjs");

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};

const M = "acks-extras";
const animal = (flags, hd) => ({ type: "monster", name: "a", flags: { [M]: { extras: { types: ["animal"], ...flags } } }, system: { hp: { hd } } });

t("an animal is one by the importer's type record or by being the animal sub-type", () => {
  assert.equal(isAnimal({ type: `${M}.animal` }), true);
  assert.equal(isAnimal(animal({}, "1d8")), true);
  assert.equal(isAnimal({ type: "monster", flags: { [M]: { extras: { types: ["humanoid"] } } } }), false);
  assert.equal(isAnimal({ type: "monster" }), false);
  assert.equal(isAnimal(null), false);
});

t("the rating comes from the importer's record first, then from the roll formula", () => {
  assert.deepEqual(hitDiceOf(animal({ hd: { count: 0.5, bonus: null } }, "1d8")), { count: 0.5, bonus: 0 }, "the record wins over the formula");
  assert.deepEqual(hitDiceOf(animal({ hd: { count: 1, bonus: -1 } }, "1d8")), { count: 1, bonus: -1 });
  assert.deepEqual(hitDiceOf(animal({}, "1d4")), { count: 0.5, bonus: 0 }, "a scaled die reads back as its fraction");
  assert.deepEqual(hitDiceOf(animal({}, "1d8-1")), { count: 1, bonus: -1 });
  assert.deepEqual(hitDiceOf(animal({}, "3d8+1")), { count: 3, bonus: 1 });
  assert.deepEqual(hitDiceOf({ system: {} }), { count: 0, bonus: 0 }, "no rating at all is zero, not a throw");
});

t("under one Hit Die is a fraction of a die, or one die with a penalty", () => {
  assert.equal(underOneHitDie({ count: 0.5, bonus: 0 }), true);
  assert.equal(underOneHitDie({ count: 0.25, bonus: 0 }), true);
  assert.equal(underOneHitDie({ count: 1, bonus: -1 }), true, "1-1 counts as less than one");
  assert.equal(underOneHitDie({ count: 1, bonus: 0 }), false);
  assert.equal(underOneHitDie({ count: 1, bonus: 1 }), false);
  assert.equal(underOneHitDie({ count: 2, bonus: -1 }), false);
  assert.equal(underOneHitDie({ count: 0, bonus: 0 }), false, "no rating is not a small one");
  assert.equal(underOneHitDie(), false);
});

const ability = (id, effects) => ({ id, type: "ability", name: id, getFlag: (mod, key) => (mod === M && key === "extras" ? { effects } : undefined) });

t("a slot is every companion effect on every ability, in order, with its pointer", () => {
  const actor = {
    items: [
      ability("fam", [{ type: "modifier", target: "reaction" }, { type: "companion", note: "Familiar" }]),
      { id: "sword", type: "weapon", getFlag: () => undefined },
      ability("totem", [{ type: "companion", ref: "mm.rat", actorUuid: "Actor.gone" }]),
      ability("plain", [{ type: "capability" }]),
    ],
  };
  const slots = companionSlots(actor);
  assert.deepEqual(
    slots.map((s) => [s.item.id, s.index, s.actorUuid, s.companion]),
    [
      ["fam", 1, "", null],
      ["totem", 0, "Actor.gone", null],
    ],
    "the index is the effect's place in ITS ability, and a pointer that resolves to nothing is an empty slot",
  );
  assert.equal(slots[1].effect.ref, "mm.rat", "the effect rides along, so a caller can tell a named slot from a chosen one");
  assert.deepEqual(companionSlots(null), []);
  assert.deepEqual(companionSlots({ items: [] }), []);
});

t("the companion flag has one spelling", () => {
  assert.equal(FLAG_COMPANION, "companion");
});

console.log(`\ntest-companions: ${n} tests passed`);
