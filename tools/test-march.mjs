/**
 * The march's pure arithmetic: the day's budget in hours, the encounter cadence
 * a map and a table agree on, one step's spend, and when the day is over.
 * Invented figures throughout — speeds, cell sizes and table distances here are
 * not the book's.
 */
import assert from "node:assert/strict";
import { SLOT_HOURS, cadenceOf, marchBudget, marchIsSpent, spendMarch } from "../scripts/formation/march.mjs";
import { TRAVEL_PACE } from "../scripts/lib/movement-scales.mjs";

/* --- the day's budget ---------------------------------------------------- */
assert.equal(SLOT_HOURS, 1);
let b = marchBudget({ pace: "dedicated", milesPerHour: 3 });
assert.deepEqual(b, { hours: TRAVEL_PACE.dedicated.hours, miles: TRAVEL_PACE.dedicated.hours * 3 }, "a dedicated day is its pace's hours");

b = marchBudget({ pace: "forced", travelSlots: 4, paceConsumesSlots: true, milesPerHour: 2 });
assert.equal(b.hours, TRAVEL_PACE.forced.hours, "a forced march has consumed the slots; they add nothing");

b = marchBudget({ pace: null, travelSlots: 2, milesPerHour: 3 });
assert.deepEqual(b, { hours: 2 * SLOT_HOURS, miles: 6 }, "a camp day marches only its travel slots");

b = marchBudget({ pace: "dedicated", travelSlots: 1, milesPerHour: 3 });
assert.equal(b.hours, TRAVEL_PACE.dedicated.hours + SLOT_HOURS, "a dedicated day takes a travel slot on top");

b = marchBudget({ pace: "gallop", milesPerHour: 3 });
assert.deepEqual(b, { hours: 0, miles: 0 }, "an unknown pace marches no hours");
assert.deepEqual(marchBudget({ pace: "constructor", milesPerHour: 3 }), { hours: 0, miles: 0 }, "a prototype name is not a pace");
assert.deepEqual(marchBudget(), { hours: 0, miles: 0 }, "no arguments, no march");
assert.equal(marchBudget({ pace: "dedicated", milesPerHour: 1 / 3 }).miles, Math.round((TRAVEL_PACE.dedicated.hours / 3) * 100) / 100, "miles round to two decimals");

/* --- the cadence --------------------------------------------------------- */
assert.deepEqual(cadenceOf({ isHex: true, milesPerCell: 6, mileHex: 6 }), { by: "grid", miles: 6 }, "a hex the size of the table's counts crossings");
assert.deepEqual(cadenceOf({ isHex: true, milesPerCell: 6.05, mileHex: 6 }), { by: "grid", miles: 6 }, "within one percent is the same hex");
assert.deepEqual(cadenceOf({ isHex: true, milesPerCell: 6.1, mileHex: 6 }), { by: "miles", miles: 6 }, "past one percent is not");
assert.deepEqual(cadenceOf({ isHex: true, milesPerCell: 24, mileHex: 6 }), { by: "miles", miles: 6 }, "a big hex owes several throws");
assert.deepEqual(cadenceOf({ isHex: false, milesPerCell: 6, mileHex: 6 }), { by: "miles", miles: 6 }, "a square grid counts miles");
assert.deepEqual(cadenceOf({ isHex: true, milesPerCell: 0, mileHex: 6 }), { by: "miles", miles: 6 }, "a hex with no size counts miles");
assert.deepEqual(
  cadenceOf({ isHex: true, milesPerCell: 8, mileHex: null }),
  { by: "grid", miles: 8, missing: "encounterFrequency" },
  "no table: the hex map's own cell stands in, and the table is named missing",
);
assert.deepEqual(
  cadenceOf({ isHex: false, milesPerCell: 8, mileHex: null }),
  { by: "none", miles: null, missing: "encounterFrequency" },
  "no table on a map with no hex: nothing is counted",
);
assert.deepEqual(cadenceOf({ mileHex: 0 }), { by: "none", miles: null, missing: "encounterFrequency" }, "a zero table is no table");
assert.deepEqual(cadenceOf(), { by: "none", miles: null, missing: "encounterFrequency" });

/* --- one step's spend ---------------------------------------------------- */
const grid = { by: "grid", miles: 6 };
const byMiles = { by: "miles", miles: 6 };
const none = { by: "none", miles: null, missing: "encounterFrequency" };

let r = spendMarch({}, { miles: 3, milesPerHour: 3, cadence: grid, crossed: 1 });
assert.equal(r.hours, 1);
assert.equal(r.seconds, 3600);
assert.equal(r.units, 1, "a grid cadence earns one unit per counted crossing");
let next = r.day;
r = spendMarch(next, { miles: 1.5, milesPerHour: 3, cadence: grid, crossed: 0 });
assert.equal(r.units, 0, "no crossing, no unit");
assert.equal(r.day.hours, 1.5, "hours accumulate across steps");
assert.equal(r.day.miles, 4.5, "miles accumulate across steps");
assert.equal(r.day.secondsAdvanced, 3600 + 1800);
assert.equal(spendMarch({}, { miles: 3, milesPerHour: 3, cadence: grid, crossed: 3 }).units, 3, "three crossings in one drag");

assert.equal(spendMarch({}, { miles: 24, milesPerHour: 3, cadence: byMiles }).units, 4, "a 24-mile step on a 6-mile table is four units");
let a = spendMarch({}, { miles: 4, milesPerHour: 3, cadence: byMiles });
assert.equal(a.units, 0, "four miles earn none yet");
assert.equal(a.day.cadenceCarry, 4);
a = spendMarch(a.day, { miles: 4, milesPerHour: 3, cadence: byMiles });
assert.equal(a.units, 1, "four and four make one");
assert.equal(a.day.cadenceCarry, 2, "and two miles carry");

r = spendMarch({}, { miles: 30, milesPerHour: 3, cadence: none, crossed: 5 });
assert.equal(r.units, 0, "no cadence earns nothing, however many crossings");
assert.equal(r.day.cadenceCarry, 0);
assert.equal(spendMarch({}, { miles: 30, milesPerHour: 3, crossed: 5 }).units, 0, "an absent cadence is none");

// Seconds are whole, and the fraction is carried: seven one-mile steps at seven
// miles an hour are exactly one hour.
let walked = {};
let total = 0;
for (let i = 0; i < 7; i++) {
  const step = spendMarch(walked, { miles: 1, milesPerHour: 7, cadence: none });
  assert.ok(Number.isInteger(step.seconds), `step ${i + 1} advances whole seconds`);
  total += step.seconds;
  walked = step.day;
}
assert.equal(total, 3600, "seven steps of a mile at seven miles an hour advance exactly an hour");
assert.equal(walked.secondsAdvanced, 3600, "and the day's record says so");
assert.ok(Math.abs(walked.hours - 1) < 1e-9, "while its hours read one");
assert.equal(spendMarch({}, { miles: 1, milesPerHour: 7, cadence: none }).seconds, 514, "a single step floors");
assert.equal(spendMarch({}, { miles: 1, milesPerHour: 2, cadence: none, secondsPerHour: 60 }).seconds, 30, "an hour of another length scales");

// A speed of zero spends no time.
r = spendMarch({}, { miles: 5, milesPerHour: 0, cadence: byMiles });
assert.deepEqual([r.hours, r.seconds], [0, 0]);
assert.equal(r.day.miles, 5, "but the miles are still walked");

// The input is never changed, and a legacy record spends cleanly.
const input = { miles: 1, hours: 0.5, cadenceCarry: 1, carrySeconds: 0.25, secondsAdvanced: 10, hexesEntered: 2 };
const snapshot = structuredClone(input);
r = spendMarch(input, { miles: 2, milesPerHour: 4, cadence: byMiles });
assert.deepEqual(input, snapshot, "the day passed in is untouched");
assert.notEqual(r.day, input, "a new object comes back");
assert.equal(r.day.hexesEntered, 2, "fields the march does not own are kept");
r = spendMarch({ hexesEntered: 2 }, { miles: 3, milesPerHour: 3, cadence: byMiles });
assert.deepEqual([r.day.miles, r.day.hours, r.day.secondsAdvanced, r.day.cadenceCarry], [3, 1, 3600, 3], "missing fields read as zero");
assert.doesNotThrow(() => spendMarch(undefined, { miles: 1, milesPerHour: 1, cadence: none }));

/* --- when the day is over ------------------------------------------------ */
const budget = marchBudget({ pace: "dedicated", milesPerHour: 3 });
assert.equal(marchIsSpent({ hours: budget.hours }, budget), true, "the budget reached");
assert.equal(marchIsSpent({ hours: budget.hours + 1 }, budget), true, "or passed");
assert.equal(marchIsSpent({ hours: budget.hours - 0.5 }, budget), false, "short of it");
assert.equal(marchIsSpent({ hours: budget.hours - 1e-12 }, budget), true, "float noise short of it is still spent");
assert.equal(marchIsSpent({ hours: 3 }, { hours: 0 }), false, "a zero budget never spends a day by hours");
assert.equal(marchIsSpent({ hours: 3 }, { hours: 0 }, { dark: false }), false);
assert.equal(marchIsSpent({ hours: 1 }, budget, { dark: true }), true, "a step after dusk ends the day");
assert.equal(marchIsSpent({}, { hours: 0 }, { dark: true }), true, "even with no budget");
assert.equal(marchIsSpent({}, budget), false, "a legacy day with no hours is open");
assert.equal(marchIsSpent(walked, { hours: 1 }), true, "seven sevenths of an hour, summed, spend an hour budget");

console.log("test-march: OK (budget, cadence, spend, carried seconds, immutability, spent day)");
