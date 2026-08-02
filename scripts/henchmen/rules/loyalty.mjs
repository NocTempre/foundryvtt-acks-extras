/**
 * Loyalty & morale bookkeeping rules (RR 166-167). Pure module.
 *
 * The stored data shape is HenchmanRecord (scripts/data/henchman-record.mjs):
 *   loyalty: { start, permanents: [{time, delta, reason, note, compensated}] }
 *   morale:  { base, permanents: [...] }
 * Employer-derived pieces (CHA, effect bonuses) are computed at read time so
 * transfers between employers recalculate automatically (RR 163).
 */

/** Clamp a loyalty/morale score to the ACKS -4..+4 range. */
export function clampScore(v) {
  return Math.max(-4, Math.min(4, Math.round(v)));
}

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
 * vocabularies (config LOYALTY_REASONS / MORALE_REASONS) — a level bump is a
 * morale reason, a calamity a loyalty one.
 */
export function reasonKey(track, reason) {
  return `ACKS-HENCHMEN.${track === "morale" ? "morale" : "loyalty"}Reason.${reason}`;
}

/**
 * Effective loyalty score = start + Σ permanents + employer CHA loyalty mod
 * + employer baseLoyalty effect bonuses (Blood of Kings…), clamped -4..+4.
 * @param {object} record - HenchmanRecord-shaped plain object
 * @param {{chaLoyalty:number, baseLoyaltyBonus:number}} employer
 */
export function effectiveLoyalty(record, employer) {
  const start = Number(record?.loyalty?.start ?? 0);
  const permanents = sumPermanents(record?.loyalty?.permanents ?? []);
  return clampScore(start + permanents + (employer?.chaLoyalty ?? 0) + (employer?.baseLoyaltyBonus ?? 0));
}

/**
 * Effective morale score = base + Σ permanents (+ leader modifiers are
 * situational and applied in the roll dialog, not stored).
 */
export function effectiveMorale(record, fallbackBase = 0) {
  const base = Number(record?.morale?.base ?? fallbackBase);
  const permanents = sumPermanents(record?.morale?.permanents ?? []);
  return clampScore(base + permanents);
}

/** Permanent loyalty deltas from a loyalty-roll outcome (RR 166). */
export function loyaltyDeltaForOutcome(outcome) {
  if (outcome === "fanatic") return 1;
  if (outcome === "grudging") return -1;
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
 * Starting loyalty for a new hire.
 * @param {object} o
 * @param {number} [o.base=0] - role base (mercenary officer -2, ruffian -2,
 *   forced servitude -4, follower +2/+4 — from wages.json baseLoyalty)
 * @param {boolean} [o.elan] - rolled "Accept with élan" (+1)
 * @param {number} [o.irrefusable] - Irrefusable Offer loyaltyOnHire value (-2/0/+1)
 */
export function startingLoyalty({ base = 0, elan = false, irrefusable = null } = {}) {
  let start = base;
  if (irrefusable !== null && irrefusable !== undefined) start = irrefusable;
  if (elan) start += 1;
  return clampScore(start);
}
