/**
 * Flight: the expedition, above the ground rather than on it.
 *
 * Sized between the land march and a voyage on purpose. It is the land
 * derivation with a factor on top — no navigation, no footing, no roads —
 * because none of those are things a flier meets.
 *
 * Four structural facts, and every figure behind them imported:
 *
 *  - **A day aloft is worth more than a day afoot.** How much more is printed.
 *  - **A partial day blends.** A creature aloft for part of the day has only
 *    that portion multiplied, so the day is a weighted mix of two speeds — the
 *    blend is arithmetic, and it is ours; the factor is not.
 *  - **Weather applies as it does on the ground, with one exception.** Wind is
 *    the exception, and it cuts flight specifically.
 *  - **A flying mount slows under load** at a threshold, not gradually: full
 *    speed up to its normal load, less beyond it, to its maximum.
 *
 * The ground below still counts: RR prints the terrain multipliers under Flight
 * Speed, so a flier meets the country it crosses. That is the `flying` mode's
 * business ([lib/movement-modes.mjs](../lib/movement-modes.mjs)) — this file
 * contributes only what flight itself is worth.
 */
import { getDoc, hasDoc } from "../lib/tables.mjs";
import { numOrNull } from "../lib/util.mjs";

/** The registered document these derivations read. */
export const FLIGHT_DOC = "flight";

/**
 * What a flying mount is carrying, as a threshold rather than a slope: at or
 * under its normal load it flies full, beyond that and up to its maximum it
 * flies slower, and past its maximum it does not fly.
 */
export const FLIGHT_LOADS = Object.freeze({
  normal: { label: "ACKS-FORMATION.flight.load.normal" },
  heavy: { label: "ACKS-FORMATION.flight.load.heavy" },
  overloaded: { label: "ACKS-FORMATION.flight.load.overloaded", grounded: true },
});

function table(key) {
  if (!hasDoc(FLIGHT_DOC)) return null;
  const t = getDoc(FLIGHT_DOC)?.tables?.[key];
  return t == null ? null : t;
}

/** Registry reads go through lib's `numOrNull`: zero and unstated differ. */
const num = numOrNull;

/**
 * The flight multiplier for a day, and the factors that made it.
 *
 * `hoursAloft` against `dayHours` is the blend: a creature aloft the whole day
 * gets the factor whole, one aloft half the day gets half of it, and one that
 * never leaves the ground gets none and is simply marching.
 *
 * Returns `{multiplier: null, missing}` when the factor was never imported —
 * a flight nobody has priced has no speed, and saying so beats doubling by a
 * number we invented.
 */
export function flightMultiplier({
  hoursAloft = 0, dayHours = 0, windy = false, load = "normal",
} = {}) {
  const spec = FLIGHT_LOADS[load] ?? FLIGHT_LOADS.normal;
  if (spec.grounded) return { multiplier: 0, parts: [{ key: "aloft.overloaded", factor: 0 }], grounded: true };

  const aloftFactor = num(table("aloftFactor"));
  if (aloftFactor == null) return { multiplier: null, missing: "aloftFactor" };

  const hours = Number(hoursAloft) || 0;
  const total = Number(dayHours) || 0;
  const share = total > 0 ? Math.max(0, Math.min(1, hours / total)) : (hours > 0 ? 1 : 0);
  // The blend: the ground portion keeps its own speed, the airborne portion
  // takes the factor. A full day aloft collapses to the factor itself.
  const blended = (1 - share) + (share * aloftFactor);
  const parts = [{ key: "aloft.share", factor: blended, share }];

  if (windy) {
    const windFactor = num(table("windFactor"));
    if (windFactor == null) return { multiplier: null, missing: "windFactor", parts };
    // `supplants` tells the mode layer this replaces the generic wind
    // condition rather than multiplying with it — RR makes wind the one
    // weather that treats a flier differently, not doubly.
    parts.push({ key: "aloft.windy", factor: windFactor, supplants: "condition.windy" });
  }
  if (load === "heavy") {
    const loadFactor = num(table("loadFactors")?.heavy);
    if (loadFactor == null) return { multiplier: null, missing: "loadFactors", parts };
    parts.push({ key: "aloft.heavy", factor: loadFactor });
  }

  const multiplier = parts.reduce((n, p) => n * p.factor, 1);
  return { multiplier, parts, share };
}

/**
 * Which load band a mount is in, given what it carries against its own two
 * figures. Both figures are the creature's, from its sheet — not printed
 * constants — so this needs no table.
 */
export function flightLoadBand({ carried = 0, normalLoad = null, maxLoad = null } = {}) {
  // `num`, not `Number` — an unstated maximum read through Number() is 0, and
  // 0 is finite, so every load would clear it and read as overloaded.
  const c = num(carried);
  const n = num(normalLoad);
  const m = num(maxLoad);
  if (c == null || n == null) return null;
  if (c <= n) return "normal";
  if (m != null && c <= m) return "heavy";
  return m != null ? "overloaded" : "heavy";
}

/** True once the registry can price a flight at all. */
export function flightReady() {
  return num(table("aloftFactor")) != null;
}
