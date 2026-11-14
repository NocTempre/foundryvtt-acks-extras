/**
 * Loyalty & morale bookkeeping rules (RR 166-167). Pure module.
 *
 * The stored data shape is HenchmanRecord (scripts/henchmen/data/henchman-record.mjs):
 *   loyalty: { start, permanents: [{time, delta, reason, note, compensated}] }
 *   morale:  { base, permanents: [...] }
 * A `start` of null is no figure; the score is then the sheet's own, or none.
 * Employer-derived pieces (CHA, effect bonuses) are computed at read time so
 * transfers between employers recalculate automatically (RR 163).
 */
import { optTable } from "./tables.mjs";
import { LOYALTY_FIGURES, blankLoyaltyCite } from "../../lib/score-bounds.mjs";
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

/** Whether the Judge's override layer supplies the insistence penalty itself. */
export function insistPenaltyIsJudges() {
  const t = globalThis.acksExtras?.lib?.tables;
  if (!t?.PRIORITY) return false;
  return t.getLayer?.("morale", t.PRIORITY.OVERRIDE)?.tables?.hirelingObedience?.insistPenalty != null;
}

/**
 * Where RR 166's loyalty changes and starting-loyalty figures arrive: the
 * Judge's imported `influence.loyaltyChanges` table. Its keys are `fanatic`
 * and `grudging` (each a signed permanent change), `levelGain` (per level
 * gained in service) and `calamity` (each a signed permanent change), `start`
 * (what a hire begins at), `elan` (what an Accept with élan adds to a hire's
 * start) and `forcedServitude` (the start of a creature held against its will).
 */
export const LOYALTY_CHANGES = LOYALTY_FIGURES;

/** One figure of the imported loyalty-changes table, or null; a blank or non-integer figure is unread. Zero is a figure. */
export function loyaltyChange(key) {
  const figure = optTable(LOYALTY_CHANGES.docId, LOYALTY_CHANGES.tableId)?.[key];
  return Number.isInteger(figure) ? figure : null;
}

/** Where a mercenary officer's starting loyalty is read: the imported `wages.baseLoyalty` table's `mercenaryOfficers` figure. */
export const OFFICER_START = Object.freeze({ docId: "wages", tableId: "baseLoyalty", cite: "RR 171" });

/**
 * The loyalty a new hire begins at and where that figure is read: a mercenary
 * officer takes `OFFICER_START`'s figure, every other hire the loyalty-changes
 * table's `start`. `figure` is null where it is not imported, and a hire then
 * has no starting loyalty (never zero). A creature held against its will starts
 * at `irrefusableStart`'s figure instead.
 * @param {{officer?: boolean}} [o]
 * @returns {{figure: number|null, docId: string, tableId: string, cite: string}}
 */
export function hireStart({ officer = false } = {}) {
  if (officer) {
    const figure = optTable(OFFICER_START.docId, OFFICER_START.tableId)?.mercenaryOfficers;
    return { figure: Number.isInteger(figure) ? figure : null, ...OFFICER_START };
  }
  return { figure: loyaltyChange("start"), ...LOYALTY_CHANGES };
}

/** The page a blank loyalty points at is `lib/score-bounds.mjs`'s; the rules here re-export it for their callers. */
export { blankLoyaltyCite };

import { clampScore } from "../../lib/score-bounds.mjs";

/** The score clamp is `lib/score-bounds.mjs`'s; the rules here re-export it for their callers. */
export { clampScore };

/**
 * Whether a ledger entry still counts. A `compensated` entry (RR 166, penalties
 * apply while uncompensated) stays in the ledger but stops scoring.
 */
export function isActivePermanent(entry) {
  return !entry?.compensated;
}

/** The sum of the deltas that still apply. */
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

/** The record's starting loyalty, or null where it holds no figure; zero is a figure. */
export function loyaltyStartOf(record) {
  const start = record?.loyalty?.start;
  return typeof start === "number" && Number.isFinite(start) ? start : null;
}

/**
 * Effective loyalty score = start + Σ permanents + employer CHA loyalty mod
 * + employer baseLoyalty effect bonuses, held to `bounds`. With no start the
 * score is the sheet's own figure as written, already the whole score, and
 * with neither it is null.
 * @param {object} record - HenchmanRecord-shaped plain object
 * @param {{chaLoyalty:number, baseLoyaltyBonus:number}} employer
 * @param {{min?: number, max?: number}} [bounds] the hireling's loyalty field's range
 * @param {number|null} [sheet] the sheet's own Loyalty field, read only when the record holds no start
 * @returns {number|null}
 */
export function effectiveLoyalty(record, employer, bounds, sheet = null) {
  const start = loyaltyStartOf(record);
  if (start === null) return typeof sheet === "number" && Number.isFinite(sheet) ? clampScore(sheet, bounds) : null;
  const permanents = sumPermanents(record?.loyalty?.permanents ?? []);
  return clampScore(start + permanents + (employer?.chaLoyalty ?? 0) + (employer?.baseLoyaltyBonus ?? 0), bounds);
}

/**
 * The starting loyalty that, under this employer and these permanents, gives a
 * hireling the score the sheet already shows: the sheet's figure less the
 * permanents still counting, the employer's Charisma and the employer's powers.
 * Null where the sheet holds no figure.
 * @param {object} record
 * @param {number|null} sheet
 * @param {{chaLoyalty?: number, baseLoyaltyBonus?: number}} [employer]
 * @returns {number|null}
 */
export function startFromSheet(record, sheet, employer) {
  if (!(typeof sheet === "number" && Number.isFinite(sheet))) return null;
  return sheet - sumPermanents(record?.loyalty?.permanents ?? []) - (employer?.chaLoyalty ?? 0) - (employer?.baseLoyaltyBonus ?? 0);
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
 * The loyalty penalties that last only while uncompensated (RR 166), by
 * permanent-wound and tampering-side-effect severity. The Judge records one
 * from the roster (reason "wound"/"tampering") and lifts it by marking that
 * ledger entry compensated.
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
 * result's own start in its place, plus the élan figure. Null where neither
 * figure was read: élan adds only to a start that was, and nothing stands in
 * for one that was not.
 * @param {object} o
 * @param {number|null} [o.base] - the role's base loyalty (`hireStart`'s figure), read from the imported tables
 * @param {number} [o.elan=0] - what an Accept with élan adds (`loyaltyChange("elan")`), 0 for any other result
 * @param {number|null} [o.irrefusable] - the Irrefusable Offer result's start, read from the imported table
 * @param {{min?: number, max?: number}} [o.bounds] - the hireling's loyalty field's range
 * @returns {number|null}
 */
export function startingLoyalty({ base = null, elan = 0, irrefusable = null, bounds } = {}) {
  const read = (v) => typeof v === "number" && Number.isFinite(v);
  const start = read(irrefusable) ? irrefusable : read(base) ? base : null;
  if (start === null) return null;
  return clampScore(start + (Number.isFinite(elan) ? elan : 0), bounds);
}
