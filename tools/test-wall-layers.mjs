/**
 * A layer over a wall: what the module means by a line the Judge drew.
 *
 * The geometry beneath is `test-wall-geometry.mjs`'s, and what a layer MEANS is
 * its owning feature's (`test-trap-rules.mjs` for the trap line, the road
 * checks in `test-battlemap.mjs` for the street). What is pinned here is the
 * mechanics every layer shares: a flag read the same off a document and off
 * plain data, a patch that can empty a field, a drawn line that obstructs
 * nothing, one preset slot, and the region a closed loop of walls encloses.
 * Every coordinate is invented; nothing here is a printed value.
 */
import assert from "node:assert/strict";

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok   " + name); };
const okAsync = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

/* -------------------------------------------- */
/*  Foundry mock                                */
/* -------------------------------------------- */

/** Every forced replacement the layer writer built, in order. */
const forced = [];
globalThis.foundry = {
  data: {
    operators: {
      ForcedReplacement: {
        create: (value) => {
          const op = { forced: value };
          forced.push(op);
          return op;
        },
      },
    },
  },
};
globalThis.CONST = { EDGE_SENSE_TYPES: { NONE: 0, NORMAL: 20 }, EDGE_DOOR_TYPES: { NONE: 0 } };

let scene = null;
let controlled = [];
let palette = null;
const settings = new Map();
const activated = [];
globalThis.canvas = {
  get scene() { return scene; },
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
};
globalThis.ui = {
  controls: { activate: (opts) => activated.push(opts), render() {} },
  placeablesPalette: { render() {} },
  notifications: {},
};

const { MODULE_ID } = await import("../scripts/lib/constants.mjs");
const {
  wallLayer, hasWallLayer, setWallLayer, clearWallLayer, wallsFlagged, openWallData,
  blocksMovement, controlledWalls, wallNear, armWallPreset, currentWallPreset, regionFromWalls,
} = await import("../scripts/lib/wall-layers.mjs");

/* -------------------------------------------- */
/*  Fixtures                                    */
/* -------------------------------------------- */

let seq = 0;

/** A wall document: the accessor reads the raw flags, and every write is recorded. */
function makeWall(c, { flags = {}, move = 0 } = {}) {
  return {
    id: `w${++seq}`,
    c,
    move,
    flags: { [MODULE_ID]: { ...flags } },
    writes: [],
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    },
    async setFlag(scope, key, value) {
      this.writes.push({ scope, key, value });
      this.flags[scope] = { ...(this.flags[scope] ?? {}), [key]: value?.forced ?? value };
      return this;
    },
    async unsetFlag(scope, key) {
      this.writes.push({ scope, key, value: undefined });
      delete this.flags[scope]?.[key];
      return this;
    },
  };
}

function makeScene(walls = []) {
  const regions = [];
  return {
    id: `s${++seq}`,
    walls,
    regions,
    refuse: false,
    async createEmbeddedDocuments(name, data) {
      assert.equal(name, "Region");
      if (this.refuse) return [];
      const made = data.map((d) => ({ ...d, id: `r${++seq}` }));
      regions.push(...made);
      return made;
    },
  };
}

/* -------------------------------------------- */
/*  The flag                                    */
/* -------------------------------------------- */

ok("a document is read through its accessor, and plain data off its raw flags", () => {
  const road = { surface: "paved" };
  const doc = makeWall([0, 0, 10, 0], { flags: { road } });
  assert.deepEqual(wallLayer(doc, "road"), road);
  assert.equal(hasWallLayer(doc, "road"), true);
  // A create hook's data bag, the palette's preset, a scene's source: no
  // accessor at all, and the same layer under the same key.
  const plain = { c: [0, 0, 10, 0], flags: { [MODULE_ID]: { road } } };
  assert.deepEqual(wallLayer(plain, "road"), road, "no accessor is not no layer");
  assert.equal(hasWallLayer(plain, "road"), true);
  // Where there is an accessor it is the read; the raw flags are the fallback.
  const spoken = makeWall([0, 0, 10, 0], { flags: { road } });
  spoken.getFlag = () => ({ surface: "earth" });
  assert.deepEqual(wallLayer(spoken, "road"), { surface: "earth" }, "the accessor speaks first");
});

ok("a wall carrying no layer under the key is null, not an empty layer", () => {
  const bare = makeWall([0, 0, 10, 0]);
  assert.equal(wallLayer(bare, "road"), null);
  assert.equal(hasWallLayer(bare, "road"), false);
  const other = makeWall([0, 0, 10, 0], { flags: { trap: { itemUuid: "Item.x" } } });
  assert.equal(wallLayer(other, "road"), null, "another feature's layer is not this one");
  assert.equal(wallLayer(null, "road"), null);
});

await okAsync("a patch merges over the layer and is written whole, so it can EMPTY a field", async () => {
  const wall = makeWall([0, 0, 10, 0], { flags: { trap: { itemUuid: "Item.x", repeatLock: { a: 1 } } } });
  forced.length = 0;
  await setWallLayer(wall, "trap", { repeatLock: {} });
  assert.equal(forced.length, 1, "one forced replacement");
  assert.deepEqual(forced[0].forced, { itemUuid: "Item.x", repeatLock: {} },
    "the untouched field survives and the cleared one is genuinely empty");
  assert.deepEqual(wall.writes.at(-1), { scope: MODULE_ID, key: "trap", value: forced[0] },
    "written through the document's own flag api, under the module's scope");
  assert.deepEqual(wallLayer(wall, "trap"), { itemUuid: "Item.x", repeatLock: {} });
});

await okAsync("a first write over no layer is the patch itself", async () => {
  const wall = makeWall([0, 0, 10, 0]);
  await setWallLayer(wall, "road", { surface: "earth", street: null, name: "" });
  assert.deepEqual(wallLayer(wall, "road"), { surface: "earth", street: null, name: "" });
});

await okAsync("clearing a layer unsets that key and leaves the wall alone", async () => {
  const wall = makeWall([0, 0, 10, 0], {
    flags: { road: { surface: "paved" }, trap: { itemUuid: "Item.x" } },
    move: 20,
  });
  await clearWallLayer(wall, "road");
  assert.equal(wallLayer(wall, "road"), null);
  assert.deepEqual(wallLayer(wall, "trap"), { itemUuid: "Item.x" }, "the other layer stands");
  assert.equal(wall.move, 20, "the wall's own restriction is untouched");
});

ok("wallsFlagged is the scene's walls carrying the key, in scene order", () => {
  const a = makeWall([0, 0, 10, 0], { flags: { road: { surface: "paved" } } });
  const b = makeWall([0, 0, 10, 0]);
  const c = makeWall([0, 0, 10, 0], { flags: { road: { surface: "earth" } } });
  assert.deepEqual(wallsFlagged(makeScene([a, b, c]), "road").map((w) => w.id), [a.id, c.id]);
  assert.deepEqual(wallsFlagged(null, "road"), []);
});

/* -------------------------------------------- */
/*  The shape of a drawn line                   */
/* -------------------------------------------- */

ok("a non-blocking line obstructs nothing, and only a movement restriction blocks", () => {
  assert.deepEqual(openWallData(), { move: 0, sight: 0, sound: 0, light: 0 });
  assert.equal(blocksMovement(makeWall([0, 0, 10, 0], { move: 20 })), true);
  assert.equal(blocksMovement(makeWall([0, 0, 10, 0], { move: 0 })), false);
  assert.equal(blocksMovement({ c: [0, 0, 10, 0] }), false, "a wall stating no restriction blocks nothing");
});

ok("the nearest wall within reach answers, and a key narrows the candidates", () => {
  const street = makeWall([0, 0, 1000, 0], { flags: { road: { surface: "paved" } } });
  const house = makeWall([0, 20, 1000, 20], { move: 20 });
  const s = makeScene([street, house]);
  assert.equal(wallNear(s, 500, 15, 50), house, "the house wall is five pixels off, the street fifteen");
  assert.equal(wallNear(s, 500, 15, 50, "road"), street, "asked for a road, the house does not answer");
  assert.equal(wallNear(s, 500, 200, 50), null, "nothing within reach is nothing");
  assert.equal(wallNear(s, 500, 200, 50, "road"), null);
});

ok("controlledWalls is what the Judge has selected, as documents", () => {
  const w = makeWall([0, 0, 10, 0]);
  controlled = [{ document: w }, { document: null }];
  assert.deepEqual(controlledWalls(), [w]);
  controlled = [];
  assert.deepEqual(controlledWalls(), []);
});

/* -------------------------------------------- */
/*  One preset slot                             */
/* -------------------------------------------- */

await okAsync("a preset is armed only where a palette exists, and the tool is handed over either way", async () => {
  palette = null;
  activated.length = 0;
  const data = { ...openWallData(), flags: { [MODULE_ID]: { road: { surface: "paved" } } } };
  assert.equal(await armWallPreset(data), false, "no palette: nothing was armed, and the caller is told");
  assert.deepEqual(activated, [{ control: "walls", tool: "wall" }], "the drawing tool is still opened");
  assert.equal(currentWallPreset(), null, "and nothing reads back");

  palette = { SETTING_KEY: "wallPreset" };
  assert.equal(await armWallPreset(data), true);
  assert.deepEqual(currentWallPreset(), data, "the armed preset reads back whole");

  // One slot: the next arming replaces it, whichever feature armed the last.
  const trap = { ...openWallData(), flags: { [MODULE_ID]: { trap: { itemUuid: "Item.x" } } } };
  await armWallPreset(trap);
  assert.deepEqual(currentWallPreset(), trap, "arming a tripwire disarms the street");
  palette = null;
});

/* -------------------------------------------- */
/*  The region a loop encloses                  */
/* -------------------------------------------- */

/** Three walls closing a triangle, drawn by hand: the ends are a few pixels apart. */
const loop = () => [
  makeWall([0, 0, 300, 0]),
  makeWall([302, 1, 150, 240]),
  makeWall([149, 238, 1, 2]),
];

await okAsync("a region needs a scene, a selection, and a closed loop — each refusal is named", async () => {
  scene = null;
  assert.deepEqual(await regionFromWalls(loop(), { name: "Quarter" }), { region: null, created: false, reason: "noScene" });
  scene = makeScene();
  assert.equal((await regionFromWalls(loop().slice(0, 2), { name: "Quarter" })).reason, "selectLoop");
  assert.equal((await regionFromWalls([], { name: "Quarter" })).reason, "selectLoop");
  const open = [makeWall([0, 0, 300, 0]), makeWall([300, 0, 150, 240]), makeWall([150, 240, 600, 600])];
  assert.equal((await regionFromWalls(open, { name: "Quarter" })).reason, "notClosed");
  assert.equal(scene.regions.length, 0, "nothing was created by a refusal");
});

await okAsync("a closed loop becomes one polygon region carrying the behaviours it was given", async () => {
  scene = makeScene();
  const got = await regionFromWalls(loop(), {
    name: "Quarter",
    color: "#123456",
    visibility: 1,
    behaviors: [{ type: "acks-extras.district", name: "District" }],
  });
  assert.equal(got.reason, "made");
  assert.equal(got.created, true);
  assert.equal(got.region.name, "Quarter");
  assert.equal(got.region.color, "#123456");
  assert.equal(got.region.visibility, 1);
  assert.equal(got.region.shapes.length, 1);
  assert.equal(got.region.shapes[0].type, "polygon");
  assert.equal(got.region.shapes[0].hole, false);
  assert.equal(got.region.shapes[0].points.length, 6, "three corners, as x/y pairs");
  assert.deepEqual(got.region.behaviors, [{ type: "acks-extras.district", name: "District" }]);
  assert.equal(scene.regions.length, 1);
});

await okAsync("a region left to core's default visibility carries no visibility at all", async () => {
  scene = makeScene();
  const got = await regionFromWalls(loop(), { name: "Quarter" });
  assert.equal("visibility" in got.region, false, "unstated, so core's own default applies");
  assert.equal("color" in got.region, false);
});

await okAsync("the same loop pressed again hands back the region it already made", async () => {
  scene = makeScene();
  const district = { behaviorType: "acks-extras.district", behaviors: [{ type: "acks-extras.district" }] };
  const first = await regionFromWalls(loop(), { name: "Quarter", ...district });
  assert.equal(first.created, true);
  // The loop drawn the other way round, from another corner: the same ground.
  const reversed = [makeWall([1, 2, 149, 238]), makeWall([150, 240, 302, 1]), makeWall([300, 0, 0, 0])];
  const again = await regionFromWalls(reversed, { name: "Quarter", ...district });
  assert.equal(again.reason, "reused");
  assert.equal(again.created, false);
  assert.equal(again.region, first.region, "the very region, not a copy");
  assert.equal(scene.regions.length, 1, "and nothing was stacked over it");
  // Without naming the behaviour type there is no identity to reuse by.
  const untyped = await regionFromWalls(loop(), { name: "Quarter" });
  assert.equal(untyped.created, true, "a caller that names no type gets a new region");
});

await okAsync("a create the server refuses is reported as refused, not as made", async () => {
  scene = makeScene();
  scene.refuse = true;
  const got = await regionFromWalls(loop(), { name: "Quarter" });
  assert.deepEqual(got, { region: null, created: false, reason: "refused" });
});

console.log("\ntest-wall-layers: all " + passed + " checks passed");
