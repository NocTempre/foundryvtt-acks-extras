/**
 * Feeding a marching order: pooling, and who goes short.
 *
 * No printed values here at all — the file is policy and arithmetic. What it
 * pins is that a party SHARES, that the two shortfall policies differ in the
 * way a Judge would expect, and that the levels handed back are exactly the
 * vocabulary the survival ladder consumes.
 */
import assert from "node:assert/strict";
import {
  SHARE_POLICIES, dealProvisions, provisionDay, provisionForecast, daysCarried,
} from "../scripts/formation/provisions.mjs";
import { RATION_LEVELS, advanceSurvival, freshSurvival } from "../scripts/lib/survival.mjs";

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok   " + name); };

ok("the policies are structural and the levels are survival's own", () => {
  assert.deepEqual(Object.keys(SHARE_POLICIES), ["even", "triage"]);
  const { levels } = dealProvisions({ mouths: 3, supply: 3 });
  for (const level of levels) {
    assert.ok(RATION_LEVELS.includes(level), "a dealt level must be one the ladder knows");
  }
});

ok("enough for everyone feeds everyone, and the rest keeps", () => {
  const r = dealProvisions({ mouths: 4, supply: 10 });
  assert.deepEqual(r.levels, ["full", "full", "full", "full"]);
  assert.equal(r.remaining, 6);
  assert.equal(r.short, false);
});

ok("exactly enough is not short", () => {
  const r = dealProvisions({ mouths: 4, supply: 4 });
  assert.equal(r.short, false);
  assert.equal(r.remaining, 0);
});

ok("EVEN puts the whole order on the same reduced ration", () => {
  const r = dealProvisions({ mouths: 4, supply: 2, policy: "even" });
  assert.deepEqual(r.levels, ["half", "half", "half", "half"], "nobody eats while another starves");
  assert.equal(r.short, true);
});

ok("EVEN gives nothing to anyone when it cannot manage even half", () => {
  const r = dealProvisions({ mouths: 4, supply: 1, policy: "even" });
  assert.deepEqual(r.levels, ["none", "none", "none", "none"], "a sip is not a meal");
  assert.equal(r.remaining, 1, "and the pool is not spent on a fiction");
});

ok("TRIAGE feeds as many as it can properly and leaves the rest empty", () => {
  const r = dealProvisions({ mouths: 4, supply: 2, policy: "triage" });
  assert.deepEqual(r.levels, ["full", "full", "none", "none"]);
  assert.equal(r.fed, 2);
  assert.equal(r.short, true);
});

ok("the two policies spend the same supply and differ only in who suffers", () => {
  const even = dealProvisions({ mouths: 4, supply: 2, policy: "even" });
  const triage = dealProvisions({ mouths: 4, supply: 2, policy: "triage" });
  assert.equal(even.remaining, triage.remaining, "same pool spent");
  assert.notDeepEqual(even.levels, triage.levels, "different people go hungry");
});

ok("an empty order consumes nothing", () => {
  const r = dealProvisions({ mouths: 0, supply: 5 });
  assert.deepEqual(r.levels, []);
  assert.equal(r.remaining, 5);
});

ok("food and water are dealt independently — parched but well fed is a real day", () => {
  const day = provisionDay({ mouths: 4, food: 10, water: 2, policy: "even" });
  assert.deepEqual(day.meals.map((m) => m.food), ["full", "full", "full", "full"]);
  assert.deepEqual(day.meals.map((m) => m.water), ["half", "half", "half", "half"]);
  assert.equal(day.short, true, "short in either is short");
});

ok("what is dealt feeds straight into the ladder", () => {
  const day = provisionDay({ mouths: 2, food: 1, water: 4, policy: "triage" });
  // The unfed one takes the ladder's first step; the fed one does not.
  const fed = advanceSurvival(freshSurvival(), day.meals[0]);
  const unfed = advanceSurvival(freshSurvival(), day.meals[1]);
  assert.equal(fed.state.noFoodRun, 0);
  assert.equal(unfed.state.noFoodRun, 1, "the empty pack starts a clock");
});

ok("the forecast says how many days the packs hold", () => {
  const f = provisionForecast({ mouths: 4, food: 10, water: 6 });
  assert.equal(f.foodDays, 2, "10 across 4 mouths is two whole days");
  assert.equal(f.waterDays, 1);
  assert.equal(provisionForecast({ mouths: 0, food: 5 }).foodDays, null, "nobody to feed, no forecast");
});

/* --- the ONE supply reader ------------------------------------------------
   A second reader is a second answer to "how much food is there", and the two
   disagree the moment something is added by a path the other does not know
   about. That is not hypothetical: foraging began depositing items the ration
   pattern did not match, and the forecast read zero while the packs were full. */
const item = (name, qty, foraged = null) => ({
  name,
  system: { quantity: { value: qty } },
  getFlag: (scope, key) => (scope === "acks-extras" && key === "foraged" ? foraged : undefined),
});
const carrying = (...items) => ({ items });

ok("a named provision counts, and a week counts as a week", () => {
  const a = carrying(item("Iron Rations (1 day)", 3));
  assert.equal(daysCarried(a, { pattern: /ration/i }), 3);
  const w = carrying(item("Iron Rations (1 week)", 2));
  assert.equal(daysCarried(w, { pattern: /ration/i }), 14, "two weeks is fourteen days");
});

ok("a FLAGGED provision counts even though its name says nothing", () => {
  const a = carrying(item("Foraged Food", 4, "food"));
  assert.equal(daysCarried(a, { pattern: /ration/i }), 0, "the name alone would miss it");
  assert.equal(daysCarried(a, { pattern: /ration/i, foraged: "food" }), 4, "the flag catches it");
});

ok("the two are not double-counted when an item is both", () => {
  const a = carrying(item("Foraged Rations", 2, "food"));
  assert.equal(daysCarried(a, { pattern: /ration/i, foraged: "food" }), 2, "counted once");
});

ok("flags are kept apart, so game and water do not leak into each other", () => {
  const a = carrying(item("Fresh Game", 3, "hunt"), item("Foraged Water", 5, "water"));
  assert.equal(daysCarried(a, { foraged: "hunt" }), 3);
  assert.equal(daysCarried(a, { foraged: "water" }), 5);
  assert.equal(daysCarried(a, { foraged: "food" }), 0);
});

ok("empty, zero and junk quantities carry nothing", () => {
  assert.equal(daysCarried(null, { pattern: /ration/i }), 0);
  assert.equal(daysCarried(carrying(item("Rations", 0)), { pattern: /ration/i }), 0);
  assert.equal(daysCarried(carrying(item("Rations", "x")), { pattern: /ration/i }), 0);
  assert.equal(daysCarried(carrying(item("Rope", 5)), { pattern: /ration/i }), 0);
});

/* --- the heat's extra thirst, felt in the pool ---------------------------- */
ok("a heavier need makes the same pool go less far", () => {
  const mild = dealProvisions({ mouths: 4, supply: 4, need: 1 });
  assert.equal(mild.short, false, "four days across four mouths is exactly enough");
  const hot = dealProvisions({ mouths: 4, supply: 4, need: 1.25 });
  assert.equal(hot.short, true, "the same pool no longer stretches");
  assert.deepEqual(hot.levels, ["half", "half", "half", "half"]);
});

ok("a heavier need spends more of the pool when it IS enough", () => {
  const hot = dealProvisions({ mouths: 2, supply: 10, need: 1.5 });
  assert.equal(hot.short, false);
  assert.equal(hot.remaining, 7, "two mouths at one-and-a-half each is three spent");
});

ok("triage feeds fewer mouths when each costs more", () => {
  const mild = dealProvisions({ mouths: 6, supply: 4, policy: "triage", need: 1 });
  assert.equal(mild.fed, 4);
  const hot = dealProvisions({ mouths: 6, supply: 4, policy: "triage", need: 2 });
  assert.equal(hot.fed, 2, "the same water, half the people");
});

ok("the day passes the need to water and never to food", () => {
  const day = provisionDay({ mouths: 4, food: 4, water: 4, waterNeed: 2 });
  assert.deepEqual(day.meals.map((m) => m.food), ["full", "full", "full", "full"], "eating is unaffected");
  assert.equal(day.water.short, true, "drinking is not");
});

ok("the forecast shortens in the heat without anyone drinking faster", () => {
  const mild = provisionForecast({ mouths: 2, water: 8, waterNeed: 1 });
  assert.equal(mild.waterDays, 4);
  const hot = provisionForecast({ mouths: 2, water: 8, waterNeed: 2 });
  assert.equal(hot.waterDays, 2, "same skins, half the days");
  assert.equal(hot.waterNeed, 2, "and it says why");
});

console.log("\ntest-provisions: all " + passed + " checks passed");
