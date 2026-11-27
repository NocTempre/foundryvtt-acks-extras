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

const { companionSlots, isAnimal, hitDiceOf, underOneHitDie, offersPicker, companionCandidates, FLAG_COMPANION } = await import("../scripts/abilities/companions.mjs");
const { isUnattended, unattendedOperation } = await import("../scripts/lib/constants.mjs");

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

t("an unattended create of a companion ability offers no picker", () => {
  globalThis.game.user = { id: "me" };
  const effects = [{ type: "companion", note: "Familiar" }];
  const held = (extra = {}) => {
    const item = ability("fam", effects);
    const actor = { documentName: "Actor", type: "character", items: [item], ...extra };
    item.parent = actor;
    return item;
  };
  assert.equal(offersPicker(held(), {}, "me")?.index, 0, "no options: the slot is offered");
  assert.equal(offersPicker(held(), undefined, "me")?.index, 0, "no operation at all is the same");
  assert.equal(offersPicker(held(), unattendedOperation(false), "me")?.index, 0, "an attended create keeps the picker");
  assert.equal(offersPicker(held(), unattendedOperation(true), "me"), null, "the unattended key opens none");
  assert.equal(offersPicker(held(), { [M]: { unattended: true } }, "me"), null, "the key's shape is {module: {unattended: true}}");
  assert.equal(offersPicker(held(), {}, "peer"), null, "another seat's create is not this seat's to answer");
  assert.equal(offersPicker(held({ pack: "world.library" }), {}, "me"), null, "a library actor is a document being written");
  assert.equal(offersPicker(held({ type: "monster" }), {}, "me"), null, "only a character is offered the choice");
  assert.equal(isUnattended({ [M]: { unattended: true } }), true);
  assert.equal(isUnattended({ [M]: {} }), false);
  assert.equal(isUnattended(undefined), false);
});

t("the companion flag has one spelling", () => {
  assert.equal(FLAG_COMPANION, "companion");
});

/* ---- the candidates, read off the index ---- */

globalThis.CONFIG = { Item: { compendiumIndexFields: [] }, Actor: { compendiumIndexFields: [] } };
const { declareLibraryIndexFields } = await import("../scripts/lib/library.mjs");
const { shelfMock, sourceDoc } = await import("./lib-shelf-mock.mjs");
declareLibraryIndexFields();

/** An invented creature as the shelf stores it: the importer's type record rides in its extras flag. */
const creature = (id, name, type, types, hd) => {
  const doc = sourceDoc(id, name, type, `zz.${id}`);
  doc.flags[M].extras = { types, ...(hd ? { hd } : {}) };
  return doc;
};

const ta = async (name, fn) => {
  await fn();
  n++;
  console.log(`ok - ${name}`);
};

await ta("the picker loads the animals alone, by one id query, and groups them by the rule's shape", async () => {
  const pack = shelfMock({
    type: "Actor",
    docs: [
      creature("a1", "Weasel", "monster", ["animal"], { count: 0.5, bonus: 0 }),
      creature("a2", "Bison", "monster", ["animal"], { count: 4, bonus: 0 }),
      creature("a3", "Sprite", "monster", ["fey"]),
      creature("a4", "Hound", `${M}.animal`, []),
      creature("a5", "Pilgrim", "character", []),
    ],
  });
  game.packs = [pack];
  game.actors = [];
  const { eligible, other } = await companionCandidates();
  assert.deepEqual(pack.calls.getDocuments, [{ _id__in: ["a1", "a2", "a4"] }], "one query naming the animals; no whole-shelf load");
  assert.equal(pack.calls.getDocuments.some((q) => q === undefined), false);
  assert.deepEqual(eligible.map((a) => a.name), ["Weasel"]);
  assert.deepEqual(other.map((a) => a.name), ["Bison", "Hound"]);
  game.packs = [];
});

console.log(`\ntest-companions: ${n} tests passed`);
