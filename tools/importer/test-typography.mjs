/**
 * A book's declared typography, applied in `pageItems`.
 *
 * A book set off the family's ladder declares in `BOOKS.<id>.typography` how
 * its text layer prints — body size, ligature code points, ligatures set as
 * runs of their own, a label's colon set with the value — and `pageItems`
 * applies the declaration to every page of a document tagged with it. The
 * cases below drive `pageItems` over an invented page: heights scale to the
 * ladder, glyphs come back as letters, touching ligature runs rejoin their
 * word and stop at a word space, a leading colon moves onto the label before
 * it and a bare colon run disappears, and an untagged document reads exactly
 * as before. The page text is invented; nothing here is a book's.
 *
 * Offline and Foundry-free; no reference library needed.
 *
 * Usage: node tools/importer/test-typography.mjs
 */
import assert from "node:assert/strict";
import { pageItems, useTypography } from "../../scripts/importer/extract.mjs";

let n = 0;
const t = async (name, fn) => {
  await fn();
  n++;
  console.log(`ok - ${name}`);
};

const HEIGHT = 792;
/** A text-layer item the way pdf.js hands one over, set on baseline `y` from the top. */
const run = (str, x, y, w, h = 12, font = "F1") => ({ str, transform: [h, 0, 0, h, x, HEIGHT - y], width: w, height: h, fontName: font });
/** pdf.js marks a word space as a blank item of its own. */
const space = () => ({ str: " ", transform: [0, 0, 0, 0, 0, 0], width: 0, height: 0 });
/** A one-page document over the given items; a fresh object per test, since the footer profile is cached per document. */
const docOf = (items) => ({
  numPages: 1,
  getPage: async () => ({ getViewport: () => ({ width: 612, height: HEIGHT }), getTextContent: async () => ({ items }) }),
});
const strs = (pd) => pd.items.map((i) => i.str);

const LIG = { "Ɵ": "ti", "Ʃ": "tt" };

await t("an untagged document reads as before: heights and strings untouched, runs apart", async () => {
  const pd = await pageItems(docOf([run("A", 36, 100, 7), run("Ʃ", 43, 100, 8), run("acks", 51, 100, 21), run(": 3", 72, 100, 15)]), 1);
  assert.deepEqual(strs(pd), ["A", "Ʃ", "acks", ": 3"]);
  assert.ok(pd.items.every((i) => i.h === 12));
  assert.equal(pd.typography, undefined);
});

await t("bodyPt scales heights onto the family's ladder; x and y stay in page points", async () => {
  const doc = docOf([run("body", 36, 100, 30, 12), run("Heading", 36, 60, 80, 16)]);
  doc.acksTypography = { bodyPt: 12 };
  const pd = await pageItems(doc, 1);
  const [body, head] = pd.items;
  assert.ok(Math.abs(body.h - 9.5) < 1e-9, `12pt body reads 9.5, got ${body.h}`);
  assert.ok(Math.abs(head.h - 16 * 9.5 / 12) < 1e-9);
  assert.equal(body.x, 36);
  assert.equal(body.y, 100);
  assert.deepEqual(pd.typography, { bodyPt: 12 });
});

await t("glyphs put a book's ligature code points back as letters inside a run", async () => {
  const doc = docOf([run("AcrobaƟcs", 36, 100, 50)]);
  doc.acksTypography = { glyphs: LIG };
  const pd = await pageItems(doc, 1);
  assert.deepEqual(strs(pd), ["Acrobatics"]);
});

await t("ligatureRuns rejoins a word set in three runs around its ligature", async () => {
  const doc = docOf([run("A", 36, 100, 7), run("Ʃ", 43, 100, 8), run("acks", 51, 100, 21), run(": 3", 72, 100, 15)]);
  doc.acksTypography = { glyphs: LIG, ligatureRuns: true };
  const pd = await pageItems(doc, 1);
  assert.deepEqual(strs(pd), ["Attacks", ": 3"]);
  const [word] = pd.items;
  assert.equal(word.x, 36);
  assert.ok(Math.abs(word.w - 36) < 1e-9, "the fused run spans its parts");
});

await t("a standard ligature run (fi) rejoins too, and a word space keeps a ligature from the run before it", async () => {
  const doc = docOf([
    run("Pro", 36, 100, 17), run("fi", 53, 100, 7), run("ciencies", 60, 100, 40),
    run("is the", 324, 100, 30), space(), run("fi", 357, 100, 6), run("rst", 363, 100, 15),
  ]);
  doc.acksTypography = { glyphs: LIG, ligatureRuns: true };
  const pd = await pageItems(doc, 1);
  assert.deepEqual(strs(pd), ["Proficiencies", "is the", "first"]);
  assert.equal(pd.items[2].sp, true, "the rejoined word keeps the space before it");
});

await t("labelColon moves a leading colon onto the touching label and drops a bare colon run", async () => {
  const doc = docOf([
    run("Type", 36, 100, 24), run(": Humanoid", 60, 100, 60),
    run("Supply Cost", 36, 120, 58), run(":", 94, 120, 3),
    run("Morale:", 36, 140, 40), run("0", 78, 140, 6),
  ]);
  doc.acksTypography = { labelColon: true };
  const pd = await pageItems(doc, 1);
  assert.deepEqual(strs(pd), ["Type:", " Humanoid", "Supply Cost:", "Morale:", "0"]);
  const value = pd.items[1];
  assert.ok(value.x > 60 && value.w < 60, "the value run gives up the colon's width");
});

await t("useTypography tags a declared book and leaves an undeclared one alone", async () => {
  const tagged = useTypography(docOf([]), "cat");
  assert.ok(tagged.acksTypography?.bodyPt > 0);
  const plain = useTypography(docOf([]), "rr");
  assert.equal(plain.acksTypography, undefined);
});

console.log(`test-typography: OK (${n} checks)`);
