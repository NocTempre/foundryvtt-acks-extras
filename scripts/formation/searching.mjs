/**
 * Searching the wild: finding what the country is hiding.
 *
 * One throw serves three purposes, which is why they live together. A party
 * sweeping a hex for a lair, a LOST party hunting for the last landmark it
 * knew, and a party out looking for that lost party all make the same
 * Wilderness Searching throw — the second and third are the first with a
 * different quarry, and the book says so outright.
 *
 * The rule that surprises people, and the reason the target is not a constant:
 * **a party that covers ground finds more.** A faster expedition sweeps a
 * wider path, so its target improves as its daily distance rises. That
 * relationship is the rule; the ladder of distances and targets is printed.
 *
 * Two structural consequences worth stating because they bite:
 *
 *  - **A search costs an hour and buys one throw.** It is an ancillary
 *    activity, so a day holds only as many searches as the board has slots.
 *  - **Searching draws attention.** Every search owes an encounter throw. A
 *    lost party hunting for its landmark is not doing something safe.
 */
import { getDoc, hasDoc, bracketRow } from "../lib/tables.mjs";
import { numOrNull } from "../lib/util.mjs";

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
 * How the party is looking.
 *
 * From the air is not simply faster: over open country a flier gets MORE
 * throws in the same time, and over closed canopy it gets the same throws at a
 * worse target. Two different corrections, which is why this is a mode rather
 * than a modifier.
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
 * The target for a party covering this many miles a day.
 *
 * A bracketed ladder, so the imported rows carry their own bounds and the
 * lookup needs no arithmetic of ours. Null when unimported — a search nobody
 * has priced cannot be attempted, and inventing a target would quietly hand
 * out lairs.
 */
export function searchTarget(milesPerDay) {
  const rows = table("targets");
  if (!Array.isArray(rows) || !rows.length) return null;
  const miles = Number(milesPerDay);
  if (!Number.isFinite(miles)) return null;
  return numOrNull(bracketRow(rows, miles)?.target);
}

/**
 * The throw for one hour of searching.
 *
 * `movingQuarry` is the one modifier the rule names: a lost group that is
 * itself moving or searching is harder to find than one sitting still. Its
 * size is printed; that it applies only to a quarry that can move is not.
 */
export function searchSpec({
  milesPerDay = 0, subject = "pointOfInterest", movingQuarry = false,
  mode = "onFoot", terrain = "", specific = false,
} = {}) {
  const spec = SEARCH_SUBJECTS[subject];
  if (!spec) return { ok: false, reason: "subject" };
  if (!SEARCH_MODES[mode]) return { ok: false, reason: "mode" };
  const target = searchTarget(milesPerDay);
  if (target == null) return { ok: false, missing: "targets", subject };

  let modifier = 0;
  const notes = [];

  if (spec.canMove && movingQuarry) {
    const penalty = numOrNull(table("movingQuarry"));
    if (penalty == null) return { ok: false, missing: "movingQuarry", subject };
    modifier += penalty;
    notes.push("movingQuarry");
  }

  // Hunting ONE named place is harder than noticing whatever is there.
  if (specific) {
    const penalty = numOrNull(table("specificTarget"));
    if (penalty == null) return { ok: false, missing: "specificTarget", subject };
    modifier += penalty;
    notes.push("specific");
  }

  // A search costs an hour on the ground. From the air over open country it
  // costs less, and over canopy it costs the same but reads worse.
  let turnsPerThrow = numOrNull(table("turnsPerThrow")) ?? 6;
  if (mode === "aerial") {
    const closed = table("canopyTerrains");
    if (Array.isArray(closed) && closed.includes(terrain)) {
      const penalty = numOrNull(table("canopyPenalty"));
      if (penalty == null) return { ok: false, missing: "canopyPenalty", subject };
      modifier += penalty;
      notes.push("canopy");
    } else {
      const faster = numOrNull(table("aerialTurnsPerThrow"));
      if (faster == null) return { ok: false, missing: "aerialTurnsPerThrow", subject };
      turnsPerThrow = faster;
      notes.push("openGround");
    }
  }

  // Structural and unconditional: looking around gets you noticed.
  return {
    ok: true, target, modifier, subject, mode, notes,
    turnsPerThrow, costsHours: turnsPerThrow / 6, owesEncounterThrow: true,
  };
}

/**
 * How many searches a day's board can hold.
 *
 * A search is an ancillary activity, so this is the board's business rather
 * than the rules' — a forced march that spends every slot on marching has no
 * hours left to look around with, which is exactly the trade the day board
 * exists to make visible.
 */
export function searchesAvailable({ slots = [], forced = false } = {}) {
  if (forced) return 0;
  return slots.filter((s) => s === "search").length;
}

/**
 * Whether a search of this hex can find anything at all.
 *
 * Separate from the throw on purpose: a party can search a hex containing
 * nothing all week and never learn that it contains nothing, which is the
 * rule's own shape. A caller that skipped the throw when `present` is false
 * would leak the map through the absence of a roll.
 */
export function searchOutcome({ rolled = 0, target = null, present = false } = {}) {
  if (target == null) return { found: false, reason: "unpriced" };
  const beat = Number(rolled) >= Number(target);
  if (!beat) return { found: false, reason: "missed" };
  // Beating the target on empty ground still tells the party nothing.
  return present ? { found: true } : { found: false, reason: "nothingHere" };
}

/**
 * Splitting the party to sweep a hex faster.
 *
 * Each sub-party throws on its own AND draws its own encounters, which is the
 * whole trade: more searches, and nobody to help when one of them finds
 * something with teeth. Groups near enough to come to each other's aid have
 * not really split — they are one party searching one area — so the structure
 * refuses to pretend otherwise.
 */
export function splitSearch({ groups = 1, mutuallySupporting = false } = {}) {
  const n = Math.max(1, Math.floor(Number(groups) || 1));
  if (n === 1) return { groups: 1, throws: 1, encounterThrows: 1, split: false };
  if (mutuallySupporting) {
    // Close enough to assist is not split, whatever the marching order says.
    return { groups: 1, throws: 1, encounterThrows: 1, split: false, reason: "supporting" };
  }
  return { groups: n, throws: n, encounterThrows: n, split: true, alone: true };
}

/**
 * The Land Surveying assessment: how many places of interest a hex holds.
 *
 * Thrown SECRETLY, and it has three outcomes rather than two. A success
 * reveals the true count. An unmodified 1 reveals a FALSE one — the surveyor
 * is confidently wrong, and the party is told a number they have no reason to
 * doubt. Anything else reveals nothing at all, which is not a failure so much
 * as "not yet enough to go on".
 *
 * The bonus is cumulative in the party's own successful searches of that hex:
 * the more of the ground they have actually walked, the better the read.
 */
export function surveySpec({ priorSuccesses = 0 } = {}) {
  const target = numOrNull(table("surveyTarget"));
  if (target == null) return { ok: false, missing: "surveyTarget" };
  const per = numOrNull(table("surveyPerSearch"));
  if (per == null) return { ok: false, missing: "surveyPerSearch" };
  const n = Math.max(0, Math.floor(Number(priorSuccesses) || 0));
  return { ok: true, target, bonus: per * n, priorSuccesses: n };
}

/**
 * What the surveyor concluded, and whether it is true.
 *
 * `natural` is the unmodified die, because the false reading hangs on it and
 * on nothing else — a heavily penalised miss is silence, not a lie.
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
