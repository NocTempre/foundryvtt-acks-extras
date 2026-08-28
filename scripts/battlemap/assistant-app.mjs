/* global game, canvas, ui, foundry */
/**
 * The calibration panel: the live fit, the GM's scale decisions and the apply
 * actions. Sampling is the scene controls' job; this is the numbers.
 *
 * A WINDOW, opened on demand and dismissed by its own close control. A panel
 * that is summoned has to be dismissable, and a docked surface is not: it
 * holds its slot in the sidebar whether or not any map is being aligned. A
 * window can be dragged clear of the map, which is the whole of what docking
 * bought.
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

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** The size hotbar's chips, in feet: halves and small multiples of the combat square. */
const HOTBAR_FEET = [FEET_PER_RANK / 2, FEET_PER_RANK, FEET_PER_RANK * 2, FEET_PER_RANK * 3, FEET_PER_RANK * 4, FEET_PER_RANK * 6];

/**
 * The square-size ladder, in feet, offered as chips under BOTH scale fields:
 * the same set of values answers "what is the map's square" and "what should
 * a Foundry square be".
 */
const SQUARE_FEET = [FEET_PER_RANK, FEET_PER_RANK * 2, FEET_PER_RANK * 10, FEET_PER_RANK * 20];

const GRID_PX_MAX = 300;

/** The residual that fills the card's bar — the top of the "loose" band. */
const RMS_FULL_BAR = 0.03;

export default class BattlemapAssistant extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "acks-extras-battlemap",
    classes: ["acks-ui", "acks", "acks2", "acks-extras", "acks-extras-battlemap"],
    tag: "form",
    window: { title: `${LANG_PREFIX}.title`, icon: "fa-solid fa-ruler-combined", resizable: true },
    // Opened clear of the canvas centre and of the right sidebar, and sized so
    // the pinned footer is on screen without a resize.
    position: { width: 420, height: 720, left: 120, top: 70 },
    form: { handler: BattlemapAssistant.#submit, submitOnChange: true, closeOnSubmit: false },
    actions: {
      disarm: BattlemapAssistant.#onDisarm,
      deleteSample: BattlemapAssistant.#onDeleteSample,
      mapChip: BattlemapAssistant.#onMapChip,
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

  /** Unsubscribes this window from the session; held while it is open. */
  #unsubscribe = null;

  /* -------------------------------------------- */
  /*  Derivations                                 */
  /* -------------------------------------------- */

  /**
   * What one drawn map square is worth, in feet.
   *
   * The field and its chips write ONE slot. Never give this quantity a second
   * home: a control that displays it and a control that overrides it disagree
   * the moment either is touched, and the arithmetic silently follows the
   * hidden one.
   */
  get mapCellFeet() {
    if (this.opts.mapCellFeet > 0) return this.opts.mapCellFeet;
    const bar = this.scaleBarFeet;
    if (bar > 0) return bar;
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
      mapChips: this.#mapChips(rawFeet),
      mapCellFeet: this.mapCellFeet,
      outputChips: SQUARE_FEET.map((v) => ({ value: v, active: this.outputFeet === v })),
      armedLabel: this.captureMode ? loc(`mode.${this.captureMode}`) : null,
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

  /**
   * Chips for the map-square field: what a scale bar rounds to when one has
   * been dragged, and the plain ladder otherwise — the commonest case is a GM
   * who already knows the map's squares are 10 ft and has no bar to derive
   * anything from, and an empty chip row taught them nothing.
   */
  #mapChips(rawFeet) {
    const values = rawFeet ? roundSuggestions(rawFeet) : SQUARE_FEET;
    return values.map((v) => ({ value: v, active: this.mapCellFeet === v }));
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
    // follows the session rather than the other way round. The subscription is
    // held only while the window is open — a listener over a closed window
    // would re-open it on the next toolbar press.
    this.#unsubscribe ??= session.subscribe(() => this.render());
  }

  _onClose(options) {
    super._onClose(options);
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    // Nothing is disarmed here. Shutting the panel is not a statement about the
    // canvas — leaving the Battlemap control group is what disarms, and it owns
    // that.
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
      outputFeet: num(d.outputFeet),
      gridSizePx: num(d.gridSizePx),
      customFeet: num(d.customFeet),
    });
    this.render();
  }

  /** The panel's own way out, for a GM reading numbers rather than the toolbar. */
  static #onDisarm() {
    session.requestDisarm();
  }

  static #onDeleteSample(_event, target) {
    const { kind, index } = target.dataset;
    session.deleteSample(kind, index);
  }

  /** A chip is the field, pressed. It writes the same slot the input does. */
  static #onMapChip(_event, target) {
    this.opts.mapCellFeet = Number(target.dataset.value);
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
 * The one open panel, kept so a second press focuses it instead of stacking a
 * duplicate over the first, and so the GM's dragged position survives a close.
 */
let assistant = null;

/** Bring the panel up, creating it the first time. */
export function openAssistant() {
  if (!game.user.isGM) return null;
  assistant ??= new BattlemapAssistant();
  assistant.render({ force: true });
  return assistant;
}
