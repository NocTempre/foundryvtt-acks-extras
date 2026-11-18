/**
 * The crossing's rules (`scripts/formation/crossing-logic.mjs`): a member's row
 * with its three refusal classes, where a throw leaves a member, how far a fall
 * is, and a jump's row. The logic runs on whatever the registered tables hold
 * and says so when they hold nothing. Every figure and word here is invented;
 * the printed ones arrive through the importer.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { registerTable, resetTables, PRIORITY } from "../scripts/lib/tables.mjs";
import { FORMATION_DOC } from "../scripts/formation/constants.mjs";
import { OUTCOMES_TABLE, obstaclePlan, readThrow } from "../scripts/formation/obstacles.mjs";
import { canClear, jumpAt } from "../scripts/formation/jumping.mjs";
import {
  CLIMB_CHECK, CROSSING_STATUSES, FOOTINGS, FOOTING_STATE, HANGING, HANG_CLIMB, LANDING, REFUSAL, SETTLED, climbUpRow, crossingHeld, crossingOfHolder,
  DROWNING, fallFromClimb, fallFromDepth, heldAfter, isHanging, haulStep, jumpResult, jumpRow, landingOutcome, landingRow, memberRow, rescueRefusal, escapeStep, monsterStone, squeezeRow, squeezeThrowStep, stepMember, swimRow, swimThrowStep, swimTick, withFooting, paceRow, paceStep,
  crossingElapsed, pressRate, pressRounds, roundsDue, stretchFeetAt, timedStep,
} from "../scripts/formation/crossing-logic.mjs";
import { ownSwimSpeed } from "../scripts/formation/swimming.mjs";
import { PACE_RATE_TABLE, PACE_SPEEDS, PACE_TABLE, paceRates } from "../scripts/formation/climb-pace.mjs";
import { squeezeBotched } from "../scripts/formation/squeezing.mjs";
import { bashStrBonus } from "../scripts/formation/doors.mjs";

let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

/** The registered tables, with invented figures and words. */
const SPELUNKING = {
  stretchFeet: 40,
  adventuring: { easyClimb: 6, sheerClimb: false, rappel: false, crawl: 6, narrowLedge: 7, precariousLedge: false },
  botchBand: { sheerClimb: { min: 1, max: 1 } },
};
const OUTCOMES = {
  easyClimb: { fail: { text: "Inch along", falls: false, advances: true }, botch: { text: "Slips a little", falls: false } },
  sheerClimb: { fail: { text: "Holds on", falls: false }, botch: { text: "Plummets", falls: true } },
};
const JUMPING = { jumpDie: "1d8", runUpFeet: 15, standingShare: 0.5, feetPerStone: 3, creatureDex: 10, leapPlus: 2, leapMinimum: 1 };
const FALL = { die: "1d8", feetPerDie: 15 };

/** The faster paces' penalty pairs, invented and told apart so a way of crossing reading another's pair fails. */
const PACES = { climbPacePenalties: [3, 8], crawlPacePenalties: [4, 9], balancePacePenalties: [6, 12] };

const load = ({ spelunking = SPELUNKING, outcomes = OUTCOMES, jumping = JUMPING, fall = FALL, pace = null } = {}) => {
  resetTables();
  registerTable(
    {
      id: FORMATION_DOC,
      source: "invented",
      tables: {
        ...(spelunking && { spelunking }),
        ...(outcomes && { [OUTCOMES_TABLE]: outcomes }),
        ...(jumping && { jumping }),
        ...(fall && { fall }),
        ...(pace && pace),
      },
    },
    { priority: PRIORITY.WORLD, source: "test" },
  );
};

const JUDGE = { judge: true, owns: false };
const OWNER = { judge: false, owns: true };
const OTHER = { judge: false, owns: false };
const climber = { target: 12, parts: [{ label: "Climbing", value: 0 }] };

// ---- the climb's check configuration ---------------------------------------
await ok("the climb's configuration carries every field resolveCheck reads, and names no other proficiency", () => {
  for (const key of ["flagKey", "capability", "rollKey", "advKey", "pattern"]) assert.ok(CLIMB_CHECK[key], key);
  assert.ok(CLIMB_CHECK.pattern.test("Climbing"));
  assert.equal(CLIMB_CHECK.pattern.test("Mountaineering"), false);
  assert.equal(Object.isFrozen(CLIMB_CHECK), true);
});

// ---- a member's row: the three classes ------------------------------------
await ok("a permission refusal stops a player and warns a Judge, whose plan throws on the member's own figure", () => {
  load();
  const player = memberRow({ kind: "sheerClimb", figure: climber, seat: OWNER });
  assert.deepEqual(player.refusal, { cls: REFUSAL.permission, reason: "notPermitted" });
  assert.equal(player.can, false);
  assert.equal(player.warn, false);
  assert.equal(player.plan, null);

  const judge = memberRow({ kind: "sheerClimb", figure: climber, seat: JUDGE });
  assert.deepEqual(judge.refusal, { cls: REFUSAL.permission, reason: "notPermitted" });
  assert.equal(judge.can, true);
  assert.equal(judge.warn, true);
  assert.equal(judge.plan.overRefusal, true);
  assert.equal(judge.plan.target, 12);

  // The plan is one `readThrow` rolls against, and `stepMember` moves on.
  const read = readThrow({ plan: judge.plan, natural: 15, total: 15 });
  assert.equal(read.ok, true);
  assert.equal(read.success, true);
  assert.equal(stepMember({ member: null, stretches: judge.stretches, read, natural: 15, total: 15 }).state, "across", "a blank length is one stretch");
  assert.equal(stepMember({ member: null, stretches: 3, read, natural: 15, total: 15 }).state, "climbing");
});

await ok("an absence refusal stops every seat, a Judge included, and names the figure", () => {
  // The stretch is not imported.
  load({ spelunking: { adventuring: SPELUNKING.adventuring } });
  for (const seat of [JUDGE, OWNER]) {
    const row = memberRow({ kind: "easyClimb", figure: climber, seat });
    assert.deepEqual(row.refusal, { cls: REFUSAL.absence, reason: "stretch" }, JSON.stringify(seat));
    assert.equal(row.can, false);
    assert.equal(row.warn, false);
    assert.equal(row.plan, null);
    assert.deepEqual(row.unknown, ["stretchFeet"]);
  }
  // The table's column for this kind is not imported.
  load({ spelunking: { stretchFeet: 40, adventuring: {} } });
  const grid = memberRow({ kind: "easyClimb", figure: climber, seat: JUDGE });
  assert.deepEqual(grid.refusal, { cls: REFUSAL.absence, reason: "table" });
  assert.equal(grid.can, false);
  assert.deepEqual(grid.unknown, ["spelunking"]);
});

await ok("a member with no figure is refused to every seat, and a Judge over a permission refusal is no exception", () => {
  load();
  const holder = memberRow({ kind: "sheerClimb", holds: true, figure: null, seat: JUDGE });
  assert.deepEqual(holder.refusal, { cls: REFUSAL.absence, reason: "figure" });
  assert.equal(holder.can, false);
  assert.deepEqual(holder.unknown, ["figure"]);
  assert.equal(holder.target, null);

  const refused = memberRow({ kind: "sheerClimb", figure: null, seat: JUDGE });
  assert.equal(refused.refusal.cls, REFUSAL.absence, "absence is reported before permission");
  assert.equal(refused.can, false);
  assert.equal(refused.warn, false);
  assert.equal(refused.plan, null);
});

await ok("ownership and a finished crossing are seat refusals; a Judge owns no member and needs none", () => {
  load();
  const notOwner = memberRow({ kind: "easyClimb", figure: climber, seat: OTHER });
  assert.deepEqual(notOwner.refusal, { cls: REFUSAL.seat, reason: "notOwner" });
  assert.equal(notOwner.can, false);
  assert.equal(memberRow({ kind: "easyClimb", figure: climber, seat: JUDGE }).can, true);
  assert.equal(memberRow({ kind: "easyClimb", figure: climber, seat: OWNER }).can, true);
  for (const state of SETTLED) {
    for (const seat of [JUDGE, OWNER]) {
      const over = memberRow({ kind: "easyClimb", figure: climber, seat, member: { state, covered: 2, throws: 2 } });
      assert.deepEqual(over.refusal, { cls: REFUSAL.seat, reason: state }, `${state} ${JSON.stringify(seat)}`);
      assert.equal(over.can, false);
      assert.equal(over.warn, false);
    }
  }
});

await ok("a down, left behind or detached member blocks a player and warns a Judge, who goes ahead", () => {
  load();
  for (const standing of ["down", "leftBehind", "detached"]) {
    const player = memberRow({ kind: "easyClimb", figure: climber, seat: OWNER, standing });
    assert.deepEqual(player.refusal, { cls: REFUSAL.seat, reason: standing }, standing);
    assert.equal(player.can, false, standing);
    assert.equal(player.warn, false, standing);
    assert.equal(player.plan, null, standing);

    const judge = memberRow({ kind: "easyClimb", figure: climber, seat: JUDGE, standing });
    assert.deepEqual(judge.refusal, { cls: REFUSAL.permission, reason: standing }, standing);
    assert.equal(judge.can, true, standing);
    assert.equal(judge.warn, true, standing);
    assert.equal(judge.plan.overRefusal, true, standing);
    assert.equal(judge.plan.target, 12, standing);
  }
});

await ok("a stalled member blocks a player and warns a Judge, whose throw is a re-throw", () => {
  load();
  const member = { state: "stalled", covered: 1, throws: 2 };
  const player = memberRow({ kind: "easyClimb", feet: 130, figure: climber, seat: OWNER, member });
  assert.deepEqual(player.refusal, { cls: REFUSAL.seat, reason: "stalled" });
  assert.equal(player.can, false);
  assert.equal(player.plan, null);

  const judge = memberRow({ kind: "easyClimb", feet: 130, figure: climber, seat: JUDGE, member });
  assert.deepEqual(judge.refusal, { cls: REFUSAL.permission, reason: "stalled" });
  assert.equal(judge.can, true);
  assert.equal(judge.warn, true);
  assert.equal(judge.plan.overRefusal, true);

  // The re-throw continues from the stretches covered.
  const read = readThrow({ plan: judge.plan, natural: 15, total: 15 });
  const again = stepMember({ member, stretches: judge.stretches, read, natural: 15, total: 15 });
  assert.deepEqual([again.state, again.covered, again.throws], ["climbing", 2, 3]);
  assert.equal(stepMember({ member: { ...member, covered: 3 }, stretches: judge.stretches, read }).state, "across");
});

await ok("a Judge's warning does not outrank absence: a stalled or down member with no figure is refused to the Judge", () => {
  load();
  for (const extra of [{ standing: "down" }, { member: { state: "stalled", covered: 1, throws: 1 } }]) {
    const row = memberRow({ kind: "easyClimb", figure: null, seat: JUDGE, ...extra });
    assert.equal(row.refusal.cls, REFUSAL.absence);
    assert.equal(row.can, false);
  }
});

await ok("the seat class is reported before absence, and absence before permission", () => {
  load({ spelunking: { adventuring: SPELUNKING.adventuring } });
  const row = memberRow({ kind: "sheerClimb", figure: null, seat: OTHER });
  assert.equal(row.refusal.cls, REFUSAL.seat);
  assert.equal(memberRow({ kind: "sheerClimb", figure: climber, seat: OWNER }).refusal.cls, REFUSAL.absence);
});

await ok("the target is the member's own figure less the Judge's modifier, never the table's number", () => {
  load();
  const row = memberRow({ kind: "easyClimb", figure: { target: 11, parts: [] }, judgeMod: 2, seat: OWNER });
  assert.equal(row.target, 9);
  assert.equal(row.plan.target, 9);
  assert.equal(row.plan.overRefusal, false);
  assert.equal(row.judgeMod, 2);
  assert.equal(row.stretches, 1, "a blank length is one stretch");
  assert.equal(memberRow({ kind: "easyClimb", feet: 130, figure: climber, seat: OWNER }).stretches, 4);
  assert.deepEqual(row.parts, []);
  assert.deepEqual(memberRow({ kind: "easyClimb", figure: climber, seat: OWNER }).parts, climber.parts);
});

await ok("a fixed rope plans the sheer face as the easy climb, so a member the table refused may go", () => {
  load();
  const row = memberRow({ kind: "sheerClimb", ropeFixed: true, figure: climber, seat: OWNER });
  assert.equal(row.effective, "easyClimb");
  assert.equal(row.refusal, null);
  assert.equal(row.can, true);
  assert.equal(row.warn, false);
});

await ok("a Climbing holder needs no column of the table, and an unknown obstacle is an absence", () => {
  load({ spelunking: { stretchFeet: 40 } });
  assert.equal(memberRow({ kind: "sheerClimb", holds: true, figure: climber, seat: OWNER }).can, true);
  const unknown = memberRow({ kind: "wallOfFog", figure: climber, seat: JUDGE });
  assert.deepEqual(unknown.refusal, { cls: REFUSAL.absence, reason: "kind" });
  assert.equal(unknown.can, false);
});

await ok("a row carries the member's record, and nothing imported leaves every seat refused with every figure named", () => {
  load();
  const row = memberRow({ kind: "easyClimb", figure: climber, seat: OWNER, member: { state: "climbing", covered: 2, throws: 3 } });
  assert.deepEqual([row.state, row.covered, row.throws], ["climbing", 2, 3]);
  resetTables();
  const blank = memberRow({ kind: "easyClimb", figure: null, seat: JUDGE });
  assert.equal(blank.can, false);
  assert.equal(blank.target, null);
  assert.deepEqual(blank.unknown, ["stretchFeet", "spelunking", "figure"]);
});

// ---- where a throw leaves a member ------------------------------------------
const made = { ok: true, success: true, outcome: "progress" };
const missed = (outcome, extra = {}) => ({ ok: true, success: false, outcome, ...extra });

await ok("a made stretch leaves the member climbing, the last one across, and each throw is counted", () => {
  let member = null;
  member = stepMember({ member, stretches: 3, read: made, natural: 14, total: 17 });
  assert.deepEqual(member, { state: "climbing", covered: 1, throws: 1, last: { natural: 14, total: 17, success: true, botch: false, outcome: null } });
  member = stepMember({ member, stretches: 3, read: made, natural: 9, total: 9 });
  assert.deepEqual([member.state, member.covered, member.throws], ["climbing", 2, 2]);
  member = stepMember({ member, stretches: 3, read: made, natural: 12, total: 12 });
  assert.deepEqual([member.state, member.covered, member.throws], ["across", 3, 3]);
});

await ok("a miss that advances covers the stretch; one that does not stalls; one that falls ends in a fall", () => {
  const inch = missed({ text: "Inch along", falls: false, advances: true });
  assert.deepEqual(stepMember({ member: { covered: 1, throws: 1 }, stretches: 3, read: inch }).state, "climbing");
  assert.equal(stepMember({ member: { covered: 1, throws: 1 }, stretches: 3, read: inch }).covered, 2);

  const stay = stepMember({ member: { covered: 1, throws: 1 }, stretches: 3, read: missed({ text: "Holds on", falls: false }), natural: 4, total: 4 });
  assert.deepEqual([stay.state, stay.covered, stay.throws], ["stalled", 1, 2]);
  assert.equal(stay.last.outcome, "Holds on");
  assert.equal(stay.last.success, false);

  const fell = stepMember({ member: { covered: 2, throws: 2 }, stretches: 3, read: missed({ text: "Plummets", falls: true }, { botch: true }), natural: 1, total: 1 });
  assert.deepEqual([fell.state, fell.covered, fell.throws], ["fell", 2, 3]);
  assert.equal(fell.last.botch, true);
});

await ok("a member who is across or fell takes no further step, and a count that is no count stalls", () => {
  for (const state of SETTLED) {
    const kept = { state, covered: 1, throws: 4, last: { natural: 3, total: 3, success: false, botch: false, outcome: null } };
    assert.deepEqual(stepMember({ member: kept, stretches: 3, read: made }), kept, state);
  }
  for (const stretches of [null, 0, undefined, -2]) {
    const got = stepMember({ member: { covered: 1, throws: 1 }, stretches, read: made });
    assert.deepEqual([got.state, got.covered], ["stalled", 1], String(stretches));
  }
  assert.equal(stepMember({ member: null, stretches: 2, read: null }).state, "stalled");
});

await ok("a member's record round-trips a row and a step: the row refuses what the step settled", () => {
  load();
  const row = memberRow({ kind: "sheerClimb", holds: true, figure: climber, seat: OWNER });
  const read = readThrow({ plan: row.plan, natural: 1, total: 1 });
  const member = stepMember({ member: null, stretches: row.stretches, read, natural: 1, total: 1 });
  assert.equal(member.state, "fell");
  assert.equal(memberRow({ kind: "sheerClimb", holds: true, figure: climber, seat: OWNER, member }).can, false);
});

// ---- the fall ---------------------------------------------------------------
await ok("a fall from a climb is what was covered plus the midpoint of the stretch being attempted", () => {
  load();
  assert.deepEqual(fallFromClimb({ kind: "sheerClimb", covered: 0 }), {
    feet: 20, damage: "1d8", unknown: [], parts: [{ key: "covered", value: 0 }, { key: "midpoint", value: 20 }],
  });
  // One stretch made: 40 covered and 20 more is 60 feet, four dice. Without the
  // midpoint it would be 40 feet and two.
  const got = fallFromClimb({ kind: "sheerClimb", covered: 1, feet: 200 });
  assert.equal(got.feet, 60);
  assert.equal(got.damage, "4d8");
  assert.deepEqual(got.parts, [{ key: "covered", value: 40 }, { key: "midpoint", value: 20 }]);
  assert.equal(fallFromClimb({ kind: "easyClimb", covered: 2, feet: 200 }).feet, 100);
  assert.equal(fallFromClimb({ kind: "rappel", covered: 1, feet: 200 }).feet, 60, "a rappel falls the same way");
});

await ok("the midpoint is of the distance attempted, which is short where the length is not a whole number of stretches", () => {
  load();
  assert.equal(fallFromClimb({ kind: "sheerClimb", covered: 1, feet: 50 }).feet, 45);
  assert.equal(fallFromClimb({ kind: "sheerClimb", covered: 0, feet: 30 }).feet, 15);
  assert.equal(fallFromClimb({ kind: "sheerClimb", covered: 0, feet: 30 }).damage, "1d8");
  assert.equal(fallFromClimb({ kind: "sheerClimb", covered: 0 }).feet, 20, "a blank length is one stretch");
});

await ok("any other way across falls the Judge's depth, and a blank depth is unknown", () => {
  load();
  for (const kind of ["crawl", "narrowLedge", "precariousLedge"]) {
    const got = fallFromClimb({ kind, covered: 2, feet: 200, depth: 70 });
    assert.equal(got.feet, 70, kind);
    assert.equal(got.damage, "4d8", kind);
    assert.deepEqual(got.parts, [{ key: "depth", value: 70 }], kind);
    const blank = fallFromClimb({ kind, covered: 2, feet: 200 });
    assert.equal(blank.feet, null, kind);
    assert.equal(blank.damage, null, kind);
    assert.deepEqual(blank.unknown, ["depth"], kind);
  }
  assert.deepEqual(fallFromClimb({ kind: "narrowLedge", depth: 0 }).unknown, ["depth"]);
});

await ok("a fall names the figure it lacks, and never guesses a stretch, a depth or a die", () => {
  load({ spelunking: { adventuring: SPELUNKING.adventuring } });
  assert.deepEqual(fallFromClimb({ kind: "sheerClimb", covered: 1, feet: 200 }), { feet: null, damage: null, unknown: ["stretchFeet"], parts: [] });
  assert.equal(fallFromClimb({ kind: "narrowLedge", depth: 70 }).feet, 70, "a depth needs no stretch");
  load({ fall: null });
  const noDice = fallFromClimb({ kind: "sheerClimb", covered: 1, feet: 200 });
  assert.equal(noDice.feet, 60);
  assert.equal(noDice.damage, null);
  assert.deepEqual(noDice.unknown, ["fall"]);
  load({ fall: { die: "1d8", feetPerDie: 100 } });
  const short = fallFromClimb({ kind: "sheerClimb", covered: 0 });
  assert.equal(short.feet, 20);
  assert.equal(short.damage, null, "a fall too short to deal a die has no damage");
  assert.deepEqual(short.unknown, []);
  assert.deepEqual(fallFromClimb({ kind: "wallOfFog", covered: 1 }), { feet: null, damage: null, unknown: ["kind"], parts: [] });
});

// ---- a jump's row ------------------------------------------------------------
const KEYS = ["verdict", "needed", "min", "max", "clearing", "faces", "unknown"];
const pick = (got) => Object.fromEntries(KEYS.map((k) => [k, got[k]]));

await ok("a jump row carries canClear's answer unchanged, for every verdict", () => {
  load();
  // A score of 12 and a die of 8 range over 13 to 20.
  for (const gap of [5, 13, 15, 20, 21, 90]) {
    const options = { dex: 12 };
    assert.deepEqual(pick(jumpRow(gap, { options, seat: JUDGE })), pick(canClear(gap, options)), `gap ${gap}`);
  }
  assert.equal(canClear(5, { dex: 12 }).verdict, "certain");
  assert.equal(canClear(15, { dex: 12 }).verdict, "chance");
  assert.equal(canClear(90, { dex: 12 }).verdict, "impossible");
  const hauling = { dex: 12, encumbrance: 2, runningStart: false };
  assert.deepEqual(pick(jumpRow(8, { options: hauling, seat: OWNER })), pick(canClear(8, hauling)));
  resetTables();
  assert.deepEqual(pick(jumpRow(15, { options: { dex: 12 }, seat: JUDGE })), pick(canClear(15, { dex: 12 })));
});

await ok("an unreachable gap is a permission refusal and a jump with no figures is an absence", () => {
  load();
  const player = jumpRow(90, { options: { dex: 12 }, seat: OWNER });
  assert.deepEqual(player.refusal, { cls: REFUSAL.permission, reason: "impossible" });
  assert.equal(player.can, false);
  const judge = jumpRow(90, { options: { dex: 12 }, seat: JUDGE });
  assert.equal(judge.can, true);
  assert.equal(judge.warn, true);
  assert.equal(jumpRow(15, { options: { dex: 12 }, seat: OWNER }).refusal, null);
  assert.equal(jumpRow(15, { options: { dex: 12 }, seat: OWNER }).can, true);

  resetTables();
  for (const seat of [JUDGE, OWNER]) {
    const row = jumpRow(15, { options: { dex: 12 }, seat });
    assert.equal(row.verdict, "unknown");
    assert.deepEqual(row.refusal, { cls: REFUSAL.absence, reason: "jump" });
    assert.equal(row.can, false);
    assert.equal(row.warn, false);
  }
});

await ok("a jump row is stopped by the seat before the verdict, and a down jumper warns a Judge", () => {
  load();
  const row = jumpRow(15, { options: { dex: 12 }, seat: OTHER });
  assert.deepEqual(row.refusal, { cls: REFUSAL.seat, reason: "notOwner" });
  assert.equal(row.can, false);
  const judge = jumpRow(15, { options: { dex: 12 }, seat: JUDGE, standing: "down" });
  assert.deepEqual(judge.refusal, { cls: REFUSAL.permission, reason: "down" });
  assert.equal(judge.can, true);
  assert.equal(judge.warn, true);
  assert.equal(jumpRow(15, { options: { dex: 12 }, seat: OWNER, standing: "down" }).can, false);
});

// ---- the landing -------------------------------------------------------------
await ok("a precarious or charging landing offers the save and a plain one does not", () => {
  load();
  const row = jumpRow(15, { options: { dex: 12 }, seat: OWNER });
  const plain = landingRow(row, {});
  assert.deepEqual([plain.needed, plain.can, plain.warn], [false, false, false], "no throw is asked and none is offered");
  for (const setup of [{ precarious: true }, { charging: true }, { precarious: true, charging: true }]) {
    const asked = landingRow(row, setup);
    assert.deepEqual([asked.needed, asked.can, asked.warn, asked.save, asked.bonus], [true, true, false, "paralysis", 0], JSON.stringify(setup));
  }
  assert.equal(landingRow(row, { precarious: true, acrobatics: true, saveBonus: 7 }).bonus, 7, "a bonus passed in is carried");
  assert.equal(landingRow(row, { precarious: true, saveBonus: 7 }).bonus, 0, "and only for a holder");
});

await ok("the landing save takes the jump row's refusals: unreachable warns a Judge and stops a player, unknown stops both", () => {
  load();
  const judge = landingRow(jumpRow(90, { options: { dex: 12 }, seat: JUDGE }), { precarious: true });
  assert.deepEqual([judge.can, judge.warn], [true, true]);
  const player = landingRow(jumpRow(90, { options: { dex: 12 }, seat: OWNER }), { precarious: true });
  assert.deepEqual([player.can, player.warn], [false, false]);
  resetTables();
  for (const seat of [JUDGE, OWNER]) {
    const unknown = landingRow(jumpRow(15, { options: { dex: 12 }, seat }), { charging: true });
    assert.deepEqual([unknown.needed, unknown.can, unknown.warn], [true, false, false]);
  }
});

await ok("the footing reaches landingFailure whole, and a fall with no depth names it", () => {
  load({ jumping: { ...JUMPING, shortfallDie: "1d3" } });
  assert.deepEqual(FOOTINGS, ["solid", "edge", "empty"]);
  assert.deepEqual(landingOutcome({ footing: "solid" }), { footing: "solid", outcome: "prone", shortBy: "1d3", damage: null, feet: null, unknown: [] });
  assert.equal(landingOutcome({ footing: "edge" }).outcome, "hanging");
  assert.deepEqual(landingOutcome({ footing: "empty", depth: 30 }), { footing: "empty", outcome: "fall", shortBy: "1d3", damage: "2d8", feet: 30, unknown: [] });
  assert.deepEqual(landingOutcome({ footing: "empty", depth: 6 }), { footing: "empty", outcome: "fall", shortBy: "1d3", damage: null, feet: 6, unknown: [] });
  assert.deepEqual(landingOutcome({ footing: "empty" }), { footing: "empty", outcome: "fall", shortBy: "1d3", damage: null, feet: null, unknown: ["depth"] });
  assert.equal(landingOutcome({ footing: "lava" }), null, "a footing that is no footing yields nothing");
  assert.equal(landingOutcome({}), null);
  resetTables();
  assert.deepEqual(landingOutcome({ footing: "empty", depth: 30 }).unknown, ["shortfallDie", "fall"], "nothing imported is named, not guessed");
});

// ---- the held conditions ------------------------------------------------------
await ok("a crossing's held condition names the crossing and the status, under a 16-character id of its own", () => {
  const a = crossingHeld("AbCdEf0123456789", "vulnerable");
  assert.equal(a.holder, "crossing:AbCdEf0123456789:vulnerable");
  assert.equal(a.statusId, "vulnerable");
  assert.match(a.id, /^[A-Za-z0-9]{16}$/);
  const b = crossingHeld("ZyXwVu9876543210", "vulnerable");
  assert.notEqual(a.id, b.id, "two crossings, two effects");
  assert.match(crossingHeld("id7", "vulnerable").id, /^[A-Za-z0-9]{16}$/, "a short id is padded, not shortened");
  assert.deepEqual(CROSSING_STATUSES, ["vulnerable", "drowning", "stuck"]);
  assert.equal(crossingHeld("AbCdEf0123456789", "drowning").id.slice(0, 2), "c1", "a second status takes a second slot, and vulnerable keeps the first");
  assert.equal(crossingHeld("AbCdEf0123456789", "vulnerable").id.slice(0, 2), "c0");
  assert.notEqual(crossingHeld("AbCdEf0123456789", "drowning").id, a.id);
});

await ok("a holder string gives its crossing back, and any other holder is no crossing's", () => {
  assert.equal(crossingOfHolder(crossingHeld("AbCdEf0123456789", "vulnerable").holder), "AbCdEf0123456789");
  assert.equal(crossingOfHolder("mapperKit"), null);
  assert.equal(crossingOfHolder(undefined), null);
  assert.equal(crossingOfHolder("crossing:"), null);
});

await ok("a member holds the grid's status while on the obstacle and none once across or fell, or where nothing is imported", () => {
  assert.deepEqual(heldAfter({ state: "climbing", vulnerable: true }), ["vulnerable"]);
  assert.deepEqual(heldAfter({ state: "stalled", vulnerable: true }), ["vulnerable"]);
  assert.deepEqual(heldAfter({ state: "across", vulnerable: true }), []);
  assert.deepEqual(heldAfter({ state: "fell", vulnerable: true }), []);
  assert.deepEqual(heldAfter({ state: "climbing", vulnerable: false }), []);
  assert.deepEqual(heldAfter({ state: "climbing", vulnerable: null }), [], "a figure nobody imported holds nothing");
  assert.deepEqual(heldAfter({ state: "climbing" }), []);
  assert.deepEqual(heldAfter(), []);
});

// ---- the seam ---------------------------------------------------------------
await ok("the logic names no Foundry global and publishes no figure of its own", () => {
  const source = fs.readFileSync(new URL("../scripts/formation/crossing-logic.mjs", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(source, /\b(game|foundry|ui|canvas|Hooks|Roll|ChatMessage)\b/);
  assert.equal(obstaclePlan({ kind: "easyClimb", ropeFixed: false, proficient: true, classThrow: 9 }).target, 9);
});

// ---- the climb's check, resolved by the real reader --------------------------
/** The globals party-rolls imports reach, as the party-skills suite stands them. */
class Stub {}
globalThis.game = {
  user: { id: "gm", isGM: true },
  users: [{ id: "gm", isGM: true }],
  i18n: { localize: (k) => k, format: (k) => k, has: () => true },
  settings: { get: () => ({}) },
  actors: new Map(),
  items: [],
};
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.Hooks = { on() {}, once() {}, off() {}, call() {}, callAll() {} };
globalThis.foundry = {
  abstract: { DataModel: class {}, TypeDataModel: class {} },
  data: { regionBehaviors: { RegionBehaviorType: Stub }, fields: {} },
  utils: { escapeHTML: (s) => String(s), deepClone: (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v))) },
  applications: {
    api: { ApplicationV2: Stub, HandlebarsApplicationMixin: (B) => B, DialogV2: Stub },
    handlebars: { renderTemplate: async () => "" },
  },
};
const { resolveCheck } = await import("../scripts/formation/party-rolls.mjs");

/** A character with a stored Adventuring climb figure and `items`. */
function actorWith(items, climb = 9) {
  const a = {
    id: "a1", name: "Probe", type: "character", statuses: new Set(), appliedEffects: [],
    system: { details: { level: 5, morale: 0 }, adventuring: { climb }, hp: { value: 8 }, saves: {}, attack: { throw: 10 }, surprise: {}, initiative: {} },
    getFlag: () => undefined,
  };
  for (const i of items) i.actor = a;
  a.items = Object.assign([...items], { get: (id) => items.find((i) => i.id === id) });
  return a;
}
const skill = (name, provides, target) => {
  const all = { "acks-extras": { extras: { rolls: [{ key: "climb", label: "climb", formula: "1d20", rollType: "above", target: { kind: "flat", flat: target }, scale: "level" }], effects: [], provides } } };
  return { id: `i-${name}`, type: "ability", name, system: {}, flags: all, getFlag: (scope, key) => all[scope]?.[key] };
};

await ok("the real reader resolves the climb: a holder on the skill's figure, anyone else on the stored Adventuring one", () => {
  const stored = resolveCheck(actorWith([]), CLIMB_CHECK);
  assert.equal(stored.target, 9);
  assert.equal(stored.skilled, false);
  const holder = resolveCheck(actorWith([skill("Probe Climbing", ["kw:climbing"], 7)]), CLIMB_CHECK);
  assert.equal(holder.target, 7);
  assert.equal(holder.skilled, true);
  // Mountaineering is not read here, whatever it provides.
  const other = resolveCheck(actorWith([skill("Probe Mountaineering", ["kw:mountaineering"], 5)]), CLIMB_CHECK);
  assert.equal(other.target, 9);
  assert.equal(resolveCheck(actorWith([], null), CLIMB_CHECK), null, "no stored figure and no skill resolves nothing");
});

// ---- the die's face, and where a rolled jump leaves the jumper ----------------------
await ok("the distance a face carries is what canClear counts its clearing faces from, and no face outside the die has one", () => {
  load();
  for (const options of [{ dex: 12 }, { dex: 12, encumbrance: 2, runningStart: false }, { dex: 9, encumbrance: 1 }]) {
    for (const gap of [4, 8, 10, 13, 15, 17, 20, 25]) {
      let clearing = 0;
      for (let face = 1; face <= 8; face++) if (jumpAt(options, face) >= gap) clearing++;
      assert.equal(clearing, canClear(gap, options).clearing, `gap ${gap}`);
    }
  }
  assert.equal(jumpAt({ dex: 12 }, 1), 13);
  assert.equal(jumpAt({ dex: 12 }, 8), 20);
  for (const face of [0, 9, 2.5, "x"]) assert.equal(jumpAt({ dex: 12 }, face), null, `face ${face}`);
  assert.equal(jumpAt({ dex: 12, encumbrance: 2, runningStart: false }, 4), 5, "the conditions apply to the rolled face as to the range");
  resetTables();
  assert.equal(jumpAt({ dex: 12 }, 3), null, "nothing imported, no distance");
});

await ok("a jump that reaches is across; one that does not falls short of the far side over empty space, with no save and no slip", () => {
  load({ jumping: { ...JUMPING, shortfallDie: "1d3" } });
  const clean = jumpResult({ gap: 15, distance: 18 });
  assert.deepEqual([clean.clears, clean.state, clean.footing, clean.outcome, clean.slip, clean.unknown], [true, "across", null, null, null, []]);
  const exact = jumpResult({ gap: 15, distance: 15 });
  assert.deepEqual([exact.clears, exact.state], [true, "across"], "reaching the gap exactly is reaching it");
  const short = jumpResult({ gap: 15, distance: 14, depth: 30 });
  assert.deepEqual([short.clears, short.shortBy, short.state, short.footing, short.outcome, short.slip], [false, 1, "fell", "empty", "fall", null]);
  assert.deepEqual([short.feet, short.damage], [30, "2d8"], "the fall is the depth, with the imported dice");
  assert.deepEqual(jumpResult({ gap: 15, distance: 14 }).unknown, ["depth"], "a blank depth reads unknown");
  load({ jumping: JUMPING });
  assert.deepEqual(jumpResult({ gap: 15, distance: 9, depth: 30 }).unknown, [], "a short jump never needs the shortfall die");
});

await ok("a failed landing slips back by the shortfall: past the edge is solid and prone, on it hanging, short of it a fall", () => {
  load({ jumping: { ...JUMPING, shortfallDie: "1d3" } });
  const failed = { passed: false };
  const at = (slip, depth) => jumpResult({ gap: 15, distance: 18, save: failed, slip, depth });
  assert.deepEqual([at(2).footing, at(2).outcome, at(2).state], ["solid", "prone", "across"]);
  assert.deepEqual([at(3).footing, at(3).outcome, at(3).state], ["edge", "hanging", HANGING]);
  assert.deepEqual([at(5, 30).footing, at(5, 30).outcome, at(5, 30).state, at(5, 30).feet, at(5, 30).damage], ["empty", "fall", "fell", 30, "2d8"]);
  assert.equal(at(3).slip, 3);
  assert.equal(jumpResult({ gap: 15, distance: 17.5, save: failed, slip: 2 }).footing, "solid", "a fractional distance is held against the edge as it is");
  assert.equal(jumpResult({ gap: 15, distance: 18, save: { passed: true }, slip: 4 }).state, "across", "a save made slips nowhere");
  const unrolled = jumpResult({ gap: 15, distance: 18, save: failed, slip: null });
  assert.deepEqual([unrolled.state, unrolled.footing, unrolled.unknown], [LANDING, null, ["shortfallDie"]], "no slip, no footing: the Judge's pick is the route");
  assert.equal(jumpResult({ gap: 0, distance: 3 }), null);
  assert.equal(jumpResult({ gap: 15, distance: null }), null);
});

await ok("a footing the Judge picks replaces the one the attempt reached, with the state it implies, and the rolled figures stand", () => {
  load({ jumping: { ...JUMPING, shortfallDie: "1d3" } });
  assert.deepEqual({ ...FOOTING_STATE }, { solid: "across", edge: HANGING, empty: "fell" });
  for (const footing of FOOTINGS) assert.equal(jumpResult({ gap: 15, distance: 18, save: { passed: false }, slip: footing === "solid" ? 2 : footing === "edge" ? 3 : 5, depth: 30 }).state, FOOTING_STATE[footing], `${footing} is the state jumpResult maps`);
  const reached = jumpResult({ gap: 15, distance: 18, save: { passed: false }, slip: 3, depth: 30 });
  const solid = withFooting(reached, "solid", 30);
  assert.deepEqual([solid.footing, solid.outcome, solid.state, solid.feet, solid.damage], ["solid", "prone", "across", null, null]);
  assert.deepEqual([solid.distance, solid.slip, solid.position, solid.gap], [reached.distance, reached.slip, reached.position, reached.gap], "what was rolled stands");
  const empty = withFooting(reached, "empty", 30);
  assert.deepEqual([empty.state, empty.feet, empty.damage], ["fell", 30, "2d8"]);
  assert.deepEqual(withFooting(reached, "empty").unknown, ["depth"], "a blank depth reads unknown");
  const clean = withFooting(jumpResult({ gap: 15, distance: 18 }), "edge", 30);
  assert.deepEqual([clean.clears, clean.footing, clean.state], [true, "edge", HANGING], "a clean landing may be overridden too");
  assert.equal(withFooting(reached, "lava", 30), reached, "no footing, no change");
  assert.equal(withFooting(null, "solid"), null);
});

await ok("a jump row stops a jumper who is across or fell, and one hanging at the edge climbs up instead", () => {
  load();
  for (const state of SETTLED) {
    const row = jumpRow(15, { options: { dex: 12 }, seat: JUDGE, member: { state } });
    assert.deepEqual([row.can, row.refusal.cls, row.refusal.reason], [false, REFUSAL.seat, state], `${state} stops a Judge`);
  }
  for (const seat of [JUDGE, OWNER]) {
    const hanging = jumpRow(15, { options: { dex: 12 }, seat, member: { state: HANGING, jump: { footing: "edge" } } });
    assert.deepEqual([hanging.can, hanging.refusal.reason], [false, HANGING]);
    const stalled = jumpRow(15, { options: { dex: 12 }, seat, member: { state: "stalled", jump: { footing: "edge" } } });
    assert.equal(stalled.can, false, "a stalled climb up is still hanging");
  }
  assert.equal(jumpRow(15, { options: { dex: 12 }, seat: JUDGE, member: { state: LANDING, jump: {} } }).can, true, "a save left to roll is pressed again");
  assert.equal(isHanging({ state: "stalled", jump: { footing: "solid" } }), false);
  assert.equal(isHanging({ state: "across", jump: { footing: "edge" } }), false, "across after the climb up");
  assert.equal(isHanging(null), false);
});

await ok("the climb up is the climb rows' own: one stretch of the sheer climb, a fixed rope makes it the easy one, and the classes stand", () => {
  load();
  const player = climbUpRow({ figure: climber, seat: OWNER, member: { state: HANGING } });
  assert.deepEqual([player.kind, player.stretches, player.can], [HANG_CLIMB, 1, false]);
  assert.deepEqual(player.refusal, { cls: REFUSAL.permission, reason: "notPermitted" }, "the grid refuses the sheer climb to one who does not hold Climbing");
  const judge = climbUpRow({ figure: climber, seat: JUDGE, member: { state: HANGING } });
  assert.deepEqual([judge.can, judge.warn], [true, true]);
  const holder = climbUpRow({ figure: climber, holds: true, seat: OWNER, member: { state: HANGING } });
  assert.deepEqual([holder.can, holder.target], [true, 12]);
  const roped = climbUpRow({ figure: climber, ropeFixed: true, seat: OWNER, member: { state: HANGING } });
  assert.deepEqual([roped.effective, roped.can], ["easyClimb", true]);
  const stalled = climbUpRow({ figure: climber, holds: true, seat: OWNER, member: { state: "stalled" } });
  assert.deepEqual(stalled.refusal, { cls: REFUSAL.seat, reason: "stalled" }, "a player is stopped after a stall, as on any climb");
  assert.equal(climbUpRow({ figure: climber, holds: true, seat: JUDGE, member: { state: "stalled" } }).warn, true);
  resetTables();
  assert.equal(climbUpRow({ figure: climber, holds: true, seat: JUDGE, member: { state: HANGING } }).refusal.cls, REFUSAL.absence, "nothing imported stops every seat");
});

await ok("a fall from the edge is the Judge's depth with the imported dice, and a blank depth reads unknown", () => {
  load({ jumping: JUMPING });
  const out = fallFromDepth(30);
  assert.deepEqual([out.feet, out.damage, out.unknown, out.parts], [30, "2d8", [], [{ key: "depth", value: 30 }]]);
  assert.deepEqual([fallFromDepth().feet, fallFromDepth().unknown], [null, ["depth"]]);
  assert.deepEqual(fallFromDepth(30).unknown, [], "the shortfall die is not part of a climb's fall");
});

// ---- the swim row ------------------------------------------------------------
/** Invented figures for the registered swimming magnitudes. */
const SWIM = {
  swimmingBonus: 7, swimWaterPenaltySteps: [3, 5, 9], swimSpeedShare: 0.3, breathRounds: 17, sinkFeetPerStone: 19,
  carriedBodyStone: 23, carriedGearShare: 0.4,
};
const loadSwim = (tables = SWIM) => {
  resetTables();
  if (tables) registerTable({ id: FORMATION_DOC, source: "invented", tables }, { priority: PRIORITY.WORLD, source: "test" });
};

await ok("a holder whose target reaches nothing takes no throw, and a non-holder at the same stone still throws", () => {
  loadSwim();
  const holder = swimRow({ encumbrance: 2, holds: true, seat: OWNER });
  assert.deepEqual([holder.target, holder.needed, holder.skip, holder.can, holder.plan], [-5, false, "proficiency", false, null]);
  const other = swimRow({ encumbrance: 2, holds: false, seat: OWNER });
  assert.deepEqual([other.target, other.needed, other.skip, other.can], [2, true, null, true]);
  assert.deepEqual(other.plan, { target: 2, needed: true, conditions: [], overRefusal: false });
  assert.equal(swimRow({ encumbrance: 0, seat: OWNER }).needed, true, "nothing carried is still a throw without the proficiency");
  // The holder's bonus is a part of the figure; a holder whose target stays above nothing throws.
  const loaded = swimRow({ encumbrance: 9, holds: true, seat: OWNER });
  assert.deepEqual([loaded.target, loaded.needed, loaded.can], [2, true, true]);
  assert.deepEqual(loaded.parts, [{ key: "encumbrance", value: 9 }, { key: "proficient", value: 7 }]);
});

await ok("a creature with a swim speed takes no throw and paces at that speed", () => {
  loadSwim();
  const row = swimRow({ encumbrance: 9, holds: false, own: { combat: 31, run: 62 }, speeds: { combat: 100, run: 200 }, seat: OWNER });
  assert.deepEqual([row.skip, row.needed, row.target, row.can, row.plan, row.refusal], ["swimSpeed", false, null, false, null, null]);
  assert.deepEqual([row.pace.combat, row.pace.run, row.pace.own, row.pace.share], [31, 62, true, null]);
  assert.deepEqual(row.parts, []);
  // A row with neither figure positive is no swim speed.
  assert.equal(swimRow({ encumbrance: 9, own: { combat: 0, run: null }, seat: OWNER }).needed, true);
  assert.equal(swimRow({ encumbrance: 9, own: null, seat: OWNER }).needed, true);
  // A swim speed needs nothing imported: no bonus, no steps.
  loadSwim(null);
  const bare = swimRow({ encumbrance: 9, holds: true, own: { combat: 31, run: null }, penalty: 4, seat: OWNER });
  assert.deepEqual([bare.skip, bare.refusal, bare.unknown], ["swimSpeed", null, []]);
});

await ok("an actor's swim speed is the swim row of its Speed table", () => {
  const actor = (speeds) => ({ getFlag: () => ({ speeds }) });
  assert.deepEqual(ownSwimSpeed(actor([{ type: "land", combat: 40, run: 120 }, { type: "swim", combat: 31, run: 93 }])), { combat: 31, run: 93 });
  assert.deepEqual(ownSwimSpeed(actor([{ type: "swim", combat: null, run: 93 }])), { combat: null, run: 93 });
  assert.equal(ownSwimSpeed(actor([{ type: "land", combat: 40, run: 120 }])), null);
  assert.equal(ownSwimSpeed(actor([{ type: "swim", combat: 0, run: null }])), null);
  assert.equal(ownSwimSpeed({ getFlag: () => null }), null);
  assert.equal(ownSwimSpeed(null), null);
});

await ok("the pace is the imported share of the member's speed, null until imported", () => {
  loadSwim();
  const row = swimRow({ encumbrance: 4, speeds: { combat: 100, run: 200 }, seat: OWNER });
  assert.deepEqual([row.pace.combat, row.pace.run, row.pace.share, row.pace.own, row.pace.unknown], [100 * 0.3, 200 * 0.3, 0.3, false, []]);
  assert.deepEqual(row.pace.parts.combat, [{ key: "speed", value: 100 }, { key: "share", value: 0.3 }]);
  assert.deepEqual(swimRow({ encumbrance: 4, speeds: { combat: 100 }, seat: OWNER }).pace.run, null, "a speed that is not given has no pace");
  loadSwim({ ...SWIM, swimSpeedShare: undefined });
  const blank = swimRow({ encumbrance: 4, speeds: { combat: 100, run: 200 }, seat: OWNER });
  assert.deepEqual([blank.pace.combat, blank.pace.run, blank.pace.share, blank.pace.unknown], [null, null, null, ["swimSpeedShare"]]);
  assert.deepEqual(blank.pace.parts, { combat: [], run: [] });
  assert.equal(blank.can, true, "a missing share refuses nothing: the throw does not need it");
});

await ok("a penalty is none, an imported step or a larger figure; anything else stops a player and warns a Judge", () => {
  loadSwim();
  for (const penalty of [0, 3, 5, 9, 10, 40, -5]) {
    const row = swimRow({ encumbrance: 4, penalty, conditions: ["cold"], seat: JUDGE });
    assert.equal(row.refusal, null, "penalty " + penalty);
    assert.equal(row.can, true, "penalty " + penalty);
  }
  const stepped = swimRow({ encumbrance: 4, penalty: 5, conditions: ["cold", "fast"], seat: OWNER });
  assert.deepEqual([stepped.target, stepped.penalty, stepped.conditions], [4 + 5, 5, ["cold", "fast"]]);
  assert.deepEqual(stepped.parts.find((part) => part.key === "water"), { key: "water", value: -5, conditions: ["cold", "fast"] });
  for (const penalty of [1, 2.5, 4, 8]) {
    const refusal = { cls: REFUSAL.permission, reason: "penalty" };
    const player = swimRow({ encumbrance: 4, penalty, seat: OWNER });
    assert.deepEqual([player.refusal, player.can, player.warn, player.plan, player.unknown], [refusal, false, false, null, []], "penalty " + penalty);
    const judge = swimRow({ encumbrance: 4, penalty, seat: JUDGE });
    assert.deepEqual([judge.refusal, judge.can, judge.warn, judge.plan.overRefusal], [refusal, true, true, true], "penalty " + penalty);
  }
  // With the steps not imported there is no step to fall short of: any size prices the throw, as it does for swimmingThrow.
  loadSwim({ ...SWIM, swimWaterPenaltySteps: undefined });
  for (const penalty of [0, 1, 50]) {
    const row = swimRow({ encumbrance: 4, penalty, seat: OWNER });
    assert.deepEqual([row.refusal, row.can, row.target, row.unknown], [null, true, 4 + penalty, []], "penalty " + penalty);
  }
});

await ok("a holder's bonus that is not imported refuses every seat, and a non-holder is not asked for it", () => {
  loadSwim({ ...SWIM, swimmingBonus: undefined });
  for (const seat of [JUDGE, OWNER]) {
    const holder = swimRow({ encumbrance: 4, holds: true, seat });
    assert.deepEqual(holder.refusal, { cls: REFUSAL.absence, reason: "bonus" });
    assert.deepEqual([holder.can, holder.target, holder.needed, holder.unknown], [false, null, null, ["swimmingBonus"]]);
  }
  assert.equal(swimRow({ encumbrance: 4, holds: false, seat: OWNER }).can, true);
  loadSwim(null);
  assert.equal(swimRow({ encumbrance: 4, holds: false, seat: OWNER }).can, true, "nothing imported still prices a throw with no bonus and no penalty");
});

await ok("a seat that is not the owner, or a member who is down, is refused as on any row; a Judge is warned only where the class says", () => {
  loadSwim();
  assert.deepEqual(swimRow({ encumbrance: 4, seat: OTHER }).refusal, { cls: REFUSAL.seat, reason: "notOwner" });
  const down = swimRow({ encumbrance: 4, seat: OWNER, standing: "down" });
  assert.deepEqual([down.refusal, down.can], [{ cls: REFUSAL.seat, reason: "down" }, false]);
  const judge = swimRow({ encumbrance: 4, seat: JUDGE, standing: "down" });
  assert.deepEqual([judge.refusal.cls, judge.can, judge.warn], [REFUSAL.permission, true, true]);
  assert.deepEqual(judge.plan, { target: 4, needed: true, conditions: [], overRefusal: true });
});

await ok("a drowning member takes no throw and no pace, and has the breath and depth the imports give", () => {
  loadSwim();
  const row = swimRow({ encumbrance: 4, conMod: 2, speeds: { combat: 100 }, seat: JUDGE, member: { state: DROWNING, drownedRounds: 3 } });
  assert.deepEqual(row.refusal, { cls: REFUSAL.seat, reason: DROWNING });
  assert.deepEqual([row.can, row.plan, row.pace], [false, null, null]);
  assert.deepEqual(
    [row.drown.active, row.drown.rounds, row.drown.feetPerRound, row.drown.depthAtDeath, row.drown.elapsed, row.drown.left, row.drown.depth],
    [true, 19, 76, 19 * 76, 3, 16, 3 * 76],
  );
  assert.deepEqual(row.drown.parts, [{ key: "breath", value: 17 }, { key: "conMod", value: 2 }, { key: "encumbrance", value: 4 }, { key: "sink", value: 19 }]);
  // Breath runs out, and a breath is at least one round whatever the modifier.
  assert.equal(swimRow({ encumbrance: 4, conMod: 2, member: { state: DROWNING, drownedRounds: 40 } }).drown.left, 0);
  assert.equal(swimRow({ encumbrance: 4, conMod: -30, member: { state: DROWNING } }).drown.rounds, 1);
  // A member who is afloat has the same figures as what failing would cost, with no clock running.
  const afloat = swimRow({ encumbrance: 4, conMod: 2, seat: OWNER });
  assert.deepEqual([afloat.drown.active, afloat.drown.rounds, afloat.drown.elapsed, afloat.drown.left], [false, 19, 0, 19]);
});

await ok("drowning names each figure not imported on its own and reads null", () => {
  loadSwim({ ...SWIM, breathRounds: undefined });
  const row = swimRow({ encumbrance: 4, member: { state: DROWNING, drownedRounds: 2 } });
  assert.deepEqual([row.drown.rounds, row.drown.left, row.drown.depthAtDeath, row.drown.feetPerRound, row.drown.depth], [null, null, null, 76, 152]);
  assert.deepEqual(row.drown.unknown, ["breathRounds"]);
  loadSwim(null);
  const none = swimRow({ encumbrance: 4, member: { state: DROWNING, drownedRounds: 2 } });
  assert.deepEqual([none.drown.rounds, none.drown.feetPerRound, none.drown.left, none.drown.depth], [null, null, null, null]);
  assert.deepEqual(none.drown.unknown, ["breathRounds", "sinkFeetPerStone"]);
});

await ok("a drowning member's rescue lifts the body and a share of what they carry; nobody afloat has one", () => {
  loadSwim();
  const row = swimRow({ encumbrance: 10, member: { state: DROWNING } });
  assert.equal(row.rescue.stone, 23 + 10 * 0.4);
  assert.deepEqual(row.rescue.parts, [{ key: "body", value: 23 }, { key: "gear", value: 10 }, { key: "gearShare", value: 0.4 }]);
  assert.equal(swimRow({ encumbrance: 10, seat: OWNER }).rescue, null);
  loadSwim({ ...SWIM, carriedGearShare: undefined });
  const half = swimRow({ encumbrance: 10, member: { state: DROWNING } }).rescue;
  assert.deepEqual([half.stone, half.parts, half.unknown], [null, [], ["carriedGearShare"]]);
  loadSwim(null);
  assert.deepEqual(swimRow({ encumbrance: 10, member: { state: DROWNING } }).rescue.unknown, ["carriedBodyStone", "carriedGearShare"]);
});

await ok("a swimmer who is across or fell has nothing left to throw", () => {
  loadSwim();
  for (const state of SETTLED) assert.deepEqual(swimRow({ encumbrance: 4, seat: JUDGE, member: { state } }).refusal, { cls: REFUSAL.seat, reason: state });
});

// ---- the swimmer's round -------------------------------------------------------
const TURN = { combatId: "fightA", round: 3 };

await ok("a swimmer's drowning holds the drowning status, and a swimmer afloat holds none", () => {
  assert.deepEqual(heldAfter({ state: DROWNING }), ["drowning"]);
  assert.deepEqual(heldAfter({ state: "swimming" }), []);
  assert.deepEqual(heldAfter({ state: "climbing", vulnerable: true }), ["vulnerable"], "an obstacle's own hold is as it was");
});

await ok("a throw that makes its target keeps the swimmer afloat; one that misses starts one round of drowning", () => {
  const afloat = swimThrowStep({ member: { throws: 2 }, success: true, natural: 14, total: 14, turn: TURN });
  assert.deepEqual(afloat.set, { state: "swimming", throws: 3, last: { natural: 14, total: 14, success: true }, thrownAt: TURN });
  assert.deepEqual([afloat.unset, afloat.released], [[], null]);
  const sunk = swimThrowStep({ member: null, success: false, natural: 2, total: 2, turn: TURN });
  assert.deepEqual([sunk.set.state, sunk.set.drownedRounds, sunk.set.drownedAt, sunk.set.thrownAt], ["drowning", 1, TURN, TURN]);
  assert.ok(sunk.unset.includes("breathOut") && sunk.unset.includes("rescuer"));
  const outside = swimThrowStep({ member: null, success: false, turn: null });
  assert.deepEqual([outside.set.thrownAt, outside.set.drownedAt, outside.unset.includes("drownedAt")], [undefined, undefined, true], "no fight, no stamp");
});

await ok("a rescuer whose throw misses drops the body: the link goes and the body they held is named", () => {
  const dropped = swimThrowStep({ member: { hauling: "body7", throws: 0 }, success: false, turn: TURN });
  assert.equal(dropped.released, "body7");
  assert.ok(dropped.unset.includes("hauling"));
  assert.equal(swimThrowStep({ member: { hauling: "body7" }, success: true, turn: TURN }).released, null, "a rescuer who stays afloat keeps carrying");
});

await ok("a drowning member's turn counts one round, once for each round of a fight", () => {
  const drowning = { state: "drowning", drownedRounds: 1, drownedAt: { combatId: "fightA", round: 2 } };
  const tick = swimTick({ member: drowning, turn: TURN, rounds: 4 });
  assert.deepEqual([tick.set.drownedRounds, tick.set.drownedAt, tick.elapsed, tick.left, tick.breathOut], [2, TURN, 2, 2, false]);
  assert.equal(swimTick({ member: { ...drowning, drownedAt: TURN }, turn: TURN, rounds: 4 }), null, "the same round counts nothing");
  assert.equal(swimTick({ member: { ...drowning, drownedAt: TURN }, turn: { ...TURN, round: 2 }, rounds: 4 }), null, "a step back counts nothing");
  assert.equal(swimTick({ member: drowning, turn: null, rounds: 4 }), null, "outside a fight nothing counts");
  assert.equal(swimTick({ member: { state: "swimming" }, turn: TURN, rounds: 4 }), null, "a swimmer afloat has no count");
  assert.equal(swimTick({ member: { ...drowning, drownedAt: { combatId: "fightB", round: 9 } }, turn: TURN, rounds: 4 }).elapsed, 2, "another fight's stamp does not hold this one back");
});

await ok("the breath running out is reported on the round it does and not again; an unknown breath is never out", () => {
  const near = { state: "drowning", drownedRounds: 3, drownedAt: { combatId: "fightA", round: 2 } };
  const out = swimTick({ member: near, turn: TURN, rounds: 4 });
  assert.deepEqual([out.left, out.breathOut, out.set.breathOut], [0, true, true]);
  const later = swimTick({ member: { ...near, ...out.set }, turn: { ...TURN, round: 4 }, rounds: 4 });
  assert.deepEqual([later.left, later.breathOut], [0, false], "the count runs on and the report does not repeat");
  assert.equal(swimTick({ member: near, turn: TURN, rounds: null }).breathOut, false);
  assert.equal(swimTick({ member: near, turn: TURN, rounds: null }).left, null);
});

await ok("who may take a drowning member's weight, and what a haul to the surface clears", () => {
  const drowner = { actorId: "d", state: "drowning" };
  const free = { actorId: "r", state: "swimming" };
  assert.equal(rescueRefusal({ drowner, rescuer: free }), null);
  assert.equal(rescueRefusal({ drowner: { actorId: "d", state: "swimming" }, rescuer: free }), "notDrowning");
  assert.equal(rescueRefusal({ drowner, rescuer: { actorId: "d" } }), "self");
  assert.equal(rescueRefusal({ drowner, rescuer: { actorId: "r", state: "drowning" } }), "drowning");
  assert.equal(rescueRefusal({ drowner, rescuer: free, standing: "down" }), "standing");
  assert.equal(rescueRefusal({ drowner, rescuer: { ...free, hauling: "other" } }), "busy");
  assert.equal(rescueRefusal({ drowner, rescuer: { ...free, hauling: "d" } }), null, "the one they already carry is no other");
  const haul = haulStep({ rescuer: "r" });
  assert.deepEqual(haul.set, { state: "swimming", drownedRounds: 0 });
  assert.deepEqual([haul.unset, haul.released], [["rescuer", "drownedAt", "breathOut"], "r"]);
  assert.equal(haulStep({}).released, null);
});

await ok("a swim row takes the Judge's modifier on the target, a hauled body's stone, and refuses what has no figure", () => {
  loadSwim();
  assert.equal(swimRow({ encumbrance: 9, holds: false, judgeMod: 3, seat: OWNER }).target, 6);
  const hauling = swimRow({ encumbrance: 9, hauled: { stone: 5 }, seat: OWNER });
  assert.deepEqual([hauling.target, hauling.parts.at(-1)], [14, { key: "hauled", value: 5 }]);
  assert.equal(hauling.drown.feetPerRound, 14 * 19, "a rescuer sinks by what they and the body weigh");
  const unread = swimRow({ encumbrance: 9, hauled: { stone: null }, seat: JUDGE });
  assert.deepEqual([unread.target, unread.can, unread.refusal, unread.unknown], [null, false, { cls: REFUSAL.absence, reason: "rescue" }, ["carriedBodyStone"]]);
  const none = swimRow({ encumbrance: null, seat: JUDGE });
  assert.deepEqual([none.target, none.needed, none.can, none.refusal.reason, none.unknown], [null, null, false, "stone", ["encumbrance"]]);
});

await ok("a swimmer who has thrown this round has no throw left, for every seat; another round or fight has", () => {
  loadSwim();
  const member = { thrownAt: TURN };
  for (const seat of [JUDGE, OWNER]) {
    const row = swimRow({ encumbrance: 4, seat, turn: TURN, member });
    assert.deepEqual([row.can, row.refusal], [false, { cls: REFUSAL.seat, reason: "thrown" }]);
  }
  assert.equal(swimRow({ encumbrance: 4, seat: JUDGE, turn: { ...TURN, round: 4 }, member }).can, true);
  assert.equal(swimRow({ encumbrance: 4, seat: JUDGE, turn: { combatId: "fightB", round: 3 }, member }).can, true);
  assert.equal(swimRow({ encumbrance: 4, seat: JUDGE, turn: null, member }).can, true, "outside a fight a press is the Judge's to repeat");
});

// ---- the squeeze ------------------------------------------------------------
/** Invented figures for the squeeze; the printed ones arrive through the importer. */
const SQUEEZE = { contortionismBonus: 3, chokepointFeet: 6, escapeFeet: 8, escapePenaltyStep: 2, squeezeBotchBand: 2 };
const loadSqueeze = (tables = SQUEEZE) => {
  resetTables();
  if (tables) registerTable({ id: FORMATION_DOC, source: "invented", tables }, { priority: PRIORITY.WORLD, source: "test" });
};
const basher = { target: 14, parts: [{ label: "Dungeonbashing", value: 0 }] };
const stuckRecord = (extra = {}) => ({ state: "stuck", covered: 10, tries: 0, plight: 0, ...extra });
const cell = { base: 11 };

await ok("a squeezer's target is the stone carried, less Contortionism's figure for a holder and the Judge's modifier, and stuck is the fourth status held", () => {
  loadSqueeze();
  const plain = squeezeRow({ encumbrance: 7, shape: "chokepoint", seat: OWNER });
  assert.deepEqual([plain.target, plain.can, plain.plan], [7, true, { target: 7, needed: true, overRefusal: false }]);
  assert.deepEqual(plain.parts, [{ key: "encumbrance", value: 7 }]);
  const holder = squeezeRow({ encumbrance: 7, holds: true, judgeMod: 1, shape: "chokepoint", seat: OWNER });
  assert.deepEqual([holder.target, holder.parts], [3, [{ key: "encumbrance", value: 7 }, { key: "contortionism", value: -3 }, { key: "judge", value: -1 }]]);
  assert.deepEqual(CROSSING_STATUSES.slice(-1), ["stuck"], "a status is appended, since the slot is in the effect's id");
  assert.deepEqual([heldAfter({ state: "stuck" }), heldAfter({ state: "squeezing" })], [["stuck"], []]);
  assert.notEqual(crossingHeld("abc", "stuck").id, crossingHeld("abc", "drowning").id);
});

await ok("Contortionism is counted once per throw: it moves the squeeze and the push by its figure and the wiggle by none of it", () => {
  loadSqueeze();
  const row = (holds) => squeezeRow({ encumbrance: 5, holds, shape: "chokepoint", pushFigure: basher, save: cell, member: stuckRecord(), seat: JUDGE });
  const [held, plain] = [row(true), row(false)];
  assert.equal(squeezeRow({ encumbrance: 5, holds: false, shape: "chokepoint", seat: JUDGE }).target - squeezeRow({ encumbrance: 5, holds: true, shape: "chokepoint", seat: JUDGE }).target, 3, "the squeeze takes it once");
  assert.equal(plain.escape.push.target - held.escape.push.target, 3, "the push takes it once");
  assert.equal(held.escape.wiggle.target, plain.escape.wiggle.target, "the wiggle's save carries the ability's effect by the save's own route");
  assert.equal(held.escape.wiggle.parts.some((p) => p.key === "contortionism"), false);
  assert.equal(held.escape.push.parts.filter((p) => p.key === "contortionism").length, 1);
});

await ok("the push takes Strength through the one Dungeonbashing definition, on the push alone: a stronger member's target is lower by that figure, a weaker one's higher, and the squeeze and the wiggle never read it", () => {
  loadSqueeze();
  const row = (strMod) => squeezeRow({ encumbrance: 5, shape: "chokepoint", pushFigure: basher, save: cell, strMod, member: stuckRecord(), seat: JUDGE });
  const [none, strong, weak] = [row(0), row(2), row(-1)];
  assert.equal(none.escape.push.parts.some((p) => p.key === "strength"), false, "no modifier, no part");
  assert.equal(none.escape.push.target - strong.escape.push.target, bashStrBonus(2), "the push takes the bash's Strength");
  assert.equal(none.escape.push.target - weak.escape.push.target, bashStrBonus(-1));
  assert.deepEqual(strong.escape.push.parts.find((p) => p.key === "strength"), { key: "strength", value: -bashStrBonus(2), mod: 2 });
  assert.deepEqual([strong.target, strong.escape.wiggle.target], [none.target, none.escape.wiggle.target], "the squeezing throw and the wiggle read none of it");
});

await ok("a holder whose bonus is not imported has no squeeze or push target, for a Judge too; a non-holder is unaffected", () => {
  loadSqueeze({ ...SQUEEZE, contortionismBonus: undefined });
  const holder = squeezeRow({ encumbrance: 5, holds: true, shape: "chokepoint", pushFigure: basher, save: cell, member: stuckRecord(), seat: JUDGE });
  assert.deepEqual([holder.target, holder.can, holder.refusal, holder.unknown], [null, false, { cls: REFUSAL.absence, reason: "bonus" }, ["contortionismBonus"]]);
  assert.deepEqual([holder.escape.push.target, holder.escape.push.can], [null, false]);
  assert.equal(holder.escape.wiggle.can, true, "the wiggle reads no bonus of its own");
  assert.equal(squeezeRow({ encumbrance: 5, holds: false, shape: "chokepoint", seat: JUDGE }).target, 5);
});

await ok("a squeeze needs its length and a chokepoint does not; a chokepoint set at a squeeze's length stops a player and warns a Judge", () => {
  loadSqueeze();
  const blank = squeezeRow({ encumbrance: 4, shape: "squeeze", seat: JUDGE });
  assert.deepEqual([blank.target, blank.can, blank.refusal, blank.unknown], [null, false, { cls: REFUSAL.absence, reason: "length" }, ["length"]]);
  assert.equal(squeezeRow({ encumbrance: 4, shape: "squeeze", length: 20, seat: OWNER }).can, true);
  assert.equal(squeezeRow({ encumbrance: 4, shape: "chokepoint", seat: OWNER }).can, true);
  assert.equal(squeezeRow({ encumbrance: 4, shape: "chokepoint", length: 5, seat: OWNER }).can, true, "under the figure it is a chokepoint");
  const player = squeezeRow({ encumbrance: 4, shape: "chokepoint", length: 6, seat: OWNER });
  assert.deepEqual([player.refusal, player.can, player.warn], [{ cls: REFUSAL.permission, reason: "shape" }, false, false]);
  const judge = squeezeRow({ encumbrance: 4, shape: "chokepoint", length: 9, seat: JUDGE });
  assert.deepEqual([judge.can, judge.warn, judge.plan.overRefusal], [true, true, true]);
  loadSqueeze(null);
  assert.equal(squeezeRow({ encumbrance: 4, shape: "chokepoint", length: 99, seat: OWNER }).can, true, "no figure to compare with: the Judge's pick stands");
});

await ok("a creature whose stone nobody has gets no squeeze throw and no escape, whoever presses", () => {
  loadSqueeze();
  const row = squeezeRow({ encumbrance: null, shape: "chokepoint", pushFigure: basher, save: cell, member: stuckRecord(), seat: JUDGE });
  assert.deepEqual([row.target, row.can, row.escape.wiggle.can, row.escape.push.can, row.unknown], [null, false, false, false, ["encumbrance"]]);
  assert.deepEqual(row.refusal, { cls: REFUSAL.absence, reason: "stone" });
});

await ok("a monster's stone is the load it carries with a carrier's share, and a load nobody can read stays unknown and refuses every seat", () => {
  loadSqueeze();
  assert.deepEqual([monsterStone(4), monsterStone(4, 2.5), monsterStone(0, 3), monsterStone(null, 3), monsterStone(undefined), monsterStone(NaN, 1)], [4, 6.5, 3, null, null, null]);
  const unread = squeezeRow({ encumbrance: monsterStone(null), shape: "chokepoint", seat: JUDGE });
  assert.deepEqual([unread.target, unread.can, unread.refusal], [null, false, { cls: REFUSAL.absence, reason: "stone" }]);
  assert.deepEqual([squeezeRow({ encumbrance: monsterStone(4, 2), shape: "chokepoint", seat: JUDGE }).target], [6]);
});

await ok("a member who has thrown this round has no throw or escape left; another round has", () => {
  loadSqueeze();
  const member = { state: "squeezing", thrownAt: TURN };
  for (const seat of [JUDGE, OWNER]) {
    const row = squeezeRow({ encumbrance: 4, shape: "chokepoint", turn: TURN, seat, member });
    assert.deepEqual([row.can, row.refusal], [false, { cls: REFUSAL.seat, reason: "thrown" }]);
  }
  assert.equal(squeezeRow({ encumbrance: 4, shape: "chokepoint", turn: { ...TURN, round: 4 }, seat: OWNER, member }).can, true);
  const stuck = squeezeRow({ encumbrance: 4, shape: "chokepoint", pushFigure: basher, save: cell, turn: TURN, seat: OWNER, member: stuckRecord({ thrownAt: TURN }) });
  assert.deepEqual([stuck.escape.wiggle.can, stuck.escape.push.can], [false, false]);
});

await ok("a stuck member has the two escapes and no squeezing throw; one through has nothing left; a bystander has neither", () => {
  loadSqueeze();
  const stuck = squeezeRow({ encumbrance: 4, shape: "chokepoint", pushFigure: basher, save: cell, member: stuckRecord(), seat: OWNER });
  assert.deepEqual([stuck.can, stuck.escape.active, stuck.escape.can], [false, true, true]);
  assert.deepEqual([stuck.escape.wiggle.target, stuck.escape.push.target], [11 + 4, 14 + 4]);
  assert.deepEqual(stuck.escape.wiggle.plan, { target: 15, overRefusal: false, way: "wiggle" });
  const through = squeezeRow({ encumbrance: 4, shape: "chokepoint", pushFigure: basher, save: cell, member: { state: "across" }, seat: OWNER });
  assert.deepEqual([through.can, through.escape.can, through.refusal.reason], [false, false, "across"]);
  const stranger = squeezeRow({ encumbrance: 4, shape: "chokepoint", pushFigure: basher, save: cell, member: stuckRecord(), seat: OTHER });
  assert.deepEqual([stranger.escape.can, stranger.refusal.reason], [false, "notOwner"]);
});

await ok("a down member's escape is blocked for a player and warned for a Judge, whose plan goes ahead over the refusal", () => {
  loadSqueeze();
  const args = { encumbrance: 4, shape: "chokepoint", pushFigure: basher, save: cell, member: stuckRecord(), standing: "down" };
  const player = squeezeRow({ ...args, seat: OWNER });
  assert.deepEqual([player.escape.can, player.escape.warn], [false, false]);
  const judge = squeezeRow({ ...args, seat: JUDGE });
  assert.deepEqual([judge.escape.can, judge.escape.warn, judge.escape.push.plan.overRefusal], [true, true, true]);
});

await ok("each failed push adds the imported step to both escapes, a failed wiggle adds none, and a step nobody imported refuses the next attempt", () => {
  loadSqueeze();
  const args = { encumbrance: 4, shape: "chokepoint", pushFigure: basher, save: cell, seat: JUDGE };
  const fresh = squeezeRow({ ...args, member: stuckRecord() });
  const worse = squeezeRow({ ...args, member: stuckRecord({ plight: 2 }) });
  assert.deepEqual([worse.escape.push.target - fresh.escape.push.target, worse.escape.wiggle.target - fresh.escape.wiggle.target, worse.escape.penalty], [4, 4, 4]);
  assert.ok(worse.escape.push.parts.some((p) => p.key === "plight" && p.value === 4));
  loadSqueeze({ ...SQUEEZE, escapePenaltyStep: undefined });
  const owed = squeezeRow({ ...args, member: stuckRecord({ plight: 1 }) });
  assert.deepEqual([owed.escape.push.can, owed.escape.wiggle.can, owed.escape.penalty, owed.escape.push.unknown], [false, false, null, ["escapePenaltyStep"]]);
  assert.equal(squeezeRow({ ...args, member: stuckRecord() }).escape.push.can, true, "no failed push, no step owed");
});

await ok("an escape with no distance, no Dungeonbashing figure or no save cell is refused on that way alone", () => {
  loadSqueeze({ ...SQUEEZE, escapeFeet: undefined });
  const args = { encumbrance: 4, shape: "chokepoint", pushFigure: basher, save: cell, member: stuckRecord(), seat: JUDGE };
  const none = squeezeRow(args);
  assert.deepEqual([none.escape.wiggle.can, none.escape.push.can, none.escape.push.unknown], [false, false, ["escapeFeet"]]);
  loadSqueeze();
  const noFigure = squeezeRow({ ...args, pushFigure: null });
  assert.deepEqual([noFigure.escape.push.can, noFigure.escape.push.refusal.reason, noFigure.escape.wiggle.can], [false, "figure", true]);
  const noCell = squeezeRow({ ...args, save: { base: null } });
  assert.deepEqual([noCell.escape.wiggle.can, noCell.escape.wiggle.refusal.reason, noCell.escape.push.can], [false, "noCell", true]);
});

await ok("an unmodified result inside the imported band botches, and with no band imported nothing does", () => {
  loadSqueeze({ ...SQUEEZE, squeezeBotchBand: 2 });
  assert.deepEqual([1, 2, 3, null].map((n) => squeezeBotched(n)), [true, true, false, false]);
  loadSqueeze({ ...SQUEEZE, squeezeBotchBand: undefined });
  assert.equal(squeezeBotched(1), false);
  loadSqueeze(null);
  assert.equal(squeezeBotched(1), false);
});

await ok("a made throw clears a chokepoint or carries a squeezer by the advance to the length's end; a miss is no progress", () => {
  const cleared = squeezeThrowStep({ member: { throws: 1 }, success: true, natural: 9, total: 9, turn: TURN, chokepoint: true });
  assert.deepEqual([cleared.set.state, cleared.set.throws, cleared.set.thrownAt], ["across", 2, TURN]);
  const along = squeezeThrowStep({ member: { covered: 4 }, success: true, natural: 9, total: 9, length: 20, advance: 6 });
  assert.deepEqual([along.set.state, along.set.covered], ["squeezing", 10]);
  const end = squeezeThrowStep({ member: { covered: 18 }, success: true, length: 20, advance: 6 });
  assert.deepEqual([end.set.state, end.set.covered], ["across", 20]);
  const unknown = squeezeThrowStep({ member: { covered: 4 }, success: true, length: 20, advance: null });
  assert.deepEqual([unknown.set.state, unknown.set.covered], ["squeezing", 4], "an advance nobody knows carries nothing");
  const missed = squeezeThrowStep({ member: { covered: 4 }, success: false, natural: 3, total: 3, length: 20, advance: 6 });
  assert.deepEqual([missed.set.state, missed.set.covered, missed.set.last.success, missed.set.last.botch], ["squeezing", 4, false, false]);
});

await ok("a botched throw leaves the member stuck with no escape tried and no plight, whatever the total reached", () => {
  const stuck = squeezeThrowStep({ member: { covered: 4, tries: 3, plight: 2 }, success: true, botch: true, natural: 1, total: 20, length: 20, advance: 6 });
  assert.deepEqual([stuck.set.state, stuck.set.covered, stuck.set.tries, stuck.set.plight, stuck.set.last.success, stuck.set.last.botch], ["stuck", 4, 0, 0, false, true]);
});

await ok("a wiggle back that succeeds retreats the member and ends the condition; a miss counts a try and no plight", () => {
  const back = escapeStep({ member: stuckRecord({ covered: 10, tries: 2, plight: 1 }), way: "wiggle", success: true, natural: 15, total: 15, feet: 8, turn: TURN });
  assert.deepEqual([back.set.state, back.set.covered, back.set.thrownAt, back.unset], ["squeezing", 2, TURN, ["tries", "plight"]]);
  assert.equal(escapeStep({ member: stuckRecord({ covered: 3 }), way: "wiggle", success: true, feet: 8 }).set.covered, 0, "never past the start");
  const missed = escapeStep({ member: stuckRecord({ tries: 1, plight: 1 }), way: "wiggle", success: false, natural: 4, total: 4, feet: 8 });
  assert.deepEqual([missed.set.state, missed.set.tries, missed.set.plight, missed.unset], ["stuck", 2, 1, []]);
});

await ok("a push forward that succeeds advances the member, through at a chokepoint or the length's end; a miss worsens the plight by one step", () => {
  const along = escapeStep({ member: stuckRecord({ covered: 4 }), way: "push", success: true, length: 30, feet: 8 });
  assert.deepEqual([along.set.state, along.set.covered, along.unset], ["squeezing", 12, ["tries", "plight"]]);
  const end = escapeStep({ member: stuckRecord({ covered: 25 }), way: "push", success: true, length: 30, feet: 8 });
  assert.deepEqual([end.set.state, end.set.covered], ["across", 30]);
  assert.equal(escapeStep({ member: stuckRecord({ covered: 0 }), way: "push", success: true, chokepoint: true, feet: 8 }).set.state, "across");
  const missed = escapeStep({ member: stuckRecord({ tries: 1, plight: 1 }), way: "push", success: false, natural: 2, total: 2, feet: 8 });
  assert.deepEqual([missed.set.state, missed.set.tries, missed.set.plight], ["stuck", 2, 2]);
  assert.deepEqual([missed.set.last.kind, missed.set.last.success], ["push", false]);
});

// ---- a climber's pace ----------------------------------------------------------
const holder = (kind, extra = {}) => memberRow({ kind, holds: true, figure: climber, seat: JUDGE, feet: 100, ...extra });

await ok("a holder's pace raises the target by its imported size and the plan carries the pick", () => {
  load({ pace: PACES });
  const base = holder("sheerClimb");
  assert.deepEqual([base.target, base.plan.pace, base.plan.paceSize], [12, null, 0], "the base pace costs nothing");
  const faster = holder("sheerClimb", { member: { pace: "faster" } });
  assert.deepEqual([faster.target, faster.plan.target, faster.plan.pace, faster.plan.paceSize], [15, 15, "faster", 3]);
  const fastest = holder("sheerClimb", { member: { pace: "fastest" } });
  assert.deepEqual([fastest.target, fastest.plan.paceSize], [20, 8]);
  const modded = holder("sheerClimb", { member: { pace: "faster" }, judgeMod: 2 });
  assert.equal(modded.target, 13, "a Judge's bonus and the pace's penalty are both in the target: 12 - 2 + 3");
  // The throw reads the plan's target, so a roll that clears the base target and misses the pace's is a miss.
  assert.equal(readThrow({ plan: base.plan, natural: 13, total: 13 }).success, true);
  assert.equal(readThrow({ plan: faster.plan, natural: 13, total: 13 }).success, false);
});

await ok("each way of crossing prices its paces from its own pair, and a rappel prices none", () => {
  load({ pace: PACES });
  const sized = (kind) => [holder(kind, { member: { pace: "faster" } }).plan.paceSize, holder(kind, { member: { pace: "fastest" } }).plan.paceSize];
  assert.deepEqual(sized("easyClimb"), [3, 8]);
  assert.deepEqual(sized("sheerClimb"), [3, 8]);
  assert.deepEqual(sized("crawl"), [4, 9]);
  assert.deepEqual(sized("narrowLedge"), [6, 12]);
  assert.deepEqual(sized("precariousLedge"), [6, 12]);
  const rappel = holder("rappel", { member: { pace: "fastest" } });
  assert.deepEqual([rappel.pace.applies, rappel.target, rappel.plan.pace], [false, 12, null], "a rappel has no pace to price, so a stored pick is ignored");
  // A fixed rope makes a sheer climb the easy one, which is priced from the same pair.
  assert.equal(holder("sheerClimb", { ropeFixed: true, member: { pace: "fastest" } }).plan.paceSize, 8);
});

await ok("a member who holds no Climbing has no pace, whatever a record says", () => {
  load({ pace: PACES });
  const plain = memberRow({ kind: "easyClimb", figure: { target: 14, parts: [] }, seat: JUDGE, feet: 100, member: { pace: "fastest" } });
  assert.deepEqual([plain.pace.applies, plain.pace.pick, plain.target, plain.plan.paceSize], [false, null, 14, 0]);
  for (const seat of [JUDGE, OWNER]) {
    const asked = paceStep(memberRow({ kind: "easyClimb", figure: { target: 14, parts: [] }, seat, feet: 100 }).pace, "faster");
    assert.deepEqual([asked.can, asked.patch, asked.refusal.reason], [false, null, "paceNone"], `no pick for ${JSON.stringify(seat)}`);
  }
});

await ok("with no pair imported a holder has the base pace alone; a stored pick is refused as an absence for every seat", () => {
  load();
  const base = holder("sheerClimb");
  assert.deepEqual([base.pace.applies, base.pace.options, base.pace.penalty, base.target, base.can], [true, [], 0, 12, true]);
  assert.equal(paceStep(base.pace, "faster").refusal.reason, "pace", "an unpriced pace is refused");
  for (const seat of [JUDGE, OWNER]) {
    const row = holder("sheerClimb", { seat, member: { pace: "faster" } });
    assert.deepEqual(row.refusal, { cls: REFUSAL.absence, reason: "pace" }, JSON.stringify(seat));
    assert.deepEqual([row.can, row.warn, row.plan, row.unknown, row.pace.penalty], [false, false, null, ["pace"], null]);
  }
  assert.deepEqual(paceStep(holder("sheerClimb", { member: { pace: "faster" } }).pace, "").patch, { unset: ["pace"] }, "a stale pick can still be put back to the base pace");
});

await ok("a pair with one size imported prices that pace alone", () => {
  load({ pace: { climbPacePenalties: [3] } });
  const row = holder("sheerClimb");
  assert.deepEqual(row.pace.options, [{ id: "faster", penalty: 3 }]);
  assert.equal(paceStep(row.pace, "fastest").refusal.reason, "pace");
  load({ pace: { climbPacePenalties: [0, "x"] } });
  assert.deepEqual(holder("sheerClimb").pace.options, [], "a size that is no positive number is not a size");
  load({ pace: { climbPacePenalties: "3,8" } });
  assert.deepEqual(holder("sheerClimb").pace.options, [], "a pair that is no list is not read");
});

/** The paces' speeds, invented and told apart per way of crossing. */
const RATES = {
  climbPaceRates: { normal: { share: 1, speed: "exploration" }, faster: { share: 0.2, speed: "combat" }, fastest: { share: 0.7, speed: "combat" } },
  crawlPaceRates: { normal: { share: 1, speed: "exploration" }, faster: { share: 0.3, speed: "run" }, fastest: { share: 1, speed: "run" } },
  balancePaceRates: { normal: { share: 1, speed: "exploration" }, faster: { share: 0.4, speed: "run" }, fastest: { share: 0.9, speed: "run" } },
};

await ok("paceRates answers each way of crossing from its own table, and none for an obstacle that prices no pace", () => {
  load({ pace: RATES });
  assert.deepEqual(paceRates("easyClimb"), RATES.climbPaceRates);
  assert.deepEqual(paceRates("sheerClimb"), RATES.climbPaceRates);
  assert.deepEqual(paceRates("crawl"), RATES.crawlPaceRates);
  assert.deepEqual(paceRates("narrowLedge"), RATES.balancePaceRates);
  assert.deepEqual(paceRates("precariousLedge"), RATES.balancePaceRates);
  assert.equal(paceRates("rappel"), null, "a rappel prints no pace's speed");
  assert.equal(paceRates("nowhere"), null);
  assert.deepEqual(Object.keys(PACE_RATE_TABLE), Object.keys(PACE_TABLE), "the rates and the penalties price the same obstacles");
  assert.deepEqual([...PACE_SPEEDS], ["exploration", "combat", "run"]);
});

await ok("with nothing imported every pace's rate reads null", () => {
  resetTables();
  assert.deepEqual(paceRates("sheerClimb"), { normal: null, faster: null, fastest: null });
  load({ pace: PACES });
  assert.deepEqual(paceRates("sheerClimb"), { normal: null, faster: null, fastest: null }, "the penalties are not the rates");
});

await ok("a rate is one share of a named speed, and a Judge's override counts only as such", () => {
  load({ pace: { climbPaceRates: { normal: { share: "0.5", speed: "exploration" }, faster: { share: 0, speed: "run" }, fastest: { share: 0.7, speed: "swim" } } } });
  const rates = paceRates("easyClimb");
  assert.deepEqual(rates.normal, { share: 0.5, speed: "exploration" }, "a share typed as text is read as a number");
  assert.equal(rates.faster, null, "a share of nothing is no share");
  assert.equal(rates.fastest, null, "a speed the module does not name is no speed");
  for (const bad of [{ share: -1, speed: "run" }, { share: "", speed: "run" }, { share: "x", speed: "run" }, { share: 1 }, { speed: "run" }, 3, "run", null, []]) {
    load({ pace: { crawlPaceRates: { faster: bad } } });
    assert.equal(paceRates("crawl").faster, null, JSON.stringify(bad));
  }
  load({ pace: { climbPaceRates: "combat" } });
  assert.deepEqual(paceRates("easyClimb"), { normal: null, faster: null, fastest: null }, "a table that is no object reads none");
  load({ pace: { climbPaceRates: { faster: { share: 0.2, speed: "combat" } } } });
  assert.deepEqual(paceRates("easyClimb"), { normal: null, faster: { share: 0.2, speed: "combat" }, fastest: null }, "a pace reads on its own");
  assert.equal(paceRates("crawl").faster, null, "and another way of crossing's table is its own");
});

await ok("a pick is for a member the seat owns who can still be moved: a player is blocked where a Judge is warned", () => {
  load({ pace: PACES });
  const ask = (seat, extra) => paceStep(holder("sheerClimb", { seat, ...extra }).pace, "faster");
  const downPlayer = ask(OWNER, { standing: "down" });
  assert.deepEqual([downPlayer.can, downPlayer.patch, downPlayer.refusal.reason], [false, null, "down"]);
  const downJudge = ask(JUDGE, { standing: "down" });
  assert.deepEqual([downJudge.can, downJudge.warn, downJudge.refusal.reason, downJudge.patch], [true, true, "down", { set: { pace: "faster" } }]);
  const stalledJudge = ask(JUDGE, { member: { state: "stalled" } });
  assert.deepEqual([stalledJudge.can, stalledJudge.warn], [true, true]);
  assert.deepEqual([ask(OWNER, { member: { state: "stalled" } }).can, ask(OTHER, {}).refusal.reason], [false, "notOwner"], "a seat that does not own the member is refused");
  for (const seat of [JUDGE, OWNER]) {
    const over = ask(seat, { member: { state: "across" } });
    assert.deepEqual([over.can, over.warn], [false, false], "a member whose crossing is over has no pace to pick, for any seat");
  }
  const clear = ask(OWNER, {});
  assert.deepEqual([clear.can, clear.warn, clear.refusal], [true, false, null]);
});

await ok("a pick is one of the closed set: anything else is refused, and the base pace is written as a removal", () => {
  load({ pace: PACES });
  const row = holder("sheerClimb").pace;
  for (const bad of ["hasty", "__proto__", "FASTER", 3, {}]) {
    assert.deepEqual([paceStep(row, bad).patch, paceStep(row, bad).refusal.reason], [null, "paceOption"], String(bad));
  }
  for (const base of ["", "normal", null, undefined]) assert.deepEqual(paceStep(row, base).patch, { unset: ["pace"] }, String(base));
  assert.deepEqual(paceStep(row, "fastest").patch, { set: { pace: "fastest" } });
  assert.equal(paceRow({ kind: "sheerClimb", holds: true, pick: "hasty" }).pick, null, "a stored pick outside the set reads as the base pace");
});

await ok("a throw's step leaves the record's pace alone to carry on: the step is the record's own keys only", () => {
  load({ pace: PACES });
  const row = holder("sheerClimb", { member: { pace: "faster" } });
  const read = readThrow({ plan: row.plan, natural: 19, total: 19 });
  const stepped = stepMember({ member: { pace: "faster" }, stretches: 3, read, natural: 19, total: 19 });
  assert.equal(Object.keys(stepped).includes("pace"), false, "the step names no pace, so the dotted-path write beside it never touches the pick");
  assert.equal(stepped.state, "climbing");
});

// ---- the rounds a crossing spends ----------------------------------------------
/** A member's speeds, invented: exploration per turn (nine feet a round), combat and run per round. */
const SPEEDS = { exploration: 90, combat: 30, run: 60 };
/** The grid's own rows for a rope's descent, invented; no other way of crossing has one. */
const PROGRESS = {
  rappel: { success: { share: 0.6, speed: "combat" }, fail: { share: 0.25, speed: "run" } },
  easyClimb: { success: { share: 0.5, speed: "run" } },
};
const withProgress = (extra = {}) => load({ spelunking: { ...SPELUNKING, progress: PROGRESS }, pace: RATES, ...extra });

await ok("stretchFeetAt: the stretch, then what is left of the length from the stretches covered, and none for a blank length", () => {
  load();
  assert.equal(stretchFeetAt({ length: 100, covered: 0 }), 40);
  assert.equal(stretchFeetAt({ length: 100, covered: 1 }), 40);
  assert.equal(stretchFeetAt({ length: 100, covered: 2 }), 20, "the last stretch is the short one");
  assert.equal(stretchFeetAt({ length: 100, covered: 3 }), 0, "nothing is left past the length");
  assert.equal(stretchFeetAt({ length: "30" }), 30, "a length under one stretch is that length");
  for (const blank of [null, undefined, "", " ", 0, -5, "far"]) assert.equal(stretchFeetAt({ length: blank, covered: 0 }), null, JSON.stringify(blank));
  load({ spelunking: { adventuring: SPELUNKING.adventuring } });
  assert.equal(stretchFeetAt({ length: 100, covered: 0 }), null, "no stretch is imported");
});

await ok("pressRate: the base pace moves at the exploration branch, a faster pace at its own cell, each way of crossing from its own table", () => {
  withProgress();
  assert.deepEqual(pressRate({ kind: "sheerClimb", speeds: SPEEDS }), { share: 1, speed: "exploration", perRound: 9 }, "exploration is per turn, so ten rounds divide it");
  assert.deepEqual(pressRate({ kind: "sheerClimb", pace: "faster", speeds: SPEEDS }), { share: 0.2, speed: "combat", perRound: 6 });
  assert.deepEqual(pressRate({ kind: "sheerClimb", pace: "fastest", speeds: SPEEDS }), { share: 0.7, speed: "combat", perRound: 21 });
  assert.deepEqual(pressRate({ kind: "crawl", pace: "faster", speeds: SPEEDS }), { share: 0.3, speed: "run", perRound: 18 }, "the crawl's table, not the climb's");
  assert.equal(pressRate({ kind: "narrowLedge", pace: "fastest", speeds: SPEEDS }).perRound, 54);
  assert.deepEqual(pressRate({ kind: "sheerClimb", pace: "hasty", speeds: SPEEDS }), pressRate({ kind: "sheerClimb", speeds: SPEEDS }), "a pick outside the set is the base pace");
  assert.equal(pressRate({ kind: "easyClimb", speeds: SPEEDS }).speed, "exploration", "a grid row for the climb does not replace its pace's");
});

await ok("pressRate: a rope's descent reads the grid's success row, and an advancing miss its failed-throw row", () => {
  withProgress();
  assert.deepEqual(pressRate({ kind: "rappel", speeds: SPEEDS }), { share: 0.6, speed: "combat", perRound: 18 });
  assert.deepEqual(pressRate({ kind: "rappel", advance: "fail", speeds: SPEEDS }), { share: 0.25, speed: "run", perRound: 15 });
  assert.equal(pressRate({ kind: "easyClimb", advance: "fail", speeds: SPEEDS }), null, "an obstacle whose grid prints no failed-throw row has none");
});

await ok("pressRate: a miss that covers no ground costs the outcome's imported duration, and nothing without one", () => {
  withProgress();
  assert.deepEqual(pressRate({ kind: "sheerClimb", advance: "miss", outcome: { text: "x", rounds: 3 } }), { rounds: 3 });
  for (const outcome of [null, { text: "x" }, { text: "x", rounds: 0 }, { text: "x", rounds: -1 }, { text: "x", rounds: "soon" }]) {
    assert.equal(pressRate({ kind: "sheerClimb", advance: "miss", outcome }), null, JSON.stringify(outcome));
  }
});

await ok("pressRate: nothing imported or no speed known is no rate, and no figure stands in for it", () => {
  load({ spelunking: { ...SPELUNKING, progress: { sheerClimb: { success: { share: 0.6, speed: "combat" } } } } });
  assert.equal(pressRate({ kind: "sheerClimb", speeds: SPEEDS }), null, "the grid's row is not the base pace's rate");
  withProgress();
  assert.equal(pressRate({ kind: "sheerClimb", speeds: { combat: 30, run: 60 } }), null, "no exploration speed");
  assert.equal(pressRate({ kind: "sheerClimb", speeds: { ...SPEEDS, exploration: 0 } }), null, "a speed of nothing");
  assert.equal(pressRate({ kind: "sheerClimb", pace: "faster", speeds: { exploration: 90 } }), null, "no combat speed");
  load({ spelunking: { ...SPELUNKING, progress: PROGRESS }, pace: { climbPaceRates: { normal: { share: 1, speed: "exploration" } } } });
  assert.equal(pressRate({ kind: "sheerClimb", pace: "faster", speeds: SPEEDS }), null, "a pace nobody imported");
  assert.equal(pressRate({ kind: "rappel", speeds: undefined }), null, "no speeds at all");
});

/** One throw's answer as `pressRounds` reads it. */
const stepFrom = (before, state, covered) => ({ stepped: { state, covered }, before });

await ok("pressRounds: a made stretch is its feet over the rate, the last stretch only what is left, a fall spends none", () => {
  withProgress();
  const made = { success: true, outcome: "progress" };
  const at = (before, covered = before + 1, extra = {}) => pressRounds({ kind: "sheerClimb", speeds: SPEEDS, length: 100, read: made, ...stepFrom(before, "climbing", covered), ...extra });
  assert.equal(at(0).rounds, 40 / 9);
  assert.deepEqual(at(0).part, { rounds: 40 / 9, feet: 40, share: 1, speed: "exploration" });
  assert.equal(at(2, 3, {}).rounds, 20 / 9, "the stretch left, from the stretches covered before the throw");
  assert.equal(at(0, 1, { pace: "fastest" }).rounds, 40 / 21);
  const fell = pressRounds({ kind: "sheerClimb", speeds: SPEEDS, length: 100, read: { success: false, outcome: { falls: true, text: "x", rounds: 4 } }, ...stepFrom(1, "fell", 1) });
  assert.deepEqual(fell, { rounds: 0, part: null }, "a fall spends none, whatever duration its outcome carries");
  assert.deepEqual(at(0, 1, { length: "" }), { rounds: null, part: null }, "a blank length spends nothing");
  assert.deepEqual(at(0, 1, { speeds: {} }), { rounds: null, part: null }, "a speed nobody knows spends nothing");
});

await ok("pressRounds: a miss that covers ground is the failed-throw row, one that covers none its outcome's duration", () => {
  withProgress();
  const miss = (outcome) => ({ success: false, outcome });
  const advancing = pressRounds({ kind: "rappel", speeds: SPEEDS, length: 100, read: miss({ text: "x", advances: true }), ...stepFrom(0, "climbing", 1) });
  assert.equal(advancing.rounds, 40 / 15, "the rappel's failed-throw row, not its success row");
  const stalled = pressRounds({ kind: "sheerClimb", speeds: SPEEDS, length: 100, read: miss({ text: "x", advances: false, rounds: 3 }), ...stepFrom(0, "stalled", 0) });
  assert.deepEqual(stalled, { rounds: 3, part: { rounds: 3, miss: true } });
  const unsaid = pressRounds({ kind: "sheerClimb", speeds: SPEEDS, length: 100, read: miss({ text: "x", advances: false }), ...stepFrom(0, "stalled", 0) });
  assert.deepEqual(unsaid, { rounds: null, part: null }, "a duration nobody imported spends nothing");
});

await ok("timedStep grows the member's elapsed time to the precision kept and appends the press's working; a press that spent nothing writes nothing", () => {
  const spent = { rounds: 1 / 3, part: { rounds: 1 / 3, feet: 40, share: 1, speed: "exploration" } };
  const first = timedStep(null, spent);
  assert.equal(first.elapsed, 0.333333);
  assert.deepEqual(first.timed, [{ rounds: 0.333333, feet: 40, share: 1, speed: "exploration" }]);
  const second = timedStep(first, spent);
  assert.equal(second.elapsed, 0.666666);
  assert.equal(second.timed.length, 2);
  assert.equal(timedStep(first, { rounds: null, part: null }), null);
  assert.equal(timedStep(first, { rounds: 0, part: null }), null, "a fall");
  assert.deepEqual(first.timed.length, 1, "the record it was given is not changed");
});

await ok("crossingElapsed is the slowest member's time, counted once, and not the sum", () => {
  assert.equal(crossingElapsed({ a: { elapsed: 3 }, b: { elapsed: 5.5 }, c: { state: "climbing" } }), 5.5);
  assert.equal(crossingElapsed([{ elapsed: 2 }, { elapsed: 2 }]), 2, "equal times overlap");
  assert.equal(crossingElapsed({ a: { elapsed: "x" }, b: { elapsed: -3 } }), 0, "a figure that is no time counts none");
  for (const none of [null, undefined, {}, []]) assert.equal(crossingElapsed(none), 0);
});

await ok("roundsDue rounds up the whole total and not each stretch, forgives a millionth, and never takes back", () => {
  assert.deepEqual(roundsDue(1.2 + 1.2, 0), { due: 3, billed: 3 }, "2.4 rounds is 3, where each stretch rounded up would be 4");
  assert.deepEqual(roundsDue(5, 0), { due: 5, billed: 5 });
  assert.deepEqual(roundsDue(5.5, 3), { due: 3, billed: 6 }, "what is billed is deducted");
  assert.deepEqual(roundsDue(3.0000004, 3), { due: 0, billed: 3 }, "a figure within a millionth over a whole round does not owe the next");
  assert.deepEqual(roundsDue(3.000002, 3), { due: 1, billed: 4 });
  assert.deepEqual(roundsDue(1, 3), { due: 0, billed: 3 }, "the count only grows when the elapsed time falls");
  assert.deepEqual(roundsDue(0, 0), { due: 0, billed: 0 });
  assert.deepEqual(roundsDue(undefined, undefined), { due: 0, billed: 0 });
  assert.deepEqual(roundsDue(1 / 3 + 1 / 3 + 1 / 3, 0), { due: 1, billed: 1 }, "thirds that sum a hair over one are one round");
});

console.log(`\ntest-crossing: all ${passed} checks passed`);
