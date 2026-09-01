/**
 * Flight: the blend, the wind, and the load threshold.
 *
 * Every figure below is INVENTED — the real factors are printed and arrive
 * through the importer. What this pins is the shape: a partial day blends
 * rather than switching, wind and load compose, and an unpriced flight has no
 * speed rather than a guessed one.
 */
import assert from "node:assert/strict";
import { registerTable, unregisterTable, PRIORITY } from "../scripts/lib/tables.mjs";
import {
  FLIGHT_DOC, FLIGHT_LOADS, flightMultiplier, flightLoadBand, flightReady,
} from "../scripts/formation/flight.mjs";

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok   " + name); };

const SAMPLE = {
  id: FLIGHT_DOC,
  source: "invented",
  tables: {
    aloftFactor: 3,                 // invented — the real one is printed
    windFactor: 0.25,               // invented
    loadFactors: { heavy: 0.5 },    // invented
  },
};
const load = () => registerTable(SAMPLE, { priority: PRIORITY.WORLD, source: "test" });

ok("the load bands are a threshold, and overloading grounds you", () => {
  assert.deepEqual(Object.keys(FLIGHT_LOADS), ["normal", "heavy", "overloaded"]);
  assert.equal(FLIGHT_LOADS.overloaded.grounded, true);
  for (const spec of Object.values(FLIGHT_LOADS)) {
    assert.equal("factor" in spec, false, "a band must not ship a factor");
  }
});

ok("an unpriced flight has no speed and names the table", () => {
  unregisterTable(FLIGHT_DOC);
  assert.equal(flightReady(), false);
  const r = flightMultiplier({ hoursAloft: 8, dayHours: 8 });
  assert.equal(r.multiplier, null);
  assert.equal(r.missing, "aloftFactor");
});

ok("a full day aloft collapses to the factor itself", () => {
  unregisterTable(FLIGHT_DOC); load();
  assert.equal(flightReady(), true);
  assert.equal(flightMultiplier({ hoursAloft: 8, dayHours: 8 }).multiplier, 3);
});

ok("a day never leaving the ground is worth exactly a march", () => {
  unregisterTable(FLIGHT_DOC); load();
  assert.equal(flightMultiplier({ hoursAloft: 0, dayHours: 8 }).multiplier, 1);
});

ok("a partial day BLENDS rather than switching", () => {
  unregisterTable(FLIGHT_DOC); load();
  // Half a day aloft at ×3: half the day is worth 1, half is worth 3.
  const r = flightMultiplier({ hoursAloft: 4, dayHours: 8 });
  assert.equal(r.share, 0.5);
  assert.equal(r.multiplier, 0.5 * 1 + 0.5 * 3);
  // A quarter aloft sits proportionally between the two, never at either end.
  const q = flightMultiplier({ hoursAloft: 2, dayHours: 8 });
  assert.ok(q.multiplier > 1 && q.multiplier < 3);
});

ok("more hours aloft than the day holds is still just the whole day", () => {
  unregisterTable(FLIGHT_DOC); load();
  assert.equal(flightMultiplier({ hoursAloft: 99, dayHours: 8 }).multiplier, 3);
});

ok("wind cuts the flight, and composes with the blend", () => {
  unregisterTable(FLIGHT_DOC); load();
  const calm = flightMultiplier({ hoursAloft: 8, dayHours: 8 });
  const windy = flightMultiplier({ hoursAloft: 8, dayHours: 8, windy: true });
  assert.equal(windy.multiplier, calm.multiplier * 0.25);
  assert.deepEqual(windy.parts.map((p) => p.key), ["aloft.share", "aloft.windy"]);
});

ok("a heavy load slows it, and stacks with wind", () => {
  unregisterTable(FLIGHT_DOC); load();
  const r = flightMultiplier({ hoursAloft: 8, dayHours: 8, windy: true, load: "heavy" });
  assert.equal(r.multiplier, 3 * 0.25 * 0.5);
  assert.deepEqual(r.parts.map((p) => p.key), ["aloft.share", "aloft.windy", "aloft.heavy"]);
});

ok("an overloaded mount does not fly at all, priced or not", () => {
  unregisterTable(FLIGHT_DOC);
  const r = flightMultiplier({ hoursAloft: 8, dayHours: 8, load: "overloaded" });
  assert.equal(r.multiplier, 0, "grounded needs no table to be true");
  assert.equal(r.grounded, true);
});

ok("the load band comes from the creature's own two figures", () => {
  assert.equal(flightLoadBand({ carried: 10, normalLoad: 20, maxLoad: 40 }), "normal");
  assert.equal(flightLoadBand({ carried: 20, normalLoad: 20, maxLoad: 40 }), "normal", "at the line is still normal");
  assert.equal(flightLoadBand({ carried: 30, normalLoad: 20, maxLoad: 40 }), "heavy");
  assert.equal(flightLoadBand({ carried: 50, normalLoad: 20, maxLoad: 40 }), "overloaded");
  assert.equal(flightLoadBand({ carried: 50, normalLoad: 20 }), "heavy", "no maximum stated, no grounding");
  assert.equal(flightLoadBand({ carried: 5 }), null, "an unstated load band is unknown, not normal");
});

console.log("\ntest-flight: all " + passed + " checks passed");
