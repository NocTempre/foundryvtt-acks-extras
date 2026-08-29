/**
 * Searching the wild.
 *
 * Every distance and target below is INVENTED. What this pins is the rule that
 * surprises people — a party covering more ground finds MORE, not less — that
 * one throw serves three quarries, that a search always owes an encounter
 * throw, and that beating the target on empty ground still teaches nothing.
 */
import assert from "node:assert/strict";
import { registerTable, unregisterTable, PRIORITY } from "../scripts/lib/tables.mjs";
import {
  SEARCHING_DOC, SEARCH_SUBJECTS, SEARCH_MODES, searchTarget, searchSpec,
  searchesAvailable, searchOutcome, searchingReady, splitSearch, surveySpec, surveyOutcome,
} from "../scripts/formation/searching.mjs";

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok   " + name); };

const SAMPLE = {
  id: SEARCHING_DOC,
  source: "invented",
  tables: {
    // Invented brackets: slower parties need more, faster ones less.
    targets: [
      { min: 0, max: 15, target: 19 },
      { min: 16, max: 40, target: 15 },
      { min: 41, max: null, target: 8 },
    ],
    movingQuarry: -3,
    specificTarget: -5,
    turnsPerThrow: 6,
    aerialTurnsPerThrow: 3,
    canopyTerrains: ["forest", "jungle", "swamp"],
    canopyPenalty: -9,
    surveyTarget: 17,
    surveyPerSearch: 3,
  },
};
const load = () => registerTable(SAMPLE, { priority: PRIORITY.WORLD, source: "test" });

ok("the three quarries share one throw and differ in kind", () => {
  assert.deepEqual(Object.keys(SEARCH_SUBJECTS), ["pointOfInterest", "landmark", "lostGroup"]);
  assert.equal(SEARCH_SUBJECTS.landmark.shared, true, "every lost group shares one landmark");
  assert.equal(SEARCH_SUBJECTS.lostGroup.canMove, true, "only a party can wander off");
  assert.equal(SEARCH_SUBJECTS.pointOfInterest.canMove, undefined, "a lair stays put");
});

ok("an unpriced search cannot be attempted", () => {
  unregisterTable(SEARCHING_DOC);
  assert.equal(searchingReady(), false);
  assert.equal(searchTarget(30), null);
  assert.equal(searchSpec({ milesPerDay: 30 }).missing, "targets");
});

ok("covering more ground finds MORE — the target improves as speed rises", () => {
  unregisterTable(SEARCHING_DOC); load();
  assert.equal(searchingReady(), true);
  const slow = searchTarget(10);
  const brisk = searchTarget(30);
  const fast = searchTarget(80);
  assert.ok(slow > brisk && brisk > fast, "a faster sweep is an easier throw, not a harder one");
  assert.equal(slow, 19);
  assert.equal(fast, 8, "an open-ended top bracket still answers");
});

ok("a bracket answers at its own edges", () => {
  unregisterTable(SEARCHING_DOC); load();
  assert.equal(searchTarget(15), 19, "the last mile of a bracket is still in it");
  assert.equal(searchTarget(16), 15, "and the first mile of the next is not");
  assert.equal(searchTarget(0), 19);
  assert.equal(searchTarget("nonsense"), null);
});

ok("a search costs an hour and always owes an encounter throw", () => {
  unregisterTable(SEARCHING_DOC); load();
  const spec = searchSpec({ milesPerDay: 30 });
  assert.equal(spec.costsHours, 1);
  assert.equal(spec.owesEncounterThrow, true, "looking around gets you noticed");
});

ok("a moving quarry is harder, and only a quarry that CAN move", () => {
  unregisterTable(SEARCHING_DOC); load();
  assert.equal(searchSpec({ milesPerDay: 30, subject: "lostGroup", movingQuarry: true }).modifier, -3);
  assert.equal(searchSpec({ milesPerDay: 30, subject: "lostGroup" }).modifier, 0, "a group sitting still");
  // A landmark cannot wander, so the flag is meaningless against it.
  assert.equal(searchSpec({ milesPerDay: 30, subject: "landmark", movingQuarry: true }).modifier, 0);
});

ok("the day board decides how many searches a day holds", () => {
  assert.equal(searchesAvailable({ slots: ["search", "hunt", "search", ""] }), 2);
  assert.equal(searchesAvailable({ slots: ["search", "search"], forced: true }), 0,
    "a forced march has no spare hours to look around with");
  assert.equal(searchesAvailable({}), 0);
});

ok("beating the target on empty ground still teaches nothing", () => {
  unregisterTable(SEARCHING_DOC); load();
  const target = searchTarget(30);
  assert.deepEqual(searchOutcome({ rolled: target, target, present: true }), { found: true });
  const empty = searchOutcome({ rolled: 20, target, present: false });
  assert.equal(empty.found, false);
  assert.equal(empty.reason, "nothingHere", "and the party cannot tell that from a miss");
});

ok("a missed throw and an empty hex are reported apart, for the Judge alone", () => {
  unregisterTable(SEARCHING_DOC); load();
  const target = searchTarget(30);
  assert.equal(searchOutcome({ rolled: 1, target, present: true }).reason, "missed");
  assert.equal(searchOutcome({ rolled: 20, target, present: false }).reason, "nothingHere");
  assert.equal(searchOutcome({ rolled: 20, target: null }).reason, "unpriced");
  unregisterTable(SEARCHING_DOC);
});

/* --- from the air ---------------------------------------------------------- */
ok("the modes are structural", () => {
  assert.deepEqual(Object.keys(SEARCH_MODES), ["onFoot", "aerial"]);
  assert.equal(SEARCH_MODES.aerial.varies, true, "the air is not one correction but two");
});

ok("hunting ONE named place is harder than noticing whatever is there", () => {
  unregisterTable(SEARCHING_DOC); load();
  const any = searchSpec({ milesPerDay: 30 });
  const named = searchSpec({ milesPerDay: 30, specific: true });
  assert.equal(any.modifier, 0);
  assert.equal(named.modifier, -5);
  assert.ok(named.notes.includes("specific"));
});

ok("over open country the air buys MORE throws, not a better target", () => {
  unregisterTable(SEARCHING_DOC); load();
  const walked = searchSpec({ milesPerDay: 30, terrain: "hills" });
  const flown = searchSpec({ milesPerDay: 30, mode: "aerial", terrain: "hills" });
  assert.equal(flown.target, walked.target, "the target is the same");
  assert.equal(walked.turnsPerThrow, 6);
  assert.equal(flown.turnsPerThrow, 3, "but the throws come twice as often");
  assert.equal(flown.costsHours, 0.5);
  assert.ok(flown.notes.includes("openGround"));
});

ok("over canopy the air buys the SAME throws at a worse target", () => {
  unregisterTable(SEARCHING_DOC); load();
  const flown = searchSpec({ milesPerDay: 30, mode: "aerial", terrain: "forest" });
  assert.equal(flown.turnsPerThrow, 6, "no faster — the foliage is in the way");
  assert.equal(flown.modifier, -9);
  assert.ok(flown.notes.includes("canopy"));
});

ok("the two aerial corrections never both apply", () => {
  unregisterTable(SEARCHING_DOC); load();
  for (const terrain of ["hills", "forest"]) {
    const spec = searchSpec({ milesPerDay: 30, mode: "aerial", terrain });
    const both = spec.notes.includes("canopy") && spec.notes.includes("openGround");
    assert.equal(both, false, terrain + " must take one correction, not both");
  }
});

ok("penalties compound: a named place under canopy from the air", () => {
  unregisterTable(SEARCHING_DOC); load();
  const spec = searchSpec({ milesPerDay: 30, mode: "aerial", terrain: "jungle", specific: true });
  assert.equal(spec.modifier, -5 + -9);
  unregisterTable(SEARCHING_DOC);
});

/* --- splitting up ---------------------------------------------------------- */
ok("splitting buys throws and costs safety in equal measure", () => {
  const whole = splitSearch({ groups: 1 });
  assert.equal(whole.split, false);
  const split = splitSearch({ groups: 3 });
  assert.equal(split.throws, 3, "three sweeps");
  assert.equal(split.encounterThrows, 3, "and three chances to meet something");
  assert.equal(split.alone, true, "with nobody to help");
});

ok("close enough to assist is not split at all", () => {
  const near = splitSearch({ groups: 3, mutuallySupporting: true });
  assert.equal(near.split, false);
  assert.equal(near.throws, 1, "one party searching one area, whatever the marching order says");
  assert.equal(near.reason, "supporting");
});

/* --- land surveying: right, confidently wrong, or nothing ------------------ */
ok("the assessment improves with ground actually walked", () => {
  unregisterTable(SEARCHING_DOC); load();
  assert.equal(surveySpec({ priorSuccesses: 0 }).bonus, 0);
  assert.equal(surveySpec({ priorSuccesses: 2 }).bonus, 6, "cumulative in successful searches");
  assert.equal(surveySpec({ priorSuccesses: 0 }).target, 17);
  unregisterTable(SEARCHING_DOC);
  assert.equal(surveySpec({}).missing, "surveyTarget");
});

ok("a success reveals the truth", () => {
  const r = surveyOutcome({ natural: 15, total: 18, target: 17 });
  assert.equal(r.state, "assessed");
  assert.equal(r.reveals, true);
  assert.equal(r.trustworthy, true);
});

ok("an unmodified 1 reveals a LIE the party has no reason to doubt", () => {
  const r = surveyOutcome({ natural: 1, total: 7, target: 17 });
  assert.equal(r.state, "misread");
  assert.equal(r.reveals, true, "a number IS given");
  assert.equal(r.trustworthy, false, "it is simply wrong");
});

ok("an ordinary miss reveals nothing, which is not the same as a lie", () => {
  const r = surveyOutcome({ natural: 4, total: 9, target: 17 });
  assert.equal(r.state, "inconclusive");
  assert.equal(r.reveals, false);
});

ok("a heavily penalised miss is silence, not a lie — only a natural 1 lies", () => {
  const bad = surveyOutcome({ natural: 2, total: -6, target: 17 });
  assert.equal(bad.state, "inconclusive", "worse than a 1 in total, but not a 1 on the die");
  assert.equal(surveyOutcome({ natural: 1, total: 99, target: 17 }).state, "misread",
    "and a 1 lies however large the bonus");
});

console.log("\ntest-searching: all " + passed + " checks passed");
