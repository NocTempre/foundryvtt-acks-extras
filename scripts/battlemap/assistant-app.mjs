/* global game, canvas, ui, foundry */
/**
 * The calibration panel: the live fit, the GM's scale decisions and the apply
 * actions. Sampling is the scene controls' job; this is the numbers.
 *
 * A SIDEBAR TAB rather than a window, because it is read while the eye is on
 * the map and a window sits on top of the very thing being aligned. Foundry
 * gives the windowed form back for free — right-click the tab and
 * `renderPopout` clones this class into a framed application, which the tab's
 * own `render` keeps in step.
 */

import { MODULE_ID, LANG_PREFIX, CALIBRATABLE_GRIDS } from "./constants.mjs";
import { imageToCanvas } from "./capture.mjs";
import { session } from "./session.mjs";
import { feetPerSquare, roundSuggestions, outputGridSize } from "./calibrate-logic.mjs";
import { applyGridCalibration, bakeCorrectedBackground } from "./apply.mjs";
import { rescaleSceneTokens, applyFootprintToSelected, resetSelectedFootprints } from "./token-scale.mjs";
import { backgroundTexture } from "./scene-image.mjs";
import { FEET_PER_RANK } from "../formation/trap-rules.mjs";
import { makeLoc } from "../lib/util.mjs";

const loc = makeLoc(LANG_PREFIX);

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { AbstractSidebarTab } = foundry.applications.sidebar;

/** The sidebar tab id: the key in `Sidebar.TABS`, `CONFIG.ui` and `ui`. */
export const TAB_NAME = "acksBattlemap";

/** The size hotbar's chips, in feet: halves and small multiples of the combat square. */
const HOTBAR_FEET = [FEET_PER_RANK / 2, FEET_PER_RANK, FEET_PER_RANK * 2, FEET_PER_RANK * 3, FEET_PER_RANK * 4, FEET_PER_RANK * 6];

/** Output-square selector chips, in feet. */
const OUTPUT_FEET = [FEET_PER_RANK, FEET_PER_RANK * 2, FEET_PER_RANK * 10, FEET_PER_RANK * 20];

const GRID_PX_MAX = 300;

/** The residual that fills the card's bar — the top of the "loose" band. */
const RMS_FULL_BAR = 0.03;

export default class BattlemapAssistant extends HandlebarsApplicationMixin(AbstractSidebarTab) {
  static tabName = TAB_NAME;

  static DEFAULT_OPTIONS = {
    classes: ["acks-ui", "acks", "acks2", "acks-extras", "acks-extras-battlemap"],
    tag: "form",
    // Carried for the popped-out form; a docked tab draws no frame.
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

  /**
   * Two parts, because a part must render exactly ONE root element and the
   * pinned footer has to be a SIBLING of the scrolling body — the app element
   * is the flex column that holds one down while the other scrolls.
   */
  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/battlemap/assistant-body.hbs` },
    foot: { template: `modules/${MODULE_ID}/templates/battlemap/assistant-foot.hbs` },
  };

  /**
   * The window owns nothing. Samples, the armed mode and the fit belong to the
   * calibration session, because the scene controls arm the modes and closing
   * this panel must not throw the work away. These read through so the rest of
   * the view can stay written against `this`.
   */
  get samples() {
    return session.samples;
  }

  get overlay() {
    return session.overlay;
  }

  get captureMode() {
    return session.mode;
  }

  get opts() {
    return session.opts;
  }

  get independentXY() {
    return session.independentXY;
  }

  get allowSkew() {
    return session.allowSkew;
  }

  get bakedFit() {
    return session.bakedFit;
  }

  set bakedFit(fit) {
    session.bakedFit = fit;
  }

  get fitMode() {
    return session.fitMode;
  }

  get fit() {
    return session.fit;
  }

  /** Unsubscribes this window from the session; set on first render. */
  #unsubscribe = null;

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
    const squareGrid = CALIBRATABLE_GRIDS.has(scene?.grid?.type);
    const willAddGrid = scene?.grid?.type === 0;
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
      // Offered whenever the image is wrong in a way a scene field cannot
      // express straight: crooked, or cells that are not square.
      canBake:
        !!fit?.ok &&
        hasBackground &&
        (Math.abs(fit.skewDeg ?? 0) >= 0.1 ||
          Math.abs(fit.rotationDeg ?? 0) >= 0.1 ||
          Math.abs(fit.sizeX - fit.sizeY) / Math.max(fit.sizeX, fit.sizeY) >= 0.005),
      warnNotSquare: scene && !squareGrid,
      willAddGrid,
      warnNoBackground: scene && !hasBackground,
      warnResidual: !!(fit?.ok && fit.confidence === "loose"),
      hotbar: HOTBAR_FEET.map((v) => ({ value: v, label: `${v}'` })),
      units: scene?.grid?.units || "ft",
      // The card: the fit read at a glance while the eye is on the map.
      cellLabel: fit?.ok ? (Math.abs(fit.sizeX - fit.sizeY) < 0.05 ? fit.sizeX.toFixed(1) : `${fit.sizeX.toFixed(1)} × ${fit.sizeY.toFixed(1)}`) : null,
      residualPct: fit?.ok ? (fit.rmsPct * 100).toFixed(1) : null,
      // Full bar at the loose threshold, so the eye reads "how close to bad".
      residualBar: fit?.ok ? Math.min(100, Math.round((fit.rmsPct / RMS_FULL_BAR) * 100)) : 0,
      confidenceLabel: fit?.ok ? loc(`fit.confidence.${fit.confidence}`) : null,
      sampleSummary: this.#sampleSummary(),
    };
  }

  /** "3 boxes · 2 corners · 1 scale bar", omitting what is not there. */
  #sampleSummary() {
    const s = this.samples;
    const parts = [];
    if (s.squares.length) parts.push(loc("samples.countBoxes", { n: s.squares.length }));
    if (s.corners.length) parts.push(loc("samples.countCorners", { n: s.corners.length }));
    if (s.scale) parts.push(loc("samples.countScale"));
    return parts.join(" · ");
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    // A toolbar press changes the session, not this panel, so the panel
    // follows the session rather than the other way round. Only the DOCKED
    // tab subscribes: its own `render` carries the popout with it, so a
    // second subscription would render that twice per change.
    if (options.isFirstRender && !this.isPopout) {
      this.#unsubscribe ??= session.subscribe(() => this.render());
    }
  }

  _onClose(options) {
    super._onClose(options);
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    // Nothing is disarmed here. A docked tab is never closed, and shutting the
    // popout is not a statement about the canvas — leaving the Battlemap
    // control group is what disarms, and it owns that.
  }

  /* -------------------------------------------- */
  /*  Handlers                                    */
  /* -------------------------------------------- */

  static #submit(_event, _form, formData) {
    const d = foundry.utils.expandObject(formData.object);
    const num = (v) => (Number(v) > 0 ? Number(v) : null);
    session.independentXY = !!d.independentXY;
    session.allowSkew = !!d.allowSkew;
    Object.assign(session.opts, {
      mapCellFeet: num(d.mapCellFeet),
      scaleValue: num(d.scaleValue),
      confirmFeet: num(d.confirmFeet),
      outputFeet: num(d.outputFeet),
      gridSizePx: num(d.gridSizePx),
      customFeet: num(d.customFeet),
    });
    this.render();
  }

  static #onSetMode(_event, target) {
    // The toolbar is the primary way in; these mirror it so the panel alone
    // still works, and both routes land on the same session.
    session.arm(target.dataset.mode);
    ui.controls?.render();
  }

  static #onWipe() {
    session.wipe();
  }

  static #onDeleteSample(_event, target) {
    const { kind, index } = target.dataset;
    session.deleteSample(kind, index);
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
    // The samples described the crooked image and mean nothing against the
    // corrected one; the fit handed back does, and is retained in their place.
    session.wipe();
    session.bakedFit = result.fit;
    session.notify();
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

/**
 * Bring the panel up. The tab instance belongs to `ui`, built once from
 * `CONFIG.ui` at startup, so this only has to select it — `activate` also
 * expands a collapsed sidebar, which a bare `changeTab` would not.
 */
export function openAssistant() {
  if (!game.user.isGM) return null;
  const tab = ui[TAB_NAME] ?? null;
  tab?.activate();
  return tab;
}
