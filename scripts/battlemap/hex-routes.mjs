/* global game, canvas */
/**
 * Where a scene's routes come from.
 *
 * [hex-topology.mjs](./hex-topology.mjs) is the pure model — nodes, links,
 * hubs, cost. This is the half that knows about a scene: turning a click into a
 * node, and answering what links the scene has.
 *
 * **A road is DRAWN, and the links are derived from it.** A road is a wall
 * ([roads.mjs](./roads.mjs)) on any grid, and on a hex grid the crossings it
 * makes ARE the link set: nothing has to be declared twice, and a street
 * dragged into a new shape brings its links with it. Core's own snapping puts a
 * wall's ends on the hex vertices, side midpoints and centres that the topology
 * addresses, so the two models meet without either reimplementing the other.
 *
 * The older DECLARED links live on in a single scene flag and are read
 * alongside the derived ones, so a world part-way through a network keeps
 * working; `convertRoutesToWalls` retires them into walls. Nothing in the
 * module writes new ones.
 */
import { MODULE_ID } from "../lib/constants.mjs";
import { isHexScene } from "./terrain-paint.mjs";
import {
  nodeId, parseNode, makeLink, withLink, withoutLink, onRoad, routeCost, hubs, linksFromRoadSegments,
} from "./hex-topology.mjs";
import { roadGraph, roadSegmentsOf, roadWallData } from "./roads.mjs";

/** The scene flag holding the legacy declared link set. */
export const ROUTES_FLAG = "hexRoutes";

/**
 * The links a Judge DECLARED on this scene with the retired node tool.
 *
 * Kept apart from the derived ones because this is what the writers read and
 * write back: a write over the union would freeze today's roads into the flag,
 * and the whole point of deriving them is that they follow the walls.
 */
export function declaredRoutesOf(scene) {
  const raw = scene?.getFlag?.(MODULE_ID, ROUTES_FLAG);
  return Array.isArray(raw) ? raw.filter((l) => l && l.a && l.b) : [];
}

/** Derived link sets, keyed by the road network they came from. */
const derived = new WeakMap();

/** The scene's grid, as the adapter the pure derivation asks for. */
function gridAdapter(scene) {
  return {
    // Samples have to be finer than a hex, or a wall can step clean over one
    // and the crossing it made goes unseen.
    step: Math.max(4, (scene.grid?.size ?? 100) / 4),
    offsetAt: (p) => scene.grid.getOffset(p),
    centre: (o) => scene.grid.getCenterPoint(o),
    facing: (from, to) => facingNodes(scene, from, to),
  };
}

/**
 * The links this scene's drawn roads imply.
 *
 * Cached against the road network object itself, which the road layer replaces
 * whenever a wall changes — so the derivation is done once per edit and needs
 * no invalidation of its own.
 */
export function derivedRoutesOf(scene) {
  if (!isHexScene(scene) || !scene.grid?.getOffset) return [];
  const graph = roadGraph(scene);
  if (derived.has(graph)) return derived.get(graph);
  const links = linksFromRoadSegments(roadSegmentsOf(scene), gridAdapter(scene));
  derived.set(graph, links);
  return links;
}

/**
 * Every link on a scene: drawn roads first, then any legacy declaration the
 * roads have not replaced.
 *
 * The drawn road wins a boundary both describe, because the wall is the thing
 * the Judge can see and move.
 */
export function routesOf(scene) {
  const fromRoads = derivedRoutesOf(scene);
  if (!fromRoads.length) return declaredRoutesOf(scene);
  const declared = declaredRoutesOf(scene).filter(
    (l) => !fromRoads.some((r) => r.a === l.a && r.b === l.b));
  return [...declared, ...fromRoads];
}

/**
 * Declare a link on the scene flag. **Legacy** — a road is drawn as a wall now,
 * and nothing in the module calls this; it stays exported for a world's own
 * macros and for the conversion's tests.
 */
export async function declareLink(scene, from, to, { road = "earth", winding = 1 } = {}) {
  if (!game.user?.isGM || !isHexScene(scene)) return false;
  const link = makeLink(from, to, { road, winding });
  if (!link) return false;
  await scene.setFlag(MODULE_ID, ROUTES_FLAG, withLink(declaredRoutesOf(scene), link));
  return true;
}

/**
 * Remove a declared link. **Legacy**, as above — a DERIVED link is removed by
 * editing the wall that draws it, which is the point of drawing it.
 */
export async function removeLink(scene, from, to) {
  if (!game.user?.isGM || !isHexScene(scene)) return false;
  const next = withoutLink(declaredRoutesOf(scene), from, to);
  if (next.length === declaredRoutesOf(scene).length) return false;
  await scene.setFlag(MODULE_ID, ROUTES_FLAG, next);
  return true;
}

/**
 * The middle of the hex a node belongs to.
 *
 * Rounded, because a wall drawn by hand carries the integer core snapped it to
 * and a converted one should be indistinguishable from it.
 */
function hexCentre(scene, id) {
  const n = parseNode(id);
  if (!n || !scene?.grid?.getCenterPoint) return null;
  const c = scene.grid.getCenterPoint({ i: n.i, j: n.j });
  return c ? { x: Math.round(c.x), y: Math.round(c.y) } : null;
}

/**
 * Turn every declared link on this scene into a road wall.
 *
 * The Judge's way off the retired tool, and it is one press rather than a
 * migration: a link becomes a wall carrying the surface it was declared with.
 *
 * The winding a Judge TYPED is not carried across. It cannot be: winding is now
 * measured off the shape of the drawn line, and writing the old figure onto a
 * straight wall would make the two disagree the moment the wall is dragged.
 *
 * Drawn hex MIDDLE to hex middle, never between the link's own two ends: those
 * are the two halves of one shared boundary and sit at the same point, so a wall
 * between them would have no length. A line through both hexes is also the only
 * shape the derivation can re-read, so a converted link comes back as a derived
 * one and the network is unchanged by the press.
 *
 * A link that cannot be placed STAYS on the flag. Clearing the whole flag after
 * a partial conversion would destroy exactly the declarations the press failed
 * to carry.
 *
 * @returns {Promise<{made: number, skipped: number}|null>}
 */
export async function convertRoutesToWalls(scene) {
  if (!game.user?.isGM || !scene) return null;
  const links = declaredRoutesOf(scene);
  if (!links.length) return { made: 0, skipped: 0 };
  const data = [];
  const kept = [];
  for (const link of links) {
    const a = hexCentre(scene, link.a);
    const b = hexCentre(scene, link.b);
    if (!a || !b || (a.x === b.x && a.y === b.y)) {
      kept.push(link);
      continue;
    }
    data.push({ c: [a.x, a.y, b.x, b.y], ...roadWallData({ surface: link.road }) });
  }
  if (data.length) await scene.createEmbeddedDocuments("Wall", data);
  if (kept.length) await scene.setFlag(MODULE_ID, ROUTES_FLAG, kept);
  else await clearRoutes(scene);
  return { made: data.length, skipped: kept.length };
}

/**
 * Where on the map a node sits: a hex's middle, one of its corners, or the
 * midpoint of one of its sides.
 *
 * The inverse of `nodeAtPoint`. Published for a world's own macros; the
 * conversion draws between hex MIDDLES instead, because a link's two ends are
 * one shared boundary and resolve here to the same point.
 */
export function nodePoint(scene, id) {
  const n = parseNode(id);
  if (!n || !scene?.grid?.getCenterPoint) return null;
  const offset = { i: n.i, j: n.j };
  const centre = scene.grid.getCenterPoint(offset);
  if (n.kind === "centre") return centre;
  const v = scene.grid.getVertices?.(offset) ?? [];
  if (!v.length) return centre;
  if (n.kind === "corner") return v[n.index % v.length];
  const a = v[n.index % v.length];
  const b = v[(n.index + 1) % v.length];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Clear every route. The Judge's undo for a network gone wrong. */
export async function clearRoutes(scene) {
  if (!game.user?.isGM) return false;
  await scene.unsetFlag(MODULE_ID, ROUTES_FLAG);
  return true;
}

/**
 * The node nearest a point: which edge, corner, or the middle.
 *
 * A click lands somewhere in a hex, and which of its thirteen nodes the Judge
 * meant is decided by distance. The middle wins only near the centre, so a
 * click anywhere around the rim declares an edge or a corner rather than
 * silently anchoring everything to the middle.
 */
export function nodeAtPoint(scene, point) {
  if (!isHexScene(scene) || !scene.grid?.getOffset) return null;
  const offset = scene.grid.getOffset(point);
  const centre = scene.grid.getCenterPoint(offset);
  const vertices = scene.grid.getVertices?.(offset) ?? [];
  if (!vertices.length) return null;

  const dx = point.x - centre.x;
  const dy = point.y - centre.y;
  const reach = Math.hypot(dx, dy);
  // Inside the inner third is the middle; the rim is edges and corners.
  const radius = Math.hypot(vertices[0].x - centre.x, vertices[0].y - centre.y);
  if (reach < radius / 3) return nodeId(offset.i, offset.j, "centre");

  let best = null;
  vertices.forEach((v, n) => {
    const cd = Math.hypot(point.x - v.x, point.y - v.y);
    if (!best || cd < best.d) best = { d: cd, kind: "corner", index: n };
    const next = vertices[(n + 1) % vertices.length];
    const mid = { x: (v.x + next.x) / 2, y: (v.y + next.y) / 2 };
    const md = Math.hypot(point.x - mid.x, point.y - mid.y);
    if (md < best.d) best = { d: md, kind: "side", index: n };
  });
  return best ? nodeId(offset.i, offset.j, best.kind, best.index) : null;
}

/** Are these two offsets neighbours on this grid? */
export function areAdjacent(scene, fromOffset, toOffset) {
  const list = scene?.grid?.getAdjacentOffsets?.(fromOffset) ?? [];
  return list.some((o) => o.i === toOffset.i && o.j === toOffset.j);
}

/**
 * The two nodes a step between neighbouring hexes touches.
 *
 * A road crossing from one hex to the next is a link between the LEAVING hex's
 * edge node and the ENTERING hex's — two distinct ids at the same physical
 * place, because each belongs to its own cell. Finding them is a nudge from
 * each centre toward the boundary between them.
 *
 * Null when the two are not neighbours, which is what a scripted jump or a
 * teleport looks like and must not be priced as a road.
 */
export function facingNodes(scene, fromOffset, toOffset) {
  if (!isHexScene(scene) || !fromOffset || !toOffset) return null;
  // Adjacency is checked FIRST and against the grid's own neighbours. Any two
  // hexes have a midpoint, so nudging toward it from far apart yields two
  // perfectly valid nodes and a crossing that does not exist — and a link that
  // happened to join them would price a teleport as a road.
  if (!areAdjacent(scene, fromOffset, toOffset)) return null;
  const a = scene.grid.getCenterPoint(fromOffset);
  const b = scene.grid.getCenterPoint(toOffset);
  const boundary = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  // Just short of the boundary from each side, so each lookup lands in its own
  // hex rather than on the seam where either could win.
  const nudge = (from) => ({
    x: from.x + (boundary.x - from.x) * 0.92,
    y: from.y + (boundary.y - from.y) * 0.92,
  });
  const near = nodeAtPoint(scene, nudge(a));
  const far = nodeAtPoint(scene, nudge(b));
  if (!near || !far || near === far) return null;
  return { near, far };
}

/**
 * Is a march STEP between two hexes following a declared route?
 *
 * The question the travel derivation asks once the topology is drawn. It
 * answers about the crossing, not about either hex's contents, which is the
 * whole ruling: a road earns its multiplier only while it is being followed.
 */
export function stepBetweenHexes(scene, fromOffset, toOffset) {
  const pair = facingNodes(scene, fromOffset, toOffset);
  if (!pair) return { on: false, reason: "notAdjacent" };
  return stepOnRoad(scene, pair.near, pair.far);
}

/**
 * Is this step of a march following a declared route?
 *
 * The question the travel derivation asks. Answers `{on: false}` for a scene
 * with no routes at all, which is every scene until a Judge draws one — a map
 * without a network is not a map where everything is off-road by accident, it
 * is a map where the question has not been asked.
 */
export function stepOnRoad(scene, from, to) {
  return onRoad(routesOf(scene), from, to);
}

/** The cost of a route across this scene, or null if it is not connected. */
export function costOf(scene, path) {
  return routeCost(routesOf(scene), path);
}

/** The separate networks on a scene — a bridge and a ford are two. */
export function networksOf(scene) {
  return hubs(routesOf(scene));
}

/** The scene the Judge is looking at, for the tool handlers. */
export function viewedScene() {
  return canvas?.scene ?? null;
}
