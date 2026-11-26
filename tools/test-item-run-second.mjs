/**
 * Two second seats of the item runner (`item-run.mjs`), offline.
 *
 * - The second light (runFuse, `item-run-logic.mjs` secondLight): a fuse item
 *   whose every unit already burns refuses a Player's seat `noSpare` before
 *   anything is rolled, warns the Judge's own seat and lights, lights for anyone
 *   from a spare, and the refusal is told once on the Player's own window when
 *   the use was relayed.
 * - The second GM seat (pressRoll, pressOnPrimary): the Judge's Passed and
 *   Failed on a card that names no save, pressed from a GM window that is not
 *   the primary one, are written on the primary GM's window, where the card's
 *   press listener answers them; a Player's call stays refused.
 *
 * Foundry-free with stand-ins; every name and figure below is invented.
 *
 * Usage: node tools/test-item-run-second.mjs
 */
import assert from "node:assert/strict";

const uuids = {};
const ready = [];
globalThis.Hooks = { once(name, fn) { if (name === "socketlib.ready") ready.push(fn); }, on() {}, callAll() {} };
class ForcedDeletion {}
let rid = 0;
globalThis.foundry = { utils: { randomID: () => `rid${++rid}` }, data: { operators: { ForcedDeletion } } };
class Users extends Array {
  get(id) { return this.find((u) => u.id === id); }
}
const notes = [];
const gameStub = {
  i18n: { format: (key) => key, localize: (key) => key },
  time: { worldTime: 0 }, scenes: [], combat: null,
  socket: { emit() {} },
};
/** The world's Judges: `gm` is the active (primary) one, `gm2` a second GM seat. */
const gm = { id: "gm", isGM: true, active: true, get isSelf() { return gameStub.user === gm; } };
const gm2 = { id: "gm2", isGM: true, active: true, get isSelf() { return gameStub.user === gm2; } };
const player = { id: "owner", isGM: false, active: true, get isSelf() { return gameStub.user === player; } };
gameStub.users = Users.from([player, gm, gm2]);
gameStub.users.activeGM = gm;
gameStub.user = gm;
globalThis.game = gameStub;
/* Each notice records the window it was shown on. */
globalThis.ui = { notifications: { warn: (text) => notes.push(["warn", text, gameStub.user.id]), error: (text) => notes.push(["error", text, gameStub.user.id]) } };
globalThis.fromUuidSync = (uuid) => uuids[uuid] ?? null;
const rolled = [];
globalThis.Roll = class { static validate() { return true; } constructor(f) { rolled.push(f); } async evaluate() { this.total = 1; return this; } };
globalThis.ChatMessage = { getSpeaker: () => ({}) };

const logic = await import("../scripts/lib/item-run-logic.mjs");
const run = await import("../scripts/lib/item-run.mjs");
const { newCard, applyPatch, safeKey } = await import("../scripts/lib/item-run-card-logic.mjs");

/* The presenter stand-in: a posted outcome card is stored the way the documented shape says. */
const messages = new Map();
gameStub.messages = { get: (id) => messages.get(id) };
const posted = [];
run.setUsePresenter(async (result) => {
  if (result.kind !== "probe") return;
  const stored = {
    ...newCard({ itemUuid: result.itemUuid, rowKey: result.rowKey, activationId: result.activationId, kind: result.kind, bearer: { uuid: result.actorUuid, name: result.actorName }, cardId: "c" }),
    title: result.itemName, ...result.facts, saveName: result.saveName, saveMod: result.saveMod, actorUuid: result.actorUuid,
    subjects: Object.fromEntries(result.subjects.map((s) => [safeKey(s.key), { uuid: s.key, name: s.name, state: "in", latest: "" }])), entries: {},
  };
  const id = `M${posted.length + 1}`;
  messages.set(id, {
    id, flags: { "acks-extras": { itemRunCard: stored } },
    getFlag(scope, key) { return this.flags[scope][key]; },
    async update(data) { this.flags["acks-extras"].itemRunCard = applyPatch(this.flags["acks-extras"].itemRunCard, Object.fromEntries(Object.entries(data).map(([path, value]) => [path.replace("flags.acks-extras.itemRunCard.", ""), value]))); },
  });
  posted.push(id);
});
run.installItemRun();

/* A socketlib stand-in: a relayed call runs its handler as the window of the user it reaches, stamped with the calling user, as socketlib does. */
const registered = {};
const onWindowOf = async (user, name, payload) => {
  const caller = gameStub.user;
  gameStub.user = user;
  try {
    return await registered[name].call({ socketdata: { userId: caller.id } }, payload);
  } finally {
    gameStub.user = caller;
  }
};
globalThis.socketlib = {
  registerModule: () => ({
    register(name, fn) { registered[name] = fn; },
    executeAsGM: (name, payload) => onWindowOf(gameStub.users.activeGM, name, payload),
    executeAsUser: (name, userId, payload) => onWindowOf(gameStub.users.get(userId), name, payload),
  }),
};
for (const fn of ready) fn();

let passed = 0;
const t = async (name, fn) => {
  notes.length = 0;
  rolled.length = 0;
  gameStub.user = gm;
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

/** A body owned by the Player, with its token. */
function bodyOf(id) {
  const actor = {
    documentName: "Actor", id, uuid: `A.${id}`, name: `Body ${id}`, type: "monster", items: [], effects: [],
    system: { hp: { value: 10, max: 20 }, saves: { paralysis: { value: 12 } } },
    getFlag: () => undefined,
    testUserPermission: (user) => user?.id === "owner" || user?.isGM === true,
    getActiveTokens: () => [token],
    async update() {}, async createEmbeddedDocuments() { return []; }, async deleteEmbeddedDocuments() {},
  };
  const token = { id, uuid: `T.${id}`, name: `Tok ${id}`, actor, parent: null, flags: { "acks-extras": {} }, testUserPermission: (user) => actor.testUserPermission(user) };
  uuids[actor.uuid] = actor;
  uuids[token.uuid] = token;
  return { actor, token };
}

/** A fuse item of `quantity` on an actor; its figures are blank, so a light that goes on stops at the Judge's line before any die. */
function fuseItem(id, actor, quantity) {
  const item = { uuid: `I.${id}`, name: `Bomb ${id}`, type: "item", actor, parent: actor, system: { quantity }, flags: { "acks-extras": { itemRun: { activation: { kind: "fuse" }, rows: [] } } } };
  actor.items.push(item);
  uuids[item.uuid] = item;
  return item;
}

/** One lit fuse record of an item, on the world clock. */
const litRecord = (itemUuid) => ({ flags: { "acks-extras": { fuse: logic.fuseWorldFlag({ source: itemUuid, activationId: "a1", spot: { sceneId: "s", x: 0, y: 0, elevation: 0, level: "" }, rounds: 3, now: 0, roundSeconds: 10 }) } } });

const light = (item, requestUserId = null) => run.runUse({ itemUuid: item.uuid, tokenUuid: `T.${item.actor.id}`, requestUserId });

/* --- the second light --- */

await t("secondLight lights from a spare, warns the Judge and refuses anyone else past the stack", () => {
  assert.equal(logic.secondLight({ lit: 0, held: 1, judge: false }), "light", "nothing burns");
  assert.equal(logic.secondLight({ lit: 1, held: 2, judge: false }), "light", "a spare in the stack");
  assert.equal(logic.secondLight({ lit: 1, held: 1, judge: false }), "refuse", "the one unit burns");
  assert.equal(logic.secondLight({ lit: 1, held: 1, judge: true }), "warn");
  assert.equal(logic.secondLight({ lit: 1, held: null, judge: false }), "refuse", "an item with no count holds one");
  assert.equal(logic.secondLight({ lit: 2, held: 1, judge: true }), "warn");
});

await t("a Player's light of a bomb whose one unit burns is refused noSpare, and nothing is rolled", async () => {
  const { actor } = bodyOf("p1");
  const item = fuseItem("p1", actor, 1);
  actor.effects.push(litRecord(item.uuid));
  assert.deepEqual(await light(item, "owner"), { ok: false, reason: "noSpare" });
  assert.deepEqual(rolled, [], "no die was thrown");
});

await t("the Judge's own light of the same bomb is warned once and goes on", async () => {
  const { actor } = bodyOf("j1");
  const item = fuseItem("j1", actor, 1);
  actor.effects.push(litRecord(item.uuid));
  const out = await light(item);
  assert.equal(out.ok, true);
  assert.equal(out.kind, "fuse", "the runner went on past the guard");
  assert.equal(notes.filter(([, text]) => text === "ACKS-LIB.itemRun.warn.noSpare").length, 1, JSON.stringify(notes));
});

await t("a spare in the stack lights for a Player, and an unlit bomb is never held back", async () => {
  const { actor } = bodyOf("s1");
  const item = fuseItem("s1", actor, 2);
  actor.effects.push(litRecord(item.uuid));
  assert.equal((await light(item, "owner")).ok, true);
  const { actor: other } = bodyOf("s2");
  assert.equal((await light(fuseItem("s2", other, 1), "owner")).ok, true);
  assert.equal(notes.filter(([kind]) => kind === "warn").length, 0, "no warning where a unit is spare");
});

await t("a relayed light refused on the GM's window is told once, on the Player's own window", async () => {
  const { actor } = bodyOf("r1");
  const item = fuseItem("r1", actor, 1);
  actor.effects.push(litRecord(item.uuid));
  gameStub.user = player;
  assert.deepEqual(await run.useItem(item), { ok: false, reason: "noSpare" });
  assert.deepEqual(notes.filter(([, , seat]) => seat === "owner"), [["warn", "ACKS-LIB.itemRun.refused.noSpare", "owner"]], "one notice on the Player's window");
});

/* --- the second GM seat --- */

await t("the Judge's call from a second GM seat is written on the primary GM's window, where the press listener answers it; a Player stays refused", async () => {
  const asked = [];
  const heard = [];
  run.registerPressOutcome("probe", async (args) => { asked.push([args.saved, gameStub.user.id]); return { names: [], records: [], life: "raised" }; });
  run.setPressListener(() => { heard.push(gameStub.user.id); });
  try {
    const { actor, token } = bodyOf("d1");
    const post = () => run.postOutcomeCard({ kind: "probe", itemUuid: "I.none", title: "Probe", subjects: [{ key: token.uuid, name: token.name }], saveName: "", facts: {}, speakerActorUuid: actor.uuid });
    const base = (made, declared) => ({ itemUuid: "I.none", rowKey: made.rowKey, activationId: made.activationId, subject: token.uuid, messageId: posted.at(-1), entryKey: safeKey(token.uuid), declared });
    const first = await post();
    gameStub.user = gm2;
    const passedCall = await run.pressRoll(base(first, true));
    assert.deepEqual([passedCall.ok, passedCall.saved, passedCall.entry?.declared, passedCall.entry?.presser], [true, true, true, "gm2"], JSON.stringify(passedCall));
    assert.deepEqual(asked, [[true, "gm"]], "the writer ran on the primary GM's window");
    assert.deepEqual(heard, ["gm"], "the press listener answered on the primary GM's window");
    gameStub.user = gm;
    const second = await post();
    gameStub.user = gm2;
    const failedCall = await run.pressRoll(base(second, false));
    assert.deepEqual([failedCall.ok, failedCall.saved, asked.at(-1)], [true, false, [false, "gm"]]);
    gameStub.user = player;
    assert.deepEqual(await run.pressRoll(base(second, true)), { ok: false, reason: "judgeOnly" }, "a Player's seat is refused");
    gameStub.user = gm;
    const third = await post();
    const own = await run.pressRoll(base(third, true));
    assert.deepEqual([own.ok, own.entry?.presser], [true, "gm"], "the primary GM's own call still writes here");
    assert.deepEqual(heard, ["gm", "gm", "gm"]);
  } finally {
    run.registerPressOutcome("probe", null);
    run.setPressListener(null);
  }
});

console.log(`test-item-run-second: ${passed} checks passed.`);
