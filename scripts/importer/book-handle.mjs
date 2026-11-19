/**
 * A shelved book as the session holds it: a doc-shaped handle that fetches
 * nothing until something needs the file.
 *
 * A handle answers `numPages` and `title` at once (from the book's saved text
 * when one is current, else the registry row, until a live open reports the
 * file's own), carries the book's typography, and stands in `sessionDocs`
 * where a pdf.js document stood, so every reader keeps its `doc.getPage(n)` /
 * `doc.numPages` shape. Its two states:
 *
 *   registered  placed at join; the file has not been asked for.
 *   verified    the file is there and is this book: a live open fingerprinted
 *               it (`live()`) and its document is still held, or a current
 *               saved text's `src` answered one HEAD with the size it was parsed
 *               at, or this seat just parsed it. An idle release lapses it.
 *
 * Reads verify before their first page; deletes ask `verified` and never run
 * on a registered handle (`verifiedDoc`). A page's text comes from the saved
 * text (`parsed-book.mjs`) when its pointer is current and from the live pdf.js
 * document otherwise; a GM seat with no current pointer makes the saved text
 * first (`prepare`), a player seat never does. The saved text also holds
 * the image placements of the pages a scene recipe names (`savedPlacements`),
 * so a rebuild whose pictures are cached opens no PDF. The pixel readers take the live
 * document (`liveDoc`), which opens on the first call, is kept while a hold
 * stands (`holdingLive`), and is released after `IDLE_MS` with no read. A
 * handle with no `src` (a file this seat picked) cannot reopen what it
 * released and has no saved text, so it never releases.
 *
 * A handle follows its book's shelf journal: when the journal's PDF page is
 * re-pointed (`src` changes) the handle drops its live document, its vouching
 * and its saved text, takes the new path, and reads, verifies and parses that
 * file as a fresh handle would. Nothing it holds of the old file answers for
 * the new one, and a parse it started before the change is not recorded. It
 * follows a change of the journal and never a difference from it: a file this
 * seat connected on purpose (`adopt`) stays the handle's until the journal
 * moves, and has no saved text, since a pointer names the journal's file.
 *
 * Fetch, open and the saved-text store are injected, so the handle holds no PDF
 * engine and no Foundry: `open(buffer)` fingerprints and returns
 * `{doc, numPages, title}`, or throws for a file that is another book.
 */
import { releaseDoc } from "./release-doc.mjs";

/**
 * An error that says what kind of failure it is, which is what the Books tab
 * words: `gone` (the file answers 404), `size` (it answers at another size
 * than its saved text was read from), `wrong` (it fingerprints as another
 * book; set by the open), `fetch` (a request failed in some other way) or `other`.
 */
const failure = (message, kind, extra = {}) => Object.assign(new Error(message), { kind, ...extra });

/** The kind a failed response is: a 404 is the file gone, anything else a request that failed. */
const httpKind = (status) => (status === 404 ? "gone" : "fetch");

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
  #vouched = false;
  #verifying = null;
  #refusal = null;
  #opened = false;
  #parsed;
  #saved = null;
  #noParse = false;
  #timer = null;
  #gone = false;
  #idleMs;
  #epoch = 0;
  #seen;
  #row;
  #onChange;

  /**
   * @param {object} o
   * @param {string} o.bookId the registry id
   * @param {string|null} o.src a fetchable path of the file; null for a file only this seat holds
   * @param {number} o.numPages the registry row's page count, until saved text or a live open reports the file's
   * @param {string} o.title the registry row's label, until saved text or a live open reports the file's
   * @param {(buffer: ArrayBuffer) => Promise<{doc: object, numPages: number, title: string}>} o.open
   *   opens and fingerprints the bytes; rejects for another book
   * @param {typeof fetch} [o.fetchImpl]
   * @param {number} [o.idleMs] how long the live document outlives its last read
   * @param {import("./parsed-book.mjs").ParsedBooks|null} [o.parsed] the saved-text store; with none every read opens the PDF
   * @param {((bookId: string) => void)|null} [o.onChange] told, after the handle has recorded it, that the book's refusal was set, cleared or changed in kind
   */
  constructor({ bookId, src = null, numPages = 0, title = "", open, fetchImpl = (...args) => globalThis.fetch(...args), idleMs = IDLE_MS, parsed = null, onChange = null }) {
    this.#onChange = onChange;
    this.#idleMs = idleMs;
    this.#bookId = bookId;
    this.#src = src;
    this.#numPages = numPages;
    this.#title = title;
    this.#open = open;
    this.#fetch = fetchImpl;
    this.#parsed = parsed;
    this.#seen = parsed?.shelfSrc(bookId) ?? null;
    this.#row = { numPages, title };
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

  /**
   * Take the journal's path when the journal has moved to one that is not this
   * handle's. A handle whose journal has not moved, one with no `src` (a file
   * this seat picked), a book the shelf no longer holds, and a journal that
   * moved to the path the handle already holds (a staging adopts the new path
   * before it writes the journal) keep what they have. Runs at the head of every
   * read, so a stale handle is corrected before it serves a page, a placement
   * or a verdict.
   */
  #follow() {
    const now = this.#parsed?.shelfSrc(this.#bookId) ?? null;
    if (now === this.#seen) return;
    this.#seen = now;
    if (!this.#src || !now || now === this.#src) return;
    const doc = this.#doc;
    this.#epoch++;
    this.#src = now;
    this.#doc = null;
    this.#opening = null;
    this.#verifying = null;
    this.#verified = false;
    this.#vouched = false;
    this.#opened = false;
    this.#numPages = this.#row.numPages;
    this.#title = this.#row.title;
    this.#saved = null;
    this.#noParse = false;
    this.#refusal = null;
    clearTimeout(this.#timer);
    this.#timer = null;
    releaseDoc(doc).catch(() => {});
  }

  /** The current saved text's pointer, when it is this handle's file. */
  #pointer() {
    const pointer = this.#parsed?.pointer(this.#bookId);
    return pointer && this.#src && pointer.src === this.#src ? pointer : null;
  }

  /** The file's page count once a live open reported it, else the saved text's, else the registry row's. */
  get numPages() {
    return this.#opened ? this.#numPages : (this.#pointer()?.numPages ?? this.#numPages);
  }

  get title() {
    return this.#opened ? this.#title : (this.#pointer()?.title ?? this.#title);
  }

  /**
   * Whether the file is known to be there and to be this book: the only state
   * a delete may rest on. A held live document, or a vouching that has not
   * lapsed.
   */
  get verified() {
    return this.#verified || this.#vouched;
  }

  /**
   * Why the file could not be verified, as the Error of the last refusal, or
   * null. Only a check made by a read, a repair or a re-read sets it, so a
   * handle nothing has touched answers null; the next check that passes clears it.
   * The error carries `refusedSrc`, the path it was recorded against, and the
   * handle follows its journal first, so a journal that moved on holds none.
   */
  get refusal() {
    this.#follow();
    return this.#refusal;
  }

  /**
   * Record or clear the refusal, then tell `onChange` where it changed what a row would say.
   * Recording one lapses the vouching and the verified mark, so the next `verify` asks the
   * file again and a refused file never licenses a delete.
   */
  #setRefusal(next) {
    const was = this.#refusal;
    this.#refusal = next;
    if (next) {
      this.#verified = false;
      this.#vouched = false;
    }
    if (!!was === !!next && was?.kind === next?.kind && was?.refusedSrc === next?.refusedSrc) return;
    try {
      this.#onChange?.(this.#bookId);
    } catch (err) {
      console.warn(`acks-extras | ${this.#bookId}: a refusal listener failed`, err);
    }
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
    if (this.#doc && this.#doc !== doc) releaseDoc(this.#doc).catch(() => {});
    this.#doc = doc;
    this.#numPages = numPages;
    this.#title = title;
    this.#src = src;
    this.#opened = true;
    this.#verified = true;
    this.#setRefusal(null);
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
    this.#follow();
    if (this.#doc) {
      this.#arm();
      return Promise.resolve(this.#doc);
    }
    if (!this.#opening) {
      const opening = this.#fetchAndOpen().finally(() => {
        if (this.#opening === opening) this.#opening = null;
      });
      this.#opening = opening;
    }
    return this.#opening;
  }

  async #fetchAndOpen() {
    const src = this.#src;
    if (!src) throw new Error(`${this.#bookId}: no file to open`);
    const resp = await this.#fetch(src);
    if (!resp?.ok) throw failure(`${this.#bookId}: could not read ${src} (${resp?.status})`, httpKind(resp?.status), { status: resp?.status });
    const { doc, numPages, title } = await this.#open(await resp.arrayBuffer());
    if (this.#gone || this.#src !== src) {
      await releaseDoc(doc);
      throw new Error(`${this.#bookId}: the handle ${this.#gone ? "was destroyed" : "was re-pointed"} while it opened`);
    }
    this.#doc = doc;
    this.#numPages = numPages;
    this.#title = title;
    this.#opened = true;
    this.#verified = true;
    this.#arm();
    return doc;
  }

  /**
   * Whether the file is there and is this book. Settled in this order, and
   * never throws:
   *
   *   1. a GM seat with no current saved text makes it (`prepare`), which
   *      fetches, fingerprints and parses the file, so what it leaves is
   *      verified; a failure is remembered until a release and the read opens
   *      the PDF instead;
   *   2. a current saved text is checked with one HEAD of its `src`: the file
   *      answers, at the size it was parsed at. A 404 or another size refuses
   *      the book, and nothing falls back to opening the PDF;
   *   3. with no saved text the PDF is opened live and fingerprinted.
   *
   * A verified handle answers at once. A concurrent call shares the first's run.
   */
  verify() {
    this.#follow();
    if (!this.#verifying) {
      const verifying = this.#verify()
        .then((verified) => {
          if (verified) this.#setRefusal(null);
          return verified;
        })
        .finally(() => {
          if (this.#verifying === verifying) this.#verifying = null;
        });
      this.#verifying = verifying;
    }
    return this.#verifying;
  }

  async #verify() {
    const epoch = this.#epoch;
    try {
      let pointer = this.#pointer();
      if (!pointer && this.#canPrepare()) {
        const made = await this.#prepare(epoch);
        pointer = made?.pointer ?? null;
        if (made?.fresh && epoch === this.#epoch) this.#vouch();
      }
      // Re-pointed while it ran: what it learned is of the old file, so ask again of the new.
      if (epoch !== this.#epoch) return await this.#verify();
      if (this.verified) {
        this.#arm();
        return true;
      }
      if (pointer) return await this.#head(pointer, epoch);
      await this.live();
      return true;
    } catch (err) {
      if (epoch !== this.#epoch) return this.#verify();
      return this.#refuse(err);
    }
  }

  /**
   * Make the book's text again although a current one is saved, from a fresh
   * fetch of the file, and leave the handle as a verified one holds it: the
   * refusal cleared and the new text read on the next page. The handle follows
   * the journal first, so the file fetched is the journal's PDF page now, and
   * the parse refuses bytes that are of any other path (a file this seat
   * connected on purpose). A file that cannot be found (404) or is another book
   * refuses the book; any other failure (a request, an upload, the pointer, a
   * journal that moved while it ran) leaves the handle as it was, with the old
   * text still current. Rejects with the failure, whose `kind` says which.
   *
   * @returns {Promise<{pointer: object, fresh: boolean}>}
   */
  async reread() {
    this.#follow();
    const src = this.#src;
    if (!this.#parsed || !src || !this.#parsed.canParse(this.#bookId)) {
      throw new Error(`${this.#bookId}: this seat does not make saved text`);
    }
    const epoch = this.#epoch;
    try {
      const made = await this.#parsed.prepare(this.#bookId, {
        force: true,
        src,
        getBytes: async () => {
          try {
            return await this.#bytes(src);
          } catch (err) {
            err.kind ??= "fetch";
            throw err;
          }
        },
      });
      // A journal that moved while it ran made the file another book's text; the next read asks the new path.
      if (epoch === this.#epoch) {
        this.#setRefusal(null);
        this.#noParse = false;
        this.#saved = null;
        this.#vouch();
      }
      return made;
    } catch (err) {
      if ((err.kind === "gone" || err.wrongBook) && epoch === this.#epoch) this.#refuse(err);
      throw err;
    }
  }

  /** Remember why the book was refused, and against which path, so a read rejects with it; answers false. */
  #refuse(err) {
    console.warn(`acks-extras | ${this.#bookId} could not be verified`, err);
    if (err && typeof err === "object") {
      err.kind ??= err.wrongBook ? "wrong" : "other";
      err.refusedSrc = this.#src;
    }
    this.#setRefusal(err);
    return false;
  }

  #canPrepare() {
    return !!this.#parsed && !!this.#src && !this.#noParse && this.#parsed.canParse(this.#bookId) && this.#parsed.shelfSrc(this.#bookId) === this.#src;
  }

  async #prepare(epoch) {
    try {
      return await this.#parsed.prepare(this.#bookId, { getBytes: () => this.#bytes(), src: this.#src });
    } catch (err) {
      console.warn(`acks-extras | ${this.#bookId}: its text could not be saved, so reads open the PDF`, err);
      if (epoch === this.#epoch) this.#noParse = true;
      return null;
    }
  }

  async #bytes(src = this.#src) {
    const resp = await this.#fetch(src);
    if (!resp?.ok) throw failure(`${this.#bookId}: could not read ${src} (${resp?.status})`, httpKind(resp?.status), { status: resp?.status });
    return resp.arrayBuffer();
  }

  /**
   * One HEAD of the saved text's `src`. The size is checked where the host
   * reports one; a reply with no `content-length` vouches for presence only.
   */
  async #head(pointer, epoch) {
    const resp = await this.#fetch(pointer.src, { method: "HEAD" });
    if (epoch !== this.#epoch) return this.#verify();
    if (!resp?.ok) return this.#refuse(failure(`${this.#bookId}: could not read ${pointer.src} (${resp?.status})`, httpKind(resp?.status), { status: resp?.status }));
    const length = resp.headers?.get?.("content-length");
    if (length != null && length !== "" && Number(length) !== pointer.bytes) {
      return this.#refuse(failure(`${this.#bookId}: ${pointer.src} is ${length} bytes, its saved text was read from ${pointer.bytes}`, "size", { length: Number(length), bytes: pointer.bytes, src: pointer.src }));
    }
    this.#vouch();
    return true;
  }

  #vouch() {
    this.#vouched = true;
    this.#arm();
  }

  /**
   * A page: the saved text's when its pointer is current, else the live
   * document's, opened on first use. Rejects when the book cannot be verified
   * and when neither source can be read. A saved text that cannot be read is
   * remembered until a release, and the live document answers.
   */
  async getPage(n) {
    if (!(await this.verify())) throw this.#refusal ?? new Error(`${this.#bookId}: the file could not be verified`);
    const saved = await this.#text();
    return saved ? saved.getPage(n) : (await this.live()).getPage(n);
  }

  /**
   * The saved placements of one page, or null when none are current or the
   * saved text lacks the page, and the caller then opens the PDF. Verifies the
   * book first, as a page read does, and rejects when it cannot be verified.
   * @param {number} n 1-based
   * @returns {Promise<{x: number, y: number, w: number, h: number}[]|null>}
   */
  async savedPlacements(n) {
    if (!(await this.verify())) throw this.#refusal ?? new Error(`${this.#bookId}: the file could not be verified`);
    const saved = await this.#text();
    return saved?.placements(n) ?? null;
  }

  /** The saved text, read once while the pointer stays the same; null when none is current or it cannot be read. */
  #text() {
    const pointer = this.#pointer();
    if (!pointer) return Promise.resolve(null);
    if (this.#saved?.file === pointer.file) return this.#saved.promise;
    const promise = this.#parsed.read(this.#bookId, pointer).catch((err) => {
      console.warn(`acks-extras | ${this.#bookId}: its saved text could not be read, so reads open the PDF`, err);
      return null;
    });
    this.#saved = { file: pointer.file, promise };
    return promise;
  }

  /** A fresh copy of the file's bytes, fetched from `src`, or from the live document for a picked file. */
  async getData() {
    this.#follow();
    if (!this.#src) return this.#doc ? this.#doc.getData() : null;
    const resp = await this.#fetch(this.#src);
    if (!resp?.ok) throw new Error(`${this.#bookId}: could not read ${this.#src} (${resp?.status})`);
    return new Uint8Array(await resp.arrayBuffer());
  }

  /** (Re)start the idle clock; a handle that cannot reopen holds its document for good. */
  #arm() {
    clearTimeout(this.#timer);
    this.#timer = null;
    if (!this.#src || !(this.#doc || this.#vouched)) return;
    this.#timer = setTimeout(() => this.#idle(), this.#idleMs);
    this.#timer.unref?.();
  }

  #idle() {
    this.#timer = null;
    if (liveHeld() || this.#opening) return this.#arm();
    this.#release();
  }

  // A fingerprint vouches for the file as it was when the live document opened,
  // and a HEAD for the file as it answered. Once the idle grace passes nothing
  // holds the file, so the vouching lapses: the next read or delete asks again
  // and finds the file gone or changed instead of resting on a stale answer.
  // The saved text and a remembered failure to make it go with it.
  #release() {
    const doc = this.#doc;
    this.#doc = null;
    this.#verified = false;
    this.#vouched = false;
    this.#saved = null;
    this.#noParse = false;
    releaseDoc(doc).catch(() => {});
  }

  /** Release everything; the handle opens nothing again. */
  async destroy() {
    this.#gone = true;
    clearTimeout(this.#timer);
    this.#timer = null;
    const doc = this.#doc;
    this.#doc = null;
    this.#vouched = false;
    this.#saved = null;
    await releaseDoc(doc);
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

/** Verify a session document before a read: a handle settles it as `verify()` does, any other document is already open. Never throws. */
export const verifyDoc = (doc) => (doc?.isBookHandle ? doc.verify() : Promise.resolve(!!doc));
