/**
 * The crossing's surface (`scripts/formation/crossing.mjs` and
 * `templates/formation/formation-crossing.hbs`): the view a seat gets, the
 * writes a throw and a setup edit make, the card a throw posts, and the
 * partial's markup. Actors, documents and dice are stand-ins; every figure,
 * ladder and word is invented, and no book is imported, so these tests prove
 * the machinery and never the book.
 *
 * What this pins: with nothing imported a row's target is blank and its
 * tooltip is the page reference alone; the Adventuring column of the table
 * never stands in for a member's own figure; a Judge is warned on a
 * permission refusal and refused on an absence; a player is blocked on both
 * and a player's press writes nothing; two writes in flight both land; a card
 * says it was thrown over a refusal, prints the imported words escaped, and
 * reports a fall without touching hit points.
 *
 * Run: node tools/test-crossing-surface.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";

let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

/* --- the real strings, so a key that does not exist fails here ------------- */
const LANG = JSON.parse(fs.readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
const lookup = (key) => {
  if (key in LANG) return LANG[key];
  const [root, ...rest] = key.split(".");
  return rest.reduce((at, part) => at?.[part], LANG[root]);
};
const format = (key, data = {}) => {
  const text = lookup(key);
  assert.equal(typeof text, "string", `lang key ${key} exists`);
  return text.replace(/\{(\w+)\}/g, (_, name) => String(data[name] ?? ""));
};

/* --- stand-ins -------------------------------------------------------------- */
class ForcedDeletion {}
class ForcedReplacement {
  constructor(value) { this.value = value; }
  static create(value) { return new ForcedReplacement(value); }
}
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

const GM = { id: "gm1", isGM: true };
const PLAYER = { id: "pl1", isGM: false };
const OTHER = { id: "pl2", isGM: false };

const seen = { created: [], warned: [], told: [], updates: [] };
const naturals = [];
let rollDelay = 0;
let serial = 0;

globalThis.game = {
  user: GM,
  users: [GM, PLAYER, OTHER],
  i18n: { localize: (k) => (typeof lookup(k) === "string" ? lookup(k) : k), format, has: (k) => typeof lookup(k) === "string" },
  settings: { get: () => ({}) },
  actors: new Map(),
  scenes: new Map(),
  items: [],
};
globalThis.ui = { notifications: { info: (m) => seen.told.push(m), warn: (m) => seen.warned.push(m), error() {} } };
globalThis.Hooks = { on() {}, once() {}, off() {}, call() {}, callAll() {} };
globalThis.Roll = class {
  constructor(formula) { this.formula = formula; }
  async evaluate() {
    if (rollDelay) await new Promise((resolve) => setTimeout(resolve, rollDelay));
    const natural = naturals.shift() ?? 10;
    this.total = natural;
    this.dice = [{ results: [{ result: natural }] }];
    return this;
  }
  async render() { return `<div class="dice-roll">${this.total}</div>`; }
};
globalThis.ChatMessage = { create: async (data) => { seen.created.push(data); return data; } };
class Stub {}
globalThis.foundry = {
  abstract: { DataModel: class {}, TypeDataModel: class {} },
  data: { regionBehaviors: { RegionBehaviorType: Stub }, fields: {}, operators: { ForcedDeletion, ForcedReplacement } },
  utils: {
    escapeHTML: (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]),
    deepClone: clone,
    randomID: () => `id${++serial}`,
  },
  applications: {
    api: { ApplicationV2: Stub, HandlebarsApplicationMixin: (B) => B, DialogV2: Stub },
    handlebars: { renderTemplate: async () => "<section>card</section>" },
  },
};

const tables = await import("../scripts/lib/tables.mjs");
const { registerTable, resetTables, PRIORITY } = tables;
const { FORMATION_DOC } = await import("../scripts/formation/constants.mjs");
const { OUTCOMES_TABLE } = await import("../scripts/formation/obstacles.mjs");
const crossing = await import("../scripts/formation/crossing.mjs");
const {
  CROSSING_KINDS, applyCrossingForm, beginCrossing, buildCrossingView, endCrossing, readCrossing, requestCrossingThrow,
  throwAll, throwFor, writeMemberStep,
} = crossing;

/* --- fixtures ---------------------------------------------------------------- */
const ladder = (...pairs) => ({ kind: "breakpoints", breakpoints: pairs.map(([atLevel, value]) => ({ atLevel, value })) });
const throwOf = (key, target) => ({ key, label: key, formula: "1d20", rollType: "above", target, scale: "level" });
function item(name, rolls, { provides = [], cite = "" } = {}) {
  const flags = { "acks-extras": { extras: { rolls, effects: [], provides }, ...(cite ? { cookbook: { cite } } : {}) } };
  return { id: `i${++serial}`, type: "ability", name, system: {}, flags, getFlag: (scope, key) => flags[scope]?.[key] };
}
const CLIMBING = () => item("Probe Climb", [throwOf("climb", ladder([1, 15], [5, 12]))], { provides: ["kw:climbing"], cite: "XX p.9" });
const ACROBATICS = () => item("Probe Tumble", [], { provides: ["kw:acrobatics"], cite: "XX p.3" });

/** A person on the world's actor list. `owner` is the user id who owns them besides the GM. */
function person(name, { items = [], adventuring = { climb: 14 }, hp = 8, level = 6, dex = 14, owner = null, type = "character" } = {}) {
  const actor = {
    id: name, name, type, img: `${name}.webp`, statuses: new Set(), appliedEffects: [],
    system: {
      details: { level, morale: 0 }, adventuring: adventuring ? { ...adventuring } : undefined, hp: { value: hp, max: 10 },
      encumbrance: { value: 0 }, scores: { dex: { value: dex, mod: 0 } }, saves: {}, attack: { throw: 10 }, surprise: {}, initiative: {},
    },
    getFlag: () => undefined,
    testUserPermission: (user) => !!user?.isGM || user?.id === owner,
    isOwner: false,
    async update(data) { seen.updates.push(["member", data]); },
  };
  for (const i of items) i.actor = actor;
  actor.items = Object.assign([...items], { get: (id) => items.find((i) => i.id === id) });
  game.actors.set(name, actor);
  return actor;
}

/** Apply one dotted-path update to a flag object, honouring Foundry's two operators. */
function applyPath(root, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  let at = root;
  for (const key of keys) at = at[key] ??= {};
  if (value instanceof ForcedDeletion) delete at[last];
  else if (value instanceof ForcedReplacement) at[last] = clone(value.value);
  else if (value && typeof value === "object") at[last] = { ...(at[last] ?? {}), ...clone(value) };
  else at[last] = value;
}

/** The party actor: a flag store whose update takes a tick, so concurrent writes interleave. */
function party(id = "party1") {
  const store = { flags: { "acks-extras": {} } };
  const actor = {
    id, name: "Party", store,
    getFlag: (scope, key) => clone(store.flags[scope]?.[key]),
    async update(data) {
      seen.updates.push(["party", data]);
      await new Promise((resolve) => setTimeout(resolve, 0));
      for (const [path, value] of Object.entries(data)) applyPath(store, path, value);
    },
  };
  game.actors.set(id, actor);
  return actor;
}

/** A formation holding these actors, with a party actor beside it. */
function world(actors) {
  const actor = party();
  return { actor, formation: { id: "f1", name: "Party", actorId: actor.id, members: actors.map((a) => ({ actorId: a.id })) } };
}

/** The registered tables, invented; nothing registered is the world with nothing imported. */
const SPELUNKING = {
  stretchFeet: 40,
  adventuring: { easyClimb: 6, sheerClimb: false, rappel: 8, crawl: 6, narrowLedge: 7, precariousLedge: false },
  botchBand: { sheerClimb: { min: 1, max: 1 } },
};
const OUTCOMES = {
  sheerClimb: { fail: { text: "Holds on <b>tight</b>", falls: false, advances: false }, botch: { text: "Plummets", falls: true } },
  easyClimb: { fail: { text: "Inch along", falls: false, advances: true } },
};
const JUMPING = { jumpDie: "1d8", runUpFeet: 15, standingShare: 0.5, feetPerStone: 3, creatureDex: 10, leapPlus: 2, leapMinimum: 1 };
const FALL = { die: "1d8", feetPerDie: 15 };
const load = ({ spelunking = SPELUNKING, outcomes = OUTCOMES, jumping = JUMPING, fall = FALL } = {}) => {
  resetTables();
  registerTable(
    {
      id: FORMATION_DOC,
      source: { pages: "XX p.1" },
      cites: { spelunking: "XX p.1", fall: "XX p.2", jumping: "XX p.3" },
      tables: {
        ...(spelunking && { spelunking }),
        ...(outcomes && { [OUTCOMES_TABLE]: outcomes }),
        ...(jumping && { jumping }),
        ...(fall && { fall }),
      },
    },
    { priority: PRIORITY.WORLD, source: "test" },
  );
};

const as = (user, fn) => {
  const was = game.user;
  game.user = user;
  try { return fn(); } finally { game.user = was; }
};
const reset = () => {
  seen.created.length = 0;
  seen.warned.length = 0;
  seen.told.length = 0;
  seen.updates.length = 0;
  naturals.length = 0;
  game.actors.clear();
  resetTables();
};
const rowOf = (view, name) => view.rows.find((r) => r.name === name);

/* ---------------------------------------------------------------------------- */

await ok("who sees what: a Judge always has the begin row, a player nothing until a crossing is open", async () => {
  reset();
  const alder = person("Alder", { owner: PLAYER.id });
  const { formation } = world([alder]);
  const judge = buildCrossingView(formation);
  assert.deepEqual([judge.open, judge.kinds.length], [false, CROSSING_KINDS.length]);
  assert.equal(judge.kinds.at(-1).value, "jump");
  assert.equal(as(PLAYER, () => buildCrossingView(formation)), null, "a player sees no section while none is open");
  await as(PLAYER, () => beginCrossing(formation, "sheerClimb"));
  assert.equal(readCrossing(formation), null, "a player's client opens nothing");
  assert.ok(await beginCrossing(formation, "sheerClimb"));
  assert.equal(await beginCrossing(formation, "easyClimb"), null, "a second crossing is not opened over the first");
  const open = as(PLAYER, () => buildCrossingView(formation));
  assert.equal(open.open, true);
  assert.equal(open.isGM, false);
});

await ok("with nothing imported a row's target is blank and its tooltip is the page reference alone", async () => {
  reset();
  const beast = person("Wolf", { type: "monster", adventuring: null });
  const plain = person("Birch", { adventuring: { climb: 14 } });
  const { formation } = world([beast, plain]);
  await beginCrossing(formation, "sheerClimb");
  const view = buildCrossingView(formation);
  const own = rowOf(view, "Birch");
  assert.equal(own.target, "14+", "a character's own figure is shown whatever is imported");
  assert.deepEqual([own.can, own.said], [false, ""], "and the row is refused for absence, with no words");
  const row = rowOf(view, "Wolf");
  assert.equal(row.target, "", "no target is made up for a member with no figure");
  assert.equal(row.targetTip, "RR ch. 6, Spelunking", "the reference alone");
  assert.equal(row.permitted, "", "the table is not imported, so permitted-or-not is blank");
  assert.equal(row.permittedTip, "RR ch. 6, Spelunking");
  assert.equal(row.covered, "", "no stretch is imported, so no count is shown");
  assert.equal(row.coveredTip, "RR ch. 6, Spelunking");
  assert.equal(row.can, false, "a member nothing resolves for is refused, for a Judge too");
  assert.equal(row.said, "", "a refusal for a figure nobody imported has no words");
  assert.equal(view.canThrowAll, false);
});

await ok("a table's Adventuring column is permitted-or-not and never a member's figure", async () => {
  reset();
  load();
  const beast = person("Wolf", { type: "monster", adventuring: null });
  const { formation } = world([beast]);
  await beginCrossing(formation, "easyClimb");
  const row = rowOf(buildCrossingView(formation), "Wolf");
  assert.equal(row.target, "", "the table's 6 is not this creature's figure");
  assert.equal(row.permitted, "May try", "the column says whether the member may try");
  assert.ok(row.permittedTip.endsWith("XX p.1"), "the row's tooltip names the imported page");
  assert.equal(row.can, false, "no figure, no throw");
});

await ok("a holder's and a non-holder's targets carry their parts; the Judge modifier lowers both and is a part", async () => {
  reset();
  load();
  const holder = person("Alder", { items: [CLIMBING()] });
  const plain = person("Birch", { adventuring: { climb: 14 } });
  const { formation } = world([holder, plain]);
  await beginCrossing(formation, "easyClimb");
  await applyCrossingForm(formation, { length: "100", judgeMod: "2" });
  const view = buildCrossingView(formation);
  const h = rowOf(view, "Alder");
  const p = rowOf(view, "Birch");
  assert.deepEqual([h.target, p.target], ["10+", "12+"], "level 6 ladder 12, stored 14, each less the modifier of 2");
  assert.equal(h.holds, true);
  assert.equal(h.permitted, "", "the Adventuring column does not apply to a holder, so it is not shown beside their Throw");
  assert.equal(p.holds, false);
  assert.ok(h.targetTip.includes("Probe Climb"), "the skill is named");
  assert.ok(p.targetTip.includes("Adventuring"), "the stored route is named");
  assert.ok(h.targetTip.includes("+2 Judge modifier"), "the modifier is a part of the figure");
  assert.equal(h.covered, "0 / 3", "100 feet is three stretches of 40");
  assert.ok(h.coveredTip.includes("3 stretches of 40") && h.coveredTip.includes("XX p.1"));
  assert.equal(h.can, true);
});

await ok("a Judge is warned on a permission refusal and a player is blocked, each with the reason as text", async () => {
  reset();
  load();
  const plain = person("Birch", { owner: PLAYER.id, adventuring: { climb: 14 } });
  const { formation } = world([plain]);
  await beginCrossing(formation, "sheerClimb");
  const judge = rowOf(buildCrossingView(formation), "Birch");
  assert.deepEqual([judge.can, judge.warn], [true, true], "the Judge's throw proceeds");
  assert.equal(judge.said, "Birch cannot attempt this");
  const player = rowOf(as(PLAYER, () => buildCrossingView(formation)), "Birch");
  assert.deepEqual([player.can, player.warn], [false, false], "the player's row is blocked");
  assert.equal(player.said, "Birch cannot attempt this", "the reason is text on the row");
  const stranger = rowOf(as(OTHER, () => buildCrossingView(formation)), "Birch");
  assert.equal(stranger.can, false, "a seat that owns nobody has no button");
  assert.equal(stranger.said, "", "and is not told a reason it can do nothing about");
});

await ok("an absence refusal stops a Judge too and rolls nothing", async () => {
  reset();
  load({ spelunking: { ...SPELUNKING, stretchFeet: undefined } });
  const plain = person("Birch", { adventuring: { climb: 14 } });
  const { formation } = world([plain]);
  await beginCrossing(formation, "easyClimb");
  const row = rowOf(buildCrossingView(formation), "Birch");
  assert.equal(row.can, false);
  assert.equal(row.warn, false);
  const out = await throwFor(formation, "Birch");
  assert.equal(out.ok, false);
  assert.equal(seen.created.length, 0, "no card");
  assert.deepEqual(readCrossing(formation).members, {}, "no record");
});

await ok("a throw writes its member, posts one card to the Judges and spends no hit points", async () => {
  reset();
  load();
  const holder = person("Alder", { items: [CLIMBING()], hp: 8 });
  const { formation, actor } = world([holder]);
  await beginCrossing(formation, "sheerClimb");
  await applyCrossingForm(formation, { length: "40" });
  naturals.push(17);
  const out = await throwFor(formation, "Alder");
  assert.deepEqual([out.ok, out.step], [true, "across"], "17 meets 12 over one stretch");
  assert.deepEqual(
    [readCrossing(formation).members.Alder.state, readCrossing(formation).members.Alder.covered, readCrossing(formation).members.Alder.throws],
    ["across", 1, 1],
  );
  assert.equal(seen.created.length, 1);
  assert.deepEqual(seen.created[0].whisper, ["gm1"], "the card goes to the Judges alone");
  assert.ok(seen.created[0].content.includes("acks-extras-roll-card"), "through the shared card");
  assert.equal(holder.system.hp.value, 8, "hit points are untouched");
  assert.equal(seen.updates.filter(([who]) => who === "member").length, 0, "no member document is written");
  assert.equal(actor.store.flags["acks-extras"].crossing.members.Alder.state, "across");
  const again = await throwFor(formation, "Alder");
  assert.equal(again.ok, false, "a member who is across has nothing left to throw");
});

await ok("a miss that does not advance stalls the member; the imported words are escaped and carry their provenance", async () => {
  reset();
  load();
  const holder = person("Alder", { items: [CLIMBING()] });
  const { formation } = world([holder]);
  await beginCrossing(formation, "sheerClimb");
  await applyCrossingForm(formation, { length: "80" });
  naturals.push(5);
  const out = await throwFor(formation, "Alder");
  assert.equal(out.step, "stalled");
  const content = seen.created[0].content;
  assert.ok(content.includes("Holds on &lt;b&gt;tight&lt;/b&gt;"), "the imported words are escaped");
  assert.ok(content.includes('data-tooltip-text="Imported (XX p.1)"'), "and their tooltip names the page");
  assert.equal(readCrossing(formation).members.Alder.covered, 0);
  const view = buildCrossingView(formation);
  assert.equal(rowOf(view, "Alder").stalled, true);
  assert.equal(rowOf(view, "Alder").warn, true, "a stalled member is the Judge's to rule on");
});

await ok("a fall reports its distance and dice on the card and the row, and touches no hit points", async () => {
  reset();
  load();
  const holder = person("Alder", { items: [CLIMBING()], hp: 8 });
  const { formation } = world([holder]);
  await beginCrossing(formation, "sheerClimb");
  await applyCrossingForm(formation, { length: "120" });
  naturals.push(1);
  const out = await throwFor(formation, "Alder");
  assert.equal(out.step, "fell");
  assert.equal(out.fall.feet, 20, "no stretch made, half of the stretch in progress");
  const content = seen.created[0].content;
  assert.ok(content.includes("Fall: 20 ft, 1d8. Hit points unchanged."), "distance and dice");
  assert.ok(content.includes("Natural 1"), "the botch is said");
  assert.equal(holder.system.hp.value, 8);
  const row = rowOf(buildCrossingView(formation), "Alder");
  assert.equal(row.fall.text, "Fell 20 ft, 1d8");
  assert.ok(row.fall.tip.includes("XX p.2"), "the dice name the imported page");
  assert.equal(row.can, false);
});

await ok("a Judge's throw over a refusal warns first and the card says it was thrown over one", async () => {
  reset();
  load();
  const plain = person("Birch", { adventuring: { climb: 14 } });
  const { formation } = world([plain]);
  await beginCrossing(formation, "sheerClimb");
  await applyCrossingForm(formation, { length: "40" });
  naturals.push(19);
  const out = await throwFor(formation, "Birch");
  assert.equal(out.ok, true);
  assert.deepEqual(seen.warned, ["Birch cannot attempt this"]);
  assert.ok(seen.created[0].content.includes("Thrown over a refusal: Birch cannot attempt this"));
  const clean = person("Cedar", { items: [CLIMBING()] });
  const second = world([clean]);
  seen.created.length = 0;
  await beginCrossing(second.formation, "easyClimb");
  naturals.push(19);
  await throwFor(second.formation, "Cedar");
  assert.equal(seen.created[0].content.includes("over a refusal"), false, "an ordinary throw says nothing of the kind");
});

await ok("a player's press writes nothing and rolls nothing; it is told the throw is the Judge's", async () => {
  reset();
  load();
  const holder = person("Alder", { items: [CLIMBING()], owner: PLAYER.id });
  const { formation } = world([holder]);
  await beginCrossing(formation, "easyClimb");
  seen.updates.length = 0;
  seen.told.length = 0;
  naturals.push(20);
  const out = await as(PLAYER, () => requestCrossingThrow(formation, "Alder"));
  assert.deepEqual([out.ok, out.refused], [false, "seat"]);
  assert.deepEqual(seen.told, ["Ask the Judge to make this throw."]);
  assert.equal(seen.updates.length, 0);
  assert.equal(seen.created.length, 0);
  assert.equal(naturals.length, 1, "no die was rolled");
  const direct = await as(PLAYER, () => throwFor(formation, "Alder"));
  assert.deepEqual([direct.ok, direct.refused], [false, "notGM"], "the throw itself refuses a seat that cannot write");
  const player = rowOf(as(PLAYER, () => buildCrossingView(formation)), "Alder");
  assert.equal(player.can, true, "the owner's button is drawn");
});

await ok("two members' steps in flight both land, and a setup edit beside them does not drop either", async () => {
  reset();
  load();
  const a = person("Alder", { items: [CLIMBING()] });
  const b = person("Birch");
  const { formation } = world([a, b]);
  await beginCrossing(formation, "easyClimb");
  const id = readCrossing(formation).id;
  await Promise.all([
    writeMemberStep(formation, id, "Alder", { state: "climbing", covered: 1, throws: 1, last: null }),
    writeMemberStep(formation, id, "Birch", { state: "climbing", covered: 2, throws: 2, last: null }),
    applyCrossingForm(formation, { length: "200", judgeMod: "1", ropeFixed: true }),
  ]);
  const held = readCrossing(formation);
  assert.deepEqual([held.members.Alder.covered, held.members.Birch.covered], [1, 2]);
  assert.deepEqual([held.length, held.judgeMod, held.ropeFixed], [200, 1, true]);
  assert.equal(await writeMemberStep(formation, "stale-id", "Alder", { state: "climbing", covered: 9, throws: 9, last: null }), false, "a write for another crossing lands nowhere");
  assert.equal(readCrossing(formation).members.Alder.covered, 1);
  assert.equal(await as(PLAYER, () => writeMemberStep(formation, id, "Alder", { state: "across", covered: 9, throws: 9, last: null })), false);
});

await ok("a crossing ended during a throw records nothing and posts no card", async () => {
  reset();
  load();
  const a = person("Alder", { items: [CLIMBING()] });
  const { formation } = world([a]);
  await beginCrossing(formation, "easyClimb");
  naturals.push(18);
  rollDelay = 20;
  const pending = throwFor(formation, "Alder");
  await endCrossing(formation);
  const out = await pending;
  rollDelay = 0;
  assert.deepEqual([out.ok, out.refused], [false, "stale"]);
  assert.equal(readCrossing(formation), null);
  assert.equal(seen.created.length, 0);
});

await ok("a second throw for the same member while one is in flight is refused", async () => {
  reset();
  load();
  const a = person("Alder", { items: [CLIMBING()] });
  const { formation } = world([a]);
  await beginCrossing(formation, "easyClimb");
  await applyCrossingForm(formation, { length: "400" });
  naturals.push(18, 18);
  const [one, two] = await Promise.all([throwFor(formation, "Alder"), throwFor(formation, "Alder")]);
  assert.deepEqual([one.ok, two.ok, two.refused], [true, false, "busy"]);
  assert.equal(readCrossing(formation).members.Alder.throws, 1);
});

await ok("a member removed mid-crossing is not thrown for and the stale record is dropped", async () => {
  reset();
  load();
  const a = person("Alder", { items: [CLIMBING()] });
  const b = person("Birch");
  const { formation } = world([a, b]);
  await beginCrossing(formation, "easyClimb");
  await applyCrossingForm(formation, { length: "400" });
  naturals.push(18);
  await throwFor(formation, "Birch");
  assert.ok(readCrossing(formation).members.Birch);
  formation.members = formation.members.filter((m) => m.actorId !== "Birch");
  naturals.push(18);
  const out = await throwFor(formation, "Birch");
  assert.deepEqual([out.ok, out.refused], [false, "member"]);
  assert.equal(readCrossing(formation).members.Birch, undefined, "the stale entry is gone");
  assert.equal(buildCrossingView(formation).rows.length, 1);
});

await ok("End and Begin give a fresh id and carry no member state", async () => {
  reset();
  load();
  const a = person("Alder", { items: [CLIMBING()] });
  const { formation } = world([a]);
  const first = await beginCrossing(formation, "easyClimb");
  await applyCrossingForm(formation, { length: "400" });
  naturals.push(18);
  await throwFor(formation, "Alder");
  assert.equal(await endCrossing(formation), true);
  assert.equal(await endCrossing(formation), false, "nothing to end");
  const second = await beginCrossing(formation, "easyClimb");
  assert.notEqual(first, second);
  assert.deepEqual(readCrossing(formation).members, {});
});

await ok("throw all throws for the members a row allows with no warning and leaves the rest", async () => {
  reset();
  load();
  const a = person("Alder", { items: [CLIMBING()] });
  const b = person("Birch");
  const c = person("Wolf", { type: "monster", adventuring: null });
  const { formation } = world([a, b, c]);
  await beginCrossing(formation, "easyClimb");
  await applyCrossingForm(formation, { length: "400" });
  naturals.push(18, 18);
  const out = await throwAll(formation);
  assert.deepEqual([out.thrown, out.left], [2, 1]);
  assert.equal(seen.created.length, 2, "one card per throw");
});

await ok("a jump row is canClear's answer for the member, with a blank gap showing no verdict", async () => {
  reset();
  load();
  const tumbler = person("Alder", { items: [ACROBATICS()], dex: 12 });
  const { formation } = world([tumbler]);
  await beginCrossing(formation, "jump");
  const blank = rowOf(buildCrossingView(formation), "Alder");
  assert.equal(blank.verdict, "", "no gap, no verdict");
  await applyCrossingForm(formation, { gap: "3", runUp: true });
  const { jumpRow } = await import("../scripts/formation/crossing-logic.mjs");
  const view = buildCrossingView(formation);
  const row = rowOf(view, "Alder");
  const expected = jumpRow(3, { options: { dex: 12, encumbrance: 0, acrobatics: true, level: 6, runningStart: true }, seat: { judge: true, owns: true } });
  assert.equal(row.verdict, expected.verdict);
  assert.equal(row.holdsAcrobatics, true);
  await applyCrossingForm(formation, { runUp: false });
  const noRun = jumpRow(3, { options: { dex: 12, encumbrance: 0, acrobatics: true, level: 6, runningStart: false }, seat: { judge: true, owns: true } });
  assert.equal(rowOf(buildCrossingView(formation), "Alder").verdict, noRun.verdict, "the run-up is an input");
  const out = await throwFor(formation, "Alder");
  assert.equal(out.ok, false, "a jump has no throw on this surface");
});

await ok("a setup form writes the keys it changes and unsets a blank number", async () => {
  reset();
  load();
  const a = person("Alder", { items: [CLIMBING()] });
  const { formation } = world([a]);
  await beginCrossing(formation, "easyClimb");
  seen.updates.length = 0;
  assert.equal(await applyCrossingForm(formation, { length: "", judgeMod: "0", ropeFixed: false }), false, "nothing changed, nothing written");
  assert.equal(seen.updates.length, 0);
  await applyCrossingForm(formation, { length: "80", depth: "30" });
  assert.deepEqual([readCrossing(formation).length, readCrossing(formation).depth], [80, 30]);
  await applyCrossingForm(formation, { length: "" });
  assert.equal(readCrossing(formation).length, undefined);
  assert.equal(await as(PLAYER, () => applyCrossingForm(formation, { length: "5" })), false);
  assert.equal(readCrossing(formation).members && Object.keys(readCrossing(formation)).includes("id"), true, "id and members survive every edit");
});

/* --- the partial -------------------------------------------------------------- */
const { default: Handlebars } = await import("handlebars");
const hb = Handlebars.create();
hb.registerHelper("localize", (key, options) =>
  String(key) + (options?.hash && Object.keys(options.hash).length ? JSON.stringify(options.hash) : ""));
const partial = fs.readFileSync(new URL("../templates/formation/formation-crossing.hbs", import.meta.url), "utf8");
const render = hb.compile(partial);

await ok("the partial draws a begin row for a Judge, the setup fields for a Judge only, and no literal id or summary", async () => {
  reset();
  load();
  const holder = person("Alder", { items: [CLIMBING()], owner: PLAYER.id });
  const { formation } = world([holder]);
  const begin = render({ crossing: buildCrossingView(formation) });
  assert.ok(begin.includes('data-action="crossingBegin"') && begin.includes('data-pick="crossing-kind"'));
  assert.equal(render({ crossing: as(PLAYER, () => buildCrossingView(formation)) }).trim(), "", "a player's section is absent while none is open");
  await beginCrossing(formation, "easyClimb");
  const judge = render({ crossing: buildCrossingView(formation) });
  for (const field of ["crossing.length", "crossing.depth", "crossing.ropeFixed", "crossing.judgeMod"]) assert.ok(judge.includes(`name="${field}"`), field);
  const player = render({ crossing: as(PLAYER, () => buildCrossingView(formation)) });
  assert.equal(/name="crossing\./.test(player), false, "no Judge field in a player's DOM");
  assert.ok(player.includes('data-action="crossingThrow"'), "the owner's throw is drawn");
  assert.equal(player.includes("crossingEnd") || player.includes("crossingBegin"), false);
  for (const html of [begin, judge, player]) {
    assert.equal(/\sid=/.test(html), false, "no literal id");
    assert.equal(/<summary/.test(html), false, "nothing in a summary");
    for (const glyph of html.matchAll(/<i [^>]*>/g)) assert.ok(glyph[0].includes("inert"), "a glyph is inert");
  }
});

await ok("every action the partial names has a handler, and the sheet and the form carry the crossing", async () => {
  const names = new Set([...partial.matchAll(/data-action="(\w+)"/g)].map((m) => m[1]));
  const source = fs.readFileSync(new URL("../scripts/formation/formation-actions.mjs", import.meta.url), "utf8");
  const block = source.slice(source.indexOf("export const SHARED_ACTIONS = {"));
  const handlers = new Set([...block.slice(0, block.indexOf("\n};")).matchAll(/^ {2}(?:async )?(\w+)\(/gm)].map((m) => m[1]));
  assert.ok(names.size >= 4);
  for (const name of names) assert.ok(handlers.has(name), `${name} has a handler`);
  assert.ok(/crossing\.\w+|data\.crossing/.test(source), "onChangeForm routes crossing.*");
  const sheet = fs.readFileSync(new URL("../scripts/formation/party-actor.mjs", import.meta.url), "utf8");
  assert.ok(sheet.includes("formation-crossing.hbs"), "the partial is a template of the mode part");
  assert.ok(/new PressFocus\(\)/.test(sheet) && /#press\.note\(/.test(sheet) && /#press\.restore\(/.test(sheet), "PressFocus is wired by hand");
  const views = fs.readFileSync(new URL("../scripts/formation/formation-view.mjs", import.meta.url), "utf8");
  assert.ok(/view\.crossing = /.test(views), "the Dungeon tab's context carries the crossing");
});

console.log(`\n${passed} passed`);
