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
  update(patch) {
    writes.push(patch);
    for (const [key, value] of Object.entries(patch)) if (key.startsWith("system.")) this.system[key.slice(7)] = value;
    ops.push(`mirror ${Object.values(patch)[0]}`);
    return Promise.resolve(this);
  },
};
/** Every write in the order made, so a test can say which end let go first. */
const ops = [];
/** The documents `fromUuidSync` resolves: each scene and region a test builds. */
const docs = new Map();
globalThis.fromUuidSync = (uuid) => docs.get(uuid) ?? null;
globalThis.game = {
  user: { isGM: true }, userId: "u1", system: { id: "acks" },
  actors: { get: (id) => (id === place.id ? place : undefined), filter: (fn) => [place].filter(fn) },
  scenes: [],
};
globalThis.Actor = { updateDocuments: async (updates) => { writes.push(...updates); } };

const { mirrorCreatedLinks, linkScene, linkRegion, unlinkScene, isScenePart, registerSceneLinkSync } = await import("../scripts/location/scene-link.mjs");
registerSceneLinkSync();

/** A document of this name holding the module's flags, resolvable by its uuid. */
const flagged = (documentName, uuid, flags) => {
  const doc = {
    documentName, uuid, regions: [], flags,
    getFlag: (scope, key) => (scope === MODULE ? flags[key] : undefined),
    setFlag: async (scope, key, value) => { flags[key] = value; ops.push(`set ${uuid}`); },
    unsetFlag: async (scope, key) => { delete flags[key]; ops.push(`unset ${uuid}`); },
  };
  docs.set(uuid, doc);
  return doc;
};
/** A scene document holding the module's flags; `part` makes it a part of its place. */
const sceneOf = (uuid, { part = 0, link = place.uuid } = {}) =>
  flagged("Scene", uuid, { ...(link ? { location: link } : {}), ...(part ? { scenePart: part } : {}) });
/** A Region document whose link flag names `link`. */
const regionOf = (uuid, { link = place.uuid } = {}) => flagged("Region", uuid, link ? { location: link } : {});
const reset = () => { writes.length = 0; ops.length = 0; docs.clear(); place.system.sceneUuid = "Scene.OwnMap"; place.system.regionUuid = ""; };
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

await t("relinking a place to another plain scene lets its old map go, after the mirror names the new one", async () => {
  const own = sceneOf("Scene.OwnMap");
  const next = sceneOf("Scene.Next", { link: "" });
  assert.equal(await linkScene(next, place), true);
  assert.equal(own.getFlag(MODULE, "location"), undefined);
  assert.equal(next.getFlag(MODULE, "location"), place.uuid);
  assert.equal(place.system.sceneUuid, "Scene.Next");
  assert.ok(ops.indexOf("unset Scene.OwnMap") > ops.indexOf("mirror Scene.Next"));
});

await t("relinking a part leaves the place's own map naming it", async () => {
  const own = sceneOf("Scene.OwnMap");
  await linkScene(sceneOf("Scene.Part", { part: 1, link: "" }), place);
  assert.equal(own.getFlag(MODULE, "location"), place.uuid);
});

await t("relinking a place to its own map lets nothing go", async () => {
  const own = sceneOf("Scene.OwnMap");
  await linkScene(own, place);
  assert.equal(own.getFlag(MODULE, "location"), place.uuid);
  assert.equal(ops.some((op) => op.startsWith("unset")), false);
});

await t("relinking a place to another Region lets its old Region go, after the mirror names the new one", async () => {
  const old = regionOf("Scene.S.Region.Old");
  place.system.regionUuid = old.uuid;
  const next = regionOf("Scene.S.Region.Next", { link: "" });
  assert.equal(await linkRegion(next, place), true);
  assert.equal(old.getFlag(MODULE, "location"), undefined);
  assert.equal(next.getFlag(MODULE, "location"), place.uuid);
  assert.equal(place.system.regionUuid, next.uuid);
  assert.ok(ops.indexOf(`unset ${old.uuid}`) > ops.indexOf(`mirror ${next.uuid}`));
});

await t("a Region whose flag already names another place keeps it", async () => {
  const other = regionOf("Scene.S.Region.Other", { link: "Actor.Other" });
  place.system.regionUuid = other.uuid;
  await linkRegion(regionOf("Scene.S.Region.Next", { link: "" }), place);
  assert.equal(other.getFlag(MODULE, "location"), "Actor.Other");
});

console.log(`scene-part: ${n} checks OK`);
