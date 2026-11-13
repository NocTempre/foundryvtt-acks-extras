/**
 * One throw, one figure: the party check (`resolveCheck` in
 * scripts/formation/party-rolls.mjs), the Rolls tab's rows
 * (`rollInventory` in scripts/character-sheet/rolls.mjs), the skill sheet's
 * row (`throwText`/`throwOutcome` in scripts/abilities/ability-rolls.mjs, the
 * readings `_prepareContext` prints) and the Adventuring throw
 * (scripts/abilities/adventuring-throw.mjs) read the same number for the same
 * character.
 *
 * Stand-in actors and items; every ladder, figure and name is invented, and no
 * book is imported. What this pins: a held skill reads one figure on every
 * surface; an ability that stands in for the stored Adventuring figure is
 * read the same by the party check and the Rolls tab; an item that only
 * carries a printed ability's name gives nothing; a throw bound to a check by
 * a flag is the check's figure with no part; a throw naming a ladder nothing
 * registers shows no figure and is passed over for the Adventuring one; a
 * condition moves the party's target once, and the Adventuring row stays the
 * figure before conditions; the disarm dialog's two checks resolve through the
 * same function; `rollPartyCheck` posts one Judge-whispered card. Rendering of
 * the windows and the audit's own roll are the live recipe's and
 * `test-skill-audit-roll.mjs` (docs/formation/TESTING.md).
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
const GM = { id: "gm1", isGM: true };
const GM2 = { id: "gm2", isGM: true };
const PLAYER = { id: "pl1", isGM: false };

const seen = { created: [], warned: [], dice: [] };
const dice = [];
const reset = () => {
  seen.created.length = 0;
  seen.warned.length = 0;
  seen.dice.length = 0;
  dice.length = 0;
};

class Stub {}
globalThis.game = {
  user: GM,
  users: [GM, GM2, PLAYER],
  i18n: { localize: (k) => (typeof lookup(k) === "string" ? lookup(k) : k), format, has: (k) => typeof lookup(k) === "string" },
  settings: { get: () => ({}) },
  dice3d: { showForRoll: async (...args) => { seen.dice.push(args); } },
  actors: new Map(),
  items: [],
};
globalThis.ui = { notifications: { info() {}, warn: (m) => seen.warned.push(m), error() {} } };
globalThis.Hooks = { on() {}, once() {}, off() {}, call() {}, callAll() {} };
globalThis.Roll = class {
  static validate() { return true; }
  constructor(formula) { this.formula = formula; }
  async evaluate() { this.total = dice.shift() ?? 10; return this; }
  async render() { return `<div class="dice-roll">${this.total}</div>`; }
  async toMessage() {}
};
globalThis.ChatMessage = {
  getSpeaker: ({ actor }) => ({ alias: actor?.name }),
  create: async (data) => { seen.created.push(data); return data; },
};
globalThis.foundry = {
  abstract: { DataModel: class {}, TypeDataModel: class {} },
  data: { regionBehaviors: { RegionBehaviorType: Stub }, fields: {} },
  utils: { escapeHTML: (s) => String(s), deepClone: (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v))) },
  applications: {
    api: { ApplicationV2: Stub, HandlebarsApplicationMixin: (B) => B, DialogV2: Stub },
    handlebars: { renderTemplate: async () => "<section>card</section>" },
  },
};

const { PARTY_CHECKS, resolveCheck, rollPartyCheck } = await import("../scripts/formation/party-rolls.mjs");
const { rollsOf, throwOutcome, throwText, defaultKeyOf, keyOf } = await import("../scripts/abilities/ability-rolls.mjs");
const { adventuringThrow } = await import("../scripts/abilities/adventuring-throw.mjs");
const { rollInventory } = await import("../scripts/character-sheet/rolls.mjs");
const { registerTable, unregisterTable, PRIORITY } = await import("../scripts/lib/tables.mjs");
const { CONDITIONS_DOC, CONDITIONS_TABLE } = await import("../scripts/lib/conditions.mjs");

/* --- fixtures ---------------------------------------------------------------- */
/** A level ladder: `[atLevel, value]` pairs. */
const ladder = (...pairs) => ({ kind: "breakpoints", breakpoints: pairs.map(([atLevel, value]) => ({ atLevel, value })) });
/** A throw as an ability stores it. */
const throwOf = (key, target, extra = {}) => ({ key, label: key, formula: "1d20", rollType: "above", target, scale: "level", ...extra });
const flat = (n) => ({ kind: "flat", flat: n });
let serial = 0;
/**
 * An ability item: its name, the throws it stores, the capability ids it
 * provides, the modifiers it carries; `flags` are this module's item flags
 * (`checkKey`, `targetMod`, `isSkill`, `cookbook`).
 */
function item(name, rolls, { provides = [], effects = [], cite = "", flags = {}, system = {} } = {}) {
  const scoped = { extras: { rolls, effects, provides }, ...(cite ? { cookbook: { cite } } : {}), ...flags };
  const all = { "acks-extras": scoped };
  return { id: `i${++serial}`, type: "ability", name, system, flags: all, getFlag: (scope, key) => all[scope]?.[key] };
}
const STORED = { listening: 19, searching: 19, trapbreaking: 19, climbing: 19, dungeonbashing: 19 };
/** A level 6 character holding `items`, with every Adventuring figure stored at 19, entered into the world. */
function member(name, items, { stored = STORED, level = 6, hp = 8 } = {}) {
  const a = {
    id: name, name, type: "character", img: `${name}.webp`, statuses: new Set(), appliedEffects: [],
    system: { details: { level, morale: 0 }, adventuring: { ...stored }, hp: { value: hp }, saves: {}, attack: { throw: 10 }, surprise: {}, initiative: {} },
    getFlag: () => undefined,
  };
  for (const i of items) i.actor = a;
  a.items = Object.assign([...items], { get: (id) => items.find((i) => i.id === id) });
  game.actors.set(name, a);
  return a;
}
const SEARCH = (extra = {}) => item("Probe Search", [throwOf("hasty", ladder([1, 15], [5, 12])), throwOf("methodical", ladder([1, 14], [5, 10]))], { provides: ["kw:searching"], cite: "XX p.9", ...extra });
const TRAPS = () => item("Probe Traps", [throwOf("hasty", ladder([1, 16], [5, 13])), throwOf("methodical", ladder([1, 15], [5, 11]))], { provides: ["kw:trapbreaking"], cite: "XX p.8" });
const LISTEN = () => item("Probe Listen", [throwOf("throw1", ladder([1, 14], [5, 11]))], { provides: ["kw:listening"], cite: "XX p.7" });
const STAND = (n) => item("Sharp Senses", [throwOf("searchListen", flat(n))], { provides: ["kw:alertness"], cite: "XX p.4" });
/** A bonus: it provides one capability and adds to throws naming another, when the character holds a third. */
const keen = (n = 2) => item("Keen Eyes", [], {
  provides: ["kw:alertness"],
  cite: "XX p.1",
  effects: [{ type: "modifies", target: "proficiencyThrow", refs: ["kw:searching"], ifHas: ["kw:searching"], mode: "add", value: { flat: n } }],
});

/** The leading integer of what a surface prints, or null. */
const int = (s) => { const m = /-?\d+/.exec(String(s ?? "")); return m ? Number(m[0]) : null; };
/** A throw as the Rolls tab lists it. */
const rowOf = (actor, id) => rollInventory(actor).groups.flatMap((g) => g.rows).find((r) => r.id === id);
/** One throw of one item as the skill sheet prints it: the figure and the throw's own target before conditions. */
const sheetOf = (actor, it, key) => {
  const roll = rollsOf(it).find((r, i) => keyOf(r, i) === key);
  return { figure: int(throwText(roll, actor, it)), before: throwOutcome(roll, actor, it, { conditions: false }).target };
};

/* ---------------------------------------------------------------------------- */

await ok("a held skill reads one figure on the party check, the Rolls tab, the skill sheet and the throw itself", async () => {
  const search = SEARCH();
  const traps = TRAPS();
  const a = member("Alder", [search, traps]);
  for (const [it, checkKey, key, expected] of [
    [search, "searchHasty", "hasty", 12],
    [traps, "trapbreakHasty", "hasty", 13],
    [search, "searchMethodical", "methodical", 10],
    [traps, "trapbreakMethodical", "methodical", 11],
  ]) {
    const party = resolveCheck(a, PARTY_CHECKS[checkKey]);
    const sheet = sheetOf(a, it, key);
    assert.equal(party.skilled, true, `${checkKey}: counted as skilled`);
    assert.equal(party.target, expected, `${checkKey}: the party figure`);
    assert.equal(sheet.figure, expected, `${checkKey}: the sheet's row`);
    assert.equal(sheet.before, party.target, `${checkKey}: the party figure is the throw's own, before conditions`);
    // A methodical throw is listed once, on the Adventuring row; the hasty one keeps its own.
    const row = key === "hasty" ? rowOf(a, `abl:${it.id}:hasty`) : rowOf(a, `adv:${checkKey === "searchMethodical" ? "searching" : "trapbreaking"}`);
    assert.equal(int(row.value), expected, `${checkKey}: the Rolls tab's row`);
  }
  const listen = LISTEN();
  const hears = member("Birch", [listen]);
  const heard = resolveCheck(hears, PARTY_CHECKS.listen);
  assert.deepEqual([heard.target, heard.skilled, sheetOf(hears, listen, "throw1").figure, int(rowOf(hears, "adv:listening").value)], [11, true, 11, 11]);
  assert.equal(rowOf(hears, "abl:" + listen.id + ":throw1"), undefined, "the throw behind the Adventuring row is not listed twice");
});

await ok("the Adventuring row is the party check's figure for a member who holds no skill, and the same function resolves the disarm dialog's two checks", async () => {
  const a = member("Cedar", []);
  for (const [key, advKey] of [["searchMethodical", "searching"], ["listen", "listening"]]) {
    const party = resolveCheck(a, PARTY_CHECKS[key]);
    assert.deepEqual([party.target, party.skilled, party.source.includes("Adventuring")], [19, false, true]);
    assert.equal(party.target, adventuringThrow(a, advKey).target);
    assert.equal(int(rowOf(a, `adv:${advKey}`).value), party.target);
  }
  // The dialog resolves trapbreakHasty / trapbreakMethodical for the member it names.
  const skilled = member("Dune", [TRAPS()]);
  assert.deepEqual([resolveCheck(skilled, PARTY_CHECKS.trapbreakHasty).target, resolveCheck(skilled, PARTY_CHECKS.trapbreakMethodical).target], [13, 11]);
  assert.equal(resolveCheck(a, PARTY_CHECKS.trapbreakHasty), null, "no hasty attempt without the skill");
  const methodical = resolveCheck(a, PARTY_CHECKS.trapbreakMethodical);
  assert.deepEqual([methodical.target, methodical.skilled, methodical.target === adventuringThrow(a, "trapbreaking").target], [19, false, true]);
});

await ok("an ability that stands in for the stored figure lowers it, and the party check and the Rolls tab read one figure", async () => {
  for (const key of ["listening", "searching"]) {
    const a = member("Elm", [STAND(14)]);
    const party = resolveCheck(a, PARTY_CHECKS[key === "listening" ? "listen" : "searchMethodical"]);
    const adv = adventuringThrow(a, key);
    assert.deepEqual([adv.source, adv.target, adv.standIn?.name, adv.standIn?.cite], ["standIn", 14, "Sharp Senses", "XX p.4"]);
    assert.ok(adv.target < STORED[key], "under the stored figure");
    assert.deepEqual([party.target, party.skilled, int(rowOf(a, `adv:${key}`).value)], [14, false, 14]);
    assert.ok(party.source.includes("Sharp Senses"), "the card's source names the stand-in");
  }
});

await ok("a bonus part names its ability and carries the page its import cites", async () => {
  const a = member("Fir", [SEARCH(), keen(2)]);
  const party = resolveCheck(a, PARTY_CHECKS.searchMethodical);
  assert.equal(party.target, 8, "10 less the bonus, once");
  assert.deepEqual(party.parts.map((p) => [p.label, p.value, p.cite]), [["Keen Eyes", 2, "XX p.1"]]);
});

await ok("an item that only carries a printed ability's name gives nothing", async () => {
  const named = member("Gum", [item("Alertness", [throwOf("searchListen", flat(10))], { system: { rollTarget: 10 } })]);
  const adv = adventuringThrow(named, "listening");
  assert.deepEqual([adv.source, adv.target], ["stored", STORED.listening], "no capability, no stand-in");
  const party = resolveCheck(named, PARTY_CHECKS.listen);
  assert.deepEqual([party.target, party.skilled, party.parts], [STORED.listening, false, []]);
  assert.equal(int(rowOf(named, "adv:listening").value), STORED.listening);
});

await ok("a flat throw bound to a check by a flag is the check's figure on every surface, with no part", async () => {
  const bound = item("Probe Bound", [throwOf("primary", flat(15), { label: "Search" })], { flags: { checkKey: "search" }, system: { rollTarget: 15 } });
  const a = member("Hazel", [bound]);
  const party = resolveCheck(a, PARTY_CHECKS.searchMethodical);
  assert.deepEqual([party.target, party.parts, party.skilled], [15, [], true]);
  assert.equal(resolveCheck(a, PARTY_CHECKS.searchHasty).target, 15, "the default throw answers a key the item lacks");
  const key = defaultKeyOf(bound);
  assert.equal(key, "primary");
  assert.equal(int(rowOf(a, `abl:${bound.id}:${key}`).value), 15, "the Rolls tab");
  assert.equal(sheetOf(a, bound, key).figure, 15, "the skill sheet");
});

await ok("a throw naming a ladder nothing registers shows no figure and is passed over for the Adventuring one", async () => {
  const lost = item("Probe Lost", [throwOf("primary", { kind: "progression", as: "probe", table: "unregisteredprobe" }, { label: "Listen" })], { flags: { checkKey: "listen" } });
  const a = member("Ivy", [lost]);
  const party = resolveCheck(a, PARTY_CHECKS.listen);
  assert.deepEqual([party.skilled, party.target], [false, STORED.listening], "the stored figure answers");
  assert.equal(int(rowOf(a, `abl:${lost.id}:primary`).value), null, "no figure on the Rolls tab");
  assert.equal(sheetOf(a, lost, "primary").figure, null, "no figure on the sheet");
});

await ok("a condition moves the party's target once and is named once; the Adventuring row stays the figure before conditions", async () => {
  registerTable({ id: CONDITIONS_DOC, source: "invented", tables: { [CONDITIONS_TABLE]: { queasy: { all: -4 } } } }, { priority: PRIORITY.WORLD, source: "test" });
  try {
    const search = SEARCH();
    const a = member("Juno", [search]);
    a.statuses = new Set(["queasy"]);
    a.appliedEffects = [{ statuses: ["queasy"], flags: {} }];
    const hasty = resolveCheck(a, PARTY_CHECKS.searchHasty);
    const sheet = sheetOf(a, search, "hasty");
    assert.equal(hasty.target, sheet.before + 4, "the throw's own, moved by exactly the condition");
    assert.deepEqual(hasty.parts.filter((p) => p.value === -4).length, 1, "named once");
    assert.equal(int(rowOf(a, `abl:${search.id}:hasty`).value), hasty.target, "the Rolls tab folds the condition in like the card");
    assert.equal(sheet.figure, hasty.target, "and so does the skill sheet");
    const methodical = resolveCheck(a, PARTY_CHECKS.searchMethodical);
    const before = sheetOf(a, search, "methodical").before;
    assert.equal(int(rowOf(a, "adv:searching").value), before, "the Adventuring row is the figure before conditions");
    assert.equal(methodical.target, before + 4, "and the card is that figure moved once");
  } finally {
    unregisterTable(CONDITIONS_DOC, "test");
  }
});

await ok("rolling the party's check posts one card whispered to the Judges, a row per member who can attempt it, each target with a tooltip", async () => {
  reset();
  member("Kay", [SEARCH()]);
  member("Lark", [SEARCH()]);
  member("Moss", []);
  const formation = { id: "f1", name: "The Company", members: ["Kay", "Lark", "Moss"].map((actorId) => ({ actorId })), stance: {}, clock: {} };
  dice.push(13, 9);
  const rolled = await rollPartyCheck(formation, "searchHasty", { spend: false });
  assert.equal(rolled, 2);
  assert.equal(seen.created.length, 1, "one message for the whole party");
  assert.deepEqual(seen.created[0].whisper, ["gm1", "gm2"]);
  const html = seen.created[0].content;
  const rows = html.match(/<tr class="is-(success|failure)">/g);
  assert.deepEqual(rows, ['<tr class="is-success">', '<tr class="is-failure">'], "13 meets a 12, 9 does not");
  assert.equal((html.match(/data-tooltip-text="Target 12\+: [^"]+"/g) ?? []).length, 2, "each target carries its source");
  assert.match(html, /Moss/, "a member with no skill is named in the footnote");
  assert.equal(html.includes("<td>Moss"), false, "and has no row");
});

await ok("a hurried party is refused the hasty search and posts no card", async () => {
  reset();
  member("Nox", [SEARCH()]);
  const formation = { id: "f2", name: "The Company", members: [{ actorId: "Nox" }], stance: { pace: "hurried" }, clock: {} };
  assert.equal(await rollPartyCheck(formation, "searchHasty", { spend: false }), 0);
  assert.equal(seen.created.length, 0);
  assert.equal(seen.warned.length, 1);
});

console.log(`\n${passed} passed`);
