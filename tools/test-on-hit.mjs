/**
 * On-hit ammunition (`scripts/equipment/on-hit.mjs`), offline: when a shot asks a
 * save and what the card carries (`onHitPost`), that the stack is read before
 * the spend can empty it (`settleShot`), and what the Save press writes
 * (`onHitOutcome`): nothing on a pass, one delayed-damage record on the world
 * clock on a fail, nothing and the Judge's line on a blank figure.
 * Every name and figure below is invented.
 *
 * Usage: node tools/test-on-hit.mjs
 */
import assert from "node:assert/strict";
import { TURN_SECONDS } from "./time-unit-fixture.mjs";

globalThis.Hooks = { once() {}, on() {}, callAll() {} };
class ForcedDeletion {}
globalThis.foundry = { utils: { randomID: () => "rid" }, data: { operators: { ForcedDeletion } } };
const gameStub = { i18n: { format: (key) => key, localize: (key) => key, has: () => false }, users: [], user: { isGM: true }, time: { worldTime: 1000 }, settings: { get: () => true } };
globalThis.game = gameStub;
globalThis.ui = { notifications: { warn() {}, error() {}, info() {} } };

const { onHitPost, onHitOutcome, settleShot, installOnHit } = await import("../scripts/equipment/on-hit.mjs");
const { ITEM_FLAGS, MODULE_ID } = await import("../scripts/equipment/constants.mjs");
const { FLAG_DELAYED_DAMAGE, FLAG_DRINK } = await import("../scripts/lib/constants.mjs");
const { WEAPON_CATEGORY } = await import("../scripts/equipment/config.mjs");

let passed = 0;
const t = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

const FLAG = { saveKind: "sk", saveMod: -2, formula: "3d5", delayTurns: 4, source: "Row Q", cite: "XX p. 9" };
const stackOf = (flag, over = {}) => ({
  uuid: "Actor.a.Item.s",
  name: "Quiver, 9 Arrows",
  type: "item",
  system: { quantity: 9 },
  getFlag: (_m, key) => (key === "onHit" ? flag : undefined),
  ...over,
});
const attacker = { uuid: "Actor.a", name: "Archer" };
const target = { uuid: "Scene.s.Token.t", name: "Target" };

await t("the card flag keys stay as the equipment and lib name them", () => {
  assert.equal(ITEM_FLAGS.DRINK, FLAG_DRINK, "equipment's drink flag is lib's");
});

await t("no card on a miss, with no target token, or from a stack with no hit effect", () => {
  assert.equal(onHitPost({ stack: stackOf(FLAG), isHit: false, target, attacker }), null);
  assert.equal(onHitPost({ stack: stackOf(FLAG), isHit: undefined, target, attacker }), null, "only a true hit asks");
  assert.equal(onHitPost({ stack: stackOf(FLAG), isHit: true, target: null, attacker }), null);
  assert.equal(onHitPost({ stack: stackOf(undefined), isHit: true, target, attacker }), null);
  assert.equal(onHitPost({ stack: stackOf({ formula: "1d4" }), isHit: true, target, attacker }), null, "a flag with no count of turns is no effect");
  assert.equal(onHitPost({ stack: null, isHit: true, target, attacker }), null);
});

await t("a hit with a flagged stack posts the card for the struck token", () => {
  assert.deepEqual(onHitPost({ stack: stackOf(FLAG), isHit: true, target, attacker }), {
    kind: "onHit",
    itemUuid: "Actor.a.Item.s",
    title: "Row Q",
    subtitle: "Archer",
    subjects: [{ key: "Scene.s.Token.t", name: "Target" }],
    saveName: "sk",
    saveMod: -2,
    facts: { formula: "3d5", delayTurns: 4, source: "Row Q", cite: "XX p. 9", struckAt: null },
    speakerActorUuid: "Actor.a",
  });
});

await t("the strike's world time is stored and the delay counts from it", () => {
  const post = onHitPost({ stack: stackOf(FLAG), isHit: true, target, attacker, now: 500 });
  assert.equal(post.facts.struckAt, 500);
  assert.equal(onHitPost({ stack: stackOf(FLAG), isHit: true, target, attacker, now: undefined }).facts.struckAt, null);
});

await t("a blank source names the card by the stack, and a blank save stays blank", () => {
  const post = onHitPost({ stack: stackOf({ formula: "1d4", delayTurns: 2 }), isHit: true, target, attacker });
  assert.equal(post.title, "Quiver, 9 Arrows");
  assert.equal(post.saveName, "");
  assert.equal(post.saveMod, null, "a blank modifier is null, never zero");
  assert.deepEqual(post.facts, { formula: "1d4", delayTurns: 2, source: "", cite: "", struckAt: null });
});

await t("a passed save writes nothing", () => {
  assert.deepEqual(onHitOutcome({ phase: "verdict", saved: true, card: { ...FLAG, title: "Row Q" } }), { records: [], names: [], life: "raised" });
});

await t("a failed save writes one record on the world clock, the formula rolled when due", () => {
  const done = onHitOutcome({ phase: "verdict", saved: false, card: { ...FLAG, title: "Row Q" } });
  assert.equal(done.records.length, 1);
  assert.equal(done.life, "timed");
  assert.deepEqual(done.names, ["Row Q"]);
  const flag = done.records[0].flags[MODULE_ID][FLAG_DELAYED_DAMAGE];
  assert.deepEqual(flag, { dueAt: 1000 + 4 * TURN_SECONDS, amount: null, formula: "3d5", source: "Row Q", cite: "XX p. 9" });
  assert.equal(done.records[0].name, "Row Q");
  assert.ok(!("combatId" in flag), "no combat clock beside the world's");
});

await t("a card with no formula, no count or no readable clock writes nothing and is the Judge's", () => {
  const judge = { records: [], names: [], life: "raised", state: "judge", judge: true, why: "figure" };
  assert.deepEqual(onHitOutcome({ phase: "verdict", saved: false, card: { ...FLAG, formula: "" } }), judge);
  assert.deepEqual(onHitOutcome({ phase: "verdict", saved: false, card: { ...FLAG, delayTurns: null } }), judge);
  assert.deepEqual(onHitOutcome({ phase: "verdict", saved: false, card: { ...FLAG, delayTurns: 0 } }), judge);
  const saved = gameStub.time.worldTime;
  gameStub.time.worldTime = null;
  try {
    assert.deepEqual(onHitOutcome({ phase: "verdict", saved: false, card: FLAG }), judge, "an unreadable clock");
  } finally {
    gameStub.time.worldTime = saved;
  }
});

await t("any phase but the Save press writes nothing", () => {
  assert.deepEqual(onHitOutcome({ phase: "apply", saved: false, card: FLAG }), { records: [], names: [], life: "raised" });
});

await t("installOnHit registers the writer without a world", async () => {
  await installOnHit();
});

/* The shot: the stack is read before the spend empties it. */
const bow = { id: "w", name: "Zorgle Bow", type: "weapon", system: { missile: true, melee: false } };
const profile = { cat: WEAPON_CATEGORY.BOW_CROSSBOW, key: "zorgle" };
const lastArrow = () => {
  const s = stackOf(FLAG, { name: "Quiver, 1 Arrows", system: { quantity: 1 } });
  return s;
};
const actorWith = (stack) => ({ uuid: "Actor.a", name: "Archer", items: [bow, stack] });

await t("the spend that empties the stack does not hide it from the card", async () => {
  const stack = lastArrow();
  const actor = actorWith(stack);
  const order = [];
  const spend = async () => {
    order.push("spend");
    stack.system.quantity = 0;
  };
  const posted = [];
  const post = async (card) => {
    order.push("post");
    posted.push(card);
  };
  settleShot({ actor, item: bow, ctx: {}, outcome: { resolution: { isHit: true }, result: { target } }, type: "missile", profile }, { spend, post });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(order, ["spend", "post"]);
  assert.equal(posted.length, 1, "the emptied stack still asked its save");
  assert.equal(posted[0].itemUuid, "Actor.a.Item.s");
});

await t("the spend is called as it always was, and a miss or a missing target posts nothing", async () => {
  const calls = [];
  const spend = async (...args) => calls.push(args);
  const post = async () => assert.fail("no card");
  const actor = actorWith(stackOf(FLAG));
  settleShot({ actor, item: bow, outcome: { resolution: { isHit: false }, result: { target } }, type: "missile", profile }, { spend, post });
  settleShot({ actor, item: bow, outcome: { resolution: { isHit: true }, result: {} }, type: "missile", profile }, { spend, post });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], [actor, bow, profile, { type: "missile" }]);
});

await t("the target falls back to the attack context's", async () => {
  const posted = [];
  settleShot({ actor: actorWith(stackOf(FLAG)), item: bow, ctx: { target }, outcome: { resolution: { isHit: true }, result: {} }, type: "missile", profile }, { spend: async () => {}, post: async (c) => posted.push(c) });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(posted[0]?.subjects[0].key, "Scene.s.Token.t");
});

await t("a failed spend or a failed post is logged and never thrown", async () => {
  const logged = [];
  const saved = console.error;
  console.error = (...a) => logged.push(a);
  try {
    assert.doesNotThrow(() =>
      settleShot({ actor: actorWith(stackOf(FLAG)), item: bow, outcome: { resolution: { isHit: true }, result: { target } }, type: "missile", profile }, {
        spend: async () => { throw new Error("spend"); },
        post: async () => { throw new Error("post"); },
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
  } finally {
    console.error = saved;
  }
  assert.equal(logged.length, 2);
});

console.log(`\n${passed} passed`);
