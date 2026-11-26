/**
 * Real-world token footprints, as arithmetic — no Foundry.
 *
 * A footprint is what a creature occupies in feet; how many Foundry squares
 * that becomes depends on the scene's grid.distance, so the two conversions
 * live apart: `footprintFeet` resolves the feet, `tokenSpan` fits them into
 * squares. `token-scale.mjs` supplies the documents.
 */

import { sizeSquareFeet, sizeSquares } from "../monsters/sizes.mjs";

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
 * imported frontage cells (`monsters/sizes.mjs`) and a square's worth is
 * `sizeSquareFeet`: the stated constant, or the world's own table where it
 * holds one; a category the world holds no frontage for
 * has no footprint, so the answer is null and the caller leaves the token as
 * it is. A token with no category is one square. An override needs neither.
 * @param {object} input
 * @param {{w:number,h:number}|null} [input.override]  Explicit feet (token or
 *   actor flag) — wins outright.
 * @param {string|null} [input.sizeKey]  Monster size-category key.
 * @returns {{w:number,h:number}|null} feet, or null where the category's
 *   frontage is not imported.
 */
export function footprintFeet({ override = null, sizeKey = null } = {}) {
  if (override && override.w > 0 && override.h > 0) return { w: override.w, h: override.h };
  const feetPerSquare = sizeSquareFeet();
  if (!sizeKey) return { w: feetPerSquare, h: feetPerSquare };
  const squares = sizeSquares(sizeKey);
  return squares ? { w: squares.w * feetPerSquare, h: squares.h * feetPerSquare } : null;
}

/**
 * The size-category chips a scene can offer: one per category whose footprint
 * the world's import answers, in the order `keys` gives. A category with no
 * imported frontage is left out, so nothing imported offers none.
 * @param {object} input
 * @param {string[]} [input.keys]  The size-category keys, in display order.
 * @param {number} [input.feetPerCell]  What one cell of the scene is worth in feet.
 * @returns {{key:string, feet:{w:number,h:number}, span:{w:number,h:number}}[]}
 *   `feet` is what a press stamps; `span` the size it draws at in this scene's
 *   cells, by the sizer's own rounding (`tokenSpan`).
 */
export function sizeChips({ keys = [], feetPerCell = 0 } = {}) {
  const chips = [];
  for (const key of keys) {
    const feet = footprintFeet({ sizeKey: key });
    if (!feet) continue;
    chips.push({ key, feet, span: { w: tokenSpan(feet.w, feetPerCell), h: tokenSpan(feet.h, feetPerCell) } });
  }
  return chips;
}

/** Fit a length in feet into grid squares of `distance` feet each. */
export function tokenSpan(feet, distance, { step = SPAN_STEP, min = SPAN_MIN } = {}) {
  if (!(feet > 0) || !(distance > 0)) return min;
  return Math.max(min, Math.round(feet / distance / step) * step);
}

/** Slack on the half-step edge, so a drawn size exactly half a step off is not off. */
const MISMATCH_EPSILON = 1e-9;

/**
 * Whether a token is drawn at a size other than its footprint at the scene's
 * scale. The exact size on each axis is `feet / feetPerCell`, unrounded, and an
 * axis is off when the drawn size differs from it by MORE than half the step
 * `tokenSpan` rounds to. The sizer's own answer is never consulted: its
 * quarter-square floor would call a man on a mile-wide cell right.
 * @param {object} input
 * @param {{w:number,h:number}|null} [input.feet]  The footprint, from `footprintFeet`.
 * @param {number} [input.feetPerCell]  What one cell of the scene is worth in feet.
 * @param {number} input.width   The token's STORED width, in cells.
 * @param {number} input.height  The token's STORED height, in cells.
 * @param {number} [input.step]  The step the sizer rounds to.
 * @returns {{dir: "larger"|"smaller"|"mixed", exact: {w:number,h:number}}|null}
 *   null where nothing is off, there is no footprint or the scene has no usable
 *   cell; `exact` is the footprint in cells; `mixed` is larger on one axis and
 *   smaller on the other.
 */
export function scaleMismatch({ feet = null, feetPerCell = 0, width, height, step = SPAN_STEP } = {}) {
  if (!feet || !(feet.w > 0) || !(feet.h > 0) || !(feetPerCell > 0)) return null;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  const exact = { w: feet.w / feetPerCell, h: feet.h / feetPerCell };
  const slack = step / 2 + MISMATCH_EPSILON;
  const off = [width - exact.w, height - exact.h].filter((d) => Math.abs(d) > slack);
  if (!off.length) return null;
  const larger = off.some((d) => d > 0);
  const smaller = off.some((d) => d < 0);
  return { dir: larger && smaller ? "mixed" : larger ? "larger" : "smaller", exact };
}
