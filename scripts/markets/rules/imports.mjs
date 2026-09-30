/**
 * Merchant importing (RR 124): pay a merchant to source goods from a local
 * hub (a larger market class, 2d6 days) or a regional hub (larger still, 2d6
 * weeks); on one printed result of the transit roll the goods are lost and the
 * payment is forfeit. Pure module — the engine supplies the 2d6 result, the
 * clock and every printed figure (each hub's class shift, the losing result).
 */
import { requireNumber } from "./required.mjs";

export const SECONDS_PER_DAY = 86400;
export const SECONDS_PER_WEEK = 7 * SECONDS_PER_DAY;

/** The hub kinds an order can source from, with the unit its 2d6 counts. */
export const HUBS = Object.freeze({
  local: { unit: "days", seconds: SECONDS_PER_DAY },
  regional: { unit: "weeks", seconds: SECONDS_PER_WEEK },
});

/** The hub's market class an order sources from (smaller number = larger). */
export function hubClass(marketClass, hubShift) {
  return Math.min(6, Math.max(1, marketClass - requireNumber("hubShift", hubShift)));
}

/**
 * Resolve an order's fate at placement time. Loss is decided NOW and stays
 * hidden until due — deterministic under later clock adjustments. A lost
 * order still carries the time the party would have expected delivery;
 * that is when the loss is revealed.
 *
 * @param {object} o
 * @param {number} o.roll2d6 - the placement roll (2–12)
 * @param {"local"|"regional"} o.hub - local counts days, regional weeks
 * @param {number} o.lostOnRoll - the printed transit result that loses the goods
 * @param {number} o.placedTime - worldTime seconds
 * @returns {{lost:boolean, arrivalTime:number, detail:string}}
 */
export function importPlan({ roll2d6, hub, lostOnRoll, placedTime }) {
  const kind = HUBS[hub];
  if (!kind) throw new TypeError(`markets rules: unknown hub "${hub}"`);
  const lost = roll2d6 === requireNumber("lostOnRoll", lostOnRoll);
  return {
    lost,
    arrivalTime: placedTime + roll2d6 * kind.seconds,
    detail: `2d6 → ${roll2d6} ${kind.unit}${lost ? " (lost in transit)" : ""}`,
  };
}

/** Orders due for resolution at time `t`. */
export function dueImports(imports, t) {
  return (imports ?? []).filter((o) => o.status === "ordered" && Number(o.arrivalTime) <= t);
}
