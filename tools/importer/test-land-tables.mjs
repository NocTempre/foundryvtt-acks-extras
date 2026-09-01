/**
 * The five land-travel binders — survival, foraging, searching, city travel
 * and flight — shaped into the engine tables acks-extras declares.
 *
 * Every figure and every sentence below is INVENTED. The prose is shaped like
 * the printed prose (that is the whole point: these are sentence readers), but
 * no printed duration, target, penalty, yield or rate is reproduced. Where a
 * real page says one thing, the fixture here deliberately says another — a
 * test that happened to carry the true numbers would be the book with
 * different punctuation.
 *
 * What this pins is the READING: that a count spelled out in words is found,
 * that an article before it does not defeat the match, that a die is carried
 * as a die and a flat figure as a number, that a reduction becomes the factor
 * it leaves, that a comma-separated terrain list survives, and that an
 * unbounded top row stays unbounded.
 */
import assert from "node:assert";
import {
  parseCount, countFrom, parseToll, parseShare, parseHours,
  assembleFood, assembleWater, assembleExposure, assembleHeat,
  assembleSimplified, assembleSurvivalTables,
} from "../../scripts/importer/survival-binding.mjs";
import {
  parseTargetClauses, targetsFromClauses, parseModifierClauses, parseYield,
  parseKindList, assembleForagingTables,
} from "../../scripts/importer/foraging-binding.mjs";
import {
  parseTurns, parseTerrainList, assembleLadder, assembleSearchingTables,
} from "../../scripts/importer/searching-binding.mjs";
import {
  parseBlocks, parseStragglingTiers, parseCadenceTurns, assembleCadence,
  assembleCityTravelTables,
} from "../../scripts/importer/city-travel-binding.mjs";
import { parseFactor, parseHeavyLoadFactor, assembleFlightTables } from "../../scripts/importer/flight-binding.mjs";
import { terrainKey, terrainKeys, keyTerrainMap } from "../../scripts/importer/terrain-vocab.mjs";

let pass = 0;
const check = (label, cond) => { assert.ok(cond, label); pass++; };

/* --- counts, the reader everything else stands on ------------------------ */
check("a digit is a count", parseCount("7") === 7);
check("a word is a count", parseCount("eleven") === 11);
check("a single is one", parseCount("single") === 1);
check("junk is not a count", parseCount("thereabouts") === null);
check("nothing is not zero", parseCount("") === null && parseCount(null) === null);

check(
  "an article before the count does not defeat the match",
  countFrom("after a single day without any water, wombats wilt", /after\s+(\S+)\s*(\S+)?\s*days?\s+without\s+any\s+water/) === 1,
);
check(
  "and a plain count still reads",
  countFrom("after nine days without any water", /after\s+(\S+)\s*(\S+)?\s*days?\s+without\s+any\s+water/) === 9,
);

/* --- tolls keep their shape ---------------------------------------------- */
check("a flat toll is a number", parseToll("loses 3 con each day", /loses\s+(\d+\s*d?\s*\d*)\s*con\s+each\s+day/) === 3);
check("a rolled toll is a die", parseToll("loses 2d4 con each day", /loses\s+(\d+\s*d?\s*\d*)\s*con\s+each\s+day/) === "2d4");
check("an absent toll is null", parseToll("feels poorly", /loses\s+(\d+)\s*con/) === null);

/* --- shares and hours ---------------------------------------------------- */
check("a percentage is a share", parseShare("increased by 40%", /increased\s+by\s+([\d.]+\s*%)/) === 0.4);
check("hours are hours", parseHours("more than nine hours, or if he gets wet") === 9);
check("turns become hours", parseHours("more than twelve turns, or if he gets wet") === 2);
check("hours win over turns where both appear", parseHours("more than three hours (18 turns)") === 3);

/* --- the survival ladders ------------------------------------------------ */
const STARVATION = "after four days with less than full rations, wanderers become hungry. a hungry "
  + "wanderer suffers a -3 penalty on attack throws. after seven consecutive days without any food, "
  + "or nine consecutive days with an average of half rations, wanderers also becomes underfed. "
  + "after eleven days of being underfed with no food, or twelve days being underfed with an average "
  + "of half rations, a wanderer becomes starving. a starving wanderer loses 2 con each day "
  + "thereafter. lost con returns at a rate of 3 points each day.";

const food = assembleFood(STARVATION);
check("the hunger rungs are all read", food.hungryAfter === 4 && food.underfedNoFood === 7
  && food.underfedShort === 9 && food.starvingNoFood === 11 && food.starvingShort === 12);
check("hunger's toll is flat and its recovery separate", food.conPerDay === 2 && food.recoverPerDay === 3);
check("an empty paragraph yields nothing at all", assembleFood("") === null);

const DEHYDRATION = "after a single day without any water, or six days with less than half the "
  + "required water ration, or eight consecutive days with less than a full ration, wanderers "
  + "become dehydrated. a dehydrated wanderer loses 3d8 con each day thereafter. lost con returns "
  + "at a rate of 5 points each day.";

const water = assembleWater(DEHYDRATION);
check("all THREE printed onsets are carried, not the two the engine reads",
  water.dehydratedNoWater === 1 && water.dehydratedBelowHalf === 6 && water.dehydratedShort === 8);
check("thirst's toll stays a die", water.conPerDay === "3d8");
check("and its recovery is a plain number", water.recoverPerDay === 5);

const exposure = assembleExposure({
  frigid: "nine turns, or if he gets wet, he becomes hypothermic. a hypothermic wanderer loses 4d4 con each hour.",
  cold: "(30 turns), or if he gets wet, he becomes hypothermic.",
});
check("each band's clock is normalized to hours", exposure.hoursUnprotected.frigid === 1.5
  && exposure.hoursUnprotected.cold === 5);
check("the cold's toll is a die too", exposure.conPerHour === "4d4");

const heat = assembleHeat("sweltering temperatures are 200 ° f and higher. a wanderer wearing nine "
  + "stone or more of armor must make a death saving throw each hour. a wanderer's required water "
  + "ration is increased by 40%. if he becomes dehydrated, he loses 6d8 con each day rather than 2d8.");
check("the heat band names itself", Object.keys(heat)[0] === "sweltering");
check("its armour threshold reads", heat.sweltering.armourStone === 9);
check("its water need is a multiplier, not a percentage", heat.sweltering.waterNeed === 1.4);
check("its worse drain is a RATIO of the ordinary one", heat.sweltering.dehydrationDrain === 3);

// A ratio between unlike dice is not a ratio. The row still assembles from
// what else it holds; only the figure that could not be computed is absent.
const mismatched = assembleHeat(
  "sweltering. a wanderer wearing nine stone or more of armor must throw. he loses 6d8 con each day rather than 2d6.",
);
check("an unreadable drain leaves the rest of the row intact", mismatched.sweltering.armourStone === 9);
check("and the ratio between unlike dice is refused rather than guessed",
  mismatched.sweltering.dehydrationDrain === undefined);
check("a paragraph with nothing readable is null, not an empty row",
  assembleHeat("the weather is pleasant and nothing happens") === null);

const simplified = assembleSimplified({
  carry: "each wanderer to last one-half its expected travel time and carries enough water for each "
    + "wanderer and animal to last for nine days, the party can feel safe.",
});
check("the provisioning shortcut reads both halves",
  simplified.foodShareOfTrip === 0.5 && simplified.waterDays === 9);
check("and the confidence that makes it a shortcut rather than a rule",
  assembleSimplified({ carry: "to last for nine days, the party can feel safe from starvation and dehydration 70% of the time." }).confidence === 0.7);
check("an absent confidence is absent, not assumed certain",
  assembleSimplified({ carry: "to last for nine days, the party can feel safe." }).confidence === undefined);

const survivalAll = assembleSurvivalTables({
  starvationProse: { paragraph: STARVATION },
  dehydrationProse: { paragraph: DEHYDRATION },
});
check("each table assembles independently of the others",
  Object.keys(survivalAll).sort().join(",") === "food,water");

/* --- foraging: clause lists that punctuation would otherwise cut ---------- */
const clauses = parseTargetClauses(
  "the target value is 9+ in clear, forest, hills, jungle, mountains, or swamp terrain, or 21+ in barrens or desert. if the throw",
);
check("a comma-separated terrain list survives whole", clauses[0].terrains.length === 6);
check("and the second clause is its own", clauses[1].target === 21 && clauses[1].terrains.length === 2);

const woodTargets = targetsFromClauses("the target value is 2+ in forest terrain and 13+ in other terrain.");
check("an 'other terrain' clause becomes the fallback", woodTargets.forest === 2 && woodTargets.any === 13);

const mods = parseModifierClauses(
  "wanderers suffer a -7 penalty to their hunting proficiency throws in civilized territory, but "
  + "gain a +3 bonus in outlands territory, and +6 in unsettled territory.",
  "territory",
);
check("a modifier clause list reads across a long run-in",
  mods.civilized === -7 && mods.outlands === 3 && mods.unsettled === 6);

const y = parseYield("gathers 1/4 stone of food, enough for eleven man-sized creatures");
check("a fractional yield and who it feeds", y.amount === 0.25 && y.feeds === 11 && y.unit === "stone");

const kinds = parseKindList(". wombats and steppe llamas can graze for their full day's rations",
  /^(.+?)\s+can\s+graze\s+for\s+their\s+full/i);
check("a list drops a leading fragment and keeps both word forms",
  kinds.includes("wombats") && kinds.includes("wombat") && kinds.includes("steppe llama"));

const forage = assembleForagingTables({
  dogsProse: { pack: "a hunting proficiency throw of 23+. the dog gets a +2 bonus to the throw per dog that hunts with it, to a maximum bonus of +9." },
});
check("the dog pack's three figures are all distinct readings",
  forage.dogTarget === 23 && forage.dogHelpPerDog === 2 && forage.dogHelpCap === 9);

/* --- searching ----------------------------------------------------------- */
check("a parenthesised turn count wins over its round description",
  parseTurns("each hour (nine turns) that the party spends searching") === 9);
check("a bare per-turns cadence reads", parseTurns("one searching throw per four turns") === 4);

const closed = parseTerrainList("however, when searching forest, jungle, or swamp terrain, they suffer");
check("the canopy terrains are three, not one", closed.length === 3 && closed[0] === "forest");

const ladder = assembleLadder({
  b01: { target: "21+", min: 0, max: 9 },
  b03: { target: "19+", min: 20, max: null },
  b02: { target: "20+", min: 10, max: 19 },
});
check("the ladder is sorted by its lower bound", ladder.map((r) => r.min).join(",") === "0,10,20");
check("the OPEN top row stays open — a finite test would make it end at zero",
  ladder[2].max === null);
check("a row missing its target is dropped, not defaulted",
  assembleLadder({ b01: { target: "", min: 0, max: 9 } }) === null);

const searching = assembleSearchingTables({
  searchProse: {
    specific: "a -6 penalty on the throw.",
    cadence: "clear, grass terrain, they receive one searching throw per four turns (forty minutes)",
    canopy: ", when searching forest, jungle, or swamp terrain, they suffer -11 penalty",
  },
  cadenceProse: { hour: ": each hour (nine turns) that the party spends searching" },
  lostSearchProse: { moving: "there is a -5 penalty to the throw to find it" },
  surveyProse: { target: "is 23+, but the surveyor receives a cumulative +7 bonus for each successful search" },
});
check("the two cadences are kept apart",
  searching.turnsPerThrow === 9 && searching.aerialTurnsPerThrow === 4);
check("the penalties keep their signs", searching.specificTarget === -6
  && searching.movingQuarry === -5 && searching.canopyPenalty === -11);
check("the survey reads its target and its per-search bonus",
  searching.surveyTarget === 23 && searching.surveyPerSearch === 7);

/* --- city travel --------------------------------------------------------- */
check("blocks are counted from words", parseBlocks("about ten minutes to walk nine city blocks") === 9);
check("and a single block is one", parseBlocks("to walk one city block") === 1);

const tiers = parseStragglingTiers(
  "9 or more characters, commuting speed is reduced by 20%. if the party is 21 or more characters, "
  + "commuting speed is reduced by 60%.",
);
check("a REDUCTION becomes the factor it leaves",
  tiers[0].from === 9 && tiers[0].multiplier === 0.8
  && tiers[1].from === 21 && Math.abs(tiers[1].multiplier - 0.4) < 1e-9);
check("the tiers are ordered by headcount", tiers[0].from < tiers[1].from);
check("a total reduction is refused rather than made a zero factor",
  parseStragglingTiers("9 or more characters, speed is reduced by 100%.") === null);

check("a cadence in hours becomes turns", parseCadenceTurns("every day (12 hours)") === 72);
check("a cadence in turns is already turns", parseCadenceTurns("every hour (9 turns)") === 9);

const cadence = assembleCadence({
  avenueDay: { frequency: "every hour (9 turns)", throw: "8+" },
  avenueNight: { frequency: "every 30 minutes (4 turns)", throw: "7+" },
  holedUp: { frequency: "every day (12 hours)", throw: "4+" },
  alleyDay: { __missing: true },
});
check("day and night file under one place", cadence.avenue.day.everyTurns === 9
  && cadence.avenue.night.everyTurns === 4);
check("a timeless row files under 'any'", cadence.holedUp.any.throw === 4);
check("a missing row is skipped, not invented", cadence.alley === undefined);

const city = assembleCityTravelTables({
  pacesProse: {
    commuting: "about ten minutes to walk nine city blocks. characters must make a navigation throw of 13+ every turn.",
    meandering: "about ten minutes to walk one city block.",
    navigation: "of 13+ every turn. if the characters have traveled to the destination before, add +6 to the throw.",
    stray: "2d6+3 blocks away from their intended destination that turn.",
  },
});
check("the paces, the target, the modifier and the stray all read",
  city.paces.commuting.blocksPerTurn === 9 && city.paces.meandering.blocksPerTurn === 1
  && city.navigation.target === 13 && city.navigation.knownDestination === 6
  && city.navigation.strayBlocks === "2d6+3");

/* --- one terrain vocabulary ----------------------------------------------
   The book names the same country differently table to table. These are NAMES,
   not values: what a terrain is worth still comes off the page. */
check("the movement table's name is the engine's key", terrainKey("clear") === "grassland");
check("and a name it already uses is left alone", terrainKey("swamp") === "swamp");
check("an unknown name passes through rather than vanishing", terrainKey("aetherium") === "aetherium");

const both = terrainKeys(["clear", "scrub", "barren", "swamp"]);
check("a list keeps the printed spelling AND the engine's",
  both.includes("clear") && both.includes("grassland")
  && both.includes("scrub") && both.includes("scrubland")
  && both.includes("barren") && both.includes("barrens"));
check("and does not duplicate a name that needed no alias",
  both.filter((t) => t === "swamp").length === 1);

const mapped = keyTerrainMap({ clear: 14, swamp: 14 });
check("a target map carries a row under both names",
  mapped.clear === 14 && mapped.grassland === 14 && mapped.swamp === 14);
check("a non-object map is returned untouched", keyTerrainMap(null) === null);

/* --- flight -------------------------------------------------------------- */
check("a factor written as a word", parseFactor("its expedition speed is doubled") === 2);
check("halving reads as a factor", parseFactor("conditions also halve flight speed") === 0.5);
check(
  "the WORD beats a numeral that is only an example",
  parseFactor("doubled. for instance, a creature with a speed of 120 would have 48 miles") === 2,
);
check("no factor at all is null", parseFactor("flies about as you would expect") === null);

check(
  "the heavy-load factor is read from AFTER the comma, not the full speed before it",
  parseHeavyLoadFactor("full speed when carrying their normal load or less, and at half speed when carrying up to their maximum load") === 0.5,
);

const flight = assembleFlightTables({
  airProse: { aloft: "its expedition speed is tripled.", wind: "halve flight speed for all purposes" },
  loadProse: { heavy: "full speed when carrying their normal load, and at quarter speed when carrying up to their maximum load" },
});
check("the three flight factors assemble", flight.aloftFactor === 3
  && flight.windFactor === 0.5 && flight.loadFactors.heavy === 0.25);
check("the fallback sentence carries the aloft factor when the first is empty",
  assembleFlightTables({ airProse: { partial: "only the portion spent in the air is doubled" } }).aloftFactor === 2);

/* --- absent input is absent output, never a guess ------------------------ */
for (const [name, fn] of [
  ["survival", assembleSurvivalTables], ["foraging", assembleForagingTables],
  ["searching", assembleSearchingTables], ["cityTravel", assembleCityTravelTables],
  ["flight", assembleFlightTables],
]) {
  check(`${name} assembles nothing from nothing`, Object.keys(fn({})).length === 0);
  check(`${name} survives an undefined raw`, Object.keys(fn()).length === 0);
}

console.log(`test-land-tables: ${pass} checks passed`);
