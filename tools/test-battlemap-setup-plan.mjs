/**
 * The map setup planner: the needs list for every family and sample
 * combination, the rows the apply would rewrite, the already-matches case, the
 * auto-sizing decision and the cell-worth resolution. Pure functions over
 * plain data; synthetic figures only, nothing read off a page.
 */
import assert from "node:assert/strict";
import { planSetup, resolveCellWorth } from "../scripts/battlemap/setup-plan.mjs";
import { GRID_TYPE } from "../scripts/battlemap/constants.mjs";

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

const hexBox = (index, over = {}) => ({ index, cell: { i: index, j: 0 }, residual: 0.01, notOneHex: false, otherFamily: false, ...over });
const hexFit = (over = {}) => ({
  ok: true, sizeX: 80, sizeY: 92, centre: { x: 500, y: 400 }, k: { x: 1, y: 1 }, spacing: { u: 80, v: 69 }, from: { x: 460, y: 354 },
  boxes: [hexBox(0)], used: 1, rmsPct: 0.01, maxPct: 0.02, worst: 0, confidence: "tight", samples: 1, ...over,
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

  test(`${family}: only other-family boxes send the Judge to the family choice`, () => {
    const boxes = [hexBox(0, { otherFamily: true }), hexBox(1, { otherFamily: true })];
    const p = hexPlan({ samples: { boxes: 2 }, fit: hexFail("noOneHex", boxes), solution: null });
    assert.deepEqual(ids(p), ["otherFamilyBox"]);
    assert.equal(p.needs[0].action, "familySelect");
  });

  test(`${family}: a noOneHex failure that carries no boxes reads as a missing one-hex box`, () => {
    const p = hexPlan({ samples: { boxes: 2 }, fit: { ok: false, reason: "noOneHex", samples: 2 }, solution: null });
    assert.deepEqual(ids(p), ["oneHexBox"]);
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
    const boxes = [hexBox(0), hexBox(1, { notOneHex: true }), hexBox(2, { otherFamily: true }), hexBox(3, { otherFamily: true })];
    const p = hexPlan({ samples: { boxes: 4 }, fit: hexFit({ boxes }) });
    assert.deepEqual(p.needs, []);
    assert.deepEqual(p.unused, [{ id: "otherFamilyBoxes", count: 2 }, { id: "multiHexBoxes", count: 1 }]);
  });

  test(`${family}: a good box with no worth needs the worth alone`, () => {
    assert.deepEqual(ids(hexPlan({ samples: { boxes: 1 }, fit: hexFit(), cellWorth: null })), ["cellWorth"]);
  });

  test(`${family}: a loose fit warns and names its worst box without disabling Apply`, () => {
    const p = hexPlan({ samples: { boxes: 3 }, fit: hexFit({ confidence: "loose", worst: 2, rmsPct: 0.2 }) });
    assert.deepEqual(p.warnings, [{ id: "looseFit", worst: 2, rmsPct: 0.2 }]);
    assert.deepEqual(p.needs, []);
    assert.equal(p.canApply, true);
    assert.deepEqual(hexPlan({ samples: { boxes: 1 }, fit: hexFit() }).warnings, []);
  });
}

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
  assert.equal(image.moves, true);
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
console.log(`test-battlemap-setup-plan: OK (${results.length} tests: needs for square, both hex families and scale-only, every family's blank worth, rows for a square, hex and scale-only solve, unchanged fields, the already-matching scene, the auto-sizing decision, the cell worth, a loose fit's warning)`);
