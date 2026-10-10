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
  applyTravelForm,
  claimUnstampedSettlements,
  composeLogEntry,
  dayBudget,
  freshDay,
  inferredTravelSystem,
  patchSettlement,
  pushLog,
  setJourneyMode,
  traceStep,
  travelOf,
  withDayKind,
  dayIsSpent,
} from "../scripts/formation/travel.mjs";
import { SLOT_HOURS } from "../scripts/formation/march.mjs";
import { DISTRICT_TYPE } from "../scripts/formation/district-find.mjs";
import { TRAVEL_PACE } from "../scripts/lib/movement-scales.mjs";

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

/* --- the day carries what it has spent ------------------------------------ */
const fresh = freshDay();
for (const key of ["miles", "hours", "cadenceCarry", "carrySeconds", "secondsAdvanced"]) {
  assert.equal(fresh[key], 0, `a fresh day has spent no ${key}`);
}
assert.deepEqual(fresh.done, Array(ANCILLARY_SLOTS).fill(false), "and resolved none of its slots");

const underway = {
  ...freshDay(), miles: 11.5, hours: 4.6, cadenceCarry: 2, carrySeconds: 0.25, secondsAdvanced: 16560,
  done: [true, false, false, false],
};
for (const kind of ["forced", "camp", "march"]) {
  const pushedOn = withDayKind(underway, kind);
  assert.equal(pushedOn.miles, 11.5, `pushing on to ${kind} keeps the miles`);
  assert.equal(pushedOn.hours, 4.6);
  assert.equal(pushedOn.cadenceCarry, 2, "and the miles not yet worth a throw");
  assert.equal(pushedOn.carrySeconds, 0.25, "and the fraction of a second the clock owes");
  assert.equal(pushedOn.secondsAdvanced, 16560, "and what the clock has advanced");
  assert.deepEqual(pushedOn.done, [true, false, false, false], "and the slots already resolved");
}
const ended = withDayKind(null, "march");
assert.equal(ended.miles, 0, "ending the day starts a fresh tally");
assert.equal(ended.secondsAdvanced, 0);

/* --- the budget is in hours ------------------------------------------------ */
const SPEED = 2.5; // invented miles per hour
let budget = dayBudget({ day: freshDay("march") }, SPEED);
assert.equal(budget.hours, TRAVEL_PACE.dedicated.hours, "a dedicated day marches its pace's hours");
assert.equal(budget.miles, Math.round(TRAVEL_PACE.dedicated.hours * SPEED * 100) / 100);
budget = dayBudget({ day: withDayKind(null, "forced") }, SPEED);
assert.equal(budget.hours, TRAVEL_PACE.forced.hours, "a forced march has consumed the slots; they add nothing");
budget = dayBudget({ day: { ...freshDay("camp"), activities: ["travel", "travel", null, null] } }, SPEED);
assert.equal(budget.hours, 2 * SLOT_HOURS, "a camp day marches only its travel slots");
budget = dayBudget({ day: { ...freshDay("march"), activities: ["travel", null, "search", null] } }, SPEED);
assert.equal(budget.hours, TRAVEL_PACE.dedicated.hours + SLOT_HOURS, "a march day takes a travel slot on top");

/* --- the day is spent when its hours reach the budget ---------------------- */
assert.equal(dayIsSpent({ hours: 4 }, { hours: 8 }), false);
assert.equal(dayIsSpent({ hours: 8 }, { hours: 8 }), true, "the budget is reached, not exceeded");
assert.equal(dayIsSpent({ hours: 9 }, { hours: 0 }), false, "a day with no budget is never spent by hours");
assert.equal(dayIsSpent({ hours: 9 }, null), false, "nor is one whose budget is unpriced");
assert.equal(dayIsSpent({ hours: 1 }, { hours: 8 }, { dark: true }), true, "a step taken after dusk spends the day");
assert.equal(dayIsSpent({ hours: 1 }, { hours: 8 }, { dark: false }), false);

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
/* A record from before the day counted miles reads as a day with nothing walked. */
t = travelOf({ travel: { day: { hexesEntered: 2 } } });
assert.equal(t.hour, "clock", "the day-or-night source follows the clock unless told otherwise");
assert.equal(t.day.hexesEntered, 2, "what the legacy day did record stays");
assert.equal(t.day.miles, 0);
assert.equal(t.day.hours, 0);
assert.deepEqual(t.day.done, Array(ANCILLARY_SLOTS).fill(false), "a legacy day has resolved no slots");
assert.equal(t.day.activities.length, ANCILLARY_SLOTS);
assert.equal(travelOf({ travel: { hour: "night" } }).hour, "night");
assert.equal(travelOf({ travel: { hour: "constructor" } }).hour, "clock", "a prototype name is not an hour source");
assert.equal(travelOf({ travel: { hour: "noon" } }).hour, "clock", "an hour outside the vocabulary follows the clock");
assert.deepEqual(travelOf({ travel: { day: { done: [true, "yes"] } } }).day.done, [true, true, false, false],
  "done is always one boolean per slot");
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

assert.equal(entry.hours, 0, "the entry records the day's hours beside its miles");
assert.equal(
  composeLogEntry(travelOf({ travel: { day: { hours: 7.256 } } }), { miles: 18 }).hours, 7.26,
  "from the day's own tally, to two decimals",
);
assert.equal(composeLogEntry(journeying, { hours: 5 }).hours, 5, "unless the caller states them");

let log = [];
for (let i = 1; i <= 5; i++) log = pushLog(log, { day: i }, 3);
assert.equal(log.length, 3, "the cap holds");
assert.deepEqual(log.map((e) => e.day), [5, 4, 3], "newest first; the oldest days are what trimming eats");

/* --- the hex trace, one step at a time ------------------------------------- */
const standing = travelOf({});
const arrival = traceStep(standing, { label: "A1", i: 3, j: 4, ground: "hills" });
assert.equal(arrival.crossed, 0, "the first arrival names the hex without entering it");
assert.equal(arrival.travel.hex.label, "A1");
assert.equal(arrival.travel.hex.i, 3);
assert.equal(arrival.travel.ground, "hills", "a painted terrain overrides the ground picker");
assert.equal(arrival.travel.day.hexesEntered, 0);
assert.equal(traceStep(arrival.travel, { label: "A1", i: 3, j: 4 }).travel, arrival.travel,
  "a repeat of the same offset returns the very object it was given");
assert.equal(traceStep(arrival.travel, { label: "A1", i: 3, j: 4 }).crossed, 0);
const crossing = traceStep(arrival.travel, { label: "A2", i: 3, j: 5, road: "earth", winding: 1.5 });
assert.equal(crossing.crossed, 1, "a new offset is a hex entered");
assert.equal(crossing.travel.day.hexesEntered, 1);
assert.equal(crossing.travel.day.winding, 0.5, "only the excess of a bend is banked");
assert.equal(crossing.travel.road, "earth", "a drawn network overrides the road picker");
assert.equal(crossing.travel.ground, "hills", "an unpainted hex leaves the ground standing");
assert.equal(standing.hex.i, null, "the record passed in is never changed");
const grained = traceStep(crossing.travel, { label: "A3", i: 3, j: 6, ground: "forest", encounterTerrain: "forestTaiga" });
assert.equal(grained.travel.ground, "forest");
assert.equal(grained.travel.encounterTerrain, "forestTaiga", "a hex painted at the book's grain writes the encounter pick");
const river = traceStep(grained.travel, { label: "A4", i: 3, j: 7, ground: null, encounterTerrain: "riverLand" });
assert.equal(river.travel.ground, "forest", "a river names no ground: the last one stands");
assert.equal(river.travel.encounterTerrain, "riverLand");
const bare = traceStep(river.travel, { label: "A5", i: 3, j: 8, ground: "hills", encounterTerrain: "" });
assert.equal(bare.travel.ground, "hills", "a bare ground sets the ground");
assert.equal(bare.travel.encounterTerrain, "riverLand", "and leaves the pick standing");

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
/** The mode an adoption landed on, or null when nothing moved. */
const adopt = async (id, scene) => (await adoptSceneSystem(id, scene))?.mode ?? null;

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

assert.equal(await adopt("f1", cityScene("Scene.riverport")), null,
  "arriving where the board already says it is moves nothing");
assert.equal(boardOf("f1").blocks, 40, "and takes nothing off it");

assert.equal(await adopt("f1", cityScene("Scene.hillfort")), "settlement",
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
assert.equal(arrived.hour, "night", "a board from before the hour had a source arrives on the Judge's word");
assert.equal("night" in arrived, false, "and the old flag is not written back");

/* The board's own writer takes the hour by name, and still reads the older
   boolean a caller written to it sends. */
await patchSettlement("f1", { hour: "day" });
assert.equal(boardOf("f1").hour, "day");
await patchSettlement("f1", { hour: "clock" });
assert.equal(boardOf("f1").hour, "clock");
await patchSettlement("f1", { hour: "noon" });
assert.equal(boardOf("f1").hour, "clock", "an hour outside the vocabulary follows the clock");
await patchSettlement("f1", { night: true });
assert.equal(boardOf("f1").hour, "night", "the older tick is the Judge's word for night");
await patchSettlement("f1", { night: false });
assert.equal(boardOf("f1").hour, "day", "and the older clear their word for day");
await patchSettlement("f1", { night: true, hour: "clock" });
assert.equal(boardOf("f1").hour, "clock", "named beside the boolean, the hour wins");

/* A dungeon under the city it is already in: the mode flips, and coming back
   up starts a fresh tally without forgetting what the Judge set. */
await setJourneyMode("f1", "delve");
assert.equal(boardOf("f1").pace, "commuting", "leaving a city keeps the board whole");
assert.equal(await adopt("f1", cityScene("Scene.hillfort")), "settlement");
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

assert.equal(await adopt("f2", cityScene("Scene.hillfort")), null,
  "the city it was claimed for is not an arrival");
assert.equal(boardOf("f2").blocks, 17, "so the tally the party is standing in the middle of stays");

/* The hop the upgrade used to lose. */
assert.equal(await adopt("f2", cityScene("Scene.riverport")), "settlement");
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
assert.equal(await adopt("f3", cityScene("Scene.hillfort")), "settlement");
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
assert.equal(await adopt("f4", cityScene("Scene.riverport")), "settlement",
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
assert.equal(await adopt("f4", { getFlag: () => ({ mapSystem: "settlement" }) }), null,
  "a scene with no id names no city, so it is not another one");
assert.equal(boardOf("f4").blocks, 11, "and the tally is untouched");
assert.equal(boardOf("f4").sceneId, "Scene.riverport");

/* --- the system a scene calls for -------------------------------------------
   A declaration wins; else a cell of a mile or more is a journey; else a
   district drawn on the map is a city; else silence. Invented cells: 7 miles,
   5 feet. */
const mapScene = ({ declared = null, distance = 5, units = "ft", districts = false, id = "Scene.x" } = {}) => ({
  id,
  getFlag: () => (declared ? { mapSystem: declared } : {}),
  grid: { distance, units },
  regions: districts ? [{ behaviors: [{ type: DISTRICT_TYPE, disabled: false }] }] : [],
});
assert.deepEqual(inferredTravelSystem(mapScene({ declared: "delve", distance: 7, units: "mi" })),
  { system: "delve", source: "declared" }, "a declared delve on a 7-mile grid is still a delve");
assert.deepEqual(inferredTravelSystem(mapScene({ distance: 7, units: "mi" })),
  { system: "journey", source: "scale" }, "an undeclared 7-mile grid is a journey");
assert.deepEqual(inferredTravelSystem(mapScene({ districts: true })),
  { system: "settlement", source: "districts" }, "a district drawn on the map makes it a city");
assert.deepEqual(inferredTravelSystem(mapScene({ districts: true, distance: 7, units: "mi" })),
  { system: "journey", source: "scale" }, "scale outranks districts");
assert.deepEqual(inferredTravelSystem(mapScene({ declared: "settlement", distance: 7, units: "mi" })),
  { system: "settlement", source: "declared" }, "and a declaration outranks both");
assert.deepEqual(inferredTravelSystem(mapScene()), { system: null, source: null }, "nothing said, nothing shown: silence");
assert.deepEqual(inferredTravelSystem(null), { system: null, source: null }, "no scene at all is silence too");
const disabledDistrict = mapScene();
disabledDistrict.regions = [{ behaviors: [{ type: DISTRICT_TYPE, disabled: true }] }];
assert.equal(inferredTravelSystem(disabledDistrict).system, null, "a disabled district is no evidence");

settings.formations.g1 = { id: "g1", travel: { mode: "delve" } };
assert.deepEqual(await adoptSceneSystem("g1", mapScene({ id: "Scene.shire", distance: 7, units: "mi" })),
  { mode: "journey", source: "scale" }, "adoption reports the mode and what called for it");
assert.equal(settings.formations.g1.travel.mode, "journey");
assert.equal(await adoptSceneSystem("g1", mapScene({ id: "Scene.shire", distance: 7, units: "mi" })), null,
  "arriving where the mode already holds moves nothing");
assert.deepEqual(await adoptSceneSystem("g1", mapScene({ id: "Scene.keep", declared: "delve" })),
  { mode: "delve", source: "declared" });
assert.equal(await adoptSceneSystem("g1", mapScene({ id: "Scene.blank" })), null, "a blank small map leaves the mode alone");

/* --- a mode change clears any pause and re-anchors the baseline -------------- */
const moorToken = { x: 640, y: 480 };
const moor = { id: "Scene.moor", tokens: { get: (id) => (id === "tok.moor" ? moorToken : null) } };
globalThis.game.scenes = { get: (id) => (id === "Scene.moor" ? moor : null) };
settings.formations.g2 = {
  id: "g2", sceneId: "Scene.moor", tokenId: "tok.moor",
  clock: { paused: true, pausedBy: "judge", lastPosition: { x: 0, y: 0 }, turnsTotal: 4 },
  travel: { mode: "delve" },
};
await setJourneyMode("g2", "journey");
assert.equal(settings.formations.g2.clock.paused, false, "a journey is not paused by entering it");
assert.equal(settings.formations.g2.clock.pausedBy, null, "and nobody holds the pause");
assert.deepEqual(settings.formations.g2.clock.lastPosition, { x: 640, y: 480 },
  "the next drag is measured from where the token stands now");
assert.equal(settings.formations.g2.clock.turnsTotal, 4, "nothing else on the clock moves");
settings.formations.g2.clock.paused = true;
settings.formations.g2.clock.pausedBy = "judge";
moorToken.x = 700;
await setJourneyMode("g2", "delve");
assert.equal(settings.formations.g2.clock.paused, false, "leaving a journey clears a pause as well");
assert.equal(settings.formations.g2.clock.pausedBy, null);
assert.deepEqual(settings.formations.g2.clock.lastPosition, { x: 700, y: 480 }, "and re-anchors to the token's new position");
settings.formations.g3 = { id: "g3", sceneId: null, clock: { lastPosition: { x: 5, y: 5 } }, travel: { mode: "delve" } };
await setJourneyMode("g3", "journey");
assert.deepEqual(settings.formations.g3.clock.lastPosition, { x: 5, y: 5 }, "a party with no token keeps the baseline it had");

/* --- the day's and camp's declarations ------------------------------------- */
{
  const bare = freshDay();
  assert.equal(bare.traps, 0, "a fresh day declares no traps");
  assert.equal(bare.noSleep, false, "and no sleepless night");
  const declared = { ...freshDay(), traps: 5, noSleep: true, activities: ["hunt", null, null, null] };
  const rolled = withDayKind(declared, "camp");
  assert.equal(rolled.traps, 5, "changing the kind keeps what was declared");
  assert.equal(rolled.noSleep, true);
  assert.equal(withDayKind(null, "march").traps, 0, "ending the day clears the declarations");
  assert.equal(withDayKind(null, "march").noSleep, false);

  assert.deepEqual(ANCILLARY_ACTIVITIES.traps, {
    label: "ACKS-FORMATION.travel.activity.traps", frequency: "perAttempt", declared: true,
  }, "traps are an attempt-cadence activity the day form declares rather than a slot pick");

  const legacy = travelOf({ travel: { day: { traps: "7.9", noSleep: "yes" }, trapsCarry: -3 } });
  assert.equal(legacy.day.traps, 7, "a declared count is a whole number");
  assert.equal(legacy.day.noSleep, true);
  assert.equal(legacy.trapsCarry, 0, "a negative carry reads as none");
  assert.equal(travelOf({ travel: { day: { traps: "x" } } }).day.traps, 0, "and a non-number as none");
  assert.deepEqual(travelOf({}).camp, { steal: false, water: false, sleepInArmour: false }, "no camp word is all noes");
  assert.deepEqual(travelOf({ travel: { camp: { steal: 1, water: "", sleepInArmour: true } } }).camp,
    { steal: true, water: false, sleepInArmour: true });
  assert.equal(travelOf({}).trapsCarry, 0);
  assert.deepEqual(travelOf({ travel: { weatherRuns: { foggy: 3 } } }).weatherRuns, { foggy: 3 }, "the sky's runs are carried untouched");
  assert.deepEqual(travelOf({}).weatherRuns, {});

  const entry2 = composeLogEntry(travelOf({ travel: { day: { traps: 4, noSleep: true } } }), { miles: 1 });
  assert.equal(entry2.traps, 4, "the log row keeps the day's trap count, since End day resets the board first");
  assert.equal(entry2.noSleep, true);
  assert.equal(composeLogEntry(travelOf({}), {}).traps, 0);
}

/* --- applyTravelForm: the declaration groups --------------------------------- */
{
  settings.formations.d1 = { id: "d1", travel: { mode: "journey", camp: { steal: true, water: true, sleepInArmour: true }, day: { traps: 3, noSleep: true } } };
  const at = () => travelOf(settings.formations.d1);

  await applyTravelForm("d1", { camp: { declared: "1", water: "on" } });
  assert.deepEqual(at().camp, { steal: false, water: true, sleepInArmour: false },
    "an unticked box is absent from the submit, and the group's marker makes it a no");

  await applyTravelForm("d1", { ground: "hills" });
  assert.deepEqual(at().camp, { steal: false, water: true, sleepInArmour: false }, "a submit without the group leaves the camp alone");
  assert.equal(at().day.traps, 3, "and the day's declarations");
  assert.equal(at().day.noSleep, true);

  await applyTravelForm("d1", { day: { declared: "1", traps: "9" } });
  assert.equal(at().day.traps, 9);
  assert.equal(at().day.noSleep, false, "an absent sleepless box clears");

  await applyTravelForm("d1", { day: { declared: "1", traps: "-4", noSleep: "on" } });
  assert.equal(at().day.traps, 0, "a negative count is none");
  assert.equal(at().day.noSleep, true);

  await applyTravelForm("d1", { day: { kind: "camp" } });
  assert.equal(at().day.kind, "camp", "the existing day-kind branch still works");
  assert.equal(at().day.noSleep, true, "and does not touch the declarations");
  await applyTravelForm("d1", { day: { slot: { 0: "hunt" } } });
  assert.equal(at().day.activities[0], "hunt", "and so does a slot pick");
}

/* --- the navigation throw carries the sky ------------------------------------- */
{
  const { registerTable, unregisterTable, PRIORITY } = await import("../scripts/lib/tables.mjs");
  const { landNavigationSpec } = await import("../scripts/formation/travel.mjs");
  unregisterTable("travel"); unregisterTable("weather");
  registerTable({ id: "travel", source: "invented", tables: { gettingLost: { hills: 13 } } }, { priority: PRIORITY.WORLD, source: "test" });
  const lost = (precipitation) => ({ members: [], travel: { ground: "hills", weather: { precipitation } } });
  assert.equal(landNavigationSpec(lost("foggy")).weather, 0, "an unimported effects table asks for nothing");
  registerTable({
    id: "weather", source: "invented",
    tables: { conditionEffects: { foggy: { throws: { navigation: -3 } }, rainy: { throws: { navigation: -1 } } } },
  }, { priority: PRIORITY.WORLD, source: "test" });
  const spec = landNavigationSpec(lost("foggy"));
  assert.equal(spec.weather, -3, "the sky's modifier rides the spec");
  assert.equal(spec.target, 13, "and leaves the target alone");
  assert.equal(landNavigationSpec(lost("rainy")).weather, -1);
  assert.equal(landNavigationSpec(lost("clear")).weather, 0, "a fair sky costs nothing");
  assert.equal(landNavigationSpec({ members: [], travel: { road: "earth", ground: "hills" } }).throws, false, "a road still needs no throw");
  unregisterTable("travel"); unregisterTable("weather");
}

console.log("test-travel: OK (day board, hours budget, defaults, log cap, one field name, movement axis, city stamp, inferred system, mode re-anchor, declarations, sky on the nav throw)");
