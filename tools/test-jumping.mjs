/**
 * Jumping and leaping: the procedure runs on whatever the `jumping` and `fall`
 * tables hold, and answers null with the missing figure named when they hold
 * nothing. Every figure here is invented; the printed ones arrive through the
 * importer.
 */
import assert from "node:assert/strict";
import { registerTable, resetTables, PRIORITY } from "../scripts/lib/tables.mjs";
import { FORMATION_DOC } from "../scripts/formation/constants.mjs";
import {
  NO_ACROBATICS, canClear, dexModifier, effectiveDex, fallFigures, feetPerStone, jumpDistance, jumpFaces,
  landingFailure, landingSave, leapHeight, leapMinimum, leapPlus, partyJump, runningStartFeet,
  shortfallDie, standingShare, creatureSpeedBase, creatureDex,
} from "../scripts/formation/jumping.mjs";

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok   " + name); };

/** Invented figures for the `jumping` and `fall` tables. */
const JUMPING = {
  leapPlus: 3, leapMinimum: 2, jumpDie: "1d8", feetPerStone: 4, runUpFeet: 15,
  standingShare: 0.25, creatureSpeedBase: 100, creatureDex: 10, shortfallDie: "1d3",
};
const FALL = { die: "1d4", feetPerDie: 7 };

const load = (jumping = JUMPING, fall = FALL) => registerTable(
  { id: FORMATION_DOC, source: "invented", tables: { ...(jumping && { jumping }), ...(fall && { fall }) } },
  { priority: PRIORITY.WORLD, source: "test" },
);

// ---- nothing imported -------------------------------------------------------
ok("with nothing imported every figure reads null", () => {
  resetTables();
  for (const read of [leapPlus, leapMinimum, feetPerStone, runningStartFeet, standingShare, creatureSpeedBase,
    creatureDex, jumpFaces, shortfallDie, fallFigures]) {
    assert.equal(read(), null, read.name);
  }
});

ok("a leap on nothing imported has no height and names both figures", () => {
  resetTables();
  const leap = leapHeight({ mod: 2 });
  assert.equal(leap.feet, null);
  assert.deepEqual(leap.unknown, ["leapPlus", "leapMinimum"]);
});

ok("a jump on nothing imported has no range and names what it rests on", () => {
  resetTables();
  const jump = jumpDistance({ dex: 12 });
  assert.equal(jump.min, null);
  assert.equal(jump.max, null);
  assert.deepEqual(jump.unknown, ["jumpDie"]);
  assert.deepEqual(jumpDistance({}).unknown, ["creatureDex", "jumpDie"]);
});

ok("a jump nobody can price is a fourth answer, not a guess", () => {
  resetTables();
  const got = canClear(10, { dex: 12 });
  assert.equal(got.verdict, "unknown");
  assert.equal(got.clearing, null);
  assert.deepEqual(got.unknown, ["jumpDie"]);
});

ok("a failed landing with nothing imported names the table it lacks", () => {
  resetTables();
  assert.deepEqual(landingFailure("solid"), { outcome: "prone", shortBy: null, damage: null, unknown: ["shortfallDie"] });
  assert.deepEqual(landingFailure("empty", 30).unknown, ["shortfallDie", "fall"]);
  assert.equal(landingFailure("empty", 30).damage, null);
});

// ---- the leap ---------------------------------------------------------------
ok("a leap is the bonus plus the constant, held to the floor", () => {
  load();
  assert.equal(leapHeight({ mod: 2 }).feet, 5);
  assert.equal(leapHeight({ mod: -4 }).feet, 2);
  assert.deepEqual(leapHeight({ mod: 2 }).unknown, []);
  resetTables();
});

ok("a leap's conditions come off in the order the procedure runs them", () => {
  load();
  assert.equal(leapHeight({ mod: 2, encumbrance: 1 }).feet, 1);
  assert.equal(leapHeight({ mod: 2, encumbrance: 3 }).feet, 0, "never a negative distance");
  assert.equal(leapHeight({ mod: 2, runningStart: false }).feet, 1.25);
  assert.equal(leapHeight({ mod: 2, runSpeed: 50 }).feet, 2.5);
  assert.equal(leapHeight({ mod: 2, encumbrance: 1, runningStart: false, runSpeed: 50 }).feet, 0.125);
  resetTables();
});

ok("a condition whose figure is not imported blanks the answer and only that one", () => {
  const { feetPerStone: _unused, ...withoutStone } = JUMPING;
  load(withoutStone);
  assert.equal(leapHeight({ mod: 2 }).feet, 5, "no encumbrance, so the rate is not needed");
  const loaded = leapHeight({ mod: 2, encumbrance: 1 });
  assert.equal(loaded.feet, null);
  assert.deepEqual(loaded.unknown, ["feetPerStone"]);
  resetTables();
});

// ---- the jump ---------------------------------------------------------------
ok("a jump is a score plus the die, reported as a range", () => {
  load();
  const jump = jumpDistance({ dex: 12 });
  assert.equal(jump.min, 13);
  assert.equal(jump.max, 20);
  assert.equal(jump.average, 16.5);
  assert.equal(jump.die, "1d8");
  resetTables();
});

ok("a jump's conditions scale the whole range", () => {
  load();
  assert.equal(jumpDistance({ dex: 12, encumbrance: 1 }).min, 9);
  assert.equal(jumpDistance({ dex: 12, runningStart: false }).min, 3.25);
  assert.equal(jumpDistance({ dex: 12, runSpeed: 200 }).max, 40);
  resetTables();
});

ok("a score nobody wrote down is the imported creature score", () => {
  load();
  assert.equal(effectiveDex({}), 10);
  assert.equal(jumpDistance({}).min, 11);
  resetTables();
});

ok("Acrobatics adds level to the score and stops at the cap the ability supplies", () => {
  load();
  assert.equal(effectiveDex({ dex: 13, acrobatics: true, level: 5 }), 18);
  assert.equal(effectiveDex({ dex: 16, acrobatics: true, level: 14, dexCap: 24 }), 24);
  assert.equal(effectiveDex({ dex: 16, acrobatics: true, level: 14 }), 30, "no cap is invented");
  assert.equal(NO_ACROBATICS.saveBonus, 0);
  resetTables();
});

ok("the die is one die, and a Judge's override of another shape is no die", () => {
  for (const [jumpDie, faces] of [["1d8", 8], [" 1 D 6 ", 6], ["2d6", null], ["a handful", null], ["1d0", null], [null, null]]) {
    load({ ...JUMPING, jumpDie });
    assert.equal(jumpFaces(), faces, String(jumpDie));
    resetTables();
  }
});

ok("a share is a fraction above nothing, and a figure outside it is not imported", () => {
  for (const [share, want] of [[0.25, 0.25], [1, 1], [0, null], [5, null], ["half", null]]) {
    load({ ...JUMPING, standingShare: share });
    assert.equal(standingShare(), want, String(share));
    resetTables();
  }
});

ok("a rate of nothing is not a rate", () => {
  load({ ...JUMPING, feetPerStone: 0, runUpFeet: "", creatureSpeedBase: -5 });
  assert.equal(feetPerStone(), null);
  assert.equal(runningStartFeet(), null);
  assert.equal(creatureSpeedBase(), null);
  resetTables();
});

// ---- clearing a gap ---------------------------------------------------------
ok("a gap is certain, a chance or impossible, and a chance has a size", () => {
  load();
  assert.equal(canClear(10, { dex: 12 }).verdict, "certain");
  const chance = canClear(15, { dex: 12 });
  assert.equal(chance.verdict, "chance");
  assert.equal(chance.clearing, 6);
  assert.equal(chance.faces, 8);
  assert.equal(canClear(21, { dex: 12 }).verdict, "impossible");
  resetTables();
});

ok("a party is read member by member against one gap", () => {
  load();
  const got = partyJump([{ name: "Ayla", dex: 12 }, null, { name: "Brun", dex: 9, encumbrance: 2 }], 12);
  assert.deepEqual(got.map((m) => [m.name, m.verdict]), [["Ayla", "certain"], ["Brun", "impossible"]]);
  resetTables();
});

// ---- the landing ------------------------------------------------------------
ok("a failed landing falls short by the imported die, and the ground decides the rest", () => {
  load();
  assert.deepEqual(landingFailure("solid"), { outcome: "prone", shortBy: "1d3", damage: null, unknown: [] });
  assert.equal(landingFailure("edge").outcome, "hanging");
  assert.deepEqual(landingFailure("empty", 30), { outcome: "fall", shortBy: "1d3", damage: "4d4", unknown: [] });
  assert.equal(landingFailure("empty", 6).damage, null, "too short a fall to deal a die");
  assert.deepEqual(landingFailure("empty", 6).unknown, []);
  resetTables();
});

ok("the fall pair is read whole or not at all", () => {
  load(JUMPING, { die: "1d4" });
  assert.equal(fallFigures(), null);
  load(JUMPING, { die: "2d6", feetPerDie: 10 });
  assert.deepEqual(fallFigures(), { count: 2, faces: 6, feetPerDie: 10 });
  assert.equal(landingFailure("empty", 20).damage, "4d6");
  resetTables();
});

ok("the landing save is owed only where the ground or the charge asks for it", () => {
  assert.equal(landingSave({}).needed, false);
  assert.equal(landingSave({ precarious: true }).needed, true);
  assert.equal(landingSave({ charging: true }).save, "paralysis");
  assert.equal(landingSave({ precarious: true, acrobatics: true, saveBonus: 3 }).bonus, 3);
  assert.equal(landingSave({ precarious: true, saveBonus: 3 }).bonus, 0);
});

ok("the modifier is the sheet's, and an extended one wins", () => {
  assert.equal(dexModifier({ mod: 2 }), 2);
  assert.equal(dexModifier({}), 0);
  assert.equal(dexModifier({ mod: 3, extended: 5 }), 5);
  assert.equal(dexModifier({ mod: 3, extended: 0 }), 0);
});

console.log(`test-jumping: all ${passed} checks passed`);
