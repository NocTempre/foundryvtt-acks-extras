/**
 * Battlemap calibration: the grid solver and the footprint arithmetic.
 * Pure functions; no Foundry, no world. Synthetic lattices only — no value
 * here is read off a page.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { boxSpan, canvasPerImage, fitGrid, fitHexLattice, unitsPerCentreSpacing, HAND_PX, REACH_Z, FAMILY_Z, TIGHT_PX, FAIR_PX, HEX_SHAPE_LEAN, HEX_SIZE_SPREAD, feetPerSquare, hexSizeFromBox, pixelsPerUnit, roundSuggestions, outputGridSize, scaleOnlyGrid, solveShift } from "../scripts/battlemap/calibrate-logic.mjs";
import { hexProbe } from "../scripts/battlemap/scene-setup.mjs";
import { hexPreviewOutlines, HEX_PREVIEW_MAX, CaptureOverlay, isEditableTarget } from "../scripts/battlemap/capture.mjs";
import { footprintFeet, sizeChips, tokenSpan, scaleMismatch, SPAN_MIN } from "../scripts/battlemap/footprint.mjs";
import { hexAlignment } from "../scripts/battlemap/hex-fit.mjs";
import { SIZES } from "../scripts/monsters/config.mjs";
import { SIZE_DOC, SIZE_TABLE, SIZE_ROW, SQUARE_TABLE, sizeSquares, sizeSquareFeet, sizeCite, parseFrontage } from "../scripts/monsters/sizes.mjs";
import { PRIORITY, registerTable, unregisterTable, resetTables } from "../scripts/lib/tables.mjs";
import { cellGrid, paintRegion, paintScene } from "./region-fixture.mjs";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} !~ ${b} (tol ${tol})`);

/* -------------------------------------------- */
/*  fitGrid — square mode                       */
/* -------------------------------------------- */

{
  // Exact synthetic grid: cell 70 px, phase (13, 27).
  const s = 70;
  const squares = [
    { x: 13 + 2 * s, y: 27 + 3 * s, w: s, h: s },
    { x: 13 + 7 * s, y: 27 + 1 * s, w: s, h: s },
  ];
  const corners = [
    { x: 13 + 4 * s, y: 27 + 4 * s },
    { x: 13 + 9 * s, y: 27 + 2 * s },
    { x: 13 + 1 * s, y: 27 + 8 * s },
  ];
  const fit = fitGrid({ squares, corners });
  assert.equal(fit.ok, true);
  near(fit.sizeX, s, 1e-6, "square size");
  near(fit.phaseX, 13, 1e-6, "square phaseX");
  near(fit.phaseY, 27, 1e-6, "square phaseY");
  assert.equal(fit.confidence, "tight");
}

{
  // Noisy samples: ±1 px jitter still lands within half a pixel of the cell.
  const s = 100;
  const jit = [1, -1, 0.5, -0.5, 0.8, -0.8, 0.3, -0.3];
  let k = 0;
  const j = () => jit[k++ % jit.length];
  const squares = [
    { x: 10 + j(), y: 20 + j(), w: s + j(), h: s + j() },
    { x: 10 + 3 * s + j(), y: 20 + 2 * s + j(), w: s + j(), h: s + j() },
  ];
  const corners = [
    { x: 10 + 5 * s + j(), y: 20 + 5 * s + j() },
    { x: 10 + 8 * s + j(), y: 20 + 1 * s + j() },
  ];
  const fit = fitGrid({ squares, corners });
  assert.equal(fit.ok, true);
  near(fit.sizeX, s, 0.5, "noisy size");
  assert.ok(fit.rmsPct < 0.03, `noisy fit should stay under the fair band, got ${fit.rmsPct}`);
}

{
  // Corners only, sampled several cells apart: the divisor search recovers
  // the cell without any square drag.
  const s = 50;
  const corners = [
    { x: 5, y: 9 },
    { x: 5 + 6 * s, y: 9 + 2 * s },
    { x: 5 + 13 * s, y: 9 + 9 * s },
    { x: 5 + 4 * s, y: 9 + 11 * s },
  ];
  const fit = fitGrid({ squares: [], corners });
  assert.equal(fit.ok, true);
  near(fit.sizeX, s, 1e-6, "corners-only size");
  near(fit.phaseX, 5, 1e-6, "corners-only phaseX");
}

{
  // Degenerate inputs refuse rather than invent.
  assert.equal(fitGrid({ squares: [], corners: [] }).ok, false);
  assert.equal(fitGrid({ squares: [], corners: [] }).reason, "noSamples");
  assert.equal(fitGrid({ squares: [], corners: [{ x: 10, y: 10 }] }).reason, "noSeed");
}

/* -------------------------------------------- */
/*  fitGrid — rect and affine modes             */
/* -------------------------------------------- */

{
  // Stretched scan: 60 px wide, 80 px tall cells.
  const squares = [
    { x: 7 + 60, y: 11 + 80, w: 60, h: 80 },
    { x: 7 + 4 * 60, y: 11 + 3 * 80, w: 60, h: 80 },
  ];
  const corners = [
    { x: 7 + 8 * 60, y: 11 + 6 * 80 },
    { x: 7 + 2 * 60, y: 11 + 9 * 80 },
  ];
  const fit = fitGrid({ squares, corners, mode: "rect" });
  assert.equal(fit.ok, true);
  near(fit.sizeX, 60, 1e-6, "rect sizeX");
  near(fit.sizeY, 80, 1e-6, "rect sizeY");
}

{
  // Mildly skewed lattice: u=(70,5), v=(-4,65), origin (20,30).
  const u = { x: 70, y: 5 };
  const v = { x: -4, y: 65 };
  const O = { x: 20, y: 30 };
  const at = (i, j) => ({ x: O.x + i * u.x + j * v.x, y: O.y + i * u.y + j * v.y });
  const corners = [at(0, 0), at(3, 1), at(6, 2), at(1, 5), at(8, 7), at(4, 4), at(2, 8)];
  const fit = fitGrid({ squares: [], corners, mode: "affine" });
  assert.equal(fit.ok, true);
  assert.ok(fit.u, "affine fit produced a basis");
  near(Math.hypot(fit.u.x, fit.u.y), Math.hypot(u.x, u.y), 0.1, "affine |u|");
  near(Math.hypot(fit.v.x, fit.v.y), Math.hypot(v.x, v.y), 0.1, "affine |v|");
  const expectedSkew = 90 - (Math.atan2(v.y, v.x) - Math.atan2(u.y, u.x)) * (180 / Math.PI);
  near(fit.skewDeg, expectedSkew, 0.2, "affine skew");
  near(fit.rotationDeg, (Math.atan2(u.y, u.x) * 180) / Math.PI, 0.2, "affine rotation");
  assert.ok(fit.rmsPx < 0.01, `affine residual should vanish on exact data, got ${fit.rmsPx}`);
}

/* -------------------------------------------- */
/*  Scale conversions                           */
/* -------------------------------------------- */

{
  // Axis-aligned scale bar: 210 px across 70 px cells = 3 cells; 30 units → 10/cell.
  near(feetPerSquare({ dx: 210, dy: 0, value: 30, sizeX: 70, sizeY: 70 }), 10, 1e-9, "scale bar axis-aligned");
  // Off-axis on an anisotropic map: 2 cells in x, 2 in y → hypot(2,2) cells.
  const raw = feetPerSquare({ dx: 120, dy: 160, value: 20 * Math.SQRT2, sizeX: 60, sizeY: 80 });
  near(raw, 10, 1e-9, "scale bar off-axis");
  assert.equal(feetPerSquare({ dx: 0, dy: 0, value: 30, sizeX: 70, sizeY: 70 }), null);
}

{
  assert.ok(roundSuggestions(4.9).includes(5), "4.9 suggests 5");
  assert.ok(roundSuggestions(47).includes(50), "47 suggests 50");
  assert.ok(roundSuggestions(96).includes(100), "96 suggests 100");
  assert.deepEqual(roundSuggestions(0), []);
}

{
  // 1:1 output keeps the fitted cell; 100' boxes carrying a 5' grid re-pitch by 20.
  const oneToOne = outputGridSize({ fittedCellPx: 70, mapCellFeet: 5, outputFeet: 5 });
  near(oneToOne.px, 70, 1e-9, "1:1 output px");
  assert.equal(oneToOne.aligned, true);
  const rePitched = outputGridSize({ fittedCellPx: 400, mapCellFeet: 100, outputFeet: 5 });
  near(rePitched.px, 20, 1e-9, "re-pitched output px");
  assert.equal(rePitched.aligned, true);
  assert.equal(outputGridSize({ fittedCellPx: 70, mapCellFeet: 5, outputFeet: 7.5 }).aligned, false);
}

{
  // A box the GM says spans three cells measures a THIRD of itself. Dragging
  // across a run is both easier to aim and a better measurement than pinching
  // one cell, and it is only better if the count is believed.
  const s = 64;
  const fit = fitGrid({ squares: [{ x: 10, y: 20, w: 3 * s, h: 3 * s, across: 3, down: 3 }], corners: [] });
  assert.equal(fit.ok, true);
  near(fit.sizeX, s, 1e-6, "three-cell box");
  // An absent or nonsense count is one cell, never zero: a divide by it would
  // hand the apply an infinity that Foundry drops in silence.
  for (const axis of ["x", "y"]) {
    assert.equal(boxSpan({}, axis), 1);
    assert.equal(boxSpan(undefined, axis), 1);
  }
  assert.equal(boxSpan({ across: 0, down: 0 }, "x"), 1);
  assert.equal(boxSpan({ across: 0, down: 0 }, "y"), 1);
  assert.equal(boxSpan({ across: -2, down: -2 }, "x"), 1);
  assert.equal(boxSpan({ across: -2, down: -2 }, "y"), 1);
  // The two axes carry their own counts.
  assert.equal(boxSpan({ across: 3 }, "x"), 3);
  assert.equal(boxSpan({ across: 3 }, "y"), 1);
  assert.equal(boxSpan({ down: 4 }, "y"), 4);
  assert.equal(boxSpan({ down: 4 }, "x"), 1);
}

{
  // A strip three cells across and one down reads one cell from each axis of
  // itself: width / 3 and height / 1. With one count for both axes the same
  // strip read a third of a cell tall.
  const s = 64;
  // On the strips' lattice: 10 + 6 cells, 20 + 4 cells.
  const single = { x: 10 + 6 * s, y: 20 + 4 * s, w: s, h: s };
  for (const mode of ["square", "rect"]) {
    const across = fitGrid({ squares: [{ x: 10, y: 20, w: 3 * s, h: s, across: 3 }, single], corners: [], mode });
    assert.equal(across.ok, true, `${mode}: 3x1 strip fits`);
    near(across.sizeX, s, 1e-6, `${mode}: 3x1 strip, X`);
    near(across.sizeY, s, 1e-6, `${mode}: 3x1 strip, Y`);
    assert.equal(across.confidence, "tight", `${mode}: 3x1 strip reads tight`);

    const down = fitGrid({ squares: [{ x: 10, y: 20, w: s, h: 3 * s, down: 3 }, single], corners: [], mode });
    assert.equal(down.ok, true, `${mode}: 1x3 strip fits`);
    near(down.sizeX, s, 1e-6, `${mode}: 1x3 strip, X`);
    near(down.sizeY, s, 1e-6, `${mode}: 1x3 strip, Y`);
    assert.equal(down.confidence, "tight", `${mode}: 1x3 strip reads tight`);

    const block = fitGrid({ squares: [{ x: 10, y: 20, w: 2 * s, h: 2 * s, across: 2, down: 2 }], corners: [], mode });
    assert.equal(block.ok, true, `${mode}: 2x2 block fits`);
    near(block.sizeX, s, 1e-6, `${mode}: 2x2 block, X`);
    near(block.sizeY, s, 1e-6, `${mode}: 2x2 block, Y`);
    assert.equal(block.confidence, "tight", `${mode}: 2x2 block reads tight`);
  }
  // Each axis divides by its own count even where the cells are not square.
  const wide = fitGrid({ squares: [{ x: 10, y: 20, w: 3 * 80, h: 2 * 50, across: 3, down: 2 }], corners: [], mode: "rect" });
  near(wide.sizeX, 80, 1e-6, "rect: 3x2 box, X");
  near(wide.sizeY, 50, 1e-6, "rect: 3x2 box, Y");
}

/* -------------------------------------------- */
/*  Scale only — the ruler without a grid       */
/* -------------------------------------------- */

{
  near(pixelsPerUnit({ dx: 258, dy: 0, value: 400 }), 0.645, 1e-9, "px per unit");
  near(pixelsPerUnit({ dx: 30, dy: 40, value: 10 }), 5, 1e-9, "px per unit off-axis");
  assert.equal(pixelsPerUnit({ dx: 0, dy: 0, value: 400 }), null);
  assert.equal(pixelsPerUnit({ dx: 258, dy: 0, value: 0 }), null);
}

{
  // Inside Foundry's bounds the asked-for distance is kept exactly.
  const easy = scaleOnlyGrid({ pxPerUnit: 2, distance: 50, minSize: 50, maxSize: 300 });
  assert.deepEqual(easy, { size: 100, distance: 50, clamped: false });

  // Outside them the SIZE is clamped and the distance solves back, because the
  // pair is one ratio and the ratio is what the ruler reads. A clamp that kept
  // the round number instead would silently measure wrong.
  const tiny = scaleOnlyGrid({ pxPerUnit: 0.1, distance: 100, minSize: 50, maxSize: 300 });
  assert.equal(tiny.size, 50);
  assert.equal(tiny.clamped, true);
  near(tiny.size / tiny.distance, 0.1, 1e-9, "clamped-small ratio preserved");

  const huge = scaleOnlyGrid({ pxPerUnit: 10, distance: 100, minSize: 50, maxSize: 300 });
  assert.equal(huge.size, 300);
  assert.equal(huge.clamped, true);
  near(huge.size / huge.distance, 10, 1e-9, "clamped-large ratio preserved");

  assert.equal(scaleOnlyGrid({ pxPerUnit: 0, distance: 50 }), null);
  assert.equal(scaleOnlyGrid({ pxPerUnit: 2, distance: 0 }), null);
}

/* -------------------------------------------- */
/*  Hex sizing                                  */
/* -------------------------------------------- */

{
  // The reference box stands in for what a scene clone reports; the solver
  // only ever SCALES it, so no hex ratio is stated here or anywhere else.
  const ref = { refW: 100, refH: 115.47, refSize: 100 };
  near(hexSizeFromBox({ boxW: 200, boxH: 230.94, ...ref }), 200, 1e-6, "hex size from an exact box");
  // A box drawn a little tall lands BETWEEN the two readings, not on the
  // taller one: both axes vote.
  const sloppy = hexSizeFromBox({ boxW: 200, boxH: 242.49, ...ref });
  assert.ok(sloppy > 200 && sloppy < 210, `sloppy box averages, got ${sloppy}`);
  assert.equal(hexSizeFromBox({ boxW: 0, boxH: 0, ...ref }), null);
  assert.equal(hexSizeFromBox({ boxW: 200, boxH: 230, refW: 0, refH: 0, refSize: 100 }), null);
}

/* -------------------------------------------- */
/*  Shift solving                               */
/* -------------------------------------------- */

{
  // The shift lands a drawn line on a grid line: with the scene rect at
  // canvas 0 and a phase of 17 image px at 1:1, shifting by 17 puts the
  // lattice on the grid.
  assert.equal(solveShift({ origin: 0, phase: 17, factor: 1, gridSize: 64 }), 17);
  // Past the half-cell it wraps negative — the map moves as little as possible.
  assert.equal(solveShift({ origin: 0, phase: 50, factor: 1, gridSize: 64 }), -14);
  // Padding origin is carried, and a phase of a whole cell is no shift at all.
  assert.equal(solveShift({ origin: 128, phase: 64, factor: 1, gridSize: 64 }), 0);
  // Scaling factor applies to the phase, not the origin.
  assert.equal(solveShift({ origin: 0, phase: 10, factor: 2, gridSize: 64 }), 20);
  // Round-trip: origin − shift + phase·factor must be a whole cell count.
  for (const [origin, phase, factor, G] of [
    [0, 17, 1, 64],
    [140, 33.7, 0.5, 100],
    [77, 5, 2.25, 50],
  ]) {
    const s = solveShift({ origin, phase, factor, gridSize: G });
    const landing = origin - s + phase * factor;
    near(Math.abs(landing / G - Math.round(landing / G)) * G, 0, 0.5, "line lands on the grid");
  }
}

{
  // A non-finite input NEVER produces NaN: Foundry serializes NaN to null and
  // drops the whole scene update silently, so the solver refuses instead.
  assert.equal(solveShift({ origin: undefined, phase: 17, factor: 1, gridSize: 64 }), null);
  assert.equal(solveShift({ origin: NaN, phase: 17, factor: 1, gridSize: 64 }), null);
  assert.equal(solveShift({ origin: 0, phase: undefined, factor: 1, gridSize: 64 }), null);
  assert.equal(solveShift({ origin: 0, phase: 17, factor: Infinity, gridSize: 64 }), null);
  assert.equal(solveShift({ origin: 0, phase: 17, factor: 1, gridSize: 0 }), null);
}

/* -------------------------------------------- */
/*  Footprints                                  */
/* -------------------------------------------- */

{
  // The frontage cells and the square are invented here, in shapes the
  // readers take: a pair with its mirror, a lone figure, a fraction, a cell
  // with no figure, and a square of 4 feet. A `feet` of null imports no square.
  const SQUARE = 4;
  const frontage = (cells, priority = PRIORITY.WORLD, feet = SQUARE) => registerTable(
    {
      id: SIZE_DOC,
      source: { pages: "XX 1" },
      tables: {
        [SIZE_TABLE]: { [SIZE_ROW]: cells },
        ...(feet === null ? {} : { [SQUARE_TABLE]: { [SIZE_ROW]: { feet } } }),
      },
    },
    { priority },
  );
  const CELLS = {
    small: "1 sq",
    man: "1/4 sq",
    large: "7 × 3 / 3 × 7",
    huge: "9 x 9",
    gigantic: "n/a",
  };

  // Nothing imported: a size category has no footprint, and says so with null.
  resetTables();
  assert.equal(sizeSquares("large"), null, "no document, no squares");
  assert.equal(sizeSquareFeet(), null, "no document, no square");
  assert.equal(footprintFeet({ sizeKey: "large", feetPerSquare: 4 }), null, "no frontage imported: no footprint");
  assert.equal(sizeCite(), null, "and no page to cite");
  // Override wins outright; a token with no size category is one square.
  assert.deepEqual(footprintFeet({ override: { w: 12, h: 8 } }), { w: 12, h: 8 });
  assert.deepEqual(footprintFeet({ override: { w: 12, h: 8 }, sizeKey: "large" }), { w: 12, h: 8 }, "an override needs no table");
  assert.deepEqual(footprintFeet({ feetPerSquare: 4 }), { w: 4, h: 4 });
  // No square, no footprint: nothing stands in for it, whatever the category.
  assert.equal(footprintFeet(), null, "no square and no override: no footprint");
  assert.equal(footprintFeet({ sizeKey: "large" }), null, "a category with no square has no footprint");
  assert.equal(footprintFeet({ feetPerSquare: null }), null, "a null square is no square");
  assert.equal(footprintFeet({ feetPerSquare: 0, sizeKey: "large" }), null, "a zero square is no square");
  assert.deepEqual(footprintFeet({ override: { w: 12, h: 8 }, feetPerSquare: null }), { w: 12, h: 8 }, "an override needs no square either");

  // Imported: the first printed arrangement, in squares, times what a square is worth.
  frontage(CELLS);
  assert.deepEqual(sizeSquares("large"), { w: 7, h: 3 });
  assert.equal(sizeSquareFeet(), SQUARE, "the square is the imported row's figure");
  assert.deepEqual(footprintFeet({ sizeKey: "large", feetPerSquare: SQUARE }), { w: 28, h: 12 });
  assert.deepEqual(footprintFeet({ sizeKey: "huge", feetPerSquare: 6 }), { w: 54, h: 54 }, "a lone figure fills both sides");
  // A body never occupies less than one token square.
  assert.deepEqual(sizeSquares("small"), { w: 1, h: 1 });
  assert.deepEqual(sizeSquares("man"), { w: 1, h: 1 }, "a fraction of a square reads as one");
  // A cell holding no figure, a category the row lacks, and a name that is no category.
  assert.equal(sizeSquares("gigantic"), null, "a cell with no figure");
  assert.equal(sizeSquares("colossal"), null, "a category the row does not carry");
  assert.equal(sizeSquares("constructor"), null, "an inherited name is no category");
  assert.equal(footprintFeet({ sizeKey: "nonsense", feetPerSquare: SQUARE }), null, "an unknown category has no footprint");
  assert.equal(sizeCite(), "XX 1", "the cite is the page the import recorded");

  // A row the import could not read is not a row; nor is a figure that is no number.
  registerTable({ id: SIZE_DOC, tables: { [SIZE_TABLE]: { [SIZE_ROW]: { __missing: true } }, [SQUARE_TABLE]: { [SIZE_ROW]: { __missing: true } } } }, { priority: PRIORITY.WORLD });
  assert.equal(sizeSquares("large"), null, "a missing-row placeholder answers nothing");
  assert.equal(sizeSquareFeet(), null, "a missing square row answers nothing");
  for (const feet of [0, -4, "n/a"]) {
    frontage(CELLS, PRIORITY.WORLD, feet);
    assert.equal(sizeSquareFeet(), null, `a square of ${String(feet)} is no square`);
  }
  frontage(CELLS, PRIORITY.WORLD, null);
  assert.equal(sizeSquareFeet(), null, "a document holding frontage and no square has none");

  // A Judge's override of one cell wins over the import and is the printed shape.
  frontage(CELLS);
  frontage({ ...CELLS, large: "2 x 5" }, PRIORITY.OVERRIDE, 6);
  assert.deepEqual(sizeSquares("large"), { w: 2, h: 5 }, "the override layer wins");
  assert.equal(sizeSquareFeet(), 6, "and so does an override of the square");
  assert.equal(sizeCite(), null, "an override has no page");
  unregisterTable(SIZE_DOC, { priority: PRIORITY.OVERRIDE });
  assert.deepEqual(sizeSquares("large"), { w: 7, h: 3 }, "and reverts");
  assert.equal(sizeSquareFeet(), SQUARE, "the square reverts with it");

  assert.equal(parseFrontage(""), null);
  assert.equal(parseFrontage(null), null);
  assert.deepEqual(parseFrontage("4 × 3 or 3 × 4 squares"), { w: 4, h: 3 });
  assert.deepEqual(parseFrontage("0 × 0"), { w: 1, h: 1 }, "no side is under one square");

  // The tokens the scene would resize and the ones its table cannot: a token
  // with a category the table lacks keeps its size and is counted; a token
  // with no category, a locked one and a marker are not.
  const { sizeForToken, unsizedTokenCount, rescaleSceneTokens, resetSelectedFootprints, installTokenAutoScale } = await import("../scripts/battlemap/token-scale.mjs");
  const scene = { grid: { distance: SQUARE, units: "ft" } };
  const tokenOf = (sizeKey, { locked = false, type = "monster" } = {}) => ({
    getFlag: (_ns, key) => (key === "footprintLock" ? locked || undefined : key === "extras" ? (sizeKey ? { size: sizeKey } : undefined) : undefined),
    actor: { documentName: "Actor", type, getFlag: (_ns, key) => (key === "extras" ? (sizeKey ? { size: sizeKey } : undefined) : undefined) },
  });
  scene.tokens = [tokenOf("large"), tokenOf("gigantic"), tokenOf("colossal"), tokenOf(null), tokenOf("colossal", { locked: true }), tokenOf("colossal", { type: "acks-extras.domain" })];
  assert.deepEqual(sizeForToken(scene.tokens[0], scene), { width: 7, height: 3 }, "a category with a cell is sized");
  assert.equal(sizeForToken(scene.tokens[2], scene), null, "a category without one is left alone");
  assert.deepEqual(sizeForToken(scene.tokens[3], scene), { width: 1, height: 1 }, "a token with no category is one square");
  assert.equal(unsizedTokenCount(scene), 2, "two sized creatures have no footprint");
  // The frontage imported without the square sizes nothing; the square without
  // the frontage sizes only a token with no category.
  frontage(CELLS, PRIORITY.WORLD, null);
  assert.equal(sizeForToken(scene.tokens[0], scene), null, "no square: a categorised token keeps its size");
  assert.equal(sizeForToken(scene.tokens[3], scene), null, "no square: a token with no category keeps its size too");
  assert.equal(unsizedTokenCount(scene), 4, "with no square every token that is ours is unsized");
  resetTables(); // the square alone, below
  registerTable({ id: SIZE_DOC, tables: { [SQUARE_TABLE]: { [SIZE_ROW]: { feet: SQUARE } } } }, { priority: PRIORITY.WORLD });
  assert.equal(sizeForToken(scene.tokens[0], scene), null, "no frontage: a categorised token keeps its size");
  assert.deepEqual(sizeForToken(scene.tokens[3], scene), { width: 1, height: 1 });
  resetTables();
  assert.equal(unsizedTokenCount(scene), 4, "with nothing imported, every token that is ours is unsized");
  assert.equal(unsizedTokenCount(null), 0);

  // A write is counted against what a token STORES. Core's token animation
  // merges its frames into the document, so the prepared width is the tween's
  // start right after an update (and stays there while the ticker is frozen):
  // it can read the old size while `_source` already holds the new one, and the
  // reverse. The square alone is imported, so every token here is one square
  // and a cell worth two squares makes the target half a cell.
  resetTables();
  registerTable({ id: SIZE_DOC, tables: { [SQUARE_TABLE]: { [SIZE_ROW]: { feet: SQUARE } } } }, { priority: PRIORITY.WORLD });
  const half = { grid: { distance: SQUARE * 2, units: "ft" }, getFlag: () => ({ autoScale: true }) };
  const written = [];
  const stored = (id, prepared, source, extra = {}) => ({
    ...tokenOf(null),
    id,
    parent: half,
    width: prepared,
    height: prepared,
    ...(source === null ? {} : { _source: { width: source, height: source } }),
    update: async (data) => written.push({ id, data }),
    updateSource: (data) => written.push({ id, source: data }),
    ...extra,
  });
  const staleAtOne = stored("stale", 1, 0.5); // the document reads 1, the stored size is already right
  const staleAtHalf = stored("fresh", 0.5, 1); // the document reads right, the stored size is not
  const plain = stored("plain", 1, null); // no `_source`: the document is read as it stands
  assert.deepEqual(sizeForToken(staleAtOne, half), { width: 0.5, height: 0.5 }, "the target is half a cell");

  const resized = [];
  half.tokens = [staleAtOne, staleAtHalf, plain];
  half.updateEmbeddedDocuments = async (_name, updates) => resized.push(...updates);
  assert.equal(await rescaleSceneTokens(half), 2, "a token whose stored size is right is not counted");
  assert.deepEqual(resized.map((u) => u._id), ["fresh", "plain"], "and the one whose prepared width looked right is written");

  const savedGlobals = { canvas: globalThis.canvas, foundry: globalThis.foundry, game: globalThis.game, Hooks: globalThis.Hooks };
  try {
    globalThis.foundry = { data: { operators: { ForcedDeletion: class {} } } };
    globalThis.canvas = { tokens: { controlled: [staleAtOne, staleAtHalf, plain].map((t) => ({ document: t })) } };
    written.length = 0;
    assert.equal(await resetSelectedFootprints(), 3, "reset reports the tokens it handled");
    const sizeWrites = written.filter((w) => w.data && "width" in w.data).map((w) => w.id);
    assert.deepEqual(sizeWrites, ["fresh", "plain"], "reset writes a size only where the stored one differs");

    const hooks = {};
    globalThis.Hooks = { on: (name, fn) => (hooks[name] = fn) };
    globalThis.game = { userId: "u1" };
    installTokenAutoScale();
    written.length = 0;
    for (const doc of [staleAtOne, staleAtHalf]) hooks.preCreateToken(doc, {}, {}, "u1");
    assert.deepEqual(written.map((w) => w.id), ["fresh"], "preCreateToken writes a size only where `_source` differs");
  } finally {
    Object.assign(globalThis, savedGlobals);
    for (const key of Object.keys(savedGlobals)) if (savedGlobals[key] === undefined) delete globalThis[key];
  }
  resetTables();
}

/* --- the not-to-scale predicate ---------------------------------------------
   A drawn size is off when it differs from the exact one by MORE than half the
   step the sizer rounds to, and the sizer's floor is never consulted. */
{
  const exact = { feet: { w: 5, h: 5 }, feetPerCell: 5 }; // exactly one cell
  const off = (width, height, extra = {}) => scaleMismatch({ ...exact, width, height, ...extra });
  assert.equal(off(1, 1), null, "an exact fit is not off");
  assert.equal(off(1.125, 1.125), null, "half a step over is on the line, and the line is not off");
  assert.equal(off(0.875, 0.875), null, "half a step under likewise");
  assert.deepEqual(off(1.25, 1.25), { dir: "larger", exact: { w: 1, h: 1 } }, "past half a step is off");
  assert.equal(off(0.75, 0.75).dir, "smaller");
  assert.equal(off(1.25, 0.75).dir, "mixed", "larger on one axis and smaller on the other");
  assert.equal(off(1.25, 1).dir, "larger", "one axis alone is enough");
  assert.equal(off(1, 0.5).dir, "smaller", "the other axis alone is enough");
  assert.equal(off(1.2, 1, { step: 0.5 }), null, "the tolerance follows the step it is given");
  assert.equal(off(1.3, 1, { step: 0.5 }).dir, "larger");
  assert.deepEqual(scaleMismatch({ feet: { w: 12, h: 5 }, feetPerCell: 5, width: 1, height: 1 }).exact, { w: 2.4, h: 1 }, "the exact size is not rounded");
  assert.equal(scaleMismatch({ feet: { w: 2.5, h: 2.5 }, feetPerCell: 5, width: 0.5, height: 0.5 }), null, "a half-cell footprint drawn at half a cell");
  assert.equal(scaleMismatch({ feet: { w: 2.5, h: 2.5 }, feetPerCell: 5, width: 1, height: 1 }).dir, "larger", "and the same drawn at a cell");

  // A 5-foot man on a 31680-foot cell: the sizer would floor him at a quarter
  // cell, so only the unrounded exact size calls him off.
  const man = { feet: { w: 5, h: 5 }, feetPerCell: 31680 };
  assert.equal(scaleMismatch({ ...man, width: 1, height: 1 }).dir, "larger", "a man a cell wide is off");
  assert.equal(scaleMismatch({ ...man, width: SPAN_MIN, height: SPAN_MIN }).dir, "larger", "and so is the floored man the sizer writes");
  assert.equal(tokenSpan(5, 31680), SPAN_MIN, "the floor is what the sizer would say");

  // Nothing to compare: no footprint, no usable cell, no stored size.
  for (const bad of [{ feet: null }, { feet: { w: 0, h: 5 } }, { feet: { w: 5, h: -1 } }, { feetPerCell: 0 }, { feetPerCell: NaN }, { width: undefined }, { height: NaN }]) {
    assert.equal(off(5, 5, bad), null, `no verdict for ${JSON.stringify(bad)}`);
  }
  assert.equal(scaleMismatch(), null, "no input at all");
}

/* --- the footprint a token is judged by ----------------------------------------
   Four sources over an invented square and frontage; the party token, a
   marker's token and a scene with no distance are not judged at all. */
{
  const { footprintOf, sizeForToken, unsizedTokenCount } = await import("../scripts/battlemap/token-scale.mjs");
  const SQ = 7;
  const grid = { grid: { distance: 7, units: "ft" } };
  const tokenFor = ({ token = {}, actor = {}, sizeKey = null, type = "monster", locked = false, party = false } = {}) => ({
    getFlag: (_ns, key) => (key === "footprintLock" ? locked || undefined : key === "formationId" ? party || undefined : token[key]),
    actor: { documentName: "Actor", type, getFlag: (_ns, key) => (key === "extras" ? (sizeKey ? { size: sizeKey } : undefined) : actor[key]) },
  });
  resetTables();
  registerTable({ id: SIZE_DOC, source: { pages: "XX 9" }, tables: { [SIZE_TABLE]: { [SIZE_ROW]: { large: "5 × 2" } }, [SQUARE_TABLE]: { [SIZE_ROW]: { feet: SQ } } } }, { priority: PRIORITY.WORLD });

  const fp = footprintOf(tokenFor({ sizeKey: "large" }), grid);
  assert.deepEqual(fp, { judged: true, feet: { w: 35, h: 14 }, feetPerCell: 7, source: "size", sizeKey: "large" }, "a category over the imported square");
  assert.deepEqual(footprintOf(tokenFor(), grid), { judged: true, feet: { w: 7, h: 7 }, feetPerCell: 7, source: "square", sizeKey: null }, "the imported square alone");
  assert.equal(footprintOf(tokenFor({ actor: { footprint: { w: 9, h: 3 } }, sizeKey: "large" }), grid).source, "actor", "the actor's flag over its category");
  const both = footprintOf(tokenFor({ token: { footprint: { w: 12, h: 6 } }, actor: { footprint: { w: 9, h: 3 } } }), grid);
  assert.deepEqual([both.source, both.feet], ["token", { w: 12, h: 6 }], "the token's flag over the actor's");
  const unusable = footprintOf(tokenFor({ token: { footprint: { w: 0, h: 6 } }, actor: { footprint: { w: 9, h: 3 } }, sizeKey: "large" }), grid);
  assert.equal(unusable.source, "size", "an unusable token flag shadows the actor's and is no override");
  assert.equal(footprintOf(tokenFor({ sizeKey: "large" }), { grid: { distance: 1, units: "mi" } }).feetPerCell, 5280, "the cell is read through its units");

  // Not judged: no body, the Judge's own size, no scale to compare against.
  const unjudged = { judged: false, feet: null, feetPerCell: 0, source: null, sizeKey: null };
  assert.deepEqual(footprintOf(tokenFor({ party: true }), grid), unjudged, "the party token");
  assert.deepEqual(footprintOf(tokenFor({ type: "acks-extras.party" }), grid), unjudged, "a party actor's token with no formation flag (its shadow)");
  assert.deepEqual(footprintOf(tokenFor({ type: "acks-extras.domain" }), grid), unjudged, "a marker's token");
  assert.deepEqual(footprintOf(tokenFor(), { grid: { distance: 0, units: "ft" } }), unjudged, "a scene with no usable distance");
  assert.deepEqual(footprintOf(tokenFor(), {}), unjudged, "a scene with no grid");
  assert.deepEqual(footprintOf(null, grid), unjudged, "no token");
  // A locked token is judged: the lock stops writes, and the mark writes nothing.
  assert.equal(footprintOf(tokenFor({ locked: true, sizeKey: "large" }), grid).judged, true, "a locked token is judged");
  assert.equal(sizeForToken(tokenFor({ locked: true, sizeKey: "large" }), grid), null, "and still not ours to size");

  // Nothing imported: judged, with no figure, and so no mark to be had.
  resetTables();
  assert.deepEqual(footprintOf(tokenFor({ sizeKey: "large" }), grid), { judged: true, feet: null, feetPerCell: 7, source: null, sizeKey: "large" });
  assert.deepEqual(footprintOf(tokenFor({ token: { footprint: { w: 12, h: 6 } } }), grid).source, "token", "a flag needs no import");

  // The sizer answers as it did.
  registerTable({ id: SIZE_DOC, tables: { [SIZE_TABLE]: { [SIZE_ROW]: { large: "5 × 2" } }, [SQUARE_TABLE]: { [SIZE_ROW]: { feet: SQ } } } }, { priority: PRIORITY.WORLD });
  assert.deepEqual(sizeForToken(tokenFor({ sizeKey: "large" }), grid), { width: 5, height: 2 });
  assert.deepEqual(sizeForToken(tokenFor(), { grid: { distance: 1, units: "mi" } }), { width: SPAN_MIN, height: SPAN_MIN }, "a man at a mile a cell is floored");
  assert.equal(sizeForToken(tokenFor({ party: true }), grid), null);
  assert.equal(unsizedTokenCount({ ...grid, tokens: [tokenFor({ sizeKey: "colossal" }), tokenFor({ locked: true, sizeKey: "colossal" }), tokenFor({ party: true }), tokenFor({ type: "acks-extras.domain" }), tokenFor()] }), 1, "only a judged, unlocked token with no figure is counted");
  resetTables();
}

/* --- the mark: its listener, its key and its readout -------------------------
   A fake PIXI records what is drawn; nothing here has a canvas. */
{
  const { refreshMark, onRefreshToken, onHover, carriesScaleFlag, markKey, markOf, handleAnchor, readoutLines, registerScaleMarkSetting, SCALE_MARK_NAME, SETTING_SCALE_MARK } = await import("../scripts/battlemap/scale-mark.mjs");
  assert.equal(SCALE_MARK_NAME, "acks-extras-scale-mark", "the name a page script finds the mark by");

  for (const flag of ["redraw", "refreshSize", "refreshShape", "refreshState", "refreshVisibility"]) {
    assert.equal(carriesScaleFlag({ [flag]: true }), true, `${flag} is answered`);
  }
  for (const flags of [{ refreshPosition: true }, { refreshElevation: true, refreshBorder: true }, {}, undefined]) {
    assert.equal(carriesScaleFlag(flags), false, `${JSON.stringify(flags)} is not`);
  }

  const verdict = { dir: "larger", exact: { w: 0.5, h: 0.5 } };
  const base = { w: 100, h: 100, shape: 0, verdict, ui: 1 };
  assert.equal(markKey(base), markKey({ ...base }), "the key is stable");
  for (const change of [{ w: 101 }, { h: 99 }, { shape: 1 }, { ui: 2 }, { verdict: { ...verdict, dir: "smaller" } }, { verdict: { ...verdict, exact: { w: 0.5, h: 0.75 } } }]) {
    assert.notEqual(markKey({ ...base, ...change }), markKey(base), `the key moves with ${Object.keys(change)[0]}`);
  }

  assert.deepEqual(handleAnchor({ x: 0, y: 0, width: 100, height: 50 }), { x: 100, y: 50 }, "a rectangle's corner");
  assert.deepEqual(handleAnchor({ points: [0, 0, 100, 10, 90, 80, 5, 70] }), { x: 90, y: 80 }, "a polygon's furthest vertex");
  assert.ok(Math.abs(handleAnchor({ x: 50, y: 50, radius: 50 }).x - (50 + 50 * Math.SQRT1_2)) < 1e-9, "a circle's 45-degree point");
  assert.ok(Math.abs(handleAnchor({ x: 50, y: 25, width: 50, height: 25, type: 3 }).y - (25 + 25 * Math.SQRT1_2)) < 1e-9, "an ellipse's");

  class Gfx {
    clears = 0;
    children = [];
    parent = null;
    destroyed = false;
    clear() { this.clears++; return this; }
    lineStyle() { return this; }
    drawShape() { return this; }
    moveTo() { return this; }
    lineTo() { return this; }
    addChild(child) { child.parent = this; this.children.push(child); return child; }
    destroy() {
      this.destroyed = true;
      const siblings = this.parent?.children;
      if (siblings?.includes(this)) siblings.splice(siblings.indexOf(this), 1);
    }
  }
  class Label extends Gfx {
    anchor = { set() {} };
    position = { set: (x, y) => { this.at = { x, y }; } };
    constructor(text) { super(); this.text = text; }
  }
  const settings = { [SETTING_SCALE_MARK]: true };
  const scene = { id: "s1", grid: { distance: 6, units: "mi" } };
  const registered = [];
  const saved = { PIXI: globalThis.PIXI, canvas: globalThis.canvas, game: globalThis.game, CONFIG: globalThis.CONFIG };
  const tokenOf = ({ flags = {}, actorFlags = {}, size = 1, type = "monster", owner = false } = {}) => {
    const doc = {
      id: "t1",
      parent: scene,
      shape: 0,
      width: size,
      height: size,
      _source: { width: size, height: size },
      isOwner: owner,
      getFlag: (_ns, key) => flags[key],
      actor: { documentName: "Actor", type, getFlag: (_ns, key) => actorFlags[key] },
    };
    const token = {
      document: doc,
      destroyed: false,
      isPreview: false,
      shape: { x: 0, y: 0, width: 100, height: 100 },
      w: 100,
      h: 100,
      nameplate: { visible: true, y: 104, height: 20 },
      children: [{ name: "border" }],
      addChildAt(child, i) { child.parent = this; this.children.splice(i, 0, child); },
    };
    return token;
  };
  try {
    globalThis.PIXI = { Graphics: Gfx, Text: Label };
    globalThis.CONFIG = { Canvas: { objectBorderThickness: 4 } };
    globalThis.canvas = { ready: true, scene, dimensions: { uiScale: 1 }, tokens: { placeables: [] } };
    globalThis.game = {
      user: { isGM: true },
      settings: { get: (_ns, key) => settings[key], register: (_ns, key, data) => registered.push({ key, data }) },
      i18n: { localize: (key) => key, format: (key, data) => `${key} ${JSON.stringify(data)}` },
    };
    resetTables();
    registerTable({ id: SIZE_DOC, source: { pages: "XX 9" }, tables: { [SIZE_TABLE]: { [SIZE_ROW]: { large: "5 × 2" } }, [SQUARE_TABLE]: { [SIZE_ROW]: { feet: 6 } } } }, { priority: PRIORITY.WORLD });

    // The setting: a client choice, on by default, gating the drawing.
    registerScaleMarkSetting();
    assert.equal(registered.length, 1);
    assert.equal(registered[0].key, SETTING_SCALE_MARK);
    assert.deepEqual([registered[0].data.scope, registered[0].data.config, registered[0].data.default, registered[0].data.type], ["client", true, true, Boolean]);

    // A man a cell wide on a six-mile cell is drawn with the mark, first among the token's children.
    const man = tokenOf();
    refreshMark(man);
    const mark = markOf(man);
    assert.ok(mark, "the mark is drawn");
    assert.equal(mark.name, SCALE_MARK_NAME);
    assert.equal(mark.eventMode, "none", "deaf to the pointer");
    assert.equal(man.children[0], mark, "behind the token's own drawing");
    assert.equal(mark.clears, 1);
    refreshMark(man);
    assert.equal(mark.clears, 1, "nothing changed, so nothing is redrawn");
    man.w = 120; // a resize tween's frame: the shape follows it, the verdict does not
    man.h = 120;
    refreshMark(man);
    assert.equal(markOf(man), mark, "the same mark");
    assert.equal(mark.clears, 2, "redrawn when its key changes");
    canvas.dimensions.uiScale = 2;
    refreshMark(man);
    assert.equal(mark.clears, 3, "and when the interface scale does");
    canvas.dimensions.uiScale = 1;
    refreshMark(man);

    // Core destroys a token's children on a redraw: the mark is drawn again.
    mark.destroy();
    refreshMark(man);
    assert.ok(markOf(man) && markOf(man) !== mark, "a destroyed mark is rebuilt");
    assert.equal(man.children.filter((c) => c.name === SCALE_MARK_NAME).length, 1, "never two");

    // The verdict reads the stored size, not the animated one: at an exact fit
    // the stored size says on-scale while the prepared width is mid-tween.
    scene.grid = { distance: 6, units: "ft" };
    man.document.width = 3;
    man.document._source = { width: 1, height: 1 };
    refreshMark(man);
    assert.equal(markOf(man), null, "an exact fit loses its mark whatever the tween reads");
    scene.grid = { distance: 6, units: "mi" };
    refreshMark(man);
    assert.ok(markOf(man), "and the mile cell brings it back");
    man.document.width = 1; // prepared width back at the stored one

    // Only a refresh carrying a size, shape, state or visibility flag is answered.
    const fresh = tokenOf();
    onRefreshToken(fresh, { refreshPosition: true });
    assert.equal(markOf(fresh), null, "a move draws nothing");
    onRefreshToken(fresh, { refreshSize: true });
    assert.ok(markOf(fresh), "a size refresh judges the token");

    // The hover readout: which way, the size drawn in the scene's units, and
    // for the Judge or the owner the footprint and where it comes from.
    const found = (token) => ({
      verdict: { dir: "larger", exact: { w: 0.0002, h: 0.0002 } },
      fp: { feet: { w: 6, h: 6 }, source: "square", sizeKey: null },
      scene,
      width: 1,
      height: 1,
      doc: token.document,
    });
    const gm = readoutLines(found(man), true);
    assert.equal(gm.length, 4);
    assert.ok(gm[0].startsWith("ACKS-BATTLEMAP.scaleMark.larger"));
    assert.ok(gm[1].includes('"w":"6","h":"6","units":"mi"'), "the drawn size is in the scene's units");
    assert.ok(gm[2].includes('"w":"6","h":"6"'));
    assert.ok(gm[3].startsWith("ACKS-BATTLEMAP.scaleMark.sourceSquare") && gm[3].includes('"feet":"6"') && gm[3].includes("XX 9"), "the imported square and its page");
    assert.equal(readoutLines(found(man), false).length, 2, "a seat that is not the Judge or the owner sees two lines");
    const sized = { ...found(man), fp: { feet: { w: 30, h: 12 }, source: "size", sizeKey: "large" } };
    const line = readoutLines(sized, true)[3];
    assert.ok(line.startsWith("ACKS-BATTLEMAP.scaleMark.sourceSize") && line.includes('"w":"5","h":"2"') && line.includes("XX 9"), "the category's frontage and the page");
    for (const source of ["token", "actor"]) {
      const l = readoutLines({ ...found(man), fp: { feet: { w: 6, h: 6 }, source, sizeKey: null } }, true)[3];
      assert.ok(l.startsWith(`ACKS-BATTLEMAP.scaleMark.source${source === "token" ? "Token" : "Actor"}`), `${source} as the source`);
    }
    registerTable({ id: SIZE_DOC, tables: { [SQUARE_TABLE]: { [SIZE_ROW]: { feet: 6 } } } }, { priority: PRIORITY.OVERRIDE });
    unregisterTable(SIZE_DOC, { priority: PRIORITY.WORLD });
    assert.ok(!readoutLines(found(man), true)[3].includes("XX 9"), "an override has no page to cite, and none is said");

    // Hover shows the lines under the nameplate and takes them away on leaving.
    onHover(man, true);
    const text = markOf(man).readout;
    assert.ok(text && text.text.split("\n").length === 4, "the Judge's hover reads four lines");
    assert.deepEqual(text.at, { x: 60, y: 126 }, "under the nameplate, centred on the token");
    game.user.isGM = false;
    onHover(man, true);
    assert.equal(markOf(man).readout.text.split("\n").length, 2, "a player who does not own it reads two");
    man.document.isOwner = true;
    onHover(man, true);
    assert.equal(markOf(man).readout.text.split("\n").length, 4, "its owner reads four");
    onHover(man, false);
    assert.equal(markOf(man).readout, null, "leaving takes the readout away");
    game.user.isGM = true;
    onHover(tokenOf(), true); // no mark: nothing to say

    // Who is never marked, and the setting.
    for (const [why, token] of [
      ["the party token", tokenOf({ flags: { formationId: "f1" } })],
      ["a marker's token", tokenOf({ type: "acks-extras.domain" })],
      ["a drag preview", Object.assign(tokenOf(), { isPreview: true })],
      ["a token of another scene", Object.assign(tokenOf(), { document: { ...tokenOf().document, parent: { ...scene, id: "s2" } } })],
    ]) {
      refreshMark(token);
      assert.equal(markOf(token), null, `${why} carries none`);
    }
    scene.grid = { distance: 0, units: "mi" };
    const noScale = tokenOf();
    refreshMark(noScale);
    assert.equal(markOf(noScale), null, "a scene with no distance has no scale to be off");
    scene.grid = { distance: 6, units: "mi" };
    const locked = tokenOf({ flags: { footprintLock: true } });
    refreshMark(locked);
    assert.ok(markOf(locked), "a locked token is judged");
    const stated = tokenOf({ flags: { footprint: { w: 31680, h: 31680 } } });
    refreshMark(stated);
    assert.equal(markOf(stated), null, "a token drawn at its footprint carries none");
    resetTables();
    refreshMark(fresh);
    assert.equal(markOf(fresh), null, "nothing imported: no figure, no mark");
    registerTable({ id: SIZE_DOC, tables: { [SQUARE_TABLE]: { [SIZE_ROW]: { feet: 6 } } } }, { priority: PRIORITY.WORLD });
    refreshMark(fresh);
    assert.ok(markOf(fresh), "and the import brings it");
    settings[SETTING_SCALE_MARK] = false;
    canvas.tokens.placeables = [fresh, man];
    registered[0].data.onChange();
    assert.deepEqual([markOf(fresh), markOf(man)], [null, null], "this seat's setting off takes every mark away");
    settings[SETTING_SCALE_MARK] = true;
    registered[0].data.onChange();
    assert.ok(markOf(fresh) && markOf(man), "and on brings them back");
  } finally {
    Object.assign(globalThis, saved);
    for (const key of Object.keys(saved)) if (saved[key] === undefined) delete globalThis[key];
    resetTables();
  }
}

{
  assert.equal(tokenSpan(5, 5), 1);
  assert.equal(tokenSpan(10, 5), 2);
  assert.equal(tokenSpan(12.5, 5), 2.5);
  assert.equal(tokenSpan(6, 5), 1.25);
  assert.equal(tokenSpan(5, 100), SPAN_MIN); // the quarter-square floor
  assert.equal(tokenSpan(0, 5), SPAN_MIN);
}

// The size table holds a label per category and no figure of the page's.
for (const [key, entry] of Object.entries(SIZES)) {
  assert.deepEqual(Object.keys(entry), ["label"], `SIZES.${key} carries only its label`);
}

/* -------------------------------------------- */
/*  Every entered value has exactly one home    */
/* -------------------------------------------- */

/**
 * Proves every `opts` slot the panel reads has a named input, and every named
 * input maps to a real slot — a static read, since neither mismatch is
 * reachable from the pure solver and both look fine in a screenshot.
 */
{
  const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
  const session = read("../scripts/battlemap/session.mjs");
  const optsLiteral = session.match(/const emptyOpts = \(\) => \(\{([^}]*)\}\)/);
  assert.ok(optsLiteral, "session.mjs still declares emptyOpts as one literal");
  const slots = [...optsLiteral[1].matchAll(/(\w+)\s*:/g)].map((m) => m[1]);
  assert.ok(slots.length >= 4, `expected the opts slots, got ${slots.join(", ")}`);

  const body = read("../templates/battlemap/assistant-body.hbs");
  const app = read("../scripts/battlemap/assistant-app.mjs");
  const inputs = new Set([...body.matchAll(/name="(\w+)"/g)].map((m) => m[1]));
  for (const slot of slots) {
    assert.ok(inputs.has(slot), `opts.${slot} has no input in the panel — nothing can set it`);
  }

  // And nothing writes a slot that does not exist: a renamed field would
  // otherwise post into an ignored key and read as "the control does nothing".
  const written = [...app.matchAll(/this\.opts\.(\w+)\s*=[^=]/g)].map((m) => m[1]);
  for (const key of written) {
    assert.ok(slots.includes(key), `a handler writes opts.${key}, which is not a slot`);
  }

  // Besides the opts slots, the form carries the session's own state: the two
  // fit toggles and the setup choices. The setup names are read off
  // `setSetup`'s own signature, so renaming one there without renaming the
  // input fails here rather than in a world.
  const setup = [...session.match(/setSetup\(\{([^}]*)\}/)[1].matchAll(/(\w+)/g)].map((m) => m[1]);
  assert.ok(setup.length >= 3, `expected the setup choices, got ${setup.join(", ")}`);
  const owned = new Set(["independentXY", "allowSkew", ...setup]);
  for (const name of inputs) {
    assert.ok(slots.includes(name) || owned.has(name), `the panel posts "${name}", which nothing reads`);
  }

  // Indexed inputs (`name="boxCells.{{index}}"`) are invisible to the scan
  // above — the dot and the interpolation are not word characters — so their
  // PREFIX is checked instead: the panel posts a group nothing expands is the
  // same silent failure in a different shape.
  for (const [, prefix] of body.matchAll(/name="(\w+)\.\{\{/g)) {
    assert.ok(app.includes(`d.${prefix}`), `the panel posts "${prefix}.*", which the submit handler never expands`);
  }
}

/* -------------------------------------------- */
/*  Every registered action has a control        */
/* -------------------------------------------- */

/**
 * Proves every registered `actions` entry has a `data-action` control, and
 * vice versa — an action with no control is dead code, and a control with no
 * action does nothing when pressed.
 */
{
  const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
  const app = read("../scripts/battlemap/assistant-app.mjs");
  const block = app.match(/\n {4}actions: \{\n([\s\S]*?)\n {4}\},/);
  assert.ok(block, "assistant-app.mjs still declares DEFAULT_OPTIONS.actions as one literal");
  const registered = [...block[1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
  assert.ok(registered.length >= 8, `expected the panel's actions, got ${registered.join(", ")}`);

  const markup = ["../templates/battlemap/assistant-body.hbs", "../templates/battlemap/assistant-foot.hbs"].map(read).join("\n");
  const used = new Set([...markup.matchAll(/data-action="(\w+)"/g)].map((m) => m[1]));
  for (const action of registered) {
    assert.ok(used.has(action), `the panel registers the action "${action}", which no control calls`);
  }
  for (const action of used) {
    assert.ok(registered.includes(action), `the panel has a control for "${action}", which is not a registered action`);
  }
}

/* -------------------------------------------- */
/*  Every gap the planner names is shown        */
/* -------------------------------------------- */

/**
 * Proves every need and warning id the planner can emit has a visible line in
 * the panel, so no disabled Apply is left unexplained: a static read, since a
 * planner id added without a line passes every pure test.
 */
{
  const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
  const planner = read("../scripts/battlemap/setup-plan.mjs");
  const app = read("../scripts/battlemap/assistant-app.mjs");
  const body = read("../templates/battlemap/assistant-body.hbs");
  const lang = JSON.parse(read("../lang/en.json"));

  const needIds = [...new Set([...planner.matchAll(/need\("(\w+)"/g)].map((m) => m[1]))];
  assert.ok(needIds.length >= 9, `expected the planner's needs, got ${needIds.join(", ")}`);
  const needLines = app.match(/#needLines\(plan\) \{([\s\S]*?)\n  \}/)[1];
  for (const id of needIds) {
    assert.ok(new RegExp(`\\n\\s+${id}: \\(`).test(needLines), `the planner's need "${id}" has no line in the panel`);
  }
  const verdicts = [...planner.match(/FAMILY_VERDICTS = new Set\(\[([^\]]*)\]/)[1].matchAll(/"(\w+)"/g)].map((m) => m[1]);
  const warnIds = [...new Set([...[...planner.matchAll(/warnings\.push\(\{ id: "(\w+)"/g)].map((m) => m[1]), ...verdicts])];
  assert.deepEqual(warnIds.sort(), ["familyAmbiguous", "familyMismatch", "looseFit", "unreachable"], "the planner's warnings");
  const warnLines = app.match(/#warningLines\(plan\) \{([\s\S]*?)\n  \}/)[1];
  for (const id of warnIds) assert.ok(warnLines.includes(`"${id}"`), `the planner's warning "${id}" has no line in the panel`);
  for (const id of ["corners", "multiHexBoxes", "scaleBarWithoutValue"]) {
    assert.ok(new RegExp(`\\n\\s+${id}: \\(`).test(app.match(/#unusedLines\(plan\) \{([\s\S]*?)\n  \}/)[1]), `the unused sample "${id}" has no line`);
  }
  for (const slot of ["needLines", "unusedLines", "warnLines"]) {
    assert.ok(body.includes(`{{#each ${slot}}}`), `the panel renders ${slot}`);
  }
  // Apply is also off where the scene already matches; that says so too.
  assert.ok(body.includes("{{#if matchesLine}}") && app.includes("plan.matches ? this.#matchesLine(scene)") && app.includes('this.#gridLine(scene, "apply.matches")'), "a matching scene's disabled Apply is explained");
  assert.ok("ACKS-BATTLEMAP.apply.matches" in lang);
  assert.ok(body.indexOf("{{#if matchesLine}}") < body.indexOf("{{#each needLines}}"), "the scene's own setup is the first thing the needs area says");

  // Every key the lines read exists, and a retired key is not left behind.
  for (const [, key] of app.matchAll(/loc\("((?:needs|unused|warn|rows|apply|setup)\.[\w.]+)"/g)) {
    assert.ok(`ACKS-BATTLEMAP.${key}` in lang, `${key} is read and not defined`);
  }
  // The keys the panel builds from a grid type, a row id or a mode are read by suffix, so each is named here.
  for (const key of [0, 1, 2, 3, 4, 5].map((t) => `rows.type.${t}`)) assert.ok(`ACKS-BATTLEMAP.${key}` in lang, `${key} is defined`);
  for (const id of ["grid", "cellWorth", "image", "tokenSizing", "travelSystem"]) assert.ok(`ACKS-BATTLEMAP.rows.label.${id}` in lang, `rows.label.${id} is defined`);
  for (const gone of ["warn.noHexBox", "warn.badSolution", "fit.none", "fit.noneScale", "apply.confirmTitle", "apply.confirmBody", "apply.confirmHex", "apply.confirmScale"]) {
    assert.ok(!(`ACKS-BATTLEMAP.${gone}` in lang), `${gone} has no reader and should be gone`);
  }
  for (const key of ["apply.confirmShift", "rows.imageStays"]) {
    const line = lang[`ACKS-BATTLEMAP.${key}`];
    assert.ok(/tokens, tiles, walls.*regions and painted hexes move with the map/.test(line) && !/stay/.test(line),
      `${key} says placed things and painted hexes move with the map`);
  }
  assert.ok(read("../scripts/battlemap/apply.mjs").includes("autoReposition: true"), "the apply asks core to move placed objects with the image");
}

/* -------------------------------------------- */
/*  hexAlignment — the lattice shift             */
/* -------------------------------------------- */

/**
 * Proves the shift is solved off a ZERO-SHIFT clone carrying the target size
 * and grid, from the centre that clone's grid names nearest the point, and that
 * a grid which cannot answer yields null rather than a shift of nothing.
 */
{
  const asked = [];
  const sceneWith = (centreOf) => ({
    clone(data, options) {
      asked.push({ data, options });
      return {
        getDimensions: () => ({ sceneX: 40, sceneY: 60 }),
        grid: centreOf ? { getCenterPoint: centreOf } : {},
      };
    },
  });
  // Invented lattice: cell centres every 100 px from the origin.
  const nearest = ({ x, y }) => ({ x: Math.round(x / 100) * 100, y: Math.round(y / 100) * 100 });

  const shift = hexAlignment(sceneWith(nearest), { width: 900, height: 700, gridSize: 100, type: 4, point: { x: 333.4, y: 471.6 } });
  assert.deepEqual(shift, { shiftX: 33, shiftY: -28 }, "the shift carries the nearest centre onto the point, rounded");
  assert.deepEqual(asked[0], {
    data: { width: 900, height: 700, shiftX: 0, shiftY: 0, "grid.size": 100, "grid.type": 4 },
    options: { keepId: true },
  }, "it asks a zero-shift clone of the target size and grid, keeping the id");

  const viaDims = hexAlignment(sceneWith(nearest), {
    width: 900, height: 700, gridSize: 100, type: 4,
    point: (dims) => ({ x: dims.sceneX + 293.4, y: dims.sceneY + 411.6 }),
  });
  assert.deepEqual(viaDims, shift, "a point measured from the picture's corner is offset by the clone's padded origin");
  assert.equal(asked.length, 2, "one clone per question, however the point is given");

  assert.equal(hexAlignment(sceneWith(null), { width: 900, height: 700, gridSize: 100, type: 4, point: { x: 1, y: 1 } }), null,
    "a clone whose grid names no centre gives no shift");
  assert.equal(hexAlignment(sceneWith(() => ({ x: NaN, y: 0 })), { width: 900, height: 700, gridSize: 100, type: 4, point: { x: 1, y: 1 } }), null,
    "nor does one that names a centre it cannot place");
}

/* -------------------------------------------- */
/*  The battlemap states no combat figure       */
/* -------------------------------------------- */

{
  // The square a footprint is worth and the assistant's chip ladders come from
  // the import and the scene; no battlemap file reads a formation constant.
  const dir = new URL("../scripts/battlemap/", import.meta.url);
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".mjs"))) {
    const source = readFileSync(new URL(name, dir), "utf8");
    assert.ok(!/trap-rules|FEET_PER_RANK/.test(source), `${name} reads the formation's square`);
  }
}

/* -------------------------------------------- */
/*  Hex lattice fit — boxes drawn on hexes       */
/* -------------------------------------------- */

/**
 * A stand-in for core 14's hexagonal grid at `size`, ported from its
 * `getCenterPoint` and `getVertices` (and the 2/√3 on one axis of `sizeX` /
 * `sizeY`). The geometry is written here and only here: the shipped code asks
 * a clone for it.
 */
function coreHexGrid({ columns, even, size = 100 }) {
  const sizeX = columns ? (size * 2) / Math.sqrt(3) : size;
  const sizeY = columns ? size : (size * 2) / Math.sqrt(3);
  const qx = sizeX / 4;
  const qy = sizeY / 4;
  return {
    sizeX,
    sizeY,
    getCenterPoint({ i, j }) {
      if (columns) return { x: (2 / Math.sqrt(3)) * ((0.75 * j + 0.5) * size), y: (i + (even === ((j + 1) % 2 === 0) ? 0 : 0.5)) * size };
      return { x: (j + (even === ((i + 1) % 2 === 0) ? 0 : 0.5)) * size, y: (2 / Math.sqrt(3)) * ((0.75 * i + 0.5) * size) };
    },
    getVertices({ i, j }) {
      if (columns) {
        const x = 3 * j;
        const y = 4 * i - (even === ((j + 1) % 2 === 0) ? 2 : 0);
        return [{ x: x * qx, y: (y + 2) * qy }, { x: (x + 1) * qx, y: y * qy }, { x: (x + 3) * qx, y: y * qy }, { x: (x + 4) * qx, y: (y + 2) * qy }, { x: (x + 3) * qx, y: (y + 4) * qy }, { x: (x + 1) * qx, y: (y + 4) * qy }];
      }
      const y = 3 * i;
      const x = 4 * j - (even === ((i + 1) % 2 === 0) ? 2 : 0);
      return [{ x: (x + 2) * qx, y: y * qy }, { x: (x + 4) * qx, y: (y + 1) * qy }, { x: (x + 4) * qx, y: (y + 3) * qy }, { x: (x + 2) * qx, y: (y + 4) * qy }, { x: x * qx, y: (y + 3) * qy }, { x: x * qx, y: (y + 1) * qy }];
    },
  };
}

/** A scene whose clone carries the grid of whatever type it is asked for. */
const hexScene = (patch = {}) => ({
  clone(data) {
    const type = data["grid.type"];
    return { grid: { type, ...coreHexGrid({ columns: type === 4 || type === 5, even: type === 3 || type === 5 }), ...patch } };
  },
});

/** Deterministic PRNG (mulberry32): the noise below is the same on every run. */
function seeded(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The four hex types, each as the probe the module would ask for it.
const HEX_TYPES_UNDER_TEST = [
  { name: "pointy rows, odd", family: "hexRows", even: false, columns: false },
  { name: "pointy rows, even", family: "hexRows", even: true, columns: false },
  { name: "flat columns, odd", family: "hexCols", even: false, columns: true },
  { name: "flat columns, even", family: "hexCols", even: true, columns: true },
].map((t) => ({ ...t, grid: coreHexGrid(t), probe: hexProbe(hexScene(), t.family, t.even) }));
const otherOf = (t) => HEX_TYPES_UNDER_TEST.find((o) => o.columns !== t.columns && !o.even);

// How a map's image sits on the canvas: `k` is image px per probe px, `scale`
// canvas px per image px. The stretched one is the reported case: a square
// picture drawn over a 4:3 scene, where an exact one-hex box measures
// 30.7 x 47.3 image px (pointy rows) and is a regular hex on screen.
const ROWS_PROBE = HEX_TYPES_UNDER_TEST[0].probe;
const IMAGES = {
  large: { k: { x: 1.5, y: 1.5 }, scale: { x: 1, y: 1 } },
  stretched: { k: { x: 30.7 / ROWS_PROBE.refW, y: 47.3 / ROWS_PROBE.refH }, scale: { x: 4 / 3, y: 1 } },
};
const ORIGIN = { x: 217.3, y: 91.1 };

/** The exact box around the hex at offset (i, j), in image px. */
const hexBox = (t, image, i, j) => {
  const c = t.grid.getCenterPoint({ i, j });
  const w = t.probe.refW * image.k.x;
  const h = t.probe.refH * image.k.y;
  return { x: ORIGIN.x + c.x * image.k.x - w / 2, y: ORIGIN.y + c.y * image.k.y - h / 2, w, h };
};
const boxesAt = (t, image, cells) => cells.map(([i, j]) => hexBox(t, image, i, j));
const fitFor = (t, image, boxes) => fitHexLattice({ boxes, probe: t.probe, scale: image.scale, otherProbe: otherOf(t).probe });
const relErr = (t, image, fit) => Math.max(Math.abs(fit.sizeX / (t.probe.refW * image.k.x) - 1), Math.abs(fit.sizeY / (t.probe.refH * image.k.y) - 1));

// hexProbe asks the clone for the lattice and one hex's corners, and leaves the
// old shape alone where the grid cannot answer.
{
  for (const t of HEX_TYPES_UNDER_TEST) {
    const p = t.probe;
    assert.equal(p.refSize, 100);
    assert.equal(p.refW, t.grid.sizeX);
    assert.equal(p.refH, t.grid.sizeY);
    const c00 = t.grid.getCenterPoint({ i: 0, j: 0 });
    const c10 = t.grid.getCenterPoint({ i: 1, j: 0 });
    const c01 = t.grid.getCenterPoint({ i: 0, j: 1 });
    near(p.basis.u.x, c10.x - c00.x, 1e-9, `${t.name} u.x`);
    near(p.basis.u.y, c10.y - c00.y, 1e-9, `${t.name} u.y`);
    near(p.basis.v.x, c01.x - c00.x, 1e-9, `${t.name} v.x`);
    near(p.basis.v.y, c01.y - c00.y, 1e-9, `${t.name} v.y`);
    assert.equal(p.vertices.length, 6);
    near(p.vertices.reduce((a, q) => a + q.x, 0), 0, 1e-9, `${t.name} corners centred in x`);
    near(p.vertices.reduce((a, q) => a + q.y, 0), 0, 1e-9, `${t.name} corners centred in y`);
    near(Math.max(...p.vertices.map((q) => q.x)), p.refW / 2, 1e-9, `${t.name} corner extent x`);
    near(Math.max(...p.vertices.map((q) => q.y)), p.refH / 2, 1e-9, `${t.name} corner extent y`);
  }
  const old = { refW: 100, refH: (200 / Math.sqrt(3)), refSize: 100 };
  const noCentres = hexProbe(hexScene({ getCenterPoint: undefined, getVertices: undefined }), "hexRows");
  near(noCentres.refH, old.refH, 1e-9, "old shape: refH");
  assert.deepEqual(Object.keys(noCentres), ["refW", "refH", "refSize"], "a clone without getCenterPoint gives the old three keys and no more");
  const throwing = hexProbe(hexScene({ getCenterPoint() { throw new Error("no"); } }), "hexRows");
  assert.deepEqual(Object.keys(throwing), ["refW", "refH", "refSize"], "a grid that throws gives the old shape, not an error");
  const noCorners = hexProbe(hexScene({ getVertices: undefined }), "hexRows");
  assert.deepEqual(Object.keys(noCorners), ["refW", "refH", "refSize", "basis"], "the lattice stands without the corners");
  const lost = hexProbe(hexScene({ getCenterPoint: () => ({ x: NaN, y: 0 }) }), "hexRows");
  assert.deepEqual(Object.keys(lost), ["refW", "refH", "refSize"], "a centre that is no point is no lattice");
}

// Five exact boxes over four rows fit to nothing, on both images and all four
// types. One lattice step, one hex size: the box's own sides are not the ruler.
{
  for (const t of HEX_TYPES_UNDER_TEST) {
    for (const [imageName, image] of Object.entries(IMAGES)) {
      const where = `${t.name}, ${imageName}`;
      const boxes = boxesAt(t, image, [[0, 0], [1, 0], [2, 1], [3, 0], [0, 2]]);
      const fit = fitFor(t, image, boxes);
      assert.equal(fit.ok, true, where);
      assert.ok(fit.rmsPct < 0.001, `${where}: rms ${fit.rmsPct}`);
      assert.equal(fit.used, 5, where);
      assert.ok(fit.boxes.every((b) => !b.notOneHex && !b.unreachable && b.cell && b.residual < 0.001), `${where}: nothing flagged, every box placed`);
      assert.equal(fit.unreachable, 0, where);
      assert.deepEqual(fit.warnings, [], `${where}: the Judge's family is the boxes' family`);
      assert.ok(fit.rmsPx < 1e-6, `${where}: rms ${fit.rmsPx} px`);
      assert.deepEqual(fit.boxes[0].cell, { i: 0, j: 0 }, `${where}: the anchor is the origin`);
      near(fit.sizeX, t.probe.refW * image.k.x, 1e-9, `${where} sizeX`);
      near(fit.sizeY, t.probe.refH * image.k.y, 1e-9, `${where} sizeY`);
      const c = t.grid.getCenterPoint({ i: 0, j: 0 });
      near(fit.centre.x, ORIGIN.x + c.x * image.k.x, 1e-6, `${where} centre x`);
      near(fit.centre.y, ORIGIN.y + c.y * image.k.y, 1e-6, `${where} centre y`);
      near(fit.k.x, image.k.x, 1e-9, `${where} k.x`);
      near(fit.k.y, image.k.y, 1e-9, `${where} k.y`);
      near(fit.spacing.u.x, t.probe.basis.u.x * image.k.x, 1e-9, `${where} spacing`);
      assert.deepEqual(fit.from, { x: "joint", y: "joint" });
      assert.equal(fit.confidence, "tight");
      assert.equal(fit.worst, null, `${where}: a tight fit names no box`);
      assert.equal(fit.samples, 5);
    }
  }
}

// One box alone answers its own size and centre, from its edges.
{
  for (const t of HEX_TYPES_UNDER_TEST) {
    for (const [imageName, image] of Object.entries(IMAGES)) {
      const box = hexBox(t, image, 4, 3);
      const fit = fitFor(t, image, [box]);
      assert.equal(fit.ok, true);
      near(fit.sizeX, box.w, 1e-9, `${t.name}, ${imageName}: lone sizeX`);
      near(fit.sizeY, box.h, 1e-9, `${t.name}, ${imageName}: lone sizeY`);
      near(fit.centre.x, box.x + box.w / 2, 1e-9, "lone centre x");
      near(fit.centre.y, box.y + box.h / 2, 1e-9, "lone centre y");
      assert.deepEqual(fit.from, { x: "edges", y: "edges" });
      assert.equal(fit.used, 1);
      assert.deepEqual({ ...fit.boxes[0], residual: null }, { index: 0, cell: { i: 0, j: 0 }, residual: null, notOneHex: false, unreachable: false });
      near(fit.boxes[0].residual, 0, 1e-9, "a lone box sits on its own node");
      assert.equal(fit.confidence, "fair", "one box is never tight");
      assert.equal(fit.rmsPx, null, "one box has no residual to measure");
      assert.equal(fit.worst, null);
    }
  }
  // Two boxes in one place span nothing: the size is still the box's own.
  const t = HEX_TYPES_UNDER_TEST[0];
  const twin = fitFor(t, IMAGES.large, boxesAt(t, IMAGES.large, [[2, 2], [2, 2]]));
  assert.deepEqual(twin.from, { x: "edges", y: "edges" });
  // Two boxes in a row span x only; y has one position and reads its edges.
  const pair = fitFor(t, IMAGES.large, boxesAt(t, IMAGES.large, [[2, 2], [2, 3]]));
  assert.deepEqual(pair.from, { x: "joint", y: "edges" });
}

// Boxes 25 hexes apart, each placed up to `HAND_PX` (uniformly, seeded) off its
// hex, its size exact. At the large hex (150 px) 3 px over 25 hexes is far under
// 0.2% and every box is placed on its own hex. At the walk's small hex (about
// 31 x 47 image px) the span over the noise cannot be told from a neighbouring
// hex, so only the anchor is used and the other four are out of reach, exact
// boxes included: the planner is to ask for a box between.
{
  const far = [[0, 0], [0, 25], [25, 0], [25, 25], [12, 13]];
  for (const t of HEX_TYPES_UNDER_TEST) {
    for (const [imageName, image] of Object.entries(IMAGES)) {
      const exact = boxesAt(t, image, far);
      const where = `${t.name}, ${imageName}`;
      let largest = 0;
      for (let seed = 0; seed <= 20; seed++) {
        const rnd = seeded(seed * 7919);
        const jitter = () => (seed ? (rnd() * 2 - 1) * HAND_PX : 0);
        const noisy = exact.map((b) => ({ ...b, x: b.x + jitter(), y: b.y + jitter() }));
        const fit = fitFor(t, image, noisy);
        assert.equal(fit.ok, true);
        if (imageName === "large") {
          assert.equal(fit.used, 5, `${where}, seed ${seed}: nothing flagged`);
          assert.equal(fit.unreachable, 0, `${where}, seed ${seed}`);
          largest = Math.max(largest, relErr(t, image, fit));
          assert.ok(relErr(t, image, fit) < 0.002, `${where}, seed ${seed}: size off by ${relErr(t, image, fit)}`);
          assert.ok(fit.rmsPct < 0.2, `${where}, seed ${seed}: boxes placed on the right hexes`);
        } else {
          assert.equal(fit.used, 1, `${where}, seed ${seed}: the anchor alone`);
          assert.equal(fit.unreachable, 4, `${where}, seed ${seed}`);
          assert.equal(fit.confidence, "fair", `${where}, seed ${seed}: one box is never tight`);
          assert.equal(fit.boxes.filter((b) => b.unreachable && b.cell === null && b.residual === null && !b.notOneHex).length, 4, `${where}, seed ${seed}: four boxes out of reach`);
          assert.equal(fit.worst, null);
        }
      }
      if (imageName === "large") assert.ok(largest > 0, `${where}: the noise moved something`);
    }
  }
}

// A box that is not one hex is left out and says why. A strip of three hexes
// and a block three hexes each way both fail; neither moves the size.
{
  for (const t of HEX_TYPES_UNDER_TEST) {
    for (const [imageName, image] of Object.entries(IMAGES)) {
      const where = `${t.name}, ${imageName}`;
      const good = boxesAt(t, image, [[0, 0], [0, 1], [1, 0]]);
      const one = good[0];
      const strip = { ...one, x: one.x + 9 * one.w, w: 3 * one.w };
      const block = { ...one, x: one.x + 9 * one.w, w: 3 * one.w, h: 3 * one.h };
      for (const [label, odd] of [["strip", strip], ["block", block]]) {
        const fit = fitFor(t, image, [...good, odd]);
        assert.equal(fit.ok, true, `${where}: ${label}`);
        assert.equal(fit.boxes[3].notOneHex, true, `${where}: the ${label} is not one hex`);
        assert.equal(fit.boxes[3].unreachable, false);
        assert.equal(fit.boxes[3].cell, null);
        assert.equal(fit.boxes[3].residual, null);
        assert.equal(fit.used, 3);
        near(fit.sizeX, one.w, 1e-6, `${where}: ${label} leaves sizeX`);
        near(fit.sizeY, one.h, 1e-6, `${where}: ${label} leaves sizeY`);
      }
    }
  }
  // Two groups of one tie in size. Where one is smaller on both axes by more
  // than the spread it is the consensus, in whichever order they were drawn;
  // the earlier stands only where neither is clearly smaller.
  const t = HEX_TYPES_UNDER_TEST[0];
  const first = hexBox(t, IMAGES.large, 0, 0);
  const lone = fitHexLattice({ boxes: [first, { ...first, x: first.x + 600, w: 3 * first.w, h: 3 * first.h }], probe: t.probe });
  assert.equal(lone.used, 1);
  assert.equal(lone.boxes[1].notOneHex, true);
  assert.ok(HEX_SHAPE_LEAN > 0 && HEX_SHAPE_LEAN < 0.15, "the shape lean stays under half-way to the other family");
  assert.ok(HEX_SIZE_SPREAD > 0);
  assert.deepEqual([HAND_PX, REACH_Z, FAMILY_Z, TIGHT_PX, FAIR_PX], [3, 3.5, 2, 2.5, 6], "the figures every band is derived from");
}

// A box drawn around several hexes ties in size with an honest one-hex box,
// and the honest box is the consensus whichever was drawn first: the hex comes
// out at the honest size and the block is the box left out. Two honest boxes
// against two blocks give the same answer in every draw order.
{
  const around = (t, image, cells) => {
    const rects = boxesAt(t, image, cells);
    const x = Math.min(...rects.map((r) => r.x));
    const y = Math.min(...rects.map((r) => r.y));
    return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
  };
  const SHAPES = {
    "adjacent pair along i": (i, j) => [[i, j], [i + 1, j]],
    "adjacent pair along j": (i, j) => [[i, j], [i, j + 1]],
    "2x2 block": (i, j) => [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]],
    triangle: (i, j) => [[i, j], [i + 1, j], [i, j + 1]],
  };
  const permutations = (xs) => (xs.length < 2 ? [xs] : xs.flatMap((x, n) => permutations([...xs.slice(0, n), ...xs.slice(n + 1)]).map((rest) => [x, ...rest])));
  const SMALL = { k: { x: 30.7 / ROWS_PROBE.refW, y: 30.7 / ROWS_PROBE.refW }, scale: { x: 1, y: 1 } };
  for (const t of HEX_TYPES_UNDER_TEST) {
    for (const [imageName, image] of Object.entries({ ...IMAGES, small: SMALL })) {
      for (const [shape, cellsAt] of Object.entries(SHAPES)) {
        const where = `${t.name}, ${imageName}, ${shape}`;
        const honest = hexBox(t, image, 8, 8);
        const block = around(t, image, cellsAt(0, 0));
        const lastFirst = fitFor(t, image, [block, honest]);
        assert.equal(lastFirst.ok, true, where);
        assert.equal(lastFirst.used, 1, `${where}: the honest box alone is used`);
        assert.equal(lastFirst.boxes[0].notOneHex, true, `${where}: the block drawn first is left out`);
        assert.equal(lastFirst.boxes[1].notOneHex, false, `${where}: the honest box is not flagged`);
        near(lastFirst.sizeX, honest.w, 1e-6, `${where}: the hex is the honest width`);
        near(lastFirst.sizeY, honest.h, 1e-6, `${where}: the hex is the honest height`);
        const firstFirst = fitFor(t, image, [honest, block]);
        assert.equal(firstFirst.boxes[1].notOneHex, true, `${where}: the block drawn second is left out`);
        near(firstFirst.sizeX, honest.w, 1e-6, `${where}: either order gives the honest width`);

        const honestPair = [hexBox(t, image, 8, 8), hexBox(t, image, 9, 8)];
        const blocks = [around(t, image, cellsAt(0, 0)), around(t, image, cellsAt(4, 0))];
        const labelled = [...honestPair.map((b) => ({ b, honest: true })), ...blocks.map((b) => ({ b, honest: false }))];
        for (const order of permutations(labelled)) {
          const fit = fitFor(t, image, order.map((o) => o.b));
          const drawn = order.map((o) => (o.honest ? "H" : "B")).join("");
          assert.equal(fit.ok, true, `${where}, ${drawn}`);
          assert.equal(fit.used, 2, `${where}, ${drawn}: the two honest boxes are used`);
          order.forEach((o, n) => assert.equal(fit.boxes[n].notOneHex, !o.honest, `${where}, ${drawn}: box ${n}`));
          near(fit.sizeX, honest.w, 1e-6, `${where}, ${drawn}: the hex is the honest width`);
        }
      }
    }
  }
}

// A box of the other family's shape is not left out by its shape: where the
// span lets it be placed it joins the fit as a box off its node, and the
// largest centre residual names it. At the small hex it is out of reach. With
// no other family to compare, the same box at the large hex is not one hex.
{
  for (const t of HEX_TYPES_UNDER_TEST) {
    const other = otherOf(t);
    for (const [imageName, image] of Object.entries(IMAGES)) {
      const where = `${t.name}, ${imageName}`;
      const foreign = { x: ORIGIN.x - 200, y: ORIGIN.y - 200, w: other.probe.refW * image.k.x, h: other.probe.refH * image.k.y };
      const good = boxesAt(t, image, [[0, 0], [1, 0], [0, 3]]);
      const fit = fitFor(t, image, [foreign, ...good]);
      assert.equal(fit.ok, true, where);
      if (imageName === "large") {
        assert.equal(fit.used, 4, `${where}: the foreign box is placed`);
        assert.deepEqual(fit.boxes[0].cell, { i: 0, j: 0 }, `${where}: and is the anchor, the node the others are read from`);
        assert.equal(fit.worst, 0, `${where}: the box that is off its node is named`);
        assert.equal(fit.confidence, "loose", where);
        // With no other probe to compare, the same box is simply not one hex.
        const blind = fitHexLattice({ boxes: [foreign, ...good], probe: t.probe, scale: image.scale });
        assert.equal(blind.boxes[0].notOneHex, true, `${where}: unmatched shape`);
        assert.equal(blind.used, 3);
        assert.deepEqual(blind.warnings, [], `${where}: no other family, no verdict`);
      } else {
        assert.equal(fit.boxes[0].unreachable, true, `${where}: out of reach`);
        assert.equal(fit.boxes[0].cell, null);
        assert.deepEqual(fit.boxes[1].cell, { i: 0, j: 0 }, `${where}: the anchor is the first box placed`);
        assert.equal(fit.used, 3);
        assert.equal(fit.unreachable, 1);
      }
      // A lone foreign box still fits, as that box, and the shape says whose it is.
      const none = fitFor(t, image, [foreign]);
      assert.equal(none.ok, true, `${where}: a lone foreign box`);
      assert.equal(none.used, 1);
      assert.equal(none.confidence, "fair");
      if (imageName === "large") assert.deepEqual(none.warnings, [{ id: "familyMismatch", basis: "shape" }], `${where}: it is the other family's shape`);
      assert.equal(none.samples, 1);
    }
  }
}

// An exact one-hex box on the stretched image is NOT flagged, and read without
// the scale it still fits: the shape is judged on canvas, and the plausibility
// range at the small hex is wide enough to hold a hand's error on both axes.
{
  const t = HEX_TYPES_UNDER_TEST[0];
  const box = hexBox(t, IMAGES.stretched, 0, 0);
  near(box.w, 30.7, 1e-9, "the reported box width");
  near(box.h, 47.3, 1e-9, "the reported box height");
  const withScale = fitFor(t, IMAGES.stretched, [box, hexBox(t, IMAGES.stretched, 1, 0)]);
  assert.equal(withScale.boxes.every((b) => !b.notOneHex), true);
  assert.deepEqual(withScale.warnings, []);
  const blind = fitFor(t, { ...IMAGES.stretched, scale: { x: 1, y: 1 } }, [box]);
  assert.equal(blind.ok, true, "read as image px the small box still fits");
  assert.equal(blind.used, 1);
}

// The scale the session hands the fit is canvas px per IMAGE px, the inverse of
// the overlay's image scale. On the reported map (a square texture over a 4:3
// scene) the right answer reads the exact box as one hex; the inverted one
// reads it as no hex at all, so the two cannot be mixed up unseen.
{
  const t = HEX_TYPES_UNDER_TEST[0];
  const square = canvasPerImage({ texture: { width: 1000, height: 1000 }, dimensions: { sceneWidth: 4000 / 3, sceneHeight: 1000 } });
  near(square.x, 4 / 3, 1e-12, "a square texture drawn over a 4:3 scene is stretched a third wider");
  near(square.y, 1, 1e-12, "and not taller");
  const tall = canvasPerImage({ texture: { width: 800, height: 1000 }, dimensions: { sceneWidth: 1600, sceneHeight: 1000 } });
  assert.deepEqual(tall, { x: 2, y: 1 }, "each axis is its own ratio, scene over texture");
  for (const bad of [{}, { texture: null, dimensions: { sceneWidth: 10, sceneHeight: 10 } }, { texture: { width: 0, height: 5 }, dimensions: { sceneWidth: 10, sceneHeight: 10 } }, { texture: { width: 5, height: 5 }, dimensions: null }]) {
    assert.deepEqual(canvasPerImage(bad), { x: 1, y: 1 }, "an unusable texture or scene reads as identity");
  }

  const box = hexBox(t, IMAGES.stretched, 0, 0);
  const next = hexBox(t, IMAGES.stretched, 1, 0);
  const right = fitHexLattice({ boxes: [box, next], probe: t.probe, scale: square, otherProbe: otherOf(t).probe });
  assert.equal(right.ok, true);
  assert.equal(right.boxes.every((b) => !b.notOneHex), true, "with the right scale the exact boxes are one hex each");
  assert.deepEqual(right.warnings, []);
  const inverted = { x: 1 / square.x, y: 1 / square.y };
  const wrong = fitHexLattice({ boxes: [box, next], probe: t.probe, scale: inverted, otherProbe: otherOf(t).probe });
  assert.equal(wrong.ok === false || wrong.boxes.some((b) => b.notOneHex) || wrong.warnings.length > 0, true,
    "with the inverted scale the same boxes read differently");
}

// The session: the affine controls steer only the square family's fit, the hex
// fit is the lattice fit over the boxes behind one probe pair, computed once
// per change, and corners are refused on a hex family.
{
  const { session } = await import("../scripts/battlemap/session.mjs");
  const saved = { canvas: globalThis.canvas, foundry: globalThis.foundry, game: globalThis.game, ui: globalThis.ui };
  try {
    // Hidden state: ticked under the square family, ignored everywhere else.
    session.allowSkew = true;
    session.independentXY = true;
    const modeOf = (family) => {
      session.gridFamily = family;
      return session.fitMode;
    };
    assert.equal(modeOf("square"), "affine", "the square family reads Allow skew");
    assert.equal(modeOf("hexRows"), "rect", "a hex family ignores Allow skew");
    assert.equal(modeOf("hexCols"), "rect");
    assert.equal(modeOf("scale"), "square", "the scale-only family ignores both controls");
    session.allowSkew = false;
    assert.equal(modeOf("square"), "rect", "the square family reads Independent X / Y");
    assert.equal(modeOf("scale"), "square", "the scale-only family ignores Independent X / Y");
    session.independentXY = false;
    assert.equal(modeOf("square"), "square");

    // One fit per change: a scene counting the clones its probes ask for.
    let clones = 0;
    const scene = {
      id: "scene-under-test",
      background: { src: "map.webp" },
      dimensions: { sceneWidth: 4000 / 3, sceneHeight: 1000 },
      clone(data) {
        clones++;
        return hexScene().clone(data);
      },
    };
    globalThis.canvas = { scene };
    globalThis.foundry = { canvas: { getTexture: () => ({ width: 1000, height: 1000 }) } };
    const t = HEX_TYPES_UNDER_TEST[0];
    session.samples = { squares: boxesAt(t, IMAGES.stretched, [[0, 0], [1, 0]]), corners: [], scale: null };
    session.setSetup({ gridFamily: "hexRows", hexEven: false });
    clones = 0;
    const first = session.fit;
    for (let i = 0; i < 6; i++) assert.equal(session.fit, first, "a read with nothing changed answers the same fit");
    assert.equal(session.hexProbe.refW, t.probe.refW, "the probe is the chosen family's");
    assert.deepEqual(session.hexProbe.basis, t.probe.basis, "with its lattice basis");
    assert.equal(clones, 2, "the fit asked the scene for its two probes once, however often it was read");
    assert.equal(first.ok, true);
    assert.equal(first.used, 2);
    assert.deepEqual(first.warnings, [], "the scale is canvas per image, so the stretched box is one hex");
    assert.ok(first.rmsPct < 0.001, `the exact boxes fit tight, got ${first.rmsPct}`);
    assert.equal(first.centre != null, true, "a hex fit carries the fitted centre");

    session.samples.squares.push(...boxesAt(t, IMAGES.stretched, [[2, 1]]));
    session.onSamplesChanged();
    const second = session.fit;
    assert.notEqual(second, first, "a sample change recomputes the fit");
    assert.equal(second.used, 3);
    assert.equal(session.fit, second);
    session.setSetup({ gridFamily: "hexCols" });
    assert.notEqual(session.fit, second, "a family change recomputes it");
    assert.equal(session.hexProbe.refW, HEX_TYPES_UNDER_TEST[2].probe.refW, "and the probe");
    session.setSetup({ gridFamily: "hexRows" });
    const third = session.fit;
    session.wipe();
    assert.equal(session.fit, null, "a hex family with nothing sampled has no fit, baked or not");
    session.samples.squares.push(...boxesAt(t, IMAGES.stretched, [[0, 0], [1, 0], [2, 1]]));
    session.onSamplesChanged();
    assert.notEqual(session.fit, third, "a wipe and a new sample set recompute it");

    // Corners are refused on a hex family and the toolbar is put back at rest.
    const warned = [];
    const activated = [];
    globalThis.game = { i18n: { format: (key, data) => `${key} ${JSON.stringify(data ?? {})}`, localize: (key) => key } };
    globalThis.ui = {
      notifications: { warn: (text) => warned.push(text) },
      controls: { control: { name: "acksBattlemap" }, activate: (arg) => activated.push(arg) },
    };
    session.overlay.arm = () => {};
    session.gridFamily = "hexRows";
    session.mode = null;
    session.arm("corners");
    assert.equal(session.mode, null, "corners do not arm on a hex family");
    assert.equal(warned.length, 1, "and say why");
    assert.ok(warned[0].includes("warn.cornersHex") && warned[0].includes("ACKS-BATTLEMAP.mode.square"), "naming the box tool by its toolbar name");
    assert.deepEqual(activated, [{ tool: "off" }], "the toolbar goes back to rest");
    session.arm("square");
    assert.equal(session.mode, "square", "the box tool still arms");
    assert.equal(warned.length, 1);
    session.gridFamily = "square";
    session.arm("corners");
    assert.equal(session.mode, "corners", "corners arm on the square family");
    session.setSetup({ gridFamily: "hexCols" });
    assert.equal(session.mode, null, "switching to a hex family while corners is armed refuses it too");
    assert.equal(warned.length, 2);
    assert.equal(activated.length, 2);
  } finally {
    delete session.overlay.arm;
    session.mode = null;
    session.samples = { squares: [], corners: [], scale: null };
    session.gridFamily = "square";
    session.allowSkew = false;
    session.independentXY = false;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
}

// The failures.
{
  const t = HEX_TYPES_UNDER_TEST[0];
  assert.deepEqual(fitHexLattice({ boxes: [], probe: t.probe }), { ok: false, reason: "noBoxes", samples: 0 });
  const box = hexBox(t, IMAGES.large, 0, 0);
  assert.equal(fitHexLattice({ boxes: [box], probe: null }).reason, "noProbe");
  const { basis, ...old } = t.probe;
  assert.equal(fitHexLattice({ boxes: [box], probe: old }).reason, "noProbe", "a probe without its lattice cannot fit one");
  const empty = fitHexLattice({ boxes: [{ ...box, w: 0 }], probe: t.probe });
  assert.equal(empty.reason, "noOneHex");
  assert.deepEqual(empty.boxes, [{ index: 0, cell: null, residual: null, notOneHex: true, unreachable: false }], "a failure carries the per-box flags");
  assert.equal(empty.samples, 1);
  // A lone strip of three hexes is not one hex by its shape.
  const strip = fitHexLattice({ boxes: [{ ...box, w: 3 * box.w }], probe: t.probe });
  assert.equal(strip.reason, "noOneHex");
  assert.equal(strip.boxes[0].notOneHex, true);
}

/** An edge's miss and a corner's miss, each up to `HAND_PX`, drawn in the order a hand draws a box. */
const HAND = {
  edge(b, rnd) {
    const j = () => (rnd() * 2 - 1) * HAND_PX;
    const left = b.x + j();
    const right = b.x + b.w + j();
    const top = b.y + j();
    const bottom = b.y + b.h + j();
    return { x: left, y: top, w: right - left, h: bottom - top };
  },
  position(b, rnd) {
    const j = () => (rnd() * 2 - 1) * HAND_PX;
    return { ...b, x: b.x + j(), y: b.y + j() };
  },
};

/** A box grown (or shrunk) about its own centre by a factor on both sides. */
const grown = (b, f) => ({ x: b.x - (b.w * (f - 1)) / 2, y: b.y - (b.h * (f - 1)) / 2, w: b.w * f, h: b.h * f });

/** The bounding box, in image px, of a set of cells, from the grid's own corners. */
function blockBox(t, image, cells) {
  const pts = cells.flatMap(([i, j]) => t.grid.getVertices({ i, j }));
  const xs = pts.map((p) => ORIGIN.x + p.x * image.k.x);
  const ys = pts.map((p) => ORIGIN.y + p.y * image.k.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Each box's node relative to the first box's, in the order the boxes were given; null for a box left out. */
const relCells = (fit, boxIndex = 0) => {
  const c0 = fit.boxes[boxIndex].cell;
  return fit.boxes.map((b) => (b.cell ? { i: b.cell.i - c0.i, j: b.cell.j - c0.j } : null));
};

const WALK5 = [[0, 0], [1, 0], [2, 1], [3, 0], [0, 2]];
const WALK7 = [...WALK5, [4, 3], [6, 1]];

// The size error of the fit over four types and `SEEDS` seeded draws per type,
// every box drawn in list order; a table row holds its worst run under a bound
// set a little past what 1600 runs reached. `shift` moves a box before the noise.
const SEEDS = 400;
const sizeErrorMax = (cells, image, kind, shift = null) => {
  let max = 0;
  for (const t of HEX_TYPES_UNDER_TEST) {
    for (let seed = 1; seed <= (kind ? SEEDS : 1); seed++) {
      const rnd = seeded(seed * 7919);
      let boxes = boxesAt(t, image, cells);
      if (shift) boxes = boxes.map(shift);
      if (kind) boxes = boxes.map((b) => HAND[kind](b, rnd));
      const fit = fitFor(t, image, boxes);
      assert.equal(fit.ok, true, `${t.name}, seed ${seed}`);
      max = Math.max(max, relErr(t, image, fit));
    }
  }
  return max;
};
const offBy = (f) => (b, n) => (n === 0 ? { ...b, x: b.x + f * b.w, y: b.y + f * 0.5 * b.h } : b);
const LADDER = [[0, 0], [0, 1], [0, 3], [0, 8], [0, 25]];
{
  const { large, stretched } = IMAGES;
  const rows = [
    ["walk5, 30.7 px, edge noise", WALK5, stretched, "edge", null, 0.065],
    ["walk5, 30.7 px, position noise", WALK5, stretched, "position", null, 0.07],
    ["walk5, 150 px, edge noise", WALK5, large, "edge", null, 0.015],
    ["walk5, 150 px, position noise", WALK5, large, "position", null, 0.015],
    ["diagonal pair, 150 px, edge noise", [[0, 0], [1, 0]], large, "edge", null, 0.0325],
    ["diagonal pair, 150 px, position noise", [[0, 0], [1, 0]], large, "position", null, 0.021],
    ["diagonal pair, 30.7 px, edge noise", [[0, 0], [1, 0]], stretched, "edge", null, 0.205],
    ["diagonal pair, 30.7 px, position noise", [[0, 0], [1, 0]], stretched, "position", null, 0.085],
    ["anchor 0.2 hex off, exact", WALK5, large, null, offBy(0.2), 0.05],
    ["anchor 0.2 hex off, 150 px, edge noise", WALK5, large, "edge", offBy(0.2), 0.065],
    ["anchor 0.2 hex off, 150 px, position noise", WALK5, large, "position", offBy(0.2), 0.065],
    ["anchor 0.2 hex off, 30.7 px, edge noise", WALK5, stretched, "edge", offBy(0.2), 0.12],
    ["anchor 0.2 hex off, 30.7 px, position noise", WALK5, stretched, "position", offBy(0.2), 0.12],
    ["ladder, 150 px, edge noise", LADDER, large, "edge", null, 0.02],
    ["ladder, 150 px, position noise", LADDER, large, "position", null, 0.0125],
    ["ladder, 30.7 px, edge noise", LADDER, stretched, "edge", null, 0.09],
    ["ladder, 30.7 px, position noise", LADDER, stretched, "position", null, 0.05],
    ["committed far set, 150 px, position noise", [[0, 0], [0, 25], [25, 0], [25, 25], [12, 13]], large, "position", null, 0.002],
  ];
  for (const [name, cells, image, kind, shift, bound] of rows) {
    const worstRun = sizeErrorMax(cells, image, kind, shift);
    assert.ok(worstRun < bound, `${name}: size off by ${(100 * worstRun).toFixed(2)}% over every run, bound ${100 * bound}%`);
  }
}

// An honest set is tight on every draw; two boxes are never tight; a lone box is fair.
{
  for (const t of HEX_TYPES_UNDER_TEST) {
    for (const image of Object.values(IMAGES)) {
      for (let seed = 1; seed <= 100; seed++) {
        const rnd = seeded(seed * 7919);
        const walk = fitFor(t, image, boxesAt(t, image, WALK5).map((b) => HAND.position(b, rnd)));
        assert.equal(walk.confidence, "tight", `${t.name}, seed ${seed}: five boxes a hand drew`);
        assert.equal(walk.worst, null);
        const pair = fitFor(t, image, boxesAt(t, image, [[0, 0], [1, 0]]).map((b) => HAND.position(b, rnd)));
        assert.notEqual(pair.confidence, "tight", `${t.name}, seed ${seed}: two boxes`);
      }
    }
  }
}

// Reach: a box so far from the placed ones that the fit cannot tell its hex from
// a neighbour's is left out and counted, never placed on a guess.
{
  const small = IMAGES.stretched;
  const large = IMAGES.large;
  for (const t of HEX_TYPES_UNDER_TEST) {
    const where = t.name;
    // Two boxes 25 hexes apart, both four percent oversize: the far one could be on the 24th.
    const pair = fitFor(t, large, [[0, 0], [0, 25]].map(([i, j]) => grown(hexBox(t, large, i, j), 1.04)));
    assert.equal(pair.used, 1, `${where}: the far box of a pair`);
    assert.equal(pair.boxes[1].unreachable, true, where);
    assert.equal(pair.boxes[1].cell, null, where);
    assert.equal(pair.unreachable, 1, where);
    assert.equal(pair.confidence, "fair", where);
    // Three adjacent oversize boxes do not give the span a fourth, 25 away. Only
    // the first type holds it out: on the others the far box is placed, on the
    // right hex or a neighbour's, which an outline every box shares cannot
    // tell, and the fit never reads tight.
    const trio = fitFor(t, large, [[0, 0], [0, 1], [1, 0], [0, 25]].map(([i, j]) => grown(hexBox(t, large, i, j), 1.04)));
    if (t === HEX_TYPES_UNDER_TEST[0]) {
      assert.equal(trio.used, 3, `${where}: three adjacent oversize boxes`);
      assert.equal(trio.boxes[3].unreachable, true, where);
    } else {
      assert.notEqual(trio.confidence, "tight", `${where}: a far box placed on three oversize ones`);
    }
    // The anchor is the box the most others can be placed from, not the first one drawn.
    const lead = fitFor(t, small, boxesAt(t, small, [[0, 25], [0, 0], [0, 1], [1, 0]]));
    assert.equal(lead.used, 3, `${where}: a lone far box drawn first`);
    assert.deepEqual(lead.boxes.map((b) => b.unreachable), [true, false, false, false], where);
    // The ladder at the small hex stops short of its last rung, and a rung at 16 carries the fit to it.
    const withRung = [[0, 0], [0, 1], [0, 3], [0, 8], [0, 16], [0, 25]];
    for (let seed = 0; seed < 40; seed++) {
      const draw = (cells) => {
        const rnd = seeded(seed * 7919);
        return boxesAt(t, small, cells).map((b) => (seed ? HAND.position(b, rnd) : b));
      };
      const ladder = fitFor(t, small, draw(LADDER));
      assert.equal(ladder.boxes[4].unreachable, true, `${where}, seed ${seed}: rung 25`);
      assert.equal(ladder.used, 4, `${where}, seed ${seed}`);
      const carried = fitFor(t, small, draw(withRung));
      assert.equal(carried.unreachable, 0, `${where}, seed ${seed}: a rung at 16 reaches 25`);
      assert.equal(carried.used, 6);
      assert.deepEqual(relCells(carried), relCells(fitFor(t, small, boxesAt(t, small, withRung))), `${where}, seed ${seed}: on its own hex`);
    }
  }
}

// Family: a verdict against the Judge's family is a warning, from the lattice
// when the boxes spread over both axes and from their shape when they do not.
{
  const [rows, rowsEven, cols] = HEX_TYPES_UNDER_TEST;
  // Pointy rows stretched a quarter wider than the canvas says: as columns they
  // fit nothing, and as rows they fit exactly.
  for (const t of [rows, rowsEven]) {
    for (const small of [false, true]) {
      const base = small ? IMAGES.stretched : IMAGES.large;
      const image = { k: { x: base.k.x * 1.25, y: base.k.y }, scale: base.scale };
      const boxes = boxesAt(t, image, WALK5);
      const asColumns = fitHexLattice({ boxes, probe: cols.probe, scale: image.scale, otherProbe: t.probe });
      assert.deepEqual(asColumns.warnings, [{ id: "familyMismatch", basis: "lattice" }], `${t.name}, ${small ? "small" : "large"}: as columns`);
      assert.equal(asColumns.confidence, "loose");
      assert.ok(asColumns.rmsPx > FAIR_PX);
      if (t === rows) near(asColumns.rmsPx, small ? 9.44 : 37.01, 0.01, `${t.name}, ${small ? "small" : "large"}: the px the columns miss by`);
      assert.notEqual(asColumns.worst, null, "a loose fit names a box");
      const asRows = fitHexLattice({ boxes, probe: t.probe, scale: image.scale, otherProbe: cols.probe });
      assert.deepEqual(asRows.warnings, [], `${t.name}: as rows`);
      assert.equal(asRows.confidence, "tight");
    }
  }
  // The wrong family on a canvas drawn true is a mismatch and never tight.
  for (const t of HEX_TYPES_UNDER_TEST) {
    for (const [imageName, image] of Object.entries(IMAGES)) {
      const wrong = fitHexLattice({ boxes: boxesAt(t, image, WALK5), probe: otherOf(t).probe, scale: image.scale, otherProbe: t.probe });
      assert.deepEqual(wrong.warnings, [{ id: "familyMismatch", basis: "lattice" }], `${t.name}, ${imageName}: the wrong family`);
      assert.notEqual(wrong.confidence, "tight");
    }
  }
  // One box has only its shape, and at the small hex a hand can swing that either way.
  assert.deepEqual(fitFor(rows, IMAGES.large, [hexBox(rows, IMAGES.large, 0, 0)]).warnings, []);
  assert.deepEqual(fitFor(rows, IMAGES.stretched, [hexBox(rows, IMAGES.stretched, 0, 0)]).warnings, [{ id: "familyAmbiguous", basis: "shape" }]);
}

// Which boxes are one hex: real blocks of hexes are not, however regular they
// look, a box a fifth bigger or smaller than its fellows is, and a third is not.
{
  const blocks = {
    "2 wide, 3 rows": [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1]],
    "2 by 2": [[0, 0], [0, 1], [1, 0], [1, 1]],
    "3 by 3": [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]],
  };
  for (const t of HEX_TYPES_UNDER_TEST) {
    for (const [imageName, image] of Object.entries(IMAGES)) {
      const where = `${t.name}, ${imageName}`;
      const companions = boxesAt(t, image, [[0, 0], [0, 1], [1, 0]]);
      for (const [label, cells] of Object.entries(blocks)) {
        const box = blockBox(t, image, cells.map(([i, j]) => [i + 10, j + 10]));
        const fit = fitFor(t, image, [...companions, box]);
        assert.equal(fit.boxes[3].notOneHex, true, `${where}: a block ${label}`);
        assert.equal(fit.used, 3, `${where}: a block ${label}`);
      }
      const fellows = [[0, 0], [0, 1], [1, 0], [0, 2]];
      const odd = hexBox(t, image, 1, 1);
      for (const [factor, read] of [[1.2, true], [1 / 1.2, true], [1.3, false], [1 / 1.3, false]]) {
        const fit = fitFor(t, image, [...boxesAt(t, image, fellows), grown(odd, factor)]);
        assert.equal(fit.boxes[4].notOneHex, !read, `${where}: a box ${factor.toFixed(3)} times the others`);
        assert.equal(fit.used, read ? 5 : 4, where);
      }
    }
    // Proportions a hand could leave 8% off stay one hex; an eighth of the way to the next family does not carry far.
    const large = IMAGES.large;
    const four = boxesAt(t, large, [[0, 0], [0, 1], [1, 0], [0, 2]]);
    const wide = { ...four[3], w: four[3].w * 1.08, x: four[3].x - (four[3].w * 0.08) / 2 };
    for (const otherProbe of [null, otherOf(t).probe]) {
      const fit = fitHexLattice({ boxes: [...four.slice(0, 3), wide], probe: t.probe, scale: large.scale, otherProbe });
      assert.equal(fit.used, 4, `${t.name}: 8% off in proportion, ${otherProbe ? "with" : "without"} the other family`);
    }
  }
}

// Placement is nearest node, and not the rounding of the basis coordinates: a
// box pushed 0.45 of the way to its far corner stays on its own hex.
{
  for (const t of HEX_TYPES_UNDER_TEST) {
    for (const [imageName, image] of Object.entries(IMAGES)) {
      const cells = imageName === "large" ? WALK7 : WALK5;
      const where = `${t.name}, ${imageName}`;
      const boxes = boxesAt(t, image, cells);
      const exact = relCells(fitFor(t, image, boxes));
      const far = boxes.reduce((a, b, n) => (Math.hypot(b.x - boxes[0].x, b.y - boxes[0].y) > Math.hypot(boxes[a].x - boxes[0].x, boxes[a].y - boxes[0].y) ? n : a), 0);
      const pushed = boxes.map((b, n) => (n === far ? (t.columns ? { ...b, x: b.x + 0.45 * b.w } : { ...b, y: b.y + 0.45 * b.h }) : b));
      const fit = fitFor(t, image, pushed);
      assert.equal(fit.used, cells.length, where);
      assert.deepEqual(relCells(fit), exact, `${where}: box ${far} pushed toward its corner is still on its own hex`);
    }
  }
}

// A box moved a quarter of its height is the one `worst` names. The fit takes up
// a share of the move that grows with the box's leverage, so the boxes chosen
// are those near the middle of seven, where about a fifth of a hex is left.
{
  for (const t of HEX_TYPES_UNDER_TEST) {
    const image = IMAGES.large;
    const boxes = boxesAt(t, image, WALK7);
    for (const moved of [2, 3]) {
      const fit = fitFor(t, image, boxes.map((b, n) => (n === moved ? { ...b, y: b.y + 0.25 * b.h } : b)));
      assert.equal(fit.worst, moved, `${t.name}: box ${moved}`);
      assert.ok(fit.boxes[moved].residual >= 0.2, `${t.name}: box ${moved} residual ${fit.boxes[moved].residual}`);
      assert.notEqual(fit.confidence, "tight");
    }
  }
}

// A scale per axis and a stretched texture read the same hexes as an unstretched one.
{
  const images = {
    "scale 2 by 1.5": { k: { x: 1.5, y: 2 }, scale: { x: 2, y: 1.5 } },
    "texture 4:3 taller": { k: { x: 1.5, y: 1.125 }, scale: { x: 1, y: 4 / 3 } },
  };
  for (const t of HEX_TYPES_UNDER_TEST) {
    for (const [imageName, image] of Object.entries(images)) {
      const where = `${t.name}, ${imageName}`;
      const fit = fitFor(t, image, boxesAt(t, image, WALK5));
      assert.equal(fit.used, 5, where);
      assert.deepEqual(fit.warnings, [], where);
      assert.equal(fit.confidence, "tight", where);
      assert.ok(relErr(t, image, fit) < 1e-9, where);
    }
  }
}

// The order boxes were drawn in picks the anchor and nothing else: the walk's
// five, noisy, give the same cells relative to one box under every rotation.
{
  for (const t of HEX_TYPES_UNDER_TEST) {
    for (let seed = 1; seed <= 20; seed++) {
      const rnd = seeded(seed * 7919);
      const boxes = boxesAt(t, IMAGES.stretched, WALK5).map((b) => HAND.position(b, rnd));
      const reference = relCells(fitFor(t, IMAGES.stretched, boxes));
      assert.ok(reference.every((c) => c), `${t.name}, seed ${seed}: every box placed`);
      for (let turn = 1; turn < 5; turn++) {
        const order = boxes.map((_, n) => (n + turn) % 5);
        const fit = fitFor(t, IMAGES.stretched, order.map((n) => boxes[n]));
        const at = order.indexOf(0);
        const cells = order.map((n, slot) => ({ n, c: relCells(fit, at)[slot] })).sort((a, b) => a.n - b.n).map((e) => e.c);
        assert.deepEqual(cells, reference, `${t.name}, seed ${seed}, turn ${turn}`);
      }
    }
  }
}

// A scale bar converts through the step between centres, along either axis,
// for either family, on both images. The unit is the bar's own.
{
  const perCell = 7.5;
  for (const t of HEX_TYPES_UNDER_TEST) {
    for (const [imageName, image] of Object.entries(IMAGES)) {
      const fit = fitFor(t, image, boxesAt(t, image, [[0, 0], [1, 0], [0, 3]]));
      const step = Math.hypot(t.probe.basis.u.x, t.probe.basis.u.y);
      for (const cells of [1, 4]) {
        const along = { x: { dx: cells * step * fit.k.x, dy: 0 }, y: { dx: 0, dy: cells * step * fit.k.y } };
        for (const [axis, bar] of Object.entries(along)) {
          near(unitsPerCentreSpacing({ ...bar, value: cells * perCell, k: fit.k, basis: t.probe.basis }), perCell, 1e-9, `${t.name}, ${imageName}, ${axis}, ${cells} cells`);
        }
      }
    }
  }
  const t = HEX_TYPES_UNDER_TEST[0];
  const k = { x: 1, y: 1 };
  assert.equal(unitsPerCentreSpacing({ dx: 0, dy: 0, value: 30, k, basis: t.probe.basis }), null);
  assert.equal(unitsPerCentreSpacing({ dx: 100, dy: 0, value: 0, k, basis: t.probe.basis }), null);
  assert.equal(unitsPerCentreSpacing({ dx: 100, dy: 0, value: 30, k, basis: null }), null);
  assert.equal(unitsPerCentreSpacing({ dx: 100, dy: 0, value: 30, k: { x: 0, y: 1 }, basis: t.probe.basis }), null);
  // The box sides read the same bar differently: this is why `feetPerSquare` is not the hex's ruler.
  const bar = { dx: 4 * t.probe.basis.v.x, dy: 0 };
  const bySides = feetPerSquare({ ...bar, value: 30, sizeX: t.probe.refW, sizeY: t.probe.refH });
  near(unitsPerCentreSpacing({ ...bar, value: 30, k, basis: t.probe.basis }), 7.5, 1e-9, "four steps along a row");
  near(bySides, 7.5, 1e-9, "along a row a side equals a step, so the two rulers agree there");
  const diagonal = { dx: 0, dy: 3 * t.probe.basis.u.y };
  assert.ok(Math.abs(feetPerSquare({ ...diagonal, value: 30, sizeX: t.probe.refW, sizeY: t.probe.refH }) - unitsPerCentreSpacing({ ...diagonal, value: 30, k, basis: t.probe.basis })) > 0.1,
    "down the rows a side and a step disagree");
}

// The control: today's rect fit, on the very boxes above, reads them loose.
// Three boxes over two rows 19.7%, five over four 30.4% — the figures the live
// walk reported — so the fixtures are the reported ones.
{
  const t = HEX_TYPES_UNDER_TEST[0];
  const rect = (cells) => fitGrid({ squares: boxesAt(t, IMAGES.stretched, cells), corners: [], mode: "rect" });
  near(rect([[0, 0]]).rmsPct, 0, 1e-9, "control: one box");
  near(rect([[0, 0], [0, 1]]).rmsPct, 0, 1e-9, "control: two in a row");
  near(rect([[0, 0], [0, 1], [1, 0]]).rmsPct, 0.197, 0.001, "control: three over two rows");
  near(rect([[0, 0], [1, 0], [2, 1], [3, 0], [0, 2]]).rmsPct, 0.304, 0.001, "control: five over four rows");
  assert.equal(rect([[0, 0], [1, 0], [2, 1], [3, 0], [0, 2]]).confidence, "loose");
}

console.log("test-battlemap: all assertions passed");

/* ========================================================================== */
/*  Terrain painting: the pure cell bookkeeping                               */
/* ========================================================================== */
import {
  hexKeyOf,
  hexLabelFromOffset,
  withCellAdded,
  withCellRemoved,
  rekeyGridCells,
  TERRAIN_COLORS,
  UNPAINTABLE,
  paintableTerrains,
  colorFor,
  paintedTerrainAt,
  TERRAIN_FLAG,
} from "../scripts/battlemap/terrain-paint.mjs";
import { TERRAIN } from "../scripts/vehicles/vehicle-speed.mjs";
import { ENCOUNTER_TERRAINS } from "../scripts/formation/encounter-terrains.mjs";

assert.equal(hexKeyOf({ i: 3, j: 7 }), "3:7", "a cell's identity is its offset");
assert.equal(hexLabelFromOffset({ i: 0, j: 0 }), "A1", "columns letter, rows number, one-based");
assert.equal(hexLabelFromOffset({ i: 3, j: 2 }), "C4");
assert.equal(hexLabelFromOffset({ i: 0, j: 25 }), "Z1");
assert.equal(hexLabelFromOffset({ i: 9, j: 26 }), "AA10", "columns run past Z the way spreadsheets do");
assert.equal(hexLabelFromOffset({ i: 0, j: 27 }), "AB1");

/* --- one cell in and out of a region's shape data --------------------------
   The cell lives in a `grid` shape's offsets and nowhere else. Adding lands in
   the first non-hole grid shape (a new one where there is none); removing takes
   the cell out of every non-hole grid shape and drops one it empties; any other
   shape a Judge put there is passed through. */
{
  let shapes = withCellAdded([], "1:1");
  assert.ok(shapes.changed && shapes.shapes.length === 1, "the first cell makes the region's one grid shape");
  assert.deepEqual(shapes.shapes[0], { type: "grid", hole: false, offsets: [{ i: 1, j: 1 }] });
  assert.ok(!withCellAdded(shapes.shapes, "1:1").changed, "painting the same cell again writes nothing");
  shapes = withCellAdded(shapes.shapes, "2:2");
  assert.deepEqual(shapes.shapes[0].offsets, [{ i: 1, j: 1 }, { i: 2, j: 2 }], "cells accumulate in the first grid shape");
  assert.equal(shapes.shapes.length, 1, "and no second shape is made for them");

  const hole = { type: "grid", hole: true, offsets: [{ i: 5, j: 5 }] };
  const poly = { type: "polygon", hole: false, points: [0, 0, 1, 0, 0, 1] };
  const mixed = withCellAdded([hole, poly], "3:3");
  assert.deepEqual(mixed.shapes.map((s) => s.type + (s.hole ? "-hole" : "")), ["grid-hole", "polygon", "grid"],
    "a hole is no place for a painted cell: a new grid shape follows the others");
  assert.ok(withCellAdded([hole, poly], "5:5").changed, "a cell a hole holds is still not painted");

  const gone = withCellRemoved(shapes.shapes, "1:1");
  assert.ok(gone.changed);
  assert.deepEqual(gone.shapes[0].offsets, [{ i: 2, j: 2 }], "erase drops the right cell");
  assert.ok(!withCellRemoved(shapes.shapes, "9:9").changed, "erasing an unpainted cell writes nothing");
  assert.equal(withCellRemoved(shapes.shapes, "9:9").shapes, shapes.shapes, "and hands the same shapes back");
  const emptied = withCellRemoved([{ type: "grid", hole: false, offsets: [{ i: 4, j: 4 }] }], "4:4");
  assert.deepEqual(emptied, { shapes: [], changed: true }, "a grid shape left with no cell is dropped, and the region with it");
  const kept = withCellRemoved([{ type: "grid", hole: false, offsets: [{ i: 4, j: 4 }] }, poly, hole], "4:4");
  assert.deepEqual(kept.shapes, [poly, hole], "a polygon a Judge drew and a hole survive the rewrite");
  assert.ok(!withCellRemoved([hole], "5:5").changed, "a hole is not a claim, so removing from it changes nothing");
}

{
  const fine = Object.keys(ENCOUNTER_TERRAINS);
  const bare = Object.keys(TERRAIN);
  for (const key of [...fine, ...bare]) assert.ok(TERRAIN_COLORS[key], key + " has a swatch colour");
  for (const key of Object.keys(TERRAIN_COLORS)) {
    assert.ok(fine.includes(key) || bare.includes(key), "no colour without a kind: " + key);
  }
}

/* --- the brush vocabulary --------------------------------------------------
   Proves the brush paints the encounter terrains that stand on a ground — the
   book's grain — plus any imported terrain key no encounter terrain covers,
   minus the two the weather owns. A river table stands on no ground: water is
   drawn as a line. See docs/battlemap/DECISIONS.md, "The brush paints at the
   book's grain", the open-vocabulary ruling and "A river or a coast is a
   line". Values below are invented. */
{
  const { registerTable, unregisterTable, PRIORITY } = await import("../scripts/lib/tables.mjs");
  unregisterTable("travel");

  const shipped = paintableTerrains();
  const register = Object.keys(ENCOUNTER_TERRAINS);
  const standing = register.filter((k) => ENCOUNTER_TERRAINS[k].ground);
  assert.deepEqual(shipped, standing,
    "with nothing imported the brushes are the encounter terrains that stand on a ground, in the register's order");
  const rivers = register.filter((k) => !ENCOUNTER_TERRAINS[k].ground);
  assert.ok(rivers.length > 0, "the register holds tables that stand on no ground");
  for (const key of rivers) assert.ok(!shipped.includes(key), key + " is drawn as a line, never painted on a hex");
  assert.ok(!shipped.includes("forest"), "a bare ground is no brush — its kinds are");
  for (const key of UNPAINTABLE) {
    assert.ok(!shipped.includes(key), key + " is weather's, not the brush's");
    assert.ok(TERRAIN[key], key + " stays a valid terrain for the multiplier lookup");
  }

  registerTable({
    id: "travel",
    source: "invented",
    tables: { terrainMultipliers: { forest: 0.7, ashWaste: 0.4, saltFlat: 0.9, mud: 0.5 } },
  }, { priority: PRIORITY.WORLD, source: "test" });

  const opened = paintableTerrains();
  assert.ok(opened.includes("ashWaste"), "an imported kind no encounter terrain covers becomes paintable");
  assert.ok(opened.includes("saltFlat"));
  assert.ok(!opened.includes("forest"), "an imported row for a ground the register covers adds no swatch");
  for (const key of UNPAINTABLE) {
    assert.ok(!opened.includes(key), "importing must not re-admit " + key);
  }

  // An unknown key still gets a stable, distinguishable colour.
  assert.equal(colorFor("forestTaiga"), TERRAIN_COLORS.forestTaiga, "a shipped kind keeps its palette colour");
  assert.equal(colorFor("forest"), TERRAIN_COLORS.forest, "a bare ground painted before keeps its colour too");
  const a = colorFor("ashWaste");
  assert.ok(/^hsl\(/.test(a), "an imported kind gets a derived hue");
  assert.equal(a, colorFor("ashWaste"), "and the same hue every time");
  assert.notEqual(a, colorFor("saltFlat"), "different kinds get different hues");

  unregisterTable("travel");
  assert.ok(!paintableTerrains().includes("ashWaste"), "dropping the table closes the vocabulary again");
}

/* --- the painted hex, read in both vocabularies ---------------------------
   A region carries its cells as a core grid shape, which tests a point itself;
   the grid fake maps a point straight to an offset. Keys are the register's;
   the scene is not. */
{
  globalThis.CONST ??= {};
  CONST.GRID_TYPES ??= { HEXODDR: 2, HEXEVENR: 3, HEXODDQ: 4, HEXEVENQ: 5 };
  const grid = { type: CONST.GRID_TYPES.HEXODDR, getOffset: (p) => ({ i: p.y, j: p.x }) };
  const region = (key, hexes) => paintRegion({ grid, flag: TERRAIN_FLAG, value: key, cells: hexes });
  const scene = {
    grid,
    regions: [region("forestTaiga", ["1:1"]), region("forest", ["2:2"]), region("riverLand", ["3:3"]), region("ashWaste", ["4:4"])],
  };
  const at = (i, j) => paintedTerrainAt(scene, { x: j, y: i });
  assert.deepEqual(at(1, 1), { key: "forestTaiga", ground: "forest", encounterTerrain: "forestTaiga" },
    "a kind of the register answers for its ground and for itself");
  assert.deepEqual(at(2, 2), { key: "forest", ground: "forest", encounterTerrain: "" },
    "a bare ground answers for the ground alone");
  assert.deepEqual(at(3, 3), { key: "riverLand", ground: null, encounterTerrain: "riverLand" },
    "a river names no ground");
  assert.deepEqual(at(4, 4), { key: "ashWaste", ground: "ashWaste", encounterTerrain: "" },
    "an imported kind is a ground");
  assert.deepEqual(at(9, 9), { key: null, ground: null, encounterTerrain: "" },
    "an unpainted hex answers nothing");
  assert.equal(paintedTerrainAt({ grid: { type: 1 }, regions: scene.regions }, { x: 1, y: 1 }).key, null,
    "a square grid is never painted");
}

/* --- roads: the wall row, and a wall that the graph split ------------------
   The row is markup the module assembles itself, so it is asserted as markup:
   what the Judge typed has to come back out of the attribute it was written
   into. The sheet is driven through the render hook the module actually
   registers, over the smallest stand-ins the code touches. Names and surface
   keys below are invented. */
{
  const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" };
  const escapeHTML = (s) => String(s).replace(/[&<>"']/g, (c) => ENTITIES[c]);
  /** What a browser hands back when it reads the attribute again. */
  const decode = (s) => s
    .replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

  globalThis.CONST = { EDGE_SENSE_TYPES: { NONE: 0 }, EDGE_DOOR_TYPES: { NONE: 0 } };
  globalThis.foundry = { utils: { escapeHTML } };
  globalThis.game = {
    user: { isGM: true },
    // Every key answers as itself, so a label that is not translated is the
    // raw imported key — which is the case the escaping has to survive.
    i18n: { format: (key) => key, localize: (key) => key, has: () => false },
  };

  /** The row the module last built, captured through its only DOM call. */
  let built = null;
  globalThis.document = {
    createElement: () => {
      built = {
        className: "",
        innerHTML: "",
        querySelector: () => ({ value: "", addEventListener() {} }),
      };
      return built;
    },
  };

  const hooks = new Map();
  globalThis.Hooks = {
    on: (name, fn) => {
      if (!hooks.has(name)) hooks.set(name, []);
      hooks.get(name).push(fn);
    },
  };

  const { MODULE_ID } = await import("../scripts/lib/constants.mjs");
  const { registerRoadHooks, roadSegmentsFromGraph, roadSegmentsOf, invalidateRoadGraph } =
    await import("../scripts/battlemap/roads.mjs");
  const { registerTable, unregisterTable, PRIORITY } = await import("../scripts/lib/tables.mjs");

  registerRoadHooks();
  const appended = [];
  const root = {
    nodeType: 1,
    querySelector: (sel) => (sel === ".window-content .standard-form" ? { append: (r) => appended.push(r) } : null),
  };
  /** Fire the sheet-render hook over one document and report what was added. */
  const render = (wall) => {
    appended.length = 0;
    built = null;
    for (const fn of hooks.get("renderApplicationV2")) fn({ document: wall, render() {} }, root);
    return built;
  };

  // The wall PALETTE is a WallConfig over an unsaved preview — the shape of the
  // next wall to be drawn — and its id is null. A flag written there cannot
  // land, so no row is offered.
  assert.equal(render({ documentName: "Wall", id: null, move: 0, flags: {} }), null,
    "the id-less palette preview gets no road row");
  assert.equal(appended.length, 0, "and nothing is appended to the palette's form");
  assert.equal(render({ documentName: "Item", id: "i1" }), null, "and a sheet that is not a wall's still gets none");

  // A placed wall, named with the two characters that break an attribute.
  const streetName = 'The "Shambles" & Sons';
  const imported = 'sand & "gravel"';
  registerTable({
    id: "travel",
    source: "invented",
    tables: { roads: { [imported]: { multiplier: 1 } } },
  }, { priority: PRIORITY.WORLD, source: "test" });

  const placed = {
    documentName: "Wall",
    id: "Wall.1",
    c: [0, 0, 200, 0],
    move: 0,
    flags: { [MODULE_ID]: { road: { surface: "paved", street: "avenue", name: streetName } } },
  };
  const row = render(placed);
  assert.ok(row, "a placed wall gets the road row");
  assert.equal(appended.length, 1, "appended once, into the sheet's own field list");

  const value = /class="acks-extras-road-name" value="([^"]*)"/.exec(row.innerHTML)?.[1];
  assert.ok(value != null, "the name input carries a value attribute");
  assert.equal(decode(value), streetName, "the name survives the attribute it is written into");
  assert.ok(row.innerHTML.includes("&quot;"), "the quotes went in as entities");

  const options = [...row.innerHTML.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)]
    .map(([, v, label]) => [decode(v), decode(label)]);
  assert.ok(options.some(([v, label]) => v === imported && label === imported),
    "an imported surface key survives both halves of its option");
  assert.ok(options.some(([v]) => v === "paved"), "and the shipped surfaces are still offered");

  unregisterTable("travel");

  // One drawn line, cut by the graph at a junction. The pieces share ONE
  // `meta` object by reference (what `joinSegments` guarantees), which is the
  // whole of the identity here — entries carry no id.
  const high = { c: [0, 0, 200, 0], road: { surface: "paved", street: "avenue", name: "High" } };
  const lane = { c: [100, 0, 100, 100], road: { surface: "earth", street: "alley", name: "Lane" } };
  const split = roadSegmentsFromGraph({
    edges: [
      { a: 0, b: 1, length: 100, seg: [0, 0, 100, 0], meta: high },
      { a: 1, b: 2, length: 100, seg: [100, 0, 200, 0], meta: high },
      { a: 1, b: 3, length: 100, seg: [100, 0, 100, 100], meta: lane },
    ],
  });
  assert.equal(split.length, 2, "a line cut at a junction is one street, with or without an id on it");
  assert.deepEqual(split[0].seg, [0, 0, 200, 0], "and it is reported as the whole line the Judge drew");
  assert.equal(split[0].surface, "paved");
  assert.deepEqual(split[1].seg, [100, 0, 100, 100], "the street that cut it is its own line");
  assert.equal(split[1].surface, "earth");

  // Identity is the OBJECT: two entries that merely look alike are two streets,
  // so a second line drawn over the first is not swallowed as a repeat of it.
  const twin = () => ({ c: [0, 0, 200, 0], road: { surface: "paved" } });
  assert.equal(
    roadSegmentsFromGraph({ edges: [{ seg: [0, 0, 200, 0], meta: twin() }, { seg: [0, 0, 200, 0], meta: twin() }] }).length,
    2, "two entries of identical content are two streets");

  assert.equal(roadSegmentsFromGraph({ edges: [{ seg: [0, 0, 10, 0], meta: {} }, { seg: [10, 0, 20, 0], meta: {} }] }).length,
    2, "an entry stating no whole line leaves each edge standing as the line it is");
  assert.deepEqual(roadSegmentsFromGraph(null), [], "no graph is no roads");

  // What the partition is FOR, at the consumer that reads it. The hex
  // derivation sums road length per cell over every entry handed to it and
  // prices a crossing by what lies inside the two cells, so a street repeated
  // once per piece is that much road again in each cell it runs through and the
  // crossing is priced for bends the street does not have. Asserted against the
  // lines as drawn, which is the answer that cannot drift.
  const { linksFromRoadSegments, nodeId } = await import("../scripts/battlemap/hex-topology.mjs");
  /** A square stand-in for a hex grid: 100-pixel cells, neighbours share an edge. */
  const cells = {
    step: 5,
    offsetAt: (p) => ({ i: Math.floor(p.x / 100), j: Math.floor(p.y / 100) }),
    centre: (o) => ({ x: o.i * 100 + 50, y: o.j * 100 + 50 }),
    facing: (from, to) => {
      const di = to.i - from.i;
      const dj = to.j - from.j;
      if (Math.abs(di) + Math.abs(dj) !== 1) return null;
      const out = di === 1 ? 0 : di === -1 ? 3 : dj === 1 ? 1 : 4;
      return { near: nodeId(from.i, from.j, "side", out), far: nodeId(to.i, to.j, "side", (out + 3) % 6) };
    },
  };
  const drawn = [{ seg: high.c, ...high.road }, { seg: lane.c, ...lane.road }];
  assert.deepEqual(linksFromRoadSegments(split, cells), linksFromRoadSegments(drawn, cells),
    "the crossings a cut line declares, and their prices, are the ones its whole line makes");

  // End to end off a scene: two crossing streets are two entries, whole lines.
  const wallDoc = (id, c, surface) => ({ id, c, move: 0, flags: { [MODULE_ID]: { road: { surface } } } });
  invalidateRoadGraph();
  const live = roadSegmentsOf({
    id: "scene-roads",
    grid: { size: 100 },
    walls: [wallDoc("w1", [0, 0, 200, 0], "paved"), wallDoc("w2", [100, 0, 100, 100], "earth")],
  });
  assert.equal(live.length, 2, "two drawn streets are two segments");
  assert.deepEqual(live.map((s) => s.seg), [[0, 0, 200, 0], [100, 0, 100, 100]],
    "each carrying the wall's own line");
  invalidateRoadGraph();
}

/* --- roads: how far it is along them, in the map's own feet -----------------
   The measurement the city turn spends. Geometry over a fake scene: the grid,
   the walls and the scale are invented, and what is pinned is the RULE — both
   ends on the streets or no answer, a bend priced by its legs, a wall the party
   cannot cross left out of the network, and a map with no scale refusing rather
   than guessing. */
{
  const { MODULE_ID } = await import("../scripts/lib/constants.mjs");
  const { roadDistance, roadGraph, invalidateRoadGraph } = await import("../scripts/battlemap/roads.mjs");
  const { sceneFeetPerCell } = await import("../scripts/lib/distance-units.mjs");
  let n = 0;
  const wall = (c, road, move = 0) => ({ id: `w${++n}`, c, move, flags: { [MODULE_ID]: { road } } });
  /** 100 px squares worth 5 ft each: a pixel is a twentieth of a foot. */
  const city = (id, walls, grid = { size: 100, distance: 5, units: "ft" }) => ({ id, grid, walls });
  const close = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-6, `${what}: ${a} is not ${b}`);

  invalidateRoadGraph();
  const bend = city("scene-bend", [
    wall([0, 0, 1200, 0], { surface: "paved", street: "avenue", name: "High Street" }),
    wall([1200, 0, 1200, 1200], { surface: "earth", street: "alley", name: "" }),
  ]);
  const walked = roadDistance(bend, { x: 0, y: 0 }, { x: 1200, y: 1200 });
  assert.ok(walked, "both ends on the streets measure");
  close(walked.along, 120, "the legs are 2400 px, which is 120 ft here");
  close(walked.offRoad, 0, "and neither end had to walk to a street");
  close(walked.feet, 120, "the whole move is the legs");
  assert.ok(walked.feet > Math.hypot(1200, 1200) / 20, "which is longer than the chord across the block");
  assert.deepEqual(walked.roads, ["paved", "earth"], "the surfaces walked, once each, in order");
  assert.equal(walked.street, "alley", "the street the walk ENDED on is where the party now stands");

  // Within a cell of a street is on it — the reach is the grid cell, not a
  // figure of its own — and the walk to the kerb is reported apart.
  const stepped = roadDistance(bend, { x: 0, y: 90 }, { x: 1200, y: 1110 });
  assert.ok(stepped, "a party a step off the kerb is still on the street");
  close(stepped.offRoad, 4.5, "ninety pixels to the kerb, kept apart from the street");
  close(stepped.along, 115.5, "and the street itself is what was walked along it");

  assert.equal(roadDistance(bend, { x: 0, y: 0 }, { x: 600, y: 600 }), null,
    "a move that ends across open ground is not a street walk, however it began");
  assert.equal(roadDistance(bend, { x: 600, y: 600 }, { x: 1200, y: 1200 }), null,
    "nor is one that begins there");

  invalidateRoadGraph();
  const islands = city("scene-islands", [
    wall([0, 0, 500, 0], { surface: "paved" }),
    wall([0, 2000, 500, 2000], { surface: "paved" }),
  ]);
  assert.equal(roadDistance(islands, { x: 100, y: 0 }, { x: 100, y: 2000 }), null,
    "two streets that never meet have no distance along anything");

  invalidateRoadGraph();
  const blocked = city("scene-blocked", [wall([0, 0, 1000, 0], { surface: "paved" }, 20)]);
  assert.equal(roadGraph(blocked).edges.length, 0, "a road the party cannot cross is not in the network");
  assert.equal(roadDistance(blocked, { x: 0, y: 0 }, { x: 1000, y: 0 }), null, "so nothing is measured along it");

  invalidateRoadGraph();
  const unscaled = city("scene-unscaled", [wall([0, 0, 1000, 0], { surface: "paved" })], { size: 100, distance: 0 });
  assert.equal(roadDistance(unscaled, { x: 0, y: 0 }, { x: 1000, y: 0 }), null,
    "a map that states no scale cannot price a walk, and says nothing rather than guessing");

  invalidateRoadGraph();
  const metric = city("scene-metric", [wall([0, 0, 1000, 0], { surface: "paved" })], { size: 100, distance: 5, units: "m" });
  const metres = roadDistance(metric, { x: 0, y: 0 }, { x: 1000, y: 0 });
  assert.ok(metres, "a map drawn in metres still measures");
  close(metres.feet, 10 * sceneFeetPerCell(metric), "through its own units into feet, ten cells' worth");

  // The network is memoised per scene and dropped by the wall hooks: a street
  // added without the drop is invisible, which is what the hooks exist for.
  const grown = city("scene-grown", [wall([0, 0, 1000, 0], { surface: "paved" })]);
  invalidateRoadGraph();
  assert.equal(roadDistance(grown, { x: 0, y: 0 }, { x: 1000, y: 1000 }), null);
  grown.walls.push(wall([1000, 0, 1000, 1000], { surface: "paved" }));
  assert.equal(roadDistance(grown, { x: 0, y: 0 }, { x: 1000, y: 1000 }), null, "until the cache is dropped");
  invalidateRoadGraph("scene-grown");
  assert.ok(roadDistance(grown, { x: 0, y: 0 }, { x: 1000, y: 1000 }), "after which the new street measures");
  invalidateRoadGraph();
}

/* --- the country's other two layers -----------------------------------------
   Territory is painted the way terrain is — one value per hex per layer, held
   as region flags of the layer's own — so the terrain cases are asked of it:
   what the brush may lay down, its colours and labels, the read of a hex, and
   a write that never reaches another layer's regions. The climate is the
   map's and paints no hex. The scene holds its regions in memory and is
   written the way documents are. See docs/battlemap/DECISIONS.md, "The
   country brush paints three layers" and "The climate is the map's". */
{
  const { gridCellsOf } = await import("../scripts/lib/regions.mjs");
  const {
    PAINT_LAYERS, TERRITORY_COLORS, paintableValues, layerColorFor, layerLabelFor, layerRegionsOf, layerCellsOf,
    layerValueAt, paintHexAt, registerPaintLayer, terrainPaint, TerrainPaletteApp, openCountryBrush,
    climateLabelFor,
  } = await import("../scripts/battlemap/terrain-paint.mjs");
  const { TERRITORY_KEYS } = await import("../scripts/formation/country-keys.mjs");
  const { CLIMATES } = await import("../scripts/formation/weather.mjs");
  const { MODULE_ID } = await import("../scripts/lib/constants.mjs");

  CONST.GRID_TYPES ??= { HEXODDR: 2, HEXEVENR: 3, HEXODDQ: 4, HEXEVENQ: 5 };
  CONST.REGION_VISIBILITY ??= { LAYER: 0, GAMEMASTER: 1, ALWAYS: 2 };
  game.user = { isGM: true };

  // What each layer may paint, and the names the sheet already gives them.
  assert.deepEqual(Object.keys(PAINT_LAYERS), ["terrain", "territory"]);
  const flags = Object.values(PAINT_LAYERS).map((l) => l.flag);
  assert.equal(new Set(flags).size, flags.length, "no two layers share a flag");
  assert.deepEqual(PAINT_LAYERS.terrain, { flag: TERRAIN_FLAG }, "terrain keeps its flag, and holds no cell flag: the cells are the region's own shapes");
  assert.deepEqual(paintableValues("territory"), [...TERRITORY_KEYS]);
  assert.deepEqual(paintableValues("climate"), [], "the climate is the map's, and the brush paints none");
  assert.deepEqual(paintableValues("terrain"), paintableTerrains());
  assert.deepEqual(paintableValues("water"), [], "a layer the brush does not know paints nothing");

  const territoryColours = TERRITORY_KEYS.map((v) => layerColorFor(v, "territory"));
  for (const [n, c] of territoryColours.entries()) assert.match(c, /^#[0-9a-f]{6}$/, `territory ${TERRITORY_KEYS[n]} has a swatch colour`);
  assert.equal(new Set(territoryColours).size, TERRITORY_KEYS.length, "every territory reads apart from every other");
  for (const key of TERRITORY_KEYS) assert.equal(layerColorFor(key, "territory"), TERRITORY_COLORS[key]);
  assert.equal(layerLabelFor("outlands", "territory"), "ACKS-FORMATION.travel.territory.outlands",
    "a territory is named as the sheet names it");
  assert.equal(layerLabelFor("nowhere", "territory"), "nowhere", "an unknown value is shown as itself");
  assert.equal(climateLabelFor("Csb"), "Csb — ACKS-FORMATION.travel.weather.climates.Csb",
    "a climate by its code and its name");
  assert.equal(climateLabelFor("Q9"), "Q9", "an unknown climate is shown as itself");
  assert.ok(Object.hasOwn(CLIMATES, "Csb"), "the label's case is a climate the module knows");

  /** A hex scene of 100-pixel cells, offset (i, j) = (row, column), its regions held in memory and written as documents are. */
  const scene = paintScene({ id: "scene-layers", grid: cellGrid() });
  const centre = (i, j) => ({ x: j * 100 + 50, y: i * 100 + 50 });
  const values = (i, j) => Object.fromEntries(
    Object.keys(PAINT_LAYERS).map((layer) => [layer, layerValueAt(scene, centre(i, j), layer)]));

  assert.equal(await paintHexAt(scene, centre(1, 1), "forestTaiga"), true, "terrain, by default");
  assert.equal(await paintHexAt(scene, centre(1, 1), "outlands", "territory"), true);
  assert.equal(await paintHexAt(scene, centre(1, 1), "Csb", "climate"), false, "a climate paints no hex");
  assert.deepEqual(values(1, 1), { terrain: "forestTaiga", territory: "outlands" },
    "one hex holds a value on every layer at once");
  assert.equal(scene.regions.length, 2, "one region per layer value");
  const visibility = Object.fromEntries(
    Object.keys(PAINT_LAYERS).map((layer) => [layer, layerRegionsOf(scene, layer).map((r) => r.visibility)]));
  assert.deepEqual(visibility, { terrain: [2], territory: [0] },
    "the terrain is the map everyone sees; territory is drawn by its map mode, its regions on the Regions control alone");
  assert.equal(layerRegionsOf(scene, "territory")[0].name, "ACKS-FORMATION.travel.territory.outlands",
    "a region is named by its layer's label");
  assert.deepEqual(layerRegionsOf(scene, "water"), [], "a layer the brush does not know has no regions");

  assert.equal(await paintHexAt(scene, centre(1, 1), "civilized", "territory"), true);
  assert.deepEqual(values(1, 1), { terrain: "forestTaiga", territory: "civilized" },
    "a new territory moves the hex out of the old one and leaves the terrain alone");
  assert.deepEqual(layerRegionsOf(scene, "territory").map((r) => r.getFlag(MODULE_ID, "territory")), ["civilized"],
    "a region left with no hex is deleted");

  assert.equal(await paintHexAt(scene, centre(1, 2), "civilized", "territory"), true);
  assert.deepEqual(gridCellsOf(layerRegionsOf(scene, "territory")[0]).map(hexKeyOf), ["1:1", "1:2"],
    "a second hex of the same value joins its region");
  assert.equal(layerRegionsOf(scene, "territory")[0].shapes.length, 1, "as a cell of its one grid shape, never a shape of its own");
  assert.equal(await paintHexAt(scene, centre(1, 2), "civilized", "territory"), false, "painting it again writes nothing");

  assert.equal(await paintHexAt(scene, centre(1, 1), null, "territory"), true);
  assert.deepEqual(values(1, 1), { terrain: "forestTaiga", territory: null },
    "erasing a layer erases that layer only");
  assert.deepEqual(values(1, 2), { terrain: null, territory: "civilized" }, "and that hex only");

  assert.equal(await paintHexAt(scene, centre(2, 2), "forestTaiga", "territory"), false, "a terrain is no territory");
  assert.equal(await paintHexAt(scene, centre(2, 2), "outlands"), false, "nor a territory a terrain");
  assert.equal(await paintHexAt(scene, centre(2, 2), "outlands", "water"), false, "and an unknown layer paints nothing");
  game.user = { isGM: false };
  assert.equal(await paintHexAt(scene, centre(2, 2), "outlands", "territory"), false, "a player paints nothing");
  game.user = { isGM: true };
  assert.deepEqual(values(2, 2), { terrain: null, territory: null });

  /* --- the cells are core grid shapes, one Region per value ----------------
     A value's region holds its cells as offsets of one `grid` shape. A paint
     is one region update per cell however many regions it touches, a Region
     left with no cell goes, the read and the enumeration answer alike where a
     hand edit left two regions claiming a cell, and a drag that fires faster
     than the server answers loses no cell. */
  {
    const fresh = paintScene({ id: "scene-cells", grid: cellGrid() });
    const held = (layer = "terrain") => layerRegionsOf(fresh, layer).map((r) => [r.getFlag(MODULE_ID, PAINT_LAYERS[layer].flag), gridCellsOf(r).map(hexKeyOf)]);
    const ops = (from = 0) => fresh.calls.slice(from).map((c) => `${c.op}${c.count}`);

    await paintHexAt(fresh, centre(3, 4), "forestTaiga");
    await paintHexAt(fresh, centre(3, 5), "forestTaiga");
    assert.deepEqual(held(), [["forestTaiga", ["3:4", "3:5"]]], "forest on 3:4 and 3:5 is one region");
    assert.deepEqual(fresh.regions[0].toObject().shapes, [{ type: "grid", hole: false, offsets: [{ i: 3, j: 4 }, { i: 3, j: 5 }] }],
      "with one grid shape holding both offsets, and no polygon");
    assert.equal(fresh.created[0].locked, false, "a brush region is made unlocked, so core's grid tool reaches it");
    assert.deepEqual(ops(), ["create1", "update1"], "the first cell makes the region and the next is one update");

    // A cell moves from one value's region to another's in one update that carries both.
    await paintHexAt(fresh, centre(3, 9), "grassland");
    const mark = fresh.calls.length;
    assert.equal(await paintHexAt(fresh, centre(3, 5), "grassland"), true);
    assert.deepEqual(held(), [["forestTaiga", ["3:4"]], ["grassland", ["3:9", "3:5"]]], "the cell left the forest and joined the grass");
    assert.deepEqual(ops(mark), ["update2"], "one update call, the two regions in it");
    assert.equal(layerValueAt(fresh, centre(3, 5)), "grassland");
    assert.equal(await paintHexAt(fresh, centre(3, 5), "grassland"), false, "the same value again writes nothing");
    assert.deepEqual(ops(mark), ["update2"]);

    // An erase that empties a region deletes it, and says nothing of the other layers.
    await paintHexAt(fresh, centre(3, 4), "outlands", "territory");
    const before = fresh.calls.length;
    assert.equal(await paintHexAt(fresh, centre(3, 4), null), true);
    assert.deepEqual(held(), [["grassland", ["3:9", "3:5"]]], "the forest region held one cell and is gone with it");
    assert.deepEqual(ops(before), ["delete1"]);
    assert.deepEqual(held("territory"), [["outlands", ["3:4"]]], "the territory painted on the cell stays");

    // Two regions of a layer claiming one cell, as a hand edit can leave them: the read and the enumeration agree.
    const second = paintRegion({ grid: fresh.grid, flag: TERRAIN_FLAG, value: "forestTaiga", cells: ["3:5", "7:7"], id: "hand" });
    fresh.regions.push(second);
    const claim = layerCellsOf(fresh).find((c) => c.key === "3:5");
    assert.deepEqual([claim.value, claim.region.id === second.id], ["grassland", false], "the enumeration lists the cell once, to the first region");
    assert.equal(layerValueAt(fresh, centre(3, 5)), claim.value, "and the point read answers with the same region");
    assert.deepEqual(layerCellsOf(fresh).map((c) => c.key).toSorted(), ["3:5", "3:9", "7:7"], "each cell once");
    await paintHexAt(fresh, centre(3, 5), "forestTaiga");
    assert.deepEqual(held(), [["grassland", ["3:9"]], ["forestTaiga", ["3:5", "7:7"]]], "painting the later claim's value takes the cell from the first");

    // A hole a Judge added claims nothing, and a Region with no grid shape is no layer's.
    second.shapes.push({ type: "grid", hole: true, offsets: [{ i: 9, j: 9 }], grid: fresh.grid, testPoint() { return true; } });
    assert.equal(layerValueAt(fresh, centre(9, 9)), null, "a hole's cell is not painted");
    assert.deepEqual(layerCellsOf(fresh).map((c) => c.key).toSorted(), ["3:5", "3:9", "7:7"]);
    fresh.regions.push(paintRegion({ grid: fresh.grid, flag: TERRAIN_FLAG, value: "desertSandy", shapes: [{ type: "polygon", hole: false, points: [0, 0, 9, 0, 0, 9] }] }));
    assert.equal(layerRegionsOf(fresh).length, 2, "a region carrying the flag and no grid shape paints nothing, and is no region of the layer");
  }

  {
    // Ten paints started together, none awaited: a new value's region is made once and no cell is lost.
    const burst = paintScene({ id: "scene-burst", grid: cellGrid() });
    const runs = Array.from({ length: 10 }, (_, n) => paintHexAt(burst, centre(0, n), "grassland"));
    assert.deepEqual(await Promise.all(runs), Array(10).fill(true));
    assert.equal(layerRegionsOf(burst).length, 1, "one region for the value, not one per racing paint");
    assert.deepEqual(gridCellsOf(layerRegionsOf(burst)[0]).map(hexKeyOf), Array.from({ length: 10 }, (_, n) => `0:${n}`), "all ten cells, in order");
    assert.deepEqual(burst.calls.map((c) => c.op), ["create", ...Array(9).fill("update")]);

    // Two values interleaved over one stroke, and an erase in it, keep each cell at its last word.
    const mixed = Array.from({ length: 8 }, (_, n) => paintHexAt(burst, centre(1, n), n % 2 ? "forestTaiga" : "grassland"));
    mixed.push(paintHexAt(burst, centre(0, 3), null), paintHexAt(burst, centre(1, 0), "forestTaiga"));
    await Promise.all(mixed);
    assert.deepEqual(Object.fromEntries(layerCellsOf(burst).map((c) => [c.key, c.value])), {
      "0:0": "grassland", "0:1": "grassland", "0:2": "grassland", "0:4": "grassland", "0:5": "grassland", "0:6": "grassland",
      "0:7": "grassland", "0:8": "grassland", "0:9": "grassland",
      "1:0": "forestTaiga", "1:1": "forestTaiga", "1:2": "grassland", "1:3": "forestTaiga", "1:4": "grassland",
      "1:5": "forestTaiga", "1:6": "grassland", "1:7": "forestTaiga",
    }, "every cell holds the last value asked of it");

    // A write that fails rejects to its caller and the queue keeps going.
    const flaky = paintScene({ id: "scene-flaky", grid: cellGrid() });
    const update = flaky.updateEmbeddedDocuments;
    let failNext = false;
    flaky.updateEmbeddedDocuments = async (...args) => {
      if (failNext) { failNext = false; throw new Error("refused"); }
      return update(...args);
    };
    await paintHexAt(flaky, centre(0, 0), "grassland");
    failNext = true;
    const doomed = paintHexAt(flaky, centre(0, 1), "grassland");
    const after = paintHexAt(flaky, centre(0, 2), "grassland");
    await assert.rejects(doomed, /refused/);
    assert.equal(await after, true, "the write queued behind a failed one still runs");
    assert.deepEqual(gridCellsOf(layerRegionsOf(flaky)[0]).map(hexKeyOf), ["0:0", "0:2"]);
  }

  const square = { ...scene, grid: { ...scene.grid, type: 1 } };
  assert.equal(layerValueAt(square, centre(1, 2), "territory"), null, "a square grid is never painted");
  assert.equal(await paintHexAt(square, centre(3, 3), "outlands", "territory"), false);

  // The registry. A third layer joins by registering and nothing else in the
  // file knows its name; the palette is probed through its context, which is
  // what the template renders.
  const builtIns = ["terrain", "territory"];
  const palette = () => new TerrainPaletteApp()._prepareContext();
  const pillKeys = async () => (await palette()).layers.map((p) => p.key);

  assert.deepEqual(await pillKeys(), builtIns, "the palette offers the two layers");
  assert.deepEqual((await palette()).layers.map((p) => p.label), builtIns.map((k) => `ACKS-BATTLEMAP.terrain.layer.${k}`),
    "each named by the lang key it has always had");
  assert.equal((await palette()).groups.length, 1, "terrain is one ungrouped run of swatches");

  const demoValues = ["a1", "a2", "b1"];
  const demoLayer = () => ({
    key: "demo",
    flag: "demoKind",
    values: () => demoValues,
    label: (v) => `demo ${v}`,
    color: (v) => (v === "a1" ? "#112233" : "#445566"),
    title: "TEST.demoPill",
    groups: { of: (v) => v[0], label: (g) => `group ${g}` },
  });
  const dispose = registerPaintLayer(demoLayer());
  let disposeOpen = () => {};
  let disposeHollow = () => {};
  try {
    assert.deepEqual(Object.keys(PAINT_LAYERS), [...builtIns, "demo"], "a registered layer joins the set, last");
    assert.deepEqual(PAINT_LAYERS.demo, { flag: "demoKind" });
    assert.ok(Object.hasOwn(PAINT_LAYERS, "demo") && "demo" in PAINT_LAYERS);
    assert.deepEqual(PAINT_LAYERS.terrain, { flag: TERRAIN_FLAG }, "the others keep their flags");
    assert.deepEqual(paintableValues("demo"), demoValues);
    assert.notEqual(paintableValues("demo"), demoValues, "the brush gets a copy of what the layer offers");
    assert.equal(layerLabelFor("a1", "demo"), "demo a1");
    assert.equal(layerColorFor("a1", "demo"), "#112233");

    // It paints, reads and erases as the built-ins do, drawn for a GM only
    // because it did not say `visible`.
    assert.equal(await paintHexAt(scene, centre(5, 5), "a1", "demo"), true);
    assert.equal(layerValueAt(scene, centre(5, 5), "demo"), "a1");
    assert.equal(layerValueAt(scene, centre(5, 5), "terrain"), null, "and the other layers do not see it");
    const [region] = layerRegionsOf(scene, "demo");
    assert.deepEqual(
      [region.name, region.color, region.visibility, region.getFlag(MODULE_ID, "demoKind"), gridCellsOf(region).map(hexKeyOf)],
      ["demo a1", "#112233", 1, "a1", ["5:5"]],
      "a region is named, tinted and flagged by its layer's own functions and flags");
    assert.equal(await paintHexAt(scene, centre(5, 5), "zz", "demo"), false, "a value the layer does not offer is refused");
    assert.equal(await paintHexAt(scene, centre(5, 5), null, "demo"), true);
    assert.deepEqual(layerRegionsOf(scene, "demo"), [], "erasing the last cell deletes the region");

    disposeOpen = registerPaintLayer({ ...demoLayer(), key: "open", flag: "openKind", visible: true });
    assert.equal(await paintHexAt(scene, centre(5, 6), "a1", "open"), true);
    assert.deepEqual(layerRegionsOf(scene, "open").map((r) => r.visibility), [2], "a layer that says `visible` is drawn for everyone");
    assert.equal(await paintHexAt(scene, centre(5, 6), null, "open"), true);
    disposeOpen();

    // The palette: its pill, its groups, and arming the brush on the layer.
    const pills = (await palette()).layers;
    assert.deepEqual(pills.map((p) => p.key), [...builtIns, "demo"]);
    assert.equal(pills.at(-1).label, "TEST.demoPill", "a layer names its own pill");
    terrainPaint.setLayer("demo");
    const shown = await palette();
    assert.equal(shown.layers.find((p) => p.active).key, "demo");
    assert.deepEqual(shown.groups.map((g) => [g.label, g.swatches.map((s) => s.key)]),
      [["group a", ["a1", "a2"]], ["group b", ["b1"]]], "swatches group by the layer's own groups");
    terrainPaint.setLayer("terrain");

    globalThis.canvas = {};
    TerrainPaletteApp.prototype.render = function render() { return this; };
    try {
      assert.ok(openCountryBrush({ layer: "demo", brush: "b1", by: "sheet" }) instanceof TerrainPaletteApp);
      assert.deepEqual([terrainPaint.layer, terrainPaint.brush, terrainPaint.armedBy], ["demo", "b1", "sheet"],
        "the brush opens on any registered layer");
      terrainPaint.disarm();
      openCountryBrush({ layer: "nowhere" });
      assert.equal(terrainPaint.layer, "terrain", "an unregistered layer opens on terrain");
    } finally {
      terrainPaint.disarm();
      delete TerrainPaletteApp.prototype.render;
      delete globalThis.canvas;
    }

    // A layer with no value to offer is registered but left out of the palette.
    let pool = [];
    disposeHollow = registerPaintLayer({ ...demoLayer(), key: "hollow", flag: "hollowKind", values: () => pool });
    assert.ok(Object.hasOwn(PAINT_LAYERS, "hollow"));
    assert.deepEqual(paintableValues("hollow"), []);
    assert.deepEqual(await pillKeys(), [...builtIns, "demo"], "an empty layer stays hidden");
    pool = ["a1"];
    assert.deepEqual(await pillKeys(), [...builtIns, "demo", "hollow"], "and appears once it has a value");
    disposeHollow();

    // Refusals leave the registry as it was.
    const plain = { flag: "dupKind", values: () => [], label: String, color: () => "#000000" };
    assert.throws(() => registerPaintLayer({ ...plain, key: "terrain" }), /registered twice/, "a built-in's key is taken");
    assert.throws(() => registerPaintLayer({ ...plain, key: "demo" }), /registered twice/, "so is a later one's");
    assert.throws(() => registerPaintLayer({ ...plain, key: "dup", flag: "territory" }), /flag is shared/);
    assert.throws(() => registerPaintLayer({ ...plain, key: "dup", flag: "demoKind" }), /flag is shared/);
    assert.throws(() => registerPaintLayer({ ...plain, key: "" }), /non-empty/);
    assert.throws(() => registerPaintLayer(), /non-empty/);
    assert.throws(() => registerPaintLayer({ ...plain, key: "dup", values: null }), /values must be a function/);
    assert.throws(() => registerPaintLayer({ ...plain, key: "dup", groups: { of: () => "g" } }), /groups/);
    assert.throws(() => registerPaintLayer({ ...plain, key: "dup", visible: true, regionsOnly: true }), /cannot both hold/,
      "a layer drawn for everyone is not also drawn on the Regions control alone");
    assert.deepEqual(Object.keys(PAINT_LAYERS), [...builtIns, "demo"], "a refused layer registers nothing");
    assert.equal(layerLabelFor("a1", "demo"), "demo a1", "and the first registration still stands");

    // The flag map is a view, not a place to add a layer.
    assert.throws(() => { PAINT_LAYERS.rogue = { flag: "x" }; }, TypeError);
    assert.throws(() => { PAINT_LAYERS.terrain = {}; }, TypeError);
    assert.throws(() => { delete PAINT_LAYERS.terrain; }, TypeError);
    assert.throws(() => Object.defineProperty(PAINT_LAYERS, "rogue", { value: {} }), TypeError);
    assert.equal("rogue" in PAINT_LAYERS, false);

    // Taking a layer back: the brush leaves it, and an old handle cannot take a newer registration.
    terrainPaint.setLayer("demo");
    dispose();
    assert.equal(terrainPaint.layer, "terrain", "a brush on a removed layer returns to terrain");
    assert.deepEqual(Object.keys(PAINT_LAYERS), builtIns);
    assert.deepEqual(paintableValues("demo"), [], "a removed layer paints nothing");
    assert.deepEqual(layerRegionsOf(scene, "demo"), []);
    const again = registerPaintLayer(demoLayer());
    dispose();
    assert.ok(Object.hasOwn(PAINT_LAYERS, "demo"), "a handle that was already spent does nothing");
    again();
  } finally {
    dispose();
    disposeOpen();
    disposeHollow();
    terrainPaint.setLayer("terrain");
  }
  assert.deepEqual(Object.keys(PAINT_LAYERS), builtIns, "the set is as it began");
  assert.deepEqual(await pillKeys(), builtIns);
}

/* --- the brush paints the board, never what stands in front of it -----------
   PIXI hears pointermove on the whole document, so the catcher is handed
   moves made over a window. A stroke opens only on the board, and a move
   paints only over it. The catcher is built against a stand-in stage whose
   handlers the test calls as PIXI would. */
{
  const { onBoard, terrainPaint, layerCellsOf } = await import("../scripts/battlemap/terrain-paint.mjs");

  const board = { id: "board" };
  const palette = { id: "palette" };
  assert.equal(onBoard({ nativeEvent: { target: board } }, board), true);
  assert.equal(onBoard({ nativeEvent: { target: palette } }, board), false, "a window in front is not the board");
  assert.equal(onBoard({}, board), false, "an event with no native target is not the board");
  assert.equal(onBoard({ nativeEvent: { target: board } }, null), false, "and nothing is the board with no canvas");

  CONST.GRID_TYPES ??= { HEXODDR: 2, HEXEVENR: 3, HEXODDQ: 4, HEXEVENQ: 5 };
  CONST.REGION_VISIBILITY ??= { LAYER: 0, GAMEMASTER: 1, ALWAYS: 2 };
  game.user = { isGM: true };
  const scene = paintScene({ grid: cellGrid() });
  const painted = () => layerCellsOf(scene).map((c) => c.key);
  /** A PIXI display object that keeps its handlers so the test can fire them. */
  class Node {
    handlers = {};
    transform = { updateTransform() {} };
    addChild(child) { return child; }
    on(name, fn) { this.handlers[name] = fn; }
    destroy() {}
  }
  let catcher = null;
  globalThis.PIXI = {
    Container: Node,
    Sprite: class extends Node { constructor() { super(); catcher = this; } },
    Texture: { WHITE: {} },
    Transform: { IDENTITY: {} },
  };
  globalThis.canvas = { stage: new Node(), app: { screen: {}, view: board }, scene };
  const at = (target, x, y, buttons = 1) => ({ nativeEvent: { target }, buttons, getLocalPosition: () => ({ x, y }) });
  // A paint is a few writes, each answering a tick later: wait them all out.
  const settle = async () => { for (let n = 0; n < 6; n++) await new Promise((resolve) => setTimeout(resolve, 0)); };
  try {
    terrainPaint.arm("grassland", { layer: "terrain" });
    const fire = async (name, ev) => { catcher.handlers[name](ev); await settle(); };

    await fire("pointermove", at(board, 150, 150));
    assert.deepEqual(painted(), [], "a held button with no stroke opened on the board paints nothing");
    await fire("pointerdown", at(palette, 150, 150));
    await fire("pointermove", at(palette, 250, 150));
    assert.deepEqual(painted(), [], "a click on the palette opens no stroke, and its travel paints nothing");
    await fire("pointerup", at(palette, 250, 150, 0));

    await fire("pointerdown", at(board, 150, 150));
    assert.deepEqual(painted(), ["1:1"], "a press on the board paints its hex");
    await fire("pointermove", at(palette, 250, 150));
    assert.deepEqual(painted(), ["1:1"], "a stroke dragged over a window paints nothing under it");
    await fire("pointermove", at(board, 350, 150));
    assert.equal(painted().at(-1), "1:3", "and resumes on the board");
    await fire("pointerup", at(board, 350, 150, 0));
    await fire("pointermove", at(board, 450, 150));
    assert.equal(painted().includes("1:4"), false, "the stroke ends on release");

    // A stroke that outruns the server: ten pointer moves with no pause between them keep all ten cells.
    await fire("pointerdown", at(board, 50, 250));
    for (let n = 1; n < 10; n++) catcher.handlers.pointermove(at(board, n * 100 + 50, 250));
    await settle();
    await fire("pointerup", at(board, 950, 250, 0));
    assert.deepEqual(painted().filter((k) => k.startsWith("2:")), Array.from({ length: 10 }, (_, n) => `2:${n}`), "a drag with no delay between its cells loses none");
  } finally {
    terrainPaint.disarm();
    delete globalThis.PIXI;
    delete globalThis.canvas;
  }
}

/* --- the scene's default country --------------------------------------------
   What the Judge said of a map's unpainted country, stored inside the setup
   record. The write merges into that record; the read drops what it does not
   know. Values below are invented. */
{
  const { sceneCountry, writeSceneSetup } = await import("../scripts/battlemap/scene-setup.mjs");
  const { MODULE_ID } = await import("../scripts/lib/constants.mjs");
  const flags = {};
  const scene = {
    getFlag: (ns, key) => flags[ns]?.[key],
    setFlag: async (ns, key, value) => { flags[ns] = { ...(flags[ns] ?? {}), [key]: structuredClone(value) }; },
  };
  const silent = { ground: null, territory: null, climate: null };
  assert.deepEqual(sceneCountry(scene), silent, "a scene nobody set up says nothing");
  assert.deepEqual(sceneCountry(null), silent, "nor does no scene");

  await writeSceneSetup(scene, { calibrated: true, distance: 6 });
  await writeSceneSetup(scene, { country: { ground: "forestTaiga", territory: "outlands", climate: "Csb" } });
  assert.deepEqual(sceneCountry(scene), { ground: "forestTaiga", territory: "outlands", climate: "Csb" });
  assert.equal(flags[MODULE_ID].battlemap.calibrated, true, "the setup record's other fields survive the write");
  assert.equal(flags[MODULE_ID].battlemap.distance, 6);

  await writeSceneSetup(scene, { country: { ground: "ashWaste", territory: null, climate: "Csb" } });
  assert.deepEqual(sceneCountry(scene), { ground: "ashWaste", territory: null, climate: "Csb" },
    "the ground is any brush value, an imported one included, and an unsaid key reads null");
  await writeSceneSetup(scene, { country: { ground: "", territory: "nowhere", climate: "Q9" } });
  assert.deepEqual(sceneCountry(scene), silent, "a blank or a value the module does not know reads as unsaid");

}

/* --- the country under a point ----------------------------------------------
   The one reader. Each key answers from the map where the map says something
   and from the scene default where it does not, and says which; a drawn layer
   speaks only on a scene that has one. A row of hexes on 100-pixel cells, a
   road through (1,1), a river down column 3, a coast down column 5. Names and
   placements are invented. */
{
  const { countryAt, riverTableFor, COUNTRY_KEYS } = await import("../scripts/battlemap/country.mjs");
  const { encounterTerrainFor } = await import("../scripts/formation/encounter-terrains.mjs");
  const { MODULE_ID } = await import("../scripts/lib/constants.mjs");
  const { invalidateRoadGraph } = await import("../scripts/battlemap/roads.mjs");

  CONST.GRID_TYPES ??= { HEXODDR: 2, HEXEVENR: 3, HEXODDQ: 4, HEXEVENQ: 5 };
  const grid = cellGrid();
  const terrain = (value, hexes) => paintRegion({ grid, flag: TERRAIN_FLAG, value, cells: hexes });
  const territory = (value, hexes) => paintRegion({ grid, flag: "territory", value, cells: hexes });
  const line = (c, layer) => ({ c, move: 0, flags: { [MODULE_ID]: layer } });
  const sceneOf = ({ regions = [], walls = [], country = null, type = CONST.GRID_TYPES.HEXODDR, id = "scene-country" } = {}) => ({
    id,
    grid: { ...grid, type },
    regions,
    walls,
    getFlag: (_ns, key) => (key === "battlemap" && country ? { country } : undefined),
  });
  const centre = (i, j) => ({ x: j * 100 + 50, y: i * 100 + 50 });
  const read = (scene, i, j, opts) => {
    const got = countryAt(scene, centre(i, j), opts);
    return { values: Object.fromEntries(COUNTRY_KEYS.map((k) => [k, got[k]])), source: got.source, water: got.water };
  };

  assert.deepEqual(COUNTRY_KEYS, ["ground", "encounterTerrain", "territory", "climate", "road", "following"]);
  assert.equal(riverTableFor("desert"), "riverDesertJungle");
  assert.equal(riverTableFor("jungle"), "riverDesertJungle");
  assert.equal(riverTableFor("forest"), "riverLand");
  assert.equal(riverTableFor(null), "riverLand", "a river through unknown ground reads the land table");

  invalidateRoadGraph();
  const scene = sceneOf({
    regions: [
      terrain("forestTaiga", ["1:1"]), terrain("desertSandy", ["1:3"]), terrain("forest", ["1:5"]),
      terrain("ashWaste", ["1:7"]), terrain("riverLand", ["1:9"]),
      territory("outlands", ["1:1"]), territory("wildlands", ["1:3"]),
    ],
    walls: [
      line([100, 150, 250, 150], { road: { surface: "paved" } }),
      line([350, 0, 350, 1000], { water: { kind: "river" } }),
      line([550, 0, 550, 1000], { water: { kind: "coast" } }),
    ],
    country: { ground: "grasslandSteppe", territory: "borderlands", climate: "BSk" },
  });

  const all = (source) => Object.fromEntries(COUNTRY_KEYS.map((k) => [k, source]));
  let at = read(scene, 1, 1);
  assert.deepEqual(at.values, {
    ground: "forest", encounterTerrain: "forestTaiga", territory: "outlands", climate: "BSk", road: "paved", following: "none",
  }, "a hex painted on every layer, a road through it and no navigable water under it");
  assert.deepEqual(at.source, { ...all("map"), climate: "scene" },
    "every painted answer is the map's; the climate is the scene's, since the brush paints none");
  assert.equal(at.water, null);

  at = read(scene, 1, 3);
  assert.deepEqual(at.values, {
    ground: "desert", encounterTerrain: "desertSandy", territory: "borderlands", climate: "BSk", road: "none", following: "river",
  }, "a painted desert on the river, with no territory of its own");
  assert.deepEqual(at.source, { ...all("map"), territory: "scene", climate: "scene" },
    "a territory value the module does not know is silence, and the scene default answers");
  assert.deepEqual(at.water, { kind: "river", navigable: true });
  assert.equal(read(scene, 1, 3, { waterBorne: true }).values.encounterTerrain, "riverDesertJungle",
    "afloat over a river through desert, the desert-and-jungle river table");
  assert.equal(read(scene, 1, 3, { waterBorne: true }).source.encounterTerrain, "map");

  at = read(scene, 1, 5);
  assert.deepEqual([at.values.ground, at.values.encounterTerrain], ["forest", encounterTerrainFor("forest")],
    "a bare ground painted before the brush took the book's grain reads its default table");
  assert.equal(at.values.following, "none", "a coast is no route to follow");
  assert.deepEqual(at.water, { kind: "coast", navigable: false }, "but it is water under the party");
  assert.equal(read(scene, 1, 5, { waterBorne: true }).values.encounterTerrain, "riverLand",
    "afloat along a coast through forest, the land river table");

  at = read(scene, 1, 7);
  assert.deepEqual([at.values.ground, at.values.encounterTerrain], ["ashWaste", null],
    "a painted kind no table covers names its ground and leaves the table unsaid");
  assert.deepEqual([at.source.ground, at.source.encounterTerrain], ["map", null],
    "the scene default's table describes other country, so it does not answer for a painted hex");

  at = read(scene, 1, 9);
  assert.deepEqual([at.values.ground, at.values.encounterTerrain], ["grassland", "riverLand"],
    "a river painted on a hex before water was a line still reads its table; its ground is the scene's");
  assert.deepEqual([at.source.ground, at.source.encounterTerrain], ["scene", "map"]);

  at = read(scene, 5, 7);
  assert.deepEqual(at.values, {
    ground: "grassland", encounterTerrain: "grasslandSteppe", territory: "borderlands", climate: "BSk", road: "none", following: "none",
  }, "an unpainted hex off every line");
  assert.deepEqual(at.source, { ...all("scene"), road: "map", following: "map" },
    "the painted layers fall to the scene; the drawn ones answer \"none\" because the map has them");

  const bare = sceneOf({ id: "scene-bare" });
  at = read(bare, 1, 1);
  assert.deepEqual(at.values, all(null), "a map with nothing painted, drawn or said answers nothing");
  assert.deepEqual(at.source, all(null), "and names no source for it");
  assert.equal(read(bare, 1, 1, { waterBorne: true }).values.encounterTerrain, null, "afloat on no water is no river");

  const flat = sceneOf({ id: "scene-square", regions: scene.regions, walls: scene.walls, country: { ground: "jungle" }, type: 1 });
  at = read(flat, 1, 3);
  assert.deepEqual([at.values.ground, at.source.ground, at.values.territory], ["jungle", "scene", null],
    "a square map is never painted: its default answers");
  assert.deepEqual([at.values.following, at.source.following], ["river", "map"], "while a line is a line on any grid");
  assert.equal(read(flat, 1, 3, { waterBorne: true }).values.encounterTerrain, "riverDesertJungle",
    "and the river table follows the default's ground");
  invalidateRoadGraph();
}

/* --- map modes: what a GM's map draws over its terrain ----------------------
   The view is a client setting, held in memory here; a mode's plan is a
   layer's painted hexes; its borders are the sides where the value changes,
   each drawn on its own hex's side. No board exists, so the overlay draws
   nothing and what is asserted is the view, the plan, the segments and the
   window's context. The cells stand on 100-pixel squares: the neighbour
   across a side is found by mirroring the centre, which holds on any cell
   that is symmetric about its centre, a hex included. See
   docs/battlemap/DECISIONS.md, "The map shows one mode at a time". */
{
  const registered = new Map();
  const held = new Map();
  game.settings = {
    register: (ns, key, spec) => registered.set(`${ns}.${key}`, spec),
    get: (ns, key) => {
      const spec = registered.get(`${ns}.${key}`);
      if (!spec) throw new Error(`${ns}.${key} is not registered`);
      return structuredClone(held.get(`${ns}.${key}`) ?? spec.default);
    },
    set: async (ns, key, value) => {
      held.set(`${ns}.${key}`, structuredClone(value));
      registered.get(`${ns}.${key}`).onChange?.(value);
      return value;
    },
  };
  const told = [];
  Hooks.callAll = (name, ...args) => told.push([name, ...args]);

  const {
    MAP_VIEW_DEFAULT, MapModesApp, borderSegments, installMapModes, layerPlan, mapModes, mapView, modeForLayer,
    registerMapMode, registerMapViewSetting, setMapView,
  } = await import("../scripts/battlemap/map-modes.mjs");
  const { TERRITORY_COLORS, layerLabelFor, paintHexAt, terrainPaint } =
    await import("../scripts/battlemap/terrain-paint.mjs");
  const { TERRITORY_KEYS } = await import("../scripts/formation/country-keys.mjs");
  const { MODULE_ID } = await import("../scripts/lib/constants.mjs");
  game.user = { isGM: true };

  // The view, before and after its setting exists.
  assert.deepEqual(mapView(), MAP_VIEW_DEFAULT, "a view nobody registered is the default");
  registerMapViewSetting();
  const setting = registered.get(`${MODULE_ID}.mapView`);
  assert.deepEqual([setting.scope, setting.config], ["client", false], "the view is this client's, edited in its own window");
  assert.deepEqual(mapModes().map((m) => [m.key, m.layer]), [["terrain", "terrain"], ["territory", "territory"]],
    "Terrain first, then the module's own mode");
  assert.deepEqual([modeForLayer("territory"), modeForLayer("terrain"), modeForLayer("nowhere")],
    ["territory", "terrain", "terrain"], "a layer's pill shows its mode, and a layer with none shows Terrain");

  await setMapView({ mode: "territory" });
  assert.deepEqual(mapView(), { mode: "territory", opacity: 0.85, handout: false });
  assert.deepEqual(told.at(-1), ["acksExtrasMapView", mapView()], "a change is told to the road markers");
  await setMapView({ opacity: 0.5, handout: true });
  assert.deepEqual(mapView(), { mode: "territory", opacity: 0.5, handout: true }, "a patch keeps the rest of the view");
  await game.settings.set(MODULE_ID, "mapView", { mode: "nowhere", opacity: 7, handout: "yes" });
  assert.deepEqual(mapView(), { mode: "terrain", opacity: 1, handout: false },
    "a mode nobody registered is Terrain, an opacity is held to its range, and only true is a handout");
  await game.settings.set(MODULE_ID, "mapView", { mode: "territory", opacity: 0 });
  assert.equal(mapView().opacity, 0.2, "the opacity never falls below the floor a border still reads at");
  await game.settings.set(MODULE_ID, "mapView", { opacity: "x" });
  assert.equal(mapView().opacity, MAP_VIEW_DEFAULT.opacity, "and an opacity that is no number is the default's");

  // The registry.
  const none = () => [];
  const blank = () => ({ rows: [], unpainted: null });
  assert.throws(() => registerMapMode({ key: "terrain", plan: none, legend: blank }), /already registered/, "Terrain is taken");
  assert.throws(() => registerMapMode({ key: "territory", plan: none, legend: blank }), /already registered/);
  assert.throws(() => registerMapMode({ key: "", plan: none, legend: blank }), /needs a key/);
  assert.throws(() => registerMapMode({ key: "demo", legend: blank }), /plan and a legend/);
  const dispose = registerMapMode({ key: "demo", layer: "demoLayer", plan: none, legend: blank });
  // The default label is built from the key; no lang string exists for a test mode.
  const demoKey = "demo";
  assert.deepEqual(mapModes().at(-1), { key: demoKey, label: `ACKS-BATTLEMAP.mapMode.${demoKey}`, layer: "demoLayer" },
    "a mode joins last, labelled by its key where it gives no label");
  assert.equal(modeForLayer("demoLayer"), "demo");
  await setMapView({ mode: "demo" });
  dispose();
  assert.equal(mapView().mode, "terrain", "a mode taken out reads as Terrain");
  const again = registerMapMode({ key: "demo", plan: none, legend: blank });
  dispose();
  assert.ok(mapModes().some((m) => m.key === "demo"), "a spent handle cannot take a later registration");
  again();
  assert.deepEqual(mapModes().map((m) => m.key), ["terrain", "territory"]);

  // A layer's plan, and the borders it draws.
  const flags = { [MODULE_ID]: { battlemap: { calibrated: true, country: { territory: "outlands", climate: "Csb" } } } };
  const scene = paintScene({
    id: "scene-modes",
    grid: cellGrid(),
    getFlag: (ns, key) => flags[ns]?.[key],
    setFlag: async (ns, key, value) => { flags[ns] = { ...(flags[ns] ?? {}), [key]: structuredClone(value) }; },
  });
  const centre = (i, j) => ({ x: j * 100 + 50, y: i * 100 + 50 });

  assert.deepEqual(layerPlan(scene, "territory"), [], "a map with nothing painted plans nothing");
  assert.deepEqual(layerPlan(scene, "nowhere"), [], "nor does a layer the brush does not know");
  await paintHexAt(scene, centre(1, 1), "civilized", "territory");
  await paintHexAt(scene, centre(1, 2), "civilized", "territory");
  await paintHexAt(scene, centre(2, 1), "borderlands", "territory");
  await paintHexAt(scene, centre(2, 1), "forestTaiga");
  const plan = layerPlan(scene, "territory");
  assert.deepEqual(plan.toSorted((a, b) => a.key.localeCompare(b.key)), [
    { key: "1:1", value: "civilized", color: TERRITORY_COLORS.civilized },
    { key: "1:2", value: "civilized", color: TERRITORY_COLORS.civilized },
    { key: "2:1", value: "borderlands", color: TERRITORY_COLORS.borderlands },
  ], "one entry per painted hex, coloured as the layer colours it, and no other layer's hexes");

  const segments = borderSegments(scene, plan);
  const count = (color) => segments.filter((s) => s.color === color).length;
  assert.deepEqual([segments.length, count(TERRITORY_COLORS.civilized), count(TERRITORY_COLORS.borderlands)], [10, 6, 4],
    "every side but the one two civilized hexes share; a lone hex is ringed");
  // The side 1:1 and 2:1 share runs along y = 200 between x = 100 and 200.
  const shared = (list, y) => list.filter((s) => s.from.y === y && s.to.y === y && Math.max(s.from.x, s.to.x) <= 200);
  assert.deepEqual(shared(segments, 196).map((s) => s.color), [TERRITORY_COLORS.civilized],
    "where two values meet, the hex above draws its line on its own side");
  assert.deepEqual(shared(segments, 204).map((s) => s.color), [TERRITORY_COLORS.borderlands], "and the hex below on its own");
  assert.deepEqual(shared(segments, 200), [], "so neither line lies on the other");
  assert.equal(shared(borderSegments(scene, plan, 0), 200).length, 2, "with no inset the two lines share the side");
  assert.deepEqual(borderSegments(scene, []), [], "an empty plan draws nothing");

  // The window's context, which is what its template renders.
  globalThis.canvas = { scene };
  await setMapView({ mode: "territory" });
  let ctx = await new MapModesApp()._prepareContext();
  assert.deepEqual(ctx.modes, [
    { key: "terrain", label: "ACKS-BATTLEMAP.mapMode.terrain", active: false },
    { key: "territory", label: "ACKS-BATTLEMAP.mapMode.territory", active: true },
  ], "one pill per mode, the view's pressed");
  assert.deepEqual(ctx.rows.map((r) => r.color), TERRITORY_KEYS.map((k) => TERRITORY_COLORS[k]),
    "the legend lists every territory in its colour");
  assert.equal(ctx.unpainted, layerLabelFor("outlands", "territory"), "and names the scene's default for a hex with no border");
  assert.equal(ctx.climate, "Csb — ACKS-FORMATION.travel.weather.climates.Csb", "the map's climate is shown beside it");
  assert.deepEqual([ctx.terrain, ctx.opacity, ctx.opacityFloor, ctx.handout, ctx.hexScene], [false, 85, 20, false, true]);
  await setMapView({ mode: "terrain" });
  ctx = await new MapModesApp()._prepareContext();
  assert.deepEqual([ctx.terrain, ctx.rows, ctx.unpainted], [true, [], null], "Terrain has no legend of its own");

  // Following the brush. The window is opened, never drawn.
  let opened = 0;
  MapModesApp.prototype.render = function render() { opened++; this.rendered = true; return this; };
  installMapModes();
  try {
    terrainPaint.arm(null, { layer: "territory", by: "sheet" });
    assert.deepEqual([mapView().mode, opened], ["territory", 1], "arming the brush on a layer shows its mode and opens the window");
    await setMapView({ mode: "terrain" });
    terrainPaint.setBrush("borderlands");
    assert.equal(mapView().mode, "terrain", "a swatch picked leaves the mode the Judge chose");
    terrainPaint.setLayer("terrain");
    terrainPaint.setLayer("territory");
    assert.equal(mapView().mode, "territory", "a layer switched to shows its mode again");
    terrainPaint.disarm();
    assert.equal(mapView().mode, "territory", "and the mode outlives the brush");
    terrainPaint.arm(null, { layer: "terrain", by: "sheet" });
    assert.equal(mapView().mode, "terrain", "arming on terrain is the way back");
  } finally {
    terrainPaint.disarm();
    terrainPaint.setLayer("terrain");
    delete MapModesApp.prototype.render;
    delete globalThis.canvas;
  }
}

/* --- a layer that derives the territory -------------------------------------
   A hex painted on a deriving layer — the domains feature's, here a stand-in
   whose values are invented realms — takes the territory its value implies,
   and `source` names the layer. A territory painted on the hex is the Judge's
   word over it; the Territory mode draws both, and stripes a hex in the
   derived class where the painted one differs. A mode may weigh its sides,
   and a heavier line is drawn further in. 100-pixel square cells, as above.
   See docs/battlemap/DECISIONS.md, "A layer derives the territory". */
{
  const { countryAt } = await import("../scripts/battlemap/country.mjs");
  const { MapModesApp, borderSegments, registerMapMode, setMapView, stripeSegments, territoryPlan } =
    await import("../scripts/battlemap/map-modes.mjs");
  const {
    DERIVED_KEYS, PAINT_LAYER_CHANGED_HOOK, TERRITORY_COLORS, derivedHexes, derivedValueAt, paintLayerChanged, registerPaintLayer,
  } = await import("../scripts/battlemap/terrain-paint.mjs");
  const { MODULE_ID } = await import("../scripts/lib/constants.mjs");

  const classOf = { realm1: "civilized", realm2: "borderlands", realm3: null };
  const spec = (over = {}) => ({
    key: "demoRealm",
    flag: "demoRealm",
    values: () => Object.keys(classOf),
    label: (v) => v,
    color: () => "#123456",
    derives: { key: "territory", of: (v) => classOf[v] ?? null },
    ...over,
  });
  assert.deepEqual(DERIVED_KEYS, ["territory"], "the territory is the one key a reader asks a layer to derive");
  assert.throws(() => registerPaintLayer(spec({ derives: { key: "climate", of: () => null } })), /derives names no key/);
  assert.throws(() => registerPaintLayer(spec({ derives: { key: "territory" } })), /needs an `of`/);
  const dispose = registerPaintLayer(spec());
  try {
    assert.throws(() => registerPaintLayer(spec({ key: "demoRival", flag: "demoRival" })),
      /"demoRealm" already derives territory/, "one layer to a derived key, as one to a flag");

    const grid = cellGrid();
    const realm = (value, hexes) => paintRegion({ grid, flag: "demoRealm", value, cells: hexes });
    const territory = (value, hexes) => paintRegion({ grid, flag: "territory", value, cells: hexes });
    const scene = {
      id: "scene-derived",
      grid,
      regions: [
        realm("realm1", ["1:1", "1:2", "1:3"]), realm("realm2", ["2:1"]), realm("realm3", ["1:4"]), realm("realmGone", ["1:5"]),
        territory("outlands", ["1:2"]), territory("civilized", ["1:3"]), territory("borderlands", ["1:6"]),
      ],
      walls: [],
      getFlag: (_ns, key) => (key === "battlemap" ? { country: { territory: "unsettled" } } : undefined),
    };
    const centre = (i, j) => ({ x: j * 100 + 50, y: i * 100 + 50 });
    const territoryAt = (i, j) => {
      const got = countryAt(scene, centre(i, j));
      return [got.territory, got.source.territory];
    };

    // The derived answer, at a point and across the scene.
    assert.deepEqual(derivedValueAt(scene, centre(1, 1), "territory"), { value: "civilized", layer: "demoRealm" });
    assert.equal(derivedValueAt(scene, centre(1, 4), "territory"), null, "a value that implies no class derives nothing");
    assert.equal(derivedValueAt(scene, centre(1, 5), "territory"), null, "nor does one its layer no longer knows");
    assert.equal(derivedValueAt(scene, centre(1, 1), "climate"), null, "and no layer derives any other key");
    assert.deepEqual(derivedHexes(scene, "territory").map((h) => [h.key, h.value, h.layer]), [
      ["1:1", "civilized", "demoRealm"], ["1:2", "civilized", "demoRealm"], ["1:3", "civilized", "demoRealm"],
      ["2:1", "borderlands", "demoRealm"],
    ], "every hex its layer derives a class for, and no other");

    // The one reader.
    assert.deepEqual(territoryAt(1, 1), ["civilized", "demoRealm"], "a hex painted into a realm takes its class, and names the layer");
    assert.deepEqual(territoryAt(2, 1), ["borderlands", "demoRealm"]);
    assert.deepEqual(territoryAt(1, 2), ["outlands", "map"], "a territory painted over it is the Judge's word");
    assert.deepEqual(territoryAt(1, 3), ["civilized", "map"], "and answers as the map's even where it agrees, so it outlives a change of class");
    assert.deepEqual(territoryAt(1, 4), ["unsettled", "scene"], "a realm with no class leaves the scene's default to answer");
    assert.deepEqual(territoryAt(1, 5), ["unsettled", "scene"]);
    assert.deepEqual(territoryAt(1, 6), ["borderlands", "map"], "a territory painted where no realm is, as on a sea hex");

    // The Territory mode's plan.
    const plan = territoryPlan(scene).toSorted((a, b) => a.key.localeCompare(b.key));
    assert.deepEqual(plan, [
      { key: "1:1", value: "civilized", color: TERRITORY_COLORS.civilized, stripe: null },
      { key: "1:2", value: "outlands", color: TERRITORY_COLORS.outlands, stripe: TERRITORY_COLORS.civilized },
      { key: "1:3", value: "civilized", color: TERRITORY_COLORS.civilized, stripe: null },
      { key: "1:6", value: "borderlands", color: TERRITORY_COLORS.borderlands, stripe: null },
      { key: "2:1", value: "borderlands", color: TERRITORY_COLORS.borderlands, stripe: null },
    ], "every hex with a territory, painted or derived; a painted one striped in the derived class where the two differ");
    const sharesBorder = borderSegments(scene, plan).filter((s) => s.from.x === s.to.x && Math.abs(s.from.x - 200) < 5
      && Math.min(s.from.y, s.to.y) >= 100 && Math.max(s.from.y, s.to.y) <= 200);
    assert.deepEqual(sharesBorder.map((s) => s.color).sort(), [TERRITORY_COLORS.civilized, TERRITORY_COLORS.outlands].sort(),
      "the override meets its realm's class with two lines, one in each hex");

    // The stripes: lines of one sum x + y, each ending on the hex as the borders pull it in.
    const stripes = stripeSegments(scene, plan);
    // The cell's corners pulled 8% of the way to its centre: 204..296 by 104..196.
    assert.equal(stripes.length, 9, "a hundred-pixel cell at a fourteen-pixel spacing");
    assert.ok(stripes.every((s) => s.color === TERRITORY_COLORS.civilized), "only the striped hex, in the derived class");
    const inRing = (p) => p.x >= 203.99 && p.x <= 296.01 && p.y >= 103.99 && p.y <= 196.01;
    const onEdge = (p) => [204, 296].some((x) => Math.abs(p.x - x) < 1e-6) || [104, 196].some((y) => Math.abs(p.y - y) < 1e-6);
    assert.ok(stripes.every((s) => inRing(s.from) && inRing(s.to) && onEdge(s.from) && onEdge(s.to)),
      "each stripe runs edge to edge of the inset cell and never across a border");
    assert.ok(stripes.every((s) => Math.abs((s.from.x + s.from.y) - (s.to.x + s.to.y)) < 1e-6), "each runs up to the right");
    const sums = stripes.map((s) => s.from.x + s.from.y).sort((a, b) => a - b);
    assert.ok(sums.slice(1).every((c, n) => Math.abs((c - sums[n]) / Math.SQRT2 - 14) < 1e-6), "fourteen pixels apart, measured across");
    assert.deepEqual(stripeSegments(scene, plan.map((h) => ({ ...h, stripe: null }))), [], "a plan with no stripe draws none");

    // A side's weight, and the inset that keeps a heavy line inside its hex.
    const top = (list) => list.find((s) => s.from.y === s.to.y && s.from.x > 100 && s.to.x < 200 && s.from.y < 150);
    assert.equal(top(borderSegments(scene, plan)).weight, 1, "a mode that gives no weights draws every side at 1");
    assert.equal(top(borderSegments(scene, plan)).from.y, 104);
    const weighed = borderSegments(scene, plan, undefined, (_value, across) => (across === null ? 5 : 0.1));
    assert.equal(top(weighed).weight, 2, "a weight is held to the heaviest a hex takes");
    near(top(weighed).from.y, 108, 1e-9, "and its corners are pulled in by as much again");
    const right = weighed.find((s) => s.from.x === s.to.x && s.from.x > 150 && s.from.x < 200 && s.from.y > 100 && s.to.y < 200);
    assert.equal(right.weight, 0.4, "and to the lightest that still reads, against a neighbour holding another value");
    near(right.from.x, 198.4, 1e-9, "a light line keeps its outer edge on the side too");
    assert.ok(borderSegments(scene, plan, undefined, () => "x").every((s) => s.weight === 1), "a weight that is no number weighs 1");
    assert.throws(() => registerMapMode({ key: "demoWeights", plan: () => [], legend: () => ({ rows: [] }), weights: 3 }), /no function/);

    // The window says what a stripe means where the map shows one. The block
    // above opened the window, so a view change redraws it: drawn, never rendered.
    MapModesApp.prototype.render = function render() { return this; };
    globalThis.canvas = { scene };
    await setMapView({ mode: "territory" });
    let ctx = await new MapModesApp()._prepareContext();
    assert.equal(ctx.stripes, "ACKS-BATTLEMAP.mapMode.stripes");
    scene.regions = scene.regions.filter((r) => r.getFlag(MODULE_ID, "territory") !== "outlands");
    ctx = await new MapModesApp()._prepareContext();
    assert.equal(ctx.stripes, null, "and says nothing of stripes where none is drawn");
    await setMapView({ mode: "terrain" });
    delete globalThis.canvas;
    delete MapModesApp.prototype.render;

    // A layer whose values changed meaning is told on, for the overlay and the palette.
    const told = [];
    Hooks.callAll = (...args) => told.push(args);
    paintLayerChanged("demoRealm");
    assert.deepEqual(told, [[PAINT_LAYER_CHANGED_HOOK, "demoRealm"]]);
  } finally {
    dispose();
  }
  assert.equal(derivedValueAt({ regions: [], grid: { type: CONST.GRID_TYPES.HEXODDR } }, { x: 0, y: 0 }, "territory"), null,
    "a layer taken out derives nothing more");
  assert.doesNotThrow(() => dispose(), "and its spent handle removes nothing");
}

/* -------------------------------------------- */
/*  Hex preview — the fitted lattice's outlines  */
/* -------------------------------------------- */

// `hexPreviewOutlines` is the geometry under the canvas preview: pure, so it is
// walked here on the four hex types and on both images. The shape of a hex is
// the probe's, scaled per axis by the fit's `k`; where the image is stretched
// the two axes differ, so a swapped or averaged `k` is a different, wrong hex.
{
  const FOUR_CELLS = [[0, 0], [1, 0], [2, 1], [3, 0], [0, 2]];
  const RECTS = { large: { x: 0, y: 0, w: 6000, h: 6000 }, stretched: { x: 0, y: 0, w: 900, h: 900 } };
  const centroid = (poly) => ({ x: poly.reduce((a, p) => a + p.x, 0) / poly.length, y: poly.reduce((a, p) => a + p.y, 0) / poly.length });
  const byCentre = (polys, pt) => polys.find((poly) => { const c = centroid(poly); return Math.hypot(c.x - pt.x, c.y - pt.y) < 1e-6; });
  const nodeCentre = (fit, { i, j }) => ({ x: fit.centre.x + i * fit.spacing.u.x + j * fit.spacing.v.x, y: fit.centre.y + i * fit.spacing.u.y + j * fit.spacing.v.y });
  const strictlyInside = (p, poly) => {
    const sides = poly.map((a, n) => { const b = poly[(n + 1) % poly.length]; return Math.sign((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)); });
    return sides.every((s) => s !== 0 && s === sides[0]);
  };
  const sharedCorners = (a, b) => a.filter((p) => b.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-6)).length;
  // Every placed box's hex, with its two lattice neighbours, is drawn and the
  // pair shares an edge (two corners).
  const edgesShared = (fit, polys) => fit.boxes.every(({ cell }) => {
    const c = nodeCentre(fit, cell);
    return [fit.spacing.u, fit.spacing.v].every((step) => {
      const a = byCentre(polys, c);
      const b = byCentre(polys, { x: c.x + step.x, y: c.y + step.y });
      return !!a && !!b && sharedCorners(a, b) >= 2;
    });
  });
  const boxCentre = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

  for (const t of HEX_TYPES_UNDER_TEST) {
    for (const [imageName, image] of Object.entries(IMAGES)) {
      const where = `${t.name}, ${imageName}`;
      const boxes = boxesAt(t, image, FOUR_CELLS);
      const fit = fitFor(t, image, boxes);
      assert.equal(fit.ok, true, where);
      assert.ok(fit.boxes.every((b) => b.cell), `${where}: every box is placed`);
      const outlines = (over = {}) => hexPreviewOutlines({ fit, vertices: t.probe.vertices, rect: RECTS[imageName], max: 100000, ...over });
      const polys = outlines();
      assert.ok(polys.length > 20, `${where}: the rect holds a field of hexes (${polys.length})`);
      assert.ok(polys.every((poly) => poly.length === t.probe.vertices.length), `${where}: a polygon has the probe's corners`);
      // Each drawn box sits inside the hex of its node, centred on it.
      boxes.forEach((box, n) => {
        const node = byCentre(polys, nodeCentre(fit, fit.boxes[n].cell));
        assert.ok(node, `${where}: box ${n}'s node is drawn`);
        assert.ok(strictlyInside(boxCentre(box), node), `${where}: box ${n}'s centre is inside its hex`);
        near(centroid(node).x, boxCentre(box).x, 1e-6, `${where}: box ${n} x`);
        near(centroid(node).y, boxCentre(box).y, 1e-6, `${where}: box ${n} y`);
      });
      assert.equal(edgesShared(fit, polys), true, `${where}: neighbours along u and v share an edge`);

      if (imageName === "stretched") {
        const { x: kx, y: ky } = fit.k;
        assert.ok(Math.abs(kx - ky) > 0.05, `${where}: the image's axes differ, so a wrong k can show`);
        const m = (kx + ky) / 2;
        for (const [wrong, k] of [["swapped", { x: ky, y: kx }], ["averaged", { x: m, y: m }]]) {
          const bad = hexPreviewOutlines({ fit: { ...fit, k }, vertices: t.probe.vertices, rect: RECTS[imageName], max: 100000 });
          assert.equal(edgesShared(fit, bad), false, `${where}: a ${wrong} k breaks the shared edge`);
        }
      }
    }
  }

  // The cap: a rect holding thousands of nodes returns exactly `max`, the ones
  // nearest the focus, and the drawn box's own hex is among them. The box sits
  // far from the rect's scan start, so the first `max` in scan order fail it.
  for (const t of HEX_TYPES_UNDER_TEST) {
    const where = `${t.name}, capped`;
    const box = hexBox(t, IMAGES.stretched, 40, 30);
    const fit = fitFor(t, IMAGES.stretched, [box]);
    assert.equal(fit.ok, true, where);
    const rect = RECTS.large;
    const focus = boxCentre(box);
    const capped = hexPreviewOutlines({ fit, vertices: t.probe.vertices, rect, focus: [focus], max: 200 });
    assert.equal(capped.length, 200, `${where}: exactly max`);
    assert.ok(byCentre(capped, nodeCentre(fit, fit.boxes[0].cell)), `${where}: the drawn box's node is drawn`);
    // Brute force: the nearest `cap` nodes of the whole lattice that touch the rect.
    const rx = Math.max(...t.probe.vertices.map((p) => Math.abs(p.x * fit.k.x)));
    const ry = Math.max(...t.probe.vertices.map((p) => Math.abs(p.y * fit.k.y)));
    const nearestTo = (at, cap, label) => {
      const all = [];
      for (let i = -600; i <= 600; i++) {
        for (let j = -600; j <= 600; j++) {
          const c = nodeCentre(fit, { i, j });
          if (c.x < rect.x - rx || c.x > rect.x + rect.w + rx || c.y < rect.y - ry || c.y > rect.y + rect.h + ry) continue;
          all.push(Math.hypot(c.x - at.x, c.y - at.y));
        }
      }
      assert.ok(all.length > 5 * cap, `${label}: the rect holds far more than the cap (${all.length})`);
      all.sort((a, b) => a - b);
      const out = hexPreviewOutlines({ fit, vertices: t.probe.vertices, rect, focus: [at], max: cap });
      assert.equal(out.length, cap, `${label}: exactly max`);
      const got = out.map((poly) => { const c = centroid(poly); return Math.hypot(c.x - at.x, c.y - at.y); }).sort((a, b) => a - b);
      got.forEach((d, n) => near(d, all[n], 1e-6, `${label}: the ${n}th nearest`));
    };
    nearestTo(focus, 200, `${where}, mid-rect`);
    // A focus at the rect's corner leaves a quarter of any ball outside it, so
    // the search must widen to find `max` and still return the nearest.
    nearestTo({ x: 5, y: 5 }, 400, `${where}, corner`);
    nearestTo({ x: 3, y: 5990 }, 400, `${where}, other corner`);

    // Fewer nodes than the cap: all of them, and exactly those that touch the rect.
    const small = { x: 200, y: 100, w: 300, h: 300 };
    let touching = 0;
    for (let i = -600; i <= 600; i++) {
      for (let j = -600; j <= 600; j++) {
        const c = nodeCentre(fit, { i, j });
        if (c.x >= small.x - rx && c.x <= small.x + small.w + rx && c.y >= small.y - ry && c.y <= small.y + small.h + ry) touching++;
      }
    }
    assert.ok(touching > 5 && touching < 100000, where);
    assert.equal(hexPreviewOutlines({ fit, vertices: t.probe.vertices, rect: small, max: 100000 }).length, touching, `${where}: a small rect gets every hex that touches it`);
    assert.equal(hexPreviewOutlines({ fit, vertices: t.probe.vertices, rect: small, max: touching - 3 }).length, touching - 3, `${where}: and the cap trims it`);
    // The default cap is the named constant.
    assert.ok(Number.isInteger(HEX_PREVIEW_MAX) && HEX_PREVIEW_MAX >= 100, "the named cap");
    const huge = hexPreviewOutlines({ fit, vertices: t.probe.vertices, rect: { x: 0, y: 0, w: 30000, h: 30000 } });
    assert.equal(huge.length, HEX_PREVIEW_MAX, `${where}: the default cap`);
    // With no focus the hexes nearest the fitted centre are drawn.
    const nearest = hexPreviewOutlines({ fit, vertices: t.probe.vertices, rect, max: 1 });
    near(centroid(nearest[0]).x, fit.centre.x, 1e-6, `${where}: no focus draws near the fitted centre (x)`);
    near(centroid(nearest[0]).y, fit.centre.y, 1e-6, `${where}: no focus draws near the fitted centre (y)`);
  }

  // Boxes far apart: the focus is every box, so the cap keeps both hexes, and a
  // focus on one box alone does not reach the other.
  for (const t of HEX_TYPES_UNDER_TEST) {
    const where = `${t.name}, two boxes`;
    const near0 = hexBox(t, IMAGES.large, 0, 0);
    const far = hexBox(t, IMAGES.large, 25, 0);
    const fit = fitFor(t, IMAGES.large, [near0, far]);
    assert.equal(fit.ok, true, where);
    const both = hexPreviewOutlines({ fit, vertices: t.probe.vertices, rect: RECTS.large, focus: [near0, far].map(boxCentre), max: 2 });
    assert.equal(both.length, 2, where);
    assert.ok(byCentre(both, boxCentre(near0)) && byCentre(both, boxCentre(far)), `${where}: both boxes' hexes are drawn`);
    const alone = hexPreviewOutlines({ fit, vertices: t.probe.vertices, rect: RECTS.large, focus: [boxCentre(near0)], max: 2 });
    assert.equal(byCentre(alone, boxCentre(far)), undefined, `${where}: a focus on one box leaves the far one out`);
  }

  // Nothing is drawn without a fit or without corners, and a good call is not empty.
  {
    const t = HEX_TYPES_UNDER_TEST[0];
    const fit = fitFor(t, IMAGES.large, boxesAt(t, IMAGES.large, FOUR_CELLS));
    const good = { fit, vertices: t.probe.vertices, rect: RECTS.large };
    assert.ok(hexPreviewOutlines(good).length > 0, "control: the good call draws");
    const line = { x: fit.spacing.u.x * 2, y: fit.spacing.u.y * 2 };
    const nothing = {
      "no input": undefined,
      "no fit": { ...good, fit: null },
      "a failed fit": { ...good, fit: { ok: false, reason: "noBoxes", samples: 0 } },
      "a fit with no lattice": { ...good, fit: { ok: true, sizeX: 100, sizeY: 100 } },
      "no vertices": { ...good, vertices: undefined },
      "empty vertices": { ...good, vertices: [] },
      "two vertices": { ...good, vertices: t.probe.vertices.slice(0, 2) },
      "a vertex that is no point": { ...good, vertices: [...t.probe.vertices.slice(1), { x: NaN, y: 0 }] },
      "a spacing that is no number": { ...good, fit: { ...fit, spacing: { ...fit.spacing, v: { x: NaN, y: 1 } } } },
      "a lattice of one line": { ...good, fit: { ...fit, spacing: { u: fit.spacing.u, v: line } } },
      "an empty rect": { ...good, rect: { x: 0, y: 0, w: 0, h: 100 } },
      "no rect": { ...good, rect: null },
      "a cap of zero": { ...good, max: 0 },
    };
    for (const [what, input] of Object.entries(nothing)) assert.deepEqual(hexPreviewOutlines(input), [], `nothing for ${what}`);
  }
}

/* -------------------------------------------- */
/*  Capture keys: a typed field keeps its keys   */
/* -------------------------------------------- */

{
  /** A node the way the handler reads one: `nodeType`, `matches`, `isContentEditable`. */
  const node = (tag, { type, editable = false } = {}) => ({
    nodeType: 1,
    type,
    isContentEditable: editable,
    matches: (sel) => sel.split(",").map((s) => s.trim()).includes(tag),
  });
  const key = (code, target, extra = {}) => ({
    code, target, ctrlKey: false, metaKey: false, prevented: false, stopped: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; },
    ...extra,
  });

  /** An overlay over a fake host holding two squares, plus the disarm count. */
  const overlayOf = () => {
    const host = {
      samples: { squares: [{ x: 0, y: 0, w: 1, h: 1 }, { x: 5, y: 5, w: 1, h: 1 }], corners: [], scale: null },
      disarms: 0,
      onSamplesChanged() {},
      requestDisarm() { this.disarms += 1; },
    };
    const overlay = new CaptureOverlay(host);
    overlay.redraw = () => {};
    return { host, overlay };
  };

  const undoFrom = (target, extra = { ctrlKey: true }) => {
    const { host, overlay } = overlayOf();
    const ev = key("KeyZ", target, extra);
    overlay.onKeyDown(ev);
    return { ev, left: host.samples.squares.length };
  };

  const canvasLike = { nodeType: 1, matches: () => false, isContentEditable: false };
  for (const [what, target] of [
    ["a text input", node("input", { type: "text" })],
    ["an input with no type", node("input")],
    ["a number input", node("input", { type: "number" })],
    ["a textarea", node("textarea")],
    ["a select", node("select")],
    ["a contenteditable div", node("div", { editable: true })],
  ]) {
    for (const [mod, extra] of [["Ctrl", { ctrlKey: true }], ["Cmd", { metaKey: true }]]) {
      const { ev, left } = undoFrom(target, extra);
      assert.equal(left, 2, `${mod}+Z from ${what} removes no sample`);
      assert.equal(ev.prevented || ev.stopped, false, `${mod}+Z from ${what} is left to the field's own undo`);
    }
    const { host, overlay } = overlayOf();
    const esc = key("Escape", target);
    overlay.onKeyDown(esc);
    assert.equal(host.disarms, 0, `Escape from ${what} does not disarm`);
    assert.equal(esc.prevented || esc.stopped, false, `Escape from ${what} is left to the field`);
  }

  // A shadow root retargets `ev.target`; the composed path still names the field.
  {
    const { host, overlay } = overlayOf();
    const ev = key("KeyZ", canvasLike, {
      ctrlKey: true,
      composedPath: () => [node("input", { type: "text" }), canvasLike],
    });
    overlay.onKeyDown(ev);
    assert.equal(host.samples.squares.length, 2, "a field behind a retargeted target keeps its Ctrl+Z");
  }

  // Controls that take no typed text, the canvas, the body and a dead target keep the overlay's keys.
  for (const [what, target] of [
    ["the canvas", canvasLike],
    ["the body", node("body")],
    ["a checkbox", node("input", { type: "checkbox" })],
    ["a button", node("button")],
    ["no target", undefined],
    ["a non-element node", { nodeType: 3 }],
  ]) {
    const { ev, left } = undoFrom(target);
    assert.equal(left, 1, `Ctrl+Z from ${what} removes the last sample`);
    assert.equal(ev.prevented && ev.stopped, true, `Ctrl+Z from ${what} is taken`);
    const { host, overlay } = overlayOf();
    const esc = key("Escape", target);
    overlay.onKeyDown(esc);
    assert.equal(host.disarms, 1, `Escape from ${what} disarms`);
    assert.equal(esc.prevented && esc.stopped, true, `Escape from ${what} is taken`);
  }
  assert.equal(isEditableTarget(undefined), false, "no event is not an editable origin");

  // The scene configuration button opens the scene whose sheet it sits on.
  const source = readFileSync(new URL("../scripts/battlemap/module.mjs", import.meta.url), "utf8");
  assert.match(source, /acks-extras-battlemap-open"\)\.addEventListener\("click", \(\) => openAssistant\(scene\)\)/,
    "the scene config button opens the assistant on its own scene");
}

/* -------------------------------------------- */
/*  The size chips                              */
/* -------------------------------------------- */

{
  // Invented figures: a 7 ft square; small is one square, large 3 × 2, huge is
  // a fraction of one; gigantic prints no frontage and the rest are absent.
  const keys = Object.keys(SIZES);
  const imported = (priority = PRIORITY.WORLD, pages = "XX 1") => {
    resetTables();
    registerTable(
      {
        id: SIZE_DOC,
        ...(pages ? { source: { pages } } : {}),
        tables: { [SIZE_TABLE]: { [SIZE_ROW]: { small: "1 sq", large: "3 × 2", huge: "1/2 sq", gigantic: "n/a" } }, [SQUARE_TABLE]: { [SIZE_ROW]: { feet: 7 } } },
      },
      { priority },
    );
  };

  // Nothing imported: no chip (the cell-multiple ladder this replaced drew six on every scene).
  resetTables();
  assert.deepEqual(sizeChips({ keys, feetPerSquare: sizeSquareFeet(), feetPerCell: 100 }), [], "no import, no chips");
  assert.deepEqual(sizeChips({ keys, feetPerSquare: 7, feetPerCell: 100 }), [], "a square with no frontage imported offers none");

  imported();
  const chips = sizeChips({ keys, feetPerSquare: sizeSquareFeet(), feetPerCell: 100 });
  assert.deepEqual(chips.map((c) => c.key), ["small", "large", "huge"], "in the category order, and only those the import answers: gigantic has no frontage");
  const large = chips.find((c) => c.key === "large");
  assert.deepEqual(large.feet, { w: 21, h: 14 }, "frontage times the square: 3 × 2 squares of 7 ft");
  assert.deepEqual(large.span, { w: tokenSpan(21, 100), h: tokenSpan(14, 100) }, "drawn by the sizer's own rounding");
  assert.deepEqual(large.span, { w: SPAN_MIN, h: SPAN_MIN }, "which on a 100 ft cell is the floor");
  assert.deepEqual(chips.find((c) => c.key === "small").feet, { w: 7, h: 7 });
  assert.deepEqual(chips.find((c) => c.key === "huge").feet, { w: 7, h: 7 }, "a fraction of a square is held to one");
  assert.deepEqual(sizeChips({ keys, feetPerSquare: 7, feetPerCell: 5 }).find((c) => c.key === "large").span, { w: 4.25, h: 2.75 }, "and on a 5 ft cell, quarter-cell steps");
  assert.deepEqual(sizeChips({ keys: ["large"], feetPerSquare: 7, feetPerCell: 0 })[0].span, { w: SPAN_MIN, h: SPAN_MIN }, "a cell with no worth draws at the floor and does not throw");
  assert.deepEqual(sizeChips({ keys, feetPerSquare: null, feetPerCell: 100 }), [], "the frontage without the square offers none");
  assert.deepEqual(sizeChips(), [], "no arguments, no chips");

  // The same figures held by the override layer alone: chips, and no page to cite.
  imported(PRIORITY.OVERRIDE, null);
  assert.equal(sizeCite(), null, "a hand-set value cites no page");
  assert.deepEqual(sizeChips({ keys, feetPerSquare: sizeSquareFeet(), feetPerCell: 100 }).find((c) => c.key === "large").feet, { w: 21, h: 14 });
  resetTables();
}

/* --- re-keying grid cells under a moved grid -------------------------------
   Proves the pure decision behind Apply's re-key: a grid shape's cell stays
   where it is on the map, and its offset becomes the cell of the NEW grid that
   place lies in. Two old cells of one group landing on one new cell leave the
   one nearest the new cell's centre; a group is a paint layer's regions
   together, or one shape alone; an unchanged grid changes nothing. The lattice
   is invented: pointy cells of `size` across, from an origin. */
{
  const lattice = (size, ox = 0, oy = 0) => {
    const radius = size / Math.sqrt(3);
    const rowStep = 1.5 * radius;
    const centreOf = ({ i, j }) => ({ x: ox + (j + (i % 2 ? 1 : 0.5)) * size, y: oy + i * rowStep + radius });
    const offsetOf = (p) => {
      let best = null;
      for (let i = -2; i < 40; i++) {
        for (let j = -2; j < 40; j++) {
          const c = centreOf({ i, j });
          const d = Math.hypot(c.x - p.x, c.y - p.y);
          if (!best || d < best.d) best = { d, i, j };
        }
      }
      return { i: best.i, j: best.j };
    };
    return { centreOf, offsetOf };
  };
  const key = (o) => hexKeyOf(o);
  const oldGrid = lattice(41);
  const cells = [{ i: 4, j: 5 }, { i: 4, j: 6 }, { i: 5, j: 5 }, { i: 8, j: 2 }];
  /** A region's cells as Apply hands them over: each with the place it lies on the map. */
  const region = (id, list, { group = "layer:terrain", index = 0 } = {}) => ({
    id, shapes: [{ index, group, cells: list.map((c) => ({ ...c, ...oldGrid.centreOf(c) })) }],
  });
  const offsetsOf = (result, n = 0) => result.shapes[n].offsets.map(key);

  // Size 41 to 45 with a shift: each offset is the cell its place now lies in.
  const grown = lattice(45, 7, -3);
  const [moved] = rekeyGridCells([region("a", cells)], grown);
  assert.equal(moved.changed, true);
  assert.equal(moved.shapes[0].offsets.length, cells.length, "no two of these cells land on one");
  cells.forEach((cell, n) => {
    const at = oldGrid.centreOf(cell);
    const expected = grown.offsetOf(at);
    assert.equal(offsetsOf(moved)[n], key(expected), `${key(cell)} becomes the cell its place now lies in`);
    assert.ok(Math.hypot(grown.centreOf(expected).x - at.x, grown.centreOf(expected).y - at.y) < 45, "the cell is the one beneath the old one");
  });
  assert.notDeepEqual(offsetsOf(moved), cells.map(key), "the offsets moved with the grid");

  // Two old cells landing on one new cell: the one nearest its centre keeps it, whichever came first.
  const coarse = lattice(90);
  const pair = [{ i: 4, j: 5 }, { i: 5, j: 5 }];
  const landed = pair.map((c) => key(coarse.offsetOf(oldGrid.centreOf(c))));
  assert.equal(landed[0], landed[1], "the fixture puts both old cells in one new cell");
  const [merged] = rekeyGridCells([region("a", pair)], coarse);
  assert.deepEqual(offsetsOf(merged), [landed[0]], "one offset remains");
  const target = coarse.centreOf(coarse.offsetOf(oldGrid.centreOf(pair[0])));
  const dist = (c) => Math.hypot(oldGrid.centreOf(c).x - target.x, oldGrid.centreOf(c).y - target.y);
  const nearest = dist(pair[0]) <= dist(pair[1]) ? pair[0] : pair[1];
  const farthest = nearest === pair[0] ? pair[1] : pair[0];
  assert.ok(dist(nearest) < dist(farthest), "the fixture's two cells are not equally near");
  assert.deepEqual(offsetsOf(rekeyGridCells([region("a", [farthest, nearest])], coarse)[0]),
    offsetsOf(rekeyGridCells([region("a", [nearest, farthest])], coarse)[0]), "the same cell survives whichever came first");

  // Across the regions of one layer: one value per hex, so the farther region loses the cell and is left holding none.
  const [lost, won] = rekeyGridCells([region("far", [farthest]), region("near", [nearest])], coarse);
  assert.deepEqual([lost.id, lost.shapes[0].offsets.length, won.id, won.shapes[0].offsets.length], ["far", 0, "near", 1],
    "the region whose cell was farther is left with none");
  assert.ok(lost.changed && won.changed === true, "and both are rewritten");

  // A shape no layer owns stands alone: another region's cell on the same new cell is no rival, and nor is its own other shape.
  const zones = rekeyGridCells([
    region("zoneA", [farthest], { group: null }), region("zoneB", [nearest], { group: null }),
    { id: "zoneC", shapes: [region("c", [farthest], { group: null }).shapes[0], { ...region("c", [nearest], { group: null }).shapes[0], index: 1 }] },
  ], coarse);
  assert.deepEqual(zones.map((r) => r.shapes.map((sh) => sh.offsets.length)), [[1], [1], [1, 1]], "a zone's cell is dropped only by a cell of its own shape");

  // A hole in a paint region is a shape of its own: it never costs the layer a painted cell, nor the layer's cell it.
  const withHole = { id: "p", shapes: [region("p", [nearest]).shapes[0], { ...region("p", [farthest], { group: null }).shapes[0], index: 1 }] };
  const [holed] = rekeyGridCells([withHole], coarse);
  assert.deepEqual(holed.shapes.map((sh) => sh.offsets.length), [1, 1], "a hole's cell and a painted cell landing together both stay");

  // An unchanged grid changes nothing, in any region.
  const unchanged = rekeyGridCells([region("a", cells), region("b", [{ i: 10, j: 10 }])], oldGrid);
  assert.ok(unchanged.every((r) => !r.changed), "nothing is rewritten under a grid that did not move");
  assert.deepEqual(offsetsOf(unchanged[0]), cells.map(key));

  // A cell whose place names no cell keeps its offset.
  const blind = { centreOf: grown.centreOf, offsetOf: () => null };
  const [kept] = rekeyGridCells([region("a", [cells[0]])], blind);
  assert.deepEqual([offsetsOf(kept), kept.changed], [[key(cells[0])], false]);
}

console.log("test-battlemap: OK (hex keys, labels, one cell in and out of a region's grid shape, a cell two regions claim, paints moving between values and a burst of ten, palette coverage, the re-key of grid cells under a moved grid, open vocabulary, road row escaping, whole-line segments, road distance, the territory layer, the brush over a window, the scene's default country, the country under a point, the map modes and their borders, a layer deriving the territory, its stripes and weighed sides, the hex preview's outlines and cap, the not-to-scale predicate, the footprint a token is judged by, the mark's listener, key and readout, capture keys left to a typed field, the scene config button's scene, the size chips)");
