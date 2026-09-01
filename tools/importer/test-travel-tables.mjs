/**
 * `assembleTravelTables` — the raw RR page reads shaped into the engine
 * tables acks-extras declares. Invented cells throughout, shaped like the
 * printed ones; no book value is reproduced.
 */
import assert from "node:assert";
import {
  assembleTravelTables,
  parseDraftSubstitutions,
  parseMultiplier,
  parseRoadCell,
  parseThrow,
  TERRAIN_GROUP_KEYS,
} from "../../scripts/importer/travel-binding.mjs";

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
check("a throw target parses", parseThrow("9+") === 9);
check("a throw without its mark is null", parseThrow("9") === null);

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

console.log(`test-travel-tables: all ${pass} checks passed`);
