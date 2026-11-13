/* global game */

/**
 * The four speeds a creature has, and the names the book gives them.
 *
 * ACKS measures movement at four scales, and they are not interchangeable:
 *
 *  - **combat speed** — feet per ROUND, what a fight is measured in;
 *  - **running speed** — feet per round at a sprint, scaled up outdoors from
 *    its dungeon value (RR ch. 6);
 *  - **exploration speed** — feet per TURN, the figure everything else is
 *    derived from;
 *  - **expedition speed** — MILES PER DAY, printed as a table against
 *    exploration speed and also given in hexes per day and miles per hour.
 *
 * The printed table is exactly linear, so the conversions below are
 * arithmetic rather than table lookup. See docs/lib/DECISIONS.md, "Expedition
 * speed is computed, not looked up".
 *
 * TRAVEL PACE is the other half of the same question — how a party spends
 * the day changes its expedition speed.
 *
 * **No figure ships.** The feet-to-miles ratio, each pace's hours of marching
 * and the wilderness scale of combat and running speed are printed (RR p. 272)
 * and arrive on the `travel` document's `expedition` table through the
 * importer; every reader here answers null for a figure that table does not
 * carry, and so does every speed derived from it. A pace's multiplier is not
 * a figure of its own: it is that pace's hours over the dedicated day's, which
 * is what the page prints it as.
 */
import { citeOf, expectTables, getDoc, hasDoc } from "./tables.mjs";
import { positiveFigure } from "./util.mjs";

/** The registered document the expedition figures arrive in. */
export const TRAVEL_DOC = "travel";
/** Its table: `{feetPerMilePerDay, dedicatedHours, forcedHours, ancillaryHours, wildernessFactor}`. */
export const EXPEDITION_TABLE = "expedition";

/** The keys of the `expedition` table, each a positive number when read. */
export const EXPEDITION_KEYS = Object.freeze([
  "feetPerMilePerDay", "dedicatedHours", "forcedHours", "ancillaryHours", "wildernessFactor",
]);

/** Declare the expedition table, so an import names it as missing until it lands. */
export function declareMovementTables() {
  expectTables(TRAVEL_DOC, [EXPEDITION_TABLE]);
}

/**
 * The expedition figures the world's table gives (the Judge's override over
 * the import), each null where nothing registered says. Nothing is defaulted:
 * a world with no expedition table prices no day's march.
 * @returns {Record<typeof EXPEDITION_KEYS[number], number|null>}
 */
export function expeditionFigures() {
  const row = hasDoc(TRAVEL_DOC) ? getDoc(TRAVEL_DOC)?.tables?.[EXPEDITION_TABLE] : null;
  const read = row && typeof row === "object" ? row : {};
  return Object.fromEntries(EXPEDITION_KEYS.map((key) => [key, positiveFigure(read[key])]));
}

/**
 * The page the expedition table was read from, or null when it is the Judge's
 * own or nothing is registered (`citeOf`).
 */
export function expeditionCite() {
  return citeOf(TRAVEL_DOC, EXPEDITION_TABLE);
}

/** The scales, by the book's own names. */
export const SCALES = Object.freeze({
  combat: { label: "ACKS-LIB.scale.combat", unit: "ACKS-LIB.scale.feetPerRound" },
  running: { label: "ACKS-LIB.scale.running", unit: "ACKS-LIB.scale.feetPerRound" },
  exploration: { label: "ACKS-LIB.scale.exploration", unit: "ACKS-LIB.scale.feetPerTurn" },
  expedition: { label: "ACKS-LIB.scale.expedition", unit: "ACKS-LIB.scale.milesPerDay" },
});

/**
 * How a party can spend the day (RR ch. 6, Expedition Speed): the names, and
 * the `expedition` table key that holds each one's hours of marching
 * (`hoursKey`). What each costs the character belongs to exhaustion, not here.
 */
export const TRAVEL_PACE = Object.freeze({
  dedicated: { label: "ACKS-LIB.pace.dedicated", hoursKey: "dedicatedHours" },
  forced: { label: "ACKS-LIB.pace.forced", hoursKey: "forcedHours" },
  ancillary: { label: "ACKS-LIB.pace.ancillary", hoursKey: "ancillaryHours" },
});

/**
 * What one pace marches: `hours`, and `multiplier` on the dedicated day's
 * distance, each null where the table does not say. The dedicated day is the
 * table's own basis, so its multiplier is one whatever is imported; every other
 * pace's is its hours over the dedicated day's. An unknown pace answers as the
 * dedicated one.
 * @returns {{hours: number|null, multiplier: number|null}}
 */
export function paceFigures(pace) {
  const spec = Object.hasOwn(TRAVEL_PACE, pace ?? "") ? TRAVEL_PACE[pace] : TRAVEL_PACE.dedicated;
  const figures = expeditionFigures();
  const hours = figures[spec.hoursKey];
  const multiplier = spec === TRAVEL_PACE.dedicated
    ? 1
    : hours != null && figures.dedicatedHours != null ? hours / figures.dedicatedHours : null;
  return { hours, multiplier };
}

/**
 * Expedition speed from exploration speed, at every unit the table prints.
 * Each answer is null while a figure it stands on is not imported: the miles
 * and the hexes need the feet-to-miles ratio (and the pace's hours, for a
 * pace other than the dedicated one), the miles per hour need the pace's hours
 * as well.
 *
 * @param {number} explorationFeetPerTurn
 * @param {object} [o]
 * @param {number} [o.multiplier] terrain, road and the like, already combined
 * @param {string} [o.pace] a key of TRAVEL_PACE
 * @param {number|null} [o.milesPerHex] the miles one hex of the map in use spans;
 *   without it the day is not stated in hexes
 * @returns {{milesPerDay: number|null, hexesPerDay: number|null, milesPerHour: number|null, explorationFeetPerTurn: number}}
 */
export function expeditionFrom(explorationFeetPerTurn, { multiplier = 1, pace = "dedicated", milesPerHex = null } = {}) {
  const { feetPerMilePerDay } = expeditionFigures();
  const spec = paceFigures(pace);
  const feet = Math.max(0, Number(explorationFeetPerTurn) || 0) * multiplier;
  const milesPerDay = feetPerMilePerDay != null && spec.multiplier != null
    ? (feet / feetPerMilePerDay) * spec.multiplier
    : null;
  return {
    explorationFeetPerTurn: round(feet),
    milesPerDay: milesPerDay == null ? null : round(milesPerDay),
    hexesPerDay: milesPerDay != null && milesPerHex > 0 ? round(milesPerDay / milesPerHex) : null,
    // Per hour of MARCHING, not per hour of the day — a forced march goes
    // longer, not faster, which dividing by that day's own hours keeps true.
    milesPerHour: milesPerDay != null && spec.hours != null ? round(milesPerDay / spec.hours) : null,
  };
}

/**
 * Exploration speed back out of a day's march — the table read rightwards;
 * null while the feet-to-miles ratio is not imported.
 */
export const explorationFromExpedition = (milesPerDay) => {
  const { feetPerMilePerDay } = expeditionFigures();
  return feetPerMilePerDay == null ? null : Math.max(0, Number(milesPerDay) || 0) * feetPerMilePerDay;
};

/** Combat and running speeds outdoors, where the ground is open; null while the wilderness scale is not imported. */
export const inWilderness = (feetPerRound) => {
  const { wildernessFactor } = expeditionFigures();
  return wildernessFactor == null ? null : Math.max(0, Number(feetPerRound) || 0) * wildernessFactor;
};

/** A lang string from the scale keys, or the key itself where no i18n stands. */
function scaleText(key, data) {
  const full = `ACKS-LIB.scale.${key}`;
  try {
    return game?.i18n?.has?.(full) ? game.i18n.format(full, data) : full;
  } catch {
    return full;
  }
}

/** A pace's name, localized where i18n stands. */
function paceName(pace) {
  const spec = Object.hasOwn(TRAVEL_PACE, pace ?? "") ? TRAVEL_PACE[pace] : TRAVEL_PACE.dedicated;
  try {
    return game?.i18n?.localize?.(spec.label) ?? spec.label;
  } catch {
    return spec.label;
  }
}

/**
 * The tooltip for a figure derived through `expeditionFrom`: the parts it was
 * made of, read from the world's table, and the page that table came from —
 * or, with the table not imported, that it is not. Imported parts are named
 * with their figure; a part the table does not carry is left out.
 * @param {object} [o]
 * @param {string} [o.pace] a key of TRAVEL_PACE
 * @returns {string}
 */
export function expeditionTip({ pace = "dedicated" } = {}) {
  const { feetPerMilePerDay } = expeditionFigures();
  const { hours } = paceFigures(pace);
  const parts = [];
  if (feetPerMilePerDay != null) parts.push(scaleText("tip.ratio", { feet: feetPerMilePerDay }));
  if (hours != null) parts.push(scaleText("tip.pace", { pace: paceName(pace), hours }));
  if (!parts.length) return scaleText("notImported");
  const cite = expeditionCite();
  if (cite) parts.push(cite);
  return parts.join(" · ");
}

/* Two decimals: a speed per hour is rarely whole. */
const round = (n) => Math.round(n * 100) / 100;
