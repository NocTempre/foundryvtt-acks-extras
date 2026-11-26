/**
 * The maneuver save card (`scripts/equipment/maneuver-save.mjs`), offline: when
 * a maneuver that calls a save asks it (`maneuverSavePost`), what the card names
 * and when it falls to the Judge's blank card (`maneuverSaveMods`), the post a
 * resolved attack makes (`settleManeuver`), and the writer of the Save press
 * (`maneuverSaveOutcome`), which writes nothing. Every figure below is invented.
 *
 * Usage: node tools/test-maneuver-save.mjs
 */
import assert from "node:assert/strict";

const SETTINGS_STATE = { overlayManeuvers: true };
globalThis.acksExtras ??= {};
globalThis.Hooks = { once() {}, on() {}, callAll() {} };
class ForcedDeletion {}
globalThis.foundry = {
  utils: { randomID: () => "rid", getProperty: (o, p) => p.split(".").reduce((a, k) => (a == null ? a : a[k]), o) },
  data: { operators: { ForcedDeletion } },
  applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (B) => class extends B {}, DialogV2: class {} }, handlebars: { loadTemplates() {} }, instances: new Map() },
};
const gameStub = {
  i18n: { format: (key, data) => `${key}${data ? JSON.stringify(data) : ""}`, localize: (key) => key, has: () => false },
  users: [],
  user: { isGM: true },
  time: { worldTime: 1000 },
  settings: { get: (_m, key) => (key === "defaultHandBudget" ? 2 : key === "enforceMode" ? "resolve" : SETTINGS_STATE[key]) },
};
globalThis.game = gameStub;
globalThis.ui = { notifications: { warn() {}, error() {}, info() {} } };
globalThis.CONST = { ACTIVE_EFFECT_CHANGE_TYPES: { custom: 0, multiply: 10, add: 20, subtract: 20, downgrade: 30, upgrade: 40, override: 50 } };

const { useWeaponFixture } = await import("./weapon-fixture.mjs");
useWeaponFixture();
const { registerTable, unregisterTable, PRIORITY } = await import("../scripts/lib/tables.mjs");
const { classifyWeapon } = await import("../scripts/equipment/profiles.mjs");
const { cardSaveOptions } = await import("../scripts/lib/item-run.mjs");
const { MANEUVERS } = await import("../scripts/equipment/overlays/maneuvers.mjs");
const { maneuverSavePost, maneuverSaveMods, maneuverSaveOutcome, settleManeuver, installManeuverSave, MANEUVER_SAVE_KIND } = await import("../scripts/equipment/maneuver-save.mjs");

let passed = 0;
const t = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

const FIGURES = {
  id: "equipment",
  tables: {
    maneuverDisarm: { disarm: -7, twoHandedSave: 3 },
    maneuverPenalties: { forceBack: -8, incapacitate: -9, knockDown: -11, overrun: -12, wrestling: -13, sunder: -15, sunderShaft: -10 },
    combatTrickery: { reduction: 3, noSaveReduction: 6, saveMod: -5 },
    maneuverQualities: { entangling: 8, flexible: 10, incapacitating: 12 },
    hookedWeapon: { reduction: 5, saveMod: -7 },
  },
};
registerTable(FIGURES, { priority: PRIORITY.WORLD, source: "test" });

const weaponItem = (name, over = {}) => ({
  id: over.id ?? name.replace(/\W/g, ""),
  uuid: `Actor.x.Item.${over.id ?? name.replace(/\W/g, "")}`,
  name,
  type: "weapon",
  system: {
    equipped: over.equipped ?? true, cost: 0, weight6: 0,
    damage: { base: { formula: "1d6" }, alternate: { formula: "" } },
    bonus: { attack: 0, damage: 0 }, melee: over.melee ?? true, missile: over.missile, customTags: [], special: {},
  },
  getFlag: (_m, k) => (over.flags ?? {})[k],
  effects: [],
});
const actorOf = (items, over = {}) => {
  const list = items.slice();
  return {
    id: over.id ?? "a1",
    uuid: over.uuid ?? "Actor.a1",
    name: over.name ?? "Fighter",
    type: over.type ?? "character",
    items: Object.assign(list, { get: (id) => list.find((i) => i.id === id) }),
    system: over.system ?? {},
    effects: over.effects ?? [],
    appliedEffects: over.effects ?? [],
    getFlag: (_m, k) => (k === "extras" && over.size ? { size: over.size } : (over.flags ?? {})[k]),
  };
};
const trickeryOn = (key) => ({ id: "fx", name: "t", disabled: false, changes: [{ key: "flags.acks-extras.maneuverTrickery", value: key }], flags: { "acks-extras": {} } });

const sword = weaponItem("Sword", { id: "sw" });
const swordProfile = classifyWeapon(sword);
const attacker = { uuid: "Actor.a1", name: "Fighter" };
const target = { uuid: "Scene.s.Token.t", name: "Goblin" };
const READ = { save: "paralysis", targetSaveMod: -3, saveParts: [{ part: "trickery", value: -3, table: "combatTrickery" }], unread: [] };

/* The card spec. */

await t("the card kind is the one the equipment registers", () => {
  assert.equal(MANEUVER_SAVE_KIND, "maneuverSave");
});

await t("no card on a miss, with no target token, or for a maneuver that calls no save", () => {
  assert.equal(maneuverSavePost({ maneuver: "knockDown", isHit: false, target, attacker, weapon: sword, mods: READ }), null);
  assert.equal(maneuverSavePost({ maneuver: "knockDown", isHit: undefined, target, attacker, weapon: sword, mods: READ }), null, "only a true hit asks");
  assert.equal(maneuverSavePost({ maneuver: "knockDown", isHit: true, target: null, attacker, weapon: sword, mods: READ }), null);
  assert.equal(maneuverSavePost({ maneuver: "incapacitate", isHit: true, target, attacker, weapon: sword, mods: READ }), null, "incapacitate calls no save");
  assert.equal(maneuverSavePost({ maneuver: "nonsense", isHit: true, target, attacker, weapon: sword, mods: READ }), null);
  assert.equal(maneuverSavePost({ maneuver: null, isHit: true, target, attacker, weapon: sword, mods: READ }), null);
});

await t("every maneuver that names a save posts one, and the one that names none does not", () => {
  for (const [key, m] of Object.entries(MANEUVERS)) {
    const post = maneuverSavePost({ maneuver: key, isHit: true, target, attacker, weapon: sword, mods: { ...READ, save: m.save } });
    assert.equal(post !== null, m.save !== null, key);
  }
});

await t("a hit with a read modifier posts the card for the struck token, spoken for by the attacker", () => {
  const post = maneuverSavePost({ maneuver: "knockDown", isHit: true, target, attacker, weapon: sword, mods: READ });
  assert.equal(post.kind, "maneuverSave");
  assert.equal(post.itemUuid, sword.uuid);
  assert.deepEqual(post.subjects, [{ key: "Scene.s.Token.t", name: "Goblin" }], "one subject: the target, whose owners press the save");
  assert.equal(post.speakerActorUuid, "Actor.a1", "the attacker's owners may post it");
  assert.equal(post.saveName, "paralysis");
  assert.equal(post.saveMod, -3);
  assert.match(post.title, /Knock Down/);
  assert.match(post.title, /Fighter/);
  assert.match(post.title, /Goblin/);
  assert.equal(post.facts.maneuver, "knockDown");
  assert.ok(post.facts.cite, "the page reference rides the card");
  assert.match(post.facts.saveLabel, /Knock Down/);
  assert.match(post.facts.saveLabel, /−3/, "the label names the part's figure");
});

await t("a positive modifier helps the saver, as the card's save reads it", () => {
  const post = maneuverSavePost({ maneuver: "disarm", isHit: true, target, attacker, weapon: sword, mods: { ...READ, targetSaveMod: 3, saveParts: [{ part: "twoHanded", value: 3, table: "maneuverDisarm" }] } });
  assert.equal(post.saveMod, 3);
  assert.deepEqual(cardSaveOptions({ saveMod: post.saveMod }), { situational: 3 });
  const worse = maneuverSavePost({ maneuver: "disarm", isHit: true, target, attacker, weapon: sword, mods: READ });
  assert.deepEqual(cardSaveOptions({ saveMod: worse.saveMod }), { situational: -3 });
});

await t("a maneuver's save is no throw against magic: the card's save takes no magical parts", () => {
  const post = maneuverSavePost({ maneuver: "knockDown", isHit: true, target, attacker, weapon: sword, mods: READ });
  assert.equal(post.facts.saveMagical, false);
  assert.equal(cardSaveOptions({ saveMod: post.saveMod, saveMagical: post.facts.saveMagical }).magical, false);
  assert.equal(cardSaveOptions({ saveMod: 2 }).magical, undefined, "a card that says nothing keeps saveSpec's default");
});

await t("a zero modifier names the save and no figure", () => {
  const post = maneuverSavePost({ maneuver: "knockDown", isHit: true, target, attacker, weapon: sword, mods: { ...READ, targetSaveMod: 0, saveParts: [] } });
  assert.equal(post.saveName, "paralysis");
  assert.equal(post.saveMod, null, "never a +0");
});

await t("a save that cannot be read posts the Judge's card with a blank save name", () => {
  const blank = (mods) => maneuverSavePost({ maneuver: "knockDown", isHit: true, target, attacker, weapon: sword, mods });
  for (const mods of [{ ...READ, targetSaveMod: null }, { ...READ, unread: ["size"] }, { ...READ, unread: ["grip"] }, null, undefined]) {
    const post = blank(mods);
    assert.ok(post, "the card is still posted");
    assert.equal(post.saveName, "");
    assert.equal(post.saveMod, null, "never a figure beside no save");
    assert.equal(post.facts.saveLabel, undefined);
    assert.deepEqual(post.subjects, [{ key: "Scene.s.Token.t", name: "Goblin" }]);
  }
});

/* What the save reads. */

await t("the target's save modifier is the imported parts', each named", () => {
  const trick = actorOf([sword], { effects: [trickeryOn("knockDown")] });
  const foe = actorOf([], { type: "monster", size: "man", uuid: "Actor.m", id: "m" });
  const mods = maneuverSaveMods({ actor: trick, weapon: sword, key: "knockDown", target: foe }, { mounted: () => false });
  assert.equal(mods.targetSaveMod, -5);
  assert.deepEqual(mods.saveParts, [{ part: "trickery", value: -5, table: "combatTrickery" }]);
  assert.deepEqual(mods.unread, []);
  assert.equal(mods.save, "paralysis");
});

await t("a part not imported leaves the modifier null, so the card is blank", () => {
  unregisterTable("equipment", { priority: PRIORITY.WORLD });
  registerTable({ id: "equipment", tables: { ...FIGURES.tables, combatTrickery: undefined } }, { priority: PRIORITY.WORLD, source: "test" });
  try {
    const trick = actorOf([sword], { effects: [trickeryOn("knockDown")] });
    const foe = actorOf([], { type: "monster", size: "man", uuid: "Actor.m", id: "m" });
    const mods = maneuverSaveMods({ actor: trick, weapon: sword, key: "knockDown", target: foe }, { mounted: () => false });
    assert.equal(mods.targetSaveMod, null);
    const post = maneuverSavePost({ maneuver: "knockDown", isHit: true, target, attacker, weapon: sword, mods });
    assert.equal(post.saveName, "");
  } finally {
    unregisterTable("equipment", { priority: PRIORITY.WORLD });
    registerTable(FIGURES, { priority: PRIORITY.WORLD, source: "test" });
  }
});

await t("a size-adjusted maneuver is read only between creatures of one known size, and where neither is mounted", () => {
  const me = actorOf([sword], { size: "man" });
  const read = (foe, deps = { mounted: () => false }) => maneuverSaveMods({ actor: me, weapon: sword, key: "knockDown", target: foe }, deps);
  assert.deepEqual(read(actorOf([], { type: "monster", size: "man", id: "m" })).unread, []);
  assert.deepEqual(read(actorOf([], { type: "monster", size: "giant", id: "m" })).unread, ["size"], "no size figure is imported");
  assert.deepEqual(read(actorOf([], { type: "monster", id: "m" })).unread, ["size"], "a size the stat block does not state");
  assert.deepEqual(read(actorOf([], { type: "monster", size: "man", id: "m" }), { mounted: (a) => a.id === "m" }).unread, ["size"], "a mount's size stands for a rider's");
  assert.deepEqual(maneuverSaveMods({ actor: me, weapon: sword, key: "overrun", target: actorOf([], { type: "monster", size: "giant", id: "m" }) }, { mounted: () => false }).unread, [], "overrun is not size-adjusted here");
});

await t("sunder's save depends on the struck weapon, which the attack does not name", () => {
  const me = actorOf([sword], { size: "man" });
  const mods = maneuverSaveMods({ actor: me, weapon: sword, key: "sunder", target: actorOf([], { size: "man", id: "m" }) }, { mounted: () => false });
  assert.deepEqual(mods.unread, ["struck"]);
});

await t("disarm reads the grip of the one weapon the target holds", () => {
  const me = actorOf([sword], { size: "man" });
  const run = (foe) => maneuverSaveMods({ actor: me, weapon: sword, key: "disarm", target: foe }, { mounted: () => false });
  const greatAxe = weaponItem("Great Axe", { id: "ga" });
  const twoHanded = run(actorOf([greatAxe], { id: "f", system: { scores: { str: { mod: 1 }, dex: { mod: 1 } } } }));
  assert.deepEqual(twoHanded.unread, []);
  assert.equal(twoHanded.targetSaveMod, 3, "a weapon held in both hands is harder to take");
  assert.deepEqual(twoHanded.saveParts, [{ part: "twoHanded", value: 3, table: "maneuverDisarm" }]);
  const oneHanded = run(actorOf([weaponItem("Dagger", { id: "dg" })], { id: "f" }));
  assert.deepEqual(oneHanded.unread, []);
  assert.equal(oneHanded.targetSaveMod, 0, "a one-handed grip adds nothing");
  assert.deepEqual(oneHanded.saveParts, []);
  assert.deepEqual(run(actorOf([], { id: "f" })).unread, ["grip"], "no weapon held is the Judge's");
  assert.deepEqual(run(actorOf([sword, weaponItem("Dagger", { id: "dg" })], { id: "f" })).unread, ["grip"], "two held is the Judge's");
  assert.deepEqual(run(actorOf([], { type: "monster", id: "f" })).unread, ["grip"], "a creature with no loadout is the Judge's");
});

await t("a no-save maneuver reads no unread part", () => {
  const me = actorOf([sword], { size: "man" });
  const mods = maneuverSaveMods({ actor: me, weapon: sword, key: "incapacitate", target: actorOf([], { size: "giant", id: "m" }) }, { mounted: () => false });
  assert.equal(mods.save, null);
  assert.deepEqual(mods.unread, []);
  assert.equal(maneuverSaveMods({ actor: me, weapon: sword, key: "nonsense", target: null }), null);
  void swordProfile;
});

/* The attack's post. */

const hitOutcome = (over = {}) => ({ resolution: { isHit: true }, result: { target }, ...over });
const flush = () => new Promise((r) => setTimeout(r, 0));

await t("a resolved maneuver that hits posts the card through the runner's post", async () => {
  const me = actorOf([sword], { size: "man" });
  const foeActor = actorOf([], { type: "monster", size: "man", uuid: "Actor.m", id: "m" });
  const ctx = { maneuver: "knockDown", weapon: sword, target: { ...target, actor: foeActor } };
  const posted = [];
  settleManeuver({ actor: me, item: sword, ctx, outcome: hitOutcome() }, { post: async (card) => posted.push(card), mounted: () => false });
  await flush();
  assert.equal(posted.length, 1);
  assert.equal(posted[0].kind, "maneuverSave");
  assert.equal(posted[0].saveName, "paralysis");
  assert.equal(posted[0].saveMod, null, "nothing imposed, nothing shown");
  assert.equal(posted[0].subjects[0].key, "Scene.s.Token.t");
});

await t("no card on a miss, with the overlay off, for no maneuver, for a no-save maneuver, or with no target", async () => {
  const me = actorOf([sword], { size: "man" });
  const calls = [];
  const post = async (card) => calls.push(card);
  const ctx = (maneuver) => ({ maneuver, weapon: sword, target: { ...target, actor: actorOf([], { type: "monster", size: "man", id: "m" }) } });
  settleManeuver({ actor: me, item: sword, ctx: ctx("knockDown"), outcome: { resolution: { isHit: false }, result: { target } } }, { post, mounted: () => false });
  settleManeuver({ actor: me, item: sword, ctx: ctx(null), outcome: hitOutcome() }, { post, mounted: () => false });
  settleManeuver({ actor: me, item: sword, ctx: ctx("incapacitate"), outcome: hitOutcome() }, { post, mounted: () => false });
  settleManeuver({ actor: me, item: sword, ctx: { ...ctx("knockDown"), target: null }, outcome: { resolution: { isHit: true }, result: {} } }, { post, mounted: () => false });
  SETTINGS_STATE.overlayManeuvers = false;
  try {
    settleManeuver({ actor: me, item: sword, ctx: ctx("knockDown"), outcome: hitOutcome() }, { post, mounted: () => false });
  } finally {
    SETTINGS_STATE.overlayManeuvers = true;
  }
  await flush();
  assert.equal(calls.length, 0);
});

await t("the target falls back to the attack context's", async () => {
  const me = actorOf([sword], { size: "man" });
  const posted = [];
  const ctx = { maneuver: "wrestling", weapon: sword, target: { ...target, actor: actorOf([], { type: "monster", size: "man", id: "m" }) } };
  settleManeuver({ actor: me, item: sword, ctx, outcome: { resolution: { isHit: true }, result: {} } }, { post: async (c) => posted.push(c), mounted: () => false });
  await flush();
  assert.equal(posted[0]?.subjects[0].key, "Scene.s.Token.t");
});

await t("a target with no actor still posts, as the Judge's card", async () => {
  const me = actorOf([sword], { size: "man" });
  const posted = [];
  const ctx = { maneuver: "knockDown", weapon: sword, target: { ...target, actor: null } };
  settleManeuver({ actor: me, item: sword, ctx, outcome: hitOutcome() }, { post: async (c) => posted.push(c), mounted: () => false });
  await flush();
  assert.equal(posted[0].saveName, "");
});

await t("a failed read or a failed post is logged and never thrown", async () => {
  const logged = [];
  const saved = console.error;
  console.error = (...a) => logged.push(a);
  try {
    const me = actorOf([sword], { size: "man" });
    const ctx = { maneuver: "knockDown", weapon: sword, target: { ...target, actor: actorOf([], { type: "monster", size: "man", id: "m" }) } };
    assert.doesNotThrow(() => settleManeuver({ actor: me, item: sword, ctx, outcome: hitOutcome() }, { post: async () => { throw new Error("post"); }, mounted: () => false }));
    assert.doesNotThrow(() => settleManeuver({ actor: me, item: sword, ctx, outcome: hitOutcome() }, { post: async () => {}, mounted: () => { throw new Error("read"); } }));
    await flush();
  } finally {
    console.error = saved;
  }
  assert.equal(logged.length, 2);
});

/* The attack path: the post-attack hook the equipment registers, through lib's runner. */

await t("a maneuver attack that hits reaches lib's card post by the post-attack hook, and a miss does not", async () => {
  const { setUsePresenter } = await import("../scripts/lib/item-run.mjs");
  await installManeuverSave();
  const { POST_ATTACK_HOOK } = await import("../scripts/lib/patches/attack-throw.mjs");
  const listeners = {};
  globalThis.Hooks = { on: (name, fn) => (listeners[name] ??= []).push(fn), once() {}, callAll() {} };
  const { registerRollWrap } = await import("../scripts/equipment/roll-wrap.mjs");
  registerRollWrap();
  assert.equal(listeners[POST_ATTACK_HOOK]?.length, 1, "the equipment listens for the resolved attack");
  const me = actorOf([sword], { size: "man", uuid: "Actor.a1" });
  const foe = actorOf([], { type: "monster", size: "man", uuid: "Actor.m", id: "m" });
  const savedFrom = globalThis.fromUuidSync;
  globalThis.fromUuidSync = (uuid) => (uuid === "Actor.a1" ? { ...me, testUserPermission: () => true } : null);
  const results = [];
  setUsePresenter(async (result) => results.push(result));
  try {
    const ctx = { maneuver: "knockDown", weapon: { id: "sw" }, type: "melee", target: { ...target, actor: foe } };
    const [listener] = listeners[POST_ATTACK_HOOK];
    listener(me, ctx, { resolution: { isHit: false }, result: { target, attackType: "melee" } });
    await flush();
    assert.equal(results.length, 0, "a miss asks no save");
    listener(me, ctx, { resolution: { isHit: true }, result: { target, attackType: "melee" } });
    await flush();
    assert.equal(results.length, 1);
    assert.equal(results[0].kind, "maneuverSave");
    assert.equal(results[0].saveName, "paralysis");
    assert.deepEqual(results[0].subjects, [{ key: "Scene.s.Token.t", name: "Goblin" }]);
    listener(me, { ...ctx, maneuver: null }, { resolution: { isHit: true }, result: { target, attackType: "melee" } });
    await flush();
    assert.equal(results.length, 1, "an ordinary attack asks none");
  } finally {
    setUsePresenter(null);
    globalThis.fromUuidSync = savedFrom;
  }
});

/* The Save press. */

await t("the Save press writes nothing to either actor, whatever the verdict", () => {
  const none = { records: [], names: [], life: "raised" };
  assert.deepEqual(maneuverSaveOutcome({ phase: "verdict", saved: true, card: {} }), none);
  assert.deepEqual(maneuverSaveOutcome({ phase: "verdict", saved: false, card: {} }), none);
  assert.deepEqual(maneuverSaveOutcome({ phase: "apply", saved: false, card: {} }), none);
  assert.deepEqual(maneuverSaveOutcome(), none);
});

await t("installManeuverSave registers the writer without a world", async () => {
  await installManeuverSave();
});

console.log(`\n${passed} passed`);
