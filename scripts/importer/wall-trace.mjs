/**
 * Walls read off a plan's own picture at import: the Foundry-free half.
 *
 * A recipe's `walls` block names a tracer `mode`, the gray `threshold` it cuts
 * at, and a short list of `corrections`. The lattice is the recipe's own
 * square `grid`, measured off the page like the rest of the recipe. The
 * importer renders the crop of the Judge's page to gray at `TRACE_PITCH`
 * pixels to the drawn cell and hands it here. What comes back is wall
 * segments in page points, which the scene carries through the same frame as
 * its picture. No traced geometry ships: a correction is an assertion about
 * one cell, one cell edge or one island, and the cap keeps them a small share
 * of the plan.
 *
 * Three modes, for three ways a plan is drawn:
 * - `grid`: dark rock and light floor on the drawn squares. Each cell is
 *   classed by its floor share, walls run on the cell edges between floor and
 *   rock, and a one-cell throat is read for a door by the ink across it.
 * - `contour`: the same rock and floor, with walls on the floor's own
 *   outline. This mode is for caves, which follow no lattice.
 * - `stroke`: light wall strokes on a dark floor, thinned to their centre
 *   lines.
 *
 * Every size below is a share of the drawn cell, so a trace reads the same
 * plan the same way at any render scale.
 */

/** The tracer modes a recipe's `walls.mode` may name. */
export const WALL_MODES = Object.freeze(["grid", "contour", "stroke"]);

/** How many pixels one drawn cell spans in the gray render a trace reads. */
export const TRACE_PITCH = 50;

/** The share of a plan's lattice cells its corrections may number. */
export const CORRECTION_SHARE = 0.05;

/** The largest gray render a trace accepts, in pixels; past this the box sums overflow. */
const MAX_TRACE_PIXELS = 16_000_000;

/** What a correction may assert of a cell, of a cell edge, and of an island, per mode. */
const CELL_STATES = Object.freeze({
  grid: ["floor", "solid", "door", "secret", "open"],
  contour: ["floor", "solid", "door", "secret", "open"],
  stroke: ["open"],
});
const EDGE_STATES = Object.freeze(["wall", "door", "secret", "open"]);
const EDGE_SIDES = Object.freeze(["n", "w"]);

/** Core's `WALL_DOOR_TYPES`, spelled out because this file loads without Foundry. */
const DOOR = Object.freeze({ none: 0, door: 1, secret: 2 });

/** A pixel darker than this is ink: a label's ring, a door's outline, a symbol. */
const INK = 128;

/** A pixel at least this light is the paper inside a door drawn across a rock band. */
const PAPER = 160;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isInt = (v) => Number.isInteger(v);

/**
 * The lattice a recipe's walls are traced and corrected on, in page points:
 * the first grid line at or inside the crop's top-left corner (`x0`, `y0`),
 * the drawn cell's width and height (`px`, `py`), and how many WHOLE cells the
 * crop spans each way. Cell `[0, 0]` is the whole cell at that corner; a
 * partial cell along the crop's edge is no cell. Null without a square grid.
 * @returns {{x0: number, y0: number, px: number, py: number, cols: number, rows: number}|null}
 */
export function wallLattice(recipe) {
  const grid = recipe?.grid;
  const crop = recipe?.crop;
  const px = Number(grid?.box?.w);
  const py = Number(grid?.box?.h);
  const c = grid?.centre;
  if (grid?.family !== "square" || !(px > 0) || !(py > 0) || !Array.isArray(c) || !c.every(isNum) || !crop) return null;
  const firstLine = (centre, pitch, from) => {
    const line = centre - pitch / 2;
    return line + Math.ceil((from - line) / pitch - 1e-9) * pitch;
  };
  const x0 = firstLine(c[0], px, crop.x);
  const y0 = firstLine(c[1], py, crop.y);
  const cols = Math.max(0, Math.floor((crop.x + crop.w - x0) / px + 1e-9));
  const rows = Math.max(0, Math.floor((crop.y + crop.h - y0) / py + 1e-9));
  return { x0, y0, px, py, cols, rows };
}

/** How many corrections a lattice allows: `CORRECTION_SHARE` of its cells, rounded down. */
export const correctionCap = (lattice) => Math.floor(CORRECTION_SHARE * (lattice?.cols ?? 0) * (lattice?.rows ?? 0));

/** One correction's identity, so a cell, an edge or an island is asserted once. */
const correctionKey = (k) => (k.cell ? `cell:${k.cell.join(",")}` : k.edge ? `edge:${k.edge.join(",")}` : `at:${(k.at ?? []).join(",")}`);

/**
 * Everything wrong with a recipe's `walls` block, as sentences prefixed
 * `walls`; empty when it holds together. The recipe must carry a square grid,
 * because the corrections are read on its lattice. Corrections are checked
 * against that lattice and the cap, so a row that needs more corrections than
 * `CORRECTION_SHARE` of its cells is refused wherever `recipeProblems` runs.
 */
export function wallsProblems(walls, recipe) {
  if (!walls || typeof walls !== "object" || Array.isArray(walls)) return ["walls must be an object"];
  const out = [];
  for (const k of Object.keys(walls)) if (!["mode", "threshold", "corrections", "note"].includes(k)) out.push(`walls has an unknown key "${k}"`);
  if (!WALL_MODES.includes(walls.mode)) out.push(`walls.mode must be ${WALL_MODES.join(", ")}`);
  if (!isInt(walls.threshold) || walls.threshold < 1 || walls.threshold > 254) out.push("walls.threshold must be a whole gray level from 1 to 254");
  const lattice = wallLattice(recipe);
  if (!lattice) return [...out, "walls need a square grid to trace on"];
  if (!lattice.cols || !lattice.rows) return [...out, "walls: the crop spans no whole cell of the grid"];
  const list = walls.corrections ?? [];
  if (!Array.isArray(list)) return [...out, "walls.corrections must be a list"];
  const cap = correctionCap(lattice);
  if (list.length > cap) {
    out.push(`walls.corrections number ${list.length}, over the cap of ${cap} (${CORRECTION_SHARE * 100}% of ${lattice.cols}x${lattice.rows} cells); a plan that needs more is left wall-less`);
  }
  const cellStates = CELL_STATES[walls.mode] ?? [];
  const seen = new Set();
  list.forEach((k, i) => {
    const where = `walls.corrections[${i}]`;
    if (!k || typeof k !== "object" || Array.isArray(k)) return void out.push(`${where} must be an object`);
    const forms = ["cell", "edge", "at"].filter((f) => k[f] !== undefined);
    if (forms.length !== 1) return void out.push(`${where} names exactly one of cell, edge or at`);
    const allowed = forms[0] === "at" ? ["at", "drop"] : [forms[0], "is"];
    for (const key of Object.keys(k)) if (!allowed.includes(key)) out.push(`${where} has an unknown key "${key}"`);
    if (k.cell !== undefined) {
      const [c, r] = Array.isArray(k.cell) ? k.cell : [];
      if (!Array.isArray(k.cell) || k.cell.length !== 2 || !isInt(c) || !isInt(r)) return void out.push(`${where}.cell must be [column, row]`);
      if (c < 0 || r < 0 || c >= lattice.cols || r >= lattice.rows) out.push(`${where}.cell [${c}, ${r}] lies outside the ${lattice.cols}x${lattice.rows} lattice`);
      if (!cellStates.includes(k.is)) out.push(`${where}.is must be ${cellStates.join(", ")} for a cell in ${walls.mode} mode`);
    } else if (k.edge !== undefined) {
      const [c, r, side] = Array.isArray(k.edge) ? k.edge : [];
      if (!Array.isArray(k.edge) || k.edge.length !== 3 || !isInt(c) || !isInt(r) || !EDGE_SIDES.includes(side)) {
        return void out.push(`${where}.edge must be [column, row, "n" or "w"]`);
      }
      const maxC = side === "w" ? lattice.cols : lattice.cols - 1;
      const maxR = side === "n" ? lattice.rows : lattice.rows - 1;
      if (c < 0 || r < 0 || c > maxC || r > maxR) out.push(`${where}.edge [${c}, ${r}, "${side}"] lies outside the lattice`);
      if (!EDGE_STATES.includes(k.is)) out.push(`${where}.is must be ${EDGE_STATES.join(", ")} for an edge`);
    } else {
      const crop = recipe.crop;
      if (!Array.isArray(k.at) || k.at.length !== 2 || !k.at.every(isNum)) return void out.push(`${where}.at must be [x, y]`);
      if (k.at[0] < crop.x || k.at[1] < crop.y || k.at[0] > crop.x + crop.w || k.at[1] > crop.y + crop.h) out.push(`${where}.at lies outside the crop`);
      if (k.drop !== "island") out.push(`${where}.drop must be "island"`);
    }
    const key = correctionKey(k);
    if (seen.has(key)) out.push(`${where} asserts ${key} a second time`);
    seen.add(key);
  });
  return out;
}

/* ---------------------------------------------------------------------------
 * Raster primitives over a Uint8Array mask of `w * h`.
 * ------------------------------------------------------------------------- */

/** 4-connected components of the pixels of one value: a label per pixel and each component's area and box. */
function components(mask, w, h, value) {
  const N = w * h;
  const lab = new Int32Array(N).fill(-1);
  const stack = new Int32Array(N);
  const comps = [];
  for (let i = 0; i < N; i++) {
    if (mask[i] !== value || lab[i] !== -1) continue;
    const id = comps.length;
    let sp = 0;
    stack[sp++] = i;
    lab[i] = id;
    let area = 0, minx = w, miny = h, maxx = 0, maxy = 0;
    while (sp) {
      const p = stack[--sp];
      area++;
      const x = p % w, y = (p / w) | 0;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
      if (x > 0 && mask[p - 1] === value && lab[p - 1] === -1) { lab[p - 1] = id; stack[sp++] = p - 1; }
      if (x < w - 1 && mask[p + 1] === value && lab[p + 1] === -1) { lab[p + 1] = id; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - w] === value && lab[p - w] === -1) { lab[p - w] = id; stack[sp++] = p - w; }
      if (y < h - 1 && mask[p + w] === value && lab[p + w] === -1) { lab[p + w] = id; stack[sp++] = p + w; }
    }
    comps.push({ id, area, minx, miny, maxx, maxy });
  }
  return { lab, comps };
}

/** Flip the whole component holding pixel `(x, y)`; returns whether one was there. */
function flipComponentAt(mask, w, h, x, y) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= w || y >= h) return false;
  const value = mask[y * w + x];
  const stack = [y * w + x];
  const other = value ? 0 : 1;
  mask[y * w + x] = other;
  while (stack.length) {
    const p = stack.pop();
    const px = p % w;
    for (const n of [px > 0 ? p - 1 : -1, px < w - 1 ? p + 1 : -1, p - w, p + w]) {
      if (n < 0 || n >= w * h || mask[n] !== value) continue;
      mask[n] = other;
      stack.push(n);
    }
  }
  return true;
}

/**
 * Rock where the gray's box mean, over a window of `0.12` cell around each
 * pixel, is darker than `threshold`. A mean rather than a per-pixel cut,
 * because a plan's rock is drawn as speckle that reads as floor pixel by pixel.
 */
function rockMask(gray, w, h, threshold, pitch) {
  const W = w + 1;
  const I = new Uint32Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = 0; x < w; x++) {
      run += gray[y * w + x];
      I[(y + 1) * W + x + 1] = I[y * W + x + 1] + run;
    }
  }
  const r = Math.max(2, Math.round(0.12 * pitch));
  const rock = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const s = I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0];
      rock[y * w + x] = s / ((x1 - x0) * (y1 - y0)) < threshold ? 1 : 0;
    }
  }
  return rock;
}

/**
 * The rock mask cleaned to rooms: a rock blob under `0.3` of a cell (a
 * label's ring, a symbol, rubble) becomes floor, and a floor island under one
 * cell (speckle, lettering) becomes rock. Outside the crop is rock, so a room
 * the crop cuts through is still a room. Then each `drop: "island"`
 * correction flips the component at its point.
 */
function cleanRock(rock, w, h, pitch, islands) {
  const sq = pitch * pitch;
  {
    const { lab, comps } = components(rock, w, h, 1);
    const kill = new Uint8Array(comps.length);
    for (const c of comps) if (c.area < 0.3 * sq) kill[c.id] = 1;
    for (let i = 0; i < rock.length; i++) if (rock[i] && kill[lab[i]]) rock[i] = 0;
  }
  {
    const { lab, comps } = components(rock, w, h, 0);
    const kill = new Uint8Array(comps.length);
    for (const c of comps) if (c.area < sq) kill[c.id] = 1;
    for (let i = 0; i < rock.length; i++) if (!rock[i] && kill[lab[i]]) rock[i] = 1;
  }
  let dropped = 0;
  for (const [x, y] of islands) if (flipComponentAt(rock, w, h, x, y)) dropped++;
  return dropped;
}

/** Douglas–Peucker over an open polyline of `[x, y]` points. */
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const L = Math.hypot(bx - ax, by - ay) || 1;
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L;
      if (d > md) { md = d; mi = i; }
    }
    if (md > eps) {
      keep[mi] = 1;
      st.push([a, mi], [mi, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/* ---------------------------------------------------------------------------
 * The lattice in render pixels, and the corrections read onto it.
 * ------------------------------------------------------------------------- */

/** The recipe's lattice carried into the render: line positions in pixels and the mean pitch. */
function renderLattice(lattice, crop, scale) {
  const ox = (lattice.x0 - crop.x) * scale;
  const oy = (lattice.y0 - crop.y) * scale;
  const px = lattice.px * scale;
  const py = lattice.py * scale;
  return { ...lattice, ox, oy, ppx: px, ppy: py, pitch: (px + py) / 2, cellX: (i) => ox + i * px, cellY: (j) => oy + j * py };
}

/** The corrections sorted by what they assert, `at` points carried into render pixels. */
function readCorrections(list, crop, scale) {
  const cells = new Map();
  const edges = new Map();
  const islands = [];
  for (const k of list ?? []) {
    if (k.cell) cells.set(`${k.cell[0]},${k.cell[1]}`, k.is);
    else if (k.edge) edges.set(`${k.edge[0]},${k.edge[1]},${k.edge[2]}`, k.is);
    else if (k.at) islands.push([(k.at[0] - crop.x) * scale, (k.at[1] - crop.y) * scale]);
  }
  return { cells, edges, islands };
}

/** A door type from an asserted state. */
const doorOf = (state) => (state === "secret" ? DOOR.secret : state === "door" ? DOOR.door : DOOR.none);

/**
 * A segment with the part inside a box cut out (Liang–Barsky): none, one or
 * two pieces, each a little longer than nothing.
 */
function cutBox({ c, door }, x0, y0, x1, y1) {
  const [ax, ay, bx, by] = c;
  const dx = bx - ax, dy = by - ay;
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]]) {
    if (p === 0) {
      if (q < 0) return [{ c, door }];
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return [{ c, door }];
  }
  const at = (t) => [ax + dx * t, ay + dy * t];
  const out = [];
  if (t0 > 1e-6) out.push({ c: [ax, ay, ...at(t0)], door });
  if (t1 < 1 - 1e-6) out.push({ c: [...at(t1), bx, by], door });
  return out.filter((s) => Math.hypot(s.c[2] - s.c[0], s.c[3] - s.c[1]) >= 1);
}

/**
 * A segment-list mode's cell and edge corrections. A cell asserted `open`
 * cuts every segment where it crosses the cell. An edge cuts the segments
 * that run along it (both ends within a band of its line) over its length,
 * then gains the asserted wall or door along that length unless it was
 * asserted `open`; a wall that only meets the edge at a corner is left whole.
 */
function correctSegments(walls, L, corr) {
  const band = 0.15 * L.pitch;
  let out = walls;
  for (const [key, state] of corr.cells) {
    if (state !== "open") continue;
    const [i, j] = key.split(",").map(Number);
    out = out.flatMap((s) => cutBox(s, L.cellX(i), L.cellY(j), L.cellX(i + 1), L.cellY(j + 1)));
  }
  for (const [key, state] of corr.edges) {
    const [si, sj, side] = key.split(",");
    const i = Number(si), j = Number(sj);
    const north = side === "n";
    const seg = north ? [L.cellX(i), L.cellY(j), L.cellX(i + 1), L.cellY(j)] : [L.cellX(i), L.cellY(j), L.cellX(i), L.cellY(j + 1)];
    const line = north ? seg[1] : seg[0];
    const along = (s) => (north ? Math.abs(s.c[1] - line) <= band && Math.abs(s.c[3] - line) <= band : Math.abs(s.c[0] - line) <= band && Math.abs(s.c[2] - line) <= band);
    const box = north ? [seg[0], line - band, seg[2], line + band] : [line - band, seg[1], line + band, seg[3]];
    out = out.flatMap((s) => (along(s) ? cutBox(s, ...box) : [s]));
    if (state !== "open") out.push({ c: seg, door: doorOf(state) });
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * grid mode
 * ------------------------------------------------------------------------- */

/**
 * The circled room labels, as centres and radii: a ring about one cell
 * across, dark nearly all the way round and light just inside. A ring that
 * touches a wall or a grid crossing is kept too; it is used only to mask its
 * ink, so a label in a one-cell room is not read as a door.
 */
function labelRings(gray, w, h, pitch) {
  const K = 48;
  const cs = [], sn = [];
  for (let k = 0; k < K; k++) {
    cs.push(Math.cos((2 * Math.PI * k) / K));
    sn.push(Math.sin((2 * Math.PI * k) / K));
  }
  const dk = (x, y) => {
    x = Math.round(x);
    y = Math.round(y);
    return x >= 0 && y >= 0 && x < w && y < h && gray[y * w + x] < INK;
  };
  const around = (cx, cy, R, thick) => {
    let n = 0;
    for (let k = 0; k < K; k++) {
      let hit = false;
      for (let t = 0; t <= thick && !hit; t++) hit = dk(cx + (R - t) * cs[k], cy + (R - t) * sn[k]);
      if (hit) n++;
    }
    return n / K;
  };
  const r0 = Math.round(0.38 * pitch), r1 = Math.round(0.58 * pitch);
  const rayHit = (cx, cy, dx, dy) => {
    for (let r = r0; r <= r1; r++) if (dk(cx + dx * r, cy + dy * r)) return true;
    return false;
  };
  const hits = [];
  for (let cy = 0; cy < h; cy += 2) {
    for (let cx = 0; cx < w; cx += 2) {
      if (!rayHit(cx, cy, 1, 0) || !rayHit(cx, cy, -1, 0) || !rayHit(cx, cy, 0, 1) || !rayHit(cx, cy, 0, -1)) continue;
      for (let Rf = 0.4; Rf <= 0.561; Rf += 0.02) {
        const R = Rf * pitch;
        const ring = around(cx, cy, R, 2);
        if (ring < 0.85 || around(cx, cy, R - 0.14 * pitch, 0) > 0.3 || around(cx, cy, R + 0.08 * pitch, 0) > 0.6) continue;
        hits.push([cx, cy, R, ring]);
        break;
      }
    }
  }
  hits.sort((a, b) => b[3] - a[3]);
  const rings = [];
  for (const hit of hits) if (!rings.some((r) => Math.hypot(r[0] - hit[0], r[1] - hit[1]) < 0.6 * pitch)) rings.push(hit);
  return rings;
}

/**
 * A rock cell between two floor cells that holds a door drawn across the
 * band: the largest light patch inside the cell (and a tenth of a cell
 * round it), wholly inside that window, longer along the band than across it.
 * A patch that reaches the window's edge is floor, not a drawn door.
 */
function drawnDoorInRock(gray, w, L, i, j, ns) {
  const pad = Math.round(0.1 * L.pitch);
  const x0 = Math.round(L.cellX(i)) - pad, x1 = Math.round(L.cellX(i + 1)) + pad;
  const y0 = Math.round(L.cellY(j)) - pad, y1 = Math.round(L.cellY(j + 1)) + pad;
  const W = x1 - x0, H = y1 - y0;
  const h = gray.length / w;
  if (x0 < 0 || y0 < 0 || x1 > w || y1 > h) return false;
  const seen = new Uint8Array(W * H);
  const lightAt = (xx, yy) => gray[(y0 + yy) * w + x0 + xx] >= PAPER;
  let best = null;
  for (let yy = 0; yy < H; yy++) {
    for (let xx = 0; xx < W; xx++) {
      const k = yy * W + xx;
      if (seen[k] || !lightAt(xx, yy)) continue;
      const st = [k];
      seen[k] = 1;
      let area = 0, mnx = W, mny = H, mxx = 0, mxy = 0, touches = false;
      while (st.length) {
        const q = st.pop();
        area++;
        const qx = q % W, qy = (q / W) | 0;
        if (qx < mnx) mnx = qx;
        if (qx > mxx) mxx = qx;
        if (qy < mny) mny = qy;
        if (qy > mxy) mxy = qy;
        if (qx === 0 || qy === 0 || qx === W - 1 || qy === H - 1) touches = true;
        for (const [ax, ay] of [[qx - 1, qy], [qx + 1, qy], [qx, qy - 1], [qx, qy + 1]]) {
          if (ax < 0 || ay < 0 || ax >= W || ay >= H) continue;
          const a = ay * W + ax;
          if (seen[a] || !lightAt(ax, ay)) continue;
          seen[a] = 1;
          st.push(a);
        }
      }
      if (touches) continue;
      const bw = mxx - mnx + 1, bh = mxy - mny + 1;
      if (!best || area > best.area) best = { area, bw, bh };
    }
  }
  if (!best) return false;
  const along = ns ? best.bw : best.bh;
  const across = ns ? best.bh : best.bw;
  const p = L.pitch;
  return along >= 0.3 * p && across >= 0.12 * p && along >= 1.3 * across && best.area >= 0.6 * best.bw * best.bh && best.area >= 0.05 * p * p;
}

/**
 * How a one-cell throat reads: `open`, a `door` (an outline: two runs of ink
 * across the gap) or a `symbol` (one run: a portcullis, a bar). The lines
 * scanned run across the gap, each read along the passage a quarter cell
 * past both cell edges; the grid line hugging a cell edge is dark on nearly
 * every scan line and is dropped, and a label's masked ink is never read.
 */
function throatKind(gray, w, ringMask, L, i, j, ns) {
  const x0 = Math.round(L.cellX(i)), x1 = Math.round(L.cellX(i + 1));
  const y0 = Math.round(L.cellY(j)), y1 = Math.round(L.cellY(j + 1));
  const h = gray.length / w;
  const m = Math.round(0.15 * L.pitch), reach = Math.round(0.25 * L.pitch), hug = Math.max(2, Math.round(0.08 * L.pitch));
  const lo = ns ? x0 + m : y0 + m, hi = ns ? x1 - m : y1 - m;
  const a0 = ns ? y0 - reach : x0 - reach, a1 = ns ? y1 + reach : x1 + reach;
  const e0 = ns ? y0 : x0, e1 = ns ? y1 : x1;
  const at = (u, v) => {
    const x = ns ? u : v, y = ns ? v : u;
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    return !ringMask[y * w + x] && gray[y * w + x] < INK;
  };
  const persist = new Set();
  for (let v = a0; v < a1; v++) {
    if (Math.abs(v - e0) > hug && Math.abs(v - e1) > hug) continue;
    let n = 0;
    for (let u = lo; u < hi; u++) if (at(u, v)) n++;
    if (n / (hi - lo) >= 0.85) persist.add(v);
  }
  let spanned = 0, doubled = 0, lines = 0;
  for (let u = lo; u < hi; u++) {
    lines++;
    let runs = 0, inRun = false;
    for (let v = a0; v < a1; v++) {
      const d = !persist.has(v) && at(u, v);
      if (d && !inRun) runs++;
      inRun = d;
    }
    if (runs) spanned++;
    if (runs >= 2) doubled++;
  }
  const span = lines ? spanned / lines : 0;
  const dbl = spanned ? doubled / spanned : 0;
  return span < 0.75 ? "open" : dbl >= 0.45 ? "door" : "symbol";
}

/** grid mode: cells classed by floor share, walls on cell edges, doors in throats. */
function traceGrid(gray, w, h, threshold, L, corr) {
  const rock = rockMask(gray, w, h, threshold, L.pitch);
  const dropped = cleanRock(rock, w, h, L.pitch, corr.islands);
  const { cols: nx, rows: ny } = L;
  const floorCell = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x0 = Math.max(0, Math.round(L.cellX(i))), x1 = Math.min(w, Math.round(L.cellX(i + 1)));
      const y0 = Math.max(0, Math.round(L.cellY(j))), y1 = Math.min(h, Math.round(L.cellY(j + 1)));
      let f = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { n++; if (!rock[y * w + x]) f++; }
      floorCell[j * nx + i] = n && f / n >= 0.5 ? 1 : 0;
    }
  }
  const isFloor = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && floorCell[j * nx + i] === 1;

  const rings = labelRings(gray, w, h, L.pitch);
  const ringMask = new Uint8Array(w * h);
  for (const [cx, cy, R] of rings) {
    const Rm = R + 0.14 * L.pitch;
    for (let y = Math.max(0, Math.floor(cy - Rm)); y <= Math.min(h - 1, Math.ceil(cy + Rm)); y++) {
      for (let x = Math.max(0, Math.floor(cx - Rm)); x <= Math.min(w - 1, Math.ceil(cx + Rm)); x++) {
        if (Math.hypot(x - cx, y - cy) <= Rm) ringMask[y * w + x] = 1;
      }
    }
  }

  // A door drawn inside a one-cell rock band reads as rock: such a cell is
  // floor, and a door.
  const passages = new Map();
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (isFloor(i, j)) continue;
      const ns = isFloor(i, j - 1) && isFloor(i, j + 1);
      const ew = isFloor(i - 1, j) && isFloor(i + 1, j);
      if (ns === ew || !drawnDoorInRock(gray, w, L, i, j, ns)) continue;
      floorCell[j * nx + i] = 1;
      passages.set(`${i},${j}`, { i, j, ns, kind: "door" });
    }
  }

  let cellFixes = 0;
  for (const [key, state] of corr.cells) {
    if (state !== "floor" && state !== "solid") continue;
    const [i, j] = key.split(",").map(Number);
    floorCell[j * nx + i] = state === "floor" ? 1 : 0;
    if (state === "solid") passages.delete(key);
    cellFixes++;
  }
  // A door stands between walls: a drawn door whose flank a correction made
  // floor is floor and no door.
  for (const [key, t] of passages) {
    const flanked = t.ns ? !isFloor(t.i - 1, t.j) && !isFloor(t.i + 1, t.j) : !isFloor(t.i, t.j - 1) && !isFloor(t.i, t.j + 1);
    if (!flanked) passages.delete(key);
  }

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (!isFloor(i, j) || passages.has(`${i},${j}`)) continue;
      const ns = isFloor(i, j - 1) && isFloor(i, j + 1) && !isFloor(i - 1, j) && !isFloor(i + 1, j);
      const ew = isFloor(i - 1, j) && isFloor(i + 1, j) && !isFloor(i, j - 1) && !isFloor(i, j + 1);
      if (!ns && !ew) continue;
      passages.set(`${i},${j}`, { i, j, ns, kind: throatKind(gray, w, ringMask, L, i, j, ns) });
    }
  }
  let unplaced = 0;
  for (const [key, state] of corr.cells) {
    if (state === "floor" || state === "solid") continue;
    const [i, j] = key.split(",").map(Number);
    const held = passages.get(key);
    if (held) {
      held.kind = state;
      continue;
    }
    const ns = isFloor(i, j - 1) && isFloor(i, j + 1);
    const ew = isFloor(i - 1, j) && isFloor(i + 1, j);
    if (state === "open") continue;
    if (ns === ew) {
      unplaced++;
      continue;
    }
    floorCell[j * nx + i] = 1;
    passages.set(key, { i, j, ns, kind: state });
  }

  // Edge states: a vertical edge (i, j, "w") divides (i-1, j) from (i, j); a
  // horizontal edge (i, j, "n") divides (i, j-1) from (i, j).
  const vEdge = new Uint8Array((nx + 1) * ny);
  const hEdge = new Uint8Array(nx * (ny + 1));
  const WALL = 1;
  for (let j = 0; j < ny; j++) for (let i = 0; i <= nx; i++) if (isFloor(i - 1, j) !== isFloor(i, j)) vEdge[j * (nx + 1) + i] = WALL;
  for (let j = 0; j <= ny; j++) for (let i = 0; i < nx; i++) if (isFloor(i, j - 1) !== isFloor(i, j)) hEdge[j * nx + i] = WALL;
  const edgeState = { wall: WALL, door: 2, secret: 3, open: 0 };
  for (const [key, state] of corr.edges) {
    const [si, sj, side] = key.split(",");
    const i = Number(si), j = Number(sj);
    if (side === "w") vEdge[j * (nx + 1) + i] = edgeState[state];
    else hEdge[j * nx + i] = edgeState[state];
  }

  const walls = [];
  for (let i = 0; i <= nx; i++) {
    let run = null;
    for (let j = 0; j <= ny; j++) {
      const s = j < ny ? vEdge[j * (nx + 1) + i] : 0;
      if (s === WALL && run === null) run = j;
      if (s !== WALL && run !== null) {
        walls.push({ c: [L.cellX(i), L.cellY(run), L.cellX(i), L.cellY(j)], door: DOOR.none });
        run = null;
      }
      if (s > WALL) walls.push({ c: [L.cellX(i), L.cellY(j), L.cellX(i), L.cellY(j + 1)], door: s === 3 ? DOOR.secret : DOOR.door });
    }
  }
  for (let j = 0; j <= ny; j++) {
    let run = null;
    for (let i = 0; i <= nx; i++) {
      const s = i < nx ? hEdge[j * nx + i] : 0;
      if (s === WALL && run === null) run = i;
      if (s !== WALL && run !== null) {
        walls.push({ c: [L.cellX(run), L.cellY(j), L.cellX(i), L.cellY(j)], door: DOOR.none });
        run = null;
      }
      if (s > WALL) walls.push({ c: [L.cellX(i), L.cellY(j), L.cellX(i + 1), L.cellY(j)], door: s === 3 ? DOOR.secret : DOOR.door });
    }
  }
  const kinds = { door: 0, symbol: 0, secret: 0, open: 0 };
  for (const t of passages.values()) {
    kinds[t.kind] = (kinds[t.kind] ?? 0) + 1;
    if (t.kind === "open") continue;
    // A door across the cell's middle, perpendicular to the passage.
    const cx = L.cellX(t.i) + L.ppx / 2, cy = L.cellY(t.j) + L.ppy / 2;
    const c = t.ns ? [L.cellX(t.i), cy, L.cellX(t.i + 1), cy] : [cx, L.cellY(t.j), cx, L.cellY(t.j + 1)];
    walls.push({ c, door: t.kind === "secret" ? DOOR.secret : DOOR.door });
  }

  // Floor regions, joined through their doors (a door cell is a floor cell).
  const comp = new Int32Array(nx * ny).fill(-1);
  const sizes = [];
  for (let s = 0; s < nx * ny; s++) {
    if (comp[s] !== -1 || !floorCell[s]) continue;
    const st = [s];
    comp[s] = sizes.length;
    let n = 0;
    while (st.length) {
      const c = st.pop();
      n++;
      const i = c % nx, j = (c / nx) | 0;
      for (const [a, b] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) {
        if (isFloor(a, b) && comp[b * nx + a] === -1) {
          comp[b * nx + a] = sizes.length;
          st.push(b * nx + a);
        }
      }
    }
    sizes.push(n);
  }
  const floorCells = floorCell.reduce((s, v) => s + v, 0);
  return {
    walls,
    digest: {
      cells: nx * ny, floorCells, regions: sizes.length, largestRegion: sizes.length ? Math.max(...sizes) : 0,
      throats: kinds, labels: rings.length, islandsDropped: dropped, cellFixes, unplaced,
    },
  };
}

/* ---------------------------------------------------------------------------
 * contour mode
 * ------------------------------------------------------------------------- */

/**
 * The floor's outlines as closed loops of pixel-corner points, floor kept on
 * the left. Each loop walks the cracks between floor and rock pixels, turning
 * left before straight before right, so two rooms touching at a corner stay
 * two loops.
 */
function floorLoops(rock, w, h) {
  const W = w + 1;
  const isFloor = (x, y) => x >= 0 && y >= 0 && x < w && y < h && !rock[y * w + x];
  const out = new Map();
  const add = (x0, y0, x1, y1) => {
    const k = y0 * W + x0;
    let a = out.get(k);
    if (!a) out.set(k, (a = []));
    a.push([x1, y1]);
  };
  for (let y = 0; y <= h; y++) {
    for (let x = 0; x <= w; x++) {
      if (x < w) {
        const up = isFloor(x, y - 1), dn = isFloor(x, y);
        if (up !== dn) dn ? add(x + 1, y, x, y) : add(x, y, x + 1, y);
      }
      if (y < h) {
        const lf = isFloor(x - 1, y), rt = isFloor(x, y);
        if (lf !== rt) rt ? add(x, y, x, y + 1) : add(x, y + 1, x, y);
      }
    }
  }
  const loops = [];
  for (const [k0, list0] of out) {
    while (list0.length) {
      const sx = k0 % W, sy = (k0 / W) | 0;
      const pts = [[sx, sy]];
      let [nx, ny] = list0.pop();
      let dx = nx - sx, dy = ny - sy;
      let guard = 0;
      while (!(nx === sx && ny === sy) && guard++ < 1e7) {
        pts.push([nx, ny]);
        const cand = out.get(ny * W + nx);
        if (!cand?.length) break;
        let pick = -1;
        for (const [ex, ey] of [[dy, -dx], [dx, dy], [-dy, dx]]) {
          pick = cand.findIndex(([cx, cy]) => cx - nx === ex && cy - ny === ey);
          if (pick >= 0) break;
        }
        if (pick < 0) pick = 0;
        const [qx, qy] = cand.splice(pick, 1)[0];
        dx = qx - nx;
        dy = qy - ny;
        nx = qx;
        ny = qy;
      }
      loops.push(pts);
    }
  }
  return loops;
}

/**
 * The doors a contour plan draws: a light rectangle about a third to one
 * cell long, standing on floor, with rock within a quarter cell of both ends.
 */
function contourDoors(gray, rock, w, h, pitch) {
  const light = new Uint8Array(w * h);
  for (let i = 0; i < light.length; i++) light[i] = gray[i] >= INK ? 1 : 0;
  const { comps } = components(light, w, h, 1);
  const rockAt = (x, y) => x >= 0 && y >= 0 && x < w && y < h && rock[y * w + x];
  const reach = Math.round(0.25 * pitch);
  const doors = [];
  for (const c of comps) {
    const bw = c.maxx - c.minx + 1, bh = c.maxy - c.miny + 1;
    const long = Math.max(bw, bh), short = Math.min(bw, bh);
    if (long < 0.3 * pitch || long > pitch || short < 0.08 * pitch || short > 0.5 * pitch) continue;
    if (long / short < 1.6 || c.area / (bw * bh) < 0.6) continue;
    const cx = (c.minx + c.maxx) >> 1, cy = (c.miny + c.maxy) >> 1;
    if (rock[cy * w + cx]) continue;
    const horiz = bw >= bh;
    let endA = false, endB = false;
    for (let d = 1; d <= reach; d++) {
      if (horiz) {
        endA ||= rockAt(c.minx - d, cy);
        endB ||= rockAt(c.maxx + d, cy);
      } else {
        endA ||= rockAt(cx, c.miny - d);
        endB ||= rockAt(cx, c.maxy + d);
      }
    }
    if (endA && endB) doors.push({ c: horiz ? [c.minx, cy, c.maxx + 1, cy] : [cx, c.miny, cx, c.maxy + 1], door: DOOR.door });
  }
  return doors;
}

/** contour mode: walls on the floor's own outline, snapped to grid lines where they run along one. */
function traceContour(gray, w, h, threshold, L, corr) {
  const rock = rockMask(gray, w, h, threshold, L.pitch);
  const dropped = cleanRock(rock, w, h, L.pitch, corr.islands);
  let cellFixes = 0;
  for (const [key, state] of corr.cells) {
    if (state !== "floor" && state !== "solid") continue;
    const [i, j] = key.split(",").map(Number);
    const v = state === "solid" ? 1 : 0;
    for (let y = Math.max(0, Math.round(L.cellY(j))); y < Math.min(h, Math.round(L.cellY(j + 1))); y++) {
      for (let x = Math.max(0, Math.round(L.cellX(i))); x < Math.min(w, Math.round(L.cellX(i + 1))); x++) rock[y * w + x] = v;
    }
    cellFixes++;
  }
  const eps = Math.max(1.5, 0.045 * L.pitch);
  const segs = [];
  let loops = 0;
  for (const loop of floorLoops(rock, w, h)) {
    if (loop.length < 2 * L.pitch) continue;
    loops++;
    let far = 0, fd = -1;
    for (let i = 0; i < loop.length; i++) {
      const d = Math.hypot(loop[i][0] - loop[0][0], loop[i][1] - loop[0][1]);
      if (d > fd) { fd = d; far = i; }
    }
    const a = simplify(loop.slice(0, far + 1), eps);
    const b = simplify(loop.slice(far).concat([loop[0]]), eps);
    const poly = a.concat(b.slice(1));
    for (let i = 0; i + 1 < poly.length; i++) segs.push([...poly[i], ...poly[i + 1]]);
  }
  const tol = 0.12 * L.pitch;
  const snapX = (x) => {
    const g = L.ox + Math.round((x - L.ox) / L.ppx) * L.ppx;
    return Math.abs(g - x) <= tol ? g : x;
  };
  const snapY = (y) => {
    const g = L.oy + Math.round((y - L.oy) / L.ppy) * L.ppy;
    return Math.abs(g - y) <= tol ? g : y;
  };
  let walls = segs
    .map(([x0, y0, x1, y1]) => ({ c: [snapX(x0), snapY(y0), snapX(x1), snapY(y1)], door: DOOR.none }))
    .filter(({ c }) => Math.hypot(c[2] - c[0], c[3] - c[1]) >= 1);
  walls.push(...contourDoors(gray, rock, w, h, L.pitch));

  // A door asserted on a cell lies across it, perpendicular to the axis whose
  // two neighbours hold more floor.
  let unplaced = 0;
  const floorShare = (i, j) => {
    let f = 0, n = 0;
    for (let y = Math.max(0, Math.round(L.cellY(j))); y < Math.min(h, Math.round(L.cellY(j + 1))); y++) {
      for (let x = Math.max(0, Math.round(L.cellX(i))); x < Math.min(w, Math.round(L.cellX(i + 1))); x++) { n++; if (!rock[y * w + x]) f++; }
    }
    return n ? f / n : 0;
  };
  for (const [key, state] of corr.cells) {
    if (state !== "door" && state !== "secret") continue;
    const [i, j] = key.split(",").map(Number);
    const nsFloor = floorShare(i, j - 1) + floorShare(i, j + 1);
    const ewFloor = floorShare(i - 1, j) + floorShare(i + 1, j);
    if (nsFloor === ewFloor) {
      unplaced++;
      continue;
    }
    const ns = nsFloor > ewFloor;
    const x0 = L.cellX(i), y0 = L.cellY(j), x1 = L.cellX(i + 1), y1 = L.cellY(j + 1);
    const inCell = ({ c }) => c[0] >= x0 && c[0] <= x1 && c[2] >= x0 && c[2] <= x1 && c[1] >= y0 && c[1] <= y1 && c[3] >= y0 && c[3] <= y1;
    walls = walls.filter((s) => !(s.door && inCell(s)));
    const cx = x0 + L.ppx / 2, cy = y0 + L.ppy / 2;
    walls.push({ c: ns ? [x0, cy, x1, cy] : [cx, y0, cx, y1], door: doorOf(state) });
  }
  walls = correctSegments(walls, L, corr);
  return {
    walls,
    digest: { cells: L.cols * L.rows, loops, islandsDropped: dropped, cellFixes, unplaced },
  };
}

/* ---------------------------------------------------------------------------
 * stroke mode
 * ------------------------------------------------------------------------- */

/** A square min (`erode`) or max filter of radius `e`, separable. */
function morph(src, w, h, e, erode) {
  const tmp = new Uint8Array(w * h), dst = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = erode ? 1 : 0;
      for (let d = -e; d <= e; d++) {
        const X = x + d;
        const s = X >= 0 && X < w ? src[y * w + X] : 0;
        if (erode ? !s : s) { v = erode ? 0 : 1; break; }
      }
      tmp[y * w + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = erode ? 1 : 0;
      for (let d = -e; d <= e; d++) {
        const Y = y + d;
        const s = Y >= 0 && Y < h ? tmp[Y * w + x] : 0;
        if (erode ? !s : s) { v = erode ? 0 : 1; break; }
      }
      dst[y * w + x] = v;
    }
  }
  return dst;
}

/** Zhang–Suen thinning of a mask to a one-pixel skeleton, in place. */
function thin(sk, w, h) {
  const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? sk[y * w + x] : 0);
  const del = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const pass of [0, 1]) {
      del.length = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!sk[y * w + x]) continue;
          const p2 = at(x, y - 1), p3 = at(x + 1, y - 1), p4 = at(x + 1, y), p5 = at(x + 1, y + 1);
          const p6 = at(x, y + 1), p7 = at(x - 1, y + 1), p8 = at(x - 1, y), p9 = at(x - 1, y - 1);
          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (B < 2 || B > 6) continue;
          const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
          let A = 0;
          for (let k = 0; k < 8; k++) if (!seq[k] && seq[k + 1]) A++;
          if (A !== 1) continue;
          const keep = pass === 0 ? p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0 : p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0;
          if (!keep) del.push(y * w + x);
        }
      }
      for (const q of del) sk[q] = 0;
      if (del.length) changed = true;
    }
  }
  return sk;
}

/** stroke mode: light strokes opened, compact marks dropped, thinned, and walked node to node. */
function traceStroke(gray, w, h, threshold, L, corr) {
  const pitch = L.pitch;
  const lightMask = new Uint8Array(w * h);
  for (let i = 0; i < lightMask.length; i++) lightMask[i] = gray[i] >= threshold ? 1 : 0;
  const e = Math.max(1, Math.round(0.03 * pitch));
  const thick = morph(morph(lightMask, w, h, e, true), w, h, e, false);
  {
    // A stroke network spans most of a cell; a component shorter than that on
    // its long side is furniture, a label or an ornament.
    const { lab, comps } = components(thick, w, h, 1);
    const kill = new Uint8Array(comps.length);
    for (const c of comps) if (Math.max(c.maxx - c.minx, c.maxy - c.miny) < 0.9 * pitch) kill[c.id] = 1;
    for (let i = 0; i < thick.length; i++) if (thick[i] && kill[lab[i]]) thick[i] = 0;
  }
  let dropped = 0;
  for (const [x, y] of corr.islands) {
    const q = Math.round(y) * w + Math.round(x);
    if (thick[q] && flipComponentAt(thick, w, h, x, y)) dropped++;
  }
  const sk = thin(thick, w, h);
  const nb = (q) => {
    const x = q % w, y = (q / w) | 0, out = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const X = x + dx, Y = y + dy;
        if (X >= 0 && Y >= 0 && X < w && Y < h && sk[Y * w + X]) out.push(Y * w + X);
      }
    }
    return out;
  };
  const deg = new Uint8Array(w * h);
  for (let q = 0; q < sk.length; q++) if (sk[q]) deg[q] = nb(q).length;
  const isNode = (q) => deg[q] !== 2;
  const seen = new Set();
  const edgeKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const paths = [];
  for (let q = 0; q < sk.length; q++) {
    if (!sk[q] || !isNode(q)) continue;
    for (const n0 of nb(q)) {
      if (seen.has(edgeKey(q, n0))) continue;
      seen.add(edgeKey(q, n0));
      const path = [q, n0];
      let prev = q, cur = n0;
      while (!isNode(cur)) {
        const next = nb(cur).filter((z) => z !== prev);
        if (!next.length || seen.has(edgeKey(cur, next[0]))) break;
        seen.add(edgeKey(cur, next[0]));
        prev = cur;
        cur = next[0];
        path.push(cur);
      }
      paths.push(path.map((z) => [z % w, (z / w) | 0]));
    }
  }
  const eps = Math.max(2, 0.04 * pitch);
  let walls = [];
  for (const p of paths) {
    if (p.length < 0.25 * pitch) continue;
    const poly = simplify(p, eps);
    for (let i = 0; i + 1 < poly.length; i++) walls.push({ c: [...poly[i], ...poly[i + 1]], door: DOOR.none });
  }
  walls = correctSegments(walls, L, corr);
  return { walls, digest: { cells: L.cols * L.rows, paths: paths.length, islandsDropped: dropped } };
}

/* ---------------------------------------------------------------------------
 * The entry point.
 * ------------------------------------------------------------------------- */

/**
 * Trace a recipe's walls off a gray render of its crop.
 *
 * `image` is the crop rendered at `scale` pixels to the page point, one byte
 * of gray per pixel, top-left first. The recipe's `walls` block says the mode,
 * the threshold and the corrections; its `grid` gives the lattice. Walls come
 * back in page points, unrounded, with Foundry's door type (0 none, 1 door,
 * 2 secret); the digest counts what the trace found, for the import's report
 * and the live gate. Throws on a recipe `wallsProblems` refuses or a render
 * too large to sum.
 *
 * @param {{gray: Uint8Array|Uint8ClampedArray, width: number, height: number}} image
 * @param {object} recipe a compiled scene recipe carrying `walls`
 * @param {number} scale render pixels per page point
 * @returns {{walls: {c: number[], door: number}[], digest: object}}
 */
export function traceWalls(image, recipe, scale) {
  const problems = wallsProblems(recipe?.walls, recipe);
  if (problems.length) throw new Error(problems.join("; "));
  const { gray, width: w, height: h } = image ?? {};
  if (!gray || !(w > 0) || !(h > 0) || gray.length !== w * h) throw new Error("walls: the render is not a gray image of its stated size");
  if (w * h > MAX_TRACE_PIXELS) throw new Error(`walls: a ${w}x${h} render is past the trace's ${MAX_TRACE_PIXELS} pixels`);
  const { mode, threshold, corrections } = recipe.walls;
  const L = renderLattice(wallLattice(recipe), recipe.crop, scale);
  const corr = readCorrections(corrections, recipe.crop, scale);
  const run = mode === "grid" ? traceGrid : mode === "contour" ? traceContour : traceStroke;
  const { walls, digest } = run(gray, w, h, threshold, L, corr);
  const toPage = (v, origin) => origin + v / scale;
  const out = [];
  for (const { c, door } of walls) {
    const seg = [toPage(c[0], recipe.crop.x), toPage(c[1], recipe.crop.y), toPage(c[2], recipe.crop.x), toPage(c[3], recipe.crop.y)];
    if (Math.hypot(seg[2] - seg[0], seg[3] - seg[1]) > 0) out.push({ c: seg, door });
  }
  return {
    walls: out,
    digest: {
      mode,
      ...digest,
      walls: out.filter((s) => !s.door).length,
      doors: out.filter((s) => s.door === DOOR.door).length,
      secret: out.filter((s) => s.door === DOOR.secret).length,
      corrections: (corrections ?? []).length,
    },
  };
}
