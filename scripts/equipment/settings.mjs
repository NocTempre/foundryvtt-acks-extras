/* global game */
import { MODULE_ID, SETTINGS, ENFORCE } from "./constants.mjs";

const L = (k) => `ACKS-EQUIPMENT.settings.${k}`;

/** Reader for one overlay's on/off world setting. */
export const overlayGate = (key) => () => !!game.settings.get(MODULE_ID, key);

/** Register all world/client settings. Called at init. */
export function registerSettings() {
  game.settings.register(MODULE_ID, SETTINGS.ENFORCE_MODE, {
    name: L("enforceMode.name"),
    hint: L("enforceMode.hint"),
    scope: "world",
    config: true,
    type: String,
    choices: {
      [ENFORCE.RESOLVE]: L("enforceMode.resolve"),
      [ENFORCE.VETO]: L("enforceMode.veto"),
      [ENFORCE.ADVISORY]: L("enforceMode.advisory"),
    },
    default: ENFORCE.RESOLVE,
  });

  game.settings.register(MODULE_ID, SETTINGS.PROFICIENCY_ENFORCEMENT, {
    name: L("proficiencyEnforcement.name"),
    hint: L("proficiencyEnforcement.hint"),
    scope: "world",
    config: true,
    type: String,
    choices: {
      auto: L("proficiencyEnforcement.auto"),
      on: L("proficiencyEnforcement.on"),
      off: L("proficiencyEnforcement.off"),
    },
    default: "on",
    requiresReload: true,
  });

  game.settings.register(MODULE_ID, SETTINGS.ROLL_AUTOMATION, {
    name: L("rollAutomation.name"),
    hint: L("rollAutomation.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, SETTINGS.AMMO_TRACKING, {
    name: L("ammoTracking.name"),
    hint: L("ammoTracking.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, SETTINGS.DEFAULT_HAND_BUDGET, {
    name: L("defaultHandBudget.name"),
    hint: L("defaultHandBudget.hint"),
    scope: "world",
    config: true,
    type: Number,
    default: 2,
    range: { min: 1, max: 8, step: 1 },
  });

  // Optional-rule overlays (RAW). Off by default except standard shields which
  // are already core; each toggle is world-scoped.
  const overlay = (key, def = false) =>
    game.settings.register(MODULE_ID, key, {
      name: L(`${key}.name`),
      hint: L(`${key}.hint`),
      scope: "world",
      config: true,
      type: Boolean,
      default: def,
    });

  overlay(SETTINGS.OVERLAY_SHIELD_VARIANTS);
  overlay(SETTINGS.OVERLAY_MANEUVERS, true);
  overlay(SETTINGS.OVERLAY_ITEM_LOSS);
  overlay(SETTINGS.OVERLAY_NAMED);
  overlay(SETTINGS.OVERLAY_SCAVENGED);
  // Enclosing helm (RR ch. 4, "Helmet, Heavy"): a heavy helmet's surprise
  // modifier is applied by overlays/enclosing-helm.mjs through the loadout
  // effect, at the figure the import holds; its Mortal Wounds modifier is
  // already core (AcksActor#hasHeavyHelm), name-based.
  overlay(SETTINGS.OVERLAY_ENCLOSING_HELM);
  // Mounted combat (RR p. 308): the staying-mounted save prompts and the
  // action-economy card — overlays/mounted.mjs, riding the lib's mounted
  // state. A toggle is registered only for an overlay with rules behind it.
  overlay(SETTINGS.OVERLAY_MOUNTED);
}

/** Convenience getter. */
export function setting(key) {
  return game.settings.get(MODULE_ID, key);
}
