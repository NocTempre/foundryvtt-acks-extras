import fs from "node:fs";
import { openBook, pageItems } from "../../scripts/importer/extract.mjs";
import { FILES } from "./reference-lib.mjs";
const [book, lo, hi, ...needles] = process.argv.slice(2);
const { doc } = await openBook(fs.readFileSync(FILES[book]));
for (let p = Number(lo); p <= Number(hi); p++) {
  const { items } = await pageItems(doc, p);
  const joined = items.map((i) => i.str).join(" ");
  const hits = needles.filter((n) => joined.toLowerCase().includes(n.toLowerCase()));
  if (hits.length) process.stdout.write(`p${p}: ${hits.join(", ")}\n`);
}
