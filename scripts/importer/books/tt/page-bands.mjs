/**
 * The Treasure Tome's AX page bands, read by the compiler through the seam
 * (`bandsOf`). Page geometry measured on the entry chapter's printing, in
 * points, never a value off a page.
 *
 * `topBand` sits below the running head and above the first body line, so a
 * heading near the top of a column is not taken for furniture. `footY` sits
 * below the last body line and above the folio. `headX0` is the left margin a
 * heading may hang to. `headMinH` is the smallest run height that anchors a
 * heading: the entry headings are set in body-size type, so the default
 * heading size would find none. `columns` is the column grid of the book's
 * even and odd pages, which sit mirrored across a spread. `stopFace` is
 * `"anchor"`: the book sets lore, quotations and tables at its headings' size
 * in other faces, so a line no larger than body type ends an entry's flow only
 * where it is set in the entry's own heading face (`axStopLine`).
 *
 * The bands apply to every page of the book the compiler reads and are
 * measured for the entry chapter only; a later kind outside it re-measures.
 */
export const axBands = Object.freeze({
  topBand: 50,
  footY: 765,
  headX0: 20,
  headMinH: 9.5,
  stopFace: "anchor",
  columns: Object.freeze({ even: Object.freeze([45, 302]), odd: Object.freeze([72, 329]) }),
});
