#!/usr/bin/env node
/**
 * DEV-ONLY: the picture census of a LOCAL book, the ordinals a book's art
 * recipe (`scripts/importer/books/<id>/book-art.mjs`) names its pictures by.
 *
 *   node tools/importer/census-art.mjs <book> --out <dir> [--verdict <json>]
 *
 * Reads every page through pdf.js (`openPinned`, `pageArtPlacements`,
 * `pageObject`): each placed picture's box, decoded size, soft mask (pdf.js
 * kind 3) and aspect. Classifies each placement by these rules, in order:
 *
 *   furniture  the same picture (by its samples) painted on 3 or more pages,
 *              or a picture of such a picture's pixel size;
 *   off-page   under half of the placement lies on the page;
 *   cover      95% or more of the page;
 *   strip      placed aspect 3 or more;
 *   small      under 2% of the page;
 *   full-page  over 50% of the page;
 *   wide       wider than 420 pt;
 *   column     everything else.
 *
 * Column, wide, full-page and strip are the candidates. Ordinals run in page
 * order, then top, then left (each rounded to 0.1 pt), so an ordinal never moves while the printing
 * stays the same. A candidate lists the `kind.magicItem` entry ids of the
 * book's committed cookbook whose `pages` hold its page.
 *
 * Writes to `--out` (outside the repo, never in it): `census.json`, each
 * candidate's decoded picture as `crops/<book>-art<n>.png`, and contact sheets
 * `contact-<k>.png` labelled by ordinal. `--verdict <json>` takes
 * `{rows: [{n, uses} | {n, page, crop, uses}]}` (ordinals, ids and boxes only)
 * and prints the `BOOK_ART` rows to paste, reusing `<out>/census.json` when it
 * exists. Holds no book fact; prints ordinals, pages, sizes and counts only.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { openPinned, KIND } from "../../scripts/importer/ocr.mjs";
import { pageArtPlacements, pageObject } from "../../scripts/importer/extract.mjs";
import { FILES } from "./reference-lib.mjs";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The classes that make a candidate. */
export const CANDIDATE_CLASSES = Object.freeze(["column", "wide", "full-page", "strip"]);

const r1 = (v) => Math.round(v * 10) / 10;

/** The share of a placement `{x, y, w, h}` that lies on a page of `pw` by `ph`. */
const onPage = (p, pw, ph) => {
  const w = Math.max(0, Math.min(p.x + p.w, pw) - Math.max(p.x, 0));
  const h = Math.max(0, Math.min(p.y + p.h, ph) - Math.max(p.y, 0));
  return { area: w * h, share: p.w * p.h > 0 ? (w * h) / (p.w * p.h) : 0 };
};

/**
 * Each placement's class by the header's rules, given every placement of the
 * book as `{page, pw, ph, x, y, w, h, width, height, hash}`. Pure.
 */
export function classify(all) {
  const pagesOf = new Map();
  for (const p of all) {
    if (!pagesOf.has(p.hash)) pagesOf.set(p.hash, new Set());
    pagesOf.get(p.hash).add(p.page);
  }
  const furnitureSizes = new Set(all.filter((p) => pagesOf.get(p.hash).size >= 3).map((p) => `${p.width}x${p.height}`));
  return all.map((p) => {
    const pageArea = p.pw * p.ph;
    const { area, share } = onPage(p, p.pw, p.ph);
    const aspect = Math.max(p.w / p.h, p.h / p.w);
    let cls;
    if (furnitureSizes.has(`${p.width}x${p.height}`)) cls = "furniture";
    else if (share < 0.5) cls = "off-page";
    else if (area >= 0.95 * pageArea) cls = "cover";
    else if (aspect >= 3) cls = "strip";
    else if (area < 0.02 * pageArea) cls = "small";
    else if (area > 0.5 * pageArea) cls = "full-page";
    else if (p.w > 420) cls = "wide";
    else cls = "column";
    return { ...p, cls, aspect };
  });
}

/** Candidates in census order (page, top, left), numbered from 1. Pure. */
export function ordinals(classified) {
  return classified
    .filter((p) => CANDIDATE_CLASSES.includes(p.cls))
    .sort((a, b) => a.page - b.page || r1(a.y) - r1(b.y) || r1(a.x) - r1(b.x))
    .map((p, i) => ({ ...p, n: i + 1 }));
}

/* ------------------------------------------------------------------ PNG */

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

/** An RGBA buffer as PNG bytes. */
function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** A pdf.js image object's samples as RGBA, or null for a kind it does not decode here. */
function toRgba({ width, height, kind, data }) {
  const out = new Uint8Array(width * height * 4);
  if (kind === KIND.RGBA_32BPP) out.set(data.subarray(0, out.length));
  else if (kind === KIND.RGB_24BPP) {
    for (let i = 0, j = 0; j < out.length; i += 3, j += 4) out.set([data[i], data[i + 1], data[i + 2], 255], j);
  } else if (kind === KIND.GRAYSCALE_1BPP) {
    const row = (width + 7) >> 3;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const v = data[y * row + (x >> 3)] & (128 >> (x & 7)) ? 255 : 0;
        out.set([v, v, v, 255], (y * width + x) * 4);
      }
  } else return null;
  return out;
}

/** Digits 0-9 as 3x5 bitmaps, for the contact sheet's labels. */
const DIGITS = ["111101101101111", "010110010010111", "111001111100111", "111001111001111", "101101111001001", "111100111001111", "111100111101111", "111001001001001", "111101111101111", "111101111001111"];

/** Draws `text` (digits) at `(x0, y0)` into an RGBA sheet `width` wide, at `k` pixels per dot. */
function label(sheet, width, text, x0, y0, k = 4) {
  [...String(text)].forEach((ch, i) => {
    const bits = DIGITS[+ch];
    for (let r = 0; r < 5; r++)
      for (let c = 0; c < 3; c++) {
        if (bits[r * 3 + c] !== "1") continue;
        for (let dy = 0; dy < k; dy++)
          for (let dx = 0; dx < k; dx++) sheet.set([200, 0, 0, 255], ((y0 + r * k + dy) * width + x0 + i * 4 * k + c * k + dx) * 4);
      }
  });
}

/** Contact sheets of `items` `{n, w, h, rgba}`, `per` to a sheet, each picture fit to a `cell` square. */
function contactSheets(items, { per = 30, cols = 6, cell = 220 } = {}) {
  const sheets = [];
  for (let s = 0; s < items.length; s += per) {
    const batch = items.slice(s, s + per);
    const rows = Math.ceil(batch.length / cols);
    const W = cols * cell;
    const H = rows * (cell + 26);
    const sheet = new Uint8Array(W * H * 4).fill(255);
    batch.forEach((it, i) => {
      const ox = (i % cols) * cell;
      const oy = Math.floor(i / cols) * (cell + 26);
      label(sheet, W, it.n, ox + 4, oy + 2);
      const f = Math.min((cell - 8) / it.w, (cell - 8) / it.h);
      const tw = Math.max(1, Math.floor(it.w * f));
      const th = Math.max(1, Math.floor(it.h * f));
      for (let y = 0; y < th; y++)
        for (let x = 0; x < tw; x++) {
          const sx = Math.min(it.w - 1, Math.floor(x / f));
          const sy = Math.min(it.h - 1, Math.floor(y / f));
          const si = (sy * it.w + sx) * 4;
          const a = it.rgba[si + 3] / 255;
          const di = ((oy + 26 + y) * W + ox + 4 + x) * 4;
          for (let c = 0; c < 3; c++) sheet[di + c] = Math.round(it.rgba[si + c] * a + 255 * (1 - a));
        }
    });
    sheets.push(png(W, H, sheet));
  }
  return sheets;
}

/* ------------------------------------------------------------------ census */

/** The entry ids of each page among the book's committed `kind.magicItem` entries. */
function entriesByPage(book) {
  const file = path.join(REPO, "cookbook", `${book}.json`);
  const map = new Map();
  if (!fs.existsSync(file)) return map;
  for (const [id, e] of Object.entries(JSON.parse(fs.readFileSync(file, "utf8")).entries ?? {})) {
    if (e?.kind !== "kind.magicItem") continue;
    for (const p of e.pages ?? []) {
      if (!map.has(p)) map.set(p, []);
      map.get(p).push(id);
    }
  }
  return map;
}

/** Reads the book; returns the census and writes crops and contact sheets under `out`. */
async function census(book, out) {
  const doc = await openPinned(fs.readFileSync(FILES[book]));
  const all = [];
  const t0 = Date.now();
  for (let page = 1; page <= doc.numPages; page++) {
    const pg = await doc.getPage(page);
    const vp = pg.getViewport({ scale: 1 });
    const placements = await pageArtPlacements(doc, page);
    for (const p of placements) {
      const img = await pageObject(pg, p.name, 10000);
      if (!img) {
        all.push({ page, pw: vp.width, ph: vp.height, x: p.x, y: p.y, w: p.w, h: p.h, width: 0, height: 0, kind: 0, hash: `missing:${page}:${p.name}` });
        continue;
      }
      const hash = crypto.createHash("sha1").update(img.data ?? Buffer.alloc(0)).update(`${img.width}x${img.height}`).digest("hex");
      all.push({ page, pw: vp.width, ph: vp.height, x: p.x, y: p.y, w: p.w, h: p.h, width: img.width, height: img.height, kind: img.kind, hash, name: p.name });
    }
    if (page % 25 === 0) process.stderr.write(`census-art: page ${page}/${doc.numPages}, ${Math.round((Date.now() - t0) / 1000)} s, ${all.filter((p) => !p.width).length} missing
`);
  }
  const classified = classify(all);
  const counts = {};
  for (const p of classified) counts[p.cls] = (counts[p.cls] ?? 0) + 1;
  const byPage = entriesByPage(book);
  const cands = ordinals(classified);
  fs.mkdirSync(path.join(out, "crops"), { recursive: true });
  const thumbs = [];
  for (const c of cands) {
    const pg = await doc.getPage(c.page);
    await pg.getOperatorList();
    const img = await pageObject(pg, c.name, 10000);
    const rgba = img ? toRgba(img) : null;
    if (rgba) {
      fs.writeFileSync(path.join(out, "crops", `${book}-art${c.n}.png`), png(img.width, img.height, rgba));
      thumbs.push({ n: c.n, w: img.width, h: img.height, rgba });
    }
  }
  contactSheets(thumbs).forEach((buf, i) => fs.writeFileSync(path.join(out, `contact-${i + 1}.png`), buf));
  const candidates = cands.map((c) => ({
    n: c.n,
    page: c.page,
    box: { x: r1(c.x), y: r1(c.y), w: r1(c.w), h: r1(c.h) },
    size: { w: c.width, h: c.height },
    softMask: c.kind === KIND.RGBA_32BPP,
    aspect: Math.round(c.aspect * 100) / 100,
    class: c.cls,
    entries: byPage.get(c.page) ?? [],
  }));
  const result = { book, pages: doc.numPages, counts, candidates };
  fs.writeFileSync(path.join(out, "census.json"), JSON.stringify(result, null, 1) + "\n");
  await doc.loadingTask.destroy();
  return result;
}

/** The `BOOK_ART` rows a verdict names, as source text to paste. */
export function verdictRows(result, verdict) {
  const byN = new Map(result.candidates.map((c) => [c.n, c]));
  const lines = [];
  for (const v of verdict.rows ?? []) {
    const uses = JSON.stringify(v.uses);
    if (v.crop) {
      const c = v.crop;
      lines.push(`  { n: ${v.n}, page: ${v.page}, crop: { x0: ${c.x0}, y0: ${c.y0}, x1: ${c.x1}, y1: ${c.y1} }, uses: ${uses} },`);
      continue;
    }
    const c = byN.get(v.n);
    if (!c) throw new Error(`the verdict names art${v.n}, which is no candidate`);
    lines.push(`  { n: ${c.n}, page: ${c.page}, box: { x: ${c.box.x}, y: ${c.box.y}, w: ${c.box.w}, h: ${c.box.h} }, size: { w: ${c.size.w}, h: ${c.size.h} }, uses: ${uses} },`);
  }
  return lines.map((l) => l.replace(/"(\w+)":/g, "$1: ").replace(/,(\S)/g, ", $1").replace(/\{(\S)/g, "{ $1").replace(/(\S)\}/g, "$1 }"));
}

async function main(argv) {
  const book = argv[0];
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i > 0 ? argv[i + 1] : null;
  };
  const out = flag("--out");
  const verdictFile = flag("--verdict");
  if (!book || !out) {
    console.error("usage: census-art.mjs <book> --out <dir> [--verdict <json>]");
    process.exit(2);
  }
  if (path.resolve(out).toLowerCase().startsWith(path.resolve(REPO).toLowerCase())) {
    console.error("census-art: --out must lie outside the repo");
    process.exit(2);
  }
  const cached = path.join(out, "census.json");
  let result;
  if (verdictFile && fs.existsSync(cached)) result = JSON.parse(fs.readFileSync(cached, "utf8"));
  else {
    if (!FILES[book] || !fs.existsSync(FILES[book])) {
      console.error(`census-art: the local copy of ${book} is not on this machine`);
      process.exit(2);
    }
    fs.mkdirSync(out, { recursive: true });
    result = await census(book, out);
    console.log(`census-art ${book}: ${result.pages} pages, ${result.candidates.length} candidates`);
    console.log(Object.entries(result.counts).map(([k, v]) => `${k} ${v}`).join(", "));
    console.log(`soft-masked candidates: ${result.candidates.filter((c) => c.softMask).length}`);
  }
  if (verdictFile) {
    const verdict = JSON.parse(fs.readFileSync(verdictFile, "utf8"));
    console.log("export const BOOK_ART = Object.freeze([");
    for (const line of verdictRows(result, verdict)) console.log(line);
    console.log("]);");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
