/**
 * The lost episode's ledger and transitions.
 *
 * No values here are printed — the whole file is structure. What it pins down
 * is the doctrine: the believed marker is retired rather than moved, the
 * snapshot is taken once, and the ledger (not the fog bitmap) is the authority
 * on what was faked.
 */
import assert from "node:assert/strict";
import {
  freshLost, lostOf, hexKey, beginLost, walkBelieving, discoverLost, reanchorLost, driftSummary,
} from "../scripts/formation/lost.mjs";

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok   " + name); };

const A = { i: 5, j: 7 };
const B = { i: 6, j: 6 };
const C = { i: 6, j: 5 };
const SNAP = { userA: "base64-a", userB: "base64-b" };

ok("a fresh ledger is inactive and empty", () => {
  const l = freshLost();
  assert.equal(l.active, false);
  assert.equal(l.believed, null);
  assert.deepEqual(l.faked, []);
  assert.equal(l.fogSnapshot, null);
});

ok("a junk record normalizes", () => {
  const l = lostOf({ lost: { active: "yes", faked: ["1:1", 7, null], fogSnapshot: "nope" } });
  assert.equal(l.active, true);
  assert.deepEqual(l.faked, ["1:1"], "non-string keys are dropped");
  assert.equal(l.fogSnapshot, null, "a non-object snapshot is refused");
});

ok("beginning an episode anchors the lie and seeds the belief", () => {
  const l = beginLost(freshLost(), { day: 9, anchor: A, fogSnapshot: SNAP });
  assert.equal(l.active, true);
  assert.equal(l.sinceDay, 9);
  assert.deepEqual(l.anchor, A);
  assert.deepEqual(l.believed, A, "the belief starts where everyone agreed");
  assert.deepEqual(l.fogSnapshot, SNAP);
  assert.deepEqual(l.faked, []);
});

ok("the snapshot is taken ONCE — a second failure does not overwrite it", () => {
  let l = beginLost(freshLost(), { day: 9, anchor: A, fogSnapshot: SNAP });
  l = walkBelieving(l, B);
  const again = beginLost(l, { day: 11, anchor: C, fogSnapshot: { userA: "LATER" } });
  assert.deepEqual(again.fogSnapshot, SNAP, "the true fog is the one from before any faking");
  assert.equal(again.sinceDay, 9, "and the episode keeps its original day");
  assert.deepEqual(again.faked, ["6:6"], "and its faked ground");
});

ok("walking while astray records each believed hex once", () => {
  let l = beginLost(freshLost(), { day: 9, anchor: A, fogSnapshot: SNAP });
  l = walkBelieving(l, B);
  l = walkBelieving(l, C);
  l = walkBelieving(l, C);
  assert.deepEqual(l.faked, [hexKey(B), hexKey(C)], "a repeat adds nothing");
  assert.deepEqual(l.believed, C, "the marker follows the party's belief");
});

ok("walking does nothing when no episode is running", () => {
  const l = walkBelieving(freshLost(), B);
  assert.equal(l.active, false);
  assert.deepEqual(l.faked, []);
});

ok("discovery clears the ledger and hands back the revert", () => {
  let l = beginLost(freshLost(), { day: 9, anchor: A, fogSnapshot: SNAP });
  l = walkBelieving(l, B);
  l = walkBelieving(l, C);
  const { lost, revert, discovered } = discoverLost(l);
  assert.equal(discovered, true);
  assert.equal(lost.active, false, "the episode is over");
  assert.equal(lost.believed, null, "the belief is RETIRED, not moved to the truth");
  assert.deepEqual(lost.faked, []);
  assert.equal(lost.fogSnapshot, null, "the snapshot is spent");
  assert.deepEqual(revert.faked, [hexKey(B), hexKey(C)], "the ledger is what the revert closes");
  assert.deepEqual(revert.fogSnapshot, SNAP);
  assert.deepEqual(revert.anchor, A);
});

ok("discovery on the first day has nothing to revert but still discovers", () => {
  const l = beginLost(freshLost(), { day: 9, anchor: A, fogSnapshot: null });
  const { revert, discovered, lost } = discoverLost(l);
  assert.equal(discovered, true);
  assert.equal(revert, null, "nothing was faked yet");
  assert.equal(lost.active, false);
});

ok("discovering when not lost is a no-op", () => {
  const { discovered, revert } = discoverLost(freshLost());
  assert.equal(discovered, false);
  assert.equal(revert, null);
});

ok("the Judge's drift readout counts days and faked ground", () => {
  let l = beginLost(freshLost(), { day: 9, anchor: A, fogSnapshot: SNAP });
  l = walkBelieving(l, B);
  l = walkBelieving(l, C);
  const d = driftSummary(l, 12);
  assert.equal(d.days, 3);
  assert.equal(d.fakedHexes, 2);
  assert.deepEqual(d.anchor, A);
  assert.equal(driftSummary(freshLost(), 12), null);
});

ok("a Judge's note survives the episode it was written for", () => {
  const l = beginLost(freshLost(), { day: 9, anchor: A, judgeNote: "steered them east" });
  const { lost } = discoverLost(l);
  assert.equal(lost.judgeNote, "steered them east");
});

/* --- observations: seen for real, drawn in the wrong place ---------------- */
const T1 = { i: 9, j: 9 };
const T2 = { i: 10, j: 9 };

ok("what the party sees is recorded as a PAIR — where it was, where it thinks", () => {
  let l = beginLost(freshLost(), { day: 9, anchor: A, fogSnapshot: SNAP });
  l = walkBelieving(l, B, T1);
  l = walkBelieving(l, C, T2);
  assert.deepEqual(l.observations, [
    { at: hexKey(T1), shown: hexKey(B) },
    { at: hexKey(T2), shown: hexKey(C) },
  ]);
  assert.deepEqual(l.faked, [hexKey(B), hexKey(C)], "the faked ground is the BELIEVED side");
});

ok("a day with no true position recorded fakes ground but observes nothing", () => {
  let l = beginLost(freshLost(), { day: 9, anchor: A, fogSnapshot: SNAP });
  l = walkBelieving(l, B);
  assert.deepEqual(l.faked, [hexKey(B)]);
  assert.deepEqual(l.observations, [], "no truth, no observation");
});

ok("the same pair is not recorded twice", () => {
  let l = beginLost(freshLost(), { day: 9, anchor: A });
  l = walkBelieving(l, B, T1);
  l = walkBelieving(l, B, T1);
  assert.equal(l.observations.length, 1);
});

/* --- the two endings ------------------------------------------------------ */
ok("discovery DISCARDS the observations — the party still does not know where", () => {
  let l = beginLost(freshLost(), { day: 9, anchor: A, fogSnapshot: SNAP });
  l = walkBelieving(l, B, T1);
  l = walkBelieving(l, C, T2);
  const { revert, lost } = discoverLost(l);
  assert.deepEqual(revert.discard.map((o) => o.at), [hexKey(T1), hexKey(T2)],
    "they are handed back to be thrown away, not committed");
  assert.deepEqual(lost.observations, []);
});

ok("re-anchoring COMMITS them, re-keyed to where they truly were", () => {
  let l = beginLost(freshLost(), { day: 9, anchor: A, fogSnapshot: SNAP });
  l = walkBelieving(l, B, T1);
  l = walkBelieving(l, C, T2);
  const { commit, revert, reanchored, lost } = reanchorLost(l);
  assert.equal(reanchored, true);
  assert.deepEqual(commit, [hexKey(T1), hexKey(T2)], "the TRUE hexes are earned");
  assert.deepEqual(revert.discard, [], "nothing is discarded — it is re-placed");
  assert.deepEqual(revert.faked, [hexKey(B), hexKey(C)], "the wrong ground still closes first");
  assert.equal(lost.active, false);
});

ok("re-anchoring dedupes two sightings of one true hex", () => {
  let l = beginLost(freshLost(), { day: 9, anchor: A });
  l = walkBelieving(l, B, T1);
  l = walkBelieving(l, C, T1);
  assert.equal(l.observations.length, 2, "two believed hexes, one real one");
  assert.deepEqual(reanchorLost(l).commit, [hexKey(T1)], "but one hex is earned");
});

ok("re-anchoring when not lost commits nothing", () => {
  const r = reanchorLost(freshLost());
  assert.equal(r.reanchored, false);
  assert.deepEqual(r.commit, []);
});

ok("lostOf takes the TRAVEL object, not the lost object", () => {
  // Handing it the lost object reads `.lost` off a ledger, finds undefined,
  // and answers a confident "not lost". That shipped once and only the live
  // run caught it, because every offline caller happened to wrap correctly.
  const active = beginLost(freshLost(), { day: 9, anchor: A });
  assert.equal(lostOf({ lost: active }).active, true, "wrapped: correct");
  assert.equal(lostOf(active).active, false, "unwrapped: silently wrong — never call it this way");
});

console.log("\ntest-lost: all " + passed + " checks passed");
