/**
 * `assembleWeatherTables` — the raw JJ/RR page reads shaped into the engine
 * tables acks-extras declares on the `weather` document. Invented cells
 * throughout, shaped like the printed ones; no book value is reproduced.
 */
import assert from "node:assert";
import {
  WEATHER_DOC_ID,
  applyWeatherImport,
  assembleBands,
  assembleConditionEffects,
  assembleWeatherTables,
  cutAtNextEntry,
  parseBandCell,
  parseConditionEntry,
  parseDaysAfter,
  parseDaysBefore,
  parseDustTerrains,
  parseModifierCell,
  parsePenaltyClauses,
  parseSpeedWord,
  parseVisibilityFactor,
  parseVisibilityFeet,
} from "../../scripts/importer/weather-binding.mjs";
import { PRIORITY, getDoc, registerTable, resetTables, unregisterTable } from "../../scripts/lib/tables.mjs";
import * as services from "../../scripts/lib/services.mjs";
import { ownTables } from "../../scripts/importer/tables-binding.mjs";
import { parseFrequencyCell, assembleTravelTables } from "../../scripts/importer/travel-binding.mjs";

let pass = 0;
const check = (label, cond) => { assert.ok(cond, label); pass++; };

/* --- the cell parsers ---------------------------------------------------- */
check("a band cell parses to its key", parseBandCell("Frigid (-99 F or less)") === "frigid");
check("welded small caps still parse", parseBandCell("v ery c hilly (12 to 34 F)") === "veryChilly");
check("the longer band wins over its prefix", parseBandCell("very strong, Windy") === "veryStrong");
check("a paired wind band takes the band's own name", parseBandCell("Gale, Stormy") === "gale");
check("a dash cell is null", parseBandCell("-") === null);
check("junk is null, never a guess", parseBandCell("Thundersnow") === null);

const mods = parseModifierCell("t +9 (day), -2 (night), P -8, W +3");
check("a compound modifier cell splits four ways",
  mods.tDay === 9 && mods.tNight === -2 && mods.p === -8 && mods.w === 3);
const polar = parseModifierCell("-9 (day and night), P -6, W -1");
check("the polar form reads one temperature for both",
  polar.tDay === -9 && polar.tNight === -9 && polar.p === -6 && polar.w === -1);
check("junk is null", parseModifierCell("see text") === null);

check("halved reads as one half", parseSpeedWord(" halved and cannot forage") === 0.5);
check("quartered reads as one quarter", parseSpeedWord(" quartered. The force") === 0.25);
check("no speed word is null", parseSpeedWord(" miserable but unhindered") === null);

check("a word count before its phrase", parseDaysBefore("after two days of rainy or five days of drizzly", "drizzly") === 5);
check("digits work too", parseDaysBefore("in 4 days of moderate temperatures", "moderate") === 4);
check("a count after a verb", parseDaysAfter("weather and freezes in six days of cold", "freezes\\s*in") === 6);
check("an absent phrase is null", parseDaysBefore("after two days of rainy", "flurry") === null);

/* --- bands group and open their ends -------------------------------------- */
const rawRows = {
  "-3": { t: "Frigid (invented)" },
  "-2": { t: "Frigid (invented)" },
  "-1": { t: "-" },
  0: { t: "Balmy (1 to 2 F)" },
  1: { t: "Balmy (3 to 4 F)" },
  2: { t: "Sweltering (5 F or more)" },
};
const bands = assembleBands(rawRows, "t");
check("consecutive rows of one band merge", bands.length === 3);
check("the first band opens downward", bands[0].min === null && bands[0].max === -2 && bands[0].key === "frigid");
check("a dash row splits nothing it should not (balmy stands alone)",
  bands[1].key === "balmy" && bands[1].min === 0 && bands[1].max === 1);
check("the last band opens upward", bands[2].max === null && bands[2].key === "sweltering");

/* --- the whole assembly ---------------------------------------------------- */
const out = assembleWeatherTables({
  dailyWeatherRaw: {
    "-1": { tempLow: "Frigid (x)", tempHigh: "-", precipitation: "Sunbaked", wind: "s till" },
    0: { tempLow: "Cold (x)", tempHigh: "c hilly (x)", precipitation: "c lear", wind: "s till" },
    1: { tempLow: "Cold (x)", tempHigh: "Warm (x)", precipitation: "Drizzly", wind: "Moderate" },
    2: { tempLow: "-", tempHigh: "Sweltering (x)", precipitation: "Rainy", wind: "Gale, Stormy" },
  },
  climateModifiersRaw: {
    Qf: {
      winter: "t +1 (day), +0 (night), P -9, W +1",
      spring: "t +2 (day), -1 (night), P -8, W +0",
    },
    QQ: { winter: "unreadable" },
  },
  // The executor keys valueBlocks results by block id, one per page.
  conditionProse: {
    p277: { frigid: " halved and cannot forage" },
    p279: {
      stormy: " quartered. The force of the wind",
      mud: " halved for all purposes unless",
      snowGround: " halved for all purposes.",
      windy: " miserable but unhindered", // no speed word: omitted
    },
  },
  accumulationProse: {
    mudForm: " one day of rainy or five days of drizzly conditions",
    mudDry: " two days of sweltering fair weather, or nine days of moderate fair weather and freezes in one day of cold",
    snowForm: " one day of snowy or four days of flurry conditions",
    snowMelt: " nine days of moderate temperatures or two days of sweltering",
  },
});

check("each axis assembles its bracket rows",
  out.dailyTemperatureLow.length === 2 && out.dailyTemperatureHigh.length === 3 &&
  out.dailyPrecipitation.length === 4 && out.dailyWind.length === 3);
check("the low column never saw the dash row's modifier",
  out.dailyTemperatureLow[out.dailyTemperatureLow.length - 1].key === "cold");
check("a climate keeps only the seasons that parsed",
  out.climateModifiers.Qf.winter.p === -9 && out.climateModifiers.Qf.spring.tNight === -1 &&
  !("QQ" in out.climateModifiers));
check("condition factors map to the engine's ground names",
  out.conditionSpeed.frigid === 0.5 && out.conditionSpeed.stormy === 0.25 &&
  out.conditionSpeed.muddy === 0.5 && out.conditionSpeed.snowbound === 0.5);
check("a sentence without a speed word contributes nothing", !("windy" in out.conditionSpeed));
check("every threshold reads its day count",
  out.accumulation.mudFromRainy === 1 && out.accumulation.mudFromDrizzly === 5 &&
  out.accumulation.mudDrySweltering === 2 && out.accumulation.mudDryModerate === 9 &&
  out.accumulation.mudFreeze === 1 && out.accumulation.snowFromSnowy === 1 &&
  out.accumulation.snowFromFlurry === 4 && out.accumulation.snowMeltModerate === 9 &&
  out.accumulation.snowMeltSweltering === 2);
check("empty raws assemble to nothing", Object.keys(assembleWeatherTables({})).length === 0);

/* --- the frequency cells (travel doc) -------------------------------------- */
check("a hex cadence parses", parseFrequencyCell("o nce per 8-mile hex").kind === "perHex");
check("an hourly cadence parses", parseFrequencyCell("Once per hour").kind === "perHour");
check("a traps cadence is per attempt with its count", parseFrequencyCell("once per 9 traps").per === 9);
check("a period cadence keeps its hours", parseFrequencyCell("once per 18 hours").hours === 18);
check("nights are a period too", parseFrequencyCell("once per 5 nights").nights === 5);
check("none is null (no throw), not undefined", parseFrequencyCell("n one") === null);
check("junk is undefined (unread), not null", parseFrequencyCell("whenever") === undefined);

const trav = assembleTravelTables({
  encounterFrequencyRaw: {
    traveling: { civilized: "once per 8-mile hex", unsettled: "once per 8-mile hex" },
    restingDay: { civilized: "n one", unsettled: "once per 18 hours" },
  },
});
check("the frequency grid assembles onto the travel doc",
  trav.encounterFrequency.traveling.civilized.kind === "perHex" &&
  trav.encounterFrequency.restingDay.civilized === null &&
  trav.encounterFrequency.restingDay.unsettled.hours === 18);

/* --- a condition's entry: every clause read on its own ---------------------- */
// Invented entries shaped like the printed ones — the sentence shapes are what
// the readers pin; every figure, ground and count is made up.
const clauses = parsePenaltyClauses(
  "during the murk, maximum visibility distance drops to half range, all missile attacks suffer a -3 penalty, and roads provide no benefit.",
);
check("a clause taxes only the throws its own subject names",
  clauses.length === 1 && clauses[0].throws.missile === -3 && !("searching" in clauses[0].throws));
check("a list of throws is read whole",
  parsePenaltyClauses("land surveying, navigation, and searching proficiency throws suffer a -1 penalty.")[0].throws.navigation === -1);
check("per hour makes tracking the hourly key",
  parsePenaltyClauses("tracking proficiency throws suffer a -7 penalty per hour.")[0].throws.trackingPerHour === -7);
check("a penalty is negative whichever way its sign printed",
  parsePenaltyClauses("listening proficiency throws suffer a 2 penalty.")[0].throws.listening === -2);
check("a foraging subject names what it was after",
  parsePenaltyClauses("foraging proficiency throws to find firewood suffer a -5 penalty.")[0].forage.firewood === -5
  && parsePenaltyClauses("foraging proficiency throws to find water suffer a -5 penalty.")[0].forage.water === -5);
check("two clauses in one sentence keep their own subjects",
  (() => {
    const two = parsePenaltyClauses("all missile attack throws suffer a -3 penalty and listening proficiency throws suffer a -5 penalty.");
    return two.length === 2 && two[0].throws.missile === -3 && two[1].throws.listening === -5 && !("missile" in two[1].throws);
  })());
check("a ceiling in feet reads, with the page's own quote mark",
  parseVisibilityFeet("maximum visibility distance drops to 45’ (which matters).") === 45
  && parseVisibilityFeet("visibility is reduced to 35', all speeds are halved") === 35);
check("a halving reads as a factor", parseVisibilityFactor("maximum visibility distance drops to half range, all") === 0.5);
check("no visibility clause is null", parseVisibilityFeet("the sky is grey") === null && parseVisibilityFactor("the sky is grey") === null);
check("the dust clause names its grounds as terrain keys",
  JSON.stringify(parseDustTerrains("in barrens or desert terrain only, visibility is reduced")) === '["barrens","desert"]'
  && parseDustTerrains("in any terrain").length === 0);
check("the cut falls at the next entry's heading pair, not at a name used in passing",
  cutAtNextEntry("suffers under frigid temperatures unless warm. the end. Cold Temperatures Cold temperatures are above zero").trim() === "suffers under frigid temperatures unless warm. the end."
  && cutAtNextEntry("the last entry. Mud and Snow Mud accumulates after a while").trim() === "the last entry.");

const RAINY = "heavy or violent precipitation of at least 3” per day. during rainy conditions, maximum visibility "
  + "distance drops to half range, all missile attacks suffer a -3 penalty, and earthen roads provide no benefit. "
  + "land surveying, navigation, and searching proficiency throws suffer a -1 penalty. foraging proficiency throws "
  + "to find firewood suffer a -5 penalty. tracking proficiency throws suffer a -7 penalty per hour. a wanderer who "
  + "endures rainy conditions for nine consecutive days has a 13% chance of catching a disease. Snowy Conditions "
  + "Snowy conditions bring heavy snowfall and land surveying proficiency throws suffer a -9 penalty.";
const rainy = parseConditionEntry(RAINY);
check("an entry's throws, forage, eye and week are all read",
  rainy.throws.missile === -3 && rainy.throws.landSurveying === -1 && rainy.throws.navigation === -1
  && rainy.throws.searching === -1 && rainy.throws.trackingPerHour === -7 && rainy.forage.firewood === -5
  && rainy.visibilityFactor === 0.5 && rainy.disease.days === 9 && rainy.disease.pct === 13);
check("and the next entry's clause is not", rainy.throws.landSurveying === -1 && !("visibilityFeet" in rainy));

const GUSTY = "prevail when wind speeds are high. during gusty conditions, all missile attack throws and listening "
  + "proficiency throws suffer a -3 penalty. wanderers in gusty conditions have their expedition speed halved. air "
  + "speed is quartered in any terrain in gusty conditions. in barrens or desert terrain only, visibility is reduced "
  + "to 35’, all speeds are halved, and land surveying, navigation, searching, and tracking proficiency throws all "
  + "suffer -9 penalties due to sand.";
const gusty = parseConditionEntry(GUSTY);
check("the grounds-only sentence becomes the dust clause with its own figures",
  gusty.dust.terrains.join(",") === "barrens,desert" && gusty.dust.visibilityFeet === 35 && gusty.dust.speed === 0.5
  && gusty.dust.throws.searching === -9 && gusty.dust.throws.tracking === -9);
check("the wind's own clauses stay outside the dust",
  gusty.throws.missile === -3 && gusty.throws.listening === -3 && !("searching" in gusty.throws)
  && !("visibilityFeet" in gusty) && gusty.airSpeed === 0.25);

const MURKY = "can arise from mist or smoke. during murky conditions, maximum visibility distance drops to 45’ (which "
  + "matters). land surveying, navigation, searching, and tracking proficiency throws also suffer a -5 penalty. "
  + "wanderers in murky conditions have their speeds halved for all purposes.";
const murky = parseConditionEntry(MURKY);
check("a flat ceiling and a four-way penalty", murky.visibilityFeet === 45 && murky.throws.tracking === -5 && murky.throws.searching === -5);

const COLD = "are above zero. if the wanderer goes without protective clothing for more than nine hours he becomes "
  + "hypothermic. a wanderer who becomes hypothermic must make a death saving throw at the end of the day. if the "
  + "save fails, he is frostbitten and must roll 1d3 on the 9-11 row of the mortal wounds table, possibly losing "
  + "toes. a wanderer cannot rest under frigid temperatures unless he has either protective clothing or blankets or "
  + "a campfire or other large heat source. a wanderer who endures cold temperatures for five consecutive days has a "
  + "3% chance of catching a disease unless immune.";
const cold = parseConditionEntry(COLD);
check("the frostbite save and what a failure rolls are read across two sentences",
  cold.frostbite.save === "death" && cold.frostbite.die === "1d3" && cold.frostbite.row === "9-11");
check("a night's need reads either, and a neighbour's name in passing does not cut the entry short",
  cold.rest.both === false && cold.rest.fire && cold.rest.clothing && cold.disease.days === 5 && cold.disease.pct === 3);
check("both reads both",
  parseConditionEntry("cannot rest unless he has both protective clothing or blankets and a campfire.").rest.both === true);

const BAKED = "have clear skies. foraging proficiency throws to find water suffer a -5 penalty. wanderers without "
  + "protective clothing suffer 1 fire damage if they travel or work outdoors for 3 or more hours.";
const baked = parseConditionEntry(BAKED);
check("sunburn reads its damage, its kind and its hours", baked.forage.water === -5
  && baked.sunburn.damage === 1 && baked.sunburn.type === "fire" && baked.sunburn.hours === 3);
check("a damage type set as an inline glyph leaves the figure and the hours readable",
  (() => {
    const burn = parseConditionEntry("wanderers without protective clothing suffer 2 damage if they work outdoors for five or more hours.").sunburn;
    return burn.damage === 2 && burn.type === null && burn.hours === 5;
  })());
check("the air speed factor is read wherever the sentence puts it",
  parseConditionEntry("air speed in any terrain is quartered.").airSpeed === 0.25
  && parseConditionEntry("air speed is halved in any terrain in gusty conditions.").airSpeed === 0.5);
check("an entry with nothing readable is null", parseConditionEntry("the sky is grey and nothing happens.") === null);

const fx = assembleConditionEffects({
  p1: { rainy: RAINY, cold: COLD },
  p2: { sunbaked: BAKED, fair: "pleasant, and nothing happens." },
  windy: GUSTY,
});
check("blocks flatten to their condition keys and an empty entry is dropped",
  Object.keys(fx).sort().join(",") === "cold,rainy,sunbaked,windy");
check("the whole assembly carries the effects table",
  assembleWeatherTables({ conditionEffectsProse: { p1: { rainy: RAINY } } }).conditionEffects.rainy.throws.missile === -3);
check("no entries, no table", assembleConditionEffects({}) === null && assembleConditionEffects(null) === null);

/* --- an import rewrites only its own layer --------------------------------- */
// A Judge's override and a module's sample share the doc id with the import;
// the assembler reads and writes the WORLD layer alone, so neither is carried
// into what it writes. Invented cells, as above.
resetTables();
services.resetServices();
const writes = [];
services.register("ruledata-import", {
  importDoc: async (doc, opts) => {
    writes.push({ doc, opts });
    registerTable(doc, { priority: opts.priority });
  },
});
registerTable(
  { id: WEATHER_DOC_ID, tables: { sampleOnly: { x: 1 }, conditionProse: { mud: " halved for all purposes" } } },
  { priority: PRIORITY.SAMPLE },
);
check("a sample alone is not an import: nothing is assembled from it",
  (await applyWeatherImport()).assembled.length === 0 && writes.length === 0);
registerTable(
  {
    id: WEATHER_DOC_ID,
    source: { book: "jj" },
    tables: {
      conditionProse: { frigid: " halved and cannot forage" },
      dailyWind: [{ min: null, max: null, key: "still" }],
    },
  },
  { priority: PRIORITY.WORLD },
);
registerTable({ id: WEATHER_DOC_ID, tables: { dailyWind: [{ min: null, max: null, key: "gale" }] } },
  { priority: PRIORITY.OVERRIDE });
check("the override reads above the import", getDoc(WEATHER_DOC_ID).tables.dailyWind[0].key === "gale");
await applyWeatherImport();
const written = writes.at(-1);
check("the assembler writes the WORLD layer", written?.opts.priority === PRIORITY.WORLD);
check("the assembled table lands", written.doc.tables.conditionSpeed.frigid === 0.5);
check("the imported table is written back, not the override over it",
  written.doc.tables.dailyWind[0].key === "still");
check("no sample table is carried into the import", !("sampleOnly" in written.doc.tables));
unregisterTable(WEATHER_DOC_ID, { priority: PRIORITY.OVERRIDE });
check("clearing the override brings the imported value back", getDoc(WEATHER_DOC_ID).tables.dailyWind[0].key === "still");

// A world layer that already froze a sample's table (the merge before this
// read through every layer) sheds it at the next write, and only it.
resetTables();
registerTable({ id: "rarity", tables: { automation: { shift: 1 } } }, { priority: PRIORITY.SAMPLE });
registerTable(
  { id: "rarity", tables: { automation: { shift: 1 }, read: [1, 2], edited: { shift: 7 } } },
  { priority: PRIORITY.WORLD },
);
registerTable({ id: "rarity", tables: { edited: { shift: 1 } } }, { priority: PRIORITY.CATALOG });
const own = ownTables("rarity", PRIORITY.WORLD);
check("a table identical to the layer beneath is dropped", !("automation" in own));
check("a table only the import holds is kept", JSON.stringify(own.read) === "[1,2]");
check("a table that differs from the layer beneath is kept", own.edited?.shift === 7);
check("no world layer is no tables", Object.keys(ownTables("absent", PRIORITY.WORLD)).length === 0);
resetTables();
services.resetServices();

console.log(`test-weather-tables: all ${pass} checks passed`);
