/**
 * Finding a district — the readers that need no Foundry class at load.
 *
 * The district behaviour itself (`district-zone.mjs`) extends a core class
 * and so can only be loaded inside Foundry; the two questions everything
 * else asks about districts — which one the party stands in, which one is
 * drawn over a point — are geometry over `zones.mjs` and are kept here, so
 * the travel engine and the hunt feed can import them without dragging the
 * class along.
 */
import { MODULE_ID } from "./constants.mjs";
import { findZone, zoneAt } from "./zones.mjs";

/** The district behaviour's sub-type id. */
export const DISTRICT_TYPE = `${MODULE_ID}.district`;

/**
 * The district the party token currently stands in, if any.
 * @returns {{region: RegionDocument, behavior: RegionBehavior}|null}
 */
export function findDistrict(formation) {
  return findZone(formation, DISTRICT_TYPE);
}

/**
 * The district drawn over a point of a scene, if any — the far end of a walk
 * to a point of interest is asked this way.
 * @returns {{region: RegionDocument, behavior: RegionBehavior}|null}
 */
export function districtAt(scene, point, elevation = 0) {
  return zoneAt(scene, point, elevation, DISTRICT_TYPE);
}
