/**
 * Searching the wild: finding what the country is hiding.
 *
 * One Wilderness Searching throw serves a party sweeping a hex, a LOST party
 * hunting for its last landmark, and a party looking for that lost party; they
 * differ only in the quarry. The target is read from an imported ladder keyed
 * by the expedition's daily distance. A search is an ancillary activity (a day
 * holds as many as the board has slots) and every search owes an encounter
 * throw.
 */
import { getDoc, hasDoc, bracketRow } from "../lib/tables.mjs";
import { numOrNull } from "../lib/util.mjs";
import { TURNS_PER_HOUR } from "./constants.mjs";

/** The registered document these derivations read. */
export const SEARCHING_DOC = "searching";

/**
 * What a party can be looking for. All three take the same throw; they differ
 * in what a success means and in whether the quarry can move.
 */
export const SEARCH_SUBJECTS = Object.freeze({
  pointOfInterest: { label: "ACKS-FORMATION.search.poi" },
  landmark: { label: "ACKS-FORMATION.search.landmark", shared: true },
  lostGroup: { label: "ACKS-FORMATION.search.lostGroup", canMove: true },
});

/**
 * How the party is looking. From the air, open country buys more throws in the
 * same time and closed canopy the same throws at a worse target: two different
 * corrections, hence a mode and not a modifier.
 */
export const SEARCH_MODES = Object.freeze({
  onFoot: { label: "ACKS-FORMATION.search.onFoot" },
  aerial: { label: "ACKS-FORMATION.search.aerial", varies: true },
});

function table(key) {
  if (!hasDoc(SEARCHING_DOC)) return null;
  return getDoc(SEARCHING_DOC)?.tables?.[key] ?? null;
}

/**
 * The target for a party covering this many miles a day, from the imported
 * bracketed ladder. Null when unimported, and for a day nobody could price.
 */
export function searchTarget(milesPerDay) {
  const rows = table("targets");
  if (!Array.isArray(rows) || !rows.length) return null;
  if (milesPerDay == null) return null;
  const miles = Number(milesPerDay);
  if (!Number.isFinite(miles)) return null;
  return numOrNull(bracketRow(rows, miles)?.target);
}

/**
 * The throw for one hour of searching.
 *
 * `movingQuarry` applies only to a quarry that can move. `tracking` is set when
 * the order holds a tracker; the registered `trackingBonus` is added, or noted
 * `trackingUnpriced` when it is missing.
 *
 * `weather` is the sky's signed modifier on the search itself and
 * `weatherTracking` its signed modifier on a held tracker's help (RR 277-279);
 * both come from `weather-effects.mjs`, and the second applies only while
 * `tracking` is set. Each nonzero figure is a `{key, value}` entry of the
 * returned `parts`, which lists every numeric contribution to `modifier`.
 */
export function searchSpec({
  milesPerDay = 0, subject = "pointOfInterest", movingQuarry = false,
  mode = "onFoot", terrain = "", specific = false, tracking = false,
  weather = 0, weatherTracking = 0,
} = {}) {
  const spec = SEARCH_SUBJECTS[subject];
  if (!spec) return { ok: false, reason: "subject" };
  if (!SEARCH_MODES[mode]) return { ok: false, reason: "mode" };
  if (milesPerDay == null) return { ok: false, missing: "expedition", subject };
  const target = searchTarget(milesPerDay);
  if (target == null) return { ok: false, missing: "targets", subject };

  let modifier = 0;
  const notes = [];
  const parts = [];
  const add = (key, value) => {
    modifier += value;
    parts.push({ key, value });
  };

  if (spec.canMove && movingQuarry) {
    const penalty = numOrNull(table("movingQuarry"));
    if (penalty == null) return { ok: false, missing: "movingQuarry", subject };
    add("movingQuarry", penalty);
    notes.push("movingQuarry");
  }

  if (specific) {
    const penalty = numOrNull(table("specificTarget"));
    if (penalty == null) return { ok: false, missing: "specificTarget", subject };
    add("specific", penalty);
    notes.push("specific");
  }

  // The throw never refuses for want of the tracking figure: it prices without it and says so.
  if (tracking) {
    const bonus = numOrNull(table("trackingBonus"));
    if (bonus == null) notes.push("trackingUnpriced");
    else {
      add("tracking", bonus);
      notes.push("tracking");
    }
  }

  // The sky taxes the look, and a tracker's help separately.
  const sky = numOrNull(weather) ?? 0;
  if (sky) add("weather", sky);
  const skyTracking = tracking ? (numOrNull(weatherTracking) ?? 0) : 0;
  if (skyTracking) add("weatherTracking", skyTracking);

  let turnsPerThrow = numOrNull(table("turnsPerThrow"));
  if (mode === "aerial") {
    const closed = table("canopyTerrains");
    if (Array.isArray(closed) && closed.includes(terrain)) {
      const penalty = numOrNull(table("canopyPenalty"));
      if (penalty == null) return { ok: false, missing: "canopyPenalty", subject };
      add("canopy", penalty);
      notes.push("canopy");
    } else {
      const faster = numOrNull(table("aerialTurnsPerThrow"));
      if (faster == null) return { ok: false, missing: "aerialTurnsPerThrow", subject };
      turnsPerThrow = faster;
      notes.push("openGround");
    }
  }
  if (turnsPerThrow == null) return { ok: false, missing: "turnsPerThrow", subject };

  return {
    ok: true, target, modifier, parts, subject, mode, notes,
    turnsPerThrow, costsHours: turnsPerThrow / TURNS_PER_HOUR, owesEncounterThrow: true,
  };
}

/**
 * How many searches a day's board can hold: the `search` slots, none on a
 * forced march.
 */
export function searchesAvailable({ slots = [], forced = false } = {}) {
  if (forced) return 0;
  return slots.filter((s) => s === "search").length;
}

/**
 * Whether a search of this hex can find anything at all.
 *
 * Separate from the throw: a caller must roll even when `present` is false, or
 * the absence of a roll would reveal that the hex is empty.
 */
export function searchOutcome({ rolled = 0, target = null, present = false } = {}) {
  if (target == null) return { found: false, reason: "unpriced" };
  const beat = Number(rolled) >= Number(target);
  if (!beat) return { found: false, reason: "missed" };
  // Beating the target on empty ground still tells the party nothing.
  return present ? { found: true } : { found: false, reason: "nothingHere" };
}

/**
 * Splitting the party to sweep a hex: each sub-party throws on its own and
 * draws its own encounters. Groups near enough to come to each other's aid
 * (`mutuallySupporting`) have not split.
 */
export function splitSearch({ groups = 1, mutuallySupporting = false } = {}) {
  const n = Math.max(1, Math.floor(Number(groups) || 1));
  if (n === 1) return { groups: 1, throws: 1, encounterThrows: 1, split: false };
  if (mutuallySupporting) {
    return { groups: 1, throws: 1, encounterThrows: 1, split: false, reason: "supporting" };
  }
  return { groups: n, throws: n, encounterThrows: n, split: true, alone: true };
}

/**
 * The Land Surveying assessment: how many places of interest a hex holds.
 *
 * Thrown SECRETLY, with three outcomes (`surveyOutcome`): the true count, a
 * false one, or nothing. The bonus is cumulative in the party's own successful
 * searches of that hex.
 *
 * `weather` is the sky's signed modifier on the survey (RR 277-279), folded
 * into `bonus`; a nonzero figure is also a `{key: "weather", value}` entry of
 * `parts`.
 */
export function surveySpec({ priorSuccesses = 0, weather = 0 } = {}) {
  const target = numOrNull(table("surveyTarget"));
  if (target == null) return { ok: false, missing: "surveyTarget" };
  const per = numOrNull(table("surveyPerSearch"));
  if (per == null) return { ok: false, missing: "surveyPerSearch" };
  const n = Math.max(0, Math.floor(Number(priorSuccesses) || 0));
  const parts = [];
  let bonus = per * n;
  const sky = numOrNull(weather) ?? 0;
  if (sky) {
    bonus += sky;
    parts.push({ key: "weather", value: sky });
  }
  return { ok: true, target, bonus, parts, priorSuccesses: n };
}

/**
 * What the surveyor concluded, and whether it is true. `natural` is the
 * unmodified die: the false reading hangs on it alone, and any other miss is silence.
 */
export function surveyOutcome({ natural = null, total = null, target = null } = {}) {
  if (target == null) return { state: "unpriced" };
  if (Number(natural) === 1) return { state: "misread", reveals: true, trustworthy: false };
  if (Number(total) >= Number(target)) return { state: "assessed", reveals: true, trustworthy: true };
  return { state: "inconclusive", reveals: false };
}

/** True once the registry can price a search. */
export function searchingReady() {
  return Array.isArray(table("targets")) && table("targets").length > 0;
}
