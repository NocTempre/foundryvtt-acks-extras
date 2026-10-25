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
 * one cell, one cell edge, one island, one drawn door, one box of terrain or
 * one drawn line, and the cap keeps them a small share of the plan.
 *
 * Four modes, for four ways a plan is drawn:
 * - `grid`: dark rock and light floor on the drawn squares. Each cell is
 *   classed by its floor share, walls run on the cell edges between floor and
 *   rock, and a one-cell throat is read for a door by the ink across it.
 * - `contour`: the same rock and floor, with walls on the floor's own
 *   outline. This mode is for caves, which follow no lattice.
 * - `hatch`: rock drawn as hatching, strokes and wedges with paper between
 *   them, read as `contour` once the rock is closed across that paper.
 * - `stroke`: dark wall strokes on a light floor, thinned to their centre
 *   lines, with each door drawn as a box across a wall read as a door and
 *   each window, a gap whose jambs splay, read as a wall that senses pass.
 *
 * A plan of storeys (`levels`) is traced storey by storey with one `walls`
 * block, each storey's walls carried into the first storey's crop and tagged
 * with its ordinal (`traceStoreys`).
 *
 * Every size below is a share of the drawn cell, so a trace reads the same
 * plan the same way at any render scale.
 */

/** The tracer modes a recipe's `walls.mode` may name. */
export const WALL_MODES = Object.freeze(["grid", "contour", "stroke", "hatch"]);

/** How many pixels one drawn cell spans in the gray render a trace reads. */
export const TRACE_PITCH = 50;

/**
 * The share of a plan's lattice cells its corrections may weigh before the
 * lint and the compiler warn: a reviewer's budget, not a refusal.
 */
export const CORRECTION_SHARE = 0.05;

/** The share of a plan's lattice cells past which its corrections are refused. */
export const CORRECTION_CEILING = 0.1;

/** The largest gray render a trace accepts, in pixels; past this the box sums overflow. */
const MAX_TRACE_PIXELS = 16_000_000;

/**
 * How far `hatch` mode closes the rock, as a share of the cell: paper
 * narrower than twice this between two strokes of hatching is rock, and a
 * passage, a cell or more across, stays floor.
 */
const HATCH_CLOSE = 0.2;

/**
 * The largest rock `hatch` mode takes for a speck before it closes the rock,
 * as a share of a cell's area: a grid of small marks on a floor, such as
 * holes in it, would close into one block.
 */
const HATCH_SPECK = 0.05;

/**
 * The radius of stroke mode's opening, as a share of the cell, unless the
 * recipe states its own (`walls.opening`): a stroke thinner than about twice
 * this is no wall.
 */
const STROKE_OPENING = 0.03;

/** The widest opening a recipe may state, as a share of the cell. */
const MAX_OPENING = 0.1;

/** What a correction may assert of a cell, of a cell edge, and of an island, per mode. */
const CELL_STATES = Object.freeze({
  grid: ["floor", "solid", "door", "secret", "open"],
  contour: ["floor", "solid", "door", "secret", "open"],
  hatch: ["floor", "solid", "door", "secret", "open"],
  stroke: ["open", "door", "secret"],
});
const EDGE_STATES = Object.freeze(["wall", "door", "secret", "open"]);
const EDGE_SIDES = Object.freeze(["n", "w"]);

/**
 * What a box may assert: walls on the four lattice lines it names, of a kind
 * a token cannot cross and a sense passes one of, such as a raised structure
 * in a room.
 * A box weighs `BOX_WEIGHT` against the cap, one for each side.
 */
const BOX_STATES = Object.freeze(["terrain"]);
const BOX_WEIGHT = 4;

/**
 * What a rect may assert: the same four sides as a box, on a box drawn
 * between two page points and turned about its centre, for a raised
 * structure that stands off the lattice. A rect weighs `BOX_WEIGHT`.
 */
const RECT_STATES = BOX_STATES;

/**
 * What a line may assert, in any mode: a wall, a door or secret door, or a
 * wall that blocks movement and passes senses, as `terrain` (only the second
 * such wall a sense crosses stops it) or `invisible` (no sense is stopped).
 * A line runs between two page points off the lattice, for a door drawn
 * aslant or a drawn edge no cell or edge names.
 */
const LINE_STATES = Object.freeze(["wall", "door", "secret", "terrain", "invisible"]);

/**
 * What a point correction may drop, per mode. Contour and stroke read drawn
 * doors as free segments off the lattice, where a cell asserted open would
 * cut the walls beside one too, so they drop a door by its point. Stroke
 * drops a window by its point too, which leaves its gap as drawn.
 */
const AT_DROPS = Object.freeze({
  grid: ["island"],
  contour: ["island", "door"],
  hatch: ["island", "door"],
  stroke: ["island", "door", "window"],
});

/** Core's `WALL_DOOR_TYPES`, spelled out because this file loads without Foundry. */
const DOOR = Object.freeze({ none: 0, door: 1, secret: 2 });

/** What a grid-mode cell edge holds. */
const EDGE = Object.freeze({ open: 0, wall: 1, door: 2, secret: 3, terrain: 4 });

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

const cellsOf = (lattice) => (lattice?.cols ?? 0) * (lattice?.rows ?? 0);

/** How many corrections a lattice's budget holds: `CORRECTION_SHARE` of its cells on each of `storeys`, rounded down. */
export const correctionBudget = (lattice, storeys = 1) => Math.floor(CORRECTION_SHARE * cellsOf(lattice) * storeys);

/** How many corrections a lattice allows: `CORRECTION_CEILING` of its cells on each of `storeys`, rounded down. */
export const correctionCap = (lattice, storeys = 1) => Math.floor(CORRECTION_CEILING * cellsOf(lattice) * storeys);

/** What corrections weigh against the budget and the cap: one each, a box or a rect `BOX_WEIGHT`. */
const correctionWeight = (list) => list.reduce((n, k) => n + (k?.box !== undefined || k?.rect !== undefined ? BOX_WEIGHT : 1), 0);

/**
 * A rect's four corners in page points, clockwise from its first: the box
 * between `[x0, y0]` and `[x1, y1]`, turned `turn` degrees clockwise on the
 * page about its centre.
 */
function rectCorners([x0, y0, x1, y1, turn = 0]) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const a = (turn * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos]);
}

/** One correction's identity, so a cell, an edge, an island, a box or a line is asserted once. */
const correctionKey = (k) => (k.cell ? `cell:${k.cell.join(",")}` : k.edge ? `edge:${k.edge.join(",")}` : k.box ? `box:${k.box.join(",")}`
  : k.rect ? `rect:${k.rect.join(",")}` : k.line ? `line:${k.line.join(",")}` : `at:${(k.at ?? []).join(",")}`);

/** The crop of each storey above a recipe's first, bottom up: `crop` moved to each corner `levels` lists. */
export function storeyCrops(recipe) {
  return (Array.isArray(recipe?.levels) ? recipe.levels : []).map((l) => ({ ...recipe.crop, x: l?.x, y: l?.y }));
}

/** Whether a page point lies in a crop, its edge included. */
const inCrop = ([x, y], c) => x >= c.x && y >= c.y && x <= c.x + c.w && y <= c.y + c.h;

/** What a correction's lattice phrase reads in a sentence: the cells it spans on how many storeys. */
const latticeText = (lattice, storeys) => `${storeys > 1 ? `${storeys} storeys of ` : ""}${lattice.cols}x${lattice.rows} cells`;

/** The page points a correction stands on: an `at`'s point, a line's two ends, a rect's corners; none for a lattice form. */
const correctionPoints = (k) => (k.at ? [k.at] : k.line ? [k.line.slice(0, 2), k.line.slice(2, 4)] : k.rect ? rectCorners(k.rect) : []);

/**
 * Everything wrong with a recipe's `walls` block, as sentences prefixed
 * `walls`; empty when it holds together. The recipe must carry a square grid,
 * because the corrections are read on its lattice. Corrections are checked
 * against that lattice and the cap, so a row whose corrections weigh more
 * than `CORRECTION_CEILING` of its cells is refused wherever `recipeProblems`
 * runs; each correction weighs one, a box `BOX_WEIGHT`. A row past the
 * budget but within the cap holds here and is named by `wallsWarnings`.
 *
 * On a plan of storeys the cap counts every storey's cells, and a correction
 * is placed by its page points in the one storey whose crop holds it: a cell,
 * an edge or a box names a lattice square every storey shares, so it is
 * refused there, as are storeys whose crops overlap.
 */
export function wallsProblems(walls, recipe) {
  if (!walls || typeof walls !== "object" || Array.isArray(walls)) return ["walls must be an object"];
  const out = [];
  for (const k of Object.keys(walls)) if (!["mode", "threshold", "opening", "corrections", "note"].includes(k)) out.push(`walls has an unknown key "${k}"`);
  if (!WALL_MODES.includes(walls.mode)) out.push(`walls.mode must be ${WALL_MODES.join(", ")}`);
  if (!isInt(walls.threshold) || walls.threshold < 1 || walls.threshold > 254) out.push("walls.threshold must be a whole gray level from 1 to 254");
  if (walls.opening !== undefined) {
    if (walls.mode !== "stroke") out.push("walls.opening applies in stroke mode only");
    else if (!isNum(walls.opening) || walls.opening <= 0 || walls.opening > MAX_OPENING) out.push(`walls.opening must be a share of the cell above 0 and at most ${MAX_OPENING}`);
  }
  const lattice = wallLattice(recipe);
  if (!lattice) return [...out, "walls need a square grid to trace on"];
  if (!lattice.cols || !lattice.rows) return [...out, "walls: the crop spans no whole cell of the grid"];
  const list = walls.corrections ?? [];
  if (!Array.isArray(list)) return [...out, "walls.corrections must be a list"];
  const crops = [recipe.crop, ...storeyCrops(recipe)];
  const storeyed = crops.length > 1;
  if (storeyed && crops.every((c) => isNum(c.x) && isNum(c.y))) {
    const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    if (crops.some((a, i) => crops.some((b, j) => j > i && overlap(a, b)))) out.push("walls: two storeys' crops overlap, so a correction's page point names no one storey");
  }
  const cap = correctionCap(lattice, crops.length);
  const weight = correctionWeight(list);
  if (weight > cap) {
    out.push(`walls.corrections weigh ${weight} (a box ${BOX_WEIGHT}), over the cap of ${cap} (${CORRECTION_CEILING * 100}% of ${latticeText(lattice, crops.length)}); a plan that needs more is left wall-less`);
  }
  // A page-point correction lies wholly inside one storey's crop.
  const placed = (k) => crops.some((c) => correctionPoints(k).every((p) => inCrop(p, c)));
  const cellStates = CELL_STATES[walls.mode] ?? [];
  const seen = new Set();
  list.forEach((k, i) => {
    const where = `walls.corrections[${i}]`;
    if (!k || typeof k !== "object" || Array.isArray(k)) return void out.push(`${where} must be an object`);
    const forms = ["cell", "edge", "at", "box", "rect", "line"].filter((f) => k[f] !== undefined);
    if (forms.length !== 1) return void out.push(`${where} names exactly one of cell, edge, at, box, rect or line`);
    const allowed = forms[0] === "at" ? ["at", "drop"] : [forms[0], "is"];
    for (const key of Object.keys(k)) if (!allowed.includes(key)) out.push(`${where} has an unknown key "${key}"`);
    if (storeyed && ["cell", "edge", "box"].includes(forms[0])) {
      return void out.push(`${where}.${forms[0]} names no storey; a plan of storeys is corrected by page points (at, rect, line)`);
    }
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
    } else if (k.box !== undefined) {
      const [c0, r0, c1, r1] = Array.isArray(k.box) ? k.box : [];
      if (!Array.isArray(k.box) || k.box.length !== 4 || !k.box.every(isInt)) return void out.push(`${where}.box must be [column, row, column, row]`);
      if (c0 < 0 || r0 < 0 || c1 > lattice.cols || r1 > lattice.rows || c0 >= c1 || r0 >= r1) {
        out.push(`${where}.box [${k.box.join(", ")}] must run from a lattice line to a later one, inside the ${lattice.cols}x${lattice.rows} lattice`);
      }
      if (!BOX_STATES.includes(k.is)) out.push(`${where}.is must be ${BOX_STATES.join(", ")} for a box`);
    } else if (k.rect !== undefined) {
      if (!Array.isArray(k.rect) || ![4, 5].includes(k.rect.length) || !k.rect.every(isNum)) {
        return void out.push(`${where}.rect must be [x, y, x, y] or [x, y, x, y, degrees]`);
      }
      if (!(k.rect[2] > k.rect[0] && k.rect[3] > k.rect[1])) out.push(`${where}.rect must run from its top-left corner to its bottom-right`);
      if (!placed(k)) out.push(storeyed ? `${where}.rect lies inside no one storey's crop` : `${where}.rect has a corner outside the crop`);
      if (!RECT_STATES.includes(k.is)) out.push(`${where}.is must be ${RECT_STATES.join(", ")} for a rect`);
    } else if (k.line !== undefined) {
      if (!Array.isArray(k.line) || k.line.length !== 4 || !k.line.every(isNum)) return void out.push(`${where}.line must be [x, y, x, y]`);
      const [x0, y0, x1, y1] = k.line;
      if (!placed(k)) out.push(storeyed ? `${where}.line lies inside no one storey's crop` : `${where}.line has an end outside the crop`);
      if (x0 === x1 && y0 === y1) out.push(`${where}.line has no length`);
      if (!LINE_STATES.includes(k.is)) out.push(`${where}.is must be ${LINE_STATES.join(", ")} for a line`);
    } else {
      if (!Array.isArray(k.at) || k.at.length !== 2 || !k.at.every(isNum)) return void out.push(`${where}.at must be [x, y]`);
      if (!placed(k)) out.push(storeyed ? `${where}.at lies inside no storey's crop` : `${where}.at lies outside the crop`);
      const drops = AT_DROPS[walls.mode] ?? ["island"];
      if (!drops.includes(k.drop)) out.push(`${where}.drop must be ${drops.map((v) => `"${v}"`).join(" or ")} in ${walls.mode} mode`);
    }
    const key = correctionKey(k);
    if (seen.has(key)) out.push(`${where} asserts ${key} a second time`);
    seen.add(key);
  });
  return out;
}

/**
 * A recipe's corrections past the budget and within the cap, as one sentence
 * prefixed `walls` for the lint and the compiler to warn with; empty within
 * the budget, and past the cap, which `wallsProblems` refuses.
 */
export function wallsWarnings(walls, recipe) {
  const lattice = wallLattice(recipe);
  const list = walls?.corrections;
  if (!lattice || !Array.isArray(list)) return [];
  const storeys = 1 + storeyCrops(recipe).length;
  const budget = correctionBudget(lattice, storeys);
  const weight = correctionWeight(list);
  if (weight <= budget || weight > correctionCap(lattice, storeys)) return [];
  return [`walls.corrections weigh ${weight} (a box ${BOX_WEIGHT}), over the budget of ${budget} (${CORRECTION_SHARE * 100}% of ${latticeText(lattice, storeys)})`];
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
 * correction flips the component at its point, never the largest component
 * of its value: that is the plan's floor or the rock framing it, and flipping
 * either inverts the plan. Returns how many points dropped an island and how
 * many were refused.
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
  let dropped = 0, refused = 0;
  for (const [px, py] of islands) {
    const x = Math.round(px), y = Math.round(py);
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    // Labelled again for every point, because an island an earlier point
    // flipped has joined whatever surrounded it.
    const { lab, comps } = components(rock, w, h, rock[y * w + x]);
    const largest = comps.reduce((a, b) => (b.area > a.area ? b : a));
    if (lab[y * w + x] === largest.id) refused++;
    else if (flipComponentAt(rock, w, h, x, y)) dropped++;
  }
  return { dropped, refused };
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

/**
 * The corrections sorted by what they assert, `at` points carried into render
 * pixels, each line made the wall segment it asserts, and each rect made four
 * terrain lines.
 */
function readCorrections(list, crop, scale) {
  const cells = new Map();
  const edges = new Map();
  const islands = [];
  const doorDrops = [];
  const windowDrops = [];
  const boxes = [];
  const lines = [];
  const px = (x, y) => [(x - crop.x) * scale, (y - crop.y) * scale];
  for (const k of list ?? []) {
    if (k.cell) cells.set(`${k.cell[0]},${k.cell[1]}`, k.is);
    else if (k.edge) edges.set(`${k.edge[0]},${k.edge[1]},${k.edge[2]}`, k.is);
    else if (k.box) boxes.push(k.box);
    else if (k.rect) {
      const p = rectCorners(k.rect).map(([x, y]) => px(x, y));
      for (let i = 0; i < 4; i++) lines.push({ c: [...p[i], ...p[(i + 1) % 4]], door: DOOR.none, terrain: true });
    } else if (k.line) {
      const c = [...px(k.line[0], k.line[1]), ...px(k.line[2], k.line[3])];
      lines.push(k.is === "terrain" ? { c, door: DOOR.none, terrain: true } : k.is === "invisible" ? { c, door: DOOR.none, invisible: true } : { c, door: doorOf(k.is) });
    } else if (k.at) (k.drop === "door" ? doorDrops : k.drop === "window" ? windowDrops : islands).push(px(k.at[0], k.at[1]));
  }
  return { cells, edges, islands, doorDrops, windowDrops, boxes, lines };
}

/** The four sides of each terrain box, on the lattice lines it names. */
const boxSides = (L, boxes) => boxes.flatMap(([c0, r0, c1, r1]) => {
  const x0 = L.cellX(c0), y0 = L.cellY(r0), x1 = L.cellX(c1), y1 = L.cellY(r1);
  return [[x0, y0, x1, y0], [x1, y0, x1, y1], [x0, y1, x1, y1], [x0, y0, x0, y1]].map((c) => ({ c, door: DOOR.none, terrain: true }));
});

/** How far a point lies from a segment. */
function pointToSegment(px, py, [ax, ay, bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** How far along a ray from `p` in unit direction `u` it meets segment `c`, or null. */
function rayToSegment(p, u, [x1, y1, x2, y2]) {
  const ex = x2 - x1, ey = y2 - y1;
  const den = u[0] * ey - u[1] * ex;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((x1 - p[0]) * ey - (y1 - p[1]) * ex) / den;
  const s = ((x1 - p[0]) * u[1] - (y1 - p[1]) * u[0]) / den;
  return t >= 0 && s >= 0 && s < 1 ? t : null;
}

/**
 * Rays a point casts to tell inside a closed outline from outside, skewed off
 * the axes so none runs along a snapped wall or through its corners.
 */
const PARITY_RAYS = Object.freeze([[1, 0.0137], [-1, 0.0213], [0.0171, 1], [0.0119, -1], [0.7071, 0.7171]].map(([x, y]) => [x / Math.hypot(x, y), y / Math.hypot(x, y)]));

/** Whether `p` lies inside the closed loops `segs` draw: most rays cross them an odd number of times. */
function insideLoops(p, segs) {
  let odd = 0;
  for (const u of PARITY_RAYS) {
    let n = 0;
    for (const { c } of segs) if (rayToSegment(p, u, c) !== null) n++;
    odd += n % 2;
  }
  return odd > PARITY_RAYS.length / 2;
}

/**
 * A door whose end lies on the floor side of the outline reaches along its
 * line to the nearest wall within `reach`, so the passage it stands in is
 * closed to sight as well as to movement. A closed end crosses its wall by
 * `margin`, so rounding to whole scene pixels cannot reopen a hairline.
 */
function closeDoor(door, outline, reach, margin) {
  const [ax, ay, bx, by] = door.c;
  const len = Math.hypot(bx - ax, by - ay);
  if (!len) return door;
  const u = [(bx - ax) / len, (by - ay) / len];
  const nearest = (p, dir) => {
    let near = Infinity;
    for (const { c } of outline) {
      const t = rayToSegment(p, dir, c);
      if (t !== null && t < near) near = t;
    }
    return near;
  };
  const extend = (p, dir) => {
    const step = insideLoops(p, outline)
      ? (nearest(p, dir) <= reach ? nearest(p, dir) + margin : 0)
      : Math.max(0, margin - nearest(p, [-dir[0], -dir[1]]));
    return [p[0] + dir[0] * step, p[1] + dir[1] * step];
  };
  const a = extend([ax, ay], [-u[0], -u[1]]);
  const b = extend([bx, by], u);
  return { ...door, c: [a[0], a[1], b[0], b[1]] };
}

/** A door type from an asserted state. */
const doorOf = (state) => (state === "secret" ? DOOR.secret : state === "door" ? DOOR.door : DOOR.none);

/**
 * A segment with the part inside a box cut out (Liang–Barsky): none, one or
 * two pieces, each a little longer than nothing and of the segment's kind.
 */
function cutBox(s, x0, y0, x1, y1) {
  const [ax, ay, bx, by] = s.c;
  const dx = bx - ax, dy = by - ay;
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]]) {
    if (p === 0) {
      if (q < 0) return [s];
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return [s];
  }
  const at = (t) => [ax + dx * t, ay + dy * t];
  const out = [];
  if (t0 > 1e-6) out.push({ ...s, c: [ax, ay, ...at(t0)] });
  if (t1 < 1 - 1e-6) out.push({ ...s, c: [...at(t1), bx, by] });
  return out.filter((p) => Math.hypot(p.c[2] - p.c[0], p.c[3] - p.c[1]) >= 1);
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

/**
 * A mode's walls with its line corrections laid over them, last of all. A
 * door or secret line replaces every traced door whose middle lies within half
 * a cell of it, and closes against `outline` when the mode gives one; a line of
 * any kind replaces a traced door or window lying along it, both ends within a
 * few pixels of the line, so a box that is not a door, or a gap read for a
 * window that is a doorway, is restated by one line. Every line then stands
 * as the segment it asserts.
 * @returns {{walls: object[], replaced: number}} `replaced` counts the traced doors a line replaced
 */
function applyLines(walls, L, lines, outline) {
  const doors = lines.filter((l) => l.door);
  const near = (s) => doors.some((l) => pointToSegment((s.c[0] + s.c[2]) / 2, (s.c[1] + s.c[3]) / 2, l.c) <= 0.5 * L.pitch);
  const tol = 0.15 * L.pitch;
  const along = (s) => lines.some((l) => pointToSegment(s.c[0], s.c[1], l.c) <= tol && pointToSegment(s.c[2], s.c[3], l.c) <= tol);
  const doorGone = (s) => s.door && (near(s) || along(s));
  const kept = walls.filter((s) => !doorGone(s) && !(s.invisible && along(s)));
  const drawn = lines.map((l) => (l.door && outline ? closeDoor(l, outline, 0.25 * L.pitch, 0.02 * L.pitch) : l));
  return { walls: [...kept, ...drawn], replaced: walls.filter(doorGone).length };
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
 * The ink across an opening `n` cells long on a wall line, from cell
 * `(i, j)`, its passage running north–south when `ns`. Each scan line runs
 * across the gap and is read along the passage a quarter cell past both cell
 * edges, as runs of ink; the scan lines stop 0.15 cell short of the opening's
 * ends. The grid line hugging a cell edge is dark on nearly every scan line
 * and is dropped, and a label's masked ink is never read.
 * @returns {{lines: {u: number, runs: number[][]}[], start: number, len: number, ink: (u: number, v: number) => boolean}}
 *   `start` and `len` place the opening along the wall line, in render pixels
 */
function scanGap(gray, w, ringMask, L, i, j, ns, n = 1) {
  const x0 = Math.round(L.cellX(i)), x1 = Math.round(L.cellX(i + (ns ? n : 1)));
  const y0 = Math.round(L.cellY(j)), y1 = Math.round(L.cellY(j + (ns ? 1 : n)));
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
    let k = 0;
    for (let u = lo; u < hi; u++) if (at(u, v)) k++;
    if (k / (hi - lo) >= 0.85) persist.add(v);
  }
  const ink = (u, v) => !persist.has(v) && at(u, v);
  const lines = [];
  for (let u = lo; u < hi; u++) {
    const runs = [];
    let from = -1;
    for (let v = a0; v <= a1; v++) {
      const d = v < a1 && ink(u, v);
      if (d && from < 0) from = v;
      if (!d && from >= 0) {
        runs.push([from, v - 1]);
        from = -1;
      }
    }
    lines.push({ u, runs });
  }
  const start = ns ? x0 : y0;
  return { lines, start, len: (ns ? x1 : y1) - start, ink };
}

/**
 * How a one-cell throat reads: `open`, a `door` (an outline: two runs of ink
 * across the gap) or a `symbol` (one run: a portcullis, a bar).
 */
function throatKind(gray, w, ringMask, L, i, j, ns) {
  const { lines } = scanGap(gray, w, ringMask, L, i, j, ns);
  const spanned = lines.filter((l) => l.runs.length).length;
  const doubled = lines.filter((l) => l.runs.length >= 2).length;
  const span = lines.length ? spanned / lines.length : 0;
  const dbl = spanned ? doubled / spanned : 0;
  return span < 0.75 ? "open" : dbl >= 0.45 ? "door" : "symbol";
}

/**
 * Where a door box split by a bar draws its centre line, across the passage,
 * and its bar, along the opening; null for any other glyph. Most scan lines
 * across a box cross its two long lines, and the centre line runs midway
 * between them; a scan line on the bar finds the gap between them inked
 * through. A bar counts only in the middle of the opening and with the box's
 * two lines on both sides of it within a fifth of a cell, so the end of a
 * box, where its lines close against the rock, is no bar.
 * @returns {{line: number, bar: number}|null} render-pixel positions: `line` along the passage, `bar` along the opening
 */
function splitBox(gray, w, ringMask, L, i, j, ns, n) {
  const { lines, start, len, ink } = scanGap(gray, w, ringMask, L, i, j, ns, n);
  const two = lines.filter((l) => l.runs.length === 2);
  if (two.length < 3) return null;
  const median = (a) => [...a].sort((p, q) => p - q)[a.length >> 1];
  const line0 = median(two.map((l) => (l.runs[0][0] + l.runs[0][1]) / 2));
  const line1 = median(two.map((l) => (l.runs[1][0] + l.runs[1][1]) / 2));
  const in0 = median(two.map((l) => l.runs[0][1]));
  const in1 = median(two.map((l) => l.runs[1][0]));
  if (in1 - in0 < 2) return null;
  const rows = lines.map(({ u, runs }) => {
    let k = 0;
    for (let v = in0 + 1; v < in1; v++) if (ink(u, v)) k++;
    return { u, bar: k / (in1 - in0 - 1) >= 0.8, two: runs.length === 2 };
  });
  const flank = Math.round(0.2 * L.pitch), gap = Math.max(1, Math.round(0.03 * L.pitch));
  const boxed = (u0, u1) => {
    const near = rows.filter((r) => r.u >= u0 && r.u <= u1);
    return near.length > 0 && near.filter((r) => r.two).length >= 0.6 * near.length;
  };
  for (let k = 0; k < rows.length; k++) {
    if (!rows[k].bar) continue;
    let e = k;
    while (e + 1 < rows.length && rows[e + 1].bar) e++;
    const middle = ((rows[k].u + rows[e].u) / 2 - start) / len;
    if (middle >= 0.3 && middle <= 0.7 && boxed(rows[k].u - flank, rows[k].u - gap) && boxed(rows[e].u + gap, rows[e].u + flank)) {
      return { line: (line0 + line1) / 2, bar: (rows[k].u + rows[e].u) / 2 };
    }
    k = e;
  }
  return null;
}

/** grid mode: cells classed by floor share, walls on cell edges, doors in throats. */
function traceGrid(gray, w, h, threshold, L, corr) {
  const rock = rockMask(gray, w, h, threshold, L.pitch);
  const isl = cleanRock(rock, w, h, L.pitch, corr.islands);
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
  // Past the lattice's border lies the crop's partial strip. A floor cell on
  // the border is walled there only where that strip is a quarter cell deep
  // or more and mostly rock: a shallower strip is no evidence of a wall, and
  // floor running into it is a room the crop cuts, which the crop's own edge
  // does not close.
  const pastWall = (x0, y0, x1, y1) => {
    x0 = Math.max(0, Math.round(x0));
    y0 = Math.max(0, Math.round(y0));
    x1 = Math.min(w, Math.round(x1));
    y1 = Math.min(h, Math.round(y1));
    if (Math.min(x1 - x0, y1 - y0) < 0.25 * L.pitch) return false;
    let r = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) r += rock[y * w + x];
    return r >= 0.5 * (x1 - x0) * (y1 - y0);
  };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const wall = i === 0 ? isFloor(0, j) && pastWall(0, L.cellY(j), L.cellX(0), L.cellY(j + 1))
        : i === nx ? isFloor(nx - 1, j) && pastWall(L.cellX(nx), L.cellY(j), w, L.cellY(j + 1))
          : isFloor(i - 1, j) !== isFloor(i, j);
      if (wall) vEdge[j * (nx + 1) + i] = EDGE.wall;
    }
  }
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i < nx; i++) {
      const wall = j === 0 ? isFloor(i, 0) && pastWall(L.cellX(i), 0, L.cellX(i + 1), L.cellY(0))
        : j === ny ? isFloor(i, ny - 1) && pastWall(L.cellX(i), L.cellY(ny), L.cellX(i + 1), h)
          : isFloor(i, j - 1) !== isFloor(i, j);
      if (wall) hEdge[j * nx + i] = EDGE.wall;
    }
  }
  // A terrain box's side stands wherever no traced wall does; an edge
  // correction then overrides either.
  for (const [c0, r0, c1, r1] of corr.boxes) {
    for (let i = c0; i < c1; i++) for (const j of [r0, r1]) hEdge[j * nx + i] ||= EDGE.terrain;
    for (let j = r0; j < r1; j++) for (const i of [c0, c1]) vEdge[j * (nx + 1) + i] ||= EDGE.terrain;
  }
  for (const [key, state] of corr.edges) {
    const [si, sj, side] = key.split(",");
    const i = Number(si), j = Number(sj);
    if (side === "w") vEdge[j * (nx + 1) + i] = EDGE[state];
    else hEdge[j * nx + i] = EDGE[state];
  }

  // Along one lattice line, a run of wall edges joins into one segment and a
  // run of terrain into another; each door edge is a segment of its own.
  const walls = [];
  const kindOf = (s) => (s === EDGE.terrain ? { door: DOOR.none, terrain: true } : { door: s === EDGE.secret ? DOOR.secret : s === EDGE.door ? DOOR.door : DOOR.none });
  const runLine = (count, stateAt, seg) => {
    let from = null, kind = EDGE.open;
    for (let k = 0; k <= count; k++) {
      const s = k < count ? stateAt(k) : EDGE.open;
      if (from !== null && s !== kind) {
        walls.push({ c: seg(from, k), ...kindOf(kind) });
        from = null;
      }
      if ((s === EDGE.wall || s === EDGE.terrain) && from === null) {
        from = k;
        kind = s;
      }
      if (s === EDGE.door || s === EDGE.secret) walls.push({ c: seg(k, k + 1), ...kindOf(s) });
    }
  };
  for (let i = 0; i <= nx; i++) runLine(ny, (j) => vEdge[j * (nx + 1) + i], (a, b) => [L.cellX(i), L.cellY(a), L.cellX(i), L.cellY(b)]);
  for (let j = 0; j <= ny; j++) runLine(nx, (i) => hEdge[j * nx + i], (a, b) => [L.cellX(a), L.cellY(j), L.cellX(b), L.cellY(j)]);

  // An opening is a run of door cells along one wall line, which only
  // asserted cells form, for a traced throat has rock on both flanks. A door
  // box split by a bar is a double door: two leaves on the box's centre line,
  // one from each end of the opening, meeting at the bar. Any other door
  // stands across each cell's middle. A secret door stands on both mouths of
  // its cell, so the wall reads whole from either side.
  const kinds = { door: 0, symbol: 0, secret: 0, open: 0 };
  let splitBoxes = 0;
  const doorAt = (i, j, ns) => {
    const t = passages.get(`${i},${j}`);
    return !!t && t.kind === "door" && t.ns === ns;
  };
  const middleDoor = (i, j, ns) => {
    const cx = L.cellX(i) + L.ppx / 2, cy = L.cellY(j) + L.ppy / 2;
    walls.push({ c: ns ? [L.cellX(i), cy, L.cellX(i + 1), cy] : [cx, L.cellY(j), cx, L.cellY(j + 1)], door: DOOR.door });
  };
  for (const t of passages.values()) {
    kinds[t.kind] = (kinds[t.kind] ?? 0) + 1;
    if (t.kind === "open") continue;
    const x0 = L.cellX(t.i), y0 = L.cellY(t.j), x1 = L.cellX(t.i + 1), y1 = L.cellY(t.j + 1);
    if (t.kind === "secret") {
      for (const c of t.ns ? [[x0, y0, x1, y0], [x0, y1, x1, y1]] : [[x0, y0, x0, y1], [x1, y0, x1, y1]]) walls.push({ c, door: DOOR.secret });
      continue;
    }
    if (t.kind !== "door") {
      middleDoor(t.i, t.j, t.ns);
      continue;
    }
    if (t.ns ? doorAt(t.i - 1, t.j, true) : doorAt(t.i, t.j - 1, false)) continue;
    let n = 1;
    while (t.ns ? doorAt(t.i + n, t.j, true) : doorAt(t.i, t.j + n, false)) n++;
    const box = splitBox(gray, w, ringMask, L, t.i, t.j, t.ns, n);
    if (box) {
      splitBoxes++;
      const a = t.ns ? x0 : y0, b = t.ns ? L.cellX(t.i + n) : L.cellY(t.j + n), v = box.line;
      for (const [p, q] of [[a, box.bar], [box.bar, b]]) walls.push({ c: t.ns ? [p, v, q, v] : [v, p, v, q], door: DOOR.door });
    } else {
      for (let k = 0; k < n; k++) middleDoor(t.ns ? t.i + k : t.i, t.ns ? t.j : t.j + k, t.ns);
    }
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
      throats: kinds, splitBoxes, labels: rings.length, islandsDropped: isl.dropped, islandsRefused: isl.refused, cellFixes, unplaced,
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
 * cell long, standing on floor, with rock within a quarter cell of both ends
 * and floor beyond both long sides. A door stands in a passage; a light
 * sliver between a rock edge and a grid line has rock on one side.
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
    const side = Math.round(short / 2 + 0.3 * pitch);
    const passage = horiz ? !rockAt(cx, cy - side) && !rockAt(cx, cy + side) : !rockAt(cx - side, cy) && !rockAt(cx + side, cy);
    if (endA && endB && passage) doors.push({ c: horiz ? [c.minx, cy, c.maxx + 1, cy] : [cx, c.miny, cx, c.maxy + 1], door: DOOR.door });
  }
  return doors;
}

/**
 * Close a rock mask in place by a square of radius `e`: paper narrower than
 * the square between two rocks becomes rock. Outside the crop is rock, as
 * `cleanRock` counts it, so rock running off the crop's edge is not eaten
 * back from that edge.
 */
function closeRock(rock, w, h, e) {
  const W = w + 2 * e, H = h + 2 * e;
  const pad = new Uint8Array(W * H).fill(1);
  for (let y = 0; y < h; y++) pad.set(rock.subarray(y * w, (y + 1) * w), (y + e) * W + e);
  const shut = morph(morph(pad, W, H, e, false), W, H, e, true);
  for (let y = 0; y < h; y++) rock.set(shut.subarray((y + e) * W + e, (y + e) * W + e + w), y * w);
}

/** hatch mode: contour mode over rock cleared of `HATCH_SPECK` marks and closed by `HATCH_CLOSE`. */
const traceHatch = (gray, w, h, threshold, L, corr) => traceContour(gray, w, h, threshold, L, corr, { close: HATCH_CLOSE, speck: HATCH_SPECK });

/**
 * contour mode: walls on the floor's own outline, snapped to grid lines where
 * they run along one. A `close` share closes the rock first (`closeRock`),
 * once each rock under a `speck` share of a cell's area is floor, and before
 * islands are judged on it.
 */
function traceContour(gray, w, h, threshold, L, corr, { close = 0, speck = 0 } = {}) {
  const rock = rockMask(gray, w, h, threshold, L.pitch);
  if (speck) {
    const { lab, comps } = components(rock, w, h, 1);
    const kill = new Uint8Array(comps.length);
    for (const c of comps) if (c.area < speck * L.pitch * L.pitch) kill[c.id] = 1;
    for (let i = 0; i < rock.length; i++) if (rock[i] && kill[lab[i]]) rock[i] = 0;
  }
  if (close) closeRock(rock, w, h, Math.max(1, Math.round(close * L.pitch)));
  const isl = cleanRock(rock, w, h, L.pitch, corr.islands);
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
  // The crop's own edge is no wall: an outline running along the render's
  // border is floor the crop cuts. Simplifying can drop the corner where the
  // outline leaves the border, so a segment runs along it when both its ends
  // lie within the simplifying tolerance of one edge.
  const onBorder = ([ax, ay], [bx, by]) => Math.max(ax, bx) <= eps || Math.min(ax, bx) >= w - eps || Math.max(ay, by) <= eps || Math.min(ay, by) >= h - eps;
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
    for (let i = 0; i + 1 < poly.length; i++) if (!onBorder(poly[i], poly[i + 1])) segs.push([...poly[i], ...poly[i + 1]]);
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

  // A dropped door is the drawn door nearest the correction's point, within
  // half a cell; a point with none that near drops nothing.
  let doorsDropped = 0;
  for (const [px, py] of corr.doorDrops) {
    let best = -1;
    let near = 0.5 * L.pitch;
    walls.forEach((s, k) => {
      if (!s.door) return;
      const d = pointToSegment(px, py, s.c);
      if (d <= near) {
        near = d;
        best = k;
      }
    });
    if (best < 0) continue;
    walls.splice(best, 1);
    doorsDropped++;
  }

  // A door asserted on a cell lies across it, perpendicular to the axis whose
  // two neighbours hold more floor; a secret door lies on both mouths of the
  // cell instead, so the wall reads whole from either side.
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
    const across = state === "secret"
      ? (ns ? [[x0, y0, x1, y0], [x0, y1, x1, y1]] : [[x0, y0, x0, y1], [x1, y0, x1, y1]])
      : [ns ? [x0, cy, x1, cy] : [cx, y0, cx, y1]];
    for (const c of across) walls.push({ c, door: doorOf(state) });
  }
  // Simplifying and snapping move the outline off the drawn jambs, so a door
  // can stop short of its wall; it is closed against the outline before any
  // cell or edge correction opens a loop.
  const outline = walls.filter((s) => !s.door);
  walls = walls.map((s) => (s.door ? closeDoor(s, outline, 0.25 * L.pitch, 0.02 * L.pitch) : s));
  walls = correctSegments([...walls, ...boxSides(L, corr.boxes)], L, corr);
  return {
    walls,
    outline,
    digest: { cells: L.cols * L.rows, loops, islandsDropped: isl.dropped, islandsRefused: isl.refused, doorsDropped, cellFixes, unplaced },
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

/**
 * How deep each stroke pixel lies in its stroke: the chamfer distance, in
 * pixels, to the nearest pixel off it. At a skeleton pixel it is half the
 * stroke's width there.
 */
function strokeDepth(mask, w, h) {
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 1e9 : 0;
  const D = Math.SQRT2;
  const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? d[y * w + x] : 0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (d[i]) d[i] = Math.min(d[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + D, at(x + 1, y - 1) + D);
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (d[i]) d[i] = Math.min(d[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + D, at(x - 1, y + 1) + D);
    }
  }
  return d;
}

/**
 * A skeleton as a graph. Pixels with other than two skeleton neighbours are
 * nodes, and nodes that touch are one node at their centroid, so a junction
 * or a staircase corner is one point every path through it ends on. Each
 * path runs from node to node (`a`, `b`, node ids) as pixel points, its ends
 * on the nodes' centroids; a ring with no node is a closed path of its own
 * (`a` and `b` -1).
 * @returns {{nodes: {x: number, y: number, px: number[]}[], paths: {a: number, b: number, pts: number[][], closed: boolean}[]}}
 */
function strokeGraph(sk, w, h) {
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
  const node = new Int32Array(w * h).fill(-1);
  const nodes = [];
  for (let q = 0; q < sk.length; q++) {
    if (!sk[q] || deg[q] === 2 || node[q] >= 0) continue;
    const id = nodes.length;
    const px = [q];
    node[q] = id;
    for (let k = 0; k < px.length; k++) {
      for (const n of nb(px[k])) {
        if (deg[n] === 2 || node[n] >= 0) continue;
        node[n] = id;
        px.push(n);
      }
    }
    let sx = 0, sy = 0;
    for (const p of px) {
      sx += p % w;
      sy += (p / w) | 0;
    }
    nodes.push({ x: sx / px.length, y: sy / px.length, px });
  }
  const seen = new Uint8Array(w * h);
  const xy = (q) => [q % w, (q / w) | 0];
  const paths = [];
  for (const [id, n] of nodes.entries()) {
    for (const q of n.px) {
      for (const n0 of nb(q)) {
        if (deg[n0] !== 2 || seen[n0]) continue;
        const pts = [[n.x, n.y]];
        let prev = q, cur = n0;
        while (deg[cur] === 2 && !seen[cur]) {
          seen[cur] = 1;
          pts.push(xy(cur));
          const next = nb(cur).find((z) => z !== prev);
          prev = cur;
          cur = next;
        }
        const b = node[cur];
        if (b < 0) continue;
        pts.push([nodes[b].x, nodes[b].y]);
        paths.push({ a: id, b, pts, closed: false });
      }
    }
  }
  for (let q = 0; q < sk.length; q++) {
    if (!sk[q] || deg[q] !== 2 || seen[q]) continue;
    const pts = [];
    let prev = nb(q)[0], cur = q;
    while (!seen[cur]) {
      seen[cur] = 1;
      pts.push(xy(cur));
      const next = nb(cur).find((z) => z !== prev);
      prev = cur;
      cur = next;
    }
    pts.push(pts[0]);
    paths.push({ a: -1, b: -1, pts, closed: true });
  }
  return { nodes, paths };
}

/** A polyline's length. */
const polyLength = (pts) => {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return n;
};

/**
 * The doors a stroke plan draws: a box of paper closed by its outline, set
 * across a wall line. A paper component (at the stroke's own cut) is a box
 * shape when it fills most of a rectangle a fifth of a cell to two and a
 * half cells long and under half a cell across; an elongated one is read
 * along its principal axis, so a box drawn at an angle stands at its angle,
 * and a near-square one along each axis of the page. Two shapes end to end
 * on one line, a bar's width apart, are one box split by its bar. A box
 * stands as a door when a wall lies within a third of a cell beyond both of
 * its ends and floor beyond both of its long sides: a bed, a bench or a table
 * against a wall has the wall along a long side, and an archway is floor that
 * never closes. Each box is its centre, its unit axis `u`, its half length
 * `hl` and half width `hw`, whether a bar splits it, and where its bar
 * stands when one does.
 * @returns {{c: number[], u: number[], hl: number, hw: number, split: boolean, bar?: number[]}[]}
 */
function drawnBoxes(gray, thick, w, h, cut, L) {
  const pitch = L.pitch;
  // Paper at the stroke's cut. A lattice line drawn one pixel thin across
  // paper is paper too, so a box the lattice crosses stays one box; then the
  // paper is eroded by a pixel, so an outline the render drew thin still
  // closes its box.
  const paper = new Uint8Array(w * h);
  for (let i = 0; i < paper.length; i++) paper[i] = gray[i] >= cut ? 1 : 0;
  const isPaper = (x, y) => x >= 0 && y >= 0 && x < w && y < h && gray[y * w + x] >= cut;
  for (let k = Math.ceil(-L.ox / L.ppx); L.cellX(k) < w; k++) {
    const gx = L.cellX(k);
    for (let x = Math.max(0, Math.ceil(gx - 1)); x <= Math.min(w - 1, Math.floor(gx + 1)); x++) {
      for (let y = 0; y < h; y++) if (!paper[y * w + x] && isPaper(x - 1, y) && isPaper(x + 1, y)) paper[y * w + x] = 1;
    }
  }
  for (let k = Math.ceil(-L.oy / L.ppy); L.cellY(k) < h; k++) {
    const gy = L.cellY(k);
    for (let y = Math.max(0, Math.ceil(gy - 1)); y <= Math.min(h - 1, Math.floor(gy + 1)); y++) {
      for (let x = 0; x < w; x++) if (!paper[y * w + x] && isPaper(x, y - 1) && isPaper(x, y + 1)) paper[y * w + x] = 1;
    }
  }
  const light = morph(paper, w, h, 1, true);
  const { lab, comps } = components(light, w, h, 1);
  const sums = new Map();
  for (const c of comps) {
    const bw = c.maxx - c.minx + 1, bh = c.maxy - c.miny + 1;
    if (Math.max(bw, bh) < 0.15 * pitch || Math.max(bw, bh) > 2.6 * pitch || c.area > 1.2 * pitch * pitch || c.area < 0.012 * pitch * pitch) continue;
    sums.set(c.id, { id: c.id, n: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0, px: [] });
  }
  for (let i = 0; i < lab.length; i++) {
    const m = sums.get(lab[i]);
    if (!m) continue;
    const x = i % w, y = (i / w) | 0;
    m.n++;
    m.sx += x;
    m.sy += y;
    m.sxx += x * x;
    m.syy += y * y;
    m.sxy += x * y;
    m.px.push(i);
  }
  const shapes = [];
  for (const m of sums.values()) {
    const cx = m.sx / m.n, cy = m.sy / m.n;
    const vxx = m.sxx / m.n - cx * cx, vyy = m.syy / m.n - cy * cy, vxy = m.sxy / m.n - cx * cy;
    const spread = Math.sqrt((vxx - vyy) ** 2 + 4 * vxy * vxy);
    const ratio = Math.sqrt((vxx + vyy + spread) / Math.max(1e-9, vxx + vyy - spread));
    const ang = 0.5 * Math.atan2(2 * vxy, vxx - vyy);
    for (const u of ratio >= 1.4 ? [[Math.cos(ang), Math.sin(ang)]] : [[1, 0], [0, 1]]) {
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const i of m.px) {
        const dx = (i % w) - cx, dy = ((i / w) | 0) - cy;
        const a = dx * u[0] + dy * u[1], b = -dx * u[1] + dy * u[0];
        if (a < a0) a0 = a;
        if (a > a1) a1 = a;
        if (b < b0) b0 = b;
        if (b > b1) b1 = b;
      }
      // The erosion took a pixel off every side; it is given back here.
      const len = a1 - a0 + 3, wid = b1 - b0 + 3;
      if (len < 0.2 * pitch || len > 2.5 * pitch || wid < 0.06 * pitch || wid > 0.5 * pitch || m.n < 0.6 * (len - 2) * (wid - 2)) continue;
      const c = [cx + u[0] * (a0 + a1) / 2 - u[1] * (b0 + b1) / 2, cy + u[1] * (a0 + a1) / 2 + u[0] * (b0 + b1) / 2];
      shapes.push({ c, u, hl: len / 2, hw: wid / 2, split: false, comps: [m.id] });
    }
  }
  const merged = [];
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const A = shapes[i], B = shapes[j];
      if (A.comps[0] === B.comps[0] || Math.abs(A.u[0] * B.u[0] + A.u[1] * B.u[1]) < 0.97) continue;
      const dx = B.c[0] - A.c[0], dy = B.c[1] - A.c[1];
      const along = dx * A.u[0] + dy * A.u[1], across = Math.abs(-dx * A.u[1] + dy * A.u[0]);
      const bar = Math.abs(along) - A.hl - B.hl;
      if (across > 0.1 * pitch || bar < -1 || bar > 0.15 * pitch || Math.abs(A.hw - B.hw) > 0.35 * Math.max(A.hw, B.hw)) continue;
      const s = Math.sign(along) || 1;
      const lo = -A.hl, hi = Math.abs(along) + B.hl, mid = (lo + hi) / 2, gap = (A.hl + Math.abs(along) - B.hl) / 2;
      const at = (t) => [A.c[0] + A.u[0] * s * t, A.c[1] + A.u[1] * s * t];
      merged.push({ c: at(mid), u: A.u, hl: (hi - lo) / 2, hw: Math.max(A.hw, B.hw), split: true, bar: at(gap), comps: [A.comps[0], B.comps[0]] });
    }
  }
  const wallAt = (x, y) => {
    x = Math.round(x);
    y = Math.round(y);
    return x >= 0 && y >= 0 && x < w && y < h && thick[y * w + x] === 1;
  };
  const stands = ({ c, u, hl, hw }) => {
    const n = [-u[1], u[0]];
    const at = (a, b) => [c[0] + u[0] * a + n[0] * b, c[1] + u[1] * a + n[1] * b];
    const reach = Math.round(0.33 * pitch);
    const endWall = (sgn) => {
      for (let d = 1; d <= reach; d++) {
        for (const b of [-0.5 * hw, 0, 0.5 * hw]) if (wallAt(...at(sgn * (hl + d), b))) return true;
      }
      return false;
    };
    const side = hw + Math.max(3, 0.12 * pitch);
    const floorSide = (sgn) => [-0.5, 0, 0.5].every((f) => !wallAt(...at(f * hl, sgn * side)));
    return endWall(1) && endWall(-1) && floorSide(1) && floorSide(-1);
  };
  const used = new Set();
  const boxes = [];
  for (const b of [...merged, ...shapes]) {
    if (b.comps.some((id) => used.has(id)) || !stands(b)) continue;
    for (const id of b.comps) used.add(id);
    boxes.push({ c: b.c, u: b.u, hl: b.hl, hw: b.hw, split: b.split, bar: b.bar });
  }
  return boxes;
}

/** A window's throat is no wider than this share of a cell. */
const WINDOW_WIDTH = 0.5;

/** Each jamb of a window runs on along its throat at least this share of a cell... */
const WINDOW_JAMB = 0.4;

/** ...and at least this many times its own band's thickness, so a round blob is no jamb. */
const WINDOW_ELONGATION = 1.5;

/** A window's gap widens past its throat by this factor while both jambs still stand beside it. */
const WINDOW_SPLAY = 1.2;

/**
 * The windows in a stroke plan's opened ink, each as its throat: the
 * narrowest paper crossing between two facing jambs, no wider than
 * `WINDOW_WIDTH` of a cell, whose gap widens past it by `WINDOW_SPLAY` while
 * both jambs still stand on either side. That is a splayed jamb or a notch
 * cut down to a slit; a doorway's square jambs keep their width and are no
 * window. A jamb runs on along the crossing at least `WINDOW_JAMB` of a cell
 * and `WINDOW_ELONGATION` times its band's thickness, read as the
 * second-thinnest of four cross-sections near its end, so a junction behind
 * it is not read as its band and a mark's tapered point is not either. A
 * window dropped by a correction point within half a cell of its throat is
 * left as drawn. Shortest first, one to each third of a cell.
 * @returns {{a: number[], b: number[]}[]} each throat's two ink ends, in render pixels
 */
function windowThroats(thick, w, h, pitch, drops) {
  const wmax = WINDOW_WIDTH * pitch, reach = 2 * wmax, kmax = Math.round(0.3 * pitch), jamb = WINDOW_JAMB * pitch;
  const ink = (x, y) => {
    x = Math.round(x);
    y = Math.round(y);
    return x >= 0 && y >= 0 && x < w && y < h && thick[y * w + x] === 1;
  };
  const K = 32, dirs = [];
  for (let k = 0; k < K; k++) dirs.push([Math.cos((2 * Math.PI * k) / K), Math.sin((2 * Math.PI * k) / K)]);
  // The paper run through a point along ±d to the ink on each side; null where a side has none near.
  const gap = (x, y, d) => {
    if (ink(x, y)) return null;
    let a = 0, b = 0;
    while (a < reach && !ink(x - d[0] * (a + 1), y - d[1] * (a + 1))) a++;
    while (b < reach && !ink(x + d[0] * (b + 1), y + d[1] * (b + 1))) b++;
    return a >= reach || b >= reach ? null : { len: a + b + 1, a, b };
  };
  // The length of the ink run through a point along ±v.
  const band = (x, y, v) => {
    let a = 0, b = 0;
    while (a < pitch && ink(x - v[0] * (a + 1), y - v[1] * (a + 1))) a++;
    while (b < pitch && ink(x + v[0] * (b + 1), y + v[1] * (b + 1))) b++;
    return a + b + 1;
  };
  const found = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (thick[i] !== 1 || (thick[i - 1] && thick[i + 1] && thick[i - w] && thick[i + w])) continue;
      for (const d of dirs) {
        if (ink(x + d[0], y + d[1])) continue;
        let t = 1;
        while (t <= wmax && !ink(x + d[0] * t, y + d[1] * t)) t++;
        if (t > wmax || t < 3) continue;
        let ja = 0, jb = 0;
        while (ja < 2 * pitch && ink(x - d[0] * (ja + 1), y - d[1] * (ja + 1))) ja++;
        while (jb < 2 * pitch && ink(x + d[0] * (t + jb), y + d[1] * (t + jb))) jb++;
        if (ja < jamb || jb < jamb) continue;
        const n = [-d[1], d[0]];
        const thickness = (ox, oy, sgn, run) => [0.15, 0.25, 0.35, 0.5]
          .map((f) => band(ox + sgn * d[0] * Math.min(run, pitch) * f, oy + sgn * d[1] * Math.min(run, pitch) * f, n))
          .sort((p, q) => p - q)[1];
        if (ja < WINDOW_ELONGATION * thickness(x, y, -1, ja) || jb < WINDOW_ELONGATION * thickness(x + d[0] * (t - 1), y + d[1] * (t - 1), 1, jb)) continue;
        const m = [x + (d[0] * t) / 2, y + (d[1] * t) / 2];
        const g0 = gap(m[0], m[1], d);
        if (g0 === null) continue;
        // Step off the throat both ways while each side's ink moves smoothly,
        // which is to say while both jambs still stand beside the gap.
        let widest = g0.len, least = g0.len;
        for (const sgn of [-1, 1]) {
          let prev = g0;
          for (let k = 1; k <= kmax; k++) {
            const gk = gap(m[0] + n[0] * sgn * k, m[1] + n[1] * sgn * k, d);
            if (gk === null || Math.abs(gk.a - prev.a) > 3 || Math.abs(gk.b - prev.b) > 3) break;
            prev = gk;
            least = Math.min(least, gk.len);
            widest = Math.max(widest, gk.len);
          }
        }
        if (least < g0.len - 1 || widest < WINDOW_SPLAY * g0.len) continue;
        found.push({ a: [x, y], b: [x + d[0] * (t - 1), y + d[1] * (t - 1)], t, m });
      }
    }
  }
  found.sort((p, q) => p.t - q.t);
  const throats = [];
  for (const f of found) if (!throats.some((g) => Math.hypot(g.m[0] - f.m[0], g.m[1] - f.m[1]) < 0.3 * pitch)) throats.push(f);
  const dropped = new Set();
  for (const [px, py] of drops) {
    let best = -1, near = 0.5 * pitch;
    throats.forEach((g, k) => {
      const dd = Math.hypot(g.m[0] - px, g.m[1] - py);
      if (dd <= near) { near = dd; best = k; }
    });
    if (best >= 0) dropped.add(best);
  }
  return throats.filter((_, k) => !dropped.has(k)).map(({ a, b }) => ({ a, b }));
}

/** A throat drawn into a mask as ink `r` pixels about its line, each pixel it adds labelled `id`. */
function drawBridge(mask, label, w, h, [ax, ay], [bx, by], r, id) {
  const steps = Math.max(1, Math.ceil(2 * Math.hypot(bx - ax, by - ay)));
  for (let i = 0; i <= steps; i++) {
    const cx = ax + ((bx - ax) * i) / steps, cy = ay + ((by - ay) * i) / steps;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = Math.round(cx + dx), y = Math.round(cy + dy);
        if (x < 0 || y < 0 || x >= w || y >= h || dx * dx + dy * dy > r * r || mask[y * w + x]) continue;
        mask[y * w + x] = 1;
        label[y * w + x] = id;
      }
    }
  }
}

/**
 * A path's points cut where they enter or leave a window's bridge, each run
 * sharing its end point with the next and carrying the bridge it lies in, 0
 * for none. A closed path is opened at one of its cuts first.
 * @returns {{id: number, pts: number[][]}[]}
 */
function windowRuns(pts, closed, label, w) {
  const at = ([x, y]) => label[Math.round(y) * w + Math.round(x)];
  if (closed) {
    const k = pts.findIndex((q, i) => at(q) !== at(pts[(i - 1 + pts.length) % pts.length]));
    if (k >= 0) pts = [...pts.slice(k), ...pts.slice(0, k + 1)];
  }
  const runs = [];
  let cur = { id: at(pts[0]), pts: [pts[0]] };
  for (let i = 1; i < pts.length; i++) {
    const id = at(pts[i]);
    if (id !== cur.id) {
      cur.pts.push(pts[i]);
      runs.push(cur);
      cur = { id, pts: [pts[i - 1], pts[i]] };
    } else cur.pts.push(pts[i]);
  }
  runs.push(cur);
  return runs;
}

/**
 * stroke mode: dark strokes opened, each window's throat bridged, compact
 * marks dropped, thinned, and walked node to node; a stroke's corner tines
 * are pruned, each drawn door box stands as a door in its wall, and where a
 * wall runs through a window's bridge it is a wall that senses pass.
 * `opening` is the opening's radius as a share of the cell.
 */
function traceStroke(gray, w, h, threshold, L, corr, { opening = STROKE_OPENING } = {}) {
  const pitch = L.pitch;
  const inkMask = new Uint8Array(w * h);
  for (let i = 0; i < inkMask.length; i++) inkMask[i] = gray[i] < threshold ? 1 : 0;
  // The opening takes away what is thinner than a wall: the lattice, a
  // door's or a bed's outline, hatching and speckle.
  const e = Math.max(1, Math.round(opening * pitch));
  const thick = morph(morph(inkMask, w, h, e, true), w, h, e, false);
  // Bridged before the size cut, so a wall of short blocks between slits is
  // one stroke network, and before thinning, so the centre line runs through
  // each throat.
  const bridges = new Int32Array(w * h);
  windowThroats(thick, w, h, pitch, corr.windowDrops).forEach((g, k) => drawBridge(thick, bridges, w, h, g.a, g.b, e, k + 1));
  {
    // A stroke network spans most of a cell; a component shorter than that on
    // its long side is furniture, a label or an ornament.
    const { lab, comps } = components(thick, w, h, 1);
    const kill = new Uint8Array(comps.length);
    for (const c of comps) if (Math.max(c.maxx - c.minx, c.maxy - c.miny) < 0.9 * pitch) kill[c.id] = 1;
    for (let i = 0; i < thick.length; i++) if (thick[i] && kill[lab[i]]) thick[i] = 0;
  }
  // A dropped mark is never the largest stroke network, which is the plan
  // itself. Dropping a mark only erases it, so one labelling serves every point.
  let dropped = 0, refused = 0;
  const strokes = components(thick, w, h, 1);
  const largest = strokes.comps.reduce((a, b) => (b.area > a.area ? b : a), { id: -1, area: 0 });
  for (const [px, py] of corr.islands) {
    const x = Math.round(px), y = Math.round(py);
    if (x < 0 || y < 0 || x >= w || y >= h || !thick[y * w + x]) continue;
    if (strokes.lab[y * w + x] === largest.id) refused++;
    else if (flipComponentAt(thick, w, h, x, y)) dropped++;
  }
  const doorBoxes = drawnBoxes(gray, thick, w, h, threshold, L);
  const depth = strokeDepth(thick, w, h);
  const skel = thin(thick, w, h);
  const { nodes, paths } = strokeGraph(skel, w, h);
  const nodeDepth = (k) => nodes[k].px.reduce((m, q) => Math.max(m, depth[q]), 0);

  // A band's end thins to a fork whose tines run to its corners, no longer
  // than the band is wide; such a tine is pruned, so the band ends in one
  // point. A short path with no node at either end is a mark, not a wall.
  // A path that runs along a drawn door's axis into the door's end is the wall
  // the door hangs in, however short, and is never a tine.
  const boxEnds = doorBoxes.flatMap((b) => [-1, 1].map((s) => ({ x: b.c[0] + b.u[0] * s * b.hl, y: b.c[1] + b.u[1] * s * b.hl, ux: b.u[0] * s, uy: b.u[1] * s, hw: b.hw })));
  const intoDoor = (free, root) => {
    const f = nodes[free], r = nodes[root];
    const len = Math.hypot(f.x - r.x, f.y - r.y) || 1;
    return boxEnds.some((e) => {
      const ax = f.x - e.x, ay = f.y - e.y;
      const along = ax * e.ux + ay * e.uy, across = Math.abs(-ax * e.uy + ay * e.ux);
      return along >= -0.05 * pitch && along <= 0.33 * pitch && across <= e.hw && -((f.x - r.x) * e.ux + (f.y - r.y) * e.uy) / len >= 0.9;
    });
  };
  const ends = new Int32Array(nodes.length);
  const live = paths.map((p) => {
    const len = polyLength(p.pts);
    return { ...p, len, alive: !(p.closed ? len < pitch : p.a === p.b ? len < 0.5 * pitch : false) };
  });
  for (const p of live) if (p.alive && !p.closed) { ends[p.a]++; ends[p.b]++; }
  let spurs = 0;
  for (let pass = 0, changed = true; changed && pass < 4; pass++) {
    changed = false;
    for (const p of live) {
      if (!p.alive || p.closed) continue;
      const freeA = ends[p.a] === 1, freeB = ends[p.b] === 1;
      const tine = (freeA && ends[p.b] >= 3 && p.len <= 1.5 * nodeDepth(p.b) + 0.1 * pitch && !intoDoor(p.a, p.b))
        || (freeB && ends[p.a] >= 3 && p.len <= 1.5 * nodeDepth(p.a) + 0.1 * pitch && !intoDoor(p.b, p.a));
      const mark = freeA && freeB && p.len < 0.25 * pitch;
      if (!tine && !mark) continue;
      p.alive = false;
      ends[p.a]--;
      ends[p.b]--;
      spurs += tine ? 1 : 0;
      changed = true;
    }
  }

  const eps = Math.max(2, 0.04 * pitch);
  let walls = [];
  const onBridge = ([x, y]) => bridges[Math.round(y) * w + Math.round(x)] > 0;
  for (const p of live) {
    if (!p.alive) continue;
    if (p.pts.some(onBridge)) {
      // Each run is simplified alone, so a window keeps its own segment.
      for (const run of windowRuns(p.pts, p.closed, bridges, w)) {
        const poly = simplify(run.pts, eps);
        for (let i = 0; i + 1 < poly.length; i++) {
          const c = [...poly[i], ...poly[i + 1]];
          walls.push(run.id ? { c, door: DOOR.none, invisible: true, win: run.id } : { c, door: DOOR.none });
        }
      }
      continue;
    }
    let poly;
    if (p.closed) {
      let far = 0, fd = -1;
      for (let i = 0; i < p.pts.length; i++) {
        const dd = Math.hypot(p.pts[i][0] - p.pts[0][0], p.pts[i][1] - p.pts[0][1]);
        if (dd > fd) { fd = dd; far = i; }
      }
      poly = simplify(p.pts.slice(0, far + 1), eps).concat(simplify(p.pts.slice(far), eps).slice(1));
    } else poly = simplify(p.pts, eps);
    for (let i = 0; i + 1 < poly.length; i++) walls.push({ c: [...poly[i], ...poly[i + 1]], door: DOOR.none });
  }

  // A box is never wall: whatever the trace ran through or around it is cut,
  // and the door stands along its axis from end to end, reaching on to the
  // wall end that the cut or the band's own end left within a third of a
  // cell. A split box is two leaves on its centre line, one from each end,
  // meeting at its bar.
  const rectCut = (s, b, padA, padB) => {
    const n = [-b.u[1], b.u[0]];
    const toBox = ([x, y]) => [(x - b.c[0]) * b.u[0] + (y - b.c[1]) * b.u[1], (x - b.c[0]) * n[0] + (y - b.c[1]) * n[1]];
    const fromBox = ([a, v]) => [b.c[0] + b.u[0] * a + n[0] * v, b.c[1] + b.u[1] * a + n[1] * v];
    const p = toBox([s.c[0], s.c[1]]), q = toBox([s.c[2], s.c[3]]);
    return cutBox({ ...s, c: [...p, ...q] }, -b.hl - padA, -b.hw - padB, b.hl + padA, b.hw + padB).map((r) => ({ ...r, c: [...fromBox([r.c[0], r.c[1]]), ...fromBox([r.c[2], r.c[3]])] }));
  };
  const padA = Math.max(1, 0.03 * pitch), padB = Math.max(2, 0.08 * pitch);
  for (const b of doorBoxes) walls = walls.flatMap((s) => rectCut(s, b, padA, padB));
  const reach = 0.33 * pitch;
  const reachWall = (b, sgn) => {
    const end = [b.c[0] + b.u[0] * sgn * b.hl, b.c[1] + b.u[1] * sgn * b.hl];
    let best = null, bd = Infinity;
    for (const s of walls) {
      if (s.door) continue;
      for (const p of [[s.c[0], s.c[1]], [s.c[2], s.c[3]]]) {
        const dx = p[0] - end[0], dy = p[1] - end[1];
        const along = sgn * (dx * b.u[0] + dy * b.u[1]), across = Math.abs(-dx * b.u[1] + dy * b.u[0]);
        if (along < -padA - 1 || along > reach || across > b.hw + 0.05 * pitch) continue;
        const dd = Math.hypot(dx, dy);
        if (dd < bd) { bd = dd; best = p; }
      }
    }
    return best ?? [end[0] + b.u[0] * sgn * padA, end[1] + b.u[1] * sgn * padA];
  };
  const kinds = { door: 0, split: 0 };
  doorBoxes.forEach((b, id) => {
    const p0 = reachWall(b, -1), p1 = reachWall(b, 1);
    if (!b.split) {
      kinds.door++;
      walls.push({ c: [...p0, ...p1], door: DOOR.door, box: id });
      return;
    }
    kinds.split++;
    walls.push({ c: [...p0, ...b.bar], door: DOOR.door, box: id }, { c: [...b.bar, ...p1], door: DOOR.door, box: id });
  });

  // A cell asserted a door or a secret door: the box whose centre lies in it
  // takes that kind; a cell with no box is unplaced.
  let unplaced = 0;
  for (const [key, state] of corr.cells) {
    if (state !== "door" && state !== "secret") continue;
    const [i, j] = key.split(",").map(Number);
    const x0 = L.cellX(i), y0 = L.cellY(j), x1 = L.cellX(i + 1), y1 = L.cellY(j + 1);
    const id = doorBoxes.findIndex((b) => b.c[0] >= x0 && b.c[0] < x1 && b.c[1] >= y0 && b.c[1] < y1);
    if (id < 0) {
      unplaced++;
      continue;
    }
    for (const s of walls) if (s.box === id && s.door) s.door = doorOf(state);
  }
  // A dropped door is the drawn door nearest the correction's point, within
  // half a cell, with the rest of its box; its box stays cut from the wall,
  // so the opening stands open.
  let doorsDropped = 0;
  for (const [px, py] of corr.doorDrops) {
    let best = -1;
    let near = 0.5 * pitch;
    for (const s of walls) {
      if (!s.door) continue;
      const dd = pointToSegment(px, py, s.c);
      if (dd <= near) {
        near = dd;
        best = s.box;
      }
    }
    if (best < 0) continue;
    walls = walls.filter((s) => s.box !== best);
    doorsDropped++;
  }
  const windows = new Set(walls.filter((s) => s.win).map((s) => s.win)).size;
  walls = correctSegments([...walls.map(({ c, door, invisible }) => (invisible ? { c, door, invisible } : { c, door })), ...boxSides(L, corr.boxes)], L, corr);
  return {
    walls,
    digest: { cells: L.cols * L.rows, paths: live.filter((p) => p.alive).length, spurs, boxes: kinds, windows, islandsDropped: dropped, islandsRefused: refused, doorsDropped, unplaced },
  };
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
 * 2 secret), a wall that only stops movement marked `terrain` or `invisible`
 * as its correction asserted; the digest counts what the trace found, for
 * the import's report and the live gate. Throws on a recipe `wallsProblems`
 * refuses, a plan of storeys (`traceStoreys` traces one) or a render too
 * large to sum.
 *
 * @param {{gray: Uint8Array|Uint8ClampedArray, width: number, height: number}} image
 * @param {object} recipe a compiled scene recipe carrying `walls`
 * @param {number} scale render pixels per page point
 * @returns {{walls: {c: number[], door: number, terrain?: true, invisible?: true}[], digest: object}}
 */
export function traceWalls(image, recipe, scale) {
  const problems = wallsProblems(recipe?.walls, recipe);
  if (problems.length) throw new Error(problems.join("; "));
  if (storeyCrops(recipe).length) throw new Error("walls: a plan of storeys is traced storey by storey (traceStoreys)");
  return traceCrop(image, recipe, scale);
}

/**
 * Trace a plan of storeys. `images[k]` is storey `k`'s crop rendered as
 * `traceWalls` takes one: the recipe's own crop first, then each of `levels`
 * bottom up. Every storey is traced with the one mode and threshold and the
 * corrections inside its own crop, and its walls are carried into the first
 * storey's page points, because one frame serves every storey; each wall is
 * tagged with its `storey`, 0 the first. The digest sums the storeys' counts
 * and states how many storeys there were. Throws as `traceWalls` does, and
 * when the renders are not one per storey.
 *
 * @param {{gray: Uint8Array|Uint8ClampedArray, width: number, height: number}[]} images
 * @param {object} recipe a compiled scene recipe carrying `walls` and `levels`
 * @param {number} scale render pixels per page point
 * @returns {{walls: {c: number[], door: number, storey: number, terrain?: true, invisible?: true}[], digest: object}}
 */
export function traceStoreys(images, recipe, scale) {
  const problems = wallsProblems(recipe?.walls, recipe);
  if (problems.length) throw new Error(problems.join("; "));
  const crops = [recipe.crop, ...storeyCrops(recipe)];
  if (!Array.isArray(images) || images.length !== crops.length) throw new Error(`walls: a plan of ${crops.length} storeys is traced off one render of each`);
  const walls = [];
  const digest = {};
  crops.forEach((crop, storey) => {
    const corrections = (recipe.walls.corrections ?? []).filter((k) => correctionPoints(k).every((p) => inCrop(p, crop)));
    const one = traceCrop(images[storey], { ...recipe, crop, levels: undefined, walls: { ...recipe.walls, corrections } }, scale);
    const dx = crop.x - recipe.crop.x, dy = crop.y - recipe.crop.y;
    for (const s of one.walls) walls.push({ ...s, c: [s.c[0] - dx, s.c[1] - dy, s.c[2] - dx, s.c[3] - dy], storey });
    for (const [key, v] of Object.entries(one.digest)) if (typeof v === "number") digest[key] = (digest[key] ?? 0) + v;
  });
  return { walls, digest: { mode: recipe.walls.mode, ...digest, storeys: crops.length } };
}

/** One crop's trace, its recipe already checked. */
function traceCrop(image, recipe, scale) {
  const { gray, width: w, height: h } = image ?? {};
  if (!gray || !(w > 0) || !(h > 0) || gray.length !== w * h) throw new Error("walls: the render is not a gray image of its stated size");
  if (w * h > MAX_TRACE_PIXELS) throw new Error(`walls: a ${w}x${h} render is past the trace's ${MAX_TRACE_PIXELS} pixels`);
  const { mode, threshold, corrections } = recipe.walls;
  const L = renderLattice(wallLattice(recipe), recipe.crop, scale);
  const corr = readCorrections(corrections, recipe.crop, scale);
  const run = { grid: traceGrid, contour: traceContour, hatch: traceHatch, stroke: traceStroke }[mode];
  const { walls: traced, outline, digest } = run(gray, w, h, threshold, L, corr, recipe.walls);
  const { walls, replaced } = applyLines(traced, L, corr.lines, outline);
  const toPage = (v, origin) => origin + v / scale;
  const out = [];
  for (const { c, door, terrain, invisible } of walls) {
    const seg = [toPage(c[0], recipe.crop.x), toPage(c[1], recipe.crop.y), toPage(c[2], recipe.crop.x), toPage(c[3], recipe.crop.y)];
    if (!(Math.hypot(seg[2] - seg[0], seg[3] - seg[1]) > 0)) continue;
    out.push(terrain ? { c: seg, door, terrain: true } : invisible ? { c: seg, door, invisible: true } : { c: seg, door });
  }
  return {
    walls: out,
    digest: {
      mode,
      ...digest,
      doorsReplaced: replaced,
      walls: out.filter((s) => !s.door && !s.terrain && !s.invisible).length,
      doors: out.filter((s) => s.door === DOOR.door).length,
      secret: out.filter((s) => s.door === DOOR.secret).length,
      terrain: out.filter((s) => s.terrain).length,
      invisible: out.filter((s) => s.invisible).length,
      corrections: (corrections ?? []).length,
    },
  };
}
