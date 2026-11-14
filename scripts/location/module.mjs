/* global game, CONFIG, Hooks, CONST */
/**
 * The location feature: location primitives for the module.
 *
 * Scope:
 *  - the `ruledata-import` provider (world-persisted rules tables mirrored into
 *    the lib tables registry on every client) and the Ruledata Browser — the GM's
 *    audit-and-tweak surface;
 *  - the `acks-extras.location` actor and the STORAGE experience built on
 *    the lib storage primitives: the location sheet, the character sheet's
 *    Storage tab, the retirement of the system's banked-coin column, the vault
 *    sweep that moves banked balances somewhere real, and the GM storage manager.
 */
import { acksExtras } from "../namespace.mjs";
import { MODULE_ID, LANG_PREFIX, LOCATION_TYPE } from "./constants.mjs";
import { primaryGMSettled } from "../lib/util.mjs";
import { allPlaces, emptyOfPlaces } from "../lib/place.mjs";
import { hasWrittenNotes } from "./notes.mjs";

/** World setting: empty, unremarkable locations self-clean at ready. */
const PRUNE_SETTING = "pruneEmptyLocations";
import { registerStoreSetting, registerPersisted, ruledataImport } from "./table-store.mjs";
import { RuledataBrowser, openRuledataBrowser } from "./ruledata-browser.mjs";
import { LocationData } from "./data/location-data.mjs";
import { LocationSheet, registerLocationSheet } from "./apps/location-sheet.mjs";
import { installStorageTab } from "./apps/storage-tab.mjs";
import { StorageManagerMenu, openStorageManager, installManagerRefresh } from "./apps/storage-manager.mjs";
import { runVaultSweep, vaultFor, payIntoVault } from "./vault-sweep.mjs";
import {
  createLocationForRegion,
  createLocationForScene,
  linkRegion,
  linkScene,
  locationOfRegion,
  locationOfScene,
  regionOfLocation,
  registerSceneConfigRow,
  registerSceneContextMenu,
  registerSceneLinkSync,
  sceneOfLocation,
  unlinkRegion,
  unlinkScene,
} from "./scene-link.mjs";
import { depositReach, reachablePlaces, pinnedPlaces, setPinnedPlace, companionIds } from "./reach.mjs";
import { placeStandsOn, placeUnderParty, placesOnScene } from "./here.mjs";
import { registerLocationRepairChecks } from "./repair-checks.mjs";

/** The icon a place is made with when its maker names none: core's own house. */
const PLACE_IMG = "icons/svg/house.svg";

const TEMPLATES = [
  `modules/${MODULE_ID}/templates/location/location-sheet.hbs`,
  `modules/${MODULE_ID}/templates/location/storage-tab.hbs`,
  `modules/${MODULE_ID}/templates/location/storage-manager.hbs`,
];

Hooks.once("init", () => {
  registerStoreSetting();
  registerLocationRepairChecks();

  // Never gate this on an apiVersion check: lib attaches at import time, so it
  // is always present by init, and an early return would skip the sheet
  // registration below. See docs/location/DECISIONS.md, "The location sub-type
  // has one owner, and it is this feature".
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

  // The data model and the sheet for `acks-extras.location` register here and
  // nowhere else, unconditionally.
  CONFIG.Actor.dataModels[LOCATION_TYPE] = LocationData;
  registerLocationSheet();

  // The parent pointer and the place flag join the Actor compendium index, so a
  // place held in a pack can be asked what is inside it without loading the
  // pack's documents. Must run at init, before any index is built: a pack
  // indexed without the field answers `undefined` until `getIndex` is called again.
  const indexed = CONFIG.Actor.compendiumIndexFields;
  for (const field of ["system.parentUuid", `flags.${MODULE_ID}.place`]) {
    if (!indexed.includes(field)) indexed.push(field);
  }

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

  // Scene ↔ place linking: a scene-config row, two directory context entries,
  // and the sync that keeps the location's mirror true. Nothing is created
  // until a GM asks.
  registerSceneConfigRow();
  registerSceneContextMenu();
  registerSceneLinkSync();

  foundry.applications.handlebars
    .loadTemplates(TEMPLATES)
    .catch((err) => console.warn(`${MODULE_ID} | template preload skipped`, err));

  /**
   * Gives a new location default ownership for the table and a map-marker
   * prototype token. Explicit creation data always wins, which is how the vault
   * sweep makes a personal vault.
   */
  Hooks.on("preCreateActor", (doc, data) => {
    if (doc.type !== LOCATION_TYPE) return;
    const changes = {};
    if (data?.ownership?.default == null) {
      changes.ownership = { ...doc.ownership, default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER };
    }
    // A place's token is a map marker, not a creature: named on hover, neutral,
    // no bars, no sight. Each field is set only where the creation data said
    // nothing, and `actorLink` is left alone (`here.mjs` matches on the base
    // actor id). See docs/location/DECISIONS.md, "A point of interest is a
    // place's token, not a note".
    const proto = data?.prototypeToken ?? {};
    const token = {};
    if (proto.displayName == null) token.displayName = CONST.TOKEN_DISPLAY_MODES.HOVER;
    if (proto.disposition == null) token.disposition = CONST.TOKEN_DISPOSITIONS.NEUTRAL;
    if (proto.bar1?.attribute === undefined) token.bar1 = { attribute: null };
    if (proto.bar2?.attribute === undefined) token.bar2 = { attribute: null };
    if (proto.sight?.enabled == null) token.sight = { enabled: false };
    // The token's picture is copied from the actor's at construction, before
    // this hook runs, so a default icon has to land on both.
    if (data?.img == null && proto.texture?.src == null) {
      changes.img = PLACE_IMG;
      token.texture = { src: PLACE_IMG };
    }
    if (Object.keys(token).length) changes.prototypeToken = token;
    if (Object.keys(changes).length) doc.updateSource(changes);
  });
});

Hooks.once("ready", () => {
  acksExtras.location = {
    openRuledataBrowser,
    openStorageManager,
    runVaultSweep,
    /**
     * A character's vault (vault-sweep.mjs): `vaultFor` finds it or makes it,
     * `payIntoVault` lands coin in it as theirs. Nothing outside this feature
     * builds a vault.
     */
    vaultFor,
    payIntoVault,
    LOCATION_TYPE,
    LocationSheet,
    /**
     * Scene ↔ place and Region ↔ place linking (scene-link.mjs). The scene's
     * or region's flag is canonical; the place carries the mirror.
     */
    scenes: {
      locationOfScene, sceneOfLocation, linkScene, unlinkScene, createLocationForScene,
      locationOfRegion, regionOfLocation, linkRegion, unlinkRegion, createLocationForRegion,
    },
    /**
     * Who can leave something where (reach.mjs). The one definition of reach;
     * consumers do not re-derive it.
     */
    reach: { depositReach, reachablePlaces, pinnedPlaces, setPinnedPlace, companionIds },
    /**
     * A location actor reached through its own TOKEN rather than a scene
     * link (here.mjs) — the place a party's token happens to be standing on,
     * every place standing on a map, and whether one named place does.
     */
    here: { placeUnderParty, placesOnScene, placeStandsOn },
  };

  if (game.system?.id !== "acks") return;
  // One window sweeps, since it creates actors and moves coin: the elected
  // primary GM, once known.
  primaryGMSettled().then((primary) => {
    if (!primary) return;
    runVaultSweep().catch((err) => console.error(`${MODULE_ID} | vault sweep failed`, err));
    pruneEmptyLocations().catch((err) => console.error(`${MODULE_ID} | empty-location prune failed`, err));
  });
});

/**
 * Deletes the empty, unremarkable locations. A location survives empty when it
 * is a market (any market class or a market subtree), someone's vault, a place
 * a GM made hold goods, a scene-linked place, a quarter's own place, a place
 * standing on a map as a token, a place a domain holds, a place with notes
 * written on it (`hasWrittenNotes`), or a place that a surviving place sits in
 * (`emptyOfPlaces`). Gated by the `pruneEmptyLocations` setting. `dryRun`
 * deletes nothing, setting or not, and answers with the uuids a sweep would
 * remove. See docs/lib/DECISIONS.md, "Money is physical; four rulings land at
 * once".
 * @returns {Promise<{pruned: number, doomed?: string[]}>}
 */
export async function pruneEmptyLocations({ dryRun = false } = {}) {
  if (!dryRun && !game.settings.get(MODULE_ID, PRUNE_SETTING)) return { pruned: 0 };
  // Every actor with a token on any scene, hidden tokens included, collected
  // in one pass for the whole sweep.
  const placed = new Set();
  for (const scene of game.scenes ?? []) {
    for (const token of scene.tokens ?? []) if (token.actorId) placed.add(token.actorId);
  }
  const empty = game.actors.filter((a) => {
    if (a.type !== LOCATION_TYPE) return false;
    if (a.items.size > 0) return false;
    if ((a.system?.roster ?? []).length > 0) return false;
    if (a.system?.market != null || a.system?.marketClass != null) return false;
    if (hasWrittenNotes(a.system)) return false;
    const kept = a.getFlag(MODULE_ID, "storage");
    if (kept?.vaultOf || kept?.provider) return false;
    if (sceneOfLocation(a) || regionOfLocation(a)) return false;
    if (placed.has(a.id)) return false;
    // A world without the domains feature holds nothing.
    if (acksExtras.domains?.holdsPlace?.(a.uuid)) return false;
    return true;
  });
  const gone = emptyOfPlaces(allPlaces(), empty.map((a) => a.uuid));
  const doomed = empty.filter((a) => gone.has(a.uuid));
  if (dryRun) return { pruned: 0, doomed: doomed.map((a) => a.uuid) };
  for (const a of doomed) await a.delete();
  if (doomed.length) {
    console.log(`${MODULE_ID} | pruned ${doomed.length} empty location(s): ${doomed.map((a) => a.name).join(", ")}`);
  }
  return { pruned: doomed.length };
}
