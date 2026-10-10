/**
 * What the sky does to the throws, the eye and the body — the merge, not the
 * figures. Every value below is INVENTED: the real penalties, ceilings, day
 * counts and chances are printed and arrive through the importer. What this
 * pins is how two conditions combine (penalties sum, the ceiling takes the
 * lowest, the factor multiplies), that the dust clause applies only on the
 * grounds it names, that a night's need takes the strictest, and that an
 * unimported table reads as nothing stated.
 */
import assert from "node:assert/strict";
import { registerTable, unregisterTable, PRIORITY } from "../scripts/lib/tables.mjs";
import {
  weatherEffects, linesOf, throwPenalty, foragePenalty, weatherEffectsReady,
  WEATHER_THROWS, WEATHER_FORAGE,
} from "../scripts/formation/weather-effects.mjs";

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok   " + name); };

const SAMPLE = {
  id: "weather",
  source: "invented",
  tables: {
    conditionEffects: {
      foggy: {
        throws: { searching: -3, landSurveying: -3, navigation: -3, tracking: -3 },
        visibilityFeet: 70,
      },
      rainy: {
        throws: { searching: -1, missile: -1, trackingPerHour: -3 },
        forage: { firewood: -5 },
        visibilityFactor: 0.5,
        disease: { days: 5, pct: 7 },
      },
      windy: {
        throws: { missile: -1, listening: -1 },
        airSpeed: 0.5,
        dust: { terrains: ["barrens", "desert"], visibilityFeet: 30, speed: 0.5, throws: { searching: -7, navigation: -7 } },
      },
      cold: {
        rest: { fire: true, clothing: true, both: false },
        disease: { days: 5, pct: 3 },
        frostbite: { save: "death", die: "1d3", row: "9-11" },
      },
      frigid: {
        rest: { fire: true, clothing: true, both: true },
      },
      sunbaked: {
        forage: { water: -5 },
        sunburn: { damage: 1, type: "fire", hours: 3 },
      },
    },
  },
};

/* --- unimported: nothing stated -------------------------------------------- */
ok("an unimported table reads as nothing, and says so", () => {
  const fx = weatherEffects(["foggy", "rainy"], { terrain: "barrens" });
  assert.equal(fx.ok, false);
  assert.equal(throwPenalty(fx, "searching"), 0);
  assert.equal(fx.visibility.feet, null);
  assert.equal(fx.lines.length, 0);
  assert.equal(weatherEffectsReady(), false);
});

registerTable(SAMPLE, { priority: PRIORITY.WORLD, source: "test" });

/* --- the merge ------------------------------------------------------------- */
ok("a clear day states nothing", () => {
  const fx = weatherEffects([], { terrain: "grassland" });
  assert.equal(fx.ok, true);
  assert.deepEqual(fx.throws, {});
  assert.equal(fx.visibility.feet, null);
  assert.equal(fx.visibility.factor, 1);
  assert.equal(fx.lines.length, 0);
});

ok("penalties from two conditions sum, with their parts kept", () => {
  const fx = weatherEffects(["foggy", "rainy"]);
  assert.equal(throwPenalty(fx, "searching"), -4);
  assert.deepEqual(fx.throws.searching.parts, [{ key: "foggy", value: -3 }, { key: "rainy", value: -1 }]);
  assert.equal(throwPenalty(fx, "navigation"), -3, "a throw one condition taxes keeps that one's figure");
  assert.equal(throwPenalty(fx, "missile"), -1);
  assert.equal(throwPenalty(fx, "trackingPerHour"), -3);
  assert.equal(throwPenalty(fx, "listening"), 0, "untaxed is zero, never undefined");
});

ok("the eye: the lowest ceiling and the product of the factors", () => {
  const fx = weatherEffects(["foggy", "rainy"]);
  assert.equal(fx.visibility.feet, 70);
  assert.equal(fx.visibility.factor, 0.5);
  assert.equal(fx.visibility.parts.length, 2);
});

ok("forage penalties by kind", () => {
  const fx = weatherEffects(["rainy", "sunbaked"]);
  assert.equal(foragePenalty(fx, "firewood"), -5);
  assert.equal(foragePenalty(fx, "water"), -5);
  assert.equal(foragePenalty(fx, "food"), 0);
});

ok("the dust clause applies only on the grounds it names", () => {
  const open = weatherEffects(["windy"], { terrain: "grassland" });
  assert.equal(open.dust, null);
  assert.equal(throwPenalty(open, "searching"), 0);
  assert.equal(open.visibility.feet, null);
  const bare = weatherEffects(["windy"], { terrain: "desert" });
  assert.deepEqual(bare.dust, { key: "windy", speed: 0.5 });
  assert.equal(throwPenalty(bare, "searching"), -7);
  assert.deepEqual(bare.throws.searching.parts, [{ key: "windy.dust", value: -7 }]);
  assert.equal(bare.visibility.feet, 30);
  assert.equal(throwPenalty(bare, "missile"), -1, "the wind's own clause still applies");
});

ok("the dust ceiling and a condition's own ceiling take the lowest", () => {
  const fx = weatherEffects(["foggy", "windy"], { terrain: "barrens" });
  assert.equal(fx.visibility.feet, 30);
});

ok("air speed takes the slowest stated factor", () => {
  assert.equal(weatherEffects(["windy"]).airSpeed, 0.5);
  assert.equal(weatherEffects(["rainy"]).airSpeed, null);
});

/* --- the body -------------------------------------------------------------- */
ok("a night's need takes the strictest, and remembers who asked", () => {
  const either = weatherEffects(["cold"]);
  assert.deepEqual(either.rest, { fire: true, clothing: true, both: false, keys: ["cold"] });
  const both = weatherEffects(["cold", "frigid"]);
  assert.equal(both.rest.both, true);
  assert.deepEqual(both.rest.keys, ["cold", "frigid"]);
  assert.equal(weatherEffects(["rainy"]).rest, null);
});

ok("every condition keeps its own disease week", () => {
  const fx = weatherEffects(["cold", "rainy"]);
  assert.deepEqual(fx.disease, [{ key: "cold", days: 5, pct: 3 }, { key: "rainy", days: 5, pct: 7 }]);
});

ok("frostbite and sunburn carry their figures with the condition that stated them", () => {
  const fx = weatherEffects(["cold", "sunbaked"]);
  assert.deepEqual(fx.frostbite, { key: "cold", save: "death", die: "1d3", row: "9-11" });
  assert.deepEqual(fx.sunburn, { key: "sunbaked", damage: 1, type: "fire", hours: 3 });
  assert.equal(weatherEffects(["foggy"]).frostbite, null);
});

/* --- the readout ----------------------------------------------------------- */
ok("the lines name each stated effect once, in the throw order", () => {
  const fx = weatherEffects(["foggy", "rainy", "cold"], { terrain: "hills" });
  const keys = fx.lines.map((l) => l.key);
  assert.deepEqual(keys.slice(0, 5), ["throw.searching", "throw.landSurveying", "throw.navigation", "throw.tracking", "throw.trackingPerHour"]);
  assert.ok(keys.includes("throw.missile"));
  assert.ok(keys.includes("forage.firewood"));
  assert.ok(keys.includes("visibility.feet") && keys.includes("visibility.factor"));
  assert.ok(keys.includes("rest") && keys.includes("frostbite"));
  assert.equal(fx.lines.filter((l) => l.key === "disease").length, 2, "one disease line per condition");
  assert.equal(fx.lines.find((l) => l.key === "rest").value, "either");
  assert.deepEqual(linesOf(fx), fx.lines);
});

ok("the vocabularies are the table's", () => {
  assert.ok(WEATHER_THROWS.includes("trackingPerHour") && WEATHER_FORAGE.includes("firewood"));
  assert.ok(weatherEffectsReady());
});

ok("an unknown condition key is ignored", () => {
  const fx = weatherEffects(["sideways"]);
  assert.equal(fx.ok, true);
  assert.equal(fx.lines.length, 0);
});

unregisterTable("weather", { priority: PRIORITY.WORLD });
console.log(`weather-effects: ${passed} checks passed`);
