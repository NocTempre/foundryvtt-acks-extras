/**
 * Scene Regions, read through core.
 *
 * The core Region owns shape, levels, elevation, membership and area; this
 * file only asks it. A module behavior type (a district, an encounter zone, a
 * trap zone) is configuration on a Region, so every question a feature asks
 * about "the zone here" is one of the five below, and none of them computes
 * a Region's geometry that core keeps:
 *
 * - `regionsUnder` — the Regions a token stands in, as core keeps them
 *   (`TokenDocument#regions`, a footprint test that honours levels).
 * - `regionsAt` — the Regions over a point, for a place no token stands on.
 * - `regionRings` — the solid outline of a Region.
 * - `regionDistance` — how far a path lies from a Region, for the trap sweep.
 * - `regionArea` — the area a Region covers.
 *
 * Both finders answer `{region, behavior}` pairs in the scene's own region
 * order, so a caller that takes the first keeps the same "first zone" answer
 * wherever it asks from. A Region carrying two enabled behaviors of the type
 * answers once, with the first.
 *
 * Foundry-free: every call goes through a document passed in.
 */
import { segmentDistance } from "./wall-geometry.mjs";

/** The first enabled behavior of `type` on a Region, or undefined. */
const behaviorOf = (region, type) => region.behaviors?.find((b) => b.type === type && !b.disabled);

/**
 * The Regions a token stands in that carry an enabled behavior of `type`.
 *
 * Membership is core's: `token.regions` tests the token's whole footprint at
 * its level, at the stored destination of every move. The moving client works
 * it out before the write and every client applies it before `updateToken`
 * fires, so a hook reads the destination's Regions even while its own client
 * draws the move. A Region made or reshaped under a standing token updates it
 * a moment later, in a write of its own. The answer is ordered by the scene's
 * Regions, since the Set is ordered by arrival.
 *
 * @param {TokenDocument} token a token placed on a scene
 * @param {string} type the region behavior sub-type to look for
 * @returns {Array<{region: RegionDocument, behavior: RegionBehavior}>}
 */
export function regionsUnder(token, type) {
  const standing = token?.regions;
  if (!standing?.size) return [];
  const out = [];
  for (const region of token.parent?.regions ?? []) {
    if (!standing.has(region)) continue;
    const behavior = behaviorOf(region, type);
    if (behavior) out.push({ region, behavior });
  }
  return out;
}

/**
 * The Regions over a point of a scene that carry an enabled behavior of `type`.
 *
 * `region.testPoint` applies the Region's own elevation range (the floor
 * inclusive, the ceiling only when the Region says so, and a flat Region at
 * its one elevation) and its shapes, holes and wall restriction included. A
 * `level` (a Level id) first drops the Regions that belong to other Levels;
 * a Region naming no Level belongs to every one, and so does every Region of
 * a scene with no Levels. With no `level` the Level test is skipped, since
 * core's `includedInLevel` takes an id or a Level and throws on neither.
 *
 * @param {Scene} scene
 * @param {{x: number, y: number}} point canvas pixels
 * @param {{elevation?: number, level?: string}} [where] the point's elevation
 *   (default 0, the scene's ground) and, where known, the Level it is on
 * @param {string} type the region behavior sub-type to look for
 * @returns {Array<{region: RegionDocument, behavior: RegionBehavior}>}
 */
export function regionsAt(scene, point, { elevation = 0, level } = {}, type) {
  const out = [];
  for (const region of scene?.regions ?? []) {
    const behavior = behaviorOf(region, type);
    if (!behavior) continue;
    if (level && !region.includedInLevel(level)) continue;
    if (region.testPoint({ x: point.x, y: point.y, elevation })) out.push({ region, behavior });
  }
  return out;
}

/**
 * A Region's solid outlines as closed rings of `[x, y, x, y, …]` canvas pixels.
 *
 * Read off core's `polygonTree`, the Region's shapes already combined (curves
 * tessellated, a `grid` shape's cells merged into their outer boundary, a
 * hole cut out, the wall restriction applied). Holes are left out. An island
 * standing inside a hole is solid again and is a ring of its own.
 *
 * @param {RegionDocument} region
 * @returns {number[][]} one ring per solid node; empty for a Region with no
 *   geometry
 */
export function regionRings(region) {
  const rings = [];
  for (const node of region?.polygonTree ?? []) {
    if (node.isHole) continue;
    const points = node.points ?? [];
    if (points.length >= 6) rings.push([...points]);
  }
  return rings;
}

/**
 * How far a segment lies from the ground a Region covers, in canvas pixels; 0
 * where either end stands on it or the stretch between crosses it.
 *
 * Each end is asked of core's `polygonTree`: `testPoint` says whether it is
 * inside, and `findClosestPoint` gives the nearest point of the covered ground
 * (a hole's rim counts, so a point standing in a hole measures to the hole's
 * edge, not to the outer outline). Core has no segment-to-tree question, so a
 * moving segment adds the stretch between its ends: its closest approach to
 * every edge of every node, holes included, found with `segmentDistance`. A
 * zero-length segment, a standing party, is answered by core alone.
 *
 * The test is planar: the Region's elevation range and Levels are not applied,
 * which is what a distance sweep over a scene's traps measures.
 *
 * @param {RegionDocument} region
 * @param {number[]} seg `[x1, y1, x2, y2]` canvas pixels
 * @returns {number} Infinity for a Region with no geometry
 */
export function regionDistance(region, seg) {
  const tree = region?.polygonTree;
  if (!tree) return Infinity;
  let best = Infinity;
  for (const p of [
    { x: seg[0], y: seg[1] },
    { x: seg[2], y: seg[3] },
  ]) {
    if (tree.testPoint(p)) return 0;
    const near = tree.findClosestPoint(p);
    if (near) best = Math.min(best, Math.hypot(near.x - p.x, near.y - p.y));
  }
  if (seg[0] === seg[2] && seg[1] === seg[3]) return best;
  for (const node of tree) {
    const pts = node.points ?? [];
    const n = pts.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      best = Math.min(best, segmentDistance(seg, [pts[i * 2], pts[i * 2 + 1], pts[j * 2], pts[j * 2 + 1]]));
      if (best === 0) return 0;
    }
  }
  return best;
}

/**
 * The area a Region covers, in square canvas pixels: core's `region.area`, the
 * combined polygons' area less its holes. Shapes drawn over one another count
 * once, since core has merged them before measuring.
 *
 * @param {RegionDocument} region
 * @returns {number}
 */
export function regionArea(region) {
  return region?.area ?? 0;
}
