/**
 * The library's held and index readers (lib/library.mjs): `libraryRows` answers
 * projections off each shelf's index and never loads a document; `libraryHeld`
 * answers the documents a shelf already holds and loads the matching rest by
 * one `_id__in`; both redraw their caller once when a read they started lands
 * (`redrawOnRead`, `redrawOpen`), and neither can loop on a shelf or a load that
 * fails (`HELD_RETRY_MS`). `byCookbookId`, `byCookbookIdAsync`, `cookbookRow`,
 * `pickCarrier` and `libraryTwinReady` are the stamp readers built on them.
 *
 * The stand-in shelf (lib-shelf-mock.mjs) behaves as core's compendium
 * collection does where it matters here: its startup index holds core fields
 * only, a declared flag reaches a row after the first `getIndex()`, and a query
 * answers in the server's order. Every name and id is this file's own invention.
 */
import assert from "node:assert/strict";

let passed = 0;
let failed = 0;
const ok = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log("ok   " + name);
  } catch (err) {
    failed++;
    console.log("FAIL " + name + "\n     " + String(err?.message ?? err).split("\n")[0]);
  }
};
process.on("unhandledRejection", (err) => {
  failed++;
  console.log("FAIL unhandled rejection: " + String(err?.message ?? err));
});

globalThis.CONFIG = { Item: { compendiumIndexFields: [] }, Actor: { compendiumIndexFields: [] } };
globalThis.game = { items: [], actors: [], journal: [], tables: [], packs: [] };

const lib = await import("../scripts/lib/library.mjs");
const { declareLibraryIndexFields, LIBRARY_INDEX_FIELDS, cookbookId } = lib;
const { shelfMock: shelf, sourceDoc: source } = await import("./lib-shelf-mock.mjs");

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const stampOf = (id) => (row) => cookbookId(row) === id;
const ANY = () => true;
const idsOf = (list) => list.map((d) => d._id ?? d.id);
const worldDoc = (id, name, type, mint = null, extra = {}) => ({
  id, _id: id, uuid: `World.${id}`, name, type, img: `img/${id}.webp`, system: { marker: `body of ${id}` },
  flags: mint ? { "acks-extras": { cookbook: { id: mint } } } : {}, ...extra,
});
const mint = (id, name, type, stamp, extra = {}) => {
  const d = source(id, name, type, stamp);
  for (const [path, value] of Object.entries(extra)) d.flags["acks-extras"][path] = value;
  return d;
};
const reset = () => {
  game.items = [];
  game.actors = [];
  game.journal = [];
  game.tables = [];
  game.packs = [];
};
const quiet = async (fn) => {
  const saved = console.warn;
  const warned = [];
  console.warn = (...args) => warned.push(args);
  try {
    return { value: await fn(), warned };
  } finally {
    console.warn = saved;
  }
};
/** Run `fn` with a clock the test moves. */
const withClock = async (fn) => {
  const real = Date.now;
  let at = 1_000_000;
  Date.now = () => at;
  try {
    return await fn({ advance: (ms) => (at += ms) });
  } finally {
    Date.now = real;
  }
};

await ok("the Actor index declares the stamp, the template part and the types, once each", () => {
  assert.deepEqual(LIBRARY_INDEX_FIELDS?.Actor, [
    "flags.acks-extras.cookbook.id",
    "flags.acks-extras.templatePart",
    "flags.acks-extras.extras.types",
  ]);
  declareLibraryIndexFields();
  declareLibraryIndexFields();
  assert.deepEqual(globalThis.CONFIG.Actor.compendiumIndexFields, [...LIBRARY_INDEX_FIELDS.Actor]);
  assert.equal(globalThis.CONFIG.Item.compendiumIndexFields.length, LIBRARY_INDEX_FIELDS.Item.length);
});

await ok("HELD_RETRY_MS is the module's 30,000 ms pause", () => {
  assert.equal(lib.HELD_RETRY_MS, 30_000);
});

/* ---- libraryRows ---- */

await ok("libraryRows on an indexed shelf makes no server call, and answers projections, never documents", async () => {
  reset();
  const pack = shelf({ type: "Actor", docs: [source("a1", "Alpha", "monster", "m.a1", { marker: "x" }, "img/a1.webp"), source("a2", "Beta", "character")] });
  await pack.getIndex();
  game.packs = [pack];
  const before = [pack.calls.getIndex.length, pack.calls.getDocuments.length];
  const rows = lib.libraryRows("Actor", ANY);
  assert.deepEqual([pack.calls.getIndex.length, pack.calls.getDocuments.length], before);
  assert.deepEqual(rows.map((r) => r.name), ["Alpha", "Beta"]);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["_id", "flags", "id", "img", "name", "pack", "type", "uuid"]);
  assert.equal(rows[0].id, "a1");
  assert.equal(rows[0].uuid, "Compendium.a1");
  assert.equal(rows[0].img, "img/a1.webp");
  assert.equal(rows[0].pack, pack.collection);
  assert.equal(rows[0].system, undefined, "a row carries no system");
  assert.equal(cookbookId(rows[0]), "m.a1");
  assert.equal(rows.pending, null);
  assert.deepEqual(rows.failed, []);
  assert.equal(Object.keys(rows).length, 2, "pending and failed are not enumerable");
});

await ok("a row's uuid is the index row's own where core gives one", async () => {
  reset();
  const pack = shelf({ type: "Actor", docs: [source("a1", "Alpha", "monster")], extraIndex: { uuid: "Compendium.world.pack.Actor.a1" } });
  await pack.getIndex();
  game.packs = [pack];
  assert.equal(lib.libraryRows("Actor", ANY)[0].uuid, "Compendium.world.pack.Actor.a1");
});

await ok("rows come world first, then the unlined shelf, then the lined one, each in index order", async () => {
  reset();
  const lined = shelf({ type: "Actor", line: "Sample Line", docs: [source("l1", "Lined 1", "monster"), source("l2", "Lined 2", "monster")] });
  const acks = shelf({ type: "Actor", docs: [source("k1", "Acks 1", "monster"), source("k2", "Acks 2", "monster")] });
  await lined.getIndex();
  await acks.getIndex();
  game.packs = [lined, acks];
  game.actors = [worldDoc("w1", "World 1", "monster"), worldDoc("w2", "World 2", "character")];
  const rows = lib.libraryRows("Actor", (r) => r.type === "monster");
  assert.deepEqual(idsOf(rows), ["w1", "k1", "k2", "l1", "l2"]);
  assert.equal(rows[0].pack, null, "a world document sits in no pack");
  assert.equal(rows[0].img, "img/w1.webp");
});

await ok("a shelf this seat cannot open is skipped whole: no rows, no index read, no load", async () => {
  reset();
  const judge = shelf({ type: "Actor", line: "Sample — Judge", visible: false, docs: [mint("j1", "Hidden", "monster", "m.j1")] });
  game.packs = [judge];
  const rows = lib.libraryRows("Actor", ANY);
  const held = lib.libraryHeld("Actor", stampOf("m.j1"));
  assert.deepEqual([rows.length, held.length], [0, 0]);
  assert.deepEqual([judge.calls.getIndex.length, judge.calls.getDocuments.length], [0, 0]);
  assert.equal(rows.pending, null);
  assert.equal(held.pending, null);
});

await ok("an unindexed shelf with a flag test: pending, one index read however often asked, and one redraw", async () => {
  reset();
  const pack = shelf({ type: "Actor", docs: [mint("a1", "Alpha", "monster", "m.a1"), mint("a2", "Beta", "monster", "m.a2")] });
  game.packs = [pack];
  let redraws = 0;
  const target = () => redraws++;
  const first = lib.libraryRows("Actor", stampOf("m.a1"), { redraw: target });
  const second = lib.libraryRows("Actor", stampOf("m.a1"), { redraw: target });
  assert.deepEqual(first, [], "the startup rows carry no flag, so the test finds nothing yet");
  assert.ok(first.pending instanceof Promise);
  assert.equal(pack.calls.getIndex.length, 1, "one index read for two asks");
  assert.deepEqual(pack.calls.getIndex[0], [], "asked with no argument");
  await Promise.all([first.pending, second.pending]);
  await tick();
  assert.equal(redraws, 1, "one redraw for the two asks");
  const again = lib.libraryRows("Actor", stampOf("m.a1"), { redraw: target });
  assert.deepEqual(idsOf(again), ["a1"]);
  assert.equal(again.pending, null);
  await tick();
  assert.equal(redraws, 1, "an answer with nothing pending redraws nothing");
  assert.equal(pack.calls.getIndex.length, 1);
  assert.equal(pack.calls.getDocuments.length, 0, "rows load no document");
});

await ok("an unindexed shelf still answers its startup rows for a test on a core field", async () => {
  reset();
  const pack = shelf({ type: "Actor", docs: [mint("a1", "Alpha", "monster", "m.a1"), mint("a2", "Beta", "character", "m.a2")] });
  game.packs = [pack];
  const rows = lib.libraryRows("Actor", (r) => r.type === "monster");
  assert.deepEqual(rows.map((r) => r.name), ["Alpha"]);
  assert.ok(rows.pending);
  await rows.pending;
});

await ok("a failed index read is named within HELD_RETRY_MS with no pending, and is asked again after it", async () => {
  reset();
  await withClock(async ({ advance }) => {
    const pack = shelf({ type: "Actor", failIndex: true, docs: [mint("a1", "Alpha", "monster", "m.a1")] });
    game.packs = [pack];
    let redraws = 0;
    const { value: first, warned } = await quiet(async () => {
      const answer = lib.libraryRows("Actor", stampOf("m.a1"), { redraw: () => redraws++ });
      await answer.pending;
      await tick();
      return answer;
    });
    assert.equal(first.pending instanceof Promise, true);
    assert.equal(redraws, 1);
    assert.equal(pack.calls.getIndex.length, 1);
    assert.equal(warned.length, 1, "a failed index is reported once");
    const second = lib.libraryRows("Actor", stampOf("m.a1"), { redraw: () => redraws++ });
    assert.deepEqual(second.failed, [pack.collection]);
    assert.equal(second.pending, null);
    await tick();
    assert.equal(redraws, 1, "a redraw cannot loop on a shelf that will not index");
    assert.equal(pack.calls.getIndex.length, 1);
    advance(lib.HELD_RETRY_MS);
    const third = lib.libraryRows("Actor", stampOf("m.a1"));
    assert.ok(third.pending instanceof Promise, "past the pause the shelf is asked again");
    assert.deepEqual(third.failed, []);
    assert.equal(pack.calls.getIndex.length, 2);
    await quiet(() => third.pending);
  });
});

/* ---- libraryHeld ---- */

await ok("libraryHeld answers the held documents and loads the missing matches in one _id__in, then redraws once", async () => {
  reset();
  const docs = [
    mint("a0", "A0", "monster", "m.x"), mint("a1", "A1", "monster", "m.x"), mint("a2", "A2", "monster", "m.x"), mint("o1", "Other", "monster", "m.other"),
  ];
  const pack = shelf({ type: "Actor", docs, held: ["a0"] });
  await pack.getIndex();
  game.packs = [pack];
  game.actors = [worldDoc("w1", "World", "monster", "m.x")];
  let redraws = 0;
  const target = () => redraws++;
  const first = lib.libraryHeld("Actor", stampOf("m.x"), { redraw: target });
  const again = lib.libraryHeld("Actor", stampOf("m.x"), { redraw: target });
  assert.deepEqual(idsOf(first), ["w1", "a0"], "the world's, then what the shelf holds");
  assert.equal(first[1], pack.get("a0"), "a held document is handed out as it is");
  assert.equal(pack.calls.getDocuments.length, 1, "the second ask finds the first one's load in flight");
  assert.deepEqual(pack.calls.getDocuments[0], { _id__in: ["a1", "a2"] });
  await Promise.all([first.pending, again.pending]);
  await tick();
  assert.equal(redraws, 1);
  const landed = lib.libraryHeld("Actor", stampOf("m.x"));
  assert.deepEqual(idsOf(landed), ["w1", "a0", "a1", "a2"], "in index order");
  assert.equal(landed.pending, null);
  assert.equal(pack.calls.getDocuments.length, 1);
  assert.equal(pack.calls.getIndex.length, 1);
});

await ok("libraryHeld never loads a whole shelf: a test nothing passes asks nothing", async () => {
  reset();
  const pack = shelf({ type: "Actor", docs: [mint("a1", "A1", "monster", "m.a1")] });
  await pack.getIndex();
  game.packs = [pack];
  const none = lib.libraryHeld("Actor", stampOf("m.none"));
  assert.deepEqual(none, []);
  assert.equal(none.pending, null);
  assert.equal(pack.calls.getDocuments.length, 0);
});

await ok("an unindexed shelf is chained: the index, then the matching rows' load, so one redraw finds them held", async () => {
  reset();
  const pack = shelf({ type: "Actor", docs: [mint("a1", "A1", "monster", "m.x"), mint("a2", "A2", "monster", "m.y")] });
  game.packs = [pack];
  let redraws = 0;
  const first = lib.libraryHeld("Actor", stampOf("m.x"), { redraw: () => redraws++ });
  assert.deepEqual(first, []);
  assert.ok(first.pending instanceof Promise);
  await first.pending;
  await tick();
  assert.equal(redraws, 1);
  assert.deepEqual(pack.calls.getDocuments, [{ _id__in: ["a1"] }]);
  assert.equal(pack.calls.getIndex.length, 1);
  assert.deepEqual(idsOf(lib.libraryHeld("Actor", stampOf("m.x"))), ["a1"]);
});

await ok("on an unindexed shelf the held documents are tested themselves: a warm page answers what it always did", async () => {
  reset();
  const docs = [mint("a1", "A1", "monster", "m.x"), mint("a2", "A2", "monster", "m.y")];
  const pack = shelf({ type: "Actor", docs, held: ["a1", "a2"] });
  game.packs = [pack];
  const answer = lib.libraryHeld("Actor", stampOf("m.x"));
  assert.deepEqual(idsOf(answer), ["a1"]);
  assert.equal(pack.calls.getDocuments.length, 0);
  assert.equal(pack.indexed, false);
  await answer.pending;
});

await ok("a load that fails is named within HELD_RETRY_MS and sets no pending; a redraw cannot loop; it is asked again after the pause", async () => {
  reset();
  await withClock(async ({ advance }) => {
    const pack = shelf({ type: "Actor", failLoad: true, docs: [mint("a1", "A1", "monster", "m.x")] });
    await pack.getIndex();
    game.packs = [pack];
    let redraws = 0;
    const target = () => redraws++;
    await quiet(async () => {
      const first = lib.libraryHeld("Actor", stampOf("m.x"), { redraw: target });
      assert.ok(first.pending instanceof Promise);
      await first.pending;
      await tick();
    });
    assert.equal(redraws, 1);
    assert.equal(pack.calls.getDocuments.length, 1);
    const second = lib.libraryHeld("Actor", stampOf("m.x"), { redraw: target });
    assert.deepEqual(second.failed, [pack.collection]);
    assert.equal(second.pending, null);
    await tick();
    assert.equal(redraws, 1);
    assert.equal(pack.calls.getDocuments.length, 1);
    pack.failLoad = false;
    advance(lib.HELD_RETRY_MS);
    const third = lib.libraryHeld("Actor", stampOf("m.x"));
    assert.ok(third.pending instanceof Promise);
    assert.deepEqual(third.failed, []);
    await third.pending;
    assert.deepEqual(idsOf(lib.libraryHeld("Actor", stampOf("m.x"))), ["a1"]);
  });
});

await ok("an indexed id the server does not give back is not asked for again within the pause", async () => {
  reset();
  await withClock(async ({ advance }) => {
    const pack = shelf({ type: "Actor", docs: [mint("a1", "A1", "monster", "m.x")] });
    await pack.getIndex();
    pack.index.set("ghost", { _id: "ghost", name: "Ghost", type: "monster", flags: { "acks-extras": { cookbook: { id: "m.x" } } } });
    game.packs = [pack];
    const first = lib.libraryHeld("Actor", stampOf("m.x"));
    await first.pending;
    assert.deepEqual(pack.calls.getDocuments, [{ _id__in: ["a1", "ghost"] }]);
    const second = lib.libraryHeld("Actor", stampOf("m.x"));
    assert.deepEqual(idsOf(second), ["a1"]);
    assert.deepEqual(second.failed, [pack.collection]);
    assert.equal(second.pending, null, "a document that cannot be instantiated does not make a redraw loop");
    assert.equal(pack.calls.getDocuments.length, 1);
    advance(lib.HELD_RETRY_MS);
    assert.ok(lib.libraryHeld("Actor", stampOf("m.x")).pending instanceof Promise);
  });
});

await ok("no read here is a bare getDocuments: every load names its ids", async () => {
  reset();
  const pack = shelf({ type: "Actor", docs: [mint("a1", "A1", "monster", "m.x"), mint("a2", "A2", "monster", "m.x")] });
  game.packs = [pack];
  const first = lib.libraryHeld("Actor", stampOf("m.x"));
  await first.pending;
  await tick();
  const second = lib.libraryHeld("Actor", stampOf("m.x"));
  await second.pending;
  assert.ok(pack.calls.getDocuments.length >= 1);
  assert.ok(pack.calls.getDocuments.every((query) => Array.isArray(query?._id__in)));
});

/* ---- redrawOnRead, redrawOpen ---- */

await ok("redrawOnRead takes a function, an application and a document, and skips an application no longer rendered", async () => {
  const answer = () => ({ pending: Promise.resolve() });
  const calls = [];
  lib.redrawOnRead(answer(), () => calls.push("fn"));
  const live = { rendered: true, render: () => calls.push("live") };
  const closed = { rendered: false, render: () => calls.push("closed") };
  lib.redrawOnRead(answer(), live);
  lib.redrawOnRead(answer(), closed);
  const doc = { documentName: "Actor", apps: { 1: { rendered: true, render: () => calls.push("doc app 1") }, 2: { rendered: false, render: () => calls.push("doc app 2") } } };
  lib.redrawOnRead(answer(), doc);
  lib.redrawOnRead({ pending: null }, () => calls.push("never"));
  lib.redrawOnRead({}, () => calls.push("never"));
  await tick();
  assert.deepEqual(calls.sort(), ["doc app 1", "fn", "live"]);
});

await ok("redrawOnRead is once per target while reads are outstanding, and again for a later read", async () => {
  let release;
  const slow = { pending: new Promise((resolve) => (release = resolve)) };
  const fast = { pending: Promise.resolve() };
  let n = 0;
  const target = () => n++;
  lib.redrawOnRead(slow, target);
  lib.redrawOnRead(fast, target);
  await tick();
  assert.equal(n, 0, "it waits for every read outstanding for the target");
  release();
  await tick();
  assert.equal(n, 1);
  lib.redrawOnRead({ pending: Promise.resolve() }, target);
  await tick();
  assert.equal(n, 2);
});

await ok("a redraw that throws is reported and the next one still runs", async () => {
  let n = 0;
  await quiet(async () => {
    lib.redrawOnRead({ pending: Promise.resolve() }, () => {
      throw new Error("sheet closed under it");
    });
    await tick();
  });
  lib.redrawOnRead({ pending: Promise.resolve() }, () => n++);
  await tick();
  assert.equal(n, 1);
});

await ok("redrawOpen renders every rendered application whose document passes, and no other", () => {
  const rendered = [];
  const app = (id, document, isRendered = true) => ({ rendered: isRendered, document, render: () => rendered.push(id) });
  globalThis.foundry = {
    applications: {
      instances: new Map([
        ["a", app("actor sheet", { documentName: "Actor" })],
        ["b", app("item sheet", { documentName: "Item" })],
        ["c", app("closed actor sheet", { documentName: "Actor" }, false)],
        ["d", { rendered: true, render: () => rendered.push("no document") }],
      ]),
    },
  };
  try {
    lib.redrawOpen((doc) => doc.documentName === "Actor")();
    assert.deepEqual(rendered, ["actor sheet"]);
  } finally {
    delete globalThis.foundry;
  }
});

await ok("redrawOpen with no Foundry applications registry does nothing", () => {
  assert.doesNotThrow(() => lib.redrawOpen(() => true)());
});

/* ---- the stamp readers ---- */

await ok("pickCarrier takes the stamp's carrier, skipping template parts, and with original the copies and a base actor", () => {
  const carrier = (id, flags = {}, stats = {}) => ({ id, flags: { "acks-extras": { cookbook: { id: "m.x" }, ...flags } }, _stats: stats });
  const part = carrier("part", { templatePart: true });
  const copy = carrier("copy", {}, { compendiumSource: "Compendium.world.something" });
  const base = carrier("base", { templateFor: "x" });
  const real = carrier("real");
  assert.equal(lib.pickCarrier([part, copy, real], "m.x").id, "copy", "without original a copy answers");
  assert.equal(lib.pickCarrier([part, copy, base, real], "m.x", { original: true }).id, "real");
  assert.equal(lib.pickCarrier([part], "m.x"), null);
  assert.equal(lib.pickCarrier([real], "m.y"), null);
  const other = carrier("other");
  assert.equal(lib.pickCarrier([real, other], "m.x", { prefer: (d) => d.id === "other" }).id, "other");
  assert.equal(lib.pickCarrier([real, other], "m.x", { prefer: () => false }).id, "real", "the first of all where prefer answers none");
});

await ok("byCookbookIdAsync loads only the stamp's matches", async () => {
  reset();
  const docs = [
    ...Array.from({ length: 10 }, (_, i) => mint(`f${i}`, `Filler ${i}`, "monster", `m.f${i}`)),
    mint("t1", "Template part", "monster", "m.x", { templatePart: true }),
    mint("a1", "Target", "monster", "m.x"),
  ];
  const pack = shelf({ type: "Actor", docs });
  game.packs = [pack];
  const found = await lib.byCookbookIdAsync("Actor", "m.x");
  assert.equal(found?.id, "a1");
  assert.deepEqual(pack.calls.getDocuments, [{ _id__in: ["a1"] }], "no template part, no filler");
  assert.equal(await lib.byCookbookIdAsync("Actor", "m.none"), null);
  assert.equal(await lib.byCookbookIdAsync("Actor", ""), null);
});

await ok("byCookbookIdAsync on a type with no declared stamp answers the world's documents and loads no shelf", async () => {
  reset();
  const pack = shelf({ type: "JournalEntry", docs: [mint("j1", "Entry", "base", "j.x")] });
  game.packs = [pack];
  game.journal = [worldDoc("wj", "World entry", "base", "j.w")];
  assert.equal((await lib.byCookbookIdAsync("JournalEntry", "j.w"))?.id, "wj");
  assert.equal(await lib.byCookbookIdAsync("JournalEntry", "j.x"), null, "a shelf's journal has no row to test the stamp on");
  assert.equal(pack.calls.getDocuments.length, 0);
});

await ok("the synchronous byCookbookId reads the stamp through the index and answers the held twin", async () => {
  reset();
  const pack = shelf({ type: "Actor", docs: [mint("a1", "Twin", "monster", "m.x"), mint("a2", "Other", "monster", "m.y")], held: ["a1"] });
  await pack.getIndex();
  game.packs = [pack];
  assert.equal(lib.byCookbookId("Actor", "m.x")?.id, "a1");
  assert.equal(pack.calls.getDocuments.length, 0);
  const cold = lib.byCookbookId("Actor", "m.y");
  assert.equal(cold, null, "an unheld twin is not in hand yet");
  assert.deepEqual(pack.calls.getDocuments, [{ _id__in: ["a2"] }], "the one document is asked for, not the shelf");
  assert.equal(lib.byCookbookId("Actor", ""), null);
});

await ok("on a warm, unindexed Actor shelf the synchronous byCookbookId answers the held twin", async () => {
  reset();
  const pack = shelf({ type: "Actor", docs: [mint("a1", "Twin", "monster", "m.x"), mint("a2", "Other", "monster", "m.y")], held: ["a1", "a2"] });
  game.packs = [pack];
  assert.equal(pack.indexed, false);
  assert.equal(lib.byCookbookId("Actor", "m.x")?.id, "a1");
  assert.equal(lib.byCookbookId("Actor", "m.y")?.id, "a2");
  assert.equal(pack.calls.getDocuments.length, 0);
});

await ok("the synchronous byCookbookId on a type with no declared stamp reads the documents held", async () => {
  reset();
  const pack = shelf({ type: "JournalEntry", docs: [mint("j1", "Held", "base", "j.x"), mint("j2", "Cold", "base", "j.y")], held: ["j1"] });
  game.packs = [pack];
  assert.equal(lib.byCookbookId("JournalEntry", "j.x")?.id, "j1");
  assert.equal(lib.byCookbookId("JournalEntry", "j.y"), null, "a cold journal shelf answers short and starts nothing");
  assert.deepEqual([pack.calls.getIndex.length, pack.calls.getDocuments.length], [0, 0]);
});

await ok("byCookbookId passes original and prefer on to pickCarrier, the world's first", async () => {
  reset();
  const pack = shelf({ type: "Actor", docs: [mint("a1", "Shelf", "monster", "m.x")], held: ["a1"] });
  await pack.getIndex();
  game.packs = [pack];
  game.actors = [worldDoc("w1", "World copy", "monster", "m.x", { _stats: { duplicateSource: "Actor.zz" } })];
  assert.equal(lib.byCookbookId("Actor", "m.x")?.id, "w1");
  assert.equal(lib.byCookbookId("Actor", "m.x", { original: true })?.id, "a1");
  assert.equal(lib.byCookbookId("Actor", "m.x", { prefer: (d) => d.id === "a1" })?.id, "a1");
});

await ok("cookbookRow is the stamp's projection, template parts skipped, and never a document", async () => {
  reset();
  const pack = shelf({
    type: "Actor",
    docs: [mint("t1", "Part", "monster", "m.x", { templatePart: true }), mint("a1", "Row", "monster", "m.x")],
  });
  await pack.getIndex();
  game.packs = [pack];
  const row = lib.cookbookRow("Actor", "m.x");
  assert.equal(row?.id, "a1");
  assert.equal(row?.name, "Row");
  assert.equal(row?.system, undefined);
  assert.equal(lib.cookbookRow("Actor", "m.none"), null);
  assert.equal(lib.cookbookRow("Actor", ""), null);
  assert.deepEqual([pack.calls.getIndex.length, pack.calls.getDocuments.length], [1, 0]);
});

await ok("cookbookRow on an unindexed shelf starts one index read and redraws its sheet once it lands", async () => {
  reset();
  const pack = shelf({ type: "Actor", docs: [mint("a1", "Row", "monster", "m.x")] });
  game.packs = [pack];
  let renders = 0;
  const sheet = { rendered: true, render: () => renders++ };
  assert.equal(lib.cookbookRow("Actor", "m.x", { redraw: sheet }), null);
  assert.equal(lib.cookbookRow("Actor", "m.x", { redraw: sheet }), null);
  await tick();
  await tick();
  assert.equal(renders, 1);
  assert.equal(lib.cookbookRow("Actor", "m.x", { redraw: sheet })?.id, "a1");
  assert.equal(pack.calls.getIndex.length, 1);
});

await ok("libraryTwinReady awaits the stamp's twin, and is a no-op for an unstamped document", async () => {
  reset();
  const pack = shelf({ type: "Actor", docs: [mint("a1", "Twin", "monster", "m.x")] });
  game.packs = [pack];
  await lib.libraryTwinReady({ documentName: "Actor", flags: {} });
  assert.deepEqual([pack.calls.getIndex.length, pack.calls.getDocuments.length], [0, 0]);
  await lib.libraryTwinReady({ documentName: "Actor", flags: { "acks-extras": { cookbook: { id: "m.x" } } } });
  assert.deepEqual(pack.calls.getDocuments, [{ _id__in: ["a1"] }]);
  assert.equal(lib.byCookbookId("Actor", "m.x")?.id, "a1", "the twin is held once it has resolved");
});

reset();
console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
if (failed) process.exitCode = 1;
