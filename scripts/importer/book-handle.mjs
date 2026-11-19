/**
 * A shelved book as the session holds it: a doc-shaped handle that fetches
 * nothing until something needs the file.
 *
 * A handle answers `numPages` and `title` at once (from the registry row until
 * a live open reports the file's own), carries the book's typography, and
 * stands in `sessionDocs` where a pdf.js document stood, so every reader keeps
 * its `doc.getPage(n)` / `doc.numPages` shape. Its two states:
 *
 *   registered  placed at join; the file has not been asked for.
 *   verified    a live open fingerprinted the file (`live()`) and its document is
 *               still held, so the file is there and is this book. A release
 *               lapses it.
 *
 * Reads verify before their first page; deletes ask `verified` and never run
 * on a registered handle (`verifiedDoc`). The live pdf.js document opens on
 * the first page read, is kept while a hold stands (`holdingLive`), and is
 * released after `IDLE_MS` with no read. A handle with no `src` (a file this
 * seat picked) cannot reopen what it released, so it never releases.
 *
 * Fetch and open are injected, so the handle holds no PDF engine and no
 * Foundry: `open(buffer)` fingerprints and returns `{doc, numPages, title}`,
 * or throws for a file that is another book.
 */

/** How long a live document stays open after its last read, in milliseconds. Longer than the slowest page render. */
export const IDLE_MS = 120_000;

/** Open `holdingLive` scopes; no handle releases its live document while one stands. */
let holds = 0;

/**
 * Run `run` with every handle's live document kept open, so a bulk run
 * (the import chain, a repair) opens each book once. The scopes nest; the
 * idle grace starts when the outermost one ends.
 */
export async function holdingLive(run) {
  holds++;
  try {
    return await run();
  } finally {
    holds--;
  }
}

/** Whether a `holdingLive` scope stands. */
export const liveHeld = () => holds > 0;

export class BookHandle {
  #bookId;
  #src;
  #numPages;
  #title;
  #open;
  #fetch;
  #doc = null;
  #opening = null;
  #verified = false;
  #timer = null;
  #gone = false;
  #idleMs;

  /**
   * @param {object} o
   * @param {string} o.bookId the registry id
   * @param {string|null} o.src a fetchable path of the file; null for a file only this seat holds
   * @param {number} o.numPages the registry row's page count, until a live open reports the file's
   * @param {string} o.title the registry row's label, until a live open reports the file's
   * @param {(buffer: ArrayBuffer) => Promise<{doc: object, numPages: number, title: string}>} o.open
   *   opens and fingerprints the bytes; rejects for another book
   * @param {typeof fetch} [o.fetchImpl]
   * @param {number} [o.idleMs] how long the live document outlives its last read
   */
  constructor({ bookId, src = null, numPages = 0, title = "", open, fetchImpl = (...args) => globalThis.fetch(...args), idleMs = IDLE_MS }) {
    this.#idleMs = idleMs;
    this.#bookId = bookId;
    this.#src = src;
    this.#numPages = numPages;
    this.#title = title;
    this.#open = open;
    this.#fetch = fetchImpl;
  }

  /** Marks a handle where a plain document would not carry one. */
  get isBookHandle() {
    return true;
  }

  get bookId() {
    return this.#bookId;
  }

  get src() {
    return this.#src;
  }

  /** The file's page count once a live open reported it, else the registry row's. */
  get numPages() {
    return this.#numPages;
  }

  get title() {
    return this.#title;
  }

  /** Whether a live open fingerprinted the file and still holds it: the only state a delete may rest on. */
  get verified() {
    return this.#verified;
  }

  /** Whether a live pdf.js document is held now. */
  get isLive() {
    return !!this.#doc;
  }

  /**
   * Hand the handle a document a caller already opened and fingerprinted
   * (`src` is the path it was fetched from, null for a picked file), so a
   * connect or a staging leaves the handle verified and holding it.
   */
  adopt({ doc, numPages, title, src = null }) {
    if (this.#doc && this.#doc !== doc) this.#doc.destroy?.()?.catch?.(() => {});
    this.#doc = doc;
    this.#numPages = numPages;
    this.#title = title;
    this.#src = src;
    this.#verified = true;
    this.#gone = false;
    this.#arm();
    return this;
  }

  /**
   * The live pdf.js document: fetched, opened and fingerprinted on the first
   * call, the same promise for every caller while it opens, the held document
   * after. A failure is not remembered; the next call fetches again.
   */
  live() {
    if (this.#doc) {
      this.#arm();
      return Promise.resolve(this.#doc);
    }
    this.#opening ??= this.#fetchAndOpen().finally(() => {
      this.#opening = null;
    });
    return this.#opening;
  }

  async #fetchAndOpen() {
    if (!this.#src) throw new Error(`${this.#bookId}: no file to open`);
    const resp = await this.#fetch(this.#src);
    if (!resp?.ok) throw new Error(`${this.#bookId}: could not read ${this.#src} (${resp?.status})`);
    const { doc, numPages, title } = await this.#open(await resp.arrayBuffer());
    if (this.#gone) {
      await doc.destroy?.();
      throw new Error(`${this.#bookId}: the handle was destroyed while it opened`);
    }
    this.#doc = doc;
    this.#numPages = numPages;
    this.#title = title;
    this.#verified = true;
    this.#arm();
    return doc;
  }

  /** Whether the file is there and is this book: a live open, once per session. Never throws. */
  async verify() {
    if (this.#verified) return true;
    try {
      await this.live();
      return true;
    } catch (err) {
      console.warn(`acks-extras | ${this.#bookId} could not be verified`, err);
      return false;
    }
  }

  /** A page of the live document; opens it on first use. Rejects when the file cannot be opened. */
  async getPage(n) {
    return (await this.live()).getPage(n);
  }

  /** A fresh copy of the file's bytes, fetched from `src`, or from the live document for a picked file. */
  async getData() {
    if (!this.#src) return this.#doc ? this.#doc.getData() : null;
    const resp = await this.#fetch(this.#src);
    if (!resp?.ok) throw new Error(`${this.#bookId}: could not read ${this.#src} (${resp?.status})`);
    return new Uint8Array(await resp.arrayBuffer());
  }

  /** (Re)start the idle clock; a handle that cannot reopen holds its document for good. */
  #arm() {
    clearTimeout(this.#timer);
    this.#timer = null;
    if (!this.#src || !this.#doc) return;
    this.#timer = setTimeout(() => this.#idle(), this.#idleMs);
    this.#timer.unref?.();
  }

  #idle() {
    this.#timer = null;
    if (liveHeld() || this.#opening) return this.#arm();
    this.#release();
  }

  // A fingerprint vouches for the file as it was when the live document opened.
  // Once that document is released nothing holds the file, so the vouching
  // lapses with it: the next read or delete opens again and finds the file
  // gone or changed instead of resting on a stale answer.
  #release() {
    const doc = this.#doc;
    this.#doc = null;
    this.#verified = false;
    Promise.resolve(doc?.destroy?.()).catch(() => {});
  }

  /** Release everything; the handle opens nothing again. */
  async destroy() {
    this.#gone = true;
    clearTimeout(this.#timer);
    this.#timer = null;
    const doc = this.#doc;
    this.#doc = null;
    await doc?.destroy?.();
  }
}

/**
 * The pdf.js document behind a session document: a handle's live document
 * (opened now if it is not), any other document as it is. Pixel and
 * operator-list readers take it before they touch a page.
 */
export const liveDoc = (doc) => (doc?.isBookHandle ? doc.live() : Promise.resolve(doc));

/**
 * Whether a session document may rest a delete on: a handle only once verified.
 * A document that is no handle (a file this seat opened and fingerprinted
 * itself) is.
 */
export const verifiedDoc = (doc) => (doc?.isBookHandle ? doc.verified : !!doc);

/** Verify a session document before a read: a handle opens live, any other document is already open. Never throws. */
export const verifyDoc = (doc) => (doc?.isBookHandle ? doc.verify() : Promise.resolve(!!doc));
