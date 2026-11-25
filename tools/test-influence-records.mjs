/**
 * The reaction figures a bearer's spell records give the influence page
 * (scripts/influence/record-effects.mjs): which rows the page offers, how a
 * scope is settled BEFORE the stacking, what the figure's tooltip names, and
 * which of the ticked rows count at the sum.
 *
 * Stand-in actors and Active Effects, as in test-roll-mods. That the dialog
 * ticks, sums and posts the rows is the live walk's to prove. Every spell,
 * kind and figure below is invented.
 */
import assert from "node:assert/strict";

const LIB = "ACKS-LIB";
const INFLUENCE = "ACKS-INFLUENCE";
const TEXT = {
  [`${LIB}.rollMods.yields`]: "{name}, yielding to {to}",
  [`${INFLUENCE}.mod.withFigure`]: "{label} ({figure})",
};
const format = (key, data = {}) => (TEXT[key] ?? key).replace(/\{(\w+)\}/g, (_, n) => data[n] ?? "");
globalThis.game = { system: { id: "acks" }, user: { targets: [] }, i18n: { format, localize: (k) => k, has: () => false, translations: {} } };
globalThis.libWrapper = { register() {} };
globalThis.Hooks = { callAll() {}, on() {} };
globalThis.ui = { notifications: { warn() {}, info() {} } };
globalThis.Roll = { validate: () => true };
globalThis.ChatMessage = { getSpeakerActor: () => null };
globalThis.CONFIG = { Actor: { documentClass: { prototype: {} }, dataModels: {} }, Item: { documentClass: class {}, dataModels: {} } };

const { getRecordReactionMods, keptRecordRows, liveRecordIds, moraleWorkingLine } = await import("../scripts/influence/record-effects.mjs");

let passed = 0;
const ok = async (name, fn) => {
  await fn();
  passed++;
  console.log("ok   " + name);
};

/* --- Stand-ins ------------------------------------------------------------- */

let serial = 0;
const SHARED = "kw:spellrecord";
const reaction = (value, over = {}) => ({ key: `reaction${value}`, on: "reaction", value, provides: [SHARED], ...over });
/** One record: the spell is "def.spell.<id>", labelled with the capitalised id. */
const rec = (id, parts, { sourceAlignment = "lawful" } = {}) => ({
  id: `fx${++serial}`,
  disabled: false,
  flags: { "acks-extras": { rollMods: { id: `def.spell.${id}`, label: id[0].toUpperCase() + id.slice(1), cite: "Test cite", sourceAlignment, parts } } },
});
const bearer = (effects, items = []) => ({ name: "Bearer", type: "character", effects, appliedEffects: effects, items, system: { details: {} } });
const page = (over = {}) => ({ tone: "diplomacy", kinds: new Set(["beast"]), alignment: "neutral", optionalRules: {}, ...over });
const spoken = (rows) => rows.map((r) => [r.label, r.value]);

/* --- Rows ---------------------------------------------------------------- */

await ok("a record's reaction part is a row of the shared shape, labelled with the spell and its page reference", () => {
  const rows = getRecordReactionMods(bearer([rec("alpha", [reaction(2)])]), page());
  assert.deepEqual(spoken(rows), [["Alpha (Test cite)", 2]]);
  const [row] = rows;
  assert.equal(row.family, "reaction");
  assert.equal(row.appliesTo, "self");
  assert.equal(row.situational, false);
  assert.equal(row.record, true);
  assert.equal(row.source, "record");
  assert.match(row.id, /^rec:fx\d+:reaction2$/);
  assert.ok(!row.id.includes("."), "a dot would nest the form data");
  assert.deepEqual(getRecordReactionMods(null, page()), []);
  assert.deepEqual(getRecordReactionMods(bearer([]), page()), []);
});

await ok("owner ruling 2: a second record of one kind leaves one figure, the larger, until the last record ends", () => {
  const big = rec("alpha", [reaction(3)]);
  const small = rec("beta", [reaction(2)]);
  const holder = bearer([big, small]);
  const read = () => getRecordReactionMods(holder, page());
  assert.deepEqual(spoken(read()), [["Alpha (Test cite)", 3]]);
  assert.equal(read()[0].tip, "Alpha (+3) · Beta (Test cite), yielding to Alpha (Test cite)", "the tooltip names the spell, its figure and what yielded");
  holder.appliedEffects = [small];
  assert.deepEqual(spoken(read()), [["Beta (Test cite)", 2]], "the larger's record ends and the smaller stands");
  holder.appliedEffects = [];
  assert.deepEqual(read(), [], "the last record ends and nothing is offered");
});

/* --- Scope before stacking -------------------------------------------------- */

await ok("a larger part whose scope misses the page never takes a smaller in-scope part's place", () => {
  const holder = bearer([rec("alpha", [reaction(4, { vsKinds: ["undead"] })]), rec("beta", [reaction(2)])]);
  assert.deepEqual(spoken(getRecordReactionMods(holder, page({ kinds: new Set(["beast"]) }))), [["Beta (Test cite)", 2]]);
  assert.deepEqual(spoken(getRecordReactionMods(holder, page({ kinds: new Set(["undead"]) }))), [["Alpha (Test cite)", 4]], "in scope it is the larger and stands alone");
});

await ok("a tone the part does not name leaves it out, and a page with no tone offers it", () => {
  const holder = bearer([rec("alpha", [reaction(4, { tones: ["seduction"] })]), rec("beta", [reaction(2)])]);
  assert.deepEqual(spoken(getRecordReactionMods(holder, page({ tone: "diplomacy" }))), [["Beta (Test cite)", 2]]);
  assert.deepEqual(spoken(getRecordReactionMods(holder, page({ tone: "seduction" }))), [["Alpha (Test cite)", 4]]);
  assert.deepEqual(spoken(getRecordReactionMods(holder, page({ tone: null }))), [["Alpha (Test cite)", 4], ["Beta (Test cite)", 2]], "a tone the page cannot name is undetermined: offered for the Judge to tick, beside the one that applies");
});

await ok("a part whose ifHas is not met is not a candidate (allure's row)", () => {
  const holder = bearer([rec("alpha", [reaction(3, { ifHas: ["kw:testaura"] })])]);
  assert.deepEqual(getRecordReactionMods(holder, page()), []);
  holder.items = [{ type: "ability", name: "def.prof.testAura", flags: { "acks-extras": { cookbook: { id: "def.prof.testAura" } } }, getFlag: () => ({ provides: [] }) }];
  assert.deepEqual(spoken(getRecordReactionMods(holder, page())), [["Alpha (Test cite)", 3]]);
});

await ok("a part with no tones applies to every tone (allure)", () => {
  const holder = bearer([rec("alpha", [reaction(1)])]);
  for (const tone of ["diplomacy", "intimidation", "seduction"]) assert.deepEqual(spoken(getRecordReactionMods(holder, page({ tone }))), [["Alpha (Test cite)", 1]], tone);
});

await ok("an unsettled scope is offered for the Judge to tick: a larger undetermined part is offered beside the applying one, a smaller is told as yielding", () => {
  const holder = bearer([rec("alpha", [reaction(4, { vsEnemy: true })]), rec("beta", [reaction(2)]), rec("gamma", [reaction(1, { vsEnemy: true })])]);
  const rows = getRecordReactionMods(holder, page());
  assert.deepEqual(spoken(rows), [["Alpha (Test cite)", 4], ["Beta (Test cite)", 2]], "the +1 never shows beside the +2 that beats it");
  assert.match(rows[1].tip, /Gamma \(Test cite\), yielding to Beta \(Test cite\)/);
  const two = bearer([rec("alpha", [reaction(1)]), rec("beta", [reaction(4, { vsEnemy: true })]), rec("gamma", [reaction(3, { vsEnemy: true })])]);
  assert.deepEqual(spoken(getRecordReactionMods(two, page())), [["Alpha (Test cite)", 1], ["Beta (Test cite)", 4], ["Gamma (Test cite)", 3]], "one undetermined part never hides another the Judge may still need");
});

await ok("a tie keeps the earlier record, whatever order lib's kept and dropped lists come in", () => {
  const q = rec("q", [reaction(3)]);
  const p = rec("p", [reaction(3, { stacksWith: ["def.spell.r"] })]);
  const r = rec("r", [reaction(5, { vsKinds: ["undead"] })]);
  assert.deepEqual(spoken(getRecordReactionMods(bearer([q, p, r]), page())), [["Q (Test cite)", 3]]);
});

await ok("a sign-mode scope stacks at the figure it is worth here", () => {
  const holder = bearer([rec("alpha", [reaction(3, { vsAlignment: "chaotic", vsAlignmentMode: "sign" })]), rec("beta", [reaction(1)])]);
  assert.deepEqual(spoken(getRecordReactionMods(holder, page({ alignment: "lawful" }))), [["Beta (Test cite)", 1]], "-3 does not displace +1");
});

/* --- Which ticked rows count ------------------------------------------------ */

await ok("two ticked record rows leave the larger; an unticked row, or a record that ended, counts for nothing", () => {
  const holder = bearer([rec("alpha", [reaction(4, { vsEnemy: true })]), rec("beta", [reaction(2)])]);
  const rows = getRecordReactionMods(holder, page()).map((r) => ({ ...r, key: r.id }));
  const [alpha, beta] = rows;
  const alive = liveRecordIds(holder);
  assert.deepEqual([...keptRecordRows(rows, { [beta.key]: true }, alive)], [beta.key], "the applying row alone");
  assert.deepEqual([...keptRecordRows(rows, { [alpha.key]: true, [beta.key]: true }, alive)], [alpha.key], "ticking both counts the larger");
  assert.deepEqual([...keptRecordRows(rows, { [alpha.key]: false, [beta.key]: false }, alive)], []);
  holder.appliedEffects = [holder.effects[1]];
  assert.deepEqual([...keptRecordRows(rows, { [alpha.key]: true, [beta.key]: true }, liveRecordIds(holder))], [beta.key], "the larger's record ended: it counts no more");
  assert.deepEqual([...keptRecordRows(rows, { [alpha.key]: true }, new Set())], [], "no record left");
  assert.deepEqual([...keptRecordRows([{ key: "x", record: false, value: 9 }], { x: true }, alive)], [], "only record rows are resolved here");
  const [pos] = getRecordReactionMods(bearer([rec("delta", [reaction(1)])]), page());
  const neg = { ...pos, stackPart: { ...pos.stackPart, value: 3 } };
  const reversed = [{ ...neg, key: "neg", value: -3 }, { ...pos, key: "pos" }];
  assert.deepEqual([...keptRecordRows(reversed, { neg: true, pos: true }, null)], ["pos"], "a row the scope reversed is resolved at its signed figure, as the page sums it");
});

await ok("a part's key never nests the form data its row is named in", () => {
  const [row] = getRecordReactionMods(bearer([rec("alpha", [reaction(2, { key: "a.b c" })])]), page());
  assert.ok(!row.id.includes("."), row.id);
  assert.match(row.id, /^rec:fx\d+:a_b_c$/);
});

await ok("a record an item's reach wrote prints a morale line naming the item and its page, with the row's tooltip; a spell's record and a reaction page's row print none", () => {
  const fromItem = (id, parts) => ({ ...rec(id, parts), flags: { "acks-extras": { ...rec(id, parts).flags["acks-extras"], itemRun: { source: "I.1", activationId: "a", rowKey: "r" } } } });
  const morale = (value) => ({ key: "morale", on: "reaction", rollKey: "morale", value, provides: [SHARED] });
  const rows = getRecordReactionMods(bearer([fromItem("trait", [morale(-1)]), rec("charm", [{ ...morale(1), provides: ["kw:other"] }], { sourceAlignment: null })]), { rollKey: "morale", kinds: new Set(["beast"]) });
  const words = { inReachOf: "In reach of" };
  const byLabel = Object.fromEntries(rows.map((r) => [r.spell, r]));
  assert.deepEqual([byLabel.Trait.fromItem, byLabel.Charm.fromItem], [true, false]);
  const line = moraleWorkingLine(byLabel.Trait, words);
  assert.deepEqual([line.label, line.cite], ["In reach of Trait", "Test cite"], "the item's name under the words, and the record's page");
  assert.ok(line.tip.endsWith("Test cite") && line.tip.includes("Trait"), "the tooltip carries the row's own provenance and the page");
  assert.equal(moraleWorkingLine(byLabel.Charm, words), null, "a spell's record keeps its own label");
  const reactionRows = getRecordReactionMods(bearer([fromItem("trait", [reaction(1)])]), page());
  assert.equal(moraleWorkingLine(reactionRows[0], words), null, "a reaction page's row is not a morale roll's working");
});

console.log(`\n${passed} passed`);
