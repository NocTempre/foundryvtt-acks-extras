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
import { MODULE_ID, CONTROL_GROUP, TOOL_OFF, GRID_FAMILIES, HEX_TYPES } from "./constants.mjs";
import { familyOfScene, sceneSetup } from "./scene-setup.mjs";
import { unitKey } from "../lib/distance-units.mjs";

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

  /**
   * A hex's bounding box is taller than it is wide (or wider than tall), so a
   * hex family fits the two axes SEPARATELY whatever the square-grid
   * checkbox says — pooling them would average a hex's two edges into one
   * number that describes neither.
   */
  get fitMode() {
    if (this.allowSkew) return "affine";
    if (HEX_TYPES[this.gridFamily]) return "rect";
    return this.independentXY ? "rect" : "square";
  }

  /** Whether the chosen family writes hexes. */
  get isHexFamily() {
    return !!HEX_TYPES[this.gridFamily];
  }

  /** Live samples win; a fresh bake stands in until they arrive. */
  get fit() {
    const s = this.samples;
    if (s.squares.length || s.corners.length) return runFit(s, this.fitMode);
    return this.bakedFit;
  }

  get hasSamples() {
    return !!(this.samples.squares.length || this.samples.corners.length || this.samples.scale);
  }

  /* -------------------------------------------- */
  /*  Capture                                     */
  /* -------------------------------------------- */

  /**
   * Arm a mode. A SETTER, never a toggle: arming is driven from two places at
   * once — the toolbar re-fires `onChange` for the already-active tool when
   * the group is re-entered, and the panel's buttons mirror it — and a toggle
   * turned each of those into a silent disarm. That is what stopped a second
   * box being drawn: the mode looked armed and was not.
   *
   * Pass null to disarm.
   */
  arm(mode) {
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

  /** The overlay's callback after it mutates `samples`. */
  onSamplesChanged() {
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
    this.overlay.redraw(this.fit);
    this.notify();
  }

  /** Set one of the setup choices and re-render every surface over them. */
  setSetup({ gridFamily, hexEven, units, mapSystem } = {}) {
    if (gridFamily !== undefined && GRID_FAMILIES.includes(gridFamily)) this.gridFamily = gridFamily;
    if (hexEven !== undefined) this.hexEven = !!hexEven;
    if (units !== undefined) this.units = units || null;
    if (mapSystem !== undefined) this.mapSystem = mapSystem || null;
    this.notify();
  }

  deleteSample(kind, index) {
    if (kind === "scale") this.samples.scale = null;
    else this.samples[kind]?.splice(Number(index), 1);
    this.overlay.redraw(this.fit);
    this.notify();
  }

  wipe() {
    this.samples = emptySamples();
    this.bakedFit = null;
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
