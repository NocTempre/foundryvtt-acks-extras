/**
 * The travel engine's pure half: the day board's budget, the subtree's
 * defaults, the log's composition and cap. Invented values throughout — the
 * printed frequencies and multipliers arrive through the registry and are
 * asserted only in the machine-local rules tests.
 */
import assert from "node:assert/strict";
import {
  ANCILLARY_ACTIVITIES,
  ANCILLARY_SLOTS,
  DAY_KINDS,
  composeLogEntry,
  freshDay,
  pushLog,
  travelOf,
  withDayKind,
} from "../scripts/formation/travel.mjs";

/* --- the day board ------------------------------------------------------- */
let day = freshDay();
assert.equal(day.kind, "march");
assert.equal(day.activities.length, ANCILLARY_SLOTS, "a day budgets four ancillary slots");
assert.ok(day.activities.every((a) => a === null), "and starts with them unspent");

day = withDayKind(day, "forced");
assert.equal(day.kind, "forced");
assert.ok(day.activities.every((a) => a === "travel"), "a forced march consumes every ancillary slot on the road");

day = withDayKind(day, "march");
assert.ok(day.activities.every((a) => a === null),
  "stepping back down returns a fresh budget, not the forced march's overwrite");

const spent = { ...freshDay(), activities: ["hunt", null, "search", null] };
const kept = withDayKind(spent, "camp");
assert.deepEqual(kept.activities, ["hunt", null, "search", null], "changing between unforced kinds keeps the plan");
assert.equal(kept.kind, "camp");
assert.equal(DAY_KINDS.camp.travels, false, "a camp day goes nowhere on purpose");

/* --- the activity taxonomy carries its cadence KIND ----------------------- */
assert.equal(ANCILLARY_ACTIVITIES.travel.frequency, "perHex");
assert.equal(ANCILLARY_ACTIVITIES.search.frequency, "perHour");
assert.equal(ANCILLARY_ACTIVITIES.hunt.frequency, "perAttempt");
assert.equal(ANCILLARY_ACTIVITIES.rest.frequency, "perPeriod");

/* --- travelOf answers for a record that never journeyed ------------------- */
let t = travelOf({});
assert.equal(t.mode, "delve");
assert.equal(t.pace, "dedicated");
assert.equal(t.road, "none");
assert.equal(t.dayCount, 0);
assert.deepEqual(t.log, []);
t = travelOf({ ground: "swamp" });
assert.equal(t.ground, "swamp", "the legacy ground field still answers before a journey begins");
t = travelOf({ travel: { mode: "journey", ground: "hills", road: "paved", pace: "forced" } });
assert.equal(t.mode, "journey");
assert.equal(t.road, "paved");
assert.equal(t.pace, "forced");

/* --- the log: composition, then the cap eating the OLDEST ----------------- */
const journeying = travelOf({
  travel: {
    ground: "hills", road: "earth", territory: "outlands", dayCount: 2,
    hex: { label: "K7" },
    day: { kind: "forced", activities: ["travel", "travel", "travel", "travel"], hexesEntered: 3 },
    weather: { raining: true },
  },
});
const entry = composeLogEntry(journeying, { miles: 18, hexes: 3, notes: "a wet slog" });
assert.equal(entry.day, 3, "the entry numbers itself after the days already logged");
assert.equal(entry.hex, "K7");
assert.equal(entry.pace, "forced", "the day kind carries its pace into the record");
assert.equal(entry.hexesEntered, 3);
assert.equal(entry.weather.raining, true);
assert.equal(entry.miles, 18);

let log = [];
for (let i = 1; i <= 5; i++) log = pushLog(log, { day: i }, 3);
assert.equal(log.length, 3, "the cap holds");
assert.deepEqual(log.map((e) => e.day), [5, 4, 3], "newest first; the oldest days are what trimming eats");

console.log("test-travel: OK (day board, forced budget, defaults, log cap)");
