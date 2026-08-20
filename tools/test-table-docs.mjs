/**
 * Materializing imported rules tables: how many WRITES it costs.
 *
 * `materializeAll()` runs automatically after every table import, so the count
 * of round trips is the behaviour under test, not an implementation detail —
 * one write per document is what made a six-book world take minutes. These
 * tests drive the real function against a mock world that records every call,
 * and assert both the resulting documents and the number of calls it took.
 *
 * The mock is deliberately thin: it models what this code actually uses —
 * document collections with `find`/`filter`, embedded page collections, and
 * flags — and nothing else.
 */
import assert from "node:assert/strict";

let passed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    passed++;
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
};

/* -------------------------------------------- */
/*  A world just real enough                    */
/* -------------------------------------------- */

const MODULE_ID = "acks-extras";

/** Calls recorded per world, so a test can assert the round-trip count. */
let calls;
const record = (what) => calls.push(what);

let nextId = 0;
const mkId = () => `id${++nextId}`;

/**
 * What an HTML field does to plain text on the way in: a bare `&` is not
 * valid markup, so it is normalized to `&amp;` — while real tags are left
 * alone. Live-observed on TableResult#description, and modelled here because
 * it silently defeated the unchanged-results comparison: two tables whose
 * wording contains "&" rebuilt themselves on every single pass.
 */
const htmlNormalize = (s) => String(s ?? "").replace(/&(?!(?:amp|lt|gt|quot|#39);)/g, "&amp;");

/** A document: flags read through getFlag, everything else a plain field. */
function doc(data, extra = {}) {
  const d = {
    id: data._id ?? mkId(),
    ...data,
    flags: data.flags ?? {},
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    },
    async setFlag(scope, key, value) {
      record("setFlag");
      this.flags[scope] = { ...(this.flags[scope] ?? {}), [key]: value };
    },
    ...extra,
  };
  d.uuid = `${d.id}`;
  return d;
}

/** A world collection with the two accessors this code uses. */
class Coll extends Array {
  find(fn) {
    return Array.prototype.find.call(this, fn) ?? undefined;
  }
  filter(fn) {
    return Array.prototype.filter.call(this, fn);
  }
}

/**
 * A RollTable, with an embedded results collection.
 *
 * `folder` resolves to the Folder DOCUMENT, as Foundry does — creation and
 * update data carry the id, the document exposes the folder. The distinction
 * matters: the code compares `table.folder?.id` against the id it would
 * write, and a mock that stored the raw string would let a broken comparison
 * pass.
 */
function table(data) {
  const t = doc(data);
  t.folder = data.folder ? ([...game.folders].find((f) => f.id === data.folder) ?? null) : null;
  const result = (r) => doc({ ...r, description: htmlNormalize(r.description) });
  t.results = new Coll(...(data.results ?? []).map(result));
  t.deleteEmbeddedDocuments = async (type, ids) => {
    record(`table.delete:${ids.length}`);
    t.results = new Coll(...[...t.results].filter((r) => !ids.includes(r.id)));
  };
  t.createEmbeddedDocuments = async (type, rows) => {
    record(`table.create:${rows.length}`);
    // Read back in a DIFFERENT order than it was written: Foundry's embedded
    // collections do not promise to hand back the array they were given, and
    // live testing found tables whose stored order was permanently scrambled
    // after a rebuild. Reversing here is the cheapest faithful stand-in — a
    // comparison that depends on position fails against it, which is exactly
    // what sent three tables into rebuilding themselves forever.
    t.results = new Coll(...[...t.results, ...rows.map(result)].reverse());
  };
  t.update = async (changes) => {
    record("table.update");
    Object.assign(t, changes);
  };
  return t;
}

/** A JournalEntry, with an embedded pages collection. */
function journalDoc(data) {
  const j = doc(data);
  j.pages = new Coll(...(data.pages ?? []).map((p) => doc({ ...p })));
  j.createEmbeddedDocuments = async (type, rows) => {
    record(`page.create:${rows.length}`);
    const made = rows.map((r) => doc({ ...r }));
    j.pages = new Coll(...[...j.pages, ...made]);
    return made;
  };
  j.updateEmbeddedDocuments = async (type, rows) => {
    record(`page.update:${rows.length}`);
    for (const row of rows) {
      const page = [...j.pages].find((p) => p.id === row._id);
      if (row["text.content"] !== undefined) page.text = { ...(page.text ?? {}), content: row["text.content"] };
    }
  };
  j.deleteEmbeddedDocuments = async (type, ids) => {
    record(`page.delete:${ids.length}`);
    j.pages = new Coll(...[...j.pages].filter((p) => !ids.includes(p.id)));
  };
  return j;
}

/**
 * Install a world. `tables` is the ruledata registry this materialize reads;
 * `expected` is what consumers want but no import provided.
 */
function world({ registry = {}, expected = [] } = {}) {
  calls = [];
  globalThis.game = {
    tables: new Coll(),
    journal: new Coll(),
    folders: new Coll(),
    i18n: { localize: (k) => k, format: (k) => k },
  };
  globalThis.CONST = { JOURNAL_ENTRY_PAGE_FORMATS: { HTML: 1 } };
  globalThis.foundry = { utils: { deepClone: (v) => structuredClone(v) } };
  globalThis.RollTable = {
    async createDocuments(rows) {
      record(`RollTable.createDocuments:${rows.length}`);
      const made = rows.map((r) => table(r));
      game.tables.push(...made);
      return made;
    },
    async updateDocuments(rows) {
      record(`RollTable.updateDocuments:${rows.length}`);
      for (const row of rows) {
        const t = [...game.tables].find((x) => x.id === row._id);
        for (const [k, v] of Object.entries(row)) {
          if (k === "_id") continue;
          if (k.startsWith("flags.")) {
            const [, scope, key] = k.split(".");
            t.flags[scope] = { ...(t.flags[scope] ?? {}), [key]: v };
          } else if (k === "folder") {
            t.folder = v ? ([...game.folders].find((f) => f.id === v) ?? null) : null;
          } else t[k] = v;
        }
      }
    },
    async deleteDocuments(ids) {
      record(`RollTable.deleteDocuments:${ids.length}`);
      game.tables = new Coll(...[...game.tables].filter((t) => !ids.includes(t.id)));
    },
  };
  globalThis.Folder = {
    async create(data) {
      record("Folder.create");
      const f = doc(data);
      f.folder = data.folder ? [...game.folders].find((x) => x.id === data.folder) : null;
      game.folders.push(f);
      return f;
    },
    async createDocuments(rows) {
      record(`Folder.createDocuments:${rows.length}`);
      const made = rows.map((r) => {
        const f = doc(r);
        f.folder = r.folder ? [...game.folders].find((x) => x.id === r.folder) : null;
        return f;
      });
      game.folders.push(...made);
      return made;
    },
    async deleteDocuments(ids) {
      record(`Folder.deleteDocuments:${ids.length}`);
      game.folders = new Coll(...[...game.folders].filter((f) => !ids.includes(f.id)));
    },
  };
  globalThis.JournalEntry = {
    async create(data) {
      record("JournalEntry.create");
      const j = journalDoc(data);
      game.journal.push(j);
      return j;
    },
  };
  globalThis.acksExtras = {
    lib: {
      tables: {
        PRIORITY: { WORLD: 20 },
        docInfo: () => Object.keys(registry).map((id) => ({ id, priority: 20 })),
        getDoc: (id) => ({ id, tables: registry[id] }),
        getTable: (docId, tableId) => registry[docId]?.[tableId],
        expectedTables: () => expected,
      },
    },
  };
}

const { materializeAll, entryLabel, parseDrop } = await import("../scripts/location/table-docs.mjs");

/** Write calls only — the folder/journal lookups are reads. */
const writeCount = () => calls.length;

/* -------------------------------------------- */
/*  Naming                                      */
/* -------------------------------------------- */

await test("a dotted key becomes a reader-facing label", () => {
  assert.equal(entryLabel("people.classPercentages.level.0"), "Class Percentages — Level 0");
  assert.equal(entryLabel("rarity.classDistribution.bucket.arcane"), "Class Distribution — Bucket Arcane");
  assert.equal(entryLabel("people.dwarvenCastes"), "Dwarven Castes");
});

/* -------------------------------------------- */
/*  Batching                                    */
/* -------------------------------------------- */

/** A registry with `n` weighted class rows — each row is one RollTable. */
const manyRollables = (n) => ({
  people: {
    classPercentages: {
      rows: Array.from({ length: n }, (_, i) => ({ minLevel: i, weights: { Fighter: 60, Mage: 40 } })),
    },
  },
});

await test("every new table is created in ONE call, whatever the count", async () => {
  world({ registry: manyRollables(40) });
  const report = await materializeAll();
  assert.equal(report.exported, 40, "one entry per level row");
  assert.equal(game.tables.length, 40);
  const creates = calls.filter((c) => c.startsWith("RollTable.createDocuments"));
  assert.equal(creates.length, 1, "one create call, not forty");
  assert.equal(creates[0], "RollTable.createDocuments:40");
  // The whole pass: one root folder, one child folder, one create.
  assert.ok(writeCount() <= 3, `expected at most 3 writes, got ${writeCount()}: ${calls.join(", ")}`);
});

await test("tables land in a per-doc subfolder under one flagged root", async () => {
  world({ registry: manyRollables(3) });
  await materializeAll();
  const root = [...game.folders].find((f) => !f.folder);
  const child = [...game.folders].find((f) => f.folder);
  assert.equal(root.name, "ACKS Imported Tables");
  assert.equal(root.getFlag(MODULE_ID, "ruledataDocs"), true);
  assert.equal(child.name, "People", "humanized doc id");
  assert.ok([...game.tables].every((t) => t.folder?.id === child.id), "every table filed in it");
});

await test("re-materializing changes nothing and writes NOTHING AT ALL", async () => {
  world({ registry: manyRollables(25) });
  await materializeAll();
  const before = [...game.tables].map((t) => t.id);
  calls = [];
  const report = await materializeAll();
  assert.deepEqual([...game.tables].map((t) => t.id), before, "adopted by flag, never duplicated or replaced");
  assert.equal(report.exported, 25, "still reports every entry as materialized");
  // Not one write: an unchanged pass must not even stamp _stats.modifiedTime.
  assert.deepEqual(calls, [], `an unchanged re-materialize must write nothing: ${calls.join(", ")}`);
});

await test("adoption is by flag, so a renamed table keeps its identity", async () => {
  world({ registry: manyRollables(2) });
  await materializeAll();
  const renamed = [...game.tables][0];
  renamed.name = "The Judge's own name for it";
  calls = [];
  await materializeAll();
  assert.equal(game.tables.length, 2, "still two tables — the rename did not orphan one");
  assert.ok(
    [...game.tables].some((t) => t.id === renamed.id),
    "the same document was updated, not replaced",
  );
  assert.equal(renamed.name, "Class Percentages — Level 0", "and materialization renamed it back");
  // Exactly one table drifted, so exactly one rides the update call.
  assert.deepEqual(calls, ["RollTable.updateDocuments:1"], `only the drifted table updates: ${calls.join(", ")}`);
});

await test("a legacy raw-key name is adopted and migrated once", async () => {
  world({ registry: manyRollables(1) });
  // A world materialized before the flag existed: named by raw key, unfiled.
  const legacy = table({ name: "people.classPercentages.level.0", folder: null, results: [] });
  game.tables.push(legacy);
  await materializeAll();
  assert.equal(game.tables.length, 1, "adopted rather than duplicated");
  const t = [...game.tables][0];
  assert.equal(t.id, legacy.id, "the same document");
  assert.equal(t.name, "Class Percentages — Level 0", "renamed");
  assert.equal(t.getFlag(MODULE_ID, "tableKey"), "people.classPercentages.level.0", "and stamped");
  assert.equal(t.folder?.name, "People", "and filed under its doc's subfolder");
  assert.equal(t.results.length, 2, "and its empty result set was rebuilt from the registry");
});

await test("an ampersand in the book's own wording does not rebuild forever", async () => {
  // Live-found: the two occupation tables whose entries read "grain &
  // vegetables" and "armor & weapons" were deleted and recreated on EVERY
  // pass, because the stored text comes back HTML-normalized and the
  // comparison was against the raw spec.
  world({
    registry: {
      people: {
        occupationSubTables: {
          categories: {
            merchant: {
              rows: [
                { min: 1, max: 50, occupation: "grocer", special: "grain & vegetables" },
                { min: 51, max: 100, occupation: "armorer", special: "armor & weapons" },
              ],
            },
          },
        },
      },
    },
  });
  await materializeAll();
  const stored = [...[...game.tables][0].results].map((r) => r.description);
  assert.ok(stored[0].includes("&amp;"), "the mock stores what an HTML field stores");
  calls = [];
  await materializeAll();
  assert.deepEqual(calls, [], `escaped text must still compare equal: ${calls.join(", ")}`);
});

await test("a dropped table reads back the words, not the entities", async () => {
  // The same normalization on the way OUT: an override rebuilt from a table
  // the Judge edited must put "grain & vegetables" into the rules data, or
  // every later reader gets the entity instead of the character.
  world({
    registry: {
      people: {
        occupationSubTables: {
          categories: { merchant: { rows: [{ min: 1, max: 100, occupation: "grocer", special: "grain & vegetables" }] } },
        },
      },
    },
  });
  await materializeAll();
  const dropped = [...game.tables][0];
  globalThis.fromUuid = async () => ({ ...dropped, documentName: "RollTable", results: dropped.results, uuid: dropped.uuid });
  const entry = { docId: "people", tableId: "occupationSubTables", subId: "merchant", key: "people.occupationSubTables.merchant", rollable: true };
  const { data } = await parseDrop(entry, { uuid: dropped.uuid });
  const row = data.categories.merchant.rows[0];
  assert.equal(row.occupation, "grocer");
  assert.equal(row.special, "grain & vegetables", "decoded back to the character the book prints");
});

await test("changed data rebuilds only the tables that moved", async () => {
  world({ registry: manyRollables(10) });
  await materializeAll();
  // One row's weights change; the other nine are untouched.
  acksExtras.lib.tables.getTable("people", "classPercentages").rows[3].weights = { Fighter: 10, Mage: 90 };
  calls = [];
  await materializeAll();
  const rebuilds = calls.filter((c) => c.startsWith("table.delete")).length;
  assert.equal(rebuilds, 1, `only the changed table rebuilds, got ${rebuilds}: ${calls.join(", ")}`);
});

await test("a table that rebuilt once does not rebuild forever after", async () => {
  // The live failure, in sequence: a rebuild stores the rows back in some
  // other order, and a comparison that reads position calls that a change —
  // so the table rebuilds on every pass from then on, for good.
  world({ registry: manyRollables(6) });
  await materializeAll();
  acksExtras.lib.tables.getTable("people", "classPercentages").rows[2].weights = { Fighter: 1, Mage: 99 };
  await materializeAll(); // the one legitimate rebuild
  calls = [];
  await materializeAll();
  assert.deepEqual(calls, [], `a settled table must stay settled: ${calls.join(", ")}`);
  calls = [];
  await materializeAll();
  assert.deepEqual(calls, [], "and stay settled on every pass after that");
});

/* -------------------------------------------- */
/*  Journal pages                               */
/* -------------------------------------------- */

/** Non-rollable tables — these materialize as JSON journal pages. */
const manyPages = (n) =>
  Object.fromEntries([["people", Object.fromEntries(Array.from({ length: n }, (_, i) => [`grid${i}`, { rows: [i] }]))]]);

await test("every new page is created in ONE call", async () => {
  world({ registry: manyPages(30) });
  const report = await materializeAll();
  assert.equal(report.exported, 30);
  const journal = [...game.journal][0];
  assert.equal(journal.pages.length, 30);
  const creates = calls.filter((c) => c.startsWith("page.create"));
  assert.equal(creates.length, 1);
  assert.equal(creates[0], "page.create:30");
});

await test("re-materializing unchanged pages writes nothing", async () => {
  world({ registry: manyPages(12) });
  await materializeAll();
  calls = [];
  await materializeAll();
  assert.equal(
    calls.filter((c) => c.startsWith("page.")).length,
    0,
    `identical content must not be rewritten: ${calls.join(", ")}`,
  );
});

await test("changed pages update in one call, and only the changed ones", async () => {
  world({ registry: manyPages(12) });
  await materializeAll();
  acksExtras.lib.tables.getTable("people", "grid5").rows = [999];
  calls = [];
  await materializeAll();
  const updates = calls.filter((c) => c.startsWith("page.update"));
  assert.deepEqual(updates, ["page.update:1"], `one call, one page: ${calls.join(", ")}`);
});

await test("expected-but-missing tables get one placeholder each", async () => {
  world({ registry: manyPages(2), expected: [{ docId: "wages", tableIds: ["labour", "skilled"] }] });
  const report = await materializeAll();
  assert.equal(report.placeholders, 2);
  const journal = [...game.journal][0];
  assert.ok([...journal.pages].some((p) => p.name === "wages.labour"));
  // Placeholders ride the same single create call as the real pages.
  assert.deepEqual(calls.filter((c) => c.startsWith("page.create")), ["page.create:4"]);
});

await test("a page whose table became rollable is retired after the writes", async () => {
  world({ registry: manyPages(3) });
  await materializeAll();
  const journal = [...game.journal][0];
  assert.equal(journal.pages.length, 3);
  // The same doc now ships one rollable table instead of the three grids.
  world({ registry: manyRollables(2) });
  game.journal.push(journal);
  await materializeAll();
  assert.equal(journal.pages.length, 0, "the stale JSON pages are swept");
  assert.ok(
    calls.indexOf(calls.find((c) => c.startsWith("page.delete"))) === calls.length - 1,
    "and swept LAST, after the writes landed",
  );
});

await test("a world with no JSON tables gets no empty journal", async () => {
  world({ registry: manyRollables(2) });
  await materializeAll();
  assert.equal(game.journal.length, 0, "an empty ruledata journal is clutter, not a fixture");
});

console.log(`test-table-docs: ${passed} tests passed`);
