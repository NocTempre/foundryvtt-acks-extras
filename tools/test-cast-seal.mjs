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

console.log(`\n${n} tests passed`);
