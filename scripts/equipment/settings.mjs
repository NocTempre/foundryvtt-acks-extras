/* global game */
import { MODULE_ID, SETTINGS, ENFORCE } from "./constants.mjs";
import { ACTOR_TYPE } from "../lib/vocab.mjs";

const L = (k) => `ACKS-EQUIPMENT.settings.${k}`;

/** Reader for one overlay's on/off world setting. */
export const overlayGate = (key) => () => !!game.settings.get(MODULE_ID, key);

/**
 * Rebuild the loadout effect of every character this client owns. The
 * overlays the loadout effect writes (the enclosing helm's part, the shield
 * variants' AC and hand rules) are read at sync time, so flipping one is
 * inert until a sync runs; `refreshLoadout` gates on the loadout's manager and
 * on the one window that writes, so on every client only that window writes.
 */
function resyncLoadouts(refreshLoadout) {
  for (const actor of game.actors?.filter?.((a) => a.type === ACTOR_TYPE.character && a.isOwner) ?? []) {
    Promise.resolve(refreshLoadout(actor)).catch((err) => console.error(`${MODULE_ID} | overlay loadout sync failed for ${actor.name}`, err));
  }
}

/**
 * Register all world/client settings. Called at init.
 *
 * @param {object} [options]
 * @param {(actor: Actor) => Promise<void>} [options.refreshLoadout]  rebuilds
 *   one actor's loadout effect; supplied by the module entry, so this
 *   file stays a leaf the overlays import for their gates.
 */
export function registerSettings({ refreshLoadout } = {}) {
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
  // `loadout` marks an overlay the loadout effect reads: its change rebuilds
  // every owned character's effect.
  const overlay = (key, def = false, { loadout = false } = {}) =>
    game.settings.register(MODULE_ID, key, {
      name: L(`${key}.name`),
      hint: L(`${key}.hint`),
      scope: "world",
      config: true,
      type: Boolean,
      default: def,
      ...(loadout && refreshLoadout ? { onChange: () => resyncLoadouts(refreshLoadout) } : {}),
    });

  overlay(SETTINGS.OVERLAY_SHIELD_VARIANTS, false, { loadout: true });
  overlay(SETTINGS.OVERLAY_MANEUVERS, true);
  overlay(SETTINGS.OVERLAY_ITEM_LOSS);
  overlay(SETTINGS.OVERLAY_NAMED);
  overlay(SETTINGS.OVERLAY_SCAVENGED);
  // Enclosing helm (RR ch. 4): applied by overlays/enclosing-helm.mjs through
  // the loadout effect; its Mortal Wounds modifier is core's.
  overlay(SETTINGS.OVERLAY_ENCLOSING_HELM, false, { loadout: true });
  // Mounted combat (RR p. 308): overlays/mounted.mjs, riding the lib's mounted
  // state.
  overlay(SETTINGS.OVERLAY_MOUNTED);
}

/** Convenience getter. */
export function setting(key) {
  return game.settings.get(MODULE_ID, key);
}
