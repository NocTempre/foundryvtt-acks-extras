/**
 * The Treasure Tome's art recipe, exported as `bookArt` by this folder's
 * `index.mjs` and read by `book-art-binding.mjs`: the pictures an import cuts
 * from the Judge's own copy for treasure cards, and the page regions it renders
 * as their textures. Shapes in `book-art-binding.mjs`.
 *
 * A picture row's `n` is its ordinal in the picture census
 * (`tools/importer/census-art.mjs`): its box selects the placement and its
 * size verifies it, and nothing printed is named. The backs are the item and
 * special pools'; each face is keyed by the cookbook id of the entry it shows,
 * paired by a reviewer looking at the picture and its page. A crop row names a
 * page region, numbered from 1001, outside the census; every region stays
 * above the purchaser stamp at the page foot.
 */
export const BOOK_ART = Object.freeze([
  { n: 14, page: 27, box: { x: 329, y: 72.2, w: 237.5, h: 171.5 }, size: { w: 495, h: 358 }, uses: [{ side: "back", pool: "special" }] },
  { n: 15, page: 29, box: { x: 328, y: 316.5, w: 239.6, h: 209 }, size: { w: 500, h: 436 }, uses: [{ side: "back", pool: "item" }] },
  { n: 46, page: 61, box: { x: 328.5, y: 244.9, w: 238.5, h: 142.3 }, size: { w: 497, h: 297 }, uses: [{ side: "face", pool: "magic", entry: "tt.item9" }] },
  { n: 47, page: 63, box: { x: 71.2, y: 546.5, w: 240, h: 191 }, size: { w: 500, h: 398 }, uses: [{ side: "face", pool: "magic", entry: "tt.item19" }] },
  { n: 48, page: 64, box: { x: 301.5, y: 384.9, w: 238.5, h: 142.3 }, size: { w: 497, h: 297 }, uses: [{ side: "face", pool: "magic", entry: "tt.item29" }] },
  { n: 49, page: 69, box: { x: 327.8, y: 415, w: 239.8, h: 201 }, size: { w: 500, h: 419 }, uses: [{ side: "face", pool: "magic", entry: "tt.item68" }] },
  { n: 50, page: 73, box: { x: 72, y: 406, w: 238.6, h: 183.8 }, size: { w: 498, h: 383 }, uses: [{ side: "face", pool: "magic", entry: "tt.item92" }] },
  { n: 51, page: 75, box: { x: 72.5, y: 71.4, w: 494, h: 533.3 }, size: { w: 1030, h: 1112 }, uses: [{ side: "face", pool: "magic", entry: "tt.item106" }] },
  { n: 52, page: 76, box: { x: 301.5, y: 216, w: 238.5, h: 161.2 }, size: { w: 497, h: 336 }, uses: [{ side: "face", pool: "magic", entry: "tt.item109" }] },
  { n: 53, page: 76, box: { x: 301.5, y: 556, w: 238.5, h: 164.1 }, size: { w: 497, h: 342 }, uses: [{ side: "face", pool: "magic", entry: "tt.item110" }] },
  { n: 54, page: 78, box: { x: 300.8, y: 606.5, w: 239.9, h: 131 }, size: { w: 500, h: 273 }, uses: [{ side: "face", pool: "magic", entry: "tt.item121" }] },
  { n: 55, page: 82, box: { x: 301, y: 435, w: 239.5, h: 181 }, size: { w: 500, h: 378 }, uses: [{ side: "face", pool: "magic", entry: "tt.item146" }] },
  { n: 56, page: 86, box: { x: 44.6, y: 235, w: 239.3, h: 221 }, size: { w: 499, h: 461 }, uses: [{ side: "face", pool: "magic", entry: "tt.item170" }] },
  { n: 57, page: 89, box: { x: 328.5, y: 196, w: 238.5, h: 165.6 }, size: { w: 497, h: 345 }, uses: [{ side: "face", pool: "magic", entry: "tt.item190" }] },
  { n: 58, page: 89, box: { x: 71.4, y: 416, w: 239.8, h: 131 }, size: { w: 500, h: 273 }, uses: [{ side: "face", pool: "magic", entry: "tt.item189" }] },
  { n: 59, page: 90, box: { x: 45, y: 276, w: 238.5, h: 164.4 }, size: { w: 497, h: 343 }, uses: [{ side: "face", pool: "magic", entry: "tt.item193" }] },
  { n: 60, page: 91, box: { x: 328, y: 626.5, w: 239.5, h: 111 }, size: { w: 499, h: 232 }, uses: [{ side: "face", pool: "magic", entry: "tt.item202" }] },
  { n: 1001, page: 346, crop: { x0: 56, y0: 58, x1: 606, y1: 776 }, uses: [{ side: "texture", kind: "grime" }] },
  { n: 1002, page: 1, crop: { x0: 48, y0: 722, x1: 214, y1: 774 }, uses: [{ side: "texture", kind: "foil" }] },
]);
