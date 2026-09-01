/**
 * `assembleWeatherTables` — the raw JJ/RR page reads shaped into the engine
 * tables acks-extras declares on the `weather` document. Invented cells
 * throughout, shaped like the printed ones; no book value is reproduced.
 */
import assert from "node:assert";
import {
  assembleBands,
  assembleWeatherTables,
  parseBandCell,
  parseDaysAfter,
  parseDaysBefore,
  parseModifierCell,
  parseSpeedWord,
} from "../../scripts/importer/weather-binding.mjs";
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

console.log(`test-weather-tables: all ${pass} checks passed`);
