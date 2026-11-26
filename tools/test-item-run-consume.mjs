/**
 * The consume runner and what it posts (`item-run.mjs`), offline: the swig count
 * spent before the outcome, a bearer's heal, a human's `swig` save card and an
 * unknown drinker's `swigUnknown` card, the `swig` card's verdict (a heal stored
 * as a negative hit-point take, a condition ending at its bearer's turn end, a
 * blank figure left to the Judge), the unknown card's Heal and Ask the save by
 * ownership, `postOutcomeCard`'s relay, a card's own save modifier reaching the
 * throw, and the create hooks that stamp and roll a count. Foundry-free with
 * stand-ins; every name and figure below is invented.
 *
 * Usage: node tools/test-item-run-consume.mjs
 */
import assert from "node:assert/strict";

const hooked = {};
const uuids = {};
globalThis.Hooks = { once() {}, on(name, fn) { (hooked[name] ??= []).push(fn); }, callAll() {} };
class ForcedDeletion {}
let rid = 0;
globalThis.foundry = { utils: { randomID: () => `rid${++rid}` }, data: { operators: { ForcedDeletion } } };
class Users extends Array {
  get(id) { return this.find((u) => u.id === id); }
}
const gm = { id: "gm", isGM: true };
const emitted = [];
const notes = [];
const gameStub = {
  i18n: { format: (key) => key, localize: (key) => key },
  users: Users.from([{ id: "owner" }, { id: "other" }, gm]),
  user: gm, time: { worldTime: 0 }, scenes: [], actors: { get: (id) => Object.values(uuids).find((d) => d.documentName === "Actor" && d.id === id) ?? null, [Symbol.iterator]: function* () {} }, combat: null,
  socket: { emit: (...args) => emitted.push(args) },
};
gameStub.users.activeGM = { isSelf: true };
globalThis.game = gameStub;
globalThis.ui = { notifications: { warn: (text) => notes.push(["warn", text]), error: (text) => notes.push(["error", text]) } };
globalThis.CONFIG = { statusEffects: [{ id: "held", name: "Held Name" }] };

const order = [];
class RollStub {
  static queue = [];
  static made = [];
  static validate(formula) { return /^\d+d\d+$/.test(String(formula)); }
  constructor(formula) { this.formula = formula; RollStub.made.push(formula); }
  async evaluate() {
    const mod = /([+-])\s*(\d+)\s*$/.exec(this.formula);
    this.total = RollStub.queue.shift() + (mod ? Number(`${mod[1]}${mod[2]}`) : 0);
    return this;
  }
  async toMessage() { order.push(["roll", this.formula]); }
}
globalThis.Roll = RollStub;
globalThis.ChatMessage = { getSpeaker: () => ({}) };

const run = await import("../scripts/lib/item-run.mjs");
const { executeAsGM } = await import("../scripts/lib/sockets.mjs");
const { newCard, applyPatch, safeKey } = await import("../scripts/lib/item-run-card-logic.mjs");

let passed = 0;
const t = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

/* --- stand-ins --- */
globalThis.fromUuidSync = (uuid) => uuids[uuid] ?? null;
const SWIG_FLAG = "flags.acks-extras.itemRun.activation";

/** An actor and its one token. `types` are its creature kinds as the module reads them. */
function bodyOf(id, { owner = "owner", types = [], hp = 10 } = {}) {
  const actor = {
    documentName: "Actor", id, uuid: `A.${id}`, name: `Body ${id}`, type: "monster", img: "", items: [], effects: [], created: [],
    system: { hp: { value: hp, max: 20 }, saves: { paralysis: { value: 12 } } },
    getFlag: (scope, key) => (key === "extras" ? { types } : undefined),
    testUserPermission: (user) => user?.id === owner || user?.isGM === true,
    async applyDamage(amount, multiplier) { actor.system.hp.value = Math.min(actor.system.hp.value - Math.ceil(amount * multiplier), actor.system.hp.max); },
    async update() {},
    async createEmbeddedDocuments(kind, records) { actor.created.push(...records); return records.map((_, i) => ({ id: `E${i}` })); },
    async deleteEmbeddedDocuments() {},
    getActiveTokens: () => [token],
  };
  const token = { id, uuid: `T.${id}`, name: `Tok ${id}`, actor, parent: null, flags: { "acks-extras": {} }, testUserPermission: (user) => actor.testUserPermission(user) };
  uuids[actor.uuid] = actor;
  uuids[token.uuid] = token;
  return { actor, token };
}

/** An item on an actor; `update` applies a dotted write to its flags and records it. */
function itemOf(id, actor, flags) {
  const item = {
    uuid: `I.${id}`, name: `Jug ${id}`, type: "item", actor, parent: actor, flags: { "acks-extras": flags }, updates: [],
    async update(data) {
      order.push(["item", data]);
      item.updates.push(data);
      for (const [path, value] of Object.entries(data)) {
        const keys = path.split(".").slice(1);
        const last = keys.pop();
        const at = keys.reduce((o, k) => (o[k] ??= {}), item.flags);
        at[last] = value;
      }
    },
  };
  uuids[item.uuid] = item;
  return item;
}

const flagsFor = ({ left = null, bearerUuid = "", uses = null, drink = {} } = {}) => ({
  itemRun: { activation: { kind: "consume", left, bearerUuid, ...(uses ? { uses } : {}) }, rows: [] },
  drink: { ownKind: "beastkind", healDice: "2d7", saveKind: "paralysis", condition: "held", successHealDice: "3d5", ...drink },
  cookbook: { cite: "XX p. 1" },
});

/** The presenter stand-in: stores a posted card the way the documented shape says, and remembers what it was handed. */
const presented = [];
const messages = new Map();
globalThis.game.messages = { get: (id) => messages.get(id) };
let seq = 0;
const posted = [];
run.setUsePresenter(async (result) => {
  presented.push(result);
  if (result.kind === "consume") return;
  const stored = {
    ...newCard({ itemUuid: result.itemUuid, rowKey: result.rowKey, activationId: result.activationId, kind: result.kind, bearer: { uuid: result.actorUuid, name: result.actorName }, cardId: "c" }),
    title: result.itemName, ...result.facts, saveName: result.saveName, saveMod: result.saveMod, actorUuid: result.actorUuid,
    subjects: Object.fromEntries(result.subjects.map((s) => [safeKey(s.key), { uuid: s.key, name: s.name, state: "in", latest: "" }])), entries: {},
  };
  const id = `M${++seq}`;
  const message = {
    id, flags: { "acks-extras": { itemRunCard: stored } },
    getFlag(scope, key) { return this.flags[scope][key]; },
    async update(data) { this.flags["acks-extras"].itemRunCard = applyPatch(this.flags["acks-extras"].itemRunCard, Object.fromEntries(Object.entries(data).map(([path, value]) => [path.replace("flags.acks-extras.itemRunCard.", ""), value]))); },
  };
  messages.set(id, message);
  posted.push(id);
});
const cardAt = (id) => messages.get(id).flags["acks-extras"].itemRunCard;
const reset = () => {
  presented.length = 0; posted.length = 0; order.length = 0; notes.length = 0; emitted.length = 0;
  RollStub.queue.length = 0; RollStub.made.length = 0;
  gameStub.combat = null; gameStub.user = gm; gameStub.users.activeGM = { isSelf: true };
};

const priorOn = globalThis.Hooks.on;
run.installItemRun();
globalThis.Hooks.on = priorOn;

const use = (item, over = {}) => run.runUse({ itemUuid: item.uuid, ...over });
const press = (card, subject, total, over = {}) => executeAsGM("acks-extras.itemRun.press", { itemUuid: card.itemUuid, rowKey: card.rowKey, activationId: card.activationId, subject, messageId: posted.at(-1), entryKey: safeKey(subject), total, target: 12, requestUserId: "owner", ...over });
const as = (name, payload, requestUserId) => executeAsGM(`acks-extras.itemRun.${name}`, { ...payload, requestUserId });

/* --- the runner --- */

await t("a counted swig spends one on the item before anything is rolled, and a bearer's dice heal what the write actually healed", async () => {
  reset();
  const { actor } = bodyOf("b1", { types: ["beastkind"], hp: 10 });
  const item = itemOf("j1", actor, flagsFor({ left: 2 }));
  RollStub.queue.push(4);
  const out = await use(item);
  assert.deepEqual(out, {
    ok: true, kind: "consume", outcome: "heal", itemUuid: "I.j1", itemName: "Jug j1", actorUuid: "A.b1", actorName: "Body b1", tokenUuid: "T.b1",
    left: { before: 2, after: 1 }, heal: { dice: "2d7", rolled: 4, amount: 4 }, why: "",
  });
  assert.deepEqual(order, [["item", { [`${SWIG_FLAG}.left`]: 1 }], ["roll", "2d7"]], "written before the roll, the roll shown once");
  assert.equal(actor.system.hp.value, 14);
  assert.deepEqual(presented.map((r) => r.kind), ["consume"], "a bearer's result is the carrier's to present");
  actor.system.hp.value = 18;
  RollStub.queue.push(6);
  const capped = await use(item);
  assert.deepEqual([capped.heal, capped.left], [{ dice: "2d7", rolled: 6, amount: 2 }, { before: 1, after: 0 }], "the figure is what the write took, not the roll");
});

await t("a count of none is refused as spent with its own line, rolls nothing and writes nothing; an uncounted swig is never written", async () => {
  reset();
  const { actor } = bodyOf("b2", { types: ["beastkind"] });
  const spent = itemOf("j2", actor, flagsFor({ left: 0 }));
  assert.deepEqual(await use(spent), { ok: false, reason: "spent" });
  assert.ok(notes[0][1].endsWith("itemRun.refused.spent"), "the line the refusal reads");
  assert.deepEqual([spent.updates, RollStub.made, presented], [[], [], []]);
  const negative = itemOf("j2b", actor, flagsFor({ left: -1 }));
  assert.equal((await use(negative)).reason, "spent");
  const free = itemOf("j2c", actor, flagsFor({ left: null }));
  RollStub.queue.push(2);
  const out = await use(free);
  assert.deepEqual([out.outcome, out.left, free.updates], ["heal", { before: null, after: null }, []], "uncounted: nothing written");
});

await t("a blank or invalid figure rolls nothing and is the Judge's, an item with no drink flag refuses before it spends, and the swig is still drunk", async () => {
  reset();
  const { actor } = bodyOf("b3", { types: ["beastkind"], hp: 10 });
  const blank = itemOf("j3", actor, flagsFor({ left: 3, drink: { healDice: "" } }));
  const out = await use(blank);
  assert.deepEqual([out.ok, out.outcome, out.why, out.heal, out.left], [true, "judge", "figure", null, { before: 3, after: 2 }]);
  assert.deepEqual([RollStub.made, actor.system.hp.value], [[], 10], "nothing rolled, nothing healed");
  const odd = itemOf("j3b", actor, flagsFor({ drink: { healDice: "banana" } }));
  assert.deepEqual([(await use(odd)).outcome, RollStub.made], ["judge", []]);
  const bare = itemOf("j3c", actor, { itemRun: { activation: { kind: "consume", left: 2 }, rows: [] } });
  assert.deepEqual(await use(bare), { ok: false, reason: "noFigure" });
  assert.deepEqual(bare.updates, [], "nothing spent");
});

await t("a human drinker posts a swig save card with the drinker's token as its one subject and the item's figures stored on it", async () => {
  reset();
  const { actor } = bodyOf("h1", { types: ["human"] });
  const item = itemOf("j4", actor, flagsFor({ left: 2 }));
  const out = await use(item);
  assert.deepEqual([out.ok, out.outcome, out.presented, out.left, out.heal], [true, "save", true, { before: 2, after: 1 }, null]);
  assert.deepEqual(presented.map((r) => r.kind), ["swig"], "the carrier posts nothing more for a result already presented");
  const card = presented[0];
  assert.deepEqual([card.ok, card.itemUuid, card.itemName, card.rowKey, card.actorUuid, card.subjects, card.saveName, card.saveMod], [true, "I.j4", "Jug j4", "swig", "A.h1", [{ key: "T.h1", name: "Tok h1" }], "paralysis", null]);
  assert.deepEqual(card.facts, { successHealDice: "3d5", condition: "held", cite: "XX p. 1" });
  assert.deepEqual([card.card.kind, card.card.saveName, card.card.successHealDice, card.card.condition, card.card.cite], ["swig", "paralysis", "3d5", "held", "XX p. 1"], "facts spread onto the card model");
  assert.equal(card.card.sections[0].rows[0].actions[0].data.rowKey, "swig");
  assert.equal(RollStub.made.length, 0, "nothing is rolled until the Save press");
  const noSave = itemOf("j4b", actor, flagsFor({ drink: { saveKind: "" } }));
  await use(noSave);
  assert.equal(presented.at(-1).saveName, "", "a blank save kind leaves the save to the Judge");
});

await t("a drinker of no known kind posts a swigUnknown card holding the drinker and every figure, with no save asked", async () => {
  reset();
  const { actor } = bodyOf("u1", { types: [] });
  const item = itemOf("j5", actor, flagsFor({ drink: { healDice: "", condition: "" } }));
  const out = await use(item);
  assert.deepEqual([out.outcome, out.presented], ["unknown", true]);
  const card = presented[0];
  assert.deepEqual([card.kind, card.rowKey, card.saveName, card.saveMod], ["swigUnknown", "swigUnknown", "", null]);
  assert.deepEqual(card.facts, { drinkerTokenUuid: "T.u1", drinkerActorUuid: "A.u1", healDice: null, saveKind: "paralysis", successHealDice: "3d5", condition: null, cite: "XX p. 1" });
  assert.deepEqual(Object.keys(cardAt(posted[0]).subjects), ["T~u1"], "the drinker is the card's one subject");
});

/* --- the swig card's Save press --- */

/** A human on a posted swig card: its actor, and the card the press names. */
async function swigCard(drink = {}, who = {}) {
  reset();
  const { actor, token } = bodyOf(`h${++seq}`, { types: ["human"], hp: 10, ...who });
  const item = itemOf(`k${seq}`, actor, flagsFor({ drink }));
  await use(item);
  return { actor, token, item, card: cardAt(posted.at(-1)) };
}

await t("a passed swig save heals the successHealDice through adjustHp and stores the take as negative so an Undo gives it back", async () => {
  const { actor, card } = await swigCard();
  RollStub.queue.length = 0;
  RollStub.queue.push(3);
  const out = await press(card, `T.${actor.id}`, 12);
  assert.deepEqual([out.ok, out.saved, out.entry.state, out.entry.hp, out.entry.amount, out.entry.recordIds], [true, true, "applied", [{ uuid: `A.${actor.id}`, amount: -3 }], 3, []]);
  assert.equal(actor.system.hp.value, 13);
  assert.deepEqual(RollStub.made, ["3d5"], "the card's own figure, rolled once");
  assert.equal((await press(card, `T.${actor.id}`, 12)).reason, "applied", "a second Save is refused");
  const undone = await as("undo", { messageId: posted.at(-1), entryKey: safeKey(`T.${actor.id}`) }, "owner");
  assert.equal(undone.ok, true);
  assert.equal(actor.system.hp.value, 10, "the heal is taken back as damage");
  assert.equal(cardAt(posted.at(-1)).entries[safeKey(`T.${actor.id}`)].state, "undone");
});

await t("a failed swig save writes the condition record ending at its bearer's turn end, once, and outside a fight the mark", async () => {
  const { actor, card } = await swigCard();
  gameStub.combat = { id: "c9", combatants: [{ id: "m9", tokenId: actor.id }] };
  const out = await press(card, `T.${actor.id}`, 5);
  assert.deepEqual([out.ok, out.saved, out.entry.state, out.entry.recordIds, out.entry.names, out.entry.life, out.entry.hp], [true, false, "applied", ["E0"], ["Held Name"], "turn", undefined]);
  const record = actor.created[0];
  assert.deepEqual(record.flags["acks-extras"].turnLife, { combatId: "c9", combatantId: "m9", edge: "end", count: 1 }, "the END edge, count one");
  assert.deepEqual([record.origin, record.flags["acks-extras"].itemRun, record.statuses], [card.itemUuid, { source: card.itemUuid, activationId: card.activationId, rowKey: "swig" }, ["held"]]);
  assert.equal(actor.system.hp.value, 10, "a failure heals nothing");
  const again = await swigCard();
  const mark = await press(again.card, `T.${again.actor.id}`, 5);
  assert.deepEqual([mark.entry.life, again.actor.created[0].flags["acks-extras"].turnMark, again.actor.created[0].flags["acks-extras"].turnLife], ["mark", { edge: "start" }, undefined], "outside a fight it carries the mark, as every condition here");
});

await t("a blank figure at the verdict leaves the entry in the Judge's state with nothing written: a passed save with no dice, a failed one with no condition", async () => {
  const noDice = await swigCard({ successHealDice: "" });
  const passed1 = await press(noDice.card, `T.${noDice.actor.id}`, 12);
  assert.deepEqual([passed1.ok, passed1.saved, passed1.entry.state, passed1.entry.why, passed1.entry.recordIds, "hp" in passed1.entry, noDice.actor.system.hp.value, RollStub.made], [true, true, "judge", "figure", [], false, 10, []]);
  assert.equal((await press(noDice.card, `T.${noDice.actor.id}`, 12)).reason, "applied", "a judge entry is not pressed again");
  const noCondition = await swigCard({ condition: "" });
  const failed = await press(noCondition.card, `T.${noCondition.actor.id}`, 1);
  assert.deepEqual([failed.entry.state, failed.entry.why, failed.entry.recordIds, noCondition.actor.created], ["judge", "figure", [], []]);
  const full = await swigCard({}, { hp: 20 });
  RollStub.queue.push(4);
  const nothing = await press(full.card, `T.${full.actor.id}`, 12);
  assert.deepEqual([nothing.entry.state, nothing.entry.hp, nothing.entry.amount], ["applied", [], 0], "a body already at full takes no heal and stores no take");
});

await t("a writer's judge answer at the verdict wins over everything else it answers: nothing is created, no hit points or amount reach the entry", async () => {
  reset();
  run.registerPressOutcome("probe", async () => ({ judge: true, why: "probe", records: [{ name: "x" }], names: ["x"], hp: [{ uuid: "A.z", amount: 3 }], amount: 9 }));
  try {
    const { actor, token } = bodyOf("q1");
    const made = await run.postOutcomeCard({ kind: "probe", itemUuid: "I.none", title: "Probe", subjects: [{ key: token.uuid, name: token.name }], saveName: "paralysis", facts: {}, speakerActorUuid: actor.uuid });
    const out = await press(made, token.uuid, 12);
    assert.deepEqual([out.ok, out.saved, out.entry.state, out.entry.why, out.entry.recordIds, out.entry.names, "hp" in out.entry, "amount" in out.entry, actor.created], [true, true, "judge", "probe", [], [], false, false, []]);
  } finally {
    run.registerPressOutcome("probe", null);
  }
});

/* --- the unknown drinker's card --- */

async function unknownCard(drink = {}) {
  reset();
  const { actor } = bodyOf(`x${++seq}`, { types: [], hp: 10 });
  const item = itemOf(`y${seq}`, actor, flagsFor({ drink }));
  await use(item);
  return { actor, id: posted.at(-1) };
}

await t("Heal on an unknown drinker's card is the owners' by Foundry ownership: a seat that does not own the drinker is refused, an owner heals once and the card is resolved", async () => {
  const { actor, id } = await unknownCard();
  assert.deepEqual(await as("swigHeal", { messageId: id }, "other"), { ok: false, reason: "notOwner" });
  assert.deepEqual([actor.system.hp.value, RollStub.made], [10, []], "nothing rolled for a refusal");
  RollStub.queue.push(5);
  const out = await as("swigHeal", { messageId: id }, "owner");
  assert.deepEqual(out, { ok: true, state: "heal", amount: 5, rolled: 5, dice: "2d7" });
  assert.equal(actor.system.hp.value, 15);
  const card = cardAt(id);
  assert.deepEqual([card.resolved, card.amount, card.rolled, card.resolvedBy], ["heal", 5, 5, "owner"]);
  assert.equal((await as("swigHeal", { messageId: id }, "owner")).reason, "applied", "a resolved card is pressed once");
  assert.equal((await as("swigAskSave", { messageId: id }, "owner")).reason, "applied", "nor turned into a save afterwards");
  assert.equal((await as("swigHeal", { messageId: "M-none" }, "owner")).reason, "gone");
  const { actor: other, id: otherId } = await unknownCard();
  RollStub.queue.push(2);
  assert.equal((await run.swigHeal({ messageId: otherId })).ok, true, "the Judge's own seat owns everything");
  assert.equal(other.system.hp.value, 12);
});

await t("Heal with a blank figure is refused as noFigure and leaves the card open", async () => {
  const { actor, id } = await unknownCard({ healDice: "" });
  assert.deepEqual(await as("swigHeal", { messageId: id }, "owner"), { ok: false, reason: "noFigure" });
  assert.deepEqual([cardAt(id).resolved, actor.system.hp.value, RollStub.made], [undefined, 10, []]);
});

await t("Ask the save turns the unknown card into the swig save card in place, and Save then works on it", async () => {
  const { actor, id } = await unknownCard();
  assert.equal((await as("swigAskSave", { messageId: id }, "other")).reason, "notOwner");
  assert.equal(cardAt(id).kind, "swigUnknown");
  assert.deepEqual(await as("swigAskSave", { messageId: id }, "owner"), { ok: true, state: "asked" });
  const card = cardAt(id);
  assert.deepEqual([card.kind, card.rowKey, card.saveName, card.asked, posted.length], ["swig", "swig", "paralysis", true, 1], "one card, changed in place");
  assert.equal((await as("swigAskSave", { messageId: id }, "owner")).reason, "applied");
  assert.equal((await as("swigHeal", { messageId: id }, "owner")).reason, "applied", "it is a save card now");
  RollStub.queue.push(3);
  const out = await press(card, `T.${actor.id}`, 12);
  assert.deepEqual([out.ok, out.entry.state, out.entry.hp, actor.system.hp.value], [true, "applied", [{ uuid: `A.${actor.id}`, amount: -3 }], 13]);
});

/* --- postOutcomeCard --- */

await t("an outcome card posts from any seat: a Player's seat relays and the GM's window checks the sender owns the actor the card speaks for", async () => {
  reset();
  const { actor, token } = bodyOf("s1", { owner: "owner" });
  const ask = (over = {}) => ({ kind: "swig", itemUuid: "I.none", title: "Shot", subtitle: "Body s1", subjects: [{ key: token.uuid, name: token.name }], saveName: "paralysis", saveMod: -2, facts: { formula: "3d5", cite: "XX p. 2" }, speakerActorUuid: actor.uuid, ...over });
  gameStub.user = { id: "owner", isGM: false };
  assert.deepEqual(await run.postOutcomeCard(ask()), { ok: false, reason: "relay" }, "no answer from the Judge's seat");
  assert.equal(emitted[0][1].action, "acks-extras.itemRun.postCard", "relayed to the GM's window");
  assert.deepEqual(emitted[0][1].payload.speakerActorUuid, "A.s1");
  assert.deepEqual(presented, [], "a Player's seat posts nothing itself");
  gameStub.user = gm;
  const here = (over, userId) => as("postCard", ask(over), userId);
  assert.deepEqual(await here({}, "other"), { ok: false, reason: "notOwner" });
  assert.deepEqual(await here({ speakerActorUuid: "A.none" }, "owner"), { ok: false, reason: "gone" });
  assert.deepEqual(await here({ kind: "" }, "owner"), { ok: false, reason: "unsupported" });
  assert.deepEqual(await here({ kind: "burst" }, "owner"), { ok: false, reason: "unsupported" }, "a burst's facts are the GM's own roll, never a post's");
  assert.deepEqual(await here({ kind: "nobodys" }, "owner"), { ok: false, reason: "unsupported" }, "a kind no feature writes");
  assert.deepEqual(presented, [], "nothing is posted for a refusal");
  const made = await here({}, "owner");
  assert.deepEqual([made.ok, made.kind, made.itemName, made.rowKey, made.actorUuid, made.saveName, made.saveMod, made.facts, made.subjects], [true, "swig", "Shot", "swig", "A.s1", "paralysis", -2, { formula: "3d5", cite: "XX p. 2" }, [{ key: "T.s1", name: "Tok s1" }]]);
  assert.deepEqual([made.card.kind, made.card.saveName, made.card.saveMod, made.card.formula, made.card.cite], ["swig", "paralysis", -2, "3d5", "XX p. 2"], "saveName, saveMod and the facts ride on the card");
  assert.equal(presented.length, 1);
  const direct = await run.postOutcomeCard(ask({ saveMod: "x" }));
  assert.deepEqual([direct.ok, direct.saveMod], [true, null], "the Judge's own window posts it here; a modifier that is no number is none");
  const blankMod = await run.postOutcomeCard(ask({ saveMod: null }));
  assert.equal(blankMod.saveMod, null);
  const forged = await here({ facts: { formula: "3d5", entries: { x: { state: "applied", presser: "owner", hp: [{ uuid: "A.other", amount: 5 }] } }, kind: "burst", saveName: "death", subjects: {}, resolved: "heal" } }, "owner");
  assert.deepEqual(forged.facts, { formula: "3d5" }, "a seat's facts never set the keys the card holds for itself");
  assert.deepEqual([forged.card.kind, forged.card.saveName, forged.card.entries, forged.card.resolved, forged.card.formula], ["swig", "paralysis", undefined, undefined, "3d5"]);
});

/* --- a card's own save modifier --- */

await t("a card's save modifier rides on the throw a seat rolls and the target stays the one the GM recomputes; a card with none, or a zero, rolls the plain throw", async () => {
  const withMod = async (saveMod, die) => {
    reset();
    const { actor, token } = bodyOf(`m${++seq}`, { owner: "owner" });
    uuids[token.uuid] = token;
    const made = await run.postOutcomeCard({ kind: "swig", itemUuid: "I.none", title: "Shot", subjects: [{ key: token.uuid, name: token.name }], saveName: "paralysis", saveMod, facts: { successHealDice: "3d5", condition: "held" }, speakerActorUuid: actor.uuid });
    RollStub.queue.push(die);
    const out = await run.pressRoll({ itemUuid: "I.none", rowKey: made.rowKey, activationId: made.activationId, subject: token.uuid, messageId: posted.at(-1), entryKey: safeKey(token.uuid) });
    return { out, formula: RollStub.made[0], actor };
  };
  const plus = await withMod(2, 10);
  assert.equal(plus.formula, "1d20 + 2", "the throw carries the modifier");
  assert.deepEqual([plus.out.ok, plus.out.saved, plus.out.entry.total, plus.out.entry.target], [true, true, 12, 12], "the total the throw showed is what the press judged, against the unchanged target");
  const minus = await withMod(-3, 14);
  assert.deepEqual([minus.formula, minus.out.saved, minus.out.entry.total, minus.out.entry.target], ["1d20 - 3", false, 11, 12], "a negative one hurts the saver");
  for (const none of [null, 0, "", undefined]) {
    const plain = await withMod(none, 10);
    assert.deepEqual([plain.formula, plain.out.saved, plain.out.entry.total], ["1d20", false, 10], `${JSON.stringify(none)} is no modifier`);
  }
});

/* --- the create hooks --- */

await t("an item created with its actor is stamped with that actor and never rolled a count", async () => {
  reset();
  const { actor } = bodyOf("c1");
  const fresh = itemOf("n1", actor, flagsFor({ uses: { value: "4d3" } }));
  const copied = itemOf("n2", actor, flagsFor({ bearerUuid: "A.elsewhere", uses: { value: "4d3" } }));
  const other = itemOf("n3", actor, { itemRun: { activation: { kind: "once" }, rows: [] } });
  actor.items = [fresh, copied, other];
  RollStub.queue.push(4);
  for (const fn of hooked.createActor) fn(actor);
  await settle();
  assert.deepEqual(fresh.updates, [{ [`${SWIG_FLAG}.bearerUuid`]: "A.c1" }]);
  assert.deepEqual(copied.updates, [{ [`${SWIG_FLAG}.bearerUuid`]: "A.c1" }], "a copy's old bearer is replaced, still no count");
  assert.deepEqual([other.updates, RollStub.made], [[], []], "an item that is no consume item is left alone and nothing is rolled");
  gameStub.users.activeGM = undefined;
  fresh.updates.length = 0;
  fresh.flags["acks-extras"].itemRun.activation.bearerUuid = "";
  for (const fn of hooked.createActor) fn(actor);
  await settle();
  assert.deepEqual(fresh.updates, [], "only the primary GM's window writes");
});

await t("an item handed to a different actor rolls its imported swig dice into the count while the count is null, in one write with the stamp; a typed or part-drunk count is kept; the same actor does nothing", async () => {
  reset();
  const { actor } = bodyOf("c2");
  const create = async (item, parent = actor) => {
    item.parent = parent;
    for (const fn of hooked.createItem) fn(item);
    await settle();
  };
  const handed = itemOf("p1", actor, flagsFor({ bearerUuid: "A.old", uses: { value: "4d3" } }));
  RollStub.queue.push(4);
  await create(handed);
  assert.deepEqual(handed.updates, [{ [`${SWIG_FLAG}.bearerUuid`]: "A.c2", [`${SWIG_FLAG}.left`]: 4 }], "one update holds the stamp and the count");
  assert.deepEqual(RollStub.made, ["4d3"]);
  assert.deepEqual(order.filter(([kind]) => kind === "roll"), [], "the count is rolled for no one's chat");
  assert.equal(handed.flags["acks-extras"].itemRun.activation.left, 4);
  handed.updates.length = 0;
  await create(handed);
  assert.deepEqual(handed.updates, [], "the same actor again: nothing");
  const counted = itemOf("p2", actor, flagsFor({ left: 2, bearerUuid: "A.old", uses: { value: "4d3" } }));
  RollStub.queue.push(5);
  await create(counted);
  assert.deepEqual(counted.updates, [{ [`${SWIG_FLAG}.bearerUuid`]: "A.c2" }], "a count already there is kept");
  const first = itemOf("p3", actor, flagsFor({ bearerUuid: "", uses: { value: "4d3" } }));
  await create(first);
  assert.deepEqual(first.updates, [{ [`${SWIG_FLAG}.bearerUuid`]: "A.c2" }], "the item's first bearer gets the stamp and no count");
  for (const [id, uses] of [["p4", { value: "" }], ["p5", { value: "banana" }], ["p6", null]]) {
    const blank = itemOf(id, actor, flagsFor({ bearerUuid: "A.old", uses }));
    await create(blank);
    assert.deepEqual(blank.updates, [{ [`${SWIG_FLAG}.bearerUuid`]: "A.c2" }], `${id}: a blank or invalid figure writes only the stamp`);
    assert.equal(blank.flags["acks-extras"].itemRun.activation.left ?? null, null);
  }
  const scene = itemOf("p7", actor, flagsFor({ bearerUuid: "A.old", uses: { value: "4d3" } }));
  scene.parent = { documentName: "Scene" };
  for (const fn of hooked.createItem) fn(scene);
  await settle();
  assert.deepEqual(scene.updates, [], "an item not held by an actor is left alone");
  gameStub.users.activeGM = undefined;
  const late = itemOf("p8", actor, flagsFor({ bearerUuid: "A.old", uses: { value: "4d3" } }));
  await create(late);
  assert.deepEqual(late.updates, [], "only the primary GM's window writes");
});

console.log(`\ntest-item-run-consume: ${passed} checks passed.`);
