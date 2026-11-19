/**
 * Which places hold a point (`placesAround`) and what a drop on the map does
 * (`dropOnMapPlace`): the area a place has is the first of its Region, its token
 * and its map; a trap or hazard dragged onto a place adds a thing with the
 * drop's point, onto a bare Region makes the place first, and a sheet drop has
 * no point. Every name here is this file's own invention.
 */
import assert from "node:assert/strict";

let checks = 0;
const eq = (a, b, msg) => {
  assert.deepEqual(a, b, msg);
  checks++;
};

class ForcedReplacement {
  constructor(value) {
    this.value = value;
  }
  static create(value) {
    return new ForcedReplacement(value);
  }
}
class Values extends Map {
  [Symbol.iterator]() {
    return this.values();
  }
}
const setPath = (target, path, value) => {
  const keys = path.split(".");
  let at = target;
  for (const k of keys.slice(0, -1)) at = at[k] ??= {};
  at[keys.at(-1)] = value instanceof ForcedReplacement ? structuredClone(value.value) : structuredClone(value);
};
const doc = (extra) => ({
  flags: {},
  getFlag(scope, key) {
    return this.flags?.[scope]?.[key];
  },
  async update(changes) {
    for (const [path, value] of Object.entries(changes)) setPath(this, path, value);
  },
  ...extra,
});

const { LOCATION_TYPE, SCENE_LINK_FLAG } = await import("../scripts/location/constants.mjs");
const { MODULE_ID } = await import("../scripts/lib/constants.mjs");
const { HAZARD_ITEM_TYPE, TRAP_ITEM_TYPE } = await import("../scripts/formation/constants.mjs");
const { CONDITION_HAZARDS } = await import("../scripts/formation/hazard-keys.mjs");

const scene = { id: "s1", documentName: "Scene", uuid: "Scene.s1", grid: { size: 100 }, tokens: new Values(), regions: new Values(), flags: {} };
scene.getFlag = (_s, key) => (key === SCENE_LINK_FLAG ? mapPlace.uuid : undefined);
const location = (id, system = {}) => doc({ id, uuid: `Actor.${id}`, documentName: "Actor", type: LOCATION_TYPE, name: id, system });
const regionPlace = location("rp", { regionUuid: "Region.r1" });
const tokenPlace = location("tp");
const mapPlace = location("mp", { sceneUuid: "Scene.s1" });
const actors = [regionPlace, tokenPlace, mapPlace];
const box = (x0, y0, x1, y1) => ({ testPoint: ({ x, y }) => x >= x0 && x <= x1 && y >= y0 && y <= y1 });
const region = (id, shape, extra = {}) => ({ id, documentName: "Region", uuid: `Region.${id}`, parent: scene, behaviors: new Set(), area: (shape.x1 - shape.x0) * (shape.y1 - shape.y0), flags: {}, getFlag() { return undefined; }, ...box(shape.x0, shape.y0, shape.x1, shape.y1), ...extra });
const r1 = region("r1", { x0: 0, y0: 0, x1: 200, y1: 200 }, { getFlag: () => regionPlace.uuid });
scene.regions.set("r1", r1);
scene.tokens.set("tok1", { id: "tok1", actorId: "rp", hidden: false, x: 5000, y: 5000, width: 1, height: 1, elevation: 0, parent: scene, actor: regionPlace });
scene.tokens.set("tok2", { id: "tok2", actorId: "tp", hidden: false, x: 1000, y: 1000, width: 1, height: 1, elevation: 0, parent: scene, actor: tokenPlace });

const asked = [];
globalThis.game = {
  user: { isGM: true },
  i18n: { localize: (k) => k, format: (k) => k },
  actors: { filter: (fn) => actors.filter(fn), get: (id) => actors.find((a) => a.id === id) },
};
globalThis.ui = { notifications: { warn: (m) => asked.push(m), info() {} } };
globalThis.Hooks = { on() {}, once() {} };
globalThis.foundry = { data: { operators: { ForcedReplacement } }, utils: { deepClone: (v) => structuredClone(v) } };
const docs = { "Region.r1": r1, "Scene.s1": scene };
globalThis.fromUuidSync = (uuid) => docs[uuid] ?? null;
const items = {
  "Item.trap": { documentName: "Item", type: TRAP_ITEM_TYPE, uuid: "Item.trap" },
  "Item.cond": { documentName: "Item", type: HAZARD_ITEM_TYPE, uuid: "Item.cond", system: { key: CONDITION_HAZARDS[0] } },
  "Item.sword": { documentName: "Item", type: "weapon", uuid: "Item.sword" },
};
globalThis.fromUuid = async (uuid) => items[uuid] ?? null;
globalThis.acksExtras = {};

const { placesAround } = await import("../scripts/location/places-around.mjs");
const { registerHazardThingKinds } = await import("../scripts/formation/hazard-things.mjs");
const { dropOnMapPlace, dropOnRegionPlace } = await import("../scripts/formation/region-place-row.mjs");
const { thingsOf } = await import("../scripts/lib/place-things.mjs");
registerHazardThingKinds();

const holds = (point) => placesAround(point, scene).map((p) => [p.place.id, p.area]);

/* --- the area is the first of the Region, the token and the map --- */
eq(holds({ x: 50, y: 50 }), [["rp", "region"], ["mp", "map"]], "a point in a place's Region is held by that place through the Region, and by the map's place");
eq(holds({ x: 5050, y: 5050 }), [["mp", "map"]], "a place with a Region is not held through its token: the Region is its area");
eq(holds({ x: 1100, y: 1100 }), [["tp", "token"], ["mp", "map"]], "a place with no Region is held through its token's footprint");
eq(holds({ x: 3000, y: 3000 }), [["mp", "map"]], "a place with neither is held through its linked map");
eq(holds({ x: 300, y: 300 }).some(([id]) => id === "rp"), false, "a point outside the Region is not held by its place");
eq(holds({ x: Number.NaN, y: 1 }), [], "a point that is not a point holds nothing");
eq(placesAround({ x: 1, y: 1 }, null), [], "no scene holds nothing");
eq(placesAround({ id: "t", x: 0, y: 0, width: 1, height: 1, parent: scene }, scene).map((p) => p.place.id), ["rp", "mp"], "a token is asked by its centre");

/* --- a drop onto a place --- */
const around = (point, sc) => placesAround(point, sc);
const scenes = { locationOfRegion: (r) => (r === r1 ? regionPlace : null), createLocationForRegion: null };
const dropOn = (uuid, x, y, over = {}) => dropOnMapPlace({ scene, data: { type: "Item", uuid, x, y }, scenes, around, ...over });

{
  const list = await dropOn("Item.cond", 50, 50);
  eq(list.length, 1, "a hazard dropped on a place's Region adds a thing");
  eq([list[0].kind, list[0].ref, list[0].point], ["condition", "Item.cond", { x: 50, y: 50 }], "its point is where the map drop landed");
  eq(thingsOf(regionPlace).length, 1, "and it is on the place that holds the point");
  eq(thingsOf(mapPlace).length, 0, "not on the map's place that also holds it");

  const sheet = await dropOnRegionPlace({ region: r1, scenes, data: { type: "Item", uuid: "Item.cond" } });
  eq(sheet.at(-1).point, null, "a drop in the Region window has no point");

  eq(await dropOn("Item.sword", 50, 50), null, "an Item no kind accepts is left alone");
  eq(asked.length, 0, "without a word");
  eq(await dropOn("Item.trap", 50, 50), null, "a trap is the wall assignment's first: this row's hook never takes one");
  const trap = await dropOn("Item.trap", 50, 50, { includeTraps: true });
  eq([trap.at(-1).kind, trap.at(-1).hidden, trap.at(-1).point], ["trap", true, { x: 50, y: 50 }], "but the trap drop's fallback does, hidden, with its point");
  eq(await dropOn("Item.cond", Number.NaN, 1), null, "a drop with no point is not a map drop");
}

/* --- a bare Region --- */
{
  const bare = region("r2", { x0: 2000, y0: 2000, x1: 2400, y1: 2400 });
  const wide = region("r3", { x0: 1900, y0: 1900, x1: 3900, y1: 3900 });
  const zone = region("r4", { x0: 2100, y0: 2100, x1: 2200, y1: 2200 }, { behaviors: new Set(["b"]) });
  for (const r of [wide, bare, zone]) scene.regions.set(r.id, r);
  const made = [];
  const quiet = {
    locationOfRegion: (r) => (r === r1 ? regionPlace : made.find((m) => m.region === r)?.place ?? null),
    createLocationForRegion: async (r, opts) => {
      const place = location(`made-${r.id}`, { regionUuid: r.uuid });
      r.getFlag = () => place.uuid;
      docs[r.uuid] = r;
      made.push({ region: r, place, opts });
      actors.push(place);
      return place;
    },
  };
  const nothing = () => [];
  const list = await dropOnMapPlace({ scene, data: { type: "Item", uuid: "Item.trap", x: 2150, y: 2150 }, includeTraps: true, scenes: quiet, around: nothing });
  eq([made.length, made[0].region.id, made[0].opts], [1, "r2", { render: false }], "a trap dropped on a bare Region makes its place, without opening it: the smallest bare Region wins");
  eq([list.length, list[0].point, thingsOf(made[0].place).length], [1, { x: 2150, y: 2150 }, 1], "and adds the thing, point set");
  const again = await dropOnMapPlace({ scene, data: { type: "Item", uuid: "Item.cond", x: 2160, y: 2160 }, scenes: quiet, around });
  eq([made.length, again.length], [1, 2], "a second drop on the same Region goes to the place already made");
  eq(await dropOnMapPlace({ scene, data: { type: "Item", uuid: "Item.cond", x: 2150, y: 2150 }, scenes: { ...quiet, locationOfRegion: () => regionPlace }, around: nothing }) === null, true, "a Region that already has a place is not a bare one");

  const zoneOnly = await dropOnMapPlace({ scene, data: { type: "Item", uuid: "Item.cond", x: 2150, y: 2150 }, scenes: { ...quiet, locationOfRegion: (r) => (r.id === "r4" ? null : regionPlace) }, around: nothing });
  eq(zoneOnly, null, "a Region that carries a behavior is another feature's and makes no place");
  asked.length = 0;
  eq(await dropOnMapPlace({ scene, data: { type: "Item", uuid: "Item.cond", x: 9000, y: 9000 }, scenes: quiet, around: nothing }), null, "a hazard dropped on nothing writes nothing");
  eq(asked.length, 1, "and says so");
  asked.length = 0;
  await dropOnMapPlace({ scene, data: { type: "Item", uuid: "Item.trap", x: 9000, y: 9000 }, includeTraps: true, scenes: quiet, around: nothing });
  eq(asked.length, 0, "a trap dropped on nothing leaves the wording to the trap drop");
}

void MODULE_ID;
console.log(`test-scene-drop: ${checks} checks passed`);
