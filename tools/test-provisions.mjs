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
  SHARE_POLICIES, dealProvisions, provisionDay, provisionForecast, daysCarried, unsizedProvisions, provisionOf,
} from "../scripts/formation/provisions.mjs";
import {
  FOOD_AND_GAME, refillActor, spendFood, spendShares, spendWater,
} from "../scripts/formation/provision-spend.mjs";
import { RATION_LEVELS, advanceSurvival, freshSurvival } from "../scripts/lib/survival.mjs";

let passed = 0;
// A check may be async: the checks run one after another, and the first failure stops the run.
let chain = Promise.resolve();
const ok = (name, fn) => {
  chain = chain.then(async () => {
    try {
      await fn();
    } catch (err) {
      console.error("FAIL " + name);
      throw err;
    }
    passed++;
    console.log("ok   " + name);
  });
};

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
  assert.deepEqual(provisionOf(stamped("Rations, Iron", 2, { cookbook: { id: "def.equip.rationsIron", read: { days: 3 } } })),
    { kind: "food", units: 2, perUnit: 3, days: 6, source: "imported", sized: true, sizeSource: "page", left: null });
  assert.deepEqual(provisionOf(stamped("Rations, Iron", 2, { cookbook: { id: "def.equip.rationsIron" } })),
    { kind: "food", units: 2, perUnit: null, days: null, source: "imported", sized: false, sizeSource: null, left: null },
    "the identity names the kind; with no figure from the page it has no size");
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
  assert.deepEqual(provisionOf(item("Rations", 3)),
    { kind: "food", units: 3, perUnit: null, days: null, source: "name", sized: false, sizeSource: null, left: null },
    "a name gives the kind, and no stand-in size");
  assert.deepEqual(provisionOf(item("Day Rations", 3)),
    { kind: "food", units: 3, perUnit: 1, days: 3, source: "name", sized: true, sizeSource: "name", left: null });
  assert.equal(provisionOf(item("Standard Ration", 1)).kind, "food");
  assert.equal(provisionOf(item("Waterskin", 1)).kind, "water");
  assert.equal(provisionOf(item("Water skin", 1)).kind, "water");
  assert.equal(provisionOf(item("Canteen", 1)).kind, "water");
  assert.equal(provisionOf(item("Waterskin", 1)).source, "name");
});

ok("a foraged flag reads one day a unit and outranks the identity and the name", () => {
  const found = provisionOf(item("Foraged Food", 4, "food"));
  assert.deepEqual(found, { kind: "food", units: 4, perUnit: 1, days: 4, source: "foraged", sized: true, sizeSource: "foraged", left: null });
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
  assert.deepEqual(declared, { kind: "food", units: 2, perUnit: 3, days: 6, source: "declared", sized: true, sizeSource: "declared", left: null });
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
  assert.equal(provisionOf(item("Iron Rations (1 day)", 2, null, { uses: 1 })).days, 2, "a one-day unit has no uses to fold");
});

/* --- the size: hand, foraged, page, name, and otherwise none --------------- */
const read = (reads, name = "Rations, Iron", qty = 2, flags = {}) =>
  stamped(name, qty, { cookbook: { id: "def.equip.rationsIron", read: reads }, ...flags });
const vessel = (reads, name = "Waterskin/Wineskin", qty = 1, flags = {}) =>
  stamped(name, qty, { cookbook: { id: "def.equip.waterskinWineskin", read: reads }, ...flags });

ok("the size is read in order: a hand figure, a foraged unit, the page, the name, then none", () => {
  const sized = (flags) => provisionOf(stamped("Iron Rations (1 week)", 2, { cookbook: { id: "def.equip.rationsIron", read: { days: 3 } }, ...flags }));
  assert.deepEqual([sized({}).perUnit, sized({}).sizeSource], [3, "page"], "the page outranks the name");
  assert.deepEqual([sized({ provision: { perUnit: 5 } }).perUnit, sized({ provision: { perUnit: 5 } }).sizeSource], [5, "declared"], "a hand figure outranks the page");
  assert.equal(provisionOf(stamped("Iron Rations (1 week)", 2, { cookbook: { id: "def.equip.rationsIron" } })).perUnit, 7, "the name answers where the page does not");
  assert.equal(provisionOf(stamped("Rations, Iron", 2, { cookbook: { id: "def.equip.rationsIron" } })).perUnit, null, "and nothing answers last");
  const forage = provisionOf(item("Foraged Food", 2, "food", { cookbook: { id: "def.equip.rationsIron", read: { days: 3 } } }));
  assert.deepEqual([forage.perUnit, forage.sizeSource], [1, "foraged"], "a foraged unit is a person-day whatever the page says");
  assert.equal(provisionOf(item("Foraged Food", 2, "food", { provision: { perUnit: 4 } })).perUnit, 4, "a hand figure outranks it");
});

ok("a hand size applies to an item whose kind is read as it reads, and to one declared", () => {
  const byIdentity = provisionOf(stamped("Rations, Iron", 2, { cookbook: { id: "def.equip.rationsIron" }, provision: { perUnit: 4 } }));
  assert.deepEqual([byIdentity.source, byIdentity.perUnit, byIdentity.days, byIdentity.sizeSource], ["imported", 4, 8, "declared"]);
  const byName = provisionOf(item("Rations", 3, null, { provision: { perUnit: 2 } }));
  assert.deepEqual([byName.source, byName.perUnit, byName.days], ["name", 2, 6]);
  assert.equal(provisionOf(item("Rations", 3, null, { provision: { kind: "food", perUnit: 0 } })).sized, false, "a size of nothing is no size");
  assert.equal(provisionOf(item("Rations", 3, null, { provision: { kind: "food", perUnit: "" } })).sized, false, "a blank is no size");
  assert.equal(provisionOf(item("Rations", 3, null, { provision: { kind: "food", perUnit: null } })).sized, false);
});

ok("a class-kit copy reads the sizes its skin carries", () => {
  const kit = provisionOf(stamped("Waterskin", 1, { skin: { base: "def.equip.waterskinWineskin", read: { holds: { amount: 25, unit: "unit" }, daily: 100 } } }));
  assert.deepEqual([kit.kind, kit.perUnit, kit.sizeSource], ["water", 0.25, "page"]);
  assert.equal(provisionOf(stamped("Rations", 2, { skin: { base: "def.equip.rationsIron", read: { days: 3 } } })).days, 6);
});

ok("a vessel's unit is the part of a person's day it holds, and what is left defaults to full", () => {
  const w = provisionOf(vessel({ holds: { amount: 10, unit: "unit" }, daily: 40 }, "Waterskin", 4));
  assert.deepEqual([w.kind, w.perUnit, w.days, w.left, w.sizeSource], ["water", 0.25, 1, 1, "page"]);
  assert.equal(provisionOf(vessel({ holds: { amount: 10, unit: "unit" } })).sized, false, "a holding with no daily figure is no size");
  assert.equal(provisionOf(vessel({ daily: 40 })).sized, false, "and a daily figure with no holding");
  assert.equal(provisionOf(vessel({ holds: { amount: 10, unit: "unit" }, daily: 0 })).sized, false, "a day of nothing divides nothing");
});

ok("where the page counts vessels to a day, a vessel is that share of the day, over its holding's own ratio", () => {
  const w = provisionOf(vessel({ holds: { amount: 9, unit: "unit" }, daily: 40, perDay: 4 }, "Waterskin", 4));
  assert.deepEqual([w.perUnit, w.days, w.sizeSource], [0.25, 1, "page"]);
  const kit = provisionOf(stamped("Waterskin", 2, { skin: { base: "def.equip.waterskinWineskin", read: { holds: { amount: 9, unit: "unit" }, daily: 40, perDay: 4 } } }));
  assert.equal(kit.perUnit, 0.25, "a kit copy reads the count from its skin");
});

ok("what is left in a vessel is the stored figure, clamped to what the stack holds, and null or blank is never set", () => {
  const full = { holds: { amount: 10, unit: "unit" }, daily: 40 };
  const left = (value, qty = 4) => provisionOf(vessel(full, "Waterskin", qty, { provision: { left: value } })).left;
  assert.equal(left(0.4), 0.4, "a hand figure");
  assert.equal(left(0), 0, "an emptied vessel holds nothing: zero is a figure");
  assert.equal(left(-2), 0, "never below empty");
  assert.equal(left(9), 1, "never above what the stack holds");
  assert.equal(left(null), 1, "null is never set");
  assert.equal(left(""), 1, "a blank is never set");
  assert.equal(left("x"), 1, "and so is a non-number");
  assert.equal(left(0.4, 2), 0.4, "a smaller stack still holds it");
  assert.equal(left(0.4, 1), 0.25, "a stack of one holds its own full only");
  assert.equal(provisionOf(vessel(full, "Waterskin", 0, { provision: { left: 0.4 } })).days, 0, "no vessel, no water");
  assert.equal(daysCarried(carrying(vessel(full, "Waterskin", 4, { provision: { left: 0.4 } })), WATER), 0.4, "the camp counts what is left");
  const flagged = provisionOf(item("Foraged Water", 5, "water", { provision: { left: 2 } }));
  assert.deepEqual([flagged.days, flagged.left], [2, 2], "a foraged water stack is kept the same way");
  assert.equal(provisionOf(read({ days: 3 }, "Rations, Iron", 2, { provision: { left: 1 } })).left, null, "food has no left");
});

ok("an unsized item is not summed, and is listed by name for the card", () => {
  const bare = item("Rations", 3);
  const sizedItem = item("Day Rations", 2);
  const wine = item("Waterskin", 1);
  const none = item("Rations", 0);
  const a = carrying(bare, sizedItem, wine, none);
  assert.equal(daysCarried(a, FOOD), 2, "only the sized one counts");
  assert.equal(daysCarried(a, WATER), 0, "an unsized vessel adds no water");
  assert.deepEqual(unsizedProvisions(a, FOOD), [{ item: bare, kind: "food" }], "listed, and only while it holds a unit");
  assert.deepEqual(unsizedProvisions(a, WATER), [{ item: wine, kind: "water" }]);
  assert.deepEqual(unsizedProvisions(a, { kind: ["food", "water"] }).map((u) => u.kind), ["food", "water"]);
  assert.deepEqual(unsizedProvisions(a, {}), []);
  assert.deepEqual(unsizedProvisions(null, FOOD), []);
  const handSized = carrying(item("Rations", 3, null, { provision: { perUnit: 2 } }));
  assert.equal(daysCarried(handSized, FOOD), 6, "a size set by hand brings it back into the count");
  assert.deepEqual(unsizedProvisions(handSized, FOOD), []);
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

/* --- spending: one consumer, fractional and multi-day ---------------------
   Invented names and figures throughout: the sizes are declared by hand on the
   item, as a Judge would, so nothing here reads a page. */
globalThis.foundry = { data: { operators: { ForcedDeletion: class ForcedDeletion {} } } };
const setAt = (obj, path, value) => {
  const keys = path.split(".");
  const last = keys.pop();
  keys.reduce((o, k) => (o[k] ??= {}), obj)[last] = value;
};
/** An item that takes writes the way a document does: dotted paths, a forced deletion, setFlag. */
const held = (name, qty, flags = {}) => {
  const it = item(name, qty, null, flags);
  it.writes = [];
  it.update = async (patch) => {
    it.writes.push(patch);
    for (const [path, value] of Object.entries(patch)) {
      if (value instanceof globalThis.foundry.data.operators.ForcedDeletion) {
        const keys = path.split(".");
        const last = keys.pop();
        delete keys.reduce((o, k) => o?.[k], it)?.[last];
      } else setAt(it, path, value);
    }
  };
  it.setFlag = async (scope, key, value) => { (it.flags[scope] ??= {})[key] = structuredClone(value); };
  return it;
};
const loaf = (qty, perUnit, flags = {}) => held("Trail Loaf", qty, { provision: { kind: "food", perUnit }, ...flags });
const flask = (qty, perUnit, flags = {}) => held("Trail Flask", qty, { provision: { kind: "water", perUnit, ...flags } });
const usesOf = (it) => it.flags["acks-extras"].uses;
const daysOf = (it) => provisionOf(it).days;

ok("a part-day portion is a fraction of the unit, kept in the item's uses", async () => {
  const day = held("Day Rations", 3);
  assert.equal(daysOf(held("Day Rations", 3, { uses: 0.5 })), 2.5, "a day's ration half eaten holds half a day");
  const a = carrying(day);
  assert.deepEqual(await spendFood(a, 0.5).then((r) => [r.spent, r.short]), [0.5, 0]);
  assert.deepEqual([day.system.quantity, usesOf(day), daysOf(day)], [3, 0.5, 2.5]);
  await spendFood(a, 0.5);
  assert.deepEqual([day.system.quantity, usesOf(day), daysOf(day)], [2, 0, 2], "two halves are a ration, and the stack drops");
});

ok("a multi-day unit is eaten a day at a time and across units, and an emptied stack stays", async () => {
  const bread = loaf(2, 3);
  const a = carrying(bread);
  await spendFood(a, 1);
  assert.deepEqual([bread.system.quantity, usesOf(bread), daysOf(bread)], [2, 1, 5]);
  const r = await spendFood(a, 2.5);
  assert.deepEqual([r.spent, bread.system.quantity, usesOf(bread), daysOf(bread)], [2.5, 1, 0.5, 2.5], "the first unit finished and the second half-way into its last day");
  assert.deepEqual(r.from.map((f) => [f.name, f.days]), [["Trail Loaf", 2.5]], "and it says what it drew on");
  const last = await spendFood(a, 9);
  assert.deepEqual([last.spent, last.short], [2.5, 6.5], "asked for more than is held: it gives what there is and says what is owed");
  assert.deepEqual([bread.system.quantity, usesOf(bread), daysOf(bread)], [0, 0, 0], "the emptied stack stays in the pack");
  assert.equal(await spendFood(a, 1).then((x) => x.spent), 0, "an empty stack gives nothing");
});

ok("the unit worth the fewest days goes first, and an item with no size is never touched", async () => {
  const week = loaf(1, 7);
  const dayUnit = held("Day Rations", 2);
  const bare = held("Rations", 5);
  const game = held("Fresh Game", 3, { foraged: "hunt" });
  const a = carrying(week, bare, dayUnit, game);
  const r = await spendFood(a, 2.5);
  assert.deepEqual(r.from.map((f) => f.name), ["Day Rations", "Trail Loaf"], "a day's ration before a week's");
  assert.deepEqual([dayUnit.system.quantity, daysOf(week)], [0, 6.5], "the day units went and the week was cut into");
  assert.equal(bare.system.quantity, 5, "a ration with no size is left as it is");
  assert.deepEqual(bare.writes, []);
  assert.equal(game.system.quantity, 3, "the press's food never takes game");
  const both = await spendFood(a, 2, { kinds: FOOD_AND_GAME });
  assert.equal(both.from[0].name, "Fresh Game", "End day's food does, a day a unit, before the week's seven");
  assert.equal(game.system.quantity, 1);
});

ok("a unit of more than a day keeps a part-day portion, and a stale count at or past the unit leaves its last day", async () => {
  const stew = loaf(2, 1.5);
  await spendFood(carrying(stew), 1);
  assert.deepEqual([stew.system.quantity, usesOf(stew), daysOf(stew)], [2, 1, 2], "one day of two one-and-a-half-day units leaves two days");
  assert.equal(provisionOf(loaf(1, 3, { uses: 3 })).days, 1, "a count the size of the unit is stale");
  assert.equal(provisionOf(loaf(1, 3, { uses: 2.5 })).days, 0.5, "inside the unit it stands");
});

ok("a vessel is drawn down to what is left, never below empty, and stays in the pack with its declared kind and size", async () => {
  const skin = flask(4, 0.25);
  const a = carrying(skin);
  assert.deepEqual(await spendWater(a, 0.4).then((r) => [r.spent, r.short]), [0.4, 0]);
  assert.equal(skin.flags["acks-extras"].provision.left, 0.6);
  assert.deepEqual([skin.flags["acks-extras"].provision.kind, skin.flags["acks-extras"].provision.perUnit], ["water", 0.25], "the declared kind and size are kept");
  assert.equal(daysCarried(a, WATER), 0.6, "the camp counts what is left");
  const r = await spendWater(a, 1);
  assert.deepEqual([r.spent, r.short], [0.6, 0.4], "it gives what is left and says what is owed");
  assert.deepEqual([skin.flags["acks-extras"].provision.left, skin.system.quantity], [0, 4], "emptied, and still four vessels");
  assert.equal(provisionOf(skin).days, 0);
  assert.equal(await spendWater(a, 1).then((x) => x.spent), 0);
  const second = held("Trail Skin", 1, { provision: { kind: "water", perUnit: 0.5 } });
  const stacks = carrying(second, flask(2, 0.5));
  assert.deepEqual(await spendWater(stacks, 1.25).then((r) => r.from.map((f) => [f.name, f.days])), [["Trail Skin", 0.5], ["Trail Flask", 0.75]], "vessel by vessel, in the pack's order");
  const bare = held("Waterskin", 1);
  assert.equal(await spendWater(carrying(bare), 1).then((r) => r.spent), 0, "an unsized vessel gives none");
  assert.deepEqual(bare.writes, []);
  const foraged = held("Foraged Water", 5, { foraged: "water" });
  assert.equal(await spendWater(carrying(foraged), 2).then((r) => r.spent), 2, "foraged water is a person-day a unit");
  assert.equal(provisionOf(foraged).left, 3);
});

ok("a share is drawn from the member's own pack first, then from the rest of the order's, in member order", async () => {
  const ownA = loaf(1, 1);
  const ownB = loaf(3, 1);
  const ownC = loaf(0, 1);
  const [a, b, c] = [carrying(ownA), carrying(ownB), carrying(ownC)].map((x, i) => ({ ...x, name: "ABC"[i] }));
  const rows = await spendShares([a, b, c], [2, 0, 1], spendFood);
  assert.deepEqual(rows.map((r) => r.days), [2, 0, 1]);
  assert.deepEqual(rows[0].from, [{ name: "Trail Loaf", owner: "A", days: 1 }, { name: "Trail Loaf", owner: "B", days: 1 }], "A ate its own day and then one of B's");
  assert.deepEqual(rows[2].from, [{ name: "Trail Loaf", owner: "B", days: 1 }]);
  assert.deepEqual([ownA.system.quantity, ownB.system.quantity, ownC.system.quantity], [0, 1, 0]);
  const short = await spendShares([a, b], [1, 2], spendFood);
  assert.deepEqual(short.map((r) => [r.days, r.short]), [[0, 1], [1, 1]], "what no pack can give stays owing");
});

ok("what is dealt is what is spent: even half portions and triage take exactly the pool dealt", async () => {
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ ...carrying(loaf(1, 1)), name: "M" + i }));
  for (const policy of ["even", "triage"]) {
    const order = mk(4);
    const supply = 3;
    const day = provisionDay({ mouths: 4, food: supply, policy });
    const shares = day.food.levels.map((l) => ({ full: 1, half: 0.5, none: 0 })[l]);
    const rows = await spendShares(order, shares, spendFood);
    const spent = rows.reduce((n, r) => n + r.days, 0);
    assert.equal(spent, supply - day.food.remaining, policy);
  }
  const even = provisionDay({ mouths: 4, food: 2, policy: "even" });
  assert.deepEqual(even.food.levels, ["half", "half", "half", "half"]);
  assert.equal(even.food.remaining, 0, "half portions of four mouths are the whole two days");
});

ok("a sum of fractions that is one day reads as one day, by the pool, the deal and the forecast", () => {
  const tenths = Array(10).fill(0.1).reduce((n, x) => n + x, 0);
  assert.ok(tenths < 1, "float dust leaves ten tenths just under a day");
  assert.equal(provisionForecast({ mouths: 1, water: tenths }).waterDays, 1);
  assert.equal(provisionForecast({ mouths: 1, food: tenths }).foodDays, 1);
  const deal = dealProvisions({ mouths: 1, supply: tenths });
  assert.deepEqual([deal.levels, deal.short, deal.remaining], [["full"], false, 0]);
  assert.deepEqual(dealProvisions({ mouths: 2, supply: tenths * 2, policy: "triage" }).levels, ["full", "full"]);
  assert.deepEqual(dealProvisions({ mouths: 4, supply: 2 * tenths, policy: "even" }).levels, ["half", "half", "half", "half"]);
  const vessels = carrying(...[0.7, 0.1, 0.1, 0.1].map((p) => flask(1, p)));
  assert.equal(daysCarried(vessels, WATER), 1, "four vessels that make a day read as a day");
  assert.equal(provisionForecast({ mouths: 1, water: daysCarried(vessels, WATER) }).waterDays, 1);
});

ok("a refill sets every sized vessel to full by unsetting what is left, and skips a vessel with no size", async () => {
  const half = flask(2, 0.5, { left: 0.25 });
  const never = flask(1, 0.5);
  const bare = held("Waterskin", 2);
  const none = flask(0, 0.5, { left: 0 });
  const a = carrying(half, never, bare, none, loaf(1, 1));
  const r = await refillActor(a);
  assert.deepEqual(r.filled, [half, never]);
  assert.deepEqual(r.skipped, [bare], "an unsized vessel is reported and left");
  assert.equal("left" in half.flags["acks-extras"].provision, false, "unset reads as full");
  assert.equal(provisionOf(half).left, 1);
  assert.deepEqual(never.writes, [], "a vessel never drawn on is not written");
  assert.equal(half.flags["acks-extras"].provision.perUnit, 0.5, "the declared size stays");
  assert.deepEqual(bare.writes, []);
});

await chain;
console.log("\ntest-provisions: all " + passed + " checks passed");
