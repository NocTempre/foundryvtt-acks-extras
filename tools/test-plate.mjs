/**
 * The plate (`scripts/formation/plate.mjs`): the geometry a drawing of the
 * party's hex is painted from, and the compass that names a hex direction.
 * `plateGeometry` over mocked scenes — a regular hex grid of rows, a square
 * grid and a gridless one: the cell fitted to the plate, a road and a river
 * clipped to the cell, the stock's points at positions that never move, and
 * the party's mark. Then `compassBetween`, `neighbourToward` and `compassPad`
 * on grids of rows and of columns. Every coordinate, id and surface is
 * invented; nothing here is a printed value.
 *
 * Run: node tools/test-plate.mjs
 */
import assert from "node:assert/strict";

let passed = 0;
const ok = (name, fn) => {
  fn();
  passed++;
  console.log("ok   " + name);
};

/* -------------------------------------------- */
/*  Foundry mock                                */
/* -------------------------------------------- */

globalThis.CONST = {
  GRID_TYPES: { GRIDLESS: 0, SQUARE: 1, HEXODDR: 2, HEXEVENR: 3, HEXODDQ: 4, HEXEVENQ: 5 },
  EDGE_SENSE_TYPES: { NONE: 0, NORMAL: 20 },
};
globalThis.foundry = { utils: { escapeHTML: (s) => String(s) } };
globalThis.game = {
  user: { isGM: true },
  settings: { get: () => null },
  i18n: { localize: (key) => key, format: (key) => key, has: () => false },
};
globalThis.Hooks = { on() {}, once() {} };
globalThis.ui = { notifications: { info() {}, warn() {} } };

const { PLATE_PIXELS, plateGeometry, HEX_DIRECTIONS, hexOrientation, compassBetween, neighbourToward, compassPad } =
  await import("../scripts/formation/plate.mjs");

const R = 50; // a hex's circumradius, in scene pixels
const W = Math.sqrt(3) * R; // the distance between neighbouring centres
const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} is not ${b}`);
const cells = [];
for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) cells.push({ i, j });

/**
 * A regular hex grid. Rows (`HEXODDR`) are pointy-topped with every odd row
 * shoved half a hex right; columns (`HEXODDQ`) are flat-topped with every odd
 * column shoved half a hex down. Centres, vertices, the nearest cell to a
 * point and the six cells one hex away are all read off the same centres.
 */
function hexGrid(type) {
  const rows = type === CONST.GRID_TYPES.HEXODDR;
  const centre = ({ i, j }) => (rows
    ? { x: (j + 0.5 + (i % 2 ? 0.5 : 0)) * W, y: R + i * 1.5 * R }
    : { x: R + j * 1.5 * R, y: (i + 0.5 + (j % 2 ? 0.5 : 0)) * W });
  const first = rows ? -90 : 0;
  return {
    type,
    size: 2 * R,
    sizeX: rows ? W : 2 * R,
    sizeY: rows ? 2 * R : W,
    getCenterPoint: centre,
    getVertices: (offset) => {
      const c = centre(offset);
      return Array.from({ length: 6 }, (_, k) => {
        const a = ((first + 60 * k) * Math.PI) / 180;
        return { x: c.x + R * Math.cos(a), y: c.y + R * Math.sin(a) };
      });
    },
    getOffset: (p) => {
      let best = null;
      for (const c of cells) {
        const q = centre(c);
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (!best || d < best.d) best = { c, d };
      }
      return { i: best.c.i, j: best.c.j };
    },
    getAdjacentOffsets: (o) => cells.filter((c) => Math.abs(Math.hypot(centre(o).x - centre(c).x, centre(o).y - centre(c).y) - W) < 1e-6),
  };
}

/** A scene on a grid, with the walls the Judge drew on it. */
const sceneOn = (grid, walls = []) => ({ id: "S.plate", grid, walls, getFlag: () => undefined });
/** A wall carrying a road or a water layer. */
const road = (c, surface) => ({ c, flags: { "acks-extras": { road: { surface } } } });
const river = (c) => ({ c, flags: { "acks-extras": { water: { kind: "river" } } } });

/* -------------------------------------------- */
/*  The hex                                     */
/* -------------------------------------------- */

const rows = hexGrid(CONST.GRID_TYPES.HEXODDR);
const cell = { i: 2, j: 3 };
const mid = rows.getCenterPoint(cell);
// The plate is the cell's larger side, less a margin on each edge.
const scale = (PLATE_PIXELS * 0.88) / (2 * R);
const half = PLATE_PIXELS / 2;

ok("the hex under the point, fitted to the plate with its margin, the mark at the point", () => {
  const g = plateGeometry(sceneOn(rows), mid);
  assert.equal(g.kind, "hex");
  assert.equal(g.size, PLATE_PIXELS);
  near(g.scale, scale, "plate pixels per scene pixel");
  assert.equal(g.polygon.length, 6);
  near(g.polygon[0].x, half, "the top vertex is centred");
  near(g.polygon[0].y, PLATE_PIXELS * 0.06, "and stands at the margin");
  near(g.polygon[3].y, PLATE_PIXELS * 0.94, "the bottom vertex at the far margin");
  const xs = g.polygon.map((p) => p.x);
  near(Math.max(...xs) - Math.min(...xs), W * scale, "the hex keeps its proportions");
  assert.ok(g.polygon.every((p) => p.x >= 0 && p.x <= PLATE_PIXELS && p.y >= 0 && p.y <= PLATE_PIXELS), "the cell lies on the plate");
  near(g.mark.x, half, "the mark at the cell's centre");
  near(g.mark.y, half, "the mark at the cell's centre");
  assert.ok(g.mark.r > 0);
  near(g.view.width, PLATE_PIXELS / scale, "the background's crop covers the whole plate");
  near(g.view.x + g.view.width / 2, mid.x, "centred on the cell");

  const off = plateGeometry(sceneOn(rows), { x: mid.x + 10, y: mid.y - 20 });
  assert.deepEqual(off.polygon, g.polygon, "anywhere in the cell, the same cell is drawn");
  near(off.mark.x, half + 10 * scale, "and the mark stands where the point does");
  near(off.mark.y, half - 20 * scale, "and the mark stands where the point does");
});

ok("a road and a river are clipped to the cell; a line elsewhere is not drawn", () => {
  const g = plateGeometry(sceneOn(rows, [
    road([0, mid.y, 2000, mid.y], "QQ cobbles"),
    road([0, mid.y + 500, 2000, mid.y + 500], "QQ far"),
    river([mid.x - 100, mid.y - 100, mid.x + 100, mid.y + 100]),
    { c: [0, mid.y, 2000, mid.y], flags: {} },
  ]), mid);
  assert.equal(g.roads.length, 1, "the road through the cell, not the one five hexes off, nor a bare wall");
  const [r] = g.roads;
  assert.equal(r.surface, "QQ cobbles", "the road keeps its surface");
  near(r.y0, half, "it crosses at the cell's middle");
  near(r.y1, half, "it crosses at the cell's middle");
  near(r.x0, half - (W / 2) * scale, "clipped at the cell's west edge");
  near(r.x1, half + (W / 2) * scale, "and at its east edge");
  assert.equal(g.water.length, 1);
  const [w] = g.water;
  assert.equal(w.kind, "river");
  assert.equal(typeof w.navigable, "boolean");
  near(w.x0, half - (W / 2) * scale, "the river is clipped where it leaves the cell's bounds");
  near(w.y0, half - (W / 2) * scale, "on its own diagonal");
  near(w.x1, half + (W / 2) * scale, "both ends");
  near(w.y1, half + (W / 2) * scale, "both ends");
});

ok("the stock's points stand where their ids put them, inside the cell, on every render", () => {
  const points = [{ id: "QQ-p1", found: true }, { id: "QQ-p2", found: false }];
  const g = plateGeometry(sceneOn(rows), mid, PLATE_PIXELS, { points });
  assert.deepEqual(g.points.map((p) => [p.id, p.found]), [["QQ-p1", true], ["QQ-p2", false]]);
  const again = plateGeometry(sceneOn(rows), { x: mid.x - 15, y: mid.y + 5 }, PLATE_PIXELS, { points: [...points].reverse() });
  for (const p of g.points) {
    const q = again.points.find((x) => x.id === p.id);
    near(q.x, p.x, `${p.id} does not move with the point or the order`);
    near(q.y, p.y, `${p.id} does not move with the point or the order`);
  }
  assert.ok(g.points[0].x !== g.points[1].x || g.points[0].y !== g.points[1].y, "two ids, two places");
  const inscribed = (W / 2) * scale;
  for (const p of g.points) {
    const d = Math.hypot(p.x - half, p.y - half);
    assert.ok(d < inscribed, `${p.id} lies inside the hex`);
    assert.ok(d > g.mark.r, `${p.id} stands clear of the party's mark`);
  }
  assert.deepEqual(plateGeometry(sceneOn(rows), mid, PLATE_PIXELS, { points: [{ found: true }, null] }).points, [], "a point with no id is not drawn");
});

ok("nothing to draw without a scene, a grid or a point", () => {
  assert.equal(plateGeometry(null, mid), null);
  assert.equal(plateGeometry({ id: "S.none" }, mid), null);
  assert.equal(plateGeometry(sceneOn(rows), null), null);
  assert.equal(plateGeometry(sceneOn(rows), { x: Number.NaN, y: 3 }), null);
});

/* -------------------------------------------- */
/*  The square and the gridless scene           */
/* -------------------------------------------- */

ok("a square grid draws its square; a gridless scene a square one unit across the point", () => {
  const square = { type: CONST.GRID_TYPES.SQUARE, size: 100, getOffset: (p) => ({ i: Math.floor(p.y / 100), j: Math.floor(p.x / 100) }) };
  const g = plateGeometry(sceneOn(square), { x: 250, y: 130 });
  assert.equal(g.kind, "square");
  const lo = PLATE_PIXELS * 0.06;
  const hi = PLATE_PIXELS * 0.94;
  assert.deepEqual(g.polygon.map((p) => [Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000]),
    [[lo, lo], [hi, lo], [hi, hi], [lo, hi]].map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]),
    "the cell from (200, 100) to (300, 200), fitted");
  near(g.mark.x, half, "the point is mid-cell across");
  near(g.mark.y, half - 20 * ((PLATE_PIXELS * 0.88) / 100), "and twenty pixels above the middle");

  const gridless = { type: CONST.GRID_TYPES.GRIDLESS, size: 100 };
  const a = plateGeometry(sceneOn(gridless), { x: 1234, y: 567 });
  assert.equal(a.kind, "area");
  assert.equal(a.polygon.length, 4);
  near(a.mark.x, half, "the area is centred on the point");
  near(a.mark.y, half, "the area is centred on the point");
  near(a.polygon[0].x, PLATE_PIXELS * 0.06, "one scene unit across, fitted");
});

/* -------------------------------------------- */
/*  The compass                                 */
/* -------------------------------------------- */

const columns = hexGrid(CONST.GRID_TYPES.HEXODDQ);
const rowScene = sceneOn(rows);
const columnScene = sceneOn(columns);

ok("a grid of rows is pointy-topped, a grid of columns flat-topped; nothing else is a hex", () => {
  assert.equal(hexOrientation(sceneOn({ type: CONST.GRID_TYPES.HEXODDR })), "rows");
  assert.equal(hexOrientation(sceneOn({ type: CONST.GRID_TYPES.HEXEVENR })), "rows");
  assert.equal(hexOrientation(sceneOn({ type: CONST.GRID_TYPES.HEXODDQ })), "columns");
  assert.equal(hexOrientation(sceneOn({ type: CONST.GRID_TYPES.HEXEVENQ })), "columns");
  assert.equal(hexOrientation(sceneOn({ type: CONST.GRID_TYPES.SQUARE })), null);
  assert.equal(hexOrientation(sceneOn({ type: CONST.GRID_TYPES.GRIDLESS })), null);
  assert.deepEqual([...HEX_DIRECTIONS.rows].sort(), ["e", "ne", "nw", "se", "sw", "w"]);
  assert.deepEqual([...HEX_DIRECTIONS.columns].sort(), ["n", "ne", "nw", "s", "se", "sw"]);
});

// Each grid's neighbours, from an even and an odd row or column, with the
// direction a reader of the map would give each.
const NEIGHBOURS = [
  [rowScene, { i: 4, j: 4 }, { e: [4, 5], w: [4, 3], ne: [3, 4], nw: [3, 3], se: [5, 4], sw: [5, 3] }],
  [rowScene, { i: 5, j: 4 }, { e: [5, 5], w: [5, 3], ne: [4, 5], nw: [4, 4], se: [6, 5], sw: [6, 4] }],
  [columnScene, { i: 4, j: 4 }, { n: [3, 4], s: [5, 4], ne: [3, 5], nw: [3, 3], se: [4, 5], sw: [4, 3] }],
  [columnScene, { i: 4, j: 5 }, { n: [3, 5], s: [5, 5], ne: [4, 6], nw: [4, 4], se: [5, 6], sw: [5, 4] }],
];

ok("each of the six neighbours is named by its direction, on rows and on columns", () => {
  for (const [scene, from, expected] of NEIGHBOURS) {
    const orientation = hexOrientation(scene);
    assert.equal(scene.grid.getAdjacentOffsets(from).length, 6, "the mock grid has six neighbours");
    for (const [dir, [i, j]] of Object.entries(expected)) {
      assert.equal(compassBetween(scene, from, { i, j }), dir, `${orientation} ${from.i}:${from.j} to ${i}:${j} is ${dir}`);
      assert.deepEqual(neighbourToward(scene, from, dir), { i, j }, `${orientation}: the neighbour ${dir} of ${from.i}:${from.j}`);
    }
  }
});

ok("the direction to a far hex is the nearest of the six, and one cell to itself has none", () => {
  assert.equal(compassBetween(rowScene, { i: 4, j: 4 }, { i: 4, j: 8 }), "e", "four hexes east is east");
  assert.equal(compassBetween(rowScene, { i: 4, j: 4 }, { i: 0, j: 2 }), "nw", "up the rows and back along them is north-west");
  assert.equal(compassBetween(columnScene, { i: 4, j: 4 }, { i: 9, j: 4 }), "s");
  assert.equal(compassBetween(rowScene, { i: 4, j: 4 }, { i: 4, j: 4 }), null);
  assert.equal(compassBetween(sceneOn({ type: CONST.GRID_TYPES.SQUARE }), { i: 0, j: 0 }, { i: 0, j: 1 }), null, "a square grid has no hex compass");
  assert.equal(neighbourToward(rowScene, { i: 4, j: 4 }, "n"), null, "a grid of rows has no neighbour due north");
  assert.equal(neighbourToward(columnScene, { i: 4, j: 4 }, "e"), null, "a grid of columns none due east");
  assert.equal(neighbourToward(sceneOn({ type: CONST.GRID_TYPES.SQUARE }), { i: 0, j: 0 }, "e"), null);
});

ok("the pad lays the six around the hex as the grid's cells run, the diagonals in the corners", () => {
  assert.deepEqual(compassPad(rowScene), ["nw", null, "ne", "w", "center", "e", "sw", null, "se"]);
  assert.deepEqual(compassPad(columnScene), ["nw", "n", "ne", null, "center", null, "sw", "s", "se"]);
  assert.equal(compassPad(sceneOn({ type: CONST.GRID_TYPES.SQUARE })), null);
  for (const scene of [rowScene, columnScene]) {
    const named = compassPad(scene).filter((c) => c && c !== "center");
    assert.deepEqual(named.sort(), [...HEX_DIRECTIONS[hexOrientation(scene)]].sort(), "every direction once");
  }
});

/* -------------------------------------------- */
/*  The painter and its images                  */
/* -------------------------------------------- */

const { drawPlate } = await import("../scripts/formation/plate.mjs");

/** A 2d context that records its `drawImage` calls and takes every other call and property in silence. */
function recorder() {
  const calls = [];
  return new Proxy({}, {
    get: (_target, prop) => {
      if (prop === "calls") return calls;
      if (prop === "drawImage") return (...args) => calls.push(args);
      return typeof prop === "string" ? () => {} : undefined;
    },
    set: () => true,
  });
}
const canvasOf = (ctx) => ({ isConnected: true, getContext: () => ctx });

// An image loads on the next tick once its `src` is set, or fails when the
// path says so; every construction is counted.
let imagesMade = 0;
globalThis.Image = class {
  constructor() {
    imagesMade++;
    this.complete = false;
    this.naturalWidth = 0;
    this.naturalHeight = 0;
  }
  set src(value) {
    this.path = value;
    setTimeout(() => {
      if (/fails/.test(value)) {
        this.onerror?.();
        return;
      }
      this.complete = true;
      this.naturalWidth = 1000;
      this.naturalHeight = 500;
      this.onload?.();
    }, 0);
  }
  get src() {
    return this.path;
  }
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
/** A scene on the row grid whose background covers a 1000 by 500 rectangle set in from the canvas's corner. */
const sceneWith = (id, src) => ({
  id, grid: rows, walls: [], getFlag: () => undefined,
  dimensions: { sceneRect: { x: 100, y: 50, width: 1000, height: 500 } },
  background: { src },
});
const scenes = new Map();
game.scenes = { get: (id) => scenes.get(id) ?? null };
const spec = (sceneId) => ({ sceneId, center: mid, points: [] });

{
  const ctx = recorder();
  const scene = sceneWith("S.draw", "QQ-parchment.png");
  scenes.set(scene.id, scene);
  assert.equal(drawPlate(canvasOf(ctx), spec(scene.id)), true, "a plate on a known scene draws");
  assert.equal(ctx.calls.length, 0, "nothing of the background before its image arrives");
  await settle();
  assert.equal(ctx.calls.length, 1, "the image arrived: the plate painted again, the background once");
  const g = plateGeometry(scene, mid, PLATE_PIXELS, { points: [] });
  const [, sx, sy, sw, sh, dx, dy, dw, dh] = ctx.calls[0];
  near(sx, g.view.x - 100, "the crop starts where the view does, measured from the scene rectangle's corner");
  near(sy, g.view.y - 50, "the crop starts where the view does, measured from the scene rectangle's corner");
  near(sw, g.view.width, "an image the rectangle's own size crops one to one");
  near(sh, g.view.height, "an image the rectangle's own size crops one to one");
  assert.deepEqual([dx, dy, dw, dh], [0, 0, PLATE_PIXELS, PLATE_PIXELS], "onto the whole plate");
  const made = imagesMade;
  drawPlate(canvasOf(recorder()), spec(scene.id));
  assert.equal(imagesMade, made, "a second plate of the same background loads no second image");
  passed++;
  console.log("ok   the background is cropped to the plate's view and painted when it arrives, loaded once per client");

  const bad = sceneWith("S.fails", "QQ-fails.png");
  scenes.set(bad.id, bad);
  const bctx = recorder();
  drawPlate(canvasOf(bctx), spec(bad.id));
  await settle();
  assert.equal(bctx.calls.length, 0, "a background that failed to load is never drawn");
  const before = imagesMade;
  drawPlate(canvasOf(bctx), spec(bad.id));
  assert.equal(imagesMade, before + 1, "and is asked for again by the next plate drawn");
  passed++;
  console.log("ok   a failed image is forgotten and asked for again");

  for (let n = 0; n < 12; n++) {
    const s = sceneWith(`S.many.${n}`, `QQ-many-${n}.png`);
    scenes.set(s.id, s);
    drawPlate(canvasOf(recorder()), spec(s.id));
  }
  await settle();
  const held = imagesMade;
  drawPlate(canvasOf(recorder()), spec(scene.id));
  assert.equal(imagesMade, held + 1, "the oldest image is dropped once twelve are held, and loads again when asked for");
  drawPlate(canvasOf(recorder()), spec("S.many.11"));
  assert.equal(imagesMade, held + 1, "the newest is still held");
  passed++;
  console.log("ok   the client keeps twelve images");
}

console.log(`\ntest-plate: all ${passed} checks passed`);
