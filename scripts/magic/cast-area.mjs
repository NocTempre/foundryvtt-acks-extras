/**
 * The extent of a spell's area, normalized. A page prints an area as a
 * radius, a diameter, or a length by a width (`AREA_MEASURES`), in the spell's
 * own unit; `areaExtent` turns the resolved figures into one shape in feet, so
 * a reader that counts creatures or draws a template asks for the measure it
 * needs and never guesses which one the page used. It stores nothing: the
 * spell's `target.area` keeps what the page printed.
 *
 * Pure and Foundry-free.
 */
import { AREA_MEASURES } from "../lib/magic-vocab.mjs";
import { feetPerUnit } from "../lib/distance-units.mjs";

/** A length in the spell's unit as feet, or null when it is not a finite, non-negative figure. */
const toFeet = (figure, perUnit) => (Number.isFinite(figure) && figure >= 0 ? figure * perUnit : null);

/**
 * The normalized extent of an area, every figure in feet and null where the
 * figures given cannot say it.
 *
 * A `radius` measure gives the radius and, doubled, the diameter; a `diameter`
 * measure the diameter and, halved, the radius; a `length` measure gives the
 * length and the width, which is null until a width is given. A size with no
 * known measure says nothing about the extent, since the figure alone does not
 * tell which one it is. `height` needs no measure.
 *
 * @param {object} area the resolved figures: `size` and `width` are numbers
 *   already read at the caster level, `unit` is a `DISTANCE_UNITS` key (feet
 *   when absent), `measure` an `AREA_MEASURES` key
 * @returns {{measure: string, radius: number|null, diameter: number|null, length: number|null, width: number|null, height: number|null}}
 */
export function areaExtent({ measure, size, width, height, unit } = {}) {
  const perUnit = feetPerUnit(unit || "feet");
  const known = Object.hasOwn(AREA_MEASURES, measure) ? measure : "";
  const extent = { measure: known, radius: null, diameter: null, length: null, width: null, height: toFeet(height, perUnit) };
  const printed = toFeet(size, perUnit);
  if (printed === null) return extent;
  if (known === "radius") {
    extent.radius = printed;
    extent.diameter = printed * 2;
  } else if (known === "diameter") {
    extent.diameter = printed;
    extent.radius = printed / 2;
  } else if (known === "length") {
    extent.length = printed;
    extent.width = toFeet(width, perUnit);
  }
  return extent;
}
