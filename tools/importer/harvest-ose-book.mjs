/**
 * DEV-ONLY (chef-side): seed an authored OSE book's register from the locator.
 *
 * A cookbook entry for a creature is a BOX and a name. The locator already
 * finds most of them — 93% of the corpus at last sweep — so for an authored
 * book the boxes do not need typing out: this walks the book, takes every
 * candidate the locator is confident about, and writes the register rows.
 *
 * What it deliberately does NOT emit is the part that needs judgement:
 * - a candidate the locator flagged (another game's block, or two read as one)
 *   is REPORTED and skipped, because a box drawn around the wrong thing is
 *   worse than no box at all;
 * - prose and art boxes are left for the chef, since which paragraph belongs
 *   to which creature is a reading of the page, not a measurement of it.
 *
 * So the output is a floor, not a finished register: it turns "author 565
 * entries" into "review 565 boxes and hand-author the few dozen the locator
 * could not see". Re-running is safe — existing rows are kept by id and only
 * new ones are added, so a chef's hand edits survive.
 *
 * IP: emits geometry and a name, never values or prose. The name comes from
 * the book's own heading, which is a locator, and is capped like every other
 * register string.
 *
 * Usage:
 *   node tools/harvest-ose-book.mjs qd1            report only
 *   node tools/harvest-ose-book.mjs qd1 --write    write register/qd1/
 *   node tools/harvest-ose-book.mjs qd1 --pages 8-9
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openBook, pageItems, listHeadings, pageArtPlacements, detectColumns } from "../../scripts/importer/extract.mjs";
import { findStatBlocks, runinLabelAbove, statLineTest } from "../../scripts/importer/ose-blocks.mjs";
import { parseOseStatline, PROFILES, OSE_CANONICAL } from "../../scripts/importer/ose-statline.mjs";
import { BOOKS } from "../../scripts/importer/books.mjs";
import { OSE_FILES } from "./reference-lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Items this tall are display headings, not body text (ose-blocks' rule). */
const HEADING_MIN_H = 12;
/** Top of the body area: above this sit running heads and folios. */
const PAGE_TOP = 50;
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
  console.error(`usage: node tools/harvest-ose-book.mjs <${Object.keys(OSE_FILES).join("|")}> [--write] [--pages A-B]`);
  process.exit(1);
}
const file = OSE_FILES[BOOK];
if (!fs.existsSync(file)) {
  console.error(`harvest-ose-book: ${BOOK} is not on this machine — skipped.`);
  process.exit(0);
}

/**
 * Undo small-caps typography in a heading.
 *
 * A small-caps heading is set as full capitals for the first letter of each
 * word and reduced capitals for the rest, so extraction reads "appRentiCes"
 * where the page shows "Apprentices" — the case pattern is the typeface, not
 * the spelling. Detected by the giveaway a real title never has: a capital
 * following a lower-case letter inside a word, or a word starting lower-case.
 * Left alone otherwise, so "The Isle of the Plangent Mage" keeps its own case.
 */
function fixSmallCaps(s) {
  const t = String(s ?? "").trim();
  if (!t) return t;
  // A heading set entirely in capitals is typography too — an index-style
  // bestiary head reads "BURROWING BEETLE, GIANT" where the page shows a
  // small-caps line, and an actor should not shout its own name.
  const allCaps = /[A-Z]/.test(t) && !/[a-z]/.test(t);
  const mangled =
    allCaps || /[a-z][A-Z]/.test(t) || /(^|\s)[a-z]/.test(t.replace(/(^|\s)(of|the|and|a|an|to|in)\b/gi, "$1X"));
  if (!mangled) return t;
  return t
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\b(Of|The|And|A|An|To|In)\b/g, (w, _m, i) => (i === 0 ? w : w.toLowerCase()));
}

/**
 * Why this string is not a creature name, or null when it is plausibly one.
 *
 * The heading above a block is not always the creature's. Two shapes defeat it,
 * and both produce an actor whose name is the first thing a Judge reads and the
 * last thing they think to check:
 *
 * - a bestiary that sets descriptive prose large enough to pass for a heading,
 *   giving "And Bony Claws. Servants of Grim, Forgotten Gods, Doomed t";
 * - a keyed adventure, where the nearest heading is the ROOM ("13. Hallway")
 *   and the creature is named — if at all — inside the block itself.
 *
 * So a name is short, unpunctuated, does not open mid-sentence, and never
 * carries an area key. A block that fails goes to the chef rather than to the
 * world: no name is a gap a human closes, a wrong name is one nobody sees.
 */
function nameProblem(s) {
  const t = String(s ?? "").trim();
  if (!t) return "empty";
  if (/^\d+\s*[.)]/.test(t) || /^\d+\s+[-–—]/.test(t)) return "area key, not a creature name";
  if (t.length > 42 || t.split(/\s+/).length > 5) return "too long for a name";
  // Sentence punctuation inside means a sentence was captured, not a name.
  if (/[.;:!?]/.test(t.slice(0, -1))) return "sentence punctuation";
  // A name is not a sentence, so it does not end in a full stop, and it does
  // not join its parts with a conjunction ("Ravines, and Tangled Woods").
  if (/\.$/.test(t)) return "ends a sentence";
  if (/,\s*(and|or)\b/i.test(t)) return "reads as a list";
  // A name may open with an article; it never opens with a conjunction or a
  // preposition, which is exactly what a mid-sentence capture does.
  if (/^(and|or|but|with|for|from|in|on|at|to|of|they|it|its|their)\b/i.test(t)) return "opens mid-sentence";
  // Two or more commas is a list, not a name ("Mud Pools, and Lightless Caverns").
  if ((t.match(/,/g) ?? []).length > 1) return "reads as a list";
  return null;
}

/**
 * The x-range of a text column, widening over neighbours too narrow to be one.
 *
 * A hanging indent defeats the x-histogram: Dolmenwood sets run-in labels at
 * x48 and their prose at x93, and detection reports two columns 40 points
 * apart. A description harvested against those gets the labels and none of the
 * text — every paragraph truncated to its first line, which looks like a
 * paragraph-splitting bug and is not one.
 *
 * A real body column on these pages is upwards of 200 points wide, so anything
 * closer than half that is one column being read as two. The locator keeps the
 * RAW columns — a stat block is found by clustering within whichever it sits in
 * — so this widens the region instead of renumbering them.
 */
function columnSpan(cols, col, pageWidth, minWidth = 120) {
  let from = col;
  while (from > 0 && cols[from] - cols[from - 1] < minWidth) from--;
  let to = col + 1;
  while (to < cols.length && cols[to] - cols[to - 1] < minWidth) to++;
  return { x0: cols[from] - 6, x1: to < cols.length ? cols[to] - 8 : pageWidth };
}

/**
 * The paragraph boxes of a creature's description.
 *
 * A bestiary entry is a heading, some prose, the stat block, and usually more
 * prose under it before the next heading — so the description is the creature's
 * own column between its heading and the next boundary, with the block's own
 * band taken out of the middle. Both halves matter: on a page of the Referee's
 * Tome the text under the block is as long as the text over it, and an entry
 * harvested without it arrives with its combat notes missing.
 *
 * Boxes, never text. What the paragraphs SAY is read from the reader's own copy
 * at import time; this only records where on the page to look.
 *
 * @param bounds  `{x0, x1}` of the block's column, and `{startY, endY}` — the
 *                creature's entry, from its name to whatever comes next
 * @returns one box per paragraph, in reading order
 */
function proseBoxesFor(pd, c, bounds, isStat) {
  const { x0, x1, startY, endY } = bounds;
  const items = pd.items.filter(
    (it) =>
      String(it.str).trim() &&
      (it.h ?? 0) < HEADING_MIN_H &&
      it.x >= x0 &&
      it.x <= x1 &&
      it.y > startY + 4 &&
      it.y < endY - 2 &&
      // The block is not description, and neither is the line its label sits on.
      !(it.y > c.box.y0 - 3 && it.y < c.box.y1 + 3),
  );
  if (!items.length) return [];

  const lines = [];
  for (const it of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const line = lines.find((l) => Math.abs(l.y - it.y) <= 3);
    if (line) line.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  lines.sort((a, b) => a.y - b.y);

  // A book that sets its stat block as a TABLE leaves cells the block box never
  // covered, sitting immediately above or below it where a description would.
  // Those are the block continuing, not prose.
  //
  // Only the run ADJACENT to the block is dropped, and the moment a real line
  // of prose appears the dropping stops. Tables further down belong to the
  // creature — what it hoards, what it carries — and are part of its entry
  // exactly as its paragraphs are. A rule that dropped every stat-shaped line
  // would take those too, which is the opposite of what authoring is for.
  const isProse = lines.map((l) => !isStat(l.items.map((i) => i.str).join(" ")));
  const keep = lines.map(() => true);
  // Downward from just under the block, and upward from just over it: each run
  // stops at the first line that reads as prose.
  for (let i = lines.findIndex((l) => l.y > c.box.y1); i >= 0 && i < lines.length; i++) {
    if (isProse[i]) break;
    keep[i] = false;
  }
  for (let i = lines.findLastIndex((l) => l.y < c.box.y0); i >= 0; i--) {
    if (isProse[i]) break;
    keep[i] = false;
  }
  const kept = lines.filter((_, i) => keep[i]);
  if (!kept.length) return [];
  lines.length = 0;
  lines.push(...kept);

  // Paragraph pitch from the page itself: a gap noticeably wider than the
  // body's own leading is a paragraph break, and the leading differs per book.
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

// A book that declares a dialect is LOCATED with it too: the labels a profile
// adds are what make its blocks countable as blocks.
const PROFILE = PROFILES[BOOKS[BOOK]?.profile] ?? OSE_CANONICAL;
/** "Is this line statistics rather than prose", built once for this book. */
const isStatText = statLineTest(PROFILE);

const { doc, numPages } = await openBook(fs.readFileSync(file));
const from = RANGE?.from ?? 1;
const to = Math.min(RANGE?.to ?? numPages, numPages);

const rows = [];
const skipped = [];
const seen = new Set();

for (let page = from; page <= to; page++) {
  let pd;
  try {
    pd = await pageItems(doc, page);
  } catch {
    continue;
  }
  const heads = listHeadings(pd).filter((h) => h.mode === "display");
  const candidates = findStatBlocks(pd, PROFILE);

  // Illustrations on this page. A placement covering most of the page is a
  // background or a full-bleed spread, and a very small one is a rule, a bullet
  // or a border ornament — neither is a portrait. The lower bound is generous
  // because containment does the real work: an ornament has to be standing
  // inside a creature's own entry AND be the largest thing there to be chosen,
  // and one book prints portraits small enough that a stricter bound threw away
  // more than half of what it had.
  let placements = [];
  try {
    const pageArea = (pd.width ?? 612) * (pd.height ?? 792);
    placements = (await pageArtPlacements(doc, page)).filter(
      (a) => a.w >= 56 && a.h >= 56 && a.w * a.h < pageArea * 0.7,
    );
  } catch {
    placements = [];
  }

  const cols = detectColumns(pd.items);
  /** This page's accepted entries, so art is placed once the set is known. */
  const onPage = [];
  // Every run-in label on the page, so one creature description stops where the
  // next creature is named even when neither carries a heading.
  const runinYs = [];
  for (const cand of candidates) {
    const r = runinLabelAbove(pd, cand);
    if (r) runinYs.push({ col: cand.col, y: r.y });
  }

  for (const c of candidates) {
    if (c.suspectLineage || c.mergedBlocks) {
      skipped.push({ page, why: c.suspectLineage ? "another game's block" : "two blocks read as one", text: c.text.slice(0, 60) });
      continue;
    }
    const parsed = parseOseStatline(c.text, PROFILE);
    // A bestiary can set its opening description in a face large enough to read
    // as a heading, so the NEAREST heading over a block is often the creature's
    // own flavour text with the real title above it. Walk up to the first that
    // reads as a name. On the Dolmenwood pages this is the difference between a
    // fifth of the book and most of it.
    const headsAbove = heads
      .filter((h) => h.y < c.box.y0 && Math.abs((h.col ?? 0) - c.col) < 1)
      .sort((a, b) => b.y - a.y);
    const titled = (h) => fixSmallCaps(String(h.text ?? "").replace(/\s+/g, " ").trim()).slice(0, 58);
    const above = headsAbove.find((h) => !nameProblem(titled(h))) ?? headsAbove[0];
    // Preference order, cheapest evidence first: what the block called itself,
    // then the run-in label a keyed adventure sets over it, then the display
    // heading a bestiary sets over it. The heading is last because it is the
    // one that can belong to something other than this creature.
    const runin = runinLabelAbove(pd, c);
    const name = fixSmallCaps((parsed.name || runin?.text || above?.text || "").replace(/\s+/g, " ").trim()).slice(0, 58);
    if (!name) {
      skipped.push({ page, why: "no name found above or in the block", text: c.text.slice(0, 60) });
      continue;
    }
    const problem = nameProblem(name);
    if (problem) {
      skipped.push({ page, why: `${problem}: "${name.slice(0, 40)}"`, text: c.text.slice(0, 40) });
      continue;
    }
    // The creature's entry: from whatever named it, down to the next thing that
    // starts an entry in the same column — another heading, another run-in
    // label, another block. Nothing is claimed past that, so one creature's
    // description can never absorb the creature after it.
    const nameY = runin?.y ?? (above && !parsed.name ? above.y : null);
    // Where an entry ENDS in a given column: the next thing that starts one —
    // another heading, another block, another run-in label.
    const startsIn = (col, after) =>
      Math.min(
        pd.height - 30,
        ...[
          ...heads.filter((h) => Math.abs((h.col ?? 0) - col) < 1).map((h) => h.y),
          ...candidates.filter((o) => o !== c && o.col === col).map((o) => o.box.y0),
          ...runinYs.filter((r) => r.col === col && r.y !== nameY).map((r) => r.y),
        ].filter((y) => y > after),
      );

    // The entry runs from whatever named it to that boundary, and CONTINUES in
    // the columns after it. Following it across is what a two-column entry
    // needs; it costs a one-column book nothing, because the next column starts
    // with its own creature's heading and so contributes an empty region.
    const prose = [];
    const regions = [];
    for (let col = c.col; col < cols.length; col++) {
      if (cols[col] === undefined) break;
      const span = columnSpan(cols, col, pd.width);
      const own = col === c.col;
      const startY = own ? (nameY ?? c.box.y0 - 1) : PAGE_TOP;
      const endY = startsIn(col, own ? c.box.y1 + 2 : startY);
      if (endY <= startY) break;
      regions.push({ ...span, y0: startY, y1: endY });
      prose.push(...proseBoxesFor(pd, c, { ...span, startY, endY }, isStatText));
      // Skip only the columns this span actually SWALLOWED. The span ends
      // exactly at the next column's edge, so testing inclusively skipped that
      // column too — which in Dolmenwood is where every illustration lives.
      while (col + 1 < cols.length && cols[col + 1] - 8 < span.x1) col++;
    }

    let id = `${BOOK}.${slugOf(name)}`;
    let n = 2;
    while (seen.has(id)) id = `${BOOK}.${slugOf(name)}${n++}`;
    seen.add(id);

    // "Level 3 Bard (Troubadour)" is not a monster of its own: it is one step
    // of a creature the book prints a block per step for. Recording the group
    // and the step lets the import build ONE generator instead of three
    // unrelated actors. Derived from the register NAME, which this tool wrote
    // — never from the page, which says nothing about grouping.
    const step = /^Level\s+(\d+)\s+([A-Za-z][A-Za-z-]*)\s*(?:\(([^)]*)\))?$/.exec(name);
    const meta = step
      ? {
          templateGroup: slugOf(step[2]),
          templateName: step[2],
          templateAxis: "level",
          templateKey: step[1],
          templateLabel: `Level ${step[1]}${step[3] ? ` (${step[3]})` : ""}`.slice(0, 58),
        }
      : null;

    rows.push({
      id,
      kind: "kind.oseMonster",
      book: BOOK,
      name,
      ...(meta ? { meta } : {}),
      // The anchor is what the PAGE says, not the tidied name: an expect must
      // match the extraction byte for byte.
      anchor: { display: (above?.text ?? name).slice(0, 58) },
      pages: [page],
      assists: {
        block: { page, box: c.box },
        ...(prose.length ? { prose: prose.map((box) => ({ page, box })) } : {}),
      },
    });
    onPage.push({ row: rows[rows.length - 1], regions, box: c.box });
  }

  // ART, once the page's entries are all known. A cookbook entry POINTS at its
  // illustration — page, XObject name and box — so all this has to decide is
  // which entry each picture belongs to, and it decides it once per page rather
  // than by a rule applied blindly per creature.
  //
  // Containment first: a picture standing inside an entry's own region is that
  // entry's, and regions do not overlap so nothing can be claimed twice. What
  // is left over is placed with the nearest entry that still has none — a
  // bestiary sets a portrait in the margin beside its creature as often as
  // within it, and leaving those unused was throwing away two thirds of what
  // the books actually contain.
  const claimed = new Set();
  const centre = (a) => ({ x: a.x + a.w / 2, y: a.y + a.h / 2 });
  const attach = (target, a) => {
    claimed.add(a);
    target.row.assists.art = { page, name: a.name, box: { x0: a.x, x1: a.x + a.w, y0: a.y, y1: a.y + a.h } };
  };

  for (const a of [...placements].sort((x, y) => y.w * y.h - x.w * x.h)) {
    const p = centre(a);
    const home = onPage.find(
      (t) => !t.row.assists.art && t.regions.some((r) => p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1),
    );
    if (home) attach(home, a);
  }
  for (const a of [...placements].sort((x, y) => y.w * y.h - x.w * x.h)) {
    if (claimed.has(a)) continue;
    const p = centre(a);
    let best = null;
    let bestD = Infinity;
    for (const t of onPage) {
      if (t.row.assists.art) continue;
      const bx = (t.box.x0 + t.box.x1) / 2;
      const by = (t.box.y0 + t.box.y1) / 2;
      const d = Math.hypot(bx - p.x, by - p.y);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    if (best) attach(best, a);
  }
}

console.error(`${BOOK}: ${rows.length} creature box(es) across pages ${from}-${to}`);
for (const s of skipped) console.error(`  skipped p.${s.page} — ${s.why}`);
if (skipped.length) console.error(`  (${skipped.length} need hand authoring; the locator would not vouch for them)`);

if (!WRITE) {
  for (const r of rows.slice(0, 12)) {
    const pr = r.assists.prose?.length ?? 0;
    console.error(`  ${r.id}  p.${r.pages[0]}  prose:${pr}${r.assists.art ? " art" : ""}`);
  }
  console.error(`\n(dry run — pass --write to emit register/${BOOK}/)`);
  process.exit(0);
}

const dir = path.join(HERE, "..", "..", "register", BOOK);
fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, `p${from}-p${to}-creatures.json`);
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
