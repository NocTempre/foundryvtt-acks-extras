/* global game, canvas, ui, foundry, Hooks */
/**
 * The calibration assistant: arms capture modes on the canvas, shows the live
 * fit, takes the GM's scale decisions, and fires the independent apply
 * actions. One instance per client; the scene-controls tool and the
 * scene-config row both open it.
 */

import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import { CaptureOverlay, runFit, imageToCanvas } from "./capture.mjs";
import { feetPerSquare, roundSuggestions, outputGridSize } from "./calibrate-logic.mjs";
import { applyGridCalibration, bakeCorrectedBackground } from "./apply.mjs";
import { rescaleSceneTokens, applyFootprintToSelected, resetSelectedFootprints } from "./token-scale.mjs";
import { backgroundTexture } from "./scene-image.mjs";
import { FEET_PER_RANK } from "../formation/trap-rules.mjs";
import { makeLoc } from "../lib/util.mjs";

const loc = makeLoc(LANG_PREFIX);

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** The size hotbar's chips, in feet: halves and small multiples of the combat square. */
const HOTBAR_FEET = [FEET_PER_RANK / 2, FEET_PER_RANK, FEET_PER_RANK * 2, FEET_PER_RANK * 3, FEET_PER_RANK * 4, FEET_PER_RANK * 6];

/** Output-square selector chips, in feet. */
const OUTPUT_FEET = [FEET_PER_RANK, FEET_PER_RANK * 2, FEET_PER_RANK * 10, FEET_PER_RANK * 20];

const GRID_PX_MAX = 300;

export default class BattlemapAssistant extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "acks-extras-battlemap",
    classes: ["acks-ui", "acks", "acks2", "acks-extras", "acks-extras-battlemap"],
    tag: "form",
    window: { title: `${LANG_PREFIX}.title`, icon: "fa-solid fa-ruler-combined" },
    position: { width: 420 },
    form: { handler: BattlemapAssistant.#submit, submitOnChange: true, closeOnSubmit: false },
    actions: {
      setMode: BattlemapAssistant.#onSetMode,
      wipe: BattlemapAssistant.#onWipe,
      deleteSample: BattlemapAssistant.#onDeleteSample,
      confirmChip: BattlemapAssistant.#onConfirmChip,
      outputChip: BattlemapAssistant.#onOutputChip,
      applyGrid: BattlemapAssistant.#onApplyGrid,
      bake: BattlemapAssistant.#onBake,
      rescaleTokens: BattlemapAssistant.#onRescaleTokens,
      sizeChip: BattlemapAssistant.#onSizeChip,
      applyCustomSize: BattlemapAssistant.#onApplyCustomSize,
      resetFootprints: BattlemapAssistant.#onResetFootprints,
    },
  };

  static PARTS = { body: { template: `modules/${MODULE_ID}/templates/battlemap/assistant-body.hbs` } };

  constructor(options = {}) {
    super(options);
    this.samples = { squares: [], corners: [], scale: null };
    this.overlay = new CaptureOverlay(this);
    this.captureMode = null;
    this.independentXY = false;
    this.allowSkew = false;
    /** GM-entered values; null means "derive". */
    this.opts = { mapCellFeet: null, scaleValue: null, confirmFeet: null, outputFeet: null, gridSizePx: null, customFeet: null };
    this.bakedFit = null;
    // Samples are scene-bound, but canvasReady also fires on SAME-scene
    // redraws — repointing the background at a baked image is one — and a
    // reset there would wipe the fit the bake just retained. Only an actual
    // scene change clears state.
    this.#canvasReady = () => {
      if (canvas?.scene?.id !== this.#sceneId) {
        this.#sceneId = canvas?.scene?.id ?? null;
        this.#reset();
      }
      this.render();
    };
  }

  #canvasReady;

  #sceneId = null;

  get fitMode() {
    return this.allowSkew ? "affine" : this.independentXY ? "rect" : "square";
  }

  /** The current fit: live samples win; a fresh bake stands in after a wipe. */
  get fit() {
    const s = this.samples;
    if (s.squares.length || s.corners.length) return runFit(s, this.fitMode);
    return this.bakedFit;
  }

  #reset() {
    this.samples = { squares: [], corners: [], scale: null };
    this.bakedFit = null;
    this.captureMode = null;
    this.overlay.destroy();
  }

  onSamplesChanged() {
    this.render();
  }

  /* -------------------------------------------- */
  /*  Derivations                                 */
  /* -------------------------------------------- */

  /** The map's drawn-box value in feet: GM confirmation > scale bar > box field. */
  get mapCellFeet() {
    if (this.opts.confirmFeet > 0) return this.opts.confirmFeet;
    const bar = this.scaleBarFeet;
    if (bar > 0) return bar;
    if (this.opts.mapCellFeet > 0) return this.opts.mapCellFeet;
    return FEET_PER_RANK;
  }

  get scaleBarFeet() {
    const fit = this.fit;
    const seg = this.samples.scale;
    if (!fit?.ok || !seg || !(this.opts.scaleValue > 0)) return null;
    return feetPerSquare({ dx: seg.x2 - seg.x1, dy: seg.y2 - seg.y1, value: this.opts.scaleValue, sizeX: fit.sizeX, sizeY: fit.sizeY });
  }

  get outputFeet() {
    return this.opts.outputFeet > 0 ? this.opts.outputFeet : this.mapCellFeet;
  }

  /** Default grid px: keep the drawn cell's current on-canvas size, re-pitched to the output square. */
  get gridSizePx() {
    if (this.opts.gridSizePx > 0) return Math.round(this.opts.gridSizePx);
    const fit = this.fit;
    if (!fit?.ok) return null;
    const cellCanvas = cellOnCanvas(fit);
    const out = outputGridSize({ fittedCellPx: cellCanvas, mapCellFeet: this.mapCellFeet, outputFeet: this.outputFeet });
    if (!out) return null;
    const min = globalThis.CONST?.GRID_MIN_SIZE ?? 20;
    return Math.round(Math.min(GRID_PX_MAX, Math.max(min, out.px)));
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  async _prepareContext() {
    const fit = this.fit;
    this.overlay.redraw(fit);
    const scene = canvas?.scene ?? null;
    const barFeet = this.scaleBarFeet;
    const rawFeet = barFeet ?? (this.opts.mapCellFeet > 0 ? this.opts.mapCellFeet : null);
    const aligned = fit?.ok ? outputGridSize({ fittedCellPx: 1, mapCellFeet: this.mapCellFeet, outputFeet: this.outputFeet })?.aligned : true;
    const squareGrid = scene?.grid?.type === globalThis.CONST?.GRID_TYPES?.SQUARE;
    const hasBackground = !!backgroundTexture(scene);
    const dropBack = !!(fit?.ok && fit.u && Math.abs(fit.skewDeg) < 0.5 && Math.abs(fit.rotationDeg) < 0.5);

    return {
      scene,
      modes: ["square", "corners", "scale", "eraser"].map((m) => ({
        mode: m,
        label: loc(`mode.${m}`),
        active: this.captureMode === m,
      })),
      independentXY: this.independentXY,
      allowSkew: this.allowSkew,
      opts: this.opts,
      sampleRows: [
        ...this.samples.squares.map((r, i) => ({
          kind: "squares",
          index: i,
          label: loc("samples.square", { n: i + 1, w: Math.round(r.w), h: Math.round(r.h) }),
        })),
        ...this.samples.corners.map((c, i) => ({
          kind: "corners",
          index: i,
          label: loc("samples.corner", { n: i + 1, x: Math.round(c.x), y: Math.round(c.y) }),
        })),
        ...(this.samples.scale
          ? [{ kind: "scale", index: 0, label: loc("samples.scale", { px: Math.round(Math.hypot(this.samples.scale.x2 - this.samples.scale.x1, this.samples.scale.y2 - this.samples.scale.y1)) }) }]
          : []),
      ],
      fit,
      fitOk: !!fit?.ok,
      fitCells: fit?.ok
        ? fit.sizeX === fit.sizeY
          ? loc("fit.cell", { px: fit.sizeX.toFixed(1) })
          : loc("fit.cellXY", { x: fit.sizeX.toFixed(1), y: fit.sizeY.toFixed(1) })
        : null,
      fitAffine: fit?.ok && fit.u ? { skew: fit.skewDeg.toFixed(2), rotation: fit.rotationDeg.toFixed(2) } : null,
      fitQuality: fit?.ok ? loc("fit.quality", { rms: (fit.rmsPct * 100).toFixed(1), confidence: loc(`fit.confidence.${fit.confidence}`) }) : null,
      dropBack,
      rawFeet: rawFeet ? Number(rawFeet.toFixed(2)) : null,
      barFeet: barFeet ? Number(barFeet.toFixed(2)) : null,
      suggestions: rawFeet ? roundSuggestions(rawFeet).map((v) => ({ value: v, active: this.mapCellFeet === v })) : [],
      mapCellFeet: this.mapCellFeet,
      outputChips: OUTPUT_FEET.map((v) => ({ value: v, active: this.outputFeet === v })),
      outputFeet: this.outputFeet,
      gridSizePx: this.gridSizePx,
      notAligned: !aligned,
      canApply: !!fit?.ok && squareGrid && hasBackground,
      canBake: !!(fit?.ok && fit.u && Math.abs(fit.skewDeg) >= 0.1) || !!(fit?.ok && fit.u && Math.abs(fit.rotationDeg) >= 0.1),
      warnNotSquare: scene && !squareGrid,
      warnNoBackground: scene && !hasBackground,
      warnResidual: !!(fit?.ok && fit.confidence === "loose"),
      hotbar: HOTBAR_FEET.map((v) => ({ value: v, label: `${v}'` })),
      units: scene?.grid?.units || "ft",
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.#sceneId = canvas?.scene?.id ?? null;
    if (options.isFirstRender) Hooks.on("canvasReady", this.#canvasReady);
  }

  _onClose(options) {
    super._onClose(options);
    Hooks.off("canvasReady", this.#canvasReady);
    this.#reset();
  }

  /* -------------------------------------------- */
  /*  Handlers                                    */
  /* -------------------------------------------- */

  static #submit(_event, _form, formData) {
    const d = foundry.utils.expandObject(formData.object);
    const num = (v) => (Number(v) > 0 ? Number(v) : null);
    this.independentXY = !!d.independentXY;
    this.allowSkew = !!d.allowSkew;
    this.opts = {
      mapCellFeet: num(d.mapCellFeet),
      scaleValue: num(d.scaleValue),
      confirmFeet: num(d.confirmFeet),
      outputFeet: num(d.outputFeet),
      gridSizePx: num(d.gridSizePx),
      customFeet: num(d.customFeet),
    };
    this.render();
  }

  static #onSetMode(_event, target) {
    const mode = target.dataset.mode;
    this.captureMode = this.captureMode === mode ? null : mode;
    this.overlay.arm(this.captureMode);
    this.render();
  }

  static #onWipe() {
    this.samples = { squares: [], corners: [], scale: null };
    this.bakedFit = null;
    this.overlay.redraw(null);
    this.render();
  }

  static #onDeleteSample(_event, target) {
    const { kind, index } = target.dataset;
    if (kind === "scale") this.samples.scale = null;
    else this.samples[kind]?.splice(Number(index), 1);
    this.render();
  }

  static #onConfirmChip(_event, target) {
    this.opts.confirmFeet = Number(target.dataset.value);
    this.render();
  }

  static #onOutputChip(_event, target) {
    this.opts.outputFeet = Number(target.dataset.value);
    this.render();
  }

  static async #onApplyGrid() {
    const fit = this.fit;
    if (!fit?.ok || !canvas?.scene) return;
    const applied = await applyGridCalibration(canvas.scene, fit, {
      gridSize: this.gridSizePx,
      outputFeet: this.outputFeet,
      mapCellFeet: this.mapCellFeet,
    });
    if (applied) this.render();
  }

  static async #onBake() {
    const fit = this.fit;
    if (!fit?.ok || !fit.u || !canvas?.scene) return;
    const result = await bakeCorrectedBackground(canvas.scene, fit);
    if (!result) return;
    this.samples = { squares: [], corners: [], scale: null };
    this.bakedFit = result.fit;
    this.render();
  }

  static async #onRescaleTokens() {
    if (!canvas?.scene) return;
    const count = await rescaleSceneTokens(canvas.scene);
    ui.notifications.info(loc("tokens.rescaled", { count }));
  }

  static async #onSizeChip(_event, target) {
    const feet = Number(target.dataset.feet);
    const count = await applyFootprintToSelected({ w: feet, h: feet });
    ui.notifications.info(loc("tokens.applied", { count, feet }));
  }

  static async #onApplyCustomSize() {
    const feet = this.opts.customFeet;
    if (!(feet > 0)) return;
    const count = await applyFootprintToSelected({ w: feet, h: feet });
    ui.notifications.info(loc("tokens.applied", { count, feet }));
  }

  static async #onResetFootprints() {
    const count = await resetSelectedFootprints();
    ui.notifications.info(loc("tokens.resetDone", { count }));
  }
}

/** The drawn cell's edge in CANVAS px under the current scene scaling. */
function cellOnCanvas(fit) {
  const o = imageToCanvas({ x: 0, y: 0 });
  const px = imageToCanvas({ x: fit.sizeX, y: 0 });
  const py = imageToCanvas({ x: 0, y: fit.sizeY });
  return (Math.hypot(px.x - o.x, px.y - o.y) + Math.hypot(py.x - o.x, py.y - o.y)) / 2;
}

let instance = null;

/** Open (or focus) the single assistant instance. GM only. */
export function openAssistant() {
  if (!game.user.isGM) return null;
  instance ??= new BattlemapAssistant();
  instance.render(true);
  return instance;
}
