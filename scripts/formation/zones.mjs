/* global foundry */
import { getPartyToken } from "./formation-model.mjs";
import { roadUnder } from "../battlemap/roads.mjs";
import { effectiveWhere } from "./settlement.mjs";
import { truePositionToken } from "./shadow.mjs";
import { regionArea as libRegionArea, regionRings, regionsAt } from "../lib/regions.mjs";

/**
 * Where the party token is standing, in region terms.
 *
 * Shared by every scene-region behavior this feature defines (Encounter Zones,
 * Trap Zones): how "inside" is decided lives here once.
 *
 * Region behavior sub-types must extend `RegionBehaviorType`, not a plain
 * `TypeDataModel`: core pathfinding calls `_getTerrainEffects()` on every
 * enabled behavior (`Token#createTerrainMovementPath`).
 */

/* -------------------------------------------- */
/*  Point-in-region testing                     */
/* -------------------------------------------- */

/**
 * Does a region contain the point at this elevation? Core's
 * `RegionDocument#testPoint`, which takes an ElevatedPoint, applies the
 * region's elevation range and works without the canvas (geometry lives on the
 * document).
 */
export function regionContains(regionDoc, point, elevation) {
  return regionDoc.testPoint({ x: point.x, y: point.y, elevation });
}

/* -------------------------------------------- */
/*  Region outlines                             */
/* -------------------------------------------- */

/**
 * A region's solid outlines as closed rings of `[x, y, x, y, …]` canvas
 * pixels, holes left out. For distance questions (the trap sweep), which
 * containment cannot answer; `regionRings` has the mechanics.
 */
export function regionOutlines(regionDoc) {
  return regionRings(regionDoc);
}

/**
 * The area a region covers, in square canvas pixels (core's `region.area`),
 * the figure that ranks zones drawn one inside another.
 */
export function regionArea(regionDoc) {
  return libRegionArea(regionDoc);
}

/** Every edge of a region's outlines, as `[x1, y1, x2, y2]` segments. */
export function regionEdges(regionDoc) {
  const edges = [];
  for (const ring of regionRings(regionDoc)) {
    const n = ring.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      edges.push([ring[i * 2], ring[i * 2 + 1], ring[j * 2], ring[j * 2 + 1]]);
    }
  }
  return edges;
}

/* -------------------------------------------- */
/*  Zone lookup                                 */
/* -------------------------------------------- */

/**
 * The zone of a given behavior type the party token currently stands in.
 *
 * The token's centre is the test point, not its corner.
 *
 * @param {object} formation the formation whose party token is placed
 * @param {string} type the region behavior sub-type to look for
 * @returns {{region: RegionDocument, behavior: RegionBehavior}|null}
 */
export function findZone(formation, type) {
  const at = partyPoint(formation);
  return at ? zoneAt(at.scene, at.point, at.elevation, type) : null;
}

/**
 * The zone of a given behavior type drawn over a point of a scene: `findZone`'s
 * test, asked about somewhere the party is not.
 * @returns {{region: RegionDocument, behavior: RegionBehavior}|null}
 */
export function zoneAt(scene, point, elevation, type) {
  return regionsAt(scene, point, { elevation }, type)[0] ?? null;
}

/**
 * Every zone of a given behavior type drawn over a point, in the scene's
 * region order — `zoneAt`'s test without stopping at the first. A region
 * carrying two enabled behaviors of the type answers once, with the first.
 * @returns {Array<{region: RegionDocument, behavior: RegionBehavior}>}
 */
export function zonesAt(scene, point, elevation, type) {
  return regionsAt(scene, point, { elevation }, type);
}

/**
 * Where the party is standing: the scene, the point, and the elevation.
 *
 * The token's centre, the one point every question about the party's ground
 * (zone, district, street) is asked of.
 *
 * @returns {{scene: Scene, token: TokenDocument, point: {x: number, y: number},
 *   elevation: number}|null} null for a party with no token placed anywhere.
 */
export function partyPoint(formation) {
  const token = getPartyToken(formation);
  return token ? tokenPoint(token) : null;
}

/**
 * A token's centre on its own scene, in `partyPoint`'s shape; null for a token
 * on no scene. The corner is the stored one (`_source`, as `storedPosition` in
 * turn-engine.mjs reads it; that module imports this one, so the read is
 * inline), since a drawing client's prepared `x`/`y` are a move's animation.
 */
function tokenPoint(token) {
  const scene = token.parent;
  if (!scene?.grid) return null;
  const gs = scene.grid.size;
  const { x, y } = token._source ?? token;
  return {
    scene,
    token,
    point: { x: x + (token.width * gs) / 2, y: y + (token.height * gs) / 2 },
    elevation: token.elevation ?? 0,
  };
}

/**
 * Where the party really stands on its scene: the centre of the token
 * `truePositionToken` names — the lost episode's shadow while one stands
 * there, else the party's own marker — in `partyPoint`'s shape.
 * @returns {{scene: Scene, token: TokenDocument, point: {x: number, y: number},
 *   elevation: number}|null} null for a party with no token placed anywhere.
 */
export function truePartyPoint(formation) {
  const at = partyPoint(formation);
  if (!at) return null;
  const truth = truePositionToken(at.scene, formation);
  return (truth && truth.id !== at.token.id && tokenPoint(truth)) || at;
}

/**
 * The street the party is standing on, and where that puts them.
 *
 * The one reader for the question, so the street, the zone and the district
 * are answers about the same point.
 *
 * @param {object} formation the formation whose party token is placed
 * @param {object|null} board the settlement board, which carries the picker's
 *   own answer for a party standing on no drawn street
 * @returns {{at: object|null, road: {name: string, surface: string,
 *   street: string}|null, here: object}} `road` is a SNAPSHOT shaped for the
 *   board rather than the live wall; `here` is `effectiveWhere`'s answer and
 *   carries whether the map or the picker supplied it.
 */
export function streetUnder(formation, board) {
  const at = partyPoint(formation);
  const found = at ? roadUnder(at.scene, at.point) : null;
  const road = found ? { name: found.name, surface: found.surface, street: found.street } : null;
  return { at, road, here: effectiveWhere(board, road?.street) };
}
