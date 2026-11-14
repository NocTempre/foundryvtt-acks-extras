/**
 * The two halves of a rules-tables import that follow the page read.
 *
 * `assembleReadTables` is store-only: it shapes the raw reads into the
 * engine-shaped tables the rest of the module reads (class pricing among them)
 * and writes the table store through `importDoc`, never a world document.
 * `applyReadTables` is the document half: races, class builds, the armour-limit
 * rows on skills, the language items, then the race-tongue sync. It reads what
 * the store holds, never a page, and calls no `importDoc`.
 *
 * Both take the ids of the documents a read produced and touch only those, so
 * a run that read one document assembles and applies that one document. The
 * split lets the import chain read every table before any importer that needs
 * one and apply the world writes once the abilities and classes they point at
 * exist (getting-started.mjs).
 *
 * A failure in one binding is reported and the rest still run, so a party that
 * can forage does not lose the ability because the flight pages would not
 * parse. The notices a binding raises are this file's; the page read's are
 * module.mjs's.
 */

import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import { BUILDER_DOC_ID, assembleBuilderImport, applyBuilderImport } from "./builder-binding.mjs";
import { applyThiefLimitImport } from "./thief-limit-binding.mjs";
import { applyTravelImport, TRAVEL_DOC_ID } from "./travel-binding.mjs";
import { applyWeatherImport, WEATHER_DOC_ID } from "./weather-binding.mjs";
import { applyEncountersImport, ENCOUNTERS_DOC_ID } from "./encounters-binding.mjs";
import { applyVoyagesImport, VOYAGES_DOC_ID } from "./voyages-binding.mjs";
import { applyLanguageImport, LANGUAGES_DOC_ID } from "./language-binding.mjs";
import { applySurvivalImport, SURVIVAL_DOC_ID } from "./survival-binding.mjs";
import { applyConditionsImport, CONDITIONS_DOC_ID } from "./conditions-binding.mjs";
import { applyForagingImport, FORAGING_DOC_ID } from "./foraging-binding.mjs";
import { applySearchingImport, SEARCHING_DOC_ID } from "./searching-binding.mjs";
import { applyCityTravelImport, CITY_TRAVEL_DOC_ID } from "./city-travel-binding.mjs";
import { applyFlightImport, FLIGHT_DOC_ID } from "./flight-binding.mjs";
import { applyFormationImport, FORMATION_DOC_ID } from "./formation-binding.mjs";
import { applyExperienceImport, EXPERIENCE_DOC_ID } from "./experience-binding.mjs";
import { applyLightImport, LIGHT_DOC_ID } from "./light-binding.mjs";
import { applyDelveEncounterImport, DELVE_ENCOUNTER_DOC_ID } from "./delve-encounter-binding.mjs";
import { applyWeaponListsImport, WEAPON_PROSE_DOC_ID } from "./weapon-binding.mjs";
import { syncHeldRaceTongues } from "./cookbook.mjs";
import { getDoc } from "../lib/tables.mjs";

/**
 * The single-document bindings, each with the assembler that turns its raw
 * page reads into the engine tables acks-extras declares. They differ only in
 * which document they answer for, so one loop runs them all.
 */
export const SIMPLE_BINDINGS = Object.freeze([
  { id: SURVIVAL_DOC_ID, apply: applySurvivalImport },
  { id: CONDITIONS_DOC_ID, apply: applyConditionsImport },
  { id: FORAGING_DOC_ID, apply: applyForagingImport },
  { id: SEARCHING_DOC_ID, apply: applySearchingImport },
  { id: CITY_TRAVEL_DOC_ID, apply: applyCityTravelImport },
  { id: FLIGHT_DOC_ID, apply: applyFlightImport },
  { id: FORMATION_DOC_ID, apply: applyFormationImport },
  { id: EXPERIENCE_DOC_ID, apply: applyExperienceImport },
  { id: LIGHT_DOC_ID, apply: applyLightImport },
  { id: DELVE_ENCOUNTER_DOC_ID, apply: applyDelveEncounterImport },
  // Answers for the raw prose document; the lists it assembles are the
  // `weaponLists` document.
  { id: WEAPON_PROSE_DOC_ID, apply: applyWeaponListsImport },
]);

/**
 * The documents with an assembler of their own, each under its log label.
 * `shown` is what the log carries: the tables, or their count where the list
 * is long.
 */
const ASSEMBLED = Object.freeze([
  { id: TRAVEL_DOC_ID, label: "travel", assemble: applyTravelImport, shown: (r) => r.assembled },
  { id: WEATHER_DOC_ID, label: "weather", assemble: applyWeatherImport, shown: (r) => r.assembled },
  { id: ENCOUNTERS_DOC_ID, label: "encounter", assemble: applyEncountersImport, shown: (r) => r.assembled.length },
  { id: VOYAGES_DOC_ID, label: "voyage", assemble: applyVoyagesImport, shown: (r) => r.assembled },
]);

/**
 * Assemble the engine tables of every document in `docIds` and register them.
 * Store only: no world document is created or updated, and no page is read.
 *
 * @param {string[]} docIds the ids of the documents a read produced
 * @returns {Promise<void>}
 */
export async function assembleReadTables(docIds) {
  const named = new Set(docIds);
  if (named.has(BUILDER_DOC_ID)) {
    try {
      const assembled = await assembleBuilderImport();
      console.log(`${MODULE_ID} | class-builder tables assembled`, assembled);
    } catch (err) {
      console.error(`${MODULE_ID} | class-builder assembly failed`, err);
      ui.notifications.warn(`${MODULE_ID} | class builder: ${err.message}`);
    }
  }
  for (const { id, label, assemble, shown } of ASSEMBLED) {
    if (!named.has(id)) continue;
    try {
      const result = await assemble();
      if (result.assembled.length) console.log(`${MODULE_ID} | ${label} tables assembled`, shown(result));
    } catch (err) {
      console.error(`${MODULE_ID} | ${label} table binding failed`, err);
      ui.notifications.warn(`${MODULE_ID} | ${label} tables: ${err.message}`);
    }
  }
  for (const { id, apply } of SIMPLE_BINDINGS) {
    if (!named.has(id)) continue;
    try {
      const result = await apply();
      if (result.assembled.length) console.log(`${MODULE_ID} | ${id} tables assembled`, result.assembled);
    } catch (err) {
      console.error(`${MODULE_ID} | ${id} table binding failed`, err);
      ui.notifications.warn(`${MODULE_ID} | ${id} tables: ${err.message}`);
    }
  }
}

/**
 * Write the world documents the tables in `docIds` build: the races and class
 * builds, the armour-limit rows on skills, the language items, and the race
 * tongues the new races take from the classes the world holds. Reads the store
 * only. A call whose ids name none of the builder or language documents
 * writes nothing.
 *
 * @param {string[]} docIds the ids of the documents a read produced
 * @param {{repair?: object|null}} [opts] `repair`, a tally (`repairTally`), counts the
 *        language and race items written over in place.
 * @returns {Promise<void>}
 */
export async function applyReadTables(docIds, { repair = null } = {}) {
  const named = new Set(docIds);
  // The class-builder tables carry world writes of their own: race Items and
  // builder state on the imported classes.
  if (named.has(BUILDER_DOC_ID)) {
    try {
      const built = await applyBuilderImport({ repair });
      if (built.races.length || built.builds.length) {
        ui.notifications.info(
          game.i18n.format(`${LANG_PREFIX}.tables.builderApplied`, {
            races: built.races.length,
            builds: built.builds.length,
          }),
        );
      }
      console.log(`${MODULE_ID} | class-builder binding`, built);
    } catch (err) {
      console.error(`${MODULE_ID} | class-builder binding failed`, err);
      ui.notifications.warn(`${MODULE_ID} | class builder: ${err.message}`);
    }
    // The same document's armour limits on abilities, stamped after the builder
    // write so a failure in either leaves the other standing.
    try {
      const limited = await applyThiefLimitImport();
      console.log(`${MODULE_ID} | armour-limit binding`, limited);
    } catch (err) {
      console.error(`${MODULE_ID} | armour-limit binding failed`, err);
      ui.notifications.warn(`${MODULE_ID} | armour limits: ${err.message}`);
    }
  }
  // The taxonomy is read, not shipped, so the items exist only once a seat has
  // imported it from their own book.
  if (named.has(LANGUAGES_DOC_ID)) {
    try {
      const table = getDoc(LANGUAGES_DOC_ID)?.tables?.tree;
      const made = table ? await applyLanguageImport(table, { repair }) : { created: 0, present: 0, adopted: 0 };
      // An adopted tongue counts as work landed, though nothing was created.
      const landed = made.created + made.adopted;
      if (landed) {
        ui.notifications.info(game.i18n.format(`${LANG_PREFIX}.tables.languagesApplied`, { created: landed }));
      }
      console.log(`${MODULE_ID} | language binding`, made);
    } catch (err) {
      console.error(`${MODULE_ID} | language binding failed`, err);
      ui.notifications.warn(`${MODULE_ID} | languages: ${err.message}`);
    }
  }
  // A race Item this apply wrote takes its tongues from the classes already
  // held, so a race that lands after its classes is not left empty.
  if (named.has(BUILDER_DOC_ID) || named.has(LANGUAGES_DOC_ID)) {
    try {
      await syncHeldRaceTongues();
    } catch (err) {
      console.error(`${MODULE_ID} | race tongue sync failed`, err);
      ui.notifications.warn(`${MODULE_ID} | race tongues: ${err.message}`);
    }
  }
}
