/**
 * The Treasure Tome's contribution to the importer: what the seam
 * (`books/index.mjs`) collects. `tableRecipes` is merged after the shared table
 * recipes; `magicItemLists` is the list map `magic-item-binding.mjs` places the
 * Tome's item-generation lists by; `axBands` is the page-band row the
 * compiler reads the Tome's pages by (`bandsOf`); `bookArt` is the art
 * recipe the book-art step imports. A file here never imports
 * another book's folder or `table-recipes.mjs`.
 */
import { tableRecipes } from "./table-recipes.mjs";
import { ALSO_KEYS, MAGIC_ITEM_LISTS } from "./magic-item-lists.mjs";
import { axBands } from "./page-bands.mjs";
import { BOOK_ART } from "./book-art.mjs";

export { tableRecipes, axBands };

/** The art recipe (`book-art.mjs`): the pictures and page regions the book-art step imports. */
export const bookArt = BOOK_ART;

/** The Tome's list map: `{lists, alsoKeys}`. */
export const magicItemLists = Object.freeze({ lists: MAGIC_ITEM_LISTS, alsoKeys: ALSO_KEYS });
