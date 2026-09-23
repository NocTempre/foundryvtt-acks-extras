/**
 * Battlemap calibration: the grid solver and the footprint arithmetic.
 * Pure functions; no Foundry, no world. Synthetic lattices only — no value
 * here is read off a page.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { boxCells, fitGrid, feetPerSquare, hexSizeFromBox, pixelsPerUnit, roundSuggestions, outputGridSize, scaleOnlyGrid, solveShift } from "../scripts/battlemap/calibrate-logic.mjs";
import { footprintFeet, tokenSpan, SPAN_MIN } from "../scripts/battlemap/footprint.mjs";
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
} from "../scripts/battlemap/terrain-paint.mjs";
import { TERRAIN } from "../scripts/vehicles/vehicle-speed.mjs";

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

assert.deepEqual(Object.keys(TERRAIN_COLORS).sort(), Object.keys(TERRAIN).sort(),
  "every terrain kind has a swatch, and no swatch lacks a terrain");

/* --- the OPEN terrain vocabulary ------------------------------------------
   Proves the brush paints the union of shipped and imported terrain keys,
   minus the two the weather owns. See docs/battlemap/DECISIONS.md for the
   open-vocabulary ruling. Values below are invented. */
{
  const { registerTable, unregisterTable, PRIORITY } = await import("../scripts/lib/tables.mjs");
  unregisterTable("travel");

  const shipped = paintableTerrains();
  assert.ok(shipped.includes("forest"), "a shipped kind is paintable");
  for (const key of UNPAINTABLE) {
    assert.ok(!shipped.includes(key), key + " is weather's, not the brush's");
    assert.ok(TERRAIN[key], key + " stays a valid terrain for the multiplier lookup");
  }

  registerTable({
    id: "travel",
    source: "invented",
    tables: { terrainMultipliers: { forest: 0.7, ashWaste: 0.4, saltFlat: 0.9 } },
  }, { priority: PRIORITY.WORLD, source: "test" });

  const opened = paintableTerrains();
  assert.ok(opened.includes("ashWaste"), "an imported kind becomes paintable");
  assert.ok(opened.includes("saltFlat"));
  assert.equal(opened.filter((k) => k === "forest").length, 1, "a kind in both lists appears once");
  for (const key of UNPAINTABLE) {
    assert.ok(!opened.includes(key), "importing must not re-admit " + key);
  }

  // An unknown key still gets a stable, distinguishable colour.
  assert.equal(colorFor("forest"), TERRAIN_COLORS.forest, "a shipped kind keeps its palette colour");
  const a = colorFor("ashWaste");
  assert.ok(/^hsl\(/.test(a), "an imported kind gets a derived hue");
  assert.equal(a, colorFor("ashWaste"), "and the same hue every time");
  assert.notEqual(a, colorFor("saltFlat"), "different kinds get different hues");

  unregisterTable("travel");
  assert.ok(!paintableTerrains().includes("ashWaste"), "dropping the table closes the vocabulary again");
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
  globalThis.HTMLElement = class HTMLElement {};

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
    querySelector: (sel) => (sel === ".window-content .standard-form" ? { append: (r) => appended.push(r) } : null),
  };
  /** Fire the sheet-render hook over one document and report what was added. */
  const render = (wall) => {
    appended.length = 0;
    built = null;
    for (const fn of hooks.get("renderApplicationV2")) fn({ document: wall, render() {} }, [root]);
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

console.log("test-battlemap: OK (hex keys, labels, aligned paint/erase pairs, palette coverage, open vocabulary, road row escaping, whole-line segments, road distance)");
