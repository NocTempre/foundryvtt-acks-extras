/**
 * Real-world token footprints, as arithmetic — no Foundry.
 *
 * A footprint is what a creature occupies in feet; how many Foundry squares
 * that becomes depends on the scene's grid.distance, so the two conversions
 * live apart: `footprintFeet` resolves the feet, `tokenSpan` fits them into
 * squares. `token-scale.mjs` supplies the documents.
 */

import { FEET_PER_RANK } from "../formation/trap-rules.mjs";

/**
 * Token spans are quantized to quarter squares with a quarter-square floor: a
 * 5-ft man on a 100-ft wilderness square is a 0.05-square dot by arithmetic,
 * unclickable in practice — 0.25 keeps every token grabbable.
 */
export const SPAN_STEP = 0.25;
export const SPAN_MIN = 0.25;

/**
 * Resolve a token's footprint in feet.
 * @param {object} input
 * @param {{w:number,h:number}|null} [input.override]  Explicit feet (token or
 *   actor flag) — wins outright.
 * @param {string|null} [input.sizeKey]  Monster size-category key.
 * @param {object} [input.sizes]  The SIZES table (footprints in squares at the
 *   5-ft combat square).
 * @param {number} [input.feetPerSquare]  What one footprint square is worth.
 * @returns {{w:number,h:number}} feet.
 */
export function footprintFeet({ override = null, sizeKey = null, sizes = {}, feetPerSquare = FEET_PER_RANK } = {}) {
  if (override && override.w > 0 && override.h > 0) return { w: override.w, h: override.h };
  const cat = sizeKey ? sizes[sizeKey]?.footprint : null;
  if (cat) return { w: cat.w * feetPerSquare, h: cat.h * feetPerSquare };
  return { w: feetPerSquare, h: feetPerSquare };
}

/** Fit a length in feet into grid squares of `distance` feet each. */
export function tokenSpan(feet, distance, { step = SPAN_STEP, min = SPAN_MIN } = {}) {
  if (!(feet > 0) || !(distance > 0)) return min;
  return Math.max(min, Math.round(feet / distance / step) * step);
}
