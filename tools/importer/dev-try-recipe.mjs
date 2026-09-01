/**
 * DEV-ONLY: run ONE table recipe against the real book and report what it read.
 *
 * The recipe-authoring loop needs an answer to "did my window land where I
 * meant it to" without launching Foundry. `dev-extract-check` runs a fixed
 * sample of ENTRIES; this runs a named TABLE.
 *
 * IP posture, same as its siblings: this is a diagnostic for the authoring
 * agent and is never shipped. It prints what a window captured so the author
 * can see whether the anchor found the right paragraph — so its output is book
 * prose and MUST NOT be pasted into a repo, a commit message or a recipe. The
 * recipe stores pointers; the prose stays in the reader's own book.
 *
 * Usage: node tools/dev-try-recipe.mjs <docId> [tableKey]
 */
import fs from "node:fs";
import { openBook, pageItems } from "../../scripts/importer/extract.mjs";
import { findPage, extractTable } from "../../scripts/importer/table-extract.mjs";
import { TABLE_RECIPES } from "../../scripts/importer/table-recipes.mjs";
import { FILES } from "./reference-lib.mjs";

const [docId, only] = process.argv.slice(2);
const doc = TABLE_RECIPES[docId];
if (!doc) {
  process.stdout.write(`no recipe "${docId}". Known: ${Object.keys(TABLE_RECIPES).join(", ")}\n`);
  process.exit(1);
}

const books = new Map();
async function bookFor(id) {
  if (!books.has(id)) books.set(id, await openBook(fs.readFileSync(FILES[id])));
  return books.get(id);
}

for (const [key, recipe] of Object.entries(doc.tables ?? {})) {
  if (only && key !== only) continue;
  const { doc: pdf } = await bookFor(recipe.book);
  const found = await findPage(recipe, pdf.numPages, (p) => pageItems(pdf, p));
  if (!found) {
    process.stdout.write(`MISS  ${key}: no page contains "${recipe.locate}"\n`);
    continue;
  }
  let out;
  try {
    out = extractTable(found.items, recipe);
  } catch (err) {
    process.stdout.write(`ERR   ${key} (p${found.page}): ${err.message}\n`);
    continue;
  }
  const entries = Object.entries(out ?? {});
  const empty = entries.filter(([, v]) => v == null || v === "").map(([k]) => k);
  process.stdout.write(`p${found.page} ${key}: ${entries.length} value(s)`
    + (empty.length ? ` — EMPTY: ${empty.join(", ")}` : "") + "\n");
  for (const [k, v] of entries) {
    const text = typeof v === "string" ? v : JSON.stringify(v);
    process.stdout.write(`      ${k}: ${String(text).slice(0, 150)}\n`);
  }
}
