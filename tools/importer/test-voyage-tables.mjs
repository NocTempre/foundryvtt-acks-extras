/**
 * `assembleVoyageTables` — the raw RR ch. 7 reads shaped into the engine
 * tables acks-extras declares on the `voyages` document. Invented cells
 * throughout, shaped like the printed ones; no book value is reproduced.
 */
import assert from "node:assert";
import {
  assembleVoyageTables,
  parseBonus,
  parseDice,
  parseShare,
  parseSigned,
  parseTargetPlus,
} from "../../scripts/importer/voyages-binding.mjs";

let pass = 0;
const check = (label, cond) => { assert.ok(cond, label); pass++; };

/* --- parsers -------------------------------------------------------------- */
check("a signed cell parses", parseSigned("+3") === 3 && parseSigned("-1") === -1 && parseSigned("0") === 0);
check("a target reads its plus", parseTargetPlus("of 9+ (5+ if") === 9);
check("a bonus keeps its sign until the caller decides", parseBonus("gains a +6 bonus") === 6);
check("dice read from a window", parseDice("suffers 3d12  structural") === "3d12");
check("a share reads fraction or number", parseShare("1/5 damage to") === 0.2);

/* --- assembly ------------------------------------------------------------- */
const out = assembleVoyageTables({
  windStrengthRaw: {
    still: { min: 2, max: 5, sail: "×0", oar: "×1", nextDay: "-3" },
    moderate: { min: 6, max: 9, sail: "×1", oar: "×1", nextDay: "0" },
    gale: { min: 10, max: 12, sail: "×1/2", oar: "×1/2", nextDay: "+3" },
  },
  navigationRaw: {
    lakeOrRiver: { target: "3+" },
    coast: { target: "6+" },
    openSea: { target: "9+" },
  },
  voyagesProse: {
    shares: {
      sinkDice: "it will sink in 2d8",
      lightBallista: "1/5 damage to",
      heavyThird: "1/4 to vessels.",
      spells: "1/5 damage to",
      aoeDivisor: 30,
    },
    tacking: { tackRate: "×1/4 speed bu" },
    navigation: { oneArt: "receives a +3 bonus on this throw, or a +6 bonus" },
    hazardThrow: {
      captain: "of 9+ (5+ if master mariner). if the",
      halfSpeed: "or less, the captain gains a +3 bonus",
      shallowDraft: ", the captain gains +2 if navigating",
    },
    repairRounding: {
      repairCrew: "four crew members one turn to repair",
      seaHalf: "third of any damage sustained while at sea",
      roundVoyage: "5-mile interval",
      roundCombat: "20’ interval.",
    },
    hazardEffects: {
      kelpFree: "2d4 hours plus an additional hour per 50 tons the vessel",
      rockDamage: "5d10  structural",
      shoalDamage: "3d10  struct",
      refloat: "2d12 hours (jud",
      lighten: "cumulative 10% chance the ves",
      lightenStone: "150 st of cargo thrown over",
      unloadStone: "25 st of cargo per turn",
    },
  },
});

check("wind rows carry key, spread, factors and the next-day modifier",
  out.windStrength.length === 3 &&
  out.windStrength[0].key === "still" && out.windStrength[0].sail === 0 && out.windStrength[0].nextDay === -3 &&
  out.windStrength[2].sail === 0.5);
check("the last wind band opens upward", out.windStrength[2].max === null);
check("tacking reads its rate", out.tacking.multiplier === 0.25);
check("navigation carries targets and both art bonuses out of one sentence",
  out.navigation.targets.coast === 6 && out.navigation.oneArt === 3 && out.navigation.bothArts === 6);
check("the hazard throw reads captain and master from one sentence",
  out.hazardThrow.captain === 9 && out.hazardThrow.masterMariner === 5 &&
  out.hazardThrow.halfSpeed === 3 && out.hazardThrow.shallowDraft === 2);
check("each hazard assembles its own dice and rates",
  out.hazards.kelpForest.freeFormula === "2d4" && out.hazards.kelpForest.perTons === 50 &&
  out.hazards.rockReefWreck.damage === "5d10" &&
  out.hazards.sandbarShoal.damage === "3d10" && out.hazards.sandbarShoal.freeFormula === "2d12" &&
  out.hazards.sandbarShoal.escapePctPerStone === 0.1 && out.hazards.sandbarShoal.perStone === 150 &&
  out.hazards.sandbarShoal.unloadStonePerTurn === 25);
check("repair reads its crew word and sea fraction",
  out.repair.crewPerPoint === 4 && out.repair.seaFraction === 1 / 3);
check("the two rounding grains read out", out.rounding.voyageMiles === 5 && out.rounding.combatFeet === 20);
check("damage shares and the sinking die assemble",
  out.damageShares.lightBallista === 0.2 && out.damageShares.heavyThird === 0.25 &&
  out.damageShares.spells === 0.2 && out.damageShares.aoeDivisor === 30 &&
  out.damageShares.sinkDice === "2d8");
check("empty raws assemble to nothing", Object.keys(assembleVoyageTables({})).length === 0);

console.log(`test-voyage-tables: all ${pass} checks passed`);
