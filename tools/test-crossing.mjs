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
  DROWNING, fallFromClimb, fallFromDepth, heldAfter, isHanging, haulStep, jumpResult, jumpRow, landingOutcome, landingRow, memberRow, rescueRefusal, stepMember, swimRow, swimThrowStep, swimTick, withFooting,
} from "../scripts/formation/crossing-logic.mjs";
import { ownSwimSpeed } from "../scripts/formation/swimming.mjs";

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

const load = ({ spelunking = SPELUNKING, outcomes = OUTCOMES, jumping = JUMPING, fall = FALL } = {}) => {
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
  assert.deepEqual(CROSSING_STATUSES, ["vulnerable", "drowning"]);
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

console.log(`\ntest-crossing: all ${passed} checks passed`);
