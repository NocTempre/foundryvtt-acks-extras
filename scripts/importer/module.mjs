/**
 * The importer — bring-your-own-book content streamer (PoC).
 *
 * POSSESSION MODEL: what persists across sessions is the LOCATION of each
 * seat's book (in IndexedDB, per seat) — never the book. Nothing is ever read
 * without the file: a session that cannot open the PDF imports nothing.
 *
 * What an import produces DOES persist, and all of it: stats, attacks, spoils
 * and the entry's own text, written into world documents by the GM who owns the
 * book, and held there like hand-entered data. Reading an imported document
 * needs no book on any seat, the importing GM's included.
 *
 * A location is a file handle, a fetchable path, or — where the browser allows
 * neither — the remembered NAME of the file, which the join-time reconnect
 * dialog offers back with a picker beside it. Same enforcement throughout;
 * only the number of clicks changes.
 *
 * A book the SERVER holds is the exception, and the reason the shelf exists: a
 * PDF staged under the Foundry data directory is a JOURNAL in the world — one
 * JournalEntry per book, its PDF page pointing at the staged file — rather
 * than a record per seat, so every GM seat reads it on join with no gesture
 * and no picker, and the Judge can open the book from the sidebar. The
 * per-seat kinds remain — they are how a book is read the first time, and how
 * its bytes reach the shelf.
 *
 * api (acksExtras.importer / game.modules.get("acks-extras").api.importer):
 *   bookStatus()     the Books window: every book's state, and its control
 *   connectBook()    the same window (kept: already-imported macros call it)
 *   reconnectBooks() retry the silent reopen, then the same window
 *   browseAndLoad()  GM: pick a page, choose headings, load actors/items
 *   applyStats()     fill monster actors from the connected book
 *   forgetBooks()    drop this computer's remembered locations (not the shelf)
 */
import { MODULE_ID, LANG_PREFIX, ACTOR_TYPE, DEFAULT_IMG } from "./constants.mjs";
import { bookText } from "./prose.mjs";
import { BOOKS, fingerprintWarning, identifyBook } from "./books.mjs";
import { matchFilesToBooks } from "./book-match.mjs";
import { RECIPES } from "./recipes.mjs";
import { openBook, pageItems, extractRecipe, extractDisplay, extractRunin, extractSpoils, extractPageArt, extractPageArtRegion, listHeadings, setWorker, setWasmUrl } from "./extract.mjs";
import { extractStatPairs } from "./stats.mjs";
import { mapPairs } from "./stats-map.mjs";
import { createDocFor } from "./poc.mjs";
import { importTables, tableRecipeCount } from "./tables-binding.mjs";
import { applyBuilderImport } from "./builder-binding.mjs";
import { applyTravelImport, TRAVEL_DOC_ID } from "./travel-binding.mjs";
import { applyWeatherImport, WEATHER_DOC_ID } from "./weather-binding.mjs";
import { applyEncountersImport, ENCOUNTERS_DOC_ID } from "./encounters-binding.mjs";
import { applyVoyagesImport, VOYAGES_DOC_ID } from "./voyages-binding.mjs";
import { applyLanguageImport, LANGUAGES_DOC_ID } from "./language-binding.mjs";
import { applySurvivalImport, SURVIVAL_DOC_ID } from "./survival-binding.mjs";
import { applyForagingImport, FORAGING_DOC_ID } from "./foraging-binding.mjs";
import { applySearchingImport, SEARCHING_DOC_ID } from "./searching-binding.mjs";
import { applyCityTravelImport, CITY_TRAVEL_DOC_ID } from "./city-travel-binding.mjs";
import { applyFlightImport, FLIGHT_DOC_ID } from "./flight-binding.mjs";
import { progressBar } from "./progress.mjs";

/**
 * The land-travel documents, each with the assembler that turns its raw page
 * reads into the engine tables acks-extras declares.
 *
 * A table rather than five near-identical blocks: they differ only in which
 * document they answer for, and one loop cannot drift the way five copies of
 * a try/catch do.
 */
const LAND_BINDINGS = Object.freeze([
  { id: SURVIVAL_DOC_ID, apply: applySurvivalImport },
  { id: FORAGING_DOC_ID, apply: applyForagingImport },
  { id: SEARCHING_DOC_ID, apply: applySearchingImport },
  { id: CITY_TRAVEL_DOC_ID, apply: applyCityTravelImport },
  { id: FLIGHT_DOC_ID, apply: applyFlightImport },
]);
import {
  initCookbook, loadCookbook, cookbookImport, cookbookImportIds, cookbookImportMonsters, cookbookRemoveImports, cookbookImportAbilities, cookbookImportAbilitiesDialog, cookbookUpdateAbilities,
  cookbookFillCompanions, cookbookPruneAbilities, registerAbilityDirectoryButtons, importAbility, cookbookDebug,
  cookbookCount, refillMonster, resolveAbilities,
  importEquipment, importAllEquipment, cookbookEquipmentIds, repairEquipmentAbilities,
  importWeapons, importArmor,
  importClasses, cookbookUpdateClasses, importTemplatePackages, importTraps, importVariations, importVehicles,
  cookbookImportJournals, cookbookImportRollTables, cookbookAudit, lastAudit, cookbookReimportShelf, reimportableShelves,
} from "./cookbook.mjs";
import { registerGettingStartedSettings, runImportEverything, gettingStartedDismissed, SETTING_DISMISSED } from "./getting-started.mjs";
import { registerOseSourceSetting } from "./ose-source.mjs";
import { registerOseSourceDialog, oseBrowseDialog, oseCalibrateDialog, oseConvertAll } from "./ose-app.mjs";
import { oseManualDialog } from "./ose-manual.mjs";
import { importOseBook, importOseAreas, importAuthoredOse, authoredOseBooks } from "./ose-book.mjs";
import { acksExtras } from "../namespace.mjs";
import * as services from "../lib/services.mjs";
import { isPrimaryGM } from "../lib/util.mjs";
import { getDoc } from "../lib/tables.mjs";
import { LEGACY_ID, LEGACY_LOCAL_KEYS, LEGACY_SHELF_DIR, LEGACY_ART_DIR, legacyImporterActive } from "./legacy.mjs";
import { migrateLegacyScope } from "./migrate.mjs";

const SETTING_DYNAMIC = "dynamicRecipes";
const SETTING_REFRESH_CACHE = "refreshCacheSeconds";

/** Open PDFs this session: bookId -> { doc, title }. Memory only. */
const sessionDocs = new Map();

/* -------------------------------------------- */
/*  Remembered book locations (IndexedDB)       */
/* -------------------------------------------- */

/**
 * Where each book lives ON THIS SEAT, so the next session can offer to reopen
 * it. The LOCATION persists; the book's text still never does.
 *
 * Three kinds, because the three ways a seat can reach its own PDF have three
 * different reconnect stories:
 *
 *   handle  a FileSystemFileHandle (Chromium on a secure origin). Reopens
 *           itself after the one permission click browsers insist on per page
 *           load — the original, and still the best case.
 *   url     a path this seat can fetch (a copy staged on the host). The only
 *           kind that reconnects with NO gesture at all.
 *   file    the IDENTITY of a file picked through <input type="file"> — name,
 *           size, mtime. No browser will reopen that from storage, so this is
 *           a reminder rather than a location: on join we can name the exact
 *           file and put a picker in front of it, which is the difference
 *           between "reconnect Monstrous Manual.pdf?" and a seat that starts
 *           blank and silent every session.
 *
 * `file` is not a nicety: the File System Access API is absent on any insecure
 * origin, so a GM joining over plain http on the LAN — or anyone on Firefox —
 * had nothing remembered at all.
 */
const IDB_STORE = "bookHandles"; // store name predates the record shape; renaming it would strand every already-remembered book
const IDB_BYTES = "bookBytes"; // refresh bridge only — swept on every join, see below
const IDB_META = "bookMeta"; // the bridge's freshness stamp, kept out of the byte store so the heartbeat is cheap
const IDB_VERSION = 2;
const TOUCH_KEY = "touched";

function idb() {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open(MODULE_ID, IDB_VERSION);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      // Additive, and each store guarded: this runs for a fresh seat AND for
      // one upgrading from v1, where bookHandles already exists and must
      // survive untouched — its records are the whole point of the store.
      for (const name of [IDB_STORE, IDB_BYTES, IDB_META]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
}

async function idbOp(mode, fn, store = IDB_STORE) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const rq = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(rq?.result);
    tx.onerror = () => reject(tx.error);
  });
}

const locationPut = (bookId, record) => idbOp("readwrite", (s) => s.put(record, bookId));
const locationClear = () => idbOp("readwrite", (s) => s.clear());

/** The record kinds this module writes. Anything else is not ours to read. */
const LOCATION_KINDS = new Set(["handle", "url", "file"]);

/**
 * Records written before the shape existed are the bare handle itself. Read
 * them as the handle they are rather than discarding them — a seat that has
 * had its book remembered for weeks must not lose it to an upgrade.
 *
 * The handle is identified by BEHAVIOUR, and before anything else, because
 * `FileSystemHandle.kind` is a real property whose value is the string "file"
 * — the same word this module uses for a record it cannot reopen. Trusting
 * `kind` first read every legacy handle as "re-pick this by hand", which is
 * precisely the regression the migration exists to prevent.
 */
function asLocation(value) {
  if (!value) return null;
  if (typeof value.getFile === "function") return { kind: "handle", handle: value, name: value.name ?? null };
  return LOCATION_KINDS.has(value.kind) ? value : null;
}

/** Every remembered location on this seat, bookId → record. */
async function locations() {
  let keys = [];
  let values = [];
  try {
    const db = await idb();
    [keys, values] = await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const store = tx.objectStore(IDB_STORE);
      // One transaction for both, so the two arrays are guaranteed to line up.
      const k = store.getAllKeys();
      const v = store.getAll();
      tx.oncomplete = () => resolve([k.result ?? [], v.result ?? []]);
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn(`${MODULE_ID} | could not read remembered book locations (IndexedDB)`, err);
    return new Map();
  }
  const out = new Map();
  keys.forEach((key, i) => {
    if (key === DIR_KEY) return; // the remembered folder is not a book record
    const record = asLocation(values[i]);
    if (!record) return;
    // A book this build no longer reads (the Judge's Screen inserts, whose
    // tables moved into the JJ and RR in 0.38.0) must not be offered for
    // reconnect: there is nothing left for it to unlock, and every downstream
    // caller would have to defend itself against a book id with no entry in
    // BOOKS. The record is left in place rather than deleted — harmless, and a
    // withdrawn book that ever comes back finds its location still remembered.
    if (!BOOKS[key]) {
      console.log(`${MODULE_ID} | remembered location for "${key}" ignored — this build no longer reads that book.`);
      return;
    }
    out.set(key, record);
  });
  return out;
}

/** What to call a remembered location in front of a reader. */
const describeLocation = (record) =>
  record?.kind === "url" ? record.url : (record?.name ?? game.i18n.localize(`${LANG_PREFIX}.ui.locationUnnamed`));

/** Remember a file picked through the plain input: name only, and say so. */
const rememberFile = (bookId, file) =>
  locationPut(bookId, { kind: "file", name: file.name, size: file.size, lastModified: file.lastModified }).catch((err) =>
    console.warn(`${MODULE_ID} | could not remember ${file.name}`, err),
  );

/**
 * The remembered PARENT FOLDER, under a reserved key in the same store — not a
 * book record, and never surfaced as one. A seat that connected by pointing at
 * the folder holding its PDFs gets the whole shelf back in ONE permission
 * gesture next session: the directory handle re-grants once and every book
 * inside re-reads from it, where per-file handles cost one gesture each.
 * Forget Books clears it with everything else (locationClear sweeps the store).
 */
const DIR_KEY = "__folder__";
const dirPut = (handle) =>
  idbOp("readwrite", (s) => s.put({ kind: "dir", handle, name: handle.name ?? null }, DIR_KEY)).catch((err) =>
    console.warn(`${MODULE_ID} | could not remember the folder`, err),
  );
async function dirGet() {
  const record = await idbOp("readonly", (s) => s.get(DIR_KEY)).catch(() => null);
  return record?.kind === "dir" && record.handle ? record : null;
}

/* -------------------------------------------- */
/*  The shelf: books the SERVER holds           */
/* -------------------------------------------- */

/**
 * Books staged in the Foundry data directory, each one a JOURNAL in the world.
 *
 * Every other location kind is a property of one seat's browser: a handle that
 * needs a permission gesture, or a filename that needs the picker again. That
 * is a fair price for a book only this browser can reach, and no price at all
 * for a book the SERVER can reach — so a PDF the GM puts under `SHELF_DIR` is
 * remembered in the world instead of the seat, and every GM seat on any machine
 * reads it silently on join. This is what ends the reconnect-every-session
 * treadmill; the per-seat kinds stay, because they are how a book gets read the
 * first time and how its bytes reach the upload.
 *
 * The record is a JournalEntry — one per book, filed under the shelf folder,
 * stamped `flags[MODULE_ID].shelf = {book, name, size}` — whose single PDF page
 * points at the staged file. The page's `src` IS the shelf entry: it is what
 * `shelf()` reads, what the join-time restore fetches, and what the Judge sees
 * when they open the journal and press Load PDF. Deleting the journal takes
 * the book off the shelf; the file stays where it was put, because Foundry
 * offers no delete.
 *
 * The record is a PATH, never bytes: `connectBookUrl` fetches it like any other
 * served file. What a shelf entry asserts is only "this path holds this book",
 * and it is asserted by connecting and fingerprinting the file before the entry
 * is written — never by its filename.
 *
 * Worth stating plainly, because a journal invites the wrong conclusion in the
 * other direction: a file under the data directory is fetchable by any
 * signed-in user who learns its path, whatever the journal's ownership says.
 * Ownership decides who can find and open the book from the sidebar — the
 * journal is created for the GM alone, and sharing it is the Judge's gesture —
 * but the shelf makes a book undiscoverable, not inaccessible.
 *
 * `SETTING_SHELF` is where the shelf lived before it was journals: a world
 * setting mapping bookId → {path, name, size}. It is still registered so a
 * world upgraded past that reads it once — `migrateShelfSetting` turns each
 * entry into a journal and empties it — and nothing else reads it.
 */
const SETTING_SHELF = "shelf";
const SHELF_FLAG = "shelf";
const SHELF_DIR = "acks-extras-books";

/**
 * Every PDF in a shelf directory, this module's and the retired module's.
 * A book staged under the old name is still a staged book; only new uploads
 * go to `SHELF_DIR`. Resolves null when neither directory exists.
 */
async function shelfListing(FP) {
  const files = [];
  let any = false;
  for (const dir of [SHELF_DIR, LEGACY_SHELF_DIR]) {
    try {
      const listing = await FP.browse("data", dir);
      any = true;
      files.push(...(listing?.files ?? []));
    } catch {
      /* not there — the other may be */
    }
  }
  return any ? files : null;
}

const filePicker = () => foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;

/** The journal that holds one book on the shelf, or null. */
const shelfJournal = (bookId) => game.journal.find((j) => j.getFlag(MODULE_ID, SHELF_FLAG)?.book === bookId) ?? null;

/** The PDF page of a shelf journal — the one that carries the staged path. */
const shelfPage = (journal) => journal?.pages.find((p) => p.type === "pdf") ?? null;

/**
 * The world's shelf: bookId → { path, name, size, journalId }, read off the
 * shelf journals. A journal whose PDF page is gone holds no book: the page is
 * the record, so nothing else can vouch for a path.
 */
function shelf() {
  const out = {};
  for (const journal of game.journal) {
    const stamp = journal.getFlag(MODULE_ID, SHELF_FLAG);
    if (!stamp?.book || out[stamp.book]) continue;
    const page = shelfPage(journal);
    if (!page?.src) continue;
    out[stamp.book] = {
      path: page.src,
      name: stamp.name ?? page.src.split("/").pop(),
      size: stamp.size ?? 0,
      journalId: journal.id,
    };
  }
  return out;
}

/**
 * The sidebar folder every shelf journal is filed under. Found by its own
 * stamp first, then by name, so a folder the Judge renamed is still theirs and
 * a folder they already had under that name is adopted rather than doubled.
 * Stamped with the shelf flag, never the cookbook one: Remove Imports sweeps
 * cookbook-flagged folders, and the shelf is not an import.
 */
async function shelfFolder() {
  const name = game.i18n.localize(`${LANG_PREFIX}.ui.shelfFolder`);
  const journals = (f) => f.type === "JournalEntry";
  const found =
    game.folders.find((f) => journals(f) && f.getFlag(MODULE_ID, SHELF_FLAG) === true) ??
    game.folders.find((f) => journals(f) && !f.folder && f.name === name);
  if (found) return found;
  return game.folders.documentClass.create({
    name,
    type: "JournalEntry",
    sorting: "a",
    flags: { [MODULE_ID]: { [SHELF_FLAG]: true } },
  });
}

/** The PDF page a shelf journal carries: named for the book, pointed at the staged file. */
const shelfPageData = (label, path) => ({ name: label, type: "pdf", src: path });

/**
 * Write one shelf entry, or drop it when `record` is null.
 *
 * Writing means the book's journal: made if absent, otherwise brought up to
 * date in place — the stamp, the title, and the PDF page's `src`, which is
 * re-pointed rather than duplicated so a second staging of the same book never
 * leaves two pages. Dropping deletes the journal and only the journal.
 *
 * Reads `game.journal` at the moment of writing rather than a copy taken when
 * the window opened: two GM seats staging different books is exactly the case
 * where a stale read would make a twin.
 */
async function shelfPut(bookId, record) {
  const existing = shelfJournal(bookId);
  if (!record) {
    if (existing) await existing.delete();
    return shelf();
  }
  const label = BOOKS[bookId]?.label ?? bookId;
  const stamp = { book: bookId, name: record.name ?? record.path.split("/").pop(), size: record.size ?? 0 };
  if (existing) {
    const update = { [`flags.${MODULE_ID}.${SHELF_FLAG}`]: stamp };
    if (existing.name !== label) update.name = label;
    await existing.update(update);
    const page = shelfPage(existing);
    if (!page) await existing.createEmbeddedDocuments("JournalEntryPage", [shelfPageData(label, record.path)]);
    else if (page.src !== record.path || page.name !== label) await page.update({ src: record.path, name: label });
    return shelf();
  }
  const folder = await shelfFolder();
  // Ownership is left at Foundry's default — the creating GM owns it, nobody
  // else sees it — so handing a book to a player is a deliberate gesture on
  // the journal, never a side effect of staging.
  await game.journal.documentClass.create({
    name: label,
    folder: folder?.id ?? null,
    pages: [shelfPageData(label, record.path)],
    flags: { [MODULE_ID]: { [SHELF_FLAG]: stamp } },
  });
  return shelf();
}

/**
 * Carry a shelf recorded the old way — the world setting — into journals,
 * once, on the first GM seat to arrive. Every entry the setting holds was
 * fingerprinted when it was written, so none is re-read here; the join-time
 * restore reads each one anyway and refuses a file that no longer answers.
 *
 * The setting is emptied only after every entry landed: a write that fails
 * midway leaves the rest for the next load rather than losing them.
 */
async function migrateShelfSetting() {
  const legacy = game.settings.get(MODULE_ID, SETTING_SHELF) ?? {};
  const entries = Object.entries(legacy);
  if (!entries.length || !isPrimaryGM()) return 0;
  let moved = 0;
  for (const [bookId, record] of entries) {
    if (!BOOKS[bookId] || !record?.path) {
      console.warn(`${MODULE_ID} | the shelf setting named "${bookId}" with no book or no path; dropped.`);
      continue;
    }
    try {
      await shelfPut(bookId, record);
      moved++;
    } catch (err) {
      console.error(`${MODULE_ID} | the shelf could not be carried into journals at ${BOOKS[bookId].label}; it tries again on the next load.`, err);
      return moved;
    }
  }
  await game.settings.set(MODULE_ID, SETTING_SHELF, {});
  console.log(`${MODULE_ID} | shelf: ${moved} book(s) carried from the world setting into journals under "${game.i18n.localize(`${LANG_PREFIX}.ui.shelfFolder`)}".`);
  return moved;
}

/**
 * Read a staged path into its book and shelve it once it proves to be that
 * book. Returns the shelf record, or null when the file was not what the path
 * claimed — `ingestBook` refuses a file that fingerprints as another book, and
 * a refusal must not leave an entry behind promising the book is available.
 */
async function shelvePath(bookId, path, { name = null, size = 0 } = {}) {
  try {
    await connectBookUrl(bookId, path, { remember: false, bridge: false });
  } catch (err) {
    console.warn(`${MODULE_ID} | ${path} could not be shelved as ${BOOKS[bookId]?.label ?? bookId}`, err);
    ui.notifications.warn(
      err?.wrongBook
        ? `${MODULE_ID} | ${err.message}`
        : game.i18n.format(`${LANG_PREFIX}.ui.shelfFailed`, { name: name ?? path }),
    );
    return null;
  }
  const record = { path, name: name ?? path.split("/").pop(), size };
  await shelfPut(bookId, record);
  return record;
}

/**
 * Every PDF already sitting in the shelf directory, matched to the books it
 * holds. The GM who copies files onto the server themselves — by drag, by FTP,
 * by host panel — is done after this.
 *
 * `FilePicker.browse` answers with paths and no sizes, so the size pass of
 * `matchFilesToBooks` never fires here and matching rests on the remembered
 * name and the book's own title in the filename. That is the right strength
 * for a directory the GM curated: a stray PDF matches nothing and is left
 * alone, exactly as it is in a folder connect.
 *
 * One pass is added that belongs only to this directory: a file whose stem is
 * exactly a BOOK ID is that book. This is the convention `shelveUpload` writes
 * ("jj.pdf"), and without it the scan could not recognise the module's own
 * uploads — a shelf staged from the rows read as empty the moment it was
 * scanned, because "jj.pdf" contains neither a remembered name nor the words
 * "Judges Journal". It runs FIRST, since an exact id is stronger evidence than
 * a title found inside a longer filename, and it is confined to the shelf,
 * where the module controls the naming; a folder of the reader's own files is
 * matched on its own merits.
 *
 * A match here still only proposes a book. `shelvePath` opens the file and
 * lets the fingerprint refuse it, so a PDF named after the wrong book is
 * rejected rather than staged under a name it does not answer to.
 */
async function scanShelf() {
  const FP = filePicker();
  const listed = await shelfListing(FP);
  if (!listed) return { matched: new Map(), unmatched: [], held: [], missing: true };
  const files = listed
    .filter((path) => /\.pdf$/i.test(path))
    .map((path) => ({ name: decodeURIComponent(path.split("/").pop()), size: 0, path }));
  const already = shelf();
  const candidates = Object.keys(BOOKS).filter((id) => !already[id]);
  const byId = new Map();
  const held = [];
  const rest = [];
  for (const file of files) {
    const stem = file.name.replace(/\.pdf$/i, "").toLowerCase();
    // A file whose stem names a book the shelf ALREADY holds is not a file
    // that matched nothing — it is the file that book is read from. Counting
    // it as unmatched told a GM whose whole library was staged that all
    // nineteen of their PDFs "matched no book", which reads as total failure
    // over a shelf that is completely full.
    if (already[stem]) held.push(file);
    else if (candidates.includes(stem) && !byId.has(stem)) byId.set(stem, file);
    else rest.push(file);
  }
  const { matched, unmatched } = matchFilesToBooks(rest, candidates.filter((id) => !byId.has(id)), await locations());
  for (const [bookId, file] of byId) matched.set(bookId, file);
  return { matched, unmatched, held, missing: false };
}

/** The path a name already occupies in the shelf directory, or null. */
async function shelfFile(name) {
  const FP = filePicker();
  const listed = await shelfListing(FP);
  if (!listed) return null; // no directory yet: nothing is taken
  const wanted = name.toLowerCase();
  return (
    listed.find((path) => decodeURIComponent(path.split("/").pop()).toLowerCase() === wanted) ?? null
  );
}

/**
 * Put a book on the shelf from a file this seat holds. Upload goes through the
 * same `FilePicker.upload` call the art importer uses.
 *
 * The shelf copy is always named `<bookId>.pdf`. That is the module's own
 * directory and its own convention — the scan's first pass reads it, and one
 * name per book is what makes "is this book already up there?" a question with
 * an answer.
 *
 * Which matters, because **Foundry refuses to overwrite a non-media file**: a
 * second upload over a name already taken fails the request outright rather
 * than replacing it. So a taken name is answered by reading what is already
 * there instead of by a second copy of a hundred-megabyte book — and it is
 * staged only if it fingerprints as this book, which is also how a leftover
 * from another printing is caught rather than silently adopted.
 *
 * `verified` says the caller fingerprinted THESE bytes. That is stronger
 * evidence than re-reading the copy just written, so the entry is recorded
 * from the upload; an unverified upload is read back before anything is
 * written.
 */
async function shelveUpload(bookId, file, { verified = false } = {}) {
  const FP = filePicker();
  await FP.createDirectory("data", SHELF_DIR).catch((err) =>
    console.debug(`${MODULE_ID} | shelf directory "${SHELF_DIR}" not created (it usually already exists)`, err),
  );
  const name = `${bookId}.pdf`;
  const taken = await shelfFile(name);
  if (taken) {
    // Size is left at 0 rather than copied from the local pick: nothing was
    // uploaded, and the file up there is not necessarily this one.
    const held = await shelvePath(bookId, taken, { name });
    if (!held) throw new Error(game.i18n.format(`${LANG_PREFIX}.ui.shelfTaken`, { path: taken }));
    return held;
  }
  const named = file.name === name ? file : new File([file], name, { type: "application/pdf" });
  const res = await FP.upload("data", SHELF_DIR, named, {}, { notify: false });
  if (!res?.path) throw new Error(game.i18n.localize(`${LANG_PREFIX}.ui.shelfUploadFailed`));
  const record = { path: res.path, name, size: named.size ?? 0 };
  if (!verified) return shelvePath(bookId, res.path, { name, size: record.size });
  await shelfPut(bookId, record);
  return record;
}

/**
 * Put a book that is OPEN on this seat onto the server.
 *
 * The server is asked first, because it may already hold this book — a file
 * the GM copied there by hand, or one this world staged and then removed — and
 * a copy already up there needs no bytes from this seat at all. Only when the
 * name is free are the bridged bytes needed, and they are the bytes this seat
 * fingerprinted when it opened the book, so nothing is read back.
 */
async function shelveOpen(bookId) {
  const name = `${bookId}.pdf`;
  const taken = await shelfFile(name);
  if (taken) {
    const held = await shelvePath(bookId, taken, { name });
    if (!held) throw new Error(game.i18n.format(`${LANG_PREFIX}.ui.shelfTaken`, { path: taken }));
    return held;
  }
  const blob = await bytesGet(bookId).catch(() => null);
  if (!blob) throw new Error(game.i18n.localize(`${LANG_PREFIX}.ui.shelfNoBytes`));
  return shelveUpload(bookId, new File([blob], name, { type: "application/pdf" }), { verified: true });
}

/**
 * Put a book on the server from a file this seat can read, whether or not that
 * book is open here. This is what a GM who has never connected a book on this
 * machine reaches for: staging is a property of the world, so it must not cost
 * a seat-local connect first.
 *
 * The fingerprint is read BEFORE the upload, because an upload cannot be taken
 * back — Foundry offers no delete, so a file written before it was identified
 * leaves the wrong book on the server under a right name. `ingestBook` refuses
 * a file that fingerprints as another book, and only what it accepted is sent.
 * Reading it also opens it here, which is the same thing the row's own connect
 * control would have done.
 */
async function stageFile(bookId, file) {
  await ingestBook(bookId, await file.arrayBuffer(), { cache: file });
  return shelveUpload(bookId, file, { verified: true });
}

/**
 * Open every shelved book. Runs on join before the per-seat restore, so a book
 * the server holds never asks this seat for anything and never appears in the
 * list of books waiting for a gesture.
 */
async function restoreShelf() {
  const staged = Object.entries(shelf());
  if (!staged.length) return [];
  const opened = [];
  for (const [bookId, record] of staged) {
    if (!BOOKS[bookId] || sessionDocs.has(bookId)) continue;
    try {
      await connectBookUrl(bookId, record.path, { remember: false, bridge: false });
      opened.push(bookId);
    } catch (err) {
      console.warn(`${MODULE_ID} | shelved ${BOOKS[bookId]?.label ?? bookId} could not be read at ${record.path}`, err);
    }
  }
  if (opened.length) {
    console.log(`${MODULE_ID} | opened ${opened.length} book(s) from the shelf: ${opened.map((id) => BOOKS[id].label).join(", ")}`);
  }
  return opened;
}

/* -------------------------------------------- */
/*  Refresh bridge (short-lived byte cache)     */
/* -------------------------------------------- */

/**
 * A Foundry client reloads constantly — a module toggled, a macro saved, a
 * dropped connection — and on an insecure origin (any remote seat on plain
 * http, and every Firefox seat) each of those reloads used to cost the reader
 * a fresh trip through the file picker for every book they own. The location
 * was remembered; the FILE could not be reopened from it, because no browser
 * hands a picked file back from storage and the File System Access API that
 * would is absent outside a secure context.
 *
 * So the bytes are bridged across the reload, and ONLY across the reload:
 *
 *   • while a page with books open is alive it stamps the clock every 20s, and
 *     once more as it goes away;
 *   • the next page load compares that stamp against the moment IT started.
 *     Inside the window (60s by default) the cached bytes are reopened with no
 *     gesture at all — that is a refresh;
 *   • outside it, the bytes are deleted before anything else happens, and the
 *     seat goes through the normal reconnect gesture — that is a new session.
 *
 * Two details are load-bearing, and the first release of this got both wrong:
 *
 *   The stamp lives in localStorage, not IndexedDB, because it is written from
 *   `pagehide` and an async IndexedDB transaction started there NEVER COMMITS —
 *   the page is torn down first. localStorage.setItem is synchronous and lands.
 *   With the async write silently lost, the freshest stamp was whatever the 20s
 *   heartbeat had last managed, which quietly ate a third of the window.
 *
 *   The comparison is against `performance.timeOrigin` — when this document
 *   started — and NOT against the time this code happens to run. Foundry takes
 *   20-45s to reach `ready` on a real world, so measuring at `ready` charged
 *   the reader's window for the boot they were sitting through, and a 60s
 *   window bought perhaps fifteen. The question the window has to answer is
 *   "how long was this seat away?", which is exactly timeOrigin minus stamp.
 *
 * This is deliberately NOT a copy of the book. It cannot outlive the window,
 * closing the tab for a minute empties it, and Forget Books empties it now.
 * The possession model is unchanged: a seat still cannot read a book it has
 * not opened from its own file this session, and the prose still never
 * persists anywhere.
 */
const CACHE_HEARTBEAT_MS = 20_000;
const STAMP_KEY = "acks-extras.bridgeTouched";
/** How far ahead of this document a stamp may sit before it means clock drift. */
const CLOCK_TOLERANCE_MS = 5_000;

/** Configured bridge window in ms; 0 (or an unregistered setting) disables it. */
function cacheWindowMs() {
  try {
    return Math.max(0, Number(game.settings.get(MODULE_ID, SETTING_REFRESH_CACHE)) || 0) * 1000;
  } catch {
    return 0; // called before init registered it — treat as off rather than throw
  }
}

const bytesPut = (bookId, blob) => idbOp("readwrite", (s) => s.put(blob, bookId), IDB_BYTES);
const bytesGet = (bookId) => idbOp("readonly", (s) => s.get(bookId), IDB_BYTES);
const bytesClear = () => idbOp("readwrite", (s) => s.clear(), IDB_BYTES);
/**
 * The stamp. Synchronous on purpose — see the note above about `pagehide`.
 * A profile with storage blocked throws on access rather than returning null,
 * and a bridge that cannot stamp simply never hits.
 */
function stampGet() {
  try {
    return Number(localStorage.getItem(STAMP_KEY)) || 0;
  } catch {
    return 0;
  }
}
function stampPut(at) {
  try {
    localStorage.setItem(STAMP_KEY, String(at));
  } catch {
    /* storage blocked or full: the bridge just misses */
  }
}
function stampClear() {
  try {
    localStorage.removeItem(STAMP_KEY);
  } catch {
    /* nothing to do */
  }
  // The 0.61.0 stamp lived here and could not survive pagehide. Clear it so an
  // upgrading seat is not carrying a dead record around forever.
  return idbOp("readwrite", (s) => s.clear(), IDB_META).catch((err) =>
    console.debug(`${MODULE_ID} | refresh-bridge stamp store could not be cleared`, err),
  );
}

/**
 * Stash the bytes this seat just read, so a reload inside the window is free.
 *
 * Takes the File/Blob the caller already holds rather than the ArrayBuffer it
 * passed to the reader: pdf.js takes ownership of that buffer and transfers it
 * to its worker, so by the time a book is open the array is detached and there
 * is nothing left to store. A File also costs no copy on Chromium — IndexedDB
 * keeps a reference to the file already on disk.
 */
async function cacheBytes(bookId, blob) {
  if (!blob || !cacheWindowMs()) return;
  try {
    await bytesPut(bookId, blob);
    stampPut(Date.now());
  } catch (err) {
    // Over quota, private mode, a locked-down profile — the bridge is a
    // convenience and must never take an opened book down with it.
    console.warn(`${MODULE_ID} | refresh bridge unavailable for ${bookId} (books still open this session)`, err);
  }
}

/**
 * Reopen from the bridge. Returns whether it hit — a miss is the ordinary case
 * (a genuinely new session) and says nothing.
 */
async function openCached(bookId) {
  if (!cacheWindowMs()) return false;
  let blob = null;
  try {
    blob = await bytesGet(bookId);
  } catch (err) {
    console.warn(`${MODULE_ID} | could not read the refresh bridge for ${bookId}`, err);
    return false;
  }
  if (!blob) return false;
  try {
    // Re-stash: the buffer below is about to be detached, and a seat that
    // refreshes twice in a row should be bridged both times.
    await ingestBook(bookId, await blob.arrayBuffer(), { silent: true, cache: blob });
    console.log(`${MODULE_ID} | ${BOOKS[bookId]?.label ?? bookId} restored across a page reload — no gesture needed.`);
    return true;
  } catch (err) {
    // The file moved out from under a stored reference, or the blob is gone.
    console.warn(`${MODULE_ID} | refresh bridge for ${bookId} could not be read — falling back to the remembered location`, err);
    return false;
  }
}

/**
 * Drop the bridge unless the last page died inside the window. Runs before
 * anything else on join, so a real session gap can never read stale bytes.
 */
async function sweepCache() {
  const windowMs = cacheWindowMs();
  const stamp = stampGet();
  // How long the seat was AWAY: from the old page going quiet to this document
  // starting. Explicitly not "until now" — `now` is after Foundry's whole boot,
  // which the reader should not be charged for.
  const away = performance.timeOrigin - stamp;
  // A reload records the INCOMING document's timeOrigin before the outgoing
  // page is given `pagehide`, so the gap on an ordinary refresh is a few
  // milliseconds NEGATIVE. Requiring it to be positive rejected every single
  // refresh — the exact thing the bridge exists for. Only a stamp implausibly
  // far ahead means the clock actually moved, and that one is not trustworthy.
  const skewed = away < -CLOCK_TOLERANCE_MS;
  if (windowMs && stamp && !skewed && away <= windowMs) {
    console.log(
      `${MODULE_ID} | page was away ${Math.max(0, away / 1000).toFixed(1)}s (window ${windowMs / 1000}s) — books open at the time are restored without a gesture.`,
    );
    return true;
  }
  if (stamp) {
    console.log(
      `${MODULE_ID} | refresh bridge expired — page was away ${(away / 1000).toFixed(1)}s, window is ${windowMs / 1000}s${skewed ? " (stamp is in the future — clock changed?)" : ""}. Books come back through the reconnect dialog.`,
    );
  }
  await bytesClear().catch((err) =>
    console.debug(`${MODULE_ID} | expired refresh-bridge bytes could not be cleared`, err),
  );
  await stampClear();
  return false;
}

let heartbeat = null;

/**
 * Keep the stamp current while this page is alive and books are open. Without
 * it the window would be measured from the moment a book was connected, so a
 * seat that had played for an hour would find its bridge expired on the very
 * reload it exists to cover.
 */
function startCacheHeartbeat() {
  if (heartbeat) return;
  const touch = () => {
    if (!sessionDocs.size || !cacheWindowMs()) return;
    stampPut(Date.now());
  };
  heartbeat = setInterval(touch, CACHE_HEARTBEAT_MS);
  // pagehide fires on reload, navigation and tab close alike — and unlike
  // unload it also fires when the page goes into the back/forward cache. The
  // write inside it must be synchronous; see the note above.
  window.addEventListener("pagehide", touch);
  // pagehide is not guaranteed on mobile, where a backgrounded tab can be
  // discarded outright; hidden is the last moment such a page is certain to
  // get. Both are cheap and idempotent.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") touch();
  });
  touch();
}

/* -------------------------------------------- */
/*  Recipe resolution (static + dynamic)        */
/* -------------------------------------------- */

const dynamicRecipes = () => game.settings.get(MODULE_ID, SETTING_DYNAMIC) ?? {};
const allRecipes = () => [...RECIPES, ...Object.values(dynamicRecipes())];

/* -------------------------------------------- */
/*  Connect / restore books                     */
/* -------------------------------------------- */

/**
 * Programmatic connect: read a PDF from a URL this seat can fetch (a file the
 * GM staged under the Foundry data dir, or any served path). The interactive
 * connectBook() stays the normal path; this one serves hosted copies and
 * automated live tests.
 *
 * The file itself is never kept — what persists is the PATH, so the seat
 * reconnects itself on every future join. Pass `{ remember: false }` for a
 * one-off read that should leave nothing behind.
 *
 * `bridge` says whether the bytes are worth keeping across a page reload. The
 * refresh bridge exists for a file this seat CANNOT reopen without a gesture;
 * a book the server holds is refetched on every join with no gesture at all,
 * so bridging one buys nothing and costs the whole shelf — seventeen books is
 * better than half a gigabyte written into this seat's storage at every join,
 * for reads that were never going to ask the reader for anything.
 */
async function connectBookUrl(bookId, url, { remember = true, bridge = true } = {}) {
  // Throws rather than warning-and-returning: the shelf decides whether to
  // record a path from whether this resolved, and a soft return told it the
  // read had succeeded. Callers that only want the message still get it — the
  // notification is raised here and the error carries the same text.
  if (!BOOKS[bookId]) {
    const message = `${MODULE_ID} | unknown book id "${bookId}".`;
    ui.notifications.warn(message);
    throw new Error(message);
  }
  const resp = await fetch(url);
  if (!resp.ok) {
    const message = `${MODULE_ID} | could not read ${url} (${resp.status}).`;
    ui.notifications.warn(message);
    throw new Error(message);
  }
  // Blob first, buffer from it: pdf.js detaches the array it is handed, and a
  // re-download of a whole book is exactly what the refresh bridge saves.
  const blob = await resp.blob();
  const hits = await ingestBook(bookId, await blob.arrayBuffer(), { cache: bridge ? blob : null });
  // A path IS a location, and the one kind that needs no gesture to reopen, so
  // a seat pointed at a staged copy reconnects itself on every future join.
  if (remember) {
    await locationPut(bookId, { kind: "url", url, name: url.split("/").pop() || url }).catch((err) =>
      console.warn(`${MODULE_ID} | could not remember ${url}`, err),
    );
  }
  return hits;
}

/**
 * Read a book into this session.
 *
 * Opening is an open and a fingerprint: nothing is extracted here. Text is read
 * from the page an import names, at the moment it is imported, and written into
 * the document — so a connect costs one parse instead of one parse per recipe.
 *
 * `cache` is the File/Blob the caller read `buffer` from, when it still holds
 * one. It is bridged across page reloads (see the refresh bridge above) and is
 * never a substitute for the file itself.
 */
async function ingestBook(bookId, buffer, { silent = false, cache = null } = {}) {
  const entries = cookbookCount(bookId);
  const bar = progressBar(game.i18n.format(`${LANG_PREFIX}.ui.progressReading`, { book: BOOKS[bookId]?.label ?? bookId }), 1);
  try {
    bar.note(game.i18n.localize(`${LANG_PREFIX}.ui.progressOpening`));
    const { doc, numPages, title } = await openBook(buffer);
    // A file that fingerprints as ANOTHER book in the registry is never read
    // into this one. Every recipe this build extracts is a page number, so a
    // book filled from the wrong PDF imports the wrong page's content under the
    // right name, and nothing downstream can tell. Refusing costs a reader one
    // message; proceeding costs them an import they have to find and undo.
    // Edition drift stays a warning — see identifyBook.
    const actualId = identifyBook(numPages, title);
    if (actualId && actualId !== bookId) {
      await doc.destroy?.();
      const err = new Error(
        game.i18n.format(`${LANG_PREFIX}.ui.connectWrongBook`, {
          book: BOOKS[bookId]?.label ?? bookId,
          actual: BOOKS[actualId].label,
        }),
      );
      err.wrongBook = actualId;
      throw err;
    }
    const warning = fingerprintWarning(bookId, numPages, title);
    if (warning && !silent) ui.notifications.warn(`${MODULE_ID} | ${warning}`);
    sessionDocs.set(bookId, { doc, title });
    // Only once the book actually opened: a file that failed the read is not
    // worth bridging, and bridging it would keep re-failing every reload.
    await cacheBytes(bookId, cache);
    const message = `${MODULE_ID} | ${BOOKS[bookId]?.label ?? bookId}: open — ${entries} entr${entries === 1 ? "y" : "ies"} available to import.`;
    if (silent) console.log(message);
    else ui.notifications.info(message);
    return true;
  } finally {
    bar.finish();
  }
}

/**
 * Import ACKS rules TABLES (availability, wages, rarity, …) from the connected
 * books into the world, via the acks-lib ruledata-import contract. GM-only
 * (it writes world data). Sibling modules (acks-henchmen) read the result from
 * acksLib.tables; markets, wages and hiring light up as coverage grows.
 */
async function cookbookImportTables() {
  if (!game.user.isGM) {
    ui.notifications.warn(game.i18n.localize(`${LANG_PREFIX}.tables.gmOnly`));
    return null;
  }
  if (!services.get("ruledata-import")) {
    ui.notifications.error(game.i18n.localize(`${LANG_PREFIX}.tables.noProvider`));
    return null;
  }
  let report;
  const bar = progressBar(game.i18n.localize(`${LANG_PREFIX}.ui.progressTables`), tableRecipeCount());
  try {
    report = await importTables(sessionDocs, { onProgress: (name) => bar.step(name) });
  } catch (err) {
    ui.notifications.error(`${MODULE_ID} | ${err.message}`);
    return null;
  } finally {
    bar.finish();
  }
  const nTables = report.imported.reduce((s, d) => s + d.tables.length, 0);
  if (nTables) {
    ui.notifications.info(
      game.i18n.format(`${LANG_PREFIX}.tables.imported`, {
        tables: nTables,
        docs: report.imported.map((d) => d.docId).join(", "),
      }),
    );
  }
  if (report.missingBooks.length) {
    ui.notifications.warn(
      game.i18n.format(`${LANG_PREFIX}.tables.missingBooks`, { books: report.missingBooks.join(", ") }),
    );
  }
  // The class-builder tables carry world writes of their own: the assembled
  // engine-shaped doc, race Items, and builder state on the imported classes.
  if (report.imported.some((d) => d.docId === "acks.classBuilder")) {
    try {
      const built = await applyBuilderImport();
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
  }
  // The travel doc likewise: the raw page reads assemble into the
  // engine-shaped tables acks-extras' travel derivations declare.
  if (report.imported.some((d) => d.docId === TRAVEL_DOC_ID)) {
    try {
      const t = await applyTravelImport();
      if (t.assembled.length) console.log(`${MODULE_ID} | travel tables assembled`, t.assembled);
    } catch (err) {
      console.error(`${MODULE_ID} | travel table binding failed`, err);
      ui.notifications.warn(`${MODULE_ID} | travel tables: ${err.message}`);
    }
  }
  // And the weather doc: bands, climate modifiers, condition factors and
  // footing thresholds for the formation feature's daily generator.
  if (report.imported.some((d) => d.docId === WEATHER_DOC_ID)) {
    try {
      const w = await applyWeatherImport();
      if (w.assembled.length) console.log(`${MODULE_ID} | weather tables assembled`, w.assembled);
    } catch (err) {
      console.error(`${MODULE_ID} | weather table binding failed`, err);
      ui.notifications.warn(`${MODULE_ID} | weather tables: ${err.message}`);
    }
  }
  // And the encounters doc: the wilderness chain's bands, names, distances,
  // visibility, evasion and terrain lists for the formation feature.
  if (report.imported.some((d) => d.docId === ENCOUNTERS_DOC_ID)) {
    try {
      const e = await applyEncountersImport();
      if (e.assembled.length) console.log(`${MODULE_ID} | encounter tables assembled`, e.assembled.length);
    } catch (err) {
      console.error(`${MODULE_ID} | encounter table binding failed`, err);
      ui.notifications.warn(`${MODULE_ID} | encounter tables: ${err.message}`);
    }
  }
  // And the voyages doc: the wind rows, tacking rate, navigation and hazard
  // figures, and hull damage shares the sea derivations read.
  if (report.imported.some((d) => d.docId === VOYAGES_DOC_ID)) {
    try {
      const v = await applyVoyagesImport();
      if (v.assembled.length) console.log(`${MODULE_ID} | voyage tables assembled`, v.assembled);
    } catch (err) {
      console.error(`${MODULE_ID} | voyage table binding failed`, err);
      ui.notifications.warn(`${MODULE_ID} | voyage tables: ${err.message}`);
    }
  }
  // The land-travel documents all bind the same way — if this run imported it,
  // assemble its engine tables and register them — so they are a table rather
  // than five copies of one try/catch. A failure in one is reported and the
  // rest still run: a party that can forage should not lose the ability
  // because the flight pages would not parse.
  for (const { id, apply } of LAND_BINDINGS) {
    if (!report.imported.some((d) => d.docId === id)) continue;
    try {
      const result = await apply();
      if (result.assembled.length) console.log(`${MODULE_ID} | ${id} tables assembled`, result.assembled);
    } catch (err) {
      console.error(`${MODULE_ID} | ${id} table binding failed`, err);
      ui.notifications.warn(`${MODULE_ID} | ${id} tables: ${err.message}`);
    }
  }
  // The taxonomy is read, not shipped, so the items exist only once a seat has
  // imported it from their own book.
  if (report.imported.some((d) => d.docId === LANGUAGES_DOC_ID)) {
    try {
      const table = getDoc(LANGUAGES_DOC_ID)?.tables?.tree;
      const made = table ? await applyLanguageImport(table) : { created: 0, present: 0, adopted: 0, retyped: 0 };
      // Adoptions and retypes are work the seat should hear about too: a run
      // that creates nothing — because every tongue was already there under a
      // Judge's own name, or was minted as an ability by an older version —
      // has still changed the world.
      const landed = made.created + made.adopted + made.retyped;
      if (landed) {
        ui.notifications.info(game.i18n.format(`${LANG_PREFIX}.tables.languagesApplied`, { created: landed }));
      }
      console.log(`${MODULE_ID} | language binding`, made);
    } catch (err) {
      console.error(`${MODULE_ID} | language binding failed`, err);
      ui.notifications.warn(`${MODULE_ID} | languages: ${err.message}`);
    }
  }
  console.log(`${MODULE_ID} | table import`, report);
  return report;
}

const fsaAvailable = () => typeof window.showOpenFilePicker === "function";

/* -------------------------------------------- */
/*  Dialog markup                               */
/* -------------------------------------------- */

/**
 * Hand DialogV2 markup it will not rewrite.
 *
 * A STRING `content` goes through `foundry.utils.cleanHTML`, which rebuilds
 * every element and copies only allowlisted attributes: `accept` is on no list
 * at all, and `multiple` is allowed on `<select>` but NOT on `<input>`. A
 * multi-file picker therefore arrives as a single-file one, and every branch
 * behind it becomes unreachable — silently, since the markup is never wrong,
 * only rewritten. An attribute-less `<div>` is treated as trusted and its
 * innerHTML used verbatim (DialogV2 rejects any other tag, and rejects the div
 * if it carries a single attribute).
 *
 * Every DialogV2 in this module is built through here, whether or not its
 * current markup happens to survive cleaning — otherwise the next attribute
 * added to a dialog decides for itself whether the dialog still works.
 *
 * Declared as a function rather than a const so a sibling module can import it
 * across the module cycle without meeting it in its temporal dead zone.
 */
export function dialogContent(html) {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
}

/* -------------------------------------------- */
/*  One dialog of a kind at a time              */
/* -------------------------------------------- */

const openDialogs = new Map();

/**
 * Reuse the dialog that is already open instead of stacking another.
 *
 * Every entry point here can be reached twice over: the Getting Started button
 * calls connectBook() on every click and nothing was stopping a second one,
 * the macro calls it too, and the reconnect pass runs both from the join hook
 * and from its own macro. Each of those opened ANOTHER identical window, so a
 * reader who clicked twice got two book pickers stacked on top of each other —
 * two dropdowns listing the same books, two chances to read the same PDF into
 * the same slot, and no way to tell which one was in front.
 *
 * The key is registered synchronously, before the dialog's content is built,
 * because the build is async (it reads remembered locations first) and two
 * fast clicks would otherwise both get past that await before either had
 * claimed the slot.
 *
 * Three states, not two, and conflating the last two throws. The entry is
 * dropped when its promise settles, but that is a microtask: something that
 * closes the window and asks for it again in the same turn finds an entry
 * whose app is closed, and `bringToFront` on a closed application reaches for
 * the style of an element that is no longer there. So:
 *
 *   • no entry            — build one;
 *   • entry, app not yet captured — the build is still in flight; wait on it
 *     rather than starting a second (this is the case the key exists for);
 *   • entry, app closed   — its promise is already settling; forget it now and
 *     open afresh, or the reader's click does nothing at all.
 */
function singleton(key, open) {
  const existing = openDialogs.get(key);
  if (existing && (!existing.app || existing.app.rendered)) {
    if (existing.app?.rendered) existing.app.bringToFront?.();
    return existing.promise;
  }
  if (existing) openDialogs.delete(key);
  const entry = { app: null };
  entry.promise = Promise.resolve(open((app) => (entry.app = app))).finally(() => {
    // Only clear the slot if it is still OURS: a re-entry that replaced a
    // closed dialog must not have its own entry deleted by the old one.
    if (openDialogs.get(key) === entry) openDialogs.delete(key);
  });
  openDialogs.set(key, entry);
  return entry.promise;
}

/**
 * "Connect a book" and "your books" were two windows asking the same question.
 *
 * The connect dialog named books in a `<select multiple>` and then asked for
 * files; the Books dialog already drew a row per book with its own control, and
 * a row names a book far better than a six-line list of twenty does. So the
 * select is gone and the row IS the naming — which also retires the positional
 * fallback that existed only because a multi-select cannot say which file is
 * which (`pairPicks`). Evidence places a file or nothing does.
 *
 * The name survives as an alias because macros already imported into worlds
 * call it, and a compendium macro outlives the build that shipped it.
 */
const connectBook = () => openBooksDialog();

/**
 * Read each paired file into its book and remember where it came from.
 *
 * Each book is remembered in the strongest form this seat supports: the FSA
 * handle when the pick came through `showOpenFilePicker` (one-click reopen next
 * session), name-only otherwise — all a browser without the File System Access
 * API will let us keep, and still worth keeping, since next session says the
 * name and offers the picker instead of leaving the seat to work it out.
 *
 * Reads are sequential: several ACKS PDFs parsed at once is hundreds of
 * megabytes in flight. One file that fails to open is reported against its own
 * book and costs the others nothing, and a file refused for being another book
 * says so instead of reading as a failed read.
 *
 * @param {Map<string, File>} matched  bookId → the file that answers it
 * @param {Map<File, {file: File, handle?: FileSystemFileHandle}>} byFile  each file's pick, for its handle
 * @param {object} [options]
 * @param {boolean} [options.announce]  say where each book was remembered, one message per book
 * @returns {Promise<string[]>} labels of the books now open
 */
async function ingestPairs(matched, byFile, { announce = true } = {}) {
  const done = [];
  for (const [bookId, file] of matched) {
    const handle = byFile.get(file)?.handle ?? null;
    try {
      await ingestBook(bookId, await file.arrayBuffer(), { cache: file });
    } catch (err) {
      console.error(`${MODULE_ID} | connect ${bookId} from ${file.name}`, err);
      ui.notifications.error(
        err.wrongBook
          ? `${MODULE_ID} | ${err.message}`
          : `${BOOKS[bookId].label}: ${game.i18n.localize(`${LANG_PREFIX}.ui.reconnectFailed`)}`,
      );
      continue;
    }
    done.push(BOOKS[bookId].label);
    // Remembering is a separate outcome from reading, and reported as one: the
    // book is open either way, and saying "could not be opened" over a storage
    // failure describes a book the reader can see working.
    try {
      if (handle) {
        await locationPut(bookId, { kind: "handle", handle, name: handle.name ?? null, size: file.size });
        if (announce) ui.notifications.info(game.i18n.format(`${LANG_PREFIX}.ui.locationSaved`, { book: BOOKS[bookId].label }));
      } else {
        await rememberFile(bookId, file);
        if (announce) {
          ui.notifications.info(
            game.i18n.format(`${LANG_PREFIX}.ui.locationNameOnly`, { book: BOOKS[bookId].label, name: file.name }),
          );
        }
      }
    } catch (err) {
      console.warn(`${MODULE_ID} | ${bookId} opened but its location could not be remembered`, err);
      ui.notifications.warn(game.i18n.format(`${LANG_PREFIX}.ui.locationNotSaved`, { book: BOOKS[bookId].label }));
    }
  }
  return done;
}

/**
 * Reopen ONE remembered book. Returns whether this seat can now read it.
 *
 * Each kind fails differently and each failure is logged as itself — "it did
 * not reconnect" and "there was nothing to reconnect" used to be indis-
 * tinguishable from the outside, and they are not the same problem.
 *
 * `interactive` is the caller promising it holds a fresh user gesture, which
 * is the only state in which a browser will re-grant file permission.
 */
async function openRemembered(bookId, record, { interactive = false } = {}) {
  if (sessionDocs.has(bookId)) return true;
  const label = BOOKS[bookId]?.label ?? bookId;

  // Was this page just reloaded? Then the bytes are still bridged and every
  // kind reopens for free — including the `file` kind, which has no other way
  // back and is what every remote seat on plain http gets.
  if (await openCached(bookId)) return true;

  // A served path needs no permission and no gesture: this is the one kind
  // that puts a seat back exactly where it was, silently, on every join.
  if (record?.kind === "url") {
    try {
      const resp = await fetch(record.url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      await ingestBook(bookId, await blob.arrayBuffer(), { silent: !interactive, cache: blob });
      return true;
    } catch (err) {
      console.warn(`${MODULE_ID} | remembered ${label}: ${record.url} could not be read`, err);
      return false;
    }
  }

  // Identity only — no browser hands a picked file back from storage. The
  // dialog names it and offers the picker; there is nothing to try here.
  if (record?.kind === "file") {
    console.log(`${MODULE_ID} | remembered ${label}: "${record.name}" must be re-picked (this browser cannot reopen it by itself).`);
    return false;
  }

  if (!fsaAvailable() || !record?.handle?.queryPermission) {
    console.warn(
      `${MODULE_ID} | remembered ${label}: this browser cannot reopen a stored file location (insecure origin, or no File System Access API) — re-pick the file.`,
    );
    return false;
  }
  try {
    let perm = await record.handle.queryPermission({ mode: "read" });
    // Expected on every reload: browsers drop file permission when the page
    // goes away, so a remembered book is "prompt" until a user gesture
    // re-grants it. That gesture is the reconnect dialog — this is the normal
    // path, not a failure, and saying so stops it reading like one.
    if (perm === "prompt" && interactive) perm = await record.handle.requestPermission({ mode: "read" });
    if (perm !== "granted") {
      console.log(`${MODULE_ID} | remembered ${label}: permission "${perm}" — needs the unlock gesture this session.`);
      return false;
    }
    const file = await record.handle.getFile();
    await ingestBook(bookId, await file.arrayBuffer(), { silent: !interactive, cache: file });
    return true;
  } catch (err) {
    console.warn(`${MODULE_ID} | remembered ${label} could not be opened (moved/deleted?)`, err);
    return false;
  }
}

/**
 * Reopen everything this seat remembers, silently. Runs on join: whatever can
 * be opened without asking is opened, and the rest comes back as `pending` for
 * the reconnect dialog.
 */
async function restoreBooks() {
  const records = await locations();
  if (!records.size) {
    console.log(`${MODULE_ID} | no book locations remembered on this seat yet — connect one to have it offered next session.`);
    return [];
  }
  const pending = [];
  for (const [bookId, record] of records) {
    if (!(await openRemembered(bookId, record))) pending.push(bookId);
  }
  return pending;
}

/**
 * Every PDF file handle under a directory handle, one level of subfolders deep
 * — enough for a shelf sorted into "Core"/"Adventures", shallow enough that
 * pointing at a whole drive does not become a filesystem crawl. Capped for the
 * same reason; the cap is far above any real shelf.
 */
async function pdfHandlesIn(dirHandle, depth = 1) {
  const out = [];
  for await (const entry of dirHandle.values()) {
    if (out.length >= 200) break;
    if (entry.kind === "file" && /\.pdf$/i.test(entry.name)) out.push(entry);
    else if (entry.kind === "directory" && depth > 0) out.push(...(await pdfHandlesIn(entry, depth - 1)));
  }
  return out;
}

/**
 * Connect every recognised book among a folder's PDFs.
 *
 * A folder is a GROUP, so only evidence places a file — remembered name, byte
 * size, or the book's title in the filename — and the positional fallback the
 * connect dialog uses for hand-named books never runs here: a folder full of
 * adventures must not have one dealt into an empty slot. Unrecognised PDFs are
 * NORMAL in a folder (that is where the rest of a collection lives), so they
 * are counted in the toast and named only on the console, not warned about.
 *
 * @param {{file: File, handle?: FileSystemFileHandle}[]} picks  the folder's PDFs
 * @param {object} [options]
 * @param {FileSystemDirectoryHandle} [options.remember]  the folder itself, for one-gesture group reconnects
 */
async function connectFolderPicks(picks, { remember = null } = {}) {
  const candidates = Object.keys(BOOKS).filter((id) => !sessionDocs.has(id));
  if (!candidates.length) {
    return ui.notifications.info(
      game.i18n.format(`${LANG_PREFIX}.ui.reconnectAllOpen`, {
        books: [...sessionDocs.keys()].map((id) => BOOKS[id]?.label ?? id).join(", "),
      }),
    );
  }
  const byFile = new Map(picks.map((pick) => [pick.file, pick]));
  const { matched, unmatched } = matchFilesToBooks([...byFile.keys()], candidates, await locations());
  // The folder is worth remembering even when nothing matched yet — the books
  // may land in it later, and the group reconnect re-scans on every use.
  if (remember) await dirPut(remember);
  if (unmatched.length) {
    console.log(`${MODULE_ID} | folder scan: ${unmatched.length} PDF(s) matched no book — ${unmatched.map((f) => f.name).join(", ")}`);
  }
  if (!matched.size) {
    return ui.notifications.warn(game.i18n.localize(`${LANG_PREFIX}.ui.folderNone`));
  }
  const done = await ingestPairs(matched, byFile, { announce: false });
  if (done.length) {
    ui.notifications.info(
      game.i18n.format(`${LANG_PREFIX}.ui.folderDone`, { count: done.length, books: done.join(", ") }) +
        (unmatched.length ? ` ${game.i18n.format(`${LANG_PREFIX}.ui.folderSkipped`, { skipped: unmatched.length })}` : ""),
    );
  }
  return done;
}

/**
 * "Your ACKS Books" — the one window the book lives in.
 *
 * There used to be three, and they overlapped: a Getting Started walkthrough
 * with its own "Connect a book…" button, a Connect dialog whose `<select
 * multiple>` listed every book six rows at a time, and this one, which already
 * drew a row per book with its own control. A reader could not tell from the
 * macro list which of them would show them anything, and two of the three
 * asked "which book do you mean?" in different words.
 *
 * A ROW is the answer to that question. It names one book, carries one control,
 * acts the moment it is used and says what happened — so the select is gone,
 * and with it the positional pairing that only ever existed because a
 * multi-select cannot say which file is which.
 *
 * Four bands, in the order a seat needs them:
 *
 *   1. the first-run walkthrough, open on a seat with nothing connected and
 *      collapsed once there is (it carries the GM's one-click import chain);
 *   2. the shelf — books the SERVER holds, which need no gesture from anyone;
 *   3. this computer — the controls that answer for SEVERAL books at once;
 *   4. the books themselves, grouped by what each one needs.
 *
 * The one-gesture rule shapes band 3 and 4 between them. Re-granting file
 * permission consumes the user activation that authorized it, so one click can
 * only ever unlock one handle — which is why each waiting book keeps its own
 * Unlock and why "Reconnect all" spends its single gesture on the remembered
 * FOLDER when there is one (a directory re-grants once and every book inside
 * re-reads from it) and reports honestly about the rest when there is not. A
 * plain file picker grants no persistent permission and so consumes nothing,
 * which is why "Pick PDFs…" can answer for the whole shelf at once.
 */
const openBooksDialog = (opts) => singleton("books", (capture) => booksDialog(capture, opts));

async function booksDialog(capture, { firstRun = false, autoClose = false, notice = "" } = {}) {
  const records = await locations();
  const staged = shelf();
  const dir = fsaAvailable() ? await dirGet() : null;
  const isGM = game.user.isGM;
  const fsa = fsaAvailable();
  const esc = foundry.utils.escapeHTML ?? ((s) => s);
  const L = (key, data) =>
    data ? game.i18n.format(`${LANG_PREFIX}.ui.${key}`, data) : game.i18n.localize(`${LANG_PREFIX}.ui.${key}`);
  const G = (key, data) =>
    data ? game.i18n.format(`${LANG_PREFIX}.gs.${key}`, data) : game.i18n.localize(`${LANG_PREFIX}.gs.${key}`);

  const pending = Object.keys(BOOKS).filter((id) => records.has(id) && !sessionDocs.has(id));
  const closed = Object.keys(BOOKS).filter((id) => !sessionDocs.has(id));

  // What a connection unlocks — the scope figures Book Status used to print to
  // the console, on the row they describe.
  const scopeOf = (id) => {
    const entries = cookbookCount(id);
    const recipes = allRecipes().filter((r) => r.book === id).length;
    return [entries ? `${entries} cookbook entr${entries === 1 ? "y" : "ies"}` : "", recipes ? `${recipes} recipe(s)` : ""]
      .filter(Boolean)
      .join(" + ");
  };

  /* ---- band 1: the first-run walkthrough ---------------------------- */

  // Open when this seat has nothing at all and has not asked otherwise; a seat
  // with books already reading gets it collapsed, because by then it is
  // reference material rather than instructions.
  const nothingYet = !sessionDocs.size && !records.size && !Object.keys(staged).length;
  const startOpen = (firstRun || nothingYet) && !gettingStartedDismissed();
  const gmBand = isGM
    ? `<h4>${G("gmHead")}</h4>
       <p>${G("gmBody")}</p>
       <div class="acks-extras-importer-gs-action">
         <button type="button" data-gs-import><i class="fa-solid fa-download"></i> ${G("gmGo")}</button>
         <span class="notes" data-gs-import-status></span>
       </div>`
    : "";
  const intro = `<details class="acks-extras-importer-gs"${startOpen ? " open" : ""}>
    <summary>${G("title")}</summary>
    <p>${G("intro")}</p>
    ${gmBand}
    <label class="acks-extras-importer-gs-dismiss">
      <input type="checkbox" name="dismiss"${gettingStartedDismissed() ? " checked" : ""}> ${G("dismiss")}
    </label>
  </details>`;

  /* ---- band 2: the shelf -------------------------------------------- */

  // GM-only: staging a book writes world settings and uploads to the data
  // directory, neither of which a player may do. A player still SEES the shelf
  // rows, because a book the server holds is why their seat needs nothing.
  // Each row opens its own journal — the book itself, in the sidebar's PDF
  // viewer — on any seat that can see that journal; a seat the Judge has not
  // shared it with gets the row and no button.
  const openable = (record) => !!game.journal.get(record.journalId)?.visible;
  const shelfRows = Object.entries(staged)
    .filter(([id]) => BOOKS[id])
    .map(
      ([id, record]) => `<div class="acks-extras-importer-reconnect-row acks-extras-importer-shelf-row" data-shelf-row="${esc(id)}">
        <div class="acks-extras-importer-reconnect-head">
          <strong>${esc(BOOKS[id].label)}</strong>
          ${openable(record) ? `<button type="button" data-shelf-open="${esc(record.journalId)}">${L("shelfOpen")}</button>` : ""}
          ${isGM ? `<button type="button" data-unshelve="${esc(id)}">${L("shelfRemove")}</button>` : ""}
        </div>
        <p class="notes" data-shelf-status="${esc(id)}">${L("shelfHeld", { name: esc(record.name ?? record.path) })}</p>
      </div>`,
    )
    .join("");
  // Two ways in, because a book does not have to be open here to belong on the
  // server: pick the files and they are read, checked and uploaded; or copy
  // them onto the host yourself and scan. Neither asks the seat to connect
  // first — staging is a property of the WORLD, and making it cost a
  // seat-local connect left a GM with no control at all on the rows of books
  // this browser had never opened.
  const shelfControls = isGM
    ? `<div class="acks-extras-importer-reconnect-head acks-extras-importer-band-actions">
         <input type="file" name="shelf-bulk" data-shelf-bulk accept="application/pdf" multiple>
         <span class="notes" data-shelf-bulk-status></span>
       </div>
       <p class="notes">${L("shelfBulkNote")}</p>
       ${notice ? `<p class="notes acks-extras-importer-shelf-notice">${esc(notice)}</p>` : ""}
       <div class="acks-extras-importer-reconnect-head acks-extras-importer-band-actions">
         <button type="button" data-shelf-scan>${L("shelfScanGo")}</button>
         <span class="notes" data-shelf-scan-status></span>
       </div>
       <p class="notes">${L("shelfScanNote", { dir: esc(SHELF_DIR) })}</p>`
    : "";
  // A full shelf is every book the reader owns, listed twice in one window —
  // once here and once in its own group below. Past a handful it collapses
  // behind its count, the same way the book groups do, so the controls under
  // it stay reachable without a scroll to the bottom.
  const staffCount = Object.keys(staged).filter((id) => BOOKS[id]).length;
  const shelfList = !shelfRows
    ? `<p class="notes">${L(isGM ? "shelfEmpty" : "shelfEmptyPlayer")}</p>`
    : staffCount > 4
      ? `<details class="acks-extras-importer-book-group"><summary>${L("shelfCount", { count: staffCount })}</summary>${shelfRows}</details>`
      : shelfRows;
  const shelfBand = `<section class="acks-extras-importer-band">
    <h4>${L("shelfHead")}</h4>
    ${shelfList}
    ${shelfRows ? `<p class="notes">${L("shelfJournalNote", { folder: esc(L("shelfFolder")) })}</p>` : ""}
    ${shelfControls}
  </section>`;

  /* ---- band 3: controls that answer for several books --------------- */

  // The folder button is ONE control doing both jobs: re-granting the folder
  // this seat already remembers, or choosing one for the first time. They were
  // two buttons in two dialogs, and the difference between them was never the
  // reader's to care about.
  const folderControl = dir
    ? `<button type="button" data-folder="reopen">${L("reconnectFolderGo")}</button>`
    : fsa
      ? `<button type="button" data-folder="pick">${L("connectFolderGo")}</button>`
      : `<input type="file" name="pdfdir" webkitdirectory>`;
  const localBand = closed.length
    ? `<section class="acks-extras-importer-band">
        <h4>${L("localHead")}</h4>
        <div class="acks-extras-importer-reconnect-head acks-extras-importer-band-actions">
          <button type="button" data-reconnect-all>${L("reconnectAllGo")}</button>
          <input type="file" name="pdf-all" data-bulk accept="application/pdf" multiple>
          ${folderControl}
        </div>
        <p class="notes" data-status-bulk>${L(dir ? "localNoteFolder" : "localNote", { name: esc(dir?.name ?? "") })}</p>
      </section>`
    : "";

  /* ---- band 4: one row per book ------------------------------------- */

  const control = (id, record) => {
    if (staged[id]) return ""; // the server answers for it; nothing to ask this seat
    if (!record) {
      // Never connected here. The row names the book, so a picker on it needs
      // no guessing at all — this is what the select used to be for.
      return fsa
        ? `<button type="button" data-pick="${esc(id)}">${L("booksConnectGo")}</button>`
        : `<input type="file" name="pdf-${esc(id)}" data-book="${esc(id)}" accept="application/pdf">`;
    }
    if (record.kind === "file") {
      return `<input type="file" name="pdf-${esc(id)}" data-book="${esc(id)}" accept="application/pdf">`;
    }
    return `<button type="button" data-book="${esc(id)}">${L(record.kind === "url" ? "reconnectRetry" : "reconnectGo")}</button>`;
  };
  // "Add to server" on a book that is NOT open here. The row names the book,
  // so the file it is handed needs no guessing — the same evidence a row-level
  // connect rests on, and the strongest available anywhere in this window.
  // Nothing is uploaded before the file has been read and identified, so a
  // wrong pick is refused rather than staged.
  const stage = (id) => {
    if (!isGM || staged[id]) return "";
    return fsa
      ? `<button type="button" data-shelve-pick="${esc(id)}">${L("shelfAdd")}</button>`
      : `<label class="acks-extras-importer-shelf-pick">${L("shelfAdd")}
           <input type="file" name="shelf-${esc(id)}" data-shelve-file="${esc(id)}" accept="application/pdf">
         </label>`;
  };
  const why = (record) => {
    if (record?.kind === "file") return L("reconnectFile", { name: esc(record.name ?? "") });
    if (record?.kind === "url") return L("reconnectUrlFailed", { where: esc(record.url) });
    return L("reconnectHandle", { where: esc(describeLocation(record)) });
  };
  const row = (id, book) => {
    const record = records.get(id);
    const scope = scopeOf(id) || L("booksNoScope");
    if (sessionDocs.has(id)) {
      const where = staged[id] ? L("shelfSource") : record ? ` [${esc(describeLocation(record))}]` : "";
      // Shelving is offered on a book that is OPEN, because the file has to
      // have been read before anything can vouch for what it is.
      const stage =
        isGM && !staged[id] ? `<button type="button" data-shelve="${esc(id)}">${L("shelfAdd")}</button>` : "";
      return `<div class="acks-extras-importer-reconnect-row acks-extras-importer-reconnect-done" data-row="${esc(id)}">
        <div class="acks-extras-importer-reconnect-head"><strong>${esc(book.label)}</strong>${stage}</div>
        <p class="notes" data-status="${esc(id)}">${L("booksOpen", { scope })}${where}</p>
      </div>`;
    }
    return `<div class="acks-extras-importer-reconnect-row" data-row="${esc(id)}">
      <div class="acks-extras-importer-reconnect-head">
        <strong>${esc(book.label)}</strong>
        ${control(id, record)}
        ${stage(id)}
      </div>
      <p class="notes" data-status="${esc(id)}">${record ? why(record) : L("booksAbsent", { scope })}</p>
    </div>`;
  };

  const groups = [
    ["booksWaiting", Object.entries(BOOKS).filter(([id]) => pending.includes(id)), true],
    ["booksOpenHead", Object.entries(BOOKS).filter(([id]) => sessionDocs.has(id)), false],
    ["booksAbsentHead", Object.entries(BOOKS).filter(([id]) => !sessionDocs.has(id) && !records.has(id)), false],
  ];
  // Waiting books stay expanded — they are the reason the window opened. The
  // other two collapse behind their count, which is what keeps a twenty-book
  // shelf from being a scroll to the bottom for one Unlock button.
  const bookBands = groups
    .filter(([, list]) => list.length)
    .map(
      ([key, list, open]) => `<details class="acks-extras-importer-book-group"${open ? " open" : ""}>
        <summary>${L(key, { count: list.length })}</summary>
        ${list.map(([id, book]) => row(id, book)).join("")}
      </details>`,
    )
    .join("");

  /* ---- the bridge line, and the console's fuller copy ---------------- */

  const windowMs = cacheWindowMs();
  const stamp = stampGet();
  const cached = await idbOp("readonly", (s) => s.getAllKeys(), IDB_BYTES).catch(() => []);
  const bridge = !windowMs
    ? "refresh bridge: off — every page reload re-picks"
    : `refresh bridge: ${windowMs / 1000}s window, ${cached?.length ?? 0} book(s) bridged` +
      (stamp ? `, stamped ${Math.round((Date.now() - stamp) / 1000)}s ago` : ", not stamped yet") +
      `; this page was away ${((performance.timeOrigin - stamp) / 1000).toFixed(1)}s before starting`;
  const stateOf = (id) =>
    sessionDocs.has(id)
      ? `OPEN this session${staged[id] ? " (from the shelf)" : ""}`
      : staged[id]
        ? `shelved [${staged[id].path}]`
        : records.has(id)
          ? `remembered [${describeLocation(records.get(id))}]`
          : "not connected";
  console.log(
    `${MODULE_ID} | book status (this seat):\n${Object.entries(BOOKS)
      .map(([id, b]) => `${b.label}: ${stateOf(id)}${scopeOf(id) ? ` — ${scopeOf(id)}` : ""}`)
      .join("\n")}\n${bridge}`,
  );

  return foundry.applications.api.DialogV2.prompt({
    // One row per book, so the height is the reader's library, not a constant:
    // scroll region from the dialog class, handle from `resizable`.
    window: { title: L("booksTitle"), resizable: true },
    classes: ["acks-ui", "acks-extras-importer-dialog", "acks-extras-importer-books"],
    position: { width: 520 },
    content: dialogContent(
      `${intro}${shelfBand}${localBand}
       <section class="acks-extras-importer-band">${bookBands}</section>
       <p class="notes acks-extras-importer-bridge">${esc(bridge)} · ${L("statusNote")}</p>
       <div class="acks-extras-importer-reconnect-head acks-extras-importer-band-actions">
         <button type="button" data-forget class="acks-extras-importer-danger">${L("forgetGo")}</button>
         <span class="notes" data-forget-status></span>
       </div>`,
    ),
    // Dismissing this is a legitimate answer ("not tonight"), not an error to
    // throw out of the ready hook.
    rejectClose: false,
    render: (event, dialog) => {
      capture(dialog);
      const root = dialog.element ?? dialog;
      const left = new Set(pending);
      const settle = (bookId, ok, message) => {
        const status = root.querySelector(`[data-status="${bookId}"]`);
        if (status) status.textContent = message;
        if (!ok) return;
        left.delete(bookId);
        root.querySelector(`[data-row="${bookId}"]`)?.classList.add("acks-extras-importer-reconnect-done");
        // Only the join-time offer gets out of the way by itself. Opened by
        // hand, this window is also the shelf and the import chain, and
        // closing it under the reader mid-task is not tidiness.
        if (autoClose && !left.size) dialog.close();
      };
      const say = (selector, text) => {
        const el = root.querySelector(selector);
        if (el) el.textContent = text;
      };
      /**
       * Build the window again, carrying the report of what just happened.
       *
       * Every band is a snapshot of the world as it was when the window
       * opened, so a book staged since then is in the wrong place in all of
       * them at once: absent from "On the server", still counted among the
       * books waiting for this seat, and describing itself as held on the
       * server from a row in another band. A GM who staged thirteen books saw
       * a server list of six and could only read that as failure. The report
       * travels into the new window rather than dying with the old one.
       */
      const rebuild = async (report = "") => {
        // AWAIT the close. The window is a singleton keyed on being open, and
        // an application asked for while the last one is still closing is
        // answered with the one that is going away: the slot only frees when
        // `close()` has actually finished, so a fire-and-forget close here
        // leaves the reader with no window at all.
        await dialog.close();
        await openBooksDialog({ notice: report });
      };

      /* -- band 1 ---------------------------------------------------- */

      root.querySelector("[data-gs-import]")?.addEventListener("click", () => runImportEverything(root));
      // Persists the moment it is toggled: a dialog closed via Escape or the
      // X never reads its form, and "don't show this again" must stick however
      // the reader leaves.
      root.querySelector("input[name=dismiss]")?.addEventListener("change", (ev) => {
        game.settings.set(MODULE_ID, SETTING_DISMISSED, ev.currentTarget.checked);
      });

      /* -- band 2: the shelf ----------------------------------------- */

      for (const button of root.querySelectorAll("button[data-shelf-open]")) {
        button.addEventListener("click", () => game.journal.get(button.dataset.shelfOpen)?.sheet.render(true));
      }

      for (const button of root.querySelectorAll("button[data-shelve]")) {
        button.addEventListener("click", async () => {
          const bookId = button.dataset.shelve;
          button.disabled = true;
          say(`[data-status="${bookId}"]`, L("shelfUploading"));
          try {
            const record = await shelveOpen(bookId);
            if (!record) throw new Error(L("shelfUploadFailed"));
            button.remove();
            await rebuild(L("shelfHeld", { name: record.name }));
          } catch (err) {
            console.error(`${MODULE_ID} | shelve ${bookId}`, err);
            say(`[data-status="${bookId}"]`, err.message);
            button.disabled = false;
          }
        });
      }

      // Staging a book this seat does NOT have open: from its own row, or
      // several at once from the shelf band. Both land in `stageFile`, which
      // reads and identifies the file here and uploads only what it accepted.
      const stageInto = async (bookId, file, control) => {
        if (control) control.disabled = true;
        say(`[data-status="${bookId}"]`, L("shelfUploading"));
        try {
          const record = await stageFile(bookId, file);
          settle(bookId, true, L("shelfHeld", { name: record.name }));
          root.querySelector(`[data-row="${bookId}"] button[data-shelve-pick]`)?.remove();
          root.querySelector(`[data-row="${bookId}"] .acks-extras-importer-shelf-pick`)?.remove();
          return true;

        } catch (err) {
          console.error(`${MODULE_ID} | add ${bookId} to the server`, err);
          say(`[data-status="${bookId}"]`, err.message || L("shelfUploadFailed"));
          if (control) control.disabled = false;
          return false;
        }
      };

      for (const button of root.querySelectorAll("button[data-shelve-pick]")) {
        button.addEventListener("click", async () => {
          const bookId = button.dataset.shelvePick;
          try {
            const [handle] = await window.showOpenFilePicker({
              multiple: false,
              types: [{ description: "PDF", accept: { "application/pdf": [".pdf"] } }],
            });
            if (await stageInto(bookId, await handle.getFile(), button)) await rebuild(L("shelfScanDone", { count: 1 }));
          } catch (err) {
            if (err?.name === "AbortError") return; // the reader closed the picker
            console.error(`${MODULE_ID} | add ${bookId} to the server`, err);
            say(`[data-status="${bookId}"]`, L("shelfUploadFailed"));
          }
        });
      }

      for (const input of root.querySelectorAll("input[type=file][data-shelve-file]")) {
        input.addEventListener("change", async () => {
          const file = input.files?.[0];
          if (file && (await stageInto(input.dataset.shelveFile, file, input))) {
            await rebuild(L("shelfScanDone", { count: 1 }));
          }
        });
      }

      const shelfBulk = root.querySelector("input[type=file][data-shelf-bulk]");
      shelfBulk?.addEventListener("change", async () => {
        const files = [...(shelfBulk.files ?? [])];
        if (!files.length) return;
        shelfBulk.disabled = true;
        say("[data-shelf-bulk-status]", L("shelfUploading"));
        // The files' own evidence decides: a name this seat remembers, a size
        // it has seen, or the book's title in the filename. A file that names
        // no book is never guessed at — it is reported by name, and that
        // book's own row takes it in one pick.
        const candidates = Object.keys(BOOKS).filter((id) => !shelf()[id]);
        const { matched, unmatched } = matchFilesToBooks(files, candidates, records);
        let added = 0;
        // Sequentially: several ACKS PDFs read at once is hundreds of
        // megabytes in flight, and each is parsed here before it is uploaded.
        for (const [bookId, file] of matched) if (await stageInto(bookId, file)) added++;
        shelfBulk.disabled = false;
        shelfBulk.value = "";
        const report = unmatched.length
          ? L("shelfBulkUnmatched", { count: added, files: unmatched.map((f) => f.name).join(", ") })
          : L("shelfScanDone", { count: added });
        if (added) await rebuild(report);
        else say("[data-shelf-bulk-status]", report);
      });

      for (const button of root.querySelectorAll("button[data-unshelve]")) {
        button.addEventListener("click", async () => {
          const bookId = button.dataset.unshelve;
          button.disabled = true;
          const record = shelf()[bookId];
          await shelfPut(bookId, null);
          // The journal goes with the entry. The FILE stays where it was put —
          // Foundry offers no delete, and a GM who wants the disk space back
          // needs to be told where to look rather than left assuming the
          // removal took it with it.
          await rebuild(L("shelfRemoved", { path: record?.path ?? SHELF_DIR }));
        });
      }

      const scanBtn = root.querySelector("[data-shelf-scan]");
      scanBtn?.addEventListener("click", async () => {
        scanBtn.disabled = true;
        say("[data-shelf-scan-status]", L("shelfScanning"));
        try {
          const { matched, unmatched, held, missing } = await scanShelf();
          if (missing) {
            say("[data-shelf-scan-status]", L("shelfNoDir", { dir: SHELF_DIR }));
            return;
          }
          let added = 0;
          // Sequentially: several ACKS PDFs parsed at once is hundreds of
          // megabytes in flight, and the shelf is read through the same
          // pdf.js path a local connect uses.
          for (const [bookId, file] of matched) {
            if (await shelvePath(bookId, file.path, { name: file.name })) added++;
          }
          const report = added
            ? L("shelfScanDone", { count: added })
            : unmatched.length
              ? L("shelfScanNone", { skipped: unmatched.length })
              : L("shelfScanHeld", { count: held.length });
          if (added) await rebuild(report);
          else say("[data-shelf-scan-status]", report);
        } catch (err) {
          console.error(`${MODULE_ID} | shelf scan`, err);
          say("[data-shelf-scan-status]", err.message);
        } finally {
          scanBtn.disabled = false;
        }
      });

      /* -- band 3: several books at once ----------------------------- */

      const reconnectBtn = root.querySelector("[data-reconnect-all]");
      reconnectBtn?.addEventListener("click", async () => {
        reconnectBtn.disabled = true;
        // The gesture goes FIRST. Transient activation lasts seconds, and
        // reading a book takes longer than that, so a permission asked for
        // after the silent pass is a permission asked for too late.
        let folderOpened = [];
        if (dir && left.size) {
          try {
            let perm = await dir.handle.queryPermission({ mode: "read" });
            if (perm === "prompt") perm = await dir.handle.requestPermission({ mode: "read" });
            if (perm === "granted") folderOpened = await reopenFromFolder(dir, records, settle);
          } catch (err) {
            console.warn(`${MODULE_ID} | reconnect all: folder`, err);
          }
        }
        // Then everything that needs no gesture at all: the shelf, served
        // paths, bridged bytes, and any handle whose permission still stands.
        await restoreShelf();
        const stillWaiting = await restoreBooks();
        for (const id of Object.keys(BOOKS)) {
          if (sessionDocs.has(id) && left.has(id)) settle(id, true, L("reconnectOpened"));
        }
        const blocked = stillWaiting.filter((id) => !sessionDocs.has(id));
        const opened = folderOpened.length + (pending.length - blocked.length);
        // "opened 0" reads as a failure on the seat where nothing was waiting,
        // which is the ordinary state of a seat whose books are on the server.
        say(
          "[data-status-bulk]",
          blocked.length
            ? L("reconnectAllPartial", { books: blocked.map((id) => BOOKS[id]?.label ?? id).join(", ") })
            : opened
              ? L("reconnectAllDone", { count: opened })
              : L("reconnectAllNothing"),
        );
        reconnectBtn.disabled = false;
      });

      const bulkInput = root.querySelector("input[type=file][data-bulk]");
      bulkInput?.addEventListener("change", async () => {
        const files = [...(bulkInput.files ?? [])];
        if (!files.length) return;
        bulkInput.disabled = true;
        // Match against every book NOT open, not merely the remembered ones:
        // this is now the way a seat connects for the first time as well as
        // the way it reconnects.
        const candidates = Object.keys(BOOKS).filter((id) => !sessionDocs.has(id));
        const { matched, unmatched } = matchFilesToBooks(files, candidates, records);
        let opened = 0;
        for (const [bookId, file] of matched) {
          try {
            await ingestBook(bookId, await file.arrayBuffer(), { cache: file });
            const record = records.get(bookId);
            if (record?.kind === "handle") {
              // Never downgrade a handle to a name-only record: the handle
              // still reopens with one click next session, which a re-picked
              // name never will. Refresh the size so a renamed copy can still
              // be matched by pass 2 next time.
              await locationPut(bookId, { ...record, size: file.size }).catch((err) =>
                console.warn(`${MODULE_ID} | could not update remembered location for ${bookId}`, err),
              );
            } else {
              await rememberFile(bookId, file);
            }
            opened++;
            settle(bookId, true, L("reconnectOpened"));
          } catch (err) {
            console.error(`${MODULE_ID} | connect ${bookId} from ${file.name}`, err);
            settle(bookId, false, err.wrongBook ? err.message : L("reconnectFailed"));
          }
        }
        bulkInput.disabled = false;
        bulkInput.value = "";
        // Naming what went unused is the difference between "it half worked"
        // and knowing the seat picked the wrong file, or one book too few.
        say(
          "[data-status-bulk]",
          unmatched.length
            ? L("reconnectAllUnmatched", { files: unmatched.map((f) => f.name).join(", ") })
            : L("reconnectAllDone", { count: opened }),
        );
      });

      const folderBtn = root.querySelector("button[data-folder]");
      folderBtn?.addEventListener("click", async () => {
        folderBtn.disabled = true;
        try {
          if (folderBtn.dataset.folder === "reopen") {
            let perm = await dir.handle.queryPermission({ mode: "read" });
            if (perm === "prompt") perm = await dir.handle.requestPermission({ mode: "read" });
            if (perm !== "granted") {
              say("[data-status-bulk]", L("reconnectFolderDenied"));
              return;
            }
            const opened = await reopenFromFolder(dir, records, settle);
            say("[data-status-bulk]", L("reconnectAllDone", { count: opened.length }));
            return;
          }
          // First await after the click: the picker spends the gesture.
          const picked = await window.showDirectoryPicker();
          const handles = await pdfHandlesIn(picked);
          if (!handles.length) {
            say("[data-status-bulk]", L("folderNoPdfs"));
            return;
          }
          const picks = [];
          for (const handle of handles) picks.push({ handle, file: await handle.getFile() });
          const done = await connectFolderPicks(picks, { remember: picked });
          say("[data-status-bulk]", L("reconnectAllDone", { count: done?.length ?? 0 }));
          for (const id of Object.keys(BOOKS)) {
            if (sessionDocs.has(id) && left.has(id)) settle(id, true, L("reconnectOpened"));
          }
        } catch (err) {
          if (err?.name === "AbortError") return; // dismissing the OS picker is an answer
          console.error(`${MODULE_ID} | folder connect`, err);
          say("[data-status-bulk]", L("reconnectFailed"));
        } finally {
          folderBtn.disabled = false;
        }
      });

      root.querySelector("input[name=pdfdir]")?.addEventListener("change", async (ev) => {
        const files = [...(ev.currentTarget.files ?? [])].filter((f) => /\.pdf$/i.test(f.name));
        if (!files.length) return void say("[data-status-bulk]", L("folderNoPdfs"));
        const done = await connectFolderPicks(files.map((file) => ({ file })));
        say("[data-status-bulk]", L("reconnectAllDone", { count: done?.length ?? 0 }));
      });

      /* -- band 4: one book at a time -------------------------------- */

      for (const button of root.querySelectorAll("button[data-book]")) {
        button.addEventListener("click", async () => {
          const bookId = button.dataset.book;
          button.disabled = true;
          // This click is the fresh gesture the browser was holding out for.
          const ok = await openRemembered(bookId, records.get(bookId), { interactive: true }).catch((err) => {
            console.error(`${MODULE_ID} | reconnect ${bookId}`, err);
            return false;
          });
          button.disabled = ok;
          settle(bookId, ok, ok ? L("reconnectOpened") : L("reconnectFailed"));
        });
      }

      // A book this seat has never opened, on a browser that can remember a
      // handle: pick its file through the picker so the location persists,
      // rather than through an input that can only ever remember a name.
      for (const button of root.querySelectorAll("button[data-pick]")) {
        button.addEventListener("click", async () => {
          const bookId = button.dataset.pick;
          button.disabled = true;
          try {
            const handles = await window.showOpenFilePicker({
              multiple: false,
              types: [{ description: "PDF", accept: { "application/pdf": [".pdf"] } }],
            });
            const handle = handles[0];
            const file = await handle.getFile();
            const done = await ingestPairs(new Map([[bookId, file]]), new Map([[file, { file, handle }]]));
            settle(bookId, !!done.length, done.length ? L("reconnectOpened") : L("reconnectFailed"));
          } catch (err) {
            if (err?.name !== "AbortError") {
              console.error(`${MODULE_ID} | connect ${bookId}`, err);
              settle(bookId, false, L("reconnectFailed"));
            }
          } finally {
            button.disabled = sessionDocs.has(bookId);
          }
        });
      }

      for (const input of root.querySelectorAll("input[type=file][data-book]")) {
        input.addEventListener("change", async () => {
          const bookId = input.dataset.book;
          const file = input.files?.[0];
          if (!file) return;
          input.disabled = true;
          try {
            // Bridged like every other read: this row exists for the seat that
            // cannot reopen a file by itself, which is the seat the refresh
            // bridge is for — dropping the cache here costs it the file picker
            // again on the very next reload.
            await ingestBook(bookId, await file.arrayBuffer(), { cache: file });
            await rememberFile(bookId, file); // may be a different copy than last time
            settle(bookId, true, L("reconnectOpened"));
          } catch (err) {
            console.error(`${MODULE_ID} | connect ${bookId}`, err);
            input.disabled = false;
            settle(bookId, false, err.wrongBook ? err.message : L("reconnectFailed"));
          }
        });
      }

      /* -- the footer ------------------------------------------------ */

      const forgetBtn = root.querySelector("[data-forget]");
      forgetBtn?.addEventListener("click", async () => {
        const confirmed = await foundry.applications.api.DialogV2.confirm({
          classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
          window: { title: L("forgetGo") },
          content: dialogContent(`<p>${L("forgetConfirm")}</p>`),
          rejectClose: false,
        });
        if (!confirmed) return;
        await forgetBooks();
        say("[data-forget-status]", L("forgetDone"));
      });
    },
    ok: {
      label: L("reconnectDone"),
      callback: () => {
        const still = pending.filter((id) => !sessionDocs.has(id));
        if (still.length) {
          ui.notifications.warn(
            L("reconnectIncomplete", { books: still.map((id) => BOOKS[id]?.label ?? id).join(", ") }),
          );
        }
      },
    },
  });
}

/**
 * Re-read every book a granted directory holds, settling each row as it lands.
 *
 * Shared by the folder button and by Reconnect all, which reaches for the
 * folder first precisely because it answers for the whole shelf on one
 * permission. Matches run against every book not open — a folder can reconnect
 * what was waiting AND connect a book this seat never named.
 */
async function reopenFromFolder(dir, records, settle) {
  const handles = await pdfHandlesIn(dir.handle);
  const byFile = new Map();
  for (const handle of handles) byFile.set(await handle.getFile(), handle);
  const candidates = Object.keys(BOOKS).filter((id) => !sessionDocs.has(id));
  const { matched } = matchFilesToBooks([...byFile.keys()], candidates, records);
  const opened = [];
  // Sequentially — several ACKS PDFs parsed at once is hundreds of megabytes
  // in flight.
  for (const [bookId, file] of matched) {
    try {
      await ingestBook(bookId, await file.arrayBuffer(), { cache: file });
      const handle = byFile.get(file);
      // The per-file handle is remembered too, so the per-row Unlock still
      // works next session even if the folder record is lost.
      await locationPut(bookId, { kind: "handle", handle, name: handle.name ?? null, size: file.size }).catch((err) =>
        console.warn(`${MODULE_ID} | could not remember ${bookId} from the folder`, err),
      );
      opened.push(bookId);
      settle?.(bookId, true, game.i18n.localize(`${LANG_PREFIX}.ui.reconnectOpened`));
    } catch (err) {
      console.error(`${MODULE_ID} | folder reconnect ${bookId} from ${file.name}`, err);
      settle?.(bookId, false, game.i18n.localize(`${LANG_PREFIX}.ui.reconnectFailed`));
    }
  }
  return opened;
}

/**
 * Reconnect on demand — retry the silent pass that runs on join (a plugged-in
 * drive, a restored network, or a book newly put on the shelf may answer it
 * now), then open the Books window whatever the outcome: a window showing
 * every book open IS the "all open" report, where the old toast left nothing
 * on screen to check it against.
 *
 * Three api names reach this one window, and they stay because macros already
 * imported into worlds call them: connectBook, reconnectBooks, bookStatus.
 */
async function reconnectBooks() {
  await restoreShelf();
  await restoreBooks();
  return openBooksDialog();
}

/** Which books this seat can read, and how much of each — the same window. */
async function bookStatus() {
  return openBooksDialog();
}

async function forgetBooks() {
  // The success toast is a claim about the clears, so each clear reports its
  // outcome instead of being swallowed — a failed IndexedDB clear must not
  // tell the GM the forget succeeded.
  let allCleared = true;
  const attempt = async (label, clear) => {
    try {
      await clear();
    } catch (err) {
      allCleared = false;
      console.warn(`${MODULE_ID} | forget books: ${label} could not be cleared`, err);
    }
  };
  await attempt("remembered locations", locationClear);
  // Forget means forget: the refresh bridge goes with the locations, or the
  // next reload would quietly reopen the very books that were just dropped.
  await attempt("bridged book bytes", bytesClear);
  await stampClear();
  // The SHELF is world data and is deliberately untouched: forgetting is a
  // statement about this browser, and a GM clearing their own seat must not
  // silently unstage the books every other seat reads.
  sessionDocs.clear();
  if (allCleared) {
    ui.notifications.info(`${MODULE_ID} | remembered book locations on this computer dropped; in-memory prose cleared. Books on the shelf are unaffected.`);
  } else {
    ui.notifications.warn(`${MODULE_ID} | some remembered book data could not be cleared — see the console. In-memory prose was cleared.`);
  }
}

/* -------------------------------------------- */
/*  Browse & load: pick a page, choose headings */
/* -------------------------------------------- */

const slug = (text) =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40);

function guessKind(bookId, mode) {
  if (mode === "runin") return "item";
  return bookId === "mm" ? "monster" : "ability";
}

async function browseAndLoad() {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates documents and world recipes).`);

  const options = Object.entries(BOOKS)
    .map(([id, b]) => `<option value="${id}">${b.label}${sessionDocs.has(id) ? " ✓ open" : ""}</option>`)
    .join("");
  const step1 = `
    <div class="form-group"><label>${game.i18n.localize(`${LANG_PREFIX}.ui.connectBook`)}</label>
      <select name="book">${options}</select></div>
    <div class="form-group"><label>${game.i18n.localize(`${LANG_PREFIX}.ui.browsePage`)}</label>
      <input type="number" name="page" min="1" step="1" placeholder="PDF page #"></div>
    <p class="notes">${game.i18n.localize(`${LANG_PREFIX}.ui.browseNote`)}</p>`;

  await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.localize(`${LANG_PREFIX}.ui.browseTitle`) },
    classes: ["acks-ui", "acks-extras-importer-dialog"],
    content: dialogContent(step1),
    ok: {
      label: game.i18n.localize(`${LANG_PREFIX}.ui.browseGo`),
      callback: async (event, button) => {
        const form = button.form;
        const bookId = form.elements.book.value;
        const page = parseInt(form.elements.page.value, 10);
        if (!Number.isFinite(page) || page < 1) return ui.notifications.warn(`${MODULE_ID} | enter a PDF page number.`);
        if (!sessionDocs.has(bookId)) {
          return ui.notifications.warn(
            `${MODULE_ID} | ${BOOKS[bookId].label} is not open this session — connect it first (PoC 2 / unlock dialog).`,
          );
        }
        return pickHeadings(bookId, page);
      },
    },
  });
}

async function pickHeadings(bookId, page) {
  const { doc, title } = sessionDocs.get(bookId);
  if (page > doc.numPages) return ui.notifications.warn(`${MODULE_ID} | page ${page} > ${doc.numPages}.`);
  const pageData = await pageItems(doc, page);
  const heads = listHeadings(pageData);
  if (!heads.length) return ui.notifications.warn(`${MODULE_ID} | no extraction anchors detected on PDF p. ${page}.`);

  const esc = foundry.utils.escapeHTML ?? ((s) => s);
  const rows = heads
    .map(
      (h, i) => `<label class="acks-extras-importer-browse-row">
        <input type="checkbox" name="sel" value="${i}">
        <span>${esc(h.text)}</span>
        <span class="acks-extras-importer-cite">${h.mode === "display" ? game.i18n.localize(`${LANG_PREFIX}.ui.modeDisplay`) : game.i18n.localize(`${LANG_PREFIX}.ui.modeRunin`)}</span>
      </label>`,
    )
    .join("");
  const kinds = ["auto", "monster", "ability", "item"]
    .map((k) => `<option value="${k}">${game.i18n.localize(`${LANG_PREFIX}.ui.kind.${k}`)}</option>`)
    .join("");
  const content = `
    <p class="notes">${game.i18n.format(`${LANG_PREFIX}.ui.browseFound`, { n: heads.length, book: BOOKS[bookId].label, page })}</p>
    <div class="acks-extras-importer-browse-list">${rows}</div>
    <div class="form-group"><label>${game.i18n.localize(`${LANG_PREFIX}.ui.kindLabel`)}</label>
      <select name="kind">${kinds}</select></div>`;

  return foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.format(`${LANG_PREFIX}.ui.browsePick`, { book: BOOKS[bookId].label, page }), resizable: true },
    classes: ["acks-ui", "acks-extras-importer-dialog"],
    position: { width: 480 },
    content: dialogContent(content),
    ok: {
      label: game.i18n.localize(`${LANG_PREFIX}.ui.browseLoad`),
      callback: async (event, button) => {
        const form = button.form;
        const kindChoice = form.elements.kind.value;
        const picked = [...form.querySelectorAll('input[name="sel"]:checked')].map((el) => heads[+el.value]);
        if (!picked.length) return ui.notifications.warn(`${MODULE_ID} | nothing selected.`);
        return loadHeadings(bookId, page, pageData, picked, kindChoice, title);
      },
    },
  });
}

async function loadHeadings(bookId, page, pageData, picked, kindChoice) {
  const dyn = foundry.utils.deepClone(dynamicRecipes());
  let created = 0;
  for (const head of picked) {
    const prose = head.mode === "runin" ? extractRunin(pageData, head.text) : extractDisplay(pageData, head.text);
    if (!prose) {
      ui.notifications.warn(`${MODULE_ID} | "${head.text}" extracted nothing — skipped.`);
      continue;
    }
    const name = head.text.replace(/:$/, "");
    const recipe = {
      id: `dyn.${bookId}.${page}.${slug(name)}`,
      book: bookId,
      page,
      mode: head.mode,
      heading: head.text,
      cite: `${bookId.toUpperCase()} PDF p. ${page}`,
      kind: kindChoice === "auto" ? guessKind(bookId, head.mode) : kindChoice,
      name,
      dynamic: true,
    };
    dyn[recipe.id] = recipe;
    const created0 = await createDocFor(recipe, prose);
    if (recipe.kind === "monster") await applyStatsToActor(created0, sessionDocs.get(bookId).doc, pageData, recipe);
    created++;
  }
  if (!created) return;
  await game.settings.set(MODULE_ID, SETTING_DYNAMIC, dyn);
  ui.notifications.info(game.i18n.format(`${LANG_PREFIX}.ui.browseDone`, { n: created, book: BOOKS[bookId].label, page }));
}

/* -------------------------------------------- */
/*  Stat setup (numbers → world actor data)     */
/* -------------------------------------------- */

/** Extract the page illustration from the GM's book and set it as actor+token
 *  art. NOTE the deliberate asymmetry with prose: art must render on every
 *  client's canvas, so it uploads into world data (acks-extras-art/) — a
 *  world asset sourced from the GM's own book, like a scan the GM saved. */
/**
 * Extract + upload a page illustration WITHOUT touching an actor — returns
 * `{path, width, height}` or null. The path-only half exists for the family
 * importer, whose art belongs to a template OPTION rather than the actor.
 * Name-first: with the wasm decoders shipped, the placed XObject itself
 * extracts cleanly (the AX books' art is JPEG2000). The placement-box
 * page-render crop stays as a fallback for a seat whose decoders fail.
 */
const ART_DIR = "acks-extras-art";

/**
 * Filename → full path for everything already in the art directory, listed
 * ONCE per session.
 *
 * The reuse check used to browse the whole directory per actor. That is a
 * server round trip whose response grows with every import, taken hundreds of
 * times in a bulk run and serialized behind the other three import workers —
 * so a world whose art was entirely cached still spent minutes proving it. The
 * listing changes only when this seat uploads, and every upload updates the
 * map, so one listing is the whole truth for the run.
 */
let artListing = null;
function artIndex(FP) {
  // The PROMISE is cached, not the map: four import workers start together and
  // would otherwise each fire the listing this exists to fire once.
  artListing ??= (async () => {
    const map = new Map();
    // The retired module's directory first, so a picture re-extracted under
    // this module's name wins over the old copy of the same file.
    for (const dir of [LEGACY_ART_DIR, ART_DIR]) {
      try {
        const listing = await FP.browse("data", dir);
        for (const f of listing?.files ?? []) map.set(f.split("/").pop(), f);
      } catch {
        /* directory does not exist yet — an empty map, not a failure */
      }
    }
    return map;
  })();
  return artListing;
}

/**
 * The usable art file already on disk for a recipe id, or null.
 *
 * Shared with the importers so a re-import can skip the `art` OP entirely, not
 * merely the upload. That op walks the page's operator list to CHOOSE which
 * placed image to extract — measured at 1.8s for one Monstrous Manual creature
 * and 15s for another — and when the chosen image is already a file on disk
 * there is nothing left to choose. The upload cache alone never saved that
 * walk, so a world whose art was entirely cached still paid it per creature.
 *
 * A tiny file is a corrupt/aborted upload, and an unanswerable one is a file
 * deleted since the listing was taken — both are treated as absent rather than
 * handed to an actor as an image path that renders nothing. That check is why
 * skipping the op afterwards is safe: the caller is told "cached" only about a
 * file that really is there and really is usable.
 */
async function cachedArt(id) {
  const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
  const filename = `${String(id).replaceAll(".", "-")}.png`;
  const index = await artIndex(FP);
  const existing = index.get(filename);
  if (!existing) return null;
  const head = await fetch(existing, { method: "HEAD" }).catch(() => null);
  const size = parseInt(head?.headers?.get("content-length") ?? "0", 10);
  if (head?.ok && size >= 1024) return existing;
  index.delete(filename);
  return null;
}

async function uploadPageArt(doc, recipe) {
  const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
  const dir = ART_DIR;
  const filename = `${recipe.id.replaceAll(".", "-")}.png`;
  // Already imported? Reuse it — decode + upload is the expensive half of a
  // re-import.
  const existing = await cachedArt(recipe.id);
  if (existing) return { path: existing, width: 0, height: 0, cached: true };
  const index = await artIndex(FP);
  const art =
    (await extractPageArt(doc, recipe.page, recipe.name ?? null)) ??
    (recipe.box ? await extractPageArtRegion(doc, recipe.page, recipe.box) : null);
  if (!art) return null;
  await FP.createDirectory("data", dir).catch((err) =>
    console.debug(`${MODULE_ID} | art directory "${dir}" not created (it usually already exists)`, err),
  );
  const file = new File([art.blob], filename, { type: "image/png" });
  const res = await FP.upload("data", dir, file, {}, { notify: false });
  if (!res?.path) return null;
  index.set(filename, res.path); // the listing stays true without re-browsing
  return { path: res.path, width: art.width, height: art.height };
}

async function importArt(actor, doc, recipe) {
  try {
    const up = await uploadPageArt(doc, recipe);
    if (!up) {
      console.log(`${MODULE_ID} | ${actor.name}: no suitable illustration found on PDF p. ${recipe.page}.`);
      return false;
    }
    await actor.update({ img: up.path, "prototypeToken.texture.src": up.path });
    console.log(`${MODULE_ID} | ${actor.name}: art ${up.cached ? "reused" : `imported (${up.width}x${up.height})`} -> ${up.path}`);
    return true;
  } catch (err) {
    console.warn(`${MODULE_ID} | ${actor.name}: art import failed`, err);
    return false;
  }
}

async function applyStatsToActor(actor, doc, pageData, recipe) {
  const pairs = extractStatPairs(pageData);
  if (!pairs.length) return ui.notifications.warn(`${MODULE_ID} | ${recipe.name}: no stat rows found on PDF p. ${recipe.page}.`);
  const { system, extras, items, applied, unmapped } = mapPairs(pairs);

  // The entry's text goes to the visible APPEARANCE field
  // (extras.description.appearance) — the first field on the Description tab,
  // which is where the reader looks. Each target is written as ONE object/path
  // — never a parent object plus a dotted leaf of it in the same update() (that
  // ambiguity clobbered the write).
  const update = { [`flags.${MODULE_ID}.statPairs`]: pairs };
  // The Full Monster Sheet is acks-extras' own sheet, so the stat-block
  // channel is always available. The old fallback wrote the same prose to
  // system.details.biography instead; it can no longer be reached, and two
  // possible homes for one description is exactly what the channel split
  // existed to prevent.
  const prose = await extractRecipe(doc, recipe).catch(() => null);
  extras.description = {
    ...(extras.description ?? {}),
    appearance: bookText(prose ? [prose] : [], recipe.cite, { id: recipe.id }),
  };
  update[`flags.${MODULE_ID}.extras`] = extras;
  update.system = system;
  await actor.update(update);
  // Truthful diagnostics: verify the description actually landed.
  const back = actor.getFlag(MODULE_ID, "extras")?.description?.appearance;
  console.log(`${MODULE_ID} | ${actor.name}: description ${back ? "VERIFIED on actor" : "MISSING after write (!)"}`);

  // Spoils subsection -> spoil-flagged items (Full Monster Sheet Spoils tab).
  // Book weights are authoritative as printed (stored in 1/6-stone units).
  const spoils = extractSpoils(pageData).map((s) => ({
    name: s.name.charAt(0).toUpperCase() + s.name.slice(1),
    type: "item",
    img: DEFAULT_IMG.ITEM,
    system: { description: "", subtype: "item", quantity: { value: 1, max: 0 }, cost: s.cost, weight: 0, weight6: s.weight6 },
    flags: { [MODULE_ID]: { spoil: true, component: true, researchEffects: s.effects } },
  }));

  // Embedded attacks/abilities/spoils: replace previously minted ones (idempotent re-apply).
  const stale = actor.items.filter((i) => i.getFlag(MODULE_ID, "minted")).map((i) => i.id);
  if (stale.length) await actor.deleteEmbeddedDocuments("Item", stale);
  const embed = [...items, ...spoils];
  if (embed.length) {
    await actor.createEmbeddedDocuments(
      "Item",
      embed.map((i) => ({ ...i, flags: { ...(i.flags ?? {}), [MODULE_ID]: { ...(i.flags?.[MODULE_ID] ?? {}), minted: true } } })),
    );
  }

  const gotArt = await importArt(actor, doc, recipe);

  console.log(
    `${MODULE_ID} | ${actor.name}: stats [${applied.join(", ")}]; ${spoils.length} spoils${unmapped.length ? `; unmapped: ${unmapped.join(", ")}` : ""}`,
  );
  ui.notifications.info(
    `${MODULE_ID} | ${actor.name}: ${applied.length} stat fields, ${items.length} attack/ability items, ${spoils.length} spoils${gotArt ? ", art imported" : ""}, ${unmapped.length} labels stored raw (console has details).`,
  );
}

/** The monster recipe whose name matches an actor ("Griffon" or "Griffon (PoC)"). */
function monsterRecipeForActor(actor) {
  return (
    allRecipes().find(
      (r) =>
        r.kind === "monster" &&
        (actor.name === r.name || actor.name === `${r.name} (PoC)`),
    ) ?? null
  );
}

/** Fill one monster actor from its recipe's book (must be open this session). */
async function fillMonster(actor, recipe) {
  const session = sessionDocs.get(recipe.book);
  if (!session) {
    ui.notifications.warn(
      `${MODULE_ID} | ${BOOKS[recipe.book]?.label ?? recipe.book} is not open this session — connect it (PoC 2 / unlock) to fill ${actor.name}.`,
    );
    return false;
  }
  const pageData = await pageItems(session.doc, recipe.page);
  await applyStatsToActor(actor, session.doc, pageData, recipe);
  return true;
}

/**
 * Which monsters Apply Stats should act on.
 *
 * Selected tokens, plus any monster whose SHEET is open. A monster that has
 * never been placed on a scene has no token to select, which made the whole
 * feature unreachable for it — and an imported bestiary is mostly actors
 * nobody has dragged out yet. Opening the sheet is the natural way to say
 * "this one". Deduped, because an open sheet for a selected token is one
 * monster, not two.
 */
function applyStatsTargets() {
  const fromTokens = (canvas.tokens?.controlled ?? []).map((t) => t.actor);
  const open = [...(foundry.applications?.instances?.values?.() ?? []), ...Object.values(ui.windows ?? {})];
  const fromSheets = open.map((app) => app?.document ?? app?.object).filter((d) => d instanceof Actor);
  return [...new Set([...fromTokens, ...fromSheets].filter((a) => a?.type === ACTOR_TYPE.MONSTER))];
}

/**
 * Re-read stats from the connected book for the selected/open monsters.
 *
 * Never every monster in the world: this rewrites system data, so it acts on
 * what the GM pointed at and nothing else.
 */
async function applyStats() {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only.`);
  const selected = applyStatsTargets();
  if (!selected.length) {
    return ui.notifications.warn(
      `${MODULE_ID} | select a monster token or open its sheet first — Apply Stats targets only what you point at, never every monster.`,
    );
  }
  let touched = 0;
  const closed = new Set();
  const unknown = [];
  for (const actor of selected) {
    // A cookbook-imported monster knows exactly which entry it came from, so
    // ask it rather than guessing from its name. Before this, Apply Stats
    // resolved names against allRecipes() alone — the dozen hand-written PoC
    // recipes — so it could not touch ANY of the hundreds of monsters the
    // cookbook imports, with or without a token.
    const refilled = await refillMonster(actor).catch((err) => {
      console.error(`${MODULE_ID} | refill ${actor.name}`, err);
      return { ok: false, reason: "error" };
    });
    if (refilled?.ok) {
      touched++;
      continue;
    }
    if (refilled?.reason === "book-closed") {
      closed.add(BOOKS[refilled.book]?.label ?? refilled.book);
      continue;
    }
    if (refilled) continue; // ours, but this printing did not match — already logged
    const recipe = monsterRecipeForActor(actor);
    if (!recipe) {
      unknown.push(actor.name);
      continue;
    }
    if (await fillMonster(actor, recipe)) touched++;
  }
  if (closed.size) {
    ui.notifications.warn(`${MODULE_ID} | not open this session: ${[...closed].join(", ")} — connect to refill from it.`);
  }
  if (unknown.length) {
    ui.notifications.warn(
      `${MODULE_ID} | not from the cookbook and no recipe matches: ${unknown.slice(0, 5).join(", ")}${unknown.length > 5 ? ` (+${unknown.length - 5})` : ""}.`,
    );
  }
  if (touched) ui.notifications.info(`${MODULE_ID} | refilled ${touched} monster${touched === 1 ? "" : "s"} from your book.`);
}

/* -------------------------------------------- */
/*  Boot                                        */
/* -------------------------------------------- */

Hooks.once("init", () => {
  // Two importers writing one library race each other, so the merged one
  // yields: while the separate legacy module is still installed and enabled,
  // the built-in importer registers nothing and stays inert.
  if (legacyImporterActive()) {
    console.error(
      `${MODULE_ID} | the separate ${LEGACY_ID} module is still active; the built-in importer stays off until it is disabled.`,
    );
    return;
  }
  game.settings.register(MODULE_ID, SETTING_DYNAMIC, { scope: "world", config: false, type: Object, default: {} });
  // Judge-registered OSE sources. World-scoped rather than shipped: these are
  // other publishers' books, fingerprinted against the copy the Judge owns.
  registerOseSourceSetting();
  // The refresh bridge (see above). Client scope: how long a seat's own bytes
  // may survive its own reload is that seat's business, and the answer differs
  // between a GM on the host and a player on a phone tether.
  game.settings.register(MODULE_ID, SETTING_REFRESH_CACHE, {
    name: `${LANG_PREFIX}.cache.settingName`,
    hint: `${LANG_PREFIX}.cache.settingHint`,
    scope: "client",
    config: true,
    type: Number,
    range: { min: 0, max: 300, step: 10 },
    default: 60,
    onChange: (value) => {
      // Turning it off must take effect now, not at the next join — a reader
      // who changes their mind about bytes on disk means it.
      if (!Number(value)) {
        bytesClear().catch((err) =>
          console.warn(`${MODULE_ID} | bridged book bytes could not be cleared after disabling the refresh bridge`, err),
        );
        stampClear();
      }
    },
  });
  // The shelf's former home: books the SERVER holds were a world setting
  // before they were journals. Still registered so an upgraded world can be
  // read once and emptied (`migrateShelfSetting`); nothing else touches it.
  game.settings.register(MODULE_ID, SETTING_SHELF, { scope: "world", config: false, type: Object, default: {} });
  registerGettingStartedSettings();
  setWorker(`modules/${MODULE_ID}/vendor/pdfjs/pdf.worker.mjs`);
  setWasmUrl(`modules/${MODULE_ID}/vendor/pdfjs/wasm/`);
});

Hooks.once("ready", async () => {
  // Same yield as the init guard: a world still running the separate
  // legacy module keeps that module as the one writer of the library.
  if (legacyImporterActive()) {
    ui.notifications.error(game.i18n.localize(`${LANG_PREFIX}.ui.legacyActive`), { permanent: true });
    return;
  }

  // Possession model: a seat caches nothing of a book it read. Imported text
  // lives in the world documents the GM created, never in this browser.
  for (const key of LEGACY_LOCAL_KEYS) {
    if (localStorage.getItem(key) !== null) {
      localStorage.removeItem(key);
      console.log(`${MODULE_ID} | purged a legacy per-seat prose cache (${key}).`);
    }
  }

  // A world that ran the standalone module may still hold data under its
  // old flag scope; converge it onto this module's before anything reads
  // the shelf or the library.
  await migrateLegacyScope();
  // Then the shelf's own move: a world that recorded its staged books in the
  // setting gets a journal per book, once, before the restore below reads it.
  await migrateShelfSetting();

  initCookbook({ sessionDocs, importArtForPage: importArt, uploadPageArt, cachedArt });
  registerAbilityDirectoryButtons();
  await loadCookbook();
  const api = {
    connectBook, connectBookUrl, reconnectBooks, browseAndLoad, applyStats, bookStatus, forgetBooks,
    /** Put a book on the server from a File this seat holds: read here, checked here, uploaded only then. */
    stageBook: stageFile,
    cookbookImport, cookbookImportIds, cookbookImportMonsters, cookbookRemoveImports, cookbookImportAbilities, cookbookImportAbilitiesDialog, cookbookUpdateAbilities, cookbookFillCompanions, cookbookPruneAbilities,
    importAbility, cookbookDebug, cookbookCount,
    cookbookImportTables,
    cookbookImportJournals, cookbookImportRollTables, cookbookAudit, lastAudit,
    cookbookReimportShelf, reimportableShelves,
    /** The whole import chain, in dependency order — the "Import Everything" control. */
    importEverything: () => runImportEverything(),
    importEquipment, importAllEquipment, cookbookEquipmentIds, repairEquipmentAbilities,
    importWeapons, importArmor,
    importClasses, cookbookUpdateClasses, importTemplatePackages, importTraps, importVariations, importVehicles,
    gettingStarted: () => openBooksDialog({ firstRun: true }),
    // Importing another game's books (docs/importer/OSE.md). Separate entry points
    // because a third-party source is registered by the Judge rather than
    // shipped, so it never appears in the book list the rest of these use.
    oseRegister: registerOseSourceDialog,
    oseImport: oseBrowseDialog,
    oseCalibrate: oseCalibrateDialog,
    oseConvertAll,
    oseManual: oseManualDialog,
    oseImportBook: importOseBook,
    oseImportAreas: importOseAreas,
    /** Every authored book this seat has open — the OSE step of the import chain. */
    oseImportAuthored: importAuthoredOse,
    oseAuthoredBooks: authoredOseBooks,
    RECIPES, BOOKS,
  };
  acksExtras.importer = api;

  // Provide the ability-resolution contract (lib docs/API.md): other features
  // embed proficiency packages on hired actors through this, without naming
  // this feature.
  services.register("ability-provider", { resolve: resolveAbilities });
  console.log(
    `${MODULE_ID} | ready. Macros in the "ACKS Extras Macros" compendium (folders "Your Books" and "Import from your books"), or: acksExtras.importer.bookStatus() · acksExtras.importer.cookbookImport() · acksExtras.importer.cookbookImportAbilitiesDialog() · acksExtras.importer.cookbookUpdateAbilities() · acksExtras.importer.importClasses() · acksExtras.importer.cookbookUpdateClasses() · acksExtras.importer.browseAndLoad().`,
  );

  // Before anything reads bytes: decide whether this page load is a reload
  // inside the bridge window or a genuinely new session, and empty the bridge
  // if it is the latter. Nothing below may see stale bytes.
  await sweepCache();
  startCacheHeartbeat();

  // The shelf first: a book the server holds needs nothing from this seat, and
  // opening it before the per-seat restore keeps it out of the list of books
  // waiting for a gesture. Then reopen what this browser remembers, and offer
  // the window for whatever is left. A seat with nothing anywhere is
  // (probably) brand new and gets the same window with its walkthrough open —
  // one surface either way, never two stacked dialogs.
  await restoreShelf();
  const pending = await restoreBooks();
  if (pending.length) await openBooksDialog({ autoClose: true });
  else if (!sessionDocs.size && !(await locations()).size && !gettingStartedDismissed()) {
    await openBooksDialog({ firstRun: true });
  }
});
