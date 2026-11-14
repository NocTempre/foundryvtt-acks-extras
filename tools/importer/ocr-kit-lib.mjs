/**
 * The pure half of the OCR authoring kit (`ocr-kit.mjs`): token alignment,
 * column and heading geometry, stat-line detection, the pixel to page-point
 * map of a placed picture, and a PNG writer. Nothing here opens a PDF, starts
 * the engine or touches a disk, so the suite runs it on invented data.
 *
 * Dev-harness only; never shipped.
 */
import zlib from "node:zlib";

/* ------------------------------------------------------------------ tokens */

/**
 * The tokens a read and the oracle are compared on: lower case, apostrophes
 * dropped, split on anything that is not a letter, digit or plus sign; a
 * token of one character is kept only when it holds a digit.
 */
export function tokensOf(text) {
  return text.toLowerCase().replace(/['’]/g, "").split(/[^a-z0-9+]+/).filter((t) => t.length >= 2 || /\d/.test(t));
}

/** A superscript ordinal as the print sets it ("3rd"): a digit token the engine never reads whole. */
export const isOrdinal = (t) => /^\d+(st|nd|rd|th)$/.test(t);

/**
 * Align two token arrays by longest common subsequence. Returns `{ length,
 * wantOn, gotOn, wantPartner }`: which tokens of each side sit on the
 * alignment, and for each `want` index its partner's `got` index (-1 off it).
 * Ties in the backtrace go to skipping a `want` token first, as the
 * investigation's probes did, so scores stay comparable with theirs.
 */
export function alignTokens(want, got) {
  const n = want.length, m = got.length, w = m + 1;
  const d = new Uint16Array((n + 1) * w);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      d[i * w + j] = want[i - 1] === got[j - 1] ? d[(i - 1) * w + j - 1] + 1 : Math.max(d[(i - 1) * w + j], d[i * w + j - 1]);
    }
  }
  const wantOn = new Array(n).fill(false), gotOn = new Array(m).fill(false), wantPartner = new Array(n).fill(-1);
  for (let i = n, j = m; i > 0 && j > 0; ) {
    if (want[i - 1] === got[j - 1]) {
      wantOn[i - 1] = gotOn[j - 1] = true;
      wantPartner[i - 1] = j - 1;
      i--;
      j--;
    } else if (d[(i - 1) * w + j] >= d[i * w + j - 1]) i--;
    else j--;
  }
  return { length: d[n * w + m], wantOn, gotOn, wantPartner };
}

/**
 * The disagreements of an alignment as gaps: maximal runs between two matched
 * pairs where either side holds tokens the other lacks. Each gap is `{ want:
 * [lo, hi), got: [lo, hi) }`, half-open index ranges (either may be empty, not
 * both). A gap's `want` tokens are what the read lacks there; its `got` tokens
 * are what the oracle lacks.
 */
export function gapsOf(wantLen, gotLen, { wantOn, gotOn }) {
  const out = [];
  let i = 0, j = 0;
  while (i < wantLen || j < gotLen) {
    if (i < wantLen && j < gotLen && wantOn[i] && gotOn[j]) {
      i++;
      j++;
      continue;
    }
    const wi = i, gj = j;
    while (i < wantLen && !wantOn[i]) i++;
    while (j < gotLen && !gotOn[j]) j++;
    if (i > wi || j > gj) out.push({ want: [wi, i], got: [gj, j] });
  }
  return out;
}

/**
 * The tokens of a corrected read, each with the box and line it came from.
 * A line that ends in a hyphen whose next line opens with a lower-case letter
 * is joined to it, as a line-end word break; the joined word is one token at
 * the line it began on. Returns `{ tokens: [{ t, box, line }], joins }`.
 *
 * @param {string[]} boxText the corrected text of each box, lines separated by newlines
 */
export function readTokens(boxText) {
  const tokens = [];
  let joins = 0;
  boxText.forEach((text, box) => {
    const lines = text.split("\n").map((l) => l.split(/\s+/).filter(Boolean));
    lines.forEach((words, line) => {
      const last = words[words.length - 1];
      const next = lines[line + 1];
      if (last && last.length > 1 && last.endsWith("-") && next?.[0] && /^[a-z]/.test(next[0])) {
        words[words.length - 1] = last.slice(0, -1) + next.shift();
        joins++;
      }
      for (const word of words) for (const t of tokensOf(word)) tokens.push({ t, box, line });
    });
  });
  return { tokens, joins };
}

/** The `##` sections of the oracle, in file order, each its own text. */
export function oracleSections(markdown) {
  return markdown.split(/^(?=## )/m).filter((s) => s.startsWith("## "));
}

/** Cosine of two token bags, for telling which section a read belongs to without reading either. */
export function bagCosine(a, b) {
  const bag = (l) => l.reduce((m, t) => m.set(t, (m.get(t) ?? 0) + 1), new Map());
  const x = bag(a), y = bag(b);
  let dot = 0, nx = 0, ny = 0;
  for (const [t, c] of x) {
    nx += c * c;
    dot += c * (y.get(t) ?? 0);
  }
  for (const c of y.values()) ny += c * c;
  return nx && ny ? dot / Math.sqrt(nx * ny) : 0;
}

/**
 * Score a corrected read against an oracle section, in order and in both
 * directions. Returns the counts and the gaps, each gap with the read-side
 * location (`box`, `line`) of its first read token, or of the matched token
 * after it when the read has none there (`at: "before"`).
 *
 * @param {string[]} oracleTokens
 * @param {{t: string, box: number, line: number}[]} read from `readTokens`
 */
export function scoreRead(oracleTokens, read) {
  const got = read.map((r) => r.t);
  const align = alignTokens(oracleTokens, got);
  const gaps = gapsOf(oracleTokens.length, got.length, align).map((g) => {
    const first = g.got[0] < g.got[1] ? read[g.got[0]] : read[g.got[1]] ?? read[read.length - 1];
    const wantDigits = oracleTokens.slice(...g.want).filter((t) => /\d/.test(t)).length;
    const gotDigits = got.slice(...g.got).filter((t) => /\d/.test(t)).length;
    return { ...g, box: first?.box ?? -1, line: first?.line ?? -1, at: g.got[0] < g.got[1] ? "at" : "before", wantDigits, gotDigits };
  });
  const lacking = oracleTokens.filter((_, i) => !align.wantOn[i]);
  const extra = got.filter((_, i) => !align.gotOn[i]);
  const digit = (l) => l.filter((t) => /\d/.test(t));
  return {
    align,
    gaps,
    oracle: oracleTokens.length,
    read: got.length,
    matched: align.length,
    lacking: lacking.length,
    extra: extra.length,
    oracleDigits: digit(oracleTokens).length,
    lackingDigits: digit(lacking).length,
    lackingOrdinals: lacking.filter(isOrdinal).length,
    extraDigits: digit(extra).length,
  };
}

/* --------------------------------------------------------------- geometry */

/** The median of a number list (0 for none). */
export function median(list) {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

/** A histogram of values in buckets of `bucket`: `[{ from, to, count }]`, empty buckets left out. */
export function histogram(values, bucket = 2) {
  const counts = new Map();
  for (const v of values) {
    const b = Math.floor(v / bucket);
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => a[0] - b[0]).map(([b, count]) => ({ from: b * bucket, to: b * bucket + bucket - 1, count }));
}

/**
 * Column gutters: the x ranges strictly between two words' extents that no
 * span crosses and that are at least `minGap` wide. Margins before the first
 * span and after the last are not gutters. Returns `[{ x0, x1 }]` sorted.
 *
 * @param {{x0: number, x1: number}[]} spans one per word (or line)
 */
export function findGutters(spans, minGap = 12) {
  const s = [...spans].sort((a, b) => a.x0 - b.x0);
  const out = [];
  let reach = null;
  for (const { x0, x1 } of s) {
    if (reach === null) reach = x1;
    else if (x0 > reach) {
      if (x0 - reach >= minGap) out.push({ x0: reach, x1: x0 });
      reach = x1;
    } else reach = Math.max(reach, x1);
  }
  return out;
}

/**
 * The left edges of a page's text columns: peaks in the histogram of the lines'
 * left edges, tallest first, each at least `minSep` from one already taken and
 * holding at least `minLines` lines. A column's edge is the median left edge of
 * the lines within one bucket of its peak. Gutters between columns that stop at
 * different heights are not clean gaps in x, so the columns are found from
 * where their lines start. Returns the edges in ascending order.
 *
 * @param {{x0: number}[]} lines
 */
export function columnEdges(lines, { bucket = 10, minSep = 150, minLines = 3 } = {}) {
  const counts = new Map();
  for (const { x0 } of lines) counts.set(Math.floor(x0 / bucket), (counts.get(Math.floor(x0 / bucket)) ?? 0) + 1);
  const taken = [];
  for (const [b, count] of [...counts].sort((p, q) => q[1] - p[1] || p[0] - q[0])) {
    if (count < minLines) break;
    const centre = (b + 0.5) * bucket;
    if (taken.some((e) => Math.abs(e - centre) < minSep)) continue;
    taken.push(median(lines.filter((l) => Math.abs(l.x0 - centre) <= bucket).map((l) => l.x0)));
  }
  return taken.sort((a, b) => a - b);
}

/**
 * Box proposals from a whole read, in reading order: columns from where the
 * lines start (`columnEdges`), each column split before every run of tall lines
 * (heading candidates), full-width banner lines first when they sit above the
 * columns. A line belongs to the last column whose edge is at most `indent`
 * right of its start, and is a banner when it runs past the next column's edge
 * by more than `indent`. Returns `{ read: [{ box, psm }], notes }`; `notes`
 * names what was left for the author (a banner below the column text).
 *
 * @param {{x0: number, y0: number, x1: number, y1: number}[]} lines line boxes in source samples
 * @param {{width: number, height: number, tall?: number, minSep?: number, indent?: number, psm?: number, pad?: number}} opts
 */
export function proposeBoxes(lines, { width, height, tall = 1.2, minSep = 150, indent = 20, psm = 6, pad = 3 } = {}) {
  const med = median(lines.map((l) => l.y1 - l.y0));
  const isTall = (l) => l.y1 - l.y0 > tall * med;
  const edges = columnEdges(lines.filter((l) => !isTall(l)), { minSep });
  if (!edges.length) edges.push(0);
  const columnOf = (l) => Math.max(0, edges.findLastIndex((e) => e <= l.x0 + indent));
  const isBanner = (l) => {
    const next = edges[columnOf(l) + 1];
    return next !== undefined && l.x1 > next + indent;
  };
  const body = lines.filter((l) => !isBanner(l));
  const banners = lines.filter(isBanner).sort((a, b) => a.y0 - b.y0);
  const clamp = (v, hi) => Math.max(0, Math.min(hi, Math.round(v)));
  const rect = (group) => ({
    x0: clamp(Math.min(...group.map((l) => l.x0)) - pad, width),
    x1: clamp(Math.max(...group.map((l) => l.x1)) + pad, width),
    y0: clamp(Math.min(...group.map((l) => l.y0)) - pad, height),
    y1: clamp(Math.max(...group.map((l) => l.y1)) + pad, height),
  });
  const notes = [];
  const read = [];
  const top = body.length ? Math.min(...body.map((l) => l.y0)) : 0;
  let group = [];
  const flush = (into) => {
    if (group.length) into.push({ box: rect(group), psm });
    group = [];
  };
  const bannerBoxes = [];
  for (const l of banners) {
    if (group.length && l.y0 - group[group.length - 1].y1 > med) flush(bannerBoxes);
    group.push(l);
  }
  flush(bannerBoxes);
  for (const b of bannerBoxes) {
    if (b.box.y1 <= top + pad) read.push(b);
    else notes.push(`a banner of full-width lines at y ${b.box.y0}-${b.box.y1} sits below the column text; add its box by hand`);
  }
  edges.forEach((_, k) => {
    const mine = body.filter((l) => columnOf(l) === k).sort((a, b) => a.y0 - b.y0);
    let prev = null;
    for (const l of mine) {
      const opensHeading = isTall(l) && !(prev && isTall(prev) && l.y0 - prev.y1 < med);
      if (opensHeading) flush(read);
      group.push(l);
      prev = l;
    }
    flush(read);
  });
  return { read, notes };
}

/* ------------------------------------------------------------------- stats */

/** The stat keys `parseStatline` reads, as the print sets them; a key opens a clause or follows a comma, space or bracket. */
const STAT_KEY = /(?:^|[\s,;(])(#\s?A[TI1l]|AC|HD|hp|HP|MV|SV|ML|AL|XP|Dmg|Save)(?=[\s\d+-]|$)/g;

/** The distinct stat keys a line holds. */
export function statKeysOf(line) {
  return new Set([...line.matchAll(STAT_KEY)].map((m) => m[1].toUpperCase().replace(/\s/g, "")));
}

/**
 * Stat-block spans in a box's corrected lines: a line holding two or more
 * distinct stat keys is a stat line, and a line with one key beside a stat
 * line joins its block (an uncorrected read misspells keys and wraps blocks).
 * Returns `[{ from, to }]`, inclusive line indices.
 */
export function statBlocks(lines) {
  const counts = lines.map((l) => statKeysOf(l).size);
  const inBlock = counts.map((c) => c >= 2);
  for (let i = 0; i < lines.length; i++) {
    if (counts[i] === 1 && ((i > 0 && counts[i - 1] >= 2) || (i + 1 < lines.length && counts[i + 1] >= 2))) inBlock[i] = true;
  }
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!inBlock[i]) continue;
    const from = i;
    while (i + 1 < lines.length && inBlock[i + 1]) i++;
    out.push({ from, to: i });
  }
  return out;
}

/* ---------------------------------------------------- placement and pixels */

/** Compose two PDF matrices `[a b c d e f]`: apply `n` first, then `m`. */
export function mulMatrix(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/**
 * Where an upright sample pixel sits on the page. `top` is the picture's
 * placement matrix carried into the page's top-left-origin points (the
 * painting CTM composed with the viewport's own transform); the picture is the
 * unit square with its first row at the top, so a continuous sample coordinate
 * `(px, py)` in a `width` by `height` picture is `(px / width, 1 - py / height)`
 * before the matrix. A pixel's centre is `+0.5`.
 */
export function pixelToPoint(top, width, height, px, py) {
  const u = px / width, v = 1 - py / height;
  return [top[0] * u + top[2] * v + top[4], top[1] * u + top[3] * v + top[5]];
}

/** The inverse of `pixelToPoint`. Throws on a singular placement. */
export function pointToPixel(top, width, height, x, y) {
  const det = top[0] * top[3] - top[1] * top[2];
  if (!det) throw new Error("the placement matrix is singular");
  const dx = x - top[4], dy = y - top[5];
  const u = (top[3] * dx - top[2] * dy) / det;
  const v = (-top[1] * dx + top[0] * dy) / det;
  return [u * width, (1 - v) * height];
}

/**
 * The quarter turns, counter-clockwise on screen, that stand the printed
 * picture upright: 0 when its pixel axes run right and down the page, 1 when
 * the x axis runs down and the y axis left, 2 reversed, 3 when the x axis runs
 * up and the y axis right (the frame `scene-binding.mjs` `sceneFrame` turns
 * by). Null for a mirrored or skewed placement, which no turn undoes.
 */
export function turnOf(top, width, height) {
  const o = pixelToPoint(top, width, height, 0, 0);
  const ex = pixelToPoint(top, width, height, width, 0);
  const ey = pixelToPoint(top, width, height, 0, height);
  const ax = [ex[0] - o[0], ex[1] - o[1]], ay = [ey[0] - o[0], ey[1] - o[1]];
  const near = (v, dir, tol = 1e-6) => {
    const len = Math.hypot(v[0], v[1]);
    return len > 0 && Math.abs(v[0] / len - dir[0]) < tol && Math.abs(v[1] / len - dir[1]) < tol;
  };
  const table = [[[1, 0], [0, 1]], [[0, 1], [-1, 0]], [[-1, 0], [0, -1]], [[0, -1], [1, 0]]];
  const turn = table.findIndex(([dx, dy]) => near(ax, dx) && near(ay, dy));
  return turn < 0 ? null : turn;
}

/** The axis-aligned page rectangle `{x, y, w, h}` of a pixel rectangle `[x0, y0, x1, y1]` of an upright quarter-turn placement. */
export function pixelRectToPage(top, width, height, [x0, y0, x1, y1]) {
  const a = pixelToPoint(top, width, height, x0, y0), b = pixelToPoint(top, width, height, x1, y1);
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) };
}

/* --------------------------------------------------------------------- PNG */

/** The CRC-32 table of the PNG chunk checksum. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 of a byte array, as an unsigned integer. */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** One PNG chunk: length, type, data, CRC over type and data. */
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** The eight bytes every PNG file opens with. */
export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * An 8-bit RGB PNG of `rgb` (three bytes per pixel, rows top to bottom),
 * every row unfiltered and the pixel data deflated in one IDAT chunk.
 */
export function encodePng(rgb, width, height) {
  if (rgb.length !== width * height * 3) throw new Error("the pixel buffer does not match the size");
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head[8] = 8;
  head[9] = 2;
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1);
  }
  return Buffer.concat([PNG_SIGNATURE, chunk("IHDR", head), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/**
 * The upright pixels of a pdf.js image object in a rectangle, as RGB, each
 * source pixel repeated `scale` times in both directions. The rectangle
 * `[x0, y0, x1, y1]` is clamped to the picture; throws when nothing is left.
 */
export function cropRgb({ width, height, kind, data }, [x0, y0, x1, y1], scale = 2) {
  const cx0 = Math.max(0, Math.floor(x0)), cy0 = Math.max(0, Math.floor(y0));
  const cx1 = Math.min(width, Math.ceil(x1)), cy1 = Math.min(height, Math.ceil(y1));
  const w = cx1 - cx0, h = cy1 - cy0;
  if (!(w > 0 && h > 0)) throw new Error("the rectangle lies outside the picture");
  const out = new Uint8Array(w * scale * h * scale * 3);
  const step = kind === 2 ? 3 : kind === 3 ? 4 : 0;
  const rowBytes = (width + 7) >> 3;
  for (let y = 0; y < h * scale; y++) {
    const sy = cy0 + Math.floor(y / scale);
    for (let x = 0; x < w * scale; x++) {
      const sx = cx0 + Math.floor(x / scale);
      const o = (y * w * scale + x) * 3;
      if (step) {
        const i = (sy * width + sx) * step;
        out[o] = data[i];
        out[o + 1] = data[i + 1];
        out[o + 2] = data[i + 2];
      } else {
        const on = data[sy * rowBytes + (sx >> 3)] & (128 >> (sx & 7)) ? 255 : 0;
        out[o] = out[o + 1] = out[o + 2] = on;
      }
    }
  }
  return { rgb: out, width: w * scale, height: h * scale };
}
