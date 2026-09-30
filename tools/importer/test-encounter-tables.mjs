/**
 * `assembleEncounterTables` — the raw JJ/RR page reads shaped into the
 * engine tables acks-extras declares on the `encounters` document. Invented
 * cells throughout, shaped like the printed ones; no book value or creature
 * name is reproduced (QQ names stand in).
 */
import assert from "node:assert";
import {
  MONSTER_RAW_KEYS,
  TERRAIN_SUB_RAW_KEYS,
  assembleColumns,
  assembleEncounterTables,
  assembleSubTable,
  bandFromKey,
  parseBand,
  parseDistanceCell,
  parseSizeEdges,
  parseTarget,
  repairName,
  sentenceCell,
  signedCell,
  treasureLetters,
} from "../../scripts/importer/encounters-binding.mjs";

let pass = 0;
const check = (label, cond) => { assert.ok(cond, label); pass++; };

/* --- the cell parsers ---------------------------------------------------- */
check("a range band parses", parseBand("3 – 9").min === 3 && parseBand("3 – 9").max === 9);
check("a single value is its own band", parseBand("17").max === 17);
check("a dash is null", parseBand("-") === null);
check("a row key's band", bandFromKey("07-08").min === 7 && bandFromKey("07-08").max === 8);
check("the wrapped last band reads to 100", bandFromKey("99-00").max === 100);
check("a five-wide civilized key", bandFromKey("96-100").max === 100);
check("small-caps case rises at the name's joints",
  repairName("attercop, demonic") === "Attercop, Demonic");
check("parentheticals stay lowercase", repairName("camel (single-humped)") === "Camel (single-humped)");
check("an empty cell is null", repairName(" - ") === null);
check("a distance cell splits three ways",
  JSON.stringify(parseDistanceCell("3d8 × 15’ (203’)")) === JSON.stringify({ dice: "3d8", mult: 15, avg: 203 }));
check("a throw target parses", parseTarget("11+") === 11);
check("the size header's edges read out",
  JSON.stringify(parseSizeEdges("t errain t ype 5- 6 to 12 13 to 25 26 to 50 51+")) === JSON.stringify([5, 12, 25, 50]));

/* --- the assembly ---------------------------------------------------------- */
const out = assembleEncounterTables({
  territoryRaw: {
    columnShift: { civilizedRoad: "1", unsettled: "-" },
    none: { civilizedRoad: "2 - 12", unsettled: "1 – 5" },
    civilized: { civilizedRoad: "13 – 20", unsettled: "-" },
    monster: { civilizedRoad: "-", unsettled: "6 – 20" },
  },
  rarityRaw: {
    common: { borderlands: "1-11" },
    uncommon: { borderlands: "12-20" },
  },
  // Cells arrive gap-joined (joinGap closes the small-caps welds), so the
  // binding sees "camel", never "c amel".
  civilizedUpperRaw: {
    "01-05": { g1: "camel", g3: "QQ Drover" },
    "96-100": { g1: "QQ Ghoul", g3: "QQ Weretiger" },
  },
  civilizedLowerRaw: {
    "01-05": { g1: "QQ Heron" },
  },
  monstersSwampRaw: {
    "01-02": { common: "QQ Leech", veryRare: "attercop, hideous" },
    "99-00": { common: "QQ Newt" },
  },
  distanceRaw: {
    grassland: { cell: "3d8 × 15’ (203’)" },
    jungle: { cell: "see text" },
  },
  evasionRaw: {
    grassland: { s1: "9+", s2: "11+", s3: "13+", s4: "15+", s5: "17+" },
  },
  evasionSizeProse: { bands: "t ype 5- 6 to 12 13 to 25 26 to 50 51+" },
  visibilityProse: {
    light: "sight is 550’ in daylight, 275’ in full moonlight, 140’ in half-moonlight, and 70’ in starlight.",
    party: "formations (9 – 25 men) increase visibility distance by +40%.",
    battalion: "formations (200+ men) increase it by +300%.",
    heads: "count each mounted man or large creature as 3 men, each huge creature as 5 men, each gigantic creature as 22 men, and each colossal creature as 110 men.",
    altitude: " one- half the encounter distance",
  },
  evasionModsProse: {
    grid: { aerial: -3, explorer: 6, forlornHope: 5, movement: -3 },
    aftermath: { aftermathNavigation: -3 },
  },
  valuableTerrainRaw: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [String(i + 1), { name: `QQ${i + 1}` }])),
});

check("territory columns become bracket bands with their outcomes",
  out.territory.civilizedRoad.length === 3 &&
  out.territory.civilizedRoad[1].outcome === "none" &&
  out.territory.unsettled.find((b) => b.outcome === "monster").min === 6);
check("a dashed cell contributes no band",
  !out.territory.unsettled.some((b) => b.outcome === "civilized"));
check("rarity bands assemble per territory", out.rarity.borderlands[1].rarity === "uncommon");
check("the two civilized halves land on their group keys",
  out.civilized.desertBarrens[0].name === "Camel" &&
  out.civilized.savannaJungleRiver[1].min === 96 &&
  out.civilized.taiga[0].name === "QQ Heron");
check("a monster grid lands on its sub-table id with repaired names",
  out["monsters.swamp"].common.length === 2 &&
  out["monsters.swamp"].veryRare[0].name === "Attercop, Hideous" &&
  out["monsters.swamp"].common[1].max === 100);
check("all eighteen raw keys are mapped", Object.keys(MONSTER_RAW_KEYS).length === 18);
check("distance rows parse; junk rows are omitted, never zeroed",
  out.distance.grassland.mult === 15 && !("jungle" in out.distance));
check("evasion bands pair the header's edges with each column's target",
  out.evasion.grassland[0].max === 5 &&
  out.evasion.grassland[1].min === 6 && out.evasion.grassland[1].target === 11 &&
  out.evasion.grassland[4].min === 51 && out.evasion.grassland[4].max === null);
check("the light figures land by band",
  out.visibility.daylight === 550 && out.visibility.fullMoon === 275 &&
  out.visibility.halfMoon === 140 && out.visibility.starlight === 70);
check("the formation scale gains its ×1 floor and keeps the printed rows",
  out.visibility.formationScale[0].pct === 0 && out.visibility.formationScale[0].max === 8 &&
  out.visibility.formationScale[1].pct === 40 &&
  out.visibility.formationScale.at(-1).max === null && out.visibility.formationScale.at(-1).pct === 300);
check("the head ladder reads every size",
  out.visibility.headCounts.mounted === 3 && out.visibility.headCounts.huge === 5 &&
  out.visibility.headCounts.gigantic === 22 && out.visibility.headCounts.colossal === 110);
check("the altitude word becomes its fraction", out.visibility.altitudeFraction === 0.5);
check("modifier sizes store unsigned; the navigation penalty keeps its sign",
  out.evasionModifiers.aerial === 3 && out.evasionModifiers.explorer === 6 &&
  out.evasionModifiers.movement === 3 && out.evasionModifiers.aftermathNavigation === -3);
check("a complete d12 list assembles in order",
  out.terrainEncounters.valuable.length === 12 && out.terrainEncounters.valuable[11] === "QQ12");
check("empty raws assemble to nothing", Object.keys(assembleEncounterTables({})).length === 0);

/* --- terrain sub-tables and lookups ---------------------------------------- */
check("a result cell raises its first letter and nothing else",
  sentenceCell("a qq hollow, dry, and hidden.") === "A qq hollow, dry, and hidden.");
check("treasure letters rise and space out",
  treasureLetters("n,d") === "N, D" && treasureLetters("o×2") === "O×2" && treasureLetters("Q, n") === "Q, N");
check("a signed cell keeps its sign", signedCell("+3") === 3 && signedCell("0") === 0 && signedCell("−2") === -2);

const d6 = (cells) => Object.fromEntries(cells.map((c, i) => [`b${i}`, { ...c, min: i + 1, max: i + 1 }]));
const subs = assembleEncounterTables({
  structureRaw: d6([{ name: "qq hall" }, { name: "QQ Keepish" }, { name: "qq arch" }, { name: "qq well" }, { name: "qq pit" }, { name: "qq wall" }]),
  challengeRaw: {
    b0: { name: "qq climb", example: "qq cliff", dimensions: "1d6 × 10’", min: 1, max: 5 },
    b1: { name: "QQ Swim", example: "qq river", dimensions: "1d4 × 10’", min: 6, max: 10 },
  },
  complexMapRaw: d6([{ name: "q", value: "QQ1" }, { name: "Q, n", value: "QQ2" }, { name: "o×2", value: "QQ3" },
    { name: "K", value: "QQ4" }, { name: "L", value: "QQ5" }, { name: "P", value: "QQ6" }]),
  // A row the page held and the read lost: the bands no longer tile the die.
  oreRaw: { b0: { name: "qq tin", min: 1, max: 40 }, b1: { name: "qq lead", min: 51, max: 100 } },
  // Every row read but the last: 1–5 is no die, so it is not a d5.
  hazardRaw: d6([{ name: "qq1" }, { name: "qq2" }, { name: "qq3" }, { name: "qq4" }, { name: "qq5" }]),
  treasureByTerrainRaw: { forest: { types: "L,d" }, river: { types: "" }, ocean: { __missing: true } },
  ruinModifierRaw: { clearGrassScrub: { modifier: "0" }, jungleSwampOceanDesertBarren: { modifier: "+4" } },
});
check("a sub-table lands under its engine key, first letters raised",
  subs.terrainSubTables.structure.length === 6 && subs.terrainSubTables.structure[0].name === "Qq hall" &&
  subs.terrainSubTables.structure[1].name === "QQ Keepish");
check("a multi-cell result joins its cells in reading order",
  subs.terrainSubTables.challenge[1].name === "QQ Swim — Qq river — 1d4 × 10’" &&
  subs.terrainSubTables.challenge[1].min === 6 && subs.terrainSubTables.challenge[1].max === 10);
check("a treasure cell reads as letters, its value as text",
  subs.terrainSubTables.complexMap[1].name === "Q, N — QQ2" && subs.terrainSubTables.complexMap[2].name === "O×2 — QQ3");
check("bands with a gap assemble nothing", !("ore" in subs.terrainSubTables));
check("bands topping out off a die assemble nothing", !("hazard" in subs.terrainSubTables));
check("every raw sub-table has an engine key",
  Object.values(TERRAIN_SUB_RAW_KEYS).every((s) => s.key && s.cells.length));
check("the treasure lookup keeps the groups it read",
  subs.treasureByTerrain.forest === "L, D" && !("river" in subs.treasureByTerrain) && !("ocean" in subs.treasureByTerrain));
check("the ruin lookup parses its modifiers",
  subs.ruinModifier.clearGrassScrub === 0 && subs.ruinModifier.jungleSwampOceanDesertBarren === 4);
check("a sub-table with an empty result assembles nothing",
  assembleSubTable({ b0: { name: "qq", min: 1, max: 1 }, b1: { name: "", min: 2, max: 2 } }) === null);

/* --- partials -------------------------------------------------------------- */
const partial = assembleEncounterTables({
  evasionRaw: { grassland: { s1: "9+" } },
  // No size prose: no way to bound the bands — the table is omitted whole.
});
check("evasion without its size header assembles nothing", !("evasion" in partial));

console.log(`test-encounter-tables: all ${pass} checks passed`);
