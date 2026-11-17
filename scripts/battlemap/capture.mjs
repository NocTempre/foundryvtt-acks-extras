/* global canvas, foundry, PIXI, document, CONST */
/**
 * The canvas half of the calibration assistant: a screen-covering pointer
 * catcher (core GridConfig's preview pattern), the sample glyphs, and the
 * live preview of the fitted grid.
 *
 * Samples are STORED in background-image pixel space and drawn by converting
 * back, so a fit survives the scene being rescaled between captures. The
 * overlay exists only while a capture mode is armed; the app owns the sample
 * arrays and is re-rendered through `onChange` after every mutation.
 */

import { fitGrid } from "./calibrate-logic.mjs";
import { backgroundTexture } from "./scene-image.mjs";
import { buildPointerCatcher } from "./pointer-catcher.mjs";

const COLOR_SQUARE = 0xff3333;
const COLOR_CORNER = 0x3399ff;
const COLOR_SCALE = 0xffaa00;
const COLOR_PREVIEW = 0xff0000;

/** Smallest committed drag, in canvas px — anything shorter is a slip. */
const MIN_DRAG = 8;

/** Eraser hit radius in canvas px (scaled by zoom at use). */
const ERASE_RADIUS = 12;

/**
 * Image px per canvas px, per axis, for the current scene background.
 *
 * Degrades to an identity mapping with no scene and no texture rather than
 * throwing: this is on the panel's RENDER path, and a canvas with no scene is
 * an ordinary state — deleting the viewed scene is one — in which a throw here
 * takes the whole window down.
 */
function imageScale() {
  const scene = canvas?.scene ?? null;
  const dims = scene?.dimensions ?? null;
  const tex = scene ? backgroundTexture(scene) : null;
  return {
    sx: tex && dims ? tex.width / dims.sceneWidth : 1,
    sy: tex && dims ? tex.height / dims.sceneHeight : 1,
    ox: dims?.sceneX ?? 0,
    oy: dims?.sceneY ?? 0,
  };
}

/** Maps a canvas point to background-image pixels. */
export function canvasToImage(pt) {
  const { sx, sy, ox, oy } = imageScale();
  return { x: (pt.x - ox) * sx, y: (pt.y - oy) * sy };
}

/**
 * Maps a background-image pixel point back to the canvas. A caller converting
 * many points reads `imageScale()` once and passes it as `scale`.
 */
export function imageToCanvas(pt, scale = imageScale()) {
  const { sx, sy, ox, oy } = scale;
  return { x: pt.x / sx + ox, y: pt.y / sy + oy };
}

/**
 * The most hexes the preview draws. A small hex over a large scene is tens of
 * thousands of outlines, which stalls a canvas redrawn on every drag; the
 * preview shows this many, nearest the boxes the Judge drew, and the fit is
 * unaffected.
 */
export const HEX_PREVIEW_MAX = 3000;

/** A lattice whose steps are closer to parallel than this (sine of the angle between them) has no preview. */
const MIN_LATTICE_SINE = 0.05;

/**
 * The outlines of the fitted hex lattice, as polygons of image-px points.
 *
 * Pure geometry, no canvas: the hex at lattice node `(i, j)` is centred at
 * `fit.centre + i·spacing.u + j·spacing.v` and its corners are the probe's
 * `vertices` (offsets from a hex's centre, in probe px) scaled per axis by
 * `fit.k`, so no hex shape is written here. Every node whose hex can touch
 * `rect` is a candidate; at most `max` are returned, the ones nearest a focus
 * point, and the search grows outward from the foci, so its cost follows
 * `max` and not the size of `rect`.
 *
 * @param {object} input
 * @param {object} input.fit  `fitHexLattice`'s answer; anything not `ok` yields no outlines.
 * @param {Array<{x:number,y:number}>} input.vertices  The probe's corner offsets.
 * @param {{x:number,y:number,w:number,h:number}} input.rect  Image px to cover.
 * @param {Array<{x:number,y:number}>} [input.focus]  Image-px points to stay near
 *   (every drawn box's centre, including one left out of the fit); the fitted
 *   centre when absent or empty.
 * @param {number} [input.max]  Cap on the polygons returned.
 * @returns {Array<Array<{x:number,y:number}>>} One polygon per hex, nearest first.
 */
export function hexPreviewOutlines({ fit, vertices, rect, focus = null, max = HEX_PREVIEW_MAX } = {}) {
  const finite = (...n) => n.every(Number.isFinite);
  if (!fit?.ok) return [];
  const { centre, k, spacing } = fit;
  const u = spacing?.u;
  const v = spacing?.v;
  if (!centre || !k || !u || !v || !finite(centre.x, centre.y, k.x, k.y, u.x, u.y, v.x, v.y)) return [];
  if (!Array.isArray(vertices) || vertices.length < 3 || !vertices.every((p) => p && finite(p.x, p.y))) return [];
  if (!rect || !finite(rect.x, rect.y, rect.w, rect.h) || rect.w <= 0 || rect.h <= 0) return [];
  const cap = Math.floor(max);
  if (!(cap >= 1)) return [];
  const lu = Math.hypot(u.x, u.y);
  const lv = Math.hypot(v.x, v.y);
  const det = u.x * v.y - u.y * v.x;
  if (!(Math.abs(det) >= MIN_LATTICE_SINE * lu * lv)) return [];
  const area = Math.abs(det);

  const offsets = vertices.map((p) => ({ x: p.x * k.x, y: p.y * k.y }));
  const rx = Math.max(...offsets.map((o) => Math.abs(o.x)));
  const ry = Math.max(...offsets.map((o) => Math.abs(o.y)));
  const box = { x0: rect.x - rx, y0: rect.y - ry, x1: rect.x + rect.w + rx, y1: rect.y + rect.h + ry };
  const foci = (focus ?? []).filter((p) => p && finite(p.x, p.y));
  if (!foci.length) foci.push(centre);

  const toNode = (p) => {
    const dx = p.x - centre.x;
    const dy = p.y - centre.y;
    return { i: (dx * v.y - dy * v.x) / det, j: (dy * u.x - dx * u.y) / det };
  };
  const corners = [[box.x0, box.y0], [box.x1, box.y0], [box.x0, box.y1], [box.x1, box.y1]].map(([x, y]) => toNode({ x, y }));
  const iLo = Math.floor(Math.min(...corners.map((c) => c.i)));
  const iHi = Math.ceil(Math.max(...corners.map((c) => c.i)));
  const jLo = Math.floor(Math.min(...corners.map((c) => c.j)));
  const jHi = Math.ceil(Math.max(...corners.map((c) => c.j)));
  // Past this radius every candidate is inside the ball.
  const reach = Math.max(...foci.flatMap((f) => [[box.x0, box.y0], [box.x1, box.y0], [box.x0, box.y1], [box.x1, box.y1]].map(([x, y]) => Math.hypot(x - f.x, y - f.y)))) + 1;
  const fociNodes = foci.map((f) => ({ f, n: toNode(f) }));

  // Grow a ball around the foci until it holds `cap` candidates inside the
  // box: every candidate within the radius is found, so the nearest `cap` of
  // them are exactly the nearest `cap` overall.
  let rho = Math.min(Math.sqrt(cap * area), reach);
  let found;
  for (;;) {
    found = new Map();
    const di = (rho * lv) / area + 1;
    const dj = (rho * lu) / area + 1;
    for (const { f, n } of fociNodes) {
      for (let i = Math.max(iLo, Math.ceil(n.i - di)); i <= Math.min(iHi, Math.floor(n.i + di)); i++) {
        for (let j = Math.max(jLo, Math.ceil(n.j - dj)); j <= Math.min(jHi, Math.floor(n.j + dj)); j++) {
          const key = `${i},${j}`;
          if (found.has(key)) continue;
          const x = centre.x + i * u.x + j * v.x;
          const y = centre.y + i * u.y + j * v.y;
          if (x < box.x0 || x > box.x1 || y < box.y0 || y > box.y1) continue;
          let d = Math.hypot(x - f.x, y - f.y);
          for (const o of foci) d = Math.min(d, Math.hypot(x - o.x, y - o.y));
          if (d <= rho) found.set(key, { i, j, x, y, d });
        }
      }
    }
    if (found.size >= cap || rho >= reach) break;
    rho = Math.min(rho * 2, reach);
  }
  return [...found.values()]
    .sort((a, b) => a.d - b.d || a.i - b.i || a.j - b.j)
    .slice(0, cap)
    .map((n) => offsets.map((o) => ({ x: n.x + o.x, y: n.y + o.y })));
}

/** The screen-covering pointer catcher that records and draws calibration samples. */
export class CaptureOverlay {
  /**
   * @param {object} host  Owns the state: `host.samples` =
   *   `{ squares: [], corners: [], scale: {x1,y1,x2,y2}|null }`, and
   *   `host.onSamplesChanged()` is called after every mutation.
   */
  constructor(host) {
    this.host = host;
    this.mode = null;
    this.container = null;
    this.drag = null;
    this.keyHandler = this.onKeyDown.bind(this);
  }

  get active() {
    return !!this.mode;
  }

  /** Arm a capture mode ("square" | "corners" | "scale" | "eraser"), or disarm with null. */
  arm(mode) {
    this.mode = mode;
    if (!mode) return this.destroy();
    if (!this.container) this.build();
    canvas.app.view.style.cursor = "crosshair";
    this.redraw();
  }

  build() {
    const container = (this.container = canvas.stage.addChild(new PIXI.Container()));
    container.eventMode = "passive";
    container.zIndex = 10000;

    // The shared screen-space catcher: swallows every canvas pointer event
    // while a mode is armed, and hands a press or move over the board alone.
    this.catcher = buildPointerCatcher(container, {
      down: (ev) => this.onPointerDown(ev),
      move: (ev) => this.onPointerMove(ev),
      up: (ev, over) => this.onPointerUp(ev, over),
    });

    this.previewMesh = container.addChild(new foundry.canvas.containers.GridMesh().initialize({ color: COLOR_PREVIEW }));
    this.previewMesh.visible = false;
    // Deaf, like every other child above the catcher — added after it, so
    // it sits on top, and turns visible the moment a fit exists.
    this.previewMesh.eventMode = "none";
    this.previewLines = container.addChild(new PIXI.Graphics());
    this.previewLines.eventMode = "none";
    this.glyphs = container.addChild(new PIXI.Graphics());
    this.glyphs.eventMode = "none";
    this.labels = container.addChild(new PIXI.Container());
    this.labels.eventMode = "none";
    this.temp = container.addChild(new PIXI.Graphics());
    this.temp.eventMode = "none";

    document.addEventListener("keydown", this.keyHandler);
  }

  destroy() {
    this.mode = null;
    this.drag = null;
    document.removeEventListener("keydown", this.keyHandler);
    if (this.container && !this.container.destroyed) this.container.destroy({ children: true });
    this.container = null;
    if (canvas?.app?.view) canvas.app.view.style.cursor = "";
  }

  /* -------------------------------------------- */
  /*  Pointer handling                            */
  /* -------------------------------------------- */

  point(ev) {
    return ev.getLocalPosition(canvas.stage);
  }

  onPointerDown(ev) {
    // Left button only — the right button pans the canvas, so it never
    // edits samples. Ctrl+Z undoes; the eraser and panel rows delete a
    // chosen one.
    if (ev.button !== 0) return;
    const p = this.point(ev);
    if (this.mode === "corners") {
      this.host.samples.corners.push(canvasToImage(p));
      return this.commit();
    }
    if (this.mode === "eraser") return void this.erase(p);
    if (this.mode === "square" || this.mode === "scale") this.drag = { start: p, current: p };
  }

  onPointerMove(ev) {
    if (!this.drag) return;
    this.drag.current = this.point(ev);
    this.drawTemp();
  }

  /** A release off the board (over a window) abandons the drag instead of committing it. */
  onPointerUp(_ev, over = true) {
    const drag = this.drag;
    this.drag = null;
    this.temp?.clear();
    if (!drag || !over) return;
    const { start, current } = drag;
    if (Math.hypot(current.x - start.x, current.y - start.y) < MIN_DRAG) return;
    if (this.mode === "square") {
      const a = canvasToImage(start);
      const b = canvasToImage(current);
      this.host.samples.squares.push({
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        w: Math.abs(b.x - a.x),
        h: Math.abs(b.y - a.y),
        // How many drawn cells the box spans in each direction, editable on
        // its panel row.
        across: 1,
        down: 1,
      });
    } else if (this.mode === "scale") {
      const a = canvasToImage(start);
      const b = canvasToImage(current);
      this.host.samples.scale = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    }
    this.commit();
  }

  /**
   * Escape disarms, everywhere else in Foundry and here — it does not
   * delete a sample. Ctrl+Z is the undo; the sampling group drives no
   * placeable layer, so core has no undo of its own to collide with.
   */
  onKeyDown(ev) {
    // A focused field keeps its own undo and Escape.
    if (ev.target?.closest?.("input, textarea, select, [contenteditable]")) return;
    if (ev.code === "KeyZ" && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      ev.stopPropagation();
      return void this.removeLast();
    }
    if (ev.code !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    this.host.requestDisarm();
  }

  /* -------------------------------------------- */
  /*  Sample mutation                             */
  /* -------------------------------------------- */

  commit() {
    this.host.onSamplesChanged();
    this.redraw();
  }

  removeLast() {
    const s = this.host.samples;
    if (s.scale) s.scale = null;
    else if (s.corners.length && s.corners.length >= s.squares.length) s.corners.pop();
    else if (s.squares.length) s.squares.pop();
    else return;
    this.commit();
  }

  /** Delete the sample nearest the click, within the eraser radius. */
  erase(canvasPt) {
    const p = canvasToImage(canvasPt);
    const { sx } = imageScale();
    const radius = (ERASE_RADIUS / (canvas.stage.scale.x || 1)) * sx;
    const s = this.host.samples;
    let best = null;
    s.corners.forEach((c, i) => {
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d <= radius && (!best || d < best.d)) best = { d, kind: "corners", index: i };
    });
    s.squares.forEach((r, i) => {
      // Distance to the rect's outline: inside counts as its edge distance.
      const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
      const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
      const inside = dx === 0 && dy === 0;
      const edge = inside
        ? Math.min(p.x - r.x, r.x + r.w - p.x, p.y - r.y, r.y + r.h - p.y)
        : Math.hypot(dx, dy);
      if (edge <= radius && (!best || edge < best.d)) best = { d: edge, kind: "squares", index: i };
    });
    if (s.scale) {
      const d = segmentDistance(p, s.scale);
      if (d <= radius && (!best || d < best.d)) best = { d, kind: "scale" };
    }
    if (!best) return;
    if (best.kind === "scale") s.scale = null;
    else s[best.kind].splice(best.index, 1);
    this.commit();
  }

  /* -------------------------------------------- */
  /*  Drawing                                     */
  /* -------------------------------------------- */

  drawTemp() {
    const g = this.temp;
    g.clear();
    if (!this.drag) return;
    const { start, current } = this.drag;
    const width = 2 / (canvas.stage.scale.x || 1);
    if (this.mode === "square") {
      g.lineStyle(width, COLOR_SQUARE, 1);
      g.drawRect(Math.min(start.x, current.x), Math.min(start.y, current.y), Math.abs(current.x - start.x), Math.abs(current.y - start.y));
    } else if (this.mode === "scale") {
      g.lineStyle(width, COLOR_SCALE, 1);
      g.moveTo(start.x, start.y).lineTo(current.x, current.y);
    }
  }

  /** Redraw glyphs and the fitted-grid preview. `fit` comes from the app. */
  redraw(fit = this.host.fit) {
    if (!this.container || this.container.destroyed) return;
    const g = this.glyphs;
    g.clear();
    this.labels.removeChildren().forEach((c) => c.destroy());
    const zoom = canvas.stage.scale.x || 1;
    const width = 2 / zoom;
    const s = this.host.samples;

    s.squares.forEach((r, i) => {
      const a = imageToCanvas({ x: r.x, y: r.y });
      const b = imageToCanvas({ x: r.x + r.w, y: r.y + r.h });
      g.lineStyle(width, COLOR_SQUARE, 1);
      g.drawRect(a.x, a.y, b.x - a.x, b.y - a.y);
      this.label(`${i + 1}`, a, COLOR_SQUARE, zoom);
    });
    s.corners.forEach((c, i) => {
      const p = imageToCanvas(c);
      g.lineStyle(0);
      g.beginFill(COLOR_CORNER, 1);
      g.drawCircle(p.x, p.y, 4 / zoom);
      g.endFill();
      this.label(`${i + 1}`, p, COLOR_CORNER, zoom);
    });
    if (s.scale) {
      const a = imageToCanvas({ x: s.scale.x1, y: s.scale.y1 });
      const b = imageToCanvas({ x: s.scale.x2, y: s.scale.y2 });
      g.lineStyle(width * 1.5, COLOR_SCALE, 1);
      g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      // End ticks perpendicular to the segment.
      const nx = -(b.y - a.y);
      const ny = b.x - a.x;
      const nl = Math.hypot(nx, ny) || 1;
      const t = 8 / zoom;
      for (const e of [a, b]) g.moveTo(e.x - (nx / nl) * t, e.y - (ny / nl) * t).lineTo(e.x + (nx / nl) * t, e.y + (ny / nl) * t);
    }

    this.drawPreview(fit);
  }

  label(text, at, color, zoom) {
    const t = new PIXI.Text(text, { fontSize: 12, fill: color, fontFamily: "Signika, sans-serif" });
    t.scale.set(1 / zoom);
    t.position.set(at.x + 4 / zoom, at.y - 16 / zoom);
    this.labels.addChild(t);
  }

  drawPreview(fit) {
    this.previewLines.clear();
    this.previewMesh.visible = false;
    if (!fit?.ok) return;
    if (this.host.isHexFamily) return this.drawHexPreview(fit);
    // Only a square fit and a hex family's lattice have lines to promise;
    // scale-only draws no grid at all.
    if (this.host.gridFamily && this.host.gridFamily !== "square") return;
    const dims = canvas.scene.dimensions;
    const { sx, sy } = imageScale();

    // An orthogonal, near-square fit previews through core's own GridMesh;
    // anything anisotropic or skewed draws its lattice lines directly
    // (GridMesh renders only square cells).
    const cellX = fit.sizeX / sx;
    const cellY = fit.sizeY / sy;
    const orthogonal = !fit.u;
    if (orthogonal && Math.abs(cellX - cellY) < 0.5) {
      const cell = (cellX + cellY) / 2;
      const origin = imageToCanvas({ x: fit.phaseX, y: fit.phaseY });
      const p0x = mod(origin.x, cell) - cell;
      const p0y = mod(origin.y, cell) - cell;
      this.previewMesh.initialize({
        type: CONST.GRID_TYPES.SQUARE,
        width: dims.width - p0x + cell,
        height: dims.height - p0y + cell,
        size: cell,
      });
      this.previewMesh.position.set(p0x, p0y);
      this.previewMesh.visible = true;
      return;
    }

    const u = fit.u ? { x: fit.u.x / sx, y: fit.u.y / sy } : { x: cellX, y: 0 };
    const v = fit.v ? { x: fit.v.x / sx, y: fit.v.y / sy } : { x: 0, y: cellY };
    const O = imageToCanvas({ x: fit.phaseX, y: fit.phaseY });
    drawLattice(this.previewLines, O, u, v, dims, 1.5 / (canvas.stage.scale.x || 1));
  }

  /**
   * The hex family's preview: the fitted lattice's outlines over the scene's
   * image, from the probe's corners (`hexPreviewOutlines`), capped at
   * `HEX_PREVIEW_MAX` and kept near the boxes drawn.
   */
  drawHexPreview(fit) {
    const dims = canvas.scene?.dimensions;
    const vertices = this.host.hexProbe?.vertices;
    if (!dims || !vertices) return;
    const scale = imageScale();
    const rect = { x: 0, y: 0, w: dims.sceneWidth * scale.sx, h: dims.sceneHeight * scale.sy };
    const focus = this.host.samples.squares.map((r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 }));
    const g = this.previewLines;
    g.lineStyle(1.5 / (canvas.stage.scale.x || 1), COLOR_PREVIEW, 0.9);
    for (const outline of hexPreviewOutlines({ fit, vertices, rect, focus })) {
      const pts = outline.map((p) => imageToCanvas(p, scale));
      g.moveTo(pts[0].x, pts[0].y);
      for (let n = 1; n < pts.length; n++) g.lineTo(pts[n].x, pts[n].y);
      g.lineTo(pts[0].x, pts[0].y);
    }
  }
}

const mod = (a, n) => ((a % n) + n) % n;

function segmentDistance(p, { x1, y1, x2, y2 }) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - x1) * dx + (p.y - y1) * dy) / l2)) : 0;
  return Math.hypot(p.x - (x1 + t * dx), p.y - (y1 + t * dy));
}

/** Draw both line families of the lattice `O + i·u + j·v` across the canvas rect. */
function drawLattice(g, O, u, v, dims, width) {
  const det = u.x * v.y - u.y * v.x;
  if (Math.abs(det) < 1e-9) return;
  const rectCorners = [
    { x: 0, y: 0 },
    { x: dims.width, y: 0 },
    { x: 0, y: dims.height },
    { x: dims.width, y: dims.height },
  ];
  const idx = rectCorners.map((p) => {
    const dx = p.x - O.x;
    const dy = p.y - O.y;
    return { i: (dx * v.y - dy * v.x) / det, j: (dy * u.x - dx * u.y) / det };
  });
  const iMin = Math.floor(Math.min(...idx.map((c) => c.i))) - 1;
  const iMax = Math.ceil(Math.max(...idx.map((c) => c.i))) + 1;
  const jMin = Math.floor(Math.min(...idx.map((c) => c.j))) - 1;
  const jMax = Math.ceil(Math.max(...idx.map((c) => c.j))) + 1;
  g.lineStyle(width, COLOR_PREVIEW, 0.9);
  for (let i = iMin; i <= iMax; i++) {
    g.moveTo(O.x + i * u.x + jMin * v.x, O.y + i * u.y + jMin * v.y);
    g.lineTo(O.x + i * u.x + jMax * v.x, O.y + i * u.y + jMax * v.y);
  }
  for (let j = jMin; j <= jMax; j++) {
    g.moveTo(O.x + iMin * u.x + j * v.x, O.y + iMin * u.y + j * v.y);
    g.lineTo(O.x + iMax * u.x + j * v.x, O.y + iMax * u.y + j * v.y);
  }
}

/** Run the solver over the host's samples in the host's fit mode. */
export function runFit(samples, mode) {
  return fitGrid({ squares: samples.squares, corners: samples.corners, mode });
}
