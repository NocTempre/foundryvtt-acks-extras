/**
 * A vessel's own clock (RR ch. 7).
 *
 * THE WHOLE POINT: a ship's day is not a party's day. An expedition speed is
 * miles over an EIGHT-hour march, because walking is strenuous; a voyage speed
 * is miles over TWELVE hours, because crewing is not. Reading one against the
 * other silently understates a ship by half, and it is exactly the mistake a
 * single "miles per day" field invites — which is why the two live in separate
 * modules with the hour, not the day, as the thing they agree on.
 *
 * The round-the-clock rule is the sharpest illustration: a ship that sails
 * through the night covers twice the distance in a day and is not going any
 * faster while she does it.
 */
import { seaSpeeds } from "./vehicle-speed.mjs";
import { speedFactor, roundVoyage, roundCombat } from "./vessel-damage.mjs";

/** Hours a crew works a vessel in a day — not the eight a marching party walks. */
export const VOYAGE_HOURS = 12;

/** Hours in a day when sail, sea room, a navigator and a full crew allow it. */
export const ROUND_THE_CLOCK_HOURS = 24;

/** A voyage speed is a day's distance; this is the hour inside it. */
export const milesPerHour = (milesPerDay) => (Number(milesPerDay) || 0) / VOYAGE_HOURS;

/**
 * Whether this vessel may keep sailing after dark.
 *
 * All four conditions, and the rule names each for a reason: under oar the
 * rowers must sleep, in sight of land the risk is grounding, without a
 * navigator she cannot hold a course she cannot check, and short-handed there
 * is nobody to relieve the watch.
 */
export function canSailRoundTheClock({ underSail = false, openSea = false, navigator = false, fullCrew = false } = {}) {
  const missing = [];
  if (!underSail) missing.push("underSail");
  if (!openSea) missing.push("openSea");
  if (!navigator) missing.push("navigator");
  if (!fullCrew) missing.push("fullCrew");
  return { allowed: missing.length === 0, missing };
}

/**
 * A vessel's day, as it actually stands: her printed speed, less what the
 * wind, her belly, her missing hands and her broken hull take from it.
 *
 * Crew and hull do not stack — `speedFactor` has already taken the worse of
 * the two — so this applies it once, to a speed the wind has already scaled.
 *
 * @param {object} vehicle the vehicle's `system` data
 * @param {object} [o]
 * @param {string} [o.wind] a key of WIND
 * @param {boolean} [o.underSail] sailing rather than rowing
 * @param {boolean} [o.roundTheClock] sailing through the night as well
 * @returns {{milesPerDay, milesPerHour, hours, combatFeet, factor, worst, doubled, reasons}}
 */
export function voyageDay(vehicle, { wind = "moderate", underSail = true, roundTheClock = false } = {}) {
  const speeds = seaSpeeds(vehicle, { wind });
  const { factor, worst, crew, hull } = speedFactor(vehicle);

  // seaSpeeds already applied the CREW shortfall. Re-applying it here would
  // square it, so the hull is divided back out against the crew figure and
  // only the worse of the two is left standing.
  const applied = crew > 0 ? factor / crew : factor;
  const base = underSail ? speeds.voyageSail : speeds.voyageOar;
  const day = roundVoyage(base * applied) * (roundTheClock ? 2 : 1);
  const combatBase = underSail ? speeds.sail : speeds.oarCruise;

  const reasons = [...speeds.reasons];
  if (hull < 1) reasons.push({ key: "hullDamage", factor: hull });
  if (worst === "hull" && hull < crew) reasons.push({ key: "hullGoverns", factor: hull });

  return {
    milesPerDay: day,
    // The HOUR does not change when the day doubles: she sails longer, not faster.
    milesPerHour: milesPerHour(roundVoyage(base * applied)),
    hours: roundTheClock ? ROUND_THE_CLOCK_HOURS : VOYAGE_HOURS,
    combatFeet: roundCombat(combatBase * applied),
    factor,
    worst,
    doubled: roundTheClock,
    reasons,
  };
}

/**
 * A party marches eight hours and a ship works twelve, so the only honest way
 * to state one against the other is per hour.
 *
 * @param {number} vesselMilesPerDay her voyage speed
 * @param {number} partyMilesPerDay the formation's expedition speed
 */
export function compareToMarch(vesselMilesPerDay, partyMilesPerDay) {
  const MARCH_HOURS = 8;
  const ship = milesPerHour(vesselMilesPerDay);
  const march = (Number(partyMilesPerDay) || 0) / MARCH_HOURS;
  return {
    vesselPerHour: ship,
    partyPerHour: march,
    marchHours: MARCH_HOURS,
    voyageHours: VOYAGE_HOURS,
    faster: ship > march ? "vessel" : ship < march ? "party" : "equal",
  };
}

