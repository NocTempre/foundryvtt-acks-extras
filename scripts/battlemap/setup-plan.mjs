/**
 * The map setup planner: what the Apply button still needs, what it would
 * rewrite, whether the scene already matches, and whether the apply turns token
 * auto-sizing on.
 *
 * Pure: plain data in, plain data out, with no document, no canvas and no
 * Foundry global. It answers in structural ids and never in lang keys; the
 * panel owns the words. Four answers come from one call so the panel, the
 * confirmation and the write read the same one.
 *
 * ## Needs
 *
 * One entry per gap, `{ id, action, hint? }`. `id` names the gap, `action`
 * names the ONE control that closes it, and the optional `hint` names a more
 * specific cause the panel may word differently.
 *
 * | id | action | when |
 * |---|---|---|
 * | `sceneNotSquare` | `familySelect` | the square family over a hex scene, which the apply refuses |
 * | `background` | `backgroundImage` | a geometry apply over a scene with no background image |
 * | `gridSample` | `boxTool` | square: no fit; hint `barAlone` (a bar needs a fit) or the fit's own reason |
 * | `hexBox` | `boxTool` | hex: no box at all; hint `barAlone` when a bar is the only sample |
 * | `oneHexBox` | `boxTool` | hex: boxes exist and none is one hex of this family's shape |
 * | `otherFamilyBox` | `familySelect` | hex: every box is shaped like the other hex family |
 * | `hexProbe` | `familySelect` | hex: the scene could not be asked for one hex |
 * | `measurement` | `scaleBarTool` | scale only: neither a bar nor a fit |
 * | `barValue` | `barValueField` | scale only: a bar with no printed length |
 * | `cellWorth` | `cellWorthField` | what one map cell is worth is blank |
 * | `unsolved` | `null` | nothing above applies and no solution came back |
 *
 * A bar is not a fit input on a hex family and not a placement anywhere: it
 * suggests the cell's worth, and only a box places the hexes.
 *
 * ## Unused
 *
 * Samples the chosen family leaves out, `{ id, count }`: `corners` on a hex
 * family, `otherFamilyBoxes` and `multiHexBoxes` beside a usable hex fit, and
 * `scaleBarWithoutValue` when a bar adds nothing.
 *
 * ## Warnings
 *
 * A Judge gets warnings, never blocks. A loose fit is
 * `{ id: "looseFit", worst, rmsPct }`, where `worst` is the index of the box
 * that sits furthest off (null for a square fit, which scores no single box).
 * It never disables Apply.
 *
 * ## Rows
 *
 * `{ id, before, after, ... }`, one per change, omitted where before equals
 * after. `grid` (`{type,size}`, with `unit: "px"`), `cellWorth`
 * (`{distance,units}`), `image` (`{width,height,shiftX,shiftY}` plus `rescale`
 * `{x,y}` and `moves: true`, since placeables ride with the image),
 * `tokenSizing` (a boolean, with `because: "expeditionScale"` when the answer
 * is off for that reason), and `travelSystem` (a mode id or null for none
 * declared). A solution field that is absent or null is unchanged, except the
 * travel system, where null is the declaration of none.
 */

import { CALIBRATABLE_GRIDS } from "./constants.mjs";
import { DISTANCE_UNITS, unitKey } from "../lib/distance-units.mjs";

/** The tolerance the apply itself reads a written scale back at. */
const EPS = 1e-6;

const finite = (n) => typeof n === "number" && Number.isFinite(n);
const same = (a, b) => (finite(a) && finite(b) ? Math.abs(a - b) <= EPS : (a ?? null) === (b ?? null));

/**
 * A unit string reduced to what it names, so two spellings of one unit compare
 * equal. A known unit folds to its table key, a blank one reads as feet (as
 * every length in the module does), and an unknown one folds case and
 * punctuation.
 */
function foldUnits(units) {
  const key = unitKey(units);
  if (key) return key;
  const s = String(units ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return s || "ft";
}

/**
 * What one map cell is worth, resolved the way the panel's field reads it: an
 * entered value wins; then a measurement taken off a scale bar; then the
 * scene's own distance, and only when the unit being written is the scene's
 * unit (folded compare, so `mi` and `Miles` agree). A changed unit leaves the
 * scene's number meaning something else, so it resolves to null and the plan
 * asks for the value.
 *
 * @param {object} input
 * @param {number|null} [input.entered]  The Judge's own value.
 * @param {number|null} [input.fromBar]  The worth a bar with a printed length measures.
 * @param {string|null} [input.units]  The unit key or abbreviation being written; null keeps the scene's.
 * @param {{distance?: number, units?: string}|null} [input.scene]  The scene's current grid distance and unit.
 * @returns {number|null}
 */
export function resolveCellWorth({ entered = null, fromBar = null, units = null, scene = null } = {}) {
  if (entered > 0) return entered;
  if (fromBar > 0) return fromBar;
  if (!(scene?.distance > 0)) return null;
  const sameUnit = units == null || units === "" || foldUnits(units) === foldUnits(scene.units);
  return sameUnit ? scene.distance : null;
}

const need = (id, action, hint) => (hint ? { id, action, hint } : { id, action });

/** The sample gaps of a square fit. */
function squareGaps({ fit, samples }) {
  if (fit?.ok) return [];
  const barAlone = !!samples.bar && !samples.boxes && !samples.corners;
  const hint = barAlone ? "barAlone" : fit?.reason && fit.reason !== "noSamples" ? fit.reason : undefined;
  return [need("gridSample", "boxTool", hint)];
}

/**
 * The sample gaps of a hex fit. A hex fit's own failure reason picks the gap;
 * a box the fit rejects for its shape sends the Judge to the family choice,
 * since the box is more often right than the family.
 */
function hexGaps({ fit, samples }) {
  if (fit?.ok) return [];
  const reason = fit?.reason ?? "noBoxes";
  if (reason === "noProbe") return [need("hexProbe", "familySelect")];
  if (reason === "noOneHex") {
    const boxes = fit?.boxes ?? [];
    const allOther = boxes.length > 0 && boxes.every((b) => b.otherFamily);
    return [allOther ? need("otherFamilyBox", "familySelect") : need("oneHexBox", "boxTool")];
  }
  const barAlone = !!samples.bar && !samples.boxes;
  return [need("hexBox", "boxTool", barAlone ? "barAlone" : undefined)];
}

/** The gaps in what one map cell is worth, or in a scale-only measurement. */
function worthGaps({ family, fit, samples, cellWorth }) {
  const worth = cellWorth > 0;
  if (family === "scale") {
    if (samples.bar && samples.barValue) return [];
    if (fit?.ok && worth) return [];
    if (samples.bar) return [need("barValue", "barValueField")];
    return [fit?.ok ? need("cellWorth", "cellWorthField") : need("measurement", "scaleBarTool")];
  }
  if (worth) return [];
  // A bar with its length measures the worth as soon as the fit exists, so the
  // fit gap is the only one worth naming.
  if (!fit?.ok && samples.bar && samples.barValue) return [];
  return [need("cellWorth", "cellWorthField", samples.bar && !samples.barValue ? "barWithoutValue" : undefined)];
}

/** The samples the family leaves out of its answer. */
function unusedSamples({ family, fit, samples, cellWorth, hex }) {
  const unused = [];
  if (hex && samples.corners > 0) unused.push({ id: "corners", count: samples.corners });
  if (hex && fit?.ok) {
    const boxes = fit.boxes ?? [];
    const other = boxes.filter((b) => b.otherFamily).length;
    const multi = boxes.filter((b) => b.notOneHex && !b.otherFamily).length;
    if (other) unused.push({ id: "otherFamilyBoxes", count: other });
    if (multi) unused.push({ id: "multiHexBoxes", count: multi });
  }
  // A bar with no length answers nothing; it is named only where no need
  // already points at it.
  const worthKnown = cellWorth > 0 && (family !== "scale" || fit?.ok);
  if (samples.bar && !samples.barValue && worthKnown) unused.push({ id: "scaleBarWithoutValue", count: 1 });
  return unused;
}

/** The before/after rows of what the apply would write over the scene. */
function planRows({ scene, solution, autoScale, expeditionScale }) {
  if (!solution) return [];
  const rows = [];

  const gridBefore = { type: scene.gridType ?? null, size: scene.gridSize ?? null };
  const gridAfter = { type: solution.gridType ?? gridBefore.type, size: solution.gridSize ?? gridBefore.size };
  if (gridBefore.type !== gridAfter.type || !same(gridBefore.size, gridAfter.size)) {
    rows.push({ id: "grid", unit: "px", before: gridBefore, after: gridAfter });
  }

  const unitsAfter = solution.units
    ? (DISTANCE_UNITS[unitKey(solution.units)]?.abbr ?? solution.units)
    : (scene.units ?? "");
  const worthBefore = { distance: scene.distance ?? null, units: scene.units ?? "" };
  const worthAfter = { distance: solution.distance ?? worthBefore.distance, units: unitsAfter };
  if (!same(worthBefore.distance, worthAfter.distance) || foldUnits(worthBefore.units) !== foldUnits(worthAfter.units)) {
    rows.push({ id: "cellWorth", before: worthBefore, after: worthAfter });
  }

  const fields = ["width", "height", "shiftX", "shiftY"];
  const imageBefore = Object.fromEntries(fields.map((f) => [f, scene[f] ?? null]));
  const imageAfter = Object.fromEntries(fields.map((f) => [f, solution[f] ?? imageBefore[f]]));
  if (fields.some((f) => !same(imageBefore[f], imageAfter[f]))) {
    const ratio = (a, b) => (b > 0 && finite(a) ? a / b : null);
    rows.push({
      id: "image",
      before: imageBefore,
      after: imageAfter,
      rescale: { x: ratio(imageAfter.width, imageBefore.width), y: ratio(imageAfter.height, imageBefore.height) },
      moves: true,
    });
  }

  const sizingBefore = !!scene.autoScale;
  if (sizingBefore !== autoScale) {
    const row = { id: "tokenSizing", before: sizingBefore, after: autoScale };
    if (expeditionScale && !autoScale) row.because = "expeditionScale";
    rows.push(row);
  }

  const systemBefore = scene.mapSystem ?? null;
  const systemAfter = solution.mapSystem ?? null;
  if (systemBefore !== systemAfter) rows.push({ id: "travelSystem", before: systemBefore, after: systemAfter });

  return rows;
}

/**
 * Plan a setup: the gaps that keep Apply disabled, the rows it would rewrite,
 * whether the scene already matches, and the token auto-sizing it writes.
 *
 * @param {object} input
 * @param {"square"|"hexRows"|"hexCols"|"scale"} input.family  What the apply writes.
 * @param {{boxes?: number, corners?: number, bar?: boolean, barValue?: boolean}} [input.samples]
 *   Counts of dragged boxes and clicked corners, whether a scale bar is drawn,
 *   and whether its printed length is entered.
 * @param {object|null} [input.fit]  A square fit (`fitGrid`'s `{ok, reason, confidence, ...}`)
 *   on a square or scale family, or a hex fit (`{ok, boxes:[{index, notOneHex, otherFamily}],
 *   worst, rmsPct, confidence}` / `{ok:false, reason, boxes?}`) on a hex family. Null when none
 *   was run. A `noOneHex` failure tells "only other-family boxes" (`otherFamilyBox`) from "only
 *   multi-hex boxes" (`oneHexBox`) by the `boxes` it carries; without them it reads as `oneHexBox`.
 * @param {number|null} [input.cellWorth]  What one map cell is worth, already resolved
 *   (`resolveCellWorth`); null or blank is a need.
 * @param {object} [input.scene]  The scene as it is: `{gridType, gridSize, distance, units,
 *   width, height, shiftX, shiftY, autoScale, mapSystem, hasBackground}`. A background is
 *   assumed unless `hasBackground` is exactly false.
 * @param {object|null} [input.solution]  The same fields as the apply would write them
 *   (`gridType, gridSize, distance, units, width, height, shiftX, shiftY, mapSystem`), or null
 *   when nothing is solvable yet. An absent field is unchanged; a scale-only solution carries
 *   no width, height, shift or type.
 * @param {boolean} [input.expeditionScale]  Whether a cell is a mile or more; the caller decides
 *   it. True leaves token auto-sizing off.
 * @returns {{family: string, needs: object[], unused: object[], warnings: object[], rows: object[],
 *   matches: boolean, canApply: boolean, autoScale: boolean}}
 */
export function planSetup({ family, samples = {}, fit = null, cellWorth = null, scene = {}, solution = null, expeditionScale = false } = {}) {
  const hex = family === "hexRows" || family === "hexCols";
  const sample = { boxes: samples.boxes ?? 0, corners: samples.corners ?? 0, bar: !!samples.bar, barValue: !!samples.barValue };
  const needs = [];

  // The geometry applies refuse a scene they cannot write to; the scale-only
  // apply touches neither the image nor the grid type.
  if (family === "square" && scene.gridType != null && !CALIBRATABLE_GRIDS.has(scene.gridType)) {
    needs.push(need("sceneNotSquare", "familySelect"));
  }
  if (family !== "scale" && scene.hasBackground === false) needs.push(need("background", "backgroundImage"));

  if (family === "square") needs.push(...squareGaps({ fit, samples: sample }));
  else if (hex) needs.push(...hexGaps({ fit, samples: sample }));
  needs.push(...worthGaps({ family, fit, samples: sample, cellWorth }));
  if (!needs.length && !solution) needs.push(need("unsolved", null));

  const warnings = [];
  if (fit?.ok && fit.confidence === "loose") {
    warnings.push({ id: "looseFit", worst: fit.worst ?? null, rmsPct: fit.rmsPct ?? null });
  }

  const autoScale = !expeditionScale;
  const rows = planRows({ scene, solution, autoScale, expeditionScale });
  const matches = !!solution && rows.length === 0;
  return {
    family,
    needs,
    unused: unusedSamples({ family, fit, samples: sample, cellWorth, hex }),
    warnings,
    rows,
    matches,
    canApply: needs.length === 0 && !!solution && !matches,
    autoScale,
  };
}
