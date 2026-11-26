/**
 * How the importer's boot file looks after a book is opened, shelved, cited and
 * forgotten: the shape of each seam, read from source, because the module
 * needs Foundry and a PDF engine to run. What the seams DO is the live walk's
 * (docs/importer/TESTING.md, "Books: an open book, a citation, a forgotten book").
 * No PDFs, no Foundry.
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";

let pass = 0;
const ok = (label, cond) => {
  assert.ok(cond, label);
  pass++;
};

const src = readFileSync(new URL("../../scripts/importer/module.mjs", import.meta.url), "utf8");
const fn = (head) => src.match(new RegExp(`${head}[\\s\\S]*?\\n\\}`))?.[0] ?? "";

// "Add to server" on an open book works with the refresh bridge off.
{
  const open = fn("async function shelveOpen\\(");
  ok("shelveOpen is found", open.length > 0);
  ok("shelveOpen reads the bridge first", /bytesGet\(bookId\)/.test(open));
  ok("shelveOpen falls back to the open document", /\?\? \(await openBookBytes\(bookId\)/.test(open));
  ok("shelveOpen still refuses when neither holds bytes", /shelfNoBytes/.test(open));
  ok("the bytes it uploads are marked already fingerprinted", /\{ verified: true \}/.test(open));
  const cache = fn("async function cacheBytes\\(");
  ok("the bridge still stores nothing when its window is 0", /!cacheWindowMs\(\)\) return/.test(cache));
}

// A connect or a staging opens through the one checked open and leaves the handle verified.
{
  const checked = fn("async function openChecked\\(");
  ok("openChecked is found", checked.length > 0);
  ok("it refuses a file that fingerprints as another book", /actualId !== bookId/.test(checked) && /err\.wrongBook = actualId/.test(checked));
  ok("it refuses a form with no fields", /bookIsForm\(bookId\)/.test(checked) && /connectNotForm/.test(checked));
  ok("a refused file's document is released", (checked.match(/await releaseDoc\(doc\)/g) ?? []).length === 2);
  ok("no importer site releases a document with doc.destroy, a silent no-op on a pdf.js proxy", !/\bdoc\??\.destroy\?\./.test(src));
  ok("it tags the document before any page is read", checked.indexOf("useTypography(doc, bookId)") > checked.indexOf("readForm"));
  const ingest = fn("async function ingestBook\\(");
  ok("ingestBook opens through openChecked", /await openChecked\(bookId, buffer\)/.test(ingest));
  ok("ingestBook keeps a registered handle and adopts the open document into it", /held\?\.isBookHandle \? held : handleFor\(bookId, src\)\)\.adopt\(/.test(ingest));
  ok("the session record's document is the handle", /sessionDocs\.set\(bookId, \{ doc: handle, title \}\)/.test(ingest));
  ok("a book opened by hand reaches the handle with no path", /async function ingestBook\(bookId, buffer, \{ silent = false, cache = null, src = null \} = \{\}\)/.test(src));
}

// The character sheet's export reads the file when Export is pressed, never at join.
{
  const blank = readFileSync(new URL("../../scripts/character-sheet/pdf/blank.mjs", import.meta.url), "utf8");
  ok("the blank sheet is read through the importer's bookBytes on demand", /importer\?\.bookBytes\?\.\(SHEET_BOOK\)/.test(blank));
}

// A citation clicked in a detached window reaches the handler.
{
  const listen = fn("function listenForCites\\(");
  ok("listenForCites is found", listen.length > 0);
  ok("it walks every page the client draws in", /for \(const page of clientPages\(\)\)/.test(listen));
  ok("it wires each page once", /citeListening\.has\(page\)\) continue/.test(listen) && /citeListening\.add\(page\)/.test(listen));
  ok("the guard is a WeakSet", /const citeListening = new WeakSet\(\)/.test(src));
  ok("the listener is the capture-phase handler", /page\.addEventListener\("click", onCiteClick, \{ capture: true \}\)/.test(listen));
  ok("it is wired at ready and as each detached window opens", /listenForCites\(\);\s*Hooks\.on\("openDetachedWindow", listenForCites\)/.test(src));
  ok("the main page alone is never the listener's target", !/document\.addEventListener\("click", onCiteClick/.test(src));
  const cite = fn("function onCiteClick\\(");
  ok("the handler tells an element by closest, never instanceof", cite.length > 0 && !/instanceof/.test(cite + listen));
}

// Forgetting books releases each open document's worker.
{
  const forget = fn("async function forgetBooks\\(");
  ok("forgetBooks is found", forget.length > 0);
  ok("it takes the open documents before clearing", forget.indexOf("[...sessionDocs]") > -1 && forget.indexOf("[...sessionDocs]") < forget.indexOf("sessionDocs.clear()"));
  ok("it releases each one through the loading task", /await releaseDoc\(doc\)/.test(forget));
  ok("a document that refuses to be released is a console warning", /catch \(err\) \{\s*console\.warn\(/.test(forget.slice(forget.indexOf("releaseDoc"))));
}

// Apply Stats names the monsters whose page no longer matches.
{
  const apply = fn("async function applyStats\\(");
  ok("applyStats is found", apply.length > 0);
  ok("a no-match is collected", /reason === "no-match"\) \{\s*noMatch\.push\(actor\.name\)/.test(apply));
  ok("the collected names are warned through the lang string", /applyStatsNoMatch/.test(apply));
  const lang = JSON.parse(readFileSync(new URL("../../lang/en.json", import.meta.url), "utf8"));
  ok("the lang string exists and takes the names", /\{names\}/.test(lang["ACKS-IMPORTER.ui.applyStatsNoMatch"] ?? ""));
}

// Reconnect all counts a book once.
{
  ok(
    "a book the folder opened and the pending list holds is counted once",
    /const opened = new Set\(\[\.\.\.folderOpened, \.\.\.pending\.filter\(\(id\) => sessionDocs\.has\(id\)\)\]\)\.size;/.test(src),
  );
  // The count's arithmetic, on the shapes the bulk button produces.
  const count = (folderOpened, pending, open) => new Set([...folderOpened, ...pending.filter((id) => open.has(id))]).size;
  ok("a folder-opened pending book is one", count(["a"], ["a", "b"], new Set(["a"])) === 1);
  ok("a folder book with no record and a restored one are two", count(["a"], ["b"], new Set(["a", "b"])) === 2);
  ok("nothing opened is zero", count([], ["a"], new Set()) === 0);
}

console.log(`test-book-lifecycle: ${pass} checks passed`);
