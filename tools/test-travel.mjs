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
  dayIsSpent,
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

/* --- what the day has walked survives every kind change ------------------- */
const walked = { ...freshDay(), hexesEntered: 3, winding: 1, activities: ["hunt", null, null, null] };
const pushed = withDayKind(walked, "forced");
assert.equal(pushed.hexesEntered, 3, "pushing on does not un-walk the ground already crossed");
assert.equal(pushed.winding, 1);
assert.ok(pushed.activities.every((a) => a === "travel"), "though it does spend the hours");
assert.equal(withDayKind(null, "march").hexesEntered, 0, "and ending the day starts a fresh tally");
assert.equal(freshDay().offered, false, "a fresh day has not been called done");
assert.equal(withDayKind({ ...freshDay(), offered: true }, "forced").offered, false,
  "and pushing on re-arms the question for the distance it just bought");

/* --- the day is spent when the march has been walked ---------------------- */
assert.equal(dayIsSpent({ hexesEntered: 2 }, 3), false);
assert.equal(dayIsSpent({ hexesEntered: 3 }, 3), true, "the allowance is reached, not exceeded");
assert.equal(dayIsSpent({ hexesEntered: 9 }, 0), false, "a day that carries nowhere is never spent");
assert.equal(dayIsSpent({ hexesEntered: 9 }, null), false, "nor is one whose march is unpriced");

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

/* --- the day board has ONE field name -------------------------------------
   `freshDay` writes `activities`; two readers asked for a `slots` that nothing
   ever sets. Both answered "no ancillary work chosen" forever, so the camp's
   forage targets never rendered and the forage run gathered nothing — a whole
   surface dead, with no error raised anywhere. Pinned at the source: a reader
   can still mistype the name, but the board can no longer look as though it
   carries both. */
const board = freshDay("march");
assert.ok(Array.isArray(board.activities), "activities is the array of picks");
assert.equal(board.slots, undefined, "there is nothing named `slots` to read");
assert.equal(
  withDayKind(board, "march").slots, undefined,
  "and a rebuilt board does not grow one either",
);

/* --- how the order MOVES is its own axis -----------------------------------
   `travel.mode` is the kind of adventuring (delve / journey / settlement);
   `travel.movement.mode` is how the party gets about. They are independent —
   a party can fly a journey or walk one — and the two were nearly given the
   same field name, which would have made every flight a separate mode of play. */
const rec = travelOf({ travel: {} });
assert.equal(rec.mode, "delve", "the adventuring mode defaults to a delve");
assert.equal(rec.movement.mode, "foot", "and the movement mode to walking");
assert.equal(rec.movement.hoursAloft, 0);
assert.equal(rec.movement.dayHours, 0, "an unstated day is not an assumed one");
assert.equal(rec.movement.load, "normal");

const flier = travelOf({ travel: { mode: "journey", movement: { mode: "flying", hoursAloft: "4", dayHours: "8", load: "heavy" } } });
assert.equal(flier.mode, "journey", "the two axes do not overwrite each other");
assert.equal(flier.movement.mode, "flying");
assert.equal(flier.movement.hoursAloft, 4, "hours arrive from a form as strings");
assert.equal(flier.movement.dayHours, 8);
assert.equal(flier.movement.load, "heavy");

const nonsense = travelOf({ travel: { movement: { mode: "swimming", hoursAloft: -3, load: "featherlight" } } });
assert.equal(nonsense.movement.mode, "foot", "an unknown mode falls back rather than composing nothing");
assert.equal(nonsense.movement.hoursAloft, 0, "a negative span is no span");
assert.equal(nonsense.movement.load, "normal", "an unknown load band falls back too");

console.log("test-travel: OK (day board, forced budget, defaults, log cap, one field name, movement axis)");
