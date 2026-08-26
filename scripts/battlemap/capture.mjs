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

const COLOR_SQUARE = 0xff3333;
const COLOR_CORNER = 0x3399ff;
const COLOR_SCALE = 0xffaa00;
const COLOR_PREVIEW = 0xff0000;

/** Smallest committed drag, in canvas px — anything shorter is a slip. */
const MIN_DRAG = 8;

/** Eraser hit radius in canvas px (scaled by zoom at use). */
const ERASE_RADIUS = 12;

/** Image px per canvas px, per axis, for the current scene background. */
function imageScale() {
  const scene = canvas.scene;
  const dims = scene.dimensions;
  const tex = backgroundTexture(scene);
  return {
    sx: tex ? tex.width / dims.sceneWidth : 1,
    sy: tex ? tex.height / dims.sceneHeight : 1,
    ox: dims.sceneX,
    oy: dims.sceneY,
  };
}

export function canvasToImage(pt) {
  const { sx, sy, ox, oy } = imageScale();
  return { x: (pt.x - ox) * sx, y: (pt.y - oy) * sy };
}

export function imageToCanvas(pt) {
  const { sx, sy, ox, oy } = imageScale();
  return { x: pt.x / sx + ox, y: pt.y / sy + oy };
}

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

    // Screen-space pointer catcher: invisible, but swallows every canvas
    // pointer event while a mode is armed regardless of pan and zoom.
    const catcher = (this.catcher = container.addChild(new PIXI.Sprite(PIXI.Texture.WHITE)));
    catcher.alpha = 0;
    catcher.eventMode = "static";
    catcher.hitArea = canvas.app.screen;
    catcher.updateTransform = function () {
      const screen = canvas.app.screen;
      this.width = screen.width;
      this.height = screen.height;
      this._boundsID++;
      this.transform.updateTransform(PIXI.Transform.IDENTITY);
      this.worldAlpha = this.alpha;
    };
    catcher.on("pointerdown", (ev) => this.onPointerDown(ev));
    catcher.on("pointermove", (ev) => this.onPointerMove(ev));
    catcher.on("pointerup", (ev) => this.onPointerUp(ev));
    catcher.on("pointerupoutside", (ev) => this.onPointerUp(ev));

    this.previewMesh = container.addChild(new foundry.canvas.containers.GridMesh().initialize({ color: COLOR_PREVIEW }));
    this.previewMesh.visible = false;
    // Deaf, like every other child above the catcher. It is added AFTER the
    // catcher, so it sits on top of it, and it turns visible the moment a fit
    // exists — which is to say the moment the FIRST sample lands. Left able to
    // take a hit it swallows the pointer for every drag after that one, and
    // the symptom is a capture layer that works exactly once.
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
    // Right-click anywhere while armed: undo the newest sample.
    if (ev.button === 2) return void this.removeLast();
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

  onPointerUp() {
    const drag = this.drag;
    this.drag = null;
    this.temp?.clear();
    if (!drag) return;
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
      });
    } else if (this.mode === "scale") {
      const a = canvasToImage(start);
      const b = canvasToImage(current);
      this.host.samples.scale = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    }
    this.commit();
  }

  /**
   * Escape means GET OUT, everywhere else in Foundry and here. It disarms
   * rather than deleting a sample: undoing the last sample is right-click,
   * and binding the universal escape key to a destructive edit meant the one
   * key a GM presses to leave the tool ate their work instead.
   */
  onKeyDown(ev) {
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
