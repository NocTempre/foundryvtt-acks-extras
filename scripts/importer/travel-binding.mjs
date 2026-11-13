/**
 * Travel-table assembly: the raw RR reads → the engine-shaped `travel`
 * ruledata tables acks-extras reads (its vehicle-speed derivations declare
 * them via `expectTables`). The raw tables keep the page's own grouping;
 * this step fans the terrain groups out to the terrain keys, splits the road
 * cell into its two rates, strips the throw markers, and reads the two
 * navigation bonuses out of one sentence — judgments the recipes must not
 * make and the reader must not repeat. Like every binding here, no value
 * ships: everything is read live from the seat's own book and persists only
 * in their world.
 */
import { MODULE_ID } from "./constants.mjs";
import * as services from "../lib/services.mjs";
import { getLayer, PRIORITY } from "../lib/tables.mjs";
import { assembledDoc } from "./produces.mjs";
import { parseCount } from "./survival-binding.mjs";

/** The engine doc both halves agree on (acks-extras `expectTables`). */
export const TRAVEL_DOC_ID = "travel";

/**
 * The engine tables this binding assembles, each with the raw table(s) it is
 * read from: the producer list `tools/validate-producers.mjs` checks readers
 * against, and the map `assembledDoc` cites the assembled tables by.
 */
export const PRODUCES = Object.freeze({
  [TRAVEL_DOC_ID]: {
    terrainMultipliers: "terrainGroups",
    roads: "terrainGroups",
    gettingLost: "gettingLostRaw",
    draftEquivalents: "draftSubstitutionProse",
    encounterFrequency: "encounterFrequencyRaw",
    navigationBonus: "navigationProse",
    expedition: ["expeditionRows", "expeditionProse"],
  },
});

/**
 * Which terrain keys each printed GROUP row stands for. The grouping is the
 * page's; the key list is the engine's own terrain vocabulary — matching one
 * to the other is exactly the judgment a binder owns.
 */
export const TERRAIN_GROUP_KEYS = Object.freeze({
  grasslandScrubland: ["grassland", "scrubland"],
  barrensDesertHillsForest: ["barrens", "desert", "hills", "forest"],
  jungleMountainSwamp: ["jungle", "mountains", "swamp"],
  mudSnow: ["mud", "snow"],
});

/** "×2/3" → 2/3; "×1" → 1; junk → null — never a silent zero. */
export function parseMultiplier(cell) {
  const s = String(cell ?? "");
  const frac = /×?\s*(\d+)\s*\/\s*(\d+)/.exec(s);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const whole = /×?\s*(\d+(?:\.\d+)?)/.exec(s);
  return whole ? Number(whole[1]) : null;
}

/** The road cell carries both rates: a base one, and a driver's in parens. */
export function parseRoadCell(cell) {
  const s = String(cell ?? "");
  const paren = /\(([^)]*)\)/.exec(s);
  return {
    multiplier: parseMultiplier(paren ? s.slice(0, paren.index) : s),
    drivingMultiplier: paren ? parseMultiplier(paren[1]) : null,
  };
}

/** "11+" → 11; junk → null. */
export function parseThrow(cell) {
  const m = /(\d+)\s*\+/.exec(String(cell ?? ""));
  return m ? Number(m[1]) : null;
}

/**
 * A frequency cell onto the engine's cadence kinds (acks-extras'
 * ANCILLARY_ACTIVITIES vocabulary): a per-hex cell → perHex, a per-hour
 * cell → perHour, a per-attempt or per-N-things cell → perAttempt, a
 * per-N-hours or per-N-nights cell → perPeriod with its count (JJ pp. 41, 71,
 * 471), an empty marker → null. Junk → undefined, so a cell that did not read is
 * omitted rather than silently quiet.
 */
export function parseFrequencyCell(cell) {
  // Small-caps runs weld unpredictably (the leading capital splits off the rest of the word), so the
  // match runs on the cell's characters alone.
  const s = String(cell ?? "").toLowerCase().replace(/\s+/g, "");
  if (!s) return undefined;
  if (s === "none") return null;
  let m = /onceper(\d+)-?milehex/.exec(s);
  if (m) return { kind: "perHex", mileHex: Number(m[1]) };
  if (/onceperhour/.test(s)) return { kind: "perHour" };
  m = /onceper(\d+)traps/.exec(s);
  if (m) return { kind: "perAttempt", per: Number(m[1]) };
  if (/onceperattempt/.test(s)) return { kind: "perAttempt" };
  m = /onceper(\d+)hours/.exec(s);
  if (m) return { kind: "perPeriod", hours: Number(m[1]) };
  m = /onceper(\d+)nights/.exec(s);
  if (m) return { kind: "perPeriod", nights: Number(m[1]) };
  return undefined;
}


/**
 * The draft substitutions a vehicle entry states in prose, as the share ONE
 * animal of each kind pulls against a heavy horse.
 *
 * The page says how many of a kind stand in for one heavy horse — "one ox,
 * two mules, or two medium horses" — so each printed count becomes 1/count.
 * The heavy horse itself is the unit and is never emitted: its value is the
 * unit's definition, not a figure read off a page. A kind the sentence does
 * not name is simply absent, and stays unpriced downstream.
 */
export function parseDraftSubstitutions(window) {
  const t = String(window ?? "").toLowerCase().replace(/\s+/g, " ");
  const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  const KINDS = [
    ["ox", /(?:^|[ ,])(\w+) (?:an )?ox(?:en)?\b/],
    ["mule", /(?:^|[ ,])(\w+) mules?\b/],
    ["mediumHorse", /(?:^|[ ,])(\w+) medium horses?\b/],
    ["donkey", /(?:^|[ ,])(\w+) donkeys?\b/],
  ];
  const out = {};
  for (const [kind, re] of KINDS) {
    const m = re.exec(t);
    if (!m) continue;
    const n = WORDS[m[1]] ?? Number(m[1]);
    if (Number.isFinite(n) && n > 0) out[kind] = 1 / n;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * What finding the way is worth, as `{either, both}` (RR p. 275): one sentence
 * prices holding either competence and holding both, the first signed figure
 * for one and the second for both — the reading the voyages binding makes of
 * the sea's. Magnitudes only: the reader adds them as a bonus. A figure the
 * sentence does not print is left out, and stays unpriced downstream.
 */
export function parseNavigationBonus(window) {
  const t = String(window ?? "").toLowerCase().replace(/\s+/g, " ");
  const end = t.search(/\.(?:\s|$)/);
  const sentence = end === -1 ? t : t.slice(0, end);
  const [either, both] = [...sentence.matchAll(/[-+−]\s?(\d+)/g)].map((m) => Number(m[1]));
  const out = {};
  if (either != null) out.either = either;
  if (both != null) out.both = both;
  return Object.keys(out).length ? out : null;
}

/** A count of hours a window opens with, as a positive number: a digit or a number word, then "hours". */
export function parseHours(window) {
  for (const m of String(window ?? "").toLowerCase().matchAll(/(?<![\w.,/-])([a-z]+|\d+(?:\.\d+)?)\s+hours?\b/g)) {
    const n = parseCount(m[1]);
    if (n != null && n > 0) return n;
  }
  return null;
}

/** An exploration-speed cell, "30’" → 30, or a miles cell, "6" → 6; a cell with no figure is null. */
export function parseFigure(cell) {
  const m = /^\s*(\d+(?:\.\d+)?)/.exec(String(cell ?? ""));
  const n = m ? Number(m[1]) : null;
  return n != null && n > 0 ? n : null;
}

/**
 * The feet per turn that make one mile per day: the ratio the printed
 * Expedition Speed grid holds between its first two columns. Every row that
 * read must give the same ratio, and at least two must have read; a grid that
 * disagrees with itself was misread and gives nothing, never an average.
 */
export function feetPerMilePerDay(rows) {
  const ratios = Object.values(rows ?? {})
    .map((row) => [parseFigure(row?.feet), parseFigure(row?.miles)])
    .filter(([feet, miles]) => feet != null && miles != null)
    .map(([feet, miles]) => feet / miles);
  if (ratios.length < 2) return null;
  return ratios.every((r) => Math.abs(r - ratios[0]) < 1e-9) ? ratios[0] : null;
}

/**
 * The expedition figures (RR p. 272): the feet-to-miles ratio from the grid,
 * the hours of the dedicated, forced and ancillary days from the sentences
 * that state them, and the wilderness scale of combat and running speed.
 * Each is read on its own, so a window that drifted costs its figure and
 * nothing beside it. A pace's multiplier is not read: it is that pace's hours
 * over the dedicated day's, which the reader derives.
 * @returns {{feetPerMilePerDay?: number, dedicatedHours?: number, forcedHours?: number,
 *   ancillaryHours?: number, wildernessFactor?: number}}
 */
export function assembleExpedition(raw = {}) {
  const out = {};
  const put = (key, value) => {
    if (value != null) out[key] = value;
  };
  put("feetPerMilePerDay", feetPerMilePerDay(raw.expeditionRows));
  const prose = raw.expeditionProse ?? {};
  put("dedicatedHours", parseHours(prose.dedicatedDay));
  put("forcedHours", parseHours(prose.forcedDay));
  put("ancillaryHours", parseHours(prose.ancillaryDay));
  const factor = Number(prose.wildernessScale);
  put("wildernessFactor", Number.isFinite(factor) && factor > 0 ? factor : null);
  return out;
}

/**
 * The engine tables from the raw ones. Pure — the committed tests feed it
 * invented cells.
 *
 * `roads`: RR prints ONE road rate; the earthen-road-in-rain washout is
 * ch. 6 prose, so the earth row alone carries `ineffectiveIf: ["raining"]`.
 * The Judge's screen refines roads per kind (gravel, paved, their own null
 * conditions); that recipe REPLACES this whole table when it lands, which is
 * exactly how the registry's per-table merge behaves.
 */
export function assembleTravelTables(raw = {}) {
  const out = {};
  const groups = raw.terrainGroups;
  if (groups) {
    const terrainMultipliers = {};
    for (const [groupKey, keys] of Object.entries(TERRAIN_GROUP_KEYS)) {
      const v = parseMultiplier(groups[groupKey]?.multiplier);
      if (v != null) for (const k of keys) terrainMultipliers[k] = v;
    }
    if (Object.keys(terrainMultipliers).length) out.terrainMultipliers = terrainMultipliers;
    const road = parseRoadCell(groups.road?.multiplier);
    if (road.multiplier != null) {
      const row = (ineffectiveIf) => ({
        multiplier: road.multiplier,
        ...(road.drivingMultiplier != null ? { drivingMultiplier: road.drivingMultiplier } : {}),
        ineffectiveIf,
      });
      out.roads = { earth: row(["raining"]), gravel: row([]), paved: row([]) };
    }
  }
  const lost = raw.gettingLostRaw;
  if (lost) {
    const gettingLost = {};
    for (const [key, rowValue] of Object.entries(lost)) {
      const v = parseThrow(rowValue?.navigation);
      if (v != null) gettingLost[key] = v;
    }
    if (Object.keys(gettingLost).length) out.gettingLost = gettingLost;
  }
  const subs = parseDraftSubstitutions(raw.draftSubstitutionProse?.substitutions);
  if (subs) out.draftEquivalents = subs;

  const nav = parseNavigationBonus(raw.navigationProse?.competence);
  if (nav) out.navigationBonus = nav;

  const freq = raw.encounterFrequencyRaw;
  if (freq) {
    const encounterFrequency = {};
    for (const [activity, cells] of Object.entries(freq)) {
      const row = {};
      for (const territory of ["civilized", "borderlands", "outlands", "unsettled"]) {
        const v = parseFrequencyCell(cells?.[territory]);
        if (v !== undefined) row[territory] = v;
      }
      if (Object.keys(row).length) encounterFrequency[activity] = row;
    }
    if (Object.keys(encounterFrequency).length) out.encounterFrequency = encounterFrequency;
  }

  const expedition = assembleExpedition(raw);
  if (Object.keys(expedition).length) out.expedition = expedition;
  return out;
}

/**
 * Merge the engine-shaped tables into the imported `travel` doc — the
 * builder-binding pattern: raw tables stay beside the assembled ones, so a
 * re-import or a later recipe grows the doc instead of replacing it.
 */
export async function applyTravelImport() {
  const svc = services.get("ruledata-import");
  const doc = getLayer(TRAVEL_DOC_ID, PRIORITY.WORLD);
  if (!svc || !doc) return { assembled: [] };
  const engine = assembleTravelTables(doc.tables ?? {});
  if (!Object.keys(engine).length) return { assembled: [] };
  await svc.importDoc(
    assembledDoc(doc, engine, PRODUCES[TRAVEL_DOC_ID]),
    { priority: PRIORITY.WORLD, source: MODULE_ID },
  );
  return { assembled: Object.keys(engine) };
}
