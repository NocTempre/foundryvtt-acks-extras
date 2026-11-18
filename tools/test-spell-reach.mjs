/**
 * Where a character's spell records reach outside the abilities feature: the
 * character sheet's Rolls tab and its Abilities chips, the printed sheet's
 * export and its apply check, the Adventuring throws, and the party's skill
 * checks (`rollInventory`, `rollById`, `throwText`/`targetOf` with
 * `records: false`, `throwCheck`, `adventuringThrow`, `skillThrow`,
 * `resolveCheck`, `rollCheckFor`).
 *
 * Stand-in actors, skills and spells; every name and figure is invented. What
 * this pins: a granted throw is a Rolls-tab row in the proficiencies group that
 * rolls by its id and goes with its record; a held throw's row carries the
 * spell behind its figure as a tooltip; the printed sheet and the apply check
 * read the character's own throw whatever a record did; a throw a spell made
 * automatic flows through the skill, the Adventuring row and the party check as
 * automatic, with no roll and no figure, while a caller that cannot act on it
 * reads the character's own; a record naming the Adventuring proficiency sets
 * or lowers its stored figure and never writes it. Clicking and rendering on a
 * real sheet are the live walk's (docs/magic/TESTING.md).
 */
import assert from "node:assert/strict";
import fs from "node:fs";

let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

const LANG = JSON.parse(fs.readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
const ROOT = "ACKS-ABILITIES";
const textOf = (key) => LANG[key] ?? key;
const format = (key, data = {}) => String(textOf(key)).replace(/\{(\w+)\}/g, (_, name) => String(data[name] ?? ""));

class Stub {}
const posted = [];
const chat = [];
globalThis.game = {
  user: { id: "u1", isGM: true },
  i18n: { localize: textOf, format, has: () => true },
  settings: { get: (scope, key) => (key === "skip-dialog-key" ? "shiftKey" : {}) },
  actors: new Map(),
  items: [],
  packs: [],
};
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.Hooks = { on() {}, once() {}, off() {}, call() {}, callAll() {} };
globalThis.foundry = {
  abstract: { DataModel: class {}, TypeDataModel: class {} },
  data: { regionBehaviors: { RegionBehaviorType: Stub }, fields: {} },
  utils: { escapeHTML: (s) => String(s), deepClone: (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v))), flattenObject: (o) => o },
  applications: { api: { ApplicationV2: Stub, HandlebarsApplicationMixin: (B) => B, DialogV2: Stub }, handlebars: { renderTemplate: async (_t, data) => JSON.stringify(data.result) } },
};
const dice = [];
const formulas = [];
/** A click that holds the skip-dialog key, so a roll goes straight to the card. */
const CLICK = { shiftKey: true };
globalThis.Roll = class {
  constructor(formula) { this.formula = formula; formulas.push(formula); }
  static validate() { return true; }
  async evaluate() { this.total = dice.shift() ?? 10; return this; }
  async render() { return "dice"; }
  async toMessage(data, options) { posted.push({ roll: this, data, options }); }
};
globalThis.ChatMessage = { getSpeaker: () => ({}), create: async (data) => { chat.push(data); } };

const rolls = await import("../scripts/abilities/ability-rolls.mjs");
const { throwOutcome, throwText, targetOf, autoText } = rolls;
const { adventuringThrow, skillThrow } = await import("../scripts/abilities/adventuring-throw.mjs");
const { rollInventory, rollById } = await import("../scripts/character-sheet/rolls.mjs");
const { buildAbilitiesTab } = await import("../scripts/character-sheet/tabs/abilities.mjs");
const { throwCheck } = await import("../scripts/character-sheet/pdf/apply.mjs");
const { PARTY_CHECKS, resolveCheck, rollCheckFor, checkLabel, checkTip } = await import("../scripts/formation/party-rolls.mjs");
const { ADVENTURING_REF } = await import("../scripts/classes/grants.mjs");

/* --- fixtures ---------------------------------------------------------------- */
let serial = 0;
/** An ability: its name, cookbook id, what it provides and its throws. */
function item(name, { id = "", provides = [], rolls: list = [], cite = "" } = {}) {
  const flags = { "acks-extras": { extras: { rolls: list, effects: [], provides }, cookbook: id || cite ? { id, cite } : undefined } };
  return { id: `i${++serial}`, type: "ability", name, system: {}, flags, getFlag: (scope, key) => flags[scope]?.[key] };
}
const throwOf = (key, target, over = {}) => ({ key, label: "", formula: "1d20", rollType: "above", scale: "level", condition: "", target, ...over });
const flat = (n) => ({ kind: "flat", flat: n });
const part = (on, value, over = {}) => ({ key: `${on}${value}${serial++}`, on, value, provides: ["kw:spellrecord"], ...over });
const record = (label, parts, cite = "XX p.1") => ({
  id: `fx${++serial}`,
  disabled: false,
  statuses: [],
  flags: { "acks-extras": { rollMods: { id: `def.spell.${label.toLowerCase().replace(/\s+/g, "")}`, label, cite, sourceAlignment: "lawful", parts } } },
});
/** A character at level 3 holding `items`, under `effects`, with stored Adventuring figures and what the sheet's other halves read. */
function actor(items, effects = [], stored = { dungeonbashing: 17, climb: 7, listening: 17, searching: 17, trapbreaking: 17 }) {
  const a = {
    id: `a${++serial}`,
    name: "Tester",
    img: "a.png",
    type: "character",
    system: { details: { level: 3, morale: 0 }, adventuring: { ...stored }, saves: {}, attack: { throw: 10 }, hp: {}, surprise: {}, initiative: {} },
    effects,
    appliedEffects: effects,
    statuses: new Set(),
    getFlag: () => undefined,
    isOwner: true,
    adventuringRolls: [],
    async rollAdventuring(key, opts) { this.adventuringRolls.push([key, opts]); },
  };
  a.items = Object.assign([...items], { get: (id) => items.find((i) => i.id === id) });
  for (const i of items) i.actor = a;
  return a;
}
const rowsOf = (a) => rollInventory(a).groups.flatMap((g) => g.rows);
const rowOf = (a, id) => rowsOf(a).find((r) => r.id === id);

const LURKING = "def.skill.lurking";
const lurking = (target = flat(14)) => item("Lurking", { id: LURKING, cite: "XX p.9", rolls: [throwOf("throw1", target)] });
const rollOfItem = (skill, i = 0) => skill.getFlag("acks-extras", "extras").rolls[i];
const SPELL = (value, over = {}) => part("throw", value, { ref: "kw:lurking", ...over });
const lurkingItem = () => { const s = lurking(); s.flags["acks-extras"].extras.provides = ["kw:lurking"]; return s; };
/** A held search skill whose methodical throw backs the Adventuring row. */
const searching = () => item("Searching", { cite: "XX p.4", provides: ["kw:searching"], rolls: [throwOf("hasty", flat(15)), throwOf("methodical", flat(11))] });
const SEARCH_REF = "kw:searching";

/* ================================ point 2: the printed sheet ================================ */

await ok("records: false reads the character's own throw, whatever add, set or auto a record made of it", async () => {
  for (const [label, fx, moved] of [
    ["an added bonus", record("Edge", [SPELL(2)]), "12+"],
    ["a set figure", record("Edge", [SPELL(16, { mode: "set" })]), "16+"],
    ["an automatic throw", record("Edge", [SPELL(null, { mode: "auto" })]), textOf(`${ROOT}.roll.autoShort`)],
  ]) {
    const skill = lurkingItem();
    const a = actor([skill], [fx]);
    const roll = rollOfItem(skill);
    assert.equal(throwText(roll, a, skill), moved, `${label} moves the figure as a sheet on screen reads it`);
    assert.equal(throwText(roll, a, skill, { records: false }), "14+", `${label}: the printed sheet reads the character's own`);
    assert.equal(targetOf(roll, a, skill, { records: false }), 14, `${label}: and so does a check against it`);
    assert.equal(throwOutcome(roll, a, skill, { records: false }).record, undefined, `${label}: the verdict names no record`);
  }
});

await ok("the apply check compares what the sheet states with the character's own throw, not a record's", async () => {
  const skill = lurkingItem();
  const a = actor([skill], [record("Edge", [SPELL(2)])]);
  assert.equal(throwCheck(a, skill, { throw: 14, throwText: "14+" }), null, "a sheet stating the own 14 agrees, though the record reads 12");
  assert.deepEqual(throwCheck(a, skill, { throw: 12, throwText: "12+" }), { label: "Lurking", sheet: "12+", inForce: "14+" }, "a sheet stating the record's 12 is the disagreement");
  const auto = actor([lurkingItem()], [record("Edge", [SPELL(null, { mode: "auto" })])]);
  assert.deepEqual(throwCheck(auto, auto.items[0], { throw: 13, throwText: "13+" }), { label: "Lurking", sheet: "13+", inForce: "14+" }, "an automatic record leaves the own figure to compare, not a silent skip");
  assert.equal(throwCheck(a, undefined, { throw: 12, throwText: "12+" }), null, "nothing held, nothing to check");
});

await ok("the export reads the sheet's own throw for a proficiency's row", async () => {
  const source = fs.readFileSync(new URL("../scripts/character-sheet/pdf/export.mjs", import.meta.url), "utf8");
  assert.match(source, /throwText\(roll, actor, item, \{ records: false \}\)/, "the one place the export prints a held throw");
});

/* ================================ point 1: the Rolls tab ================================ */

await ok("an ability's row carries the spell behind its figure as a tooltip, and no tip where no record touched it", async () => {
  const skill = lurkingItem();
  const a = actor([skill], [record("Edge", [SPELL(2)])]);
  const row = rowOf(a, `abl:${skill.id}:throw1`);
  assert.equal(row.value, "12+");
  assert.equal(row.tip, "Edge (XX p.1) +2");
  a.appliedEffects = [];
  assert.equal(rowOf(a, `abl:${skill.id}:throw1`).tip, "", "the row as it was");
});

await ok("the Abilities tab's throw chip carries the same provenance, and none where no record touched it", async () => {
  const skill = lurkingItem();
  const a = actor([skill], [record("Edge", [SPELL(2)])]);
  const chip = () => buildAbilitiesTab(a, {}).groups.flatMap((g) => g.rows).find((r) => r.id === skill.id).throws[0];
  assert.deepEqual([chip().value, chip().tip], ["12+", "Edge (XX p.1) +2"]);
  a.appliedEffects = [];
  assert.equal(chip().tip, "");
});

/** A grant that sets the throw's target. */
const grant = (value, over = {}) => part("grant", value, { ref: LURKING, mode: "set", ...over });

await ok("a granted throw is a row of the proficiencies group by its id, with the tip and text grantedThrows gave, and goes with its record", async () => {
  game.items.length = 0;
  game.items.push(lurking());
  const fx = record("Grant Edge", [grant(12)]);
  const a = actor([], [fx]);
  const inv = rollInventory(a);
  const group = inv.groups.find((g) => g.key === "proficiencies");
  assert.ok(group, "the group appears with no held proficiency, for the grant alone");
  const row = group.rows.find((r) => r.id === `grant:${LURKING}:throw1`);
  assert.deepEqual([row.label, row.value, row.tip, row.item, row.rollable], ["Lurking", "12+", "Grant Edge (XX p.1) = 12+", null, true]);
  assert.ok(inv.ids.includes(row.id), "listed among the ids the pins resolve through");
  a.appliedEffects = [];
  assert.equal(rowOf(a, row.id), undefined, "gone with its record");
});

await ok("a granted row rolls by its id through the grant's own roller, and a grant that ended rolls nothing", async () => {
  game.items.length = 0;
  game.items.push(lurking());
  const fx = record("Grant Edge", [grant(12)]);
  const a = actor([], [fx]);
  posted.length = 0;
  dice.length = 0;
  dice.push(15);
  assert.equal(await rollById(a, `grant:${LURKING}:throw1`, { event: CLICK }), true);
  assert.equal(posted.length, 1, "one card");
  a.appliedEffects = [];
  posted.length = 0;
  assert.equal(await rollById(a, `grant:${LURKING}:throw1`, { event: CLICK }), false, "a pin outliving its record rolls nothing");
  assert.equal(posted.length, 0);
});

/* ================================ point 3: automatic through a skill ================================ */

await ok("a throw a spell made automatic answers `auto` with no figure, naming its spell, and reads the character's own where a caller cannot act on it", async () => {
  const skill = searching();
  const fx = record("Auto Edge", [part("throw", null, { ref: SEARCH_REF, rollKey: "methodical", mode: "auto" })], "XX p.2");
  const a = actor([skill], [fx]);
  const auto = skillThrow(a, skill, "methodical");
  assert.deepEqual([auto.target, auto.auto.label, auto.auto.cite, auto.rollKey], [null, "Auto Edge", "XX p.2", "methodical"]);
  const own = skillThrow(a, skill, "methodical", { auto: false });
  assert.deepEqual([own.target, own.auto, own.record], [11, undefined, undefined], "own throw, no record on it");
  assert.equal(skillThrow(a, skill, "hasty").target, 15, "a throw the record does not name is untouched");
});

await ok("a set figure on a skill answers though the skill's own target is a sentinel, and an add on one still does not", async () => {
  const zero = item("Searching", { provides: ["kw:searching"], rolls: [throwOf("methodical", flat(0))] });
  const set = actor([zero], [record("Set Edge", [part("throw", 9, { ref: SEARCH_REF, rollKey: "methodical", mode: "set" })])]);
  assert.equal(skillThrow(set, zero, "methodical").target, 9);
  const add = actor([item("Searching", { provides: ["kw:searching"], rolls: [throwOf("methodical", flat(0))] })], [record("Edge", [part("throw", 2, { ref: SEARCH_REF, rollKey: "methodical" })])]);
  assert.equal(skillThrow(add, add.items[0], "methodical"), null, "no figure of the character's to add to");
});

await ok("the Adventuring row of a held skill made automatic prints auto, tells the spell, and rolls the skill's own automatic card", async () => {
  const skill = searching();
  const a = actor([skill], [record("Auto Edge", [part("throw", null, { ref: SEARCH_REF, rollKey: "methodical", mode: "auto" })], "XX p.2")]);
  const found = adventuringThrow(a, "searching");
  assert.deepEqual([found.target, found.source, found.auto.label, found.via, found.backs], [null, "skill", "Auto Edge", { itemId: skill.id, rollKey: "methodical" }, { itemId: skill.id, rollKey: "methodical" }]);
  const row = rowOf(a, "adv:searching");
  assert.deepEqual([row.value, row.tip], [textOf(`${ROOT}.roll.autoShort`), "Automatic through Auto Edge (XX p.2)."]);
  assert.equal(rollInventory(a).ids.includes(`abl:${skill.id}:methodical`), false, "the throw that backs the row is still listed once");
  posted.length = 0;
  chat.length = 0;
  a.adventuringRolls.length = 0;
  assert.equal(await rollById(a, "adv:searching", { event: CLICK }), true);
  assert.equal(a.adventuringRolls.length, 0, "the Adventuring roll is not made");
  assert.equal(posted.length + chat.length, 1, "the skill's automatic card is posted");
  assert.match(JSON.stringify([chat, posted.map((p) => p.data)]), /Automatic through Auto Edge/, "naming the spell");
  const ignoring = adventuringThrow(a, "searching", { auto: false });
  assert.deepEqual([ignoring.target, ignoring.auto], [11, undefined], "a caller that cannot act on it reads the own figure");
});

await ok("an automatic skill beats a held skill whose figure is zero, wherever the two are listed", async () => {
  const zero = item("Searching", { provides: ["kw:searching"], rolls: [throwOf("methodical", { kind: "breakpoints", breakpoints: [{ atLevel: 1, value: 0 }] })] });
  const auto = item("Searching Aid", { provides: ["kw:searching", "kw:aid"], rolls: [throwOf("methodical", flat(12))] });
  const fx = record("Auto Edge", [part("throw", null, { ref: "kw:aid", rollKey: "methodical", mode: "auto" })]);
  assert.equal(adventuringThrow(actor([zero, auto], [fx]), "searching").auto?.label, "Auto Edge", "the zero first");
  assert.equal(adventuringThrow(actor([auto, zero], [fx]), "searching").auto?.label, "Auto Edge", "the zero last");
});

await ok("an ability that stands in for the stored figure and is made automatic is told as automatic, posting its own card", async () => {
  const sense = item("Sharp Senses", { cite: "XX p.5", provides: ["kw:alertness"], rolls: [throwOf("searchListen", flat(14))] });
  const a = actor([sense], [record("Auto Edge", [part("throw", null, { ref: "kw:alertness", rollKey: "searchListen", mode: "auto" })])]);
  const found = adventuringThrow(a, "listening");
  assert.deepEqual([found.target, found.source, found.auto.label, found.via.itemId], [null, "standIn", "Auto Edge", sense.id]);
  assert.equal(rowOf(a, "adv:listening").value, textOf(`${ROOT}.roll.autoShort`));
  assert.equal(adventuringThrow(a, "climb").auto, undefined, "climbing has no stand-in");
});

/* ================================ point 3: the stored side ================================ */

const ADV = (value, over = {}) => part("throw", value, { ref: ADVENTURING_REF, rollKey: "climb", ...over });

await ok("a record naming the Adventuring proficiency lowers its stored figure, names the spell, and leaves the stored value the character's own", async () => {
  const a = actor([], [record("Climb Edge", [ADV(2)], "XX p.3")]);
  const found = adventuringThrow(a, "climb");
  assert.deepEqual([found.target, found.source, found.other], [5, "stored", null]);
  assert.deepEqual(found.parts.map((p) => [p.kind, p.label, p.value, p.cite]), [["spell", "Climb Edge", 2, "XX p.3"]]);
  assert.equal(a.system.adventuring.climb, 7, "nothing is written to the stored field");
  const row = rowOf(a, "adv:climb");
  assert.equal(row.value, "5+");
  assert.match(row.tip, /Climb Edge/);
  assert.match(row.tip, /XX p\.3/);
  assert.equal(adventuringThrow(a, "searching").target, 17, "another key is not reached");
  a.appliedEffects = [];
  assert.equal(adventuringThrow(a, "climb").target, 7, "the figure is the stored one again with the record gone");
  assert.equal(rowOf(a, "adv:climb").tip, "7+, the figure stored on the sheet. Edit it on the Stats tab.", "and the row reads as it always did");
});

await ok("owner ruling: of two records on the stored side one figure stays, the larger, until the last ends", async () => {
  const big = record("Big Edge", [ADV(3)], "XX p.2");
  const small = record("Small Edge", [ADV(2)], "XX p.3");
  const a = actor([], [big, small]);
  assert.equal(adventuringThrow(a, "climb").target, 4, "+3 and +2 leave +3");
  assert.match(rowOf(a, "adv:climb").tip, /Small Edge/, "the smaller is told as yielding");
  a.appliedEffects = [small];
  assert.equal(adventuringThrow(a, "climb").target, 5);
});

await ok("a set figure replaces the stored side, even a worse one, and the bonuses yield to it", async () => {
  const a = actor([], [record("Set Edge", [ADV(9, { mode: "set" }), ADV(2)], "XX p.4")]);
  const found = adventuringThrow(a, "climb");
  assert.deepEqual([found.target, found.source, found.parts], [9, "stored", []]);
  const worse = actor([], [record("Set Edge", [ADV(12, { mode: "set" })])]);
  assert.equal(adventuringThrow(worse, "climb").target, 12, "worse than the stored 7, and the figure all the same");
  const tip = rowOf(a, "adv:climb").tip;
  assert.match(tip, /Set Edge \(XX p\.4\) = 9\+/);
  assert.doesNotMatch(tip, /the figure stored on the sheet/, "the stored figure is not what the row is read from");
  assert.ok(tip.includes(format("ACKS-LIB.rollMods.yields", { name: "Set Edge (XX p.4) +2", to: "Set Edge (XX p.4)" })), "the bonus that yielded is told, with what it yielded to");
});

await ok("the Adventuring roll goes against the figure a record moved and the stored value stays", async () => {
  const a = actor([], [record("Climb Edge", [ADV(2)])]);
  await rollById(a, "adv:climb");
  assert.deepEqual(a.adventuringRolls, [["climb", { event: undefined, target: 5 }]]);
  const plain = actor([]);
  await rollById(plain, "adv:climb");
  assert.deepEqual(plain.adventuringRolls, [["climb", { event: undefined }]], "with no record it is asked as it always was");
});

await ok("an automatic stored side prints auto and posts a line naming the spell, with no roll", async () => {
  const a = actor([], [record("Auto Edge", [ADV(null, { mode: "auto" })], "XX p.6")]);
  assert.equal(rowOf(a, "adv:climb").value, textOf(`${ROOT}.roll.autoShort`));
  chat.length = 0;
  assert.equal(await rollById(a, "adv:climb"), true);
  assert.equal(a.adventuringRolls.length, 0);
  assert.equal(chat.length, 1);
  assert.match(chat[0].content, /Automatic through Auto Edge \(XX p\.6\)\./);
});

/* ================================ point 3: the party's checks ================================ */

await ok("a party check whose skill is automatic resolves as auto with no figure, no parts, no conditions", async () => {
  const skill = searching();
  const a = actor([skill], [record("Auto Edge", [part("throw", null, { ref: SEARCH_REF, rollKey: "methodical", mode: "auto" })], "XX p.2")]);
  const cfg = PARTY_CHECKS.searchMethodical;
  const check = resolveCheck(a, cfg, { auto: true });
  assert.deepEqual([check.target, check.auto.label, check.parts, check.bonus, check.skilled], [null, "Auto Edge", [], 0, true]);
  assert.equal(checkLabel(check), textOf(`${ROOT}.roll.autoShort`));
  assert.equal(checkTip(check), "Automatic through Auto Edge (XX p.2).");
  const own = resolveCheck(a, cfg);
  assert.equal(own.target, 11, "a caller that did not ask for auto gets the own figure, never a null one");
  assert.equal(own.auto, undefined);
});

await ok("rolling the party check of an automatic member makes no die and reads as a success", async () => {
  const a = actor([searching()], [record("Auto Edge", [part("throw", null, { ref: SEARCH_REF, rollKey: "methodical", mode: "auto" })], "XX p.2")]);
  formulas.length = 0;
  const rolled = await rollCheckFor(a, PARTY_CHECKS.searchMethodical);
  assert.equal(rolled.roll, null);
  assert.equal(formulas.length, 0, "no Roll was built");
  assert.deepEqual([rolled.row.success, rolled.row.auto, rolled.row.target], [true, true, null]);
  assert.equal(rolled.row.sourceTip, "Automatic through Auto Edge (XX p.2).");
});

await ok("a party check on the Adventuring figure takes the stored side's record, and an automatic one", async () => {
  const climb = { flagKey: "climb", capability: "kw:climbing", rollKey: "climb", advKey: "climb", pattern: /climbing/i };
  const a = actor([], [record("Climb Edge", [ADV(2)])]);
  assert.equal(resolveCheck(a, climb).target, 5);
  const auto = actor([], [record("Auto Edge", [ADV(null, { mode: "auto" })])]);
  assert.equal(resolveCheck(auto, climb, { auto: true }).auto.label, "Auto Edge");
  assert.equal(resolveCheck(auto, climb).target, 7, "a caller that cannot act on it reads the stored 7");
});

/* ================================ gold, pale and the one-line card ================================ */

const { registerSpellSource, registerSpellReach } = await import("../scripts/lib/spell-sources.mjs");
const OTHER = "def.skill.glimmer";

/** An invented spell document. */
const spellDoc = (name) => ({ name, uuid: `Item.${name.replace(/\s+/g, "")}`, flags: { "acks-extras": { cookbook: { id: `def.spell.${name.toLowerCase().replace(/\s+/g, "")}` } } } });

/**
 * Stand a register on the sheet: `known` is `[{name, capacity, cite, onSelf, parts}]`, one spell each, the source
 * answering every spell the actor can cast and the reach what a cast would write on the caster. Returns the teardown.
 */
function register(known) {
  const byName = new Map(known.map((k) => [k.name, k]));
  const offSource = registerSpellSource("test", () => known.map((k) => ({ spell: spellDoc(k.name), itemId: `s-${k.name}`, casterLevel: null, capacity: k.capacity ?? "ok", cite: k.cite ?? "XX p.3" })));
  const offReach = registerSpellReach((_actor, entry) => {
    const k = byName.get(entry.spell.name);
    return { onSelf: k.onSelf === undefined ? true : k.onSelf, selfParts: k.parts ?? [grant(12)] };
  });
  return () => {
    offSource();
    offReach();
  };
}
const shelf = () => {
  game.items.length = 0;
  game.items.push(lurking(), item("Glimmer", { id: OTHER, cite: "XX p.10", rolls: [throwOf("throw1", flat(15))] }));
};
const proficiencies = (a) => rollInventory(a).groups.find((g) => g.key === "proficiencies")?.rows ?? [];

await ok("a spell the character can cast on itself and has not cast is a pale row: latent, display only, named with its page", async () => {
  shelf();
  const off = register([{ name: "Hush Ward", cite: "XX p.3" }]);
  try {
    const a = actor([], []);
    const row = rowOf(a, `grant:${LURKING}:throw1`);
    assert.deepEqual([row.label, row.value, row.latent, row.granted ?? false, row.rollable, row.pinned, row.line], ["Lurking", "12+", true, false, false, false, "Hush Ward"]);
    assert.ok(row.tip.includes("Hush Ward (XX p.3)"), row.tip);
    assert.ok(row.tip.startsWith(textOf(`${ROOT}.roll.grantLatent`).split("{")[0]), "told as castable, not as cast");
    assert.equal(rollInventory(a).ids.includes(row.id), false, "no pin can name it");
    a.getFlag = () => ({ pins: [row.id] });
    assert.equal(rowOf(a, row.id).pinned, false, "a pin left from when it was gold shows no star");
    posted.length = 0;
    chat.length = 0;
    assert.equal(await rollById(a, row.id, { event: CLICK }), false, "it rolls nothing");
    assert.equal(posted.length + chat.length, 0, "and posts nothing");
  } finally {
    off();
  }
});

await ok("a spell it cannot cast on itself, or cannot cast at all, shows no row", async () => {
  shelf();
  for (const [label, known] of [
    ["lands on others", [{ name: "Far Ward", onSelf: false }]],
    ["cannot be told", [{ name: "Far Ward", onSelf: null }]],
    ["known to no source", []],
  ]) {
    const off = register(known);
    try {
      assert.deepEqual(proficiencies(actor([], [])), [], label);
    } finally {
      off();
    }
  }
});

await ok("a spell with no slot left still shows pale", async () => {
  shelf();
  const off = register([{ name: "Hush Ward", capacity: "none" }]);
  try {
    assert.equal(rowOf(actor([], []), `grant:${LURKING}:throw1`).latent, true);
  } finally {
    off();
  }
});

await ok("a record on the character is a gold row whoever cast it, and it takes the id the pale row had", async () => {
  shelf();
  const off = register([{ name: "Hush Ward" }]);
  try {
    const a = actor([], []);
    const pale = rowOf(a, `grant:${LURKING}:throw1`);
    assert.equal(pale.latent, true);
    // The record's caster is another character: nothing on the record names who.
    a.effects = a.appliedEffects = [record("Hush Ward", [grant(12)], "XX p.3")];
    const gold = rowOf(a, `grant:${LURKING}:throw1`);
    assert.deepEqual([gold.id, gold.granted, gold.latent ?? false, gold.rollable, gold.line], [pale.id, true, false, true, "Hush Ward"]);
    assert.ok(gold.tip.includes("Hush Ward (XX p.3)"), "its tooltip lists its parts");
    assert.equal(proficiencies(a).filter((r) => r.id === gold.id).length, 1, "one row for the ref and key, not a gold and a pale");
  } finally {
    off();
  }
});

await ok("gold suppresses pale for its own ref and key only", async () => {
  shelf();
  // The castable spell would grant a better figure on both skills; the record grants the first alone.
  const off = register([{ name: "Hush Ward", parts: [grant(9), grant(9, { ref: OTHER })] }]);
  try {
    const a = actor([], [record("Cast Edge", [grant(12)], "XX p.1")]);
    const rows = proficiencies(a);
    assert.deepEqual(rows.map((r) => [r.id, r.latent ?? false]), [[`grant:${LURKING}:throw1`, false], [`grant:${OTHER}:throw1`, true]]);
    assert.equal(rows[0].value, "12+", "the recorded figure, not the cast's better one");
  } finally {
    off();
  }
});

await ok("two spells that give one throw make one pale row naming both", async () => {
  shelf();
  const off = register([{ name: "Hush Ward", cite: "XX p.3", parts: [grant(12)] }, { name: "Quiet Veil", cite: "XX p.4", parts: [grant(11)] }]);
  try {
    const rows = proficiencies(actor([], []));
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].line.split(", ").sort(), ["Hush Ward", "Quiet Veil"]);
    assert.ok(rows[0].tip.includes("Hush Ward (XX p.3)") && rows[0].tip.includes("Quiet Veil (XX p.4)"), rows[0].tip);
  } finally {
    off();
  }
});

await ok("a skill the character holds needs no pale row", async () => {
  shelf();
  const off = register([{ name: "Hush Ward" }]);
  try {
    assert.deepEqual(proficiencies(actor([lurking()], [])).filter((r) => r.id.startsWith("grant:")), []);
  } finally {
    off();
  }
});

/** The rows of a card's body, its header row left out. */
const bodyRows = (html) => (String(html).split("<tbody>")[1] ?? "").split("<tr").length - 1;

await ok("a granted throw posts one line on the party card's format, not the system's card", async () => {
  shelf();
  const a = actor([], [record("Hush Ward", [grant(12)], "XX p.3")]);
  posted.length = 0;
  dice.length = 0;
  dice.push(15);
  assert.equal(await rollById(a, `grant:${LURKING}:throw1`, { event: CLICK }), true);
  const { content } = posted[0].data;
  assert.match(content, /acks-extras-roll-card/, "the party card's own markup");
  assert.equal(bodyRows(content), 1, "one line");
  assert.match(content, /Tester/, "who rolled");
  assert.match(content, />15</, "what they rolled");
  assert.match(content, />12\+</, "the target, signed");
  assert.match(content, /<strong>Success<\/strong>/, "the verdict");
  assert.match(content, /Hush Ward/, "what gave the throw");
  assert.equal(posted[0].roll.total, 15, "the die rides the message");
  dice.push(3);
  posted.length = 0;
  await rollById(a, `grant:${LURKING}:throw1`, { event: CLICK });
  assert.match(posted[0].data.content, /Failure/);
});

await ok("a stored Adventuring throw a spell made automatic posts one line on the same format", async () => {
  const a = actor([], [record("Auto Edge", [ADV(null, { mode: "auto" })], "XX p.6")]);
  chat.length = 0;
  assert.equal(await rollById(a, "adv:climb"), true);
  assert.equal(chat.length, 1);
  assert.match(chat[0].content, /acks-extras-roll-card/);
  assert.equal(bodyRows(chat[0].content), 1);
  assert.match(chat[0].content, /Automatic through Auto Edge \(XX p\.6\)\./);
  assert.match(chat[0].content, /Tester/);
});

console.log(`\n${passed} passed`);
