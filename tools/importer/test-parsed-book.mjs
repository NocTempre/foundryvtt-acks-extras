/**
 * A shelved book's text is parsed once and read from the saved file.
 *
 * `parsed-book.mjs` writes a book's text layer as one JSON file and a pointer
 * on the shelf journal; `BookHandle` serves a page from it when the pointer is
 * current. This suite drives both over an invented server and shelf, with no
 * PDFs and no Foundry: the saved form reads back as the live document reads
 * (`pageItems` deep-equal), the file is the same whichever open wrote it, a
 * changed stamp or a re-pointed `src` makes the pointer stale, a HEAD that
 * answers 404 or another size refuses the book without opening it, a player
 * seat never parses, racing seats and concurrent callers make one file each,
 * and a failed upload never fails a read. The placements of the pages a scene
 * recipe names ride in the same file: a rebuild reads them with no PDF fetch
 * and no open, a page the file lacks is read live, and a re-pointed `src` or
 * another stamp leaves nothing of the old file to answer. So do the traced
 * walls of each walled scene recipe: a rebuild reads them with no PDF fetch,
 * no open and no trace, a scene the file lacks or a recipe edited since the
 * parse is traced live, and the file is read for one recipe's inputs only. The
 * tracer is a stub that counts its calls. Every text in it is invented.
 */
import assert from "node:assert";
import { createHash } from "node:crypto";
import { BookHandle, liveDoc } from "../../scripts/importer/book-handle.mjs";
import { ParsedBooks, PARSE_STAMP, SavedBook, fontId, parseDocument } from "../../scripts/importer/parsed-book.mjs";
import { OPS } from "../../vendor/pdfjs/pdf.mjs";
import { pageArtPlacements, pageItems, placementsOfPage, sceneWallTrace } from "../../scripts/importer/extract.mjs";
import { WALL_TRACE_VERSION, wallTraceInputs } from "../../scripts/importer/wall-trace.mjs";
import { placementMatches } from "../../scripts/importer/scene-binding.mjs";
import { executeEntry } from "../../scripts/importer/executor.mjs";

let pass = 0;
const ok = (label, cond, detail = "") => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ""}`);
  pass++;
};
const same = (label, a, b) => {
  assert.deepStrictEqual(a, b, label);
  pass++;
};

/* --- the fakes ------------------------------------------------------------------------------- */

const H = 792;
const PDF = "books/rr.pdf";
const PDF_BYTES = 1000;

/** The runs of one invented page: a heading, a doubled heading, a tight word space, body lines, a folio. */
function runsOf(n, doc, edition = "A") {
  const f = `g_d${doc}_f1`;
  const g = `g_d${doc}_f2`;
  const run = (str, x, y, width, height, fontName) => ({ str, transform: [1, 0, 0, 1, x, y], width, height, fontName });
  return [
    run(`Heading ${n}`, 72, H - 90, 80, 18, g),
    run(`Heading ${n}`, 72, H - 90, 80, 18, g),
    run("first", 72, H - 120.25, 22.5, 9.5, f),
    run(" ", 94.5, H - 120.25, 0, 9.5, f),
    run("second", 94.5, H - 120.25, 30.125, 9.5, f),
    run("", 0, 0, 0, 0, f),
    run(`line of page ${n} ed ${edition}`, 72, H - 140, 90.0625, 9.5, f),
    run(String(n), 300, 20, 6, 8, f),
  ];
}

/**
 * The operator list of an invented page: pages 3 and 5 paint images (page 3
 * two, the second inside a nested transform and named by its document as
 * pdf.js names a shared image), every other page paints none.
 */
function opsOf(n, docNo) {
  const T = OPS.transform;
  const paint = OPS.paintImageXObject;
  if (n === 3) {
    return {
      fnArray: [OPS.save, T, paint, OPS.save, T, paint, OPS.restore, OPS.restore],
      argsArray: [null, [100, 0, 0, 50, 20, 300], [`g_d${docNo}_img_1`], null, [0.5, 0, 0, 0.5, 0.25, 0.25], [`g_d${docNo}_img_2`], null, null],
    };
  }
  if (n === 5) return { fnArray: [OPS.save, T, paint, OPS.restore], argsArray: [null, [0, 40, -60, 0, 300, 100.5], [`img_${docNo}`], null] };
  return { fnArray: [], argsArray: [] };
}

/** An invented document of `numPages` pages; `docNo` is the counter pdf.js puts in a font id, `edition` marks which file it is. */
function fakeDoc(numPages, docNo, edition = "A") {
  const doc = {
    numPages,
    edition,
    destroyed: 0,
    async getPage(n) {
      if (n < 1 || n > numPages) throw new Error("no such page");
      return {
        getViewport: () => ({ width: 612, height: H }),
        getTextContent: async () => ({ items: runsOf(n, docNo, edition) }),
        getOperatorList: async () => opsOf(n, docNo),
      };
    },
    async destroy() {
      doc.destroyed++;
    },
  };
  return doc;
}

/** Two invented walled scene recipes: a single plan on page 3 and a plan of two storeys on page 5. */
function walledScenes() {
  const grid = { family: "square", box: { w: 10, h: 10 }, distance: 5 };
  return [
    { id: "rr.mapB", recipe: { page: 5, crop: { x: 30, y: 40, w: 120, h: 80 }, levels: [{ x: 30, y: 300 }], grid, walls: { mode: "stroke", threshold: 150 } } },
    { id: "rr.mapA", recipe: { page: 3, crop: { x: 20, y: 40, w: 100, h: 60 }, grid, walls: { mode: "grid", threshold: 160, corrections: [{ cell: [1, 1], is: "open" }] } } },
  ];
}

/**
 * The world every seat shares: a server (files by path, a log of every
 * request), the shelf journals (`src` and pointer per book) and the open every
 * seat uses. `seat` builds one seat's store and handle.
 */
function world({ pages = 7 } = {}) {
  const w = {
    pages,
    files: new Map([[PDF, { bytes: PDF_BYTES }]]),
    journals: { rr: { src: PDF, pointer: null } },
    log: [],
    opens: 0,
    uploads: [],
    uploadFails: false,
    pointerWrites: 0,
    headLength: undefined,
    attempt: 0,
    edition: "A",
    scenePages: [3, 5],
    wallScenes: walledScenes(),
    traced: 0,
    liveTraces: 0,
  };
  // What a tracer makes of a recipe on an open document: a function of the recipe and of the file's edition, so a stale answer shows.
  w.traceOf = (doc, recipe) => ({
    walls: [{ c: [recipe.page + 0.1, -0, recipe.crop.x / 3, 7], door: 0 }, { c: [1, 2, 3, 4], door: 1, terrain: true }],
    digest: { mode: recipe.walls.mode, walls: 1, doors: 1, edition: doc.edition },
  });
  /** The tracer a parse runs over its open document. */
  w.trace = async (doc, recipe) => {
    w.traced++;
    return w.traceOf(doc, recipe);
  };
  /** The live tracer a rebuild falls back to: it takes the live document, so a handle opens the PDF for it. */
  w.liveTrace = async (doc, recipe) => {
    w.liveTraces++;
    return w.traceOf(await liveDoc(doc), recipe);
  };
  w.fetchImpl = async (path, init = {}) => {
    const method = init.method ?? "GET";
    w.log.push(`${method} ${path}`);
    const file = w.files.get(path);
    if (!file) return { ok: false, status: 404 };
    const length = file.text != null ? Buffer.byteLength(file.text) : file.bytes;
    return {
      ok: true,
      status: 200,
      headers: { get: (k) => (k === "content-length" && method === "HEAD" ? (w.headLength === undefined ? String(length) : w.headLength) : null) },
      arrayBuffer: async () => new ArrayBuffer(length),
      json: async () => JSON.parse(file.text),
    };
  };
  w.gets = (suffix) => w.log.filter((l) => l.startsWith("GET ") && l.endsWith(suffix)).length;
  w.heads = () => w.log.filter((l) => l.startsWith("HEAD ")).length;
  w.seat = ({ isGM = true, idleMs } = {}) => {
    const parsed = new ParsedBooks({
      isGM: () => isGM,
      srcOf: (id) => w.journals[id]?.src ?? null,
      placementPagesOf: () => w.scenePages,
      wallScenesOf: () => w.wallScenes,
      traceWalls: w.trace,
      pointerOf: (id) => w.journals[id]?.pointer ?? null,
      writePointer: async (id, pointer) => {
        w.pointerWrites++;
        w.journals[id].pointer = structuredClone(pointer);
      },
      upload: async (name, text) => {
        if (w.uploadFails) throw new Error("upload refused");
        const path = `books/parsed/${name}`;
        assert.ok(!w.files.has(path), "Foundry overwrites no non-media file");
        w.files.set(path, { text });
        w.uploads.push({ name, text });
        return path;
      },
      open: async () => {
        const doc = fakeDoc(w.pages, w.opens++, w.edition);
        return { doc, numPages: w.pages, title: "The Real Title" };
      },
      attempt: () => `a${w.attempt++}`,
      fetchImpl: w.fetchImpl,
    });
    const handle = (src = w.journals.rr.src) =>
      new BookHandle({
        bookId: "rr",
        src,
        numPages: 3,
        title: "Row Title",
        open: async () => {
          const doc = fakeDoc(w.pages, w.opens++, w.edition);
          return { doc, numPages: w.pages, title: "The Real Title" };
        },
        fetchImpl: w.fetchImpl,
        parsed,
        ...(idleMs ? { idleMs } : {}),
      });
    return { parsed, handle };
  };
  return w;
}

/** A page's items with the live document's fonts named as the saved form names them. */
const normalised = (page) => ({ ...page, items: page.items.map((it) => ({ ...it, alias: fontId(it.alias) })) });

const digest = (text) => createHash("sha256").update(text).digest("hex");

/* --- the saved form reads back as the document reads ----------------------------------------- */

{
  const live = fakeDoc(7, 5);
  const saved = await parseDocument(live, { book: "rr", src: PDF, bytes: PDF_BYTES, title: "T" });
  const book = new SavedBook(JSON.parse(JSON.stringify(saved)), { book: "rr", stamp: PARSE_STAMP, src: PDF, bytes: PDF_BYTES, numPages: 7 });
  ok("the saved form names its stamp", saved.stamp === PARSE_STAMP && saved.numPages === 7 && saved.pages.length === 7);
  ok("a doubled run and a blank are not saved", saved.pages[0][2].length === 5, `${saved.pages[0][2].length} runs`);
  ok("one font id per font, in load order", saved.fonts.join() === "g_f2,g_f1");
  for (let n = 1; n <= 7; n++) same(`page ${n}: pageItems of the saved form equal the live document's`, await pageItems(book, n), normalised(await pageItems(fakeDoc(7, 5), n)));
  const flat = await pageItems(book, 1);
  ok("the tight word space survives", flat.items.some((it) => it.str === "second" && it.sp === true));
  same("a second parse of the same file from another open is the same file", JSON.stringify(saved), JSON.stringify(await parseDocument(fakeDoc(7, 12), { book: "rr", src: PDF, bytes: PDF_BYTES, title: "T" })));
  await assert.rejects(() => book.getPage(8), /not in the saved book/);
  pass++;
  const page = await book.getPage(1);
  assert.throws(() => page.getOperatorList(), /no operator list/);
  pass++;
  assert.throws(() => new SavedBook({ ...saved, src: "elsewhere.pdf" }, { src: PDF }), /src/);
  pass++;
  assert.throws(() => new SavedBook({ ...saved, numPages: 9 }), /page count/);
  pass++;
}

/* --- the first read makes the text, and every later read finds it ---------------------------- */

{
  const w = world();
  const gm = w.seat();
  const handle = gm.handle();
  ok("before a read the handle answers the row's pages", handle.numPages === 3 && handle.title === "Row Title");
  const live = await pageItems(fakeDoc(7, 90), 2);
  same("a GM's first read is the page the live document gives", normalised(live), await pageItems(handle, 2));
  ok("the first read fetched the PDF once", w.gets(".pdf") === 1, w.log.join(" | "));
  ok("it opened the file once and uploaded once", w.opens === 1 && w.uploads.length === 1);
  ok("the file is named for the book, the stamp and the attempt", w.uploads[0].name === `rr-${PARSE_STAMP}-a0.json`, w.uploads[0].name);
  const pointer = w.journals.rr.pointer;
  ok("the pointer names the file, its source, size, pages and title", pointer.file === `books/parsed/${w.uploads[0].name}` && pointer.src === PDF && pointer.bytes === PDF_BYTES && pointer.numPages === 7 && pointer.title === "The Real Title" && pointer.stamp === PARSE_STAMP);
  ok("the handle answers the saved text's pages and title", handle.numPages === 7 && handle.title === "The Real Title");
  ok("a seat that just parsed it is verified, with no HEAD", handle.verified && w.heads() === 0);
  for (let n = 1; n <= 7; n++) await pageItems(handle, n);
  ok("every other page came from the one file: no second fetch of the PDF, no second upload", w.gets(".pdf") === 1 && w.uploads.length === 1 && w.opens === 1);

  // A reload: a new seat, a new handle, the same world.
  w.log.length = 0;
  const again = w.seat().handle();
  ok("a reloaded handle knows the book's pages before any read", again.numPages === 7 && again.title === "The Real Title");
  same("a read after a reload is the same page", await pageItems(handle, 3), await pageItems(again, 3));
  ok("a read after a reload fetches no PDF and makes no second file", w.gets(".pdf") === 0 && w.uploads.length === 1 && w.opens === 1, w.log.join(" | "));
  ok("it asks the PDF's address one HEAD, and reads the saved file", w.heads() === 1 && w.log.includes(`GET ${pointer.file}`));
  ok("the reloaded handle is verified", again.verified);
  await handle.destroy();
  await again.destroy();
}

/* --- a stale stamp, a re-pointed src ---------------------------------------------------------- */

{
  const w = world();
  await w.seat().handle().verify();
  ok("a pointer is current for this stamp and src", w.seat().parsed.pointer("rr") !== null);
  const next = new ParsedBooks({ ...stub(w), stamp: "p2-9.9.9" });
  ok("another stamp's pointer is not current", next.pointer("rr") === null);
  w.journals.rr.src = "books/rr-2.pdf";
  ok("a pointer for another src is not current", w.seat().parsed.pointer("rr") === null);
  w.journals.rr.src = PDF;
  ok("and is current again where the journal names its file", w.seat().parsed.pointer("rr") !== null);
  w.journals.rr.pointer = { ...w.journals.rr.pointer, bytes: 0 };
  ok("a pointer that names no size is not current", w.seat().parsed.pointer("rr") === null);

  // A stale pointer on a GM seat is made again, under a new name; the old file stays.
  const w2 = world();
  await w2.seat().handle().verify();
  const first = w2.uploads[0].name;
  w2.journals.rr.src = "books/rr-2.pdf";
  w2.files.set("books/rr-2.pdf", { bytes: 2048 });
  const handle = w2.seat().handle("books/rr-2.pdf");
  await handle.verify();
  ok("a re-pointed book is parsed again into a new file", w2.uploads.length === 2 && w2.uploads[1].name !== first && w2.files.has(`books/parsed/${first}`));
  ok("its pointer follows the new src and size", w2.journals.rr.pointer.src === "books/rr-2.pdf" && w2.journals.rr.pointer.bytes === 2048);
  // A handle still holding the old src finds no saved text of its own.
  const old = w2.seat({ isGM: false }).handle(PDF);
  ok("a handle on another src does not read the pointer's text", old.numPages === 3);
}

/** The seams of a world's store, to build a second store over it. */
function stub(w) {
  return {
    isGM: () => true,
    srcOf: (id) => w.journals[id]?.src ?? null,
    pointerOf: (id) => w.journals[id]?.pointer ?? null,
    writePointer: async () => {},
    upload: async () => "x",
    open: async () => ({}),
    attempt: () => "x",
    fetchImpl: w.fetchImpl,
  };
}

/* --- the file must answer a HEAD ------------------------------------------------------------- */

{
  const w = world();
  await w.seat().handle().verify();
  w.log.length = 0;
  w.opens = 0;

  w.headLength = "999";
  const wrongSize = w.seat().handle();
  ok("a HEAD answering another size refuses the book", (await wrongSize.verify()) === false && wrongSize.verified === false);
  await assert.rejects(() => pageItems(wrongSize, 1), /999 bytes/);
  pass++;
  ok("a refused book is not opened live as a way round", w.opens === 0 && w.gets(".pdf") === 0 && w.gets(".json") === 0, w.log.join(" | "));

  w.headLength = "";
  const unreported = w.seat().handle();
  ok("a HEAD with no content-length checks presence only", (await unreported.verify()) === true);

  w.headLength = undefined;
  w.files.delete(PDF);
  const gone = w.seat().handle();
  ok("a HEAD answering 404 refuses the book", (await gone.verify()) === false && gone.verified === false);
  await assert.rejects(() => pageItems(gone, 1), /404/);
  pass++;
  ok("a 404 never opens the PDF or reads the saved file", w.opens === 0 && w.gets(".json") === 0);

  // S1's gone-file guarantee over saved text: no entry read, no delete licence.
  const result = await executeEntry(gone, { schema: "acks-cookbook/2", entries: { "rr.x": { fields: {}, pages: [1] } } }, {}, "rr.x");
  ok("a direct reader of a gone book gets the refusal, not blank fields", result.ok === false && result.reason === "book-closed" && !Object.keys(result.fields).length);
  const pool = { doc: gone };
  ok("a delete resting on this handle is not licensed", pool.doc.verified === false);
}

/* --- idle: the vouching lapses --------------------------------------------------------------- */

{
  const w = world();
  await w.seat().handle().verify();
  const handle = w.seat({ idleMs: 15 }).handle();
  ok("a HEAD vouches", (await handle.verify()) && handle.verified);
  const heads = w.heads();
  await new Promise((r) => setTimeout(r, 60));
  ok("an idle handle's vouching lapses, so a delete asks again", handle.verified === false);
  ok("and the next read asks the file once more", (await handle.verify()) && w.heads() === heads + 1);
  await handle.destroy();
}

/* --- a player seat never parses -------------------------------------------------------------- */

{
  const w = world();
  const player = w.seat({ isGM: false });
  ok("a player seat may not parse", player.parsed.canParse("rr") === false);
  await assert.rejects(() => player.parsed.prepare("rr"), /does not make saved text/);
  pass++;
  const handle = player.handle();
  const live = await pageItems(handle, 1);
  ok("with no saved text a player reads the PDF live", live.items.length > 0 && w.gets(".pdf") === 1 && w.opens === 1);
  ok("and saves nothing: no upload, no pointer", w.uploads.length === 0 && w.pointerWrites === 0 && w.journals.rr.pointer === null);
  ok("a player's handle reports the file's own pages once it opened it", handle.numPages === 7);
  await handle.destroy();

  // With a GM's parse in the world the same player reads the saved file and fetches no PDF.
  await w.seat().handle().verify();
  w.log.length = 0;
  const reader = w.seat({ isGM: false }).handle();
  same("a player reads the GM's saved text", normalised(await pageItems(fakeDoc(7, 70), 4)), await pageItems(reader, 4));
  ok("without fetching the PDF", w.gets(".pdf") === 0 && w.uploads.length === 1);
  await reader.destroy();
}

/* --- one run per book, one file per attempt -------------------------------------------------- */

{
  const w = world();
  const gm = w.seat();
  const [a, b, c] = await Promise.all([gm.handle().verify(), gm.handle().verify(), gm.parsed.prepare("rr").then((r) => r.fresh)]);
  ok("callers on one seat share one run", a && b && c && w.uploads.length === 1 && w.opens === 1 && w.pointerWrites === 1);
  ok("the PDF was fetched once for all of them", w.gets(".pdf") === 1);

  // Two GM seats racing: each parses, each file is distinctly named, and the bytes are one.
  const r = world();
  const [s1, s2] = [r.seat(), r.seat()];
  const [x, y] = await Promise.all([s1.handle().verify(), s2.handle().verify()]);
  ok("two racing seats both finish", x && y && r.uploads.length === 2);
  ok("their files have distinct names", r.uploads[0].name !== r.uploads[1].name);
  ok("and the same bytes", r.uploads[0].text === r.uploads[1].text && digest(r.uploads[0].text) === digest(r.uploads[1].text));
  ok("the pointer is the last write's, and current", r.pointerWrites === 2 && s1.parsed.pointer("rr").file === `books/parsed/${r.uploads[1].name}`);
  const third = r.seat().handle();
  same("either seat's reading is the same", await pageItems(third, 5), normalised(await pageItems(fakeDoc(7, 33), 5)));
  await third.destroy();

  // A book re-staged while it parsed is not pointed at.
  const s = world();
  const store = s.seat().parsed;
  const wait = store.prepare("rr", {
    getBytes: async () => {
      s.journals.rr.src = "books/other.pdf";
      return new ArrayBuffer(PDF_BYTES);
    },
  });
  await assert.rejects(() => wait, /changed while it was parsed/);
  pass++;
  ok("a parse of a replaced file writes no pointer", s.pointerWrites === 0 && s.journals.rr.pointer === null);
}

/* --- a failure to save never fails a read ---------------------------------------------------- */

{
  const w = world();
  w.uploadFails = true;
  const handle = w.seat().handle();
  const warn = console.warn;
  console.warn = () => {};
  let page;
  try {
    page = await pageItems(handle, 2);
    await pageItems(handle, 3);
  } finally {
    console.warn = warn;
  }
  same("a refused upload still reads the page", normalised(await pageItems(fakeDoc(7, 41), 2)), normalised(page));
  ok("it opened the PDF to read, and tried to save once", w.uploads.length === 0 && w.pointerWrites === 0 && w.gets(".pdf") >= 1);
  const tries = w.opens;
  await pageItems(handle, 4);
  ok("a refused save is not retried on every page", w.opens === tries);
  await handle.destroy();

  // A saved file that is gone: the PDF is read instead.
  const v = world();
  await v.seat().handle().verify();
  v.files.delete(v.journals.rr.pointer.file);
  const reader = v.seat().handle();
  console.warn = () => {};
  let fallback;
  try {
    fallback = await pageItems(reader, 2);
  } finally {
    console.warn = warn;
  }
  ok("a saved file that is gone leaves the PDF to read", fallback.items.length > 0 && v.gets(".pdf") === 2);
  await reader.destroy();

  // A handle with no src (a file this seat picked) has no saved text and never parses.
  const p = world();
  const picked = p.seat().handle(null);
  await assert.rejects(() => picked.getPage(1), /no file to open/);
  pass++;
  ok("a picked file is never parsed", p.uploads.length === 0 && p.pointerWrites === 0);
}

/* --- placements ride in the saved file ------------------------------------------------------- */

const boxes = (list) => list.map(({ x, y, w, h }) => ({ x, y, w, h }));
const liveBoxes = async (n, edition = "A") => boxes(await placementsOfPage(await fakeDoc(7, 77, edition).getPage(n)));
const ANCHOR_3 = { x: 20, y: H - 350, w: 100, h: 50 };

{
  const saved = await parseDocument(fakeDoc(7, 5), { book: "rr", src: PDF, bytes: PDF_BYTES, title: "T", placementPages: [5, 3, 3, 6, 99, 0, 1.5] });
  same("placements are keyed by page, ascending, once, in range", Object.keys(saved.placements), ["3", "5", "6"]);
  const book = new SavedBook(JSON.parse(JSON.stringify(saved)), { book: "rr", stamp: PARSE_STAMP, src: PDF, bytes: PDF_BYTES, numPages: 7 });
  same("a page's saved boxes are the live document's boxes", book.placements(3), await liveBoxes(3));
  ok("a page with two images saves both", book.placements(3).length === 2);
  same("a turned image's box is its extent, top-origin", book.placements(5), [{ x: 240, y: H - 140.5, w: 60, h: 40 }]);
  same("a requested page with no image is saved empty", book.placements(6), []);
  ok("a page never requested is absent, which is not empty", book.placements(4) === null && book.placements(1) === null);
  ok("no image name is saved, since pdf.js names a shared image by the open", !JSON.stringify(saved.placements).includes("img"));
  ok("the recipe's matcher takes a saved answer", placementMatches(book.placements(3), ANCHOR_3) && !placementMatches(book.placements(5), ANCHOR_3));
  book.placements(5)[0].x = 0;
  same("a caller's edit never reaches the next read", book.placements(5)[0].x, 240);
  same("the file is the same whichever open wrote it, and in whatever order the pages were asked", JSON.stringify(saved), JSON.stringify(await parseDocument(fakeDoc(7, 12), { book: "rr", src: PDF, bytes: PDF_BYTES, title: "T", placementPages: [3, 5, 6] })));
  same("the text pass is the same with or without placements", (await parseDocument(fakeDoc(7, 5), { book: "rr", src: PDF, bytes: PDF_BYTES, title: "T" })).pages, saved.pages);

  const bad = fakeDoc(7, 5);
  const getPage = bad.getPage;
  bad.getPage = async (n) => {
    const page = await getPage(n);
    return n === 5 ? { ...page, getOperatorList: async () => { throw new Error("operators"); } } : page;
  };
  const warn = console.warn;
  console.warn = () => {};
  let partial;
  try {
    partial = await parseDocument(bad, { book: "rr", src: PDF, bytes: PDF_BYTES, title: "T", placementPages: [3, 5] });
  } finally {
    console.warn = warn;
  }
  ok("a page whose operators cannot be read is left out and the rest are kept", Object.keys(partial.placements).join() === "3" && partial.pages.length === 7);
  assert.throws(() => new SavedBook({ ...saved, stamp: "p1-x" }, { stamp: PARSE_STAMP }), /stamp/);
  pass++;
}

/* --- a rebuild with its pictures cached opens no PDF ------------------------------------------ */

{
  const w = world();
  const first = w.seat().handle();
  same("the first read of a page's placements is the live page's boxes", boxes(await pageArtPlacements(first, 3)), await liveBoxes(3));
  ok("it made the saved text, with the PDF fetched once", w.gets(".pdf") === 1 && w.uploads.length === 1);
  same("the file holds the pages the recipes name", Object.keys(JSON.parse(w.uploads[0].text).placements), ["3", "5"]);
  await first.destroy();

  // A reload, and an Adventure rebuild: every scene's page is asked, its pictures already cached.
  w.log.length = 0;
  w.opens = 0;
  const next = w.seat().handle();
  const asked = await Promise.all([3, 5].map((n) => pageArtPlacements(next, n).catch(() => [])));
  ok("the recipe's matcher passes on the saved placements", placementMatches(asked[0], ANCHOR_3));
  same("and they are the live boxes", asked, [await liveBoxes(3), await liveBoxes(5)]);
  ok("no PDF was fetched and none was opened", w.gets(".pdf") === 0 && w.opens === 0 && !next.isLive, w.log.join(" | "));
  ok("the book was asked one HEAD and its saved file read once", w.heads() === 1 && w.log.filter((l) => l.startsWith("GET books/parsed/")).length === 1, w.log.join(" | "));
  ok("nothing was saved again", w.uploads.length === 1 && w.pointerWrites === 1);
  ok("the pages' text came from the same file", JSON.stringify(await pageItems(next, 3)).includes("ed A") && w.gets(".pdf") === 0);

  // A page the file lacks is read live.
  const live = await pageArtPlacements(next, 4);
  ok("a page the saved text lacks opens the PDF and answers", live.length === 0 && w.gets(".pdf") === 1 && w.opens === 1 && next.isLive);
  await next.destroy();

  // A player seat reads the same file.
  w.log.length = 0;
  w.opens = 0;
  const player = w.seat({ isGM: false }).handle();
  same("a player seat reads the GM's saved placements", boxes(await pageArtPlacements(player, 5)), await liveBoxes(5));
  ok("without fetching or opening the PDF", w.gets(".pdf") === 0 && w.opens === 0);
  await player.destroy();
}

/* --- placements missing: the PDF answers, with its names -------------------------------------- */

{
  // The page is not one the recipes named when the text was parsed.
  const w = world();
  w.scenePages = [3];
  await w.seat().handle().verify();
  w.log.length = 0;
  const handle = w.seat().handle();
  const got = await pageArtPlacements(handle, 5);
  same("a page parsed without placements is read live", boxes(got), await liveBoxes(5));
  ok("and the live answer carries the image's name", got.length === 1 && got[0].name.startsWith("img_"));
  ok("the PDF was fetched once; the text is not parsed again", w.gets(".pdf") === 1 && w.uploads.length === 1);
  await handle.destroy();

  // A saved file with no placements at all (written before they were saved).
  const v = world();
  await v.seat().handle().verify();
  const pointer = v.journals.rr.pointer;
  const body = JSON.parse(v.files.get(pointer.file).text);
  delete body.placements;
  v.files.set(pointer.file, { text: JSON.stringify(body) });
  v.log.length = 0;
  const older = v.seat().handle();
  same("a file without placements answers from the live page", boxes(await pageArtPlacements(older, 3)), await liveBoxes(3));
  ok("its text is still read from the file", v.gets(".pdf") === 1 && v.uploads.length === 1 && JSON.stringify(await pageItems(older, 2)).includes("ed A"));
  await older.destroy();

  // A book that is gone is refused and not opened by another road.
  const g = world();
  await g.seat().handle().verify();
  g.files.delete(PDF);
  g.log.length = 0;
  g.opens = 0;
  const gone = g.seat().handle();
  const warn = console.warn;
  console.warn = () => {};
  try {
    await assert.rejects(() => pageArtPlacements(gone, 3), /404/);
    pass++;
  } finally {
    console.warn = warn;
  }
  ok("a gone file's placements are not opened live or read from the saved file", g.opens === 0 && g.gets(".pdf") === 0 && g.gets(".json") === 0);
}

/* --- a re-pointed page: nothing of the old file answers --------------------------------------- */

/** Re-point the journal at a second file whose text is another edition. */
const repoint = (w) => {
  w.files.set("books/rr-2.pdf", { bytes: 2048 });
  w.journals.rr.src = "books/rr-2.pdf";
  w.edition = "B";
};
const said = async (handle, n) => JSON.stringify(await pageItems(handle, n));

{
  // A handle registered before the re-point, before anything was parsed.
  const w = world();
  const stale = w.seat().handle(PDF);
  repoint(w);
  ok("a stale handle verifies against the new file", (await stale.verify()) === true);
  ok("it fetched the new file and never the old", w.gets("/rr-2.pdf") === 1 && w.gets("/rr.pdf") === 0, w.log.join(" | "));
  ok("the pointer names the new file's src and size", w.journals.rr.pointer.src === "books/rr-2.pdf" && w.journals.rr.pointer.bytes === 2048 && stale.src === "books/rr-2.pdf");
  ok("its text is the new file's", (await said(stale, 3)).includes("ed B"));
  await stale.destroy();
}

{
  // A handle that has read and holds the old text, a placement and a vouching.
  const w = world();
  const handle = w.seat().handle();
  ok("before the re-point it reads the old edition", (await said(handle, 3)).includes("ed A") && handle.verified);
  const oldPointer = w.journals.rr.pointer;
  repoint(w);
  w.log.length = 0;
  const text = await said(handle, 3);
  ok("after it, the text is the new edition's and the old text answers for nothing", text.includes("ed B") && !text.includes("ed A"));
  ok("the old saved file was not read again, nor the old PDF fetched", !w.log.includes(`GET ${oldPointer.file}`) && w.gets("/rr.pdf") === 0, w.log.join(" | "));
  ok("the new file was parsed into a new saved file and the old one stays", w.uploads.length === 2 && w.files.has(oldPointer.file) && w.journals.rr.pointer.file !== oldPointer.file);
  same("its placements are the new file's", boxes(await pageArtPlacements(handle, 3)), await liveBoxes(3, "B"));
  ok("and came from that file, not from an open", w.gets("/rr.pdf") === 0);
  await handle.destroy();
}

{
  // A player seat registered on the old path, before any GM has parsed the new file.
  const w = world();
  await w.seat().handle().verify();
  const player = w.seat({ isGM: false }).handle(PDF);
  ok("a player reads the saved text before the re-point", (await said(player, 3)).includes("ed A"));
  repoint(w);
  w.log.length = 0;
  w.opens = 0;
  ok("after it the player reads the new file", (await said(player, 3)).includes("ed B"));
  ok("live, since no saved text of it exists, and saving nothing", w.opens === 1 && w.gets("/rr-2.pdf") === 1 && w.uploads.length === 1 && w.pointerWrites === 1);
  ok("the old saved file is not read", !w.log.some((l) => l.includes("books/parsed/")), w.log.join(" | "));
  const live = await pageArtPlacements(player, 3);
  ok("its placements come from the new PDF, named", live.length === 2 && live[0].name.startsWith("g_d"));
  await player.destroy();
}

{
  // The journal moves while the old file is being read: the parse is not recorded, and the handle ends on the new file.
  const w = world();
  const fetchImpl = w.fetchImpl;
  w.fetchImpl = async (path, init = {}) => {
    const resp = await fetchImpl(path, init);
    if (path === PDF && !init.method && w.journals.rr.src === PDF) repoint(w);
    return resp;
  };
  const handle = w.seat().handle(PDF);
  ok("a read that began on the old file is answered from the new", (await said(handle, 3)).includes("ed B"));
  ok("no pointer was written for the old file's parse", w.journals.rr.pointer === null || w.journals.rr.pointer.src === "books/rr-2.pdf");
  await handle.destroy();
}

{
  // A file this seat connected on purpose is its own until the journal moves.
  const w = world();
  const handle = w.seat().handle();
  const adopted = fakeDoc(7, 60, "C");
  handle.adopt({ doc: adopted, numPages: 7, title: "Connected", src: "books/connected.pdf" });
  ok("a connected file reads as itself while the journal is where it was", (await said(handle, 3)).includes("ed C") && handle.isLive && handle.verified);
  ok("and fetches nothing, makes no text, writes no pointer", w.log.length === 0 && w.uploads.length === 0 && w.pointerWrites === 0, w.log.join(" | "));
  w.files.set("books/connected.pdf", { bytes: 3000 });
  w.journals.rr.src = "books/connected.pdf";
  await handle.verify();
  ok("a journal that moves to the connected path leaves the connected file in place", handle.isLive && adopted.destroyed === 0 && w.gets("/rr.pdf") === 0, w.log.join(" | "));
  repoint(w);
  w.log.length = 0;
  ok("a journal that moves to another path takes the handle with it", (await said(handle, 3)).includes("ed B") && handle.src === "books/rr-2.pdf" && adopted.destroyed === 1);
  ok("and reads that path, never the connected one", w.gets("/connected.pdf") === 0 && w.gets("/rr-2.pdf") === 1, w.log.join(" | "));
  await handle.destroy();
}

{
  // Bytes of one file are never recorded as another's text.
  const w = world();
  w.journals.rr.src = "books/rr-2.pdf";
  await assert.rejects(() => w.seat().parsed.prepare("rr", { getBytes: async () => new ArrayBuffer(PDF_BYTES), src: PDF }), /not of the shelf/);
  pass++;
  ok("a parse of the old path's bytes writes neither a file nor a pointer", w.uploads.length === 0 && w.pointerWrites === 0);
}

/* --- walls ride in the saved file ------------------------------------------------------------- */

const viaJson = (value) => JSON.parse(JSON.stringify(value));
const [MAP_A, MAP_B] = [walledScenes()[1], walledScenes()[0]];
const makeTrace = (doc, recipe) => world().traceOf(doc, recipe);
const parseOf = (o = {}) => parseDocument(fakeDoc(7, 5), { book: "rr", src: PDF, bytes: PDF_BYTES, title: "T", wallScenes: walledScenes(), trace: async (doc, recipe) => makeTrace(doc, recipe), ...o });

{
  const traced = [];
  const saved = await parseOf({ trace: async (doc, recipe) => (traced.push(doc), makeTrace(doc, recipe)) });
  same("walls are keyed by scene id, in order", Object.keys(saved.walls), ["rr.mapA", "rr.mapB"]);
  ok("each scene's trace was made on the document being parsed", traced.length === 2 && traced.every((d) => d.numPages === 7 && d.edition === "A"));
  same("an entry holds the inputs, the walls and the digest", Object.keys(saved.walls["rr.mapA"]), ["inputs", "walls", "digest"]);
  ok("its inputs are the recipe's", saved.walls["rr.mapA"].inputs === wallTraceInputs(MAP_A.recipe));
  const book = new SavedBook(viaJson(saved), { book: "rr", stamp: PARSE_STAMP, src: PDF, bytes: PDF_BYTES, numPages: 7 });
  const live = makeTrace(fakeDoc(7, 77), MAP_A.recipe);
  same("a saved trace is the live trace's value after the file's round trip", book.walls("rr.mapA", wallTraceInputs(MAP_A.recipe)), viaJson(live));
  ok("a terrain wall keeps its mark and a door its type", book.walls("rr.mapA", wallTraceInputs(MAP_A.recipe)).walls[1].terrain === true && book.walls("rr.mapA", wallTraceInputs(MAP_A.recipe)).walls[1].door === 1);
  ok("a trace made from other inputs answers nothing", book.walls("rr.mapA", wallTraceInputs({ ...MAP_A.recipe, walls: { ...MAP_A.recipe.walls, threshold: 161 } })) === null);
  ok("a scene the file does not hold answers nothing", book.walls("rr.mapC", wallTraceInputs(MAP_A.recipe)) === null && book.walls("__proto__", wallTraceInputs(MAP_A.recipe)) === null);
  ok("one scene's trace never answers for another's inputs", book.walls("rr.mapA", wallTraceInputs(MAP_B.recipe)) === null);
  book.walls("rr.mapA", wallTraceInputs(MAP_A.recipe)).walls[0].c[0] = 0;
  ok("a caller's edit never reaches the next read", book.walls("rr.mapA", wallTraceInputs(MAP_A.recipe)).walls[0].c[0] === 3.1);
  same("the file is the same whichever open wrote it, in whatever order the scenes were listed", JSON.stringify(saved), JSON.stringify(await parseOf({ wallScenes: walledScenes().reverse() })));
  const bare = await parseDocument(fakeDoc(7, 5), { book: "rr", src: PDF, bytes: PDF_BYTES, title: "T" });
  same("the text and placements are the same with or without walls", { ...saved, walls: undefined }, { ...bare, walls: undefined });
  ok("a book with no walled scene saves an empty map", Object.keys(bare.walls).length === 0);

  // A trace that fails or throws is left out, and the rest of the file is kept.
  const warn = console.warn;
  console.warn = () => {};
  let none;
  let one;
  try {
    none = await parseOf({ trace: async (doc, recipe) => (recipe.page === 3 ? null : Promise.reject(new Error("trace"))) });
    one = await parseOf({ trace: async (doc, recipe) => (recipe.page === 5 ? Promise.reject(new Error("trace")) : makeTrace(doc, recipe)) });
  } finally {
    console.warn = warn;
  }
  same("a scene whose trace throws is left out and the other kept", Object.keys(one.walls), ["rr.mapA"]);
  ok("a scene whose render failed, or whose trace threw, is not saved as empty", Object.keys(none.walls).length === 0 && none.pages.length === 7);
}

/* --- a rebuild reads the saved walls and opens no PDF ----------------------------------------- */

{
  const w = world();
  const first = w.seat().handle();
  await first.verify();
  ok("the first read made the saved text, tracing both scenes in the parse's one open", w.traced === 2 && w.opens === 1 && w.uploads.length === 1 && w.gets(".pdf") === 1);
  const got = await sceneWallTrace(first, MAP_A.id, MAP_A.recipe, w.liveTrace);
  same("its answer is the saved trace, which is the live trace after the round trip", got, { traced: viaJson(w.traceOf(fakeDoc(7, 77), MAP_A.recipe)), saved: true });
  ok("it made no second trace", w.liveTraces === 0 && w.traced === 2);
  same("the file holds both scenes' walls", Object.keys(JSON.parse(w.uploads[0].text).walls), ["rr.mapA", "rr.mapB"]);
  await first.destroy();

  // A reload, and an Adventure rebuild: every walled scene's walls asked, its pictures already cached.
  w.log.length = 0;
  w.opens = 0;
  w.traced = 0;
  const next = w.seat().handle();
  const asked = await Promise.all(walledScenes().map(({ id, recipe }) => sceneWallTrace(next, id, recipe, w.liveTrace)));
  ok("every answer is a saved trace", asked.every((a) => a.saved && a.traced.walls.length === 2));
  same("and equals the live trace", asked.map((a) => a.traced), walledScenes().map(({ recipe }) => viaJson(w.traceOf(fakeDoc(7, 77), recipe))));
  ok("the walls of the plan of storeys keep their digest", asked[0].traced.digest.mode === "stroke");
  ok("no PDF was fetched, none opened, and nothing traced", w.gets(".pdf") === 0 && w.opens === 0 && w.liveTraces === 0 && w.traced === 0 && !next.isLive, w.log.join(" | "));
  ok("the book was asked one HEAD and its saved file read once", w.heads() === 1 && w.log.filter((l) => l.startsWith("GET books/parsed/")).length === 1, w.log.join(" | "));
  ok("nothing was saved again", w.uploads.length === 1 && w.pointerWrites === 1);

  // Walls, placements and text come from the one file.
  ok("placements and text are read from the same file with no PDF", boxes(await pageArtPlacements(next, 3)).length === 2 && JSON.stringify(await pageItems(next, 2)).includes("ed A") && w.gets(".pdf") === 0);

  // Inputs that differ from the saved ones: the PDF is opened and the page traced live.
  const edited = { ...MAP_A.recipe, walls: { ...MAP_A.recipe.walls, corrections: [{ cell: [2, 2], is: "open" }] } };
  const live = await sceneWallTrace(next, MAP_A.id, edited, w.liveTrace);
  ok("a recipe edited since the parse is traced live", live.saved === false && w.liveTraces === 1 && w.opens === 1 && w.gets(".pdf") === 1 && next.isLive);
  ok("and its answer is a live trace's", live.traced.digest.edition === "A" && live.traced.walls[0].c[0] === 3.1);
  const grown = await sceneWallTrace(next, MAP_A.id, { ...MAP_A.recipe, crop: { ...MAP_A.recipe.crop, w: 101 } }, w.liveTrace);
  ok("so is a recipe whose crop moved", grown.saved === false && w.liveTraces === 2);
  const unsaved = await sceneWallTrace(next, "rr.mapZ", MAP_A.recipe, w.liveTrace);
  ok("so is a scene the file never traced", unsaved.saved === false && w.liveTraces === 3);
  await next.destroy();

  // A player seat reads the same file.
  w.log.length = 0;
  w.opens = 0;
  const player = w.seat({ isGM: false }).handle();
  const read = await sceneWallTrace(player, MAP_B.id, MAP_B.recipe, w.liveTrace);
  ok("a player seat reads the GM's saved walls without the PDF", read.saved && w.gets(".pdf") === 0 && w.opens === 0 && w.liveTraces === 3);
  await player.destroy();

  // A document that is no handle is traced live.
  const direct = await sceneWallTrace(fakeDoc(7, 90), MAP_A.id, MAP_A.recipe, w.liveTrace);
  ok("a pdf.js document is traced live", direct.saved === false && w.liveTraces === 4);
}

/* --- walls missing: the PDF answers ---------------------------------------------------------- */

{
  // The scene was not walled when the text was parsed.
  const w = world();
  w.wallScenes = [walledScenes()[1]];
  await w.seat().handle().verify();
  w.log.length = 0;
  w.opens = 0;
  const handle = w.seat().handle();
  const a = await sceneWallTrace(handle, MAP_A.id, MAP_A.recipe, w.liveTrace);
  const b = await sceneWallTrace(handle, MAP_B.id, MAP_B.recipe, w.liveTrace);
  ok("the scene the parse traced is read, the one it did not is traced live", a.saved && !b.saved && w.liveTraces === 1);
  ok("the PDF was fetched once and the text not parsed again", w.gets(".pdf") === 1 && w.uploads.length === 1);
  await handle.destroy();

  // A saved file with no walls at all, under a current stamp.
  const v = world();
  await v.seat().handle().verify();
  const body = JSON.parse(v.files.get(v.journals.rr.pointer.file).text);
  delete body.walls;
  v.files.set(v.journals.rr.pointer.file, { text: JSON.stringify(body) });
  const older = v.seat().handle();
  ok("a file with no walls answers from the live page", (await sceneWallTrace(older, MAP_A.id, MAP_A.recipe, v.liveTrace)).saved === false && v.liveTraces === 1);
  ok("its text is still read from the file", JSON.stringify(await pageItems(older, 2)).includes("ed A") && v.uploads.length === 1);
  await older.destroy();

  // A book that is gone is refused and not opened by another road.
  const g = world();
  await g.seat().handle().verify();
  g.files.delete(PDF);
  g.log.length = 0;
  g.opens = 0;
  const gone = g.seat().handle();
  const warn = console.warn;
  console.warn = () => {};
  try {
    await assert.rejects(() => sceneWallTrace(gone, MAP_A.id, MAP_A.recipe, g.liveTrace), /404/);
    pass++;
  } finally {
    console.warn = warn;
  }
  ok("a gone file's walls are neither opened live nor read from the saved file", g.opens === 0 && g.liveTraces === 0 && g.gets(".json") === 0);
}

/* --- a re-pointed page: the old file's walls answer nothing ----------------------------------- */

{
  const w = world();
  const handle = w.seat().handle();
  ok("before the re-point the walls are the old edition's", (await sceneWallTrace(handle, MAP_A.id, MAP_A.recipe, w.liveTrace)).traced.digest.edition === "A");
  const oldPointer = w.journals.rr.pointer;
  repoint(w);
  w.log.length = 0;
  const after = await sceneWallTrace(handle, MAP_A.id, MAP_A.recipe, w.liveTrace);
  ok("after it they are the new file's, from its own parse", after.saved && after.traced.digest.edition === "B" && w.journals.rr.pointer.file !== oldPointer.file);
  ok("the old saved file was not read again", !w.log.includes(`GET ${oldPointer.file}`), w.log.join(" | "));
  await handle.destroy();
}

/* --- the inputs of a trace --------------------------------------------------------------------- */

{
  const base = MAP_B.recipe;
  const key = wallTraceInputs(base);
  ok("the inputs are a string that names the tracer's version", typeof key === "string" && key.includes(`"tracer":${WALL_TRACE_VERSION}`));
  const changed = {
    page: { ...base, page: 6 },
    crop: { ...base, crop: { ...base.crop, x: 31 } },
    levels: { ...base, levels: [{ x: 30, y: 301 }] },
    "dropped levels": { ...base, levels: undefined },
    grid: { ...base, grid: { ...base.grid, box: { w: 11, h: 10 } } },
    walls: { ...base, walls: { ...base.walls, threshold: 151 } },
    "correction": { ...base, walls: { ...base.walls, corrections: [{ cell: [0, 0], is: "open" }] } },
  };
  for (const [name, recipe] of Object.entries(changed)) ok(`a changed ${name} changes the inputs`, wallTraceInputs(recipe) !== key);
  const respelt = { walls: { threshold: 150, mode: "stroke" }, grid: { distance: 5, box: { h: 10, w: 10 }, family: "square" }, levels: base.levels, crop: { h: 80, w: 120, y: 40, x: 30 }, page: 5 };
  ok("the order a recipe's keys are written in changes nothing", wallTraceInputs(respelt) === key);
  ok("what the trace does not read changes nothing", wallTraceInputs({ ...base, cite: "x", placement: { x: 1, y: 2, w: 3, h: 4 }, name: "other" }) === key);
}

/* --- a stamp bump invalidates ----------------------------------------------------------------- */

{
  ok("the stamp names schema 3, which added walls", PARSE_STAMP.startsWith("p3-"));
  const w = world();
  await w.seat().handle().verify();
  const firstFile = w.journals.rr.pointer.file;
  // The pointer a build before walls wrote.
  w.journals.rr.pointer = { ...w.journals.rr.pointer, stamp: PARSE_STAMP.replace(/^p\d+/, "p2") };
  ok("an older schema's pointer is not current", w.seat().parsed.pointer("rr") === null);

  w.log.length = 0;
  const player = w.seat({ isGM: false }).handle();
  ok("a player seat does not read the older file", (await said(player, 2)).includes("ed A") && !w.log.some((l) => l.includes("books/parsed/")) && w.uploads.length === 1);
  await player.destroy();

  const gm = w.seat().handle();
  same("a GM seat parses again and answers the placements from the new file", boxes(await pageArtPlacements(gm, 3)), await liveBoxes(3));
  ok("under a new name, with the current stamp", w.uploads.length === 2 && w.journals.rr.pointer.stamp === PARSE_STAMP && w.journals.rr.pointer.file !== firstFile);
  await gm.destroy();
}

console.log(`test-parsed-book: ${pass} checks passed`);
