/**
 * What the Books tab says of a shelved book's saved text, and what a press of
 * its read control does.
 *
 * A shelved book's text is parsed once and kept beside its PDF (`parsed-book.mjs`).
 * This module turns what the store and the book's handle already know into one
 * of four states, decides which controls a seat is offered, and runs the press
 * that makes the text again. It asks nothing of the server: no fetch, no HEAD,
 * no open. A state is derived from the pointer on the shelf journal, the
 * run in flight and the refusal a handle remembers, so building the tab costs
 * nothing, and a file is checked only where something already touched it (an
 * import, a repair or a press this session).
 *
 *   none      no pointer was ever written; the book's text is not prepared
 *   prepared  the pointer is current: this build's stamp over the journal's PDF
 *   stale     a pointer is stored and is not current (another build, or the
 *             journal names another file)
 *   refused   a check made this session found the file gone or not this book
 *
 * Every dependency is passed in, so the suite drives it with no Foundry.
 */

/** The four states of a book's saved text. */
export const TEXT_STATES = Object.freeze({ NONE: "none", PREPARED: "prepared", STALE: "stale", REFUSED: "refused" });

/**
 * The state of one book's saved text.
 *
 * @param {object} o
 * @param {{savable: function(string): boolean, pointer: function(string): object|null, stored: function(string): object|null, reading: function(string): boolean, progress: function(string): object|null, src: function(string): string|null, stamp: string}} o.parsed the saved-text store
 * @param {string} o.bookId
 * @param {Error|null} [o.refusal] the handle's remembered refusal for this book
 * @returns {{state: string|null, base: string|null, cause: string|null, reading: boolean, progress: object|null, refusal: Error|null, pointer: object|null, src: string|null, stamp: string|null}}
 *   `state` is null for a book that has no saved text to speak of (not shelved,
 *   or a form); `base` is the state with any refusal left out, which is what a
 *   seat that checks no file shows; `cause` says why a stale pointer is stale
 *   (`reader`: another stamp, `file`: the journal names another PDF, `pointer`: it
 *   is incomplete); `pointer` is the stored one, current or not; `progress`
 *   is `{page, total}` while a run on this seat has read a page
 */
export function textState({ parsed, bookId, refusal = null }) {
  if (!parsed.savable(bookId)) {
    return { state: null, base: null, cause: null, reading: false, progress: null, refusal: null, pointer: null, src: null, stamp: null };
  }
  const reading = !!parsed.reading(bookId);
  const stored = parsed.stored(bookId);
  const src = parsed.src(bookId);
  const base = parsed.pointer(bookId) ? TEXT_STATES.PREPARED : stored ? TEXT_STATES.STALE : TEXT_STATES.NONE;
  const cause =
    base !== TEXT_STATES.STALE ? null : stored.stamp !== parsed.stamp ? "reader" : stored.src !== src ? "file" : "pointer";
  return {
    state: refusal ? TEXT_STATES.REFUSED : base,
    base,
    cause,
    reading,
    progress: reading ? (parsed.progress(bookId) ?? null) : null,
    refusal: refusal ?? null,
    pointer: stored,
    src,
    stamp: parsed.stamp,
  };
}

/**
 * The kind of a refusal, as the Books tab words it: `gone` (the file answers
 * 404), `size` (another size than its text was read from), `wrong` (it is another
 * book) or `other`.
 *
 * @param {Error|null} refusal
 * @returns {string|null}
 */
export const refusalKind = (refusal) => (refusal ? (refusal.kind ?? (refusal.wrongBook ? "wrong" : "other")) : null);

/**
 * The controls a shelved book's row carries for a seat.
 *
 * Reading is a GM's act; a player sees the state and no control. "Read now"
 * answers a book with no saved text, "Read again" a book that has some,
 * current or stale. A refused book offers Remove and nothing else, since there
 * is no file to read. While a read runs both are disabled.
 *
 * @param {object} o
 * @param {string|null} o.state one of `TEXT_STATES`, or null for a book with no saved text to speak of
 * @param {boolean} o.reading a read is running for this book
 * @param {boolean} o.isGM
 * @returns {{read: "now"|"again"|null, readDisabled: boolean, remove: boolean, removeDisabled: boolean}}
 */
export function rowActions({ state, reading, isGM }) {
  if (!isGM) return { read: null, readDisabled: false, remove: false, removeDisabled: false };
  const read =
    state === TEXT_STATES.NONE ? "now" : state === TEXT_STATES.PREPARED || state === TEXT_STATES.STALE ? "again" : null;
  return { read, readDisabled: !!read && !!reading, remove: true, removeDisabled: !!reading };
}

/**
 * The counts a closed fold shows beside its book count.
 *
 * @param {Array<{state: string|null}>} states the rows' states
 * @returns {{stale: number, refused: number}}
 */
export function tally(states) {
  return {
    stale: states.filter((s) => s.state === TEXT_STATES.STALE).length,
    refused: states.filter((s) => s.state === TEXT_STATES.REFUSED).length,
  };
}

/**
 * The press of "Read now" / "Read again": make the book's text through the
 * injected `reread`, and report the result through `notify`. Never throws. A
 * press while the book is already being read does nothing, and a seat that may
 * not make text is refused before anything is fetched.
 *
 * @param {object} o
 * @param {string} o.bookId
 * @param {() => Promise<{pointer: object, fresh: boolean}>} o.reread makes the text; rejects with the reason
 * @param {boolean} o.canRead whether this seat may make saved text
 * @param {boolean} o.reading whether a read is already running for the book
 * @param {{info: function(object): void, warn: function(object): void}} o.notify
 *   receives `{bookId, pointer}` on success, `{bookId, error}` on a failure and
 *   `{bookId, error, denied: true}` for a seat that may not make text
 * @returns {Promise<{ok: boolean, skipped?: boolean, denied?: boolean, pointer?: object, error?: Error}>}
 */
export async function pressRead({ bookId, reread, canRead, reading, notify }) {
  if (reading) return { ok: false, skipped: true };
  if (!canRead) {
    const error = new Error(`${bookId}: this seat does not make saved text`);
    notify.warn({ bookId, error, denied: true });
    return { ok: false, denied: true, error };
  }
  try {
    const { pointer } = await reread();
    notify.info({ bookId, pointer });
    return { ok: true, pointer };
  } catch (error) {
    notify.warn({ bookId, error });
    return { ok: false, error };
  }
}
