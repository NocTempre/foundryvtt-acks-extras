/**
 * Build/refresh the fleet work-ledger (register/_ledger.json) — the manifest
 * the Opus orchestrator dispatches from and that lets the run survive context
 * summarization across waves. LOCAL-ONLY (gitignored): it's pipeline state, not
 * shipped content.
 *
 * A ledger batch = a contiguous page window handed to one Sonnet worker, which
 * writes register/<book>/p<start>-p<end>.json. Re-running reconciles status
 * against files already on disk (authored) so it is safe to re-run mid-project.
 *
 * Usage: node tools/ledger-init.mjs <book> <pageStart> <pageEnd> [batchSize=10]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LEDGER = path.join(HERE, "..", "..", "register", "_ledger.json");

const [book, s, e, bs] = process.argv.slice(2);
if (!book || !s || !e) {
  console.error("usage: node tools/ledger-init.mjs <book> <pageStart> <pageEnd> [batchSize=10]");
  process.exit(2);
}
const start = parseInt(s, 10);
const end = parseInt(e, 10);
const batchSize = bs ? parseInt(bs, 10) : 10;

const existing = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, "utf8")) : { batches: [] };
const byKey = new Map(existing.batches.map((b) => [`${b.book}:${b.start}`, b]));

const bookDir = path.join(HERE, "..", "..", "register", book);
const authored = (p0, p1) => fs.existsSync(path.join(bookDir, `p${p0}-p${p1}.json`));

const batches = [];
for (let p = start; p <= end; p += batchSize) {
  const p1 = Math.min(p + batchSize - 1, end);
  const key = `${book}:${p}`;
  const prev = byKey.get(key);
  const status = authored(p, p1) ? (prev?.status === "verified" ? "verified" : "authored") : (prev?.status ?? "pending");
  batches.push({ book, start: p, end: p1, file: `${book}/p${p}-p${p1}.json`, status });
}

// keep batches for other books untouched
const others = existing.batches.filter((b) => b.book !== book);
const ledger = { updated: new Date().toISOString(), batches: [...others, ...batches].sort((a, b) => a.book.localeCompare(b.book) || a.start - b.start) };
fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + "\n");

const counts = batches.reduce((m, b) => ((m[b.status] = (m[b.status] ?? 0) + 1), m), {});
console.log(`ledger: ${book} p${start}-p${end} in ${batches.length} batch(es) of ${batchSize} — ${JSON.stringify(counts)}`);
console.log(`  ${LEDGER}`);
