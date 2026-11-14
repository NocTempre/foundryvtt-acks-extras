/**
 * The importer: the bring-your-own-book content streamer.
 *
 * What persists across sessions is the LOCATION of each seat's book (in
 * IndexedDB, per seat), never the book; a session that cannot open the PDF
 * imports nothing. What an import produces is written into world documents by
 * the GM who owns the book and persists there; reading an imported document
 * needs no book on any seat.
 *
 * A location is a file handle, a fetchable path, or the remembered NAME of the
 * file, which the join-time reconnect dialog offers back with a picker beside
 * it.
 *
 * A PDF staged under the Foundry data directory is the shelf: one JournalEntry
 * per book, its PDF page pointing at the staged file, read by every GM seat on
 * join with no gesture. The per-seat kinds are how a book is read the first
 * time and how its bytes reach the shelf. Design: docs/importer/MODEL.md.
 *
 * api (acksExtras.importer / game.modules.get("acks-extras").api.importer):
 *   bookStatus()     the import manager on its Books tab: every book's state, and its control
 *   connectBook()    the same tab (kept: already-imported macros call it)
 *   reconnectBooks() retry the silent reopen, then the same tab
 *   browseAndLoad()  GM: pick a page, choose headings, load actors/items
 *   applyStats()     fill monster actors from the connected book
 *   forgetBooks()    drop this computer's remembered locations (not the shelf)
 */
import { MODULE_ID, LANG_PREFIX, ACTOR_TYPE, DEFAULT_IMG } from "./constants.mjs";
import { bookText, CITE_CLASS, CITE_LINK_CLASS, sumsUpdate } from "./prose.mjs";
import { BOOKS, REGISTRY, bookIsForm, bookIsJudges, fingerprintWarning, identifyBook, parseCite, shelfBooksToOpen } from "./books.mjs";
import { matchFilesToBooks } from "./book-match.mjs";
import { readForm } from "../character-sheet/pdf/form.mjs";
import { RECIPES } from "./recipes.mjs";
import { openBook, useTypography, pageItems, extractRecipe, extractDisplay, extractRunin, extractSpoils, extractPageArt, extractPageArtRegion, extractPageGray, extractPageMap, listHeadings, setWorker, setWasmUrl } from "./extract.mjs";
import { sceneFrame, turnMatrix, pictureKey } from "./scene-binding.mjs";
import { TRACE_PITCH, storeyCrops, traceStoreys, traceWalls } from "./wall-trace.mjs";
import { extractStatPairs } from "./stats.mjs";
import { mapPairs } from "./stats-map.mjs";
import { naturalWeaponDamageMap, extraordinaryEdges } from "../monsters/natural-weapons.mjs";
import { createDocFor } from "./poc.mjs";
import { importTables, tableRecipeBooks, tableRecipeCount } from "./tables-binding.mjs";
import { progressBar } from "./progress.mjs";
import { assembleReadTables, applyReadTables } from "./tables-phases.mjs";
import {
  initCookbook, loadCookbook, cookbookImport, cookbookImportIds, cookbookImportMonsters, cookbookRemoveImports, cookbookImportAbilities, cookbookImportAbilitiesDialog, cookbookUpdateAbilities,
  cookbookFillCompanions, cookbookPruneAbilities, registerAbilityDirectoryButtons, importAbility, cookbookDebug,
  cookbookCount, refillMonster, resolveAbilities, proficiencyResolver,
  importEquipment, importAllEquipment, cookbookEquipmentIds,
  importWeapons, importArmor,
  importClasses, cookbookUpdateClasses, importTemplatePackages, importTraps, importSpells, importVariations, importVehicles, importMerchandise,
  cookbookImportJournals, cookbookImportPoiPlaces, cookbookImportMarketProfiles, cookbookImportFactions, cookbookImportRollTables, cookbookImportScenes, cookbookAudit, lastAudit, cookbookReimportShelf, reimportableShelves, cookbookReimportBook, reimportableBooks, cookbookReimportEntries,
  cookbookImportAdventures, bookCensus, cookbookReimportAdventure, adventureBooks, rebuildOptions, runRebuildPick,
  cookbookImportAdventureItems, cookbookImportLinks, cookbookReimportEverything,
} from "./cookbook.mjs";
import { registerGettingStartedSettings, runImportEverything, runImportStep, GM_STEPS, gettingStartedDismissed, SETTING_DISMISSED } from "./getting-started.mjs";
import { ImportManagerMenu, installImportManager, openImportManager } from "./apps/import-manager.mjs";
import { tokenArtSources, applyTokenArt, restoreTokenArt, hasTokenArtFlag } from "./token-art.mjs";
import { acksExtras } from "../namespace.mjs";
import * as services from "../lib/services.mjs";
import { escape as esc } from "../lib/util.mjs";
import { registerBookAdventureHooks } from "./book-adventure.mjs";

const SETTING_DYNAMIC = "dynamicRecipes";
const SETTING_REFRESH_CACHE = "refreshCacheSeconds";

/** Open PDFs this session: bookId -> { doc, title }. Memory only. */
const sessionDocs = new Map();

/* -------------------------------------------- */
/*  Remembered book locations (IndexedDB)       */
/* -------------------------------------------- */

/**
 * Where each book lives ON THIS SEAT, so the next session can offer to reopen
 * it. The location persists; the book's text never does.
 *
 * Three kinds, one per way a seat can reach its own PDF:
 *
 *   handle  a FileSystemFileHandle (Chromium on a secure origin). Reopens after
 *           the one permission click browsers require per page load.
 *   url     a path this seat can fetch (a copy staged on the host). The only
 *           kind that reconnects with no gesture.
 *   file    the identity of a file picked through <input type="file"> (name,
 *           size, mtime). No browser reopens it from storage, so it is a
 *           reminder: on join the exact file is named and a picker offered. It
 *           is the only kind available where the File System Access API is
 *           absent (an insecure origin, Firefox).
 */
const IDB_STORE = "bookHandles"; // every remembered book lives here; renaming it strands them
const IDB_BYTES = "bookBytes"; // refresh bridge only — swept on every join, see below
const IDB_VERSION = 2; // never lowered: opening below a seat's stored version throws
const TOUCH_KEY = "touched";

function idb() {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open(MODULE_ID, IDB_VERSION);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      // Additive and guarded per store: an existing bookHandles store survives untouched.
      for (const name of [IDB_STORE, IDB_BYTES]) {
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

/** A stored value as a location record, or null when it is not one of the kinds this module writes. */
function asLocation(value) {
  if (!value) return null;
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
    // A record for a book with no REGISTRY entry is not offered for reconnect, and is left in place.
    if (!REGISTRY[key]) {
      console.log(`${MODULE_ID} | remembered location for "${key}" ignored — no book of that id is read.`);
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
 * The remembered PARENT FOLDER, under a reserved key in the same store; it is
 * not a book record and is never surfaced as one. The directory handle re-grants
 * once and every book inside re-reads from it. `locationClear` sweeps it with
 * the rest of the store.
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
 * Books staged under `SHELF_DIR` in the Foundry data directory, each one a
 * JOURNAL in the world, so every GM seat reads it silently on join.
 *
 * The record is a JournalEntry, one per book, filed under the shelf folder and
 * stamped `flags[MODULE_ID].shelf = {book, name, size}`. Its single PDF page
 * points at the staged file; the page's `src` IS the shelf entry, read by
 * `shelf()` and fetched by the join-time restore. Deleting the journal takes
 * the book off the shelf; the file stays where it was put.
 *
 * The record is a PATH, never bytes: `connectBookUrl` fetches it like any other
 * served file, and an entry is written only after the file is connected and
 * fingerprinted, never on its filename.
 *
 * A file under the data directory is fetchable by any signed-in user who learns
 * its path, whatever the journal's ownership says.
 * See docs/importer/DECISIONS.md, "A book the server holds is a journal (2026-09-03)".
 */
const SHELF_FLAG = "shelf";
const SHELF_DIR = "acks-extras-books";

/** Every PDF in the shelf directory. Resolves null when the directory does not exist. */
async function shelfListing(FP) {
  try {
    const listing = await FP.browse("data", SHELF_DIR);
    return [...(listing?.files ?? [])];
  } catch {
    return null;
  }
}

const filePicker = () => foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;

/** The journal that holds one book on the shelf, or null. */
const shelfJournal = (bookId) => game.journal.find((j) => j.getFlag(MODULE_ID, SHELF_FLAG)?.book === bookId) ?? null;

/** The PDF page of a shelf journal — the one that carries the staged path. */
const shelfPage = (journal) => journal?.pages.find((p) => p.type === "pdf") ?? null;

/**
 * Whether this seat may read a shelved book: its PDF page is open to the user
 * at Observer, the test a citation applies too. A player's client holds every
 * shelf journal, withheld or not, so the journal's presence is no answer.
 */
const shelfReadable = (record) =>
  !!shelfPage(game.journal.get(record.journalId))?.testUserPermission(game.user, "OBSERVER");

/**
 * Open the shelved copy of a book at one PDF page — what a citation does when
 * it is pressed.
 *
 * The shelf journal's PDF page is rendered by core's own sheet, whose Load PDF
 * button builds a pdf.js viewer URL from the page's source. This builds the
 * same URL plus the page fragment; a viewer already open is moved by its hash
 * instead of reloaded. A book not on the shelf, or one this user may not
 * observe, is refused with a notice.
 *
 * @param {string} bookId register book id ("rr")
 * @param {number} pdfPage 1-based PDF page — the register's page, not the printed folio
 * @returns {Promise<boolean>} whether a viewer was opened at the page
 */
export async function openBookPage(bookId, pdfPage) {
  const label = REGISTRY[bookId]?.label ?? bookId;
  const journal = shelfJournal(bookId);
  const page = shelfPage(journal);
  if (!page?.src) {
    ui.notifications.warn(game.i18n.format(`${LANG_PREFIX}.ui.citeNoBook`, { book: label }));
    return false;
  }
  if (!page.testUserPermission(game.user, "OBSERVER")) {
    ui.notifications.warn(game.i18n.format(`${LANG_PREFIX}.ui.citeNoAccess`, { book: label }));
    return false;
  }
  const n = Math.max(1, Math.trunc(Number(pdfPage) || 1));
  const sheet = journal.sheet;
  // A viewer already open turns to the page; a closed one opens on it.
  if (sheet.rendered && typeof sheet.goToPage === "function") await sheet.goToPage(page.id);
  else await sheet.render({ force: true, pageId: page.id });
  const view = sheet.element?.querySelector?.(`.journal-entry-page[data-page-id="${page.id}"]`);
  const frame = view?.querySelector("iframe");
  if (frame) {
    try {
      frame.contentWindow.location.hash = `page=${n}`;
    } catch {
      frame.src = `${frame.src.replace(/#.*$/, "")}#page=${n}`;
    }
    return true;
  }
  const loader = view?.querySelector(".load-pdf");
  if (!loader) return false;
  const params = new URLSearchParams();
  params.append("file", URL.parse(page.src) ? page.src : foundry.utils.getRoute(page.src));
  const iframe = document.createElement("iframe");
  iframe.src = `scripts/pdfjs/web/viewer.html?${params}#page=${n}`;
  loader.replaceWith(iframe);
  return true;
}

/**
 * The book and PDF page a citation element names: a link carries its own
 * target; a plain reference names the book and folio only, which `parseCite`
 * turns back into a page.
 */
function citeTarget(el) {
  const book = el.dataset?.book;
  const page = Number(el.dataset?.page);
  if (book && Number.isInteger(page) && page > 0) return { book, page };
  return parseCite(el.textContent);
}

/**
 * Opens the cited page for every citation this module wrote. One listener on
 * the document, because the references live in sheets, journal pages and chat
 * cards this module does not render; in the capture phase, so core's own
 * `a[href]` listener never sees the click. A reference naming no shelvable
 * book, or one inside an open editor, is left alone.
 * See docs/importer/DECISIONS.md, "A citation click runs before core's hyperlink handler (2026-09-11)".
 */
function onCiteClick(event) {
  const el = event.target?.closest?.(`a.${CITE_LINK_CLASS}, p.${CITE_CLASS}`);
  if (!el || el.closest(".editor-content.ProseMirror")) return;
  const target = citeTarget(el);
  if (!target) return;
  event.preventDefault();
  event.stopPropagation();
  openBookPage(target.book, target.page).catch((err) => console.error(`${MODULE_ID} | could not open the cited page`, err));
}

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
 * stamp first, then by name, so a renamed folder is still found and an existing
 * one of that name is adopted. Stamped with the shelf flag, never the cookbook
 * one, so Remove Imports leaves it alone.
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
 * Writing means the book's journal: made if absent, otherwise updated in place
 * (the stamp, the title, and the PDF page's `src`, re-pointed so a second
 * staging never leaves two pages). Dropping deletes the journal and only the
 * journal. Reads `game.journal` at the moment of writing, so two GM seats
 * staging different books never make a twin.
 */
async function shelfPut(bookId, record) {
  const existing = shelfJournal(bookId);
  if (!record) {
    if (existing) await existing.delete();
    return shelf();
  }
  const label = REGISTRY[bookId]?.label ?? bookId;
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
  // Ownership stays at Foundry's default (the creating GM alone); a form is
  // created shared, since every player's export writes into it.
  const { OBSERVER, OWNER } = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  await game.journal.documentClass.create({
    name: label,
    folder: folder?.id ?? null,
    pages: [shelfPageData(label, record.path)],
    flags: { [MODULE_ID]: { [SHELF_FLAG]: stamp } },
    ...(bookIsForm(bookId) ? { ownership: { default: OBSERVER, [game.user.id]: OWNER } } : {}),
  });
  return shelf();
}

/**
 * Read a staged path into its book and shelve it once it proves to be that
 * book. Returns the shelf record, or null when the file was not what the path
 * claimed; `ingestBook` refuses a file that fingerprints as another book, and a
 * refusal leaves no entry behind.
 */
async function shelvePath(bookId, path, { name = null, size = 0 } = {}) {
  try {
    await connectBookUrl(bookId, path, { remember: false, bridge: false });
  } catch (err) {
    console.warn(`${MODULE_ID} | ${path} could not be shelved as ${REGISTRY[bookId]?.label ?? bookId}`, err);
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
 * holds.
 *
 * `FilePicker.browse` answers with paths and no sizes, so the size pass of
 * `matchFilesToBooks` never fires here and matching rests on the remembered
 * name and the book's own title in the filename; a stray PDF matches nothing
 * and is left alone.
 *
 * One pass belongs only to this directory and runs first: a file whose stem is
 * exactly a book id is that book, the convention `shelveUpload` writes
 * ("<bookId>.pdf"). A match only proposes a book; `shelvePath` lets the
 * fingerprint refuse a PDF named after the wrong book.
 * See docs/importer/DECISIONS.md, "A book the server holds asks nobody for anything (2026-08-21)".
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
    // A file whose stem names a book the shelf already holds is that book's own
    // file, not an unmatched one.
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
 * Put a book on the shelf from a file this seat holds, through the same
 * `FilePicker.upload` call the art importer uses.
 *
 * The shelf copy is always named `<bookId>.pdf`, which the scan's first pass
 * reads and which makes "is this book already up there?" answerable. Foundry
 * refuses to overwrite a non-media file, so a taken name is answered by reading
 * what is already there, and it is staged only if it fingerprints as this book.
 *
 * `verified` says the caller fingerprinted THESE bytes, so the entry is
 * recorded from the upload; an unverified upload is read back first.
 */
async function shelveUpload(bookId, file, { verified = false } = {}) {
  const FP = filePicker();
  await FP.createDirectory("data", SHELF_DIR).catch((err) =>
    console.debug(`${MODULE_ID} | shelf directory "${SHELF_DIR}" not created (it usually already exists)`, err),
  );
  const name = `${bookId}.pdf`;
  const taken = await shelfFile(name);
  if (taken) {
    // Size stays 0: nothing was uploaded, and the file up there is not necessarily this one.
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
 * Put a book that is OPEN on this seat onto the server. The server is asked
 * first, since a copy already up there needs no bytes from this seat; only when
 * the name is free are the bridged bytes uploaded, already fingerprinted.
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
 * book is open here.
 *
 * The fingerprint is read BEFORE the upload, since Foundry offers no delete:
 * `ingestBook` refuses a file that fingerprints as another book, and only what
 * it accepted is sent. Reading it also opens the book here.
 */
async function stageFile(bookId, file) {
  await ingestBook(bookId, await file.arrayBuffer(), { cache: file });
  return shelveUpload(bookId, file, { verified: true });
}

/**
 * Open every shelved book this seat may read: all of them on a GM seat, on a
 * player seat only what the Judge shared. Each is a fetch and a parse of the
 * whole PDF, so a seat never opens a book it may not read. Runs on join before
 * the per-seat restore, so a shelved book never waits for a gesture.
 */
async function restoreShelf() {
  const staged = shelf();
  const opened = [];
  for (const bookId of shelfBooksToOpen(staged, shelfReadable, (id) => sessionDocs.has(id))) {
    const record = staged[bookId];
    try {
      await connectBookUrl(bookId, record.path, { remember: false, bridge: false, silent: true });
      opened.push(bookId);
    } catch (err) {
      console.warn(`${MODULE_ID} | shelved ${REGISTRY[bookId]?.label ?? bookId} could not be read at ${record.path}`, err);
    }
  }
  if (opened.length) {
    console.log(`${MODULE_ID} | opened ${opened.length} book(s) from the shelf: ${opened.map((id) => REGISTRY[id].label).join(", ")}`);
  }
  return opened;
}

/* -------------------------------------------- */
/*  Refresh bridge (short-lived byte cache)     */
/* -------------------------------------------- */

/**
 * The refresh bridge: the bytes of an open book are cached across a page
 * reload, and only across the reload. Where no browser hands a picked file back
 * from storage (an insecure origin, Firefox), a reload would otherwise cost a
 * trip through the file picker per book.
 *
 *   • while a page with books open is alive it stamps the clock every 20s, and
 *     once more as it goes away;
 *   • the next page load compares that stamp against the moment IT started.
 *     Inside the window (`SETTING_REFRESH_CACHE`) the cached bytes are reopened
 *     with no gesture;
 *   • outside it, the bytes are deleted before anything else happens and the
 *     seat goes through the normal reconnect gesture.
 *
 * The stamp lives in localStorage, because it is written from `pagehide`, where
 * an async IndexedDB transaction never commits. The comparison is against
 * `performance.timeOrigin` (when this document started), not the time this code
 * runs, so the window measures how long the seat was away and not Foundry's boot.
 * Forget Books empties the cache.
 * See docs/importer/DECISIONS.md, "The refresh bridge: bytes may cross a reload, and nothing longer (2026-07-29)".
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
 * The stamp, read synchronously (see the refresh bridge note). A profile with
 * storage blocked throws on access, and a bridge that cannot stamp never hits.
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
}

/**
 * Stash the bytes this seat just read, so a reload inside the window is free.
 *
 * Takes the File/Blob the caller holds, not the ArrayBuffer given to the
 * reader: pdf.js transfers that buffer to its worker, leaving it detached.
 */
async function cacheBytes(bookId, blob) {
  if (!blob || !cacheWindowMs()) return;
  try {
    await bytesPut(bookId, blob);
    stampPut(Date.now());
  } catch (err) {
    // Over quota, private mode, a locked-down profile: the bridge must never take an opened book down.
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
    // Re-stashed through `cache`, so a second refresh in a row is bridged too.
    await ingestBook(bookId, await blob.arrayBuffer(), { silent: true, cache: blob });
    console.log(`${MODULE_ID} | ${REGISTRY[bookId]?.label ?? bookId} restored across a page reload — no gesture needed.`);
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
  // How long the seat was away: the old page's last stamp to this document's start.
  const away = performance.timeOrigin - stamp;
  // An ordinary reload yields a gap a few milliseconds negative; only a stamp
  // far ahead of this document means the clock moved.
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
 * Keeps the stamp current while this page is alive and books are open, so the
 * window is measured from the last heartbeat and not from the connect.
 */
function startCacheHeartbeat() {
  if (heartbeat) return;
  const touch = () => {
    if (!sessionDocs.size || !cacheWindowMs()) return;
    stampPut(Date.now());
  };
  heartbeat = setInterval(touch, CACHE_HEARTBEAT_MS);
  // pagehide covers reload, navigation, tab close and the back/forward cache;
  // its write must be synchronous.
  window.addEventListener("pagehide", touch);
  // pagehide is not guaranteed on mobile; hidden is the last moment such a page
  // is certain to get.
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
 * connectBook() is the normal path; this one serves hosted copies and
 * automated live tests.
 *
 * The file itself is never kept; what persists is the PATH, so the seat
 * reconnects itself on every future join. `{ remember: false }` leaves nothing
 * behind.
 *
 * `bridge` says whether the bytes are kept across a page reload; a shelved book
 * is refetched on every join, so the shelf passes false.
 * See docs/importer/DECISIONS.md, "A book the server holds is never bridged (2026-08-24)".
 *
 * `silent` opens the book without a progress bar or an "entries available"
 * notice (see `ingestBook`); a failure still warns.
 */
async function connectBookUrl(bookId, url, { remember = true, bridge = true, silent = false } = {}) {
  // Throws as well as warning: the shelf records a path only when this resolves.
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
  // Blob first, buffer from it: pdf.js detaches the array it is handed.
  const blob = await resp.blob();
  const hits = await ingestBook(bookId, await blob.arrayBuffer(), { silent, cache: bridge ? blob : null });
  // A path is the one location kind that reopens with no gesture.
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
 * Opening is an open and a fingerprint: nothing is extracted here; text is read
 * from the page an import names, at import time.
 *
 * `cache` is the File/Blob the caller read `buffer` from, when it still holds
 * one; it is bridged across page reloads (see the refresh bridge above).
 */
async function ingestBook(bookId, buffer, { silent = false, cache = null } = {}) {
  const entries = cookbookCount(bookId);
  // A silent open raises no bar and no notice; the caller reports the batch once.
  const bar = silent
    ? { note() {}, step() {}, finish() {} }
    : progressBar(game.i18n.format(`${LANG_PREFIX}.ui.progressReading`, { book: BOOKS[bookId]?.label ?? bookId }), 1);
  try {
    bar.note(game.i18n.localize(`${LANG_PREFIX}.ui.progressOpening`));
    const { doc, numPages, title } = await openBook(buffer);
    // A file that fingerprints as another book in the registry is never read
    // into this one; edition drift stays a warning (see identifyBook).
    // See docs/importer/DECISIONS.md, "Position is not evidence, and a file that is another book is refused (2026-08-11)".
    const actualId = identifyBook(numPages, title);
    if (actualId && actualId !== bookId) {
      await doc.destroy?.();
      const err = new Error(
        game.i18n.format(`${LANG_PREFIX}.ui.connectWrongBook`, {
          book: REGISTRY[bookId]?.label ?? bookId,
          actual: REGISTRY[actualId].label,
        }),
      );
      err.wrongBook = actualId;
      throw err;
    }
    // A printed copy of a form has the same pages and no fields; it is refused
    // here, before the shelf can upload it.
    if (bookIsForm(bookId)) {
      const { isForm, share } = await readForm(doc);
      if (!isForm) {
        await doc.destroy?.();
        throw new Error(
          game.i18n.format(`${LANG_PREFIX}.ui.connectNotForm`, { book: BOOKS[bookId].label, share: Math.round(share * 100) }),
        );
      }
    }
    const warning = fingerprintWarning(bookId, numPages, title);
    if (warning && !silent) ui.notifications.warn(`${MODULE_ID} | ${warning}`);
    // Tagged before anything reads a page: an untagged read uses the wrong size
    // ladder and leaves the book's ligatures encoded.
    useTypography(doc, bookId);
    sessionDocs.set(bookId, { doc, title });
    Hooks.callAll("acksExtras.bookOpened", bookId);
    // Bridged only once the book actually opened.
    await cacheBytes(bookId, cache);
    // A book nothing in this build reads yet says so, rather than counting 0.
    const book = BOOKS[bookId]?.label ?? bookId;
    const read = entries || allRecipes().some((r) => r.book === bookId) || tableRecipeBooks().has(bookId);
    const message = bookIsForm(bookId)
      ? game.i18n.format(`${LANG_PREFIX}.ui.bookOpenForm`, { book })
      : !read
        ? game.i18n.format(`${LANG_PREFIX}.ui.bookOpenNothing`, { book })
        : game.i18n.format(`${LANG_PREFIX}.ui.${entries === 1 ? "bookOpenOne" : "bookOpenMany"}`, { book, n: entries ?? 0 });
    if (silent) console.debug(message);
    else ui.notifications.info(message);
    return true;
  } finally {
    bar.finish();
  }
}

/**
 * Imports the rules TABLES from the connected books into the world, via the lib
 * subsystem's ruledata-import contract. GM-only (it writes world data); other
 * features read the result from the lib's tables registry.
 *
 * The run has two phases. `read` reads the pages and assembles the engine
 * tables into the store; it writes no importer document. `apply` writes the
 * documents the read tables build (races, class builds, armour limits,
 * languages), and reads no page. The import chain runs the read first and the
 * apply after the classes (getting-started.mjs).
 *
 * @param {string[]} [only] ruledata document ids to read; omitted, every one.
 * @param {object} [opts]
 * @param {object|null} [opts.repair] a tally (`repairTally`) counting the
 *        language and race items this run writes over in place.
 * @param {"both"|"read"|"apply"} [opts.phase] `both` reads, then applies what
 *        it read.
 * @param {object|null} [opts.read] the report a `read` call returned, which
 *        `apply` applies; with none, `apply` writes nothing.
 * @returns {Promise<object|null>} the read report; `apply` returns the one it
 *        was handed. Null when the GM or provider guard refused or the read threw.
 */
async function cookbookImportTables(only = null, { repair = null, phase = "both", read = null } = {}) {
  if (!game.user.isGM) {
    ui.notifications.warn(game.i18n.localize(`${LANG_PREFIX}.tables.gmOnly`));
    return null;
  }
  if (phase === "apply") {
    if (read?.imported?.length) await applyReadTables(read.imported.map((d) => d.docId), { repair });
    return read;
  }
  if (!services.get("ruledata-import")) {
    ui.notifications.error(game.i18n.localize(`${LANG_PREFIX}.tables.noProvider`));
    return null;
  }
  let report;
  const bar = progressBar(game.i18n.localize(`${LANG_PREFIX}.ui.progressTables`), tableRecipeCount(only));
  try {
    report = await importTables(sessionDocs, { onProgress: (name) => bar.step(name), only });
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
  // A supplement this seat does not hold is information, not a fault.
  if (report.optionalBooks?.length) {
    ui.notifications.info(
      game.i18n.format(`${LANG_PREFIX}.tables.optionalBooks`, { books: report.optionalBooks.join(", ") }),
    );
  }
  // A table whose book is open and still would not read is the fault worth a
  // toast; the reason for each stays in the console report below.
  if (report.missingTables.length) {
    const ids = report.missingTables.map((t) => String(t).split(" (")[0]);
    ui.notifications.warn(
      game.i18n.format(`${LANG_PREFIX}.tables.unread`, {
        n: ids.length,
        tables: ids.length > 5 ? `${ids.slice(0, 5).join(", ")}, …` : ids.join(", "),
      }),
    );
  }
  // A table that read but lacks rows stores a placeholder no lookup matches; name the tables and how many rows.
  if (report.incomplete?.length) {
    ui.notifications.warn(
      game.i18n.format(`${LANG_PREFIX}.tables.incomplete`, {
        tables: report.incomplete.map((t) => `${t.docId}.${t.tableId} (${t.rows.length})`).join(", "),
      }),
    );
  }
  const docIds = report.imported.map((d) => d.docId);
  await assembleReadTables(docIds);
  console.log(`${MODULE_ID} | table import`, report);
  if (phase === "both") await applyReadTables(docIds, { repair });
  return report;
}

const fsaAvailable = () => typeof window.showOpenFilePicker === "function";

/* -------------------------------------------- */
/*  Dialog markup                               */
/* -------------------------------------------- */

/**
 * Wraps `html` in an attribute-less `<div>`, the one form DialogV2 uses
 * verbatim. A STRING `content` goes through `foundry.utils.cleanHTML`, which
 * copies only allowlisted attributes (`accept` is on no list, `multiple` is not
 * allowed on `<input>`), so a multi-file picker would arrive as a single-file
 * one. Every DialogV2 in this module is built through here. A function
 * declaration, so a sibling can import it across the module cycle.
 */
export function dialogContent(html) {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
}

/**
 * Alias kept for macros that call it by this name; opens the import manager on
 * its Books tab.
 */
const connectBook = () => openBooksDialog();

/**
 * Read each paired file into its book and remember where it came from.
 *
 * Each book is remembered in the strongest form this seat supports: the FSA
 * handle when the pick came through `showOpenFilePicker`, name-only otherwise.
 *
 * Reads are sequential, to bound the PDFs in memory. One file that fails to
 * open is reported against its own book and costs the others nothing; a file
 * refused for being another book says so.
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
          : `${REGISTRY[bookId].label}: ${game.i18n.localize(`${LANG_PREFIX}.ui.reconnectFailed`)}`,
      );
      continue;
    }
    done.push(REGISTRY[bookId].label);
    // Remembering is reported as its own outcome: the book is open either way.
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
 * Reopen ONE remembered book. Returns whether this seat can now read it; each
 * kind's failure is logged as itself.
 *
 * `interactive` is the caller promising it holds a fresh user gesture, the only
 * state in which a browser re-grants file permission.
 */
async function openRemembered(bookId, record, { interactive = false } = {}) {
  if (sessionDocs.has(bookId)) return true;
  const label = REGISTRY[bookId]?.label ?? bookId;

  // A page just reloaded still has its bridged bytes, for every kind including `file`.
  if (await openCached(bookId)) return true;

  // A served path needs no permission and no gesture.
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

  // Identity only: the reconnect dialog names the file and offers the picker.
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
    // Expected on every reload: browsers drop file permission with the page, so
    // a remembered book is "prompt" until the reconnect dialog's gesture re-grants it.
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
 * and capped at 200, so pointing at a whole drive is not a filesystem crawl.
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
 * A folder is a GROUP, so only evidence places a file (remembered name, byte
 * size, or the book's title in the filename); no positional fallback runs.
 * Unrecognised PDFs are normal in a folder, so they are counted in the toast
 * and named only on the console.
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
        books: [...sessionDocs.keys()].map((id) => REGISTRY[id]?.label ?? id).join(", "),
      }),
    );
  }
  const byFile = new Map(picks.map((pick) => [pick.file, pick]));
  const { matched, unmatched } = matchFilesToBooks([...byFile.keys()], candidates, await locations());
  // Remembered even when nothing matched yet: the group reconnect re-scans on every use.
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
 * "Your ACKS Books": the Books tab of the import manager. Every entry point
 * (the macros, the join-time offer, the sheet's book link) opens the manager on
 * this tab; the panel is built here, where the seat's books, shelf and file
 * handles are, and handed to the manager as `{html, wire}`.
 *
 * A ROW names one book, carries one control and acts the moment it is used; no
 * positional pairing of files to books exists, so evidence places a file or
 * nothing does.
 *
 * Four bands, in the order a seat needs them:
 *
 *   1. the first-run walkthrough, open on a seat with nothing connected and
 *      collapsed once there is;
 *   2. the shelf, the books the SERVER holds;
 *   3. this computer, the controls that answer for SEVERAL books at once;
 *   4. the books themselves, grouped by what each one needs.
 *
 * Re-granting file permission consumes the user activation that authorized it,
 * so one click unlocks one handle: each waiting book keeps its own Unlock, and
 * "Reconnect all" spends its single gesture on the remembered FOLDER when there
 * is one. A plain file picker grants no persistent permission and consumes
 * nothing, so "Pick PDFs…" answers for the whole shelf at once.
 *
 * @param {object} [options]
 * @param {boolean} [options.firstRun] open the walkthrough whatever the seat holds
 * @param {string} [options.notice] the report of what just happened, shown in the shelf band
 * @returns {Promise<{html: string, wire: function(Element, {rerender: function(string=): void}): void}>}
 *   the panel's markup, and the listeners that make it work once it is in the
 *   page; `rerender(report)` asks the host to build the panel again
 */
async function booksPanel({ firstRun = false, notice = "" } = {}) {
  const records = await locations();
  const staged = shelf();
  const dir = fsaAvailable() ? await dirGet() : null;
  const isGM = game.user.isGM;
  const fsa = fsaAvailable();
  const L = (key, data) =>
    data ? game.i18n.format(`${LANG_PREFIX}.ui.${key}`, data) : game.i18n.localize(`${LANG_PREFIX}.ui.${key}`);
  const G = (key, data) =>
    data ? game.i18n.format(`${LANG_PREFIX}.gs.${key}`, data) : game.i18n.localize(`${LANG_PREFIX}.gs.${key}`);

  const pending = Object.keys(BOOKS).filter((id) => records.has(id) && !sessionDocs.has(id));
  const closed = Object.keys(BOOKS).filter((id) => !sessionDocs.has(id));

  // What a connection unlocks: the scope figures of a book, on its row.
  const scopeOf = (id) => {
    const entries = cookbookCount(id);
    const recipes = allRecipes().filter((r) => r.book === id).length;
    return [entries ? `${entries} cookbook entr${entries === 1 ? "y" : "ies"}` : "", recipes ? `${recipes} recipe(s)` : ""]
      .filter(Boolean)
      .join(" + ");
  };

  /* ---- band 1: the first-run walkthrough ---------------------------- */

  // Open when this seat has nothing at all and has not dismissed it.
  const nothingYet = !sessionDocs.size && !records.size && !Object.keys(staged).length;
  const startOpen = (firstRun || nothingYet) && !gettingStartedDismissed();
  const gmBand = isGM ? `<h4>${G("gmHead")}</h4><p>${G("gmBody")}</p>` : "";
  const intro = `<details class="acks-extras-importer-gs"${startOpen ? " open" : ""}>
    <summary>${G("title")}</summary>
    <p>${G("intro")}</p>
    ${gmBand}
    <label class="acks-extras-importer-gs-dismiss">
      <input type="checkbox" name="dismiss"${gettingStartedDismissed() ? " checked" : ""}> ${G("dismiss")}
    </label>
  </details>`;

  /* ---- band 2: the shelf -------------------------------------------- */

  // Staging is GM-only (it uploads to the data directory). A player still sees
  // the shelf rows, each saying whether this seat reads the book or the Judge
  // has not shared it; a row's journal button shows only where the journal is visible.
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
        <p class="notes" data-shelf-status="${esc(id)}">${L(shelfReadable(record) ? "shelfHeld" : "shelfWithheld", { name: esc(record.name ?? record.path) })}</p>
      </div>`,
    )
    .join("");
  // Two ways in, neither needing a seat-local connect first: pick the files to
  // be read, checked and uploaded, or copy them onto the host and scan.
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
  // Past a handful the shelf list collapses behind its count, as the book groups do.
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

  // One control for both jobs: re-granting the remembered folder, or choosing one.
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
      // Never connected here; the row names the book the picker reads.
      return fsa
        ? `<button type="button" data-pick="${esc(id)}">${L("booksConnectGo")}</button>`
        : `<input type="file" name="pdf-${esc(id)}" data-book="${esc(id)}" accept="application/pdf">`;
    }
    if (record.kind === "file") {
      return `<input type="file" name="pdf-${esc(id)}" data-book="${esc(id)}" accept="application/pdf">`;
    }
    return `<button type="button" data-book="${esc(id)}">${L(record.kind === "url" ? "reconnectRetry" : "reconnectGo")}</button>`;
  };
  // "Add to server" on a book that is not open here; nothing is uploaded before
  // the file has been read and identified.
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
  // What the library holds of each open adventure book's Adventure; only a GM row says.
  const census = new Map();
  if (isGM) {
    for (const id of Object.keys(BOOKS)) {
      if (sessionDocs.has(id) && bookIsJudges(id)) census.set(id, await bookCensus(id).catch(() => null));
    }
  }
  const adventureLine = (id) => {
    const held = census.get(id);
    if (!held) return "";
    const said = held.adventure?.contents ? L("booksAdventure", held.adventure.contents) : L(held.adventure ? "booksAdventureHeld" : "booksAdventureNone");
    return `<p class="notes" data-adventure="${esc(id)}">${said}</p>`;
  };
  const row = (id, book) => {
    const record = records.get(id);
    const scope = scopeOf(id) || L("booksNoScope");
    if (sessionDocs.has(id)) {
      const where = staged[id] ? L("shelfSource") : record ? ` [${esc(describeLocation(record))}]` : "";
      // Shelving is offered on an open book, whose file has already been identified.
      const stage =
        isGM && !staged[id] ? `<button type="button" data-shelve="${esc(id)}">${L("shelfAdd")}</button>` : "";
      return `<div class="acks-extras-importer-reconnect-row acks-extras-importer-reconnect-done" data-row="${esc(id)}">
        <div class="acks-extras-importer-reconnect-head"><strong>${esc(book.label)}</strong>${stage}</div>
        <p class="notes" data-status="${esc(id)}">${bookIsForm(id) ? L("booksOpenForm") : L("booksOpen", { scope })}${where}</p>
        ${adventureLine(id)}
      </div>`;
    }
    return `<div class="acks-extras-importer-reconnect-row" data-row="${esc(id)}">
      <div class="acks-extras-importer-reconnect-head">
        <strong>${esc(book.label)}</strong>
        ${control(id, record)}
        ${stage(id)}
      </div>
      <p class="notes" data-status="${esc(id)}">${record ? why(record) : bookIsForm(id) ? L("booksAbsentForm") : L("booksAbsent", { scope })}</p>
    </div>`;
  };

  const groups = [
    ["booksWaiting", Object.entries(BOOKS).filter(([id]) => pending.includes(id)), true],
    ["booksOpenHead", Object.entries(BOOKS).filter(([id]) => sessionDocs.has(id)), false],
    ["booksAbsentHead", Object.entries(BOOKS).filter(([id]) => !sessionDocs.has(id) && !records.has(id)), false],
  ];
  // Waiting books stay expanded; the other two collapse behind their count.
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
      // The away figure belongs to the join-time sweep (sweepCache); measured here it is meaningless.
      (stamp ? `, stamped ${Math.round((Date.now() - stamp) / 1000)}s ago` : ", not stamped yet");
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

  const html = `<div class="acks-extras-importer-books" data-books-panel>
      ${intro}${shelfBand}${localBand}
      <section class="acks-extras-importer-band">${bookBands}</section>
      <p class="notes acks-extras-importer-bridge">${esc(bridge)} · ${L("statusNote")}</p>
      <div class="acks-extras-importer-reconnect-head acks-extras-importer-band-actions">
        <button type="button" data-forget class="acks-extras-importer-danger">${L("forgetGo")}</button>
        <span class="notes" data-forget-status></span>
      </div>
    </div>`;

  return {
    html,
    wire: (host, { rerender }) => {
      // Scoped to the panel: the manager's other tabs carry a `data-book` button too.
      const root = host.querySelector("[data-books-panel]") ?? host;
      const left = new Set(pending);
      const settle = (bookId, ok, message) => {
        const status = root.querySelector(`[data-status="${bookId}"]`);
        if (status) status.textContent = message;
        if (!ok) return;
        left.delete(bookId);
        root.querySelector(`[data-row="${bookId}"]`)?.classList.add("acks-extras-importer-reconnect-done");
      };
      const say = (selector, text) => {
        const el = root.querySelector(selector);
        if (el) el.textContent = text;
      };
      /**
       * Builds the panel again, carrying the report of what just happened. Every
       * band is a snapshot taken at build time, so a change to the shelf needs a
       * rebuild of all of them.
       */
      const rebuild = async (report = "") => rerender(report);

      /* -- band 1 ---------------------------------------------------- */

      // Persists on toggle: a dialog closed by Escape or the X never reads its form.
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

      // Staging a book this seat does not have open, from its own row or several
      // at once from the shelf band; both land in `stageFile`.
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
        // The files' own evidence decides (remembered name, seen size, or the
        // book's title in the filename); a file that names no book is reported by name.
        const candidates = Object.keys(BOOKS).filter((id) => !shelf()[id]);
        const { matched, unmatched } = matchFilesToBooks(files, candidates, records);
        let added = 0;
        // Sequential, to bound the PDFs in memory.
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
          // The journal goes with the entry; the file stays, and the report names its path.
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
          // Sequential, to bound the PDFs in memory.
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
        // The gesture goes first: transient activation lasts seconds, less than
        // a book read takes.
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
        // Then everything that needs no gesture: the shelf, served paths, bridged
        // bytes, and any handle whose permission still stands.
        await restoreShelf();
        const stillWaiting = await restoreBooks();
        for (const id of Object.keys(BOOKS)) {
          if (sessionDocs.has(id) && left.has(id)) settle(id, true, L("reconnectOpened"));
        }
        const blocked = stillWaiting.filter((id) => !sessionDocs.has(id));
        const opened = folderOpened.length + (pending.length - blocked.length);
        // A seat with nothing waiting (its books are on the server) gets its own "nothing" message.
        say(
          "[data-status-bulk]",
          blocked.length
            ? L("reconnectAllPartial", { books: blocked.map((id) => REGISTRY[id]?.label ?? id).join(", ") })
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
        // Matched against every book not open, not only the remembered ones: this
        // is also how a seat connects for the first time.
        const candidates = Object.keys(BOOKS).filter((id) => !sessionDocs.has(id));
        const { matched, unmatched } = matchFilesToBooks(files, candidates, records);
        let opened = 0;
        for (const [bookId, file] of matched) {
          try {
            await ingestBook(bookId, await file.arrayBuffer(), { cache: file });
            const record = records.get(bookId);
            if (record?.kind === "handle") {
              // Never downgrade a handle to a name-only record; refresh the size so
              // a renamed copy still matches next time.
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
        // Names the files that went unused.
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
      // handle: the picker is used so the location persists.
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
            // Bridged like every other read: this row serves the seat the refresh bridge is for.
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
  };
}

/**
 * Open the import manager on its Books tab. `opts` is `booksPanel`'s: the
 * first-run walkthrough, or a notice to carry into the panel. Every seat may
 * open it; a seat that is not a GM sees this tab alone. Resolves to the window.
 */
const openBooksDialog = (opts = {}) => openImportManager({ tab: "books", ...opts });

/**
 * Re-read every book a granted directory holds, settling each row as it lands.
 * Shared by the folder button and Reconnect all. Matches run against every book
 * not open, so a folder can also connect a book this seat never named.
 */
async function reopenFromFolder(dir, records, settle) {
  const handles = await pdfHandlesIn(dir.handle);
  const byFile = new Map();
  for (const handle of handles) byFile.set(await handle.getFile(), handle);
  const candidates = Object.keys(BOOKS).filter((id) => !sessionDocs.has(id));
  const { matched } = matchFilesToBooks([...byFile.keys()], candidates, records);
  const opened = [];
  // Sequential, to bound the PDFs in memory.
  for (const [bookId, file] of matched) {
    try {
      await ingestBook(bookId, await file.arrayBuffer(), { cache: file });
      const handle = byFile.get(file);
      // The per-file handle is remembered too, for the per-row Unlock.
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
 * Reconnect on demand: retries the silent pass that runs on join, then opens
 * the Books tab whatever the outcome.
 *
 * Three api names reach this one tab and are kept for macros that call them:
 * connectBook, reconnectBooks, bookStatus.
 */
async function reconnectBooks() {
  await restoreShelf();
  await restoreBooks();
  return openBooksDialog();
}

/** Which books this seat can read, and how much of each — the same tab. */
async function bookStatus() {
  return openBooksDialog();
}

/**
 * Drops this computer's remembered book locations, the bridged bytes and the
 * open books, and notifies what was cleared. The shelf is world data and is
 * untouched.
 * See docs/importer/DECISIONS.md, "A book the server holds asks nobody for anything (2026-08-21)".
 */
async function forgetBooks() {
  // The success toast reflects each clear's outcome.
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
  // The bridge goes with the locations, or the next reload would reopen the dropped books.
  await attempt("bridged book bytes", bytesClear);
  await stampClear();
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

/**
 * GM only: prompts for a book and a PDF page, lets the GM choose headings on it,
 * and loads each as an actor or item (see `pickHeadings`, `loadHeadings`).
 */
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

/** The world data directory page and scene art uploads into; art must render on every client's canvas. */
const ART_DIR = "acks-extras-art";

/**
 * Filename → full path for everything already in the art directory, listed once
 * per session. The listing changes only when this seat uploads, and every
 * upload updates the map.
 */
let artListing = null;
function artIndex(FP) {
  // The promise is cached, so concurrent import workers share one listing.
  artListing ??= (async () => {
    const map = new Map();
    try {
      const listing = await FP.browse("data", ART_DIR);
      for (const f of listing?.files ?? []) map.set(f.split("/").pop(), f);
    } catch {
      /* directory does not exist yet — an empty map, not a failure */
    }
    return map;
  })();
  return artListing;
}

/** Directory creations already asked for this session, by directory. */
const ensuredDirs = new Map();

/**
 * Create a data directory once per session. Core rejects the create when the
 * directory exists, which is the usual case, so the answer is remembered rather
 * than asked again on every upload.
 */
function ensureDirectory(FP, dir) {
  if (!ensuredDirs.has(dir)) {
    ensuredDirs.set(
      dir,
      FP.createDirectory("data", dir).catch((err) =>
        console.debug(`${MODULE_ID} | art directory "${dir}" not created (it usually already exists)`, err),
      ),
    );
  }
  return ensuredDirs.get(dir);
}

/**
 * The usable art file already on disk for a recipe id, or null. Shared with the
 * importers so a re-import can skip the `art` OP entirely, not merely the
 * upload. A tiny file (a corrupt or aborted upload) or one deleted since the
 * listing was taken counts as absent.
 */
const cachedArt = (id) => cachedFile(`${String(id).replaceAll(".", "-")}.png`);

/** The usable file of this name already in the art directory, or null — the check `cachedArt` describes. */
async function cachedFile(filename) {
  const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
  const index = await artIndex(FP);
  const existing = index.get(filename);
  if (!existing) return null;
  const head = await fetch(existing, { method: "HEAD" }).catch(() => null);
  const size = parseInt(head?.headers?.get("content-length") ?? "0", 10);
  if (head?.ok && size >= 1024) return existing;
  index.delete(filename);
  return null;
}

/**
 * Extracts and uploads a page illustration without touching an actor, returning
 * `{path, width, height}` or null (`cached: true` when a file was reused). The
 * placed image itself is extracted first; the placement-box page-render crop is
 * the fallback for a seat whose decoders fail.
 */
async function uploadPageArt(doc, recipe) {
  const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
  const dir = ART_DIR;
  const filename = `${recipe.id.replaceAll(".", "-")}.png`;
  const existing = await cachedArt(recipe.id);
  if (existing) return { path: existing, width: 0, height: 0, cached: true };
  const index = await artIndex(FP);
  const art =
    (await extractPageArt(doc, recipe.page, recipe.name ?? null)) ??
    (recipe.box ? await extractPageArtRegion(doc, recipe.page, recipe.box) : null);
  if (!art) return null;
  await ensureDirectory(FP, dir);
  const file = new File([art.blob], filename, { type: "image/png" });
  const res = await FP.upload("data", dir, file, {}, { notify: false });
  if (!res?.path) return null;
  index.set(filename, res.path); // the listing stays true without re-browsing
  return { path: res.path, width: art.width, height: art.height };
}

/**
 * Renders and uploads a scene recipe's picture, returning `{path, width,
 * height}` or null. The file is named by the recipe's id AND its picture key,
 * so a held picture is reused only while the recipe draws the same one.
 *
 * `pixelsPerPoint` is a grid recipe's scale as the map step measured it
 * (`gridScenePlan`); without one the picture is cut at the recipe's
 * feet-per-point scale.
 */
async function uploadSceneMap(doc, id, recipe, { pixelsPerPoint } = {}) {
  const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
  const frame = sceneFrame(recipe, { pixelsPerPoint });
  const stem = `${String(id).replaceAll(".", "-")}-${pictureKey(recipe)}`;
  for (const ext of ["webp", "png"]) {
    const existing = await cachedFile(`${stem}.${ext}`);
    if (existing) return { path: existing, width: frame.width, height: frame.height, cached: true };
  }
  const art = await extractPageMap(doc, recipe.page, recipe.crop, frame, turnMatrix(frame));
  if (!art) return null;
  await ensureDirectory(FP, ART_DIR);
  const filename = `${stem}.${art.ext}`;
  const res = await FP.upload("data", ART_DIR, new File([art.blob], filename, { type: art.blob.type }), {}, { notify: false });
  if (!res?.path) return null;
  (await artIndex(FP)).set(filename, res.path);
  return { path: res.path, width: art.width, height: art.height };
}

/**
 * Traces a scene recipe's walls off the Judge's own page: the crop rendered to
 * gray at `TRACE_PITCH` pixels to the drawn cell, read by `traceWalls`, or on a
 * plan of storeys every storey's crop, read by `traceStoreys`. Returns
 * `{walls, digest}` with the walls in page points, or null when a render failed
 * or the trace threw; the map is then made without walls. Rendered apart from
 * the picture, whose scale and cache differ.
 */
async function traceSceneWalls(doc, id, recipe) {
  const scale = TRACE_PITCH / Number(recipe.grid?.box?.w);
  try {
    const crops = [recipe.crop, ...storeyCrops(recipe)];
    const images = [];
    for (const crop of crops) images.push(await extractPageGray(doc, recipe.page, crop, scale));
    if (images.some((image) => !image)) {
      console.warn(`${MODULE_ID} | map ${id}: its walls could not be rendered; the map is made without them.`);
      return null;
    }
    const traced = crops.length > 1 ? traceStoreys(images, recipe, scale) : traceWalls(images[0], recipe, scale);
    console.log(`${MODULE_ID} | map ${id}: walls traced`, traced.digest);
    return traced;
  } catch (err) {
    console.warn(`${MODULE_ID} | map ${id}: its walls could not be traced; the map is made without them.`, err);
    return null;
  }
}

async function importArt(actor, doc, recipe) {
  try {
    const up = await uploadPageArt(doc, recipe);
    if (!up) {
      console.log(`${MODULE_ID} | ${actor.name}: no suitable illustration found on PDF p. ${recipe.page}.`);
      return false;
    }
    await actor.update({ img: up.path, "prototypeToken.texture.src": up.path });
    console.debug(`${MODULE_ID} | ${actor.name}: art ${up.cached ? "reused" : `imported (${up.width}x${up.height})`} -> ${up.path}`);
    return true;
  } catch (err) {
    console.warn(`${MODULE_ID} | ${actor.name}: art import failed`, err);
    return false;
  }
}

async function applyStatsToActor(actor, doc, pageData, recipe) {
  const pairs = extractStatPairs(pageData);
  if (!pairs.length) return ui.notifications.warn(`${MODULE_ID} | ${recipe.name}: no stat rows found on PDF p. ${recipe.page}.`);
  // A named proficiency resolves against the library's definitions before it is minted bare.
  const { system, extras, items, applied, unmapped } = mapPairs(pairs, {
    proficiency: await proficiencyResolver(),
    naturalDamage: naturalWeaponDamageMap(),
    extraordinaryEdges: extraordinaryEdges(),
  });

  // The entry's text goes to `extras.description.appearance`, and nowhere else.
  // Each target is written as one object or path, never a parent plus a dotted
  // leaf of it in the same update().
  const update = { [`flags.${MODULE_ID}.statPairs`]: pairs };
  const prose = await extractRecipe(doc, recipe).catch(() => null);
  extras.description = {
    ...(extras.description ?? {}),
    appearance: bookText(prose ? [prose] : [], recipe.cite, { id: recipe.id, book: recipe.book, page: recipe.page }),
  };
  update[`flags.${MODULE_ID}.extras`] = extras;
  // The appearance written is the one whose digest the stamp records (a repair reads an edit against it).
  Object.assign(update, sumsUpdate(extras.description.appearance, "flags.extras.description.appearance"));
  update.system = system;
  await actor.update(update);
  // Verifies the description landed.
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

/** The monster recipe whose name matches an actor's, or `<name> (PoC)`. */
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
      `${MODULE_ID} | ${REGISTRY[recipe.book]?.label ?? recipe.book} is not open this session — connect it (PoC 2 / unlock) to fill ${actor.name}.`,
    );
    return false;
  }
  const pageData = await pageItems(session.doc, recipe.page);
  await applyStatsToActor(actor, session.doc, pageData, recipe);
  return true;
}

/**
 * The monsters Apply Stats acts on: selected tokens plus any monster whose
 * SHEET is open (a monster never placed on a scene has no token), deduped.
 */
function applyStatsTargets() {
  const fromTokens = (canvas.tokens?.controlled ?? []).map((t) => t.actor);
  const open = [...(foundry.applications?.instances?.values?.() ?? []), ...Object.values(ui.windows ?? {})];
  const fromSheets = open.map((app) => app?.document ?? app?.object).filter((d) => d instanceof Actor);
  return [...new Set([...fromTokens, ...fromSheets].filter((a) => a?.type === ACTOR_TYPE.MONSTER))];
}

/**
 * Re-reads stats from the connected book for the selected or open monsters.
 * Never every monster in the world: this rewrites system data.
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
  const noStats = [];
  for (const actor of selected) {
    // A cookbook-imported monster knows which entry it came from; ask it before
    // resolving by name against `allRecipes()`.
    const refilled = await refillMonster(actor).catch((err) => {
      console.error(`${MODULE_ID} | refill ${actor.name}`, err);
      return { ok: false, reason: "error" };
    });
    if (refilled?.ok) {
      touched++;
      continue;
    }
    if (refilled?.reason === "book-closed") {
      closed.add(REGISTRY[refilled.book]?.label ?? refilled.book);
      continue;
    }
    // Ours, but its entry carries no stat block to re-read; nothing was written, so it is named.
    if (refilled?.reason === "no-stats") {
      noStats.push(actor.name);
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
  if (noStats.length) {
    ui.notifications.warn(
      `${MODULE_ID} | no stat block for this surface to re-read — left unchanged: ${noStats.slice(0, 5).join(", ")}${noStats.length > 5 ? ` (+${noStats.length - 5})` : ""}.`,
    );
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
  game.settings.register(MODULE_ID, SETTING_DYNAMIC, { scope: "world", config: false, type: Object, default: {} });
  // The refresh bridge window; client scope, since it is per seat.
  game.settings.register(MODULE_ID, SETTING_REFRESH_CACHE, {
    name: `${LANG_PREFIX}.cache.settingName`,
    hint: `${LANG_PREFIX}.cache.settingHint`,
    scope: "client",
    config: true,
    type: Number,
    range: { min: 0, max: 300, step: 10 },
    default: 60,
    onChange: (value) => {
      // Turning it off clears the cached bytes now, not at the next join.
      if (!Number(value)) {
        bytesClear().catch((err) =>
          console.warn(`${MODULE_ID} | bridged book bytes could not be cleared after disabling the refresh bridge`, err),
        );
        stampClear();
      }
    },
  });
  registerGettingStartedSettings();
  // The GM's way in from settings to every import control.
  game.settings.registerMenu(MODULE_ID, "importManager", {
    name: `${LANG_PREFIX}.manager.menuName`,
    label: `${LANG_PREFIX}.manager.menuLabel`,
    hint: `${LANG_PREFIX}.manager.menuHint`,
    icon: "fa-solid fa-hanging-sign",
    type: ImportManagerMenu,
    restricted: true,
  });
  // An Adventure the importer wrote imports as a fill, never an overwrite.
  registerBookAdventureHooks();
  setWorker(`modules/${MODULE_ID}/vendor/pdfjs/pdf.worker.mjs`);
  setWasmUrl(`modules/${MODULE_ID}/vendor/pdfjs/wasm/`);
});

Hooks.once("ready", async () => {
  initCookbook({ sessionDocs, importArtForPage: importArt, uploadPageArt, cachedArt, uploadSceneMap, traceSceneWalls });
  registerAbilityDirectoryButtons();
  await loadCookbook();
  const api = {
    connectBook, connectBookUrl, reconnectBooks, browseAndLoad, applyStats, bookStatus, forgetBooks,
    /** Put a book on the server from a File this seat holds: read here, checked here, uploaded only then. */
    stageBook: stageFile,
    /** Open a shelved book at a PDF page — what pressing a citation does. */
    openBookPage,
    /** Whether a book is open on this seat. */
    bookOpen: (bookId) => sessionDocs.has(bookId),
    /** The file of a book open on this seat, as fresh bytes, or null when it is not open. */
    bookBytes: async (bookId) => (await sessionDocs.get(bookId)?.doc?.getData?.()) ?? null,
    cookbookImport, cookbookImportIds, cookbookImportMonsters, cookbookRemoveImports, cookbookImportAbilities, cookbookImportAbilitiesDialog, cookbookUpdateAbilities, cookbookFillCompanions, cookbookPruneAbilities,
    importAbility, cookbookDebug, cookbookCount,
    cookbookImportTables,
    cookbookImportJournals, cookbookImportPoiPlaces, cookbookImportMarketProfiles, cookbookImportFactions, cookbookImportRollTables, cookbookImportScenes, cookbookAudit, lastAudit,
    cookbookReimportShelf, reimportableShelves, cookbookReimportBook, reimportableBooks, cookbookReimportEntries,
    /** What the rebuild control offers (shelves, books, tables), and the run of one of its values. */
    rebuildOptions, runRebuildPick,
    cookbookImportAdventures, bookCensus,
    /** An adventure book repaired in place as one unit, and the books it offers. */
    cookbookReimportAdventure, adventureBooks,
    cookbookImportAdventureItems, cookbookImportLinks,
    /** The whole import chain, in dependency order — the "Import Everything" control. */
    importEverything: () => runImportEverything(),
    /** Every open book and adventure book repaired in place, asked once; `mode` is ignored. */
    reimportEverything: (mode, opts) => cookbookReimportEverything(mode, opts),
    /** One step of the chain by its `GM_STEPS` key. */
    importStep: runImportStep,
    /** The import manager window, on `tab` when given. */
    openImportManager,
    importEquipment, importAllEquipment, cookbookEquipmentIds,
    importWeapons, importArmor,
    importClasses, cookbookUpdateClasses, importTemplatePackages, importTraps, importSpells, importVariations, importVehicles, importMerchandise,
    /** Opens the Books tab with the first-run walkthrough open. */
    gettingStarted: () => openBooksDialog({ firstRun: true }),
    RECIPES, BOOKS,
  };
  acksExtras.importer = api;
  installImportManager({
    api,
    booksPanel,
    steps: GM_STEPS,
    runStep: runImportStep,
    // "import" is the chain; any other mode is the repair over every open book.
    runEverything: (mode = "import") => (mode === "import" ? runImportEverything() : api.reimportEverything()),
    merchandise: () => acksExtras.markets?.buildMerchandiseFromTables?.(),
    lib: () => acksExtras.lib,
    tokenArt: { sources: tokenArtSources, apply: applyTokenArt, restore: restoreTokenArt, hasFlag: hasTokenArtFlag },
  });
  document.addEventListener("click", onCiteClick, { capture: true });

  // The ability-resolution contract (docs/lib/API.md), through which other
  // features embed proficiency packages without naming this feature.
  services.register("ability-provider", { resolve: resolveAbilities });
  console.log(
    `${MODULE_ID} | ready. Macros in the "ACKS Extras Macros" compendium (folders "Your Books" and "Import from your books"), or: acksExtras.importer.bookStatus() · acksExtras.importer.cookbookImport() · acksExtras.importer.cookbookImportAbilitiesDialog() · acksExtras.importer.cookbookUpdateAbilities() · acksExtras.importer.importClasses() · acksExtras.importer.cookbookUpdateClasses() · acksExtras.importer.browseAndLoad().`,
  );

  // Before anything reads bytes: empty the bridge unless this load is a reload inside its window.
  await sweepCache();
  startCacheHeartbeat();

  // The shelf first, so a shelved book never waits for a gesture; then what
  // this browser remembers. The same window opens for whatever is left, or with
  // its walkthrough open on a seat with nothing anywhere.
  await restoreShelf();
  const pending = await restoreBooks();
  if (pending.length) await openBooksDialog();
  else if (!sessionDocs.size && !(await locations()).size && !Object.keys(shelf()).length && !gettingStartedDismissed()) {
    await openBooksDialog({ firstRun: true });
  }
});
