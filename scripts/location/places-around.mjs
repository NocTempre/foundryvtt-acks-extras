/* global game */
/**
 * "Which places hold this point": the places whose AREA the point is in. A
 * place's area is the first of these that exists for it on the scene asked
 * about: its linked Region, its own token's footprint (`here.mjs`), or its
 * linked map. A place with a Region is therefore held by that Region and by
 * nothing else of its, even when a token of it also stands on the scene.
 *
 * Reads only through the location feature's own readers (`scene-link.mjs`,
 * `here.mjs`), so what "the place's Region" or "the place's token" means is
 * decided once, there.
 */
import { tokenCentre } from "../lib/token-centre.mjs";
import { LOCATION_TYPE } from "./constants.mjs";
import { placeReachesSpot, placeStandsOn } from "./here.mjs";
import { regionOfLocation, sceneOfLocation } from "./scene-link.mjs";

/** The areas, most specific first. */
const SPECIFICITY = ["region", "token", "map"];

/** `{scene, point, elevation}` for a token document or a bare `{x, y, elevation?}` point; null for anything else. */
function spotOf(subject, scene) {
  if (!scene || !subject) return null;
  if (typeof subject.parent === "object" && subject.parent !== null && "width" in subject) {
    return { scene, point: tokenCentre(subject, scene, subject._source ?? subject), elevation: subject.elevation ?? 0 };
  }
  const x = Number(subject.x);
  const y = Number(subject.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { scene, point: { x, y }, elevation: Number(subject.elevation) || 0 } : null;
}

/** Which of a place's areas holds the spot (`region`, `token` or `map`), or null. */
function areaHolding(place, spot) {
  const region = regionOfLocation(place);
  if (region) return region.parent === spot.scene && region.testPoint({ ...spot.point, elevation: spot.elevation }) ? "region" : null;
  if (placeStandsOn(spot.scene, place)) return placeReachesSpot(place, spot) ? "token" : null;
  return sceneOfLocation(place) === spot.scene ? "map" : null;
}

/**
 * The places whose area holds a point of a scene, the most specific area first
 * (a Region, then a token's footprint, then a whole map) and in the world's actor
 * order within each, so a caller taking the first takes the closest place.
 * @param {TokenDocument|{x: number, y: number, elevation?: number}} subject a token (its centre) or a point in scene pixels
 * @param {Scene} scene
 * @returns {Array<{place: Actor, area: "region"|"token"|"map"}>} each place once, with the area that holds the point
 */
export function placesAround(subject, scene) {
  const spot = spotOf(subject, scene);
  if (!spot) return [];
  const out = [];
  for (const place of game.actors.filter((a) => a.type === LOCATION_TYPE)) {
    const area = areaHolding(place, spot);
    if (area) out.push({ place, area });
  }
  return out.sort((a, b) => SPECIFICITY.indexOf(a.area) - SPECIFICITY.indexOf(b.area));
}
