/**
 * What the Books tab says of a shelved book's saved text, and the press that
 * makes it again.
 *
 * `book-text.mjs` derives one of four states (none, prepared, stale, refused)
 * from the store's pointer, the run in flight and the handle's remembered
 * refusal, and nothing else. This suite drives it over the real `ParsedBooks`
 * and `BookHandle` on an invented server, with no PDFs and no Foundry: a state
 * costs no request, a refusal exists only where a check touched the book, a
 * forced read makes a second file where an unforced one makes none, a failed
 * forced read leaves the old text current, and the press reports through its
 * notifier and never throws. Every text in it is invented.
 */
import assert from "node:assert";
import { BookHandle } from "../../scripts/importer/book-handle.mjs";
import { ParsedBooks, PARSE_STAMP } from "../../scripts/importer/parsed-book.mjs";
import { TEXT_STATES, pressRead, refusalKind, rowActions, tally, textState } from "../../scripts/importer/book-text.mjs";

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

const PDF = "books/rr.pdf";
const PDF_BYTES = 1000;

/** An invented document of `numPages` pages with one text run each. */
function fakeDoc(numPages) {
  return {
    numPages,
    async getPage(n) {
      return {
        getViewport: () => ({ width: 612, height: 792 }),
        getTextContent: async () => ({
          items: [{ str: `line of page ${n}`, transform: [1, 0, 0, 1, 72, 600], width: 90, height: 9.5, fontName: "g_d1_f1" }],
        }),
        getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
      };
    },
    async destroy() {},
  };
}

/** A server, the shelf journals, and a seat's store and handle over them. */
function world({ pages = 4 } = {}) {
  const w = {
    files: new Map([[PDF, { bytes: PDF_BYTES }]]),
    journals: { rr: { src: PDF, pointer: null }, form: { src: null, pointer: null } },
    log: [],
    uploads: [],
    attempt: 0,
    release: null,
  };
  w.fetchImpl = async (path, init = {}) => {
    w.log.push(`${init.method ?? "GET"} ${path}`);
    const file = w.files.get(path);
    if (!file) return { ok: false, status: 404 };
    const length = file.text != null ? Buffer.byteLength(file.text) : file.bytes;
    return {
      ok: true,
      status: 200,
      headers: { get: (k) => (k === "content-length" ? String(length) : null) },
      arrayBuffer: async () => {
        if (w.release) await w.release;
        return new ArrayBuffer(length);
      },
      json: async () => JSON.parse(file.text),
    };
  };
  w.seat = ({ isGM = true, stamp } = {}) => {
    const parsed = new ParsedBooks({
      isGM: () => isGM,
      srcOf: (id) => w.journals[id]?.src ?? null,
      pointerOf: (id) => w.journals[id]?.pointer ?? null,
      writePointer: async (id, pointer) => {
        w.journals[id].pointer = structuredClone(pointer);
      },
      upload: async (name, text) => {
        if (w.uploadFails) throw new Error("upload refused");
        const path = `books/parsed/${name}`;
        w.files.set(path, { text });
        w.uploads.push(name);
        return path;
      },
      open: async () => ({ doc: fakeDoc(pages), numPages: pages, title: "The Real Title" }),
      attempt: () => `a${w.attempt++}`,
      fetchImpl: w.fetchImpl,
      ...(stamp ? { stamp } : {}),
    });
    const handle = (extra = {}) =>
      new BookHandle({ bookId: "rr", src: PDF, numPages: 3, title: "Row", open: async () => ({ doc: fakeDoc(pages), numPages: pages, title: "The Real Title" }), fetchImpl: w.fetchImpl, parsed, ...extra });
    return { parsed, handle };
  };
  return w;
}

const stateOf = (parsed, bookId = "rr", refusal = null) => textState({ parsed, bookId, refusal });

/* --- the four states, derived without a request ---------------------------------------------- */

{
  const w = world();
  const gm = w.seat();
  same("a shelved book with no pointer is none", [stateOf(gm.parsed).state, stateOf(gm.parsed).pointer], [TEXT_STATES.NONE, null]);
  ok("a form has no state to speak of", stateOf(gm.parsed, "form").state === null);
  ok("a book that is not on the shelf has none either", stateOf(gm.parsed, "nowhere").state === null);

  const handle = gm.handle();
  await handle.getPage(1); // the first read makes the text
  const requests = w.log.length;
  ok("after a read the text is prepared", stateOf(gm.parsed).state === TEXT_STATES.PREPARED);
  same("prepared carries the stored pointer", stateOf(gm.parsed).pointer, w.journals.rr.pointer);

  // Another build: the same journal, a stamp this build does not write.
  const other = w.seat({ stamp: "p0-other" });
  ok("a pointer of another stamp is stale", stateOf(other.parsed).state === TEXT_STATES.STALE);
  same("stale still carries the stored pointer", stateOf(other.parsed).pointer, w.journals.rr.pointer);

  // The journal re-pointed at another file.
  const repointed = w.seat();
  w.journals.rr.src = "books/rr-v2.pdf";
  ok("a journal naming another file makes the pointer stale", stateOf(repointed.parsed).state === TEXT_STATES.STALE);
  w.journals.rr.src = PDF;

  ok("deriving states made no request", w.log.length === requests, w.log.slice(requests).join(" | "));
}

/* --- refused: only where a check touched the book -------------------------------------------- */

{
  const w = world();
  const gm = w.seat();
  const handle = gm.handle();
  ok("a handle nothing has checked holds no refusal", handle.refusal === null);
  w.files.delete(PDF);
  ok("so a book nothing touched is not refused, whatever the server holds", stateOf(gm.parsed, "rr", handle.refusal).state === TEXT_STATES.NONE);
  w.files.set(PDF, { bytes: PDF_BYTES });
  await handle.getPage(1);
  ok("a book read and verified is prepared", stateOf(gm.parsed, "rr", handle.refusal).state === TEXT_STATES.PREPARED);

  // The file goes; the next check is the one that finds out.
  const player = w.seat({ isGM: false });
  const seen = player.handle();
  w.files.delete(PDF);
  await assert.rejects(() => seen.getPage(1));
  pass++;
  ok("a check that finds the file gone leaves a refusal", seen.refusal instanceof Error && /404/.test(seen.refusal.message), String(seen.refusal));
  same("and the state is refused, ahead of a current pointer", stateOf(player.parsed, "rr", seen.refusal).state, TEXT_STATES.REFUSED);

  // The file comes back: the next check clears it.
  w.files.set(PDF, { bytes: PDF_BYTES });
  ok("the next check that passes clears the refusal", (await seen.verify()) === true && seen.refusal === null);
}

/* --- a forced read makes the text again ------------------------------------------------------ */

{
  const w = world();
  const gm = w.seat();
  const handle = gm.handle();
  await handle.getPage(1);
  const first = w.journals.rr.pointer.file;
  const again = await gm.parsed.prepare("rr");
  ok("an unforced prepare of a current book makes nothing", again.fresh === false && w.uploads.length === 1);

  const forced = await gm.parsed.prepare("rr", { force: true });
  ok("a forced prepare parses again and uploads a second file", forced.fresh === true && w.uploads.length === 2);
  ok("the pointer moved to the new file and the old one stays on the server", w.journals.rr.pointer.file !== first && w.files.has(first));
  ok("the book is prepared after it", stateOf(gm.parsed).state === TEXT_STATES.PREPARED);

  // A failed forced read leaves the old text current.
  const before = w.journals.rr.pointer.file;
  w.uploadFails = true;
  await assert.rejects(() => gm.parsed.prepare("rr", { force: true }), /upload refused/);
  pass++;
  w.uploadFails = false;
  ok("a failed forced read leaves the pointer and the state as they were", w.journals.rr.pointer.file === before && stateOf(gm.parsed).state === TEXT_STATES.PREPARED);
  ok("and nothing is left reading", gm.parsed.reading("rr") === false);
}

/* --- reading is the store's, so every caller sees it ----------------------------------------- */

{
  const w = world();
  const gm = w.seat();
  let open;
  w.release = new Promise((resolve) => (open = resolve));
  const run = gm.parsed.prepare("rr");
  ok("a run in flight says reading, to a caller that did not start it", stateOf(gm.parsed).reading === true && stateOf(gm.parsed).state === TEXT_STATES.NONE);
  ok("a second plain call takes the first's run", gm.parsed.prepare("rr") === run);
  const forced = gm.parsed.prepare("rr", { force: true });
  open();
  await run;
  const made = await forced;
  ok("a forced call that met an unforced run starts after it and parses again", made.fresh === true && w.uploads.length === 2, `${w.uploads.length} uploads`);
  ok("nothing is reading once both settled", gm.parsed.reading("rr") === false);
}

/* --- the handle's re-read -------------------------------------------------------------------- */

{
  const w = world();
  const gm = w.seat();
  const handle = gm.handle();
  const made = await handle.reread();
  ok("a re-read of a book with no text makes it", made.fresh === true && stateOf(gm.parsed).state === TEXT_STATES.PREPARED);
  const first = w.journals.rr.pointer.file;
  await handle.reread();
  ok("a re-read of a prepared book makes a new file", w.journals.rr.pointer.file !== first && w.uploads.length === 2);
  ok("the handle reads the new file's pages", (await handle.getPage(2)) != null && w.log.filter((l) => l.endsWith(w.journals.rr.pointer.file)).length === 1);

  // The file is gone: a re-read refuses the book, a later good one clears it.
  w.files.delete(PDF);
  await assert.rejects(() => handle.reread(), /404/);
  pass++;
  ok("a re-read that cannot fetch the file refuses the book", stateOf(gm.parsed, "rr", handle.refusal).state === TEXT_STATES.REFUSED);
  w.files.set(PDF, { bytes: PDF_BYTES });
  await handle.reread();
  ok("a re-read that succeeds clears the refusal", handle.refusal === null && stateOf(gm.parsed, "rr", handle.refusal).state === TEXT_STATES.PREPARED);

  // An upload failure is not the file's fault.
  w.uploadFails = true;
  await assert.rejects(() => handle.reread(), /upload refused/);
  pass++;
  ok("a failure that is not the file's leaves the book unrefused", handle.refusal === null);
  w.uploadFails = false;

  const player = w.seat({ isGM: false }).handle();
  await assert.rejects(() => player.reread(), /does not make saved text/);
  pass++;
}

/* --- a re-read and the journal's path -------------------------------------------------------- */

{
  const w = world();
  const gm = w.seat();
  const V2 = "books/rr-v2.pdf";
  w.files.set(V2, { bytes: 2000 });

  // A journal re-pointed after the handle was made: the press reads the journal's file and records it under that path.
  const handle = gm.handle();
  w.journals.rr.src = V2;
  const made = await handle.reread();
  ok("a re-read of a re-pointed book fetches the journal's file", made.pointer.src === V2 && w.log.includes(`GET ${V2}`) && !w.log.includes(`GET ${PDF}`), w.log.join(" | "));
  ok("and the handle serves that text", handle.src === V2 && (await handle.getPage(1)) != null);

  // A file this seat connected on purpose is not the journal's: the parse refuses its bytes and the book stays unrefused.
  const own = gm.handle();
  own.adopt({ doc: fakeDoc(4), numPages: 4, title: "Mine", src: "books/mine.pdf" });
  w.files.set("books/mine.pdf", { bytes: 3000 });
  const uploads = w.uploads.length;
  await assert.rejects(() => own.reread(), /not of the shelf/);
  pass++;
  ok("a re-read of a connected file records nothing and refuses nothing", w.uploads.length === uploads && own.refusal === null);

  // A journal that moves while the press runs: the result is not the new file's text, so the handle takes none of it.
  w.journals.rr.src = PDF;
  w.journals.rr.pointer = null;
  const moving = gm.handle();
  w.release = new Promise((resolve) => setTimeout(resolve, 20));
  const running = moving.reread();
  w.journals.rr.src = "books/rr-v3.pdf";
  await moving.getData().catch(() => {}); // the handle follows the journal while the press is in flight
  await assert.rejects(() => running, /changed while it was parsed/);
  pass++;
  w.release = null;
  ok("a press the journal moved under records nothing and leaves the handle unrefused", w.journals.rr.pointer === null && moving.refusal === null && moving.src === "books/rr-v3.pdf");
  w.journals.rr.src = PDF;
}

/* --- a refusal redraws the row after it is recorded, and belongs to the path it was found against -- */

{
  const w = world();
  const gm = w.seat();
  const told = [];
  const handle = gm.handle({
    onChange: (id) => told.push({ id, state: stateOf(gm.parsed, id, handle.refusal).state, refusal: handle.refusal }),
  });
  await gm.handle().reread(); // the text is saved by another handle, so this one holds no vouching
  told.length = 0;

  // The press: the run's own end has gone by when the 404 is recorded, so the handle tells the redraw itself.
  w.files.delete(PDF);
  await assert.rejects(() => handle.reread(), /404/);
  pass++;
  same("a refusal found by a press tells the redraw once, with the refusal already recorded", [told.length, told[0]?.id, told[0]?.state], [1, "rr", TEXT_STATES.REFUSED]);

  // A check that refuses again for the same reason does not redraw again.
  await handle.verify();
  await handle.verify();
  same("a repeat of the same refusal tells nothing more", told.length, 1);

  // Clearing it is told too, after the handle holds none.
  w.files.set(PDF, { bytes: PDF_BYTES });
  await handle.reread();
  same("a re-read that clears the refusal tells the redraw, with none held", [told.length, told[1]?.refusal, told[1]?.state], [2, null, TEXT_STATES.PREPARED]);

  // A check made by a read (an import, a repair) is told the same way.
  const reader = w.seat().handle({ onChange: (id) => told.push({ id, via: "verify", refusal: reader.refusal }) });
  w.files.delete(PDF);
  await assert.rejects(() => reader.getPage(1));
  pass++;
  ok("a refusal found by a read tells the redraw", told.at(-1)?.via === "verify" && told.at(-1).refusal instanceof Error);
  w.files.set(PDF, { bytes: PDF_BYTES });
  await reader.verify();
  ok("and the check that passes tells it cleared", told.at(-1).refusal === null);
}

{
  const w = world();
  const gm = w.seat();
  const OTHER = "books/rr-other.pdf";
  w.files.set(OTHER, { bytes: 2000 });
  const handle = gm.handle();
  await handle.getPage(1);
  w.files.delete(PDF);
  await assert.rejects(() => handle.reread(), /404/);
  pass++;
  ok("a refusal names the path it was recorded against", handle.refusal?.refusedSrc === PDF);
  same("and it refuses the book while the journal names that path", stateOf(gm.parsed, "rr", handle.refusal).state, TEXT_STATES.REFUSED);

  // The refused journal is removed and the book's other journal now names another file.
  w.journals.rr.src = OTHER;
  const carried = Object.assign(new Error("rr: could not read books/rr.pdf (404)"), { kind: "gone", refusedSrc: PDF });
  const redrawn = stateOf(gm.parsed, "rr", carried);
  same("a refusal of another path does not refuse the journal's file now", [redrawn.state, redrawn.refusal], [TEXT_STATES.STALE, null]);
  ok("the handle holds no refusal once its journal moved on", handle.refusal === null);
  w.journals.rr.src = PDF;
}

/* --- the controls a row offers --------------------------------------------------------------- */

{
  const S = TEXT_STATES;
  const gm = (state, reading = false) => rowActions({ state, reading, isGM: true });
  same("none: Read now, and Remove", gm(S.NONE), { read: "now", readDisabled: false, remove: true, removeDisabled: false });
  same("prepared: Read again", gm(S.PREPARED).read, "again");
  same("stale: Read again", gm(S.STALE).read, "again");
  same("refused: Remove only", gm(S.REFUSED), { read: null, readDisabled: false, remove: true, removeDisabled: false });
  same("a form: Remove only", gm(null).read, null);
  same("while a read runs both are disabled", [gm(S.PREPARED, true).readDisabled, gm(S.PREPARED, true).removeDisabled], [true, true]);
  same("a read that is not offered is not disabled for reading", gm(S.REFUSED, true).readDisabled, false);
  for (const state of [S.NONE, S.PREPARED, S.STALE, S.REFUSED, null]) {
    same(`a player is offered no control on ${state}`, rowActions({ state, reading: false, isGM: false }), { read: null, readDisabled: false, remove: false, removeDisabled: false });
  }
  same("the fold counts stale and refused", tally([{ state: S.STALE }, { state: S.PREPARED }, { state: S.REFUSED }, { state: S.STALE }, { state: null }, { state: S.NONE }]), { stale: 2, refused: 1 });
  same("an empty fold counts none", tally([]), { stale: 0, refused: 0 });

  // A seat counts only the rows it is shown a state for: a withheld book has none, and a seat that checks no file sees the base.
  const rows = [
    { state: S.STALE, base: S.STALE, shared: true },
    { state: S.STALE, base: S.STALE, shared: false },
    { state: S.REFUSED, base: S.PREPARED, shared: true },
    { state: S.REFUSED, base: S.STALE, shared: true },
  ];
  same("a GM counts every shared row's state", tally(rows), { stale: 1, refused: 2 });
  same("a player counts no withheld book and never a refusal", tally(rows, { isGM: false }), { stale: 2, refused: 0 });
}

/* --- the press ------------------------------------------------------------------------------- */

{
  const notes = [];
  const notify = { info: (n) => notes.push(["info", n]), warn: (n) => notes.push(["warn", n]) };
  const pointer = { file: "books/parsed/x.json" };

  const good = await pressRead({ bookId: "rr", reread: async () => ({ pointer, fresh: true }), canRead: true, reading: false, notify });
  same("a good press reports the pointer as an info", [good.ok, notes.at(-1)], [true, ["info", { bookId: "rr", pointer }]]);

  const error = new Error("could not read books/rr.pdf (404)");
  const bad = await pressRead({ bookId: "rr", reread: async () => Promise.reject(error), canRead: true, reading: false, notify });
  same("a failed press reports the error as a warning and does not throw", [bad.ok, bad.error, notes.at(-1)], [false, error, ["warn", { bookId: "rr", error }]]);

  const count = notes.length;
  let called = 0;
  const busy = await pressRead({ bookId: "rr", reread: async () => (called++, { pointer }), canRead: true, reading: true, notify });
  ok("a press while the book is being read does nothing", busy.skipped === true && called === 0 && notes.length === count);

  const player = await pressRead({ bookId: "rr", reread: async () => (called++, { pointer }), canRead: false, reading: false, notify });
  ok("a seat that may not read is told so and reads nothing", player.ok === false && called === 0 && notes.at(-1)[0] === "warn");
}

/* --- the kind of a failure, progress and change events --------------------------------------- */

{
  const w = world({ pages: 5 });
  const events = [];
  let watchedRef = null;
  // A store of this seat's own that reports what it is doing.
  const watched = new ParsedBooks({
    isGM: () => true,
    srcOf: (id) => w.journals[id]?.src ?? null,
    pointerOf: (id) => w.journals[id]?.pointer ?? null,
    writePointer: async (id, pointer) => {
      w.journals[id].pointer = structuredClone(pointer);
    },
    upload: async (name, text) => {
      w.files.set(`books/parsed/${name}`, { text });
      return `books/parsed/${name}`;
    },
    open: async () => ({ doc: fakeDoc(5), numPages: 5, title: "T" }),
    attempt: () => `w${w.attempt++}`,
    fetchImpl: w.fetchImpl,
    onChange: (id, kind) => events.push([id, kind, watchedRef?.reading(id), watchedRef?.progress(id)?.page ?? null]),
  });
  watchedRef = watched;
  await watched.prepare("rr");
  same("a run reports its start, each page and its end", events.map((e) => e[1]).join(","), "state,progress,progress,progress,progress,progress,state");
  same("progress counts pages of the book's total", [events[1][3], events[5][3]], [1, 5]);
  ok("the start is seen as reading and the end as not", events[0][2] === true && events.at(-1)[2] === false);
  ok("nothing is left of the progress after the run", watched.progress("rr") === null && watched.reading("rr") === false);
  ok("the store names the path the journal's page holds, and none for a form", watched.src("rr") === PDF && watched.src("form") === null);
  const stale = textState({ parsed: watched, bookId: "rr" });
  ok("a current pointer has no stale cause", stale.state === TEXT_STATES.PREPARED && stale.cause === null && stale.src === PDF && stale.stamp === PARSE_STAMP);
  w.journals.rr.pointer = { ...w.journals.rr.pointer, stamp: "p0-old" };
  ok("another stamp is stale for the reader", textState({ parsed: watched, bookId: "rr" }).cause === "reader");
  w.journals.rr.pointer = { ...w.journals.rr.pointer, stamp: PARSE_STAMP, src: "books/other.pdf" };
  ok("another src is stale for the file", textState({ parsed: watched, bookId: "rr" }).cause === "file");
  w.journals.rr.pointer = { ...w.journals.rr.pointer, src: PDF, numPages: 0 };
  ok("an incomplete pointer is stale for the pointer", textState({ parsed: watched, bookId: "rr" }).cause === "pointer");
}

{
  // A request that fails is a warning and not a refusal; only a missing file or another book refuses.
  const w = world();
  const gm = w.seat();
  const handle = gm.handle();
  await handle.reread();
  const real = w.fetchImpl;
  w.fetchImpl = async () => {
    throw new TypeError("network down");
  };
  const failing = new BookHandle({ bookId: "rr", src: PDF, open: async () => ({}), fetchImpl: w.fetchImpl, parsed: gm.parsed });
  await assert.rejects(() => failing.reread(), (err) => err.kind === "fetch");
  pass++;
  ok("a request that fails leaves the book unrefused, with its text current", failing.refusal === null && stateOf(gm.parsed).state === TEXT_STATES.PREPARED);
  w.fetchImpl = async (path) => (path === PDF ? { ok: false, status: 503 } : real(path));
  const busy = new BookHandle({ bookId: "rr", src: PDF, open: async () => ({}), fetchImpl: w.fetchImpl, parsed: gm.parsed });
  await assert.rejects(() => busy.reread(), (err) => err.kind === "fetch" && err.status === 503);
  pass++;
  ok("a 503 is a request that failed, not a file that is gone", busy.refusal === null);
  w.fetchImpl = real;

  // The open the store makes (the module's fingerprinting one) is what rejects another book.
  const other = world();
  const wrongStore = new ParsedBooks({
    isGM: () => true,
    srcOf: () => PDF,
    pointerOf: () => null,
    writePointer: async () => {},
    upload: async (name) => name,
    open: async () => {
      throw Object.assign(new Error("another book"), { wrongBook: "other" });
    },
    attempt: () => "x",
    fetchImpl: other.fetchImpl,
  });
  const wrong = new BookHandle({ bookId: "rr", src: PDF, open: async () => ({}), fetchImpl: other.fetchImpl, parsed: wrongStore });
  await assert.rejects(() => wrong.reread(), /another book/);
  pass++;
  ok("a file that opens as another book refuses, as kind wrong", wrong.refusal?.wrongBook === "other" && wrong.refusal.kind === "wrong" && stateOf(wrongStore, "rr", wrong.refusal).state === TEXT_STATES.REFUSED);
  same("the kind of a refusal reads off the error", [refusalKind(wrong.refusal), refusalKind(Object.assign(new Error("x"), { kind: "gone" })), refusalKind(null)], ["wrong", "gone", null]);
}

{
  const notes = [];
  const notify = { info: (n) => notes.push(["info", n]), warn: (n) => notes.push(["warn", n]) };
  let called = 0;
  const denied = await pressRead({ bookId: "rr", reread: async () => (called++, {}), canRead: false, reading: false, notify });
  ok("a seat that may not read is denied, flagged so, and nothing is fetched", denied.denied === true && notes.at(-1)[1].denied === true && called === 0);
}

console.log(`test-book-text: ${pass} passed (stamp ${PARSE_STAMP})`);
