/* global game */
import { MODULE_ID, SETTINGS, ENFORCE } from "./constants.mjs";

const L = (k) => `ACKS-EQUIPMENT.settings.${k}`;

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

  game.settings.register(MODULE_ID, SETTINGS.PAPERDOLL_STRATEGY, {
    name: L("paperdollStrategy.name"),
    hint: L("paperdollStrategy.hint"),
    scope: "world",
    config: true,
    type: String,
    choices: {
      auto: L("paperdollStrategy.auto"),
      paperdoll: L("paperdollStrategy.paperdoll"),
      fallback: L("paperdollStrategy.fallback"),
    },
    default: "auto",
  });

  // Internal: tracks that the ACKS slot layout has been pushed to Paper Doll
  // once, so a GM's later slot customisation is never overwritten.
  game.settings.register(MODULE_ID, SETTINGS.PAPERDOLL_CONFIGURED, {
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
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
  // Enclosing helm (RR p140): a heavy helmet's −1 surprise / −4 Listening are
  // applied by overlays/enclosing-helm.mjs (the loadout effect + a surfaced note);
  // +2 Mortal Wounds is already core (AcksActor#hasHeavyHelm), name-based.
  overlay(SETTINGS.OVERLAY_ENCLOSING_HELM);

  // NOT REGISTERED — deliberately. OVERLAY_MOUNTED and OVERLAY_BEASTMAN have no
  // implementation behind them: no code reads these keys. They were showing in
  // the settings UI as working toggles that silently did nothing. The keys and
  // their localised strings are kept so wiring them up is a one-line change once
  // the overlays exist.
  //
  // MOUNTED is no longer BLOCKED — acks-lib records who is riding what, and the
  // one flat mounted rule the module already had authored (a phalanx shield is
  // unusable from horseback) is now enforced under the shield-variant overlay
  // that owns it. What is still missing is a mounted overlay's worth of rules
  // to put behind a toggle of its own: shield encumbrance is not implemented at
  // all, and the self-or-mount protection choice is a player's decision each
  // round rather than a derivable fact. Registering an empty toggle would put
  // the silently-does-nothing switch back.
}

/** Convenience getter. */
export function setting(key) {
  return game.settings.get(MODULE_ID, key);
}
