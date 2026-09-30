/* global Hooks, game, CONFIG, foundry */
/**
 * Registers the merchandise Item sub-type: its data model, its sheet, the
 * world setting that holds the imported age-band headers, the load of the
 * compendium half of the catalogue at `ready`, and the hooks that keep the
 * catalogue current when a merchandise Item is created, edited or deleted.
 * Imported once from the markets entry point.
 */
import { MODULE_ID, LANG, MERCHANDISE_TYPE } from "./constants.mjs";
import { DEMAND_AGE_HEADERS_SETTING } from "./merchandise-keys.mjs";
import MerchandiseData from "./data/merchandise-data.mjs";
import { registerMerchandiseSheet } from "./apps/merchandise-sheet.mjs";
import { primeMerchandiseCatalog, invalidateMerchandiseCatalog } from "./engine/merchandise.mjs";

const reprime = () =>
  primeMerchandiseCatalog().catch((err) => console.warn(`${MODULE_ID} | merchandise: the compendium goods could not be loaded`, err));

/** A burst of compendium writes (an import) re-reads the packs once. */
const reprimeSoon = foundry.utils.debounce(reprime, 250);

/**
 * A world good only needs the merged snapshot dropped; a compendium good
 * changes the compendium half, which is a snapshot of its own and is re-read.
 */
const onMerchandiseChange = (doc) => {
  if (doc?.type !== MERCHANDISE_TYPE) return;
  if (doc.pack) reprimeSoon();
  else invalidateMerchandiseCatalog();
};

Hooks.once("init", () => {
  // Wrapped because a throw in `init` leaves the rest of the hook dead, and
  // the markets' own registrations must survive a sub-type failing.
  try {
    CONFIG.Item ??= {};
    CONFIG.Item.dataModels ??= {};
    CONFIG.Item.dataModels[MERCHANDISE_TYPE] = MerchandiseData;
    // Its own sheet is not optional: the system renders an item's details from
    // a partial named after the type, so a sub-type with no sheet of its own
    // cannot be opened.
    registerMerchandiseSheet();
  } catch (err) {
    console.error(`${MODULE_ID} | merchandise item sub-type failed to register`, err);
  }

  // The age-band header text the importer read from the Judge's book. Runtime
  // content, so it is stored in the world and never shipped; no settings
  // screen shows it.
  try {
    game.settings.register(MODULE_ID, DEMAND_AGE_HEADERS_SETTING, {
      name: `${LANG}.merchandise.ageHeadersSetting`,
      scope: "world",
      config: false,
      type: Object,
      default: {},
    });
  } catch (err) {
    console.error(`${MODULE_ID} | merchandise age-header setting failed to register`, err);
  }
});

Hooks.once("ready", () => {
  reprime();
  for (const hook of ["createItem", "updateItem", "deleteItem"]) Hooks.on(hook, onMerchandiseChange);
});
