/**
 * A scene Region as core keeps it, for the suites that stand a token on one.
 *
 * The mock models the parts of `RegionDocument` the module reads: the
 * combined geometry (`polygonTree`, iterable over its nodes, each marking its
 * own `isHole`, as core's `PolygonTree` is, and answering `testPoint` and
 * `findClosestPoint` as core's does), `area`, `testPoint` over an
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

/** The point of the segment `a`-`b` nearest to `(px, py)`, ends clamped. */
const nearestOnSegment = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return { x: ax + t * dx, y: ay + t * dy };
};

/** The point nearest to `(px, py)` on the closed outline of a ring. */
const nearestOnRing = (ring, px, py) => {
  let best = null;
  let bestD = Infinity;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const q = nearestOnSegment(px, py, ring[j], ring[j + 1], ring[i], ring[i + 1]);
    const d = Math.hypot(q.x - px, q.y - py);
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return best;
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
 * The points core tests a token's footprint with on a square grid
 * (`TokenDocument#getContainmentTestPoints`): the centre alone for a token of
 * one cell or less, else a lattice from the first cell's centre across and down
 * in steps of a cell, so each cell of the token is tested at its middle.
 * Reads the stored corner, as core's `testInsideRegion` does (`_source`), and
 * the token's own size where a partial source names none.
 */
export function containmentPoints(token, gridSize) {
  const { x, y, width, height } = { ...token, ...token._source };
  const w = width * gridSize;
  const h = height * gridSize;
  const centre = { x: x + w / 2, y: y + h / 2 };
  if (width <= 1 && height <= 1) return [centre];
  const padX = Math.min(gridSize, w) / 2;
  const padY = Math.min(gridSize, h) / 2;
  const innerX = w - padX * 2;
  const innerY = h - padY * 2;
  const m = innerX ? Math.max(Math.round(innerX / gridSize + 1e-6), 1) : 0;
  const n = innerY ? Math.max(Math.round(innerY / gridSize + 1e-6), 1) : 0;
  const points = [centre];
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      const point = { x: x + padX + (m ? (innerX / m) * j : 0), y: y + padY + (n ? (innerY / n) * i : 0) };
      if (Math.abs(point.x - centre.x) < 1e-6 && Math.abs(point.y - centre.y) < 1e-6) continue;
      points.push(point);
    }
  }
  return points;
}

/**
 * The Regions a mock token stands in, worked out as core does when a move is
 * written: any of its containment points inside the Region. A suite's stand-in
 * for `TokenDocument#regions`; the Region's own `testPoint` does the point
 * test (core's carries a 0.75 px tolerance this does not).
 */
export function tokenRegions(token, regions) {
  const scene = token.parent;
  const gridSize = scene.grid.size;
  const elevation = token._source?.elevation ?? token.elevation ?? 0;
  const standing = new Set();
  for (const region of regions) {
    // A stand-in with no `testPoint` has no geometry (a painted layer's): nobody stands in it.
    if (containmentPoints(token, gridSize).some((p) => region.testPoint?.({ ...p, elevation }))) standing.add(region);
  }
  return standing;
}

/**
 * Give a mock token a live `regions`, computed from its scene's Regions each
 * time it is read, so a Region added or removed mid-suite is seen at once.
 */
export function standOnRegions(token) {
  Object.defineProperty(token, "regions", { get: () => tokenRegions(token, token.parent.regions), configurable: true });
  return token;
}

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
  // Solid ground is a point whose innermost outline, the smallest holding it,
  // is a ring: a hole cuts a ring open and an island in the hole closes it again.
  const solid = (x, y) => {
    let innermost = null;
    for (const { points, isHole } of nodes) {
      if (!ringHolds(points, x, y)) continue;
      const area = ringArea(points);
      if (!innermost || area < innermost.area) innermost = { area, isHole };
    }
    return !!innermost && !innermost.isHole;
  };
  // The nearest point of any outline, a hole's included: core's tree answers
  // with the nearest rim of the node the point stands in, which for a point off
  // the solid is the nearest edge of all.
  const rim = (x, y) => {
    let best = null;
    let bestD = Infinity;
    for (const { points } of nodes) {
      const q = nearestOnRing(points, x, y);
      const d = q ? Math.hypot(q.x - x, q.y - y) : Infinity;
      if (d < bestD) {
        bestD = d;
        best = q;
      }
    }
    return { point: best, distance: bestD };
  };
  return {
    shapes,
    behaviors,
    elevation: { bottom, top, topInclusive },
    levels: levelSet,
    ...extra,
    polygonTree: {
      [Symbol.iterator]: () => nodes[Symbol.iterator](),
      /**
       * Core's `PolygonTree#testPoint`: with no `distance`, whether the point
       * stands on solid ground. A positive `distance` also admits a point off
       * the ground whose nearest rim is within it; a negative one admits only
       * ground at least that deep.
       */
      testPoint({ x, y }, distance = 0) {
        const inside = solid(x, y);
        if (distance === 0) return inside;
        const toRim = rim(x, y).distance;
        return distance > 0 ? inside || toRim <= distance : inside && toRim >= -distance;
      },
      /**
       * Core's `PolygonTree#findClosestPoint`: the point itself on solid
       * ground, else the nearest point of any outline, holes included;
       * undefined for a Region with no geometry.
       */
      findClosestPoint({ x, y }) {
        if (solid(x, y)) return { x, y };
        return rim(x, y).point ?? undefined;
      },
    },
    get area() {
      return rings.reduce((sum, r) => sum + ringArea(r), 0) - holes.reduce((sum, r) => sum + ringArea(r), 0);
    },
    testPoint({ x, y, elevation: e }) {
      if (e < bottom) return false;
      if (e !== bottom && (topInclusive ? e > top : e >= top)) return false;
      return solid(x, y);
    },
    includedInLevel(level) {
      if (!levelSet.size) return true;
      if (typeof level !== "string") throw new TypeError("includedInLevel takes a Level id or a Level");
      return levelSet.has(level);
    },
  };
}
