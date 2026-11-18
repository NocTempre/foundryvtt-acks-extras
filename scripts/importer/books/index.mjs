/**
 * The seam for an ACKS book's own importer code: the one file that names the
 * `books/<id>/` folders.
 *
 * A book's print facts (a page, a locate phrase, coordinates, a branch on its
 * id) live in `books/<id>/`, and its `index.mjs` exports what it contributes:
 * `tableRecipes`, `{docId: {pages?, tables}}`, which `table-recipes.mjs` merges
 * after each doc's shared tables (`mergeBookTableRecipes`), and
 * `magicItemLists`, the list map `magic-item-binding.mjs` places a book's
 * item-generation lists by, and `axBands`, the book's AX page-band row, which
 * the compiler reads through `bandsOf` (`AX_BOOK_BANDS` keeps only the rows
 * that landed before a book had a folder). A book is added by a static import below and a line
 * in `BOOK_CODE`; the gate (`tools/importer/check-silos.mjs`, `book-manifest`)
 * requires the imports and the folders to agree and each id to be in the
 * registry. A book's files never import another book's, nor `table-recipes.mjs`
 * (it imports this file). `BOOK_CODE`'s order is the merge order.
 *
 * Landed code for the other books waits in the shared files for the owner's
 * cleanup (docs/importer/DECISIONS.md, "An ACKS book's importer code lives in
 * its own folder, and the silo gate counts what is left").
 */
import * as tt from "./tt/index.mjs";

/**
 * Each book's contribution by book id, in merge order:
 * `{<id>: {tableRecipes?, magicItemLists?, axBands?}}`.
 */
export const BOOK_CODE = Object.freeze({ tt });
