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
const { importedLadderFor, skillLadderRungs, refreshLadders, initLadders, LADDER_REFRESH_QUIET_MS } = await import("../scripts/abilities/skill-ladders.mjs");
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

await ok("a skill held in a world pack answers after the cache loads, and a cold cache answers nothing", async () => {
  reset();
  const packed = skill("sneaking", [1, 10], [5, 6]);
  game.packs.push({ documentName: "Item", collection: "world.skills", metadata: { packageType: "world" }, getDocuments: async () => [packed] });
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

/* --- the cache under a burst of item writes ---------------------------------- */
// A pack whose reads are counted and take a moment; the item hooks fire as core fires them.
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fire = (hook, doc) => { for (const fn of handlers[hook] ?? []) fn(doc, {}, {}, "u1"); };
const QUIET = LADDER_REFRESH_QUIET_MS ?? 1000;
let reads = 0;
let readDelay = 5;
let shelf = [];
let duringRead = null;
const delays = [];

await ok("the hooks are set once and the settled cache holds the shelf", async () => {
  reset();
  shelf = [skill("sneaking", [1, 10], [5, 6])];
  game.packs.push({
    documentName: "Item", collection: "world.skills", metadata: { packageType: "world" },
    getDocuments: async () => {
      reads++;
      const now = [...shelf];
      const hook = duringRead;
      duringRead = null;
      if (hook) hook();
      await wait(delays.shift() ?? readDelay);
      return now;
    },
  });
  initLadders();
  await wait(QUIET + 300);
  assert.equal(importedLadderFor("sneaking", null).breakpoints[0].value, 10);
});

await ok("a burst of changes to an actor's own copies reads no pack", async () => {
  reads = 0;
  const owner = actorOf([]);
  for (let n = 0; n < 60; n++) {
    fire("updateItem", { ...skill("sneaking", [1, 9]), parent: owner });
    await wait(2);
  }
  await wait(QUIET + 300);
  assert.equal(reads, 0, `reads ${reads}`);
});

await ok("a burst of changes to library items reads the packs once, after it ends", async () => {
  reads = 0;
  for (let n = 0; n < 60; n++) {
    fire("updateItem", shelf[0]);
    await wait(2);
  }
  assert.equal(reads, 0, "nothing is read while the burst runs");
  await wait(QUIET + 300);
  assert.equal(reads, 1, `reads ${reads}`);
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
  delays.push(80, 5);
  const slow = refreshLadders();
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

console.log(`\n${passed} passed`);
process.exit(0);
