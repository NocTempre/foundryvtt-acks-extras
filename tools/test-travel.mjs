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
  adoptSceneSystem,
  claimUnstampedSettlements,
  composeLogEntry,
  freshDay,
  pushLog,
  setJourneyMode,
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

/* --- a board belongs to the city it was counted in --------------------------
   The writers, against a ledger of two settings calls. Mode alone used to
   decide whether a settlement board started fresh, so a party placed straight
   from one city into the next stayed "in settlement mode" and kept the first
   city's blocks, its turns, its hunted flag and — worst — the stay stamp the
   clock watcher charges days against. */
globalThis.foundry ??= { utils: {} };
globalThis.foundry.utils.deepClone ??= (v) => structuredClone(v);
const settings = { formations: {} };
globalThis.game ??= {};
globalThis.game.settings = {
  get: (_module, key) => settings[key],
  set: (_module, key, value) => { settings[key] = value; return value; },
};

/** A scene that declares itself a city, which is all `adoptSceneSystem` reads. */
const cityScene = (id) => ({ id, getFlag: () => ({ mapSystem: "settlement" }) });
const boardOf = (id) => travelOf(settings.formations[id]).settlement;

settings.formations = {
  f1: {
    id: "f1",
    travel: {
      mode: "settlement",
      settlement: {
        sceneId: "Scene.riverport", pace: "commuting", route: "route", where: "holedUp",
        night: true, blocks: 40, turns: 12, days: 3, holeUpSince: 500, wanted: true,
      },
    },
  },
};

assert.equal(await adoptSceneSystem("f1", cityScene("Scene.riverport")), null,
  "arriving where the board already says it is moves nothing");
assert.equal(boardOf("f1").blocks, 40, "and takes nothing off it");

assert.equal(await adoptSceneSystem("f1", cityScene("Scene.hillfort")), "settlement",
  "another city is an arrival even though the mode does not change");
const arrived = boardOf("f1");
assert.equal(arrived.sceneId, "Scene.hillfort");
assert.equal(arrived.blocks, 0, "the last city's mileage is not this one's");
assert.equal(arrived.turns, 0);
assert.equal(arrived.days, 0);
assert.equal(arrived.wanted, false, "being hunted is one city's own business");
assert.equal(arrived.holeUpSince, null,
  "and the stay stamp goes, or the journey between the two is charged as a stay");
assert.equal(arrived.pace, "commuting", "what the Judge set still carries");
assert.equal(arrived.route, "route");
assert.equal(arrived.night, true);

/* A dungeon under the city it is already in: the mode flips, and coming back
   up starts a fresh tally without forgetting what the Judge set. */
await setJourneyMode("f1", "delve");
assert.equal(boardOf("f1").pace, "commuting", "leaving a city keeps the board whole");
assert.equal(await adoptSceneSystem("f1", cityScene("Scene.hillfort")), "settlement");
assert.equal(boardOf("f1").pace, "commuting", "and coming back up keeps it too");
assert.equal(boardOf("f1").route, "route");
assert.equal(boardOf("f1").sceneId, "Scene.hillfort");

/* --- the UPGRADE path ------------------------------------------------------
   A world whose board was written before boards carried a stamp, with the party
   already standing in a city. Nothing places a token there, so no arrival ever
   runs; the startup claim is the only thing that can name that board's city,
   and if it does not, the very next hop is the FIRST arrival — and misses. */
globalThis.game.scenes = {
  get: (id) => (id === "Scene.hillfort" || id === "Scene.riverport" ? cityScene(id) : null),
};
settings.formations.f2 = {
  id: "f2",
  sceneId: "Scene.hillfort",
  travel: {
    mode: "settlement",
    settlement: { pace: "commuting", blocks: 17, turns: 5, holeUpSince: 900, wanted: true },
  },
};
/* A party in settlement mode standing nowhere anybody can name: there is no
   city to claim its board for, so the claim leaves it alone. */
settings.formations.f3 = {
  id: "f3",
  sceneId: null,
  travel: { mode: "settlement", settlement: { pace: "commuting", blocks: 6 } },
};

assert.equal(await claimUnstampedSettlements(), 1,
  "exactly the board whose city is knowable is claimed");
assert.equal(boardOf("f2").sceneId, "Scene.hillfort", "claimed for the city its party stands in");
assert.equal(boardOf("f2").blocks, 17, "and the claim writes the stamp and NOTHING else");
assert.equal(boardOf("f2").holeUpSince, 900);
assert.equal(boardOf("f2").wanted, true);
assert.equal(boardOf("f3").sceneId, null, "a party on no named scene has no city to be claimed for");
assert.equal(await claimUnstampedSettlements(), 0, "and a second pass has nothing left to claim");

assert.equal(await adoptSceneSystem("f2", cityScene("Scene.hillfort")), null,
  "the city it was claimed for is not an arrival");
assert.equal(boardOf("f2").blocks, 17, "so the tally the party is standing in the middle of stays");

/* The hop the upgrade used to lose. */
assert.equal(await adoptSceneSystem("f2", cityScene("Scene.riverport")), "settlement");
const hopped = boardOf("f2");
assert.equal(hopped.sceneId, "Scene.riverport");
assert.equal(hopped.blocks, 0);
assert.equal(hopped.turns, 0);
assert.equal(hopped.wanted, false);
assert.equal(hopped.holeUpSince, null,
  "the stay stamp above all: kept, the first clock advance in the new city bills the whole journey");
assert.equal(hopped.pace, "commuting", "what the Judge set still carries across");

/* A board nothing could claim IS read as foreign by the first named city it
   reaches: a tally counted nowhere anybody can point at has no claim on the
   streets it has just arrived in, and keeping its stay stamp is the failure
   that costs a month. */
assert.equal(await adoptSceneSystem("f3", cityScene("Scene.hillfort")), "settlement");
assert.equal(boardOf("f3").sceneId, "Scene.hillfort");
assert.equal(boardOf("f3").blocks, 0);

/* --- the panel path --------------------------------------------------------
   `settlementMode()` names the scene its formation stands on, so a board
   entered from the panel with the token already placed is claimed there and
   the next city can tell it apart. Naming nothing leaves the stamp standing,
   which is what makes a panel toggle on a party with no token harmless. */
settings.formations.f4 = {
  id: "f4",
  sceneId: "Scene.hillfort",
  travel: { mode: "delve", settlement: { pace: "commuting" } },
};
const panelToggle = (id) => {
  const formation = settings.formations[id];
  return setJourneyMode(formation.id, formation.travel?.mode !== "settlement" ? "settlement" : "delve",
    { sceneId: formation.sceneId });
};
await panelToggle("f4");
assert.equal(settings.formations.f4.travel.mode, "settlement");
assert.equal(boardOf("f4").sceneId, "Scene.hillfort",
  "a board entered from the panel is claimed by the city the party is standing in");
assert.equal(await adoptSceneSystem("f4", cityScene("Scene.riverport")), "settlement",
  "so the next city is an arrival, not a continuation");
assert.equal(boardOf("f4").sceneId, "Scene.riverport");

await setJourneyMode("f4", "delve");
await setJourneyMode("f4", "settlement");
assert.equal(boardOf("f4").sceneId, "Scene.riverport",
  "and naming no city keeps the stamp rather than dropping it");

/* An arrival that names NO city cannot be somewhere new: there is no stamp to
   write, so treating it as foreign would wipe the tally on every call forever.
   The board's own writer and the arrival's test agree, so nothing is announced
   and nothing is rewritten. */
settings.formations.f4.travel.settlement.blocks = 11;
assert.equal(await adoptSceneSystem("f4", { getFlag: () => ({ mapSystem: "settlement" }) }), null,
  "a scene with no id names no city, so it is not another one");
assert.equal(boardOf("f4").blocks, 11, "and the tally is untouched");
assert.equal(boardOf("f4").sceneId, "Scene.riverport");

console.log("test-travel: OK (day board, forced budget, defaults, log cap, one field name, movement axis, city stamp)");
