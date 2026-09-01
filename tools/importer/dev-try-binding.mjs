/**
 * DEV-ONLY: run a recipe against the real book AND pass it through its binder.
 *
 * `dev-try-recipe` answers "did my window land where I meant it to".  This
 * answers the next question — "does the binder read what the window caught" —
 * which is where the sentence patterns either match the page's actual wording
 * or quietly return null.
 *
 * IP posture, same as its siblings: a diagnostic for the authoring agent,
 * never shipped. It prints assembled FIGURES, which are printed values: they
 * must not be pasted into a repo, a commit message, a test or a recipe.
 *
 * Usage: node tools/dev-try-binding.mjs <docId>
 */
import fs from "node:fs";
import { openBook, pageItems } from "../../scripts/importer/extract.mjs";
import { findPage, extractTable } from "../../scripts/importer/table-extract.mjs";
import { TABLE_RECIPES } from "../../scripts/importer/table-recipes.mjs";
import { FILES } from "./reference-lib.mjs";

/** Which assembler belongs to which document. */
const BINDERS = {
  survival: () => import("../../scripts/importer/survival-binding.mjs").then((m) => m.assembleSurvivalTables),
  foraging: () => import("../../scripts/importer/foraging-binding.mjs").then((m) => m.assembleForagingTables),
  searching: () => import("../../scripts/importer/searching-binding.mjs").then((m) => m.assembleSearchingTables),
  cityTravel: () => import("../../scripts/importer/city-travel-binding.mjs").then((m) => m.assembleCityTravelTables),
  flight: () => import("../../scripts/importer/flight-binding.mjs").then((m) => m.assembleFlightTables),
};

const [docId] = process.argv.slice(2);
const doc = TABLE_RECIPES[docId];
if (!doc) {
  process.stdout.write(`no recipe "${docId}". Known: ${Object.keys(TABLE_RECIPES).join(", ")}\n`);
  process.exit(1);
}
if (!BINDERS[docId]) {
  process.stdout.write(`no binder registered for "${docId}". Known: ${Object.keys(BINDERS).join(", ")}\n`);
  process.exit(1);
}

const books = new Map();
async function bookFor(id) {
  if (!books.has(id)) books.set(id, await openBook(fs.readFileSync(FILES[id])));
  return books.get(id);
}

const raw = {};
for (const [key, recipe] of Object.entries(doc.tables ?? {})) {
  const { doc: pdf } = await bookFor(recipe.book);
  const found = await findPage(recipe, pdf.numPages, (p) => pageItems(pdf, p));
  if (!found) { process.stdout.write(`MISS  ${key}: page not found\n`); continue; }
  try {
    raw[key] = extractTable(found.items, recipe);
  } catch (err) {
    process.stdout.write(`ERR   ${key}: ${err.message}\n`);
  }
}

const assemble = await BINDERS[docId]();
const engine = assemble(raw);

process.stdout.write(`\nassembled ${Object.keys(engine).length} engine table(s) for "${docId}":\n`);
for (const [key, value] of Object.entries(engine)) {
  process.stdout.write(`  ${key}: ${JSON.stringify(value)}\n`);
}
const rawKeys = Object.keys(raw);
if (!Object.keys(engine).length && rawKeys.length) {
  process.stdout.write(`  (raw read ${rawKeys.join(", ")} — the binder matched none of it)\n`);
}
