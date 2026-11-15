/**
 * The map setup planner: the needs list for every family and sample
 * combination, the rows the apply would rewrite, the already-matches case, the
 * auto-sizing decision and the cell-worth resolution. Pure functions over
 * plain data; synthetic figures only, nothing read off a page.
 */
import assert from "node:assert/strict";
import { planSetup, resolveCellWorth } from "../scripts/battlemap/setup-plan.mjs";
import { GRID_TYPE } from "../scripts/battlemap/constants.mjs";
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

const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.log(`test-battlemap-setup-plan: FAILED ${failed.length} of ${results.length} (${failed.map((r) => r.name).join("; ")})`);
  process.exit(1);
}
console.log(`test-battlemap-setup-plan: OK (${results.length} tests: needs for square, both hex families and scale-only, every family's blank worth, rows for a square, hex and scale-only solve, unchanged fields, the already-matching scene, the auto-sizing decision, the cell worth, the warnings a fit carries, and real \`fitHexLattice\` answers fed to the planner)`);
