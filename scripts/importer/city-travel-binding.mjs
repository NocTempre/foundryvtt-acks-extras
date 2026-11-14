/**
 * City-travel assembly: the raw JJ (Settlement Adventures) reads → the
 * engine-shaped `cityTravel` tables the formation feature declares. The paces
 * and navigation, the straggling ladder and the street's encounter cadence are
 * read from prose and one table into one shape. No value ships.
 *
 * `districtTravel` extends the same document from AX3: the time between two
 * points of interest in the same versus an adjacent district, at each pace.
 * `gateTolls` and `smuggling` are two more figures from the same AX3 page,
 * read by the gate action and the consignment service; a world that never
 * imported the page refuses rather than prices.
 *
 * The document is `cityTravel`, not `settlement`. See docs/formation/DECISIONS.md,
 * "The city's travel tables register as `cityTravel`, not `settlement`".
 */
import { MODULE_ID } from "./constants.mjs";
import * as services from "../lib/services.mjs";
import { getLayer, PRIORITY } from "../lib/tables.mjs";
import { assembledDoc } from "./produces.mjs";
import { parseCount, countFrom } from "./survival-binding.mjs";
import { parseDie } from "./formation-binding.mjs";
import { parseThrowTarget, parseTargetPlus, parseSignedClause } from "./binding-parse.mjs";

/** The engine doc both halves agree on (`expectTables`). */
export const CITY_TRAVEL_DOC_ID = "cityTravel";

/**
 * The engine tables this binding assembles, each with the raw table(s) it is
 * read from: the producer list `tools/validate-producers.mjs` checks readers
 * against, and the map `assembledDoc` cites the assembled tables by.
 */
export const PRODUCES = Object.freeze({
  [CITY_TRAVEL_DOC_ID]: {
    paces: "pacesProse",
    navigation: "pacesProse",
    straggling: "stragglingProse",
    encounters: "streetCadence",
    districtTravel: "districtProse",
    encounterIntent: "intentProse",
    encounterAfterDark: "afterDarkProse",
    dice: ["streetDieProse", "afterDarkProse"],
    gateTolls: "businessProse",
    smuggling: "businessProse",
  },
});

/** Turns in an hour, for a cadence the page states in hours. */
const TURNS_PER_HOUR = 6;

/* ------------------------------------------------------------------ */
/*  Parsers                                                            */
/* ------------------------------------------------------------------ */

/** The walk clause's block count, spelled or numeric, singular or plural → the count (JJ p. 79). */
export function parseBlocks(text) {
  return countFrom(String(text ?? ""), /walk\s+(\S+)\s+city\s+blocks?/i);
}

/** The first dice expression, spaces closed and lower-cased. */
export function parseDice(text) {
  const m = /(\d*\s*d\s*\d+(?:\s*[+-]\s*\d+)?)/i.exec(String(text ?? ""));
  return m ? m[1].replace(/\s+/g, "").toLowerCase() : null;
}

/**
 * The straggling ladder: each "N or more characters… reduced by P%" clause →
 * `{from: N, multiplier: (100 - P) / 100}`, ascending by `from`. The reduction
 * is stored as the factor it leaves, which is what a speed derivation
 * multiplies by.
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
 * A street cadence in TURNS: an hour, minute or day interval, with a
 * parenthesised turn or hour count where the page gives one (JJ p. 80). The
 * turn count is preferred; a row stated only in hours is converted, since the
 * engine ticks in turns.
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

/**
 * A bracketed travel-time clause anywhere ahead of its own district scope: a
 * parenthesised duration, then the phrase naming which districts it spans
 * (AX3 p.58). Silent on the verb between the bracket and the scope, which a
 * line-wrap hyphen can split mid-word. `[^.(]*?` excludes both the sentence
 * break and a second bracket, so a lost full stop cannot credit the previous
 * sentence's duration to this scope; an absent figure is the safe miss.
 */
const DISTRICT_CLAUSE_RE = /\(([^()]+)\)[^.(]*?\bin\s*(the\s*same\s*district|adjacent\s*districts?)/gi;

/** Every district-travel clause in `text`, keyed by scope ("same"|"adjacent"). */
function districtClauses(text) {
  const out = {};
  for (const m of String(text ?? "").matchAll(DISTRICT_CLAUSE_RE)) {
    const turns = parseCadenceTurns(`(${m[1]})`);
    if (turns == null) continue;
    const scope = /same/.test(m[2]) ? "same" : "adjacent";
    if (!(scope in out)) out[scope] = turns; // first reading per scope wins
  }
  return out;
}

/**
 * The four district-travel figures out of the whole paces paragraph: how
 * long each of the two paces takes between two points of interest in the
 * same district versus an adjacent one, in turns. The paragraph is split on
 * the meandering-speed marker (JJ p. 79), since both paces share both scope
 * phrases.
 */
export function assembleDistrictTravel(paragraph) {
  const p = String(paragraph ?? "").toLowerCase();
  if (!p) return null;
  const splitAt = p.indexOf("at meandering speed");
  const commuting = districtClauses(splitAt >= 0 ? p.slice(0, splitAt) : p);
  const meandering = districtClauses(splitAt >= 0 ? p.slice(splitAt) : "");

  const same = {};
  if (commuting.same != null) same.commuting = commuting.same;
  if (meandering.same != null) same.meandering = meandering.same;
  const adjacent = {};
  if (commuting.adjacent != null) adjacent.commuting = commuting.adjacent;
  if (meandering.adjacent != null) adjacent.meandering = meandering.adjacent;

  const out = {};
  if (Object.keys(same).length) out.same = same;
  if (Object.keys(adjacent).length) out.adjacent = adjacent;
  return Object.keys(out).length ? out : null;
}

/** A dice expression with its modifier. */
const DICE_PART = String.raw`(\d*\s*d\s*\d+(?:\s*[+-]\s*\d+)?)`;
const tidyDice = (s) => String(s).replace(/\s+/g, "").toLowerCase();
const intOf = (s) => {
  const n = Number(String(s).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

/**
 * What passing a city gate with goods costs, out of the tolls paragraph: the
 * toll's dice in gp, the stones of merchandise one throw of them covers, and
 * the customs duty's dice, a percentage of the goods' market price levied on
 * an import. The duty is read only beside the word that names it, so the
 * toll's dice can never be taken for it when the duty sentence is missing.
 * @returns {{toll: {dice: string, perStones: number}, duty?: {dicePercent: string}}|null}
 */
export function assembleGateTolls(window) {
  const t = String(window ?? "").toLowerCase();
  if (!t) return null;
  const toll = new RegExp(String.raw`${DICE_PART}\s*gp\s*per\s*([\d,]+)\s*st\b`).exec(t);
  if (!toll) return null;
  const perStones = intOf(toll[2]);
  if (!perStones) return null;
  const out = { toll: { dice: tidyDice(toll[1]), perStones } };
  const duty = new RegExp(String.raw`duty[^.]*?${DICE_PART}\s*%`).exec(t);
  if (duty) out.duty = { dicePercent: tidyDice(duty[1]) };
  return out;
}

/**
 * The syndicate's smuggling service, out of its paragraph: how much it moves
 * in a month, its fee as a percentage of the goods' value, the chance a
 * consignment is intercepted, and the dice of days before the goods reach one
 * of its warehouses. Each figure is optional in the result; a service the
 * page prices in full carries all four.
 * @returns {{loadsPerMonth?: number, feePercent?: number, interceptPercent?: number, arrivalDays?: string}|null}
 */
export function assembleSmuggling(window) {
  const t = String(window ?? "").toLowerCase();
  if (!t) return null;
  const out = {};
  const loads = /([\d,]+)\s*loads?\s*of\s*merchandise\s*per\s*month/.exec(t);
  if (loads && intOf(loads[1]) != null) out.loadsPerMonth = intOf(loads[1]);
  const fee = /fee\s*of\s*([\d,]+)\s*%/.exec(t);
  if (fee && intOf(fee[1]) != null) out.feePercent = intOf(fee[1]);
  const intercept = /([\d,]+)\s*%\s*chance/.exec(t);
  if (intercept && intOf(intercept[1]) != null) out.interceptPercent = intOf(intercept[1]);
  const days = new RegExp(String.raw`in\s*${DICE_PART}\s*days`).exec(t);
  if (days) out.arrivalDays = tidyDice(days[1]);
  return Object.keys(out).length ? out : null;
}

/* ------------------------------------------------------------------ */
/*  Assembly                                                           */
/* ------------------------------------------------------------------ */

/**
 * Where each cadence row belongs in the engine's `<where>.<day|night>` shape;
 * a row with no time of day is filed under `any`.
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
    const target = parseTargetPlus(cells.throw);
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
  // The target is stated in two windows (JJ p. 79); either will do, and both are read as they stand.
  const target = parseThrowTarget(prose.commuting) ?? parseThrowTarget(prose.navigation);
  if (target != null) navigation.target = target;
  const known = parseSignedClause(prose.navigation);
  if (known != null) navigation.knownDestination = known;
  const stray = parseDice(prose.stray);
  if (stray != null) navigation.strayBlocks = stray;
  if (Object.keys(navigation).length) out.navigation = navigation;

  const tiers = parseStragglingTiers(raw.stragglingProse?.tiers);
  if (tiers) out.straggling = { tiers };

  const encounters = assembleCadence(raw.streetCadence ?? {});
  if (encounters) out.encounters = encounters;

  const districtTravel = assembleDistrictTravel(raw.districtProse?.paragraph);
  if (districtTravel) out.districtTravel = districtTravel;

  // Kept as a positive bonus to the throw; the engine subtracts it from the target.
  const trouble = parseSignedClause(raw.intentProse?.trouble);
  if (trouble != null) out.encounterIntent = { trouble: Math.abs(trouble) };

  // The shift after dark puts on the incident roll: a bare figure, not a row.
  const dark = /adding\s+(\d+)\s+to\s+the\s+roll/i.exec(String(raw.afterDarkProse?.shift ?? ""));
  if (dark) out.encounterAfterDark = Number(dark[1]);

  // The street's encounter die and the incident list's, each left out when its window printed none.
  const dice = {};
  const street = parseDie(raw.streetDieProse?.die);
  if (street) dice.street = street;
  const incident = parseDie(raw.afterDarkProse?.die);
  if (incident) dice.incident = incident;
  if (Object.keys(dice).length) out.dice = dice;

  const gateTolls = assembleGateTolls(raw.businessProse?.tolls);
  if (gateTolls) out.gateTolls = gateTolls;
  const smuggling = assembleSmuggling(raw.businessProse?.smuggling);
  if (smuggling) out.smuggling = smuggling;

  return out;
}

/** Assemble and register, or report nothing assembled. */
export async function applyCityTravelImport() {
  const svc = services.get("ruledata-import");
  const doc = getLayer(CITY_TRAVEL_DOC_ID, PRIORITY.WORLD);
  if (!svc || !doc) return { assembled: [] };
  const engine = assembleCityTravelTables(doc.tables ?? {});
  if (!Object.keys(engine).length) return { assembled: [] };
  await svc.importDoc(
    assembledDoc(doc, engine, PRODUCES[CITY_TRAVEL_DOC_ID]),
    { priority: PRIORITY.WORLD, source: MODULE_ID },
  );
  return { assembled: Object.keys(engine) };
}
