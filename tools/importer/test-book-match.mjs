/** Matching picked files to books, and telling a book by its fingerprint. No PDFs, no Foundry. */
import assert from "node:assert";
import { matchFilesToBooks } from "../../scripts/importer/book-match.mjs";
import { BOOKS, identifyBook } from "../../scripts/importer/books.mjs";

let pass = 0;
const check = (label, cond) => { assert.ok(cond, label); pass++; };

const file = (name, size = 0) => ({ name, size });
const NONE = new Map();
const named = ({ matched }) => Object.fromEntries([...matched].map(([id, f]) => [id, f.name]));

/* The reported failure that shaped this matcher: four stock DTRPG downloads
 * picked in one go. The OS picker returns files in its own order, so anything
 * pairing on POSITION gave each book somebody else's PDF — each one warning it
 * was a "different printing" of the book it was not. Position is not evidence,
 * and since the Books window puts a control on every book's own row, nothing
 * asks this matcher to guess any more: it places a file or it names it. */
const stock = [
  file("ACKS II Judges Journal.pdf"),
  file("ACKS II Monstrous Manual.pdf"),
  file("ACKS II Revised Rulebook.pdf"),
  file("By This Axe The Cyclopedia of Dwarven Civilization.pdf"),
];
const all = matchFilesToBooks(stock, ["rr", "jj", "bta", "mm"], NONE);
assert.deepEqual(named(all), {
  rr: "ACKS II Revised Rulebook.pdf",
  jj: "ACKS II Judges Journal.pdf",
  bta: "By This Axe The Cyclopedia of Dwarven Civilization.pdf",
  mm: "ACKS II Monstrous Manual.pdf",
});
pass++;
check("every file placed, none left over", !all.unmatched.length);

// Separators a real download uses, and the reverse pick order, change nothing.
const renamed = matchFilesToBooks(
  [file("acks_ii_judges_journal.pdf"), file("ACKS-II-Revised-Rulebook.pdf")],
  ["rr", "jj"],
  NONE,
);
check("underscores/hyphens still name the book", named(renamed).rr === "ACKS-II-Revised-Rulebook.pdf");
check("pick order is not pairing order", named(renamed).jj === "acks_ii_judges_journal.pdf");

// What this seat called the file last time outranks what the filename says.
const remembered = new Map([["jj", { name: "book2.pdf" }], ["rr", { size: 4242 }]]);
const byRecord = matchFilesToBooks([file("book2.pdf"), file("book1.pdf", 4242)], ["rr", "jj"], remembered);
check("remembered name claims its file", named(byRecord).jj === "book2.pdf");
check("remembered size claims its file", named(byRecord).rr === "book1.pdf");

/* Nothing to go on: NAMED, never guessed. A book filled from the wrong PDF is
 * far worse than a book left closed, and the remedy is that book's own row —
 * whose picker names the book, so no guessing is left to do. */
const blind = matchFilesToBooks([file("book-a.pdf"), file("book-b.pdf")], ["rr", "jj"], NONE);
check("an unnameable file claims no book", blind.matched.size === 0);
check("every unnameable file is reported back", blind.unmatched.length === 2);

// Fewer files than books, and more files than books, are both handled.
const short = matchFilesToBooks([file("ACKS II Judges Journal.pdf")], ["rr", "jj"], NONE);
check("a book with no file is simply absent", !short.matched.has("rr"));
check("short never means mispaired", named(short).jj === "ACKS II Judges Journal.pdf");
const over = matchFilesToBooks(
  [file("ACKS II Revised Rulebook.pdf"), file("ACKS II Judges Journal.pdf")],
  ["rr"],
  NONE,
);
check("a file no candidate book claims is unmatched", over.unmatched.length === 1);
check("the unmatched file is the one with no candidate", over.unmatched[0].name === "ACKS II Judges Journal.pdf");
check("the candidate book still got its own file", named(over).rr === "ACKS II Revised Rulebook.pdf");

// The shelf scan runs the same matcher with sizes it cannot know (browse gives
// paths, not sizes), so the name and title passes have to carry it alone.
const shelf = matchFilesToBooks(
  [file("ACKS II Monstrous Manual.pdf"), file("holiday-photos.pdf")],
  ["mm", "tt"],
  NONE,
);
check("a shelved file is matched with no size to go on", named(shelf).mm === "ACKS II Monstrous Manual.pdf");
check("a stray PDF on the shelf claims nothing", shelf.unmatched.length === 1 && !shelf.matched.has("tt"));

/* Fingerprints: a title, where the printing carries one, must agree. */
check("page count + title names the book", identifyBook(BOOKS.jj.pages, "ACKS II Judges Journal") === "jj");
check("an untitled printing is named by count alone", identifyBook(BOOKS.ax2.pages, "") === "ax2");
// Page counts were once distinct across the whole registry, which made every
// printing identifiable with or without a title. Third-party titles ended that
// — two Quick Delves both run to 20 pages — so what has to hold is the safety
// property underneath: a count shared by two books identifies NEITHER unless a
// title separates them, and a count belonging to one book still names it when
// the printing carries no metadata title at all, as every AX book does.
{
  const counts = Object.values(BOOKS).map((b) => b.pages);
  const shared = new Set(counts.filter((c, i) => counts.indexOf(c) !== i));
  for (const [id, book] of Object.entries(BOOKS)) {
    const untitled = identifyBook(book.pages, "");
    if (shared.has(book.pages)) check(`a shared page count names nobody untitled (${id})`, untitled === null);
    else check(`a unique page count names its book untitled (${id})`, untitled === id);
  }
}
// A short printing of a book this build has never seen names nobody, which is
// what keeps edition drift a warning rather than a refusal.
check("an unknown page count names nobody", identifyBook(9999, "ACKS II Revised Rulebook") === null);
check("a count collision with a foreign title names nobody", identifyBook(BOOKS.jj.pages, "ACKS II Revised Rulebook") === null);

console.log(`\ntest-book-match: all ${pass} checks passed`);
