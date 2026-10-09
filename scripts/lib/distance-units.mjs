/**
 * What one of a scene's distance units is worth in feet.
 *
 * Foundry's `grid.units` is free text, and every length this module owns is in
 * FEET — footprints, frontages, reaches. An unrecognised or empty unit reads
 * as feet, so an untouched world's behaviour does not change.
 *
 * Foundry-free.
 */

import { slug } from "./vocab.mjs";

/**
 * The units the battlemap's picker offers. `abbr` is what is written to
 * `grid.units`; `feet` converts one unit into feet; `aliases` are the other
 * spellings a hand-set scene may already hold. Labels are localized by the
 * surface that renders them — this table carries no user-facing prose.
 */
export const DISTANCE_UNITS = Object.freeze({
  ft: { abbr: "ft", feet: 1, aliases: ["ft", "feet", "foot"] },
  yd: { abbr: "yd", feet: 3, aliases: ["yd", "yds", "yard", "yards"] },
  mi: { abbr: "mi", feet: 5280, aliases: ["mi", "mile", "miles"] },
  m: { abbr: "m", feet: 3.280839895013123, aliases: ["m", "meter", "meters", "metre", "metres"] },
  km: { abbr: "km", feet: 3280.839895013123, aliases: ["km", "kilometer", "kilometers", "kilometre", "kilometres"] },
});

/**
 * The table key a written unit names, or null when nothing matches. Matching
 * folds case and punctuation, so "Ft.", "feet" and "FEET" are one unit.
 */
export function unitKey(units) {
  const s = slug(units);
  if (!s) return null;
  for (const [key, u] of Object.entries(DISTANCE_UNITS)) {
    if (u.aliases.includes(s)) return key;
  }
  return null;
}

/** Feet per one unit of `units`; an unknown unit counts as feet. */
export function feetPerUnit(units) {
  const key = unitKey(units);
  return key ? DISTANCE_UNITS[key].feet : 1;
}

/**
 * What one grid cell of this scene is worth in FEET — `grid.distance` read
 * through its units. The number every feet→squares conversion divides by.
 * @returns {number} 0 when the scene has no usable distance.
 */
export function sceneFeetPerCell(scene) {
  const distance = scene?.grid?.distance;
  if (!(distance > 0)) return 0;
  return distance * feetPerUnit(scene?.grid?.units);
}

/**
 * What one grid cell of this scene is worth in MILES.
 * @returns {number} 0 when the scene has no usable distance.
 */
export function sceneMilesPerCell(scene) {
  return sceneFeetPerCell(scene) / DISTANCE_UNITS.mi.feet;
}

/**
 * Whether one cell of this scene spans at least a mile — the scale a journey is
 * walked at rather than a delve. The threshold is the definition of the mile,
 * not a rule's figure.
 */
export function isExpeditionScale(scene) {
  const feet = sceneFeetPerCell(scene);
  return feet > 0 && feet >= DISTANCE_UNITS.mi.feet;
}
