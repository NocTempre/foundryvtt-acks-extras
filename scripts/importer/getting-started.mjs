/**
 * The GM's one-click import chain, and the per-seat first-run flag.
 *
 * This used to own a dialog of its own — a walkthrough that opened on join and
 * carried its own "Connect a book…" button beside the Books dialog's. The
 * walkthrough is now the first band of the Books window (module.mjs), so what
 * is left here is the part that was never about presentation: WHICH importers
 * run, in WHAT order, and how a failure in one is kept from silencing the rest.
 *
 * All work happens through the importer's own api (acksExtras.importer), the
 * same surface the shipped macro uses — this file adds no import machinery,
 * only the order it is called in.
 */

import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import { acksExtras } from "../namespace.mjs";

export const SETTING_DISMISSED = "gettingStartedDismissed";

const t = (key, data) =>
  data ? game.i18n.format(`${LANG_PREFIX}.gs.${key}`, data) : game.i18n.localize(`${LANG_PREFIX}.gs.${key}`);

/** init-time: the dismissal flag is per-seat (client), togglable in settings. */
export function registerGettingStartedSettings() {
  game.settings.register(MODULE_ID, SETTING_DISMISSED, {
    name: `${LANG_PREFIX}.gs.settingName`,
    hint: `${LANG_PREFIX}.gs.settingHint`,
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
  });
}

/** Whether this seat has asked not to be shown the first-run band. */
export const gettingStartedDismissed = () => !!game.settings.get(MODULE_ID, SETTING_DISMISSED);

/**
 * The GM chain, in dependency order — every importer the module ships, in the
 * order that lands prerequisites first:
 *
 *  1. abilities   — proficiencies, powers and skills; everything below resolves
 *                   its ability tokens against these shared items;
 *  2. equipment   — the shop list, the weapon and armour grids, and the animals;
 *  3. classes     — a class's proficiency awards and starting kit are refs into
 *                   the two above, so a class imported first points at nothing;
 *  4. monsters    — resolve their ability tokens against 1;
 *  5. companions  — an ability's companion slot points at a creature, and
 *                   abilities were imported before any creature existed, so the
 *                   link can only be made once 4 has run;
 *  6. authored OSE books — another game's creatures and keyed areas, converted
 *                   through the System Compatibility Guide; the areas follow
 *                   the creatures they are keyed to. Only books this seat has
 *                   open, and silent when that is none of them;
 *  7. journals + roll tables — reference the creatures imported in 4;
 *  8. rules tables — last (they warn by themselves if the provider is absent).
 *
 * A step missing from this list is a step a GM can only reach by hunting for
 * its macro — which is how the class import came to be run by hand, repeatedly.
 * Each step is idempotent and reports through its own notifications; this only
 * sequences them and narrates which one is running.
 */
const GM_STEPS = [
  // Import CREATES; it steps over every document that already exists, so a
  // description written before this module materialized book text keeps
  // whatever it held. The update pass is the only path that rewrites an
  // existing description, and the only one that reaches an ability embedded on
  // an actor — where removing the imports and importing again cannot follow.
  // It runs inside this step rather than beside it: refreshing the abilities is
  // part of importing them, not a decision a Judge is asked to make.
  [
    "stepAbilities",
    async (api) => {
      await api.cookbookImportAbilities();
      await api.cookbookUpdateAbilities();
    },
  ],
  ["stepEquipment", (api) => api.importAllEquipment()],
  // Variations go ON the gear imported above, so they follow it. Traps and
  // vehicles depend on nothing; each needs ACKS Extras for its document type
  // and says so itself when it is absent.
  ["stepVariations", (api) => api.importVariations()],
  ["stepTraps", (api) => api.importTraps()],
  ["stepVehicles", (api) => api.importVehicles()],
  // `cookbookUpdateClasses` is deliberately NOT run here, though it is the
  // matching half of the abilities step above. It has no ownership guard — it
  // asks once and then replaces each class's whole `system`, hand edits with it
  // — and it asks through a modal, which a chain that narrates its own progress
  // must not stop on. A stale class is also reachable the ordinary way: classes
  // are world documents, so removing the imports and importing again rewrites
  // them. That is the gap abilities do not have, and the reason only abilities
  // are refreshed from here.
  ["stepClasses", (api) => api.importClasses()],
  // Template packages resolve their gear against the equipment imported above
  // and their rows against the classes just landed — so they follow both.
  // Also the upgrade path for a world whose classes were imported before
  // packages existed (importClasses skips classes already present, so it
  // alone never revisits them).
  ["stepTemplatePackages", (api) => api.importTemplatePackages()],
  ["stepMonsters", (api) => api.cookbookImportMonsters()],
  ["stepCompanions", (api) => api.cookbookFillCompanions()],
  // Every authored third-party book the seat has open. Reachable ONLY from
  // here and the api: there is no per-book control, exactly as there is none
  // for traps or vehicles, because choosing between them is not a decision a
  // Judge has to make to import their own books.
  ["stepOseBooks", (api) => api.oseImportAuthored()],
  ["stepJournals", (api) => api.cookbookImportJournals()],
  ["stepRollTables", (api) => api.cookbookImportRollTables()],
  ["stepTables", (api) => api.cookbookImportTables()],
];

/**
 * Run every importer in order, narrating the step as it goes.
 *
 * `root` is the element holding `[data-gs-import]` (the button to disable while
 * the chain runs) and `[data-gs-import-status]` — the Getting Started band
 * passes it. It is OPTIONAL because this is also the whole of the "Import
 * Everything" macro, which has no window to narrate into: without a root the
 * steps are announced as notifications instead, so a Judge who ran it from the
 * hotbar still sees where it has got to.
 */
export async function runImportEverything(root = null) {
  const api = acksExtras.importer;
  if (!api) return ui.notifications.warn(`${MODULE_ID} | not ready.`);
  const status = root?.querySelector("[data-gs-import-status]") ?? null;
  const button = root?.querySelector("[data-gs-import]") ?? null;
  if (button) button.disabled = true;
  try {
    for (const [key, run] of GM_STEPS) {
      if (status) status.textContent = t(key);
      else ui.notifications.info(`${MODULE_ID} | ${t(key)}`);
      // One failed step must not silence the rest — each importer covers a
      // different document type and they share no state beyond the world.
      try {
        await run(api);
      } catch (err) {
        console.error(`${MODULE_ID} | getting started: ${key}`, err);
        ui.notifications.error(`${MODULE_ID} | ${t(key)}: ${err.message}`);
      }
    }
    if (status) status.textContent = t("importDone");
    else ui.notifications.info(`${MODULE_ID} | ${t("importDone")}`);
  } finally {
    if (button) button.disabled = false;
  }
}
