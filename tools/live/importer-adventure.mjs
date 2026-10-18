/**
 * Live walk, importer-adventure: an adventure book in the library as one
 * Adventure. Walks docs/importer/TESTING.md, "A book lands in the library as
 * one Adventure", steps 1–7, 9 and 10 on AX3; step 8 (a cold library) is
 * reported as not reached, since a scripted click lands after the warm. Step 5's
 * edit is a scripted update of the stored Adventure, the write its sheet's save
 * makes. Machine values arrive through ./_env.mjs, the book through
 * ACKS_TEST_BOOKS ("ax3"). Every fixture is invented: a world Item stamped to
 * the book under a salted id, and a per-map Adventure carrying the retired stamp
 * and no content. A check prints ids, counts and booleans, never a book's words.
 *
 * The step writes every open Judge book, and the GM seat reopens the books it
 * remembers one at a time after ready, so the walk lets the open set settle
 * before it reads anything, and checks each run's outcome for AX3 alone.
 *
 * Writes outside the fixture ledger, each reported:
 *   - the book connected on the GM seat with remember:false;
 *   - the GM seat's notification methods, patched to read what a run says
 *     (put back at teardown);
 *   - every book Adventure the step writes, any book's (its
 *     `created.adventures`, tracked), and a shelf it opens (`created.packs`,
 *     deleted at teardown when empty);
 *   - the per-map Adventures the step retires. The walk stops before the step
 *     when any Judge book's shelf, open or not, holds a book or per-map
 *     Adventure it did not make; SHELF_OK=1 is that shelf's owner's go-ahead
 *     to run over it;
 *   - every document an import creates, read from that import's own
 *     `importAdventure` result and tracked.
 */
import fs from "node:fs";
import path from "node:path";
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS, books, logDir } from "./_env.mjs";

const MACHINE = machineSeats();
const browser = MACHINE.browser;
const origin = MACHINE.origin;
const SEATS = { gm: MACHINE.gm, player: MACHINE.player };
const NONCE = "a" + Math.random().toString(36).slice(2, 8);
const BOOK = "ax3";
const BOOKS = books([BOOK]);
const SHELF_OK = process.env.SHELF_OK === "1";

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/* ------------------------------------------------------------------ */
/*  Page side                                                           */
/* ------------------------------------------------------------------ */
const P = {
  install: async () => {
    const H = (globalThis.__ba = globalThis.__ba ?? {});
    H.CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    H.AB = await import("/modules/acks-extras/scripts/importer/adventure-binding.mjs");
    H.LIB = await import("/modules/acks-extras/scripts/lib/library.mjs");
    H.BK = await import("/modules/acks-extras/scripts/importer/books.mjs");
    if (!H.notesPatched) {
      H.notes = [];
      H.orig = {};
      for (const k of ["info", "warn", "error"]) {
        H.orig[k] = ui.notifications[k];
        ui.notifications[k] = function (msg, ...rest) {
          H.notes.push({ kind: k, text: String(msg) });
          return H.orig[k].call(this, msg, ...rest);
        };
      }
      H.notesPatched = true;
    }
    return { installed: true };
  },
  census: async ({ book }) => {
    const H = globalThis.__ba;
    return {
      module: game.modules.get("acks-extras")?.version ?? null,
      role: game.user.role,
      isGM: game.user.isGM,
      activeGMIsSelf: !!game.users.activeGM?.isSelf,
      steps: typeof acksExtras.importer?.cookbookImportAdventures === "function",
      open: !!H.CB.cookbookSessionDoc(book),
      judges: Object.keys(H.BK.BOOKS).filter((b) => H.BK.bookIsJudges(b) && H.CB.cookbookSessionDoc(b)),
      everyJudge: Object.keys(H.BK.BOOKS).filter((b) => H.BK.bookIsJudges(b)),
      scenes: game.scenes.filter((s) => s.getFlag("acks-extras", "cookbook")?.book === book && s.getFlag("acks-extras", "cookbook")?.id).length,
      cold: H.LIB.libraryCold(),
    };
  },
  connectBook: async ({ id, path }) => {
    const H = globalThis.__ba;
    if (H.CB.cookbookSessionDoc(id)) return { already: true };
    globalThis.__baBook = { done: false };
    acksExtras.importer.connectBookUrl(id, path, { remember: false, bridge: false })
      .then(() => { globalThis.__baBook = { done: true, ok: true }; })
      .catch((e) => { globalThis.__baBook = { done: true, ok: false, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  bookState: async ({ id }) => ({ ...globalThis.__baBook, open: !!globalThis.__ba.CB.cookbookSessionDoc(id) }),
  shelves: async ({ judges }) => {
    const H = globalThis.__ba;
    const out = {};
    for (const book of judges) {
      const pack = H.LIB.findLibraryPack("Adventure", H.CB.lineOf(book));
      if (!pack) { out[book] = { pack: null, rows: [] }; continue; }
      const index = await pack.getIndex({ fields: ["flags.acks-extras.cookbook"] });
      out[book] = {
        pack: pack.collection,
        rows: [...index].map((r) => ({ id: r._id, kind: r.flags?.["acks-extras"]?.cookbook?.kind ?? null, book: r.flags?.["acks-extras"]?.cookbook?.book ?? null })),
      };
    }
    return out;
  },
  makeLegacy: async ({ collection, book, nonce }) => {
    const Adventure = foundry.utils.getDocumentClass("Adventure");
    const doc = await Adventure.create({
      name: `QA per-map Adventure ${nonce}`,
      flags: { "acks-extras": { cookbook: { id: `${book}.qaMap${nonce}.adventure`, book, kind: "kind.settlementAdventure", scene: `${book}.qaMap${nonce}` } } },
    }, { pack: collection });
    return doc ? { uuid: doc.uuid, id: doc.id } : null;
  },
  step: async () => {
    const H = globalThis.__ba;
    H.notes.splice(0);
    globalThis.__baStep = { done: false };
    acksExtras.importer.cookbookImportAdventures()
      .then((c) => { globalThis.__baStep = { done: true, counts: c ?? null }; })
      .catch((e) => { globalThis.__baStep = { done: true, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  stepState: async () => ({ ...globalThis.__baStep, notes: globalThis.__baStep?.done ? globalThis.__ba.notes.map((n) => n.kind) : [] }),
  /** What the stored Adventure holds, as ids, counts and booleans. */
  stored: async ({ book, fixtureItemId }) => {
    const H = globalThis.__ba;
    const pack = H.LIB.findLibraryPack("Adventure", H.CB.lineOf(book));
    const id = H.AB.bookAdventureId(book);
    if (!pack?.index.has(id)) return { present: false };
    // Read from the server, never the pack's cache: core empties an Adventure's
    // actors on load when its pack lacks `metadata.system`, which only a fresh
    // read shows.
    const [doc] = await pack.getDocuments({ _id: id });
    const o = doc.toObject();
    const stamp = o.flags?.["acks-extras"]?.cookbook ?? {};
    const carried = [...o.actors, ...o.tables, ...o.journal, ...o.items];
    const folderIds = new Set(o.folders.map((f) => f._id));
    const tableIds = new Set(o.tables.map((t) => `RollTable.${t._id}`));
    const scenes = o.scenes.map((s) => {
      const world = game.scenes.get(s._id);
      const worldRegions = new Set(world?.regions.map((r) => r.id) ?? []);
      const worldTokens = new Set(world?.tokens.map((t) => t.id) ?? []);
      const zones = (world?.regions ?? []).filter((r) => r.getFlag("acks-extras", "cookbook")?.zone);
      const carriedZones = s.regions.filter((r) => zones.some((z) => z.id === r._id));
      const zoneTables = carriedZones.flatMap((r) => (r.behaviors ?? []).map((b) => b.system?.tableUuid).filter(Boolean));
      return {
        id: s._id,
        held: !!world,
        regionsWorld: !!world && s.regions.every((r) => worldRegions.has(r._id)),
        tokensWorld: !!world && s.tokens.every((t) => worldTokens.has(t._id)),
        gridMatches: !world || s.grid?.size === world.grid.size,
        zonesCarried: carriedZones.length === zones.length,
        zoneTablesCarried: zoneTables.every((u) => tableIds.has(u)),
        zones: zones.length,
        tokensHidden: s.tokens.every((t) => t.hidden),
        quiet: !s.active && !s.navigation && !s.thumb,
      };
    });
    return {
      present: true,
      uuid: doc.uuid,
      modifiedTime: doc._stats?.modifiedTime ?? null,
      kind: stamp.kind,
      hasHash: typeof stamp.sourcesHash === "string" && stamp.sourcesHash.length > 0,
      sourcesHash: stamp.sourcesHash ?? null,
      writtenAt: stamp.writtenAt ?? null,
      counts: { scenes: o.scenes.length, actors: o.actors.length, tables: o.tables.length, journal: o.journal.length, items: o.items.length, folders: o.folders.length },
      contentsMatch: !!stamp.contents && stamp.contents.scenes === o.scenes.length && stamp.contents.tables === o.tables.length &&
        stamp.contents.journals === o.journal.length && stamp.contents.items === o.items.length &&
        stamp.contents.places + stamp.contents.factions + stamp.contents.actors === o.actors.length,
      scenes,
      ownedByNobody: carried.every((d) => d.ownership?.default === 0),
      foldersCarried: [...carried, ...o.scenes].every((d) => !d.folder || folderIds.has(d.folder)),
      fixtureItem: o.items.find((i) => i._id === fixtureItemId)?.name ?? null,
    };
  },
  /** The stored Adventure without `_stats`, for a diff when a run that should hold rebuilds. */
  storedSource: async ({ book }) => {
    const H = globalThis.__ba;
    const pack = H.LIB.findLibraryPack("Adventure", H.CB.lineOf(book));
    const doc = await pack.getDocument(H.AB.bookAdventureId(book));
    return H.AB.withoutStats(doc.toObject());
  },
  /** Every open Judge book's stored Adventure, kept page-side for `movedSince`. */
  snapshot: async ({ books }) => {
    const H = globalThis.__ba;
    H.snap = {};
    for (const book of books) {
      const pack = H.LIB.findLibraryPack("Adventure", H.CB.lineOf(book));
      const id = H.AB.bookAdventureId(book);
      if (!pack?.index.has(id)) continue;
      const [doc] = await pack.getDocuments({ _id: id });
      if (doc) H.snap[book] = H.AB.withoutStats(doc.toObject());
    }
    return Object.keys(H.snap).length;
  },
  /**
   * The key paths of a book's stored Adventure that moved since `snapshot`,
   * to three levels, an embedded document named by its id: what a rebuild
   * nothing asked for changed, without its values.
   */
  movedSince: async ({ book }) => {
    const H = globalThis.__ba;
    const before = H.snap?.[book];
    const pack = H.LIB.findLibraryPack("Adventure", H.CB.lineOf(book));
    const [doc] = before && pack ? await pack.getDocuments({ _id: H.AB.bookAdventureId(book) }) : [];
    if (!before || !doc) return null;
    const after = H.AB.withoutStats(doc.toObject());
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const paths = [];
    const walk = (a, b, at, depth) => {
      if (same(a, b)) return;
      if (depth === 3 || !a || !b || typeof a !== "object" || typeof b !== "object") return paths.push(at);
      if (Array.isArray(a) && Array.isArray(b) && [...a, ...b].every((e) => e?._id)) {
        const ids = new Set([...a, ...b].map((e) => e._id));
        for (const id of ids) walk(a.find((e) => e._id === id), b.find((e) => e._id === id), `${at}[${id}]`, depth + 1);
        return;
      }
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[key], b[key], at ? `${at}.${key}` : key, depth + 1);
    };
    walk(before, after, "", 0);
    return paths.slice(0, 24);
  },
  editAdventure: async ({ book }) => {
    const H = globalThis.__ba;
    const pack = H.LIB.findLibraryPack("Adventure", H.CB.lineOf(book));
    const doc = await pack.getDocument(H.AB.bookAdventureId(book));
    await doc.update({ description: `${doc.description}<p>QA edit</p>` });
    return { modifiedTime: doc._stats?.modifiedTime ?? null };
  },
  deleteAdventure: async ({ book }) => {
    const H = globalThis.__ba;
    const pack = H.LIB.findLibraryPack("Adventure", H.CB.lineOf(book));
    const doc = await pack.getDocument(H.AB.bookAdventureId(book));
    await doc.delete();
    return { gone: !pack.index.has(H.AB.bookAdventureId(book)) };
  },
  /** Every world document of the book, by uuid, with its modified time: what the walk proves it did not write to. */
  worldStamps: async ({ book }) => {
    const out = {};
    for (const type of ["Actor", "Scene", "RollTable", "JournalEntry", "Item"]) {
      for (const doc of game.collections.get(type) ?? []) {
        if (doc.getFlag("acks-extras", "cookbook")?.book === book) out[doc.uuid] = doc._stats?.modifiedTime ?? null;
      }
    }
    return out;
  },
  /** Import through the Adventure sheet's own button; the result arrives in a global. */
  importViaSheet: async ({ book }) => {
    const H = globalThis.__ba;
    const pack = H.LIB.findLibraryPack("Adventure", H.CB.lineOf(book));
    const doc = await pack.getDocument(H.AB.bookAdventureId(book));
    H.notes.splice(0);
    H.seen = [];
    H.observers = ["Actor", "Scene", "RollTable", "JournalEntry", "Item", "Folder"].map((t) => [`create${t}`, Hooks.on(`create${t}`, (d) => H.seen.push(d.uuid))]);
    globalThis.__baImport = { done: false };
    H.importHook = Hooks.once("importAdventure", (adv, opts, created) => {
      const uuids = Object.values(created ?? {}).flat().map((d) => d.uuid);
      globalThis.__baImport = { done: true, hooked: true, created: uuids };
    });
    const sheet = doc.sheet;
    await sheet.render({ force: true });
    // A V1 sheet's `element` is a jQuery wrapper; a V2 sheet's is the node
    // itself, a <form> whose [0] is its first control, so never index a V2 one.
    const root = () => (typeof sheet.element?.querySelector === "function" ? sheet.element : (sheet.element?.[0] ?? null));
    let button = null;
    for (let n = 0; n < 80; n++) {
      button = root()?.querySelector('button[type="submit"]') ?? null;
      if (button && !button.disabled) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    const sheetClass = sheet.constructor.name;
    if (!button || button.disabled) return { clicked: false, sheetClass, button: !!button };
    button.click();
    return { clicked: true, sheetClass };
  },
  importState: async () => {
    const H = globalThis.__ba;
    const notes = H.notes.map((n) => ({ kind: n.kind, nothing: /nothing was added/i.test(n.text), added: /document\(s\) added/i.test(n.text), loading: /still loading/i.test(n.text) }));
    const dialogs = foundry.applications.instances ? [...foundry.applications.instances.values()].filter((a) => a instanceof foundry.applications.api.DialogV2).length : 0;
    return { ...globalThis.__baImport, notes, dialogs, seen: H.seen ?? [] };
  },
  endImport: async () => {
    const H = globalThis.__ba;
    for (const [hook, id] of H.observers ?? []) Hooks.off(hook, id);
    H.observers = [];
    if (H.importHook) { Hooks.off("importAdventure", H.importHook); H.importHook = null; }
    return { seen: (H.seen ?? []).length };
  },
  deleteDoc: async ({ uuid }) => {
    const doc = await fromUuid(uuid);
    if (!doc) return { gone: true, was: false };
    await doc.delete();
    return { gone: !(await fromUuid(uuid)), was: true };
  },
  renameItem: async ({ id, name }) => {
    await game.items.get(id)?.update({ name });
    return { name: game.items.get(id)?.name ?? null };
  },
  booksWindow: async ({ book }) => {
    acksExtras.importer.gettingStarted();
    let row = null;
    for (let n = 0; n < 80; n++) {
      row = document.querySelector(`.acks-extras-importer-books [data-adventure="${book}"]`);
      if (row) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    const prefix = game.i18n.localize("ACKS-IMPORTER.ui.booksAdventure").split(":")[0];
    const legacy = game.i18n.localize("ACKS-IMPORTER.ui.booksAdventureLegacy").split(";")[0].replace(/\{n\}\s*/, "");
    const text = row?.textContent.trim() ?? "";
    return { row: !!row, census: text.startsWith(prefix), legacyLine: !!legacy && text.includes(legacy) };
  },
  closeAll: async () => {
    let n = 0;
    for (const a of foundry.applications.instances?.values() ?? []) {
      if (a.id === "sidebar" || a.constructor?.name?.startsWith("Hotbar")) continue;
      if (!a.window && !a.options?.window) continue;
      try { if (a.rendered && a.hasFrame) { await a.close({ force: true }); n++; } } catch {}
    }
    return n;
  },
  restore: async () => {
    const H = globalThis.__ba ?? {};
    if (H.notesPatched) { for (const k of Object.keys(H.orig)) ui.notifications[k] = H.orig[k]; H.notesPatched = false; return { notes: "restored" }; }
    return {};
  },
  packEmpty: async ({ collection }) => {
    const pack = game.packs.get(collection);
    if (!pack) return { gone: true };
    const index = await pack.getIndex();
    if (index.size) return { kept: index.size };
    await pack.deleteCompendium();
    return { deleted: !game.packs.get(collection) };
  },
  playerSees: async ({ collections }) => ({
    visible: collections.filter((c) => game.packs.get(c)?.visible),
    listed: [...document.querySelectorAll("#compendium [data-pack]")].map((el) => el.dataset.pack).filter((c) => collections.includes(c)),
  }),
};

/* ------------------------------------------------------------------ */
/*  Driver side                                                         */
/* ------------------------------------------------------------------ */

async function run(api, fn, ...args) {
  const text = await api.eval(`(${fn.toString()})(...${JSON.stringify(args)}).then((v) => JSON.stringify(v === undefined ? null : v))`);
  return JSON.parse(text);
}
async function ready(api, label, seconds = 240) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.importer?.cookbookImportScenes`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}
async function poll(api, fn, args, { tries = 300, every = 2000, until = (s) => s?.done } = {}) {
  let state = null;
  for (let n = 0; n < tries; n++) {
    state = await run(api, fn, args);
    if (until(state)) return state;
    await sleep(every);
  }
  return state;
}
const seats = {};
async function seat(key) {
  const api = await connect({ browser, origin, user: SEATS[key], port: PORTS[key] });
  seats[key] = api;
  note(`${key} ready after (s)`, await ready(api, key));
  return api;
}

let gm = null;
const createdPacks = [];
/** One run of the adventures step: the counts, its outcome for the book, and every Adventure it wrote tracked. */
async function runStep(label) {
  await run(gm, P.step);
  const st = await poll(gm, P.stepState, undefined);
  if (st.error) throw new Error(`${label}: the step threw: ${st.error}`);
  const c = st.counts ?? {};
  for (const uuid of c.created?.adventures ?? []) gm.track(uuid, "Adventure");
  for (const collection of c.created?.packs ?? []) createdPacks.push(collection);
  note(`${label}`, { books: c.books, written: c.written, rebuilt: c.rebuilt, kept: c.kept, held: c.held, failed: c.failed, retired: (c.retired ?? []).map((r) => r.uuid), notes: st.notes });
  return c;
}
/** One import through the sheet: what it created is tracked from its own result; the observer only proves nothing else was made. */
/** A run of the step after a snapshot of every open book's Adventure, naming what moved in any other book it rebuilt. */
async function runWatched(label, books) {
  await run(gm, P.snapshot, { books });
  const c = await runStep(label);
  for (const [book, outcome] of Object.entries(c.books ?? {})) {
    if (book === BOOK || outcome !== "rebuilt") continue;
    note(`${label}: ${book} rebuilt although the walk changed nothing of it; key paths that moved`, await run(gm, P.movedSince, { book }));
  }
  return c;
}
async function importOnce(label) {
  const click = await run(gm, P.importViaSheet, { book: BOOK });
  check(`${label}: the sheet's Import button is pressed`, click.clicked, click);
  const st = await poll(gm, P.importState, undefined, { tries: 60, every: 2000, until: (s) => s?.done || s?.notes?.some((n) => n.nothing || n.loading || n.kind === "error") });
  await sleep(1500);
  const final = await run(gm, P.importState);
  await run(gm, P.endImport);
  for (const uuid of final.created ?? []) gm.track(uuid);
  const extra = (final.seen ?? []).filter((u) => !(final.created ?? []).includes(u));
  note(`${label}`, { hooked: !!final.hooked, created: (final.created ?? []).length, seen: (final.seen ?? []).length, notes: final.notes, dialogs: final.dialogs });
  return { ...final, extra, st };
}

try {
  section("seats and the book");
  gm = await seat("gm");
  note("install (gm)", await run(gm, P.install));
  let census = await run(gm, P.census, { book: BOOK });
  if (!census.open) {
    if (!BOOKS.length) throw new Error(`${BOOK} is not open on the GM seat and ACKS_TEST_BOOKS names no copy of it`);
    note("connect", await run(gm, P.connectBook, BOOKS[0]));
    note("book", await poll(gm, P.bookState, { id: BOOK }, { tries: 150, until: (s) => s?.done || s?.open }));
    census = await run(gm, P.census, { book: BOOK });
  }
  // The seat reopens the books it remembers one at a time after ready, and the
  // step writes every open Judge book, so the open set settles before the walk
  // reads anything.
  for (let n = 0, same = 0, last = JSON.stringify(census.judges); n < 36 && same < 3; n++) {
    await sleep(5000);
    census = await run(gm, P.census, { book: BOOK });
    const now = JSON.stringify(census.judges);
    same = now === last ? same + 1 : 0;
    last = now;
  }
  note("gm census", census);
  check("the GM seat is a GM, the working tree carries the adventures step, the book is open and its maps are held", census.isGM && census.steps && census.open && census.scenes > 0, census);
  if (!census.isGM || !census.steps || !census.open) throw new Error("preconditions not met");

  section("the shelves, read before anything is written");
  // Every Judge book's shelf, open or not: a book the seat opens later is
  // written, and its per-map Adventures retired, by the same step.
  const before = await run(gm, P.shelves, { judges: census.everyJudge });
  const theirs = Object.entries(before).flatMap(([book, s]) => s.rows.filter((r) => r.book === book && (r.kind === "kind.bookAdventure" || r.kind === "kind.settlementAdventure")).map((r) => ({ book, ...r })));
  note("shelves", Object.fromEntries(Object.entries(before).map(([b, s]) => [b, { pack: s.pack, rows: s.rows.length }])));
  note("book and per-map Adventures this run did not make", theirs);
  if (theirs.length && !SHELF_OK) {
    check("the shelves hold no Adventure of a Judge book that this run did not make (SHELF_OK=1 is the owner's go-ahead)", false, theirs);
    throw new Error("stopped before the step: a shelf holds Adventures this run did not make");
  }

  section("fixtures");
  const item = await gm.create("Item", { name: `QA carried item ${NONCE}`, type: "item", flags: { "acks-extras": { cookbook: { id: `${BOOK}.fixture~${NONCE}`, book: BOOK } } } });
  let legacy = null;
  const shelfBefore = before[BOOK]?.pack ?? null;
  if (shelfBefore) {
    legacy = await run(gm, P.makeLegacy, { collection: shelfBefore, book: BOOK, nonce: NONCE });
    if (legacy) gm.track(legacy.uuid, "Adventure");
  }
  note("fixtures", { item: item.uuid, legacy: legacy?.uuid ?? "(no shelf yet: retirement is not exercised)" });
  const stampsBefore = await run(gm, P.worldStamps, { book: BOOK });

  section("1. the step writes the book's Adventure and retires the per-map one");
  const c1 = await runStep("run 1");
  check("1: the book's Adventure is written", c1.books?.[BOOK] === "written", c1.books);
  if (legacy) check("1: the per-map fixture is retired and named", (c1.retired ?? []).some((r) => r.uuid === legacy.uuid && !!r.name), (c1.retired ?? []).map((r) => r.uuid));
  const after1 = await run(gm, P.shelves, { judges: [BOOK] });
  check("1: the shelf holds the book's Adventure and no per-map one of the book", after1[BOOK].rows.some((r) => r.kind === "kind.bookAdventure") &&
    !after1[BOOK].rows.some((r) => r.kind === "kind.settlementAdventure" && r.book === BOOK), after1[BOOK].rows.length);

  section("2. what it carries");
  const s1 = await run(gm, P.stored, { book: BOOK, fixtureItemId: item.id });
  note("stored", { counts: s1.counts, scenes: s1.scenes.length, zones: s1.scenes.reduce((n, s) => n + s.zones, 0) });
  check("2: the stamp is the book's, with a sources hash and a write time, and counts what it holds", s1.kind === "kind.bookAdventure" && s1.hasHash && s1.writtenAt > 0 && s1.contentsMatch, { kind: s1.kind, hasHash: s1.hasHash, writtenAt: !!s1.writtenAt, contentsMatch: s1.contentsMatch });
  check("2: every map is the held world scene's, region and token ids included, on its grid", s1.scenes.length === census.scenes && s1.scenes.every((s) => s.held && s.regionsWorld && s.tokensWorld && s.gridMatches), s1.scenes.map((s) => ({ held: s.held, regions: s.regionsWorld, tokens: s.tokensWorld, grid: s.gridMatches })));
  check("2: every zone over a map is carried with its list", s1.scenes.every((s) => s.zonesCarried && s.zoneTablesCarried), s1.scenes.map((s) => ({ zones: s.zones, carried: s.zonesCarried, tables: s.zoneTablesCarried })));
  check("2: tokens hidden; no map active, in the navigation or thumbnailed", s1.scenes.every((s) => s.tokensHidden && s.quiet));
  check("2: every carried document is owned by nobody, and every folder it names is carried", s1.ownedByNobody && s1.foldersCarried, { owned: s1.ownedByNobody, folders: s1.foldersCarried });
  check("2: the fixture Item is carried", s1.fixtureItem === `QA carried item ${NONCE}`);

  section("3. a second run holds it");
  const src1 = await run(gm, P.storedSource, { book: BOOK });
  const c3 = await runWatched("run 2", census.judges);
  const s3 = await run(gm, P.stored, { book: BOOK, fixtureItemId: item.id });
  // Scoped to the book: another Judge book the seat opened since run 1 is
  // written by this run, which is that book's first write and not this one's.
  const others = Object.entries(c3.books ?? {}).filter(([b, o]) => b !== BOOK && o !== "held");
  if (others.length) note("3: other books this run wrote (tracked)", Object.fromEntries(others));
  check("3: held, not written again, the stored Adventure untouched", c3.books?.[BOOK] === "held" &&
    !(c3.created?.adventures ?? []).includes(s1.uuid) && s3.modifiedTime === s1.modifiedTime, { outcome: c3.books?.[BOOK], unchanged: s3.modifiedTime === s1.modifiedTime });
  if (c3.books?.[BOOK] !== "held") {
    const src3 = await run(gm, P.storedSource, { book: BOOK });
    const moved = Object.keys({ ...src1, ...src3 }).filter((k) => JSON.stringify(src1[k]) !== JSON.stringify(src3[k]));
    const file = path.join(logDir(), `importer-adventure-${NONCE}-sources.json`);
    fs.writeFileSync(file, JSON.stringify({ first: src1, second: src3 }, null, 1));
    note("3: fields that moved between the two writes (values in the file)", { moved, file });
  }

  section("4. a changed source rebuilds it");
  note("rename", await run(gm, P.renameItem, { id: item.id, name: `QA carried item ${NONCE} renamed` }));
  const c4 = await runWatched("run 3", census.judges);
  const s4 = await run(gm, P.stored, { book: BOOK, fixtureItemId: item.id });
  check("4: rebuilt under the same id, carrying the new name", c4.books?.[BOOK] === "rebuilt" && s4.uuid === s1.uuid && s4.fixtureItem === `QA carried item ${NONCE} renamed`, { outcome: c4.books?.[BOOK], name: s4.fixtureItem });

  section("6. the sheet's Import fills and never overwrites");
  const i1 = await importOnce("import 1");
  check("6: no confirm dialog", i1.dialogs === 0, { dialogs: i1.dialogs });
  check("6: the import either adds what the world lacks or says nothing was added", i1.hooked || i1.notes.some((n) => n.nothing), i1.notes);
  check("6: the world gained nothing the import did not report", !i1.extra.length, { extra: i1.extra.length });

  section("7. a carried document the world lost comes back");
  note("delete the fixture Item", await run(gm, P.deleteDoc, { uuid: item.uuid }));
  const i2 = await importOnce("import 2");
  check("7: the fixture Item is created again under its id", (i2.created ?? []).includes(item.uuid), { created: (i2.created ?? []).length });
  check("7: and nothing else the import did not report", !i2.extra.length, { extra: i2.extra.length });

  section("the world's documents of the book were not written to");
  const stampsAfter = await run(gm, P.worldStamps, { book: BOOK });
  const madeHere = new Set([item.uuid, ...(i1.created ?? []), ...(i2.created ?? [])]);
  const changed = Object.keys(stampsBefore).filter((u) => !madeHere.has(u) && u in stampsAfter && stampsAfter[u] !== stampsBefore[u]);
  check("no world document of the book the run did not make was written to", !changed.length, { changed: changed.length });

  section("5. a Judge's edit is kept");
  const wait = Math.max(0, (s4.writtenAt ?? 0) + 61_000 - Date.now());
  note("waiting out the write slack (s)", Math.round(wait / 1000));
  if (wait) await sleep(wait);
  note("edit (scripted update, standing in for the sheet's save)", await run(gm, P.editAdventure, { book: BOOK }));
  const c5 = await runWatched("run 4", census.judges);
  check("5: kept", c5.books?.[BOOK] === "kept", c5.books);
  note("delete the Adventure", await run(gm, P.deleteAdventure, { book: BOOK }));
  const c5b = await runStep("run 5");
  const s5 = await run(gm, P.stored, { book: BOOK, fixtureItemId: item.id });
  check("5: deleted, it is written again under the same id", c5b.books?.[BOOK] === "written" && s5.uuid === s1.uuid, { outcome: c5b.books?.[BOOK] });

  section("8. a cold library");
  console.log("NOTE  8: not reached — a scripted click lands after the library warms; the refusal is pinned offline (test-book-adventure)");

  section("10. the Books window");
  const bw = await run(gm, P.booksWindow, { book: BOOK });
  check("10: the book's row reads its census, with no per-map line", bw.row && bw.census && !bw.legacyLine, bw);
  note("closed (gm)", await run(gm, P.closeAll));

  section("9. the player seat");
  const player = await seat("player");
  const shelvesNow = await run(gm, P.shelves, { judges: census.judges });
  const collections = [...new Set(Object.values(shelvesNow).map((s) => s.pack).filter(Boolean))];
  const sees = await run(player, P.playerSees, { collections });
  check("9: no Adventure shelf is visible to the player", !sees.visible.length && !sees.listed.length, sees);
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  try { if (gm) note("closed windows", await run(gm, P.closeAll)); } catch (err) { console.error("closeAll:", err?.message ?? err); }
  try { if (gm) note("restored (gm)", await run(gm, P.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
  try {
    // By uuid: a retired or carried document's name can be the book's.
    const sw = gm ? await gm.sweepTracked() : null;
    if (sw) note("sweep (gm)", { removed: sw.removed.map((e) => e.uuid), missing: sw.missing.map((e) => e.uuid), failed: sw.failed.map((e) => ({ uuid: e.uuid, error: e.error })) });
  } catch (err) { console.error("sweep gm:", err?.message ?? err); }
  for (const collection of createdPacks) {
    try { note(`shelf ${collection} this run opened`, await run(gm, P.packEmpty, { collection })); } catch (err) { console.error("packEmpty:", err?.message ?? err); }
  }
  for (const api of Object.values(seats)) { try { await api.close(); } catch {} }
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
