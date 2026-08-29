/**
 * The sky cache: one roll per day, climate and season.
 *
 * Pure functions only — the world-backed half needs `game.settings`. What this
 * pins is the doctrine: two parties in one climate share a morning, crossing
 * into a new climate earns a new roll, and yesterday stays addressable so a
 * fronts drift has something to lean on.
 */
import assert from "node:assert/strict";
import { skyKey, dayOfKey, pruneSky, skyFrom, priorSky, SKY_CACHE_DAYS } from "../scripts/formation/sky.mjs";

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok   " + name); };

const sky = (label) => ({ ok: true, label });

ok("a key is the day, the climate and the season", () => {
  assert.equal(skyKey({ day: 12, climate: "Dfb", season: "autumn" }), "12|Dfb|autumn");
  assert.equal(dayOfKey("12|Dfb|autumn"), 12);
  assert.equal(skyKey({}), "0||", "a bare call still keys, rather than throwing");
});

ok("the same ground on the same day is ONE roll", () => {
  let cache = {};
  let calls = 0;
  const gen = () => { calls++; return sky("first"); };
  const a = skyFrom(cache, { day: 5, climate: "Cfa", season: "spring" }, gen);
  cache = a.cache;
  const b = skyFrom(cache, { day: 5, climate: "Cfa", season: "spring" }, gen);
  assert.equal(calls, 1, "the second party does not re-roll");
  assert.equal(b.cached, true);
  assert.equal(b.sky.label, "first", "both read the same morning");
});

ok("crossing into a new climate on the same day earns a new roll", () => {
  let calls = 0;
  const gen = () => { calls++; return sky("n" + calls); };
  const a = skyFrom({}, { day: 5, climate: "Cfa", season: "spring" }, gen);
  const b = skyFrom(a.cache, { day: 5, climate: "BWh", season: "spring" }, gen);
  assert.equal(calls, 2, "different ground, different weather");
  assert.equal(b.cached, false);
  // This IS the book's fast-travel allowance, and it needed no rule of its own.
  assert.notEqual(a.sky.label, b.sky.label);
});

ok("a new day earns a new roll", () => {
  let calls = 0;
  const gen = () => { calls++; return sky("d" + calls); };
  const a = skyFrom({}, { day: 5, climate: "Cfa", season: "spring" }, gen);
  skyFrom(a.cache, { day: 6, climate: "Cfa", season: "spring" }, gen);
  assert.equal(calls, 2);
});

ok("a failed generation is not cached", () => {
  const bad = skyFrom({}, { day: 5, climate: "", season: "" }, () => ({ ok: false, missing: ["climate"] }));
  assert.deepEqual(bad.cache, {}, "a miss must not poison the day");
  assert.equal(bad.cached, false);
});

ok("yesterday stays addressable for the fronts drift", () => {
  const a = skyFrom({}, { day: 5, climate: "Cfa", season: "spring" }, () => sky("day5"));
  const found = priorSky(a.cache, { day: 6, climate: "Cfa", season: "spring" });
  assert.equal(found.label, "day5");
  assert.equal(priorSky(a.cache, { day: 6, climate: "BWh", season: "spring" }), null,
    "and only for the SAME ground");
  assert.equal(priorSky(a.cache, {}), null);
});

ok("pruning keeps the window and drops what is older", () => {
  const cache = {
    "1|Cfa|spring": sky("old"),
    "40|Cfa|spring": sky("recent"),
    "70|Cfa|spring": sky("today"),
  };
  const pruned = pruneSky(cache, 70);
  assert.equal(pruned["70|Cfa|spring"].label, "today");
  assert.equal(pruned["40|Cfa|spring"].label, "recent", "inside the window");
  assert.equal(pruned["1|Cfa|spring"], undefined, "outside it");
  assert.ok(SKY_CACHE_DAYS >= 30, "the window must outlast a season's worth of drift");
});

ok("pruning with no day is a no-op rather than a wipe", () => {
  const cache = { "1|Cfa|spring": sky("keep") };
  assert.deepEqual(pruneSky(cache, undefined), cache);
});

console.log("\ntest-sky: all " + passed + " checks passed");
