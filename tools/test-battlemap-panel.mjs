/**
 * The map setup panel, EXECUTED: the real `BattlemapAssistant` class over the
 * real calibration session, writer and planner, behind a small stand-in for the
 * Foundry application base, a scene document and a hex grid built the way
 * core's is. `_prepareContext` and the Apply handler are called as the panel
 * calls them, so a wrong key, a dropped argument or a skipped guard in the
 * panel fails here instead of surviving because a suite only read its text.
 *
 * Every figure and name is invented; nothing is read off a page. What the
 * stand-ins cannot reach (a real canvas, a real Scene write, a pixel on screen)
 * stays with the live walk.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Handlebars from "handlebars";

const MODULE_ID = "acks-extras";
const FLAG = "battlemap";
const root = (p) => new URL(`../${p}`, import.meta.url);
const read = (p) => readFileSync(root(p), "utf8");

const { LANG_PREFIX, TRAVEL_MODES } = await import(root("scripts/battlemap/constants.mjs").href);

/* -------------------------------------------- */
/*  Stand-ins                                   */
/* -------------------------------------------- */

/** A hex grid measured the way core measures one: `sizeX`/`sizeY` boxes, `getCenterPoint` by offset or by snap. */
function coreHexGrid({ columns, even = false, size = 100 }) {
  const sizeX = columns ? (size * 2) / Math.sqrt(3) : size;
  const sizeY = columns ? size : (size * 2) / Math.sqrt(3);
  return {
    sizeX,
    sizeY,
    getCenterPoint(at) {
      if (!Number.isFinite(at?.i)) {
        let best = null;
        for (let i = -3; i < 60; i++) {
          for (let j = -3; j < 60; j++) {
            const c = this.getCenterPoint({ i, j });
            const d = Math.hypot(c.x - at.x, c.y - at.y);
            if (!best || d < best.d) best = { d, c };
          }
        }
        return best.c;
      }
      const { i, j } = at;
      if (columns) return { x: (2 / Math.sqrt(3)) * ((0.75 * j + 0.5) * size), y: (i + (even === ((j + 1) % 2 === 0) ? 0 : 0.5)) * size };
      return { x: (j + (even === ((i + 1) % 2 === 0) ? 0 : 0.5)) * size, y: (2 / Math.sqrt(3)) * ((0.75 * i + 0.5) * size) };
    },
  };
}

/** The picture behind the scene, in image px. A test may widen it to stretch the image. */
const TEX = { width: 4000, height: 3000 };
const notes = [];
const confirms = [];
/** What the next scene clone's hex grid answers: a broken one reports no usable box. */
const clones = { count: 0, broken: false };

/**
 * A scene document: grid, flat background, a module flag record, `clone` for a
 * target grid, and writes that land like core's (a field it will not take is
 * dropped). `afterWrite` stands in for the `updateScene` hook module.mjs wires.
 */
function makeScene({ id = "S1", type = 0, size = 100, distance = 9, units = "ft", flag = {}, rejectType = false } = {}) {
  const scene = {
    id,
    width: 4000,
    height: 3000,
    shiftX: 0,
    shiftY: 0,
    grid: { type, size, distance, units },
    background: { src: "map.webp" },
    flags: { [MODULE_ID]: { [FLAG]: { ...flag } } },
    writes: [],
    afterWrite: null,
    get dimensions() {
      return { sceneWidth: scene.width, sceneHeight: scene.height, sceneX: 0, sceneY: 0, width: scene.width, height: scene.height };
    },
    getFlag: (m, k) => scene.flags?.[m]?.[k],
    clone(data) {
      clones.count++;
      const t = data["grid.type"] ?? type;
      const s = data["grid.size"] ?? size;
      const grid = t >= 2 ? { type: t, ...coreHexGrid({ columns: t === 4 || t === 5, even: t === 3 || t === 5, size: s }) } : { type: t, size: s };
      if (t >= 2 && clones.broken) grid.sizeY = grid.sizeX;
      return { grid, getDimensions: () => ({ sceneX: 0, sceneY: 0 }) };
    },
    async update(patch) {
      await Promise.resolve();
      scene.writes.push(patch);
      for (const [k, v] of Object.entries(patch)) {
        if (k === "grid.type" && rejectType) continue;
        if (k.startsWith("grid.")) scene.grid[k.slice(5)] = v;
        else if (k === `flags.${MODULE_ID}.${FLAG}`) scene.flags[MODULE_ID][FLAG] = { ...v };
        else scene[k] = v;
      }
      scene.afterWrite?.(scene);
    },
    async setFlag(m, k, v) {
      await Promise.resolve();
      scene.writes.push({ [`flags.${m}.${k}`]: v });
      scene.flags[m][k] = { ...v };
      scene.afterWrite?.(scene);
    },
  };
  return scene;
}

/** A form's data, expanded the way core expands dotted names. */
function expandObject(flat) {
  const out = {};
  for (const [path, value] of Object.entries(flat)) {
    const keys = path.split(".");
    let at = out;
    for (const k of keys.slice(0, -1)) at = at[k] ??= {};
    at[keys.at(-1)] = value;
  }
  return out;
}

const stripPrefix = (k) => k.replace(`${LANG_PREFIX}.`, "");
globalThis.CONST = { GRID_MIN_SIZE: 50, GRID_TYPES: { SQUARE: 1 } };
globalThis.game = {
  i18n: { format: (k, d) => `${stripPrefix(k)}${JSON.stringify(d ?? {})}`, localize: stripPrefix },
  user: { isGM: true },
};
globalThis.ui = { notifications: { info: (m) => notes.push(["info", m]), warn: (m) => notes.push(["warn", m]), error: (m) => notes.push(["error", m]) } };
globalThis.foundry = {
  applications: {
    api: {
      ApplicationV2: class {
        renders = 0;
        last = null;
        /** A render runs the panel's own context pass, as the framework would. */
        render() {
          this.renders++;
          this.last = this._prepareContext({});
          return this.last;
        }
        async _onRender() {}
        _onClose() {}
      },
      HandlebarsApplicationMixin: (Base) => class extends Base {},
      DialogV2: { confirm: async (opts) => (confirms.push(opts.content), true) },
    },
    handlebars: { loadTemplates: async () => {} },
  },
  canvas: { getTexture: () => TEX },
  utils: { expandObject, hasProperty: () => false, getProperty: () => undefined },
};
globalThis.canvas = { scene: null, stage: { scale: { x: 1 } } };
globalThis.document = { addEventListener() {}, removeEventListener() {} };
globalThis.PIXI = new Proxy({}, { get: () => class {} });

const { session } = await import(root("scripts/battlemap/session.mjs").href);
session.overlay.destroy = () => {};
session.overlay.redraw = () => {};
session.overlay.arm = () => {};
const { default: App } = await import(root("scripts/battlemap/assistant-app.mjs").href);
const { hexProbe } = await import(root("scripts/battlemap/scene-setup.mjs").href);
const { solveHexCalibration } = await import(root("scripts/battlemap/apply.mjs").href);

const applyGrid = App.DEFAULT_OPTIONS.actions.applyGrid;
const submit = App.DEFAULT_OPTIONS.form.handler;

/** The probe scene, for the lattice the boxes are drawn on. */
const probeScene = {
  clone: (d) => ({ grid: { type: d["grid.type"], ...coreHexGrid({ columns: d["grid.type"] === 4 || d["grid.type"] === 5 }) } }),
};
const LATTICE = {
  hexRows: { grid: coreHexGrid({ columns: false }), probe: hexProbe(probeScene, "hexRows", false) },
  hexCols: { grid: coreHexGrid({ columns: true }), probe: hexProbe(probeScene, "hexCols", false) },
};

/**
 * One box around hex (i, j) of a family's lattice, drawn at `kx` by `ky` image
 * px per probe px from an origin; the pair differs from 1 on a stretched image.
 */
const hexBox = (family, i, j, { kx = 1.5, ky = kx, ox = 217.3, oy = 91.1, grow = 0, even = false } = {}) => {
  const { probe } = LATTICE[family];
  const grid = even ? coreHexGrid({ columns: family === "hexCols", even }) : LATTICE[family].grid;
  const c = grid.getCenterPoint({ i, j });
  const w = probe.refW * kx;
  const h = probe.refH * ky;
  return { x: ox + c.x * kx - w / 2 + grow, y: oy + c.y * ky - h / 2, w, h };
};
const squareBox = (i, j, side = 60) => ({ x: 100 + j * side, y: 80 + i * side, w: side, h: side, cells: 1 });
const rowBoxes = (opts) => [hexBox("hexRows", 0, 0, opts), hexBox("hexRows", 0, 1, opts), hexBox("hexRows", 1, 1, opts)];

const app = new App();
/** The panel's own subscription, as `_onRender` takes it. */
await app._onRender({}, {});

/** Put the session on a scene, as `onCanvasReady` does, then take the test's choices. */
function setup({ family, scene, samples = {}, opts = {}, units, mapSystem = null, hexEven = false }) {
  canvas.scene = scene;
  session.sceneId = scene.id;
  session.reset();
  session.adoptScene(scene);
  session.samples = { squares: samples.squares ?? [], corners: samples.corners ?? [], scale: samples.scale ?? null };
  Object.assign(session.opts, opts);
  session.setSetup({ gridFamily: family, hexEven, units: units === undefined ? session.units : units, mapSystem });
  scene.afterWrite = (s) => session.onSceneUpdated(s);
  notes.length = 0;
  confirms.length = 0;
  app.renders = 0;
}

const ctx = () => app._prepareContext({});
/** A lang line's key, without its figures. */
const keyOf = (line) => String(line).replace(/\{.*$/s, "");
const flagOf = (scene) => scene.flags[MODULE_ID][FLAG];
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} !~ ${b}`);

/* -------------------------------------------- */
/*  What Apply writes                           */
/* -------------------------------------------- */

{
  // A cell worth a mile or more is written with token auto-sizing OFF, over a
  // scene that had it on: the planner's answer is written as given, in the
  // chosen unit, never carried from the scene's flag.
  const scene = makeScene({ units: "ft", distance: 9, flag: { autoScale: true } });
  setup({ family: "hexRows", scene, samples: { squares: rowBoxes() }, opts: { mapCellFeet: 3 }, units: "mi" });
  const c = await ctx();
  assert.equal(c.canApply, true, "a hex fit with a worth is open to Apply");
  await applyGrid.call(app);
  assert.equal(scene.grid.units, "mi", "the chosen unit is the one written");
  assert.equal(scene.grid.distance, 3);
  assert.equal(flagOf(scene).autoScale, false, "a mile-scale apply writes auto-sizing off (ruling: write it off)");
  assert.equal(notes.at(-1)[0], "info", "the apply reports done");
}

{
  // The same fixture in the scene's own small unit keeps sizing on, so the
  // rule above is a decision and not a constant.
  const scene = makeScene({ units: "ft", distance: 9, flag: { autoScale: false } });
  setup({ family: "hexRows", scene, samples: { squares: rowBoxes() }, opts: { mapCellFeet: 3 }, units: "ft" });
  await ctx();
  await applyGrid.call(app);
  assert.equal(flagOf(scene).autoScale, true, "a cell of a few feet writes auto-sizing on");
}

{
  // The travel system chosen in the panel is part of the write.
  const system = TRAVEL_MODES[1];
  const scene = makeScene();
  setup({ family: "hexRows", scene, samples: { squares: rowBoxes() }, opts: { mapCellFeet: 3 }, units: "ft", mapSystem: system });
  await ctx();
  await applyGrid.call(app);
  assert.equal(flagOf(scene).mapSystem, system, "the declared system is written, never erased");
  assert.equal(flagOf(scene).calibrated, true);
}

{
  // Apply writes only while the shown plan is open, and only to the scene it was planned for.
  const shown = makeScene({ id: "S1" });
  const other = makeScene({ id: "S2" });
  setup({ family: "hexRows", scene: shown, samples: { squares: rowBoxes() }, opts: { mapCellFeet: 3 }, units: "ft" });
  await ctx();
  canvas.scene = other;
  await applyGrid.call(app);
  assert.equal(shown.writes.length + other.writes.length, 0, "a plan built for one scene is never written to another");
  canvas.scene = shown;
  await applyGrid.call(app);
  assert.ok(shown.writes.length > 0, "and is written to its own");
}

{
  // A scene that refuses the grid type reports the rejection and no success.
  const scene = makeScene({ rejectType: true });
  setup({ family: "hexRows", scene, samples: { squares: rowBoxes() }, opts: { mapCellFeet: 3 }, units: "ft" });
  await ctx();
  await applyGrid.call(app);
  assert.deepEqual(notes.map((n) => n[0]), ["error"], "a type the scene did not take is an error, not a done notice");
}

{
  // The placeables note belongs to a write that moves the scene's dimensions,
  // so the scale-only confirmation never carries it and a hex apply does.
  const scene = makeScene({ type: 1 });
  setup({ family: "scale", scene, samples: { squares: [squareBox(0, 0, 180)] }, opts: { mapCellFeet: 7 }, units: "ft" });
  assert.equal((await ctx()).canApply, true);
  await applyGrid.call(app);
  assert.equal(confirms.length, 1);
  assert.ok(!confirms[0].includes("confirmShift"), "scale-only moves no placeable");
  const hexScene = makeScene();
  setup({ family: "hexRows", scene: hexScene, samples: { squares: rowBoxes() }, opts: { mapCellFeet: 3 }, units: "ft" });
  await ctx();
  await applyGrid.call(app);
  assert.ok(confirms[0].includes("confirmShift"), "a hex apply re-dimensions the scene and says so");
}

{
  // A hex solve refuses a cell worth nothing; the panel never asks, so the writer's own guard is called directly.
  const scene = makeScene();
  setup({ family: "hexRows", scene, samples: { squares: rowBoxes() }, opts: { mapCellFeet: 3 }, units: "ft" });
  const fit = session.fit;
  assert.equal(fit.ok, true);
  const solve = (outputFeet) => solveHexCalibration(scene, fit, { gridSize: 100, outputFeet, family: "hexRows", probe: session.hexProbe });
  assert.equal(solve(3).ok, true);
  assert.deepEqual(solve(0), { ok: false, reason: "badSolution" });
  assert.deepEqual(solve(-2), { ok: false, reason: "badSolution" });
}

/* -------------------------------------------- */
/*  What the panel says                         */
/* -------------------------------------------- */

{
  // Apply is off, and says why, while a gap is open; the line is the gap's own.
  const scene = makeScene({ type: 1 });
  setup({ family: "square", scene });
  let c = await ctx();
  assert.equal(c.canApply, false);
  assert.ok(c.needLines.map(keyOf).includes("needs.gridSample"), "a square fit with no sample names the box tool's gap");

  setup({ family: "square", scene, samples: { scale: { x1: 100, y1: 900, x2: 700, y2: 900 } } });
  c = await ctx();
  assert.ok(c.needLines.map(keyOf).includes("needs.gridSampleBar"), "a bar alone is told it needs a fit");

  setup({ family: "hexRows", scene: makeScene() });
  c = await ctx();
  assert.ok(c.needLines.map(keyOf).includes("needs.hexBox"), "a hex family with no box names the hex box's gap");
  assert.ok(!c.needLines.map(keyOf).includes("needs.gridSample"));
}

{
  // A scene that already says what Apply would write leaves Apply off and says so.
  const scene = makeScene();
  setup({ family: "hexRows", scene, samples: { squares: rowBoxes() }, opts: { mapCellFeet: 3 }, units: "ft" });
  assert.equal((await ctx()).canApply, true);
  await applyGrid.call(app);
  const c = await ctx();
  assert.equal(c.canApply, false, "nothing left to write");
  assert.equal(keyOf(c.matchesLine), "apply.matches");
}

{
  // The loose-fit line names the furthest box by its row number: the third box drawn is "3".
  const scene = makeScene();
  const boxes = [hexBox("hexRows", 0, 0), hexBox("hexRows", 0, 1), hexBox("hexRows", 1, 1, { grow: 60 }), hexBox("hexRows", 1, 2)];
  setup({ family: "hexRows", scene, samples: { squares: boxes }, opts: { mapCellFeet: 3 }, units: "ft" });
  const fit = session.fit;
  assert.equal(fit.ok, true);
  assert.equal(fit.confidence, "loose", "the displaced box makes the fit loose");
  assert.equal(fit.worst, 2, "and the fit names the displaced box");
  const c = await ctx();
  const line = c.warnLines.find((l) => keyOf(l) === "warn.looseHexWorst");
  assert.ok(line, "a loose hex fit that names a box says which");
  assert.equal(JSON.parse(line.slice(line.indexOf("{"))).n, 3, "the row number is the box's index plus one");
  assert.equal(c.canApply, true, "a loose fit warns and leaves Apply open");
}

{
  // A hex bar measures one step between hex centres, whichever way it runs.
  const k = 1.5;
  const { grid, probe } = LATTICE.hexRows;
  const a = grid.getCenterPoint({ i: 0, j: 0 });
  const b = grid.getCenterPoint({ i: 1, j: 0 });
  const bar = { x1: 400, y1: 900, x2: 400 + (b.x - a.x) * k, y2: 900 + (b.y - a.y) * k };
  assert.ok(probe.refW > 0);
  const scene = makeScene();
  setup({ family: "hexRows", scene, samples: { squares: rowBoxes({ kx: k }), scale: bar }, opts: { scaleValue: 7, mapCellFeet: 3 }, units: "ft" });
  const c = await ctx();
  near(c.barFeet, 7, 0.01, "a bar along one centre step reads its printed length as one cell");
}

{
  // The stretched image: boxes drawn on a picture narrower than its scene are
  // read at the scene's aspect, at a size where the hand's allowance no longer hides the stretch.
  const original = TEX.width;
  TEX.width = 3000;
  try {
    const scene = makeScene();
    const kx = (61.4 * 1) / LATTICE.hexRows.probe.refW;
    const ky = 94.6 / LATTICE.hexRows.probe.refH;
    const boxes = [0, 1, 2].map((n) => hexBox("hexRows", [0, 0, 1][n], [0, 1, 1][n], { kx, ky, ox: 200, oy: 90 }));
    setup({ family: "hexRows", scene, samples: { squares: boxes }, opts: { mapCellFeet: 3 }, units: "ft" });
    const c = await ctx();
    assert.equal(c.fitOk, true, "a stretched image is read at the scene's aspect");
    assert.equal(c.canApply, true);
  } finally {
    TEX.width = original;
  }
}

{
  // Boxes drawn on the OTHER family's lattice are named as such, not silently fitted.
  const scene = makeScene();
  const boxes = [hexBox("hexCols", 0, 0), hexBox("hexCols", 0, 1), hexBox("hexCols", 1, 1), hexBox("hexCols", 1, 2)];
  setup({ family: "hexRows", scene, samples: { squares: boxes }, opts: { mapCellFeet: 3 }, units: "ft" });
  const c = await ctx();
  const keys = c.warnLines.map(keyOf);
  assert.ok(keys.includes("warn.familyMismatch"), `the other family is named, got ${JSON.stringify(c.warnLines)}`);
  assert.equal(c.canApply, true, "a Judge gets a warning, never a block");
}

{
  // A bake stands in for samples on the families that read a square fit, and on no hex family.
  const scene = makeScene({ type: 1 });
  const baked = { ok: true, mode: "square", sizeX: 80, sizeY: 80, phaseX: 0, phaseY: 0, rmsPct: 0, rmsPx: 0, confidence: "tight", samples: 1 };
  setup({ family: "hexRows", scene });
  session.bakedFit = baked;
  assert.equal(session.fit, null, "a hex family never reads a square bake");
  assert.equal((await ctx()).fitOk, false);
  session.setSetup({ gridFamily: "square" });
  assert.equal(session.fit, baked, "the square family does");
}

{
  // Corners are a square-grid sample: a hex family refuses them with a notice; scale-only reads them.
  const scene = makeScene();
  setup({ family: "scale", scene });
  assert.equal(session.arm("corners"), "corners", "scale-only takes corners");
  assert.equal(notes.length, 0);
  session.disarm();
  session.setSetup({ gridFamily: "hexRows" });
  assert.equal(session.arm("corners"), null, "a hex family refuses corners");
  assert.deepEqual(notes.map((n) => n[0]), ["warn"]);
}

/* -------------------------------------------- */
/*  The spans box                               */
/* -------------------------------------------- */

{
  // Every family but hex divides a box by its count, so every one shows the box.
  const template = Handlebars.create();
  template.registerHelper("localize", (key) => key);
  template.registerHelper("checked", (value) => (value ? "checked" : ""));
  const render = template.compile(read("templates/battlemap/assistant-body.hbs"));
  const shows = async (family, scene) => {
    setup({ family, scene, samples: { squares: family.startsWith("hex") ? rowBoxes() : [squareBox(0, 0, 180)] }, opts: { mapCellFeet: 7 }, units: "ft" });
    return /name="boxCells\.0"/.test(render(await ctx()));
  };
  assert.equal(await shows("square", makeScene({ type: 1 })), true, "square shows the spans box");
  assert.equal(await shows("scale", makeScene({ type: 0 })), true, "scale-only shows it: its fit divides by the count too");
  assert.equal(await shows("hexRows", makeScene()), false, "a hex fit reads each box as one hex");
  assert.equal(await shows("hexCols", makeScene()), false);

  // The count is what the scale-only ratio divides by, and a submit carries it.
  const scene = makeScene({ type: 0 });
  setup({ family: "scale", scene, samples: { squares: [squareBox(0, 0, 180)] }, opts: { mapCellFeet: 7 }, units: "ft" });
  const one = (await ctx()).pxPerUnit;
  await submit.call(app, null, null, { object: { "boxCells.0": "3" } });
  assert.equal(session.samples.squares[0].cells, 3, "a count submitted on scale-only lands");
  const three = (await ctx()).pxPerUnit;
  near(one / three, 3, 0.01, "three cells in the box is a third of the pixels per unit");
}

/* -------------------------------------------- */
/*  Staying current with the scene              */
/* -------------------------------------------- */

{
  // A flag-only scene update redraws no canvas, so the session re-plans on the update itself.
  const scene = makeScene({ units: "mi", distance: 3, flag: { autoScale: true } });
  setup({ family: "hexRows", scene, samples: { squares: rowBoxes() }, opts: { mapCellFeet: 3 }, units: "mi" });
  await ctx();
  await applyGrid.call(app);
  await tick();
  let c = await app.last;
  assert.equal(c.canApply, false, "applied: nothing left to write");
  assert.equal(flagOf(scene).autoScale, false);

  // The Judge turns auto-size back on in Scene configuration: a flag, nothing else.
  scene.flags[MODULE_ID][FLAG] = { ...flagOf(scene), autoScale: true };
  const before = app.renders;
  assert.equal(session.onSceneUpdated(scene), true);
  assert.equal(app.renders, before + 1, "the panel re-renders on a flag-only update of its scene");
  c = await app.last;
  assert.equal(c.canApply, true, "the plan now sees a scene that differs from what Apply would write");
  assert.equal(c.matchesLine, null);

  // Another scene's update moves nothing.
  const stranger = makeScene({ id: "S9" });
  assert.equal(session.onSceneUpdated(stranger), false);
  assert.equal(app.renders, before + 1);
}

{
  // The travel system chosen in the panel lands as a flag-only update; the panel it came from re-plans.
  const system = TRAVEL_MODES[2];
  const scene = makeScene();
  setup({ family: "hexRows", scene, samples: { squares: rowBoxes() }, opts: { mapCellFeet: 3 }, units: "ft" });
  await ctx();
  await applyGrid.call(app);
  await tick();
  assert.equal((await app.last).canApply, false, "a matching scene");
  await submit.call(app, null, null, { object: { gridFamily: "hexRows", mapSystem: system, mapCellFeet: "3" } });
  await tick();
  assert.equal(flagOf(scene).mapSystem, system, "the select writes the scene's own record");
  const c = await app.last;
  assert.equal(keyOf(c.matchesLine), "apply.matches", "the render after the write sees the scene holding what the select shows");
}

{
  // Every typed value is in the session before the first notification, and the last notification carries the counts too.
  const scene = makeScene({ type: 1 });
  setup({ family: "square", scene, samples: { squares: [squareBox(0, 0, 180)] } });
  const seen = [];
  const stop = session.subscribe(() => seen.push({ worth: session.opts.mapCellFeet, out: session.opts.outputFeet, cells: session.samples.squares[0].cells }));
  await submit.call(app, null, null, { object: { mapCellFeet: "8", outputFeet: "4", "boxCells.0": "3" } });
  stop();
  assert.ok(seen.length >= 1);
  for (const s of seen) {
    assert.equal(s.worth, 8, "no notification fires before the typed worth is stored");
    assert.equal(s.out, 4, "nor before the output");
  }
  assert.equal(seen.at(-1).cells, 3, "the last notification carries the new counts");
}

{
  // A hex the scene cannot report closes by changing the family and changing back; the cache holds until then.
  clones.broken = true;
  try {
    const scene = makeScene();
    setup({ family: "hexRows", scene, samples: { squares: rowBoxes() }, opts: { mapCellFeet: 3 }, units: "ft" });
    assert.ok((await ctx()).needLines.map(keyOf).includes("needs.hexProbe"));
    clones.broken = false;
    assert.ok((await ctx()).needLines.map(keyOf).includes("needs.hexProbe"), "re-reading the same choice asks the scene nothing new");
    session.setSetup({ gridFamily: "hexCols" });
    session.setSetup({ gridFamily: "hexRows" });
    assert.ok(!(await ctx()).needLines.map(keyOf).includes("needs.hexProbe"), "another family and back asks again");
  } finally {
    clones.broken = false;
  }
}

{
  // The cached hex fit follows the picture without a notice: a wider picture over the same scene reads the same boxes differently.
  const original = TEX.width;
  const probe = LATTICE.hexRows.probe;
  const boxes = [0, 1, 2].map((n) => hexBox("hexRows", [0, 0, 1][n], [0, 1, 1][n], { kx: 61.4 / probe.refW, ky: 94.6 / probe.refH, ox: 200, oy: 90 }));
  try {
    TEX.width = 3000;
    setup({ family: "hexRows", scene: makeScene(), samples: { squares: boxes }, opts: { mapCellFeet: 3 }, units: "ft" });
    assert.equal(session.fit.ok, true, "stretched, the boxes are one hex each");
    TEX.width = 4000;
    assert.equal(session.fit.ok, false, "unstretched, the same boxes are not: the fit was asked again");
  } finally {
    TEX.width = original;
  }
}

{
  // A same-scene redraw and an update of the scene each ask it for its hex again.
  clones.broken = true;
  try {
    const scene = makeScene();
    setup({ family: "hexRows", scene, samples: { squares: rowBoxes() }, opts: { mapCellFeet: 3 }, units: "ft" });
    assert.ok((await ctx()).needLines.map(keyOf).includes("needs.hexProbe"));
    clones.broken = false;
    session.onCanvasReady();
    assert.ok(!(await ctx()).needLines.map(keyOf).includes("needs.hexProbe"), "the redraw invalidates the cached probe");
    clones.broken = true;
    session.setSetup({ gridFamily: "hexCols" });
    session.setSetup({ gridFamily: "hexRows" });
    assert.ok((await ctx()).needLines.map(keyOf).includes("needs.hexProbe"));
    clones.broken = false;
    assert.equal(session.onSceneUpdated(scene), true);
    assert.ok(!(await ctx()).needLines.map(keyOf).includes("needs.hexProbe"), "a scene update invalidates the cached probe");
  } finally {
    clones.broken = false;
  }
}

{
  // A hex solve takes the probe it is handed, and refuses one that is null.
  const scene = makeScene();
  setup({ family: "hexRows", scene, samples: { squares: rowBoxes() }, opts: { mapCellFeet: 3 }, units: "ft" });
  const out = solveHexCalibration(scene, session.fit, { gridSize: 100, outputFeet: 3, family: "hexRows", probe: null });
  assert.deepEqual(out, { ok: false, reason: "badSolution" });
}

{
  // The even-offset variant is asked of the scene as its own lattice: boxes drawn on it fit it.
  const boxes = [hexBox("hexRows", 0, 0, { even: true }), hexBox("hexRows", 0, 1, { even: true }), hexBox("hexRows", 1, 1, { even: true }), hexBox("hexRows", 1, 2, { even: true })];
  const scene = makeScene();
  setup({ family: "hexRows", scene, samples: { squares: boxes }, opts: { mapCellFeet: 3 }, units: "ft", hexEven: true });
  const fit = session.fit;
  assert.equal(fit.ok, true);
  assert.equal(fit.confidence, "tight", "the boxes sit on the even lattice");
  assert.deepEqual((await ctx()).warnLines, []);
  await applyGrid.call(app);
  assert.equal(scene.grid.type, 3, "the even variant of the rows family is the type written");
}

/* -------------------------------------------- */
/*  The hook that feeds it                      */
/* -------------------------------------------- */

{
  // module.mjs cannot be loaded offline; the one line it must hold is pinned as text, after the navigation follow.
  const src = read("scripts/battlemap/module.mjs");
  const hook = src.slice(src.indexOf('Hooks.on("updateScene"'));
  const body = hook.slice(0, hook.indexOf("});") + 3);
  assert.ok(body.indexOf("sessionFollowsScene(session, scene, changes)") >= 0, "the navigation follow stays");
  assert.ok(body.indexOf("session.onSceneUpdated(scene)") > body.indexOf("sessionFollowsScene"), "and the session is told of the update after it");
}

console.log("battlemap panel: ok");
