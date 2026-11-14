/**
 * Which picked file answers which book.
 *
 * Pure: no Foundry globals, no file reads, no I/O; pairings are decided from
 * names, sizes and the book registry alone.
 */
import { BOOKS } from "./books.mjs";

/**
 * A filename with its separators read as spaces, for testing a book's title
 * against it: underscores, hyphens and dots become spaces and runs collapse.
 * The candidate is normalized so the titles in BOOKS stay the spaced, printed
 * ones.
 */
const spacedName = (name) => name.replace(/[_.-]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Work out which picked file answers which waiting book.
 *
 * A seat that re-picks its books by hand picks several files in one trip, and
 * the pass works out which file is which:
 *
 *   1. the exact name this seat used last time;
 *   2. the same byte size under a different name (a renamed or re-downloaded
 *      copy);
 *   3. the book's own title in the filename, normalized first (`spacedName`);
 *      the only rule that can match a book this seat has never opened.
 *
 * Passes run in that order over the whole set, so a confident match never
 * loses its file to a speculative one. Anything unmatched is reported, never
 * guessed at.
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
