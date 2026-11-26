/**
 * Pins the grog's breakage decision (monsters/grog-breakage.mjs): the items
 * that break with their bearer are those whose drink flag names the beastman
 * as its own kind, and only where the bearer is itself a beastman; the status
 * test reads the defeated or dead status on an enabled effect. Foundry-free:
 * an actor-like object answers `getFlag` the way `creatureKinds` reads it.
 *
 * Usage: node tools/test-grog-breakage.mjs
 */
import assert from "node:assert/strict";

globalThis.Hooks = { once() {}, on() {}, callAll() {} };
globalThis.foundry = { utils: { randomID: () => "rid" }, data: { operators: {}, EmanationShapeData: class {} } };
globalThis.game = { i18n: { format: (key) => key, localize: (key) => key }, users: [], user: { isGM: true }, time: { worldTime: 0 }, combat: null, messages: { get: () => null } };
globalThis.ui = { notifications: { warn() {}, error() {}, info() {} } };
globalThis.CONST = { REGION_VISIBILITY: { GAMEMASTER: 1 }, TOKEN_DISPOSITIONS: { FRIENDLY: 1, HOSTILE: -1 } };
globalThis.CONFIG = { specialStatusEffects: { DEFEATED: "defeated" }, statusEffects: [] };

const { grogToBreak, carriesDownStatus } = await import("../scripts/monsters/grog-breakage.mjs");
const { BEASTMAN_KIND } = await import("../scripts/monsters/organisation.mjs");
const { MONSTER_TYPES } = await import("../scripts/monsters/config.mjs");
const { MODULE_ID } = await import("../scripts/monsters/constants.mjs");
const { ITEM_FLAGS } = await import("../scripts/equipment/constants.mjs");

let passed = 0;
const t = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

const drinkItem = (id, ownKind) => ({ id, name: `Drink ${id}`, flags: { [MODULE_ID]: { [ITEM_FLAGS.DRINK]: { healDice: "1d4", ownKind } } } });
const plain = (id) => ({ id, name: `Plain ${id}`, flags: {} });
const actorOf = (types, items) => ({ type: "monster", items, getFlag: (scope, key) => (scope === MODULE_ID && key === "extras" ? { types } : undefined) });

t("the own kind is a closed monster type key", () => {
  assert.ok(Object.keys(MONSTER_TYPES).includes(BEASTMAN_KIND));
});

t("a beastman breaks each item whose drink flag names the beastman", () => {
  const actor = actorOf([BEASTMAN_KIND], [drinkItem("a", BEASTMAN_KIND), plain("b"), drinkItem("c", BEASTMAN_KIND)]);
  assert.deepEqual(grogToBreak(actor), [{ id: "a", name: "Drink a" }, { id: "c", name: "Drink c" }]);
});

t("a creature of another kind keeps the same item", () => {
  assert.deepEqual(grogToBreak(actorOf(["humanoid"], [drinkItem("a", BEASTMAN_KIND)])), []);
});

t("a beastman with no drink item breaks nothing", () => {
  assert.deepEqual(grogToBreak(actorOf([BEASTMAN_KIND], [plain("a")])), []);
});

t("an item whose drink flag names another kind stays, and so does one with no own kind", () => {
  const actor = actorOf([BEASTMAN_KIND], [drinkItem("a", "undead"), drinkItem("b", null), drinkItem("c", undefined)]);
  assert.deepEqual(grogToBreak(actor), []);
});

t("an untyped or missing actor breaks nothing", () => {
  assert.deepEqual(grogToBreak(actorOf(undefined, [drinkItem("a", BEASTMAN_KIND)])), []);
  assert.deepEqual(grogToBreak(null), []);
});

t("the decision reads items held as a collection and a second call after the delete finds none", () => {
  const items = new Set([drinkItem("a", BEASTMAN_KIND)]);
  const actor = actorOf([BEASTMAN_KIND], items);
  assert.equal(grogToBreak(actor).length, 1);
  items.clear();
  assert.deepEqual(grogToBreak(actor), []);
});

t("the status test reads defeated and dead on an enabled effect", () => {
  assert.equal(carriesDownStatus({ statuses: new Set(["defeated"]) }), true);
  assert.equal(carriesDownStatus({ statuses: new Set(["dead"]) }), true);
  assert.equal(carriesDownStatus({ statuses: new Set(["prone"]) }), false);
  assert.equal(carriesDownStatus({ statuses: new Set(["dead"]), disabled: true }), false);
  assert.equal(carriesDownStatus({}), false);
  assert.equal(carriesDownStatus(null), false);
});

console.log(`\ntest-grog-breakage: ${passed} checks passed.`);
