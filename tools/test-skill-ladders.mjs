/**
 * The imported skills' ladders as a borrowed throw reads them
 * (scripts/abilities/skill-ladders.mjs, through `ladderRungAt` in
 * scripts/classes/registry.mjs).
 *
 * Stand-in documents; every figure is invented. What this pins: a borrowed
 * ladder that no class document publishes is read from the world's imported
 * skill of that key, a class that does publish it wins, a pack-held skill is
 * read once the cache has loaded and a cold cache answers nothing rather than a
 * wrong figure, and the level reads at the fraction the throw states. The
 * figures a character sees are the live walk's (docs/formation/TESTING.md).
 */
import assert from "node:assert/strict";

let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

class Stub {}
globalThis.game = {
  user: { id: "u1", isGM: true },
  i18n: { localize: (k) => k, format: (k) => k, has: () => true },
  settings: { get: () => ({}) },
  actors: [],
  items: [],
  packs: [],
};
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
const handlers = {};
globalThis.Hooks = { on(hook, fn) { (handlers[hook] ??= []).push(fn); }, once() {}, off() {}, call() {}, callAll() {} };
globalThis.fromUuidSync = () => null;
globalThis.foundry = {
  abstract: { DataModel: class {}, TypeDataModel: class {} },
  data: { regionBehaviors: { RegionBehaviorType: Stub }, fields: {} },
  utils: {
    escapeHTML: (s) => String(s),
    deepClone: (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v))),
    getProperty: (obj, path) => String(path).split(".").reduce((at, part) => at?.[part], obj),
  },
  applications: { api: { ApplicationV2: Stub, HandlebarsApplicationMixin: (B) => B, DialogV2: Stub }, handlebars: { renderTemplate: async () => "" } },
};

const { ladderRungAt, resolveLevelOutcome } = await import("../scripts/classes/registry.mjs");
const { importedLadderFor, importedSkillFor, skillLadderRungs, refreshLadders, initLadders, LADDER_REFRESH_QUIET_MS } = await import("../scripts/abilities/skill-ladders.mjs");
const { registerTable, unregisterTable, PRIORITY } = await import("../scripts/lib/tables.mjs");

/* --- fixtures ---------------------------------------------------------------- */
let serial = 0;
/** A level ladder as the importer writes it onto a roll target. */
const ladder = (...pairs) => ({ kind: "breakpoints", breakpoints: pairs.map(([atLevel, value, extra]) => ({ atLevel, value, ...(extra ?? {}) })) });
const throwOf = (key, target) => ({ key, label: key, formula: "1d20", rollType: "above", target, scale: "level" });

/** An ability document keeping its flags, with `update` applying the dotted paths the module writes. */
function item(name, { id = "", rolls = [], flags = {}, system = {} } = {}) {
  const f = { "acks-extras": { extras: { rolls, effects: [], provides: [] }, cookbook: id ? { id } : undefined, ...flags } };
  const doc = {
    id: `i${++serial}`, type: "ability", name, system: { ...system }, flags: f,
    getFlag: (scope, key) => f[scope]?.[key],
    async setFlag(scope, key, value) { f[scope][key] = value; },
    async unsetFlag(scope, key) { delete f[scope][key]; },
    async update(data) {
      for (const [path, value] of Object.entries(data)) {
        const m = /^flags\.acks-extras\.(.+)$/.exec(path);
        if (!m) continue;
        const rest = m[1];
        if (rest.startsWith("-=")) delete f["acks-extras"][rest.slice(2)];
        else f["acks-extras"][rest] = value;
      }
    },
  };
  return doc;
}
const skill = (key, ...pairs) => item(key, { id: `def.skill.${key}`, rolls: [throwOf("throw1", ladder(...pairs))] });
const actorOf = (items, level = 7) => {
  const a = { id: `a${++serial}`, name: "Tester", system: { details: { level } }, items };
  for (const i of items) i.actor = a;
  return a;
};
const reset = () => { game.items.length = 0; game.actors.length = 0; game.packs.length = 0; };
const half = { atLevelNum: 1, atLevelDen: 2 };

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Every `getDocuments` query the packs below received; a bare whole-shelf load is `undefined`. */
const queries = [];
/** Indexes built, one per ladder read of a pack (`shelfIndex` shares one pass between readers that overlap). */
let indexReads = 0;
let readDelay = 5;
/** Run once inside the next index read, after it has taken its snapshot: a change that lands mid-read. */
let duringRead = null;
/** Delays for the next loads, in the order they are asked. */
const loadDelays = [];

/**
 * A world Item pack as core keeps one: `getIndex()` answers rows of the core
 * fields and the declared stamp, `get` answers what a load has instantiated, and
 * `getDocuments(query)` takes `_id__in` and instantiates what it did not hold.
 * `list()` is the server's documents now; an index read snapshots them.
 */
function worldPack(list) {
  const held = new Map();
  const server = new Map();
  const pack = {
    documentName: "Item",
    collection: "world.skills",
    visible: true,
    metadata: { packageType: "world", label: "Skills" },
    failIndex: false,
    index: new Map(),
    get: (id) => held.get(id),
    async getIndex() {
      indexReads++;
      const now = list();
      for (const doc of now) server.set(doc.id, doc);
      const hook = duringRead;
      duringRead = null;
      if (hook) hook();
      await wait(readDelay);
      if (pack.failIndex) throw new Error("index refused");
      pack.index = new Map(now.map((doc) => [doc.id, { _id: doc.id, name: doc.name, type: doc.type, flags: doc.flags }]));
      return pack.index;
    },
    async getDocuments(query) {
      queries.push(query);
      await wait(loadDelays.shift() ?? 0);
      const ids = query?._id__in ? new Set(query._id__in) : null;
      const found = ids ? [...server.values()].filter((doc) => ids.has(doc.id)) : list();
      for (const doc of found) if (!held.has(doc.id)) held.set(doc.id, doc);
      return found;
    },
  };
  return pack;
}
const withWarnings = async (fn) => {
  const saved = console.warn;
  const warned = [];
  console.warn = (...args) => warned.push(args);
  try {
    await fn();
  } finally {
    console.warn = saved;
  }
  return warned;
};

/* ---------------------------------------------------------------------------- */

await ok("a ladder no class publishes is read from the world's imported skill, at the stated fraction", async () => {
  reset();
  game.items.push(skill("climbing", [1, 9], [4, 7], [8, 5]));
  assert.equal(ladderRungAt("thief", "climbing", half, 7, "up").value, 7, "level 7 at half, rounded up, is 4: the 4th-level rung");
  assert.equal(ladderRungAt("thief", "climbing", half, 6, "up").value, 9, "level 6 at half is 3, still below the 4th-level rung");
  assert.equal(ladderRungAt("thief", "climbing", half, 6, "down").value, 9);
  assert.equal(ladderRungAt("thief", "climbing", half, 7, "down").value, 9, "rounded down, level 7 at half is 3");
  assert.equal(ladderRungAt("thief", "climbing", "full", 8, "up").value, 5, "a whole level reads its own rung");
  assert.equal(ladderRungAt("thief", "climbing", half, 1, "up").value, 9, "the floor is level 1");
  assert.equal(ladderRungAt("thief", "unknownskill", half, 7, "up"), null, "a skill not imported gives nothing, not a guess");
});

await ok("the rung read whole keeps its text and outcome, so a borrowed throw reaches a non-number the way a skill's does", async () => {
  reset();
  game.items.push(skill("hiding", [1, 11], [6, null, { text: "auto", outcome: "auto" }]));
  const out = resolveLevelOutcome({ kind: "progression", as: "thief", table: "hiding", ...half, round: "up" }, 12, {});
  assert.equal(out.outcome, "auto");
  assert.equal(resolveLevelOutcome({ kind: "progression", as: "thief", table: "hiding", ...half, round: "up" }, 4, {}).target, 11);
});

await ok("a class that publishes the ladder wins over the imported skill", async () => {
  reset();
  game.items.push(skill("climbing", [1, 9], [4, 7]));
  registerTable({ id: "acks.class.sneakthief", tables: { "ladder.climbing": [{ atLevel: 1, value: 3, text: "3", outcome: "throw" }] } }, { priority: PRIORITY.WORLD, source: "test" });
  try {
    assert.equal(ladderRungAt("sneakthief", "climbing", "full", 8, "up").value, 3);
    assert.equal(ladderRungAt("thief", "climbing", "full", 8, "up").value, 7, "another class falls through to the skill");
  } finally {
    unregisterTable("acks.class.sneakthief", "test");
  }
});

await ok("a first read that cannot read a shelf publishes nothing, so no sheet redraws from a short map, and the cache stays unset", async () => {
  reset();
  game.items.push(skill("climbing", [1, 9]));
  const broken = worldPack(() => [skill("listening", [1, 10])]);
  broken.failIndex = true;
  game.packs.push(broken);
  let renders = 0;
  globalThis.foundry.applications.instances = new Map([["a", { rendered: true, document: { documentName: "Actor" }, render() { renders++; } }]]);
  try {
    const warned = await withWarnings(() => refreshLadders());
    assert.equal(renders, 0, "a map missing the shelf's skills is not published");
    assert.match(String(warned.at(-1)?.[0]), /acks-extras \| the skill ladders were kept as published: world\.skills could not be read/);
  } finally {
    delete globalThis.foundry.applications.instances;
  }
});

await ok("a skill held in a world pack answers after the cache loads, and a cold cache answers nothing", async () => {
  reset();
  const packed = skill("sneaking", [1, 10], [5, 6]);
  game.packs.push(worldPack(() => [packed]));
  assert.equal(importedLadderFor("sneaking", null), null, "nothing is loaded yet");
  assert.deepEqual(skillLadderRungs("sneaking"), []);
  await refreshLadders();
  assert.equal(ladderRungAt("thief", "sneaking", "full", 5, "up").value, 6);
  assert.deepEqual(skillLadderRungs("sneaking").map((r) => [r.atLevel, r.value]), [[1, 10], [5, 6]]);
});

await ok("the owner's own copy of a skill is read before the world's", async () => {
  reset();
  game.items.push(skill("climbing", [1, 9]));
  const mine = skill("climbing", [1, 4]);
  const a = actorOf([mine]);
  assert.equal(importedLadderFor("climbing", a).breakpoints[0].value, 4);
  assert.equal(importedLadderFor("climbing", null).breakpoints[0].value, 9);
});

await ok("an imported skill answers with its item's name, ladder and the item, from the world or the cached pack", async () => {
  reset();
  const world = skill("climbing", [1, 9], [4, 7]);
  world.name = "Scaling";
  game.items.push(world);
  const found = importedSkillFor("climbing");
  assert.deepEqual([found.key, found.name, found.item === world, found.ladder.breakpoints.map((b) => b.value)], ["climbing", "Scaling", true, [9, 7]]);
  assert.equal(importedSkillFor("unknownskill"), null, "a skill not imported answers nothing");
  assert.equal(importedSkillFor(""), null);
  const packed = skill("sneaking", [1, 10]);
  packed.name = "Stealth";
  game.packs.push(worldPack(() => [packed]));
  await refreshLadders();
  const held = importedSkillFor("sneaking");
  assert.deepEqual([held.name, held.item === packed], ["Stealth", true]);
  assert.equal(importedLadderFor("sneaking", null).breakpoints[0].value, 10, "the ladder reader is unchanged");
});

await ok("a read that cannot read a shelf keeps the map and the item cache as they stood", async () => {
  reset();
  const packed = skill("tracking", [1, 10], [5, 6]);
  const pack = worldPack(() => [packed]);
  game.packs.push(pack);
  await refreshLadders();
  assert.equal(importedSkillFor("tracking").item, packed);
  pack.failIndex = true;
  await withWarnings(() => refreshLadders());
  assert.equal(importedSkillFor("tracking").item, packed, "the item cache stands");
  assert.equal(importedLadderFor("tracking", null).breakpoints[0].value, 10, "the map stands");
});

await ok("a world pack of fifty abilities holding three skills is read by one id query of exactly the three, never a whole-shelf load", async () => {
  reset();
  queries.length = 0;
  const skills = [skill("climbing", [1, 9]), skill("hiding", [1, 8]), skill("tracking", [1, 7])];
  const others = Array.from({ length: 46 }, (_, n) => item(`Other ${n}`, { id: `def.ability.other${n}` }));
  const gear = { ...item("Gear", { id: "def.skill.gear", rolls: [throwOf("t", ladder([1, 5]))] }), type: "equipment" };
  const pack = worldPack(() => [...others.slice(0, 20), skills[0], ...others.slice(20, 30), skills[1], gear, ...others.slice(30), skills[2]]);
  game.packs.push(pack);
  await refreshLadders();
  assert.deepEqual(queries, [{ _id__in: skills.map((s) => s.id) }]);
  assert.deepEqual(skillLadderRungs("hiding").map((r) => r.value), [8]);
  assert.equal(importedLadderFor("gear", null), null, "a stamped document of another type is not a skill");
});

/* --- the cache under a burst of item writes ---------------------------------- */
// A pack whose reads are counted and take a moment; the item hooks fire as core fires them.
const fire = (hook, doc) => { for (const fn of handlers[hook] ?? []) fn(doc, {}, {}, "u1"); };
const QUIET = LADDER_REFRESH_QUIET_MS ?? 1000;
let shelf = [];

await ok("the hooks are set once and the settled cache holds the shelf", async () => {
  reset();
  shelf = [skill("sneaking", [1, 10], [5, 6])];
  game.packs.push(worldPack(() => [...shelf]));
  initLadders();
  await wait(QUIET + 300);
  assert.equal(importedLadderFor("sneaking", null).breakpoints[0].value, 10);
});

await ok("a burst of changes to an actor's own copies reads no pack", async () => {
  indexReads = 0;
  const owner = actorOf([]);
  for (let n = 0; n < 60; n++) {
    fire("updateItem", { ...skill("sneaking", [1, 9]), parent: owner });
    await wait(2);
  }
  await wait(QUIET + 300);
  assert.equal(indexReads, 0, `reads ${indexReads}`);
});

await ok("a burst of changes to library items reads the packs once, after it ends, and loads no whole shelf", async () => {
  indexReads = 0;
  queries.length = 0;
  for (let n = 0; n < 60; n++) {
    fire("updateItem", shelf[0]);
    await wait(2);
  }
  assert.equal(indexReads, 0, "nothing is read while the burst runs");
  await wait(QUIET + 300);
  assert.equal(queries.filter((query) => !query?._id__in).length, 0, "no bare getDocuments");
  assert.equal(queries.length, 0, "the skill the pack holds is held already, so the read asks the server for nothing");
  assert.equal(indexReads, 1, `reads ${indexReads}`);
});

await ok("a change that lands while a read is in flight is read afterwards", async () => {
  readDelay = 60;
  fire("updateItem", shelf[0]);
  duringRead = () => {
    shelf = [skill("sneaking", [1, 4])];
    setTimeout(() => fire("updateItem", shelf[0]), 10);
  };
  await wait(QUIET + 60 + QUIET + 500);
  readDelay = 5;
  assert.equal(importedLadderFor("sneaking", null).breakpoints[0].value, 4);
});

await ok("a slow read that began first never overwrites the map a later read built", async () => {
  shelf = [skill("sneaking", [1, 7])];
  loadDelays.push(80, 5);
  const slow = refreshLadders();
  await wait(30);
  shelf = [skill("sneaking", [1, 3])];
  await refreshLadders();
  await slow;
  assert.equal(importedLadderFor("sneaking", null).breakpoints[0].value, 3);
});

await ok("a deleted library skill stops answering once the quiet window has passed", async () => {
  const gone = shelf[0];
  shelf = [];
  fire("deleteItem", gone);
  await wait(QUIET + 300);
  assert.equal(importedLadderFor("sneaking", null), null);
});

await ok("an open actor sheet redraws once when a read changes the ladders, and not when it changes nothing", async () => {
  let renders = 0;
  let itemRenders = 0;
  const sheet = { rendered: true, document: { documentName: "Actor" }, render() { renders++; } };
  const other = { rendered: true, document: { documentName: "Item" }, render() { itemRenders++; } };
  globalThis.foundry.applications.instances = new Map([["a", sheet], ["b", other]]);
  shelf = [skill("climbing", [1, 6], [7, 0])];
  await refreshLadders();
  assert.equal(renders, 1, `renders ${renders}`);
  await refreshLadders();
  assert.equal(renders, 1, "an unchanged read redraws nothing");
  assert.equal(itemRenders, 0, "only actor sheets redraw");
  delete globalThis.foundry.applications.instances;
});

console.log(`\n${passed} passed`);
process.exit(0);
