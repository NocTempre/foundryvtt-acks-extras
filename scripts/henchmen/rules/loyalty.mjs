/**
 * Loyalty & morale bookkeeping rules (RR 166-167). Pure module.
 *
 * The stored data shape is HenchmanRecord (scripts/data/henchman-record.mjs):
 *   loyalty: { start, permanents: [{time, delta, reason, note, compensated}] }
 *   morale:  { base, permanents: [...] }
 * Employer-derived pieces (CHA, effect bonuses) are computed at read time so
 * transfers between employers recalculate automatically (RR 163).
 */
import { optTable } from "./tables.mjs";
import { outcomeTableFromBands } from "./bulk-offer.mjs";

/** Hireling Loyalty's results worst first, in the throw's outcome vocabulary. */
export const HIRELING_LOYALTY_OUTCOMES = Object.freeze(["hostility", "resignation", "grudging", "loyal", "fanatic"]);

/**
 * The Hireling Loyalty outcome table (`outcomeFromTable`'s shape) made from
 * the Judge's imported result column (`influence.hirelingLoyalty`, RR 166), the
 * one the influence-hosted loyalty page reads, with the page's natural-roll
 * clamps naming their rungs. Null until the column is imported.
 */
export function hirelingLoyaltyOutcomes() {
  const table = outcomeTableFromBands(optTable("influence", "hirelingLoyalty")?.bands, HIRELING_LOYALTY_OUTCOMES);
  return table && { ...table, naturalClamps: { natural2: { noBetterThan: "resignation" }, natural12: { noWorseThan: "loyal" } } };
}

/**
 * The Hireling Loyalty roll's figure per level of apparent difference
 * (RR 168), read from the Judge's imported `influence.apparentLevel` table,
 * the one the influence-hosted loyalty page reads. Null until imported; a
 * blank or non-integer figure is unread.
 */
export function apparentLevelPenalty() {
  const perLevel = optTable("influence", "apparentLevel")?.perLevel;
  return Number.isInteger(perLevel) ? perLevel : null;
}

/**
 * The permanent loyalty an employer pays to insist on an order a hireling
 * refused (RR 167), as the positive count the page prints, read from the
 * Judge's imported `morale.hirelingObedience` table, the one the
 * influence-hosted obedience page reads. Null until imported; a blank or
 * non-integer figure is unread.
 */
export function insistPenalty() {
  const penalty = optTable("morale", "hirelingObedience")?.insistPenalty;
  return Number.isInteger(penalty) && penalty >= 0 ? penalty : null;
}

/**
 * Where RR 166's loyalty changes and starting-loyalty figures arrive: the
 * Judge's imported `influence.loyaltyChanges` table. Its keys are `fanatic`
 * and `grudging` (each a signed permanent change), `elan`
 * (what an Accept with élan adds to a hire's start) and `forcedServitude` (the
 * start of a creature held against its will).
 */
export const LOYALTY_CHANGES = Object.freeze({ docId: "influence", tableId: "loyaltyChanges", cite: "RR 166" });

/** One figure of the imported loyalty-changes table, or null; a blank or non-integer figure is unread. Zero is a figure. */
export function loyaltyChange(key) {
  const figure = optTable(LOYALTY_CHANGES.docId, LOYALTY_CHANGES.tableId)?.[key];
  return Number.isInteger(figure) ? figure : null;
}

import { clampScore } from "../../lib/score-bounds.mjs";

/** The score clamp is `lib/score-bounds.mjs`'s; the rules here re-export it for their callers. */
export { clampScore };

/**
 * Whether a ledger entry still counts. RR 166 penalties apply "while
 * uncompensated": the Judge marks one `compensated` and it stops scoring
 * without leaving the ledger, so the history stays readable and the ruling
 * is reversible.
 */
export function isActivePermanent(entry) {
  return !entry?.compensated;
}

/** Σ of the deltas that still apply (compensated entries are suspended). */
export function sumPermanents(permanents = []) {
  return permanents.reduce((s, p) => (isActivePermanent(p) ? s + Number(p.delta ?? 0) : s), 0);
}

/**
 * i18n key labelling a ledger entry's reason. The two tracks have separate
 * vocabularies (`ACKS-HENCHMEN.loyaltyReason.*` / `moraleReason.*`) — a level
 * bump is a morale reason, a calamity a loyalty one.
 */
export function reasonKey(track, reason) {
  return `ACKS-HENCHMEN.${track === "morale" ? "morale" : "loyalty"}Reason.${reason}`;
}

/**
 * Effective loyalty score = start + Σ permanents + employer CHA loyalty mod
 * + employer baseLoyalty effect bonuses (Blood of Kings…), held to `bounds`.
 * @param {object} record - HenchmanRecord-shaped plain object
 * @param {{chaLoyalty:number, baseLoyaltyBonus:number}} employer
 * @param {{min?: number, max?: number}} [bounds] the hireling's loyalty field's range
 */
export function effectiveLoyalty(record, employer, bounds) {
  const start = Number(record?.loyalty?.start ?? 0);
  const permanents = sumPermanents(record?.loyalty?.permanents ?? []);
  return clampScore(start + permanents + (employer?.chaLoyalty ?? 0) + (employer?.baseLoyaltyBonus ?? 0), bounds);
}

/**
 * Effective morale score = base + Σ permanents (+ leader modifiers are
 * situational and applied in the roll dialog, not stored), held to `bounds`.
 * @param {object} record
 * @param {number} [fallbackBase] the sheet's morale, read when the record holds none
 * @param {{min?: number, max?: number}} [bounds] the hireling's morale field's range
 */
export function effectiveMorale(record, fallbackBase = 0, bounds) {
  const base = Number(record?.morale?.base ?? fallbackBase);
  const permanents = sumPermanents(record?.morale?.permanents ?? []);
  return clampScore(base + permanents, bounds);
}

/**
 * The permanent loyalty change a Hireling Loyalty result applies (RR 166): the
 * imported figure for a Grudging or Fanatic result, 0 for a result that
 * changes none, and null where the result changes loyalty but its figure is
 * not imported.
 * @returns {number|null}
 */
export function loyaltyDeltaForOutcome(outcome) {
  if (outcome === "fanatic" || outcome === "grudging") return loyaltyChange(outcome);
  return 0;
}

/** Whether a loyalty-roll outcome means the hireling leaves service. */
export function outcomeLeavesService(outcome) {
  return outcome === "hostility" || outcome === "resignation";
}

/**
 * Loyalty penalties that last only "while uncompensated" (RR 166): permanent
 * wounds critical -1, grievous -2, mortal -3; tampering-with-mortality side
 * effects moderate -1, major -2. The Judge records one from the roster
 * (reason "wound"/"tampering"), and lifts it by marking that ledger entry
 * compensated once the wound is healed or restitution is made.
 */
export const WOUND_PENALTIES = Object.freeze({
  critical: -1,
  grievous: -2,
  mortal: -3,
  tamperingModerate: -1,
  tamperingMajor: -2,
});

/** Which ledger reason a WOUND_PENALTIES key is recorded under. */
export function penaltyReason(key) {
  return String(key).startsWith("tampering") ? "tampering" : "wound";
}

/**
 * Starting loyalty for a new hire: the role's base, or the Irrefusable Offer
 * result's own start in its place, plus the élan figure.
 * @param {object} o
 * @param {number} [o.base=0] - the role's base loyalty, read from the imported tables
 * @param {number} [o.elan=0] - what an Accept with élan adds (`loyaltyChange("elan")`), 0 for any other result
 * @param {number} [o.irrefusable] - the Irrefusable Offer result's start, read from the imported table
 * @param {{min?: number, max?: number}} [o.bounds] - the hireling's loyalty field's range
 */
export function startingLoyalty({ base = 0, elan = 0, irrefusable = null, bounds } = {}) {
  let start = base;
  if (irrefusable !== null && irrefusable !== undefined) start = irrefusable;
  start += Number.isFinite(elan) ? elan : 0;
  return clampScore(start, bounds);
}
