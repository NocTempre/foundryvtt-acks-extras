/**
 * Jumping and leaping. Pure functions; no Foundry, no world.
 *
 * The arithmetic is checked against the rule's own worked example (the medium
 * horse), because everything here is arithmetic over values supplied from
 * outside and an error in it would look exactly like a working feature.
 */
import assert from "node:assert/strict";
import {
  NO_ACROBATICS,
  DEFAULT_CREATURE_DEX,
  RUNNING_START_FEET,
  canClear,
  dexModifier,
  effectiveDex,
  jumpDistance,
  landingFailure,
  landingSave,
  leapHeight,
  partyJump,
} from "../scripts/formation/jumping.mjs";

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
};

/* -------------------------------------------- */
/*  The modifier                                 */
/* -------------------------------------------- */

test("the modifier is the sheet's, not a table kept here", () => {
  // The attribute bands are the book's and the system already computes them,
  // so this reads `system.scores.dex.mod` rather than owning a second copy.
  assert.equal(dexModifier({ mod: 2 }), 2);
  assert.equal(dexModifier({ mod: -1 }), -1);
  assert.equal(dexModifier({}), 0);
  assert.equal(dexModifier({ mod: "not a number" }), 0);
});

test("a caller holding the extended bands supplies the modifier itself", () => {
  // Acrobatics can push a score past the printed rows; a seat that imported
  // those rows passes what they say, and one that did not gets the sheet's.
  assert.equal(dexModifier({ mod: 3, extended: 5 }), 5);
  assert.equal(dexModifier({ mod: 3, extended: null }), 3);
  assert.equal(dexModifier({ mod: 3, extended: 0 }), 0);
});

test("Acrobatics adds class level to DEX, and stops where the ability says", () => {
  assert.equal(effectiveDex({ dex: 13, acrobatics: true, level: 5 }), 18);
  // The cap is the proficiency's number, supplied with it; absent one there is
  // no cap to apply rather than an invented ceiling.
  assert.equal(effectiveDex({ dex: 16, acrobatics: true, level: 14, dexCap: 24 }), 24);
  assert.equal(effectiveDex({ dex: 16, acrobatics: true, level: 14 }), 30);
  assert.equal(NO_ACROBATICS.dexCap, null);
  // Without the proficiency the level is worth nothing at all.
  assert.equal(effectiveDex({ dex: 13, acrobatics: false, level: 14 }), 13);
  // A creature nobody wrote a DEX for is assumed to have nine.
  assert.equal(effectiveDex({}), DEFAULT_CREATURE_DEX);
});

/* -------------------------------------------- */
/*  Distance and height                          */
/* -------------------------------------------- */

test("a horizontal jump is DEX + 1d6, reported as the range it is", () => {
  const jump = jumpDistance({ dex: 13 });
  assert.equal(jump.min, 14);
  assert.equal(jump.max, 19);
  assert.equal(jump.average, 16.5);
  assert.equal(jump.die, "1d6");
});

test("a vertical leap is the DEX bonus plus one, never under a foot", () => {
  assert.equal(leapHeight({ mod: 1 }).feet, 2);
  assert.equal(leapHeight({ mod: 3 }).feet, 4);
  assert.equal(leapHeight({ mod: 0 }).feet, 1);
  // A penalty would take the base below one; the printed minimum holds it up.
  assert.equal(leapHeight({ mod: -3 }).feet, 1);
  assert.equal(leapHeight({ mod: -1 }).feet, 1);
});

test("the leap reports the score its modifier should answer for", () => {
  // The caller needs the effective score to look the extended band up at all.
  const acrobat = leapHeight({ dex: 16, acrobatics: true, level: 6, mod: 2 });
  assert.equal(acrobat.dex, 22);
  assert.equal(acrobat.bonus, 2); // still the sheet's, no bands supplied
  // Given the band for 22, the leap grows.
  assert.equal(leapHeight({ dex: 16, acrobatics: true, level: 6, mod: 2, extended: 5 }).feet, 6);
});

test("encumbrance costs a foot per stone, on both the jump and the leap", () => {
  assert.equal(jumpDistance({ dex: 13, encumbrance: 4 }).min, 10);
  assert.equal(jumpDistance({ dex: 13, encumbrance: 4 }).max, 15);
  assert.equal(leapHeight({ mod: 3, encumbrance: 2 }).feet, 2);
});

test("a laden enough character cannot leave the ground, and never by a negative amount", () => {
  // The printed 1' minimum is on the base formula, not on what encumbrance
  // leaves of it — but a negative distance is not a measurement.
  assert.equal(leapHeight({ mod: 0, encumbrance: 6 }).feet, 0);
  assert.equal(jumpDistance({ dex: 9, encumbrance: 40 }).max, 0);
});

test("without a run-up everything is halved, and halved AFTER encumbrance", () => {
  assert.equal(RUNNING_START_FEET, 20);
  // 13 + 1 = 14, less 4 stone = 10, halved = 5. Halving first would give 3.
  assert.equal(jumpDistance({ dex: 13, encumbrance: 4, runningStart: false }).min, 5);
  assert.equal(jumpDistance({ dex: 13, runningStart: false }).min, 7);
  assert.equal(leapHeight({ mod: 3, runningStart: false }).feet, 2);
});

test("the rule's own worked example: a medium horse at 180' running speed", () => {
  // "a medium horse with a running speed of 180' could jump (9 + 1d6) x 1.5"
  const horse = jumpDistance({ runSpeed: 180 });
  assert.equal(horse.dex, 9);
  assert.equal(horse.min, 15); // (9 + 1) x 1.5
  assert.equal(horse.max, 22.5); // (9 + 6) x 1.5
});

test("a creature at the baseline speed is scaled by nothing", () => {
  const walker = jumpDistance({ dex: 13, runSpeed: 120 });
  assert.deepEqual([walker.min, walker.max], [14, 19]);
  // And the multiplier does not sneak into the shown parts when it is 1.
  assert.equal(
    walker.parts.some((p) => p.key === "speed"),
    false,
  );
});

test("an acrobat jumps further because the DEX itself is raised", () => {
  const plain = jumpDistance({ dex: 16 });
  const acrobat = jumpDistance({ dex: 16, acrobatics: true, level: 6 });
  assert.equal(acrobat.dex, 22);
  assert.equal(acrobat.min, 23);
  assert.ok(acrobat.min > plain.min);
});

test("the parts show the working behind a number", () => {
  const jump = jumpDistance({ dex: 13, encumbrance: 3, runningStart: false });
  assert.deepEqual(jump.parts, [
    { key: "dex", value: 13 },
    { key: "die", value: "1d6" },
    { key: "encumbrance", value: -3 },
    { key: "standing", value: 0.5 },
  ]);
});

/* -------------------------------------------- */
/*  Clearing a gap                               */
/* -------------------------------------------- */

test("a gap under the worst roll is certain, and over the best is impossible", () => {
  assert.equal(canClear(10, { dex: 13 }).verdict, "certain"); // min 14
  assert.equal(canClear(14, { dex: 13 }).verdict, "certain");
  assert.equal(canClear(25, { dex: 13 }).verdict, "impossible"); // max 19
});

test("a gap inside the range is a chance, and the chance has a size", () => {
  // DEX 13: the die carries 14..19, so a 17' gap needs a 4, 5 or 6.
  const call = canClear(17, { dex: 13 });
  assert.equal(call.verdict, "chance");
  assert.equal(call.onSix, 3);
  assert.deepEqual([call.min, call.max], [14, 19]);
  // The very edge of the range is the thinnest chance there is.
  assert.equal(canClear(19, { dex: 13 }).onSix, 1);
});

test("a party is read against one gap before anybody runs at it", () => {
  const rows = partyJump(
    [
      { name: "Thief", dex: 16, encumbrance: 1, acrobatics: true, level: 4 },
      { name: "Fighter", dex: 13, encumbrance: 5 },
      { name: "Mage", dex: 9, encumbrance: 3 },
    ],
    12,
  );
  assert.equal(rows[0].verdict, "certain"); // effective DEX 20, less 1 stone
  assert.equal(rows[1].verdict, "chance"); // 14..19 less 5 = 9..14
  assert.equal(rows[1].onSix, 3);
  // The mage clears 7..12, so the 12' gap is his on a six and on nothing else.
  assert.equal(rows[2].verdict, "chance");
  assert.equal(rows[2].onSix, 1);
});

test("the run-up is the party's condition, not each jumper's", () => {
  const standing = partyJump([{ name: "Fighter", dex: 13 }], 8, { runningStart: false });
  assert.equal(standing[0].verdict, "chance"); // 7..9.5 from a standing start
});

/* -------------------------------------------- */
/*  Landing                                      */
/* -------------------------------------------- */

test("an ordinary jump onto solid ground asks for no saving throw at all", () => {
  // The save is owed for a precarious destination or a charge, and RAW for
  // nothing else — prompting for one every jump would invent a check.
  assert.equal(landingSave({}).needed, false);
  assert.equal(landingSave({ precarious: true }).needed, true);
  assert.equal(landingSave({ charging: true }).needed, true);
  assert.equal(landingSave({ precarious: true }).save, "paralysis");
});

test("what Acrobatics is worth on the landing comes from the ability", () => {
  // The module contributes nothing until it is told what the proficiency says.
  assert.equal(NO_ACROBATICS.saveBonus, 0);
  assert.equal(landingSave({ precarious: true, acrobatics: true }).bonus, 0);
  assert.equal(landingSave({ precarious: true, acrobatics: true, saveBonus: 2 }).bonus, 2);
  // And a bonus offered to somebody without the proficiency is not applied.
  assert.equal(landingSave({ precarious: true, saveBonus: 2 }).bonus, 0);
});

test("what a failed landing costs is decided by what is underneath", () => {
  assert.equal(landingFailure("solid").outcome, "prone");
  assert.equal(landingFailure("edge").outcome, "hanging");
  assert.equal(landingFailure("empty", 30).outcome, "fall");
  // Always 1d6 short, whatever is down there.
  assert.equal(landingFailure("solid").shortBy, "1d6");
  // A fall is 1d6 bludgeoning per ten feet, and a shallow one is no dice.
  assert.equal(landingFailure("empty", 30).damage, "3d6");
  assert.equal(landingFailure("empty", 35).damage, "3d6");
  assert.equal(landingFailure("empty", 5).damage, null);
  assert.equal(landingFailure("solid", 30).damage, null);
});

console.log(`test-jumping: OK (${passed} checks — modifier, distance, encumbrance, run-up, creatures, gaps, landing)`);
