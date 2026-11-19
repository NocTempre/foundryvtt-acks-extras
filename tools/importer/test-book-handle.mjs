/**
 * A shelved book is registered at join and opens when a read needs it.
 *
 * The handle (`book-handle.mjs`) stands in `sessionDocs` where an open pdf.js
 * document stood. This suite drives it with an injected fetch and open, and
 * through the real readers: nothing is fetched at registration; a read opens
 * the file once however many callers ask at once; a read of a book whose file
 * is gone answers `book-closed`; and a handle that has not been verified never
 * licenses a delete. The books are invented. No PDFs, no Foundry.
 */
import assert from "node:assert";
import { BookHandle, IDLE_MS, holdingLive, liveDoc, verifiedDoc, verifyDoc } from "../../scripts/importer/book-handle.mjs";
import { rebuildVerdict } from "../../scripts/importer/rebuild-guard.mjs";
import { initCookbook, loadCookbook } from "../../scripts/importer/cookbook.mjs";
import { executeEntry } from "../../scripts/importer/executor.mjs";
import { readForImport, repairFromEntry, holdingReads } from "../../scripts/importer/cookbook/read.mjs";
import { bookVerified, verifyBooks, verifiedBook } from "../../scripts/importer/cookbook/state.mjs";

let pass = 0;
const ok = (label, cond, detail = "") => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ""}`);
  pass++;
};

/* --- the fakes ------------------------------------------------------------------------------- */

const H = 792;
/** An invented one-run-per-page document that counts how often it is destroyed. */
function fakeDoc(numPages) {
  const doc = {
    numPages,
    destroyed: 0,
    async getPage(n) {
      return {
        getViewport: () => ({ width: 612, height: H }),
        getTextContent: async () => ({ items: [{ str: `page ${n}`, transform: [1, 0, 0, 1, 100, H - 100], width: 40, height: 10, fontName: "F1" }] }),
        getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
      };
    },
    async getData() {
      return new Uint8Array([1, 2, 3]);
    },
    async destroy() {
      doc.destroyed++;
    },
  };
  return doc;
}

/**
 * A server holding `files` (path → bytes) and a handle's two injected seams:
 * `fetchImpl` counts every request, and `open` counts every open and may be
 * told the file is another book.
 */
function server(files, { pages = 7, wrongBook = false } = {}) {
  const log = { fetches: [], opens: 0, docs: [] };
  return {
    log,
    fetchImpl: async (path) => {
      log.fetches.push(path);
      const bytes = files[path];
      return bytes ? { ok: true, status: 200, arrayBuffer: async () => bytes.buffer } : { ok: false, status: 404 };
    },
    open: async () => {
      log.opens++;
      if (wrongBook) throw Object.assign(new Error("another book"), { wrongBook: "other" });
      const doc = fakeDoc(pages);
      log.docs.push(doc);
      return { doc, numPages: pages, title: "The Real Title" };
    },
  };
}
const handleOn = (srv, extra = {}) =>
  new BookHandle({ bookId: "zz", src: "books/zz.pdf", numPages: 5, title: "Row Label", open: srv.open, fetchImpl: srv.fetchImpl, ...extra });
const FILES = { "books/zz.pdf": new Uint8Array([9, 9, 9]) };

const quiet = console.warn;

/* --- registered: nothing is fetched ---------------------------------------------------------- */
{
  const srv = server(FILES);
  const handle = handleOn(srv);
  ok("a registered handle has fetched nothing", srv.log.fetches.length === 0 && srv.log.opens === 0);
  ok("its size and title come from the registry row until an open", handle.numPages === 5 && handle.title === "Row Label");
  ok("it is not verified and holds no document", handle.verified === false && handle.isLive === false);
  ok("it announces itself as a handle", handle.isBookHandle === true && handle.src === "books/zz.pdf");
  ok("a registered handle licenses no delete", verifiedDoc(handle) === false);
  ok("a plain document is not a handle and is open", verifiedDoc({ numPages: 1 }) === true && verifiedDoc(null) === false);
  ok("reading its numPages and title costs nothing", srv.log.fetches.length === 0);
}

/* --- the first read opens the file once ----------------------------------------------------- */
{
  const srv = server(FILES);
  const handle = handleOn(srv);
  const page = await handle.getPage(3);
  ok("the first page read fetches the file once and opens it once", srv.log.fetches.length === 1 && srv.log.opens === 1);
  ok("the page is the live document's", (await page.getTextContent()).items[0].str === "page 3");
  ok("the handle is verified and reports the file's own size and title", handle.verified && handle.numPages === 7 && handle.title === "The Real Title");
  ok("a verified handle licenses a delete", verifiedDoc(handle) === true);
  await handle.getPage(4);
  await handle.getPage(5);
  ok("later reads reuse the live document", srv.log.fetches.length === 1 && srv.log.opens === 1);
  ok("verify on a verified handle fetches nothing", (await handle.verify()) === true && srv.log.fetches.length === 1);
  ok("liveDoc of a handle is its live document and of a plain document is itself", (await liveDoc(handle)) === srv.log.docs[0] && (await liveDoc(srv.log.docs[0])) === srv.log.docs[0]);
  await handle.destroy();
  ok("destroy releases the live document", srv.log.docs[0].destroyed === 1 && handle.isLive === false);
}

/* --- single flight --------------------------------------------------------------------------- */
{
  const srv = server(FILES);
  const handle = handleOn(srv);
  const docs = await Promise.all([handle.live(), handle.live(), handle.verify().then(() => handle.live()), handle.getPage(1).then(() => handle.live()), handle.live()]);
  ok("five callers at once fetch the file once", srv.log.fetches.length === 1, `${srv.log.fetches.length}`);
  ok("and open it once", srv.log.opens === 1, `${srv.log.opens}`);
  ok("and all hold the same document", docs.every((d) => d === docs[0]));
  const second = handleOn(srv);
  await Promise.all([second.getPage(1), second.getPage(2), second.getPage(3)]);
  ok("concurrent page reads share the one open", srv.log.fetches.length === 2 && srv.log.opens === 2);
}

/* --- a file that is gone, or is another book ------------------------------------------------- */
{
  const files = { ...FILES };
  const srv = server(files);
  const handle = handleOn(srv, { src: "books/missing.pdf" });
  console.warn = () => {};
  ok("verify answers false for a file the server no longer holds", (await handle.verify()) === false);
  ok("the handle is still unverified and holds nothing", handle.verified === false && handle.isLive === false && srv.log.opens === 0);
  await assert.rejects(() => handle.getPage(1), /404/);
  pass++;
  ok("a failed open is not remembered: each call fetches again", srv.log.fetches.length === 2, `${srv.log.fetches.length}`);

  const back = handleOn(srv, { src: "books/back.pdf" });
  ok("a file that is absent now is absent", (await back.verify()) === false);
  files["books/back.pdf"] = new Uint8Array([1]);
  ok("and the same handle verifies once the file is back", (await back.verify()) === true && back.verified === true);

  const wrong = handleOn(server(FILES, { wrongBook: true }));
  ok("a file that fingerprints as another book does not verify", (await wrong.verify()) === false && wrong.verified === false);
  await assert.rejects(() => wrong.getPage(1), /another book/);
  pass++;
  console.warn = quiet;
}

/* --- a handle with no path cannot reopen, so it never releases ------------------------------ */
{
  const srv = server(FILES);
  const picked = new BookHandle({ bookId: "zz", src: null, numPages: 5, title: "x", open: srv.open, fetchImpl: srv.fetchImpl, idleMs: 5 });
  const doc = fakeDoc(3);
  picked.adopt({ doc, numPages: 3, title: "Picked" });
  ok("an adopted document leaves the handle verified", picked.verified && picked.numPages === 3 && picked.title === "Picked");
  await new Promise((r) => setTimeout(r, 40));
  ok("a handle with no path keeps its document past the idle grace", picked.isLive && doc.destroyed === 0);
  ok("its bytes come from the live document", (await picked.getData()).length === 3);
  await assert.rejects(() => handleOn(srv, { src: null }).live(), /no file to open/);
  pass++;
}

/* --- the idle grace and the hold ------------------------------------------------------------- */
{
  ok("the shipped grace outlasts the slowest page render", IDLE_MS >= 90_000);
  const srv = server(FILES);
  const handle = handleOn(srv, { idleMs: 25 });
  await handle.live();
  await new Promise((r) => setTimeout(r, 90));
  ok("an idle live document is released and the vouching lapses with it", handle.isLive === false && handle.verified === false && srv.log.docs[0].destroyed === 1);
  await handle.getPage(1);
  ok("the next read opens it again", srv.log.opens === 2 && srv.log.fetches.length === 2 && handle.verified === true);

  const files = { ...FILES };
  const gone = handleOn(server(files), { idleMs: 25 });
  await gone.live();
  delete files["books/zz.pdf"];
  ok("a file removed while the document is held still reads from the held document", gone.verified === true);
  await new Promise((r) => setTimeout(r, 90));
  console.warn = () => {};
  ok("a file removed before an idle release does not verify afterwards", (await gone.verify()) === false && gone.verified === false);
  console.warn = quiet;

  const held = handleOn(srv, { idleMs: 25 });
  await holdingLive(async () => {
    await held.live();
    await new Promise((r) => setTimeout(r, 90));
    ok("a document is not released while a hold stands", held.isLive === true);
  });
  await new Promise((r) => setTimeout(r, 90));
  ok("and is released after the hold ends and the grace passes", held.isLive === false);
  await handle.destroy();
}

/* --- getData is a fetch of the path ---------------------------------------------------------- */
{
  const srv = server(FILES);
  const handle = handleOn(srv);
  const bytes = await handle.getData();
  ok("getData fetches the file's bytes and opens nothing", bytes.length === 3 && srv.log.fetches.length === 1 && srv.log.opens === 0);
  const gone = handleOn(srv, { src: "books/missing.pdf" });
  await assert.rejects(() => gone.getData(), /404/);
  pass++;
}

/* --- a delete asks verified ------------------------------------------------------------------ */
{
  const srv = server(FILES);
  const sessions = new Map();
  initCookbook({ sessionDocs: sessions });
  const handle = handleOn(srv);
  sessions.set("zz", { doc: handle, title: "Row Label" });
  const books = { zz: {} };
  const verdict = () => rebuildVerdict({ owned: true, book: "zz", isOpen: bookVerified, books });
  ok("a registered book is registered, and a delete on it is refused as closed", sessions.has("zz") && verdict() === "closed");
  await verifyBooks([]);
  ok("verifying no books fetches nothing", srv.log.fetches.length === 0 && verdict() === "closed");
  ok("verifying the book opens the file and licenses the delete", (await verifiedBook("zz")) === true && verdict() === "rebuild" && srv.log.fetches.length === 1);

  const gone = handleOn(server({}), { src: "books/missing.pdf" });
  sessions.set("zz", { doc: gone, title: "x" });
  console.warn = () => {};
  ok("a book whose file is gone stays closed to deletes after verification", (await verifiedBook("zz")) === false && verdict() === "closed");
  console.warn = quiet;
  ok("a book that is not on this seat is never verified", (await verifiedBook("absent")) === false && bookVerified("absent") === false);
  ok("a plain open document licenses a delete", (sessions.set("zz", { doc: fakeDoc(2) }), verdict() === "rebuild"));
  ok("verifyDoc of a plain document answers true and of nothing false", (await verifyDoc(fakeDoc(1))) === true && (await verifyDoc(undefined)) === false);
}

/* --- a read verifies before its first page --------------------------------------------------- */
{
  const SCHEMA = "acks-cookbook/2";
  const entry = (name) => ({
    kind: "kind.proficiency",
    name,
    cite: "ZZ 2",
    pages: [2],
    book: "zz",
    meta: { category: "proficiency", general: true },
    fields: { note: { op: "value", page: 2, box: { x0: 0, x1: 400, y0: 50, y1: 150 }, pattern: "raw" } },
  });
  const CONTENT = { proficiencies: { schema: SCHEMA, entries: { "def.prof.gamma": entry("Gamma") } } };
  globalThis.game = { i18n: { localize: (k) => k, format: (k) => k }, settings: { get: () => undefined } };
  globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
  globalThis.foundry = {
    utils: {
      fetchJsonWithTimeout: async (url) => {
        const name = String(url).split("/").pop().replace(/\.json$/, "");
        if (name === "registers") return {};
        if (name === "index") return { books: [], content: Object.keys(CONTENT) };
        if (CONTENT[name]) return structuredClone(CONTENT[name]);
        throw new Error(`404 ${url}`);
      },
    },
  };
  const sessions = new Map();
  initCookbook({ sessionDocs: sessions });
  ok("the invented cookbook loads", await loadCookbook());

  const ID = "def.prof.gamma";
  const present = server(FILES, { pages: 4 });
  sessions.set("zz", { doc: handleOn(present), title: "x" });
  ok("registering the book for a read fetches nothing", present.log.fetches.length === 0);
  const read = await readForImport(ID);
  ok("a read opens the file and answers a node", read.reason === null && read.node?.ok === true, JSON.stringify(read.reason));
  ok("it fetched one file", present.log.fetches.length === 1 && present.log.opens === 1);
  await readForImport(ID);
  ok("a second read fetches nothing more", present.log.fetches.length === 1);

  const missing = server({}, { pages: 4 });
  const absent = handleOn(missing, { src: "books/missing.pdf" });
  sessions.set("zz", { doc: absent, title: "x" });
  console.warn = () => {};
  const closed = await readForImport(ID);
  ok("a read of a book whose file is gone answers book-closed", closed.node === null && closed.reason === "book-closed", JSON.stringify(closed));
  ok("and opened nothing", missing.log.opens === 0 && absent.verified === false);
  let built = 0;
  const repaired = await repairFromEntry({}, ID, () => (built++, {}), null);
  ok("a repair over that book answers book-closed and builds nothing", repaired === "book-closed" && built === 0, String(repaired));
  const inHold = await holdingReads(() => readForImport(ID));
  ok("a read hold does not change the answer", inHold.reason === "book-closed");
  console.warn = quiet;

  const wrong = server(FILES, { wrongBook: true });
  sessions.set("zz", { doc: handleOn(wrong), title: "x" });
  console.warn = () => {};
  ok("a file that is another book answers book-closed", (await readForImport(ID)).reason === "book-closed");
  console.warn = quiet;

  // A direct reader hands executeEntry the session's document and reads `ok`.
  const none = server({}, { pages: 4 });
  console.warn = () => {};
  const direct = await executeEntry(handleOn(none, { src: "books/missing.pdf" }), CONTENT.proficiencies, {}, ID);
  ok("executeEntry on a handle whose file is gone refuses with book-closed and no fields", direct.ok === false && direct.reason === "book-closed" && Object.keys(direct.fields).length === 0, JSON.stringify(direct));
  console.warn = quiet;
  ok("and opened nothing", none.log.opens === 0);
  const live = server(FILES, { pages: 4 });
  const fresh = handleOn(live);
  const good = await executeEntry(fresh, CONTENT.proficiencies, {}, ID);
  ok("executeEntry on a handle whose file is there verifies it first and reads", good.ok === true && fresh.verified === true && live.log.fetches.length === 1, JSON.stringify(good.reason));
  ok("executeEntry on a plain open document reads it as before", (await executeEntry(fakeDoc(4), CONTENT.proficiencies, {}, ID)).ok === true);
}

/* --- a real proxy has no destroy; its loading task does ---------------------------------------- */
{
  // pdf.js's PDFDocumentProxy offers `loadingTask.destroy()` and no `destroy` of its own.
  const proxyDoc = (pages = 7) => {
    const doc = fakeDoc(pages);
    delete doc.destroy;
    doc.taskDestroyed = 0;
    doc.loadingTask = {
      async destroy() {
        doc.taskDestroyed++;
      },
    };
    return doc;
  };
  const proxyServer = (opts = {}) => {
    const srv = server(FILES, opts);
    srv.open = async () => {
      srv.log.opens++;
      const doc = proxyDoc();
      srv.log.docs.push(doc);
      return { doc, numPages: 7, title: "The Real Title" };
    };
    return srv;
  };

  const srv = proxyServer();
  const handle = handleOn(srv);
  await handle.live();
  await handle.destroy();
  ok("destroy releases a proxy through its loading task", srv.log.docs[0].taskDestroyed === 1 && handle.isLive === false);

  const idleSrv = proxyServer();
  const idle = handleOn(idleSrv, { idleMs: 25 });
  await idle.live();
  await new Promise((r) => setTimeout(r, 90));
  ok("an idle release reaches the proxy's loading task", idle.isLive === false && idleSrv.log.docs[0].taskDestroyed === 1);

  const adoptSrv = proxyServer();
  const adopting = handleOn(adoptSrv);
  const first = proxyDoc();
  const second = proxyDoc();
  adopting.adopt({ doc: first, numPages: 7, title: "A" });
  adopting.adopt({ doc: second, numPages: 7, title: "B" });
  await Promise.resolve();
  ok("adopting a second document releases the first through its task and keeps the second", first.taskDestroyed === 1 && second.taskDestroyed === 0);
  adopting.adopt({ doc: second, numPages: 7, title: "B" });
  ok("adopting the document already held releases nothing", second.taskDestroyed === 0);
  await adopting.destroy();
  ok("destroying the adopting handle releases the held proxy", second.taskDestroyed === 1);

  let finish;
  const gate = new Promise((r) => (finish = r));
  const late = proxyDoc();
  const racing = handleOn(srv, {
    open: async () => {
      await gate;
      return { doc: late, numPages: 7, title: "T" };
    },
  });
  const opening = racing.live().catch((err) => err);
  await Promise.resolve();
  await racing.destroy();
  finish();
  const refused = await opening;
  ok("a document that opens after the handle was destroyed is released through its task", /destroyed while it opened/.test(refused?.message) && late.taskDestroyed === 1);
}

console.log(`test-book-handle: ${pass} checks passed`);
