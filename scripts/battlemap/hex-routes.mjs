/* global canvas */
/**
 * Where a scene's routes come from. `hex-topology.mjs` is the pure model —
 * nodes, links, hubs, cost; this is the half that knows about a scene:
 * turning a click into a node, and answering what links the scene has.
 *
 * Roads are drawn as walls (`roads.mjs`); on a hex grid their crossings ARE
 * the link set, derived rather than declared. Nothing here stores links.
 */
import { isHexScene } from "./terrain-paint.mjs";
import {
  nodeId, parseNode, onRoad, routeCost, hubs, linksFromRoadSegments,
} from "./hex-topology.mjs";
import { roadGraph, roadSegmentsOf } from "./roads.mjs";

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
 * Every link on a scene: the ones its drawn roads imply. A road is a wall the
 * Judge can see and move, so editing the wall is how a link is changed.
 */
export function routesOf(scene) {
  return derivedRoutesOf(scene);
}

/**
 * Where on the map a node sits: a hex's middle, one of its corners, or the
 * midpoint of one of its sides.
 *
 * The inverse of `nodeAtPoint`. Published for a world's own macros.
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
  // Checked first, against the grid's own neighbours — any two hexes have a
  // midpoint, so skipping this would price a teleport as a road.
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
