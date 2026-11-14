/* global game */
/**
 * "Under" and "on the ground": reaching a place through its own TOKEN rather
 * than through a scene link.
 *
 * `scene-link.mjs` answers "is this whole map a place"; this file answers
 * whether a place's own token stands where a character is, in a scene that is
 * not itself linked.
 *
 * `placeReachesSpot` answers about ONE named place (what a gate asks);
 * `placeUnderParty` answers "which place, if any" (what a display asks). Both
 * walk the same tokens through the same two tests. Every test is of a token's
 * FOOTPRINT in scene pixels, padded by the scene's own square, never a radius.
 *
 * A SPOT is `{scene, point, elevation}`, as `partyPoint` (formation/zones.mjs)
 * returns it.
 * See docs/location/DECISIONS.md, "Deposit reach asks one question of one subject".
 */
import { LOCATION_TYPE } from "./constants.mjs";
import { partyPoint } from "../formation/zones.mjs";
import { isDeployed } from "../lib/place.mjs";

/**
 * Does this token's actor stand on the map AS a place: a location, or a
 * provider deployed as one (a circled wagon, a moored ship)? The one question
 * points of interest, the place under the party and the walk to a place ask.
 */
export const standsAsPlace = (actor) => actor?.type === LOCATION_TYPE || isDeployed(actor);

/**
 * A token's centre point, in scene pixels: grid-unit width/height times the
 * scene's grid size.
 */
export function tokenCenter(token, gridSize) {
  return { x: token.x + (token.width * gridSize) / 2, y: token.y + (token.height * gridSize) / 2 };
}

/**
 * Is this point within reach of this token's footprint? The footprint is
 * padded by one grid square on every side; rotation is not applied.
 */
function footprintReaches(token, point, gridSize) {
  const pad = gridSize;
  const x0 = token.x - pad;
  const y0 = token.y - pad;
  const x1 = token.x + token.width * gridSize + pad;
  const y1 = token.y + token.height * gridSize + pad;
  return point.x >= x0 && point.x <= x1 && point.y >= y0 && point.y <= y1;
}

/**
 * Are these two elevations the same floor? The band is the scene's own
 * `grid.distance`; a scene declaring none compares exactly.
 */
function sameFloor(a, b, scene) {
  const band = Number(scene?.grid?.distance) || 0;
  return Math.abs((a ?? 0) - (b ?? 0)) <= band;
}

/**
 * The visible place tokens on a scene: every place's (`standsAsPlace`), or one
 * named place's.
 *
 * A named place is matched by its BASE actor id (`token.actorId`), never
 * through `token.actor`, whose uuid on an unlinked token is never the world
 * actor's. A GM-hidden token is skipped.
 */
function* placeTokensOn(scene, place = null) {
  for (const token of scene?.tokens ?? []) {
    if (token.hidden) continue;
    if (place ? token.actorId !== place.id : !standsAsPlace(token.actor)) continue;
    yield token;
  }
}

/**
 * Does a token of THIS place stand within reach of this spot?
 *
 * The predicate a reach gate asks; `placeUnderParty` answers with whichever
 * place it meets first and cannot stand in for it.
 *
 * @param {Actor} place the location actor
 * @param {{scene: object, point: {x: number, y: number}, elevation: number}} spot
 */
export function placeReachesSpot(place, spot) {
  if (!place || !spot?.scene) return false;
  const gridSize = spot.scene.grid.size;
  for (const token of placeTokensOn(spot.scene, place)) {
    if (!sameFloor(token.elevation, spot.elevation, spot.scene)) continue;
    if (footprintReaches(token, spot.point, gridSize)) return true;
  }
  return false;
}

/**
 * The visible place tokens on a scene, as documents — the points of interest
 * a walk can be made to, and the count the settlement board decides by.
 */
export function placesOnScene(scene) {
  return [...placeTokensOn(scene)];
}

/** Does this place have a visible token anywhere on this scene? */
export function placeStandsOn(scene, place) {
  for (const _token of placeTokensOn(scene, place)) return true;
  return false;
}

/**
 * The place actor — a location, or a vehicle deployed as a place — whose own
 * token the party is standing at, or null.
 *
 * The WORLD actor, resolved from the token's base id. Where two place tokens
 * both reach the party, the scene's token order decides which is named; a
 * caller asking about one particular place uses `placeReachesSpot`.
 *
 * @returns {Actor|null}
 */
export function placeUnderParty(formation) {
  const at = partyPoint(formation);
  if (!at) return null;
  const gridSize = at.scene.grid.size;
  // A location outranks a deployed vehicle beside it.
  let deployed = null;
  for (const token of placeTokensOn(at.scene)) {
    if (!sameFloor(token.elevation, at.elevation, at.scene)) continue;
    if (!footprintReaches(token, at.point, gridSize)) continue;
    const place = game.actors?.get(token.actorId) ?? null;
    if (place?.type === LOCATION_TYPE) return place;
    deployed ??= place;
  }
  return deployed;
}
