/**
 * Market class gate: does every setting book's domain record read the same
 * market class as the grid row its `meta.market` names?
 *
 * A record and its grid row are two printings of one market's class. Where
 * they differ the importer keeps the record's and warns
 * (`markets.classConflict`) at import, on the Judge's world, after release;
 * nothing offline reads the real page, so a row bound to the wrong market
 * passes every committed test (docs/markets/DECISIONS.md, 2026-10-28, "AX3's
 * demand grid is corrected as printing errata").
 *
 * Reads every `kind.marketRecord` against the class column of every
 * `kind.marketGrid` in its book, and fails on:
 *   - a record or grid the executor cannot read;
 *   - a record whose `meta.market` names no grid row;
 *   - a record whose class differs from its row's and declares no
 *     `meta.gridClassErratum`;
 *   - a record that declares one while its class equals its row's, or while
 *     either class does not read, so a corrected page clears the flag.
 *
 * Requires the LOCAL reference PDFs, so it SKIPS (exit 0) where they are
 * absent — CI included. Output names entry ids, never a class or a heading.
 *
 * Usage: node tools/importer/check-market-classes.mjs   (also via `npm run validate`)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openBook } from "../../scripts/importer/extract.mjs";
import { executeEntry } from "../../scripts/importer/executor.mjs";
import { parseMarketClass } from "../../scripts/importer/market-profile-binding.mjs";
import { FILES, referenceComplete } from "./reference-lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COOKBOOK = path.join(HERE, "..", "..", "cookbook");

if (!referenceComplete()) {
  console.log("market classes: SKIPPED — local reference PDFs not on this machine.");
  process.exit(0);
}
if (!fs.existsSync(path.join(COOKBOOK, "registers.json"))) {
  console.log("market classes: SKIPPED — no cookbook/ to read.");
  process.exit(0);
}

const registers = JSON.parse(fs.readFileSync(path.join(COOKBOOK, "registers.json"), "utf8"));

const faults = [];
const differing = [];
let compared = 0;

for (const f of fs.readdirSync(COOKBOOK).filter((n) => n.endsWith(".json") && n !== "registers.json")) {
  const cb = JSON.parse(fs.readFileSync(path.join(COOKBOOK, f), "utf8"));
  const book = cb.book?.id;
  const entries = Object.values(cb.entries ?? {});
  const records = entries.filter((e) => e.kind === "kind.marketRecord");
  if (!book || !records.length || !FILES[book]) continue;
  const { doc } = await openBook(fs.readFileSync(FILES[book]), { book });
  const pageCache = new Map();
  const read = (id) => executeEntry(doc, cb, registers, id, { pageCache, skipOps: ["art"] });

  // A transposed grid prints no class, so its rows answer no record.
  const rowClass = new Map();
  for (const grid of entries.filter((e) => e.kind === "kind.marketGrid")) {
    const node = await read(grid.id);
    const rows = node?.ok ? node.fields?.grids?.markets?.rows : null;
    if (!rows) {
      faults.push(`${grid.id}: the grid does not read`);
      continue;
    }
    for (const row of rows) if (row?.key) rowClass.set(row.key, parseMarketClass(row.cells?.marketClass));
  }

  for (const rec of records) {
    const market = rec.meta?.market;
    const erratum = rec.meta?.gridClassErratum ?? null;
    if (!rowClass.has(market)) {
      faults.push(`${rec.id}: meta.market names no grid row of ${book}`);
      continue;
    }
    const node = await read(rec.id);
    if (!node?.ok) {
      faults.push(`${rec.id}: the record does not read`);
      continue;
    }
    const recordClass = parseMarketClass(node.fields?.marketClass);
    const gridClass = rowClass.get(market);
    if (recordClass === null || gridClass === null) {
      if (erratum) faults.push(`${rec.id}: declares gridClassErratum ${erratum}, but its class or its row's does not read`);
      continue;
    }
    compared++;
    if (recordClass === gridClass) {
      if (erratum) faults.push(`${rec.id}: declares gridClassErratum ${erratum}, but its class now equals grid row ${market}'s — remove the flag`);
      continue;
    }
    differing.push(`${rec.id} ${erratum ?? "undeclared"}`);
    if (!erratum) faults.push(`${rec.id}: its class differs from grid row ${market}'s, and it declares no gridClassErratum`);
  }
}

const tally = `${compared} record(s) compared, ${differing.length} differing (${differing.join(", ") || "none"})`;
if (faults.length) {
  for (const f of faults) console.error(`market classes: ${f}`);
  console.error(`market classes: FAILED — ${tally}.`);
  process.exit(1);
}
console.log(`market classes: OK — ${tally}.`);
