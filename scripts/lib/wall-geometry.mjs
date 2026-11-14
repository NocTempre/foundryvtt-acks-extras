/**
 * Segments, and the graph a set of them draws.
 *
 * Walls in Foundry are unordered line segments. Three questions recur over a
 * drawn line: does a path CROSS it, does it ENCLOSE an area, and how far is it
 * ALONG the lines from here to there. The last is answered over a graph:
 * segments are joined into one, endpoints within a tolerance are one node, and a
 * point off the lines is attached by its nearest projection.
 *
 * Pure geometry: no Foundry, no canvas, no documents. A segment is
 * `[x1, y1, x2, y2]`, the shape a Wall's `c` already has, so callers pass walls
 * through without translating them. What a line MEANS — a barrier, a tripwire,
 * a paved street — belongs to whoever flagged it.
 */

/* -------------------------------------------- */
/*  Points and segments                         */
/* -------------------------------------------- */

/**
 * The point on a segment closest to `(x, y)`, and how far off it is. Clamped to
 * the ends, so a point past one end projects onto that end.
 *
 * @param {number[]} seg `[x1, y1, x2, y2]`
 * @returns {{x: number, y: number, t: number, distance: number}} `t` is the
 *   fraction along the segment, so a caller can split it at the projection.
 */
export function nearestPointOnSegment(x, y, seg) {
  const [x1, y1, x2, y2] = seg;
  const dx = x2 - x1;
  const dy = y2 - y1;
  // A degenerate segment is a point: every projection lands on it, at t = 0.
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2)) : 0;
  const px = x1 + t * dx;
  const py = y1 + t * dy;
  return { x: px, y: py, t, distance: Math.hypot(x - px, y - py) };
}

/**
 * Distance from a point to a segment `[x1,y1,x2,y2]`, clamped to the segment's ends.
 */
export function pointSegmentDistance(x, y, seg) {
  return nearestPointOnSegment(x, y, seg).distance;
}

/**
 * Where a movement path crosses a segment, or null: the crossing POINT, so a
 * caller can halt the mover where it happened.
 */
export function segmentCrossing(from, to, seg) {
  const [x1, y1, x2, y2] = seg;
  const rx = to.x - from.x;
  const ry = to.y - from.y;
  const sx = x2 - x1;
  const sy = y2 - y1;
  const denom = rx * sy - ry * sx;
  if (!denom) return null; // parallel, including both degenerate
  const t = ((x1 - from.x) * sy - (y1 - from.y) * sx) / denom;
  const u = ((x1 - from.x) * ry - (y1 - from.y) * rx) / denom;
  // `t > 0`, not `t >= 0`: a mover STARTING on the line has not crossed it by stepping away.
  if (t <= 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: from.x + t * rx, y: from.y + t * ry, t };
}

/**
 * Whether a segment touches a closed axis-aligned rectangle: an end inside it,
 * a crossing of its edge, and a graze of its boundary all count, so a segment
 * lying along an edge touches it.
 *
 * @param {number[]} seg `[x1, y1, x2, y2]`
 * @param {{minX: number, minY: number, maxX: number, maxY: number}} rect
 */
export function segmentTouchesRect(seg, rect) {
  const [x1, y1, x2, y2] = seg;
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;
  // Liang–Barsky: clip the parameter range against each of the four edges.
  const clip = (p, q) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return clip(-dx, x1 - rect.minX) && clip(dx, rect.maxX - x1) && clip(-dy, y1 - rect.minY) && clip(dy, rect.maxY - y1);
}

/**
 * The shortest distance between two segments.
 *
 * Crossing segments are zero apart; otherwise the closest approach is at one of
 * the four endpoints, which is what the four point tests cover.
 */
export function segmentDistance(a, b) {
  if (segmentCrossing({ x: a[0], y: a[1] }, { x: a[2], y: a[3] }, b)) return 0;
  return Math.min(
    pointSegmentDistance(a[0], a[1], b),
    pointSegmentDistance(a[2], a[3], b),
    pointSegmentDistance(b[0], b[1], a),
    pointSegmentDistance(b[2], b[3], a),
  );
}

/**
 * Chain wall segments into the outline they draw.
 *
 * A Region needs a ring of points in order: the chaining walks from each segment
 * to whichever unused segment shares its endpoint, with endpoints compared
 * within a tolerance.
 *
 * @param {Array<{c: number[]}>} walls
 * @param {number} [tolerance] pixels within which two endpoints are the same
 * @returns {{points: number[], closed: boolean}} flat [x,y,x,y,…]
 */
export function chainWalls(walls, tolerance = 8) {
  const segments = (walls ?? [])
    .map((w) => w.c)
    .filter((c) => Array.isArray(c) && c.length >= 4)
    .map((c) => [
      { x: c[0], y: c[1] },
      { x: c[2], y: c[3] },
    ]);
  if (!segments.length) return { points: [], closed: false };

  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= tolerance;

  /** Grow a ring from one starting segment, consuming whatever connects. */
  const ringFrom = (start) => {
    const used = new Array(segments.length).fill(false);
    used[start] = true;
    const ring = [segments[start][0], segments[start][1]];
    for (let guard = 0; guard < segments.length; guard++) {
      const tail = ring[ring.length - 1];
      let advanced = false;
      for (let i = 0; i < segments.length; i++) {
        if (used[i]) continue;
        const [a, b] = segments[i];
        if (near(tail, a)) {
          ring.push(b);
        } else if (near(tail, b)) {
          ring.push(a);
        } else continue;
        used[i] = true;
        advanced = true;
        break;
      }
      if (!advanced) break;
    }
    return ring;
  };

  // Try every segment as the start and keep the BIGGEST closed ring found, so a
  // stray extra wall in the selection cannot decide the answer is "not a shape".
  let best = null;
  for (let start = 0; start < segments.length; start++) {
    const ring = ringFrom(start);
    if (ring.length > 3 && near(ring[0], ring[ring.length - 1]) && (!best || ring.length > best.length)) {
      best = ring;
    }
  }

  // A closed ring repeats its first point at the end; a Region polygon does
  // not want the duplicate.
  if (best) return { points: best.slice(0, -1).flatMap((p) => [p.x, p.y]), closed: true };
  return { points: ringFrom(0).flatMap((p) => [p.x, p.y]), closed: false };
}

/* -------------------------------------------- */
/*  The graph a set of segments draws           */
/* -------------------------------------------- */

/**
 * Where two segments meet, or null — symmetric in its two arguments. Unlike
 * `segmentCrossing` it accepts `t = 0`, so a segment whose first endpoint sits
 * on another counts as a junction.
 */
function segmentMeeting(p, q) {
  const [px1, py1, px2, py2] = p;
  const [qx1, qy1, qx2, qy2] = q;
  const rx = px2 - px1;
  const ry = py2 - py1;
  const sx = qx2 - qx1;
  const sy = qy2 - qy1;
  const denom = rx * sy - ry * sx;
  if (!denom) return null; // parallel, including both degenerate
  const t = ((qx1 - px1) * sy - (qy1 - py1) * sx) / denom;
  const u = ((qx1 - px1) * ry - (qy1 - py1) * rx) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: px1 + t * rx, y: py1 + t * ry };
}

/**
 * Join segments into the PLANAR graph they draw: every place two of them touch
 * is a node, and a segment is emitted as one edge per span between consecutive
 * nodes on it.
 *
 * Two endpoints within `tolerance` are ONE node. A junction in the middle of a
 * line (a T, an X) is noded too: the ends are noded, then the crossings, then
 * each segment is cut at every node that lies on it. See
 * docs/battlemap/DECISIONS.md, "The road graph is planar, because a city is not
 * a chain".
 *
 * One drawn segment becomes SEVERAL edges, all sharing one `meta` object (the
 * one the caller passed in), so a consumer counts roads by `meta`, never by
 * edge index. A segment shorter than the tolerance is no edge, but its merged
 * endpoint is still a node and cuts whatever it lies on. A segment's spans may
 * fall short of its drawn length by at most the tolerance, where an end merges
 * into a node inside it. A span of zero length between two distinct nodes is
 * kept: it is the only thing joining them.
 *
 * Pass `{c, …}` objects and the rest rides along on each edge's `meta`.
 *
 * @param {Array<number[]|{c: number[]}>} segments
 * @param {number} [tolerance] pixels within which two endpoints are one node
 * @returns {{nodes: Array<{x: number, y: number, edges: number[]}>,
 *   edges: Array<{a: number, b: number, length: number, seg: number[], meta: object}>,
 *   tolerance: number}}
 */
export function joinSegments(segments, tolerance = 8) {
  const nodes = [];
  const edges = [];
  // Endpoints are bucketed by a grid one tolerance wide, so finding the node a
  // point belongs to reads nine buckets, not every node.
  const cell = Math.max(tolerance, 1);
  const buckets = new Map();
  const key = (cx, cy) => `${cx}:${cy}`;

  const nodeAt = (x, y) => {
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    let best = null;
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        for (const n of buckets.get(key(cx + ox, cy + oy)) ?? []) {
          const d = Math.hypot(nodes[n].x - x, nodes[n].y - y);
          if (d <= tolerance && (best == null || d < best.d)) best = { n, d };
        }
      }
    }
    if (best) return best.n;
    const index = nodes.length;
    nodes.push({ x, y, edges: [] });
    const k = key(cx, cy);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(index);
    return index;
  };

  // Pass one: the segments worth keeping, and their ends as nodes.
  const items = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const entry of segments ?? []) {
    const c = Array.isArray(entry) ? entry : entry?.c;
    if (!Array.isArray(c) || c.length < 4) continue;
    const [x1, y1, x2, y2] = c.map(Number);
    if (![x1, y1, x2, y2].every(Number.isFinite)) continue;
    const a = nodeAt(x1, y1);
    const b = nodeAt(x2, y2);
    // A segment shorter than the tolerance has both ends merged into one node:
    // kept, it would be a self-loop. The merged node stays registered, so a stub
    // dropped on a street still cuts that street.
    if (a === b) continue;
    items.push({ c: [x1, y1, x2, y2], a, b, meta: Array.isArray(entry) ? {} : entry });
    minX = Math.min(minX, x1, x2);
    minY = Math.min(minY, y1, y2);
    maxX = Math.max(maxX, x1, x2);
    maxY = Math.max(maxY, y1, y2);
  }
  if (!items.length) return { nodes, edges, tolerance };

  // A second, coarser grid holding segments rather than points, for the two
  // passes that ask "what is near here". The cell is at least two tolerances
  // wide, so a point within a tolerance of a segment is found in the nine cells
  // around it, and it grows with the drawing's extent.
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const coarse = Math.max(2 * cell, span / 64);
  const grid = new Map();

  // A segment is registered in every cell its traversal covers, walked column
  // by column: within one column the cells it covers are one contiguous run.
  // Each run is widened by `cell` on every side, which absorbs the rounding of
  // a crossing that lands on a cell edge.
  //
  // Pass two rests on one invariant: two segments that cross share at least one
  // cell of this index. Sampled points along the line do not hold it. See
  // docs/battlemap/DECISIONS.md, "The road graph is planar, because a city is
  // not a chain".
  const coverCells = (x1, y1, x2, y2, add) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const firstCol = Math.floor((Math.min(x1, x2) - cell) / coarse);
    const lastCol = Math.floor((Math.max(x1, x2) + cell) / coarse);
    for (let cx = firstCol; cx <= lastCol; cx++) {
      let ya;
      let yb;
      if (!dx) {
        ya = Math.min(y1, y2);
        yb = Math.max(y1, y2);
      } else {
        // The stretch of the line inside this column, clamped to the segment's
        // own ends so the padding column past each end reads that end's y.
        let t0 = (cx * coarse - cell - x1) / dx;
        let t1 = ((cx + 1) * coarse + cell - x1) / dx;
        if (t0 > t1) [t0, t1] = [t1, t0];
        t0 = Math.max(0, Math.min(1, t0));
        t1 = Math.max(0, Math.min(1, t1));
        ya = Math.min(y1 + t0 * dy, y1 + t1 * dy);
        yb = Math.max(y1 + t0 * dy, y1 + t1 * dy);
      }
      const firstRow = Math.floor((ya - cell) / coarse);
      const lastRow = Math.floor((yb + cell) / coarse);
      for (let cy = firstRow; cy <= lastRow; cy++) add(key(cx, cy));
    }
  };

  for (let i = 0; i < items.length; i++) {
    const [x1, y1, x2, y2] = items[i].c;
    coverCells(x1, y1, x2, y2, (k) => {
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    });
  }

  // Pass two: crossings, registered as nodes through `nodeAt`, so a crossing
  // that lands on an existing end (a T) resolves to that end.
  const tested = new Set();
  for (const list of grid.values()) {
    for (let p = 0; p < list.length; p++) {
      for (let q = p + 1; q < list.length; q++) {
        const i = Math.min(list[p], list[q]);
        const j = Math.max(list[p], list[q]);
        const pair = i * items.length + j;
        if (tested.has(pair)) continue;
        tested.add(pair);
        const hit = segmentMeeting(items[i].c, items[j].c);
        if (hit) nodeAt(hit.x, hit.y);
      }
    }
  }

  // Pass three: which nodes lie ON which segment, walked from the nodes out.
  const splits = items.map(() => []);
  for (let n = 0; n < nodes.length; n++) {
    const cx = Math.floor(nodes[n].x / coarse);
    const cy = Math.floor(nodes[n].y / coarse);
    const seen = new Set();
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        for (const i of grid.get(key(cx + ox, cy + oy)) ?? []) {
          if (seen.has(i)) continue;
          seen.add(i);
          const at = nearestPointOnSegment(nodes[n].x, nodes[n].y, items[i].c);
          if (at.distance <= tolerance) splits[i].push({ t: at.t, node: n });
        }
      }
    }
  }

  // Pass four: cut each segment at its nodes, in order along it, and emit one
  // edge per span. Span ends are taken from the original line, not the node
  // coordinates, so the pieces stay collinear with the wall.
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const [x1, y1, x2, y2] = it.c;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const along = splits[i];
    along.push({ t: 0, node: it.a }, { t: 1, node: it.b });
    along.sort((p, q) => p.t - q.t);
    // One appearance per node, at the smallest `t` it was found at, so every
    // emitted span runs between two distinct nodes (not distinct positions).
    const cut = [];
    const placed = new Set();
    for (const s of along) {
      if (placed.has(s.node)) continue;
      placed.add(s.node);
      cut.push(s);
    }
    for (let k = 0; k + 1 < cut.length; k++) {
      const a = cut[k].node;
      const b = cut[k + 1].node;
      const ax = x1 + cut[k].t * dx;
      const ay = y1 + cut[k].t * dy;
      const bx = x1 + cut[k + 1].t * dx;
      const by = y1 + cut[k + 1].t * dy;
      const index = edges.length;
      edges.push({
        a,
        b,
        length: Math.hypot(bx - ax, by - ay),
        seg: [ax, ay, bx, by],
        meta: it.meta,
      });
      nodes[a].edges.push(index);
      nodes[b].edges.push(index);
    }
  }
  return { nodes, edges, tolerance };
}

/**
 * Cheapest distances from one or more starting nodes, over edge lengths.
 *
 * Several sources, because a point off the network enters it part-way along an
 * edge, from both ends of that edge at their own distances.
 *
 * @param {object} graph from `joinSegments`
 * @param {Array<{node: number, dist: number}>} sources
 * @returns {{dist: Map<number, number>, via: Map<number, number>}} `via` is the
 *   edge each node was reached by, which is what rebuilds the route.
 */
export function reachFrom(graph, sources) {
  const dist = new Map();
  const via = new Map();
  // A linear scan for the nearest unsettled node; a street network is small.
  const open = new Set();
  for (const s of sources ?? []) {
    if (!graph?.nodes?.[s?.node]) continue;
    const d = Number(s.dist) || 0;
    if (!dist.has(s.node) || d < dist.get(s.node)) dist.set(s.node, d);
    open.add(s.node);
  }
  while (open.size) {
    let at = null;
    for (const n of open) if (at == null || dist.get(n) < dist.get(at)) at = n;
    open.delete(at);
    for (const e of graph.nodes[at].edges) {
      const edge = graph.edges[e];
      const far = edge.a === at ? edge.b : edge.a;
      const d = dist.get(at) + edge.length;
      if (!dist.has(far) || d < dist.get(far) - 1e-9) {
        dist.set(far, d);
        via.set(far, e);
        open.add(far);
      }
    }
  }
  return { dist, via };
}

/**
 * The cheapest walk between two nodes of the graph, or null when they are not
 * connected: two networks that do not meet have no walk between them.
 *
 * @returns {{nodes: number[], edges: number[], length: number}|null}
 */
export function shortestPath(graph, from, to) {
  if (!graph?.nodes?.[from] || !graph?.nodes?.[to]) return null;
  if (from === to) return { nodes: [from], edges: [], length: 0 };
  const { dist, via } = reachFrom(graph, [{ node: from, dist: 0 }]);
  if (!dist.has(to)) return null;

  const path = [to];
  const used = [];
  let at = to;
  // Walk the `via` chain back to the source; it cannot cycle, since every node
  // was reached from a strictly cheaper one.
  while (at !== from) {
    const e = via.get(at);
    if (e == null) return null;
    used.unshift(e);
    const edge = graph.edges[e];
    at = edge.a === at ? edge.b : edge.a;
    path.unshift(at);
  }
  return { nodes: path, edges: used, length: dist.get(to) };
}

/**
 * The nearest place on the network to a point: which edge, where along it, and
 * how far off the lines the point is.
 *
 * @returns {{edge: number, x: number, y: number, t: number, distance: number}|null}
 */
export function nearestOnGraph(graph, point) {
  let best = null;
  for (let e = 0; e < (graph?.edges?.length ?? 0); e++) {
    const at = nearestPointOnSegment(point.x, point.y, graph.edges[e].seg);
    if (!best || at.distance < best.distance) best = { edge: e, ...at };
  }
  return best;
}

/**
 * How far it is ALONG the network from one point to another.
 *
 * Neither end need be on the lines. Each is attached at its nearest projection
 * and the legs to those projections are reported separately (`offRoadFrom`,
 * `offRoadTo`): a caller pricing a road's surface wants `along` alone, and one
 * pricing a journey wants the sum.
 *
 * **Null when NEITHER end is within `reach`**; one end within reach is enough
 * (stepping onto the road, or off it). Null too when the two ends attach to
 * networks that do not meet.
 *
 * @param {object} graph from `joinSegments`
 * @param {object} o
 * @param {{x: number, y: number}} o.from / @param {{x: number, y: number}} o.to
 * @param {number} o.reach how far off the lines still counts as on them
 * @returns {{along: number, offRoadFrom: number, offRoadTo: number,
 *   edges: number[]}|null}
 */
export function pathLengthAlong(graph, { from, to, reach = 0 } = {}) {
  const a = nearestOnGraph(graph, from ?? {});
  const b = nearestOnGraph(graph, to ?? {});
  if (!a || !b) return null;
  if (a.distance > reach && b.distance > reach) return null;

  const edgeA = graph.edges[a.edge];
  const edgeB = graph.edges[b.edge];
  const result = (along, edges) => ({
    along,
    offRoadFrom: a.distance,
    offRoadTo: b.distance,
    edges,
  });

  // Both ends part-way along the SAME edge: the walk between them never
  // reaches either node, so no search would find it.
  if (a.edge === b.edge) return result(Math.abs(a.t - b.t) * edgeA.length, [a.edge]);

  const { dist, via } = reachFrom(graph, [
    { node: edgeA.a, dist: a.t * edgeA.length },
    { node: edgeA.b, dist: (1 - a.t) * edgeA.length },
  ]);
  const ends = [
    { node: edgeB.a, tail: b.t * edgeB.length },
    { node: edgeB.b, tail: (1 - b.t) * edgeB.length },
  ].filter((e) => dist.has(e.node));
  if (!ends.length) return null;

  // Whichever end of the exit edge is cheaper to reach.
  let winner = null;
  for (const e of ends) {
    const total = dist.get(e.node) + e.tail;
    if (!winner || total < winner.total) winner = { ...e, total };
  }

  // The edges actually followed, entry and exit included.
  const edges = [b.edge];
  let at = winner.node;
  while (via.has(at)) {
    const e = via.get(at);
    edges.unshift(e);
    const edge = graph.edges[e];
    at = edge.a === at ? edge.b : edge.a;
  }
  edges.unshift(a.edge);
  return result(winner.total, [...new Set(edges)]);
}
