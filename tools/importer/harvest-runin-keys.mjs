/**
 * DEV-ONLY (chef-side): seed an AX adventure's run-in KEYED AREAS into a key
 * space, and list a page's display headings by the key a hash anchor finds
 * them by.
 *
 * A run-in keyed area opens a paragraph with its key in the heading's face,
 * "9a. Title:", and its prose runs on after the colon. The compiler finds such
 * a key with `axKeyLines`; this tool walks the same lines over a section's
 * pages and writes a row for each key: the id and label its key space derives
 * (`register-rules.mjs:spaceKeyed`), `anchor: {number, as: "runin"}`, the pages
 * its prose may run over, and `meta.space` and `meta.parent`. It writes no word
 * of a heading and prints none: the words are read off the Judge's page at
 * import.
 *
 * A key's parent is the key its number names when its key is lettered ("9a."
 * under "9."), else the nearest section heading of the space before it in
 * reading order (a row of the space anchored by hash), else the space. The
 * coverage report lists what the author settles against the page: numbers and
 * letters the run skips, a key found twice, a key whose heading sets no colon,
 * a key printed with a colon for its stop, and a key whose line starts inset
 * from its column.
 *
 * Usage:
 *   node tools/importer/harvest-runin-keys.mjs ax1 --space ax1.fort --pages 9-27            report only
 *   node tools/importer/harvest-runin-keys.mjs ax1 --space ax1.fort --pages 9-27 --write    write register/ax1/
 *   node tools/importer/harvest-runin-keys.mjs ax1 --headings 36 [--wrap 40] [--min-h 20]   hash keys of p.36's headings
 *
 * `--write` merges by id into `register/<book>/p<A>-p<B>-<stem>-areas.json`:
 * a row it harvests again keeps its hand-written `assists`, `status` and other
 * `meta`, and a row it does not find again is kept and reported.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openBook } from "../../scripts/importer/extract.mjs";
import { axColumns, axHeadingKeys, axKeyLines, axOpen, axPageItems, useAxBands } from "./compile-cookbook.mjs";
import { spaceKeyed } from "./register-rules.mjs";
import { FILES } from "./reference-lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REGISTER = path.join(HERE, "..", "..", "register");
/** A key line starting further than this right of its column's start is reported as inset. */
const INSET = 20;

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const BOOK = argv.find((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
const usage = () => {
  console.error("usage: node tools/importer/harvest-runin-keys.mjs <book> --space <row id> --pages A-B [--write]");
  console.error("       node tools/importer/harvest-runin-keys.mjs <book> --headings <page> [--wrap N] [--min-h N]");
  process.exit(1);
};
if (!BOOK || !FILES[BOOK]) usage();
if (!fs.existsSync(FILES[BOOK])) {
  console.error(`harvest-runin-keys: ${BOOK} is not on this machine — skipped.`);
  process.exit(0);
}
const { doc } = await openBook(fs.readFileSync(FILES[BOOK]), { book: BOOK });
useAxBands(doc, BOOK);

/* ---------------- headings: the hash a display heading is found by ---------------- */

if (opt("--headings")) {
  const page = Number(opt("--headings"));
  const assists = {};
  if (opt("--wrap")) assists.headingWrap = Number(opt("--wrap"));
  if (opt("--min-h")) assists.headingLines = { minH: Number(opt("--min-h")) };
  const pd = await axPageItems(doc, page);
  for (const h of axHeadingKeys(pd, assists)) {
    console.log(`p.${page} col ${h.col} y${h.y.toFixed(0)} x${h.x0.toFixed(0)} to y${h.endY.toFixed(0)}  hash ${h.hash}`);
  }
  process.exit(0);
}

/* ---------------- keys: the rows of a key space ---------------- */

const SPACE = opt("--space");
const range = opt("--pages")?.split("-").map(Number);
if (!SPACE || !range || !range.every(Number.isInteger)) usage();
const [FROM, TO = FROM] = range;
const WRITE = argv.includes("--write");

const registerRows = [];
for (const f of fs.existsSync(path.join(REGISTER, BOOK)) ? fs.readdirSync(path.join(REGISTER, BOOK)).sort() : []) {
  if (f.endsWith(".json")) registerRows.push(...JSON.parse(fs.readFileSync(path.join(REGISTER, BOOK, f), "utf8")));
}
const space = registerRows.find((r) => r.id === SPACE);
if (!space) {
  console.error(`harvest-runin-keys: no row ${SPACE} in register/${BOOK}/ — write the space's row first`);
  process.exit(1);
}

/** Reading order: page, then column, then down the column. */
const before = (p, q) => p.page - q.page || p.col - q.col || p.y - q.y;

// The space's section headings: its rows anchored by hash, where the compiler finds them.
const sections = [];
for (const r of registerRows.filter((r) => r.kind === "kind.location" && r.meta?.space === SPACE && r.anchor?.hash !== undefined)) {
  const opened = await axOpen(doc, r).catch((err) => {
    console.error(`  section ${r.id}: ${err.message}`);
    return null;
  });
  if (opened) sections.push({ id: r.id, page: opened.page, col: opened.a.col, y: opened.a.line.y });
}
sections.sort(before);

const found = [];
for (let page = FROM; page <= TO; page++) {
  const pd = await axPageItems(doc, page);
  const cols = axColumns(pd);
  for (const k of axKeyLines(pd, cols)) {
    found.push({
      page, col: k.col, y: k.line.y, key: k.key, stop: k.stop, colon: k.colon, wrap: !!k.wrap,
      inset: k.line.x0 > cols[k.col] + INSET,
    });
  }
}
found.sort(before);

const bareOf = (key) => key.replace(/–/g, "-");
const keyed = found.filter((k) => k.colon);
const byKey = new Map();
for (const k of keyed) (byKey.get(bareOf(k.key)) ?? byKey.set(bareOf(k.key), []).get(bareOf(k.key))).push(k);

const rows = [];
for (const k of keyed) {
  if (byKey.get(bareOf(k.key)).length > 1) continue;
  const number = `${k.key}.`;
  const { id, label } = spaceKeyed(space, number);
  // Its prose may run on to the page where the next key or section of the space opens.
  const next = [...found, ...sections].filter((o) => before(o, k) > 0).sort(before)[0];
  const last = next ? next.page : TO;
  const lettered = /^(\d+)[A-Za-z]/.exec(k.key);
  const base = lettered ? byKey.get(lettered[1]) : null;
  const section = sections.filter((s) => before(s, k) < 0).at(-1);
  const parent = base?.length === 1 ? spaceKeyed(space, `${lettered[1]}.`).id : section?.id ?? SPACE;
  rows.push({
    id, kind: "kind.location", book: BOOK, name: label,
    anchor: { number, as: "runin" },
    pages: Array.from({ length: last - k.page + 1 }, (_, i) => k.page + i),
    meta: { space: SPACE, parent },
  });
}

/* ---------------- coverage ---------------- */

const flag = (k) => [k.wrap && "wrapped", k.stop === ":" && "colon-stop", k.inset && "inset"].filter(Boolean).join(",");
const numbers = new Set();
const letters = new Map();
for (const k of keyed) {
  const span = /^(\d+)(?:[-–](\d+))?/.exec(k.key);
  for (let n = Number(span[1]); n <= Number(span[2] ?? span[1]); n++) numbers.add(n);
  const lr = /^(\d+)([A-Za-z])(?:[-–]([A-Za-z]))?$/.exec(k.key);
  if (lr) {
    const set = letters.get(lr[1]) ?? letters.set(lr[1], new Set()).get(lr[1]);
    for (let c = lr[2].toLowerCase().charCodeAt(0); c <= (lr[3] ?? lr[2]).toLowerCase().charCodeAt(0); c++) set.add(c);
  }
}
const gaps = [];
const nums = [...numbers].sort((a, b) => a - b);
for (let n = nums[0]; n <= nums.at(-1); n++) if (!numbers.has(n)) gaps.push(String(n));
for (const [base, set] of letters) {
  const top = Math.max(...set);
  for (let c = 97; c <= top; c++) if (!set.has(c)) gaps.push(base + String.fromCharCode(c));
}

console.error(`${SPACE}: ${rows.length} keyed area(s) over pp. ${FROM}-${TO}; ${sections.length} section(s)`);
for (const r of rows) {
  const k = keyed.find((x) => `${x.key}.` === r.anchor.number);
  console.error(`  ${r.id}  key ${r.anchor.number}  pp. ${r.pages[0]}-${r.pages.at(-1)}  parent ${r.meta.parent}${flag(k) ? `  [${flag(k)}]` : ""}`);
}
const twice = [...byKey].filter(([, ks]) => ks.length > 1);
console.error(`gaps: ${gaps.join(" ") || "none"}`);
console.error(`found twice (no row written): ${twice.map(([key, ks]) => `${key} pp.${ks.map((x) => x.page).join("/")}`).join(" ") || "none"}`);
console.error(`no colon (no row written): ${found.filter((k) => !k.colon).map((k) => `${k.key} p.${k.page} y${k.y.toFixed(0)}`).join(" ") || "none"}`);

if (!WRITE) {
  console.error("\n(dry run — pass --write to write the rows)");
  process.exit(0);
}

const stem = SPACE.split(".")[1];
const out = path.join(REGISTER, BOOK, `p${FROM}-p${TO}-${stem}-areas.json`);
const existing = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : [];
const old = new Map(existing.map((r) => [r.id, r]));
const merged = rows.map((r) => {
  const was = old.get(r.id);
  if (!was) return r;
  // What the page derives is rewritten; what an author added is kept.
  const { id, kind, book, name, anchor, pages, meta: { space: _s, parent: _p, ...meta } = {}, ...authored } = was;
  return { ...r, meta: { ...r.meta, ...meta }, ...authored };
});
const kept = existing.filter((r) => !rows.some((x) => x.id === r.id));
fs.writeFileSync(out, JSON.stringify([...merged, ...kept], null, 2) + "\n");
console.error(`wrote ${path.relative(path.join(HERE, "..", ".."), out)}: ${merged.length} harvested, ${kept.length} kept from before (${kept.map((r) => r.id).join(" ") || "none"})`);
