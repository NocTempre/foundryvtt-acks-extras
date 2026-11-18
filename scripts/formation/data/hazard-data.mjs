/* global foundry */
import { hazardChoices } from "../hazard-keys.mjs";

/** Localize a key, or give the key back where no `game` stands: a choices function runs wherever core validates a stored value. */
const say = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;

/**
 * Data model for the `acks-extras.hazard` Item sub-type: one obstacle or one
 * condition a place can carry. The `key` names which (see `hazard-keys.mjs`);
 * a blank key is a hazard not yet chosen, which adds nothing when dropped. The
 * item holds no figures: a place's row types a length, a gap or a depth, so one
 * hazard serves places of different sizes.
 */
export default class HazardData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    // Resolved here rather than at module scope, so the file imports without Foundry.
    const fields = foundry.data.fields;
    return {
      // The choices are a function so labels localize when the sheet renders; it never throws, because core validates a stored value against it outside any try.
      key: new fields.StringField({ required: true, blank: true, initial: "", choices: () => hazardChoices(say) }),
      description: new fields.HTMLField({ required: false, blank: true }),
    };
  }
}
