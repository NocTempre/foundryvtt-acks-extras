/**
 * A scene Region as core keeps it, for the suites that stand a token on one.
 *
 * The mock models the parts of `RegionDocument` the module reads: the
 * combined geometry (`polygonTree`, iterable over its nodes, each marking its
 * own `isHole`, as core's `PolygonTree` is), `area`, `testPoint` over an
 * ElevatedPoint (elevation range included), and `includedInLevel`. The
 * geometry is given as rings, never derived from a shape's type, so a `grid`
 * shape's merged outline is as easy to stand up as a rectangle. The point
 * test is the suite's own, independent of the module's code under test.
 *
 * `rect(x, y, w, h)` is the ring of a rectangle. A ring is `[x, y, x, y, …]`.
 */

/** The ring of an axis-aligned rectangle. */
export const rect = (x, y, width, height) => [x, y, x + width, y, x + width, y + height, x, y + height];

const ringArea = (ring) => {
  let sum = 0;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) sum += ring[j] * ring[i + 1] - ring[i] * ring[j + 1];
  return Math.abs(sum) / 2;
};

const ringHolds = (ring, px, py) => {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const [xi, yi, xj, yj] = [ring[i], ring[i + 1], ring[j], ring[j + 1]];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/**
 * A Region document stand-in.
 *
 * @param {object} spec
 * @param {number[][]} [spec.rings] the solid outlines
 * @param {number[][]} [spec.holes] outlines cut out of them
 * @param {object[]} [spec.shapes] the `shapes` data, passed through for code that reads it
 * @param {object[]} [spec.behaviors] the behaviors, passed through
 * @param {{bottom?: number, top?: number, topInclusive?: boolean}} [spec.elevation]
 *   the range; open at both ends when omitted, as a Region drawn with no limits is
 * @param {string[]} [spec.levels] Level ids the Region belongs to; none means every Level
 * @param {object} [spec.extra] any other field the suite reads (`id`, `name`, `getFlag`)
 */
export function mockRegion({ rings = [], holes = [], shapes = [], behaviors = [], elevation = {}, levels = [], ...extra } = {}) {
  const { bottom = -Infinity, top = Infinity, topInclusive = true } = elevation;
  const node = (points, isHole) => ({ isHole, points, polygon: { points } });
  const nodes = [...rings.map((r) => node(r, false)), ...holes.map((r) => node(r, true))];
  const levelSet = new Set(levels);
  return {
    shapes,
    behaviors,
    elevation: { bottom, top, topInclusive },
    levels: levelSet,
    ...extra,
    polygonTree: { [Symbol.iterator]: () => nodes[Symbol.iterator]() },
    get area() {
      return rings.reduce((sum, r) => sum + ringArea(r), 0) - holes.reduce((sum, r) => sum + ringArea(r), 0);
    },
    testPoint({ x, y, elevation: e }) {
      if (e < bottom) return false;
      if (e !== bottom && (topInclusive ? e > top : e >= top)) return false;
      return rings.some((r) => ringHolds(r, x, y)) && !holes.some((r) => ringHolds(r, x, y));
    },
    includedInLevel(level) {
      if (!levelSet.size) return true;
      if (typeof level !== "string") throw new TypeError("includedInLevel takes a Level id or a Level");
      return levelSet.has(level);
    },
  };
}
