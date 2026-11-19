/**
 * The Judges Journal's art recipe: the page regions an import renders as
 * treasure-card textures, exported as `bookArt` by this folder's `index.mjs`
 * and read by `book-art-binding.mjs`. A crop row names the PDF page and the
 * region in top-origin page points, never the image; its ordinal lies outside
 * the picture census, so crops are numbered from 1001. Every region stays above
 * the purchaser stamp at the page foot. Shapes in `book-art-binding.mjs`.
 */
export const BOOK_ART = Object.freeze([
  { n: 1001, page: 450, crop: { x0: 0, y0: 54, x1: 66, y1: 612 }, uses: [{ side: "texture", kind: "foil", band: 3 }] },
  { n: 1002, page: 1, crop: { x0: 60, y0: 68, x1: 236, y1: 94 }, uses: [{ side: "texture", kind: "foil-magic" }] },
]);
