/**
 * PDF text extraction engine (pdf.js): column-first reconstruction of a page's
 * text runs.
 *
 * Runs identically in the browser and in Node (the tools harness): the worker
 * is only wired up when the module boots in Foundry (`setWorker`); under Node
 * pdf.js falls back to its fake worker. Nothing here persists; callers
 * receive plain strings and decide caching.
 */
import { getDocument, GlobalWorkerOptions, OPS } from "../../vendor/pdfjs/pdf.mjs";
import { BOOKS } from "./books.mjs";

const HEADING_MIN_H = 12; // display headings are >=14pt; body is 9-10pt
const FAMILY_BODY_PT = 9.5; // the body size every size test in the engine is calibrated to
const FOOTER_BAND = 32; // pt from page bottom: the stop for a document too short to profile
const FOOTER_ZONE_SHARE = 0.05; // the strip furniture can live in, as a share of trim height
const FOOTER_LINE_RUNS = 4; // a folio or running foot is a few runs wide; a line of type is many
const FOOTER_SHARE = 0.7; // a furniture line prints on this share of its parity's pages
const PROFILE_PAGES = 24; // pages sampled to learn a document's furniture
const PROFILE_MIN_RUNS = 20; // runs that make a page evidence rather than a plate
const PROFILE_MIN_PAGES = 3; // sampled pages a parity needs before its profile is trusted

const COL_BIN_SHARE = 0.08; // a column-left bin holds this share of the page's body runs
const COL_MIN_GAP = 40; // lefts nearer than this are one column: the inner one is an indent
const LINE_TOL = 2; // pt between BASELINES that still print as one line: sub-point jitter, under the 9-10pt leading
const LINE_GAP = 12; // a hole this wide parts two blocks: over a stretched word space, under the corpus's 16pt gutter
const EDGE_TOL = 6; // how ragged one column's left edge is across the lines starting there
const COL_MIN_LINES = 5; // fewer lines than this is a caption or a stub, not a column
const COL_MIN_SHARE = 0.15; // a rescued column starts this share of the page's lines
const COL_MAX_CROSS = 0.1; // lines that may reach across a gutter and leave it one
const COL_MIN_SOLO = 0.15; // lines of a rescued column alone on their baseline; a table's cell never is
const COL_MIN_MEASURE = 0.5; // a rescued column's median line against the page's widest measure

/**
 * A spoil component, `name (weight st, cost gp, effects)`: the whole-stone
 * part of the weight is optional, the stone unit may close with a period, and
 * the effects group is paren-aware. Shared with executor.mjs, which imports it
 * from here to avoid a cycle.
 */
export const SPOIL_RE = /([A-Za-z][A-Za-z' -]*?)\s*\((?:(\d+)\s*)?(?:(\d)\/6\s*)?st\.?,\s*([\d,]+)\s*gp(?:,\s*((?:[^()]|\([^)]*\))+?))?\)/g;

/** Points pdf.js at its worker script; the module calls it once at boot. */
export function setWorker(url) {
  GlobalWorkerOptions.workerSrc = url;
}

/**
 * Where the wasm image decoders live (openjpeg/jbig2/qcms). JPEG2000 images
 * decode only through these; without them a page render that needs one hangs.
 * Browser-only (the module sets it at boot); the offline tools never decode
 * pixels.
 */
let WASM_URL = null;
/** Sets the wasm decoder directory read by `openBook`. */
export function setWasmUrl(url) {
  WASM_URL = url;
}

/**
 * Open a PDF. `book` names the registry row the file is being read as, so the
 * document carries that book's declared typography (`useTypography`) from its
 * first page read; a caller that learns the book only after opening tags it
 * itself.
 */
export async function openBook(data, { book = null } = {}) {
  const doc = await getDocument({
    data: new Uint8Array(data),
    useSystemFonts: true,
    // Errors only: pdf.js warns about image headers it then corrects itself.
    verbosity: 0,
    ...(WASM_URL ? { wasmUrl: WASM_URL } : {}),
  }).promise;
  const meta = await doc.getMetadata().catch(() => null);
  if (book) useTypography(doc, book);
  return { doc, numPages: doc.numPages, title: meta?.info?.Title ?? "" };
}

/**
 * The strip furniture can occupy, as a share of the trim. Proportional to page
 * height, since a fixed distance misses the folio on a larger page and reaches
 * type on a smaller one.
 */
const footerZone = (height) => Math.max(FOOTER_BAND, height * FOOTER_ZONE_SHARE);

/**
 * A footer line's identity: page parity, baseline, type size. Parity because
 * furniture mirrors recto to verso; type size because a last line of type can
 * land within a point of the folio's baseline.
 */
const footerKey = (pageNo, it) => `${pageNo % 2}@${it.transform[5].toFixed(1)}@${it.height.toFixed(1)}`;

/**
 * A page's non-empty text runs, coincident duplicates removed.
 *
 * Faux-bold headings and folios are double-struck: the same glyph painted twice
 * at the same coordinates. Dropping exact (str,x,y) coincidences makes a
 * heading read once and a folio count as one run, which the footer profile's
 * width test depends on. Runs before the footer test so compiler and runtime
 * dedupe identically.
 */
function textRuns(content) {
  const seen = new Set();
  const runs = [];
  // pdf.js sets a tight word space as its own zero-width " " item and marks a
  // line end with an empty one. Neither is a run; the boundary is kept on the
  // run that follows (`spaceBefore`) so a joiner can restore the space.
  let spaceBefore = false;
  for (const it of content.items) {
    if (typeof it.str !== "string") continue;
    if (!it.str.trim()) {
      spaceBefore = true;
      continue;
    }
    const key = `${it.str}|${it.transform[4].toFixed(1)}|${it.transform[5].toFixed(1)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (spaceBefore) it.spaceBefore = true;
    spaceBefore = false;
    runs.push(it);
  }
  return runs;
}

/** How many runs each footer key carries on one page. */
function footerLines(pageNo, runs, zone) {
  const per = new Map();
  for (const it of runs) {
    if (it.transform[5] > zone) continue;
    const key = footerKey(pageNo, it);
    per.set(key, (per.get(key) ?? 0) + 1);
  }
  return per;
}

/**
 * The pages a profile is built from: consecutive pairs spread through the
 * document, so both page parities are sampled (an even stride lands on one).
 * Derived from the page count alone, so the compiler and the runtime executor
 * learn the same profile.
 */
function profilePages(numPages) {
  const pairs = Math.max(1, Math.min(Math.ceil(numPages / 2), Math.floor(PROFILE_PAGES / 2)));
  const out = new Set();
  for (let i = 0; i < pairs; i++) {
    const p = 1 + Math.round((i * (numPages - 1)) / Math.max(1, pairs - 1));
    out.add(p);
    out.add(p < numPages ? p + 1 : p - 1);
  }
  return [...out].filter((p) => p >= 1 && p <= numPages).sort((a, b) => a - b);
}

/** Footer profiles, one per open document; the promise is cached so concurrent page reads share one sampling pass. */
const profiles = new WeakMap();

/**
 * Which lines of this document are page furniture.
 *
 * Furniture is what repeats: a folio or running foot prints on nearly every
 * page of its parity, on one baseline, in one size, a few runs wide. Both
 * tests are needed: recurrence alone cannot separate a justified block that
 * bottoms out on a fixed grid from the folio, and thinness alone calls every
 * short line furniture.
 *
 * @returns `{ keys, parity }` — the footer keys to drop, and per page parity
 *          whether the sample is enough to trust them.
 */
async function footerProfile(doc) {
  if (profiles.has(doc)) return profiles.get(doc);
  const job = (async () => {
    const evidence = [0, 0];
    const found = [0, 0];
    const lines = new Map();
    for (const p of profilePages(doc.numPages)) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const runs = textRuns(await page.getTextContent());
      // A plate or blank leaf says nothing about where furniture sits.
      if (runs.length < PROFILE_MIN_RUNS) continue;
      evidence[p % 2]++;
      for (const [key, n] of footerLines(p, runs, footerZone(vp.height))) {
        const rec = lines.get(key) ?? { pages: 0, widest: 0 };
        rec.pages++;
        rec.widest = Math.max(rec.widest, n);
        lines.set(key, rec);
      }
    }
    const keys = new Set();
    for (const [key, rec] of lines) {
      const seen = evidence[+key[0]];
      if (seen < PROFILE_MIN_PAGES) continue;
      if (rec.widest > FOOTER_LINE_RUNS) continue;
      if (rec.pages < seen * FOOTER_SHARE) continue;
      keys.add(key);
      found[+key[0]]++;
    }
    // A parity sampled well and yielding no furniture line keeps the flat band:
    // trusting its empty profile would leak a folio into every page.
    return {
      keys,
      parity: [
        evidence[0] >= PROFILE_MIN_PAGES && found[0] > 0,
        evidence[1] >= PROFILE_MIN_PAGES && found[1] > 0,
      ],
    };
  })();
  profiles.set(doc, job);
  return job;
}

/**
 * Mark an opened document with its book's declared typography (`typography`
 * on the registry row), where the row declares one. `bodyPt` scales every
 * run's height by `FAMILY_BODY_PT / bodyPt`, since every size test is
 * calibrated to the family body size; `glyphs` maps a book's ligature code
 * points to the letters they stand for. Both apply in `pageItems`, so the
 * compiler and the runtime read one book identically; each calls this once
 * when it opens a book by its id. A document with no declaration is untouched.
 */
export function useTypography(doc, bookId) {
  const typography = BOOKS[bookId]?.typography;
  if (typography) doc.acksTypography = typography;
  return doc;
}

/** A run's text with its book's ligature code points put back as letters. */
function mapGlyphs(str, glyphs) {
  let out = "";
  for (const ch of str) out += glyphs[ch] ?? ch;
  return out;
}

/** All positioned text items of a page (top-origin y), furniture filtered. */
export async function pageItems(doc, pageNo) {
  const page = await doc.getPage(pageNo);
  const vp = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const profile = await footerProfile(doc);
  const runs = textRuns(content);
  const zone = footerZone(vp.height);
  const lines = footerLines(pageNo, runs, zone);
  const profiled = profile.parity[pageNo % 2];
  const typography = doc.acksTypography ?? null;
  const glyphs = typography?.glyphs ?? null;
  const hScale = typography?.bodyPt > 0 ? FAMILY_BODY_PT / typography.bodyPt : 1;
  const items = runs
    .filter((it) => {
      // The retailer's order stamp is not on a repeatable baseline, so it is dropped wherever it lands.
      if (/Order #\d+/.test(it.str)) return false;
      if (it.transform[5] > zone) return true;
      // No profile (too short a document, or an unrecognised parity): the flat band is the only stop.
      if (!profiled) return it.transform[5] > FOOTER_BAND;
      const key = footerKey(pageNo, it);
      // A footer line carrying a whole line of type on this page is a collision: keep the line.
      return !(profile.keys.has(key) && lines.get(key) <= FOOTER_LINE_RUNS);
    })
    .map((it) => ({
      str: glyphs ? mapGlyphs(it.str, glyphs) : it.str,
      x: it.transform[4],
      y: vp.height - it.transform[5],
      w: it.width,
      h: it.height * hScale,
      alias: it.fontName,
      sp: it.spaceBefore === true,
      // A run that is nothing but a ligature, for `fuseRuns`.
      ...(glyphs && it.str && (LIGATURES.has(it.str) || [...it.str].every((ch) => /^[a-z]+$/.test(glyphs[ch] ?? "")))
        ? { lig: true }
        : {}),
    }));
  return {
    items: typography ? fuseRuns(items, typography) : items,
    width: vp.width,
    height: vp.height,
    // The book's declared measures (paragraph gap, leading, body top) ride with the page.
    ...(typography ? { typography } : {}),
  };
}

/** The standard ligatures a text layer sets as a run of their own. */
const LIGATURES = new Set(["fi", "fl", "ff", "ffi", "ffl"]);

/**
 * Two run shapes a book's text layer may set, put back the way a reader sees
 * the line. `ligatureRuns`: each ligature is a run of its own, so a word
 * arrives in pieces; a ligature run rejoins the run it touches on either side
 * unless a word space opens between them. `labelColon`: a label's colon is set
 * with the value, so no label ends in one; the colon moves onto the touching
 * run before it. Touching is a gap under 1.5pt on one baseline. Items keep
 * their order; a run absorbed into another, or left empty, goes.
 */
function fuseRuns(items, { ligatureRuns = false, labelColon = false } = {}) {
  const strip = ({ lig: _lig, ...it }) => it;
  if (!ligatureRuns && !labelColon) return items.map(strip);
  const TOUCH = 1.5;
  const gone = new Set();
  const lines = [];
  for (const it of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const ln = lines[lines.length - 1];
    if (ln && Math.abs(ln[0].y - it.y) <= 0.8) ln.push(it);
    else lines.push([it]);
  }
  for (const line of lines) {
    let prev = line[0];
    let ligEnd = !!prev.lig;
    for (let i = 1; i < line.length; i++) {
      const cur = line[i];
      const gap = cur.x - (prev.x + (prev.w ?? 0));
      const touching = Math.abs(gap) < TOUCH;
      if (ligatureRuns && touching && !cur.sp && (cur.lig || ligEnd)) {
        prev.str += cur.str;
        prev.w = cur.x + (cur.w ?? 0) - prev.x;
        ligEnd = !!cur.lig;
        gone.add(cur);
        continue;
      }
      if (labelColon && touching && cur.str.startsWith(":") && prev.str.trim() && !/:$/.test(prev.str)) {
        const cw = (cur.w ?? 0) / cur.str.length;
        prev.str += ":";
        prev.w = (prev.w ?? 0) + cw;
        cur.str = cur.str.slice(1);
        cur.x += cw;
        cur.w = (cur.w ?? 0) - cw;
        if (!cur.str) {
          gone.add(cur);
          continue;
        }
      }
      prev = cur;
      ligEnd = !!cur.lig;
    }
  }
  return items.filter((it) => !gone.has(it)).map(strip);
}

/**
 * Ordered text runs containing any of the given codepoints, with their fill
 * colors, from the page's operator list. Stream order is deterministic per
 * printing, and run indexes are stable because only runs containing the target
 * codepoints are counted (a retailer's watermark never contains them). Used by
 * the executor's glyphColor instruction and by the compiler to choose pick
 * indexes.
 */
export async function glyphColorRuns(doc, pageNo, codepoints) {
  const want = new Set(codepoints.map((c) => (typeof c === "number" ? c : c.codePointAt(0))));
  const page = await doc.getPage(pageNo);
  const vp = page.getViewport({ scale: 1 });
  const ops = await page.getOperatorList();
  let fill = null;
  let tx = 0;
  let ty = 0;
  const runs = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];
    if (fn === OPS.setFillRGBColor) {
      fill = typeof args?.[0] === "string" ? args[0] : Array.isArray(args) || ArrayBuffer.isView(args) ? `rgb(${[...args].join(",")})` : String(args);
    } else if (fn === OPS.setTextMatrix) {
      tx = args[4];
      ty = args[5];
    } else if (fn === OPS.moveText) {
      tx += args[0];
      ty += args[1];
    } else if (fn === OPS.showText) {
      let text = "";
      let hit = false;
      for (const g of args?.[0] ?? []) {
        if (g && typeof g === "object" && typeof g.unicode === "string") {
          text += g.unicode;
          if (want.has(g.unicode.codePointAt(0))) hit = true;
        }
      }
      if (hit) runs.push({ text, fill, x: tx, y: vp.height - ty });
    }
  }
  return runs;
}

/**
 * The page's printed lines, each as the blocks of type that touch along it.
 * pdf.js emits a run per style change, so one printed line arrives as several
 * items sharing a baseline; joining runs that touch and cutting at a hole
 * wider than a stretched word space recovers where a line starts and how far
 * it reaches. Runs are ordered by x before they are joined, so a left-hand run
 * is never swallowed by a segment that began to its right.
 */
function textLines(body) {
  const rows = [];
  let row = null;
  for (const it of body.slice().sort((a, b) => a.y - b.y || a.x - b.x)) {
    if (!row || it.y - row.y > LINE_TOL) rows.push((row = { y: it.y, items: [it] }));
    else row.items.push(it);
  }
  return rows.map(({ y, items }) => {
    const segs = [];
    for (const it of items.sort((a, b) => a.x - b.x)) {
      const seg = segs[segs.length - 1];
      if (seg && it.x - seg.x1 <= LINE_GAP) seg.x1 = Math.max(seg.x1, it.x + it.w);
      else segs.push({ x0: it.x, x1: it.x + it.w });
    }
    return { y, segs };
  });
}

/**
 * Column left edges from a histogram of body-item x origins, with columns the
 * histogram starves recovered from the page's lines.
 *
 * The histogram counts line starts against every run, so its bar rises with
 * the page's typographic fragmentation: a column of stat blocks or small caps
 * starves the quieter column beside it. The rescue re-asks the question of the
 * page's lines and admits an edge only where the page's extents agree: nothing
 * reaches across either gutter that bounds it, its lines stand alone on their
 * baselines often enough (a table's cells never do), and its measure matches
 * the widest the page already sets. A page whose histogram found no column is
 * left alone, and the rescue only adds: a column the histogram named is never
 * moved or dropped.
 */
export function detectColumns(items) {
  const body = items.filter((it) => it.h < HEADING_MIN_H);
  const bins = {};
  for (const it of body) {
    const bin = Math.round(it.x / 10) * 10;
    bins[bin] = (bins[bin] || 0) + 1;
  }
  const peaks = Object.entries(bins)
    .map(([x, n]) => ({ x: +x, n }))
    .filter((b) => b.n > body.length * COL_BIN_SHARE)
    .sort((a, b) => a.x - b.x);
  const cols = [];
  for (const p of peaks) {
    if (cols.length && p.x - cols[cols.length - 1] < COL_MIN_GAP) continue;
    cols.push(p.x);
  }
  if (!cols.length) return [0];

  const lines = textLines(body);
  const segs = lines.flatMap((l) => l.segs);
  // Line starts, grouped so one ragged edge is counted once.
  const groups = [];
  for (const x of segs.map((s) => s.x0).sort((a, b) => a - b)) {
    const group = groups[groups.length - 1];
    if (group && x - group.lo <= EDGE_TOL) group.at.push(x);
    else groups.push({ lo: x, at: [x] });
  }
  const spanning = (x) => segs.filter((s) => s.x0 < x - EDGE_TOL && s.x1 > x + EDGE_TOL).length;
  const measureOf = (group) => {
    const hi = group.at[group.at.length - 1];
    const widths = segs
      .filter((s) => s.x0 >= group.lo - 0.5 && s.x0 <= hi + 0.5)
      .map((s) => s.x1 - s.x0)
      .sort((a, b) => a - b);
    return widths[widths.length >> 1] ?? 0;
  };
  // What this page calls a column: the widest measure set at an edge already
  // detected. A rescued column is held to it.
  let measure = 0;
  for (const group of groups) {
    if (cols.some((c) => Math.abs(c - group.lo) < COL_MIN_GAP)) measure = Math.max(measure, measureOf(group));
  }

  const floor = Math.max(COL_MIN_LINES, lines.length * COL_MIN_SHARE);
  const crossing = lines.length * COL_MAX_CROSS;
  const held = [...cols];
  const candidates = [];
  for (const group of groups) {
    if (group.at.length < floor) continue;
    // The edge is where most of the group's lines start; a hanging indent or a
    // tab-centred numeral would carry it inboard.
    let edge = group.lo;
    let most = 0;
    for (let i = 0; i < group.at.length; ) {
      let j = i;
      while (j < group.at.length && group.at[j] === group.at[i]) j++;
      if (j - i > most) {
        most = j - i;
        edge = group.at[i];
      }
      i = j;
    }
    const x = Math.round(edge / 10) * 10;
    if (held.some((c) => Math.abs(c - x) < COL_MIN_GAP)) continue;
    const hi = group.at[group.at.length - 1];
    const own = lines.filter((l) => l.segs.some((s) => s.x0 >= group.lo - 0.5 && s.x0 <= hi + 0.5));
    if (own.filter((l) => l.segs.length === 1).length < own.length * COL_MIN_SOLO) continue;
    if (measureOf(group) < measure * COL_MIN_MEASURE) continue;
    if (spanning(edge) > crossing) continue;
    held.push(x);
    candidates.push({ x, edge });
  }
  // The gutter on a candidate's right is tested once every candidate is known,
  // so the boundary between two rescued columns is examined.
  const all = held.slice().sort((a, b) => a - b);
  const extras = candidates
    .filter(({ x }) => {
      const next = all.find((c) => c > x);
      return next == null || spanning(next) <= crossing;
    })
    .map((c) => c.x);
  return [...cols, ...extras].sort((a, b) => a - b);
}

/** The index of the column whose left edge `x` falls at or after (within 5pt). */
export const colOf = (x, cols) => {
  let best = 0;
  for (let i = 0; i < cols.length; i++) if (x >= cols[i] - 5) best = i;
  return best;
};

const joinProse = (items) =>
  items
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((it) => it.str)
    .join("")
    .replace(/\s+/g, " ")
    .trim();

/** Reconstruct display-heading lines from large items (headings span items). */
function displayHeadings(items, cols) {
  const big = items.filter((it) => it.h >= HEADING_MIN_H).map((it) => ({ ...it, col: colOf(it.x, cols) }));
  const lines = {};
  for (const it of big) (lines[`${it.col}:${Math.round(it.y / 3)}`] ||= []).push(it);
  return Object.values(lines)
    .map((arr) => arr.sort((a, b) => a.x - b.x))
    .map((arr) => ({ text: arr.map((a) => a.str).join("").replace(/\s+/g, " ").trim(), y: arr[0].y, col: arr[0].col }))
    .filter((h) => h.text.length > 2);
}

/**
 * Every extraction anchor detected on a page, for interactive browsing:
 * display headings plus run-in candidates (line-initial `Name:` body items).
 * Returned in column/reading order with the mode each anchor needs.
 */
export function listHeadings({ items }) {
  const cols = detectColumns(items);
  const displays = displayHeadings(items, cols).map((h) => ({ text: h.text, mode: "display", col: h.col, y: h.y }));
  const runins = items
    .filter(
      (it) =>
        it.h < HEADING_MIN_H &&
        /^[A-Z][^:]{1,38}:\s*$/.test(it.str.trim()) &&
        cols.some((c) => Math.abs(it.x - c) < 15),
    )
    .map((it) => ({ text: it.str.trim(), mode: "runin", col: colOf(it.x, cols), y: it.y }));
  return [...displays, ...runins].sort((a, b) => a.col - b.col || a.y - b.y);
}

/**
 * Display-heading mode: anchor on a large heading, collect same-column body
 * text until the next large heading in that column (or page end).
 */
export function extractDisplay({ items, height }, heading) {
  const cols = detectColumns(items);
  const heads = displayHeadings(items, cols);
  const anchor = heads.find((h) => h.text.toLowerCase().startsWith(heading.toLowerCase()));
  if (!anchor) return null;
  // A parent heading directly over a variant may own almost no prose, so keep
  // extending past sub-headings until enough text accumulates.
  const later = heads
    .filter((h) => h.col === anchor.col && h.y > anchor.y + 2)
    .sort((a, b) => a.y - b.y);
  const bounds = [...later.map((h) => h.y), height];
  let prose = "";
  let from = anchor.y;
  for (const yMax of bounds) {
    const body = items.filter(
      (it) => it.h < HEADING_MIN_H && colOf(it.x, cols) === anchor.col && it.y > from && it.y < yMax,
    );
    prose = `${prose} ${joinProse(body)}`.trim();
    if (prose.length >= 60) break;
    from = yMax;
  }
  return prose.length > 20 ? prose : null;
}

/**
 * Run-in mode: the entry heading is body-size bold. Find it by text, learn the
 * bold font's alias from the match (pdf.js aliases are per-document), then
 * collect until the next line-initial item with that alias (the next entry).
 */
export function extractRunin({ items, height }, heading) {
  const cols = detectColumns(items);
  const anchor = items.find((it) => it.str.trim().startsWith(heading));
  if (!anchor) return null;
  const col = colOf(anchor.x, cols);
  const stop = items
    .filter(
      (it) =>
        it !== anchor &&
        it.alias === anchor.alias &&
        colOf(it.x, cols) === col &&
        it.y > anchor.y + 2 &&
        Math.abs(it.x - cols[col]) < 15,
    )
    .sort((a, b) => a.y - b.y)[0];
  const yMax = stop ? stop.y : height;
  const body = items.filter((it) => {
    if (it === anchor || colOf(it.x, cols) !== col) return false;
    const sameLineAfter = Math.abs(it.y - anchor.y) <= 2 && it.x > anchor.x;
    return sameLineAfter || (it.y > anchor.y + 2 && it.y < yMax);
  });
  const prose = joinProse(body);
  return prose.length > 20 ? prose : null;
}


/**
 * Spoils subsection: a bold run-in header followed by component bullets of
 * the form `name (weight, cost, effects)` (MM p. 169). Calibrates its font
 * alias like `extractRunin`. Returns [{name, weight6, cost, effects}].
 */
export function extractSpoils({ items, height }) {
  const cols = detectColumns(items);
  const anchor = items.find((it) => it.h < HEADING_MIN_H && it.str.trim() === "Spoils");
  if (!anchor) return [];
  const col = colOf(anchor.x, cols);
  const stop = items
    .filter(
      (it) =>
        it !== anchor &&
        it.y > anchor.y + 2 &&
        colOf(it.x, cols) === col &&
        (it.h >= HEADING_MIN_H || (it.alias === anchor.alias && Math.abs(it.x - cols[col]) < 15)),
    )
    .sort((a, b) => a.y - b.y)[0];
  const yMax = stop ? stop.y : height;
  const text = joinProse(items.filter((it) => colOf(it.x, cols) === col && it.y > anchor.y && it.y < yMax));
  const spoils = [];
  for (const m of text.matchAll(SPOIL_RE)) {
    const stone = m[2] ? parseInt(m[2], 10) : 0; // whole-stone part is optional
    spoils.push({
      name: m[1].trim(),
      weight6: stone * 6 + (m[3] ? parseInt(m[3], 10) : 0),
      cost: parseInt(m[4].replace(/,/g, ""), 10),
      effects: (m[5] ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    });
  }
  return spoils;
}


/* -------------------------------------------- */
/*  Page artwork                                */
/* -------------------------------------------- */

/** Image XObjects painted on a page: [{ name, width, height, kind, bitmap }]. */
export async function pageArtInfo(doc, pageNo) {
  const page = await doc.getPage(pageNo);
  const ops = await page.getOperatorList();
  const names = new Set();
  for (let i = 0; i < ops.fnArray.length; i++) {
    if (ops.fnArray[i] === OPS.paintImageXObject) names.add(ops.argsArray[i][0]);
  }
  const out = [];
  for (const name of names) {
    // Timeout-guarded: Node's fake pdf.js worker can stall object delivery after
    // the first page; an unresolved image is reported as unavailable.
    const img = await new Promise((resolve) => {
      let done = false;
      const finish = (value) => {
        if (!done) {
          done = true;
          resolve(value ?? null);
        }
      };
      try {
        page.objs.get(name, finish);
      } catch {
        try {
          page.commonObjs.get(name, finish);
        } catch {
          finish(null);
        }
      }
      setTimeout(() => finish(null), 3000);
    });
    if (img) out.push({ name, width: img.width, height: img.height, kind: img.kind, img });
  }
  return out;
}

/**
 * Placed image rectangles from the page's operator list: a pure operator walk
 * with no object delivery, so it cannot stall under Node's fake worker. Top-origin
 * y like `pageItems`. The offline compiler uses placement to associate an entry
 * with the illustration printed inside its claimed region.
 */
export async function pageArtPlacements(doc, pageNo) {
  const page = await doc.getPage(pageNo);
  const vp = page.getViewport({ scale: 1 });
  const ops = await page.getOperatorList();
  const mul = (m, n) => [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
  const stack = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const out = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = mul(ctm, ops.argsArray[i]);
    else if (fn === OPS.paintImageXObject) {
      // The image paints as the unit square through the CTM.
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [
        ctm[0] * x + ctm[2] * y + ctm[4],
        ctm[1] * x + ctm[3] * y + ctm[5],
      ]);
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      out.push({
        name: ops.argsArray[i][0],
        x: Math.min(...xs),
        y: vp.height - Math.max(...ys),
        w: Math.max(...xs) - Math.min(...xs),
        h: Math.max(...ys) - Math.min(...ys),
      });
    }
  }
  return out;
}

/**
 * Pick the page's illustration: exclude page-background rasters (very wide)
 * and ornament strips (extreme aspect), take the largest remainder above a
 * minimum size. Returns the info entry or null.
 */
export function pickArt(infos) {
  return (
    infos
      .filter((i) => i.width >= 200 && i.height >= 200 && i.width < 1500)
      .filter((i) => i.width / i.height < 3 && i.height / i.width < 3)
      .sort((a, b) => b.width * b.height - a.width * a.height)[0] ?? null
  );
}

/**
 * Extract a region of the rendered page as a PNG blob (browser only). Used
 * when the cookbook ships a placement box: rendering sidesteps XObject
 * delivery, which never registers images painted inside Form XObjects.
 */
export async function extractPageArtRegion(doc, pageNo, box) {
  if (typeof document === "undefined") return null;
  const page = await doc.getPage(pageNo);
  const scale = 2;
  const vp = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = vp.width;
  canvas.height = vp.height;
  // Raced against a timeout: a render waiting on an undecodable image degrades to "no art".
  const task = page.render({ canvasContext: canvas.getContext("2d"), viewport: vp });
  const done = await Promise.race([
    task.promise.then(() => true),
    new Promise((r) => setTimeout(() => r(false), 20000)),
  ]);
  if (!done) {
    try {
      task.cancel();
    } catch {
      /* already settled */
    }
    return null;
  }
  const sx = Math.max(0, Math.round(box.x * scale));
  const sy = Math.max(0, Math.round(box.y * scale));
  const sw = Math.min(canvas.width - sx, Math.round(box.w * scale));
  const sh = Math.min(canvas.height - sy, Math.round(box.h * scale));
  if (sw < 8 || sh < 8) return null;
  const out = document.createElement("canvas");
  out.width = sw;
  out.height = sh;
  out.getContext("2d").drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  const blob = await new Promise((resolve) => out.toBlob(resolve, "image/png"));
  return blob ? { blob, width: sw, height: sh } : null;
}

/**
 * Render a crop of a page as a map picture, turned upright (browser only).
 * `frame` is `sceneFrame(recipe)` and the only authority on size and turn: the
 * crop is rendered into a canvas of the frame's cut size through an offset
 * viewport, so nothing outside the crop is painted, then drawn through the
 * frame's transform. WebP where the browser encodes it, PNG otherwise.
 *
 * @param {{x: number, y: number}} crop the recipe's crop, in page points
 * @param {{scale: number, cut: {w: number, h: number}, width: number, height: number}} frame
 * @param {number[]} matrix `turnMatrix(frame)`
 * @returns {Promise<{blob: Blob, width: number, height: number, ext: string}|null>}
 */
export async function extractPageMap(doc, pageNo, crop, frame, matrix) {
  if (typeof document === "undefined") return null;
  const page = await doc.getPage(pageNo);
  const vp = page.getViewport({ scale: frame.scale, offsetX: -crop.x * frame.scale, offsetY: -crop.y * frame.scale });
  const cut = document.createElement("canvas");
  cut.width = frame.cut.w;
  cut.height = frame.cut.h;
  // The print intent: a display render is paced by animation frames, which a
  // background tab is never given. The timeout race is longer than the
  // illustration crop's, since a map crop is several times its pixels.
  const task = page.render({ canvasContext: cut.getContext("2d"), viewport: vp, intent: "print" });
  const done = await Promise.race([
    task.promise.then(() => true),
    new Promise((r) => setTimeout(() => r(false), 90000)),
  ]);
  if (!done) {
    try {
      task.cancel();
    } catch {
      /* already settled */
    }
    return null;
  }
  const out = document.createElement("canvas");
  out.width = frame.width;
  out.height = frame.height;
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.setTransform(...matrix);
  ctx.drawImage(cut, 0, 0);
  const blob = await new Promise((resolve) => out.toBlob(resolve, "image/webp", 0.92));
  if (!blob) return null;
  return { blob, width: out.width, height: out.height, ext: blob.type === "image/webp" ? "webp" : "png" };
}

/**
 * Render a crop of a page to gray for a wall trace (browser only): one byte
 * per pixel, top-left first, at `scale` pixels to the page point and never
 * turned. Rendered with the print intent and raced against a timeout, as in
 * `extractPageMap`.
 *
 * @param {{x: number, y: number, w: number, h: number}} crop the recipe's crop, in page points
 * @returns {Promise<{gray: Uint8Array, width: number, height: number}|null>}
 */
export async function extractPageGray(doc, pageNo, crop, scale) {
  if (typeof document === "undefined") return null;
  const page = await doc.getPage(pageNo);
  const vp = page.getViewport({ scale, offsetX: -crop.x * scale, offsetY: -crop.y * scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(crop.w * scale);
  canvas.height = Math.round(crop.h * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const task = page.render({ canvasContext: ctx, viewport: vp, intent: "print" });
  const done = await Promise.race([
    task.promise.then(() => true),
    new Promise((r) => setTimeout(() => r(false), 90000)),
  ]);
  if (!done) {
    try {
      task.cancel();
    } catch {
      /* already settled */
    }
    return null;
  }
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const gray = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = (data[j] * 299 + data[j + 1] * 587 + data[j + 2] * 114 + 500) / 1000;
  return { gray, width: canvas.width, height: canvas.height };
}

/**
 * Extract the page illustration as a PNG blob (browser only; needs canvas).
 * Handles pdf.js bitmap images and raw RGB/RGBA/gray data.
 */
export async function extractPageArt(doc, pageNo, name = null) {
  if (typeof document === "undefined") return null;
  const infos = await pageArtInfo(doc, pageNo);
  // A shipped XObject name is a compile-time association and outranks the largest-image rule.
  const chosen = (name ? infos.find((i) => i.name === name) : null) ?? pickArt(infos);
  if (!chosen) return null;
  const { img, width, height } = chosen;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (img.bitmap) {
    ctx.drawImage(img.bitmap, 0, 0, width, height);
  } else if (img.data) {
    const rgba = new Uint8ClampedArray(width * height * 4);
    const d = img.data;
    if (img.kind === 3) {
      rgba.set(d.subarray(0, rgba.length));
    } else if (img.kind === 2) {
      for (let i = 0, j = 0; j < rgba.length; i += 3, j += 4) {
        rgba[j] = d[i];
        rgba[j + 1] = d[i + 1];
        rgba[j + 2] = d[i + 2];
        rgba[j + 3] = 255;
      }
    } else {
      return null; // exotic formats: recipe-direction territory
    }
    ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
  } else {
    return null;
  }
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  return blob ? { blob, width, height } : null;
}

/** Run one recipe against an open document. Returns prose string or null. */
export async function extractRecipe(doc, recipe) {
  if (recipe.page < 1 || recipe.page > doc.numPages) return null;
  const page = await pageItems(doc, recipe.page);
  return recipe.mode === "runin" ? extractRunin(page, recipe.heading) : extractDisplay(page, recipe.heading);
}
