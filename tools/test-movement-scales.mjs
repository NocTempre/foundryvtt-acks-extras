/**
 * The four movement scales and the Expedition Speed table (RR ch. 6).
 */
import assert from "node:assert/strict";
import {
  expeditionFrom, explorationFromExpedition, inWilderness,
  TRAVEL_PACE, SCALES, MILES_PER_HEX,
} from "../scripts/lib/movement-scales.mjs";

/* --- every printed row of the Expedition Speed table --------------------- */
const PRINTED = [
  [30, 6, 1, 0.75], [60, 12, 2, 1.5], [90, 18, 3, 2.25], [120, 24, 4, 3],
  [150, 30, 5, 3.75], [180, 36, 6, 4.5], [210, 42, 7, 5.25], [240, 48, 8, 6],
  [270, 54, 9, 6.75], [300, 60, 10, 7.5], [330, 66, 11, 8.25], [360, 72, 12, 9],
];
for (const [feet, miles, hexes, mph] of PRINTED) {
  const e = expeditionFrom(feet);
  assert.equal(e.milesPerDay, miles, `${feet}' per turn is ${miles} miles a day`);
  assert.equal(e.hexesPerDay, hexes, `${feet}' per turn is ${hexes} hexes a day`);
  assert.equal(e.milesPerHour, mph, `${feet}' per turn is ${mph} miles an hour`);
}

/* --- and back again ------------------------------------------------------ */
assert.equal(explorationFromExpedition(24), 120);
assert.equal(explorationFromExpedition(72), 360);

/* --- a hex is six miles -------------------------------------------------- */
assert.equal(MILES_PER_HEX, 6);
assert.equal(expeditionFrom(360).hexesPerDay, 12);

/* --- travel pace --------------------------------------------------------- */
assert.equal(TRAVEL_PACE.dedicated.multiplier, 1);
assert.equal(TRAVEL_PACE.forced.multiplier, 3 / 2, "a forced march is +50%");
assert.equal(TRAVEL_PACE.ancillary.multiplier, 1 / 2);

let e = expeditionFrom(120, { pace: "forced" });
assert.equal(e.milesPerDay, 36, "24 miles becomes 36 on a forced march");
/* ...but it is not FASTER, it is LONGER: twelve hours instead of eight */
assert.equal(e.milesPerHour, 3, "the same 3 miles an hour, for twelve hours");
assert.equal(expeditionFrom(120).milesPerHour, 3);

e = expeditionFrom(120, { pace: "ancillary" });
assert.equal(e.milesPerDay, 12, "four ancillary hours make half a day's travel");
assert.equal(e.milesPerHour, 3, "still the same marching pace");

/* --- terrain and roads ride in as one combined multiplier ---------------- */
assert.equal(expeditionFrom(120, { multiplier: 1 / 2 }).milesPerDay, 12, "swamp halves the day");
assert.equal(expeditionFrom(120, { multiplier: 2 }).milesPerDay, 48, "a driver's road doubles it");
assert.equal(expeditionFrom(120, { multiplier: 1 / 2 * 3 / 2 }).milesPerDay, 18,
  "a road through swamp: half the country, half again for the road");

/* --- the two together ---------------------------------------------------- */
assert.equal(expeditionFrom(120, { multiplier: 3 / 2, pace: "forced" }).milesPerDay, 54,
  "a forced march down a road");

/* --- outdoors, a fight is three times the size --------------------------- */
assert.equal(inWilderness(40), 120, "40' combat speed is 120' in the open");
assert.equal(inWilderness(0), 0);

/* --- the scales are named, and named distinctly -------------------------- */
assert.deepEqual(Object.keys(SCALES), ["combat", "running", "exploration", "expedition"]);
assert.notEqual(SCALES.exploration.unit, SCALES.expedition.unit,
  "feet per turn and miles per day are not the same unit");

/* --- nothing goes negative ---------------------------------------------- */
assert.equal(expeditionFrom(-100).milesPerDay, 0);
assert.equal(inWilderness(-5), 0);

console.log("test-movement-scales: OK (all 12 printed rows, pace, terrain, wilderness, units)");
