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
import { canClear } from "../scripts/formation/jumping.mjs";
import {
  CLIMB_CHECK, CROSSING_STATUSES, FOOTINGS, REFUSAL, SETTLED, crossingHeld, crossingOfHolder, fallFromClimb, heldAfter, jumpRow,
  landingOutcome, landingRow, memberRow, stepMember,
} from "../scripts/formation/crossing-logic.mjs";

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
  assert.deepEqual(CROSSING_STATUSES, ["vulnerable"]);
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

console.log(`\ntest-crossing: all ${passed} checks passed`);
