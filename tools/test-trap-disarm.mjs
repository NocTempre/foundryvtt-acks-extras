/**
 * `attemptDisarm` (scripts/formation/trap-zone.mjs): who is asked to disarm or
 * discharge, in what order the trap is written, and how the throw is read.
 * Foundry's globals are stand-ins, and every figure is invented.
 *
 * What this pins: a made throw writes the trap disarmed (and known) BEFORE the
 * question is put, so a question that is lost or never answered leaves a valid
 * disarmed trap, and an answer of discharge writes the trap discharged after,
 * and only over a trap still disarmed; the question is never awaited by the
 * throw (the card, the clock spend and the return come at once, `asked` settles
 * on its own and never rejects, a discharge is noted in one whispered line);
 * the question goes to the user named by `askUserId` (none, or this client's
 * own user, asks here; another user's is asked through `executeAsUser` and an
 * answer of undefined reads as disarmed); the dialog escapes the actor's name
 * and only the discharge button counts, a dismissal or a Cancel does not; the
 * relayed player request, the turn plan's entry (`entry.by`) and the Judge's
 * own window each name the right user. The throw reads the natural die before
 * the total: an imported automatic-failure face fails a throw whose total
 * reaches the target, and with nothing imported the target alone decides.
 *
 * Run: node tools/test-trap-disarm.mjs
 */
import assert from "node:assert/strict";
import { mockRegion, rect, standOnRegions } from "./region-fixture.mjs";

let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

/* --- stand-ins -------------------------------------------------------------- */
class Stub {}
/** What the dialog is asked and what each test has the person click. */
const dialogs = [];
let click = () => true;
globalThis.foundry = {
  abstract: { DataModel: class {}, TypeDataModel: class { static defineSchema() { return {}; } } },
  data: {
    regionBehaviors: { RegionBehaviorType: class { static defineSchema() { return {}; } } },
    fields: new Proxy({}, { get: () => class { constructor(options = {}) { this.options = options; } } }),
    operators: { ForcedReplacement: { create: (value) => value }, ForcedDeletion: class {} },
  },
  utils: {
    deepClone: (v) => JSON.parse(JSON.stringify(v)),
    randomID: () => "id",
    escapeHTML: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
  },
  applications: {
    api: {
      ApplicationV2: Stub,
      HandlebarsApplicationMixin: (B) => B,
      DialogV2: { wait: async (config) => (dialogs.push(config), click(config)) },
    },
    sheets: { ItemSheetV2: Stub },
    handlebars: {},
  },
};
const notices = [];
globalThis.game = {
  i18n: { localize: (key) => key, format: (key, data = {}) => `${key} ${JSON.stringify(data)}`, has: () => true },
  user: { id: "judge", isGM: true },
  users: Object.assign(
    [{ id: "judge", isGM: true, active: true }],
    { get: (id) => ({ judge: { id: "judge", isGM: true, active: true }, player: { id: "player", name: "Pat", isGM: false, active: true }, away: { id: "away", isGM: false, active: false } })[id] },
  ),
  scenes: new Map(),
  settings: { get: () => ({ F: formation }) },
};
globalThis.ui = { notifications: { warn: (m) => notices.push(m) } };
globalThis.CONFIG = { RegionBehavior: { dataModels: {}, typeIcons: {} } };
/** The hooks sockets.mjs queues; `socketlib.ready` is fired by hand once the handlers are registered. */
const queued = [];
globalThis.Hooks = { on() {}, once: (name, fn) => queued.push([name, fn]), off() {}, call() {}, callAll() {} };
/** What socketlib was handed (`register`) and what the Judge's client sent another user (`asked`). */
const registered = new Map();
const asked = [];
let remoteAnswer = () => false;
globalThis.socketlib = {
  registerModule: () => ({
    register: (name, fn) => registered.set(name, fn),
    executeAsUser: async (name, userId, payload) => (asked.push({ name, userId, payload }), remoteAnswer(payload)),
  }),
};
const chats = [];
globalThis.ChatMessage = { create: async (data) => (chats.push(data), {}) };
globalThis.fromUuid = async (uuid) => (uuid === "Item.trap" ? { type: "acks-extras.trap", name: "Probe trap", system: { crude: false } } : null);
/** Each roll the test queues: the natural face and the total. */
const throws = [];
/** The formula of every roll made, in order. */
const formulas = [];
globalThis.Roll = class {
  constructor(formula) { this.formula = formula; formulas.push(formula); }
  async evaluate() {
    const [natural, total] = throws.shift();
    this.total = total;
    this.dice = [{ results: [{ result: natural }] }];
    return this;
  }
  async render() { return ""; }
};

const T = await import("../scripts/lib/tables.mjs");
const { THROWS_DOC, THROW_TABLE } = await import("../scripts/lib/throws.mjs");
const { attemptDisarm, disarmGate, disarmRefusals, registerTrapZoneSocket, SOFT_REFUSALS } = await import("../scripts/formation/trap-zone.mjs");
const { thingsOf } = await import("../scripts/lib/place-things.mjs");
const { resolveDue } = await import("../scripts/lib/turn-activities.mjs");
const { registerFormationActivities } = await import("../scripts/formation/turn-plan.mjs");
const { registerRequestSocket } = await import("../scripts/formation/player-requests.mjs");

/* --- fixtures --------------------------------------------------------------- */
const writes = [];
/** A place that holds its things in memory and records the states written, in order. */
function makePlace() {
  const flags = { things: [{ id: "thing-1", kind: "trap", ref: "Item.trap", hidden: false, params: {}, state: {} }] };
  const place = {
    uuid: "Actor.P1",
    name: "P1",
    getFlag: (scope, key) => (scope === "acks-extras" ? flags[key] : undefined),
    async update(data) {
      for (const [path, value] of Object.entries(data)) flags[/^flags\.acks-extras\.(.+)$/.exec(path)[1]] = value;
      writes.push({ ...thingsOf(place)[0].state, hidden: thingsOf(place)[0].hidden });
    },
  };
  return place;
}

const region = mockRegion({ id: "a", rings: [rect(0, 0, 100, 100)] });
const place = makePlace();
const scene = { id: "S1", grid: { size: 100, distance: 5, units: "ft" }, regions: [region], walls: [], tokens: { get: (id) => (id === "T1" ? scene.token : undefined) } };
scene.token = standOnRegions({ id: "T1", parent: scene, x: 0, y: 0, width: 1, height: 1 });
game.scenes.set("S1", scene);
globalThis.acksExtras = { location: { scenes: { locationOfRegion: (r) => (r === region ? place : null) } } };
const formation = { id: "F", name: "Probe party", sceneId: "S1", tokenId: "T1", members: [{ actorId: "Alder", roles: [] }] };
const targetUuid = "Actor.P1::thing-1";

const alder = { id: "Alder", name: "Alder", type: "character", statuses: new Set(), appliedEffects: [], items: [{ name: "Thieves' Tools" }], system: { details: { level: 3 }, adventuring: { trapbreaking: 17 }, hp: { value: 8 }, saves: {} }, getFlag: () => undefined };
game.actors = new Map([["Alder", alder]]);

/** Put the trap back to armed and found, forget every record of the last test. */
const reset = () => {
  place.update({ "flags.acks-extras.things": [{ id: "thing-1", kind: "trap", ref: "Item.trap", hidden: false, params: {}, state: {} }] });
  writes.length = 0;
  dialogs.length = 0;
  notices.length = 0;
  throws.length = 0;
  asked.length = 0;
  chats.length = 0;
  click = () => true;
};
const stateNow = () => thingsOf(place)[0].state.state ?? "armed";

registerTrapZoneSocket();
registerRequestSocket();
for (const [name, fn] of queued) if (name === "socketlib.ready") fn();
/** A player's request as the Judge's client receives it: socketlib stamps the sender. */
const relayed = (name, senderId, payload) => registered.get(name).call({ socketdata: { userId: senderId } }, payload);

const throwOnce = (natural, total) => throws.push([natural, total]);

/* --- the order of the writes ------------------------------------------------ */
await ok("a made throw writes the trap disarmed and known BEFORE the question; a discharge answer writes it discharged after", async () => {
  reset();
  let stateAtQuestion = null;
  click = () => { stateAtQuestion = { state: stateNow(), hidden: thingsOf(place)[0].hidden }; return true; };
  throwOnce(15, 20);
  const done = await attemptDisarm(formation, alder, { mode: "methodical", targetUuid, spend: false });
  assert.deepEqual(stateAtQuestion, { state: "disarmed", hidden: false }, "disarmed and known when the dialog opened");
  assert.equal(done.outcome, "disarmed", "the card is for the throw; a later discharge is noted, not awaited");
  await done.asked;
  assert.equal(stateNow(), "discharged");
  assert.deepEqual(writes.map((w) => w.state), ["disarmed", "discharged"]);
});

await ok("a disarm answer, or an answer that never comes, leaves the trap disarmed with one write", async () => {
  reset();
  click = () => false;
  throwOnce(15, 20);
  const first = await attemptDisarm(formation, alder, { targetUuid, spend: false });
  await first.asked;
  assert.equal(first.outcome, "disarmed");
  assert.deepEqual(writes.map((w) => w.state), ["disarmed"]);
  reset();
  click = () => null;
  throwOnce(15, 20);
  const dismissed = await attemptDisarm(formation, alder, { targetUuid, spend: false });
  await dismissed.asked;
  assert.equal(dismissed.outcome, "disarmed", "a dismissed dialog");
  reset();
  click = () => { throw new Error("closed"); };
  throwOnce(15, 20);
  const thrown = await attemptDisarm(formation, alder, { targetUuid, spend: false });
  await thrown.asked;
  assert.equal(thrown.outcome, "disarmed", "a dialog that throws");
  assert.equal(stateNow(), "disarmed");
});

/* --- the question holds nothing --------------------------------------------- */
/** What a promise settled to, or "pending" when it had not by the time `ms` passed. */
const settledWithin = (promise, ms = 100) => Promise.race([promise.then((v) => ({ value: v }), (e) => ({ error: e })), new Promise((r) => setTimeout(() => r("pending"), ms))]);
const stuck = () => new Promise(() => {});
const sawDischargeNote = () => chats.some((c) => String(c.content).includes("dischargedAfter"));

await ok("a question nobody answers holds neither the return nor the clock spend", async () => {
  for (const askUserId of [undefined, "player"]) {
    reset();
    click = stuck;
    remoteAnswer = stuck;
    throwOnce(15, 20);
    // The stand-in world has no clock, so the spend (`advanceTurns`) throws inside the turn engine:
    // reaching that failure, rather than hanging, is the proof the spend was reached.
    const run = await settledWithin(attemptDisarm(formation, alder, { targetUuid, askUserId }));
    assert.notEqual(run, "pending", `attemptDisarm waited on the question (askUserId ${askUserId})`);
    assert.match(String(run.error?.stack), /advanceTurns/, "the clock spend (advanceTurns) ran, and failed only on the stand-in world having no clock");
    assert.equal(chats.length, 1, "the roll card was posted at once");
    assert.equal(stateNow(), "disarmed");
  }
  remoteAnswer = () => false;
});

await ok("with the clock not spent, the return carries outcome disarmed and an asked that is still pending", async () => {
  reset();
  click = stuck;
  throwOnce(15, 20);
  const run = await settledWithin(attemptDisarm(formation, alder, { targetUuid, spend: false }));
  assert.notEqual(run, "pending", "the return did not wait");
  assert.equal(run.value.outcome, "disarmed");
  assert.equal(await settledWithin(run.value.asked, 30), "pending", "the question is still open");
  assert.equal(chats.length, 1);
});

await ok("a discharge answer after the return writes discharged and whispers one line naming the thrower", async () => {
  reset();
  let answer;
  click = () => new Promise((resolve) => { answer = resolve; });
  throwOnce(15, 20);
  const done = await attemptDisarm(formation, alder, { targetUuid, spend: false });
  assert.equal(stateNow(), "disarmed");
  assert.equal(chats.length, 1, "only the roll card so far");
  answer(true);
  await done.asked;
  assert.equal(stateNow(), "discharged");
  assert.deepEqual(writes.map((w) => w.state), ["disarmed", "discharged"]);
  assert.equal(chats.length, 2);
  assert.ok(sawDischargeNote(), "the note is the dischargedAfter line");
  assert.ok(String(chats[1].content).includes('"name":"Alder"'));
});

await ok("a thrower's name in the discharge note is escaped", async () => {
  reset();
  const rough = { ...alder, name: "<b>Al</b>" };
  throwOnce(15, 20);
  await (await attemptDisarm(formation, rough, { targetUuid, spend: false })).asked;
  const note = String(chats.at(-1).content);
  assert.ok(note.includes("dischargedAfter") && !note.includes("<b>Al"), note);
});

await ok("a Judge's reset between the write and the answer wins: the late discharge writes nothing", async () => {
  reset();
  let answer;
  click = () => new Promise((resolve) => { answer = resolve; });
  throwOnce(15, 20);
  const done = await attemptDisarm(formation, alder, { targetUuid, spend: false });
  await place.update({ "flags.acks-extras.things": [{ id: "thing-1", kind: "trap", ref: "Item.trap", hidden: false, params: {}, state: { state: "armed" } }] });
  const before = writes.length;
  answer(true);
  await done.asked;
  assert.equal(stateNow(), "armed", "the reset stands");
  assert.equal(writes.length, before, "no write after the answer");
  assert.ok(!sawDischargeNote(), "no note");
});

await ok("an ask that fails leaves the trap disarmed and asked still resolves; a failed late write is logged once", async () => {
  reset();
  click = () => { throw new Error("closed"); };
  remoteAnswer = () => { throw new Error("socket"); };
  throwOnce(15, 20);
  await (await attemptDisarm(formation, alder, { targetUuid, spend: false })).asked;
  throwOnce(15, 20);
  await (await attemptDisarm(formation, alder, { targetUuid, spend: false, askUserId: "player" })).asked;
  assert.equal(stateNow(), "disarmed");
  remoteAnswer = () => false;

  reset();
  let answer;
  click = () => new Promise((resolve) => { answer = resolve; });
  throwOnce(15, 20);
  const done = await attemptDisarm(formation, alder, { targetUuid, spend: false });
  const logged = [];
  const realError = console.error;
  const realUpdate = place.update;
  console.error = (...args) => logged.push(args);
  place.update = async () => { throw new Error("write refused"); };
  try {
    answer(true);
    await done.asked;
  } finally {
    console.error = realError;
    place.update = realUpdate;
  }
  assert.equal(logged.length, 1, "the failure is logged, not thrown");
  assert.equal(stateNow(), "disarmed");
});

/* --- who is asked ----------------------------------------------------------- */
await ok("with no askUserId, or this client's own, the dialog opens here and nothing is sent", async () => {
  for (const askUserId of [undefined, null, "judge"]) {
    reset();
    throwOnce(15, 20);
    await (await attemptDisarm(formation, alder, { targetUuid, spend: false, askUserId })).asked;
    assert.equal(dialogs.length, 1, `asked here for ${askUserId}`);
    assert.deepEqual(asked, []);
  }
});

await ok("another user is asked through the socket and the Judge's own client opens no dialog; their discharge writes discharged", async () => {
  reset();
  remoteAnswer = () => true;
  throwOnce(15, 20);
  const done = await attemptDisarm(formation, alder, { targetUuid, spend: false, askUserId: "player" });
  assert.deepEqual(dialogs, [], "no dialog on the Judge's screen");
  assert.deepEqual(asked.map((a) => [a.name, a.userId, a.payload]), [["trapAskDischarge", "player", { name: "Alder" }]]);
  assert.equal(done.outcome, "disarmed");
  await done.asked;
  assert.deepEqual(writes.map((w) => w.state), ["disarmed", "discharged"]);
});

await ok("an unanswered ask (offline user, no answer) leaves the trap disarmed", async () => {
  reset();
  throwOnce(15, 20);
  remoteAnswer = () => false;
  const done = await attemptDisarm(formation, alder, { targetUuid, spend: false, askUserId: "away" });
  await done.asked;
  assert.equal(done.outcome, "disarmed");
  assert.deepEqual(dialogs, []);
  assert.equal(stateNow(), "disarmed");
  reset();
  remoteAnswer = () => undefined;
  throwOnce(15, 20);
  const unanswered = await attemptDisarm(formation, alder, { targetUuid, spend: false, askUserId: "player" });
  await unanswered.asked;
  assert.equal(unanswered.outcome, "disarmed", "an answer of undefined is a disarm");
  assert.equal(stateNow(), "disarmed");
});

await ok("a player cannot put the question to another user: only a Judge's call opens the dialog", async () => {
  reset();
  assert.equal(await relayed("trapAskDischarge", "player", { name: "Alder" }), false);
  assert.deepEqual(dialogs, []);
  click = () => true;
  assert.equal(await relayed("trapAskDischarge", "judge", { name: "Alder" }), true);
  assert.equal(dialogs.length, 1);
});

/* --- the dialog ------------------------------------------------------------- */
await ok("the dialog escapes the actor's name and only the discharge button's true counts", async () => {
  reset();
  const rough = { ...alder, name: `<img src=x onerror=boom()> & "Al"` };
  throwOnce(15, 20);
  await (await attemptDisarm(formation, rough, { targetUuid, spend: false })).asked;
  const [config] = dialogs;
  assert.ok(!config.content.includes("<img"), "markup in a name is not live");
  assert.ok(config.content.includes("&lt;img src=x onerror=boom()&gt; &amp; &quot;Al&quot;"));
  const by = Object.fromEntries(config.buttons.map((b) => [b.action, b.callback()]));
  assert.deepEqual(by, { disarm: false, discharge: true }, "a nullish callback would turn into the action string");
  assert.equal(config.rejectClose, false);
});

/* --- the three callers ------------------------------------------------------ */
await ok("a relayed player request asks the requesting player", async () => {
  reset();
  remoteAnswer = () => false;
  throwOnce(15, 20);
  alder.testUserPermission = (user) => user.id === "player";
  // The request spends the turn on the clock after the question, which this stand-in world has no clock for;
  // the ask is what is under test, and it has been put by then.
  await relayed("partyRequest", "player", { formationId: "F", type: "trapbreak", payload: { actorId: "Alder", targetUuid, mode: "methodical" } }).catch(() => {});
  assert.deepEqual(asked.map((a) => a.userId), ["player"]);
  assert.deepEqual(dialogs, [], "nothing opened on the Judge's screen");
});

await ok("a relayed request's modifier rides the throw as a finite number, else none, and never carries the Judge's authority", async () => {
  // The bonus the formula carries, signed.
  const bonusOf = (formula) => Number(formula.replace(/^1d20\s*/, "").replace(/\s+/g, "")) || 0;
  const bonuses = [];
  for (const extra of [undefined, 2, "2", NaN, Infinity, {}]) {
    reset();
    formulas.length = 0;
    click = () => false;
    throwOnce(15, 20);
    alder.testUserPermission = (user) => user.id === "player";
    await relayed("partyRequest", "player", { formationId: "F", type: "trapbreak", payload: { actorId: "Alder", targetUuid, mode: "methodical", ...(extra === undefined ? {} : { extra }) } }).catch(() => {});
    assert.equal(formulas.length, 1, `one throw for ${String(extra)}`);
    bonuses.push(bonusOf(formulas[0]));
  }
  const [none, two, ...rest] = bonuses;
  assert.equal(two - none, 2, "a number rides the throw");
  assert.deepEqual(rest, [none, none, none, none], "a string, NaN, Infinity or an object is none");
  assert.deepEqual(asked.map((a) => a.userId), ["player"], "the question still goes to the requesting player: no Judge authority was passed");
});

await ok("the turn plan's resolve asks the user who locked the entry, and the Judge's client where none did", async () => {
  reset();
  registerFormationActivities();
  const ctx = { formation };
  for (const by of ["player", null]) {
    reset();
    click = () => false;
    throwOnce(15, 20);
    const out = await resolveDue([{ actorId: "Alder", entry: { key: "trapbreakMethodical", option: targetUuid, by } }], { actorOf: () => alder, ctx });
    assert.equal(out[0].status, "resolved", JSON.stringify(out[0]));
    if (by) assert.deepEqual(asked.map((a) => a.userId), [by]);
    else assert.deepEqual([asked.length, dialogs.length], [0, 1]);
  }
});

/* --- T-0677: the natural die before the total ------------------------------- */
const imported = (cells) => T.registerTable({ id: THROWS_DOC, source: { pages: "ZZ p. 4" }, tables: { [THROW_TABLE]: cells } }, { priority: T.PRIORITY.WORLD });

await ok("an imported automatic-failure face fails the throw even when its total reaches the target", async () => {
  T.unregisterTable(THROWS_DOC);
  imported({ autoFailMax: 3, autoSucceedMin: 18 });
  reset();
  throwOnce(2, 25);
  const done = await attemptDisarm(formation, alder, { targetUuid, spend: false });
  assert.equal(done.outcome, "failed");
  assert.deepEqual(dialogs, [], "no question for a failure");
  assert.equal(stateNow(), "armed", "the trap is untouched");
  T.unregisterTable(THROWS_DOC);
});

await ok("an imported automatic-success face succeeds for a thrower skilled in the task, and for no one else", async () => {
  T.unregisterTable(THROWS_DOC);
  imported({ autoFailMax: 3, autoSucceedMin: 18 });
  const skill = { id: "s1", type: "ability", name: "Probe Traps", system: {}, flags: { "acks-extras": { extras: { provides: ["kw:trapbreaking"], effects: [], rolls: [{ key: "methodical", label: "methodical", formula: "1d20", rollType: "above", target: { kind: "flat", flat: 15 } }] } } } };
  skill.getFlag = (scope, key) => skill.flags[scope]?.[key];
  const skilled = { ...alder, id: "Skilled", name: "Skilled", system: { ...alder.system, adventuring: {} } };
  skilled.items = Object.assign([{ name: "Thieves' Tools" }, skill], { get: (id) => (id === "s1" ? skill : undefined) });
  skill.actor = skilled;
  game.actors.set("Skilled", skilled);
  formation.members.push({ actorId: "Skilled", roles: [] });
  reset();
  click = () => false;
  throwOnce(19, 10);
  const made = await attemptDisarm(formation, skilled, { targetUuid, spend: false });
  assert.equal(made.outcome, "disarmed", "a skilled thrower's 19 passes whatever the total");
  reset();
  throwOnce(19, 10);
  assert.equal((await attemptDisarm(formation, alder, { targetUuid, spend: false })).outcome, "failed", "an unskilled thrower's does not");
  reset();
  throwOnce(17, 10);
  assert.equal((await attemptDisarm(formation, skilled, { targetUuid, spend: false })).outcome, "failed", "a face under the edge is the target's to decide");
  T.unregisterTable(THROWS_DOC);
});

await ok("with nothing imported the target alone decides, whatever the face", async () => {
  T.unregisterTable(THROWS_DOC);
  reset();
  click = () => false;
  throwOnce(1, 25);
  assert.equal((await attemptDisarm(formation, alder, { targetUuid, spend: false })).outcome, "disarmed", "a 1 whose total reaches the target is a success");
  reset();
  click = () => false;
  throwOnce(19, 10);
  assert.equal((await attemptDisarm(formation, alder, { targetUuid, spend: false })).outcome, "failed", "a high face under the target is a failure");
});


const lockOf = (level) => [{ id: "thing-1", kind: "trap", ref: "Item.trap", hidden: false, params: {}, state: { repeatLock: { Skilled: level } } }];
const bare = { ...alder, id: "Bare", name: "Bare", items: [] };
const nothing = { ...alder, id: "Nothing", name: "Nothing", system: { ...alder.system, adventuring: {} } };
for (const a of [bare, nothing]) { game.actors.set(a.id, a); formation.members.push({ actorId: a.id, roles: [] }); a.testUserPermission = (user) => user.id === "player"; }
const skilledActor = game.actors.get("Skilled");

await ok("the gate: a Judge is warned of the soft refusals and blocked by the rest; a player is blocked by the first of any", async () => {
  reset();
  assert.deepEqual(disarmRefusals(null, alder, "methodical"), ["noZone"]);
  const placement = { known: true, trapUuid: "Item.trap", state: "armed", repeatLock: {} };
  assert.deepEqual(disarmGate(placement, bare, "methodical", { judge: true }), { block: null, warnings: ["noTools"] });
  assert.deepEqual(disarmGate(placement, bare, "methodical"), { block: "noTools", warnings: [] });
  assert.deepEqual(disarmGate(placement, alder, "methodical", { judge: true }), { block: null, warnings: [] });
  assert.deepEqual(disarmGate({ ...placement, repeatLock: { Skilled: 3 } }, skilledActor, "hasty", { judge: true }).warnings, ["alreadyFailedHasty"]);
  assert.equal(disarmGate({ ...placement, repeatLock: { Skilled: 3 } }, skilledActor, "hasty").block, "alreadyFailedHasty");
  // A character with no throw at all has nothing to roll: hard for the Judge too, and the tools' warning is not the reason shown.
  assert.deepEqual(disarmGate(placement, nothing, "methodical", { judge: true }), { block: "cannotTry", warnings: [] });
});

await ok("the gate: not found, spent, disarmed and no trap are hard for the Judge, whatever else is true", async () => {
  const base = { known: true, trapUuid: "Item.trap", state: "armed", repeatLock: {} };
  for (const [patch, reason] of [[{ known: false }, "notFound"], [{ trapUuid: "" }, "noTrap"], [{ state: "disarmed" }, "alreadyDisarmed"], [{ state: "discharged" }, "alreadyDischarged"]]) {
    assert.deepEqual(disarmGate({ ...base, ...patch }, bare, "methodical", { judge: true }), { block: reason, warnings: [] }, reason);
  }
  assert.deepEqual(disarmGate(null, alder, "methodical", { judge: true }), { block: "noZone", warnings: [] });
  // A hasty try without the skill has no throw to make, so it blocks the Judge too.
  assert.deepEqual([...SOFT_REFUSALS].sort(), ["alreadyFailedHasty", "noTools"]);
});

await ok("a Judge's own attempt works past no thieves' tools; without the Judge's declaration it is refused", async () => {
  reset();
  click = () => false;
  throwOnce(15, 20);
  const refused = await attemptDisarm(formation, bare, { targetUuid, spend: false });
  assert.deepEqual([refused.ok, refused.reason], [false, "noTools"]);
  assert.equal(stateNow(), "armed");
  assert.equal(chats.length, 0, "nothing rolled");
  const made = await attemptDisarm(formation, bare, { targetUuid, spend: false, judge: true });
  assert.equal(made.outcome, "disarmed");
  assert.equal(stateNow(), "disarmed");
});

await ok("a Judge's attempt works past a failed hasty try at this level; a player's is refused", async () => {
  reset();
  place.update({ "flags.acks-extras.things": lockOf(3) });
  click = () => false;
  throwOnce(15, 20);
  const refused = await attemptDisarm(formation, skilledActor, { mode: "hasty", targetUuid, spend: false });
  assert.deepEqual([refused.ok, refused.reason], [false, "alreadyFailedHasty"]);
  const made = await attemptDisarm(formation, skilledActor, { mode: "hasty", targetUuid, spend: false, judge: true });
  assert.equal(made.ok, true, JSON.stringify(made));
});

await ok("a Judge's attempt is still refused for a character with no throw, an unfound trap and a disarmed one", async () => {
  reset();
  throwOnce(15, 20);
  assert.equal((await attemptDisarm(formation, nothing, { targetUuid, spend: false, judge: true })).reason, "cannotTry");
  place.update({ "flags.acks-extras.things": [{ id: "thing-1", kind: "trap", ref: "Item.trap", hidden: true, params: {}, state: {} }] });
  assert.equal((await attemptDisarm(formation, alder, { targetUuid, spend: false, judge: true })).reason, "notFound");
  place.update({ "flags.acks-extras.things": [{ id: "thing-1", kind: "trap", ref: "Item.trap", hidden: false, params: {}, state: { state: "disarmed" } }] });
  assert.equal((await attemptDisarm(formation, alder, { targetUuid, spend: false, judge: true })).reason, "alreadyDisarmed");
});

await ok("a relayed player request is refused a soft refusal the Judge's own press would pass", async () => {
  reset();
  remoteAnswer = () => false;
  throwOnce(15, 20);
  // The relay runs on the Judge's client, where `game.user.isGM` is true: the declaring user is what counts.
  await relayed("partyRequest", "player", { formationId: "F", type: "trapbreak", payload: { actorId: "Bare", targetUuid, mode: "methodical" } }).catch(() => {});
  assert.equal(stateNow(), "armed", "no tools: the player's request threw nothing");
  assert.deepEqual(asked, []);
  assert.ok(notices.some((m) => m.includes("refuse.noTools")), notices.join("|"));
});

await ok("the turn plan resolves a Judge's entry past a soft refusal, and a player's entry is refused again", async () => {
  registerFormationActivities();
  const ctx = { formation };
  for (const [by, resolved] of [["judge", "disarmed"], ["player", undefined]]) {
    reset();
    click = () => false;
    throwOnce(15, 20);
    const out = await resolveDue([{ actorId: "Bare", entry: { key: "trapbreakMethodical", option: targetUuid, by } }], { actorOf: () => bare, ctx });
    assert.equal(stateNow(), resolved ?? "armed", `locked by ${by}: ${JSON.stringify(out[0])}`);
  }
});


console.log(`\n${passed} passed`);
