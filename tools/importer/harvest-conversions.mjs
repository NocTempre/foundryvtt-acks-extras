/**
 * DEV-ONLY (chef-side): harvest the ACKS II System Compatibility Guide's
 * conversion tables into `register/_refs/conversion.json`.
 *
 * The guide needs NO recipe and no lazy prose — it is understood once, offline,
 * and only the CONCLUSION ships: a name -> name lookup with a status. That map
 * is what lets the pipeline understand an OGL/OSR term (or an older ACKS name)
 * well enough to redirect it at its ACKS II equivalent, even when a newer
 * monster/NPC recipe supersedes the original entry.
 *
 * Page shape: pairs of columns headed "OGL <category>" / "ACKS II <category>";
 * a page may carry two pairs side by side, and one pair may stack several
 * categories vertically. Headings AND cells are split across runs (small-caps
 * sets the first letter separately: "a"+"nkheg"), so columns are derived from
 * the x-origins of the data rows rather than from the header text.
 *
 * A right-hand cell may read "Not present in ACKS II" (omitted, may return) or
 * "Deleted from ACKS II" (deliberately removed).
 *
 * Requires the LOCAL-ONLY reference PDF. Usage:
 *   node tools/harvest-conversions.mjs [--write]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openBook, pageItems } from "../../scripts/importer/extract.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE =
  "C:\\Proj\\acks-reference\\ACKSII\\ACKSII_System_Compatibility_Guide_FINAL_r4_2nd_Printing.pdf";
const OUT = path.join(HERE, "..", "..", "register", "_refs", "conversion.json");
const PAGES = [8, 9, 10, 11, 12];
const CATEGORIES = ["attribute", "class", "monster", "spell", "magicitem"];

const norm = (s) => s.replace(/\s+/g, " ").trim();
const squash = (s) => norm(s).toLowerCase().replace(/[^a-z]/g, "");

/** Group a page's items into rows by baseline. */
function rowsOf(items, tol = 3) {
  const rows = [];
  for (const it of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= tol);
    if (row) row.items.push(it);
    else rows.push({ y: it.y, items: [it] });
  }
  return rows;
}

/** Column starts from the x-origins of table rows (>=30pt apart). */
function columnStarts(items) {
  const xs = [...items].map((i) => i.x).sort((a, b) => a - b);
  const starts = [];
  for (const x of xs) if (!starts.length || x - starts[starts.length - 1] > 30) starts.push(x);
  return starts;
}

const rows = [];
const { doc } = await openBook(fs.readFileSync(FILE));
for (const p of PAGES) {
  const { items, width } = await pageItems(doc, p);
  // Table region: everything below the first "OGL <category>" heading.
  const all = rowsOf(items.filter((it) => it.h < 12 && it.y > 60));
  const headerRows = all.filter((r) => /^ogl/.test(squash(r.items.map((i) => i.str).join(""))));
  if (!headerRows.length) continue;
  // Column boundaries come from the HEADING row: its cells are compact and well
  // separated, whereas long data names split across runs and would place a
  // boundary mid-word ("blackp" | "udding").
  const heads = headerRows.sort((a, b) => a.y - b.y);
  for (let hi = 0; hi < heads.length; hi++) {
    const head = heads[hi];
    const category = CATEGORIES.find((c) => squash(head.items.map((i) => i.str).join("")).includes(c));
    if (!category) continue;
    // KNOWN GAP: the magic-item table (p10 bottom - p11) uses narrow columns and
    // wraps cells across lines, and its own heading splits across column groups,
    // so heading-derived boundaries shear the rows ("decanter ofe" | "ndless
    // Water"). Skipped deliberately until a wrapped-cell pass exists — a wrong
    // mapping would be worse than a missing one.
    if (category === "magicitem") continue;
    const starts = columnStarts(head.items);
    if (starts.length < 2) continue;
    const yTo = heads[hi + 1]?.y ?? Infinity;
    const dataRows = all.filter((r) => r.y > head.y + 4 && r.y < yTo - 4);
    for (let i = 0; i + 1 < starts.length; i += 2) {
      const x0 = starts[i];
      const x1 = starts[i + 1];
      const xEnd = starts[i + 2] ?? width;
      for (const r of dataRows) {
        const pick = (lo, hi2) =>
          norm(r.items.filter((it) => it.x >= lo - 2 && it.x < hi2 - 4).sort((a, b) => a.x - b.x).map((it) => it.str).join(""));
        const from = pick(x0, x1);
        const to = pick(x1, xEnd);
        if (!from || !to || from.length > 58 || to.length > 58) continue;
        // Sanity guard. Narrow/wrapped tables (the magic-item pages) can shear a
        // row so the status text or the running head lands in the wrong cell —
        // a wrong mapping is worse than a missing one, so drop anything that
        // does not look like a clean name -> name pair.
        if (/^(deleted|not\s*present)/i.test(from)) continue; // status leaked left
        if (/ACKS\s*II|Compat|^Stem\b/i.test(from)) continue; // furniture leaked left
        if (/Compat|^Stem\b/i.test(to)) continue;
        if (!/[A-Za-z]{3}/.test(from)) continue;
        const status = /not\s*present/i.test(to) ? "absent" : /deleted\s*from/i.test(to) ? "deleted" : "renamed";
        if (status === "renamed" && (!/[A-Za-z]{3}/.test(to) || /ACKS\s*II/i.test(to))) continue;
        rows.push({ from, to, category, status });
      }
    }
  }
}

// Dedup on category+name (the same name can appear under two categories).
const seen = new Set();
const table = {};
for (const r of rows) {
  const key = `${r.category}|${r.from.toLowerCase()}`;
  if (seen.has(key)) continue;
  seen.add(key);
  table[r.from] = { category: r.category, status: r.status, ...(r.status === "renamed" ? { to: r.to } : {}) };
}

const byCat = rows.reduce((m, r) => ((m[r.category] = (m[r.category] ?? 0) + 1), m), {});
const byStatus = rows.reduce((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});
console.error(`conversions: ${Object.keys(table).length} unique — ${JSON.stringify(byCat)} ${JSON.stringify(byStatus)}`);

if (process.argv.includes("--write")) {
  fs.writeFileSync(
    OUT,
    JSON.stringify(
      {
        registry: "conversion",
        shape: "table",
        note: "OGL/OSR name -> ACKS II name, harvested offline from the System Compatibility Guide (tools/harvest-conversions.mjs). The guide is understood once by the chefs; only the conclusion ships. status: renamed | absent (omitted, may return) | deleted (deliberately removed). Lets a legacy or foreign token be redirected at its ACKS II equivalent.",
        table,
      },
      null,
      2,
    ) + "\n",
  );
  console.error(`wrote ${OUT}`);
} else {
  const sample = Object.entries(table).slice(0, 14);
  for (const [k, v] of sample) console.log(`  ${k}  ->  ${v.to ?? v.status}   [${v.category}/${v.status}]`);
}
