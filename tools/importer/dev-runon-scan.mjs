/**
 * DEV-ONLY audit: which entries' description blocks SWALLOW a sibling?
 *
 * A run-in block ends at the next run-in heading. The stop rule finds that
 * heading by looking down the same column at the column's own left edge — so a
 * spread that INDENTS its run-ins hides every one of them from it, the block
 * runs to the foot of the column, and the column flow carries it onto whatever
 * comes next: the sibling's prose, a table, the following page.
 *
 * The detector needs no PDF and no guesswork about where prose ought to end.
 * Every entry already ships the geometry of its own name (`expect`), so a
 * sibling's name box falling INSIDE another entry's description box is proof
 * that the block ran past it — an entry reproducing another entry's text.
 *
 * Reads the compiled cookbook only, so it runs anywhere. Reports shapes and
 * ids, never page text.
 *
 * Usage: node tools/dev-runon-scan.mjs [--verbose]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COOKBOOK = path.join(HERE, "..", "..", "cookbook");
const verbose = process.argv.includes("--verbose");

const entries = [];
for (const f of fs.readdirSync(COOKBOOK)) {
  if (!f.endsWith(".json") || ["registers.json", "index.json"].includes(f)) continue;
  const cb = JSON.parse(fs.readFileSync(path.join(COOKBOOK, f), "utf8"));
  for (const [id, e] of Object.entries(cb.entries ?? {})) entries.push({ file: f, id, e });
}

/** Every `{page, box}` an entry's description reads from. */
const describeBoxes = (e) => {
  const d = e.fields?.description;
  if (d?.op !== "text") return [];
  return (d.paras ?? []).map((p) => ({ page: p.page ?? d.page, box: p.box })).filter((b) => b.box);
};
/** The entry's own name box, which is where its heading is printed. */
const nameBox = (e) => {
  const n = e.fields?.name;
  return n?.op === "expect" && n.box ? { page: n.page, box: n.box } : null;
};
const inside = (pt, b) =>
  pt.page === b.page && pt.box.x0 >= b.box.x0 - 2 && pt.box.x0 <= b.box.x1 + 2 && pt.box.y0 >= b.box.y0 - 2 && pt.box.y1 <= b.box.y1 + 2;

const byPage = new Map();
for (const row of entries) {
  const nb = nameBox(row.e);
  if (!nb) continue;
  const key = `${row.e.book}|${nb.page}`;
  if (!byPage.has(key)) byPage.set(key, []);
  byPage.get(key).push({ ...row, nb });
}

const swallowed = [];
for (const row of entries) {
  const boxes = describeBoxes(row.e);
  if (!boxes.length) continue;
  const victims = new Set();
  for (const b of boxes) {
    for (const other of byPage.get(`${row.e.book}|${b.page}`) ?? []) {
      if (other.id === row.id) continue;
      if (inside(other.nb, b)) victims.add(other.id);
    }
  }
  if (victims.size) swallowed.push({ id: row.id, book: row.e.book, page: boxes[0].page, victims: [...victims] });
}

/** A second, independent smell: a paragraph box taller than any column of prose. */
const TALL = 260;
const tall = entries
  .flatMap((row) => describeBoxes(row.e).map((b) => ({ id: row.id, book: row.e.book, page: b.page, h: Math.round(b.box.y1 - b.box.y0) })))
  .filter((b) => b.h >= TALL);

console.log(`scanned ${entries.length} entries`);
console.log(`\n${swallowed.length} entry/entries whose description swallows a sibling's heading:`);
const byBook = {};
for (const s of swallowed) (byBook[s.book] ??= []).push(s);
for (const [book, rows] of Object.entries(byBook)) {
  console.log(`  ${book}: ${rows.length}`);
  if (verbose) for (const r of rows) console.log(`    ${r.id} (p${r.page}) swallows ${r.victims.join(", ")}`);
}
console.log(`\n${tall.length} description box(es) taller than ${TALL}pt (a column of prose is rarely this tall):`);
const tallBy = {};
for (const t of tall) (tallBy[t.book] ??= []).push(t);
for (const [book, rows] of Object.entries(tallBy)) {
  console.log(`  ${book}: ${rows.length}  (worst ${Math.max(...rows.map((r) => r.h))}pt)`);
  if (verbose) for (const r of rows.sort((a, b) => b.h - a.h).slice(0, 20)) console.log(`    ${r.id} p${r.page} ${r.h}pt`);
}
process.exit(swallowed.length ? 1 : 0);
