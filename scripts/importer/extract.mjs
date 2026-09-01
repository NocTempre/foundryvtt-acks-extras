/**
 * PDF text extraction engine (pdf.js) — column-first reconstruction validated
 * against the real ACKS II PDFs in a Node harness before shipping.
 *
 * Runs identically in the browser (Foundry client) and Node (tools/test
 * harness): the worker is only wired up when the module boots in Foundry
 * (setWorker below); under Node pdf.js falls back to its fake worker.
 *
 * Nothing here persists — callers receive plain strings and decide caching.
 */
import { getDocument, GlobalWorkerOptions, OPS } from "../../vendor/pdfjs/pdf.mjs";

const HEADING_MIN_H = 12; // display headings are >=14pt; body is 9-10pt
const FOOTER_BAND = 32; // pt from page bottom: folios + DTRPG watermark line

export function setWorker(url) {
  GlobalWorkerOptions.workerSrc = url;
}

/**
 * Where the wasm image decoders live (openjpeg/jbig2/qcms). The AX books
 * embed their illustrations as JPEG2000, which pdf.js can only decode through
 * these; without them the image objects never resolve and a page render that
 * needs one hangs. Browser-only (the module sets it at boot); the offline
 * tools never decode pixels.
 */
let WASM_URL = null;
export function setWasmUrl(url) {
  WASM_URL = url;
}

export async function openBook(data) {
  const doc = await getDocument({
    data: new Uint8Array(data),
    useSystemFonts: true,
    ...(WASM_URL ? { wasmUrl: WASM_URL } : {}),
  }).promise;
  const meta = await doc.getMetadata().catch(() => null);
  return { doc, numPages: doc.numPages, title: meta?.info?.Title ?? "" };
}

/** All positioned text items of a page (top-origin y), footers filtered. */
export async function pageItems(doc, pageNo) {
  const page = await doc.getPage(pageNo);
  const vp = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  // Faux-bold section headings are DOUBLE-STRUCK: the same glyph painted twice
  // at the same coordinates ("eencountersncounters", "Black BlobBlack Blob").
  // Drop exact (str,x,y) coincident duplicates so headings read once — this
  // must run identically here for compiler and runtime so boxes still line up.
  const seen = new Set();
  const items = content.items
    .filter((it) => typeof it.str === "string" && it.str.trim())
    .map((it) => ({
      str: it.str,
      x: it.transform[4],
      y: vp.height - it.transform[5],
      w: it.width,
      h: it.height,
      alias: it.fontName,
    }))
    .filter((it) => it.y < vp.height - FOOTER_BAND && !/Order #\d+/.test(it.str))
    .filter((it) => {
      const key = `${it.str}|${it.x.toFixed(1)}|${it.y.toFixed(1)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return { items, width: vp.width, height: vp.height };
}

/**
 * Ordered text runs containing any of the given codepoints, with their fill
 * colors, from the page's operator list. MECHANICAL (no judgment): stream
 * order is deterministic per printing; run indexes are stable because only
 * runs containing the target codepoints are counted (per-customer watermark
 * text never contains PUA glyphs). Used by the executor's glyphColor
 * instruction and by the compiler to choose pick indexes.
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

/** Column left edges from a histogram of body-item x origins (1-3 columns). */
export function detectColumns(items) {
  const body = items.filter((it) => it.h < HEADING_MIN_H);
  const bins = {};
  for (const it of body) {
    const bin = Math.round(it.x / 10) * 10;
    bins[bin] = (bins[bin] || 0) + 1;
  }
  const peaks = Object.entries(bins)
    .map(([x, n]) => ({ x: +x, n }))
    .filter((b) => b.n > body.length * 0.08)
    .sort((a, b) => a.x - b.x);
  const cols = [];
  for (const p of peaks) {
    if (cols.length && p.x - cols[cols.length - 1] < 40) continue;
    cols.push(p.x);
  }
  return cols.length ? cols : [0];
}

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
 * display headings plus run-in candidates (line-initial "Name:" body items).
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
  // Collect same-column segments; a parent heading (e.g. "STATUE, ANIMATED"
  // directly over its variant "BRONZE") may own almost no prose of its own, so
  // keep extending past sub-headings until enough text accumulates.
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
 * Run-in mode: the entry heading is body-size bold ("Grappling Hook:"). Find
 * it by text, learn the bold font's alias FROM the match (self-calibrating —
 * pdf.js aliases are per-document, so nothing is hardcoded), then collect
 * until the next line-initial item with that same alias (= next entry).
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
 * Spoils subsection: a bold run-in "Spoils" header followed by component
 * bullets like "beak (2 3/6 st, 150gp, sharpness, striking, swift sword)".
 * Self-calibrating like extractRunin. Returns [{name, weight6, cost, effects}].
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
  for (const m of text.matchAll(/([A-Za-z][A-Za-z' -]*?)\s*\((\d+)(?:\s*(\d)\/6)?\s*st,\s*([\d,]+)\s*gp(?:,\s*([^)]+))?\)/g)) {
    const stone = parseInt(m[2], 10); // book weights are authoritative as printed
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
    // Timeout-guarded: Node's fake pdf.js worker can stall object delivery on
    // pages after the first (the browser's real worker resolves normally) —
    // never hang, just report the image as unavailable.
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
 * Placed image rectangles from the page's operator list — a PURE operator walk
 * (no object delivery, so it cannot stall under Node's fake worker; the same
 * reason glyphColorRuns is safe offline). Top-origin y like pageItems. The
 * offline compiler uses PLACEMENT to associate an entry with the illustration
 * printed inside its claimed region; pixel dimensions are irrelevant to that
 * judgment.
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
 * Extract the page illustration as a PNG blob (browser only — needs canvas).
 * Handles pdf.js bitmap images and raw RGB/RGBA/gray data.
 */
/**
 * Extract a REGION of the rendered page as a PNG blob (browser only). Used
 * when the cookbook ships a placement box: rendering sidesteps XObject
 * delivery entirely (the AX PDFs paint their illustrations inside Form
 * XObjects, whose image objects never register on page.objs), and the crop is
 * exactly what the printed page shows at that spot.
 */
export async function extractPageArtRegion(doc, pageNo, box) {
  if (typeof document === "undefined") return null;
  const page = await doc.getPage(pageNo);
  const scale = 2;
  const vp = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = vp.width;
  canvas.height = vp.height;
  // Race a hard timeout: a render that waits on an undecodable image (a wasm
  // decoder missing on this seat) must degrade to "no art", never hang the
  // import.
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

export async function extractPageArt(doc, pageNo, name = null) {
  if (typeof document === "undefined") return null;
  const infos = await pageArtInfo(doc, pageNo);
  // A shipped XObject name is a compile-time ASSOCIATION (this entry's own
  // illustration on a multi-entry page) and outranks the largest-image rule.
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
