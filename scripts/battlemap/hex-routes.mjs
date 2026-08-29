/* global game, canvas */
/**
 * Where a scene's declared routes live.
 *
 * [hex-topology.mjs](./hex-topology.mjs) is the pure model — nodes, links,
 * hubs, cost. This is the half that knows about a scene: reading the link set
 * off it, writing one back, and turning a click into a node.
 *
 * Links are a single scene FLAG rather than one document each. A route network
 * is read on every step of every march, and a hundred Region documents would
 * be a hundred documents to load, index and keep in sync for something that is
 * only ever consulted as a whole. Terrain earns its regions because terrain is
 * DRAWN; a link is a fact about the map, not a shape on it.
 */
import { MODULE_ID } from "../lib/constants.mjs";
import { isHexScene } from "./terrain-paint.mjs";
import { nodeId, makeLink, withLink, withoutLink, onRoad, routeCost, hubs } from "./hex-topology.mjs";

/** The scene flag holding the declared link set. */
export const ROUTES_FLAG = "hexRoutes";

/** Every link declared on a scene. Always an array, never null. */
export function routesOf(scene) {
  const raw = scene?.getFlag?.(MODULE_ID, ROUTES_FLAG);
  return Array.isArray(raw) ? raw.filter((l) => l && l.a && l.b) : [];
}

/** Declare a link, replacing any between the same two nodes. */
export async function declareLink(scene, from, to, { road = "earth", winding = 1 } = {}) {
  if (!game.user?.isGM || !isHexScene(scene)) return false;
  const link = makeLink(from, to, { road, winding });
  if (!link) return false;
  await scene.setFlag(MODULE_ID, ROUTES_FLAG, withLink(routesOf(scene), link));
  return true;
}

/** Remove a link. Safe to call when there is none. */
export async function removeLink(scene, from, to) {
  if (!game.user?.isGM || !isHexScene(scene)) return false;
  const next = withoutLink(routesOf(scene), from, to);
  if (next.length === routesOf(scene).length) return false;
  await scene.setFlag(MODULE_ID, ROUTES_FLAG, next);
  return true;
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
