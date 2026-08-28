/**
 * The wilderness encounter chain's structure: column selection, the shift
 * loop, every draw's degradation, distance and detection, evasion targets
 * and modifiers, and the composed runner. Invented values throughout — the
 * printed bands, names, dice and figures arrive through the registry; here
 * they are made up, so these tests prove the MACHINERY and never the book.
 */
import assert from "node:assert/strict";
import {
  ENCOUNTER_COLUMNS,
  ENCOUNTER_OUTCOMES,
  ENCOUNTER_TERRAINS,
  ENCOUNTERS_DOC,
  MONSTER_TABLE_KEYS,
  aftermath,
  civilizedDraw,
  detection,
  encounterColumnFor,
  encounterDistance,
  encounterTerrainFor,
  evasionModifiers,
  evasionTarget,
  headEquivalents,
  monsterDraw,
  rarityThrow,
  rollDice,
  runEncounter,
  territoryThrow,
  terrainEncounterDraw,
  visibilityMax,
} from "../scripts/formation/encounters.mjs";
import { registerTable, resetTables, PRIORITY } from "../scripts/lib/tables.mjs";

/** A deterministic rng: yields each queued face roll for the die it is asked. */
const rig = (...values) => {
  const q = [...values];
  return () => {
    const v = q.length ? q.shift() : 0.5;
    return v;
  };
};
// A face F on a dN wants rng() = (F-1)/N.
const face = (f, n) => (f - 1) / n;

/* --- invented sample tables ----------------------------------------------- */
const SAMPLE = {
  id: ENCOUNTERS_DOC,
  tables: {
    territory: {
      civilizedRoad: [
        { min: null, max: 15, outcome: "none" },
        { min: 16, max: null, outcome: "civilized" },
      ],
      civilizedOrBorderlandsRoad: [
        { min: null, max: 1, outcome: "columnShift" },
        { min: 2, max: 10, outcome: "none" },
        { min: 11, max: 16, outcome: "civilized" },
        { min: 17, max: 18, outcome: "monster" },
        { min: 19, max: null, outcome: "valuableTerrain" },
      ],
      borderlandsOrOutlandsRoad: [
        { min: null, max: 8, outcome: "none" },
        { min: 9, max: 14, outcome: "monster" },
        { min: 15, max: null, outcome: "dangerousTerrain" },
      ],
      outlandsOrUnsettledRoad: [
        { min: null, max: 7, outcome: "none" },
        { min: 8, max: null, outcome: "monster" },
      ],
      unsettled: [
        { min: null, max: 5, outcome: "none" },
        { min: 6, max: 14, outcome: "monster" },
        { min: 15, max: null, outcome: "uniqueTerrain" },
      ],
    },
    rarity: {
      borderlands: [
        { min: null, max: 11, rarity: "common" },
        { min: 12, max: 18, rarity: "uncommon" },
        { min: 19, max: null, rarity: "rare" },
      ],
      unsettled: [
        { min: null, max: 7, rarity: "common" },
        { min: 8, max: 19, rarity: "rare" },
        { min: 20, max: null, rarity: "veryRare" },
      ],
    },
    civilized: {
      grasslandScrubSparse: [
        { min: null, max: 60, name: "QQ Drover" },
        { min: 61, max: null, name: "QQ Peddler" },
      ],
    },
    "monsters.grasslandFarm": {
      common: [
        { min: null, max: 50, name: "QQ Prowler" },
        { min: 51, max: null, name: "QQ Stalker" },
      ],
      rare: [{ min: null, max: null, name: "QQ Terror" }],
    },
    distance: {
      grassland: { dice: "2d6", mult: 30, avg: 210 },
      jungle: { dice: "1d4", mult: 3, avg: 8 },
    },
    visibility: {
      daylight: 500,
      starlight: 60,
      formationScale: [
        { min: null, max: 9, pct: 0 },
        { min: 10, max: 30, pct: 50 },
        { min: 31, max: null, pct: 100 },
      ],
      headCounts: { mounted: 2, large: 2, huge: 5, gigantic: 20, colossal: 100 },
      altitudeFraction: 0.5,
    },
    evasion: {
      grassland: [
        { min: null, max: 6, target: 8 },
        { min: 7, max: 14, target: 10 },
        { min: 15, max: null, target: 12 },
      ],
    },
    evasionModifiers: { aerial: 3, explorer: 6, forlornHope: 5, movement: 3, aftermathNavigation: -3 },
    terrainEncounters: {
      valuable: ["QQ1", "QQ2", "QQ3", "QQ4", "QQ5", "QQ6", "QQ7", "QQ8", "QQ9", "QQ10", "QQ11", "QQ12"],
    },
  },
};
// The cadence half (hex/hour/attempt/period throws) reads the TRAVEL doc's
// frequency table — invented cells here, and the live recipe copies this.
const SAMPLE_FREQUENCY = {
  id: "travel",
  tables: {
    encounterFrequency: {
      hunting: { borderlands: { kind: "perAttempt" } },
      searching: { borderlands: { kind: "perHour" } },
      restingDay: { unsettled: { kind: "perPeriod", hours: 12 } },
      restingNight: { borderlands: { kind: "perPeriod", nights: 3 }, unsettled: { kind: "perPeriod", hours: 12 } },
      traveling: { borderlands: { kind: "perHex", mileHex: 6 } },
    },
  },
};

const registerSample = () => {
  registerTable(SAMPLE, { priority: PRIORITY.WORLD, source: "test" });
  registerTable(SAMPLE_FREQUENCY, { priority: PRIORITY.WORLD, source: "test" });
};
registerSample();

/* --- vocabularies ---------------------------------------------------------- */
assert.equal(Object.keys(ENCOUNTER_TERRAINS).length, 23,
  "the picks cover the union of the book's grains — biomes and rivers included");
assert.ok(Object.values(ENCOUNTER_TERRAINS).every((t) => t.civilized && t.monsters),
  "every pick names its civilized group and its monster sub-table");
assert.equal(MONSTER_TABLE_KEYS.length, 18, "eighteen printed monster sub-tables");
assert.equal(ENCOUNTER_TERRAINS.riverLand.distance, null, "rivers have no printed distance row");
assert.equal(encounterTerrainFor("forest"), "forestDeciduous", "a coarse ground derives its default sub-table");
assert.equal(encounterTerrainFor("mud"), "", "a ground with no default leaves the pick to the Judge");
assert.equal(Object.keys(ENCOUNTER_OUTCOMES).length, 7);

/* --- column selection: each column serves a roaded and an unroaded class --- */
assert.equal(encounterColumnFor({ territory: "civilized", road: true }), "civilizedRoad");
assert.equal(encounterColumnFor({ territory: "civilized" }), "civilizedOrBorderlandsRoad");
assert.equal(encounterColumnFor({ territory: "borderlands", road: true }), "civilizedOrBorderlandsRoad");
assert.equal(encounterColumnFor({ territory: "borderlands" }), "borderlandsOrOutlandsRoad");
assert.equal(encounterColumnFor({ territory: "outlands", road: true }), "borderlandsOrOutlandsRoad");
assert.equal(encounterColumnFor({ territory: "unsettled", road: true }), "outlandsOrUnsettledRoad");
assert.equal(encounterColumnFor({ territory: "unsettled" }), "unsettled");
assert.equal(encounterColumnFor({ territory: "borderlands", night: true }), "outlandsOrUnsettledRoad",
  "night in settled country shifts one column right");
assert.equal(encounterColumnFor({ territory: "unsettled", night: true }), "unsettled",
  "unsettled already stands at the wall");

/* --- the territory throw and its shift loop -------------------------------- */
let t = territoryThrow({ territory: "civilized", road: true, rng: rig(face(20, 20)) });
assert.ok(t.ok && t.outcome === "civilized" && t.rolls.length === 1);
t = territoryThrow({ territory: "civilized", rng: rig(face(1, 20), face(12, 20)) });
assert.equal(t.rolls.length, 2, "a column-shift result rolls again one column right");
assert.equal(t.rolls[1].column, "borderlandsOrOutlandsRoad");
assert.equal(t.outcome, "monster", "…and the second roll's outcome stands");

/* --- the draws ------------------------------------------------------------- */
const r = rarityThrow({ territory: "unsettled", rng: rig(face(20, 20)) });
assert.ok(r.ok && r.rarity === "veryRare");
let m = monsterDraw({ terrain: "grassland", rarity: "common", rng: rig(face(51, 100)) });
assert.ok(m.ok && m.name === "QQ Stalker");
m = monsterDraw({ terrain: "grassland", rarity: "uncommon" });
assert.ok(!m.ok && m.missing === "monsters.grasslandFarm", "an unimported rarity column is a book line");
m = monsterDraw({ terrain: "jungle", rarity: "common" });
assert.equal(m.missing, "monsters.jungle");
m = monsterDraw({ terrain: "swampForested", rarity: "common" });
assert.equal(m.missing, "monsters.swamp", "three swamp picks share the one printed sub-table");
const river = encounterDistance({ terrain: "riverLand" });
assert.ok(!river.ok && river.noRow && !river.missing,
  "a pick without a distance row hands the step back as NO-ROW, not as unimported");
const c = civilizedDraw({ terrain: "grasslandSteppe", rng: rig(face(61, 100)) });
assert.ok(c.ok && c.name === "QQ Peddler", "a steppe party draws on its column group");
const te = terrainEncounterDraw({ kind: "valuable", rng: rig(face(12, 12)) });
assert.ok(te.ok && te.name === "QQ12");
assert.ok(!terrainEncounterDraw({ kind: "dangerous" }).ok, "an unimported kind is a book line");

/* --- distance, heads, visibility, detection -------------------------------- */
assert.equal(rollDice("2d6", rig(face(3, 6), face(4, 6))), 7);
assert.equal(rollDice("garbage", rig()), null);
const d = encounterDistance({ terrain: "grassland", rng: rig(face(2, 6), face(2, 6)) });
assert.ok(d.ok && d.feet === 120, "the dice times the table's multiplier");
assert.equal(headEquivalents({ men: 3, mounted: 2, colossal: 1 }), 107, "the imported ladder counts the big bodies");
assert.equal(visibilityMax({ light: "daylight", heads: 5 }), 500);
assert.equal(visibilityMax({ light: "daylight", heads: 20 }), 750, "a party-sized formation is seen half again as far");
assert.equal(visibilityMax({ light: "moonlight", heads: 5 }), null, "an unimported light band caps nothing");

// Cross-terrain: each side rolls its OWN country; the longer roll detects.
const det = detection({
  partyTerrain: "jungle",
  monsterTerrain: "grassland",
  partyHeads: 5,
  monsterHeads: 5,
  rng: rig(face(4, 4), face(6, 6), face(6, 6)),
});
assert.ok(det.ok);
assert.equal(det.rolled, 360, "the greater of the two rolls opens the encounter");
assert.equal(det.farSide, "monsters");
assert.ok(det.monstersSee && det.feet <= 500, "the far side detects; the start respects the caps");
assert.equal(det.altitude, Math.round(det.feet / 2), "flyers may open at the imported fraction");

/* --- evasion --------------------------------------------------------------- */
assert.equal(evasionTarget({ terrain: "grassland", partySize: 5 }).target, 8);
assert.equal(evasionTarget({ terrain: "grassland", partySize: 40 }).target, 12);
assert.ok(!evasionTarget({ terrain: "jungle", partySize: 5 }).ok, "an unimported terrain is a book line");
let mods = evasionModifiers({ terrain: "grassland", monstersFly: true, explorerGuide: true, fasterMonsters: true });
assert.deepEqual(mods.parts.map((p) => [p.key, p.value]), [["aerial", -3], ["explorer", 6], ["movement", -3]],
  "open country takes the aerial penalty; the guide and the speed race sign their own lines");
mods = evasionModifiers({ terrain: "jungle", monstersFly: true });
assert.equal(mods.parts.length, 0, "closed country shelters the party from flyers");
assert.ok(evasionModifiers({ terrain: "grassland", partyFlies: true }).autoEvade,
  "a flying party over walkers simply leaves");
const aft = aftermath({ terrain: "grassland", rng: rig(face(1, 6), face(1, 6), face(7, 12)) });
assert.ok(aft.ok && aft.feet === 60 && aft.clock === 7 && aft.navPenalty === -3);

/* --- the composed runner ---------------------------------------------------- */
let chain = runEncounter({
  territory: "borderlands",
  terrain: "grassland",
  rng: rig(face(12, 20), face(20, 20), face(1, 100), face(3, 6), face(3, 6)),
});
assert.equal(chain.outcome, "monster");
assert.equal(chain.rarity.rarity, "rare");
assert.equal(chain.creature.name, "QQ Terror");
assert.ok(chain.distance.ok && chain.distance.feet === 180);

chain = runEncounter({
  territory: "civilized",
  terrain: "grassland",
  restingOrKnownRoute: true,
  rng: rig(face(19, 20)),
});
assert.equal(chain.downgraded, "valuableTerrain", "a terrain result stands down for a resting party");
assert.equal(chain.outcome, "none");

chain = runEncounter({ territory: "unsettled", terrain: "grassland", rng: rig(face(15, 20), face(5, 12)) });
assert.ok(!chain.terrainEncounter.ok, "an unimported list degrades to a book line, not a throw");

resetTables();
chain = runEncounter({ territory: "borderlands", terrain: "grassland" });
assert.ok(!chain.territory.ok && chain.territory.missing === "territory",
  "an empty registry refuses at the first table, by name");
registerSample();

console.log("test-encounters: OK (columns, shift loop, draws, distance, detection, evasion, runner)");
