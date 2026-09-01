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
import { hasDoc, getDoc, PRIORITY } from "../lib/tables.mjs";

/** The engine doc both halves agree on (acks-extras `expectTables`). */
export const WEATHER_DOC_ID = "weather";

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
  if (!svc || !hasDoc(WEATHER_DOC_ID)) return { assembled: [] };
  const doc = getDoc(WEATHER_DOC_ID);
  const engine = assembleWeatherTables(doc.tables ?? {});
  if (!Object.keys(engine).length) return { assembled: [] };
  await svc.importDoc(
    { id: WEATHER_DOC_ID, source: doc.source, tables: { ...(doc.tables ?? {}), ...engine } },
    { priority: PRIORITY.WORLD, source: MODULE_ID },
  );
  return { assembled: Object.keys(engine) };
}
