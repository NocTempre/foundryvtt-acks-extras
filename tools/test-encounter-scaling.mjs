/**
 * A wandering monster met on the wrong floor (JJ ch. 2), as arithmetic.
 */
import assert from "node:assert/strict";
import { encounterShift, scaleNumber } from "../scripts/formation/encounter-scaling.mjs";

/* --- the book's own worked example: 1d6 wights, Level 3, a roll of 4 ----- */
const wights = (dungeonLevel) => encounterShift({ dungeonLevel, monsterLevel: 3 });

let s = wights(1);
assert.equal(s.steps, -2, "two steps shallower than the table assumes");
assert.equal(scaleNumber(4, s), 1, "4 x 1/2 x 1/2 = 1 wight on Dungeon Level 1");
assert.equal(s.reaction, 2, "and they take +2 to react — tools, not threats");

s = wights(5);
assert.equal(s.steps, 2);
assert.equal(scaleNumber(4, s), 9, "4 x 3/2 x 3/2 = 9 wights on Dungeon Level 5");
assert.equal(s.reaction, -2, "and -2 to react — numbers make them bold");

/* --- on its own floor nothing bends ------------------------------------- */
s = wights(3);
assert.equal(s.steps, 0);
assert.equal(s.multiplier, 1);
assert.equal(s.reaction, 0);
assert.equal(scaleNumber(4, s), 4);

/* --- the two adjustments are exact opposites ---------------------------- */
for (const d of [1, 2, 4, 6, 9]) {
  const x = wights(d);
  assert.equal(x.reaction, -x.steps, "reaction mirrors the depth difference");
}

/* --- rounding UP: the party always meets something ---------------------- */
s = wights(1);
assert.equal(scaleNumber(1, s), 1, "one monster quartered is still one monster");
assert.equal(scaleNumber(2, s), 1);
assert.equal(scaleNumber(3, s), 1, "3 x 1/4 = 0.75, rounded up");
assert.equal(scaleNumber(5, s), 2, "5 x 1/4 = 1.25, rounded up");

/* --- a roll of zero stays zero ------------------------------------------ */
assert.equal(scaleNumber(0, wights(5)), 0, "nothing scaled is still nothing");

/* --- a missing level never silently scales ------------------------------ */
for (const bad of [{ dungeonLevel: 0, monsterLevel: 3 }, { dungeonLevel: 5, monsterLevel: 0 }, {}]) {
  const x = encounterShift(bad);
  assert.equal(x.matched, false);
  assert.equal(x.multiplier, 1);
  assert.equal(x.reaction, 0);
  assert.equal(scaleNumber(4, x), 4, "an unset level leaves the draw exactly as rolled");
}

/* --- deep dives compound fast ------------------------------------------- */
assert.equal(scaleNumber(4, encounterShift({ dungeonLevel: 8, monsterLevel: 3 })), 31,
  "five steps deeper: 4 x 1.5^5 = 30.4, rounded up");

console.log("test-encounter-scaling: OK (book example, mirroring, rounding, unset levels)");
