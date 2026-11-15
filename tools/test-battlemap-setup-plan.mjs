/**
 * The map setup planner: the needs list for every family and sample
 * combination, the rows the apply would rewrite, the already-matches case, the
 * auto-sizing decision and the cell-worth resolution. Pure functions over
 * plain data; synthetic figures only, nothing read off a page.
 */
import assert from "node:assert/strict";
import { expeditionScaleOf, planSetup, resolveCellWorth } from "../scripts/battlemap/setup-plan.mjs";
import { solveGridCalibration, solveHexCalibration, solveScaleOnly, writeSetup } from "../scripts/battlemap/apply.mjs";
import { DISTANCE_UNITS } from "../scripts/lib/distance-units.mjs";
import { FLAG_BATTLEMAP, GRID_TYPE, MODULE_ID } from "../scripts/battlemap/constants.mjs";
import { fitHexLattice } from "../scripts/battlemap/calibrate-logic.mjs";
import { hexProbe } from "../scripts/battlemap/scene-setup.mjs";

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`  ok   ${name}`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`  FAIL ${name}\n${err.stack}`);
  }
}

/* -------------------------------------------- */
/*  Fixtures                                    */
/* -------------------------------------------- */

const GRIDLESS_SCENE = Object.freeze({
  gridType: GRID_TYPE.GRIDLESS, gridSize: 100, distance: 5, units: "ft",
  width: 4000, height: 3000, shiftX: 0, shiftY: 0, autoScale: false, mapSystem: null, hasBackground: true,
});
const HEX_SCENE = Object.freeze({ ...GRIDLESS_SCENE, gridType: GRID_TYPE.HEXODDR });

const SQUARE_FIT = Object.freeze({ ok: true, mode: "square", sizeX: 70, sizeY: 70, phaseX: 3, phaseY: 4, rmsPct: 0.004, confidence: "tight", samples: 2 });
const SQUARE_SOLUTION = Object.freeze({
  gridType: GRID_TYPE.SQUARE, gridSize: 100, distance: 5, units: "ft",
  width: 4200, height: 3100, shiftX: 12, shiftY: 7, mapSystem: null,
});

// The shape `fitHexLattice` answers for one used box: no residual to be off by,
// so `rmsPx` is null, no box is named worst and one box is never tight.
const hexBox = (index, over = {}) => ({ index, cell: { i: index, j: 0 }, residual: 0.01, notOneHex: false, unreachable: false, ...over });
const outBox = (index, flag) => hexBox(index, { cell: null, residual: null, [flag]: true });
const hexFit = (over = {}) => ({
  ok: true, sizeX: 80, sizeY: 92, centre: { x: 500, y: 400 }, k: { x: 1, y: 1 },
  spacing: { u: { x: 80, y: 0 }, v: { x: 40, y: 69 } }, from: { x: "edges", y: "edges" },
  boxes: [hexBox(0)], used: 1, unreachable: 0, rmsPx: null, rmsPct: 0.01, maxPct: 0.02, worst: null, confidence: "fair",
  warnings: [], samples: 1, ...over,
});
const hexFail = (reason, boxes) => ({ ok: false, reason, samples: boxes?.length ?? 0, ...(boxes ? { boxes } : {}) });
const HEX_SOLUTION = Object.freeze({
  gridType: GRID_TYPE.HEXODDR, gridSize: 100, distance: 6, units: "mi",
  width: 3600, height: 2900, shiftX: 20, shiftY: 15, mapSystem: null,
});
const SCALE_SOLUTION = Object.freeze({ gridSize: 120, distance: 2, units: "mi", mapSystem: null });

const ids = (plan) => plan.needs.map((n) => n.id);
const plan = (over) => planSetup({ scene: GRIDLESS_SCENE, solution: SQUARE_SOLUTION, cellWorth: 5, ...over });

/* -------------------------------------------- */
/*  Needs — square                              */
/* -------------------------------------------- */

test("square: nothing sampled needs a sample and a cell worth", () => {
  const p = plan({ family: "square", samples: {}, fit: null, cellWorth: null, solution: null });
  assert.deepEqual(ids(p), ["gridSample", "cellWorth"]);
  assert.deepEqual(p.needs.map((n) => n.action), ["boxTool", "cellWorthField"]);
  assert.equal(p.canApply, false);
});

test("square: a bar with its length is not a fit and does not ask for the worth it will measure", () => {
  const p = plan({ family: "square", samples: { bar: true, barValue: true }, fit: null, cellWorth: null, solution: null });
  assert.deepEqual(ids(p), ["gridSample"]);
  assert.equal(p.needs[0].hint, "barAlone");
});

test("square: a bar with no length still leaves the worth to type", () => {
  const p = plan({ family: "square", samples: { bar: true, barValue: false }, fit: null, cellWorth: null, solution: null });
  assert.deepEqual(ids(p), ["gridSample", "cellWorth"]);
  assert.equal(p.needs[1].hint, "barWithoutValue");
});

test("square: boxes with a worth need nothing; without a worth they need exactly that", () => {
  const samples = { boxes: 2 };
  assert.deepEqual(plan({ family: "square", samples, fit: SQUARE_FIT }).needs, []);
  assert.deepEqual(ids(plan({ family: "square", samples, fit: SQUARE_FIT, cellWorth: null })), ["cellWorth"]);
});

test("square: corners alone and boxes with corners are both fit inputs", () => {
  assert.deepEqual(plan({ family: "square", samples: { corners: 3 }, fit: SQUARE_FIT }).needs, []);
  const both = plan({ family: "square", samples: { boxes: 2, corners: 3 }, fit: SQUARE_FIT });
  assert.deepEqual(both.needs, []);
  assert.deepEqual(both.unused, []);
  assert.equal(both.canApply, true);
});

test("square: a bar beside corners that make a fit needs no sample, and beside corners that do not, is no bar alone", () => {
  const fitted = plan({ family: "square", samples: { bar: true, barValue: true, corners: 3 }, fit: SQUARE_FIT });
  assert.deepEqual(ids(fitted), []);
  assert.equal(fitted.canApply, true);
  const short = plan({ family: "square", samples: { bar: true, barValue: true, corners: 1 }, fit: { ok: false, reason: "noSeed" }, cellWorth: null, solution: null });
  assert.deepEqual(ids(short), ["gridSample"]);
  assert.equal(short.needs[0].hint, "noSeed", "corners are samples, so the bar is not alone");
});

test("square: a fit that found no seed names its reason", () => {
  const p = plan({ family: "square", samples: { corners: 1 }, fit: { ok: false, reason: "noSeed" }, solution: null });
  assert.deepEqual(ids(p), ["gridSample"]);
  assert.equal(p.needs[0].hint, "noSeed");
});

test("square: a hex scene refuses the square apply and names the family choice; a gridless one does not", () => {
  const onHex = plan({ family: "square", samples: { boxes: 2 }, fit: SQUARE_FIT, scene: HEX_SCENE });
  assert.deepEqual(ids(onHex), ["sceneNotSquare"]);
  assert.equal(onHex.needs[0].action, "familySelect");
  assert.deepEqual(ids(plan({ family: "square", samples: { boxes: 2 }, fit: SQUARE_FIT, scene: GRIDLESS_SCENE })), []);
});

test("a geometry apply needs a background; a scale-only one does not", () => {
  const bare = { ...GRIDLESS_SCENE, hasBackground: false };
  assert.deepEqual(ids(plan({ family: "square", samples: { boxes: 2 }, fit: SQUARE_FIT, scene: bare })), ["background"]);
  assert.deepEqual(ids(plan({ family: "scale", samples: { bar: true, barValue: true }, scene: bare, solution: SCALE_SOLUTION })), []);
});

/* -------------------------------------------- */
/*  Needs — hex                                 */
/* -------------------------------------------- */

for (const family of ["hexRows", "hexCols"]) {
  const hexPlan = (over) => plan({ family, solution: HEX_SOLUTION, ...over });

  test(`${family}: nothing sampled needs a box and a worth`, () => {
    const p = hexPlan({ samples: {}, fit: null, cellWorth: null, solution: null });
    assert.deepEqual(ids(p), ["hexBox", "cellWorth"]);
    assert.equal(p.needs[0].action, "boxTool");
  });

  test(`${family}: a bar alone needs a one-hex box, because only a box places the hexes`, () => {
    const p = hexPlan({ samples: { bar: true, barValue: true }, fit: hexFail("noBoxes"), cellWorth: null, solution: null });
    assert.deepEqual(ids(p), ["hexBox"]);
    assert.equal(p.needs[0].hint, "barAlone");
  });

  test(`${family}: corners alone are never a fit input and are reported unused`, () => {
    const p = hexPlan({ samples: { corners: 3 }, fit: hexFail("noBoxes"), solution: null });
    assert.deepEqual(ids(p), ["hexBox"]);
    assert.deepEqual(p.unused, [{ id: "corners", count: 3 }]);
  });

  test(`${family}: only multi-hex boxes need a one-hex box`, () => {
    const boxes = [hexBox(0, { notOneHex: true }), hexBox(1, { notOneHex: true })];
    const p = hexPlan({ samples: { boxes: 2 }, fit: hexFail("noOneHex", boxes), solution: null });
    assert.deepEqual(ids(p), ["oneHexBox"]);
    assert.equal(p.needs[0].action, "boxTool");
  });

  test(`${family}: a failed fit lists no boxes as unused, only the corners beside it`, () => {
    const boxes = [outBox(0, "notOneHex"), outBox(1, "notOneHex")];
    const bare = hexPlan({ samples: { boxes: 2 }, fit: hexFail("noOneHex", boxes), solution: null });
    assert.deepEqual(bare.unused, []);
    const withCorners = hexPlan({ samples: { boxes: 2, corners: 1 }, fit: hexFail("noOneHex", boxes), solution: null });
    assert.deepEqual(withCorners.unused, [{ id: "corners", count: 1 }]);
    assert.deepEqual(bare.warnings, [], "a failed fit has nothing to warn about");
  });

  test(`${family}: a noOneHex failure that carries no boxes reads as a missing one-hex box`, () => {
    const p = hexPlan({ samples: { boxes: 2 }, fit: { ok: false, reason: "noOneHex", samples: 2 }, solution: null });
    assert.deepEqual(ids(p), ["oneHexBox"]);
  });

  test(`${family}: no background is a need on a hex scene`, () => {
    const p = hexPlan({ samples: { boxes: 1 }, fit: hexFit(), scene: { ...HEX_SCENE, hasBackground: false } });
    assert.deepEqual(ids(p), ["background"]);
    assert.equal(p.needs[0].action, "backgroundImage");
    assert.equal(p.canApply, false);
  });

  test(`${family}: an unreadable hex probe is named`, () => {
    assert.deepEqual(ids(hexPlan({ samples: { boxes: 1 }, fit: hexFail("noProbe"), solution: null })), ["hexProbe"]);
  });

  test(`${family}: one good box needs nothing, and corners beside it are unused`, () => {
    const p = hexPlan({ samples: { boxes: 1, corners: 2 }, fit: hexFit() });
    assert.deepEqual(p.needs, []);
    assert.deepEqual(p.unused, [{ id: "corners", count: 2 }]);
    assert.equal(p.canApply, true);
  });

  test(`${family}: boxes the fit leaves out are counted, not asked for`, () => {
    const boxes = [hexBox(0), outBox(1, "notOneHex"), outBox(2, "notOneHex"), outBox(3, "unreachable")];
    const p = hexPlan({ samples: { boxes: 4 }, fit: hexFit({ boxes, unreachable: 1 }) });
    assert.deepEqual(p.needs, []);
    assert.deepEqual(p.unused, [{ id: "multiHexBoxes", count: 2 }, { id: "unreachableBoxes", count: 1 }]);
    assert.equal(p.canApply, true);
  });

  test(`${family}: one good box among multi-hex boxes is a fit, with the bad ones unused and no one-hex need`, () => {
    const boxes = [outBox(0, "notOneHex"), hexBox(1), outBox(2, "notOneHex"), outBox(3, "notOneHex")];
    const p = hexPlan({ samples: { boxes: 4 }, fit: hexFit({ boxes }) });
    assert.deepEqual(p.needs, []);
    assert.deepEqual(p.unused, [{ id: "multiHexBoxes", count: 3 }]);
    assert.equal(p.canApply, true);
  });

  test(`${family}: a good box with no worth needs the worth alone`, () => {
    assert.deepEqual(ids(hexPlan({ samples: { boxes: 1 }, fit: hexFit(), cellWorth: null })), ["cellWorth"]);
  });

  test(`${family}: a loose fit warns and names its worst box without disabling Apply`, () => {
    const p = hexPlan({ samples: { boxes: 3 }, fit: hexFit({ confidence: "loose", worst: 2, rmsPct: 0.2 }) });
    assert.deepEqual(p.warnings, [{ id: "looseFit", worst: 2, rmsPct: 0.2 }]);
    assert.deepEqual(p.needs, []);
    assert.equal(p.canApply, true);
  });

  test(`${family}: a loose fit that names no box passes null through`, () => {
    const p = hexPlan({ samples: { boxes: 2 }, fit: hexFit({ confidence: "loose", worst: null, rmsPct: 0.2 }) });
    assert.deepEqual(p.warnings, [{ id: "looseFit", worst: null, rmsPct: 0.2 }]);
  });

  test(`${family}: a fair or tight fit does not warn`, () => {
    for (const confidence of ["fair", "tight"]) {
      assert.deepEqual(hexPlan({ samples: { boxes: 3 }, fit: hexFit({ confidence, worst: confidence === "fair" ? 1 : null }) }).warnings, [], confidence);
    }
  });

  test(`${family}: the fit's family verdicts are warnings with the family select as their action, never needs`, () => {
    for (const id of ["familyMismatch", "familyAmbiguous"]) {
      for (const basis of ["lattice", "shape"]) {
        const p = hexPlan({ samples: { boxes: 3 }, fit: hexFit({ warnings: [{ id, basis }] }) });
        assert.deepEqual(p.warnings, [{ id, action: "familySelect", basis }], `${id} ${basis}`);
        assert.deepEqual(p.needs, [], `${id} ${basis}`);
        assert.equal(p.canApply, true, `${id} ${basis}`);
      }
    }
  });

  test(`${family}: unreachable boxes are one warning that points at the box tool, with the boxes unused`, () => {
    const boxes = [hexBox(0), outBox(1, "unreachable"), outBox(2, "unreachable")];
    const p = hexPlan({ samples: { boxes: 3 }, fit: hexFit({ boxes, unreachable: 2 }) });
    assert.deepEqual(p.warnings, [{ id: "unreachable", count: 2, action: "boxTool" }]);
    assert.deepEqual(p.unused, [{ id: "unreachableBoxes", count: 2 }]);
    assert.deepEqual(p.needs, []);
    assert.equal(p.canApply, true);
  });
}

test("a square fit never carries hex warnings, and a loose one passes a null worst", () => {
  const stray = { ...SQUARE_FIT, warnings: [{ id: "familyMismatch", basis: "lattice" }], boxes: [outBox(0, "unreachable")] };
  assert.deepEqual(plan({ family: "square", samples: { boxes: 2 }, fit: stray }).warnings, []);
  const loose = { ...SQUARE_FIT, confidence: "loose", rmsPct: 0.3 };
  assert.deepEqual(plan({ family: "square", samples: { boxes: 2 }, fit: loose }).warnings, [{ id: "looseFit", worst: null, rmsPct: 0.3 }]);
});

/* -------------------------------------------- */
/*  Needs — scale only                          */
/* -------------------------------------------- */

const scalePlan = (over) => plan({ family: "scale", solution: SCALE_SOLUTION, cellWorth: null, ...over });

test("scale only: nothing sampled needs a measurement", () => {
  const p = scalePlan({ samples: {}, fit: null, solution: null });
  assert.deepEqual(ids(p), ["measurement"]);
  assert.equal(p.needs[0].action, "scaleBarTool");
});

test("scale only: a bar without its printed length needs the length", () => {
  const p = scalePlan({ samples: { bar: true, barValue: false }, fit: null, solution: null });
  assert.deepEqual(ids(p), ["barValue"]);
  assert.equal(p.needs[0].action, "barValueField");
});

test("scale only: a bar with its length needs nothing, whatever the worth", () => {
  const p = scalePlan({ samples: { bar: true, barValue: true }, fit: null });
  assert.deepEqual(p.needs, []);
  assert.equal(p.canApply, true);
});

test("scale only: boxes measure through a worth, and ask for it when blank", () => {
  assert.deepEqual(ids(scalePlan({ samples: { boxes: 2 }, fit: SQUARE_FIT })), ["cellWorth"]);
  assert.deepEqual(scalePlan({ samples: { boxes: 2 }, fit: SQUARE_FIT, cellWorth: 5 }).needs, []);
});

test("scale only: a bar with no length beside a measuring fit is named unused, not asked for", () => {
  const p = scalePlan({ samples: { boxes: 2, bar: true, barValue: false }, fit: SQUARE_FIT, cellWorth: 5 });
  assert.deepEqual(p.needs, []);
  assert.deepEqual(p.unused, [{ id: "scaleBarWithoutValue", count: 1 }]);
});

/* -------------------------------------------- */
/*  Needs — every family                        */
/* -------------------------------------------- */

test("every family: a blank cell worth is a need, and an entered one is not", () => {
  const cases = [
    ["square", { boxes: 2 }, SQUARE_FIT, SQUARE_SOLUTION],
    ["hexRows", { boxes: 1 }, hexFit(), HEX_SOLUTION],
    ["hexCols", { boxes: 1 }, hexFit(), HEX_SOLUTION],
    ["scale", { boxes: 2 }, SQUARE_FIT, SCALE_SOLUTION],
  ];
  for (const [family, samples, fit, solution] of cases) {
    const blank = plan({ family, samples, fit, solution, cellWorth: null });
    assert.deepEqual(ids(blank), ["cellWorth"], `${family} blank`);
    assert.equal(blank.canApply, false, `${family} blank cannot apply`);
    assert.deepEqual(plan({ family, samples, fit, solution, cellWorth: 5 }).needs, [], `${family} entered`);
  }
});

test("a solved plan with no named gap still refuses rather than leaving a silent button", () => {
  const p = plan({ family: "square", samples: { boxes: 2 }, fit: SQUARE_FIT, solution: null });
  assert.deepEqual(ids(p), ["unsolved"]);
  assert.equal(p.needs[0].action, null);
  assert.equal(p.canApply, false);
  assert.equal(p.matches, false);
});

/* -------------------------------------------- */
/*  Rows                                        */
/* -------------------------------------------- */

const rowOf = (p, id) => p.rows.find((r) => r.id === id);

test("rows: a square solve over a gridless scene", () => {
  const p = plan({ family: "square", samples: { boxes: 2 }, fit: SQUARE_FIT });
  assert.deepEqual(p.rows.map((r) => r.id), ["grid", "image", "tokenSizing"]);
  assert.deepEqual(rowOf(p, "grid"), {
    id: "grid", unit: "px",
    before: { type: GRID_TYPE.GRIDLESS, size: 100 }, after: { type: GRID_TYPE.SQUARE, size: 100 },
  });
  const image = rowOf(p, "image");
  assert.deepEqual(image.before, { width: 4000, height: 3000, shiftX: 0, shiftY: 0 });
  assert.deepEqual(image.after, { width: 4200, height: 3100, shiftX: 12, shiftY: 7 });
  assert.equal("moves" in image, false, "the row says nothing about placeables");
  assert.ok(Math.abs(image.rescale.x - 1.05) < 1e-9 && Math.abs(image.rescale.y - 3100 / 3000) < 1e-9);
  assert.deepEqual(rowOf(p, "tokenSizing"), { id: "tokenSizing", before: false, after: true });
  assert.equal(p.canApply, true);
});

test("rows: a hex solve rewrites the grid, the cell worth in a new unit and the image", () => {
  const p = plan({ family: "hexRows", samples: { boxes: 1 }, fit: hexFit(), solution: HEX_SOLUTION, cellWorth: 6 });
  assert.deepEqual(p.rows.map((r) => r.id), ["grid", "cellWorth", "image", "tokenSizing"]);
  assert.deepEqual(rowOf(p, "grid").after, { type: GRID_TYPE.HEXODDR, size: 100 });
  assert.deepEqual(rowOf(p, "cellWorth"), { id: "cellWorth", before: { distance: 5, units: "ft" }, after: { distance: 6, units: "mi" } });
});

test("rows: a scale-only solve touches neither the image nor the grid type", () => {
  const p = plan({ family: "scale", samples: { bar: true, barValue: true }, fit: null, solution: SCALE_SOLUTION, cellWorth: null });
  assert.deepEqual(p.rows.map((r) => r.id), ["grid", "cellWorth", "tokenSizing"]);
  assert.deepEqual(rowOf(p, "grid").before.type, GRID_TYPE.GRIDLESS);
  assert.deepEqual(rowOf(p, "grid").after, { type: GRID_TYPE.GRIDLESS, size: 120 });
  assert.equal(rowOf(p, "image"), undefined);
});

test("rows: a field whose before equals its after produces no row", () => {
  const scene = { ...GRIDLESS_SCENE, gridType: GRID_TYPE.SQUARE, autoScale: true };
  const p = plan({ family: "square", samples: { boxes: 2 }, fit: SQUARE_FIT, scene, solution: { ...SQUARE_SOLUTION, width: 4000, height: 3000, shiftX: 0 } });
  assert.deepEqual(p.rows.map((r) => r.id), ["image"], "only the shiftY change remains");
  assert.deepEqual(p.rows[0].after.shiftY, 7);
  const nothing = plan({ family: "square", samples: { boxes: 2 }, fit: SQUARE_FIT, scene, solution: { ...SQUARE_SOLUTION, width: 4000, height: 3000, shiftX: 0, shiftY: 0 } });
  assert.deepEqual(nothing.rows, []);
});

test("rows: a unit spelled differently is the same unit, and a changed one is a row", () => {
  const scene = { ...GRIDLESS_SCENE, gridType: GRID_TYPE.SQUARE, units: "Miles", distance: 6, autoScale: true };
  const solution = { gridType: GRID_TYPE.SQUARE, gridSize: 100, distance: 6, units: "mi", mapSystem: null };
  assert.equal(rowOf(plan({ family: "scale", scene, solution }), "cellWorth"), undefined);
  const changed = plan({ family: "scale", scene, solution: { ...solution, units: "km" } });
  assert.deepEqual(rowOf(changed, "cellWorth").after, { distance: 6, units: "km" });
});

// A scene that already holds SQUARE_SOLUTION, so each change below is the only one.
const SETTLED = Object.freeze({ ...GRIDLESS_SCENE, ...SQUARE_SOLUTION, autoScale: true });
const settled = (solution) => plan({ family: "square", samples: { boxes: 2 }, fit: SQUARE_FIT, scene: SETTLED, solution: { ...SQUARE_SOLUTION, ...solution } });

test("rows: a changed grid distance alone is a cellWorth row", () => {
  const p = settled({ distance: 10 });
  assert.deepEqual(p.rows, [{ id: "cellWorth", before: { distance: 5, units: "ft" }, after: { distance: 10, units: "ft" } }]);
  assert.equal(p.canApply, true);
});

test("rows: a width-only change and a shift-only change are each an image row", () => {
  const wide = settled({ width: 4400 });
  assert.deepEqual(wide.rows.map((r) => r.id), ["image"]);
  assert.deepEqual(wide.rows[0].after, { width: 4400, height: 3100, shiftX: 12, shiftY: 7 });
  const shifted = settled({ shiftX: 13 });
  assert.deepEqual(shifted.rows.map((r) => r.id), ["image"]);
  assert.deepEqual(shifted.rows[0].after, { width: 4200, height: 3100, shiftX: 13, shiftY: 7 });
  assert.equal(shifted.rows[0].rescale.x, 1, "a shift alone rescales nothing");
});

test("rows: a grid size that differs below the tolerance is no row, and one above it is", () => {
  assert.deepEqual(settled({ gridSize: 100 + 1e-9 }).rows, []);
  assert.deepEqual(settled({ gridSize: 100 + 1e-9 }).matches, true);
  assert.deepEqual(settled({ gridSize: 100.01 }).rows.map((r) => r.id), ["grid"]);
});

test("rows: a declared travel system met by a solution that names none is a row to null", () => {
  const scene = { ...SETTLED, mapSystem: "overland" };
  const p = plan({ family: "square", samples: { boxes: 2 }, fit: SQUARE_FIT, scene, solution: { ...SQUARE_SOLUTION, mapSystem: null } });
  assert.deepEqual(p.rows, [{ id: "travelSystem", before: "overland", after: null }]);
  const absent = { ...SQUARE_SOLUTION };
  delete absent.mapSystem;
  assert.deepEqual(plan({ family: "square", samples: { boxes: 2 }, fit: SQUARE_FIT, scene, solution: absent }).rows.map((r) => r.id), ["travelSystem"]);
});

test("rows: a declared travel system is a row only when it changes", () => {
  const scene = { ...GRIDLESS_SCENE, mapSystem: "overland" };
  const base = { family: "square", samples: { boxes: 2 }, fit: SQUARE_FIT, scene };
  assert.equal(rowOf(plan({ ...base, solution: { ...SQUARE_SOLUTION, mapSystem: "overland" } }), "travelSystem"), undefined);
  assert.deepEqual(rowOf(plan({ ...base, solution: { ...SQUARE_SOLUTION, mapSystem: "dungeon" } }), "travelSystem"),
    { id: "travelSystem", before: "overland", after: "dungeon" });
  assert.deepEqual(rowOf(plan({ ...base, scene: GRIDLESS_SCENE, solution: { ...SQUARE_SOLUTION, mapSystem: "dungeon" } }), "travelSystem"),
    { id: "travelSystem", before: null, after: "dungeon" });
});

/* -------------------------------------------- */
/*  Real fits                                   */
/* -------------------------------------------- */

// The planner takes the fit as data; these tests produce it with the real
// `fitHexLattice` over a stand-in for core 14's hex grid, so the shape the
// planner reads is the shape the fit answers and not one written to match.

/** Core 14's `getCenterPoint` and `getVertices` for a hex grid at `size`, the stand-in the hex-fit suite uses. */
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

const hexScene = () => ({
  clone(data) {
    const type = data["grid.type"];
    return { grid: { type, ...coreHexGrid({ columns: type === 4 || type === 5, even: type === 3 || type === 5 }) } };
  },
});
const realType = (family) => {
  const columns = family === "hexCols";
  return { family, columns, grid: coreHexGrid({ columns, even: false }), probe: hexProbe(hexScene(), family, false) };
};
const ROWS = realType("hexRows");
const COLS = realType("hexCols");
const otherOf = (t) => (t === ROWS ? COLS : ROWS);

// A 150 px hex: image px per probe px is 1.5 and the canvas draws the image 1:1.
const LARGE = { k: { x: 1.5, y: 1.5 }, scale: { x: 1, y: 1 } };
const ORIGIN = { x: 217.3, y: 91.1 };

/** The exact box around the hex at (i, j), in image px. */
function exactBox(t, image, i, j) {
  const c = t.grid.getCenterPoint({ i, j });
  const w = t.probe.refW * image.k.x;
  const h = t.probe.refH * image.k.y;
  return { x: ORIGIN.x + c.x * image.k.x - w / 2, y: ORIGIN.y + c.y * image.k.y - h / 2, w, h };
}

/** The bounding box of a block of hexes, from the grid's own corners. */
function blockOf(t, image, cells) {
  const pts = cells.flatMap(([i, j]) => t.grid.getVertices({ i, j }));
  const xs = pts.map((p) => ORIGIN.x + p.x * image.k.x);
  const ys = pts.map((p) => ORIGIN.y + p.y * image.k.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** A box grown about its own centre by a factor on both sides. */
const grownBox = (b, f) => ({ x: b.x - (b.w * (f - 1)) / 2, y: b.y - (b.h * (f - 1)) / 2, w: b.w * f, h: b.h * f });

const fitReal = (t, image, boxes, { probe = t.probe, other = otherOf(t).probe } = {}) => fitHexLattice({ boxes, probe, scale: image.scale, otherProbe: other });
const realPlan = (family, fit, samples) => planSetup({ family, samples, fit, cellWorth: 5, scene: HEX_SCENE, solution: HEX_SOLUTION });

const BLOCK_2X2 = [[0, 0], [0, 1], [1, 0], [1, 1]];

for (const t of [ROWS, COLS]) {
  test(`real fit, ${t.family}: a 2 by 2 block alone is read as the other family's hex, a warning and no need`, () => {
    const fit = fitReal(t, LARGE, [blockOf(t, LARGE, BLOCK_2X2)]);
    assert.equal(fit.ok, true, "the real fit takes a lone block, shaped like the other family's hex, as one hex");
    const p = realPlan(t.family, fit, { boxes: 1 });
    assert.deepEqual(p.needs, []);
    assert.deepEqual(p.warnings, [{ id: "familyMismatch", action: "familySelect", basis: "shape" }]);
    assert.equal(p.canApply, true);
  });

  test(`real fit, ${t.family}: two 2 by 2 blocks are a loose fit that names no box, beside the family warning`, () => {
    const blocks = [blockOf(t, LARGE, BLOCK_2X2), blockOf(t, LARGE, BLOCK_2X2.map(([i, j]) => [i + 8, j + 8]))];
    const fit = fitReal(t, LARGE, blocks);
    assert.equal(fit.worst, null, "two used boxes name no worst one");
    const p = realPlan(t.family, fit, { boxes: 2 });
    assert.deepEqual(p.warnings, [
      { id: "familyMismatch", action: "familySelect", basis: "shape" },
      { id: "looseFit", worst: null, rmsPct: fit.rmsPct },
    ]);
    assert.deepEqual(p.needs, []);
    assert.equal(p.canApply, true);
  });

  test(`real fit, ${t.family}: a lone strip of three hexes fails the fit and needs a one-hex box, not a family choice`, () => {
    const one = exactBox(t, LARGE, 0, 0);
    const fit = fitReal(t, LARGE, [{ ...one, w: 3 * one.w }]);
    assert.equal(fit.ok, false);
    assert.equal(fit.reason, "noOneHex");
    const p = realPlan(t.family, fit, { boxes: 1 });
    assert.deepEqual(p.needs, [{ id: "oneHexBox", action: "boxTool" }]);
    assert.equal(p.canApply, false);
    assert.deepEqual(p.unused, []);
    assert.deepEqual(p.warnings, []);
  });

  test(`real fit, ${t.family}: one correct box drawn up to 3 px off every edge is used and nothing is unused`, () => {
    const exact = exactBox(t, LARGE, 4, 3);
    for (const signs of [[1, 1, 1, 1], [-1, -1, -1, -1], [-1, 1, -1, 1], [1, -1, 1, -1], [-1, 1, 1, -1], [1, -1, -1, 1]]) {
      const [l, r, tp, bt] = signs.map((s) => s * 3);
      const box = { x: exact.x + l, y: exact.y + tp, w: exact.w + r - l, h: exact.h + bt - tp };
      const fit = fitReal(t, LARGE, [box]);
      assert.equal(fit.ok, true, `signs ${signs}`);
      assert.equal(fit.used, 1, `signs ${signs}`);
      const p = realPlan(t.family, fit, { boxes: 1 });
      assert.deepEqual(p.needs, [], `signs ${signs}`);
      assert.deepEqual(p.unused, [], `signs ${signs}: no box is called multi-hex`);
      assert.equal(p.canApply, true, `signs ${signs}`);
    }
  });

  test(`real fit, ${t.family}: one good box among blocks is a fit with the blocks unused, and no one-hex need`, () => {
    const boxes = [blockOf(t, LARGE, BLOCK_2X2.map(([i, j]) => [i + 8, j + 8])), exactBox(t, LARGE, 0, 0), blockOf(t, LARGE, [[12, 12], [12, 13], [12, 14]])];
    const fit = fitReal(t, LARGE, boxes);
    assert.equal(fit.ok, true);
    const p = realPlan(t.family, fit, { boxes: 3 });
    assert.deepEqual(p.needs, []);
    assert.deepEqual(p.unused, [{ id: "multiHexBoxes", count: 2 }]);
    assert.equal(p.canApply, true);
  });
}

test("real fit: a far pair, 25 hexes apart and 4% oversize, is an unreachable warning and Apply stays on", () => {
  const boxes = [grownBox(exactBox(ROWS, LARGE, 0, 0), 1.04), grownBox(exactBox(ROWS, LARGE, 0, 25), 1.04)];
  const fit = fitReal(ROWS, LARGE, boxes);
  assert.equal(fit.ok, true);
  assert.equal(fit.unreachable, 1, "the real fit cannot place the second box");
  const p = realPlan("hexRows", fit, { boxes: 2 });
  assert.deepEqual(p.needs, []);
  assert.ok(p.warnings.some((w) => w.id === "unreachable" && w.count === 1 && w.action === "boxTool"), JSON.stringify(p.warnings));
  assert.deepEqual(p.unused, [{ id: "unreachableBoxes", count: 1 }]);
  assert.equal(p.canApply, true);
});

test("real fit: pointy rows stretched 1.25 times in x and fitted as columns is a family warning, never a need", () => {
  const stretched = { k: { x: LARGE.k.x * 1.25, y: LARGE.k.y }, scale: LARGE.scale };
  const boxes = [[0, 0], [1, 0], [2, 1], [3, 0], [0, 2]].map(([i, j]) => exactBox(ROWS, stretched, i, j));
  const fit = fitReal(COLS, stretched, boxes, { probe: COLS.probe, other: ROWS.probe });
  assert.equal(fit.ok, true, "the fit keeps the Judge's family");
  const p = realPlan("hexCols", fit, { boxes: 5 });
  assert.deepEqual(p.needs, []);
  assert.deepEqual(p.warnings.filter((w) => w.id === "familyMismatch"), [{ id: "familyMismatch", action: "familySelect", basis: "lattice" }]);
  assert.equal(p.canApply, true);
  const asRows = realPlan("hexRows", fitReal(ROWS, stretched, boxes), { boxes: 5 });
  assert.deepEqual(asRows.warnings, [], "the boxes' own family warns of nothing");
});

/* -------------------------------------------- */
/*  Already matches                             */
/* -------------------------------------------- */

test("a scene that already holds the solution matches and disables Apply", () => {
  const scene = { ...GRIDLESS_SCENE, ...SQUARE_SOLUTION, autoScale: true };
  const p = plan({ family: "square", samples: { boxes: 2 }, fit: SQUARE_FIT, scene });
  assert.deepEqual(p.rows, []);
  assert.equal(p.matches, true);
  assert.equal(p.canApply, false);
  assert.deepEqual(p.needs, []);
});

test("no solution is not a match", () => {
  const p = plan({ family: "square", samples: {}, fit: null, solution: null });
  assert.equal(p.matches, false);
});

/* -------------------------------------------- */
/*  Auto-sizing                                 */
/* -------------------------------------------- */

test("auto-sizing is off at an expedition scale and on otherwise, and the row follows", () => {
  const args = { family: "square", samples: { boxes: 2 }, fit: SQUARE_FIT };
  const near = plan({ ...args, expeditionScale: false });
  assert.equal(near.autoScale, true);
  assert.deepEqual(rowOf(near, "tokenSizing"), { id: "tokenSizing", before: false, after: true });

  const far = plan({ ...args, expeditionScale: true });
  assert.equal(far.autoScale, false);
  assert.equal(rowOf(far, "tokenSizing"), undefined, "an apply that leaves it off over a scene with it off has no row");

  const wasOn = plan({ ...args, scene: { ...GRIDLESS_SCENE, autoScale: true }, expeditionScale: true });
  assert.deepEqual(rowOf(wasOn, "tokenSizing"), { id: "tokenSizing", before: true, after: false, because: "expeditionScale" });
});

test("auto-sizing defaults to on when the caller says nothing about scale", () => {
  assert.equal(plan({ family: "square", samples: { boxes: 2 }, fit: SQUARE_FIT }).autoScale, true);
});

/* -------------------------------------------- */
/*  Cell worth                                  */
/* -------------------------------------------- */

test("cell worth: an entered value wins over everything", () => {
  const scene = { distance: 5, units: "ft" };
  assert.equal(resolveCellWorth({ entered: 3, fromBar: 8, units: "mi", scene }), 3);
});

test("cell worth: a bar's measurement beats the scene's number", () => {
  assert.equal(resolveCellWorth({ fromBar: 8, units: "mi", scene: { distance: 5, units: "ft" } }), 8);
});

test("cell worth: the same unit, spelled differently, takes the scene's distance", () => {
  assert.equal(resolveCellWorth({ units: "mi", scene: { distance: 6, units: "Miles" } }), 6);
  assert.equal(resolveCellWorth({ units: "ft", scene: { distance: 5, units: "Ft." } }), 5);
});

test("cell worth: a kept unit and a blank scene unit read as the scene's own", () => {
  assert.equal(resolveCellWorth({ units: null, scene: { distance: 5, units: "furlongs" } }), 5);
  assert.equal(resolveCellWorth({ units: "ft", scene: { distance: 5, units: "" } }), 5);
});

test("cell worth: a different unit resolves to null and the plan asks for it", () => {
  const scene = { distance: 5, units: "ft" };
  const worth = resolveCellWorth({ units: "mi", scene });
  assert.equal(worth, null);
  const p = plan({ family: "hexRows", samples: { boxes: 1 }, fit: hexFit(), solution: HEX_SOLUTION, cellWorth: worth });
  assert.deepEqual(ids(p), ["cellWorth"]);
  assert.equal(p.needs[0].action, "cellWorthField");
});

test("cell worth: a scene with no usable distance resolves to null", () => {
  assert.equal(resolveCellWorth({ units: null, scene: { distance: 0, units: "ft" } }), null);
  assert.equal(resolveCellWorth({}), null);
});

/* -------------------------------------------- */
/*  The expedition-scale helper                 */
/* -------------------------------------------- */

test("expedition scale: six miles leaves auto-sizing off, five feet turns it on", () => {
  const scene = { distance: 5, units: "ft" };
  assert.equal(expeditionScaleOf({ distance: 6, units: "mi", scene }), true);
  assert.equal(expeditionScaleOf({ distance: 5, units: "ft", scene }), false);
  assert.equal(plan({ family: "square", samples: { boxes: 2 }, fit: SQUARE_FIT, expeditionScale: expeditionScaleOf({ distance: 6, units: "mi", scene }) }).autoScale, false);
  assert.equal(plan({ family: "square", samples: { boxes: 2 }, fit: SQUARE_FIT, expeditionScale: expeditionScaleOf({ distance: 5, units: "ft", scene }) }).autoScale, true);
});

test("expedition scale: a kept unit reads the scene's own, so six in a scene already in miles is off", () => {
  assert.equal(expeditionScaleOf({ distance: 6, units: null, scene: { distance: 1, units: "miles" } }), true);
  assert.equal(expeditionScaleOf({ distance: 6, units: "", scene: { distance: 1, units: "Mi." } }), true);
  assert.equal(expeditionScaleOf({ distance: 6, units: null, scene: { distance: 6, units: "ft" } }), false, "six feet in a scene kept in feet is a delve");
});

test("expedition scale: the unit written decides, not the scene's old one", () => {
  const inMiles = { distance: 6, units: "mi" };
  assert.equal(expeditionScaleOf({ distance: 6, units: "ft", scene: inMiles }), false, "a unit chosen as feet overrides the scene's miles");
  assert.equal(expeditionScaleOf({ distance: 1, units: "mi", scene: { distance: 5, units: "ft" } }), true, "exactly a mile counts");
  assert.equal(expeditionScaleOf({ distance: 5000, units: "ft", scene: inMiles }), false, "just under a mile does not");
  assert.equal(expeditionScaleOf({ distance: null, units: "mi", scene: { distance: 6, units: "ft" } }), true, "no solution distance falls back to the scene's");
  assert.equal(expeditionScaleOf({}), false);
});

/* -------------------------------------------- */
/*  Solve and write                             */
/* -------------------------------------------- */

// The solve answers the planner's `solution` and the scene's `update` from one
// set of values, and the writer writes that update. A scene stand-in whose
// clone reports core's hex grid and a zero-shift padded origin, and whose
// `update` applies what it is given.

const savedGlobals = { foundry: globalThis.foundry, game: globalThis.game, ui: globalThis.ui };
const said = { confirmed: 0, info: [], error: [] };
globalThis.game = { i18n: { format: (key, data) => ({ key, data }), localize: (key) => key } };
globalThis.ui = { notifications: { info: (m) => said.info.push(m), error: (m) => said.error.push(m), warn: () => {} } };
globalThis.foundry = {
  canvas: { getTexture: () => ({ width: 4000, height: 3000 }) },
  applications: { api: { DialogV2: { confirm: async () => { said.confirmed++; return said.answer ?? true; } } } },
};

/**
 * Core's `getCenterPoint` also takes a point and answers the nearest hex
 * centre; the stand-in grid answers offsets only, so this adds the snap by
 * scanning a window of offsets for the nearest centre.
 */
const snapping = (grid) => ({
  ...grid,
  getCenterPoint(at) {
    if (Number.isFinite(at?.i)) return grid.getCenterPoint(at);
    let best = null;
    for (let i = -3; i < 70; i++) {
      for (let j = -3; j < 70; j++) {
        const c = grid.getCenterPoint({ i, j });
        const d = Math.hypot(c.x - at.x, c.y - at.y);
        if (!best || d < best.d) best = { d, c };
      }
    }
    return best.c;
  },
});

function solveScene({ gridType = GRID_TYPE.GRIDLESS, autoScale = false } = {}) {
  const scene = {
    grid: { type: gridType, size: 100, distance: 5, units: "ft" },
    background: { src: "map.webp" },
    flags: { [MODULE_ID]: { [FLAG_BATTLEMAP]: { autoScale } } },
    updates: [],
    clone(data) {
      const type = data["grid.type"] ?? gridType;
      const size = data["grid.size"] ?? 100;
      const grid = type >= GRID_TYPE.HEXODDR
        ? { type, ...coreHexGrid({ columns: type === GRID_TYPE.HEXODDQ || type === GRID_TYPE.HEXEVENQ, even: type === GRID_TYPE.HEXEVENR || type === GRID_TYPE.HEXEVENQ, size }) }
        : { type, size };
      return { grid: type >= GRID_TYPE.HEXODDR ? snapping(grid) : grid, getDimensions: () => ({ sceneX: 40, sceneY: 60 }) };
    },
    async update(patch) {
      scene.updates.push(patch);
      for (const [key, value] of Object.entries(patch)) {
        if (key.startsWith("grid.")) scene.grid[key.slice(5)] = value;
        if (key.startsWith("flags.")) scene.flags = { [MODULE_ID]: { [FLAG_BATTLEMAP]: value } };
      }
    },
  };
  return scene;
}

/** Every field the solve names, read off the update payload the way the scene would take it. */
const payloadOf = (update) => ({
  gridType: update["grid.type"], gridSize: update["grid.size"], distance: update["grid.distance"],
  unitsAbbr: update["grid.units"], width: update.width, height: update.height, shiftX: update.shiftX, shiftY: update.shiftY,
});

function assertSolveAgrees(solved, { units }) {
  assert.equal(solved.ok, true, `the solve refused: ${solved.reason}`);
  const { solution, update } = solved;
  const p = payloadOf(update);
  assert.equal(p.gridType, solution.gridType, "grid type");
  assert.equal(p.gridSize, solution.gridSize, "grid size");
  assert.equal(p.distance, solution.distance, "distance");
  assert.equal(p.unitsAbbr, DISTANCE_UNITS[solution.units].abbr, "units");
  assert.equal(solution.units, units, "the solution carries the chosen unit key");
  for (const f of ["width", "height", "shiftX", "shiftY"]) assert.equal(p[f], solution[f], f);
  assert.deepEqual(Object.keys(update).sort(), ["grid.distance", "grid.size", "grid.type", "grid.units", "height", "shiftX", "shiftY", "width"],
    "the payload writes exactly the fields the solution names");
  // And the planner reads the same numbers the scene would be given.
  const rows = planSetup({ family: "square", samples: { boxes: 1 }, fit: SQUARE_FIT, cellWorth: solution.distance, scene: GRIDLESS_SCENE, solution }).rows;
  const image = rows.find((r) => r.id === "image");
  assert.deepEqual([image.after.width, image.after.height, image.after.shiftX, image.after.shiftY], [update.width, update.height, update.shiftX, update.shiftY], "the image row");
  assert.equal(rows.find((r) => r.id === "grid").after.size, update["grid.size"], "the grid row");
  assert.equal(rows.find((r) => r.id === "cellWorth").after.distance, update["grid.distance"], "the worth row");
}

test("solve, hex: the update payload equals the solution the rows are built from", () => {
  const fit = fitReal(ROWS, LARGE, [exactBox(ROWS, LARGE, 0, 0), exactBox(ROWS, LARGE, 1, 0), exactBox(ROWS, LARGE, 2, 1)]);
  assert.equal(fit.ok, true);
  const solved = solveHexCalibration(solveScene(), fit, { gridSize: 100.4, outputFeet: 6, family: "hexRows", hexEven: false, units: "mi", mapSystem: null });
  assertSolveAgrees(solved, { units: "mi" });
  assert.equal(solved.solution.gridSize, 100, "the size is rounded once, for both");
  assert.equal(solved.solution.gridType, GRID_TYPE.HEXODDR);
  const even = solveHexCalibration(solveScene(), fit, { gridSize: 100, outputFeet: 6, family: "hexRows", hexEven: true, units: "mi" });
  assert.equal(even.solution.gridType, GRID_TYPE.HEXEVENR, "the parity picks the type for both");
  assert.equal(even.update["grid.type"], GRID_TYPE.HEXEVENR);
});

test("solve, hex: the fitted centre is what the shift lands on, not a box's own", () => {
  const boxes = [exactBox(ROWS, LARGE, 0, 0), exactBox(ROWS, LARGE, 1, 0), exactBox(ROWS, LARGE, 2, 1)];
  const fit = fitReal(ROWS, LARGE, boxes);
  const a = solveHexCalibration(solveScene(), fit, { gridSize: 100, outputFeet: 6, family: "hexRows", units: "mi" });
  const b = solveHexCalibration(solveScene(), { ...fit, centre: { x: fit.centre.x + 20, y: fit.centre.y } }, { gridSize: 100, outputFeet: 6, family: "hexRows", units: "mi" });
  assert.notEqual(a.solution.shiftX, b.solution.shiftX, "a fit centred elsewhere shifts the image elsewhere");
});

test("solve, square: the update payload equals the solution the rows are built from", () => {
  const solved = solveGridCalibration(solveScene(), SQUARE_FIT, { gridSize: 100.4, outputFeet: 25, mapCellFeet: 25, units: "ft", mapSystem: null });
  assertSolveAgrees(solved, { units: "ft" });
  assert.equal(solved.solution.gridType, GRID_TYPE.SQUARE);
  assert.equal(solved.solution.gridSize, 100);
});

test("solve: a refusal answers a reason and speaks to no one", () => {
  const before = { info: said.info.length, error: said.error.length, confirmed: said.confirmed };
  assert.deepEqual(solveGridCalibration(solveScene({ gridType: GRID_TYPE.HEXODDR }), SQUARE_FIT, { gridSize: 100, outputFeet: 5, mapCellFeet: 5 }), { ok: false, reason: "notSquareGrid" });
  const noImage = solveScene();
  const real = globalThis.foundry.canvas.getTexture;
  globalThis.foundry.canvas.getTexture = () => null;
  assert.deepEqual(solveGridCalibration(noImage, SQUARE_FIT, { gridSize: 100, outputFeet: 5, mapCellFeet: 5 }), { ok: false, reason: "noBackground" });
  globalThis.foundry.canvas.getTexture = real;
  assert.deepEqual(solveGridCalibration(solveScene(), SQUARE_FIT, { gridSize: 100, outputFeet: 5, mapCellFeet: null }), { ok: false, reason: "badSolution" });
  assert.deepEqual(solveHexCalibration(solveScene(), { ok: true, sizeX: 30, sizeY: 40 }, { gridSize: 100, outputFeet: 6, family: "hexRows" }), { ok: false, reason: "badSolution" }, "a hex fit with no centre");
  assert.deepEqual(solveScaleOnly({ size: 0, distance: 3 }), { ok: false, reason: "badSolution" });
  assert.deepEqual({ info: said.info.length, error: said.error.length, confirmed: said.confirmed }, before, "no notification and no dialog");
  assert.equal(noImage.updates.length, 0, "and no update");
});

test("solve, scale-only: the solution carries no geometry and the update touches none", () => {
  const solved = solveScaleOnly({ size: 120, distance: 2.5, units: "mi", mapSystem: "journey" });
  assert.deepEqual(solved.solution, { gridSize: 120, distance: 2.5, units: "mi", mapSystem: "journey" });
  assert.deepEqual(solved.update, { "grid.size": 120, "grid.distance": 2.5, "grid.units": "mi" });
});

/** Solve, plan and write a hex apply over a scene, the way the panel does. */
async function applyHex({ units, outputFeet, scene }) {
  const fit = fitReal(ROWS, LARGE, [exactBox(ROWS, LARGE, 0, 0), exactBox(ROWS, LARGE, 1, 0), exactBox(ROWS, LARGE, 2, 1)]);
  const solved = solveHexCalibration(scene, fit, { gridSize: 100, outputFeet, family: "hexRows", units, mapSystem: null });
  const p = planSetup({
    family: "hexRows", samples: { boxes: 3 }, fit, cellWorth: outputFeet,
    scene: { gridType: scene.grid.type, gridSize: scene.grid.size, distance: scene.grid.distance, units: scene.grid.units, width: 4000, height: 3000, shiftX: 0, shiftY: 0, autoScale: scene.flags[MODULE_ID][FLAG_BATTLEMAP].autoScale, mapSystem: null, hasBackground: true },
    solution: solved.solution,
    expeditionScale: expeditionScaleOf({ distance: solved.solution.distance, units, scene: scene.grid }),
  });
  const applied = await writeSetup(scene, solved, { family: "hexRows", autoScale: p.autoScale });
  return { applied, plan: p, solved };
}

await (async () => {
  const run = async (name, fn) => {
    try {
      await fn();
      results.push({ name, ok: true });
      console.log(`  ok   ${name}`);
    } catch (err) {
      results.push({ name, ok: false });
      console.log(`  FAIL ${name}\n${err.stack}`);
    }
  };
  const record = (scene) => scene.updates.at(-1)[`flags.${MODULE_ID}.${FLAG_BATTLEMAP}`];

  await run("write: a mile-scale apply writes auto-sizing off even over a scene that had it on", async () => {
    const scene = solveScene({ autoScale: true });
    const { applied, plan: p } = await applyHex({ units: "mi", outputFeet: 6, scene });
    assert.equal(applied, true);
    assert.equal(p.autoScale, false);
    assert.deepEqual(record(scene), { calibrated: true, distance: 6, autoScale: false, mapSystem: null });
  });

  await run("write: a foot-scale apply writes auto-sizing on", async () => {
    const scene = solveScene({ autoScale: false });
    const { applied } = await applyHex({ units: "ft", outputFeet: 5, scene });
    assert.equal(applied, true);
    assert.equal(record(scene).autoScale, true);
  });

  await run("write: the update sent is the solve's update plus the flag record, and nothing else", async () => {
    const scene = solveScene();
    const { solved } = await applyHex({ units: "mi", outputFeet: 6, scene });
    const { [`flags.${MODULE_ID}.${FLAG_BATTLEMAP}`]: flag, ...rest } = scene.updates.at(-1);
    assert.deepEqual(rest, solved.update);
    assert.deepEqual(Object.keys(flag).sort(), ["autoScale", "calibrated", "distance", "mapSystem"]);
  });

  await run("write: the done notice names the family and the unit, per family", async () => {
    const hex = solveScene();
    await applyHex({ units: "mi", outputFeet: 6, scene: hex });
    assert.deepEqual(said.info.at(-1), { key: "ACKS-BATTLEMAP.apply.doneHex", data: { size: 100, distance: 6, units: "mi" } });

    const square = solveScene();
    const sq = solveGridCalibration(square, SQUARE_FIT, { gridSize: 100, outputFeet: 5, mapCellFeet: 5, units: "ft" });
    assert.equal(await writeSetup(square, sq, { family: "square", autoScale: true }), true);
    assert.deepEqual(said.info.at(-1), { key: "ACKS-BATTLEMAP.apply.done", data: { size: 100, distance: 5, units: "ft" } });

    const ruler = solveScene();
    const sc = solveScaleOnly({ size: 120, distance: 2, units: "mi" });
    assert.equal(await writeSetup(ruler, sc, { family: "scale", autoScale: false }), true);
    assert.deepEqual(said.info.at(-1), { key: "ACKS-BATTLEMAP.apply.doneScale", data: { size: 120, distance: 2, units: "mi" } });
  });

  await run("write: a kept unit names the scene's own, and a declined confirmation writes nothing", async () => {
    const scene = solveScene();
    scene.grid.units = "miles";
    await applyHex({ units: null, outputFeet: 6, scene });
    assert.equal(said.info.at(-1).data.units, "miles");
    const declined = solveScene();
    said.answer = false;
    const { applied } = await applyHex({ units: "mi", outputFeet: 6, scene: declined });
    said.answer = undefined;
    assert.equal(applied, false);
    assert.equal(declined.updates.length, 0);
  });

  await run("write: a scene that does not take the update is reported and not announced", async () => {
    const scene = solveScene();
    scene.update = async () => {};
    const before = said.info.length;
    const { applied } = await applyHex({ units: "mi", outputFeet: 6, scene });
    assert.equal(applied, false);
    assert.equal(said.info.length, before);
    assert.equal(said.error.at(-1).key, "ACKS-BATTLEMAP.warn.applyRejected");
  });
})();

for (const [key, value] of Object.entries(savedGlobals)) {
  if (value === undefined) delete globalThis[key];
  else globalThis[key] = value;
}

/* -------------------------------------------- */

const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.log(`test-battlemap-setup-plan: FAILED ${failed.length} of ${results.length} (${failed.map((r) => r.name).join("; ")})`);
  process.exit(1);
}
console.log(`test-battlemap-setup-plan: OK (${results.length} tests: needs for square, both hex families and scale-only, every family's blank worth, rows for a square, hex and scale-only solve, unchanged fields, the already-matching scene, the auto-sizing decision, the cell worth, the warnings a fit carries, real \`fitHexLattice\` answers fed to the planner, the expedition-scale helper, and the solve and the write of each family)`);
