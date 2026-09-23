/**
 * A hex's addressable geometry: thirteen NODES (six sides, six corners, a
 * centre) and the LINKS declared between them — the model a drawn road's
 * crossings are read into. A road applies only to travel along a declared
 * path; a winding one costs more distance than crossing straight. Pure
 * geometry and bookkeeping — no Foundry, no canvas. What a link is worth
 * lives in the travel tables.
 *
 * See docs/battlemap/DECISIONS.md, "A hex has sides, corners and centres,
 * and a road is a declared path."
 */

/** The three kinds of place a connection can touch. */
export const NODE_KINDS = Object.freeze({
  side: { label: "ACKS-BATTLEMAP.topology.side", count: 6 },
  corner: { label: "ACKS-BATTLEMAP.topology.corner", count: 6 },
  centre: { label: "ACKS-BATTLEMAP.topology.centre", count: 1 },
});

/**
 * The letter each kind is written with.
 *
 * `centre` is `m`, not its own initial — corner and centre both start with c.
 */
const KIND_LETTER = Object.freeze({ side: "s", corner: "c", centre: "m" });
const LETTER_KIND = Object.freeze({ s: "side", c: "corner", m: "centre" });

/** A node's id: the hex it belongs to, its kind, and its index around it. */
export function nodeId(i, j, kind, index = 0) {
  const spec = NODE_KINDS[kind];
  if (!spec) return null;
  const n = spec.count === 1 ? 0 : ((Math.floor(Number(index)) % spec.count) + spec.count) % spec.count;
  return `${i}:${j}:${KIND_LETTER[kind]}${n}`;
}

/** Read a node id back apart. Null on anything malformed. */
export function parseNode(id) {
  const m = /^(-?\d+):(-?\d+):([scm])(\d)$/.exec(String(id ?? ""));
  if (!m) return null;
  return { i: Number(m[1]), j: Number(m[2]), kind: LETTER_KIND[m[3]], index: Number(m[4]) };
}

/** The hex a node belongs to, as a cell key matching the terrain layer's. */
export function hexOf(id) {
  const n = parseNode(id);
  return n ? `${n.i}:${n.j}` : null;
}

/**
 * A link between two nodes. Undirected — a road runs both ways — so the ends
 * are stored sorted, which makes duplicate detection a string compare rather
 * than a two-way search.
 */
export function makeLink(from, to, { road = "earth", winding = 1 } = {}) {
  if (!parseNode(from) || !parseNode(to) || from === to) return null;
  const [a, b] = [from, to].sort();
  const w = Number(winding);
  return { a, b, road, winding: Number.isFinite(w) && w >= 1 ? w : 1 };
}

/** Is this link already in the set? Ends are sorted, so identity is a compare. */
export function hasLink(links, link) {
  return (links ?? []).some((l) => l.a === link.a && l.b === link.b);
}

/** Add a link, replacing any existing one between the same two nodes. */
export function withLink(links, link) {
  if (!link) return links ?? [];
  const rest = (links ?? []).filter((l) => !(l.a === link.a && l.b === link.b));
  return [...rest, link];
}

/** Remove a link between two nodes. */
export function withoutLink(links, from, to) {
  const probe = makeLink(from, to);
  if (!probe) return links ?? [];
  return (links ?? []).filter((l) => !(l.a === probe.a && l.b === probe.b));
}

/**
 * The connected components of a link set — the HUBS. A hex may hold several,
 * unconnected (a bridge and a ford need not join), so a route cannot
 * teleport between them.
 */
export function hubs(links) {
  const parent = new Map();
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const union = (x, y) => {
    for (const n of [x, y]) if (!parent.has(n)) parent.set(n, n);
    const rx = find(x); const ry = find(y);
    if (rx !== ry) parent.set(rx, ry);
  };
  for (const l of links ?? []) union(l.a, l.b);

  const groups = new Map();
  for (const node of parent.keys()) {
    const root = find(node);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(node);
  }
  return [...groups.values()].map((nodes) => nodes.sort());
}

/** Are these two nodes reachable from one another over the links? */
export function connected(links, from, to) {
  if (from === to) return true;
  return hubs(links).some((h) => h.includes(from) && h.includes(to));
}

/**
 * The cost of following a route, against crossing straight. `winding` is a
 * per-link multiplier (1 is a link as short as the crossing it replaces);
 * the tax is reported in DISTANCE, separate from what the road saves in
 * SPEED. Returns null for a route that is not actually connected.
 */
export function routeCost(links, path) {
  const steps = Array.isArray(path) ? path : [];
  if (steps.length < 2) return { hexes: 0, distance: 0, tax: 0, roads: [] };
  let distance = 0;
  const roads = [];
  for (let n = 0; n < steps.length - 1; n++) {
    const from = steps[n]; const to = steps[n + 1];
    const link = (links ?? []).find((l) => {
      const [a, b] = [from, to].sort();
      return l.a === a && l.b === b;
    });
    if (!link) return null;
    distance += link.winding;
    roads.push(link.road);
  }
  const hexes = new Set(steps.map(hexOf).filter(Boolean)).size;
  return {
    hexes,
    distance,
    // What the bends cost over a straight run of the same number of steps.
    tax: distance - (steps.length - 1),
    roads: [...new Set(roads)],
  };
}

/**
 * Is the party ON a road for this step? A road's multiplier and its
 * no-getting-lost apply only while it is being followed.
 */
export function onRoad(links, from, to) {
  const [a, b] = [from, to].sort();
  const link = (links ?? []).find((l) => l.a === a && l.b === b);
  return link ? { on: true, road: link.road, winding: link.winding } : { on: false };
}

/* -------------------------------------------- */
/*  Links derived from drawn roads              */
/* -------------------------------------------- */

/**
 * The links a set of DRAWN road segments implies: walk each segment, note
 * which hex each step falls in, and every move to a different, adjacent hex
 * is a crossing — a link between the two hexes' facing side nodes. A wall
 * that merely clips a hex's corner emits nothing (the hex before and after
 * the clip are not neighbours). `winding` is the road lying inside the two
 * joined hexes (summed over every segment there) over the distance between
 * their centres, floored at 1 by `makeLink`. See docs/battlemap/DECISIONS.md,
 * "A road is a wall, on every grid."
 *
 * Pure: the grid is an ADAPTER, so this is testable without a scene and works
 * for any hex layout core supports.
 *
 * @param {Array<{seg: number[], surface?: string}>} segments drawn roads
 * @param {object} grid adapter — `offsetAt(point)` → `{i, j}` or null,
 *   `centre(offset)` → `{x, y}`, `facing(from, to)` → `{near, far}` node ids or
 *   null when the two are not neighbours, and `step` (pixels between samples,
 *   which must be smaller than a hex or a hex can be stepped clean over).
 * @returns {object[]} links, deduplicated — two roads crossing one boundary are
 *   one crossing
 */
export function linksFromRoadSegments(segments, grid, { step = null } = {}) {
  const sampleStep = step ?? grid?.step ?? 20;
  /** Contiguous runs of each wall, one per hex it passes through. */
  const walls = [];
  /** Total road length inside each hex, over every segment. */
  const inside = new Map();

  for (const entry of segments ?? []) {
    const seg = entry?.seg ?? entry;
    if (!Array.isArray(seg) || seg.length < 4) continue;
    const [x1, y1, x2, y2] = seg.map(Number);
    if (![x1, y1, x2, y2].every(Number.isFinite)) continue;
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (!length) continue;

    const runs = [];
    const n = Math.max(1, Math.ceil(length / sampleStep));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const offset = grid?.offsetAt?.({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t });
      if (!offset) continue;
      const key = `${offset.i}:${offset.j}`;
      const last = runs[runs.length - 1];
      if (last?.key === key) {
        last.to = t * length;
        continue;
      }
      runs.push({ key, offset, from: t * length, to: t * length });
    }
    for (const run of runs) inside.set(run.key, (inside.get(run.key) ?? 0) + (run.to - run.from));
    walls.push({ runs, surface: entry?.surface });
  }

  let links = [];
  for (const wall of walls) {
    for (let r = 1; r < wall.runs.length; r++) {
      const near = wall.runs[r - 1];
      const far = wall.runs[r];
      const pair = grid?.facing?.(near.offset, far.offset);
      if (!pair) continue;
      const a = grid.centre(near.offset);
      const b = grid.centre(far.offset);
      const across = Math.hypot(b.x - a.x, b.y - a.y);
      const road = ((inside.get(near.key) ?? 0) + (inside.get(far.key) ?? 0)) / 2;
      const link = makeLink(pair.near, pair.far, {
        road: wall.surface ?? "earth",
        winding: across > 0 ? road / across : 1,
      });
      if (link && !hasLink(links, link)) links = withLink(links, link);
    }
  }
  return links;
}
