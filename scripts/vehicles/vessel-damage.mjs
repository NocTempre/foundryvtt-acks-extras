/**
 * What hurts a vessel, what that costs her, and what a crew can put back.
 *
 * A hull is not a big creature, and treating it as one gets three things
 * wrong at once (RR ch. 7):
 *
 *  - **most attacks cannot hurt her at all.** A man-sized or large creature
 *    swinging a sword at a warship does NOTHING. Hull damage is the business
 *    of artillery and of things far bigger than a person, and everything else
 *    is scaled down or ignored entirely;
 *  - **damage slows her**, in proportion to the hull she has lost, which makes
 *    a battered ship a slow ship rather than merely a ship with a small number
 *    on her sheet;
 *  - **structural hit points are never healed, only repaired** — by hand, by
 *    the crew, at five of them per point per turn, and only half of what she
 *    took at sea can be put back before she reaches a dock.
 *
 * The functions here are pure: they take a vessel's `system` data and return
 * what the rule says, so the sheet and any macro read the same answer and the
 * rule can be tested without a world.
 */
import { crewFraction } from "./vehicle-speed.mjs";

/**
 * How much of a hit actually reaches a hull, by what threw it.
 *
 * The scale is the rule's own and it is brutal at the bottom: a boarding party
 * hacking at the deck is not damaging the SHIP, and a rule that let it would
 * make every vessel a sack of hit points that infantry could empty.
 */
export const DAMAGE_SHARE = Object.freeze({
  /** Man-sized or large creatures: nothing at all. */
  personal: 0,
  /** Light and medium ballistae. */
  lightArtillery: 1 / 10,
  /** Huge creatures, heavy ballistae, light and medium catapults. */
  heavyArtillery: 1 / 3,
  /** All other artillery, and gigantic or colossal creatures. */
  siege: 1,
  /** Spells, against wooden structures — before any area multiplier. */
  spell: 1 / 10,
});

/** The area multiplier on a spell: its footprint measured in 25 sq ft. */
export const spellAreaFactor = (squareFeet) => Math.max(1, (Number(squareFeet) || 0) / 25);

/**
 * What a hit of `amount` actually does to a hull.
 *
 * @param {number} amount the damage rolled
 * @param {string} source a key of DAMAGE_SHARE
 * @param {object} [o]
 * @param {number} [o.areaSquareFeet] a spell's footprint, if it has one
 * @returns {{dealt: number, share: number, ignored: boolean}}
 */
export function damageToVessel(amount, source = "personal", { areaSquareFeet = 0 } = {}) {
  const share = DAMAGE_SHARE[source] ?? DAMAGE_SHARE.personal;
  const scale = source === "spell" && areaSquareFeet ? share * spellAreaFactor(areaSquareFeet) : share;
  // Rounded DOWN: a tenth of a light ballista's bolt is often nothing, and
  // that is the rule working rather than failing.
  const dealt = Math.floor(Math.max(0, Number(amount) || 0) * scale);
  return { dealt, share: scale, ignored: share === 0 };
}

/** A hull at or below zero cannot move under its own power, and sinks. */
export const isSinking = (vehicle) => (Number(vehicle?.shp?.value) || 0) <= 0 && (Number(vehicle?.shp?.max) || 0) > 0;

/** The formula for how long she stays up once holed through. */
export const SINK_FORMULA = "1d10";

/**
 * How much of her speed a vessel keeps.
 *
 * Two things slow her — dead crew and a broken hull — and the rule is explicit
 * that they are **not cumulative**: whichever is worse governs, alone. Adding
 * them would double-count a boarding action that both killed rowers and stove
 * in a strake.
 *
 * @param {object} [o]
 * @param {object[]} [o.roles] the EFFECTIVE crew rows (typed hands plus named
 *   attachments — stations.mjs `effectiveCrewRoles`), when the caller can see
 *   the attached crew this arithmetic cannot; omitted, the typed rows stand
 * @returns {{factor: number, worst: string, crew: number, hull: number}}
 */
export function speedFactor(vehicle, { roles = null } = {}) {
  const crew = crewFraction(roles ?? vehicle?.crew?.roles ?? []);
  const max = Number(vehicle?.shp?.max) || 0;
  const hull = max > 0 ? Math.max(0, Math.min(1, (Number(vehicle?.shp?.value) || 0) / max)) : 1;
  const factor = Math.min(crew, hull);
  return { factor, worst: hull < crew ? "hull" : "crew", crew, hull };
}

/** Voyage speed rounds to the nearest six miles; combat speed to thirty feet. */
export const roundVoyage = (miles) => Math.round((Number(miles) || 0) / 6) * 6;
export const roundCombat = (feet) => Math.round((Number(feet) || 0) / 30) * 30;

/**
 * What it takes to put a hull back together.
 *
 * Five crew, one turn, one point — and they can do nothing else while they do
 * it, which is why a running repair during a chase costs the oars that were
 * making the chase. Only HALF of what she took at sea can be repaired at sea;
 * the rest waits for a dock, so a long voyage accumulates damage that no
 * amount of crew-turns will clear.
 *
 * @param {number} points the structural damage standing
 * @param {number} crew how many hands are put on it
 * @param {object} [o]
 * @param {boolean} [o.atSea] true while away from a dock
 * @returns {{repairable: number, dockOnly: number, turns: number, crewPerPoint: number}}
 */
export function repairPlan(points, crew = 0, { atSea = true } = {}) {
  const standing = Math.max(0, Math.floor(Number(points) || 0));
  const repairable = atSea ? Math.floor(standing / 2) : standing;
  const gangs = Math.floor(Math.max(0, Number(crew) || 0) / CREW_PER_POINT);
  return {
    repairable,
    dockOnly: standing - repairable,
    // Turns for the hands actually assigned; no gang means it never finishes.
    turns: gangs > 0 ? Math.ceil(repairable / gangs) : Infinity,
    crewPerPoint: CREW_PER_POINT,
  };
}

/** Five hands, one turn, one point of hull. */
export const CREW_PER_POINT = 5;

