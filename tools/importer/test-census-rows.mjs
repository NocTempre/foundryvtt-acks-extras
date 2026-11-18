/**
 * The census-rows dev tool's pure half (`census-rows.mjs`): seeding a batch's
 * register rows from a census and a verdict, the upsert, the boundary refusal
 * and the check. The census and the verdict are invented and written to a temp
 * directory: no PDF, no book word.
 *
 * Usage: node tools/importer/test-census-rows.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { boundaryProblems, checkRows, firstBodyLine, opensWith, readNameOf, parsePages, seedRows, writeRows } from "./census-rows.mjs";
import { printKey } from "../../scripts/importer/printed-name.mjs";

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};

const e = (ord, pdfPage, heading, extra = {}) => ({ n: ord, id: `zz.item${ord}`, pdfPage, column: 0, y: 100 + ord, category: "rings", heading, key: printKey(heading), ...extra });
const census = {
  entries: [
    e(1, 60, "Brenmoth Flask"),
    e(2, 60, "Brenmoth Flask and Tray"),
    e(3, 60, "Ring of Quorvil"),
    e(4, 61, "Ring of 3 Zantiks"),
    e(5, 61, "Cord of Yalwin", { category: "misc" }),
    e(6, 62, "Sash of Ombrel", { category: "misc" }),
  ],
};
const PAGES = [60, 61];
const idsOf = (rows) => rows.map((r) => r.id.split(".item")[1]).map(Number);

t("a seed with no verdict writes every row flagged: a hash, a category and pages, and no heading word", () => {
  const { rows, flagged, cleared } = seedRows(census, { book: "zz", pages: PAGES, named: "2026-11-17" });
  assert.deepEqual(idsOf(rows), [1, 2, 3, 4, 5]);
  assert.deepEqual(cleared, []);
  assert.deepEqual(flagged, [1, 2, 3, 4, 5]);
  for (const r of rows) {
    assert.equal(r.name, `Item ${r.id.split(".item")[1]}`);
    assert.deepEqual(r.anchor, { hash: census.entries[+r.id.split(".item")[1] - 1].key, as: "display" });
    assert.equal(r.named, undefined);
    assert.ok(r.pages.length >= 1 && r.pages.every((p, i) => i === 0 || p === r.pages[i - 1] + 1), "contiguous pages");
  }
  assert.deepEqual(rows.map((r) => r.meta.category), ["rings", "rings", "rings", "rings", "misc"]);
  const text = JSON.stringify(rows).toLowerCase();
  for (const word of ["brenmoth", "flask", "quorvil", "yalwin"]) assert.ok(!text.includes(word), `no census word: ${word}`);
});

t("a seed with a verdict names exactly the cleared ordinals, with display and named, and leaves the rest flagged", () => {
  const { rows, cleared, flagged } = seedRows(census, { book: "zz", pages: PAGES, clear: new Set([3, 5]), named: "2026-11-17" });
  assert.deepEqual(cleared, [3, 5]);
  assert.deepEqual(flagged, [1, 2, 4]);
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(by["zz.item3"].name, "Ring of Quorvil");
  assert.deepEqual(by["zz.item3"].anchor, { display: "Ring of Quorvil" });
  assert.equal(by["zz.item3"].named, "2026-11-17");
  assert.equal(by["zz.item1"].name, "Item 1");
  assert.equal(by["zz.item4"].name, "Item 4");
});

t("a cleared ordinal whose folded name prefixes another heading's on its page anchors by hash and keeps its name", () => {
  const { rows, hashFallback } = seedRows(census, { book: "zz", pages: PAGES, clear: new Set([1]), named: "2026-11-17" });
  assert.deepEqual(hashFallback, [1]);
  assert.equal(rows[0].name, "Brenmoth Flask");
  assert.deepEqual(rows[0].anchor, { hash: census.entries[0].key, as: "display" });
  assert.equal(rows[0].named, "2026-11-17");
});

t("a cleared ordinal whose heading holds a digit is seeded flagged", () => {
  const { rows, cleared } = seedRows(census, { book: "zz", pages: PAGES, clear: new Set([4]), named: "2026-11-17" });
  assert.deepEqual(cleared, []);
  assert.equal(rows[3].name, "Item 4");
});

t("an entry that spans takes the span the PDF half gives, and a variant-led one has no values", () => {
  const { rows, variantLed } = seedRows(census, {
    book: "zz", pages: PAGES, spanOf: (x) => (x.n === 3 ? [60, 61] : [x.pdfPage]), variantLed: (x) => x.n === 2,
  });
  assert.deepEqual(rows[2].pages, [60, 61]);
  assert.deepEqual(rows[1].values, []);
  assert.equal(rows[0].values, undefined);
  assert.deepEqual(variantLed, [2]);
});

t("a second write leaves an existing row untouched, so a hand fix survives", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "census-rows-"));
  try {
    const { rows } = seedRows(census, { book: "zz", pages: PAGES, named: "2026-11-17" });
    const first = writeRows(dir, rows, PAGES);
    assert.equal(first.written.length, 5);
    const file = path.join(dir, "p60-p61-items.json");
    const held = JSON.parse(fs.readFileSync(file, "utf8"));
    held[0].audited = "2026-11-18";
    fs.writeFileSync(file, JSON.stringify(held));
    const again = writeRows(dir, rows, PAGES);
    assert.deepEqual(again.written, []);
    assert.equal(again.left.length, 5);
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8"))[0].audited, "2026-11-18");
    const wider = seedRows(census, { book: "zz", pages: [60, 62], named: "2026-11-17" }).rows;
    const third = writeRows(dir, wider, [60, 62]);
    assert.deepEqual(third.written, ["zz.item6"], "only the new row is written");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

t("a batch whose last entry spans onto a page holding other headings is refused by ordinal", () => {
  const { rows } = seedRows(census, { book: "zz", pages: PAGES, spanOf: (x) => (x.n === 5 ? [61, 62] : [x.pdfPage]) });
  assert.deepEqual(boundaryProblems(census, rows, PAGES), [5]);
  const clean = seedRows(census, { book: "zz", pages: PAGES });
  assert.deepEqual(boundaryProblems(census, clean.rows, PAGES), []);
});

t("a page range parses, and a backwards or malformed one throws", () => {
  assert.deepEqual(parsePages("60-62"), [60, 62]);
  assert.deepEqual(parsePages("60"), [60, 60]);
  assert.throws(() => parsePages("62-60"), /backwards/);
  assert.throws(() => parsePages("a-b"), /PDF pages/);
});

const rowsMap = (rows) => new Map(rows.map((r) => [r.id, r]));

t("check reports an unrowed heading on a covered page", () => {
  const { rows } = seedRows(census, { book: "zz", pages: PAGES });
  const result = checkRows(census, rowsMap(rows.filter((r) => r.id !== "zz.item2")), { book: "zz", pages: PAGES });
  assert.deepEqual(result.unrowed, [2]);
});

t("check reports a span onto a page with an unrowed heading", () => {
  const { rows } = seedRows(census, { book: "zz", pages: PAGES, spanOf: (x) => (x.n === 5 ? [61, 62] : [x.pdfPage]) });
  assert.deepEqual(checkRows(census, rowsMap(rows), { book: "zz", pages: PAGES }).spanOntoUnrowed, [5]);
  const wide = seedRows(census, { book: "zz", pages: [60, 62], spanOf: (x) => (x.n === 5 ? [61, 62] : [x.pdfPage]) }).rows;
  assert.deepEqual(checkRows(census, rowsMap(wide), { book: "zz", pages: PAGES }).spanOntoUnrowed, []);
});

t("check reports a span that differs from the PDF's, and a read name whose key differs from the census key", () => {
  const { rows } = seedRows(census, { book: "zz", pages: PAGES });
  const result = checkRows(census, rowsMap(rows), {
    book: "zz", pages: PAGES,
    spanOf: (x) => (x.n === 3 ? [60, 61] : [x.pdfPage]),
    readKey: (id) => (id === "zz.item4" ? "wrong" : census.entries[+id.split(".item")[1] - 1].key),
  });
  assert.deepEqual(result.spanDiffers, [3]);
  assert.deepEqual(result.nameKey, [4]);
});

t("check reports coverage outside the band and the heading-size runs a flow absorbed", () => {
  const { rows } = seedRows(census, { book: "zz", pages: PAGES });
  const result = checkRows(census, rowsMap(rows), {
    book: "zz", pages: PAGES,
    coverage: (id) => ({ "zz.item1": { ratio: 1 }, "zz.item2": { ratio: 0.6 }, "zz.item3": { ratio: 1.2, absorbed: 2 } })[id] ?? { ratio: 1 },
  });
  assert.deepEqual(result.coverage, [{ n: 2, ratio: 0.6 }, { n: 3, ratio: 1.2 }]);
  assert.deepEqual(result.absorbed, { 3: 2 });
});

t("the name an executor read is its title under a hash anchor and its found line under a display anchor", () => {
  assert.equal(readNameOf({ ok: true, title: "Zz Alpha" }), "Zz Alpha");
  assert.equal(readNameOf({ ok: true, found: "Zz Beta" }), "Zz Beta");
  assert.equal(readNameOf({ ok: false }), "");
  assert.equal(readNameOf(undefined), "");
});

t("the header line is read past a superscript that sits above it, and a variant-led line is told by what opens it", () => {
  const run = (str, x, y, h) => ({ str, x, y, h });
  // A superscript at y=603 sits above the baseline (y=606) of a 9pt line and is smaller than it.
  const runs = [run("th", 279, 603, 5.2), run("Quorv 2,000gp:", 45, 606, 9), run("alpha", 122, 606, 9), run("later line", 45, 616, 9)];
  assert.equal(firstBodyLine(runs, 10.6), "Quorv 2,000gp: alpha");
  assert.equal(firstBodyLine([run("Big", 45, 100, 14)], 10.6), "");
  const pattern = "Quorv\\s*(\\d+)";
  assert.equal(opensWith("Quorv 2,000gp: alpha", pattern), true);
  assert.equal(opensWith("Other Quorv 5", pattern), false);
  assert.equal(opensWith("", pattern), true);
});

console.log(`\ncensus-rows: ${n} checks OK`);
