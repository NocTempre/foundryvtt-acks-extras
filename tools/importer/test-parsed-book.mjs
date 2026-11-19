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
 * and a failed upload never fails a read. Every text in it is invented.
 */
import assert from "node:assert";
import { createHash } from "node:crypto";
import { BookHandle } from "../../scripts/importer/book-handle.mjs";
import { ParsedBooks, PARSE_STAMP, SavedBook, fontId, parseDocument } from "../../scripts/importer/parsed-book.mjs";
import { pageItems } from "../../scripts/importer/extract.mjs";
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
function runsOf(n, doc) {
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
    run(`line of page ${n}`, 72, H - 140, 90.0625, 9.5, f),
    run(String(n), 300, 20, 6, 8, f),
  ];
}

/** An invented document of `numPages` pages; `docNo` is the counter pdf.js puts in a font id. */
function fakeDoc(numPages, docNo) {
  const doc = {
    numPages,
    destroyed: 0,
    async getPage(n) {
      if (n < 1 || n > numPages) throw new Error("no such page");
      return {
        getViewport: () => ({ width: 612, height: H }),
        getTextContent: async () => ({ items: runsOf(n, docNo) }),
        getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
      };
    },
    async destroy() {
      doc.destroyed++;
    },
  };
  return doc;
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
        const doc = fakeDoc(w.pages, w.opens++);
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
          const doc = fakeDoc(w.pages, w.opens++);
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

console.log(`test-parsed-book: ${pass} checks passed`);
