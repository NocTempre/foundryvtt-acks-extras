/**
 * The Judges Journal's AX page bands, read by the compiler through the seam
 * (`bandsOf`). Only `headMinH` is declared: the item chapter's headings are set
 * in body-size type, so the default heading size would anchor none of them.
 *
 * `headMinH` is the smallest run height that anchors a heading. This one value
 * is measured to leave every entry the Journal's other kinds compile unchanged
 * while anchoring each item heading; the Tome's wider row (margins, columns,
 * stop face) is never applied here.
 */
export const axBands = Object.freeze({ headMinH: 9.5 });
