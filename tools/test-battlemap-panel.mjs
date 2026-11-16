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
function makeScene({ id = "S1", name = `Scene ${id}`, type = 0, size = 100, distance = 9, units = "ft", flag = {}, rejectType = false, placed = {}, districts = false } = {}) {
  const scene = {
    id,
    name,
    /** Viewing a scene puts it on the canvas, as core's does. */
    async view() {
      scene.viewed++;
      canvas.scene = scene;
    },
    viewed: 0,
    width: 4000,
    height: 3000,
    shiftX: 0,
    shiftY: 0,
    grid: { type, size, distance, units },
    // Embedded collections, as far as the confirmation reads them: a count.
    tokens: { size: placed.tokens ?? 0 },
    tiles: { size: placed.tiles ?? 0 },
    walls: { size: placed.walls ?? 0 },
    background: { src: "map.webp" },
    // A district drawn on the map, as far as `sceneHasDistrict` reads one.
    regions: districts ? [{ behaviors: [{ type: `${MODULE_ID}.district`, disabled: false }] }] : [],
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
        if (k === "background.src") scene.background.src = v;
        else if (k.startsWith("grid.")) scene.grid[k.slice(5)] = v;
        else if (k.startsWith(`flags.${MODULE_ID}.${FLAG}.`)) scene.flags[MODULE_ID][FLAG][k.slice(`flags.${MODULE_ID}.${FLAG}.`.length)] = v;
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
const { solveHexCalibration, writeSetup } = await import(root("scripts/battlemap/apply.mjs").href);

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
const squareBox = (i, j, side = 60) => ({ x: 100 + j * side, y: 80 + i * side, w: side, h: side, across: 1, down: 1 });
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
  // A declared travel system is the select's to write as it changes, never the
  // apply's: Apply neither shows a row for it nor touches it, whatever scale it writes.
  const system = TRAVEL_MODES[0];
  const scene = makeScene({ flag: { mapSystem: system } });
  setup({ family: "hexRows", scene, samples: { squares: rowBoxes() }, opts: { mapCellFeet: 6 }, units: "mi", mapSystem: system });
  const c = await ctx();
  assert.ok(!c.footRows.some((r) => r.id === "travelSystem"), "a declared system shows no row, though the scale written is a mile");
  await applyGrid.call(app);
  assert.equal(flagOf(scene).mapSystem, system, "the declared system is left as it was");
  assert.equal(flagOf(scene).calibrated, true);
  assert.ok(scene.writes.every((w) => !Object.keys(w).some((k) => k.endsWith("mapSystem"))), "and no write names it");
}

{
  // Undeclared, a foot-scale scene applied at 6 mi switches its party to a journey: the row says so.
  const scene = makeScene({ units: "ft", distance: 9 });
  setup({ family: "hexRows", scene, samples: { squares: rowBoxes() }, opts: { mapCellFeet: 6 }, units: "mi" });
  const row = (await ctx()).footRows.find((r) => r.id === "travelSystem");
  assert.ok(row, "the row shows");
  assert.ok(row.text.includes("setup.systemNone") && row.text.includes(`system.${TRAVEL_MODES[1]}`), "none now, a journey after");
  assert.ok(row.tip.includes("rows.source.scale"), "sourced to the scale being written");
  await applyGrid.call(app);
  assert.equal(flagOf(scene).mapSystem, undefined, "nothing is declared by the apply: the party's system is called for, not written");

  // With a district drawn, the system called for is a settlement until the scale reaches a mile.
  const city = makeScene({ units: "ft", distance: 9, districts: true });
  setup({ family: "hexRows", scene: city, samples: { squares: rowBoxes() }, opts: { mapCellFeet: 6 }, units: "mi" });
  const toJourney = (await ctx()).footRows.find((r) => r.id === "travelSystem");
  assert.ok(toJourney?.text.includes(`"from":"system.${TRAVEL_MODES[2]}`) && toJourney.text.includes(`"to":"system.${TRAVEL_MODES[1]}`), "a settlement now, a journey after");
  setup({ family: "hexRows", scene: city, samples: { squares: rowBoxes() }, opts: { mapCellFeet: 3 }, units: "ft" });
  assert.ok(!(await ctx()).footRows.some((r) => r.id === "travelSystem"), "a district at a foot scale stays a settlement: no row");

  // Mile to foot scale: nothing is called for after, and a party's mode is left as it is, so no row.
  const down = makeScene({ units: "mi", distance: 6 });
  setup({ family: "hexRows", scene: down, samples: { squares: rowBoxes() }, opts: { mapCellFeet: 3 }, units: "ft" });
  assert.ok(!(await ctx()).footRows.some((r) => r.id === "travelSystem"), "journey to nothing shows no row");
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
  // The placeables note belongs to a write that moves the scene's dimensions
  // under something placed: the scale-only confirmation never carries it, and a
  // hex apply does only where a token, tile or wall is there to be passed under.
  const scene = makeScene({ type: 1, placed: { tokens: 2 } });
  setup({ family: "scale", scene, samples: { squares: [squareBox(0, 0, 180)] }, opts: { mapCellFeet: 7 }, units: "ft" });
  assert.equal((await ctx()).canApply, true);
  await applyGrid.call(app);
  assert.equal(confirms.length, 1);
  assert.ok(!confirms[0].includes("confirmShift"), "scale-only moves no placeable");
  for (const [placed, shows] of [[{ tokens: 1 }, true], [{ tiles: 1 }, true], [{ walls: 3 }, true], [{}, false]]) {
    const hexScene = makeScene({ placed });
    setup({ family: "hexRows", scene: hexScene, samples: { squares: rowBoxes() }, opts: { mapCellFeet: 3 }, units: "ft" });
    await ctx();
    await applyGrid.call(app);
    assert.equal(confirms[0].includes("confirmShift"), shows, `placed ${JSON.stringify(placed)}: the note shows only over something placed`);
  }
}

{
  // The confirmation carries the rows the footer showed, as escaped plain lines, under a title that names the act.
  const scene = makeScene({ units: "ft", distance: 9, flag: { autoScale: true }, placed: { tokens: 1 } });
  setup({ family: "hexRows", scene, samples: { squares: rowBoxes() }, opts: { mapCellFeet: 3 }, units: "mi" });
  const c = await ctx();
  assert.deepEqual(c.footRows.map((r) => r.id), ["grid", "cellWorth", "image", "tokenSizing", "travelSystem"], "one row per change Apply writes");
  const titles = [];
  const confirm = foundry.applications.api.DialogV2.confirm;
  foundry.applications.api.DialogV2.confirm = async (opts) => (titles.push(opts.window.title), confirms.push(opts.content), true);
  try {
    await applyGrid.call(app);
  } finally {
    foundry.applications.api.DialogV2.confirm = confirm;
  }
  assert.equal(keyOf(titles[0]), "apply.ask", "the title is the act's question");
  assert.ok(titles[0].includes("apply.hex"), "and names the hex act");
  const body = confirms[0];
  assert.equal((body.match(/<li>/g) ?? []).length, c.footRows.length, "a list item per row");
  for (const r of c.footRows) {
    assert.ok(body.includes(`rows.line{&quot;label&quot;:${JSON.stringify(r.label).replace(/"/g, "&quot;")}`), `the ${r.id} row is in the confirmation as the panel worded it`);
  }
  assert.ok(body.includes("confirmShift"), "a scene with a token carries the placeables note");

  // A line is text: markup in it is shown, never parsed.
  const other = makeScene();
  setup({ family: "hexRows", scene: other, samples: { squares: rowBoxes() }, opts: { mapCellFeet: 3 }, units: "ft" });
  const solved = solveHexCalibration(other, session.fit, { gridSize: 100, outputFeet: 3, family: "hexRows", probe: session.hexProbe });
  await writeSetup(other, solved, { family: "hexRows", autoScale: true, lines: ["<b>x</b> & y"] });
  assert.ok(confirms.at(-1).includes("&lt;b&gt;x&lt;/b&gt; &amp; y"), "a row's text is escaped");
  assert.ok(!confirms.at(-1).includes("<b>"));
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
  // It states what the scene holds, read off the scene itself rather than off the choices.
  const said = JSON.parse(c.matchesLine.slice(c.matchesLine.indexOf("{")));
  assert.equal(said.grid, "rows.type.2{}", "the grid kind the scene has");
  assert.equal(said.size, scene.grid.size, "its grid size in px");
  assert.equal(said.distance, 3, "what a cell is worth");
  assert.equal(said.units, "ft", "in the scene's unit");
  scene.grid.size = 77;
  assert.equal((await ctx()).matchesLine, null, "read at render: a scene that moved no longer matches");
}

{
  // A scene a previous apply made hex, set up as square: the line names the way out, in core's own labels.
  const scene = makeScene({ type: 2 });
  setup({ family: "square", scene, samples: { squares: [squareBox(0, 0, 180)] }, opts: { mapCellFeet: 5 }, units: "ft" });
  const c = await ctx();
  assert.ok(c.needLines.map(keyOf).includes("warn.notSquareGrid"));
  const text = JSON.parse(read("lang/en.json"))[`${LANG_PREFIX}.warn.notSquareGrid`];
  for (const word of ["Scene configuration", "Grid tab", "Grid type", "Gridless"]) assert.ok(text.includes(word), `the line names ${word}`);
  assert.ok(text.includes("{family}"), "and still offers the hex families");
}

{
  // One box around several hexes: its only signal is its shape, so the line names both causes and the check.
  const block = (family, cells) => {
    const boxes = cells.map(([i, j]) => hexBox(family, i, j));
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
  };
  const cells = [[0, 0], [0, 1], [1, 0], [1, 1]];
  for (const family of ["hexRows", "hexCols"]) {
    setup({ family, scene: makeScene(), samples: { squares: [block(family, cells)] }, opts: { mapCellFeet: 3 }, units: "ft" });
    const lone = (await ctx()).warnLines.map(keyOf);
    assert.ok(lone.includes("warn.familyMismatchLone"), `${family}: a lone block gets its own line, got ${lone}`);
    assert.ok(!lone.includes("warn.familyMismatch"));
    assert.equal((await ctx()).canApply, true, "and stays a warning");
    // The Judge follows the line and draws a one-hex box: whichever order the two were drawn in,
    // the panel never sends them back to the family for a block it can see is the cause.
    const honest = hexBox(family, 8, 8);
    setup({ family, scene: makeScene(), samples: { squares: [block(family, cells), honest] }, opts: { mapCellFeet: 3 }, units: "ft" });
    let after = await ctx();
    assert.deepEqual(after.warnLines.map(keyOf).filter((k) => k.startsWith("warn.familyMismatch")), [], `${family}: block first, then a one-hex box`);
    assert.ok(after.unusedLines.map(keyOf).includes("unused.multiHexBoxes"), "the box that was left out is named");
    assert.equal(after.canApply, true);
    setup({ family, scene: makeScene(), samples: { squares: [honest, block(family, cells)] }, opts: { mapCellFeet: 3 }, units: "ft" });
    after = await ctx();
    assert.deepEqual(after.warnLines.map(keyOf).filter((k) => k.startsWith("warn.familyMismatch")), [], `${family}: the one-hex box first leaves the block out and warns of nothing`);
    assert.ok(after.unusedLines.map(keyOf).includes("unused.multiHexBoxes"));

    const second = cells.map(([i, j]) => [i + 8, j + 8]);
    setup({ family, scene: makeScene(), samples: { squares: [block(family, cells), block(family, second)] }, opts: { mapCellFeet: 3 }, units: "ft" });
    const two = (await ctx()).warnLines.map(keyOf);
    assert.ok(two.includes("warn.familyMismatch") && !two.includes("warn.familyMismatchLone"), `${family}: with two used boxes the plain mismatch line stands, got ${two}`);
  }
  const lang = JSON.parse(read("lang/en.json"));
  const lone = lang[`${LANG_PREFIX}.warn.familyMismatchLone`];
  assert.ok(lone.includes("several hexes") && lone.includes("second box") && lone.includes("{tool}") && lone.includes("{family}"), "the lone line names both causes, the one check and where it is");
  const split = lang[`${LANG_PREFIX}.warn.familyMismatchLoneSplit`];
  assert.ok(split.includes("delete the larger") && split.includes("{family}"), "the pair's line says which box to delete");
  const ambiguous = lang[`${LANG_PREFIX}.warn.familyAmbiguous`];
  assert.ok(ambiguous.includes("three boxes") && ambiguous.includes("across and down") && !ambiguous.includes("second box") && ambiguous.includes("stays as you chose"), "an ambiguity asks for the boxes that can tell the two apart, and is no error");
  // The window has one name, and the notice and the tooltip use the rows' words.
  const name = (key) => lang[`${LANG_PREFIX}.${key}`];
  assert.equal(name("title"), "Map setup");
  assert.equal(name("titleScene"), "Map setup: {scene}");
  assert.equal(name("controls.assistant"), "Map setup");
  assert.equal(name("sceneConfig.open"), "Map setup…");
  assert.ok(name("sceneConfig.hint").includes("map setup") && !/alignment assistant/i.test(name("sceneConfig.hint")));
  assert.ok(name("setup.title") !== name("title"), "the first heading names what it heads, not the window");
  assert.ok(!(`${LANG_PREFIX}.tool` in lang) && !(`${LANG_PREFIX}.rows.source.system` in lang), "keys nothing reads are gone");
  assert.ok(name("apply.doneHex").includes("grid size {size} px") && name("rows.gridFigure").includes("grid size {size} px"), "the done notice says grid size, as the rows do");
  assert.ok(/^As the scene has it: \{from\}\. After Apply: \{to\}\./.test(name("rows.tip")), "a figure follows a colon, so a capitalised label fits mid-tooltip");
}

{
  // The cell's worth is the scene's own only in the scene's own unit; in another it is blank and the needs list asks.
  const scene = makeScene({ distance: 9, units: "ft" });
  setup({ family: "hexRows", scene, samples: { squares: rowBoxes() }, units: "ft" });
  let c = await ctx();
  assert.equal(c.mapCellFeet, 9, "the scene's own value in the scene's own unit");
  assert.ok(!c.needLines.map(keyOf).includes("needs.cellWorth"));
  setup({ family: "hexRows", scene, samples: { squares: rowBoxes() }, units: "mi" });
  c = await ctx();
  assert.ok(!(c.mapCellFeet > 0), "blank in another unit");
  assert.ok(c.needLines.map(keyOf).includes("needs.cellWorth"), "and asked for");
  assert.equal(scene.writes.length, 0, "a unit is written by Apply alone");
}

{
  // A mile-scale apply over a scene that sizes tokens says it writes that off, and why.
  const scene = makeScene({ units: "ft", distance: 9, flag: { autoScale: true } });
  setup({ family: "hexRows", scene, samples: { squares: rowBoxes() }, opts: { mapCellFeet: 3 }, units: "mi" });
  const row = (await ctx()).footRows.find((r) => r.id === "tokenSizing");
  assert.equal(keyOf(row.text), "rows.tokenSizingExpedition");
  assert.ok(row.tip.includes("rows.tip"), "with a tooltip of its two ends and its source");
  const flat = makeScene({ units: "ft", distance: 9, flag: { autoScale: false } });
  setup({ family: "hexRows", scene: flat, samples: { squares: rowBoxes() }, opts: { mapCellFeet: 3 }, units: "ft" });
  assert.equal(keyOf((await ctx()).footRows.find((r) => r.id === "tokenSizing").text), "rows.change", "a foot-scale apply turns sizing on and writes nothing off");
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
    const html = render(await ctx());
    return { across: /name="boxCells\.0\.x"/.test(html), down: /name="boxCells\.0\.y"/.test(html), html };
  };
  for (const [family, scene, what] of [
    ["square", makeScene({ type: 1 }), "square"],
    ["scale", makeScene({ type: 0 }), "scale-only: its fit divides by the counts too"],
  ]) {
    const { across, down, html } = await shows(family, scene);
    assert.equal(across, true, `${what} shows the across box`);
    assert.equal(down, true, `${what} shows the down box`);
    assert.match(html, /aria-label="ACKS-BATTLEMAP\.samples\.acrossAria"/, `${what}: the across box names itself`);
    assert.match(html, /aria-label="ACKS-BATTLEMAP\.samples\.downAria"/, `${what}: the down box names itself`);
  }
  for (const family of ["hexRows", "hexCols"]) {
    const { across, down } = await shows(family, makeScene());
    assert.equal(across || down, false, "a hex fit reads each box as one hex");
  }

  // The counts are what the scale-only ratio divides by, and a submit carries
  // each one apart from the other.
  const scene = makeScene({ type: 0 });
  setup({ family: "scale", scene, samples: { squares: [squareBox(0, 0, 180)] }, opts: { mapCellFeet: 7 }, units: "ft" });
  const one = (await ctx()).pxPerUnit;
  await submit.call(app, null, null, { object: { "boxCells.0.x": "3" } });
  assert.equal(session.samples.squares[0].across, 3, "an across count submitted on scale-only lands");
  assert.equal(session.samples.squares[0].down, 1, "and leaves the down count alone");
  const three = (await ctx()).pxPerUnit;
  assert.ok(three !== one, "the across count moves the ratio");
  await submit.call(app, null, null, { object: { "boxCells.0.y": "2" } });
  assert.equal(session.samples.squares[0].across, 3, "a down count leaves the across count alone");
  assert.equal(session.samples.squares[0].down, 2, "a down count submitted lands");
  await submit.call(app, null, null, { object: { "boxCells.0.x": "3", "boxCells.0.y": "3" } });
  const both = (await ctx()).pxPerUnit;
  near(one / both, 3, 0.01, "three cells each way is a third of the pixels per unit");
  // A hex panel renders neither input, so its submit posts no group at all.
  await submit.call(app, null, null, { object: { mapCellFeet: "7" } });
  assert.equal(session.samples.squares[0].across, 3, "a submit without the group leaves the counts");
  assert.equal(session.samples.squares[0].down, 3);
}

/* -------------------------------------------- */
/*  The body's order and the footer's rows      */
/* -------------------------------------------- */

{
  const template = Handlebars.create();
  template.registerHelper("localize", (key) => key);
  template.registerHelper("checked", (value) => (value ? "checked" : ""));
  const body = template.compile(read("templates/battlemap/assistant-body.hbs"));
  const foot = template.compile(read("templates/battlemap/assistant-foot.hbs"));

  const scene = makeScene();
  setup({ family: "hexRows", scene, samples: { squares: rowBoxes(), scale: { x1: 100, y1: 900, x2: 700, y2: 900 } }, opts: { mapCellFeet: 3, scaleValue: 7 }, units: "ft" });
  const html = body(await ctx());
  const at = (needle) => {
    const i = html.indexOf(needle);
    assert.ok(i >= 0, `the body holds ${needle}`);
    return i;
  };

  // The cell's worth and the units are one row; the chips stay under the cell's own column.
  const rowStart = at('class="acks-extras-battlemap-row acks-extras-battlemap-row-top"');
  assert.ok(at('name="units"') > rowStart && at('name="mapCellFeet"') > at('name="units"'), "the units select, then the cell's worth, in one row");
  assert.ok(at('data-action="mapChip"') > at('name="mapCellFeet"'), "the chips follow the cell field");
  assert.ok(at("ACKS-BATTLEMAP.scale.fromBar") > at('name="mapCellFeet"') && at("ACKS-BATTLEMAP.scale.fromBar") < at("ACKS-BATTLEMAP.scale.title"), "the bar's reading sits with the field, above the Scale section");
  assert.ok(at('name="mapCellFeet"') < at("ACKS-BATTLEMAP.scale.title"), "and the field is above the Scale section");

  // What a choice writes at once is one group, below Scale, headed so; the unit is not in it.
  const saved = at("ACKS-BATTLEMAP.setup.saved");
  assert.ok(saved > at("ACKS-BATTLEMAP.scale.title"), "the group is below the Scale section");
  for (const name of ["mapSystem", "country.ground", "country.territory", "country.climate"]) {
    assert.ok(at(`name="${name}"`) > saved, `${name} is in the saved group`);
  }
  assert.ok(html.indexOf('name="units"') < saved, "the unit is written by Apply, so it is outside the group");
  const lang = JSON.parse(read("lang/en.json"));
  const mentions = Object.entries(lang).filter(([k, v]) => k.startsWith(`${LANG_PREFIX}.`) && /saved the moment you choose/i.test(v));
  assert.deepEqual(mentions.map(([k]) => k), [], "the sentence is said once, in the group's own hint");
  assert.ok(/moment you choose/i.test(lang[`${LANG_PREFIX}.setup.savedHint`]));

  // A statement of the scene's setup leads the needs area and is no warning.
  const matched = makeScene();
  setup({ family: "hexRows", scene: matched, samples: { squares: rowBoxes() }, opts: { mapCellFeet: 3 }, units: "ft" });
  await ctx();
  await applyGrid.call(app);
  const lines = { ...(await ctx()), needLines: ["NEED"], warnLines: ["WARN"] };
  const page = body(lines);
  assert.ok(page.indexOf("apply.matches") >= 0 && page.indexOf("apply.matches") < page.indexOf("NEED"), "the scene's own setup is said first");
  assert.ok(!/battlemap-warn">[^<]*<i[^>]*><\/i>\s*apply\.matches/.test(page), "as a statement, not a warning");

  // The footer: rows with a tooltip each, buttons that say what they write, no `title`.
  setup({ family: "hexRows", scene: makeScene({ placed: { tokens: 1 } }), samples: { squares: rowBoxes() }, opts: { mapCellFeet: 3 }, units: "mi" });
  const solvable = await ctx();
  const footer = foot(solvable);
  assert.equal((footer.match(/<li>/g) ?? []).length, solvable.footRows.length);
  assert.equal((footer.match(/data-tooltip-text="rows\.tip/g) ?? []).length, solvable.footRows.length, "every row's figure carries its tooltip");
  assert.ok(footer.includes("rows.imageStays"), "the image row says, on screen, that placed things stay put");
  assert.ok(/data-action="applyGrid"[^>]*aria-label="apply\.aria[^"]*"[^>]*data-tooltip-text="apply\.tip/.test(footer), "Apply is named and says what it writes");
  assert.ok(!footer.includes('data-action="rescaleTokens"'), "the whole-scene resize is in the Token sizes section, not the footer");
  assert.ok(/data-action="rescaleTokens"[^>]*aria-label="apply\.aria[^"]*"[^>]*data-tooltip-text="apply\.tokensTip/.test(html), "where it is named and says what it resizes");
  assert.ok(!/\stitle=/.test(footer) && !/\stitle=/.test(html), "no title attribute: tooltips go through core's manager");
  setup({ family: "scale", scene: makeScene(), units: "ft" });
  assert.ok((await ctx()).applyTip.startsWith("apply.tipScale"), "scale-only does not claim the image is written");

  // Nothing solvable yet: no rows block at all.
  setup({ family: "hexRows", scene: makeScene(), units: "ft" });
  const empty = await ctx();
  assert.deepEqual(empty.footRows, []);
  assert.ok(!foot(empty).includes("acks-extras-battlemap-rows"), "nothing extra shows");
}

/* -------------------------------------------- */
/*  The card's figures say where they came from */
/* -------------------------------------------- */

{
  const template = Handlebars.create();
  template.registerHelper("localize", (key) => key);
  template.registerHelper("checked", (value) => (value ? "checked" : ""));
  const body = template.compile(read("templates/battlemap/assistant-body.hbs"));
  /** The first figure object of a line that carries several. */
  const first = (line) => JSON.parse(String(line).slice(String(line).indexOf("{"), String(line).indexOf("}") + 1));
  const figures = (line) => JSON.parse(String(line).slice(String(line).indexOf("{")));
  const carries = (html, key) => new RegExp(`data-tooltip-text="${key.replace(/\./g, "\\.")}`).test(html);
  const lang = JSON.parse(read("lang/en.json"));

  // A hex fit over three boxes and a scale bar: every figure on the card has a tooltip of its parts.
  const boxes = rowBoxes();
  setup({ family: "hexRows", scene: makeScene(), samples: { squares: boxes, scale: { x1: 100, y1: 900, x2: 700, y2: 900 } }, opts: { mapCellFeet: 3, scaleValue: 7 }, units: "ft" });
  const c = await ctx();
  const html = body(c);
  assert.ok(/acks-extras-battlemap-cell"[^>]*data-tooltip-text="fit\.cellTipHex/.test(html), "the cell figure carries its tooltip");
  const cell = first(c.cellTip);
  assert.deepEqual([cell.used, cell.boxes], [3, 3], "the cell is the fit over the boxes it used, of the boxes drawn");
  assert.ok(c.cellLabel.includes(cell.w), "in the same one-decimal image px the card shows");
  assert.ok(c.cellTip.includes("fit.residualPart"), "with the residual left over");
  assert.ok(carries(html, "fit.pxOffTip") && c.residualTip.startsWith("fit.pxOffTip"), "the residual's tooltip");
  assert.ok(carries(html, "samples.tipCounts") && keyOf(c.sampleTip) === "samples.tipCounts", "the box count carries its tooltip");
  assert.deepEqual(first(c.sampleTip), { boxes: 3, corners: 0, bars: 1 }, "which counts what was drawn");
  assert.ok(c.sampleTip.includes("samples.tipUsedHex"), "and says how many boxes the fit used");
  assert.ok(carries(html, "scale.perUnitTipBar") && first(c.perUnitTip).value === 7, "a bar's px per unit names the bar's length and what it reads");
  assert.ok(carries(html, "scale.fromBarTipHex"), "so does the bar's reading of one cell");
  assert.deepEqual([first(c.fromBarTip).value, first(c.fromBarTip).worth], [7, c.barFeet], "the value it read and the cell it came to");

  // Each box row: its px with one rounding, and what the fit did with it.
  assert.equal(c.boxRows.length, 3);
  c.boxRows.forEach((r, i) => {
    const said = figures(r.label);
    assert.equal(said.w, boxes[i].w.toFixed(1), "a box row rounds to the one decimal the card shows");
    assert.equal(said.h, boxes[i].h.toFixed(1));
    assert.ok(/^\d+\.\d$/.test(said.w), "one decimal, always");
    assert.ok(keyOf(r.tip) === "samples.boxTipHex" && r.tip.includes("samples.boxUsed"), "the row's tooltip says it was read as one hex and used");
  });
  assert.equal((html.match(/data-tooltip-text="samples\.boxTipHex/g) ?? []).length, 3, "every row carries it");

  // A box the fit left out says why, from the fit's own flags.
  const unreachable = { ...c, boxRows: [{ ...c.boxRows[0], tip: "x" }] };
  assert.ok(body(unreachable).includes('data-tooltip-text="x"'), "the row's text is what the template shows");
  const wide = [...boxes, { ...boxes[0], w: boxes[0].w * 3, h: boxes[0].h * 3 }];
  setup({ family: "hexRows", scene: makeScene(), samples: { squares: wide }, opts: { mapCellFeet: 3 }, units: "ft" });
  const out = await ctx();
  assert.ok(out.boxRows.some((r) => r.tip.includes("samples.boxWide") || r.tip.includes("samples.boxOutOfReach")), "a box left out of the hex fit names its reason");
  assert.ok(out.boxRows.some((r) => r.tip.includes("samples.boxUsed")), "and a box used says so");

  // A square family: boxes divided by their counts, the residual a share of a cell, no hex wording.
  const cellScene = makeScene({ type: 1 });
  setup({ family: "square", scene: cellScene, samples: { squares: [squareBox(0, 0, 60), { ...squareBox(0, 2, 120), h: 60, across: 2 }] }, opts: { mapCellFeet: 5 }, units: "ft" });
  const sq = await ctx();
  assert.equal(keyOf(sq.cellTip), "fit.cellTipCell");
  assert.deepEqual([first(sq.cellTip).boxes, first(sq.cellTip).corners], [2, 0]);
  assert.ok(body(sq).includes('data-tooltip-text="fit.rmsTip'), "a square fit's residual has its own tooltip");
  assert.ok(sq.residualTip.startsWith("fit.rmsTip"));
  const second = first(sq.boxRows[1].tip);
  assert.deepEqual([second.w, second.h, second.across, second.down, second.cw, second.ch], ["120.0", "60.0", 2, 1, "60.0", "60.0"], "a box's tooltip: its px, its counts and the cell they make");
  assert.ok(sq.boxRows[1].tip.includes("samples.boxUsed"));

  // After a bake the samples are gone and the fit is the corrected image's own.
  session.samples = { squares: [], corners: [], scale: null };
  session.bakedFit = { ok: true, mode: "square", sizeX: 80, sizeY: 80, rmsPct: 0, rmsPx: 0, confidence: "tight", skewDeg: 0, rotationDeg: 0 };
  session.notify?.();
  const baked = await ctx();
  assert.equal(keyOf(baked.cellTip), "fit.cellTipBaked", "no boxes drawn: it does not claim a fit over any");

  // The skew and rotation, and the Bake button, as the template draws them.
  const shown = body({ ...c, fitAffine: { skew: "0.50", rotation: "0.10" }, canBake: true });
  assert.ok(carries(shown, "fit.affineTip") && c.affineTip.startsWith("fit.affineTip"), "skew and rotation carry a tooltip");
  assert.ok(/data-action="bake"[^>]*aria-label="apply\.aria[^"]*"[^>]*data-tooltip-text="apply\.bakeTip/.test(shown), "Bake is named and says what it writes");
  assert.ok(c.bakeAria.startsWith("apply.aria") && c.bakeTip.startsWith("apply.bakeTip"));

  for (const key of ["fit.cellTipHex", "fit.cellTipCell", "fit.cellTipBaked", "fit.residualPart", "fit.rmsTip", "fit.affineTip", "samples.tipCounts", "samples.tipUsedHex", "samples.tipUsedAll", "samples.tipLeftHex", "samples.boxTipHex", "samples.boxTipCell", "samples.boxUsed", "samples.boxOutOfReach", "samples.boxWide", "scale.perUnitTipBar", "scale.perUnitTipFit", "scale.fromBarTipHex", "scale.fromBarTipCell", "apply.bakeTip", "setup.applied", "setup.appliedTip", "tokens.sizes", "tokens.sizesCite", "tokens.sizeChipTip", "tokens.sizeFeet", "tokens.sizeNamed"]) {
    assert.ok(typeof lang[`${LANG_PREFIX}.${key}`] === "string", `${key} is shipped`);
  }
}

/* -------------------------------------------- */
/*  A reopened scene says what it already is    */
/* -------------------------------------------- */

{
  const template = Handlebars.create();
  template.registerHelper("localize", (key) => key);
  template.registerHelper("checked", (value) => (value ? "checked" : ""));
  const body = template.compile(read("templates/battlemap/assistant-body.hbs"));

  // An applied hex scene, opened with nothing drawn: the line reads the scene's own figures, above the needs.
  const applied = makeScene({ type: 2, size: 88, distance: 9, units: "ft", flag: { calibrated: true, distance: 9 } });
  setup({ family: "hexRows", scene: applied, units: "ft" });
  const c = await ctx();
  assert.equal(keyOf(c.appliedLine), "setup.applied");
  assert.deepEqual(JSON.parse(c.appliedLine.slice(c.appliedLine.indexOf("{"))), { grid: "rows.type.2{}", size: 88, distance: 9, units: "ft" }, "the grid, its px and the cell's worth, from the scene");
  assert.ok(c.appliedTip.startsWith("setup.appliedTip"), "its tooltip names where it is read from");
  assert.ok(JSON.parse(read("lang/en.json"))[`${LANG_PREFIX}.setup.appliedTip`].includes("Scene configuration → Grid"), "Scene configuration → Grid");
  const html = body(c);
  assert.ok(html.includes("setup.applied") && html.indexOf("setup.applied{") < html.indexOf("needs.hexBox"), "the line sits above the needs list");
  assert.ok(/data-tooltip-text="setup\.appliedTip/.test(html));

  // It goes once a sample is drawn, and a scene the module never applied has none.
  setup({ family: "hexRows", scene: applied, samples: { squares: rowBoxes() }, units: "ft" });
  assert.equal((await ctx()).appliedLine, null, "samples exist: the fit and the matches row speak");
  setup({ family: "hexRows", scene: makeScene(), units: "ft" });
  const fresh = await ctx();
  assert.equal(fresh.appliedLine, null, "a fresh gridless scene reads as a fresh map");
  assert.ok(!body(fresh).includes("setup.applied"));
  setup({ family: "hexRows", scene: makeScene({ type: 2, size: 88 }), units: "ft" });
  assert.equal((await ctx()).appliedLine, null, "a grid the module did not apply is not 'already set up'");
}

/* -------------------------------------------- */
/*  The Token sizes section                     */
/* -------------------------------------------- */

{
  const template = Handlebars.create();
  template.registerHelper("localize", (key) => key);
  template.registerHelper("checked", (value) => (value ? "checked" : ""));
  const body = template.compile(read("templates/battlemap/assistant-body.hbs"));
  /** The section as drawn: everything after its heading. */
  const sectionOf = async (scene) => {
    setup({ family: "hexRows", scene, units: "ft" });
    const c = await ctx();
    const html = body(c);
    return { c, section: html.slice(html.indexOf("ACKS-BATTLEMAP.tokens.title")) };
  };
  const figures = (line) => JSON.parse(String(line).slice(String(line).indexOf("{")));
  const CONTROLS = [/data-action="sizeChip"/, /data-action="resetFootprints"/, /data-action="applyCustomSize"/, /data-action="rescaleTokens"/, /name="customFeet"/];

  // A cell of a mile or more: one line, and none of the controls.
  for (const [units, distance] of [["mi", 1], ["mi", 6], ["yd", 1760], ["km", 2]]) {
    const { c, section } = await sectionOf(makeScene({ units, distance }));
    assert.equal(c.tokensUnsized, true, `${distance} ${units} a cell is an expedition scale`);
    assert.ok(section.includes("tokens.unsized"), "the line says tokens here are not sized to footprints");
    for (const control of CONTROLS) assert.ok(!control.test(section), `${distance} ${units}: no ${control} below the line`);
    assert.ok(!/<button|<input/.test(section), "nothing to press or type in");
    assert.ok(!section.includes("tokens.auto") && !section.includes("tokens.intro"), "and nothing else is said");
  }

  // Below it: what the chips do, the size categories, the resize, the auto-size line.
  const { PRIORITY, registerTable, resetTables } = await import(root("scripts/lib/tables.mjs").href);
  const { SIZE_DOC, SIZE_TABLE, SIZE_ROW, SQUARE_TABLE } = await import(root("scripts/monsters/sizes.mjs").href);
  const { tokenSpan } = await import(root("scripts/battlemap/footprint.mjs").href);
  /** An import in invented figures: a 7 ft square; small is one square, large 3 × 2, gigantic has no frontage; the rest are absent. */
  const importSizes = ({ priority = PRIORITY.WORLD, pages = "XX 1" } = {}) => {
    resetTables();
    registerTable(
      {
        id: SIZE_DOC,
        ...(pages ? { source: { pages } } : {}),
        tables: { [SIZE_TABLE]: { [SIZE_ROW]: { small: "1 sq", large: "3 × 2", gigantic: "n/a" } }, [SQUARE_TABLE]: { [SIZE_ROW]: { feet: 7 } } },
      },
      { priority },
    );
  };
  const scene = makeScene({ units: "yd", distance: 3, flag: { autoScale: false } });
  resetTables();
  const { c, section } = await sectionOf(scene);
  assert.equal(c.tokensUnsized, false);
  assert.ok(section.includes("tokens.intro"), "the section says what the chips do");
  // Nothing imported: no chip at all (the old ladder drew six steps of the cell here), and the caption stays with the page reference alone.
  assert.deepEqual(c.sizeChips, [], "no import, no size chips");
  assert.ok(!section.includes('data-action="sizeChip"'), "and none in the markup");
  assert.ok(section.includes("tokens.sizes"), "the caption stays");
  assert.ok(c.sizesTip.startsWith("tokens.sizesCite") && !/\d/.test(c.sizesTip), "its tooltip is the shipped page reference, no number and no words about a gap");
  assert.ok(/data-tooltip-text="tokens\.sizesCite/.test(section), "carried on the caption");
  assert.ok(!read("scripts/battlemap/assistant-app.mjs").includes("HOTBAR_STEPS"), "the cell-multiple ladder is gone");
  assert.ok(/data-action="resetFootprints"[^>]*aria-label="apply\.aria[^"]*tokens\.resetLabel/.test(section), "the reset glyph has a name");
  assert.ok(/data-action="applyCustomSize"[^>]*aria-label="apply\.aria[^"]*tokens\.customLabel/.test(section), "so has the custom size's");
  assert.ok(!/data-action="applyCustomSize"[^>]*disabled/.test(section), "the custom size is never disabled by a stale value");
  assert.ok(/data-action="rescaleTokens"[^>]*aria-label="apply\.aria[^"]*"[^>]*data-tooltip-text="apply\.tokensTip/.test(section), "the whole-scene resize sits in the section with its tooltip");
  assert.ok(!/\stitle=/.test(section), "no title attribute");
  assert.ok(c.tokensAutoLine.startsWith("tokens.autoOff"), "a scene that is not auto-sized says so");
  assert.ok(section.includes("tokens.autoOff"));
  assert.equal(keyOf(figures(c.tokensAutoLine).path), "tokens.autoPath", "and where it is changed");
  assert.ok(JSON.parse(read("lang/en.json"))[`${LANG_PREFIX}.tokens.autoPath`].includes("Scene configuration → Basics tab → Battlemap → Auto-size tokens"));
  scene.flags[MODULE_ID][FLAG] = { autoScale: true };
  assert.ok((await sectionOf(scene)).c.tokensAutoLine.startsWith("tokens.autoOn"), "and one that is, says so");

  // Imported: one chip per category the world holds a frontage for, on a 100 ft cell.
  importSizes();
  const hundred = makeScene({ units: "ft", distance: 100 });
  const got = await sectionOf(hundred);
  assert.deepEqual(got.c.sizeChips.map((chip) => chip.key), ["small", "large"], "a category with no frontage, or none imported, has no chip");
  const large = got.c.sizeChips.find((chip) => chip.key === "large");
  assert.deepEqual([large.w, large.h], [21, 14], "the large chip is its frontage times the square, in feet");
  assert.equal(large.label, "Large", "labelled by the category's name");
  const tip = figures(large.tip);
  assert.ok(tip.source.includes('"size":"Large","w":"3","h":"2","feet":"7"'), "the tooltip carries the mark's own source line: the frontage and the square");
  assert.ok(tip.source.includes("XX 1"), "and the page the import was read from");
  assert.deepEqual([tip.fw, tip.fh], [21, 14], "the footprint it stamps");
  assert.deepEqual([tip.w, tip.h], [tokenSpan(21, 100), tokenSpan(14, 100)], "and the size it draws at, in cells, from the sizer's own rounding");
  assert.equal(tip.w, 0.25, "which on a 100 ft cell is the floor");
  assert.ok(large.aria.startsWith("apply.aria"), "named for assistive technology too");
  assert.equal((got.section.match(/data-action="sizeChip"[^>]*aria-label="apply\.aria[^"]*"[^>]*data-tooltip-text="tokens\.sizeChipTip/g) ?? []).length, 2, "every chip carries its aria-label and tooltip");
  assert.ok(got.c.sizesTip.includes("XX 1") || got.c.sizesTip.startsWith("tokens.sizesCite"), "the caption points at the page");

  // A press stamps the chip's own width and height, read off the markup it was drawn from.
  const pressed = [...got.section.matchAll(/data-action="sizeChip" data-key="([^"]*)" data-w="([^"]*)" data-h="([^"]*)"/g)].find((m) => m[1] === "large");
  assert.deepEqual([pressed?.[2], pressed?.[3]], ["21", "14"], "the markup carries the footprint's two sides");
  const written = [];
  setup({ family: "hexRows", scene: hundred, units: "ft" });
  globalThis.canvas.tokens = { controlled: [{ document: { id: "t1", parent: hundred, getFlag: () => undefined, update: async (data) => written.push(data) } }] };
  notes.length = 0;
  await App.DEFAULT_OPTIONS.actions.sizeChip.call(app, null, { dataset: { key: pressed[1], w: pressed[2], h: pressed[3] } });
  delete globalThis.canvas.tokens;
  assert.deepEqual(written[0][`flags.${MODULE_ID}.footprint`], { w: 21, h: 14 }, "a press stamps the footprint, both sides");
  assert.equal(written[0].width, tokenSpan(21, 100), "and sizes the token by the sizer");
  const said = figures(notes.at(-1)[1]);
  assert.deepEqual([notes.at(-1)[0], keyOf(notes.at(-1)[1])], ["info", "tokens.applied"]);
  assert.ok(said.size.includes("Large") && said.size.includes('"w":21,"h":14'), "the notice names the category and its sides");

  // A value the override layer holds reads with no page, and nothing throws.
  importSizes({ priority: PRIORITY.OVERRIDE, pages: null });
  const over = await sectionOf(hundred);
  assert.deepEqual(over.c.sizeChips.map((chip) => chip.key), ["small", "large"], "the override layer's figures draw chips");
  for (const chip of over.c.sizeChips) assert.ok(!figures(chip.tip).source.includes("scaleMark.cite"), "and cite no page");
  assert.ok(over.c.sizesTip.startsWith("tokens.sizesCite"), "the caption falls back to the shipped reference");

  // A mile or more a cell: the line, and no chip, whatever is imported.
  importSizes();
  const mile = await sectionOf(makeScene({ units: "mi", distance: 1 }));
  assert.deepEqual(mile.c.sizeChips, [], "none at a journey's scale");
  assert.ok(!mile.section.includes('data-action="sizeChip"'));
  resetTables();
}

{
  // The controls act on the selection: with none, a notice says so and nothing is written.
  const scene = makeScene({ units: "ft", distance: 5 });
  setup({ family: "hexRows", scene, units: "ft" });
  const written = [];
  const placed = (id) => ({ document: { id, parent: scene, getFlag: () => undefined, update: async (data) => written.push({ id, data }) } });
  const run = async (action, ...args) => {
    notes.length = 0;
    await App.DEFAULT_OPTIONS.actions[action].call(app, null, ...args);
    return notes.map(([level, text]) => [level, keyOf(text)]);
  };
  const chip = { dataset: { key: "large", w: "7.5", h: "5" } };
  const none = [["warn", "tokens.noneSelected"]];

  globalThis.canvas.tokens = { controlled: [] };
  assert.deepEqual(await run("sizeChip", chip), none, "a chip with nothing selected says so, not '0 token(s)'");
  assert.deepEqual(await run("resetFootprints"), none, "so does the reset");
  assert.deepEqual(await run("applyCustomSize"), [["warn", "tokens.customNeeded"]], "a custom size with no value asks for one");
  app.element = { querySelector: () => ({ value: "12" }) };
  assert.deepEqual(await run("applyCustomSize"), none, "and with a value but no selection, says nothing is selected");
  assert.equal(written.length, 0, "nothing is written");

  // The field's own change takes the slot and re-renders nothing: a render would
  // replace the ✓ between the pointer going down on it and coming up.
  const before = app.renders;
  await submit.call(app, { target: { name: "customFeet" } }, null, { object: { customFeet: "12" } });
  assert.equal(session.opts.customFeet, 12, "the change lands in the session");
  assert.equal(app.renders, before, "and the panel is not re-rendered under the pointer");
  await submit.call(app, { target: { name: "mapCellFeet" } }, null, { object: { customFeet: "7", mapCellFeet: "3" } });
  assert.ok(app.renders > before, "any other field's change still renders");

  // The field is read at the press: the session never saw this value, and the stale slot is not the answer.
  session.opts.customFeet = null;
  globalThis.canvas.tokens = { controlled: [placed("t1")] };
  const result = await run("applyCustomSize");
  assert.deepEqual(result, [["info", "tokens.applied"]], "a value typed and clicked at once is applied");
  assert.equal(written[0].data[`flags.${MODULE_ID}.footprint`].w, 12, "the typed figure is the footprint");
  assert.equal(session.opts.customFeet, 12, "and the session holds it");
  app.element = { querySelector: () => ({ value: "" }) };
  session.opts.customFeet = 9;
  written.length = 0;
  assert.deepEqual(await run("applyCustomSize"), [["warn", "tokens.customNeeded"]], "an emptied field is not rescued by an older value");
  assert.equal(written.length, 0);
  app.element = undefined;
  delete globalThis.canvas.tokens;
}

{
  // The rescale notice is a warning when it left a token alone, and names which
  // import that token is waiting on; with nothing kept it is the plain count.
  const { PRIORITY, registerTable, resetTables } = await import(root("scripts/lib/tables.mjs").href);
  const { SIZE_DOC, SIZE_TABLE, SIZE_ROW, SQUARE_TABLE } = await import(root("scripts/monsters/sizes.mjs").href);
  const importSizes = ({ frontage = null, square = null } = {}) => {
    resetTables();
    const tables = {};
    if (frontage) tables[SIZE_TABLE] = { [SIZE_ROW]: frontage };
    if (square) tables[SQUARE_TABLE] = { [SIZE_ROW]: { feet: square } };
    if (Object.keys(tables).length) registerTable({ id: SIZE_DOC, tables }, { priority: PRIORITY.WORLD });
  };
  const scene = makeScene({ units: "ft", distance: 5 });
  setup({ family: "hexRows", scene, units: "ft" });
  const tokenOf = (id, sizeKey = null) => {
    const extras = sizeKey ? { size: sizeKey } : undefined;
    return { id, width: 1, height: 1, getFlag: (_ns, key) => (key === "extras" ? extras : undefined), actor: { documentName: "Actor", type: "monster", getFlag: (_ns, key) => (key === "extras" ? extras : undefined) } };
  };
  scene.updateEmbeddedDocuments = async () => {};
  const rescale = App.DEFAULT_OPTIONS.actions.rescaleTokens;
  const lastNote = () => {
    const [level, text] = notes.at(-1);
    return { level, key: keyOf(text), data: text.includes("{") ? JSON.parse(text.slice(text.indexOf("{"))) : null };
  };

  resetTables();
  scene.tokens = [];
  await rescale.call(app);
  assert.deepEqual([lastNote().level, lastNote().key], ["info", "tokens.rescaled"], "nothing left alone: the plain count");

  // Nothing imported: every token that is ours is kept, and the warning names both.
  scene.tokens = [tokenOf("t1", "large"), tokenOf("t2")];
  await rescale.call(app);
  let note = lastNote();
  assert.deepEqual([note.level, note.key], ["warn", "tokens.rescaledKept"], "a token with no imported footprint is a warning, not an info");
  assert.equal(note.data.count, 0, "nothing was resized");
  assert.equal(note.data.kept, 2, "both tokens kept their size");
  assert.equal(keyOf(note.data.missing), "tokens.missingBoth", "neither the square nor the frontage is imported, and the warning says both");

  // The square alone: a token with no category is sized, a categorised one is kept for want of a frontage.
  importSizes({ square: 4 });
  await rescale.call(app);
  note = lastNote();
  assert.deepEqual([note.level, note.key], ["warn", "tokens.rescaledKept"]);
  assert.equal(note.data.count, 1, "the token with no category took the square's size");
  assert.equal(note.data.kept, 1);
  assert.equal(keyOf(note.data.missing), "tokens.missingFrontage", "the square is imported, so the frontage is what is named");

  // The frontage alone: no token has a footprint without the square.
  importSizes({ frontage: { large: "2 x 2" } });
  await rescale.call(app);
  note = lastNote();
  assert.equal(note.level, "warn");
  assert.equal(note.data.kept, 2);
  assert.equal(keyOf(note.data.missing), "tokens.missingSquare", "the frontage is imported, so the square is what is named");

  // Both imported: every token is sized, and the notice is the plain count.
  importSizes({ frontage: { large: "2 x 2" }, square: 4 });
  scene.tokens = [tokenOf("t1", "large"), tokenOf("t2")];
  await rescale.call(app);
  note = lastNote();
  assert.deepEqual([note.level, note.key], ["info", "tokens.rescaled"], "all imported: an info with no kept clause");
  assert.equal(note.data.count, 2);
  resetTables();
}

{
  // Bake. An upright fit whose X and Y differ is offered Bake, and the press
  // reaches the bake: it writes a corrected image and points the scene at it.
  const scene = makeScene({ type: 1 });
  setup({ family: "square", scene });
  session.independentXY = true;
  session.samples = { squares: [{ x: 100, y: 80, w: 60, h: 90, across: 1, down: 1 }, { x: 160, y: 80, w: 60, h: 90, across: 1, down: 1 }, { x: 100, y: 170, w: 60, h: 90, across: 1, down: 1 }], corners: [], scale: null };
  const fit = session.fit;
  assert.ok(fit?.ok, "the boxes fit");
  assert.ok(!fit.u, "an upright fit carries no basis vectors");
  assert.ok(Math.abs(fit.sizeX - fit.sizeY) / Math.max(fit.sizeX, fit.sizeY) > 0.05, "and its axes differ");
  const c = await ctx();
  assert.equal(c.canBake, true, "Bake is offered for an upright fit whose cells are not square");

  // The stand-ins the bake draws through: a renderer, a file upload, the scene write.
  const prior = { PIXI: globalThis.PIXI, user: game.user, app: canvas.app, apps: foundry.applications.apps };
  const matrices = [];
  class Container {
    transform = { setFromMatrix: (m) => matrices.push(m) };
    addChild() {}
    destroy() {}
  }
  globalThis.PIXI = {
    Sprite: class {},
    Texture: class {},
    Container,
    Matrix: class { constructor(...v) { this.v = v; } },
    RenderTexture: { create: () => ({ destroy() {} }) },
  };
  game.user = { isGM: true, can: () => true };
  canvas.app = { renderer: { render() {}, extract: { base64: async () => "data:image/webp;base64,AAAA" } } };
  const uploads = [];
  foundry.applications.apps = { FilePicker: { upload: async (...args) => (uploads.push(args), { path: "uploads/map-aligned.webp" }) } };
  try {
    notes.length = 0;
    session.bakedFit = null;
    await App.DEFAULT_OPTIONS.actions.bake.call(app);
    assert.equal(uploads.length, 1, "the press reached the bake and uploaded the corrected image");
    assert.equal(scene.background.src, "uploads/map-aligned.webp", "the scene is pointed at the corrected image");
    assert.equal(matrices.length, 1);
    const [a, b, cc, d] = matrices[0].v;
    near(a * fit.sizeX, d * fit.sizeY, 1e-6, "each axis is stretched to the same cell edge");
    near(b, 0, 1e-9, "no shear on the first axis");
    near(cc, 0, 1e-9, "no shear on the second");
    assert.equal(notes.at(-1)[0], "info");
    assert.equal(keyOf(notes.at(-1)[1]), "bake.done");
    assert.ok(session.bakedFit?.ok && session.bakedFit.sizeX === session.bakedFit.sizeY, "the retained fit is the square one");

    // A press that cannot proceed says why; it never returns silently.
    notes.length = 0;
    uploads.length = 0;
    game.user = { isGM: true, can: () => false };
    scene.background.src = "map.webp";
    await App.DEFAULT_OPTIONS.actions.bake.call(app);
    assert.deepEqual(notes.map(([level, text]) => [level, keyOf(text)]), [["warn", "warn.noUpload"]], "no upload permission: a warning that says so");
    assert.equal(uploads.length, 0);

    game.user = { isGM: true, can: () => true };
    notes.length = 0;
    scene.background.src = null;
    await App.DEFAULT_OPTIONS.actions.bake.call(app);
    assert.deepEqual(notes.map(([level, text]) => [level, keyOf(text)]), [["warn", "warn.noBackground"]], "no background image: a warning that says so");

    scene.background.src = "map.webp";
    session.bakedFit = { ...session.bakedFit, sizeX: 0, sizeY: 0 };
    session.samples = { squares: [], corners: [], scale: null };
    notes.length = 0;
    await App.DEFAULT_OPTIONS.actions.bake.call(app);
    assert.deepEqual(notes.map(([level, text]) => [level, keyOf(text)]), [["warn", "bake.degenerate"]], "a fit with no cell shape: a warning that says so");

    session.bakedFit = null;
    notes.length = 0;
    await App.DEFAULT_OPTIONS.actions.bake.call(app);
    assert.deepEqual(notes.map(([level, text]) => [level, keyOf(text)]), [["warn", "bake.noFit"]], "no fit at all: a warning that says so");

    canvas.scene = null;
    notes.length = 0;
    await App.DEFAULT_OPTIONS.actions.bake.call(app);
    assert.deepEqual(notes.map(([level, text]) => [level, keyOf(text)]), [["warn", "bake.noScene"]], "no scene: a warning that says so");
  } finally {
    globalThis.PIXI = prior.PIXI;
    game.user = prior.user;
    canvas.app = prior.app;
    foundry.applications.apps = prior.apps;
    session.independentXY = false;
  }
}

{
  // The window names its scene and follows a scene change.
  const first = makeScene({ id: "S1", name: "Alpha" });
  const second = makeScene({ id: "S2", name: "Beta" });
  setup({ family: "square", scene: first });
  assert.equal(keyOf(app.title), "titleScene", "the title carries the scene");
  assert.deepEqual(JSON.parse(app.title.slice(app.title.indexOf("{"))), { scene: "Alpha" }, "and names it");
  const heading = { nodeType: 1, textContent: "" };
  app.window = { title: heading };
  await app._onRender({}, {});
  assert.equal(JSON.parse(heading.textContent.slice(heading.textContent.indexOf("{"))).scene, "Alpha", "the heading shows it");
  canvas.scene = second;
  await app._onRender({}, {});
  assert.equal(JSON.parse(heading.textContent.slice(heading.textContent.indexOf("{"))).scene, "Beta", "a render after a scene change rewrites the heading");
  canvas.scene = null;
  assert.equal(keyOf(app.title), "title", "with no scene it is the plain title");
  app.window = undefined;

  // openAssistant: the viewed scene opens at once; another is viewed first, then opened.
  const { openAssistant } = await import(root("scripts/battlemap/assistant-app.mjs").href);
  canvas.scene = first;
  const order = [];
  const render = App.prototype.render;
  App.prototype.render = function (...args) {
    order.push(`render:${canvas.scene?.id}`);
    return render.apply(this, args);
  };
  try {
    const shown = openAssistant();
    assert.ok(!(shown instanceof Promise) && shown, "no scene: synchronous, the app comes back");
    assert.equal(openAssistant(first), shown, "the viewed scene: synchronous too");
    assert.deepEqual(order, ["render:S1", "render:S1"]);
    assert.equal(first.viewed, 0, "the viewed scene is not viewed again");

    order.length = 0;
    const view = second.view;
    second.view = async () => {
      order.push("view");
      await view();
    };
    const pending = openAssistant(second);
    assert.ok(pending instanceof Promise, "another scene: a Promise of the app");
    assert.deepEqual(order, ["view"], "nothing renders before the scene is viewed");
    assert.equal(await pending, shown);
    assert.deepEqual(order, ["view", "render:S2"], "the scene is viewed first, then the panel opens on it");

    game.user.isGM = false;
    assert.equal(openAssistant(second), null, "a non-GM gets nothing");
  } finally {
    game.user.isGM = true;
    App.prototype.render = render;
  }
  canvas.scene = null;
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
  const stop = session.subscribe(() => seen.push({ worth: session.opts.mapCellFeet, out: session.opts.outputFeet, across: session.samples.squares[0].across, down: session.samples.squares[0].down }));
  await submit.call(app, null, null, { object: { mapCellFeet: "8", outputFeet: "4", "boxCells.0.x": "3", "boxCells.0.y": "2" } });
  stop();
  assert.ok(seen.length >= 1);
  for (const s of seen) {
    assert.equal(s.worth, 8, "no notification fires before the typed worth is stored");
    assert.equal(s.out, 4, "nor before the output");
  }
  assert.equal(seen.at(-1).across, 3, "the last notification carries the new across count");
  assert.equal(seen.at(-1).down, 2, "and the new down count");
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
