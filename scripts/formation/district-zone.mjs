/* global foundry, CONFIG, game */
import { SETTLEMENT_LOCATIONS } from "./settlement.mjs";
import { DISTRICT_TYPE, findDistrict, districtAt } from "./district-find.mjs";

/**
 * "District" scene-region behavior: draw a Region over a quarter of a city
 * and give it its own encounter cadence, tables and reaction figure. A
 * district is the outermost of three layers (street → zone → district);
 * `resolveCityCadence` in [settlement.mjs](./settlement.mjs) performs the
 * precedence, per field, and reads the field names below. See
 * docs/formation/DECISIONS.md, "A district states a day figure and a night
 * figure, not a figure and a shift".
 *
 * The point-in-region geometry lives in `zones.mjs`. The readers — which
 * district the party stands in, which is drawn over a point — live in
 * `district-find.mjs` and are re-exported here.
 */

export { DISTRICT_TYPE, findDistrict, districtAt };

/**
 * Where a district's reaction figure applies, as a select. A function, not
 * a frozen object: `StringField` evaluates a callable `choices` at render
 * time, and core does not localize choice labels handed to it as strings.
 * See docs/formation/DECISIONS.md, "A district's reaction figure is signed,
 * and never inherits".
 */
function reactionWhereChoices() {
  // Falls back to the key rather than throwing. Core validates a stored value
  // against this list too, and that path is NOT wrapped in a try — so a
  // choices function that can throw is a field that can refuse to load.
  const say = (key) => game?.i18n?.localize?.(key) ?? key;
  const out = { any: say("ACKS-FORMATION.DISTRICT.anywhere") };
  for (const [key, spec] of Object.entries(SETTLEMENT_LOCATIONS)) out[key] = say(spec.label);
  return out;
}

export class DistrictBehavior extends foundry.data.regionBehaviors.RegionBehaviorType {
  static LOCALIZATION_PREFIXES = ["ACKS-FORMATION.DISTRICT"];

  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      tableUuid: new fields.DocumentUUIDField({ type: "RollTable" }),
      // Selected over `tableUuid` while the board is `wanted`. See
      // docs/formation/DECISIONS.md, "Being hunted is a board fact, and it
      // does not travel".
      wantedTableUuid: new fields.DocumentUUIDField({ type: "RollTable" }),
      // What the city's own list hands its roll to for one stretch of it; not
      // a replacement for `tableUuid`. See docs/formation/DECISIONS.md, "A
      // city's own list belongs to its map, and hands one band to the quarter".
      specialTableUuid: new fields.DocumentUUIDField({ type: "RollTable" }),
      // 0 = inherit the layer outside this one, on each field independently.
      encounterEveryDay: new fields.NumberField({ required: true, initial: 0, min: 0, max: 24, integer: true }),
      encounterEveryNight: new fields.NumberField({ required: true, initial: 0, min: 0, max: 24, integer: true }),
      encounterTargetDay: new fields.NumberField({ required: true, initial: 0, min: 0, max: 6, integer: true }),
      encounterTargetNight: new fields.NumberField({ required: true, initial: 0, min: 0, max: 6, integer: true }),
      // Signed; 0 means "no adjustment", never "inherit" — never passed
      // through the cadence layering's `stated()`. See
      // docs/formation/DECISIONS.md, "A district's reaction figure is
      // signed, and never inherits".
      reactionModifier: new fields.NumberField({ required: true, initial: 0, min: -20, max: 20, integer: true }),
      reactionWhere: new fields.StringField({
        required: true, blank: false, initial: "any", choices: reactionWhereChoices,
      }),
    };
  }
}

/** Register the behavior subtype (called from the init hook). */
export function registerDistrictZone() {
  CONFIG.RegionBehavior.dataModels[DISTRICT_TYPE] = DistrictBehavior;
  if (CONFIG.RegionBehavior.typeIcons) CONFIG.RegionBehavior.typeIcons[DISTRICT_TYPE] = "fa-solid fa-city";
}
