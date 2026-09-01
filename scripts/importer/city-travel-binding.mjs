/**
 * City-travel assembly: the raw JJ (Settlement Adventures) reads → the
 * engine-shaped `cityTravel` ruledata tables acks-extras declares.
 *
 * Travelling a city is the wilderness rules at a different scale, and the
 * differences are the point: distance is counted in blocks rather than hexes,
 * the navigation throw comes every turn rather than every day, being lost is
 * a short detour a party notices at once rather than an episode, and the
 * street's encounter cadence is a grid of where-you-are against what time it
 * is. Two of those are printed as prose and the third as a real table, so
 * this step reads all three into one shape.
 *
 * `cityTravel`, NOT `settlement`: the henchmen feature already registers a
 * `settlement` document for market class, and two features writing one id
 * would have them overwrite each other. Like every binding here, no value
 * ships.
 */
import { MODULE_ID } from "./constants.mjs";
import * as services from "../lib/services.mjs";
import { hasDoc, getDoc, PRIORITY } from "../lib/tables.mjs";
import { parseCount, countFrom } from "./survival-binding.mjs";

/** The engine doc both halves agree on (acks-extras `expectTables`). */
export const CITY_TRAVEL_DOC_ID = "cityTravel";

/** Turns in an hour, for a cadence the page states in hours. */
const TURNS_PER_HOUR = 6;

/* ------------------------------------------------------------------ */
/*  Parsers                                                            */
/* ------------------------------------------------------------------ */

/** "to walk five city blocks" | "one city block" → the count. */
export function parseBlocks(text) {
  return countFrom(String(text ?? ""), /walk\s+(\S+)\s+city\s+blocks?/i);
}

/** "navigation throw of 11+" → 11. */
export function parseTarget(text) {
  const m = /throw\s+of\s+(\d+)\s*\+/i.exec(String(text ?? ""));
  return m ? Number(m[1]) : null;
}

/** "add +4 to the throw" → 4. */
export function parseSigned(text) {
  const m = /([+-]\s*\d+)/.exec(String(text ?? ""));
  return m ? Number(m[1].replace(/\s+/g, "")) : null;
}

/** The first dice expression, kept as it reads ("1d4+1"). */
export function parseDice(text) {
  const m = /(\d*\s*d\s*\d+(?:\s*[+-]\s*\d+)?)/i.exec(String(text ?? ""));
  return m ? m[1].replace(/\s+/g, "").toLowerCase() : null;
}

/**
 * The straggling ladder: "7 or more characters… reduced by 50%… 15 or more…
 * reduced by 75%" → `[{from: 7, multiplier: 0.5}, {from: 15, multiplier: 0.25}]`.
 *
 * A REDUCTION is turned into the factor it leaves, because that is what a
 * speed derivation multiplies by; carrying the reduction instead would make
 * every reader do the subtraction and one of them eventually forget.
 */
export function parseStragglingTiers(text) {
  const t = String(text ?? "").toLowerCase();
  const tiers = [];
  const re = /(\d+)\s+or\s+more\s+characters[^.]*?reduced\s+by\s+(\d+)\s*%/g;
  for (const m of t.matchAll(re)) {
    const from = Number(m[1]);
    const cut = Number(m[2]);
    if (!Number.isFinite(from) || !Number.isFinite(cut) || cut >= 100) continue;
    tiers.push({ from, multiplier: (100 - cut) / 100 });
  }
  if (!tiers.length) return null;
  tiers.sort((a, b) => a.from - b.from);
  return tiers;
}

/**
 * A street cadence in TURNS: "every hour (6 turns)", "every 30 minutes (3
 * turns)", "every day (24 hours)".
 *
 * The parenthesised turn count is preferred where the page gives one. A row
 * stated only in hours is converted, because the engine ticks in turns and a
 * mixed-unit table would compare a day against ten minutes.
 */
export function parseCadenceTurns(text) {
  const t = String(text ?? "").toLowerCase();
  const turns = /\((\d+|[a-z-]+)\s*turns?\)/.exec(t);
  if (turns) {
    const n = parseCount(turns[1]);
    if (n != null) return n;
  }
  const hours = /\((\d+|[a-z-]+)\s*hours?\)/.exec(t);
  if (hours) {
    const n = parseCount(hours[1]);
    if (n != null) return n * TURNS_PER_HOUR;
  }
  return null;
}

/** "6+" → 6. */
export function parseThrow(text) {
  const m = /(\d+)\s*\+/.exec(String(text ?? ""));
  return m ? Number(m[1]) : null;
}

/* ------------------------------------------------------------------ */
/*  Assembly                                                           */
/* ------------------------------------------------------------------ */

/**
 * Where each cadence row belongs in the engine's `<where>.<day|night>` shape.
 *
 * A row with no time of day is filed under `any`, which is how a party holed
 * up is printed: it is not a place you pass through, so day and night are the
 * same rule.
 */
const CADENCE_ROWS = Object.freeze({
  avenueDay: ["avenue", "day"],
  avenueNight: ["avenue", "night"],
  alleyDay: ["alley", "day"],
  alleyNight: ["alley", "night"],
  holedUp: ["holedUp", "any"],
});

/** The street's encounter grid, keyed the way the engine looks it up. */
export function assembleCadence(rows = {}) {
  const out = {};
  for (const [key, cells] of Object.entries(rows)) {
    const where = CADENCE_ROWS[key];
    if (!where || !cells || cells.__missing) continue;
    const everyTurns = parseCadenceTurns(cells.frequency);
    const target = parseThrow(cells.throw);
    if (everyTurns == null || target == null) continue;
    const [place, when] = where;
    out[place] = { ...(out[place] ?? {}), [when]: { everyTurns, throw: target } };
  }
  return Object.keys(out).length ? out : null;
}

/**
 * The engine tables from the raw ones. Pure — the committed tests feed it
 * invented prose and cells.
 */
export function assembleCityTravelTables(raw = {}) {
  const out = {};
  const prose = raw.pacesProse ?? {};

  const paces = {};
  const commuting = parseBlocks(prose.commuting);
  if (commuting != null) paces.commuting = { blocksPerTurn: commuting };
  const meandering = parseBlocks(prose.meandering);
  if (meandering != null) paces.meandering = { blocksPerTurn: meandering };
  if (Object.keys(paces).length) out.paces = paces;

  const navigation = {};
  // The target is stated in the commuting sentence and again where the
  // known-route modifier is; either window will do.
  const target = parseTarget(prose.commuting) ?? parseTarget(`throw of ${prose.navigation ?? ""}`);
  if (target != null) navigation.target = target;
  const known = parseSigned(prose.navigation);
  if (known != null) navigation.knownDestination = known;
  const stray = parseDice(prose.stray);
  if (stray != null) navigation.strayBlocks = stray;
  if (Object.keys(navigation).length) out.navigation = navigation;

  const tiers = parseStragglingTiers(raw.stragglingProse?.tiers);
  if (tiers) out.straggling = { tiers };

  const encounters = assembleCadence(raw.streetCadence ?? {});
  if (encounters) out.encounters = encounters;

  // What making a nuisance of yourself is worth. Kept as a positive bonus to
  // the THROW; the engine subtracts it from the target, because that is the
  // direction the rule moves in and a reader should not have to know the sign.
  const trouble = parseSigned(raw.intentProse?.trouble);
  if (trouble != null) out.encounterIntent = { trouble: Math.abs(trouble) };

  // The shift the dark puts on the incident roll — a bare figure, not a row.
  const dark = /adding\s+(\d+)\s+to\s+the\s+roll/i.exec(String(raw.afterDarkProse?.shift ?? ""));
  if (dark) out.encounterAfterDark = Number(dark[1]);

  return out;
}

/** Assemble and register, or report nothing assembled. */
export async function applyCityTravelImport() {
  const svc = services.get("ruledata-import");
  if (!svc || !hasDoc(CITY_TRAVEL_DOC_ID)) return { assembled: [] };
  const doc = getDoc(CITY_TRAVEL_DOC_ID);
  const engine = assembleCityTravelTables(doc.tables ?? {});
  if (!Object.keys(engine).length) return { assembled: [] };
  await svc.importDoc(
    { id: CITY_TRAVEL_DOC_ID, source: doc.source, tables: { ...(doc.tables ?? {}), ...engine } },
    { priority: PRIORITY.WORLD, source: MODULE_ID },
  );
  return { assembled: Object.keys(engine) };
}
