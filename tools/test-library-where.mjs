/**
 * The library's narrow reader, `libraryDocsWhere` (lib/library.mjs): the world's
 * documents that pass a test, then each shelf's, with one index read per shelf
 * and one `_id__in` load for the documents the shelf has not instantiated.
 *
 * The stand-in shelf behaves as core's compendium collection does where it
 * matters here: its startup index holds core fields only, `getIndex()` with no
 * argument rebuilds the index with the declared `CONFIG.Item.compendiumIndexFields`
 * once, a query returns documents in the SERVER's order (not the index's), and
 * `getDocuments` sets only the documents it did not already hold. Every name and
 * id is this file's own invention.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let passed = 0;
const ok = async (name, fn) => {
  await fn();
  passed++;
  console.log("ok   " + name);
};

globalThis.CONFIG = { Item: { compendiumIndexFields: [] } };
globalThis.game = { items: [], packs: [] };

const lib = await import("../scripts/lib/library.mjs");
const { libraryDocsWhere, declareLibraryIndexFields, libraryCold, cookbookId } = lib;

const STAMP = "flags.acks-extras.cookbook.id";
const { shelfMock: shelf, sourceDoc: source } = await import("./lib-shelf-mock.mjs");

const minted = (type, prefix) => (row) => row.type === type && cookbookId(row).startsWith(prefix);
const isWeapon = minted("weapon", "def.weapon.");
const idsOf = (list) => list.map((d) => d.id);
const withWarnings = async (fn) => {
  const saved = console.warn;
  const warned = [];
  console.warn = (...args) => warned.push(args);
  try {
    return { value: await fn(), warned };
  } finally {
    console.warn = saved;
  }
};

/** Twenty unstamped items around `n` stamped weapons, ids `<tag>1…`. */
const filler = (tag, n) => [
  ...Array.from({ length: 20 }, (_, i) => source(`${tag}f${i}`, `Filler ${tag}${i}`, "equipment")),
  ...Array.from({ length: n }, (_, i) => source(`${tag}w${i}`, `Weapon ${tag}${i}`, "weapon", `def.weapon.${tag}${i}`)),
];

await ok("the stamp field is declared once on the Item index, and only once however often it is asked", () => {
  assert.deepEqual(globalThis.CONFIG.Item.compendiumIndexFields, []);
  declareLibraryIndexFields();
  declareLibraryIndexFields();
  assert.deepEqual(globalThis.CONFIG.Item.compendiumIndexFields, [STAMP, `${STAMP.slice(0, -2)}merged`, "flags.acks-extras.templatePart"]);
});

await ok("module.mjs declares it at init, beside the plate", () => {
  const src = readFileSync(new URL("../scripts/lib/module.mjs", import.meta.url), "utf8");
  const init = src.slice(src.indexOf("CONFIG.Actor.dataModels[ANIMAL_TYPE]"));
  assert.match(init.slice(0, init.indexOf("light.declareLightTables")), /declareLibraryIndexFields\(\)/);
});

await ok("a read is one index read and one id query per shelf, and never loads a whole shelf", async () => {
  const acks = shelf({ docs: filler("a", 3) });
  const lined = shelf({ line: "Sample Line", docs: filler("b", 2) });
  game.packs = [acks, lined];
  game.items = [];
  const found = await libraryDocsWhere("Item", isWeapon);
  assert.deepEqual(idsOf(found), ["aw0", "aw1", "aw2", "bw0", "bw1"]);
  for (const pack of [acks, lined]) {
    assert.equal(pack.calls.getIndex.length, 1);
    assert.equal(pack.calls.getDocuments.length, 1);
    assert.ok(pack.calls.getDocuments[0]?._id__in, "the one load names its ids");
  }
  assert.deepEqual(acks.calls.getDocuments[0]._id__in, ["aw0", "aw1", "aw2"]);
  assert.deepEqual(acks.calls.getIndex[0], [], "the index is asked with no argument, so the declared fields are the ones carried");
  assert.equal(libraryCold(), true, "a narrow read leaves the shelf cold: the whole-shelf load is the warm's");
});

await ok("matches come back in index order though the server answers in its own", async () => {
  const pack = shelf({ docs: filler("a", 4) });
  game.packs = [pack];
  const found = await libraryDocsWhere("Item", isWeapon);
  assert.deepEqual(idsOf(found), ["aw0", "aw1", "aw2", "aw3"]);
});

await ok("the world's documents that pass come first, and a world document that fails is left out", async () => {
  const pack = shelf({ docs: filler("a", 1) });
  game.packs = [pack];
  game.items = [
    { id: "wx", name: "World weapon", type: "weapon", flags: { "acks-extras": { cookbook: { id: "def.weapon.wx" } } }, system: {} },
    { id: "wy", name: "World tool", type: "equipment", flags: {}, system: {} },
  ];
  assert.deepEqual(idsOf(await libraryDocsWhere("Item", isWeapon)), ["wx", "aw0"]);
  game.items = [];
});

await ok("a document the shelf already holds is neither queried nor replaced", async () => {
  const pack = shelf({ docs: filler("a", 3), held: ["aw1"] });
  game.packs = [pack];
  const heldInstance = pack.get("aw1");
  const found = await libraryDocsWhere("Item", isWeapon);
  assert.deepEqual(idsOf(found), ["aw0", "aw1", "aw2"]);
  assert.equal(found[1], heldInstance, "the held instance itself");
  assert.deepEqual(pack.calls.getDocuments[0]._id__in, ["aw0", "aw2"]);
});

await ok("with everything held there is no query at all, and a match of nothing asks for nothing", async () => {
  const held = shelf({ docs: filler("a", 2), held: ["aw0", "aw1"] });
  game.packs = [held];
  assert.deepEqual(idsOf(await libraryDocsWhere("Item", isWeapon)), ["aw0", "aw1"]);
  assert.equal(held.calls.getDocuments.length, 0);
  const none = shelf({ docs: filler("c", 0) });
  game.packs = [none];
  assert.deepEqual(await libraryDocsWhere("Item", isWeapon), []);
  assert.equal(none.calls.getDocuments.length, 0);
});

await ok("a shelf whose load fails is reported and the others still answer", async () => {
  const bad = shelf({ docs: filler("a", 2), failLoad: true });
  const good = shelf({ line: "Sample Line", docs: filler("b", 2) });
  game.packs = [bad, good];
  const { value, warned } = await withWarnings(() => libraryDocsWhere("Item", isWeapon));
  assert.deepEqual(idsOf(value), ["bw0", "bw1"]);
  assert.equal(warned.length, 1);
  assert.match(String(warned[0][0]), /acks-extras \| could not read the imported Item library/);
});

await ok("a shelf whose index fails is reported, and a held document of the other shelf is still returned", async () => {
  const bad = shelf({ docs: filler("a", 2), failIndex: true });
  const good = shelf({ line: "Sample Line", docs: filler("b", 2), held: ["bw1"] });
  game.packs = [bad, good];
  const { value, warned } = await withWarnings(() => libraryDocsWhere("Item", isWeapon));
  assert.deepEqual(idsOf(value), ["bw0", "bw1"]);
  assert.equal(warned.length, 1);
});

await ok("except drops those ids, shelf and world alike, before anything is loaded", async () => {
  const pack = shelf({ docs: filler("a", 3) });
  game.packs = [pack];
  game.items = [{ id: "wx", name: "World weapon", type: "weapon", flags: { "acks-extras": { cookbook: { id: "def.weapon.wx" } } }, system: {} }];
  const found = await libraryDocsWhere("Item", isWeapon, { except: new Set(["aw1", "wx"]) });
  assert.deepEqual(idsOf(found), ["aw0", "aw2"]);
  assert.deepEqual(pack.calls.getDocuments[0]._id__in, ["aw0", "aw2"], "an excluded id is not even loaded");
  assert.deepEqual(idsOf(await libraryDocsWhere("Item", isWeapon, { except: ["aw0"] })).includes("aw0"), false, "any iterable of ids will do");
  game.items = [];
});

await ok("the test is handed a row of id, name, type and flags, never `system`, whatever the row or document carries", async () => {
  const pack = shelf({ docs: filler("a", 2), extraIndex: { system: { declaredByAnotherModule: 1 } } });
  game.packs = [pack];
  game.items = [{ id: "wx", name: "World weapon", type: "weapon", flags: {}, system: { sentinel: 1 }, getFlag() {} }];
  const seen = [];
  await libraryDocsWhere("Item", (row) => {
    seen.push(Object.keys(row).sort());
    return false;
  });
  assert.ok(seen.length >= 23, "world and shelf rows were all tested");
  for (const keys of seen) assert.deepEqual(keys, ["_id", "flags", "id", "name", "type", "uuid"].filter((k) => keys.includes(k)));
  assert.ok(seen.every((keys) => !keys.includes("system")));
  game.items = [];
});

await ok("a stamp the index does not declare matches nothing; declared, it matches (the live failure it guards)", async () => {
  globalThis.CONFIG.Item.compendiumIndexFields = [];
  const bare = shelf({ docs: filler("a", 2) });
  game.packs = [bare];
  assert.deepEqual(await libraryDocsWhere("Item", isWeapon), []);
  declareLibraryIndexFields();
  const declared = shelf({ docs: filler("a", 2) });
  game.packs = [declared];
  assert.deepEqual(idsOf(await libraryDocsWhere("Item", isWeapon)), ["aw0", "aw1"]);
});

await ok("a shelf this seat cannot open is not read, and a type with no shelf answers the world alone", async () => {
  const closed = shelf({ docs: filler("a", 2), visible: false });
  game.packs = [closed];
  game.items = [{ id: "wx", name: "World weapon", type: "weapon", flags: { "acks-extras": { cookbook: { id: "def.weapon.wx" } } }, system: {} }];
  assert.deepEqual(idsOf(await libraryDocsWhere("Item", isWeapon)), ["wx"]);
  assert.equal(closed.calls.getIndex.length, 0);
  game.packs = [];
  assert.deepEqual(idsOf(await libraryDocsWhere("Item", isWeapon)), ["wx"]);
  game.items = [];
});

await ok("a shelf found only at the second read is read at the second read", async () => {
  game.packs = [];
  assert.deepEqual(await libraryDocsWhere("Item", isWeapon), []);
  game.packs = [shelf({ docs: filler("a", 1) })];
  assert.deepEqual(idsOf(await libraryDocsWhere("Item", isWeapon)), ["aw0"]);
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await ok("two readers of one shelf at once share one index read; a read after it settles asks again", async () => {
  const pack = shelf({ docs: filler("a", 3) });
  game.packs = [pack];
  const [first, second] = await Promise.all([libraryDocsWhere("Item", isWeapon), libraryDocsWhere("Item", (row) => row.type === "equipment")]);
  assert.equal(pack.calls.getIndex.length, 1, "one server pass for both readers");
  assert.deepEqual(idsOf(first), ["aw0", "aw1", "aw2"]);
  assert.equal(second.length, 20);
  await libraryDocsWhere("Item", isWeapon);
  assert.equal(pack.calls.getIndex.length, 2, "the shared read is dropped once it settles");
});

await ok("a shared index read that rejects is reported to each reader, and the next read tries again", async () => {
  const pack = shelf({ docs: filler("a", 2), failIndex: true });
  game.packs = [pack];
  const { value } = await withWarnings(() => Promise.all([libraryDocsWhere("Item", isWeapon), libraryDocsWhere("Item", isWeapon)]));
  assert.equal(pack.calls.getIndex.length, 1);
  assert.deepEqual(value.map((found) => found.failed), [[pack.collection], [pack.collection]]);
  pack.failIndex = false;
  const again = await libraryDocsWhere("Item", isWeapon);
  assert.deepEqual(idsOf(again), ["aw0", "aw1"]);
  assert.equal(pack.calls.getIndex.length, 2);
});

await ok("an answer names the shelves that could not be read, so a failure is told from a match of none", async () => {
  const bad = shelf({ docs: filler("a", 2), failLoad: true });
  const brokenIndex = shelf({ line: "Sample Line", docs: filler("b", 2), failIndex: true });
  const fine = shelf({ line: "Other Line", docs: filler("c", 2) });
  const empty = shelf({ line: "Empty Line", docs: filler("d", 0) });
  game.packs = [bad, brokenIndex, fine, empty];
  const { value } = await withWarnings(() => libraryDocsWhere("Item", isWeapon));
  assert.deepEqual(idsOf(value), ["cw0", "cw1"]);
  assert.deepEqual(value.failed, [bad.collection, brokenIndex.collection]);
  game.packs = [fine, empty];
  const clean = await libraryDocsWhere("Item", (row) => row.name === "no such name");
  assert.deepEqual(clean, []);
  assert.deepEqual(clean.failed, [], "a read that matched nothing has failed nowhere");
  assert.equal(Object.keys(clean).length, 0, "the list is still a plain array to every caller that ignores `failed`");
});

await ok("the warm waits for the narrow reads in flight, and starts after them", async () => {
  const pack = shelf({ docs: filler("a", 3) });
  game.packs = [pack];
  let open;
  const gate = new Promise((resolve) => (open = resolve));
  const realIndex = pack.getIndex.bind(pack);
  pack.getIndex = async (...args) => {
    await gate;
    return realIndex(...args);
  };
  const bare = () => pack.calls.getDocuments.filter((query) => !query?._id__in).length;
  const reading = libraryDocsWhere("Item", isWeapon);
  const warming = lib.registerLibraryWarm();
  await sleep(15);
  assert.equal(bare(), 0, "no whole-shelf load while a narrow read is under way");
  open();
  await reading;
  await warming;
  assert.equal(bare(), 1, "the warm loads the whole shelf once the narrow read has landed");
  pack.getIndex = realIndex;
});

await ok("the warm is deferred a macrotask even with nothing in flight, so a reader started in the same tick is seen", async () => {
  const pack = shelf({ docs: filler("a", 3) });
  game.packs = [pack];
  const warming = lib.registerLibraryWarm();
  const late = libraryDocsWhere("Item", isWeapon);
  assert.equal(pack.calls.getDocuments.length, 0, "the warm has not started synchronously");
  await Promise.all([warming, late]);
  const loads = pack.calls.getDocuments;
  const narrowAt = loads.findIndex((query) => query?._id__in);
  const wholeAt = loads.findIndex((query) => !query?._id__in);
  assert.ok(narrowAt >= 0 && wholeAt > narrowAt, "the narrow read's load goes first, the whole-shelf load after it");
});

console.log(`\n${passed} passed`);
