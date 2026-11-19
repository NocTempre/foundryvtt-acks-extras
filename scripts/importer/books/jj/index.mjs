/**
 * The Judges Journal's contribution to the importer: what the seam
 * (`books/index.mjs`) collects. `axBands` is the page-band row the compiler
 * reads the Journal's pages by (`bandsOf`); `itemLabelsAtEnd` is a print fact
 * the census seed reads. A file here never imports another book's folder or
 * `table-recipes.mjs`.
 */
import { axBands } from "./page-bands.mjs";

export { axBands };

/**
 * The Journal prints an item entry's cost and value labels at the entry's end,
 * not on the line under its heading. The census seed (`tools/importer/census-rows.mjs`)
 * therefore marks an entry variant-led only where a label stands after other
 * words, and not for a heading line that holds none.
 */
export const itemLabelsAtEnd = true;
