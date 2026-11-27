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
const { libraryDocsWhere, declareLibraryIndexFields, libraryCold, cookbookId, loadIds, packDocsWhere, WARM_MARK_ENDED, warmMarkEnded } = lib;

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
  const once = new Set(["aw1", "wx"]).values();
  assert.deepEqual(idsOf(await libraryDocsWhere("Item", isWeapon, { except: once })), ["aw0", "aw2"], "a one-shot iterator excludes the world's document and the shelf's alike");
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

await ok("loadIds: the same ids asked twice at once are one server call, answered in the order asked", async () => {
  const pack = shelf({ docs: filler("a", 3) });
  const [one, two] = await Promise.all([loadIds(pack, ["aw1", "aw0"]), loadIds(pack, ["aw1", "aw0"])]);
  assert.equal(pack.calls.getDocuments.length, 1, "one server call for both callers");
  assert.deepEqual(pack.calls.getDocuments[0], { _id__in: ["aw1", "aw0"] });
  assert.deepEqual(idsOf(one), ["aw1", "aw0"], "the order asked, not the server's");
  assert.deepEqual(idsOf(two), ["aw1", "aw0"]);
  assert.equal(one[0], pack.get("aw1"));
});

await ok("loadIds: overlapping ids ask only for the new ones, and a held id asks for nothing", async () => {
  const pack = shelf({ docs: filler("a", 4), held: ["aw3"] });
  const first = loadIds(pack, ["aw0", "aw1"]);
  const second = loadIds(pack, ["aw1", "aw2", "aw3"]);
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(pack.calls.getDocuments, [{ _id__in: ["aw0", "aw1"] }, { _id__in: ["aw2"] }]);
  assert.deepEqual(idsOf(a), ["aw0", "aw1"]);
  assert.deepEqual(idsOf(b), ["aw1", "aw2", "aw3"], "the in-flight id, the new id and the held one");
  await loadIds(pack, ["aw0", "aw3", "aw3"]);
  assert.equal(pack.calls.getDocuments.length, 2, "everything held: no call, and a repeated id asks once");
});

await ok("loadIds: an id the pack does not hold is dropped from the answer", async () => {
  const pack = shelf({ docs: filler("a", 2) });
  assert.deepEqual(idsOf(await loadIds(pack, ["nowhere", "aw0"])), ["aw0"]);
  assert.deepEqual(await loadIds(pack, []), []);
  assert.equal(pack.calls.getDocuments.length, 1, "an empty list asks for nothing");
});

await ok("loadIds: a rejected load releases its ids, every waiter sees the rejection, and a later call asks again", async () => {
  const pack = shelf({ docs: filler("a", 2), failLoad: true });
  const settled = await Promise.allSettled([loadIds(pack, ["aw0"]), loadIds(pack, ["aw0"])]);
  assert.deepEqual(settled.map((s) => s.status), ["rejected", "rejected"]);
  assert.match(String(settled[0].reason), /load refused/);
  assert.equal(pack.calls.getDocuments.length, 1, "the second caller waited on the first's load");
  pack.failLoad = false;
  assert.deepEqual(idsOf(await loadIds(pack, ["aw0"])), ["aw0"]);
  assert.equal(pack.calls.getDocuments.length, 2, "the ids were released, so the call asks again");
});

await ok("packDocsWhere: a shelf whose index throws is named on `failed` and the other shelves still answer", async () => {
  const bad = shelf({ docs: filler("a", 2), failIndex: true });
  const good = shelf({ line: "Sample Line", docs: filler("b", 2) });
  const { value, warned } = await withWarnings(() => packDocsWhere([bad, good], isWeapon));
  assert.deepEqual(idsOf(value), ["bw0", "bw1"]);
  assert.deepEqual(value.failed, [bad.collection]);
  assert.equal(warned.length, 1);
  assert.match(String(warned[0][0]), /acks-extras \| could not read the imported Item library from /);
  assert.equal(Object.keys(value).length, 2, "`failed` is not enumerable");
});

await ok("packDocsWhere: the packs are the caller's, so a shelf this seat cannot open is read when handed over; one id query per shelf, in index order", async () => {
  const closed = shelf({ docs: filler("a", 3), visible: false });
  const lined = shelf({ line: "Sample Line", docs: filler("b", 2) });
  game.packs = [];
  const found = await packDocsWhere([lined, closed], isWeapon, { except: ["aw1"] });
  assert.deepEqual(idsOf(found), ["bw0", "bw1", "aw0", "aw2"], "shelf by shelf, in the order handed");
  assert.deepEqual(closed.calls.getDocuments, [{ _id__in: ["aw0", "aw2"] }]);
  assert.deepEqual(found.failed, []);
});

await ok("packDocsWhere is a narrow read: the warm starts behind it", async () => {
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
  const reading = packDocsWhere([pack], isWeapon);
  const warming = lib.registerLibraryWarm();
  await sleep(15);
  assert.equal(bare(), 0, "no whole-shelf load while the pack read is under way");
  open();
  await reading;
  await warming;
  assert.equal(bare(), 1);
  pack.getIndex = realIndex;
});

await ok("libraryDocsWhere answers the world's documents, then packDocsWhere over the seat's shelves, with `failed` carried", async () => {
  const bad = shelf({ docs: filler("a", 2), failLoad: true });
  const good = shelf({ line: "Sample Line", docs: filler("b", 1) });
  const hidden = shelf({ line: "Hidden Line", docs: filler("c", 1), visible: false });
  game.packs = [bad, good, hidden];
  game.items = [{ id: "wx", name: "World weapon", type: "weapon", flags: { "acks-extras": { cookbook: { id: "def.weapon.wx" } } }, system: {} }];
  const { value } = await withWarnings(() => libraryDocsWhere("Item", isWeapon));
  assert.deepEqual(idsOf(value), ["wx", "bw0"]);
  assert.deepEqual(value.failed, [bad.collection]);
  assert.equal(hidden.calls.getIndex.length, 0);
  game.items = [];
});

await ok("registerLibraryWarm sets each type's ended mark and then the overall ended mark", async () => {
  game.packs = [shelf({ docs: filler("a", 2) })];
  performance.clearMarks();
  await lib.registerLibraryWarm();
  const at = (name) => {
    const entries = performance.getEntriesByName(name, "mark");
    assert.equal(entries.length, 1, `${name} set once`);
    return entries[0].startTime;
  };
  assert.equal(WARM_MARK_ENDED, "acks-extras:libraryWarm:ended");
  assert.equal(warmMarkEnded("Item"), "acks-extras:libraryWarm:Item:ended");
  const ended = ["Item"].map((type) => at(warmMarkEnded(type)));
  assert.ok(at(WARM_MARK_ENDED) >= Math.max(...ended), "the overall mark follows every warm type's");
  for (const type of ["Actor", "JournalEntry", "RollTable"]) {
    assert.equal(performance.getEntriesByName(warmMarkEnded(type), "mark").length, 0, `${type} is outside the warm, so it sets no mark`);
  }
  assert.equal(performance.getEntriesByName("acks-extras:libraryWarm:started", "mark").length, 1);
});

await ok("whenReady and warmLibrary set no ended mark", async () => {
  game.packs = [shelf({ docs: filler("a", 2) })];
  performance.clearMarks();
  await lib.whenReady();
  await lib.warmLibrary();
  assert.equal(performance.getEntriesByName(WARM_MARK_ENDED, "mark").length, 0);
  assert.equal(performance.getEntriesByName(warmMarkEnded("Item"), "mark").length, 0);
});

/** One shelf per document type, ids `<type><n>`, each type's documents distinct. */
const fourShelves = () => {
  const make = (type, n = 2) => shelf({ type, docs: Array.from({ length: n }, (_, i) => source(`${type}${i}`, `${type} ${i}`, type === "Item" ? "equipment" : "base")) });
  return { Item: make("Item"), Actor: make("Actor"), JournalEntry: make("JournalEntry"), RollTable: make("RollTable") };
};
const wholeLoads = (pack) => pack.calls.getDocuments.filter((query) => !query?._id__in).length;

await ok("WARM_TYPES is Item alone", () => {
  assert.deepEqual([...lib.WARM_TYPES], ["Item"]);
});

await ok("the ready warm loads the Item shelves whole and no Actor, RollTable or JournalEntry shelf", async () => {
  const shelves = fourShelves();
  game.packs = Object.values(shelves);
  await lib.registerLibraryWarm();
  assert.equal(wholeLoads(shelves.Item), 1);
  assert.equal(shelves.Actor.calls.getDocuments.length, 0, "the Actor shelf is not warmed, whole or narrow");
  assert.equal(shelves.Actor.size, 0);
  assert.equal(wholeLoads(shelves.RollTable), 0, "the roll table shelf is not warmed");
  assert.equal(wholeLoads(shelves.JournalEntry), 0, "the journal shelf is not warmed");
  assert.equal(shelves.RollTable.size, 0);
});

await ok("whenReady loads Item only, and warmLibrary is the same load", async () => {
  const shelves = fourShelves();
  game.packs = Object.values(shelves);
  await lib.whenReady();
  assert.deepEqual(Object.entries(shelves).map(([type, pack]) => [type, wholeLoads(pack)]), [["Item", 1], ["Actor", 0], ["JournalEntry", 0], ["RollTable", 0]]);
  await lib.warmLibrary();
  assert.equal(wholeLoads(shelves.Item), 1, "a warm shelf is not loaded again");
});

await ok("loadLibrary(types) loads only the types it is given", async () => {
  const shelves = fourShelves();
  game.packs = Object.values(shelves);
  await lib.loadLibrary(["RollTable"]);
  assert.deepEqual(Object.entries(shelves).map(([type, pack]) => [type, wholeLoads(pack)]), [["Item", 0], ["Actor", 0], ["JournalEntry", 0], ["RollTable", 1]]);
  assert.equal(shelves.RollTable.size, 2);
});

await ok("loadLibrary() with no types loads every shelf the importer keeps, and a load in flight is shared", async () => {
  const shelves = fourShelves();
  game.packs = Object.values(shelves);
  assert.deepEqual(lib.LIBRARY_TYPES, ["Item", "Actor", "JournalEntry", "RollTable"]);
  await Promise.all([lib.loadLibrary(), lib.loadLibrary(["JournalEntry"])]);
  for (const pack of Object.values(shelves)) assert.equal(wholeLoads(pack), 1, `${pack.documentName} loaded once`);
});

await ok("libraryCold(types) asks only about the types it is given", async () => {
  const shelves = fourShelves();
  game.packs = Object.values(shelves);
  await lib.loadLibrary(["Item", "Actor", "JournalEntry"]);
  assert.equal(libraryCold(["Item", "Actor", "JournalEntry"]), false);
  assert.equal(libraryCold(["RollTable"]), true);
  assert.equal(libraryCold(), true, "the default asks about every type");
});

await ok("a synchronous read of a cold RollTable or JournalEntry shelf answers what is held and starts no load", async () => {
  const shelves = fourShelves();
  game.packs = Object.values(shelves);
  assert.deepEqual(lib.libraryDocs("RollTable"), []);
  assert.deepEqual(lib.libraryDocs("JournalEntry"), []);
  await sleep(15);
  assert.equal(wholeLoads(shelves.RollTable), 0);
  assert.equal(wholeLoads(shelves.JournalEntry), 0);
  assert.equal(lib.byCookbookId("RollTable", "def.none"), null);
  await sleep(15);
  assert.equal(shelves.RollTable.calls.getDocuments.length, 0, "no load of any kind");
  assert.equal(lib.libraryDocs("Item").length, 0, "a cold Item shelf still answers what is held");
  await sleep(15);
  assert.equal(wholeLoads(shelves.Item), 1, "and still starts its own load");
  assert.equal(lib.libraryDocs("RollTable").length, 0);
  await lib.loadLibrary(["RollTable"]);
  assert.equal(lib.libraryDocs("RollTable").length, 2, "an action's load makes the read whole");
});

await ok("a synchronous read of a cold Actor shelf answers what is held and starts no load", async () => {
  const shelves = fourShelves();
  game.packs = Object.values(shelves);
  assert.deepEqual(lib.libraryActors(), []);
  assert.deepEqual(lib.libraryDocs("Actor"), []);
  await sleep(15);
  assert.equal(shelves.Actor.calls.getDocuments.length, 0, "no load of any kind");
  assert.equal(libraryCold(["Actor"]), true, "the shelf is still cold");
  await lib.loadLibrary(["Actor"]);
  assert.equal(lib.libraryActors().length, 2, "an action's load makes the read whole");
});

await ok("the stand-in shelf reports `indexed` as core does: the declared fields are a subset of those the index was built with", async () => {
  const pack = shelf({ docs: filler("a", 2) });
  assert.deepEqual(globalThis.CONFIG.Item.compendiumIndexFields.length > 0, true, "the stamp is declared in this run");
  assert.equal(pack.indexed, false, "the startup index holds core fields only");
  await pack.getIndex();
  assert.equal(pack.indexed, true);
  const saved = globalThis.CONFIG.Item.compendiumIndexFields;
  globalThis.CONFIG.Item.compendiumIndexFields = [];
  assert.equal(shelf({ docs: filler("a", 1) }).indexed, true, "nothing declared beyond core: covered from the start");
  globalThis.CONFIG.Item.compendiumIndexFields = saved;
});

console.log(`\n${passed} passed`);
