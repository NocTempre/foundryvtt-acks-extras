/**
 * The compile half of the `ocr` op (`compile-picture.mjs`): what a picture row
 * and the rows reading it become, and every check the compiler makes against
 * the author's read. The read is handed in, so nothing here touches the local
 * shelf. The rows, the read and every word are invented: no PDF, no engine.
 */
import assert from "node:assert/strict";
import { OPS } from "../../vendor/pdfjs/pdf.mjs";
import { compilePictureRow, ocrEntry, ocrInstruction, pictureBlock, PICTURE_KIND } from "./compile-picture.mjs";

let n = 0;
const t = async (name, fn) => {
  await fn();
  n++;
  console.log(`ok - ${name}`);
};

const col = (x0, x1, y0, y1) => ({ x0, x1, y0, y1 });
const line = (text, x0, y0, x1, y1) => ({ bbox: { x0, y0, x1, y1 }, words: text.split(" ") });
/** A document whose page paints pictures of these sizes. */
const docOf = (...sizes) => ({
  getPage: async () => ({
    getOperatorList: async () => ({ fnArray: sizes.map(() => OPS.paintImageXObject), argsArray: sizes.map((_, i) => [`img${i}`]) }),
    objs: { get: (name, done) => done({ width: sizes[Number(name.slice(3))][0], height: sizes[Number(name.slice(3))][1], kind: 1 }) },
  }),
});

const pictureRow = (picture = {}) => ({
  id: "zz.picture7", kind: PICTURE_KIND, book: "zz", name: "Picture 7", pages: [7],
  picture: {
    size: { w: 400, h: 400 },
    read: [{ box: col(0, 400, 0, 400), psm: 3, note: "the whole picture" }],
    corrections: [{ box: 0, find: "teh", to: "the", hits: 1, pile: "a", note: "a misread article" }],
    ...picture,
  },
});
const placeRow = (ocr = {}) => ({
  id: "zz.place1", kind: "kind.location", book: "zz", name: "Place 1", pages: [7], meta: { group: "Scenario 1" },
  ocr: { name: { op: "heading", box: col(0, 400, 0, 25), number: "1" }, description: { op: "text", paras: [{ box: col(0, 400, 25, 50) }] }, ...ocr },
});
const READ = [{
  box: col(0, 400, 0, 400), psm: 3, origin: [0, 0], k: 2,
  lines: [line("1 Mossy Hall", 20, 20, 200, 40), line("A cold room by teh stair.", 20, 60, 300, 80)],
}];
const held = (reads = READ, samples = { width: 400, height: 400 }) => () => ({ reads, file: "shelf/p7.json", samples });

/** Compile `rows` (the picture row first) against a read; returns the output and the warnings. */
async function compile(rows, load, doc = docOf([400, 400])) {
  const out = { entries: {} };
  const warnings = [];
  const quiet = console.error;
  console.error = () => {};
  try {
    for (const row of rows) await compilePictureRow(doc, row, { list: rows, out, registers: { tables: {}, nodes: {} }, warn: (m) => warnings.push(m), load });
  } finally {
    console.error = quiet;
  }
  return { out, warnings };
}

await t("a picture row ships its recipe less every note, and an entry row one ocr instruction a field", async () => {
  const { out, warnings } = await compile([pictureRow(), placeRow()], held());
  assert.deepEqual(warnings, []);
  assert.deepEqual(out.pictures, { 7: { size: { w: 400, h: 400 }, read: [{ box: col(0, 400, 0, 400), psm: 3 }], corrections: [{ box: 0, find: "teh", to: "the", hits: 1, pile: "a" }] } });
  assert.deepEqual(out.pictures[7], pictureBlock(pictureRow()));
  assert.deepEqual(out.entries["zz.place1"], ocrEntry(placeRow()));
  assert.deepEqual(out.entries["zz.place1"].fields.name, { op: "ocr", page: 7, then: placeRow().ocr.name });
  assert.equal(out.entries["zz.place1"].cite, "zz p.7");
  assert.deepEqual(out.entries["zz.place1"].meta, { group: "Scenario 1" });
});

await t("a value's unread list rides on the op, not in its then", () => {
  assert.deepEqual(ocrInstruction(7, { op: "value", pattern: "statline", unread: ["ac"] }), { op: "ocr", page: 7, then: { op: "value", pattern: "statline" }, unread: ["ac"] });
});

await t("the recipe's size names exactly one painted picture, or the row is refused", async () => {
  const none = await compile([pictureRow()], held(), docOf([300, 300]));
  assert.match(none.warnings[0], /^zz\.picture7: p\.7 paints 0 pictures of 400x400 samples, not one/);
  assert.equal(none.out.pictures, undefined);
  const two = await compile([pictureRow()], held(), docOf([400, 400], [400, 400], [90, 90]));
  assert.match(two.warnings[0], /paints 2 pictures/);
});

await t("an entry on a page with no picture row is refused", async () => {
  const { out, warnings } = await compile([placeRow()], held());
  assert.match(warnings[0], /^zz\.place1: reads through p\.7, which has no kind\.picture row/);
  assert.deepEqual(out.entries, {});
});

await t("with no author's read the recipe ships unchecked and says so once, naming the path", async () => {
  const { out, warnings } = await compile([pictureRow(), placeRow()], () => ({ reads: null, file: "shelf/p7.json" }));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^zz\.picture7: no author's read at shelf\/p7\.json — recipe unchecked; run tools\/importer\/ocr-author-read\.mjs zz 7$/);
  assert.ok(out.pictures[7] && out.entries["zz.place1"]);
  const stale = await compile([pictureRow()], () => ({ reads: null, file: "shelf/p7.json", stale: "made at another picture size, scale or padding" }));
  assert.match(stale.warnings[0], /the author's read at shelf\/p7\.json is made at another picture size/);
});

await t("a read box outside the samples is reported by its index", async () => {
  const { warnings } = await compile([pictureRow(), placeRow()], held(READ, { width: 300, height: 400 }));
  assert.ok(warnings.includes("zz.picture7: read box 0 lies outside the 300x400 samples"), warnings.join("\n"));
});

await t("a correction whose hits moved, crosses a line or names an unread box is reported by its index", async () => {
  const off = await compile([pictureRow({ corrections: [{ box: 0, find: "teh", to: "the", hits: 2, pile: "a" }] }), placeRow()], held());
  assert.deepEqual(off.warnings, ["zz.picture7: correction 0 matches 1 time(s) on the author's read, expects 2"]);
  const across = await compile([pictureRow({ corrections: [{ box: 0, find: "Hall\\nA", to: "Hall\nA", hits: 1, pile: "a" }] }), placeRow()], held());
  assert.ok(across.warnings.includes("zz.picture7: correction 0 has 1 match(es) crossing a line break"), across.warnings.join("\n"));
  const stray = await compile([pictureRow({ corrections: [{ box: 3, find: "teh", to: "the", hits: 0, pile: "a" }] }), placeRow()], held());
  assert.ok(stray.warnings.includes("zz.picture7: correction 0 names box 3, which the recipe does not read"), stray.warnings.join("\n"));
});

await t("an entry replayed on the read owes its kind a name and a body, reported without a read word", async () => {
  const wrongKey = await compile([pictureRow(), placeRow({ name: { op: "heading", box: col(0, 400, 0, 25), number: "9" } })], held());
  assert.ok(wrongKey.warnings.some((w) => /^zz\.place1: replayed on the author's read, the name's check failed or read nothing$/.test(w)), wrongKey.warnings.join("\n"));
  const empty = await compile([pictureRow(), placeRow({ description: { op: "text", paras: [{ box: col(0, 400, 200, 250) }] } })], held());
  assert.ok(empty.warnings.includes("zz.place1: replayed on the author's read, the description read no words"), empty.warnings.join("\n"));
  for (const w of [...wrongKey.warnings, ...empty.warnings]) assert.doesNotMatch(w, /Mossy|cold room|stair/);
});

await t("lines no entry selects are reported by run index", async () => {
  const reads = [{ ...READ[0], lines: [...READ[0].lines, line("An orphan line.", 20, 300, 200, 320)] }];
  const { warnings } = await compile([pictureRow(), placeRow()], held(reads));
  assert.deepEqual(warnings, ["zz.picture7: 1 line(s) of the read are selected by no entry (runs 2)"]);
});

await t("a retired entry row is not replayed", async () => {
  const { warnings } = await compile([pictureRow(), { ...placeRow({ name: { op: "heading", box: col(0, 400, 0, 25), number: "9" } }), status: "retired" }], held());
  assert.ok(!warnings.some((w) => /replayed/.test(w)), warnings.join("\n"));
});

console.log(`\n${n} checks passed`);
