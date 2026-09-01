/**
 * Audit-package builder for the tiered audit workflow (docs/importer/RECIPES.md, "The
 * audit gate"). For each requested ability entry it executes the compiled
 * cookbook through the SHIPPING executor against the local reference PDFs and
 * writes one package per entry: the full materialized output next to the
 * printed page text, so a first-pass auditor can compare them without any
 * other tooling.
 *
 * The packages contain licensed book text. They are written OUTSIDE the repo
 * (the out dir is required and must not be inside it) and are never committed
 * — same rule as every other authoring-side dump. Requires
 * C:\Proj\acks-reference; never CI.
 *
 * Usage: node tools/audit-dump.mjs <book> <outDir> [id ...]
 *        (no ids: every ability entry of that book, unaudited first)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openBook, pageItems, detectColumns, colOf } from "../../scripts/importer/extract.mjs";
import { executeEntry } from "../../scripts/importer/executor.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COOKBOOK = path.join(HERE, "..", "..", "cookbook");
import { FILES } from "./reference-lib.mjs";

const [bookArg, outDirArg, ...idArgs] = process.argv.slice(2);
if (!bookArg || !outDirArg || !FILES[bookArg]) {
  console.error(`usage: node tools/audit-dump.mjs <${Object.keys(FILES).join("|")}> <outDir> [id ...]`);
  process.exit(1);
}
const outDir = path.resolve(outDirArg);
const repoRoot = path.resolve(HERE, "..", "..");
if (outDir.startsWith(repoRoot + path.sep)) {
  console.error(`refusing: out dir ${outDir} is inside the repo — packages carry book text and must never be committable`);
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

const registers = JSON.parse(fs.readFileSync(path.join(COOKBOOK, "registers.json"), "utf8"));
const books = fs
  .readdirSync(COOKBOOK)
  .filter((f) => f.endsWith(".json") && !["registers.json", "index.json"].includes(f))
  .map((f) => JSON.parse(fs.readFileSync(path.join(COOKBOOK, f), "utf8")));

/** id -> [cookbook data, entry] across every content file. */
const entryOf = new Map();
for (const cb of books) for (const [id, e] of Object.entries(cb.entries ?? {})) entryOf.set(id, [cb, e]);

/**
 * The page as LINES, each carrying its geometry and its raw pdf.js runs.
 *
 * Lines rather than raw items because a line is the unit a chef reasons about
 * (a `descStopY` is a line's y, a table row is a line); raw items would be
 * ~800 objects a page of mostly noise. But each line keeps its `runs` — the
 * unjoined pdf.js text items — because where the runs break is invisible in
 * joined text and matters twice over: the compiler's `bodyText` drops the
 * spaces BETWEEN runs, so a pattern written against what you read here
 * ("proficiency throw") can fail against what the compiler sees
 * ("proficiencythrow"). Seeing the break is the difference between writing
 * `\s*` and losing an hour.
 */
function pageLines(pd) {
  const cols = detectColumns(pd.items);
  const byCol = new Map();
  for (const it of pd.items) {
    if (!it.str?.trim()) continue;
    const c = colOf(it.x, cols);
    (byCol.get(c) ?? byCol.set(c, []).get(c)).push(it);
  }
  const out = [];
  for (const c of [...byCol.keys()].sort((a, b) => a - b)) {
    const items = byCol.get(c).sort((a, b) => a.y - b.y || a.x - b.x);
    let cur = [];
    const flush = () => {
      if (!cur.length) return;
      const round = (n) => Math.round(n * 10) / 10;
      out.push({
        col: c,
        y: round(cur[0].y),
        x0: round(Math.min(...cur.map((i) => i.x))),
        x1: round(Math.max(...cur.map((i) => i.x + i.w))),
        h: round(Math.max(...cur.map((i) => i.h))),
        // Run x-positions: what a table's column boundaries show up as.
        xs: cur.map((i) => round(i.x)),
        runs: cur.map((i) => i.str),
        text: cur.map((i) => i.str.trim()).join(" "),
      });
      cur = [];
    };
    let y = -99;
    for (const it of items) {
      if (Math.abs(it.y - y) > 2) flush();
      y = it.y;
      cur.push(it);
    }
    flush();
  }
  return { cols, lines: out };
}

/** Reading-order prose, joined from the lines — what the old package shipped. */
const linesToText = (lines) => lines.map((l) => l.text).join("\n");

/**
 * Runs of consecutive lines that share repeated x-positions — a TABLE CANDIDATE.
 *
 * Detection only. It reports where a grid appears to be so a chef can look, and
 * says nothing about what the table means, which column is which, or whether it
 * belongs to this entry. Three consecutive lines sharing at least two aligned
 * run positions is a low bar deliberately: a missed table is worse than one to
 * dismiss, and the chef reads the page either way.
 */
function tableCandidates(lines) {
  const aligned = (a, b) => a.xs.filter((x) => b.xs.some((v) => Math.abs(v - x) < 3)).length;
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length >= 3) {
      const xs = [...new Set(run.flatMap((l) => l.xs.map((x) => Math.round(x / 3) * 3)))].sort((a, b) => a - b);
      out.push({ col: run[0].col, y0: run[0].y, y1: run[run.length - 1].y, rows: run.length, colX: xs });
    }
    run = [];
  };
  for (const l of lines) {
    const prev = run[run.length - 1];
    if (prev && prev.col === l.col && aligned(prev, l) >= 2) run.push(l);
    else {
      flush();
      run = [l];
    }
  }
  flush();
  return out;
}

async function main() {
  const ids = idArgs.length
    ? idArgs
    : [...entryOf.entries()]
        .filter(([, [, e]]) => e.book === bookArg)
        .sort(([, [, a]], [, [, b]]) => (a.audited ? 1 : 0) - (b.audited ? 1 : 0))
        .map(([id]) => id);

  const { doc } = await openBook(fs.readFileSync(FILES[bookArg]));
  const pageCache = new Map();
  const pageOf = async (p) => {
    if (!pageCache.has(p)) {
      const pd = await pageItems(doc, p);
      const { cols, lines } = pageLines(pd);
      pageCache.set(p, {
        width: Math.round(pd.width),
        height: Math.round(pd.height),
        columns: cols,
        text: linesToText(lines),
        tableCandidates: tableCandidates(lines),
        lines,
      });
    }
    return pageCache.get(p);
  };

  for (const id of ids) {
    const [cb, entry] = entryOf.get(id) ?? [];
    if (!entry || entry.book !== bookArg) {
      console.error(`skip ${id}: not an ability entry of ${bookArg}`);
      continue;
    }
    const res = await executeEntry(doc, cb, registers, id);
    // The entry's own pages plus the following one, because a column can flow.
    const pages = [...new Set([...(entry.pages ?? []), Math.max(...(entry.pages ?? [0])) + 1])];
    const pkg = {
      id,
      name: entry.name,
      meta: entry.meta ?? {},
      audited: entry.audited ?? false,
      extracted: {
        description: (res?.fields?.description ?? []).map((p) => p.text),
        effects: res?.fields?.effects ?? [],
        rolls: res?.fields?.rolls ?? [],
        ...(res?.fields?.progression ? { progression: res.fields.progression } : {}),
        ...(res?.fields?.powerValue != null ? { powerValue: res.fields.powerValue } : {}),
        ...(res?.fields?.defenses ? { defenses: res.fields.defenses } : {}),
      },
      // Each page as geometry AND prose. `pages[n].lines` is what a coordinate
      // locator is written against; `pages[n].text` is the same content joined,
      // for reading. `pageText` stays as it was so older tooling still works.
      pages: Object.fromEntries(await Promise.all(pages.map(async (p) => [p, await pageOf(p)]))),
      pageText: Object.fromEntries(await Promise.all(pages.map(async (p) => [p, (await pageOf(p)).text]))),
    };
    fs.writeFileSync(path.join(outDir, `${id}.json`), JSON.stringify(pkg, null, 2) + "\n");
    const tables = Object.values(pkg.pages).reduce((n, p) => n + p.tableCandidates.length, 0);
    console.error(
      `wrote ${id} (${pkg.extracted.description.length} para(s), pages ${pages.join(",")}, ${tables} table candidate(s))`,
    );
  }
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
