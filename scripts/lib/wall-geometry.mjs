/**
 * Segments, and the graph a set of them draws.
 *
 * Walls in Foundry are unordered line segments, which is the right shape for a
 * barrier and the wrong one for everything else you might want to ask of a
 * drawn line. Three questions recur and none of them is answerable segment by
 * segment: does a path CROSS this line, does this line ENCLOSE an area, and how
 * far is it ALONG these lines from here to there. The first is a trap springing,
 * the second is turning a hand-drawn loop into a region, and the third is
 * walking a street that bends.
 *
 * So the segments are joined into a graph — endpoints within a tolerance are
 * one node, because a line closed by eye is closed to within a pixel or two —
 * and distance is measured over it. A point off the lines is attached by its
 * nearest projection, which is what makes "walk to the corner and along the
 * avenue" one measurement rather than three.
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
 * The point on a segment closest to `(x, y)`, and how far off it is.
 *
 * Clamped to the ends, so a point past one end projects onto that end rather
 * than onto the infinite line through it — the difference between standing at
 * a street's mouth and standing in the field its line would reach if extended.
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
 * Perpendicular distance from a point to a segment `[x1,y1,x2,y2]`.
 *
 * Clamped to the segment's ends, so a point off past one end measures to that
 * end rather than to the infinite line through it.
 */
export function pointSegmentDistance(x, y, seg) {
  return nearestPointOnSegment(x, y, seg).distance;
}

/**
 * Where a movement path crosses a segment, or null.
 *
 * Returns the POINT rather than a yes/no because a crossing is usually an
 * EVENT — the party is halted where it happened, not told about it three
 * squares later.
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
  // `t > 0`, not `t >= 0`: a mover STARTING on the line has not crossed it by
  // stepping away. Without this, a party halted at a trap springs it again on
  // its next move, in either direction, forever.
  if (t <= 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: from.x + t * rx, y: from.y + t * ry, t };
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
 * Walls are unordered segments; a Region needs a ring of points in order. The
 * chaining walks from each segment to whichever unused segment shares its
 * endpoint, which is what makes a hand-drawn loop usable without asking the
 * Judge to have drawn it in sequence.
 *
 * Endpoints are compared with a tolerance because a loop closed by eye is
 * closed to within a pixel or two, not exactly.
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

  // Try every segment as the start and keep the BIGGEST closed ring found.
  //
  // A Judge's selection is rarely exactly the loop: a wall tool leaves the wall
  // it drew selected, so reaching straight for "enclose these" hands this four
  // walls of a room plus one stray line. Starting only from the first segment
  // lets that one leftover decide the answer is "not a shape", which is true of
  // the whole set and useless as a response.
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
 * Join segments into a graph whose nodes are their shared endpoints.
 *
 * Two endpoints within `tolerance` are ONE node. That tolerance is the whole
 * reason this exists: a Judge drawing a street network drags each length
 * separately, and core's own snapping puts consecutive ends close together
 * rather than identical. Without the merge every segment would be its own
 * island and no route would run further than one length.
 *
 * Segments are kept whatever else they carry — pass `{c, …}` objects and the
 * rest rides along on each edge's `meta`, so a caller can ask which surfaces a
 * route crossed without a second lookup.
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
  // point belongs to reads nine buckets instead of every node found so far. A
  // linear scan is quadratic in the number of walls, and a city's street net is
  // exactly where that starts to be felt.
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

  for (const entry of segments ?? []) {
    const c = Array.isArray(entry) ? entry : entry?.c;
    if (!Array.isArray(c) || c.length < 4) continue;
    const [x1, y1, x2, y2] = c.map(Number);
    if (![x1, y1, x2, y2].every(Number.isFinite)) continue;
    const a = nodeAt(x1, y1);
    const b = nodeAt(x2, y2);
    // A segment shorter than the tolerance has both ends merged into one node.
    // Keeping it as an edge would be a self-loop of no length: it can never be
    // a step of a route, and it would be reported as a road the party followed.
    if (a === b) continue;
    const index = edges.length;
    edges.push({
      a,
      b,
      length: Math.hypot(x2 - x1, y2 - y1),
      seg: [x1, y1, x2, y2],
      meta: Array.isArray(entry) ? {} : entry,
    });
    nodes[a].edges.push(index);
    nodes[b].edges.push(index);
  }
  return { nodes, edges, tolerance };
}

/**
 * Cheapest distances from one or more starting nodes, over edge lengths.
 *
 * Several sources rather than one because a point that is not ON the network
 * enters it part-way along an edge, and that means starting from BOTH ends of
 * that edge at their own distances. One source is the special case.
 *
 * @param {object} graph from `joinSegments`
 * @param {Array<{node: number, dist: number}>} sources
 * @returns {{dist: Map<number, number>, via: Map<number, number>}} `via` is the
 *   edge each node was reached by, which is what rebuilds the route.
 */
export function reachFrom(graph, sources) {
  const dist = new Map();
  const via = new Map();
  // A linear scan for the nearest unsettled node. A street network is small
  // enough that a heap buys nothing, and the scan cannot get the answer wrong.
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
 * connected.
 *
 * Null rather than a big number: a bridge and a ford in the same town are two
 * networks that do not meet, and pricing a walk between them would invent a
 * crossing nobody drew.
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
  // Walk the `via` chain back to the source. It cannot cycle: every node was
  // reached by an edge from a STRICTLY cheaper node.
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
 * and the legs to those projections are reported separately, because walking
 * the last twenty feet across a courtyard is not walking the street: a caller
 * pricing a road's surface wants `along` alone, and a caller pricing a journey
 * wants the sum.
 *
 * **Null when NEITHER end is within `reach`.** A party crossing open ground on
 * a map that happens to have a street somewhere is not on that street, and
 * measuring their move along it would be a longer answer than the straight
 * line for no reason the Judge can see. One end within reach is enough — that
 * is stepping onto the road, or off it.
 *
 * Null too when the two ends attach to networks that do not meet: an
 * unconnected pair has no distance along anything.
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

  // Whichever end of the exit edge is cheaper to reach. Both are tried because
  // a route can arrive at a street from either direction.
  let winner = null;
  for (const e of ends) {
    const total = dist.get(e.node) + e.tail;
    if (!winner || total < winner.total) winner = { ...e, total };
  }

  // The edges actually followed, entry and exit included: a caller naming the
  // surfaces underfoot reads them off this rather than guessing from the ends.
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
