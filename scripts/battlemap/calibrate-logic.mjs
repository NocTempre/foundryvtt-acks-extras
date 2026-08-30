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

/**
 * How many map cells a drawn box spans. A box is one cell unless the GM says
 * otherwise on its own row in the panel: dragging across a run of cells is
 * both easier to aim and a better measurement than pinching one, so the count
 * is part of the sample rather than an assumption about it.
 */
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
