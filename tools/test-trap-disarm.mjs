/**
 * `attemptDisarm` (scripts/formation/trap-zone.mjs): who is asked to disarm or
 * discharge, in what order the trap is written, and how the throw is read.
 * Foundry's globals are stand-ins, and every figure is invented.
 *
 * What this pins: a made throw writes the trap disarmed (and known) BEFORE the
 * question is put, so a question that is lost or never answered leaves a valid
 * disarmed trap, and an answer of discharge writes the trap discharged after;
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
globalThis.ChatMessage = { create: async () => ({}) };
globalThis.fromUuid = async (uuid) => (uuid === "Item.trap" ? { type: "acks-extras.trap", name: "Probe trap", system: { crude: false } } : null);
/** Each roll the test queues: the natural face and the total. */
const throws = [];
globalThis.Roll = class {
  constructor(formula) { this.formula = formula; }
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
const sockets = await import("../scripts/lib/sockets.mjs");
const { attemptDisarm, thingPlacement, registerTrapZoneSocket } = await import("../scripts/formation/trap-zone.mjs");
const { thingsOf } = await import("../scripts/lib/place-things.mjs");
const { registerTurnActivity, resolveDue } = await import("../scripts/lib/turn-activities.mjs");
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
  assert.equal(done.outcome, "discharged");
  assert.equal(stateNow(), "discharged");
  assert.deepEqual(writes.map((w) => w.state), ["disarmed", "discharged"]);
});

await ok("a disarm answer, or an answer that never comes, leaves the trap disarmed with one write", async () => {
  reset();
  click = () => false;
  throwOnce(15, 20);
  assert.equal((await attemptDisarm(formation, alder, { targetUuid, spend: false })).outcome, "disarmed");
  assert.deepEqual(writes.map((w) => w.state), ["disarmed"]);
  reset();
  click = () => null;
  throwOnce(15, 20);
  assert.equal((await attemptDisarm(formation, alder, { targetUuid, spend: false })).outcome, "disarmed", "a dismissed dialog");
  reset();
  click = () => { throw new Error("closed"); };
  throwOnce(15, 20);
  assert.equal((await attemptDisarm(formation, alder, { targetUuid, spend: false })).outcome, "disarmed", "a dialog that throws");
  assert.equal(stateNow(), "disarmed");
});

/* --- who is asked ----------------------------------------------------------- */
await ok("with no askUserId, or this client's own, the dialog opens here and nothing is sent", async () => {
  for (const askUserId of [undefined, null, "judge"]) {
    reset();
    throwOnce(15, 20);
    await attemptDisarm(formation, alder, { targetUuid, spend: false, askUserId });
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
  assert.equal(done.outcome, "discharged");
  assert.deepEqual(writes.map((w) => w.state), ["disarmed", "discharged"]);
});

await ok("an unanswered ask (offline user, no answer) leaves the trap disarmed", async () => {
  reset();
  throwOnce(15, 20);
  const done = await attemptDisarm(formation, alder, { targetUuid, spend: false, askUserId: "away" });
  assert.equal(done.outcome, "disarmed");
  assert.deepEqual(dialogs, []);
  assert.equal(stateNow(), "disarmed");
  reset();
  remoteAnswer = () => undefined;
  throwOnce(15, 20);
  assert.equal((await attemptDisarm(formation, alder, { targetUuid, spend: false, askUserId: "player" })).outcome, "disarmed", "an answer of undefined is a disarm");
});

/* --- the dialog ------------------------------------------------------------- */
await ok("the dialog escapes the actor's name and only the discharge button's true counts", async () => {
  reset();
  const rough = { ...alder, name: `<img src=x onerror=boom()> & "Al"` };
  throwOnce(15, 20);
  await attemptDisarm(formation, rough, { targetUuid, spend: false });
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

await ok("the turn plan's resolve asks the user who locked the entry, and the Judge's client where none did", async () => {
  reset();
  registerFormationActivities();
  const ctx = { formation };
  for (const by of ["player", null]) {
    reset();
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

console.log(`\n${passed} passed`);
