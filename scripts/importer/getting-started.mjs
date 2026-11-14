/**
 * The GM's one-click import chain, and the per-seat first-run flag.
 *
 * The walkthrough is the first band of the import manager's Books tab
 * (module.mjs); this file holds which importers run, in what order, and keeps a
 * failure in one from silencing the rest. Every step goes through the importer's
 * own api (acksExtras.importer), the surface the shipped macro uses.
 */

import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import { acksExtras } from "../namespace.mjs";
import { progressBar } from "./progress.mjs";

/** The client setting key holding whether this seat dismissed the first-run band. */
export const SETTING_DISMISSED = "gettingStartedDismissed";

const t = (key, data) =>
  data ? game.i18n.format(`${LANG_PREFIX}.gs.${key}`, data) : game.i18n.localize(`${LANG_PREFIX}.gs.${key}`);

/** Registers the per-seat (client) dismissal flag at init; it is togglable in settings. */
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
 *  1. rules tables, read — every importer below that reads a table (class
 *                   pricing, the creature kits and ladders, the armour limits)
 *                   finds it already read; this step writes no importer
 *                   document;
 *  2. abilities   — proficiencies, powers and skills; everything below resolves
 *                   its ability tokens against these shared items;
 *  3. equipment   — the shop list, the weapon and armour grids, and the animals;
 *  4. classes     — a class's proficiency awards and starting kit are refs into
 *                   the two above, so a class imported first points at nothing;
 *  5. rules tables, applied — the races, class builds, armour-limit rows and
 *                   languages the tables from 1 build need the abilities and
 *                   classes above, so they are written once those exist;
 *  6. monsters    — resolve their ability tokens against 2;
 *  7. companions  — an ability's companion slot points at a creature, and
 *                   abilities were imported before any creature existed, so the
 *                   link can only be made once 6 has run;
 *  8. journals + roll tables — reference the creatures imported in 6;
 *  9. adventures  — each open adventure book as one Adventure on its line's
 *                   shelf, carrying what every step above made of it.
 *
 * The list groups the single-purpose steps (variations, traps, vehicles,
 * merchandise, spells, template packages, places, markets, scenes) under the
 * entry they follow. Each step is idempotent and reports through its own
 * notifications; this only sequences them and narrates which one is running.
 *
 * The steps share the world and the run object `runImportEverything` hands
 * each one, which carries the tables read in 1 to their apply in 5. Run alone
 * (no run object), the tables step reads and applies in one go.
 */
export const GM_STEPS = [
  // Inside the chain the read report waits in `o.run` for the apply step.
  [
    "stepTables",
    async (api, o) => {
      if (!o?.run) return api.cookbookImportTables();
      o.run.tables = (await api.cookbookImportTables(null, { phase: "read" })) ?? { imported: [] };
    },
  ],
  // Import creates and steps over existing documents; the update pass is the
  // only path that rewrites an existing description or reaches an ability
  // embedded on an actor.
  // See docs/importer/DECISIONS.md, "Importing again refreshes what it did not create (2026-09-02)".
  [
    "stepAbilities",
    async (api) => {
      await api.cookbookImportAbilities();
      await api.cookbookUpdateAbilities();
    },
  ],
  ["stepEquipment", (api) => api.importAllEquipment()],
  // Variations go ON the gear imported above, so they follow it. Traps and
  // vehicles depend on nothing.
  ["stepVariations", (api) => api.importVariations()],
  ["stepTraps", (api) => api.importTraps()],
  ["stepVehicles", (api) => api.importVehicles()],
  // Goods read the RR table and append the JJ demand layers.
  ["stepMerchandise", (api) => api.importMerchandise()],
  // Spells stand on nothing; the template packages resolve their spellbooks
  // against them, so they land first.
  ["stepSpells", (api) => api.importSpells()],
  // `cookbookUpdateClasses` is not a step: it asks through a modal.
  // See docs/importer/DECISIONS.md, "Importing again refreshes what it did not create (2026-09-02)".
  ["stepClasses", (api) => api.importClasses()],
  // Applies exactly what this run read; run alone it reads first.
  [
    "stepTablesApply",
    (api, o) =>
      o?.run
        ? api.cookbookImportTables(null, { phase: "apply", read: o.run.tables })
        : api.cookbookImportTables(),
  ],
  // Template packages resolve their gear against the equipment and their rows
  // against the classes, so they follow both; they also reach classes a world
  // already holds, which importClasses skips.
  ["stepTemplatePackages", (api) => api.importTemplatePackages()],
  ["stepMonsters", (api) => api.cookbookImportMonsters()],
  ["stepCompanions", (api) => api.cookbookFillCompanions()],
  // The second argument is the chain's `{quiet: true}`: a step with nothing to
  // write says nothing inside the chain, and warns when it is run on its own.
  ["stepJournals", (api, o) => api.cookbookImportJournals(o)],
  // A settlement's keyed places are actors, not pages; they follow the journals.
  ["stepPoi", (api, o) => api.cookbookImportPoiPlaces(o)],
  ["stepFactions", (api) => api.cookbookImportFactions()],
  // Market profiles land on the places above, and translate goods through
  // the merchandise catalogue the goods step built.
  ["stepMarkets", (api) => api.cookbookImportMarketProfiles()],
  ["stepRollTables", (api) => api.cookbookImportRollTables()],
  // An item a book introduces stands on nothing above it.
  ["stepAdventureItems", (api) => api.cookbookImportAdventureItems()],
  // A map stands on the places, the organisations seated in its quarters and
  // the lists, so it follows all three.
  ["stepScenes", (api, o) => api.cookbookImportScenes(o)],
  // A book's Adventure is a copy of what the world holds of it, so it is last.
  ["stepAdventures", (api) => api.cookbookImportAdventures()],
];

/**
 * Runs one step of `GM_STEPS` by its key, as the import manager's step list
 * does, and resolves to the step's own result. An unknown key throws.
 */
export async function runImportStep(key) {
  const api = acksExtras.importer;
  if (!api) return ui.notifications.warn(`${MODULE_ID} | not ready.`);
  const step = GM_STEPS.find(([k]) => k === key);
  if (!step) throw new Error(`${MODULE_ID} | no import step "${key}"`);
  return step[1](api);
}

/**
 * Runs every importer in order, narrating the step as it goes.
 *
 * `root` is the element holding `[data-gs-import]` (the button to disable while
 * the chain runs) and `[data-gs-import-status]`; the Getting Started band passes
 * it. It is optional because the "Import Everything" macro has no window to
 * narrate into.
 */
export async function runImportEverything(root = null) {
  const api = acksExtras.importer;
  if (!api) return ui.notifications.warn(`${MODULE_ID} | not ready.`);
  const status = root?.querySelector("[data-gs-import-status]") ?? null;
  const button = root?.querySelector("[data-gs-import]") ?? null;
  if (button) button.disabled = true;
  // One bar for the whole chain, counted in steps; `finish` is idempotent and
  // clears it from the `finally`.
  // See docs/importer/DECISIONS.md, "The whole chain gets one bar, and it counts steps (2026-09-02)".
  const overall = progressBar(t("importOverall"), GM_STEPS.length);
  const chain = {};
  try {
    for (const [key, run] of GM_STEPS) {
      if (status) status.textContent = t(key);
      // Names the step about to run against the count already finished.
      overall.note(t(key));
      // One failed step must not silence the rest: each covers a different
      // document type.
      try {
        await run(api, { quiet: true, run: chain });
      } catch (err) {
        console.error(`${MODULE_ID} | getting started: ${key}`, err);
        ui.notifications.error(`${MODULE_ID} | ${t(key)}: ${err.message}`);
      }
      // Counted whether it succeeded or threw.
      overall.step();
    }
    if (status) status.textContent = t("importDone");
  } finally {
    overall.finish(t("importDone"));
    if (button) button.disabled = false;
  }
}
