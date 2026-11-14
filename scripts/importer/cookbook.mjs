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
 * pipeline. This file only maps executor output onto acks system fields.
 */

import { MODULE_ID, LANG_PREFIX, ITEM_TYPE } from "./constants.mjs";
import { BUILDER_DOC_ID } from "../classes/builder-logic.mjs";
import { LANGUAGES_DOC_ID } from "./language-binding.mjs";
import { blockSums, editedInBlocks, entryText, sumsUpdate } from "./prose.mjs";
import { answersFor, placePairs } from "./place-pair.mjs";
import { handWrittenProse, repairCounts, mergedTally, countRepair, unrepaired } from "./refresh.mjs";
import { decides, heldEdit, playStamp, pregenAnswer } from "./held-edits.mjs";
import { mergedRepair, mergedStep, secondPass } from "./merged-repair.mjs";
import { chooseHeldEditsDialog } from "./apps/held-edits-dialog.mjs";
import {
  isPoiEntry, poiGroupOf, districtPlaceId, isRegionSite, isRegionOverview, regionPlaceId, keySpacesOf, isKeyedPlace,
  adventurePlaceId,
} from "./poi-binding.mjs";
import { isOrganisationRow, isStrengthGridRow } from "./faction-binding.mjs";
import { printedNameOf } from "./printed-name.mjs";
import { reimportEverything } from "./everything.mjs";
import { isSceneRecipe, isWorldCopy, isZoneRow, isLinkRow } from "./scene-binding.mjs";
import { BOOKS, bookIsJudges } from "./books.mjs";
import { executeEntry, convertName } from "./executor.mjs";
import { TABLE_RECIPES } from "./table-recipes.mjs";
import { ownerOfClaim, rebuildVerdict } from "./rebuild-guard.mjs";
import { ancestorsOf, claimerPasses, groupBookOf, runSetFor as deriveRunSet } from "./import-kinds.mjs";
import { GM_STEPS } from "./getting-started.mjs";
import { getLayer, PRIORITY } from "../lib/tables.mjs";
import { WEAPON_TABLE } from "./weapon-tables.mjs";
import { ARMOR_TABLE } from "./armor-tables.mjs";
import { progressBar } from "./progress.mjs";
import * as services from "../lib/services.mjs";
import { ADVENTURE_TYPE, bookAdventureCookbookId, stableDocId, adventureDropRows } from "./adventure-binding.mjs";
import { sheetValuesFromStatline, asPrintedBlock, classBehindQualifier } from "./character-binding.mjs";
import { slug } from "../lib/vocab.mjs";
import { elementOf, escape as esc, unset } from "../lib/util.mjs";
import {
  FOLDER_NAME, lineOf, bookOfCookbookId, lineOfData, data, ctx, cookbookEntry, bookOf, bookLabel, api, claimedId,
  readableHere, offeredHere, claimsEntry, playersCharacter, ACTOR_KINDS, actorKindOf, characterEntry, isAbilityEntry,
  classEntries, vehicleEntries, merchandiseEntries, variationEntries, trapEntries, spellEntries, abilityEntries,
  cookbookAbilityIds, cookbookEquipmentIds,
} from "./cookbook/state.mjs";
import { readForImport, passedOver, runPageCache } from "./cookbook/read.mjs";
import {
  folderCache, packCache, packLabel, packOptsFor, withRewrite, isRewriting, decisionOf, keepsJudgeProse, createDoc,
  WRITE_CHUNK, createDocs, importedIndex, claimImport, forgetImportedIndex, importedDocs, holdingLibrary,
  deleteImported, importedItem, importedActor, importedIdSet, primaryTypeOf, actorFolderFor, prepareFolders,
  IMPORT_CONCURRENCY, actorEntriesAcrossBooks, familyMemberIds, ITEM_SHELF, shelfKeyOf, ensureItemFolder,
  prepareItemShelves,
} from "./cookbook/target.mjs";
import {
  bindAbility, ABILITY_EXTRAS_OPTIONAL, allAbilities, idForName, abilityNameIndex, loadedAbilityIndex, reportGuess,
} from "./cookbook/abilities.mjs";
import {
  bindMonster, monsterProseChannels, warmSpellPacksOnce, mintLeaderTemplate, importFamily, importTemplate,
  refillMonster, deferTarget, bindLegacyMonster, bindNpc,
} from "./cookbook/monster.mjs";
import { laddersForEntry, importClasses, cookbookUpdateClasses } from "./cookbook/classes.mjs";
import { importVehicles, importAllEquipment } from "./cookbook/equipment.mjs";
import { importMerchandise, importVariations, importTraps, importSpells } from "./cookbook/variations.mjs";
import { journalBound, regionSiteClaim } from "./cookbook/adventure-places.mjs";
import { cookbookImportAdventureItems, bookCensus, bookDocuments } from "./cookbook/adventure-maps.mjs";

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
  parseTongues, parseBonusLanguages, importClasses, importTemplatePackages, cookbookUpdateClasses,
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

/**
 * Run a list of entry ids through importOne with a progress bar, bounded to
 * IMPORT_CONCURRENCY at a time.
 *
 * Each import parses pages out of the seat's PDF, so a whole book is minutes of
 * work: without feedback the client looks hung. Errors are per-entry — one
 * unreadable page must not abandon the other 286 — and the shared iterator means
 * a slow entry never blocks a free worker from starting the next.
 */
async function importMany(ids, label) {
  const total = ids.length;
  const bar = progressBar(label, total);
  let done = 0;
  try {
    // Every id names its OWN book (a batch may span every connected book) and its
    // own destination folder; the tree is built up front so the workers below
    // only ever read the cache.
    await prepareFolders("Actor", ids);
    const it = ids[Symbol.iterator]();
    const worker = async () => {
      for (let n = it.next(); !n.done; n = it.next()) {
        const id = n.value;
        const found = cookbookEntry(id);
        const bookId = bookOf(found);
        const folder = await actorFolderFor(id, found);
        const actor = await importOne(bookId, id, folder?.id ?? null).catch(
          (err) => (console.error(`${MODULE_ID} | import ${id}`, err), null),
        );
        if (actor) done++;
        bar.step(found?.entry?.name ?? id);
      }
    };
    await Promise.all(Array.from({ length: Math.min(IMPORT_CONCURRENCY, total || 1) }, worker));
  } finally {
    bar.finish(label);
  }
  return done;
}

/* -------------------------------------------- */
/*  Repair in place                             */
/* -------------------------------------------- */

/**
 * How each refill run repairs instead of rebuilding: given the cookbook ids it
 * may touch and a tally (`repairTally`) to count into, it writes every held
 * document over where it stands and imports the ids the world lacks. A run
 * missing here has no in-place write — the weapons, armour, language and race
 * shelves are built from whole printed tables, and `TABLE_REPAIRS` writes them.
 */
export const REPAIR_RUNS = {
  cookbookImportAbilities: async (only, tally) => {
    await cookbookUpdateAbilities({ only, repair: tally });
    return cookbookImportAbilities({ only });
  },
  importClasses: async (only, tally) => {
    await cookbookUpdateClasses({ only, confirm: false, repair: tally });
    return importClasses({ only });
  },
  importAllEquipment: (only, tally) => importAllEquipment({ only, repair: tally }),
  importTraps: (only, tally) => importTraps({ only, repair: tally }),
  importSpells: (only, tally) => importSpells({ only, repair: tally }),
  importVariations: (only, tally) => importVariations({ only, repair: tally }),
  importVehicles: (only, tally) => importVehicles({ only, repair: tally }),
  importMerchandise: (only, tally) => importMerchandise({ only, repair: tally }),
  cookbookImportAdventureItems: (only, tally) => cookbookImportAdventureItems({ only, repair: tally }),
};

/**
 * What repairs a shelf of table rows in place. No entry names a weapon, an
 * armour row, a language or a race, so a shelf repair holds every document the
 * shelf carries and the run reads the table again; the Equipment shelf also
 * carries the price list's rows, which its own run writes (`repair.tables`).
 */
const TABLE_REPAIRS = {
  Weapons: (tally) => api().importWeapons(undefined, { repair: tally }),
  Armor: (tally) => api().importArmor(undefined, { repair: tally }),
  Languages: (tally) => api().cookbookImportTables([LANGUAGES_DOC_ID], { repair: tally }),
  Races: (tally) => api().cookbookImportTables([BUILDER_DOC_ID], { repair: tally }),
};

/** The book a ruledata document's first table is read from. */
const tableDocBook = (docId) => Object.values(TABLE_RECIPES[docId]?.tables ?? {}).find((t) => t.book)?.book ?? null;

/**
 * The book that prints each table shelf (`priced` is the Equipment shelf's price
 * list): a table's rows carry no book on their ids, so a book repair finds them here.
 */
export const TABLE_BOOKS = {
  Weapons: () => WEAPON_TABLE.book,
  Armor: () => ARMOR_TABLE.book,
  priced: () => WEAPON_TABLE.book,
  Languages: () => tableDocBook(LANGUAGES_DOC_ID),
  Races: () => tableDocBook(BUILDER_DOC_ID),
};

/** The book that prints a table shelf's rows, or null. */
const tableBookOf = (shelf) => TABLE_BOOKS[shelf]?.() ?? null;

/** Whether the document claiming `id` on `shelf` is a row of a printed table that a repair rewrites. */
const isTableRow = (shelf, id) => !!TABLE_REPAIRS[shelf] || (shelf === "Equipment" && String(id).startsWith("def.priced."));

/** The items every open or closed book introduces, as `[id, entry]` rows: a source of the entry picker. */
function adventureItemEntries() {
  const rows = [];
  for (const cb of data.books.values()) {
    for (const [id, e] of Object.entries(cb.entries ?? {})) if (e.kind === "kind.adventureItem") rows.push([id, e]);
  }
  return rows;
}

/** Is this id an item a book introduces? Such a row files on its book's own folder, not on a cookbook shelf. */
const bookOwnEntry = (id) => cookbookEntry(id)?.entry?.kind === "kind.adventureItem";

/** Every entry id a repair run can write in place, across the picker's sources. */
const repairableEntryIds = () =>
  ENTRY_SOURCES.filter((src) => REPAIR_RUNS[src.refill]).flatMap((src) => src.entries().map(([id]) => id));

/**
 * How a monster-picker entry is repaired in place: `refill` for a stat-block
 * monster (`refillMonster`), `rewrite` for a template, a family, a person or a
 * legacy block, which its importer builds again under a rewrite (`withRewrite`),
 * and null for what no run writes. A pregenerated character is `rewrite` only
 * where `force` asks for it: the sheet import onto the held character lands
 * what it lacks and answers what it holds, and its biography and morale are
 * written again. A merged repair passes no `force` and puts the character to
 * the Judge instead (`repairPregens`).
 */
const monsterRepair = (id, force = false) => {
  const entry = cookbookEntry(id)?.entry;
  if (!entry) return null;
  if (!entry.kind || entry.kind === "kind.monster") return "refill";
  if (!ACTOR_KINDS.has(entry.kind)) return null;
  return characterEntry(entry) && !force ? null : "rewrite";
};

/**
 * Ask before a repair: one paragraph per line, an empty line left out. Closing
 * the dialog, like pressing No, answers false: nothing is written.
 */
function confirmRepair(lines, titleKey = "reimportTitle", ask = null) {
  // A caller asking for several runs at once answers in their place (`everything.mjs`).
  if (ask) return ask({ lines: lines.filter(Boolean), title: titleKey });
  return foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize(`${LANG_PREFIX}.ui.${titleKey}`) },
    classes: ["acks-ui", "acks-extras-importer-dialog"],
    content: lines
      .filter(Boolean)
      .map((line) => `<p>${line}</p>`)
      .join(""),
    rejectClose: false,
  });
}

/**
 * The lines every repair confirm closes on: the kinds it writes differently,
 * then what it keeps.
 */
function repairKeepsLines(runs, { monsters = false } = {}) {
  const t = (key) => game.i18n.localize(`${LANG_PREFIX}.ui.${key}`);
  return [
    monsters ? t("repairMonsters") : "",
    runs.has("cookbookImportAbilities") ? t("repairAbilities") : "",
    runs.has("importClasses") ? t("repairClasses") : "",
    t("repairMergedKeeps"),
  ];
}

/**
 * The tally a merged repair's pass writes under (`mergedTally`), with
 * `recreate` set: a build of another document type is made again under the
 * held document's id (`recreateUnderId`).
 */
function repairPassTally(decision) {
  const tally = mergedTally(decision);
  tally.recreate = (doc, built) => recreateUnderId(tally, doc, built);
  return tally;
}

/**
 * Make `doc` again under its own id from `built`, a build of another document
 * type, where it stands (its pack, or the sidebar), keeping its folder, owners
 * and sort. The id forces delete-first; a create the server refuses puts the
 * document back as it stood. Counted in `tally.recreated`.
 * @returns {Promise<{recreated: foundry.abstract.Document, update: object, keptProse: string[], retract: string[],
 *   replace: object}|{refused: "error"}>} a plan-shaped result `countRepair` reads
 */
export async function recreateUnderId(tally, doc, built) {
  const cls = foundry.utils.getDocumentClass(doc.documentName);
  const snapshot = doc.toObject();
  const opts = doc.pack ? { pack: doc.pack } : {};
  const data = { ...built, _id: doc.id, folder: snapshot.folder ?? built.folder ?? null, sort: snapshot.sort ?? 0, ...(snapshot.ownership ? { ownership: snapshot.ownership } : {}) };
  try {
    await cls.deleteDocuments([doc.id], opts);
  } catch (err) {
    console.error(`${MODULE_ID} | repair of ${doc.name}: the document could not be removed to change its type`, err);
    return { refused: "error" };
  }
  let made = null;
  try {
    [made] = await cls.createDocuments([data], { ...opts, keepId: true });
  } catch (err) {
    console.error(`${MODULE_ID} | repair of ${doc.name}: the new type was refused`, err);
  }
  forgetImportedIndex(); // the index holds the document just removed
  if (!made) {
    await cls.createDocuments([snapshot], { ...opts, keepId: true }).catch((err) => console.error(`${MODULE_ID} | repair of ${doc.name}: put back failed`, err));
    return { refused: "error" };
  }
  tally.recreated = (tally.recreated ?? 0) + 1;
  return { recreated: made, update: {}, keptProse: [], retract: [], replace: {} };
}

/**
 * Copy `doc` under a new id where it stands (its pack, or the sidebar), in its
 * folder and with its owners, as a document of its own: its claim on the
 * cookbook and its play stamp are taken off, so no import or repair counts it as the book's again,
 * the claim it came from is recorded as `keptFrom`, and its name says it is
 * the kept one.
 * @returns {Promise<foundry.abstract.Document|null>} the copy, or null when the create was refused
 */
export async function keepUnderNewId(doc) {
  const cls = foundry.utils.getDocumentClass(doc.documentName);
  const data = doc.toObject();
  delete data._id;
  const { cookbook, playStamp: _stamp, ...own } = data.flags?.[MODULE_ID] ?? {};
  data.flags = { ...(data.flags ?? {}), [MODULE_ID]: { ...own, keptFrom: { id: cookbook?.id ?? null, uuid: doc.uuid ?? "" } } };
  data.name = game.i18n.format(`${LANG_PREFIX}.ui.repairMergedPregenKeptName`, { name: doc.name });
  try {
    const [made] = await cls.createDocuments([data], doc.pack ? { pack: doc.pack } : {});
    return made ?? null;
  } catch (err) {
    console.error(`${MODULE_ID} | repair of ${doc.name}: the kept copy was refused`, err);
    return null;
  }
}

/**
 * The pregenerated characters `ids` claim, under a merged repair (a tally
 * carrying a `decision`); nothing under any other tally. Pass one lists each
 * one the library holds in `tally.pregens` and writes nothing to it, `changed`
 * where its play stamp (`playStamp`) moved since the import recorded it or was
 * never recorded (`unstamped`). Pass two
 * acts on each as the decision answers it (`pregenAnswer`): `restore` keeps the
 * character under a new id (`keepUnderNewId`), then removes it and imports the
 * book's again under the id it stood under; `rewrite` writes the book over it
 * in place under the decision; `leave` does nothing. A copy dragged out of the
 * library, a player's character and a template's part are never listed. A
 * character whose kept copy is refused is left whole, and one whose book's
 * import then makes nothing keeps only its copy; both are counted in
 * `tally.pregenRefused`, as is a rewrite that throws. Each kept copy's uuid
 * is listed in `tally.kept`.
 */
export async function repairPregens(ids, actors, tally) {
  if (!tally || !("decision" in tally)) return;
  for (const id of ids) {
    const doc = actors.find((d) => !d.flags?.[MODULE_ID]?.templatePart && !isWorldCopy(d) && !playersCharacter(d) && claimsEntry(d, id));
    if (!doc) continue;
    if (!secondPass(tally)) {
      const stamp = doc.flags?.[MODULE_ID]?.playStamp;
      (tally.pregens ??= []).push({ uuid: doc.uuid, name: doc.name, id, changed: !stamp || stamp !== playStamp(doc.toObject()), ...(stamp ? {} : { unstamped: true }) });
      continue;
    }
    const answer = pregenAnswer(tally.decision, doc.uuid);
    if (answer === "leave") continue;
    if (answer === "rewrite") {
      const wrote = await withRewrite({ held: new Map([[id, doc]]), tally, ...decisionOf(tally) }, () => importOne(bookOf(cookbookEntry(id)), id, null))
        .then(() => true)
        .catch((err) => (console.error(`${MODULE_ID} | repair ${id}`, err), false));
      if (wrote) tally.rewritten = (tally.rewritten ?? 0) + 1;
      else tally.pregenRefused = (tally.pregenRefused ?? 0) + 1;
      continue;
    }
    const copy = await keepUnderNewId(doc);
    if (!copy) {
      tally.pregenRefused = (tally.pregenRefused ?? 0) + 1;
      continue;
    }
    (tally.kept ??= []).push(copy.uuid);
    await deleteImported("Actor", [doc]);
    forgetImportedIndex();
    // The kept copy stands whatever the import does; an import that made nothing is counted, never retried here.
    const made = await importMany([id], game.i18n.localize(`${LANG_PREFIX}.ui.cookbookWorking`)).catch((err) => {
      console.error(`${MODULE_ID} | repair ${id}: the book's character was not imported again`, err);
      return 0;
    });
    if (made) tally.restored = (tally.restored ?? 0) + 1;
    else tally.pregenRefused = (tally.pregenRefused ?? 0) + 1;
  }
}


/** Say on the console that an API caller's `mode` picks nothing now: every repair is the merged one. */
function ignoredMode(mode, fn) {
  if (mode !== undefined) console.warn(`${MODULE_ID} | ${fn}: "mode" is ignored; it writes in place and holds every edit you made for you to keep or take.`);
}

/**
 * Report a merged repair (`mergedRepair`'s result) once: what was written, the
 * edits taken and kept, what was made again as another type and what was left.
 * The edits still standing are listed on the console.
 */
function reportMerged(result) {
  ui.notifications.info(game.i18n.format(`${LANG_PREFIX}.ui.repairMergedDone`, {
    replaced: result.replaced, taken: result.taken, held: result.held, recreated: result.recreated, refused: result.refused,
  }));
  if (result.refused) ui.notifications.info(game.i18n.localize(`${LANG_PREFIX}.ui.repairRefusedHint`));
  if (result.notOffered) ui.notifications.info(game.i18n.format(`${LANG_PREFIX}.ui.repairMergedNotOffered`, { n: result.notOffered }));
  if (result.pregens) {
    ui.notifications.info(game.i18n.format(`${LANG_PREFIX}.ui.repairMergedPregensDone`, {
      restored: result.restored, rewritten: result.rewritten, left: Math.max(0, result.pregens - result.restored - result.rewritten - result.pregenRefused),
    }));
  }
  if (result.edits?.length) console.info(`${MODULE_ID} | edits kept`, result.edits.map((e) => `${e.name || e.uuid} · ${e.path}${e.unstamped ? " (unstamped)" : ""}`));
}

/**
 * One pass of a merged repair (`mergedRepair`) over ONE shelf, in place: every
 * entry filed on it is written over its document where that stands, under
 * `tally`, and imported where the world lacks it. A document whose book is
 * not open here is left and counted; one no run writes in place (a price-list
 * row) is left too; one of a book the module no longer offers is out of
 * scope, written nothing and counted in `notOffered`. `quiet` skips the confirm, as a second pass does; `ask`
 * answers the confirm in its place (`confirmRepair`).
 */
async function repairShelf(shelf, { tally, quiet = false, ask = null }) {
  const run = SHELF_REFILL[shelf];
  const tableRun = TABLE_REPAIRS[shelf];
  if (!tableRun && !REPAIR_RUNS[run]) {
    ui.notifications.warn(game.i18n.format(`${LANG_PREFIX}.ui.repairShelfRebuildOnly`, { shelf }));
    return null;
  }
  const prefixes = shelfPrefixes(shelf);
  const onShelf = (id) => prefixes.some((p) => String(id).startsWith(`${p}.`));
  // An entry of a book the module no longer offers is out of scope: no run is handed it.
  const ids = new Set(repairableEntryIds().filter((id) => onShelf(id) && offeredHere(id)));
  // Actors too: an animal is an equipment entry filed as a creature.
  const shelved = [...(await importedDocs("Item")), ...(await importedDocs("Actor"))].filter(
    (d) => !d.flags?.[MODULE_ID]?.templatePart && onShelf(claimedId(d)),
  );
  const notOffered = shelved.filter((d) => !offeredHere(claimedId(d))).length;
  const held = shelved.filter((d) => ids.has(claimedId(d)) || isTableRow(shelf, claimedId(d)));
  const over = held.filter((d) => readableHere(claimedId(d)));
  const kept = held.length - over.length;
  const skipped = shelved.length - held.length - notOffered;
  const ok = quiet || await confirmRepair(
    [
      game.i18n.format(`${LANG_PREFIX}.ui.repairMergedConfirm`, { n: over.length, shelf }),
      kept ? game.i18n.format(`${LANG_PREFIX}.ui.reimportKeepsClosed`, { n: kept }) : "",
      skipped ? game.i18n.format(`${LANG_PREFIX}.ui.repairSkipsDocs`, { n: skipped }) : "",
      notOffered ? game.i18n.format(`${LANG_PREFIX}.ui.repairMergedNotOffered`, { n: notOffered }) : "",
      ...repairKeepsLines(new Set([run])),
    ],
    "repairMergedTitle",
    ask,
  );
  if (!ok) return null;
  if (shelf === "Equipment") tally.tables = new Set(["priced"]);
  const refill = await mergedStep(tally, run ?? shelf, () => (tableRun ? tableRun(tally) : REPAIR_RUNS[run](ids, tally)));
  return { shelf, notOffered, ...repairCounts(tally), refill: refill ?? null };
}

/**
 * One pass of a merged repair over everything imported from ONE book, in
 * place, over the shelves that have a run, the vehicles, and the printed
 * tables the book prints. Each run takes only this book's entries, so
 * repairing one book never writes over another book's documents. A book with
 * a cookbook of its own that is no Judge's book (a rulebook, a bestiary) also
 * has its own rows written over, by `runAdventureBookSteps` without the items
 * and the Adventure; a Judge's book does that in `cookbookReimportAdventure`.
 * A document no run writes in place is
 * left, and its shelf named. A book the module no longer offers is out of
 * scope: nothing is asked or written, and its documents are counted in
 * `notOffered`. Its options are `repairShelf`'s.
 */
async function repairBook(bookId, label, { tally, quiet = false, ask = null }) {
  const runs = new Map();
  for (const src of ENTRY_SOURCES) {
    if (!REPAIR_RUNS[src.refill]) continue;
    for (const [id] of src.entries()) {
      // A source that names no shelf (a book's own items, the vehicles) is taken whole.
      if (bookOf(cookbookEntry(id)) !== bookId || (src.shelves && !refillShelfOf(id))) continue;
      if (!runs.has(src.refill)) runs.set(src.refill, new Set());
      runs.get(src.refill).add(id);
    }
  }
  const touched = new Set([...runs.values()].flatMap((ids) => [...ids]));
  // A document a run writes claims its entry's id or a row filed beneath it (a vehicle's `<entry>.<row>`).
  const touchedBy = (id) => ancestorsOf(id).some((a) => touched.has(a));
  const ofBook = (d) => {
    if (d.flags?.[MODULE_ID]?.templatePart) return false;
    const flag = d.getFlag(MODULE_ID, "cookbook");
    return !!flag?.id && bookOfFlag(flag) === bookId && !!(refillShelfOf(flag.id) || touchedBy(flag.id));
  };
  // Actors too: an animal is an equipment entry filed as a creature, and a vehicle is an actor.
  const docs = [...(await importedDocs("Item")), ...(await importedDocs("Actor"))].filter(ofBook);
  // A book's own item names its folder for a shelf, the group `targetFolder` files it under.
  const shelfOf = (d) => refillShelfOf(claimedId(d)) ?? "Items";
  // The book's table rows: a table's rows carry no book on their ids, so the
  // book that prints the table owns them (`tableBookOf`), and each is read again
  // whenever the book is open.
  const rowShelves = new Set(Object.keys(TABLE_BOOKS).filter((shelf) => tableBookOf(shelf) === bookId));
  const rowDocs = (await importedDocs("Item")).filter((d) => {
    if (d.flags?.[MODULE_ID]?.templatePart) return false;
    const shelf = refillShelfOf(claimedId(d));
    return shelf && isTableRow(shelf, claimedId(d)) && rowShelves.has(TABLE_REPAIRS[shelf] ? shelf : "priced");
  });
  // A book the module no longer offers is out of scope: nothing is written and its documents are counted.
  if (!BOOKS[bookId]) return { book: bookId, notOffered: docs.length, ...repairCounts(tally), refill: {} };
  const over = [...docs.filter((d) => touchedBy(claimedId(d))), ...rowDocs];
  const overIds = new Set(over.map((d) => d.uuid));
  const left = docs.filter((d) => !overIds.has(d.uuid));
  const shelves = [...new Set(over.map(shelfOf))].sort();
  // A book with a cookbook of its own: its own rows (creatures, people, pages, tables) are written over too. A Judge's
  // book does that through its own repair (`cookbookReimportAdventure`).
  const own = data.books.has(bookId) && !bookIsJudges(bookId);
  const ownCounts = own && !quiet ? (await adventureForceCensus(bookId)).written : "";
  const ok = quiet || await confirmRepair(
    [
      game.i18n.format(`${LANG_PREFIX}.ui.repairMergedConfirmBook`, {
        n: over.length,
        book: label,
        shelves: shelves.join(", ") || "—",
      }),
      own
        ? game.i18n.format(`${LANG_PREFIX}.ui.repairMergedBookOwn`, {
            counts: ownCounts || game.i18n.localize(`${LANG_PREFIX}.ui.reimportAdventureNothing`),
          })
        : "",
      left.length
        ? game.i18n.format(`${LANG_PREFIX}.ui.repairSkipsShelves`, {
            n: left.length,
            shelves: [...new Set(left.map(shelfOf))].sort().join(", "),
          })
        : "",
      ...repairKeepsLines(runs),
    ],
    "repairMergedTitle",
    ask,
  );
  if (!ok) return null;
  // The price list rides on the equipment run, even where the book names no equipment entry.
  if (rowShelves.has("priced")) {
    tally.tables = new Set(["priced"]);
    if (!runs.has("importAllEquipment")) runs.set("importAllEquipment", new Set());
  }
  const refill = {};
  // In SHELF_REFILL's order (the import chain runs traps before merchandise,
  // this runs them the other way round); a run no shelf names (a book's own
  // items) follows them.
  for (const run of new Set([...Object.values(SHELF_REFILL), ...Object.keys(REPAIR_RUNS)])) {
    if (runs.has(run)) refill[run] = (await mergedStep(tally, run, () => REPAIR_RUNS[run](runs.get(run), tally))) ?? null;
  }
  for (const shelf of rowShelves) {
    if (TABLE_REPAIRS[shelf]) refill[shelf] = (await mergedStep(tally, shelf, () => TABLE_REPAIRS[shelf](tally))) ?? null;
  }
  // The items ran above, so the steps leave them be; the Adventure is a Judge's book's alone.
  if (own) refill.own = await runAdventureBookSteps(bookId, { tally, adventure: false, items: false });
  return { book: bookId, notOffered: 0, ...repairCounts(tally), refill };
}

/**
 * Write actor-kind entries over the documents that hold them, in place, and
 * import the ones the world lacks. A stat-block monster (`monsters`) is refilled
 * whole (`refillMonster`); a template, a family, a person or a legacy block
 * (`rewrites`) is built by its importer again, and the create it would make is a
 * write over the held document (`withRewrite`). `tally.force` lifts the prose guards
 * of a stat-block monster, and of the rest where the tally carries no
 * `decision`; with one (`decisionOf`), a rewrite holds hand-written prose as an
 * edit (`decidedPolicy`) and pushes it to `tally.edits`.
 *
 * @param {{monsters?: string[], rewrites?: string[]}} ids cookbook ids by how each is written
 * @param {foundry.documents.Actor[]} actors the imported actors, the library's and the world's
 * @param {object} tally a `repairTally` to count into
 * @returns {Promise<{missing: string[], imported: number|null}>} the ids no actor held (imported
 *   after the writes)
 */
async function repairActors({ monsters = [], rewrites = [] }, actors, tally) {
  const claimedBy = (id) => (doc) => !doc.flags?.[MODULE_ID]?.templatePart && claimsEntry(doc, id);
  const missing = [];
  // Monsters first, as the rebuild runs them.
  for (const id of monsters) {
    const held = actors.filter(claimedBy(id));
    if (!held.length) missing.push(id);
    for (const actor of held) {
      if (!unrepaired(tally, actor)) continue;
      const done = await refillMonster(actor, { whole: true, force: tally.force, repair: tally }).catch((err) => {
        console.error(`${MODULE_ID} | repair ${actor.name}`, err);
        return null;
      });
      countRepair(tally, done?.ok ? done : (done?.reason ?? "error"));
    }
  }
  // Every document claiming a rewritten id is written: one pass per document
  // a claim has, each holding one document per claim, so two documents under
  // one claim are both built over. A claimer another kind owns is left. An
  // entry is built only in a pass that holds its own claim: these importers
  // create without asking presence, so a build with nothing held under its
  // claim would make a twin.
  const living = actors.filter((doc) => !doc.flags?.[MODULE_ID]?.templatePart);
  const { passes, missing: unclaimed, foreign } = claimerPasses(rewrites, living, { claimOf: claimedId, kinds: IMPORT_KINDS });
  missing.push(...unclaimed);
  tally.refused += foreign.length;
  for (const held of passes) {
    await withRewrite({ held, tally, ...decisionOf(tally) }, async () => {
      for (const id of rewrites.filter((id) => held.has(id))) {
        await importOne(bookOf(cookbookEntry(id)), id, null).catch((err) => console.error(`${MODULE_ID} | repair ${id}`, err));
      }
    });
  }
  const imported = missing.length ? await importMany(missing, game.i18n.localize(`${LANG_PREFIX}.ui.cookbookWorking`)) : null;
  return { missing, imported };
}

/**
 * Repair the ticked entries in place: a stat-block monster is refilled whole
 * (`refillMonster`), every other kind's run writes its entries over the
 * documents that hold them and imports the ones the world lacks, and rules
 * tables merge as they always do; one pass of a merged repair, under `tally`.
 * A kind no run writes in place is deleted and imported again under the same
 * id (`stableDocId`), on the first pass only; a pregenerated character the
 * world holds is listed for the Judge and acted on as answered (`repairPregens`).
 *
 * @param {{key: string, id: string}[]} picked ticked rows whose book is open here
 * @param {number} closed ticked rows refused for a closed book, counted into the report
 * @param {{tally: object, quiet?: boolean, ask?: Function|null}} opts `repairShelf`'s
 */
async function repairEntries(picked, closed, { tally, quiet = false, ask = null }) {
  const docs = { Actor: await importedDocs("Actor"), Item: await importedDocs("Item") };
  const byKey = new Map();
  for (const { key, id } of picked) {
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(id);
  }
  const runs = new Map();
  const monsters = [];
  const rewrites = [];
  let rebuildOnly = 0;
  // Under a merged repair: the ids no run writes, rebuilt under the same id, and the
  // pregenerated characters, put to the Judge after pass one (`repairPregens`).
  const rebuilds = [];
  const pregens = [];
  for (const [key, ids] of byKey) {
    if (key === "Tables") continue;
    if (key === "Monsters") {
      for (const id of ids) {
        const how = monsterRepair(id);
        if (how === "refill") monsters.push(id);
        else if (how === "rewrite") rewrites.push(id);
        else {
          rebuildOnly++;
          if (!characterEntry(cookbookEntry(id)?.entry)) rebuilds.push(id);
          else pregens.push(id);
        }
      }
      continue;
    }
    const run = ENTRY_SOURCES.find((src) => src.key === key)?.refill;
    if (!REPAIR_RUNS[run]) {
      rebuildOnly += ids.length;
      continue;
    }
    if (!runs.has(run)) runs.set(run, new Set());
    for (const id of ids) runs.get(run).add(id);
  }
  const touched = [...monsters, ...rewrites, ...[...runs.values()].flatMap((ids) => [...ids])];
  const claimed = (id) => (doc) => !doc.flags?.[MODULE_ID]?.templatePart && claimsEntry(doc, id);
  const over = [...docs.Actor, ...docs.Item].filter((doc) => touched.some((id) => claimed(id)(doc))).length;

  const left = rebuildOnly - rebuilds.length;
  const ok = quiet || await confirmRepair(
    [
      game.i18n.format(`${LANG_PREFIX}.ui.repairMergedConfirmEntries`, { n: over, picked: picked.length }),
      rebuilds.length ? game.i18n.format(`${LANG_PREFIX}.ui.repairMergedRebuilds`, { n: rebuilds.length }) : "",
      left ? game.i18n.format(`${LANG_PREFIX}.ui.repairMergedLeftEntries`, { n: left }) : "",
      ...repairKeepsLines(runs, { monsters: monsters.length > 0 }),
    ],
    "repairMergedTitle",
    ask,
  );
  if (!ok) return null;

  tally.refused += closed;
  const refill = {};
  const second = secondPass(tally);
  if (rebuilds.length && !second) {
    // Never a copy dragged out of the library, a template's part or a player's character.
    const doomed = docs.Actor.filter((doc) => !doc.flags?.[MODULE_ID]?.templatePart && !isWorldCopy(doc) && !playersCharacter(doc)
      && rebuilds.some((id) => claimsEntry(doc, id)));
    await deleteImported("Actor", doomed);
    forgetImportedIndex();
    refill.rebuilt = await importMany(rebuilds, game.i18n.localize(`${LANG_PREFIX}.ui.cookbookWorking`));
  }
  const actors = await mergedStep(tally, "actors", () => repairActors({ monsters, rewrites }, docs.Actor, tally));
  if (actors?.missing.length) refill.Monsters = actors.imported;
  if (pregens.length) await mergedStep(tally, "pregens", () => repairPregens(pregens, docs.Actor, tally));
  for (const [run, only] of runs) refill[run] = (await mergedStep(tally, run, () => REPAIR_RUNS[run](only, tally))) ?? null;
  const tables = byKey.get("Tables");
  if (tables?.length && !second) {
    const run = ENTRY_SOURCES.find((src) => src.key === "Tables").idsRefill;
    refill[run] = (await api()[run](tables)) ?? null;
  }
  return { picked: picked.length, rebuildOnly, rebuilt: rebuilds.length, ...repairCounts(tally), refill };
}


/* -------------------------------------------- */
/*  Reimport one shelf                          */
/* -------------------------------------------- */

/**
 * Which importer refills each top-level shelf. The shelves themselves are not
 * listed here — `ITEM_SHELF` already says which id namespaces land on which
 * shelf; this names only which run rebuilds one once it is empty. Every
 * importer here is dedup-driven, so it also imports whatever of its domain
 * the world never held. See docs/importer/DECISIONS.md, "Three controls, not
 * twenty-one".
 */
export const SHELF_REFILL = {
  // A book run, which may need several, runs them in this order. It is the
  // import chain's order except that merchandise precedes traps here.
  Proficiencies: "cookbookImportAbilities",
  "Class Powers": "cookbookImportAbilities",
  Drawbacks: "cookbookImportAbilities",
  Skills: "cookbookImportAbilities",
  Equipment: "importAllEquipment",
  Weapons: "importWeapons",
  Armor: "importArmor",
  Variations: "importVariations",
  Merchandise: "importMerchandise",
  Traps: "importTraps",
  Spells: "importSpells",
  Classes: "importClasses",
  Languages: "cookbookImportTables",
  Races: "cookbookImportTables",
};

/** id namespaces that file onto a shelf, read off the shelf table itself. */
const shelfPrefixes = (shelf) =>
  Object.entries(ITEM_SHELF)
    .filter(([, name]) => name === shelf)
    .map(([prefix]) => prefix);

/** Every shelf that can be rebuilt on its own, in shelf order. */
export const reimportableShelves = () =>
  [...new Set(Object.values(ITEM_SHELF))].filter((shelf) => SHELF_REFILL[shelf] && shelfPrefixes(shelf).length).sort();

/**
 * Run a merged repair (`mergedRepair`) over one scope, `pass`, and report it
 * once. Handed a `tally`, the caller drives the passes (`cookbookReimportEverything`):
 * one pass runs under it, quiet on a second pass, and nothing is reported.
 * The Judge answers for the held edits and the pregenerated characters left
 * (`chooseHeldEditsDialog`); `choose` answers in the Judge's place.
 * @param {(tally: object, at: {first: boolean}) => Promise<object|null|undefined>} pass
 * @param {{decision?: unknown, tally?: object|null, finish?: ((tally: object) => Promise<unknown>)|null,
 *   choose?: ((edits: object[], more: {pregens: object[]}) => Promise<unknown>)|null}} [opts]
 */
async function runMerged(pass, { decision = null, tally = null, finish = null, choose = null } = {}) {
  if (tally) return pass(tally, { first: !secondPass(tally) });
  const result = await mergedRepair({ pass, decision, choose: choose ?? chooseHeldEditsDialog, makeTally: repairPassTally, finish });
  if (result) reportMerged(result);
  return result;
}

/**
 * GM: repair ONE top-level shelf in place (`repairShelf`) as a merged repair
 * (`runMerged`): every document on it is written over where it stands, an
 * entry the world lacks is imported, and an edit a Judge made to what the
 * import wrote is held, not written over, unless the decision takes it.
 * Documents a class template made are never touched, nor is a document whose
 * book is not open here. See docs/importer/DECISIONS.md, "Three controls, not
 * twenty-one".
 *
 * @param {string} [shelf] a name from `reimportableShelves()`; omitted, asks.
 * @param {{mode?: unknown, ask?: Function|null, decision?: Parameters<typeof decides>[0], tally?: object|null,
 *   choose?: Function|null}} [opts]
 *   `mode` is ignored (`ignoredMode`); `ask` answers the confirm in its place; `decision` is
 *   the caller's word on the Judge's edits (`decides`); `tally` and `choose` are `runMerged`'s
 */
export async function cookbookReimportShelf(shelf = null, { mode, ask = null, decision = null, tally = null, choose = null } = {}) {
  ignoredMode(mode, "cookbookReimportShelf");
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (writes over imported documents).`);
  if (!shelf) {
    const groups = rebuildOptions();
    const optionsOf = (rows) => rows.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join("");
    return foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize(`${LANG_PREFIX}.ui.reimportTitle`) },
      classes: ["acks-ui", "acks-extras-importer-dialog"],
      content: `<p class="notes">${game.i18n.localize(`${LANG_PREFIX}.ui.repairMergedPickHint`)}</p>
        <div class="form-group"><label>${game.i18n.localize(`${LANG_PREFIX}.ui.reimportPick`)}</label>
        <select name="pick">
          ${groups.map((g) => `<optgroup label="${esc(g.label)}">${optionsOf(g.options)}</optgroup>`).join("")}
        </select></div>`,
      ok: {
        label: game.i18n.localize(`${LANG_PREFIX}.ui.reimportGo`),
        callback: (event, button) => runRebuildPick(button.form.elements.pick.value),
      },
    });
  }
  if (!SHELF_REFILL[shelf]) return ui.notifications.warn(`${MODULE_ID} | "${shelf}" is not a shelf that can be rebuilt on its own.`);
  return runMerged((t, at) => repairShelf(shelf, { tally: t, quiet: !at.first, ask }), { decision, tally, choose });
}

/**
 * What a rebuild control offers, in groups: every shelf that can be rebuilt
 * on its own (a shelf no run writes in place says so beside its name), every
 * book open on this seat with something to rebuild, and the rules tables,
 * which are no shelf — they are read into the ruledata store and merge there,
 * so their options re-read in place and delete nothing; one document may be
 * re-read alone, seconds where the whole store is minutes. An option's
 * `value` is `<kind>:<id>`, which `runRebuildPick` dispatches on. The
 * Reimport One Shelf dialog and the import manager's Rebuild tab both draw
 * from here, so they can never offer different things.
 * @returns {{key: string, label: string, options: {value: string, label: string}[]}[]}
 */
export function rebuildOptions() {
  const t = (key, data) => (data ? game.i18n.format(`${LANG_PREFIX}.ui.${key}`, data) : game.i18n.localize(`${LANG_PREFIX}.ui.${key}`));
  const rebuildOnly = ` (${t("reimportRebuildOnly")})`;
  const shelves = reimportableShelves().map((n) => ({ value: `shelf:${n}`, label: `${n}${REPAIR_RUNS[SHELF_REFILL[n]] || TABLE_REPAIRS[n] ? "" : rebuildOnly}` }));
  const books = reimportableBooks().map((b) => ({ value: `book:${b.id}`, label: b.label }));
  const tables = [
    { value: "tables:", label: t("reimportTablesAll") },
    ...Object.keys(TABLE_RECIPES)
      .sort()
      .map((docId) => ({ value: `tables:${docId}`, label: t("reimportTablesOne", { doc: docId }) })),
  ];
  return [
    { key: "shelves", label: t("reimportGroupShelves"), options: shelves },
    ...(books.length ? [{ key: "books", label: t("reimportGroupBooks"), options: books }] : []),
    { key: "tables", label: t("reimportGroupTables"), options: tables },
  ];
}

/**
 * Run one `rebuildOptions` value: a shelf or a book is repaired in place as a
 * merged repair (`cookbookReimportShelf`, `cookbookReimportBook`); the rules
 * tables are re-read in place (every table, or one document). Resolves to the
 * run's own result. `mode` is ignored (`ignoredMode`).
 */
export function runRebuildPick(value, mode) {
  ignoredMode(mode, "runRebuildPick");
  const [kind, ...rest] = String(value ?? "").split(":");
  const picked = rest.join(":");
  if (kind === "tables") return api().cookbookImportTables(picked ? [picked] : null);
  return kind === "book" ? cookbookReimportBook(picked) : cookbookReimportShelf(picked);
}

/**
 * GM: a merged repair (`mergedRepair`) over everything imported from the books
 * open on this seat, asked once (`everything.mjs`): every book's
 * (`cookbookReimportBook`), then every adventure book's
 * (`cookbookReimportAdventure`), all under one tally per pass, so the edits
 * every part held are answered together. The first pass closes on the rules
 * tables re-read in place; each adventure book's Adventure is written once,
 * after the last pass. Nothing of a book closed here is touched, as in each
 * part alone.
 * @param {unknown} [mode] ignored (`ignoredMode`)
 * @param {{decision?: Parameters<typeof decides>[0], choose?: Function|null}} [opts] the caller's word on
 *   the Judge's edits, and `runMerged`'s `choose`
 */
export async function cookbookReimportEverything(mode, { decision = null, choose = null } = {}) {
  ignoredMode(mode, "cookbookReimportEverything");
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (writes over imported documents).`);
  const t = (key, data) => game.i18n.format(`${LANG_PREFIX}.ui.${key}`, data ?? {});
  const adventures = new Set();
  const adventureList = await adventureBooks();
  const partsUnder = (tally) => [
    ...reimportableBooks().map((b) => ({ label: b.label, run: (ask) => cookbookReimportBook(b.id, { ask, tally }) })),
    ...adventureList.map((b) => ({
      label: t("everythingAdventure", { book: b.label }),
      run: async (ask) => {
        const out = await cookbookReimportAdventure(b.id, { ask, tally });
        if (out && !secondPass(tally)) adventures.add(b.id);
        return out;
      },
    })),
  ];
  let asked = [];
  const pass = async (tally, { first }) => {
    if (!first) {
      for (const part of partsUnder(tally).filter((p) => asked.includes(p.label))) await part.run(async () => true);
      return {};
    }
    const result = await reimportEverything({
      mode: "repair",
      parts: partsUnder(tally),
      asking: holdingLibrary,
      confirm: (rows) =>
        confirmRepair(
          [t("repairMergedEverything", { n: rows.length }), ...rows.flatMap(({ label, lines }) => [`<strong>${esc(label)}</strong>`, ...lines]), t("everythingClosed")],
          "repairMergedTitle",
        ),
      after: () => api().cookbookImportTables?.(null),
    });
    if (result?.asked === 0) {
      ui.notifications.info(t("everythingNone"));
      return undefined;
    }
    asked = (result?.parts ?? []).map((p) => p.label);
    return result;
  };
  // Every adventure book a part repaired gets its Adventure written once, from what the last pass left.
  const finish = async () => (adventures.size ? api().cookbookImportAdventures?.({ books: [...adventures], force: true }) : null);
  return runMerged(pass, { decision, finish, choose });
}

/** The rebuildable shelf a cookbook id files onto, or null when its shelf has no refill run. */
const refillShelfOf = (id) => {
  const shelf = ITEM_SHELF[shelfKeyOf(id)] ?? null;
  return shelf && SHELF_REFILL[shelf] ? shelf : null;
};

/**
 * The book an imported document was read from: the book of the entry its claim
 * names (itself or the entry a row is filed beneath), else what its id spells.
 */
const bookOfFlag = (flag) => entryBookOf(flag.id) ?? bookOfCookbookId(flag.id, flag.book);

/**
 * Every book open on this seat with something in the cookbook to rebuild,
 * labelled, in label order. A book that is not open is not offered: a reimport
 * deletes first, and what nothing can read back would stay deleted.
 */
export const reimportableBooks = () => {
  const withContent = new Set(data.books.keys());
  for (const cb of data.content.values()) for (const e of Object.values(cb.entries ?? {})) if (e.book) withContent.add(e.book);
  return [...withContent]
    .filter((id) => ctx?.sessionDocs?.has(id))
    .map((id) => ({ id, label: BOOKS[id]?.label ?? id }))
    .sort((a, b) => a.label.localeCompare(b.label));
};

/**
 * GM: repair everything imported from ONE book in place (`repairBook`) as a
 * merged repair (`runMerged`): only shelves with a run are touched, an entry
 * the world lacks is imported, and an edit a Judge made to what the import
 * wrote is held, not written over, unless the decision takes it. A document
 * another book owns that MERGED one of this book's ids stays, because it is
 * that book's document; one no run writes in place is left and counted. See
 * docs/importer/DECISIONS.md, "A book is a reimport unit too".
 *
 * @param {string} bookId a key of BOOKS, open on this seat.
 * @param {{mode?: unknown, ask?: Function|null, decision?: Parameters<typeof decides>[0], tally?: object|null,
 *   choose?: Function|null}} [opts] `cookbookReimportShelf`'s
 */
export async function cookbookReimportBook(bookId, { mode, ask = null, decision = null, tally = null, choose = null } = {}) {
  ignoredMode(mode, "cookbookReimportBook");
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (writes over imported documents).`);
  const label = BOOKS[bookId]?.label ?? bookId;
  if (!ctx?.sessionDocs?.has(bookId)) {
    return ui.notifications.warn(game.i18n.format(`${LANG_PREFIX}.ui.reimportNotConnected`, { book: label }));
  }
  return runMerged((t, at) => repairBook(bookId, label, { tally: t, quiet: !at.first, ask }), { decision, tally, choose });
}

/**
 * Every adventure book open on this seat with a cookbook, labelled, in label
 * order, each with what the library holds of its Adventure (`bookCensus`).
 * What a control that rebuilds or repairs an adventure book offers.
 * @returns {Promise<{id: string, label: string, census: {adventure: object|null}}[]>}
 */
export async function adventureBooks() {
  const rows = [];
  for (const id of Object.keys(BOOKS)) {
    if (!bookIsJudges(id) || !ctx?.sessionDocs?.has(id) || !data.books.has(id)) continue;
    rows.push({ id, label: bookLabel(id), census: await bookCensus(id) });
  }
  return rows.sort((a, b) => a.label.localeCompare(b.label));
}

/** Whether a book's cookbook holds a row the places step would make a place of. */
function hasPlaceRows(bookId) {
  const entries = data.books.get(bookId)?.entries ?? {};
  const spaces = keySpacesOf(entries);
  return Object.entries(entries).some(([id, e]) => isPoiEntry(e) || isRegionSite(e) || isRegionOverview(e) || isKeyedPlace(e, id, spaces));
}

/**
 * The cookbook ids of the places and bodies a book's rows make, for a forced
 * repair to write over: a keyed place, a point of interest and a region site
 * that stands as its own place, and an organisation. A place two books print
 * (a pair's either side) is joined by its own step and left out, as are the
 * containers a place stands in (the book's own place, a quarter's, a region's).
 * @returns {{places: string[], factions: string[]}}
 */
function bodyRowIds(bookId) {
  const entries = data.books.get(bookId)?.entries ?? {};
  const spaces = keySpacesOf(entries);
  const pairs = placePairs(data.books);
  const places = [];
  const factions = [];
  for (const [id, e] of Object.entries(entries)) {
    if (isOrganisationRow(e)) factions.push(id);
    else if (pairs.has(id)) continue;
    else if (isPoiEntry(e)) {
      if (poiGroupOf(e.meta?.group).kind !== "overview") places.push(id);
    } else if (isRegionSite(e)) {
      if (regionSiteClaim(bookId, e, id, entries).onto === "site") places.push(id);
    } else if (isKeyedPlace(e, id, spaces)) places.push(id);
  }
  return { places, factions };
}

/**
 * The rows of one book that write their text onto a place they do not build,
 * each with the claim of that place: a row of a place two books print (the
 * place it shares, found under the row's own id), a region site bound onto a
 * market or the book's own settlement (`regionSiteClaim`), a quarter's
 * overview (its quarter's place) and a region's overview (the region's
 * place). Pure; a repair resolves each claim to the library's
 * document (`forcedPlaceHold`).
 * @param {string} bookId
 * @param {Record<string, object>} entries the book's cookbook entries
 * @param {Map<string, object>} pairs the place pairs every cookbook declares (`placePairs`)
 * @returns {{id: string, place: string}[]}
 */
export function placeBlockRows(bookId, entries, pairs) {
  const spaces = keySpacesOf(entries);
  const rows = [];
  for (const [id, e] of Object.entries(entries ?? {})) {
    if (isPoiEntry(e)) {
      const group = poiGroupOf(e.meta?.group);
      if (group.kind === "overview") rows.push({ id, place: districtPlaceId(bookId, group.district) });
      else if (pairs.has(id)) rows.push({ id, place: id });
    } else if (isRegionOverview(e)) {
      rows.push({ id, place: regionPlaceId(bookId) });
    } else if (isRegionSite(e)) {
      const claim = regionSiteClaim(bookId, e, id, entries);
      if (claim.onto !== "site") rows.push({ id, place: claim.claimId });
      else if (pairs.has(id)) rows.push({ id, place: id });
    } else if (isKeyedPlace(e, id, spaces) && pairs.has(id)) {
      rows.push({ id, place: id });
    }
  }
  return rows;
}

/**
 * What a repair of one book's places writes in place (`withRewrite`'s
 * `held` and `blocks`). `held`: the places it builds again (`placeIds`, from
 * `bodyRowIds`), each under its own claim, and the creatures made from their
 * stat lines (`<place>-o<i>`). `blocks`: the places the book's rows write
 * their text onto without building them (`placeBlockRows`), a shared place
 * only once it answers for the row. A place held by a claim merged into it is
 * never built over, since a build stamps the arriving row's claim.
 */
async function forcedPlaceHold(bookId, placeIds) {
  const held = new Map();
  for (const [id, doc] of await heldById(placeIds)) if (claimedId(doc) === id) held.set(id, doc);
  const stems = new Set(held.keys());
  for (const doc of await importedDocs("Actor")) {
    const claim = claimedId(doc);
    const stem = /^(.+)-o\d+$/.exec(claim)?.[1];
    if (stem && stems.has(stem) && !held.has(claim) && !doc.flags?.[MODULE_ID]?.templatePart) held.set(claim, doc);
  }
  const blocks = new Map();
  for (const { id, place } of placeBlockRows(bookId, data.books.get(bookId)?.entries ?? {}, placePairs(data.books))) {
    const doc = await importedActor(place, { copies: false });
    if (doc && answersFor(doc.getFlag(MODULE_ID, "cookbook"), place)) blocks.set(id, doc);
  }
  return { held, blocks };
}

/** The library's documents for a list of cookbook ids, by id; an id the world does not hold is left out. */
async function heldById(ids) {
  const held = new Map();
  for (const id of ids) {
    const doc = await importedActor(id, { copies: false });
    if (doc) held.set(id, doc);
  }
  return held;
}

/**
 * The import chain's steps that read ONE adventure book, narrowed to it, in
 * the chain's order: its monsters and people the world lacks first, since
 * every later step stands on them, and its Adventure last, since that is a
 * copy of what the rest made. A step with nothing of the book to read is
 * skipped rather than left to warn about an empty run. One failed step does
 * not stop the rest; each is reported.
 *
 * `force` writes the book's Adventure anew whatever its state. `tally`, a
 * `repairTally`, also writes in place what the world already holds of the
 * book: its creatures and people (`repairActors`), its own items and its roll
 * tables, and, when the tally is forced or carries a `decision`, its places,
 * organisations and market profiles (`bodyRowIds`, `withRewrite`,
 * `marketProfileUpdate`'s `force`). Under a decision, a place's roster, and a
 * body's strength and relations, that no longer hold the page's are edits
 * (`heldRoster`, `keepsJudgeFigure`); nothing a body holds is retracted; and
 * a pregenerated character the library holds is put to the Judge (`repairPregens`).
 * A page of a journal is refreshed in place unless it holds a Judge's prose,
 * which under a decision is an edit (`writeJournalPage`), and a map is refreshed
 * by its own step; on a merged repair's second pass (`secondPass`) only the steps
 * whose first pass held an edit run (`mergedStep`). `adventure: false` leaves
 * the Adventure step to the caller, and `items: false` the book's own items,
 * which a book repair has already written.
 * @param {string} bookId
 * @param {{force?: boolean, tally?: object|null, adventure?: boolean, items?: boolean}} [opts]
 * @returns {Promise<{steps: {key: string, result: unknown}[], errors: {key: string, message: string}[]}>}
 */
async function runAdventureBookSteps(bookId, { force = false, tally = null, adventure = true, items = true } = {}) {
  const a = api();
  const steps = [];
  const errors = [];
  const second = secondPass(tally);
  const run = async (key, fn) => {
    if (tally?.steps && !tally.steps.has(key)) return;
    try {
      steps.push({ key, result: (await mergedStep(tally, key, fn)) ?? null });
    } catch (err) {
      console.error(`${MODULE_ID} | reimport ${bookId}: ${key}`, err);
      errors.push({ key, message: err?.message ?? String(err) });
    }
  };
  const only = { books: [bookId] };
  await run("stepMonsters", async () => {
    const members = familyMemberIds();
    const rows = actorEntriesAcrossBooks().rows.filter((r) => r.bookId === bookId && !members.has(r.id));
    let written = 0;
    const handled = new Set();
    if (tally) {
      const how = { monsters: [], rewrites: [] };
      const pregens = [];
      for (const { id } of rows) {
        const kind = monsterRepair(id, !!tally.force);
        if (kind === "refill") how.monsters.push(id);
        else if (kind === "rewrite") how.rewrites.push(id);
        else {
          // A pregenerated character the world lacks is imported below, like any other absent row.
          if (characterEntry(cookbookEntry(id)?.entry)) pregens.push(id);
          continue;
        }
        handled.add(id);
      }
      const actors = await importedDocs("Actor");
      written = (await repairActors(how, actors, tally)).imported ?? 0;
      await repairPregens(pregens, actors, tally);
    }
    // Whatever is still absent.
    const present = await importedIdSet();
    const ids = rows.filter((r) => !handled.has(r.id) && !present.has(r.id)).map((r) => r.id);
    return written + (ids.length ? await importMany(ids, game.i18n.localize(`${LANG_PREFIX}.gs.stepMonsters`)) : 0);
  });
  // A forced or merged repair builds the book's held places and bodies again
  // and writes them over; a place's roster and, on a forced one, a body's
  // relations and strength are returned to empty first, since the import fills
  // them after the create.
  const decided = !!tally && "decision" in tally;
  const rewriting = !!tally?.force || decided;
  const ids = rewriting ? bodyRowIds(bookId) : { places: [], factions: [] };
  const scoped = async (list, retract, fn) =>
    (rewriting ? withRewrite({ held: await heldById(list), tally, retract: decided ? [] : retract, ...decisionOf(tally) }, fn) : fn());
  const placesScoped = async (fn) =>
    (rewriting ? withRewrite({ ...(await forcedPlaceHold(bookId, ids.places)), tally, retract: ["roster"], ...decisionOf(tally) }, fn) : fn());
  const journalsScoped = (fn) => (rewriting ? withRewrite({ held: new Map(), tally, ...decisionOf(tally) }, fn) : fn());
  await run("stepJournals", () => journalsScoped(() => a.cookbookImportJournals(only)));
  if (hasPlaceRows(bookId)) await run("stepPoi", () => placesScoped(() => a.cookbookImportPoiPlaces(only)));
  await run("stepFactions", () => scoped(ids.factions, ["relations", "strength"], () => a.cookbookImportFactions(only)));
  await run("stepMarkets", () => a.cookbookImportMarketProfiles({ ...only, repair: tally }));
  await run("stepRollTables", () => a.cookbookImportRollTables({ ...only, repair: tally }));
  if (items) await run("stepAdventureItems", () => a.cookbookImportAdventureItems({ ...only, repair: tally }));
  if (!second && Object.keys(data.books.get(bookId)?.scenes ?? {}).length) {
    await run("stepScenes", () => a.cookbookImportScenes(only));
    await run("stepLinks", () => a.cookbookImportLinks({ quiet: true }));
  }
  if (adventure) await run("stepAdventures", () => a.cookbookImportAdventures({ ...only, force }));
  return { steps, errors };
}

/** A document type's name in the user's language, plural when `n` is not one. */
const typeCount = (type, n) => {
  const key = foundry.utils.getDocumentClass(type)?.metadata?.[n === 1 ? "label" : "labelPlural"];
  return `${n} ${key ? game.i18n.localize(key) : type}`;
};

/**
 * What a repair of an adventure book writes over: the documents the book
 * owns, counted by kind as `written` (its places and organisations apart from
 * its creatures and people, a place one of its rows writes text onto counted
 * among the places, another book's included), `markets` when the book prints
 * a market grid whose profiles are written onto its places, and the `left` it
 * does not write (the abilities and classes another step owns, a pregenerated
 * character, and a place no row of the book writes onto).
 * @returns {Promise<{written: string, left: number, markets: boolean}>}
 */
async function adventureForceCensus(bookId) {
  const ownerOf = (doc) => {
    const flag = doc.getFlag?.(MODULE_ID, "cookbook") ?? doc.flags?.[MODULE_ID]?.cookbook ?? null;
    return flag?.id ? bookOfCookbookId(flag.id, flag.book) : null;
  };
  const owned = adventureDropRows(await bookDocuments(bookId), bookId, { ownerOf, isWorldCopy, isPlayers: playersCharacter });
  const bodies = bodyRowIds(bookId);
  // A place a row writes its text onto counts as written, the book's own or
  // another's (a place two books print, held by the other book).
  const blockRows = placeBlockRows(bookId, data.books.get(bookId)?.entries ?? {}, placePairs(data.books));
  const places = new Set([...bodies.places, ...blockRows.map((r) => r.place)]);
  const factions = new Set(bodies.factions);
  const byType = new Map();
  let nPlaces = 0;
  let nFactions = 0;
  let left = 0;
  const ownedDocs = new Set(owned.map((r) => r.doc));
  const shared = new Set();
  for (const { place } of blockRows) {
    const doc = await importedActor(place, { copies: false });
    if (doc && !ownedDocs.has(doc) && answersFor(doc.getFlag(MODULE_ID, "cookbook"), place)) shared.add(doc);
  }
  nPlaces += shared.size;
  for (const { type, doc } of owned) {
    const id = claimedId(doc);
    if (type === "Actor" && places.has(id)) nPlaces++;
    else if (type === "Actor" && factions.has(id)) nFactions++;
    else {
      const written =
        type === "Actor" ? !!monsterRepair(id) : type === "Item" ? bookOwnEntry(id) : type === "RollTable" || type === "JournalEntry";
      if (written) byType.set(type, (byType.get(type) ?? 0) + 1);
      else left++;
    }
  }
  const t = (key, n) => game.i18n.format(`${LANG_PREFIX}.ui.${key}`, { n });
  const parts = [...byType].map(([type, n]) => typeCount(type, n));
  if (nPlaces) parts.push(t("forceCensusPlaces", nPlaces));
  if (nFactions) parts.push(t("forceCensusOrganisations", nFactions));
  const grids = Object.values(data.books.get(bookId)?.entries ?? {}).some((e) => e.kind === "kind.marketGrid");
  return { written: parts.join(", "), left, markets: grids };
}

/**
 * GM: repair everything imported from ONE adventure book in place, as a
 * merged repair (`runMerged`). Nothing is deleted: the book's steps run again
 * under the pass's tally (`runAdventureBookSteps`), importing what the world
 * lacks, refreshing its maps in place, and writing over, in place, what the
 * world holds of the book (`adventureForceCensus` counts it for the confirm):
 * its creatures and people, its own items, its roll tables, its places, the
 * creatures made from their stat lines, its organisations and the market
 * profiles on its places, and the text a row writes onto a place it shares (a
 * place two books print, a market or settlement a site is bound onto, a
 * quarter or region an overview describes). A Judge's edit to any of them is
 * written only where the decision takes it, and is otherwise kept and
 * returned in `edits`; a pregenerated character the library holds is put to
 * the Judge (`repairPregens`), answered by `choose` only, since a decision
 * passed in runs one pass and pass one acts on no character. The book's
 * Adventure is written anew once, after the last pass.
 * Kept: a copy dragged out of the library (`isWorldCopy`), a character a
 * player owns (`playersCharacter`), and a document another book owns that
 * merged one of this book's ids. See docs/importer/DECISIONS.md, "An
 * adventure book is a reimport unit".
 *
 * @param {string} bookId a Judge's book of BOOKS, open on this seat.
 * @param {{mode?: unknown, ask?: Function|null, decision?: Parameters<typeof decides>[0], tally?: object|null,
 *   choose?: Function|null}} [opts] `cookbookReimportShelf`'s
 * @returns {Promise<object|null|undefined>} `mergedRepair`'s result, `book`, `steps` and `errors` from
 *   the first pass
 */
export async function cookbookReimportAdventure(bookId, { mode, ask = null, decision = null, tally = null, choose = null } = {}) {
  ignoredMode(mode, "cookbookReimportAdventure");
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (writes over imported documents).`);
  const label = bookLabel(bookId);
  const t = (key, data) => game.i18n.format(`${LANG_PREFIX}.ui.${key}`, data ?? {});
  if (!bookIsJudges(bookId) || !data.books.has(bookId)) return ui.notifications.warn(t("reimportAdventureNotJudges", { book: label }));
  if (!ctx?.sessionDocs?.has(bookId)) return ui.notifications.warn(t("reimportNotConnected", { book: label }));
  const pass = async (passTally, { first }) => {
    if (first) {
      const { written, left, markets } = await adventureForceCensus(bookId);
      const ok = await confirmRepair(
        [
          t("repairMergedAdventureConfirm", { book: label, counts: written || t("reimportAdventureNothing") }),
          markets ? t("repairMergedAdventureMarkets") : "",
          left ? t("repairMergedAdventureLeft", { n: left }) : "",
          t("repairMergedAdventureKeeps"),
        ],
        "repairMergedTitle",
        ask,
      );
      if (!ok) return null;
    }
    // The Adventure is a copy of what the steps made, so it is written once the last pass has run.
    const { steps, errors } = await runAdventureBookSteps(bookId, { force: true, tally: passTally, adventure: false });
    if (first) {
      const tail = errors.length ? t("reimportAdventureErrors", { n: errors.length }) : "";
      ui.notifications[errors.length ? "warn" : "info"](t("reimportAdventureRepaired", { book: label, steps: steps.length, errors: tail }));
    }
    return { book: bookId, steps, errors };
  };
  const finish = () => api().cookbookImportAdventures({ books: [bookId], force: true });
  return runMerged(pass, { decision, tally, finish, choose });
}


/* -------------------------------------------- */
/*  (Re)import individual entries               */
/* -------------------------------------------- */

/**
 * The loaded entry a claim names, under the claim itself or a dot-ancestor of
 * it (a row filed beneath its entry), or null.
 */
const entryUnder = (claim) => {
  for (const id of ancestorsOf(claim)) {
    const found = cookbookEntry(id);
    if (found) return found;
  }
  return null;
};

/** Whether a found entry is a row of a book's own cookbook, as opposed to a content row. */
const isOwnRow = (found) => !!found && [...data.books.values()].includes(found.cb);

/** The book the entry a claim names is read from, or undefined where it names none. */
const entryBookOf = (claim) => bookOf(entryUnder(claim)) ?? undefined;

/**
 * `owns` for a kind that is a family of entries: the claim is no row of a
 * printed table, the entry it names is a row of a book's own cookbook (`own`)
 * or of a content cookbook, and `is(entry, found)` accepts it.
 */
const ownsEntry = (own, is) => (claim) => {
  if (tableShelfOfClaim(claim)) return false;
  const found = entryUnder(claim);
  return !!found && isOwnRow(found) === own && is(found.entry, found);
};

/** The `is` of `ownsEntry` for entries of the given kinds. */
const ofKinds = (...kinds) => (entry) => kinds.includes(entry.kind);

/** The `[claim, entry]` rows of the books' own cookbooks that `is(entry, claim, entries)` accepts. */
const bookRows = (is) =>
  [...data.books.values()].flatMap((cb) => Object.entries(cb.entries ?? {}).filter(([id, e]) => is(e, id, cb.entries ?? {})));

/**
 * Every importable entry, grouped by the run that rebuilds one. `refill`
 * names the api function; every importer named here takes `only`, the ids to
 * consider. Monsters name no refill — `importMany` already takes an explicit
 * id list. Weapons, armor and the price list are built from whole printed
 * tables rather than an entry apiece, so they stay with the shelf rebuild
 * instead. Rules tables carry no `type` and an `idsRefill` instead of a
 * `refill`: they live in the ruledata store, merge rather than replace, and
 * there is nothing to delete before re-reading one. See
 * docs/importer/DECISIONS.md, "Rules tables join the entry picker as
 * documents, not as tables".
 *
 * Each source is also a kind in the declaration `IMPORT_KINDS` (`import-kinds.mjs`
 * lists the fields): `owns`, `book` and `make` say which claims it owns, which
 * book each is read from and which run re-creates it, and `make.run` is
 * `refill`, else `idsRefill`, else `importMany`.
 */
export const ENTRY_SOURCES = [
  {
    key: "Monsters",
    type: "Actor",
    refill: null,
    entries: () => actorEntriesAcrossBooks().rows.map((r) => [r.id, r.entry]),
    owns: ownsEntry(true, (e) => actorKindOf(e)),
    book: entryBookOf,
    make: { run: "importMany", takes: ["ids"], whole: "cookbookImportMonsters" },
    own: true,
    chain: "stepMonsters",
    bookSteps: ["stepMonsters"],
  },
  {
    key: "Abilities",
    type: "Item",
    refill: "cookbookImportAbilities",
    entries: () => [...abilityEntries()],
    owns: ownsEntry(false, (e) => isAbilityEntry(e)),
    book: entryBookOf,
    make: { run: "cookbookImportAbilities", takes: ["only"] },
    shelves: ["Proficiencies", "Class Powers", "Drawbacks", "Skills"],
    chain: "stepAbilities",
    viaBook: true,
  },
  {
    key: "Classes",
    type: "Item",
    refill: "importClasses",
    entries: () => [...classEntries()],
    owns: ownsEntry(false, ofKinds("kind.class")),
    book: entryBookOf,
    make: { run: "importClasses", takes: ["only"] },
    shelves: ["Classes"],
    chain: "stepClasses",
    viaBook: true,
  },
  {
    key: "Equipment",
    type: "Item",
    // An animal is an equipment entry filed as a creature, so its document is an Actor.
    asCreature: true,
    refill: "importAllEquipment",
    entries: () => cookbookEquipmentIds().map((id) => [id, cookbookEntry(id)?.entry ?? {}]),
    owns: ownsEntry(false, ofKinds("kind.equipment")),
    book: entryBookOf,
    make: { run: "importAllEquipment", takes: ["only"] },
    shelves: ["Equipment"],
    chain: "stepEquipment",
    viaBook: true,
  },
  {
    key: "Traps",
    type: "Item",
    refill: "importTraps",
    entries: () => [...trapEntries()],
    owns: ownsEntry(false, ofKinds("kind.trap")),
    book: entryBookOf,
    make: { run: "importTraps", takes: ["only"] },
    shelves: ["Traps"],
    chain: "stepTraps",
    viaBook: true,
  },
  // A book's own items stand in its folder, on no cookbook shelf: a source
  // with no `shelves` is one a book repair takes where `refillShelfOf` answers nothing.
  {
    key: "BookItems",
    type: "Item",
    refill: "cookbookImportAdventureItems",
    entries: () => adventureItemEntries(),
    owns: ownsEntry(true, ofKinds("kind.adventureItem")),
    book: entryBookOf,
    make: { run: "cookbookImportAdventureItems", takes: ["only", "books"] },
    own: true,
    chain: "stepAdventureItems",
    bookSteps: ["stepAdventureItems"],
  },
  {
    key: "Spells",
    type: "Item",
    refill: "importSpells",
    entries: () => [...spellEntries()],
    owns: ownsEntry(false, ofKinds("kind.spell")),
    book: entryBookOf,
    make: { run: "importSpells", takes: ["only"] },
    shelves: ["Spells"],
    chain: "stepSpells",
    viaBook: true,
  },
  {
    key: "Variations",
    type: "Item",
    refill: "importVariations",
    entries: () => [...variationEntries()],
    owns: ownsEntry(false, ofKinds("kind.variation")),
    book: entryBookOf,
    make: { run: "importVariations", takes: ["only"] },
    shelves: ["Variations"],
    chain: "stepVariations",
    viaBook: true,
  },
  {
    key: "Vehicles",
    type: "Actor",
    refill: "importVehicles",
    entries: () => [...vehicleEntries()],
    owns: ownsEntry(false, ofKinds("kind.vehicle")),
    book: entryBookOf,
    make: { run: "importVehicles", takes: ["only"] },
    chain: "stepVehicles",
    viaBook: true,
  },
  // The demand entry is no row of its own: it appends onto the goods, and the
  // goods' run reads it, so only the merchandise table is offered; the kind
  // owns the demand entry's claim all the same.
  {
    key: "Merchandise",
    type: "Item",
    refill: "importMerchandise",
    entries: () => [...merchandiseEntries("kind.merchandise")],
    owns: ownsEntry(false, ofKinds("kind.merchandise", "kind.merchandiseDemand")),
    book: entryBookOf,
    make: { run: "importMerchandise", takes: ["only"] },
    shelves: ["Merchandise"],
    chain: "stepMerchandise",
    viaBook: true,
  },
  {
    key: "Tables",
    type: null,
    idsRefill: "cookbookImportTables",
    owns: (claim) => Object.hasOwn(TABLE_RECIPES, claim),
    book: (claim) => tableDocBook(claim),
    make: { run: "cookbookImportTables", takes: ["ids"] },
    chain: "stepTables",
    // A ruledata document's row names the document and cites the pages its
    // recipes read; the tables under it are not offered separately because the
    // store's unit is the document, which is what a merge writes. Present means
    // the import's own layer holds it: a sample a module registers under the
    // same id is not an import.
    entries: () =>
      Object.entries(TABLE_RECIPES).map(([docId, rec]) => [
        docId,
        { name: docId, cite: rec.source?.pages ?? "" },
      ]),
    present: (docId) => !!getLayer(docId, PRIORITY.WORLD),
  },
];

/**
 * A table shelf as a kind: the rows of a printed table (a weapon, an armour
 * row, a price-list row, a language, a race). Its rows carry no entry and no
 * book on their ids, so it owns them by namespace (`tableShelfOfClaim`) and
 * reads the book from the table's recipe (`TABLE_BOOKS`). A book scope does not
 * name them today.
 */
const tableShelfKind = (key, shelf, { shelves, make, chain }) => ({
  key,
  type: "Item",
  entries: () => [],
  owns: (claim) => tableShelfOfClaim(claim) === shelf,
  book: () => tableBookOf(shelf) ?? undefined,
  books: () => [tableBookOf(shelf)].filter(Boolean),
  make,
  shelves,
  chain,
});

/** Whether an entry is a place the places step writes as an Actor: a keyed place, a point of interest, a region row. */
const isPlaceEntry = (e, id, entries) => isPoiEntry(e) || isRegionSite(e) || isRegionOverview(e) || isKeyedPlace(e, id, keySpacesOf(entries));

/** Whether an entry is a page of a book journal (`journalBound`). */
const isPageEntry = (e, id, entries) => journalBound(e, id, keySpacesOf(entries));

const placeEntryOwned = ownsEntry(true, (e, found) => isPlaceEntry(e, found.id, found.cb.entries ?? {}));
const pageEntryOwned = ownsEntry(true, (e, found) => isPageEntry(e, found.id, found.cb.entries ?? {}));

/** A creature made from a room's own stat line is claimed `<place id>-o<i>` and stands under its place. */
const placeStemOf = (claim) => String(claim).replace(/-o\d+$/, "");

/**
 * Whether a claim is a place the places step writes: a place entry, a
 * quarter's place, a region's place, the place a book's keyed areas nest under
 * (these three of a loaded book only), or the creature made from a place's own
 * stat line. The nesting place of a
 * book read from another game is written by that book's own import, and is
 * owned by no kind.
 */
const isPlaceClaim = (claim) => {
  const stem = placeStemOf(claim);
  const book = bookOfCookbookId(stem);
  if (data.books.has(book)) {
    if (stem.startsWith(`${book}.district.`) || stem === regionPlaceId(book)) return true;
    if (stem === adventurePlaceId(book)) return true;
  }
  return placeEntryOwned(stem);
};

/**
 * Whether a claim is a journal of a loaded book (`journalCookbookId`): a
 * journal holds a group's pages and no row names it.
 */
const isJournalClaim = (claim) => {
  const book = bookOfCookbookId(claim);
  return data.books.has(book) && String(claim).startsWith(`${book}.journal-`);
};

/** Whether a cookbook scene row is one the scenes step reads: a map's recipe, a zone laid over one, or a link between maps. */
const isSceneRow = (row) => isSceneRecipe(row) || isZoneRow(row) || isLinkRow(row);

/** The `[claim, row]` pairs of every book's scene rows. */
const sceneRows = () => [...data.books.values()].flatMap((cb) => Object.entries(cb.scenes ?? {}).filter(([, row]) => isSceneRow(row)));

/** The book an Adventure's own run reads: a Judge's book with a cookbook. */
const judgesBookIds = () => [...data.books.keys()].filter((id) => bookIsJudges(id));

/**
 * The kinds the table shelves are: each is the rows of one printed table.
 * `importAllEquipment` writes the weapon, armour and price-list tables itself,
 * so the chain runs them as the equipment step.
 */
const TABLE_SHELF_KINDS = [
  tableShelfKind("Weapons", "Weapons", {
    shelves: ["Weapons"],
    make: { run: "importWeapons", takes: [], whole: "importAllEquipment" },
    chain: "stepEquipment",
  }),
  tableShelfKind("Armor", "Armor", {
    shelves: ["Armor"],
    make: { run: "importArmor", takes: [], whole: "importAllEquipment" },
    chain: "stepEquipment",
  }),
  tableShelfKind("PriceList", "priced", {
    shelves: ["Equipment"],
    make: { run: "importAllEquipment", takes: [] },
    chain: "stepEquipment",
  }),
  tableShelfKind("Languages", "Languages", {
    shelves: ["Languages"],
    make: { run: "cookbookImportTables", takes: ["ids"] },
    chain: "stepTables",
  }),
  tableShelfKind("Races", "Races", {
    shelves: ["Races"],
    make: { run: "cookbookImportTables", takes: ["ids"] },
    chain: "stepTables",
  }),
];

/**
 * The kinds an adventure book's run reads beyond its creatures and items (the
 * `Monsters` and `BookItems` sources above): its pages, its places, its
 * organisations, its market grids, its roll tables, its maps and its Adventure.
 * Each is a book's own rows (`own`), and `bookSteps` names the steps
 * `runAdventureBookSteps` reports it under.
 */
const BOOK_STEP_KINDS = [
  {
    key: "Journals",
    type: "JournalEntry",
    entries: () => bookRows(isPageEntry),
    owns: (claim) => isJournalClaim(claim) || pageEntryOwned(claim),
    book: (claim) => (isJournalClaim(claim) ? bookOfCookbookId(claim) : entryBookOf(claim)),
    make: { run: "cookbookImportJournals", takes: ["books"] },
    own: true,
    chain: "stepJournals",
    bookSteps: ["stepJournals"],
  },
  {
    key: "Places",
    type: "Actor",
    entries: () => bookRows(isPlaceEntry),
    owns: isPlaceClaim,
    book: (claim) => entryBookOf(placeStemOf(claim)) ?? bookOfCookbookId(placeStemOf(claim)),
    make: { run: "cookbookImportPoiPlaces", takes: ["books", "ids"] },
    own: true,
    chain: "stepPoi",
    bookSteps: ["stepPoi"],
  },
  {
    key: "Organisations",
    type: "Actor",
    entries: () => bookRows((e) => isOrganisationRow(e) || isStrengthGridRow(e)),
    owns: ownsEntry(true, (e) => isOrganisationRow(e) || isStrengthGridRow(e)),
    book: entryBookOf,
    make: { run: "cookbookImportFactions", takes: ["books"] },
    own: true,
    chain: "stepFactions",
    bookSteps: ["stepFactions"],
  },
  // A market grid and its records write onto the places; they own no document.
  {
    key: "Markets",
    type: null,
    entries: () => bookRows(ofKinds("kind.marketGrid", "kind.marketRecord")),
    owns: ownsEntry(true, ofKinds("kind.marketGrid", "kind.marketRecord")),
    book: entryBookOf,
    make: { run: "cookbookImportMarketProfiles", takes: ["books"] },
    own: true,
    chain: "stepMarkets",
    bookSteps: ["stepMarkets"],
  },
  {
    key: "RollTables",
    type: "RollTable",
    entries: () => bookRows(ofKinds("kind.rolltable")),
    owns: ownsEntry(true, ofKinds("kind.rolltable")),
    book: entryBookOf,
    make: { run: "cookbookImportRollTables", takes: ["books"] },
    own: true,
    chain: "stepRollTables",
    bookSteps: ["stepRollTables"],
  },
  // A map's rows sit in the book's `scenes`, not its entries; the links step follows the maps.
  {
    key: "Scenes",
    type: "Scene",
    entries: () => sceneRows(),
    owns: (claim) => isSceneRow(data.books.get(bookOfCookbookId(claim))?.scenes?.[claim]),
    book: (claim) => bookOfCookbookId(claim),
    make: { run: "cookbookImportScenes", takes: ["books"] },
    own: true,
    chain: "stepScenes",
    bookSteps: ["stepScenes", "stepLinks"],
  },
  // A book's Adventure is one document per Judge's book, and no register row names it.
  {
    key: "Adventures",
    type: ADVENTURE_TYPE,
    entries: () => judgesBookIds().map((id) => [bookAdventureCookbookId(id), { name: bookLabel(id) }]),
    owns: (claim) => {
      const book = bookOfCookbookId(claim);
      return bookIsJudges(book) && data.books.has(book) && claim === bookAdventureCookbookId(book);
    },
    book: (claim) => bookOfCookbookId(claim),
    books: () => judgesBookIds(),
    make: { run: "cookbookImportAdventures", takes: ["books"] },
    own: true,
    chain: "stepAdventures",
    bookSteps: ["stepAdventures"],
  },
];

/**
 * Every kind of document the importer makes, one declaration (`import-kinds.mjs`
 * lists the fields): the entry sources, the table shelves and the adventure
 * book's steps. A cookbook claim is owned by at most one kind, and each kind
 * names the run that re-creates it. A claim owned by no kind is one nothing
 * here can re-create: a constant and a class's metadata.
 */
export const IMPORT_KINDS = Object.freeze([...ENTRY_SOURCES, ...TABLE_SHELF_KINDS, ...BOOK_STEP_KINDS]);

/**
 * The importer runs a scope of work needs, derived from `IMPORT_KINDS`
 * (`runSetFor`): `{shelf}`, `{book}`, `{entries: [claim, ...]}` or `{all: true}`.
 * A book scope names what a book repair writes, in `SHELF_REFILL`'s order, and
 * the book's own rows, wherever the book has a cookbook, as one
 * `runAdventureBookSteps`; `all` is in the import chain's order. Nothing calls
 * it yet.
 * @returns {{runs: {run: string, kinds: string[], ids?: string[], book?: string}[], unowned: string[]}}
 */
export const cookbookRunSet = (scope) =>
  deriveRunSet(scope, {
    kinds: IMPORT_KINDS,
    order: { book: Object.values(SHELF_REFILL), all: GM_STEPS.map(([key]) => key) },
  });

/**
 * The `TABLE_BOOKS` key a claim files under when it is a row of a printed table
 * (a weapon, an armour row, a price-list row, a language, a race), or null for
 * any other claim.
 */
const tableShelfOfClaim = (id) => {
  const shelf = ITEM_SHELF[shelfKeyOf(id)] ?? null;
  if (shelf === "Equipment") return String(id).startsWith("def.priced.") ? "priced" : null;
  return shelf && Object.hasOwn(TABLE_BOOKS, shelf) ? shelf : null;
};

/**
 * Whether a rebuild may delete the library document claiming `id`: a loaded
 * owner can re-create it (an entry of a loaded cookbook, or the recipe of the table a row is read from),
 * its book is open on this seat, and that book is one the module offers
 * (`BOOKS`). Every delete a rebuild makes asks this first; a document it
 * refuses is left standing and counted. See `rebuildVerdict`.
 */
const rebuildable = (id) => {
  const owner = ownerOfClaim(id, {
    entryBookOf: (claim) => {
      const found = cookbookEntry(claim);
      return found ? bookOf(found) : undefined;
    },
    groupBookOf: (claim) => {
      const book = groupBookOf(claim);
      return book && data.books.has(book) ? book : undefined;
    },
    tableBookOf: (claim) => {
      const shelf = tableShelfOfClaim(claim);
      return shelf ? (tableBookOf(shelf) ?? undefined) : undefined;
    },
  });
  return rebuildVerdict({ ...owner, isOpen: (book) => !!ctx?.sessionDocs?.has(book), books: BOOKS }) === "rebuild";
};

/**
 * Which entry ids this world already holds something for.
 *
 * Every dot-ancestor of a claim is recorded beside the claim itself, so a
 * vehicle entry whose rows are present reads as present without a scan per
 * entry. An id that is a strict prefix of an unrelated claim would read present
 * wrongly; the row's own checkbox still imports it, and a mark is not a gate.
 */
function claimedEntryIds(docs) {
  const have = new Set();
  for (const doc of docs) {
    const claim = claimedId(doc);
    if (!claim) continue;
    const parts = claim.split(".");
    for (let n = parts.length; n > 0; n--) have.add(parts.slice(0, n).join("."));
  }
  return have;
}

/**
 * Filter / select-all / count wiring shared by nothing else — the picker below
 * owns it. Rows carry their own searchable text and present-mark in datasets;
 * this only reads them.
 */
function wireEntryPicker(root, listEl) {
  const count = root.querySelector(".acks-extras-importer-abil-count");
  const all = () => [...listEl.querySelectorAll(".acks-extras-importer-browse-row")];
  const shown = () => all().filter((r) => r.style.display !== "none");
  const tally = () => {
    const n = listEl.querySelectorAll('input[name="sel"]:checked').length;
    count.textContent = game.i18n.format(`${LANG_PREFIX}.ui.abilCount`, { n, shown: shown().length });
  };
  const refresh = () => {
    const q = root.querySelector('[name="filter"]').value.toLowerCase();
    const hide = root.querySelector('[name="hideHave"]').checked;
    for (const r of all()) {
      const ok = r.dataset.name.includes(q) && (!hide || r.dataset.have === "0");
      r.style.display = ok ? "" : "none";
      // A hidden row must not stay selected: what the list shows is the only
      // honest account of what pressing the button will do.
      if (!ok) r.querySelector('input[name="sel"]').checked = false;
    }
    tally();
  };
  const check = (rows) => {
    for (const r of rows) r.querySelector('input[name="sel"]').checked = true;
    tally();
  };
  for (const sel of ['[name="filter"]', '[name="hideHave"]']) root.querySelector(sel).addEventListener("input", refresh);
  listEl.addEventListener("change", tally);
  root.querySelector('[data-act="all"]').addEventListener("click", () => {
    root.querySelector('[name="filter"]').value = "";
    root.querySelector('[name="hideHave"]').checked = false;
    refresh();
    check(all());
  });
  root.querySelector('[data-act="shown"]').addEventListener("click", () => check(shown()));
  root.querySelector('[data-act="none"]').addEventListener("click", () => {
    for (const el of listEl.querySelectorAll('input[name="sel"]')) el.checked = false;
    tally();
  });
  tally();
}

/**
 * GM debug tool: list every importable entry with a checkbox and rebuild the
 * ones ticked — the finest of the rebuild controls, next to "import
 * everything" and "rebuild one shelf". A document a class template made is
 * never touched. The id is shown beside every row since it is what a recipe,
 * a register and a console call all name. See docs/importer/DECISIONS.md,
 * "The entry picker runs each importer over the ticked entries only".
 */
export async function cookbookReimportEntries() {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (deletes and creates documents).`);
  const docs = { Actor: await importedDocs("Actor"), Item: await importedDocs("Item") };
  const have = claimedEntryIds([...docs.Actor, ...docs.Item]);
  const onlyTip = game.i18n.localize(`${LANG_PREFIX}.ui.repairMergedRebuildTip`);

  let total = 0;
  const blocks = ENTRY_SOURCES.map((src) => {
    const entries = src.entries().sort((a, b) => String(a[1]?.name ?? a[0]).localeCompare(String(b[1]?.name ?? b[0])));
    if (!entries.length) return "";
    total += entries.length;
    const group = game.i18n.localize(`${LANG_PREFIX}.ui.reimportKind${src.key}`);
    // A source that is not documents answers for its own presence — the claim
    // index is built from document flags and knows nothing about the ruledata
    // store.
    const held = (id) => (src.present ? src.present(id) : have.has(id));
    // A row no run writes in place is marked: a repair deletes it and imports it
    // again under the same id (`repairEntries`). A pregenerated character is left, unmarked.
    const rebuildOnly = (id) =>
      src.key === "Monsters"
        ? !monsterRepair(id) && !characterEntry(cookbookEntry(id)?.entry)
        : src.key !== "Tables" && !REPAIR_RUNS[src.refill];
    const rows = entries
      .map(([id, e]) => {
        const name = e?.name ?? id;
        const searchable = `${name} ${id} ${group}`.toLowerCase();
        return `<label class="acks-extras-importer-browse-row" data-name="${esc(searchable)}" data-have="${held(id) ? 1 : 0}">
          <input type="checkbox" name="sel" value="${esc(`${src.key}|${id}`)}">
          <span>${esc(name)}</span>
          <span class="acks-extras-importer-marks">${
            held(id)
              ? `<i class="fa-solid fa-check" data-tooltip="${esc(game.i18n.localize(`${LANG_PREFIX}.ui.cookbookPresent`))}"></i>`
              : ""
          }${rebuildOnly(id) ? `<i class="fa-solid fa-hammer" role="img" aria-label="${esc(onlyTip)}" data-tooltip="${esc(onlyTip)}"></i>` : ""}</span>
          <span class="acks-extras-importer-cite">${esc(e?.cite ? `${id} · ${e.cite}` : id)}</span>
        </label>`;
      })
      .join("");
    return `<div class="acks-extras-importer-book-head">${esc(group)} (${entries.length})</div>${rows}`;
  }).join("");

  if (!total) return ui.notifications.warn(`${MODULE_ID} | nothing importable is compiled into this build.`);

  const content = `
    <p class="notes">${game.i18n.format(`${LANG_PREFIX}.ui.repairMergedEntriesHint`, { n: total })}</p>
    <div class="acks-extras-importer-abil-filters">
      <input type="text" name="filter" placeholder="${game.i18n.localize(`${LANG_PREFIX}.ui.cookbookFilter`)}">
      <label><input type="checkbox" name="hideHave"> ${game.i18n.localize(`${LANG_PREFIX}.ui.abilHidePresent`)}</label>
    </div>
    <div class="acks-extras-importer-abil-actions">
      <button type="button" data-act="all">${game.i18n.localize(`${LANG_PREFIX}.ui.cookbookSelectAll`)}</button>
      <button type="button" data-act="shown">${game.i18n.localize(`${LANG_PREFIX}.ui.abilSelectShown`)}</button>
      <button type="button" data-act="none">${game.i18n.localize(`${LANG_PREFIX}.ui.abilClear`)}</button>
      <span class="acks-extras-importer-abil-count"></span>
    </div>
    <div class="acks-extras-importer-browse-list acks-extras-importer-mon-list">${blocks}</div>`;

  return foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.localize(`${LANG_PREFIX}.ui.reimportEntriesTitle`), resizable: true },
    classes: ["acks-ui", "acks-extras-importer-dialog"],
    position: { width: 600, height: 720 },
    content,
    render: (event, dialog) => {
      const root = dialog.element ?? dialog;
      wireEntryPicker(root, root.querySelector(".acks-extras-importer-mon-list"));
    },
    ok: {
      label: game.i18n.localize(`${LANG_PREFIX}.ui.reimportGo`),
      callback: async (event, button) => {
        const picked = [...button.form.querySelectorAll('input[name="sel"]:checked')].map((el) => {
          const [key, ...rest] = String(el.value).split("|");
          return { key, id: rest.join("|") };
        });
        if (!picked.length) return ui.notifications.warn(`${MODULE_ID} | nothing selected.`);
        return runEntryReimport(picked);
      },
    },
  });
}

/**
 * Repair the picked entries in place (`repairEntries`) as a merged repair
 * (`runMerged`). An entry whose book is not open on this seat is refused
 * before anything is written. See docs/importer/DECISIONS.md, "The entry
 * picker runs each importer over the ticked entries only". `mode` is ignored
 * (`ignoredMode`); `decision` and `choose` are `cookbookReimportShelf`'s.
 */
async function runEntryReimport(all, { mode, decision = null, choose = null } = {}) {
  ignoredMode(mode, "cookbookReimportEntries");
  // Rules tables carry no book to check and delete nothing. An entry nothing
  // loaded here can put back (`rebuildable`) is refused before any write.
  const closed = all.filter(({ key, id }) => key !== "Tables" && !rebuildable(id));
  const picked = all.filter((p) => !closed.includes(p));
  if (closed.length) ui.notifications.warn(game.i18n.format(`${LANG_PREFIX}.ui.reimportLeft`, { n: closed.length }));
  if (!picked.length) return null;
  return runMerged((t, at) => repairEntries(picked, closed.length, { tally: t, quiet: !at.first }), { decision, choose });
}

/**
 * GM: delete EVERY document this module imported — the packs it created, the
 * world documents it or its materializers made from them, the folders they
 * were filed in, and the rules-table documents the ruledata provider
 * materialized on import. The counterpart to "import all".
 *
 * Three identities: this module's own cookbook flag; `flags[MODULE_ID]
 * .templatePart` on the class-template bundles, their skinned gear and the
 * per-class 3d6 tables (world documents by design); and the ruledata
 * provider's own count, which it removes itself. A map stood up from a
 * recipe is a world Scene carrying the first, and so are the places and
 * organisations brought into the world for it to stand on.
 *
 * Hand-made documents carry none of the three and are never touched. Art
 * files stay on disk (Foundry exposes no delete API) and are reused by a
 * re-import.
 */
export async function cookbookRemoveImports() {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (deletes documents).`);
  const templatePart = (d) => !!d.flags?.[MODULE_ID]?.templatePart;
  const mine = (d) => !!d.getFlag(MODULE_ID, "cookbook") || templatePart(d);
  const groups = [
    ["Actor", game.actors.filter((d) => mine(d) && !playersCharacter(d))],
    ["Item", game.items.filter(mine)],
    ["JournalEntry", game.journal.filter(mine)],
    ["RollTable", game.tables.filter(mine)],
    ["Scene", game.scenes.filter(mine)],
    // Folders LAST: deleting a folder while it still holds documents
    // re-parents them instead of taking them with it.
    ["Folder", game.folders.filter(mine)],
  ];
  // The packs themselves, found by LABEL rather than through `packFor` — a
  // world can hold packs this session has never opened, and a clean slate has
  // to reach those too.
  const ourPacks = game.packs.filter(
    (p) => p.metadata.packageType === "world" && String(p.metadata.label ?? "").startsWith(`${FOLDER_NAME} — `),
  );
  const packed = ourPacks.reduce((n, p) => n + p.index.size, 0);
  // The rules-table import also materialized documents (RollTables, their
  // folders, the JSON journal) through the ruledata provider, which stamps no
  // cookbook flag; the provider counts and removes only the sidebar ones,
  // since its shelf ones go with the packs above. The imported table DATA
  // (the world store the automation reads) stays: this is a tidy-up, not an
  // un-import.
  const ruledata = services.get("ruledata-import");
  const materialized = ruledata?.countMaterializedDocs?.({ sidebar: true }) ?? 0;
  const total = groups.reduce((n, [, docs]) => n + docs.length, 0) + packed + materialized;
  if (!total) return ui.notifications.info(`${MODULE_ID} | nothing imported by this module to remove.`);
  const lines = [
    ...groups.filter(([, d]) => d.length).map(([type, d]) => `${d.length} ${type}(s)`),
    ...(packed ? [`${packed} in ${ourPacks.length} compendium(s)`] : []),
    ...(materialized ? [`${materialized} materialized rules-table document(s)`] : []),
  ].join(", ");
  const kept = game.actors.filter((d) => mine(d) && playersCharacter(d)).length;
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: "ACKS Extras — Remove Imports" },
    classes: ["acks-ui", "acks-extras-importer-dialog"],
    content: `<p>Delete <strong>${total}</strong> imported document(s): ${lines}?</p>
      <p class="notes">Only documents this module imported are removed. Extracted art files stay on disk and are reused by the next import.</p>
      ${kept ? `<p class="notes">${kept} imported character(s) a player owns stay.</p>` : ""}`,
  });
  if (!ok) return null;
  for (const [type, docs] of groups) {
    if (!docs.length) continue;
    await foundry.utils.getDocumentClass(type).deleteDocuments(docs.map((d) => d.id)).catch((err) => {
      console.warn(`${MODULE_ID} | remove ${type}`, err);
    });
  }
  // The packs themselves go — a re-import recreates them, and an empty
  // "ACKS Cookbook — Actor" left behind is just clutter.
  for (const p of ourPacks) {
    await p.deleteCompendium().catch((err) => console.warn(`${MODULE_ID} | remove pack ${p.collection}`, err));
  }
  if (materialized) {
    await ruledata.removeMaterializedDocs().catch((err) => console.warn(`${MODULE_ID} | remove materialized rules tables`, err));
  }
  packCache.clear();
  folderCache.clear();
  forgetImportedIndex(); // every id it remembers has just been deleted
  ui.notifications.info(`${MODULE_ID} | removed ${total} imported document(s).`);
  return total;
}

/**
 * The pack labels a batch of ids writes to, as one quoted list.
 *
 * A run walks every open book, and books from different lines go to different
 * compendia — so naming one pack in the report would send a Judge to a shelf
 * their Dolmenwood creatures are not on.
 */
const packLabelsFor = (type, ids) =>
  [...new Set(ids.map((id) => packLabel(type, lineOf(bookOfCookbookId(id)))))].sort().join('", "');

/** Report an import run, naming what was skipped as already present. */
function reportImport(done, picked, skipped, ids = []) {
  ui.notifications.info(
    game.i18n.format(`${LANG_PREFIX}.ui.cookbookDone`, {
      done,
      picked,
      pack: packLabelsFor("Actor", ids) || packLabel("Actor"),
    }) + (skipped ? ` ${game.i18n.format(`${LANG_PREFIX}.ui.cookbookSkipped`, { skipped })}` : ""),
  );
}

async function importOne(bookId, id, folderId) {
  await warmSpellPacksOnce();
  const found = cookbookEntry(id);
  // Adventure kinds route to their own binders; journals/tables have their own
  // importers and are never built here.
  const kind = found?.entry?.kind;
  if (kind === "kind.npc" || kind === "kind.pregen" || kind === "kind.monsterLegacy") return importAdventureActor(bookId, id, folderId);
  if (kind === "kind.monsterTemplate") return importTemplate(bookId, id, folderId);
  if (kind === "kind.monsterFamily") return importFamily(bookId, id, folderId);
  if (kind && kind !== "kind.monster") return null;
  const session = ctx.sessionDocs.get(bookId);
  // Skip the `art` op outright when the file is already on disk — see
  // docs/importer/DECISIONS.md, "The art op is skipped when the picture is
  // already on disk".
  const artOnDisk = await ctx.cachedArt?.(id).catch(() => null);
  const node = await executeEntry(session.doc, found.cb, data.registers, id, artOnDisk ? { skipOps: ["art"] } : {});
  if (!node.ok) {
    ui.notifications.warn(`${MODULE_ID} | ${found.entry.name}: page did not match the cookbook (different printing?) — skipped.`);
    return null;
  }
  const { system, items, flags, prototypeToken } = bindMonster(node);

  // The Full Monster Sheet is acks-extras' own sheet. Prose always routes to
  // its extras flag; system.details.biography is never a fallback destination.
  const { extras } = monsterProseChannels(node, id, found.entry.cite);

  // FILE IT NOW: the stat block has just told us the creature's TYPE, the axis
  // monsters are grouped by, and nothing afterwards decides a destination.
  const typed = primaryTypeOf(node);
  const folder = (await actorFolderFor(id, found, { type: typed }))?.id ?? folderId;

  // ONE write, not four: the embedded items, the cookbook id and the FMS extras
  // fold into the single create rather than costing a socket round-trip each.
  // Art follows separately — it needs the uploaded file path.
  const actor = await createDoc(Actor, {
    // A person's row ships a neutral label; the name is the page's own.
    name: printedNameOf(node, found.entry.name),
    type: "monster",
    folder,
    system,
    ...(prototypeToken ? { prototypeToken } : {}),
    // Merge, don't replace: an embedded shared ability keeps its cookbook id
    // (that id is what marks it as the shared one).
    items: items.map((i) => ({
      ...i,
      flags: { ...(i.flags ?? {}), [MODULE_ID]: { ...(i.flags?.[MODULE_ID] ?? {}), minted: true } },
    })),
    flags: {
      ...(flags ?? {}),
      // The stat block's TYPE rides on OUR flag, not only the Full Monster
      // Sheet's extras: it is the axis monsters are filed by, and a monster
      // with no extras would otherwise have nothing to group on.
      [MODULE_ID]: {
        ...((flags ?? {})[MODULE_ID] ?? {}),
        cookbook: { id, cite: found.entry.cite, ...(typed ? { type: typed } : {}) },
        extras,
      },
    },
  });
  // Foundry reports a schema-validation failure and returns undefined rather
  // than throwing, so an unimportable monster reads as one skipped rather
  // than a crash in the importer.
  if (!actor) {
    ui.notifications.warn(`${MODULE_ID} | ${found.entry.name}: the system rejected the extracted stats — skipped (see console).`);
    return null;
  }
  // Gated on the RECIPE asking for art, not on the op having run — see
  // docs/importer/DECISIONS.md, "The art op is skipped when the picture is
  // already on disk".
  const artInstr = found.entry.fields?.art ?? null;
  if ((artInstr || node.fields.art) && ctx.importArtForPage && !isRewriting(id)) {
    await ctx.importArtForPage(actor, session.doc, {
      id,
      page: artInstr?.page ?? found.entry.pages[0],
      name: artInstr?.name ?? node.fields.art?.name ?? null,
      box: artInstr?.box ?? null,
    });
  }
  await mintLeaderTemplate({ id, found, node, bound: { system, items, flags, prototypeToken }, extras, folder, bindDoc: session.doc, img: actor.img ?? "" });
  return actor;
}

/** Actor import for kind.npc / kind.monsterLegacy (with the defer rule). */
async function importAdventureActor(bookId, id, folderId) {
  const target = deferTarget(id);
  if (target) {
    // The deferred TARGET id gets its own already-present check — the caller
    // only filtered on the adventure id, and a world that imported the MM
    // entry directly must not get a twin.
    if ((await importedIdSet()).has(target)) {
      ui.notifications.info(`${MODULE_ID} | ${id} defers to ${target}, which this world already has — skipped.`);
      return null;
    }
    const tb = target.split(".")[0];
    ui.notifications.info(`${MODULE_ID} | ${id} is reprinted in ${BOOKS[tb]?.label ?? tb} — importing ${target} instead.`);
    // File it under the book it actually came FROM, not the adventure that
    // pointed at it.
    const tFolder = await actorFolderFor(target);
    return importOne(tb, target, tFolder?.id ?? folderId);
  }
  const found = cookbookEntry(id);
  const session = ctx.sessionDocs.get(bookId);
  const node = await executeEntry(session.doc, found.cb, data.registers, id);
  if (!node.ok) {
    ui.notifications.warn(`${MODULE_ID} | ${found.entry.name}: page did not match the cookbook (different printing?) — skipped.`);
    return null;
  }
  const kind = found.entry.kind;
  if (characterEntry(found.entry)) {
    const character = await importCharacter(bookId, id, folderId, node, found);
    await adventureActorArt(character, session, id, found, node);
    return character;
  }
  const bound = kind === "kind.npc" ? bindNpc(node) : bindLegacyMonster(node);
  const sl = bound.statline;
  const classLine = sl?.class ? `<p><em>${sl.class.name} ${sl.class.level}${sl.class.note ? ` (${sl.class.note})` : ""}</em></p>` : "";
  bound.system.details = {
    ...(bound.system.details ?? {}),
    biography: classLine + entryText(node, id, found.entry.cite),
  };
  // Proficiency tokens resolve through the shared ability-provider tiers.
  if (sl?.proficiencies?.length) {
    const { items: profItems, missing } = await resolveAbilities(sl.proficiencies);
    bound.items = [...(bound.items ?? []), ...profItems];
    if (missing.length) console.log(`${MODULE_ID} | ${id}: unresolved proficiencies ${missing.join(", ")}`);
  }
  const actor = await createDoc(Actor, {
    // The entry ships an ordinal label; the person is named from the page the
    // recipe just read, like every other document the book fills.
    name: printedNameOf(node, found.entry.name),
    type: "monster",
    folder: folderId,
    system: bound.system,
    // Stamped as the import's own so a repair replaces them and keeps any a Judge added.
    items: (bound.items ?? []).map((i) => ({
      ...i,
      flags: { ...(i.flags ?? {}), [MODULE_ID]: { ...(i.flags?.[MODULE_ID] ?? {}), minted: true } },
    })),
    flags: {
      [MODULE_ID]: {
        cookbook: { id, book: bookId, kind },
        ...(sl
          ? {
              npc: {
                ...(sl.class ? { class: sl.class } : {}),
                ...(sl.abilities ? { abilities: sl.abilities } : {}),
                ...(sl.equipment ? { equipment: sl.equipment } : {}),
                ...(sl.classAbilities ? { classAbilities: sl.classAbilities } : {}),
                ...(sl.spells ? { spells: sl.spells } : {}),
                ...(sl.hpEach ? { hpEach: true } : {}),
              },
            }
          : {}),
      },
    },
  });
  await adventureActorArt(actor, session, id, found, node);
  return actor;
}

/**
 * Same art path as the MM import: the compiled entry names ITS illustration
 * (associated by placement inside the entry's claimed region), and the seat
 * extracts + uploads it. A shipped placement BOX needs no runtime XObject
 * resolution (the AX books' art never registers on page.objs), so the box
 * alone is enough to proceed.
 */
async function adventureActorArt(actor, session, id, found, node) {
  const artInstr = found.entry.fields?.art ?? null;
  if (actor && artInstr && (artInstr.box || node.fields.art) && ctx.importArtForPage && !isRewriting(id)) {
    await ctx.importArtForPage(actor, session.doc, {
      id,
      page: artInstr.page ?? found.entry.pages[0],
      name: artInstr.name ?? node.fields.art.name ?? null,
      box: artInstr.box ?? null,
    });
  }
}

/**
 * The library's name for a printed one, by kind: a class or spell the library
 * answers keeps its name, else the conversion table's rename; a class neither
 * answers is then read behind its qualifier, and pushed to `read` as
 * `{printed, as}`; a proficiency resolves through the ability index, whose
 * aliases carry the older names.
 */
function libraryNameFor({ matchClass, matchSpell }, read = []) {
  const nameIndex = abilityNameIndex();
  const present = new Set(loadedAbilityIndex().keys());
  const renamed = (name, category) => {
    const conv = convertName(data.registers, name);
    return conv?.status === "renamed" && conv.category === category && conv.to ? conv.to : name;
  };
  return (kind, name) => {
    if (kind === "class") {
      if (matchClass(name)) return name;
      const to = renamed(name, "class");
      if (to !== name) return to;
      const base = classBehindQualifier(name, matchClass);
      if (base) read.push({ printed: name, as: base });
      return base ?? name;
    }
    if (kind === "spell") return matchSpell(name) ? name : renamed(name, "spell");
    const guess = idForName(nameIndex, name, present);
    return (guess && cookbookEntry(guess.id)?.entry?.name) || name;
  };
}

/**
 * A person the page prints in full, as a core character (DECISIONS
 * 2026-10-17, "A person the page prints in full becomes a character, and the
 * derivation wins"). The shell takes the entry's stable id, so a rebuild keeps
 * every reference to it; the sheet import binds the class at the printed level
 * and writes the scores, hit points and alignment; morale is written here, to
 * the system's bounds; and the biography carries the page's prose, then the
 * stamped "as printed" block with every figure the class works out differently
 * and every name the library could not answer. Owned by the Judges alone.
 */
async function importCharacter(bookId, id, folderId, node, found) {
  const sl = node.fields.statline ?? {};
  const kind = found.entry.kind;
  const _id = stableDocId(id);
  const shell = {
    _id,
    name: printedNameOf(node, found.entry.name),
    type: "character",
    folder: folderId,
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
    flags: { [MODULE_ID]: { cookbook: { id, book: bookId, kind } } },
  };
  // A document already standing under the stable id is this entry's from an
  // earlier run; making another under it is a duplicate-id throw.
  // A character answered rewrite is held: the create below returns it, and the
  // sheet import and the biography write that follow land on it where it stands;
  // a biography a Judge wrote in is kept under a decision (`keepsJudgeProse`).
  const { pack } = await packOptsFor("Actor", lineOfData(shell));
  if (!isRewriting(id) && (pack ? game.packs.get(pack)?.index.has(_id) : game.actors.has(_id))) {
    console.warn(`${MODULE_ID} | ${id}: a character already stands under its id — skipped.`);
    return null;
  }
  const actor = await createDoc(Actor, shell, { keepId: true });
  if (!actor) return null;
  const standing = new Set(actor.items.map((i) => i.id));
  // Loaded on use: the sheet import's tree registers hooks as it loads, and
  // this module is also loaded where no Foundry runs.
  const [{ importSheet }, matchers] = await Promise.all([import("../character-sheet/pdf/apply.mjs"), import("../character-sheet/pdf/match.mjs")]);
  const read = [];
  const { values, morale, unplaced } = sheetValuesFromStatline(sl, { rename: libraryNameFor(matchers, read) });
  // The sheet import grants what the library holds, so a proficiency the
  // cookbook can supply is imported first, through the tiers a monster's list
  // resolves by; what nothing supplies is reported below as unmatched.
  await resolveAbilities([...(sl.proficiencies ?? []), ...(sl.classProficiencies ?? [])]);
  const report = await importSheet({ actor, values, writeDomain: false, record: false });
  // What the sheet import granted is the import's own, stamped so a repair can
  // tell it from an item a Judge gave the character.
  const granted = actor.items.filter((i) => !standing.has(i.id) && !i.flags?.[MODULE_ID]?.minted);
  if (granted.length) await actor.updateEmbeddedDocuments("Item", granted.map((i) => ({ _id: i.id, [`flags.${MODULE_ID}.minted`]: true })));
  const moraleField = actor.system.schema?.getField?.("details.morale");
  const missing = [...report.unmatched, ...unplaced];
  const words = {
    heading: game.i18n.localize(`${LANG_PREFIX}.character.asPrinted`),
    differs: (d) => game.i18n.format(`${LANG_PREFIX}.character.differs`, { printed: d.sheet, inForce: d.inForce }),
  };
  const rows = [
    ...read.map((r) => ({ label: game.i18n.localize(`${LANG_PREFIX}.character.readAs`), text: r.as })),
    ...missing.map((u) => ({ label: game.i18n.localize(`${LANG_PREFIX}.character.missing`), text: u.name })),
    ...report.noted,
  ];
  const biography = entryText(node, id, found.entry.cite) + asPrintedBlock({ id, statline: sl.text, differences: report.checks, rows }, words);
  const keepBiography = isRewriting(id) && keepsJudgeProse(actor, "system.details.biography", actor.system?.details?.biography, biography, found.entry.cite ?? "");
  await actor.update({
    ...(keepBiography ? {} : { "system.details.biography": biography, ...sumsUpdate(biography, "system.details.biography") }),
    ...(Number.isInteger(morale) && moraleField ? { "system.details.morale": Math.clamp(morale, moraleField.min, moraleField.max) } : {}),
    [`flags.${MODULE_ID}.printed`]: { differences: report.checks.length, missing: missing.length },
  });
  // Recorded after the last write, so a repair tells a character played since from one as imported (`playStamp`).
  await actor.update({ [`flags.${MODULE_ID}.playStamp`]: playStamp(actor.toObject()) });
  return actor;
}

/**
 * PARSE every recipe against the connected books and report which ones fail,
 * writing nothing. Each entry is executed independently: one failure never
 * stops the pass. `ok: false` is the recipe's own name-anchor check failing;
 * `misses` names the fields that threw underneath. The pass shares ONE page
 * cache per book across every entry. See docs/importer/DECISIONS.md, "The
 * audit: a recipe answers for itself, without importing".
 *
 * @param {object} [options]
 * @param {string[]} [options.ids] audit only these entry ids
 * @param {string[]} [options.books] audit only entries from these book ids
 * @param {string[]} [options.kinds] audit only these entry kinds
 * @param {boolean} [options.art] decode page artwork too (default false) —
 *   costs seconds per entry where the rest of a recipe costs milliseconds.
 * @returns {Promise<{rows: object[], summary: object}>} every row, and the tally
 */
let lastAuditRows = [];

/** Rows the running (or last finished) audit has produced so far. */
export const lastAudit = () => {
  const tally = (k) => lastAuditRows.filter((r) => r.status === k).length;
  return {
    done: lastAuditRows.length,
    ok: tally("ok"),
    noMatch: tally("no-match"),
    threw: tally("threw"),
    noBook: tally("no-book"),
    okButEmpty: lastAuditRows.filter((r) => r.empty).length,
    failing: lastAuditRows
      .filter((r) => r.status === "no-match" || r.status === "threw" || r.empty)
      .map((r) => ({ id: r.id, name: r.name, book: r.book, page: r.page, status: r.status, empty: r.empty, reason: r.reason })),
    slowest: [...lastAuditRows].sort((a, b) => b.ms - a.ms).slice(0, 10).map((r) => ({ id: r.id, kind: r.kind, ms: r.ms })),
  };
};

export async function cookbookAudit({ ids = null, books = null, kinds = null, art = false } = {}) {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only.`);
  const wanted = ids ? new Set(ids) : null;
  const entries = [];
  for (const source of [data.books, data.content]) {
    for (const cb of source.values()) {
      for (const [id, entry] of Object.entries(cb.entries ?? {})) {
        if (wanted && !wanted.has(id)) continue;
        if (kinds && !kinds.includes(entry.kind)) continue;
        const book = entry.book ?? cb.book?.id ?? (typeof cb.book === "string" ? cb.book : null);
        if (books && !books.includes(book)) continue;
        entries.push({ id, entry, cb, book });
      }
    }
  }
  if (!entries.length) {
    ui.notifications?.warn(`${MODULE_ID} | audit: nothing matched.`);
    return { rows: [], summary: { total: 0 } };
  }

  const pageCache = runPageCache();
  const artCache = runPageCache();
  const rows = [];
  // Published as it goes, not at the end. A whole-corpus pass takes tens of
  // minutes — monster recipes carry art extraction and cost orders more than a
  // proficiency — and a pass that reveals nothing until it returns cannot be
  // watched, cut short, or reported on. `acksExtras.importer.lastAudit()` reads it live.
  lastAuditRows = rows;
  const bar = progressBar(game.i18n.localize(`${LANG_PREFIX}.ui.progressAudit`), entries.length);
  try {
    for (const { id, entry, cb, book } of entries) {
      const session = ctx.sessionDocs.get(book);
      const base = { id, name: entry.name, kind: entry.kind, book, page: entry.pages?.[0] ?? null, cite: entry.cite };
      if (!session) {
        rows.push({ ...base, status: "no-book", ms: 0 });
        bar.step(entry.name ?? id);
        continue;
      }
      const t0 = performance.now();
      let node = null;
      let threw = null;
      try {
        node = await executeEntry(session.doc, cb, data.registers, id, {
          pageCache: pageCache(book),
          artCache: artCache(book),
          ...(art ? {} : { skipOps: ["art"] }),
        });
      } catch (err) {
        threw = String(err?.message ?? err);
      }
      rows.push({
        ...base,
        status: threw ? "threw" : node?.ok ? "ok" : "no-match",
        ms: Math.round(performance.now() - t0),
        reason: threw ?? node?.reason ?? null,
        // Two shapes reach `misses`: a FIELD that threw or matched nothing, and
        // a register TOKEN the lookup tables do not know. The second carries no
        // field and is the more actionable of the two — it names a printed word
        // the register has no row for, which is register data to add rather
        // than page geometry to re-measure.
        misses: (node?.misses ?? []).map((m) =>
          m.table ? `register ${m.table}: unknown token "${m.token}"` : `${m.field}: ${m.error ?? "no result"}`,
        ),
        // A recipe can pass its name anchor and still bring back nothing to
        // say — but only counts as empty if it ASKED for prose. A classMeta
        // passage read for one name, or a table read for its grid, declares no
        // description field and is not a defect for lacking one.
        empty:
          !threw &&
          !!node?.ok &&
          !!entry.fields?.description &&
          !(node.fields?.description?.length > 0),
      });
      bar.step(entry.name ?? id);
    }
  } finally {
    bar.finish();
  }

  const tally = (k) => rows.filter((r) => r.status === k).length;
  const summary = {
    total: rows.length,
    ok: tally("ok"),
    noMatch: tally("no-match"),
    threw: tally("threw"),
    noBook: tally("no-book"),
    okButEmpty: rows.filter((r) => r.empty).length,
    withMisses: rows.filter((r) => r.misses?.length).length,
    totalMs: rows.reduce((n, r) => n + r.ms, 0),
  };
  const failing = rows.filter((r) => r.status === "no-match" || r.status === "threw" || r.empty);
  console.log(`${MODULE_ID} | recipe audit`, summary);
  if (failing.length) console.table(failing.map((r) => ({ id: r.id, name: r.name, book: r.book, page: r.page, status: r.status, empty: r.empty, reason: r.reason })));
  ui.notifications.info(
    `${MODULE_ID} | audit: ${summary.ok}/${summary.total} parsed` +
      `${summary.noMatch ? `, ${summary.noMatch} did not match` : ""}` +
      `${summary.threw ? `, ${summary.threw} threw` : ""}` +
      `${summary.okButEmpty ? `, ${summary.okButEmpty} matched but read nothing` : ""}` +
      `${summary.noBook ? `, ${summary.noBook} unreadable (book not connected)` : ""}. Details in console.`,
  );
  return { rows, summary };
}

/**
 * Build — or REUSE — the shared ability item for a definition id. Deduped by
 * cookbook id, so every monster/NPC referencing a proficiency links to the SAME
 * item instead of minting a per-actor copy. Nothing is imported without the
 * citing book: the entry is passed over (`readForImport`), counted into
 * `passed` where a `passedOver` tally is given.
 */
export async function importAbility(id, folderId, { pageCache = null, passed = null } = {}) {
  const found = cookbookEntry(id);
  if (!found) return null;
  // NOTE an alias gets its OWN item. The books list a name whose rules text is
  // printed under another entry; that makes it a distinct ability sharing a
  // passage, not a synonym to redirect away. Its recipe already carries a
  // pointer to where that text lives, so it extracts and classifies normally —
  // it just does not stack with the entry it points at.
  return claimImport(id, async () => {
    const { data: built, reason } = await abilityData(id, { folderId, pageCache });
    if (!built) return passed?.count(reason) ?? null;
    return createDoc(Item, built);
  });
}

/**
 * Everything an ability import does EXCEPT the write. Split out so a bulk
 * run can build every document first and write them in chunks (`createDocs`),
 * which building and writing as one call cannot do. Resolves to `{data}`,
 * the creation data with its folder resolved, or to `{data: null, reason}` —
 * `no-entry` when the cookbook does not know the id, else `readForImport`'s
 * reason. See docs/importer/DECISIONS.md, "Writes are batched, because a
 * write costs what the shelf already holds".
 */
async function abilityData(id, { folderId = null, pageCache = null } = {}) {
  const found = cookbookEntry(id);
  if (!found) return { data: null, reason: "no-entry" };
  const bookId = bookOf(found);
  const { node, reason } = await readForImport(id, pageCache ? { pageCache: pageCache(bookId) } : {});
  if (!node) return { data: null, reason };
  const folder = folderId ?? (await ensureItemFolder(id))?.id ?? null;
  const ladders = await laddersForEntry(found.entry, { pageCache: pageCache ? pageCache(bookId) : null });
  const doc = bindAbility(found.entry, node, id, ladders ? { ladders } : {});
  const extras = doc.flags[MODULE_ID].extras;
  extras.effects = await resolveCompanions(extras.effects);
  return { data: { ...doc, folder }, reason: null };
}


/* -------------------------------------------- */
/*  Companions                                  */
/* -------------------------------------------- */

/**
 * Fill a companion effect's actor slot. `ref` names the monster entry the
 * ability confers — a pointer the recipe can ship because it is not the book's
 * text. When that book is connected we import the creature and link it; when it
 * is not, the slot stays EMPTY on purpose so a GM can drop an actor in, or so
 * `cookbookFillCompanions()` can fill it once the book loads.
 *
 * Abilities whose creature is BUILT rather than named (a totem animal, a
 * familiar chosen from a list) carry no `ref` at all and keep an empty slot for
 * good — there is no single entry to point at.
 */
async function resolveCompanion(effect) {
  if (effect?.type !== "companion" || effect.actorUuid || !effect.ref) return effect;
  const found = cookbookEntry(effect.ref);
  if (!found) return effect;
  // The library's own creature, never a copy dragged out of it: the slot is a
  // link that outlives the copy, and a copy answering would stop the import.
  const existing = await importedActor(effect.ref, { copies: false });
  if (existing) return { ...effect, actorUuid: existing.uuid };
  const bookId = bookOf(found);
  if (!ctx.sessionDocs.has(bookId)) return effect; // bookless: leave the bucket
  // No fallback folder: importOne resolves the creature's own destination from
  // its freshly extracted type, which is strictly better than anything a caller
  // could name before the page has been read.
  const actor = await importOne(bookId, effect.ref, null).catch((err) => {
    console.error(`${MODULE_ID} | companion ${effect.ref}`, err);
    return null;
  });
  return actor ? { ...effect, actorUuid: actor.uuid } : effect;
}

/** Resolve every companion slot in an effects array, in order (creates actors). */
async function resolveCompanions(effects) {
  if (!effects?.some((e) => e?.type === "companion" && !e.actorUuid && e.ref)) return effects;
  const out = [];
  for (const e of effects) out.push(await resolveCompanion(e));
  return out;
}

/**
 * Fill companion slots left empty because the citing book was not connected.
 * Safe to re-run: a slot already holding an actor is never touched.
 */
export async function cookbookFillCompanions() {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only.`);
  let filled = 0;
  // A slot that resolves IMPORTS the creature from the seat's book, so this is
  // an actor import wearing a different name — same page extraction, same wait.
  const all = await allAbilities();
  const bar = progressBar(game.i18n.localize(`${LANG_PREFIX}.ui.progressCompanions`), all.length);
  try {
    for (const { doc, extras } of all) {
      bar.step(doc.name);
      const effects = await resolveCompanions(extras.effects);
      if (effects === extras.effects) continue;
      await doc.update({ [`flags.${MODULE_ID}.extras.effects`]: effects });
      filled += effects.filter((e, i) => e.actorUuid && !extras.effects[i]?.actorUuid).length;
    }
  } finally {
    bar.finish();
  }
  ui.notifications.info(`${MODULE_ID} | companions: ${filled} slot(s) linked to an actor.`);
  return filled;
}

/* -------------------------------------------- */
/*  Bulk import / update                        */
/* -------------------------------------------- */

/**
 * GM: browse every shipped ability and pick which to import.
 *
 * The counterpart to the monster import dialog. The header says which books
 * are open, because an ability imports from its book alone: one whose book is
 * not open on this seat is passed over, and the closing notice says how many.
 */
export async function cookbookImportAbilitiesDialog() {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates items).`);
  const rows = [];
  for (const [id, e] of abilityEntries()) {
    rows.push({ id, name: e.name, cite: e.cite, book: e.book, category: e.meta?.category ?? "proficiency", alias: !!e.aliasOf, deprecated: !!e.meta?.deprecated });
  }
  if (!rows.length) return ui.notifications.warn(`${MODULE_ID} | no abilities in the shipped cookbook.`);
  rows.sort((a, b) => a.name.localeCompare(b.name));

  // The present marks have to name the shelf the import writes to, or a
  // compendium-mode world shows every ability as missing and the GM ticks a
  // list they already hold.
  const have = new Set((await importedIndex()).keys());
  const openBooks = [...new Set(rows.map((r) => r.book))].filter((b) => ctx.sessionDocs.has(b));
  const cats = [...new Set(rows.map((r) => r.category))].sort();

  const list = rows
    .map((r) => {
      const marks = [
        r.alias ? `<i class="fa-solid fa-link" data-tooltip="${esc(game.i18n.localize(`${LANG_PREFIX}.ui.abilAlias`))}"></i>` : "",
        r.deprecated ? `<i class="fa-solid fa-triangle-exclamation" data-tooltip="${esc(game.i18n.localize(`${LANG_PREFIX}.ui.abilDeprecated`))}"></i>` : "",
        have.has(r.id) ? `<i class="fa-solid fa-check" data-tooltip="${esc(game.i18n.localize(`${LANG_PREFIX}.ui.abilPresent`))}"></i>` : "",
      ].join("");
      return `<label class="acks-extras-importer-browse-row" data-name="${esc(r.name.toLowerCase())}" data-cat="${esc(r.category)}" data-have="${have.has(r.id) ? 1 : 0}">
        <input type="checkbox" name="sel" value="${esc(r.id)}">
        <span>${esc(r.name)}</span><span class="acks-extras-importer-marks">${marks}</span>
        <span class="acks-extras-importer-cite">${esc(r.cite)}</span>
      </label>`;
    })
    .join("");

  const catOptions = cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  const content = `
    <p class="notes">${game.i18n.format(`${LANG_PREFIX}.ui.abilIntro`, {
      n: rows.length,
      books: openBooks.length ? openBooks.map((b) => BOOKS[b].short).join(", ") : game.i18n.localize(`${LANG_PREFIX}.ui.abilNoBook`),
    })}</p>
    <div class="acks-extras-importer-abil-filters">
      <input type="text" name="filter" placeholder="${game.i18n.localize(`${LANG_PREFIX}.ui.cookbookFilter`)}">
      <select name="cat"><option value="">${game.i18n.localize(`${LANG_PREFIX}.ui.abilAllCats`)}</option>${catOptions}</select>
      <label><input type="checkbox" name="hideHave"> ${game.i18n.localize(`${LANG_PREFIX}.ui.abilHidePresent`)}</label>
    </div>
    <div class="acks-extras-importer-abil-actions">
      <button type="button" data-act="all">${game.i18n.localize(`${LANG_PREFIX}.ui.abilSelectShown`)}</button>
      <button type="button" data-act="none">${game.i18n.localize(`${LANG_PREFIX}.ui.abilClear`)}</button>
      <span class="acks-extras-importer-abil-count"></span>
    </div>
    <div class="acks-extras-importer-browse-list acks-extras-importer-abil-list">${list}</div>`;

  return foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.localize(`${LANG_PREFIX}.ui.abilTitle`), resizable: true },
    classes: ["acks-ui", "acks-extras-importer-dialog"],
    position: { width: 620, height: 700 },
    content,
    render: (event, dialog) => {
      const root = dialog.element ?? dialog;
      const listEl = root.querySelector(".acks-extras-importer-abil-list");
      const count = root.querySelector(".acks-extras-importer-abil-count");
      const shown = () => [...listEl.querySelectorAll(".acks-extras-importer-browse-row")].filter((r) => r.style.display !== "none");
      const refresh = () => {
        const q = root.querySelector('[name="filter"]').value.toLowerCase();
        const cat = root.querySelector('[name="cat"]').value;
        const hide = root.querySelector('[name="hideHave"]').checked;
        for (const r of listEl.querySelectorAll(".acks-extras-importer-browse-row")) {
          const ok = r.dataset.name.includes(q) && (!cat || r.dataset.cat === cat) && (!hide || r.dataset.have === "0");
          r.style.display = ok ? "" : "none";
          if (!ok) r.querySelector('input[name="sel"]').checked = false;
        }
        tally();
      };
      const tally = () => {
        const n = listEl.querySelectorAll('input[name="sel"]:checked').length;
        count.textContent = game.i18n.format(`${LANG_PREFIX}.ui.abilCount`, { n, shown: shown().length });
      };
      for (const sel of ['[name="filter"]', '[name="cat"]', '[name="hideHave"]']) {
        root.querySelector(sel).addEventListener("input", refresh);
      }
      listEl.addEventListener("change", tally);
      root.querySelector('[data-act="all"]').addEventListener("click", () => {
        for (const r of shown()) r.querySelector('input[name="sel"]').checked = true;
        tally();
      });
      root.querySelector('[data-act="none"]').addEventListener("click", () => {
        for (const r of listEl.querySelectorAll('input[name="sel"]')) r.checked = false;
        tally();
      });
      tally();
    },
    ok: {
      label: game.i18n.localize(`${LANG_PREFIX}.ui.abilGo`),
      callback: async (event, button) => {
        const picked = [...button.form.querySelectorAll('input[name="sel"]:checked')].map((el) => el.value);
        if (!picked.length) return ui.notifications.warn(`${MODULE_ID} | nothing selected.`);
        const bar = progressBar(game.i18n.localize(`${LANG_PREFIX}.ui.progressAbilities`), picked.length);
        let done = 0;
        const passed = passedOver();
        try {
          await prepareItemShelves();
          const folder = null; // per-id shelf
          for (const id of picked) {
            if (await importAbility(id, folder, { passed }).catch((err) => (console.error(`${MODULE_ID} | import ${id}`, err), null))) done++;
            bar.step(cookbookEntry(id)?.entry?.name ?? id);
          }
        } finally {
          bar.finish();
        }
        ui.notifications.info(
          game.i18n.format(`${LANG_PREFIX}.ui.abilDone`, { done, picked: picked.length, pack: packLabel("Item") }) +
            (passed.closed ? ` ${game.i18n.format(`${LANG_PREFIX}.ui.abilPassed`, { n: passed.closed })}` : ""),
        );
      },
    },
  });
}

/** GM: import every shipped ability as a shared, deduped item. */
export async function cookbookImportAbilities({ only = null } = {}) {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only.`);
  const ids = cookbookAbilityIds().filter((id) => !only || only.has(id));
  if (!ids.length) return ui.notifications.warn(`${MODULE_ID} | no abilities in the shipped cookbook.`);
  const bar = progressBar(game.i18n.localize(`${LANG_PREFIX}.ui.progressAbilities`), ids.length);
  let made = 0;
  let reused = 0;
  const passed = passedOver();
  try {
    await prepareItemShelves();
    const pageCache = runPageCache();
    // BUILD every document first, WRITE them a chunk at a time.
    // See docs/importer/DECISIONS.md, "Writes are batched, because a write costs what the shelf already holds".
    let batch = [];
    const flush = async () => {
      if (!batch.length) return;
      // `createDocs` teaches the dedup index itself: every document it makes
      // goes through `remembered`, which reads the id off the document's own
      // flag, never the batch's position.
      const written = await createDocs(Item, batch.map((b) => b.data));
      made += written.filter(Boolean).length; // positional: nulls are failures, not imports
      batch = [];
    };
    for (const id of ids) {
      bar.step(cookbookEntry(id)?.entry?.name ?? id);
      if (await importedItem(id)) {
        reused++;
        continue;
      }
      const { data, reason } = await abilityData(id, { pageCache }).catch((err) => {
        console.error(`${MODULE_ID} | build ${id}`, err);
        return { data: null, reason: null };
      });
      if (!data) {
        passed.count(reason);
        continue;
      }
      batch.push({ id, data });
      if (batch.length >= WRITE_CHUNK) await flush();
    }
    await flush();
  } finally {
    bar.finish();
  }
  ui.notifications.info(`${MODULE_ID} | abilities: ${made} imported, ${reused} already present${passed.clause}.`);
  return { made, reused, closed: passed.closed, unmatched: passed.unmatched };
}

/** A description reduced to one readable line, so a dialog row fits on screen. */
function proseExcerpt(html, max = 160) {
  const text = String(html ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * The name a kept-by-its-owner ability moves to.
 *
 * The rename is only worth anything if the new name stops folding to the
 * definition: folded names are how Update adopts an unflagged item, so a marker
 * that folds away to nothing would let the next run adopt the item again and
 * take the prose after all. Folding drops case and punctuation, so the marker
 * has to carry letters. A counter is added in the pathological case where a
 * shipped definition prints the marked name — bounded because each attempt is a
 * distinct name and only the finitely many in the index can collide.
 */
function asideName(index, present, name) {
  const marked = (n) => game.i18n.format(`${LANG_PREFIX}.ui.renamedName`, { name: n });
  let out = marked(name);
  for (let n = 2; n <= index.size + 2 && idForName(index, out, present); n++) out = marked(`${name} ${n}`);
  return out;
}

/**
 * Ask what happens to each name-adopted ability whose description Update would
 * replace, and resolve to a row index -> "rename" | "overwrite" map.
 *
 * ONE dialog for the whole run, with apply-to-all on both choices: a world that
 * imported the corpus produces collisions by the hundred, and a per-item prompt
 * a GM cannot answer in bulk gets clicked through, which is the same data loss
 * with more steps. Dismissal returns an empty map — every ambiguous item is
 * then left exactly as it was, because a closed dialog is not consent.
 */
async function askAboutAdoptedProse(rows) {
  const label = {
    rename: game.i18n.localize(`${LANG_PREFIX}.ui.collideRename`),
    overwrite: game.i18n.localize(`${LANG_PREFIX}.ui.collideOverwrite`),
  };
  const list = rows
    .map((r, i) => {
      const excerpt = proseExcerpt(r.prose);
      return `<div class="acks-extras-importer-collide-row">
        <div style="display:flex;gap:.5em;align-items:baseline;">
          <strong>${esc(r.name)}</strong>
          <span class="acks-extras-importer-cite">${esc(r.where)}${r.cite ? ` · ${esc(r.cite)}` : ""}</span>
        </div>
        ${excerpt ? `<div class="acks-extras-importer-cite" style="font-style:italic;">${esc(excerpt)}</div>` : ""}
        <div style="display:flex;gap:1em;flex-wrap:wrap;">
          <label><input type="radio" name="c${i}" value="rename" checked> ${esc(label.rename)} "${esc(r.aside)}"</label>
          <label><input type="radio" name="c${i}" value="overwrite"> ${esc(label.overwrite)}</label>
        </div>
      </div>`;
    })
    .join("");
  const content = `
    <p class="notes">${game.i18n.format(`${LANG_PREFIX}.ui.collideIntro`, { n: rows.length })}</p>
    <div class="acks-extras-importer-abil-actions">
      <button type="button" data-act="rename">${game.i18n.localize(`${LANG_PREFIX}.ui.collideAllRename`)}</button>
      <button type="button" data-act="overwrite">${game.i18n.localize(`${LANG_PREFIX}.ui.collideAllOverwrite`)}</button>
    </div>
    <div class="acks-extras-importer-browse-list acks-extras-importer-collide-list">${list}</div>`;

  const picked = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize(`${LANG_PREFIX}.ui.collideTitle`), resizable: true },
    classes: ["acks-ui", "acks-extras-importer-dialog"],
    position: { width: 640, height: 700 },
    content,
    render: (event, dialog) => {
      const root = dialog.element ?? dialog;
      for (const act of ["rename", "overwrite"]) {
        root.querySelector(`[data-act="${act}"]`).addEventListener("click", () => {
          for (const input of root.querySelectorAll(`.acks-extras-importer-collide-list input[value="${act}"]`)) {
            input.checked = true;
          }
        });
      }
    },
    buttons: [
      {
        action: "apply",
        default: true,
        label: game.i18n.localize(`${LANG_PREFIX}.ui.collideApply`),
        callback: (event, button) => {
          const out = new Map();
          for (let i = 0; i < rows.length; i++) {
            const choice = button.form.querySelector(`input[name="c${i}"]:checked`)?.value;
            if (choice) out.set(i, choice);
          }
          return out;
        },
      },
      { action: "keep", label: game.i18n.localize(`${LANG_PREFIX}.ui.collideKeepAll`), callback: () => new Map() },
    ],
    rejectClose: false,
  });
  return picked instanceof Map ? picked : new Map();
}

/**
 * Put the module's own item for a definition where the original one lives — on
 * the actor holding it, or in the item library. Never a second copy: a holder
 * that already carries this definition needs nothing added.
 */
async function placeGeneratedBeside(holder, id, built) {
  if (!holder) return (await importedItem(id)) ? null : importAbility(id, null);
  if (holder.items.some((i) => i.getFlag(MODULE_ID, "cookbook")?.id === id)) return null;
  const [made] = await holder.createEmbeddedDocuments("Item", [built]);
  return made ?? null;
}

/**
 * GM: refresh every ability already in the world — loose items AND the
 * copies embedded on actors — against the current cookbook.
 *
 * Matched by cookbook id first, then by folded NAME, so abilities made by
 * hand or imported earlier get adopted and repaired rather than duplicated. Only the generated surface is rewritten; the item's name and
 * the system fields a GM may have tuned are left alone.
 *
 * An item this module FLAGGED is rewritten outright. An item matched only by
 * NAME is somebody else's, so its description is never replaced silently:
 * those are collected during the walk and settled by one dialog afterwards.
 * Both outcomes are idempotent — running twice leaves the same world as
 * running once.
 * A page is extracted once per run, however many definitions print on it.
 * See docs/importer/DECISIONS.md, "Importing again refreshes what it did not create"
 * and "A bulk import reads each page once".
 *
 * @param {object} [opts]
 * @param {Set<string>|null} [opts.only] cookbook ids to refresh; every ability when null
 * @param {object|null} [opts.repair] a `repairTally` to count into
 */
export async function cookbookUpdateAbilities({ only = null, repair = null } = {}) {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only.`);
  const index = abilityNameIndex();
  if (!index.size) return ui.notifications.warn(`${MODULE_ID} | no abilities in the shipped cookbook.`);

  // Which definitions the world already holds — the signal that resolves a
  // name collision without guessing.
  const present = new Set((await importedIndex()).keys());
  const nodeCache = new Map();
  // One extraction per page for the whole run: a page prints several
  // definitions, and each is re-executed once. Ladders are resolved apart, with
  // their own reads.
  const pageCache = runPageCache();
  // Resolved once per definition like the node it sits beside: expanding a
  // fromLadders spec re-executes another entry, and a sweep touches many copies.
  const ladderCache = new Map();
  let updated = 0;
  let adopted = 0;
  let onActors = 0;
  let guessed = 0;
  let skipped = 0;
  let renamed = 0;
  let created = 0;
  let overwritten = 0;
  let kept = 0;
  let preserved = 0;
  // Entries passed over because their book is not open on this seat. Counted
  // apart from `preserved`: that one reports a Judge's own writing kept against
  // a rebuild that happened, and these had no rebuild worth writing.
  let unread = 0;
  // Name-adopted items whose description carries someone else's writing. The
  // write is held back until the GM has answered for them.
  const collisions = [];
  // Guessed resolutions by name, reported once each after the walk: a world
  // holds many copies of one ability, one per actor that carries it.
  const guesses = new Map();
  /** Rewrite the generated surface — the descriptor, the cookbook id, the
   * extras. The written extras carry a forced deletion for every optional
   * subkey the rebuild no longer emits (ABILITY_EXTRAS_OPTIONAL), in a copy —
   * `built` stays clean for the create path, which must not carry deletions
   * into fresh documents.
   *
   * `keepProse` holds back the description and nothing else; the mechanics
   * are always rewritten. */
  const writeGenerated = (doc, built, { keepProse = false } = {}) => {
    const extras = { ...built.flags[MODULE_ID].extras };
    for (const key of ABILITY_EXTRAS_OPTIONAL) {
      if (!(key in extras)) extras[key] = unset();
    }
    return doc.update({
      ...(keepProse ? {} : { "system.description": built.system.description }),
      // The description written is the one whose digest the stamp records.
      [`flags.${MODULE_ID}.cookbook`]: keepProse
        ? built.flags[MODULE_ID].cookbook
        : { ...built.flags[MODULE_ID].cookbook, sums: blockSums(built.system.description, "system.description") },
      [`flags.${MODULE_ID}.extras`]: extras,
    });
  };
  // Counted first: this walks every ability in the world, actors included, and
  // re-extracts each definition it has not seen — hundreds of items on a world
  // that imported the whole corpus.
  const all = await allAbilities();
  const bar = progressBar(game.i18n.localize(`${LANG_PREFIX}.ui.progressUpdate`), all.length);
  try {
    for (const { doc, extras, on } of all) {
      bar.step(doc.name);
      const flagged = doc.getFlag(MODULE_ID, "cookbook")?.id;
      const guess = flagged ? null : idForName(index, doc.name, present);
      const id = flagged ?? guess?.id;
      if (only && !only.has(id)) continue;
      if (!id || !cookbookEntry(id)) {
        skipped++;
        continue;
      }
      if (guess?.ambiguous || guess?.ranked) {
        if (guess.ambiguous) guessed++;
        const seen = guesses.get(doc.name) ?? { guess, copies: 0 };
        seen.copies++;
        guesses.set(doc.name, seen);
      }
      const found = cookbookEntry(id);
      // Re-extract once per definition, not once per copy of it.
      if (!nodeCache.has(id)) {
        const session = ctx.sessionDocs.get(bookOf(found));
        let node = null;
        if (session) {
          node = await executeEntry(session.doc, found.cb, data.registers, id, { pageCache: pageCache(bookOf(found)) }).catch(() => null);
          if (!node?.ok) node = null;
        }
        nodeCache.set(id, node);
      }
      const node = nodeCache.get(id);
      // Nothing was read — this entry's book is not open on this seat, or its
      // extraction failed — so nothing can be rebuilt from it. Left exactly
      // as it is: connect the book and run it again.
      // See docs/importer/DECISIONS.md, "Importing again refreshes what it did not create".
      if (!node) {
        unread++;
        continue;
      }
      if (!ladderCache.has(id)) ladderCache.set(id, await laddersForEntry(found.entry));
      const built = bindAbility(found.entry, node, id, {
        // A copy that recorded arriving under an older name keeps saying so.
        ...(extras.conversionStatus ? { conversionStatus: extras.conversionStatus } : {}),
        ...(extras.conversionFrom ? { conversionFrom: extras.conversionFrom } : {}),
        ...(ladderCache.get(id) ? { ladders: ladderCache.get(id) } : {}),
      });
      built.flags[MODULE_ID].extras.effects = await resolveCompanions(built.flags[MODULE_ID].extras.effects);
      // Authorship of the ITEM and authorship of its DESCRIPTION are
      // different questions: a Judge who annotated a description this
      // module created still wrote those words.
      const prose = doc.system?.description;
      // A forced repair writes the description of a document this module made
      // whatever a Judge put in it; a document it did not make (`!flagged`) is
      // still the Judge's own and still waits for an answer.
      // An edit inside the block the import wrote is the Judge's too (`editedInBlocks`).
      const edited = !!flagged && editedInBlocks(doc.flags?.[MODULE_ID]?.cookbook?.sums, "system.description", prose);
      let annotated = (handWrittenProse(prose) || edited) && !(flagged && repair?.force);
      // Under a decision a description this module made is the Judge's edit:
      // written where the decision takes it, else kept and listed.
      if (flagged && annotated && repair && "decision" in repair && prose !== built.system?.description) {
        const edit = heldEdit({ uuid: doc.uuid, name: doc.name, path: "system.description", current: prose, page: built.system?.description, cite: found.entry?.cite ?? "" });
        if (decides(repair.decision, edit.key) === "take") annotated = false;
        else (repair.edits ??= []).push(edit);
      }
      if (flagged && annotated) {
        await writeGenerated(doc, built, { keepProse: true });
        updated++;
        preserved++;
        if (on) onActors++;
        continue;
      }
      if (!flagged && annotated) {
        collisions.push({
          doc,
          on,
          id,
          built,
          prose,
          name: doc.name,
          cite: found.entry?.cite ?? "",
          where: on ? game.i18n.format(`${LANG_PREFIX}.ui.collideOn`, { actor: on.name }) : game.i18n.localize(`${LANG_PREFIX}.ui.collideWorld`),
          aside: asideName(index, present, doc.name),
        });
        continue;
      }
      await writeGenerated(doc, built);
      updated++;
      if (!flagged) adopted++;
      if (on) onActors++;
    }
  } finally {
    bar.finish();
  }

  if (collisions.length) {
    // A forced repair is not an answer to "whose is this": the documents here
    // are the Judge's own by name, and each is left as it is.
    // A merged repair's second pass already had its answer from the first.
    const choices = repair?.force || repair?.answered ? new Map() : await askAboutAdoptedProse(collisions);
    kept = collisions.length - choices.size;
    if (repair?.force) repair.handMade += kept;
    const bar2 = progressBar(game.i18n.localize(`${LANG_PREFIX}.ui.progressResolve`), choices.size);
    try {
      for (const [i, choice] of choices) {
        const row = collisions[i];
        bar2.step(row.name);
        if (choice === "overwrite") {
          await writeGenerated(row.doc, row.built);
          updated++;
          adopted++;
          if (row.on) onActors++;
          overwritten++;
          continue;
        }
        // The original moves aside with its prose and its own flags untouched;
        // the reference is created beside it, flagged, so later runs maintain
        // that one and leave this one alone forever.
        await row.doc.update({ name: row.aside });
        renamed++;
        if (await placeGeneratedBeside(row.on, row.id, row.built)) created++;
      }
    } finally {
      bar2.finish();
    }
  }

  for (const [name, { guess, copies }] of guesses) {
    const line = `${MODULE_ID} | "${name}" (${copies} cop${copies === 1 ? "y" : "ies"})`;
    if (guess.ambiguous) console.warn(`${line} matches several definitions; resolved to ${guess.id}.`);
    else console.debug(`${line} names definitions in several categories; ranked to ${guess.id}.`);
  }
  if (repair) {
    repair.replaced += updated;
    repair.keptProse += preserved;
    repair.refused += unread;
  }
  const stale = (await danglingAbilities()).length;
  ui.notifications.info(
    `${MODULE_ID} | abilities updated: ${updated} (${onActors} on actors, ${adopted} matched by name` +
      `${guessed ? `, ${guessed} of them ambiguous — see console` : ""}), ${skipped} not in the cookbook` +
      `${renamed ? `; ${renamed} of your own renamed aside, ${created} reference(s) created beside them` : ""}` +
      `${overwritten ? `; ${overwritten} replaced on request` : ""}` +
      `${preserved ? `; ${preserved} kept the description you wrote` : ""}` +
      `${unread ? `; ${unread} left untouched — their book is not open on this seat` : ""}` +
      `${kept ? `; ${kept} left untouched` : ""}` +
      `${stale ? `; ${stale} left over from a withdrawn definition — run Prune` : ""}.`,
  );
  return { updated, adopted, onActors, guessed, skipped, renamed, created, overwritten, kept, preserved, unread, stale };
}

/**
 * Ability items this module generated whose definition no longer exists. A
 * withdrawn definition's items stay behind in every world that imported
 * them, pointing at nothing. They are unambiguously ours (minted, with a
 * cookbook id that no longer resolves), which is what makes them safe to
 * offer for removal.
 */
export async function danglingAbilities() {
  const out = [];
  for (const item of await importedDocs("Item")) {
    if (item.type !== ITEM_TYPE.ABILITY) continue;
    const flags = item.getFlag(MODULE_ID, "cookbook");
    if (!flags?.id || !item.getFlag(MODULE_ID, "minted")) continue;
    if (!cookbookEntry(flags.id)) out.push(item);
  }
  return out;
}

/**
 * GM: remove those items, after showing exactly what will go. Never silent —
 * deleting documents out of someone's world is not a thing to do quietly, even
 * when they are certainly stale.
 */
export async function cookbookPruneAbilities() {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only.`);
  const stale = await danglingAbilities();
  if (!stale.length) return ui.notifications.info(game.i18n.localize(`${LANG_PREFIX}.ui.pruneNone`));
  const rows = stale
    .map((i) => `<li>${esc(i.name)} <code>${esc(i.getFlag(MODULE_ID, "cookbook").id)}</code></li>`)
    .join("");
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize(`${LANG_PREFIX}.ui.pruneTitle`) },
    classes: ["acks-ui", "acks-extras-importer-dialog"],
    content: `<p>${game.i18n.format(`${LANG_PREFIX}.ui.prunePrompt`, { n: stale.length })}</p>
      <ul class="acks-extras-importer-browse-list">${rows}</ul>`,
  });
  if (!ok) return null;
  await deleteImported("Item", stale);
  ui.notifications.info(game.i18n.format(`${LANG_PREFIX}.ui.pruneDone`, { n: stale.length }));
  return stale.length;
}

/**
 * GM-only Import All / Update All buttons at the top of the Item directory.
 *
 * Both are idempotent, which is what makes them safe to hand a GM: importing
 * twice reuses the existing items rather than duplicating them, and updating
 * only rewrites the generated surface. Buttons disable while running — these
 * touch every ability in the world and a double-click would interleave.
 */
export function registerAbilityDirectoryButtons() {
  Hooks.on("renderItemDirectory", (app, element) => {
    if (!game.user.isGM) return;
    const root = elementOf(element);
    if (!root || root.querySelector(".acks-extras-importer-ability-tools")) return;

    const bar = document.createElement("div");
    bar.className = "acks-extras-importer-ability-tools";
    const button = (labelKey, tipKey, icon, run) => {
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML = `<i class="${icon}"></i> ${game.i18n.localize(`${LANG_PREFIX}.ui.${labelKey}`)}`;
      b.dataset.tooltip = game.i18n.localize(`${LANG_PREFIX}.ui.${tipKey}`);
      b.addEventListener("click", async () => {
        for (const x of bar.querySelectorAll("button")) x.disabled = true;
        try {
          await run();
        } catch (err) {
          console.error(`${MODULE_ID} | ability tools`, err);
          ui.notifications.error(`${MODULE_ID} | ${err.message}`);
        } finally {
          for (const x of bar.querySelectorAll("button")) x.disabled = false;
        }
      });
      return b;
    };
    bar.append(
      button("browseAbilities", "browseAbilitiesTip", "fa-solid fa-list-check", cookbookImportAbilitiesDialog),
      button("importAllAbilities", "importAllAbilitiesTip", "fa-solid fa-download", cookbookImportAbilities),
      button("updateAllAbilities", "updateAllAbilitiesTip", "fa-solid fa-rotate", cookbookUpdateAbilities),
      button("pruneAbilities", "pruneAbilitiesTip", "fa-solid fa-broom", cookbookPruneAbilities),
    );
    (root.querySelector(".directory-header") ?? root).prepend(bar);
  });
  // The sidebar renders before this module's `ready` runs, so the hook above
  // misses that first pass — re-render once to catch it.
  if (ui.items?.rendered) ui.items.render();
}


/* -------------------------------------------- */
/*  Debug window: raw executor output           */
/* -------------------------------------------- */

/**
 * GM inspection popout: execute one cookbook entry against the connected book
 * and show the RAW extract JSON next to nothing — exactly what the binder
 * receives. Ephemeral (session memory only), so binder errors can be traced to
 * either the extraction (wrong here) or the binding (right here, wrong on the
 * actor).
 */
export async function cookbookDebug(entryId) {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only.`);

  if (!entryId) {
    const openBooks = [...data.books.keys()].filter((b) => ctx.sessionDocs.has(b));
    if (!openBooks.length) return ui.notifications.warn(`${MODULE_ID} | connect a cookbook book first (PoC 2 / unlock).`);
    // Every connected book, grouped — debugging one book while three are open
    // should not mean reconnecting.
    const rows = openBooks
      .map((bookId) => {
        const opts = Object.entries(data.books.get(bookId).entries)
          .sort((a, b) => a[1].pages[0] - b[1].pages[0])
          .map(([id, e]) => `<option value="${esc(id)}">${esc(e.name)}${e.cite ? ` — ${esc(e.cite)}` : ""}</option>`)
          .join("");
        return `<optgroup label="${esc(BOOKS[bookId]?.label ?? bookId)}">${opts}</optgroup>`;
      })
      .join("");
    return foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize(`${LANG_PREFIX}.ui.debugTitle`) },
      classes: ["acks-ui", "acks-extras-importer-dialog"],
      content: `<div class="form-group"><label>${game.i18n.localize(`${LANG_PREFIX}.ui.debugPick`)}</label>
        <select name="entry">${rows}</select></div>`,
      ok: {
        label: game.i18n.localize(`${LANG_PREFIX}.ui.debugGo`),
        callback: (event, button) => cookbookDebug(button.form.elements.entry.value),
      },
    });
  }

  const found = cookbookEntry(entryId);
  if (!found) return ui.notifications.warn(`${MODULE_ID} | unknown cookbook id "${entryId}".`);
  // A content-type cookbook spans books and names one per ENTRY, so the file
  // carries no `book` at all — reading `cb.book.id` throws for every definition
  // id. `bookOf` is the one resolution that answers for both shapes.
  const bookId = bookOf(found);
  const session = bookId ? ctx.sessionDocs.get(bookId) : null;
  if (!session) {
    return ui.notifications.warn(`${MODULE_ID} | ${bookLabel(bookId) ?? entryId} is not open this session.`);
  }

  const node = await executeEntry(session.doc, found.cb, data.registers, entryId);
  // A FAMILY id resolves to a synthesized entry that lives in `cb.families`,
  // never in `cb.entries` — so there is nothing to execute and the node comes
  // back as a bare refusal with no `misses` to render.
  if (node.reason) return ui.notifications.warn(`${MODULE_ID} | ${entryId} is not executable (${node.reason}).`);
  const f = node.fields;
  const pre = (v) => `<pre class="acks-extras-importer-debug-pre">${esc(JSON.stringify(v, null, 1) ?? "null")}</pre>`;
  const statRows = Object.entries(f.stats ?? {})
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td><code>${esc(JSON.stringify(v))}</code></td></tr>`)
    .join("");
  const paras = (f.description ?? [])
    .map((p, i) => `<p class="acks-extras-importer-debug-para"><b>[${i}]</b> ${esc(p.text)}</p>`)
    .join("");
  // Built from the parts that are actually present: an entry whose recipe
  // carries no citation would otherwise render its separators around nothing.
  const head = [
    bookLabel(bookId),
    node.cite || null,
    Array.isArray(found.entry.pages) ? `pages ${JSON.stringify(found.entry.pages)}` : null,
    `ok=${node.ok}`,
  ]
    .filter(Boolean)
    .map((part) => esc(String(part)))
    .join(" · ");
  const content = `<div class="acks-extras-importer-debug">
    <p><b>${esc(node.name ?? entryId)}</b> — ${head}</p>
    <details open><summary>expect</summary>${pre(f.name)}</details>
    <details open><summary>stats (${Object.keys(f.stats ?? {}).length})</summary>
      <table class="acks-extras-importer-debug-table">${statRows}</table></details>
    <details open><summary>attacks</summary>${pre(f.attacks ?? null)}</details>
    <details open><summary>spoils</summary>${pre(f.spoils ?? null)}</details>
    <details><summary>art</summary>${pre(f.art ?? null)}</details>
    <details><summary>description (${(f.description ?? []).length} paras — this seat's book, session only)</summary>${paras}</details>
    <details><summary>misses (${node.misses.length})</summary>${pre(node.misses)}</details>
  </div>`;
  return foundry.applications.api.DialogV2.prompt({
    window: { title: `${game.i18n.localize(`${LANG_PREFIX}.ui.debugTitle`)} — ${node.name}`, resizable: true },
    classes: ["acks-ui", "acks-extras-importer-dialog"],
    position: { width: 640, height: 720 },
    content,
    ok: { label: game.i18n.localize(`${LANG_PREFIX}.ui.close`) },
  });
}

/**
 * GM/dev: import an explicit id list (QA + scripted tests — the same bounded
 * pool the dialog and import-all use, folders included).
 *
 * Builds only the actor kinds `importOne` dispatches (the `actorKindOf` set).
 * Any other kind returns null and goes uncounted, so a list this declines
 * returns the same `0` as a run over a world that already holds every id.
 */
export async function cookbookImportIds(ids) {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates actors).`);
  // The SAME bounded pool the dialog and import-all use means the same
  // already-present filter too. A monster import always creates — importOne has
  // no reuse to fall back on — so an unfiltered id list leaves two actors
  // claiming one cookbook id, and a companion slot then picks between them
  // arbitrarily.
  const present = await importedIdSet();
  return importMany((ids ?? []).filter((id) => !present.has(id)), game.i18n.localize(`${LANG_PREFIX}.ui.cookbookWorking`));
}

export async function cookbookImport() {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates actors).`);
  const openBooks = [...data.books.keys()].filter((b) => ctx.sessionDocs.has(b));
  if (!openBooks.length) {
    return ui.notifications.warn(
      `${MODULE_ID} | no cookbook book is open this session — connect one first (PoC 2 / unlock dialog).`,
    );
  }
  const have = await importedIdSet();
  const { rows: entryRows } = actorEntriesAcrossBooks();
  // One list across every connected book, with a heading per book so a long
  // list still says where each block came from. The filter matches the book
  // label too, so typing "nethercity" narrows to that book.
  let lastBook = null;
  let lastGroup = null;
  const rows = entryRows
    .map(({ id, entry: e, bookId }) => {
      let head = "";
      if (bookId !== lastBook) {
        lastBook = bookId;
        lastGroup = null;
        head += `<div class="acks-extras-importer-book-head">${esc(BOOKS[bookId]?.label ?? bookId)}</div>`;
      }
      const group = e.meta?.group ?? null;
      if (group && group !== lastGroup) {
        lastGroup = group;
        head += `<div class="acks-extras-importer-group-head">${esc(group)}</div>`;
      }
      const searchable = `${e.name} ${BOOKS[bookId]?.label ?? bookId} ${group ?? ""}`.toLowerCase();
      return `${head}<label class="acks-extras-importer-browse-row" data-name="${esc(searchable)}" data-have="${have.has(id) ? 1 : 0}">
        <input type="checkbox" name="sel" value="${esc(id)}">
        <span>${esc(e.name)}</span>
        <span class="acks-extras-importer-marks">${
          have.has(id)
            ? `<i class="fa-solid fa-check" data-tooltip="${esc(game.i18n.localize(`${LANG_PREFIX}.ui.cookbookPresent`))}"></i>`
            : ""
        }</span>
        <span class="acks-extras-importer-cite">${esc(e.cite)}</span>
      </label>`;
    })
    .join("");
  const content = `
    <p class="notes">${game.i18n.format(`${LANG_PREFIX}.ui.cookbookIntro`, {
      n: entryRows.length,
      book: openBooks.map((b) => BOOKS[b]?.short ?? b).join(", "),
    })}</p>
    <div class="acks-extras-importer-abil-filters">
      <input type="text" name="filter" placeholder="${game.i18n.localize(`${LANG_PREFIX}.ui.cookbookFilter`)}">
      <label><input type="checkbox" name="hideHave"> ${game.i18n.localize(`${LANG_PREFIX}.ui.abilHidePresent`)}</label>
    </div>
    <div class="acks-extras-importer-abil-actions">
      <button type="button" data-act="all">${game.i18n.localize(`${LANG_PREFIX}.ui.cookbookSelectAll`)}</button>
      <button type="button" data-act="shown">${game.i18n.localize(`${LANG_PREFIX}.ui.abilSelectShown`)}</button>
      <button type="button" data-act="none">${game.i18n.localize(`${LANG_PREFIX}.ui.abilClear`)}</button>
      <span class="acks-extras-importer-abil-count"></span>
    </div>
    <div class="acks-extras-importer-browse-list acks-extras-importer-mon-list">${rows}</div>`;

  return foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.localize(`${LANG_PREFIX}.ui.cookbookTitle`), resizable: true },
    classes: ["acks-ui", "acks-extras-importer-dialog"],
    position: { width: 560, height: 700 },
    content,
    render: (event, dialog) => {
      const root = dialog.element ?? dialog;
      const listEl = root.querySelector(".acks-extras-importer-mon-list");
      const count = root.querySelector(".acks-extras-importer-abil-count");
      const all = () => [...listEl.querySelectorAll(".acks-extras-importer-browse-row")];
      const shown = () => all().filter((r) => r.style.display !== "none");
      const tally = () => {
        const n = listEl.querySelectorAll('input[name="sel"]:checked').length;
        count.textContent = game.i18n.format(`${LANG_PREFIX}.ui.abilCount`, { n, shown: shown().length });
      };
      const refresh = () => {
        const q = root.querySelector('[name="filter"]').value.toLowerCase();
        const hide = root.querySelector('[name="hideHave"]').checked;
        for (const r of all()) {
          const ok = r.dataset.name.includes(q) && (!hide || r.dataset.have === "0");
          r.style.display = ok ? "" : "none";
          // A hidden row must not stay selected: what the list shows is the only
          // honest account of what pressing Import will do.
          if (!ok) r.querySelector('input[name="sel"]').checked = false;
        }
        tally();
      };
      const check = (rows_) => {
        for (const r of rows_) r.querySelector('input[name="sel"]').checked = true;
        tally();
      };
      for (const sel of ['[name="filter"]', '[name="hideHave"]']) {
        root.querySelector(sel).addEventListener("input", refresh);
      }
      listEl.addEventListener("change", tally);
      // "All" ignores the filter on purpose — it is the whole-book button, and
      // clearing the filter first would silently change what the user is looking
      // at. "Shown" is the filtered counterpart.
      root.querySelector('[data-act="all"]').addEventListener("click", () => {
        root.querySelector('[name="filter"]').value = "";
        root.querySelector('[name="hideHave"]').checked = false;
        refresh();
        check(all());
      });
      root.querySelector('[data-act="shown"]').addEventListener("click", () => check(shown()));
      root.querySelector('[data-act="none"]').addEventListener("click", () => {
        for (const el of listEl.querySelectorAll('input[name="sel"]')) el.checked = false;
        tally();
      });
      tally();
    },
    ok: {
      label: game.i18n.localize(`${LANG_PREFIX}.ui.cookbookGo`),
      callback: async (event, button) => {
        const picked = [...button.form.querySelectorAll('input[name="sel"]:checked')].map((el) => el.value);
        if (!picked.length) return ui.notifications.warn(`${MODULE_ID} | nothing selected.`);
        // Re-read rather than trusting the marks drawn when the dialog opened —
        // an import may have happened in another window since.
        const present = await importedIdSet();
        const todo = picked.filter((id) => !present.has(id));
        const done = await importMany(todo, game.i18n.localize(`${LANG_PREFIX}.ui.cookbookWorking`));
        reportImport(done, picked.length, picked.length - todo.length, todo);
      },
    },
  });
}

/**
 * GM: import every monster the open book's cookbook ships.
 *
 * The counterpart to importing every ability. Skips what the world already has,
 * so it is a top-up after connecting more of the book, not a duplicator.
 */
export async function cookbookImportMonsters() {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates actors).`);
  const openBooks = [...data.books.keys()].filter((b) => ctx.sessionDocs.has(b));
  if (!openBooks.length) {
    return ui.notifications.warn(
      `${MODULE_ID} | no cookbook book is open this session — connect one first (PoC 2 / unlock dialog).`,
    );
  }
  // Family MEMBERS don't import individually here — their family's generator
  // template covers them (baseline + select the special case). The dialog
  // still offers members one at a time.
  const members = familyMemberIds();
  const ids = actorEntriesAcrossBooks().rows.map((r) => r.id).filter((id) => !members.has(id));
  const present = await importedIdSet();
  const todo = ids.filter((id) => !present.has(id));
  if (!todo.length) {
    return ui.notifications.info(game.i18n.format(`${LANG_PREFIX}.ui.cookbookAllPresent`, { n: ids.length }));
  }
  // Reading a whole book takes minutes and makes hundreds of actors, so say what
  // is about to happen while it can still be called off.
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize(`${LANG_PREFIX}.ui.cookbookTitle`) },
    classes: ["acks-ui", "acks-extras-importer-dialog"],
    content: `<p>${game.i18n.format(`${LANG_PREFIX}.ui.cookbookAllConfirm`, {
      n: todo.length,
      book: openBooks.map((b) => BOOKS[b]?.label ?? b).join(", "),
      pack: packLabelsFor("Actor", todo) || packLabel("Actor"),
    })}${
      todo.length < ids.length
        ? ` ${game.i18n.format(`${LANG_PREFIX}.ui.cookbookAllConfirmSkip`, { skipped: ids.length - todo.length })}`
        : ""
    }</p>`,
  });
  if (!ok) return null;
  const done = await importMany(todo, game.i18n.localize(`${LANG_PREFIX}.ui.cookbookWorking`));
  reportImport(done, ids.length, ids.length - todo.length, todo);
  return { done, skipped: ids.length - todo.length };
}

/**
 * `ability-provider` (the lib service contract, v1): resolve proficiency name
 * tokens into embeddable ability ItemData. Tier 1 reuses the world's own
 * imported items (the same name index the monster import uses, including its
 * proficiency-vs-class-power disambiguation); tier 2 imports the definition
 * from the cookbook, where its book is open on this seat; an unresolvable
 * token, a definition whose book is closed included, is reported, never fatal. A
 * "(specialty)" suffix survives onto the embedded copy's name only.
 */
export async function resolveAbilities(tokens) {
  const items = [];
  const missing = [];
  const nameIndex = abilityNameIndex();
  const loadedById = await importedIndex();
  const present = new Set(loadedById.keys());
  for (const raw of tokens ?? []) {
    const printed = String(raw).trim();
    if (!printed) continue;
    const token = rebracket(printed, (name) => nameIndex.has(slug(name)));
    const m = token.match(/^(.*?)\s*\(([^)]+)\)\s*\d*$/);
    const base = (m ? m[1] : token.replace(/\s*\d+$/, "")).trim();
    const specialty = m?.[2] ?? null;
    // A short form the books print for a name this module already ships is
    // authored on the entry as an alias and reaches the index through it, so
    // nothing here needs to know which words a printing merged.
    const guess = idForName(nameIndex, base, present);
    reportGuess(base, guess);
    const id = guess?.id ?? null;
    let item = id ? loadedById.get(id) : null;
    if (!item && id) item = await importAbility(id).catch(() => null);
    if (!item) {
      missing.push(printed);
      continue;
    }
    const data = item.toObject();
    delete data._id;
    if (specialty) data.name = `${data.name} (${specialty})`;
    items.push(data);
  }
  return { items, missing };
}

/**
 * A statline token whose specialty lost its opening bracket in the book's own
 * text layer ("Name spec) 2"), read as the token it stands for ("Name (spec)
 * 2"). The name is the longest run of leading words `known` accepts; a token
 * with both brackets or none, or whose words name nothing, comes back as it
 * was. No extraction can supply the bracket — the printing does not hold it.
 * @param {string} token
 * @param {(name: string) => boolean} known  whether a name is a defined ability
 * @returns {string}
 */
export function rebracket(token, known) {
  if (!token.includes(")") || token.includes("(")) return token;
  const m = /^(.*?)\s*\)\s*(\d*)\s*$/.exec(token);
  if (!m) return token;
  const words = m[1].split(/\s+/).filter(Boolean);
  for (let k = words.length - 1; k >= 1; k--) {
    const name = words.slice(0, k).join(" ");
    if (known(name)) return `${name} (${words.slice(k).join(" ")})${m[2] ? ` ${m[2]}` : ""}`;
  }
  return token;
}
