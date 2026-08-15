/* global foundry, CONFIG */
import { MODULE_ID } from "./constants.mjs";
import { findZone } from "./zones.mjs";

/**
 * "Encounter Zone" scene-region behavior: draw a Region over part of a map and
 * attach this behavior to key wandering-monster encounters to that zone — a
 * custom RollTable and, optionally, overrides for the throw cadence and target
 * value (0 = inherit the module settings). When the party token stands inside
 * the region, the zone's configuration wins over the formation's default table
 * and the world settings.
 *
 * The point-in-region geometry is shared with every other zone behavior and
 * lives in `zones.mjs`, which also states why these extend `RegionBehaviorType`.
 */

export const ENCOUNTER_ZONE_TYPE = `${MODULE_ID}.encounterZone`;

export class EncounterZoneBehavior extends foundry.data.regionBehaviors.RegionBehaviorType {
  static LOCALIZATION_PREFIXES = ["ACKS-FORMATION.ENCOUNTER_ZONE"];

  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      tableUuid: new fields.DocumentUUIDField({ type: "RollTable" }),
      encounterEvery: new fields.NumberField({ required: true, initial: 0, min: 0, max: 24, integer: true }),
      encounterTarget: new fields.NumberField({ required: true, initial: 0, min: 0, max: 6, integer: true }),
      // Which floor this is. Compared against the drawn table's own monster
      // level to bend the encounter (JJ ch. 2); 0 means "do not scale".
      dungeonLevel: new fields.NumberField({ required: true, initial: 0, min: 0, max: 20, integer: true }),
    };
  }
}

/** Register the behavior subtype (called from the init hook). */
export function registerEncounterZone() {
  CONFIG.RegionBehavior.dataModels[ENCOUNTER_ZONE_TYPE] = EncounterZoneBehavior;
  if (CONFIG.RegionBehavior.typeIcons) CONFIG.RegionBehavior.typeIcons[ENCOUNTER_ZONE_TYPE] = "fa-solid fa-dice-d6";
}

/**
 * The encounter zone the party token currently stands in, if any.
 * @returns {{region: RegionDocument, behavior: RegionBehavior}|null}
 */
export function findEncounterZone(formation) {
  return findZone(formation, ENCOUNTER_ZONE_TYPE);
}
