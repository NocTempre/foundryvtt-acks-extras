/**
 * The body's night: a restful night, Endurance's extra nights, and the fatigue
 * ladder a day at a time.
 *
 * Every threshold below is INVENTED — the real day counts, allowances and
 * rounds-per-stone arrive through the importer. What this pins is the shape:
 * what makes a night restful, that nobody is exempt from a forced march and a
 * labourer is exempt from a run of days, that a fatigued body only recovers on
 * a dedicated rest day that is also restful, and that an unimported figure
 * means its trigger cannot fire rather than firing on a default.
 */
import assert from "node:assert/strict";
import { registerTable, unregisterTable, PRIORITY } from "../scripts/lib/tables.mjs";
import { SURVIVAL_DOC } from "../scripts/lib/survival.mjs";
import {
  armourSleepThrow, donRounds, enduranceAllowance, fatigueOf, fatigueStep, freshFatigue, restfulNight,
} from "../scripts/lib/fatigue.mjs";

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok   " + name); };

const SAMPLE = {
  id: SURVIVAL_DOC,
  source: "invented",
  tables: {
    fatigue: {
      sleeplessDays: 3, activityDays: 5, forcedMarchDays: 1,
      enduranceDays: 2, endurancePerConPoint: 1, enduranceLaborExtra: 1,
    },
    sleep: { donRoundsPerStone: 3 },
  },
};
const load = (tables = SAMPLE.tables) => {
  unregisterTable(SURVIVAL_DOC);
  registerTable({ ...SAMPLE, tables }, { priority: PRIORITY.WORLD, source: "test" });
};

/** Walk `days` days, each a `march` unless `kind` says otherwise, from a fresh body. */
function walk(days, opts = {}) {
  let state = freshFatigue();
  let stacks = 0;
  const trail = [];
  for (let i = 0; i < days; i++) {
    const step = fatigueStep(state, { ...opts, stacks });
    state = step.state;
    stacks = step.stacks;
    trail.push(step);
  }
  return { state, stacks, trail };
}

/* --- state ------------------------------------------------------------------ */

ok("a fresh body is rested, and a record is normalized to whole non-negative days", () => {
  assert.deepEqual(freshFatigue(), { activityDays: 0, sleeplessDays: 0, forcedDays: 0 });
  assert.deepEqual(fatigueOf(null), freshFatigue());
  assert.deepEqual(fatigueOf({ activityDays: 4.9, sleeplessDays: -2 }), { activityDays: 4, sleeplessDays: 0, forcedDays: 0 });
  assert.deepEqual(fatigueOf({ activityDays: "x", sleeplessDays: "7", forcedDays: 2 }), { activityDays: 0, sleeplessDays: 7, forcedDays: 2 });
});

/* --- the allowance ---------------------------------------------------------- */

ok("a body without Endurance has no extra nights; with it the imported figures add up", () => {
  load();
  assert.equal(enduranceAllowance({ endurance: false, labor: true, conBonus: 3 }), 0);
  assert.equal(enduranceAllowance({ endurance: true }), 2, "the base alone");
  assert.equal(enduranceAllowance({ endurance: true, conBonus: 3 }), 5, "and a night per point of bonus");
  assert.equal(enduranceAllowance({ endurance: true, conBonus: -2 }), 2, "a penalty takes nothing off");
  assert.equal(enduranceAllowance({ endurance: true, labor: true, conBonus: 3 }), 6, "and a labourer's extra");
});

ok("an unimported allowance is null, and a missing rate or extra counts as nothing", () => {
  load({ fatigue: { sleeplessDays: 3 } });
  assert.equal(enduranceAllowance({ endurance: true, conBonus: 4 }), null, "no base, no stated allowance");
  assert.equal(enduranceAllowance({ endurance: false }), 0, "but no Endurance is still zero");
  load({ fatigue: { enduranceDays: 4 } });
  assert.equal(enduranceAllowance({ endurance: true, labor: true, conBonus: 5 }), 4, "only the base was imported");
  unregisterTable(SURVIVAL_DOC);
  assert.equal(enduranceAllowance({ endurance: true }), null);
});

/* --- a restful night -------------------------------------------------------- */

ok("an ordinary night is restful and names no reason", () => {
  assert.deepEqual(restfulNight(), { restful: true, reasons: [] });
  assert.deepEqual(restfulNight({ rest: null, sheltered: false }), { restful: true, reasons: [] });
});

ok("a night declared unslept is not restful", () => {
  assert.deepEqual(restfulNight({ noSleep: true }), { restful: false, reasons: ["noSleep"] });
});

ok("a cold that asks for a heat source or clothing is answered by either", () => {
  const rest = { fire: true, clothing: true, both: false };
  assert.equal(restfulNight({ rest }).restful, false);
  assert.deepEqual(restfulNight({ rest }).reasons, ["cold"]);
  assert.equal(restfulNight({ rest, atHeatSource: true }).restful, true, "a fire is enough");
  assert.equal(restfulNight({ rest, sheltered: true }).restful, true, "so is clothing");
});

ok("a cold that asks for both is answered only by both", () => {
  const rest = { fire: true, clothing: true, both: true };
  assert.equal(restfulNight({ rest, atHeatSource: true }).restful, false);
  assert.equal(restfulNight({ rest, sheltered: true }).restful, false);
  assert.equal(restfulNight({ rest, atHeatSource: true, sheltered: true }).restful, true);
});

ok("a sky that states no need asks nothing of the night", () => {
  assert.equal(restfulNight({ rest: { fire: false, clothing: false, both: false } }).restful, true);
});

ok("a sleeper in armour must throw over its weight, strictly", () => {
  assert.deepEqual(armourSleepThrow({ stone: 7, roll: 8 }), { restful: true, stone: 7, roll: 8 });
  assert.equal(armourSleepThrow({ stone: 7, roll: 7 }).restful, false, "equal is not over");
  assert.equal(armourSleepThrow({ stone: 4.5, roll: 5 }).restful, true, "a fraction of a stone counts");
  assert.deepEqual(restfulNight({ armour: { stone: 9, roll: 3 } }), { restful: false, reasons: ["armour"] });
  assert.equal(restfulNight({ armour: { stone: 3, roll: 11 } }).restful, true);
});

ok("every failed condition is named", () => {
  const night = restfulNight({
    noSleep: true, rest: { fire: true, clothing: true, both: false }, armour: { stone: 9, roll: 2 },
  });
  assert.equal(night.restful, false);
  assert.deepEqual(night.reasons, ["noSleep", "cold", "armour"]);
});

/* --- donning armour --------------------------------------------------------- */

ok("the rounds to don armour are the imported rate times the weight, rounded up", () => {
  load();
  assert.equal(donRounds(7), 21);
  assert.equal(donRounds(2.5), 8, "a part round is a whole one");
  assert.equal(donRounds(0), 0);
  load({ sleep: {} });
  assert.equal(donRounds(7), null, "unimported is unstated, not zero");
});

/* --- the ladder ------------------------------------------------------------- */

ok("a body that keeps resting and keeps to rest days is never tired", () => {
  load();
  const camped = walk(9, { dayKind: "camp", restful: true });
  assert.equal(camped.stacks, 0);
  assert.deepEqual(camped.state, freshFatigue(), "rest days keep both clocks at zero");
});

ok("a run of days of activity tires a body on the imported count, and not before", () => {
  load();
  const { trail } = walk(7, { dayKind: "march", restful: true });
  assert.deepEqual(trail.slice(0, 4).map((s) => s.stacks), [0, 0, 0, 0], "four days is under the count");
  assert.deepEqual(trail[4].reasons, ["run"]);
  assert.equal(trail[4].stacks, 1);
  assert.equal(trail[5].stacks, 2, "and every further day it stays fatigued adds a stack");
  assert.deepEqual(trail[5].reasons, ["run"], "the run is still the cause");
});

ok("a labourer is exempt from the run but not from a forced march", () => {
  load();
  assert.equal(walk(9, { dayKind: "march", restful: true, labor: true }).stacks, 0);
  const forced = fatigueStep(freshFatigue(), { dayKind: "forced", forcedMarch: true, restful: true, labor: true });
  assert.deepEqual(forced.reasons, ["forcedMarch"]);
  assert.equal(forced.stacks, 1);
});

ok("a forced march tires everyone at once, with or without rest", () => {
  load();
  const step = fatigueStep(freshFatigue(), { dayKind: "forced", forcedMarch: true, restful: true, allowance: 9 });
  assert.deepEqual(step.reasons, ["forcedMarch"], "no allowance excuses it");
  assert.equal(step.stacks, 1);
  assert.equal(fatigueStep(freshFatigue(), { dayKind: "march", restful: true }).stacks, 0, "a plain march does not");
});

ok("nights without restful sleep tire a body on the imported count plus its allowance", () => {
  load();
  const bare = walk(4, { dayKind: "camp", restful: false });
  assert.deepEqual(bare.trail.map((s) => s.stacks), [0, 0, 1, 2], "the third sleepless night is the count");
  assert.deepEqual(bare.trail[2].reasons, ["sleepless"]);
  assert.equal(bare.state.sleeplessDays, 4);

  const hardy = walk(6, { dayKind: "camp", restful: false, allowance: 2 });
  assert.deepEqual(hardy.trail.map((s) => s.stacks), [0, 0, 0, 0, 1, 2], "two extra nights pushed it back");
});

ok("one restful night resets the sleepless count", () => {
  load();
  let state = freshFatigue();
  state = fatigueStep(state, { dayKind: "camp", restful: false }).state;
  state = fatigueStep(state, { dayKind: "camp", restful: false }).state;
  assert.equal(state.sleeplessDays, 2);
  const slept = fatigueStep(state, { dayKind: "camp", restful: true });
  assert.equal(slept.state.sleeplessDays, 0);
  assert.equal(slept.stacks, 0, "and the third night never came");
});

ok("a fatigued body stays so on a march, even with a restful night", () => {
  load();
  const step = fatigueStep({ activityDays: 1, sleeplessDays: 0 }, { dayKind: "march", restful: true, stacks: 2 });
  assert.equal(step.stacks, 3);
  assert.deepEqual(step.reasons, ["lingers"], "with no fresh cause the reason says it is still on");
});

ok("a fatigued body is cured by a rest day, but only with a restful night", () => {
  load();
  const cured = fatigueStep({ activityDays: 6, sleeplessDays: 0 }, { dayKind: "camp", restful: true, stacks: 3 });
  assert.equal(cured.stacks, 0);
  assert.deepEqual(cured.reasons, ["rested"]);
  assert.equal(cured.state.activityDays, 0, "the run of days starts over");

  const restless = fatigueStep({ activityDays: 6, sleeplessDays: 0 }, { dayKind: "camp", restful: false, stacks: 3 });
  assert.equal(restless.stacks, 4, "a rest day without a restful night does not cure it");
  assert.deepEqual(restless.reasons, ["lingers"]);
});

ok("a camp day that is also a forced march is not a rest day", () => {
  load();
  const step = fatigueStep({ activityDays: 2, sleeplessDays: 0 }, {
    dayKind: "camp", forcedMarch: true, restful: true, stacks: 2,
  });
  assert.equal(step.stacks, 3);
  assert.equal(step.state.activityDays, 3, "the day counts as activity");
  assert.deepEqual(step.reasons, ["forcedMarch"]);
});

ok("a body with no fatigue and a fresh cause gains its first stack, naming every cause", () => {
  load();
  const step = fatigueStep({ activityDays: 4, sleeplessDays: 2 }, { dayKind: "forced", forcedMarch: true, restful: false });
  assert.deepEqual(step.reasons, ["forcedMarch", "sleepless", "run"]);
  assert.equal(step.stacks, 1, "three causes in one day are still one stack");
});

ok("an unimported threshold cannot fire, and an unimported table says so", () => {
  load({ fatigue: { activityDays: 2 } });
  const only = walk(3, { dayKind: "march", restful: false });
  assert.deepEqual(only.trail.map((s) => s.reasons), [[], ["run"], ["run"]], "sleepless never fires without its figure");
  assert.equal(only.trail[0].unpriced, false);
  assert.equal(fatigueStep(freshFatigue(), { dayKind: "forced", forcedMarch: true }).reasons.includes("forcedMarch"), false);

  unregisterTable(SURVIVAL_DOC);
  const bare = walk(12, { dayKind: "forced", forcedMarch: true, restful: false });
  assert.equal(bare.stacks, 0, "nothing imported, nobody tired on invented timing");
  assert.equal(bare.trail[0].unpriced, true);
  assert.equal(bare.state.sleeplessDays, 12, "the clocks still run, so importing later starts from the truth");
  assert.equal(bare.state.activityDays, 12);
});

ok("a forced march tires a body once its run of forced days reaches the imported count", () => {
  load({ fatigue: { forcedMarchDays: 3 } });
  const step = fatigueStep(freshFatigue(), { dayKind: "forced", forcedMarch: true });
  assert.equal(step.stacks, 0, "one forced day is under a count of three");
  assert.equal(step.state.forcedDays, 1, "but the run has begun");
  assert.equal(step.unpriced, false);

  const run = walk(3, { dayKind: "forced", forcedMarch: true });
  assert.deepEqual(run.trail.map((s) => s.reasons), [[], [], ["forcedMarch"]], "the third forced day in a row tires");
  assert.equal(run.stacks, 1);

  const broken = fatigueStep({ forcedDays: 2 }, { dayKind: "march", forcedMarch: false });
  assert.equal(broken.state.forcedDays, 0, "a day that is not forced ends the run");
  assert.equal(broken.stacks, 0);
});

unregisterTable(SURVIVAL_DOC);
console.log("\ntest-fatigue: all " + passed + " checks passed");
