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
import { MODULE_ID, LANG_PREFIX, LOCATION_TYPE, REQUIRED_LIB_API } from "./constants.mjs";
import { registerStoreSetting, registerPersisted, ruledataImport } from "./table-store.mjs";
import { RuledataBrowser, openRuledataBrowser } from "./ruledata-browser.mjs";
import { LocationData } from "./data/location-data.mjs";
import { LocationSheet, registerLocationSheet } from "./apps/location-sheet.mjs";
import { installStorageTab } from "./apps/storage-tab.mjs";
import { StorageManagerMenu, openStorageManager, installManagerRefresh } from "./apps/storage-manager.mjs";
import { runVaultSweep } from "./vault-sweep.mjs";

const TEMPLATES = [
  `modules/${MODULE_ID}/templates/location/location-sheet.hbs`,
  `modules/${MODULE_ID}/templates/location/storage-tab.hbs`,
  `modules/${MODULE_ID}/templates/location/storage-manager.hbs`,
];

Hooks.once("init", () => {
  registerStoreSetting();

  const lib = globalThis.acksExtras.lib;
  if (!lib?.services || (lib.apiVersion ?? 0) < 3) {
    console.error(`${MODULE_ID} | acks-lib >= 0.8.0 (apiVersion 3+) is required — table import disabled`);
    return;
  }
  lib.services.register("ruledata-import", ruledataImport);
  const n = registerPersisted();
  console.log(`${MODULE_ID} | ruledata-import provider ready (${n} persisted table layer(s) mirrored)`);

  game.settings.registerMenu(MODULE_ID, "ruledataBrowser", {
    name: "ACKS-LOCATION.browser.menuName",
    label: "ACKS-LOCATION.browser.menuLabel",
    hint: "ACKS-LOCATION.browser.menuHint",
    icon: "fas fa-table-list",
    type: RuledataBrowser,
    restricted: true,
  });

  // Storage needs a newer library than the tables work does. Gate it on its own
  // so an older acks-lib costs the storage half, not the whole module.
  if ((lib.apiVersion ?? 0) < REQUIRED_LIB_API || !lib.storage) {
    console.error(`${MODULE_ID} | acks-lib >= 0.39.0 (apiVersion ${REQUIRED_LIB_API}+) is required — location storage disabled`);
    return;
  }

  // A normal module registers its data model at INIT: Foundry has already
  // finalized CONFIG.Actor.dataModels from the manifests by the time this runs.
  // (acks-lib, being library:true, has to wait for `setup` — the asymmetry is
  // load order, not style. See its module.mjs.)
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
  foundry.applications.handlebars.loadTemplates(TEMPLATES).catch(() => {});

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
  const module = game.modules.get(MODULE_ID);
  acksExtras.location = { openRuledataBrowser, openStorageManager, runVaultSweep, LOCATION_TYPE, LocationSheet };
  if (module) module.api = acksExtras;

  if (game.system?.id !== "acks") return;
  if (!globalThis.acksExtras.lib?.storage) return;
  // One client sweeps: it creates actors and moves coin. Elected the same way
  // the library elects its deletion fallback.
  if (!game.users.activeGM?.isSelf) return;
  runVaultSweep().catch((err) => console.error(`${MODULE_ID} | vault sweep failed`, err));
});
