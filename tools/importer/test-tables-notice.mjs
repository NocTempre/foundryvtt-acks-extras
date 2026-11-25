/**
 * The notice a rules-table import posts. One string serves every document the
 * import read (treasure, the magic-item lists, market and hiring tables alike),
 * so it says what was imported and names no feature that reads it: a feature
 * named there is false for every document that feature does not read.
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";

let pass = 0;
const check = (label, cond) => {
  assert.ok(cond, label);
  pass++;
};

const KEY = "ACKS-IMPORTER.tables.imported";
const lang = JSON.parse(readFileSync(new URL("../../lang/en.json", import.meta.url), "utf8"));
const text = lang[KEY] ?? "";
check("the import notice's lang string exists", text.length > 0);

// The consumer's format call, read from source: the placeholders it passes are the ones the string may use.
const src = readFileSync(new URL("../../scripts/importer/module.mjs", import.meta.url), "utf8");
const call = /\.tables\.imported`,\s*\{([\s\S]*?)\}\s*\)/.exec(src);
check("the import notice is formatted in the importer's cookbookImportTables", !!call);
const passed = [...call[1].matchAll(/^\s*(\w+)\s*:/gm)].map((m) => m[1]).sort();
const used = [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
check("the string uses exactly the placeholders the call passes", JSON.stringify(used) === JSON.stringify(passed));

// Nothing follows the documents it names but the sentence's stop.
check("the notice ends at the documents it names: no feature is claimed after them", /\(\{docs\}\)\.$/.test(text));

console.log(`test-tables-notice: ${pass} checks passed`);
