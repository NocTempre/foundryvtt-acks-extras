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
 * | `oneHexBox` | `boxTool` | hex: boxes exist and the fit found none that is one hex |
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
 * family, `multiHexBoxes` (boxes the fit rejected as not one hex) and
 * `unreachableBoxes` (boxes too far from the others to place) beside a usable
 * hex fit, and `scaleBarWithoutValue` when a bar adds nothing. A failed hex fit
 * lists no boxes: its need already says they are all unusable.
 *
 * ## Warnings
 *
 * A Judge gets warnings, never blocks; none disables Apply, and the Judge's
 * family and boxes are always kept.
 *
 * | id | action | fields | when |
 * |---|---|---|---|
 * | `familyMismatch` | `familySelect` | `basis`, `lone`? | hex: the fit reads the boxes as the other hex family |
 * | `familyAmbiguous` | `familySelect` | `basis` | hex: the fit cannot tell the two families apart |
 * | `unreachable` | `boxTool` | `count` | hex: boxes too far to place; a box drawn between them closes the gap |
 * | `looseFit` | none | `worst`, `rmsPct` | the fit's confidence is `"loose"` |
 *
 * `basis` is the fit's own: `"lattice"` (the boxes' spread decided it) or
 * `"shape"` (their proportions did). `lone` is present, and `true`, only on a
 * shape-based `familyMismatch` over exactly one used box: one box cannot show
 * its own size, so a box drawn around several hexes reads as the other family
 * just as a wrong family does, and only a second box tells the two apart.
 * `worst` is the index of the sample that sits
 * furthest off, null where the fit names none (a hex fit names a box only from
 * three used boxes, and a square fit a sample only from three; a square fit's
 * index counts the boxes, then the corners).
 *
 * ## Rows
 *
 * `{ id, before, after, ... }`, one per change, omitted where before equals
 * after. `grid` (`{type,size}`, with `unit: "px"`), `cellWorth`
 * (`{distance,units}`), `image` (`{width,height,shiftX,shiftY}` plus `rescale`
 * `{x,y}`), `tokenSizing` (a boolean, with `because: "expeditionScale"` when the answer
 * is off for that reason), and `travelSystem` (the mode a party takes where
 * none is declared: a mode id, or null before; a row only where one is called
 * for after the write and it differs). A solution field that is absent or null
 * is unchanged.
 */

import { CALIBRATABLE_GRIDS } from "./constants.mjs";
import { DISTANCE_UNITS, isExpeditionScale, unitKey } from "../lib/distance-units.mjs";

/** The tolerance the apply itself reads a written scale back at. */
const EPS = 1e-6;

const finite = (n) => typeof n === "number" && Number.isFinite(n);
const same = (a, b) => (finite(a) && finite(b) ? Math.abs(a - b) <= EPS : (a ?? null) === (b ?? null));

/**
 * A unit string reduced to what it names, so two spellings of one unit compare
 * equal. A known unit folds to its table key, a blank one reads as feet (as
 * every length in the module does), and an unknown one folds case and
 * punctuation. The planner reads a unit change through it and the apply writes
 * one through it, so what the plan calls unchanged is never rewritten.
 */
export function foldUnits(units) {
  const key = unitKey(units);
  if (key) return key;
  const s = String(units ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return s || "ft";
}

/**
 * The unit string the scene holds once an apply has written the chosen unit.
 * A scene whose own non-blank unit folds equal to the chosen one keeps its
 * spelling (`Miles` for `mi`); otherwise the chosen unit's abbreviation is
 * written, or the chosen string as given when it names no known unit. With
 * nothing chosen the scene's own unit stands. The apply writes a unit through
 * this and the planner names it through this, so a row never shows a spelling
 * the write does not leave.
 *
 * @param {string|null} sceneUnits  The scene's current grid unit.
 * @param {string|null} [chosen]  The unit key or abbreviation chosen; null or blank keeps the scene's.
 * @returns {string}
 */
export function unitAfterApply(sceneUnits, chosen = null) {
  if (!chosen) return sceneUnits ?? "";
  const abbr = DISTANCE_UNITS[unitKey(chosen)]?.abbr ?? chosen;
  if (String(sceneUnits ?? "").trim() && foldUnits(sceneUnits) === foldUnits(abbr)) return sceneUnits;
  return abbr;
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

/**
 * Whether the cell an apply WRITES is a mile or more, the `expeditionScale` the
 * planner takes. The unit is the one the apply writes (the chosen unit's
 * abbreviation), or the scene's own when none is chosen, so "keep the scene's
 * unit" over a scene already in miles reads as miles. The distance is the
 * solution's, falling back to the scene's when the solution names none.
 *
 * @param {object} input
 * @param {number|null} [input.distance]  The solution's cell worth.
 * @param {string|null} [input.units]  The unit key or abbreviation chosen; null or blank keeps the scene's.
 * @param {{distance?: number, units?: string}|null} [input.scene]  The scene's current grid distance and unit.
 * @returns {boolean}
 */
export function expeditionScaleOf({ distance = null, units = null, scene = null } = {}) {
  const written = unitAfterApply(scene?.units, units);
  return isExpeditionScale({ grid: { distance: distance ?? scene?.distance, units: written } });
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
 * the fit never rejects a box for the family, so a rejected set is always a
 * box to redraw.
 */
function hexGaps({ fit, samples }) {
  if (fit?.ok) return [];
  const reason = fit?.reason ?? "noBoxes";
  if (reason === "noProbe") return [need("hexProbe", "familySelect")];
  if (reason === "noOneHex") return [need("oneHexBox", "boxTool")];
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
    const multi = boxes.filter((b) => b.notOneHex).length;
    const far = boxes.filter((b) => b.unreachable).length;
    if (multi) unused.push({ id: "multiHexBoxes", count: multi });
    if (far) unused.push({ id: "unreachableBoxes", count: far });
  }
  // A bar with no length answers nothing; it is named only where no need
  // already points at it.
  const worthKnown = cellWorth > 0 && (family !== "scale" || fit?.ok);
  if (samples.bar && !samples.barValue && worthKnown) unused.push({ id: "scaleBarWithoutValue", count: 1 });
  return unused;
}

const FAMILY_VERDICTS = new Set(["familyMismatch", "familyAmbiguous"]);

/**
 * The warnings a usable fit carries. A hex fit's family verdicts pass through
 * with the family select as their action; boxes it could not place become one
 * `unreachable` warning; a loose confidence adds `looseFit`. A shape-based
 * mismatch over a single used box is marked `lone`.
 */
function fitWarnings({ fit, hex }) {
  const warnings = [];
  if (hex) {
    const used = (fit.boxes ?? []).filter((b) => !b.notOneHex && !b.unreachable).length;
    for (const w of fit.warnings ?? []) {
      if (!FAMILY_VERDICTS.has(w?.id)) continue;
      const warning = { id: w.id, action: "familySelect", basis: w.basis ?? null };
      if (w.id === "familyMismatch" && warning.basis === "shape" && used === 1) warning.lone = true;
      warnings.push(warning);
    }
    const far = (fit.boxes ?? []).filter((b) => b.unreachable).length;
    if (far) warnings.push({ id: "unreachable", count: far, action: "boxTool" });
  }
  if (fit.confidence === "loose") warnings.push({ id: "looseFit", worst: fit.worst ?? null, rmsPct: fit.rmsPct ?? null });
  return warnings;
}

/** The before/after rows of what the apply would write over the scene. */
function planRows({ scene, solution, autoScale, expeditionScale, travelSystem }) {
  if (!solution) return [];
  const rows = [];

  const gridBefore = { type: scene.gridType ?? null, size: scene.gridSize ?? null };
  const gridAfter = { type: solution.gridType ?? gridBefore.type, size: solution.gridSize ?? gridBefore.size };
  if (gridBefore.type !== gridAfter.type || !same(gridBefore.size, gridAfter.size)) {
    rows.push({ id: "grid", unit: "px", before: gridBefore, after: gridAfter });
  }

  const unitsAfter = unitAfterApply(scene.units, solution.units);
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
    });
  }

  const sizingBefore = !!scene.autoScale;
  if (sizingBefore !== autoScale) {
    const row = { id: "tokenSizing", before: sizingBefore, after: autoScale };
    if (expeditionScale && !autoScale) row.because = "expeditionScale";
    rows.push(row);
  }

  // The row is the system a party takes where none is declared, so it shows
  // only where one is called for after the write and differs from now.
  const systemBefore = travelSystem?.before ?? null;
  const systemAfter = travelSystem?.after ?? null;
  if (systemAfter && systemBefore !== systemAfter) rows.push({ id: "travelSystem", before: systemBefore, after: systemAfter });

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
 *   on a square or scale family, or a hex fit (`{ok, boxes:[{index, notOneHex, unreachable}],
 *   warnings:[{id, basis}], worst, rmsPct, confidence}` / `{ok:false, reason, boxes?}`) on a hex
 *   family, as `fitHexLattice` answers it. Null when none was run.
 * @param {number|null} [input.cellWorth]  What one map cell is worth, already resolved
 *   (`resolveCellWorth`); null or blank is a need.
 * @param {object} [input.scene]  The scene as it is: `{gridType, gridSize, distance, units,
 *   width, height, shiftX, shiftY, autoScale, hasBackground}`. A background is
 *   assumed unless `hasBackground` is exactly false.
 * @param {object|null} [input.solution]  The same fields as the apply would write them
 *   (`gridType, gridSize, distance, units, width, height, shiftX, shiftY`), or null
 *   when nothing is solvable yet. An absent field is unchanged; a scale-only solution carries
 *   no width, height, shift or type.
 * @param {boolean} [input.expeditionScale]  Whether a cell is a mile or more; the caller decides
 *   it. True leaves token auto-sizing off.
 * @param {{before: string|null, after: string|null}|null} [input.travelSystem]  The system a
 *   party takes on the scene as it is and as the apply would leave it (`systemCalledFor`), each
 *   null where none is called for; the caller decides both.
 * @returns {{family: string, needs: object[], unused: object[], warnings: object[], rows: object[],
 *   matches: boolean, canApply: boolean, autoScale: boolean}}
 */
export function planSetup({ family, samples = {}, fit = null, cellWorth = null, scene = {}, solution = null, expeditionScale = false, travelSystem = null } = {}) {
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

  const warnings = fit?.ok ? fitWarnings({ fit, hex }) : [];

  const autoScale = !expeditionScale;
  const rows = planRows({ scene, solution, autoScale, expeditionScale, travelSystem });
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
