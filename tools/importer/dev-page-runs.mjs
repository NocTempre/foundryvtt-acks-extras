/**
 * DEV-ONLY: print the x/y of every run on a page, optionally filtered.
 *
 * Column boxes in a recipe are measurements, and guessing them costs a cycle
 * each time. This is the ruler: it shows where the runs actually sit so a
 * `cellColumns` x/w can be read off rather than estimated.
 *
 * IP posture as its siblings: a diagnostic for the authoring agent. It prints
 * short run fragments and coordinates and is never shipped, never pasted into
 * a repo.
 *
 * Usage: node tools/dev-page-runs.mjs <book> <page> [substring]
 */
import fs from "node:fs";
import { openBook, pageItems } from "../../scripts/importer/extract.mjs";
import { FILES } from "./reference-lib.mjs";

const [book, pageArg, needle] = process.argv.slice(2);
const { doc } = await openBook(fs.readFileSync(FILES[book]));
const { items } = await pageItems(doc, Number(pageArg));

const rows = new Map();
for (const it of items) {
  const y = Math.round(it.y / 3) * 3;
  if (!rows.has(y)) rows.set(y, []);
  rows.get(y).push(it);
}
for (const [y, runs] of [...rows.entries()].sort((a, b) => a[0] - b[0])) {
  const line = runs.map((r) => r.str).join(" ");
  if (needle && !line.toLowerCase().includes(needle.toLowerCase())) continue;
  const cells = runs
    .sort((a, b) => a.x - b.x)
    .map((r) => `x${Math.round(r.x)}"${r.str.slice(0, 22)}"`)
    .join(" ");
  process.stdout.write(`y${y}: ${cells}\n`);
}
