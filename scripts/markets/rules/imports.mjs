/**
 * Merchant importing (RR §IV.3): pay a merchant to source goods from a
 * local hub (+1 market class, 2d6 days) or regional hub (+2, 2d6 weeks); on
 * a 12 the goods are lost in transit and the payment is forfeit. Pure
 * module — the engine supplies the 2d6 result and the clock.
 */

export const SECONDS_PER_DAY = 86400;
export const SECONDS_PER_WEEK = 7 * SECONDS_PER_DAY;

/** The hub's market class an order sources from (smaller number = larger). */
export function hubClass(marketClass, hubShift) {
  return Math.min(6, Math.max(1, marketClass - hubShift));
}

/**
 * Resolve an order's fate at placement time. Loss is decided NOW and stays
 * hidden until due — deterministic under later clock adjustments. A lost
 * order still carries the time the party would have expected delivery;
 * that is when the loss is revealed.
 *
 * @param {object} o
 * @param {number} o.roll2d6 - the placement roll (2–12)
 * @param {1|2} o.hubShift - 1 = local hub (days), 2 = regional hub (weeks)
 * @param {number} o.placedTime - worldTime seconds
 * @returns {{lost:boolean, arrivalTime:number, detail:string}}
 */
export function importPlan({ roll2d6, hubShift, placedTime }) {
  const unit = hubShift === 2 ? SECONDS_PER_WEEK : SECONDS_PER_DAY;
  const lost = roll2d6 === 12;
  return {
    lost,
    arrivalTime: placedTime + roll2d6 * unit,
    detail: `2d6 → ${roll2d6} ${hubShift === 2 ? "weeks" : "days"}${lost ? " (lost in transit)" : ""}`,
  };
}

/** Orders due for resolution at time `t`. */
export function dueImports(imports, t) {
  return (imports ?? []).filter((o) => o.status === "ordered" && Number(o.arrivalTime) <= t);
}
