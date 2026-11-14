/**
 * The `ocr` op (`scripts/importer/picture-text.mjs`): the corrected lines and
 * the runs made of them, each `then` op run over them through the executor,
 * `unread`, and the per-document read cache. The recipe, the reads and every
 * word are invented: no PDF, no engine, no Foundry.
 */
import assert from "node:assert/strict";
import { OPS } from "../../vendor/pdfjs/pdf.mjs";
import { executeEntry } from "../../scripts/importer/executor.mjs";
import { printKey } from "../../scripts/importer/printed-name.mjs";
import { SCALE, BOX_PAD, sampleBox, pictureRuns, seedPictureRead, pictureReadFor, readBoxReads, pictureScaled, closePictureReads } from "../../scripts/importer/picture-text.mjs";

let n = 0;
const t = async (name, fn) => {
  await fn();
  n++;
  console.log(`ok - ${name}`);
};

/** A line of an invented read: its words and its box in the crop's pixels. */
const line = (text, x0, y0, x1, y1) => ({ bbox: { x0, y0, x1, y1 }, words: text.split(" ") });
/** A box's invented read at the crop's origin. */
const boxRead = (lines, { origin = [0, 0], k = 2, box = { x0: 0, x1: 400, y0: 0, y1: 400 }, psm = 3 } = {}) => ({ box, psm, origin, k, lines });
const REGISTERS = { tables: {}, nodes: {} };
const bookOf = (pictures, entries) => ({ schema: "acks-cookbook/2", entries, pictures });
const entryOf = (fields) => ({ kind: "kind.location", name: "Place 1", cite: "T p.1", pages: [7], fields });
/** Run entry `e` over an invented read through the shipping executor. */
async function run(picture, reads, fields, opts = {}) {
  const doc = {};
  if (reads) seedPictureRead(doc, 7, picture, reads);
  return executeEntry(doc, bookOf({ 7: picture }, { e: entryOf(fields) }), REGISTERS, "e", opts);
}
const P = (corrections = [], read = [{ box: { x0: 0, x1: 400, y0: 0, y1: 400 }, psm: 3 }]) => ({ size: { w: 400, h: 400 }, read, corrections });

/* ---------------------------------------------------------------- the runs */

await t("a line becomes a run at its left edge and vertical centre, in source samples", () => {
  const { runs } = pictureRuns([boxRead([line("alpha beta", 20, 40, 220, 60)], { origin: [8, 16] })], P());
  assert.deepEqual(runs, [{ str: "alpha beta ", x: (8 + 20) / 2, y: (16 + 50) / 2, w: 100, h: 10 }]);
});

await t("boxes follow one another in the recipe's order, and a box that read nothing gives no run", () => {
  const reads = [boxRead([line("one", 0, 0, 20, 10)]), boxRead([]), boxRead([line("two", 0, 100, 20, 110)])];
  const { runs, boxText } = pictureRuns(reads, P());
  assert.deepEqual(runs.map((r) => r.str), ["one ", "two "]);
  assert.deepEqual(boxText, ["one", "", "two"]);
});

await t("a line's text is its words joined by single spaces, whatever the engine's own line text", () => {
  const { boxText } = pictureRuns([boxRead([{ ...line("a b c", 0, 0, 30, 10), text: "a   b   c" }])], P());
  assert.deepEqual(boxText, ["a b c"]);
});

await t("the sample box is the recipe's box padded on every side", () => {
  assert.deepEqual(sampleBox({ x0: 10, x1: 50, y0: 20, y1: 30 }), [10 - BOX_PAD, 20 - BOX_PAD, 40 + 2 * BOX_PAD, 10 + 2 * BOX_PAD]);
  assert.equal(SCALE, 2);
});

/* ------------------------------------------------------------ corrections */

await t("corrections run in list order, each on the previous one's output", () => {
  const p = P([
    { box: 0, find: "teh", to: "the", hits: 1, pile: "a" },
    { box: 0, find: "the (\\w+)", to: "<$1>", hits: 1, pile: "a" },
  ]);
  const { boxText, hits } = pictureRuns([boxRead([line("see teh moat", 0, 0, 90, 10)])], p);
  assert.deepEqual(boxText, ["see <moat>"]);
  assert.deepEqual(hits, [1, 1]);
});

await t("a correction only touches its own box", () => {
  const p = P([{ box: 1, find: "foo", to: "bar", hits: 1, pile: "a" }], [{ box: { x0: 0, x1: 9, y0: 0, y1: 9 }, psm: 3 }, { box: { x0: 0, x1: 9, y0: 9, y1: 19 }, psm: 6 }]);
  const { boxText } = pictureRuns([boxRead([line("foo", 0, 0, 9, 9)]), boxRead([line("foo", 0, 0, 9, 9)])], p);
  assert.deepEqual(boxText, ["foo", "bar"]);
});

await t("hits counts every match with g forced, and a correction without g still replaces one", () => {
  const p = P([
    { box: 0, find: "x", flags: "g", to: "y", hits: 3, pile: "a" },
    { box: 0, find: "y", to: "z", hits: 3, pile: "a" },
  ]);
  const { boxText, hits } = pictureRuns([boxRead([line("x x x", 0, 0, 50, 10)])], p);
  assert.deepEqual(hits, [3, 3]);
  assert.deepEqual(boxText, ["z y y"]);
});

await t("a match that crosses a line break is counted as one that spans", () => {
  const p = P([{ box: 0, find: "one\\ntwo", to: "one two", hits: 1, pile: "a" }]);
  const { spans, runs } = pictureRuns([boxRead([line("one", 0, 0, 30, 10), line("two", 0, 20, 30, 30)])], p);
  assert.deepEqual(spans, [1]);
  assert.equal(runs.length, 1);
});

await t("a line past the raw count keeps the last raw line's box", () => {
  const p = P([{ box: 0, find: "\\n", to: "$&$&", hits: 1, pile: "a" }]);
  const { runs } = pictureRuns([boxRead([line("up", 0, 0, 20, 10), line("down", 0, 40, 40, 50)])], p);
  assert.deepEqual(runs.map((r) => [r.str, r.y]), [["up ", 2.5], [" ", 22.5], ["down ", 22.5]]);
});

await t("flags and backreferences apply as JS replace does", () => {
  const p = P([{ box: 0, find: "(d)(\\d)", flags: "gi", to: "$2$1 ($&)", hits: 2, pile: "a" }]);
  assert.deepEqual(pictureRuns([boxRead([line("D4 and d6", 0, 0, 90, 10)])], p).boxText, ["4D (D4) and 6d (d6)"]);
});

/* -------------------------------------------------- each `then` over runs */

const col = (x0, x1, y0, y1) => ({ x0, x1, y0, y1 });
const READ = boxRead([
  line("3 Mossy Hall", 20, 20, 200, 40),
  line("A cold room, with a teh", 20, 60, 260, 80),
  line("low door.", 20, 80, 120, 100),
]);

await t("heading by key number proves the box and hands back its words", async () => {
  const res = await run(P(), [READ], { name: { op: "ocr", page: 7, then: { op: "heading", box: col(0, 200, 0, 20), number: "3" } } });
  assert.equal(res.fields.name.ok, true);
  assert.equal(res.fields.name.title, "3 Mossy Hall");
});

await t("heading by hash, and a wrong hash fails the entry", async () => {
  const body = (hash) => ({ name: { op: "ocr", page: 7, then: { op: "heading", box: col(0, 200, 0, 20), hash } } });
  assert.equal((await run(P(), [READ], body(printKey("3 Mossy Hall")))).ok, true);
  const bad = await run(P(), [READ], body(printKey("other")));
  assert.equal(bad.ok, false);
  assert.equal(bad.fields.name.title, null);
});

await t("text runs paragraph assembly over the corrected lines", async () => {
  const p = P([{ box: 0, find: "a teh", to: "a bare", hits: 1, pile: "a" }]);
  const res = await run(p, [READ], { description: { op: "ocr", page: 7, then: { op: "text", paras: [{ box: col(0, 400, 25, 60) }] } } });
  assert.deepEqual(res.fields.description, [{ type: "paragraph", text: "A cold room, with a bare low door." }]);
});

await t("a glyph correction writes the damage mark's key where the icon was misread", async () => {
  const p = P([{ box: 0, find: "(\\dd\\d) ?[0O@]", flags: "g", to: "$1 fire", hits: 1, pile: "a", glyph: "fire" }]);
  const res = await run(p, [boxRead([line("deals 1d6 @ damage", 0, 0, 180, 10)])], { description: { op: "ocr", page: 7, then: { op: "text", paras: [{ box: col(0, 400, 0, 20) }] } } });
  assert.equal(res.fields.description[0].text, "deals 1d6 fire damage");
});

await t("value reads a pattern over the lines", async () => {
  const stat = boxRead([line("MV 90’, AC 4, HD 2, hp 9, #AT 1 (club), Dmg 1d6, Save F2, ML 0, AL N, XP 20", 0, 0, 800, 10)]);
  const res = await run(P(), [stat], { "occupants.0.stats": { op: "ocr", page: 7, then: { op: "value", pattern: "statline", box: col(0, 400, 0, 20) } } });
  assert.equal(res.fields.occupants["0.stats"].ac, 4);
  assert.equal(res.fields.occupants["0.stats"].dmg, "1d6");
});

await t("unread deletes the paths after the parse, records each as a miss with no error, and echoes them", async () => {
  const stat = boxRead([line("MV 90’, AC 4, HD 2, hp 9, #AT 1 (club), Dmg 1d6, Save F2, ML 0, AL N, XP 20", 0, 0, 800, 10)]);
  const res = await run(P(), [stat], { statline: { op: "ocr", page: 7, unread: ["ac", "dmg"], then: { op: "value", pattern: "statline", box: col(0, 400, 0, 20) } } });
  assert.equal(res.fields.statline.ac, undefined);
  assert.equal(res.fields.statline.dmg, undefined);
  assert.equal(res.fields.statline.hp, 9);
  assert.deepEqual(res.fields.statline.unread, ["ac", "dmg"]);
  assert.deepEqual(res.misses, [{ field: "statline", unread: "ac" }, { field: "statline", unread: "dmg" }]);
  assert.ok(res.misses.every((m) => !("error" in m)));
});

await t("grid reads columns of a table's corrected lines", async () => {
  const cells = boxRead([line("row1 12", 0, 0, 100, 10), line("row2 34", 0, 20, 100, 30)]);
  // Run x is the line's left edge in source samples, so a column span is x0 0..4 and the line's one run holds both cells; the span test is on that origin point.
  const res = await run(P(), [cells], { grids: { op: "ocr", page: 7, then: { op: "grid", box: col(0, 400, 0, 40), label: { x0: 0, x1: 4 }, cols: [{ key: "v", x0: 0, x1: 4, pattern: "raw" }] } } });
  assert.equal(res.fields.grids.rows.length, 2);
  assert.deepEqual(res.fields.grids.rows.map((r) => r.label), ["row1 12", "row2 34"]);
});

await t("a recipe-less page is a miss of the field, and skipOps leaves an ocr field alone", async () => {
  const doc = {};
  const fields = { description: { op: "ocr", page: 7, then: { op: "text", paras: [{ box: col(0, 9, 0, 9) }] } } };
  const res = await executeEntry(doc, bookOf({}, { e: entryOf(fields) }), REGISTERS, "e");
  assert.match(res.misses[0].error, /no picture recipe for p\.7/);
  const skipped = await executeEntry(doc, bookOf({}, { e: entryOf(fields) }), REGISTERS, "e", { skipOps: ["ocr"] });
  assert.deepEqual(skipped.misses, []);
  assert.equal(skipped.fields.description, undefined);
});

/* ------------------------------------------------------ the two-box row */

await t("a label and its body read as two boxes keep their own text when the boxes land a few pixels apart", async () => {
  // One printed row: the label box's line sits 3 source samples below the body box's, a gap orderRuns' 2-unit tolerance reads as two lines.
  const reads = [
    boxRead([line("Lab1", 0, 100, 40, 120), line("Lab2", 0, 200, 40, 220)], { box: col(0, 20, 40, 120), psm: 7 }),
    boxRead([line("body of the first", 100, 94, 400, 114), line("body of the second", 100, 194, 400, 214)], { box: col(50, 200, 40, 120), psm: 6 }),
  ];
  const labelBox = (y0, y1) => col(0, 40, y0, y1);
  const bodyBox = (y0, y1) => col(50, 400, y0, y1);
  const paired = {
    labels: { op: "ocr", page: 7, then: { op: "text", paras: [{ box: labelBox(40, 70), section: "r1" }, { box: labelBox(90, 120), section: "r2" }] } },
    rows: { op: "ocr", page: 7, then: { op: "text", paras: [{ box: bodyBox(40, 70), section: "r1" }, { box: bodyBox(90, 120), section: "r2" }] } },
  };
  const res = await run(P([], reads.map((r) => ({ box: r.box, psm: r.psm }))), reads, paired);
  assert.deepEqual(res.fields.labels.map((p) => [p.section, p.text]), [["r1", "Lab1"], ["r2", "Lab2"]]);
  assert.deepEqual(res.fields.rows.map((p) => [p.section, p.text]), [["r1", "body of the first"], ["r2", "body of the second"]]);
  // The control: one box over label and body reads the body first (it is higher), so no recipe uses one.
  const one = await run(P([], reads.map((r) => ({ box: r.box, psm: r.psm }))), reads, { description: { op: "ocr", page: 7, then: { op: "text", paras: [{ box: col(0, 400, 40, 70) }] } } });
  assert.equal(one.fields.description[0].text, "body of the first Lab1");
});

/* ----------------------------------------------------------- the cache */

await t("a seeded page is read once per document and starts no engine", async () => {
  const doc = {};
  const p = P();
  seedPictureRead(doc, 7, p, [READ]);
  const first = pictureReadFor(doc, 7, p);
  assert.equal(first, pictureReadFor(doc, 7, p));
  assert.equal((await first).runs.length, 3);
  await closePictureReads();
});

await t("a read that fails is not cached, so the next ask reads again", async () => {
  let opened = 0;
  const doc = { getData: async () => { opened++; throw new Error("no bytes"); } };
  const p = P();
  await assert.rejects(pictureReadFor(doc, 7, p), /no bytes/);
  await new Promise((r) => setImmediate(r));
  await assert.rejects(pictureReadFor(doc, 7, p), /no bytes/);
  assert.equal(opened, 2);
  await closePictureReads();
});

await t("the boxes are cut padded, at the recipe's mode, from one scaled picture", async () => {
  const calls = [];
  const reader = { readBox: async (scaled, box, { psm }) => (calls.push([scaled.k, box, psm]), { origin: [0, 0], lines: [{ bbox: { x0: 0, y0: 0, x1: 1, y1: 1 }, words: [{ text: "w" }] }] }) };
  const p = P([], [{ box: col(10, 50, 20, 30), psm: 6 }, { box: col(0, 9, 0, 9), psm: 7 }]);
  const reads = await readBoxReads(reader, { k: 2 }, p);
  assert.deepEqual(calls, [[2, sampleBox(col(10, 50, 20, 30)), 6], [2, sampleBox(col(0, 9, 0, 9)), 7]]);
  assert.deepEqual(reads[0].lines, [{ bbox: { x0: 0, y0: 0, x1: 1, y1: 1 }, words: ["w"] }]);
});

await t("the picture is taken by its sample size, whatever name pdf.js gave it, and a page with none or two says so", async () => {
  const img = { width: 2, height: 1, kind: 2, data: Uint8Array.of(0, 0, 0, 255, 255, 255) };
  const frame = { width: 5, height: 5, kind: 2, data: new Uint8Array(75) };
  /** A page painting the named objects, in order. */
  const page = (objs) => ({
    getOperatorList: async () => ({ fnArray: Object.keys(objs).map(() => OPS.paintImageXObject), argsArray: Object.keys(objs).map((k) => [k]) }),
    objs: { get: (name, cb) => cb(objs[name] ?? null) },
    cleanup() {},
  });
  const scaledOf = (objs, size = { w: 2, h: 1 }) => pictureScaled({ getPage: async () => page(objs) }, 7, size);
  for (const name of ["img_p6_2", "img_p6_4"]) {
    const got = await scaledOf({ frame_a: frame, [name]: img });
    assert.deepEqual([got.scaled.k, got.scaled.width, got.scaled.height], [2, 4, 2]);
  }
  await assert.rejects(scaledOf({ frame_a: frame }), /p\.7: the page paints 0 pictures of 2x1 samples/);
  await assert.rejects(scaledOf({ one: img, two: { ...img } }), /p\.7: the page paints 2 pictures of 2x1 samples/);
  await assert.rejects(scaledOf({ one: img }, { w: 2, h: 2 }), /paints 0 pictures of 2x2/);
});

console.log(`\n${n} checks`);
