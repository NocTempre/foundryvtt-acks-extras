/* global canvas, console */
/**
 * The calibration session: what has been sampled on the viewed scene, which
 * capture mode is armed, and the fit those produce.
 *
 * The state lives HERE rather than on the assistant window because the scene
 * controls arm the modes and the window only shows the numbers — two surfaces
 * over one calibration. It also means closing the panel mid-calibration keeps
 * the samples: the work belongs to the canvas, not to a window.
 */

import { CaptureOverlay, runFit } from "./capture.mjs";
import { canvasPerImage, fitHexLattice } from "./calibrate-logic.mjs";
import { MODULE_ID, LANG_PREFIX, CONTROL_GROUP, TOOL_OFF, GRID_FAMILIES, HEX_TYPES } from "./constants.mjs";
import { backgroundTexture } from "./scene-image.mjs";
import { familyOfScene, hexProbe, sceneSetup } from "./scene-setup.mjs";
import { unitKey } from "../lib/distance-units.mjs";
import { makeLoc } from "../lib/util.mjs";

const loc = makeLoc(LANG_PREFIX);

const emptySamples = () => ({ squares: [], corners: [], scale: null });

/**
 * The GM's entered values; null means "derive it". `mapCellFeet` is the only
 * home of the map-square value — the field and its chips both write here.
 */
const emptyOpts = () => ({ mapCellFeet: null, scaleValue: null, outputFeet: null, gridSizePx: null, customFeet: null });

/** Every capture mode, in the order the toolbar offers them. */
export const CAPTURE_MODES = ["square", "corners", "scale", "eraser"];

class CalibrationSession {
  constructor() {
    this.samples = emptySamples();
    this.mode = null;
    this.independentXY = false;
    this.allowSkew = false;
    /**
     * What the apply will WRITE — the choice everything else in the panel
     * follows: which fields are shown, what a drawn box measures, and which
     * apply runs. Defaulted from the scene the session opens on.
     */
    this.gridFamily = "square";
    /** Hex offset parity: the even variant of the chosen hex family. */
    this.hexEven = false;
    /** The unit key the apply writes to `grid.units`; null keeps the scene's. */
    this.units = null;
    /** The travel mode a formation adopts here; null leaves formations alone. */
    this.mapSystem = null;
    /** The fit retained from a bake, standing in until fresh samples arrive. */
    this.bakedFit = null;
    this.opts = emptyOpts();
    this.overlay = new CaptureOverlay(this);
    this.sceneId = null;
    this.listeners = new Set();
  }

  /** The fit last computed and the samples and choices it answered; see `fit`. */
  #fitCache = null;

  /** The two hex probes last asked of the scene and the choice they answered; see `hexProbe`. */
  #probeCache = null;

  /**
   * How the SQUARE family's fit reads its samples. "Allow skew" and
   * "Independent X / Y" are that family's controls and steer only its fit: on
   * any other family they are hidden, so a value ticked earlier is ignored. A
   * hex family has no pooled axis (its box is wider than tall or the reverse)
   * and the scale-only family reads one cell size.
   */
  get fitMode() {
    if (this.gridFamily !== "square") return HEX_TYPES[this.gridFamily] ? "rect" : "square";
    if (this.allowSkew) return "affine";
    return this.independentXY ? "rect" : "square";
  }

  /** Whether the chosen family writes hexes. */
  get isHexFamily() {
    return !!HEX_TYPES[this.gridFamily];
  }

  /**
   * One hex's probe for the chosen family — `{refW, refH, refSize, basis,
   * vertices}` from `hexProbe` — or null on a family that writes no hexes. Asked
   * of a scene clone once per family, parity and scene, so the fit and the
   * surfaces that read the lattice (the overlay's preview) share one answer.
   */
  get hexProbe() {
    return this.#probes()?.own ?? null;
  }

  /** Both hex families' probes (the chosen one and the other, same parity), cached. */
  #probes() {
    if (!this.isHexFamily) return null;
    const scene = canvas?.scene ?? null;
    const key = `${scene?.id ?? ""}|${this.gridFamily}|${this.hexEven}`;
    if (this.#probeCache?.key !== key) {
      const other = Object.keys(HEX_TYPES).find((f) => f !== this.gridFamily);
      this.#probeCache = {
        key,
        own: hexProbe(scene, this.gridFamily, this.hexEven),
        other: hexProbe(scene, other, this.hexEven),
      };
    }
    return this.#probeCache;
  }

  /** Drop the cached fit and probes: the next read recomputes them. */
  #invalidate() {
    this.#fitCache = null;
    this.#probeCache = null;
  }

  /**
   * Live samples win; a fresh bake stands in until they arrive. A hex family's
   * fit is the lattice fit over its boxes (corners are not read on it); the
   * square and scale-only families fit as a grid. Cached, since the panel and
   * the overlay read it many times per render and a hex fit asks the scene for
   * two probes: it is recomputed only when the samples, the family or parity,
   * the scene or its image scale differ from the ones it answered, or after an
   * explicit invalidation (a sample change, a bake, a wipe, the canvas
   * becoming ready).
   */
  get fit() {
    const s = this.samples;
    const hex = this.isHexFamily;
    // A bake leaves a square fit, which a hex family cannot read.
    if (!(s.squares.length || s.corners.length)) return hex ? null : this.bakedFit;
    const scene = canvas?.scene ?? null;
    // Canvas px per image px; the hex fit judges a box's shape as drawn.
    const scale = hex ? canvasPerImage({ texture: scene ? backgroundTexture(scene) : null, dimensions: scene?.dimensions }) : null;
    const key = JSON.stringify([scene?.id ?? null, this.gridFamily, this.hexEven, this.fitMode, s.squares, s.corners, scale]);
    if (this.#fitCache?.key !== key) {
      let fit;
      if (hex) {
        const probes = this.#probes();
        fit = fitHexLattice({ boxes: s.squares, probe: probes.own, otherProbe: probes.other, scale });
      } else {
        fit = runFit(s, this.fitMode);
      }
      this.#fitCache = { key, fit };
    }
    return this.#fitCache.fit;
  }

  get hasSamples() {
    return !!(this.samples.squares.length || this.samples.corners.length || this.samples.scale);
  }

  /* -------------------------------------------- */
  /*  Capture                                     */
  /* -------------------------------------------- */

  /**
   * Arm a mode. A SETTER, never a toggle: arming is driven from two places
   * at once — the toolbar's `onChange` re-fires on re-entry, and the panel's
   * buttons mirror it — and a toggle would turn either into a silent disarm.
   *
   * Pass null to disarm. Corners are refused on a hex family — a hex's
   * vertices are not points of a rectangular lattice, and the hex fit reads
   * boxes — with a notice naming the box tool and the toolbar back at rest.
   */
  arm(mode) {
    if (mode === "corners" && this.isHexFamily) {
      this.#refuseCorners();
      return this.mode;
    }
    this.mode = mode ?? null;
    this.overlay.arm(this.mode);
    this.notify();
    return this.mode;
  }

  disarm() {
    if (!this.mode) return;
    this.mode = null;
    this.overlay.arm(null);
    this.notify();
  }

  /**
   * Disarm from a surface that is NOT the toolbar — the Escape key, the
   * panel's stop button. The toolbar has to be told, or it keeps a mode
   * button lit over a disarmed canvas and core's per-control memory re-arms
   * that mode the next time the group is entered.
   *
   * Only ever selects a tool within our own group: passing `control` would
   * switch the GM into it from wherever they are.
   */
  requestDisarm() {
    this.disarm();
    const controls = globalThis.ui?.controls;
    if (controls?.control?.name === CONTROL_GROUP) controls.activate({ tool: TOOL_OFF });
  }

  /** Say why corners are not offered on a hex family, then put the toolbar at rest. */
  #refuseCorners() {
    globalThis.ui?.notifications?.warn(loc("warn.cornersHex", { tool: loc("mode.square") }));
    this.requestDisarm();
  }

  /** The overlay's callback after it mutates `samples`. */
  onSamplesChanged() {
    this.#invalidate();
    this.notify();
  }

  /**
   * How many drawn cells a box spans. Stored on the sample, so the fit and
   * the row that states it cannot disagree.
   */
  setBoxCells(index, cells) {
    const box = this.samples.squares[Number(index)];
    if (!box) return;
    box.cells = cells > 0 ? cells : 1;
    this.#invalidate();
    this.overlay.redraw(this.fit);
    this.notify();
  }

  /**
   * Set one of the setup choices and re-render every surface over them. A
   * switch to a hex family while corners is armed refuses corners as arming
   * them would.
   */
  setSetup({ gridFamily, hexEven, units, mapSystem } = {}) {
    if (gridFamily !== undefined && GRID_FAMILIES.includes(gridFamily)) this.gridFamily = gridFamily;
    if (hexEven !== undefined) this.hexEven = !!hexEven;
    if (units !== undefined) this.units = units || null;
    if (mapSystem !== undefined) this.mapSystem = mapSystem || null;
    this.#invalidate();
    if (this.mode === "corners" && this.isHexFamily) this.#refuseCorners();
    this.notify();
  }

  deleteSample(kind, index) {
    if (kind === "scale") this.samples.scale = null;
    else this.samples[kind]?.splice(Number(index), 1);
    this.#invalidate();
    this.overlay.redraw(this.fit);
    this.notify();
  }

  wipe() {
    this.samples = emptySamples();
    this.bakedFit = null;
    this.#invalidate();
    this.overlay.redraw(null);
    this.notify();
  }

  /* -------------------------------------------- */
  /*  Lifecycle                                   */
  /* -------------------------------------------- */

  /** Everything cleared and the overlay torn down — a different scene. */
  reset() {
    this.samples = emptySamples();
    this.bakedFit = null;
    this.mode = null;
    this.opts = emptyOpts();
    this.#invalidate();
    this.overlay.destroy();
  }

  /**
   * Take the setup choices from the scene itself, so the panel opens showing
   * what this map already IS rather than a square-grid default over a hex
   * map. A scene with no declared system leaves the picker unset — silence is
   * "nobody has said", not "dungeon".
   */
  adoptScene(scene = canvas?.scene ?? null) {
    this.gridFamily = familyOfScene(scene);
    const hex = HEX_TYPES[this.gridFamily];
    this.hexEven = hex ? scene.grid.type === hex.even : false;
    this.units = unitKey(scene?.grid?.units);
    this.mapSystem = sceneSetup(scene).mapSystem;
    this.#invalidate();
  }

  /**
   * Samples are scene-bound, but `canvasReady` also fires on SAME-scene
   * redraws — repointing the background at a baked image is one — and
   * resetting there would throw away the fit the bake just retained.
   */
  onCanvasReady() {
    const id = canvas?.scene?.id ?? null;
    if (id !== this.sceneId) {
      this.sceneId = id;
      this.reset();
      this.adoptScene();
    }
    // A same-scene redraw can change the image (a bake repoints it), and the
    // hex fit reads the image's scale.
    this.#invalidate();
    this.notify();
  }

  /* -------------------------------------------- */
  /*  Change notification                         */
  /* -------------------------------------------- */

  /** @returns {() => void} an unsubscribe function */
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify() {
    for (const fn of [...this.listeners]) {
      try {
        fn(this);
      } catch (err) {
        console.error(`${MODULE_ID} | battlemap session listener failed`, err);
      }
    }
  }
}

/** One session per client: there is one canvas and one calibration on it. */
export const session = new CalibrationSession();
