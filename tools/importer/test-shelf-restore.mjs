/**
 * Which shelved books a seat registers at join: the books whose shelf page it
 * may observe, and no others — a GM every one, a player only what the Judge
 * shared, the form included. Registering is a handle with no fetch and no
 * worker; a seat that may not read a book never holds one. No PDFs, no Foundry.
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { BOOKS, bookIsForm, shelfBooksToOpen } from "../../scripts/importer/books.mjs";

let pass = 0;
const check = (label, got, want) => {
  assert.deepEqual(got, want, label);
  pass++;
};
const ok = (label, cond) => {
  assert.ok(cond, label);
  pass++;
};

const FORM = Object.keys(BOOKS).find(bookIsForm);
const [GM_ONLY, SHARED, OPEN_ALREADY] = Object.keys(BOOKS).filter((id) => !bookIsForm(id));
ok("the registry has a form and three books to build a shelf from", FORM && GM_ONLY && SHARED && OPEN_ALREADY);

// A shelf as `shelf()` reads it, each record carrying who the Judge shared its
// journal with; an id the registry has never heard of is on it too.
const staged = {
  [GM_ONLY]: { path: `books/${GM_ONLY}.pdf`, readers: [] },
  [SHARED]: { path: `books/${SHARED}.pdf`, readers: ["player"] },
  [OPEN_ALREADY]: { path: `books/${OPEN_ALREADY}.pdf`, readers: ["player"] },
  [FORM]: { path: `books/${FORM}.pdf`, readers: ["player"] },
  "not-a-book": { path: "books/not-a-book.pdf", readers: ["player"] },
};
const seat = (user) => ({
  observes: (record) => user === "gm" || record.readers.includes(user),
  isOpen: (id) => id === OPEN_ALREADY,
});
const registers = (user, shelf = staged) => {
  const { observes, isOpen } = seat(user);
  return shelfBooksToOpen(shelf, observes, isOpen).sort();
};

check("a player opens what was shared with it, the form among them", registers("player"), [SHARED, FORM].sort());
ok("a player never opens a book the Judge did not share", !registers("player").includes(GM_ONLY));
check("a player shared nothing opens nothing", registers("stranger"), []);
check("a GM opens every book the registry knows", registers("gm"), [GM_ONLY, SHARED, FORM].sort());
ok("a book already open is not opened twice", !registers("gm").includes(OPEN_ALREADY));
ok("an id the registry does not know is never opened", !registers("gm").includes("not-a-book"));

const withheldForm = { ...staged, [FORM]: { ...staged[FORM], readers: [] } };
ok("a form the Judge withheld is not opened", !registers("player", withheldForm).includes(FORM));
check("an empty shelf opens nothing", registers("gm", {}), []);

// The restore asks the predicate, with no reading of its own beside it.
{
  const boot = readFileSync(new URL("../../scripts/importer/module.mjs", import.meta.url), "utf8");
  const restore = boot.match(/async function restoreShelf\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  ok("restoreShelf is found", restore.length > 0);
  ok("restoreShelf picks its books through shelfBooksToOpen", /shelfBooksToOpen\(/.test(restore));
  ok("restoreShelf asks no book its kind", !/bookIsForm/.test(restore));
  // Nothing at join: a registration is a handle and a hook, and no read of the file.
  ok("restoreShelf registers a BookHandle per book", /handleFor\(bookId, staged\[bookId\]\.path\)/.test(restore) && /sessionDocs\.set\(bookId, \{ doc: handle/.test(restore));
  ok("restoreShelf announces each registered book", /Hooks\.callAll\("acksExtras\.bookOpened", bookId\)/.test(restore));
  ok("restoreShelf fetches nothing", !/fetch\(|openBook\(|connectBookUrl\(|ingestBook\(|openChecked\(/.test(restore));
  ok("restoreShelf awaits nothing, so no other path can open a book while it runs", !/\bawait\b/.test(restore.replace("async function restoreShelf", "")));
  ok("restoreShelf reports the batch once, on the console", (restore.match(/console\.log\(/g) ?? []).length === 1);
  const handleFor = boot.match(/function handleFor\([\s\S]*?\n\}/)?.[0] ?? "";
  ok("a handle opens through the shared checked open", /open: \(buffer\) => openChecked\(bookId, buffer\)/.test(handleFor));
  ok("a handle carries the book's typography from its first page", /return useTypography\(handle, bookId\)/.test(handleFor));
  ok("a handle's size and title come from the registry row", /numPages: row\?\.pages/.test(handleFor) && /title: row\?\.label/.test(handleFor));
  const connect = boot.match(/async function connectBookUrl\([\s\S]*?\n\}/)?.[0] ?? "";
  ok("connectBookUrl hands silent and the path to the open", /silent = false/.test(connect) && /ingestBook\(bookId, await blob\.arrayBuffer\(\), \{ silent,[^}]*src: url/.test(connect));
  const ingest = boot.match(/async function ingestBook\([\s\S]*?\n\}/)?.[0] ?? "";
  ok("a silent open raises no progress bar", /const bar = silent\s*\?\s*\{ note\(\) \{\}, step\(\) \{\}, finish\(\) \{\} \}\s*: progressBar\(/.test(ingest));
  ok("a silent open raises no notice", /if \(silent\) console\.debug\(message\);\s*else ui\.notifications\.info\(message\);/.test(ingest));
  // A book opened by hand keeps both.
  ok("a book opened by hand keeps its bar and notice", /ingestBook\(bookId, await file\.arrayBuffer\(\), \{ cache: file \}\)/.test(boot));
  // A player seat that opens nothing because the shelf is withheld from it is
  // not a seat with nothing anywhere: a world with a shelf never hands it the
  // first-run walkthrough.
  ok("the first-run walkthrough waits on an empty shelf", /!Object\.keys\(shelf\(\)\)\.length && !gettingStartedDismissed\(\)/.test(boot));
}

console.log(`test-shelf-restore: ${pass} checks passed`);
