/**
 * DEV-ONLY: dump the FULL executor output (raw extract JSON) for cookbook
 * entries — the inspection surface for QA (humans and agents). Unlike
 * verify-cookbook's one-line summaries, this prints everything the dumb
 * executor produced from the reference PDF: every stat field (including
 * stats._raw.*), attack segments with quality, spoils parse, description
 * paragraphs, misses. LOCAL-ONLY (reads the reference library); output is for
 * defect triage, never shipped.
 *
 * Usage:
 *   node tools/dump-entry.mjs mm.griffon [mm.hag ...]   # specific ids
 *   node tools/dump-entry.mjs --pages mm 50 64          # every entry in range
 *   add --no-art to skip slow art extraction
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openBook } from "../../scripts/importer/extract.mjs";
import { executeEntry } from "../../scripts/importer/executor.mjs";
import { FILES } from "./reference-lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COOKBOOK = path.join(HERE, "..", "..", "cookbook");

const args = process.argv.slice(2).filter((a) => a !== "--no-art");
const skipOps = process.argv.includes("--no-art") ? ["art"] : undefined;

const registers = JSON.parse(fs.readFileSync(path.join(COOKBOOK, "registers.json"), "utf8"));
const books = new Map();
for (const f of fs.readdirSync(COOKBOOK)) {
  if (f.endsWith(".json") && f !== "registers.json") {
    const cb = JSON.parse(fs.readFileSync(path.join(COOKBOOK, f), "utf8"));
    if (cb.book?.id) books.set(cb.book.id, cb); // content-type cookbooks have no book
  }
}

let ids = [];
if (args[0] === "--pages") {
  const [, bookId, a, b] = args;
  const cb = books.get(bookId);
  const lo = parseInt(a, 10);
  const hi = parseInt(b ?? a, 10);
  ids = Object.entries(cb.entries)
    .filter(([, e]) => e.pages[0] >= lo && e.pages[0] <= hi)
    .sort((x, y) => x[1].pages[0] - y[1].pages[0])
    .map(([id]) => id);
} else {
  ids = args;
}
if (!ids.length) {
  console.error("usage: node tools/dump-entry.mjs <id...> | --pages <book> <a> [b]  [--no-art]");
  process.exit(2);
}

const docs = new Map();
async function docFor(bookId) {
  if (!docs.has(bookId)) {
    const { doc } = await openBook(fs.readFileSync(FILES[bookId]));
    docs.set(bookId, doc);
  }
  return docs.get(bookId);
}

const pageCache = new Map();
for (const id of ids) {
  const bookId = id.split(".")[0];
  const cb = books.get(bookId);
  if (!cb?.entries[id]) {
    console.log(`\n===== ${id}: NOT IN COOKBOOK =====`);
    continue;
  }
  const doc = await docFor(bookId);
  const res = await executeEntry(doc, cb, registers, id, { pageCache, skipOps });
  console.log(`\n===== ${id} — ${res.name} (${res.cite}) pages=${JSON.stringify(cb.entries[id].pages)} ok=${res.ok} =====`);
  const f = res.fields;
  console.log(`expect: ${JSON.stringify(f.name)}`);
  console.log(`stats:`);
  for (const [k, v] of Object.entries(f.stats ?? {})) console.log(`  ${k}: ${JSON.stringify(v)}`);
  if (f.attacks) {
    console.log(`attacks: text=${JSON.stringify(f.attacks.text)} throw=${f.attacks.throw} alternatives=${f.attacks.alternatives}`);
    (f.attacks.modes ?? []).forEach((m, mi) => {
      console.log(`  mode ${mi} (count=${m.count} throw=${m.throw}):`);
      for (const s of m.segments) console.log(`    ${JSON.stringify(s)}`);
    });
  }
  console.log(`defenses: ${JSON.stringify(f.defenses ?? null)}`);
  console.log(`spoils: ${JSON.stringify(f.spoils ?? null)}`);
  console.log(`art: ${JSON.stringify(f.art ?? null)}`);
  for (const [g, out] of Object.entries(f.grids ?? {})) {
    console.log(`grid ${g}: ${out ? out.rows.length + " row(s)" : "null"}`);
    for (const r of out?.rows ?? []) console.log(`  [${r.key}] ${JSON.stringify(r.cells).slice(0, 220)}`);
  }
  console.log(`description (${(f.description ?? []).length} paras):`);
  (f.description ?? []).forEach((p, i) => console.log(`  [${i}] ${p.text}`));
  if (res.misses.length) console.log(`misses: ${JSON.stringify(res.misses)}`);
}
process.exit(0);
