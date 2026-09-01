/** LOCAL-ONLY: the hit-point recipe vs the real RR PDF. Skips without the ref lib. */
import assert from "node:assert";
import fs from "node:fs";
import { openBook, pageItems } from "../../scripts/importer/extract.mjs";
import { extractTable, findPage } from "../../scripts/importer/table-extract.mjs";
import { TABLE_RECIPES } from "../../scripts/importer/table-recipes.mjs";
import { FILES, referenceComplete } from "./reference-lib.mjs";

if (!referenceComplete()) {
  console.log("test-hitpoint-tables: reference PDFs absent — skipped.");
  process.exit(0);
}

const { doc } = await openBook(fs.readFileSync(FILES.rr));
const readPage = (p) => pageItems(doc, p);
const recipe = TABLE_RECIPES.hitPoints.tables.firstLevel;

const found = await findPage({ ...recipe, searchRadius: 4 }, doc.numPages, readPage);

let pass = 0;
const check = (label, cond) => {
  assert.ok(cond, label);
  pass++;
};

// A null find means the locate no longer matches this printing — the failure
// mode that otherwise presents as "the floor quietly stopped applying".
check("the hit-points section is located", !!found);

const raw = extractTable(found.items, recipe);

// The VALUE is the reader's book's business and is never asserted here: what
// this proves is that the anchor still lands on a number, which is the half
// that can rot when a printing moves. acks-extras asserts the arithmetic
// against its own invented fixture.
check("the first-level die minimum reads as a whole number", Number.isInteger(raw.dieMinimum));
check("the die minimum is a floor a die could carry", raw.dieMinimum > 0 && raw.dieMinimum <= 20);

console.log(`test-hitpoint-tables: ${pass} checks passed.`);
