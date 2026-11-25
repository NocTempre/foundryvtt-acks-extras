/**
 * Offline tests for the cast engine (`scripts/magic/cast-*.mjs`): the rows a
 * cast keeps, its caster level, capacity and verdicts, the records it writes,
 * how a record's end is read, what one rolled amount becomes on one target,
 * the relay's checks, the card's view, and the claimant. Foundry-free; every
 * spell, figure and condition below is invented, so this file carries no book
 * content.
 *
 * Usage: node tools/test-magic-cast.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.foundry = { utils: { escapeHTML: (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]) } };
globalThis.game = { i18n: { format: (key) => key, localize: (key) => key } };
globalThis.Roll = class {
  constructor(formula) {
    this.formula = formula;
  }
  async evaluate() {
    this.total = 7;
    this.result = "3 + 4";
    return this;
  }
};

const { keyedRows, rowsOf, rowKeyOf, rowsForMode, pickGroups, optionTokenOf, rowNeedsThrow, saveFractionOf, spellSaves, hasReversedRows, damageOfRow, resistedDamage } = await import("../scripts/magic/cast-rows.mjs");
const Tables = await import("../scripts/lib/tables.mjs");
const { TURN_SECONDS, ROUND_SECONDS } = await import("./time-unit-fixture.mjs");
const { DEFENSES_DOC, RESISTANCE_TABLE } = await import("../scripts/lib/defenses.mjs");
const { casterLevel, levelNeeded } = await import("../scripts/magic/cast-level.mjs");
const { castCapacity, traditionFor, spendsFromPool, spellStanding, isOffList, spellCapacity } = await import("../scripts/magic/cast-capacity.mjs");
const { castVerdicts, blocked, listGate } = await import("../scripts/magic/cast-plan.mjs");
const { spellEffectData, spellEffectOf } = await import("../scripts/magic/spell-effect.mjs");
const { castRecordEnd, endAction, sweepEndedCasts, announceEndedCast } = await import("../scripts/magic/cast-expiry.mjs");
const { castControlOutcome, applyCastControl } = await import("../scripts/magic/cast-control.mjs");
const { damageBounds, checkApplyRequest, applyOnTarget: applyRaw, amountOf, undoEntry, undoEntries, missingGroupKeys, entryId, conditionRecords } = await import("../scripts/magic/cast-apply.mjs");
const { castCardView, castCardContent, CARD_ACTIONS } = await import("../scripts/magic/cast-card.mjs");
const { castSpellClaims, castSpellClaimant, castSpellRun, rollResist, buildTargets, castReach, CAST_SPELL_KEY } = await import("../scripts/magic/cast-spell.mjs");
const { takesTargets } = await import("../scripts/magic/cast-kinds.mjs");
const { dialogContext } = await import("../scripts/magic/apps/cast-dialog-model.mjs");
const { describeSpellEffect } = await import("../scripts/magic/describe.mjs");
const { castDuration, NONE } = await import("../scripts/magic/cast-duration.mjs");
const { heldRecordData } = await import("../scripts/magic/cast-held.mjs");
const { conditionChanges, BROUGHT } = await import("./core-conditions-fixture.mjs");
const { castMoment, declarationOf, MOMENT } = await import("../scripts/magic/cast-moment.mjs");

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};
const ta = async (name, fn) => {
  await fn();
  n++;
  console.log(`ok - ${name}`);
};

/** An invented spell item carrying the given rows in its flag. */
const spell = (rows, extra = {}, over = {}) => ({
  type: "spell",
  name: "Testscorch",
  uuid: "Actor.c1.Item.s1",
  img: "i.png",
  flags: { "acks-extras": { spell: { effects: rows, ...extra } } },
  parent: { isOwner: true, type: "character", uuid: "Actor.c1" },
  ...over,
});
const NO_TWIN = { byCookbookId: () => null, fromUuidSync: () => null };
const dmg = (over = {}) => ({ key: "burn", type: "damage", roll: "2d4", damage: ["fire"], ...over });

/* ------------------------------------------------------------------ */
/*  Rows                                                              */
/* ------------------------------------------------------------------ */

t("rows are the copy's own, else its twin's, else none; a numeric-keyed object reads as rows", () => {
  assert.equal(rowsOf(spell([dmg()]), NO_TWIN).from, "own");
  const twin = spell([dmg({ key: "twinned" })]);
  const bare = spell([], {}, { flags: { "acks-extras": { spell: { effects: [] }, cookbook: { id: "def.spell.testScorch" } } } });
  const lookups = { byCookbookId: (type, id) => (id === "def.spell.testScorch" ? twin : null), fromUuidSync: () => null };
  const got = rowsOf(bare, lookups);
  assert.equal(got.from, "twin");
  assert.equal(got.rows[0].key, "twinned");
  assert.equal(rowsOf(bare, NO_TWIN).from, "none");
  assert.equal(rowsOf(spell({ 0: dmg(), 1: dmg({ key: "b" }) }), NO_TWIN).rows.length, 2);
});

t("a row with no key, or a blank one, is told by its position, never by a nullish default", () => {
  assert.equal(rowKeyOf({ key: "" }, 3), "#3");
  assert.equal(rowKeyOf({}, 0), "#0");
  assert.equal(rowKeyOf({ key: "burn" }, 3), "burn");
});

t("the reverse form keeps its own rows, and a choice group keeps the one picked, else its first", () => {
  const rows = [dmg(), dmg({ key: "mend", reversed: true }), { key: "a", type: "conditionGrant", pick: "g" }, { key: "b", type: "conditionGrant", pick: "g" }, { key: "c", type: "conditionGrant", pick: "solo" }];
  assert.deepEqual(rowsForMode(rows, "normal").map((r) => r.key), ["burn", "a", "c"], "first of the group, a group of one is no choice");
  assert.deepEqual(rowsForMode(rows, "normal", { g: "b" }).map((r) => r.key), ["burn", "b", "c"]);
  assert.deepEqual(rowsForMode(rows, "reversed").map((r) => r.key), ["mend"]);
  assert.deepEqual(pickGroups(rows, "normal").map((g) => [g.id, g.rows.length]), [["g", 2]]);
  assert.equal(hasReversedRows(rows), true);
  assert.equal(hasReversedRows([dmg()]), false);
});

t("rows sharing a pick and a pick option are one option; a pick option token, or the key of one of its rows, names it", () => {
  const rows = [
    { key: "a1", type: "damage", roll: "1d4", damage: ["fire"], pick: "form", pickOption: "flame" },
    { key: "a2", type: "conditionGrant", conditions: ["slowed"], pick: "form", pickOption: " flame " },
    { key: "b1", type: "damage", roll: "1d6", damage: ["cold"], pick: "form", pickOption: "frost" },
    { key: "solo", type: "damage", roll: "1d8", damage: ["fire"], pick: "lone", pickOption: "only" },
    { key: "free", type: "heal", roll: "1d4" },
  ];
  const [group, ...rest] = pickGroups(rows, "normal");
  assert.deepEqual(rest, [], "one option, however many rows, is no choice");
  assert.deepEqual(group.options.map((o) => [o.token, o.rows.map((r) => r.key)]), [["flame", ["a1", "a2"]], ["frost", ["b1"]]]);
  assert.deepEqual(group.rows.map((r) => r.key), ["a1", "a2", "b1"]);
  assert.deepEqual(rowsForMode(rows, "normal").map((r) => r.key), ["a1", "a2", "solo", "free"], "the first option keeps both its rows");
  assert.deepEqual(rowsForMode(rows, "normal", { form: "frost" }).map((r) => r.key), ["b1", "solo", "free"]);
  assert.deepEqual(rowsForMode(rows, "normal", { form: "b1" }).map((r) => r.key), ["b1", "solo", "free"], "a pick stored as a row key still finds its option");
  assert.deepEqual(rowsForMode(rows, "normal", { form: "nothing" }).map((r) => r.key), ["a1", "a2", "solo", "free"], "an unknown pick falls to the first option");
  assert.equal(optionTokenOf({ pickOption: " flame ", key: "a1" }), "flame");
  assert.equal(optionTokenOf({ key: "a1" }), "a1");
  assert.equal(optionTokenOf({}, "#2"), "#2");
  assert.equal(optionTokenOf({}), "");
});

t("a group of rows with no pick option and no key is told by position, and an old group keyed by row key still works", () => {
  const bare = [{ type: "heal", roll: "1d4", pick: "g" }, { type: "heal", roll: "1d6", pick: "g" }];
  assert.deepEqual(pickGroups(bare, "normal")[0].options.map((o) => o.token), ["#0", "#1"]);
  assert.deepEqual(rowsForMode(bare, "normal", { g: "#1" }).map((r) => r.row.roll), ["1d6"]);
  const old = [{ key: "a", type: "conditionGrant", pick: "g" }, { key: "b", type: "conditionGrant", pick: "g" }];
  assert.deepEqual(rowsForMode(old, "normal", { g: "b" }).map((r) => r.key), ["b"]);
});

t("only a damage row with a delivery needs a throw", () => {
  assert.equal(rowNeedsThrow(dmg({ delivery: "melee" })), true);
  assert.equal(rowNeedsThrow(dmg({ delivery: "none" })), false);
  assert.equal(rowNeedsThrow({ type: "heal", delivery: "melee" }), false);
});

t("a save's fraction: negation leaves none, a half leaves half, a failure or no save leaves the whole, anything else is the Judge's", () => {
  const save = { category: "spell", effect: "half" };
  assert.deepEqual(saveFractionOf(dmg(), save, { success: true }), { fraction: 0.5, effect: "half", saved: true });
  assert.equal(saveFractionOf(dmg(), save, { success: false }).fraction, 1);
  assert.equal(saveFractionOf(dmg(), save, null).fraction, 1);
  assert.equal(saveFractionOf(dmg({ saveEffect: "negates" }), save, { success: true }).fraction, 0, "the row's own effect wins");
  assert.equal(saveFractionOf(dmg({ saveEffect: "partial" }), save, { success: true }).fraction, null);
  assert.equal(spellSaves({ category: "spell" }), true);
  assert.equal(spellSaves({ category: "none" }), false);
  assert.equal(spellSaves({ category: "spell", kind: "other" }), false);
});

/* ------------------------------------------------------------------ */
/*  Level, capacity, verdicts                                         */
/* ------------------------------------------------------------------ */

t("the caster level is resolved in order and never defaulted", () => {
  assert.deepEqual(casterLevel({ override: "5", matched: true, classLevel: 3 }), { value: 5, source: "hand", parts: [{ key: "hand", value: 5 }] });
  assert.equal(casterLevel({ matched: true, classLevel: 4 }).source, "class");
  const ladder = { values: [{ atLevel: 1, value: 1 }, { atLevel: 4, value: 3 }] };
  const viaLadder = casterLevel({ matched: true, classLevel: 5, ladder });
  assert.equal(viaLadder.value, 3);
  assert.equal(viaLadder.source, "ladder");
  assert.deepEqual(viaLadder.parts.map((p) => p.key), ["classLevel", "ladder"]);
  assert.equal(casterLevel({ monsterLevel: 6 }).source, "monster");
  assert.deepEqual(casterLevel({ matched: false, classLevel: 4 }), { value: null, source: null, parts: [] }, "an unmatched class names no level");
  assert.equal(casterLevel({ override: 0, matched: true, classLevel: 2 }).source, "class", "a zero is no level");
});

t("a level is asked for only where the duration or a row scales with it", () => {
  assert.equal(levelNeeded({ duration: { shape: "perLevel" } }, []), true);
  assert.equal(levelNeeded({ duration: { shape: "fixed" } }, [dmg()]), false);
  assert.equal(levelNeeded({}, [dmg({ value: { kind: "perLevel", base: 1, per: 1 } })]), true);
  assert.equal(levelNeeded({}, [dmg({ value: 3 })]), false);
});

t("a vancian tradition's slot answers, spent from its pool; a points pool is shown; core's counts answer last; else unknown", () => {
  const pools = [{ key: "arcane", kind: "vancian", slots: [{ n: 1, max: 2, used: 1 }, { n: 2, max: 1, used: 1 }] }, { key: "pts", kind: "points", pool: { max: 5, used: 1 } }];
  const one = castCapacity({ pools, tradition: "arcane", spellLevel: 1 });
  assert.deepEqual([one.verdict, one.source, one.slotKey, one.max, one.used], ["ok", "tradition", "s1", 2, 1]);
  assert.equal(spendsFromPool(one), true);
  assert.equal(castCapacity({ pools, tradition: "arcane", spellLevel: 2 }).verdict, "none");
  assert.equal(castCapacity({ pools, tradition: "arcane", spellLevel: 3 }).verdict, "none", "a level the tradition has no slot at");
  const points = castCapacity({ pools, tradition: "pts", spellLevel: 1 });
  assert.deepEqual([points.verdict, points.source, spendsFromPool(points)], ["unknown", "pool", false]);
  const core = castCapacity({ coreSpells: { 1: { max: 2 } }, castsAtLevel: 2, spellLevel: 1 });
  assert.deepEqual([core.verdict, core.source, spendsFromPool(core)], ["none", "core", false]);
  assert.equal(castCapacity({ coreSpells: { 1: { max: 0 } }, spellLevel: 1 }).verdict, "unknown", "a zero is no setup");
  assert.equal(castCapacity({}).verdict, "unknown");
});

t("the tradition that cast a spell is found by its key or its label against the spell's lists", () => {
  const casting = [{ key: "divine", label: "Divine" }, { key: "arcane", label: "Arcane Magic" }];
  const extras = { lists: [{ source: "arcane", level: 2 }] };
  const found = traditionFor(casting, { extras, lvl: 1 });
  assert.equal(found.tradition.key, "arcane");
  assert.equal(found.spellLevel, 2, "the list's level wins over core's");
  assert.equal(traditionFor(casting, { extras: { lists: [{ source: "nature", level: 1 }] } }), null);
  assert.equal(traditionFor(casting, { extras: {}, class: "Divine" }).tradition.key, "divine", "core's class string stands in where no list is printed");
});

/** An invented spell for the standing: `lists` are `[source, level]`, `ref` is its name. */
const stands = (name, { lists = null, lvl = 1, cls = "", cast = 0 } = {}) => ({ ref: name, name, lvl, class: cls, cast, extras: lists ? { lists: lists.map(([source, level]) => ({ source, level })) } : {} });
const WISP = { key: "wisp", label: "Wisp", kind: "vancian" };
const TIDE = { key: "tide", label: "Tide", kind: "points" };
const POOLS = [{ key: "wisp", kind: "vancian", slots: [{ n: 1, max: 2, used: 1 }, { n: 2, max: 1, used: 0 }] }, { key: "tide", kind: "points", pool: { max: 4, used: 1 } }];
const refs = (spells) => spells.map((s) => s.ref);

t("with no class, or a class that casts from no list, the standing is the sheet's grid by level with core's typed maximum and the count per spell", () => {
  const spells = [stands("Bolt", { lvl: 2, cast: 3 }), stands("Aflame", { lists: [["wisp", 1]], cast: 1 }), stands("Hush", { cast: 2 })];
  for (const casting of [undefined, [], [{ label: "No key" }]]) {
    const out = spellStanding({ casting, pools: POOLS, spells, coreSpells: { 1: { max: 4 } } });
    assert.deepEqual([out.mode, out.groups, out.other], ["levels", [], []]);
    assert.deepEqual(out.levels.map((l) => [l.level, l.used, l.max, refs(l.spells)]), [[1, 3, 4, ["Aflame", "Hush"]], [2, 3, 0, ["Bolt"]]], "by the level on the spell, by name, summing the counts");
  }
  assert.deepEqual(spellStanding({}).levels, []);
});

t("a class that casts from lists gives a group per tradition in its order, its slot row per level from its pool, and the spells that name it", () => {
  const spells = [stands("Bolt", { lists: [["wisp", 2]] }), stands("Aflame", { lists: [["wisp", 1]] }), stands("Drift", { lists: [["tide", 3]] })];
  const out = spellStanding({ casting: [WISP, TIDE], pools: POOLS, spells });
  assert.equal(out.mode, "lists");
  assert.deepEqual(out.levels, []);
  assert.deepEqual(out.groups.map((g) => [g.key, g.label, g.kind]), [["wisp", "Wisp", "vancian"], ["tide", "Tide", "points"]]);
  assert.deepEqual(out.groups[0].levels.map((l) => [l.level, l.slot, refs(l.spells)]), [[1, { used: 1, max: 2 }, ["Aflame"]], [2, { used: 0, max: 1 }, ["Bolt"]]]);
  assert.deepEqual([out.groups[0].pool, out.groups[0].note], [null, ""]);
});

t("a level the pool gives slots at has its row though no spell stands there, and a spell's level with no slot has no row", () => {
  const out = spellStanding({ casting: [WISP], pools: POOLS, spells: [stands("High", { lists: [["wisp", 5]] })] });
  assert.deepEqual(out.groups[0].levels.map((l) => [l.level, l.slot, refs(l.spells)]), [[1, { used: 1, max: 2 }, []], [2, { used: 0, max: 1 }, []], [5, null, ["High"]]]);
});

t("a spell on two of the class's lists is under both headings, each at that list's own level, naming the other", () => {
  const out = spellStanding({ casting: [WISP, TIDE], pools: POOLS, spells: [stands("Aflame", { lists: [["wisp", 1], ["tide", 3]] })] });
  const [inWisp] = out.groups[0].levels.flatMap((l) => l.spells);
  const [inTide] = out.groups[1].levels.flatMap((l) => l.spells);
  assert.deepEqual([inWisp.level, inWisp.own.label, inWisp.also.map((l) => [l.label, l.level])], [1, "Wisp", [["Tide", 3]]]);
  assert.deepEqual([inTide.level, inTide.own.label, inTide.also.map((l) => [l.label, l.level])], [3, "Tide", [["Wisp", 1]]]);
  assert.deepEqual(out.other, []);
});

t("a list matches a tradition by its key or its label, folded, and core's class string stands in where the spell names no list", () => {
  const out = spellStanding({ casting: [{ key: "w1", label: "Wisp Craft", kind: "vancian" }], pools: [], spells: [stands("A", { lists: [["WISP-craft", 2]] }), stands("B", { cls: "Wisp Craft", lvl: 4 }), stands("C", { cls: "Other" })] });
  assert.deepEqual(out.groups[0].levels.map((l) => [l.level, refs(l.spells)]), [[2, ["A"]], [4, ["B"]]]);
  assert.deepEqual(out.groups[0].levels.flatMap((l) => l.spells).map((s) => s.own.fromClass), [false, true]);
  assert.deepEqual(refs(out.other.flatMap((l) => l.spells)), ["C"]);
});

t("a spell on no list the class casts from is in Other at core's level: off a list where it names another, on none where it names none", () => {
  const spells = [stands("Alien", { lists: [["gust", 2]], lvl: 1 }), stands("Bare", { lvl: 3 }), stands("Own", { lists: [["wisp", 1]] })];
  const out = spellStanding({ casting: [WISP], pools: POOLS, spells });
  assert.deepEqual(out.other.map((l) => [l.level, l.spells.map((s) => [s.ref, s.offList, s.own, s.also.length, s.lists.map((x) => x.label)])]), [[1, [["Alien", true, null, 0, ["Gust"]]]], [3, [["Bare", false, null, 0, []]]]]);
  assert.deepEqual(refs(out.groups[0].levels.flatMap((l) => l.spells)), ["Own"], "a spell on a list of the class is not in Other");
});

t("a tradition with no slot row at this level still has its heading, a points list has its pool and a ladder its text, none with a slot row per level", () => {
  const out = spellStanding({
    casting: [WISP, TIDE, { key: "gleam", label: "Gleam", kind: "gnostic" }],
    pools: [POOLS[1], { key: "gleam", kind: "gnostic", capacity: "Testreach" }],
    spells: [stands("Drift", { lists: [["tide", 3]] }), stands("Glow", { lists: [["gleam", 2]] })],
  });
  assert.deepEqual(out.groups.map((g) => g.key), ["wisp", "tide", "gleam"]);
  assert.deepEqual([out.groups[0].levels, out.groups[0].pool], [[], null]);
  assert.deepEqual([out.groups[1].pool, out.groups[1].levels.map((l) => [l.level, l.slot])], [{ used: 1, max: 4 }, [[3, null]]]);
  assert.deepEqual([out.groups[2].note, out.groups[2].pool, out.groups[2].levels.map((l) => [l.level, l.slot])], ["Testreach", null, [[2, null]]]);
});

t("a spell with no level reads at level zero, as the sheet's own grid reads it", () => {
  const out = spellStanding({ casting: [WISP], pools: [], spells: [stands("Lost", { lists: [["wisp", ""]], lvl: "" })] });
  assert.deepEqual(out.groups[0].levels.map((l) => l.level), [0]);
});

t("a Player is blocked and a Judge warned: no slot, several targets for a throw row, a condition that stops casting", () => {
  const rows = [{ row: dmg({ delivery: "melee" }) }];
  const none = { verdict: "none" };
  const asPlayer = castVerdicts({ capacity: none, targets: [1, 2], rows, statuses: [], isGM: false });
  assert.deepEqual(asPlayer.map((v) => v.key), ["noSlot", "severalTargets"]);
  assert.equal(blocked(asPlayer), true);
  const asJudge = castVerdicts({ capacity: none, targets: [1, 2], rows, statuses: [], isGM: true });
  assert.equal(blocked(asJudge), false);
  assert.ok(asJudge.every((v) => v.severity === "warn"));
  assert.deepEqual(castVerdicts({ capacity: { verdict: "ok" }, targets: [1, 2], rows: [{ row: dmg() }], statuses: [], isGM: false }), [], "several targets are fine for a row with no throw");
});

/* ------------------------------------------------------------------ */
/*  Records and their end                                             */
/* ------------------------------------------------------------------ */

const base = { spell: { uuid: "Actor.c1.Item.s1", name: "Testscorch", img: "i.png" }, caster: { uuid: "Actor.c1" }, castId: "cast1", role: "recipient" };

t("a record names one condition and holds only what the builder returned for it; a condition record is timed by its flag", () => {
  assert.throws(() => spellEffectData({ ...base, statuses: ["a", "b"] }), /exactly what the builder returned/);
  assert.throws(() => spellEffectData({ ...base, statuses: ["a"], changes: [{ key: "k", mode: 2, value: "1" }] }), /system changes and no others/);
  assert.throws(() => spellEffectData({ ...base, statuses: ["a"], system: { changes: conditionChanges("blessed") } }), /exactly what the builder returned/, "a figure with no builder's word");
  const data = spellEffectData({ ...base, statuses: ["a"], rowKey: "dread", duration: { value: 60, units: "seconds" }, startTime: 100 });
  assert.deepEqual(data.statuses, ["a"]);
  assert.equal(data.duration, undefined, "core's duration stays unset");
  const mark = spellEffectOf(data);
  assert.deepEqual([mark.rowKey, mark.startTime, mark.duration], ["dread", 100, { value: 60, units: "seconds" }]);
  const summon = spellEffectData({ ...base, role: "caster", duration: { value: 3, units: "minutes" } });
  assert.deepEqual(summon.duration, { value: 3, units: "minutes" }, "a summoning's record keeps core's duration");
  assert.equal(spellEffectOf(summon).startTime, undefined);
});

/** What the builder returns for a condition of the fixture: its own status, the one it brings, and the merged changes. */
const builtFor = (id) => {
  const brought = BROUGHT[id];
  return { name: `core.${id}`, statuses: brought ? [id, brought] : [id], system: { changes: [...conditionChanges(id), ...(brought ? conditionChanges(brought) : [])] } };
};

t("a record of a condition holds the builder's changes; a state that brings one holds both statuses and the merged changes, and nothing else is admitted", () => {
  const blessed = builtFor("blessed");
  const own = spellEffectData({ ...base, statuses: blessed.statuses, system: blessed.system, condition: blessed, startTime: 5 });
  assert.deepEqual(own.statuses, ["blessed"]);
  assert.deepEqual(own.system.changes, conditionChanges("blessed"));
  assert.equal(own.changes, undefined, "the figures ride at system.changes alone, with no second list beside them");
  assert.deepEqual(spellEffectData({ ...base, statuses: ["plain"], system: { changes: [] }, condition: { statuses: ["plain"] } }).changes, [], "a record with no figure keeps its empty list");
  assert.equal(Object.hasOwn(own, "_id"), false, "a record is its own document");
  const charging = builtFor("charging");
  const both = spellEffectData({ ...base, statuses: charging.statuses, system: charging.system, condition: charging });
  assert.deepEqual(both.statuses, ["charging", "disordered"]);
  assert.deepEqual(both.system.changes, [...conditionChanges("charging"), ...conditionChanges("disordered")]);
  both.system.changes[0].value = 0;
  assert.equal(charging.system.changes[0].value, conditionChanges("charging")[0].value, "the record copies the builder's rows");
  const mark = spellEffectOf(both);
  assert.equal(mark.castId, "cast1");
  // a status the builder did not bring, a change it did not return, a missing builder: each refused
  assert.throws(() => spellEffectData({ ...base, statuses: ["charging", "shaken"], system: charging.system, condition: charging }), /exactly what the builder returned/);
  assert.throws(() => spellEffectData({ ...base, statuses: charging.statuses, system: { changes: conditionChanges("blessed") }, condition: charging }), /exactly what the builder returned/);
  assert.throws(() => spellEffectData({ ...base, statuses: charging.statuses, system: charging.system }), /exactly what the builder returned/);
  assert.throws(() => spellEffectData({ ...base, system: blessed.system, condition: blessed }), /exactly what the builder returned/, "a figure with no status of its own");
});

t("a buff record and a pending declaration still hold no status and no changes, the builder's included", () => {
  const blessed = builtFor("blessed");
  const flag = { id: null, label: "L", cite: "", sourceAlignment: null, parts: [] };
  assert.throws(() => spellEffectData({ ...base, rollMods: flag, statuses: blessed.statuses, system: blessed.system, condition: blessed }), /buff record holds no status/);
  assert.throws(() => spellEffectData({ ...base, rollMods: flag, system: blessed.system, condition: blessed }), /buff record holds no status/);
  assert.throws(() => spellEffectData({ ...base, pending: { spellUuid: "S" }, statuses: blessed.statuses, system: blessed.system, condition: blessed }), /pending declaration holds no status/);
});

const SECS ={ seconds: 1, minutes: 50 };
const secondsOf = (value, units) => (units in SECS ? value * SECS[units] : null);
const flagged = (over = {}, mark = {}) => ({
  uuid: over.uuid ?? "Actor.c1.ActiveEffect.e1",
  id: over.id ?? "e1",
  parent: over.parent,
  flags: { "acks-extras": { spellEffect: { spellUuid: "s", castId: "cast1", casterUuid: "Actor.c1", role: "recipient", startTime: 100, duration: { value: 30, units: "seconds" }, ...mark } } },
});

t("a record's end is read from its flag first, and a core-timed record still reads core's", () => {
  assert.equal(castRecordEnd(flagged(), secondsOf), 130);
  const core = { _source: { start: { time: 10 }, duration: { value: 2, units: "minutes" } }, flags: { "acks-extras": { spellEffect: { castId: "c", role: "caster" } } } };
  assert.equal(castRecordEnd(core, secondsOf), 110);
});

t("the clock announces a core-timed caster record, deletes a flag-timed one of either side, and leaves the rest", () => {
  const at = (effect, worldTime) => endAction(effect, { worldTime, secondsOf });
  assert.equal(at(flagged(), 129), null);
  assert.equal(at(flagged(), 130), "delete");
  assert.equal(at(flagged({}, { role: "caster" }), 200), "delete");
  const summon = { _source: { start: { time: 10 }, duration: { value: 2, units: "minutes" } }, flags: { "acks-extras": { spellEffect: { castId: "c", role: "caster" } } } };
  assert.equal(at(summon, 500), "announce");
  assert.equal(at({ ...summon, flags: { "acks-extras": { spellEffect: { castId: "c", role: "recipient" } } } }, 500), null, "a core-timed recipient is no one's to end");
  assert.equal(at(flagged({}, { ended: 140 }), 500), null);
  assert.equal(at({ flags: {} }, 500), null);
});

await ta("the sweep deletes a flag-timed record by id and leaves the same cast's other record until its own end", async () => {
  const removed = [];
  const first = flagged({ uuid: "u1", id: "e1" });
  const second = flagged({ uuid: "u2", id: "e2" }, { startTime: 120 });
  const actors = [{ effects: [first, second] }];
  const deps = { secondsOf, remove: async (e) => { removed.push(e.id); actors[0].effects.splice(actors[0].effects.indexOf(e), 1); }, stamp: async () => {}, standing: () => [], post: async () => {} };
  const out = await sweepEndedCasts(actors, { ...deps, worldTime: 135 });
  assert.deepEqual(removed, ["e1"], "the first ended, the second has time left");
  assert.deepEqual(out, [{ deleted: true, uuid: "u1" }]);
  await sweepEndedCasts(actors, { ...deps, worldTime: 151 });
  assert.deepEqual(removed, ["e1", "e2"], "the second goes at its own end");
});

await ta("a summoning's end counts what its cast holds in a party token, and posts the held with the tokens", async () => {
  const mark = { spellUuid: "s", castId: "cast1", casterUuid: "Actor.c1", role: "caster" };
  const doc = { uuid: "u", _source: { start: { time: 0 }, duration: { value: 1, units: "minutes" } }, flags: { "acks-extras": { spellEffect: mark } } };
  const posted = [];
  const deps = { worldTime: 99, stamp: async () => {}, standing: () => ({ tokens: [], held: [{ partyId: "p", actorId: "a" }] }), post: async (o) => posted.push(o) };
  assert.deepEqual(await announceEndedCast(doc, deps), { posted: true, n: 1 });
  assert.equal(posted[0].held.length, 1);
  assert.equal(posted[0].tokens.length, 0);
  const none = { ...doc, uuid: "u2" };
  assert.deepEqual(await announceEndedCast(none, { ...deps, standing: () => ({ tokens: [], held: [] }) }), { posted: false, reason: "noneStanding" });
});

/** A caster of invented creatures: its spell `sp1` carries these summon rows, and `at(token)` is a standing creature whose record names the cast, the spell and the creature by `name`. */
const ctlCaster = (rows) => ({ uuid: "Actor.c1", items: { get: (id) => (id === "sp1" ? { type: "spell", id: "sp1", flags: { "acks-extras": { spell: { effects: rows } } } } : null) } });
const ctlRecord = (name, over = {}) => ({ sourceUuid: `Actor.${name}`, name, castId: "cast1", spellId: "sp1", at: 0, ...over });
const ctlToken = (name, id, over) => ({ uuid: `Scene.s1.Token.${id}`, id, name, actor: { getFlag: (_m, key) => ({ summonedBy: "Actor.c1", summon: ctlRecord(name, over) })[key] ?? null } });
const ctlLookups = { byCookbookId: () => null, fromUuidSync: () => null };

t("the control end is the spell row's word for the creature the cast made, and stays wherever no row says otherwise", () => {
  const row = (name, controlEnd) => ({ type: "summon", ref: name, name, amount: 1, controlEnd });
  const found = (name) => ({ tokens: [ctlToken(name, "t1")], held: [] });
  const two = ctlCaster([row("Alphamoth", "gone"), row("Betamoth", "hostile")]);
  assert.equal(castControlOutcome(two, found("Alphamoth"), ctlLookups), "gone");
  assert.equal(castControlOutcome(two, found("Betamoth"), ctlLookups), "hostile", "the row that names this creature, not the first row");
  assert.equal(castControlOutcome(ctlCaster([row("Alphamoth", "gone")]), found("Strangemoth"), ctlLookups), "gone", "no row names it, and the rows agree");
  assert.equal(castControlOutcome(ctlCaster([row("Alphamoth", "gone"), row("Betamoth", "hostile")]), found("Strangemoth"), ctlLookups), "stays", "no row names it and the rows differ");
  assert.equal(castControlOutcome(ctlCaster([row("Alphamoth", "")]), found("Alphamoth"), ctlLookups), "stays", "a blank key reads as stays");
  assert.equal(castControlOutcome(ctlCaster([row("Alphamoth", "vanish")]), found("Alphamoth"), ctlLookups), "stays", "an unknown word reads as stays");
  assert.equal(castControlOutcome(ctlCaster([]), found("Alphamoth"), ctlLookups), "stays", "a spell with no row");
  assert.equal(castControlOutcome(two, { tokens: [ctlToken("Alphamoth", "t1", { spellId: "gone" })], held: [] }, ctlLookups), "stays", "a spell no longer on the caster");
  assert.equal(castControlOutcome(two, { tokens: [], held: [{ name: "Betamoth", record: ctlRecord("Betamoth") }] }, ctlLookups), "hostile", "a stashed creature is read by its record");
  assert.equal(castControlOutcome(two, { tokens: [], held: [] }, ctlLookups), "stays");
});

await ta("applying a cast's control end resolves the outcome from the spell and hands it, with the cast id alone, to lib; a cast with nothing standing asks nothing", async () => {
  const caster = ctlCaster([{ type: "summon", ref: "Alphamoth", name: "Alphamoth", amount: 1, controlEnd: "gone" }]);
  const applied = [];
  const deps = { caster: () => caster, standing: () => ({ tokens: [ctlToken("Alphamoth", "t1")], held: [] }), lookups: ctlLookups, apply: async (who, o) => (applied.push([who.uuid, o]), { ok: true, outcome: o.outcome }) };
  assert.deepEqual(await applyCastControl({ casterUuid: "Actor.c1", castId: "cast1", outcome: "hostile" }, deps), { ok: true, outcome: "gone" }, "a request's outcome is never read");
  assert.deepEqual(applied, [["Actor.c1", { castId: "cast1", outcome: "gone" }]]);
  const empty = await applyCastControl({ casterUuid: "Actor.c1", castId: "cast1" }, { ...deps, standing: () => ({ tokens: [], held: [] }), apply: async () => assert.fail("nothing stands") });
  assert.equal(empty.ok, true);
  assert.equal(empty.outcome, "stays");
  assert.deepEqual(await applyCastControl({ casterUuid: "Actor.none", castId: "cast1" }, { ...deps, caster: () => null }), { ok: false, reason: "noCaster" });
});

await ta("at a timed end creatures that go post no card, while creatures that stay or turn hostile keep theirs; the outcome rides to the card, and with nothing applied the card is as it was", async () => {
  const mark = { spellUuid: "s", castId: "cast1", casterUuid: "Actor.c1", role: "caster" };
  const doc = (uuid) => ({ uuid, _source: { start: { time: 0 }, duration: { value: 1, units: "minutes" } }, flags: { "acks-extras": { spellEffect: mark } } });
  const posted = [];
  const asked = [];
  const run = async (uuid, control) => announceEndedCast(doc(uuid), { worldTime: 99, stamp: async () => {}, standing: () => ({ tokens: [{ uuid: "T.1" }], held: [] }), post: async (o) => posted.push(o), control: control && (async (record) => (asked.push(record.castId), control)) });
  assert.deepEqual(await run("g", { ok: true, outcome: "gone" }), { posted: false, reason: "gone", n: 1, outcome: "gone" });
  assert.equal(posted.length, 0, "no card for creatures that went");
  assert.deepEqual(asked, ["cast1"], "asked of the record's own cast");
  assert.deepEqual(await run("u", { ok: true, outcome: "gone", unapplied: 1 }), { posted: true, n: 1, outcome: "gone" }, "creatures that could not be removed keep the card");
  posted.pop();
  assert.deepEqual(await run("h", { ok: true, outcome: "hostile" }), { posted: true, n: 1, outcome: "hostile" });
  assert.deepEqual(await run("s", { ok: true, outcome: "stays" }), { posted: true, n: 1, outcome: "stays" });
  assert.deepEqual(posted.map((p) => p.outcome), ["hostile", "stays"]);
  assert.deepEqual(await run("n", null), { posted: true, n: 1 }, "no GM answered: the card is posted and claims no outcome");
  assert.deepEqual(await run("r", { ok: false, reason: "noCaster" }), { posted: true, n: 1 });
  assert.equal(posted.at(-1).outcome, null);
});

/* ------------------------------------------------------------------ */
/*  Applying                                                          */
/* ------------------------------------------------------------------ */

t("bounds: a thrown row keeps the floor of one and doubles on a critical; a row with no throw has neither", () => {
  const bounds = () => ({ min: 0, max: 8 });
  assert.deepEqual(damageBounds({ formula: "2d4" }, {}, bounds), { min: 0, max: 8 });
  assert.deepEqual(damageBounds({ formula: "2d4" }, { thrown: true }, bounds), { min: 1, max: 8 });
  assert.deepEqual(damageBounds({ formula: "2d4" }, { thrown: true, critical: true }, bounds), { min: 1, max: 16 });
  assert.equal(damageBounds(null, {}, bounds), null);
});

const card = (over = {}) => ({
  castId: "cast1",
  spellUuid: "Actor.c1.Item.s1",
  spellName: "Testscorch",
  casterUuid: "Actor.c1",
  mode: "normal",
  save: { category: "spell", effect: "half" },
  duration: { value: 60, units: "seconds" },
  rows: { burn: { type: "damage", key: "burn", types: ["fire"], total: 7, formula: "2d4", detail: "3 + 4", conditions: [], delivery: "" } },
  order: ["burn"],
  targets: { t1: { uuid: "Scene.s.Token.k1", name: "Target", resist: { kind: "save", category: "spell", formula: "1d20", total: 14, target: 13, success: true, parts: [] } } },
  entries: { t1_burn: { state: "pending" } },
  ...over,
});

t("a relayed request is refused for every wrong thing about it, and passes when each is right", () => {
  const rows = [{ row: dmg(), key: "burn" }, { row: { key: "dread", type: "conditionGrant", conditions: ["afraid"] }, key: "dread" }];
  const world = (over = {}) => ({
    message: { authorId: "p1" },
    card: card(),
    ownsCaster: true,
    spellOfCaster: true,
    rows,
    resist: { target: 13, min: 1, max: 20 },
    boundsOf: () => ({ min: 0, max: 8 }),
    ...over,
  });
  const req = (over = {}) => ({ requestUserId: "p1", messageId: "m", targetKey: "t1", resist: card().targets.t1.resist, entries: [{ rowKey: "burn", rolled: 7 }], ...over });
  assert.deepEqual(checkApplyRequest(req(), world()), { ok: true });
  assert.equal(checkApplyRequest(req(), world({ message: null })).refused, "noCard");
  assert.equal(checkApplyRequest(req({ requestUserId: "p2" }), world()).refused, "notAuthor");
  assert.equal(checkApplyRequest(req(), world({ ownsCaster: false })).refused, "notOwner");
  assert.equal(checkApplyRequest(req(), world({ spellOfCaster: false })).refused, "badSpell");
  assert.equal(checkApplyRequest(req({ targetKey: "t9" }), world()).refused, "badTarget");
  assert.equal(checkApplyRequest(req({ resist: null }), world()).refused, "badResist", "a resist the card holds cannot be left out");
  assert.equal(checkApplyRequest(req({ resist: { ...card().targets.t1.resist, total: 3 } }), world()).refused, "badResist", "nor changed");
  assert.equal(checkApplyRequest(req(), world({ resist: { target: 15, min: 1, max: 20 } })).refused, "badResist", "the target is recomputed here");
  assert.equal(checkApplyRequest(req(), world({ resist: { target: 13, min: 1, max: 12 } })).refused, "badResist", "a total outside the formula's reach");
  assert.equal(checkApplyRequest(req({ entries: [{ rowKey: "nope", rolled: 1 }] }), world()).refused, "badRow");
  assert.equal(checkApplyRequest(req({ entries: [{ rowKey: "burn", rolled: 9 }] }), world()).refused, "badAmount");
  assert.equal(checkApplyRequest(req({ entries: [{ rowKey: "burn", rolled: "x" }] }), world()).refused, "badAmount");
  assert.equal(checkApplyRequest(req(), world({ card: card({ entries: { t1_burn: { state: "applied" } } }) })).refused, "applied");
  assert.equal(checkApplyRequest(req({ requestUserId: null, entries: [{ rowKey: "dread" }] }), world()).ok, true, "a GM's own request, and a condition row has no amount");
});

/** The spell's own keyed rows, as the relay reads them off the spell; these fixtures' card rows carry the same fields. */
const spellRowsOf = (c) => Object.values(c.rows).map((r) => ({ key: r.key, row: r }));
const SPELL_AS_READ = { uuid: "Actor.c1.Item.s1", name: "Testscorch", img: "i.png", id: "def.spell.testScorch", cite: "p. 9" };
/** `applyOnTarget` with the inputs a live write takes from the spell and not from the card. */
const applyOnTarget = (c, targetKey, requests, deps) => applyRaw(c, targetKey, requests, { rows: spellRowsOf(c), duration: c.duration, spell: SPELL_AS_READ, ...deps });

/** The writes an apply makes, recorded. */
function fakeDeps(over = {}) {
  const log = { hp: [], lost: [], made: [], entries: {} };
  const actor = { name: "Target", id: "a1" };
  const hpTarget = { key: "Scene.s.Token.k1", hp: { value: 20, max: 20 } };
  const deps = {
    messageId: "m1",
    resolve: async () => ({ actor, hpTarget }),
    adjustHp: async (entries, { mode }) => {
      log.hp.push({ mode, amount: entries[0].amount, multiplier: entries[0].multiplier });
      return [{ ok: true, before: 20, after: mode === "heal" ? 20 : 20 - entries[0].amount }];
    },
    lose: async (a, cause) => {
      log.lost.push(cause);
      return [];
    },
    createRecords: async (a, datas) => {
      log.made.push(...datas);
      log.order = [...(log.order ?? []), "create"];
      return datas.map((_, i) => `r${log.made.length}${i}`);
    },
    writeEntry: async (id, entry) => {
      log.entries[id] = entry;
    },
    now: () => 500,
    by: "u1",
    ...over,
  };
  return { deps, log };
}

await ta("a saved half of an odd roll rounds to the even whole, a failed save takes the whole, and the amount goes through adjustHp once with multiplier 1", async () => {
  const { deps, log } = fakeDeps();
  const odd = card({ rows: { burn: { ...card().rows.burn, total: 7 } } });
  await applyOnTarget(odd, "t1", [{ rowKey: "burn", rolled: 7 }], deps);
  assert.deepEqual(log.hp, [{ mode: "damage", amount: 4, multiplier: 1 }], "7 halved is 3.5, to the even 4");
  assert.equal(log.entries.t1_burn.applied, 4);
  assert.equal(log.entries.t1_burn.before, 20);
  assert.deepEqual(log.lost, [], "a passed save loses nothing");
  const fives = fakeDeps();
  await applyOnTarget(odd, "t1", [{ rowKey: "burn", rolled: 5 }], fives.deps);
  assert.equal(fives.log.hp[0].amount, 2, "2.5 goes to the even 2, not up");
  const failed = fakeDeps();
  const failing = card({ targets: { t1: { ...card().targets.t1, resist: { ...card().targets.t1.resist, total: 5, success: false } } } });
  await applyOnTarget(failing, "t1", [{ rowKey: "burn", rolled: 7 }], failed.deps);
  assert.equal(failed.log.hp[0].amount, 7);
  assert.deepEqual(failed.log.lost, ["save"], "a failed save runs the loss path, once");
});

await ta("a roll of one, halved, applies nothing and writes no hit points; a negated save applies nothing", async () => {
  const { deps, log } = fakeDeps();
  await applyOnTarget(card(), "t1", [{ rowKey: "burn", rolled: 1 }], deps);
  assert.equal(log.hp.length, 0);
  assert.equal(log.entries.t1_burn.applied, 0);
  const negate = fakeDeps();
  const c = card({ rows: { burn: { ...card().rows.burn, saveEffect: "negates" } } });
  await applyOnTarget(c, "t1", [{ rowKey: "burn", rolled: 7 }], negate.deps);
  assert.equal(negate.log.hp.length, 0);
});

await ta("a passed save with an effect the module cannot price is left to the Judge", async () => {
  const { deps, log } = fakeDeps();
  const c = card({ rows: { burn: { ...card().rows.burn, saveEffect: "partial" } } });
  await applyOnTarget(c, "t1", [{ rowKey: "burn", rolled: 7 }], deps);
  assert.equal(log.hp.length, 0);
  assert.equal(log.entries.t1_burn.state, "judge");
});

await ta("a heal is written as a heal, and an entry already written is skipped", async () => {
  const { deps, log } = fakeDeps();
  const heal = card({ save: { category: "", effect: "" }, rows: { mend: { type: "heal", key: "mend", total: 5, conditions: [] } }, order: ["mend"], targets: { t1: { uuid: "Scene.s.Token.k1", name: "T", resist: null } }, entries: { t1_mend: { state: "pending" } } });
  const out = await applyOnTarget(heal, "t1", [{ rowKey: "mend", rolled: 5 }], deps);
  assert.deepEqual(log.hp, [{ mode: "heal", amount: 5, multiplier: 1 }]);
  assert.equal(out[0].entry.state, "applied");
  const again = await applyOnTarget(card({ entries: { t1_burn: { state: "applied" } } }), "t1", [{ rowKey: "burn", rolled: 7 }], fakeDeps().deps);
  assert.deepEqual(again, [{ id: "t1_burn", skipped: "applied" }]);
});

await ta("a condition cast twice on one target leaves two status-only records, each its own and timed by its row", async () => {
  const grant = { type: "conditionGrant", key: "dread", conditions: ["afraid"], lasts: "duration", total: null };
  const c = card({ save: { category: "", effect: "" }, rows: { dread: grant }, order: ["dread"], targets: { t1: { uuid: "Scene.s.Token.k1", name: "T", resist: null } }, entries: { t1_dread: { state: "pending" } } });
  const { deps, log } = fakeDeps();
  await applyOnTarget(c, "t1", [{ rowKey: "dread" }], deps);
  const second = { ...c, castId: "cast2" };
  await applyOnTarget(second, "t1", [{ rowKey: "dread" }], deps);
  assert.equal(log.made.length, 2);
  for (const data of log.made) {
    assert.deepEqual(data.statuses, ["afraid"]);
    assert.deepEqual(data.changes, [], "a status record holds no changes");
    assert.equal(data.duration, undefined);
  }
  assert.deepEqual(log.made.map((d) => spellEffectOf(d).castId), ["cast1", "cast2"]);
  assert.deepEqual(spellEffectOf(log.made[0]).duration, { value: 60, units: "seconds" });
  assert.equal(spellEffectOf(log.made[0]).startTime, 500);
  assert.equal(log.entries.t1_dread.recordIds.length, 1);
});

await ta("a condition row writes each record as the effect the builder returns for it: the figure of a change-carrying condition, both statuses and the merged figures of a state that brings one, never a static id", async () => {
  const grant = { type: "conditionGrant", key: "dread", conditions: ["blessed", "charging", "plain"], lasts: "duration", total: null };
  const c = card({ save: { category: "", effect: "" }, rows: { dread: grant }, order: ["dread"], targets: { t1: { uuid: "Scene.s.Token.k1", name: "T", resist: null } }, entries: { t1_dread: { state: "pending" } } });
  const asked = [];
  const conditionData = async (id) => (asked.push(id), id === "plain" ? { name: id, statuses: [id] } : { ...builtFor(id), _id: "StaticInvented001" });
  const { deps, log } = fakeDeps({ conditionData });
  await applyOnTarget(c, "t1", [{ rowKey: "dread" }], deps);
  assert.deepEqual(asked, ["blessed", "charging", "plain"], "the builder is asked once for each condition the row writes");
  const [blessed, charging, plain] = log.made;
  assert.deepEqual([blessed.statuses, blessed.system.changes], [["blessed"], conditionChanges("blessed")]);
  assert.deepEqual([charging.statuses, charging.system.changes], [["charging", "disordered"], [...conditionChanges("charging"), ...conditionChanges("disordered")]]);
  assert.deepEqual([plain.statuses, plain.system], [["plain"], undefined], "a condition with no figure carries none");
  for (const data of log.made) {
    assert.equal(Object.hasOwn(data, "_id"), false, "a cast's record is its own document, not the token toggle's");
    assert.equal(data.name, "Testscorch", "the record is the spell's, not the entry's");
    assert.deepEqual(spellEffectOf(data).rowKey, "dread");
    assert.equal(spellEffectOf(data).startTime, 500, "timed by its flag");
  }
  const bare = fakeDeps();
  await applyOnTarget(c, "t1", [{ rowKey: "dread" }], bare.deps);
  assert.deepEqual(bare.log.made.map((d) => d.statuses), [["blessed"], ["charging"], ["plain"]], "with no builder a record holds its own status alone");
});

t("conditionRecords takes what was built for each status and writes a status-free record for an anchor whatever it holds", () => {
  const grant = { type: "conditionGrant", key: "dread", conditions: ["charging"], lasts: "duration" };
  const c = card();
  const built = { charging: builtFor("charging") };
  const [record] = conditionRecords(grant, c, { startTime: 1, spell: { img: "i" }, built });
  assert.deepEqual(record.statuses, ["charging", "disordered"]);
  assert.equal(record.system.changes.length, conditionChanges("charging").length + conditionChanges("disordered").length);
  const [anchor] = conditionRecords(grant, c, { startTime: 1, spell: { img: "i" }, anchor: true, built });
  assert.equal(anchor.statuses, undefined);
  assert.equal(anchor.system, undefined);
});

await ta("the loss a failed save costs runs before the cast's own condition is written", async () => {
  const grant = { type: "conditionGrant", key: "dread", conditions: ["afraid"], lasts: "duration" };
  const resist = { kind: "save", category: "spell", formula: "1d20", total: 2, target: 13, success: false, parts: [] };
  const c = card({ rows: { dread: grant }, order: ["dread"], targets: { t1: { uuid: "x", name: "T", resist } }, entries: { t1_dread: { state: "pending" } } });
  const order = [];
  const { deps } = fakeDeps({ lose: async () => order.push("lose"), createRecords: async (a, d) => (order.push("create"), d.map(() => "r")) });
  await applyOnTarget(c, "t1", [{ rowKey: "dread" }], deps);
  assert.deepEqual(order, ["lose", "create"]);
});

await ta("a passed save that negates leaves the condition off", async () => {
  const grant = { type: "conditionGrant", key: "dread", conditions: ["afraid"] };
  const resist = { kind: "save", category: "spell", formula: "1d20", total: 18, target: 13, success: true, parts: [] };
  const c = card({ save: { category: "spell", effect: "negates" }, rows: { dread: grant }, order: ["dread"], targets: { t1: { uuid: "x", name: "T", resist } }, entries: { t1_dread: { state: "pending" } } });
  const { deps, log } = fakeDeps();
  await applyOnTarget(c, "t1", [{ rowKey: "dread" }], deps);
  assert.equal(log.made.length, 0);
  assert.equal(log.entries.t1_dread.applied, 0);
});

await ta("undo puts the hit points back and deletes the records it made by id, once", async () => {
  const calls = { restored: [], deleted: [] };
  const deps = {
    resolve: async () => ({ actor: { id: "a" }, hpTarget: { key: "k" } }),
    restoreHp: async (results) => calls.restored.push(results),
    deleteRecords: async (actor, ids) => calls.deleted.push(ids),
  };
  const entry = { state: "applied", before: 20, after: 16, recordIds: ["r1"] };
  const next = await undoEntry(entry, { uuid: "x" }, deps);
  assert.equal(next.state, "undone");
  assert.deepEqual(calls.restored[0][0], { target: { key: "k" }, ok: true, before: 20, after: 16 });
  assert.deepEqual(calls.deleted, [["r1"]]);
  assert.equal((await undoEntry(next, { uuid: "x" }, deps)).state, "undone");
  assert.equal(calls.restored.length, 1, "a second undo writes nothing");
});

/* ------------------------------------------------------------------ */
/*  A cast's modifiers: one record per recipient                      */
/* ------------------------------------------------------------------ */

const MOD_ROWS = {
  ac: { type: "modifier", key: "ac", target: "ac", appliesTo: "recipient", value: 2, vsKinds: ["undead"], lasts: "duration" },
  save: { type: "modifier", key: "save", target: "save", appliesTo: "recipient", value: 1, vsKinds: ["undead"], lasts: "duration" },
  ward: { type: "ward", key: "ward", appliesTo: "recipient", vsKinds: ["undead"], lasts: "duration" },
};
const modSpellRows = () => Object.values(MOD_ROWS).map((row) => ({ row, key: row.key }));
const modCard = (over = {}) =>
  card({
    save: { category: "", effect: "" },
    rows: Object.fromEntries(Object.values(MOD_ROWS).map((r) => [r.key, { type: r.type, key: r.key, total: r.value ?? null, blank: false, conditions: [] }])),
    order: ["ac", "save", "ward"],
    targets: { t1: { uuid: "Scene.s.Token.k1", name: "Ally", resist: null } },
    entries: { t1_ac: { state: "pending" }, t1_save: { state: "pending" }, t1_ward: { state: "pending" } },
    casterLevel: { value: 3, source: "hand" },
    ...over,
  });
const GROUP = ["ac", "save", "ward"].map((rowKey) => ({ rowKey }));

t("a buff record round-trips its weapon and its roll-mods flag, and holds no status", () => {
  const flag = { id: "def.spell.testEdge", label: "Testedge", cite: "p. 1", sourceAlignment: "lawful", parts: [{ key: "k", on: "attack", value: 1, provides: ["kw:spellrecord"] }] };
  const data = spellEffectData({ ...base, item: { id: "w1", name: "Testblade" }, rollMods: flag, startTime: 5 });
  assert.deepEqual(data.flags["acks-extras"].rollMods, flag, "written at lib's flag");
  const read = spellEffectOf(data);
  assert.deepEqual([read.item, read.rollMods, read.startTime], [{ id: "w1", name: "Testblade" }, flag, 5]);
  assert.throws(() => spellEffectData({ ...base, statuses: ["a"], rollMods: flag }), /buff record holds no status/);
  const plain = spellEffectOf(spellEffectData({ ...base }));
  assert.deepEqual([plain.item, plain.rollMods], [undefined, undefined]);
});

await ta("a group of three modifier entries writes one record, every entry names it, and the record is built from the spell's rows", async () => {
  const { deps, log } = fakeDeps({ rows: modSpellRows(), sourceAlignment: "lawful" });
  const out = await applyOnTarget(modCard(), "t1", GROUP, deps);
  assert.equal(log.made.length, 1, "one record for the target");
  const [data] = log.made;
  assert.deepEqual(data.changes, []);
  assert.equal(data.statuses, undefined);
  const flag = data.flags["acks-extras"].rollMods;
  assert.deepEqual(flag.parts.map((p) => [p.key, p.on, p.value ?? null]), [["ac", "ac", 2], ["save", "save", 1], ["ward", "ward", null]]);
  assert.deepEqual([flag.id, flag.sourceAlignment, flag.cite], ["def.spell.testScorch", "lawful", "p. 9"]);
  assert.deepEqual(flag.parts[0].vsKinds, ["undead"]);
  assert.deepEqual([spellEffectOf(data).startTime, spellEffectOf(data).duration], [500, { value: 60, units: "seconds" }], "timed by the duration the client computed, because the rows last");
  assert.deepEqual(out.map((o) => o.entry.recordIds), [["r10"], ["r10"], ["r10"]]);
  assert.deepEqual(Object.keys(log.entries).sort(), ["t1_ac", "t1_save", "t1_ward"]);
});

await ta("the relay narrows a pickKind row to the card's kind, the row's first where the card names none or one the row does not list, and writes a set part as a set", async () => {
  const kinds = ["undead", "beast", "fey"];
  const pickRows = [
    { type: "modifier", key: "hit", target: "attackThrow", appliesTo: "recipient", value: 2, vsKinds: kinds, pickKind: true, lasts: "duration" },
    { type: "modifier", key: "worn", target: "ac", appliesTo: "recipient", mode: "set", value: 7, attackKinds: ["melee"], lasts: "duration" },
  ].map((row) => ({ row, key: row.key }));
  const pickCard = (pickKind) =>
    modCard({
      rows: { hit: { type: "modifier", key: "hit", total: 2, blank: false, conditions: [] }, worn: { type: "modifier", key: "worn", total: 7, blank: false, conditions: [] } },
      order: ["hit", "worn"],
      entries: { t1_hit: { state: "pending" }, t1_worn: { state: "pending" } },
      ...(pickKind ? { pickKind } : {}),
    });
  const written = async (pickKind) => {
    const { deps, log } = fakeDeps({ rows: pickRows });
    await applyOnTarget(pickCard(pickKind), "t1", [{ rowKey: "hit" }, { rowKey: "worn" }], deps);
    return log.made[0].flags["acks-extras"].rollMods.parts;
  };
  const chosen = await written({ key: "beast", defaulted: false });
  assert.deepEqual(chosen.map((p) => [p.key, p.vsKinds ?? null, p.mode ?? null, p.attackKinds ?? null]), [["hit", ["beast"], null, null], ["worn", null, "set", ["melee"]]]);
  assert.deepEqual((await written(null))[0].vsKinds, ["undead"], "no kind on the card");
  assert.deepEqual((await written({ key: "dragon", defaulted: false }))[0].vsKinds, ["undead"], "a kind the rows do not list is never taken from the card");
});

await ta("a group's figures come from the spell, so a card that forges its rows changes nothing; a spell with no such row writes none", async () => {
  const forged = modCard({ rows: { ac: { type: "modifier", key: "ac", total: 99 }, save: { type: "modifier", key: "save", total: 99 }, ward: { type: "ward", key: "ward", total: null } } });
  const { deps, log } = fakeDeps({ rows: modSpellRows() });
  await applyOnTarget(forged, "t1", GROUP, deps);
  assert.deepEqual(log.made[0].flags["acks-extras"].rollMods.parts.map((p) => p.value ?? null), [2, 1, null]);
  const bare = fakeDeps({ rows: [] });
  const none = await applyOnTarget(modCard(), "t1", GROUP, bare.deps);
  assert.deepEqual(none.map((o) => o.skipped), ["noRow", "noRow", "noRow"]);
  assert.equal(bare.log.made.length, 0);
});

await ta("a condition's record is built from the spell's row on either client, never from card.rows", async () => {
  const spellRow = { type: "conditionGrant", key: "dread", conditions: ["afraid"], lasts: "duration" };
  const forged = card({ save: { category: "", effect: "" }, rows: { dread: { type: "conditionGrant", key: "dread", conditions: ["paralysed", "stunned"], lasts: "" } }, order: ["dread"], targets: { t1: { uuid: "x", name: "T", resist: null } }, entries: { t1_dread: { state: "pending" } } });
  const { deps, log } = fakeDeps({ rows: [{ row: spellRow, key: "dread" }] });
  await applyOnTarget(forged, "t1", [{ rowKey: "dread" }], deps);
  assert.deepEqual(log.made.map((d) => d.statuses), [["afraid"]], "the spell's one condition, not the card's two");
  assert.deepEqual(spellEffectOf(log.made[0]).duration, { value: 60, units: "seconds" }, "timed by the spell's row");
  const stale = fakeDeps();
  const noDuration = await applyRaw(forged, "t1", [{ rowKey: "dread" }], { ...stale.deps, rows: [{ row: spellRow, key: "dread" }] });
  assert.equal(spellEffectOf(stale.log.made[0]).duration, undefined, "no duration passed in, none taken from the card");
  assert.equal(noDuration[0].entry.state, "applied");
});

await ta("undo of one entry of a group deletes the record once and marks every entry of the group undone", async () => {
  const { deps, log } = fakeDeps({ rows: modSpellRows() });
  const c = modCard();
  await applyOnTarget(c, "t1", GROUP, deps);
  const deleted = [];
  const undoDeps = { resolve: async () => ({ actor: { id: "a" }, hpTarget: null }), restoreHp: async () => deleted.push("hp"), deleteRecords: async (a, ids) => deleted.push(ids) };
  const written = await undoEntries({ ...c, entries: log.entries }, "t1", "save", undoDeps);
  assert.deepEqual(Object.keys(written).sort(), ["t1_ac", "t1_save", "t1_ward"]);
  assert.ok(Object.values(written).every((e) => e.state === "undone"));
  assert.deepEqual(deleted, [["r10"]], "one delete, no hit points");
  assert.deepEqual(await undoEntries({ ...c, entries: written }, "t1", "save", undoDeps), { t1_save: written.t1_save }, "a second undo finds nothing applied");
});

t("the relay refuses a weapon that is not the target's and a group request that leaves an open entry out; bounds are skipped for a buff", () => {
  const world = (over = {}) => ({ message: { authorId: "p1" }, card: modCard({ item: { targetKey: "t1", id: "w1", name: "Testblade" } }), ownsCaster: true, spellOfCaster: true, rows: modSpellRows(), resist: null, boundsOf: () => null, item: { id: "w1", name: "Testblade" }, ...over });
  const req = (entries = GROUP) => ({ requestUserId: "p1", messageId: "m", targetKey: "t1", resist: null, entries });
  assert.deepEqual(checkApplyRequest(req(), world()), { ok: true }, "no amount to bound");
  assert.equal(checkApplyRequest(req(), world({ item: null })).refused, "badItem");
  assert.equal(checkApplyRequest(req(), world({ card: modCard({ item: { targetKey: "t9", id: "w1", name: "x" } }), item: null })).ok, true, "an item the card names for another target is not this one's");
  assert.equal(checkApplyRequest(req([{ rowKey: "ac" }]), world()).refused, "badGroup");
  assert.deepEqual(missingGroupKeys(modCard(), "t1", [{ rowKey: "ac" }], modSpellRows()), ["save", "ward"]);
  assert.deepEqual(missingGroupKeys(modCard(), "t1", [], modSpellRows()), [], "a request with no modifier names no group");
  const done = modCard({ entries: { t1_ac: { state: "pending" }, t1_save: { state: "applied" }, t1_ward: { state: "pending" } } });
  assert.deepEqual(missingGroupKeys(done, "t1", [{ rowKey: "ac" }], modSpellRows()), ["ward"], "an entry already applied is not open");
});

t("a Player is blocked and a Judge warned where a weapon buff has no one bearer", () => {
  const rows = [{ row: { key: "edge", type: "modifier", target: "attackThrow", appliesTo: "recipient", value: 1, gate: { kind: "weaponMundane" } } }];
  const ok = { capacity: { verdict: "ok" }, rows };
  assert.deepEqual(castVerdicts({ ...ok, targets: [1], isGM: false }), []);
  assert.deepEqual(castVerdicts({ ...ok, targets: [], isGM: false }).map((v) => [v.key, v.severity]), [["oneBearer", "block"]]);
  assert.deepEqual(castVerdicts({ ...ok, targets: [1, 2], isGM: true }).map((v) => [v.key, v.severity]), [["oneBearer", "warn"]]);
});

await ta("the resist is rolled and recomputed against the caster, so a scoped save figure reads as the relay will", async () => {
  const types = ["undead"];
  const holder = (kinds) => ({
    type: "monster",
    system: { saves: { spell: { value: 14 } } },
    getFlag: (scope, key) => (scope === "acks-extras" && key === "extras" ? { types: kinds } : undefined),
    effects: [],
  });
  const saver = holder([]);
  saver.effects = [{ id: "fx", disabled: false, flags: { "acks-extras": { rollMods: { id: "def.spell.testWard", label: "Testward", cite: "p. 2", sourceAlignment: null, parts: [{ key: "s", on: "save", value: 2, vsKinds: types, provides: ["kw:spellrecord"] }] } } } }];
  const save = { category: "spell" };
  const against = (kinds) => ({ actor: holder(kinds), token: null });
  const near = await rollResist(saver, save, null, { against: against(types), bearerToken: null });
  assert.equal(near.resist.target, 12, "a source the part is scoped to lowers the number to roll");
  assert.ok(near.resist.parts.some((p) => p.label === "Testward" && p.value === 2));
  const far = await rollResist(saver, save, null, { against: against(["animal"]), bearerToken: null });
  assert.equal(far.resist.target, 14, "a source it is not scoped to adds nothing");
  const unknown = await rollResist(saver, save, null);
  assert.equal(unknown.resist.target, 14, "with no source the scoped figure is told, not added");
});

await ta("a save is rolled only where it governs an entry the target takes: a spell of line rows and thrown rows rolls none", async () => {
  const saver = { type: "monster", system: { saves: { spell: { value: 14 } } }, getFlag: () => undefined, effects: [] };
  const token = { uuid: "Scene.s.Token.k1", name: "Target", actor: saver };
  const save = { category: "spell", effect: "half" };
  const caster = { uuid: "Actor.c1", name: "Caster", getRollData: () => ({}) };
  const keyedOf = (rows) => rows.map((row, index) => ({ row, key: row.key, index }));
  const run = (rows, cardRows) => buildTargets({ tokens: [token], card: { rows: cardRows }, rows: keyedOf(rows), save, situational: null, caster, randomID: () => "x" });
  const thrown = dmg({ key: "bolt", delivery: "missile" });
  const line = { key: "glow", type: "illusion", note: "an invented glow" };
  const lineOnly = await run([line, thrown], { bolt: { type: "damage", key: "bolt", total: null, delivery: "missile" } });
  assert.equal(Object.values(lineOnly.targets)[0].resist, null, "a line row and a throw row are governed by no save");
  assert.deepEqual(lineOnly.rolls, []);
  const thrownRolled = await run([thrown], { bolt: { type: "damage", key: "bolt", total: 5, delivery: "missile" } });
  assert.equal(Object.values(thrownRolled.targets)[0].resist, null, "a thrown row is decided by its throw");
  const ward = { key: "ward", type: "ward", appliesTo: "recipient" };
  const buff = await run([ward], { ward: { type: "ward", key: "ward", blank: false } });
  assert.equal(Object.values(buff.targets)[0].resist, null, "a buff is not resisted");
  const unread = await run([dmg({ roll: "" })], { burn: { type: "damage", key: "burn", total: null, delivery: "" } });
  assert.equal(Object.values(unread.targets)[0].resist, null, "a damage row whose roll was never read opens no entry");
  const governed = await run([line, dmg()], { burn: { type: "damage", key: "burn", total: 6, delivery: "" } });
  const target = Object.values(governed.targets)[0];
  assert.equal(target.resist?.category, "spell", "a damage row with a figure is resisted");
  assert.equal(governed.rolls.length, 1);
  const cond = await run([{ key: "dread", type: "conditionGrant", conditions: ["stunned"] }], { dread: { type: "conditionGrant", key: "dread", conditions: ["stunned"] } });
  assert.equal(Object.values(cond.targets)[0].resist?.category, "spell", "a condition row is resisted");
});

t("amountOf prices a row through its save and a throw row ignores the spell's save", () => {
  const c = card();
  assert.equal(amountOf(c.rows.burn, c, c.targets.t1.resist, 6).applied, 3);
  const thrown = { ...c.rows.burn, delivery: "melee", type: "damage" };
  assert.equal(amountOf(thrown, c, c.targets.t1.resist, 6).applied, 6);
  assert.equal(conditionRecords({ type: "conditionGrant", key: "dread", conditions: [] }, c, {}).length, 0);
});

/* ------------------------------------------------------------------ */
/*  Damage against defenses (every creature, band and figure invented) */
/* ------------------------------------------------------------------ */

/** A stored defense band, as the sheet and the importer write one. */
const band = (b = {}) => ({ damage: [], effects: [], conditions: [], mundane: false, extraordinary: false, silverFlaw: false, note: "", ...b });
/** An invented creature whose stat block carries the given bands. */
const defended = (name, { immune, resist, weak } = {}) => ({
  name,
  id: "a1",
  type: "monster",
  system: { saves: { spell: { value: 14 } } },
  effects: [],
  getFlag: (s, k) => (s === "acks-extras" && k === "extras" ? { defenses: { immunities: band(immune), resistances: band(resist), susceptibilities: band(weak) } } : undefined),
});
/** The resistance figures an import registers; invented stand-ins. */
const FRACTION = 0.7;
const SAVE_BONUS = 6;
const importResistance = () => Tables.registerTable({ id: DEFENSES_DOC, source: { pages: "ZZ p. 4" }, tables: { [RESISTANCE_TABLE]: { fraction: FRACTION, saveBonus: SAVE_BONUS } } }, { priority: Tables.PRIORITY.WORLD });
const forgetResistance = () => Tables.unregisterTable(DEFENSES_DOC);
/** The spell's own row: its types and its mark are what the stage reads. */
const SCORCH = { key: "burn", type: "damage", roll: "2d4", damage: ["fire"], extraordinary: false };
/** A card whose save was failed, so the whole amount is the target's, or passed (the spell's half). */
const failedCard = () => card({ targets: { t1: { ...card().targets.t1, resist: { ...card().targets.t1.resist, total: 5, success: false } } } });
const cardAgainst = (actor, over = {}) => ({ actor, rows: [{ key: "burn", row: SCORCH }], ...over });
/** Apply the row to a creature; its defenses are read from the actor the way a live write reads them. */
async function strike(actor, { rolled = 10, row = SCORCH, cardOf = failedCard() } = {}) {
  const fake = fakeDeps({ resolve: async () => ({ actor, hpTarget: { key: "Scene.s.Token.k1", hp: { value: 20, max: 20 } } }) });
  await applyOnTarget(cardOf, "t1", [{ rowKey: row.key, rolled }], { ...fake.deps, rows: [{ key: row.key, row }] });
  return { entry: fake.log.entries[`t1_${row.key}`], hp: fake.log.hp, log: fake.log };
}

await ta("immune: the amount is 0, nothing is written, and the entry keeps the defense step with the spell's own type", async () => {
  const { entry, hp } = await strike(defended("Quillback", { immune: { damage: ["fire"] } }));
  assert.equal(entry.state, "applied");
  assert.equal(entry.applied, 0);
  assert.deepEqual(hp, [], "no hit points are written for 0");
  const step = entry.steps.find((s) => s.key === "defense");
  assert.deepEqual({ band: step.band, types: step.types, source: step.source, before: step.before, after: step.after }, { band: "immunities", types: ["fire"], source: "Quillback", before: 10, after: 0 });
});

await ta("a card that forges its row's types changes nothing: the types come from the spell's own row", async () => {
  const forged = failedCard();
  forged.rows.burn = { ...forged.rows.burn, types: ["cold"] };
  const fake = fakeDeps({ resolve: async () => ({ actor: defended("Quillback", { immune: { damage: ["fire"] } }), hpTarget: { key: "k", hp: { value: 20, max: 20 } } }) });
  await applyOnTarget(forged, "t1", [{ rowKey: "burn", rolled: 10 }], { ...fake.deps, rows: [{ key: "burn", row: SCORCH }] });
  assert.equal(fake.log.entries.t1_burn.applied, 0);
});

await ta("resistant with a figure: the save's fraction and the resistance each apply once and the rounding is done once at the end", async () => {
  importResistance();
  try {
    const half = await strike(defended("Quillback", { resist: { damage: ["fire"] } }), { rolled: 5, cardOf: card() });
    // 5 halved is 2.5, times 0.7 is 1.75, one rounding gives 2; rounding the half first would give 1.
    assert.equal(half.entry.applied, 2);
    assert.deepEqual(half.entry.steps.map((s) => s.key), ["fraction", "defense", "round"]);
    assert.equal(half.entry.steps[1].cite, "ZZ p. 4");
    assert.deepEqual(half.hp, [{ mode: "damage", amount: 2, multiplier: 1 }]);
    const whole = await strike(defended("Quillback", { resist: { damage: ["fire"] }, immune: { damage: ["fire"] } }), { rolled: 5 });
    assert.equal(whole.entry.applied, 0, "a type that is immune and resistant counts once, as immune");
    const odd = await strike(defended("Quillback", { resist: { damage: ["fire"] } }), { rolled: 5 });
    assert.equal(odd.entry.applied, 4, "5 times 0.7 is 3.5, to the even 4");
  } finally {
    forgetResistance();
  }
});

await ta("resistant with no figure imported is the Judge's: no amount is written and the entry names the defense", async () => {
  forgetResistance();
  const { entry, hp } = await strike(defended("Quillback", { resist: { damage: ["fire"] } }));
  assert.equal(entry.state, "judge");
  assert.deepEqual(hp, []);
  assert.equal(entry.defense.band, "judge");
  assert.equal(entry.defense.why, "figure");
  assert.equal(entry.defense.source, "Quillback");
  assert.equal(entry.applied, undefined, "no amount is stored for the Judge's case");
});

await ta("susceptible takes the creature's own factor; a susceptibility with no factor is the Judge's", async () => {
  const doubled = await strike(defended("Quillback", { weak: { damage: ["fire"], factor: 2 } }), { rolled: 7 });
  assert.equal(doubled.entry.applied, 14);
  assert.deepEqual(doubled.hp, [{ mode: "damage", amount: 14, multiplier: 1 }]);
  const blank = await strike(defended("Quillback", { weak: { damage: ["fire"] } }));
  assert.equal(blank.entry.state, "judge");
});

await ta("a heal meets no defense, whatever the target holds", async () => {
  const mend = { key: "mend", type: "heal", roll: "1d6" };
  const healCard = card({ save: { category: "", effect: "" }, rows: { mend: { type: "heal", key: "mend", total: 5, conditions: [] } }, order: ["mend"], targets: { t1: { uuid: "Scene.s.Token.k1", name: "T", resist: null } }, entries: { t1_mend: { state: "pending" } } });
  const { entry, hp } = await strike(defended("Quillback", { immune: { extraordinary: true }, resist: { mundane: true } }), { rolled: 5, row: mend, cardOf: healCard });
  assert.equal(entry.applied, 5);
  assert.deepEqual(hp, [{ mode: "heal", amount: 5, multiplier: 1 }]);
  assert.ok(!entry.steps.some((s) => s.key === "defense"));
});

await ta("a quality the row does not state meets a band that waits on it as the Judge's; a stated one decides", async () => {
  const guard = defended("Quillback", { immune: { damage: ["fire"], mundane: true } });
  const unread = await strike(guard, { row: { ...SCORCH, extraordinary: null } });
  assert.equal(unread.entry.state, "judge");
  assert.equal(unread.entry.defense.why, "quality");
  const mundane = await strike(guard, { row: { ...SCORCH, extraordinary: false } });
  assert.equal(mundane.entry.applied, 0, "damage stated mundane meets a mundane-only band");
  const marked = await strike(guard, { row: { ...SCORCH, extraordinary: true }, rolled: 6 });
  assert.equal(marked.entry.applied, 6, "damage stated extraordinary is not covered by it");
  assert.equal(marked.entry.steps.some((s) => s.key === "defense"), false);
});

await ta("a thrown row's damage meets the defense too; a condition row meets none", async () => {
  const bolt = { ...SCORCH, key: "bolt", delivery: "missile" };
  const thrown = card({ rows: { bolt: { ...card().rows.burn, key: "bolt", delivery: "missile" } }, order: ["bolt"], entries: { t1_bolt: { state: "pending", throw: { total: 15, target: 10 } } } });
  const hit = await strike(defended("Quillback", { immune: { damage: ["fire"] } }), { row: bolt, cardOf: thrown, rolled: 6 });
  assert.equal(hit.entry.applied, 0);
  const dread = { key: "dread", type: "conditionGrant", conditions: ["afraid"], damage: ["fire"] };
  const fake = fakeDeps({ resolve: async () => ({ actor: defended("Quillback", { immune: { damage: ["fire"] } }), hpTarget: { key: "k", hp: { value: 20, max: 20 } } }) });
  const cond = card({ rows: { dread: { type: "conditionGrant", key: "dread", conditions: ["afraid"] } }, order: ["dread"], entries: { t1_dread: { state: "pending" } }, targets: { t1: { ...card().targets.t1, resist: { ...card().targets.t1.resist, success: false, total: 5 } } } });
  await applyOnTarget(cond, "t1", [{ rowKey: "dread" }], { ...fake.deps, rows: [{ key: "dread", row: dread }] });
  assert.equal(fake.log.made.length, 1, "defenses against damage do not touch a condition");
});

await ta("the same cast applies the same amount on the seat and on the GM's client: the figure is read from the actor each resolves", async () => {
  importResistance();
  try {
    const seat = await strike(defended("Quillback", { resist: { damage: ["fire"] } }), { rolled: 9 });
    const gm = await strike(defended("Quillback", { resist: { damage: ["fire"] } }), { rolled: 9 });
    assert.deepEqual(gm.entry.steps, seat.entry.steps);
    assert.equal(gm.entry.applied, seat.entry.applied);
    assert.equal(seat.entry.applied, 6, "9 times 0.7 is 6.3, to 6");
  } finally {
    forgetResistance();
  }
});

t("the damage a save resists is the union of the spell's own damage rows no throw decides; none, none", () => {
  const keyed = (rows) => rows.map((row) => ({ row, key: row.key }));
  assert.equal(resistedDamage(keyed([{ key: "g", type: "conditionGrant", conditions: ["afraid"] }])), null, "a condition alone meets no defense on its save");
  assert.equal(resistedDamage(keyed([{ ...SCORCH, delivery: "missile" }, { key: "m", type: "heal", roll: "1d4" }])), null, "a thrown row is decided by its throw");
  assert.equal(resistedDamage(keyed([{ ...SCORCH, appliesTo: "self" }])), null, "the caster's own row is not resisted");
  const both = resistedDamage(keyed([SCORCH, { key: "c", type: "damage", roll: "1d4", damage: ["cold", "fire"], extraordinary: false }]));
  assert.deepEqual(both, { types: ["fire", "cold"], extraordinary: false });
  const mixed = resistedDamage(keyed([SCORCH, { ...SCORCH, key: "x", extraordinary: true }]));
  assert.equal(mixed.extraordinary, null, "rows that disagree on quality state none");
  assert.equal(resistedDamage(keyed([{ ...SCORCH, extraordinary: undefined }])).extraordinary, null, "an unread mark is no mundane one");
  assert.deepEqual(damageOfRow({ damage: ["fire"], extraordinary: true }), { types: ["fire"], extraordinary: true });
});

await ta("the save: immune to all the damage dealt passes with no roll; resistant lowers the number with its figure; a blank figure is listed and changes nothing", async () => {
  const save = { category: "spell" };
  const keyed = (...rows) => rows.map((row) => ({ row, key: row.key }));
  const cold = { key: "c", type: "damage", roll: "1d4", damage: ["cold"], extraordinary: false };
  const damage = resistedDamage(keyed(SCORCH, cold));
  const immune = await rollResist(defended("Quillback", { immune: { damage: ["fire", "cold"] } }), save, null, { damage });
  assert.equal(immune.roll, null, "nothing is rolled");
  assert.equal(immune.resist.success, true);
  assert.equal(immune.resist.total, null);
  assert.deepEqual({ label: immune.resist.auto.label, source: immune.resist.auto.source, types: immune.resist.auto.types }, { label: "Immune", source: "Quillback", types: ["fire", "cold"] });
  const partial = await rollResist(defended("Quillback", { immune: { damage: ["fire"] } }), save, null, { damage });
  assert.equal(partial.resist.auto, undefined, "a defense covering only some of the types is not a pass");
  assert.equal(partial.resist.defensePending?.length, 1, "the case is listed for the Judge");
  assert.equal(partial.resist.target, 14, "and the number to roll is the creature's own");
  importResistance();
  try {
    const resisted = await rollResist(defended("Quillback", { resist: { damage: ["fire", "cold"] } }), save, null, { damage });
    assert.equal(resisted.resist.target, 14 - SAVE_BONUS);
    assert.ok(resisted.resist.parts.some((p) => p.key === "defense" && p.label === "Resistant" && p.value === SAVE_BONUS), "the part carries the band's label");
    const clean = await rollResist(defended("Quillback", { immune: { damage: ["fire"] } }), save, null, { damage: resistedDamage(keyed(SCORCH)) });
    assert.equal(clean.resist.auto.label, "Immune");
  } finally {
    forgetResistance();
  }
  const noDamage = await rollResist(defended("Quillback", { immune: { damage: ["fire"] } }), save, null, { damage: null });
  assert.equal(noDamage.resist.auto, undefined, "a save against no damage meets no defense");
});

await ta("buildTargets passes the union of the spell's damage rows to the save, so a target immune to every type passes it unrolled", async () => {
  const quill = defended("Quillback", { immune: { damage: ["fire", "cold"] } });
  const token = { uuid: "Scene.s.Token.k1", name: "Target", actor: quill };
  const cold = { key: "c", type: "damage", roll: "1d4", damage: ["cold"], extraordinary: false };
  const keyedOf = (rows) => rows.map((row, index) => ({ row, key: row.key, index }));
  const cardRows = { burn: { type: "damage", key: "burn", total: 6, delivery: "" }, c: { type: "damage", key: "c", total: 3, delivery: "" } };
  const caster = { uuid: "Actor.c1", name: "Caster", getRollData: () => ({}) };
  const built = await buildTargets({ tokens: [token], card: { rows: cardRows }, rows: keyedOf([SCORCH, cold]), save: { category: "spell", effect: "half" }, situational: null, caster, randomID: () => "x" });
  const resist = Object.values(built.targets)[0].resist;
  assert.equal(resist.success, true);
  assert.ok(resist.auto);
  assert.deepEqual(built.rolls, []);
  token.actor = defended("Quillback", { immune: { damage: ["fire"] } });
  const part = await buildTargets({ tokens: [token], card: { rows: cardRows }, rows: keyedOf([SCORCH, cold]), save: { category: "spell", effect: "half" }, situational: null, caster, randomID: () => "x" });
  assert.equal(Object.values(part.targets)[0].resist.auto, undefined, "a defense that covers one row's type and not the other's is no pass");
  assert.equal(part.rolls.length, 1);
});

t("the relay accepts an auto pass it recomputes, and refuses one it does not or one the request adds or drops", () => {
  const auto = { kind: "save", category: "spell", formula: "1d20", total: null, target: 13, baseTarget: 13, success: true, auto: { label: "Immune", source: "Quillback", types: ["fire"] }, parts: [] };
  const autoCard = card({ targets: { t1: { ...card().targets.t1, resist: auto } } });
  const world = (over = {}) => ({
    message: { authorId: "p1" },
    card: autoCard,
    ownsCaster: true,
    spellOfCaster: true,
    rows: [{ row: SCORCH, key: "burn" }],
    resist: { target: 13, min: 1, max: 20, auto: true },
    boundsOf: () => ({ min: 0, max: 8 }),
    ...over,
  });
  const req = (over = {}) => ({ requestUserId: "p1", messageId: "m", targetKey: "t1", resist: auto, entries: [{ rowKey: "burn", rolled: 7 }], ...over });
  assert.deepEqual(checkApplyRequest(req(), world()), { ok: true });
  assert.equal(checkApplyRequest(req(), world({ resist: { target: 13, min: 1, max: 20, auto: false } })).refused, "badResist", "the GM's client does not recompute an auto pass");
  assert.equal(checkApplyRequest(req(), world({ resist: { target: 13, min: 1, max: 20 } })).refused, "badResist");
  assert.equal(checkApplyRequest(req({ resist: { ...auto, auto: undefined } }), world()).refused, "badResist", "a request that drops the pass");
  assert.equal(checkApplyRequest(req({ resist: card().targets.t1.resist }), world()).refused, "badResist", "a request that swaps it for a roll");
  assert.equal(checkApplyRequest(req(), world({ card: autoCard, resist: { target: 12, min: 1, max: 20, auto: true } })).refused, "badResist", "the target is recomputed too");
  const forged = card({ targets: { t1: { ...card().targets.t1, resist: { ...auto, success: false } } } });
  assert.equal(checkApplyRequest(req({ resist: { ...auto, success: false } }), world({ card: forged })).refused, "badResist", "an auto pass is a success");
  const rolled = card();
  assert.equal(checkApplyRequest(req({ resist: { ...rolled.targets.t1.resist, auto: auto.auto } }), world({ card: rolled })).refused, "badResist", "an auto claimed on a rolled save, which the card did not store");
});

/** The strings lib and magic localize, read from the lang file, so a card's naming is checked against the real words. */
const LANG = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
const withLang = (fn) => {
  const keep = game.i18n;
  game.i18n = { ...keep, has: (key) => key in LANG, localize: (key) => LANG[key] ?? key };
  try {
    return fn();
  } finally {
    game.i18n = keep;
  }
};
const realLoc = (key, data = {}) => (LANG[`ACKS-MAGIC.cast.${key}`] ?? key).replace(/\{(\w+)\}/g, (_m, name) => String(data[name] ?? ""));

t("the card lists every stored step of an amount, a defense named to a Judge and a target's owner and 'a defense' to any other seat", () => {
  withLang(() => {
    const steps = [
      { key: "fraction", before: 5, after: 2.5 },
      { key: "defense", label: "Resistant", band: "resistances", types: ["fire"], source: "Quillback", cite: "ZZ p. 4", before: 2.5, after: 1.75 },
      { key: "round", before: 1.75, after: 2 },
    ];
    const c = card({ entries: { t1_burn: { state: "applied", rolled: 5, applied: 2, fraction: 0.5, saved: true, steps } } });
    const tipFor = (seat) => castCardView(c, seat, realLoc).sections[0].rows[0].tooltipText;
    const judge = tipFor({ isGM: true, canPress: true });
    assert.equal(judge, "Rolled 5 · Times 0.5: 5 to 2.5 · Resistant (Quillback): 2.5 to 1.75 · Rounded 1.75 to 2 · Applied 2");
    assert.equal(tipFor({ isGM: false, canPress: false, ownsTarget: () => true }), judge, "the target's owner reads the same");
    const other = tipFor({ isGM: false, canPress: false });
    assert.equal(other, "Rolled 5 · Times 0.5: 5 to 2.5 · a defense: 2.5 to 1.75 · Rounded 1.75 to 2 · Applied 2");
    assert.ok(!other.includes("Quillback") && !other.includes("Resistant"));
    assert.ok(!castCardContent(c, realLoc).includes("Quillback"), "the stored content is the card as no seat may read it");
  });
});

t("a summoning's line is worded per seat from the card's record: the name for a Judge and a seat that opens the creature, the neutral label for any other seat and for the stored content", () => {
  withLang(() => {
    const summoned = { sourceUuid: "Compendium.invented.Actor.zz", name: "Quillback", n: 2, short: 1, duration: "2 hours", party: null };
    const c = card({ summoned, lines: ["Another line"] });
    const note = (seat) => castCardView(c, seat, realLoc).footnote;
    const neutral = LANG["ACKS-LIB.summons.neutral"];
    assert.equal(note({ isGM: true, canPress: false }), `Summoned: Quillback × 2 · lasts 2 hours · 1 not summoned · Another line`, "a Judge reads the name, ahead of the card's other lines");
    const asked = [];
    assert.equal(note({ isGM: false, canPress: false, opens: (uuid) => (asked.push(uuid), true) }), note({ isGM: true, canPress: false }), "a seat that opens the creature reads the name");
    assert.ok(asked.length > 0 && asked.every((uuid) => uuid === summoned.sourceUuid), "the seat is asked about the stored uuid");
    const closed = note({ isGM: false, canPress: false, opens: () => false });
    assert.equal(closed, `Summoned: ${neutral} × 2 · lasts 2 hours · 1 not summoned · Another line`, "a seat that cannot open it reads the neutral label");
    assert.equal(note({ isGM: false, canPress: false }), closed, "a seat with no test opens nothing");
    const content = castCardContent(c, realLoc);
    assert.ok(!content.includes("Quillback") && content.includes(neutral), "the stored content carries the neutral label, never the name");
    assert.deepEqual(c.summoned, summoned, "the view leaves the stored record as it was");
    const open = castCardView(card({ summoned: { ...summoned, short: 0, duration: "" } }), { isGM: true, canPress: false }, realLoc).footnote;
    assert.equal(open, "Summoned: Quillback × 2", "an instant's line states no length and no short count");
  });
});

t("a summoning that joined a party adds a line naming the party, to every seat and in the stored content, and none where it joined none", () => {
  withLang(() => {
    const summoned = { sourceUuid: "Compendium.invented.Actor.zz", name: "Quillback", n: 2, short: 1, duration: "2 hours", party: { id: "pty1", name: "Invented Company" } };
    const c = card({ summoned });
    const note = (seat) => castCardView(c, seat, realLoc).footnote;
    const neutral = LANG["ACKS-LIB.summons.neutral"];
    assert.equal(note({ isGM: true, canPress: false }), "Summoned: Quillback × 2 · lasts 2 hours · 2 joined Invented Company · 1 not summoned", "the joined line follows the summoned line, ahead of the short count");
    assert.equal(note({ isGM: false, canPress: false }), `Summoned: ${neutral} × 2 · lasts 2 hours · 2 joined Invented Company · 1 not summoned`, "a seat that cannot open the creature still reads the party's name");
    assert.ok(castCardContent(c, realLoc).includes("2 joined Invented Company"), "the stored content names the party");
    assert.equal(castCardView(card({ summoned: { ...summoned, party: null } }), { isGM: true, canPress: false }, realLoc).footnote, "Summoned: Quillback × 2 · lasts 2 hours · 1 not summoned", "a cast that placed tokens has no joined line");
  });
});

t("a card stored with a worded summon line and no record renders that line as it was", () => {
  withLang(() => {
    const old = card({ lines: ["Summoned: Quillback × 2 · lasts 2 hours"] });
    assert.equal(old.summoned, undefined);
    assert.equal(castCardView(old, { isGM: false, canPress: false }, realLoc).footnote, "Summoned: Quillback × 2 · lasts 2 hours");
    assert.ok(castCardContent(old, realLoc).includes("Quillback"), "a card with no record is read as it was written");
  });
});

t("a defense the module does not price names itself on the line, with the page reference alone as the tooltip", () => {
  withLang(() => {
    const defense = { label: "Judge's call", band: "judge", types: ["fire"], source: "Quillback", cite: "ZZ p. 4", why: "figure" };
    const c = card({ entries: { t1_burn: { state: "judge", rolled: 7, saved: true, fraction: 0.5, steps: [], defense } } });
    const row = (seat) => castCardView(c, seat, realLoc).sections[0].rows[0];
    assert.equal(row({ isGM: true, canPress: true }).tooltipText, "ZZ p. 4");
    assert.ok(row({ isGM: true, canPress: true }).detail.includes("Judge's call (Quillback) meets this damage"));
    assert.ok(row({ isGM: true, canPress: true }).detail.includes("(ZZ p. 4)"));
    assert.ok(row({ isGM: false, canPress: false }).detail.includes("a defense meets this damage"));
    assert.ok(!row({ isGM: false, canPress: false }).detail.includes("Quillback"));
    assert.ok(row({ isGM: true, canPress: true }).detail.endsWith("Rolled 7"), "the figure rolled stays on the line for the Judge who applies it by hand");
    assert.deepEqual(row({ isGM: true, canPress: true }).actions, [], "the Judge applies it by hand");
    const none = card({ entries: { t1_burn: { state: "judge", rolled: 7, saved: true } } });
    assert.equal(castCardView(none, { isGM: true, canPress: true }, realLoc).sections[0].rows[0].tooltipText, "", "the save's own judge case is as it was");
  });
});

t("a save passed by a defense shows no total, names the band to the seats that may read it, and a defense part's label is kept from the others", () => {
  withLang(() => {
    const auto = { kind: "save", category: "spell", formula: "1d20", total: null, target: 13, baseTarget: 13, success: true, auto: { label: "Immune", source: "Quillback", types: ["fire"], cite: "ZZ p. 4" }, parts: [] };
    const c = card({ targets: { t1: { ...card().targets.t1, resist: auto } }, entries: { t1_burn: { state: "applied", rolled: 7, applied: 0, fraction: 0.5, saved: true, steps: [] } } });
    const named = castCardView(c, { isGM: true, canPress: false }, realLoc).sections[0].rows[0];
    assert.equal(named.targetText, "Auto");
    assert.equal(named.target, undefined);
    assert.ok(named.detail.startsWith("Immune (Quillback): no roll"));
    assert.ok(named.targetTooltip.includes("ZZ p. 4"));
    const other = castCardView(c, { isGM: false, canPress: false }, realLoc).sections[0].rows[0];
    assert.ok(other.detail.startsWith("a defense: no roll") && !other.targetTooltip.includes("Quillback") && !other.targetTooltip.includes("Immune"));
    const part = { kind: "save", category: "spell", formula: "1d20", total: 9, target: 8, baseTarget: 14, success: true, parts: [{ key: "defense", label: "Resistant", value: 6 }, { key: "x", label: "Testward", value: 2 }] };
    const resisted = card({ targets: { t1: { ...card().targets.t1, resist: { ...part, defensePending: [{ label: "Judge's call" }] } } } });
    const gm = castCardView(resisted, { isGM: true, canPress: false }, realLoc).sections[0].rows[0].targetTooltip;
    assert.ok(gm.includes("Resistant +6") && gm.includes("Testward +2") && gm.includes("Not priced into this number: Judge's call"));
    const player = castCardView(resisted, { isGM: false, canPress: false }, realLoc).sections[0].rows[0].targetTooltip;
    assert.ok(player.includes("a defense +6") && player.includes("Testward +2") && !player.includes("Resistant"), "the figure shows; the band's name does not");
  });
});

/* ------------------------------------------------------------------ */
/*  The card                                                          */
/* ------------------------------------------------------------------ */

const loc = (key, data) => (data ? `${key}|${JSON.stringify(data)}` : key);

t("the card shows each seat the buttons it may press, and a Judge's Undo; none is the system's own", () => {
  const applied = card({ entries: { t1_burn: { state: "applied", rolled: 7, applied: 4, fraction: 0.5, saved: true, before: 20, after: 16 } } });
  const press = (view) => view.sections.flatMap((s) => s.rows.flatMap((r) => r.actions.map((a) => a.action)));
  assert.deepEqual(press(castCardView(applied, { isGM: true, canPress: true }, loc)), [CARD_ACTIONS.undo]);
  assert.deepEqual(press(castCardView(applied, { isGM: false, canPress: true }, loc)), []);
  assert.deepEqual(press(castCardView(card(), { isGM: false, canPress: true }, loc)), [CARD_ACTIONS.apply]);
  assert.deepEqual(press(castCardView(card(), { isGM: false, canPress: false }, loc)), []);
  const html = castCardContent(card(), loc);
  assert.ok(!html.includes("card-buttons"));
  assert.ok(!html.includes('data-action="applyDamage"'));
});

t("every figure on the card carries a tooltip naming where it came from; a blank figure carries the page reference alone", () => {
  const applied = card({ cite: "p. 9", entries: { t1_burn: { state: "applied", rolled: 7, applied: 4, fraction: 0.5, saved: true, steps: [{ key: "fraction", before: 7, after: 3.5 }, { key: "round", before: 3.5, after: 4 }] } } });
  const row = castCardView(applied, { isGM: false, canPress: false }, loc).sections[0].rows[0];
  assert.ok(row.tooltipText.includes("tip.rolled") && row.tooltipText.includes("tip.stepFraction") && row.tooltipText.includes("tip.appliedTotal"), "the applied figure names its roll and fraction");
  assert.ok(row.targetTooltip.includes("tip.save"), "the save target names its parts");
  const view = castCardView(applied, { isGM: false, canPress: false }, loc);
  assert.ok(view.sections[0].titleTooltip.includes("tip.roll"), "the rolled total names its dice");
  const blank = card({ cite: "p. 9", rows: { burn: { ...card().rows.burn, total: null, formula: "" } }, targets: {}, entries: {} });
  const blankView = castCardView(blank, { isGM: true, canPress: true }, loc);
  assert.equal(blankView.sections[0].titleTooltip, 'tip.cite|{"cite":"p. 9"}');
  assert.equal(blankView.sections[0].rows[0].total, "—");
  const withLevel = castCardView(card({ casterLevel: { value: 4, source: "hand" } }), { isGM: false, canPress: false }, loc);
  assert.ok(withLevel.noteTooltip.includes("tip.level.hand"), "a level typed by hand is marked");
});

t("a cast with nothing targeted posts the rolled row and an Apply for the presser's targets; a throw row carries a Throw", () => {
  const loose = card({ targets: {}, entries: {} });
  const view = castCardView(loose, { isGM: false, canPress: true }, loc);
  assert.equal(view.sections[0].rows[0].total, 7);
  assert.deepEqual(view.buttons.map((b) => b.action), [CARD_ACTIONS.applyTargets]);
  const thrown = card({ rows: { mend: { type: "damage", key: "mend", delivery: "melee", total: null, conditions: [] } }, order: ["mend"], targets: {}, entries: {} });
  const tv = castCardView(thrown, { isGM: false, canPress: true }, loc);
  assert.deepEqual(tv.sections[0].rows[0].actions.map((a) => a.action), [CARD_ACTIONS.throw]);
  assert.deepEqual(tv.buttons, [], "nothing to apply for a throw row");
});

t("a pick option's label joins the reading of each of its rows, the legend is a string, and the option's value is its token", () => {
  const rows = [
    { key: "a1", type: "damage", roll: "1d4", damage: ["fire"], pick: "form", pickOption: "flame" },
    { key: "a2", type: "conditionGrant", conditions: ["slowed"], pick: "form", pickOption: "flame" },
    { key: "b1", type: "damage", roll: "1d6", damage: ["cold"], pick: "form", pickOption: "frost" },
  ];
  const ctx = { modes: ["normal"], groups: { normal: pickGroups(rows, "normal") }, level: {}, verdicts: { normal: [] } };
  const [group] = dialogContext(ctx, {}).spell.groups;
  assert.equal(group.legend, "ACKS-MAGIC.cast.dialog.pickLegend", "a lang string, never the group id");
  assert.equal(group.label, "ACKS-MAGIC.cast.dialog.pick");
  assert.deepEqual(group.options.map((o) => o.key), ["flame", "frost"]);
  const text = (r) => describeSpellEffect(r).text;
  assert.equal(group.options[0].label, `${text(rows[0])} · ${text(rows[1])}`);
  assert.equal(typeof group.options[1].label, "string");
  assert.ok(group.options[1].label.length > 0);
});

t("the dialog context lists the modes, each mode's verdicts and the level field only where it is needed and unresolved", () => {
  const ctx = {
    modes: ["normal", "reversed"],
    groups: { normal: [], reversed: [] },
    level: { value: null, source: null },
    levelNeeded: true,
    saves: true,
    targets: [{ name: "A" }],
    verdicts: { normal: [{ key: "noSlot", severity: "block" }], reversed: [] },
    capacity: { verdict: "none", max: 2, used: 2, spellLevel: 1, source: "tradition" },
  };
  const out = dialogContext(ctx, {});
  assert.equal(out.header.hasModes, true);
  assert.equal(out.spell.level.show, true);
  assert.equal(out.footer.verdicts[0].severity, "block");
  assert.equal(out.footer.blocked, true);
  assert.ok(out.footer.capacity.line);
  assert.equal(dialogContext({ ...ctx, level: { value: 3, source: "class" } }, {}).spell.level.show, false);
  assert.equal(dialogContext({ ...ctx, levelNeeded: false }, {}).spell.level.show, false);
  assert.deepEqual(dialogContext(ctx, { mode: "reversed" }).footer.verdicts, [], "each form shows its own verdicts");
});

/* ------------------------------------------------------------------ */
/*  The claimant and the run                                          */
/* ------------------------------------------------------------------ */

t("the claimant takes a flagged spell with rows on an actor the seat owns, and declines everything else", () => {
  const s = spell([dmg()]);
  assert.equal(castSpellClaims(s, NO_TWIN), true);
  assert.equal(castSpellClaims(spell([]), NO_TWIN), false, "a rowless spell stays the system's");
  assert.equal(castSpellClaims(spell([dmg()], {}, { parent: { isOwner: false } }), NO_TWIN), false, "an actor the seat does not own");
  assert.equal(castSpellClaims(spell([dmg(), { type: "summon", ref: "def.invented.x" }]), NO_TWIN), true, "a character's summoning spell is claimed here, with rows or none");
  assert.equal(castSpellClaims(spell([], { schools: ["summoning"] }), NO_TWIN), true, "a rowless summoning spell is claimed on its type word");
  assert.equal(castSpellClaims(spell([dmg(), { type: "summon", ref: "def.invented.x" }], {}, { parent: { isOwner: true, type: "monster", uuid: "Actor.m1" } }), NO_TWIN), false, "a summon row on a monster's item is no summoning spell and stays the system's");
  assert.equal(castSpellClaims({ ...spell([dmg()]), type: "weapon" }, NO_TWIN), false, "a monster's attack item is no spell");
  assert.equal(castSpellClaims({ ...spell([dmg()]), flags: {} }, NO_TWIN), false, "an unflagged item");
  const claimant = castSpellClaimant({ lookups: NO_TWIN });
  assert.equal(claimant.key, CAST_SPELL_KEY);
  assert.equal(claimant.claims(s), true);
});

/** The dependencies of a run, recorded. */
function runDeps({ answer, capacity = { verdict: "ok" }, offList = false, isGM = false, tokens = [], casterToken = null, gaps = {}, level = { matched: false } } = {}) {
  const calls = { notices: [], posts: [], spends: 0, pools: [], records: [], applied: [], asked: null, reads: [] };
  return {
    calls,
    deps: {
      lookups: NO_TWIN,
      read: async (_spell, options) => (calls.reads.push(options), { actor: {}, tokens, casterToken, gaps, statuses: [], capacity, offList, level }),
      ask: async (ctx) => {
        calls.asked = ctx;
        return answer;
      },
      notify: (level, key) => calls.notices.push([level, key]),
      adjustPool: async (...args) => calls.pools.push(args.slice(1)),
      castId: () => "castX",
      roll: () => 1,
      post: async (c) => {
        calls.posts.push(c);
        return { id: "m1", flags: { "acks-extras": { castCard: c } } };
      },
      apply: async (...args) => calls.applied.push(args),
      record: async (c, data) => calls.records.push(data),
      throwRow: async () => null,
      now: () => 10,
      isGM: () => isGM,
    },
  };
}

await ta("a cancelled dialog spends nothing and posts nothing; a blocked Player is refused before the spend, a Judge warned and spent", async () => {
  const heal = { key: "mend", type: "heal", roll: "1d6" };
  const s = spell([heal], { duration: { shape: "fixed", value: 1, unit: "minutes" } });
  const spend = () => calls.spends++;
  let calls;
  let r = runDeps({ answer: null });
  calls = r.calls;
  assert.equal((await castSpellRun(s, spend, r.deps)).reason, "cancelled");
  assert.equal(calls.spends, 0);
  r = runDeps({ answer: { mode: "normal", picks: {} }, capacity: { verdict: "none", tradition: "arcane", slotKey: "s1", source: "tradition" } });
  calls = r.calls;
  const refused = await castSpellRun(s, spend, r.deps);
  assert.deepEqual([refused.ok, refused.reason], [false, "noSlot"]);
  assert.equal(calls.spends, 0, "refused before any spend");
  assert.deepEqual(calls.posts, []);
  r = runDeps({ answer: { mode: "normal", picks: {} }, isGM: true, capacity: { verdict: "none", tradition: "arcane", slotKey: "s1", source: "tradition" } });
  calls = r.calls;
  const warned = await castSpellRun(s, spend, r.deps);
  assert.equal(warned.ok, true);
  assert.equal(calls.spends, 1, "a Judge's warned cast spends once");
  assert.deepEqual(calls.pools, [["arcane", "s1"]], "and takes the slot from the tradition's pool");
  assert.ok(calls.notices.some(([level, key]) => level === "warn" && key === "verdict.noSlot"));
});

await ta("a cast rolls each row once, posts one card with no targets, writes no caster record for an instant spell and one for a timed row", async () => {
  const heal = { key: "mend", type: "heal", roll: "1d6" };
  let spends = 0;
  let r = runDeps({ answer: { mode: "normal", picks: {}, visibility: "gm" } });
  const out = await castSpellRun(spell([heal]), () => spends++, r.deps);
  assert.equal(out.ok, true);
  assert.equal(spends, 1);
  assert.equal(r.calls.posts.length, 1);
  const posted = r.calls.posts[0];
  assert.equal(posted.rows.mend.total, 7, "rolled once");
  assert.deepEqual(posted.targets, {});
  assert.equal(r.calls.records.length, 0, "an instantaneous cast writes no caster record");
  assert.deepEqual(r.calls.applied, [], "nothing targeted, so nothing applied");
  const dread = { key: "dread", type: "conditionGrant", conditions: ["afraid"], lasts: "duration" };
  r = runDeps({ answer: { mode: "normal", picks: {} } });
  await castSpellRun(spell([dread], { duration: { shape: "fixed", value: 1, unit: "minutes" } }), () => {}, r.deps);
  assert.equal(r.calls.records.length, 1);
  assert.equal(spellEffectOf(r.calls.records[0]).role, "caster");
  assert.deepEqual(spellEffectOf(r.calls.records[0]).duration, { value: 1, units: "minutes" });
});

await ta("a no-throw damage row that states no die asks for one once, by its key; a closed window leaves the row unrolled, and a heal row never asks", async () => {
  const asked = [];
  const mm = { key: "mm", type: "damage", roll: "", damage: ["fire"] };
  let r = runDeps({ answer: { mode: "normal", picks: {}, visibility: "gm" } });
  r.deps.askDie = async (o) => (asked.push({ rowKey: o.rowKey, castId: o.castId }), null);
  const out = await castSpellRun(spell([mm]), () => {}, r.deps);
  assert.equal(out.ok, true, "a closed window does not fail the cast");
  assert.deepEqual(asked, [{ rowKey: "mm", castId: "castX" }]);
  assert.equal(r.calls.posts[0].rows.mm.total, null, "the row is left unrolled");
  asked.length = 0;
  r = runDeps({ answer: { mode: "normal", picks: {}, visibility: "gm" } });
  r.deps.askDie = async (o) => (asked.push(o.rowKey), null);
  await castSpellRun(spell([{ key: "mend", type: "heal", roll: "1d6" }]), () => {}, r.deps);
  assert.deepEqual(asked, [], "a heal row never asks");
  // A recurring damage row that states no die asks at the cast, once, and the die typed rides on the card for its later turns.
  asked.length = 0;
  const later = { key: "burn", type: "damage", roll: "", damage: ["fire"], recur: "laterRounds" };
  r = runDeps({ answer: { mode: "normal", picks: {}, visibility: "gm" } });
  r.deps.askDie = async (o) => (asked.push(o.rowKey), "2d4+1");
  await castSpellRun(spell([later]), () => {}, r.deps);
  assert.deepEqual(asked, ["burn"], "the recurring row asks at the cast");
  assert.deepEqual(r.calls.posts[0].dice, { burn: "2d4+1" }, "the die typed is on the card");
  assert.equal(r.calls.posts[0].rows.burn, undefined, "and the cast rolls nothing for it");
  r = runDeps({ answer: { mode: "normal", picks: {}, visibility: "gm" } });
  r.deps.askDie = async () => null;
  await castSpellRun(spell([later]), () => {}, r.deps);
  assert.equal(r.calls.posts[0].dice, undefined, "a closed window leaves the card with no die");
});

await ta("an untimed cast writes a clockless caster record when a row recurs on the caster's turn, which then prompts and is ended by the passed cast-wide save; with no such row it writes none", async () => {
  const { duePrompts, resolveRecurEntry } = await import("../scripts/magic/cast-recur.mjs");
  const special = { shape: "special" };
  const choke = { key: "choke", type: "conditionGrant", conditions: ["afraid"], recur: "eachRound", recurAt: "casterTurn", recurSave: "cast", saveEffect: "negates", lasts: "duration" };
  const run = async (rows) => {
    const r = runDeps({ answer: { mode: "normal", picks: {} } });
    await castSpellRun(spell(rows, { duration: special }), () => {}, r.deps);
    return r;
  };
  assert.deepEqual(castDuration(special), { none: NONE.untimed }, "the figure is untimed");

  const r = await run([choke]);
  assert.equal(r.calls.records.length, 1, "the caster-turn row writes the record");
  const record = spellEffectOf(r.calls.records[0]);
  assert.equal(record.role, "caster");
  assert.deepEqual([record.startTime, record.duration, record.held], [undefined, undefined, undefined], "and it carries no clock");
  assert.equal(castRecordEnd(r.calls.records[0], () => 60), null, "so no end time can be read off it");

  const rows = rowsForMode(rowsOf(spell([choke], { duration: special }), NO_TWIN).rows, "normal", {});
  const cast = (casterRecord) => ({ castId: "castX", casterUuid: "Actor.c1", rows, casterRecord, bearers: [{ uuid: "Actor.b1", records: ["choke"] }] });
  const due = duePrompts({ edge: "start", actorUuid: "Actor.c1", casts: [cast(r.calls.records.some((d) => spellEffectOf(d)?.role === "caster"))] });
  assert.deepEqual(due.map((d) => [d.moment, d.rowKeys]), [["casterTurn", ["choke"]]], "the caster's turn prompts");
  assert.deepEqual(duePrompts({ edge: "start", actorUuid: "Actor.c1", casts: [cast(false)] }), [], "without the record it would not");

  const standing = [...r.calls.records];
  const ends = [];
  const deps = {
    by: "u1",
    apply: async () => [],
    writeEntry: async () => {},
    endRow: async () => 0,
    endCast: async (card) => {
      const gone = standing.splice(0).filter((d) => spellEffectOf(d)?.castId === card.castId).length;
      ends.push(card.castId);
      return gone;
    },
  };
  const card = { castId: "castX", targets: { t1: { resist: { success: true } } } };
  const done = await resolveRecurEntry({ card, targetKey: "t1", request: { rowKey: "choke" }, keyed: rows[0], found: { actor: { name: "Bearer" } }, deps });
  assert.deepEqual([done.ended, ends, standing.length], [1, ["castX"], 0], "a pass ends the untimed record through endCast");

  const plain = await run([{ key: "mend", type: "heal", roll: "1d6", lasts: "duration" }]);
  assert.equal(plain.calls.records.length, 0, "an untimed cast with no caster-turn row writes none");
  const unsaved = await run([{ ...choke, recurSave: "", recurTarget: "pick" }]);
  assert.equal(unsaved.calls.records.length, 0, "a caster-turn row that asks no cast-wide save has nothing to end the record");
  const bearerRow = await run([{ ...choke, recurAt: "bearerStart" }]);
  assert.equal(bearerRow.calls.records.length, 0, "nor does a row that recurs on the bearer's turn");
});

await ta("the reversed form casts only its own rows, and a thrown row with no target waits for its Throw", async () => {
  const rows = [dmg(), { key: "touch", type: "damage", roll: "1d4", delivery: "melee", reversed: true, damage: ["fire"] }];
  const r = runDeps({ answer: { mode: "reversed", picks: {} } });
  await castSpellRun(spell(rows), () => {}, r.deps);
  const posted = r.calls.posts[0];
  assert.deepEqual(posted.order, ["touch"]);
  assert.equal(posted.rows.touch.delivery, "melee");
  assert.equal(posted.rows.touch.total, null, "unrolled until thrown");
  assert.deepEqual(posted.entries, {});
});

/** A targeted token whose actor carries one weapon, invented. */
const bearerToken = (weaponId = "w1") => {
  const blade = { id: weaponId, name: "Testblade", type: "weapon", flags: {}, parent: { items: [] } };
  const items = [blade];
  items.get = (id) => items.find((i) => i.id === id);
  return { uuid: "Scene.s.Token.k1", name: "Ally", actor: { name: "Ally", type: "character", items, effects: [], appliedEffects: [] } };
};
const EDGE = { key: "edge", type: "modifier", target: "attackThrow", appliesTo: "recipient", value: 1, gate: { kind: "weaponMundane" }, lasts: "duration" };
const CIRCLE = { key: "circle", type: "ward", appliesTo: "recipient", vsKinds: ["undead"], lasts: "duration" };

await ta("a cast of a weapon buff names the weapon of the one target, opens one entry per row, and keeps the caster's token on the card", async () => {
  const r = runDeps({ answer: { mode: "normal", picks: {}, items: { "Scene.s.Token.k1": "w1" } }, tokens: [bearerToken()], casterToken: { uuid: "Scene.s.Token.c1" } });
  const out = await castSpellRun(spell([EDGE, CIRCLE]), () => {}, r.deps);
  assert.equal(out.ok, true);
  assert.deepEqual(r.calls.asked.holders, [{ uuid: "Scene.s.Token.k1", weapons: [{ id: "w1", name: "Testblade", magic: false }], pick: "w1" }]);
  assert.deepEqual(r.calls.asked.needsWeapon, { normal: true });
  const posted = r.calls.posts[0];
  const key = Object.keys(posted.targets)[0];
  assert.deepEqual(posted.item, { targetKey: key, id: "w1", name: "Testblade" });
  assert.equal(posted.casterTokenUuid, "Scene.s.Token.c1");
  assert.deepEqual(posted.order, ["edge", "circle"]);
  assert.deepEqual([posted.rows.edge.total, posted.rows.edge.weapon, posted.rows.circle.total, posted.rows.circle.blank], [1, true, null, false]);
  assert.deepEqual(Object.keys(posted.entries).sort(), [`${key}_circle`, `${key}_edge`]);
  assert.deepEqual(r.calls.applied[0][2].map((q) => q.rowKey).sort(), ["circle", "edge"], "both entries go to the apply as one group");
});

await ta("a weapon row with no weapon of the target's named is a line, written for nobody; a ward alone needs none", async () => {
  const r = runDeps({ answer: { mode: "normal", picks: {}, items: { "Scene.s.Token.k1": "not-its-weapon" } }, tokens: [bearerToken()], isGM: true });
  await castSpellRun(spell([EDGE, CIRCLE]), () => {}, r.deps);
  const posted = r.calls.posts[0];
  assert.equal(posted.item, undefined);
  assert.deepEqual(posted.order, ["circle"]);
  assert.equal(posted.lines.length, 1, "the weapon row is listed on the card");
  assert.equal(typeof posted.lines[0], "string");
  const two = runDeps({ answer: { mode: "normal", picks: {}, items: { "Scene.s.Token.k1": "w1" } }, tokens: [bearerToken(), { ...bearerToken(), uuid: "Scene.s.Token.k2" }], isGM: true });
  await castSpellRun(spell([EDGE]), () => {}, two.deps);
  assert.equal(two.calls.posts[0].item, undefined, "with two tokens no weapon is named");
  assert.ok(two.calls.notices.some(([level, key]) => level === "warn" && key === "verdict.oneBearer"));
});

await ta("a Player who targets no one is blocked from a weapon buff before the spend", async () => {
  let spends = 0;
  const r = runDeps({ answer: { mode: "normal", picks: {}, items: {} }, tokens: [] });
  const out = await castSpellRun(spell([EDGE]), () => spends++, r.deps);
  assert.deepEqual([out.ok, out.reason, spends], [false, "oneBearer", 0]);
});

t("the card shows a modifier section per row: the part's figure with the spell, the weapon and the page; a blank figure the page alone; what yields; one Undo for the group", () => {
  const applied = modCard({
    cite: "p. 9",
    item: { targetKey: "t1", id: "w1", name: "Testblade" },
    yields: { t1_ac: "Test fine" },
    rows: { ...modCard().rows, save: { type: "modifier", key: "save", total: null, blank: true, conditions: [] } },
    entries: { t1_ac: { state: "applied", recordIds: ["r1"] }, t1_ward: { state: "applied", recordIds: ["r1"] } },
  });
  const view = castCardView(applied, { isGM: true, canPress: true }, loc);
  const [acRow, saveRow, wardRow] = view.sections.map((s) => s.rows[0]);
  assert.equal(acRow.total, 2);
  assert.ok(acRow.tooltipText.includes("tip.part|") && acRow.tooltipText.includes("Testblade"), "the spell, the weapon and the page");
  assert.equal(acRow.detail, 'detail.yields|{"name":"Test fine"}');
  assert.equal(saveRow.total, "—");
  assert.equal(saveRow.tooltipText, 'tip.cite|{"cite":"p. 9"}', "a blank figure carries the page reference alone");
  assert.equal(wardRow.total, "—", "a ward has no figure");
  assert.ok(acRow.actions[0].tooltip.includes("tip.undoGroup"));
  assert.equal(view.sections[0].title, "row.modifier");
  assert.equal(view.sections[2].title, "row.ward");
  const noItem = castCardView(modCard({ cite: "p. 9" }), { isGM: false, canPress: false }, loc).sections[0].rows[0];
  assert.ok(noItem.tooltipText.includes("tip.partNoItem"));
});

t("the dialog offers each holder's weapon pills only where a row asks for a weapon, each marked where it is magic, the pick starting on the holder's default", () => {
  const holder = { uuid: "T1", weapons: [{ id: "w1", name: "Testblade", magic: false }, { id: "w2", name: "Testglaive", magic: true }], pick: "w2" };
  const ctx = { modes: ["normal"], rows: [EDGE], holders: [holder], targets: [{ uuid: "T1", name: "Ally" }], verdicts: { normal: [{ key: "oneBearer", severity: "block" }] } };
  const [row] = dialogContext(ctx, {}).bucket.rows;
  assert.deepEqual(row.pills.map((w) => [w.id, w.on, w.magic]), [["w1", false, false], ["w2", true, true]]);
  assert.equal(row.pills[0].label, "Testblade");
  assert.ok(row.pills[1].label.includes("weaponMagic"));
  assert.ok(dialogContext(ctx, {}).footer.verdicts[0].text.includes("blocked.oneBearer"));
  assert.deepEqual(dialogContext(ctx, { items: { T1: "w1" } }).bucket.rows[0].pills.map((w) => w.on), [true, false], "the seat's pick stands");
  assert.deepEqual(dialogContext(ctx, { items: { T1: "gone" } }).bucket.rows[0].pills.map((w) => w.on), [false, true], "a weapon the holder no longer carries falls back to its default");
  assert.deepEqual(dialogContext({ ...ctx, rows: [CIRCLE] }, {}).bucket.rows[0].pills, [], "a ward needs no weapon");
  assert.deepEqual(dialogContext({ ...ctx, holders: [holder, { ...holder, uuid: "T2" }], targets: [{ uuid: "T1", name: "A" }, { uuid: "T2", name: "B" }] }, {}).bucket.rows.map((r) => r.pills.length), [0, 0], "a weapon buff names one bearer, so two holders have no pick");
});

/* ------------------------------------------------------------------ */
/*  Held casts and the declaration (slice M2)                         */
/* ------------------------------------------------------------------ */

t("a concentration answers its kind held, a maximum its cap and a plus shape its tail, and stays untimed for every caller that tests none", () => {
  const blank = { shape: "", value: null, unit: "", dice: "", plus: { value: null, unit: "" }, concentration: "", maxPerLevel: false };
  const plain = castDuration({ ...blank, shape: "concentration" });
  assert.deepEqual(plain, { none: NONE.untimed, held: "mobile" }, "a blank kind is mobile");
  assert.equal(castDuration({ ...blank, shape: "concentration", concentration: "stationary" }).held, "stationary");
  assert.deepEqual(castDuration({ ...blank, shape: "concentrationMax", concentration: "mobile", value: 3, unit: "rounds" }).cap, { value: 3, units: "rounds" }, "a flat maximum needs no level");
  const perLevel = { ...blank, shape: "concentrationMax", value: 2, unit: "turns", maxPerLevel: true };
  assert.deepEqual(castDuration(perLevel, { casterLevel: 4 }).cap, { value: 2 * 4 * TURN_SECONDS, units: "seconds" }, "times the caster level, in the clock's own seconds");
  assert.deepEqual(castDuration(perLevel).cap, { none: NONE.noLevel }, "a per-level maximum with no level is not guessed");
  assert.deepEqual(castDuration({ ...blank, shape: "concentrationPlus", plus: { value: 2, unit: "rounds" } }).tail, { value: 2, units: "rounds" });
  assert.deepEqual(castDuration({ ...blank, shape: "concentrationPlus", plus: { value: null, unit: "rounds" } }).tail, { none: NONE.noFigure }, "a tail the import did not read is a none");
  assert.deepEqual(castDuration({ ...blank, shape: "concentrationPlus", plus: { value: 1, unit: "fortnights" } }).tail, { none: NONE.unknownUnit });
  for (const shape of ["concentration", "concentrationMax", "concentrationPlus"]) assert.equal(castDuration({ ...blank, shape, value: 1, unit: "rounds" }).none, NONE.untimed);
});

t("a per-level concentration maximum asks for a caster level; a flat one does not", () => {
  assert.equal(levelNeeded({ duration: { shape: "concentrationMax", maxPerLevel: true } }, []), true);
  assert.equal(levelNeeded({ duration: { shape: "concentrationMax", maxPerLevel: false } }, []), false);
  assert.equal(levelNeeded({ duration: { shape: "concentration" } }, []), false);
});

t("a caster record round-trips the kind held, its tail and a pending declaration with its lost stamp; a pending record holds no status", () => {
  const base = { spell: { uuid: "Actor.c1.Item.s1", name: "Testhold", img: "i.png" }, caster: { uuid: "Actor.c1" }, castId: "c1", role: "caster" };
  const held = spellEffectData({ ...base, statuses: ["concentrating-and-stationary"], held: "stationary", tail: { value: 2, units: "rounds" }, duration: { value: 10, units: "minutes" }, startTime: 100 });
  assert.deepEqual(held.statuses, ["concentrating-and-stationary"]);
  assert.equal(held.duration, undefined, "core's own duration stays unset");
  const back = spellEffectOf(held);
  assert.deepEqual([back.held, back.tail, back.duration, back.startTime], ["stationary", { value: 2, units: "rounds" }, { value: 10, units: "minutes" }, 100]);
  assert.equal(spellEffectOf(spellEffectData({ ...base, statuses: ["concentrating"], held: "mobile", tail: { none: "noFigure" } })).tail.none, "noFigure");
  const pending = { spellUuid: "Actor.c1.Item.s1", mode: "normal", picks: {}, combatId: "k1", round: 2, at: 5, lost: { cause: "damage", at: 9 } };
  const declared = spellEffectData({ ...base, pending });
  assert.equal(declared.statuses, undefined);
  assert.deepEqual(spellEffectOf(declared).pending, pending);
  assert.throws(() => spellEffectData({ ...base, pending, statuses: ["casting"] }), /no status/);
  assert.equal(spellEffectOf(spellEffectData({ ...base, statuses: ["casting"] })).pending, undefined);
});

t("the moment of a cast: free with no begun fight holding the caster, declare at any other moment, resolve on the caster's own rolled turn", () => {
  const me = { id: "cb1", initiative: 12 };
  const fight = (over = {}) => ({ started: true, flags: {}, combatant: { id: "cb1" }, ...over });
  assert.equal(castMoment({}), MOMENT.free);
  assert.equal(castMoment({ combat: null, combatant: me }), MOMENT.free);
  assert.equal(castMoment({ combat: fight(), combatant: null }), MOMENT.free, "a fight that does not hold the caster");
  assert.equal(castMoment({ combat: fight({ started: false }), combatant: me }), MOMENT.free, "a fight not begun");
  assert.equal(castMoment({ combat: fight({ started: false, flags: { acks: { initDone: true } } }), combatant: { id: "cb1", initiative: null } }), MOMENT.declare, "begun by core's own flag, initiative unrolled");
  assert.equal(castMoment({ combat: fight({ combatant: { id: "other" } }), combatant: me }), MOMENT.declare, "another's turn");
  assert.equal(castMoment({ combat: fight(), combatant: { id: "cb1", initiative: null } }), MOMENT.declare, "the caster's turn with initiative unrolled is no turn yet");
  assert.equal(castMoment({ combat: fight(), combatant: me }), MOMENT.resolve);
});

t("the declaration, the lost one and another spell's are told apart per fight; a hand-set flag counts only with no record to explain it", () => {
  const rec = (spellUuid, combatId, over = {}) => ({ castId: `${spellUuid}${combatId}`, pending: { spellUuid, combatId, ...over } });
  const records = [rec("S1", "k1"), rec("S2", "k1"), rec("S1", "k2"), rec("S3", "k1", { lost: { cause: "damage" } })];
  const here = declarationOf(records, { spellUuid: "S1", combatId: "k1" });
  assert.equal(here.valid.castId, "S1k1");
  assert.equal(here.other.castId, "S2k1");
  assert.equal(here.lost, null);
  assert.equal(declarationOf(records, { spellUuid: "S3", combatId: "k1" }).lost.castId, "S3k1");
  assert.equal(declarationOf(records, { spellUuid: "S9", combatId: "k3" }).valid, null, "another fight's records bear on nothing");
  assert.equal(declarationOf([], { spellUuid: "S1", combatId: "k1", prepareSpell: true }).hand, true);
  assert.equal(declarationOf(records, { spellUuid: "S1", combatId: "k1", prepareSpell: true }).hand, false);
});

t("the new verdicts by seat: concentrating always warns; a lost or missing declaration and a second one block a Player and warn a Judge; a resolution is never short of a slot", () => {
  const none = { verdict: "none" };
  const keyed = (isGM, over) => castVerdicts({ isGM, capacity: { verdict: "ok" }, ...over }).map((v) => `${v.key}:${v.severity}`);
  assert.deepEqual(keyed(false, { held: true }), ["concentrating:warn"], "a Player is warned, never blocked");
  assert.deepEqual(keyed(true, { held: true }), ["concentrating:warn"]);
  const decl = (over = {}) => ({ valid: null, lost: null, other: null, hand: false, ...over });
  assert.deepEqual(keyed(false, { moment: "resolve", declaration: decl({ lost: {} }) }), ["declarationLost:block"]);
  assert.deepEqual(keyed(true, { moment: "resolve", declaration: decl({ lost: {} }) }), ["declarationLost:warn"]);
  assert.deepEqual(keyed(false, { moment: "resolve", declaration: decl() }), ["noDeclaration:block"]);
  assert.deepEqual(keyed(true, { moment: "resolve", declaration: decl() }), ["noDeclaration:warn"]);
  assert.deepEqual(keyed(false, { moment: "resolve", declaration: decl({ other: {} }) }), ["noDeclaration:block"], "another spell was the one declared");
  assert.deepEqual(keyed(false, { moment: "resolve", declaration: decl({ hand: true }) }), [], "a hand-set declaration counts");
  assert.deepEqual(keyed(false, { moment: "declare", declaration: decl({ valid: {} }) }), ["declared:block"]);
  assert.deepEqual(keyed(true, { moment: "declare", declaration: decl({ other: {} }) }), ["declared:warn"]);
  assert.deepEqual(keyed(false, { moment: "declare", declaration: decl() }), []);
  assert.deepEqual(keyed(false, { moment: "resolve", declaration: decl({ valid: {} }), capacity: none }), [], "noSlot is skipped on a resolution");
  assert.deepEqual(keyed(false, { moment: "resolve", declaration: decl({ lost: {} }), capacity: none }), ["declarationLost:block", "noSlot:block"], "a lost one runs fresh, with a slot");
  assert.deepEqual(keyed(false, { moment: "declare", declaration: decl(), capacity: none }), ["noSlot:block"], "a declaration spends, so it needs the slot");
});

/** The run's deps with a fight, a held cast and declarations read from the world, and the module's own writes recorded. */
function fightDeps({ answer, world = {}, isGM = false, tokens = [] } = {}) {
  const r = runDeps({ answer, isGM, tokens });
  const log = [];
  const read = r.deps.read;
  r.deps.read = async (s) => ({ ...(await read(s)), ...world });
  r.deps.record = async (c, data) => r.calls.records.push(data) && log.push("record");
  r.deps.adjustPool = async () => log.push("pool");
  r.deps.endHeld = async () => log.push("endHeld");
  r.deps.post = async (c) => (log.push("post"), r.calls.posts.push(c), { id: "m1", flags: { "acks-extras": { castCard: c } } });
  r.deps.declare = {
    declare: async (o) => (log.push("declare"), r.calls.declared = o, { castId: "d1" }),
    finish: async (o) => (log.push("finish"), r.calls.finished = o),
    clearHand: async () => log.push("clearHand"),
  };
  return { ...r, log };
}
const HOLD = { shape: "concentrationPlus", concentration: "stationary", plus: { value: 2, unit: "rounds" } };
const heal = { key: "mend", type: "heal", roll: "1d6" };

await ta("a concentration cast ends the caster's held records after the spend and before its own, and writes a status-only held record carrying the kind and the tail", async () => {
  const { deps, calls, log } = fightDeps({ answer: { mode: "normal", picks: {} }, world: { held: true } });
  let spends = 0;
  const out = await castSpellRun(spell([heal], { duration: HOLD }), () => { spends++; log.push("spend"); }, deps);
  assert.equal(out.ok, true);
  assert.ok(calls.notices.some(([level, key]) => level === "warn" && key === "verdict.concentrating"), "warned, never refused");
  assert.deepEqual(log.slice(0, 3), ["spend", "endHeld", "record"], "the old concentration ends after the spend and before any record of this cast");
  const record = spellEffectOf(calls.records[0]);
  assert.deepEqual([record.role, record.held, record.tail], ["caster", "stationary", { value: 2, units: "rounds" }]);
  assert.deepEqual(calls.records[0].statuses, ["concentrating-and-stationary"]);
  assert.equal(calls.records[0].changes.length, 0);
  assert.equal(record.duration, undefined, "a plus shape has no cap");
  const read = castDuration(HOLD, {});
  const mark = { spell: { uuid: "Actor.c1.Item.s1", name: "Testscorch", img: "i.png" }, caster: { uuid: "Actor.c1" }, castId: record.castId, role: "caster" };
  assert.deepEqual(calls.records[0], heldRecordData(mark, { held: read.held, now: 10, tail: read.tail, cap: read.cap }), "the cast writes the record heldRecordData composes, as the summoning cast does");
  assert.equal(spends, 1);
});

await ta("a concentration with a cap is flag-timed by the cap; one with no rows still leaves its held record", async () => {
  const { deps, calls } = fightDeps({ answer: { mode: "normal", picks: {}, casterLevel: "3" } });
  await castSpellRun(spell([{ key: "note", type: "ward", appliesTo: "recipient", vsKinds: ["undead"] }], { duration: { shape: "concentrationMax", concentration: "mobile", value: 4, unit: "rounds", maxPerLevel: true } }), () => {}, deps);
  const record = spellEffectOf(calls.records[0]);
  assert.deepEqual([record.held, record.duration, record.startTime], ["mobile", { value: 12, units: "rounds" }, 10]);
  assert.deepEqual(calls.records[0].statuses, ["concentrating"]);
});

const IN_FIGHT = (over = {}) => ({
  combat: { id: "k1", started: true, round: 1, turn: 0, turns: [{ id: "cb2" }, { id: "cb1" }], flags: {}, combatant: { id: "cb2" } },
  combatant: { id: "cb1", initiative: 9 },
  ...over,
});

await ta("in a begun fight off the caster's turn the cast declares: it spends once, ends the concentration, hands the answers to the declaration and posts no card", async () => {
  const { deps, calls, log } = fightDeps({ answer: { mode: "normal", picks: {}, visibility: "gm" }, world: IN_FIGHT() });
  let spends = 0;
  const out = await castSpellRun(spell([heal]), () => { spends++; }, deps);
  assert.deepEqual([out.ok, out.declared, out.castId], [true, true, "d1"]);
  assert.equal(calls.asked.moment, "declare", "the dialog is told, so its button reads Declare");
  assert.equal(spends, 1);
  assert.deepEqual(calls.pools.length, 0, "a capacity of no pool spends no pool");
  assert.deepEqual(log, ["endHeld", "declare"]);
  assert.equal(calls.posts.length, 0, "no card is posted at a declaration");
  assert.equal(calls.declared.answer.visibility, "gm");
  assert.equal(calls.declared.combatant.id, "cb1");
});

/** A declaration of the invented spell, as the caster's records read. */
const pendingRecord = (over = {}) => ({ castId: "d1", role: "caster", pending: { spellUuid: "Actor.c1.Item.s1", mode: "normal", picks: {}, items: {}, visibility: "gm", combatId: "k1", round: 1, at: 3, ...over } });
const ON_TURN = () => IN_FIGHT({ combat: { id: "k1", started: true, round: 1, turn: 1, turns: [{ id: "cb2" }, { id: "cb1" }], flags: {}, combatant: { id: "cb1" } } });

await ta("on the caster's turn a good declaration resolves with no dialog, no spend and no capacity check; the declaration is ended and the card posts", async () => {
  const { deps, calls, log } = fightDeps({ answer: null, world: { ...ON_TURN(), declarations: [pendingRecord()], capacity: { verdict: "none", tradition: "arcane", slotKey: "s1" } } });
  let spends = 0;
  const out = await castSpellRun(spell([heal]), () => { spends++; }, deps);
  assert.equal(out.ok, true);
  assert.equal(calls.asked, null, "no dialog opened");
  assert.equal(spends, 0);
  assert.deepEqual(calls.pools, [], "and no pool was spent");
  assert.deepEqual(log.slice(0, 2), ["endHeld", "finish"], "the declaration ends before any record of the cast");
  assert.equal(calls.finished.record.castId, "d1");
  assert.equal(calls.posts.length, 1);
  assert.equal(calls.posts[0].picks && Object.keys(calls.posts[0].picks).length, 0);
});

await ta("a declaration whose weapon is no longer the one target's opens the dialog, still spending nothing", async () => {
  const buff = { key: "edge", type: "modifier", target: "attackThrow", appliesTo: "recipient", value: 1, gate: { kind: "weaponMundane" }, lasts: "duration" };
  const { deps, calls } = fightDeps({ answer: { mode: "normal", picks: {}, items: { "Scene.s.Token.k1": "w1" } }, tokens: [bearerToken("w1")], world: { ...ON_TURN(), declarations: [pendingRecord({ items: { "Scene.s.Token.k1": "gone" } })] } });
  let spends = 0;
  const out = await castSpellRun(spell([buff]), () => { spends++; }, deps);
  assert.equal(out.ok, true);
  assert.equal(calls.asked.moment, "resolve");
  assert.equal(spends, 0);
});

/** A token of the invented scene. */
const sceneToken = (n) => ({ uuid: `Scene.s.Token.k${n}`, name: `Folk ${n}`, id: `k${n}`, actor: { name: `Folk ${n}`, type: "character", items: [], effects: [], appliedEffects: [] } });
const uuidsOf = (tokens) => tokens.map((t) => t.uuid);

/**
 * A resolve at the caster's turn of a declaration naming `declared`, with the tokens still in `scene` and the user's own targets `live`, which change as the world changes them; `retarget` writes the user's targets as the canvas does.
 */
function resolveRun({ scene, live, pending = {}, answer = null }) {
  const r = fightDeps({ answer, tokens: live, world: { ...ON_TURN(), declarations: [pendingRecord(pending)] } });
  r.calls.retargeted = [];
  r.deps.declaredTargets = async (uuids) => ({ tokens: scene.filter((t) => uuids.includes(t.uuid)), gaps: {}, gone: uuids.filter((u) => !scene.some((t) => t.uuid === u)) });
  r.deps.retarget = (tokens) => {
    r.calls.retargeted.push(uuidsOf(tokens));
    live.splice(0, live.length, ...tokens);
  };
  return r;
}

await ta("a declaration resolves on the targets it declared with no dialog, whatever the user's targets are at the turn, and makes them the user's targets", async () => {
  const [k1, k2, k3] = [1, 2, 3].map(sceneToken);
  const live = [k3];
  const r = resolveRun({ scene: [k1, k2, k3], live, pending: { targets: uuidsOf([k1, k2]) } });
  // The canvas may not have written the user's targets by the time the cast reads: the declared seat is held, not read back.
  r.deps.retarget = (tokens) => r.calls.retargeted.push(uuidsOf(tokens));
  let spends = 0;
  const out = await castSpellRun(spell([heal]), () => { spends++; }, r.deps);
  assert.equal(out.ok, true);
  assert.equal(r.calls.asked, null, "no dialog opened");
  assert.equal(spends, 0);
  assert.deepEqual(Object.values(r.calls.posts[0].targets).map((tg) => tg.uuid), uuidsOf([k1, k2]), "the card is made for the declared two, not for the third the user has targeted");
  assert.deepEqual(r.calls.retargeted, [uuidsOf([k1, k2])], "the canvas is told the declared seat");
  assert.equal(r.calls.notices.some(([, key]) => key.startsWith("resolve")), false, "nothing to tell");
});

await ta("a declaration of no target resolves on nobody even when the user has targeted a token; a record from before targets were stored reads the user's targets as they stand", async () => {
  const [k1, k3] = [1, 3].map(sceneToken);
  let r = resolveRun({ scene: [k1, k3], live: [k3], pending: { targets: [] } });
  assert.equal((await castSpellRun(spell([heal]), () => {}, r.deps)).ok, true);
  assert.equal(r.calls.asked, null);
  assert.deepEqual(r.calls.posts[0].targets, {});
  r = resolveRun({ scene: [k1, k3], live: [k3] });
  await castSpellRun(spell([heal]), () => {}, r.deps);
  assert.deepEqual(Object.values(r.calls.posts[0].targets).map((tg) => tg.uuid), [k3.uuid], "no stored targets: the seat as it stands");
  assert.deepEqual(r.calls.retargeted, []);
});

await ta("a declared target that is gone reopens the dialog prefilled with what was declared and the targets that remain, naming the change, and the cast is made for the remaining seat", async () => {
  const [k1, k2, k3] = [1, 2, 3].map(sceneToken);
  const stored = { mode: "normal", picks: { g: "p" }, pickKind: "beast", items: { [k1.uuid]: "w1" }, saveMod: true, casterLevel: "5", situational: 2, visibility: "blind", targets: uuidsOf([k1, k2]), allocation: { bolt: { [k1.uuid]: "2", [k2.uuid]: "1" } } };
  const live = [k3];
  const r = resolveRun({ scene: [k1, k3], live, pending: stored, answer: { mode: "normal", picks: {}, items: {}, visibility: "gm" } });
  let spends = 0;
  const out = await castSpellRun(spell([heal]), () => { spends++; }, r.deps);
  assert.equal(out.ok, true);
  assert.equal(r.calls.asked.moment, "resolve");
  assert.equal(spends, 0, "a resolution was spent at its declaring");
  const { initial } = r.calls.asked;
  assert.deepEqual([initial.mode, initial.picks, initial.pickKind, initial.items, initial.saveMod, initial.casterLevel, initial.situational, initial.visibility], ["normal", { g: "p" }, "beast", { [k1.uuid]: "w1" }, true, "5", 2, "blind"]);
  assert.deepEqual(initial.allocation, stored.allocation, "the split is offered back");
  assert.deepEqual(uuidsOf(r.calls.asked.targets), [k1.uuid], "the dialog opens on the targets that remain");
  assert.deepEqual(r.calls.retargeted, [[k1.uuid]], "the user's targets were made the remaining declared ones before it opened");
  assert.ok(r.calls.notices.some(([level, key]) => level === "warn" && key === "resolveGone"));
  assert.deepEqual(Object.values(r.calls.posts[0].targets).map((tg) => tg.uuid), [k1.uuid], "the dialog's bucket is read again after the answer");
});

await ta("a declared weapon that no longer fits reopens the dialog prefilled with the declared answer, naming the change", async () => {
  const buff = { key: "edge", type: "modifier", target: "attackThrow", appliesTo: "recipient", value: 1, gate: { kind: "weaponMundane" }, lasts: "duration" };
  const k1 = bearerToken("w1");
  const answer = { mode: "normal", picks: {}, items: { [k1.uuid]: "w1" } };
  let r = resolveRun({ scene: [k1], live: [k1], answer, pending: { targets: [k1.uuid], items: { [k1.uuid]: "w1" }, saveMod: true, casterLevel: "4" } });
  await castSpellRun(spell([buff]), () => {}, r.deps);
  assert.equal(r.calls.asked, null, "its weapon is still the target's: no dialog");
  r = resolveRun({ scene: [k1], live: [k1], answer, pending: { targets: [k1.uuid], items: { [k1.uuid]: "gone" }, saveMod: true, casterLevel: "4" } });
  await castSpellRun(spell([buff]), () => {}, r.deps);
  assert.equal(r.calls.asked.moment, "resolve");
  assert.deepEqual([r.calls.asked.initial.items, r.calls.asked.initial.saveMod, r.calls.asked.initial.casterLevel], [{ [k1.uuid]: "gone" }, true, "4"]);
  assert.deepEqual(uuidsOf(r.calls.asked.targets), [k1.uuid]);
  assert.ok(r.calls.notices.some(([, key]) => key === "resolveItem"));
});

await ta("a lost declaration blocks a Player before any spend and warns a Judge, whose cast runs fresh with a spend; with none the same; a second declaration is blocked", async () => {
  const lost = [pendingRecord({ lost: { cause: "damage", at: 4 } })];
  let spends = 0;
  let r = fightDeps({ answer: { mode: "normal", picks: {} }, world: { ...ON_TURN(), declarations: lost } });
  const refused = await castSpellRun(spell([heal]), () => spends++, r.deps);
  assert.deepEqual([refused.ok, refused.reason, spends], [false, "declarationLost", 0]);
  r = fightDeps({ answer: { mode: "normal", picks: {} }, isGM: true, world: { ...ON_TURN(), declarations: lost } });
  assert.equal((await castSpellRun(spell([heal]), () => spends++, r.deps)).ok, true);
  assert.equal(spends, 1, "a Judge's fresh cast spends");
  assert.ok(r.calls.notices.some(([, key]) => key === "verdict.declarationLost"));
  assert.equal(r.calls.finished.record.castId, "d1", "the Judge's fresh cast ends the lost declaration");
  r = fightDeps({ answer: { mode: "normal", picks: {} }, world: { ...ON_TURN(), declarations: [] } });
  assert.equal((await castSpellRun(spell([heal]), () => spends++, r.deps)).reason, "noDeclaration");
  r = fightDeps({ answer: { mode: "normal", picks: {} }, world: { ...IN_FIGHT(), declarations: [pendingRecord()] } });
  assert.equal((await castSpellRun(spell([heal]), () => spends++, r.deps)).reason, "declared");
  assert.equal(spends, 1);
});

await ta("a hand-set declaration lets a fresh cast through, which asks, spends and clears the flag", async () => {
  const { deps, calls, log } = fightDeps({ answer: { mode: "normal", picks: {} }, world: { ...ON_TURN(), prepareSpell: true } });
  let spends = 0;
  assert.equal((await castSpellRun(spell([heal]), () => spends++, deps)).ok, true);
  assert.deepEqual([spends, calls.asked !== null, log.includes("clearHand")], [1, true, true]);
});

t("the dialog says Declare's hint in its footer at a declaration and names the caster in the concentration verdict", () => {
  const ctx = { modes: ["normal"], moment: "declare", fight: { state: "noScene", scene: "", round: 1 }, caster: { name: "Testcaster" }, verdicts: { normal: [{ key: "concentrating", severity: "warn" }] } };
  const out = dialogContext(ctx, {});
  assert.ok(out.footer.declaring.includes("dialog.declaringInCast"));
  assert.ok(out.footer.verdicts[0].text.includes("verdict.concentrating"));
  assert.equal(dialogContext({ ...ctx, moment: "free" }, {}).footer.declaring, "");
});

/* ------------------------------------------------------------------ */
/*  Range, count and picks in the run                                 */
/* ------------------------------------------------------------------ */

const folkToken = (id) => ({ uuid: `Scene.s.Token.${id}`, name: `Folk ${id}`, actor: { name: `Folk ${id}`, type: "monster", items: [], effects: [] } });
const RANGED = { range: { shape: "distance", value: 30, unit: "feet" }, target: { model: "creature", count: { kind: "flat", flat: 2 } } };

await ta("a target beyond the spell's range refuses a Player before the spend and warns a Judge, whose cast goes on; one in range, or unmeasured, is no verdict", async () => {
  const s = spell([{ key: "mend", type: "heal", roll: "1d6" }], RANGED);
  const spend = () => calls.spends++;
  const far = folkToken("a");
  let r = runDeps({ answer: { mode: "normal", picks: {} }, tokens: [far], gaps: { [far.uuid]: 45 } });
  let calls = r.calls;
  const refused = await castSpellRun(s, spend, r.deps);
  assert.deepEqual([refused.ok, refused.reason], [false, "outOfRange"]);
  assert.equal(calls.spends, 0);
  assert.deepEqual(calls.notices, [["warn", "blocked.outOfRange"]]);
  assert.deepEqual(calls.asked.verdicts.normal.map((v) => [v.key, v.severity]), [["outOfRange", "block"]], "the dialog shows it before the seat confirms");
  assert.equal(calls.asked.rangeUnmeasured, false);
  r = runDeps({ answer: { mode: "normal", picks: {} }, tokens: [far], gaps: { [far.uuid]: 45 }, isGM: true });
  calls = r.calls;
  assert.equal((await castSpellRun(s, spend, r.deps)).ok, true);
  assert.equal(calls.spends, 1);
  assert.ok(calls.notices.some(([level, key]) => level === "warn" && key === "verdict.outOfRange"));
  r = runDeps({ answer: { mode: "normal", picks: {} }, tokens: [far], gaps: { [far.uuid]: 30 } });
  assert.equal((await castSpellRun(s, () => {}, r.deps)).ok, true, "a gap at the range is in range");
  r = runDeps({ answer: { mode: "normal", picks: {} }, tokens: [far], gaps: { [far.uuid]: null } });
  assert.equal((await castSpellRun(s, () => {}, r.deps)).ok, true, "no measurable gap, no verdict");
  assert.equal(r.calls.asked.rangeUnmeasured, true, "and the dialog says the range was not measured");
});

await ta("a per-level range is judged at the level the seat typed; a count the import read caps the targets", async () => {
  const s = spell([{ key: "mend", type: "heal", roll: "1d6" }], { range: { shape: "distancePerLevel", value: 10, unit: "feet" }, target: { model: "creature", count: { kind: "flat", flat: 1 } } });
  const a = folkToken("a");
  const b = folkToken("b");
  let r = runDeps({ answer: { mode: "normal", picks: {}, casterLevel: "3" }, tokens: [a], gaps: { [a.uuid]: 45 } });
  const refused = await castSpellRun(s, () => {}, r.deps);
  assert.equal(refused.reason, "outOfRange", "the typed level 3 reaches thirty feet, not forty-five");
  assert.equal(r.calls.asked.levelNeeded, true, "the dialog asks for the level");
  assert.deepEqual(r.calls.asked.verdicts.normal, [], "and judges nothing until it is known");
  r = runDeps({ answer: { mode: "normal", picks: {}, casterLevel: "5" }, tokens: [a], gaps: { [a.uuid]: 45 } });
  assert.equal((await castSpellRun(s, () => {}, r.deps)).ok, true, "level 5 reaches fifty feet");
  r = runDeps({ answer: { mode: "normal", picks: {}, casterLevel: "5" }, tokens: [a, b], gaps: { [a.uuid]: 5, [b.uuid]: 5 } });
  const over = await castSpellRun(s, () => {}, r.deps);
  assert.deepEqual([over.ok, over.reason], [false, "tooManyTargets"]);
  assert.deepEqual(r.calls.notices, [["warn", "blocked.tooManyTargets"]]);
  const blank = spell([{ key: "mend", type: "heal", roll: "1d6" }], { range: { shape: "distance", value: 30, unit: "feet" }, target: { model: "creature" } });
  r = runDeps({ answer: { mode: "normal", picks: {} }, tokens: [a, b], gaps: { [a.uuid]: 5, [b.uuid]: 5 } });
  assert.equal((await castSpellRun(blank, () => {}, r.deps)).ok, true, "a blank count caps nothing");
});

await ta("a cast whose rows open no entry measures no target: a detect row lasting the duration is not range-blocked by far targets, and neither range nor count applies; one aimed at a recipient still is", async () => {
  const detect = (appliesTo) => ({ key: "sense", type: "detect", appliesTo, lasts: "duration" });
  const figures = { range: { shape: "distance", value: 30, unit: "feet" }, target: { model: "creature", count: { kind: "flat", flat: 1 } }, duration: { shape: "fixed", value: 3, unit: "rounds" } };
  const a = folkToken("a");
  const b = folkToken("b");
  const gaps = { [a.uuid]: 90, [b.uuid]: 95 };
  const cast = async (rows, over = {}) => {
    const r = runDeps({ answer: { mode: "normal", picks: {} }, tokens: [a, b], gaps, ...over });
    const out = await castSpellRun(spell(rows, figures), () => r.calls.spends++, r.deps);
    return { r, out };
  };
  const area = await cast([detect("area")]);
  assert.equal(area.out.ok, true, "far, over-count stale targets stop a Player's cast of nothing");
  assert.deepEqual(area.r.calls.asked.verdicts.normal, [], "the dialog shows no verdict");
  assert.equal(area.r.calls.asked.rangeUnmeasured, false);
  assert.equal(area.r.calls.spends, 1);
  assert.ok(!area.r.calls.notices.some(([, key]) => /outOfRange|tooManyTargets/.test(key)));
  const none = await cast([detect("area")], { isGM: true });
  assert.ok(!none.r.calls.notices.some(([, key]) => /outOfRange|tooManyTargets/.test(key)), "and a Judge is warned of neither");
  const mirror = await cast([detect("recipient")]);
  assert.deepEqual([mirror.out.ok, mirror.out.reason], [false, "outOfRange"], "a recipient row opens an entry per target, so the targets are measured");
  assert.deepEqual(mirror.r.calls.asked.verdicts.normal.map((v) => v.key), ["outOfRange", "tooManyTargets"]);
  const mixed = await cast([detect("area"), { key: "mend", type: "heal", roll: "1d6" }]);
  assert.equal(mixed.out.reason, "outOfRange", "one row that opens an entry is enough");
  const reach = castReach({ figures, level: 5, tokens: [a, b], gaps, takes: false });
  assert.deepEqual([reach.range.out, reach.range.limit, reach.count], [[], null, null]);
});

await ta("takesTargets agrees with the entries a cast opens: no row that opens one on a token is called one that does not", async () => {
  const kinds = {
    heal: { key: "r", type: "heal", roll: "1d6" },
    healSelf: { key: "r", type: "heal", roll: "1d6", appliesTo: "self" },
    laterRounds: { key: "r", type: "damage", roll: "1d6", recur: "laterRounds" },
    slay: { key: "r", type: "slay" },
    lift: { key: "r", type: "conditionRemove", conditions: ["dread"] },
    ignite: { key: "r", type: "ignite", appliesTo: "target", lasts: "duration" },
    igniteSelf: { key: "r", type: "ignite", appliesTo: "self", lasts: "duration" },
    detectArea: { key: "r", type: "detect", appliesTo: "area", lasts: "duration" },
    detectRecipient: { key: "r", type: "detect", appliesTo: "recipient", lasts: "duration" },
    delay: { key: "r", type: "afflictionDelay", appliesTo: "recipient", effects: ["disease"], lasts: "duration" },
    purify: { key: "r", type: "purify" },
    seal: { key: "r", type: "seal", lasts: "duration" },
  };
  const near = folkToken("n");
  for (const [name, row] of Object.entries(kinds)) {
    const r = runDeps({ answer: { mode: "normal", picks: {} }, tokens: [near], gaps: { [near.uuid]: 5 } });
    await castSpellRun(spell([row]), () => {}, r.deps);
    const card = r.calls.posts[0];
    const onTokens = Object.keys(card.entries).filter((id) => !card.targets[id.split("_")[0]]?.self);
    const takes = takesTargets(keyedRows([row]));
    if (onTokens.length) assert.equal(takes, true, `${name}: an entry opened on a token, so the cast measures it`);
    if (!takes) assert.deepEqual(onTokens, [], `${name}: no entry on a token`);
  }
});

await ta("a cast keeps every row of the picked option on the card", async () => {
  const rows = [
    { key: "a1", type: "heal", roll: "1d4", pick: "form", pickOption: "flame" },
    { key: "a2", type: "heal", roll: "1d6", pick: "form", pickOption: "flame" },
    { key: "b1", type: "heal", roll: "1d8", pick: "form", pickOption: "frost" },
  ];
  let r = runDeps({ answer: { mode: "normal", picks: { form: "flame" } } });
  await castSpellRun(spell(rows), () => {}, r.deps);
  assert.deepEqual(r.calls.posts[0].order, ["a1", "a2"]);
  assert.deepEqual(r.calls.posts[0].picks, { form: "flame" });
  r = runDeps({ answer: { mode: "normal", picks: { form: "frost" } } });
  await castSpellRun(spell(rows), () => {}, r.deps);
  assert.deepEqual(r.calls.posts[0].order, ["b1"]);
  assert.deepEqual(r.calls.asked.groups.normal[0].options.map((o) => o.token), ["flame", "frost"]);
});

/* ------------------------------------------------------------------ */
/*  A record that lives (invented spells; no printed figure)           */
/* ------------------------------------------------------------------ */

const { lifeOf, lifeEntry, roundsBounds, roundsCount } = await import("../scripts/magic/cast-life.mjs");
const { fightHolding } = await import("../scripts/magic/cast-moment.mjs");
const { requestOf } = await import("../scripts/magic/cast-throw.mjs");

/** A card whose one row is an invented condition that lasts as the given fields say. */
const lifeCard = (fields, entry = { state: "pending" }) =>
  card({
    save: { category: "", effect: "" },
    rows: { dread: { type: "conditionGrant", key: "dread", conditions: ["afraid"], ...fields } },
    order: ["dread"],
    targets: { t1: { uuid: "Scene.s.Token.k1", name: "T", resist: null } },
    entries: { t1_dread: entry },
  });
const BEARER_FIGHT = async () => ({ combatId: "c1", combatantId: "k1" });
const turnLifeOf = (data) => data.flags["acks-extras"].turnLife;

await ta("in a begun fight a next-turn record carries the turn end and the one-round clock", async () => {
  const c = lifeCard({ lasts: "nextTurn" });
  const { deps, log } = fakeDeps({ fight: BEARER_FIGHT });
  const out = await applyOnTarget(c, "t1", [{ rowKey: "dread" }], deps);
  assert.deepEqual(turnLifeOf(log.made[0]), { combatId: "c1", combatantId: "k1", edge: "end", count: 1, seen: 0 });
  assert.deepEqual([spellEffectOf(log.made[0]).duration, spellEffectOf(log.made[0]).startTime], [{ value: 1, units: "rounds" }, 500]);
  assert.deepEqual(log.made[0].statuses, ["afraid"]);
  assert.deepEqual(out[0].entry.life, { kind: "nextTurn", count: 1, formula: "", turn: true });
  assert.deepEqual(spellEffectOf(log.made[0]).turnLife, { combatId: "c1", combatantId: "k1", edge: "end", count: 1, seen: 0 }, "read back whole");
});

await ta("in a begun fight a rounds record counts the bearer's turn starts and carries the clock of the rolled rounds", async () => {
  const c = lifeCard({ lasts: "rounds", rounds: "1d4" });
  const { deps, log } = fakeDeps({ fight: BEARER_FIGHT });
  const out = await applyOnTarget(c, "t1", [{ rowKey: "dread", rounds: 3 }], deps);
  assert.deepEqual(turnLifeOf(log.made[0]), { combatId: "c1", combatantId: "k1", edge: "start", count: 3, seen: 0 });
  assert.deepEqual(spellEffectOf(log.made[0]).duration, { value: 3, units: "rounds" });
  assert.equal(out[0].entry.life.count, 3);
  assert.equal(out[0].entry.life.turn, true);
});

await ta("outside a fight, or with the bearer no combatant of it, the clock alone ends the record", async () => {
  for (const fight of [undefined, async () => null]) {
    const next = fakeDeps({ fight });
    await applyOnTarget(lifeCard({ lasts: "nextTurn" }), "t1", [{ rowKey: "dread" }], next.deps);
    assert.equal(next.log.made[0].flags["acks-extras"].turnLife, undefined, "no turn flag");
    assert.deepEqual(spellEffectOf(next.log.made[0]).duration, { value: 1, units: "rounds" });
    const rounds = fakeDeps({ fight });
    const out = await applyOnTarget(lifeCard({ lasts: "rounds", rounds: "1d4" }), "t1", [{ rowKey: "dread", rounds: 2 }], rounds.deps);
    assert.equal(rounds.log.made[0].flags["acks-extras"].turnLife, undefined);
    assert.deepEqual([spellEffectOf(rounds.log.made[0]).duration, spellEffectOf(rounds.log.made[0]).startTime], [{ value: 2, units: "rounds" }, 500]);
    assert.equal(out[0].entry.life.turn, false);
  }
});

t("a fight that holds the caster and not the bearer gives the bearer no turn; a token is matched before its actor", () => {
  const caster = { uuid: "Actor.c1" };
  const bearer = { uuid: "Actor.b1" };
  const fight = (over = {}) => ({ id: "c1", started: true, combatants: [{ id: "kc", actor: caster, tokenId: "tc" }], ...over });
  assert.equal(fightHolding([fight()], { actor: bearer }), null, "the bearer is no combatant of it");
  assert.equal(fightHolding([fight({ started: false })], { actor: caster }), null, "a fight not begun holds nobody");
  assert.equal(fightHolding([fight({ started: false, flags: { acks: { initDone: true } } })], { actor: caster })?.combatant.id, "kc", "core's own begun mark counts");
  assert.equal(fightHolding([fight()], { actor: { uuid: "Actor.c1" } })?.combatant.id, "kc", "by uuid");
  const two = fight({ combatants: [{ id: "k1", actor: bearer, tokenId: "t1" }, { id: "k2", actor: bearer, tokenId: "t2" }] });
  assert.equal(fightHolding([two], { actor: bearer, token: { id: "t2" } }).combatant.id, "k2", "the second token of a linked actor");
  assert.equal(fightHolding([null, two], { actor: bearer }).combat.id, "c1", "an absent fight is passed by");
});

await ta("a rounds row with a blank formula, or no count, leaves its record untimed", async () => {
  for (const [fields, request] of [
    [{ lasts: "rounds", rounds: "" }, { rowKey: "dread", rounds: 5 }],
    [{ lasts: "rounds" }, { rowKey: "dread", rounds: 5 }],
    [{ lasts: "rounds", rounds: "1d4" }, { rowKey: "dread" }],
    [{ lasts: "rounds", rounds: "1d4" }, { rowKey: "dread", rounds: 0 }],
    [{ lasts: "rounds", rounds: "1d4" }, { rowKey: "dread", rounds: 1.5 }],
  ]) {
    const { deps, log } = fakeDeps({ fight: BEARER_FIGHT });
    const out = await applyOnTarget(lifeCard(fields), "t1", [request], deps);
    const record = spellEffectOf(log.made[0]);
    assert.deepEqual([record.duration, record.startTime, record.turnLife], [undefined, undefined, undefined], JSON.stringify([fields, request]));
    assert.equal(out[0].entry.life.count, null);
    assert.equal(log.made[0].statuses[0], "afraid", "the condition is still written");
  }
});

t("the relay takes a rolled count within the formula's reach and refuses any other", () => {
  const rows = [{ key: "dread", row: { key: "dread", type: "conditionGrant", conditions: ["afraid"], lasts: "rounds", rounds: "1d4" } }];
  const c = lifeCard({ lasts: "rounds", rounds: "1d4" });
  const world = (over = {}) => ({ message: { authorId: "p1" }, card: c, ownsCaster: true, spellOfCaster: true, rows, resist: null, boundsOf: () => null, roundsBoundsOf: () => ({ min: 1, max: 4 }), ...over });
  const req = (rounds) => ({ requestUserId: "p1", messageId: "m", targetKey: "t1", resist: null, entries: [{ rowKey: "dread", ...(rounds === undefined ? {} : { rounds }) }] });
  for (const ok of [1, 2, 4]) assert.deepEqual(checkApplyRequest(req(ok), world()), { ok: true }, `${ok} is in reach`);
  for (const bad of [0, 5, 2.5, "x", null, undefined]) assert.equal(checkApplyRequest(req(bad), world()).refused, "badRounds", `${bad} is not`);
  assert.equal(checkApplyRequest(req(3), world({ roundsBoundsOf: () => null })).refused, "badRounds", "a formula that cannot be read takes no count");
  assert.deepEqual(checkApplyRequest(req(undefined), world({ roundsBoundsOf: () => null })), { ok: true }, "and none is asked of it");
  const blank = [{ key: "dread", row: { key: "dread", type: "conditionGrant", conditions: ["afraid"], lasts: "rounds", rounds: "" } }];
  assert.deepEqual(checkApplyRequest(req(99), world({ rows: blank })), { ok: true }, "a blank formula ignores a count");
  const next = [{ key: "dread", row: { key: "dread", type: "conditionGrant", conditions: ["afraid"], lasts: "nextTurn" } }];
  assert.deepEqual(checkApplyRequest(req(99), world({ rows: next })), { ok: true }, "a next turn has no count");
});

t("a rolled count and a formula's reach are held to a floor of one round, and an unreadable formula has none", () => {
  assert.equal(roundsCount(0), 1);
  assert.equal(roundsCount(-2), 1);
  assert.equal(roundsCount(3.9), 3);
  assert.equal(roundsCount("x"), null);
  const reach = (min, max) => () => ({ min, max });
  assert.deepEqual(roundsBounds("f", reach(-2, 1)), { min: 1, max: 1 }, "a formula that can roll zero or less");
  assert.deepEqual(roundsBounds("f", reach(1, 4)), { min: 1, max: 4 });
  assert.equal(roundsBounds("", reach(1, 4)), null);
  assert.equal(roundsBounds("f", () => { throw new Error("no"); }), null);
  assert.equal(lifeOf({ lasts: "duration" }), null, "a duration row asks for no life of its own");
  assert.equal(lifeOf({ lasts: "rounds", rounds: "1d4" }, { count: 2, fight: { combatId: "c", combatantId: "k" } }).turnLife.count, 2);
  assert.deepEqual(lifeEntry(lifeOf({ lasts: "rounds", rounds: "1d4" }, { count: 2 }), "3"), { kind: "rounds", count: 2, formula: "1d4", detail: "3", turn: false });
});

t("a spell record's turn flag passes through and a malformed one is not written; the clock deletes it when its rounds pass", () => {
  const base = { spell: { uuid: "S", name: "N", img: "i" }, caster: { uuid: "C" }, castId: "x", role: "recipient", statuses: ["afraid"], startTime: 100, duration: { value: 3, units: "rounds" } };
  const good = spellEffectData({ ...base, turnLife: { combatId: "c1", combatantId: "k1", edge: "start", count: 3, seen: 0 } });
  assert.deepEqual(turnLifeOf(good), { combatId: "c1", combatantId: "k1", edge: "start", count: 3, seen: 0 });
  assert.equal(spellEffectData({ ...base, turnLife: { combatId: "c1", edge: "start", count: 3 } }).flags["acks-extras"].turnLife, undefined);
  assert.equal(spellEffectData(base).flags["acks-extras"].turnLife, undefined);
  const secondsOf = () => null;
  assert.equal(endAction(good, { worldTime: 100 + 3 * ROUND_SECONDS - 1, secondsOf }), null);
  assert.equal(endAction(good, { worldTime: 100 + 3 * ROUND_SECONDS, secondsOf }), "delete", "deleted by id past its rounds");
});

await ta("a card opens a rounds condition with its count rolled and shown, once for each target's record", async () => {
  const had = globalThis.Roll;
  globalThis.Roll = class {
    constructor(formula) {
      this.formula = formula;
    }
    async evaluate() {
      if (this.formula === "bad") throw new Error("not a formula");
      this.total = 3;
      this.result = "1 + 2";
      return this;
    }
  };
  try {
    const token = (id) => ({ uuid: `Scene.s.Token.${id}`, name: id, actor: { type: "monster", system: {}, getFlag: () => undefined, effects: [] } });
    const caster = { uuid: "Actor.c1", name: "Caster" };
    const run = (row) => buildTargets({ tokens: [token("a"), token("b")], card: { rows: { dread: { type: "conditionGrant", key: "dread", conditions: ["afraid"] } }, casterLevel: {} }, rows: [{ row, key: "dread" }], save: { category: "", effect: "" }, situational: null, caster, randomID: (() => { let i = 0; return () => `r${i++}`; })() });
    const dread = { key: "dread", type: "conditionGrant", conditions: ["afraid"], lasts: "rounds", rounds: "1d4" };
    const made = await run(dread);
    const lives = Object.values(made.entries).map((e) => e.life);
    assert.deepEqual(lives, [{ kind: "rounds", count: 3, formula: "1d4", detail: "1 + 2" }, { kind: "rounds", count: 3, formula: "1d4", detail: "1 + 2" }]);
    assert.equal(made.rolls.length, 2, "each roll is on the card");
    assert.deepEqual(Object.values((await run({ ...dread, rounds: "" })).entries).map((e) => e.life.count), [null, null], "a blank formula opens with no count");
    assert.deepEqual(Object.values((await run({ ...dread, rounds: "bad" })).entries).map((e) => e.life.count), [null, null], "a formula that will not roll likewise");
    assert.equal(Object.values((await run({ ...dread, lasts: "nextTurn" })).entries)[0].life, undefined, "a next turn rolls nothing");
    const card2 = lifeCard({ lasts: "rounds", rounds: "1d4" }, { state: "pending", life: lives[0] });
    assert.deepEqual(requestOf("dread", card2.entries.t1_dread, card2), { rowKey: "dread", rolled: undefined, critical: false, rounds: 3 }, "the count travels in the request");
  } finally {
    globalThis.Roll = had;
  }
});

t("the card's entry names the life: the roll, the end it was written with, and the page reference alone where nothing was read", () => {
  const view = (life, cite = "p. 9") => castCardView({ ...lifeCard({ lasts: life.kind }, { state: "applied", recordIds: ["r1"], life }), cite }, { isGM: true, canPress: false }, realLoc).sections[0].rows[0];
  const turn = view({ kind: "rounds", count: 3, formula: "1d4", detail: "1 + 2", turn: true });
  assert.match(turn.tooltipText, /Lasts 3 rounds: 1d4 rolled 1 \+ 2\./);
  assert.match(turn.tooltipText, /start of the bearer's turn/);
  assert.match(turn.tooltipText, /p\. 9$/);
  assert.match(turn.detail, /Lasts 3 rounds/);
  assert.match(view({ kind: "rounds", count: 3, formula: "1d4", turn: false }).tooltipText, /only the world clock ends it, after 3 rounds/);
  const next = view({ kind: "nextTurn", count: 1, formula: "", turn: true });
  assert.match(next.tooltipText, /end of the bearer's next turn/);
  assert.match(next.detail, /next turn/);
  const blank = view({ kind: "rounds", count: null, formula: "" });
  assert.equal(blank.tooltipText, "p. 9", "the page reference alone");
  assert.equal(blank.detail, "", "no figure and no words saying it is missing");
});

/* ------------------------------------------------------------------ */
/*  S4c: the following turn, clockless conditions, what ends a record, */
/*  a row no save governs, the reverse's duration (invented spells)    */
/* ------------------------------------------------------------------ */

const { endedBy } = await import("../scripts/lib/ends-on.mjs");
const { castDurationOf } = await import("../scripts/magic/cast-spell.mjs");

await ta("a following-turn record starts counting at the bearer's turn starts and lasts two: in a fight a turn end, outside one the two-round clock", async () => {
  const c = lifeCard({ lasts: "followingTurn" });
  const { deps, log } = fakeDeps({ fight: BEARER_FIGHT });
  const out = await applyOnTarget(c, "t1", [{ rowKey: "dread" }], deps);
  assert.deepEqual(turnLifeOf(log.made[0]), { combatId: "c1", combatantId: "k1", edge: "start", count: 2, seen: 0 });
  assert.deepEqual([spellEffectOf(log.made[0]).duration, spellEffectOf(log.made[0]).startTime], [{ value: 2, units: "rounds" }, 500]);
  assert.deepEqual(out[0].entry.life, { kind: "followingTurn", count: 2, formula: "", turn: true });
  for (const fight of [undefined, async () => null]) {
    const next = fakeDeps({ fight });
    const done = await applyOnTarget(lifeCard({ lasts: "followingTurn" }), "t1", [{ rowKey: "dread" }], next.deps);
    assert.equal(next.log.made[0].flags["acks-extras"].turnLife, undefined, "no turn flag");
    assert.deepEqual(spellEffectOf(next.log.made[0]).duration, { value: 2, units: "rounds" });
    assert.equal(done[0].entry.life.turn, false);
  }
  assert.deepEqual(lifeOf({ lasts: "followingTurn" }, { fight: { combatId: "c", combatantId: "k" } }).turnLife, { combatId: "c", combatantId: "k", edge: "start", count: 2, seen: 0 });
});

t("a following-turn entry reads on the card as its own life, in the tooltip and the line", () => {
  const view = (life) => castCardView({ ...lifeCard({ lasts: "followingTurn" }, { state: "applied", recordIds: ["r1"], life }), cite: "p. 9" }, { isGM: true, canPress: false }, realLoc).sections[0].rows[0];
  const turn = view({ kind: "followingTurn", count: 2, formula: "", turn: true });
  assert.match(turn.tooltipText, /^Lasts until the start of the bearer's following turn\./);
  assert.match(turn.tooltipText, /makes 2 turns begun since the cast, or when the world clock passes 2 rounds/);
  assert.match(turn.detail, /following turn/);
  assert.match(view({ kind: "followingTurn", count: 2, formula: "", turn: false }).tooltipText, /only the world clock ends it, after 2 rounds/);
});

await ta("a condition the row lists as untimed is written with no clock and no turn end, while its sibling keeps the row's life", async () => {
  const c = lifeCard({ lasts: "followingTurn", conditions: ["afraid", "prone"], untimed: ["prone"] });
  const { deps, log } = fakeDeps({ fight: BEARER_FIGHT });
  await applyOnTarget(c, "t1", [{ rowKey: "dread" }], deps);
  const [timed, free] = ["afraid", "prone"].map((s) => log.made.find((d) => d.statuses[0] === s));
  assert.deepEqual(spellEffectOf(timed).duration, { value: 2, units: "rounds" });
  assert.ok(turnLifeOf(timed));
  assert.equal(spellEffectOf(free).duration, undefined, "no clock");
  assert.equal(spellEffectOf(free).startTime, undefined);
  assert.equal(turnLifeOf(free), undefined, "no turn end");
  const whole = lifeCard({ lasts: "duration", conditions: ["afraid", "prone"], untimed: ["afraid", "prone"] });
  const next = fakeDeps();
  await applyOnTarget(whole, "t1", [{ rowKey: "dread" }], next.deps);
  assert.deepEqual(next.log.made.map((d) => spellEffectOf(d).duration), [undefined, undefined], "a duration row's listed conditions have none either");
  const plain = fakeDeps();
  await applyOnTarget(lifeCard({ lasts: "duration", conditions: ["afraid"] }), "t1", [{ rowKey: "dread" }], plain.deps);
  assert.deepEqual(spellEffectOf(plain.log.made[0]).duration, { value: 60, units: "seconds" }, "an unlisted condition keeps the cast's clock");
});

await ta("a condition row's endsOn rides on each record it writes, where lib's loss finds it by id, and a cause no one knows is not written", async () => {
  const c = lifeCard({ lasts: "duration", conditions: ["afraid", "prone"], endsOn: ["damage", "bogus", "damage"] });
  const { deps, log } = fakeDeps();
  await applyOnTarget(c, "t1", [{ rowKey: "dread" }], deps);
  assert.equal(log.made.length, 2);
  for (const data of log.made) assert.deepEqual(data.flags["acks-extras"].endsOn, ["damage"]);
  const effects = log.made.map((data, i) => ({ id: `e${i}`, flags: data.flags }));
  assert.deepEqual(endedBy(effects, "damage"), ["e0", "e1"]);
  assert.deepEqual(endedBy(effects, "attack"), []);
  const plain = fakeDeps();
  await applyOnTarget(lifeCard({ lasts: "duration", conditions: ["afraid"] }), "t1", [{ rowKey: "dread" }], plain.deps);
  assert.equal("endsOn" in plain.log.made[0].flags["acks-extras"], false, "a row that names none writes no flag");
  assert.equal(spellEffectData({ spell: { uuid: "s", name: "S" }, caster: { uuid: "c" }, castId: "x", role: "recipient", endsOn: "damage" }).flags["acks-extras"].endsOn, undefined, "a flag that is no list ends nothing");
});

t("a row no saving throw governs takes the whole amount on a passed save, beside a row the same save negates", () => {
  const passed = { success: true };
  const spellSave = { category: "spell", effect: "negates" };
  assert.deepEqual(saveFractionOf({ saveEffect: "none" }, spellSave, passed), { fraction: 1, effect: "none", saved: null });
  assert.deepEqual(saveFractionOf({}, spellSave, passed), { fraction: 0, effect: "negates", saved: true }, "the sibling row is negated");
  assert.equal(saveFractionOf({}, { effect: "none" }, passed).fraction, 1, "the spell's own none");
  assert.equal(saveFractionOf({ saveEffect: "none" }, spellSave, { success: false }).fraction, 1);
  assert.equal(saveFractionOf({ saveEffect: "none" }, spellSave, null).fraction, 1);
  const free = amountOf({ type: "damage", key: "a", saveEffect: "none" }, { save: spellSave }, passed, 6);
  const governed = amountOf({ type: "damage", key: "b" }, { save: spellSave }, passed, 6);
  assert.deepEqual([free.judge, free.applied, free.fraction], [false, 6, 1]);
  assert.deepEqual([governed.judge, governed.applied, governed.fraction], [false, 0, 0]);
});

await ta("a condition row no save governs is written whole when the target passed the spell's save, and the governed one is not", async () => {
  const c = card({
    save: { category: "spell", effect: "negates" },
    rows: {
      dread: { type: "conditionGrant", key: "dread", conditions: ["afraid"], saveEffect: "none", lasts: "duration" },
      numb: { type: "conditionGrant", key: "numb", conditions: ["prone"], lasts: "duration" },
    },
    order: ["dread", "numb"],
    targets: { t1: { uuid: "Scene.s.Token.k1", name: "T", resist: { kind: "save", category: "spell", formula: "1d20", total: 15, target: 13, success: true, parts: [] } } },
    entries: { t1_dread: { state: "pending" }, t1_numb: { state: "pending" } },
  });
  const { deps, log } = fakeDeps();
  const out = await applyOnTarget(c, "t1", [{ rowKey: "dread" }, { rowKey: "numb" }], deps);
  assert.deepEqual(log.made.map((d) => d.statuses[0]), ["afraid"], "only the row no save governs wrote its condition");
  assert.equal(out.find((o) => o.id === "t1_numb").entry.saved, true);
});

await ta("a reversed cast reads the reverse's own duration where the spell prints one, else the plain one; the twin's reverse stands for a copy that prints none", async () => {
  const flag = (duration, reversedDuration) => ({ flags: { "acks-extras": { cookbook: { id: "def.spell.testTwin" }, spell: { duration, ...(reversedDuration ? { reversedDuration } : {}) } } } });
  const plain = { shape: "fixed", value: 3, unit: "turns" };
  const reverse = { shape: "perLevel", value: 2, unit: "rounds" };
  const none = { byCookbookId: () => null };
  const spell = flag(plain, reverse);
  assert.deepEqual(castDurationOf(spell, none, 4, undefined, "normal"), { value: 3 * TURN_SECONDS, units: "seconds" });
  assert.deepEqual(castDurationOf(spell, none, 4, undefined, "reversed"), { value: 8, units: "rounds" }, "the reverse's own, at the caster level");
  assert.deepEqual(castDurationOf(spell, none, 4), { value: 3 * TURN_SECONDS, units: "seconds" }, "no mode reads the plain duration");
  assert.deepEqual(castDurationOf(flag(plain), none, 4, undefined, "reversed"), { value: 3 * TURN_SECONDS, units: "seconds" }, "a spell printing no reverse duration keeps the plain one");
  assert.deepEqual(castDurationOf(flag(plain, { shape: "", value: 9 }), none, 4, undefined, "reversed"), { value: 3 * TURN_SECONDS, units: "seconds" }, "a reverse with no shape is none");
  const twin = flag(plain, reverse);
  const bare = flag(null);
  assert.deepEqual(castDurationOf(bare, { byCookbookId: () => twin }, 4, undefined, "reversed"), { value: 8, units: "rounds" }, "the twin's reverse");
  assert.deepEqual(castDurationOf(bare, { byCookbookId: () => twin }, 4, undefined, "normal"), { value: 3 * TURN_SECONDS, units: "seconds" }, "the twin's plain duration, as before");
});

t("a row's reading names a following turn, a row no save governs, what ends its record and the conditions it writes with no clock", () => {
  const text = describeSpellEffect({ type: "conditionGrant", appliesTo: "target", conditions: ["afraid", "prone"], lasts: "followingTurn", saveEffect: "none", endsOn: ["damage", "attack"], untimed: ["prone"] }).text;
  assert.match(text, /Until the bearer's following turn begins/);
  assert.match(text, /No saving throw governs it/);
  assert.match(text, /ends on: damage, attack/);
  assert.match(text, /no clock: /);
  assert.doesNotMatch(describeSpellEffect({ type: "conditionGrant", conditions: ["afraid"], lasts: "duration" }).text, /ends on|no clock|governs/);
});

await ta("a ward applied to a target is one record whose part names the spell's save and whose flag ends it on the attack", async () => {
  const c = card({
    save: { category: "spell", effect: "negates" },
    rows: { shield: { type: "ward", key: "shield", appliesTo: "target", lasts: "duration", endsOn: ["attack"] } },
    order: ["shield"],
    targets: { t1: { uuid: "Scene.s.Token.k1", name: "T", resist: null } },
    entries: { t1_shield: { state: "pending" } },
  });
  const { deps, log } = fakeDeps();
  await applyOnTarget(c, "t1", [{ rowKey: "shield" }], deps);
  assert.equal(log.made.length, 1);
  const flags = log.made[0].flags["acks-extras"];
  assert.deepEqual([flags.rollMods.parts[0].on, flags.rollMods.parts[0].save], ["ward", "spell"]);
  assert.deepEqual(flags.endsOn, ["attack"]);
  assert.deepEqual(endedBy([{ id: "w1", flags: log.made[0].flags }], "attack"), ["w1"]);
  const free = fakeDeps();
  await applyOnTarget({ ...c, rows: { shield: { ...c.rows.shield, saveEffect: "none" } } }, "t1", [{ rowKey: "shield" }], free.deps);
  assert.equal(free.log.made[0].flags["acks-extras"].rollMods.parts[0].save, undefined, "a ward no save governs names no save");
});

t("castReading reads the capacity and the caster level of a spell's caster with no target and no seat, for a tradition and for core's count", async () => {
  const { castReading } = await import("../scripts/magic/cast-spell.mjs");
  const spell = { type: "spell", system: { lvl: 1, cast: 0, class: "" }, flags: { "acks-extras": { spell: { lists: [{ source: "arcane", level: 1 }] } } } };
  const actor = { items: [spell], system: { details: { level: 4 }, spells: { enabled: false } }, getFlag: () => undefined };
  const arcane = { key: "arcane", label: "Arcane", kind: "vancian", slots: [] };
  const read = castReading(actor, spell, { classItem: { system: { casting: [arcane], ladders: [] } }, pools: [{ key: "arcane", slots: [{ n: 1, max: 2, used: 1 }] }] });
  assert.deepEqual([read.capacity.verdict, read.capacity.source, read.spellLevel, read.found.tradition.key], ["ok", "tradition", 1, "arcane"]);
  assert.deepEqual(read.level, { matched: true, classLevel: 4, ladder: null, monsterLevel: undefined });
  const bare = castReading({ items: [spell], system: { details: { level: 2 }, spells: { enabled: true, 1: { max: 1 } } }, getFlag: () => ({ spellcasting: { level: 6 } }) }, spell);
  assert.deepEqual([bare.found, bare.capacity.verdict, bare.capacity.source, bare.level.monsterLevel], [null, "ok", "core", 6]);
});

/* ------------------------------------------------------------------ */
/*  The cast gates: off list, and the tradition a cast goes through   */
/* ------------------------------------------------------------------ */

t("a spell is off list only where the class names a list, the spell names a list, and none is shared; no class, no list and no named list are never off", () => {
  const casting = [WISP, TIDE];
  const own = (...sources) => ({ extras: { lists: sources.map((source) => ({ source, level: 1 })) } });
  assert.equal(isOffList(casting, own("gust")), true, "a list the class does not cast from");
  assert.equal(isOffList(casting, { extras: {}, class: "Gust" }), true, "core's class string stands in where no list is printed");
  assert.equal(isOffList(casting, own("gust", "tide")), false, "one shared list is enough");
  assert.equal(isOffList([{ key: "w1", label: "Wisp Craft" }], own("WISP-craft")), false, "folded, by label");
  assert.equal(isOffList(casting, { extras: {} }), false, "a spell that names nothing");
  assert.equal(isOffList(undefined, own("gust")), false, "no class bound");
  assert.equal(isOffList([], own("gust")), false, "a class that casts from no list");
  assert.equal(isOffList([{ label: "No key" }], own("gust")), false, "a tradition with no key is no list");
  assert.deepEqual(spellStanding({ casting, pools: POOLS, spells: [stands("Alien", { lists: [["gust", 1]] }), stands("Bare")] }).other.flatMap((l) => l.spells).map((s) => [s.ref, s.offList]), [["Alien", true], ["Bare", false]], "the standing takes offList from the same predicate");
});

t("a spell on two lists is read under the tradition named, else the first; one it does not stand on is ignored; an off-list spell has no tradition, no slot and no noSlot from core's grid", () => {
  const casting = [WISP, TIDE];
  const spell = { extras: { lists: [{ source: "wisp", level: 1 }, { source: "tide", level: 3 }] }, lvl: 2, class: "" };
  const pools = [{ key: "wisp", kind: "vancian", slots: [{ n: 1, max: 2, used: 2 }] }, { key: "tide", kind: "vancian", slots: [{ n: 3, max: 1, used: 0 }] }];
  const first = spellCapacity({ casting, pools, spell });
  assert.deepEqual([first.found.tradition.key, first.spellLevel, first.capacity.verdict, first.capacity.slotKey, first.offList], ["wisp", 1, "none", "s1", false]);
  const named = spellCapacity({ casting, pools, spell, prefer: "tide" });
  assert.deepEqual([named.found.tradition.key, named.spellLevel, named.capacity.verdict, named.capacity.slotKey], ["tide", 3, "ok", "s3"], "the named list's pool and level");
  assert.equal(spendsFromPool(named.capacity), true);
  assert.equal(spellCapacity({ casting, pools, spell, prefer: "gust" }).found.tradition.key, "wisp", "a tradition the class lacks is ignored");
  assert.equal(spellCapacity({ casting: [WISP], pools, spell: { extras: { lists: [{ source: "wisp", level: 1 }] }, lvl: 1 }, prefer: "tide" }).found.tradition.key, "wisp", "so is one the spell does not stand on");
  const off = spellCapacity({ casting, pools, coreSpells: { 1: { max: 1 } }, castsAt: () => 5, spell: { extras: { lists: [{ source: "gust", level: 1 }] }, lvl: 1 }, prefer: "wisp" });
  assert.deepEqual([off.offList, off.found, off.capacity.verdict, off.capacity.source, spendsFromPool(off.capacity)], [true, null, "unknown", null, false], "core's full grid does not answer for it");
});

t("castReading takes the tradition the cast goes through and answers offList", async () => {
  const { castReading } = await import("../scripts/magic/cast-spell.mjs");
  const item = { type: "spell", system: { lvl: 2, cast: 0, class: "" }, flags: { "acks-extras": { spell: { lists: [{ source: "wisp", level: 1 }, { source: "tide", level: 3 }] } } } };
  const actor = { items: [item], system: { details: { level: 4 }, spells: { enabled: false } }, getFlag: () => undefined };
  const classItem = { system: { casting: [{ key: "wisp", kind: "vancian" }, { key: "tide", kind: "vancian" }], ladders: [] } };
  const pools = [{ key: "wisp", slots: [{ n: 1, max: 1, used: 1 }] }, { key: "tide", slots: [{ n: 3, max: 2, used: 0 }] }];
  const by = (tradition) => castReading(actor, item, { classItem, pools, tradition });
  assert.deepEqual([by(null).found.tradition.key, by(null).capacity.verdict, by(null).offList], ["wisp", "none", false]);
  assert.deepEqual([by("tide").found.tradition.key, by("tide").spellLevel, by("tide").capacity.verdict], ["tide", 3, "ok"]);
  const alien = { ...item, flags: { "acks-extras": { spell: { lists: [{ source: "gust", level: 1 }] } } } };
  const off = castReading({ ...actor, items: [alien], system: { details: { level: 4 }, spells: { enabled: true, 1: { max: 1 } } } }, alien, { classItem, pools, tradition: "wisp" });
  assert.deepEqual([off.offList, off.found, off.capacity.verdict, spendsFromPool(off.capacity)], [true, null, "unknown", false]);
});

t("offList blocks a Player and warns a Judge, pre-empts noSlot, and is absent while a declaration resolves", () => {
  const none = { verdict: "none" };
  const keyed = (isGM, over) => castVerdicts({ isGM, capacity: { verdict: "ok" }, ...over }).map((v) => `${v.key}:${v.severity}`);
  assert.deepEqual(keyed(false, { offList: true }), ["offList:block"]);
  assert.deepEqual(keyed(true, { offList: true }), ["offList:warn"]);
  assert.deepEqual(keyed(false, { offList: true, capacity: none }), ["offList:block"], "no slot is judged where the spell is off list");
  assert.deepEqual(keyed(false, { offList: false, capacity: none }), ["noSlot:block"]);
  assert.deepEqual(keyed(false, { offList: true, moment: "resolve", declaration: { valid: {}, lost: null, other: null, hand: false } }), [], "a resolution is never judged on a list");
  assert.deepEqual(keyed(false, {}), [], "no flag, no verdict");
  const foot = (severity) => dialogContext({ modes: ["normal"], groups: { normal: [] }, level: { value: 3, source: "class" }, levelNeeded: false, saves: false, targets: [], verdicts: { normal: [{ key: "offList", severity }] }, capacity: { verdict: "unknown" } }, {}).footer;
  assert.deepEqual([foot("block").blocked, foot("block").verdicts[0].text.includes("blocked.offList")], [true, true], "the window's foot words it for a Player and stops the button");
  assert.deepEqual([foot("warn").blocked, foot("warn").verdicts[0].text.includes("verdict.offList")], [false, true], "and for a Judge, who may cast anyway");
});

t("listGate judges a list's own slots and never the system's count", () => {
  const of = (capacity, over = {}) => {
    const found = listGate({ capacity, ...over });
    return found && `${found.key}:${found.severity}`;
  };
  assert.equal(of({ verdict: "none", source: "tradition" }), "noSlot:block");
  assert.equal(of({ verdict: "none", source: "tradition" }, { isGM: true }), "noSlot:warn");
  assert.equal(of({ verdict: "none", source: "core" }), null, "the system's one grid answers for no list");
  assert.equal(of({ verdict: "none", source: "core" }, { offList: true }), "offList:block", "off list is judged whatever the capacity read");
  assert.equal(of({ verdict: "ok", source: "tradition" }), null);
  assert.equal(of({ verdict: "unknown", source: "pool" }), null);
  assert.equal(of(undefined), null);
});

await ta("a Player's cast of an off-list spell is refused before the spend, and a Judge's is warned and spends no list's slot", async () => {
  const s = spell([heal], { duration: { shape: "fixed", value: 1, unit: "minutes" } });
  let spends = 0;
  const spend = () => spends++;
  let r = runDeps({ answer: { mode: "normal", picks: {} }, offList: true, capacity: { verdict: "unknown", tradition: null, slotKey: null, source: null } });
  const refused = await castSpellRun(s, spend, r.deps);
  assert.deepEqual([refused.ok, refused.reason, spends], [false, "offList", 0]);
  assert.deepEqual(r.calls.notices, [["warn", "blocked.offList"]]);
  r = runDeps({ answer: { mode: "normal", picks: {} }, isGM: true, offList: true, capacity: { verdict: "unknown", tradition: null, slotKey: null, source: null } });
  const warned = await castSpellRun(s, spend, r.deps);
  assert.deepEqual([warned.ok, spends, r.calls.pools], [true, 1, []]);
  assert.deepEqual(r.calls.notices, [["warn", "verdict.offList"]]);
});

await ta("a cast passes the options it was pressed with to the world's reading, and a declaration stores the tradition the cast named", async () => {
  const { deps, calls } = fightDeps({ answer: { mode: "normal", picks: {} }, world: IN_FIGHT({ tradition: { key: "tide" } }) });
  await castSpellRun(spell([heal]), () => {}, deps, { tradition: "tide" });
  assert.equal(calls.declared.answer.tradition, "tide");
  const bare = fightDeps({ answer: { mode: "normal", picks: {} }, world: IN_FIGHT({ tradition: { key: "wisp" } }) });
  await castSpellRun(spell([heal]), () => {}, bare.deps, {});
  assert.equal(bare.calls.declared.answer.tradition, null, "a cast that named none stores none");
  const seen = runDeps({ answer: { mode: "normal", picks: {} } });
  await castSpellRun(spell([heal]), () => {}, seen.deps, { tradition: "tide", skipDialog: true });
  assert.equal(seen.calls.reads[0].tradition, "tide");
});

await ta("a declaration stored with a tradition resolves through it; one stored without reads the world once", async () => {
  const reads = [];
  const make = (stored) => {
    const r = fightDeps({ answer: null, world: { ...ON_TURN(), declarations: [pendingRecord(stored)], capacity: { verdict: "none" } } });
    const inner = r.deps.read;
    r.deps.read = async (s, o) => (reads.push(o?.tradition ?? null), { ...(await inner(s, o)), tradition: { key: o?.tradition ?? "wisp" } });
    return r;
  };
  const through = make({ tradition: "tide" });
  const out = await castSpellRun(spell([heal]), () => {}, through.deps, {});
  assert.equal(out.ok, true);
  assert.deepEqual(reads, [null, "tide"], "the world is read again through the stored tradition");
  reads.length = 0;
  const old = make({});
  assert.equal((await castSpellRun(spell([heal]), () => {}, old.deps, {})).ok, true);
  assert.deepEqual(reads, [null], "a record with none resolves as before");
});

console.log(`\n${n} magic cast tests passed`);
