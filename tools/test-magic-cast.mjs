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

const { rowsOf, rowKeyOf, rowsForMode, pickGroups, rowNeedsThrow, saveFractionOf, spellSaves, hasReversedRows } = await import("../scripts/magic/cast-rows.mjs");
const { casterLevel, levelNeeded } = await import("../scripts/magic/cast-level.mjs");
const { castCapacity, traditionFor, spendsFromPool } = await import("../scripts/magic/cast-capacity.mjs");
const { castVerdicts, blocked } = await import("../scripts/magic/cast-plan.mjs");
const { spellEffectData, spellEffectOf } = await import("../scripts/magic/spell-effect.mjs");
const { castRecordEnd, endAction, sweepEndedCasts, announceEndedCast } = await import("../scripts/magic/cast-expiry.mjs");
const { damageBounds, checkApplyRequest, applyOnTarget: applyRaw, amountOf, undoEntry, undoEntries, missingGroupKeys, entryId, conditionRecords } = await import("../scripts/magic/cast-apply.mjs");
const { castCardView, castCardContent, CARD_ACTIONS } = await import("../scripts/magic/cast-card.mjs");
const { castSpellClaims, castSpellClaimant, castSpellRun, rollResist, CAST_SPELL_KEY } = await import("../scripts/magic/cast-spell.mjs");
const { dialogContext } = await import("../scripts/magic/apps/cast-dialog.mjs");

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

t("a record holds at most one status and never one with changes; a condition record is timed by its flag", () => {
  assert.throws(() => spellEffectData({ ...base, statuses: ["a", "b"] }), /at most one status/);
  assert.throws(() => spellEffectData({ ...base, statuses: ["a"], changes: [{ key: "k", mode: 2, value: "1" }] }), /holds no changes/);
  const data = spellEffectData({ ...base, statuses: ["a"], rowKey: "dread", duration: { value: 60, units: "seconds" }, startTime: 100 });
  assert.deepEqual(data.statuses, ["a"]);
  assert.equal(data.duration, undefined, "core's duration stays unset");
  const mark = spellEffectOf(data);
  assert.deepEqual([mark.rowKey, mark.startTime, mark.duration], ["dread", 100, { value: 60, units: "seconds" }]);
  const summon = spellEffectData({ ...base, role: "caster", duration: { value: 3, units: "minutes" } });
  assert.deepEqual(summon.duration, { value: 3, units: "minutes" }, "a summoning's record keeps core's duration");
  assert.equal(spellEffectOf(summon).startTime, undefined);
});

const SECS = { seconds: 1, minutes: 50 };
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

t("amountOf prices a row through its save and a throw row ignores the spell's save", () => {
  const c = card();
  assert.equal(amountOf(c.rows.burn, c, c.targets.t1.resist, 6).applied, 3);
  const thrown = { ...c.rows.burn, delivery: "melee", type: "damage" };
  assert.equal(amountOf(thrown, c, c.targets.t1.resist, 6).applied, 6);
  assert.equal(conditionRecords({ type: "conditionGrant", key: "dread", conditions: [] }, c, {}).length, 0);
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
  const applied = card({ cite: "p. 9", entries: { t1_burn: { state: "applied", rolled: 7, applied: 4, fraction: 0.5, saved: true } } });
  const row = castCardView(applied, { isGM: false, canPress: false }, loc).sections[0].rows[0];
  assert.ok(row.tooltipText.includes("tip.applied"), "the applied figure names its roll and fraction");
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
  assert.equal(out.hasModes, true);
  assert.equal(out.level.show, true);
  assert.equal(out.verdicts[0].items[0].severity, "block");
  assert.ok(out.capacity.line);
  assert.equal(dialogContext({ ...ctx, level: { value: 3, source: "class" } }, {}).level.show, false);
  assert.equal(dialogContext({ ...ctx, levelNeeded: false }, {}).level.show, false);
});

/* ------------------------------------------------------------------ */
/*  The claimant and the run                                          */
/* ------------------------------------------------------------------ */

t("the claimant takes a flagged spell with rows on an actor the seat owns, and declines everything else", () => {
  const s = spell([dmg()]);
  assert.equal(castSpellClaims(s, NO_TWIN), true);
  assert.equal(castSpellClaims(spell([]), NO_TWIN), false, "a rowless spell stays the system's");
  assert.equal(castSpellClaims(spell([dmg()], {}, { parent: { isOwner: false } }), NO_TWIN), false, "an actor the seat does not own");
  assert.equal(castSpellClaims(spell([dmg(), { type: "summon", ref: "def.invented.x" }]), NO_TWIN), false, "a summoning spell is the summoning's");
  assert.equal(castSpellClaims({ ...spell([dmg()]), type: "weapon" }, NO_TWIN), false, "a monster's attack item is no spell");
  assert.equal(castSpellClaims({ ...spell([dmg()]), flags: {} }, NO_TWIN), false, "an unflagged item");
  const claimant = castSpellClaimant({ lookups: NO_TWIN });
  assert.equal(claimant.key, CAST_SPELL_KEY);
  assert.equal(claimant.claims(s), true);
});

/** The dependencies of a run, recorded. */
function runDeps({ answer, capacity = { verdict: "ok" }, isGM = false, tokens = [], casterToken = null } = {}) {
  const calls = { notices: [], posts: [], spends: 0, pools: [], records: [], applied: [], asked: null };
  return {
    calls,
    deps: {
      lookups: NO_TWIN,
      read: async () => ({ actor: {}, tokens, casterToken, statuses: [], capacity, level: { matched: false } }),
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
  const r = runDeps({ answer: { mode: "normal", picks: {}, item: "w1" }, tokens: [bearerToken()], casterToken: { uuid: "Scene.s.Token.c1" } });
  const out = await castSpellRun(spell([EDGE, CIRCLE]), () => {}, r.deps);
  assert.equal(out.ok, true);
  assert.deepEqual(r.calls.asked.weapons, [{ id: "w1", name: "Testblade", magic: false }]);
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
  const r = runDeps({ answer: { mode: "normal", picks: {}, item: "not-its-weapon" }, tokens: [bearerToken()], isGM: true });
  await castSpellRun(spell([EDGE, CIRCLE]), () => {}, r.deps);
  const posted = r.calls.posts[0];
  assert.equal(posted.item, undefined);
  assert.deepEqual(posted.order, ["circle"]);
  assert.equal(posted.lines.length, 1, "the weapon row is listed on the card");
  assert.equal(typeof posted.lines[0], "string");
  const two = runDeps({ answer: { mode: "normal", picks: {}, item: "w1" }, tokens: [bearerToken(), { ...bearerToken(), uuid: "Scene.s.Token.k2" }], isGM: true });
  await castSpellRun(spell([EDGE]), () => {}, two.deps);
  assert.equal(two.calls.posts[0].item, undefined, "with two tokens no weapon is named");
  assert.ok(two.calls.notices.some(([level, key]) => level === "warn" && key === "verdict.oneBearer"));
});

await ta("a Player who targets no one is blocked from a weapon buff before the spend", async () => {
  let spends = 0;
  const r = runDeps({ answer: { mode: "normal", picks: {}, item: "" }, tokens: [] });
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

t("the dialog context offers the weapon only for a mode that names one, each marked where it is magic", () => {
  const ctx = { modes: ["normal"], weapons: [{ id: "w1", name: "Testblade", magic: false }, { id: "w2", name: "Testglaive", magic: true }], needsWeapon: { normal: true }, verdicts: { normal: [{ key: "oneBearer", severity: "block" }] } };
  const out = dialogContext(ctx, {});
  assert.deepEqual(out.weapon.modes, ["normal"]);
  assert.deepEqual(out.weapon.options.map((o) => o.id), ["w1", "w2"]);
  assert.equal(out.weapon.options[0].label, "Testblade");
  assert.ok(out.weapon.options[1].label.includes("weaponMagic"));
  assert.ok(out.verdicts[0].items[0].text.includes("blocked.oneBearer"));
  assert.deepEqual(dialogContext({ ...ctx, needsWeapon: { normal: false } }, {}).weapon.modes, []);
});

console.log(`\n${n} magic cast tests passed`);
