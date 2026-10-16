/**
 * Water: a river or a coast the Judge drew as a line. What is pinned is the
 * layer's shape and its read — the kind, whether a boat can follow it, its
 * name — the reach of "on the line", a coast that does not hide a navigable
 * river beside it, the two preset slots and the from-selection tool, the
 * wall's own row, and that a water line is never a road. The wall-layer
 * mechanics beneath are `test-wall-layers.mjs`'s; what the country reader
 * makes of a line is `test-battlemap.mjs`'s. Every coordinate and name is
 * invented; nothing here is a printed value.
 */
import assert from "node:assert/strict";

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok   " + name); };
const okAsync = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

/* -------------------------------------------- */
/*  Foundry mock                                */
/* -------------------------------------------- */

const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" };
globalThis.foundry = {
  data: { operators: { ForcedReplacement: { create: (value) => ({ forced: value }) } } },
  utils: { escapeHTML: (s) => String(s).replace(/[&<>"']/g, (c) => ENTITIES[c]) },
};
globalThis.CONST = { EDGE_SENSE_TYPES: { NONE: 0, NORMAL: 20 }, EDGE_DOOR_TYPES: { NONE: 0, DOOR: 1, SECRET: 2 } };

let controlled = [];
let palette = { SETTING_KEY: "wallPreset" };
const settings = new Map();
const activated = [];
const notes = [];
globalThis.canvas = {
  walls: {
    get controlled() { return controlled; },
    constructor: { get paletteClass() { return palette; } },
  },
};
globalThis.game = {
  user: { isGM: true },
  settings: {
    set: async (scope, key, value) => { settings.set(`${scope}.${key}`, value); },
    get: (scope, key) => settings.get(`${scope}.${key}`) ?? null,
  },
  // Every key answers as itself, with its data appended, so a notification is
  // asserted by the key it was built from and the figures it carried.
  i18n: {
    localize: (key) => key,
    format: (key, data = {}) => (Object.keys(data).length ? `${key} ${JSON.stringify(data)}` : key),
    has: () => false,
  },
};
globalThis.ui = {
  controls: { activate: (opts) => activated.push(opts), render() {} },
  placeablesPalette: { render() {} },
  notifications: { info: (m) => notes.push(["info", m]), warn: (m) => notes.push(["warn", m]) },
};
const hooks = new Map();
globalThis.Hooks = {
  on: (name, fn) => {
    if (!hooks.has(name)) hooks.set(name, []);
    hooks.get(name).push(fn);
  },
};

/** The row the module last built, with one stand-in per control it reads. */
let built = null;
globalThis.document = {
  createElement: () => {
    const controls = new Map();
    built = {
      className: "",
      innerHTML: "",
      controls,
      querySelector(sel) {
        if (!controls.has(sel)) {
          controls.set(sel, {
            value: "",
            checked: false,
            listeners: [],
            addEventListener(_type, fn) { this.listeners.push(fn); },
          });
        }
        return controls.get(sel);
      },
    };
    return built;
  },
};

const { MODULE_ID } = await import("../scripts/lib/constants.mjs");
const {
  WATER_FLAG, WATER_KINDS, wallWater, isWaterWall, waterWallsOf, waterWallData, waterUnder,
  waterKindLabel, armWaterPreset, waterFromSelection, registerWaterHooks, installWaterControls,
} = await import("../scripts/battlemap/water.mjs");
const { roadWallsOf, roadSegmentsOf, invalidateRoadGraph } = await import("../scripts/battlemap/roads.mjs");

/* -------------------------------------------- */
/*  Fixtures                                    */
/* -------------------------------------------- */

let seq = 0;

/** A wall document whose flag accessor reads its raw flags and records each write. */
function makeWall(c, { water = null, road = null, move = 0 } = {}) {
  const flags = {};
  if (water) flags.water = water;
  if (road) flags.road = road;
  return {
    documentName: "Wall",
    id: `w${++seq}`,
    c,
    move,
    flags: { [MODULE_ID]: flags },
    writes: [],
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    },
    async setFlag(scope, key, value) {
      this.writes.push({ key, value: value?.forced ?? value });
      this.flags[scope] = { ...(this.flags[scope] ?? {}), [key]: value?.forced ?? value };
      return this;
    },
    async unsetFlag(scope, key) {
      this.writes.push({ key, value: undefined });
      delete this.flags[scope]?.[key];
      return this;
    },
  };
}

/** A scene of 100-pixel cells holding these walls. */
const makeScene = (walls, grid = { size: 100 }) => ({ id: `s${++seq}`, grid, walls });

/** Let every write a change listener started run to its end. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/* -------------------------------------------- */
/*  The layer                                   */
/* -------------------------------------------- */

ok("a fresh line obstructs nothing, is no door, and carries the water layer", () => {
  const data = waterWallData();
  assert.deepEqual(
    { move: data.move, sight: data.sight, sound: data.sound, light: data.light, door: data.door },
    { move: 0, sight: 0, sound: 0, light: 0, door: 0 },
    "a river restricts nothing, and a preset armed after a door does not inherit the doorway",
  );
  assert.deepEqual(data.flags[MODULE_ID][WATER_FLAG], { kind: "river", navigable: true, name: "" },
    "the first kind, followed by a boat, unnamed");
  assert.deepEqual(WATER_KINDS, ["river", "coast"]);
});

ok("a coast is a shore unless the Judge says a boat can follow it, and a river the other way", () => {
  assert.equal(waterWallData({ kind: "coast" }).flags[MODULE_ID].water.navigable, false);
  assert.equal(waterWallData({ kind: "coast", navigable: true }).flags[MODULE_ID].water.navigable, true);
  assert.equal(waterWallData({ kind: "river", navigable: false }).flags[MODULE_ID].water.navigable, false,
    "a stated false stands over the river's default");
  assert.equal(waterWallData({ kind: "lake" }).flags[MODULE_ID].water.kind, "river", "an unknown kind is the first kind");
  assert.equal(waterWallData({ name: 7 }).flags[MODULE_ID].water.name, "7", "the name is stored as text");
});

ok("a wall's water is read the same off a document and off plain data, defaults resolved", () => {
  const doc = makeWall([0, 0, 100, 0], { water: { kind: "coast", name: "Shore 3" } });
  assert.deepEqual(wallWater(doc), { kind: "coast", navigable: false, name: "Shore 3" },
    "an unstated navigable reads as the kind's default");
  const plain = { c: [0, 0, 100, 0], flags: { [MODULE_ID]: { water: { kind: "river" } } } };
  assert.deepEqual(wallWater(plain), { kind: "river", navigable: true, name: "" }, "no accessor is not no layer");
  assert.equal(wallWater(makeWall([0, 0, 100, 0], { water: { kind: "mire" } })).kind, "river",
    "a kind this build does not know reads as the first kind");
  assert.equal(wallWater(makeWall([0, 0, 100, 0])), null, "a wall without the layer is not water");
  assert.equal(isWaterWall(doc), true);
  assert.equal(isWaterWall(makeWall([0, 0, 100, 0], { road: { surface: "paved" } })), false, "a road is not water");
});

ok("the scene's water lines are its walls carrying the layer, in scene order", () => {
  const a = makeWall([0, 0, 100, 0], { water: { kind: "river" } });
  const b = makeWall([0, 0, 100, 0], { road: { surface: "earth" } });
  const c = makeWall([0, 0, 100, 0], { water: { kind: "coast" } });
  assert.deepEqual(waterWallsOf(makeScene([a, b, c])).map((w) => w.id), [a.id, c.id]);
  assert.deepEqual(waterWallsOf(null), [], "no scene is no water");
  assert.deepEqual(waterWallsOf({ id: "s-no-walls" }), [], "a scene with no wall collection is no water");
});

/* -------------------------------------------- */
/*  On the line                                 */
/* -------------------------------------------- */

ok("a point within half a cell of a line is on it, and the nearest line answers", () => {
  const river = makeWall([0, 500, 1000, 500], { water: { kind: "river", name: "River 1" } });
  const brook = makeWall([0, 560, 1000, 560], { water: { kind: "river", name: "River 2" } });
  const scene = makeScene([river, brook]);
  const on = waterUnder(scene, { x: 400, y: 520 });
  assert.equal(on?.wall, river, "twenty pixels from one, forty from the other");
  assert.deepEqual({ kind: on.kind, navigable: on.navigable, name: on.name },
    { kind: "river", navigable: true, name: "River 1" }, "and the line's resolved layer comes with it");
  assert.equal(waterUnder(scene, { x: 400, y: 449 }), null, "fifty-one pixels off is a hex away");
  assert.equal(waterUnder(scene, { x: 400, y: 450 })?.wall, river, "fifty is on the line");
  assert.equal(waterUnder(makeScene([river], { size: 300 }), { x: 400, y: 640 })?.wall, river,
    "the reach is the scene's own half cell");
  assert.equal(waterUnder(scene, { x: 400, y: 380 }, 150)?.wall, river, "an explicit reach replaces it");
  assert.equal(waterUnder(makeScene([]), { x: 0, y: 0 }), null, "no lines, nothing under any point");
});

ok("asked for a navigable line, a nearer coast does not hide the river beside it", () => {
  const coast = makeWall([0, 500, 1000, 500], { water: { kind: "coast" } });
  const river = makeWall([0, 540, 1000, 540], { water: { kind: "river" } });
  const scene = makeScene([coast, river]);
  assert.equal(waterUnder(scene, { x: 300, y: 510 })?.wall, coast, "the nearest line is the shore");
  assert.equal(waterUnder(scene, { x: 300, y: 510 }, null, { navigable: true })?.wall, river,
    "a boat's question skips the shore");
  assert.equal(waterUnder(makeScene([coast]), { x: 300, y: 510 }, null, { navigable: true }), null,
    "a shore alone is no route");
});

ok("a water line is never a road: no road wall, no road segment, so no route link", () => {
  const scene = makeScene([
    makeWall([0, 0, 1000, 0], { water: { kind: "river" } }),
    makeWall([0, 300, 1000, 300], { water: { kind: "coast" } }),
  ]);
  invalidateRoadGraph();
  assert.deepEqual(roadWallsOf(scene), []);
  assert.deepEqual(roadSegmentsOf(scene), [], "the hex topology's links come from road segments alone");
  invalidateRoadGraph();
});

/* -------------------------------------------- */
/*  Drawing one                                 */
/* -------------------------------------------- */

await okAsync("each preset slot arms core's wall tool with its own kind, and the next replaces it", async () => {
  palette = { SETTING_KEY: "wallPreset" };
  activated.length = 0;
  notes.length = 0;
  assert.equal(await armWaterPreset({ kind: "river" }), true);
  assert.deepEqual(settings.get("core.wallPreset"), waterWallData({ kind: "river" }), "the river preset is the river line");
  assert.deepEqual(notes.at(-1), ["info", `ACKS-BATTLEMAP.water.presetArmed ${JSON.stringify({ water: waterKindLabel("river") })}`],
    "the notification names what is now armed");
  assert.equal(await armWaterPreset({ kind: "coast" }), true);
  assert.deepEqual(settings.get("core.wallPreset"), waterWallData({ kind: "coast" }), "one slot: the coast replaces the river");
  assert.deepEqual(activated.at(-1), { control: "walls", tool: "wall" }, "and the drawing tool is handed over");

  palette = null;
  assert.equal(await armWaterPreset({ kind: "river" }), false, "no palette: nothing was armed");
  assert.equal(notes.at(-1)[0], "warn", "and the Judge is told so");
  assert.equal(notes.at(-1)[1], "ACKS-BATTLEMAP.water.presetUnavailable");
  palette = { SETTING_KEY: "wallPreset" };
});

await okAsync("the tool marks the selection as water, counts what it changed, and keeps a name", async () => {
  const fresh = makeWall([0, 0, 100, 0]);
  const named = makeWall([0, 100, 100, 100], { water: { kind: "coast", navigable: false, name: "Line 4" } });
  const solid = makeWall([0, 200, 100, 200], { move: 20 });
  controlled = [{ document: fresh }, { document: named }, { document: solid }, { document: null }];
  notes.length = 0;
  const got = await waterFromSelection({ kind: "river" });
  assert.deepEqual(got, { added: 2, updated: 1, blocking: 1, armed: false });
  assert.deepEqual(wallWater(fresh), { kind: "river", navigable: true, name: "" });
  assert.equal(wallWater(named).name, "Line 4", "a name already on a line is kept");
  assert.equal(wallWater(named).kind, "river", "and the line becomes the kind asked for");
  assert.equal(solid.move, 20, "a wall's own restriction is never altered — water is a layer");
  assert.equal(notes.find(([kind]) => kind === "warn")?.[1].startsWith("ACKS-BATTLEMAP.water.blocking"), true,
    "a line the party still cannot cross is reported");

  // A line already of the kind keeps its own say on boats; one changing kind
  // takes the new kind's default.
  const closed = makeWall([0, 300, 100, 300], { water: { kind: "river", navigable: false, name: "" } });
  controlled = [{ document: closed }];
  assert.deepEqual(await waterFromSelection({ kind: "river" }), { added: 0, updated: 1, blocking: 0, armed: false });
  assert.equal(wallWater(closed).navigable, false, "marking a river again keeps it closed to boats");
  controlled = [{ document: named }];
  await waterFromSelection({ kind: "coast" });
  assert.deepEqual([wallWater(named).kind, wallWater(named).navigable], ["coast", false],
    "a river made a coast is a shore until its row says otherwise");

  controlled = [];
  settings.delete("core.wallPreset");
  const armed = await waterFromSelection({ kind: "coast" });
  assert.deepEqual(armed, { added: 0, updated: 0, blocking: 0, armed: true }, "with nothing selected the tool arms the preset");
  assert.deepEqual(settings.get("core.wallPreset"), waterWallData({ kind: "coast" }));
});

ok("the Walls layer carries the from-selection tool, as a button with one handler", () => {
  installWaterControls();
  const handler = hooks.get("getSceneControlButtons").at(-1);
  const keyed = { walls: { tools: {} } };
  handler(keyed);
  const tool = keyed.walls.tools.acksWaterFromSelection;
  assert.ok(tool, "added to the keyed tool record");
  assert.equal(tool.button, true);
  assert.equal(tool.visible, true, "a GM sees it");
  assert.equal(typeof tool.onChange, "function");
  assert.equal(tool.onClick, undefined, "one handler: a button given both has both called for one press");
  assert.deepEqual(tool.createData, waterWallData());
  const listed = [{ name: "walls", tools: [] }];
  handler(listed);
  assert.equal(listed[0].tools[0].name, "acksWaterFromSelection", "and pushed onto a listed tool array");
  handler({ tokens: { tools: {} } });
});

/* -------------------------------------------- */
/*  The wall's own row                          */
/* -------------------------------------------- */

await okAsync("a placed wall's sheet gets the water row; the palette's preview and a player's do not", async () => {
  registerWaterHooks();
  const appended = [];
  const root = {
    nodeType: 1,
    querySelector: (sel) => (sel === ".window-content .standard-form" ? { append: (r) => appended.push(r) } : null),
  };
  let rendered = 0;
  const render = (wall) => {
    appended.length = 0;
    built = null;
    for (const fn of hooks.get("renderApplicationV2")) fn({ document: wall, render() { rendered++; } }, root);
    return built;
  };

  assert.equal(render({ documentName: "Wall", id: null, flags: {} }), null, "the id-less preview gets no row");
  assert.equal(render({ documentName: "Tile", id: "t1" }), null, "nor does a sheet that is not a wall's");
  game.user.isGM = false;
  assert.equal(render(makeWall([0, 0, 100, 0])), null, "nor a player's");
  game.user.isGM = true;

  const name = 'Line "Q" & <R>';
  const wall = makeWall([0, 0, 100, 0], { water: { kind: "river", navigable: true, name } });
  const row = render(wall);
  assert.ok(row, "a placed wall gets the row");
  assert.equal(appended.length, 1, "appended once, into the sheet's own field list");
  assert.equal(row.className, "form-group acks-extras-water-row");
  const value = /class="acks-extras-water-name" value="([^"]*)"/.exec(row.innerHTML)?.[1];
  assert.equal(value, foundry.utils.escapeHTML(name), "the name goes into its attribute escaped");
  assert.ok(/<option value="river" selected>/.test(row.innerHTML), "the line's kind is the selected option");
  assert.ok(/acks-extras-water-navigable" checked/.test(row.innerHTML), "and a followable line is ticked");

  // A change writes the whole row: kind, the tick and the name together.
  const kind = row.controls.get(".acks-extras-water-kind");
  row.controls.get(".acks-extras-water-navigable").checked = false;
  row.controls.get(".acks-extras-water-name").value = "Shore 5";
  kind.value = "coast";
  for (const fn of kind.listeners) fn();
  await settle();
  assert.deepEqual(wallWater(wall), { kind: "coast", navigable: false, name: "Shore 5" });
  assert.ok(rendered >= 1, "and the sheet re-renders over what was written");

  // "Not water" takes the layer off and leaves the wall itself alone.
  kind.value = "";
  for (const fn of kind.listeners) fn();
  await settle();
  assert.equal(wallWater(wall), null);
  assert.equal(wall.writes.at(-1).value, undefined, "the layer was unset, not written empty");
});

console.log(`test-water: OK (${passed} checks: the line's shape and read, reach, a shore beside a river, never a road, presets, from selection, the tool, the wall row)`);
