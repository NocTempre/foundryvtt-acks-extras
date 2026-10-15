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
import { seasonKeyFor } from "../scripts/formation/weather.mjs";
import { calendarDayOf } from "../scripts/lib/world-time.mjs";

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

/* --- the calendar day and the season --------------------------------------- */

ok("the calendar day is whole days of the clock, and null where there is no day length", () => {
  assert.equal(calendarDayOf(0, 86400), 0);
  assert.equal(calendarDayOf(86399, 86400), 0, "the last second of a day is still that day");
  assert.equal(calendarDayOf(86400, 86400), 1, "the boundary opens the next");
  assert.equal(calendarDayOf(5 * 7200 + 1, 7200), 5, "a calendar with a two-hour day counts its own days");
  assert.equal(calendarDayOf(-1, 86400), -1, "a clock before zero floors downward");
  assert.equal(calendarDayOf(100, 0), null, "a zero-length day is no calendar");
  assert.equal(calendarDayOf(100, undefined), null);
  assert.equal(calendarDayOf(100, NaN), null);
  assert.equal(calendarDayOf(undefined, 86400), null);
  assert.equal(calendarDayOf(Infinity, 86400), null);
});

const LABELS = { spring: "Verdant", summer: "High Sun", fall: "Harvest", winter: "Frost" };
const season = (index, name, count) => ({ index, name, count });

ok("the Judge's map wins over a name and a position", () => {
  const map = "winter, summer ,fall,spring";
  assert.equal(seasonKeyFor(season(0, "Spring", 4), { map }), "winter", "index 0 reads the first entry");
  assert.equal(seasonKeyFor(season(3, "Winter", 4), { map }), "spring");
  assert.equal(seasonKeyFor(season(1, "Anything", 6), { map }), "summer", "the map needs no matching name");
  assert.equal(seasonKeyFor(season(4, "Spring", 6), { map }), "spring", "an index the map does not reach falls to the name");
  assert.equal(seasonKeyFor(season(0, "Spring", 4), { map: "nonsense,,,," }), "spring", "an entry that is no key falls to the name");
});

ok("a season name matches a key, a localized label or the alias, as a whole word", () => {
  assert.equal(seasonKeyFor(season(2, "Early Summer", 6)), "summer");
  assert.equal(seasonKeyFor(season(5, "AUTUMN", 6)), "fall", "the alias, in any case");
  assert.equal(seasonKeyFor(season(0, "High Sun", 6), { labels: LABELS }), "summer", "a multi-word label");
  assert.equal(seasonKeyFor(season(0, "Harvest-tide", 6), { labels: LABELS }), "fall", "a label bounded by punctuation");
  assert.equal(seasonKeyFor(season(0, "Harvests", 6), { labels: LABELS }), null, "a longer word is not a match");
  assert.equal(seasonKeyFor(season(0, "Wintergreen", 6)), null, "nor is a key inside a longer word");
});

ok("a calendar of four with no recognised names takes the default calendar's order", () => {
  assert.deepEqual([0, 1, 2, 3].map((i) => seasonKeyFor(season(i, `Quarter ${i}`, 4))), ["spring", "summer", "fall", "winter"]);
  assert.equal(seasonKeyFor(season(0, "Winter", 4)), "winter", "a name beats the position");
});

ok("a calendar of six with no recognised names maps nothing, so the declared season stands", () => {
  assert.equal(seasonKeyFor(season(0, "Quarter 0", 6)), null);
  assert.equal(seasonKeyFor(season(3, "Quarter 3", 3)), null);
  assert.equal(seasonKeyFor(null), null, "no season at all");
});

console.log("\ntest-sky: all " + passed + " checks passed");
