/**
 * `assembleTravelTables` — the raw RR page reads shaped into the engine
 * tables acks-extras declares. Invented cells throughout, shaped like the
 * printed ones; no book value is reproduced.
 */
import assert from "node:assert";
import {
  assembleExpedition,
  assembleTravelTables,
  feetPerMilePerDay,
  parseDraftSubstitutions,
  parseFigure,
  parseHours,
  parseMultiplier,
  parseRoadCell,
  PRODUCES,
  TERRAIN_GROUP_KEYS,
} from "../../scripts/importer/travel-binding.mjs";
import { parseTargetPlus, parseThrowTarget } from "../../scripts/importer/binding-parse.mjs";
import { EXPEDITION_KEYS, EXPEDITION_TABLE, TRAVEL_DOC } from "../../scripts/lib/movement-scales.mjs";
import { TABLE_RECIPES } from "../../scripts/importer/table-recipes.mjs";

let pass = 0;
const check = (label, cond) => { assert.ok(cond, label); pass++; };

/* --- the cell parsers ---------------------------------------------------- */
check("a fraction cell parses", parseMultiplier("×3/4") === 0.75);
check("a whole cell parses", parseMultiplier("×1") === 1);
check("the mark is optional", parseMultiplier("5/8") === 0.625);
check("junk is null, never zero", parseMultiplier("By creature") === null);
const road = parseRoadCell("×5/4 (×7/4 for drivers)");
check("the road cell splits its two rates", road.multiplier === 1.25 && road.drivingMultiplier === 1.75);
check("a road cell without the parens has no driver rate", parseRoadCell("×5/4").drivingMultiplier === null);
check("a throw target parses", parseTargetPlus("9+") === 9);
check("a throw without its mark is null", parseTargetPlus("9") === null);
check("a throw clause reads only after its introducing words",
  parseThrowTarget("a throw of 14+ finds it") === 14 && parseThrowTarget("14+") === null);

/* --- the assembly -------------------------------------------------------- */
const raw = {
  terrainGroups: {
    grasslandScrubland: { multiplier: "×1" },
    barrensDesertHillsForest: { multiplier: "×3/4" },
    jungleMountainSwamp: { multiplier: "×1/4" },
    road: { multiplier: "×5/4 (×7/4 for drivers)" },
    mudSnow: { multiplier: "×1/4" },
  },
  gettingLostRaw: {
    grassland: { navigation: "3+" },
    swampForested: { navigation: "16+" },
    mountains: { navigation: "" },
  },
};
const out = assembleTravelTables(raw);

check("every group fans out to its terrain keys",
  out.terrainMultipliers.grassland === 1 &&
  out.terrainMultipliers.scrubland === 1 &&
  out.terrainMultipliers.desert === 0.75 &&
  out.terrainMultipliers.mountains === 0.25 &&
  out.terrainMultipliers.snow === 0.25);
check("the fan-out map covers exactly the four grouped rows",
  Object.keys(TERRAIN_GROUP_KEYS).length === 4);
check("the road row becomes the three road kinds",
  out.roads.earth.multiplier === 1.25 && out.roads.gravel.multiplier === 1.25 && out.roads.paved.multiplier === 1.25);
check("each kind carries the driver's rate", out.roads.paved.drivingMultiplier === 1.75);
check("only the earthen road is nulled by rain (RR prose; the screen refines later)",
  out.roads.earth.ineffectiveIf.includes("raining") &&
  out.roads.gravel.ineffectiveIf.length === 0 &&
  out.roads.paved.ineffectiveIf.length === 0);
check("getting-lost targets strip their marks", out.gettingLost.grassland === 3 && out.gettingLost.swampForested === 16);
check("a row whose cell did not read is omitted, never zeroed", !("mountains" in out.gettingLost));

/* --- partial raws assemble partially -------------------------------------- */
const lostOnly = assembleTravelTables({ gettingLostRaw: { hills: { navigation: "6+" } } });
check("no terrain raw: no terrain tables invented", !("terrainMultipliers" in lostOnly) && !("roads" in lostOnly));
check("the lost half still assembles", lostOnly.gettingLost.hills === 6);
check("empty raws assemble to nothing", Object.keys(assembleTravelTables({})).length === 0);

/* --- the draft substitutions, at invented counts ------------------------- */
const subs = parseDraftSubstitutions("pulled by one or two heavy horses. one ox, four mules, or three medium horses");
check("each printed count becomes the share one animal pulls",
  subs.ox === 1 && subs.mule === 0.25 && subs.mediumHorse === 1 / 3);
check("the heavy horse is never emitted — the unit needs no import", !("heavyHorse" in subs));
check("a kind the sentence does not name is simply absent", !("donkey" in subs));
check("a sentence about nothing yields nothing", parseDraftSubstitutions("a cart is a cart") === null);
check("the assembly carries them onto the travel doc",
  assembleTravelTables({ draftSubstitutionProse: { substitutions: "one ox, two mules" } })
    .draftEquivalents.mule === 0.5);

/* --- the expedition figures, at invented cells and sentences -------------- */
check("an hours window reads a digit count", parseHours("17 hours of marching. then") === 17);
check("an hours window reads a word count", parseHours("seven hours of tramping, with") === 7);
check("the first count before 'hours' wins, past words that are not counts", parseHours("the dedicated hours: nine hours of it") === 9);
check("no hours, no figure", parseHours("a long walk") === null && parseHours("") === null && parseHours(undefined) === null);
check("a decimal or a thousands run is not the count", parseHours("v1.5 hours") === null);
check("an exploration cell parses past its mark", parseFigure("45’") === 45 && parseFigure("1.5") === 1.5);
check("a cell with no figure is null, never zero", parseFigure("-") === null && parseFigure("") === null && parseFigure("0") === null);

const grid = (n, ratio) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`row${i + 1}`, { feet: `${(i + 1) * ratio * 3}’`, miles: `${(i + 1) * 3}` }]));
check("the ratio is what every row holds between its two columns", feetPerMilePerDay(grid(12, 4)) === 4);
check("a grid that disagrees with itself gives nothing, never an average",
  feetPerMilePerDay({ ...grid(5, 4), row3: { feet: "99’", miles: "9" } }) === null);
check("one row proves nothing", feetPerMilePerDay(grid(1, 4)) === null);
check("rows that did not read are skipped, the rest still agree",
  feetPerMilePerDay({ ...grid(4, 6), row2: { __missing: true }, row3: { feet: "", miles: "" } }) === 6);
check("no grid, no ratio", feetPerMilePerDay(undefined) === null && feetPerMilePerDay({}) === null);

const expeditionRaw = {
  expeditionRows: grid(6, 7),
  expeditionProse: {
    dedicatedDay: "nine hours of tramping, with the",
    forcedDay: "14 hours of walking. those who",
    ancillaryDay: "three hours of daylight left",
    wildernessScale: 4,
  },
};
const expedition = assembleExpedition(expeditionRaw);
check("every expedition figure assembles from its own read",
  expedition.feetPerMilePerDay === 7 && expedition.dedicatedHours === 9 && expedition.forcedHours === 14
  && expedition.ancillaryHours === 3 && expedition.wildernessFactor === 4);
check("the assembly carries exactly the keys the lib reader knows", Object.keys(expedition).sort().join() === [...EXPEDITION_KEYS].sort().join());
check("a pace's multiplier is not stored: it is derived from the hours", !("forcedMultiplier" in expedition) && !("multiplier" in expedition));
check("the assembly lands on the travel doc's expedition table", assembleTravelTables(expeditionRaw)[EXPEDITION_TABLE] != null && TRAVEL_DOC === "travel");
check("the table is declared as produced from both raw reads", PRODUCES.travel[EXPEDITION_TABLE].join() === "expeditionRows,expeditionProse");
check("a window that drifted costs its figure and nothing beside it",
  (() => {
    const e = assembleExpedition({ ...expeditionRaw, expeditionProse: { ...expeditionRaw.expeditionProse, forcedDay: "a long march" } });
    return !("forcedHours" in e) && e.dedicatedHours === 9 && e.feetPerMilePerDay === 7 && e.wildernessFactor === 4;
  })());
check("a wilderness scale that is not a positive number is dropped",
  !("wildernessFactor" in assembleExpedition({ expeditionProse: { wildernessScale: 0 } }))
  && !("wildernessFactor" in assembleExpedition({ expeditionProse: { wildernessScale: "x" } })));
check("nothing read assembles no expedition table", !(EXPEDITION_TABLE in assembleTravelTables({})));

/* --- the recipes ---------------------------------------------------------- */
const rows = TABLE_RECIPES.travel.tables.expeditionRows;
const prose = TABLE_RECIPES.travel.tables.expeditionProse;
check("the grid's rows are claimed by position, so no printed speed sits in source",
  rows.rows.length === 12 && rows.rows.every((r) => r.unlabelled === true && !("labelRe" in r)));
check("the grid names its page and the prose its own", rows.printedPage === prose.printedPage && TABLE_RECIPES.travel.source.pages.includes("272"));
check("every prose window is an anchor with no figure in it", prose.values.every((v) => !/\d/.test(v.find)));

console.log(`test-travel-tables: all ${pass} checks passed`);
