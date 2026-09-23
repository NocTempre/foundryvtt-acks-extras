/**
 * LOCAL-ONLY: every table recipe cites the printed folio its page search lands
 * on, and its document's `source.pages` names that folio under the book's short
 * name. Runs each search the import makes (`recipeLocates` → `locatePageNumber`)
 * against the real books; prints ids and page numbers, never book text. Skips
 * without the ref lib.
 */
import assert from "node:assert";
import fs from "node:fs";
import { openBook } from "../../scripts/importer/extract.mjs";
import { TABLE_RECIPES } from "../../scripts/importer/table-recipes.mjs";
import { BOOKS } from "../../scripts/importer/books.mjs";
import { locatePageNumber, recipeLocates } from "../../scripts/importer/tables-binding.mjs";
import { FILES, referenceComplete } from "./reference-lib.mjs";

if (!referenceComplete()) {
  console.log("test-recipe-pages: reference PDFs absent — skipped.");
  process.exit(0);
}

const docs = {};
const open = async (book) => (docs[book] ??= (await openBook(fs.readFileSync(FILES[book]))).doc);

let pass = 0;
const failures = [];
const check = (label, cond) => (cond ? pass++ : failures.push(label));

// The folio a PDF page prints: the PDF's own page label where the file carries
// one, which also checks the book's `printedOffset`; else the offset alone.
const labels = new Map();
async function folioOf(book, doc, page) {
  if (!labels.has(book)) labels.set(book, await doc.getPageLabels());
  const byOffset = page - (BOOKS[book]?.printedOffset ?? 0);
  const label = labels.get(book)?.[page - 1];
  if (!/^\d+$/.test(label ?? "")) return byOffset;
  check(`${book} PDF p${page}: printedOffset agrees with the page label ${label}`, Number(label) === byOffset);
  return Number(label);
}

// "JJ 42-67; RR 281-285" → {JJ: {42…67}, RR: {281…285}}; null when a segment
// names no book.
function citedFolios(pages) {
  const out = {};
  for (const seg of String(pages ?? "").split(";")) {
    const m = seg.trim().match(/^([A-Z][A-Z0-9]*) (\d.*)$/);
    if (!m) return null;
    const set = (out[m[1]] ??= new Set());
    for (const part of m[2].split(",")) {
      const [a, b = a] = part.trim().split(/[-–]/).map(Number);
      for (let n = a; n <= b; n++) set.add(n);
    }
  }
  return out;
}

for (const [docId, docRec] of Object.entries(TABLE_RECIPES)) {
  const cited = citedFolios(docRec.source?.pages);
  check(`${docId}: source.pages names a book before its pages`, !!cited);
  for (const [tableId, recipe] of Object.entries(docRec.tables)) {
    for (const { id, args } of recipeLocates(recipe)) {
      const name = `${docId}.${tableId}${id ? `.${id}` : ""}`;
      check(`${name}: has a locate`, !!args.locate);
      check(`${name}: reads a book with a reference file`, !!FILES[args.book]);
      if (!args.locate || !FILES[args.book]) continue;
      const doc = await open(args.book);
      const page = await locatePageNumber(doc, args);
      check(`${name}: located`, page != null);
      if (page == null) continue;
      const folio = await folioOf(args.book, doc, page);
      const short = BOOKS[args.book]?.short ?? args.book;
      check(`${name}: cites p${args.printedPage} and reads folio ${folio}`, folio === args.printedPage);
      check(`${name}: ${docId} source.pages names ${short} ${folio}`, !!cited?.[short]?.has(folio));
    }
  }
}

assert.deepStrictEqual(failures, [], `test-recipe-pages: ${failures.length} failed:\n  ${failures.join("\n  ")}`);
console.log(`test-recipe-pages: ${pass} checks passed.`);
