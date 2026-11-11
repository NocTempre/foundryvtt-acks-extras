/**
 * What a character's other abilities do to an ability's throw
 * (`throwModifiers` and `modifiesParts` in scripts/abilities/ability-rolls.mjs).
 *
 * Stand-in actors and items; every figure is invented. What this pins: a
 * `modifies` row acts on any ability that provides a capability it names, by
 * what the subject provides and never by its name; a row whose `ifHas` the
 * character does not hold does nothing; two bonuses that share a capability do
 * not stack and the larger applies; a replace row, an enemy-side row and a row
 * scoped to another throw are left out; a bonus a throw cannot take is returned
 * for display and not applied; and the parts name each ability and its page.
 * Rolling and the surfaces that print the parts are the live walk's
 * (docs/formation/TESTING.md).
 */
import assert from "node:assert/strict";
import fs from "node:fs";

let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

const LANG = JSON.parse(fs.readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
const format = (key, data = {}) => String(LANG[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(data[name] ?? ""));

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

const { throwModifiers, modifiesParts } = await import("../scripts/abilities/ability-rolls.mjs");

/* --- fixtures ---------------------------------------------------------------- */
let serial = 0;
/** An ability: its name, what it provides, the rows it carries, its cookbook stamp. */
function item(name, { provides = [], effects = [], id = "", cite = "", rolls = [] } = {}) {
  const flags = { "acks-extras": { extras: { rolls, effects, provides }, cookbook: id || cite ? { id, cite } : undefined } };
  return { id: `i${++serial}`, type: "ability", name, system: {}, flags, getFlag: (scope, key) => flags[scope]?.[key] };
}
/** A character at `level` holding `items`. */
function actor(items, level = 3) {
  const a = { id: `a${++serial}`, name: "Tester", system: { details: { level } }, items };
  for (const i of items) i.actor = a;
  return a;
}
/** A `modifies` row on the proficiency throw. */
const row = (refs, flat, extra = {}) => ({ type: "modifies", target: "proficiencyThrow", mode: "add", refs, value: { flat }, ...extra });
const SEARCHING = () => item("Searching", { provides: ["kw:searching"], cite: "XX p.9" });
const labels = (parts) => parts.map((p) => [p.label, p.value]);

/* ---------------------------------------------------------------------------- */

await ok("a row acts on an ability by the capability it provides, whatever the ability is called", async () => {
  const bonus = item("Keen Eyes", { effects: [row(["kw:searching"], 2)], cite: "XX p.1" });
  const renamed = item("My Own Spotting", { provides: ["kw:searching"] });
  const stamped = item("Anything", { id: "def.prof.searching" });
  const other = item("Climbing", { id: "def.prof.climbing" });
  const a = actor([bonus, renamed, stamped, other]);
  assert.deepEqual(labels(throwModifiers(a, renamed).parts), [["Keen Eyes", 2]], "by a provided capability");
  assert.deepEqual(labels(throwModifiers(a, stamped).parts), [["Keen Eyes", 2]], "by the capability its cookbook id names");
  assert.deepEqual(throwModifiers(a, other).parts, [], "an unrelated ability is left alone");
  assert.equal(throwModifiers(a, renamed).bonus, 2);
  assert.equal(throwModifiers(a, renamed).parts[0].cite, "XX p.1", "the part carries the page of the ability that gives it");
});

await ok("a row whose ifHas the character does not hold does nothing, and one it holds acts", async () => {
  const needs = item("Keen Eyes", { effects: [row(["kw:searching"], 2, { ifHas: ["kw:searching"] })] });
  const searching = SEARCHING();
  assert.equal(throwModifiers(actor([needs, searching]), searching).bonus, 2, "the skill is held");
  const lacking = item("Other Search", { provides: ["kw:searching"] });
  const noNeed = item("Keen Eyes", { effects: [row(["kw:searching"], 2, { ifHas: ["kw:listening"] })] });
  assert.equal(throwModifiers(actor([noNeed, lacking]), lacking).bonus, 0, "an ifHas nothing satisfies");
  const both = item("Keen Eyes", { effects: [row(["kw:searching"], 2, { ifHas: ["kw:searching", "kw:listening"] })] });
  assert.equal(throwModifiers(actor([both, searching]), searching).bonus, 0, "every ifHas must be held");
});

await ok("two bonuses sharing a capability do not stack, the larger applies; unrelated ones add", async () => {
  const small = item("Keen Eyes", { provides: ["kw:alertness"], effects: [row(["kw:searching"], 1)] });
  const large = item("Sharp Senses", { provides: ["kw:alertness"], effects: [row(["kw:searching"], 3)] });
  const unrelated = item("Trapfinding", { effects: [row(["kw:searching"], 2)] });
  const searching = SEARCHING();
  const out = throwModifiers(actor([small, large, unrelated, searching]), searching);
  assert.deepEqual(labels(out.parts).sort(), [["Sharp Senses", 3], ["Trapfinding", 2]]);
  assert.equal(out.bonus, 5);
  const dropped = modifiesParts(actor([small, large, searching]), { id: null, provides: ["kw:searching"] }).dropped;
  assert.deepEqual(dropped.map((d) => [d.label, d.yieldsTo]), [["Keen Eyes", "Sharp Senses"]], "the loser is named with what it yielded to");
});

await ok("notStacksWith keeps two abilities from adding, and stacksWith lets them", async () => {
  const a1 = item("Keen Eyes", { id: "def.prof.keeneyes", effects: [row(["kw:searching"], 2, { notStacksWith: ["def.prof.trapfinding"] })] });
  const a2 = item("Trapfinding", { id: "def.prof.trapfinding", effects: [row(["kw:searching"], 3)] });
  const searching = SEARCHING();
  assert.deepEqual(labels(throwModifiers(actor([a1, a2, searching]), searching).parts), [["Trapfinding", 3]]);
  const b1 = item("Keen Eyes", { provides: ["kw:alertness"], effects: [row(["kw:searching"], 2, { stacksWith: ["def.prof.trapfinding"] })] });
  const b2 = item("Trapfinding", { id: "def.prof.trapfinding", provides: ["kw:alertness"], effects: [row(["kw:searching"], 3)] });
  assert.equal(throwModifiers(actor([b1, b2, searching]), searching).bonus, 5, "named as stacking, so the shared capability does not drop one");
});

await ok("a replace row, an enemy-side row and a row for another throw are left out", async () => {
  const searching = SEARCHING();
  const replace = item("Replacer", { effects: [row(["kw:searching"], 4, { mode: "replace" })] });
  const enemy = item("Hexer", { effects: [row(["kw:searching"], -4, { appliesTo: "enemies" })] });
  const scoped = item("Hasty Eyes", { effects: [row(["kw:searching"], 2, { appliesToRoll: "hasty" })] });
  const a = actor([replace, enemy, scoped, searching]);
  assert.equal(throwModifiers(a, searching).bonus, 0, "with no throw named a scoped row is not in the unscoped total");
  assert.equal(throwModifiers(a, searching, { key: "methodical" }).bonus, 0);
  assert.deepEqual(labels(throwModifiers(a, searching, { key: "hasty" }).parts), [["Hasty Eyes", 2]]);
});

await ok("a bonus value is read at the character's level where it is a ladder", async () => {
  globalThis.acksExtras = { lib: { resolveLevelValue: (value, level) => (value?.breakpoints ? [...value.breakpoints].reverse().find((b) => level >= b.atLevel)?.value ?? null : (value?.flat ?? null)) } };
  try {
    const grows = item("Keen Eyes", { effects: [{ ...row(["kw:searching"], 0), value: { breakpoints: [{ atLevel: 1, value: 1 }, { atLevel: 5, value: 2 }] } }] });
    const searching = SEARCHING();
    assert.equal(throwModifiers(actor([grows, searching], 3), searching).bonus, 1);
    assert.equal(throwModifiers(actor([grows, searching], 6), searching).bonus, 2);
  } finally {
    delete globalThis.acksExtras;
  }
});

await ok("a second copy of an ability is rank, not a second bonus", async () => {
  const one = item("Keen Eyes", { effects: [row(["kw:searching"], 2)] });
  const two = item("Keen Eyes", { effects: [row(["kw:searching"], 2)] });
  const searching = SEARCHING();
  assert.equal(throwModifiers(actor([one, two, searching]), searching).bonus, 2);
});

await ok("a subject the character is figured for without holding the skill drops the rows that need it", async () => {
  const needs = item("Sharp Senses", { effects: [row(["kw:searching"], 2, { ifHas: ["kw:searching"] })] });
  const free = item("Eyes For Traps", { effects: [row(["kw:searching"], 1)] });
  const subject = { id: null, provides: ["kw:searching"] };
  const a = actor([needs, free]);
  assert.deepEqual(labels(modifiesParts(a, subject, { unskilled: true }).kept), [["Eyes For Traps", 1]]);
  assert.deepEqual(labels(modifiesParts(a, subject).kept), [["Eyes For Traps", 1]], "the skill is not among the abilities held, so its ifHas fails either way");
});

await ok("a conditioned modifier that names the activity is pending, an unconditioned one applies", async () => {
  const conditioned = item("Careful Eyes", { effects: [{ type: "modifier", target: "proficiencyThrow", forWhat: "Searching", value: { flat: 2 }, condition: "in a dim place" }] });
  const plain = item("Sharp Eyes", { effects: [{ type: "modifier", target: "proficiencyThrow", forWhat: "Searching and Listening", value: { flat: 1 } }] });
  const searching = item("Searching", { provides: ["kw:searching"] });
  const out = throwModifiers(actor([conditioned, plain, searching]), searching);
  assert.equal(out.bonus, 1);
  assert.deepEqual(out.pending, [{ name: "Careful Eyes", amount: 2, condition: "in a dim place" }]);
});

console.log(`\n${passed} passed`);
