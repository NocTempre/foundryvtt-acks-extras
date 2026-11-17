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

/* -------------------------------------------------------------------------- */
/*  Painted Regions: grid shapes, as the country brush and core's grid tool    */
/*  leave them                                                                 */
/* -------------------------------------------------------------------------- */

/** An offset as `{i, j}` from `"i:j"` or an object. */
const offsetOf = (cell) => {
  if (typeof cell !== "string") return { i: cell.i, j: cell.j };
  const [i, j] = cell.split(":").map(Number);
  return { i, j };
};

/**
 * A grid of `size`-pixel cells, offset `(i, j)` = (row, column), the part of
 * core's grid the paint code asks: the cell containing a point, a cell's
 * centre and its corners. The cells are square whatever `type` says; the
 * suites that care about hex geometry bring a lattice of their own.
 *
 * @param {{size?: number, type?: number}} [options] `type` is the scene's
 *   `grid.type` (2, a pointy hex, by default)
 */
export function cellGrid({ size = 100, type = 2 } = {}) {
  return {
    type,
    size,
    getOffset: (p) => ({ i: Math.floor(p.y / size), j: Math.floor(p.x / size) }),
    getCenterPoint: ({ i, j }) => ({ x: (j + 0.5) * size, y: (i + 0.5) * size }),
    getVertices: ({ i, j }) => [[j, i], [j + 1, i], [j + 1, i + 1], [j, i + 1]].map(([x, y]) => ({ x: x * size, y: y * size })),
  };
}

/**
 * A `grid` shape as core's `GridShapeData` holds it: `offsets`, a `hole` mark,
 * and a `testPoint` that looks the point's cell up in the offsets as they stand
 * now (a suite may reshape the offsets in place) on the grid it was handed.
 *
 * @param {Array<string|{i: number, j: number}>} cells offsets, as `"i:j"` keys or objects
 * @param {{grid: object, hole?: boolean}} options
 */
export function gridShape(cells, { grid, hole = false }) {
  return {
    type: "grid",
    hole,
    offsets: cells.map(offsetOf),
    grid,
    testPoint(point) {
      const { i, j } = this.grid.getOffset(point);
      return this.offsets.some((o) => o.i === i && o.j === j);
    },
  };
}

/** A shape as plain data, the way `toObject` hands it back: no grid, no test. */
const plainShape = ({ grid: _grid, testPoint: _test, ...data }) => structuredClone(data);

/** A shape's data as a shape: a `grid` one gets its `testPoint`, any other is kept as given. */
const hydrate = (data, grid) => (data.type === "grid" ? gridShape(data.offsets ?? [], { grid, hole: !!data.hole }) : { ...data });

/**
 * A painted Region as a document: flags, `shapes` (each a live `gridShape`),
 * `toObject`, `update` and `delete`, the parts of `RegionDocument` the paint
 * code reads and writes. Its `behaviors` are empty, as a paint region's are.
 *
 * @param {object} spec
 * @param {object} spec.grid the grid its shapes test points on
 * @param {string} [spec.flag] the layer's value flag
 * @param {*} [spec.value] the value painted
 * @param {Array<string|{i: number, j: number}>} [spec.cells] the cells of its one grid shape; none gives no grid shape
 * @param {object[]} [spec.shapes] shapes as data, in place of `cells` (several grid shapes, a hole, a polygon)
 * @param {object} [spec.flags] further module flags
 * @param {object} [spec.extra] any other field the suite reads (`id`, `name`, `visibility`)
 */
export function paintRegion({ grid, flag, value, cells, shapes, flags = {}, id = null, ...extra }) {
  const held = { ...flags, ...(flag ? { [flag]: value } : {}) };
  const data = shapes ?? (cells ? [{ type: "grid", hole: false, offsets: cells.map(offsetOf) }] : []);
  const region = {
    id,
    behaviors: [],
    locked: false,
    flags: { "acks-extras": held },
    ...extra,
    shapes: data.map((s) => hydrate(s, grid)),
    getFlag(ns, key) { return this.flags[ns]?.[key]; },
    toObject() {
      return {
        _id: this.id, name: this.name, color: this.color, visibility: this.visibility, locked: this.locked,
        shapes: this.shapes.map(plainShape), flags: structuredClone(this.flags),
      };
    },
    /** The cells of its first grid shape, set in place the way a hand edit would. */
    setCells(next) { this.shapes.find((s) => s.type === "grid").offsets = next.map(offsetOf); },
    /** The painted value, set in place. */
    setValue(next) { this.flags["acks-extras"][flag] = next; },
    applyPatch(patch) {
      for (const [path, value] of Object.entries(patch)) {
        if (path === "shapes") this.shapes = value.map((s) => hydrate(s, grid));
        else if (path.startsWith("flags.")) {
          const [, ns, key] = path.split(".");
          (this.flags[ns] ??= {})[key] = value;
        } else this[path] = value;
      }
    },
  };
  return region;
}

/**
 * A scene that holds its regions in memory and is written the way core writes
 * documents: a create, an update and a delete each answer after a tick, so
 * writes started together interleave as they do against a server, and a write
 * built from a stale read overwrites a newer one. `calls` records every
 * embedded-document call as `{op, count}`, in order, and `created` the data each
 * create was handed.
 *
 * @param {object} [spec]
 * @param {object} [spec.grid] default `cellGrid()`
 * @param {object[]} [spec.regions] `paintRegion`s already on the scene
 * @param {object} [spec.extra] any other field the suite reads (`id`, `uuid`, `dimensions`, `walls`)
 */
export function paintScene({ grid = cellGrid(), regions = [], ...extra } = {}) {
  let serial = 0;
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  const scene = {
    id: "scene",
    grid,
    regions: [],
    calls: [],
    created: [],
    ...extra,
    async createEmbeddedDocuments(name, data) {
      if (name !== "Region") throw new Error(`paintScene holds no ${name}`);
      scene.calls.push({ op: "create", count: data.length });
      scene.created.push(...data);
      await tick();
      const made = data.map((d) => {
        const { shapes = [], flags = {}, ...rest } = d;
        return paintRegion({ id: `r${++serial}`, grid: scene.grid, shapes, flags: flags["acks-extras"], ...rest });
      });
      scene.regions.push(...made);
      return made;
    },
    async updateEmbeddedDocuments(name, updates) {
      if (name !== "Region") throw new Error(`paintScene holds no ${name}`);
      scene.calls.push({ op: "update", count: updates.length });
      await tick();
      for (const { _id, ...patch } of updates) scene.regions.find((r) => r.id === _id)?.applyPatch(patch);
    },
    async deleteEmbeddedDocuments(name, ids) {
      if (name !== "Region") throw new Error(`paintScene holds no ${name}`);
      scene.calls.push({ op: "delete", count: ids.length });
      await tick();
      scene.regions = scene.regions.filter((r) => !ids.includes(r.id));
    },
  };
  for (const region of regions) {
    region.id ??= `r${++serial}`;
    scene.regions.push(region);
  }
  return scene;
}
