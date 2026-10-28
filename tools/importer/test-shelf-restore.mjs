/**
 * Which shelved books a seat opens at join: the books whose shelf page it may
 * observe, and no others — a GM every one, a player only what the Judge
 * shared, the form included. A book is a fetch and a parse of the whole PDF,
 * so a book opened on a seat that may not read it is pure cost at every join.
 * No PDFs, no Foundry.
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
const opens = (user, shelf = staged) => {
  const { observes, isOpen } = seat(user);
  return shelfBooksToOpen(shelf, observes, isOpen).sort();
};

check("a player opens what was shared with it, the form among them", opens("player"), [SHARED, FORM].sort());
ok("a player never opens a book the Judge did not share", !opens("player").includes(GM_ONLY));
check("a player shared nothing opens nothing", opens("stranger"), []);
check("a GM opens every book the registry knows", opens("gm"), [GM_ONLY, SHARED, FORM].sort());
ok("a book already open is not opened twice", !opens("gm").includes(OPEN_ALREADY));
ok("an id the registry does not know is never opened", !opens("gm").includes("not-a-book"));

const withheldForm = { ...staged, [FORM]: { ...staged[FORM], readers: [] } };
ok("a form the Judge withheld is not opened", !opens("player", withheldForm).includes(FORM));
check("an empty shelf opens nothing", opens("gm", {}), []);

// The restore asks the predicate, with no reading of its own beside it.
{
  const boot = readFileSync(new URL("../../scripts/importer/module.mjs", import.meta.url), "utf8");
  const restore = boot.match(/async function restoreShelf\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  ok("restoreShelf is found", restore.length > 0);
  ok("restoreShelf picks its books through shelfBooksToOpen", /shelfBooksToOpen\(/.test(restore));
  ok("restoreShelf asks no book its kind", !/bookIsForm/.test(restore));
  // A player seat that opens nothing because the shelf is withheld from it is
  // not a seat with nothing anywhere: a world with a shelf never hands it the
  // first-run walkthrough.
  ok("the first-run walkthrough waits on an empty shelf", /!Object\.keys\(shelf\(\)\)\.length && !gettingStartedDismissed\(\)/.test(boot));
}

console.log(`test-shelf-restore: ${pass} checks passed`);
