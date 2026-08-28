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
import { crewFraction, readTable, VOYAGES_DOC } from "./vehicle-speed.mjs";

/**
 * Who can hurt a hull at all — the STRUCTURAL half. A man-sized or large
 * creature does NOTHING (the zero is the rule's shape: without it every
 * vessel is a sack of hit points infantry could empty), the biggest things
 * deal everything, and the classes between are worth what the imported
 * `damageShares` table says. A spell's share scales by its footprint.
 */
export const SHARE_SOURCES = Object.freeze({
  /** Man-sized or large creatures: nothing at all — structural. */
  personal: { share: 0 },
  /** Light and medium ballistae. */
  lightArtillery: { tableKey: "lightBallista" },
  /** Huge creatures, heavy ballistae, light and medium catapults. */
  heavyArtillery: { tableKey: "heavyThird" },
  /** All other artillery, and gigantic or colossal creatures: everything. */
  siege: { share: 1 },
  /** Spells, against wooden structures — before the area multiplier. */
  spell: { tableKey: "spells", area: true },
});

/** The area multiplier on a spell: its footprint over the imported divisor. */
export function spellAreaFactor(squareFeet) {
  const divisor = Number(readTable(VOYAGES_DOC, "damageShares")?.aoeDivisor);
  if (!Number.isFinite(divisor) || divisor <= 0) return null;
  return Math.max(1, (Number(squareFeet) || 0) / divisor);
}

/**
 * What a hit of `amount` actually does to a hull.
 *
 * @param {number} amount the damage rolled
 * @param {string} source a key of SHARE_SOURCES
 * @param {object} [o]
 * @param {number} [o.areaSquareFeet] a spell's footprint, if it has one
 * @returns {{dealt, share, ignored, missing}} — `dealt` null when the
 *   share is printed and not imported: an unanswerable is not a zero.
 */
export function damageToVessel(amount, source = "personal", { areaSquareFeet = 0 } = {}) {
  const spec = SHARE_SOURCES[source] ?? SHARE_SOURCES.personal;
  const share = spec.tableKey != null ? Number(readTable(VOYAGES_DOC, "damageShares")?.[spec.tableKey]) : spec.share;
  if (!Number.isFinite(share)) return { dealt: null, share: null, ignored: false, missing: true };
  const area = spec.area && areaSquareFeet ? spellAreaFactor(areaSquareFeet) : 1;
  if (area == null) return { dealt: null, share, ignored: false, missing: true };
  const scale = share * area;
  // Rounded DOWN: a tenth of a light ballista's bolt is often nothing, and
  // that is the rule working rather than failing.
  const dealt = Math.floor(Math.max(0, Number(amount) || 0) * scale);
  return { dealt, share: scale, ignored: share === 0, missing: false };
}

/** A hull at or below zero cannot move under its own power, and sinks. */
export const isSinking = (vehicle) => (Number(vehicle?.shp?.value) || 0) <= 0 && (Number(vehicle?.shp?.max) || 0) > 0;

/** The imported formula for how long she stays up; null until imported. */
export const sinkFormula = () => readTable(VOYAGES_DOC, "damageShares")?.sinkDice ?? null;

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

/**
 * Voyage and combat speeds round to the grains the page prints, read from
 * the imported `rounding` table; unimported they round to nothing, which is
 * only ever a cosmetic difference.
 */
const grain = (key) => Number(readTable(VOYAGES_DOC, "rounding")?.[key]) || 1;
export const roundVoyage = (miles) => Math.round((Number(miles) || 0) / grain("voyageMiles")) * grain("voyageMiles");
export const roundCombat = (feet) => Math.round((Number(feet) || 0) / grain("combatFeet")) * grain("combatFeet");

/**
 * What it takes to put a hull back together.
 *
 * A gang of hands puts back one point a turn — and they can do nothing else
 * while they do it, which is why a running repair during a chase costs the
 * oars that were making the chase. Only a printed FRACTION of what she took
 * at sea can be repaired at sea; the rest waits for a dock, so a long voyage
 * accumulates damage no amount of crew-turns will clear. The gang's size and
 * the sea fraction are the imported `repair` table's; unimported, the plan
 * says what it cannot count.
 *
 * @param {number} points the structural damage standing
 * @param {number} crew how many hands are put on it
 * @param {object} [o]
 * @param {boolean} [o.atSea] true while away from a dock
 * @returns {{repairable, dockOnly, turns, crewPerPoint, missing}}
 */
export function repairPlan(points, crew = 0, { atSea = true } = {}) {
  const table = readTable(VOYAGES_DOC, "repair");
  const per = Number(table?.crewPerPoint);
  const seaFraction = Number(table?.seaFraction);
  const standing = Math.max(0, Math.floor(Number(points) || 0));
  const missing = !Number.isFinite(per) || (atSea && !Number.isFinite(seaFraction));
  const repairable = atSea ? (Number.isFinite(seaFraction) ? Math.floor(standing * seaFraction) : null) : standing;
  const gangs = Number.isFinite(per) && per > 0 ? Math.floor(Math.max(0, Number(crew) || 0) / per) : null;
  return {
    repairable,
    dockOnly: repairable != null ? standing - repairable : null,
    // Turns for the hands actually assigned; no gang means it never finishes.
    turns: repairable != null && gangs != null ? (gangs > 0 ? Math.ceil(repairable / gangs) : Infinity) : null,
    crewPerPoint: Number.isFinite(per) ? per : null,
    missing,
  };
}

