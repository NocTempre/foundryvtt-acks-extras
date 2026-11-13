/**
 * Merchant importing (RR 124): pay a merchant to source goods from a local
 * hub or a regional hub; the wait is a roll counted in a calendar unit, and on
 * one printed result of the transit roll the goods are lost and the payment is
 * forfeit. Pure module — the engine supplies the roll, the clock and every
 * printed figure (each hub's class shift, its wait, the losing result).
 */
import { requireNumber } from "./required.mjs";

export const SECONDS_PER_DAY = 86400;
export const SECONDS_PER_WEEK = 7 * SECONDS_PER_DAY;

/**
 * The hub kinds an order can source from, each with the key of the market-rules
 * table (`availability.marketRulesProse`) that holds the wait the page prints
 * for it.
 */
export const HUBS = Object.freeze({
  local: { waitKey: "localHubWait" },
  regional: { waitKey: "regionalHubWait" },
});

/** The calendar units a printed wait can count in, in seconds. */
const WAIT_UNITS = Object.freeze({ day: SECONDS_PER_DAY, week: SECONDS_PER_WEEK });

/**
 * Read an imported wait phrase (a single dice term then a calendar unit) into
 * `{dice, unit, seconds}`. Null for anything else: a phrase that names no dice
 * term or no known unit is not a wait.
 * @param {unknown} phrase
 * @returns {{dice: string, unit: "day"|"week", seconds: number}|null}
 */
export function parseHubWait(phrase) {
  const m = /(\d+d\d+)\s*(day|week)s?\b/i.exec(String(phrase ?? ""));
  if (!m) return null;
  const unit = m[2].toLowerCase();
  return { dice: m[1].toLowerCase(), unit, seconds: WAIT_UNITS[unit] };
}

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
 * @param {number} o.roll - the placement roll, of the wait's own dice
 * @param {{dice: string, unit: string, seconds: number}} o.wait - the hub's wait (`parseHubWait`)
 * @param {number} o.lostOnRoll - the printed transit result that loses the goods
 * @param {number} o.placedTime - worldTime seconds
 * @returns {{lost:boolean, arrivalTime:number, detail:string}}
 */
export function importPlan({ roll, wait, lostOnRoll, placedTime }) {
  if (!wait || !(wait.seconds > 0)) throw new TypeError("markets rules: no printed wait for the hub");
  const lost = roll === requireNumber("lostOnRoll", lostOnRoll);
  return {
    lost,
    arrivalTime: placedTime + roll * wait.seconds,
    detail: `${wait.dice} → ${roll} ${wait.unit}s${lost ? " (lost in transit)" : ""}`,
  };
}

/** Orders due for resolution at time `t`. */
export function dueImports(imports, t) {
  return (imports ?? []).filter((o) => o.status === "ordered" && Number(o.arrivalTime) <= t);
}
