/**
 * The Trapbreaking dialog (scripts/formation/trapbreak-app.mjs): what its
 * context says before anything is rolled, and which window answers for which
 * party and character. Foundry's globals are stand-ins, and every figure is
 * invented.
 *
 * What this pins: one window id per party and character, and a second opening
 * of a pair fronts the first; a Judge is warned of a soft refusal and Work on
 * it stays enabled, while a hard refusal disables it for the Judge too and a
 * player is blocked by any refusal with the reason on the window; the needs
 * figure reads the die's floor from lib/throws (absent with nothing imported)
 * and is blank, its tooltip the page alone, where the character's throw is not
 * read; each part keeps the page it cites; the reach shows blank with the page
 * alone until it is imported; a trap thing lists by its place's name; the
 * character's own state at the trap is stated, and the modifier is typed on
 * any seat; the window draws again when the trap or the character
 * changes, and takes its watch off when it closes; a player's press sends the
 * request with the modifier typed.
 *
 * Run: node tools/test-trapbreak-app.mjs
 */
import assert from "node:assert/strict";
import { mockRegion, rect, standOnRegions } from "./region-fixture.mjs";

let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

/* --- stand-ins -------------------------------------------------------------- */
/** Every window that rendered with `true`, by id, and how often each was fronted. */
const instances = new Map();
const fronted = [];
class Stub {
  constructor(options = {}) { this.options = options; this.rendered = false; this.renders = 0; }
  render() { this.rendered = true; this.renders++; instances.set(this.options.id, this); return Promise.resolve(this); }
  bringToFront() { fronted.push(this.options.id); }
  async close() { this.rendered = false; instances.delete(this.options.id); await this._onClose?.({}); }
  async _onFirstRender() {}
  async _onClose() {}
  _initializeApplicationOptions(options) { return options; }
}
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
    escapeHTML: (s) => String(s),
    debounce: (fn) => fn,
    expandObject: (o) => o,
  },
  applications: {
    api: { ApplicationV2: Stub, HandlebarsApplicationMixin: (B) => B, DialogV2: { wait: async () => false } },
    sheets: { ItemSheetV2: class {} },
    handlebars: {},
    instances,
  },
};
const notices = [];
const judge = { id: "judge", isGM: true, active: true };
const player = { id: "player", name: "Pat", isGM: false, active: true };
globalThis.game = {
  i18n: { localize: (key) => key, format: (key, data = {}) => (Object.keys(data).length ? `${key} ${JSON.stringify(data)}` : key), has: () => true },
  user: judge,
  users: Object.assign([judge], { get: (id) => ({ judge, player })[id], activeGM: judge }),
  scenes: new Map(),
  settings: { get: () => ({ F: formation }) },
};
globalThis.ui = { notifications: { warn: (m) => notices.push(m), info: () => {} } };
globalThis.CONFIG = { RegionBehavior: { dataModels: {}, typeIcons: {} } };
/** The hooks the window registers, by name, and which it has taken off. */
const hooks = new Map();
const queued = [];
let nextHook = 1;
const off = [];
globalThis.Hooks = {
  on: (name, fn) => { const id = nextHook++; hooks.set(id, { name, fn }); return id; },
  once: (name, fn) => queued.push([name, fn]),
  off: (name, id) => { off.push([name, id]); hooks.delete(id); },
  call() {},
  callAll() {},
};
const fire = (name, ...args) => { for (const h of [...hooks.values()]) if (h.name === name) h.fn(...args); };
/** What socketlib was handed; the player's press goes through `executeAsGM`. */
const registered = new Map();
const sent = [];
globalThis.socketlib = {
  registerModule: () => ({
    register: (name, fn) => registered.set(name, fn),
    executeAsGM: async (name, payload) => (sent.push({ name, payload }), undefined),
    executeAsUser: async () => false,
  }),
};
/** The roll the next throw makes: its natural face and total. */
const throws = [];
globalThis.Roll = class {
  constructor(formula) { this.formula = formula; }
  async evaluate() { const [natural, total] = throws.shift() ?? [15, 20]; this.total = total; this.dice = [{ results: [{ result: natural }] }]; return this; }
  async render() { return ""; }
};
globalThis.ChatMessage = { create: async () => ({}) };
globalThis.fromUuid = async (uuid) => (uuid === "Item.trap" ? { type: "acks-extras.trap", name: "Probe trap", system: { crude: false } } : null);

const T = await import("../scripts/lib/tables.mjs");
const { thingsOf } = await import("../scripts/lib/place-things.mjs");
const { THROWS_DOC, THROW_TABLE } = await import("../scripts/lib/throws.mjs");
const { default: TrapbreakApp, openTrapbreakApp, trapbreakWindowId } = await import("../scripts/formation/trapbreak-app.mjs");
const { registerRequestSocket } = await import("../scripts/formation/player-requests.mjs");
registerRequestSocket();
for (const [name, fn] of queued) if (name === "socketlib.ready") fn();

/* --- fixtures --------------------------------------------------------------- */
const thingOf = (over = {}) => ({ id: "thing-1", kind: "trap", ref: "Item.trap", hidden: false, params: {}, state: {}, ...over });
function makePlace() {
  const flags = { things: [thingOf()] };
  return {
    uuid: "Actor.P1",
    name: "Guard room",
    getFlag: (scope, key) => (scope === "acks-extras" ? flags[key] : undefined),
    async update(data) {
      for (const [path, value] of Object.entries(data)) flags[/^flags\.acks-extras\.(.+)$/.exec(path)[1]] = value;
    },
  };
}
const region = mockRegion({ id: "a", rings: [rect(0, 0, 100, 100)] });
const place = makePlace();
const scene = { id: "S1", grid: { size: 100, distance: 5, units: "ft" }, regions: [region], walls: [], tokens: { get: (id) => (id === "T1" ? scene.token : undefined) } };
scene.token = standOnRegions({ id: "T1", parent: scene, x: 0, y: 0, width: 1, height: 1 });
game.scenes.set("S1", scene);
globalThis.acksExtras = { location: { scenes: { locationOfRegion: (r) => (r === region ? place : null) } } };
const formation = { id: "F", name: "The Delvers", sceneId: "S1", tokenId: "T1", members: [] };
const targetUuid = "Actor.P1::thing-1";

const base = { type: "character", statuses: new Set(), appliedEffects: [], getFlag: () => undefined, testUserPermission: (user) => user.id === "player" };
const sheet = (adventuring) => ({ details: { level: 3 }, adventuring, hp: { value: 8 }, saves: {} });
const tools = [{ name: "Thieves' Tools" }];
const alder = { ...base, id: "Alder", name: "Alder", items: tools, system: sheet({ trapbreaking: 17 }) };
const bare = { ...base, id: "Bare", name: "Bare", items: [], system: sheet({ trapbreaking: 17 }) };
const nothing = { ...base, id: "Nothing", name: "Nothing", items: tools, system: sheet({}) };
/** A thief: a skill that answers both columns, and a second ability that adds to it and cites its page. */
const skill = { id: "s1", type: "ability", name: "Probe Traps", system: {}, flags: { "acks-extras": { extras: { provides: ["kw:trapbreaking"], effects: [], rolls: [
  { key: "methodical", label: "methodical", formula: "1d20", rollType: "above", target: { kind: "flat", flat: 15 } },
  { key: "hasty", label: "hasty", formula: "1d20", rollType: "above", target: { kind: "flat", flat: 15 } },
] } } } };
const lockwork = { id: "m1", type: "ability", name: "Lockwork", system: {}, flags: { "acks-extras": { extras: { effects: [{ type: "modifier", target: "proficiencyThrow", value: { flat: 2 }, forWhat: "Probe Traps" }] }, cookbook: { cite: "ZZ p. 31" } } } };
for (const item of [skill, lockwork]) item.getFlag = (scope, key) => item.flags[scope]?.[key];
const thief = { ...base, id: "Thief", name: "Thief", system: sheet({}), items: Object.assign([...tools, skill, lockwork], { get: (id) => ({ s1: skill, m1: lockwork })[id] }) };
skill.actor = thief;
lockwork.actor = thief;
const actors = [alder, bare, nothing, thief];
game.actors = new Map(actors.map((a) => [a.id, a]));
formation.members = actors.map((a) => ({ actorId: a.id, roles: [] }));

const setThing = (over) => place.update({ "flags.acks-extras.things": [thingOf(over)] });
const reset = () => {
  setThing();
  instances.clear();
  fronted.length = 0;
  sent.length = 0;
  notices.length = 0;
  hooks.clear();
  off.length = 0;
  game.user = judge;
  T.unregisterTable(THROWS_DOC);
  T.unregisterTable("formation");
};
const ctxOf = async (actorId, choice = {}) => {
  const app = new TrapbreakApp({ formationId: "F", actorId, choice });
  return { app, ctx: await app._prepareContext() };
};

/* --- the window ------------------------------------------------------------- */
await ok("one window id per party and character; a second opening of a pair fronts the first", async () => {
  reset();
  assert.equal(TrapbreakApp.DEFAULT_OPTIONS.id, undefined, "no fixed id on the class");
  const ids = new Set([trapbreakWindowId("F", "Alder"), trapbreakWindowId("F", "Bare"), trapbreakWindowId("G", "Alder")]);
  assert.equal(ids.size, 3, [...ids].join(" | "));
  assert.equal(new TrapbreakApp({ formationId: "F", actorId: "Alder" }).options.id, trapbreakWindowId("F", "Alder"));
  await openTrapbreakApp("F", "Alder");
  await openTrapbreakApp("F", "Bare");
  assert.equal(instances.size, 2, "two characters, two windows");
  await openTrapbreakApp("F", "Alder");
  assert.equal(instances.size, 2, "the pair already open is not opened twice");
  assert.deepEqual(fronted, [trapbreakWindowId("F", "Alder")]);
  // With no character named, the seat's first stands for the window.
  reset();
  await openTrapbreakApp("F");
  assert.ok(instances.has(trapbreakWindowId("F", "Alder")));
});

await ok("the title bar names the party and the character; a different character in the form hands over to that one's window", async () => {
  reset();
  const { app } = await ctxOf("Bare");
  assert.match(app.title, /Delvers/);
  assert.match(app.title, /Bare/);
  await app.render(true);
  await TrapbreakApp.DEFAULT_OPTIONS.form.handler.call(app, null, null, { object: { actorId: "Thief", mode: "hasty", extra: 2, targetUuid } });
  assert.ok(instances.has(trapbreakWindowId("F", "Thief")), "the other character's window opened");
  assert.ok(!instances.has(trapbreakWindowId("F", "Bare")), "this one closed");
  assert.equal(instances.get(trapbreakWindowId("F", "Thief")).choice.mode, "hasty", "the choice went with it");
});

/* --- the seats -------------------------------------------------------------- */
await ok("a Judge is warned of no thieves' tools and Work on it stays enabled; a player is blocked with the reason on the window", async () => {
  reset();
  let { ctx } = await ctxOf("Bare");
  assert.equal(ctx.canAttempt, true);
  assert.equal(ctx.refusal, null);
  assert.equal(ctx.warnings.length, 1);
  assert.match(ctx.warnings[0].text, /refuse\.noTools/);
  assert.ok(ctx.warnings[0].advice, "the warning says the Judge may go on");
  game.user = player;
  ({ ctx } = await ctxOf("Bare"));
  assert.equal(ctx.canAttempt, false);
  assert.deepEqual(ctx.warnings, []);
  assert.match(ctx.refusal.text, /refuse\.noTools/, "the reason is on the window, not only in a toast");
});

await ok("a Judge is blocked by what leaves nothing to roll: a spent trap, an unfound one, and a character with no throw", async () => {
  reset();
  setThing({ state: { state: "disarmed" } });
  let { ctx } = await ctxOf("Alder");
  assert.equal(ctx.canAttempt, false);
  assert.match(ctx.refusal.text, /alreadyDisarmed/);
  setThing({ hidden: true });
  ({ ctx } = await ctxOf("Alder"));
  assert.equal(ctx.canAttempt, false, "the Judge sees the unfound trap and cannot work on it");
  assert.match(ctx.refusal.text, /notFound/);
  assert.equal(ctx.targets[0].known, false);
  setThing();
  ({ ctx } = await ctxOf("Nothing"));
  assert.equal(ctx.canAttempt, false);
  assert.equal(ctx.refusal, null, "a throw nobody read says nothing beyond the blank figure");
  assert.equal(ctx.needs, null);
});

await ok("a failed hasty try is stated as the character's own state, at the level it failed; absent one, the note says none is recorded", async () => {
  reset();
  setThing({ state: { repeatLock: { Thief: 4 } } });
  let { ctx } = await ctxOf("Thief", { mode: "hasty" });
  assert.equal(ctx.canAttempt, true, "a Judge goes on");
  assert.match(ctx.warnings[0].text, /stateFailedHasty.*"level":4/);
  assert.equal(ctx.note, null, "the warning already says it");
  game.user = player;
  ({ ctx } = await ctxOf("Thief", { mode: "hasty" }));
  assert.equal(ctx.canAttempt, false);
  assert.match(ctx.refusal.text, /stateFailedHasty.*"level":4/);
  assert.equal(ctx.refusal.tip, "ACKS-FORMATION.traps.pageTrapbreak");
  setThing();
  ({ ctx } = await ctxOf("Thief", { mode: "hasty" }));
  assert.match(ctx.note.text, /stateNoFailedHasty.*"level":3/);
  assert.equal(ctx.note.tip, "ACKS-FORMATION.traps.pageTrapbreak");
});

await ok("the modifier is typed on any seat and rides that seat's throw; a player's request carries it", async () => {
  reset();
  let { ctx } = await ctxOf("Alder", { extra: 2 });
  assert.equal(ctx.extra, 2);
  assert.equal(ctx.needs, 15, "17 lowered by the modifier");
  assert.ok(ctx.judgePart);
  assert.match(ctx.judgePart.tip, /judge/i, "the Judge's figure keeps the Judge's tooltip");
  game.user = player;
  ({ ctx } = await ctxOf("Alder", { extra: 2 }));
  assert.equal(ctx.extra, 2, "a player's dialog shows the modifier typed");
  assert.equal(ctx.needs, 15, "and lowers the die by it");
  assert.equal(ctx.judgePart.display, "+2");
  assert.equal(ctx.judgePart.tip, "ACKS-FORMATION.doors.judgeModTyped", "the figure says where it came from: this seat");
  assert.match(ctx.needsTip, /ACKS-FORMATION.doors.judgeModTyped/, "and so does the throw's own tooltip");
  assert.equal(ctx.isGM, false, "the Judge's gate and Mark found stay the Judge's");
  // The press: a player's request names the character, the trap, the column and the modifier.
  const app = new TrapbreakApp({ formationId: "F", actorId: "Alder", choice: { extra: 5, mode: "methodical" } });
  await TrapbreakApp.DEFAULT_OPTIONS.actions.attempt.call(app);
  assert.equal(sent.length, 1, JSON.stringify(sent));
  assert.equal(sent[0].name, "partyRequest");
  assert.deepEqual(sent[0].payload.payload, { actorId: "Alder", targetUuid, mode: "methodical", extra: 5 });
});

await ok("the Judge's press carries the Judge's authority into the throw and a player's does not", async () => {
  reset();
  const stateNow = () => thingsOf(place)[0].state.state ?? "armed";
  const app = new TrapbreakApp({ formationId: "F", actorId: "Bare" });
  // The clock the throw spends after it has written the trap is not part of this world.
  await TrapbreakApp.DEFAULT_OPTIONS.actions.attempt.call(app).catch(() => {});
  assert.equal(stateNow(), "disarmed", "a Judge's press with no thieves' tools throws, and the trap is beaten");
  reset();
  game.user = player;
  await TrapbreakApp.DEFAULT_OPTIONS.actions.attempt.call(new TrapbreakApp({ formationId: "F", actorId: "Bare" }));
  assert.equal(stateNow(), "armed", "a player's request is sent for the Judge's client to roll");
  assert.equal(sent.length, 1);
});

await ok("Re-arm is offered to a player and enabled for either seat only on a disarmed trap", async () => {
  reset();
  let { ctx } = await ctxOf("Alder");
  assert.deepEqual([ctx.showRearm, ctx.canRearm], [true, false], "the Judge's button is drawn and disabled while the trap is armed");
  game.user = player;
  ({ ctx } = await ctxOf("Alder"));
  assert.deepEqual([ctx.showRearm, ctx.canRearm], [false, false], "a player is not shown it for an armed trap");
  setThing({ state: { state: "disarmed" } });
  ({ ctx } = await ctxOf("Alder"));
  assert.deepEqual([ctx.showRearm, ctx.canRearm], [true, true], "a player is shown it and may press it");
  game.user = judge;
  ({ ctx } = await ctxOf("Alder"));
  assert.deepEqual([ctx.showRearm, ctx.canRearm], [true, true]);
});

await ok("a character who throws methodically and not hastily is told so in hasty mode, on both seats; one with no throw in either column stays blank", async () => {
  reset();
  let { ctx } = await ctxOf("Alder", { mode: "hasty" });
  assert.equal(ctx.canAttempt, false, "nothing to roll: a hard block for the Judge too");
  assert.match(ctx.refusal.text, /refuse.hastyNeedsSkill/);
  assert.equal(ctx.needs, null);
  game.user = player;
  ({ ctx } = await ctxOf("Alder", { mode: "hasty" }));
  assert.match(ctx.refusal.text, /refuse.hastyNeedsSkill/);
  ({ ctx } = await ctxOf("Alder", { mode: "methodical" }));
  assert.equal(ctx.refusal, null);
  assert.equal(ctx.canAttempt, true);
  ({ ctx } = await ctxOf("Nothing", { mode: "hasty" }));
  assert.equal(ctx.refusal, null, "neither column read: blank, and no words");
  assert.equal(ctx.canAttempt, false);
});

/* --- the figures ------------------------------------------------------------ */
const importThrows = (cells) => T.registerTable({ id: THROWS_DOC, source: { pages: "ZZ p. 4" }, tables: { [THROW_TABLE]: cells } }, { priority: T.PRIORITY.WORLD });

await ok("needs reads the die's floor from lib/throws, and with nothing imported the target alone decides", async () => {
  reset();
  let { ctx } = await ctxOf("Alder", { extra: 30 });
  assert.equal(ctx.needs, 1, "no floor imported: nothing below the die's own lowest face");
  assert.ok(!ctx.needsTip.includes("tipFloor"), ctx.needsTip);
  importThrows({ autoFailMax: 3, autoSucceedMin: 18 });
  ({ ctx } = await ctxOf("Alder", { extra: 30 }));
  assert.equal(ctx.needs, 4, "one past the imported failing edge");
  assert.match(ctx.needsTip, /tipFloor.*"floor":4.*ZZ p\. 4/);
  ({ ctx } = await ctxOf("Alder"));
  assert.equal(ctx.needs, 17, "a target above the floor is the target");
  ({ ctx } = await ctxOf("Thief"));
  assert.equal(ctx.needs, 13, "a skilled thrower's own target, lowered by the part");
});

await ok("a skilled thrower's automatic-success face lowers what the die must show, and the tooltip says so", async () => {
  reset();
  importThrows({ autoFailMax: 3, autoSucceedMin: 12 });
  const { ctx } = await ctxOf("Thief");
  assert.equal(ctx.needs, 12);
  assert.match(ctx.needsTip, /tipSucceeds.*"face":12/);
});

await ok("needs is blank with the page alone where the character's throw is not read", async () => {
  reset();
  const { ctx } = await ctxOf("Nothing");
  assert.equal(ctx.hasThrow, false);
  assert.equal(ctx.needs, null);
  assert.equal(ctx.needsTip, "ACKS-FORMATION.traps.pageThrow");
  assert.equal(ctx.parts.length, 0);
});

await ok("needs and each part hover where the figure came from: the throw's page, and the page each part cites", async () => {
  reset();
  const { ctx } = await ctxOf("Thief");
  assert.equal(ctx.hasThrow, true);
  assert.equal(ctx.parts.length, 1, JSON.stringify(ctx.parts));
  assert.match(ctx.parts[0].tip, /Lockwork.*\(ZZ p\. 31\)/, "the part keeps its page");
  assert.match(ctx.needsTip, /tipNeeds.*pageThrow/);
  assert.match(ctx.needsTip, /Lockwork \+2 \(ZZ p\. 31\)/);
  assert.match(ctx.throwLine.tip, /tipNeeds/);
});

await ok("the reach is blank with the page alone until imported; imported, it hovers the page it was read from", async () => {
  reset();
  let { ctx } = await ctxOf("Alder");
  assert.equal(ctx.reachText, "—");
  assert.equal(ctx.reachTip, "ACKS-FORMATION.traps.pageTrapbreak");
  assert.equal(ctx.targets[0].distance, "ACKS-FORMATION.traps.breakTouching");
  T.registerTable({ id: "formation", source: { pages: "ZZ p. 9" }, tables: { trapbreakReachFeet: 30 } }, { priority: T.PRIORITY.WORLD });
  ({ ctx } = await ctxOf("Alder"));
  assert.equal(ctx.reachText, `ACKS-FORMATION.traps.feet ${JSON.stringify({ feet: 30 })}`);
  assert.match(ctx.reachTip, /tipReach.*ZZ p\. 9/);
  assert.equal(ctx.targets[0].distance, `ACKS-FORMATION.traps.feet ${JSON.stringify({ feet: 0 })}`);
});

await ok("a trap thing lists by its place's name, a wall by its kind; an unfound target is marked for the Judge and not listed for a player", async () => {
  reset();
  scene.walls = [{ uuid: "Scene.S1.Wall.w1", id: "w1", parent: scene, c: [50, 50, 50, 60], flags: { "acks-extras": { trap: { trapUuid: "Item.trap", state: "armed", known: false } } } }];
  try {
    let { ctx } = await ctxOf("Alder");
    assert.equal(ctx.targets.length, 2);
    const wall = ctx.targets.find((t) => /targetWall/.test(t.label));
    assert.ok(wall, JSON.stringify(ctx.targets));
    assert.equal(wall.known, false, "the Judge sees it, flagged");
    assert.match(ctx.targets.find((t) => !/targetWall/.test(t.label)).label, /targetThing.*Guard room/);
    game.user = player;
    ({ ctx } = await ctxOf("Alder"));
    assert.equal(ctx.targets.length, 1, "a player is offered only what the party has found");
    assert.match(ctx.targets[0].label, /targetThing/);
  } finally {
    scene.walls = [];
  }
});

/* --- redraw and teardown ---------------------------------------------------- */
await ok("the window draws again when the trap, the party or the character changes, and not for a stranger", async () => {
  reset();
  const app = new TrapbreakApp({ formationId: "F", actorId: "Bare" });
  await app.render(true);
  await app._onFirstRender({}, {});
  const before = app.renders;
  fire("updateWall", {});
  fire("updateRegionBehavior", {});
  fire("updateActor", { id: "Bare" }, { system: { hp: { value: 3 } } });
  fire("updateActor", { id: "Stranger" }, { system: { hp: { value: 3 } } });
  fire("updateActor", { id: "P1" }, { flags: { "acks-extras": { things: [] } } });
  fire("createItem", { parent: { id: "Bare" } });
  fire("createItem", { parent: { id: "Stranger" } });
  fire("deleteActiveEffect", { parent: { id: "Bare" } });
  fire("updateToken", { id: "T1" });
  fire("updateToken", { id: "T9" });
  fire("updateSetting", { key: "acks-extras.formations" });
  fire("updateSetting", { key: "acks-extras.other" });
  assert.equal(app.renders - before, 8, "wall, behavior, member, place, item, effect, token and the party record each draw once; a stranger, another token and another setting draw none");
  await app.close();
  assert.equal(hooks.size, 0, "every hook is taken off at close");
  assert.ok(off.length > 5);
  const after = app.renders;
  fire("updateWall", {});
  assert.equal(app.renders, after, "a closed window draws nothing");
});

console.log(`\n${passed} passed`);
