/**
 * DEV-ONLY (chef-side): seed an authored OSE adventure's KEYED AREAS.
 *
 * The sibling of harvest-ose-book.mjs, for the other thing an adventure is made
 * of. A keyed area announces itself the way no creature does — with a number
 * and a full stop — so locating one needs no grammar and no confidence rules:
 * "1. Abandoned Storefront" is a room, and a heading that is not numbered is
 * not. That is why this is a separate tool rather than a mode of the creature
 * harvester, whose whole difficulty is deciding what it is looking at.
 *
 * What it emits is geometry and a name: the heading that titles the area and
 * the boxes its text occupies, down to the next area in the same column and on
 * into the columns the area runs into. The words are read from the reader's own
 * copy at import time.
 *
 * Usage:
 *   node tools/harvest-ose-areas.mjs qd1            report only
 *   node tools/harvest-ose-areas.mjs qd1 --write    write register/qd1/
 *   node tools/harvest-ose-areas.mjs qd1 --pages 10-12
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openBook, pageItems, listHeadings, detectColumns } from "../../scripts/importer/extract.mjs";
import { OSE_FILES } from "./reference-lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Items this tall are display headings, not body text. */
const HEADING_MIN_H = 12;
/** Top of the body area: above this sit running heads and folios. */
const PAGE_TOP = 50;
/** Columns closer together than this are one column with a hanging indent. */
const MIN_COL_WIDTH = 120;

/** "12. Tunnel Junction" — a number, a stop, and a title. */
const AREA_KEY = /^\s*(\d{1,3})\s*[.)]\s*(\S.*)$/;

const argv = process.argv.slice(2);
const BOOK = argv.find((a) => !a.startsWith("--"));
const WRITE = argv.includes("--write");
const RANGE = (() => {
  const i = argv.indexOf("--pages");
  if (i < 0 || !argv[i + 1]) return null;
  const [a, b] = argv[i + 1].split("-").map(Number);
  return { from: a, to: b ?? a };
})();

if (!BOOK || !OSE_FILES[BOOK]) {
  console.error(`usage: node tools/harvest-ose-areas.mjs <${Object.keys(OSE_FILES).join("|")}> [--write] [--pages A-B]`);
  process.exit(1);
}
const file = OSE_FILES[BOOK];
if (!fs.existsSync(file)) {
  console.error(`harvest-ose-areas: ${BOOK} is not on this machine — skipped.`);
  process.exit(0);
}

/** Register id slug, matching the family's camel-cased convention. */
const slugOf = (s) =>
  String(s ?? "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()))
    .join("")
    .slice(0, 40);

/** The x-range of a text column, widening over neighbours too narrow to be one. */
function columnSpan(cols, col, pageWidth) {
  let from = col;
  while (from > 0 && cols[from] - cols[from - 1] < MIN_COL_WIDTH) from--;
  let to = col + 1;
  while (to < cols.length && cols[to] - cols[to - 1] < MIN_COL_WIDTH) to++;
  return { x0: cols[from] - 6, x1: to < cols.length ? cols[to] - 8 : pageWidth };
}

/** Paragraph boxes for a region, split where the leading opens up. */
function proseBoxes(pd, region) {
  const items = pd.items.filter(
    (it) =>
      String(it.str).trim() &&
      (it.h ?? 0) < HEADING_MIN_H &&
      it.x >= region.x0 &&
      it.x <= region.x1 &&
      it.y > region.y0 + 4 &&
      it.y < region.y1 - 2,
  );
  if (!items.length) return [];

  const lines = [];
  for (const it of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const line = lines.find((l) => Math.abs(l.y - it.y) <= 3);
    if (line) line.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  lines.sort((a, b) => a.y - b.y);

  const gaps = lines.slice(1).map((l, i) => l.y - lines[i].y).filter((g) => g > 0).sort((a, b) => a - b);
  const pitch = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 12;

  const groups = [[lines[0]]];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].y - lines[i - 1].y > pitch * 1.3) groups.push([lines[i]]);
    else groups[groups.length - 1].push(lines[i]);
  }
  return groups.map((g) => {
    const all = g.flatMap((l) => l.items);
    return {
      x0: Math.min(...all.map((i) => i.x)) - 2,
      x1: Math.max(...all.map((i) => i.x + (i.w ?? 0))) + 2,
      y0: Math.min(...all.map((i) => i.y)) - 3,
      y1: Math.max(...all.map((i) => i.y)) + 3,
    };
  });
}

const { doc, numPages } = await openBook(fs.readFileSync(file));
const from = RANGE?.from ?? 1;
const to = Math.min(RANGE?.to ?? numPages, numPages);

const rows = [];
const seen = new Set();

for (let page = from; page <= to; page++) {
  let pd;
  try {
    pd = await pageItems(doc, page);
  } catch {
    continue;
  }
  const cols = detectColumns(pd.items);
  const heads = listHeadings(pd).filter((h) => h.mode === "display");
  const keyed = heads
    .map((h) => ({ h, m: AREA_KEY.exec(String(h.text ?? "").replace(/\s+/g, " ").trim()) }))
    .filter((r) => r.m);

  for (const { h, m } of keyed) {
    const number = m[1];
    const col = h.col ?? 0;
    // A long title WRAPS onto a second heading line — "9. Interrogation" over
    // "Chamber" — and the second line is part of the name, not the start of the
    // room's text. Absorbed the same way the monster compiler absorbs a wrapped
    // creature name, and the prose then starts below it rather than with it.
    let titleEndY = h.y;
    let title = m[2].trim();
    for (const o of heads
      .filter((o) => o !== h && Math.abs((o.col ?? 0) - col) < 1 && o.y > h.y && o.y <= h.y + 26)
      .sort((a, b) => a.y - b.y)) {
      if (AREA_KEY.test(String(o.text ?? "").replace(/\s+/g, " ").trim())) break;
      title += ` ${String(o.text ?? "").replace(/\s+/g, " ").trim()}`;
      titleEndY = o.y;
    }
    title = title.replace(/\s+/g, " ").trim().slice(0, 58);

    // The area runs to the next thing that starts one in this column, then on
    // into the columns after it. Any heading ends it, not only another keyed
    // one: a sidebar or a section title is not this room's text.
    const endIn = (c, after) =>
      Math.min(
        pd.height - 30,
        ...heads
          .filter((o) => o !== h && Math.abs((o.col ?? 0) - c) < 1 && o.y > titleEndY + 1)
          .map((o) => o.y)
          .filter((y) => y > after),
      );

    const prose = [];
    for (let c = col; c < cols.length; c++) {
      if (cols[c] === undefined) break;
      const span = columnSpan(cols, c, pd.width);
      const own = c === col;
      const y0 = own ? titleEndY : PAGE_TOP;
      const y1 = endIn(c, y0);
      if (y1 <= y0) break;
      prose.push(...proseBoxes(pd, { ...span, y0, y1 }));
      while (c + 1 < cols.length && cols[c + 1] - 8 < span.x1) c++;
    }
    if (!prose.length) continue;

    // A number can be keyed twice in one book (two maps, one numbering), so a
    // repeat takes a letter. Ids are camelCase alphanumerics — an underscore is
    // not a legal composite id and the register lint says so.
    let id = `${BOOK}.area${number}`;
    let n = 0;
    while (seen.has(id)) id = `${BOOK}.area${number}${String.fromCharCode(98 + n++)}`;
    seen.add(id);

    rows.push({
      id,
      kind: "kind.oseLocation",
      book: BOOK,
      // The number leads, so the areas sort the way the map is keyed.
      name: `${number}. ${title}`.slice(0, 58),
      // The anchor is what the PAGE says: an expect matches byte for byte.
      anchor: { display: String(h.text ?? "").replace(/\s+/g, " ").trim().slice(0, 58) },
      pages: [page],
      meta: { areaKey: number, areaTitle: title.slice(0, 58), areaSlug: slugOf(title) },
      assists: { prose: prose.map((box) => ({ page, box })) },
    });
  }
}

console.error(`${BOOK}: ${rows.length} keyed area(s) across pages ${from}-${to}`);
if (!WRITE) {
  for (const r of rows.slice(0, 14)) console.error(`  ${r.id}  p.${r.pages[0]}  ${JSON.stringify(r.name)}  prose:${r.assists.prose.length}`);
  console.error(`\n(dry run — pass --write to emit register/${BOOK}/)`);
  process.exit(0);
}

// A book with no keyed areas gets no file. An empty register reads as "someone
// authored areas here and found none", which is a different claim from "this
// book keys its rooms another way" — and it is the second that is true.
if (!rows.length) {
  console.error(`${BOOK}: nothing to write`);
  process.exit(0);
}

const dir = path.join(HERE, "..", "..", "register", BOOK);
fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, `p${from}-p${to}-areas.json`);
// Keep whatever a chef has already hand-authored: merge by id, existing wins.
const existing = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : [];
const byId = new Map(existing.map((e) => [e.id, e]));
let added = 0;
for (const r of rows) {
  if (byId.has(r.id)) continue;
  byId.set(r.id, r);
  added++;
}
fs.writeFileSync(out, JSON.stringify([...byId.values()], null, 2) + "\n");
console.error(`wrote ${out} — ${added} new, ${existing.length} kept`);
