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
import { MODULE_ID } from "./constants.mjs";

const emptySamples = () => ({ squares: [], corners: [], scale: null });

/** Every capture mode, in the order the toolbar offers them. */
export const CAPTURE_MODES = ["square", "corners", "scale", "eraser"];

class CalibrationSession {
  constructor() {
    this.samples = emptySamples();
    this.mode = null;
    this.independentXY = false;
    this.allowSkew = false;
    /** The fit retained from a bake, standing in until fresh samples arrive. */
    this.bakedFit = null;
    /** GM-entered values; null means "derive". */
    this.opts = { mapCellFeet: null, scaleValue: null, confirmFeet: null, outputFeet: null, gridSizePx: null, customFeet: null };
    this.overlay = new CaptureOverlay(this);
    this.sceneId = null;
    this.listeners = new Set();
  }

  get fitMode() {
    return this.allowSkew ? "affine" : this.independentXY ? "rect" : "square";
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

  /** The overlay's callback after it mutates `samples`. */
  onSamplesChanged() {
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
    this.opts = { mapCellFeet: null, scaleValue: null, confirmFeet: null, outputFeet: null, gridSizePx: null, customFeet: null };
    this.overlay.destroy();
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
