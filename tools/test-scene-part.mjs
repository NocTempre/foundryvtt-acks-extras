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
/**
 * Foundry's answer for a document: a Judge owns every one, a Player owns the
 * ones `playerOwns` names. The tests below run as the Judge unless a test calls
 * `asPlayer()`.
 */
const withOwnership = (doc) => Object.defineProperty(doc, "isOwner", { get() { return game.user.isGM || this.playerOwns; }, enumerable: true });
/** A place actor whose `update` writes its `system` keys and records the write. */
const placeOf = (id, system, owned) => withOwnership({
  id, uuid: `Actor.${id}`, type: "acks-extras.location", system, playerOwns: owned,
  update(patch) {
    writes.push(patch);
    for (const [key, value] of Object.entries(patch)) if (key.startsWith("system.")) this.system[key.slice(7)] = value;
    ops.push(`mirror ${Object.values(patch)[0]}`);
    return Promise.resolve(this);
  },
});
const place = placeOf("PlaceActor000001", { sceneUuid: "Scene.OwnMap" }, false);
/** Another place a scene or region can name, answering `game.actors.get` beside `place`. */
const others = new Map();
const otherPlace = (id, { owned = false } = {}) => {
  const other = placeOf(id, { sceneUuid: "", regionUuid: "" }, owned);
  others.set(id, other);
  return other;
};
/** Every write in the order made, so a test can say which end let go first. */
const ops = [];
/** The documents `fromUuidSync` resolves: each scene and region a test builds. */
const docs = new Map();
const warned = [];
globalThis.fromUuidSync = (uuid) => docs.get(uuid) ?? null;
globalThis.ui = { notifications: { warn: (text) => warned.push(text) } };
globalThis.game = {
  user: { isGM: true }, userId: "u1", system: { id: "acks" },
  i18n: { localize: (key) => key },
  actors: {
    get: (id) => (id === place.id ? place : others.get(id)),
    filter: (fn) => [place, ...others.values()].filter(fn),
  },
  scenes: [],
};
const asPlayer = () => { game.user.isGM = false; };
globalThis.Actor = { updateDocuments: async (updates) => { writes.push(...updates); } };

const { mirrorCreatedLinks, linkScene, linkRegion, unlinkScene, unlinkRegion, isScenePart, registerSceneLinkSync } = await import("../scripts/location/scene-link.mjs");
registerSceneLinkSync();

/** A document of this name holding the module's flags, resolvable by its uuid. */
const flagged = (documentName, uuid, flags, owned = false) => {
  const doc = withOwnership({
    documentName, uuid, regions: [], flags, playerOwns: owned,
    getFlag: (scope, key) => (scope === MODULE ? flags[key] : undefined),
    setFlag: async (scope, key, value) => { flags[key] = value; ops.push(`set ${uuid}`); },
    unsetFlag: async (scope, key) => { delete flags[key]; ops.push(`unset ${uuid}`); },
  });
  docs.set(uuid, doc);
  return doc;
};
/** A scene document holding the module's flags; `part` makes it a part of its place, `owned` a Player's OWNER. */
const sceneOf = (uuid, { part = 0, link = place.uuid, owned = false } = {}) =>
  flagged("Scene", uuid, { ...(link ? { location: link } : {}), ...(part ? { scenePart: part } : {}) }, owned);
/** A Region document whose link flag names `link`. */
const regionOf = (uuid, { link = place.uuid, owned = false } = {}) => flagged("Region", uuid, link ? { location: link } : {}, owned);
const reset = () => {
  writes.length = 0; ops.length = 0; docs.clear(); others.clear(); warned.length = 0;
  game.user.isGM = true;
  place.playerOwns = false;
  place.system.sceneUuid = "Scene.OwnMap"; place.system.regionUuid = "";
};
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

/* ------------------------------------------------------------------ */
/*  Who may write the link: every document it writes, by ownership      */
/* ------------------------------------------------------------------ */

/** What a refused link leaves: no write, one warning, and the false answer. */
const refused = (answer) => {
  assert.equal(answer, false);
  assert.deepEqual(writes, []);
  assert.equal(ops.length, 0);
  assert.deepEqual(warned, ["ACKS-LOCATION.place.linkNotOwner"]);
};
/** Clear the record between a refusal and the grant that follows it. */
const again = () => { writes.length = 0; ops.length = 0; warned.length = 0; };

await t("a Player who owns the scene and the place links them, writing both ends", async () => {
  asPlayer();
  place.playerOwns = true;
  place.system.sceneUuid = "";
  const scene = sceneOf("Scene.Mine", { link: "", owned: true });
  assert.equal(await linkScene(scene, place), true);
  assert.equal(scene.getFlag(MODULE, "location"), place.uuid);
  assert.equal(place.system.sceneUuid, "Scene.Mine");
  assert.deepEqual(warned, []);
});

await t("a Player who owns the scene and not the place is refused, and nothing is written", async () => {
  asPlayer();
  const scene = sceneOf("Scene.Mine", { link: "", owned: true });
  refused(await linkScene(scene, place));
  assert.equal(scene.getFlag(MODULE, "location"), undefined);
});

await t("a Player who owns the place and not the scene is refused", async () => {
  asPlayer();
  place.playerOwns = true;
  const scene = sceneOf("Scene.Theirs", { link: "" });
  refused(await linkScene(scene, place));
  assert.equal(place.system.sceneUuid, "Scene.OwnMap");
});

await t("a link that clears the previous place's mirror needs that place too", async () => {
  asPlayer();
  place.playerOwns = true;
  const previous = otherPlace("PreviousPlace0001");
  previous.system.sceneUuid = "Scene.Mine";
  const scene = sceneOf("Scene.Mine", { link: previous.uuid, owned: true });
  refused(await linkScene(scene, place));
  assert.equal(scene.getFlag(MODULE, "location"), previous.uuid);
  assert.equal(previous.system.sceneUuid, "Scene.Mine");
  previous.playerOwns = true;
  again();
  assert.equal(await linkScene(scene, place), true);
  assert.equal(previous.system.sceneUuid, "");
  assert.equal(place.system.sceneUuid, "Scene.Mine");
});

await t("a link that lets the place's old map go needs that scene too", async () => {
  asPlayer();
  place.playerOwns = true;
  const own = sceneOf("Scene.OwnMap");
  const next = sceneOf("Scene.Next", { link: "", owned: true });
  refused(await linkScene(next, place));
  assert.equal(own.getFlag(MODULE, "location"), place.uuid);
  assert.equal(place.system.sceneUuid, "Scene.OwnMap");
  own.playerOwns = true;
  again();
  assert.equal(await linkScene(next, place), true);
  assert.equal(own.getFlag(MODULE, "location"), undefined);
});

await t("relinking a place to its own map lets nothing go, so its old end is not asked for", async () => {
  asPlayer();
  place.playerOwns = true;
  const own = sceneOf("Scene.OwnMap", { owned: true });
  assert.equal(await linkScene(own, place), true);
  assert.deepEqual(warned, []);
});

await t("a part scene writes its flag alone, so it needs the scene and not the place", async () => {
  asPlayer();
  const part = sceneOf("Scene.Part", { part: 1, link: "", owned: true });
  assert.equal(await linkScene(part, place), true);
  assert.equal(part.getFlag(MODULE, "location"), place.uuid);
  assert.deepEqual(writes, []);
  const theirs = sceneOf("Scene.TheirPart", { part: 1, link: "" });
  again();
  refused(await linkScene(theirs, place));
  assert.equal(theirs.getFlag(MODULE, "location"), undefined);
});

await t("a Judge passes every link, owning every document", async () => {
  const scene = sceneOf("Scene.Next", { link: "" });
  assert.equal(await linkScene(scene, place), true);
  assert.deepEqual(warned, []);
});

await t("a missing scene or place is no link and no warning", async () => {
  asPlayer();
  assert.equal(await linkScene(null, place), false);
  assert.equal(await linkScene(sceneOf("Scene.Mine", { owned: true }), null), false);
  assert.equal(await unlinkScene(null), false);
  assert.deepEqual(warned, []);
});

await t("unlinking needs the scene and the place it names", async () => {
  asPlayer();
  place.playerOwns = true;
  const theirs = sceneOf("Scene.OwnMap");
  refused(await unlinkScene(theirs));
  assert.equal(theirs.getFlag(MODULE, "location"), place.uuid);
  place.playerOwns = false;
  const mine = sceneOf("Scene.OwnMap", { owned: true });
  again();
  refused(await unlinkScene(mine));
  assert.equal(mine.getFlag(MODULE, "location"), place.uuid);
  assert.equal(place.system.sceneUuid, "Scene.OwnMap");
  place.playerOwns = true;
  again();
  assert.equal(await unlinkScene(mine), true);
  assert.equal(mine.getFlag(MODULE, "location"), undefined);
  assert.equal(place.system.sceneUuid, "");
});

await t("unlinking a part scene needs the scene alone", async () => {
  asPlayer();
  const part = sceneOf("Scene.Part", { part: 1, owned: true });
  assert.equal(await unlinkScene(part), true);
  assert.equal(part.getFlag(MODULE, "location"), undefined);
  assert.equal(place.system.sceneUuid, "Scene.OwnMap");
});

await t("a Region link needs the region, the place, the previous place and the held Region", async () => {
  asPlayer();
  const region = regionOf("Scene.S.Region.Mine", { link: "", owned: true });
  refused(await linkRegion(region, place));
  place.playerOwns = true;
  const held = regionOf("Scene.S.Region.Held");
  place.system.regionUuid = held.uuid;
  again();
  refused(await linkRegion(region, place));
  assert.equal(held.getFlag(MODULE, "location"), place.uuid);
  held.playerOwns = true;
  const previous = otherPlace("PreviousPlace0002");
  previous.system.regionUuid = region.uuid;
  region.flags.location = previous.uuid;
  again();
  refused(await linkRegion(region, place));
  assert.equal(previous.system.regionUuid, region.uuid);
  previous.playerOwns = true;
  again();
  assert.equal(await linkRegion(region, place), true);
  assert.equal(previous.system.regionUuid, "");
  assert.equal(place.system.regionUuid, region.uuid);
  assert.equal(held.getFlag(MODULE, "location"), undefined);
});

await t("unlinking a Region needs the region and the place it names", async () => {
  asPlayer();
  const region = regionOf("Scene.S.Region.Mine", { owned: true });
  place.system.regionUuid = region.uuid;
  refused(await unlinkRegion(region));
  assert.equal(region.getFlag(MODULE, "location"), place.uuid);
  place.playerOwns = true;
  again();
  assert.equal(await unlinkRegion(region), true);
  assert.equal(place.system.regionUuid, "");
  assert.equal(region.getFlag(MODULE, "location"), undefined);
});

console.log(`scene-part: ${n} checks OK`);
