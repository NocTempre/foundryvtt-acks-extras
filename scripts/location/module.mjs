/* global game, CONFIG, Hooks, CONST */
/**
 * acks-location — location primitives for the ACKS II module family.
 *
 * Scope:
 *  - the `ruledata-import` provider (world-persisted rules tables mirrored into
 *    acksLib.tables on every client) and the Ruledata Browser — the GM's
 *    audit-and-tweak surface;
 *  - the `acks-location.location` actor and the STORAGE experience built on
 *    acks-lib's storage primitives: the location sheet, the character sheet's
 *    Storage tab, the retirement of the system's banked-coin column, the vault
 *    sweep that moves old balances somewhere real, and the GM storage manager.
 *
 * The location actor here is deliberately LEAN (identity + storage). The market
 * schema on acks-henchmen's own location sub-type keeps working untouched;
 * moving that data is its own program, and doing it as a side effect of the
 * storage work would put a migration between a player and their belongings.
 */
import { acksExtras } from "../namespace.mjs";
import { MODULE_ID, LANG_PREFIX, LOCATION_TYPE } from "./constants.mjs";

/** World setting: empty, unremarkable locations self-clean at ready. */
const PRUNE_SETTING = "pruneEmptyLocations";
import { registerStoreSetting, registerPersisted, ruledataImport } from "./table-store.mjs";
import { RuledataBrowser, openRuledataBrowser } from "./ruledata-browser.mjs";
import { LocationData } from "./data/location-data.mjs";
import { LocationSheet, registerLocationSheet } from "./apps/location-sheet.mjs";
import { installStorageTab } from "./apps/storage-tab.mjs";
import { StorageManagerMenu, openStorageManager, installManagerRefresh } from "./apps/storage-manager.mjs";
import { runVaultSweep } from "./vault-sweep.mjs";
import {
  createLocationForScene,
  linkScene,
  locationOfScene,
  registerSceneConfigRow,
  registerSceneContextMenu,
  registerSceneLinkSync,
  sceneOfLocation,
  unlinkScene,
} from "./scene-link.mjs";
import { depositReach, reachablePlaces, pinnedPlaces, setPinnedPlace, companionIds } from "./reach.mjs";

const TEMPLATES = [
  `modules/${MODULE_ID}/templates/location/location-sheet.hbs`,
  `modules/${MODULE_ID}/templates/location/storage-tab.hbs`,
  `modules/${MODULE_ID}/templates/location/storage-manager.hbs`,
];

Hooks.once("init", () => {
  registerStoreSetting();

  // NEVER gate this on an apiVersion check. lib is a sibling feature, not a
  // separately-installed dependency: it attaches at import time
  // (scripts/lib/module.mjs, module scope), so it is always present and always
  // this exact version by the time any init hook runs. A guard here could only
  // fire spuriously, and an early return would skip the sheet registration
  // below — taking the whole location sheet, market and all, down with it.
  const lib = globalThis.acksExtras?.lib;
  lib.services.register("ruledata-import", ruledataImport);
  const n = registerPersisted();
  console.log(`${MODULE_ID} | ruledata-import provider ready (${n} persisted table layer(s) mirrored)`);

  game.settings.register(MODULE_ID, PRUNE_SETTING, {
    name: `${LANG_PREFIX}.settings.pruneEmpty.name`,
    hint: `${LANG_PREFIX}.settings.pruneEmpty.hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.registerMenu(MODULE_ID, "ruledataBrowser", {
    name: "ACKS-LOCATION.browser.menuName",
    label: "ACKS-LOCATION.browser.menuLabel",
    hint: "ACKS-LOCATION.browser.menuHint",
    icon: "fas fa-table-list",
    type: RuledataBrowser,
    restricted: true,
  });

  // The data model and the sheet for `acks-extras.location` register HERE and
  // only here — this feature owns the sub-type. Unconditional, deliberately:
  // the registration must never sit behind a capability check, because failing
  // it costs the market UI as well as the sheet.
  CONFIG.Actor.dataModels[LOCATION_TYPE] = LocationData;
  registerLocationSheet();

  game.settings.registerMenu(MODULE_ID, "storageManager", {
    name: `${LANG_PREFIX}.manager.menuName`,
    label: `${LANG_PREFIX}.manager.menuLabel`,
    hint: `${LANG_PREFIX}.manager.menuHint`,
    icon: "fas fa-warehouse",
    type: StorageManagerMenu,
    restricted: true,
  });

  installStorageTab();
  installManagerRefresh();

  // Scene ↔ place linking. Registered unconditionally, but nothing is ever
  // created without a GM asking: these are a scene-config row, two directory
  // context entries, and the sync that keeps the location's mirror true.
  registerSceneConfigRow();
  registerSceneContextMenu();
  registerSceneLinkSync();

  foundry.applications.handlebars
    .loadTemplates(TEMPLATES)
    .catch((err) => console.warn(`${MODULE_ID} | template preload skipped`, err));

  /**
   * A location is a shared place: players need ownership to leave anything
   * there or take it back. Explicit creation data always wins — that is how the
   * vault sweep makes a PERSONAL vault without this handing it to the table.
   */
  Hooks.on("preCreateActor", (doc, data) => {
    if (doc.type !== LOCATION_TYPE) return;
    const changes = {};
    if (data?.ownership?.default == null) {
      changes.ownership = { ...doc.ownership, default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER };
    }
    // Locations hold goods by construction; anything else needs the flag set
    // deliberately (the manager's "enable storage" does it).
    if (!doc.flags?.["acks-extras"]?.storage) {
      changes.flags = foundry.utils.mergeObject(doc.flags ?? {}, { "acks-extras": { storage: { provider: true } } }, { inplace: false });
    }
    if (Object.keys(changes).length) doc.updateSource(changes);
  });
});

Hooks.once("ready", () => {
  acksExtras.location = {
    openRuledataBrowser,
    openStorageManager,
    runVaultSweep,
    LOCATION_TYPE,
    LocationSheet,
    /** Scene ↔ place linking (scene-link.mjs). The scene's flag is canonical. */
    scenes: { locationOfScene, sceneOfLocation, linkScene, unlinkScene, createLocationForScene },
    /**
     * Who can leave something where (reach.mjs). Exposed because it is a RULE
     * a consumer must not re-derive: a sibling deciding for itself whether a
     * character is at a place would answer differently from the tab beside it.
     */
    reach: { depositReach, reachablePlaces, pinnedPlaces, setPinnedPlace, companionIds },
  };

  if (game.system?.id !== "acks") return;
  // One client sweeps: it creates actors and moves coin. Elected the same way
  // the library elects its deletion fallback.
  if (!game.users.activeGM?.isSelf) return;
  runVaultSweep().catch((err) => console.error(`${MODULE_ID} | vault sweep failed`, err));
  pruneEmptyLocations().catch((err) => console.error(`${MODULE_ID} | empty-location prune failed`, err));
});

/**
 * Cleanup is the DEFAULT for an empty location (owner ruling 2026-08-14): a
 * place holding nothing, remembering nobody, and being nothing in particular
 * is scaffolding, and scaffolding comes down on its own. A location survives
 * empty when it IS something: a market (any market class or a market subtree),
 * someone's vault, or a scene-linked mapped place. Setting-gated for worlds
 * that want their empty rooms kept.
 */
export async function pruneEmptyLocations() {
  if (!game.settings.get(MODULE_ID, PRUNE_SETTING)) return { pruned: 0 };
  const doomed = game.actors.filter((a) => {
    if (a.type !== LOCATION_TYPE) return false;
    if (a.items.size > 0) return false;
    if ((a.system?.roster ?? []).length > 0) return false;
    if (a.system?.market != null || a.system?.marketClass != null) return false;
    if (a.getFlag(MODULE_ID, "storage")?.vaultOf) return false;
    if (sceneOfLocation(a)) return false;
    return true;
  });
  for (const a of doomed) await a.delete();
  if (doomed.length) {
    console.log(`${MODULE_ID} | pruned ${doomed.length} empty location(s): ${doomed.map((a) => a.name).join(", ")}`);
  }
  return { pruned: doomed.length };
}
