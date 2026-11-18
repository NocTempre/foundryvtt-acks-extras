/**
 * The invocation level of a cast, offline: the rows a level keeps and the figures
 * it flattens (`cast-rows.mjs`), its resolution and verdicts (`cast-level.mjs`,
 * `cast-plan.mjs`), where it rides (the card, the records, a declaration, the
 * register's reach) and what reads the card back at it (`castAt`). Foundry-free;
 * every spell, ladder, level and figure below is invented, so this file carries
 * no book content.
 *
 * Usage: node tools/test-cast-invocation.mjs
 */
import assert from "node:assert/strict";

globalThis.foundry = { utils: { escapeHTML: (s) => String(s) } };
globalThis.game = { i18n: { format: (key, data) => (data ? `${key}|${JSON.stringify(data)}` : key), localize: (key) => key } };
globalThis.Roll = class {
  constructor(formula) {
    this.formula = formula;
  }
  async evaluate() {
    this.total = 7;
    this.result = "7";
    return this;
  }
};
globalThis.Hooks = { once() {}, on() {}, callAll() {} };
globalThis.ui = { notifications: { warn() {}, info() {} } };
const docs = {};
globalThis.fromUuidSync = (uuid) => docs[uuid] ?? null;
globalThis.fromUuid = async (uuid) => docs[uuid] ?? null;

const { rowsOfMode, rowsForMode, pickGroups, castAt, flattenAt, readsInvocation, keyedRows } = await import("../scripts/magic/cast-rows.mjs");
const { invocationLevel, invocationOffered, invocationFindings, invocationFigure, levelNeeded } = await import("../scripts/magic/cast-level.mjs");
const { castVerdicts, blocked } = await import("../scripts/magic/cast-plan.mjs");
const { castSpellRun, castFiguresOf, castGateExtrasOf, castReading } = await import("../scripts/magic/cast-spell.mjs");
const { ANSWER_FIELDS, answerStored, answerFromPending } = await import("../scripts/magic/cast-declare.mjs");
const { spellEffectData, spellEffectOf } = await import("../scripts/magic/spell-effect.mjs");
const { conditionRecords } = await import("../scripts/magic/cast-apply.mjs");
const { castCardView } = await import("../scripts/magic/cast-card.mjs");
const { makeSelfReach } = await import("../scripts/magic/cast-reach.mjs");
const { makeRepertoireSource } = await import("../scripts/magic/repertoire.mjs");
const { registerSpellSource, registerSpellReach, castableSpells } = await import("../scripts/lib/spell-sources.mjs");

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

const NO_TWIN = { byCookbookId: () => null, fromUuidSync: () => null };
const flat = (v) => ({ kind: "flat", flat: v });
/** A LevelValue keyed on the invocation scale, one rung per `[atLevel, value]`. */
const rungs = (...pairs) => ({ kind: "conditional", on: "invocationLevel", breakpoints: pairs.map(([atLevel, value]) => ({ atLevel, value })) });
const heal = (over = {}) => ({ key: "mend", type: "heal", roll: "1d4", ...over });
const spell = (rows, extra = {}, over = {}) => ({
  type: "spell",
  name: "Testhymn",
  uuid: "Actor.c1.Item.s1",
  img: "i.png",
  flags: { "acks-extras": { spell: { effects: rows, ...extra } } },
  parent: { isOwner: true, type: "character", uuid: "Actor.c1" },
  ...over,
});
const keys = (list) => list.map((k) => k.key);

/* ------------------------------------------------------------------ */
/*  The rows a level keeps                                            */
/* ------------------------------------------------------------------ */

t("a row bounded by the invocation level stands inside its range, both sides counted in, a blank side open, and with no level every bounded row is out", () => {
  const rows = [
    heal({ key: "always" }),
    heal({ key: "low", invocationTo: 2 }),
    heal({ key: "mid", invocationFrom: 2, invocationTo: 4 }),
    heal({ key: "high", invocationFrom: 5 }),
    heal({ key: "blankSides", invocationFrom: null, invocationTo: "" }),
  ];
  const at = (level) => keys(rowsOfMode(rows, "normal", { invocationLevel: level }));
  assert.deepEqual(at(1), ["always", "low", "blankSides"]);
  assert.deepEqual(at(2), ["always", "low", "mid", "blankSides"], "a bound is counted in");
  assert.deepEqual(at(4), ["always", "mid", "blankSides"]);
  assert.deepEqual(at(5), ["always", "high", "blankSides"]);
  assert.deepEqual(at(null), ["always", "blankSides"], "no level set: every bounded row is out");
  assert.deepEqual(keys(rowsOfMode(rows, "normal")), ["always", "blankSides"], "and so with no `at` at all");
  assert.deepEqual(at("3"), ["always", "blankSides"], "a level that is no whole number is none");
});

t("a row keeps the key and position it has in the whole spell, whichever neighbours the level drops", () => {
  const rows = [heal({ key: "", invocationTo: 1 }), heal({ key: "" }), heal({ key: "named" })];
  assert.deepEqual(keys(keyedRows(rows)), ["#0", "#1", "named"]);
  const kept = rowsOfMode(rows, "normal", { invocationLevel: 3 });
  assert.deepEqual(kept.map((k) => [k.key, k.index]), [["#1", 1], ["named", 2]], "the second row is still #1 with the first out of range");
});

t("a choice group is read over the rows that stand at the level", () => {
  const rows = [
    heal({ key: "a", pick: "g", invocationTo: 2 }),
    heal({ key: "b", pick: "g", invocationFrom: 3 }),
    heal({ key: "c", pick: "g", invocationFrom: 3 }),
  ];
  assert.deepEqual(pickGroups(rows, "normal", { invocationLevel: 1 }), [], "one option left is no choice");
  assert.deepEqual(pickGroups(rows, "normal", { invocationLevel: 3 })[0].options.map((o) => o.token), ["b", "c"]);
  assert.deepEqual(keys(rowsForMode(rows, "normal", { g: "c" }, { invocationLevel: 3 })), ["c"]);
  assert.deepEqual(keys(rowsForMode(rows, "normal", { g: "c" }, { invocationLevel: 1 })), ["a"]);
});

/* ------------------------------------------------------------------ */
/*  The figures a level flattens                                      */
/* ------------------------------------------------------------------ */

t("a conditional on the invocation scale is flattened at the level: its rung, null below the first rung, null with no level", () => {
  const rows = [heal({ key: "m", value: rungs([2, 3], [4, 6]) })];
  const value = (level) => rowsForMode(rows, "normal", {}, { invocationLevel: level })[0].row.value;
  assert.equal(value(2), 3);
  assert.equal(value(3), 3);
  assert.equal(value(4), 6);
  assert.equal(value(9), 6);
  assert.equal(value(1), null, "below the first rung");
  assert.equal(value(null), null, "no level set");
  assert.equal(rowsForMode(rows, "normal")[0].row.value, null, "and with no `at`");
});

t("only the invocation scale flattens: every other figure comes back as it was, and a row with none is the very object", () => {
  const byLevel = { kind: "conditional", on: "level", breakpoints: [{ atLevel: 3, value: 2 }] };
  const plain = heal({ key: "p", value: flat(2), max: byLevel });
  const mixed = heal({ key: "x", value: rungs([1, 5]), max: byLevel, damage: ["fire"] });
  const [a, b] = rowsOfMode([plain, mixed], "normal", { invocationLevel: 2 });
  assert.equal(a.row, plain, "nothing to flatten, nothing copied");
  assert.equal(b.row.value, 5);
  assert.deepEqual(b.row.max, byLevel, "a conditional on class level stays for the caster level to read");
  assert.deepEqual(b.row.damage, ["fire"]);
});

t("no flattened copy is ever written back: the spell's rows are what they were after every read", () => {
  const rows = [heal({ key: "m", value: rungs([2, 3]), invocationFrom: 1 }), heal({ key: "n", max: { kind: "perLevel", base: 1, per: 1 } })];
  const before = JSON.parse(JSON.stringify(rows));
  const kept = rowsForMode(rows, "normal", {}, { invocationLevel: 2 });
  assert.notEqual(kept[0].row, rows[0], "the flattened row is a copy");
  assert.equal(kept[0].row.value, 3);
  assert.deepEqual(rows[0].value, rungs([2, 3]), "the spell's own row still holds its ladder");
  pickGroups(rows, "normal", { invocationLevel: 2 });
  flattenAt(rows, { invocationLevel: 4 });
  assert.deepEqual(rows, before);
  kept[0].row.value = 99;
  assert.deepEqual(rows, before, "writing to the copy reaches nothing");
  const frozen = Object.freeze([Object.freeze(heal({ value: Object.freeze(rungs([1, 1])) }))]);
  assert.equal(rowsForMode(frozen, "normal", {}, { invocationLevel: 1 })[0].row.value, 1, "a frozen spell reads too");
});

t("castAt reads the card's level as a whole number and nothing else", () => {
  assert.deepEqual(castAt({ invocationLevel: 3 }), { invocationLevel: 3 });
  assert.deepEqual(castAt({}), { invocationLevel: null });
  assert.deepEqual(castAt(null), { invocationLevel: null });
  assert.deepEqual(castAt({ invocationLevel: "3" }), { invocationLevel: null });
});

t("readsInvocation finds a bound or a conditional on the scale anywhere inside, in the raw rows and figures", () => {
  assert.equal(readsInvocation([heal()]), false);
  assert.equal(readsInvocation([heal({ invocationTo: 3 })]), true);
  assert.equal(readsInvocation([heal({ invocationFrom: null })]), false, "a blank side is no bound");
  assert.equal(readsInvocation([heal({ value: rungs([1, 2]) })]), true);
  assert.equal(readsInvocation({ target: { count: rungs([1, 2]) } }), true);
  assert.equal(readsInvocation({ target: { count: { kind: "conditional", on: "level", breakpoints: [] } } }), false);
  assert.equal(readsInvocation(null), false);
});

t("a spell's target and save figures are read at the level too, a range stays a distance, and the spell's flag is not written", () => {
  const extra = { range: { shape: "distance", value: 30, unit: "feet" }, target: { model: "creature", count: rungs([2, 4]), hdCap: flat(5) }, save: { category: "death", exemptBelowHd: rungs([3, 2]) } };
  const item = spell([heal()], extra);
  const before = JSON.parse(JSON.stringify(item.flags));
  const at = (invocationLevel) => ({ invocationLevel });
  assert.equal(castFiguresOf(item, NO_TWIN, at(2)).target.count, 4);
  assert.equal(castFiguresOf(item, NO_TWIN, at(1)).target.count, null);
  assert.equal(castFiguresOf(item, NO_TWIN).target.count, null);
  assert.deepEqual(castFiguresOf(item, NO_TWIN, at(2)).range, extra.range);
  assert.deepEqual(castFiguresOf(item, NO_TWIN, at(2)).target.hdCap, flat(5));
  const gates = castGateExtrasOf(item, NO_TWIN, at(3));
  assert.equal(gates.save.exemptBelowHd, 2);
  assert.equal(gates.target.count, 4);
  assert.equal(castGateExtrasOf(item, NO_TWIN).save.exemptBelowHd, null);
  assert.deepEqual(item.flags, before);
});

t("a figure keyed on the invocation level never asks for a caster level, and one keyed on the class level still does", () => {
  assert.equal(levelNeeded({ target: { count: rungs([1, 2]) }, save: { exemptBelowHd: rungs([1, 2]) } }, [heal({ value: rungs([1, 2]) })]), false);
  assert.equal(levelNeeded({}, [heal({ value: { kind: "conditional", on: "level", breakpoints: [{ atLevel: 1, value: 2 }] } })]), true);
  assert.equal(levelNeeded({ target: { count: { kind: "perLevel", base: 1, per: 1 } } }, []), true);
});

/* ------------------------------------------------------------------ */
/*  Resolution and verdicts                                           */
/* ------------------------------------------------------------------ */

t("the level is chosen under a cap, set by hand with none, and null where nothing is answered; it is never defaulted", () => {
  assert.deepEqual(invocationLevel({ cap: 4 }, { invocationLevel: 3 }), { value: 3, source: "chosen", cap: 4 });
  assert.deepEqual(invocationLevel({ cap: null, reads: true }, { invocationLevel: 3 }), { value: 3, source: "hand", cap: null });
  assert.deepEqual(invocationLevel({ cap: 4 }, {}), { value: null, source: null, cap: 4 }, "no default to the cap");
  assert.deepEqual(invocationLevel({ cap: 4 }), { value: null, source: null, cap: 4 });
  assert.deepEqual(invocationLevel({ cap: 4 }, { invocationLevel: 6 }), { value: 6, source: "chosen", cap: 4 }, "over the cap is returned as chosen and judged apart");
  assert.equal(invocationLevel({ cap: 4 }, { invocationLevel: "3" }).value, 3, "the digits of a level are the level");
  for (const bad of [0, -1, 2.5, "", "x", NaN, true, [2]]) assert.equal(invocationLevel({ cap: 4 }, { invocationLevel: bad }).value, null, `${JSON.stringify(bad)} is no level`);
  assert.equal(invocationLevel({ cap: 0 }, { invocationLevel: 2 }).cap, null, "a cap that is no level is no cap");
  assert.equal(invocationLevel({ cap: null, reads: false }, { invocationLevel: 3 }).value, null, "a level nobody asks for is not read");
  assert.equal(invocationFigure("007"), 7);
});

t("the level is offered where the tradition has a cap or a kept row or figure reads the scale", () => {
  assert.equal(invocationOffered({ cap: 3 }), true);
  assert.equal(invocationOffered({ cap: null, reads: true }), true);
  assert.equal(invocationOffered({ cap: null, reads: false }), false);
  assert.equal(invocationOffered({}), false);
});

t("an invocation level above the cap is overCap, one a row reads and nothing sets is invocationUnset, and a level nothing reads is never missing", () => {
  assert.deepEqual(invocationFindings({ value: 6, cap: 4, reads: true }), [{ key: "overCap", max: 4, over: 2 }]);
  assert.deepEqual(invocationFindings({ value: 4, cap: 4, reads: true }), []);
  assert.deepEqual(invocationFindings({ value: 9, cap: null, reads: true }), [], "no cap, no ceiling");
  assert.deepEqual(invocationFindings({ value: null, cap: 4, reads: true }), [{ key: "invocationUnset" }]);
  assert.deepEqual(invocationFindings({ value: null, cap: 4, reads: false }), [], "a capped tradition whose rows read nothing misses nothing");
  assert.deepEqual(invocationFindings(null), []);
});

t("a Player is blocked by either verdict and a Judge warned, through the plan's one severity", () => {
  const base = { capacity: { verdict: "ok" } };
  const over = { value: 6, cap: 4, reads: true };
  const unset = { value: null, cap: 4, reads: true };
  const player = castVerdicts({ ...base, invocation: over });
  assert.deepEqual(player, [{ key: "overCap", max: 4, over: 2, severity: "block" }]);
  assert.equal(blocked(player), true);
  assert.deepEqual(castVerdicts({ ...base, invocation: over, isGM: true }).map((v) => [v.key, v.severity]), [["overCap", "warn"]]);
  assert.deepEqual(castVerdicts({ ...base, invocation: unset }).map((v) => [v.key, v.severity]), [["invocationUnset", "block"]]);
  assert.deepEqual(castVerdicts({ ...base, invocation: unset, isGM: true }).map((v) => [v.key, v.severity]), [["invocationUnset", "warn"]]);
  assert.deepEqual(castVerdicts(base), [], "none given, none drawn");
});

/* ------------------------------------------------------------------ */
/*  The cast                                                          */
/* ------------------------------------------------------------------ */

function runDeps({ answer, cap = null, isGM = false, declared = null, level = { matched: false } } = {}) {
  const calls = { notices: [], posts: [], spends: 0, records: [], applied: [], asked: null, declares: [] };
  const deps = {
    lookups: NO_TWIN,
    read: async () => ({ actor: {}, tokens: [], casterToken: null, gaps: {}, statuses: [], capacity: { verdict: "ok" }, level, cap, ...(declared ?? {}) }),
    ask: async (ctx) => {
      calls.asked = ctx;
      return answer;
    },
    notify: (lvl, key) => calls.notices.push([lvl, key]),
    adjustPool: async () => {},
    castId: () => "castX",
    roll: () => 1,
    post: async (c) => (calls.posts.push(c), { id: "m1", flags: { "acks-extras": { castCard: c } } }),
    apply: async (...args) => calls.applied.push(args),
    record: async (c, data) => calls.records.push(data),
    throwRow: async () => null,
    now: () => 10,
    isGM: () => isGM,
  };
  return { calls, deps };
}

const GATED = [
  heal({ key: "low", invocationTo: 2, roll: "1d4" }),
  heal({ key: "high", invocationFrom: 3, roll: "1d8" }),
  heal({ key: "sure", roll: "1d6" }),
];

await ta("a cast with no level set is refused a Player before the spend where a row reads the scale, and the dialog is told whether it asks", async () => {
  let spends = 0;
  const r = runDeps({ answer: { mode: "normal", picks: {} } });
  const out = await castSpellRun(spell(GATED), () => spends++, r.deps);
  assert.deepEqual([out.ok, out.reason], [false, "invocationUnset"]);
  assert.equal(spends, 0);
  assert.deepEqual(r.calls.posts, []);
  assert.deepEqual([r.calls.asked.invocation.normal.offered, r.calls.asked.invocation.normal.reads, r.calls.asked.invocation.normal.cap, r.calls.asked.invocation.normal.value], [true, true, null, null]);
  assert.deepEqual(r.calls.asked.verdicts.normal.map((v) => v.key), ["invocationUnset"]);
  const judge = runDeps({ isGM: true, answer: { mode: "normal", picks: {} } });
  const warned = await castSpellRun(spell(GATED), () => spends++, judge.deps);
  assert.equal(warned.ok, true);
  assert.ok(judge.calls.notices.some(([lvl, key]) => lvl === "warn" && key === "verdict.invocationUnset"));
  assert.deepEqual(judge.calls.posts[0].order, ["sure"], "with no level only the rows no bound governs stand");
  assert.equal(judge.calls.posts[0].invocationLevel, undefined, "and the card names no level");
});

await ta("a typed level keeps the rows inside its range, rides the card with where it came from, and the record carries it", async () => {
  const timed = [...GATED, heal({ key: "tail", type: "conditionGrant", conditions: ["shaken"], lasts: "duration" })];
  let r = runDeps({ answer: { mode: "normal", picks: {}, invocationLevel: 3 } });
  const out = await castSpellRun(spell(timed, { duration: { shape: "fixed", value: 1, unit: "minutes" } }), () => {}, r.deps);
  assert.equal(out.ok, true);
  const card = r.calls.posts[0];
  assert.deepEqual(card.order, ["high", "sure", "tail"], "the rows inside the range, in the spell's order");
  assert.equal(card.rows.low, undefined, "below its range");
  assert.equal(card.invocationLevel, 3);
  assert.deepEqual(card.invocation, { source: "hand", cap: null });
  assert.equal(spellEffectOf(r.calls.records[0]).invocationLevel, 3, "the caster's record names the level");
  const note = castCardView(card, { isGM: false, canPress: false }, (k, d) => game.i18n.format(`ACKS-MAGIC.cast.${k}`, d));
  assert.ok(note.note.includes('note.invocation|{"value":3}'));
  assert.ok(note.noteTooltip.includes("tip.invocation.hand"));
  r = runDeps({ cap: 5, answer: { mode: "normal", picks: {}, invocationLevel: 2 } });
  await castSpellRun(spell(GATED), () => {}, r.deps);
  assert.deepEqual(r.calls.posts[0].order, ["low", "sure"]);
  assert.deepEqual(r.calls.posts[0].invocation, { source: "chosen", cap: 5 });
  assert.ok(castCardView(r.calls.posts[0], { isGM: false, canPress: false }, (k, d) => game.i18n.format(`ACKS-MAGIC.cast.${k}`, d)).noteTooltip.includes('tip.invocation.chosen|{"value":2,"cap":5}'));
});

await ta("a level above the cap blocks a Player before the spend and warns a Judge, who casts it; a capped tradition whose rows read nothing casts with no level", async () => {
  let spends = 0;
  let r = runDeps({ cap: 3, answer: { mode: "normal", picks: {}, invocationLevel: 5 } });
  const refused = await castSpellRun(spell(GATED), () => spends++, r.deps);
  assert.deepEqual([refused.ok, refused.reason], [false, "overCap"]);
  assert.equal(spends, 0);
  r = runDeps({ cap: 3, isGM: true, answer: { mode: "normal", picks: {}, invocationLevel: 5 } });
  assert.equal((await castSpellRun(spell(GATED), () => spends++, r.deps)).ok, true);
  assert.equal(spends, 1);
  assert.ok(r.calls.notices.some(([lvl, key]) => lvl === "warn" && key === "verdict.overCap"));
  assert.equal(r.calls.posts[0].invocationLevel, 5, "the Judge's level stands as chosen");
  r = runDeps({ cap: 3, answer: { mode: "normal", picks: {} } });
  const plain = await castSpellRun(spell([heal()]), () => spends++, r.deps);
  assert.equal(plain.ok, true, "nothing reads the level, so none is missing");
  assert.equal(r.calls.asked.invocation.normal.offered, true, "though the tradition's cap offers it");
  assert.equal(r.calls.posts[0].invocationLevel, undefined);
});

await ta("a figure keyed on the level is read at it by the cast: the target count and the cast's own caster level are not asked for", async () => {
  const counted = spell([heal()], { target: { model: "creature", count: rungs([2, 4]) } });
  const r = runDeps({ answer: { mode: "normal", picks: {}, invocationLevel: 2 } });
  await castSpellRun(counted, () => {}, r.deps);
  assert.equal(r.calls.asked.levelNeeded, false, "the scale is not the caster level");
  assert.equal(r.calls.asked.invocation.normal.reads, true, "judged on the raw figure");
  assert.equal(r.calls.posts[0].invocationLevel, 2);
});

await ta("a declaration stores the level, and its resolution restores it from the pending record with no dialog", async () => {
  const stored = [];
  const turn = { id: "k1", started: true, round: 1, turn: 1, turns: [{ id: "cb2" }, { id: "cb1" }], flags: {}, combatant: { id: "cb1" } };
  const declare = runDeps({ answer: { mode: "normal", picks: {}, invocationLevel: 4, visibility: "public" }, declared: { combat: { ...turn, turn: 0, combatant: { id: "cb2" } }, combatant: { id: "cb1", initiative: 9 }, declarations: [] } });
  declare.deps.declare = { declare: async (from) => (stored.push(from.answer), { castId: "d1" }) };
  declare.deps.endHeld = async () => {};
  const made = await castSpellRun(spell(GATED), () => {}, declare.deps);
  assert.equal(made.declared, true, "cast before its turn is declared");
  assert.equal(answerStored(stored[0]).invocationLevel, 4, "what the declaration stores");
  const pending = { spellUuid: "Actor.c1.Item.s1", ...answerStored(stored[0]), combatId: "k1", round: 1, at: 3, targets: [] };
  assert.equal(answerFromPending(pending).invocationLevel, 4);
  const resolve = runDeps({ answer: null, declared: { combat: turn, combatant: { id: "cb1", initiative: 9 }, declarations: [{ castId: "d1", role: "caster", pending }] } });
  resolve.deps.declare = { finish: async () => {} };
  resolve.deps.endHeld = async () => {};
  resolve.deps.declaredTargets = async () => ({ tokens: [], gaps: {}, gone: [] });
  const out = await castSpellRun(spell(GATED), () => {}, resolve.deps);
  assert.equal(out.ok, true);
  assert.equal(resolve.calls.asked, null, "a stored answer that fits asks nothing");
  assert.equal(resolve.calls.posts[0].invocationLevel, 4, "restored from the pending record");
  assert.deepEqual(resolve.calls.posts[0].order, ["high", "sure"]);
  // A declared target that is gone reopens the dialog; an answer that leaves the level blank is read as blank, never as the declaration's.
  const reopened = runDeps({ answer: { mode: "normal", picks: {} }, declared: { combat: turn, combatant: { id: "cb1", initiative: 9 }, declarations: [{ castId: "d1", role: "caster", pending }] } });
  reopened.deps.declare = { finish: async () => {} };
  reopened.deps.endHeld = async () => {};
  reopened.deps.declaredTargets = async () => ({ tokens: [], gaps: {}, gone: ["Scene.s.Token.gone"] });
  let spent = 0;
  const refused = await castSpellRun(spell(GATED), () => spent++, reopened.deps);
  assert.deepEqual([refused.ok, refused.reason, spent], [false, "invocationUnset", 0], "the dialog's answer has no level, so a Player is refused, not cast on rows the unset level dropped");
  assert.equal(reopened.calls.asked.initial.invocationLevel, 4, "while the dialog reopens prefilled with the declared level");
});

t("ANSWER_FIELDS names the level, and a record, a recipient's condition record and a pending one all carry it as a whole number or not at all", () => {
  assert.ok("invocationLevel" in ANSWER_FIELDS);
  const base = { spell: { uuid: "S", name: "N", img: "i" }, caster: { uuid: "A" }, castId: "c", role: "recipient" };
  assert.equal(spellEffectOf(spellEffectData({ ...base, invocationLevel: 3 })).invocationLevel, 3);
  for (const bad of [0, 2.5, "3", null, undefined]) assert.equal(spellEffectOf(spellEffectData({ ...base, invocationLevel: bad })).invocationLevel, undefined, `${JSON.stringify(bad)} writes none`);
  const card = { castId: "c", casterUuid: "A", spellUuid: "S", spellName: "N", invocationLevel: 3, duration: { none: "x" } };
  const [record] = conditionRecords({ type: "conditionGrant", conditions: ["shaken"], lasts: "instant" }, card, { key: "tail", spell: { img: "i" } });
  assert.equal(spellEffectOf(record).invocationLevel, 3);
});

/* ------------------------------------------------------------------ */
/*  The cap, and the register                                         */
/* ------------------------------------------------------------------ */

t("castReading reads the tradition's cap through the injected `capAt`, and none where there is no reader or no tradition", () => {
  const item = { type: "spell", system: { lvl: 1, class: "" }, flags: { "acks-extras": { spell: { lists: [{ source: "arcane", level: 1 }] } } } };
  const actor = { items: [item], system: { details: { level: 7 } }, getFlag: () => undefined };
  const classItem = { system: { casting: [{ key: "arcane", kind: "vancian", label: "Arcane", slots: [], spellList: [] }], ladders: [] } };
  const calls = [];
  const capAt = (cls, tradition, level) => (calls.push([cls, tradition?.key, level]), 4);
  const withCap = castReading(actor, item, { classItem, capAt });
  assert.ok(withCap.found, "the tradition cast it");
  assert.equal(withCap.cap, 4);
  assert.deepEqual(calls, [[classItem, "arcane", 7]], "asked of the class, the tradition row and the class level");
  assert.equal(castReading(actor, item, { classItem }).cap, null, "no reader, no cap");
  assert.equal(castReading(actor, item, { classItem, capAt: () => 2.5 }).cap, null, "a cap that is no level is none");
  const unmatched = { ...item, flags: { "acks-extras": { spell: {} } } };
  assert.equal(castReading(actor, unmatched, { classItem, capAt }).cap, null, "no tradition cast it, so no cap");
});

t("the register's reach reads gated rows at the tradition's cap and drops them with none", () => {
  const rows = [
    { key: "mine", type: "grants", appliesTo: "self", ref: "def.prof.testClimbing", lasts: "duration", invocationFrom: 3 },
    { key: "open", type: "grants", appliesTo: "self", ref: "def.prof.testSwimming", lasts: "duration" },
  ];
  const item = spell(rows, { target: { model: "self" } });
  const reach = makeSelfReach({ lookups: () => NO_TWIN });
  const at = (cap) => reach({}, { spell: item, casterLevel: { value: 4 }, cap });
  assert.equal(at(5).selfParts.length, 2, "the cap stands inside the range");
  assert.equal(at(2).selfParts.length, 1, "below the lower bound the row is out");
  assert.equal(at(null).selfParts.length, 1, "no cap, no gated row");
  assert.equal(at(undefined).selfParts.length, 1);
});

t("the register carries the tradition's cap from the repertoire source to the reach: through castableSpells a gated grant is written at the cap and not without one", () => {
  const grant = { key: "g1", type: "grants", appliesTo: "self", ref: "def.prof.testClimbing", lasts: "duration", invocationFrom: 3 };
  const open = { key: "g2", type: "grants", appliesTo: "self", ref: "def.prof.testSwimming", lasts: "duration" };
  const item = spell([grant, open], { lists: [{ source: "arcane", level: 1 }], target: { model: "self" }, cite: "Test p. 1" });
  Object.assign(item, { id: "i1", system: { lvl: 1, cast: 0, class: "" }, flags: { "acks-extras": { ...item.flags["acks-extras"], cookbook: { id: "def.spell.testHymn" } } } });
  const classItem = { system: { casting: [{ key: "arcane", label: "Arcane", kind: "vancian", slots: [], spellList: [] }], ladders: [] } };
  const actor = { id: "a1", type: "character", name: "Tester", items: [item], effects: [], appliedEffects: [], statuses: new Set(), system: { details: { level: 3, alignment: "" }, spells: { enabled: false } }, getFlag: () => undefined };
  item.parent = actor;
  const pools = [{ key: "arcane", kind: "vancian", slots: [{ n: 1, max: 2, used: 0 }] }];
  const partsAt = (capAt) => {
    const off = [
      registerSpellSource("repertoire", makeRepertoireSource({ castReading, classFor: () => classItem, poolsOf: () => pools, lookups: () => NO_TWIN, capAt })),
      registerSpellReach(makeSelfReach({ lookups: () => NO_TWIN })),
    ];
    try {
      const [entry] = castableSpells(actor, { viewer: null });
      return entry.selfParts.map((part) => part.key);
    } finally {
      for (const f of off) f();
    }
  };
  assert.deepEqual(partsAt(() => 5), ["g1", "g2"], "the cap reaches the reach: the row bounded from level three stands");
  assert.deepEqual(partsAt(() => 2), ["g2"], "a cap below the bound leaves it out");
  assert.deepEqual(partsAt(null), ["g2"], "with no reader no gated row is written");
  const seen = [];
  const reading = makeRepertoireSource({ castReading: (a, s, opts) => (seen.push(opts.capAt), { found: {}, capacity: { verdict: "ok", source: "tradition", max: 1 }, cap: 3, level: { matched: true, classLevel: 2 } }), classFor: () => null, poolsOf: () => [], capAt: "reader" });
  const [row] = reading(actor, {});
  assert.deepEqual([seen, row.cap], [["reader"], 3], "the source hands `capAt` to the reading and the entry names the cap it read");
});

console.log(`\n${n} cast invocation tests passed`);
