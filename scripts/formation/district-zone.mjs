/* global foundry, CONFIG, game */
import { MODULE_ID } from "./constants.mjs";
import { findZone } from "./zones.mjs";
import { SETTLEMENT_LOCATIONS } from "./settlement.mjs";

/**
 * "District" scene-region behavior: draw a Region over a quarter of a city and
 * give the whole quarter its own character — how often the streets throw by day
 * and by night, which table answers when they do, which table answers when the
 * quarter's own powers are hunting the party, and how the locals take to
 * strangers there.
 *
 * A district is the OUTERMOST of three layers and the widest: the street the
 * party is standing on, then an Encounter Zone drawn over a few blocks, then
 * the district drawn over the quarter. Precedence runs street → zone →
 * district, per field — `resolveCityCadence` in
 * [settlement.mjs](./settlement.mjs) is where that is performed, and the field
 * names below are the ones it reads.
 *
 * The shape is the one a settlement gazetteer prints for a quarter (JJ ch. 7):
 * a day figure and a night figure rather than one figure and a shift, because
 * that is how a quarter is described and because two figures cannot disagree
 * about which of them applies. Every number is the Judge's to type from their
 * own book — the module ships the boxes and none of the values.
 *
 * The point-in-region geometry is shared with every other zone behavior and
 * lives in `zones.mjs`, which also states why these extend `RegionBehaviorType`.
 */

export const DISTRICT_TYPE = `${MODULE_ID}.district`;

/**
 * Where a district's reaction figure applies, as a select.
 *
 * A FUNCTION, not a frozen object: `StringField` evaluates a callable `choices`
 * at render time, and core does not localize choice labels it is handed as
 * strings — so a static map would put raw i18n keys in the select.
 *
 * The vocabulary is `any` plus the street vocabulary the board already uses, so
 * a district states its reaction the way the board states its place and no new
 * spelling of "where" enters the feature. `holedUp` is in the list for free and
 * is meant: a quarter can be unwelcoming to sleep in and unremarkable to walk
 * through.
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
      // The quarter's own powers, looking for this party in particular. A
      // SECOND table rather than a modifier on the first: what a watch that is
      // hunting you sends is a different list, not the ordinary list rolled
      // higher.
      wantedTableUuid: new fields.DocumentUUIDField({ type: "RollTable" }),
      // 0 = inherit the layer outside this one, on each field independently.
      // Bounds mirror the street's: a cadence in turns, a target on 1d6.
      encounterEveryDay: new fields.NumberField({ required: true, initial: 0, min: 0, max: 24, integer: true }),
      encounterEveryNight: new fields.NumberField({ required: true, initial: 0, min: 0, max: 24, integer: true }),
      encounterTargetDay: new fields.NumberField({ required: true, initial: 0, min: 0, max: 6, integer: true }),
      encounterTargetNight: new fields.NumberField({ required: true, initial: 0, min: 0, max: 6, integer: true }),
      // SIGNED, and 0 means "no adjustment" rather than "inherit" — which is
      // why this one never goes through the cadence layering's `stated()`,
      // whose whole job is to read 0 as inherit and to reject a negative.
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

/**
 * The district the party token currently stands in, if any.
 * @returns {{region: RegionDocument, behavior: RegionBehavior}|null}
 */
export function findDistrict(formation) {
  return findZone(formation, DISTRICT_TYPE);
}
