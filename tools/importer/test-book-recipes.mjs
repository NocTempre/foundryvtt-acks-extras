/**
 * The per-book table-recipe merge: a book's tables join a doc's shared ones one
 * table at a time, after them and in manifest order, stamped with the book; a
 * table id defined twice throws and names both places. Runs on invented book,
 * doc and table ids, so no book's printed names or values stand in a fixture.
 * The shipped seam is held to its own contract at the end.
 */
import assert from "node:assert";
import { mergeBookTableRecipes } from "../../scripts/importer/books/merge.mjs";
import { BOOK_CODE } from "../../scripts/importer/books/index.mjs";
import { REGISTRY } from "../../scripts/importer/books.mjs";
import { TABLE_RECIPES } from "../../scripts/importer/table-recipes.mjs";

let pass = 0;
const check = (label, cond) => {
  assert.ok(cond, label);
  pass++;
};
const throwsWith = (fn, ...parts) => {
  try {
    fn();
  } catch (err) {
    return parts.every((p) => String(err.message).includes(p));
  }
  return false;
};

const LABELS = { qa1: { label: "Invented Book A" }, qb2: { label: "Invented Book B" } };
const shared = () => ({
  docX: { source: { book: "Invented Shared", pages: "QZ 1-2" }, tables: { t1: { shape: "g", book: "qz" }, t2: { shape: "g" } } },
  docY: { source: { book: "Invented Shared", pages: "QZ 9" }, tables: { u1: { shape: "g" } } },
});
const keys = (doc) => Object.keys(doc.tables).join();

/* order and stamping */
const base = shared();
const a = { tableRecipes: { docX: { pages: "QA 5", tables: { ta1: { shape: "a" }, ta2: { shape: "a", book: "qa1" } } } } };
const b = { tableRecipes: { docX: { pages: "QB 7-8", tables: { tb1: { shape: "b" } } } } };
const merged = mergeBookTableRecipes(base, { qa1: a, qb2: b }, LABELS);
check("a doc's shared tables come first, then each book's in the order given", keys(merged.docX) === "t1,t2,ta1,ta2,tb1");
const swapped = mergeBookTableRecipes(base, { qb2: b, qa1: a }, LABELS);
check("reversing the books reverses their tables and nothing else", keys(swapped.docX) === "t1,t2,tb1,ta1,ta2");
check("every merged table carries its book, and a shared table keeps what it had", merged.docX.tables.ta1.book === "qa1" && merged.docX.tables.ta2.book === "qa1" && merged.docX.tables.tb1.book === "qb2" && merged.docX.tables.t1.book === "qz" && merged.docX.tables.t2.book === undefined);
check("the first table of a doc that names a book is the shared one, so a book table never takes its place", Object.values(merged.docX.tables).find((t) => t.book).book === "qz");
const bookFirst = mergeBookTableRecipes({ docZ: { source: { pages: "QZ 3" }, tables: { z1: { shape: "g" } } } }, { qb2: { tableRecipes: { docZ: { tables: { zb: { shape: "b" } } } } } }, LABELS);
check("where no shared table names a book the first book's table is the one rebuild reads", Object.values(bookFirst.docZ.tables).find((t) => t.book).book === "qb2");
check("a book's pages follow the doc's, joined with a semicolon", merged.docX.source.pages === "QZ 1-2; QA 5; QB 7-8" && merged.docX.source.book === "Invented Shared");
check("a doc no book touches is the shared object itself", merged.docY === base.docY);
check("the inputs are not changed", keys(base.docX) === "t1,t2" && base.docX.source.pages === "QZ 1-2" && !("book" in a.tableRecipes.docX.tables.ta1) && keys(base.docY) === "u1");
check("a book with no contribution, or an empty one, changes nothing", mergeBookTableRecipes(base, { qa1: {}, qb2: { tableRecipes: {} } }, LABELS).docX === base.docX);

/* a doc only a book defines */
const only = mergeBookTableRecipes(base, { qa1: { tableRecipes: { docW: { pages: "QA 40", tables: { w1: { shape: "a" } } } } }, qb2: { tableRecipes: { docW: { pages: "QB 3", tables: { w2: { shape: "b" } } } } } }, LABELS);
check("a doc only books define is created from them, its source from the first book's label", keys(only.docW) === "w1,w2" && only.docW.source.book === "Invented Book A" && only.docW.source.pages === "QA 40; QB 3");
check("a created doc's tables are stamped by the book that wrote each", only.docW.tables.w1.book === "qa1" && only.docW.tables.w2.book === "qb2");
const noPages = mergeBookTableRecipes({}, { qa1: { tableRecipes: { docV: { tables: { v1: {} } } } } }, LABELS);
check("a created doc with no pages has no `pages` key", !("pages" in noPages.docV.source) && noPages.docV.source.book === "Invented Book A");

/* duplicates and mismatches */
check("a book table whose id a shared table holds throws, naming both places", throwsWith(() => mergeBookTableRecipes(base, { qa1: { tableRecipes: { docX: { tables: { t2: {} } } } } }, LABELS), '"t2"', '"docX"', "table-recipes.mjs", "books/qa1/index.mjs"));
check("two books defining one table throw, naming both", throwsWith(() => mergeBookTableRecipes(base, { qa1: { tableRecipes: { docX: { tables: { tx: {} } } } }, qb2: { tableRecipes: { docX: { tables: { tx: {} } } } } }, LABELS), '"tx"', "books/qa1/index.mjs", "books/qb2/index.mjs"));
check("the same table id in another doc is no duplicate", !throwsWith(() => mergeBookTableRecipes(base, { qa1: { tableRecipes: { docX: { tables: { u1: {} } } } } }, LABELS), "defined twice"));
check("a book table naming another book throws", throwsWith(() => mergeBookTableRecipes(base, { qa1: { tableRecipes: { docX: { tables: { tq: { book: "qb2" } } } } } }, LABELS), '"tq"', '"qb2"', "books/qa1/index.mjs"));

/* the shipped seam */
check("every id the manifest names is a registry book", Object.keys(BOOK_CODE).every((id) => Object.hasOwn(REGISTRY, id) && REGISTRY[id].stats !== "ose"));
check("the shipped merge holds every shared document and no book's table twice", Object.keys(TABLE_RECIPES).length > 0 && Object.values(TABLE_RECIPES).every((d) => d.tables && Object.keys(d.tables).length));

console.log(`\ntest-book-recipes: all ${pass} checks passed`);
