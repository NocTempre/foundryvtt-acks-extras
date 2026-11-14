/**
 * The GM's one-click import chain, and the per-seat first-run flag.
 *
 * The walkthrough is the first band of the import manager's Books tab
 * (module.mjs); this file holds the part that is not presentation: WHICH
 * importers run, in WHAT order, and how a failure in one is kept from silencing
 * the rest.
 *
 * All work happens through the importer's own api (acksExtras.importer), the
 * same surface the shipped macro uses — this file adds no import machinery,
 * only the order it is called in.
 */

import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import { acksExtras } from "../namespace.mjs";
import { progressBar } from "./progress.mjs";

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
 * entry they follow. A step missing from this list is a step a GM can only
 * reach by hunting for its macro — which is how the class import came to be
 * run by hand, repeatedly. Each step is idempotent and reports through its own
 * notifications; this only sequences them and narrates which one is running.
 *
 * The steps share the world and the run object `runImportEverything` hands
 * each one, which carries the tables read in 1 to their apply in 5. Run alone
 * (no run object), the tables step reads and applies in one go.
 */
export const GM_STEPS = [
  // Reads every rules table and assembles the engine tables from them, so the
  // importers below find them. Inside the chain the report waits in `o.run`
  // for the apply step; run alone it applies at once.
  [
    "stepTables",
    async (api, o) => {
      if (!o?.run) return api.cookbookImportTables();
      o.run.tables = (await api.cookbookImportTables(null, { phase: "read" })) ?? { imported: [] };
    },
  ],
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
  // Goods read the RR table and append the JJ demand layers, so the step
  // needs no other import and says itself when the JJ is not open.
  ["stepMerchandise", (api) => api.importMerchandise()],
  // Spells stand on nothing; the template packages after the classes resolve
  // their spellbooks against them, so they land first.
  ["stepSpells", (api) => api.importSpells()],
  // `cookbookUpdateClasses` is deliberately NOT run here, though it is the
  // matching half of the abilities step above. It has no ownership guard — it
  // asks once and then replaces each class's whole `system`, hand edits with it
  // — and it asks through a modal, which a chain that narrates its own progress
  // must not stop on. A stale class is also reachable the ordinary way: classes
  // are world documents, so removing the imports and importing again rewrites
  // them. That is the gap abilities do not have, and the reason only abilities
  // are refreshed from here.
  ["stepClasses", (api) => api.importClasses()],
  // Races, class builds, armour-limit rows and languages: the documents the
  // tables read above build, which point at the abilities and classes just
  // landed. It applies exactly what this run read; run alone it reads first.
  [
    "stepTablesApply",
    (api, o) =>
      o?.run
        ? api.cookbookImportTables(null, { phase: "apply", read: o.run.tables })
        : api.cookbookImportTables(),
  ],
  // Template packages resolve their gear against the equipment imported above
  // and their rows against the classes just landed — so they follow both.
  // It also reaches classes a world already holds (importClasses skips classes
  // already present, so it alone never revisits them).
  ["stepTemplatePackages", (api) => api.importTemplatePackages()],
  ["stepMonsters", (api) => api.cookbookImportMonsters()],
  ["stepCompanions", (api) => api.cookbookFillCompanions()],
  // The second argument is the chain's `{quiet: true}`: a step with nothing to
  // write says nothing inside the chain, and warns when it is run on its own.
  ["stepJournals", (api, o) => api.cookbookImportJournals(o)],
  // A settlement's keyed places are actors, not pages: after the journals,
  // because a page path that also held them would have skipped them already.
  ["stepPoi", (api, o) => api.cookbookImportPoiPlaces(o)],
  ["stepFactions", (api) => api.cookbookImportFactions()],
  // Market profiles land on the places above, and translate goods through
  // the merchandise catalogue the goods step built.
  ["stepMarkets", (api) => api.cookbookImportMarketProfiles()],
  ["stepRollTables", (api) => api.cookbookImportRollTables()],
  // An item a book introduces stands on nothing above it.
  ["stepAdventureItems", (api) => api.cookbookImportAdventureItems()],
  // A map stands on the places, names the organisations seated in its quarters
  // and wires in the lists, so it follows all three.
  ["stepScenes", (api, o) => api.cookbookImportScenes(o)],
  // A book's Adventure is a copy of what the world holds of it, so it is
  // written last, once nothing above has more to add or to bring over.
  ["stepAdventures", (api) => api.cookbookImportAdventures()],
];

/**
 * Run ONE step of the chain by its key, as the import manager's step list
 * does; the step reports through its own notifications. Resolves to the
 * step's own result. An unknown key throws: the list is `GM_STEPS`, and a
 * key no step carries is a caller's error, not a Judge's.
 */
export async function runImportStep(key) {
  const api = acksExtras.importer;
  if (!api) return ui.notifications.warn(`${MODULE_ID} | not ready.`);
  const step = GM_STEPS.find(([k]) => k === key);
  if (!step) throw new Error(`${MODULE_ID} | no import step "${key}"`);
  return step[1](api);
}

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
  // ONE bar for the whole chain, beside whatever each step draws for itself.
  // A progress notification belongs to no window, so this is the same surface
  // whether the run was started from the Getting Started band or from the
  // macro — and the macro path is where there was nothing to look at at all.
  // It does not expire while it is short of its total, so it stays for the
  // whole run; `finish` is idempotent and clears it from the `finally`.
  //
  // The chain is counted in STEPS, which is the only total knowable before the
  // run: several steps cannot say how much work they hold until they begin, and
  // some never can. What answers "is it still working" is the per-step bar
  // ticking underneath this one; what this answers is "how much is left".
  const overall = progressBar(t("importOverall"), GM_STEPS.length);
  const chain = {};
  try {
    for (const [key, run] of GM_STEPS) {
      if (status) status.textContent = t(key);
      // Name the step ABOUT to run against the count already finished, so the
      // five steps that draw no bar of their own are still visibly current.
      overall.note(t(key));
      // One failed step must not silence the rest — each importer covers a
      // different document type, and what they share is the world and `chain`.
      try {
        await run(api, { quiet: true, run: chain });
      } catch (err) {
        console.error(`${MODULE_ID} | getting started: ${key}`, err);
        ui.notifications.error(`${MODULE_ID} | ${t(key)}: ${err.message}`);
      }
      // Counted whether it succeeded or threw: the step is over either way, and
      // a bar that stalls on a failure the chain survived tells a lie.
      overall.step();
    }
    if (status) status.textContent = t("importDone");
  } finally {
    overall.finish(t("importDone"));
    if (button) button.disabled = false;
  }
}
