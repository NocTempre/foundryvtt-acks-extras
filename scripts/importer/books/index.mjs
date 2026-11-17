/**
 * The seam for an ACKS book's own importer code: the one file that names the
 * `books/<id>/` folders.
 *
 * A book's print facts (a page, a locate phrase, coordinates, a branch on its
 * id) live in `books/<id>/`, and its `index.mjs` exports what it contributes:
 * today `tableRecipes`, `{docId: {pages?, tables}}`, which
 * `table-recipes.mjs` merges after each doc's shared tables
 * (`mergeBookTableRecipes`). A book is added by a static import below and a line
 * in `BOOK_CODE`; the gate (`tools/importer/check-silos.mjs`, `book-manifest`)
 * requires the imports and the folders to agree and each id to be in the
 * registry. A book's files never import another book's, nor `table-recipes.mjs`
 * (it imports this file). `BOOK_CODE`'s order is the merge order.
 *
 * No book has a folder yet; landed code waits in the shared files for the
 * owner's cleanup (docs/importer/DECISIONS.md, "An ACKS book's importer code
 * lives in its own folder, and the silo gate counts what is left").
 */

/**
 * Each book's contribution by book id, in merge order: `{<id>: {tableRecipes}}`.
 */
export const BOOK_CODE = Object.freeze({});
