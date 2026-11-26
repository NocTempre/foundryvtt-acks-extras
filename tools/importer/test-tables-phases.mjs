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
 * The apply half also writes builder state onto the imported classes: a leaf a
 * Judge edited since the apply stamped it is held and reported, and the other
 * leaves are written.
 *
 * The world is a mocked Item shelf with a spy on every write, and the table
 * store is the lib registry. Every name and figure below is invented.
 */
import assert from "node:assert";
import * as services from "../../scripts/lib/services.mjs";
import { PRIORITY, getDoc, hasDoc, registerTable, resetTables } from "../../scripts/lib/tables.mjs";
import * as binding from "../../scripts/importer/builder-binding.mjs";
import { BUILDER_DOC_ID, assembleBuilderImport, applyBuilderImport } from "../../scripts/importer/builder-binding.mjs";
import { forgetImportedIndex } from "../../scripts/importer/cookbook.mjs";
import { data as cookbookData } from "../../scripts/importer/cookbook/state.mjs";
import { REPAIR, mergedTally, refreshPlan, repairTally } from "../../scripts/importer/refresh.mjs";
import { editKey, readKey } from "../../scripts/importer/held-edits.mjs";
import { CLASS_TYPE } from "../../scripts/classes/constants.mjs";
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
      collection: game.items,
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

/* --- a class build a Judge edited since the apply stamped it is held ------------------------ */

const CLASS_ID = "cls.t1";
const HD = "system.builder.hdValue";
const THIEVERY = "system.builder.thievery.value";
const RACE = "system.race";
const BUILD_TEXT = "testclass hd 3 fighting 2 thievery 1 arcane 2 folk 1 yields a 500 xp cost";
const isPlain = (v) => !!v && typeof v === "object" && !Array.isArray(v);
/** A document update as Foundry applies it: dotted keys expand, objects merge, arrays replace. */
const mergeAt = (obj, path, value) => {
  const keys = path.split(".");
  let cur = obj;
  for (const k of keys.slice(0, -1)) cur = cur[k] ??= {};
  const last = keys.at(-1);
  if (isPlain(value) && isPlain(cur[last])) for (const [k, v] of Object.entries(value)) mergeAt(cur[last], k, v);
  else cur[last] = structuredClone(value);
};
/** An imported class holding no build yet; its `update` fills the schema's row defaults as the model does. */
const heldClass = () => {
  const doc = {
    id: "cl1".padEnd(16, "0"),
    uuid: "Item.cl1",
    documentName: "Item",
    name: "Testclass",
    type: CLASS_TYPE,
    collection: game.items,
    flags: { "acks-extras": { cookbook: { id: CLASS_ID, cite: "JJ 1" } } },
    system: {
      description: "",
      race: "",
      builder: { enabled: false, hdValue: 0, fighting: { value: 0, sub: "", damageBonus: "" }, thievery: { value: 0, skills: [] }, magic: [], race: { value: -1 }, notes: "" },
    },
    updates: [],
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    },
    toObject() {
      return structuredClone({ _id: this.id, name: this.name, type: this.type, system: this.system, flags: this.flags });
    },
    async update(change) {
      this.updates.push(structuredClone(change));
      writes.update++;
      for (const [k, v] of Object.entries(change)) mergeAt(this, k, v);
      for (const row of this.system.builder.magic) {
        row.label ??= "";
        row.delayed ??= false;
      }
    },
  };
  game.items.set(doc.id, doc);
  cookbookData.content.set("classes", { entries: { [CLASS_ID]: {} } });
  return doc;
};
const readBuilderWithBuild = () =>
  registerTable(
    { id: BUILDER_DOC_ID, tables: { ...structuredClone(RAW), builds: { classes: { a: { runins: [{ label: "Testclass", text: BUILD_TEXT }] } } } } },
    { priority: PRIORITY.WORLD },
  );
/** A world holding one class, with the first apply already run: its leaves written and stamped. */
const stampedClass = async () => {
  clearWorld();
  forgetImportedIndex();
  readBuilderWithBuild();
  const doc = heldClass();
  await applyBuilderImport();
  return doc;
};
const buildWrite = (doc) => doc.updates.filter((u) => "system.builder.enabled" in u).at(-1);
const stampOf = (doc) => doc.flags["acks-extras"].cookbook.read?.builder;

let cls = await stampedClass();
check("the first apply writes the build's leaves", cls.system.builder.hdValue === 3 && cls.system.builder.thievery.value === 1);
check("the first apply stamps what it wrote", stampOf(cls)?.[readKey(HD)] === 3 && stampOf(cls)?.[readKey(RACE)] === "def.race.people1");
const quiet = await applyBuilderImport({ repair: mergedTally() });
check("an apply over its own write reports no edit, the schema's row defaults aside", quiet.edits.length === 0);

await cls.update({ [HD]: 9 });
let tally = mergedTally();
const kept = await applyBuilderImport({ repair: tally });
check("a Judge's edit to a builder leaf is kept", cls.system.builder.hdValue === 9);
check("the build's other leaves are written", !(HD in buildWrite(cls)) && buildWrite(cls)[THIEVERY] === 1);
check("the held edit is reported", kept.edits.length === 1 && kept.edits[0].path === HD && kept.edits[0].current === 9 && kept.edits[0].page === 3);
check("and listed on a merged tally", tally.edits.length === 1 && tally.edits[0].key === editKey(cls.uuid, HD));
check("the stamp keeps what the import last wrote", stampOf(cls)[readKey(HD)] === 3);
const again = await applyBuilderImport({ repair: mergedTally() });
check("the edit is held again on the next apply", cls.system.builder.hdValue === 9 && again.edits.length === 1);
const bare = await applyBuilderImport();
check("an apply under no tally holds it too", cls.system.builder.hdValue === 9 && bare.edits.length === 1);

cls = await stampedClass();
await cls.update({ [RACE]: "uuid:Item.mine" });
const raced = await applyBuilderImport({ repair: mergedTally() });
check("a Judge's race link is kept", cls.system.race === "uuid:Item.mine");
check("the held race link is reported", raced.edits.length === 1 && raced.edits[0].path === RACE && raced.edits[0].page === "def.race.people1");

cls = await stampedClass();
delete cls.flags["acks-extras"].cookbook.read;
await cls.update({ [HD]: 9 });
const unstamped = await applyBuilderImport({ repair: mergedTally() });
check("a leaf with no stamp is written over", cls.system.builder.hdValue === 3 && unstamped.edits.length === 0);
check("and the apply stamps it", stampOf(cls)?.[readKey(HD)] === 3);

cls = await stampedClass();
await cls.update({ [HD]: 9 });
const forced = await applyBuilderImport({ repair: repairTally({ force: true }) });
check("a forced repair writes over a Judge's edit", cls.system.builder.hdValue === 3 && forced.edits.length === 0);

cls = await stampedClass();
await cls.update({ [HD]: 9, [THIEVERY]: 4 });
tally = mergedTally({ take: new Set([editKey(cls.uuid, HD)]), all: "keep" });
await applyBuilderImport({ repair: tally });
check("a decision that takes the key writes over it", cls.system.builder.hdValue === 3);
check("and keeps the edits it does not take", cls.system.builder.thievery.value === 4 && tally.edits.length === 1 && tally.edits[0].path === THIEVERY);

cls = await stampedClass();
const built = { type: CLASS_TYPE, name: "Testclass", system: { description: "page text" }, flags: { "acks-extras": { cookbook: { id: CLASS_ID, cite: "JJ 2" } } } };
await cls.update(refreshPlan(cls.toObject(), built, REPAIR.class).update);
check("a class repair's write leaves the builder stamp standing", stampOf(cls)?.[readKey(HD)] === 3);
await cls.update({ [HD]: 9 });
const afterRepair = await applyBuilderImport({ repair: mergedTally() });
check("an edit made after a class repair is held", cls.system.builder.hdValue === 9 && afterRepair.edits.length === 1);

const row = (label) => ({ system: { builder: { magic: [{ type: "arcane", label, value: 2, delayed: false }] } } });
const wrote = { "system.builder.magic": [{ type: "arcane", value: 2 }] };
const stamp0 = binding.heldBuilderLeaves(row(""), wrote, undefined).stamp;
check("a stored row the schema filled with blanks still holds what was written", binding.heldBuilderLeaves(row(""), wrote, stamp0).edits.length === 0);
check("a row field a Judge filled is an edit", binding.heldBuilderLeaves(row("Runes"), wrote, stamp0).edits.length === 1);
cookbookData.content.delete("classes");

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
