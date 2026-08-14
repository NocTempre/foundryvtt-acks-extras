/**
 * The four speeds a creature has, and the names the book gives them.
 *
 * ACKS measures movement at four scales, and they are not interchangeable —
 * quoting one where another is meant is how a party ends up marching sixty
 * miles down a dungeon corridor:
 *
 *  - **combat speed** — feet per ROUND, what a fight is measured in;
 *  - **running speed** — feet per round at a sprint. In the wilderness both of
 *    these are three times their dungeon value, the open ground being what it
 *    is (RR ch. 6);
 *  - **exploration speed** — feet per TURN, the careful dungeon pace, and the
 *    figure everything else is derived from;
 *  - **expedition speed** — MILES PER DAY, what a wilderness journey is
 *    actually planned in, printed as a table against exploration speed and
 *    also given in hexes per day and miles per hour.
 *
 * The printed table is exactly linear, so it is arithmetic here rather than
 * thirteen rows of lookup: a day's march is exploration speed over five, a
 * six-mile hex is six of those miles, and the miles-per-hour column assumes
 * the eight hours of intense marching that a dedicated travel day means.
 *
 * TRAVEL PACE is the other half of the same question. A party dedicating the
 * day gets its expedition speed; a FORCED MARCH of twelve hours multiplies it
 * by 3/2 and spends every ancillary activity to do it; a party that would
 * rather do other things can travel an hour at a time as an ancillary
 * activity, and four of those make half speed.
 */

/** Feet per turn that make one mile per day of expedition speed. */
export const FEET_PER_TURN_PER_MILE_PER_DAY = 5;

/** A wilderness hex, in miles. */
export const MILES_PER_HEX = 6;

/** Hours of intense marching in a dedicated travel day. */
export const MARCH_HOURS = 8;

/** Combat and running speeds are three times their dungeon value outdoors. */
export const WILDERNESS_FACTOR = 3;

/** The scales, by the book's own names. */
export const SCALES = Object.freeze({
  combat: { label: "ACKS-LIB.scale.combat", unit: "ACKS-LIB.scale.feetPerRound" },
  running: { label: "ACKS-LIB.scale.running", unit: "ACKS-LIB.scale.feetPerRound" },
  exploration: { label: "ACKS-LIB.scale.exploration", unit: "ACKS-LIB.scale.feetPerTurn" },
  expedition: { label: "ACKS-LIB.scale.expedition", unit: "ACKS-LIB.scale.milesPerDay" },
});

/**
 * How a party is spending the day (RR ch. 6 §Expedition Speed).
 *
 * `forced` is not free: twelve hours of marching instead of eight, and every
 * ancillary activity spent on the road. The rules for what that costs a
 * character belong to exhaustion, not here — this only carries the multiplier.
 */
export const TRAVEL_PACE = Object.freeze({
  dedicated: { label: "ACKS-LIB.pace.dedicated", multiplier: 1, hours: MARCH_HOURS },
  forced: { label: "ACKS-LIB.pace.forced", multiplier: 3 / 2, hours: 12 },
  ancillary: { label: "ACKS-LIB.pace.ancillary", multiplier: 1 / 2, hours: 4 },
});

/**
 * Expedition speed from exploration speed, at every unit the table prints.
 *
 * @param {number} explorationFeetPerTurn
 * @param {object} [o]
 * @param {number} [o.multiplier] terrain, road and the like, already combined
 * @param {string} [o.pace] a key of TRAVEL_PACE
 * @returns {{milesPerDay, hexesPerDay, milesPerHour, explorationFeetPerTurn}}
 */
export function expeditionFrom(explorationFeetPerTurn, { multiplier = 1, pace = "dedicated" } = {}) {
  const paceSpec = TRAVEL_PACE[pace] ?? TRAVEL_PACE.dedicated;
  const feet = Math.max(0, Number(explorationFeetPerTurn) || 0) * multiplier;
  const milesPerDay = (feet / FEET_PER_TURN_PER_MILE_PER_DAY) * paceSpec.multiplier;
  return {
    explorationFeetPerTurn: round(feet),
    milesPerDay: round(milesPerDay),
    hexesPerDay: round(milesPerDay / MILES_PER_HEX),
    // The printed column is miles per hour of MARCHING, so a forced march does
    // not go faster per hour — it goes for longer. Dividing the day's total by
    // that day's own hours keeps that true.
    milesPerHour: round(milesPerDay / paceSpec.hours),
  };
}

/** Exploration speed back out of a day's march — the table read rightwards. */
export const explorationFromExpedition = (milesPerDay) =>
  Math.max(0, Number(milesPerDay) || 0) * FEET_PER_TURN_PER_MILE_PER_DAY;

/** Combat and running speeds outdoors, where the ground is open. */
export const inWilderness = (feetPerRound) => Math.max(0, Number(feetPerRound) || 0) * WILDERNESS_FACTOR;

/* Two decimals: the printed table has quarters in its miles-per-hour column. */
const round = (n) => Math.round(n * 100) / 100;
