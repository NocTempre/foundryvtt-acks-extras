/**
 * Battlemap calibration: the grid solver and the footprint arithmetic.
 * Pure functions; no Foundry, no world. Synthetic lattices only — no value
 * here is read off a page.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { boxCells, fitGrid, feetPerSquare, hexSizeFromBox, pixelsPerUnit, roundSuggestions, outputGridSize, scaleOnlyGrid, solveShift } from "../scripts/battlemap/calibrate-logic.mjs";
import { footprintFeet, tokenSpan, SPAN_MIN } from "../scripts/battlemap/footprint.mjs";
import { hexAlignment } from "../scripts/battlemap/hex-fit.mjs";
import { SIZES } from "../scripts/monsters/config.mjs";

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
  const fit = fitGrid({ squares: [{ x: 10, y: 20, w: 3 * s, h: 3 * s, cells: 3 }], corners: [] });
  assert.equal(fit.ok, true);
  near(fit.sizeX, s, 1e-6, "three-cell box");
  // An absent or nonsense count is one cell, never zero: a divide by it would
  // hand the apply an infinity that Foundry drops in silence.
  assert.equal(boxCells({}), 1);
  assert.equal(boxCells({ cells: 0 }), 1);
  assert.equal(boxCells({ cells: -2 }), 1);
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
  // Override wins outright; size category converts its squares; default is one square.
  assert.deepEqual(footprintFeet({ override: { w: 12, h: 8 } }), { w: 12, h: 8 });
  const large = footprintFeet({ sizeKey: "large", sizes: SIZES, feetPerSquare: 5 });
  assert.deepEqual(large, { w: SIZES.large.footprint.w * 5, h: SIZES.large.footprint.h * 5 });
  assert.deepEqual(footprintFeet({ feetPerSquare: 5 }), { w: 5, h: 5 });
  assert.deepEqual(footprintFeet({ sizeKey: "nonsense", sizes: SIZES, feetPerSquare: 5 }), { w: 5, h: 5 });
}

{
  assert.equal(tokenSpan(5, 5), 1);
  assert.equal(tokenSpan(10, 5), 2);
  assert.equal(tokenSpan(12.5, 5), 2.5);
  assert.equal(tokenSpan(6, 5), 1.25);
  assert.equal(tokenSpan(5, 100), SPAN_MIN); // the quarter-square floor
  assert.equal(tokenSpan(0, 5), SPAN_MIN);
}

// Every SIZES entry carries a usable numeric footprint.
for (const [key, entry] of Object.entries(SIZES)) {
  assert.ok(entry.footprint?.w >= 1 && entry.footprint?.h >= 1, `SIZES.${key} footprint`);
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

console.log("test-battlemap: all assertions passed");

/* ========================================================================== */
/*  Terrain painting: the pure cell bookkeeping                               */
/* ========================================================================== */
import {
  hexKeyOf,
  hexLabelFromOffset,
  withHexAdded,
  withHexRemoved,
  TERRAIN_COLORS,
  UNPAINTABLE,
  paintableTerrains,
  colorFor,
  paintedTerrainAt,
  TERRAIN_FLAG,
  HEXES_FLAG,
} from "../scripts/battlemap/terrain-paint.mjs";
import { TERRAIN } from "../scripts/vehicles/vehicle-speed.mjs";
import { ENCOUNTER_TERRAINS } from "../scripts/formation/encounter-terrains.mjs";

assert.equal(hexKeyOf({ i: 3, j: 7 }), "3:7", "a cell's identity is its offset");
assert.equal(hexLabelFromOffset({ i: 0, j: 0 }), "A1", "columns letter, rows number, one-based");
assert.equal(hexLabelFromOffset({ i: 3, j: 2 }), "C4");
assert.equal(hexLabelFromOffset({ i: 0, j: 25 }), "Z1");
assert.equal(hexLabelFromOffset({ i: 9, j: 26 }), "AA10", "columns run past Z the way spreadsheets do");
assert.equal(hexLabelFromOffset({ i: 0, j: 27 }), "AB1");

const shape = (n) => ({ type: "polygon", hole: false, points: [n, n, n + 1, n, n, n + 1] });
let pair = withHexAdded([], [], "1:1", shape(1));
assert.ok(pair.changed && pair.hexKeys.length === 1 && pair.shapes.length === 1, "first paint lands");
pair = withHexAdded(pair.hexKeys, pair.shapes, "1:1", shape(1));
assert.ok(!pair.changed, "painting the same cell again writes nothing");
pair = withHexAdded(pair.hexKeys, pair.shapes, "2:2", shape(2));
assert.equal(pair.hexKeys.length, 2, "cells accumulate");
pair = withHexRemoved(pair.hexKeys, pair.shapes, "1:1");
assert.ok(pair.changed && pair.hexKeys.length === 1 && pair.shapes.length === 1, "erase drops the pair together");
assert.equal(pair.hexKeys[0], "2:2", "and drops the RIGHT pair — keys and shapes stay aligned");
assert.ok(!withHexRemoved(pair.hexKeys, pair.shapes, "9:9").changed, "erasing an unpainted cell writes nothing");

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
   A region fake carries only the two flags the read uses; the grid fake maps
   a point straight to an offset. Keys are the register's; the scene is not. */
{
  globalThis.CONST ??= {};
  CONST.GRID_TYPES ??= { HEXODDR: 2, HEXEVENR: 3, HEXODDQ: 4, HEXEVENQ: 5 };
  const region = (key, hexes) => ({
    getFlag: (_ns, flag) => (flag === TERRAIN_FLAG ? key : flag === HEXES_FLAG ? hexes : undefined),
  });
  const scene = {
    grid: { type: CONST.GRID_TYPES.HEXODDR, getOffset: (p) => ({ i: p.y, j: p.x }) },
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
  const {
    PAINT_LAYERS, TERRITORY_COLORS, paintableValues, layerColorFor, layerLabelFor, layerRegionsOf,
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
  const flags = Object.values(PAINT_LAYERS).flatMap((l) => [l.flag, l.hexesFlag]);
  assert.equal(new Set(flags).size, flags.length, "no two layers share a flag");
  assert.deepEqual(PAINT_LAYERS.terrain, { flag: TERRAIN_FLAG, hexesFlag: HEXES_FLAG }, "terrain keeps its flags");
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

  let rid = 0;
  /** A hex scene of 100-pixel cells, offset (i, j) = (row, column), its regions held in memory. */
  const scene = {
    id: "scene-layers",
    grid: {
      type: CONST.GRID_TYPES.HEXODDR,
      size: 100,
      getOffset: (p) => ({ i: Math.floor(p.y / 100), j: Math.floor(p.x / 100) }),
      getVertices: (o) => [
        { x: o.j * 100, y: o.i * 100 }, { x: o.j * 100 + 100, y: o.i * 100 }, { x: o.j * 100 + 50, y: o.i * 100 + 100 },
      ],
    },
    regions: [],
    async createEmbeddedDocuments(name, data) {
      assert.equal(name, "Region");
      const made = data.map((d) => ({
        id: `r${++rid}`,
        name: d.name,
        color: d.color,
        visibility: d.visibility,
        shapes: [...d.shapes],
        flags: structuredClone(d.flags),
        getFlag(ns, key) { return this.flags[ns]?.[key]; },
        toObject() { return { shapes: [...this.shapes] }; },
        async update(patch) {
          for (const [path, value] of Object.entries(patch)) {
            if (path === "shapes") this.shapes = value;
            else this.flags[path.split(".")[1]][path.split(".")[2]] = value;
          }
        },
        async delete() { scene.regions.splice(scene.regions.indexOf(this), 1); },
      }));
      scene.regions.push(...made);
      return made;
    },
  };
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
  assert.deepEqual(visibility, { terrain: [2], territory: [1] },
    "the terrain is the map everyone sees; territory is the Judge's bookkeeping");
  assert.equal(layerRegionsOf(scene, "territory")[0].name, "ACKS-FORMATION.travel.territory.outlands",
    "a region is named by its layer's label");
  assert.deepEqual(layerRegionsOf(scene, "water"), [], "a layer the brush does not know has no regions");

  assert.equal(await paintHexAt(scene, centre(1, 1), "civilized", "territory"), true);
  assert.deepEqual(values(1, 1), { terrain: "forestTaiga", territory: "civilized" },
    "a new territory moves the hex out of the old one and leaves the terrain alone");
  assert.deepEqual(layerRegionsOf(scene, "territory").map((r) => r.getFlag(MODULE_ID, "territory")), ["civilized"],
    "a region left with no hex is deleted");

  assert.equal(await paintHexAt(scene, centre(1, 2), "civilized", "territory"), true);
  assert.deepEqual(layerRegionsOf(scene, "territory")[0].getFlag(MODULE_ID, "territoryHexes"), ["1:1", "1:2"],
    "a second hex of the same value joins its region");
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
    hexesFlag: "demoHexes",
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
    assert.deepEqual(PAINT_LAYERS.demo, { flag: "demoKind", hexesFlag: "demoHexes" });
    assert.ok(Object.hasOwn(PAINT_LAYERS, "demo") && "demo" in PAINT_LAYERS);
    assert.deepEqual(PAINT_LAYERS.terrain, { flag: TERRAIN_FLAG, hexesFlag: HEXES_FLAG }, "the others keep their flags");
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
      [region.name, region.color, region.visibility, region.getFlag(MODULE_ID, "demoKind"), region.getFlag(MODULE_ID, "demoHexes")],
      ["demo a1", "#112233", 1, "a1", ["5:5"]],
      "a region is named, tinted and flagged by its layer's own functions and flags");
    assert.equal(await paintHexAt(scene, centre(5, 5), "zz", "demo"), false, "a value the layer does not offer is refused");
    assert.equal(await paintHexAt(scene, centre(5, 5), null, "demo"), true);
    assert.deepEqual(layerRegionsOf(scene, "demo"), [], "erasing the last cell deletes the region");

    disposeOpen = registerPaintLayer({ ...demoLayer(), key: "open", flag: "openKind", hexesFlag: "openHexes", visible: true });
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
    disposeHollow = registerPaintLayer({ ...demoLayer(), key: "hollow", flag: "hollowKind", hexesFlag: "hollowHexes", values: () => pool });
    assert.ok(Object.hasOwn(PAINT_LAYERS, "hollow"));
    assert.deepEqual(paintableValues("hollow"), []);
    assert.deepEqual(await pillKeys(), [...builtIns, "demo"], "an empty layer stays hidden");
    pool = ["a1"];
    assert.deepEqual(await pillKeys(), [...builtIns, "demo", "hollow"], "and appears once it has a value");
    disposeHollow();

    // Refusals leave the registry as it was.
    const plain = { flag: "dupKind", hexesFlag: "dupHexes", values: () => [], label: String, color: () => "#000000" };
    assert.throws(() => registerPaintLayer({ ...plain, key: "terrain" }), /registered twice/, "a built-in's key is taken");
    assert.throws(() => registerPaintLayer({ ...plain, key: "demo" }), /registered twice/, "so is a later one's");
    assert.throws(() => registerPaintLayer({ ...plain, key: "dup", flag: "territory" }), /flag is shared/);
    assert.throws(() => registerPaintLayer({ ...plain, key: "dup", hexesFlag: "demoKind" }), /flag is shared/,
      "a flag held in the other role is held all the same");
    assert.throws(() => registerPaintLayer({ ...plain, key: "dup", hexesFlag: "dupKind" }), /must differ/,
      "a layer's two flags are two");
    assert.throws(() => registerPaintLayer({ ...plain, key: "" }), /non-empty/);
    assert.throws(() => registerPaintLayer(), /non-empty/);
    assert.throws(() => registerPaintLayer({ ...plain, key: "dup", values: null }), /values must be a function/);
    assert.throws(() => registerPaintLayer({ ...plain, key: "dup", groups: { of: () => "g" } }), /groups/);
    assert.deepEqual(Object.keys(PAINT_LAYERS), [...builtIns, "demo"], "a refused layer registers nothing");
    assert.equal(layerLabelFor("a1", "demo"), "demo a1", "and the first registration still stands");

    // The flag map is a view, not a place to add a layer.
    assert.throws(() => { PAINT_LAYERS.rogue = { flag: "x", hexesFlag: "y" }; }, TypeError);
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
  const { onBoard, terrainPaint } = await import("../scripts/battlemap/terrain-paint.mjs");
  const { MODULE_ID } = await import("../scripts/lib/constants.mjs");

  const board = { id: "board" };
  const palette = { id: "palette" };
  assert.equal(onBoard({ nativeEvent: { target: board } }, board), true);
  assert.equal(onBoard({ nativeEvent: { target: palette } }, board), false, "a window in front is not the board");
  assert.equal(onBoard({}, board), false, "an event with no native target is not the board");
  assert.equal(onBoard({ nativeEvent: { target: board } }, null), false, "and nothing is the board with no canvas");

  CONST.GRID_TYPES ??= { HEXODDR: 2, HEXEVENR: 3, HEXODDQ: 4, HEXEVENQ: 5 };
  CONST.REGION_VISIBILITY ??= { LAYER: 0, GAMEMASTER: 1, ALWAYS: 2 };
  game.user = { isGM: true };
  const painted = [];
  const scene = {
    grid: {
      type: CONST.GRID_TYPES.HEXODDR,
      getOffset: (p) => ({ i: Math.floor(p.y / 100), j: Math.floor(p.x / 100) }),
      getVertices: (o) => [{ x: o.j * 100, y: o.i * 100 }, { x: o.j * 100 + 100, y: o.i * 100 }, { x: o.j * 100 + 50, y: o.i * 100 + 100 }],
    },
    regions: [],
    async createEmbeddedDocuments(_name, data) {
      const made = data.map((d) => ({
        ...d,
        getFlag(ns, key) { return this.flags[ns]?.[key]; },
        toObject() { return { shapes: [...this.shapes] }; },
        async update(patch) { this.flags[MODULE_ID].terrainHexes = patch[`flags.${MODULE_ID}.terrainHexes`]; },
      }));
      scene.regions.push(...made);
      painted.push(...data.flatMap((d) => d.flags[MODULE_ID].terrainHexes));
      return made;
    },
  };
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
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  try {
    terrainPaint.arm("grassland", { layer: "terrain" });
    const fire = async (name, ev) => { catcher.handlers[name](ev); await settle(); };

    await fire("pointermove", at(board, 150, 150));
    assert.deepEqual(painted, [], "a held button with no stroke opened on the board paints nothing");
    await fire("pointerdown", at(palette, 150, 150));
    await fire("pointermove", at(palette, 250, 150));
    assert.deepEqual(painted, [], "a click on the palette opens no stroke, and its travel paints nothing");
    await fire("pointerup", at(palette, 250, 150, 0));

    await fire("pointerdown", at(board, 150, 150));
    assert.deepEqual(painted, ["1:1"], "a press on the board paints its hex");
    await fire("pointermove", at(palette, 250, 150));
    assert.deepEqual(painted, ["1:1"], "a stroke dragged over a window paints nothing under it");
    await fire("pointermove", at(board, 350, 150));
    assert.equal(scene.regions[0].getFlag(MODULE_ID, "terrainHexes").at(-1), "1:3", "and resumes on the board");
    await fire("pointerup", at(board, 350, 150, 0));
    await fire("pointermove", at(board, 450, 150));
    assert.equal(scene.regions[0].getFlag(MODULE_ID, "terrainHexes").includes("1:4"), false, "the stroke ends on release");
  } finally {
    terrainPaint.disarm();
    delete globalThis.PIXI;
    delete globalThis.canvas;
  }
}

/* --- the scene's default country --------------------------------------------
   What the Judge said of a map's unpainted country, stored inside the setup
   record. The write merges into that record; the read drops what it does not
   know. A map painted with climates hex by hex folds them into its one
   climate, once. Values below are invented. */
{
  const { sceneCountry, writeSceneSetup, paintedClimateOf, foldPaintedClimate } = await import("../scripts/battlemap/scene-setup.mjs");
  const { MODULE_ID } = await import("../scripts/lib/constants.mjs");
  const { CLIMATES } = await import("../scripts/formation/weather.mjs");
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

  const painted = (code, hexes) => ({ getFlag: (_ns, key) => (key === "climate" ? code : key === "climateHexes" ? hexes : undefined) });
  const mapOf = (regions, country = null) => {
    const held = { [MODULE_ID]: { battlemap: country ? { country } : {} } };
    return {
      regions,
      held,
      getFlag: (ns, key) => held[ns]?.[key],
      setFlag: async (ns, key, value) => { held[ns] = { ...(held[ns] ?? {}), [key]: structuredClone(value) }; },
    };
  };
  assert.deepEqual(paintedClimateOf(mapOf([])), { climate: null, regions: 0 }, "a map with no painted climate holds none");
  assert.deepEqual(paintedClimateOf(null), { climate: null, regions: 0 });
  const listedFirst = Object.keys(CLIMATES).find((k) => k === "BSk" || k === "Csb");
  assert.equal(paintedClimateOf(mapOf([painted("Csb", ["1:1"]), painted("BSk", ["1:2"])])).climate, listedFirst,
    "a tie goes to the climate the module lists first");
  assert.deepEqual(
    paintedClimateOf(mapOf([painted("Csb", ["1:1"]), painted("BSk", ["1:2", "1:3"]), painted("Q9", ["1:4", "1:5", "1:6"])])),
    { climate: "BSk", regions: 3 }, "the climate most hexes hold wins; an unknown one counts as a region and never wins");

  const folding = mapOf([painted("Csb", ["1:1"]), painted("BSk", ["1:2", "1:3"])], { ground: "forest" });
  assert.equal(await foldPaintedClimate(folding), "BSk", "a map that says no climate takes its painted one");
  assert.deepEqual(folding.held[MODULE_ID].battlemap, { country: { ground: "forest", climate: "BSk" }, climateFolded: true },
    "into the setup record, the rest of the record kept");
  assert.equal(folding.regions.length, 2, "the painted regions are left as they are");
  await writeSceneSetup(folding, { country: { ground: "forest" } });
  assert.equal(await foldPaintedClimate(folding), null, "a map is folded once");
  assert.equal(sceneCountry(folding).climate, null, "so a climate the Judge clears afterwards stays cleared");

  const declared = mapOf([painted("BSk", ["1:2"])], { climate: "Csb" });
  assert.equal(await foldPaintedClimate(declared), null, "a map that says its own climate keeps it");
  assert.equal(sceneCountry(declared).climate, "Csb");
  assert.equal(declared.held[MODULE_ID].battlemap.climateFolded, true, "and is marked folded all the same");

  const unpainted = mapOf([]);
  assert.equal(await foldPaintedClimate(unpainted), null);
  assert.equal(unpainted.held[MODULE_ID].battlemap.climateFolded, undefined, "a map with no painted climate is never written");
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
  const region = (flag, value, hexesFlag, hexes) => ({
    getFlag: (_ns, key) => (key === flag ? value : key === hexesFlag ? hexes : undefined),
  });
  const terrain = (value, hexes) => region(TERRAIN_FLAG, value, HEXES_FLAG, hexes);
  const territory = (value, hexes) => region("territory", value, "territoryHexes", hexes);
  const climate = (value, hexes) => region("climate", value, "climateHexes", hexes);
  const line = (c, layer) => ({ c, move: 0, flags: { [MODULE_ID]: layer } });
  const sceneOf = ({ regions = [], walls = [], country = null, type = CONST.GRID_TYPES.HEXODDR, id = "scene-country" } = {}) => ({
    id,
    grid: { type, size: 100, getOffset: (p) => ({ i: Math.floor(p.y / 100), j: Math.floor(p.x / 100) }) },
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
      territory("outlands", ["1:1"]), territory("wildlands", ["1:3"]), climate("Csb", ["1:1"]),
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
    "every painted answer is the map's; a climate painted before the climate was the map's is not read");
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

console.log("test-battlemap: OK (hex keys, labels, aligned paint/erase pairs, palette coverage, open vocabulary, road row escaping, whole-line segments, road distance, the territory layer, the brush over a window, the scene's default country and its painted climate folded, the country under a point)");
