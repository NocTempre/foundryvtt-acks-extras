/**
 * Which picked file answers which book.
 *
 * Pure: no Foundry globals, no file reads, no I/O — everything here decides
 * pairings from names, sizes and the book registry alone, so the decision can
 * be exercised offline instead of only against four real PDFs.
 */
import { BOOKS } from "./books.mjs";

/**
 * A filename with its separators read as spaces, for testing a book's title
 * against it.
 *
 * The titles in BOOKS are the spaced, printed ones and stay that way — they are
 * the source of truth, and loosening every regex to tolerate every separator
 * would loosen what a match MEANS. A saved download, meanwhile, is as likely to
 * be `ACKS_II_Revised_Rulebook.pdf` or `acks-ii-revised-rulebook.pdf` as the
 * spaced form, so the candidate is normalized instead: underscores, hyphens and
 * dots become spaces and runs collapse.
 */
const spacedName = (name) => name.replace(/[_.-]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Work out which picked file answers which waiting book.
 *
 * A seat that must re-pick its books by hand is doing so because the browser
 * cannot reopen them — the insecure-origin and Firefox case, i.e. most remote
 * players. That seat can, however, pick SEVERAL files in one trip through the
 * dialog, and one trip is all a plain `<input multiple>` costs. What it cannot
 * do is tell us which file is which, so we work it out:
 *
 *   1. the exact name this seat used last time — the overwhelmingly common
 *      case, since a book that has been read once is remembered by name;
 *   2. the same byte size under a different name (a renamed or re-downloaded
 *      copy — DTRPG watermarks per customer, but not per download);
 *   3. the book's own title in the filename, which is how the stock DTRPG
 *      filenames read and the only rule that can match a book this seat has
 *      never opened. The candidate is normalized first (see `spacedName`) —
 *      the pattern is the printed title, and a real download rarely is.
 *
 * Passes run in that order over the whole set, so a confident match never
 * loses its file to a speculative one. Anything unmatched is reported rather
 * than guessed at — a book filled from the wrong PDF is far worse than a book
 * left closed.
 *
 * @param {{name: string, size: number}[]} files  the picked files
 * @param {string[]} pendingIds  book ids these files may fill
 * @param {Map<string, {name?: string, size?: number}>} records  remembered locations, bookId → record
 * @returns {{matched: Map<string, object>, unmatched: object[]}} pairings, and the files none of them claimed
 */
export function matchFilesToBooks(files, pendingIds, records) {
  const matched = new Map();
  const used = new Set();
  const tests = [
    (bookId, file) => {
      const name = records.get(bookId)?.name;
      return !!name && name.toLowerCase() === file.name.toLowerCase();
    },
    (bookId, file) => {
      const size = records.get(bookId)?.size;
      return Number.isFinite(size) && size > 0 && size === file.size;
    },
    (bookId, file) => BOOKS[bookId]?.titleRe?.test(spacedName(file.name)) ?? false,
  ];
  for (const test of tests) {
    for (const bookId of pendingIds) {
      if (matched.has(bookId)) continue;
      const index = files.findIndex((file, i) => !used.has(i) && test(bookId, file));
      if (index < 0) continue;
      matched.set(bookId, files[index]);
      used.add(index);
    }
  }
  return { matched, unmatched: files.filter((_, i) => !used.has(i)) };
}
