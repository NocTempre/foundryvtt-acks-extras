/**
 * The classes registry's publication (classes/registry.mjs): the class tables
 * are published from the library's class documents read through the shelves'
 * indexes (`libraryDocsWhere`), at `ready` and again when a class item changes.
 *
 * A shelf here is `lib-shelf-mock.mjs`'s stand-in for a compendium, which keeps
 * core's behaviour where it matters: a cold shelf holds no document, a query
 * names its ids, and an evicted shelf holds only what was read since. Every key,
 * figure and id below is this file's own invention.
 */
import assert from "node:assert/strict";

globalThis.CONFIG = { Item: { compendiumIndexFields: [] } };
globalThis.game = { items: [], packs: [], ready: false, settings: { get: () => undefined }, i18n: { has: () => false, localize: (x) => x, format: (k) => k }, modules: { get: () => ({ active: false }) } };
globalThis.acksExtras ??= {};

let passed = 0;
const ok = async (name, fn) => {
  await fn();
  passed++;
  console.log("ok   " + name);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const handlers = {};
globalThis.Hooks = {
  on: (name, fn) => (handlers[name] ??= []).push(fn),
  once: (name, fn) => (handlers[`once:${name}`] ??= []).push(fn),
  callAll() {},
};

const registry = await import("../scripts/classes/registry.mjs");
const tables = await import("../scripts/lib/tables.mjs");
const lib = await import("../scripts/lib/library.mjs");
const weaponRows = await import("../scripts/equipment/weapon-rows.mjs");
const { CLASS_TYPE, PROGRESSIONS_DOC_ID, CLASS_DOC_PREFIX } = await import("../scripts/classes/constants.mjs");
const { shelfMock, sourceDoc } = await import("./lib-shelf-mock.mjs");
lib.declareLibraryIndexFields();

const classSystem = (key, throwAt) => ({
  key,
  source: { book: "rr", cite: "Invented p. 1" },
  saves: [{ minLevel: 1, maxLevel: 4, paralysis: 11, death: 12, blast: 13, implements: 14, spells: 15 }],
  attack: [{ minLevel: 1, maxLevel: 4, throw: throwAt }],
  ladders: [],
});
const classDoc = (id, key, throwAt) => sourceDoc(id, `Class ${key}`, CLASS_TYPE, null, classSystem(key, throwAt));
const filler = () => Array.from({ length: 25 }, (_, i) => sourceDoc(`f${i}`, `Filler ${i}`, "equipment"));
const makeShelf = () => shelfMock({ docs: [...filler(), classDoc("c1", "fighter", 9), classDoc("c2", "thief", 8), classDoc("c3", "tinkerer", 7)] });
const progressions = () => tables.getLayer(PROGRESSIONS_DOC_ID, tables.PRIORITY.WORLD)?.tables ?? null;
const published = () => ["fighter", "thief", "tinkerer"].filter((key) => tables.getLayer(`${CLASS_DOC_PREFIX}${key}`, tables.PRIORITY.WORLD));
const bare = (shelf) => shelf.calls.getDocuments.filter((query) => !query?._id__in).length;
const readyHook = () => handlers["once:ready"].at(-1)();
const itemHook = (name, doc) => handlers[name].at(-1)(doc);
const wipe = () => {
  for (const id of [PROGRESSIONS_DOC_ID, ...["fighter", "thief", "tinkerer"].map((k) => `${CLASS_DOC_PREFIX}${k}`)]) tables.unregisterTable(id, { priority: tables.PRIORITY.WORLD });
};

await ok("publish takes the documents it is given, so what the library holds does not matter", () => {
  game.items = [];
  const count = registry.publish([{ ...classDoc("x1", "fighter", 9), id: "x1" }, { ...classDoc("x2", "tinkerer", 7), id: "x2" }]);
  assert.equal(count, 3, "the chassis progressions and two class documents");
  assert.deepEqual(Object.keys(progressions()), ["fighter"], "the chassis comes from the list, not from the library's held documents");
  assert.deepEqual(published(), ["fighter", "tinkerer"]);
  wipe();
});

const shelf = makeShelf();
await ok("the first publication reads the class documents by id from the index, and loads no whole shelf", async () => {
  game.packs = [shelf];
  game.ready = false;
  registry.registerRegistryHooks();
  let landed = false;
  registry.whenPublished().then(() => (landed = true));
  game.ready = true;
  await sleep(5);
  assert.equal(landed, false, "a pass that waits on the registry waits until the publication");
  const reading = readyHook();
  assert.equal(shelf.calls.getIndex.length, 1, "the read begins before the hook's first await, so the warm's macrotask sees it");
  await reading;
  await registry.whenPublished();
  assert.deepEqual(published(), ["fighter", "thief", "tinkerer"]);
  assert.deepEqual(Object.keys(progressions()).sort(), ["fighter", "thief"]);
  assert.equal(bare(shelf), 0, "no whole-shelf load");
  assert.deepEqual(shelf.calls.getDocuments[0]._id__in.slice().sort(), ["c1", "c2", "c3"], "only the class documents were loaded");
  assert.ok(globalThis.performance.getEntriesByName(registry.CLASS_MARK_PUBLISHED).length >= 1, "the publication is marked for the timing script");
});

await ok("after the cache lifetime evicts the shelf, one class's edit still publishes every class", async () => {
  shelf.evict();
  await shelf.getDocuments({ _id__in: ["c2"] });
  assert.equal(shelf.contents.length, 1);
  shelf.calls.getIndex.length = 0;
  shelf.calls.getDocuments.length = 0;
  const held = shelf.get("c2");
  held.system.attack[0].throw = 5;
  itemHook("updateItem", held);
  await sleep(registry.CLASS_REREAD_MS * 4);
  assert.deepEqual(published(), ["fighter", "thief", "tinkerer"], "the classes that were not held are republished too");
  assert.deepEqual(Object.keys(progressions()).sort(), ["fighter", "thief"], "and the chassis tables are whole");
  assert.equal(tables.getTable(`${CLASS_DOC_PREFIX}thief`, "attack")[0].throw, 5);
  assert.ok(shelf.calls.getDocuments.every((query) => Array.isArray(query?._id__in)));
});

await ok("a burst of class hooks is one index read", async () => {
  await sleep(registry.CLASS_REREAD_MS * 2);
  shelf.calls.getIndex.length = 0;
  const docs = ["c1", "c2", "c3"].map((id) => shelf.get(id));
  for (const doc of docs) itemHook("updateItem", doc);
  itemHook("updateItem", docs[0]);
  await sleep(registry.CLASS_REREAD_MS * 4);
  assert.equal(shelf.calls.getIndex.length, 1);
});

await ok("a class on an actor, and an item that is no class, move nothing", async () => {
  shelf.calls.getIndex.length = 0;
  itemHook("createItem", { ...shelf.get("c1"), parent: { documentName: "Actor" } });
  itemHook("createItem", { type: "weapon", id: "w1" });
  await sleep(registry.CLASS_REREAD_MS * 4);
  assert.equal(shelf.calls.getIndex.length, 0);
});

await ok("a delete's hook leaves its class out though the index still lists it", async () => {
  itemHook("deleteItem", shelf.get("c3"));
  await sleep(registry.CLASS_REREAD_MS * 4);
  assert.deepEqual(published(), ["fighter", "thief"]);
  shelf.index.delete("c3");
});

await ok("a shelf whose read fails leaves the published tables as they were, and the delete heard meanwhile is kept for the next read", async () => {
  const warned = [];
  const saved = console.warn;
  console.warn = (...args) => warned.push(args);
  shelf.failIndex = true;
  itemHook("updateItem", shelf.get("c1"));
  await sleep(registry.CLASS_REREAD_MS * 4);
  assert.deepEqual(published(), ["fighter", "thief"], "no short publication");
  assert.ok(warned.some((args) => String(args[0]).includes("kept as published")));
  itemHook("deleteItem", shelf.get("c2"));
  await sleep(registry.CLASS_REREAD_MS * 4);
  assert.deepEqual(published(), ["fighter", "thief"], "a failed read changes nothing");
  shelf.failIndex = false;
  itemHook("updateItem", shelf.get("c1"));
  await sleep(registry.CLASS_REREAD_MS * 4);
  assert.deepEqual(published(), ["fighter"], "the next good read leaves out the class deleted during the failure");
  console.warn = saved;
});

await ok("a steady stream of hooks is read at the cap, not when the stream ends", async () => {
  assert.ok(registry.CLASS_REREAD_MAX_MS > registry.CLASS_REREAD_MS);
  shelf.calls.getIndex.length = 0;
  const began = Date.now();
  let seen = 0;
  while (Date.now() - began < registry.CLASS_REREAD_MAX_MS + 300) {
    itemHook("updateItem", shelf.get("c1"));
    await sleep(Math.max(1, Math.floor(registry.CLASS_REREAD_MS / 2)));
    if (!seen && shelf.calls.getIndex.length) seen = Date.now() - began;
  }
  assert.ok(seen > 0 && seen < registry.CLASS_REREAD_MAX_MS + 200, `a read ran during the stream (at ${seen} ms)`);
  await sleep(registry.CLASS_REREAD_MS * 4);
});

await ok("a first publication from a failed read is marked incomplete, and the next good publication clears it", async () => {
  wipe();
  for (const name of Object.keys(handlers)) handlers[name].length = 0;
  const broken = makeShelf();
  broken.failIndex = true;
  game.packs = [broken];
  game.items = [{ ...classDoc("x1", "fighter", 9), id: "x1", type: CLASS_TYPE }];
  game.ready = false;
  const saved = console.warn;
  const warned = [];
  console.warn = (...args) => warned.push(args);
  registry.registerRegistryHooks();
  game.ready = true;
  await readyHook();
  console.warn = saved;
  assert.equal(registry.publicationIncomplete(), true);
  assert.deepEqual(published(), ["fighter"], "what answered is published, so the sheet works");
  assert.ok(warned.some((args) => String(args[0]).includes(broken.collection) && String(args[0]).includes("left as they stand")), "one warning names the shelf");
  broken.failIndex = false;
  game.items = [];
  itemHook("updateItem", { id: "c1", type: CLASS_TYPE });
  await sleep(registry.CLASS_REREAD_MS * 4);
  assert.equal(registry.publicationIncomplete(), false);
  assert.deepEqual(published(), ["fighter", "thief", "tinkerer"]);
});

await ok("at startup the class registry and the weapon rows share one index read of the Item shelf, and the warm goes after both", async () => {
  wipe();
  tables.unregisterTable("weapons");
  for (const name of Object.keys(handlers)) handlers[name].length = 0;
  const blade = sourceDoc("w1", "Invented blade", "weapon", "def.weapon.invented", {
    melee: true,
    missile: false,
    size: "small",
    special: {},
    damage: { base: { formula: "1d1", types: [] }, alternate: { formula: "" } },
  });
  const startup = shelfMock({ docs: [...filler(), blade, classDoc("c1", "fighter", 9), classDoc("c2", "thief", 8), classDoc("c3", "tinkerer", 7)] });
  game.packs = [startup];
  game.items = [];
  game.ready = false;
  registry.registerRegistryHooks();
  weaponRows.registerWeaponRows();
  game.ready = true;
  const bothHooks = handlers["once:ready"].map((fn) => fn());
  const warming = lib.registerLibraryWarm();
  await Promise.all([...bothHooks, warming]);
  assert.equal(startup.calls.getIndex.length, 1, "one server pass for both readers");
  const loads = startup.calls.getDocuments;
  const wholeAt = loads.findIndex((query) => !query?._id__in);
  assert.equal(loads.filter((query) => query?._id__in).length, 2, "each reader loaded its own ids");
  assert.ok(wholeAt === loads.length - 1, "the whole-shelf load came after both narrow loads");
  assert.deepEqual(published(), ["fighter", "thief", "tinkerer"]);
});

console.log(`\ntest-class-registry: ${passed} passed`);
