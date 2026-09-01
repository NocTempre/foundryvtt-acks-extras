/**
 * Does every definition's description actually come from where its heading is?
 *
 * A definition's prose is printed under its own heading, so the first paragraph
 * of the block must lie in the column the anchor starts. When it does not, the
 * entry is reading whatever else prints at those coordinates: BTA p95 sets Coat,
 * Tunic and Pants and Turban beside a price list, column detection voted for the
 * list's edges, and all three shipped a column of price digits as their
 * description. Nothing said a word — the recipe was well-formed, the executor
 * found text, and the text was wrong.
 *
 * The test is one comparison per entry and needs no PDF, so it runs everywhere
 * the cookbook does. A page detection cannot read is fixed by authoring
 * `assists.columns` on the entry, which states the geometry the histogram could
 * not find; this is the check that says which entries need it.
 *
 * Two shapes are legitimately elsewhere and are not asked the question:
 *
 *  - A MONSTER prints its description beside its stat block, not beneath its
 *    name, so its prose is in the other column by design. Definitions compile
 *    into content-type cookbooks and monsters into book-keyed ones, which is
 *    the compiler's own split and so the one to read.
 *  - An ALIAS borrows its target's passage while keeping its own name probe. In
 *    the same book the two are different places on purpose, and comparing them
 *    measures the alias, not the extraction.
 *
 * Usage: node tools/check-prose-boxes.mjs   (also runs via `npm run validate`)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COOKBOOK = path.join(HERE, "..", "..", "cookbook");

if (!fs.existsSync(COOKBOOK)) {
  console.log("prose boxes: SKIPPED — no cookbook/ to read.");
  process.exit(0);
}

/** Paragraph boxes are tightened to their content, so the anchor may sit a few points left of one. */
const SLACK = 6;

const bad = [];
let checked = 0;
for (const f of fs.readdirSync(COOKBOOK).sort()) {
  if (!f.endsWith(".json") || f === "index.json" || f === "registers.json") continue;
  const cb = JSON.parse(fs.readFileSync(path.join(COOKBOOK, f), "utf8"));
  if (!cb.content) continue; // book-keyed cookbook: monsters, not definitions
  for (const [id, e] of Object.entries(cb.entries ?? {})) {
    if (e.aliasOf) continue;
    const name = e.fields?.name;
    const first = e.fields?.description?.paras?.[0];
    // A description read from another page is a continuation or a stat-block
    // neighbour; only same-page prose is under its own heading.
    if (name?.op !== "expect" || !first || e.fields.description.page !== name.page) continue;
    checked++;
    const x = name.box.x0;
    if (x < first.box.x0 - SLACK || x > first.box.x1) {
      bad.push(`${id} (${e.book} p.${name.page}): anchor at x=${x.toFixed(0)}, first paragraph x=${first.box.x0.toFixed(0)}..${first.box.x1.toFixed(0)}`);
    }
  }
}

for (const b of bad) console.error(`prose boxes: ${b}`);
if (bad.length) {
  console.error(`prose boxes: FAILED — ${bad.length} of ${checked} definitions read from outside their own column.`);
  console.error(`prose boxes: author "assists": { "columns": [...] } on each, with the page's true column lefts.`);
  process.exit(1);
}
console.log(`prose boxes: OK — ${checked} definitions read from their own column.`);
