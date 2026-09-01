/**
 * DEV-ONLY: harvest a book's own structured outline (pdf.js bookmarks) into a
 * "must-define" manifest — the SEED and the COVERAGE denominator for the
 * authoring swarm. The book's TOC/index is a term→page map: pointers, not prose
 * (IP-safe, lint-clean). Workers author against known targets instead of
 * discovering blind, and completeness becomes a ledger diff (every manifest
 * entry ends resolved or explicitly skipped).
 *
 * Requires the LOCAL-ONLY reference PDFs at C:\Proj\acks-reference.
 *
 * Usage:
 *   node tools/harvest-index.mjs mm            # summary + manifest to stdout
 *   node tools/harvest-index.mjs mm --write    # write recipedata/_index/_manifest/mm.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openBook } from "../../scripts/importer/extract.mjs";
import { FILES } from "./reference-lib.mjs";

// Classify a top-level chapter title into what its descendants seed.
function roleOf(topTitle) {
  const t = topTitle.toLowerCase();
  if (t.includes("listing")) return "entry";        // composite nodes (monsters)
  if (t.includes("list of tables")) return "table";
  if (t.includes("overview") || t.includes("rules") || t.includes("creation")) return "definition"; // descriptor candidates
  if (t.includes("index")) return "indexPage";
  return "other";
}

const [book, ...flags] = process.argv.slice(2);
const write = flags.includes("--write");
const file = FILES[book];
if (!file || !fs.existsSync(file)) {
  console.error(`no local PDF for book "${book}" (expected ${file})`);
  process.exit(2);
}

const { doc, numPages, title } = await openBook(fs.readFileSync(file));

async function pageOf(dest) {
  try {
    const d = typeof dest === "string" ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(d) || !d[0]) return null;
    return (await doc.getPageIndex(d[0])) + 1;
  } catch {
    return null;
  }
}

const outline = await doc.getOutline();
if (!outline) {
  console.error(`${book}: no structured outline — fall back to printed-index text harvest`);
  process.exit(1);
}

const entries = [];
async function walk(items, top, depth) {
  for (const it of items) {
    const page = await pageOf(it.dest);
    // Under a listings chapter, depth-1 nodes are composite entries (monsters);
    // deeper nodes are their book-authored sub-blocks (Combat/Ecology/Spoils).
    let role = roleOf(top);
    if (role === "entry" && depth >= 2) role = "block";
    entries.push({ title: it.title.trim(), page, role, section: top, depth });
    if (it.items?.length) await walk(it.items, top, depth + 1);
  }
}
for (const it of outline) {
  const page = await pageOf(it.dest);
  const top = it.title.trim();
  entries.push({ title: top, page, role: roleOf(top), section: top, depth: 0 });
  if (it.items?.length) await walk(it.items, top, 1);
}

const byRole = entries.reduce((m, e) => ((m[e.role] = (m[e.role] ?? 0) + 1), m), {});
const manifest = { book, title, numPages, generated: new Date().toISOString(), counts: byRole, entries };

if (write) {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const dir = path.join(HERE, "..", "..", "register", "_manifest");
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${book}.json`);
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
  console.error(`wrote ${entries.length} entries → ${out}`);
}
console.error(`${book} "${title}" ${numPages}pp — ${entries.length} outline entries: ${JSON.stringify(byRole)}`);
if (!write) process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
