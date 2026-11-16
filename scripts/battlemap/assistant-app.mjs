/* global game, canvas, ui, foundry, console */
/**
 * The map setup panel: what this scene IS, the live fit, the GM's scale
 * decisions and the apply actions. Sampling is the scene controls' job;
 * this is the numbers. A WINDOW, dismissed by its own close control. Every
 * number on it is labelled with what it MEANS and in which units — the two
 * scale decisions read alike and are not alike (one describes the map, the
 * other commands the grid).
 *
 * See docs/battlemap/DECISIONS.md, "The panel is a window again, dismissed
 * by the toolbar."
 */

import { MODULE_ID, LANG_PREFIX, GRID_FAMILIES, GRID_TYPE, TRAVEL_MODES } from "./constants.mjs";
import { imageToCanvas } from "./capture.mjs";
import { session } from "./session.mjs";
import { FAIR_PX, boxCells, feetPerSquare, hexSizeFromBox, pixelsPerUnit, roundSuggestions, outputGridSize, scaleOnlyGrid, unitsPerCentreSpacing } from "./calibrate-logic.mjs";
import { bakeCorrectedBackground, solveGridCalibration, solveHexCalibration, solveScaleOnly, writeSetup } from "./apply.mjs";
import { expeditionScaleOf, planSetup, resolveCellWorth } from "./setup-plan.mjs";
import { sceneCountry, sceneSetup, writeSceneSetup, writeSceneSystem } from "./scene-setup.mjs";
import { rescaleSceneTokens, applyFootprintToSelected, resetSelectedFootprints } from "./token-scale.mjs";
import { backgroundTexture } from "./scene-image.mjs";
import { climateLabelFor, layerLabelFor, paintableValues } from "./terrain-paint.mjs";
import { DISTANCE_UNITS, sceneFeetPerCell } from "../lib/distance-units.mjs";
import { CLIMATES } from "../formation/weather.mjs";
import { makeLoc } from "../lib/util.mjs";

const loc = makeLoc(LANG_PREFIX);

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** The size hotbar's steps: a half and small multiples of the scene's own cell. */
const HOTBAR_STEPS = [0.5, 1, 2, 3, 4, 6];

/** The square-size ladder's steps: multiples of the scene's grid distance. */
const SQUARE_STEPS = [1, 2, 10, 20];

/**
 * The size hotbar's chips, in feet, for a scene: steps of what one of its
 * cells is worth. A scene with no usable distance offers none. Nothing read
 * off a page belongs in a chip.
 */
const hotbarFeet = (scene) => {
  const cell = sceneFeetPerCell(scene);
  return cell > 0 ? HOTBAR_STEPS.map((step) => cell * step) : [];
};

/**
 * The square-size ladder offered as chips under BOTH scale fields: the same
 * set of values answers "what is the map's square" and "what should a Foundry
 * square be". Steps of the scene's grid distance, in its own units; a scene
 * with no usable distance offers none.
 */
const squareFeet = (scene) => {
  const distance = scene?.grid?.distance;
  return distance > 0 ? SQUARE_STEPS.map((step) => distance * step) : [];
};

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

/** The map setup panel window. */
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

  /**
   * The scene default country just chosen and not yet written back: the
   * selects show it until the scene's own update lands, so a render in
   * between does not spring them back to the old values.
   */
  #countryDraft = null;

  /**
   * The plan and the solve this window last rendered, `{ sceneId, family, plan,
   * solved }`. The Apply handler writes THIS solve, so what it writes is what
   * the rows and the verdict were built from.
   */
  #shown = null;

  /* -------------------------------------------- */
  /*  Derivations                                */
  /* -------------------------------------------- */

  /**
   * What one drawn map cell is worth, in the unit the apply will write, or
   * null while nothing says. The field and its chips write ONE slot — never a
   * second home for this quantity. An entry wins, then a measured scale bar,
   * then the scene's own distance only while the unit is the scene's own
   * (`resolveCellWorth`): a number read in another unit is not a default.
   * See docs/battlemap/DECISIONS.md, "One entered value, one slot."
   */
  get mapCellFeet() {
    const grid = canvas?.scene?.grid;
    return resolveCellWorth({
      entered: this.opts.mapCellFeet,
      fromBar: this.scaleBarFeet,
      units: session.units,
      scene: { distance: grid?.distance, units: grid?.units },
    });
  }

  /**
   * What a dragged scale bar says one cell is worth, in the bar's own unit: a
   * square cell by its box sides, a hex by the step between hex centres.
   */
  get scaleBarFeet() {
    const fit = this.fit;
    const seg = this.samples.scale;
    if (!fit?.ok || !seg || !(this.opts.scaleValue > 0)) return null;
    const dx = seg.x2 - seg.x1;
    const dy = seg.y2 - seg.y1;
    if (this.isHex) return unitsPerCentreSpacing({ dx, dy, value: this.opts.scaleValue, k: fit.k, basis: session.hexProbe?.basis });
    return feetPerSquare({ dx, dy, value: this.opts.scaleValue, sizeX: fit.sizeX, sizeY: fit.sizeY });
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
   * BAR — a map with drawn cells has already answered what a cell is worth.
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

  /** Default grid px: keep the drawn cell's current on-canvas size. */
  get gridSizePx() {
    if (this.opts.gridSizePx > 0) return Math.round(this.opts.gridSizePx);
    const fit = this.fit;
    if (!fit?.ok) return null;
    const bounded = (px) => Math.round(Math.min(GRID_PX_MAX, Math.max(gridMinPx(), px)));
    if (this.isHex) {
      // The fit's box is ONE hex's, fitted over every box drawn around one.
      const probe = session.hexProbe;
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
    const aligned = fit?.ok ? outputGridSize({ fittedCellPx: 1, mapCellFeet: this.mapCellFeet, outputFeet: this.outputFeet })?.aligned ?? true : true;
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

    // ONE solve per render: the planner reads it for its rows and its verdict,
    // and the Apply handler writes this same answer.
    const solved = this.#solve(fit, scale);
    const plan = this.#plan({ fit, scene, hasBackground, solved });
    const footRows = this.#rowViews(plan);
    // The confirmation reads the very lines the footer showed.
    this.#shown = {
      sceneId: scene?.id ?? null,
      family: this.family,
      plan,
      solved: solved?.ok ? solved : null,
      lines: footRows.map((r) => loc("rows.line", { label: r.label, text: r.text })),
    };
    const hexFit = this.isHex && !!fit?.ok;
    const worstLine = this.#warningLines(plan);
    const applyLabel = loc(`apply.${this.isScaleOnly ? "scale" : this.isHex ? "hex" : "grid"}`);
    const applyTip = this.isScaleOnly ? loc("apply.tipScale") : loc("apply.tip");
    const rescaleTip = loc("apply.tokensTip");

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
      countryRows: scene ? this.#countryRows(scene) : [],
      countryNone: loc("setup.countryNone"),
      unitLabel,
      // Labels and hints are resolved HERE, not composed in the template: a
      // key built from an interpolation in Handlebars is a key no check can
      // read, and a missing one then fails silently at the user.
      familyHint: loc(`setup.familyHint.${this.family}`),
      // One line per gap Apply is waiting on, one per sample it leaves out.
      needLines: this.#needLines(plan),
      unusedLines: this.#unusedLines(plan),
      warnLines: worstLine,
      // Apply is also off where the scene already matches what it would write;
      // the line states the setup the scene holds, read from the scene itself.
      matchesLine: plan.matches ? this.#matchesLine(scene) : null,
      // A map cell's worth has a field on every family but scale-only, where
      // one is asked for only when a drawn grid is to measure it.
      showMapCell: !this.isScaleOnly || !!fit?.ok,
      cellUnitLabel: loc(this.isHex ? "fit.pxHex" : "fit.pxCell"),
      mapCellLabel: loc(this.isHex ? "fields.mapCellHex" : "fields.mapCellFeet"),
      mapCellHint: loc(this.isHex ? "fields.mapCellHexHint" : "fields.mapCellFeetHint"),
      gridPxLabel: loc(this.isScaleOnly ? "scale.gridPxRuler" : this.isHex ? "scale.gridPxHex" : "scale.gridPx"),
      gridPxHint: loc(this.isScaleOnly ? "scale.gridPxHintScale" : "scale.gridPxHint"),
      independentXY: this.independentXY,
      allowSkew: this.allowSkew,
      opts: this.opts,
      // Each sample carries the box that says what it REPRESENTS — how many
      // cells a drag spans, what a scale bar reads.
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
      mapCellFeet: this.mapCellFeet > 0 ? Number(this.mapCellFeet.toFixed(2)) : this.mapCellFeet,
      outputChips: this.#outputChips(),
      armedLabel: this.captureMode ? loc(`mode.${this.captureMode}`) : null,
      armedHint: this.captureMode ? loc(this.isHex && this.captureMode === "square" ? "modeHint.squareHex" : `modeHint.${this.captureMode}`) : null,
      outputFeet: this.outputFeet,
      gridSizePx: this.isScaleOnly ? (scale?.size ?? null) : this.gridSizePx,
      // The scale-only readout: the ratio being written, stated both ways.
      pxPerUnit: pxPerUnit ? Number(pxPerUnit.toFixed(3)) : null,
      scaleDistance: scale ? Number(scale.distance.toFixed(3)) : null,
      scaleClamped: !!scale?.clamped,
      scalePinned: !!scale?.pinned,
      notAligned: this.family === "square" && !aligned,
      // The planner's verdict: it is also what disables the button, so the
      // lines above say why whenever it is off.
      canApply: plan.canApply,
      applyLabel,
      // The button and the whole-scene resize each say what a press writes: a
      // name for assistive technology and a tooltip for the pointer.
      applyTip,
      applyAria: loc("apply.aria", { label: applyLabel, tip: applyTip }),
      rescaleTip,
      rescaleAria: loc("apply.aria", { label: loc("apply.tokens"), tip: rescaleTip }),
      // What Apply rewrites, one row per change: empty until something is solvable.
      rowsHeading: loc("rows.heading"),
      footRows,
      // Offered whenever the image is wrong in a way a scene field cannot
      // express straight: crooked, or cells that are not square. A hex fit
      // has no skew or axis pair to straighten.
      canBake:
        !this.isScaleOnly &&
        !this.isHex &&
        !!fit?.ok &&
        hasBackground &&
        (Math.abs(fit.skewDeg ?? 0) >= 0.1 ||
          Math.abs(fit.rotationDeg ?? 0) >= 0.1 ||
          Math.abs(fit.sizeX - fit.sizeY) / Math.max(fit.sizeX, fit.sizeY) >= 0.005),
      warnRepitch: this.isScaleOnly && !gridless && !!scale && scale.size !== scene?.grid?.size,
      willAddGrid: gridless && !this.isScaleOnly,
      // Named for the grid the family will actually write: a hex apply
      // promising a square one is the footer describing a different button.
      willAddGridLabel: loc(this.isHex ? "apply.willAddGridHex" : "apply.willAddGrid"),
      keepsGridless: gridless && this.isScaleOnly,
      hotbar: hotbarFeet(scene).map((v) => ({ value: v, label: `${v}'` })),
      // The card: the fit read at a glance while the eye is on the map.
      cellLabel: fit?.ok ? (Math.abs(fit.sizeX - fit.sizeY) < 0.05 ? fit.sizeX.toFixed(1) : `${fit.sizeX.toFixed(1)} × ${fit.sizeY.toFixed(1)}`) : null,
      // The band is decided on the fit's own residual: a hex fit's is the
      // boxes' edges in image px, a square fit's the share of a cell. With one
      // hex box a hex fit has no residual and shows its confidence alone.
      residualText: fit?.ok ? this.#residualText(fit) : null,
      // Full bar at the loose threshold, so the eye reads "how close to bad".
      residualBar: fit?.ok ? this.#residualBar(fit) : 0,
      hexFit,
      confidenceLabel: fit?.ok ? loc(`fit.confidence.${fit.confidence}`) : null,
      // Empty until there is a fit or a measured bar to show; the lines under
      // it say what is missing, once.
      showCard: !!fit?.ok || !!pxPerUnit,
      sampleSummary: this.#sampleSummary(),
    };
  }

  /**
   * The solve the planner's rows and the Apply handler share, or null while an
   * input is missing. A refused solve answers `{ ok: false, reason }`; the
   * planner words the gap, so nothing here speaks.
   */
  #solve(fit, scale) {
    const scene = canvas?.scene;
    if (!scene) return null;
    const common = { units: session.units, mapSystem: session.mapSystem };
    if (this.isScaleOnly) return scale ? solveScaleOnly({ size: scale.size, distance: scale.distance, ...common }) : null;
    if (!fit?.ok) return null;
    const gridSize = this.gridSizePx;
    const outputFeet = this.outputFeet;
    if (!(gridSize > 0) || !(outputFeet > 0)) return null;
    if (this.isHex) {
      return solveHexCalibration(scene, fit, { ...common, gridSize, outputFeet, family: this.family, hexEven: session.hexEven, probe: session.hexProbe });
    }
    if (!(this.mapCellFeet > 0)) return null;
    return solveGridCalibration(scene, fit, { ...common, gridSize, outputFeet, mapCellFeet: this.mapCellFeet });
  }

  /** The planner's answer over this render's samples, fit, scene and solve. */
  #plan({ fit, scene, hasBackground, solved }) {
    const grid = scene?.grid;
    const record = sceneSetup(scene);
    const solution = solved?.ok ? solved.solution : null;
    return planSetup({
      family: this.family,
      samples: {
        boxes: this.samples.squares.length,
        corners: this.samples.corners.length,
        bar: !!this.samples.scale,
        barValue: this.opts.scaleValue > 0,
      },
      fit: fit ?? null,
      cellWorth: this.mapCellFeet,
      scene: {
        gridType: grid?.type,
        gridSize: grid?.size,
        distance: grid?.distance,
        units: grid?.units,
        width: scene?.width,
        height: scene?.height,
        shiftX: scene?.shiftX,
        shiftY: scene?.shiftY,
        autoScale: record.autoScale,
        mapSystem: record.mapSystem,
        hasBackground,
      },
      solution,
      expeditionScale: expeditionScaleOf({ distance: solution?.distance, units: session.units, scene: { distance: grid?.distance, units: grid?.units } }),
    });
  }

  /**
   * The statement that the scene already holds what Apply would write: its grid
   * kind, grid size in px and what a cell is worth, each read off the scene.
   */
  #matchesLine(scene) {
    const grid = scene?.grid;
    return loc("apply.matches", {
      grid: loc(`rows.type.${grid?.type ?? GRID_TYPE.GRIDLESS}`),
      size: Math.round(grid?.size ?? 0),
      distance: Number((grid?.distance ?? 0).toFixed(3)),
      units: grid?.units ?? "",
    });
  }

  /**
   * The footer's rows, one per change the planner says Apply writes: a label,
   * the before-to-after figure with its units, a tooltip naming both ends and
   * where the after comes from, and an optional visible note. The same label
   * and text become the confirmation's lines.
   */
  #rowViews(plan) {
    const px = (n) => (Number.isFinite(n) ? Math.round(n) : "–");
    const num = (n) => (Number.isFinite(n) ? Number(n.toFixed(3)) : "–");
    const gridFigure = ({ type, size }) => loc("rows.gridFigure", { type: loc(`rows.type.${type ?? GRID_TYPE.GRIDLESS}`), size: px(size) });
    const worthFigure = ({ distance, units }) => loc("rows.worthFigure", { distance: num(distance), units });
    const imageNow = (i) => loc("rows.imageNow", { width: px(i.width), height: px(i.height), shiftX: px(i.shiftX), shiftY: px(i.shiftY) });
    const onOff = (on) => loc(on ? "rows.on" : "rows.off");
    const system = (id) => (id ? loc(`system.${id}`) : loc("setup.systemNone"));
    const change = (from, to) => loc("rows.change", { from, to });
    const tip = (from, to, source) => loc("rows.tip", { from, to, source });

    const view = {
      grid: (r) => {
        const from = gridFigure(r.before);
        const to = gridFigure(r.after);
        return { text: change(from, to), tip: tip(from, to, this.isScaleOnly ? loc("rows.source.ruler") : loc("rows.source.sizeFit")) };
      },
      cellWorth: (r) => {
        const from = worthFigure(r.before);
        const to = worthFigure(r.after);
        return { text: change(from, to), tip: tip(from, to, this.isScaleOnly ? loc("rows.source.ruler") : loc("rows.source.worth")) };
      },
      image: (r) => ({
        text: loc("rows.imageFigure", { x: num(r.rescale?.x), y: num(r.rescale?.y), shiftX: px(r.after.shiftX), shiftY: px(r.after.shiftY) }),
        tip: tip(imageNow(r.before), imageNow(r.after), loc("rows.source.fit")),
        note: loc("rows.imageStays"),
      }),
      tokenSizing: (r) => {
        const from = onOff(r.before);
        const to = onOff(r.after);
        return {
          text: r.because === "expeditionScale" ? loc("rows.tokenSizingExpedition", { from }) : change(from, to),
          tip: tip(from, to, loc("rows.source.scale")),
        };
      },
      travelSystem: (r) => {
        const from = system(r.before);
        const to = system(r.after);
        return { text: change(from, to), tip: tip(from, to, loc("rows.source.system")) };
      },
    };
    return plan.rows
      .filter((r) => view[r.id])
      .map((r) => ({ id: r.id, label: loc(`rows.label.${r.id}`), note: null, ...view[r.id](r) }));
  }

  /** The fit card's residual: pixels off on a hex fit (none for one box), a share of a cell otherwise. */
  #residualText(fit) {
    if (!this.isHex) return `${(fit.rmsPct * 100).toFixed(1)}%`;
    return fit.rmsPx == null ? null : loc("fit.pxOff", { px: fit.rmsPx.toFixed(1) });
  }

  /** The card's bar, full where the band turns from fair to loose. */
  #residualBar(fit) {
    const share = this.isHex ? (fit.rmsPx == null ? 0 : fit.rmsPx / FAIR_PX) : fit.rmsPct / RMS_FULL_BAR;
    return Math.min(100, Math.round(share * 100));
  }

  /**
   * One line per gap the planner says Apply is waiting on, each naming the one
   * control that closes it by the name the panel or the toolbar shows. Every
   * id the planner emits has a line; a hint the planner attaches picks the
   * more specific wording where one exists.
   */
  #needLines(plan) {
    const tool = loc("mode.square");
    const bar = loc("mode.scale");
    const family = loc("setup.family");
    const cell = loc(this.isHex ? "fields.mapCellHex" : "fields.mapCellFeet");
    const reads = loc("samples.reads");
    const line = {
      sceneNotSquare: () => loc("warn.notSquareGrid", { family }),
      background: () => loc("warn.noBackground"),
      gridSample: (hint) => loc(hint === "barAlone" ? "needs.gridSampleBar" : "needs.gridSample", { tool }),
      hexBox: (hint) => loc(hint === "barAlone" ? "needs.hexBoxBar" : "needs.hexBox", { tool }),
      oneHexBox: () => loc("needs.oneHexBox", { tool }),
      hexProbe: () => loc("needs.hexProbe", { family }),
      measurement: () => loc("needs.measurement", { tool: bar }),
      barValue: () => loc("needs.barValue", { field: reads }),
      cellWorth: (hint) => loc(hint === "barWithoutValue" ? "needs.cellWorthBar" : "needs.cellWorth", { field: cell, reads }),
      unsolved: () => loc("needs.unsolved"),
    };
    return plan.needs.map((n) => (line[n.id] ?? line.unsolved)(n.hint));
  }

  /** One line per sample the family leaves out. Unreachable boxes are the warning's to state. */
  #unusedLines(plan) {
    const tool = loc("mode.square");
    const line = {
      corners: (count) => loc("unused.corners", { count, tool }),
      multiHexBoxes: (count) => loc("unused.multiHexBoxes", { count }),
      scaleBarWithoutValue: () => loc("unused.scaleBarWithoutValue", { field: loc("samples.reads") }),
    };
    return plan.unused.filter((u) => line[u.id]).map((u) => line[u.id](u.count));
  }

  /**
   * The fit's warnings as lines, for the worst-box slot. A loose hex fit names
   * the box that sits furthest off by its row number, or none where the fit
   * names none; boxes left out as unreachable, and a family the boxes do not
   * read as, are stated here too, so none vanishes without a word. The square
   * family's loose line is its own.
   */
  #warningLines(plan) {
    const family = loc("setup.family");
    const lines = [];
    for (const w of plan.warnings) {
      if (w.id === "looseFit") {
        if (!this.isHex) lines.push(loc("warn.highResidual"));
        else lines.push(w.worst == null ? loc("warn.looseHex") : loc("warn.looseHexWorst", { n: w.worst + 1 }));
      } else if (w.id === "unreachable") {
        lines.push(loc("warn.unreachable", { count: w.count }));
      } else if (w.id === "familyMismatch") {
        // One box cannot show its own size, so a lone box names both causes and the
        // check. Where a second box was left out as a different size, the pair itself
        // says one of them surrounds several hexes, and the advice is to delete it.
        const split = plan.unused.some((u) => u.id === "multiHexBoxes");
        if (!w.lone) lines.push(loc("warn.familyMismatch", { family }));
        else if (split) lines.push(loc("warn.familyMismatchLoneSplit", { family }));
        else lines.push(loc("warn.familyMismatchLone", { family, tool: loc("mode.square") }));
      } else if (w.id === "familyAmbiguous") {
        lines.push(loc("warn.familyAmbiguous", { family }));
      }
    }
    return lines;
  }

  /**
   * The scene default's three selects: a terrain brush value, a territory and
   * the climate the whole map reads (grouped as the party sheet groups them).
   * A held value the vocabulary no longer offers is kept as an option, so a
   * save of another select does not clear it.
   */
  #countryRows(scene) {
    const held = this.#countryDraft ?? sceneCountry(scene);
    const options = (layer, current) => {
      const values = paintableValues(layer);
      if (current && !values.includes(current)) values.push(current);
      return values.map((key) => ({ key, label: layerLabelFor(key, layer), selected: key === current }));
    };
    // The climate is the map's own setting, not a brush layer: its codes and
    // names come from the climate vocabulary itself.
    const codes = Object.keys(CLIMATES);
    if (held.climate && !codes.includes(held.climate)) codes.push(held.climate);
    const climates = codes.map((key) => ({ key, label: climateLabelFor(key), selected: key === held.climate }));
    const groups = [...new Set(climates.map((o) => CLIMATES[o.key]?.group ?? ""))].map((group) => ({
      label: group ? game.i18n.localize(`ACKS-FORMATION.travel.weather.climateGroup.${group}`) : "",
      options: climates.filter((o) => (CLIMATES[o.key]?.group ?? "") === group),
    }));
    return [
      { name: "country.ground", label: loc("setup.countryGround"), options: options("terrain", held.ground), groups: [] },
      { name: "country.territory", label: loc("setup.countryTerritory"), options: options("territory", held.territory), groups: [] },
      { name: "country.climate", label: loc("setup.countryClimate"), options: [], groups },
    ];
  }

  /**
   * Chips for the output field. Scale-only offers the neighbours of the cell
   * it would choose by itself — the plain ladder is a set of combat
   * distances, and the map being scaled may be a county.
   */
  #outputChips() {
    const comfortable = this.isScaleOnly ? this.comfortableCell : null;
    const values = comfortable ? roundSuggestions(comfortable) : squareFeet(canvas?.scene);
    return values.map((v) => ({ value: v, active: this.outputFeet === v }));
  }

  /**
   * Chips for the map-cell field: what a scale bar rounds to when one has
   * been dragged, else the plain ladder. A hex map gets suggestions only
   * when a bar has been measured — its cells are worth whatever its own key
   * says otherwise.
   */
  #mapChips(rawFeet) {
    if (!rawFeet && this.isHex) return [];
    const values = rawFeet ? roundSuggestions(rawFeet) : squareFeet(canvas?.scene);
    return values.map((v) => ({ value: v, active: this.mapCellFeet === v }));
  }

  /** "3 boxes · 2 corners · 1 scale bar", omitting what is not there. */
  #sampleSummary() {
    const s = this.samples;
    const parts = [];
    const count = (n, one, many) => (n === 1 ? loc(one) : loc(many, { n }));
    if (s.squares.length) parts.push(count(s.squares.length, "samples.countBox", "samples.countBoxes"));
    if (s.corners.length) parts.push(count(s.corners.length, "samples.countCorner", "samples.countCorners"));
    if (s.scale) parts.push(loc("samples.countScale"));
    return parts.join(" · ");
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    // The panel follows the session, not the other way round. Held only
    // while the window is open — a listener over a closed window would
    // re-open it on the next toolbar press.
    this.#unsubscribe ??= session.subscribe(() => this.render());
  }

  _onClose(options) {
    super._onClose(options);
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    // Nothing is disarmed here — closing the panel is not a statement about
    // the canvas; leaving the Battlemap control group is what disarms.
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
    // Every slot is taken before the first notification: a listener that
    // renders on it must plan from the values this submit carries.
    for (const slot of ["mapCellFeet", "scaleValue", "outputFeet", "gridSizePx", "customFeet"]) {
      if (present(slot)) session.opts[slot] = num(d[slot]);
    }
    session.setSetup({ gridFamily: d.gridFamily, hexEven: d.hexEven, units: d.units, mapSystem: d.mapSystem });
    for (const [index, cells] of Object.entries(d.boxCells ?? {})) session.setBoxCells(index, Number(cells));
    // A statement ABOUT THE SCENE, not part of the calibration arithmetic,
    // so it lands the moment it is chosen.
    BattlemapAssistant.#writeSystem(d.mapSystem || null);
    if (present("country")) this.#writeCountry(d.country ?? {});
    this.render();
  }

  /** Persist the scene's declared travel system, if it changed. */
  static #writeSystem(mapSystem) {
    const scene = canvas?.scene;
    if (!scene || !game.user.isGM) return;
    writeSceneSystem(scene, mapSystem).catch((err) => console.error(`${MODULE_ID} | scene system write failed`, err));
  }

  /**
   * Persist the scene's default country, if it changed: the three selects
   * write the whole record, a blank select clearing its key.
   */
  #writeCountry(country) {
    const scene = canvas?.scene;
    if (!scene || !game.user.isGM) return;
    const next = {
      ground: country.ground || null,
      territory: country.territory || null,
      climate: country.climate || null,
    };
    const held = sceneCountry(scene);
    if (next.ground === held.ground && next.territory === held.territory && next.climate === held.climate) return;
    this.#countryDraft = next;
    writeSceneSetup(scene, { country: next })
      .catch((err) => console.error(`${MODULE_ID} | scene country write failed`, err))
      .finally(() => {
        this.#countryDraft = null;
        this.render();
      });
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

  /**
   * One button, three applies — the family chose which before it was pressed.
   * It writes the solve the window last rendered, with the auto-sizing the
   * plan decided, and only while that plan says Apply is open.
   */
  static async #onApplyGrid() {
    const scene = canvas?.scene;
    const shown = this.#shown;
    if (!scene || !shown?.plan.canApply || !shown.solved || shown.sceneId !== (scene.id ?? null)) return;
    const applied = await writeSetup(scene, shown.solved, { family: shown.family, autoScale: shown.plan.autoScale, lines: shown.lines });
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
