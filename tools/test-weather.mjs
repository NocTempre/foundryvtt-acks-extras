/**
 * The weather engine's structure: the generator's column choice and
 * rewrites, the fronts drift, the condition derivation, the footing state
 * machine, and the condition factors in the ground multiplier. Invented
 * values throughout — band edges, modifiers, factors and thresholds are
 * printed and arrive through the registry; here they are made up, so these
 * tests prove the MACHINERY and never the book.
 */
import assert from "node:assert/strict";
import {
  CLIMATES,
  CONDITIONS,
  PRECIPITATION_KINDS,
  SEASONS,
  TEMPERATURE_BANDS,
  WIND_BANDS,
  advanceGround,
  applyRewrites,
  conditionsOf,
  freshFooting,
  frontShift,
  generateDay,
  generatorReady,
  terrainMudProne,
} from "../scripts/formation/weather.mjs";
import { travelMultiplier, canEnter, WEATHER_DOC, TRAVEL_DOC } from "../scripts/vehicles/vehicle-speed.mjs";
import { travelOf, composeLogEntry } from "../scripts/formation/travel.mjs";
import { registerTable, resetTables, PRIORITY } from "../scripts/lib/tables.mjs";

/* --- invented sample tables, registered the way an import would ----------- */
const SAMPLE_WEATHER = {
  id: WEATHER_DOC,
  tables: {
    // Real Köppen code, invented modifiers — the code list is science, the
    // grid is the book's.
    climateModifiers: {
      Af: {
        spring: { tDay: -1, tNight: -4, p: 0, w: 0 },
        summer: { tDay: 3, tNight: 1, p: -2, w: 1 },
      },
    },
    dailyTemperatureLow: [
      { min: null, max: 3, key: "frigid" },
      { min: 4, max: 6, key: "cold" },
      { min: 7, max: 9, key: "balmy" },
      { min: 10, max: null, key: "sweltering" },
    ],
    dailyTemperatureHigh: [
      { min: null, max: 4, key: "chilly" },
      { min: 5, max: 9, key: "warm" },
      { min: 10, max: null, key: "hot" },
    ],
    dailyPrecipitation: [
      { min: null, max: 4, key: "clear" },
      { min: 5, max: 7, key: "drizzly" },
      { min: 8, max: null, key: "rainy" },
    ],
    dailyWind: [
      { min: null, max: 4, key: "still" },
      { min: 5, max: 9, key: "moderate" },
      { min: 10, max: null, key: "gale" },
    ],
    conditionSpeed: { foggy: 0.5, muddy: 0.5, snowbound: 0.5, stormy: 0.25, snowy: 0.5 },
    accumulation: {
      snowFromSnowy: 1,
      snowFromFlurry: 3,
      snowMeltModerate: 4,
      snowMeltSweltering: 1,
      mudFromRainy: 1,
      mudFromDrizzly: 3,
      mudDryModerate: 5,
      mudDrySweltering: 1,
      mudFreeze: 1,
    },
  },
};
const SAMPLE_TRAVEL = {
  id: TRAVEL_DOC,
  tables: {
    terrainMultipliers: { grassland: 1, hills: 0.5 },
    roads: {
      earth: { multiplier: 2, ineffectiveIf: ["raining", "muddy", "snowbound"] },
      paved: { multiplier: 2, ineffectiveIf: ["snowbound"] },
    },
  },
};
const registerSamples = () => {
  registerTable(SAMPLE_WEATHER, { priority: PRIORITY.WORLD, source: "test" });
  registerTable(SAMPLE_TRAVEL, { priority: PRIORITY.WORLD, source: "test" });
};
registerSamples();

/* --- vocabularies hold together ------------------------------------------- */
assert.equal(Object.keys(CONDITIONS).length, 13, "thirteen mechanical conditions");
assert.ok(Object.keys(CLIMATES).every((k) => CLIMATES[k].group), "every climate carries its picker group");
assert.equal(SEASONS.length, 4);
assert.ok(TEMPERATURE_BANDS.frigid.freezing && TEMPERATURE_BANDS.cold.freezing, "the freezing bands are marked");
assert.ok(PRECIPITATION_KINDS.snowy.derived && PRECIPITATION_KINDS.foggy.derived, "the derived kinds are marked");
assert.ok(WIND_BANDS.still.stills && WIND_BANDS.gale.condition === "stormy", "the wind ladder carries the land flags");
assert.ok(terrainMudProne("grassland") && !terrainMudProne("hills"), "mud takes the terrains that take mud");
assert.ok(generatorReady(), "the sample registry is enough to generate");

/* --- the generator: column choice, night, bands --------------------------- */
// Day modifier -1 (≤ 0) → the LOW column; the same natural roll serves the
// night under its own modifier, in the same column.
let g = generateDay({ climate: "Af", season: "spring", rolls: { t: 8, p: 3, w: 6 } });
assert.ok(g.ok);
assert.equal(g.temperature, "balmy", "8-1=7 lands in the low column's balmy row");
assert.equal(g.temperatureNight, "cold", "the SAME roll at the night modifier: 8-4=4 is cold");
assert.equal(g.precipitation, "clear");
assert.equal(g.wind, "moderate");

// Day modifier +3 (≥ +1) → the HIGH column, night included.
g = generateDay({ climate: "Af", season: "summer", rolls: { t: 4, p: 8, w: 6 } });
assert.equal(g.temperature, "warm", "4+3=7 lands in the high column");
assert.equal(g.temperatureNight, "warm", "night 4+1=5 stays in the high column — the DAY modifier picks it");
assert.equal(g.precipitation, "drizzly", "8-2=6 is drizzly");
assert.equal(g.wind, "moderate", "6+1=7 is moderate");

/* --- the rewrites: freezing first, then still air ------------------------- */
assert.equal(applyRewrites({ temperature: "cold", precipitation: "drizzly", wind: "moderate" }), "flurry");
assert.equal(applyRewrites({ temperature: "frigid", precipitation: "rainy", wind: "still" }), "snowy",
  "freezing wins before still air is consulted — snow, not fog");
assert.equal(applyRewrites({ temperature: "balmy", precipitation: "drizzly", wind: "still" }), "misty");
assert.equal(applyRewrites({ temperature: "balmy", precipitation: "rainy", wind: "still" }), "foggy");
assert.equal(applyRewrites({ temperature: "balmy", precipitation: "rainy", wind: "moderate" }), "rainy",
  "warm moving air leaves the rain alone");

// Through the generator: spring's -1 day modifier with a low roll freezes
// the rain the precipitation roll produced.
g = generateDay({ climate: "Af", season: "spring", rolls: { t: 3, p: 12, w: 6 } });
assert.equal(g.temperature, "frigid");
assert.equal(g.precipitation, "snowy", "the rolled rain fell as snow");

/* --- the fronts drift ----------------------------------------------------- */
assert.equal(frontShift(7, 10), 8, "one step toward yesterday");
assert.equal(frontShift(7, 4), 6);
assert.equal(frontShift(7, 7), 7, "no drift toward itself");
assert.equal(frontShift(2, 9), 2, "a natural 2 stands");
assert.equal(frontShift(12, 3), 12, "a natural 12 stands");
g = generateDay({ climate: "Af", season: "spring", rolls: { t: 8, p: 6, w: 6 }, fronts: true, prior: { t: 11, p: 2, w: 6 } });
assert.deepEqual(g.rolls, { t: 9, p: 5, w: 6 }, "each axis drifted one step toward yesterday's roll");

/* --- degradation: the registry names what it lacks ------------------------ */
g = generateDay({ climate: "ZZ", season: "spring" });
assert.ok(!g.ok && g.missing.includes("climate"), "an unknown climate is refused by name");
resetTables();
g = generateDay({ climate: "Af", season: "spring" });
assert.ok(!g.ok && g.missing.includes("climateModifiers"), "an empty registry is refused by name");
assert.ok(!generatorReady());
registerSamples();

/* --- conditions derive from the sky and the ground ------------------------ */
assert.deepEqual(conditionsOf({ temperature: "balmy", precipitation: "clear", wind: "moderate" }), []);
assert.deepEqual(
  conditionsOf({ temperature: "frigid", precipitation: "snowy", wind: "gale", footing: { mud: "muddy", snow: true } }),
  ["frigid", "snowy", "stormy", "muddy", "snowbound"],
  "every source contributes, in the vocabulary's order");
assert.deepEqual(conditionsOf({ temperature: "chilly", precipitation: "misty", wind: "still" }), [],
  "mist has no game effect");
assert.deepEqual(conditionsOf({ footing: { mud: "frozen", snow: false } }), [],
  "frozen mud is hard ground, not a condition");

/* --- the footing state machine, at invented thresholds -------------------- */
let f = freshFooting();
f = advanceGround(f, { temperature: "cold", precipitation: "flurry" });
f = advanceGround(f, { temperature: "cold", precipitation: "flurry" });
assert.equal(f.snow, false, "two flurry days are not yet the invented three");
f = advanceGround(f, { temperature: "cold", precipitation: "flurry" });
assert.equal(f.snow, true, "the third flurry day lays the snow");

f = advanceGround(f, { temperature: "sweltering", precipitation: "clear" });
assert.equal(f.snow, false, "one sweltering day melts it");
assert.equal(f.mud, "muddy", "and the melt-water is mud");

f = advanceGround(f, { temperature: "cold", precipitation: "clear" });
assert.equal(f.mud, "frozen", "a freezing fair day hardens the mud");
f = advanceGround(f, { temperature: "balmy", precipitation: "clear" });
assert.equal(f.mud, "muddy", "a thaw softens it again");
f = advanceGround(f, { temperature: "sweltering", precipitation: "clear" });
assert.equal(f.mud, "none", "one sweltering fair day dries it");

f = freshFooting();
f = advanceGround(f, { temperature: "balmy", precipitation: "rainy", mudProne: true });
assert.equal(f.mud, "muddy", "one rainy day muds a mud-prone terrain");
let rocky = advanceGround(freshFooting(), { temperature: "balmy", precipitation: "rainy", mudProne: false });
assert.equal(rocky.mud, "none", "and leaves the rest alone");

f = freshFooting();
f = advanceGround(f, { temperature: "balmy", precipitation: "drizzly" });
f = advanceGround(f, { temperature: "balmy", precipitation: "clear" });
f = advanceGround(f, { temperature: "balmy", precipitation: "drizzly" });
f = advanceGround(f, { temperature: "balmy", precipitation: "drizzly" });
assert.equal(f.mud, "none", "the drizzle counter reset on the clear day — runs are consecutive");

resetTables();
const held = advanceGround({ mud: "muddy", snow: true, runs: {} }, { temperature: "sweltering", precipitation: "clear" });
assert.ok(held.missing && held.mud === "muddy" && held.snow === true,
  "no accumulation table: the footing holds still and says so");
registerSamples();

/* --- condition factors in the ground multiplier --------------------------- */
let m = travelMultiplier({ terrain: "grassland", conditions: ["foggy", "stormy"] });
assert.equal(m.multiplier, 0.125, "condition factors stack cumulatively (½ × ¼)");
assert.deepEqual(m.parts.filter((p) => p.key.startsWith("condition.")).map((p) => p.key),
  ["condition.foggy", "condition.stormy"]);

m = travelMultiplier({ terrain: "grassland", road: "earth", conditions: ["muddy"] });
assert.equal(m.multiplier, 0.5, "mud halves and the earth road it drowned adds nothing");
assert.ok(m.parts.some((p) => p.key === "roadWashedOut" && p.note), "the drowned road still says so");

m = travelMultiplier({ terrain: "grassland", road: "paved", conditions: ["muddy"] });
assert.equal(m.multiplier, 2, "pavement holds: the road counts and the mud does not");
assert.ok(m.parts.some((p) => p.key === "mudPaved" && p.note), "and the lift is said out loud");

m = travelMultiplier({ terrain: "grassland", road: "paved", conditions: ["muddy", "snowbound"] });
assert.equal(m.multiplier, 0.25, "snow drowns even pavement — no road, no mud lift... but snow still halves");
assert.ok(m.parts.some((p) => p.key === "roadWashedOut"));

m = travelMultiplier({ terrain: "grassland", road: "earth", conditions: ["rainy"] });
assert.ok(m.parts.some((p) => p.key === "roadWashedOut"),
  "the rainy CONDITION reaches the road's washout vocabulary without the legacy flag");

resetTables();
registerTable(SAMPLE_TRAVEL, { priority: PRIORITY.WORLD, source: "test" });
m = travelMultiplier({ terrain: "grassland", conditions: ["foggy"] });
assert.equal(m.multiplier, 1, "no conditionSpeed table: the sky counts ×1");
assert.ok(m.missing && m.parts.some((p) => p.key === "tablesMissing"), "and the one reason line says why");
registerSamples();

/* --- wheels against the footing ------------------------------------------- */
const wagon = { kind: "land" };
assert.equal(canEnter(wagon, "grassland", { snow: true }).ok, false, "snow stops wheels everywhere");
assert.equal(canEnter(wagon, "grassland", { snow: true }).reason, "snowbound");
assert.equal(canEnter(wagon, "grassland", { mud: "muddy" }).ok, false);
assert.equal(canEnter(wagon, "grassland", { mud: "muddy", road: "earth" }).reason, "mudBound", "an earth road is no help in mud");
assert.equal(canEnter(wagon, "grassland", { mud: "muddy", road: "paved" }).ok, true, "pavement carries wheels over mud");
assert.equal(canEnter(wagon, "grassland", { mud: "frozen" }).ok, true, "frozen mud is hard ground");
assert.equal(canEnter({ kind: "land", carriage: "backCarried" }, "grassland", { snow: true }).ok, true,
  "a carried vehicle goes where its bearers walk");
assert.equal(canEnter({ kind: "sea" }, "grassland", { snow: true }).ok, true, "a vessel is not asked");

/* --- the record's shape and the log's slim weather ------------------------ */
const t = travelOf({ travel: { weather: { temperature: "frigid", precipitation: "snowy", wind: "gale", rolls: { t: 3, p: 12, w: 11 }, footing: { mud: "muddy", snow: true, runs: { snowy: 2 } } } } });
assert.equal(t.weather.season, "spring", "the season defaults");
assert.equal(t.weather.footing.mud, "muddy", "the footing survives the defaults merge");
const entry = composeLogEntry(t, {});
assert.equal(entry.weather.temperature, "frigid");
assert.deepEqual(entry.weather.conditions, ["frigid", "snowy", "stormy", "muddy", "snowbound"]);
assert.ok(!("rolls" in entry.weather) && !("footing" in entry.weather),
  "the log keeps the display half only — no working state in a season of rows");

console.log("test-weather: OK (generator columns, rewrites, fronts, conditions, footing machine, factors, wheels)");
