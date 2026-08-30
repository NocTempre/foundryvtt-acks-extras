/* global game, canvas, ui, foundry, console */
/**
 * The map setup panel: what this scene IS, the live fit, the GM's scale
 * decisions and the apply actions. Sampling is the scene controls' job; this
 * is the numbers.
 *
 * A WINDOW, opened on demand and dismissed by its own close control. A panel
 * that is summoned has to be dismissable, and a docked surface is not: it
 * holds its slot in the sidebar whether or not any map is being aligned. A
 * window can be dragged clear of the map, which is the whole of what docking
 * bought.
 *
 * Every number on it is labelled with what it MEANS and in which units. The
 * two scale decisions read alike and are not alike — one describes the map,
 * the other commands the grid — so neither is ever shown as a bare figure.
 */

import { MODULE_ID, LANG_PREFIX, CALIBRATABLE_GRIDS, GRID_FAMILIES, GRID_TYPE, TRAVEL_MODES } from "./constants.mjs";
import { imageToCanvas } from "./capture.mjs";
import { session } from "./session.mjs";
import { boxCells, feetPerSquare, hexSizeFromBox, pixelsPerUnit, roundSuggestions, outputGridSize, scaleOnlyGrid } from "./calibrate-logic.mjs";
import { applyGridCalibration, applyHexCalibration, applyScaleOnly, bakeCorrectedBackground } from "./apply.mjs";
import { hexProbe, sceneSetup, writeSceneSetup } from "./scene-setup.mjs";
import { rescaleSceneTokens, applyFootprintToSelected, resetSelectedFootprints } from "./token-scale.mjs";
import { backgroundTexture } from "./scene-image.mjs";
import { DISTANCE_UNITS } from "../lib/distance-units.mjs";
import { FEET_PER_RANK } from "../formation/trap-rules.mjs";
import { makeLoc } from "../lib/util.mjs";

const loc = makeLoc(LANG_PREFIX);

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** The size hotbar's chips, in feet: halves and small multiples of the combat square. */
const HOTBAR_FEET = [FEET_PER_RANK / 2, FEET_PER_RANK, FEET_PER_RANK * 2, FEET_PER_RANK * 3, FEET_PER_RANK * 4, FEET_PER_RANK * 6];

/**
 * The square-size ladder offered as chips under BOTH scale fields: the same
 * set of values answers "what is the map's square" and "what should a Foundry
 * square be". Multiples of the combat square, which is structure — nothing
 * read off a page belongs in a chip.
 */
const SQUARE_FEET = [FEET_PER_RANK, FEET_PER_RANK * 2, FEET_PER_RANK * 10, FEET_PER_RANK * 20];

const GRID_PX_MAX = 300;

/**
 * The on-screen cell a scale-only calibration aims for. A map with no drawn
 * grid has no cell to inherit, so the ruler needs a size chosen for it — and
 * a default of the combat square on a map measured in miles lands under
 * Foundry's floor, which reads as the tool refusing the scale it just took.
 */
const COMFORTABLE_PX = 100;

/** The residual that fills the card's bar — the top of the "loose" band. */
const RMS_FULL_BAR = 0.03;

/** Foundry's own floor for `grid.size`, with a fallback for a bare context. */
const gridMinPx = () => globalThis.CONST?.GRID_MIN_SIZE ?? 50;

export default class BattlemapAssistant extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "acks-extras-battlemap",
    classes: ["acks-ui", "acks", "acks2", "acks-extras", "acks-extras-battlemap"],
    tag: "form",
    window: { title: `${LANG_PREFIX}.title`, icon: "fa-solid fa-ruler-combined", resizable: true },
    // Opened clear of the canvas centre and of the right sidebar, and sized so
    // the pinned footer is on screen without a resize.
    position: { width: 440, height: 760, left: 120, top: 70 },
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
   * The window owns nothing. Samples, the armed mode, the setup choices and
   * the fit belong to the calibration session, because the scene controls arm
   * the modes and closing this panel must not throw the work away. These read
   * through so the rest of the view can stay written against `this`.
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

  /** What the apply will write — square, one of the two hex families, or scale only. */
  get family() {
    return session.gridFamily;
  }

  get isHex() {
    return session.isHexFamily;
  }

  get isScaleOnly() {
    return session.gridFamily === "scale";
  }

  /** Unsubscribes this window from the session; held while it is open. */
  #unsubscribe = null;

  /* -------------------------------------------- */
  /*  Derivations                                 */
  /* -------------------------------------------- */

  /**
   * What one drawn map cell is worth, in the scene's distance units.
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

  /**
   * What one OUTPUT cell is worth. A hex family has no output decision of its
   * own: one drawn hex is one Foundry hex, because a grid re-pitched to a
   * fraction of a cell is a square-grid idea and hexes do not tile hexes.
   */
  get outputFeet() {
    if (this.isHex) return this.mapCellFeet;
    if (this.opts.outputFeet > 0) return this.opts.outputFeet;
    if (this.isScaleOnly && !(this.opts.mapCellFeet > 0)) return this.comfortableCell ?? this.mapCellFeet;
    return this.mapCellFeet;
  }

  /**
   * A ruler cell worth a comfortable number of pixels, rounded to a number a
   * Judge would have chosen. Offered only where the measurement came from a
   * BAR: a map with drawn cells already says what a cell is worth, and
   * overriding that with a screen-size preference would answer a question the
   * map had answered.
   */
  get comfortableCell() {
    const per = this.barPxPerUnit;
    if (!(per > 0)) return null;
    const raw = COMFORTABLE_PX / per;
    const options = roundSuggestions(raw);
    if (!options.length) return null;
    return options.reduce((best, v) => (Math.abs(v - raw) < Math.abs(best - raw) ? v : best));
  }

  /** Canvas px per one distance unit, measured off the dragged bar alone. */
  get barPxPerUnit() {
    const seg = this.samples.scale;
    if (!seg || !(this.opts.scaleValue > 0)) return null;
    const d = canvasDelta(seg.x2 - seg.x1, seg.y2 - seg.y1);
    return pixelsPerUnit({ dx: d.x, dy: d.y, value: this.opts.scaleValue });
  }

  /**
   * Canvas px per one distance unit — the whole of a scale-only calibration.
   * The dragged bar answers it directly; a map with drawn cells and no bar
   * answers it through the fit instead, so "record the scale, add no grid"
   * works on a gridded map too.
   */
  get pxPerUnit() {
    const bar = this.barPxPerUnit;
    if (bar > 0) return bar;
    const fit = this.fit;
    if (fit?.ok && this.mapCellFeet > 0) {
      const cell = cellOnCanvas(fit);
      if (cell > 0) return cell / this.mapCellFeet;
    }
    return null;
  }

  /**
   * The (size, distance) pair a scale-only apply would write. Whichever of the
   * two the GM pins, the other solves — they are one ratio, and a ratio the
   * ruler reads correctly is the whole product.
   */
  get scaleSolution() {
    const pxPerUnit = this.pxPerUnit;
    if (!(pxPerUnit > 0)) return null;
    if (this.opts.gridSizePx > 0) {
      const size = Math.round(this.opts.gridSizePx);
      return { size, distance: size / pxPerUnit, clamped: false, pinned: true };
    }
    return scaleOnlyGrid({ pxPerUnit, distance: this.outputFeet, minSize: gridMinPx(), maxSize: GRID_PX_MAX });
  }

  /**
   * The drawn hex whose centre places the grid: the first box sampled around
   * ONE hex. A box spanning several is a fine measurement and a useless
   * anchor — its centre lands on a vertex as readily as on a centre.
   */
  get hexCentre() {
    const box = this.samples.squares.find((r) => boxCells(r) === 1);
    return box ? { x: box.x + box.w / 2, y: box.y + box.h / 2 } : null;
  }

  /** Default grid px: keep the drawn cell's current on-canvas size. */
  get gridSizePx() {
    if (this.opts.gridSizePx > 0) return Math.round(this.opts.gridSizePx);
    const fit = this.fit;
    if (!fit?.ok) return null;
    const bounded = (px) => Math.round(Math.min(GRID_PX_MAX, Math.max(gridMinPx(), px)));
    if (this.isHex) {
      const probe = hexProbe(canvas?.scene, this.family, session.hexEven);
      if (!probe) return null;
      const box = canvasSpan(fit.sizeX, fit.sizeY);
      const size = hexSizeFromBox({ boxW: box.w, boxH: box.h, ...probe });
      return size ? bounded(size) : null;
    }
    const out = outputGridSize({ fittedCellPx: cellOnCanvas(fit), mapCellFeet: this.mapCellFeet, outputFeet: this.outputFeet });
    return out ? bounded(out.px) : null;
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
    const gridless = scene?.grid?.type === GRID_TYPE.GRIDLESS;
    const hasBackground = !!backgroundTexture(scene);
    const dropBack = !!(fit?.ok && fit.u && Math.abs(fit.skewDeg) < 0.5 && Math.abs(fit.rotationDeg) < 0.5);
    const scale = this.isScaleOnly ? this.scaleSolution : null;
    // Outside scale-only the fit fallback is not a MEASUREMENT — on a hex map
    // it averages a hex's two unequal edges — so only a real bar is reported.
    const pxPerUnit = this.isScaleOnly ? this.pxPerUnit : this.barPxPerUnit;
    const units = session.units;
    // The unit SHOWN is the literal that will be written to `grid.units`, read
    // from the same table the apply writes from — a second, localized copy of
    // it would let the label and the field disagree.
    const unitLabel = units ? DISTANCE_UNITS[units].abbr : scene?.grid?.units || "";

    return {
      scene,
      // What this scene is being set up AS. Everything below reads differently
      // under each answer, so it leads the panel.
      family: this.family,
      isHex: this.isHex,
      isScaleOnly: this.isScaleOnly,
      isSquare: this.family === "square",
      hexEven: session.hexEven,
      familyOptions: GRID_FAMILIES.map((key) => ({ key, label: loc(`family.${key}`), selected: key === this.family })),
      unitOptions: Object.keys(DISTANCE_UNITS).map((key) => ({ key, label: loc(`units.${key}.label`), selected: key === units })),
      systemOptions: TRAVEL_MODES.map((key) => ({ key, label: loc(`system.${key}`), selected: key === session.mapSystem })),
      unitLabel,
      // Labels and hints are resolved HERE, not composed in the template: a
      // key built from an interpolation in Handlebars is a key no check can
      // read, and a missing one then fails silently at the user.
      familyHint: loc(`setup.familyHint.${this.family}`),
      cellUnitLabel: loc(this.isHex ? "fit.pxHex" : "fit.pxCell"),
      noFitLabel: loc(this.isScaleOnly ? "fit.noneScale" : "fit.none"),
      mapCellLabel: loc(this.isHex ? "fields.mapCellHex" : "fields.mapCellFeet"),
      mapCellHint: loc(this.isHex ? "fields.mapCellHexHint" : "fields.mapCellFeetHint"),
      gridPxLabel: loc(this.isScaleOnly ? "scale.gridPxRuler" : this.isHex ? "scale.gridPxHex" : "scale.gridPx"),
      gridPxHint: loc(this.isScaleOnly ? "scale.gridPxHintScale" : "scale.gridPxHint"),
      independentXY: this.independentXY,
      allowSkew: this.allowSkew,
      opts: this.opts,
      // Each sample carries the box that says what it REPRESENTS: how many
      // cells a drag spans, what a scale bar reads. Stating it on the row is
      // what keeps a measurement and its meaning together.
      boxRows: this.samples.squares.map((r, i) => ({
        index: i,
        cells: boxCells(r),
        label: loc("samples.square", { n: i + 1, w: Math.round(r.w), h: Math.round(r.h) }),
      })),
      cornerRows: this.samples.corners.map((c, i) => ({
        index: i,
        label: loc("samples.corner", { n: i + 1, x: Math.round(c.x), y: Math.round(c.y) }),
      })),
      scaleRow: this.samples.scale
        ? { label: loc("samples.scale", { px: Math.round(Math.hypot(this.samples.scale.x2 - this.samples.scale.x1, this.samples.scale.y2 - this.samples.scale.y1)) }) }
        : null,
      fit,
      fitOk: !!fit?.ok,
      fitAffine: fit?.ok && fit.u ? { skew: fit.skewDeg.toFixed(2), rotation: fit.rotationDeg.toFixed(2) } : null,
      dropBack,
      rawFeet: rawFeet ? Number(rawFeet.toFixed(2)) : null,
      barFeet: barFeet ? Number(barFeet.toFixed(2)) : null,
      mapChips: this.#mapChips(rawFeet),
      mapCellFeet: this.mapCellFeet,
      outputChips: this.#outputChips(),
      armedLabel: this.captureMode ? loc(`mode.${this.captureMode}`) : null,
      armedHint: this.captureMode ? loc(`modeHint.${this.captureMode}`) : null,
      outputFeet: this.outputFeet,
      gridSizePx: this.isScaleOnly ? (scale?.size ?? null) : this.gridSizePx,
      // The scale-only readout: the ratio being written, stated both ways.
      pxPerUnit: pxPerUnit ? Number(pxPerUnit.toFixed(3)) : null,
      scaleDistance: scale ? Number(scale.distance.toFixed(3)) : null,
      scaleClamped: !!scale?.clamped,
      scalePinned: !!scale?.pinned,
      notAligned: this.family === "square" && !aligned,
      canApply: this.#canApply({ fit, squareGrid, hasBackground, scale }),
      applyLabel: loc(`apply.${this.isScaleOnly ? "scale" : this.isHex ? "hex" : "grid"}`),
      // Offered whenever the image is wrong in a way a scene field cannot
      // express straight: crooked, or cells that are not square.
      canBake:
        !this.isScaleOnly &&
        !!fit?.ok &&
        hasBackground &&
        (Math.abs(fit.skewDeg ?? 0) >= 0.1 ||
          Math.abs(fit.rotationDeg ?? 0) >= 0.1 ||
          (!this.isHex && Math.abs(fit.sizeX - fit.sizeY) / Math.max(fit.sizeX, fit.sizeY) >= 0.005)),
      warnNotSquare: scene && this.family === "square" && !squareGrid,
      warnNoHexBox: this.isHex && !!fit?.ok && !this.hexCentre,
      warnRepitch: this.isScaleOnly && !gridless && !!scale && scale.size !== scene?.grid?.size,
      willAddGrid: gridless && !this.isScaleOnly,
      // Named for the grid the family will actually write: a hex apply
      // promising a square one is the footer describing a different button.
      willAddGridLabel: loc(this.isHex ? "apply.willAddGridHex" : "apply.willAddGrid"),
      keepsGridless: gridless && this.isScaleOnly,
      warnNoBackground: scene && !hasBackground && !this.isScaleOnly,
      warnResidual: !!(fit?.ok && fit.confidence === "loose"),
      hotbar: HOTBAR_FEET.map((v) => ({ value: v, label: `${v}'` })),
      // The card: the fit read at a glance while the eye is on the map.
      cellLabel: fit?.ok ? (Math.abs(fit.sizeX - fit.sizeY) < 0.05 ? fit.sizeX.toFixed(1) : `${fit.sizeX.toFixed(1)} × ${fit.sizeY.toFixed(1)}`) : null,
      residualPct: fit?.ok ? (fit.rmsPct * 100).toFixed(1) : null,
      // Full bar at the loose threshold, so the eye reads "how close to bad".
      residualBar: fit?.ok ? Math.min(100, Math.round((fit.rmsPct / RMS_FULL_BAR) * 100)) : 0,
      confidenceLabel: fit?.ok ? loc(`fit.confidence.${fit.confidence}`) : null,
      // The prompt for a measurement, only while there is none. A bar that has
      // been measured and a line saying none has is the panel contradicting
      // itself in adjacent rows.
      showNoMeasurement: !fit?.ok && !pxPerUnit,
      sampleSummary: this.#sampleSummary(),
    };
  }

  /** What each family needs before its apply can run. */
  #canApply({ fit, squareGrid, hasBackground, scale }) {
    if (this.isScaleOnly) return !!scale;
    if (!fit?.ok || !hasBackground) return false;
    if (this.isHex) return !!this.hexCentre && !!this.gridSizePx;
    return squareGrid;
  }

  /**
   * Chips for the map-cell field: what a scale bar rounds to when one has been
   * dragged, and the plain ladder otherwise — the commonest case is a GM who
   * already knows the map's squares are 10 ft and has no bar to derive
   * anything from, and an empty chip row taught them nothing. A hex map's
   * cells are worth whatever its own key says, so it gets suggestions only
   * when a bar has been measured.
   */
  /**
   * Chips for the output field. Scale-only offers the neighbours of the cell
   * it would choose by itself, because the plain ladder is a set of combat
   * distances and the map being scaled may be a county.
   */
  #outputChips() {
    const comfortable = this.isScaleOnly ? this.comfortableCell : null;
    const values = comfortable ? roundSuggestions(comfortable) : SQUARE_FEET;
    return values.map((v) => ({ value: v, active: this.outputFeet === v }));
  }

  #mapChips(rawFeet) {
    if (!rawFeet && this.isHex) return [];
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
    // A field the current family does not SHOW posts nothing, and an absent
    // field is not an emptied one: assigning over it would wipe the hex value
    // a GM typed the moment they glanced at another family and came back.
    const present = (key) => Object.hasOwn(d, key);
    if (present("independentXY")) session.independentXY = !!d.independentXY;
    if (present("allowSkew")) session.allowSkew = !!d.allowSkew;
    for (const [index, cells] of Object.entries(d.boxCells ?? {})) session.setBoxCells(index, Number(cells));
    for (const slot of ["mapCellFeet", "scaleValue", "outputFeet", "gridSizePx", "customFeet"]) {
      if (present(slot)) session.opts[slot] = num(d[slot]);
    }
    session.setSetup({ gridFamily: d.gridFamily, hexEven: d.hexEven, units: d.units, mapSystem: d.mapSystem });
    // The declared system is a statement ABOUT THE SCENE, not part of the
    // calibration arithmetic, so it lands the moment it is chosen — a Judge
    // labelling an already-aligned map should not have to re-apply a grid.
    BattlemapAssistant.#writeSystem(d.mapSystem || null);
    this.render();
  }

  /** Persist the scene's declared travel system, if it changed. */
  static #writeSystem(mapSystem) {
    const scene = canvas?.scene;
    if (!scene || !game.user.isGM) return;
    const current = sceneSetup(scene).mapSystem;
    if (current === mapSystem) return;
    writeSceneSetup(scene, { mapSystem }).catch((err) => console.error(`${MODULE_ID} | scene system write failed`, err));
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

  /** One button, three applies — the family chose which before it was pressed. */
  static async #onApplyGrid() {
    const scene = canvas?.scene;
    if (!scene) return;
    const common = { units: session.units, mapSystem: session.mapSystem };
    let applied = false;
    if (this.isScaleOnly) {
      const scale = this.scaleSolution;
      if (!scale) return;
      applied = await applyScaleOnly(scene, { ...scale, ...common });
    } else {
      const fit = this.fit;
      if (!fit?.ok) return;
      applied = this.isHex
        ? await applyHexCalibration(scene, fit, {
            ...common,
            gridSize: this.gridSizePx,
            outputFeet: this.outputFeet,
            hexCentre: this.hexCentre,
            family: this.family,
            hexEven: session.hexEven,
          })
        : await applyGridCalibration(scene, fit, {
            ...common,
            gridSize: this.gridSizePx,
            outputFeet: this.outputFeet,
            mapCellFeet: this.mapCellFeet,
          });
    }
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

/** An image-space vector, as a CANVAS-space one under the current scaling. */
function canvasDelta(dx, dy) {
  const o = imageToCanvas({ x: 0, y: 0 });
  const p = imageToCanvas({ x: dx, y: dy });
  return { x: p.x - o.x, y: p.y - o.y };
}

/** An image-space cell's two edges, in CANVAS px. */
function canvasSpan(sizeX, sizeY) {
  const w = Math.abs(canvasDelta(sizeX, 0).x);
  const h = Math.abs(canvasDelta(0, sizeY).y);
  return { w, h };
}

/** The drawn cell's edge in CANVAS px under the current scene scaling. */
function cellOnCanvas(fit) {
  const { w, h } = canvasSpan(fit.sizeX, fit.sizeY);
  return (w + h) / 2;
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
