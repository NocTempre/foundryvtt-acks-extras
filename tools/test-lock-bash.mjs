/**
 * A container's bash (`equipment/locks.mjs` `bashOpen`), offline: the
 * Dungeonbashing throw it rolls takes the basher's Strength at the imported
 * factor (`bashStrPart`, the one owner of that figure), and the lock pick does
 * not. The ability roller is a recording stand-in, so what is pinned is the
 * modifier handed to the roll: its size, its sign by the throw's type, and that
 * it is absent with no factor imported, with no Strength modifier, and where the
 * throw already declares a Strength score term. Actors, abilities and every
 * figure are invented.
 *
 * What the roll then posts, and the card a seat reads, are the live walk's
 * (docs/equipment/TESTING.md).
 *
 * Usage: node tools/test-lock-bash.mjs
 */
import assert from "node:assert/strict";

let passed = 0;
const ok = async (name, fn) => {
  await fn();
  passed++;
  console.log(`ok   ${name}`);
};

class Stub {}
globalThis.game = {
  user: { id: "u1", isGM: true },
  i18n: { localize: (k) => k, format: (k) => k, has: () => false },
  settings: { get: () => ({}) },
};
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.Hooks = { on() {}, once() {}, off() {}, call() {}, callAll() {} };
globalThis.foundry = {
  abstract: { DataModel: class {}, TypeDataModel: class {} },
  data: { regionBehaviors: { RegionBehaviorType: Stub }, fields: {} },
  utils: { escapeHTML: (s) => String(s), deepClone: (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v))) },
  applications: { api: { ApplicationV2: Stub, HandlebarsApplicationMixin: (B) => B, DialogV2: Stub }, handlebars: { renderTemplate: async () => "" } },
};

/** What the roller was asked: `[abilityName, key, options]`, one per roll. */
const rolled = [];
globalThis.acksExtras = {
  abilities: {
    rollsOf: (item) => item.rolls,
    // A failed throw leaves the container standing: nothing past the roll is under test.
    rollAbility: async (item, key, opts) => {
      rolled.push([item.name, key, opts]);
      return { success: false, total: 1 };
    },
  },
};

const { bashOpen, pickLock } = await import("../scripts/equipment/locks.mjs");
const { registerTable, unregisterTable, PRIORITY } = await import("../scripts/lib/tables.mjs");
const { FORMATION_DOC } = await import("../scripts/formation/constants.mjs");

/** An ability item holding one throw. */
const ability = (name, roll) => ({ id: name, type: "ability", name, rolls: [{ key: "main", rollType: "above", ...roll }] });
const basher = (strMod, throwRoll = {}) => ({
  id: "a1",
  name: "Tester",
  system: { scores: { str: { mod: strMod } } },
  items: [ability("Dungeonbashing", throwRoll), ability("Lockpicking", {})],
});
const crate = { id: "c1", name: "Crate" };
const factor = (n) => registerTable({ id: FORMATION_DOC, source: "invented", tables: { bashStrengthFactor: n } }, { priority: PRIORITY.WORLD, source: "test" });
const bashBonus = async (actor) => {
  rolled.length = 0;
  await bashOpen(actor, crate);
  assert.equal(rolled.length, 1, "one roll");
  return rolled[0][2].bonus;
};

await ok("a bash adds Strength at the imported factor to its roll", async () => {
  factor(3);
  try {
    assert.equal(await bashBonus(basher(2)), 6, "the modifier times the factor");
    assert.equal(await bashBonus(basher(-2)), -6, "a negative modifier is a negative term");
    assert.equal(rolled[0][0], "Dungeonbashing", "the Dungeonbashing ability is the one rolled");
    assert.equal(rolled[0][2].skipDialog, true, "still rolled without the dialog");
  } finally {
    unregisterTable(FORMATION_DOC, "test");
  }
});

await ok("a bash adds no term with no factor imported or no Strength modifier", async () => {
  assert.equal(await bashBonus(basher(2)), 0, "no factor: nothing stands in, and the roll is still made");
  factor(3);
  try {
    assert.equal(await bashBonus(basher(0)), 0, "a modifier of zero needs no figure");
  } finally {
    unregisterTable(FORMATION_DOC, "test");
  }
});

await ok("the term follows the throw's type, and a throw that carries Strength already is not counted twice", async () => {
  factor(3);
  try {
    assert.equal(await bashBonus(basher(2, { rollType: "below" })), -6, "a roll-under throw takes it away");
    assert.equal(await bashBonus(basher(2, { rollType: "result" })), 0, "an exact-match throw takes none");
    assert.equal(await bashBonus(basher(2, { score: { key: "str", times: 1 } })), 0, "a Strength score term on the throw already carries it");
    assert.equal(await bashBonus(basher(2, { score: { key: "dex", times: 1 } })), 6, "another score's term does not");
  } finally {
    unregisterTable(FORMATION_DOC, "test");
  }
});

await ok("picking a lock takes no Strength term", async () => {
  factor(3);
  try {
    rolled.length = 0;
    const locked = { id: "c2", name: "Chest", flags: { "acks-extras": { container: { locked: true } } }, getFlag() {} };
    const actor = basher(2);
    await pickLock(actor, locked);
    assert.deepEqual(rolled.map(([name]) => name), ["Lockpicking"], "the pick rolls its own ability");
    assert.equal(rolled[0][2].bonus, 0, "and carries no bonus");
  } finally {
    unregisterTable(FORMATION_DOC, "test");
  }
});

/* -------------------------------------------- */
/*  Who may pass a lock: the key, the Judge     */
/* -------------------------------------------- */

const containers = await import("../scripts/equipment/containers.mjs");
const locksMod = await import("../scripts/equipment/locks.mjs");

/** A locked container whose record lists `keys`, answering `getFlag` the way a document does. */
const lockedBox = (keys = [{ uuid: "Item.key1", name: "Brass Key" }]) => {
  const record = { locked: true, keys };
  return { id: "box1", name: "Strongbox", getFlag: (scope, key) => (scope === "acks-extras" && key === "container" ? record : undefined) };
};
/** A character carrying `items`; an item is `{id, name, uuid?, source?}`. */
const carrier = (items = []) => ({
  id: "ch1",
  name: "Tester",
  items: items.map((i) => ({ uuid: `Actor.ch1.Item.${i.id}`, ...i, _stats: { compendiumSource: i.source ?? null }, flags: {} })),
});
const asSeat = (isGM) => {
  globalThis.game.user = { id: "u1", isGM };
};
/** What `ui.notifications.warn` was handed, with the data each message was formatted with. */
const warned = [];
globalThis.ui.notifications.warn = (m) => warned.push(m);
globalThis.game.i18n.format = (k, d = {}) => `${k}|${JSON.stringify(d)}`;

await ok("a held key is told by the item's own uuid, the uuid it was made from, or its name", async () => {
  const box = lockedBox();
  assert.equal(containers.holdsKey(carrier([{ id: "k", name: "Other", uuid: "Item.key1" }]), box), true, "the listed document itself");
  assert.equal(containers.holdsKey(carrier([{ id: "k", name: "Other", source: "Item.key1" }]), box), true, "a copy made from a compendium key");
  assert.equal(containers.holdsKey(carrier([{ id: "k", name: " brass KEY " }]), box), true, "a world copy keeps only its name");
  assert.equal(containers.holdsKey(carrier([{ id: "k", name: "Iron Key" }]), box), false, "another key is not this one");
  assert.equal(containers.holdsKey(carrier([{ id: "box1", name: "Brass Key" }]), box), false, "the container is never its own key");
  assert.equal(containers.holdsKey(carrier([{ id: "k", name: "Brass Key" }]), lockedBox([])), false, "a lock listing no key has none to hold");
});

await ok("a key listed from a compendium is told by its link, never by a shared name", async () => {
  const COMP = "Compendium.world.keys.Item.k1";
  const box = lockedBox([{ uuid: COMP, name: "Brass Key", source: COMP }]);
  assert.equal(containers.holdsKey(carrier([{ id: "k", name: "Brass Key" }]), box), false, "an unrelated item sharing only the name");
  assert.equal(containers.holdsKey(carrier([{ id: "k", name: "Renamed", source: COMP }]), box), true, "a copy whose compendiumSource is the key");
  const oldBox = lockedBox([{ uuid: COMP, name: "Brass Key" }]);
  assert.equal(containers.holdsKey(carrier([{ id: "k", name: "Brass Key" }]), oldBox), false, "a key listed with no source is a compendium key by its uuid");
  const world = lockedBox([{ uuid: "Item.abc", name: "Brass Key", source: null }]);
  assert.equal(containers.holdsKey(carrier([{ id: "k", name: "brass key" }]), world), true, "a world key is still held by a same-named unlinked copy");
  const viaWorldSource = lockedBox([{ uuid: "Item.abc", name: "Brass Key", source: COMP }]);
  assert.equal(containers.holdsKey(carrier([{ id: "k", name: "Brass Key" }]), viaWorldSource), false, "a key whose own origin is a compendium is not told by name");
});

await ok("one key dropped from its compendium and from an inventory is the same key", async () => {
  const COMP = "Compendium.world.keys.Item.k1";
  const entry = { uuid: COMP, name: "Brass Key", source: COMP };
  const imported = { uuid: "Actor.ch1.Item.x", name: "Brass Key", _stats: { compendiumSource: COMP }, flags: {} };
  assert.equal(containers.sameKey(entry, imported), true, "an imported copy carries the compendium uuid");
  assert.equal(containers.sameKey(entry, { uuid: COMP, name: "Brass Key", _stats: {}, flags: {} }), true, "the compendium document again");
  assert.equal(containers.sameKey(entry, { uuid: "Actor.ch1.Item.y", name: "Brass Key", _stats: {}, flags: {} }), false, "a same-named item with no link is another item");
  const fromActor = { uuid: "Actor.ch1.Item.x", name: "Brass Key", source: COMP };
  const twin = { uuid: "Actor.ch2.Item.z", name: "Brass Key", _stats: { duplicateSource: "Actor.ch1.Item.x" }, flags: {} };
  assert.equal(containers.sameKey(fromActor, twin), true, "a duplicate of a listed copy");
  const viaFlag = { uuid: "Actor.ch3.Item.q", name: "Brass Key", _stats: {}, flags: { core: { sourceId: COMP } } };
  assert.equal(containers.sameKey(entry, viaFlag), true, "a copy linked by core's sourceId flag");
});

await ok("an owner holding the key unlocks; with none a Player is blocked and a Judge goes ahead warned", async () => {
  const keyHolder = carrier([{ id: "k", name: "Brass Key" }]);
  const bare = carrier();
  const box = lockedBox();
  asSeat(false);
  assert.deepEqual(containers.lockBypass(keyHolder, box), { allowed: true, warn: false }, "a Player with the key");
  assert.deepEqual(containers.lockBypass(bare, box), { allowed: false, warn: false }, "a Player without it is blocked");
  assert.deepEqual(containers.lockBypass(bare, { ...box, getFlag: () => ({}) }), { allowed: true, warn: false }, "a container that is not locked needs no key");
  asSeat(true);
  assert.deepEqual(containers.lockBypass(bare, box), { allowed: true, warn: true }, "a Judge without it goes ahead, with a warning");
  assert.deepEqual(containers.lockBypass(keyHolder, box), { allowed: true, warn: false }, "a Judge with it has nothing to be warned of");
});

await ok("passLock says what was refused: the Player's block, the Judge's warning, and nothing for a key or an open lock", async () => {
  const box = lockedBox();
  warned.length = 0;
  asSeat(false);
  assert.equal(await locksMod.passLock(carrier(), box, "unlock"), false, "a Player with no key is blocked");
  assert.equal(warned.length, 1, "and told so");
  assert.ok(warned[0].includes("bypassBlocked") && warned[0].includes('"name":"Strongbox"'), "naming the container");
  assert.ok(warned[0].includes("bypassAction.unlock"), "and the action refused");
  warned.length = 0;
  asSeat(true);
  assert.equal(await locksMod.passLock(carrier(), box, "empty"), true, "a Judge goes ahead");
  assert.equal(warned.length, 1, "with one warning");
  assert.ok(warned[0].includes("bypassWarn") && warned[0].includes("bypassAction.empty"), "that names what a Player would have been refused");
  warned.length = 0;
  asSeat(false);
  assert.equal(await locksMod.passLock(carrier([{ id: "k", name: "Brass Key" }]), box, "unlock"), true, "a Player holding the key passes");
  assert.equal(await locksMod.passLock(carrier(), { ...box, getFlag: () => ({}) }, "unlock"), true, "an open container passes");
  assert.equal(warned.length, 0, "neither says anything");
});

console.log(`\ntest-lock-bash: ${passed} passed`);
