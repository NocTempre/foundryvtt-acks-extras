/**
 * Living off the country.
 *
 * Every target, bonus and yield below is INVENTED. What this pins is the
 * structure: water is a PARTY throw and the other two are not, standing water
 * skips the throw rather than easing it, a dog pack helps itself to a cap, and
 * an unimported yield is unknown rather than zero.
 */
import assert from "node:assert/strict";
import { registerTable, unregisterTable, PRIORITY } from "../scripts/lib/tables.mjs";
import {
  FORAGING_DOC, FORAGE_KINDS, forageSpec, partyThrows, huntSpec, dogPack,
  forageYield, grazingSpec, foragingReady,
} from "../scripts/formation/foraging.mjs";

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok   " + name); };

const SAMPLE = {
  id: FORAGING_DOC,
  source: "invented",
  tables: {
    targets: {
      firewood: { forest: 4, any: 15 },
      water: { desert: 19, any: 13 },
      food: { any: 17 },
    },
    survivalBonus: 3,
    partyGroupSize: 20,
    huntTarget: 16,
    huntTerritory: { civilized: -5, borderlands: 0, outlands: 3, unsettled: 6 },
    dogTarget: 18, dogHelpPerDog: 1, dogHelpCap: 4,
    yields: {
      firewood: { amount: 8, unit: "stone" },
      water: { amount: 2, feeds: 1, unit: "days" },
      food: { amount: 0.5, feeds: 4, unit: "stone" },
    },
    barrenTerrains: ["barrens", "desert"],
    efficientGrazers: ["donkey", "steppeHorse"],
  },
};
const load = () => registerTable(SAMPLE, { priority: PRIORITY.WORLD, source: "test" });

ok("the kinds differ in WHO throws, which is the structural point", () => {
  assert.deepEqual(Object.keys(FORAGE_KINDS), ["firewood", "water", "food"]);
  assert.equal(FORAGE_KINDS.water.perParty, true, "one throw for the order");
  assert.equal(FORAGE_KINDS.food.perParty, false, "one throw each");
  assert.equal(FORAGE_KINDS.firewood.daily, false, "firewood may be tried as often as wanted");
  for (const spec of Object.values(FORAGE_KINDS)) {
    assert.equal("target" in spec, false, "a kind must not ship a target");
  }
});

ok("an unimported forage cannot be attempted and says which table is missing", () => {
  unregisterTable(FORAGING_DOC);
  assert.equal(foragingReady(), false);
  const r = forageSpec({ kind: "food", terrain: "forest" });
  assert.equal(r.ok, false);
  assert.equal(r.missing, "targets");
  assert.equal(huntSpec({}).missing, "huntTarget");
  assert.equal(forageYield("food"), null, "an unpriced yield is unknown, not zero");
});

ok("a target falls back from the terrain to the general case", () => {
  unregisterTable(FORAGING_DOC); load();
  assert.equal(forageSpec({ kind: "firewood", terrain: "forest" }).target, 4, "the named terrain wins");
  assert.equal(forageSpec({ kind: "firewood", terrain: "swamp" }).target, 15, "anywhere else takes `any`");
  assert.equal(forageSpec({ kind: "food", terrain: "jungle" }).target, 17, "food has only the general case");
});

ok("standing water SKIPS the throw rather than easing it", () => {
  unregisterTable(FORAGING_DOC); load();
  const r = forageSpec({ kind: "water", terrain: "desert", standingWater: true });
  assert.equal(r.automatic, true);
  assert.equal(r.target, undefined, "there is no throw to make");
  // Without it, the desert is its own harder target.
  assert.equal(forageSpec({ kind: "water", terrain: "desert" }).target, 19);
  assert.equal(forageSpec({ kind: "water", terrain: "hills" }).target, 13);
});

ok("Survival helps, and only when someone has it", () => {
  unregisterTable(FORAGING_DOC); load();
  assert.equal(forageSpec({ kind: "food", terrain: "any" }).bonus, 0);
  assert.equal(forageSpec({ kind: "food", terrain: "any", survival: true }).bonus, 3);
});

ok("a big order throws again for each further group", () => {
  unregisterTable(FORAGING_DOC); load();
  assert.equal(partyThrows(1), 1);
  assert.equal(partyThrows(20), 1, "exactly a group is one throw");
  assert.equal(partyThrows(21), 2, "one over needs a second");
  assert.equal(partyThrows(60), 3);
  unregisterTable(FORAGING_DOC);
  assert.equal(partyThrows(60), 1, "no cap imported, one throw — never an invented number");
});

ok("settled country makes game scarce, and wild country plentiful", () => {
  unregisterTable(FORAGING_DOC); load();
  assert.equal(huntSpec({ territory: "civilized" }).bonus, -5, "scarce where people are");
  assert.equal(huntSpec({ territory: "borderlands" }).bonus, 0);
  assert.equal(huntSpec({ territory: "unsettled" }).bonus, 6);
  assert.equal(huntSpec({ territory: "nowhere" }).bonus, 0, "an unknown territory is neutral, not a throw");
});

ok("a dog pack helps itself, to a cap", () => {
  unregisterTable(FORAGING_DOC); load();
  assert.equal(dogPack(0), null, "no dogs, no pack");
  assert.equal(dogPack(1).bonus, 0, "a lone dog helps nobody");
  assert.equal(dogPack(1).throws, 1);
  assert.equal(dogPack(3).bonus, 2, "each other dog helps");
  assert.equal(dogPack(6).throws, 6, "and every dog still throws");
  assert.equal(dogPack(9).bonus, 4, "the cap holds — a kennel is not an autowin");
});

ok("a yield carries how far it goes, not just how much it is", () => {
  unregisterTable(FORAGING_DOC); load();
  const food = forageYield("food");
  assert.equal(food.amount, 0.5);
  assert.equal(food.feeds, 4, "one forager's success feeds several mouths");
  assert.equal(forageYield("firewood").feeds, null, "firewood feeds nobody");
});

ok("barren country feeds only what already lives there", () => {
  unregisterTable(FORAGING_DOC); load();
  assert.equal(grazingSpec({ kind: "mule", terrain: "desert" }).canGraze, false);
  assert.equal(grazingSpec({ kind: "mule", terrain: "desert" }).reason, "barren");
  assert.equal(grazingSpec({ kind: "camel", terrain: "desert", native: true }).canGraze, true);
  assert.equal(grazingSpec({ kind: "mule", terrain: "grassland" }).canGraze, true);
});

ok("some kinds graze on their spare hours and so can still travel", () => {
  unregisterTable(FORAGING_DOC); load();
  const mule = grazingSpec({ kind: "mule", terrain: "grassland" });
  assert.equal(mule.costsDay, true, "an ordinary animal spends the day eating");
  const donkey = grazingSpec({ kind: "donkey", terrain: "grassland" });
  assert.equal(donkey.onAncillary, true);
  assert.equal(donkey.costsDay, false, "which is why a donkey train still covers ground");
  unregisterTable(FORAGING_DOC);
});

console.log("\ntest-foraging: all " + passed + " checks passed");
