/**
 * Offline tests for the ceremony record (`scripts/magic/ceremony-state.mjs`):
 * the stigma ledger, corruption and the wounds it makes due, an implement's
 * effective level, the best set for a throw, and the flag helpers. Foundry-free;
 * every count, score and name below is invented, so this file carries no book
 * content.
 *
 * Usage: node tools/test-ceremony-state.mjs
 */
import assert from "node:assert/strict";

const {
  FLAG_CEREMONY,
  addCorruption,
  addStigma,
  bestSet,
  effectiveLevel,
  markDamage,
  markItemDamage,
  purify,
  purifyActor,
  readActorState,
  readItemState,
  recordCorruption,
  recordStigma,
  resetDamage,
  resetItemDamage,
  stigmaCount,
} = await import("../scripts/magic/ceremony-state.mjs");

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

/** A document that keeps its flag and counts its writes. */
const doc = (flag) => {
  const d = {
    writes: 0,
    flags: flag === undefined ? {} : { "acks-extras": { ceremony: flag } },
    getFlag: (m, k) => d.flags[m]?.[k],
    setFlag: async (m, k, v) => {
      d.writes++;
      (d.flags[m] ??= {})[k] = v;
    },
  };
  return d;
};
const implement = (implementLevel, damage, name = "set") => ({ name, flags: { "acks-extras": { ceremony: { implementLevel, damage } } } });

t("the flag key is ceremony", () => assert.equal(FLAG_CEREMONY, "ceremony"));

t("a first stigma writes `marks` entries and counts them", () => {
  const r = addStigma(undefined, { castId: "c1", at: 10, cause: "failure", marks: 3 });
  assert.equal(r.written, true);
  assert.equal(stigmaCount(r.state), 3);
  assert.deepEqual(r.state.stigma[0], { castId: "c1", at: 10, cause: "failure" });
});

t("a replayed castId writes nothing and returns the same state", () => {
  const first = addStigma(undefined, { castId: "c1", at: 10, cause: "failure", marks: 2 });
  const again = addStigma(first.state, { castId: "c1", at: 99, cause: "botch", marks: 2 });
  assert.deepEqual([again.written, again.reason], [false, "replay"]);
  assert.deepEqual(again.state, first.state);
  assert.equal(stigmaCount(again.state), 2);
});

t("a mutator never alters the state it is given", () => {
  const before = addStigma(undefined, { castId: "c1", marks: 1 }).state;
  const frozen = JSON.stringify(before);
  addStigma(before, { castId: "c2", marks: 1 });
  purify(before);
  addCorruption(before, { castId: "c3", points: 4, wisdomScore: 2 });
  assert.equal(JSON.stringify(before), frozen);
});

t("a null, absent or unusable marks count writes nothing", () => {
  for (const marks of [null, undefined, 0, -1, 1.5, "2", NaN]) {
    const r = addStigma(undefined, { castId: "c1", marks });
    assert.deepEqual([r.written, r.reason], [false, "noFigure"], `marks ${String(marks)}`);
    assert.equal(stigmaCount(r.state), 0);
    const d = markDamage({ implementLevel: 3, damage: 0 }, { marks });
    assert.deepEqual([d.written, d.reason], [false, "noFigure"], `damage marks ${String(marks)}`);
    assert.equal(d.state.damage, 0);
  }
  assert.deepEqual(addStigma(undefined, { marks: 1 }).reason, "noFigure", "no castId");
  assert.deepEqual(addStigma(undefined).reason, "noFigure", "no arguments");
});

t("purify empties the stigma ledger and leaves corruption", () => {
  const s0 = addStigma(undefined, { castId: "c1", marks: 2 }).state;
  const s1 = addCorruption(s0, { castId: "c2", points: 5, wisdomScore: 3 }).state;
  const r = purify(s1);
  assert.equal(r.written, true);
  assert.equal(stigmaCount(r.state), 0);
  assert.deepEqual(r.state.corruption, s1.corruption);
  assert.deepEqual([purify(r.state).written, purify(r.state).reason], [false, "empty"]);
});

t("a purified cast id may mark again", () => {
  const s0 = addStigma(undefined, { castId: "c1", marks: 1 }).state;
  const s1 = addStigma(purify(s0).state, { castId: "c1", marks: 1 });
  assert.equal(s1.written, true);
});

t("corruption adds points and one wound per Wisdom-score multiple crossed", () => {
  const a = addCorruption(undefined, { castId: "k1", points: 4, wisdomScore: 5 });
  assert.deepEqual([a.written, a.woundsDue, a.state.corruption.points, a.state.corruption.wounds], [true, 0, 4, 0]);
  const b = addCorruption(a.state, { castId: "k2", points: 3, wisdomScore: 5 });
  assert.deepEqual([b.woundsDue, b.state.corruption.wounds], [1, 1], "7 points cross one multiple of 5");
  const c = addCorruption(b.state, { castId: "k3", points: 14, wisdomScore: 5 });
  assert.deepEqual([c.woundsDue, c.state.corruption.wounds, c.state.corruption.points], [3, 4, 21], "21 points are four multiples; one was already due");
  assert.deepEqual(c.state.corruption.log.map((e) => e.castId), ["k1", "k2", "k3"]);
});

t("a score met exactly counts as crossed", () => {
  const r = addCorruption(undefined, { castId: "k1", points: 5, wisdomScore: 5 });
  assert.equal(r.state.corruption.wounds, 1);
});

t("wounds stop at the cap, and a null cap has no ceiling", () => {
  const capped = addCorruption(undefined, { castId: "k1", points: 40, wisdomScore: 5, cap: 3 });
  assert.deepEqual([capped.state.corruption.wounds, capped.woundsDue, capped.state.corruption.points], [3, 3, 40]);
  const more = addCorruption(capped.state, { castId: "k2", points: 40, wisdomScore: 5, cap: 3 });
  assert.deepEqual([more.state.corruption.wounds, more.woundsDue], [3, 0], "points keep counting, wounds do not pass the cap");
  const open = addCorruption(undefined, { castId: "k1", points: 40, wisdomScore: 5, cap: null });
  assert.equal(open.state.corruption.wounds, 8);
  assert.equal(addCorruption(undefined, { castId: "k1", points: 40, wisdomScore: 5 }).state.corruption.wounds, 8, "an absent cap is no ceiling");
  assert.equal(addCorruption(undefined, { castId: "k1", points: 40, wisdomScore: 5, cap: 0 }).state.corruption.wounds, 0);
});

t("a lower cap later does not take a wound back", () => {
  const a = addCorruption(undefined, { castId: "k1", points: 20, wisdomScore: 5, cap: 9 });
  const b = addCorruption(a.state, { castId: "k2", points: 1, wisdomScore: 5, cap: 2 });
  assert.equal(b.state.corruption.wounds, 4);
  assert.equal(b.woundsDue, 0);
});

t("a replayed corruption castId writes nothing", () => {
  const a = addCorruption(undefined, { castId: "k1", points: 6, wisdomScore: 5 });
  const b = addCorruption(a.state, { castId: "k1", points: 6, wisdomScore: 5 });
  assert.deepEqual([b.written, b.reason, b.woundsDue], [false, "replay", 0]);
  assert.deepEqual(b.state, a.state);
});

t("corruption with no usable points writes nothing; a blank score records points and owes no wound", () => {
  for (const points of [null, undefined, 0, -2, "3", NaN]) {
    const r = addCorruption(undefined, { castId: "k1", points, wisdomScore: 5 });
    assert.deepEqual([r.written, r.reason], [false, "noFigure"], `points ${String(points)}`);
    assert.equal(r.state.corruption.points, 0);
  }
  const blank = addCorruption(undefined, { castId: "k1", points: 9, wisdomScore: null, cap: 4 });
  assert.deepEqual([blank.written, blank.state.corruption.points, blank.state.corruption.wounds], [true, 9, 0]);
  const caught = addCorruption(blank.state, { castId: "k2", points: 1, wisdomScore: 5, cap: 4 });
  assert.equal(caught.state.corruption.wounds, 2, "the next call with a score counts the whole total");
});

t("damage lowers the effective level, never below 0", () => {
  assert.equal(effectiveLevel(implement(5, 0)), 5);
  assert.equal(effectiveLevel(implement(5, 2)), 3);
  assert.equal(effectiveLevel(implement(2, 7)), 0);
  assert.equal(effectiveLevel({ name: "plain" }), 0, "an item with no ceremony flag");
  const getter = { getFlag: (m, k) => (m === "acks-extras" && k === "ceremony" ? { implementLevel: 4, damage: 1 } : undefined) };
  assert.equal(effectiveLevel(getter), 3, "a document reads through getFlag");
});

t("markDamage adds marks and resetDamage clears them", () => {
  const a = markDamage({ implementLevel: 6, damage: 1 }, { marks: 2 });
  assert.deepEqual([a.written, a.state.damage, a.state.implementLevel], [true, 3, 6]);
  const b = resetDamage(a.state);
  assert.deepEqual([b.written, b.state.damage], [true, 0]);
  assert.deepEqual([resetDamage(b.state).written, resetDamage(b.state).reason], [false, "empty"]);
});

t("bestSet picks the highest effective set that is high enough", () => {
  const low = implement(3, 0, "low");
  const mid = implement(6, 1, "mid");
  const high = implement(8, 5, "high");
  const top = implement(9, 0, "top");
  assert.equal(bestSet([low, mid, high], 3).name, "mid", "the highest of those that suffice");
  assert.equal(bestSet([low, mid, high, top], 3).name, "top");
  assert.equal(bestSet([low, mid, high], 5).name, "mid");
  assert.equal(bestSet([low, mid, high], 6), null, "damage left none high enough");
  assert.equal(bestSet([low, high], 4), null);
  assert.equal(bestSet([], 1), null);
  assert.equal(bestSet(undefined, 1), null);
  assert.equal(bestSet([low], null), null, "no needed level, no answer");
  assert.equal(bestSet([implement(4, 0, "first"), implement(4, 0, "second")], 4).name, "first", "a tie keeps the first");
  assert.equal(bestSet([{ name: "plain" }], 0), null, "an item with no implement level is no set");
});

await ta("recordStigma writes once and a replay writes nothing", async () => {
  const actor = doc();
  const first = await recordStigma(actor, { castId: "c1", at: 1, cause: "failure", marks: 2 });
  assert.equal(first.written, true);
  assert.equal(actor.writes, 1);
  assert.equal(readActorState(actor).stigma.length, 2);
  const replay = await recordStigma(actor, { castId: "c1", at: 2, cause: "failure", marks: 2 });
  assert.deepEqual([replay.written, replay.reason], [false, "replay"]);
  assert.equal(actor.writes, 1, "no second write");
  const none = await recordStigma(actor, { castId: "c2", marks: null });
  assert.deepEqual([none.written, none.reason], [false, "noFigure"]);
  assert.equal(actor.writes, 1, "no figure, no write");
});

await ta("purifyActor empties the stored ledger and an empty one writes nothing", async () => {
  const actor = doc({ stigma: [{ castId: "c1", at: 1, cause: "x" }], corruption: { points: 2, wounds: 0, log: [] } });
  assert.equal((await purifyActor(actor)).written, true);
  assert.deepEqual(readActorState(actor).stigma, []);
  assert.equal(readActorState(actor).corruption.points, 2);
  assert.equal((await purifyActor(actor)).written, false);
  assert.equal(actor.writes, 1);
});

await ta("recordCorruption stores points and wounds, and a replay writes nothing", async () => {
  const actor = doc();
  const r = await recordCorruption(actor, { castId: "k1", points: 12, wisdomScore: 5, cap: 1 });
  assert.deepEqual([r.written, r.woundsDue], [true, 1]);
  assert.deepEqual([readActorState(actor).corruption.points, readActorState(actor).corruption.wounds], [12, 1]);
  await recordCorruption(actor, { castId: "k1", points: 12, wisdomScore: 5, cap: 1 });
  assert.equal(actor.writes, 1);
});

await ta("markItemDamage and resetItemDamage write the item's flag only when something changed", async () => {
  const item = doc({ implementLevel: 5, damage: 0 });
  assert.equal((await markItemDamage(item, { marks: null })).written, false);
  assert.equal(item.writes, 0, "no figure, no write");
  await markItemDamage(item, { marks: 2 });
  assert.deepEqual(readItemState(item), { implementLevel: 5, damage: 2 });
  assert.equal(effectiveLevel(item), 3);
  await resetItemDamage(item);
  assert.equal(readItemState(item).damage, 0);
  assert.equal((await resetItemDamage(item)).written, false);
  assert.equal(item.writes, 2);
});

t("a flag holding junk reads as an empty record", () => {
  const s = readActorState(doc({ stigma: "no", corruption: { points: "x", log: 3 } }));
  assert.deepEqual(s, { stigma: [], corruption: { points: 0, wounds: 0, log: [] } });
  assert.deepEqual(readItemState(doc({ implementLevel: "x", damage: -4 })), { implementLevel: null, damage: 0 });
});

console.log(`\n${n} ceremony-state tests passed`);
