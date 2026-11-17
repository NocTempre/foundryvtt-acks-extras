/* global foundry */
import { getPartyToken } from "./formation-model.mjs";
import { roadUnder } from "../battlemap/roads.mjs";
import { effectiveWhere } from "./settlement.mjs";
import { truePositionToken } from "./shadow.mjs";
import { regionArea as libRegionArea, regionRings, regionsAt, regionsUnder } from "../lib/regions.mjs";

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
 * pixels, holes left out; `regionRings` has the mechanics.
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

/* -------------------------------------------- */
/*  Zone lookup                                 */
/* -------------------------------------------- */

/**
 * The zone of a given behavior type the party token currently stands in.
 *
 * Membership is core's footprint test (`zonesUnder`), which reads the token's
 * stored position, size and Level, not its centre: a token wider than one cell
 * stands in a zone that holds any cell of it. The first zone is the first in
 * the scene's region order.
 *
 * @param {object} formation the formation whose party token is placed
 * @param {string} type the region behavior sub-type to look for
 * @returns {{region: RegionDocument, behavior: RegionBehavior}|null}
 */
export function findZone(formation, type) {
  const token = getPartyToken(formation);
  return token ? (zonesUnder(token, type)[0] ?? null) : null;
}

/**
 * Every zone of a given behavior type a token stands in, in the scene's region
 * order: core's `token.regions`, kept current on every move, as `regionsUnder`
 * has it. The question for a token; `zonesAt` is the one for a point where no
 * token stands.
 * @returns {Array<{region: RegionDocument, behavior: RegionBehavior}>}
 */
export function zonesUnder(token, type) {
  return regionsUnder(token, type);
}

/**
 * The zone of a given behavior type drawn over a point of a scene, asked about
 * somewhere no token stands. `level` is the Level id the point is on, where
 * known.
 * @returns {{region: RegionDocument, behavior: RegionBehavior}|null}
 */
export function zoneAt(scene, point, elevation, type, level) {
  return regionsAt(scene, point, { elevation, level }, type)[0] ?? null;
}

/**
 * Every zone of a given behavior type drawn over a point, in the scene's
 * region order — `zoneAt`'s test without stopping at the first. A region
 * carrying two enabled behaviors of the type answers once, with the first.
 * @returns {Array<{region: RegionDocument, behavior: RegionBehavior}>}
 */
export function zonesAt(scene, point, elevation, type, level) {
  return regionsAt(scene, point, { elevation, level }, type);
}

/**
 * Where the party is standing: the scene, the point, the elevation and the
 * Level.
 *
 * The token's centre, the one point the questions about the party's ground
 * that are asked of a point (street, place, scene) share. The zone and the
 * district are not among them: a token's zone is its footprint's
 * (`zonesUnder`), so for a token wider than one cell it can name a zone the
 * centre is not over.
 *
 * @returns {{scene: Scene, token: TokenDocument, point: {x: number, y: number},
 *   elevation: number, level: string|undefined}|null} `level` is the token's
 *   Level id, absent where the token names none; null for a party with no
 *   token placed anywhere.
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
  const { x, y, level } = token._source ?? token;
  return {
    scene,
    token,
    point: { x: x + (token.width * gs) / 2, y: y + (token.height * gs) / 2 },
    elevation: token.elevation ?? 0,
    level: typeof level === "string" ? level : undefined,
  };
}

/**
 * Where the party really stands on its scene: the centre of the token
 * `truePositionToken` names — the lost episode's shadow while one stands
 * there, else the party's own marker — in `partyPoint`'s shape. Its `token` is
 * the one whose footprint `zonesUnder` asks about.
 * @returns {{scene: Scene, token: TokenDocument, point: {x: number, y: number},
 *   elevation: number, level: string|undefined}|null} null for a party with no
 *   token placed anywhere.
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
 * The one reader for the question, so the street and `here` are answers about
 * the same point, the party's centre.
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
