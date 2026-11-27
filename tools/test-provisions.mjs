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
  SHARE_POLICIES, dealProvisions, provisionDay, provisionForecast, daysCarried, provisionOf,
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
const item = (name, qty, foraged = null, flags = {}) => ({
  name,
  system: { quantity: qty },
  // Flags as a plain object carries them; `getFlag` answers from the same bag.
  flags: { "acks-extras": { ...(foraged ? { foraged } : {}), ...flags } },
  getFlag(scope, key) { return this.flags[scope]?.[key]; },
});
const carrying = (...items) => ({ items });
const FOOD = { kind: "food" };
const WATER = { kind: "water" };

ok("a named provision counts, and a week counts as a week", () => {
  const a = carrying(item("Iron Rations (1 day)", 3));
  assert.equal(daysCarried(a, FOOD), 3);
  const w = carrying(item("Iron Rations (1 week)", 2));
  assert.equal(daysCarried(w, FOOD), 14, "two weeks is fourteen days");
});

ok("a FLAGGED provision counts even though its name says nothing", () => {
  const a = carrying(item("Foraged Food", 4, "food"));
  assert.equal(daysCarried(a, FOOD), 4, "the flag catches it");
  assert.equal(daysCarried(a, { foraged: "food" }), 4, "the older spelling of the option still works");
});

ok("an item that is both flagged and named is counted once", () => {
  const a = carrying(item("Foraged Rations", 2, "food"));
  assert.equal(daysCarried(a, FOOD), 2, "counted once");
});

ok("flags are kept apart, so game and water do not leak into each other", () => {
  const a = carrying(item("Fresh Game", 3, "hunt"), item("Foraged Water", 5, "water"));
  assert.equal(daysCarried(a, { kind: "hunt" }), 3);
  assert.equal(daysCarried(a, WATER), 5);
  assert.equal(daysCarried(a, FOOD), 0);
  assert.equal(daysCarried(a, { kind: ["food", "hunt"] }), 3, "a list of kinds sums them");
  assert.equal(daysCarried(a, {}), 0, "no kind named, nothing counted");
});

ok("empty, zero and junk quantities carry nothing", () => {
  assert.equal(daysCarried(null, FOOD), 0);
  assert.equal(daysCarried(carrying(item("Rations", 0)), FOOD), 0);
  assert.equal(daysCarried(carrying(item("Rations", "x")), FOOD), 0);
  assert.equal(daysCarried(carrying(item("Rope", 5)), FOOD), 0);
});

/* --- provisionOf: what an item IS, never what a fragment of its name resembles */
const stamped = (name, qty, flags) => item(name, qty, null, flags);

ok("magic items whose names merely contain a provision's letters are no provision", () => {
  for (const name of [
    "Ring of Regeneration", "Potion of Brilliant Restoration", "Ring of Water Walking",
    "Leather Armor +1, Eelskin", "1 flask of holy water", "Rope", "Wineskin",
  ]) {
    assert.equal(provisionOf(item(name, 3)), null, name);
  }
  const bag = carrying(item("Ring of Regeneration", 1), item("Potion of Brilliant Restoration", 2), item("Ring of Water Walking", 1), item("1 flask of holy water", 4));
  assert.equal(daysCarried(bag, FOOD) + daysCarried(bag, WATER), 0, "none of them feeds or waters anyone");
});

ok("an imported identity reads its kind, by cookbook id and by the id a class-kit item was cut from", () => {
  assert.deepEqual(provisionOf(stamped("Rations, Iron", 2, { cookbook: { id: "def.equip.rationsIron" } })),
    { kind: "food", units: 2, perUnit: 1, days: 2, source: "imported" });
  assert.equal(provisionOf(stamped("Rations, Standard", 1, { cookbook: { id: "def.equip.rationsStandard" } })).kind, "food");
  const weekKit = provisionOf(stamped("1 week's iron rations", 2, { skin: { base: "def.equip.rationsIron" } }));
  assert.equal(weekKit.kind, "food");
  assert.equal(weekKit.source, "imported");
  assert.equal(weekKit.days, 14, "a week by name is seven days a unit");
  const vessel = provisionOf(stamped("Waterskin/Wineskin", 1, { cookbook: { id: "def.equip.waterskinWineskin" } }));
  assert.equal(vessel.kind, "water", "the imported entry itself names both and is water");
  assert.equal(provisionOf(stamped("Leaky waterskin", 1, { skin: { base: "def.equip.waterskinWineskin" } })).kind, "water");
  assert.equal(provisionOf(stamped("Waterskin", 1, { skin: { base: "def.equip.waterskinWineskin" } })).source, "imported");
});

ok("a wineskin is not water, whatever vessel it was cut from", () => {
  assert.equal(provisionOf(stamped("Wineskin", 2, { skin: { base: "def.equip.waterskinWineskin" } })), null);
  assert.equal(daysCarried(carrying(stamped("Wineskin", 2, { skin: { base: "def.equip.waterskinWineskin" } })), WATER), 0);
});

ok("a hand-made item with no identity reads by whole word and says it was the name", () => {
  assert.deepEqual(provisionOf(item("Rations", 3)), { kind: "food", units: 3, perUnit: 1, days: 3, source: "name" });
  assert.equal(provisionOf(item("Standard Ration", 1)).kind, "food");
  assert.equal(provisionOf(item("Waterskin", 1)).kind, "water");
  assert.equal(provisionOf(item("Water skin", 1)).kind, "water");
  assert.equal(provisionOf(item("Canteen", 1)).kind, "water");
  assert.equal(provisionOf(item("Waterskin", 1)).source, "name");
});

ok("a foraged flag reads one day a unit and outranks the identity and the name", () => {
  const found = provisionOf(item("Foraged Food", 4, "food"));
  assert.deepEqual(found, { kind: "food", units: 4, perUnit: 1, days: 4, source: "foraged" });
  assert.equal(provisionOf(item("Fresh Game", 2, "hunt")).kind, "hunt");
  assert.equal(provisionOf(item("Foraged Rations (week)", 2, "water")).kind, "water", "the flag says water, whatever the name");
  assert.equal(provisionOf(item("Foraged Rations (week)", 2, "water")).perUnit, 1);
  assert.equal(provisionOf(item("Firewood", 2, "firewood")), null, "a flagged material is no provision");
});

ok("a Judge's declaration outranks everything: kind none beats a name match, a perUnit is used", () => {
  assert.equal(provisionOf(item("Rations", 3, null, { provision: { kind: "none" } })), null, "declared not a provision");
  assert.equal(provisionOf(item("Foraged Food", 3, "food", { provision: { kind: "none" } })), null, "even a foraged one");
  assert.equal(provisionOf(stamped("Rations, Iron", 3, { cookbook: { id: "def.equip.rationsIron" }, provision: { kind: "none" } })), null);
  const declared = provisionOf(item("Strange Loaf", 2, null, { provision: { kind: "food", perUnit: 3 } }));
  assert.deepEqual(declared, { kind: "food", units: 2, perUnit: 3, days: 6, source: "declared" });
  assert.equal(provisionOf(item("Ring of Regeneration", 1, null, { provision: { kind: "water", perUnit: 2 } })).kind, "water");
  assert.equal(provisionOf(item("Rations (1 week)", 1, null, { provision: { kind: "food", perUnit: "x" } })).perUnit, 7,
    "a perUnit that is no number falls back to the name's unit");
  assert.equal(provisionOf(item("Rations", 1, null, { provision: { kind: "nonsense" } })).source, "name", "an unknown kind is ignored");
});

ok("a part-eaten week ration holds fewer days, so the forecast agrees with the press", () => {
  const week = (uses) => item("Iron Rations (1 week)", 2, null, uses == null ? {} : { uses });
  assert.equal(provisionOf(week(3)).days, 11, "two weeks less three days eaten");
  assert.equal(daysCarried(carrying(week(3)), FOOD), 11);
  assert.equal(provisionOf(item("Iron Rations (1 week)", 1, null, { uses: 3 })).days, 4, "a week with 3 used holds 4 days");
  assert.equal(provisionOf(item("Iron Rations (1 week)", 1, null, { uses: 6 })).days, 1, "the last day of a unit");
  assert.equal(provisionOf(item("Iron Rations (1 week)", 1, null, { uses: 99 })).days, 1, "uses never take the last day away");
  assert.equal(provisionOf(item("Rations", 2, null, { uses: 1 })).days, 2, "a one-day unit has no uses to fold");
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
