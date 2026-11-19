/**
 * A shelved book's text layer, parsed once and saved: the file a seat reads
 * instead of opening the PDF.
 *
 * One JSON file per shelved book, written by `FilePicker.upload` under the
 * shelf directory, holds what `pageItems` consumes from pdf.js: per page its
 * size and its text runs, after `textRuns` (empty runs and coincident
 * duplicates gone, the word-space boundary kept as `sp`), at full precision,
 * and for the pages a scene recipe names the boxes of their placed images.
 * Furniture, typography and `fuseRuns` still run when the page is read, so a
 * change to `extract.mjs` never invalidates a saved book; only a change to
 * `textRuns`, to this shape (`PARSE_SCHEMA`) or to the pdf.js build (its
 * version rides the stamp) does.
 *
 *   header  {book, stamp, src, bytes, numPages, title, fonts, placements}
 *   page    [width, height, runs]
 *   run     [str, x, y, width, height, font, sp]   x, y the text matrix's
 *           translation (pdf.js's own origin), font an index into `fonts`
 *   placements  {"<page>": [{x, y, w, h}]}   top-origin page points, as
 *           `placementsOfPage` gives them without the image's name. A page
 *           absent from the map was not saved and is read live; `[]` is a page
 *           saved with no image on it.
 *
 * The file carries no time and no seat, so two seats parsing one PDF write the
 * same bytes under different names. Foundry overwrites no non-media file and
 * deletes none, so every attempt is named uniquely and a stale file stays.
 *
 * What makes a file the book's current text is a pointer on the shelf journal
 * (`{stamp, file, src, bytes, numPages, title}`), current while its `src` is
 * the journal's PDF page and its stamp is this build's. The pointer is written
 * after the file is up. Only a GM seat parses (`canParse`); a player seat reads
 * a current file and otherwise opens the PDF.
 *
 * Fetch, upload, open and the journal are injected, so this holds no Foundry
 * and no PDF engine beyond the version stamp.
 */
import { version } from "../../vendor/pdfjs/pdf.mjs";
import { placementsOfPage, textRuns } from "./extract.mjs";
import { releaseDoc } from "./release-doc.mjs";

/**
 * The shape of a saved book, bumped with the shape or with `textRuns` or
 * `placementsOfPage`; part of the stamp. 2 added `placements`: a file of
 * schema 1 is read by no seat and its book is parsed again on the next GM read.
 */
export const PARSE_SCHEMA = 2;

/** What a saved book is stamped with: this schema over this pdf.js build. A file with any other stamp is not read. */
export const PARSE_STAMP = `p${PARSE_SCHEMA}-${version}`;

/**
 * A font id as it is saved. pdf.js numbers a font by the document that loaded
 * it (`g_d3_f1`), a counter that runs on across every open in a page, so the
 * same file read twice names its fonts differently. The id is only ever
 * compared within one document, so the document number goes and the load
 * order, which is the same on every open that reads pages in order, stays.
 */
export const fontId = (name) => (typeof name === "string" ? name.replace(/^(g_)?d\d+_/, "$1") : name);

/**
 * Parse every page of an open document into the saved form. Pages are read in
 * order from this open and no other, since the font ids depend on the order
 * fonts load.
 *
 * @param {object} doc a freshly opened pdf.js document
 * @param {object} o
 * @param {string} o.book the registry id
 * @param {string} o.src the path the file is served from
 * @param {number} o.bytes the file's size in bytes
 * @param {string} o.title the document's own title
 * @param {number[]} [o.placementPages] the 1-based pages whose image placements are saved; a page the document lacks is skipped
 * @param {string} [o.stamp]
 * @param {(page: number, total: number) => void} [o.onPage] called after each page is read
 * @returns {Promise<object>} the saved book, ready for `JSON.stringify`
 */
export async function parseDocument(doc, { book, src, bytes, title, placementPages = [], stamp = PARSE_STAMP, onPage = null }) {
  const fonts = [];
  const fontIx = new Map();
  const indexOf = (name) => {
    const id = fontId(name) ?? "";
    if (!fontIx.has(id)) fontIx.set(id, fonts.push(id) - 1);
    return fontIx.get(id);
  };
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const runs = textRuns(await page.getTextContent());
    pages.push([
      vp.width,
      vp.height,
      runs.map((it) => [it.str, it.transform[4], it.transform[5], it.width, it.height, indexOf(it.fontName), it.spaceBefore === true ? 1 : 0]),
    ]);
    page.cleanup?.();
    onPage?.(n, doc.numPages);
  }
  // After every page's text, so the order fonts load in, and the names they get, are the text pass's alone.
  const placements = {};
  for (const n of [...new Set(placementPages)].filter((n) => Number.isInteger(n) && n >= 1 && n <= doc.numPages).sort((a, b) => a - b)) {
    try {
      const page = await doc.getPage(n);
      placements[n] = (await placementsOfPage(page)).map(({ x, y, w, h }) => ({ x, y, w, h }));
      page.cleanup?.();
    } catch (err) {
      // A page whose operators cannot be read is left out, and a read of it opens the PDF.
      console.warn(`acks-extras | ${book}: the images of page ${n} could not be saved`, err);
    }
  }
  return { book, stamp, src, bytes, numPages: doc.numPages, title, fonts, pages, placements };
}

/** One saved page, answering the two calls `pageItems` makes of a pdf.js page. */
class SavedPage {
  #fonts;
  #entry;

  constructor(entry, fonts) {
    this.#entry = entry;
    this.#fonts = fonts;
  }

  getViewport() {
    return { width: this.#entry[0], height: this.#entry[1] };
  }

  /** Fresh items on every call: `textRuns` marks the items it is handed. */
  async getTextContent() {
    return {
      items: this.#entry[2].map(([str, x, y, width, height, font, sp]) => ({
        str,
        transform: [1, 0, 0, 1, x, y],
        width,
        height,
        fontName: this.#fonts[font],
        ...(sp ? { spaceBefore: true } : {}),
      })),
    };
  }

  /** A saved page holds text only; pixel readers take the live document. */
  getOperatorList() {
    throw new Error("a saved page holds no operator list");
  }

  render() {
    throw new Error("a saved page cannot be rendered");
  }
}

/** A saved book read back: the doc-shaped surface `pageItems` and `footerProfile` use, over the text alone. */
export class SavedBook {
  #json;

  /**
   * @param {object} json the parsed file
   * @param {object} [expect] the pointer (and book) the file must answer; a mismatch throws
   */
  constructor(json, expect = null) {
    if (!json || !Array.isArray(json.pages) || !Array.isArray(json.fonts)) throw new Error("not a saved book");
    if (json.pages.length !== json.numPages) throw new Error("a saved book's page count does not match its pages");
    for (const key of ["book", "stamp", "src", "bytes", "numPages"]) {
      if (expect && key in expect && json[key] !== expect[key]) throw new Error(`a saved book's ${key} is not the pointer's`);
    }
    this.#json = json;
  }

  get numPages() {
    return this.#json.numPages;
  }

  get title() {
    return this.#json.title;
  }

  /**
   * The saved placements of a page, or null when this file does not hold the
   * page's (an older recipe set, a page that could not be read). A copy, so a
   * caller's edit never reaches the next reader.
   * @param {number} n 1-based
   * @returns {{x: number, y: number, w: number, h: number}[]|null}
   */
  placements(n) {
    const boxes = this.#json.placements?.[n];
    return Array.isArray(boxes) ? boxes.map((b) => ({ ...b })) : null;
  }

  /** @param {number} n 1-based */
  async getPage(n) {
    const entry = this.#json.pages[n - 1];
    if (!entry) throw new Error(`page ${n} is not in the saved book`);
    return new SavedPage(entry, this.#json.fonts);
  }
}

/**
 * The saved books of a world: which one is current for a book, how it is
 * read, and how it is made.
 */
export class ParsedBooks {
  #stamp;
  #fetch;
  #isGM;
  #srcOf;
  #placementPagesOf;
  #pointerOf;
  #writePointer;
  #upload;
  #open;
  #attempt;
  #flights = new Map();
  #progress = new Map();
  #onChange;

  /**
   * @param {object} o
   * @param {() => boolean} o.isGM whether this seat is a GM's
   * @param {(bookId: string) => string|null} o.srcOf the path of the shelf journal's PDF page now; null when the book is not shelved
   * @param {(bookId: string) => number[]} [o.placementPagesOf] the pages whose image placements a parse saves, read when a parse starts (the recipes load after this is built)
   * @param {(bookId: string) => object|null} o.pointerOf the pointer stored on the shelf journal
   * @param {(bookId: string, pointer: object) => Promise<void>} o.writePointer store a pointer on the shelf journal
   * @param {(name: string, text: string) => Promise<string>} o.upload put a file under the saved-books directory; resolves its path
   * @param {(bookId: string, buffer: ArrayBuffer) => Promise<{doc: object, numPages: number, title: string}>} o.open open and fingerprint the bytes; rejects for another book
   * @param {() => string} o.attempt a token no other attempt shares, for the file name
   * @param {typeof fetch} [o.fetchImpl]
   * @param {string} [o.stamp]
   * @param {(bookId: string, kind: "state"|"progress") => void} [o.onChange] told when a run starts or ends ("state") and after each page it reads ("progress")
   */
  constructor({ isGM, srcOf, placementPagesOf = () => [], pointerOf, writePointer, upload, open, attempt, fetchImpl = (...args) => globalThis.fetch(...args), stamp = PARSE_STAMP, onChange = null }) {
    this.#onChange = onChange;
    this.#isGM = isGM;
    this.#srcOf = srcOf;
    this.#placementPagesOf = placementPagesOf;
    this.#pointerOf = pointerOf;
    this.#writePointer = writePointer;
    this.#upload = upload;
    this.#open = open;
    this.#attempt = attempt;
    this.#fetch = fetchImpl;
    this.#stamp = stamp;
  }

  get stamp() {
    return this.#stamp;
  }

  /**
   * The pointer for a book when it is current: this build's stamp, and a `src`
   * that is the journal's PDF page now. A re-staged book or an older build
   * answers null.
   */
  pointer(bookId) {
    const pointer = this.#pointerOf(bookId);
    const src = this.#srcOf(bookId);
    if (!pointer || !src || pointer.stamp !== this.#stamp || pointer.src !== src) return null;
    if (typeof pointer.file !== "string" || !pointer.file || !(pointer.numPages > 0) || !(pointer.bytes > 0)) return null;
    return pointer;
  }

  /** The path of the shelf journal's PDF page now; null when the book is not shelved. A handle follows it when its own path goes stale. */
  shelfSrc(bookId) {
    return this.#srcOf(bookId);
  }

  /** Whether this seat may make a saved book: a GM seat, for a shelved book. */
  canParse(bookId) {
    return !!this.#isGM() && !!this.#srcOf(bookId);
  }

  /** Whether a book can have saved text at all, on any seat: it is shelved and not a form. */
  savable(bookId) {
    return !!this.#srcOf(bookId);
  }

  /**
   * The pointer the shelf journal holds, current or not; null when none was
   * ever written. A stored pointer that `pointer` refuses is a stale one.
   */
  stored(bookId) {
    return this.#pointerOf(bookId) ?? null;
  }

  /** The path the shelf journal's PDF page names now; null when the book is not shelved. */
  src(bookId) {
    return this.#srcOf(bookId) ?? null;
  }

  /**
   * The page a run on this seat has reached and the book's page count, or null
   * while none has read a page, and for a run of a file that is no longer the
   * journal's PDF page (the guard at the run's end refuses its result).
   */
  progress(bookId) {
    const reached = this.#progress.get(bookId);
    if (!reached || reached.src !== this.#srcOf(bookId)) return null;
    return { page: reached.page, total: reached.total };
  }

  #changed(bookId, kind) {
    try {
      this.#onChange?.(bookId, kind);
    } catch (err) {
      console.warn("acks-extras | a saved-book listener failed", err);
    }
  }

  /** Whether a run is making this book's text now, from any caller on this seat. */
  reading(bookId) {
    return this.#flights.has(bookId);
  }

  /**
   * Read the saved book a pointer names. Rejects when the file is gone or is
   * not the book the pointer says, and the reader then opens the PDF.
   */
  async read(bookId, pointer = this.pointer(bookId)) {
    if (!pointer) throw new Error(`${bookId}: no saved text is current`);
    const resp = await this.#fetch(pointer.file);
    if (!resp?.ok) throw new Error(`${bookId}: could not read ${pointer.file} (${resp?.status})`);
    return new SavedBook(await resp.json(), { ...pointer, book: bookId });
  }

  /**
   * Make a book's saved text: fetch the PDF, open and fingerprint it, parse
   * every page, upload the file, then write the pointer. One run per book at a
   * time; a second caller takes the first's result. A book whose pointer is
   * already current is not parsed again, unless `force` asks for a fresh run:
   * the old file stays where it is and the pointer moves only once the new one
   * is up, so a failed run leaves the book as it was. A forced call that finds
   * an unforced run in flight starts after it rather than taking its result.
   *
   * @param {string} bookId
   * @param {object} [o]
   * @param {() => Promise<ArrayBuffer>} [o.getBytes] the file's bytes where the caller holds them, else the shelved path is fetched
   * @param {string|null} [o.src] the path those bytes are of; the parse refuses unless it is the journal's PDF page now, since a pointer names the file of the page and a parse of another file would be served as its text
   * @param {boolean} [o.force] parse again although the pointer is current
   * @returns {Promise<{pointer: object, fresh: boolean}>} `fresh` says this run opened and fingerprinted the file
   */
  prepare(bookId, { getBytes = null, src = null, force = false } = {}) {
    let flight = this.#flights.get(bookId);
    if (flight && force && !flight.force) {
      const after = flight.promise.catch(() => {});
      flight = this.#fly(bookId, after.then(() => this.#prepare(bookId, getBytes, src, true)), true);
    } else if (!flight) {
      flight = this.#fly(bookId, this.#prepare(bookId, getBytes, src, force), force);
    }
    return flight.promise;
  }

  /** Record a run as the book's flight until it settles; `reading` answers from it. */
  #fly(bookId, run, force) {
    const flight = { force, promise: null };
    flight.promise = run.finally(() => {
      if (this.#flights.get(bookId) === flight) {
        this.#flights.delete(bookId);
        this.#progress.delete(bookId);
        this.#changed(bookId, "state");
      }
    });
    this.#flights.set(bookId, flight);
    this.#changed(bookId, "state");
    return flight;
  }

  async #prepare(bookId, getBytes, bytesSrc, force = false) {
    if (!this.canParse(bookId)) throw new Error(`${bookId}: this seat does not make saved text`);
    const current = force ? null : this.pointer(bookId);
    if (current) return { pointer: current, fresh: false };
    const src = this.#srcOf(bookId);
    if (bytesSrc && bytesSrc !== src) throw new Error(`${bookId}: the bytes are of ${bytesSrc}, not of the shelf's ${src}`);
    const buffer = await (getBytes ?? (() => this.#fetchBytes(src)))();
    // The open hands the buffer to pdf.js, which detaches it.
    const bytes = buffer.byteLength;
    const { doc, numPages, title } = await this.#open(bookId, buffer);
    let saved;
    try {
      saved = await parseDocument(doc, {
        book: bookId,
        src,
        bytes,
        title,
        placementPages: this.#placementPagesOf(bookId) ?? [],
        stamp: this.#stamp,
        onPage: (page, total) => {
          this.#progress.set(bookId, { page, total, src });
          this.#changed(bookId, "progress");
        },
      });
    } finally {
      await releaseDoc(doc);
    }
    const file = await this.#upload(`${bookId}-${this.#stamp}-${this.#attempt()}.json`, JSON.stringify(saved));
    // A book re-staged while it parsed is another file: the pointer would name a parse of the old one.
    if (this.#srcOf(bookId) !== src) throw new Error(`${bookId}: its file changed while it was parsed`);
    const pointer = { stamp: this.#stamp, file, src, bytes, numPages, title };
    await this.#writePointer(bookId, pointer);
    return { pointer, fresh: true };
  }

  async #fetchBytes(src) {
    const resp = await this.#fetch(src);
    if (!resp?.ok) throw new Error(`could not read ${src} (${resp?.status})`);
    return resp.arrayBuffer();
  }
}
