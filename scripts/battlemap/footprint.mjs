/**
 * Real-world token footprints, as arithmetic — no Foundry.
 *
 * A footprint is what a creature occupies in feet; how many Foundry squares
 * that becomes depends on the scene's grid.distance, so the two conversions
 * live apart: `footprintFeet` resolves the feet, `tokenSpan` fits them into
 * squares. `token-scale.mjs` supplies the documents.
 */

import { sizeSquares } from "../monsters/sizes.mjs";

/**
 * Token spans are quantized to quarter squares with a quarter-square floor: a
 * 5-ft man on a 100-ft wilderness square is a 0.05-square dot by arithmetic,
 * unclickable in practice — 0.25 keeps every token grabbable.
 */
export const SPAN_STEP = 0.25;
/** The smallest token span, in squares. */
export const SPAN_MIN = 0.25;

/**
 * Resolve a token's footprint in feet. A size category's squares are the
 * imported frontage cells (`monsters/sizes.mjs`) and a square's worth is the
 * imported square (`sizeSquareFeet`); with no square, or a category the world
 * holds no frontage for, there is no footprint, so the answer is null and the
 * caller leaves the token as it is. A token with no category is one square.
 * An override needs neither.
 * @param {object} input
 * @param {{w:number,h:number}|null} [input.override]  Explicit feet (token or
 *   actor flag) — wins outright.
 * @param {string|null} [input.sizeKey]  Monster size-category key.
 * @param {number|null} [input.feetPerSquare]  What one footprint square is
 *   worth; the caller reads it from the import and there is no default.
 * @returns {{w:number,h:number}|null} feet, or null where the square or the
 *   category's frontage is not imported.
 */
export function footprintFeet({ override = null, sizeKey = null, feetPerSquare = null } = {}) {
  if (override && override.w > 0 && override.h > 0) return { w: override.w, h: override.h };
  if (!(feetPerSquare > 0)) return null;
  if (!sizeKey) return { w: feetPerSquare, h: feetPerSquare };
  const squares = sizeSquares(sizeKey);
  return squares ? { w: squares.w * feetPerSquare, h: squares.h * feetPerSquare } : null;
}

/** Fit a length in feet into grid squares of `distance` feet each. */
export function tokenSpan(feet, distance, { step = SPAN_STEP, min = SPAN_MIN } = {}) {
  if (!(feet > 0) || !(distance > 0)) return min;
  return Math.max(min, Math.round(feet / distance / step) * step);
}
