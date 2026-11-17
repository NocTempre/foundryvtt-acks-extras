/**
 * Scene Regions, read through core.
 *
 * The core Region owns shape, levels, elevation, membership and area; this
 * file only asks it. A module behavior type (a district, an encounter zone, a
 * trap zone) is configuration on a Region, so every question a feature asks
 * about "the zone here" is one of the four below, and none of them computes
 * geometry:
 *
 * - `regionsUnder` — the Regions a token stands in, as core keeps them
 *   (`TokenDocument#regions`, a footprint test that honours levels).
 * - `regionsAt` — the Regions over a point, for a place no token stands on.
 * - `regionRings` — the solid outline of a Region, for distance questions.
 * - `regionArea` — the area a Region covers.
 *
 * Both finders answer `{region, behavior}` pairs in the scene's own region
 * order, so a caller that takes the first keeps the same "first zone" answer
 * wherever it asks from. A Region carrying two enabled behaviors of the type
 * answers once, with the first.
 *
 * Foundry-free: every call goes through a document passed in.
 */

/** The first enabled behavior of `type` on a Region, or undefined. */
const behaviorOf = (region, type) => region.behaviors?.find((b) => b.type === type && !b.disabled);

/**
 * The Regions a token stands in that carry an enabled behavior of `type`.
 *
 * Membership is core's: `token.regions` is kept current by the server on every
 * move and tests the token's whole footprint at its level. The answer is
 * ordered by the scene's Regions, since the Set is ordered by arrival.
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
 * hole cut out, the wall restriction applied). Holes are left out: a distance
 * question measures to the outside of a shape. An island standing inside a
 * hole is solid again and is a ring of its own.
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
