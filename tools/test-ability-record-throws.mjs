/**
 * What a character's spell records do to a proficiency throw
 * (`throwOutcome`, `throwModifiers`, `evaluateThrow`, `grantedThrows` and
 * `rollGrantedThrow` in scripts/abilities/ability-rolls.mjs, read through lib's
 * `recordParts` / `throwResolution`).
 *
 * Stand-in actors, skills and spells; every name and figure is invented. What
 * this pins: a record's bonus moves the target the way the throw's type orients
 * it; two records of one kind leave the larger and the other is told as
 * yielding; a set figure is the target (even where it is worse than the
 * character's own, the better of two sets by the throw's type, and only the
 * conditions are added to it); an automatic part resolves with no roll; a part
 * scoped to one throw reaches that throw alone; a granted proficiency's throw
 * lists while its record lasts, with a blank figure where nothing is imported;
 * every figure's tooltip lists its parts; and every part is gone with its
 * record. Rolling on a real card and the sheet rows that list a grant are the
 * live walk's (docs/magic/TESTING.md).
 */
import assert from "node:assert/strict";
import fs from "node:fs";

let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

const LANG = JSON.parse(fs.readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
const ROOT = "ACKS-ABILITIES";
/** The two sentences a spell-made automatic throw and a granted throw's level need, until lang carries them. */
const OWN = {
  [`${ROOT}.roll.autoRecord`]: "Automatic through {spell}.",
  [`${ROOT}.roll.grantedAt`]: "Read at level {level}.",
};
const textOf = (key) => OWN[key] ?? LANG[key] ?? key;
const format = (key, data = {}) => String(textOf(key)).replace(/\{(\w+)\}/g, (_, name) => String(data[name] ?? ""));

class Stub {}
const posted = [];
globalThis.game = {
  user: { id: "u1", isGM: true },
  i18n: { localize: textOf, format, has: () => true },
  settings: { get: () => ({}) },
  actors: new Map(),
  items: [],
  packs: [],
};
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.Hooks = { on() {}, once() {}, off() {}, call() {}, callAll() {} };
globalThis.foundry = {
  abstract: { DataModel: class {}, TypeDataModel: class {} },
  data: { regionBehaviors: { RegionBehaviorType: Stub }, fields: {} },
  utils: { escapeHTML: (s) => String(s), deepClone: (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v))) },
  applications: { api: { ApplicationV2: Stub, HandlebarsApplicationMixin: (B) => B, DialogV2: Stub }, handlebars: { renderTemplate: async (_t, data) => JSON.stringify(data.result) } },
};
/** A die that always lands on `natural`, so a success reads from the target alone. */
let natural = 10;
globalThis.Roll = class {
  constructor(formula) { this.formula = formula; }
  static validate() { return true; }
  async evaluate() { this.total = natural; return this; }
  async render() { return "dice"; }
  async toMessage(data, options) { posted.push({ roll: this, data, options }); }
};
globalThis.ChatMessage = { getSpeaker: () => ({}), create: async (data, options) => { posted.push({ data, options }); } };

const { registerTable, unregisterTable, PRIORITY } = await import("../scripts/lib/tables.mjs");
const { CONDITIONS_DOC, CONDITIONS_TABLE } = await import("../scripts/lib/conditions.mjs");
const rolls = await import("../scripts/abilities/ability-rolls.mjs");
const { throwOutcome, throwText, throwModifiers, evaluateThrow, grantedThrows, rollGrantedThrow, throwProvenance, autoText } = rolls;

/* --- fixtures ---------------------------------------------------------------- */
let serial = 0;
const SHARED = "kw:spellrecord";
/** An ability: its name, cookbook id, what it provides and its throws. */
function item(name, { id = "", provides = [], rolls: list = [], cite = "" } = {}) {
  const flags = { "acks-extras": { extras: { rolls: list, effects: [], provides }, cookbook: id || cite ? { id, cite } : undefined } };
  return { id: `i${++serial}`, type: "ability", name, system: {}, flags, getFlag: (scope, key) => flags[scope]?.[key] };
}
/** A throw: the key, the type and a target. */
const throwOf = (key, target, over = {}) => ({ key, label: "", formula: "1d20", rollType: "above", scale: "level", condition: "", target, ...over });
const flat = (n) => ({ kind: "flat", flat: n });
const ladder = (...rungs) => ({ kind: "breakpoints", breakpoints: rungs.map(([atLevel, value]) => ({ atLevel, value })) });
/** A record's part. */
const part = (on, value, over = {}) => ({ key: `${on}${value}${serial++}`, on, value, provides: [SHARED], ...over });
/** An Active Effect carrying one spell record. */
const record = (label, parts, cite = "XX p.1") => ({
  id: `fx${++serial}`,
  disabled: false,
  statuses: [],
  flags: { "acks-extras": { rollMods: { id: `def.spell.${label.toLowerCase().replace(/\s+/g, "")}`, label, cite, sourceAlignment: "lawful", parts } } },
});
/** A character at `level` holding `items`, under `effects`. */
function actor(items, effects = [], level = 3) {
  const a = { id: `a${++serial}`, name: "Tester", img: "a.png", system: { details: { level } }, items, effects, appliedEffects: effects, statuses: new Set() };
  for (const i of items) i.actor = a;
  return a;
}
/** The invented skill every case reads. */
const LURKING = "def.skill.lurking";
const lurking = (target = flat(14), over = {}) => item("Lurking", { id: LURKING, cite: "XX p.9", rolls: [throwOf("throw1", target, over)] });
const REF = ["kw:lurking"];
const throwAt = (a, skill, index = 0) => throwOutcome(skill.getFlag("acks-extras", "extras").rolls[index], a, skill);

/* --- adding ------------------------------------------------------------------ */

await ok("a record's bonus changes the target, the way the throw's type orients it, and names its spell and page", async () => {
  const skill = lurking();
  const a = actor([skill], [record("Test Edge", [part("throw", 2, { ref: REF[0] })])]);
  const out = throwAt(a, skill);
  assert.equal(out.target, 12, "an above throw gets lower");
  assert.deepEqual(out.parts.map((p) => [p.kind, p.label, p.value, p.cite]), [["abilities", "Test Edge", 2, "XX p.1"]], "the spell and its page, never the cite doubled in the label");
  assert.equal(throwText(skill.getFlag("acks-extras", "extras").rolls[0], a, skill), "12+");
  assert.equal(throwModifiers(a, skill, skill.getFlag("acks-extras", "extras").rolls[0]).bonus, 2);
  const under = lurking(flat(5), { rollType: "below" });
  assert.equal(throwAt(actor([under], [record("Test Edge", [part("throw", 2, { ref: REF[0] })])]), under).target, 7, "a roll-under throw gets higher");
});

await ok("a part for another proficiency, or one scoped to another throw, leaves the target alone", async () => {
  const skill = item("Lurking", { id: LURKING, rolls: [throwOf("first", flat(14)), throwOf("second", flat(14))] });
  const a = actor([skill], [record("Other Edge", [part("throw", 3, { ref: "kw:other" })]), record("Test Edge", [part("throw", 2, { ref: REF[0], rollKey: "second" })])]);
  const [first, second] = skill.getFlag("acks-extras", "extras").rolls;
  assert.equal(throwOutcome(first, a, skill).target, 14, "the first throw is not the one named");
  assert.equal(throwOutcome(second, a, skill).target, 12, "the second throw is");
});

await ok("a throw with no stored key is reached by the roll<index> handle a part scopes itself to", async () => {
  const skill = item("Lurking", { id: LURKING, rolls: [throwOf("", flat(14))] });
  const a = actor([skill], [record("Test Edge", [part("throw", 2, { ref: REF[0], rollKey: "roll0" })])]);
  assert.equal(throwOutcome(skill.getFlag("acks-extras", "extras").rolls[0], a, skill).target, 12);
});

await ok("owner ruling: a second record of one kind leaves one figure, the larger, which stays until the last record ends", async () => {
  const skill = lurking();
  const big = record("Big Edge", [part("throw", 3, { ref: REF[0] })], "XX p.2");
  const small = record("Small Edge", [part("throw", 2, { ref: REF[0] })], "XX p.3");
  const a = actor([skill], [big, small]);
  const at = () => throwAt(a, skill);
  assert.equal(at().target, 11, "+3 and +2 leave +3");
  assert.deepEqual(at().record.dropped.map((p) => [p.label, p.value, p.yieldsTo]), [["Small Edge", 2, "Big Edge (XX p.2)"]], "the smaller is told as yielding");
  a.appliedEffects = [small];
  assert.equal(at().target, 12, "the larger ends and the smaller stands");
  a.appliedEffects = [];
  assert.equal(at().target, 14, "the last ends and the figure is the character's own");
  assert.equal(at().record, undefined, "and the verdict names no record");
});

/* --- setting ----------------------------------------------------------------- */

await ok("a set part is the target, even where it is worse than the character's own, with nothing added but conditions", async () => {
  const skill = lurking(flat(14), { score: undefined });
  const roll = skill.getFlag("acks-extras", "extras").rolls[0];
  const worse = actor([skill], [record("Set Edge", [part("throw", 16, { ref: REF[0], mode: "set" }), part("throw", 2, { ref: REF[0] })])]);
  const out = throwOutcome(roll, worse, skill);
  assert.equal(out.target, 16, "the figure the spell sets, not the character's 14 and not 14 less a bonus");
  assert.deepEqual(out.record.set, { label: "Set Edge", cite: "XX p.1", value: 16 });
  assert.deepEqual(out.record.added, [], "a bonus does not stack on a set");
  assert.deepEqual(out.record.dropped.map((p) => [p.label, p.value, p.yieldsTo]), [["Set Edge", 2, "Set Edge (XX p.1)"]], "it is told as yielding to the set");
  assert.deepEqual(out.parts, [], "the parts reproduce the figure: the set alone");
  registerTable({ id: CONDITIONS_DOC, source: "invented", tables: { [CONDITIONS_TABLE]: { queasy: { all: -4 } } } }, { priority: PRIORITY.WORLD, source: "test" });
  try {
    worse.statuses = new Set(["queasy"]);
    worse.appliedEffects = [...worse.effects, { statuses: ["queasy"], flags: {} }];
    const sick = throwOutcome(roll, worse, skill);
    assert.equal(sick.target, 20, "the condition costs 4 on the set figure, as on any");
    assert.deepEqual(sick.parts.map((p) => [p.kind, p.value]), [["conditions", -4]]);
  } finally {
    unregisterTable(CONDITIONS_DOC, "test");
  }
});

await ok("two sets leave the better target for the throw's type: the lower to roll over, the higher to roll under", async () => {
  const records = () => [record("Low Set", [part("throw", 10, { ref: REF[0], mode: "set" })]), record("High Set", [part("throw", 13, { ref: REF[0], mode: "set" })])];
  const over = lurking();
  assert.equal(throwAt(actor([over], records()), over).target, 10);
  const under = lurking(flat(5), { rollType: "below" });
  const out = throwAt(actor([under], records()), under);
  assert.equal(out.target, 13);
  assert.deepEqual(out.record.dropped.map((p) => [p.label, p.value, p.set]), [["Low Set", 10, true]]);
});

/* --- automatic --------------------------------------------------------------- */

await ok("an automatic part resolves the throw with no roll, names its spell, and ends with its record", async () => {
  const skill = lurking();
  const roll = skill.getFlag("acks-extras", "extras").rolls[0];
  const fx = record("Auto Edge", [part("throw", null, { ref: REF[0], mode: "auto" })]);
  const a = actor([skill], [fx]);
  const out = throwOutcome(roll, a, skill);
  assert.deepEqual([out.outcome, out.target], ["auto", null]);
  assert.equal(throwText(roll, a, skill), textOf(`${ROOT}.roll.autoShort`));
  assert.equal(autoText(out), "Automatic through Auto Edge (XX p.1).");
  const ev = await evaluateThrow(skill, "throw1");
  assert.deepEqual([ev.outcome, ev.success, ev.evaluated], ["auto", true, null], "nothing is rolled");
  const other = item("Other", { id: "def.skill.other", rolls: [throwOf("throw1", flat(9))] });
  a.items.push(other);
  assert.equal(throwOutcome(other.getFlag("acks-extras", "extras").rolls[0], a, other).outcome, "throw", "another proficiency is not automatic");
  a.appliedEffects = [];
  assert.equal(throwOutcome(roll, a, skill).outcome, "throw", "gone with its record");
});

await ok("the clicked route posts an automatic throw's card with the spell that made it so, and rolls no dice", async () => {
  const skill = lurking();
  actor([skill], [record("Auto Edge", [part("throw", null, { ref: REF[0], mode: "auto" })])]);
  posted.length = 0;
  const res = await rolls.rollAbility(skill, "throw1", { skipDialog: true });
  assert.deepEqual([res.outcome, res.success, res.total], ["auto", true, null]);
  assert.equal(posted.length, 1, "one message");
  assert.equal(posted[0].roll, undefined, "no dice were rolled");
  assert.ok(posted[0].data.content.includes("Automatic through Auto Edge (XX p.1)."), posted[0].data.content);
});

await ok("evaluateThrow rolls against a set target and reports its base without the abilities' figures", async () => {
  natural = 11;
  const skill = lurking();
  const a = actor([skill], [record("Set Edge", [part("throw", 12, { ref: REF[0], mode: "set" }), part("throw", 2, { ref: REF[0] })])]);
  const ev = await evaluateThrow(skill, "throw1");
  assert.deepEqual([ev.outcome, ev.target, ev.base, ev.modifiers, ev.success], ["throw", 12, 12, [], false], "11 against 12+");
  natural = 12;
  assert.equal((await evaluateThrow(skill, "throw1")).success, true);
  void a;
});

/* --- tooltips ---------------------------------------------------------------- */

await ok("a throw a record moved carries a tooltip listing its parts; one it did not carries none", async () => {
  const skill = lurking();
  const roll = skill.getFlag("acks-extras", "extras").rolls[0];
  assert.equal(throwProvenance(roll, actor([skill]), skill), "", "nothing touched it: the surface keeps what it had");
  const a = actor([skill], [record("Big Edge", [part("throw", 3, { ref: REF[0] })], "XX p.2"), record("Small Edge", [part("throw", 2, { ref: REF[0] })], "XX p.3")]);
  assert.equal(throwProvenance(roll, a, skill), "Big Edge (XX p.2) +3 · Small Edge (XX p.3) +2, yielding to Big Edge (XX p.2)");
  const set = actor([skill], [record("Set Edge", [part("throw", 12, { ref: REF[0], mode: "set" })])]);
  assert.equal(throwProvenance(roll, set, skill), "Set Edge (XX p.1) = 12+");
  const auto = actor([skill], [record("Auto Edge", [part("throw", null, { ref: REF[0], mode: "auto" })])]);
  assert.equal(throwProvenance(roll, auto, skill), `Auto Edge (XX p.1) ${textOf(`${ROOT}.roll.autoShort`)}`);
});

await ok("the tag strip carries the tooltip as assembled text only where a record moved the figure", async () => {
  const registered = {};
  globalThis.libWrapper = { register: (_id, path, fn) => { registered[path] = fn; } };
  globalThis.CONFIG = { Item: { documentClass: { prototype: {} } } };
  const { registerRollWrap } = await import("../scripts/abilities/roll-wrap.mjs");
  assert.equal(registerRollWrap(), true);
  const getTags = registered["CONFIG.Item.documentClass.prototype.getTags"];
  const skill = lurking();
  const plain = getTags.call(skill, () => "");
  assert.ok(!plain.includes("data-tooltip-text"), "no record, no tooltip");
  actor([skill], [record("Test Edge", [part("throw", 2, { ref: REF[0] })])]);
  const tagged = getTags.call(skill, () => "");
  assert.ok(tagged.includes("data-tooltip-text='Test Edge (XX p.1) +2'"), tagged);
});

/* --- granted throws ---------------------------------------------------------- */

/** A grant that sets the throw's target; a blank figure (nothing imported) is still a set, with no value. */
const grant = (value, over = {}) => part("grant", value, { ref: LURKING, mode: "set", ...over });
const shelf = (...docs) => { game.items.length = 0; game.items.push(...docs); };

await ok("a grant lists a throw rolled against its set figure while the record lasts, and not once the bearer holds the skill", async () => {
  shelf(lurking(ladder([1, 14], [5, 10])));
  const fx = record("Grant Edge", [grant(12)]);
  const a = actor([], [fx]);
  const [g, ...rest] = grantedThrows(a);
  assert.equal(rest.length, 0);
  assert.deepEqual([g.id, g.ref, g.name, g.text, g.target, g.outcome], [`grant:${LURKING}:throw1`, LURKING, "Lurking", "12+", 12, "throw"]);
  assert.equal(g.tip, "Grant Edge (XX p.1) = 12+", "the spell, its page and the figure it sets");
  a.appliedEffects = [];
  assert.deepEqual(grantedThrows(a), [], "gone with its record");
  const holder = actor([lurking()], [fx]);
  assert.deepEqual(grantedThrows(holder), [], "a bearer who holds the skill needs no grant");
});

await ok("a blank set figure still lists the throw: no target, \"—\", and the spell's page alone as its tooltip", async () => {
  shelf(lurking(ladder([1, 14])));
  const a = actor([], [record("Blank Edge", [grant(null)], "XX p.7")]);
  const [g] = grantedThrows(a);
  assert.deepEqual([g.target, g.text, g.tip], [null, "—", "Blank Edge (XX p.7)"]);
  shelf();
  const [none] = grantedThrows(a);
  assert.deepEqual([none.name, none.target, none.text, none.tip], ["Blank Edge", null, "—", "Blank Edge (XX p.7)"], "nothing imported: the same, named for the spell");
  const noMode = actor([], [record("Plain Edge", [part("grant", null, { ref: LURKING })], "XX p.8")]);
  assert.deepEqual([grantedThrows(noMode)[0].target, grantedThrows(noMode)[0].text], [null, "—"], "a grant with no definition to read has no figure");
});

await ok("a grant with no mode is the definition's own throw, read at the grant's level with its parts", async () => {
  shelf(lurking(ladder([1, 14], [5, 10])));
  const at = { value: 5, parts: [{ label: "Caster level", value: 5 }] };
  const [g] = grantedThrows(actor([], [record("Level Edge", [part("grant", null, { ref: LURKING, atLevel: at })])], 2));
  assert.deepEqual([g.target, g.level, g.text], [10, 5, "10+"], "level 5 reads 10, not the character's level 2 reading 14");
  assert.equal(g.tip, "Level Edge (XX p.1) · Read at level 5. · Caster level 5");
  const [plain] = grantedThrows(actor([], [record("Level Edge", [part("grant", null, { ref: LURKING })])], 2));
  assert.deepEqual([plain.target, plain.level], [14, null], "with no atLevel it reads the character's own level");
  const [number] = grantedThrows(actor([], [record("Level Edge", [part("grant", null, { ref: LURKING, atLevel: 5 })])], 2));
  assert.equal(number.target, 10, "a bare number is a level too");
});

await ok("two grants of one skill leave one throw, the better target for its type", async () => {
  shelf(lurking(ladder([1, 14])));
  const two = () => [record("Low Grant", [grant(10)]), record("High Grant", [grant(13)])];
  const [over, ...more] = grantedThrows(actor([], two()));
  assert.deepEqual([over.target, more.length, over.spell], [10, 0, "Low Grant"]);
  shelf(lurking(ladder([1, 5]), { rollType: "below" }));
  assert.equal(grantedThrows(actor([], two()))[0].target, 13, "a roll-under throw takes the higher");
});

await ok("a grant's set competes with a throw part's set: the better target for the throw's type, the other told as yielding", async () => {
  shelf(lurking(ladder([1, 14])));
  const both = () => [record("Grant Edge", [grant(12)], "XX p.5"), record("Throw Edge", [part("throw", 10, { ref: REF[0], mode: "set" })], "XX p.6")];
  const [over] = grantedThrows(actor([], both()));
  assert.equal(over.target, 10, "a roll-over throw takes the lower");
  assert.ok(over.tip.endsWith("Grant Edge (XX p.5) 12+, yielding to Throw Edge (XX p.6)"), over.tip);
  shelf(lurking(ladder([1, 5]), { rollType: "below" }));
  assert.equal(grantedThrows(actor([], both()))[0].target, 12, "a roll-under throw takes the higher");
});

await ok("a granted throw that is a blank set or made automatic still tells its spells, and never prints a missing figure", async () => {
  shelf(lurking(ladder([1, 14])));
  const [blank] = grantedThrows(actor([], [record("Blank Edge", [grant(null)], "XX p.7"), record("Throw Edge", [part("throw", 10, { ref: REF[0], mode: "set" })], "XX p.6")]));
  assert.equal(blank.target, 10);
  assert.ok(!/null|undefined/.test(blank.tip), blank.tip);
  const [auto] = grantedThrows(actor([], [record("Grant Edge", [grant(12)], "XX p.5"), record("Auto Edge", [part("throw", null, { ref: REF[0], mode: "auto" })], "XX p.6")]));
  assert.equal(auto.outcome, "auto");
  assert.ok(auto.tip.includes("Auto Edge (XX p.6)"), auto.tip);
});

await ok("a grant takes the record's bonuses and automatic on its throw like a held one", async () => {
  shelf(lurking(ladder([1, 14])));
  const bonus = record("Bonus Edge", [part("grant", null, { ref: LURKING }), part("throw", 2, { ref: REF[0] })], "XX p.4");
  assert.equal(grantedThrows(actor([], [bonus]))[0].target, 12, "the definition's 14 less the record's own bonus");
  const auto = record("Auto Edge", [part("grant", null, { ref: LURKING }), part("throw", null, { ref: REF[0], mode: "auto" })]);
  assert.deepEqual([grantedThrows(actor([], [auto]))[0].outcome, grantedThrows(actor([], [auto]))[0].text], ["auto", textOf(`${ROOT}.roll.autoShort`)]);
});

await ok("rollGrantedThrow rolls the listed throw as one line on the party card and rolls nothing for a grant that has ended", async () => {
  shelf(lurking(ladder([1, 14])));
  const fx = record("Grant Edge", [grant(12)]);
  const a = actor([], [fx]);
  const [g] = grantedThrows(a);
  natural = 13;
  posted.length = 0;
  const res = await rollGrantedThrow(a, g, { skipDialog: true });
  assert.deepEqual([res.outcome, res.target, res.total, res.success], ["throw", 12, 13, true]);
  assert.equal(posted.length, 1);
  assert.match(posted[0].data.content, /12\+/, "the card carries the figure rolled against");
  assert.match(posted[0].data.content, /acks-extras-roll-card/, "on the party card's format, not the system's card");
  assert.equal(posted[0].data.content.split("<tbody>")[1].split("<tr").length - 1, 1, "one line");
  a.appliedEffects = [];
  posted.length = 0;
  assert.equal(await rollGrantedThrow(a, g, { skipDialog: true }), null, "the record ended");
  assert.equal(posted.length, 0);
  const blank = actor([], [record("Blank Edge", [grant(null)])]);
  const out = await rollGrantedThrow(blank, grantedThrows(blank)[0], { skipDialog: true });
  assert.deepEqual([out.target, out.success], [null, null], "rolls with no target and claims neither");
});

console.log(`\n${passed} passed`);
