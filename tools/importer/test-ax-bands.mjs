/**
 * Where a book's AX page bands come from (`bandsOf`, `compile-cookbook.mjs`):
 * the `AX_BOOK_BANDS` rows that landed before a book had a folder, or the
 * `axBands` its folder contributes through the manifest, and never both.
 * The contribution map here is invented, so no book folder is read.
 *
 * Usage: node tools/importer/test-ax-bands.mjs
 */
import assert from "node:assert/strict";
import { bandsOf, useAxBands } from "./compile-cookbook.mjs";

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};

const MINE = Object.freeze({ topBand: 50, headMinH: 9.5, stopFace: "anchor" });

t("a book's contributed axBands is read", () => {
  assert.equal(bandsOf("zz", { zz: { axBands: MINE } }), MINE);
});

t("a book with none, and one with no contribution at all, has none", () => {
  assert.equal(bandsOf("zz", { zz: {} }), undefined);
  assert.equal(bandsOf("zz", {}), undefined);
});

t("a landed table row wins alone", () => {
  const landed = bandsOf("ax1", {});
  assert.equal(landed.headMinH, 13, "the table's own row");
  assert.equal(bandsOf("ax1", { zz: { axBands: MINE } }), landed, "another book's folder changes nothing");
});

t("a book declaring bands in the table and in its folder throws", () => {
  assert.throws(() => bandsOf("ax1", { ax1: { axBands: MINE } }), /declared in AX_BOOK_BANDS and in the book's folder/);
});

t("an unknown stopFace throws, whichever home it is declared in", () => {
  assert.throws(() => bandsOf("zz", { zz: { axBands: { stopFace: "size" } } }), /unknown stopFace/);
});

t("a book's bands are put on its opened document, and only where it has some", () => {
  const doc = {};
  assert.equal(useAxBands(doc, "ax1"), doc);
  assert.equal(doc.axBands.headMinH, 13);
  const bare = useAxBands({}, "zz");
  assert.equal(bare.axBands, undefined);
});

console.log(`\nax-bands: ${n} checks OK`);
