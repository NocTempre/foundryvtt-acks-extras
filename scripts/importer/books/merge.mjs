/**
 * Merges each ACKS book's table recipes into the shared ones, one table at a
 * time. Pure, so a test drives it with invented books.
 *
 * `shared` is `{docId: {source, tables}}`; each book contributes
 * `{docId: {pages?, tables}}`. A doc keeps its shared tables first and takes
 * each book's after them, books in the order given (the manifest's), because
 * `cookbook/rebuild.mjs` reads a doc's book from the first table that carries
 * one. Every merged table is stamped with its book's id as `book`.
 *
 * A table id defined twice, in the shared recipes or by two books, throws and
 * names both places. A book table that already carries a different `book` throws
 * too: a book's folder holds that book's tables. A book's `pages` joins the
 * doc's `source.pages` with `"; "`, in the same `"<SHORT> <folios>"` form. A doc
 * only a book defines is created, its `source.book` the registry's label.
 */
import { REGISTRY } from "../books.mjs";

/**
 * @param {Record<string, {source?: object, tables: object}>} shared the doc's shared recipes
 * @param {Record<string, {tableRecipes?: Record<string, {pages?: string, tables?: object}>}>} books
 *   each book's contribution, keyed by book id, in manifest order
 * @param {Record<string, {label?: string}>} [registry] book labels, for a doc only a book defines
 * @returns {Record<string, {source?: object, tables: object}>} a new object; a doc no book touches is the shared one
 */
export function mergeBookTableRecipes(shared, books, registry = REGISTRY) {
  const merged = { ...shared };
  const placed = new Map();
  for (const [docId, rec] of Object.entries(shared)) {
    for (const tableId of Object.keys(rec.tables ?? {})) placed.set(`${docId}\0${tableId}`, "the shared recipes (table-recipes.mjs)");
  }
  for (const [bookId, contribution] of Object.entries(books)) {
    for (const [docId, add] of Object.entries(contribution?.tableRecipes ?? {})) {
      const held = merged[docId];
      const tables = { ...(held?.tables ?? {}) };
      for (const [tableId, table] of Object.entries(add.tables ?? {})) {
        const there = placed.get(`${docId}\0${tableId}`);
        const here = `books/${bookId}/index.mjs`;
        if (there) throw new Error(`table "${tableId}" of document "${docId}" is defined twice: in ${there} and in ${here}`);
        if (table.book !== undefined && table.book !== bookId) throw new Error(`table "${tableId}" of document "${docId}" in ${here} names book "${table.book}"; a book's folder holds that book's tables`);
        placed.set(`${docId}\0${tableId}`, here);
        tables[tableId] = { ...table, book: bookId };
      }
      const pages = [held?.source?.pages, add.pages].filter(Boolean).join("; ");
      const source = held?.source ?? { book: registry[bookId]?.label ?? bookId };
      merged[docId] = { ...held, source: pages ? { ...source, pages } : source, tables };
    }
  }
  return merged;
}
