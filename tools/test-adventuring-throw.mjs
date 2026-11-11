/**
 * The Adventuring throw's target (scripts/abilities/adventuring-throw.mjs) and
 * the Rolls tab's Adventuring group built on it (scripts/character-sheet/rolls.mjs).
 *
 * Stand-in actors and items; every figure is invented. What this pins: the
 * figure is the better of the stored field and the held skill's throw at the
 * character's level, a tie stays stored, keys with no skill stay stored, the
 * Adventuring proficiency's own throws never stand in for a skill, the
 * creature's conditions are left out of the figure (the throw's wrapper
 * applies them once), and the group lists a skill throw it stands for once.
 * The roll itself, and what a seat sees, are the live walk's
 * (docs/character-sheet/TESTING.md).
 */
import assert from "node:assert/strict";
import fs from "node:fs";

let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

/* --- the real strings, so a key that does not exist fails here ------------- */
const LANG = JSON.parse(fs.readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
const format = (key, data = {}) => {
  const text = LANG[key];
  assert.equal(typeof text, "string", `lang key ${key} exists`);
  return text.replace(/\{(\w+)\}/g, (_, name) => String(data[name] ?? ""));
};

class Stub {}
globalThis.game = {
  user: { id: "u1", isGM: true },
  i18n: { localize: (k) => LANG[k] ?? k, format, has: (k) => k in LANG },
  settings: { get: () => ({}) },
  actors: new Map(),
  items: [],
};
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.Hooks = { on() {}, once() {}, off() {}, call() {}, callAll() {} };
globalThis.foundry = {
  abstract: { DataModel: class {}, TypeDataModel: class {} },
  data: { regionBehaviors: { RegionBehaviorType: Stub }, fields: {} },
  utils: { escapeHTML: (s) => String(s), deepClone: (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v))) },
  applications: { api: { ApplicationV2: Stub, HandlebarsApplicationMixin: (B) => B, DialogV2: Stub }, handlebars: { renderTemplate: async () => "" } },
};

const { adventuringThrow, adventuringSkillThrow, ADVENTURING_SKILLS } = await import("../scripts/abilities/adventuring-throw.mjs");
const { registerTable, unregisterTable, PRIORITY } = await import("../scripts/lib/tables.mjs");
const { CONDITIONS_DOC, CONDITIONS_TABLE } = await import("../scripts/lib/conditions.mjs");

/* --- fixtures ---------------------------------------------------------------- */
/** A level ladder: `[atLevel, value]` pairs. */
const ladder = (...pairs) => ({ kind: "breakpoints", breakpoints: pairs.map(([atLevel, value]) => ({ atLevel, value })) });
/** A throw as an ability stores it. */
const throwOf = (key, target, extra = {}) => ({ key, label: key, formula: "1d20", rollType: "above", target, scale: "level", ...extra });
let serial = 0;
/** An ability item: its name, the throws it stores, the capability ids it declares. */
function item(name, rolls, { provides = [], id = `i${++serial}`, cite = "" } = {}) {
  const flags = { "acks-extras": { extras: { rolls, effects: [], provides }, cookbook: cite ? { cite } : undefined } };
  return { id, type: "ability", name, system: {}, flags, getFlag: (scope, key) => flags[scope]?.[key] };
}
/** A character at `level` holding `items`, with the stored Adventuring figures. */
function actor(level, items, stored = { dungeonbashing: 17, climb: 7, listening: 17, searching: 17, trapbreaking: 17 }) {
  const a = { id: `a${++serial}`, name: "Tester", system: { details: { level }, adventuring: { ...stored } }, items, statuses: new Set(), appliedEffects: [] };
  for (const i of items) i.actor = a;
  return a;
}
const SEARCH = (extra = {}) => item("Searching", [throwOf("hasty", ladder([1, 15], [3, 13])), throwOf("methodical", ladder([1, 14], [3, 11]))], { provides: ["kw:searching"], cite: "XX p.9", ...extra });

/* ---------------------------------------------------------------------------- */

await ok("the skill's throw at the character's level beats the stored figure, and moves with the level", async () => {
  const skill = SEARCH();
  const found = adventuringThrow(actor(3, [skill]), "searching");
  assert.equal(found.target, 11);
  assert.equal(found.source, "skill");
  assert.equal(found.skillName, "Searching");
  assert.equal(found.cite, "XX p.9");
  assert.equal(found.other, 17, "the stored figure is the one that lost");
  assert.deepEqual(found.backs, { itemId: skill.id, rollKey: "methodical" });
  assert.equal(adventuringThrow(actor(1, [SEARCH()]), "searching").target, 14, "level 1 reads the ladder's first rung");
});

await ok("the hasty throw is not the Adventuring search: the methodical one answers", async () => {
  const found = adventuringThrow(actor(3, [SEARCH()]), "searching");
  assert.equal(found.backs.rollKey, "methodical");
  assert.notEqual(found.target, 13);
});

await ok("a stored figure the Judge made better stays, and the skill is named as the other", async () => {
  const found = adventuringThrow(actor(3, [SEARCH()], { searching: 9 }), "searching");
  assert.deepEqual([found.target, found.source, found.other, found.skillName], [9, "stored", 11, "Searching"]);
  assert.ok(found.backs, "the skill throw is still the one the row stands for");
});

await ok("a tie stays the stored figure", async () => {
  const found = adventuringThrow(actor(3, [SEARCH()], { searching: 11 }), "searching");
  assert.deepEqual([found.target, found.source], [11, "stored"]);
});

await ok("a key with no skill held, or no skill throw at all, is the stored figure", async () => {
  const a = actor(3, [SEARCH()]);
  for (const key of ["climb", "dungeonbashing"]) {
    assert.equal(ADVENTURING_SKILLS[key], undefined);
    const found = adventuringThrow(a, key);
    assert.deepEqual([found.target, found.source, found.backs, found.skillName, found.other], [a.system.adventuring[key], "stored", null, undefined, null]);
  }
  const none = adventuringThrow(actor(3, []), "searching");
  assert.deepEqual([none.target, none.source, none.backs], [17, "stored", null]);
});

await ok("a skill with no methodical throw backs nothing", async () => {
  const hastyOnly = item("Searching", [throwOf("hasty", ladder([1, 10]))], { provides: ["kw:searching"] });
  const found = adventuringThrow(actor(3, [hastyOnly]), "searching");
  assert.deepEqual([found.source, found.backs], ["stored", null]);
});

await ok("the Adventuring proficiency's own throws never stand in for a skill", async () => {
  const adventuring = item("Adventuring", [throwOf("searching", { kind: "flat", flat: 2 })], { provides: ["kw:searching"] });
  const found = adventuringThrow(actor(3, [adventuring]), "searching");
  assert.deepEqual([found.target, found.source, found.backs], [17, "stored", null]);
});

await ok("a skill with one throw and no key answers listening, a measure ahead of it is skipped", async () => {
  const measure = throwOf("m", { kind: "flat", flat: 0 }, { rollType: "measure" });
  const skill = item("Listening", [measure, throwOf("throw1", ladder([1, 14], [3, 12]))], { provides: ["kw:listening"] });
  const found = adventuringThrow(actor(3, [skill]), "listening");
  assert.deepEqual([found.target, found.source, found.backs.rollKey], [12, "skill", "throw1"]);
});

await ok("of several skills the best throw answers", async () => {
  const worse = item("Hear Noise", [throwOf("throw1", { kind: "flat", flat: 14 })], { provides: ["kw:listening"] });
  const better = item("Listening", [throwOf("throw1", ladder([1, 13], [3, 10]))], { provides: ["kw:listening"] });
  const found = adventuringSkillThrow(actor(3, [worse, better]), "listening");
  assert.deepEqual([found.target, found.name], [10, "Listening"]);
});

await ok("a throw that is not roll-or-higher, or has no figure, is not a skill figure", async () => {
  const below = item("Searching", [throwOf("methodical", { kind: "flat", flat: 4 }, { rollType: "below" })], { provides: ["kw:searching"] });
  assert.equal(adventuringThrow(actor(3, [below]), "searching").source, "stored");
  const unresolved = item("Searching", [throwOf("methodical", ladder([1, 9]), { scale: "scaleNothingSupplies" })], { provides: ["kw:searching"] });
  assert.equal(adventuringThrow(actor(3, [unresolved]), "searching").source, "stored", "a scale nothing here supplies is not a figure");
});

await ok("with no stored figure the skill's stands alone, and with neither there is no target", async () => {
  const solo = adventuringThrow(actor(3, [SEARCH()], { searching: "" }), "searching");
  assert.deepEqual([solo.target, solo.source, solo.other], [11, "skill", null]);
  const nothing = adventuringThrow(actor(3, [], { searching: undefined }), "searching");
  assert.deepEqual([nothing.target, nothing.source], [null, "stored"]);
});

await ok("the creature's conditions are left out of the figure", async () => {
  registerTable({ id: CONDITIONS_DOC, source: "invented", tables: { [CONDITIONS_TABLE]: { queasy: { all: -4 } } } }, { priority: PRIORITY.WORLD, source: "test" });
  try {
    const a = actor(3, [SEARCH()]);
    const before = adventuringThrow(a, "searching").target;
    a.statuses = new Set(["queasy"]);
    a.appliedEffects = [{ statuses: ["queasy"], flags: {} }];
    assert.equal(adventuringThrow(a, "searching").target, before, "the wrapper applies them, once, when the throw is rolled");
  } finally {
    unregisterTable(CONDITIONS_DOC, "test");
  }
});

/* --- the Rolls tab's group ---------------------------------------------------- */
const { rollInventory } = await import("../scripts/character-sheet/rolls.mjs");

/** The stand-ins the group's other halves read: no weapons, no pins. */
function sheetActor(level, items, stored) {
  const a = actor(level, items, stored);
  Object.assign(a.system, { saves: {}, attack: { throw: 10 }, hp: {}, details: { level, morale: 0 }, surprise: {}, initiative: {} });
  a.type = "character";
  a.getFlag = () => undefined;
  a.items = Object.assign([...items], { filter: Array.prototype.filter, get: (id) => items.find((i) => i.id === id) });
  return a;
}
const rows = (inv, key) => inv.groups.find((g) => g.key === key)?.rows ?? [];

await ok("the Adventuring group reads the better figure, names its source and carries a tooltip", async () => {
  const inv = rollInventory(sheetActor(3, [SEARCH()]));
  const search = rows(inv, "adventuring").find((r) => r.id === "adv:searching");
  assert.equal(search.value, "11+");
  assert.equal(search.line, "Searching");
  assert.equal(search.tip, "11+ from Searching (XX p.9), the better of the two. The figure stored on the sheet is 17+.");
  const climb = rows(inv, "adventuring").find((r) => r.id === "adv:climb");
  assert.equal(climb.value, "7+");
  assert.equal(climb.line, "");
  assert.equal(climb.tip, "7+, the figure stored on the sheet. Edit it on the Stats tab.");
});

await ok("a stored figure that wins says so and names the skill's", async () => {
  const search = rows(rollInventory(sheetActor(3, [SEARCH()], { searching: 9 })), "adventuring").find((r) => r.id === "adv:searching");
  assert.equal(search.value, "9+");
  assert.equal(search.tip, "9+, the figure stored on the sheet, the better of the two. Searching (XX p.9) is 11+.");
});

await ok("the skill's methodical throw is listed once, the hasty one stays in the proficiencies", async () => {
  const skill = SEARCH();
  const inv = rollInventory(sheetActor(3, [skill]));
  const ids = rows(inv, "proficiencies").map((r) => r.id);
  assert.deepEqual(ids, [`abl:${skill.id}:hasty`]);
  assert.equal(inv.ids.includes(`abl:${skill.id}:methodical`), false);
  assert.equal(inv.ids.includes("adv:searching"), true);
});

await ok("a skill whose only throw backs a row leaves the proficiencies and does not become a post-to-chat row", async () => {
  const listening = item("Listening", [throwOf("throw1", ladder([1, 14], [3, 12]))], { provides: ["kw:listening"] });
  const inv = rollInventory(sheetActor(3, [listening]));
  assert.equal(rows(inv, "proficiencies").length, 0);
  assert.equal(rows(inv, "post").length, 0);
});

console.log(`\n${passed} passed`);
