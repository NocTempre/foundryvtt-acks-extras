/**
 * Merge chef-authored recipe proposals into the register — after re-verifying
 * each one against the reference PDFs with the SHIPPING executor.
 *
 * A chef reports that its locators work. This does not take its word for it:
 * every recipe is executed here, and one that does not materialize what it
 * claims is REJECTED rather than merged. That is the whole point of a merge
 * gate — the tier below can be wrong, and its output must fail loudly instead
 * of landing quietly in shipped data.
 *
 * Nothing here sets `audited`. Merging a recipe makes an entry CORRECT;
 * signing it off is a separate human/senior act after reading the result.
 *
 * Usage: node tools/merge-recipes.mjs <book> <recipeFile> [--apply]
 *        (default is a dry run: report what would merge and what fails)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openBook, pageItems } from "../../scripts/importer/extract.mjs";
import { materializeRolls, materializeEffects, effectScan } from "../../scripts/importer/executor.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = "C:\\Proj\\acks-reference\\ACKSII";
const FILES = {
  rr: `${LIB}\\ACKSII_Revised_Rulebook_DIGITAL_FINAL_r10_2nd_Printing.pdf`,
  jj: `${LIB}\\ACKSII_Judges_Journal_DIGITAL_FINAL_r9_2nd_Printing.pdf`,
  mm: `${LIB}\\ACKSII_Monstrous_Manual_DIGITAL_FINAL_r7_2nd_Printing.pdf`,
};

const [book, recipeFile, ...flags] = process.argv.slice(2);
const apply = flags.includes("--apply");
if (!book || !recipeFile || !FILES[book]) {
  console.error("usage: node tools/merge-recipes.mjs <rr|jj|mm> <recipeFile> [--apply]");
  process.exit(1);
}

const REG = path.join(HERE, "..", "..", "register", book);
const COOKBOOK = path.join(HERE, "..", "..", "cookbook");
const recipes = JSON.parse(fs.readFileSync(recipeFile, "utf8"));

/** Every register row of this book, indexed by id, with its source file. */
const rows = new Map();
for (const f of fs.readdirSync(REG)) {
  const p = path.join(REG, f);
  for (const row of JSON.parse(fs.readFileSync(p, "utf8"))) rows.set(row.id, { row, file: p });
}

/** The compiled entry's extracted description, for locator verification. */
const cookbooks = fs
  .readdirSync(COOKBOOK)
  .filter((f) => f.endsWith(".json") && !["registers.json", "index.json"].includes(f))
  .map((f) => JSON.parse(fs.readFileSync(path.join(COOKBOOK, f), "utf8")));

async function main() {
  const { doc } = await openBook(fs.readFileSync(FILES[book]));
  const registers = JSON.parse(fs.readFileSync(path.join(COOKBOOK, "registers.json"), "utf8"));
  const { executeEntry } = await import("../../scripts/importer/executor.mjs");

  let merged = 0;
  let rejected = 0;
  let review = 0;
  const touched = new Set();

  for (const rec of recipes) {
    const { id, recipe, verified, confidence, gaps } = rec ?? {};
    const found = rows.get(id);
    if (!found) {
      console.log(`SKIP  ${id}: no register row`);
      rejected++;
      continue;
    }
    if (!recipe || !Object.keys(recipe).length) {
      console.log(`NONE  ${id}: no recipe proposed${gaps?.length ? ` (gaps: ${gaps.length})` : ""}`);
      continue;
    }

    // Re-execute the entry to get THIS SEAT's description, then run the
    // proposed locators against it exactly as the runtime would. The
    // progression rides along for `target.fromProgression` rolls — the gate
    // must offer a spec exactly what the runtime offers it, or a roll the
    // runtime materializes reads here as an unresolved locator.
    const cb = cookbooks.find((c) => c.entries?.[id]);
    let paras = [];
    let progression = null;
    if (cb) {
      const res = await executeEntry(doc, cb, registers, id);
      paras = res?.fields?.description ?? [];
      progression = res?.fields?.progression ?? null;
    }
    const problems = [];
    if (!paras.length) problems.push("no description extracted to verify against");

    if (recipe.rolls?.length) {
      const got = materializeRolls(recipe.rolls, paras, { progression });
      if (got.length !== recipe.rolls.length) {
        problems.push(`rolls: ${recipe.rolls.length} authored, ${got.length} materialized`);
      }
      for (const r of got) {
        if (r.target?.kind === "conditional" && !r.target.breakpoints?.length) problems.push(`roll ${r.key}: empty ladder`);
      }
    }
    if (recipe.effects?.length) {
      const got = materializeEffects(recipe.effects, paras);
      // `materializeEffects` is all-or-nothing per spec — a locator that does
      // not match drops its whole effect — so a short count IS an unresolved
      // locator, and it catches every locator rather than a privileged one.
      //
      // The previous check counted materialized effects with `value != null`
      // against authored effects with `from.pattern`. Both halves were wrong.
      // It missed array-form `from: [...]` entirely, and it rejected any recipe
      // whose locator fills a field OTHER than `value` through `from.into`
      // (`range`, `amount`, `times`, …) even when the effect had materialized
      // perfectly — a false rejection that blocked every `into`-based recipe in
      // the pipeline. Caught by a chef whose Shadowy Senses recipe materialized
      // 6/6 effects with `range: 30` read off the page and was rejected anyway.
      if (got.length !== recipe.effects.length) {
        problems.push(
          `effects: ${recipe.effects.length} authored, ${got.length} materialized (a locator did not match)`,
        );
      }
      // Authored effects REPLACE the scan, so the recipe must cover the whole
      // entry. Anything the scan was carrying that the recipe drops is a
      // regression, not a correction — surface the shortfall for review rather
      // than silently shipping fewer mechanics than before.
      const scanned = effectScan(paras, registers);
      if (scanned.length > got.length) {
        console.log(
          `      note ${id}: scan had ${scanned.length} effect(s), recipe authors ${got.length}` +
            ` — confirm the recipe is complete (it replaces the scan): ${scanned.map((e) => `${e.type}/${e.target ?? ""}`).join(", ")}`,
        );
      }
    }

    if (problems.length) {
      console.log(`FAIL  ${id}: ${problems.join("; ")}`);
      rejected++;
      continue;
    }

    const tag = confidence === "needs-review" ? "REVIEW" : "OK    ";
    if (confidence === "needs-review") review++;
    console.log(`${tag} ${id}: ${(verified ?? []).length} verified claim(s)${gaps?.length ? `, ${gaps.length} gap(s)` : ""}`);

    if (apply) {
      for (const key of ["rolls", "effects", "assists", "meta"]) {
        if (!recipe[key]) continue;
        found.row[key] = key === "meta" || key === "assists" ? { ...(found.row[key] ?? {}), ...recipe[key] } : recipe[key];
      }
      touched.add(found.file);
      merged++;
    }
  }

  if (apply) {
    for (const file of touched) {
      const list = [...rows.values()].filter((v) => v.file === file).map((v) => v.row);
      fs.writeFileSync(file, JSON.stringify(list, null, 2) + "\n");
    }
  }
  console.log(
    `\n${apply ? "merged" : "would merge"}: ${apply ? merged : recipes.length - rejected}  rejected: ${rejected}  needs-review: ${review}`,
  );
  if (!apply) console.log("(dry run — pass --apply to write)");
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
