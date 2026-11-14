/**
 * Cookbook runtime: the import-kind tables, repair in place, reimport one shelf, the adventure book steps.
 * The facade ../cookbook.mjs re-exports what the rest of the module imports by name.
 */
import { MODULE_ID, LANG_PREFIX } from "../constants.mjs";
import { BUILDER_DOC_ID } from "../../classes/builder-logic.mjs";
import { LANGUAGES_DOC_ID } from "../language-binding.mjs";
import { answersFor, placePairs } from "../place-pair.mjs";
import { repairCounts, mergedTally, countRepair, unrepaired } from "../refresh.mjs";
import { playStamp, pregenAnswer } from "../held-edits.mjs";
import { mergedRepair, mergedStep, secondPass } from "../merged-repair.mjs";
import { chooseHeldEditsDialog } from "../apps/held-edits-dialog.mjs";
import {
  isPoiEntry, poiGroupOf, districtPlaceId, isRegionSite, isRegionOverview, regionPlaceId, keySpacesOf, isKeyedPlace,
  adventurePlaceId,
} from "../poi-binding.mjs";
import { isOrganisationRow, isStrengthGridRow } from "../faction-binding.mjs";
import { reimportEverything } from "../everything.mjs";
import { isSceneRecipe, isWorldCopy, isZoneRow, isLinkRow } from "../scene-binding.mjs";
import { BOOKS, bookIsJudges } from "../books.mjs";
import { TABLE_RECIPES } from "../table-recipes.mjs";
import { ownerOfClaim, rebuildVerdict } from "../rebuild-guard.mjs";
import { ancestorsOf, claimerPasses, groupBookOf, runSetFor as deriveRunSet } from "../import-kinds.mjs";
import { GM_STEPS } from "../getting-started.mjs";
import { getLayer, PRIORITY } from "../../lib/tables.mjs";
import { WEAPON_TABLE } from "../weapon-tables.mjs";
import { ARMOR_TABLE } from "../armor-tables.mjs";
import * as services from "../../lib/services.mjs";
import { ADVENTURE_TYPE, bookAdventureCookbookId, adventureDropRows } from "../adventure-binding.mjs";
import { escape as esc } from "../../lib/util.mjs";
import {
  FOLDER_NAME, lineOf, bookOfCookbookId, data, ctx, cookbookEntry, bookOf, bookLabel, api, claimedId, readableHere,
  offeredHere, claimsEntry, playersCharacter, ACTOR_KINDS, actorKindOf, characterEntry, isAbilityEntry, classEntries,
  vehicleEntries, merchandiseEntries, variationEntries, trapEntries, spellEntries, abilityEntries, cookbookEquipmentIds,
} from "./state.mjs";
import {
  folderCache, packCache, packLabel, withRewrite, decisionOf, forgetImportedIndex, importedDocs, holdingLibrary,
  deleteImported, importedActor, importedIdSet, actorEntriesAcrossBooks, familyMemberIds, ITEM_SHELF, shelfKeyOf,
} from "./target.mjs";
import { refillMonster } from "./monster.mjs";
import { importClasses, cookbookUpdateClasses } from "./classes.mjs";
import { importVehicles, importAllEquipment } from "./equipment.mjs";
import { importMerchandise, importVariations, importTraps, importSpells } from "./variations.mjs";
import { journalBound, regionSiteClaim } from "./adventure-places.mjs";
import { cookbookImportAdventureItems, bookCensus, bookDocuments } from "./adventure-maps.mjs";
import { importMany, importOne } from "./actor-import.mjs";
import { cookbookImportAbilities, cookbookUpdateAbilities } from "./abilities-import.mjs";

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
export const packLabelsFor = (type, ids) =>
  [...new Set(ids.map((id) => packLabel(type, lineOf(bookOfCookbookId(id)))))].sort().join('", "');

/** Report an import run, naming what was skipped as already present. */
export function reportImport(done, picked, skipped, ids = []) {
  ui.notifications.info(
    game.i18n.format(`${LANG_PREFIX}.ui.cookbookDone`, {
      done,
      picked,
      pack: packLabelsFor("Actor", ids) || packLabel("Actor"),
    }) + (skipped ? ` ${game.i18n.format(`${LANG_PREFIX}.ui.cookbookSkipped`, { skipped })}` : ""),
  );
}
