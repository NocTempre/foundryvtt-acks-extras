/**
 * Offline tests for a door seal's model (`cast-seal.mjs`): the request checks,
 * the write, the end plan and the caster record's mark. Foundry-free; the
 * ids and figures are invented, so this file carries no book content.
 *
 * Usage: node tools/test-cast-seal.mjs
 */
import assert from "node:assert/strict";

const {
  SEAL_REFUSED,
  checkSealRequest,
  sealWrite,
  sealEndPlan,
  sealEndAll,
  orphanCasts,
  sealMark,
  sealOf,
  readStamp,
  nearestOnWall,
  hasRange,
  doorConstants,
} = await import("../scripts/magic/cast-seal.mjs");

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};

const K = doorConstants();
const DOOR = { door: K.DOOR };
const base = { fromJudge: false, owns: true, hasSealRow: true, wall: DOOR, sceneId: "s1", casterSceneIds: ["s1"], rangeFeet: 30, gapFeet: 10 };
const check = (over) => checkSealRequest({ ...base, ...over });

/* ------------------------------------------------------------------ */
/*  checkSealRequest                                                  */
/* ------------------------------------------------------------------ */

t("the plain request passes: an owner, a seal row, a door on the caster's scene within range", () => {
  assert.deepEqual(check({}), { ok: true });
});

t("a requester who does not own the caster is refused; a Judge needs no ownership", () => {
  assert.deepEqual(check({ owns: false }), { ok: false, reason: SEAL_REFUSED.notOwner });
  assert.deepEqual(check({ owns: false, fromJudge: true }), { ok: true });
});

t("a spell with no seal row is refused, for a Judge too", () => {
  assert.equal(check({ hasSealRow: false }).reason, SEAL_REFUSED.noSealRow);
  assert.equal(check({ hasSealRow: false, fromJudge: true }).reason, SEAL_REFUSED.noSealRow);
});

t("a wall that is not there is refused", () => {
  assert.equal(check({ wall: null }).reason, SEAL_REFUSED.noWall);
});

t("a wall that is no door is refused, for a Judge too", () => {
  assert.equal(check({ wall: { door: K.NONE } }).reason, SEAL_REFUSED.notADoor);
  assert.equal(check({ wall: { door: K.NONE }, fromJudge: true }).reason, SEAL_REFUSED.notADoor);
});

t("a secret door is refused to a Player and sealed for a Judge", () => {
  assert.equal(check({ wall: { door: K.SECRET } }).reason, SEAL_REFUSED.secretDoor);
  assert.deepEqual(check({ wall: { door: K.SECRET }, fromJudge: true }), { ok: true });
});

t("a wall on another scene than the caster's token is refused; a caster on several scenes seals on each", () => {
  assert.equal(check({ casterSceneIds: ["s2"] }).reason, SEAL_REFUSED.otherScene);
  assert.equal(check({ casterSceneIds: [] }).reason, SEAL_REFUSED.otherScene);
  assert.equal(check({ casterSceneIds: undefined }).reason, SEAL_REFUSED.otherScene);
  assert.equal(check({ sceneId: "" }).reason, SEAL_REFUSED.otherScene);
  assert.deepEqual(check({ casterSceneIds: ["s2", "s1"] }), { ok: true });
});

t("a door past the range is refused; at the range it passes; a gap that cannot be measured is refused", () => {
  assert.equal(check({ gapFeet: 30.5 }).reason, SEAL_REFUSED.outOfRange);
  assert.deepEqual(check({ gapFeet: 30 }), { ok: true });
  assert.equal(check({ gapFeet: null }).reason, SEAL_REFUSED.outOfRange);
  assert.equal(check({ gapFeet: Number.NaN }).reason, SEAL_REFUSED.outOfRange);
});

t("a blank range is not measured: any gap passes, measured or not", () => {
  for (const rangeFeet of [null, undefined, "", "far", -5]) {
    assert.deepEqual(check({ rangeFeet, gapFeet: 9999 }), { ok: true }, JSON.stringify(rangeFeet));
    assert.deepEqual(check({ rangeFeet, gapFeet: null }), { ok: true });
  }
  assert.equal(hasRange(0), true, "a range of nothing is a range");
  assert.equal(check({ rangeFeet: 0, gapFeet: 1 }).reason, SEAL_REFUSED.outOfRange);
});

t("the first failing check names the refusal", () => {
  const all = { hasSealRow: false, owns: false, wall: null, casterSceneIds: [], gapFeet: 999 };
  assert.equal(check(all).reason, SEAL_REFUSED.noSealRow);
  assert.equal(check({ ...all, hasSealRow: true }).reason, SEAL_REFUSED.notOwner);
  assert.equal(check({ ...all, hasSealRow: true, owns: true }).reason, SEAL_REFUSED.noWall);
});

t("a door's nearest point is read along the wall, and none from a wall with no coordinates", () => {
  assert.deepEqual(nearestOnWall([0, 0, 100, 0], { x: 40, y: 30 }), { x: 40, y: 0 });
  assert.deepEqual(nearestOnWall([0, 0, 100, 0], { x: 150, y: 0 }), { x: 100, y: 0 });
  assert.deepEqual(nearestOnWall([5, 5, 5, 5], { x: 9, y: 9 }), { x: 5, y: 5 });
  assert.equal(nearestOnWall(null, { x: 0, y: 0 }), null);
  assert.equal(nearestOnWall([0, 0, 1], { x: 0, y: 0 }), null);
  assert.equal(nearestOnWall([0, 0, 1, 1], { x: NaN, y: 0 }), null);
});

/* ------------------------------------------------------------------ */
/*  The write                                                         */
/* ------------------------------------------------------------------ */

t("a seal on a plain door locks it and stamps the state it found", () => {
  assert.deepEqual(sealWrite(null, "castA", K.CLOSED), { ds: K.LOCKED, stamp: { was: K.CLOSED, casts: ["castA"] } });
  assert.deepEqual(sealWrite(undefined, "castA", K.OPEN).stamp, { was: K.OPEN, casts: ["castA"] });
});

t("a seal on a door already locked records that it was", () => {
  assert.deepEqual(sealWrite(null, "castA", K.LOCKED).stamp, { was: K.LOCKED, casts: ["castA"] });
});

t("a second seal on a sealed door appends its cast and keeps the first was", () => {
  const first = sealWrite(null, "castA", K.OPEN).stamp;
  const second = sealWrite(first, "castB", K.LOCKED);
  assert.deepEqual(second, { ds: K.LOCKED, stamp: { was: K.OPEN, casts: ["castA", "castB"] } });
  assert.deepEqual(sealWrite(second.stamp, "castB", K.LOCKED).stamp.casts, ["castA", "castB"], "the same cast twice is held once");
});

t("a stamp is read clean: no casts or no state is no stamp, numeric-keyed casts read as a list", () => {
  assert.equal(readStamp(null), null);
  assert.equal(readStamp({ was: 1, casts: [] }), null);
  assert.equal(readStamp({ casts: ["a"] }), null);
  assert.deepEqual(readStamp({ was: "2", casts: { 0: "a", 1: "a", 2: "b" } }), { was: 2, casts: ["a", "b"] });
});

/* ------------------------------------------------------------------ */
/*  The end plan                                                      */
/* ------------------------------------------------------------------ */

t("a plain seal ends at CLOSED and the stamp is cleared", () => {
  const stamp = { was: K.CLOSED, casts: ["castA"] };
  assert.deepEqual(sealEndPlan(stamp, "castA", K.LOCKED), { noop: false, stamp: null, ds: K.CLOSED });
  assert.deepEqual(sealEndPlan({ was: K.OPEN, casts: ["castA"] }, "castA", K.LOCKED), { noop: false, stamp: null, ds: K.CLOSED }, "a door found open still goes to closed");
});

t("a door a hand unlocked or opened since is left alone, the stamp cleared", () => {
  const stamp = { was: K.CLOSED, casts: ["castA"] };
  assert.deepEqual(sealEndPlan(stamp, "castA", K.CLOSED), { noop: false, stamp: null, ds: null });
  assert.deepEqual(sealEndPlan(stamp, "castA", K.OPEN), { noop: false, stamp: null, ds: null });
});

t("a door locked before the seal stays LOCKED when the seal ends", () => {
  assert.deepEqual(sealEndPlan({ was: K.LOCKED, casts: ["castA"] }, "castA", K.LOCKED), { noop: false, stamp: null, ds: null });
});

t("two overlapping seals: the first to end leaves the door, only the last clears and closes", () => {
  const stamp = { was: K.CLOSED, casts: ["castA", "castB"] };
  const first = sealEndPlan(stamp, "castA", K.LOCKED);
  assert.deepEqual(first, { noop: false, stamp: { was: K.CLOSED, casts: ["castB"] }, ds: null });
  const last = sealEndPlan(first.stamp, "castB", K.LOCKED);
  assert.deepEqual(last, { noop: false, stamp: null, ds: K.CLOSED });
  const backwards = sealEndPlan(sealEndPlan(stamp, "castB", K.LOCKED).stamp, "castA", K.LOCKED);
  assert.deepEqual(backwards, { noop: false, stamp: null, ds: K.CLOSED }, "either order");
});

t("a deleted wall, an unstamped wall and a cast not on the stamp are no-ops and do not throw", () => {
  assert.deepEqual(sealEndPlan(null, "castA", K.LOCKED), { noop: true, stamp: null, ds: null });
  assert.deepEqual(sealEndPlan(undefined, "castA", undefined), { noop: true, stamp: null, ds: null });
  const stamp = { was: K.CLOSED, casts: ["castA"] };
  assert.deepEqual(sealEndPlan(stamp, "castZ", K.LOCKED), { noop: true, stamp, ds: null });
  assert.equal(sealEndAll(null, ["castA"], undefined).noop, true);
});

t("the sweep's fold ends every orphan against what the one before left", () => {
  const stamp = { was: K.CLOSED, casts: ["castA", "castB", "castC"] };
  assert.deepEqual(sealEndAll(stamp, ["castA", "castB"], K.LOCKED), { noop: false, stamp: { was: K.CLOSED, casts: ["castC"] }, ds: null });
  assert.deepEqual(sealEndAll(stamp, ["castA", "castB", "castC"], K.LOCKED), { noop: false, stamp: null, ds: K.CLOSED });
  assert.deepEqual(sealEndAll({ was: K.CLOSED, casts: ["castA"] }, ["castA"], K.OPEN), { noop: false, stamp: null, ds: null });
  assert.equal(sealEndAll(stamp, ["castZ"], K.LOCKED).noop, true);
});

t("orphans are the stamped casts no live record holds", () => {
  const stamp = { was: K.CLOSED, casts: ["castA", "castB"] };
  assert.deepEqual(orphanCasts(stamp, ["castB"]), ["castA"]);
  assert.deepEqual(orphanCasts(stamp, new Set(["castA", "castB"])), []);
  assert.deepEqual(orphanCasts(stamp, []), ["castA", "castB"]);
  assert.deepEqual(orphanCasts(null, []), []);
});

/* ------------------------------------------------------------------ */
/*  The caster record's mark                                          */
/* ------------------------------------------------------------------ */

t("the mark names the scene and the wall, or none where either is missing", () => {
  assert.deepEqual(sealMark({ sceneId: "s1", wallId: "w1" }), { sceneId: "s1", wallId: "w1" });
  assert.equal(sealMark({ sceneId: "s1" }), null);
  assert.equal(sealMark({ wallId: "w1" }), null);
  assert.equal(sealMark(), null);
});

t("a caster record's seal is read back; a recipient's record and a record with none name no seal", () => {
  const rec = (mark) => ({ flags: { "acks-extras": { spellEffect: { castId: "castA", ...mark } } } });
  assert.deepEqual(sealOf(rec({ role: "caster", seal: { sceneId: "s1", wallId: "w1" } })), { sceneId: "s1", wallId: "w1" });
  assert.equal(sealOf(rec({ role: "recipient", seal: { sceneId: "s1", wallId: "w1" } })), null);
  assert.equal(sealOf(rec({ role: "caster" })), null);
  assert.equal(sealOf({}), null);
  assert.equal(sealOf(null), null);
});

/* ------------------------------------------------------------------ */
/*  The record carries the mark                                       */
/* ------------------------------------------------------------------ */

const { spellEffectData, spellEffectOf } = await import("../scripts/magic/spell-effect.mjs");
const { heldRecordData } = await import("../scripts/magic/cast-held.mjs");
const { stepOf } = await import("../scripts/magic/cast-kinds.mjs");
const { describeSpellEffect } = await import("../scripts/magic/describe.mjs");

const SPELL = { uuid: "Actor.c1.Item.sp1", name: "Invented Shutting", img: "icons/invented.webp" };
const CASTER = { uuid: "Actor.c1" };
const WALL = { sceneId: "s1", wallId: "w1" };

t("a caster's record is written with the wall it sealed, and spellEffectOf and sealOf read it back", () => {
  const data = spellEffectData({ spell: SPELL, caster: CASTER, castId: "castA", role: "caster", seal: WALL });
  assert.deepEqual(data.flags["acks-extras"].spellEffect.seal, WALL);
  assert.deepEqual(sealOf(data), WALL);
  assert.deepEqual(spellEffectOf(data).seal, WALL);
});

t("a record with no pick, a pick missing an id and a recipient's record carry no seal", () => {
  for (const seal of [undefined, null, { sceneId: "s1" }, { wallId: "w1" }]) {
    const data = spellEffectData({ spell: SPELL, caster: CASTER, castId: "castA", role: "caster", seal });
    assert.equal("seal" in data.flags["acks-extras"].spellEffect, false, JSON.stringify(seal));
    assert.equal(spellEffectOf(data).seal, undefined);
  }
  const recipient = spellEffectData({ spell: SPELL, caster: CASTER, castId: "castA", role: "recipient", seal: WALL });
  assert.equal("seal" in recipient.flags["acks-extras"].spellEffect, false);
});

t("a concentration's record carries the mark too, since the held record spreads the cast's mark", () => {
  const mark = { spell: SPELL, caster: CASTER, castId: "castA", role: "caster", seal: WALL };
  const data = heldRecordData(mark, { held: "mobile", now: 5, tail: null, cap: null });
  assert.deepEqual(sealOf(data), WALL);
});

t("the seal kind's step is run from the cast's own dependencies", () => {
  const seen = [];
  const ctx = { request: { castId: "castA" } };
  assert.equal(stepOf("seal")(ctx, { seal: (c) => (seen.push(c), { ok: true }) }).ok, true);
  assert.equal(seen[0], ctx);
});

/* ------------------------------------------------------------------ */
/*  The cast's pick and write                                         */
/* ------------------------------------------------------------------ */

globalThis.foundry = { utils: { escapeHTML: (x) => String(x) } };
globalThis.game = { i18n: { format: (key, data) => (data && Object.keys(data).length ? `${key}|${JSON.stringify(data)}` : key), localize: (key) => key } };
globalThis.Roll = class {
  constructor(formula) {
    this.formula = formula;
  }
  async evaluate() {
    this.total = 7;
    return this;
  }
};
globalThis.ui = { notifications: { warn() {}, info() {} } };
const { castSpellRun } = await import("../scripts/magic/cast-spell.mjs");

let na = 0;
const ta = async (name, fn) => {
  await fn();
  na++;
  console.log(`ok - ${name}`);
};

const SEAL_ROW = { key: "shut", type: "seal", lasts: "duration" };
const CASTER_TOKEN = { id: "tok1", uuid: "Scene.s1.Token.tok1" };
const makeSpell = ({ rows = [SEAL_ROW], extra = {} } = {}) => {
  const caster = { id: "c1", type: "character", isOwner: true, uuid: "Actor.c1", name: "Invented Caster", effects: [] };
  return {
    id: "sp1",
    type: "spell",
    uuid: "Actor.c1.Item.sp1",
    name: "Invented Shutting",
    img: "icons/invented.webp",
    system: { lvl: 1, class: "" },
    parent: caster,
    flags: { "acks-extras": { spell: { schools: [], effects: rows, duration: { shape: "fixed", value: 2, unit: "hours" }, range: { shape: "distance", value: 30, unit: "feet" }, ...extra } } },
  };
};

/** The seams one run reaches, in order, with what each was handed. `door` and `sealed` are the doubles' answers; an absent `door` leaves `pickDoor` off the deps. */
function runDeps({ door, sealed = { ok: true }, isGM = false } = {}) {
  const calls = { picks: [], seals: [], records: [], posts: [], texts: [], spends: 0 };
  const order = [];
  const deps = {
    lookups: { byCookbookId: () => null, fromUuidSync: () => null },
    read: async () => ({ actor: {}, tokens: [], casterToken: CASTER_TOKEN, gaps: {}, statuses: [], capacity: { verdict: "ok" }, level: { matched: false }, cap: null, tradition: null, classItem: null }),
    ask: async () => (order.push("ask"), { mode: "normal", picks: {} }),
    notify: () => {},
    notifyText: (level, text) => calls.texts.push([level, text]),
    castId: () => (order.push("castId"), "castX"),
    roll: () => 1,
    post: async (card) => (order.push("post"), calls.posts.push(card), { id: "m1", flags: { "acks-extras": { castCard: card } } }),
    apply: async () => {},
    record: async (_caster, data) => (order.push("record"), calls.records.push(data)),
    throwRow: async () => null,
    now: () => 10,
    isGM: () => isGM,
    endHeld: async () => void order.push("endHeld"),
    declare: { declare: async () => ({ castId: "d1" }), finish: async () => {}, clearHand: async () => {} },
    declaredTargets: async () => ({ tokens: [], gaps: {}, gone: [] }),
    seal: async (ctx) => (order.push("seal"), calls.seals.push(ctx.request), typeof sealed === "function" ? sealed(ctx) : sealed),
  };
  if (door !== undefined) {
    deps.pickDoor = async (o) => {
      order.push("pickDoor");
      calls.picks.push(o);
      return typeof door === "function" ? door(o) : door;
    };
  }
  const spend = async () => void (order.push("spend"), calls.spends++);
  return { deps, calls, order, spend };
}
const cast = (spell, r) => castSpellRun(spell, r.spend, r.deps);

await ta("a cancel at the pick spends nothing, writes nothing and posts nothing", async () => {
  const r = runDeps({ door: null });
  const out = await cast(makeSpell(), r);
  assert.deepEqual([out.ok, out.reason], [false, "cancelled"]);
  assert.deepEqual(r.order, ["ask", "pickDoor"]);
  assert.deepEqual([r.calls.spends, r.calls.seals.length, r.calls.records.length, r.calls.posts.length], [0, 0, 0, 0]);
});

await ta("the pick is handed the caster's token, the seat and the spell's range at the cast", async () => {
  const r = runDeps({ door: { skipped: true }, isGM: true });
  const spell = makeSpell();
  await cast(spell, r);
  assert.deepEqual(r.calls.picks[0], { caster: spell.parent, casterToken: CASTER_TOKEN, rangeFeet: 30, isGM: true, cite: "" });
});

await ta("a skip goes on with the spell's own record and line, and writes nothing to a wall", async () => {
  for (const door of [{ skipped: true }, undefined]) {
    const r = runDeps({ door });
    const out = await cast(makeSpell(), r);
    assert.equal(out.ok, true);
    assert.deepEqual(r.order, door ? ["ask", "pickDoor", "spend", "endHeld", "castId", "record", "post"] : ["ask", "spend", "endHeld", "castId", "record", "post"]);
    assert.equal(r.calls.seals.length, 0);
    const mark = spellEffectOf(r.calls.records[0]);
    assert.equal(mark.seal, undefined, "no wall on the record");
    assert.equal(mark.startTime, 10, "the record is the spell's own, timed");
    assert.deepEqual(r.calls.posts[0].lines, [describeSpellEffect(SEAL_ROW).text]);
  }
});

await ta("a pick is written after the spend with the cast's id, the record carries the wall, and the card says what was sealed", async () => {
  const r = runDeps({ door: { wallId: "w1", sceneId: "s1" } });
  const spell = makeSpell();
  const out = await cast(spell, r);
  assert.equal(out.ok, true);
  assert.deepEqual(r.order, ["ask", "pickDoor", "spend", "endHeld", "castId", "seal", "record", "post"]);
  assert.deepEqual(r.calls.seals[0], { casterUuid: "Actor.c1", spellUuid: spell.uuid, castId: "castX", sceneId: "s1", wallId: "w1", rangeFeet: 30 });
  const record = r.calls.records[0];
  assert.deepEqual(sealOf(record), WALL);
  assert.equal(spellEffectOf(record).castId, "castX", "the record carries the id the stamp carries");
  assert.equal(spellEffectOf(record).startTime, 10);
  assert.deepEqual(r.calls.posts[0].lines, ['ACKS-MAGIC.cast.line.sealed|{"duration":"2 hours"}', "ACKS-MAGIC.cast.line.sealEnd"], "in place of the spell's own line");
  assert.equal(r.calls.texts.length, 0);
});

await ta("a Judge's pick past the range is asked for with no range, so the GM's client measures none", async () => {
  const r = runDeps({ door: { wallId: "w1", sceneId: "s1", over: true }, isGM: true });
  await cast(makeSpell(), r);
  assert.equal(r.calls.seals[0].rangeFeet, null);
});

await ta("a spell that states no range sends none", async () => {
  const r = runDeps({ door: { wallId: "w1", sceneId: "s1" } });
  await cast(makeSpell({ extra: { range: undefined } }), r);
  assert.equal(r.calls.picks[0].rangeFeet, null);
  assert.equal(r.calls.seals[0].rangeFeet, null);
});

await ta("a refused write is a line on the card and a notice to the seat; the spend stands and the record names no wall", async () => {
  const answers = [
    ["ACKS-MAGIC.castSeal.refused.outOfRange", async () => ({ ok: false, reason: "outOfRange" })],
    ["ACKS-MAGIC.castSeal.refused.noGm", async () => undefined],
    ["ACKS-MAGIC.castSeal.refused.failed", async () => { throw new Error("socket"); }],
  ];
  const logged = console.error;
  console.error = () => {};
  for (const [why, seal] of answers) {
    const r = runDeps({ door: { wallId: "w1", sceneId: "s1" } });
    r.deps.seal = seal;
    const out = await cast(makeSpell(), r);
    assert.equal(out.ok, true);
    assert.equal(r.calls.spends, 1);
    assert.deepEqual(r.calls.texts, [["warn", why]], why);
    assert.deepEqual(r.calls.posts[0].lines, ["ACKS-MAGIC.cast.line.sealRefused|" + JSON.stringify({ reason: why }), describeSpellEffect(SEAL_ROW).text]);
    assert.equal(spellEffectOf(r.calls.records[0]).seal, undefined);
  }
  console.error = logged;
});

await ta("a sealed cast whose spell is untimed still leaves its record, bare, so the stamp has a record to end it", async () => {
  const r = runDeps({ door: { wallId: "w1", sceneId: "s1" } });
  await cast(makeSpell({ rows: [{ key: "shut", type: "seal" }], extra: { duration: undefined } }), r);
  assert.equal(r.calls.records.length, 1);
  const record = spellEffectOf(r.calls.records[0]);
  assert.deepEqual([record.seal, record.startTime, record.duration], [WALL, undefined, undefined]);
});

await ta("a Player's seal with no GM connected is refused before the pick and the spend; a Judge's seat and an online GM need no relay", async () => {
  const noted = [];
  const player = runDeps({ door: { wallId: "w1", sceneId: "s1" } });
  player.deps.gmOnline = () => false;
  player.deps.notify = (level, key) => noted.push([level, key]);
  const out = await cast(makeSpell(), player);
  assert.deepEqual([out.ok, out.reason], [false, "noGm"]);
  assert.deepEqual(player.order, ["ask"], "no pick, no spend");
  assert.deepEqual([player.calls.spends, player.calls.seals.length, player.calls.records.length, player.calls.posts.length], [0, 0, 0, 0]);
  assert.deepEqual(noted, [["warn", "sealNoGm"]]);
  const judge = runDeps({ door: { wallId: "w1", sceneId: "s1" }, isGM: true });
  judge.deps.gmOnline = () => false;
  assert.equal((await cast(makeSpell(), judge)).ok, true);
  const online = runDeps({ door: { wallId: "w1", sceneId: "s1" } });
  online.deps.gmOnline = () => true;
  assert.equal((await cast(makeSpell(), online)).ok, true);
});

await ta("a spell with no seal row asks for no door", async () => {
  const r = runDeps({ door: { wallId: "w1", sceneId: "s1" } });
  await cast(makeSpell({ rows: [{ key: "dim", type: "light", lasts: "duration" }] }), r);
  assert.equal(r.calls.picks.length, 0);
  assert.equal(r.calls.seals.length, 0);
});

console.log(`\n${n + na} tests passed`);
