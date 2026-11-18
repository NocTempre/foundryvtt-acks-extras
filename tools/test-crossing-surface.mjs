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
 * and a player's own client writes nothing; a player's relayed throw is
 * checked again on the GM client (ownership, the crossing's id, the member's
 * row read for a player, one throw in flight per member), declared publicly
 * and carded to the Judges, and a refusal is whispered to the requester alone;
 * two writes in flight both land; a card says it was thrown over a refusal,
 * prints the imported words escaped, and reports a fall without touching hit
 * points.
 *
 * The jump attempt: the distance's die is rolled at the press, the footing
 * follows from the distance, the gap, the landing save (core's own) and the
 * shortfall die, a jumper hanging at the edge climbs up on the climb rows'
 * logic, a player's press is relayed and declared, and an absence rolls nothing.
 *
 * The held conditions: a member on an obstacle whose imported grid row says
 * Vulnerable carries one marked effect and a chip, on every seat and for a
 * relayed throw; across, fell, End, a dropped member and a new Begin take it
 * off; a same-status effect from elsewhere is never touched; nothing imported
 * holds nothing.
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

const GM = { id: "gm1", name: "Judge", isGM: true };
const PLAYER = { id: "pl1", name: "Pat", isGM: false };
const OTHER = { id: "pl2", name: "Quinn", isGM: false };

const seen = { created: [], warned: [], told: [], updates: [], saves: [] };
/** What a stand-in `rollSave` returns: a roll with a total, or nothing for a dialog that was cancelled. */
let saveResult = { total: 11 };
const naturals = [];
let rollDelay = 0;
let serial = 0;
/** The formations setting, by id; `world` stores each formation here so the relay's handler can read it. */
const formations = {};

const users = Object.assign([GM, PLAYER, OTHER], { get: (id) => [GM, PLAYER, OTHER].find((u) => u.id === id), activeGM: GM });
globalThis.game = {
  user: GM,
  users,
  i18n: { localize: (k) => (typeof lookup(k) === "string" ? lookup(k) : k), format, has: (k) => typeof lookup(k) === "string" },
  settings: { get: (_scope, key) => (key === "formations" ? formations : key === "skip-dialog-key" ? "shiftKey" : {}) },
  actors: Object.assign(new Map(), { [Symbol.iterator]() { return this.values(); } }), // iterates its documents, as core's collection does
  scenes: new Map(),
  items: [],
};
globalThis.ui = { notifications: { info: (m) => seen.told.push(m), warn: (m) => seen.warned.push(m), error() {} } };
/** `socketlib.ready` callbacks, held until the stand-in socketlib below fires them. */
const socketReady = [];
globalThis.Hooks = {
  on() {},
  once: (name, fn) => { if (name === "socketlib.ready") socketReady.push(fn); },
  off() {}, call() {}, callAll() {},
};
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
  CROSSING_KINDS, applyCrossingForm, beginCrossing, buildCrossingView, canCross, endCrossing, jumpFor, landFor, pruneMembers, readCrossing, reportLanding,
  throwAll, throwFor, writeMemberStep,
} = crossing;
const { registerRequestSocket, requestCrossingThrow, requestPartyAction } =await import("../scripts/formation/player-requests.mjs");

/**
 * socketlib's stand-in. `relay` delivers a request to the registered handler as the GM
 * client receives it: `this.socketdata.userId` is the sender the server stamped, and
 * `game.user` stays the GM, so overlapping relays do not disturb one another. `executeAsGM`
 * is the player client's route and swaps `game.user` for the one call it makes.
 */
const registered = {};
globalThis.socketlib = {
  registerModule: () => ({
    register: (name, fn) => { registered[name] = fn; },
    executeAsGM: async (name, payload) => {
      const declaring = game.user;
      game.user = GM;
      try {
        return await registered[name].call({ socketdata: { userId: declaring.id } }, payload);
      } finally {
        game.user = declaring;
      }
    },
  }),
};
registerRequestSocket();
for (const fn of socketReady) fn();
const relay = (user, formation, type, payload) =>
  registered.partyRequest.call({ socketdata: { userId: user.id } }, { formationId: formation.id, type, payload });

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
function person(name, { items = [], adventuring = { climb: 14 }, hp = 8, level = 6, dex = 14, owner = null, type = "character", saves = { paralysis: { value: 12 } }, stone = 0 } = {}) {
  const actor = {
    id: name, name, type, img: `${name}.webp`, statuses: new Set(), appliedEffects: [],
    system: {
      details: { level, morale: 0 }, adventuring: adventuring ? { ...adventuring } : undefined, hp: { value: hp, max: 10 },
      encumbrance: { value: stone }, scores: { dex: { value: dex, mod: 0 } }, saves, attack: { throw: 10 }, surprise: {}, initiative: {},
    },
    getFlag: () => undefined,
    testUserPermission: (user) => !!user?.isGM || user?.id === owner,
    isOwner: false,
    async rollSave(key, options) { seen.saves.push([name, key, options]); return saveResult; },
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
  const formation = { id: "f1", name: "Party", actorId: actor.id, members: actors.map((a) => ({ actorId: a.id })) };
  formations[formation.id] = formation;
  return { actor, formation };
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
/** `as` for an async call: the seat stays in place until the call has settled. */
const asAsync = async (user, fn) => {
  const was = game.user;
  game.user = user;
  try { return await fn(); } finally { game.user = was; }
};
const reset = () => {
  seen.created.length = 0;
  seen.warned.length = 0;
  seen.told.length = 0;
  seen.updates.length = 0;
  seen.saves.length = 0;
  saveResult = { total: 11 };
  naturals.length = 0;
  for (const id of Object.keys(formations)) delete formations[id];
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

await ok("a holder's Permitted cell is a word at an obstacle the table refuses, and with the table not imported", async () => {
  reset();
  load();
  const holder = person("Alder", { items: [CLIMBING()], owner: PLAYER.id });
  const plain = person("Birch", { adventuring: { climb: 14 } });
  const { formation } = world([holder, plain]);
  await beginCrossing(formation, "sheerClimb");
  await applyCrossingForm(formation, { length: "40" });
  const view = buildCrossingView(formation);
  assert.equal(rowOf(view, "Birch").permitted, "No", "the table refuses a member who holds nothing");
  const h = rowOf(view, "Alder");
  assert.equal(h.permitted, "May try", "the same table does not refuse a holder");
  assert.equal(h.can, true, "the row lets the holder throw, as the word says");
  reset();
  const bare = person("Alder", { items: [CLIMBING()] });
  const second = world([bare]);
  await beginCrossing(second.formation, "sheerClimb");
  const none = rowOf(buildCrossingView(second.formation), "Alder");
  assert.equal(none.permitted, "May try", "a holder's permission does not wait on the table");
  assert.ok(none.permittedTip.endsWith("RR ch. 6, Spelunking"), "the page reference alone stands in for the import");
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
  assert.equal(h.permitted, "May try", "a holder may try whatever the Adventuring column says, so the cell is never blank");
  assert.equal(h.can, true, "and the word agrees with the row that lets them throw");
  assert.ok(h.permittedTip.includes("Climbing") && h.permittedTip.endsWith("XX p.1"), "the tip names the proficiency and the page");
  assert.equal(p.holds, false);
  assert.ok(h.targetTip.includes("Probe Climb"), "the skill is named");
  assert.ok(p.targetTip.includes("Adventuring"), "the stored route is named");
  assert.ok(h.targetTip.includes("+2 Judge modifier"), "the modifier is a part of the figure");
  assert.equal(h.covered, "0 / 3", "100 feet is three stretches of 40");
  assert.ok(h.coveredTip.includes("3 stretches of 40") && h.coveredTip.includes("XX p.1"));
  assert.equal(h.can, true);
});

await ok("a target's tooltip lists the figure's base and its parts with their pages, not the source alone", async () => {
  reset();
  load();
  // A held ladder and a stored figure with no bonus of any kind: `resolveCheck` itemizes only what
  // moved the target, so its `parts` is empty and the tooltip once read the source alone.
  const holder = person("Alder", { items: [CLIMBING()] });
  const plain = person("Birch", { adventuring: { climb: 14 } });
  const { formation } = world([holder, plain]);
  await beginCrossing(formation, "easyClimb");
  await applyCrossingForm(formation, { length: "100" });
  const view = buildCrossingView(formation);
  const h = rowOf(view, "Alder");
  const p = rowOf(view, "Birch");
  assert.deepEqual([h.target, p.target], ["12+", "14+"]);
  assert.notEqual(h.targetTip, "Probe Climb (L6)", "the source is not the whole tooltip");
  assert.ok(h.targetTip.includes("Probe Climb (L6), base 12+"), "the ladder's rung at the member's level is the base part");
  assert.ok(p.targetTip.includes("base 14+"), "the stored figure is the base part");
  assert.ok(h.targetTip.endsWith("RR ch. 6, Spelunking") && p.targetTip.endsWith("RR ch. 6, Spelunking"), "no part names a page, so the procedure's page ends it");

  // A figure shaped as `resolveCheck` returns it, with a cited part, an uncited one and a penalty.
  const figure = {
    target: 9, source: "Probe Climb (L6)", skilled: true,
    parts: [{ label: "Probe Boots", value: 2, cite: "XX p.7" }, { label: "Probe Score", value: 1 }, { label: "Conditions", value: -1 }],
  };
  assert.equal(
    crossing.targetTooltip(figure, 1),
    "Probe Climb (L6), base 11+; +2 Probe Boots (XX p.7), +1 Probe Score, −1 Conditions, +1 Judge modifier",
    "the base is the target and every part it was lowered by, each cited part carrying its page, then the Judge's modifier",
  );
  assert.ok(!crossing.targetTooltip(figure, 1).endsWith("Spelunking"), "a part's page stands in for the procedure's");
  assert.equal(crossing.targetTooltip({ target: 12, source: "Via Adventuring", parts: [] }, 0), "Via Adventuring, base 12+ · RR ch. 6, Spelunking");
  assert.equal(crossing.targetTooltip(null, 2), "RR ch. 6, Spelunking", "no figure, the page alone");
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

/** The chat messages a relayed throw left, sorted by who could read them. */
const posted = () => ({
  declarations: seen.created.filter((m) => !m.whisper && m.content.includes("declares")),
  cards: seen.created.filter((m) => m.whisper?.[0] === GM.id),
  whispers: seen.created.filter((m) => m.whisper && m.whisper[0] !== GM.id),
});

await ok("a player's own client writes, rolls and posts nothing: the press is relayed, and a throw itself refuses that seat", async () => {
  reset();
  load();
  const holder = person("Alder", { items: [CLIMBING()], owner: PLAYER.id });
  const { formation } = world([holder]);
  await beginCrossing(formation, "easyClimb");
  const direct = await as(PLAYER, () => throwFor(formation, "Alder"));
  assert.deepEqual([direct.ok, direct.refused], [false, "notGM"], "the throw itself refuses a seat that cannot write");
  const player = rowOf(as(PLAYER, () => buildCrossingView(formation)), "Alder");
  assert.equal(player.can, true, "the owner's button is drawn");
  assert.equal(as(PLAYER, () => canCross(formation)), true, "and the panel offers a crossing throw");
  assert.equal(as(OTHER, () => canCross(formation)), false, "a seat that owns no member is offered none");
  assert.equal(canCross(formation), true, "the Judge's seat reads its own rows");
  seen.updates.length = 0;
  naturals.push(20);
  const refusedLocally = await asAsync(PLAYER, () => requestCrossingThrow(formation, "Nobody"));
  assert.deepEqual([refusedLocally.ok, refusedLocally.refused], [false, "member"]);
  assert.equal(seen.updates.length, 0);
  assert.equal(seen.created.length, 0);
  assert.equal(naturals.length, 1, "no die was rolled");
});

await ok("a player's press for an owned member lands: a public declaration, one card to the Judges, one record", async () => {
  reset();
  load();
  const holder = person("Alder", { items: [CLIMBING()], owner: PLAYER.id });
  const { formation } = world([holder]);
  await beginCrossing(formation, "sheerClimb");
  await applyCrossingForm(formation, { length: "40" });
  naturals.push(17);
  const out = await asAsync(PLAYER, () => requestCrossingThrow(formation, "Alder"));
  assert.deepEqual(out, { ok: true });
  assert.deepEqual(seen.told, ["Declared — sent to the Judge."], "the seat is told its request went");
  const { declarations, cards, whispers } = posted();
  assert.equal(declarations.length, 1);
  assert.ok(declarations[0].content.includes("Pat declares: Alder throws to cross."), "public, in the requester's name");
  assert.equal(cards.length, 1);
  assert.ok(cards[0].content.includes("acks-extras-roll-card"), "the throw's card goes to the Judges alone");
  assert.equal(whispers.length, 0);
  assert.ok(seen.created.indexOf(declarations[0]) < seen.created.indexOf(cards[0]), "declared before the card");
  const record = readCrossing(formation).members.Alder;
  assert.deepEqual([record.state, record.throws, record.covered], ["across", 1, 1]);
  assert.equal(holder.system.hp.value, 8, "hit points are untouched");
});

await ok("a request the GM client refuses is not announced to its seat as declared; one it takes still is", async () => {
  reset();
  load();
  const holder = person("Alder", { items: [CLIMBING()], owner: PLAYER.id });
  const { formation } = world([holder]);
  const old = await beginCrossing(formation, "easyClimb");
  await applyCrossingForm(formation, { length: "400" });
  naturals.push(18, 18);
  // A stale crossing id: refused on the GM client, answered to the seat, whispered.
  const stale = await asAsync(PLAYER, () => requestPartyAction(formation.id, "crossing", { crossingId: "not-this-one", actorId: "Alder" }));
  assert.deepEqual(stale, { ok: false, refused: "stale" });
  assert.deepEqual(seen.told, [], "no Declared toast for a refused request");
  assert.equal(posted().whispers.length, 1, "the refusal is still whispered to the seat");
  // The seat's own press, ended by the Judge between the seat's read and the GM client's.
  const real = registered.partyRequest;
  registered.partyRequest = async function wrapped(...args) {
    await endCrossing(formation);
    return real.apply(this, args);
  };
  const raced = await asAsync(PLAYER, () => requestCrossingThrow(formation, "Alder"));
  registered.partyRequest = real;
  assert.deepEqual(raced, { ok: false, refused: "closed" }, "the seat's press reports the GM client's refusal");
  assert.deepEqual(seen.told, [], "and no toast says it was declared");
  assert.equal(naturals.length, 2, "no die was rolled");
  // A request the GM client takes still toasts.
  await beginCrossing(formation, "easyClimb");
  await applyCrossingForm(formation, { length: "400" });
  const taken = await asAsync(PLAYER, () => requestCrossingThrow(formation, "Alder"));
  assert.deepEqual(taken, { ok: true });
  assert.deepEqual(seen.told, ["Declared — sent to the Judge."]);
  assert.notEqual(readCrossing(formation).id, old);
});

await ok("a non-owner is refused with a whisper and nothing is rolled, declared or written", async () => {
  reset();
  load();
  const holder = person("Alder", { items: [CLIMBING()], owner: PLAYER.id });
  const mine = person("Birch", { owner: OTHER.id });
  const { formation } = world([holder, mine]);
  await beginCrossing(formation, "easyClimb");
  await applyCrossingForm(formation, { length: "400" });
  const id = readCrossing(formation).id;
  naturals.push(18, 18, 18);
  await relay(OTHER, formation, "crossing", { crossingId: id, actorId: "Alder" });
  let { declarations, cards, whispers } = posted();
  assert.deepEqual([declarations.length, cards.length, whispers.length], [0, 0, 1]);
  assert.deepEqual(whispers[0].whisper, [OTHER.id], "told to the requester alone");
  assert.equal(whispers[0].content, "Alder is not yours to throw for.");
  assert.equal(naturals.length, 3, "no die was rolled");
  assert.deepEqual(readCrossing(formation).members, {}, "no record");
  // A payload naming no member must not pass on the strength of owning some other one.
  await relay(OTHER, formation, "crossing", { crossingId: id });
  ({ declarations, cards, whispers } = posted());
  assert.deepEqual([declarations.length, cards.length, whispers.length], [0, 0, 2]);
  assert.equal(naturals.length, 3);
  assert.deepEqual(readCrossing(formation).members, {});
  // The same request from the owner lands.
  await relay(PLAYER, formation, "crossing", { crossingId: id, actorId: "Alder" });
  ({ declarations, cards } = posted());
  assert.deepEqual([declarations.length, cards.length], [1, 1]);
  assert.equal(readCrossing(formation).members.Alder.throws, 1);
});

await ok("an owner is blocked where the grid refuses the member, a Judge only warned: a whisper, no roll, no declaration", async () => {
  reset();
  load();
  const plain = person("Birch", { owner: PLAYER.id, adventuring: { climb: 14 } });
  const { formation } = world([plain]);
  await beginCrossing(formation, "sheerClimb");
  await applyCrossingForm(formation, { length: "40" });
  const id = readCrossing(formation).id;
  naturals.push(19);
  const blockedLocally = await asAsync(PLAYER, () => requestCrossingThrow(formation, "Birch"));
  assert.deepEqual([blockedLocally.ok, blockedLocally.refused], [false, "notPermitted"], "the seat's own press is stopped first");
  assert.deepEqual(seen.warned, ["Birch cannot attempt this"]);
  assert.equal(seen.created.length, 0);
  await relay(PLAYER, formation, "crossing", { crossingId: id, actorId: "Birch" });
  const { declarations, cards, whispers } = posted();
  assert.deepEqual([declarations.length, cards.length, whispers.length], [0, 0, 1], "a hand-made request meets the GM client's own check");
  assert.equal(whispers[0].content, "Birch cannot attempt this");
  assert.equal(naturals.length, 1, "no die was rolled");
  assert.deepEqual(readCrossing(formation).members, {});
  const judge = await throwFor(formation, "Birch");
  assert.equal(judge.ok, true, "the Judge's own throw proceeds over the same refusal");
});

await ok("a request for another crossing, for none, or for a settled member is refused with its words", async () => {
  reset();
  load();
  const holder = person("Alder", { items: [CLIMBING()], owner: PLAYER.id });
  const { formation } = world([holder]);
  const old = await beginCrossing(formation, "easyClimb");
  await applyCrossingForm(formation, { length: "40" });
  await endCrossing(formation);
  naturals.push(18, 18, 18, 18);
  await relay(PLAYER, formation, "crossing", { crossingId: old, actorId: "Alder" });
  assert.equal(posted().whispers.at(-1).content, "No crossing is open.", "none open");
  const current = await beginCrossing(formation, "easyClimb");
  await applyCrossingForm(formation, { length: "400" });
  assert.notEqual(current, old);
  await relay(PLAYER, formation, "crossing", { crossingId: old, actorId: "Alder" });
  assert.equal(posted().whispers.at(-1).content, "The crossing changed during the throw; nothing was recorded.", "another crossing's id");
  await relay(PLAYER, formation, "crossing", { actorId: "Alder" });
  assert.equal(posted().whispers.length, 3, "no id at all");
  assert.equal(naturals.length, 4, "no die was rolled for any of them");
  assert.deepEqual([posted().declarations.length, posted().cards.length], [0, 0]);
  assert.deepEqual(readCrossing(formation).members, {});
  await applyCrossingForm(formation, { length: "40" });
  naturals.length = 0;
  naturals.push(18);
  await relay(PLAYER, formation, "crossing", { crossingId: current, actorId: "Alder" });
  assert.equal(readCrossing(formation).members.Alder.state, "across");
  await relay(PLAYER, formation, "crossing", { crossingId: current, actorId: "Alder" });
  assert.equal(posted().whispers.at(-1).content, "Alder has nothing left to throw.", "a member who is across");
  assert.equal(posted().cards.length, 1);
});

await ok("two interleaved requests for two members both land; two for one member land once and the second is told it is busy", async () => {
  reset();
  load();
  const a = person("Alder", { items: [CLIMBING()], owner: PLAYER.id });
  const b = person("Birch", { owner: PLAYER.id });
  const { formation, actor } = world([a, b]);
  await beginCrossing(formation, "easyClimb");
  await applyCrossingForm(formation, { length: "400" });
  const id = readCrossing(formation).id;
  rollDelay = 20;
  try {
    naturals.push(18, 18);
    await Promise.all([
      relay(PLAYER, formation, "crossing", { crossingId: id, actorId: "Alder" }),
      relay(PLAYER, formation, "crossing", { crossingId: id, actorId: "Birch" }),
    ]);
    const first = posted();
    assert.deepEqual([first.declarations.length, first.cards.length, first.whispers.length], [2, 2, 0]);
    const held = actor.store.flags["acks-extras"].crossing.members;
    assert.deepEqual([held.Alder.throws, held.Birch.throws], [1, 1], "both steps are on the party actor");
    seen.created.length = 0;
    naturals.length = 0;
    naturals.push(18, 18);
    await Promise.all([
      relay(PLAYER, formation, "crossing", { crossingId: id, actorId: "Alder" }),
      relay(PLAYER, formation, "crossing", { crossingId: id, actorId: "Alder" }),
    ]);
  } finally {
    rollDelay = 0;
  }
  const second = posted();
  assert.deepEqual([second.declarations.length, second.cards.length, second.whispers.length], [1, 1, 1], "one declared, one card, one refusal");
  assert.equal(second.whispers[0].content, "That throw is still being made.");
  assert.equal(naturals.length, 1, "one die");
  assert.equal(readCrossing(formation).members.Alder.throws, 2, "one step landed, not two");
  assert.equal(readCrossing(formation).members.Birch.throws, 1);
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

await ok("each member's row equals canClear on their own score, level, load and Acrobatics, and the run-up reaches it", async () => {
  reset();
  load({ jumping: { ...JUMPING, acrobaticsDexCap: 16, extendedDexBands: [{ min: 3, max: 18, mod: 1 }] } });
  const plain = person("Alder", { dex: 12, level: 6 });
  const laden = person("Birch", { dex: 15, level: 3, stone: 3 });
  const tumbler = person("Cedar", { dex: 12, level: 6, items: [ACROBATICS()] });
  const { formation } = world([plain, laden, tumbler]);
  await beginCrossing(formation, "jump");
  const { canClear } = await import("../scripts/formation/jumping.mjs");
  const own = {
    Alder: { dex: 12, encumbrance: 0, acrobatics: false, level: 6 },
    Birch: { dex: 15, encumbrance: 3, acrobatics: false, level: 3 },
    Cedar: { dex: 12, encumbrance: 0, acrobatics: true, level: 6 },
  };
  const verdicts = new Set();
  for (const gap of [5, 8, 12, 15, 19, 25]) {
    for (const runUp of [true, false]) {
      await applyCrossingForm(formation, { gap: String(gap), runUp });
      for (const [name, options] of Object.entries(own)) {
        const expected = canClear(gap, { ...options, runningStart: runUp });
        const row = rowOf(buildCrossingView(formation), name);
        assert.equal(row.verdict, expected.verdict, `${name} gap ${gap} run-up ${runUp}`);
        assert.equal(row.range, `${expected.min}–${expected.max}`, `${name} range, gap ${gap} run-up ${runUp}`);
        if (expected.clearing) assert.ok(row.verdictTip.includes(`${expected.clearing} of ${expected.faces} faces clear`), "the faces that clear are in the tooltip");
        verdicts.add(expected.verdict);
      }
    }
  }
  assert.deepEqual([...verdicts].sort(), ["certain", "chance", "impossible"], "the gaps cover every verdict");
  const view = buildCrossingView(formation);
  const ranges = ["Alder", "Birch", "Cedar"].map((name) => rowOf(view, name).range);
  assert.equal(new Set(ranges).size, 3, "the members' own figures give three different ranges");
  await applyCrossingForm(formation, { gap: "8", runUp: true });
  assert.equal(rowOf(buildCrossingView(formation), "Alder").verdict, "certain");
  await applyCrossingForm(formation, { runUp: false });
  assert.equal(rowOf(buildCrossingView(formation), "Alder").verdict, "chance", "the same gap, the standing jump");
});

await ok("a precarious or charging setup offers a Judge the landing save and a plain one does not; a player reads it with no press", async () => {
  reset();
  load();
  const a = person("Alder", { dex: 12, owner: PLAYER.id });
  const { formation } = world([a]);
  await beginCrossing(formation, "jump");
  await applyCrossingForm(formation, { gap: "15" });
  assert.equal(rowOf(buildCrossingView(formation), "Alder").landing, null, "a plain landing asks for none");
  await applyCrossingForm(formation, { precarious: true });
  const judge = rowOf(buildCrossingView(formation), "Alder").landing;
  assert.deepEqual([judge.canRoll, judge.canReport, judge.warn], [true, true, false]);
  assert.deepEqual(judge.footings.map((f) => f.value), ["solid", "edge", "empty"]);
  assert.ok(judge.tip.endsWith("XX p.3"), "the save's working names the imported page");
  await applyCrossingForm(formation, { precarious: false, charging: true });
  assert.equal(rowOf(buildCrossingView(formation), "Alder").landing.canRoll, true, "charging asks for it too");
  const player = rowOf(as(PLAYER, () => buildCrossingView(formation)), "Alder").landing;
  assert.deepEqual([player.canRoll, player.canReport], [false, false], "a player has no press");
  assert.ok(player.label && player.tip);
});

await ok("the landing save is core's own rollSave on the member, from the Judge's press, with the press's event", async () => {
  reset();
  load();
  const a = person("Alder", { dex: 12, owner: PLAYER.id });
  const { formation } = world([a]);
  await beginCrossing(formation, "jump");
  await applyCrossingForm(formation, { gap: "15" });
  assert.deepEqual(await landFor(formation, "Alder"), { ok: false, refused: "noSave" }, "a plain landing rolls nothing");
  await applyCrossingForm(formation, { precarious: true });
  const event = { shiftKey: true };
  const out = await landFor(formation, "Alder", { event });
  assert.equal(out.ok, true);
  assert.equal(out.total, 11);
  assert.deepEqual(seen.saves, [["Alder", "paralysis", { event }]], "the system's roll, on the member, against the landing's save");
  assert.equal(seen.created.length, 1, "one card, to the Judges");
  assert.deepEqual(seen.created[0].whisper, [GM.id]);
  assert.equal(Object.keys(readCrossing(formation).members).length, 0, "nothing is written to the flag");
  saveResult = undefined;
  assert.deepEqual(await landFor(formation, "Alder"), { ok: false, refused: "cancelled" }, "a dialog dismissed posts no card");
  assert.equal(seen.created.length, 1);
  assert.deepEqual(await asAsync(PLAYER, () => landFor(formation, "Alder")), { ok: false, refused: "notGM" }, "a player's client rolls nothing");
  assert.equal(seen.saves.length, 2);
});

await ok("an unreachable gap warns a Judge and still rolls; a player is blocked; an unknown jump stops the Judge", async () => {
  reset();
  load();
  const a = person("Alder", { dex: 12, owner: PLAYER.id });
  const { formation } = world([a]);
  await beginCrossing(formation, "jump");
  await applyCrossingForm(formation, { gap: "90", precarious: true });
  const judge = rowOf(buildCrossingView(formation), "Alder");
  assert.deepEqual([judge.warn, judge.landing.warn, judge.landing.canRoll], [true, true, true]);
  assert.equal(judge.landing.rollLabel, "Roll anyway");
  assert.equal(judge.verdict, "impossible");
  const out = await landFor(formation, "Alder");
  assert.equal(out.ok, true);
  assert.equal(seen.warned.length, 1, "the Judge is warned");
  assert.equal(seen.created.length, 1, "and the card is posted");
  const player = rowOf(as(PLAYER, () => buildCrossingView(formation)), "Alder");
  assert.equal(player.blocked, true, "a player is blocked, with words");
  assert.equal(player.landing.canRoll, false);
  seen.created.length = 0;
  seen.saves.length = 0;
  load({ jumping: null });
  const unknown = rowOf(buildCrossingView(formation), "Alder");
  assert.deepEqual([unknown.landing.canRoll, unknown.blocked], [false, false], "an unknown jump stops the Judge, with no words");
  assert.deepEqual(await landFor(formation, "Alder"), { ok: false, refused: "absence" });
  assert.equal(seen.saves.length, 0, "and nothing is rolled");
});

await ok("the footing the Judge picks reaches landingFailure on a card to the Judges, and nothing is applied", async () => {
  reset();
  load({ jumping: { ...JUMPING, shortfallDie: "1d3" } });
  const a = person("Alder", { dex: 12 });
  const { formation } = world([a]);
  await beginCrossing(formation, "jump");
  await applyCrossingForm(formation, { gap: "15", precarious: true, depth: "30" });
  seen.updates.length = 0;
  const empty = await reportLanding(formation, "Alder", "empty");
  assert.deepEqual(empty.outcome, { footing: "empty", outcome: "fall", shortBy: "1d3", damage: "2d8", feet: 30, unknown: [] });
  assert.deepEqual(empty.message.whisper, [GM.id]);
  const solid = await reportLanding(formation, "Alder", "solid");
  assert.deepEqual([solid.outcome.outcome, solid.outcome.damage, solid.outcome.feet], ["prone", null, null]);
  assert.equal((await reportLanding(formation, "Alder", "lava")).refused, "footing");
  assert.equal((await reportLanding(formation, "Alder", undefined)).refused, "footing");
  assert.equal(seen.updates.length, 0, "no flag, no hit point and no condition is written");
  assert.equal((await asAsync(PLAYER, () => reportLanding(formation, "Alder", "solid"))).refused, "notGM");
  assert.equal((await reportLanding(formation, "Nobody", "solid")).refused, "member");
  await endCrossing(formation);
  assert.equal((await reportLanding(formation, "Alder", "solid")).refused, "closed");
});

await ok("a member with no save recorded is refused and nothing is rolled", async () => {
  reset();
  load();
  const wolf = person("Wolf", { type: "monster", adventuring: null, saves: {} });
  const { formation } = world([wolf]);
  await beginCrossing(formation, "jump");
  await applyCrossingForm(formation, { gap: "15", charging: true });
  assert.deepEqual(await landFor(formation, "Wolf"), { ok: false, refused: "noCell" });
  assert.equal(seen.saves.length, 0);
  assert.equal(seen.created.length, 0);
});

await ok("a landing needs a jump: an obstacle crossing refuses both presses", async () => {
  reset();
  load();
  const a = person("Alder", { dex: 12 });
  const { formation } = world([a]);
  await beginCrossing(formation, "easyClimb");
  assert.equal((await landFor(formation, "Alder")).refused, "notJump");
  assert.equal((await reportLanding(formation, "Alder", "solid")).refused, "notJump");
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
  assert.ok(/canCross:[^\n]*canCross\(formation\)/.test(views), "the player panel carries canCross, from the crossing's own rows");
  const requests = fs.readFileSync(new URL("../scripts/formation/player-requests.mjs", import.meta.url), "utf8");
  assert.ok(/case "crossing":/.test(requests) && /userOwnsMember\(formation, user, actorId\)/.test(requests), "the relay's case checks ownership");
});

await ok("the partial's player rows draw the throw for an owner and the reason as text where it is blocked", async () => {
  reset();
  load();
  const holder = person("Alder", { items: [CLIMBING()], owner: PLAYER.id });
  const plain = person("Birch", { owner: PLAYER.id, adventuring: { climb: 14 } });
  const other = person("Cedar", { items: [CLIMBING()], owner: OTHER.id });
  const { formation } = world([holder, plain, other]);
  await beginCrossing(formation, "sheerClimb");
  await applyCrossingForm(formation, { length: "40" });
  const html = render({ crossing: as(PLAYER, () => buildCrossingView(formation)) });
  const row = (name) => html.split("<li").find((li) => li.includes(`>${name}`)) ?? "";
  assert.ok(row("Alder").includes('data-action="crossingThrow"') && row("Alder").includes('data-actor-id="Alder"'), "an owned member the grid allows");
  assert.equal(row("Birch").includes('data-action="crossingThrow"'), false, "an owned member the grid refuses has no button");
  assert.ok(row("Birch").includes("Birch cannot attempt this") && row("Birch").includes("acks-extras-crossing-block"), "and the reason as visible text");
  assert.equal(row("Cedar").includes('data-action="crossingThrow"'), false, "another seat's member has none");
  assert.equal(row("Cedar").includes("cannot attempt"), false, "and no words about what this seat can do nothing about");
});

/* --- the jump attempt and the climb up ----------------------------------------- */
const J3 = { ...JUMPING, shortfallDie: "1d3" };
/** A jump crossing over a 15 ft gap, 30 ft deep, with the member's attempt left to press. */
async function gapWorld({ landing = {}, ...options } = {}) {
  reset();
  load({ jumping: J3 });
  const alder = person("Alder", { dex: 12, owner: PLAYER.id, ...options });
  const { formation, actor } = world([alder]);
  await beginCrossing(formation, "jump");
  await applyCrossingForm(formation, { gap: "15", depth: "30", ...landing });
  return { alder, formation, actor };
}
const recordOf = (formation, name = "Alder") => readCrossing(formation).members[name];

await ok("an attempt rolls the distance's die against the gap and a reach needs nothing more: across, one card, the feet kept", async () => {
  const { formation, alder } = await gapWorld();
  const before = rowOf(buildCrossingView(formation), "Alder");
  assert.equal(before.verdict, "chance", "the verdict is shown first");
  assert.equal(before.attempt.can, true);
  naturals.push(6);
  const out = await jumpFor(formation, "Alder");
  assert.deepEqual([out.ok, out.step], [true, "across"], "12 and the face 6 is 18 feet, past 15");
  const record = recordOf(formation);
  assert.deepEqual([record.state, record.throws, record.jump.face, record.jump.distance, record.jump.gap, record.jump.clears], ["across", 1, 6, 18, 15, true]);
  assert.equal(record.jump.save, null, "a plain landing asks for no save");
  assert.equal(seen.saves.length, 0);
  assert.equal(seen.created.length, 1);
  assert.deepEqual(seen.created[0].whisper, [GM.id], "the card goes to the Judges alone");
  assert.ok(seen.created[0].content.includes("acks-extras-roll-card") && seen.created[0].content.includes("Jump"));
  const cells = [...seen.created[0].content.matchAll(/<td class="acks-nums"([^>]*)>([^<]*)<\/td>/g)].map(([, attrs, text]) => ({ text, tip: /data-tooltip-text="([^"]*)"/.exec(attrs)?.[1] ?? "" }));
  const distanceCell = cells.find((c) => c.text === "18");
  const gapCell = cells.find((c) => c.text.startsWith("15"));
  assert.ok(distanceCell.tip.includes("Rolled 6") && distanceCell.tip.endsWith("XX p.3"), "the rolled distance carries the die's face, its parts and the page");
  assert.ok(gapCell.tip.includes("Set by the Judge") && gapCell.tip.endsWith("XX p.3"), "the gap carries what is the gap's");
  assert.equal(gapCell.tip.includes("Rolled"), false, "and none of the distance's working");
  assert.equal(alder.system.hp.value, 8, "hit points are untouched");
  assert.equal(seen.updates.filter(([who]) => who === "member").length, 0, "no member document is written");
  const after = rowOf(buildCrossingView(formation), "Alder");
  assert.equal(after.verdict, "chance", "the verdict stands beside the result");
  assert.deepEqual([after.result.rolled, after.result.clearsLabel, after.stateLabel, after.attempt.can], ["Rolled 18 ft", "clears", "Across", false]);
  assert.ok(after.result.rolledTip.includes("Rolled 6") && after.result.rolledTip.endsWith("XX p.3"), "the working and the imported page");
  assert.equal(after.result.save, null);
  assert.equal(after.result.footing, null);
  assert.deepEqual((await jumpFor(formation, "Alder")).refused, "across", "a jumper who is across has nothing left to jump");
  assert.equal(naturals.length, 0);
});

await ok("a die that falls short is over empty space: the fall is the setup's depth with the imported dice, and a blank depth is unknown", async () => {
  const { formation } = await gapWorld();
  naturals.push(1);
  const out = await jumpFor(formation, "Alder");
  assert.deepEqual([out.ok, out.step], [true, "fell"], "13 feet against 15");
  assert.equal(recordOf(formation).state, "fell");
  const row = rowOf(buildCrossingView(formation), "Alder");
  assert.deepEqual([row.result.rolled, row.result.clearsLabel, row.stateLabel], ["Rolled 13 ft", "short", "Fell"]);
  assert.deepEqual([row.result.footing.text, row.result.footing.footing, row.result.footing.outcome], ["Short of the far side by 2 ft", "Empty space", "Falls"]);
  assert.equal(row.result.footing.fall.text, "Fell 30 ft, 2d8");
  assert.ok(row.result.footing.fall.tip.endsWith("XX p.2"), "the fall names its imported page");
  assert.ok(seen.created[0].content.includes("Fall: 30 ft, 2d8. Hit points unchanged."));
  assert.equal(seen.saves.length, 0, "a jump that does not reach asks for no save");
  assert.equal(seen.updates.filter(([, data]) => Object.keys(data).some((k) => k.includes("hp"))).length, 0, "no hit point is written");
  await applyCrossingForm(formation, { depth: "" });
  assert.equal(rowOf(buildCrossingView(formation), "Alder").result.footing.fall.text, "Fell, depth not set");
});

await ok("a landing save is core's own, from the Judge's press; a save made lands the jump and rolls no slip", async () => {
  const { formation } = await gapWorld({ landing: { precarious: true } });
  saveResult = { total: 12 };
  naturals.push(6, 3);
  const event = { shiftKey: true };
  const out = await jumpFor(formation, "Alder", { event });
  assert.deepEqual([out.ok, out.step], [true, "across"], "12 meets the save's 12");
  assert.deepEqual(seen.saves, [["Alder", "paralysis", { event }]], "the system's roll, on the member, with the press's event");
  const record = recordOf(formation);
  assert.deepEqual([record.jump.save.total, record.jump.save.target, record.jump.save.passed, record.jump.slip], [12, 12, true, null]);
  assert.deepEqual(naturals, [3], "the shortfall die is not rolled for a save made");
  const row = rowOf(buildCrossingView(formation), "Alder");
  assert.deepEqual([row.result.save.text, row.result.save.label], ["Save 12 against 12", "saved"]);
  assert.ok(row.result.save.tip.endsWith("XX p.3"), "the save's working names the page");
  assert.equal(row.landing.canRoll, false, "the standalone save press is spent once an attempt stands");
});

await ok("a failed save slips back by the shortfall die: solid is prone and across, the edge is hanging, empty space is a fall", async () => {
  const cases = [
    { slip: 2, state: "across", footing: "Solid ground", outcome: "Prone" },
    { slip: 3, state: "hanging", footing: "An edge", outcome: "Hanging" },
    { slip: 5, state: "fell", footing: "Empty space", outcome: "Falls" },
  ];
  for (const { slip, state, footing, outcome } of cases) {
    const { formation } = await gapWorld({ landing: { precarious: true } });
    saveResult = { total: 11 };
    naturals.push(6, slip);
    const out = await jumpFor(formation, "Alder");
    assert.deepEqual([out.ok, out.step], [true, state], `slip ${slip}`);
    const row = rowOf(buildCrossingView(formation), "Alder");
    assert.deepEqual([row.result.save.label, row.result.save.text], ["failed", "Save 11 against 12"]);
    assert.deepEqual([row.result.footing.text, row.result.footing.footing, row.result.footing.outcome], [`Landing short by ${slip} ft`, footing, outcome], `slip ${slip}`);
    assert.ok(row.result.footing.tip.includes(`gap 15 ft, landing short ${slip} ft`) && row.result.footing.tip.endsWith("XX p.3"));
    assert.equal(row.result.footing.fall?.text, state === "fell" ? "Fell 30 ft, 2d8" : undefined);
    assert.equal(recordOf(formation).jump.slip, slip);
    assert.equal(naturals.length, 0);
    assert.equal(seen.created.length, 1, "one card to the Judges; the system posts the save's own");
  }
});

await ok("a hanging jumper climbs up on the climb rows' logic: the member's own figure, one stretch, across on a make, a fall of the depth on a botch", async () => {
  const hang = async (options = {}) => {
    const world = await gapWorld({ landing: { precarious: true }, ...options });
    saveResult = { total: 11 };
    naturals.push(6, 3);
    await jumpFor(world.formation, "Alder");
    assert.equal(recordOf(world.formation).state, "hanging");
    seen.created.length = 0;
    seen.warned.length = 0;
    return world;
  };
  const { formation } = await hang();
  const row = rowOf(buildCrossingView(formation), "Alder");
  assert.deepEqual([row.attempt.can, row.climb.can, row.climb.warn, row.stateLabel], [false, true, true, "Hanging"], "a Judge is warned where the grid refuses the sheer climb");
  assert.equal(row.climb.target, "14+", "the member's own figure");
  assert.ok(row.climb.targetTip.length > 0);
  assert.deepEqual(await jumpFor(formation, "Alder"), { ok: false, refused: "hanging" }, "a hanging jumper does not jump again");
  naturals.push(14);
  const made = await jumpFor(formation, "Alder", { step: "climbUp" });
  assert.deepEqual([made.ok, made.step], [true, "across"]);
  assert.equal(seen.warned.length, 1, "the Judge is warned first");
  assert.equal(recordOf(formation).state, "across");
  assert.equal(recordOf(formation).jump.footing, "edge", "what the jump left stays on the record");
  assert.ok(seen.created[0].content.includes("Climb up") && seen.created[0].content.includes("Thrown over a refusal"));
  assert.equal(rowOf(buildCrossingView(formation), "Alder").climb, null, "nothing left to climb");
  assert.equal((await jumpFor(formation, "Alder", { step: "climbUp" })).refused, "stale", "a climb up for a jumper who is not hanging");

  const stalled = await hang();
  naturals.push(5);
  assert.deepEqual([(await jumpFor(stalled.formation, "Alder", { step: "climbUp" })).step], ["stalled"], "a miss that holds on");
  const again = rowOf(buildCrossingView(stalled.formation), "Alder");
  assert.deepEqual([again.climb.can, again.attempt.can], [true, false], "still hanging, and a Judge may rule another");
  naturals.push(1);
  const fell = await jumpFor(stalled.formation, "Alder", { step: "climbUp" });
  assert.deepEqual([fell.step, fell.fall.feet, fell.fall.damage], ["fell", 30, "2d8"], "a botch falls the setup's depth, not a stretch's midpoint");
  assert.ok(seen.created.at(-1).content.includes("Fall: 30 ft, 2d8"));

  const roped = await hang();
  await applyCrossingForm(roped.formation, { ropeFixed: true });
  naturals.push(5);
  assert.equal((await jumpFor(roped.formation, "Alder", { step: "climbUp" })).step, "across", "a fixed rope makes it the easy climb, whose miss still covers the ground");
});

await ok("the result line keeps the landing's footing and its outcome follows the climb up: climbed up on a make, the setup's fall on a botch, hanging while it holds on", async () => {
  const hang = async () => {
    const world = await gapWorld({ landing: { precarious: true } });
    saveResult = { total: 11 };
    naturals.push(6, 3);
    await jumpFor(world.formation, "Alder");
    assert.equal(recordOf(world.formation).state, "hanging");
    const before = rowOf(buildCrossingView(world.formation), "Alder").result.footing;
    assert.deepEqual([before.footing, before.outcome, before.fall], ["An edge", "Hanging", null], "the landing leaves the jumper hanging");
    return world;
  };
  const made = await hang();
  naturals.push(14);
  assert.equal((await jumpFor(made.formation, "Alder", { step: "climbUp" })).step, "across");
  let line = rowOf(buildCrossingView(made.formation), "Alder").result.footing;
  assert.deepEqual([line.text, line.footing, line.outcome, line.fall], ["Landing short by 3 ft", "An edge", "Climbed up", null], "where they landed stays; the outcome is the climb up's");
  assert.ok(line.tip.includes("Natural 14, total 14") && line.tip.endsWith("XX p.3"), "the climb up's throw is in the working, the page ends it");
  const shown = render({ crossing: buildCrossingView(made.formation) });
  assert.ok(shown.includes("An edge: Climbed up") && !shown.includes("An edge: Hanging"), "the rendered line reads the climb up");

  const missed = await hang();
  naturals.push(5);
  assert.equal((await jumpFor(missed.formation, "Alder", { step: "climbUp" })).step, "stalled");
  line = rowOf(buildCrossingView(missed.formation), "Alder").result.footing;
  assert.deepEqual([line.outcome, line.fall], ["Hanging", null], "a miss that holds on is still hanging");
  naturals.push(1);
  assert.equal((await jumpFor(missed.formation, "Alder", { step: "climbUp" })).step, "fell");
  const row = rowOf(buildCrossingView(missed.formation), "Alder");
  assert.deepEqual([row.stateLabel, row.result.footing.footing, row.result.footing.outcome], ["Fell", "An edge", "Fell"], "the state and the line agree");
  assert.equal(row.result.footing.fall.text, "Fell 30 ft, 2d8", "the climb up's fall is the setup's depth with the imported dice");
  assert.ok(row.result.footing.fall.tip.endsWith("XX p.2"), "the fall names its imported page");
  assert.ok(row.result.footing.tip.includes("Natural 1, total 1"));
  const fellHtml = render({ crossing: buildCrossingView(missed.formation) });
  assert.ok(fellHtml.includes("An edge: Fell") && fellHtml.includes("Fell 30 ft, 2d8") && !fellHtml.includes("An edge: Hanging"));

  await reportLanding(missed.formation, "Alder", "edge");
  assert.equal(rowOf(buildCrossingView(missed.formation), "Alder").result.footing.outcome, "Hanging", "a Judge's pick of the edge hangs the jumper again");
});

await ok("the Judge's footing pick on an attempted jump writes the record, and the row, the climb up and the state follow it", async () => {
  const hang = async () => {
    const world = await gapWorld({ landing: { precarious: true } });
    saveResult = { total: 11 };
    naturals.push(6, 3);
    await jumpFor(world.formation, "Alder");
    assert.equal(recordOf(world.formation).state, "hanging");
    seen.created.length = 0;
    return world;
  };
  const { formation } = await hang();
  assert.equal(rowOf(buildCrossingView(formation), "Alder").climb.can, true, "the computed footing offers the climb up");
  const solid = await reportLanding(formation, "Alder", "solid");
  assert.deepEqual([solid.ok, solid.step], [true, "across"]);
  assert.equal(seen.created.length, 1, "the card still goes to the Judges");
  const record = recordOf(formation);
  assert.deepEqual([record.state, record.jump.footing, record.jump.slip, record.jump.distance, record.throws], ["across", "solid", 3, 18, 1], "the footing and its state, the rolled figures as they were");
  const row = rowOf(buildCrossingView(formation), "Alder");
  assert.deepEqual([row.stateLabel, row.climb, row.attempt.can], ["Across", null, false], "no climb up for a jumper on solid ground");
  assert.deepEqual([row.result.footing.footing, row.result.footing.outcome, row.result.footing.text], ["Solid ground", "Prone", "Landing short by 3 ft"]);
  assert.ok(row.result.footing.tip.includes("Set by the Judge") && row.result.footing.tip.endsWith("XX p.3"));
  const html = render({ crossing: buildCrossingView(formation) });
  assert.equal(html.includes("crossingClimbUp"), false, "the button is gone");

  const empty = await reportLanding(formation, "Alder", "empty");
  assert.deepEqual([empty.step, recordOf(formation).state, recordOf(formation).jump.footing], ["fell", "fell", "empty"]);
  const fell = rowOf(buildCrossingView(formation), "Alder");
  assert.deepEqual([fell.stateLabel, fell.result.footing.fall.text], ["Fell", "Fell 30 ft, 2d8"], "the fall reads the setup's depth");
  const edge = await reportLanding(formation, "Alder", "edge");
  assert.deepEqual([edge.step, recordOf(formation).state], ["hanging", "hanging"]);
  const back = rowOf(buildCrossingView(formation), "Alder");
  assert.deepEqual([back.stateLabel, back.climb.can, back.result.footing.footing], ["Hanging", true, "An edge"], "an edge hangs and climbs up again");

  const clean = await gapWorld({ landing: { precarious: true } });
  saveResult = { total: 12 };
  naturals.push(6);
  await jumpFor(clean.formation, "Alder");
  assert.equal(rowOf(buildCrossingView(clean.formation), "Alder").result.footing, null, "a clean landing shows no footing");
  await reportLanding(clean.formation, "Alder", "empty");
  const over = rowOf(buildCrossingView(clean.formation), "Alder");
  assert.deepEqual([recordOf(clean.formation).state, over.stateLabel, over.result.footing.text, over.result.footing.footing], ["fell", "Fell", "Footing set by the Judge", "Empty space"]);

  const busy = await hang();
  rollDelay = 10;
  naturals.push(6);
  const pressed = jumpFor(busy.formation, "Alder", { step: "climbUp" });
  assert.equal((await reportLanding(busy.formation, "Alder", "solid")).refused, "busy", "a pick does not land between a press and its record");
  naturals.length = 0;
  await pressed;
  rollDelay = 0;
});

await ok("a holder of Climbing climbs up for a player's press; one the grid refuses is blocked with the reason", async () => {
  const { formation } = await gapWorld({ landing: { precarious: true }, items: [CLIMBING()] });
  saveResult = { total: 11 };
  naturals.push(6, 3);
  await jumpFor(formation, "Alder");
  seen.created.length = 0;
  const view = rowOf(as(PLAYER, () => buildCrossingView(formation)), "Alder");
  assert.deepEqual([view.climb.can, view.climb.warn, view.climb.target], [true, false, "12+"], "the skill's own figure, no warning");
  naturals.push(13);
  assert.deepEqual(await asAsync(PLAYER, () => requestCrossingThrow(formation, "Alder", "climbUp")), { ok: true });
  assert.equal(recordOf(formation).state, "across");
  const { declarations, cards } = posted();
  assert.ok(declarations[0].content.includes("Pat declares: Alder climbs up."), "public, in the requester's name");
  assert.equal(cards.length, 1);

  const plain = await gapWorld({ landing: { precarious: true } });
  saveResult = { total: 11 };
  naturals.push(6, 3);
  await jumpFor(plain.formation, "Alder");
  seen.created.length = 0;
  const blocked = rowOf(as(PLAYER, () => buildCrossingView(plain.formation)), "Alder");
  assert.deepEqual([blocked.climb.can, blocked.climb.blocked, blocked.climb.said], [false, true, "Alder cannot attempt this"]);
  naturals.length = 0;
  naturals.push(14);
  const out = await asAsync(PLAYER, () => requestCrossingThrow(plain.formation, "Alder", "climbUp"));
  assert.deepEqual([out.ok, out.refused], [false, "notPermitted"]);
  assert.equal(naturals.length, 1, "nothing was rolled");
});

await ok("a player's attempt is relayed: declared publicly, rolled and recorded on the GM client, the system's dialog skipped; a non-owner is refused", async () => {
  const { formation } = await gapWorld({ landing: { precarious: true } });
  saveResult = { total: 12 };
  naturals.push(6);
  const direct = await asAsync(PLAYER, () => jumpFor(formation, "Alder"));
  assert.deepEqual([direct.ok, direct.refused], [false, "notGM"], "the player's own client rolls nothing");
  assert.deepEqual(await asAsync(PLAYER, () => requestCrossingThrow(formation, "Alder", "attempt")), { ok: true });
  assert.deepEqual(seen.told, ["Declared — sent to the Judge."]);
  const { declarations, cards } = posted();
  assert.ok(declarations[0].content.includes("Pat declares: Alder jumps."));
  assert.equal(cards.length, 1);
  assert.deepEqual(seen.saves.map(([, , options]) => options.event), [{ shiftKey: true }], "a relayed save carries the skip key, so no dialog opens on the Judge's seat");
  assert.equal(recordOf(formation).state, "across");
  assert.ok(seen.created.indexOf(declarations[0]) < seen.created.indexOf(cards[0]), "declared before the card");

  const other = await gapWorld();
  naturals.length = 0;
  naturals.push(6);
  const id = readCrossing(other.formation).id;
  await relay(OTHER, other.formation, "crossing", { crossingId: id, actorId: "Alder", step: "attempt" });
  const sent = posted();
  assert.deepEqual([sent.declarations.length, sent.cards.length, sent.whispers.length], [0, 0, 1]);
  assert.equal(sent.whispers[0].content, "Alder is not yours to throw for.");
  assert.equal(naturals.length, 1, "no die was rolled");
  await relay(PLAYER, other.formation, "crossing", { crossingId: "other", actorId: "Alder", step: "attempt" });
  assert.equal(posted().whispers.length, 2, "a press for another crossing is told so");
  assert.equal(naturals.length, 1);
  assert.equal(
    (await asAsync(PLAYER, () => requestCrossingThrow(other.formation, "Alder", "bogus"))).refused,
    "stale", "a step that is neither the attempt nor the climb up is refused before it is sent",
  );
});

await ok("an absence rolls nothing, for a Judge too: the die's figures, no gap, the shortfall die of a precarious landing, a member with no save", async () => {
  const { formation } = await gapWorld();
  load({ jumping: null });
  naturals.push(6);
  assert.deepEqual(await jumpFor(formation, "Alder"), { ok: false, refused: "absence" });
  assert.equal(rowOf(buildCrossingView(formation), "Alder").attempt.can, false);
  assert.deepEqual([naturals.length, seen.created.length, seen.saves.length], [1, 0, 0]);
  assert.deepEqual(await asAsync(PLAYER, () => requestCrossingThrow(formation, "Alder", "attempt")), { ok: false, refused: "absence" }, "and a player's seat is not sent");

  await applyCrossingForm(formation, { precarious: true });
  load({ jumping: JUMPING });
  assert.equal((await jumpFor(formation, "Alder")).refused, "absence", "a save that fails would be rolled against a die nobody imported");
  assert.equal(naturals.length, 1);

  load({ jumping: J3 });
  await applyCrossingForm(formation, { gap: "" });
  assert.equal((await jumpFor(formation, "Alder")).refused, "noGap");
  assert.equal(rowOf(buildCrossingView(formation), "Alder").attempt.can, false);

  const wolf = await (async () => {
    reset();
    load({ jumping: J3 });
    const w = person("Wolf", { type: "monster", adventuring: null, saves: {} });
    const made = world([w]);
    await beginCrossing(made.formation, "jump");
    await applyCrossingForm(made.formation, { gap: "15", charging: true });
    return made;
  })();
  naturals.push(6);
  assert.equal((await jumpFor(wolf.formation, "Wolf")).refused, "noCell");
  assert.deepEqual([naturals.length, seen.created.length, seen.saves.length], [1, 0, 0]);
});

await ok("a permission refusal warns a Judge and blocks a player: an out-of-reach gap rolls over the warning and a player's press is not sent", async () => {
  const { formation } = await gapWorld({ landing: {} });
  await applyCrossingForm(formation, { gap: "90" });
  const player = rowOf(as(PLAYER, () => buildCrossingView(formation)), "Alder");
  assert.deepEqual([player.attempt.can, player.blocked, player.said], [false, true, "Alder cannot reach"]);
  assert.equal((await asAsync(PLAYER, () => requestCrossingThrow(formation, "Alder", "attempt"))).refused, "impossible");
  const judge = rowOf(buildCrossingView(formation), "Alder");
  assert.deepEqual([judge.attempt.can, judge.attempt.warn, judge.attempt.label], [true, true, "Attempt anyway"]);
  naturals.push(8);
  seen.warned.length = 0;
  const out = await jumpFor(formation, "Alder");
  assert.deepEqual([out.ok, out.step], [true, "fell"]);
  assert.equal(seen.warned.length, 1);
  assert.ok(seen.created[0].content.includes("Thrown over a refusal"));
});

await ok("a dismissed save dialog keeps the rolled distance and the next press finishes the save without rolling the die again", async () => {
  const { formation } = await gapWorld({ landing: { precarious: true } });
  saveResult = undefined;
  naturals.push(6, 2);
  assert.deepEqual(await jumpFor(formation, "Alder"), { ok: false, refused: "cancelled" });
  const record = recordOf(formation);
  assert.deepEqual([record.state, record.throws, record.jump.distance, record.jump.save], ["landing", 1, 18, null]);
  assert.equal(seen.created.length, 0, "no card until the jump is settled");
  const row = rowOf(buildCrossingView(formation), "Alder");
  assert.deepEqual([row.attempt.can, row.attempt.label, row.result.pending, row.stateLabel], [true, "Roll the save", true, "Save to roll"]);
  assert.equal(row.landing.canRoll, false);
  saveResult = { total: 11 };
  const out = await jumpFor(formation, "Alder");
  assert.deepEqual([out.ok, out.step], [true, "across"], "the slip of 2 leaves 1 foot past the edge");
  assert.deepEqual(naturals, [], "the die was not rolled again; the shortfall die was");
  const done = recordOf(formation);
  assert.deepEqual([done.throws, done.jump.distance, done.jump.slip, done.jump.footing], [1, 18, 2, "solid"]);
  assert.equal(seen.created.length, 1);
});

await ok("an attempt needs an open jump and a member: an obstacle crossing, none open and a stranger are refused", async () => {
  reset();
  load();
  const a = person("Alder", { dex: 12 });
  const { formation } = world([a]);
  assert.equal((await jumpFor(formation, "Alder")).refused, "closed");
  await beginCrossing(formation, "easyClimb");
  assert.equal((await jumpFor(formation, "Alder")).refused, "notJump");
  await endCrossing(formation);
  await beginCrossing(formation, "jump");
  assert.equal((await jumpFor(formation, "Nobody")).refused, "member");
  assert.equal((await jumpFor(formation, "Alder", { crossingId: "stale" })).refused, "stale");
  assert.equal((await throwFor(formation, "Alder")).refused, "jump", "a stretch is not thrown over a gap");
  assert.equal(naturals.length, 0);
});

await ok("an interleaved second press for the same member is refused as busy and a crossing ended mid-attempt records nothing", async () => {
  const { formation } = await gapWorld();
  rollDelay = 10;
  naturals.push(6, 6);
  const first = jumpFor(formation, "Alder");
  const second = await jumpFor(formation, "Alder");
  assert.equal(second.refused, "busy");
  await first;
  assert.equal(naturals.length, 1, "one die");
  await endCrossing(formation);
  await beginCrossing(formation, "jump");
  await applyCrossingForm(formation, { gap: "15" });
  seen.created.length = 0;
  const ending = jumpFor(formation, "Alder");
  await endCrossing(formation);
  assert.equal((await ending).refused, "stale");
  rollDelay = 0;
  assert.equal(seen.created.length, 0, "no card for a crossing that ended");
});

await ok("a player's panel offers a jump while an attempt or a climb up is open to a member they own", async () => {
  const { formation } = await gapWorld();
  assert.equal(as(PLAYER, () => canCross(formation)), true);
  assert.equal(as(OTHER, () => canCross(formation)), false);
  naturals.push(6);
  await jumpFor(formation, "Alder");
  assert.equal(as(PLAYER, () => canCross(formation)), false, "a jumper who is across has nothing left");
});

await ok("the partial draws the attempt for a Judge and an owner and not another seat, the climb up for a hanging jumper, and the result with its tooltips", async () => {
  const { formation } = await gapWorld({ landing: { precarious: true } });
  const judge = render({ crossing: buildCrossingView(formation) });
  assert.ok(judge.includes('data-action="crossingAttempt"') && judge.includes('data-actor-id="Alder"'));
  assert.ok(judge.includes('name="crossing.ropeFixed"'), "the climb up reads the setup's rope");
  assert.ok(render({ crossing: as(PLAYER, () => buildCrossingView(formation)) }).includes('data-action="crossingAttempt"'), "the owner's");
  assert.equal(render({ crossing: as(OTHER, () => buildCrossingView(formation)) }).includes("crossingAttempt"), false, "another seat's none");
  saveResult = { total: 11 };
  naturals.push(6, 3);
  await jumpFor(formation, "Alder");
  const hanging = render({ crossing: buildCrossingView(formation) });
  assert.ok(hanging.includes('data-action="crossingClimbUp"'), "a hanging jumper's climb up");
  assert.equal(hanging.includes('data-action="crossingAttempt"'), false, "and no second jump");
  for (const word of ["Rolled 18 ft", "clears", "Hanging", "Save 11 against 12", "failed", "Landing short by 3 ft", "An edge"]) assert.ok(hanging.includes(word), word);
  for (const html of [judge, hanging]) {
    assert.equal(/\sid=/.test(html), false, "no literal id");
    assert.equal(/<summary/.test(html), false, "nothing in a summary");
    for (const glyph of html.matchAll(/<i [^>]*>/g)) assert.ok(glyph[0].includes("inert"), "a glyph is inert");
  }
  assert.ok(/acks-extras-crossing-rolled" data-tooltip-text="[^"]+/.test(hanging), "the rolled distance carries its working");
  for (const html of [judge, hanging]) {
    assert.ok(/<li class="acks-extras-crossing-row"[^>]*data-press-home="Alder"[^>]*tabindex="-1"/.test(html), "the row is the home focus returns to when its pressed button goes");
  }
});

/* --- held conditions ------------------------------------------------------------ */

/**
 * Give a stand-in actor the effects collection and the three writes a held
 * condition reads and makes, each delete checked to authorize itself.
 */
function withEffects(actor) {
  const rows = new Map();
  const log = { created: 0, deleted: 0 };
  const make = (data) => {
    const id = data._id ?? `fx${(++serial).toString().padStart(14, "0")}`;
    const effect = {
      id, name: data.name, disabled: !!data.disabled, statuses: new Set(data.statuses ?? []), flags: data.flags ?? {},
      getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
      async update(patch) { if (patch.statuses) this.statuses = new Set(patch.statuses); },
    };
    rows.set(id, effect);
    return effect;
  };
  actor.rows = rows;
  actor.log = log;
  actor.effects = { has: (id) => rows.has(id), get: (id) => rows.get(id), [Symbol.iterator]: () => rows.values() };
  actor.seed = make;
  actor.createEmbeddedDocuments = async (_type, list, options = {}) => {
    log.created += list.length;
    return list.map((d) => make(options.keepId ? d : { ...d, _id: undefined }));
  };
  actor.deleteEmbeddedDocuments = async (_type, ids, options) => {
    assert.equal(options?.["acks-extras"]?.managedDelete, true, "the delete authorizes itself");
    for (const id of ids) rows.delete(id);
    log.deleted += ids.length;
  };
  return actor;
}
globalThis.CONFIG = { statusEffects: [{ id: "vulnerable", name: "EFFECT.Vulnerable", img: "icons/svg/hazard.svg" }] };

/** The spelunking table with a grid row saying which obstacles leave a climber helpless. */
const VULNERABLE = { ...SPELUNKING, vulnerable: { sheerClimb: true, easyClimb: false } };
const HAND_SET = { name: "Vulnerable", statuses: ["vulnerable"] };
const MAPPER_HELD = { name: "Vulnerable", statuses: ["vulnerable"], flags: { "acks-extras": { heldCondition: "mapperKit" } } };
/** The crossing-held effects on an actor, whatever else it carries. */
const crossingHeldOn = (actor) => [...actor.effects].filter((e) => String(e.getFlag("acks-extras", "heldCondition")).startsWith("crossing:"));
const chipsOf = (view, name) => rowOf(view, name).held.map((c) => c.label);
const holdersOn = (actor) => [...actor.rows.values()].map((e) => e.getFlag("acks-extras", "heldCondition") ?? "").sort();

/** An obstacle crossing over three stretches, one climber carrying `withEffects`. */
async function heldWorld({ spelunking = VULNERABLE, kind = "sheerClimb" } = {}) {
  reset();
  load({ spelunking });
  const alder = withEffects(person("Alder", { items: [CLIMBING()], owner: PLAYER.id }));
  const { formation, actor } = world([alder]);
  await beginCrossing(formation, kind);
  await applyCrossingForm(formation, { length: "120" });
  return { formation, alder, party: actor };
}

await ok("a member's first throw on an obstacle the grid marks vulnerable holds the condition, marked with the crossing; the chip names it on every seat", async () => {
  const { formation, alder } = await heldWorld();
  naturals.push(17);
  const out = await throwFor(formation, "Alder");
  assert.equal(out.step, "climbing");
  const held = crossingHeldOn(alder);
  assert.equal(held.length, 1);
  assert.equal(held[0].getFlag("acks-extras", "heldCondition"), `crossing:${readCrossing(formation).id}:vulnerable`);
  assert.deepEqual([...held[0].statuses], ["vulnerable"]);
  assert.match(held[0].id, /^[A-Za-z0-9]{16}$/, "the effect's id is 16 letters and digits");
  for (const seat of [GM, PLAYER, OTHER]) {
    const view = as(seat, () => buildCrossingView(formation));
    assert.deepEqual(chipsOf(view, "Alder"), ["Vulnerable"], "the condition's own localized name");
    const chip = rowOf(view, "Alder").held[0];
    assert.ok(chip.tip.includes("held by this crossing") && chip.tip.endsWith("XX p.1"), "the tooltip says who holds it and names the imported page");
  }
  const html = render({ crossing: buildCrossingView(formation) });
  assert.ok(/acks-extras-crossing-held[^>]*>Vulnerable</.test(html), "the chip is text in the row's cells line");
  naturals.push(17);
  await throwFor(formation, "Alder");
  assert.equal(crossingHeldOn(alder).length, 1, "a second throw on the obstacle writes no second effect");
  assert.equal(alder.log.created, 1);
});

await ok("the hold is released when the member is across, and an across row shows no chip", async () => {
  const { formation, alder } = await heldWorld();
  naturals.push(17, 17, 17);
  await throwFor(formation, "Alder");
  await throwFor(formation, "Alder");
  assert.equal(crossingHeldOn(alder).length, 1);
  const last = await throwFor(formation, "Alder");
  assert.equal(last.step, "across");
  assert.equal(crossingHeldOn(alder).length, 0);
  assert.deepEqual(rowOf(buildCrossingView(formation), "Alder").held, []);
  assert.equal(alder.log.deleted, 1);
});

await ok("a jumper's climb up holds nothing, though the grid marks the sheer climb vulnerable: a stall and a fall alike leave the body untouched", async () => {
  reset();
  load({ spelunking: VULNERABLE, jumping: J3 });
  const alder = withEffects(person("Alder", { dex: 12, owner: PLAYER.id, saves: { paralysis: { value: 12 } } }));
  const { formation } = world([alder]);
  await beginCrossing(formation, "jump");
  await applyCrossingForm(formation, { gap: "15", depth: "30", precarious: true });
  saveResult = { total: 11 };
  naturals.push(6, 3);
  await jumpFor(formation, "Alder");
  assert.equal(recordOf(formation).state, "hanging");
  assert.equal(alder.log.created, 0, "the jump itself holds nothing");
  naturals.push(5);
  assert.equal((await jumpFor(formation, "Alder", { step: "climbUp" })).step, "stalled", "the grid row that marks a stalled climber vulnerable is read");
  assert.deepEqual([crossingHeldOn(alder).length, alder.log.created, alder.log.deleted], [0, 0, 0], "a stall holds and releases nothing");
  assert.equal(rowOf(buildCrossingView(formation), "Alder").held, undefined, "a jump row draws no chip");
  assert.equal(render({ crossing: buildCrossingView(formation) }).includes("acks-extras-crossing-held"), false);
  naturals.push(1);
  assert.equal((await jumpFor(formation, "Alder", { step: "climbUp" })).step, "fell");
  assert.deepEqual([alder.log.created, alder.log.deleted], [0, 0], "a fall touches no body either");
});

await ok("a member who crosses in one throw never holds anything", async () => {
  const { formation, alder } = await heldWorld();
  await applyCrossingForm(formation, { length: "40" });
  naturals.push(17);
  assert.equal((await throwFor(formation, "Alder")).step, "across");
  assert.equal(alder.log.created, 0);
  assert.equal(alder.log.deleted, 0);
});

await ok("the hold is released when the member falls", async () => {
  const { formation, alder } = await heldWorld();
  naturals.push(17, 1);
  await throwFor(formation, "Alder");
  assert.equal(crossingHeldOn(alder).length, 1);
  assert.equal((await throwFor(formation, "Alder")).step, "fell");
  assert.equal(crossingHeldOn(alder).length, 0);
  assert.deepEqual(rowOf(buildCrossingView(formation), "Alder").held, []);
});

await ok("a stalled member stays on the obstacle and keeps the hold", async () => {
  const { formation, alder } = await heldWorld();
  naturals.push(5);
  assert.equal((await throwFor(formation, "Alder")).step, "stalled");
  assert.equal(crossingHeldOn(alder).length, 1);
});

await ok("End releases what the crossing holds, and a new Begin starts with none", async () => {
  const { formation, alder } = await heldWorld();
  naturals.push(17);
  await throwFor(formation, "Alder");
  assert.equal(crossingHeldOn(alder).length, 1);
  assert.equal(await endCrossing(formation), true);
  assert.equal(crossingHeldOn(alder).length, 0);
  assert.equal(readCrossing(formation), null);
  assert.ok(await beginCrossing(formation, "sheerClimb"));
  assert.equal(crossingHeldOn(alder).length, 0);
});

await ok("a member the party drops is released at the next write, and the crossing's other members are untouched", async () => {
  reset();
  load({ spelunking: VULNERABLE });
  const alder = withEffects(person("Alder", { items: [CLIMBING()] }));
  const birch = withEffects(person("Birch", { items: [CLIMBING()] }));
  const { formation } = world([alder, birch]);
  await beginCrossing(formation, "sheerClimb");
  await applyCrossingForm(formation, { length: "120" });
  naturals.push(17, 17);
  await throwFor(formation, "Alder");
  await throwFor(formation, "Birch");
  formation.members = formation.members.filter((m) => m.actorId !== "Alder");
  assert.equal(await pruneMembers(formation), true);
  assert.equal(crossingHeldOn(alder).length, 0, "released on the dropped member");
  assert.equal(crossingHeldOn(birch).length, 1, "kept on the one still crossing");
  assert.equal(readCrossing(formation).members.Alder, undefined);
  // The drop made at a throw's own write releases the same way.
  const cedar = withEffects(person("Cedar", { items: [CLIMBING()] }));
  formation.members.push({ actorId: "Cedar" });
  naturals.push(17);
  await throwFor(formation, "Cedar");
  assert.equal(crossingHeldOn(cedar).length, 1);
  formation.members = formation.members.filter((m) => m.actorId !== "Cedar");
  naturals.push(17);
  await throwFor(formation, "Birch");
  assert.equal(crossingHeldOn(cedar).length, 0, "writeMemberStep released what its own prune dropped");
});

await ok("a Vulnerable from a hand or the mapper's kit is never touched by a hold or a release", async () => {
  const { formation, alder } = await heldWorld();
  alder.seed(HAND_SET);
  alder.seed(MAPPER_HELD);
  naturals.push(17, 17, 17);
  await throwFor(formation, "Alder");
  assert.equal(alder.rows.size, 3, "the crossing's effect stands beside the two");
  await throwFor(formation, "Alder");
  await throwFor(formation, "Alder");
  assert.equal(crossingHeldOn(alder).length, 0);
  assert.deepEqual(holdersOn(alder), ["", "mapperKit"], "after the release the other two stand");
  await endCrossing(formation);
  assert.deepEqual(holdersOn(alder), ["", "mapperKit"], "End touches neither");
});

await ok("nothing is held where the grid row is not imported, is not a boolean, or says the obstacle does not leave a climber helpless", async () => {
  for (const [spelunking, kind] of [
    [SPELUNKING, "sheerClimb"],
    [{ ...SPELUNKING, vulnerable: { sheerClimb: "yes" } }, "sheerClimb"],
    [VULNERABLE, "easyClimb"],
  ]) {
    const { formation, alder } = await heldWorld({ spelunking, kind });
    naturals.push(17);
    assert.equal((await throwFor(formation, "Alder")).step, "climbing");
    assert.equal(alder.log.created, 0, "no effect is made");
    assert.deepEqual(rowOf(buildCrossingView(formation), "Alder").held, []);
  }
});

await ok("a player's relayed throw holds the condition on the GM client, and the player's seat reads the chip", async () => {
  const { formation, alder } = await heldWorld();
  naturals.push(17);
  const out = await asAsync(PLAYER, () => requestCrossingThrow(formation, "Alder"));
  assert.deepEqual(out, { ok: true });
  assert.equal(crossingHeldOn(alder).length, 1);
  assert.deepEqual(chipsOf(as(PLAYER, () => buildCrossingView(formation)), "Alder"), ["Vulnerable"]);
});

await ok("an End that lands between a throw's record and its hold leaves nothing held", async () => {
  const { formation, alder } = await heldWorld();
  const create = alder.createEmbeddedDocuments;
  alder.createEmbeddedDocuments = async (...args) => {
    alder.createEmbeddedDocuments = create;
    await endCrossing(formation);
    return create(...args);
  };
  naturals.push(17);
  assert.equal((await throwFor(formation, "Alder")).step, "climbing");
  assert.equal(readCrossing(formation), null);
  assert.equal(crossingHeldOn(alder).length, 0, "the late hold is taken off again");
});

await ok("a new Begin releases a stray from an earlier crossing and spares one another party has open", async () => {
  reset();
  load({ spelunking: VULNERABLE });
  const alder = withEffects(person("Alder", { items: [CLIMBING()] }));
  const { formation } = world([alder]);
  const other = party("party2");
  other.store.flags["acks-extras"].crossing = { id: "openelsewhere", kind: "sheerClimb", members: {} };
  formations.f2 = { id: "f2", name: "Other", actorId: other.id, members: [] };
  const stray = (id) => alder.seed({ name: "Vulnerable", statuses: ["vulnerable"], flags: { "acks-extras": { heldCondition: `crossing:${id}:vulnerable` } } });
  stray("longgone");
  stray("openelsewhere");
  alder.seed(HAND_SET);
  assert.ok(await beginCrossing(formation, "sheerClimb"));
  assert.deepEqual(holdersOn(alder), ["", "crossing:openelsewhere:vulnerable"]);
});

console.log(`\n${passed} passed`);
