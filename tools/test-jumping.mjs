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
  NO_ACROBATICS, acrobaticsDexCap, canClear, dexModifier, effectiveDex, extendedDexBands, fallFigures, feetPerStone,
  jumpDistance, jumpFaces, landingFailure, landingSave, leapHeight, leapMinimum, leapPlus, partyJump, runningStartFeet,
  scoreModifier, shortfallDie, standingShare, creatureSpeedBase, creatureDex,
} from "../scripts/formation/jumping.mjs";

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok   " + name); };

/** Invented figures for the `jumping` and `fall` tables. */
const JUMPING = {
  leapPlus: 3, leapMinimum: 2, jumpDie: "1d8", feetPerStone: 4, runUpFeet: 15,
  standingShare: 0.25, creatureSpeedBase: 100, creatureDex: 10, shortfallDie: "1d3",
};
const FALL = { die: "1d4", feetPerDie: 7 };

/** Invented Acrobatics figures: a ceiling and two bands, with a gap above them. */
const ACROBAT = { acrobaticsDexCap: 23, extendedDexBands: [{ min: 19, max: 21, mod: 7 }, { min: 22, max: 23, mod: 9 }] };

/** An invented system attribute table, for a score below the bands. */
const withSystemTable = (fn) => {
  globalThis.CONFIG = { Actor: { dataModels: { character: { getAttributeModifier: (s) => (s >= 13 ? 2 : 0) } } } };
  try { fn(); } finally { delete globalThis.CONFIG; }
};

const load = (jumping = JUMPING, fall = FALL) => registerTable(
  { id: FORMATION_DOC, source: "invented", tables: { ...(jumping && { jumping }), ...(fall && { fall }) } },
  { priority: PRIORITY.WORLD, source: "test" },
);

// ---- nothing imported -------------------------------------------------------
ok("with nothing imported every figure reads null", () => {
  resetTables();
  for (const read of [leapPlus, leapMinimum, feetPerStone, runningStartFeet, standingShare, creatureSpeedBase,
    creatureDex, acrobaticsDexCap, extendedDexBands, jumpFaces, shortfallDie, fallFigures]) {
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

ok("Acrobatics adds level to the score and stops at the cap, the caller's or the imported one", () => {
  load({ ...JUMPING, ...ACROBAT });
  assert.equal(effectiveDex({ dex: 13, acrobatics: true, level: 5 }), 18);
  assert.equal(effectiveDex({ dex: 16, acrobatics: true, level: 14 }), 23, "the imported cap");
  assert.equal(effectiveDex({ dex: 16, acrobatics: true, level: 14, dexCap: 20 }), 20, "the caller's cap wins");
  assert.equal(effectiveDex({ dex: 16, level: 14 }), 16, "no Acrobatics, no raise");
  assert.equal(NO_ACROBATICS.saveBonus, 0);
  resetTables();
});

ok("a raise with no cap to hold it to is no score, and the cap is named", () => {
  load();
  assert.equal(effectiveDex({ dex: 16, acrobatics: true, level: 14 }), null, "no cap is invented");
  assert.deepEqual(jumpDistance({ dex: 16, acrobatics: true, level: 14 }).unknown, ["acrobaticsDexCap"]);
  assert.equal(jumpDistance({ dex: 16, acrobatics: true, level: 14, dexCap: 20 }).min, 21, "the caller's cap stands in");
  assert.equal(effectiveDex({ dex: 16, acrobatics: true, level: 0 }), 16, "no raise, no cap needed");
  resetTables();
});

ok("a jump takes the imported cap and the raised score", () => {
  load({ ...JUMPING, ...ACROBAT });
  assert.equal(jumpDistance({ dex: 16, acrobatics: true, level: 14 }).min, 24);
  assert.equal(jumpDistance({ dex: 16, acrobatics: true, level: 14, dexCap: 17 }).min, 18);
  resetTables();
});

// ---- the leap on the raised score -------------------------------------------
ok("the bands are read whole, ascending, or not at all", () => {
  const read = (extendedDexBands_) => { load({ ...JUMPING, extendedDexBands: extendedDexBands_ }); const got = extendedDexBands(); resetTables(); return got; };
  assert.deepEqual(read([{ min: 22, max: 23, mod: 9 }, { min: 19, max: 21, mod: 7 }]), ACROBAT.extendedDexBands, "sorted");
  assert.deepEqual(read([{ min: "19", max: "19", mod: "7" }]), [{ min: 19, max: 19, mod: 7 }], "an override typed as text");
  for (const bad of [[], null, "19-20", [{ min: 19, max: 20 }], [{ min: 20, max: 19, mod: 1 }], [{ min: 19, max: 21, mod: 7 }, { min: 21, max: 22, mod: 8 }], [{ min: 19, max: 20.5, mod: 7 }]]) {
    assert.equal(read(bad), null, JSON.stringify(bad));
  }
});

ok("a leap takes the modifier of the raised score, not the sheet's", () => {
  load({ ...JUMPING, ...ACROBAT });
  const leap = leapHeight({ dex: 16, mod: 2, acrobatics: true, level: 4 });
  assert.equal(leap.dex, 20);
  assert.equal(leap.bonus, 7);
  assert.equal(leap.feet, 10, "7 + the constant, not the sheet's 2 + the constant");
  assert.notEqual(leap.feet, leapHeight({ dex: 16, mod: 2 }).feet);
  assert.deepEqual(leap.unknown, []);
  assert.equal(leapHeight({ dex: 16, mod: 2, acrobatics: true, level: 14 }).bonus, 9, "held at the cap, then read");
  assert.equal(leapHeight({ dex: 16, mod: 2, acrobatics: true, level: 14, dexCap: 20 }).bonus, 7, "the caller's cap");
  resetTables();
});

ok("a score the sheet holds keeps the sheet's modifier, with no bands imported", () => {
  load();
  assert.equal(leapHeight({ dex: 20, mod: 5 }).feet, 8);
  assert.equal(leapHeight({ dex: 16, mod: 2, acrobatics: true, level: 0 }).feet, 5, "no raise");
  resetTables();
});

ok("with no bands a raised score has no modifier and the leap names them", () => {
  load({ ...JUMPING, acrobaticsDexCap: 23 });
  const leap = leapHeight({ dex: 16, mod: 2, acrobatics: true, level: 4 });
  assert.equal(leap.feet, null);
  assert.equal(leap.bonus, null);
  assert.deepEqual(leap.unknown, ["extendedDexBands"]);
  assert.equal(scoreModifier(20), null);
  withSystemTable(() => assert.equal(scoreModifier(20), null, "the system's table does not stand in for the bands"));
  resetTables();
});

ok("with no cap the leap of a raised score names the cap and is not figured", () => {
  load({ ...JUMPING, extendedDexBands: ACROBAT.extendedDexBands });
  const leap = leapHeight({ dex: 16, mod: 2, acrobatics: true, level: 4 });
  assert.equal(leap.feet, null);
  assert.deepEqual(leap.unknown, ["acrobaticsDexCap"]);
  assert.equal(leapHeight({ dex: 16, mod: 2, acrobatics: true, level: 4, dexCap: 20 }).feet, 10, "the caller's cap stands in");
  resetTables();
});

ok("a score between the bands or above the top one answers null, never the nearest band", () => {
  load({ ...JUMPING, acrobaticsDexCap: 40, extendedDexBands: [{ min: 19, max: 20, mod: 7 }, { min: 23, max: 24, mod: 9 }] });
  assert.equal(scoreModifier(22), null, "between two bands");
  assert.equal(scoreModifier(30), null, "above the last band");
  assert.equal(scoreModifier(24), 9);
  const leap = leapHeight({ dex: 16, mod: 2, acrobatics: true, level: 14 });
  assert.equal(leap.dex, 30);
  assert.equal(leap.feet, null);
  assert.deepEqual(leap.unknown, ["extendedDexBands"]);
  resetTables();
});

ok("a score under the bands is the system's own, and null where the system gives none", () => {
  load({ ...JUMPING, ...ACROBAT });
  assert.equal(scoreModifier(12), null, "no system table loaded");
  withSystemTable(() => {
    assert.equal(scoreModifier(12), 0);
    assert.equal(scoreModifier(15), 2);
    assert.equal(scoreModifier(19), 7, "inside a band, the band");
    assert.equal(leapHeight({ dex: 12, mod: 0, acrobatics: true, level: 3 }).feet, 5, "raised to 15, read from the system");
  });
  assert.equal(leapHeight({ dex: 12, mod: 0, acrobatics: true, level: 3 }).feet, null, "no system table, no figure");
  resetTables();
});

ok("a system table that answers no number gives no modifier, so no figure rests on it", () => {
  load({ ...JUMPING, ...ACROBAT });
  globalThis.CONFIG = { Actor: { dataModels: { character: { getAttributeModifier: () => undefined } } } };
  try {
    assert.equal(scoreModifier(12), null);
    assert.equal(leapHeight({ dex: 12, mod: 0, acrobatics: true, level: 3 }).feet, null);
  } finally {
    delete globalThis.CONFIG;
  }
  resetTables();
});

ok("a creature's assumed score takes a modifier of its own, not the sheet's absence", () => {
  load({ ...JUMPING, ...ACROBAT });
  withSystemTable(() => assert.equal(leapHeight({}).feet, 3, "the assumed score's modifier plus the constant"));
  assert.equal(leapHeight({}).feet, null);
  assert.deepEqual(leapHeight({}).unknown, ["extendedDexBands"]);
  assert.equal(leapHeight({ mod: 2 }).feet, 5, "a sheet's modifier needs no score");
  load();
  assert.equal(leapHeight({}).unknown.includes("extendedDexBands"), true);
  resetTables();
});

ok("a caller's own modifier wins over every read", () => {
  load();
  assert.equal(leapHeight({ dex: 16, mod: 2, acrobatics: true, level: 4, extended: 6 }).feet, 9);
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
  assert.equal(dexModifier({ mod: 3, score: 20, raised: true, extended: 4 }), 4);
});

ok("a raised score's modifier is the score's own, never the sheet's", () => {
  resetTables();
  assert.equal(dexModifier({ mod: 3, score: 20, raised: true }), null, "no bands imported");
  load({ ...JUMPING, ...ACROBAT });
  assert.equal(dexModifier({ mod: 3, score: 20, raised: true }), 7);
  assert.equal(dexModifier({ mod: 3, score: 20, raised: false }), 3, "a score the sheet holds");
  resetTables();
});

console.log(`test-jumping: all ${passed} checks passed`);
