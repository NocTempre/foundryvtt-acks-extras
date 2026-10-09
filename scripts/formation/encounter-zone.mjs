/* global foundry, CONFIG, game */
import { MODULE_ID } from "./constants.mjs";
import { findZone, regionArea, truePartyPoint, zonesAt } from "./zones.mjs";
import { composeZones, sourceLayers } from "./zone-layers.mjs";

/**
 * "Encounter Zone" scene-region behavior: draw a Region over part of a map and
 * attach this behavior to key wandering-monster encounters to that zone — a
 * custom RollTable and, optionally, overrides for the throw cadence and target
 * value (0 = inherit the module settings). When the party token stands inside
 * the region, the zone's configuration wins over the formation's default table
 * and the world settings.
 *
 * The delve reads the FIRST zone under the party token (`findEncounterZone`).
 * A journey reads EVERY zone under the party's true position and composes them
 * field by field (`journeyZones`, `zone-layers.mjs`), and has fields of its
 * own: the cadence a zone imposes and the throws End Day makes inside it.
 *
 * The point-in-region geometry is shared with every other zone behavior and
 * lives in `zones.mjs`, which also states why these extend `RegionBehaviorType`.
 */

export const ENCOUNTER_ZONE_TYPE = `${MODULE_ID}.encounterZone`;

/**
 * How a zone paces a journey's throws, besides inheriting (blank): one throw
 * on entering, or End Day's own counts in place of the per-unit throws.
 */
export const JOURNEY_CADENCES = Object.freeze(["entry", "periods"]);

/**
 * The journey cadence as a select. A function, so the labels are localized
 * when the field renders; it falls back to the key rather than throwing,
 * because core validates a stored value against it outside any try.
 */
function journeyCadenceChoices() {
  const say = (key) => game?.i18n?.localize?.(key) ?? key;
  return Object.fromEntries(JOURNEY_CADENCES.map((c) => [c, say(`ACKS-FORMATION.ENCOUNTER_ZONE.CADENCE.${c}`)]));
}

/** The behavior's data model: the table, the delve's overrides, and the journey's. */
export class EncounterZoneBehavior extends foundry.data.regionBehaviors.RegionBehaviorType {
  static LOCALIZATION_PREFIXES = ["ACKS-FORMATION.ENCOUNTER_ZONE"];

  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      tableUuid: new fields.DocumentUUIDField({ type: "RollTable" }),
      // In dungeon turns; a journey never reads it.
      encounterEvery: new fields.NumberField({ required: true, initial: 0, min: 0, max: 24, integer: true }),
      encounterTarget: new fields.NumberField({ required: true, initial: 0, min: 0, max: 6, integer: true }),
      // Which floor this is. Compared against the monster level of the table
      // that named the monster (JJ p. 36); 0 means "do not scale".
      dungeonLevel: new fields.NumberField({ required: true, initial: 0, min: 0, max: 20, integer: true }),
      // Blank inherits; the select's blank option is core's, added for a blank field.
      journeyCadence: new fields.StringField({ required: true, blank: true, initial: "", choices: journeyCadenceChoices }),
      dayThrows: new fields.NumberField({ required: true, initial: 0, min: 0, max: 6, integer: true }),
      nightThrows: new fields.NumberField({ required: true, initial: 0, min: 0, max: 6, integer: true }),
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

/**
 * The encounter zones under a journeying party's TRUE position
 * (`truePartyPoint`), composed field by field, smallest zone first
 * (`composeZones`).
 *
 * @returns {{fields: object, sources: object, layers: object[], regions: RegionDocument[]}}
 *   `fields` and `sources` are `composeZones`'s; each layer is `{area, fields,
 *   region, behavior}` for one zone the party stands in, in scene order;
 *   `regions` are the distinct regions that supplied a field. A party with no
 *   token, or standing in no zone, gets every field at its default and empty
 *   lists.
 */
export function journeyZones(formation) {
  const at = truePartyPoint(formation);
  const hits = at ? zonesAt(at.scene, at.point, at.elevation, ENCOUNTER_ZONE_TYPE) : [];
  const layers = hits.map(({ region, behavior }) => ({ area: regionArea(region), fields: behavior.system ?? {}, region, behavior }));
  const composed = composeZones(layers);
  return { ...composed, layers, regions: sourceLayers(composed).map((layer) => layer.region) };
}
