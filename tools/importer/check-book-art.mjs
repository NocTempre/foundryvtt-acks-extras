/**
 * Book art gate: does each book's art recipe (`scripts/importer/books/<id>/book-art.mjs`,
 * exported as `bookArt`) still name the picture it was boxed from, on the
 * Judge's own printing?
 *
 * The binding's lint is shapes and ids only; nothing offline opens the page, so
 * a box that drifted off its placement, a size that is no longer the picture's,
 * or a crop that reaches the purchaser stamp would pass every suite and fail
 * only at import. For every book that declares art and is local, it fails on:
 *   - a picture row whose box selects no placement, or more than one, on its
 *     page (within 2 pt on every edge);
 *   - a picture row whose selected picture decodes at another size;
 *   - a face whose entry is not a `kind.magicItem` of the committed cookbook;
 *   - a crop that is not inside its page or reaches below the stamp line;
 *   - a lookup key (side, pool, band, kind) held twice, in one book or across
 *     two, since lib's read takes the first book's row and hides the other;
 *   - anything else the binding's lint (`bookArtProblems`) refuses.
 *
 * Requires the LOCAL books, so it SKIPS (exit 0) where none that declares art
 * is present, CI included; a book that is absent is skipped alone. Output names
 * ordinals, pages and counts, never a word of the book.
 *
 * Usage: node tools/importer/check-book-art.mjs   (also via `npm run validate`)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openPinned } from "../../scripts/importer/ocr.mjs";
import { pageArtPlacements, pageObject } from "../../scripts/importer/extract.mjs";
import { BOOK_CODE } from "../../scripts/importer/books/index.mjs";
import { CROP_LIMITS, bookArtProblems, booksWithArt, cropProblems, isCropRow, lookupKey } from "../../scripts/importer/book-art-binding.mjs";
import { POOL, BAND_COUNT } from "../../scripts/treasure/constants.mjs";
import { FILES } from "./reference-lib.mjs";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** How far a placement's edge may sit from the recipe's box, in points. */
export const BOX_SLACK = 2;

/** The placements of `placements` within `slack` of `box` on every edge. Pure. */
export const placementsAt = (placements, box, slack = BOX_SLACK) =>
  placements.filter(
    (p) =>
      Math.abs(p.x - box.x) <= slack &&
      Math.abs(p.y - box.y) <= slack &&
      Math.abs(p.x + p.w - (box.x + box.w)) <= slack &&
      Math.abs(p.y + p.h - (box.y + box.h)) <= slack,
  );

/** A book's committed cookbook, or one with no entries. */
const cookbookOf = (id) => {
  const file = path.join(REPO, "cookbook", `${id}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { entries: {} };
};

/**
 * The gate over `rowsByBook` (`{<book>: rows}`), reading each book from
 * `docs` (`{<book>: pdf.js document opened by openPinned}`); a book with no
 * document has its lint and keys checked but no page read. Returns the faults
 * (ordinal-led messages) and the counts.
 *
 * @param {Record<string, object[]>} rowsByBook
 * @param {Record<string, object>} docs
 * @returns {Promise<{faults: string[], counts: {pictures: number, crops: number, faces: number, read: number}}>}
 */
export async function checkBookArt(rowsByBook, docs) {
  const faults = [];
  const counts = { pictures: 0, crops: 0, faces: 0, read: 0 };
  const keys = new Map();
  const pools = Object.values(POOL);
  for (const [book, rows] of Object.entries(rowsByBook)) {
    const cookbook = cookbookOf(book);
    for (const p of bookArtProblems(rows, { cookbook, pools, bandCount: BAND_COUNT })) faults.push(`${book} ${p}`);
    const doc = docs[book] ?? null;
    for (const row of rows) {
      const at = `${book} art${row.n} (PDF ${row.page})`;
      for (const use of row.uses ?? []) {
        const key = lookupKey(use);
        if (keys.has(key)) faults.push(`${at}: the same lookup key as ${keys.get(key)}`);
        else keys.set(key, `${book} art${row.n}`);
        if (use.side === "face") {
          counts.faces++;
          if (use.entry != null && cookbook.entries?.[use.entry]?.kind !== "kind.magicItem") faults.push(`${at}: the face's entry is not a kind.magicItem of the committed cookbook`);
        }
      }
      if (isCropRow(row)) counts.crops++;
      else counts.pictures++;
      if (!doc) continue;
      if (!(row.page >= 1 && row.page <= doc.numPages)) {
        faults.push(`${at}: the page is not in the book`);
        continue;
      }
      const page = await doc.getPage(row.page);
      counts.read++;
      if (isCropRow(row)) {
        const vp = page.getViewport({ scale: 1 });
        for (const p of cropProblems(row.crop, { pageW: vp.width, pageH: vp.height, stampLine: Math.min(CROP_LIMITS.stampLine, vp.height) })) faults.push(`${at}: ${p}`);
        continue;
      }
      const held = placementsAt(await pageArtPlacements(doc, row.page), row.box);
      if (held.length !== 1) {
        faults.push(`${at}: the box selects ${held.length} placements, not one`);
        continue;
      }
      const img = await pageObject(page, held[0].name, 10000);
      if (!img) faults.push(`${at}: the selected picture never arrived`);
      else if (img.width !== row.size?.w || img.height !== row.size?.h) faults.push(`${at}: the picture decodes at another size than the recipe's`);
    }
  }
  return { faults, counts };
}

async function main() {
  const books = booksWithArt(BOOK_CODE);
  const local = books.filter((id) => FILES[id] && fs.existsSync(FILES[id]));
  if (!local.length) {
    console.log("book art: SKIPPED — no book that declares art is on this machine.");
    return 0;
  }
  for (const id of books.filter((b) => !local.includes(b))) console.log(`book art: ${id} is not on this machine; its pages are skipped.`);
  const docs = {};
  for (const id of local) docs[id] = await openPinned(fs.readFileSync(FILES[id]));
  const rowsByBook = Object.fromEntries(books.map((id) => [id, BOOK_CODE[id].bookArt]));
  const { faults, counts } = await checkBookArt(rowsByBook, docs);
  for (const d of Object.values(docs)) await d.loadingTask.destroy();
  if (faults.length) {
    for (const f of faults) console.error(`FAIL book art: ${f}`);
    console.error(`book art: ${faults.length} fault(s)`);
    return 1;
  }
  console.log(`book art: ${books.length} book(s), ${counts.pictures} picture(s) and ${counts.crops} crop(s), ${counts.faces} face(s); ${counts.read} row(s) read off the page, all sound`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main());
