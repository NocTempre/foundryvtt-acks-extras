/**
 * How far a spell reaches and which targeted tokens are beyond it. A spell's
 * range is a shape and a figure (`RANGE_SHAPES`, `range {shape, value, unit}`);
 * `rangeFeet` turns the ones that name a distance into feet at the caster
 * level, and `rangeVerdicts` sets each target's measured gap against it. A
 * shape that names no distance (self, touch, unlimited, special) or a figure
 * the import left blank says nothing, so nothing is judged.
 *
 * The figure is the page's, passed in by the cast from the world; this file
 * holds the procedure only. Pure and Foundry-free: the gaps are measured by
 * the caller (`lib/distance-units.mjs` `tokenGapFeet`).
 */
import { feetPerUnit } from "../lib/distance-units.mjs";

/** The range shapes that read the figure as one distance. */
const FLAT = Object.freeze(["distance", "touchOrDistance"]);

/** The target models a range is measured to directly, creature to creature. An `area` is measured with its reach; every other model is left unjudged. */
const DIRECT = Object.freeze(["creature", "recipient", "hdPool", "object"]);

/** A finite figure above zero, else null (a blank reads as zero to `Number`, so it is told first). */
const positive = (value) => {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * A spell's range in feet at a caster level, with the parts it is made of.
 * `distance` and `touchOrDistance` read the figure; `distancePerLevel` reads it
 * times the caster level, and says nothing until a level is known. Every other
 * shape, a blank figure, and a figure that is not above zero give null.
 *
 * @param {{shape?: string, value?: number|null, unit?: string}|null} range  the spell's `range`
 * @param {number|null} level  the resolved caster level
 * @returns {{value: number, parts: Array<{key: "figure"|"perLevel"|"level", value: number}>}|null}  every figure in feet
 */
export function rangeFeet(range, level) {
  const figure = positive(range?.value);
  if (figure === null) return null;
  const feet = figure * feetPerUnit(range?.unit || "feet");
  if (FLAT.includes(range?.shape)) return { value: feet, parts: [{ key: "figure", value: feet }] };
  if (range?.shape === "distancePerLevel") {
    const at = positive(level);
    return at === null ? null : { value: feet * at, parts: [{ key: "perLevel", value: feet }, { key: "level", value: at }] };
  }
  return null;
}

/** How far past the area's own origin a creature in the area can stand: its radius, else its length; null where the import gave neither. */
const reachOf = (extent) => positive(extent?.radius) ?? positive(extent?.length);

/**
 * The targeted tokens beyond a spell's range. A creature must stand within the
 * range; a token in an area spell may stand as far again as the area's reach,
 * so an area target is judged against the range plus that reach. A target whose
 * gap is unmeasured (no caster token, another scene) is never judged, and an
 * area whose extent is blank judges none; both say so through `unmeasured`.
 *
 * @param {object} from
 * @param {Array<{key: string, name: string}>} from.targets  the targeted tokens
 * @param {Record<string, number|null>} from.gaps  the centre-to-centre gap in feet by target key
 * @param {{value: number, parts: object[]}|null} from.rangeFeet  `rangeFeet`'s answer
 * @param {object|null} [from.extent]  `areaExtent`'s answer, for an area
 * @param {string} [from.model]  the spell's `TARGET_MODELS` key
 * @returns {{limit: number|null, parts: object[], out: Array<{key: string, name: string, gap: number}>, unmeasured: boolean}}
 */
export function rangeVerdicts({ targets = [], gaps = {}, rangeFeet: range = null, extent = null, model = "" } = {}) {
  const none = { limit: null, parts: [], out: [], unmeasured: false };
  if (!range || !Number.isFinite(range.value) || !targets.length) return none;
  const area = model === "area";
  if (!area && !DIRECT.includes(model)) return none;
  const reach = area ? reachOf(extent) : 0;
  if (reach === null) return { ...none, limit: range.value, parts: range.parts, unmeasured: true };
  const limit = range.value + reach;
  const parts = reach ? [...range.parts, { key: "reach", value: reach }] : range.parts;
  const out = [];
  let unmeasured = false;
  for (const { key, name } of targets) {
    const gap = gaps?.[key];
    if (!Number.isFinite(gap)) unmeasured = true;
    else if (gap > limit + 1e-6) out.push({ key, name, gap });
  }
  return { limit, parts, out, unmeasured };
}
