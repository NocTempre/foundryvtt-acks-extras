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
  ok("restoreShelf fetches nothing", !/fetch\(|openBook\(|connectBookUrl\(|ingestBook\(|openChecked\(/.test(restore));
  ok("restoreShelf awaits nothing, so no other path can open a book while it runs", !/\bawait\b/.test(restore.replace("async function restoreShelf", "")));
}

console.log(`test-shelf-restore: ${pass} checks passed`);
