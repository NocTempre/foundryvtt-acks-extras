/**
 * A shelved book's text layer, parsed once and saved: the file a seat reads
 * instead of opening the PDF.
 *
 * One JSON file per shelved book, written by `FilePicker.upload` under the
 * shelf directory, holds what `pageItems` consumes from pdf.js: per page its
 * size and its text runs, after `textRuns` (empty runs and coincident
 * duplicates gone, the word-space boundary kept as `sp`), at full precision.
 * Furniture, typography and `fuseRuns` still run when the page is read, so a
 * change to `extract.mjs` never invalidates a saved book; only a change to
 * `textRuns`, to this shape (`PARSE_SCHEMA`) or to the pdf.js build (its
 * version rides the stamp) does.
 *
 *   header  {book, stamp, src, bytes, numPages, title, fonts}
 *   page    [width, height, runs]
 *   run     [str, x, y, width, height, font, sp]   x, y the text matrix's
 *           translation (pdf.js's own origin), font an index into `fonts`
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
import { textRuns } from "./extract.mjs";

/** The shape of a saved book, bumped with the shape or with `textRuns`; part of the stamp. */
export const PARSE_SCHEMA = 1;

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
 * Release a pdf.js document. The document proxy has no `destroy`; its loading
 * task does, and ends the worker's copy of the file. A stand-in with a
 * `destroy` of its own is released through that.
 */
export const releaseDoc = (doc) => Promise.resolve(doc?.loadingTask?.destroy ? doc.loadingTask.destroy() : doc?.destroy?.());

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
 * @param {string} [o.stamp]
 * @returns {Promise<object>} the saved book, ready for `JSON.stringify`
 */
export async function parseDocument(doc, { book, src, bytes, title, stamp = PARSE_STAMP }) {
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
  }
  return { book, stamp, src, bytes, numPages: doc.numPages, title, fonts, pages };
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
  #pointerOf;
  #writePointer;
  #upload;
  #open;
  #attempt;
  #flights = new Map();

  /**
   * @param {object} o
   * @param {() => boolean} o.isGM whether this seat is a GM's
   * @param {(bookId: string) => string|null} o.srcOf the path of the shelf journal's PDF page now; null when the book is not shelved
   * @param {(bookId: string) => object|null} o.pointerOf the pointer stored on the shelf journal
   * @param {(bookId: string, pointer: object) => Promise<void>} o.writePointer store a pointer on the shelf journal
   * @param {(name: string, text: string) => Promise<string>} o.upload put a file under the saved-books directory; resolves its path
   * @param {(bookId: string, buffer: ArrayBuffer) => Promise<{doc: object, numPages: number, title: string}>} o.open open and fingerprint the bytes; rejects for another book
   * @param {() => string} o.attempt a token no other attempt shares, for the file name
   * @param {typeof fetch} [o.fetchImpl]
   * @param {string} [o.stamp]
   */
  constructor({ isGM, srcOf, pointerOf, writePointer, upload, open, attempt, fetchImpl = (...args) => globalThis.fetch(...args), stamp = PARSE_STAMP }) {
    this.#isGM = isGM;
    this.#srcOf = srcOf;
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

  /** Whether this seat may make a saved book: a GM seat, for a shelved book. */
  canParse(bookId) {
    return !!this.#isGM() && !!this.#srcOf(bookId);
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
   * already current is not parsed again.
   *
   * @param {string} bookId
   * @param {object} [o]
   * @param {() => Promise<ArrayBuffer>} [o.getBytes] the file's bytes where the caller holds them, else the shelved path is fetched
   * @returns {Promise<{pointer: object, fresh: boolean}>} `fresh` says this run opened and fingerprinted the file
   */
  prepare(bookId, { getBytes = null } = {}) {
    let flight = this.#flights.get(bookId);
    if (!flight) {
      flight = this.#prepare(bookId, getBytes).finally(() => this.#flights.delete(bookId));
      this.#flights.set(bookId, flight);
    }
    return flight;
  }

  async #prepare(bookId, getBytes) {
    if (!this.canParse(bookId)) throw new Error(`${bookId}: this seat does not make saved text`);
    const current = this.pointer(bookId);
    if (current) return { pointer: current, fresh: false };
    const src = this.#srcOf(bookId);
    const buffer = await (getBytes ?? (() => this.#fetchBytes(src)))();
    // The open hands the buffer to pdf.js, which detaches it.
    const bytes = buffer.byteLength;
    const { doc, numPages, title } = await this.#open(bookId, buffer);
    let saved;
    try {
      saved = await parseDocument(doc, { book: bookId, src, bytes, title, stamp: this.#stamp });
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
