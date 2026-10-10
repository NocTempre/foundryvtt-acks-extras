/**
 * Weather-table assembly: the raw JJ/RR reads → the engine-shaped `weather`
 * ruledata tables acks-extras declares (its formation weather generator and
 * vehicle-speed condition factors read them via `expectTables`). The raw
 * tables keep the pages' own shapes — 27 modifier rows, compound
 * climate/season cells, captured prose windows; this step groups the rows
 * into bracket bands, splits each compound cell into its four modifiers, and
 * turns the printed words into factors and day counts — judgments the
 * recipes must not make and the reader must not repeat. Like every binding
 * here, no value ships: everything is read live from the seat's own book and
 * persists only in their world.
 */
import { MODULE_ID } from "./constants.mjs";
import * as services from "../lib/services.mjs";
import { getLayer, PRIORITY } from "../lib/tables.mjs";
import { assembledDoc } from "./produces.mjs";

/** The engine doc both halves agree on (acks-extras `expectTables`). */
export const WEATHER_DOC_ID = "weather";

/**
 * The engine tables this binding assembles, each with the raw table(s) it is
 * read from: the producer list `tools/validate-producers.mjs` checks readers
 * against, and the map `assembledDoc` cites the assembled tables by.
 */
export const PRODUCES = Object.freeze({
  [WEATHER_DOC_ID]: {
    dailyTemperatureLow: "dailyWeatherRaw",
    dailyTemperatureHigh: "dailyWeatherRaw",
    dailyPrecipitation: "dailyWeatherRaw",
    dailyWind: "dailyWeatherRaw",
    climateModifiers: "climateModifiersRaw",
    conditionSpeed: "conditionProse",
    accumulation: "accumulationProse",
    conditionEffects: "conditionEffectsProse",
  },
});

/* ------------------------------------------------------------------ */
/*  Cell parsers                                                       */
/* ------------------------------------------------------------------ */

// Band words → the engine's band keys, matched on the cell's letters alone
// (small-caps runs weld unpredictably). Longer names sit before their
// prefixes: veryChilly before chilly, veryStrong before strong.
const BAND_WORDS = [
  ["verychilly", "veryChilly"],
  ["verystrong", "veryStrong"],
  ["partlycloudy", "partlyCloudy"],
  ["mostlycloudy", "mostlyCloudy"],
  ["sweltering", "sweltering"],
  ["frigid", "frigid"],
  ["cold", "cold"],
  ["chilly", "chilly"],
  ["brisk", "brisk"],
  ["balmy", "balmy"],
  ["warm", "warm"],
  ["hot", "hot"],
  ["sunbaked", "sunbaked"],
  ["clear", "clear"],
  ["overcast", "overcast"],
  ["drizzly", "drizzly"],
  ["rainy", "rainy"],
  ["still", "still"],
  ["gentle", "gentle"],
  ["moderate", "moderate"],
  ["strong", "strong"],
  ["gale", "gale"],
];

/** "Frigid (-75 F or less)" → "frigid"; "Gale, Stormy" → "gale"; "-" → null. */
export function parseBandCell(cell) {
  const s = String(cell ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!s) return null;
  for (const [word, key] of BAND_WORDS) if (s.startsWith(word)) return key;
  return null;
}

/**
 * "T +3 (day), +0 (night), P -3, W +2" → {tDay, tNight, p, w}; the polar
 * rows print one temperature for "(day and night)". Junk → null.
 */
export function parseModifierCell(cell) {
  const s = String(cell ?? "").toLowerCase();
  const num = (re) => {
    const m = re.exec(s);
    return m ? Number(m[1].replace(/\s+/g, "")) : null;
  };
  const both = num(/([+-]\s*\d+)\s*\(\s*day\s*and\s*night\s*\)/);
  const tDay = both ?? num(/([+-]\s*\d+)\s*\(\s*day\s*\)/);
  const tNight = both ?? num(/([+-]\s*\d+)\s*\(\s*night\s*\)/);
  const p = num(/p\s*([+-]\s*\d+)/);
  const w = num(/w\s*([+-]\s*\d+)/);
  if (tDay == null || tNight == null || p == null || w == null) return null;
  return { tDay, tNight, p, w };
}

/** "…speed halved and cannot forage" → 0.5; "…quartered" → 0.25; else null. */
export function parseSpeedWord(window) {
  const s = String(window ?? "").toLowerCase();
  if (/quarter/.test(s)) return 0.25;
  if (/halv|half/.test(s)) return 0.5;
  return null;
}

const WORD_INTS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

/** "seven days of moderate…" → the count before a phrase; junk → null. */
export function parseDaysBefore(window, phraseRe) {
  const s = String(window ?? "").toLowerCase();
  const m = new RegExp(`(${Object.keys(WORD_INTS).join("|")}|\\d+)\\s*days?\\s*of\\s*${phraseRe}`).exec(s);
  if (!m) return null;
  return WORD_INTS[m[1]] ?? Number(m[1]);
}

/** "freezes in one day of cold" → the count after a verb; junk → null. */
export function parseDaysAfter(window, verbRe) {
  const s = String(window ?? "").toLowerCase();
  const m = new RegExp(`${verbRe}\\s*(${Object.keys(WORD_INTS).join("|")}|\\d+)\\s*days?`).exec(s);
  if (!m) return null;
  return WORD_INTS[m[1]] ?? Number(m[1]);
}

/* ------------------------------------------------------------------ */
/*  A condition's entry: what the sky does to throws, eye and body      */
/* ------------------------------------------------------------------ */

/** The throws a clause's subject can name, by the words that name them. */
const THROW_WORDS = [
  ["land surveying", "landSurveying"],
  ["navigation", "navigation"],
  ["searching", "searching"],
  ["tracking", "tracking"],
  ["listening", "listening"],
  ["missile", "missile"],
];

/** Ground words a dust clause names → the engine's terrain keys. */
const GROUND_WORDS = [
  ["barren", "barrens"], ["desert", "desert"], ["grassland", "grassland"], ["scrub", "scrubland"],
  ["hill", "hills"], ["forest", "forest"], ["jungle", "jungle"], ["mountain", "mountains"], ["swamp", "swamp"],
];

/** The condition names a heading can carry; the cut below keys on them. */
const CONDITION_NAMES = "frigid|cold|sweltering|moderate|drizzly|fair|flurry|foggy|rainy|snowy|sunbaked|stormy|storm|windy";

/**
 * Lowercase, straight quotes and dashes, single spaces. An inline glyph (the
 * page sets a damage type as a private-use icon) and a zero-width character
 * are dropped, so the words either side of one read as neighbours.
 */
const normalize = (text) => String(text ?? "")
  .toLowerCase()
  .replace(/[​-‍﻿-]/g, " ")
  .replace(/[‘’′]/g, "'")
  .replace(/[–—−]/g, "-")
  .replace(/\s+/g, " ")
  .trim();

/**
 * A window ends where the NEXT entry begins. A heading is the one place a
 * condition's name is printed twice running — the heading, then the entry's
 * own opening — so that pair is the cut, and a name used mid-sentence inside
 * an entry (its own, or a neighbour's named in passing) is left alone. The
 * footing section that follows the last entry opens the same way.
 */
export function cutAtNextEntry(window) {
  const s = normalize(window);
  const next = new RegExp(`\\b(?:${CONDITION_NAMES}) (?:temperatures|conditions) (?:${CONDITION_NAMES}) (?:temperatures|conditions)\\b|\\bmud and snow mud accumulates\\b`)
    .exec(s);
  return next ? s.slice(0, next.index) : s;
}

/** Sentences of an entry, split at a full stop followed by a space. */
const sentences = (text) => normalize(text).split(/(?<=[.!?])\s+/).filter(Boolean);

/**
 * Every "<subject> suffer(s) a N penalty [per hour]" clause of one sentence.
 * The subject is what the sentence said between the previous clause and
 * this one; the keys are the throws its words name, and a foraging subject
 * names what it was foraging for. A penalty is a penalty whichever way the
 * page printed its sign.
 *
 * @returns {Array<{value: number, perHour: boolean, throws: object, forage: object}>}
 */
export function parsePenaltyClauses(sentence) {
  const s = normalize(sentence);
  const re = /suffers?\s*(?:an?\s*)?([+-]?\s*\d+)\s*penalt(?:y|ies)(\s*per\s*hour)?/g;
  const out = [];
  let last = 0;
  let m;
  while ((m = re.exec(s))) {
    const subject = s.slice(last, m.index);
    const value = -Math.abs(Number(m[1].replace(/\s+/g, "")));
    const perHour = !!m[2];
    const throws = {};
    const forage = {};
    for (const [word, key] of THROW_WORDS) {
      if (!subject.includes(word)) continue;
      if (key === "tracking" && perHour) throws.trackingPerHour = value;
      else throws[key] = value;
    }
    if (/forag/.test(subject)) {
      if (/firewood/.test(subject)) forage.firewood = value;
      else if (/water/.test(subject)) forage.water = value;
    }
    out.push({ value, perHour, throws, forage });
    last = re.lastIndex;
  }
  return out;
}

/** "… reduced to 20'" → 20; "… drops to a flat 20 ft" → 20; nothing → null. */
export function parseVisibilityFeet(sentence) {
  const m = /visibility(?: distance)?\s*(?:drops|is reduced|reduced)\s*to\s*(?:a\s*flat\s*)?(\d[\d,]*)\s*(?:'|ft\b|feet)/.exec(normalize(sentence));
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

/** "… drops to half range" → 0.5; nothing → null. */
export function parseVisibilityFactor(sentence) {
  const m = /visibility(?: distance)?\s*(?:drops|is reduced|reduced)\s*to\s*(half|a third|a quarter|quarter)/.exec(normalize(sentence));
  if (!m) return null;
  return parseSpeedWord(m[1]) ?? (/third/.test(m[1]) ? 1 / 3 : null);
}

/** The ground words of "in X or Y terrain only" → terrain keys; nothing → []. */
export function parseDustTerrains(sentence) {
  const m = /\bin ([a-z ,]+?) terrain only\b/.exec(normalize(sentence));
  if (!m) return [];
  const keys = [];
  for (const word of m[1].split(/,|\bor\b|\band\b/)) {
    const w = word.trim();
    if (!w) continue;
    const hit = GROUND_WORDS.find(([stem]) => w.startsWith(stem));
    if (hit && !keys.includes(hit[1])) keys.push(hit[1]);
  }
  return keys;
}

/**
 * One condition's entry → its effects. Each sentence is read on its own,
 * so a clause that names a throw taxes only the throws its own subject
 * names; the sentence that limits itself to certain grounds becomes the
 * `dust` clause with its own figures. Two-sentence rules (the frostbite
 * save and what a failure rolls) are read across the whole entry.
 */
export function parseConditionEntry(window) {
  const entry = cutAtNextEntry(window);
  if (!entry) return null;
  const out = {};
  const throws = {};
  const forage = {};
  const merge = (into, from) => { for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v; };

  for (const sentence of sentences(entry)) {
    const dustTerrains = parseDustTerrains(sentence);
    if (dustTerrains.length) {
      const dust = { terrains: dustTerrains, throws: {} };
      for (const clause of parsePenaltyClauses(sentence)) merge(dust.throws, clause.throws);
      const feet = parseVisibilityFeet(sentence);
      if (feet != null) dust.visibilityFeet = feet;
      const speed = /\ball speeds are (\w+)/.exec(sentence);
      const factor = speed ? parseSpeedWord(speed[1]) : null;
      if (factor != null) dust.speed = factor;
      out.dust = dust;
      continue;
    }
    for (const clause of parsePenaltyClauses(sentence)) {
      merge(throws, clause.throws);
      merge(forage, clause.forage);
    }
    const feet = parseVisibilityFeet(sentence);
    if (feet != null) out.visibilityFeet = feet;
    const factor = parseVisibilityFactor(sentence);
    if (factor != null) out.visibilityFactor = factor;
    // "air speed is halved …" and "air speed in any terrain is quartered" both
    // name the factor somewhere after the words; the sentence is the window.
    const air = /\bair speed\b[^.]*?\b(halved|half|quartered|quarter)\b/.exec(sentence);
    const airFactor = air ? parseSpeedWord(air[1]) : null;
    if (airFactor != null) out.airSpeed = airFactor;
    const burn = /suffers?\s*(\d+)\s*([a-z]+)?\s*damage if they[^.]*?outdoors for\s*(\S+)\s*or more hours/.exec(sentence);
    if (burn) {
      const hours = WORD_INTS[burn[3]] ?? Number(burn[3]);
      if (Number.isFinite(hours)) out.sunburn = { damage: Number(burn[1]), type: burn[2] || null, hours };
    }
    const rest = /cannot rest[^.]*?unless (?:he|she|they) (?:has|have) (both|either)\b/.exec(sentence);
    if (rest) out.rest = { fire: true, clothing: true, both: rest[1] === "both" };
    const disease = /for (\S+) consecutive days has an? (\d+)\s*% chance of catching a disease/.exec(sentence);
    if (disease) {
      const days = WORD_INTS[disease[1]] ?? Number(disease[1]);
      if (Number.isFinite(days)) out.disease = { days, pct: Number(disease[2]) };
    }
  }
  const frost = /must make an? ([a-z]+) saving throw at the end of the day[^.]*\.\s*if the save fails,? (?:he|she|they) (?:is|are) frostbitten and must roll (\d*d\d+) on the ([\d-]+) row/
    .exec(entry);
  if (frost) out.frostbite = { save: frost[1], die: frost[2], row: frost[3] };

  if (Object.keys(throws).length) out.throws = throws;
  if (Object.keys(forage).length) out.forage = forage;
  return Object.keys(out).length ? out : null;
}

/**
 * Every captured entry → the `conditionEffects` table, keyed by the
 * recipe's condition keys. The executor keys valueBlocks by block id; the
 * blocks are flattened back to their windows first.
 */
export function assembleConditionEffects(prose) {
  if (!prose || typeof prose !== "object") return null;
  const flat = {};
  for (const [key, value] of Object.entries(prose)) {
    if (value && typeof value === "object") Object.assign(flat, value);
    else if (typeof value === "string") flat[key] = value;
  }
  const out = {};
  for (const [key, window] of Object.entries(flat)) {
    if (typeof window !== "string") continue;
    const entry = parseConditionEntry(window);
    if (entry) out[key] = entry;
  }
  return Object.keys(out).length ? out : null;
}

/* ------------------------------------------------------------------ */
/*  Assembly                                                           */
/* ------------------------------------------------------------------ */

/**
 * The 27 modifier rows of one axis column, grouped into bracket rows
 * [{min, max, key}] for the engine's `bracketRow`. Consecutive rows sharing
 * a band merge; the first band opens downward and the last upward, which is
 * exactly what the page's "or less"/"or more" rows say. Dash rows (a column
 * the modifier cannot reach) contribute nothing.
 */
export function assembleBands(rawRows, cellKey) {
  const rows = Object.entries(rawRows ?? {})
    .map(([mod, cells]) => ({ mod: Number(mod), key: parseBandCell(cells?.[cellKey]) }))
    .filter((r) => Number.isFinite(r.mod) && r.key)
    .sort((a, b) => a.mod - b.mod);
  const bands = [];
  for (const r of rows) {
    const last = bands[bands.length - 1];
    if (last && last.key === r.key && r.mod === last.max + 1) last.max = r.mod;
    else bands.push({ min: r.mod, max: r.mod, key: r.key });
  }
  if (!bands.length) return null;
  bands[0].min = null;
  bands[bands.length - 1].max = null;
  return bands;
}

/**
 * The engine tables from the raw ones. Pure — the committed tests feed it
 * invented cells. Each half assembles independently, so a partial import
 * still yields what its pages held.
 */
export function assembleWeatherTables(raw = {}) {
  const out = {};

  const daily = raw.dailyWeatherRaw;
  if (daily) {
    const low = assembleBands(daily, "tempLow");
    const high = assembleBands(daily, "tempHigh");
    const precip = assembleBands(daily, "precipitation");
    const wind = assembleBands(daily, "wind");
    if (low) out.dailyTemperatureLow = low;
    if (high) out.dailyTemperatureHigh = high;
    if (precip) out.dailyPrecipitation = precip;
    if (wind) out.dailyWind = wind;
  }

  const climates = raw.climateModifiersRaw;
  if (climates) {
    const grid = {};
    for (const [code, cells] of Object.entries(climates)) {
      const seasons = {};
      for (const season of ["winter", "spring", "summer", "fall"]) {
        const mods = parseModifierCell(cells?.[season]);
        if (mods) seasons[season] = mods;
      }
      if (Object.keys(seasons).length) grid[code] = seasons;
    }
    if (Object.keys(grid).length) out.climateModifiers = grid;
  }

  const prose = raw.conditionProse;
  if (prose) {
    // The executor keys valueBlocks results by block id (one per page);
    // flatten them back to the sentence keys. The prose keys name the page's
    // own subjects; muddy/snowbound are the engine's names for the two
    // GROUND conditions.
    const flat = { ...(prose.p277 ?? {}), ...(prose.p278 ?? {}), ...(prose.p279 ?? {}), ...prose };
    const keyMap = { frigid: "frigid", sweltering: "sweltering", foggy: "foggy", snowy: "snowy", stormy: "stormy", windy: "windy", mud: "muddy", snowGround: "snowbound" };
    const factors = {};
    for (const [proseKey, engineKey] of Object.entries(keyMap)) {
      const f = parseSpeedWord(flat[proseKey]);
      if (f != null) factors[engineKey] = f;
    }
    if (Object.keys(factors).length) out.conditionSpeed = factors;
  }

  const effects = assembleConditionEffects(raw.conditionEffectsProse);
  if (effects) out.conditionEffects = effects;

  const acc = raw.accumulationProse;
  if (acc) {
    const thresholds = {
      mudFromRainy: parseDaysBefore(acc.mudForm, "rainy"),
      mudFromDrizzly: parseDaysBefore(acc.mudForm, "drizzly"),
      mudDrySweltering: parseDaysBefore(acc.mudDry, "sweltering"),
      mudDryModerate: parseDaysBefore(acc.mudDry, "moderate"),
      mudFreeze: parseDaysAfter(acc.mudDry, "freezes\\s*in"),
      snowFromSnowy: parseDaysBefore(acc.snowForm, "snowy"),
      snowFromFlurry: parseDaysBefore(acc.snowForm, "flurry"),
      snowMeltModerate: parseDaysBefore(acc.snowMelt, "moderate"),
      snowMeltSweltering: parseDaysBefore(acc.snowMelt, "sweltering"),
    };
    const kept = Object.fromEntries(Object.entries(thresholds).filter(([, v]) => v != null));
    if (Object.keys(kept).length) out.accumulation = kept;
  }

  return out;
}

/**
 * Merge the engine-shaped tables into the imported `weather` doc — the
 * travel-binding pattern: raw tables stay beside the assembled ones, so a
 * re-import or a later recipe grows the doc instead of replacing it.
 */
export async function applyWeatherImport() {
  const svc = services.get("ruledata-import");
  const doc = getLayer(WEATHER_DOC_ID, PRIORITY.WORLD);
  if (!svc || !doc) return { assembled: [] };
  const engine = assembleWeatherTables(doc.tables ?? {});
  if (!Object.keys(engine).length) return { assembled: [] };
  await svc.importDoc(
    assembledDoc(doc, engine, PRODUCES[WEATHER_DOC_ID]),
    { priority: PRIORITY.WORLD, source: MODULE_ID },
  );
  return { assembled: Object.keys(engine) };
}
