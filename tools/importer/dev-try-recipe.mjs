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
import { extractPlain, recipeLocates, recipePages } from "../../scripts/importer/tables-binding.mjs";
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
  if (!books.has(id)) books.set(id, await openBook(fs.readFileSync(FILES[id]), { book: id }));
  return books.get(id);
}

for (const [key, recipe] of Object.entries(doc.tables ?? {})) {
  if (only && key !== only) continue;
  const { doc: pdf } = await bookFor(recipe.book);
  if (recipe.valueBlocks) {
    // One page per block, each read with its own values, as the import reads it.
    const blocks = {};
    for (const { id } of recipeLocates(recipe)) {
      const block = recipe.valueBlocks.find((b) => b.id === id);
      const at = await findPage({ ...recipe, printedPage: block.printedPage, locate: block.locate }, pdf.numPages, (p) => pageItems(pdf, p));
      if (!at) { process.stdout.write(`MISS  ${key}.${id}\n`); continue; }
      blocks[id] = extractTable(at.items, { ...recipe, valueBlocks: null, emit: null, values: block.values, column: block.column ?? recipe.column, yMin: block.yMin ?? recipe.yMin, yMax: block.yMax ?? recipe.yMax });
    }
    process.stdout.write(`${key}: ${Object.keys(blocks).length} block(s)\n`);
    for (const [k, v] of Object.entries(blocks)) process.stdout.write(`      ${k}: ${JSON.stringify(v).slice(0, 500)}\n`);
    continue;
  }
  const found = await findPage(recipe, pdf.numPages, (p) => pageItems(pdf, p));
  if (!found) {
    process.stdout.write(`MISS  ${key}: no page contains "${recipe.locate}"\n`);
    continue;
  }
  let out;
  try {
    const span = [found.items];
    for (let k = 1; k < recipePages(recipe); k++) span.push((await pageItems(pdf, found.page + k)).items);
    out = extractPlain(recipePages(recipe) > 1 ? span : found.items, recipe);
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
    process.stdout.write(`      ${k}: ${String(text).slice(0, 600)}\n`);
  }
}
