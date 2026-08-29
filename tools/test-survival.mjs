/**
 * Hunger and thirst, a day at a time.
 *
 * Every threshold below is INVENTED — the real durations, drains and recovery
 * rates are printed and arrive through acks-importer. What this pins is the
 * ladder: its rungs and their order, that a full meal steps a starving body
 * DOWN rather than clearing it, that the clocks never walk a body backwards on
 * short commons, and that an unimported subsystem does nothing rather than
 * starving anyone on invented timing.
 */
import assert from "node:assert/strict";
import { registerTable, unregisterTable, PRIORITY } from "../scripts/lib/tables.mjs";
import {
  SURVIVAL_DOC, NOURISHMENT, HYDRATION, EXPOSURE, RATION_LEVELS,
  freshSurvival, survivalOf, forbidden, draining,
  hungerRung, thirstRung, advanceSurvival, survivalReady,
  exposureRung, advanceExposureHour, heatBurden, animalNeeds, simplifiedSupply,
} from "../scripts/lib/survival.mjs";

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok   " + name); };

const SAMPLE = {
  id: SURVIVAL_DOC,
  source: "invented",
  tables: {
    food: {
      hungryAfter: 1, underfedNoFood: 3, underfedShort: 6,
      starvingNoFood: 7, starvingShort: 12,
      conPerDay: 1, recoverPerDay: 1,
    },
    water: { dehydratedNoWater: 2, dehydratedShort: 4, conPerDay: 2, recoverPerDay: 3 },
    exposure: { hoursUnprotected: { frigid: 1, cold: 4 }, conPerHour: 2 },
    heat: { sweltering: { waterNeed: 1.25, dehydrationDrain: 2, armourStone: 5 } },
  },
};
const load = () => registerTable(SAMPLE, { priority: PRIORITY.WORLD, source: "test" });
const run = (days, meal) => {
  let s = freshSurvival();
  for (let i = 0; i < days; i++) s = advanceSurvival(s, meal).state;
  return s;
};

ok("the ladders are structural, ordered, and carry no durations", () => {
  assert.deepEqual(Object.keys(NOURISHMENT), ["fed", "hungry", "underfed", "starving"]);
  assert.deepEqual(Object.keys(HYDRATION), ["watered", "dehydrated"]);
  assert.deepEqual(RATION_LEVELS, ["full", "half", "none"]);
  let last = -1;
  for (const rung of Object.values(NOURISHMENT)) {
    assert.ok(rung.rung > last, "rungs ascend");
    last = rung.rung;
    assert.equal("days" in rung, false, "a rung must not ship a duration");
  }
  // Only the bottom rungs drain; hunger's first two do not.
  assert.equal(NOURISHMENT.hungry.drains, undefined);
  assert.equal(NOURISHMENT.starving.drains, true);
  assert.equal(HYDRATION.dehydrated.drains, true);
});

ok("an unimported subsystem starves nobody", () => {
  unregisterTable(SURVIVAL_DOC);
  assert.equal(survivalReady(), false);
  const s = run(30, { food: "none", water: "none" });
  assert.equal(s.nourishment, "fed", "no thresholds, no ladder");
  assert.equal(s.hydration, "watered");
  assert.equal(s.conLost, 0);
  // The clocks still run, so importing later starts from the truth.
  assert.equal(s.noFoodRun, 30);
});

ok("short commons bite first, and going without climbs faster", () => {
  unregisterTable(SURVIVAL_DOC); load();
  assert.equal(run(1, { food: "half" }).nourishment, "hungry");
  assert.equal(run(3, { food: "none" }).nourishment, "underfed");
  assert.equal(run(6, { food: "half" }).nourishment, "underfed", "the slow road reaches the same rung");
  assert.equal(run(7, { food: "none" }).nourishment, "starving");
});

ok("thirst has one rung and arrives fast", () => {
  unregisterTable(SURVIVAL_DOC); load();
  assert.equal(run(1, { water: "none" }).hydration, "watered");
  assert.equal(run(2, { water: "none" }).hydration, "dehydrated");
  assert.equal(run(4, { water: "half" }).hydration, "dehydrated");
  assert.equal(thirstRung({ noWaterRun: 9 }), "dehydrated");
});

ok("a full meal steps a STARVING body down, not clear", () => {
  unregisterTable(SURVIVAL_DOC); load();
  let s = run(7, { food: "none" });
  assert.equal(s.nourishment, "starving");
  s = advanceSurvival(s, { food: "full" }).state;
  assert.equal(s.nourishment, "underfed", "rescue is not recovery");
  s = advanceSurvival(s, { food: "full" }).state;
  assert.equal(s.nourishment, "fed", "the next full day finishes it");
});

ok("a full day's water ends dehydration outright", () => {
  unregisterTable(SURVIVAL_DOC); load();
  let s = run(3, { water: "none" });
  assert.equal(s.hydration, "dehydrated");
  s = advanceSurvival(s, { water: "full" }).state;
  assert.equal(s.hydration, "watered", "one rung, so one step clears it");
});

ok("the clocks never walk a body backwards on short commons", () => {
  unregisterTable(SURVIVAL_DOC); load();
  let s = run(7, { food: "none" });
  assert.equal(s.nourishment, "starving");
  // Half rations reset the no-food run, which would re-derive a LOWER rung.
  s = advanceSurvival(s, { food: "half" }).state;
  assert.equal(s.nourishment, "starving", "still starving — half a meal is not a meal");
});

ok("starving costs Constitution each day, and it is owed back", () => {
  unregisterTable(SURVIVAL_DOC); load();
  let s = run(7, { food: "none" });
  const drained = advanceSurvival(s, { food: "none" });
  assert.equal(drained.drain, 1);
  assert.equal(drained.state.conLost, s.conLost + 1);
  // Both ladders at once drain together.
  let both = run(7, { food: "none", water: "none" });
  const cost = advanceSurvival(both, { food: "none", water: "none" });
  assert.equal(cost.drain, 1 + 2, "hunger and thirst each take their own");
});

ok("Constitution returns only once nothing is draining", () => {
  unregisterTable(SURVIVAL_DOC); load();
  let s = run(9, { food: "none" });
  assert.ok(s.conLost > 0);
  const owed = s.conLost;
  const fed = advanceSurvival(s, { food: "full", water: "full" });
  assert.equal(fed.drain, 0);
  assert.equal(fed.recovered, Math.min(owed, 1 + 3), "both rations pay their own rate");
  assert.ok(fed.state.conLost < owed);
});

ok("what a rung forbids is reported from both ladders at once", () => {
  unregisterTable(SURVIVAL_DOC); load();
  assert.deepEqual(forbidden(freshSurvival()), []);
  assert.deepEqual(forbidden({ nourishment: "hungry" }), ["throws"]);
  const both = { nourishment: "starving", hydration: "dehydrated" };
  assert.deepEqual(forbidden(both).sort(), ["forceMarch", "naturalHealing"], "deduped across ladders");
  assert.equal(draining(both), true);
  assert.equal(draining({ nourishment: "hungry" }), false);
});

ok("a junk record normalizes rather than throwing", () => {
  const s = survivalOf({ nourishment: "peckish", hydration: "damp", noFoodRun: -4, conLost: "x" });
  assert.equal(s.nourishment, "fed");
  assert.equal(s.hydration, "watered");
  assert.equal(s.noFoodRun, 0);
  assert.equal(s.conLost, 0);
});

ok("advancing reports what changed, so a caller need not diff", () => {
  unregisterTable(SURVIVAL_DOC); load();
  const first = advanceSurvival(freshSurvival(), { food: "half" });
  assert.equal(first.worsened, true);
  assert.equal(first.eased, false);
  const back = advanceSurvival(first.state, { food: "full" });
  assert.equal(back.eased, true);
  assert.equal(back.worsened, false);
  unregisterTable(SURVIVAL_DOC);
});

/* --- the cold: a condition that ticks by the hour ------------------------- */
ok("the exposure ladder is structural and carries no hours", () => {
  assert.deepEqual(Object.keys(EXPOSURE), ["sheltered", "hypothermic"]);
  assert.equal(EXPOSURE.hypothermic.drains, true);
  assert.equal("hours" in EXPOSURE.hypothermic, false, "a rung must not ship a duration");
});

ok("a colder band gives you less time before it bites", () => {
  unregisterTable(SURVIVAL_DOC); load();
  assert.equal(exposureRung({ band: "frigid", hoursUnprotected: 1 }), "hypothermic");
  assert.equal(exposureRung({ band: "cold", hoursUnprotected: 1 }), "sheltered", "cold is slower");
  assert.equal(exposureRung({ band: "cold", hoursUnprotected: 4 }), "hypothermic");
  assert.equal(exposureRung({ band: "moderate", hoursUnprotected: 99 }), "sheltered",
    "a band the table does not name does not bite");
});

ok("getting WET needs no clock at all", () => {
  unregisterTable(SURVIVAL_DOC); load();
  assert.equal(exposureRung({ band: "cold", wet: true, hoursUnprotected: 0 }), "hypothermic");
  assert.equal(exposureRung({ band: "cold", wet: true, protectedFrom: true }), "hypothermic",
    "however well dressed — a soaked body is soaked");
});

ok("protection stops the clock, and immunity skips it entirely", () => {
  unregisterTable(SURVIVAL_DOC); load();
  assert.equal(exposureRung({ band: "frigid", protectedFrom: true, hoursUnprotected: 99 }), "sheltered");
  assert.equal(exposureRung({ band: "frigid", wet: true, immune: true }), "sheltered");
});

ok("an hour in the frigid takes hold, drains, and owes a save", () => {
  unregisterTable(SURVIVAL_DOC); load();
  const step = advanceExposureHour(freshSurvival(), { band: "frigid" });
  assert.equal(step.state.exposure, "hypothermic");
  assert.equal(step.drain, 2);
  assert.equal(step.owesDeathSave, true);
  assert.equal(step.worsened, true);
});

ok("the cold never loosens without a fire", () => {
  unregisterTable(SURVIVAL_DOC); load();
  let s = advanceExposureHour(freshSurvival(), { band: "frigid" }).state;
  // Putting a coat on does not thaw you.
  s = advanceExposureHour(s, { band: "frigid", protectedFrom: true }).state;
  assert.equal(s.exposure, "hypothermic", "still hypothermic");
  const warm = advanceExposureHour(s, { band: "frigid", atHeatSource: true });
  assert.equal(warm.state.exposure, "sheltered", "a fire ends it");
  assert.equal(warm.state.hoursUnprotected, 0, "and resets the clock");
  assert.equal(warm.drain, 0);
});

ok("hypothermia forbids and drains alongside the other ladders", () => {
  unregisterTable(SURVIVAL_DOC); load();
  const cold = { ...freshSurvival(), exposure: "hypothermic" };
  assert.deepEqual(forbidden(cold).sort(), ["forceMarch", "naturalHealing"]);
  assert.equal(draining(cold), true);
});

/* --- the heat: modifiers, not a condition --------------------------------- */
ok("heat asks for more water and punishes thirst harder", () => {
  unregisterTable(SURVIVAL_DOC); load();
  const hot = heatBurden({ band: "sweltering" });
  assert.equal(hot.waterNeed, 1.25);
  assert.equal(hot.dehydrationDrain, 2, "a thirsty body in the heat dies faster");
  const mild = heatBurden({ band: "moderate" });
  assert.equal(mild.waterNeed, 1, "moderate weather asks nothing extra");
  assert.equal(mild.dehydrationDrain, 1);
});

ok("heavy armour in the heat owes a saving throw; light armour does not", () => {
  unregisterTable(SURVIVAL_DOC); load();
  assert.equal(heatBurden({ band: "sweltering", armourStone: 6 }).armourSave, true);
  assert.equal(heatBurden({ band: "sweltering", armourStone: 5 }).armourSave, true, "at the line");
  assert.equal(heatBurden({ band: "sweltering", armourStone: 4 }).armourSave, false,
    "shedding a piece is the way out, and it works");
});

ok("immunity to fire skips the heat entirely", () => {
  unregisterTable(SURVIVAL_DOC); load();
  const immune = heatBurden({ band: "sweltering", armourStone: 9, immune: true });
  assert.equal(immune.waterNeed, 1);
  assert.equal(immune.armourSave, false);
  unregisterTable(SURVIVAL_DOC);
  assert.equal(heatBurden({ band: "sweltering" }).waterNeed, 1, "unimported asks nothing");
});

/* --- animals eat too ------------------------------------------------------ */
const beast = (food, water) => ({
  flags: { "acks-extras": { extras: { feed: { food, water } } } },
});

ok("an animal's needs are its OWN figures, not a general table", () => {
  unregisterTable(SURVIVAL_DOC);   // no table registered, and it still answers
  const mule = animalNeeds(beast(2.5, 5));
  assert.equal(mule.food, 2.5);
  assert.equal(mule.water, 5);
  assert.equal(mule.stated, true);
});

ok("an unpriced animal does not eat for free — it has no figure", () => {
  const unknown = animalNeeds({ flags: {} });
  assert.equal(unknown.food, null, "null, never zero");
  assert.equal(unknown.water, null);
  assert.equal(unknown.stated, false);
  assert.equal(animalNeeds(null).stated, false);
});

ok("one stated figure is enough to count as stated", () => {
  assert.equal(animalNeeds(beast(3, null)).stated, true);
  assert.equal(animalNeeds(beast(null, 6)).stated, true);
});

/* --- survival, simplified -------------------------------------------------- */
ok("the shortcut is unavailable until its figures are imported", () => {
  unregisterTable(SURVIVAL_DOC);
  assert.equal(simplifiedSupply({ mouths: 4, days: 10 }), null,
    "a recommendation on invented numbers is worse than none");
});

ok("it recommends a FRACTION of the trip in food, because foraging covers the rest", () => {
  unregisterTable(SURVIVAL_DOC);
  registerTable({ ...SAMPLE, tables: { ...SAMPLE.tables,
    simplified: { foodShareOfTrip: 0.5, waterDays: 3, confidence: 90 } } },
    { priority: PRIORITY.WORLD, source: "test" });
  const plan = simplifiedSupply({ mouths: 4, animals: 2, days: 10 });
  assert.equal(plan.food, 20, "four people, ten days, half of it carried");
  assert.equal(plan.confidence, 90);
});

ok("animals drink, and the water plan counts them", () => {
  const withBeasts = simplifiedSupply({ mouths: 4, animals: 2, days: 10 });
  const without = simplifiedSupply({ mouths: 4, animals: 0, days: 10 });
  assert.equal(without.water, 12, "four people, three days each");
  assert.equal(withBeasts.water, 18, "six mouths, three days each");
});

ok("watered country waives the water entirely", () => {
  const plan = simplifiedSupply({ mouths: 4, animals: 2, days: 10, wateredCountry: true });
  assert.equal(plan.water, 0, "rivers and lakes to hand — carry none");
  assert.equal(plan.wateredCountry, true);
  assert.ok(plan.food > 0, "but you still have to eat");
  unregisterTable(SURVIVAL_DOC);
});


/* --- the rolled thirst toll -----------------------------------------------
   Starvation charges flat and thirst charges a die: the two are not
   interchangeable, and reading a die through a number-only gate is how a
   dehydrated body came to cost nothing at all. Every figure here is invented. */
const DICED = {
  id: SURVIVAL_DOC,
  source: "invented",
  tables: {
    ...SAMPLE.tables,
    water: { dehydratedNoWater: 1, dehydratedShort: 4, conPerDay: "2d4", recoverPerDay: 1 },
  },
};
const loadDiced = () => registerTable(DICED, { priority: PRIORITY.WORLD, source: "test" });
const parched = { food: "full", water: "none" };

ok("a die the caller never rolled is reported, not silently free", () => {
  loadDiced();
  const step = advanceSurvival(freshSurvival(), parched);
  assert.equal(step.state.hydration, "dehydrated", "the rung is still climbed");
  assert.equal(step.drain, 0, "nothing is charged on a roll that never happened");
  assert.equal(step.unrolled, true, "and the gap is named");
  unregisterTable(SURVIVAL_DOC, "test");
});

ok("a supplied roll is what the day costs", () => {
  loadDiced();
  const step = advanceSurvival(freshSurvival(), { ...parched, thirstRoll: 5 });
  assert.equal(step.drain, 5);
  assert.equal(step.unrolled, false);
  assert.equal(step.state.conLost, 5);
  unregisterTable(SURVIVAL_DOC, "test");
});

ok("the heat multiplies the toll, and a mild day does not", () => {
  loadDiced();
  const mild = advanceSurvival(freshSurvival(), { ...parched, thirstRoll: 3 });
  const hot = advanceSurvival(freshSurvival(), { ...parched, thirstRoll: 3, heat: 2 });
  assert.equal(mild.drain, 3);
  assert.equal(hot.drain, 6, "the same throw costs double in the heat");
  unregisterTable(SURVIVAL_DOC, "test");
});

ok("a heat multiplier is never allowed to make thirst free", () => {
  loadDiced();
  for (const heat of [0, -2, null, "hot", undefined]) {
    const step = advanceSurvival(freshSurvival(), { ...parched, thirstRoll: 4, heat });
    assert.equal(step.drain, 4, `heat=${heat} must fall back to a plain toll`);
  }
  unregisterTable(SURVIVAL_DOC, "test");
});

ok("a FLAT toll ignores the roll entirely, and the heat still bites", () => {
  load();       // SAMPLE registers water.conPerDay as a flat 2
  const meal = { food: "full", water: "none", thirstRoll: 99, heat: 2 };
  // SAMPLE's onset is the second dry day, so the first one costs nothing.
  const dry = advanceSurvival(freshSurvival(), meal);
  assert.equal(dry.drain, 0, "the rung has not been reached yet");
  const step = advanceSurvival(dry.state, meal);
  assert.equal(step.drain, 4, "flat two, doubled — the roll is not consulted");
  assert.equal(step.unrolled, false);
  unregisterTable(SURVIVAL_DOC, "test");
});

ok("hunger's toll stays flat and unrolled while thirst is diced", () => {
  loadDiced();
  let s = freshSurvival();
  for (let i = 0; i < 8; i++) s = advanceSurvival(s, { food: "none", water: "full" }).state;
  const step = advanceSurvival(s, { food: "none", water: "full" });
  assert.equal(s.nourishment, "starving");
  assert.equal(step.drain, 1, "starvation charges the registry's flat figure");
  assert.equal(step.unrolled, false, "no die was ever wanted");
  unregisterTable(SURVIVAL_DOC, "test");
});

ok("an unimported subsystem neither charges nor claims a missing roll", () => {
  const step = advanceSurvival(freshSurvival(), parched);
  assert.equal(step.drain, 0);
  assert.equal(step.unrolled, false, "nothing was owed, so nothing is outstanding");
  assert.equal(step.unpriced, true, "the absent import is what gets reported");
});

console.log("\ntest-survival: all " + passed + " checks passed");
