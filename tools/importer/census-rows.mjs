#!/usr/bin/env node
/**
 * DEV-ONLY: seeds and checks the register rows of a book's magic items
 * (`kind.magicItem`) from a LOCAL-ONLY heading census.
 *
 *   node tools/importer/census-rows.mjs seed <book> --census <path> --pages <a-b> [--verdict <path>] [--write]
 *   node tools/importer/census-rows.mjs check <book> --census <path> --pages <a-b>
 *
 * The census is a JSON file `{entries: [{n, pdfPage, column, y, category,
 * heading, key, ...}]}` in reading order, kept outside the repo; the verdict is
 * `{clear: [n, ...]}`, ordinals only, the architect's name pass. This tool
 * holds no book fact: it reads both by path, prints ordinals, counts and ratios
 * and never a word, and writes a heading's words (into the register file) only
 * for an ordinal the verdict clears.
 *
 * `seed` writes the rows of every census heading on the PDF pages `a-b` in
 * their final state. A cleared ordinal takes its words as `name` and
 * `anchor.display` (or `anchor.hash` where its folded name prefixes another
 * heading's on its page, which the display anchor would find first) and
 * `named`; every other ordinal, one the verdict does not list included, is
 * `Item <n>` with the census key as `anchor.hash`. `pages` spans the entry
 * (PDF; a census entry's own `pages` where it carries them), `meta.category`
 * is the census's, and `values: []` marks an entry whose header line opens
 * with a variant. A book that prints its labels at an entry's end declares it
 * (`itemLabelsAtEnd` in its `books/<id>/index.mjs`); the line under its
 * heading holds no label, so only a label found after other words marks a
 * variant. A census
 * entry marked `notItem` is a heading the book sets in the item face that is
 * no item (a rules sub-heading): it gets no row and is no heading a batch must
 * hold, and it still ends the entry before it. It is an upsert: a row whose id exists
 * anywhere in the register is left untouched. Without `--write` it prints what
 * it would write, and refuses a batch whose last entry spans onto a page whose
 * other headings are not in it.
 *
 * `check` reports, by ordinal: a census heading on a covered page with no row;
 * a row whose span reaches a page with an unrowed heading, or differs from the
 * span the PDF gives; a name the executor reads whose key is not the census
 * key; and the compiled description's coverage of the lines between its
 * heading and the next, with the heading-size runs outside the anchor's face
 * that it absorbed.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { foldLabel, printKey } from "../../scripts/importer/printed-name.mjs";
import { BOOK_CODE } from "../../scripts/importer/books/index.mjs";
import { MAGIC_CATEGORIES } from "../../scripts/importer/cookbook/magic-items.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..", "..");

/** The label of a row no reviewer cleared. */
export const neutralName = (n) => `Item ${n}`;

/** `"60-62"` as `[60, 62]`; a single page as `[60, 60]`. */
export function parsePages(text) {
  const m = /^(\d+)(?:-(\d+))?$/.exec(String(text ?? ""));
  if (!m) throw new Error(`--pages is "<a>-<b>" in PDF pages, not ${JSON.stringify(text)}`);
  const a = +m[1];
  const b = +(m[2] ?? m[1]);
  if (b < a) throw new Error(`--pages ${text} runs backwards`);
  return [a, b];
}

/** The census entries that are items on PDF pages `[a, b]`, in reading order. A `notItem` entry is left out. */
export const entriesOn = (census, [a, b]) => (census.entries ?? []).filter((e) => !e.notItem && e.pdfPage >= a && e.pdfPage <= b);

/** Whether a census heading is an item a row is owed for: every entry not marked `notItem`. */
const isItem = (e) => !e.notItem;

/** The census entry after `entry` in reading order, or undefined for the last. */
export const nextOf = (census, entry) => census.entries[census.entries.findIndex((e) => e.n === entry.n) + 1];

/** Whether a heading's folded name is the start of another heading's on its own page: a display anchor would find that one first. */
function prefixesAnother(census, entry) {
  const mine = foldLabel(entry.heading);
  return !!mine && census.entries.some((o) => o.n !== entry.n && o.pdfPage === entry.pdfPage && foldLabel(o.heading).startsWith(mine));
}

/**
 * The rows a batch seeds. `clear` is a Set of cleared ordinals (null: none).
 * `spanOf(entry, next)` gives the entry's PDF pages; the default is the
 * entry's own `pages`, else its own page. `variantLed(entry)` says the header line opens with a variant. A
 * cleared heading holding a digit is a figure and is seeded flagged.
 * @returns {{rows: object[], hashFallback: number[], flagged: number[], cleared: number[], variantLed: number[]}}
 */
export function seedRows(census, { book, pages, clear = null, spanOf = (e) => e.pages ?? [e.pdfPage], variantLed = () => false, named }) {
  const rows = [];
  const out = { rows, hashFallback: [], flagged: [], cleared: [], variantLed: [] };
  for (const entry of entriesOn(census, pages)) {
    if (!MAGIC_CATEGORIES.includes(entry.category)) throw new Error(`ordinal ${entry.n}: category ${JSON.stringify(entry.category)} is outside the vocabulary`);
    const span = spanOf(entry, nextOf(census, entry));
    const row = { id: `${book}.item${entry.n}`, kind: "kind.magicItem", book };
    const words = String(entry.heading ?? "").replace(/\s+/g, " ").trim();
    if (clear?.has(entry.n) && words && !/\d/.test(words)) {
      Object.assign(row, { name: words });
      if (prefixesAnother(census, entry)) {
        row.anchor = { hash: entry.key, as: "display" };
        out.hashFallback.push(entry.n);
      } else row.anchor = { display: words };
      row.named = named;
      out.cleared.push(entry.n);
    } else {
      Object.assign(row, { name: neutralName(entry.n), anchor: { hash: entry.key, as: "display" } });
      out.flagged.push(entry.n);
    }
    row.pages = span;
    row.meta = { category: entry.category };
    if (variantLed(entry)) {
      row.values = [];
      out.variantLed.push(entry.n);
    }
    rows.push(row);
  }
  return out;
}

/**
 * Ordinals of a batch whose last entry spans onto a page that holds another
 * heading outside the batch: the boundary moves before the pass, never after.
 */
export function boundaryProblems(census, rows, pages) {
  const inBatch = new Set(entriesOn(census, pages).map((e) => e.n));
  const out = [];
  for (const row of rows) {
    const n = +row.id.split(".item")[1];
    for (const p of row.pages.slice(1)) {
      if ((census.entries ?? []).some((e) => isItem(e) && e.pdfPage === p && !inBatch.has(e.n))) out.push(n);
    }
  }
  return [...new Set(out)];
}

/** Every row id in a register directory, over all its files. */
export function registerIds(dir) {
  const ids = new Set();
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (!f.endsWith(".json")) continue;
    for (const row of JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))) ids.add(row.id);
  }
  return ids;
}

/**
 * Writes the rows not already in the register to `<dir>/p<a>-p<b>-items.json`,
 * leaving a row of that file, or of any other, as it is. Returns the ids
 * written and the ids left.
 */
export function writeRows(dir, rows, pages) {
  const have = registerIds(dir);
  const fresh = rows.filter((r) => !have.has(r.id));
  const file = path.join(dir, `p${pages[0]}-p${pages[1]}-items.json`);
  if (fresh.length) {
    const held = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify([...held, ...fresh], null, 2)}\n`);
  }
  return { written: fresh.map((r) => r.id), left: rows.filter((r) => have.has(r.id)).map((r) => r.id) };
}

/**
 * The problems of a batch's rows against its census, by ordinal. `rows` maps
 * id to row. `spanOf` (optional) gives the span the PDF holds; `readKey(id)`
 * the print key of the name the executor reads; `coverage(id)` `{ratio,
 * absorbed}`. A measure not given is not checked.
 */
export function checkRows(census, rows, { book, pages, spanOf = null, readKey = null, coverage = null, band = [0.95, 1.05] }) {
  const out = { unrowed: [], spanOntoUnrowed: [], spanDiffers: [], nameKey: [], coverage: [], absorbed: {} };
  const entries = entriesOn(census, pages);
  for (const entry of entries) {
    const id = `${book}.item${entry.n}`;
    const row = rows.get(id);
    if (!row) {
      out.unrowed.push(entry.n);
      continue;
    }
    for (const p of row.pages.slice(1)) {
      if (census.entries.some((o) => isItem(o) && o.pdfPage === p && !rows.has(`${book}.item${o.n}`))) out.spanOntoUnrowed.push(entry.n);
    }
    if (spanOf) {
      const want = spanOf(entry, nextOf(census, entry));
      if (JSON.stringify(want) !== JSON.stringify(row.pages)) out.spanDiffers.push(entry.n);
    }
    if (readKey && readKey(id) !== entry.key) out.nameKey.push(entry.n);
    if (coverage) {
      const c = coverage(id, entry);
      if (c && (c.ratio < band[0] || c.ratio > band[1])) out.coverage.push({ n: entry.n, ratio: Math.round(c.ratio * 100) / 100 });
      if (c?.absorbed) out.absorbed[entry.n] = c.absorbed;
    }
  }
  out.spanOntoUnrowed = [...new Set(out.spanOntoUnrowed)];
  return out;
}

/* -------------------------------------------- */
/*  The PDF half                                */
/* -------------------------------------------- */

/** Opens a book's PDF with the compiler's own bands and typography. */
async function openDoc(book) {
  const [{ openBook, colOf, useTypography }, compiler, { FILES }] = await Promise.all([
    import("../../scripts/importer/extract.mjs"),
    import("./compile-cookbook.mjs"),
    import("./reference-lib.mjs"),
  ]);
  if (!FILES[book] || !fs.existsSync(FILES[book])) throw new Error(`the reference PDF of ${book} is not on this machine`);
  const { doc } = await openBook(fs.readFileSync(FILES[book]));
  compiler.useAxBands(doc, book);
  useTypography(doc, book);
  return { doc, colOf, compiler };
}

/**
 * The words the executor read for an entry's name: `title` where a hash anchor
 * read the heading, `found` where a display anchor matched a line. Empty when
 * neither is there.
 */
export const readNameOf = (nameField) => String(nameField?.title ?? nameField?.found ?? "");

/** Reading-order key of a run on a page: column then y. */
const place = (colOf, cols, it) => [colOf(it.x, cols), it.y];
const before = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);

/**
 * The body-height ceiling and the runs of an entry's region on one page, between
 * two reading-order points. A row's own assists shape the read as the compiler
 * does: its `columns` on the entry's first page only, and a run inside one of
 * its `excludeBoxes` is no prose.
 */
async function regionRuns(ctxPdf, page, from, to, assists = {}, first = false) {
  const { doc, colOf, compiler } = ctxPdf;
  const pd = await compiler.axPageItems(doc, page);
  const cols = compiler.axColumns(pd, first ? { columns: assists.columns } : {});
  const boxes = (assists.excludeBoxes ?? []).filter((b) => b.page === page);
  const boxedOut = (it) => boxes.some((b) => it.x >= b.x0 && it.x <= b.x1 && it.y >= b.y0 && it.y <= b.y1);
  // The census numbers its columns by the page's two halves; a page the detector
  // reads as three columns puts a heading under another index, so a point given
  // as `{half, y}` is placed by the run of that heading on the page.
  const at = (pt) => {
    if (!pt || Array.isArray(pt)) return pt;
    const own = pd.items.filter((it) => Math.abs(it.y - pt.y) < 3 && (pt.half === 0 ? it.x < pd.width / 2 : it.x >= pd.width / 2) && it.h >= (pd.axBands?.headMinH ?? 9.5));
    return own.length ? [colOf((pt.half === 0 ? Math.min : Math.max)(...own.map((it) => it.x)), cols), pt.y] : [pt.half, pt.y];
  };
  [from, to] = [at(from), at(to)];
  const top = pd.axBands?.topBand ?? 60;
  const foot = pd.axBands?.footY ?? 750;
  const items = pd.items
    .filter((it) => it.y > top && it.y < foot && String(it.str).trim() && !boxedOut(it))
    .map((it) => ({ it, at: place(colOf, cols, it) }))
    .sort((p, q) => (before(p.at, q.at) ? -1 : before(q.at, p.at) ? 1 : 0))
    .filter(({ at }) => (!from || !before(at, from)) && (!to || before(at, to)));
  const runs = [];
  let ended = false;
  for (const { it } of items) {
    if (it.h > compiler.AX_BODY_MAX_H) {
      ended = true;
      break;
    }
    runs.push(it);
  }
  return { runs, ended };
}

/**
 * The PDF pages an entry spans: from its heading's through the last page that
 * holds its text, up to the next heading in reading order, ending early at a
 * run taller than body type (a section head).
 */
export function pdfSpanOf(ctxPdf) {
  return async (entry, next) => {
    const pages = [entry.pdfPage];
    if (!next || next.pdfPage === entry.pdfPage) return pages;
    for (let p = entry.pdfPage + 1; p <= next.pdfPage; p++) {
      const to = p === next.pdfPage ? [next.column, next.y] : null;
      const { runs, ended } = await regionRuns(ctxPdf, p, null, to);
      if (runs.length) pages.push(p);
      if (ended || !runs.length) break;
    }
    return pages;
  };
}

/**
 * The text of the first body-size line among `runs` (items under a heading, in
 * one column), read left to right. A superscript sits above its line's baseline
 * and is smaller than the line, so it is left out; a run taller than
 * `bodyMaxH` is not body type. Empty when no run qualifies.
 */
export function firstBodyLine(runs, bodyMaxH) {
  const body = runs.filter((it) => it.h <= bodyMaxH);
  const bodyH = Math.max(0, ...body.map((it) => it.h));
  const line = body.filter((it) => it.h >= bodyH * 0.8).sort((x, y) => x.y - y.y || x.x - y.x);
  if (!line.length) return "";
  return line.filter((it) => Math.abs(it.y - line[0].y) < 2).sort((x, y) => x.x - y.x).map((it) => it.str).join(" ");
}

/** Whether a header line opens with the kind's first locator: false marks a variant-led entry. An empty line is not variant-led. */
export function opensWith(line, pattern) {
  if (!line) return true;
  const m = new RegExp(pattern, "i").exec(line);
  return !!m && line.slice(0, m.index).trim() === "";
}

/**
 * Whether a header line prints a variant ahead of the kind's first locator: the
 * locator is found, and words stand before it. For a book whose labels stand at
 * the entry's end, where a line with no locator in it is no variant's.
 */
export function labelAfterVariant(line, pattern) {
  if (!line) return false;
  const m = new RegExp(pattern, "i").exec(line);
  return !!m && line.slice(0, m.index).trim() !== "";
}

/**
 * Whether the line under an entry's heading marks it variant-led. A book that
 * declares its labels at the entry's end (`labelsAtEnd`) is told by a label
 * found after other words; any other by what opens the line.
 */
export const variantLedLine = (line, pattern, labelsAtEnd = false) => (labelsAtEnd ? labelAfterVariant(line, pattern) : !opensWith(line, pattern));

/** Whether the line under `entry`'s heading marks it variant-led (`variantLedLine`). */
async function variantBeforeLabel(ctxPdf, entry, pattern, labelsAtEnd) {
  const { doc, colOf, compiler } = ctxPdf;
  const pd = await compiler.axPageItems(doc, entry.pdfPage);
  const cols = compiler.axColumns(pd);
  const near = pd.items.filter((it) => colOf(it.x, cols) === entry.column && it.y > entry.y + 2 && it.y < entry.y + 20);
  return variantLedLine(firstBodyLine(near, compiler.AX_BODY_MAX_H), pattern, labelsAtEnd);
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const arg = (argv, name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);

async function main(argv) {
  const [cmd, book] = argv;
  if (!["seed", "check"].includes(cmd) || !book) throw new Error("usage: census-rows.mjs seed|check <book> --census <path> --pages <a-b> [--verdict <path>] [--write]");
  const pages = parsePages(arg(argv, "--pages"));
  const census = readJson(arg(argv, "--census"));
  const ctxPdf = await openDoc(book);
  const spans = pdfSpanOf(ctxPdf);
  const kind = readJson(path.join(REPO, "register", "_kinds", "magicItem.json"));
  const firstLocator = kind.values?.[0]?.from?.pattern;
  // The PDF reads are async; the pure functions take their results by entry.
  const spanOf = new Map();
  const variant = new Set();
  for (const entry of entriesOn(census, pages)) {
    spanOf.set(entry.n, entry.pages ?? (await spans(entry, nextOf(census, entry))));
    if (firstLocator && (await variantBeforeLabel(ctxPdf, entry, firstLocator, !!BOOK_CODE[book]?.itemLabelsAtEnd))) variant.add(entry.n);
  }
  const dir = path.join(REPO, "register", book);
  if (cmd === "seed") {
    const verdictPath = arg(argv, "--verdict");
    const clear = verdictPath ? new Set(readJson(verdictPath).clear ?? []) : null;
    const seeded = seedRows(census, { book, pages, clear, spanOf: (e) => spanOf.get(e.n), variantLed: (e) => variant.has(e.n), named: new Date().toLocaleDateString("sv-SE") });
    const refused = boundaryProblems(census, seeded.rows, pages);
    const ords = seeded.rows.map((r) => +r.id.split(".item")[1]);
    console.log(`seed ${book} PDF ${pages[0]}-${pages[1]}: ${seeded.rows.length} rows, ordinals ${ords[0]}-${ords[ords.length - 1]}; cleared ${seeded.cleared.length}, flagged ${seeded.flagged.length}, hash fallback [${seeded.hashFallback}], variant-led [${seeded.variantLed}]`);
    const multi = seeded.rows.filter((r) => r.pages.length > 1).map((r) => +r.id.split(".item")[1]);
    console.log(`spanning pages: [${multi}]`);
    if (refused.length) {
      console.error(`refused: ordinals [${refused}] span onto a page whose other headings are not in this batch; move the boundary`);
      process.exitCode = 1;
      return;
    }
    if (argv.includes("--write")) {
      const result = writeRows(dir, seeded.rows, pages);
      console.log(`wrote ${result.written.length} rows, left ${result.left.length} existing`);
    }
    return;
  }
  // check: the rows as they stand, the compiled cookbook, and the executor's read.
  const rows = new Map();
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (f.endsWith(".json")) for (const r of readJson(path.join(dir, f))) if (r.kind === "kind.magicItem") rows.set(r.id, r);
  }
  const cb = readJson(path.join(REPO, "cookbook", `${book}.json`));
  const registers = readJson(path.join(REPO, "cookbook", "registers.json"));
  const { executeEntry } = await import("../../scripts/importer/executor.mjs");
  const nodes = new Map();
  for (const entry of entriesOn(census, pages)) {
    const id = `${book}.item${entry.n}`;
    if (cb.entries?.[id]) nodes.set(id, await executeEntry(ctxPdf.doc, cb, registers, id));
  }
  const coverage = (id, entry) => {
    const node = nodes.get(id);
    if (!node?.ok) return null;
    const words = (node.fields.description ?? []).reduce((n, p) => n + String(p.text ?? "").split(/\s+/).filter(Boolean).length, 0);
    return { words, ratio: 0, absorbed: 0, entry };
  };
  const measured = new Map();
  for (const entry of entriesOn(census, pages)) {
    const id = `${book}.item${entry.n}`;
    const next = nextOf(census, entry);
    let total = 0;
    let absorbed = 0;
    const faces = new Set();
    const head = (await ctxPdf.compiler.axPageItems(ctxPdf.doc, entry.pdfPage)).items.filter((it) => Math.abs(it.y - entry.y) < 2);
    for (const it of head) faces.add(it.alias);
    for (const p of spanOf.get(entry.n)) {
      const from = p === entry.pdfPage ? { half: entry.column, y: entry.y + 2 } : null;
      const to = next && p === next.pdfPage ? { half: next.column, y: next.y } : null;
      const { runs } = await regionRuns(ctxPdf, p, from, to, rows.get(id)?.assists ?? {}, p === entry.pdfPage);
      for (const it of runs) {
        total += String(it.str).split(/\s+/).filter(Boolean).length;
        if (it.h >= (ctxPdf.doc.axBands?.headMinH ?? 9.5) && !faces.has(it.alias)) absorbed++;
      }
    }
    const c = coverage(id, entry);
    measured.set(id, c && total ? { ratio: c.words / total, absorbed } : null);
  }
  const result = checkRows(census, rows, {
    book, pages,
    spanOf: (e) => spanOf.get(e.n),
    readKey: (id) => (nodes.get(id)?.ok ? printKey(readNameOf(nodes.get(id).fields.name)) : null),
    coverage: (id) => measured.get(id),
  });
  console.log(`check ${book} PDF ${pages[0]}-${pages[1]}: ${entriesOn(census, pages).length} headings, ${rows.size} rows`);
  console.log(`unrowed [${result.unrowed}]; span onto an unrowed page [${result.spanOntoUnrowed}]; span differs from the PDF's [${result.spanDiffers}]`);
  console.log(`read name differs from the census key [${result.nameKey}]`);
  console.log(`coverage outside the band ${JSON.stringify(result.coverage)}; absorbed heading-size runs ${JSON.stringify(result.absorbed)}`);
  const bad = result.unrowed.length + result.spanOntoUnrowed.length + result.spanDiffers.length + result.nameKey.length;
  if (bad) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
