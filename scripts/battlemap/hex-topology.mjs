/**
 * A hex is not a cell: it has sides, corners and a middle.
 *
 * Painting a road as a property of a hex answers the wrong question. A road is
 * not something a hex HAS, it is something a party FOLLOWS — and following it
 * means entering by one edge and leaving by another. A hex the road merely
 * passes through the corner of is not a hex you can drive across.
 *
 * So a hex carries thirteen addressable NODES: six sides, six corners, and a
 * centre. Connections are declared between nodes, a hex may hold several
 * unconnected ones — a bridge and a ford in the same hex need not join — and a
 * route is a walk over those connections.
 *
 * Two consequences the travel rules actually care about:
 *
 *  - **A road applies only ALONG a declared path.** Being in a hex that
 *    contains one earns nothing. This is also what makes "the party is on a
 *    road" a fact rather than a guess, which the navigation rule leans on.
 *  - **A winding road is longer than the hex is wide.** Following the bends
 *    costs distance the straight crossing does not, and that cost is explicit:
 *    a road is usually still worth it, but the trade is visible rather than
 *    free.
 *
 * Pure geometry and bookkeeping — no Foundry, no canvas. What a link is WORTH
 * lives in the travel tables as it always has.
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
 * `centre` is `m` for middle, NOT its own first letter: "corner" and "centre"
 * both begin with c, and sharing a prefix would make a hex's middle and its
 * first corner the same node.
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
 * The connected components of a link set — the HUBS.
 *
 * A hex may hold several, and they need not join: a bridge over a gorge and a
 * ford below it are two ways through the same cell that do not meet. Returning
 * them as separate components is what lets a route refuse to teleport between
 * them.
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
 * The cost of following a route, against crossing straight.
 *
 * `winding` is a per-link multiplier: 1 is a link as short as the crossing it
 * replaces, and anything above it is the bends. The tax is what the road adds
 * in DISTANCE, and it is reported separately from what the road saves in
 * SPEED — the two are different currencies, and a readout that netted them
 * would hide the trade the Judge is meant to see.
 *
 * Returns null for a route that is not actually connected, rather than pricing
 * a walk nobody could take.
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
 * Is the party ON a road for this step?
 *
 * The question the travel derivation and the navigation rule both ask, and the
 * reason the topology exists: a road earns its multiplier and its
 * no-getting-lost only while it is being followed.
 */
export function onRoad(links, from, to) {
  const [a, b] = [from, to].sort();
  const link = (links ?? []).find((l) => l.a === a && l.b === b);
  return link ? { on: true, road: link.road, winding: link.winding } : { on: false };
}
