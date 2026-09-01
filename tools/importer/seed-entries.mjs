/**
 * Seed register entries from a book's outline manifest (the mechanical bulk of
 * authoring): every depth-1 entry under the listings chapter becomes a
 * composite row. Idempotent upsert — ids already present anywhere in the
 * register are left untouched, so hand-fixed entries survive re-seeding.
 * The failure tail (variants, multi-page monsters, odd anchors) is surfaced by
 * compile/verify afterwards and fixed by judgment, per the pipeline design.
 *
 * Usage: node tools/seed-entries.mjs mm [--write]
 *   without --write: prints the would-be entries summary only.
 * Output file: register/<book>/p<min>-p<max>.json (seeded rows only).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REGISTER = path.join(HERE, "..", "..", "register");

const [book, ...flags] = process.argv.slice(2);
const write = flags.includes("--write");
if (!book) {
  console.error("usage: node tools/seed-entries.mjs <book> [--write]");
  process.exit(2);
}

const manifestPath = path.join(REGISTER, "_manifest", `${book}.json`);
if (!fs.existsSync(manifestPath)) {
  console.error(`no manifest — run: npm run harvest:index -- ${book} --write`);
  process.exit(2);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

// Existing ids across the whole register for this book (idempotency).
const existing = new Set();
const bookDir = path.join(REGISTER, book);
if (fs.existsSync(bookDir)) {
  for (const f of fs.readdirSync(bookDir)) {
    if (!f.endsWith(".json")) continue;
    for (const e of JSON.parse(fs.readFileSync(path.join(bookDir, f), "utf8"))) existing.add(e.id);
  }
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const camel = (s) =>
  s.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean)
    .map((w, i) => (i ? cap(w.toLowerCase()) : w.toLowerCase())).join("");

// Composite candidates: depth-1 rows of the listings chapter with a real page.
const rows = manifest.entries.filter(
  (e) => e.role === "entry" && e.depth === 1 && /listing/i.test(e.section) && Number.isInteger(e.page),
);

const seen = new Set(existing);
const out = [];
let skippedExisting = 0;
for (const r of rows) {
  let slug = camel(r.title);
  let id = `${book}.${slug}`;
  if (existing.has(id)) {
    skippedExisting++;
    continue;
  }
  let n = 2;
  while (seen.has(id)) id = `${book}.${slug}${n++}`;
  seen.add(id);
  out.push({
    id,
    kind: "kind.monster",
    book,
    pages: [r.page],
    name: r.title,
    anchor: { display: r.title },
  });
}

out.sort((a, b) => a.pages[0] - b.pages[0] || a.id.localeCompare(b.id));
const pMin = out[0]?.pages[0];
const pMax = out[out.length - 1]?.pages[0];
console.error(`${book}: ${rows.length} manifest monsters -> ${out.length} new rows (${skippedExisting} already registered), pages ${pMin}-${pMax}`);

if (write && out.length) {
  const file = path.join(bookDir, `p${pMin}-p${pMax}.json`);
  if (fs.existsSync(file)) {
    console.error(`refusing to overwrite existing ${file}`);
    process.exit(1);
  }
  fs.mkdirSync(bookDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  console.error(`wrote ${file}`);
} else if (!write) {
  console.error(out.slice(0, 8).map((e) => `  ${e.id} p${e.pages[0]} "${e.name}"`).join("\n"));
}
