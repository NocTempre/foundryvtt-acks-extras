/* global CONST, game, Image, getComputedStyle */
/**
 * The plate: a drawing of the hex a party stands in, for the party sheet's
 * frame and the Judge tab's two plates.
 *
 * `plateGeometry` is pure — the cell under a point, the roads and the water
 * that cross it, the stock's points and the party's mark, all in the plate's
 * own pixels beside the transform from the scene's. `paintPlate` is the thin
 * painter over it, and `drawPlate` the sheet's entry: it finds the scene and
 * its background, paints at once, and paints again as each image arrives.
 * The compass names a hex direction from the grid's own geometry.
 *
 * Nothing drawn here is book art: the background is the scene's own, which is
 * the Judge's, and every colour is the module's.
 */
import { backgroundSrc } from "../battlemap/scene-image.mjs";
import { roadWallsOf, wallRoad } from "../battlemap/roads.mjs";
import { waterWallsOf, wallWater } from "../battlemap/water.mjs";
import { ROAD_TINT, WATER_TINT } from "../battlemap/road-markers.mjs";
import { isHexScene } from "../battlemap/terrain-paint.mjs";

/** The side of a plate's bitmap, in canvas pixels; the stylesheet sizes the box it is shown in. */
export const PLATE_PIXELS = 404;

/** The share of the plate's side left clear around the cell. */
const MARGIN = 0.06;

/** A PIXI tint as a CSS colour. */
const cssTint = (n) => `#${Number(n).toString(16).padStart(6, "0")}`;

/** FNV-1a over a string: the same id always lands a point in the same place. */
function hashOf(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A vertex list as `{x, y}` points, whether the grid answered points or a flat array. */
function pointsOf(vertices) {
  if (!Array.isArray(vertices)) return [];
  if (vertices.length && typeof vertices[0] === "number") {
    const out = [];
    for (let i = 0; i + 1 < vertices.length; i += 2) out.push({ x: vertices[i], y: vertices[i + 1] });
    return out;
  }
  return vertices.map((v) => ({ x: Number(v.x), y: Number(v.y) }));
}

/**
 * A segment clipped to a box (Liang–Barsky), or null when none of it lies
 * inside.
 */
function clipSegment([x0, y0, x1, y1], box) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let t0 = 0;
  let t1 = 1;
  const edges = [
    [-dx, x0 - box.x],
    [dx, box.x + box.width - x0],
    [-dy, y0 - box.y],
    [dy, box.y + box.height - y0],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return [x0 + t0 * dx, y0 + t0 * dy, x0 + t1 * dx, y0 + t1 * dy];
}

/**
 * The cell a plate draws, in scene pixels: the hex under `center` on a hex
 * grid, the square on a square grid, and on a gridless scene a square one
 * scene unit (`grid.size` pixels) on a side around the point.
 */
function cellAt(scene, center) {
  const grid = scene.grid;
  if (isHexScene(scene)) {
    const offset = grid.getOffset(center);
    return { kind: "hex", polygon: pointsOf(grid.getVertices(offset)), offset };
  }
  const side = Number(grid?.size) || 100;
  if (grid?.type === (CONST.GRID_TYPES?.SQUARE ?? 1)) {
    const offset = grid.getOffset(center);
    const drawn = pointsOf(grid.getVertices?.(offset));
    const x = offset.j * side;
    const y = offset.i * side;
    const polygon = drawn.length >= 3 ? drawn : [{ x, y }, { x: x + side, y }, { x: x + side, y: y + side }, { x, y: y + side }];
    return { kind: "square", polygon, offset };
  }
  const h = side / 2;
  return {
    kind: "area",
    polygon: [{ x: center.x - h, y: center.y - h }, { x: center.x + h, y: center.y - h }, { x: center.x + h, y: center.y + h }, { x: center.x - h, y: center.y + h }],
    offset: null,
  };
}

/**
 * A plate's drawing, in plate pixels: everything `paintPlate` needs, computed
 * from the scene alone.
 *
 * - `polygon`: the cell (`cellAt`), fitted to the plate with a margin, centred.
 * - `roads` / `water`: the scene's road and water lines that cross the cell's
 *   bounding box, clipped to it — `{x0, y0, x1, y1, surface}` and
 *   `{x0, y0, x1, y1, kind, navigable}`.
 * - `points`: the `points` given (`{id, found}`), each placed by a hash of its
 *   id at an angle and a distance from the centre inside the cell, so a point
 *   stands in the same place on every render and every seat.
 * - `mark`: the party's mark at `center`, `{x, y, r}`.
 * - `view`: the scene rectangle the whole plate shows, for the background's
 *   crop; `scale` is plate pixels per scene pixel.
 *
 * Null without a scene, a grid or a point.
 *
 * @param {Scene} scene
 * @param {{x: number, y: number}} center  the point in scene pixels, usually a token's centre
 * @param {number} [size]  the plate's side in plate pixels
 * @param {{points?: Array<{id: string, found: boolean}>}} [options]
 */
export function plateGeometry(scene, center, size = PLATE_PIXELS, { points = [] } = {}) {
  if (!scene?.grid || !center || !Number.isFinite(Number(center.x)) || !Number.isFinite(Number(center.y))) return null;
  const cell = cellAt(scene, center);
  if (cell.polygon.length < 3) return null;
  const xs = cell.polygon.map((p) => p.x);
  const ys = cell.polygon.map((p) => p.y);
  const box = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  const span = Math.max(box.width, box.height);
  if (!(span > 0)) return null;
  const scale = (size * (1 - 2 * MARGIN)) / span;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const toPlate = (x, y) => ({ x: size / 2 + (x - cx) * scale, y: size / 2 + (y - cy) * scale });
  const segment = (c) => {
    const clipped = Array.isArray(c) && c.length >= 4 ? clipSegment(c.slice(0, 4).map(Number), box) : null;
    if (!clipped) return null;
    const a = toPlate(clipped[0], clipped[1]);
    const b = toPlate(clipped[2], clipped[3]);
    return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
  };

  const roads = [];
  for (const wall of roadWallsOf(scene)) {
    const seg = segment(wall.c);
    if (seg) roads.push({ ...seg, surface: wallRoad(wall)?.surface ?? null });
  }
  const water = [];
  for (const wall of waterWallsOf(scene)) {
    const seg = segment(wall.c);
    const line = wallWater(wall);
    if (seg) water.push({ ...seg, kind: line?.kind ?? "river", navigable: !!line?.navigable });
  }

  // A point lands between a quarter and two thirds of the way from the centre
  // to the cell's nearest edge: clear of the mark, inside every cell shape.
  const reach = (Math.min(box.width, box.height) / 2) * scale * 0.85;
  const placed = (points ?? []).filter((p) => p?.id != null).map((p) => {
    const h = hashOf(String(p.id));
    const angle = ((h % 3600) / 3600) * 2 * Math.PI;
    const radius = (0.25 + (((h >>> 12) % 1000) / 1000) * 0.42) * reach;
    return { id: String(p.id), found: !!p.found, x: size / 2 + Math.cos(angle) * radius, y: size / 2 + Math.sin(angle) * radius };
  });

  return {
    kind: cell.kind,
    size,
    scale,
    view: { x: cx - size / 2 / scale, y: cy - size / 2 / scale, width: size / scale, height: size / scale },
    polygon: cell.polygon.map((p) => toPlate(p.x, p.y)),
    roads,
    water,
    points: placed,
    mark: { ...toPlate(Number(center.x), Number(center.y)), r: size * 0.05 },
  };
}

/** A custom property of the canvas's own style, or the fallback where the stylesheet set none. */
function cssColour(style, name, fallback) {
  const value = style?.getPropertyValue?.(name)?.trim();
  return value || fallback;
}

/**
 * Paint a plate onto a canvas: the scene's background cropped to the plate's
 * view, the ground's tint over the cell (a neutral where the cell is
 * unpainted), the water (a ribbon for a river, a line for a shore), the roads
 * in their surface's colour, the cell's outline, the points (gold dots for the
 * found; dashed rings for the Judge's unfound) and the party's mark (its image
 * in a ring once loaded). The canvas's bitmap is set to the plate's size; its
 * colours come from the stylesheet's `--acks-extras-plate-*` properties.
 *
 * @param {HTMLCanvasElement} canvasEl
 * @param {object} geometry  `plateGeometry`'s result
 * @param {object} [options]
 * @param {{image: object, rect: {x: number, y: number, width: number, height: number}}|null} [options.background]
 *   a loaded image and the scene rectangle it covers
 * @param {string|null} [options.tint]  the ground's colour; null for the neutral
 * @param {boolean} [options.isGM]  draw the points this formation has not found
 * @param {object|null} [options.markImage]  a loaded image for the mark
 */
export function paintPlate(canvasEl, geometry, { background = null, tint = null, isGM = false, markImage = null } = {}) {
  const ctx = canvasEl?.getContext?.("2d");
  if (!ctx || !geometry) return false;
  const { size, polygon } = geometry;
  canvasEl.width = size;
  canvasEl.height = size;
  const style = typeof getComputedStyle === "function" ? getComputedStyle(canvasEl) : null;
  const outline = cssColour(style, "--acks-extras-plate-outline", "#e79bab");
  const neutral = cssColour(style, "--acks-extras-plate-neutral", "#5a5052");
  const gold = cssColour(style, "--acks-extras-plate-point", "#e8bc6b");
  const ink = cssColour(style, "--acks-extras-plate-ink", "#1b1416");

  // Traced afresh for the clip, the tint and the outline: the water and the
  // roads drawn between them each begin a path of their own.
  const traceCell = () => {
    ctx.beginPath();
    polygon.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
  };

  ctx.clearRect(0, 0, size, size);
  ctx.save();
  traceCell();
  ctx.clip();
  const rect = background?.rect;
  const image = background?.image;
  const iw = Number(image?.naturalWidth ?? image?.width);
  const ih = Number(image?.naturalHeight ?? image?.height);
  if (image && rect?.width > 0 && rect?.height > 0 && iw > 0 && ih > 0) {
    const v = geometry.view;
    const sx = ((v.x - rect.x) / rect.width) * iw;
    const sy = ((v.y - rect.y) / rect.height) * ih;
    ctx.drawImage(image, sx, sy, (v.width / rect.width) * iw, (v.height / rect.height) * ih, 0, 0, size, size);
  }
  ctx.globalAlpha = image ? 0.35 : 0.8;
  ctx.fillStyle = tint || neutral;
  traceCell();
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.lineCap = "round";
  for (const w of geometry.water) {
    const colour = cssTint(WATER_TINT[w.kind] ?? WATER_TINT.river);
    ctx.beginPath();
    ctx.moveTo(w.x0, w.y0);
    ctx.lineTo(w.x1, w.y1);
    if (w.kind === "river") {
      ctx.strokeStyle = colour;
      ctx.lineWidth = size * 0.045;
      ctx.stroke();
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = "#8fc3ea";
      ctx.lineWidth = size * 0.01;
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      ctx.strokeStyle = colour;
      ctx.lineWidth = size * 0.015;
      ctx.stroke();
    }
  }
  for (const r of geometry.roads) {
    ctx.beginPath();
    ctx.moveTo(r.x0, r.y0);
    ctx.lineTo(r.x1, r.y1);
    ctx.strokeStyle = cssTint(ROAD_TINT[r.surface] ?? ROAD_TINT.earth);
    ctx.lineWidth = size * 0.022;
    ctx.stroke();
  }
  ctx.restore();

  ctx.lineWidth = size * 0.008;
  ctx.strokeStyle = outline;
  traceCell();
  ctx.stroke();

  for (const p of geometry.points) {
    ctx.beginPath();
    if (p.found) {
      ctx.arc(p.x, p.y, size * 0.022, 0, 2 * Math.PI);
      ctx.fillStyle = gold;
      ctx.fill();
      ctx.lineWidth = size * 0.006;
      ctx.strokeStyle = ink;
      ctx.stroke();
    } else if (isGM) {
      ctx.arc(p.x, p.y, size * 0.028, 0, 2 * Math.PI);
      ctx.setLineDash([size * 0.012, size * 0.01]);
      ctx.lineWidth = size * 0.007;
      ctx.strokeStyle = gold;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  const { x, y, r } = geometry.mark;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 2 * Math.PI);
  ctx.fillStyle = outline;
  ctx.fill();
  const mw = Number(markImage?.naturalWidth ?? markImage?.width);
  if (markImage && mw > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r * 0.86, 0, 2 * Math.PI);
    ctx.clip();
    ctx.drawImage(markImage, x - r, y - r, 2 * r, 2 * r);
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 2 * Math.PI);
  ctx.lineWidth = size * 0.01;
  ctx.strokeStyle = ink;
  ctx.stroke();
  return true;
}

/** How many images the client keeps loaded: the backgrounds and marks of the plates it has drawn lately. */
const IMAGES_KEPT = 12;

/** Images by URL, oldest first, each loaded once per client: `{image, ready}`. */
const images = new Map();

/**
 * The image at `url`, loading on first ask; `ready` settles true when it has
 * loaded and false when it failed. A failed load is forgotten, so the next
 * plate drawn asks again; the oldest image is dropped once more than
 * `IMAGES_KEPT` are held.
 */
function imageAt(url) {
  if (!images.has(url)) {
    const image = new Image();
    const ready = new Promise((resolve) => {
      image.onload = () => resolve(true);
      image.onerror = () => {
        images.delete(url);
        resolve(false);
      };
    });
    image.src = url;
    images.set(url, { image, ready });
    for (const key of images.keys()) {
      if (images.size <= IMAGES_KEPT) break;
      images.delete(key);
    }
  }
  return images.get(url);
}

/** The image at `url` once it has loaded, else null. */
function loadedImage(url) {
  if (!url) return null;
  const { image } = imageAt(url);
  return image.complete && image.naturalWidth > 0 ? image : null;
}

/** The rectangle a scene's background covers, from its dimensions. */
function sceneRectOf(scene) {
  const d = scene?.dimensions;
  if (!d) return null;
  return d.sceneRect ?? { x: d.sceneX, y: d.sceneY, width: d.sceneWidth, height: d.sceneHeight };
}

/**
 * Draw a plate the view described onto a canvas the sheet rendered: the
 * geometry from the plate's scene, its background and the party's mark, and
 * a second paint as each image arrives (blank until then), while the canvas
 * is still in the page.
 *
 * @param {HTMLCanvasElement} canvasEl
 * @param {{sceneId: string, center: {x: number, y: number}, points?: object[],
 *   tint?: string|null, mark?: string|null, judge?: boolean}} spec  a plate's
 *   context as the view built it
 * @returns {boolean} whether anything was drawn
 */
export function drawPlate(canvasEl, spec) {
  const scene = game.scenes?.get(spec?.sceneId) ?? null;
  const geometry = scene ? plateGeometry(scene, spec.center, PLATE_PIXELS, { points: spec.points }) : null;
  if (!geometry) return false;
  const src = backgroundSrc(scene);
  const rect = sceneRectOf(scene);
  const paint = () => paintPlate(canvasEl, geometry, {
    background: src ? { image: loadedImage(src), rect } : null,
    tint: spec.tint ?? null,
    isGM: !!spec.judge,
    markImage: loadedImage(spec.mark),
  });
  paint();
  for (const url of [src, spec.mark].filter(Boolean)) {
    const { image, ready } = imageAt(url);
    if (image.complete) continue;
    ready.then((ok) => {
      if (ok && canvasEl.isConnected) paint();
    });
  }
  return true;
}

/* -------------------------------------------- */
/*  The compass                                 */
/* -------------------------------------------- */

/**
 * The six directions out of a hex, by the grid's orientation, each in the
 * order of its bearing: a grid of hex ROWS is pointy-topped, its neighbours
 * east, south-east, south-west, west, north-west and north-east; a grid of hex
 * COLUMNS is flat-topped, its neighbours south-east, south, south-west,
 * north-west, north and north-east.
 */
export const HEX_DIRECTIONS = Object.freeze({
  rows: Object.freeze(["e", "se", "sw", "w", "nw", "ne"]),
  columns: Object.freeze(["se", "s", "sw", "nw", "n", "ne"]),
});

/** The bearing, in degrees, of each orientation's first direction. */
const FIRST_BEARING = Object.freeze({ rows: 0, columns: 30 });

/** `rows` or `columns` for a hex grid, null for any other. */
export function hexOrientation(scene) {
  const T = CONST.GRID_TYPES ?? {};
  const type = scene?.grid?.type;
  if (type === T.HEXODDR || type === T.HEXEVENR) return "rows";
  if (type === T.HEXODDQ || type === T.HEXEVENQ) return "columns";
  return null;
}

/**
 * The hex direction from one cell to another, named from the grid's own
 * centres: the nearest of the orientation's six (`HEX_DIRECTIONS`) to the
 * bearing between them, whatever the distance. Null off a hex grid or for one
 * cell to itself.
 */
export function compassBetween(scene, from, to) {
  const orientation = hexOrientation(scene);
  if (!orientation || !from || !to) return null;
  if (from.i === to.i && from.j === to.j) return null;
  const a = scene.grid.getCenterPoint(from);
  const b = scene.grid.getCenterPoint(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (!dx && !dy) return null;
  // Screen bearing: 0 is east and the angle grows clockwise, since y runs down.
  const bearing = (Math.atan2(dy, dx) * 180) / Math.PI;
  const step = Math.round((bearing - FIRST_BEARING[orientation]) / 60);
  return HEX_DIRECTIONS[orientation][((step % 6) + 6) % 6];
}

/** The neighbour of `offset` that lies in `direction` (`compassBetween`'s name), or null. */
export function neighbourToward(scene, offset, direction) {
  if (!hexOrientation(scene) || !offset) return null;
  const neighbours = scene.grid.getAdjacentOffsets?.(offset) ?? [];
  return neighbours.find((n) => compassBetween(scene, offset, n) === direction) ?? null;
}

/**
 * The six directions laid out as a three-by-three pad around the hex, read
 * left to right and top to bottom: each cell a direction's name, null for an
 * empty corner, and `"center"` for the middle. Null off a hex grid.
 */
export function compassPad(scene) {
  const orientation = hexOrientation(scene);
  if (orientation === "rows") return ["nw", null, "ne", "w", "center", "e", "sw", null, "se"];
  // A flat-topped hex has no neighbour due east or west, so those cells stay
  // empty and the four diagonals take the corners: north-east sits above the
  // level, as it does on the map, and not beside the centre.
  if (orientation === "columns") return ["nw", "n", "ne", null, "center", null, "sw", "s", "se"];
  return null;
}
