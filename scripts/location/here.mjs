/* global game */
/**
 * "Under" and "on the ground": reaching a place through its own TOKEN rather
 * than through a scene link.
 *
 * `scene-link.mjs` answers "is this whole map a place" — an inn's taproom
 * scene IS the inn. This file answers a narrower question: is there a
 * place's own token sitting right where a character is standing, inside a
 * scene that is not itself linked to anything — a market cart or a shrine
 * dropped into a town square scene, reachable the way any prop on the map is
 * reachable, by walking up to it.
 *
 * Two readers, and they are not interchangeable. `placeReachesSpot` answers
 * about ONE named place and is what a gate asks; `placeUnderParty` answers
 * "which place, if any" and is what a display asks. Both walk the same tokens
 * through the same two tests, so they can never disagree about the ground.
 *
 * Every test here is of a token's FOOTPRINT — its x/y/width/height in scene
 * pixels, padded by the scene's own square — never a radius picked by feel: a
 * radius invites a location's "reach" to grow independently of how big its own
 * token actually is.
 *
 * A SPOT is `{scene, point, elevation}`: somewhere a character is standing.
 * `partyPoint` (formation/zones.mjs) returns one, which is what keeps this
 * file's answers in the same pixel space as every other "where is the party"
 * question in the family.
 */
import { LOCATION_TYPE } from "./constants.mjs";
import { partyPoint } from "../formation/zones.mjs";

/**
 * A token's centre point, in scene pixels: grid-unit width/height times the
 * scene's grid size. The third copy of that arithmetic in the tree, and kept
 * separate because NEITHER of the others is reachable: `partyPoint` inlines
 * the expression rather than exporting it, and `lib/light.mjs`'s `centreOf` is
 * private. That coercion — `Number(...) || 0` — is not a divergence from this
 * one: `centreOf` also centres AmbientLights, which carry no width or height,
 * while a TokenDocument's are schema numbers.
 */
export function tokenCenter(token, gridSize) {
  return { x: token.x + (token.width * gridSize) / 2, y: token.y + (token.height * gridSize) / 2 };
}

/**
 * Is this point within reach of this token's footprint?
 *
 * The footprint is padded by one grid square on every side: a character
 * standing in the square next to a location's token — not stacked on the
 * token's own square — is still "at" it, which is the gesture of walking up to
 * a prop rather than teleporting onto it. Rotation is not applied: a place's
 * own token is a flat map marker, not a combatant that turns to face
 * something, so its footprint does not turn with it.
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
 * Are these two elevations the same floor?
 *
 * The band is the scene's own square distance — `grid.distance`, the figure
 * the scene declares one square to be worth — so a token raised or flying a
 * step above the ground still stands at what is beneath it, while a storey up
 * in a multi-level scene does not. It is the vertical half of the one-square
 * padding `footprintReaches` applies horizontally, and like it nothing in it is
 * a number chosen here. A scene that declares no distance falls back to exact
 * equality rather than to a guess.
 */
function sameFloor(a, b, scene) {
  const band = Number(scene?.grid?.distance) || 0;
  return Math.abs((a ?? 0) - (b ?? 0)) <= band;
}

/**
 * The visible place tokens on a scene: every location's, or one named place's.
 *
 * A named place is matched by its BASE actor id, the id a token carries whether
 * or not it is linked. `token.actor` on an unlinked token — Foundry's default,
 * and nothing in this feature sets `prototypeToken.actorLink` — is a per-token
 * synthetic document whose uuid is never the world actor's, so an identity test
 * routed through it is false for every ordinary map.
 *
 * A GM-hidden token is skipped: hidden means not there for anyone standing on
 * it, the same rule `lib/light.mjs`'s light-source reader applies to a hidden
 * light source.
 */
function* placeTokensOn(scene, place = null) {
  for (const token of scene?.tokens ?? []) {
    if (token.hidden) continue;
    if (place ? token.actorId !== place.id : token.actor?.type !== LOCATION_TYPE) continue;
    yield token;
  }
}

/**
 * Does a token of THIS place stand within reach of this spot?
 *
 * The predicate a reach gate wants. `placeUnderParty` cannot serve that
 * purpose: it answers with whichever place it meets first, so a caller asking
 * about the second of two neighbouring markers is told no about the wrong one.
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

/** Does this place have a visible token anywhere on this scene? */
export function placeStandsOn(scene, place) {
  for (const _token of placeTokensOn(scene, place)) return true;
  return false;
}

/**
 * The location actor whose own token the party is standing at, or null.
 *
 * The WORLD actor, resolved from the token's base id — what a caller can
 * compare a uuid against and what holds the place's storage. Where two place
 * tokens both reach the party, the scene's own token order decides which is
 * named; a caller that needs an answer about one particular place asks
 * `placeReachesSpot` instead.
 *
 * @returns {Actor|null}
 */
export function placeUnderParty(formation) {
  const at = partyPoint(formation);
  if (!at) return null;
  const gridSize = at.scene.grid.size;
  for (const token of placeTokensOn(at.scene)) {
    if (!sameFloor(token.elevation, at.elevation, at.scene)) continue;
    if (footprintReaches(token, at.point, gridSize)) return game.actors?.get(token.actorId) ?? null;
  }
  return null;
}
