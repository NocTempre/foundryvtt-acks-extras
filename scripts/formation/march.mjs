/**
 * What a march spends — the arithmetic of a party walking the wilderness, with
 * no Foundry in it.
 *
 * A step spends three things at once: MILES walked, HOURS those miles take at
 * the party's speed, and CADENCE UNITS — the count of encounter throws the
 * walk has earned, by crossings of the map's own hex or by every so many miles.
 * The day owns a budget in hours (`marchBudget`) and is spent when the hours
 * walked reach it (`marchIsSpent`).
 *
 * Every function returns new objects; a day record passed in is never changed,
 * and a field a legacy record lacks reads as zero. The caller (travel.mjs)
 * writes the returned day back to the formation and advances the clock by the
 * returned seconds.
 */
import { TRAVEL_PACE } from "../lib/movement-scales.mjs";

/**
 * Hours one ancillary slot (a search hour, foraging, hunting) spends. A printed
 * figure; its registration is the movement-scales pass in
 * `docs/formation/ROADMAP.md`.
 */
export const SLOT_HOURS = 1;

/**
 * Slack when comparing hours and fractions that were summed in floating point.
 * The record keeps its totals unrounded: rounding each step's share would drift
 * a day of small steps away from the budget they add up to.
 */
const EPSILON = 1e-9;

const number = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);

/**
 * The hours a day's march may spend, and the miles that is at this speed: the
 * pace's marching hours plus `travelSlots` ancillary hours, unless the pace
 * already consumes the slots. A camp day is `pace: null` with its travel slots.
 * An unknown pace marches no hours.
 * @param {object} o
 * @param {string|null} [o.pace]           a key of TRAVEL_PACE
 * @param {number} [o.travelSlots]         ancillary slots set to travel
 * @param {boolean} [o.paceConsumesSlots]  the pace already spends them
 * @param {number} [o.milesPerHour]
 * @returns {{hours: number, miles: number}}
 */
export function marchBudget({ pace = null, travelSlots = 0, paceConsumesSlots = false, milesPerHour = 0 } = {}) {
  const paceHours = Object.hasOwn(TRAVEL_PACE, pace ?? "") ? TRAVEL_PACE[pace].hours : 0;
  const slotHours = paceConsumesSlots ? 0 : Math.max(0, number(travelSlots)) * SLOT_HOURS;
  const hours = paceHours + slotHours;
  return { hours, miles: Math.round(hours * Math.max(0, number(milesPerHour)) * 100) / 100 };
}

/**
 * What counts as one encounter-cadence unit on the map in use. The table's own
 * distance (`mileHex`) is a unit of miles; where the map's hex is that same size
 * (within one percent) a counted crossing is one unit, anywhere else every
 * `mileHex` of walking is. With no table, a hex map's own cell stands in and the
 * missing table is named; a map that is not a hex grid has no cadence at all.
 * @param {object} o
 * @param {boolean} [o.isHex]        the party's scene is a hex grid
 * @param {number} [o.milesPerCell]  the scene's cell, in miles
 * @param {number|null} [o.mileHex]  the imported table's distance, in miles
 * @returns {{by: "grid"|"miles"|"none", miles: number|null, missing?: string}}
 */
export function cadenceOf({ isHex = false, milesPerCell = 0, mileHex = null } = {}) {
  const table = number(mileHex);
  const cell = number(milesPerCell);
  if (table > 0) {
    const sameSize = isHex && cell > 0 && Math.abs(cell - table) <= table * 0.01 + EPSILON;
    return { by: sameSize ? "grid" : "miles", miles: table };
  }
  if (isHex && cell > 0) return { by: "grid", miles: cell, missing: "encounterFrequency" };
  return { by: "none", miles: null, missing: "encounterFrequency" };
}

/**
 * Spend one step of the march: the miles walked, the hours they take, the whole
 * seconds the clock advances (the fraction left over is carried to the next
 * step, so a day of small steps advances exactly as far as one big one), and
 * the cadence units earned.
 * @param {object} day  the day record: `miles`, `hours`, `cadenceCarry`,
 *   `carrySeconds`, `secondsAdvanced`; any may be absent
 * @param {object} o
 * @param {number} o.miles
 * @param {number} o.milesPerHour
 * @param {{by: string, miles: number|null}} o.cadence  from `cadenceOf`
 * @param {number} [o.crossed]         hex crossings counted by this step
 * @param {number} [o.secondsPerHour]  the calendar's hour, in seconds
 * @returns {{day: object, hours: number, seconds: number, units: number}}
 */
export function spendMarch(day, { miles = 0, milesPerHour = 0, cadence, crossed = 0, secondsPerHour = 3600 } = {}) {
  const walked = Math.max(0, number(miles));
  const speed = number(milesPerHour);
  const hours = speed > 0 ? walked / speed : 0;

  const owed = hours * number(secondsPerHour) + number(day?.carrySeconds);
  const seconds = Math.floor(owed + 1e-6);
  const carrySeconds = Math.max(0, owed - seconds);

  let units = 0;
  let cadenceCarry = number(day?.cadenceCarry);
  if (cadence?.by === "grid") {
    units = Math.max(0, Math.floor(number(crossed)));
  } else if (cadence?.by === "miles" && number(cadence.miles) > 0) {
    const carried = cadenceCarry + walked;
    units = Math.floor(carried / cadence.miles + EPSILON);
    cadenceCarry = Math.max(0, carried - units * cadence.miles);
  }

  return {
    day: {
      ...day,
      miles: number(day?.miles) + walked,
      hours: number(day?.hours) + hours,
      cadenceCarry,
      carrySeconds,
      secondsAdvanced: number(day?.secondsAdvanced) + seconds,
    },
    hours,
    seconds,
    units,
  };
}

/**
 * Whether the day's march is over: the hours walked have reached the budget, or
 * the step just taken was after dusk. A day with no budget is never spent by
 * hours, so a zero budget in daylight stays open.
 * @param {object} day
 * @param {{hours: number}} budget  from `marchBudget`
 * @param {object} [o]
 * @param {boolean} [o.dark]  the step just taken was after dusk
 */
export function marchIsSpent(day, budget, { dark = false } = {}) {
  if (dark) return true;
  const allowed = number(budget?.hours);
  return allowed > 0 && number(day?.hours) >= allowed - EPSILON;
}
