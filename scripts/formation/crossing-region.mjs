/* global foundry, CONFIG, game, Hooks */
import { CROSSING_OBSTACLE_TYPE } from "./constants.mjs";
import { OBSTACLES } from "./obstacles.mjs";
import {
  ENTRY_MODES, KIND_BOUND_FIELDS, NUMBER_FIELDS, FLAG_FIELDS, OBSTACLE_KEYS, REGION_KINDS, hiddenFieldsOf,
} from "./crossing-region-logic.mjs";
import { elementOf } from "../lib/util.mjs";

/**
 * "Crossing obstacle" scene-region behaviour: draw a Region over a river, a
 * chasm or a cliff face and give it the party's crossing setup, so the Judge
 * need not type it each time the party reaches it. The behaviour holds the
 * setup and what happens when the party enters (`onEntry`); `regionSeed` in
 * `crossing-region-logic.mjs` turns it into the crossing's own setup keys.
 *
 * It extends `RegionBehaviorType`, like every zone behaviour, and its window
 * is core's: the fields below are the module's, and `installCrossingObstacleConfig`
 * hides the ones the chosen kind does not use. A number field starts blank and
 * a yes/no field starts on its blank option, so a blank figure is one the Judge
 * sets on the sheet, and no printed value is a default here.
 */

export { CROSSING_OBSTACLE_TYPE };

/** The localization prefix of the behaviour's fields and choice labels. */
const LANG_PREFIX = "ACKS-FORMATION.CROSSING_OBSTACLE";

/** Localize a key, or give the key back where no `game` stands: a choices function runs wherever core validates a stored value. */
const say = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;

/** The region's kinds as a select. A function, so labels are localized when the field renders; it never throws, because core validates a stored value against it outside any try. */
function kindChoices() {
  return Object.fromEntries(REGION_KINDS.map((kind) => [kind, say(`${LANG_PREFIX}.KIND.${kind}`)]));
}

/** The climb's obstacles as a select, labelled by the crossing's own obstacle labels. */
function obstacleChoices() {
  return Object.fromEntries(OBSTACLE_KEYS.map((key) => [key, say(OBSTACLES[key].label)]));
}

/** What the party's entry does, as a select. */
function entryChoices() {
  return Object.fromEntries(ENTRY_MODES.map((mode) => [mode, say(`${LANG_PREFIX}.ENTRY.${mode}`)]));
}

/** A yes/no field's two choices. The blank option is core's, added for a blank field. */
function yesNoChoices() {
  return { yes: say(`${LANG_PREFIX}.YES_NO.yes`), no: say(`${LANG_PREFIX}.YES_NO.no`) };
}

/** The behaviour's data model: the kind, the art, the setup the kind uses, and what entry does. */
export class CrossingObstacleBehavior extends foundry.data.regionBehaviors.RegionBehaviorType {
  static LOCALIZATION_PREFIXES = [LANG_PREFIX];

  static defineSchema() {
    const fields = foundry.data.fields;
    const schema = {
      kind: new fields.StringField({ required: true, blank: false, initial: REGION_KINDS[0], choices: kindChoices }),
      // The Judge's own copy supplies any picture; blank leaves the kind's glyph in the frame.
      art: new fields.FilePathField({ required: false, nullable: true, blank: true, initial: null, categories: ["IMAGE"] }),
      onEntry: new fields.StringField({ required: true, blank: false, initial: ENTRY_MODES[0], choices: entryChoices }),
      // A climb names its obstacle; the first of the crossing's own list stands until the Judge picks.
      obstacle: new fields.StringField({ required: true, blank: false, initial: OBSTACLE_KEYS[0], choices: obstacleChoices }),
    };
    // Blank is "the Judge sets it on the sheet", for a figure and for a yes/no alike.
    for (const key of NUMBER_FIELDS) schema[key] = new fields.NumberField({ required: true, nullable: true, initial: null, min: 0 });
    for (const key of FLAG_FIELDS) schema[key] = new fields.StringField({ required: true, blank: true, initial: "", choices: yesNoChoices });
    return schema;
  }
}

/** Register the behaviour sub-type (called from the init hook). */
export function registerCrossingObstacle() {
  CONFIG.RegionBehavior.dataModels[CROSSING_OBSTACLE_TYPE] = CrossingObstacleBehavior;
  if (CONFIG.RegionBehavior.typeIcons) CONFIG.RegionBehavior.typeIcons[CROSSING_OBSTACLE_TYPE] = "fa-solid fa-route";
}

/**
 * Show the fields the kind uses and hide the rest. Each field's group is found
 * by its control's name under the window root; a field the window does not
 * hold is skipped.
 * @param {{querySelector: Function}} root the behaviour window's root element
 * @param {string} kind a region kind
 */
export function applyKindVisibility(root, kind) {
  const hidden = new Set(hiddenFieldsOf(kind));
  for (const key of KIND_BOUND_FIELDS) {
    const group = root.querySelector(`[name="system.${key}"]`)?.closest?.(".form-group");
    if (!group) continue;
    group.hidden = hidden.has(key);
    group.style.display = hidden.has(key) ? "none" : "";
  }
}

/**
 * Keep a Crossing obstacle's window showing only its kind's fields: applied on
 * every render, and again whenever the kind pick changes, read from the pick's
 * live value so an unsaved change takes effect at once. The window's parts are
 * replaced on render, so the listener is attached fresh each time.
 */
export function installCrossingObstacleConfig() {
  Hooks.on("renderRegionBehaviorConfig", (app, element) => {
    if (app?.document?.type !== CROSSING_OBSTACLE_TYPE) return;
    const root = elementOf(element);
    if (!root) return;
    const pick = root.querySelector('[name="system.kind"]');
    const apply = () => applyKindVisibility(root, pick?.value || app.document.system?.kind);
    apply();
    pick?.addEventListener("change", apply);
  });
}
