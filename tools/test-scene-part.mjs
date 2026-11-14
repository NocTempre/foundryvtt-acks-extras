/**
 * Offline tests for a scene that is one of several of its place
 * (`scripts/location/scene-link.mjs`, `isScenePart`): it names the place it is
 * at, so a party standing on it is at the place, and it is never the map the
 * place opens. Five places could write or clear the place's `sceneUuid`
 * mirror; each is driven here with the place's own map already mirrored, and
 * must leave that mirror alone for a part and keep writing it for a plain
 * scene. Every place and scene is invented.
 *
 * Run: node tools/test-scene-part.mjs
 */
import assert from "node:assert/strict";

const handlers = {};
globalThis.Hooks = { on: (name, fn) => { (handlers[name] ??= []).push(fn); } };
class ForcedDeletion {}
const get = (object, path) => path.split(".").reduce((node, key) => node?.[key], object);
globalThis.foundry = {
  data: { operators: { ForcedDeletion } },
  utils: { getProperty: get, hasProperty: (object, path) => get(object, path) !== undefined },
};

const MODULE = "acks-extras";
const writes = [];
const place = {
  id: "PlaceActor000001", uuid: "Actor.PlaceActor000001", type: "acks-extras.location", system: { sceneUuid: "Scene.OwnMap" },
  update(patch) { writes.push(patch); Object.assign(this.system, { sceneUuid: patch["system.sceneUuid"] }); return Promise.resolve(this); },
};
globalThis.game = {
  user: { isGM: true }, userId: "u1", system: { id: "acks" },
  actors: { get: (id) => (id === place.id ? place : undefined), filter: (fn) => [place].filter(fn) },
  scenes: [],
};
globalThis.Actor = { updateDocuments: async (updates) => { writes.push(...updates); } };

const { mirrorCreatedLinks, linkScene, unlinkScene, isScenePart, registerSceneLinkSync } = await import("../scripts/location/scene-link.mjs");
registerSceneLinkSync();

/** A scene document holding the module's flags; `part` makes it a part of its place. */
const sceneOf = (uuid, { part = 0, link = place.uuid } = {}) => {
  const flags = { ...(link ? { location: link } : {}), ...(part ? { scenePart: part } : {}) };
  return {
    uuid, regions: [], flags,
    getFlag: (scope, key) => (scope === MODULE ? flags[key] : undefined),
    setFlag: async (scope, key, value) => { flags[key] = value; },
    unsetFlag: async (scope, key) => { delete flags[key]; },
  };
};
const reset = () => { writes.length = 0; place.system.sceneUuid = "Scene.OwnMap"; };
const fire = (name, ...args) => Promise.all((handlers[name] ?? []).map((fn) => fn(...args)));
let n = 0;
const t = async (name, fn) => { reset(); await fn(); n++; console.log(`ok - ${name}`); };

await t("a scene is a part by its flag alone", () => {
  assert.equal(isScenePart(sceneOf("Scene.A", { part: 1 })), true);
  assert.equal(isScenePart(sceneOf("Scene.A")), false);
  assert.equal(isScenePart(null), false);
});

await t("a plain scene created linked is its place's mirror", async () => {
  place.system.sceneUuid = "";
  assert.equal(await mirrorCreatedLinks(sceneOf("Scene.Plain")), 1);
  assert.deepEqual(writes, [{ _id: place.id, "system.sceneUuid": "Scene.Plain" }]);
});

await t("a part created linked writes no mirror, so the place keeps its own map", async () => {
  assert.equal(await mirrorCreatedLinks(sceneOf("Scene.Part", { part: 1 })), 0);
  assert.deepEqual(writes, []);
  assert.equal(place.system.sceneUuid, "Scene.OwnMap");
});

await t("linking a part sets its flag and touches no place", async () => {
  const part = sceneOf("Scene.Part", { part: 2, link: "" });
  assert.equal(await linkScene(part, place), true);
  assert.equal(part.getFlag(MODULE, "location"), place.uuid);
  assert.deepEqual(writes, []);
});

await t("re-linking a part from another place clears nobody's mirror", async () => {
  const part = sceneOf("Scene.Part", { part: 2 });
  await linkScene(part, { ...place, uuid: "Actor.Other", update: async () => { throw new Error("written"); } });
  assert.deepEqual(writes, []);
  assert.equal(place.system.sceneUuid, "Scene.OwnMap");
});

await t("linking a plain scene still writes both ends", async () => {
  const plain = sceneOf("Scene.Plain", { link: "" });
  await linkScene(plain, place);
  assert.equal(place.system.sceneUuid, "Scene.Plain");
});

await t("unlinking a part clears its flag and leaves the place's own map mirrored", async () => {
  const part = sceneOf("Scene.Part", { part: 1 });
  assert.equal(await unlinkScene(part), true);
  assert.equal(part.getFlag(MODULE, "location"), undefined);
  assert.deepEqual(writes, []);
  assert.equal(place.system.sceneUuid, "Scene.OwnMap");
});

await t("unlinking a plain scene still clears the place's mirror", async () => {
  await unlinkScene(sceneOf("Scene.Plain"));
  assert.equal(place.system.sceneUuid, "");
});

await t("a changed link flag on a part moves no mirror; on a plain scene it does", async () => {
  const changes = { flags: { [MODULE]: { location: place.uuid } } };
  await fire("updateScene", sceneOf("Scene.Part", { part: 1 }), changes, {}, "u1");
  assert.deepEqual(writes, []);
  place.system.sceneUuid = "";
  await fire("updateScene", sceneOf("Scene.Plain"), changes, {}, "u1");
  assert.equal(place.system.sceneUuid, "Scene.Plain");
});

console.log(`scene-part: ${n} checks OK`);
