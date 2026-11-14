/**
 * Cookbook runtime — the Foundry side of docs/importer/BINDING-FOUNDRY.md.
 *
 * Loads the shipped cookbook database (cookbook/registers.json +
 * cookbook/<book>.json), executes entries through the DUMB executor against
 * the seat's own connected book, and binds executor output to acks documents:
 *   - GM import dialog: pick monsters -> Actors (stats, weapons with
 *     damage type + extraordinary-from-printed-color, abilities, spoils, art);
 *   - prose: the entry's own paragraphs are written into the document at
 *     import, page reference last (scripts/prose.mjs), and the world holds
 *     them from then on.
 *
 * The cookbook is read-only data; all judgment happened in the offline
 * pipeline. This file is the public import path: it holds no code and
 * re-exports each public name, by name, from the file under cookbook/ that
 * declares it (docs/importer/MODEL.md, "The cookbook's files").
 */

export {
  UNLINED_LINE, lineOf, bookOfCookbookId, isContentId, lineOfClaim, initCookbook, loadCookbook, cookbookContentFile,
  cookbookRegisters, cookbookSessionDoc, cookbookBookFile, cookbookEntry, cookbookCount, offeredHere, isAbilityEntry,
  classEntries, vehicleEntries, merchandiseEntries, variationEntries, trapEntries, spellEntries, abilityEntries,
  cookbookAbilityIds, cookbookEquipmentIds,
} from "./cookbook/state.mjs";
export {
  packOptsFor, withRewrite, isRewriting, writeRowBlock, keepsJudgeFigure, keepsJudgeProse, writeJournalPage,
  wasRewritten, createDoc, itemIds, WRITE_CHUNK, createDocs, claimActorImport, forgetImportedIndex, importedItemFor,
  importedActorFor, importedDocs, holdingLibrary, importedItemsByName, ensureItemFolder,
} from "./cookbook/target.mjs";
export { abilityIcon, bindAbility, refForPrintedName, preferredId } from "./cookbook/abilities.mjs";
export {
  buildExtras, bindStatsScalars, proficiencyPools, proficiencyResolver, bindProficiency, bindMonster, templateOption,
  refillMonster, bindLegacyMonster, bindNpc,
} from "./cookbook/monster.mjs";
export {
  abilitySurfaceIndex, tokenizeProfs, nameForms, parseEquipment, liftBookSpells, liftCompanions, classGainsFor,
  proseGainSchedule, proseHitDiceLevels, buildXp, proseDamageLadder, gridLadders, laddersForEntry, laddersFromSpec,
  bindClass, classRepertoireFor, readTraining, parseCombatTraining, parseTrainingProse, readTrainingCells, buildPaths,
  parseTongues, parseBonusLanguages, syncHeldRaceTongues, importClasses, importTemplatePackages, cookbookUpdateClasses,
} from "./cookbook/classes.mjs";
export {
  bindVehicleRow, rowClaimKey, importVehicles, equipmentTypeOf, locatedValues, bindEquipment, trainingFromName,
  animalSpecies, mountableSpecies, loadsFromText, speedFromText, loadedAnimalEntries, bindAnimal, importEquipment,
  importAllEquipment, importWeapons, pricedDoc, withCapacity, importPricedGear, importArmor,
} from "./cookbook/equipment.mjs";
export {
  importMerchandise, bindVariation, importVariations, splitTrapTiers, bindTrap, importTraps, bindSpell, importSpells,
} from "./cookbook/variations.mjs";
export {
  cookbookImportJournals, cookbookImportPoiPlaces, regionSiteClaim, siteBindPatch, marketTakes,
  cookbookImportMarketProfiles, cookbookImportFactions,
} from "./cookbook/adventure-places.mjs";
export {
  cookbookImportRollTables, rewriteTable, cookbookImportAdventureItems, adventureItemData, cookbookImportScenes,
  gridScenePlan, mapCreateData, repairHeldMap, cookbookImportLinks, cookbookImportAdventures, bookCensus,
} from "./cookbook/adventure-maps.mjs";
export { importAbility, cookbookFillCompanions, resolveAbilities, rebracket } from "./cookbook/actor-import.mjs";
export {
  cookbookImportAbilitiesDialog, cookbookImportAbilities, cookbookUpdateAbilities, danglingAbilities,
  cookbookPruneAbilities, registerAbilityDirectoryButtons,
} from "./cookbook/abilities-import.mjs";
export {
  REPAIR_RUNS, TABLE_BOOKS, recreateUnderId, keepUnderNewId, repairPregens, SHELF_REFILL, reimportableShelves,
  cookbookReimportShelf, rebuildOptions, runRebuildPick, cookbookReimportEverything, reimportableBooks,
  cookbookReimportBook, adventureBooks, placeBlockRows, cookbookReimportAdventure, ENTRY_SOURCES, IMPORT_KINDS,
  cookbookRunSet, cookbookReimportEntries, cookbookRemoveImports,
} from "./cookbook/rebuild.mjs";
export {
  lastAudit, cookbookAudit, cookbookDebug, cookbookImportIds, cookbookImport, cookbookImportMonsters,
} from "./cookbook/import-dialog.mjs";
