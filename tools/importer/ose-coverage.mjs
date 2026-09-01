/**
 * DEV-ONLY: what the stat-block grammar cannot yet read, across the whole
 * third-party corpus, ranked so the most common misfit is the next rule.
 *
 * The manual editor exists so a Judge is never stuck. It is NOT where a
 * misreading is supposed to end: a clause that had to be corrected by hand is
 * a defect report against `ose-statline.mjs`, and this is the tool that
 * collects those reports in bulk instead of one Judge at a time.
 *
 * Run it, take the top line, write the rule, run it again. The number that
 * matters is `unread` falling.
 *
 * IP: the corpus is other publishers' books. This reports SHAPES — every digit
 * run folded to `#`, so "HIT DICE 2 (9hp)" and "HIT DICE 11 (48hp)" are one
 * finding — because a shape is what a grammar rule is written against, and
 * because a report of shapes carries no values. It prints to stdout and writes
 * nothing: a coverage file in the repo would be a corpus of stat lines in a
 * tracked file. Nothing here runs in CI.
 *
 * Usage:
 *   node tools/ose-coverage.mjs                 every book, every page
 *   node tools/ose-coverage.mjs --book carcass  only matching paths
 *   node tools/ose-coverage.mjs --pages 12      first N pages of each book
 *   node tools/ose-coverage.mjs --top 40        how many findings to list
 *   node tools/ose-coverage.mjs --samples       show one real clause per shape
 */
import fs from "node:fs";
import path from "node:path";
import { openBook, pageItems } from "../../scripts/importer/extract.mjs";
import { findStatBlocks, unknownLabels } from "../../scripts/importer/ose-blocks.mjs";
import { parseOseStatline, OSE_CANONICAL } from "../../scripts/importer/ose-statline.mjs";
import { LIB_OSE } from "./reference-lib.mjs";

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const ONLY = flag("book");
const MAX_PAGES = Number(flag("pages", "0")) || Infinity;
const TOP = Number(flag("top", "25"));
const SAMPLES = has("samples");

if (!fs.existsSync(LIB_OSE)) {
  console.error(`ose-coverage: no OSE library on this machine (${LIB_OSE}) — skipped.`);
  process.exit(0);
}

/** Every PDF under the library, deepest-first order irrelevant. */
function pdfsUnder(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...pdfsUnder(p));
    else if (/\.pdf$/i.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * A clause reduced to its shape: digits folded, so what remains is the wording
 * and the punctuation — which is what a grammar rule is written against.
 */
const shapeOf = (s) =>
  String(s ?? "")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

const bump = (map, key, sample) => {
  const row = map.get(key) ?? { count: 0, books: new Set(), sample };
  row.count++;
  map.set(key, row);
  return row;
};

const files = pdfsUnder(LIB_OSE).filter((f) => !ONLY || f.toLowerCase().includes(ONLY.toLowerCase()));
if (!files.length) {
  console.error(`ose-coverage: nothing matched ${ONLY ? `"${ONLY}"` : "the library"}.`);
  process.exit(0);
}

const unread = new Map(); // clause shapes the grammar left over
const labels = new Map(); // words standing where a label would stand
const fieldHits = new Map(); // how often each field was read at all
const soleBlocker = new Map(); // the ONE shape holding an otherwise-clean block back
const blocksByLeftovers = new Map(); // how far from clean the unread blocks are
// Per publisher, because the reference publisher and the rest are different
// problems: one prints the format the grammar is modelled on, the others print
// their own reading of it.
const byPublisher = new Map();
const pubOf = (rel) => rel.split(/[\\/]/)[0] || "(root)";
const forPub = (rel) => {
  const k = pubOf(rel);
  if (!byPublisher.has(k)) byPublisher.set(k, { clean: 0, readable: 0 });
  return byPublisher.get(k);
};
const stats = { books: 0, unopened: 0, pages: 0, blocks: 0, suspect: 0, merged: 0, clean: 0 };

for (const file of files) {
  const rel = path.relative(LIB_OSE, file);
  let doc;
  let numPages;
  try {
    ({ doc, numPages } = await openBook(fs.readFileSync(file)));
  } catch (err) {
    stats.unopened++;
    console.error(`  !! ${rel}: ${err.message}`);
    continue;
  }
  stats.books++;
  const last = Math.min(numPages, MAX_PAGES);
  for (let p = 1; p <= last; p++) {
    let pd;
    try {
      pd = await pageItems(doc, p);
    } catch {
      continue; // a page that will not render is not a grammar problem
    }
    stats.pages++;

    for (const u of unknownLabels(pd, OSE_CANONICAL)) {
      bump(labels, u.label, u.label).books.add(rel);
    }

    for (const c of findStatBlocks(pd, OSE_CANONICAL)) {
      stats.blocks++;
      if (c.suspectLineage) stats.suspect++;
      if (c.mergedBlocks) stats.merged++;
      // A block the locator itself distrusts is not evidence about the grammar.
      if (c.suspectLineage || c.mergedBlocks) continue;

      const parsed = parseOseStatline(c.text, OSE_CANONICAL);
      for (const key of Object.keys(parsed.fields)) bump(fieldHits, key, key);
      const pub = forPub(rel);
      pub.readable++;
      if (!parsed.extra.length) {
        stats.clean++;
        pub.clean++;
      }
      // How far from clean each block is. A block held back by ONE leftover is
      // worth more than its share of the ranking: fixing that one shape makes
      // the whole block read, where a block with four is four rules away.
      const n = parsed.extra.length;
      if (n) blocksByLeftovers.set(n, (blocksByLeftovers.get(n) ?? 0) + 1);
      if (n === 1) bump(soleBlocker, shapeOf(parsed.extra[0]), parsed.extra[0]).books.add(rel);
      for (const leftover of parsed.extra) {
        bump(unread, shapeOf(leftover), leftover).books.add(rel);
      }
    }
  }
  if (stats.books % 10 === 0) console.error(`  … ${stats.books}/${files.length} books`);
}

/* -------------------------------------------- */
/*  The report                                  */
/* -------------------------------------------- */

const rank = (map) => [...map.entries()].sort((a, b) => b[1].count - a[1].count);
const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : "—");

console.log(`\n=== OSE grammar coverage — ${stats.books} book(s), ${stats.pages} page(s) ===`);
if (stats.unopened) console.log(`${stats.unopened} book(s) would not open.`);
console.log(
  `blocks found: ${stats.blocks}   fully read: ${stats.clean} (${pct(stats.clean, stats.blocks - stats.suspect - stats.merged)} of readable)   ` +
    `refused: ${stats.suspect} foreign, ${stats.merged} merged`,
);

console.log(`\n--- clauses the grammar left over (each one is a rule to write) ---`);
const unreadRows = rank(unread).slice(0, TOP);
if (!unreadRows.length) console.log("  none — every block read completely.");
for (const [shape, row] of unreadRows) {
  console.log(`  ${String(row.count).padStart(4)}×  ${row.books.size} book(s)  ${shape}`);
  if (SAMPLES) console.log(`        e.g. ${row.sample}`);
}

console.log(`\n--- by publisher ---`);
for (const [pub, s] of [...byPublisher.entries()].sort((a, b) => b[1].readable - a[1].readable)) {
  console.log(`  ${pct(s.clean, s.readable).padStart(4)}  ${String(s.clean).padStart(4)}/${String(s.readable).padEnd(5)} ${pub}`);
}

console.log(`\n--- the ONE shape holding an otherwise-clean block back ---`);
console.log(`    (fixing a row here makes that many whole blocks read)`);
const soleRows = rank(soleBlocker).slice(0, TOP);
if (!soleRows.length) console.log("  none.");
let recoverable = 0;
for (const [shape, row] of soleRows) {
  recoverable += row.count;
  console.log(`  ${String(row.count).padStart(4)}×  ${row.books.size} book(s)  ${shape}`);
  if (SAMPLES) console.log(`        e.g. ${row.sample}`);
}
const readableTotal = stats.blocks - stats.suspect - stats.merged;
console.log(
  `  --> ${recoverable} block(s) recoverable from the rows above, taking coverage to ` +
    `${pct(stats.clean + recoverable, readableTotal)}`,
);

console.log(`\n--- how far the unread blocks are from clean ---`);
for (const [n, c] of [...blocksByLeftovers.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  ${String(c).padStart(4)} block(s) with ${n} leftover(s)`);
}

console.log(`\n--- words standing where a label would stand ---`);
const labelRows = rank(labels).slice(0, TOP);
if (!labelRows.length) console.log("  none.");
for (const [label, row] of labelRows) {
  console.log(`  ${String(row.count).padStart(4)}×  ${row.books.size} book(s)  ${label}`);
}

console.log(`\n--- how often each field was read ---`);
const known = Object.keys(OSE_CANONICAL.labels);
for (const key of known) {
  const n = fieldHits.get(key)?.count ?? 0;
  console.log(`  ${key.padEnd(6)} ${String(n).padStart(5)}  ${pct(n, stats.blocks - stats.suspect - stats.merged)}`);
}
console.log("");
