import fs from "node:fs";
import { openBook, pageItems } from "../../scripts/importer/extract.mjs";
import { FILES } from "./reference-lib.mjs";
const [book = "rr", pageArg = "140"] = process.argv.slice(2);
const { doc } = await openBook(fs.readFileSync(FILES[book]));
const { items } = await pageItems(doc, Number(pageArg));
items.sort((a, b) => a.y - b.y || a.x - b.x);
for (const it of items) process.stdout.write(`y=${it.y.toFixed(0).padStart(4)} x=${it.x.toFixed(0).padStart(4)}  ${JSON.stringify(it.str)}\n`);
process.stdout.write(`\n--- ${items.length} items on ${book} p${pageArg} ---\n`);
