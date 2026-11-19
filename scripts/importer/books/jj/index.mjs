/**
 * The Judges Journal's contribution to the importer: what the seam
 * (`books/index.mjs`) collects. `axBands` is the page-band row the compiler
 * reads the Journal's pages by (`bandsOf`); `bookArt` is the art recipe
 * the book-art step imports; `itemLabelsAtEnd` is a print fact
 * the census seed reads. A file here never imports another book's folder or
 * `table-recipes.mjs`.
 */
import { axBands } from "./page-bands.mjs";
import { BOOK_ART } from "./book-art.mjs";

export { axBands };

/** The art recipe (`book-art.mjs`): the pictures and page regions the book-art step imports. */
export const bookArt = BOOK_ART;

/**
 * The Journal prints an item entry's cost and value labels at the entry's end,
 * not on the line under its heading. The census seed (`tools/importer/census-rows.mjs`)
 * therefore marks an entry variant-led only where a label stands after other
 * words, and not for a heading line that holds none.
 */
export const itemLabelsAtEnd = true;
