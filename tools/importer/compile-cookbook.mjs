/**
 * Cookbook compiler — the OFFLINE smart side (see docs/importer/RECIPES.md stage 4,
 * docs/importer/COOKBOOK.md for the output schema). Resolves every register entry
 * against the LOCAL reference PDFs into explicit, geometry-addressed
 * instructions the dumb executor replays: claim boxes, paragraph breaks,
 * per-stat value boxes, attack segments, glyph-color picks, art criteria.
 *
 * ALL judgment lives here (column detection, anchor search, paragraph
 * segmentation, name stemming, color-run matching) — none of it ships as
 * code, only as data. Requires C:\Proj\acks-reference; never CI.
 *
 * Usage: node tools/compile-cookbook.mjs [book] [--out <dir>]
 *        (default: all books with entries, written into cookbook/)
 *
 * A `book` argument narrows what is EXTRACTED, not what is written: the
 * content-type cookbooks span every book, so a book-scoped run can only be
 * written to a scratch `--out` dir. Writing one into `cookbook/` is refused
 * (see the content-cookbook write below) rather than quietly deleting the
 * books it did not compile.
 * Emits: <out>/<book>.json + <out>/registers.json; report to stderr.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openBook, pageItems, listHeadings, detectColumns, colOf, glyphColorRuns, pageArtPlacements } from "../../scripts/importer/extract.mjs";
import { runsIn, joinRuns, attackModel } from "../../scripts/importer/executor.mjs";
import { rowsByY, slugLabel } from "../../scripts/importer/table-extract.mjs";
import { BOOKS, citeFor, fingerprintWarning } from "../../scripts/importer/books.mjs";
import { FILES, OSE_FILES } from "./reference-lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** A JSON file, or null when it is absent or unreadable (readJson throws). */
function readJsonIfAny(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

const REGISTER = path.join(HERE, "..", "..", "register");

/**
 * Args: an optional book id to compile alone, and `--out <dir>` to redirect
 * every write. The output dir is read back as well as written (prior compiles
 * are folded in, and index.json is built from the directory listing), so it is
 * one dir, not a write-only sink: pointing it at an empty scratch dir yields a
 * from-scratch compile, which is exactly what tools/check-cookbook-drift.mjs
 * needs to diff against what is committed.
 */
const argv = process.argv.slice(2);
const positional = [];
let outArg = null; // null = no --out; undefined = --out with nothing after it
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--out") outArg = argv[++i];
  else if (a.startsWith("--out=")) outArg = a.slice("--out=".length);
  else positional.push(a);
}
// Never silently fall back to cookbook/ on a malformed --out: a caller that
// asked for a scratch dir and got the real one would overwrite the very files
// it meant to compare against.
if (outArg === undefined || outArg === "") {
  console.error("compile-cookbook: --out needs a directory");
  process.exit(2);
}
const COOKBOOK = outArg ? path.resolve(outArg) : path.join(HERE, "..", "..", "cookbook");

const HEADING_MIN_H = 12; // mirrors extract.mjs
// Definition bodies are 9pt prose (+ ~5pt superscript ordinals). Italic
// pull-quote/maxim blocks between entries print at ~10.5pt and are NOT part of
// the entry, so definition body collection caps below them.
// The ceiling is PER BOOK: RR/JJ table headers print at exactly 10 and must
// stay out of RR/JJ bodies (at a global 10.5 the fighter's progression header
// row leaked into Castle's continuation paragraph), while BTA sets its whole
// body at exactly 10 — at a global 10 no BTA item survived the gate and no
// BTA run-in anchored. The definition dispatcher sets the working value from
// the entry's book; compilation is strictly sequential, so the module-level
// slot never sees two entries at once.
const DEF_BODY_MAX_H_BY_BOOK = { bta: 10.5 };
let DEF_BODY_MAX_H = 10;
// Body text starts below the running head; definition blocks are COLUMN-FLOWED,
// so one that reaches the bottom of its column continues at the top of the next.
const DEF_TOP_BAND = 60;

/**
 * What stops a continuation. `isAnchor` knows only the heading style that ends
 * a block of THIS kind, which is not the only thing that can end one: a class
 * power flowing overleaf runs into "Code of Behavior" and the template table,
 * headings of a different kind entirely, and the flow read straight through
 * them to the next power — carrying a whole class's remaining text under one
 * ability's name. Prose continues across a column and across a page; it never
 * continues across a heading. Body runs stay below the display-heading size,
 * so anything at or above it ends the flow whatever kind it belongs to.
 */
const endsFlow = (it, isAnchor) => isAnchor(it) || it.h >= HEADING_MIN_H;

/** The font a page sets its body in: the alias most of its body-size runs use. */
function dominantAlias(pd) {
  const counts = new Map();
  for (const it of pd.items.filter((i) => i.h < DEF_BODY_MAX_H)) {
    counts.set(it.alias, (counts.get(it.alias) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** The first display heading in a page's first column — a hard stop for a
 *  block continuing onto it, whatever the sub-headings say. */
function headingTop(pd, cols) {
  const head = pd.items
    .filter((it) => it.h >= HEADING_MIN_H && colOf(it.x, cols) === 0 && it.y > DEF_TOP_BAND)
    .sort((a, b) => a.y - b.y)[0];
  return head ? head.y - 4 : null;
}

/**
 * Every run that sits ALONE on its line at body size — the shape a `subheading`
 * entry is anchored on, and the shape that ends one.
 *
 * Shared with the page-turn continuation because a font alias cannot answer the
 * question across a page boundary: pdf.js names fonts per PAGE, so the face
 * that is `g_d0_f4` on one page is a different alias on the next, and a stop
 * test built on the alias silently runs the block to the foot of the page.
 */
function soloLines(pd, cols) {
  const lines = new Map();
  for (const it of pd.items.filter((i) => i.h < DEF_BODY_MAX_H)) {
    const k = `${colOf(it.x, cols)}:${Math.round(it.y / 3)}`;
    if (!lines.has(k)) lines.set(k, []);
    lines.get(k).push(it);
  }
  return [...lines.values()].filter((a) => a.length === 1).map((a) => a[0]);
}

/**
 * The continuation of a column-flowed definition block: everything in the NEXT
 * column above the first anchor there. Returns [] when the block ended normally
 * (a stop anchor was found in its own column) or there is no next column.
 * `isAnchor` identifies the heading style that ends a block in this kind.
 */
function columnFlow(pd, cols, col, stopFound, isAnchor) {
  if (stopFound || col + 1 >= cols.length) return [];
  const next = col + 1;
  const firstAnchor = pd.items
    .filter((it) => colOf(it.x, cols) === next && it.y > DEF_TOP_BAND && endsFlow(it, isAnchor))
    .sort((a, b) => a.y - b.y)[0];
  const yMax = firstAnchor ? firstAnchor.y - 4 : pd.height;
  return pd.items.filter(
    (it) => it.h < DEF_BODY_MAX_H && colOf(it.x, cols) === next && it.y > DEF_TOP_BAND && it.y < yMax,
  );
}

/**
 * The overleaf continuation: a block that reaches the bottom of the LAST column
 * resumes in the first column of the next page. Returns null when there is
 * nothing to continue onto.
 */
async function pageFlow(doc, page, isAnchor) {
  if (page + 1 > doc.numPages) return null;
  const pd2 = await pageItems(doc, page + 1);
  const cols2 = detectColumns(pd2.items);
  const first = pd2.items
    .filter((it) => colOf(it.x, cols2) === 0 && it.y > DEF_TOP_BAND && endsFlow(it, isAnchor))
    .sort((a, b) => a.y - b.y)[0];
  const yMax = first ? first.y - 4 : pd2.height;
  const items = pd2.items.filter(
    (it) => it.h < DEF_BODY_MAX_H && colOf(it.x, cols2) === 0 && it.y > DEF_TOP_BAND && it.y < yMax,
  );
  return { pd: pd2, cols: cols2, items, page: page + 1 };
}
const LABEL_RE = /^[A-Z][A-Za-z ()'/]{0,28}:$/;
const DICE_RE = /\d*d\d+(?:[×xX]\d+)?(?:[+-]\d+)?/; // mirrors scripts/executor.mjs
const cleanSeg = (s) => (s ?? "").replace(/[-′″]/g, "").replace(/\s+/g, " ").trim();
// A real damage segment: dice, a flat number, or a "by weapon" placeholder
// (mirror of executor.isDamageSeg — must stay identical so segment COUNT
// matches at runtime and color picks line up).
const isDamageSeg = (s) => {
  const c = cleanSeg(s);
  return DICE_RE.test(c) || /^\d+$/.test(c) || /weapon/i.test(c);
};
const inBoxRaw = (it, box) => it.x >= box.x0 && it.x <= box.x1 && it.y >= box.y0 && it.y <= box.y1;

/** Top of the MM body area: above this sit the running head and chapter tab. */
const MM_BODY_TOP = 50;

/** How far above a claimed box that box's own caption line can sit. */
const CAPTION_BAND = 24;

/**
 * Drop the caption line that labels a claimed box, and return what is really
 * unaccounted for.
 *
 * A stat column and a grid each carry a line naming them — "Amphisbaena Primary
 * Characteristics" — which binds nothing and is furniture in the same sense as
 * a running head. Reporting it made 276 of the Monstrous Manual's 289 residue
 * warnings identical and meaningless, and hid the thirteen entries where real
 * PROSE was going unclaimed.
 *
 * Only ONE line per band is dropped, and only a line lying wholly inside it. A
 * paragraph the boxes genuinely missed runs to several lines, so it still warns
 * — quieter by its first line, never silent. That is the property that matters:
 * this suppresses a known label, not an unknown quantity of text.
 */
function dropCaptionLines(residual, boxes) {
  if (!residual.length || !boxes.length) return residual;
  const bands = boxes.map((b) => ({ x0: b.x0, x1: b.x1, y0: b.y0 - CAPTION_BAND, y1: b.y0 }));

  const lines = [];
  for (const it of [...residual].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const line = lines.find((l) => Math.abs(l.y - it.y) <= 3);
    if (line) line.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }

  const dropped = new Set();
  const used = new Set();
  for (const line of lines) {
    const band = bands.findIndex((b, i) => !used.has(i) && line.items.every((it) => inBoxRaw(it, b)));
    if (band < 0) continue;
    used.add(band);
    for (const it of line.items) dropped.add(it);
  }
  return residual.filter((it) => !dropped.has(it));
}

/** Every box an entry's compiled instructions claim on one page. */
function claimedBoxesOn(fields, page) {
  const out = [];
  for (const instr of Object.values(fields)) {
    if (instr.op === "text") {
      for (const para of instr.paras ?? []) if ((para.page ?? instr.page) === page && para.box) out.push(para.box);
    } else if (instr.op === "attacks" && instr.page === page) {
      if (instr.attacksBox) out.push(instr.attacksBox);
      if (instr.damageBox) out.push(instr.damageBox);
    } else if (instr.page === page) {
      if (instr.box) out.push(instr.box);
      for (const b of instr.boxes ?? []) out.push(b);
    }
  }
  return out;
}

const warns = [];
const warn = (s) => {
  warns.push(s);
  console.error(`WARN ${s}`);
};

/* -------------------------------------------- */
/*  Register loading                            */
/* -------------------------------------------- */

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

function loadRegister() {
  const entries = [];
  const kinds = {};
  const refs = {};
  for (const dirent of fs.readdirSync(REGISTER, { withFileTypes: true })) {
    if (!dirent.isDirectory() || dirent.name.startsWith("_")) continue;
    for (const f of fs.readdirSync(path.join(REGISTER, dirent.name)).sort()) {
      if (!f.endsWith(".json")) continue;
      for (const e of readJson(path.join(REGISTER, dirent.name, f))) entries.push(e);
    }
  }
  const kindsDir = path.join(REGISTER, "_kinds");
  if (fs.existsSync(kindsDir)) {
    for (const f of fs.readdirSync(kindsDir).sort()) {
      if (!f.endsWith(".json")) continue;
      const k = readJson(path.join(kindsDir, f));
      kinds[k.id] = k;
    }
  }
  const refsDir = path.join(REGISTER, "_refs");
  if (fs.existsSync(refsDir)) {
    for (const f of fs.readdirSync(refsDir).sort()) {
      if (!f.endsWith(".json")) continue;
      const r = readJson(path.join(refsDir, f));
      refs[r.registry] = r;
    }
  }
  return { entries, kinds, refs };
}

/** register/_refs -> cookbook registers.json (tables + nodes). */
function compileRegisters(refs) {
  const tables = {};
  const nodes = {};
  for (const [name, reg] of Object.entries(refs)) {
    if (reg.shape === "table") {
      tables[name] = reg.table;
      continue;
    }
    const table = {};
    for (const [token, row] of Object.entries(reg.tokens ?? {})) {
      const key = reg.tokenEncoding === "puaHex" ? String.fromCodePoint(parseInt(token, 16)) : token;
      table[key] = row;
    }
    tables[name] = table;
    const role = reg.shape === "keyword" ? "keyword" : "definition";
    for (const [id, node] of Object.entries(reg.nodes ?? {})) {
      if (nodes[id]) warn(`duplicate node ${id} (registry ${name})`);
      nodes[id] = { role, ...node };
    }
  }
  return { schema: "acks-cookbook/2", tables, nodes, derive: DERIVE_PATTERNS };
}

/**
 * Shipped vocabulary for values the books state in PROSE rather than in a
 * labelled field. The PATTERN ships; the number it finds never does — it is
 * matched against the reader's own extracted text at runtime, exactly like the
 * defense and effect scans.
 *
 * `powerValue` is the custom-class build cost ("counts as 2 1/2 custom
 * powers"). It used to be resolved offline and shipped as a number, which put
 * book values in the module; this is the fix.
 */
const DERIVE_PATTERNS = {
  powerValue: {
    // \s* at every boundary: the extracted join drops inter-run spaces.
    pattern: "counts\\s*as\\s+((?:\\d+\\s+)?\\d+\\s*/\\s*\\d+|\\d+)\\s*(?:a\\s+)?(?:custom\\s+)?powers?\\b",
    as: "count",
  },
};

/* -------------------------------------------- */
/*  Geometry helpers                            */
/* -------------------------------------------- */

/** Cluster items into lines by y (±2), sorted by y. */
function toLines(items) {
  const lines = [];
  for (const it of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const line = lines.find((l) => Math.abs(l.y - it.y) <= 2);
    if (line) {
      line.items.push(it);
    } else {
      lines.push({ y: it.y, items: [it] });
    }
  }
  return lines.sort((a, b) => a.y - b.y);
}

/**
 * Text-assembly fixes for a run sequence (the executor's exact enumeration —
 * runsIn/joinRuns imported for parity). Judgment lives here; ordinals ship.
 *  - same-line gap > 1pt        -> joinSpace (pdf runs omit inter-word spaces)
 *  - line change, no hyphen     -> joinSpace
 *  - line change after hyphen   -> mergeHyphen when the next run starts
 *    lowercase (plain hyphenation), else keep the hyphen (compound words).
 */
function computeFixes(runs) {
  const joinSpace = [];
  const mergeHyphen = [];
  for (let i = 0; i < runs.length - 1; i++) {
    const a = runs[i];
    const b = runs[i + 1];
    // A superscript ordinal sits ~4pt above its baseline but belongs to the SAME
    // word ("1"+"st"), so judge it by the x-gap like any same-line neighbour
    // rather than defaulting to a space and printing "1 st level".
    const superscript = Math.min(a.h, b.h) < Math.max(a.h, b.h) * 0.75;
    const sameLine = Math.abs(a.y - b.y) <= 2 || superscript;
    if (sameLine) {
      const gap = b.x - (a.x + (a.w ?? 0));
      if (gap > 1 && !/\s$/.test(a.str)) joinSpace.push(i);
    } else if (/-\s*$/.test(a.str) && /^[a-z]/.test(b.str.trimStart())) {
      mergeHyphen.push(i);
    } else if (!/\s$/.test(a.str)) {
      joinSpace.push(i);
    }
  }
  const fixes = {};
  if (joinSpace.length) fixes.joinSpace = joinSpace;
  if (mergeHyphen.length) fixes.mergeHyphen = mergeHyphen;
  return Object.keys(fixes).length ? fixes : null;
}

/**
 * Attach computed fixes to an instruction (or a text para). `dropSet` marks
 * items (e.g. divider-heading lines caught inside a row box) to ship as
 * `fixes.drop` ordinals so the executor discards them.
 */
function withFixes(instr, pd, dropSet, stripMap) {
  const runs = runsIn(pd, instr);
  const fixes = computeFixes(runs) ?? {};
  if (dropSet) {
    const drop = runs.map((r, i) => (dropSet.has(r) ? i : -1)).filter((i) => i >= 0);
    if (drop.length) fixes.drop = drop;
  }
  // How many leading characters of a run belong to the heading rather than the
  // prose. Ships as a COUNT, not the text — the characters live in the reader's
  // book, and the recipe only says how many of them to skip.
  if (stripMap?.size) {
    const strip = {};
    runs.forEach((r, i) => {
      if (stripMap.has(r)) strip[i] = stripMap.get(r);
    });
    if (Object.keys(strip).length) fixes.stripPrefix = strip;
  }
  if (Object.keys(fixes).length) instr.fixes = fixes;
  return instr;
}

/** Paragraph boxes from body lines: break where the line gap opens up. */
function paragraphBoxes(lines, x0, x1) {
  if (!lines.length) return [];
  const gaps = [];
  for (let i = 1; i < lines.length; i++) gaps.push(lines[i].y - lines[i - 1].y);
  const median = gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 12;
  const paras = [[lines[0]]];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].y - lines[i - 1].y > median * 1.6) paras.push([]);
    paras[paras.length - 1].push(lines[i]);
  }
  return paras.map((ls) => ({
    box: { x0, x1, y0: ls[0].y - 3, y1: ls[ls.length - 1].y + 3 },
  }));
}

/* -------------------------------------------- */
/*  Attack-name stemming (compiler judgment)    */
/* -------------------------------------------- */

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const camel = (s) =>
  s.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean)
    .map((w, i) => (i ? cap(w.toLowerCase()) : w.toLowerCase())).join("");

/* -------------------------------------------- */
/*  Monster compilation                         */
/* -------------------------------------------- */

async function compileMonster(doc, entry, kindRow, glyphChars) {
  // Per-entry ASSISTS (docs/importer/RECIPES.md): chef-authored one-off directions the
  // compiler honors before its own heuristics. Supported: anchor (exact
  // display text), statPage, spoilsPage, noSpoils, noArt, descStopHeading.
  const assists = entry.assists ?? {};
  const page = entry.pages[0];
  const pd = await pageItems(doc, page);
  const cols = detectColumns(pd.items);

  const anchors = listHeadings(pd).filter((a) => a.mode === "display");
  // Fallback ladder for outline titles that differ from the printed heading
  // (parent/variant pages: "Statue, Animated Bronze" prints as "BRONZE" under
  // a "STATUE, ANIMATED" parent; "(Overview)" suffixes never print). Try the
  // full title, then without parentheticals, then progressively shorter word
  // tails. The string that MATCHES becomes the shipped expect text.
  const candidates = [];
  if (assists.anchor) candidates.push(assists.anchor);
  candidates.push(entry.anchor.display);
  const noParen = entry.anchor.display.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
  if (noParen && noParen !== entry.anchor.display) candidates.push(noParen);
  const words = noParen.replace(/,/g, "").split(/\s+/).filter(Boolean);
  for (let i = 1; i < words.length; i++) candidates.push(words.slice(i).join(" "));
  let anchor = null;
  let matchedText = entry.anchor.display;
  for (const c of candidates) {
    anchor = anchors.find((a) => a.text.toLowerCase().startsWith(c.toLowerCase()));
    if (anchor) {
      matchedText = c;
      break;
    }
  }
  if (!anchor) throw new Error(`display anchor "${entry.anchor.display}" not found on p.${page}`);
  if (matchedText !== entry.anchor.display) console.error(`NOTE ${entry.id}: anchored via fallback "${matchedText}"`);

  const colX = cols[anchor.col];
  const nextX = cols[anchor.col + 1];
  const proseBox = { x0: colX - 5, x1: nextX ? nextX - 6 : pd.width };
  // Long names WRAP onto a second display line ("FAERIE, BROWNIE" /
  // "(BOGGART)") — absorb same-column display lines within one heading
  // line-height into the anchor block instead of treating them as the next
  // monster's heading (which would empty the description region).
  let anchorEndY = anchor.y;
  const laterHeads = [];
  for (const h of anchors.filter((a) => a.col === anchor.col && a.y > anchor.y + 2).sort((a, b) => a.y - b.y)) {
    if (h.y - anchorEndY <= 26) anchorEndY = h.y;
    else laterHeads.push(h);
  }
  let stopY = laterHeads[0]?.y ? laterHeads[0].y - 4 : pd.height;
  if (assists.descStopHeading) {
    const wanted = (h) => h.text.toLowerCase().startsWith(assists.descStopHeading.toLowerCase());
    const stopHead = laterHeads.find(wanted);
    if (stopHead) stopY = stopHead.y - 4;
    // A long entry's stop heading can sit in a column the description SPILLS
    // into. Naming it there says the description runs PAST this column's
    // sub-headings — "Lycanthropic Forms" is part of the entry, not the start
    // of something else — so this column runs to the foot of the page and the
    // named heading bounds the column it actually sits in.
    else if (assists.descColumns > 1 && anchors.some((a) => a.col > anchor.col && wanted(a))) {
      stopY = pd.height;
    } else {
      warn(`${entry.id}: assists.descStopHeading "${assists.descStopHeading}" not found`);
    }
  }

  const bodyIn = (p, x0, x1, y0, y1) =>
    p.items.filter((it) => it.h < HEADING_MIN_H && it.x >= x0 && it.x <= x1 && it.y > y0 && it.y < y1);

  // Prose column body; Spoils splits the region so claims never overlap.
  const proseItems = bodyIn(pd, proseBox.x0, proseBox.x1, anchorEndY + 2, stopY);
  let spoilsAnchor = proseItems.find((it) => it.str.trim() === "Spoils");
  let spoilsPd = pd;
  let spoilsPage = page;
  let spoilsBox = spoilsAnchor
    ? { x0: proseBox.x0, x1: proseBox.x1, y0: spoilsAnchor.y - 3, y1: stopY }
    : null;
  const descEnd = spoilsAnchor ? spoilsAnchor.y - 3 : stopY;
  const descItems = proseItems.filter((it) => it.y < descEnd);

  const fields = {};
  fields.name = {
    op: "expect", page,
    box: { x0: proseBox.x0, x1: proseBox.x1, y0: anchor.y - 16, y1: anchorEndY + 6 },
    text: matchedText,
  };
  // Description SECTIONS: the MM prints run-in section labels as their own
  // bold runs (same mechanism as the "Spoils" anchor). Classify each paragraph
  // by the nearest label above it; leading unlabeled prose = "appearance".
  // Entries with NO labels are flagged for the classification agents.
  const SECTION_LABELS = {
    "Combat": "combat", "Ecology": "ecology", "Encounter": "encounter",
    "Special Rules": "specialRules", "Lair": "lair", "Appearance": "appearance",
    "Behavior": "behavior", "Legends": "lore", "Lore": "lore",
  };
  const sectionAnchors = descItems
    .filter((it) => SECTION_LABELS[it.str.trim()])
    .sort((a, b) => a.y - b.y);
  const classify = (paras, labels) => {
    for (const p of paras) {
      const above = [...labels].reverse().find((a) => a.y <= p.box.y0 + 8);
      p.section = above ? SECTION_LABELS[above.str.trim()] : "appearance";
      const owns = labels.find((a) => a.y >= p.box.y0 && a.y <= p.box.y1);
      if (owns) p.dropText = owns.str.trim();
    }
    return paras;
  };
  const descParas = classify(
    paragraphBoxes(toLines(descItems), proseBox.x0, proseBox.x1).map((p) => withFixes(p, pd)),
    sectionAnchors,
  );

  // An entry too long for one column continues in the next. This is AUTHORED
  // per entry rather than detected, because everywhere else in the book the
  // next column holds the stat block — a rule that guessed would claim it, and
  // claim it wrongly. Each spilled column runs from the top of the body area to
  // its own first heading, which is exactly where a `descStopHeading` sits when
  // a chef named one.
  const spill = Math.max(1, assists.descColumns ?? 1) - 1;
  for (let k = 1; k <= spill; k++) {
    const cx = cols[anchor.col + k];
    if (cx === undefined) break;
    const nx = cols[anchor.col + k + 1];
    const x0 = cx - 5;
    const x1 = nx ? nx - 6 : pd.width;
    const head = anchors.filter((a) => a.col === anchor.col + k).sort((a, b) => a.y - b.y)[0];
    const items = bodyIn(pd, x0, x1, MM_BODY_TOP, head ? head.y - 4 : pd.height);
    if (!items.length) continue;
    const labels = items.filter((it) => SECTION_LABELS[it.str.trim()]).sort((a, b) => a.y - b.y);
    descParas.push(...classify(paragraphBoxes(toLines(items), x0, x1).map((p) => withFixes(p, pd)), labels));
  }
  if (!sectionAnchors.length && descParas.length > 2) {
    console.error(`NOTE ${entry.id}: no section labels in description (${descParas.length} paras) — agent classification candidate`);
  }
  fields.description = { op: "text", page, paras: descParas };
  /* --- stat column (with two-page fallback for multi-page monsters) --- */
  const labelsOf = (p, pcols) => {
    const li = p.items.filter((it) => it.h < HEADING_MIN_H && LABEL_RE.test(it.str.trim()));
    const idx = [...new Set(li.map((it) => colOf(it.x, pcols)))]
      .map((c) => [c, li.filter((it) => colOf(it.x, pcols) === c).length])
      .sort((a, b) => b[1] - a[1])[0]?.[0];
    return { labels: li.filter((it) => colOf(it.x, pcols) === idx).sort((a, b) => a.y - b.y), idx };
  };

  let statPd = pd;
  let statPage = page;
  let statCols = cols;
  let { labels: statLabels, idx: statColIdx } = labelsOf(pd, cols);
  // Prose column on the stat page, for the value-region bound (anchor page:
  // the anchor's own column).
  let statProseX = colX;
  if ((assists.statPage && assists.statPage !== page) || (statLabels.length < 8 && page + 1 <= doc.numPages)) {
    const pd2 = await pageItems(doc, assists.statPage ?? page + 1);
    const cols2 = detectColumns(pd2.items);
    const r2 = labelsOf(pd2, cols2);
    if (r2.labels.length >= 8 || (assists.statPage && r2.labels.length)) {
      statPd = pd2;
      statPage = assists.statPage ?? page + 1;
      statCols = cols2;
      statLabels = r2.labels;
      statColIdx = r2.idx;
      // Dominant non-stat column = the continuation prose on this page.
      const other = cols2
        .map((cx, i) => [i, pd2.items.filter((it) => it.h < HEADING_MIN_H && colOf(it.x, cols2) === i).length])
        .filter(([i]) => i !== statColIdx)
        .sort((a, b) => b[1] - a[1])[0];
      statProseX = other ? cols2[other[0]] : -1;
      console.error(`NOTE ${entry.id}: stat block found on p.${statPage} (multi-page monster)`);
    }
  }
  const statX0 = statCols[statColIdx] - 5;
  // Mirrored spreads: values sit right of the labels. When the prose column is
  // to the RIGHT of the stat block, stop before it; otherwise (prose left,
  // stats on the outer half) values run to the page edge.
  const statX1 = statProseX > statCols[statColIdx] ? statProseX - 6 : statPd.width;

  // Spoils may live near the stat block on the stat page instead — or wherever
  // an assist points.
  if (assists.noSpoils) {
    spoilsAnchor = null;
    spoilsBox = null;
  }
  if (!spoilsAnchor && !assists.noSpoils && (statPd !== pd || assists.spoilsPage)) {
    const spPd = assists.spoilsPage ? await pageItems(doc, assists.spoilsPage) : statPd;
    const spPage = assists.spoilsPage ?? statPage;
    const spCols = assists.spoilsPage ? detectColumns(spPd.items) : statCols;
    const sp2 = spPd.items.find((it) => it.h < HEADING_MIN_H && it.str.trim() === "Spoils");
    if (sp2) {
      const spCol = colOf(sp2.x, spCols);
      const spX0 = spCols[spCol] - 5;
      const spX1 = spCols[spCol + 1] ? spCols[spCol + 1] - 6 : spPd.width;
      const later2 = listHeadings(spPd)
        .filter((a) => a.mode === "display" && a.y > sp2.y)
        .sort((a, b) => a.y - b.y);
      spoilsAnchor = sp2;
      spoilsPd = spPd;
      spoilsPage = spPage;
      spoilsBox = { x0: spX0, x1: spX1, y0: sp2.y - 3, y1: later2[0]?.y ? later2[0].y - 4 : spPd.height };
    } else if (assists.spoilsPage) {
      warn(`${entry.id}: assists.spoilsPage ${assists.spoilsPage} has no "Spoils" header`);
    }
  }
  if (spoilsBox) {
    fields.spoils = withFixes({
      op: "value", page: spoilsPage, pattern: "spoilList",
      effectsTable: kindRow.fields.spoils.effectsTable,
      dropText: "Spoils",
      box: spoilsBox,
    }, spoilsPd);
  }

  // Stat block ends where the column's line flow breaks after the last label.
  const statColItems = bodyIn(statPd, statX0, statX1, 0, statPd.height).sort((a, b) => a.y - b.y);
  const lastLabelY = statLabels[statLabels.length - 1]?.y ?? 0;
  let statEnd = lastLabelY + 3;
  for (const it of statColItems) {
    if (it.y <= lastLabelY) continue;
    if (it.y - statEnd > 18) break;
    statEnd = Math.max(statEnd, it.y + 3);
  }

  const rows = kindRow.fields.stats.rows;
  const speedCfg = kindRow.fields.stats.speedRows;
  const atkCfg = kindRow.fields.stats.attackRows;
  let attacksInstr = null;
  let damageInstr = null;
  const unmapped = [];

  // Divider mini-headings ("<Name> Encounters", "<Name> Secondary/Primary
  // Characteristics") sit BETWEEN stat rows; whichever row box catches one
  // ships drop ordinals so the executor discards its runs.
  const dividerItems = new Set();
  for (const line of toLines(statColItems)) {
    // Smallcaps runs join WITHOUT spaces ("secondarycharacteristics"), so
    // compare space-stripped.
    const lineText = line.items.map((i) => i.str).join("").replace(/\s+/g, "").toLowerCase();
    if (/(secondarycharacteristics|primarycharacteristics|encounters)$/.test(lineText) && !lineText.includes(":")) {
      for (const it of line.items) dividerItems.add(it);
    }
  }

  // The MM CENTERS a stat label between its value's lines when a value wraps,
  // so a wrapped value's first line sits ABOVE its own label (confirmed
  // p298: Attacks value line y=396.7 vs label y=401.2). Assign each row the
  // band bounded by the MIDPOINTS to its neighbouring labels — this captures
  // lines above and below the label and cleanly separates adjacent fields.
  statLabels.forEach((label, i) => {
    const labelText = label.str.trim();
    const name = labelText.slice(0, -1);
    const prevY = i > 0 ? statLabels[i - 1].y : label.y - 12;
    const y0 = (prevY + label.y) / 2;
    const y1 = i + 1 < statLabels.length ? (label.y + statLabels[i + 1].y) / 2 : statEnd;
    const box = { x0: statX0, x1: statX1, y0, y1 };
    const base = { op: "value", page: statPage, box, dropText: labelText };

    if (name === atkCfg.attacks) {
      attacksInstr = base;
      return;
    }
    if (name === atkCfg.damage) {
      damageInstr = base;
      return;
    }
    if (name.startsWith(speedCfg.prefix)) {
      const kind = /\(([^)]+)\)/.exec(name)?.[1] ?? "land";
      fields[`stats.speed${cap(camel(kind))}`] = withFixes({ ...base, pattern: speedCfg.pattern }, statPd, dividerItems);
      return;
    }
    const row = rows[name];
    if (row) {
      fields[`stats.${row.field}`] = withFixes({
        ...base,
        pattern: row.pattern,
        ...(row.table ? { table: row.table } : {}),
        ...(row.parenTable ? { parenTable: row.parenTable } : {}),
        ...(row.stripRoll ? { stripRoll: true } : {}),
      }, statPd, dividerItems);
    } else {
      unmapped.push(name);
      fields[`stats._raw.${camel(name)}`] = withFixes({ ...base, pattern: "raw" }, statPd, dividerItems);
    }
  });

  /* --- attacks + damage -> attackList with color picks --- */
  if (attacksInstr && damageInstr) {
    // Executor-parity joins (same enumeration the runtime will perform).
    const aRuns = runsIn(statPd, { box: attacksInstr.box });
    const dRuns = runsIn(statPd, { box: damageInstr.box });
    const aFixes = computeFixes(aRuns);
    const dFixes = computeFixes(dRuns);
    const attacksText = joinRuns(aRuns, aFixes ?? {}, attacksInstr.dropText).replace(/\s+/g, " ").trim();
    const damageRaw = joinRuns(dRuns, dFixes ?? {}, damageInstr.dropText);

    // Names + damage are parsed at RUNTIME by the shared attackModel; the
    // compiler only needs the ordered flat damage-segment list to align glyph
    // colours to the same enumeration the executor will produce. A chef
    // `assists.attacks` normalizes the routine string for rare formats.
    const attacksParsed = assists.attacks ?? attacksText;
    const segments = attackModel(attacksParsed, damageRaw).flatDamage;
    // Per-segment printed COLOR annotation ("this glyph prints red") — an
    // authoring-time observation the executor merely maps through the color
    // table. The runtime never scrapes colors. Attribution of runs to the
    // damage line: page glyph ITEMS in STORY order (prose frame first, then
    // stat frame — InDesign emits stories in that order regardless of the
    // mirrored page side) pair 1:1 with glyph-bearing runs in stream order;
    // counts + codepoints must check out, else the annotation is omitted
    // (quality null) and a chef supplies it by hand via assists.
    let colors = null;
    const segGlyphs = segments.map((seg) => [...seg].find((ch) => glyphChars.has(ch)) ?? null);
    if (segGlyphs.some(Boolean)) {
      const proseColIdx2 = statProseX >= 0 ? colOf(statProseX + 1, statCols) : -1;
      const storyRank = (it) => (colOf(it.x, statCols) === proseColIdx2 ? 0 : 1);
      const pageGlyphItems = statPd.items
        .filter((it) => [...it.str].some((ch) => glyphChars.has(ch)))
        .sort((a, b) => storyRank(a) - storyRank(b) || a.y - b.y || a.x - b.x);
      const runs = await glyphColorRuns(doc, statPage, [...glyphChars].map((ch) => ch.codePointAt(0)));
      const aligned =
        pageGlyphItems.length === runs.length &&
        pageGlyphItems.every((it, j) => {
          const g = [...it.str].find((ch) => glyphChars.has(ch));
          return g && runs[j].text.includes(g);
        });
      if (aligned) {
        const inDamage = pageGlyphItems
          .map((it, j) => ({ it, j }))
          .filter(({ it }) => inBoxRaw(it, damageInstr.box));
        let k = 0;
        const segColors = segments.map((seg, i) => (segGlyphs[i] ? (runs[inDamage[k++]?.j]?.fill ?? null) : null));
        if (segColors.some(Boolean)) colors = segColors;
        if (segColors.some((c, i) => segGlyphs[i] && !c)) {
          warn(`${entry.id}: damage-box glyph items short of segments — some quality null (chef assist)`);
        }
      } else {
        warn(`${entry.id}: glyph item/run attribution checksum failed (${pageGlyphItems.length} items vs ${runs.length} runs) — quality null (chef assist)`);
      }
    }

    fields.attacks = {
      op: "attacks", page: statPage,
      attacksBox: attacksInstr.box, damageBox: damageInstr.box,
      dropText: { attacks: attacksInstr.dropText, damage: damageInstr.dropText },
      ...(aFixes || dFixes ? { fixes: { ...(aFixes ? { attacks: aFixes } : {}), ...(dFixes ? { damage: dFixes } : {}) } } : {}),
      ...(assists.attacks ? { attacksOverride: assists.attacks } : {}),
      glyphTable: kindRow.fields.attacks.glyphTable,
      ...(colors ? { colors, colorTable: kindRow.fields.attacks.colorTable } : {}),
    };
  }

  if (!assists.noArt) fields.art = { op: "art", page, select: kindRow.fields.art.select };

  /* --- residue triage: margin furniture -> shipped skips; rest reported.
         Anchor-page instructions only — stat-page residue is verify's job. --- */
  const claimed = new Set();
  for (const instr of Object.values(fields)) {
    if (instr.page !== page) continue;
    if (instr.op === "text") for (const p of instr.paras) for (const r of runsIn(pd, p)) claimed.add(r);
    else if (instr.op === "attacks") {
      for (const r of runsIn(pd, { box: instr.attacksBox })) claimed.add(r);
      for (const r of runsIn(pd, { box: instr.damageBox })) claimed.add(r);
    } else if (instr.box || instr.boxes) for (const r of runsIn(pd, instr)) claimed.add(r);
  }
  // Display-height items are structure — a chapter opener, a monster heading —
  // not the BODY text this triage is about, and the sibling check on
  // continuation pages has always said so.
  const residual = pd.items.filter((it) => it.h < HEADING_MIN_H && !claimed.has(it));
  const marginBoxes = [];
  if (residual.some((it) => it.x < 45)) marginBoxes.push({ x0: 0, x1: 45, y0: 0, y1: pd.height, reason: "margin-furniture" });
  if (residual.some((it) => it.x > pd.width - 45)) marginBoxes.push({ x0: pd.width - 45, x1: pd.width, y0: 0, y1: pd.height, reason: "margin-furniture" });
  // Running head / chapter tab band above the content area.
  if (residual.some((it) => it.y < 50)) marginBoxes.push({ x0: 0, x1: pd.width, y0: 0, y1: 50, reason: "running-head" });
  // Chef-authored skips: text on this page that belongs to no entry — a
  // general rules section printed under a creature, a decorative footer. The
  // AX path has always had these; a monster page needs them for the same
  // reason, and recording one is how a chef says "seen, and not mine".
  for (const sk of assists.skips ?? []) {
    if ((sk.page ?? page) === page) marginBoxes.push({ ...sk.box, reason: sk.reason ?? "recorded-skip" });
  }
  const inSkips = (it) => marginBoxes.some((b) => inBoxRaw(it, b));
  const leftover = dropCaptionLines(residual.filter((it) => !inSkips(it)), claimedBoxesOn(fields, page));
  if (leftover.length) {
    warn(`${entry.id}: ${leftover.length} unclaimed body item(s) on p.${page} e.g. ${leftover.slice(0, 3).map((i) => JSON.stringify(i.str.slice(0, 24))).join(" ")}`);
  }

  return {
    kind: entry.kind,
    name: entry.name,
    cite: citeFor(entry.book, page),
    pages: statPage !== page ? [page, statPage] : entry.pages,
    fields,
    ...(unmapped.length ? { _unmappedLabels: unmapped } : {}),
    ...(marginBoxes.length ? { _skips: { [page]: marginBoxes } } : {}),
  };
}

/**
 * Validate each authored grid against the reference PDF and emit it as a v2
 * `grid` instruction.
 *
 * The geometry is chef-authored — data-row band, label span, column spans and
 * their cell patterns — and never a value; every cell materializes from the
 * seat's own page. Validating live is what stops a mis-typed band shipping: a
 * box that does not contain the rows it claims fails the compile here rather
 * than yielding an empty table at someone's table.
 *
 * Shared by every kind whose content IS a printed table (the MM's
 * characteristics-by-tier pages, the equipment chapter's vehicle table), so
 * they cannot drift apart on how a grid is validated or emitted.
 */
async function emitGrids(doc, grids, fields, boxesByPage) {
  for (const [gname, g] of Object.entries(grids ?? {})) {
    const gpd = await pageItems(doc, g.page);
    const inBox = gpd.items.filter((it) => it.x >= g.box.x0 && it.x <= g.box.x1 && it.y >= g.box.y0 && it.y <= g.box.y1);
    const yRows = rowsByY(inBox, g.rowTol ?? 3).length;
    if (yRows < (g.expectRows ?? 2)) {
      throw new Error(`grid "${gname}": ${yRows} y-row(s) in box on p.${g.page} (expected >= ${g.expectRows ?? 2})`);
    }
    (boxesByPage[g.page] ??= []).push(g.box);
    fields[`grids.${gname}`] = {
      op: "grid", page: g.page, box: g.box, label: g.label, cols: g.cols,
      ...(g.transpose ? { transpose: true } : {}),
      ...(g.props ? { props: g.props } : {}),
      ...(g.dropRows ? { dropRows: g.dropRows } : {}),
      ...(g.gapMin != null ? { gapMin: g.gapMin } : {}),
      ...(g.rowTol ? { rowTol: g.rowTol } : {}),
      ...(g.minCells ? { minCells: g.minCells } : {}),
    };
  }
}

/* -------------------------------------------- */
/*  Printed-table compilation (kind.vehicle)    */
/* -------------------------------------------- */

/**
 * kind.vehicle — a chapter table whose ROWS are the entities, not a definition
 * with a descriptive block.
 *
 * The equipment chapter prints every cart, chariot and howdah as one row of a
 * grid, so one register entry covers the whole table and the binding makes a
 * document per row. That is the opposite arrangement from a proficiency, and
 * it is why this kind gets its own compiler rather than a `locate` mode: there
 * is no run-in to anchor on and no prose block to bound — there is a heading, a
 * band of rows, and authored column spans.
 */
async function compileVehicleTable(doc, entry, _kindRow) {
  const page = entry.pages[0];
  const pd = await pageItems(doc, page);
  const cols = defColumns(pd);
  const want = entry.assists?.anchor ?? entry.anchor?.display ?? entry.name;
  const head = pd.items
    .filter((it) => it.h >= HEADING_MIN_H && it.str.trim().startsWith(want))
    .sort((a, b) => a.y - b.y)[0];
  if (!head) throw new Error(`table heading "${want}" not found on p.${page}`);
  const col = colOf(head.x, cols);
  const fields = {
    name: {
      op: "expect", page,
      box: { x0: head.x - 4, x1: head.x + (head.w ?? 80) + 4, y0: head.y - 6, y1: head.y + 6 },
      text: want,
    },
  };
  const boxes = {};
  await emitGrids(doc, entry.assists?.grids, fields, boxes);
  return {
    id: entry.id,
    kind: entry.kind,
    name: entry.name,
    book: entry.book,
    cite: entry.cite ?? "",
    pages: entry.pages,
    ...(entry.meta ? { meta: entry.meta } : {}),
    ...(entry.icon ? { icon: entry.icon } : {}),
    fields,
    _col: col,
  };
}

/* -------------------------------------------- */
/*  OSE creature compilation                    */
/* -------------------------------------------- */

/**
 * kind.oseLocation — a keyed area of an authored OSE/B-X adventure.
 *
 * The lightest composite there is: an anchor proving the heading still titles
 * this room, and the prose boxes its text occupies. No stat block, because a
 * room has none — what lives in it is a creature entry of its own.
 */
async function compileOseLocation(doc, entry, _kindRow) {
  const page = entry.pages[0];
  const pd = await pageItems(doc, page);
  const want = entry.anchor?.display;
  const fields = {};
  if (want) {
    // Found the way the harvester found it — as a HEADING, joined from its runs
    // — because an area title is regularly split across items ("5." then "The
    // Docks") and no single one of them carries the name to test against.
    const head = listHeadings(pd)
      .filter((h) => h.mode === "display" && String(h.text ?? "").replace(/\s+/g, " ").trim().startsWith(want.slice(0, 12)))
      .sort((x, y) => x.y - y.y)[0];
    if (!head) throw new Error(`area heading "${want.slice(0, 24)}" not found on p.${page}`);
    // The heading's own COLUMN, not its whole baseline: two areas are regularly
    // titled side by side, and a box spanning both reads as one run-on heading
    // that matches neither. Refused at import rather than at compile, which is
    // the worst place for it — the entry looks authored and imports nothing.
    const cols = detectColumns(pd.items);
    const line = pd.items.filter(
      (it) => Math.abs(it.y - head.y) <= 3 && it.h >= HEADING_MIN_H && colOf(it.x, cols) === head.col,
    );
    if (!line.length) throw new Error(`area heading "${want.slice(0, 24)}" has no runs on p.${page}`);
    fields.name = {
      op: "expect",
      page,
      box: {
        x0: Math.min(...line.map((it) => it.x)) - 4,
        x1: Math.max(...line.map((it) => it.x + (it.w ?? 0))) + 4,
        y0: head.y - 6,
        y1: head.y + 6,
      },
      text: want,
    };
  }
  await emitProse(doc, entry, fields);
  if (!fields.description) throw new Error("no prose boxes — an area with no text is not an area");

  return {
    id: entry.id,
    kind: entry.kind,
    name: entry.name,
    book: entry.book,
    cite: entry.cite ?? "",
    pages: entry.pages,
    ...(entry.meta ? { meta: entry.meta } : {}),
    fields,
  };
}

/**
 * kind.oseMonster — a creature in an authored OSE/B-X book.
 *
 * The entry supplies GEOMETRY and the shipped grammar does the reading, so what
 * compiles is a box and an anchor, never a parsed creature. That is the whole
 * point: `ose-statline.mjs` improves from the corpus every time a rule is
 * written, and an authored book improves with it rather than freezing at
 * whatever the reader understood on the day the box was drawn.
 *
 * The heading anchor is validated live, so a different printing fails its
 * expect and the entry degrades to a stub instead of reading a box that now
 * holds a different creature.
 */
async function compileOseMonster(doc, entry, _kindRow) {
  const page = entry.assists?.block?.page ?? entry.pages[0];
  const pd = await pageItems(doc, page);
  const box = entry.assists?.block?.box;
  if (!box) throw new Error("missing assists.block.box");

  // A PDF emits no space characters, so these runs concatenate to "AC9 [10],HD1"
  // and every label the grammar looks for loses its word boundary. WHICH gaps
  // are spaces is geometry, and geometry is what compiles: `joinSpace` marks
  // the runs needing one and the executor's own joiner applies them. The same
  // mechanism the prose compiler uses — no new instruction, no schema bump.
  const runs = runsIn(pd, { box });
  const joinSpace = [];
  runs.forEach((r, i) => {
    const next = runs[i + 1];
    if (!next) return;
    const gap = next.x - (r.x + (r.w ?? 0));
    // A run that starts a new LINE also needs separating, whatever its x.
    if (gap > 1 || next.y > r.y + 1) joinSpace.push(i);
  });

  const text = joinRuns(runs, { joinSpace });
  if (!text) throw new Error(`block box on p.${page} is empty`);
  // A box that no longer holds a stat block is aimed at the wrong thing. The
  // boundary rejects letters rather than demanding a word break, since a value
  // may follow its label with no space at all.
  if (!/\bAC(?![A-Za-z])/i.test(text)) throw new Error(`block box on p.${page} holds no armour class — wrong box?`);

  const fields = {};
  const want = entry.anchor?.display;
  if (want) {
    const head = pd.items
      .filter((it) => it.h >= HEADING_MIN_H && it.str.trim().startsWith(want.slice(0, 12)))
      .sort((a, b) => a.y - b.y)[0];
    if (head) {
      fields.name = {
        op: "expect",
        page,
        box: { x0: head.x - 4, x1: head.x + (head.w ?? 80) + 4, y0: head.y - 6, y1: head.y + 6 },
        text: want,
      };
    }
  }
  fields.block = { op: "value", page, box, pattern: "raw", ...(joinSpace.length ? { fixes: { joinSpace } } : {}) };

  await emitProse(doc, entry, fields).catch(() => {});
  if (entry.assists?.art) {
    fields.art = {
      op: "art",
      page: entry.assists.art.page ?? page,
      ...(entry.assists.art.name ? { name: entry.assists.art.name } : {}),
      box: entry.assists.art.box,
    };
  }

  return {
    id: entry.id,
    kind: entry.kind,
    name: entry.name,
    book: entry.book,
    cite: entry.cite ?? "",
    pages: entry.pages,
    ...(entry.meta ? { meta: entry.meta } : {}),
    fields,
  };
}

/** Prose paragraphs, when the chef authored their boxes. Optional by design:
 * which paragraph belongs to which creature is a reading of the page, and the
 * harvester deliberately does not guess it. */
async function emitProse(doc, entry, fields) {
  const paras = entry.assists?.prose;
  if (!Array.isArray(paras) || !paras.length) return;
  const page = paras[0].page ?? entry.pages[0];
  // The same joining fixes the monster path computes. Without them the runs
  // concatenate as the PDF stored them and the text arrives with its words
  // welded at every line break — "mandiblesand 10 legs".
  const byPage = new Map();
  const out = [];
  for (const p of paras) {
    const pp = p.page ?? page;
    if (!byPage.has(pp)) byPage.set(pp, await pageItems(doc, pp));
    const instr = { box: p.box, ...(p.fixes ? { fixes: p.fixes } : {}) };
    out.push(withFixes(instr, byPage.get(pp)));
  }
  fields.description = { op: "text", page, paras: out };
}

/* -------------------------------------------- */
/*  Constant compilation                        */
/* -------------------------------------------- */

/**
 * kind.constant — one printed number a shipped procedure takes as an argument.
 *
 * Two instructions and no prose: an `expect` on a clause that carries no digit,
 * and an `int` read of the clause that carries the number. The compiler
 * validates both against the reference printing and emits GEOMETRY ONLY — the
 * number it read is deliberately not written anywhere, because shipping it is
 * the thing this kind exists to avoid.
 *
 * The anchor is what makes that safe: a printing that moves the text fails the
 * expect and the entry degrades to a stub, rather than reading an integer out
 * of whatever sentence now occupies the box.
 */
async function compileConstants(doc, entry, _kindRow) {
  const page = entry.assists?.value?.page ?? entry.pages[0];
  const pd = await pageItems(doc, page);
  const anchor = entry.assists?.expect;
  const value = entry.assists?.value;
  if (!anchor?.box || !value?.box) throw new Error(`missing anchor/value assist`);

  const anchorText = joinRuns(runsIn(pd, { box: anchor.box }));
  if (anchorText !== anchor.text) {
    throw new Error(`anchor box reads ${JSON.stringify(anchorText)}, register says ${JSON.stringify(anchor.text)}`);
  }
  // Confirm the value box resolves to an integer on THIS printing. The result
  // is asserted and discarded; only the box ships.
  const valueText = joinRuns(runsIn(pd, { box: value.box }));
  if (!/(-?[\d,]+)/.test(valueText)) {
    throw new Error(`value box reads no integer: ${JSON.stringify(valueText)}`);
  }

  return {
    id: entry.id,
    kind: entry.kind,
    name: entry.name,
    book: entry.book,
    cite: entry.cite ?? "",
    pages: entry.pages,
    ...(entry.meta ? { meta: entry.meta } : {}),
    fields: {
      // The expect rides the `name` field on purpose: executeEntry gates the
      // entry's `ok` on that field alone, so a moved printing fails the whole
      // entry instead of quietly returning a number from the wrong sentence.
      name: { op: "expect", page: anchor.page ?? page, box: anchor.box, text: anchor.text },
      value: { op: "value", page, box: value.box, pattern: "int" },
    },
  };
}

/* -------------------------------------------- */
/*  Monster-template compilation                */
/* -------------------------------------------- */

/**
 * kind.monsterTemplate — the MM's table-statted creatures (dragon, cacodemon,
 * elemental) and modifier creatures (vampire thrall).
 *
 * The register entry's `template` block is CHEF-AUTHORED: grid geometry
 * (data-row band, label span, column spans + patterns — never values), axis
 * wiring, the menu's d100 bands (structure, like roll-table ranges), and a
 * nameFormat. This compiler (a) validates each grid live against the reference
 * PDF and emits it as a v2 `grid` instruction, (b) claims the printed
 * "varies by …" stat column raw, (c) flows the DESCRIPTION across every listed
 * page — column by column, sections carried across pages from the run-in
 * headings, slugged with the same slugLabel the executor and binding use — and
 * (d) passes the axis/menu wiring through with its references checked.
 */
async function compileMonsterTemplate(doc, entry, kindRow, bookCtx) {
  const t = entry.template ?? {};
  const pages = entry.pages;
  const page = pages[0];
  const fields = {};
  const gridBoxesByPage = {};

  /* --- anchor / name --- */
  const pd0 = await pageItems(doc, page);
  const cols0 = detectColumns(pd0.items);
  const anchors0 = listHeadings(pd0).filter((a) => a.mode === "display");
  const anchor = anchors0.find((a) => a.text.toLowerCase().startsWith(entry.anchor.display.toLowerCase()));
  if (!anchor) throw new Error(`display anchor "${entry.anchor.display}" not found on p.${page}`);
  const colX = cols0[anchor.col];
  const nextX = cols0[anchor.col + 1];
  fields.name = {
    op: "expect", page,
    box: { x0: colX - 5, x1: nextX ? nextX - 6 : pd0.width, y0: anchor.y - 16, y1: anchor.y + 6 },
    text: entry.anchor.display,
  };

  /* --- authored grids, validated live --- */
  await emitGrids(doc, t.grids, fields, gridBoxesByPage);

  /* --- the printed "varies by …" stat column, claimed raw --- */
  const labelItems = pd0.items.filter((it) => it.h < HEADING_MIN_H && LABEL_RE.test(it.str.trim()));
  const byCol = new Map();
  for (const it of labelItems) {
    const c = colOf(it.x, cols0);
    byCol.set(c, [...(byCol.get(c) ?? []), it]);
  }
  const statColIdx = [...byCol.entries()].sort((a, b) => b[1].length - a[1].length)[0]?.[0];
  let statBox = null;
  if (statColIdx != null && byCol.get(statColIdx).length >= 8) {
    const labels = byCol.get(statColIdx).sort((a, b) => a.y - b.y);
    // Bounds from the AUTHORED prose columns when present: detectColumns sees
    // the value sub-column ("varies by …" starts at its own x) as a column of
    // its own and would cut the box mid-stat.
    const proseCols = t.prose?.[String(page)] ?? null;
    let x0, x1;
    if (proseCols) {
      const pi = proseCols.findLastIndex((c) => c <= labels[0].x + 2);
      // pi === -1: the stat block sits LEFT of every prose column (mirrored
      // pages print stats on the outer half) — span from the body's left edge
      // to the first prose column.
      x0 = pi >= 0 ? proseCols[pi] - 8 : 42;
      x1 = pi >= 0 ? (proseCols[pi + 1] ? proseCols[pi + 1] - 6 : pd0.width - 45) : proseCols[0] - 6;
    } else {
      x0 = cols0[statColIdx] - 5;
      x1 = cols0[statColIdx + 1] ? cols0[statColIdx + 1] - 6 : pd0.width - 45;
    }
    // Values trail below the last label (the divider mini-headings ride along —
    // this field is claimed for residue honesty, never bound).
    const colItems = pd0.items
      .filter((it) => it.h < HEADING_MIN_H && it.x >= x0 && it.x <= x1 && it.y > labels[0].y - 12)
      .sort((a, b) => a.y - b.y);
    let end = labels[labels.length - 1].y + 3;
    for (const it of colItems) {
      if (it.y <= labels[labels.length - 1].y) continue;
      if (it.y - end > 18) break;
      end = Math.max(end, it.y + 3);
    }
    // The "<Name> Primary Characteristics" divider prints just ABOVE the first
    // label — walk upward over divider-shaped lines only (never into prose).
    let top = labels[0].y - 12;
    const above = toLines(
      pd0.items.filter((it) => it.h < HEADING_MIN_H && it.x >= x0 && it.x <= x1 && it.y < labels[0].y - 2)
    ).sort((a, b) => b.y - a.y);
    for (const line of above) {
      if (top - line.y > 22) break;
      const text = line.items.map((i) => i.str).join("").replace(/\s+/g, "").toLowerCase();
      if (!/(primary|secondary)characteristics$|encounters$/.test(text)) break;
      top = line.y - 3;
    }
    statBox = { x0, x1, y0: top, y1: end };
    // FIXED rows bind like any monster's (the same rows map + midpoint
    // bands); "varies by …" values simply fail their patterns at runtime and
    // surface only as _raw. Divider mini-headings drop via ordinals, exactly
    // as compileMonster does.
    const monsterRows = bookCtx?.kinds?.["kind.monster"]?.fields?.stats;
    if (monsterRows) {
      const dividerItems = new Set();
      const colItems = pd0.items
        .filter((it) => it.h < HEADING_MIN_H && it.x >= x0 && it.x <= x1 && it.y >= top && it.y <= end)
        .sort((a, b) => a.y - b.y);
      for (const line of toLines(colItems)) {
        const lineText = line.items.map((i) => i.str).join("").replace(/\s+/g, "").toLowerCase();
        if (/(secondarycharacteristics|primarycharacteristics|encounters)$/.test(lineText) && !lineText.includes(":")) {
          for (const it of line.items) dividerItems.add(it);
        }
      }
      labels.forEach((label, i) => {
        const labelText = label.str.trim();
        const rowName = labelText.slice(0, -1);
        const prevY = i > 0 ? labels[i - 1].y : label.y - 12;
        const y0 = (prevY + label.y) / 2;
        const y1 = i + 1 < labels.length ? (label.y + labels[i + 1].y) / 2 : end;
        const base = { op: "value", page, box: { x0, x1, y0, y1 }, dropText: labelText };
        if (rowName.startsWith(monsterRows.speedRows.prefix)) {
          const kind2 = /\(([^)]+)\)/.exec(rowName)?.[1] ?? "land";
          fields[`stats.speed${cap(camel(kind2))}`] = withFixes({ ...base, pattern: monsterRows.speedRows.pattern }, pd0, dividerItems);
          return;
        }
        const row = monsterRows.rows[rowName];
        if (row) {
          fields[`stats.${row.field}`] = withFixes({
            ...base,
            pattern: row.pattern,
            ...(row.table ? { table: row.table } : {}),
            ...(row.parenTable ? { parenTable: row.parenTable } : {}),
            ...(row.stripRoll ? { stripRoll: true } : {}),
          }, pd0, dividerItems);
        } else {
          fields[`stats._raw.${camel(rowName)}`] = withFixes({ ...base, pattern: "raw" }, pd0, dividerItems);
        }
      });
      // The divider band ABOVE the first label stays claimed.
      fields.statsPrinted = { op: "value", page, pattern: "raw", box: { x0, x1, y0: top, y1: labels[0].y - 6 } };
    } else {
      fields.statsPrinted = { op: "value", page, pattern: "raw", box: statBox };
    }
  }

  /* --- description: every page, column by column, sections flowed --- */
  const inAnyBox = (it, boxes) => boxes.some((b) => it.x >= b.x0 && it.x <= b.x1 && it.y >= b.y0 && it.y <= b.y1);
  const paras = [];
  let current = "overview";
  const sectionSlugs = new Set(["overview"]);
  for (const p of pages) {
    const pd = p === page ? pd0 : await pageItems(doc, p);
    // detectColumns is tuned for the two-column monster spreads and misfires
    // on table-heavy template pages (p.325 reads a table's value column as a
    // prose column and shears every line at it) — an authored per-page
    // override (template.prose[page] = [x…]) wins when present.
    const cols = t.prose?.[String(p)] ?? detectColumns(pd.items);
    const excluded = [...(gridBoxesByPage[p] ?? []), ...(p === page && statBox ? [statBox] : [])];
    const body = pd.items.filter(
      (it) =>
        it.h < HEADING_MIN_H &&
        it.y > 50 && it.x >= 45 && it.x <= pd.width - 45 &&
        !inAnyBox(it, excluded)
    );
    // Run-in section headings, per AUTHORED column (listHeadings would
    // re-detect its own columns, and a page-wide line spans columns so the
    // right column's run-ins are never line-leading globally). Menu pages hang
    // their ability run-ins right of a die-band column — template.runinX[page]
    // adds those anchor x's for detection without making them paragraph
    // columns. A run-in may SPLIT across runs ("Horrific" + "Stench:"), so
    // accumulate a line's leading runs until one closes with the colon.
    const runinAnchors = [...cols, ...(t.runinX?.[String(p)] ?? [])];
    const runinRe = /^[A-Z][^:]{1,42}:$/;
    for (const [ci, cx] of cols.entries()) {
      const colX0 = cx - 5;
      const colX1 = cols[ci + 1] ? cols[ci + 1] - 6 : pd.width - 45;
      const colItems = body.filter((it) => colOf(it.x, cols) === ci);
      if (!colItems.length) continue;
      const colLines = toLines(colItems);
      const boxes = paragraphBoxes(colLines, colX0, colX1);
      const colRunins = [];
      for (const line of colLines) {
        // A one-line menu ability shares its line with the die band
        // ("05 Berserk (##): …") — skip one leading band-shaped run.
        let items = line.items;
        if (items.length > 1 && /^\d+(?:\s*[–-]\s*\d+)?$/.test(items[0].str.trim())) items = items.slice(1);
        const first = items[0];
        if (!first || !runinAnchors.some((c) => Math.abs(first.x - c) < 15)) continue;
        let acc = "";
        for (const it of items.slice(0, 3)) {
          // The closing colon may OPEN the next run (": The dragon can…") —
          // that colon ends the run-in; the rest of the run is body text.
          if (acc && it.str.startsWith(":")) {
            const t2 = `${acc.trim().replace(/\s+/g, " ")}:`;
            if (runinRe.test(t2)) colRunins.push({ text: t2, y: first.y });
            break;
          }
          acc += (acc ? " " : "") + it.str;
          const t2 = acc.trim().replace(/\s+/g, " ");
          if (t2.endsWith(":")) {
            if (runinRe.test(t2)) colRunins.push({ text: t2, y: first.y });
            break;
          }
          if (t2.length > 44) break;
        }
      }
      colRunins.sort((a, b) => a.y - b.y);
      // Tight-leading pages (the ability menus) fuse a whole column into ONE
      // paragraph, so an interior run-in would never head a para and its
      // section would be lost — split every box at the run-ins inside it.
      const split = [];
      for (const b of boxes.sort((a, c) => a.box.y0 - c.box.y0)) {
        const inside = colRunins.filter((r) => r.y > b.box.y0 + 8 && r.y < b.box.y1 - 2);
        let top = b.box.y0;
        for (const r of inside) {
          split.push({ box: { ...b.box, y0: top, y1: r.y - 4 } });
          top = r.y - 4;
        }
        split.push({ box: { ...b.box, y0: top, y1: b.box.y1 } });
      }
      for (const b of split) {
        const above = [...colRunins].reverse().find((r) => r.y <= b.box.y0 + 8);
        if (above) {
          current = slugLabel(above.text);
          sectionSlugs.add(current);
        }
        paras.push(withFixes({ ...b, page: p, section: current }, pd));
      }
    }
  }
  fields.description = { op: "text", page, paras };

  /* --- art (per the monster kind's criteria) --- */
  if (!entry.assists?.noArt) {
    fields.art = { op: "art", page, select: { minW: 200, minH: 200, maxW: 1500, maxRatio: 3 } };
  }

  /* --- template wiring passthrough, references checked --- */
  const gridNames = new Set(Object.keys(t.grids ?? {}));
  for (const axis of t.axes ?? []) {
    for (const g of axis.grids ?? []) {
      if (!gridNames.has(g)) throw new Error(`axis "${axis.key}" references unknown grid "${g}"`);
    }
  }
  for (const cell of t.cells ?? []) {
    if (cell.grid && !gridNames.has(cell.grid)) throw new Error(`cells block references unknown grid "${cell.grid}"`);
  }
  for (const row of t.menu?.rows ?? []) {
    if (row.section && !sectionSlugs.has(row.section)) {
      warn(`${entry.id}: menu row "${row.label}" section "${row.section}" not among description sections`);
    }
  }
  const template = {
    ...(t.nameFormat ? { nameFormat: t.nameFormat } : {}),
    ...(t.axes ? { axes: t.axes } : {}),
    ...(t.cells ? { cells: t.cells } : {}),
    ...(t.menu ? { menu: t.menu } : {}),
  };

  /* --- residue triage on every touched page (compileMonster's rule) --- */
  const skips = {};
  for (const p of pages) {
    const pd = p === page ? pd0 : await pageItems(doc, p);
    const claimed = new Set();
    for (const instr of Object.values(fields)) {
      if (instr.op === "text") {
        for (const para of instr.paras) {
          if ((para.page ?? instr.page) !== p) continue;
          for (const r of runsIn(pd, para)) claimed.add(r);
        }
      } else if (instr.page === p && (instr.box || instr.boxes)) {
        for (const r of runsIn(pd, instr)) claimed.add(r);
      }
    }
    const residual = pd.items.filter((it) => it.h < HEADING_MIN_H && !claimed.has(it));
    const boxes = [];
    if (residual.some((it) => it.x < 45)) boxes.push({ x0: 0, x1: 45, y0: 0, y1: pd.height, reason: "margin-furniture" });
    if (residual.some((it) => it.x > pd.width - 45)) boxes.push({ x0: pd.width - 45, x1: pd.width, y0: 0, y1: pd.height, reason: "margin-furniture" });
    if (residual.some((it) => it.y < 50)) boxes.push({ x0: 0, x1: pd.width, y0: 0, y1: 50, reason: "running-head" });
    const leftover = dropCaptionLines(residual.filter((it) => !inAnyBox(it, boxes)), claimedBoxesOn(fields, p));
    if (leftover.length) {
      warn(`${entry.id}: ${leftover.length} unclaimed body item(s) on p.${p} e.g. ${leftover.slice(0, 3).map((i) => JSON.stringify(i.str.slice(0, 24))).join(" ")}`);
    }
    if (boxes.length) skips[p] = boxes;
  }

  return {
    kind: entry.kind,
    name: entry.name,
    cite: citeFor(entry.book, page),
    pages,
    fields,
    ...(Object.keys(template).length ? { template } : {}),
    ...(Object.keys(skips).length ? { _skips: skips } : {}),
  };
}

/* -------------------------------------------- */
/*  Adventure (AX-line) compilation             */
/* -------------------------------------------- */

// AX books print 10pt body (RR/JJ are 9), 12pt entry keys, 14pt section heads.
const AX_BODY_MAX_H = 10.6;
const AX_HEAD_MIN_H = 11.5;
const AX_TOP_BAND = 60; // running heads sit at ~y40
// Folios print at ~y757 on a 792pt page — 35pt up, above extract.mjs's 32pt
// footer filter — so they reach the item list and must be skipped here.
const AX_FOOT_Y = 750;
// AX2's inline paragraph icons render as literal [TAG] text runs; each starts
// a section that persists until the next tag (the MM run-in model). AX3 has
// none. Observed vocabulary, from a whole-book scan:
const AX_ICON_SECTIONS = {
  MONSTER: "monster", LORE: "lore", LOOT: "loot", GRAVES: "graves",
  TRICK: "trick", TRAP: "trap", NOISE: "noise",
};
// A tag run may carry SEVERAL tags ("[MONSTER] [GRAVES]"); the run is all-tag
// either way, and the first tag names the section.
const AX_TAG_RE = /^(?:\[([A-Z][A-Z /&-]{1,20})\]\s*)+$/;
const AX_FIRST_TAG = /\[([A-Z][A-Z /&-]{1,20})\]/;
// Keys hang their headings ~9pt left of the body column edge; classify a
// heading's column with that tolerance, and widen body boxes to cover the
// hanging icon-tag runs.
const AX_HANG = 12;
// Die-cell shapes: "7", "3-4", and the comma group "6,7,16" (one result row
// serving several rolls — the rumor-truth tables).
const AX_DIE_RE = /^\d+(?:\s*[-–]\s*\d+)?(?:\s*,\s*\d+(?:\s*[-–]\s*\d+)?)*$/;
const axColOf = (x, cols) => colOf(x + AX_HANG, cols);

const collapse = (s) => s.replace(/\s+/g, " ").trim();
// Mirror of the executor's expect fold (NFKD + strip marks + alnum): anchor
// FINDING must agree with runtime anchor CHECKING or a compiled entry stubs.
const axFold = (s) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Heading LINES (>= AX_HEAD_MIN_H runs clustered by y), with joined text.
 * AX3 prints heading-size chapter banners down the outer margins; they are
 * furniture, not headings, so the margin bands are excluded here. */
function axHeadingLines(pd) {
  // y > 55: running heads print at y~40 in heading type and MUST NOT anchor or
  // stop anything. x-bands drop the AX3 margin banners (x~22 / x~590); real
  // hanging headings start at x~33.8.
  const heads = pd.items.filter(
    (it) => it.h >= AX_HEAD_MIN_H && it.y > AX_TOP_BAND - 5 && it.y < AX_FOOT_Y && it.x >= 30 && it.x <= pd.width - 30,
  );
  // Two columns often print headings at the SAME y ("12U." beside "14U."); a
  // y-cluster alone would merge them into one phantom line, so split each
  // y-line on x-gaps wider than a word space.
  const out = [];
  for (const ln of toLines(heads)) {
    const items = [...ln.items].sort((a, b) => a.x - b.x);
    const segs = [[items[0]]];
    for (let i = 1; i < items.length; i++) {
      const prev = items[i - 1];
      if (items[i].x - (prev.x + (prev.w ?? 0)) > 30) segs.push([]);
      segs[segs.length - 1].push(items[i]);
    }
    for (const seg of segs) {
      out.push({
        y: ln.y,
        x0: Math.min(...seg.map((i) => i.x)),
        x1: Math.max(...seg.map((i) => i.x + (i.w ?? 0))),
        text: collapse(seg.map((i) => i.str).join(" ")),
        items: seg,
      });
    }
  }
  return out.sort((a, b) => a.y - b.y || a.x0 - b.x0);
}

/** Column starts for an AX page: assists win, else detection, else full width. */
function axColumns(pd, assists = {}) {
  if (assists.columns) return assists.columns;
  if (assists.fullWidth) {
    const body = pd.items.filter((it) => it.h <= AX_BODY_MAX_H && it.y > AX_TOP_BAND && it.y < AX_FOOT_Y);
    return [body.length ? Math.min(...body.map((i) => i.x)) : 50];
  }
  const cols = detectColumns(pd.items);
  return cols.length ? cols : [50];
}

/** Locate an entry's heading line, absorbing wrapped continuation lines. */
function axAnchor(pd, cols, entry, assists) {
  const want = collapse(assists.anchor ?? entry.anchor?.display ?? entry.name);
  const lines = axHeadingLines(pd);
  // Progressive word-prefix match, like definition display anchors: the PDF may
  // break the heading oddly or drop trailing words to a second line.
  const words = want.split(" ");
  const candidates = [want];
  for (let i = words.length - 1; i >= 1; i--) candidates.push(words.slice(0, i).join(" "));
  let line = null;
  let matched = want;
  for (const c of candidates) {
    line = lines.find((l) => axFold(l.text).startsWith(axFold(c)));
    if (line) {
      matched = c;
      break;
    }
  }
  if (!line) throw new Error(`heading "${want}" not found on p.${entry.pages[0]}`);
  const col = axColOf(line.x0, cols);
  // Absorb a wrapped second heading line directly below (AX3 sets long keys on
  // two 12pt lines).
  let endY = line.y;
  let x1 = line.x1;
  for (const l of lines.filter((l) => axColOf(l.x0, cols) === col && l.y > line.y + 2).sort((a, b) => a.y - b.y)) {
    if (l.y - endY <= 22 && !/^[A-Z]?\d+[A-Za-z]?\./.test(l.text)) {
      endY = l.y;
      x1 = Math.max(x1, l.x1);
    } else break;
  }
  // Absorb a "(3000 BE)" date suffix set as its own BODY-size line below the
  // heading (AX2 sets it beside the heading when it fits, below when not).
  const dateLine = toLines(
    pd.items.filter(
      (it) => it.h <= AX_BODY_MAX_H && axColOf(it.x, cols) === col && it.y > endY + 2 && it.y < endY + 20,
    ),
  )[0];
  if (dateLine) {
    const txt = collapse(dateLine.items.map((i) => i.str).join(" "));
    if (/^\([^)]{1,24}\)$/.test(txt)) endY = dateLine.y;
  }
  return { line, col, endY, x1, matched };
}

/**
 * Collect an entry's body as reading-order segments: down the anchor column,
 * across remaining columns, over the page onto the next — until a heading line
 * stops it. Pages are re-examined independently (AX2 mixes full-width and
 * columnar layouts page by page). `exclude` drops items (an NPC's statline
 * cluster, claimed by its own instruction).
 */
async function axFlow(doc, entry, assists, start, exclude = new Set(), opts = {}) {
  const maxPage = Math.max(...entry.pages);
  const segs = [];
  let page = start.page;
  let pd = start.pd;
  let cols = start.cols;
  let col = start.col;
  let fromY = start.endY + 2;
  // Sibling stops: NPC residents stack runin-after-runin with no display
  // heading between them, so another register entry's runin anchor ends this
  // entry's flow exactly like a heading would. Purely register-driven.
  const stopAt = (opts.stopAt ?? []).map((s) => axFold(s)).filter(Boolean);
  const siblingStop = (colX0, colX1, yMin) => {
    if (!stopAt.length) return null;
    const colItems = pd.items.filter(
      (it) => it.h <= AX_BODY_MAX_H && it.x >= colX0 && it.x <= colX1 && it.y > yMin && it.y < AX_FOOT_Y,
    );
    for (const ln of toLines(colItems)) {
      const t = axFold(ln.items.map((i) => i.str).join(""));
      const rawLine = ln.items.map((i) => i.str).join(" ");
      const clean = !/[.,;!?]/.test(rawLine);
      // Same clauses as the runin anchor matcher, INCLUDING the suffix rule —
      // sibling runins print with titles too ("pRovost mentenus Cavië") — and
      // the same punctuation guard against sentence tails.
      if (
        stopAt.some(
          (w) =>
            t === w ||
            (t.startsWith(w) && t.length <= w.length + 6) ||
            (w.length >= 12 && t.startsWith(w.slice(0, 12)) && Math.abs(t.length - w.length) <= 4) ||
            (w.length >= 6 && t.endsWith(w) && t.length <= w.length + 14 && clean),
        )
      )
        return ln.y;
    }
    return null;
  };
  for (let guard = 0; guard < 24; guard++) {
    const x0 = cols[col] - AX_HANG - 2;
    const x1 = cols[col + 1] ? cols[col + 1] - AX_HANG - 3 : pd.width - 40;
    const stopHead = axHeadingLines(pd)
      .filter((l) => axColOf(l.x0, cols) === col && l.y > fromY + 2)
      .sort((a, b) => a.y - b.y)[0];
    const sibY = siblingStop(x0, x1, fromY + 2);
    const stopY = Math.min(
      stopHead ? stopHead.y - 4 : AX_FOOT_Y,
      sibY != null ? sibY - 4 : AX_FOOT_Y,
      assists.descStopY ?? AX_FOOT_Y,
      opts.stopYOnce ?? AX_FOOT_Y,
      AX_FOOT_Y,
    );
    const items = pd.items.filter(
      (it) =>
        it.h <= AX_BODY_MAX_H && !exclude.has(it) &&
        it.x >= x0 && it.x <= x1 && it.y > fromY && it.y < stopY &&
        it.y > AX_TOP_BAND,
    );
    if (items.length) segs.push({ page, pd, x0, x1, items });
    if (stopHead || sibY != null || assists.descStopY || opts.stopYOnce) return segs;
    // Interleaved layouts (a page split between two sections column-wise) make
    // a column advance grab the OTHER section's tail; the chef can pin the
    // flow to the anchor's column.
    if (assists.sameColumnOnly) return segs;
    // No stop in this column: continue in the next column, else overleaf.
    if (col + 1 < cols.length) {
      col += 1;
      fromY = AX_TOP_BAND;
      continue;
    }
    if (page + 1 > doc.numPages || page + 1 > maxPage) return segs;
    page += 1;
    pd = await pageItems(doc, page);
    // Anchor-page column assists do not carry over — AX2 mixes full-width and
    // columnar layouts page by page, so continuation pages are re-detected
    // (with an optional per-page override for pathological layouts).
    cols = axColumns(pd, { columns: assists.flowColumns?.[String(page)] });
    col = 0;
    fromY = AX_TOP_BAND;
  }
  return segs;
}

/**
 * Paragraphs from flow segments, with per-para pages, icon-tag sections, and
 * statline reporting. A paragraph breaks on an opened line gap OR a >50pt jump
 * of the line's left edge (AX2's inset note boxes share the y-rhythm of the
 * prose beside them).
 */
function axParas(segs, anchorPage, opts = {}) {
  const paras = [];
  const statlines = [];
  let section = null;
  for (const seg of segs) {
    const lines = toLines(seg.items).map((ln) => ({
      y: ln.y,
      x0: Math.min(...ln.items.map((i) => i.x)),
      items: [...ln.items].sort((a, b) => a.x - b.x),
    }));
    if (!lines.length) continue;
    const gaps = [];
    for (let i = 1; i < lines.length; i++) gaps.push(lines[i].y - lines[i - 1].y);
    const median = gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 12;
    const groups = [[lines[0]]];
    for (let i = 1; i < lines.length; i++) {
      const gap = lines[i].y - lines[i - 1].y;
      const xJump = Math.abs(lines[i].x0 - lines[i - 1].x0) > 50;
      if (gap > median * 1.6 || (xJump && gap > median * 0.8)) groups.push([]);
      groups[groups.length - 1].push(lines[i]);
    }
    for (const g of groups) {
      const first = g[0].items[0];
      const tag = opts.iconTags && AX_TAG_RE.test(first.str.trim()) ? AX_FIRST_TAG.exec(first.str) : null;
      if (tag) section = AX_ICON_SECTIONS[tag[1]] ?? tag[1].toLowerCase();
      const para = {
        box: {
          x0: seg.x0,
          x1: seg.x1,
          y0: g[0].y - 3,
          y1: g[g.length - 1].y + 3,
        },
      };
      if (seg.page !== anchorPage) para.page = seg.page;
      if (section) para.section = section;
      const drop = tag ? new Set([first]) : null;
      withFixes(para, seg.pd, drop);
      paras.push(para);
      // Quick-stat blocks: an indented "Name:" label opening a stat clause.
      // Checked per LINE, not per paragraph group — the y-gap segmentation may
      // keep a statline glued to the prose above it, and one group can open
      // several consecutive blocks.
      if (opts.statlines) {
        for (let li = 0; li < g.length; li++) {
          const label = g[li].items[0];
          // A merged label run ("Liber Faunus: Venturer 10; …" in one run)
          // makes an unusable lookup token — those blocks belong to npc
          // entries; only clean short labels emit creature lookups.
          if (!/:$/.test(label.str.trim()) || label.str.trim().length > 40) continue;
          const tail = g.slice(li).map((l) => l.items.map((i) => i.str).join(" ")).join(" ");
          if (/\b(MV|AC|HD|hp)\s*-?\d/.test(tail.slice(0, 160))) {
            statlines.push({ label, para, page: seg.page, pd: seg.pd });
          }
        }
      }
    }
  }
  return { paras, statlines };
}

/**
 * Only invoked for entries carrying a chef-authored assists.artName, where it
 * resolves the shipped placement box. Run unguarded it systematically finds the
 * parchment slabs behind the quick-stat blocks — they are the only images whose
 * centres land inside claimed text zones, while real portraits stand beside the
 * column.
 *
 * The illustration printed INSIDE an entry's claimed region, if any. Purely
 * geometric: candidates come from the operator-list PLACEMENTS (no image
 * decoding, so it runs offline), must be illustration-sized as placed (>=90pt
 * each way, aspect < 3.5, not a full-page background), and their center must
 * fall in the union of the entry's own claimed boxes on that page (padded a
 * hair — portraits sit flush against the text that wraps them). Several
 * candidates -> the largest, the same rule the MM pick uses; none -> no art
 * field, quietly. Ships { op:"art", page, name } — an exact XObject name is
 * stable per printing, like every other shipped observation.
 */
async function axPickArt(doc, fields, extraBoxes = [], assists = {}) {
  // A chef-audited association outranks the heuristic entirely: the audit
  // looked at the pixels, the heuristic only at placement.
  if (assists.artName) {
    const page = assists.artPage ?? Object.values(fields).find((i) => i.page)?.page;
    const placements = await pageArtPlacements(doc, page).catch(() => []);
    const hit = placements.find((p) => p.name === assists.artName);
    const r = (v) => Math.round(v * 10) / 10;
    return {
      op: "art", page, name: assists.artName,
      ...(hit ? { box: { x: r(hit.x), y: r(hit.y), w: r(hit.w), h: r(hit.h) } } : {}),
    };
  }
  const boxes = new Map();
  const add = (page, box) => {
    if (!box || !page) return;
    if (!boxes.has(page)) boxes.set(page, []);
    boxes.get(page).push(box);
  };
  for (const instr of Object.values(fields)) {
    if (instr.op === "text") for (const p of instr.paras ?? []) add(p.page ?? instr.page, p.box);
    else if (instr.box) add(instr.page, instr.box);
  }
  for (const e of extraBoxes) add(e.page, e.box);
  for (const [page, list] of [...boxes.entries()].sort((a, b) => a[0] - b[0])) {
    const placements = await pageArtPlacements(doc, page).catch(() => []);
    const cands = placements.filter((a) => {
      // "g_" names are GLOBAL XObjects shared across pages — recurring
      // decorations, never an entry's illustration.
      if (a.name.startsWith("g_")) return false;
      if (a.w < 90 || a.h < 90) return false;
      if (a.w / a.h > 3.5 || a.h / a.w > 3.5) return false;
      if (a.w > 420 && a.h > 600) return false; // full-page background
      const cx = a.x + a.w / 2;
      const cy = a.y + a.h / 2;
      // Center inside a SINGLE claimed box (boxes are column-scoped, so a
      // description that continues in the next column cannot annex the
      // neighbouring entry's illustration via a bounding-rect union).
      return list.some((b) => cx >= b.x0 - 8 && cx <= b.x1 + 8 && cy >= b.y0 - 14 && cy <= b.y1 + 34);
    });
    if (cands.length) {
      const best = cands.sort((a, b) => b.w * b.h - a.w * a.h)[0];
      const r = (v) => Math.round(v * 10) / 10;
      // The placement box ships beside the name: the binding crops it from a
      // page render, which works even when the image never registers as a
      // retrievable XObject (the AX books paint art inside Form XObjects).
      return { op: "art", page, name: best.name, box: { x: r(best.x), y: r(best.y), w: r(best.w), h: r(best.h) } };
    }
  }
  return null;
}

/** Chef-authored extra skips (assists.skips = [{page?, box, reason?}]): the
 * escape hatch for recorded page furniture no heuristic should learn — a
 * table's Average-XP footer row, a decorative divider. */
function axAssistSkips(skipsOut, assists, defaultPage) {
  for (const s of assists.skips ?? []) {
    const p = s.page ?? defaultPage;
    (skipsOut[p] ??= []).push({ ...s.box, reason: s.reason ?? "recorded-skip" });
  }
}

/** Residue triage across EVERY page an entry's instructions touch (a location
 * flows over pages; the folio on a continuation page needs its skip too). */
async function axResidueAll(doc, entryId, fields, seed = {}) {
  const pages = new Set();
  for (const instr of Object.values(fields)) {
    if (instr.page) pages.add(instr.page);
    if (instr.op === "text") for (const p of instr.paras ?? []) if (p.page) pages.add(p.page);
  }
  const out = {};
  for (const p of [...pages].sort((a, b) => a - b)) {
    const pd = seed[p] ?? (await pageItems(doc, p));
    const skips = axResidue(entryId, pd, p, fields);
    if (skips.length) out[p] = skips;
  }
  return out;
}

/** compileMonster's residue triage for an AX page: furniture -> skips. */
function axResidue(entryId, pd, page, fields) {
  const claimed = new Set();
  for (const instr of Object.values(fields)) {
    if (instr.op === "text") {
      for (const p of instr.paras) {
        if ((p.page ?? instr.page) !== page) continue;
        for (const r of runsIn(pd, p)) claimed.add(r);
      }
    } else if (instr.page === page && (instr.box || instr.boxes)) {
      for (const r of runsIn(pd, instr)) claimed.add(r);
    }
  }
  const residual = pd.items.filter((it) => !claimed.has(it));
  const skips = [];
  if (residual.some((it) => it.y < AX_TOP_BAND)) skips.push({ x0: 0, x1: pd.width, y0: 0, y1: AX_TOP_BAND, reason: "running-head" });
  if (residual.some((it) => it.y > AX_FOOT_Y)) skips.push({ x0: 0, x1: pd.width, y0: AX_FOOT_Y, y1: pd.height, reason: "folio" });
  if (residual.some((it) => it.x < 34)) skips.push({ x0: 0, x1: 34, y0: 0, y1: pd.height, reason: "margin-furniture" });
  if (residual.some((it) => it.x > pd.width - 34)) skips.push({ x0: pd.width - 34, x1: pd.width, y0: 0, y1: pd.height, reason: "margin-furniture" });
  return skips;
}

/** Shared skeleton: anchor + name expect + flowed prose paragraphs. Anchors
 * are display headings by default; `anchor.runin` instead matches a BODY-size
 * standalone line by folded text — AX3 sets its notable-resident names in
 * small-caps body type ("tRibune naRmiRio dRaKomiR"), which fold-comparison
 * absorbs on both sides. */
async function axOpen(doc, entry) {
  const assists = entry.assists ?? {};
  const page = entry.pages[0];
  const pd = await pageItems(doc, page);
  const cols = axColumns(pd, assists);
  let a;
  if (entry.anchor?.runin) {
    const want = collapse(assists.anchor ?? entry.anchor.runin);
    const w = axFold(want);
    let hit = null;
    let matchedOverride = null;
    for (let c = 0; c < cols.length && !hit; c++) {
      const colItems = pd.items.filter(
        (it) => it.h <= AX_BODY_MAX_H && axColOf(it.x, cols) === c && it.y > AX_TOP_BAND && it.y < AX_FOOT_Y,
      );
      for (const ln of toLines(colItems)) {
        const items = [...ln.items].sort((x, y) => x.x - y.x);
        const t = axFold(items.map((i) => i.str).join(""));
        // Prefix clauses mirror the executor's expect fallbacks (including the
        // 12-char rule for dropped small-caps glyphs). The SUFFIX clause covers
        // titled runins ("pRovost mentenus Cavië" for anchor "Mentenus Cavië");
        // since the runtime expect is prefix-only, a suffix hit ships the
        // line's own printed text as the expect label instead. Suffix matches
        // demand a punctuation-free standalone line — a sentence tail
        // ("…with Clitus Omnus.") must never anchor.
        const rawLine = items.map((i) => i.str).join(" ");
        const suffix = t.endsWith(w) && t.length <= w.length + 14 && w.length >= 6 && !/[.,;!?]/.test(rawLine);
        if (
          t === w ||
          (t.startsWith(w) && t.length <= w.length + 6) ||
          (w.length >= 12 && t.startsWith(w.slice(0, 12)) && Math.abs(t.length - w.length) <= 4) ||
          suffix
        ) {
          if (suffix && !t.startsWith(w)) {
            matchedOverride = collapse(items.map((i) => i.str).join(" "));
          }
          hit = {
            line: {
              y: ln.y,
              x0: Math.min(...items.map((i) => i.x)),
              x1: Math.max(...items.map((i) => i.x + (i.w ?? 0))),
              items,
            },
            col: c,
          };
          break;
        }
      }
    }
    if (!hit) throw new Error(`runin line "${want}" not found on p.${page}`);
    a = { line: hit.line, col: hit.col, endY: hit.line.y, x1: hit.line.x1, matched: matchedOverride ?? want };
  } else {
    a = axAnchor(pd, cols, entry, assists);
  }
  // The expect box spans to the column's right edge so a same-line "(3000 BE)"
  // date suffix (body-size, not part of the heading runs) is claimed with it.
  const colX1 = cols[a.col + 1] ? cols[a.col + 1] - AX_HANG - 3 : pd.width - 40;
  const name = withFixes(
    {
      op: "expect", page,
      box: {
        x0: a.line.x0 - 3,
        x1: Math.max(a.x1 + 3, colX1),
        // Runin boxes must stay INSIDE the 12pt line pitch — at -8 the box
        // caught the tail of the paragraph above and the expect read that
        // line first.
        y0: a.line.y - (entry.anchor?.runin ? 5 : 14),
        y1: a.endY + (entry.anchor?.runin ? 4 : 5),
      },
      text: a.matched,
    },
    pd,
  );
  return { assists, page, pd, cols, a, name };
}

/**
 * kind.location — a keyed area / point of interest. Prose (with icon-tag
 * sections) plus one creature-name lookup per embedded quick-stat label, so
 * the binding can link the ACKS II entry the seat owns (defer-to-newest).
 */
async function compileLocation(doc, entry, kindRow) {
  const { assists, page, pd, cols, a, name } = await axOpen(doc, entry);
  const fields = { name };
  const segs = await axFlow(
    doc, entry, assists,
    { page, pd, cols, col: a.col, endY: a.endY },
    new Set(),
    { stopAt: assists.stopLines ?? [] },
  );
  const { paras, statlines } = axParas(segs, page, { iconTags: entry.book === "ax2", statlines: true });
  if (!paras.length) throw new Error(`no body paragraphs under "${entry.name}" p.${page}`);
  fields.description = { op: "text", page, paras };
  statlines.forEach((s, i) => {
    fields[`creatures.${i}`] = {
      op: "value",
      page: s.page,
      pattern: "raw",
      table: "creature",
      stripColon: true,
      stripParen: true, // "Skeletons (12):" -> "Skeletons"
      box: { x0: s.label.x - 2, x1: s.label.x + (s.label.w ?? 40) + 2, y0: s.label.y - 4, y1: s.label.y + 4 },
    };
  });
  const out = {
    kind: entry.kind, name: entry.name, cite: citeFor(entry.book, page), pages: entry.pages,
    ...(entry.meta ? { meta: entry.meta } : {}), fields,
  };
  const skipsOut2 = await axResidueAll(doc, entry.id, fields, { [page]: pd });
  axAssistSkips(skipsOut2, assists, page);
  if (Object.keys(skipsOut2).length) out._skips = skipsOut2;
  return out;
}

/**
 * kind.npc — prose plus ONE quick-stat block parsed by the statline pattern.
 * The block may sit on a different page than the prose (quick vs full
 * presentation); assists.statlineAt names it, assists.statLabel overrides the
 * label text when it differs from "<name>:".
 */
async function compileNpc(doc, entry, kindRow, bookCtx) {
  const assists = entry.assists ?? {};
  const page = entry.pages[0];
  // anchorAtStatline: roster blocks with no printed intro of their own (a
  // school's named veterans) anchor on the statline label itself — the name
  // expect covers the label run and there is no prose flow.
  let opened = null;
  let pd;
  let cols;
  if (assists.anchorAtStatline) {
    pd = await pageItems(doc, page);
    cols = axColumns(pd, assists);
  } else {
    opened = await axOpen(doc, entry);
    ({ pd, cols } = opened);
  }
  const a = opened?.a;
  const fields = {};
  if (opened) fields.name = opened.name;

  const statPage = assists.statlineAt ?? page;
  const spd = statPage === page ? pd : await pageItems(doc, statPage);
  const label = assists.statLabel ?? `${entry.name}:`;
  // Three label shapes: an exact run; a run that merely STARTS with the label
  // (the printer merged label and clause into one run); a run whose colon got
  // its own run. Merged runs strip the label by CHARACTER COUNT (stripPrefix —
  // a count, never text), since dropText only removes whole runs.
  const exact = spd.items.find((it) => collapse(it.str) === label);
  const merged = exact ? null : spd.items.find((it) => collapse(it.str).startsWith(label) && it.y > AX_TOP_BAND);
  const loose = exact || merged ? null : spd.items.find(
    (it) => /:$/.test(it.str.trim()) && collapse(it.str).toLowerCase().startsWith(label.replace(/:$/, "").toLowerCase()),
  );
  const labelRun = exact ?? merged ?? loose;
  if (!labelRun) throw new Error(`statline label "${label}" not found on p.${statPage}`);
  // The block: contiguous lines at (or right of) the label's indent, WITHIN the
  // label's own column — same-y items of the neighbouring column must not join
  // the cluster or break it.
  const scols = statPage === page ? cols : axColumns(spd, assists);
  const sCol = colOf(labelRun.x, scols);
  const sColX0 = scols[sCol] - 5;
  const sColX1 = scols[sCol + 1] ? scols[sCol + 1] - 6 : spd.width - 40;
  const lines = toLines(
    spd.items.filter(
      (it) => it.h <= AX_BODY_MAX_H && it.x >= sColX0 && it.x <= sColX1 && it.y >= labelRun.y - 2 && it.y < AX_FOOT_Y,
    ),
  ).map((ln) => ({ y: ln.y, x0: Math.min(...ln.items.map((i) => i.x)), items: ln.items }));
  const cluster = [lines[0]];
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i].y - lines[i - 1].y;
    if (gap > 19 || lines[i].x0 < labelRun.x - 8) break;
    cluster.push(lines[i]);
  }
  const clusterItems = new Set(cluster.flatMap((l) => l.items));
  const sx1 = Math.max(...cluster.flatMap((l) => l.items.map((i) => i.x + (i.w ?? 0))));
  fields.statline = withFixes(
    {
      op: "value", page: statPage, pattern: "statline",
      ...(merged ? {} : { dropText: collapse(labelRun.str) }),
      box: { x0: labelRun.x - 3, x1: sx1 + 3, y0: cluster[0].y - 4, y1: cluster[cluster.length - 1].y + 4 },
    },
    spd,
  );
  if (merged) {
    const runs = runsIn(spd, fields.statline);
    const li = runs.indexOf(labelRun);
    if (li >= 0) (fields.statline.fixes ??= {}).stripPrefix = { ...(fields.statline.fixes?.stripPrefix ?? {}), [li]: label.length };
  }

  if (!opened) {
    // The expect text is the LABEL as printed (sans colon) — always right by
    // construction, where the display name may normalize nicknames away.
    fields.name = {
      op: "expect", page: statPage,
      box: { x0: labelRun.x - 3, x1: labelRun.x + (labelRun.w ?? 60) + 3, y0: labelRun.y - 5, y1: labelRun.y + 5 },
      text: label.replace(/\s*:\s*$/, "").slice(0, 60),
    };
  } else {
    // Residents stack name-over-name with nothing display-size between them:
    // the entry's own statline (same page AND column as the anchor) ends the
    // prose, and every sibling npc's anchor is a stop line (plus any
    // chef-authored assists.stopLines, e.g. a section runin). `noDescStop`
    // opts out for blocks whose prose legitimately continues past the block
    // (Gabriol's spell appendix).
    const sameColBlock = statPage === page && sCol === a.col && labelRun.y > a.endY;
    const flowOpts = {
      stopAt: [
        ...(bookCtx?.npcAnchors?.filter((s) => s !== (entry.anchor?.runin ?? entry.anchor?.display)) ?? []),
        ...(assists.stopLines ?? []),
      ],
      ...(sameColBlock && !assists.noDescStop ? { stopYOnce: labelRun.y - 4 } : {}),
    };
    const segs = await axFlow(doc, entry, assists, { page, pd, cols, col: a.col, endY: a.endY }, clusterItems, flowOpts);
    const { paras } = axParas(segs, page, { iconTags: entry.book === "ax2" });
    if (paras.length) fields.description = { op: "text", page, paras };
  }

  if (assists.artName) {
    const art = await axPickArt(doc, fields, [], assists);
    if (art) fields.art = art;
  }
  const out = {
    kind: entry.kind, name: entry.name, cite: citeFor(entry.book, page), pages: entry.pages,
    ...(entry.meta ? { meta: entry.meta } : {}), fields,
  };
  const skipsOut2 = await axResidueAll(doc, entry.id, fields, { [page]: pd });
  axAssistSkips(skipsOut2, assists, page);
  if (Object.keys(skipsOut2).length) out._skips = skipsOut2;
  return out;
}

/**
 * kind.rolltable — two printed shapes.
 * GRID (assists.grid = {page, y0, y1, dieX0, dieX1, cellX0, cellX1,
 * claimDie?}): a die column beside result columns; one register entry per
 * result column. Rows cluster on lines that carry a die run; the die value is
 * read OFFLINE into the row's section label (r<lo> / r<lo>-<hi>) — structure,
 * like a page number — while the row text stays lazy.
 * LIST (default): the entry's own flowed prose where each row opens with an
 * "<n>:" run; the intro paragraphs before row 1 become `description` and the
 * roll formula materializes from them (or assists.rollAt).
 */
async function compileRollTable(doc, entry, kindRow) {
  const assists = entry.assists ?? {};
  const page = entry.pages[0];
  const fields = {};
  const skipsOut = {};
  let pd;
  let opened = null;
  if (assists.nameExpect) {
    // Anchor-less mode: some tables' only printed name is a small-caps column
    // header cell (the AX2 wandering grid). The expect box is chef geometry;
    // the executor's fold-compare absorbs the small-caps casing.
    const ne = assists.nameExpect;
    pd = await pageItems(doc, ne.page ?? page);
    fields.name = { op: "expect", page: ne.page ?? page, box: ne.box, text: ne.text ?? entry.name };
  } else {
    opened = await axOpen(doc, entry);
    pd = opened.pd;
    fields.name = opened.name;
  }

  const gridList = assists.grids ?? (assists.grid ? [assists.grid] : null);
  if (gridList) {
    // Several grid configs merge into ONE table: a d% table printed as two
    // side-by-side halves, or a grid continuing onto the next page. Rows keep
    // config order, which is the printed reading order.
    const paras = [];
    for (const g of gridList) {
      const gpage = g.page ?? page;
      const gpd = await pageItems(doc, gpage);
      const lines = toLines(gpd.items.filter((it) => it.y >= g.y0 && it.y <= g.y1 && it.x >= g.dieX0 && it.x <= g.cellX1));
      const rows = [];
      if (g.centerDies) {
        // Multi-line rows print the die number VERTICALLY CENTERED (the rumor
        // tables): a row's band runs midpoint-to-midpoint between consecutive
        // dies, not die-line-downward.
        const dies = gpd.items
          .filter((it) => it.y >= g.y0 && it.y <= g.y1 && it.x >= g.dieX0 && it.x <= g.dieX1 && AX_DIE_RE.test(it.str.trim()))
          .sort((a, b) => a.y - b.y);
        if (!dies.length) throw new Error(`grid dies empty for ${entry.id} p.${gpage}`);
        for (let i = 0; i < dies.length; i++) {
          const y0 = i === 0 ? g.y0 : (dies[i - 1].y + dies[i].y) / 2 + 1;
          const y1 = i === dies.length - 1 ? g.y1 : (dies[i].y + dies[i + 1].y) / 2 - 1;
          rows.push({ die: dies[i], band: { y0, y1 } });
        }
      } else {
        for (const ln of lines) {
          const die = ln.items.find((it) => it.x >= g.dieX0 && it.x <= g.dieX1 && AX_DIE_RE.test(it.str.trim()));
          const cellRuns = ln.items.filter((it) => it.x >= g.cellX0 && it.x <= g.cellX1);
          if (die) rows.push({ die, lines: [ln], cellRuns: [...cellRuns] });
          else if (rows.length && cellRuns.length) {
            rows[rows.length - 1].lines.push(ln);
            rows[rows.length - 1].cellRuns.push(...cellRuns);
          }
        }
      }
      if (!rows.length) throw new Error(`grid rows empty for ${entry.id} p.${gpage}`);
      for (const r of rows) {
        // No x padding: neighbouring result columns abut, and a run starting on
        // the shared edge must fall in exactly one entry's cell band.
        const x0 = g.claimDie ? g.dieX0 : g.cellX0;
        const para = {
          box: r.band
            ? { x0, x1: g.cellX1, y0: r.band.y0, y1: r.band.y1 }
            : { x0, x1: g.cellX1, y0: r.lines[0].y - 4, y1: r.lines[r.lines.length - 1].y + 4 },
          section: `r${r.die.str.trim().replace(/\s*[-–]\s*/g, "-").replace(/\s*,\s*/g, ",")}`,
        };
        if (gpage !== page) para.page = gpage;
        const drop = g.claimDie ? new Set([r.die]) : null;
        paras.push(withFixes(para, gpd, drop));
      }
      if (g.headerSkip) (skipsOut[gpage] ??= []).push({ x0: g.dieX0 - 2, x1: g.cellX1 + 2, y0: g.headerSkip[0], y1: g.headerSkip[1], reason: "table-header" });
    }
    fields.rows = { op: "text", page, paras };
    // An anchored grid table may carry section intro prose above/before the
    // grid (bounded by assists.descStopY, which also ends the flow).
    if (opened) {
      const segs = await axFlow(doc, entry, assists, { page, pd, cols: opened.cols, col: opened.a.col, endY: opened.a.endY });
      const { paras: dparas } = axParas(segs, page, { iconTags: entry.book === "ax2" });
      if (dparas.length) fields.description = { op: "text", page, paras: dparas };
    }
  } else if (!opened) {
    throw new Error(`${entry.id}: list-shape rolltable needs a heading anchor (no assists.nameExpect shortcut)`);
  } else {
    const { cols, a } = opened;
    // LIST shape: rows come out of the entry's own flow. A row that runs past
    // its column's foot continues in the next segment, so each row holds
    // PORTIONS (one per segment touched) that ship as sibling paras under the
    // same r<range> section.
    const segs = await axFlow(doc, entry, assists, { page, pd, cols, col: a.col, endY: a.endY });
    const intro = [];
    const rows = [];
    for (const seg of segs) {
      const lines = toLines(seg.items).map((ln) => ({
        y: ln.y,
        x0: Math.min(...ln.items.map((i) => i.x)),
        items: [...ln.items].sort((a, b) => a.x - b.x),
      }));
      for (const ln of lines) {
        const first = ln.items[0];
        const m = /^(\d+(?:\s*[-–]\s*\d+)?)\s*:$/.exec(first.str.trim());
        // The printer sometimes fuses the anchor with its text ("8: A frail…"
        // in one run) — a fused anchor still starts a row; its digits strip by
        // CHARACTER COUNT instead of a whole-run drop.
        const fused = m ? null : /^(\d+(?:\s*[-–]\s*\d+)?)(\s*:\s*)\S/.exec(first.str);
        if (m || fused) {
          const g = m ?? fused;
          rows.push({
            range: g[1].replace(/\s*[-–]\s*/, "-"),
            anchor: first,
            fusedLen: fused ? g[1].length + g[2].length : 0,
            portions: [{ seg, lines: [ln] }],
          });
        } else if (rows.length) {
          const row = rows[rows.length - 1];
          const last = row.portions[row.portions.length - 1];
          if (last.seg === seg) last.lines.push(ln);
          else row.portions.push({ seg, lines: [ln] });
        } else {
          intro.push({ ln, seg });
        }
      }
    }
    if (!rows.length) throw new Error(`no "<n>:" rows under "${entry.name}" p.${page}`);
    if (intro.length) {
      const iSegs = new Map();
      for (const { ln, seg } of intro) {
        if (!iSegs.has(seg)) iSegs.set(seg, []);
        iSegs.get(seg).push(...ln.items);
      }
      const iParas = axParas([...iSegs.entries()].map(([seg, items]) => ({ ...seg, items })), page, {});
      if (iParas.paras.length) {
        fields.description = { op: "text", page, paras: iParas.paras };
        if (!assists.rollAt) {
          const p0 = iParas.paras[0];
          fields.roll = { op: "value", page: p0.page ?? page, pattern: "dice", box: p0.box };
        }
      }
    }
    fields.rows = {
      op: "text", page,
      paras: rows.flatMap((r) =>
        r.portions.map((portion, pi) => {
          const para = {
            box: {
              x0: portion.seg.x0, x1: portion.seg.x1,
              y0: portion.lines[0].y - 3, y1: portion.lines[portion.lines.length - 1].y + 3,
            },
            section: `r${r.range}`,
          };
          if (portion.seg.page !== page) para.page = portion.seg.page;
          const strip = pi === 0 && r.fusedLen ? new Map([[r.anchor, r.fusedLen]]) : null;
          return withFixes(para, portion.seg.pd, pi === 0 && !r.fusedLen ? new Set([r.anchor]) : null, strip);
        }),
      ),
    };
  }
  if (assists.rollAt) {
    fields.roll = { op: "value", page: assists.rollAt.page ?? page, pattern: "dice", box: assists.rollAt.box };
  }
  const out = {
    kind: entry.kind, name: entry.name, cite: citeFor(entry.book, page), pages: entry.pages,
    ...(entry.meta ? { meta: entry.meta } : {}), fields,
  };
  const rSkips = await axResidueAll(doc, entry.id, fields, { [fields.name.page ?? page]: pd });
  for (const [p, boxes] of Object.entries(rSkips)) skipsOut[p] = [...(skipsOut[p] ?? []), ...boxes];
  axAssistSkips(skipsOut, assists, page);
  if (Object.keys(skipsOut).length) out._skips = skipsOut;
  return out;
}

/**
 * kind.monsterLegacy — the ACKS I appendix block: a label column with one
 * value column per variant. Single-variant entries claim the labels too
 * (dropText per row, exactly the MM stat treatment); with assists.variantCol
 * the entry claims only its variant's x-band and the FIRST variant of the
 * block also claims labels.
 */
async function compileLegacyMonster(doc, entry, kindRow) {
  const { assists, page, pd, cols, a, name } = await axOpen(doc, entry);
  const fields = { name };
  const colX0 = cols[a.col] - AX_HANG - 2;
  const colX1 = cols[a.col + 1] ? cols[a.col + 1] - AX_HANG - 3 : pd.width - 40;
  // Some variant blocks span the FULL page width above two-column prose (the
  // eight-variant animal mummies): the block machinery then reads the whole
  // width while the prose flow keeps the page's real columns.
  const bX1 = assists.blockFullWidth ? pd.width - 34 : colX1;
  const rowsMap = kindRow.fields.stats.rows;
  // Case-insensitive: "% in Lair:" prints lowercase on some pages.
  const labelRe = new RegExp(`^(${Object.keys(rowsMap).map((k) => k.replace(/[%()]/g, "\\$&")).join("|")})\\s*:$`, "i");
  const rowsMapLower = Object.fromEntries(Object.entries(rowsMap).map(([k, v]) => [k.toLowerCase(), v]));
  // A page may stack SEVERAL variant blocks under one heading (MUMMY, ANIMAL
  // prints eight variants as two four-column blocks); assists.statBlockY pins
  // this entry to its block's y-band.
  const blockLo = assists.statBlockY?.[0] ?? a.endY;
  const blockHi = assists.statBlockY?.[1] ?? AX_FOOT_Y;
  const labels = pd.items
    .filter((it) => it.h <= AX_BODY_MAX_H && it.x >= colX0 && it.x <= bX1 && it.y > blockLo && it.y < blockHi && labelRe.test(collapse(it.str)))
    .sort((x, y) => x.y - y.y);
  if (!labels.length) throw new Error(`no legacy stat labels under "${entry.name}" p.${page}`);
  const blockY0 = labels[0].y;
  const blockY1 = labels[labels.length - 1].y;

  // Variant headers sit between the heading (or block band top) and the first
  // label row.
  const variantRuns = toLines(
    pd.items.filter((it) => it.h <= AX_BODY_MAX_H && it.x >= colX0 && it.x <= bX1 && it.y > (assists.statBlockY ? blockLo : a.endY + 2) && it.y < blockY0 - 3),
  ).flatMap((ln) => ln.items).sort((x, y) => x.x - y.x);
  let bandX0;
  let bandX1 = bX1;
  let claimLabels = true;
  if (assists.variantCol) {
    const idx = variantRuns.findIndex((r) => collapse(r.str).toLowerCase() === assists.variantCol.toLowerCase());
    if (idx < 0) throw new Error(`variant column "${assists.variantCol}" not found for ${entry.id}`);
    bandX0 = variantRuns[idx].x - 6;
    if (variantRuns[idx + 1]) bandX1 = variantRuns[idx + 1].x - 6;
    claimLabels = idx === 0;
  } else {
    const valueXs = labels
      .map((l) => pd.items.filter((it) => Math.abs(it.y - l.y) <= 3 && it.x > l.x + (l.w ?? 0) + 2 && it.x <= bX1).sort((x, y) => x.x - y.x)[0])
      .filter(Boolean)
      .map((it) => it.x);
    bandX0 = (valueXs.length ? Math.min(...valueXs) : labels[0].x + 60) - 4;
  }

  for (const l of labels) {
    const key = collapse(l.str).replace(/\s*:$/, "").toLowerCase();
    const spec = rowsMapLower[key];
    if (!spec) continue;
    const instr = {
      op: "value", page, pattern: spec.pattern,
      ...(spec.table ? { table: spec.table } : {}),
      box: {
        x0: claimLabels ? l.x - 2 : bandX0,
        x1: bandX1,
        y0: l.y - 4.5, y1: l.y + 4.5,
      },
      ...(claimLabels ? { dropText: collapse(l.str) } : {}),
    };
    fields[`stats.${spec.field}`] = instr;
  }
  // The variant-header line itself: claimed by the first variant via an expect
  // (integrity: the header should read as the variant name).
  if (assists.variantCol && claimLabels) {
    // covered by the name expect only when adjacent; claim header runs as a skip
    // band instead — they are column captions, not content.
  }

  const segs = await axFlow(doc, entry, { ...assists, descStopY: assists.descStopY }, { page, pd, cols, col: a.col, endY: (assists.descStartY ?? blockY1) + 4 });
  const { paras } = axParas(segs, page, {});
  if (paras.length) fields.description = { op: "text", page, paras };

  if (assists.artName) {
    const art = await axPickArt(doc, fields, [], assists);
    if (art) fields.art = art;
  }
  const out = {
    kind: entry.kind, name: entry.name, cite: citeFor(entry.book, page), pages: entry.pages,
    ...(entry.meta ? { meta: entry.meta } : {}), fields,
  };
  const skipsOut2 = await axResidueAll(doc, entry.id, fields, { [page]: pd });
  axAssistSkips(skipsOut2, assists, page);
  if (Object.keys(skipsOut2).length) out._skips = skipsOut2;
  return out;
}

const AX_COMPILERS = {
  "kind.location": compileLocation,
  "kind.npc": compileNpc,
  "kind.rolltable": compileRollTable,
  "kind.monsterLegacy": compileLegacyMonster,
  "kind.monsterTemplate": compileMonsterTemplate,
};

/* -------------------------------------------- */
/*  Class compilation (kind.class)              */
/* -------------------------------------------- */

/**
 * kind.class — an RR class spread. The register's `class` block is chef
 * WIRING, not geometry: table TITLES with column keys, award specs whose
 * grant levels are from.pattern locators, a cleave phrase pattern, chassis
 * keys, the proficiency-list label. This compiler resolves every named table
 * against the reference PDF — title row → header row → data rows → column
 * spans from header-cell midpoints — and emits v2 `grid` instructions, plus
 * clipped `value` ops for the four header bullets, the proficiency list, and
 * per-page raw body text the binder resolves award/cleave patterns against.
 * Values never ship: every instruction is a box and a pattern.
 */
async function compileClass(doc, entry, kindRow) {
  // Same per-book body ceiling as compileDefinition: defColumns' run-in
  // fallback reads it, and a stale value from the previous book's entry
  // leaves a table-dominated BTA page unrecovered at one column.
  DEF_BODY_MAX_H = DEF_BODY_MAX_H_BY_BOOK[entry.book] ?? 10;
  const spec = entry.class ?? {};
  const page = entry.pages[0];
  const pd = await pageItems(doc, page);
  const cols = detectColumns(pd.items);
  const fields = {};
  const fold = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

  /* --- anchor / name --- */
  // Folded on both sides: a heading's glyph runs may join with no spaces at
  // all ("DWarVenDelVer"), which a space-sensitive compare never matches.
  const anchors = listHeadings(pd).filter((a) => a.mode === "display");
  const anchor = anchors.find((a) => fold(a.text).startsWith(fold(entry.anchor.display)));
  if (!anchor) throw new Error(`display anchor "${entry.anchor.display}" not found on p.${page}`);
  const colX = cols[anchor.col];
  const nextX = cols[anchor.col + 1];
  const colRight = nextX ? nextX - 6 : pd.width;
  fields.name = {
    op: "expect", page,
    box: { x0: colX - 5, x1: colRight, y0: anchor.y - 16, y1: anchor.y + 6 },
    text: entry.anchor.display,
  };

  /* --- tables located by their printed titles --- */
  const tableEdges = [];
  const lineRows = (items, tol = 3) => {
    const by = new Map();
    for (const it of items) {
      const k = Math.round(it.y / tol);
      (by.get(k) ?? by.set(k, []).get(k)).push(it);
    }
    return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v.sort((a, b) => a.x - b.x));
  };
  const joinRow = (row) => row.map((i) => i.str).join("");
  // One glue width cannot serve every book: BTA's right-aligned XP figures
  // sit 6-8px from their Title neighbours (RR's sit wider), while BTA's own
  // intra-cell fragments stay under 4px apart. At 6 the two columns fused
  // into one cell, no data row matched the declared count, and every BTA
  // progression fell to the header-span fallback.
  const cellGap = entry.book === "bta" ? 4 : 6;
  const rebuildCells = (row, gap = 3) => {
    const cells = [];
    for (const it of row) {
      const prev = cells[cells.length - 1];
      if (prev && it.x - (prev.x + (prev.w ?? 0)) < gap) {
        prev.str += it.str;
        prev.w = it.x + (it.w ?? 0) - prev.x;
      } else cells.push({ str: it.str, x: it.x, w: it.w ?? 0, y: it.y });
    }
    return cells;
  };
  // A data row's leftmost cell: a level number ("7"), a band ("2 – 3", "11 – 12",
  // "14+"), or an XP figure — never a word.
  const looksLikeDataStart = (s) => /^\d[\d,]*(?:\s*[–-]\s*\d+)?\+?$/.test(s.trim());

  /**
   * Find where a label/title STARTS, run-split and shared-row tolerant: scan
   * reconstructed rows for the folded target and return the run at the match
   * offset. Titles share rows with the other column's prose, and two tables
   * printed side by side share one title row — startsWith on a whole row
   * cannot see either.
   */
  const findLabelRun = (items, label, { last = false } = {}) => {
    const target = fold(label);
    let found = null;
    for (const r of lineRows(items)) {
      let acc = "";
      const starts = r.map((it) => {
        const s = acc.length;
        acc += fold(it.str);
        return s;
      });
      const at = acc.indexOf(target);
      if (at < 0) continue;
      let idx = 0;
      for (let i = 0; i < starts.length; i++) if (starts[i] <= at) idx = i;
      if (!last) return r[idx];
      found = r[idx];
    }
    return found;
  };

  // Pass 1 — locate every table's title run, so side-by-side tables can bound
  // each other's x-region.
  const pdCache = new Map([[page, pd]]);
  const pageOf = async (n) => {
    if (!pdCache.has(n)) pdCache.set(n, await pageItems(doc, n));
    return pdCache.get(n);
  };
  const located = [];
  for (const [tname, t] of Object.entries(spec.tables ?? {})) {
    const tpd = await pageOf(t.page);
    // A spread that MENTIONS its table before printing it ("as shown on the
    // Barbarian Combat Proficiencies table below") has the phrase twice, and the
    // first is prose in the far column — which anchors the whole table's
    // geometry on the wrong x. `titleLast` says the heading is the later one.
    const titleRun = findLabelRun(tpd.items, t.title, { last: !!t.titleLast });
    if (!titleRun) {
      warn(`${entry.id}: table title "${t.title}" not found on p.${t.page}`);
      continue;
    }
    located.push({ tname, t, tpd, tablePage: t.page, titleX0: titleRun.x, titleY: titleRun.y });
  }

  for (const { tname, t, tpd, tablePage, titleX0, titleY } of located) {
    // Everything left of the table (the class prose column, interleaved
    // headings) shares the same y-bands — clip to the table's own x-region,
    // anchored on where its title starts. A sibling table printed to the
    // RIGHT on the same page (the priestess/witch split pair) bounds this
    // one's right edge. The rotated chapter tab in the outer margin and the
    // ~5pt superscript fragments would otherwise form phantom rows that end
    // the data walk early and bridge adjacent column clusters.
    const rightSibling = located
      .filter((o) => o.tablePage === tablePage && o.titleX0 > titleX0 + 10 && Math.abs(o.titleY - titleY) < 40)
      .reduce((min, o) => Math.min(min, o.titleX0), Infinity);
    const clipX1 = Math.min(tpd.width - 45, rightSibling - 10);
    const rowsAt = (xMax) =>
      lineRows(tpd.items.filter((i) => i.h >= 7 && i.str.trim() && i.x >= titleX0 - 12 && i.x <= xMax));
    let rows = rowsAt(clipX1);
    let titleIdx = rows.findIndex((r) => fold(joinRow(r)).includes(fold(t.title)));

    /* --- banded tables: logical rows anchored on their own label column ------
     *
     * Two shapes, one mechanism. A TEMPLATES table anchors its rows on the 3d6
     * band printed in the first column; a TRAINING table (the Barbarian's
     * regions, a Zaharan's dark paths) anchors on the region NAME. Both have
     * cells that wrap over several printed lines, which is why neither can be
     * read by clustering on y alone — a five-line equipment cell or a
     * twelve-weapon list would come back as five rows of fragments.
     *
     * A LABEL THAT WRAPS IS STILL ONE LABEL. "Ivory" and "Kingdoms" print on
     * consecutive lines nine points apart, while one region and the next stand
     * thirty apart; a wrap is therefore a label line closer to its predecessor
     * than the gap between real rows, and it joins rather than opening a band.
     */
    if (t.kind === "templates" || t.kind === "training") {
      const flat = rows.slice(titleIdx + 1).flat();
      const bandRe = /^\d{1,2}\s*[–-]\s*\d{1,2}$/;
      const isBandLabel = (str) => (t.kind === "templates" ? bandRe.test(str) : /^[A-Za-z][A-Za-z' -]{1,28}$/.test(str));
      const bandLabels = [];
      if (t.kind === "training") {
        // READ THE LABEL COLUMN OFF THE PAGE, not off the assembled rows. This
        // table's print lines stand four to nine points apart, so `lineRows`
        // folds a region's name in with the armour rung above it and the weapon
        // list beside it, and the first cell of that merged row is whatever
        // sorted leftmost — one band for the whole table. The label column is a
        // geometric fact; take it as one.
        const labelX1 = titleX0 + 45;
        const titleY = rows[titleIdx]?.[0]?.y ?? 0;
        for (const it of tpd.items) {
          if (it.x < titleX0 - 12 || it.x > labelX1 || it.y <= titleY + 8) continue;
          if (!(it.h >= 7) || !isBandLabel(it.str.trim())) continue;
          bandLabels.push({ y: it.y, x: it.x, str: it.str.trim() });
        }
        bandLabels.sort((a, b) => a.y - b.y);
      } else {
        for (const r of rows.slice(titleIdx + 1)) {
          const first = rebuildCells(r, cellGap)[0];
          if (!first || !isBandLabel(first.str.trim())) continue;
          bandLabels.push({ y: r[0].y, x: first.x, str: first.str.trim() });
        }
      }
      if (t.kind === "training" && bandLabels.length > 2) {
        const gaps = bandLabels.slice(1).map((b, i) => b.y - bandLabels[i].y).sort((a, b) => a - b);
        const typical = gaps[Math.floor(gaps.length / 2)];
        for (let i = bandLabels.length - 1; i > 0; i--) {
          if (bandLabels[i].y - bandLabels[i - 1].y < typical * 0.6) bandLabels.splice(i, 1);
        }
      }
      const minBands = t.kind === "templates" ? 6 : 2;
      if (bandLabels.length < minBands) {
        warn(`${entry.id}: table "${t.title}" found only ${bandLabels.length} band row(s), wanted ${minBands}`);
        continue;
      }
      // The table ends at its Notes line — or at a bare footnote asterisk:
      // the mage's table closes with "* Each template assumes…" and no Notes
      // prefix at all.
      const notes = flat.find(
        (i) => i.y > bandLabels[bandLabels.length - 1].y + 4 && (/^Notes/i.test(i.str.trim()) || /^\*/.test(i.str.trim())),
      );
      const yEnd = notes ? notes.y - 4 : Math.max(...flat.map((i) => i.y)) + 6;
      // Rows are vertically CENTERED on their band label (a five-line
      // equipment cell starts above it), so bands split at label midpoints.
      const mid = (a, b) => (a + b) / 2 + 0.5;
      const firstGap = bandLabels[1].y - bandLabels[0].y;
      const rowBands = bandLabels.map((b, i) => ({
        y0: i === 0 ? b.y - firstGap / 2 : mid(bandLabels[i - 1].y, b.y),
        y1: i === bandLabels.length - 1 ? yEnd : mid(b.y, bandLabels[i + 1].y),
      }));
      // Column spans from the header cells (left-aligned prose columns).
      const headerPool = [];
      for (const r of rows.slice(titleIdx + 1)) {
        if (r[0].y >= bandLabels[0].y - 2) break;
        headerPool.push(...rebuildCells(r, cellGap));
      }
      const headerX = (name) => {
        const cell =
          headerPool.find((c) => fold(c.str) === fold(name)) ??
          headerPool.find((c) => fold(c.str).startsWith(fold(name))) ??
          headerPool.find((c) => fold(c.str).length >= 3 && fold(name).startsWith(fold(c.str)));
        return cell?.x ?? null;
      };
      const DEFAULT_COLS = {
        templates: [
          { key: "template", header: "Template" },
          { key: "proficiencies", header: "Proficiencies" },
          { key: "equipment", header: "Starting Equipment" },
        ],
        training: [
          { key: "armour", header: "Armor" },
          { key: "weapons", header: "Weapon Proficiencies" },
          { key: "styles", header: "Fighting Style Proficiencies" },
        ],
      };
      // A column may state its own x. The header search reads the lines between
      // the title and the first band, and on a table whose rows print four
      // points apart those lines fold together — the Barbarian's "Weapon
      // Proficiencies" heading arrives welded to the first weapon list under
      // it. Where the page defeats the search, the recipe gives the geometry
      // instead of a better guess.
      const colDefs = (t.cols ?? DEFAULT_COLS[t.kind]).map((c) => ({
        ...c,
        hx: typeof c.x === "number" ? c.x : headerX(c.header),
      }));
      if (colDefs.some((c) => c.hx == null)) {
        warn(`${entry.id}: table "${t.title}" missing template header(s): ${colDefs.filter((c) => c.hx == null).map((c) => c.header).join(", ")}`);
        continue;
      }
      const orderedT = [...colDefs].sort((a, b) => a.hx - b.hx);
      const tX1 = Math.max(...flat.filter((i) => i.y >= rowBands[0].y0 && i.y <= yEnd).map((i) => i.x + (i.w ?? 0))) + 8;
      const spanT = (i) => ({
        x0: i === 0 ? orderedT[0].hx - 6 : orderedT[i].hx - 6,
        x1: i === orderedT.length - 1 ? tX1 : orderedT[i + 1].hx - 8,
      });
      const labelX1 = orderedT[0].hx - 8;
      fields[tname] = {
        op: "grid", page: t.page,
        box: { x0: titleX0 - 10, x1: tX1, y0: rowBands[0].y0, y1: yEnd },
        label: { x0: titleX0 - 10, x1: labelX1 },
        cols: [
          { key: "band", x0: titleX0 - 10, x1: labelX1, pattern: "rollBand" },
          ...orderedT.map((c, i) => ({ key: c.key, ...spanT(i) })),
        ],
        rowBands,
        // Italic spell names inside equipment cells sit under 2px from their
        // roman neighbours; 1.2 keeps those word gaps while letter-split
        // small-caps runs (~0.3px) still join blind.
        gapMin: 1.2,
      };
      continue;
    }
    // Header cells pool: the non-data rows between the title and the first
    // data row — the main header line plus any stacked wrap lines ("Damage"
    // above, "Bonus" below). Fused at a wider gap so "Hit"+"d"+"ice" is one
    // cell.
    const declaredCount = (t.cols?.length ?? 0) + 1;
    // A caster table's numbered sub-header line ("1 2 3 4 5 6") starts with a
    // digit exactly like a data row — the cell-count gate is what tells them
    // apart: a data row carries (nearly) every declared column.
    // A discovered-column table has no authored count to compare against, so
    // the floor is "wide enough to be a grid row": three cells. Without it the
    // threshold collapses to one and the spanning caption above the header line
    // ("Crusader Level") is read as the table's first data row.
    const dataShaped = (r) =>
      rebuildCells(r, cellGap).length >= (t.colsFromHeader ? 3 : Math.max(Math.min(2, declaredCount), Math.ceil(declaredCount * 0.7)));
    // A spanning-group sub-header line is ALL small integers ("1 2 3 4 5 6",
    // twice for the Nobiran) — enough cells to pass the shape gate, so it is
    // recognized by content and stays a header line.
    const allTinyInts = (r) => {
      const cells = rebuildCells(r, cellGap);
      return cells.length >= 3 && cells.every((c) => /^\d{1,2}$/.test(c.str.trim()) && parseInt(c.str, 10) <= 14);
    };
    /**
     * Is this row's first cell the start of a DATA row?
     *
     * Every level-keyed table answers "it is a number", which is why the rule
     * was written that way. A table keyed on a NAME cannot: the Crusader
     * Rebuking Undead grid's label column holds undead types and its columns
     * hold the crusader's levels, so the numeric rule finds no data at all.
     *
     * `labelText` says the label column is a name, and then the header lines
     * are told apart by what they ARE rather than by not being numeric: the
     * line carrying the declared label header, a spanning line of bare
     * integers, and anything too narrow to be a row.
     */
    const labelFold = fold(t.labelHeader ?? "");
    const isDataFirst = (raw, row) =>
      t.labelText ? /^[\p{L}]/u.test(raw) && !(labelFold && fold(joinRow(row)).startsWith(labelFold)) : looksLikeDataStart(raw);
    const walk = (rowSet, startIdx) => {
      const headerCells = [];
      const dataRows = [];
      let headerLines = 0;
      for (const r of rowSet.slice(startIdx + 1)) {
        // Data-start is judged on the row's RAW first run: a wide figure
        // ("370,000") sits close enough to the title cell beside it that a
        // fused rebuild would hide the numeric start.
        const firstRaw = (r[0]?.str ?? "").trim();
        if (!dataRows.length && (!(isDataFirst(firstRaw, r) && dataShaped(r)) || allTinyInts(r))) {
          if (++headerLines > 6) break;
          headerCells.push(...rebuildCells(r, cellGap));
          continue;
        }
        // A lone footnote marker sitting on its own baseline between two rows
        // is not the end of the table. It carries no cells, so it can never be
        // mistaken for data; skipping it keeps the row it marks (the Rebuking
        // grid's last row is the one that is asterisked).
        if (dataRows.length && rebuildCells(r, cellGap).length <= 1 && /^[*†‡]$/.test(firstRaw)) continue;
        if (!isDataFirst(firstRaw, r) || !dataShaped(r)) break;
        if (dataRows.length && r[0].y - dataRows[dataRows.length - 1][0].y > 20) break;
        dataRows.push(r);
      }
      return { headerCells, dataRows };
    };
    let { headerCells, dataRows } = walk(rows, titleIdx);
    // A narrow table beside a prose column collects the prose into its rows,
    // so the walk breaks on the first interleaved line. The declared headers
    // say how wide the table really is — re-clip to their extent and re-walk.
    if (!t.colsFromHeader) {
      const matchedXs = (t.cols ?? [])
        .map(
          (c) =>
            (
              headerCells.find((h) => fold(h.str) === fold(c.header) || fold(h.str).startsWith(fold(c.header))) ??
              headerCells.find((h) => fold(h.str).length >= 4 && fold(c.header).startsWith(fold(h.str)))
            )?.x,
        )
        .filter((x) => x != null);
      if (matchedXs.length === (t.cols ?? []).length) {
        const headerRight = Math.max(...matchedXs) + 50;
        // Only a genuinely NARROW table re-clips — nibbling a full-width
        // table's last column is worse than tolerating interleave.
        if (headerRight < clipX1 - 60) {
          rows = rowsAt(Math.min(clipX1, headerRight));
          titleIdx = rows.findIndex((r) => fold(joinRow(r)).includes(fold(t.title)));
          ({ headerCells, dataRows } = walk(rows, titleIdx));
        }
      }
    }
    if (dataRows.length < 4) {
      warn(`${entry.id}: table "${t.title}" resolved only ${dataRows.length} data row(s)`);
      continue;
    }
    /* A table whose columns ARE the scale it is read at — the rebuking grid,
     * whose columns are the crusader's levels. Authoring those headers would
     * transcribe how many levels the table prints and where it stops, which is
     * a value off the page like any other. They are DISCOVERED instead: the
     * header line to the right of the label column votes one column each, keyed
     * by position, and the runtime reads what each one SAYS out of the seat's
     * own book (see `headerBand` below). What ships is geometry — the same
     * thing every other span in this file is.
     */
    let discovered = null;
    if (t.colsFromHeader) {
      const labelCell =
        headerCells.find((c) => fold(c.str) === fold(t.labelHeader)) ??
        headerCells.find((c) => fold(c.str).startsWith(fold(t.labelHeader))) ??
        headerCells.find((c) => fold(t.labelHeader).startsWith(fold(c.str)) && fold(c.str).length >= 3);
      if (!labelCell) {
        warn(`${entry.id}: table "${t.title}" — no label header to discover columns from`);
        continue;
      }
      // The scale line is the header line carrying the MOST cells right of the
      // label column. It is not the label header's own line — that header can
      // sit a line above the scale, under a spanning caption — and it is not
      // simply the last line either. Counting is the only rule that survives
      // both arrangements without knowing what any of the cells say.
      const byLine = new Map();
      for (const c of headerCells) {
        if (c.x <= labelCell.x + 4) continue;
        const key = Math.round(c.y / 4);
        (byLine.get(key) ?? byLine.set(key, []).get(key)).push(c);
      }
      const scaleCells = [...byLine.values()].sort((a, b) => b.length - a.length)[0] ?? [];
      scaleCells.sort((a, b) => a.x - b.x);
      if (scaleCells.length < 2) {
        warn(`${entry.id}: table "${t.title}" — only ${scaleCells.length} scale column(s) discovered`);
        continue;
      }
      discovered = { cells: scaleCells, labelCell, scaleY: scaleCells[0].y };
    }
    // Authored column order is the REGISTER's; physical order comes from the
    // matched header x (the label column sits mid-table in a progression).
    // Spans are assigned per physical index, so the two must be reconciled
    // here — every header has to match, or the table cannot be ordered.
    const declared = discovered
      ? [
          { key: "__label", header: t.labelHeader, hx: discovered.labelCell.x },
          ...discovered.cells.map((c, i) => ({ key: `c${i + 1}`, header: c.str, hx: c.x })),
        ]
      : [{ key: "__label", header: t.labelHeader }, ...(t.cols ?? [])];
    let unmatched = false;
    for (const w of discovered ? [] : declared) {
      // `occurrence` picks the nth exact header match in x order — the
      // Nobiran prints "1".."6" twice (arcane and divine spell groups).
      const exact = headerCells.filter((c) => fold(c.str) === fold(w.header)).sort((a, b) => a.x - b.x);
      const cell =
        (w.occurrence ? exact[w.occurrence - 1] : exact[0]) ??
        headerCells.find((c) => fold(c.str).startsWith(fold(w.header))) ??
        // A wrapped header prints only its first line on the header row
        // ("Damage" for "Damage Bonus") — match the authored name's prefix.
        // The length gate admits "Hit" (for "Hit Dice") but still refuses
        // one- and two-glyph fragments that would prefix half the register.
        headerCells.find((c) => fold(c.str).length >= 3 && fold(w.header).startsWith(fold(c.str))) ??
        // Tight settings can still glue a header to its neighbour into one
        // rebuilt cell, which no prefix rule reaches — as a last resort take
        // a cell that CONTAINS the authored name whole.
        headerCells.find((c) => fold(w.header).length >= 4 && fold(c.str).includes(fold(w.header)));
      if (!cell) {
        warn(`${entry.id}: table "${t.title}" missing header "${w.header}"`);
        unmatched = true;
      } else w.hx = cell.x;
    }
    if (unmatched) continue;
    const wanted = [...declared].sort((a, b) => a.hx - b.hx);
    // Column spans come from the DATA, not the headers: headers are
    // left-aligned while number cells are right-aligned or centred, so header
    // x lands nowhere near its data — and neighbouring cells can sit within a
    // word-space of each other, so x-gap clustering under-counts. Instead the
    // rows whose rebuilt cell count EQUALS the authored column count vote the
    // spans per index; rows with extra fragments still extract through those
    // spans at runtime.
    const idealRows = dataRows.map((r) => rebuildCells(r, cellGap)).filter((cells) => cells.length === wanted.length);
    let groups;
    if (idealRows.length >= 3) {
      groups = wanted.map((_, i) => ({
        x0: Math.min(...idealRows.map((cells) => cells[i].x)),
        x1: Math.max(...idealRows.map((cells) => cells[i].x + Math.max(cells[i].w ?? 0, 4))),
      }));
    } else {
      // Twelve tight single-digit columns (the Nobiran's dual spell groups)
      // fuse below the declared count in every row — fall back to spans
      // midway between the matched HEADER positions, which single-digit
      // centred cells sit under closely enough.
      warn(`${entry.id}: table "${t.title}" — header-span fallback (${idealRows.length} ideal row(s))`);
      const hs = wanted.map((w) => w.hx);
      const dataX1 = Math.max(...dataRows.flat().map((i) => i.x + (i.w ?? 0)));
      groups = wanted.map((w, i) => ({
        x0: i === 0 ? Math.min(...dataRows.map((r) => r[0].x)) - 2 : (hs[i - 1] + hs[i]) / 2 + 2,
        x1: i === wanted.length - 1 ? dataX1 + 4 : (hs[i] + hs[i + 1]) / 2 + 2,
      }));
    }
    const tableX0 = groups[0].x0;
    const tableX1 = groups[groups.length - 1].x1;
    const spanOf = (idx) => ({
      x0: idx === 0 ? tableX0 - 6 : (groups[idx - 1].x1 + groups[idx].x0) / 2,
      x1: idx === groups.length - 1 ? tableX1 + 10 : (groups[idx].x1 + groups[idx + 1].x0) / 2,
    });
    const labelIdx = wanted.findIndex((w) => w.key === "__label");
    const labelSpan = spanOf(labelIdx);
    const y0 = dataRows[0][0].y - 4;
    const y1 = dataRows[dataRows.length - 1][0].y + 5;
    const gridCols = wanted
      .map((w, i) => ({ w, i }))
      .filter(({ w }) => w.key !== "__label")
      .map(({ w, i }) => ({ key: w.key, ...spanOf(i), ...(w.pattern ? { pattern: w.pattern } : {}) }));
    if (t.band) gridCols.unshift({ key: "band", ...labelSpan, pattern: "rollBand" });
    fields[tname] = {
      op: "grid", page: t.page,
      box: { x0: tableX0 - 6, x1: tableX1 + 10, y0, y1 },
      label: labelSpan,
      cols: gridCols,
      gapMin: 2,
      // Where the column HEADERS sit, for a table whose columns are the scale
      // it is read at. The runtime reads what they say out of the seat's own
      // book, so no printed level, and no count of them, is authored or shipped
      // — only where on the page to look.
      // Banded on the SCALE line, not on the label header's — the two are
      // different lines whenever a spanning caption pushes the label up.
      ...(discovered ? { headerBand: { y0: discovered.scaleY - 5, y1: discovered.scaleY + 4 } } : {}),
    };
    tableEdges.push({ page: t.page, x0: tableX0, y0, y1 });
  }

  /* --- header bullets, clipped to the anchor column AND short of any table
         that shares their LINES, so a beside-the-header table's figures cannot
         bleed into the joined text ("Hit Dice: 1d8" + "8,000" reads as 1d88).
         A full-width table at the page bottom shares no lines and must not
         collapse the boxes. --- */
  // A field's label varies by book ("Key Attribute:" is RR vocabulary; BTA
  // prints "Prime Requisite:") — each row lists every accepted label and the
  // first one found wins, so a miss warns only when NO label matches.
  const HEADER_FIELDS = [
    ["hitDie", ["Hit Dice:"], "dice"],
    ["maximumLevel", ["Maximum Level:"], "int"],
    ["keyAttribute", ["Key Attribute:", "Prime Requisite:"], "raw"],
    ["requirements", ["Requirements:"], "raw"],
  ];
  const headerWindow = pd.items.filter(
    (i) => colOf(i.x, cols) === anchor.col && i.y > anchor.y && i.y < anchor.y + 100,
  );
  for (const [key, labels, pattern] of HEADER_FIELDS) {
    let it = null;
    let label = labels[0];
    for (const l of labels) {
      it = headerWindow.find((i) => i.str.trim().startsWith(l)) ?? findLabelRun(headerWindow, l);
      if (it) {
        label = l;
        break;
      }
    }
    if (!it) {
      warn(`${entry.id}: header bullet "${labels.join('" / "')}" not found on p.${page}`);
      continue;
    }
    // The value trails its label on the same line within the header block —
    // a fixed reach beats detectColumns here, which sees phantom columns on
    // pages whose progression table is full-width.
    const overlapping = tableEdges.filter((e) => e.page === page && it.y >= e.y0 - 12 && it.y <= e.y1 + 4);
    const bulletRight = Math.min(it.x + 150, pd.width, ...overlapping.map((e) => e.x0 - 12));
    fields[key] = {
      op: "value", page,
      box: { x0: colX - 5, x1: bulletRight, y0: it.y - 3, y1: it.y + 6 },
      pattern,
      dropText: [label],
    };
  }

  /* --- the proficiency list: raw text; the binder token-matches names --- */
  if (spec.profList) {
    const pPage = spec.profList.page ?? page;
    const ppd = pPage === page ? pd : await pageItems(doc, pPage);
    // The gentler defColumns, not the raw detector: a class page is dominated
    // by its tables, which starve the histogram into reporting one column —
    // and a one-column read boxes the list across the FULL page width,
    // sweeping in the neighbouring column's prose. Then drop any detected
    // start closer than 150px to its predecessor: the list's own
    // comma-aligned entries can vote a phantom column mid-list, which would
    // clip every line's tail — a real text column is never that narrow.
    const pcols = defColumns(ppd).filter((x, i, a) => i === 0 || x - a[i - 1] >= 150);
    // The label can split across runs ("Venturer Proficiency" + "List:") and
    // sit mid-row beside the other column's prose — so after the direct and
    // whole-line matches, fall back to the longest word-prefix a single run
    // carries.
    // A generic label ("Proficiency List:") also occurs as a PHRASE inside
    // the Proficiency Progression sentence above it ("…from their class
    // proficiency list and one general…"), and a wrapped line can even start
    // with it. The printed label is always the LOWEST occurrence — the list
    // follows the progression paragraph in every spread — so both clauses
    // prefer the bottom-most match.
    const startRuns = ppd.items.filter((i) => fold(i.str).startsWith(fold(spec.profList.label)));
    const labelIt = startRuns.length
      ? startRuns.reduce((a, b) => (b.y > a.y ? b : a))
      : findLabelRun(ppd.items, spec.profList.label, { last: true });
    if (!labelIt) {
      warn(`${entry.id}: proficiency-list label "${spec.profList.label}" not found on p.${pPage}`);
    } else {
      const c = colOf(labelIt.x, pcols);
      // THE LIST BEGINS AT ITS LABEL. A run-in label sits on the left edge of
      // the column it introduces, so the box never starts left of it whatever
      // the column detector reported — and on a class page the detector is
      // starved by the templates table below and reports ONE column, which
      // boxed the list across the full page width and swept in the Proficiency
      // Progression paragraph printed beside it. Read in y-then-x order, that
      // paragraph's runs interleave with the list's, welding prose onto entry
      // names ("paladins select one class" + "Berserkergang") — which then
      // arrive as unresolved names nothing can match.
      //
      // `x0`/`x1` on the register entry override both edges, for a spread whose
      // label does not begin its column or whose list has prose to its RIGHT.
      const cx0 = spec.profList.x0 ?? Math.max(pcols[c] - 6, labelIt.x - 6);
      const cx1 = spec.profList.x1 ?? (pcols[c + 1] ? pcols[c + 1] - 6 : ppd.width);
      const below = ppd.items
        .filter((i) => colOf(i.x, pcols) === c && i.y >= labelIt.y && i.h < HEADING_MIN_H)
        .sort((a, b) => a.y - b.y);
      let stopY = ppd.height;
      let prevY = labelIt.y;
      for (const i of below) {
        if (i.y - prevY > 16) {
          stopY = prevY + 8;
          break;
        }
        prevY = i.y;
      }
      // A section heading under the list also ends it — and because heading
      // glyphs are tall, the cut must clear the heading's TOP, or the box
      // catches its ascenders even when the baseline sits below y1.
      const headBelow = ppd.items
        .filter((i) => colOf(i.x, pcols) === c && i.h >= HEADING_MIN_H && i.y > labelIt.y + 2)
        .sort((a, b) => a.y - b.y)[0];
      if (headBelow) stopY = Math.min(stopY, headBelow.y - (headBelow.h ?? 12) - 2);
      // THE PAGE PAINTS ITS CHAPTER TAB INTO THE MARGIN, mid-column. On a
      // recto it lands inside a right-hand list's own x-range, between two
      // printed lines, and joins the value as a word — "cLASSES" welded onto
      // "Intimidation". It is dropped by TEXT rather than by geometry: the tab
      // reads the same as the running head at the top of the page, and no
      // printed proficiency is ever called after the chapter.
      const runningHead = ppd.items
        .filter((i) => i.y < 60)
        .map((i) => i.str.trim())
        .join("")
        .trim();
      const tabs = [
        ...new Set(
          ppd.items
            .filter((i) => i.y > labelIt.y && fold(i.str) === fold(runningHead) && fold(i.str).length > 2)
            .map((i) => i.str.trim()),
        ),
      ];
      fields.profList = {
        op: "value", page: pPage,
        box: { x0: cx0, x1: cx1, y0: labelIt.y - 3, y1: Math.min(stopY, spec.profList.y1 ?? ppd.height, ppd.height) },
        pattern: "raw",
        dropText: [spec.profList.label, ...tabs],
      };
    }
  }

  /* --- the intro prose: everything in the anchor column between the header
         bullets and the first section heading, as claimed paragraphs the
         import materializes into the document it creates --- */
  {
    const stopHeadings = ["Combat Characteristics", "Starting Class Powers", "Class Proficiencies"];
    // Below the four header bullets (they end ~50px under the anchor), above
    // the first section heading — heading runs are display-size, so the stop
    // search must not pre-filter on body height.
    const colAll = pd.items
      .filter((i) => colOf(i.x, cols) === anchor.col && i.y > anchor.y + 55 && i.str.trim())
      .sort((a, b) => a.y - b.y);
    const stop = colAll.find((i) => stopHeadings.some((h) => fold(i.str).startsWith(fold(h))));
    const intro = colAll.filter((i) => i.h < HEADING_MIN_H && i.y < (stop?.y ?? anchor.y + 300) - 3);
    if (intro.length >= 3) {
      fields.description = {
        op: "text",
        page,
        paras: [{ box: { x0: colX - 5, x1: colRight, y0: intro[0].y - 6, y1: intro[intro.length - 1].y + 6 } }],
      };
    } else {
      warn(`${entry.id}: intro prose not captured (${intro.length} line(s) before the first section)`);
    }
  }

  /* --- per-page raw body text: the binder resolves award grant-levels and
         the cleave phrase against the reader's own words. One op PER COLUMN,
         not per page: a full-page box joins the two print columns line by
         line, interleaving their sentences — which breaks any pattern longer
         than a line fragment. The binder concatenates every body field in
         emission order (page, then column), preserving reading order. The
         >=150px filter drops phantom columns a table's cell alignment can
         vote into the histogram — a real text column is never that narrow. --- */
  for (const p of entry.pages) {
    const bpd = p === page ? pd : await pageItems(doc, p);
    // Margins at 30, not 45: BTA's recto pages set their left column at x36,
    // and a 45 margin silently dropped that whole column from the body — every
    // award printed there parked level-unresolved, and a pattern could then
    // match the SAME phrase in a neighbouring class's column instead.
    const bcols = defColumns(bpd).filter((x, i, a) => i === 0 || x - a[i - 1] >= 150);
    const edges = [...bcols.slice(1).map((x) => x - 6), bpd.width - 30];
    let bx0 = 30;
    edges.forEach((bx1, ci) => {
      fields[`body${p}c${ci}`] = {
        op: "value", page: p,
        box: { x0: bx0, x1: bx1, y0: 50, y1: bpd.height },
        pattern: "raw",
      };
      bx0 = bx1;
    });
  }

  return {
    kind: entry.kind,
    name: entry.name,
    book: entry.book,
    cite: citeFor(entry.book, page),
    pages: entry.pages,
    ...(entry.icon ? { icon: entry.icon } : {}),
    meta: {
      ...(entry.meta ?? {}),
      key: spec.key,
      // Which race this class is an expression of, where the register says.
      // A classification, like `chassis` beside it — the tongues themselves
      // are still read from the reader's own page.
      ...(spec.race ? { race: spec.race } : {}),
      chassis: spec.chassis ?? {},
      ...(spec.factored ? { factored: true } : {}),
      ...(spec.core ? { core: true } : {}),
      // How much Intellect bonus this class's printed templates already spend
      // — a structural fact about the spread, like `factored` above it.
      ...(spec.templatesAssumeIntBonus ? { templatesAssumeIntBonus: Number(spec.templatesAssumeIntBonus) } : {}),
    },
    ...(spec.awards?.length ? { awards: spec.awards } : {}),
    ...(spec.cleaves ? { cleaves: spec.cleaves } : {}),
    // The run-in the spread states its combat training under — declared per
    // class because the label is not the same on every spread.
    ...(spec.training ? { training: spec.training } : {}),
    ...(spec.casting?.length ? { casting: spec.casting } : {}),
    ...(spec.skills?.length ? { skills: spec.skills } : {}),
    ...(spec.equipAliases ? { equipAliases: spec.equipAliases } : {}),
    fields,
  };
}

/**
 * kind.classMeta — the Profs chapter's Proficiencies Gained per Level grid:
 * class-name rows × level columns 1..N, cells "C" / "G" / "C + G" (blank past
 * a class's maximum level). Rows are keyed by class name, so the walk accepts
 * word-starting rows; level columns come from the numbered header cells.
 *
 * A `window` entry has no table at all: its pages are emitted as raw body
 * columns — the same per-column emission the class body uses, for the same
 * interleaving reason — and the binder patterns against the reader's own
 * words (`def.classmeta.startingTongues` reads the common tongue's name out
 * of the chargen chapter this way).
 */
async function compileClassMeta(doc, entry) {
  if (entry.window) {
    const fields = {};
    for (const p of entry.pages) {
      const bpd = await pageItems(doc, p);
      const bcols = defColumns(bpd).filter((x, i, a) => i === 0 || x - a[i - 1] >= 150);
      const edges = [...bcols.slice(1).map((x) => x - 6), bpd.width - 30];
      let bx0 = 30;
      edges.forEach((bx1, ci) => {
        fields[`body${p}c${ci}`] = {
          op: "value", page: p,
          box: { x0: bx0, x1: bx1, y0: 50, y1: bpd.height },
          pattern: "raw",
        };
        bx0 = bx1;
      });
    }
    return {
      kind: entry.kind,
      name: entry.name,
      book: entry.book,
      cite: citeFor(entry.book, entry.pages[0]),
      pages: entry.pages,
      meta: { ...(entry.meta ?? {}) },
      fields,
    };
  }
  const g = entry.grid ?? {};
  const page = g.page ?? entry.pages[0];
  const pd = await pageItems(doc, page);
  const fold = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  const lineRows = (items, tol = 3) => {
    const by = new Map();
    for (const it of items) {
      const k = Math.round(it.y / tol);
      (by.get(k) ?? by.set(k, []).get(k)).push(it);
    }
    return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v.sort((a, b) => a.x - b.x));
  };
  const rows = lineRows(pd.items.filter((i) => i.h >= 7 && i.str.trim() && i.x <= pd.width - 45));
  const titleIdx = rows.findIndex((r) => fold(r.map((i) => i.str).join("")).includes(fold(g.title)));
  if (titleIdx < 0) throw new Error(`grid title "${g.title}" not found on p.${page}`);
  const headerRow = rows[titleIdx + 1] ?? [];
  const levelCells = headerRow.filter((i) => /^\d{1,2}$/.test(i.str.trim()));
  const levels = g.levels ?? 14;
  if (levelCells.length < levels) throw new Error(`grid header has ${levelCells.length} level cells (< ${levels})`);
  const xs = levelCells.map((c) => c.x).sort((a, b) => a - b).slice(0, levels);
  const tableX0 = Math.min(...headerRow.map((i) => i.x));
  const span = (i) => ({
    x0: i === 0 ? (tableX0 + xs[0]) / 2 + 10 : (xs[i - 1] + xs[i]) / 2,
    x1: i === levels - 1 ? xs[i] + 20 : (xs[i] + xs[i + 1]) / 2,
  });
  // Data rows: class names — words, not numbers — until the first gap.
  const dataRows = [];
  for (const r of rows.slice(titleIdx + 2)) {
    const first = (r[0]?.str ?? "").trim();
    if (!/^[A-Za-z]/.test(first)) break;
    if (dataRows.length && r[0].y - dataRows[dataRows.length - 1][0].y > 16) break;
    dataRows.push(r);
  }
  if (dataRows.length < 10) throw new Error(`grid resolved only ${dataRows.length} class row(s)`);
  const y0 = dataRows[0][0].y - 4;
  const y1 = dataRows[dataRows.length - 1][0].y + 5;
  return {
    kind: entry.kind,
    name: entry.name,
    book: entry.book,
    cite: citeFor(entry.book, page),
    pages: entry.pages,
    meta: { ...(entry.meta ?? {}) },
    fields: {
      gains: {
        op: "grid", page,
        box: { x0: tableX0 - 6, x1: xs[levels - 1] + 22, y0, y1 },
        label: { x0: tableX0 - 6, x1: (tableX0 + xs[0]) / 2 + 10 },
        cols: Array.from({ length: levels }, (_, i) => ({ key: `l${i + 1}`, ...span(i) })),
        gapMin: 2,
      },
    },
  };
}

/* -------------------------------------------- */
/*  Definition compilation (proficiency/power/skill) */
/* -------------------------------------------- */

/** Content-type cookbook filename for a definition kind (named by WHAT it
 * extracts, not the source book — a content type spans every book). */
// kind.class routes through compileClass before the definition branch reads
// this map — its row here feeds only the index's content list.
const CONTENT_OF = { "kind.proficiency": "proficiencies", "kind.power": "powers", "kind.skill": "skills", "kind.combatProficiency": "proficiencies", "kind.equipment": "equipment", "kind.class": "classes", "kind.classMeta": "classes", "kind.trap": "traps", "kind.variation": "variations", "kind.vehicle": "vehicles", "kind.constant": "constants" };

/** Definition id slug — must match the seeder so alias targets resolve. */
const slugOf = (s) =>
  s
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()))
    .join("");

/**
 * Column starts for a DEFINITION page. `detectColumns` needs a bin to hold >8%
 * of body items, which a page dominated by a table can starve — RR p33 reports
 * one column when it prints two, collapsing both into a single region so an
 * entry swallows its neighbour's prose. Same histogram, gentler threshold.
 * Scoped to definitions so monster compilation is untouched.
 */
function defColumns(pd) {
  const cols = detectColumns(pd.items);
  // Run-in HEADINGS always sit at a column's left edge, so their x-positions
  // recover columns the histogram misses when a dominant table starves a bin.
  const heads = pd.items.filter((it) => it.h < DEF_BODY_MAX_H && /^[A-Z][^:]{1,44}:$/.test(it.str.trim()));
  const xs = heads.map((h) => h.x).sort((a, b) => a - b);
  const starts = [];
  for (const x of xs) {
    if (!starts.length || x - starts[starts.length - 1] > 60) starts.push(x);
  }
  // Trust the proven detector whenever it found a multi-column layout. Lowering
  // its threshold globally invents columns out of table cells, indents and the
  // page-edge chapter tabs (RR p33 reported EIGHT), which is far worse than the
  // miss being fixed.
  //
  // It also cannot be repaired by ADDING the edges run-in headings imply. The
  // detector's misses are not only missing edges: on RR p71 it returns [140,
  // 330], where 140 is the Totem Animals TABLE's left edge and the prose column
  // it missed begins at 72. Supplying 72 leaves the false 140 in place, the box
  // closes at 134, and the entry loses the continuation it flows into — trading
  // a wrong description for a truncated one, which is the worse of the two.
  // Overruling a detected column needs evidence this function does not have.
  // The 23 entries whose prose box does not contain their own anchor are the
  // measure of what is still wrong here; see ROADMAP.md.
  if (cols.length > 1) return cols;
  // It reported one column where the page prints two (RR p33), which made an
  // entry swallow its neighbour's prose.
  return starts.length > 1 ? starts : cols;
}

/**
 * The vertical chapter tab that runs down a page margin ("C H A R A C T E R S"),
 * set as a stack of tiny runs. They fall inside a column box and otherwise land
 * in the middle of extracted prose. They are the same size as superscript
 * ordinals, so size alone cannot separate them — but a tab is a STACK of small
 * runs sharing an x over a long vertical span, whereas ordinals scatter.
 * Returned as a Set so it can ship as `fixes.drop` ordinals.
 */
function marginTabs(pd) {
  const small = pd.items.filter((it) => it.h < 7);
  const byX = new Map();
  for (const it of small) {
    // Rotated tab glyphs share an x to a fraction of a point; ordinals do not.
    const k = Math.round(it.x);
    if (!byX.has(k)) byX.set(k, []);
    byX.get(k).push(it);
  }
  // Where body type actually reaches. A tab is set in the trimmed margin,
  // OUTSIDE the text block; a superscript ordinal sits on a line of body type,
  // inside it. Position is the direct test and vertical span is not: the JJ's
  // "Dungeons" tab is four glyphs over sixteen points, SHORTER than a column of
  // six tier ordinals sharing an indent, so a rule measuring the stack's height
  // read each as the other — dropping the ordinal off every "1st level" while
  // keeping the tab as a word of gibberish at the end of the entry.
  //
  // Measured from body runs rather than from the detected columns: a tab stack
  // can drag a column left onto itself, and a left edge derived from that would
  // place the tab inside the very block it is supposed to be outside of.
  const body = pd.items.filter((it) => (it.h ?? 0) >= 7);
  const textRight = body.length ? Math.max(...body.map((it) => it.x + (it.w ?? 0))) : pd.width;
  const textLeft = (body.length ? Math.min(...body.map((it) => it.x)) : 0) - 10;
  const out = new Set();
  for (const arr of byX.values()) {
    if (arr.length < 3) continue; // two stray ordinals can share an x; three do not
    const x = arr[0].x;
    if (x >= textLeft && x <= textRight) continue; // inside the text block: not a tab
    for (const it of arr) out.add(it);
  }
  return out;
}

/** Raw reading-order join of a body region (compile-time inspection only). */
const joinBody = (items) =>
  [...items].sort((a, b) => a.y - b.y || a.x - b.x).map((it) => it.str).join("").replace(/\s+/g, " ").trim();

/**
 * Compile a role:definition entry (proficiency / power / skill) into
 * expect(name) + text(description). Two locate modes:
 *  - display: a heading (RR proficiency descriptions) → block to the next
 *    heading in the same column.
 *  - runin: a bold "Name:" run (JJ powers, class skills) → block to the next
 *    same-alias run-in in the same column; the heading run is dropped.
 * Descriptor prose is materialized into the document at import; structured
 * effects are per-entry assists (emitted later — descriptor first).
 */
async function compileDefinition(doc, entry, kindRow, siblings = []) {
  DEF_BODY_MAX_H = DEF_BODY_MAX_H_BY_BOOK[entry.book] ?? 10;
  const assists = entry.assists ?? {};
  const page = entry.pages[0];
  const pd = await pageItems(doc, page);
  // `assists.columns` overrides the detected column lefts for THIS entry. A page
  // whose lower half is a table has more vertical gutters than it has prose
  // columns, and the detector cannot tell which is which — so a run-in entry
  // whose text spans the full width gets shredded along a table's gutter. The
  // recipe knows the page; this lets it say so, without changing detection for
  // every other entry printed on the same page.
  const cols = assists.columns ?? defColumns(pd);
  // The run-ins of the OTHER entries printed on this page: where each of them
  // starts is where this one's block has to stop, whatever the page's indenting
  // does. Folded, because extraction welds the label to what follows it.
  const foldRunin = (t) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const siblingRunins = (siblings ?? [])
    .filter((s2) => s2 && s2.id !== entry.id && (s2.pages ?? []).includes(page) && s2.anchor?.runin)
    .map((s2) => foldRunin(s2.anchor.runin))
    .filter((r) => r.length >= 4);
  const startsSibling = (lineText) => {
    if (!siblingRunins.length) return false;
    const line = foldRunin(lineText);
    return !!line && siblingRunins.some((r) => line.startsWith(r));
  };
  const tabs = marginTabs(pd); // dropped from every paragraph (see marginTabs)
  // An entry's declared anchor style beats the kind's default: the same kind
  // can print as display headings in one book and body-size run-ins in
  // another (BTA sets its proficiencies as run-ins, and its sigils as
  // display heads on a kind whose default is runin).
  const mode = entry.anchor?.runin ? "runin" : entry.anchor?.display ? "display" : kindRow.fields.name.locate;
  const fields = {};
  let bodyText = "";

  if (mode === "display") {
    // Heads regrouped over >=150px columns, not the raw detection: a phantom
    // mid-column (voted by table cells or tight comma alignment) splits one
    // heading's glyph runs into two half-headings no candidate can match —
    // and the fallback prefix then anchors a DIFFERENT heading that shares
    // the split's opening words.
    const hcols = defColumns(pd).filter((x, i, a) => i === 0 || x - a[i - 1] >= 150);
    const hlines = {};
    for (const it of pd.items.filter((i) => (i.h ?? 0) >= HEADING_MIN_H)) {
      const c = colOf(it.x, hcols);
      (hlines[`${c}:${Math.round(it.y / 3)}`] ??= []).push(it);
    }
    const heads = Object.values(hlines)
      .map((arr) => arr.sort((a, b) => a.x - b.x))
      .map((arr) => ({ text: arr.map((a) => a.str).join("").replace(/\s+/g, " ").trim(), y: arr[0].y, col: colOf(arr[0].x, hcols) }))
      .filter((h) => h.text.length > 2)
      .sort((a, b) => a.col - b.col || a.y - b.y);
    const want = assists.anchor ?? entry.anchor?.display ?? entry.name;
    const noParen = want.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
    // A long name WRAPS onto a second display line ("Fighting Style" /
    // "Specialization"), so the printed heading is only a PREFIX of the full
    // name. Try the whole name, then progressively shorter prefixes — the
    // continuation line is absorbed into the anchor block below either way.
    const words = noParen.split(/\s+/).filter(Boolean);
    const candidates = [want, noParen];
    for (let i = words.length - 1; i >= 1; i--) candidates.push(words.slice(0, i).join(" "));
    let anchor = null;
    let matched = want;
    // Folded compare: heading runs may join with no inter-word spaces at all.
    const foldAnchor = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const c of candidates.filter(Boolean)) {
      anchor = heads.find((a) => foldAnchor(a.text).startsWith(foldAnchor(c)));
      if (anchor) {
        matched = c;
        break;
      }
    }
    if (!anchor) throw new Error(`display anchor "${want}" not found on p.${page}`);
    // Everything below indexes the SAME filtered columns the heads were
    // grouped over — mixing them with the raw detection would clip boxes at
    // the phantom gutter the regrouping just erased.
    const colX = hcols[anchor.col];
    const nextX = hcols[anchor.col + 1];
    const box = { x0: colX - 5, x1: nextX ? nextX - 6 : pd.width };
    // Absorb a wrapped 2-line heading into the anchor block.
    let endY = anchor.y;
    const later = [];
    for (const h of heads.filter((a) => a.col === anchor.col && a.y > anchor.y + 2).sort((a, b) => a.y - b.y)) {
      if (h.y - endY <= 20) endY = h.y;
      else later.push(h);
    }
    // A definition also ends at a TABLE. The RR sets a rank-progression table
    // for several proficiencies at the foot of a column, below the last entry
    // in it — and with no heading after that entry, the body ran to the page
    // bottom and swallowed the table (sometimes a DIFFERENT proficiency's).
    // Table titles are set in body type and end in "Progression", so they are
    // findable without a per-entry assist.
    const tableTitle = pd.items
      .filter(
        (it) =>
          it.h < DEF_BODY_MAX_H &&
          colOf(it.x, hcols) === anchor.col &&
          it.y > anchor.y + 2 &&
          /\bProgression\s*$/i.test(it.str.trim()),
      )
      .sort((a, b) => a.y - b.y)[0];
    const stopY = Math.min(
      later[0]?.y ? later[0].y - 4 : pd.height,
      tableTitle ? tableTitle.y - 4 : pd.height,
      assists.descStopY ?? pd.height,
    );
    // Bound the expect box to the heading's OWN runs. The last column runs to
    // the page edge, where the vertical chapter-tab glyphs live ("Pro/FI/c/IE"),
    // and those would otherwise join the heading text and fail the check.
    const headItems = pd.items.filter(
      (it) => it.h >= HEADING_MIN_H && colOf(it.x, hcols) === anchor.col && it.y >= anchor.y - 2 && it.y <= endY + 2,
    );
    const headX1 = headItems.length ? Math.max(...headItems.map((it) => it.x + (it.w ?? 0))) + 2 : box.x1;
    fields.name = {
      op: "expect", page,
      box: { x0: box.x0, x1: Math.min(headX1, box.x1), y0: anchor.y - 16, y1: endY + 6 },
      text: matched,
    };
    const body = pd.items.filter((it) => it.h < DEF_BODY_MAX_H && it.x >= box.x0 && it.x <= box.x1 && it.y > endY + 2 && it.y < stopY);
    bodyText = joinBody(body);
    const paras = paragraphBoxes(toLines(body), box.x0, box.x1).map((p) => withFixes(p, pd, tabs));
    // Column-flowed continuation (see the run-in branch): a proficiency that
    // reaches the bottom of its column resumes at the top of the next.
    // A table below the entry ends it just as a heading would, so it must also
    // suppress the column flow — otherwise the block runs on into the next
    // column and absorbs whichever proficiency is printed there.
    const cont = columnFlow(pd, hcols, anchor.col, later.length > 0 || !!tableTitle, (it) => it.h >= HEADING_MIN_H);
    if (cont.length) {
      const cx0 = hcols[anchor.col + 1] - 5;
      const cx1 = hcols[anchor.col + 2] ? hcols[anchor.col + 2] - 6 : pd.width;
      paras.push(...paragraphBoxes(toLines(cont), cx0, cx1).map((p) => withFixes(p, pd, tabs)));
      bodyText = `${bodyText} ${joinBody(cont)}`.trim();
    } else if (!later.length && !tableTitle && anchor.col + 1 >= hcols.length) {
      const pf = await pageFlow(doc, page, (it) => it.h >= HEADING_MIN_H);
      if (pf?.items.length) {
        const px0 = pf.cols[0] - 5;
        const px1 = pf.cols[1] ? pf.cols[1] - 6 : pf.pd.width;
        paras.push(...paragraphBoxes(toLines(pf.items), px0, px1).map((p) => withFixes({ ...p, page: pf.page }, pf.pd, marginTabs(pf.pd))));
        bodyText = `${bodyText} ${joinBody(pf.items)}`.trim();
      }
    }
    fields.description = { op: "text", page, paras };
  } else if (mode === "subheading") {
    // A bold sub-heading sits ALONE on its line at body size with no colon
    // (RR Combat: "Armor", "Weapons", "Fighting Styles"). Anchor on the line
    // that holds exactly that one run; its alias then identifies its siblings,
    // which is where the block ends.
    const want = assists.anchor ?? entry.anchor?.subheading ?? entry.name;
    const solo = soloLines(pd, cols);
    const anchor = solo.find((it) => it.str.trim() === want) ?? solo.find((it) => it.str.trim().startsWith(want));
    if (!anchor) throw new Error(`subheading anchor "${want}" not found on p.${page}`);
    const col = colOf(anchor.x, cols);
    const box = { x0: cols[col] - 5, x1: cols[col + 1] ? cols[col + 1] - 6 : pd.width };
    const stop = solo
      .filter((it) => it !== anchor && it.alias === anchor.alias && colOf(it.x, cols) === col && it.y > anchor.y + 2)
      .sort((a, b) => a.y - b.y)[0];
    const nextHead = pd.items
      .filter((it) => it.h >= HEADING_MIN_H && colOf(it.x, cols) === col && it.y > anchor.y + 2)
      .sort((a, b) => a.y - b.y)[0];
    const yMax = Math.min(stop?.y ?? pd.height, nextHead?.y ?? pd.height) - 2;
    fields.name = {
      op: "expect", page,
      box: { x0: anchor.x - 2, x1: anchor.x + (anchor.w ?? 60) + 2, y0: anchor.y - 5, y1: anchor.y + 4 },
      text: want,
    };
    const body = pd.items.filter(
      (it) => it !== anchor && it.h < DEF_BODY_MAX_H && colOf(it.x, cols) === col && it.y > anchor.y + 2 && it.y < yMax,
    );
    bodyText = joinBody(body);
    const paras = paragraphBoxes(toLines(body), box.x0, box.x1).map((p) => withFixes(p, pd, tabs));
    const cont = columnFlow(pd, cols, col, !!stop, (it) => it.alias === anchor.alias);
    if (cont.length) {
      const cx0 = cols[col + 1] - 5;
      const cx1 = cols[col + 2] ? cols[col + 2] - 6 : pd.width;
      paras.push(...paragraphBoxes(toLines(cont), cx0, cx1).map((p) => withFixes(p, pd, tabs)));
      bodyText = `${bodyText} ${joinBody(cont)}`.trim();
    } else if (!stop && col + 1 >= cols.length && page + 1 <= doc.numPages) {
      // Nothing stopped this block and it held the LAST column, so it runs on
      // at the top of the next page — the same turn the display branch already
      // follows. Two things differ there and both are why `pageFlow` is not
      // reused: the continuation page needs its OWN columns (it re-detects
      // them, and a page that defeated detection for the entry defeats it for
      // the turn as well, so `assists.flowColumns` states them per page as it
      // does on the AX path), and what ends the block is the next entry's
      // sub-heading, tested by SHAPE rather than by font alias — pdf.js names
      // fonts per page, so the alias that identified this anchor's siblings
      // means nothing on the page after it.
      const pd2 = await pageItems(doc, page + 1);
      const cols2 = assists.flowColumns?.[String(page + 1)] ?? defColumns(pd2);
      const inFirst = (it) => colOf(it.x, cols2) === 0 && it.y > DEF_TOP_BAND;
      // Alone on its line is NOT enough here. On the anchor page the wanted
      // NAME settles which solo line is the heading; on this one nothing is
      // being matched by name, and a wrapped sentence at the top of a page is
      // frequently a single run — which would stop the flow before it carried
      // anything. A sub-heading is also set in a face the body is not, so the
      // page's own body face is measured and the stop is the first solo line
      // that departs from it.
      // ...and it must be BODY-SIZED. A superscript ordinal is alone on its
      // line and in a face of its own, so height is the third thing that has
      // to hold: without it the "th" of the very tier being carried over reads
      // as the next entry's heading and stops the flow at the page's first
      // line, which is indistinguishable from the turn not happening at all.
      const bodyFace = dominantAlias(pd2);
      const stopAt = soloLines(pd2, cols2)
        .filter((it) => inFirst(it) && it.alias !== bodyFace && (it.h ?? 0) >= 7)
        .sort((a, b) => a.y - b.y)[0];
      const yStop = Math.min(stopAt?.y ? stopAt.y - 2 : pd2.height, headingTop(pd2, cols2) ?? pd2.height);
      // The turn must not carry the page's FURNITURE. Where detection puts a
      // column left on the margin tab itself, "column zero" is the tab strip,
      // and the continuation would be three paragraphs of glyphs that drop to
      // nothing — empty blocks appended to an entry that had already said all
      // it was going to. Excluded here rather than left to the drop fixes, so
      // an entry with no real continuation gets no paragraph at all.
      const tabs2 = marginTabs(pd2);
      const carried = pd2.items.filter(
        (it) => it.h < DEF_BODY_MAX_H && !tabs2.has(it) && inFirst(it) && it.y < yStop,
      );
      if (carried.length) {
        const px0 = cols2[0] - 5;
        const px1 = cols2[1] ? cols2[1] - 6 : pd2.width;
        paras.push(
          ...paragraphBoxes(toLines(carried), px0, px1).map((p) =>
            withFixes({ ...p, page: page + 1 }, pd2, marginTabs(pd2)),
          ),
        );
        bodyText = `${bodyText} ${joinBody(carried)}`.trim();
      }
    }
    fields.description = { op: "text", page, paras };
  } else {
    const want = assists.anchor ?? entry.anchor?.runin ?? `${entry.name}:`;
    let anchor = pd.items.find((it) => it.h < DEF_BODY_MAX_H && it.str.trim().startsWith(want));
    if (!anchor) {
      // The PDF splits some headings across runs ("Discern" + "Evil:"), so no
      // single run starts with the name. Match the JOINED line instead — PER
      // COLUMN, since lines at the same y span both columns of a spread.
      // Runs may also join with NO spaces between words ("FieryTorch:"), so
      // the compare squashes spaces on both sides — but keeps punctuation,
      // because the trailing colon is what separates a run-in heading from a
      // body sentence that happens to open with the same words.
      const squash = (s) => String(s).toLowerCase().replace(/\s+/g, "");
      const bodyItems = pd.items.filter((it) => it.h < DEF_BODY_MAX_H);
      search: for (let c = 0; c < cols.length; c++) {
        const colItems = bodyItems.filter((it) => colOf(it.x, cols) === c);
        for (const ln of toLines(colItems)) {
          const sorted = [...ln.items].sort((a, b) => a.x - b.x);
          const joined = sorted.map((i) => i.str).join("").replace(/\s+/g, " ").trim();
          if (squash(joined).startsWith(squash(want))) {
            anchor = sorted[0];
            break search;
          }
        }
      }
    }
    if (!anchor) throw new Error(`runin anchor "${want}" not found on p.${page}`);
    const col = colOf(anchor.x, cols);
    const colX = cols[col];
    const nextX = cols[col + 1];
    const box = { x0: colX - 5, x1: nextX ? nextX - 6 : pd.width };
    // The next run-in heading ends this entry. Font alias alone does NOT
    // identify one: the JJ sets run-in headings and italic emphasis from the
    // same font resource, so a flavour name italicised at the start of a line
    // ("…mog brutes call it *pugilism*, and pugilists…") looked exactly like
    // the next heading and cut Blade-Dancing in half — six of its eleven
    // printed lines, including the whole Swashbuckling stacking rule, and its
    // alias Graceful Fighting with it. A heading is a NAME FOLLOWED BY A
    // COLON, so require that shape of the line the candidate opens; the
    // heading may still be split across runs ("Discern" + "Evil:"), which is
    // why the test reads the joined line rather than the candidate's own text.
    const lineFrom = (it) =>
      pd.items
        .filter((o) => Math.abs(o.y - it.y) <= 2 && colOf(o.x, cols) === col && o.x >= it.x - 1)
        .sort((a, b) => a.x - b.x)
        .map((o) => o.str)
        .join("")
        .replace(/\s+/g, " ")
        .trim();
    // Which face is PROSE in this column, by weight of characters below the
    // anchor. Everything that ends a block is identified against this rather
    // than against the anchor's own face, because one printed style can arrive
    // as several aliases: BTA p98 sets "Firewood:" in one and "Refined Oil:"
    // — the very next entry, same style, same column — in another, so an
    // anchor-matched stop walked straight past it and firewood described the
    // oil beside it. pdf.js aliases are per-document and per-subset; the body
    // is the only face a page is guaranteed to agree with itself about.
    const bodyAlias = (() => {
      const tally = new Map();
      for (const it of pd.items) {
        if (colOf(it.x, cols) !== col || it.y <= anchor.y + 2) continue;
        if (!it.str.trim()) continue;
        tally.set(it.alias, (tally.get(it.alias) ?? 0) + it.str.trim().length);
      }
      return [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    })();
    const stop = pd.items
      .filter(
        (it) =>
          it !== anchor &&
          // EITHER test alone misses a page. The anchor's face misses a sibling
          // set in another alias (BTA p98: "Firewood:" and "Refined Oil:"), and
          // "not the body face" misses a page whose run-ins ARE set in the body
          // face (JJ p310, where every see-reference shares it) — which let
          // "Alien Senses: See alertness." swallow the entry after it and
          // quietly stop being an alias at all. A heading is either.
          (it.alias === anchor.alias || (bodyAlias && it.alias !== bodyAlias)) &&
          colOf(it.x, cols) === col &&
          it.y > anchor.y + 2 &&
          // A heading sits at the column's left edge — UNLESS the register
          // already knows an entry starts there. A spread that INDENTS its
          // run-ins (RR p29 indents the Explorer's by 21.5pt) hid every
          // sibling from this test, so the block ran to the foot of the column
          // and the flow carried it into the next entry's prose, then into the
          // templates table, then onto the following page: Pathfinding
          // reproduced Natural Stealth and a starting-equipment grid. The x
          // test is a guess about what a heading looks like; a sibling's own
          // declared run-in is not a guess, so it needs no tolerance.
          (Math.abs(it.x - colX) < 15 || startsSibling(lineFrom(it))) &&
          /^[A-Z][^:]{0,44}:/.test(lineFrom(it)),
      )
      .sort((a, b) => a.y - b.y)[0];
    // A block also ends at a SECTION heading, which is a different thing from
    // the next entry: "Code of Behavior" closes Longeval and belongs to the
    // class, not to any power. It carries no colon, so the stop above cannot
    // see it. Same calibration, different shape: a line-initial run in a
    // non-body face that occupies its WHOLE line is a heading. Testing the
    // RUN's own text rather than the line's is what keeps a bullet glyph — its
    // own tiny face, empty string, sitting at the column edge of a wrapped
    // sentence — from reading as one.
    const section = !bodyAlias
      ? null
      : pd.items
          .filter((it) => {
            if (it === anchor) return false;
            if (colOf(it.x, cols) !== col || it.alias === bodyAlias) return false;
            if (it.y <= anchor.y + 2 || it.y >= (stop ? stop.y : pd.height)) return false;
            if (Math.abs(it.x - colX) >= 15 || it.h >= DEF_BODY_MAX_H) return false;
            const own = it.str.trim();
            if (!(own.length >= 2 && own.length <= 44 && /^[A-Z]/.test(own) && own === lineFrom(it))) return false;
            // A heading is not a sentence, and a sentence ends in a full stop.
            // Everything above is a test of SHAPE, and a short closing line
            // that happens to be the last of its column has the same shape as
            // a heading: BTA p95 ends Turban with "Meniri dwarves south of
            // Opelenea and Kemesh." — forty-four characters, capitalised,
            // alone on its line, and set in a face that is not the column's
            // commonest only because a price table below it holds the vote.
            if (/[.!?]$/.test(own)) return false;
            // The JJ closes a power with the classes that may take it, and that
            // list wraps: "[Elven Wizard," ends one line and "Nobiran Wizard,
            // Wizard]" begins the next, set in the list's own face and flush
            // left — a section heading by every test above. Cutting there
            // leaves the bracket open, which is worse than not cutting at all:
            // `stripOwnerList` can no longer recognise the list it was written
            // to remove, so half of it stays on the page. A heading never opens
            // inside a bracket that has not closed.
            let depth = 0;
            for (const o of pd.items) {
              if (colOf(o.x, cols) !== col || o.y <= anchor.y || o.y >= it.y) continue;
              for (const ch of o.str) depth += ch === "[" ? 1 : ch === "]" ? -1 : 0;
            }
            return depth <= 0;
          })
          .sort((a, b) => a.y - b.y)[0];
    // Where the NEXT heading carries a superscript ordinal ("Hideout (9th
    // level)"), that ordinal sits above its heading's baseline — so a block
    // that stops just above the heading still catches it, and the paragraph box
    // built around it swallows the heading line too. End above the superscript.
    let yStop = section && (!stop || section.y < stop.y) ? section.y : stop ? stop.y : pd.height;
    if (stop) {
      for (const it of pd.items) {
        if (it.h >= (stop.h ?? 9) * 0.8 || colOf(it.x, cols) !== col) continue;
        if (it.y >= stop.y || it.y < stop.y - 8) continue;
        yStop = Math.min(yStop, it.y);
      }
    }
    // `assists.descStopY` is the floor for an entry whose block ends at
    // something that is not another run-in heading — a table, a sidebar. The
    // stop rule only knows how to see the next heading.
    const yMax = Math.min(yStop - 2, assists.descStopY ?? pd.height);
    // The heading may be ONE run or several. Walk the anchor's line rightward
    // until the accumulated text covers the name — those runs are the heading.
    const sameLine = pd.items
      .filter((it) => Math.abs(it.y - anchor.y) <= 2 && colOf(it.x, cols) === col && it.x >= anchor.x)
      .sort((a, b) => a.x - b.x);
    const headRuns = new Set();
    // A run the heading only PARTLY covers: run -> how many leading characters
    // are heading. The PDF frequently emits "Acrobatics" and ": The character
    // is trained to…" as two runs, so the run carrying the colon carries the
    // opening sentence too. Dropping it wholesale loses that sentence — ten
    // entries were starting mid-sentence for exactly this reason.
    const stripMap = new Map();
    let headEnd = anchor.x + (anchor.w ?? 60) - 1;
    const fold = (s) => s.replace(/\s+/g, " ").trim();
    // An anchor that stops at an open parenthesis ("Master Gnosis (") is a
    // PREFIX, written that way because the level ordinal inside varies from
    // class to class. The printed heading does not stop there, so neither does
    // the drop: "(9th):" is heading too, and leaving it behind opened sixty-two
    // descriptions with "9th): ". Absorb to the parenthesis's close and the
    // colon after it — and only when the line actually holds that shape, so a
    // line of some other form still ends at the prefix rather than being eaten
    // whole.
    const HEAD_TAIL = /^[^()]{0,20}\)\s*:/;
    const prefixOpen = /\($/.test(want);
    const covered = (s) => {
      const t = fold(s);
      if (t.length < want.length) return false;
      return !prefixOpen || HEAD_TAIL.test(t.slice(want.length));
    };
    const covers = covered(sameLine.map((it) => it.str).join("")) ? covered : (s) => fold(s).length >= want.length;
    let acc = "";
    for (const it of sameLine) {
      if (covers(acc)) break;
      // Does this run overshoot the heading? Find the fewest of its characters
      // that finish covering `want`; anything past that is prose.
      let need = it.str.length;
      for (let k = 1; k <= it.str.length; k++) {
        if (covers(acc + it.str.slice(0, k))) {
          need = k;
          break;
        }
      }
      if (need < it.str.length) {
        stripMap.set(it, need);
        acc += it.str.slice(0, need);
        headEnd = it.x + (it.w ?? 30) - 1;
        break;
      }
      headRuns.add(it);
      acc += it.str;
      headEnd = it.x + (it.w ?? 30) - 1;
    }
    // An ordinal inside a heading ("Hideout (9th level)") prints its suffix as
    // a SUPERSCRIPT on its own baseline a few points higher. It belongs to the
    // heading, so it joins the heading's drop set — otherwise it survives as a
    // stray "th" at the head of the description.
    for (const it of pd.items) {
      if (headRuns.has(it) || it.h >= (anchor.h ?? 9) * 0.8) continue;
      if (it.y >= anchor.y || it.y < anchor.y - 8) continue;
      if (it.x < anchor.x - 2 || it.x > headEnd + 2) continue;
      headRuns.add(it);
    }
    // Box membership tests a run's ORIGIN x, and the prose run starts flush
    // after the heading — so stop just short of it.
    // The band reaches above the baseline to catch tall glyphs. Where the
    // heading carries a SUPERSCRIPT ("Hideout (9th level)"), that ordinal sits
    // on its own baseline inside the band and lands in the extracted text,
    // which then cannot match the printed name. `assists.expectTop` tightens
    // the band to exclude it.
    fields.name = {
      op: "expect", page,
      box: { x0: anchor.x - 2, x1: headEnd, y0: anchor.y - (assists.expectTop ?? 5), y1: anchor.y + 4 },
      text: want,
    };
    const body = pd.items.filter((it) => {
      if (headRuns.has(it) || it.h >= DEF_BODY_MAX_H || colOf(it.x, cols) !== col) return false;
      const sameLineAfter = Math.abs(it.y - anchor.y) <= 2 && it.x >= anchor.x;
      return sameLineAfter || (it.y > anchor.y + 2 && it.y < yMax);
    });
    bodyText = joinBody(body);
    // Drop the heading by run ORDINAL rather than by text: that works whether
    // the PDF emitted it as one run or split it across several.
    const paras = paragraphBoxes(toLines(body), box.x0, box.x1).map((p, i) =>
      withFixes(p, pd, i === 0 ? new Set([...headRuns, ...tabs]) : tabs, i === 0 ? stripMap : null),
    );
    // Column-flowed continuation: an entry reaching the column bottom resumes
    // at the top of the next column, which is where ~1 in 5 entries lost their
    // second half.
    const isRunin = (it) => it.alias === anchor.alias && Math.abs(it.x - cols[colOf(it.x, cols)]) < 15;
    // A block only continues because it ran out of column, and a block that
    // ended at a heading did not run out of anything. `section` answers that
    // question exactly as `stop` does — leaving it out was what sent an entry
    // that had already finished on to collect the next column and the page
    // after it.
    const ended = !!stop || !!section || assists.descStopY != null;
    const cont = columnFlow(pd, cols, col, ended, isRunin);
    if (cont.length) {
      const cx0 = cols[col + 1] - 5;
      const cx1 = cols[col + 2] ? cols[col + 2] - 6 : pd.width;
      paras.push(...paragraphBoxes(toLines(cont), cx0, cx1).map((p) => withFixes(p, pd, tabs)));
      bodyText = `${bodyText} ${joinBody(cont)}`.trim();
    } else if (!ended && col + 1 >= cols.length) {
      // Bottom of the LAST column: the block continues overleaf.
      //
      // `descStopY` gates this exactly as it gates the column-flow above. Two
      // branches ask the same question — does this block end where it is? — and
      // they must not disagree about what counts as an answer. They did: a chef
      // who set `descStopY` stopped a bleed into the next COLUMN and had no way
      // to stop one onto the next PAGE, because `pageFlow` re-detects columns
      // on the following page and consults no assists. Trapbreaking swallowed
      // p.35's "Additional Class Powers" heading, and the only assist that
      // suppressed it was a FALSE `columns` — lying in the one field whose
      // whole justification is that it states geometric fact.
      const pf = await pageFlow(doc, page, (it) => it.alias === anchor.alias);
      if (pf?.items.length) {
        const px0 = pf.cols[0] - 5;
        const px1 = pf.cols[1] ? pf.cols[1] - 6 : pf.pd.width;
        paras.push(...paragraphBoxes(toLines(pf.items), px0, px1).map((p) => withFixes({ ...p, page: pf.page }, pf.pd, marginTabs(pf.pd))));
        bodyText = `${bodyText} ${joinBody(pf.items)}`.trim();
      }
    }
    fields.description = { op: "text", page, paras };
  }

  /**
   * `assists.progression` — this ability's numbers live in a TABLE, not in its
   * entry. The chef names the table's heading and which column is this
   * ability's; the compiler resolves those to coordinates and ships only those,
   * so the values still come from the reader's book.
   *
   * Column headers are left-aligned while the cells under them are centred, so
   * a header's x does not land on its data. The data columns are found from the
   * FIRST data row instead, and each header claims the nearest one.
   */
  if (assists.progression) {
    const { table, column, page: tPage = page } = assists.progression;
    const tpd = tPage === page ? pd : await pageItems(doc, tPage);
    const fold = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
    const head = tpd.items.find((i) => fold(i.str).startsWith(fold(table)));
    if (!head) {
      warn(`${entry.id}: progression table "${table}" not found on p.${tPage}`);
    } else {
      const below = tpd.items.filter((i) => i.y > head.y + 2 && i.y < head.y + 220);
      const rowsOf = (items) => {
        const by = new Map();
        for (const it of items) {
          const k = Math.round(it.y / 3);
          (by.get(k) ?? by.set(k, []).get(k)).push(it);
        }
        return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v.sort((a, b) => a.x - b.x));
      };
      const rows = rowsOf(below);
      // The header row is the first below the heading; data rows are the ones
      // whose leftmost cell is a bare level number.
      const header = rows[0] ?? [];
      const dataRows = rows.slice(1).filter((r) => /^\d+$/.test(r[0]?.str.trim()));
      if (!dataRows.length) {
        warn(`${entry.id}: progression table "${table}" has no numeric rows`);
      } else {
        // Header cells split across runs ("t"+"rapbreaking"), so rebuild them.
        const cells = [];
        for (const it of header) {
          const prev = cells[cells.length - 1];
          if (prev && it.x - (prev.x + (prev.w ?? 0)) < 3) prev.str += it.str;
          else cells.push({ str: it.str, x: it.x, w: it.w ?? 0 });
        }
        const want = cells.find((c) => fold(c.str) === fold(column)) ?? cells.find((c) => fold(c.str).startsWith(fold(column)));
        const dataXs = [...new Set(dataRows[0].slice(1).map((c) => c.x))].sort((a, b) => a - b);
        if (!want) {
          warn(`${entry.id}: progression column "${column}" not in table "${table}"`);
        } else {
          const colX = dataXs.reduce((best, x) => (Math.abs(x - want.x) < Math.abs(best - want.x) ? x : best), dataXs[0]);
          const y0 = dataRows[0][0].y - 4;
          const y1 = dataRows[dataRows.length - 1][0].y + 4;
          const lx = dataRows[0][0].x;
          fields.progression = {
            op: "progression", page: tPage,
            levelBox: { x0: lx - 6, x1: lx + 18, y0, y1 },
            valueBox: { x0: colX - 8, x1: colX + 26, y0, y1 },
          };
        }
      }
    }
  }

  // Chef-authored effect specs, for shapes the prose scan cannot classify on
  // its own (a companion pointing at a monster entry, a reroll's keep rule).
  // These ship STRUCTURE only — type, refs, mode, stacking. Any NUMBER they
  // carry is a `from.pattern` locator resolved against the seat's own prose, so
  // the recipe can be as convoluted as it likes without holding a value.
  if (entry.effects?.length) fields.effects = { op: "effects", specs: entry.effects };

  // A VARIATION's numbers, by the same route and the same frozen op: what a
  // masterwork blade costs and what it moves are page values, so the recipe
  // ships the locator and the field it fills and never the number. Reusing
  // `effects` rather than minting an op is deliberate — the instruction set is
  // frozen per schema version, and the materializer already does exactly this
  // (regex over the seat's prose, all-or-nothing so a half-read variation is
  // dropped rather than shipped looking complete).
  if (entry.variation?.length) fields.variation = { op: "effects", specs: entry.variation };

  // A definition's OWN printed numbers — an armour's class, a piece of gear's
  // weight and price — by the same route again. Distinct from `variation`
  // because the two say different things: a variation's numbers are what a
  // difference MOVES, these are what the thing IS. Both ship locators only.
  if (entry.values?.length) fields.values = { op: "effects", specs: entry.values };

  // Chef-authored ROLL recipes. The recipe ships how MANY rolls the entry has
  // and where each one's parts live; the label, the target and every ladder
  // step materialize from the reader's own book. Present means the chef read
  // this entry, so the recipe replaces the generic scan entirely.
  if (entry.rolls?.length) fields.rolls = { op: "rolls", specs: entry.rolls };

  metaCandidates(entry.id, entry, bodyText);

  return {
    id: entry.id,
    kind: entry.kind,
    name: entry.name,
    // A second name the books print for this same entry. Authored, never
    // inferred, and gated by lint-register: an alias may only give another
    // printed surface to an entry this module already ships, never introduce
    // a name for something it does not.
    ...(entry.aliases?.length ? { aliases: entry.aliases } : {}),
    book: entry.book,
    cite: citeFor(entry.book, page),
    pages: entry.pages,
    // Classification facts are AUTHORED, never inferred from the page here.
    // A pattern over body text is a scan, and scans locate rather than
    // conclude (docs/importer/RECIPES.md, "The audit gate"): `metaCandidates` reports
    // what the text suggests so a chef can read the entry and author the
    // flag, and reports the inverse too. Only the register's own meta ships.
    meta: { ...(entry.meta ?? {}) },
    // A chef read this entry's FULL materialized output against the printed
    // page and signed it off (the register records the date; only the fact
    // ships). Until then the entry's mechanics are a machine draft — the
    // generic prose scans locate candidates but cannot judge what a number
    // MEANS in its sentence — and the binding marks them as such.
    ...(entry.audited ? { audited: true } : {}),
    // Authored per entry, like every other judgment in the register. An icon is
    // PRESENTATION: it says nothing about what the book states, so unlike a
    // mechanic a wrong one is a cosmetic bug rather than a wrong ruling — but
    // it is still authored data, reviewable in a diff and correctable in one
    // line, not computed from the name at load time.
    ...(entry.icon ? { icon: entry.icon } : {}),
    // Optional upgrade from the game-icons.net pack, used only where that
    // module is installed. `icon` above stays the floor every seat gets.
    ...(entry.iconNiche ? { iconNiche: entry.iconNiche } : {}),
    // A "See X." entry is a CROSS-REFERENCE, not an ability of its own. The
    // raw target is resolved to a real id in a post-pass (once every id is
    // known) so we never ship a dangling pointer. The conclusion ships; the
    // sentence never does.
    // `assists.aliasOf` is the chef pre-baking the link by hand, for the cases
    // where the printed cross-reference cannot be read back cleanly (a target
    // name that wraps mid-phrase, a heading the PDF split). Naming the target
    // needs the book; the resulting id does not, so it ships safely.
    ...(entry.assists?.aliasOf ? { _aliasTarget: entry.assists.aliasOf } : {}),
    ...(seeReference(bodyText) ? { _aliasRaw: seeReference(bodyText) } : {}),
    ...(replacementPhrase(bodyText) ? { _replacedRaw: replacementPhrase(bodyText) } : {}),
    fields,
  };
}

/** "2 1/2" -> 2.5, "1/2" -> 0.5, "3" -> 3. */
function parseCount(tok) {
  const t = String(tok).trim();
  const mixed = t.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) return +mixed[1] + +mixed[2] / +mixed[3];
  const frac = t.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) return +frac[1] / +frac[2];
  const n = parseInt(t, 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * Report classification flags the body text SUGGESTS but the register does not
 * author — and, in the other direction, authored flags the text does not
 * appear to support. Pure diagnostics: nothing here reaches a shipped node.
 *
 * These patterns used to write straight into the compiled meta. That was the
 * anti-pattern this pipeline exists to prevent: a book-wide regex standing in
 * for a per-entry read (docs/importer/RECIPES.md, "Never generalize a fix across
 * entries"). It looked harmless because it was only setting booleans, and it
 * was true on all twelve entries it hit — but six of those twelve state a
 * per-rank PROGRESSION in the very sentence it matched ("each time improving
 * the proficiency throw", "learning an additional three languages each"), and
 * flattening them to `repeatable: true` made that missing mechanic invisible.
 * A conclusion the chef never drew must not look like one they did.
 *
 * The custom-class BUILD COST is likewise absent by design: "counts as 2 1/2
 * custom powers" is a NUMBER off the page, and shipping it would put book
 * values in the module. It materializes at runtime from the reader's own prose
 * against the shipped pattern in `registers.derive` (see DERIVE_PATTERNS).
 */
const META_HINTS = {
  // The raw compile-time join omits some inter-run spaces ("removed fromACKS
  // II"), so every boundary is \s* rather than a literal space.
  deprecated: /removed\s*from\s*ACKS\s*II/i,
  repeatable: /selected\s*(?:multiple|several)\s*times|selected\s*more\s*than\s*once/i,
};

/**
 * The high-recall counterpart to META_HINTS, used ONLY to decide whether the
 * page is silent on a flag — never to suggest authoring one.
 *
 * The precise hints above are a reading prompt and are deliberately narrow.
 * Measured against the RR they miss roughly half the repeatable entries,
 * because the book writes the active "a character can select Bargaining
 * multiple times" as often as the passive form. So a hint MISSING is no
 * evidence at all that a chef's authored flag is wrong, and warning on that
 * disagreement just trains everyone to ignore warnings. These loose patterns
 * decide the reverse direction: complain only when nothing on the page is
 * even in the neighbourhood.
 */
const META_PRESENT = {
  deprecated: /removed|no\s*longer|retired/i,
  // Every gap is \s* for the same reason the precise hints above are: the
  // compile-time run join drops inter-run spaces, so "selected multiple times"
  // can arrive as "selectedmultipletimes". A literal-space version of this net
  // reported five entries as unsupported that I had read and verified myself.
  repeatable: /multiple\s*times|more\s*than\s*once|additional\s*times?|each\s*selection|again/i,
};

function metaCandidates(id, entry, bodyText) {
  if (!bodyText) return;
  for (const [flag, re] of Object.entries(META_HINTS)) {
    const hinted = re.test(bodyText);
    const authored = !!entry.meta?.[flag];
    // A hint is a READING PROMPT, not a finding: the pattern cannot tell
    // "can be selected multiple times" from "cannot", and does not see what
    // the rest of the sentence goes on to say.
    if (hinted && !authored) warn(`${id}: text may state "${flag}" — read the entry and author meta.${flag} if so`);
    if (authored && !META_PRESENT[flag].test(bodyText)) {
      warn(`${id}: register authors meta.${flag} but nothing on the page suggests it — re-read the entry`);
    }
  }
}

/**
 * What supersedes a power the book retired. A removed power is still INGESTED
 * (an older or converted source may name it) and flagged; this is the pointer
 * that lets a reference to it land on the thing that replaced it.
 */
function replacementPhrase(bodyText) {
  if (!bodyText) return null;
  const spaced =
    bodyText.match(/In lieu of this power,?\s*the\s*[A-Za-z]+\s*power\s*([a-z][a-z' -]{2,40}?)\s*has\s*been/i) ??
    bodyText.match(/should be assigned the\s*([a-z][a-z' -]{2,40}?)\s*power instead/i) ??
    bodyText.match(/Replace it with\s*(?:one rank of\s*)?([A-Za-z][A-Za-z' -]{2,40}?)\s*proficiency/i);
  if (spaced) return spaced[1].replace(/\s+/g, " ").trim();
  // The raw join can drop spaces wholesale ("Inlieuofthispower"), so retry
  // against a whitespace-free form. The squashed name still resolves, because
  // id matching compares case- and separator-folded.
  const flat = bodyText.replace(/\s+/g, "");
  const m =
    flat.match(/inlieuofthispower,?the[a-z]+power([a-z][a-z'-]{2,40}?)hasbeen/i) ??
    flat.match(/shouldbeassignedthe([a-z][a-z'-]{2,40}?)powerinstead/i) ??
    flat.match(/replaceitwith(?:onerankof)?([a-z][a-z'-]{2,40}?)proficiency/i);
  return m ? m[1] : null;
}

/**
 * The acks-lib capability token for a definition id
 * ("def.prof.sensingEvil" → "kw:sensingevil").
 *
 * Inlined rather than imported: this build tool does not otherwise depend on
 * acks-lib's runtime, and reaching from tools/ into scripts/lib would blur
 * the build/runtime boundary. acks-lib's `capabilityForId` is the canonical
 * definition and is covered by its tests — keep the two in step.
 */
const capabilityToken = (id) =>
  "kw:" +
  String(id ?? "")
    .split(".")
    .slice(2)
    .join("")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/**
 * The target text of a "See X." cross-reference body, or null. Conservative:
 * only a SHORT body that is ENTIRELY a see-reference qualifies, so a
 * description merely mentioning "see Chapter 6" is never mistaken for one.
 */
function seeReference(bodyText) {
  if (!bodyText || bodyText.length > 60) return null;
  const m = bodyText.match(/^See\s*(.+?)\s*\.?$/i);
  return m ? m[1] : null;
}

/**
 * Resolve a see-reference to a known definition id. Handles the three ways the
 * naive slug misses: trailing locators ("see alertness ABOVE"), cross-registry
 * references (a power pointing at a proficiency), and headings the PDF prints
 * without a space ("DiscernEvil"), which slug differently but compare equal
 * case-folded. Returns null when unresolvable — better no alias than a wrong one.
 */
function resolveAlias(raw, entryId, ids) {
  const cleaned = raw
    .replace(/\b(above|below|earlier|later|in this section)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const slug = slugOf(cleaned);
  if (!slug) return null;
  const own = entryId.split(".").slice(0, 2).join(".");
  for (const p of [...new Set([own, "def.power", "def.prof", "def.drawback"])]) {
    if (ids.has(`${p}.${slug}`)) return `${p}.${slug}`;
  }
  const want = slug.toLowerCase();
  for (const id of ids) if (id.split(".").slice(2).join(".").toLowerCase() === want) return id;
  return null;
}

/* -------------------------------------------- */
/*  Main                                        */
/* -------------------------------------------- */

async function main() {
  const only = positional[0];
  const { entries, kinds, refs } = loadRegister();
  const registers = compileRegisters(refs);
  const glyphChars = new Set(Object.keys(registers.tables.damageGlyph ?? {}));

  fs.mkdirSync(COOKBOOK, { recursive: true });
  fs.writeFileSync(path.join(COOKBOOK, "registers.json"), JSON.stringify(registers, null, 2) + "\n");

  const byBook = {};
  for (const e of entries) {
    if (only && e.book !== only) continue;
    (byBook[e.book] ??= []).push(e);
  }

  // Definition entries (proficiency/power/skill) aggregate into CONTENT-TYPE
  // cookbooks spanning every book; monsters keep their per-book file.
  const contentOut = {};

  for (const [bookId, list] of Object.entries(byBook)) {
    // Authored third-party titles live in their own library, listed separately
    // so a missing OSE book stops that book rather than the ACKS family.
    const file = FILES[bookId] ?? OSE_FILES[bookId];
    if (!file || !fs.existsSync(file)) {
      warn(`book ${bookId}: reference PDF not found — skipped`);
      continue;
    }
    const { doc, numPages, title } = await openBook(fs.readFileSync(file));
    const fw = fingerprintWarning(bookId, numPages, title);
    if (fw) warn(fw);

    const out = {
      schema: "acks-cookbook/2",
      book: {
        id: bookId, label: BOOKS[bookId].label, short: BOOKS[bookId].short,
        pages: BOOKS[bookId].pages, titleRe: BOOKS[bookId].titleRe.source,
      },
      entries: {},
    };
    // Per-book authoring context: sibling npc anchors become stop lines for
    // stacked-resident prose flows (see compileNpc).
    const bookCtx = {
      npcAnchors: list
        .filter((e) => e.kind === "kind.npc")
        .map((e) => e.anchor?.runin ?? e.anchor?.display)
        .filter(Boolean),
      // The template compiler reads the monster kind's stat-row map so a
      // template page's FIXED rows ("Type: Monstrosity") bind like any
      // monster's; the "varies by …" rows fail their patterns and stay raw.
      kinds,
    };
    for (const entry of list.sort((a, b) => a.pages[0] - b.pages[0])) {
      const kindRow = kinds[entry.kind];
      if (!kindRow) {
        warn(`${entry.id}: unknown kind ${entry.kind} — skipped`);
        continue;
      }
      if (entry.status && entry.status !== "active") {
        console.error(`SKIP ${entry.id}: status "${entry.status}" (pending review)`);
        continue;
      }
      if (entry.kind === "kind.class" || entry.kind === "kind.classMeta") {
        try {
          const compiled =
            entry.kind === "kind.class"
              ? await compileClass(doc, entry, kinds[entry.kind])
              : await compileClassMeta(doc, entry);
          (contentOut["classes"] ??= { schema: "acks-cookbook/3", content: "classes", entries: {} }).entries[entry.id] = compiled;
          console.error(`OK   ${entry.id}: ${Object.keys(compiled.fields).length} instructions [classes]`);
        } catch (err) {
          warn(`${entry.id}: ${err.message}`);
        }
        continue;
      }
      // A kind whose content is a printed TABLE is a definition by role but
      // not by shape: it has no run-in to anchor on and no prose block to
      // bound, so it never reaches compileDefinition.
      if (entry.kind === "kind.vehicle") {
        try {
          const compiled = await compileVehicleTable(doc, entry, kindRow);
          const content = CONTENT_OF[entry.kind];
          (contentOut[content] ??= { schema: "acks-cookbook/2", content, entries: {} }).entries[entry.id] = compiled;
          const gridCount = Object.keys(compiled.fields).filter((f) => f.startsWith("grids.")).length;
          console.error(`OK   ${entry.id}: ${gridCount} grid(s) [${content}]`);
        } catch (err) {
          warn(`${entry.id}: ${err.message}`);
        }
        continue;
      }
      // An authored third-party creature: geometry compiles, the shipped
      // grammar reads. Composite by role, so it lands in the per-book file.
      if (entry.kind === "kind.oseMonster") {
        try {
          const compiled = await compileOseMonster(doc, entry, kindRow);
          out.entries[entry.id] = compiled;
          console.error(`OK   ${entry.id}: creature box [${entry.book}]`);
        } catch (err) {
          warn(`${entry.id}: ${err.message}`);
        }
        continue;
      }
      // A keyed area of an authored adventure: a heading and the boxes its
      // text occupies. Composite by role, so it lands in the per-book file
      // beside the creatures it shares an adventure with.
      if (entry.kind === "kind.oseLocation") {
        try {
          const compiled = await compileOseLocation(doc, entry, kindRow);
          out.entries[entry.id] = compiled;
          console.error(`OK   ${entry.id}: keyed area [${entry.book}]`);
        } catch (err) {
          warn(`${entry.id}: ${err.message}`);
        }
        continue;
      }
      // Like kind.vehicle: a definition by role, but with no prose block to
      // bound, so it never reaches compileDefinition.
      if (entry.kind === "kind.constant") {
        try {
          const compiled = await compileConstants(doc, entry, kindRow);
          const content = CONTENT_OF[entry.kind];
          (contentOut[content] ??= { schema: "acks-cookbook/2", content, entries: {} }).entries[entry.id] = compiled;
          console.error(`OK   ${entry.id}: constant [${content}]`);
        } catch (err) {
          warn(`${entry.id}: ${err.message}`);
        }
        continue;
      }
      if (kindRow.role === "definition") {
        const content = CONTENT_OF[entry.kind];
        if (!content) {
          warn(`${entry.id}: definition kind ${entry.kind} has no content-type mapping — skipped`);
          continue;
        }
        try {
          const compiled = await compileDefinition(doc, entry, kindRow, list);
          (contentOut[content] ??= { schema: "acks-cookbook/2", content, entries: {} }).entries[entry.id] = compiled;
          console.error(`OK   ${entry.id}: ${compiled.fields.description.paras.length} para(s) [${content}]`);
        } catch (err) {
          warn(`${entry.id}: ${err.message}`);
        }
        continue;
      }
      const axCompile = AX_COMPILERS[entry.kind];
      if (entry.kind !== "kind.monster" && !axCompile) {
        warn(`${entry.id}: kind ${entry.kind} not compilable yet — skipped`);
        continue;
      }
      try {
        const compiled = axCompile
          ? await axCompile(doc, entry, kindRow, bookCtx)
          : await compileMonster(doc, entry, kindRow, glyphChars);
        const { _unmappedLabels, _skips, ...ship } = compiled;
        if (_skips) {
          // Entries sharing a page report the same furniture; dedup on merge.
          for (const [p, boxes] of Object.entries(_skips)) {
            const have = (out.skips ??= {})[p] ?? [];
            const seen = new Set(have.map((b) => JSON.stringify(b)));
            out.skips[p] = [...have, ...boxes.filter((b) => !seen.has(JSON.stringify(b)))];
          }
        }
        out.entries[entry.id] = ship;
        const n = Object.keys(ship.fields).length;
        const paraCount = ship.fields.description?.paras?.length ?? ship.fields.rows?.paras?.length ?? 0;
        console.error(
          `OK   ${entry.id}: ${n} instructions (${paraCount} paras${ship.fields.spoils ? ", spoils" : ""}${ship.fields.statline ? ", statline" : ""}${ship.fields.rows ? `, ${ship.fields.rows.paras.length} row-paras` : ""}${ship.fields.attacks?.colors ? ", colors" : ""})${_unmappedLabels ? ` — unmapped labels: ${_unmappedLabels.join(", ")}` : ""}`,
        );
      } catch (err) {
        warn(`${entry.id}: ${err.message}`);
      }
    }
    // FAMILIES, from the book's own comma naming ("Cat, Lion"; "Golem, Amber"):
    // monster entries sharing a comma base are one creature statted several
    // ways, and the binding collapses them into ONE generator template whose
    // variant options are the members (baseline + special case, not N
    // top-level actors). An overview entry whose display EQUALS the base name
    // ("Beastman", "Lycanthrope") folds in as the family's first option.
    // Derived, not authored — it stays in step with the register mechanically.
    {
      const groups = {};
      const push = (base, variant, entry) =>
        (groups[base] ??= []).push({ id: entry.id, variant, page: entry.pages[0] });
      for (const entry of list) {
        if (!out.entries[entry.id]) continue;
        if (entry.kind === "kind.monster") {
          const m = /^([^,]+),\s*(.+)$/.exec(entry.anchor?.display ?? "");
          if (m) push(m[1].trim(), m[2].trim(), entry);
        } else if (entry.kind === "kind.monsterLegacy") {
          // Legacy appendix blocks share one display per family, so the NAME
          // carries the variant: a trailing parenthetical when present
          // ("Cobra, Mechanical (Bronze)" → family "Cobra, Mechanical",
          // variant "Bronze"), else the after-comma piece ("Mummy, Baboon" →
          // "Mummy" / "Baboon"). NPC epithets never reach here — this branch
          // is monster kinds only, an AX3 "Aghilas, the Lion" stays a person.
          const nm = String(entry.name ?? "");
          const paren = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(nm);
          if (paren && paren[1].includes(",")) push(paren[1].trim(), paren[2].trim(), entry);
          else {
            const m = /^([^,]+),\s*(.+)$/.exec(nm);
            if (m) push(m[1].trim(), m[2].trim(), entry);
          }
        }
      }
      // PREFIX families (no comma in the book's naming): "Mummy" + "Mummy
      // Lord" are one family the comma rule cannot see. Tight on purpose —
      // kind.monster only (a template "Dragon" never swallows "Dragon
      // Turtle"), word-boundary name prefix, both outside every comma group.
      {
        const commaIds = new Set(Object.values(groups).flat().map((m) => m.id));
        const plain = list.filter((e) => e.kind === "kind.monster" && out.entries[e.id] && !commaIds.has(e.id));
        for (const baseE of plain) {
          const baseName = String(baseE.name ?? "").trim();
          if (!baseName || baseName.includes(",")) continue;
          const exts = plain.filter(
            (e) => e !== baseE && String(e.name ?? "").startsWith(`${baseName} `)
          );
          if (!exts.length || groups[baseName]) continue;
          push(baseName, baseName, baseE);
          for (const e of exts) push(baseName, String(e.name).slice(baseName.length).trim(), e);
        }
      }
      const families = {};
      for (const [base, members] of Object.entries(groups)) {
        if (members.length < 2) continue;
        const overview = list.find(
          (entry) =>
            entry.kind === "kind.monster" &&
            out.entries[entry.id] &&
            (entry.anchor?.display ?? "").trim().toLowerCase() === base.toLowerCase()
        );
        const seen = new Set();
        const ordered = [
          ...(overview ? [{ id: overview.id, variant: base, page: overview.pages[0] }] : []),
          ...members.sort((a, b) => a.page - b.page),
        ].filter((m) => !seen.has(m.id) && seen.add(m.id));
        const famId = `${bookId}.family${base.replace(/[^A-Za-z0-9]+/g, "")}`;
        families[famId] = {
          name: base,
          nameFormat: "{variant}",
          cite: citeFor(bookId, ordered[0].page),
          pages: [ordered[0].page],
          members: ordered.map((x) => ({ id: x.id, variant: x.variant })),
        };
      }
      if (Object.keys(families).length) {
        out.families = families;
        console.error(
          `families: ${Object.keys(families).length} (${Object.values(families).reduce((n, f) => n + f.members.length, 0)} member entr(ies))`
        );
      }
    }
    if (Object.keys(out.entries).length) {
      const outPath = path.join(COOKBOOK, `${bookId}.json`);
      fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
      console.error(`wrote ${Object.keys(out.entries).length} entr(ies) -> ${outPath}`);
    }
  }

  // Resolve "See X." cross-references once every id is known. Ids from content
  // types compiled in an EARLIER run are folded in too, so a per-book compile
  // still resolves across registries (a power may point at a proficiency).
  const entryById = new Map();
  for (const data of Object.values(contentOut)) for (const [id, e] of Object.entries(data.entries)) entryById.set(id, e);
  for (const name of new Set(Object.values(CONTENT_OF))) {
    const prev = path.join(COOKBOOK, `${name}.json`);
    if (contentOut[name] || !fs.existsSync(prev)) continue;
    for (const [id, e] of Object.entries(readJson(prev)?.entries ?? {})) entryById.set(id, e);
  }
  const knownIds = new Set(entryById.keys());

  // Pass 1: what each cross-reference points at, before anything is rewritten.
  const aliasTarget = new Map();
  let unresolved = 0;
  for (const data of Object.values(contentOut)) {
    for (const [id, e] of Object.entries(data.entries)) {
      // A retired power keeps its entry and its flag; this resolves the pointer
      // to whatever superseded it, falling back to the printed name. The
      // REGISTER's own `replacedBy` always wins — a chef who read the entry
      // outranks the phrase scan, which is only a candidate finder here.
      const rep = e._replacedRaw;
      delete e._replacedRaw;
      if (rep) {
        const found = resolveAlias(rep, id, knownIds) ?? rep;
        if (!e.meta?.replacedBy) warn(`${id}: text suggests replacedBy "${found}" — read the entry and author meta.replacedBy`);
        else if (e.meta.replacedBy !== found) warn(`${id}: authored replacedBy "${e.meta.replacedBy}" differs from the text's "${found}"`);
      }

      const raw = e._aliasRaw;
      const explicit = e._aliasTarget;
      delete e._aliasRaw;
      delete e._aliasTarget;
      if (!raw && !explicit) continue;
      // A hand-authored target wins: it exists precisely because reading the
      // printed reference back failed.
      if (explicit && !knownIds.has(explicit)) {
        unresolved++;
        warn(`${id}: assists.aliasOf "${explicit}" is not a known definition`);
        continue;
      }
      const target = explicit ?? resolveAlias(raw, id, knownIds);
      if (target && target !== id) aliasTarget.set(id, target);
      else {
        unresolved++;
        warn(`${id}: see-reference could not be resolved to a known definition`);
      }
    }
  }
  // Snapshot the text pointers BEFORE rewriting: an alias may point at another
  // alias, and it must land on the entry that actually prints the text.
  const textOf = new Map([...entryById].map(([id, e]) => [id, e.fields?.description]));
  const citeOf = new Map([...entryById].map(([id, e]) => [id, e.cite]));
  const finalTarget = (id) => {
    const seen = new Set([id]);
    let at = aliasTarget.get(id);
    while (at && aliasTarget.has(at) && !seen.has(at)) {
      seen.add(at);
      at = aliasTarget.get(at);
    }
    return at;
  };

  // Pass 2: an alias is its OWN ability, not a redirect. The books list a name
  // whose rules text is printed under another entry — so it gets a real entry
  // and the recipe carries a pre-baked pointer to WHERE that text lives. The
  // pointer is page coordinates, not the passage: safe to ship, useless without
  // the book. Because the effect scan reads whatever prose the pointer yields,
  // the alias materializes the same mechanics without restating any of them.
  let linked = 0;
  let dangling = 0;
  let crossBook = 0;
  for (const data of Object.values(contentOut)) {
    for (const [id, e] of Object.entries(data.entries)) {
      const target = finalTarget(id);
      if (!target) continue;
      e.aliasOf = target;
      const desc = textOf.get(target);
      if (!desc) {
        dangling++;
        warn(`${id}: alias target ${target} has no text pointer to follow`);
        continue;
      }
      // The pointer is page GEOMETRY, and geometry only means anything in the
      // book it was measured against. An entry is read from `entry.book` alone
      // — there is no per-field book, and the instruction set has no
      // cross-document read — so an alias that borrows a passage must also be
      // read from where that passage prints, or those rectangles land on
      // whatever the alias's own book happens to print at those coordinates.
      // The name probe moves with it: it is what proves the page, and the
      // alias's own probe points at its listing in the book being left behind.
      // `e.name` — the ability's actual name — is a different field and stays.
      const t = entryById.get(target);
      if (t && t.book !== e.book) {
        crossBook++;
        e.book = t.book;
        e.pages = t.pages;
        if (t.fields?.name) e.fields.name = t.fields.name;
      }
      e.fields.description = desc;
      // The prose alone only carries what the SCAN can classify. Anything the
      // chef authored on the target — a prerequisite, a companion slot, a
      // progression column — is equally part of the capability, and an alias
      // that shares the capability shares those too. Its own authored specs
      // always win; this only fills what it did not state for itself.
      const tf = t?.fields ?? {};
      if (tf.effects && !e.fields.effects) e.fields.effects = tf.effects;
      if (tf.progression && !e.fields.progression) e.fields.progression = tf.progression;
      // The citation labels the PROSE, and the prose is the target's — so cite
      // where a reader would actually turn to read it.
      e.cite = citeOf.get(target) ?? e.cite;
      // Two names for one capability do not stack. The target's build cost and
      // retirement carry over too (same content), but never overwrite anything
      // the alias's own listing stated.
      e.meta = {
        ...(t?.meta?.powerValue != null ? { powerValue: t.meta.powerValue } : {}),
        ...(t?.meta?.deprecated ? { deprecated: true, ...(t.meta.replacedBy ? { replacedBy: t.meta.replacedBy } : {}) } : {}),
        ...(e.meta ?? {}),
        notStacksWith: [target],
        // The alias and its target are one capability under two names, so both
        // declare it. A gate written against the capability is then satisfied
        // by whichever of them the character actually took.
        provides: [capabilityToken(target)],
      };
      t.meta = { ...(t.meta ?? {}), provides: [capabilityToken(target)] };
      linked++;
    }
  }
  if (linked || unresolved || dangling) {
    console.error(
      `aliases: ${linked} linked to their text, ${unresolved} unresolved, ${dangling} dangling, ${crossBook} following their text into another book`
    );
  }

  // Content-type cookbooks: named by WHAT they extract, spanning every book
  // (powers appear in JJ and other books; monsters in MM and adventures).
  //
  // WHICH IS WHY A BOOK-SCOPED COMPILE MUST NOT WRITE ONE BLIND. Compiling a
  // single book fills these with that book's entries alone, so writing them
  // over a full compile's output silently deletes every other book's — tens of
  // thousands of lines, with a clean exit code and a reassuring "wrote N
  // entries" for the survivors. Nothing downstream notices until a coherence
  // test fails somewhere unrelated.
  //
  // The rule is stated as a floor rather than as advice: a content cookbook is
  // never written with FEWER entries than the file already on disk. A full
  // compile only ever adds, and a scratch `--out` dir has nothing to lose, so
  // this fires on exactly one thing — the destructive case.
  // EVERY file is checked before ANY is written. Refusing part-way through the
  // loop leaves the ones already written clobbered, which is the failure this
  // guard exists to prevent, differing only in how much of it happened.
  for (const [content, data] of Object.entries(contentOut)) {
    const outPath = path.join(COOKBOOK, `${content}.json`);
    const prior = readJsonIfAny(outPath)?.entries ?? null;
    const lost = prior ? Object.keys(prior).filter((k) => !data.entries[k]) : [];
    if (lost.length) {
      throw new Error(
        `refusing to write ${outPath}: it holds ${lost.length} entr(ies) this compile did not produce ` +
          `(e.g. ${lost.slice(0, 3).join(", ")}). A content cookbook spans every book, so compiling one ` +
          `book alone cannot write it. Compile every book, or send this run to a scratch dir with --out.`,
      );
    }
  }
  for (const [content, data] of Object.entries(contentOut)) {
    const outPath = path.join(COOKBOOK, `${content}.json`);
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2) + "\n");
    // The audit burn-down, stated at every build so nobody mistakes scan
    // coverage for verified correctness. An entry counts only when a chef has
    // read its full output against the page and set `audited` in the register.
    const all = Object.values(data.entries);
    const done = all.filter((e) => e.audited).length;
    console.error(`wrote ${all.length} entr(ies) -> ${outPath} (chef-audited: ${done}/${all.length})`);
  }

  // An index of what actually exists, so the runtime loads by name instead of
  // probing every book id and 404-ing for the ones with no cookbook yet.
  // Written from the DIRECTORY, not this run, so a per-book compile does not
  // drop the files an earlier run produced.
  const present = fs.readdirSync(COOKBOOK).filter((f) => f.endsWith(".json"));
  const stem = (f) => f.replace(/\.json$/, "");
  const contentNames = new Set(Object.values(CONTENT_OF));
  fs.writeFileSync(
    path.join(COOKBOOK, "index.json"),
    JSON.stringify(
      {
        books: present.map(stem).filter((s) => BOOKS[s]),
        content: present.map(stem).filter((s) => contentNames.has(s)),
      },
      null,
      2,
    ) + "\n",
  );
  console.error(`compile done — ${warns.length} warning(s).`);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
