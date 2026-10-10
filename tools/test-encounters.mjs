/**
 * The wilderness encounter chain's structure: column selection, the shift
 * loop, every draw's degradation, distance and detection, evasion targets
 * and modifiers, the composed runner with and without an encounter zone's
 * own throw and table, and overlapping zones composed. Invented values throughout — the
 * printed bands, names, dice and figures arrive through the registry; here
 * they are made up, so these tests prove the MACHINERY and never the book.
 */
import assert from "node:assert/strict";
import {
  ENCOUNTER_COLUMNS,
  ENCOUNTER_OUTCOMES,
  ENCOUNTER_TABLE_IDS,
  ENCOUNTER_TERRAINS,
  ENCOUNTERS_DOC,
  DOUBLE_ON_DOUBLE,
  DRAW_BUDGET,
  MONSTER_TABLE_KEYS,
  TERRAIN_FOLLOW_UPS,
  TERRAIN_LOOKUPS,
  aftermath,
  civilizedDraw,
  detection,
  encounterColumnFor,
  encounterDistance,
  encounterTerrainFor,
  flattenTerrainDraw,
  evasionModifiers,
  evasionTarget,
  headEquivalents,
  monsterDraw,
  rarityThrow,
  rollDice,
  runEncounter,
  subTableDraw,
  territoryThrow,
  terrainEncounterDraw,
  visibilityMax,
} from "../scripts/formation/encounters.mjs";
import { registerTable, resetTables, PRIORITY } from "../scripts/lib/tables.mjs";
import { PRODUCES, TERRAIN_SUB_RAW_KEYS } from "../scripts/importer/encounters-binding.mjs";
import { TABLE_RECIPES } from "../scripts/importer/table-recipes.mjs";

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
assert.ok(Object.values(ENCOUNTER_TERRAINS).every((t) => Object.hasOwn(t, "ground")),
  "every pick says which ground it stands on, null for a river");
assert.equal(ENCOUNTER_TERRAINS.riverLand.ground, null);
assert.equal(ENCOUNTER_TERRAINS.forestTaiga.ground, "forest", "a variant stands on its family's ground");
assert.equal(encounterTerrainFor("mountains"), "mountainsRocky", "a ground's default is the marked pick, not the first in file order");
assert.equal(encounterTerrainFor("hills"), "hillsRocky");
assert.equal(encounterTerrainFor("desert"), "desertSandy");
{
  const defaults = Object.values(ENCOUNTER_TERRAINS).filter((t) => t.groundDefault);
  const grounds = new Set(Object.values(ENCOUNTER_TERRAINS).map((t) => t.ground).filter(Boolean));
  assert.equal(defaults.length, grounds.size, "one default per ground the register stands on");
  assert.equal(new Set(defaults.map((t) => t.ground)).size, defaults.length, "and never two for one ground");
}
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

// The sky: the size scale first, then the factor, then a stated ceiling.
assert.equal(visibilityMax({ light: "daylight", heads: 20, weather: null }), 750, "no sky leaves the figure as it was");
assert.equal(visibilityMax({ light: "daylight", heads: 20, weather: { feet: null, factor: 1 } }), 750, "a sky stating nothing changes nothing");
assert.equal(visibilityMax({ light: "daylight", heads: 20, weather: { feet: null, factor: 0.5 } }), 375, "the factor multiplies the scaled figure");
assert.equal(visibilityMax({ light: "daylight", heads: 20, weather: { feet: 140, factor: 1 } }), 140, "a ceiling caps it");
assert.equal(visibilityMax({ light: "daylight", heads: 20, weather: { feet: 900, factor: 0.5 } }), 375, "a ceiling above the figure does not raise it");
assert.equal(visibilityMax({ light: "daylight", heads: 20, weather: { feet: 300, factor: 0.5 } }), 300,
  "the ceiling is applied after the factor: 375 is capped, not 300 halved");
assert.equal(visibilityMax({ light: "daylight", heads: 5, weather: { feet: 300, factor: 0.5 } }), 250,
  "the factor alone binds when it already falls under the ceiling");
assert.equal(visibilityMax({ light: "moonlight", heads: 5, weather: { feet: 140, factor: 0.5 } }), null,
  "an unimported light band still caps nothing, whatever the sky");
const skyDet = detection({
  partyTerrain: "grassland", partyHeads: 5, monsterHeads: 5, weather: { feet: 140, factor: 1 },
  rng: rig(face(6, 6), face(6, 6)),
});
assert.ok(skyDet.ok && skyDet.rolled === 360 && skyDet.feet === 140, "the sky's ceiling caps where the encounter opens");

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

/* --- what a terrain result leads to ----------------------------------------- */
// The halves agree: every table a result rolls is one the binding assembles,
// every lookup one it produces, every pick's group a row its recipe reads.
const subKeys = new Set(Object.values(TERRAIN_SUB_RAW_KEYS).map((s) => s.key));
for (const [name, spec] of Object.entries(TERRAIN_FOLLOW_UPS)) {
  for (const table of [...(spec.rolls ?? []), ...Object.values(spec.chain ?? {})]) {
    assert.ok(subKeys.has(table), `${name} rolls ${table}, which the binding assembles`);
  }
}
for (const tableId of Object.values(TERRAIN_LOOKUPS)) {
  assert.ok(tableId in PRODUCES[ENCOUNTERS_DOC] && ENCOUNTER_TABLE_IDS.includes(tableId), `${tableId} is produced and expected`);
}
const recipeGroups = (raw) => new Set(TABLE_RECIPES.encounters.tables[raw].rows.map((row) => row.key));
const treasureGroups = recipeGroups("treasureByTerrainRaw");
const ruinGroups = recipeGroups("ruinModifierRaw");
assert.ok(Object.values(ENCOUNTER_TERRAINS).every((p) => treasureGroups.has(p.treasure) && ruinGroups.has(p.ruin)),
  "every pick names a treasure group and a ruin group its recipe reads");

const d4 = (...names) => names.map((name, i) => ({ min: i + 1, max: i + 1, name }));
registerTable({
  id: ENCOUNTERS_DOC,
  tables: {
    ...SAMPLE.tables,
    terrainEncounters: {
      valuable: ["Ruin", "Cache", "SAFE  haven", "Ore", "QQ5", "QQ6", "QQ7", "QQ8", "QQ9", "QQ10", "QQ11", "QQ12"],
      unique: ["Place of Power", "QQ2", "QQ3", "QQ4", "QQ5", "QQ6", "QQ7", "QQ8", "QQ9", "QQ10", "QQ11", "QQ12"],
    },
    terrainSubTables: {
      structure: d4("QQ Hall", "QQ Arch", "QQ Tower", "QQ Well"),
      safeHaven: [{ min: 1, max: 5, name: "QQ Hollow" }, { min: 6, max: 10, name: "QQ Ledge" }],
      placeOfPower: d4("QQ Sink", "QQ Peak", "QQ Aerie", "QQ Well"),
      power: [{ min: 1, max: 3, name: "QQ Minor" }, { min: 4, max: 4, name: "QQ Climb" }],
      majorPower: [{ min: 1, max: 1, name: "QQ Major" }, { min: 2, max: 2, name: "QQ Supreme" }],
    },
    treasureByTerrain: { forest: "X, Y" },
    ruinModifier: { hillsMountainsForestRiver: 7 },
  },
}, { priority: PRIORITY.WORLD, source: "test" });

let tr = terrainEncounterDraw({ kind: "valuable", terrain: "forestDeciduous", rng: rig(face(1, 12), face(3, 4)) });
assert.deepEqual(tr.follow.map((f) => [f.table, f.die, f.roll, f.name]), [["structure", 4, 3, "QQ Tower"]],
  "a ruin rolls its structure on the table's own die");
assert.deepEqual(tr.lookups.map((l) => [l.kind, l.value]), [["ruin", 7]], "…and reads the forest's ruin row");
tr = terrainEncounterDraw({ kind: "valuable", terrain: "forestTaiga", rng: rig(face(2, 12)) });
assert.ok(!tr.follow.length && tr.lookups[0].ok && tr.lookups[0].value === "X, Y", "a cache reads the treasure row, rolling nothing");
tr = terrainEncounterDraw({ kind: "valuable", terrain: "", rng: rig(face(2, 12)) });
assert.ok(tr.lookups[0].noTerrain && !tr.lookups[0].missing, "no terrain pick is not an unimported table");
tr = terrainEncounterDraw({ kind: "valuable", terrain: "jungle", rng: rig(face(2, 12)) });
assert.equal(tr.lookups[0].missing, "treasureByTerrain", "a group the import lacks is a book line");
tr = terrainEncounterDraw({ kind: "valuable", terrain: "jungle", rng: rig(face(3, 12), face(7, 10)) });
assert.equal(tr.follow[0].name, "QQ Ledge", "a result's name matches blind to case and spacing");
tr = terrainEncounterDraw({ kind: "valuable", terrain: "jungle", rng: rig(face(4, 12)) });
assert.ok(!tr.follow[0].ok && tr.follow[0].missing === "terrainSubTables", "an unimported sub-table is a book line");
tr = terrainEncounterDraw({ kind: "valuable", terrain: "jungle", rng: rig(face(5, 12)) });
assert.ok(tr.ok && !tr.follow.length && !tr.lookups.length, "a result leading nowhere adds nothing");

tr = terrainEncounterDraw({ kind: "unique", terrain: "jungle", rng: rig(face(1, 12), face(2, 4), face(2, 4)) });
assert.deepEqual(tr.follow.map((f) => f.name), ["QQ Peak", "QQ Minor"], "a power below the top band stops");
tr = terrainEncounterDraw({ kind: "unique", terrain: "jungle", rng: rig(face(1, 12), face(2, 4), face(4, 4), face(2, 2)) });
assert.deepEqual(tr.follow.map((f) => f.name), ["QQ Peak", "QQ Climb", "QQ Supreme"], "the top band climbs to the next table");

chain = runEncounter({ territory: "unsettled", terrain: "mountainsRocky", rng: rig(face(15, 20), face(1, 12), face(1, 4), face(1, 4)) });
assert.deepEqual(chain.terrainEncounter.follow.map((f) => f.table), ["placeOfPower", "power"],
  "the runner hands the party's terrain to the result's follow-ups");
resetTables();
registerSample();

/* --- dice with a modifier --------------------------------------------------- */
assert.equal(rollDice("2d4+1", rig(face(2, 4), face(3, 4))), 6, "a plus modifier adds to the dice");
assert.equal(rollDice("1d6 - 3", rig(face(6, 6))), 3, "a minus modifier subtracts");
assert.equal(rollDice("1d6-3", rig(face(2, 6))), 0, "a total below zero floors at zero");
assert.equal(rollDice("2d6+", rig()), null, "a dangling modifier is junk");
assert.equal(rollDice("2d6+x", rig()), null, "a non-numeric modifier is junk");

/* --- a result that hands back into the chain -------------------------------- */
const HANDOFF_ROLLS = {
  // The unique list carries a creature hand-off, a result with follow-ups and a draw hand-off.
  valuable: ["Double", "QQ V2", "QQ V3", "Lesser Terrain", "Hidden Settlement", "Monster Carcass", "Monstrous Shadow", "Awful Despoiling", "Cache", "QQ V10", "QQ V11", "QQ V12"],
  dangerous: ["Double", "QQ D2", "QQ D3", "QQ D4", "QQ D5", "QQ D6", "QQ D7", "QQ D8", "QQ D9", "QQ D10", "QQ D11", "QQ D12"],
  unique: ["Double", "QQ U2", "QQ U3", "Hidden Settlement", "Ruin", "Awful Despoiling", "QQ U7", "QQ U8", "QQ U9", "QQ U10", "QQ U11", "QQ U12"],
};
const registerHandoffs = ({ share = null } = {}) => {
  resetTables();
  registerSample();
  registerTable({
    id: ENCOUNTERS_DOC,
    tables: {
      ...SAMPLE.tables,
      terrainEncounters: HANDOFF_ROLLS,
      terrainSubTables: { structure: d4("QQ Hall", "QQ Arch", "QQ Tower", "QQ Well") },
      treasureByTerrain: { forest: "X, Y", clearGrassScrub: "T1" },
      ruinModifier: { hillsMountainsForestRiver: 7 },
      ...(share == null ? {} : { lesserTerrainShare: share }),
    },
  }, { priority: PRIORITY.WORLD, source: "test" });
};
registerHandoffs({ share: 40 });

assert.deepEqual(DOUBLE_ON_DOUBLE, { valuable: "unique", dangerous: "unique", unique: "reroll" });
assert.ok(DRAW_BUDGET > 0 && ENCOUNTER_TABLE_IDS.includes("lesserTerrainShare"),
  "the share table is one the chain declares it reads");
assert.deepEqual(TERRAIN_FOLLOW_UPS.lesserTerrain.either, ["valuable", "dangerous"]);
assert.equal(TERRAIN_FOLLOW_UPS.awfulDespoiling.draw, "valuable");

// Double: two further rolls on the same list.
let hd = terrainEncounterDraw({ kind: "valuable", terrain: "forestDeciduous", rng: rig(face(1, 12), face(2, 12), face(3, 12)) });
assert.equal(hd.name, "Double");
assert.deepEqual(hd.then.map((n) => [n.kind, n.name, n.via]), [["valuable", "QQ V2", "double"], ["valuable", "QQ V3", "double"]],
  "a Double rolls the same list twice more");
assert.ok(!hd.discarded && !hd.rerolled);
hd = terrainEncounterDraw({ kind: "valuable", terrain: "forestDeciduous", rng: rig(face(1, 12), face(9, 12), face(2, 12)) });
assert.equal(hd.then[0].lookups[0].value, "X, Y", "each roll of the pair carries its own follow-ups");

// Double inside a valuable Double: both set aside, one unique roll with its follow-ups.
hd = terrainEncounterDraw({
  kind: "valuable",
  terrain: "forestDeciduous",
  rng: rig(face(1, 12), face(1, 12), face(2, 12), face(5, 12), face(3, 4)),
});
assert.deepEqual(hd.discarded.map((n) => [n.name, n.setAside]), [["Double", "discarded"], ["QQ V2", "discarded"]],
  "a Double inside the pair sets the whole pair aside");
assert.equal(hd.then.length, 1, "…and one roll is made instead");
assert.deepEqual([hd.then[0].kind, hd.then[0].name, hd.then[0].via], ["unique", "Ruin", "double"], "…on the unique list");
assert.deepEqual(hd.then[0].follow.map((f) => f.name), ["QQ Tower"], "…whose own follow-ups apply");
assert.deepEqual(hd.then[0].lookups.map((l) => l.value), [7]);
hd = terrainEncounterDraw({ kind: "dangerous", terrain: "forestDeciduous", rng: rig(face(1, 12), face(2, 12), face(1, 12), face(2, 12)) });
assert.equal(hd.then[0].kind, "unique", "dangerous sets a Double pair aside the same way");

// Double inside a unique Double: the inner Double is rerolled on the same list.
hd = terrainEncounterDraw({
  kind: "unique",
  terrain: "forestDeciduous",
  rng: rig(face(1, 12), face(1, 12), face(2, 12), face(3, 12)),
});
assert.ok(!hd.discarded, "a unique Double sets nothing aside");
assert.deepEqual(hd.rerolled.map((n) => [n.name, n.setAside]), [["Double", "rerolled"]], "the rejected roll is recorded");
assert.deepEqual(hd.then.map((n) => n.name), ["QQ U3", "QQ U2"], "…and replaced on the same list");
assert.deepEqual(flattenTerrainDraw(hd).map(({ depth, node }) => [depth, node.name, node.setAside ?? null]),
  [[0, "Double", null], [1, "Double", "rerolled"], [1, "QQ U3", null], [1, "QQ U2", null]],
  "a set-aside roll precedes the rolls that stand");

// Lesser Terrain: the imported percent picks the kind.
let lt = terrainEncounterDraw({ kind: "valuable", terrain: "forestDeciduous", rng: rig(face(4, 12), face(40, 100), face(2, 12)) });
assert.deepEqual(lt.either, { roll: 40, share: 40, kind: "valuable" }, "a roll at the share takes the first kind");
assert.deepEqual([lt.then[0].kind, lt.then[0].name], ["valuable", "QQ V2"]);
lt = terrainEncounterDraw({ kind: "valuable", terrain: "forestDeciduous", rng: rig(face(4, 12), face(41, 100), face(2, 12)) });
assert.deepEqual(lt.either, { roll: 41, share: 40, kind: "dangerous" }, "a roll over it takes the second");
assert.deepEqual([lt.then[0].kind, lt.then[0].name], ["dangerous", "QQ D2"], "…and that kind's list is the one rolled");
registerHandoffs();
lt = terrainEncounterDraw({ kind: "valuable", terrain: "forestDeciduous", rng: rig(face(4, 12)) });
assert.ok(lt.ok && !lt.either, "the result itself stands without the share");
assert.deepEqual(lt.then, [{ ok: false, missing: "lesserTerrainShare" }], "an unimported share is a book line on the split");
registerHandoffs({ share: 40 });

// Awful Despoiling: one valuable roll, with its own follow-ups.
const ad = terrainEncounterDraw({ kind: "valuable", terrain: "forestDeciduous", rng: rig(face(8, 12), face(9, 12)) });
assert.equal(ad.then.length, 1);
assert.deepEqual([ad.then[0].kind, ad.then[0].name, ad.then[0].via], ["valuable", "Cache", "despoiled"]);
assert.equal(ad.then[0].lookups[0].value, "X, Y", "the further roll resolves its own follow-ups");

// A monster hand-off draws on the CALLER's territory.
const handoffRig = () => rig(face(5, 12), face(12, 20), face(50, 100));
let hs = terrainEncounterDraw({ kind: "valuable", terrain: "grassland", territory: "unsettled", rng: handoffRig() });
assert.deepEqual(hs.creature, { rarity: "rare", rarityRoll: 12, roll: 50, name: "QQ Terror" },
  "the unsettled column puts the same roll in the rare band");
hs = terrainEncounterDraw({ kind: "valuable", terrain: "grassland", territory: "borderlands", rng: handoffRig() });
assert.deepEqual(hs.creature, { missing: "monsters.grasslandFarm" },
  "the borderlands column reads the same roll as uncommon, which this world has not imported");
hs = terrainEncounterDraw({ kind: "valuable", terrain: "grassland", territory: "unsettled", rng: rig(face(6, 12), face(1, 20), face(1, 100)) });
assert.equal(hs.creature.name, "QQ Prowler", "a carcass draws a creature too");
hs = terrainEncounterDraw({ kind: "valuable", terrain: "grassland", territory: "unsettled", rng: rig(face(7, 12), face(1, 20), face(1, 100)) });
assert.equal(hs.creature.name, "QQ Prowler");
assert.deepEqual(hs.lookups.map((l) => l.value), ["T1"], "a shadow also reads the terrain's treasure row");

// The budget bounds a chain that feeds itself.
let calls = 0;
const counting = () => {
  calls++;
  return face(8, 12);
};
let spin = terrainEncounterDraw({ kind: "valuable", terrain: "forestDeciduous", rng: counting });
const spun = flattenTerrainDraw(spin);
assert.equal(calls, DRAW_BUDGET, "no more list rolls than the budget allows");
assert.equal(spun.length, DRAW_BUDGET + 1, "the node past the budget is still shown");
assert.deepEqual([spun.at(-1).depth, spun.at(-1).node.exhausted, spun.at(-1).node.ok], [DRAW_BUDGET, true, false]);
calls = 0;
spin = terrainEncounterDraw({ kind: "valuable", terrain: "forestDeciduous", rng: counting, budget: 2 });
assert.equal(calls, 2);
assert.ok(spin.then[0].then[0].exhausted && !spin.then[0].then[0].missing, "an exhausted node is not a missing table");
hd = terrainEncounterDraw({ kind: "valuable", terrain: "forestDeciduous", rng: rig(face(1, 12), face(2, 12)), budget: 2 });
assert.ok(hd.then[0].ok && hd.then[1].exhausted, "a pair cut short by the budget rolls what it can");
assert.ok(terrainEncounterDraw({ kind: "valuable", budget: 0 }).exhausted, "a spent budget rolls nothing at all");

// Flattened in resolution order, set-aside rolls first.
hd = terrainEncounterDraw({
  kind: "valuable",
  terrain: "forestDeciduous",
  rng: rig(face(1, 12), face(1, 12), face(2, 12), face(6, 12), face(3, 12)),
});
assert.deepEqual(flattenTerrainDraw(hd).map(({ depth, node }) => [depth, node.kind, node.name, node.setAside ?? null]), [
  [0, "valuable", "Double", null],
  [1, "valuable", "Double", "discarded"],
  [1, "valuable", "QQ V2", "discarded"],
  [1, "unique", "Awful Despoiling", null],
  [2, "valuable", "QQ V3", null],
], "depth follows the nesting, and a draw's children follow their parent");
assert.deepEqual(flattenTerrainDraw(null), [], "no draw flattens to nothing");
assert.deepEqual(flattenTerrainDraw({ ok: true, roll: 2, name: "Cache", follow: [], lookups: [] }).map((e) => e.depth), [0],
  "an old-shaped draw is a single node");

// The runner hands the party's territory to the draw.
registerHandoffs({ share: 40 });
chain = runEncounter({
  territory: "unsettled",
  terrain: "grassland",
  rng: rig(face(15, 20), face(4, 12), face(12, 20), face(50, 100)),
});
assert.equal(chain.terrainEncounter.creature.name, "QQ Terror", "the runner's own territory reaches the creature hand-off");
// The card's lines: flat, in order, indented by capped depth, a creature linked.
globalThis.game = {
  i18n: { localize: (k) => k, format: (k) => k, has: () => true },
  actors: { contents: [{ name: "QQ Terror", uuid: "Actor.qq" }] },
};
// The card module reaches the zone behaviour, whose class extends core's at import.
globalThis.foundry ??= { data: { regionBehaviors: { RegionBehaviorType: class {} } } };
const { terrainDrawLines, encounterWhen } = await import("../scripts/formation/encounter-card.mjs");
registerHandoffs({ share: 40 });
let lines = terrainDrawLines(terrainEncounterDraw({
  kind: "valuable",
  terrain: "grassland",
  territory: "unsettled",
  rng: rig(face(1, 12), face(4, 12), face(5, 12), face(10, 100), face(2, 12), face(12, 20), face(50, 100)),
}));
assert.deepEqual(lines.map((l) => [l.depth, l.kind, l.name]), [
  [0, "roll", "Double"],
  [1, "roll", "Lesser Terrain"],
  [2, "either", "ACKS-FORMATION.travel.enc.outcome.valuableTerrain"],
  [2, "roll", "QQ V2"],
  [1, "roll", "Hidden Settlement"],
  [2, "creature", "QQ Terror"],
], "the lines read in resolution order, each hand-off one level in");
assert.equal(lines.at(-1).link, "@UUID[Actor.qq]{QQ Terror}", "a creature line links its actor");
lines = terrainDrawLines(terrainEncounterDraw({ kind: "valuable", terrain: "forestDeciduous", rng: counting }));
assert.equal(Math.max(...lines.map((l) => l.depth)), 3, "a deep chain indents no further than the last class");
assert.equal(lines.at(-1).kind, "exhausted", "the budget's end is a line of its own");
assert.deepEqual(terrainDrawLines(terrainEncounterDraw({ kind: "nothing" })), [], "a missing list draws no line");

// A row that names an equivalent trap carries it from the sub-table draw to the card's line.
registerTable({
  id: ENCOUNTERS_DOC,
  tables: {
    ...SAMPLE.tables,
    terrainEncounters: { dangerous: ["Hazard", "QQ2", "QQ3", "QQ4", "QQ5", "QQ6", "QQ7", "QQ8", "QQ9", "QQ10", "QQ11", "QQ12"] },
    terrainSubTables: {
      hazard: [
        { min: 1, max: 3, name: "QQ Slide", trap: "QQ trap alpha" },
        { min: 4, max: 5, name: "QQ Drift" },
      ],
    },
  },
}, { priority: PRIORITY.WORLD, source: "test" });
assert.equal(subTableDraw({ table: "hazard", rng: rig(face(2, 5)) }).trap, "QQ trap alpha", "a row's trap rides its draw");
assert.ok(!("trap" in subTableDraw({ table: "hazard", rng: rig(face(5, 5)) })), "a row without one adds no key");
lines = terrainDrawLines(terrainEncounterDraw({ kind: "dangerous", terrain: "grassland", rng: rig(face(1, 12), face(1, 5)) }));
assert.deepEqual(lines.map((l) => [l.kind, l.name, l.trap]), [["roll", "Hazard", null], ["follow", "QQ Slide", "QQ trap alpha"]],
  "the hazard's follow line carries its trap, the root line none");
lines = terrainDrawLines(terrainEncounterDraw({ kind: "dangerous", terrain: "grassland", rng: rig(face(1, 12), face(5, 5)) }));
assert.equal(lines.at(-1).trap, null, "a hazard with no trap carries null");

// Where in its period an encounter falls: one face per unit of the span, never a printed die.
const clock = { hoursPerDay: 24, dawn: 7, dusk: 19 };
assert.deepEqual(encounterWhen({ activity: "travel", mileHex: 11, rng: rig(face(9, 11)) }), [{ key: "mile", n: 9 }],
  "a per-hex throw rolls a face per mile of the cadence");
assert.deepEqual(encounterWhen({ activity: "travel", mileHex: null }), [], "no cadence, no mile");
assert.deepEqual(encounterWhen({ activity: "travel", mileHex: 0 }), []);
assert.deepEqual(encounterWhen({ activity: "search", secondsPerHour: 3600, turnSeconds: 600, rng: rig(face(4, 6)) }), [{ key: "turn", n: 4 }],
  "an hour of the calendar over the turn is the turn count");
assert.deepEqual(encounterWhen({ activity: "search", secondsPerHour: 2300, turnSeconds: 100, rng: rig(face(23, 23)) }), [{ key: "turn", n: 23 }],
  "a calendar with another hour gives another count");
assert.deepEqual(encounterWhen({ activity: "search", secondsPerHour: 3600, turnSeconds: 600, rng: rig(0.999999) }), [{ key: "turn", n: 6 }],
  "the top of the die is the last turn");
assert.deepEqual(encounterWhen({ activity: "search", secondsPerHour: null, turnSeconds: 600, rng: rig(face(2, 6)) }), [{ key: "turn", n: 2 }],
  "a clock with no calendar falls back to an ordinary hour");
assert.deepEqual(encounterWhen({ activity: "search", secondsPerHour: 3600, turnSeconds: 7200 }), [], "an hour shorter than a turn has no turns to name");
assert.deepEqual(encounterWhen({ activity: "rest", night: false, clock, rng: rig(face(5, 12)) }), [{ key: "hourDawn", n: 5 }],
  "a day's rest is placed in the hours from dawn to dusk");
assert.deepEqual(encounterWhen({ activity: "rest", night: true, clock, rng: rig(face(12, 12)) }), [{ key: "hourDusk", n: 12 }],
  "a night's rest is placed in the hours from dusk to dawn");
assert.deepEqual(encounterWhen({ activity: "rest", night: true, clock: { hoursPerDay: 20, dawn: 3, dusk: 13 }, rng: rig(face(10, 10)) }), [{ key: "hourDusk", n: 10 }],
  "the span wraps the calendar's own day length");
assert.deepEqual(encounterWhen({ activity: "rest", night: true, nights: 3, clock, rng: rig(face(2, 3), face(1, 12)) }),
  [{ key: "night", n: 2, of: 3 }, { key: "hourDusk", n: 1 }], "a period of several nights also names the night");
assert.deepEqual(encounterWhen({ activity: "rest", night: true, nights: 1, clock, rng: rig(face(3, 12)) }), [{ key: "hourDusk", n: 3 }],
  "a one-night period names no night");
assert.deepEqual(encounterWhen({ activity: "rest", night: true, nights: 5, clock: null, rng: rig(face(4, 5)) }), [{ key: "night", n: 4, of: 5 }],
  "with no calendar the night is still placed in its period");
assert.deepEqual(encounterWhen({ activity: "rest", clock: { hoursPerDay: 24, dawn: 6, dusk: 6 } }), [], "a day with no dark has no hours to place");
assert.deepEqual(encounterWhen({ activity: "hunt", clock, nights: 4 }), [], "a per-attempt throw is placed nowhere");
assert.deepEqual(encounterWhen({ activity: "traps", clock, mileHex: 6 }), []);
assert.deepEqual(encounterWhen({ activity: "entry", clock, mileHex: 6 }), []);

delete globalThis.game;
delete globalThis.foundry;

resetTables();
registerSample();

/* --- a zone's own throw and table ------------------------------------------- */
// A zone target replaces the territory d20 with a d6 of its own.
const noZone = { territory: "borderlands", terrain: "grassland" };
chain = runEncounter({
  ...noZone,
  zone: { target: 4, table: false },
  rng: rig(face(5, 6), face(1, 20), face(51, 100), face(3, 6), face(3, 6)),
});
assert.deepEqual(chain.zone, { roll: 5, target: 4, hit: true }, "a roll at or over the zone's target is a hit");
assert.deepEqual(chain.territory, { ok: true, skipped: true }, "the territory throw is marked skipped, not failed");
assert.equal(chain.outcome, "monster", "a zone's hit is a creature encounter");
assert.equal(chain.rarity.rarity, "common", "with no zone table the territory's rarity is thrown");
assert.equal(chain.creature.name, "QQ Stalker", "and the terrain's sub-table names the creature");
assert.ok(!chain.zoneDraw);
assert.ok(chain.distance.ok && chain.distance.feet === 180, "the distance still rolls");

chain = runEncounter({ ...noZone, zone: { target: 4, table: false }, rng: rig(face(3, 6)) });
assert.deepEqual(chain.zone, { roll: 3, target: 4, hit: false }, "a roll under the target misses");
assert.equal(chain.outcome, "none");
assert.ok(!chain.rarity && !chain.creature && !chain.distance, "a miss rolls nothing further");

chain = runEncounter({ ...noZone, zone: { target: 6, table: true }, rng: rig(face(6, 6), face(1, 6), face(1, 6)) });
assert.equal(chain.zoneDraw, true, "a zone hit with a table hands the creature step to the table");
assert.ok(!chain.rarity && !chain.creature, "and stops there: no rarity, no sub-table draw");
assert.ok(chain.distance.ok && chain.distance.feet === 60, "the distance still rolls");

resetTables();
chain = runEncounter({ ...noZone, zone: { target: 1, table: false }, rng: rig(face(1, 6)) });
assert.ok(chain.zone.hit && chain.territory.ok && !chain.territory.missing,
  "a zone throw needs no territory table, and reports none missing");
assert.equal(chain.rarity.missing, "rarity", "the steps after it still read the registry");
registerSample();

// Target 0 inherits the territory throw; a table replaces only the creature step.
const borderRig = () => rig(face(12, 20), face(20, 20), face(3, 6), face(3, 6));
chain = runEncounter({ ...noZone, zone: { target: 0, table: true }, rng: borderRig() });
assert.equal(chain.territory.roll, 12, "a zone with no target leaves the territory throw standing");
assert.ok(!chain.zone, "and records no zone throw");
assert.equal(chain.outcome, "monster");
assert.equal(chain.rarity.rarity, "rare", "the rarity is still thrown for a monster outcome");
assert.equal(chain.zoneDraw, true, "the zone's table replaces the sub-table draw");
assert.ok(!chain.creature);
assert.ok(chain.distance.ok && chain.distance.feet === 180);

chain = runEncounter({ territory: "civilized", road: true, terrain: "grassland", zone: { target: 0, table: true }, rng: rig(face(20, 20)) });
assert.equal(chain.outcome, "civilized");
assert.equal(chain.zoneDraw, true, "a civilized outcome hands its creature to the zone's table too");
assert.ok(!chain.creature && !chain.rarity, "with no civilized draw and no rarity throw");

chain = runEncounter({ territory: "unsettled", terrain: "grassland", zone: { target: 0, table: true }, rng: rig(face(15, 20), face(5, 12)) });
assert.equal(chain.outcome, "uniqueTerrain", "a terrain outcome is unchanged by a zone table");
assert.ok(chain.terrainEncounter && !chain.zoneDraw);

assert.deepEqual(
  runEncounter({ ...noZone, zone: { target: 0, table: false }, rng: borderRig() }),
  runEncounter({ ...noZone, rng: borderRig() }),
  "a zone that states nothing is no zone at all",
);

/* --- overlapping zones, composed field by field ----------------------------- */
const { ZONE_FIELD_DEFAULTS, composeZones, polygonArea, sourceLayers } = await import("../scripts/formation/zone-layers.mjs");
assert.equal(polygonArea([0, 0, 10, 0, 10, 10, 0, 10]), 100, "the shoelace area of a square");
assert.equal(polygonArea([0, 10, 10, 10, 10, 0, 0, 0]), 100, "whichever way the ring winds");
assert.equal(polygonArea([0, 0, 10, 0]), 0, "two points enclose nothing");

const outer = { area: 1000, fields: { tableUuid: "RollTable.outer", encounterTarget: 3, journeyCadence: "entry", dayThrows: 0 } };
const inner = { area: 100, fields: { tableUuid: "", encounterTarget: 5, journeyCadence: "", dayThrows: 2 } };
let composed = composeZones([outer, inner]);
assert.deepEqual(composed.fields, { tableUuid: "RollTable.outer", encounterTarget: 5, journeyCadence: "entry", dayThrows: 2, nightThrows: 0 },
  "the smallest zone stating a field wins it; a zero or a blank states nothing");
assert.equal(composed.sources.encounterTarget, inner, "each field names the layer that supplied it");
assert.equal(composed.sources.tableUuid, outer);
assert.equal(composed.sources.nightThrows, null, "a field nobody stated has no source");
assert.deepEqual(sourceLayers(composed), [outer, inner], "the suppliers, once each, in field order");

const first = { area: 100, fields: { encounterTarget: 2 } };
const second = { area: 100, fields: { encounterTarget: 6 } };
assert.equal(composeZones([first, second]).fields.encounterTarget, 2, "equal areas: the first in document order wins");
assert.equal(composeZones([second, first]).fields.encounterTarget, 6);
composed = composeZones([]);
assert.deepEqual(composed.fields, ZONE_FIELD_DEFAULTS, "no zone reads every default");
assert.ok(Object.values(composed.sources).every((s) => s === null));

console.log("test-encounters: OK (columns, shift loop, draws, distance, detection, evasion, runner, terrain follow-ups, hand-offs, zone throw and table, zone composition)");
