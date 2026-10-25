/**
 * The travel engine's pure half: the day board's budget, the subtree's
 * defaults, the log's composition and cap, the country's one resolver and the
 * trace's reading of the map. Invented values throughout — the printed
 * frequencies and multipliers arrive through the registry and are asserted
 * only in the machine-local rules tests.
 */
import assert from "node:assert/strict";
import {
  ANCILLARY_ACTIVITIES,
  ANCILLARY_SLOTS,
  COUNTRY_DEFAULTS,
  DAY_KINDS,
  adoptSceneSystem,
  applyTravelForm,
  claimUnstampedSettlements,
  clearDeclaredCountry,
  composeLogEntry,
  countryOf,
  dayBudget,
  freshDay,
  inferredTravelSystem,
  patchSettlement,
  pushLog,
  rollWeatherNow,
  sameReading,
  sceneScaleChanged,
  setJourneyMode,
  storedTravelOf,
  traceStep,
  travelOf,
  withDayKind,
  dayIsSpent,
} from "../scripts/formation/travel.mjs";
import { CLIMATES } from "../scripts/formation/weather.mjs";
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

/* --- the hex trace, one step at a time -------------------------------------
   A step caches the map's reading of the hex it lands in (`travel.map`). It
   never writes the six country keys: those stay the declared record's, and
   the map stays a source under the Judge's word. */
const standing = storedTravelOf({});
const arrival = traceStep(standing, { label: "A1", i: 3, j: 4, sceneId: "S.trace", ground: "hills" });
assert.equal(arrival.crossed, 0, "the first arrival names the hex without entering it");
assert.equal(arrival.travel.hex.label, "A1");
assert.equal(arrival.travel.hex.i, 3);
assert.equal(arrival.travel.map.ground, "hills", "the step's ground is the map's reading of the hex");
assert.equal(arrival.travel.map.source.ground, "map");
assert.deepEqual([arrival.travel.map.sceneId, arrival.travel.map.i, arrival.travel.map.j], ["S.trace", 3, 4],
  "read on the step's scene, at the step's offset");
for (const key of ["ground", "road", "following", "territory", "encounterTerrain"]) {
  assert.equal(key in arrival.travel, false, `the trace never writes the declared ${key}`);
}
assert.equal(arrival.travel.day.hexesEntered, 0);
assert.equal(traceStep(arrival.travel, { label: "A1", i: 3, j: 4 }).travel, arrival.travel,
  "a repeat of the same offset returns the very object it was given");
assert.equal(traceStep(arrival.travel, { label: "A1", i: 3, j: 4 }).crossed, 0);
const reread = traceStep(arrival.travel, { label: "A1", i: 3, j: 4, ground: "forest" });
assert.equal(reread.crossed, 0, "the same offset read differently counts nothing");
assert.equal(reread.travel.map.ground, "forest", "but its reading is replaced");
assert.equal(reread.travel.day, arrival.travel.day, "and the day is left as it was");
const crossing = traceStep(arrival.travel, { label: "A2", i: 3, j: 5, road: "earth", winding: 1.5 });
assert.equal(crossing.crossed, 1, "a new offset is a hex entered");
assert.equal(crossing.travel.day.hexesEntered, 1);
assert.equal(crossing.travel.day.winding, 0.5, "only the excess of a bend is banked");
assert.equal(crossing.travel.map.road, "earth", "the road the step walked is the map's reading of it");
assert.equal(crossing.travel.map.ground, null, "a crossing reads its own hex: the last hex's ground is not carried");
assert.equal(crossing.travel.map.sceneId, "S.trace", "a step naming no scene stays on the last reading's");
assert.equal(standing.hex.i, null, "the record passed in is never changed");
const silent = traceStep(crossing.travel, { label: "A3", i: 3, j: 6 });
assert.equal(silent.crossed, 1);
assert.equal(silent.travel.map, null, "a crossing whose step read nothing leaves no reading to mistake for this hex's");
const drawn = {
  sceneId: "S.trace", i: 3, j: 7, at: 9,
  ground: "forest", encounterTerrain: "forestTaiga", territory: "outlands", climate: null, road: null, following: "river",
  source: { ground: "map", encounterTerrain: "map", territory: "scene", climate: null, road: null, following: "map" },
  water: { kind: "river", navigable: true },
};
const mapped = traceStep(silent.travel, { label: "A4", i: 3, j: 7, map: drawn });
assert.equal(mapped.travel.map.territory, "outlands", "a reading off the map is cached whole");
assert.equal(mapped.travel.map.source.territory, "scene", "with the source of each key");
assert.deepEqual(mapped.travel.map.water, { kind: "river", navigable: true }, "and the water under the hex");
const walkedRoad = traceStep(mapped.travel, { label: "A5", i: 3, j: 8, map: { ...drawn, i: 3, j: 8, road: null }, road: "paved" });
assert.equal(walkedRoad.travel.map.road, "paved", "the road a step walked is laid over the map's reading of the hex");
assert.equal(walkedRoad.travel.map.ground, "forest", "and the rest of the reading stands");

/* --- the country, resolved -------------------------------------------------
   Each of the six keys answers from the first source that holds a value it
   may take: the Judge's word (`travel.override`), the map's reading of the
   party's hex (`travel.map`, the hex's own or the scene default's), the
   declared record, then the default. The map's reading describes the party
   only while its token stands on the scene it was read on. */
const [CLIMATE_A, CLIMATE_B] = Object.keys(CLIMATES);
const readingOf = (values, source = {}, extra = {}) => ({
  sceneId: "S.c", i: 0, j: 0, at: 0,
  ground: null, encounterTerrain: null, territory: null, climate: null, road: null, following: null, water: null,
  ...values, source, ...extra,
});
const placed = (travel, at = { sceneId: "S.c", tokenId: "T.c" }) => ({ ...at, travel: { mode: "journey", ...travel } });
const KEYS = ["ground", "encounterTerrain", "territory", "climate", "road", "following"];
const valueOf = (tv, key) => (key === "climate" ? tv.weather.climate : tv[key]);

t = travelOf({});
for (const key of KEYS) {
  assert.equal(valueOf(t, key), COUNTRY_DEFAULTS[key], `nothing said, ${key} is the default`);
  assert.equal(t.provenance[key], "default");
}

const declaredRecord = {
  travel: {
    ground: "hills", encounterTerrain: "hillsRocky", territory: "outlands", road: "paved", following: "river",
    weather: { climate: CLIMATE_A },
  },
};
t = travelOf(declaredRecord);
for (const key of KEYS) {
  assert.equal(valueOf(t, key), valueOf(declaredRecord.travel, key), `a record from before the map was read keeps its ${key}`);
  assert.equal(t.provenance[key], "declared", `and says the ${key} was declared`);
}
t = travelOf({ travel: { territory: "borderlands", road: "none", following: "none" } });
assert.deepEqual([t.provenance.territory, t.provenance.road, t.provenance.following], ["default", "default", "default"],
  "a stored default says nothing about what the Judge declared");

const fromMap = readingOf(
  { ground: "forest", encounterTerrain: "forestTaiga", territory: "civilized", climate: CLIMATE_B, road: "earth", following: "river" },
  { ground: "map", encounterTerrain: "map", territory: "scene", climate: "scene", road: "map", following: "map" },
);
t = travelOf(placed({ ...declaredRecord.travel, map: fromMap }));
assert.equal(t.ground, "forest", "the map's reading beats the declared record");
assert.equal(t.provenance.ground, "map");
assert.equal(t.encounterTerrain, "forestTaiga");
assert.equal(t.territory, "civilized");
assert.equal(t.provenance.territory, "scene", "a key the scene's default answered says so");
assert.equal(t.weather.climate, CLIMATE_B, "the climate is resolved in its own place");
assert.equal(t.provenance.climate, "scene");
assert.equal(t.road, "earth");
assert.equal(t.following, "river");

t = travelOf(placed({ ...declaredRecord.travel, map: readingOf({ ground: "forest" }, { ground: "map" }) }));
assert.equal(t.ground, "forest");
assert.equal(t.territory, "outlands", "a key the map is silent on falls to the declared record");
assert.equal(t.provenance.territory, "declared");

const overridden = placed({
  ...declaredRecord.travel,
  map: fromMap,
  override: { ground: "swamp", territory: "nowhere", climate: CLIMATE_B },
});
t = travelOf(overridden);
assert.equal(t.ground, "swamp", "the Judge's word beats the map");
assert.equal(t.provenance.ground, "override");
assert.equal(t.weather.climate, CLIMATE_B);
assert.equal(t.provenance.climate, "override");
assert.equal(t.territory, "civilized", "a word outside the vocabulary is no word");
assert.equal(t.provenance.territory, "scene");
const { mapValues } = countryOf(overridden);
assert.equal(mapValues.ground, "forest", "and what the map reads under the Judge's word stays known");
assert.equal(mapValues.territory, "civilized");

t = travelOf(placed({ ...declaredRecord.travel, map: fromMap }, { sceneId: "S.elsewhere", tokenId: "T.c" }));
assert.equal(t.ground, "hills", "a reading of another scene says nothing about this one");
assert.equal(t.provenance.ground, "declared");
t = travelOf(placed({ ...declaredRecord.travel, map: fromMap }, { sceneId: "S.c", tokenId: null }));
assert.equal(t.ground, "hills", "nor does any reading while the party has no token");
assert.equal(countryOf(placed({ map: fromMap }, { sceneId: "S.c", tokenId: null })).mapValues.ground, null);

/* A key a paint layer derived reads as the reading names its source: that
   layer's key, passed through, and never folded into the map's. The layer
   here is an invented one, so nothing below names a layer the module ships. */
const derived = readingOf({ ground: "forest", territory: "civilized" }, { ground: "map", territory: "demoRealm" });
t = travelOf(placed({ ...declaredRecord.travel, map: derived }));
assert.deepEqual([t.territory, t.provenance.territory], ["civilized", "demoRealm"], "a derived territory names the layer that derived it");
assert.equal(t.provenance.ground, "map", "beside a painted key that stays the map's");
assert.equal(travelOf(placed({ map: readingOf({ ground: "forest" }) })).provenance.ground, "map", "a reading that names no source is the map's");
const overDerived = placed({ map: derived, override: { territory: "outlands" } });
assert.deepEqual([travelOf(overDerived).territory, travelOf(overDerived).provenance.territory], ["outlands", "override"],
  "the Judge's word stands over a derived territory");
assert.equal(countryOf(overDerived).mapValues.territory, "civilized", "and the derived class stays known under it");
assert.equal(sameReading(readingOf({ territory: "civilized" }, { territory: "map" }), readingOf({ territory: "civilized" }, { territory: "demoRealm" })),
  false, "the same territory from another source is a change worth a write");

/* The river's table answers only while the party moves on the water over a
   water line; the ground it runs through picks which. */
const riverHex = (ground) => readingOf({ ground, encounterTerrain: "grassland" }, { ground: "map", encounterTerrain: "map" },
  { water: { kind: "river", navigable: true } });
assert.equal(travelOf(placed({ movement: { mode: "vessel" }, map: riverHex("desert") })).encounterTerrain, "riverDesertJungle");
assert.equal(travelOf(placed({ movement: { mode: "vessel" }, map: riverHex("jungle") })).encounterTerrain, "riverDesertJungle");
assert.equal(travelOf(placed({ movement: { mode: "vessel" }, map: riverHex("forest") })).encounterTerrain, "riverLand");
assert.equal(travelOf(placed({ movement: { mode: "vessel" }, map: riverHex("forest") })).provenance.encounterTerrain, "map");
assert.equal(travelOf(placed({ movement: { mode: "vessel" }, map: { ...riverHex("forest"), source: { ground: "map", encounterTerrain: "scene" } } }))
  .provenance.encounterTerrain, "map", "the river's table is the water's, whatever answered the hex's own");
assert.equal(travelOf(placed({ movement: { mode: "foot" }, map: riverHex("forest") })).encounterTerrain, "grassland",
  "a party on foot beside the river throws on the land's table");
assert.equal(travelOf(placed({ movement: { mode: "vessel" }, map: { ...riverHex("forest"), water: null } })).encounterTerrain, "grassland",
  "and a boat with no water line under it on the hex's own");

/* An overridden ground takes the table with it: the map's and the record's
   tables were read with another ground, and the river's is the water's. */
t = travelOf(placed({ ...declaredRecord.travel, map: fromMap, override: { ground: "desert" } }));
assert.equal(t.encounterTerrain, "", "the map's table is not the overridden ground's");
assert.equal(t.provenance.encounterTerrain, "default", "nor is the record's: the ground's own table answers at use");
assert.equal(countryOf(placed({ map: fromMap, override: { ground: "desert" } })).mapValues.encounterTerrain, "forestTaiga",
  "what the map reads under the Judge's ground stays known");
assert.equal(travelOf(placed({ map: fromMap, override: { ground: "desert", encounterTerrain: "hillsRocky" } })).encounterTerrain, "hillsRocky",
  "the Judge's own table stands over the ground's");
t = travelOf(placed({ movement: { mode: "vessel" }, map: riverHex("forest"), override: { ground: "desert" } }));
assert.deepEqual([t.encounterTerrain, t.provenance.encounterTerrain], ["riverDesertJungle", "map"],
  "afloat, the river's table is read for the overridden ground");

/* A writer's view: the country keys exactly as stored. */
assert.equal("ground" in storedTravelOf({}), false, "nothing stored, nothing written back");
assert.equal(storedTravelOf({ travel: { territory: "outlands" } }).territory, "outlands");
assert.deepEqual(storedTravelOf(overridden).override, overridden.travel.override, "the override is carried as stored");
assert.equal(storedTravelOf(overridden).weather.climate, CLIMATE_A, "and the declared climate where it was stored, not the Judge's");
assert.equal(storedTravelOf(placed({ map: fromMap })).weather.climate, "", "a climate the map answered is never written back");
assert.equal(storedTravelOf(placed({ map: fromMap })).map, fromMap, "and the map's reading");

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

// A scene update re-reads the map's system when it touches what the scale is
// read from, and only then.
assert.equal(sceneScaleChanged({ grid: { distance: 6 } }), true, "a new cell distance can change the scale");
assert.equal(sceneScaleChanged({ grid: { units: "mi" } }), true, "so can new units");
assert.equal(sceneScaleChanged({ grid: { distance: 6, units: "mi" } }), true, "and both together");
assert.equal(sceneScaleChanged({ grid: { size: 150 } }), false, "a cell's size in pixels says nothing about the scale");
assert.equal(sceneScaleChanged({ grid: { color: "#000000", alpha: 0.5 } }), false, "nor does its drawing");
assert.equal(sceneScaleChanged({ name: "Renamed" }), false, "an update that leaves the grid alone changes nothing");
assert.equal(sceneScaleChanged(null), false, "no changes at all is no change");

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
assert.equal(settings.formations.g3.travel.map, undefined, "and has no country under it to read");

/* A journey begun where the token stands reads the country under it at once:
   here a gridless scene whose default says the ground and the territory. */
{
  globalThis.CONST ??= { GRID_TYPES: { GRIDLESS: 0, SQUARE: 1, HEXODDR: 2, HEXEVENR: 3, HEXODDQ: 4, HEXEVENQ: 5 } };
  const heath = { id: "Scene.heath", grid: { type: 0, size: 100 }, regions: [], tokens: { get: (id) => (id === "tok.heath" ? heathToken : null) } };
  heath.getFlag = () => ({ country: { ground: "hills", territory: "outlands" } });
  const heathToken = { x: 200, y: 300, width: 1, height: 1, parent: heath };
  globalThis.game.scenes = { get: (id) => (id === "Scene.heath" ? heath : null) };
  settings.formations.g4 = { id: "g4", sceneId: "Scene.heath", tokenId: "tok.heath", clock: {}, travel: { mode: "delve", ground: "swamp" } };
  await setJourneyMode("g4", "journey");
  const map = settings.formations.g4.travel.map;
  assert.equal(map.sceneId, "Scene.heath", "the reading is of the scene the token stands on");
  assert.deepEqual([map.i, map.j], [null, null], "off a hex grid it names no hex");
  assert.equal(map.ground, "hills");
  assert.equal(map.source.ground, "scene", "and says the scene's default answered");
  assert.equal(settings.formations.g4.travel.ground, "swamp", "the declared ground is left as it was");
  const read = travelOf(settings.formations.g4);
  assert.equal(read.ground, "hills", "the scene's default now answers over the declaration");
  assert.equal(read.provenance.ground, "scene");
  assert.equal(read.territory, "outlands");
  await setJourneyMode("g4", "delve");
  assert.equal(settings.formations.g4.travel.map.sceneId, "Scene.heath", "leaving the journey reads nothing new and drops nothing");
}

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
  assert.deepEqual(travelOf({}).camp, { steal: false, water: false, sleepInArmour: false, present: null, target: "anything" },
    "no camp word is all noes, nothing said of the search");
  assert.deepEqual(travelOf({ travel: { camp: { steal: 1, water: "", sleepInArmour: true, present: "yes", target: "p9" } } }).camp,
    { steal: true, water: false, sleepInArmour: true, present: "yes", target: "p9" });
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
  assert.deepEqual(at().camp, { steal: false, water: true, sleepInArmour: false, present: null, target: "anything" },
    "an unticked box is absent from the submit, and the group's marker makes it a no");

  await applyTravelForm("d1", { ground: "hills" });
  assert.deepEqual(at().camp, { steal: false, water: true, sleepInArmour: false, present: null, target: "anything" },
    "a submit without the group leaves the camp alone");
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

  // What a player's seat is shown: one of the two kinds, and nothing else.
  assert.equal(at().shown, "believed", "the believed hex by default");
  await applyTravelForm("d1", { shown: "unknown" });
  assert.equal(at().shown, "unknown", "the Judge's tile writes the kind");
  await applyTravelForm("d1", { shown: "bogus" });
  assert.equal(at().shown, "unknown", "a kind the module does not know is refused");
  await applyTravelForm("d1", { ground: "hills" });
  assert.equal(at().shown, "unknown", "a submit that names no kind leaves it");
  await applyTravelForm("d1", { shown: "believed" });
  assert.equal(at().shown, "believed");
}

/* --- applyTravelForm: the search's answers ride the camp group --------------- */
{
  settings.formations.s1 = { id: "s1", travel: { mode: "journey" } };
  const at = () => travelOf(settings.formations.s1).camp;
  await applyTravelForm("s1", { camp: { declared: "1", present: "yes", target: "p2" } });
  assert.equal(at().present, "yes", "the Judge's yes is kept on the record");
  assert.equal(at().target, "p2", "and so is what the search looks for");
  await applyTravelForm("s1", { camp: { declared: "1", steal: "on" } });
  assert.equal(at().present, "yes", "a submit without the selects (a player's) keeps the word");
  assert.equal(at().target, "p2");
  assert.equal(at().steal, true, "while the booleans are read as before");
  await applyTravelForm("s1", { camp: { declared: "1", present: "bogus", target: "" } });
  assert.equal(at().present, null, "an answer the record does not know reads as nothing said");
  assert.equal(at().target, "anything", "and an empty target as anything");
}

/* --- Roll weather files the sky under the day the day change settles ---------- */
{
  const savedTime = game.time;
  const DAY = 24 * 60 * 60;
  const climate = Object.keys(CLIMATES)[0];
  game.time = {
    worldTime: 375 * DAY + 3600,
    calendar: { days: { hoursPerDay: 24, minutesPerHour: 60, secondsPerMinute: 60 } },
    components: { hour: 1, minute: 0, second: 0 },
  };
  settings.formations.w1 = { id: "w1", travel: { mode: "journey", dayCount: 4, weather: { climate, season: "winter" } } };
  const sky = (temperature) => ({ ok: true, temperature, temperatureNight: temperature - 5, precipitation: "none", wind: "calm", rolls: [] });
  settings.skyCache = { [`0|${climate}|winter`]: sky(1), [`375|${climate}|winter`]: sky(7), [`4|${climate}|winter`]: sky(3) };
  assert.ok(await rollWeatherNow("w1"), "a cached sky is applied");
  assert.equal(travelOf(settings.formations.w1).weather.temperature, 7, "under the calendar day, never day 0");
  delete game.time.calendar;
  delete game.time.components;
  await rollWeatherNow("w1");
  assert.equal(travelOf(settings.formations.w1).weather.temperature, 3, "with no calendar, under the End-day counter");
  delete settings.skyCache;
  game.time = savedTime;
}

/* --- applyTravelForm: the Judge's word on the country -------------------------
   The six keys land in `travel.override`, never in the declared record; a blank
   clears the one key it names, and the last one cleared takes the group with it. */
{
  const [CLIMATE] = Object.keys(CLIMATES);
  settings.formations.o1 = { id: "o1", travel: { mode: "journey", ground: "hills" } };
  const stored = () => settings.formations.o1.travel;
  await applyTravelForm("o1", { override: { ground: "swamp", territory: "", climate: CLIMATE } });
  assert.deepEqual(stored().override, { ground: "swamp", climate: CLIMATE }, "the hand's selects write the Judge's word");
  assert.equal(stored().ground, "hills", "and leave the declared record alone");
  assert.equal(travelOf(settings.formations.o1).ground, "swamp");
  assert.equal(travelOf(settings.formations.o1).provenance.ground, "override");
  assert.equal(travelOf(settings.formations.o1).weather.climate, CLIMATE);

  await applyTravelForm("o1", { override: { ground: "" } });
  assert.deepEqual(stored().override, { climate: CLIMATE }, "a blank clears the key it names and no other");
  assert.equal(travelOf(settings.formations.o1).ground, "hills", "and the declaration under it answers again");

  await applyTravelForm("o1", { road: "paved", weather: { climate: "" } });
  assert.deepEqual(stored().override, { road: "paved" }, "a key at the form's top level is the same word, routed the same way");
  assert.equal(stored().road, undefined);

  await applyTravelForm("o1", { override: { territory: "nowhere" } });
  assert.deepEqual(stored().override, { road: "paved" }, "a value outside the vocabulary is refused");

  await applyTravelForm("o1", { override: { road: "" } });
  assert.equal("override" in stored(), false, "the last word cleared leaves no override behind");

  await applyTravelForm("o1", { day: { kind: "camp" } });
  assert.equal("override" in stored(), false, "and a submit naming none of the six leaves the group alone");
}

/* --- clearDeclaredCountry: an older record's word is retired -------------------
   The key's default is written over the declaration, which reads as nothing
   declared; the climate in its own place; the Judge's word is never touched. */
{
  const [CLIMATE] = Object.keys(CLIMATES);
  settings.formations.c1 = {
    id: "c1",
    travel: { mode: "journey", following: "river", encounterTerrain: "hillsRocky", weather: { climate: CLIMATE }, override: { road: "paved" } },
  };
  const stored = () => settings.formations.c1.travel;
  assert.equal(travelOf(settings.formations.c1).provenance.following, "declared");
  await clearDeclaredCountry("c1", "following");
  assert.equal(stored().following, COUNTRY_DEFAULTS.following, "the default is written over the declaration");
  assert.equal(travelOf(settings.formations.c1).provenance.following, "default", "which reads as nothing declared");
  assert.equal(stored().encounterTerrain, "hillsRocky", "and no other key moves");
  await clearDeclaredCountry("c1", "climate");
  assert.equal(stored().weather.climate, "", "the climate is cleared in its own place");
  assert.deepEqual(stored().override, { road: "paved" }, "the Judge's word is not touched");
  assert.equal(await clearDeclaredCountry("c1", "nowhere"), null, "a key outside the six is refused");
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

/* --- the navigation record: one throw a day, ten kept, none at End day -------- */
{
  const {
    NAVIGATION_HISTORY, claimNavigationDay, endDay, journeyDayKey, navigationEntry, navigationOf, navigationOwed,
    recordNavigationThrow, withNavigationThrow,
  } = await import("../scripts/formation/travel.mjs");
  const { registerTable, unregisterTable, PRIORITY } = await import("../scripts/lib/tables.mjs");

  assert.deepEqual(navigationOf(undefined), { thrownOn: null, lastResult: null, history: [] }, "a party that never threw has thrown nothing");
  const odd = navigationOf({ navigation: { thrownOn: "4:7", lastResult: "no", history: [null, { day: "2:0", count: 0.9, total: 9, success: "yes", by: "wind" }, 7] } });
  assert.equal(odd.thrownOn, "4:7", "a day key is kept as the string it was claimed under");
  assert.equal(navigationOf({ navigation: { thrownOn: 4 } }).thrownOn, null, "a key that is not a string is none");
  assert.equal(odd.lastResult, null, "a last result that is not a throw is none");
  assert.deepEqual(odd.history, [{ day: "2:0", count: 0, hexLabel: "", target: null, total: 9, natural: null, success: null, by: "step" }],
    "a stored row is normalized: a whole count, an unknown thrower is the step's, a success that is not a boolean is unknown");

  const rolled = navigationEntry({ rolled: true, target: 13, total: 9, natural: 9, success: false }, { day: "3:1", count: 1, hexLabel: "C3", by: "judge" });
  assert.deepEqual(rolled, { day: "3:1", count: 1, hexLabel: "C3", target: 13, total: 9, natural: 9, success: false, by: "judge" });
  assert.deepEqual(navigationEntry({ rolled: true, target: 13, total: 12, natural: 9, success: false }, { day: "3:1", count: 1 }),
    { day: "3:1", count: 1, hexLabel: "", target: 13, total: 12, natural: 9, success: false, by: "step" },
    "the total and the natural die are kept apart: a bonus of three on a nine");
  assert.deepEqual(navigationEntry({ rolled: false, target: null, missing: "gettingLost" }, { day: "3:1" }),
    { day: "3:1", count: null, hexLabel: "", target: null, total: null, natural: null, success: null, by: "step" }, "a throw that could not be made says so");

  // The history keeps ten, newest first.
  let nav = navigationOf({});
  for (let day = 1; day <= NAVIGATION_HISTORY + 2; day++) nav = withNavigationThrow(nav, { ...rolled, day: `${day}:0` });
  assert.equal(nav.history.length, NAVIGATION_HISTORY, "the history keeps ten");
  assert.deepEqual(nav.history.map((e) => e.day), ["12:0", "11:0", "10:0", "9:0", "8:0", "7:0", "6:0", "5:0", "4:0", "3:0"], "newest first, the oldest dropped");
  assert.equal(nav.thrownOn, "12:0", "the last throw's day is the day thrown on");
  assert.deepEqual(nav.lastResult, nav.history[0]);
  assert.deepEqual(withNavigationThrow(nav, null), nav, "a row that is not a throw changes nothing");

  // The writers, through the ledger.
  settings.formations.n1 = { id: "n1", members: [], travel: { mode: "journey", ground: "hills", dayCount: 6, hex: { label: "C3" } } };
  assert.equal(journeyDayKey(travelOf(settings.formations.n1)), ":6", "a clock with no calendar keys the day on End day's counter alone");
  for (let n = 0; n <= NAVIGATION_HISTORY; n++) await recordNavigationThrow("n1", { rolled: true, target: 13, total: 14, natural: 14, success: true }, { day: `${n}:6` });
  const written = travelOf(settings.formations.n1).navigation;
  assert.equal(written.history.length, NAVIGATION_HISTORY, "the written history keeps ten");
  assert.equal(written.history[0].hexLabel, "C3", "a throw is made in the party's own hex by default");
  assert.equal(written.history[0].count, 6, "and on the record's own End-day count");
  assert.equal(written.thrownOn, `${NAVIGATION_HISTORY}:6`);
  await recordNavigationThrow("n1", { rolled: true, target: 13, total: 4, natural: 4, success: false }, { by: "judge" });
  assert.deepEqual([travelOf(settings.formations.n1).navigation.thrownOn, travelOf(settings.formations.n1).navigation.lastResult.by], [":6", "judge"],
    "today's key by default, and the Judge's press is named");
  assert.deepEqual(navigationOwed(settings.formations.n1), { state: "thrown", day: ":6", route: null, road: null }, "today's throw reads made");
  assert.deepEqual(navigationOwed(settings.formations.n1, { day: ":5" }), { state: "owed", day: ":5", route: null, road: null },
    "asked about the day a step began in, the answer is that day's");
  assert.equal(await claimNavigationDay("n1", ":7"), true, "a day not yet thrown is claimed");
  assert.equal(await claimNavigationDay("n1", ":7"), false, "and only once");
  assert.equal(await claimNavigationDay("nobody", ":7"), false, "a formation that is gone claims nothing");

  // End day throws nothing: the next day's throw waits for its first step.
  registerTable({ id: "travel", source: "invented", tables: { gettingLost: { hills: 13 } } }, { priority: PRIORITY.WORLD, source: "test" });
  Object.assign(settings, { travelLogCap: 120, advanceWorldTime: true, dawnHour: 6, duskHour: 18 });
  const posted = [];
  const thrown = [];
  globalThis.ChatMessage = { create: async (data) => { posted.push(data); return data; } };
  globalThis.Roll = class {
    constructor(formula) { thrown.push(formula); }
    async evaluate() { this.total = 1; this.dice = [{ results: [{ result: 1 }] }]; return this; }
  };
  globalThis.game.time = {
    worldTime: 3 * 86400 + 20 * 3600,
    calendar: { days: { hoursPerDay: 24, minutesPerHour: 60, secondsPerMinute: 60 } },
    components: { hour: 20, minute: 0, second: 0 },
    async advance(seconds) { this.worldTime += seconds; },
  };
  settings.formations.n2 = { id: "n2", members: [], travel: { mode: "journey", ground: "hills", hex: { label: "D4" } } };
  assert.deepEqual(navigationOwed(settings.formations.n2), { state: "owed", day: "3:0", route: null, road: null },
    "today's throw is owed, under the calendar day and the End-day count together");
  const entry = await endDay("n2", { miles: 10 });
  assert.ok(entry, "the day ended");
  assert.equal(game.time.worldTime, 4 * 86400 + 6 * 3600, "at the next dawn");
  assert.deepEqual(thrown, [], "End day rolls no navigation throw");
  assert.deepEqual(posted, [], "and posts no card");
  assert.deepEqual(travelOf(settings.formations.n2).navigation, { thrownOn: null, lastResult: null, history: [] }, "and records none");
  assert.deepEqual(navigationOwed(settings.formations.n2), { state: "owed", day: "4:1", route: null, road: null },
    "the new day's throw is owed at its first step");

  // A clock the module may not move: End day leaves the calendar day where it
  // is, and the counter alone makes the new day.
  settings.advanceWorldTime = false;
  settings.formations.n3 = { id: "n3", members: [], travel: { mode: "journey", ground: "hills", hex: { label: "D4" }, navigation: { thrownOn: "4:0" } } };
  assert.equal(navigationOwed(settings.formations.n3).state, "thrown", "today's throw is made");
  await endDay("n3", { miles: 10 });
  assert.equal(game.time.worldTime, 4 * 86400 + 6 * 3600, "the clock did not move");
  assert.deepEqual(navigationOwed(settings.formations.n3), { state: "owed", day: "4:1", route: null, road: null },
    "and the next day's throw is owed all the same");
  settings.advanceWorldTime = true;
  unregisterTable("travel");
}

console.log("test-travel: OK (day board, hours budget, defaults, log cap, the trace's reading, the country's resolution and provenance, one field name, movement axis, city stamp, inferred system, mode re-anchor, a journey reads its country, declarations, the Judge's word, sky on the nav throw, the navigation record, End day throws none)");
