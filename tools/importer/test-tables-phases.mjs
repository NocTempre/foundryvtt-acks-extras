/**
 * The rules-tables import in two phases: a read that fills the table store and an
 * apply that writes world documents.
 *
 * The read half assembles the engine tables through `importDoc` and creates and
 * updates no document, so class pricing finds its budget before any class
 * exists. The apply half calls no `importDoc` and writes only for the documents
 * a read named. The import chain hands the first its read and the second that
 * read's report.
 *
 * The world is a mocked Item shelf with a spy on every write, and the table
 * store is the lib registry. Every name and figure below is invented.
 */
import assert from "node:assert";
import * as services from "../../scripts/lib/services.mjs";
import { PRIORITY, getDoc, hasDoc, registerTable, resetTables } from "../../scripts/lib/tables.mjs";
import { BUILDER_DOC_ID, assembleBuilderImport, applyBuilderImport } from "../../scripts/importer/builder-binding.mjs";
import { assembleReadTables, applyReadTables } from "../../scripts/importer/tables-phases.mjs";
import { LANGUAGES_DOC_ID } from "../../scripts/importer/language-binding.mjs";
import { GM_STEPS } from "../../scripts/importer/getting-started.mjs";

let pass = 0;
const check = (label, cond) => {
  assert.ok(cond, label);
  pass++;
};

/* --- the world: every write is counted ------------------------------------------------ */

const writes = { create: 0, update: 0 };
const imports = [];
class Coll extends Map {
  *[Symbol.iterator]() {
    yield* this.values();
  }
  find(fn) {
    for (const v of this.values()) if (fn(v)) return v;
    return undefined;
  }
  filter(fn) {
    return [...this.values()].filter(fn);
  }
  some(fn) {
    return [...this.values()].some(fn);
  }
  map(fn) {
    return [...this.values()].map(fn);
  }
}
class MockItem {
  static documentName = "Item";
  static async create(data) {
    writes.create++;
    const doc = {
      ...structuredClone(data),
      id: `it${writes.create}`.padEnd(16, "0"),
      documentName: "Item",
      getFlag(scope, key) {
        return this.flags?.[scope]?.[key];
      },
      async update() {
        writes.update++;
      },
    };
    game.items.set(doc.id, doc);
    return doc;
  }
  static async createDocuments(list) {
    return Promise.all(list.map((d) => MockItem.create(d)));
  }
}
const notices = [];
globalThis.ui = { notifications: { info: (m) => notices.push(m), warn: (m) => notices.push(m), error: (m) => notices.push(m) } };
globalThis.game = {
  user: { isGM: true },
  i18n: { localize: (k) => k, format: (k, d) => `${k}|${JSON.stringify(d)}` },
  settings: { get: () => undefined },
  items: new Coll(),
  actors: new Coll(),
  folders: new Coll(),
  collections: new Map([["Item", new Coll()]]),
  packs: new Coll(),
};
globalThis.CONFIG = { Item: { dataModels: {} } };
globalThis.Item = MockItem;
globalThis.Folder = { async create(data) { return { ...data, id: "fo".padEnd(16, "0") }; } };
globalThis.foundry = { utils: { deepClone: (x) => structuredClone(x), mergeObject: (a, b) => ({ ...a, ...b }) } };

/** The provider the import runs through: what it writes lands in the lib registry. */
const provide = () => {
  services.resetServices();
  services.register("ruledata-import", {
    async importDoc(doc, opts) {
      imports.push(doc.id);
      registerTable(doc, { priority: opts.priority });
    },
  });
};
const clearWorld = () => {
  resetTables();
  provide();
  game.items.clear();
  imports.length = 0;
  writes.create = 0;
  writes.update = 0;
  notices.length = 0;
};

/** What a page read leaves in the store: raw tables for one invented race and a figure for pricing. */
const RAW = {
  basePoints: { basePoints: 7 },
  smoothing: { level: 3, nearest: 5 },
  people1Raw: { 0: { label: "folk one", cost: 3 }, 1: { label: "folk one II", cost: 4 } },
  people1Powers: { powers: [] },
  people1Rules: {},
};
const readBuilder = () => registerTable({ id: BUILDER_DOC_ID, tables: structuredClone(RAW) }, { priority: PRIORITY.WORLD });

/* --- the read half writes the store and nothing else ---------------------------------- */

clearWorld();
check("an empty store holds no builder tables", !hasDoc(BUILDER_DOC_ID));
readBuilder();
check("the page read alone leaves no pricing budget", getDoc(BUILDER_DOC_ID).tables.budget === undefined);
const report = await assembleBuilderImport();
check("assembling names the engine tables it wrote", report.assembled.includes("budget"));
check("assembling goes through importDoc", imports.length === 1 && imports[0] === BUILDER_DOC_ID);
check("assembling creates and updates no document", writes.create === 0 && writes.update === 0);

/* --- the goal: class pricing's input exists after the read phase alone ------------------ */

clearWorld();
check("from an empty store there is no budget to price a class by", !hasDoc(BUILDER_DOC_ID));
readBuilder();
await assembleReadTables([BUILDER_DOC_ID]);
const priced = hasDoc(BUILDER_DOC_ID) ? (getDoc(BUILDER_DOC_ID).tables ?? null) : null;
check("after the read phase the pricing budget is present", priced?.budget?.basePoints === 7);
check("and the raw reads stay beside the assembled tables", priced?.people1Raw?.[0]?.cost === 3);
check("the read phase wrote no world document", writes.create === 0 && writes.update === 0);
check("the races are not an engine table, so none was stored", priced?.races === undefined);

/* --- the apply half calls no importDoc and writes what it is named ---------------------- */

imports.length = 0;
await applyBuilderImport();
check("applying the builder tables calls no importDoc", imports.length === 0);
check("applying the builder tables writes the race the store describes", writes.create === 1);
check("the race is the one the raw tables name", [...game.items.values()][0]?.system?.key === "people1");

clearWorld();
readBuilder();
await assembleReadTables([BUILDER_DOC_ID]);
imports.length = 0;
await applyReadTables([BUILDER_DOC_ID]);
check("applyReadTables calls no importDoc", imports.length === 0);
check("applyReadTables writes the races of the named builder doc", writes.create === 1);

clearWorld();
readBuilder();
registerTable({ id: LANGUAGES_DOC_ID, tables: {} }, { priority: PRIORITY.WORLD });
await assembleReadTables([BUILDER_DOC_ID]);
await applyReadTables([LANGUAGES_DOC_ID]);
check("a report naming another document applies nothing of the builder's", writes.create === 0 && writes.update === 0);

clearWorld();
readBuilder();
await applyReadTables([]);
check("an apply with nothing named writes nothing", writes.create === 0 && writes.update === 0 && notices.length === 0);

/* --- the chain: the first step's report is the second's input --------------------------- */

const stepOf = (key) => GM_STEPS.find(([k]) => k === key)[1];
const READ = { imported: [{ docId: BUILDER_DOC_ID, tables: [] }], missingBooks: [], missingTables: [] };
const calls = [];
const api = new Proxy(
  {
    cookbookImportTables: async (only, opts) => {
      calls.push({ only, opts });
      return opts?.phase === "read" ? READ : (opts?.read ?? null);
    },
  },
  { get: (target, name) => target[name] ?? (async () => null) },
);
const run = {};
await stepOf("stepTables")(api, { quiet: true, run });
await stepOf("stepTablesApply")(api, { quiet: true, run });
check("in the chain the tables step reads only", calls[0].opts.phase === "read" && calls[0].only === null);
check("the read's report waits in the run object", run.tables === READ);
check("the apply step applies that report and reads no page", calls[1].opts.phase === "apply" && calls[1].opts.read === READ);

calls.length = 0;
const failed = {};
const failing = new Proxy({ cookbookImportTables: async () => null }, { get: (target, name) => target[name] ?? (async () => null) });
await stepOf("stepTables")(failing, { quiet: true, run: failed });
check("a read that resolved null leaves an empty report", Array.isArray(failed.tables?.imported) && failed.tables.imported.length === 0);

calls.length = 0;
await stepOf("stepTables")(api, { quiet: true });
await stepOf("stepTablesApply")(api, { quiet: true });
check("run alone, each tables step reads and applies in one call",
  calls.length === 2 && calls.every((c) => c.only === undefined && c.opts === undefined));

console.log(`test-tables-phases: ${pass} checks passed.`);
