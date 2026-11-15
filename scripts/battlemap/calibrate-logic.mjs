/**
 * Grid calibration as arithmetic — no dice, no documents, no Foundry.
 *
 * The capture layer hands over samples in BACKGROUND-IMAGE pixel space (not
 * canvas space), so a fit survives a partial apply: re-sampling after the
 * scene was rescaled still measures the same image. Three fit modes:
 *
 *   "square"  one cell size for both axes (the default battlemap case);
 *   "rect"    independent X and Y cell sizes (stretched scans);
 *   "affine"  a full 2D lattice `p = O + i·u + j·v` (skewed / rotated scans).
 *
 * Square and rect share the 1D-per-axis estimator; square merely pools both
 * axes' observations into one size. Affine seeds from the rect fit and
 * refines origin and basis by alternating integer assignment with linear
 * least squares over the corner points.
 */

/** Pairwise deltas shorter than this many px are noise, not cell spans. */
const MIN_DELTA = 4;

/** Confidence bands on the RMS residual as a fraction of the cell size. */
const RMS_TIGHT = 0.01;
const RMS_FAIR = 0.03;

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const mod = (a, n) => ((a % n) + n) % n;

/** Circular distance of an offset to the nearest lattice line, given cell s. */
const lineDistance = (offset, s) => {
  const r = mod(offset, s);
  return Math.min(r, s - r);
};

/** Circular mean of offsets modulo s, in [0, s). */
function circularPhase(offsets, s) {
  let sin = 0;
  let cos = 0;
  for (const o of offsets) {
    const t = (2 * Math.PI * mod(o, s)) / s;
    sin += Math.sin(t);
    cos += Math.cos(t);
  }
  if (!sin && !cos) return 0;
  return mod((s / (2 * Math.PI)) * Math.atan2(sin, cos), s);
}

/** How many map cells a drawn box spans — its own `cells` count, or one. */
export const boxCells = (r) => (r?.cells > 0 ? r.cells : 1);

/** Per-axis observations: cell-span deltas and grid-line phase offsets. */
function axisObservations(squares, corners, axis) {
  const pos = axis === "x" ? (p) => p.x : (p) => p.y;
  const side = axis === "x" ? (r) => r.w : (r) => r.h;
  const deltas = [];
  const phases = [];
  for (const r of squares) {
    deltas.push(side(r) / boxCells(r));
    phases.push(pos(r), pos(r) + side(r));
  }
  for (let i = 0; i < corners.length; i++) {
    phases.push(pos(corners[i]));
    for (let j = i + 1; j < corners.length; j++) {
      const d = Math.abs(pos(corners[i]) - pos(corners[j]));
      if (d >= MIN_DELTA) deltas.push(d);
    }
  }
  return { deltas, phases };
}

/**
 * Seed a cell size from deltas alone: every delta divided by every plausible
 * integer count is a candidate, scored by how nearly ALL deltas are integer
 * multiples of it. Square-drag sides (known n=1 spans) make this trivial;
 * corners sampled several cells apart are what need the divisor search.
 */
function seedSize(deltas, sides, { minSize, maxSize }) {
  if (sides.length) return median(sides);
  const candidates = new Set();
  for (const d of deltas) {
    for (let k = 1; k <= Math.floor(d / minSize); k++) {
      const s = d / k;
      if (s >= minSize && s <= maxSize) candidates.add(s);
    }
  }
  let best = null;
  let bestScore = Infinity;
  for (const s of candidates) {
    let score = 0;
    for (const d of deltas) {
      const q = d / s;
      score += Math.abs(q - Math.round(q));
    }
    score /= deltas.length;
    if (score < bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

/**
 * Integer least squares on the deltas: assign each its nearest multiple,
 * refit `s* = Σ(nᵢdᵢ)/Σ(nᵢ²)`, repeat until the assignment is stable.
 */
function refineSize(deltas, s0, { minSize, maxSize }) {
  let s = s0;
  let prev = null;
  for (let iter = 0; iter < 5; iter++) {
    const ns = deltas.map((d) => Math.round(d / s));
    const key = ns.join(",");
    if (key === prev) break;
    prev = key;
    let num = 0;
    let den = 0;
    for (let i = 0; i < deltas.length; i++) {
      if (!ns[i]) continue;
      num += ns[i] * deltas[i];
      den += ns[i] * ns[i];
    }
    if (!den) return s;
    s = Math.min(maxSize, Math.max(minSize, num / den));
  }
  return s;
}

function axisResiduals(deltas, phases, s, phase) {
  const rs = [];
  for (const d of deltas) rs.push(Math.abs(d - Math.round(d / s) * s));
  for (const o of phases) rs.push(lineDistance(o - phase, s));
  return rs;
}

const confidence = (rmsPct) => (rmsPct < RMS_TIGHT ? "tight" : rmsPct < RMS_FAIR ? "fair" : "loose");

/**
 * Fit the map's drawn grid from GM samples.
 *
 * @param {object} input
 * @param {Array<{x:number,y:number,w:number,h:number,cells?:number}>} input.squares
 *   Dragged rects (normalized, w/h > 0), image px. Each spans `cells` drawn
 *   cells per axis, defaulting to one.
 * @param {Array<{x:number,y:number}>} input.corners  Clicked grid intersections.
 * @param {"square"|"rect"|"affine"} [input.mode]
 * @param {number} [input.minSize] / [input.maxSize]  Cell-size bounds in px.
 * @returns {object} `{ ok, mode, sizeX, sizeY, phaseX, phaseY, rmsPx, rmsPct,
 *   maxPx, confidence, samples }`; affine adds `{ origin, u, v, skewDeg,
 *   rotationDeg }`. `ok:false` carries a `reason` ("noSamples" | "noSeed").
 */
export function fitGrid({ squares = [], corners = [], mode = "square", minSize = 20, maxSize = 600 }) {
  const samples = squares.length + corners.length;
  const base = { mode, samples, squares: squares.length, corners: corners.length };
  if (!samples) return { ...base, ok: false, reason: "noSamples" };

  const ox = axisObservations(squares, corners, "x");
  const oy = axisObservations(squares, corners, "y");

  const fitAxis = (obs, sides) => {
    const seed = seedSize(obs.deltas, sides, { minSize, maxSize });
    if (!seed) return null;
    const size = refineSize(obs.deltas, seed, { minSize, maxSize });
    const phase = circularPhase(obs.phases, size);
    return { size, phase };
  };

  let sizeX;
  let sizeY;
  let phaseX;
  let phaseY;
  if (mode === "square") {
    const pooled = fitAxis(
      { deltas: [...ox.deltas, ...oy.deltas], phases: [] },
      [...squares.map((r) => r.w / boxCells(r)), ...squares.map((r) => r.h / boxCells(r))]
    );
    if (!pooled) return { ...base, ok: false, reason: "noSeed" };
    sizeX = sizeY = pooled.size;
    phaseX = circularPhase(ox.phases, sizeX);
    phaseY = circularPhase(oy.phases, sizeY);
  } else {
    const fx = fitAxis(ox, squares.map((r) => r.w / boxCells(r)));
    const fy = fitAxis(oy, squares.map((r) => r.h / boxCells(r)));
    if (!fx || !fy) return { ...base, ok: false, reason: "noSeed" };
    ({ size: sizeX, phase: phaseX } = fx);
    ({ size: sizeY, phase: phaseY } = fy);
  }

  let result = { ...base, ok: true, sizeX, sizeY, phaseX, phaseY };

  if (mode === "affine" && corners.length >= 3) {
    const affine = fitLattice(corners, { minSize, maxSize });
    if (affine) result = { ...base, ok: true, ...affine };
  }

  const rs =
    result.u == null
      ? [...axisResiduals(ox.deltas, ox.phases, result.sizeX, result.phaseX), ...axisResiduals(oy.deltas, oy.phases, result.sizeY, result.phaseY)]
      : latticeResiduals(corners, result);
  const rmsPx = rs.length ? Math.sqrt(rs.reduce((a, r) => a + r * r, 0) / rs.length) : 0;
  const maxPx = rs.length ? Math.max(...rs) : 0;
  const rmsPct = rmsPx / Math.min(result.sizeX, result.sizeY);
  return { ...result, rmsPx, maxPx, rmsPct, confidence: confidence(rmsPct) };
}

/** Solve the 3-parameter regression c = [a, b, d] minimizing Σ(a + b·i + c·j − t)². */
function solve3(rows, targets) {
  // Normal equations AᵀA c = Aᵀt for design rows [1, i, j].
  const m = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const rhs = [0, 0, 0];
  for (let k = 0; k < rows.length; k++) {
    const r = rows[k];
    for (let a = 0; a < 3; a++) {
      rhs[a] += r[a] * targets[k];
      for (let b = 0; b < 3; b++) m[a][b] += r[a] * r[b];
    }
  }
  // Gaussian elimination with partial pivoting on the 3×3 system.
  const M = m.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-9) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c < 4; c++) M[r][c] -= f * M[col][c];
    }
  }
  const c = M.map((row, i) => row[3] / row[i]);
  return c.every(Number.isFinite) ? c : null;
}

const cross = (a, b) => a.x * b.y - a.y * b.x;
const dot = (a, b) => a.x * b.x + a.y * b.y;
const len = (a) => Math.hypot(a.x, a.y);
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });

/**
 * Find the fundamental basis of the lattice the corner differences live on.
 * The shortest pairwise deltas are usually COMPOSITE (corners are rarely one
 * cell apart), so a shortest-pair seed spans a sublattice; every delta with
 * fractional coordinates in the current basis donates its residual — a
 * genuinely shorter lattice vector — until all deltas index integrally.
 */
function seedBasis(corners, { minSize, maxSize }) {
  const deltas = [];
  for (let i = 0; i < corners.length; i++) {
    for (let j = i + 1; j < corners.length; j++) {
      const d = sub(corners[j], corners[i]);
      if (len(d) >= MIN_DELTA) deltas.push(d);
    }
  }
  if (deltas.length < 2) return null;
  deltas.sort((a, b) => len(a) - len(b));
  let b1 = deltas[0];
  let b2 = deltas.find((d) => Math.abs(cross(b1, d)) / (len(b1) * len(d)) > 0.05);
  if (!b2) return null;

  const reduce = () => {
    // Gauss reduction: shorten the longer vector by the nearest multiple of
    // the shorter until neither improves.
    for (let i = 0; i < 10; i++) {
      if (len(b2) < len(b1)) [b1, b2] = [b2, b1];
      const mu = Math.round(dot(b2, b1) / dot(b1, b1));
      if (!mu) break;
      const next = { x: b2.x - mu * b1.x, y: b2.y - mu * b1.y };
      if (len(next) >= len(b2)) break;
      b2 = next;
    }
  };

  reduce();
  for (let pass = 0; pass < 20; pass++) {
    const det = cross(b1, b2);
    if (Math.abs(det) < 1e-6) return null;
    let refined = false;
    for (const d of deltas) {
      const a = (d.x * b2.y - d.y * b2.x) / det;
      const b = (d.y * b1.x - d.x * b1.y) / det;
      if (Math.abs(a - Math.round(a)) < 0.25 && Math.abs(b - Math.round(b)) < 0.25) continue;
      const r = { x: d.x - Math.round(a) * b1.x - Math.round(b) * b2.x, y: d.y - Math.round(a) * b1.y - Math.round(b) * b2.y };
      if (len(r) < minSize * 0.5) continue;
      // The residual is a lattice vector shorter than the basis explains:
      // keep the two shortest independent of the three.
      const cands = [b1, b2, r].sort((p, q) => len(p) - len(q));
      b1 = cands[0];
      b2 = cands.find((c) => Math.abs(cross(b1, c)) / (len(b1) * len(c)) > 0.05);
      if (!b2) return null;
      reduce();
      refined = true;
      break;
    }
    if (!refined) break;
  }
  if (len(b1) < minSize || len(b1) > maxSize || len(b2) < minSize || len(b2) > maxSize) return null;
  // Orient: u is the more x-ward vector pointing +x, v the more y-ward
  // pointing +y, so sizeX/sizeY keep their axis meaning.
  let [u, v] = Math.abs(b1.x) >= Math.abs(b1.y) ? [b1, b2] : [b2, b1];
  if (u.x < 0) u = { x: -u.x, y: -u.y };
  if (v.y < 0) v = { x: -v.x, y: -v.y };
  return { u, v };
}

/**
 * Refine a full 2D lattice over the corner points, seeded by basis reduction
 * of their pairwise deltas: alternate nearest-node integer assignment with
 * least-squares refit of origin and basis. Returns null when the corners are
 * degenerate (collinear, or too few deltas) — the caller keeps the
 * orthogonal fit.
 */
function fitLattice(corners, bounds) {
  const basis = seedBasis(corners, bounds);
  if (!basis) return null;
  let O = { ...corners[0] };
  let { u, v } = basis;
  let prev = null;
  for (let iter = 0; iter < 5; iter++) {
    const det = u.x * v.y - u.y * v.x;
    if (Math.abs(det) < 1e-6) return null;
    const rows = [];
    const tx = [];
    const ty = [];
    const assign = [];
    for (const p of corners) {
      const dx = p.x - O.x;
      const dy = p.y - O.y;
      const i = Math.round((dx * v.y - dy * v.x) / det);
      const j = Math.round((dy * u.x - dx * u.y) / det);
      assign.push(`${i},${j}`);
      rows.push([1, i, j]);
      tx.push(p.x);
      ty.push(p.y);
    }
    const key = assign.join(";");
    if (key === prev) break;
    prev = key;
    const cx = solve3(rows, tx);
    const cy = solve3(rows, ty);
    if (!cx || !cy) return null;
    O = { x: cx[0], y: cy[0] };
    u = { x: cx[1], y: cy[1] };
    v = { x: cx[2], y: cy[2] };
  }
  const sizeX = Math.hypot(u.x, u.y);
  const sizeY = Math.hypot(v.x, v.y);
  if (!sizeX || !sizeY) return null;
  const rotationDeg = (Math.atan2(u.y, u.x) * 180) / Math.PI;
  const angleUV = (Math.atan2(v.y, v.x) - Math.atan2(u.y, u.x)) * (180 / Math.PI);
  const skewDeg = 90 - Math.abs(mod(angleUV, 360) > 180 ? 360 - mod(angleUV, 360) : mod(angleUV, 360));
  // Reduce the origin into the first cell so it reads as a phase.
  const det = u.x * v.y - u.y * v.x;
  const i0 = Math.floor((O.x * v.y - O.y * v.x) / det);
  const j0 = Math.floor((O.y * u.x - O.x * u.y) / det);
  const origin = { x: O.x - i0 * u.x - j0 * v.x, y: O.y - i0 * u.y - j0 * v.y };
  return { sizeX, sizeY, phaseX: origin.x, phaseY: origin.y, origin, u, v, skewDeg, rotationDeg };
}

function latticeResiduals(corners, { origin, u, v }) {
  const det = u.x * v.y - u.y * v.x;
  return corners.map((p) => {
    const dx = p.x - origin.x;
    const dy = p.y - origin.y;
    const i = Math.round((dx * v.y - dy * v.x) / det);
    const j = Math.round((dy * u.x - dx * u.y) / det);
    return Math.hypot(dx - i * u.x - j * v.x, dy - i * u.y - j * v.y);
  });
}

/**
 * The map's real scale from a scale-bar segment: the drawn distance `value`
 * divided by how many cells the segment spans. Cell counts are measured
 * per-axis so an off-axis drag on an anisotropic map still converts.
 * @returns {number|null} feet per drawn map cell.
 */
export function feetPerSquare({ dx, dy, value, sizeX, sizeY }) {
  if (!(value > 0) || !(sizeX > 0) || !(sizeY > 0)) return null;
  const cells = Math.hypot(dx / sizeX, dy / sizeY);
  return cells > 0 ? value / cells : null;
}

/**
 * Nice-number candidates around a raw feet-per-cell value: the neighbouring
 * 1-2-5 ladder rungs plus the nearest multiple of 5. Pure magnitude math.
 */
export function roundSuggestions(raw) {
  if (!(raw > 0)) return [];
  const out = new Set();
  const exp = Math.floor(Math.log10(raw));
  for (const e of [exp - 1, exp, exp + 1]) {
    for (const m of [1, 2, 5]) {
      const c = m * 10 ** e;
      if (c >= raw / 3 && c <= raw * 3) out.add(Number(c.toPrecision(12)));
    }
  }
  const near5 = Math.round(raw / 5) * 5;
  if (near5 > 0) out.add(near5);
  return [...out].sort((a, b) => Math.abs(a - raw) - Math.abs(b - raw)).slice(0, 4).sort((a, b) => a - b);
}

/**
 * The scene shift that lands a drawn lattice line on a Foundry grid line.
 *
 * The background is drawn at canvas `origin - shift`, so a lattice line at
 * image offset `phase` sits at `origin - shift + phase·factor`; that must be
 * a whole number of grid squares from the canvas origin. The result is
 * wrapped to the representative nearest zero, so the map moves as little as
 * possible, and rounded — the Scene field is an integer.
 *
 * **Returns null rather than NaN when any input is not finite.** A NaN here
 * reaches `Scene#update` as `null`, which schema validation rejects
 * SILENTLY: the whole update is dropped while the caller reports success.
 * Callers must refuse on null.
 *
 * @param {object} input
 * @param {number} input.origin  Canvas x/y the scene rect starts at with the
 *   shift zeroed (a zero-shift clone's `sceneX`/`sceneY`).
 * @param {number} input.phase  The fitted lattice phase, in image px.
 * @param {number} input.factor  Canvas px per image px on this axis.
 * @param {number} input.gridSize  Target grid size in canvas px.
 * @returns {number|null}
 */
export function solveShift({ origin, phase, factor, gridSize }) {
  if (![origin, phase, factor, gridSize].every((v) => Number.isFinite(v))) return null;
  if (!(gridSize > 0)) return null;
  const r = mod(origin + phase * factor, gridSize);
  return Math.round(r > gridSize / 2 ? r - gridSize : r);
}

/**
 * Convert the fitted drawn cell into the Foundry square the GM asked for.
 * At the 1:1 default (outputFeet = mapCellFeet) this is the fitted cell
 * itself; otherwise the grid is re-pitched so one drawn box spans
 * `mapCellFeet / outputFeet` squares. `aligned` says whether the two grids'
 * lines can coincide (integer ratio in either direction).
 */
export function outputGridSize({ fittedCellPx, mapCellFeet, outputFeet }) {
  if (!(fittedCellPx > 0) || !(mapCellFeet > 0) || !(outputFeet > 0)) return null;
  const ratio = mapCellFeet / outputFeet;
  const aligned = Math.abs(ratio - Math.round(ratio)) < 1e-9 || Math.abs(1 / ratio - Math.round(1 / ratio)) < 1e-9;
  return { px: fittedCellPx / ratio, ratio, aligned };
}

/**
 * Image px per one distance unit, from a dragged scale bar and its printed
 * length. The bar is the ONLY measurement a map with no drawn grid offers, so
 * this is the whole of a scale-only calibration.
 * @returns {number|null} null when either input is unusable.
 */
export function pixelsPerUnit({ dx, dy, value }) {
  if (!(value > 0)) return null;
  const px = Math.hypot(dx, dy);
  return px > 0 ? px / value : null;
}

/**
 * The (size, distance) pair a scale-only calibration writes.
 *
 * The two are ONE ratio — `size` px of canvas is worth `distance` units — and
 * Foundry constrains `size` to a whole number within its own bounds. So the
 * asked-for `distance` is kept whenever the px it implies fits, and only a
 * clamped size solves the distance back, which keeps the ratio exact at the
 * cost of a round number nobody but the ruler reads.
 *
 * @param {object} input
 * @param {number} input.pxPerUnit  Canvas px per one distance unit.
 * @param {number} input.distance  What the GM wants one ruler cell to be worth.
 * @returns {{size:number, distance:number, clamped:boolean}|null}
 */
export function scaleOnlyGrid({ pxPerUnit, distance, minSize = 50, maxSize = 300 }) {
  if (!(pxPerUnit > 0) || !(distance > 0) || !(minSize > 0) || !(maxSize >= minSize)) return null;
  const raw = pxPerUnit * distance;
  const bounded = Math.min(maxSize, Math.max(minSize, raw));
  const size = Math.round(bounded);
  const clamped = bounded !== raw;
  return { size, distance: clamped ? size / pxPerUnit : distance, clamped };
}

/**
 * The `grid.size` that makes a Foundry hex as big as the one drawn on the map.
 *
 * A hex's bounding box is not `size` square, and the ratio differs between
 * pointy-topped rows and flat-topped columns — so it is MEASURED off a
 * reference hex rather than restated here: the caller asks Foundry for the
 * `sizeX`/`sizeY` of a grid at `refSize`, and this scales that answer to the
 * box the GM drew around a real one. Both axes vote, so a box drawn a little
 * tall lands between rather than on the taller reading.
 *
 * @param {object} input
 * @param {number} input.boxW / input.boxH  The drawn hex's bounding box, canvas px.
 * @param {number} input.refW / input.refH  The same box for a hex at `refSize`.
 * @returns {number|null} the grid size in canvas px, or null on unusable input.
 */
export function hexSizeFromBox({ boxW, boxH, refW, refH, refSize }) {
  const votes = [];
  if (boxW > 0 && refW > 0) votes.push((boxW / refW) * refSize);
  if (boxH > 0 && refH > 0) votes.push((boxH / refH) * refSize);
  if (!votes.length || !(refSize > 0)) return null;
  const size = votes.reduce((a, b) => a + b, 0) / votes.length;
  return Number.isFinite(size) && size > 0 ? size : null;
}

/**
 * How far a hand may miss when it draws a box edge, in image px. Every noise
 * figure of the hex fit rests on it: it is read as a bound on one edge, taken
 * as uniform, so an edge's standard deviation is `HAND_PX / √3`.
 */
export const HAND_PX = 3;

/**
 * How far a drawn box's aspect may lean from one hex's before it stops reading
 * as that hex, as a fraction, on top of the allowance for the hand
 * (`HAND_PX`, per box). The measure is the box's canvas aspect (`w·scale.x` by
 * `h·scale.y`) against the probe's `refW` by `refH`. It is a plausibility
 * bound only: the range spans the aspects of the family the Judge chose and of
 * the other one, widened by this lean either way, and a box outside it is not
 * one hex. Which family the boxes belong to is decided by the lattice or by the
 * mean aspect, never by this bound.
 */
export const HEX_SHAPE_LEAN = 0.12;

/**
 * How far a box's size may differ from the size most boxes agree on before it
 * is taken for more or less than one hex, as a ratio either way per axis: two
 * sizes agree when the log of their ratio is within `ln(1 + HEX_SIZE_SPREAD)`,
 * so a box a fifth bigger and one a fifth smaller are the same distance from
 * the middle. A box that spans several hexes both ways has a hex's proportions
 * and only this disagreement gives it away.
 */
export const HEX_SIZE_SPREAD = 0.25;

/**
 * How many standard deviations of a box's placement must fit inside half the
 * nearest lattice spacing before a box is placed on a node. A box farther from
 * the placed ones than that could be on a neighbouring hex and is left
 * unplaced (`unreachable`) until a box between them gives the fit the span.
 */
export const REACH_Z = 3.5;

/**
 * How many standard deviations the mean aspect of the used boxes must sit from
 * the midway aspect of the two hex families before the shape alone names a
 * family. Inside that distance the family is ambiguous.
 */
export const FAMILY_Z = 2;

/**
 * Bands on the RMS of every edge residual of a hex fit, in image px: at or
 * under `TIGHT_PX` the boxes sit on one lattice about as well as a hand draws
 * them, at or under `FAIR_PX` (twice the hand's bound) they are off by more
 * than a hand explains but still read as one, past it they do not.
 */
export const TIGHT_PX = 2.5;

/** The upper edge of the `fair` band: see `TIGHT_PX`. */
export const FAIR_PX = 2 * HAND_PX;

/** The variance of one hand-drawn edge: a uniform miss of at most `HAND_PX`. */
const HAND_VARIANCE = HAND_PX ** 2 / 3;

const isLatticePoint = (p) => Number.isFinite(p?.x) && Number.isFinite(p?.y);

/**
 * A probe's two lattice steps with their determinant, the length of the first
 * and the distance to the nearest other node (`near`), or null when unusable.
 */
function probeLattice(probe) {
  if (!(probe?.refW > 0) || !(probe?.refH > 0)) return null;
  const u = probe.basis?.u;
  const v = probe.basis?.v;
  if (!isLatticePoint(u) || !isLatticePoint(v)) return null;
  const det = cross(u, v);
  if (!(Math.abs(det) > 1e-9 * len(u) * len(v))) return null;
  const near = Math.min(len(u), len(v), Math.hypot(u.x + v.x, u.y + v.y), Math.hypot(u.x - v.x, u.y - v.y));
  return { u, v, det, step: len(u), near };
}

/** The lattice node nearest a point in probe space: `{i, j}` in basis coordinates. */
function nearestNode(p, { u, v, det }) {
  const fi = (p.x * v.y - p.y * v.x) / det;
  const fj = (u.x * p.y - u.y * p.x) / det;
  let best = null;
  // Rounding in a skewed basis is not nearest-node; the neighbours settle it.
  for (let i = Math.round(fi) - 1; i <= Math.round(fi) + 1; i++) {
    for (let j = Math.round(fj) - 1; j <= Math.round(fj) + 1; j++) {
      const d = Math.hypot(p.x - i * u.x - j * v.x, p.y - i * u.y - j * v.y);
      if (!best || d < best.d) best = { i, j, d };
    }
  }
  return { i: best.i, j: best.j };
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** A placed box's node position along an axis, in probe px. */
const nodePos = (n, axis, lattice) => n.i * lattice.u[axis] + n.j * lattice.v[axis];

/**
 * Fit one axis of the lattice: `edge = O + k·q`, where `q` is where the same
 * edge of the hex sits at the node, in probe px (the node's position ∓ half a
 * hex). Every placed box gives its two edges. A box not yet placed has no node
 * to give, so it gives what it can: its sides, as if its node sat at the mean
 * of the others. That keeps the size from being read off a lone placed box's
 * edges before the far boxes are reachable. With nothing pending this is the
 * joint edge and centre fit.
 *
 * @returns {{k:number, o:number, qm:number, m:number, sqq:number}} slope, offset,
 *   the mean and count of the placed edge positions, and their sum of squares
 *   with the pending boxes' share.
 */
function fitHexAxis(placed, pending, axis, lattice, ref) {
  const r = ref[axis];
  const qs = [];
  const es = [];
  for (const n of placed) {
    const p = nodePos(n, axis, lattice);
    qs.push(p - r / 2, p + r / 2);
    es.push(n.c[axis] - n.side[axis] / 2, n.c[axis] + n.side[axis] / 2);
  }
  const qm = mean(qs);
  const em = mean(es);
  let sqq = 0;
  let sqe = 0;
  for (let t = 0; t < qs.length; t++) {
    sqq += (qs[t] - qm) ** 2;
    sqe += (qs[t] - qm) * (es[t] - em);
  }
  for (const n of pending) {
    sqq += (r * r) / 2;
    sqe += (r * n.side[axis]) / 2;
  }
  const k = sqe / sqq;
  return { k, o: em - k * qm, qm, m: qs.length, sqq };
}

/** Both axes' fits for the boxes placed so far and the ones still waiting. */
const fitHexAxes = (placed, pending, lattice, ref) => ({
  x: fitHexAxis(placed, pending, "x", lattice, ref),
  y: fitHexAxis(placed, pending, "y", lattice, ref),
});

/** How far apart the placed nodes sit along an axis, in probe px. */
function nodeSpread(placed, axis, lattice) {
  const ps = placed.map((n) => nodePos(n, axis, lattice));
  return Math.max(...ps) - Math.min(...ps);
}

/** Whether the placed nodes hold two distinct positions along an axis. */
const isSpread = (placed, axis, lattice) => nodeSpread(placed, axis, lattice) > 1e-6 * lattice.step;

/**
 * Whether a box may be given the node its centre is nearest, and that node:
 * the centre is mapped into probe space through the fit so far, and the box is
 * reachable when `REACH_Z` standard deviations of where it could land (the
 * fit's own uncertainty at that node plus the box's) still fit inside half the
 * nearest lattice spacing.
 */
function reachNode(n, fit, lattice) {
  if (!(fit.x.k > 0) || !(fit.y.k > 0)) return { reachable: false, node: null };
  const node = nearestNode({ x: (n.c.x - fit.x.o) / fit.x.k, y: (n.c.y - fit.y.o) / fit.y.k }, lattice);
  let variance = 0;
  for (const axis of ["x", "y"]) {
    const f = fit[axis];
    const q = nodePos(node, axis, lattice);
    variance += (HAND_VARIANCE / f.m + ((q - f.qm) ** 2 * HAND_VARIANCE) / f.sqq + HAND_VARIANCE) / (f.k * f.k);
  }
  return { reachable: REACH_Z * Math.sqrt(variance) <= lattice.near / 2, node };
}

/** The log aspect (`refW` by `refH`) of a probe's hex. */
const probeAspect = (probe) => Math.log(probe.refW / probe.refH);

/** Whether a probe states a hex's box at all, which is all a shape comparison needs. */
const hasHexBox = (probe) => probe?.refW > 0 && probe?.refH > 0;

/**
 * Place boxes on one family's lattice and fit it. Returns `{ ok:false,
 * reason:"noOneHex", boxes }`, or the fit with the placed nodes kept for the
 * family decision. The probe must pass `probeLattice`.
 *
 * The shape gate drops a box whose canvas aspect is outside the range the two
 * families span, widened by `HEX_SHAPE_LEAN` and by what `HAND_PX` does to that
 * box's own sides; the size consensus then keeps the largest group of boxes
 * whose sizes agree. Placement goes outward from an anchor, nearest first, one
 * reachable box at a time with the fit redone after each, so the span grows as
 * the nodes are known. The anchor is the box from which the most boxes can be
 * placed, the earliest on a tie.
 */
function solveHexLattice({ boxes, probe, scale, otherProbe }) {
  const lattice = probeLattice(probe);
  const sx = scale?.x > 0 ? scale.x : 1;
  const sy = scale?.y > 0 ? scale.y : 1;
  const ref = { x: probe.refW, y: probe.refH };
  const rho = probeAspect(probe);
  const rhoOther = hasHexBox(otherProbe) ? probeAspect(otherProbe) : rho;
  const lean = Math.log(1 + HEX_SHAPE_LEAN);
  const lo = Math.min(rho, rhoOther) - lean;
  const hi = Math.max(rho, rhoOther) + lean;
  const info = boxes.map((b, index) => ({ index, cell: null, residual: null, notOneHex: false, unreachable: false }));

  const candidates = [];
  boxes.forEach((b, index) => {
    if (!(b?.w > 0) || !(b?.h > 0) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) {
      info[index].notOneHex = true;
      return;
    }
    const aspect = Math.log((b.w * sx) / (b.h * sy));
    const hand = 2 * HAND_PX * (1 / b.w + 1 / b.h);
    if (aspect < lo - hand || aspect > hi + hand) {
      info[index].notOneHex = true;
      return;
    }
    candidates.push({ index, aspect, k: { x: b.w / ref.x, y: b.h / ref.y } });
  });

  // Size consensus: the largest group of boxes that agree, earliest on a tie.
  const spread = Math.log(1 + HEX_SIZE_SPREAD);
  const agrees = (a, b) => Math.abs(Math.log(a.k.x / b.k.x)) <= spread && Math.abs(Math.log(a.k.y / b.k.y)) <= spread;
  let cluster = [];
  for (const c of candidates) {
    const group = candidates.filter((o) => agrees(o, c));
    if (group.length > cluster.length) cluster = group;
  }
  if (!cluster.length) return { ok: false, info };
  const inCluster = new Set(cluster.map((c) => c.index));
  for (const c of candidates) if (!inCluster.has(c.index)) info[c.index].notOneHex = true;

  const nodes = cluster.map(({ index, aspect }) => {
    const b = boxes[index];
    return { index, aspect, i: 0, j: 0, c: { x: b.x + b.w / 2, y: b.y + b.h / 2 }, side: { x: b.w, y: b.h } };
  });
  const placeFrom = (start) => {
    const anchor = { ...start, i: 0, j: 0 };
    const pending = nodes
      .filter((n) => n.index !== anchor.index)
      .map((n) => ({ ...n }))
      .sort((a, b) => Math.hypot(a.c.x - anchor.c.x, a.c.y - anchor.c.y) - Math.hypot(b.c.x - anchor.c.x, b.c.y - anchor.c.y));
    const settled = [anchor];
    while (pending.length) {
      const fit = fitHexAxes(settled, pending, lattice, ref);
      let took = -1;
      for (let t = 0; t < pending.length && took < 0; t++) {
        const reach = reachNode(pending[t], fit, lattice);
        if (!reach.reachable) continue;
        pending[t].i = reach.node.i;
        pending[t].j = reach.node.j;
        took = t;
      }
      if (took < 0) break;
      settled.push(...pending.splice(took, 1));
    }
    return { settled, pending };
  };
  let best = placeFrom(nodes[0]);
  for (const start of nodes.slice(1)) {
    if (!best.pending.length) break;
    const tried = placeFrom(start);
    if (tried.settled.length > best.settled.length) best = tried;
  }
  const placed = best.settled;
  for (const n of best.pending) info[n.index].unreachable = true;

  // With the whole span known, each node is read again until none moves.
  let fit = fitHexAxes(placed, [], lattice, ref);
  for (let pass = 0; pass < 8; pass++) {
    let moved = false;
    for (const n of placed.slice(1)) {
      const node = nearestNode({ x: (n.c.x - fit.x.o) / fit.x.k, y: (n.c.y - fit.y.o) / fit.y.k }, lattice);
      if (node.i !== n.i || node.j !== n.j) moved = true;
      n.i = node.i;
      n.j = node.j;
    }
    fit = fitHexAxes(placed, [], lattice, ref);
    if (!moved) break;
  }

  const k = { x: fit.x.k, y: fit.y.k };
  const sizeX = ref.x * k.x;
  const sizeY = ref.y * k.y;
  let sse = 0;
  const residuals = placed.map((n) => {
    const miss = {};
    for (const axis of ["x", "y"]) {
      const at = fit[axis].o + k[axis] * nodePos(n, axis, lattice);
      for (const sign of [-1, 1]) sse += (n.c[axis] + (sign * n.side[axis]) / 2 - (at + (sign * k[axis] * ref[axis]) / 2)) ** 2;
      miss[axis] = n.c[axis] - at;
    }
    const residual = Math.hypot(miss.x / sizeX, miss.y / sizeY);
    info[n.index].cell = { i: n.i, j: n.j };
    info[n.index].residual = residual;
    return { index: n.index, residual, px: Math.hypot(miss.x, miss.y) };
  });
  const used = placed.length;
  return {
    ok: true,
    lattice,
    info,
    placed,
    fit,
    k,
    sizeX,
    sizeY,
    used,
    residuals,
    rmsPx: used > 1 ? Math.sqrt(sse / (4 * used - 4)) : null,
    rho,
    rhoOther,
  };
}

/** Whether the box centres rise along an axis with the node positions: the fit has a direction to read. */
function centresRise(placed, axis, lattice) {
  const ps = placed.map((n) => nodePos(n, axis, lattice));
  const cs = placed.map((n) => n.c[axis]);
  const pm = mean(ps);
  const cm = mean(cs);
  let spp = 0;
  let spc = 0;
  for (let t = 0; t < ps.length; t++) {
    spp += (ps[t] - pm) ** 2;
    spc += (ps[t] - pm) * (cs[t] - cm);
  }
  return spp > 0 && spc / spp > 0;
}

/**
 * Whether the boxes belong to the family the Judge chose, as warnings.
 *
 * Three or more used boxes spread over both axes are fitted to both families'
 * lattices: the lattice that holds them to within `TIGHT_PX` is theirs, and
 * when neither or both do, the lattices cannot tell. The shape then decides:
 * the mean canvas aspect of the used boxes against the midway aspect of the two
 * families, in standard deviations of that mean (`FAMILY_Z`); inside them the
 * family is ambiguous.
 */
function hexFamilyWarnings({ own, boxes, probe, otherProbe, scale }) {
  if (!hasHexBox(otherProbe)) return [];
  const { placed, lattice, used } = own;
  let verdict = null;
  let basis = "shape";
  const spreadBoth = used >= 3 && isSpread(placed, "x", lattice) && isSpread(placed, "y", lattice);
  if (spreadBoth && centresRise(placed, "x", lattice) && centresRise(placed, "y", lattice) && probeLattice(otherProbe)) {
    const alt = solveHexLattice({ boxes, probe: otherProbe, scale, otherProbe: probe });
    if (alt.ok && alt.used >= 3) {
      const ownFits = own.rmsPx <= TIGHT_PX;
      const altFits = alt.rmsPx <= TIGHT_PX;
      if (ownFits !== altFits) {
        basis = "lattice";
        verdict = ownFits ? "own" : "other";
      }
    }
  }
  if (!verdict) {
    const mid = (own.rho + own.rhoOther) / 2;
    const meanAspect = mean(placed.map((n) => n.aspect));
    const variance = (2 * HAND_VARIANCE * placed.reduce((a, n) => a + 1 / n.side.x ** 2 + 1 / n.side.y ** 2, 0)) / used ** 2;
    const toward = (meanAspect - mid) * Math.sign(own.rho - mid);
    const margin = FAMILY_Z * Math.sqrt(variance);
    verdict = toward > margin ? "own" : toward < -margin ? "other" : "ambiguous";
  }
  if (verdict === "other") return [{ id: "familyMismatch", basis }];
  return verdict === "ambiguous" ? [{ id: "familyAmbiguous", basis }] : [];
}

/**
 * Fit a hex lattice to boxes the GM drew around single hexes.
 *
 * A box's edges cannot be scored against a rectangular lattice: hex rows repeat
 * at a fraction of a box's height and alternate by half its width, so exact
 * boxes on different rows disagree by construction. Here the lattice is the
 * probe's own — the centre-to-centre steps core's grid reports for the chosen
 * family — scaled per axis, so no hex geometry is stated here.
 *
 * Shape is judged on canvas (the box scaled by `scale`), so a map whose image
 * is stretched over its scene still reads a regular hex as one. A box that is
 * not one hex is left out of the fit and flagged `notOneHex`: one whose
 * proportions no hex has, one that spans several hexes and one whose size
 * disagrees with the rest (`HEX_SHAPE_LEAN`, `HEX_SIZE_SPREAD`). Placement is
 * outward from an anchor, nearest first, and a box farther than the fit can
 * tell from its neighbours is `unreachable`, left out, until a box between
 * them is drawn (`REACH_Z`).
 *
 * The size is fitted per axis from every box's edges and, once the used boxes
 * hold two distinct positions along that axis, from their centres as well
 * (`from`: `"joint"`); before that the edges alone are all a box can say
 * (`"edges"`). Boxes not yet placed give their sides to that fit while it
 * decides who is reachable.
 *
 * Confidence is the RMS of every edge residual of the final fit in image px,
 * against `TIGHT_PX` and `FAIR_PX`; fewer than three used boxes cannot read
 * tight. The family is judged by the lattice, or by the boxes' shape where the
 * lattice cannot tell; a verdict against the Judge's family is a warning and
 * never changes the fit.
 *
 * @param {object} input
 * @param {Array<{x:number,y:number,w:number,h:number}>} input.boxes  Image px,
 *   normalized (w, h > 0).
 * @param {object} input.probe  `hexProbe`'s answer for the chosen family:
 *   `{refW, refH, refSize, basis:{u,v}}`, in probe px.
 * @param {{x:number,y:number}} [input.scale]  Canvas px per image px, per axis.
 * @param {object|null} [input.otherProbe]  `hexProbe`'s answer for the other
 *   family; without it no family is judged and the shape range is the chosen
 *   family's alone.
 * @returns {object} On success `{ ok:true, sizeX, sizeY, centre, k, spacing,
 *   from, boxes, used, unreachable, rmsPx, rmsPct, maxPct, worst, confidence,
 *   warnings, samples }`: `sizeX`/`sizeY` are ONE hex's bounding box in image
 *   px; `centre` the fitted centre of the anchor's hex in image px; `k` image
 *   px per probe px per axis; `spacing` the probe's `u` and `v` steps in image
 *   px; `from` per axis `"joint"` or `"edges"`; `boxes` one `{index, cell,
 *   residual, notOneHex, unreachable}` per input box, where `cell` is `{i, j}`
 *   in basis coordinates (`i` along `u`, `j` along `v`) and `residual` is the
 *   box centre's distance from its node as a share of one hex, both null for a
 *   box left out; `used` and `unreachable` count the boxes in the fit and the
 *   ones out of reach; `rmsPx` is the RMS edge residual in image px (null for
 *   one used box, which has nothing to be off from); `rmsPct`/`maxPct` are the
 *   centre residuals over the used boxes as fractions of a hex; `worst` is the
 *   index of the used box whose centre is farthest from its node in px, null
 *   when fewer than three boxes are used or the fit is `"tight"`;
 *   `confidence` is `"tight"`, `"fair"` or `"loose"`; `warnings` is a list of
 *   `{id:"familyMismatch"|"familyAmbiguous", basis:"lattice"|"shape"}`. On
 *   failure `{ ok:false, reason, samples }` with `reason` one of "noBoxes",
 *   "noProbe", "noOneHex"; "noOneHex" also carries `boxes`, the same per-box
 *   flags.
 */
export function fitHexLattice({ boxes = [], probe = null, scale = { x: 1, y: 1 }, otherProbe = null } = {}) {
  const samples = boxes.length;
  if (!samples) return { ok: false, reason: "noBoxes", samples };
  const lattice = probeLattice(probe);
  if (!lattice) return { ok: false, reason: "noProbe", samples };
  const own = solveHexLattice({ boxes, probe, scale, otherProbe });
  if (!own.ok) return { ok: false, reason: "noOneHex", boxes: own.info, samples };

  const { used, residuals, fit, k, rmsPx } = own;
  let band = rmsPx === null ? "fair" : rmsPx <= TIGHT_PX ? "tight" : rmsPx <= FAIR_PX ? "fair" : "loose";
  if (used < 3 && band === "tight") band = "fair";
  const farthest = residuals.reduce((a, r) => (r.px > a.px ? r : a), residuals[0]);
  return {
    ok: true,
    sizeX: own.sizeX,
    sizeY: own.sizeY,
    centre: { x: fit.x.o, y: fit.y.o },
    k,
    spacing: {
      u: { x: lattice.u.x * k.x, y: lattice.u.y * k.y },
      v: { x: lattice.v.x * k.x, y: lattice.v.y * k.y },
    },
    from: {
      x: isSpread(own.placed, "x", lattice) ? "joint" : "edges",
      y: isSpread(own.placed, "y", lattice) ? "joint" : "edges",
    },
    boxes: own.info,
    used,
    unreachable: own.info.filter((b) => b.unreachable).length,
    rmsPx,
    rmsPct: Math.sqrt(mean(residuals.map((r) => r.residual ** 2))),
    maxPct: Math.max(...residuals.map((r) => r.residual)),
    worst: used >= 3 && band !== "tight" ? farthest.index : null,
    confidence: band,
    warnings: hexFamilyWarnings({ own, boxes, probe, otherProbe, scale }),
    samples,
  };
}

/**
 * What one cell is worth in a scale bar's own unit, with a cell measured
 * centre to centre: the bar is mapped back into probe space through the fit's
 * per-axis `k` and divided by the probe's centre spacing. A hex's box sides are
 * the wrong ruler for a hex (`feetPerSquare` reads them); the distance a token
 * moves is the step between centres. The unit is whatever the bar was printed
 * in, which need not be feet.
 *
 * @param {object} input
 * @param {number} input.dx / input.dy  The bar's extent, image px.
 * @param {number} input.value  The bar's printed length, in the scene's unit.
 * @param {{x:number,y:number}} input.k  The fit's image px per probe px.
 * @param {{u:{x:number,y:number}}} input.basis  The probe's lattice steps.
 * @returns {number|null} units per cell, or null on unusable input.
 */
export function unitsPerCentreSpacing({ dx, dy, value, k, basis }) {
  if (!(value > 0) || !(k?.x > 0) || !(k?.y > 0) || !isLatticePoint(basis?.u)) return null;
  const step = len(basis.u);
  if (!(step > 0)) return null;
  const cells = Math.hypot(dx / k.x, dy / k.y) / step;
  return cells > 0 ? value / cells : null;
}

/**
 * Canvas px per background-image px, per axis: the `scale` the hex fit takes.
 * It is the INVERSE of what the capture overlay calls its image scale (image px
 * per canvas px); the fit judges a box's shape as it is drawn on screen, so a
 * square texture stretched over a 4:3 scene must come in as 4:3, not 3:4.
 * Identity where either size is unusable, so a missing texture never throws.
 *
 * @param {object} input
 * @param {{width:number,height:number}|null} input.texture  The background texture, image px.
 * @param {{sceneWidth:number,sceneHeight:number}|null} input.dimensions  The scene's
 *   dimensions (`scene.dimensions`), canvas px.
 * @returns {{x:number,y:number}}
 */
export function canvasPerImage({ texture = null, dimensions = null } = {}) {
  const x = dimensions?.sceneWidth / texture?.width;
  const y = dimensions?.sceneHeight / texture?.height;
  return x > 0 && y > 0 && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : { x: 1, y: 1 };
}
