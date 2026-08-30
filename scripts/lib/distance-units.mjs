/**
 * What one of a scene's distance units is worth in feet.
 *
 * Foundry's `grid.units` is free text, and every length this module owns is in
 * FEET — footprints, frontages, reaches. Converting one into grid squares
 * therefore needs a number for the scene's unit, and a scene whose squares are
 * six MILES is the case that makes the omission visible: a party sized as
 * though six were six feet is ten squares wide.
 *
 * An unrecognised or empty unit is feet. That is what the family assumed
 * before the battlemap's unit picker existed, so an untouched world keeps the
 * behaviour it had.
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
