/**
 * Register promotion from a verify report — the reuse-check -> link-or-promote
 * loop run in bulk, with the orchestrator/resolver reviewing the output.
 *
 * Reads "promotion candidates" lines from a verify report and upserts rows
 * into register/_refs/** under per-registry policies:
 *   proficiency            -> { key: camel(token) }        (open; refs filled later)
 *   subtype/alignment/size -> keyword row (lowercase key)
 *   magicProperty          -> keyword row unless junk (extraction artifacts)
 *   creatureType           -> compound rows ONLY when every word matches an
 *                             existing base token ({ keys:[..], refs:[..] });
 *                             anything else is REFUSED for review
 *   damageGlyph/damageColor-> never touched
 * Idempotent: existing tokens (case-insensitive) are left alone.
 *
 * Usage: node tools/promote-candidates.mjs <verify-report.txt> [--write]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REFS = path.join(HERE, "..", "..", "register", "_refs");

const [report, ...flags] = process.argv.slice(2);
const write = flags.includes("--write");
if (!report) {
  console.error("usage: node tools/promote-candidates.mjs <verify-report.txt> [--write]");
  process.exit(2);
}

const lines = fs.readFileSync(report, "utf8").split(/\r?\n/);
const cands = [];
for (const l of lines) {
  const m = /^\s{2}([A-Za-z]+):(.+?) x(\d+)$/.exec(l);
  if (m) cands.push({ registry: m[1], token: m[2].trim(), n: parseInt(m[3], 10) });
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const camel = (s) =>
  s.replace(/[^A-Za-z0-9 +’']/g, " ").split(/\s+/).filter(Boolean)
    .map((w, i) => (i ? cap(w.toLowerCase()) : w.toLowerCase())).join("").replace(/\+/g, "Plus");

// Extraction artifacts, not vocabulary: UNBALANCED parens (comma-split inside
// a paren), prices, weights, leading digits. Balanced parens are legitimate
// ACKS vocabulary ("Combat Trickery (Wrestling)", "energy protection (fire)").
const balanced = (t) => {
  let d = 0;
  for (const ch of t) {
    if (ch === "(") d++;
    else if (ch === ")") d--;
    if (d < 0) return false;
  }
  return d === 0;
};
const isJunk = (t) =>
  !balanced(t) || /^[\d(]/.test(t) || /\d+\s*gp/.test(t) || /\d\/\d/.test(t) || /\bst\.?,?$/.test(t) || t.length > 45;

const loadReg = (name) => {
  const p = path.join(REFS, `${name}.json`);
  return fs.existsSync(p) ? { p, data: JSON.parse(fs.readFileSync(p, "utf8")) } : null;
};

const byReg = new Map();
for (const c of cands) (byReg.get(c.registry) ?? byReg.set(c.registry, []).get(c.registry)).push(c);

const summary = [];
const refused = [];

for (const [registry, list] of byReg) {
  if (["damageGlyph", "damageColor"].includes(registry)) {
    refused.push(...list.map((c) => `${registry}:${c.token} (protected registry)`));
    continue;
  }
  const reg = loadReg(registry);
  if (!reg) {
    refused.push(...list.map((c) => `${registry}:${c.token} (no such register)`));
    continue;
  }
  const tokens = reg.data.tokens ?? (reg.data.tokens = {});
  const lower = new Map(Object.keys(tokens).map((t) => [t.toLowerCase(), t]));
  let added = 0;

  for (const c of list) {
    // Reuse-check is EXACT: the runtime table is exact-match, so a case
    // variant ("small" vs "Small" — smallcaps surface forms) needs its own
    // row, sharing the canonical key of the existing variant.
    if (tokens[c.token]) continue;
    const variant = lower.get(c.token.toLowerCase());
    if (variant) {
      tokens[c.token] = { ...tokens[variant] };
      lower.set(c.token.toLowerCase(), c.token);
      added++;
      continue;
    }
    if (registry === "creatureType") {
      // Compound only: every word must resolve through an existing base token.
      const words = c.token.split(/\s+/);
      const rows = words.map((w) => tokens[lower.get(w.toLowerCase())]);
      if (words.length >= 2 && rows.every((r) => r?.key)) {
        tokens[c.token] = { keys: rows.map((r) => r.key), refs: rows.map((r) => r.ref).filter(Boolean) };
        lower.set(c.token.toLowerCase(), c.token);
        added++;
      } else {
        refused.push(`creatureType:${c.token} (not a known-word compound — review)`);
      }
      continue;
    }
    if (isJunk(c.token)) {
      refused.push(`${registry}:${c.token} (junk artifact — fix at source)`);
      continue;
    }
    tokens[c.token] = { key: camel(c.token) };
    lower.set(c.token.toLowerCase(), c.token);
    added++;
  }
  if (added && write) fs.writeFileSync(reg.p, JSON.stringify(reg.data, null, 2) + "\n");
  summary.push(`${registry}: +${added} row(s)${write ? " written" : " (dry-run)"}`);
}

console.log(summary.join("\n"));
if (refused.length) {
  console.log(`\nREFUSED (${refused.length}) — resolver review:`);
  for (const r of refused) console.log(`  ${r}`);
}
