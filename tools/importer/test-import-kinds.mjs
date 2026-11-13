/**
 * The import kind declaration (`IMPORT_KINDS`) and the run set derived from it.
 *
 * A kind is one family of imported documents with the claims it owns, the book
 * each is read from and the run that re-creates it. The first half drives the
 * pure derivation (`import-kinds.mjs`) over a toy declaration. The second half
 * loads a small cookbook with one entry of every kind and holds the live
 * declaration to four lines: every claim is owned by at most one kind, counted
 * per claim so no overlap hides behind an array order; every entry source,
 * table shelf, adventure step and refill run maps to a kind; and `runSetFor`
 * answers each scope as the commands answer it, the commands being driven with
 * a recording api in place of the importers.
 *
 * Where the commands answer differently from one another, the pins say which.
 * A book repair names the entry-backed shelves and the vehicles, a book's own
 * items and the printed tables, and the price list rides the equipment run; a
 * book with a cookbook of its own has its own rows (creatures, pages, places,
 * tables) written by one more run. `viaBook` declares the first of these, and
 * `cookbookRunSet` answers it.
 */
import assert from "node:assert";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ancestorsOf, groupBookOf, groupId, ownersOf, kindOf, booksOfKind, runSetFor, claimerPasses, ADVENTURE_BOOK_RUN,
} from "../../scripts/importer/import-kinds.mjs";
import { placePairs } from "../../scripts/importer/place-pair.mjs";
import {
  IMPORT_KINDS, ENTRY_SOURCES, SHELF_REFILL, REPAIR_RUNS, TABLE_BOOKS, cookbookRunSet, cookbookReimportShelf, cookbookReimportBook,
  cookbookReimportAdventure, cookbookReimportEntries, reimportableShelves, initCookbook, loadCookbook, isRewriting, placeBlockRows,
  withRewrite, createDoc, keepsJudgeProse, keepsJudgeFigure, marketTakes, recreateUnderId, rewriteTable, repairPregens, writeRowBlock,
  writeJournalPage, cookbookCount,
} from "../../scripts/importer/cookbook.mjs";
import { mergedTally } from "../../scripts/importer/refresh.mjs";
import { playStamp, pregenDefault } from "../../scripts/importer/held-edits.mjs";
import { blockDigest, bookTable, bookText, readableText, sumKey, sumsUpdate } from "../../scripts/importer/prose.mjs";
import { TABLE_RECIPES } from "../../scripts/importer/table-recipes.mjs";
import { BOOKS, bookIsJudges } from "../../scripts/importer/books.mjs";
import { GM_STEPS } from "../../scripts/importer/getting-started.mjs";
import { libraryPackLabel } from "../../scripts/lib/library.mjs";

let pass = 0;
const check = (label, cond) => {
  assert.ok(cond, label);
  pass++;
};
const same = (label, a, b) => {
  assert.deepStrictEqual(a, b, label);
  pass++;
};

/* --- the pure derivation, over a toy declaration --- */

{
  same("a claim's ancestors are its dot-prefixes of two segments or more, longest first", ancestorsOf("a.b.c.d"), ["a.b.c.d", "a.b.c", "a.b"]);
  same("a single segment names no entry", ancestorsOf("a"), []);
  // The picker lists a per-step creature under its generator's id, and a rebuild
  // has to find that id's book to refuse a closed one.
  same("a generator id names its book and its group", groupId("zzb", "kind"), "zzb.group.kind");
  same("the book is read back from a generator id", groupBookOf(groupId("zzb", "kind")), "zzb");
  same("a dotted book id survives the round trip", groupBookOf(groupId("zz.rt", "kind")), "zz.rt");
  same("an entry's own id is not a generator id", groupBookOf("zzb.entry1"), null);
  same("a group key with a dot is not a generator id", groupBookOf("zzb.group.a.b"), null);
  same("a missing id is not a generator id", groupBookOf(undefined), null);

  const books = { x: ["x"], y: ["y"] };
  const kind = (key, run, extra = {}) => ({
    key,
    entries: () => [[`${key}.1`, {}]],
    owns: (claim) => claim.startsWith(`${key}.`),
    make: { run, takes: [] },
    ...extra,
    book: () => extra.readFrom ?? "x",
  });
  const kinds = [
    kind("A", "runA", { shelves: ["S"], viaBook: true, chain: "stepA" }),
    kind("B", "runB", { shelves: ["S"], viaBook: true, chain: "stepB" }),
    kind("C", "runC", { own: true, bookSteps: ["stepC"], chain: "stepC" }),
    kind("D", "runC", { viaBook: true, readFrom: "y", chain: "stepD" }),
    kind("E", "runE", { own: true, chain: "stepE", make: { run: "runE", takes: [], whole: "runWhole" } }),
  ];
  const world = { kinds, order: { book: ["runB", "runA"], all: ["stepE", "stepD", "stepC", "stepB", "stepA"] } };
  check("two kinds that share a shelf share one run each", runSetFor({ shelf: "S" }, world).runs.map((r) => r.run).join() === "runA,runB");
  check("a shelf no kind files on has no run", runSetFor({ shelf: "none" }, world).runs.length === 0);
  const book = runSetFor({ book: "x" }, world);
  check("a book scope runs what its viaBook kinds name, in the order given", book.runs.map((r) => r.run).join() === "runB,runA,runAdventureBookSteps");
  check("and an adventure book's own rows are one run, not their own", book.runs.at(-1).kinds.join() === "C" &&book.runs.at(-1).book === "x");
  check("every book's own rows are named, whatever the book is", runSetFor({ book: "x" }, world).runs.some((r) => r.run === ADVENTURE_BOOK_RUN && r.kinds.join() === "C"));
  check("a kind read from another book is left out of this one", !book.runs.some((r) => r.kinds.includes("D")));
  const picked = runSetFor({ entries: ["A.1", "B.9", "C.2", "ghost.1"] }, world);
  check("a ticked claim goes to its kind's run, carrying its id", picked.runs.map((r) => `${r.run}:${r.ids}`).join() === "runA:A.1,runB:B.9,runC:C.2");
  check("a claim no kind owns is returned, not run", picked.unowned.join() === "ghost.1");
  const all = runSetFor({ all: true }, world);
  check("everything is each kind's whole run once, in the chain's order", all.runs.map((r) => r.run).join() === "runWhole,runC,runB,runA");
  check("kinds that share a run share it", all.runs.find((r) => r.run === "runC").kinds.join() === "C,D");
  try {
    kindOf([kind("A", "r"), { ...kind("A2", "r"), owns: (c) => c.startsWith("A.") }], "A.1");
    check("two owners of one claim throw", false);
  } catch (err) {
    check("two owners of one claim throw", /owned by A, A2/.test(err.message));
  }
  check("no owner is null", kindOf(kinds, "ghost.1") === null);
  check("a scope of no known shape throws", (() => { try { runSetFor({ x: 1 }, world); return false; } catch { return true; } })());
  check("booksOfKind reads a kind's own books first, else its claims'", booksOfKind({ books: () => ["q"] }).join() === "q" && booksOfKind(kinds[3]).join() === "y");
  // A kind that is both a book's own rows and named by a book scope: on any
  // book its claims ride the book's own run alone, never twice.
  const both = [kind("F", "runF", { own: true, bookSteps: ["stepF"], viaBook: true, chain: "stepF" })];
  const onBook = runSetFor({ book: "x" }, { kinds: both });
  same("a book's own kind runs under the book's own run only", onBook.runs.map((r) => `${r.run}:${r.kinds}`), [`${ADVENTURE_BOOK_RUN}:F`]);
  void books;
}

/* --- the mocks: a library of Item and Actor shelves, and a recording api --- */

const MODULE_ID = "acks-extras";
const claim = (id) => ({ [MODULE_ID]: { cookbook: { id } } });
let minted = 0;
const mint = () => `minted${String(++minted).padStart(10, "0")}`;

const makeShelf = (type) => {
  const collection = `world.acks-cookbook--${type.toLowerCase()}`;
  const shelf = {
    collection,
    documentName: type,
    metadata: { packageType: "world", label: libraryPackLabel(type), type },
    index: new Map(),
    docs: new Map(),
    async getDocuments() {
      return [...this.docs.values()];
    },
    async getIndex() {
      return [...this.docs.values()].map((d) => ({ _id: d.id, flags: d.flags }));
    },
    async getDocument(id) {
      return this.docs.get(id) ?? null;
    },
  };
  const cls = {
    documentName: type,
    async deleteDocuments(ids, { pack } = {}) {
      const target = pack === collection ? shelf : null;
      return ids.map((id) => {
        const doc = target?.docs.get(id);
        target?.docs.delete(id);
        target?.index.delete(id);
        return doc;
      }).filter(Boolean);
    },
  };
  return { shelf, cls };
};
const items = makeShelf("Item");
const actors = makeShelf("Actor");

/** An imported Item as the library holds it. */
const stockItem = (id) => {
  const _id = mint();
  const doc = {
    id: _id,
    _id,
    name: id,
    type: "item",
    pack: items.shelf.collection,
    documentName: "Item",
    flags: claim(id),
    get uuid() {
      return `Compendium.${items.shelf.collection}.Item.${this.id}`;
    },
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key] ?? null;
    },
  };
  items.shelf.docs.set(_id, doc);
  items.shelf.index.set(_id, { _id });
};
const emptyShelves = () => {
  for (const { shelf } of [items, actors]) {
    shelf.docs.clear();
    shelf.index.clear();
  }
};

const packs = [items.shelf, actors.shelf];
const confirmed = [];
globalThis.game = {
  packs: {
    filter: (fn) => packs.filter(fn),
    find: (fn) => packs.find(fn),
    get: (collection) => packs.find((p) => p.collection === collection) ?? null,
  },
  items: [],
  actors: [],
  journal: [],
  tables: [],
  scenes: [],
  folders: [],
  collections: new Map([["Item", []], ["Actor", []], ["JournalEntry", []], ["RollTable", []], ["Scene", []]]),
  user: { isGM: true },
  settings: { get: () => ({}) },
  i18n: { format: () => "", localize: () => "" },
};
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };

/** The picker's ticked rows, set before each drive; the mocked prompt presses OK on them. */
let ticked = [];
globalThis.foundry = {
  utils: {
    getDocumentClass: (type) => (type === "Actor" ? actors.cls : items.cls),
    escapeHTML: (x) => x,
    fetchJsonWithTimeout: async (url) => {
      const name = String(url).split("/").pop();
      if (!(name in served)) throw new Error(`not served: ${name}`);
      return served[name];
    },
  },
  applications: {
    api: {
      DialogV2: {
        confirm: async (config) => {
          confirmed.push(config);
          return true;
        },
        prompt: async (config) =>
          config.ok.callback(null, {
            form: {
              querySelectorAll: () => ticked.map(([key, id]) => ({ value: `${key}|${id}` })),
              elements: { mode: { value: "drop" } },
            },
          }),
      },
    },
  },
};

/* --- a cookbook with one entry of every kind --- */

const crop = { x: 0, y: 0, w: 1, h: 1 };
const served = {
  "registers.json": {},
  "index.json": { books: ["mm", "ax1"], content: ["definitions"] },
  "mm.json": {
    book: { id: "mm" },
    entries: {
      "mm.alpha": { kind: "kind.monster", name: "Alpha", pages: [1] },
      "mm.beta": { name: "Beta", pages: [2] },
      "mm.legacy": { kind: "kind.monsterLegacy", name: "Legacy", pages: [3] },
    },
    families: { "mm.fam": { name: "Family", cite: "", pages: [4], members: [{ id: "mm.alpha" }] } },
  },
  "ax1.json": {
    book: { id: "ax1" },
    entries: {
      "ax1.npc1": { kind: "kind.npc", name: "Npc", pages: [1] },
      "ax1.pregen1": { kind: "kind.pregen", name: "Pregen", pages: [2] },
      "ax1.area": { kind: "kind.location", name: "Area", pages: [3] },
      "ax1.room1": { kind: "kind.location", name: "Room", pages: [3], meta: { space: "ax1.area" } },
      "ax1.page1": { kind: "kind.location", name: "Page", pages: [4] },
      "ax1.prose1": { kind: "kind.prose", name: "Prose", pages: [5] },
      "ax1.table1": { kind: "kind.settingTable", name: "Table", pages: [6] },
      "ax1.org1": { kind: "kind.organisation", name: "Org", pages: [7], organisation: { kind: "x" } },
      "ax1.grid1": { kind: "kind.strengthGrid", name: "Grid", pages: [8], strength: { columns: { a: 1 } } },
      "ax1.mgrid": { kind: "kind.marketGrid", name: "Market grid", pages: [9] },
      "ax1.mrec": { kind: "kind.marketRecord", name: "Market record", pages: [10] },
      "ax1.rt1": { kind: "kind.rolltable", name: "Roll table", pages: [11] },
      "ax1.item1": { kind: "kind.adventureItem", name: "Item", pages: [12] },
    },
    scenes: {
      "ax1.map1": { kind: "kind.scene", scene: { crop } },
      "ax1.zone1": { kind: "kind.sceneZone", zone: { scene: "ax1.map1" } },
      "ax1.link1": { kind: "kind.sceneLink", link: { mode: "m", ends: ["a", "b"] } },
      "ax1.notes": { kind: "kind.other" },
    },
  },
  "definitions.json": {
    entries: {
      "def.class.alpha": { kind: "kind.class", name: "Alpha", book: "rr" },
      "def.class.adv": { kind: "kind.class", name: "Adv", book: "ax1" },
      "def.equip.gear": { kind: "kind.equipment", name: "Gear", book: "rr", meta: { group: "gear" } },
      "def.equip.mule": { kind: "kind.equipment", name: "Mule", book: "rr", meta: { group: "animal" } },
      "def.trap.one": { kind: "kind.trap", name: "Trap", book: "rr" },
      "def.spell.one": { kind: "kind.spell", name: "Spell", book: "rr" },
      "def.variation.one": { kind: "kind.variation", name: "Variation", book: "rr" },
      "def.vehicle.cart": { kind: "kind.vehicle", name: "Cart", book: "rr" },
      "def.merchandise.goods": { kind: "kind.merchandise", name: "Goods", book: "rr" },
      "def.merchandise.demand": { kind: "kind.merchandiseDemand", name: "Demand", book: "jj" },
      "def.prof.alpha": { name: "Proficiency", book: "rr" },
      "def.power.one": { name: "Power", book: "rr" },
      "def.skill.one": { name: "Skill", book: "rr" },
      "def.drawback.one": { name: "Drawback", book: "rr" },
      "def.classmeta.profGains": { kind: "kind.classMeta", name: "Meta", book: "rr" },
      "def.constant.one": { kind: "kind.constant", name: "Constant", book: "rr" },
    },
  },
};

const OPEN = new Map(["rr", "jj", "mm", "ax1"].map((id) => [id, { doc: {} }]));
initCookbook({ sessionDocs: OPEN });
{
  const log = console.log;
  console.log = () => {}; // the load announces itself
  const loaded = await loadCookbook();
  console.log = log;
  check("the cookbook loaded", loaded === true);
}
const namespace = globalThis.acksExtras;
const importerWas = namespace.importer;
/** The api the kinds name, as a recorder: each call is `{run, arg}`, and a stub answers an empty run. */
const calls = [];
const RUNS = new Set([
  ...Object.values(SHELF_REFILL),
  ...Object.keys(REPAIR_RUNS),
  ...ENTRY_SOURCES.flatMap((s) => [s.refill, s.idsRefill].filter(Boolean)),
  ...IMPORT_KINDS.flatMap((k) => [k.make.run, k.make.whole].filter(Boolean)),
]);
RUNS.delete("importMany");
RUNS.add("cookbookImportLinks"); // the adventure book run's links step
const recorder = () => {
  // A generator's row and a plain creature's row, as the OSE picker offers them.
  const api = { oseEntryRows: () => [["mm.group.pack", { name: "Pack" }], ["mm.oserow", { name: "Row" }]] };
  for (const run of RUNS) {
    api[run] = async (arg) => {
      calls.push({ run, arg });
      return [];
    };
  }
  return api;
};
namespace.importer = recorder();
// A repair writes through REPAIR_RUNS, whose bodies call the importers directly; each records as the api run it names.
const repairRunsWere = { ...REPAIR_RUNS };
for (const run of Object.keys(REPAIR_RUNS)) {
  REPAIR_RUNS[run] = async (only) => {
    calls.push({ run, arg: { only } });
    return [];
  };
}
const drive = async (fn) => {
  calls.length = 0;
  // The creatures step imports through the module's own function, which a mock library cannot open a compendium for;
  // the step catches and reports that, and the console is where it says so.
  const was = { log: console.log, info: console.info, debug: console.debug, warn: console.warn, error: console.error };
  console.log = console.info = console.debug = console.warn = console.error = () => {};
  try {
    await fn();
  } finally {
    Object.assign(console, was);
  }
  return [...calls];
};
const names = (list) => list.map((c) => c.run);

/* --- every claim is owned by at most one kind --- */

const OWNED = [
  ["def.class.alpha", "Classes"],
  ["def.class.alpha.rung", "Classes"],
  ["def.class.adv", "Classes"],
  ["def.equip.gear", "Equipment"],
  ["def.equip.mule", "Equipment"],
  ["def.trap.one", "Traps"],
  ["def.spell.one", "Spells"],
  ["def.variation.one", "Variations"],
  ["def.vehicle.cart", "Vehicles"],
  ["def.vehicle.cart.row", "Vehicles"],
  ["def.merchandise.goods", "Merchandise"],
  ["def.merchandise.demand", "Merchandise"],
  ["def.prof.alpha", "Abilities"],
  ["def.power.one", "Abilities"],
  ["def.skill.one", "Abilities"],
  ["def.drawback.one", "Abilities"],
  ["def.weapon.blade", "Weapons"],
  ["def.armor.mail", "Armor"],
  ["def.priced.rope", "PriceList"],
  ["def.language.tongue", "Languages"],
  ["def.race.kin", "Races"],
  ["mm.alpha", "Monsters"],
  ["mm.alpha.leaders", "Monsters"],
  ["mm.beta", "Monsters"],
  ["mm.legacy", "Monsters"],
  ["mm.fam", "Monsters"],
  ["ax1.npc1", "Monsters"],
  ["ax1.pregen1", "Monsters"],
  ["mm.group.pack", "OseCreatures"],
  ["mm.oserow", "OseCreatures"],
  ["mm.oserow.step", "OseCreatures"],
  ["ax1.area", "Places"],
  ["ax1.room1", "Places"],
  ["ax1.room1-o2", "Places"],
  ["ax1.district.north", "Places"],
  ["ax1.region", "Places"],
  ["ax1.adventure", "Places"],
  ["ax1.page1", "Journals"],
  ["ax1.prose1", "Journals"],
  ["ax1.table1", "Journals"],
  ["ax1.journal-abc123", "Journals"],
  ["ax1.org1", "Organisations"],
  ["ax1.grid1", "Organisations"],
  ["ax1.mgrid", "Markets"],
  ["ax1.mrec", "Markets"],
  ["ax1.rt1", "RollTables"],
  ["ax1.item1", "BookItems"],
  ["ax1.map1", "Scenes"],
  ["ax1.zone1", "Scenes"],
  ["ax1.link1", "Scenes"],
  ["ax1.book", "Adventures"],
  ...Object.keys(TABLE_RECIPES).map((docId) => [docId, "Tables"]),
];
const UNOWNED = [
  "def.classmeta.profGains",
  "def.constant.one",
  "def.class.ghost",
  "ax1.notes",
  "ax1.ghost",
  "zz.unknown.thing",
  "mm.book",
  "ax1.map1-o1",
  // The derived shapes name a book that is not loaded.
  "zz.region",
  "zz.district.north",
  "zz.adventure",
  "zz.journal-abc123",
  "zz.book",
  "",
];
for (const [id, key] of OWNED) {
  const owners = ownersOf(IMPORT_KINDS, id).map((k) => k.key);
  check(`${id} is owned by ${key} alone (${owners.join(", ") || "nobody"})`, owners.length === 1 && owners[0] === key);
}
for (const id of UNOWNED) check(`"${id}" is owned by no kind`, ownersOf(IMPORT_KINDS, id).length === 0);
check("the kinds' keys are unique", new Set(IMPORT_KINDS.map((k) => k.key)).size === IMPORT_KINDS.length);

// Every claim a kind itself names is owned by that kind alone, and read from the
// book the cookbook names.
for (const kind of IMPORT_KINDS) {
  for (const [id] of kind.entries()) {
    const owners = ownersOf(IMPORT_KINDS, id).map((k) => k.key);
    check(`${kind.key}'s own row ${id} is owned by it alone`, owners.length === 1 && owners[0] === kind.key);
  }
}
for (const kind of ENTRY_SOURCES) {
  check(`${kind.key}'s run is its refill, else its idsRefill, else the picker's own import`, kind.make.run === (kind.refill ?? kind.idsRefill ?? "importMany"));
}
same("an entry's book is the book its cookbook names", IMPORT_KINDS.find((k) => k.key === "Classes").book("def.class.adv"), "ax1");
same("a row filed beneath its entry is read from the entry's book", IMPORT_KINDS.find((k) => k.key === "Monsters").book("mm.alpha.leaders"), "mm");
same("a stat-line creature is read from its place's book", IMPORT_KINDS.find((k) => k.key === "Places").book("ax1.room1-o2"), "ax1");

/* --- every source, table shelf, step and run maps to a kind --- */

{
  const keyOf = (id) => ownersOf(IMPORT_KINDS, id)[0]?.key;
  const SAMPLE = { Weapons: "def.weapon.x", Armor: "def.armor.x", priced: "def.priced.x", Languages: "def.language.x", Races: "def.race.x" };
  same("every table shelf is sampled", Object.keys(TABLE_BOOKS).sort(), Object.keys(SAMPLE).sort());
  const kindOfShelf = Object.fromEntries(Object.entries(SAMPLE).map(([shelf, id]) => [shelf, keyOf(id)]));
  same("every table shelf is one kind", kindOfShelf, { Weapons: "Weapons", Armor: "Armor", priced: "PriceList", Languages: "Languages", Races: "Races" });
  check("and each table shelf's kind reads its book off the table", Object.entries(SAMPLE).every(([shelf, id]) => ownersOf(IMPORT_KINDS, id)[0].books().join() === (TABLE_BOOKS[shelf]() ?? "")));
  for (const src of ENTRY_SOURCES) check(`the entry source ${src.key} is a kind`, IMPORT_KINDS.includes(src));

  // Every shelf a kind files on is a shelf the refill table knows, and every
  // refill shelf has a kind.
  const shelved = new Set(IMPORT_KINDS.flatMap((k) => k.shelves ?? []));
  same("the kinds' shelves are the refill table's shelves", [...shelved].sort(), Object.keys(SHELF_REFILL).sort());

  // Every run any command names is a kind's run.
  const made = new Set(IMPORT_KINDS.flatMap((k) => [k.make.run, k.make.whole].filter(Boolean)));
  for (const run of [...Object.values(SHELF_REFILL), ...Object.keys(REPAIR_RUNS), ...ENTRY_SOURCES.flatMap((s) => [s.refill, s.idsRefill].filter(Boolean))]) {
    check(`the run ${run} is a kind's`, made.has(run));
  }
  // A run that two kinds share is one run, written once. These are the only ones.
  const sharing = {};
  for (const k of IMPORT_KINDS) (sharing[k.make.run] ??= []).push(k.key);
  same(
    "the runs more than one kind names",
    Object.fromEntries(Object.entries(sharing).filter(([, keys]) => keys.length > 1)),
    { importAllEquipment: ["Equipment", "PriceList"], cookbookImportTables: ["Tables", "Languages", "Races"] },
  );

  // An adventure book's steps: the ones the run reports, each one kind's.
  const source = fs.readFileSync(new URL("../../scripts/importer/cookbook.mjs", import.meta.url), "utf8");
  const start = source.indexOf("async function runAdventureBookSteps");
  const body = source.slice(start, source.indexOf("/** A document type's name in the user's language", start));
  const steps = [...body.matchAll(/run\("(step\w+)"/g)].map((m) => m[1]);
  check("the adventure book run reports ten steps", steps.length === 10);
  const declared = IMPORT_KINDS.flatMap((k) => k.bookSteps ?? []);
  same("every step the adventure book run reports is one kind's, and no kind names another", [...declared].sort(), [...steps].sort());
  const calledByRun = new Set([...body.matchAll(/\ba\.(\w+)\(/g)].map((m) => m[1]));
  const stepKinds = IMPORT_KINDS.filter((k) => k.bookSteps?.length);
  const stepRuns = new Set(stepKinds.map((k) => k.make.run));
  stepRuns.add("cookbookImportLinks"); // the links step follows the maps, under the maps' kind
  stepRuns.delete("importMany"); // the creatures step imports through the module's own function
  same("the api calls the adventure book run makes are its kinds' runs", [...calledByRun].sort(), [...stepRuns].sort());
  check("the creatures step imports the ids it lacks through importMany", /importMany\(ids,/.test(body) && stepKinds.some((k) => k.key === "Monsters"));
  check("a step kind is a book's own rows", stepKinds.every((k) => k.own));

  // The picker imports the ticked creatures the world lacks, and those it rebuilds, through the same function.
  const actorsRun = source.slice(source.indexOf("async function repairActors"), source.indexOf("async function repairEntries"));
  const picker = source.slice(source.indexOf("async function repairEntries"), source.indexOf("/*  Reimport one shelf"));
  check("the entry picker imports creatures through importMany",
    /await importMany\(missing,/.test(actorsRun) && /refill\.rebuilt = await importMany\(rebuilds,/.test(picker));
}

/* --- the chain's order and what it calls --- */

{
  const recorded = {};
  for (const [key, run] of GM_STEPS) {
    const seen = [];
    const api = new Proxy({}, { get: (_t, name) => (...args) => (seen.push(String(name)), Promise.resolve(null)) });
    await run(api, { quiet: true });
    recorded[key] = seen;
  }
  const chain = GM_STEPS.map(([key]) => key);
  for (const kind of IMPORT_KINDS) {
    check(`${kind.key} names a step of the chain`, chain.includes(kind.chain));
    check(`the step ${kind.chain} calls ${kind.key}'s whole run`, recorded[kind.chain].includes(kind.make.whole ?? kind.make.run));
  }
  const all = cookbookRunSet({ all: true });
  const tail = new Set(["cookbookUpdateAbilities", "importTemplatePackages", "cookbookFillCompanions"]);
  const imported = new Set(Object.values(recorded).flat().filter((name) => !tail.has(name)));
  same("everything is what the chain imports, less its tail", new Set(all.runs.map((r) => r.run)), imported);
  const rank = (run) => Math.min(...run.kinds.map((key) => chain.indexOf(IMPORT_KINDS.find((k) => k.key === key).chain)));
  check("and in the chain's order", all.runs.every((run, n) => n === 0 || rank(all.runs[n - 1]) <= rank(run)));
  check("the chain's tail is no kind's", [...tail].every((name) => !IMPORT_KINDS.some((k) => [k.make.run, k.make.whole].includes(name))));
}

/* --- a shelf: the command and the derivation agree --- */

{
  const shelves = reimportableShelves();
  check("the shelves the rebuild offers are the refill table's", shelves.join() === Object.keys(SHELF_REFILL).sort().join());
  for (const shelf of shelves) {
    emptyShelves();
    const made = await drive(() => cookbookReimportShelf(shelf));
    const set = cookbookRunSet({ shelf });
    same(`the ${shelf} shelf rebuild calls the run the derivation names`, names(made), set.runs.map((r) => r.run));
    same(`and that run is the refill table's`, names(made), [SHELF_REFILL[shelf]]);
  }
}

/* --- a merged shelf repair asks once, though it runs twice --- */

{
  check("the class shelf is refilled by the class run", SHELF_REFILL.Classes === "importClasses");
  const stub = REPAIR_RUNS.importClasses;
  const passes = [];
  REPAIR_RUNS.importClasses = async (_only, tally) => {
    passes.push(!!tally.answered);
    if (!tally.steps) tally.edits.push({ key: "Item.cls0000000001#system.notes", uuid: "Item.cls0000000001", path: "system.notes", current: "a", page: "b" });
    return [];
  };
  let asks = 0;
  let out = null;
  await drive(async () => {
    out = await cookbookReimportShelf("Classes", { ask: async () => (asks++, true), choose: async () => "take" });
  });
  REPAIR_RUNS.importClasses = stub;
  same("taking an edit runs the class run twice and asks once", [passes.length, asks], [2, 1]);
  same("pass two alone is marked answered, so a prose question is not asked again", passes, [false, true]);
  same("and the edit is counted taken", [out?.taken, out?.held], [1, 0]);
}

/* --- a book: the rebuild and the derivation agree --- */

{
  // The library holds a row of every kind a book rebuild names, a printed
  // table's row with no book on it, and the book's own item.
  const claims = [
    "def.class.alpha", "def.equip.gear", "def.trap.one", "def.spell.one", "def.variation.one", "def.merchandise.goods", "def.prof.alpha",
    "def.weapon.blade", "def.priced.rope",
  ];
  emptyShelves();
  for (const id of claims) stockItem(id);
  const made = await drive(() => cookbookReimportBook("rr"));
  const set = cookbookRunSet({ book: "rr" });
  // A book repair also reads again every printed table the book prints, which no entry names.
  const printed = Object.keys(TABLE_BOOKS).filter((shelf) => shelf !== "priced" && TABLE_BOOKS[shelf]() === "rr").map((shelf) => SHELF_REFILL[shelf]);
  same(
    "a plain book repair calls the runs the derivation names, in its order, then the printed tables the book prints",
    names(made),
    [...set.runs.map((r) => r.run), ...printed],
  );
  same(
    "which are the shelves its entries file on, in the refill table's order",
    names(made).slice(0, set.runs.length),
    ["cookbookImportAbilities", "importAllEquipment", "importVariations", "importMerchandise", "importTraps", "importSpells", "importClasses", "importVehicles"],
  );
  check("a printed table's row is not named by a book scope", !set.runs.some((r) => r.kinds.some((k) => ["Weapons", "PriceList"].includes(k))));
  same("each run carries the book's claims of its kinds", set.runs.find((r) => r.run === "importClasses").ids, ["def.class.alpha"]);
  same("the vehicles are a book's, and the book repair hands the run the book's vehicle entries", [
    set.runs.find((r) => r.run === "importVehicles").ids,
    [...made.find((c) => c.run === "importVehicles").arg.only],
  ], [["def.vehicle.cart"], ["def.vehicle.cart"]]);

  // The adventure book's content is the shelves above; its own rows are one run.
  emptyShelves();
  stockItem("def.class.adv");
  const content = await drive(() => cookbookReimportBook("ax1"));
  const adventure = cookbookRunSet({ book: "ax1" });
  same("an adventure book's content shelves are repaired as a plain book's are, then its own items, which have an in-place run",
    names(content), [...adventure.runs.filter((r) => r.run !== ADVENTURE_BOOK_RUN).map((r) => r.run), "cookbookImportAdventureItems"]);
  const last = adventure.runs.at(-1);
  check("and its own rows are the one adventure book run, last", last.run === ADVENTURE_BOOK_RUN && last.book === "ax1");
  check("which a book scope names exactly once", adventure.runs.filter((r) => r.run === ADVENTURE_BOOK_RUN).length === 1);
  same(
    "which names every kind its steps report",
    last.kinds,
    IMPORT_KINDS.filter((k) => k.own && k.bookSteps?.length && booksOfKind(k).includes("ax1")).map((k) => k.key),
  );
  check("a content kind of the book is not also in the adventure run", !adventure.runs.some((r) => r.run !== ADVENTURE_BOOK_RUN && r.kinds.includes("Monsters")));
  check("a book with no cookbook of its own has no own-rows run", !cookbookRunSet({ book: "rr" }).runs.some((r) => r.run === ADVENTURE_BOOK_RUN));

  // A book that is no Judge's but has a cookbook of its own (a bestiary): its own rows are the one run too.
  const bestiary = cookbookRunSet({ book: "mm" });
  check("a bestiary names its own rows as the one own-rows run", bestiary.runs.at(-1).run === ADVENTURE_BOOK_RUN && bestiary.runs.at(-1).book === "mm");
  same("which names the creatures kind", bestiary.runs.at(-1).kinds, ["Monsters"]);
  check("and the book is no Judge's", !bookIsJudges("mm"));

  /** An imported Actor as the library holds it, claiming `id`. */
  const stockCreature = (id) => {
    const _id = mint();
    const doc = {
      id: _id,
      _id,
      name: id,
      type: "npc",
      pack: actors.shelf.collection,
      documentName: "Actor",
      flags: claim(id),
      system: {},
      items: [],
      get uuid() {
        return `Compendium.${actors.shelf.collection}.Actor.${this.id}`;
      },
      getFlag(scope, key) {
        return this.flags?.[scope]?.[key] ?? null;
      },
      toObject() {
        return structuredClone({ name: this.name, type: this.type, flags: this.flags, system: this.system, items: this.items });
      },
      async update() {
        return this;
      },
    };
    actors.shelf.docs.set(_id, doc);
    actors.shelf.index.set(_id, { _id });
  };
  /** The arguments the confirm's lines are formatted with, keyed by lang key tail. */
  const formatted = async (fn) => {
    const asked = {};
    const was = game.i18n.format;
    game.i18n.format = (key, data) => {
      asked[String(key).split(".").pop()] = data;
      return "";
    };
    try {
      await drive(fn);
    } finally {
      game.i18n.format = was;
    }
    return asked;
  };

  emptyShelves();
  stockCreature("mm.fam");
  let repaired = null;
  await drive(async () => {
    repaired = await cookbookReimportBook("mm");
  });
  const own = repaired?.refill?.own;
  const ownKeys = [...(own?.steps ?? []), ...(own?.errors ?? [])].map((s) => s.key);
  check("a bestiary repair walks its own rows", ownKeys.includes("stepMonsters"));
  check("without its items, which the book repair wrote, or an Adventure, which is a Judge's book's", !ownKeys.includes("stepAdventureItems") && !ownKeys.includes("stepAdventures"));
  const asked = await formatted(() => cookbookReimportBook("mm"));
  check("the confirm names the book's own rows", "repairMergedBookOwn" in asked);
  const judged = await formatted(() => cookbookReimportBook("ax1"));
  check("a Judge's book confirms none, its own repair writes them", !("repairMergedBookOwn" in judged));
  await drive(async () => {
    repaired = await cookbookReimportBook("ax1");
  });
  check("and its book repair holds no own-rows pass", !("own" in repaired.refill));
  await drive(async () => {
    repaired = await cookbookReimportBook("rr");
  });
  check("a book with no cookbook of its own holds none", !("own" in repaired.refill));

  // A vehicle is an Actor filed beneath its entry; the confirm counts it, and the census finds its book.
  emptyShelves();
  const none = await formatted(() => cookbookReimportBook("rr"));
  stockCreature("def.vehicle.cart.row");
  const some = await formatted(() => cookbookReimportBook("rr"));
  same("a vehicle row the library holds is counted in the book's confirm", [none.repairMergedConfirmBook.n, some.repairMergedConfirmBook.n], [0, 1]);

  // The adventure rebuild walks the steps; each api call it makes is a step kind's run.
  emptyShelves();
  let result = null;
  const walked = await drive(async () => {
    result = await cookbookReimportAdventure("ax1");
  });
  // The Adventure is written once, after the last pass (`finish`), so its step is not among the pass's.
  const reported = [...result.steps.map((s) => s.key), ...result.errors.map((e) => e.key), ...("after" in result ? ["stepAdventures"] : [])].sort();
  same("the adventure book repair reports every step the kinds declare, the Adventure after the last pass", reported, IMPORT_KINDS.flatMap((k) => k.bookSteps ?? []).sort());
  same("and only the creatures step fails, for the mock library cannot open a compendium", result.errors.map((e) => e.key), ["stepMonsters"]);
  const stepRuns = new Set(IMPORT_KINDS.filter((k) => k.bookSteps?.length).map((k) => k.make.run));
  stepRuns.add("cookbookImportLinks");
  check("the adventure book rebuild made calls", walked.length > 0);
  check("each call the adventure book rebuild makes is a step kind's run", walked.every((c) => stepRuns.has(c.run)));
  same(
    "and it makes the run of every step kind its book has rows of",
    [...new Set(names(walked))].sort(),
    [
      "cookbookImportAdventureItems", "cookbookImportAdventures", "cookbookImportFactions", "cookbookImportJournals", "cookbookImportLinks",
      "cookbookImportMarketProfiles", "cookbookImportPoiPlaces", "cookbookImportRollTables", "cookbookImportScenes",
    ],
  );
}

/* --- an adventure repair holds its places in place --- */

{
  /** An imported Actor as the library holds it, claiming `id` (and `merged`). */
  const stockActor = (id, { merged = null, type = "location" } = {}) => {
    const _id = mint();
    const cookbook = { id, ...(merged ? { merged } : {}) };
    const doc = {
      id: _id,
      _id,
      name: id,
      type,
      pack: actors.shelf.collection,
      documentName: "Actor",
      flags: { [MODULE_ID]: { cookbook } },
      system: { notes: "" },
      items: [],
      get uuid() {
        return `Compendium.${actors.shelf.collection}.Actor.${this.id}`;
      },
      getFlag(scope, key) {
        return this.flags?.[scope]?.[key] ?? null;
      },
      toObject() {
        return structuredClone({ name: this.name, type: this.type, flags: this.flags, system: this.system, items: this.items });
      },
      async update() {
        return this;
      },
    };
    actors.shelf.docs.set(_id, doc);
    actors.shelf.index.set(_id, { _id });
    return doc;
  };
  emptyShelves();
  stockActor("ax1.room1");
  stockActor("ax1.room1-o2", { type: "monster" });
  // Another book's place that took over a row of this book: found under the
  // row's id, and never built over by it.
  stockActor("zz.keep", { merged: ["ax1.area"] });
  const seen = {};
  const api = namespace.importer;
  const poi = api.cookbookImportPoiPlaces;
  api.cookbookImportPoiPlaces = async (arg) => {
    for (const id of ["ax1.room1", "ax1.room1-o2", "ax1.area", "zz.keep"]) seen[id] = isRewriting(id);
    return poi(arg);
  };
  let result = null;
  try {
    const walked = await drive(async () => {
      result = await cookbookReimportAdventure("ax1", { ask: async () => true });
    });
    check("the repair walks the places step", names(walked).includes("cookbookImportPoiPlaces"));
  } finally {
    api.cookbookImportPoiPlaces = poi;
  }
  same(
    "the places step holds the book's places under their own claims and the creatures made from their stat lines, never a place a claim was merged into",
    seen,
    { "ax1.room1": true, "ax1.room1-o2": true, "ax1.area": false, "zz.keep": false },
  );
  check("the repair returns the edits it kept", Array.isArray(result?.edits));
  check("outside the step nothing is held", !isRewriting("ax1.room1"));
}

/* --- a whole-build write under a decision holds the Judge's prose --- */

{
  const stampedBio = (text) => bookText([text], "AX 1", { id: "ax1.npc1", book: "ax1", page: 1 });
  const judged = `${stampedBio("Old.")}<p>The Judge's line.</p>`;
  const heldDoc = () => {
    const doc = {
      id: "held0000000001",
      uuid: "Actor.held0000000001",
      name: "Npc",
      type: "npc",
      documentName: "Actor",
      system: { details: { biography: judged } },
      flags: { [MODULE_ID]: { cookbook: { id: "ax1.npc1" } } },
      writes: [],
      toObject() {
        return structuredClone({ name: this.name, type: this.type, system: this.system, flags: this.flags });
      },
      async update(patch) {
        this.writes.push(patch);
        return this;
      },
    };
    return doc;
  };
  const build = { name: "Npc", type: "npc", system: { details: { biography: stampedBio("New.") } }, flags: { [MODULE_ID]: { cookbook: { id: "ax1.npc1", cite: "AX 1" } } } };
  const run = async (scope) => {
    const doc = heldDoc();
    const tally = { replaced: 0, keptProse: 0, refused: 0, handMade: 0, force: true, seen: new Set(), edits: [] };
    await withRewrite({ held: new Map([["ax1.npc1", doc]]), tally, ...scope }, () => createDoc({ documentName: "Actor" }, structuredClone(build)));
    const bio = doc.writes.map((w) => w.system?.details?.biography).find((b) => b !== undefined);
    return { tally, bio };
  };
  const kept = await run({ decision: null });
  same("under a decision that takes nothing, the Judge's biography is held and listed",
    [kept.bio, kept.tally.edits.map((e) => [e.uuid, e.path, e.cite])], [undefined, [["Actor.held0000000001", "system.details.biography", "AX 1"]]]);
  const taken = await run({ decision: { take: new Set(["Actor.held0000000001#system.details.biography"]) } });
  check("a decision that takes it writes the page's biography, holding nothing", taken.bio === build.system.details.biography && taken.tally.edits.length === 0);
  const legacy = await run({});
  check("a scope with no decision writes as the tally's force says", legacy.bio === build.system.details.biography && legacy.tally.edits.length === 0);

  // A write an importer makes after its create (a character's biography) asks the same decision.
  const page = stampedBio("New.");
  const after = async (scope, current) => {
    const doc = heldDoc();
    const tally = { replaced: 0, keptProse: 0, refused: 0, handMade: 0, force: true, seen: new Set(), edits: [] };
    let keeps = null;
    await withRewrite({ held: new Map([["ax1.npc1", doc]]), tally, ...scope }, async () => {
      keeps = keepsJudgeProse(doc, "system.details.biography", current, page, "AX 1");
    });
    return { keeps, edits: tally.edits.map((e) => [e.key, e.current, e.page]) };
  };
  same("under a decision a later write keeps the Judge's prose and lists it",
    await after({ decision: null }, judged), { keeps: true, edits: [["Actor.held0000000001#system.details.biography", judged, page]] });
  same("prose that is only the stamped text is written", await after({ decision: null }, stampedBio("Old.")), { keeps: false, edits: [] });
  same("a decision taking it writes it", await after({ decision: "take" }, judged), { keeps: false, edits: [] });
  same("a scope with no decision writes it", await after({}, judged), { keeps: false, edits: [] });
  check("outside a rewrite nothing is kept", keepsJudgeProse(heldDoc(), "system.details.biography", judged, page) === false);
  const source = fs.readFileSync(new URL("../../scripts/importer/cookbook.mjs", import.meta.url), "utf8");
  const character = source.slice(source.indexOf("async function importCharacter"), source.indexOf("/** The kinds that bind to a journal page"));
  check("a character's biography write asks keepsJudgeProse under its rewrite",
    /isRewriting\(id\) && keepsJudgeProse\(actor, "system\.details\.biography",/.test(character) && /keepBiography \? \{\} :/.test(character));
}

/* --- an edit inside a stamped block: a character's biography, a roll table's description, a created document, an ability --- */

{
  const ID = "ax1.npc2";
  const para = (text) => bookText([text], "AX 1", { id: ID, book: "ax1", page: 1 });
  const bioKey = sumKey("system.details.biography", ID);
  const doc = (biography, sums) => ({
    uuid: "Actor.bio0000000001",
    name: "Npc",
    documentName: "Actor",
    flags: { [MODULE_ID]: { cookbook: { id: ID, ...(sums ? { sums } : {}) } } },
    system: { details: { biography } },
  });
  const sums = { [bioKey]: blockDigest(para("Old.")) };
  const page = para("New.");
  const keeps = async (stored, scope = { decision: null }) => {
    const tally = { replaced: 0, keptProse: 0, refused: 0, handMade: 0, seen: new Set(), edits: [] };
    let kept = null;
    await withRewrite({ held: new Map(), tally, ...scope }, async () => {
      kept = keepsJudgeProse(stored, "system.details.biography", stored.system.details.biography, page, "AX 1");
    });
    return [kept, tally.edits.length];
  };
  const wrapped = para("Old.").replace('<div class="acks-extras-importer-book-text" data-acks-entry="ax1.npc2">', '<div data-acks-entry="ax1.npc2" class="acks-extras-importer-book-text">\n').replace(/<\/p>/g, "</p>\n").replace(' href="#"', "");
  same("a biography whose block reads as it was written is rewritten", await keeps(doc(para("Old."), sums)), [false, 0]);
  same("one the editor re-serialized, its words as written, is rewritten", await keeps(doc(wrapped, sums)), [false, 0]);
  same("an edit inside its block is kept and listed under a decision", await keeps(doc(para("Old, and a word the Judge added."), sums)), [true, 1]);
  same("with no stamp the same block reads as unedited", await keeps(doc(para("Old, and a word the Judge added."), null)), [false, 0]);
  same("a decision taking it writes it", await keeps(doc(para("Old, and a word the Judge added."), sums), { decision: "take" }), [false, 0]);
  const upd = sumsUpdate(page, "system.details.biography");
  same("the write records the digest of the biography it wrote, as one flat key under the stamp",
    upd, { [`flags.${MODULE_ID}.cookbook.sums.${bioKey}`]: blockDigest(page) });
  check("and its key nests nothing in an update path", Object.keys(upd).every((k) => k.slice(`flags.${MODULE_ID}.cookbook.sums.`.length).indexOf(".") === -1));

  const source = fs.readFileSync(new URL("../../scripts/importer/cookbook.mjs", import.meta.url), "utf8");
  const character = source.slice(source.indexOf("async function importCharacter"), source.indexOf("/** The kinds that bind to a journal page"));
  check("a character's biography write records its digest when it writes the biography",
    /"system\.details\.biography": biography, \.\.\.sumsUpdate\(biography, "system\.details\.biography"\)/.test(character));

  // A roll table's description: its own slot, `description`.
  const tableKey = sumKey("description", "ax1.tab1");
  const tablePara = (text) => bookText([text], "AX 1", { id: "ax1.tab1", book: "ax1", page: 2 });
  const table = (description, tableSums) => ({
    uuid: "RollTable.tab0000000002",
    name: "Table",
    description,
    flags: { [MODULE_ID]: { cookbook: { id: "ax1.tab1", ...(tableSums ? { sums: tableSums } : {}) } } },
    results: [],
    writes: [],
    async update(patch) {
      this.writes.push(patch);
    },
    async deleteEmbeddedDocuments() {},
    async createEmbeddedDocuments() {},
  });
  const builtTable = { formula: "1d6", description: tablePara("Rows, reread."), results: [{ text: "a" }], flags: { [MODULE_ID]: { cookbook: { cite: "AX 1" } } } };
  const tableSums = { [tableKey]: blockDigest(tablePara("Rows.")) };
  const repaired = async (t, decision = "keep") => {
    const repair = mergedTally(decision);
    await rewriteTable(t, builtTable, repair);
    return { update: t.writes[0], edits: repair.edits.length };
  };
  const untouched = await repaired(table(tablePara("Rows."), tableSums));
  same("an untouched description is rewritten and its digest recorded",
    [untouched.update.description, untouched.update[`flags.${MODULE_ID}.cookbook.sums.${tableKey}`], untouched.edits], [builtTable.description, blockDigest(builtTable.description), 0]);
  const handEdited = await repaired(table(tablePara("Rows, a word the Judge changed."), tableSums));
  same("an edit inside the description's block is kept, listed, and the digest left as it was", [handEdited.update, handEdited.edits], [{ formula: "1d6" }, 1]);
  same("with no stamp it reads as unedited and is rewritten",
    (await repaired(table(tablePara("Rows, a word the Judge changed."), null))).update.description, builtTable.description);
  same("a re-serialized description is rewritten",
    (await repaired(table(tablePara("Rows.").replace(' href="#"', "").replace(/<\/p>/g, "</p>\n"), tableSums))).update.description, builtTable.description);
  same("a decision taking the edit writes the page and records its digest",
    (await repaired(table(tablePara("Rows, a word the Judge changed."), tableSums), { take: new Set(["RollTable.tab0000000002#description"]) })).update[`flags.${MODULE_ID}.cookbook.sums.${tableKey}`],
    blockDigest(builtTable.description));


  // The abilities pass: an edit inside the block the import wrote is the Judge's, kept with the description it wrote.
  const abilities = source.slice(source.indexOf("const writeGenerated"), source.indexOf("// Counted first: this walks every ability"));
  check("the abilities write records the digest of the description it writes, and none when it keeps the Judge's",
    /keepProse\s*\? built\.flags\[MODULE_ID\]\.cookbook\s*: \{ \.\.\.built\.flags\[MODULE_ID\]\.cookbook, sums: blockSums\(built\.system\.description, "system\.description"\) \}/.test(abilities));
  const refresh = source.slice(source.indexOf("// Authorship of the ITEM"), source.indexOf("if (flagged && annotated && repair"));
  check("and reads an edit inside the block of a document it made as an annotated description",
    /editedInBlocks\(doc\.flags\?\.\[MODULE_ID\]\?\.cookbook\?\.sums, "system\.description", prose\)/.test(refresh) && /handWrittenProse\(prose\) \|\| edited/.test(refresh));
}

/* --- a book id the registry does not know --- */

{
  const [known] = Object.keys(BOOKS);
  const warned = [];
  const warn = console.warn;
  console.warn = (...args) => warned.push(args.join(" "));
  try {
    check("a known book answers a number, with nothing said", Number.isInteger(cookbookCount(known)) && warned.length === 0);
    check("an id the registry does not know answers null, never 0", cookbookCount("zz-unknown") === null);
    check("and names the id on the console", warned.length === 1 && warned[0].includes('"zz-unknown"'));
  } finally {
    console.warn = warn;
  }
}

/* --- a journal page a Judge edited: kept outside a repair, held and decided inside one --- */

{
  const stamped = (text) => bookText([text], "ZZ 1", { id: "zz.room1", book: "zz", page: 3 });
  const creatureLine = "<p><strong>Creatures:</strong> Gloam Hound · Tin Rat</p>";
  const made = (content, sort = 100) => ({
    uuid: "JournalEntry.jrn0000000001.JournalEntryPage.pag0000000001",
    name: "Room",
    sort,
    text: { content },
    writes: [],
    async update(patch) {
      this.writes.push(patch);
      return this;
    },
  });
  const built = stamped("New text.") + creatureLine;
  const judged = `${stamped("Old text.")}${creatureLine}<p>The Judge's own note.</p>`;
  const KEY = "JournalEntry.jrn0000000001.JournalEntryPage.pag0000000001#text.content";
  const outcome = async (content, scope = null, { sort = 200, pageSort = 100 } = {}) => {
    const page = made(content, pageSort);
    const tally = { ...mergedTally(scope?.decision ?? "keep"), ...(scope?.tally ?? {}) };
    const run = () => writeJournalPage(page, built, sort, "ZZ 1");
    const how = scope ? await withRewrite({ held: new Map(), tally, ...(scope.decision === undefined ? {} : { decision: scope.decision }) }, run) : await run();
    return { how, writes: page.writes, edits: tally.edits.map((e) => [e.key, e.path, e.current, e.page, e.cite]) };
  };

  same("an edited page outside a repair is kept: only its sort is written, nothing is listed",
    await outcome(judged), { how: "kept", writes: [{ sort: 200 }], edits: [] });
  same("an edited page already at its sort is left untouched", (await outcome(judged, null, { pageSort: 200 })).writes, []);
  same("a page of only the import's own text is written whole, however the build moved",
    (await outcome(stamped("Old text.") + creatureLine)).writes, [{ "text.content": built, sort: 200 }]);
  same("a page with no creature line is written whole", (await outcome(stamped("Old text."))).writes, [{ "text.content": built, sort: 200 }]);
  same("a page already holding the build is written as it was", (await outcome(built)).how, "written");

  const kept = await outcome(judged, { decision: "keep" });
  same("under keep the edited page is held and listed with its text, the build's and the page reference",
    [kept.how, kept.writes, kept.edits], ["kept", [{ sort: 200 }], [[KEY, "text.content", judged, built, "ZZ 1"]]]);
  const taken = await outcome(judged, { decision: { take: new Set([KEY]) } });
  same("under a decision taking it the build is written and nothing is listed", [taken.how, taken.writes, taken.edits], ["written", [{ "text.content": built, sort: 200 }], []]);
  same("a decision that names another page keeps this one", (await outcome(judged, { decision: { take: new Set(["Other#text.content"]) } })).how, "kept");
  same("a rewrite without a decision writes where the tally is forced", (await outcome(judged, { tally: { force: true } })).how, "written");
  same("and keeps the page where it is not", (await outcome(judged, { tally: { force: false } })).how, "kept");

  // An edit inside the import's own block: the page records the digest of the
  // block it was written with, and a stored block that no longer reads as it did is the Judge's.
  const ROOM = "zz.room1";
  const SUM = `flags.${MODULE_ID}.cookbook.sum`;
  const sealed = (content, flags = { id: ROOM, sum: blockDigest(stamped("Old text.")) }, pageSort = 100) => {
    const page = made(content, pageSort);
    page.flags = { [MODULE_ID]: { cookbook: flags } };
    return page;
  };
  const settle = async (page, scope = null) => {
    const tally = { ...mergedTally(scope?.decision ?? "keep") };
    const run = () => writeJournalPage(page, built, 200, "ZZ 1");
    const how = scope ? await withRewrite({ held: new Map(), tally, decision: scope.decision }, run) : await run();
    return { how, writes: page.writes, edits: tally.edits.map((e) => [e.key, e.path]) };
  };
  const reworded = stamped("Old text, as the Judge reads it.") + creatureLine;
  const rewrittenWhole = [{ "text.content": built, [SUM]: blockDigest(stamped("New text.")), sort: 200 }];

  same("an edit inside the block is kept outside a repair: only its sort is written, the digest stays",
    await settle(sealed(reworded)).then((r) => [r.how, r.writes]), ["kept", [{ sort: 200 }]]);
  same("and under keep it is listed as a held edit of the page's text",
    await settle(sealed(reworded), { decision: "keep" }).then((r) => [r.how, r.edits]), ["kept", [[KEY, "text.content"]]]);
  same("a decision that takes it writes the build and records the new digest",
    await settle(sealed(reworded), { decision: { take: new Set([KEY]) } }).then((r) => [r.how, r.writes]), ["written", rewrittenWhole]);
  same("a block written before the digest was recorded is the import's own, edited or not",
    await settle(sealed(reworded, { id: ROOM })).then((r) => [r.how, r.writes]), ["written", rewrittenWhole]);
  same("a block the editor re-serialized, its words as written, is untouched and is refreshed",
    await settle(sealed(
      `<div data-acks-entry="${ROOM}" class="acks-extras-importer-book-text">\n  <p>Old&nbsp;text.</p>\n  <p class="acks-extras-importer-cite"><a href="#" data-page="3" data-book="zz" class="acks-extras-importer-cite-link">ZZ 1</a></p>\n</div>${creatureLine}`,
    )).then((r) => [r.how, r.writes]), ["written", rewrittenWhole]);
  same("a page whose block was taken out holds no edit of this kind", await settle(sealed(creatureLine)).then((r) => r.how), "written");
  same("an edit beside the block is held with or without a digest", await settle(sealed(judged)).then((r) => r.how), "kept");
  same("a page the build writes records the digest of the block it wrote",
    await settle(sealed(stamped("Old text.") + creatureLine, { id: ROOM })).then((r) => r.writes), rewrittenWhole);
  same("a page already recording the written digest is not asked to record it again",
    await settle(sealed(built, { id: ROOM, sum: blockDigest(stamped("New text.")) })).then((r) => r.writes),
    [{ "text.content": built, sort: 200 }]);

  // A table's cells come back from the editor as paragraphs; the reading of the block ignores that.
  const table = bookTable(["Roll", "Result"], [["1", "Alpha row"], ["2", "Beta row"]], "ZZ 1", { id: ROOM, book: "zz", page: 3 });
  const wrapped = table.replace(/<(td|th)>([^<]*)<\/\1>/g, "<$1><p>$2</p></$1>").replace("<thead>", "<thead>\n").replace(/<\/tr>/g, "</tr>\n");
  check("a table block with its cells wrapped in paragraphs reads the same", blockDigest(wrapped) === blockDigest(table));
  check("a table block with a cell reworded does not", blockDigest(wrapped.replace("Beta row", "Gamma row")) !== blockDigest(table));
  check("a changed word reads differently", blockDigest(stamped("Old text.")) !== blockDigest(stamped("Old text!")));
  same("escaped angle brackets stay text and are not read as tags", readableText("<p>&lt;b&gt; 1 &amp; 2</p>"), "<b> 1 & 2");
  same("an image counts by its source, so one added inside the block is seen", readableText('<p>x</p><img class="a" src="art/a.webp">'), "x [image art/a.webp]");

  // The call sites: the step carries the pass's decision on both passes, and the importer writes through the same function.
  const source = fs.readFileSync(new URL("../../scripts/importer/cookbook.mjs", import.meta.url), "utf8");
  const steps = source.slice(source.indexOf("async function runAdventureBookSteps"), source.indexOf("/** A document type's name in the user's language"));
  check("the journals step runs under the pass's decision, on pass two as well as pass one",
    /withRewrite\(\{ held: new Map\(\), tally, \.\.\.decisionOf\(tally\) \}, fn\)/.test(steps) && /await run\("stepJournals", \(\) => journalsScoped\(\(\) => a\.cookbookImportJournals\(only\)\)\);/.test(steps));
  const journals = source.slice(source.indexOf("export async function cookbookImportJournals"), source.indexOf("/**\n * Points of interest:"));
  check("a page the importer creates records the digest of its block in its stamp",
    /cookbook: \{ id, book: bookId, sum: blockDigestIn\(content, id\) \}/.test(journals));
  check("the journal importer writes an existing page through writeJournalPage and counts the page kept",
    /writeJournalPage\(existing, content, sort, e\.cite \?\? ""\)\) === "kept"\) preserved\+\+/.test(journals) && /!made && !updated && !preserved/.test(journals));
}

/* --- figures only a forced repair wrote: under a decision each is an edit --- */

{
  // A place whose roster the Judge changed: the build gives one row, the place holds another.
  const pageRow = { uuid: "Actor.mob0000000001", quantity: 2, notes: "2d4" };
  const place = (roster) => ({
    id: "place000000001",
    uuid: "Actor.place000000001",
    name: "Room",
    type: "location",
    documentName: "Actor",
    system: { notes: "", roster },
    flags: { [MODULE_ID]: { cookbook: { id: "ax1.room1" } } },
    writes: [],
    toObject() {
      return structuredClone({ name: this.name, type: this.type, system: this.system, flags: this.flags });
    },
    async update(patch) {
      this.writes.push(patch);
      return this;
    },
  });
  const build = { name: "Room", type: "location", system: { notes: "", roster: [pageRow] }, flags: { [MODULE_ID]: { cookbook: { id: "ax1.room1", cite: "AX 3" } } } };
  const write = async (doc, decision) => {
    const tally = { replaced: 0, keptProse: 0, refused: 0, handMade: 0, seen: new Set(), edits: [], decision };
    await withRewrite({ held: new Map([["ax1.room1", doc]]), tally, retract: ["roster"], decision }, () => createDoc({ documentName: "Actor" }, structuredClone(build)));
    const rosterWritten = doc.writes.some((w) => w.system?.roster !== undefined || "system.roster" in w);
    return { tally, rosterWritten };
  };
  const judged = [{ ...pageRow, quantity: 5 }];
  const kept = await write(place(judged), "keep");
  check("pass one under keep leaves a roster the Judge changed as it stands", !kept.rosterWritten);
  same("and lists it as an unstamped edit, with the page's rows beside it",
    kept.tally.edits.map((e) => [e.key, e.unstamped, e.current[0].quantity, e.page[0].quantity]), [["Actor.place000000001#system.roster", true, 5, 2]]);
  const taken = await write(place(judged), { take: new Set(["Actor.place000000001#system.roster"]) });
  check("a decision taking it writes the page's roster and lists nothing", taken.rosterWritten && taken.tally.edits.length === 0);
  const same1 = await write(place([{ ...pageRow, hidden: true }]), "keep");
  check("a roster that still holds the page's rows is no edit", same1.tally.edits.length === 0);
  const empty = await write(place([]), "keep");
  check("an empty roster takes the build's and is no edit", empty.rosterWritten && empty.tally.edits.length === 0);

  // A place's build stamps no cite of its own; the edit it holds names its row's.
  const roomRow = served["ax1.json"].entries["ax1.room1"];
  roomRow.cite = "AX 1 p.3";
  const uncited = { ...build, flags: { [MODULE_ID]: { cookbook: { id: "ax1.room1" } } } };
  const citeTally = { replaced: 0, keptProse: 0, refused: 0, handMade: 0, seen: new Set(), edits: [], decision: "keep" };
  await withRewrite({ held: new Map([["ax1.room1", place(judged)]]), tally: citeTally, retract: ["roster"], decision: "keep" }, () => createDoc({ documentName: "Actor" }, structuredClone(uncited)));
  same("a held roster on a place whose build stamps no cite names its row's page", citeTally.edits.map((e) => [e.path, e.cite]), [["system.roster", "AX 1 p.3"]]);
  delete roomRow.cite;
  const noRow = { ...uncited, flags: { [MODULE_ID]: { cookbook: { id: "ax1.ghost" } } } };
  const ghostTally = { replaced: 0, keptProse: 0, refused: 0, handMade: 0, seen: new Set(), edits: [], decision: "keep" };
  await withRewrite({ held: new Map([["ax1.ghost", place(judged)]]), tally: ghostTally, retract: ["roster"], decision: "keep" }, () => createDoc({ documentName: "Actor" }, structuredClone(noRow)));
  same("and one whose id no row answers to names none", ghostTally.edits.map((e) => e.cite), [""]);

  // An organisation's strength figures: a write after the create asks keepsJudgeFigure.
  const body = place([]);
  const pageStrength = { rows: [{ key: "a", n: 10 }] };
  const figure = async (scope, current) => {
    const tally = { replaced: 0, keptProse: 0, refused: 0, handMade: 0, seen: new Set(), edits: [] };
    let keeps = null;
    await withRewrite({ held: new Map(), tally, ...scope }, async () => {
      keeps = keepsJudgeFigure(body, "system.strength", current, pageStrength, "AX 3");
    });
    return { keeps, edits: tally.edits.map((e) => [e.path, e.unstamped]) };
  };
  same("under keep, figures the Judge changed are kept and listed unstamped",
    await figure({ decision: "keep" }, { rows: [{ key: "a", n: 14 }] }), { keeps: true, edits: [["system.strength", true]] });
  same("figures still holding the grid's are written", await figure({ decision: "keep" }, { rows: [{ key: "a", n: 10, extra: 1 }] }), { keeps: false, edits: [] });
  same("a decision taking them writes them", await figure({ decision: "take" }, { rows: [{ key: "a", n: 14 }] }), { keeps: false, edits: [] });
  same("a scope with no decision writes them", await figure({}, { rows: [{ key: "a", n: 14 }] }), { keeps: false, edits: [] });
  check("outside a rewrite nothing is kept", keepsJudgeFigure(body, "system.strength", { rows: [] }, pageStrength) === false);

  // A body's relations: one the Judge deleted is what the page gives and the body lacks.
  const kin = { uuid: "Actor.kin0000000001", name: "Kin", stance: "ally", note: "", hidden: false };
  const foe = { uuid: "Actor.foe0000000001", name: "Foe", stance: "enemy", note: "AX 3", hidden: false };
  const related = async (scope) => {
    const tally = { replaced: 0, keptProse: 0, refused: 0, handMade: 0, seen: new Set(), edits: [] };
    let keeps = null;
    await withRewrite({ held: new Map(), tally, ...scope }, async () => {
      keeps = keepsJudgeFigure(body, "system.relations", [kin], [kin, foe], "AX 3");
    });
    return { keeps, edits: tally.edits.map((e) => [e.path, e.unstamped, e.current.length, e.page.length]) };
  };
  same("under keep, a relation the Judge deleted is kept deleted and listed unstamped",
    await related({ decision: "keep" }), { keeps: true, edits: [["system.relations", true, 1, 2]] });
  same("a decision taking it puts the page's relation back", await related({ decision: { take: new Set(["Actor.place000000001#system.relations"]) } }), { keeps: false, edits: [] });

  // A place's market figures: what only a forced write changed is an edit.
  const source = { book: "ax3", page: "AX 3 p.1" };
  const marketPlace = (market) => ({ uuid: "Actor.mkt0000000001", name: "Market", toObject: () => ({ system: { market: structuredClone(market) } }), system: { market } });
  const profile = { market: "m1", marketClass: 2, families: 300, demand: [{ key: "salt", dm: -1 }] };
  const judgedMarket = { marketClassOverride: 4, urbanFamilies: 300, goods: { demand: [{ key: "salt", dm: 1 }], dmProfile: { source: null } } };
  const keepRepair = { decision: "keep", edits: [] };
  same("under keep no market figure is forced", marketTakes(marketPlace(judgedMarket), profile, source, { repair: keepRepair, cite: "AX 3" }), {});
  same("the class and the base the Judge set are listed unstamped; a family count equal to the page's is not",
    keepRepair.edits.map((e) => [e.path, e.unstamped]), [["system.market.marketClassOverride", true], ["system.market.goods.demand", true]]);
  const takeRepair = { decision: { take: new Set(["Actor.mkt0000000001#system.market.marketClassOverride"]) }, edits: [] };
  same("a decision taking the class forces that field alone", marketTakes(marketPlace(judgedMarket), profile, source, { repair: takeRepair }), { marketClass: true });
  same("and lists the base it did not take", takeRepair.edits.map((e) => e.path), ["system.market.goods.demand"]);
  const fillRepair = { decision: "keep", edits: [] };
  same("an empty market is filled unforced and lists nothing", [marketTakes(marketPlace(null), profile, source, { repair: fillRepair }), fillRepair.edits.length], [{}, 0]);

  // The wiring that keeps a decided pass from writing what only force wrote.
  const source2 = fs.readFileSync(new URL("../../scripts/importer/cookbook.mjs", import.meta.url), "utf8");
  const steps = source2.slice(source2.indexOf("async function runAdventureBookSteps"), source2.indexOf("/** A document type's name in the user's language"));
  check("under a decision an organisation's relations and strength are never retracted", /retract: decided \? \[\] : retract/.test(steps));
  check("and the organisations' scope carries the decision", /withRewrite\(\{ held: await heldById\(list\), tally, retract: decided \? \[\] : retract, \.\.\.decisionOf\(tally\) \}/.test(steps));
  check("a pregenerated character is rewritten only under force", /monsterRepair\(id, !!tally\.force\)/.test(steps));
  const entries = source2.slice(source2.indexOf("async function repairEntries"), source2.indexOf("/*  Reimport one shelf"));
  check("and is never rebuilt by the entry picker's merged repair", /if \(!characterEntry\(cookbookEntry\(id\)\?\.entry\)\) rebuilds\.push\(id\)/.test(entries));
  check("the picker's rebuilds and its rules tables run on pass one only",
    /if \(rebuilds\.length && !second\) \{/.test(entries) && /if \(tables\?\.length && !second\) \{/.test(entries));
  check("a held organisation's missing relations ask keepsJudgeFigure before they are put back",
    /if \(isRewriting\(id\) && keepsJudgeFigure\(faction, "system\.relations", held, \[\.\.\.held, \.\.\.owed\], cite \?\? ""\)\) \{/.test(source2));
  check("an organisation's strength asks keepsJudgeFigure before it is written",
    /if \(stored\?\.rows\?\.length && keepsJudgeFigure\(faction, "system\.strength", stored, built\.strength/.test(source2));
  check("a market profile under a merged repair forces only the fields marketTakes names",
    /const force = merged \? marketTakes\(place, profile, source, \{/.test(source2));
  const everything = source2.slice(source2.indexOf("export async function cookbookReimportEverything"), source2.indexOf("/** The rebuildable shelf a cookbook id files onto"));
  check("Everything's second pass runs the parts that asked with an ask that answers Yes, so it confirms once",
    /if \(!first\) \{\n\s*for \(const part of partsUnder\(tally\)\.filter\(\(p\) => asked\.includes\(p\.label\)\)\) await part\.run\(async \(\) => true\);/.test(everything));
  check("an ability's description this module made is an edit under a decision",
    /if \(flagged && annotated && repair && "decision" in repair && prose !== built\.system\?\.description\) \{/.test(source2));

  // Every writer converted to the merged repair hands its scope's tally to repairWrite as it came.
  const language = fs.readFileSync(new URL("../../scripts/importer/language-binding.mjs", import.meta.url), "utf8");
  const lastArgs = (text) => {
    const out = [];
    for (let at = text.indexOf("repairWrite("); at >= 0; at = text.indexOf("repairWrite(", at + 1)) {
      if (/function\s+$/.test(text.slice(Math.max(0, at - 16), at))) continue;
      let depth = 0;
      const args = [];
      let last = at + "repairWrite(".length;
      for (let i = last; i < text.length; i++) {
        const c = text[i];
        if ("([{".includes(c)) depth++;
        else if (")]}".includes(c) && depth > 0) depth--;
        else if ((c === "," || c === ")") && depth === 0) {
          args.push(text.slice(last, i).trim());
          last = i + 1;
          if (c === ")") break;
        }
      }
      out.push(args.filter(Boolean).pop());
    }
    return out;
  };
  const handed = [...lastArgs(source2), ...lastArgs(language)];
  same("seven writers call repairWrite", handed.length, 7);
  same("each hands on the tally it was given (a creature's refill names force only where no decision is carried)",
    handed.filter((a) => !["repair", "tally", 'repair && "decision" in repair ? repair : { force }'].includes(a)), []);
}

/* --- a type refusal makes the document again under its own id --- */

{
  const calls = [];
  let refuse = 0;
  const cls = {
    async deleteDocuments(ids, opts) {
      calls.push(["delete", ids, opts]);
      return ids;
    },
    async createDocuments(data, opts) {
      calls.push(["create", data, opts]);
      if (refuse-- > 0) throw new Error("refused");
      return data.map((d) => ({ ...d, id: d._id }));
    },
  };
  const was = foundry.utils.getDocumentClass;
  foundry.utils.getDocumentClass = () => cls;
  const err = console.error;
  console.error = () => {};
  const pack = items.shelf.collection;
  const doc = {
    id: "keep0000000001",
    name: "Thing",
    documentName: "Item",
    pack,
    toObject: () => ({ _id: "keep0000000001", name: "Thing", type: "item", folder: "fold000000001", sort: 7, ownership: { default: 2 } }),
  };
  const built = { name: "Thing", type: "weapon", folder: "fold000000009", system: { n: 1 } };
  const tally = mergedTally("keep");
  const out = await recreateUnderId(tally, doc, built);
  const shape = ([op, arg, opts]) => [op, op === "delete" ? arg : (({ _id, type, folder, sort, ownership }) => ({ _id, type, folder, sort, ownership }))(arg[0]), opts];
  same("the document is removed first, then the build made under its id where it stood, with its folder, sort and owners",
    calls.map(shape), [
      ["delete", ["keep0000000001"], { pack }],
      ["create", { _id: "keep0000000001", type: "weapon", folder: "fold000000001", sort: 7, ownership: { default: 2 } }, { pack, keepId: true }],
    ]);
  check("counted once, and handed back as a plan", tally.recreated === 1 && out.recreated?.type === "weapon" && out.keptProse.length === 0);
  calls.length = 0;
  refuse = 1;
  const failed = await recreateUnderId(tally, doc, built);
  same("a create the server refuses puts the document back as it stood, uncounted",
    [failed, calls.map((c) => c[0]), calls[2]?.[1][0].type, tally.recreated], [{ refused: "error" }, ["delete", "create", "create"], "item", 1]);
  console.error = err;
  foundry.utils.getDocumentClass = was;
}

/* --- pregenerated characters under a merged repair --- */

{
  const calls = [];
  let refuseCopy = false;
  const cls = {
    async deleteDocuments(ids, opts) {
      calls.push(["delete", ids, opts]);
      return held.filter((d) => ids.includes(d.id));
    },
    async createDocuments(data, opts) {
      calls.push(["create", data, opts]);
      if (refuseCopy) throw new Error("refused");
      return data.map((d) => ({ ...d, id: "copy0000000001", uuid: `Compendium.${opts?.pack}.Actor.copy0000000001` }));
    },
  };
  const was = { cls: foundry.utils.getDocumentClass, format: game.i18n.format, error: console.error, log: console.log, warn: console.warn };
  foundry.utils.getDocumentClass = () => cls;
  game.i18n.format = (key, data) => `${key.split(".").pop()}:${JSON.stringify(data)}`;
  console.error = console.log = console.warn = () => {};
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 } };
  game.users = { get: () => ({ isGM: false }) };
  const pack = actors.shelf.collection;
  const pregen = (id, extra = {}) => ({
    id: `pre${id.replace(/\W/g, "").slice(-10).padStart(10, "0")}`,
    uuid: `Compendium.${pack}.Actor.${id}`,
    name: `Hero ${id}`,
    type: "character",
    pack,
    documentName: "Actor",
    ownership: {},
    flags: { [MODULE_ID]: { cookbook: { id }, note: "kept" }, ...(extra.flags ?? {}) },
    _stats: extra._stats ?? {},
    system: { hp: { value: 7 }, details: { biography: "<p>Invented.</p>" } },
    items: [{ _id: "itm0000000001", name: "Stick", type: "item", system: { quantity: { value: 1 } }, sort: 5 }],
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key] ?? null;
    },
    toObject() {
      return structuredClone({ _id: this.id, name: this.name, type: this.type, flags: this.flags, folder: "fold000000001", system: this.system, items: this.items });
    },
  });
  // As the character importer leaves one: its play stamp recorded over what it wrote.
  const stamped = (id) => {
    const doc = pregen(id);
    doc.flags[MODULE_ID].playStamp = playStamp(doc.toObject());
    return doc;
  };
  {
    const asImported = stamped("zz.npc5");
    const hp = stamped("zz.npc6");
    hp.system.hp.value = 3;
    const item = stamped("zz.npc7");
    item.items[0].system.quantity.value = 4;
    const moved = stamped("zz.npc8");
    moved.items[0].sort = 99;
    moved.flags[MODULE_ID].note = "moved";
    const listing = mergedTally("keep");
    await repairPregens(["zz.npc5", "zz.npc6", "zz.npc7", "zz.npc8", "zz.npc9"], [asImported, hp, item, moved, pregen("zz.npc9")], listing);
    same("pass one marks each character changed where its play stamp moved or was never recorded",
      listing.pregens.map((p) => [p.id, p.changed, !!p.unstamped]),
      [["zz.npc5", false, false], ["zz.npc6", true, false], ["zz.npc7", true, false], ["zz.npc8", false, false], ["zz.npc9", true, true]]);
    same("and the default it offers is leave for one as imported, restore for one played, edited in an item, or unstamped",
      listing.pregens.map((p) => pregenDefault(p)), ["leave", "restore", "restore", "leave", "restore"]);
  }
  const owned = pregen("zz.npc4");
  owned.ownership = { user0000000001: 3 };
  const held = [stamped("zz.npc1"), pregen("zz.npc2", { flags: { [MODULE_ID]: { cookbook: { id: "zz.npc2" }, worldCopy: true } } }), owned];
  const first = mergedTally("keep");
  await repairPregens(["zz.npc1", "zz.npc2", "zz.npc3", "zz.npc4"], held, first);
  same("pass one lists each held character and writes nothing; a copy dragged out of the library, a player's character and an absent one are not listed",
    [first.pregens.map((p) => p.id), calls.length], [["zz.npc1"], 0]);
  const second = (answer) => Object.assign(mergedTally({ take: new Set(), pregens: new Map([[held[0].uuid, answer]]) }), { steps: new Set(["pregens"]) });
  const left = second("leave");
  await repairPregens(["zz.npc1"], held, left);
  check("a character answered leave is not touched", calls.length === 0 && !left.restored && !left.pregenRefused);
  const restore = second("restore");
  await repairPregens(["zz.npc1"], held, restore);
  const [made, removed] = calls;
  same("restore first copies the character under a new id where it stands, its claim and play stamp taken off and its origin recorded",
    [made?.[0], made?.[1][0]._id, made?.[1][0].flags[MODULE_ID], made?.[1][0].name, made?.[2]],
    ["create", undefined, { note: "kept", keptFrom: { id: "zz.npc1", uuid: held[0].uuid } }, `repairMergedPregenKeptName:{"name":"Hero zz.npc1"}`, { pack }]);
  same("then removes the character from the library, to import the book's again under its id", [removed?.[0], removed?.[1]], ["delete", [held[0].id]]);
  check("and counts the character once, restored or, where the import made nothing, refused", (restore.restored ?? 0) + (restore.pregenRefused ?? 0) === 1);
  same("the kept copy's uuid is recorded, so a caller can find it", restore.kept, [`Compendium.${pack}.Actor.copy0000000001`]);
  calls.length = 0;
  const rewrite = second("rewrite");
  await repairPregens(["zz.npc1"], held, rewrite);
  same("a rewrite whose import throws is counted refused, never rewritten", [rewrite.rewritten ?? 0, rewrite.pregenRefused ?? 0], [0, 1]);
  calls.length = 0;
  refuseCopy = true;
  const refused = second("restore");
  await repairPregens(["zz.npc1"], held, refused);
  same("a refused copy leaves the character whole and is counted", [calls.map((c) => c[0]), refused.pregenRefused], [["create"], 1]);
  check("no tally carrying no decision lists or acts on any character", (await repairPregens(["zz.npc1"], held, { replaced: 0, edits: [] })) === undefined);
  Object.assign(console, { error: was.error, log: was.log, warn: was.warn });
  delete globalThis.CONST;
  delete game.users;
  game.i18n.format = was.format;
  foundry.utils.getDocumentClass = was.cls;
}

/* --- a rules table's description under a decision --- */

{
  const table = (description) => ({
    uuid: "RollTable.tab0000000001",
    name: "Table",
    description,
    results: [{ id: "row0000000001" }],
    writes: [],
    async update(patch) {
      this.writes.push(["update", patch]);
    },
    async deleteEmbeddedDocuments(_type, ids) {
      this.writes.push(["delete", ids]);
    },
    async createEmbeddedDocuments(_type, rows) {
      this.writes.push(["create", rows.length]);
    },
  });
  const built = { formula: "1d6", description: "<p>Page text.</p>", results: [{ text: "a" }, { text: "b" }], flags: { [MODULE_ID]: { cookbook: { cite: "BK 1" } } } };
  const run = async (decision, description = "<p>A note of the Judge's.</p>") => {
    const t = table(description);
    const repair = mergedTally(decision);
    await rewriteTable(t, built, repair);
    return { update: t.writes[0][1], rows: t.writes.slice(1), repair };
  };
  const kept = await run("keep");
  same("under keep the Judge's description stands and is listed, and the rows are replaced",
    [kept.update, kept.rows, kept.repair.edits.map((e) => [e.key, e.page]), kept.repair.keptProse],
    [{ formula: "1d6" }, [["delete", ["row0000000001"]], ["create", 2]], [["RollTable.tab0000000001#description", "<p>Page text.</p>"]], 1]);
  const taken = await run({ take: new Set(["RollTable.tab0000000001#description"]) });
  same("a decision taking it writes the page's description and lists nothing", [taken.update.description, taken.repair.edits.length], ["<p>Page text.</p>", 0]);
  const empty = await run("keep", "");
  same("an empty description is written and is no edit", [empty.update.description, empty.repair.edits.length], ["<p>Page text.</p>", 0]);
}

/* --- every claimer, and the rows that write onto a place they share --- */

{
  const kinds = [
    { key: "A", owns: (c) => c.startsWith("A.") && !c.endsWith(".foreign") },
    { key: "Z", owns: (c) => c.endsWith(".foreign") },
  ];
  const doc = (claim, n) => ({ claim, n });
  const d1 = doc("A.1", 1);
  const d2 = doc("A.1", 2);
  const d3 = doc("A.1.leaders", 3);
  const d4 = doc("A.1.foreign", 4);
  const d5 = doc("A.3.leaders", 5);
  const claimOf = (d) => d.claim;
  const out = claimerPasses(["A.1", "A.2", "A.3"], [d1, d2, d3, d4, d5], { claimOf, kinds });
  same("pass one holds the first document of every claim, under its own claim",
    [...out.passes[0]].map(([c, d]) => `${c}:${d.n}`), ["A.1:1", "A.1.leaders:3", "A.3.leaders:5"]);
  same("pass two holds the twin, so both documents under one claim are written", [...out.passes[1]].map(([c, d]) => `${c}:${d.n}`), ["A.1:2"]);
  same("a row beneath the id that another kind owns is left", out.foreign.map((d) => d.n), [4]);
  same("an id no document claims exactly is missing", out.missing, ["A.2", "A.3"]);
  same("with no declaration every claimer is held", claimerPasses(["A.1"], [d4], { claimOf }).passes.map((p) => [...p.keys()]), [["A.1.foreign"]]);
  same("an id no kind owns holds every claimer", claimerPasses(["B.1"], [doc("B.1.foreign", 6)], { claimOf, kinds }).foreign, []);

  const entries = {
    "ax9.over": { kind: "kind.location", meta: { group: "North — Overview" } },
    "ax9.poi1": { kind: "kind.location", meta: { group: "North — Points of Interest" } },
    "ax9.poi2": { kind: "kind.location", meta: { group: "North — Points of Interest", sameAs: "zz.poi" } },
    "ax9.rov": { kind: "kind.location", meta: { group: "Region — Overview" } },
    "ax9.site1": { kind: "kind.location", meta: { group: "Region — Sites", market: "mkt1" } },
    "ax9.site2": { kind: "kind.location", meta: { group: "Region — Sites", place: "adventure" } },
    "ax9.site3": { kind: "kind.location", meta: { group: "Region — Sites" } },
    "ax9.site4": { kind: "kind.location", meta: { group: "Region — Sites", sameAs: "zz.site" } },
    "ax9.space": { kind: "kind.location" },
    "ax9.room": { kind: "kind.location", meta: { space: "ax9.space", sameAs: "zz.room" } },
    "ax9.room2": { kind: "kind.location", meta: { space: "ax9.space" } },
  };
  const rows = placeBlockRows("ax9", entries, placePairs(new Map([["ax9", { entries }]])));
  same(
    "the rows that write onto a place they do not build, each with that place's claim",
    rows.map((r) => `${r.id}>${r.place}`),
    [
      "ax9.over>ax9.district.north", "ax9.poi2>ax9.poi2", "ax9.rov>ax9.region", "ax9.site1>ax9.mkt1", "ax9.site2>ax9.adventure",
      "ax9.site4>ax9.site4", "ax9.room>ax9.room",
    ],
  );

  const source = fs.readFileSync(new URL("../../scripts/importer/cookbook.mjs", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("async function repairActors"), source.indexOf("async function repairEntries"));
  check("repairActors takes every claimer through claimerPasses", /claimerPasses\(rewrites,/.test(body));
  check("and builds an entry only in a pass that holds its own claim", /rewrites\.filter\(\(id\) => held\.has\(id\)\)/.test(body));
  const statLine = source.slice(source.indexOf("async function statLineCreature"), source.indexOf("export function regionSiteClaim"));
  check("a held stat-line creature is built again, not returned as it stands", /isRewriting\(oid\) \? null :/.test(statLine));
  check("and its unstamped twins of the build's items are stamped before the write replaces them",
    /unstampedTwins\(standing\.toObject\?\.\(\)\.items \?\? \[\], bound\.items\)/.test(statLine) && statLine.indexOf("unstampedTwins(") < statLine.indexOf("createDoc("));

  // The block writers run only against a real page read; these pin their wiring.
  const fnOf = (head) => {
    const start = source.indexOf(head);
    return start < 0 ? "" : source.slice(start, source.indexOf("\n}\n", start));
  };
  const poi = fnOf("export async function cookbookImportPoiPlaces");
  check("a POI row a forced repair writes onto a shared place skips the held read", /overview \|\| block \|\| isRewriting\(id\) \? null :/.test(poi));
  check("and its overview is read even though the quarter holds notes", /overview && !block && \(/.test(poi));
  check("and the read goes through writeRowBlock", /if \(block\) \{\s*await writeRowBlock\(block, pairRow\(run\.pairs,/.test(poi));
  const character = fnOf("async function importCharacter");
  check("a character import records its play stamp as its last write, over what it wrote",
    /await actor\.update\(\{ \[`flags\.\$\{MODULE_ID\}\.playStamp`\]: playStamp\(actor\.toObject\(\)\) \}\);\s*return actor;$/.test(character));
  const keyed = fnOf("async function importKeyedPlace");
  check("a keyed place's block row skips the held read", /isRewriting\(id\) \|\| block \? null :/.test(keyed));
  check("and writes its block before any pair takeover can run again",
    /if \(block\) return writeRowBlock\(block, pairRow\(/.test(keyed) && keyed.indexOf("writeRowBlock(") < keyed.indexOf("pairedPlace("));
  const regionRow = fnOf("async function importRegionRow");
  check("a region row's block is written at the top, before any held or bind path",
    /const block = blockTarget\(id\);\s*if \(block\) \{[^}]*writeRowBlock\(block, pairRow\(/.test(regionRow) && regionRow.indexOf("writeRowBlock(") < regionRow.indexOf("siteBindPatch("));
  check("writeRowBlock lists the edits it kept in the tally",
    /if \(tally && edits\.length\) \(tally\.edits \?\?= \[\]\)\.push\(\.\.\.edits\);/.test(fnOf("async function writeRowBlock")));
  const hold = fnOf("async function forcedPlaceHold");
  check("forcedPlaceHold holds a shared place for a row only once it answers for the place",
    /if \(doc && answersFor\(doc\.getFlag\(MODULE_ID, "cookbook"\), place\)\) blocks\.set\(id, doc\)/.test(hold));
  check("and the forced adventure walk scopes its places with it", /withRewrite\(\{ \.\.\.\(await forcedPlaceHold\(bookId, ids\.places\)\),/.test(source));
}

/* --- a row's block written in place: a place counts replaced only where something was written --- */

{
  const rowId = "ax1.mkt1";
  const stamped = (text) => bookText([text], "AX 1", { id: rowId, book: "ax1", page: 1 });
  const onPage = stamped("As the page reads.");
  const reread = stamped("As the page reads now.");
  const judged = stamped("As the Judge reworded it.");
  // A block whose stamp records the page's text, so a block that differs is a Judge's edit.
  const place = (notes, cookbook = {}) => ({
    id: "blk00000000001",
    uuid: "Actor.blk00000000001",
    name: "Market",
    documentName: "Actor",
    system: { notes },
    flags: { [MODULE_ID]: { cookbook: { id: rowId, sums: { [sumKey("system.notes", rowId)]: blockDigest(onPage) }, ...cookbook } } },
    writes: [],
    toObject() {
      return structuredClone({ name: this.name, system: this.system, flags: this.flags });
    },
    async update(patch) {
      this.writes.push(patch);
      return this;
    },
  });
  const run = async (doc, rows, decision = "keep") => {
    const tally = { replaced: 0, keptProse: 0, refused: 0, handMade: 0, seen: new Set(), edits: [] };
    await withRewrite({ held: new Map(), blocks: new Map([[rowId, doc]]), tally, decision }, async () => {
      for (const row of rows) await writeRowBlock(doc, row);
    });
    return { tally, writes: doc.writes.length };
  };
  const counts = (r) => [r.tally.replaced, r.tally.refused, r.tally.edits.length, r.writes];

  same("a place whose only difference is the Judge's edit is held: nothing written, nothing replaced, nothing refused",
    counts(await run(place(judged), [{ id: rowId, notes: reread }])), [0, 0, 1, 0]);
  same("the same place under a decision that takes the edit is written and counted replaced",
    counts(await run(place(judged), [{ id: rowId, notes: reread }], "take")), [1, 0, 0, 1]);
  same("a place whose block the page changes is written and counted replaced",
    counts(await run(place(onPage), [{ id: rowId, notes: reread }])), [1, 0, 0, 1]);
  same("a place that already holds the build is counted as written",
    counts(await run(place(onPage), [{ id: rowId, notes: onPage }])), [1, 0, 0, 0]);
  same("a held row followed by a row that writes counts the place once",
    counts(await run(place(judged), [{ id: rowId, notes: reread }, { id: rowId, name: "Named", notes: reread }])), [1, 0, 2, 1]);
  same("a row that writes followed by a held one counts the place once",
    counts(await run(place(judged), [{ id: rowId, name: "Named", notes: reread }, { id: rowId, notes: reread }])), [1, 0, 2, 1]);
  const refusing = place(onPage);
  refusing.update = async () => {
    throw new Error("refused");
  };
  const errorWas = console.error;
  console.error = () => {};
  const refused = await run(refusing, [{ id: rowId, notes: reread }, { id: rowId, notes: reread }]);
  console.error = errorWas;
  same("a write Foundry rejects is counted as left, once", [refused.tally.replaced, refused.tally.refused], [0, 1]);
  check("outside a rewrite the write needs no tally", (await writeRowBlock(place(onPage), { id: rowId, notes: reread })).writes.length === 1);
}

/* --- ticked entries: the picker and the derivation agree --- */

{
  const pick = [
    ["Abilities", "def.prof.alpha"],
    ["Classes", "def.class.alpha"],
    ["Equipment", "def.equip.gear"],
    ["Equipment", "def.equip.mule"],
    ["Traps", "def.trap.one"],
    ["BookItems", "ax1.item1"],
    ["Spells", "def.spell.one"],
    ["Variations", "def.variation.one"],
    ["Vehicles", "def.vehicle.cart"],
    ["Merchandise", "def.merchandise.goods"],
    ["OseCreatures", "mm.group.pack"],
    ["Tables", Object.keys(TABLE_RECIPES)[0]],
  ];
  emptyShelves();
  ticked = pick;
  const made = await drive(() => cookbookReimportEntries());
  const ids = pick.map(([, id]) => id);
  const set = cookbookRunSet({ entries: ids });
  same("every ticked row is owned by the source it was ticked under", ids.map((id) => kindOf(IMPORT_KINDS, id).key), pick.map(([key]) => key));
  same("the entry rebuild calls the runs the derivation names", [...new Set(names(made))].sort(), set.runs.map((r) => r.run).sort());
  same("and no run twice", names(made).length, new Set(names(made)).size);
  for (const run of set.runs) {
    const call = made.find((c) => c.run === run.run);
    const handed = [...(call.arg?.only ?? call.arg)].sort();
    same(`the ${run.run} run is handed the ids the derivation carries`, handed, [...run.ids].sort());
  }
  same("a creature goes to importMany", cookbookRunSet({ entries: ["mm.alpha", "ax1.npc1"] }).runs.map((r) => `${r.run}:${r.ids}`), ["importMany:mm.alpha,ax1.npc1"]);
  same("a claim nothing owns is returned", cookbookRunSet({ entries: ["def.class.alpha", "def.class.ghost"] }).unowned, ["def.class.ghost"]);
  ticked = [];
}

/* --- an entry under a printed table's namespace --- */

{
  // The table kind owns it and the entry kinds do not, whatever the entry's own kind says.
  served["index.json"] = { books: ["mm", "ax1"], content: ["definitions", "extras"] };
  served["extras.json"] = { entries: { "def.language.tongue": { name: "Tongue", book: "rr" } } };
  const log = console.log;
  console.log = () => {};
  await loadCookbook();
  console.log = log;
  same("an ability-shaped entry in a table's namespace is owned by the table kind alone", ownersOf(IMPORT_KINDS, "def.language.tongue").map((k) => k.key), ["Languages"]);
  check("though the entry source still lists it", IMPORT_KINDS.find((k) => k.key === "Abilities").entries().some(([id]) => id === "def.language.tongue"));
}

/* --- the shipped cookbook --- */

{
  const COOKBOOK = fileURLToPath(new URL("../../cookbook/", import.meta.url));
  const real = await import("../../scripts/importer/cookbook.mjs?shipped");
  const fetchWas = globalThis.foundry.utils.fetchJsonWithTimeout;
  globalThis.foundry.utils.fetchJsonWithTimeout = async (url) => JSON.parse(fs.readFileSync(COOKBOOK + String(url).split("/").pop(), "utf8"));
  const index = JSON.parse(fs.readFileSync(`${COOKBOOK}index.json`, "utf8"));
  real.initCookbook({ sessionDocs: new Map(index.books.map((id) => [id, { doc: {} }])) });
  const log = console.log;
  console.log = () => {};
  const loaded = await real.loadCookbook();
  console.log = log;
  globalThis.foundry.utils.fetchJsonWithTimeout = fetchWas;
  check("the shipped cookbook loaded", loaded === true);

  // Every row the cookbook holds: entries, families, and the scene rows.
  const claims = [];
  for (const file of fs.readdirSync(COOKBOOK).filter((n) => n.endsWith(".json") && n !== "registers.json" && n !== "index.json")) {
    const cb = JSON.parse(fs.readFileSync(COOKBOOK + file, "utf8"));
    for (const [id, e] of Object.entries(cb.entries ?? {})) claims.push({ id, kind: e.kind ?? "(none)" });
    for (const [id, row] of Object.entries(cb.scenes ?? {})) claims.push({ id, kind: row.kind ?? "(scene)" });
    for (const id of Object.keys(cb.families ?? {})) claims.push({ id, kind: "(family)" });
  }
  check("the shipped cookbook has rows to check", claims.length > 1000);

  const owned = () => claims.map((c) => ({ ...c, owners: ownersOf(real.IMPORT_KINDS, c.id).map((k) => k.key) }));
  check("no shipped row is owned by two kinds", owned().filter((c) => c.owners.length > 1).length === 0);
  check("no shipped row sits under a printed table's namespace", claims.every((c) => !/^def\.(weapon|armor|priced|language|race)\./.test(c.id)));

  // What no kind owns: a constant a converter reads and a class's metadata own
  // no document, and an entry of another game's book is owned while its picker
  // offers it, which is while its book is open.
  const unownedKinds = () => [...new Set(owned().filter((c) => c.owners.length === 0).map((c) => c.kind))].sort();
  namespace.importer = { oseEntryRows: () => [] };
  const closed = unownedKinds();
  same("the shipped rows nothing owns are two document-less kinds and another game's rows", closed.filter((k) => !k.startsWith("kind.ose")), ["kind.classMeta", "kind.constant"]);
  const creatures = claims.filter((c) => /^kind\.ose.*Monster$/.test(c.kind));
  check("the shipped cookbook has another game's creature rows", creatures.length > 0 && closed.some((k) => /Monster$/.test(k)));
  namespace.importer = { oseEntryRows: () => creatures.map((c) => [c.id, { name: c.id }]) };
  const offered = unownedKinds();
  check("offered by the picker, they are owned", !offered.some((k) => /Monster$/.test(k)) && owned().filter((c) => /Monster$/.test(c.kind)).every((c) => c.owners.join() === "OseCreatures"));
  check("and what stays unowned is the constants, the metadata and the keyed areas", offered.every((k) => ["kind.classMeta", "kind.constant"].includes(k) || /Location$/.test(k)));

  // Every row a kind names is owned by that kind alone, and the entry sources' rows are the picker's.
  const strays = [];
  let rows = 0;
  for (const kind of real.IMPORT_KINDS) {
    for (const [id] of kind.entries()) {
      rows++;
      const owners = ownersOf(real.IMPORT_KINDS, id).map((k) => k.key);
      if (owners.length !== 1 || owners[0] !== kind.key) strays.push(`${kind.key}:${id}:${owners.join("+")}`);
    }
  }
  check("the kinds name shipped rows", rows > 1000);
  same("every row a kind names is owned by that kind alone", strays, []);
  const picked = real.ENTRY_SOURCES.flatMap((src) => src.entries().map(([id]) => id));
  same("every row the picker lists is owned by some kind", real.cookbookRunSet({ entries: picked }).unowned, []);
  check("every adventure book's own rows are walked by its one run", real.IMPORT_KINDS.filter((k) => k.bookSteps?.length).every((k) => k.own));
  const adventure = index.books.filter((id) => real.cookbookRunSet({ book: id }).runs.some((r) => r.run === ADVENTURE_BOOK_RUN));
  check("every shipped Judge's book is given the own-rows run", index.books.filter((id) => bookIsJudges(id)).every((id) => adventure.includes(id)));
  same("and so is each rulebook that prints rows of its own: the bestiary's creatures, the rules' journal, the Judge's roll table",
    adventure.filter((id) => !bookIsJudges(id)).sort(), ["jj", "mm", "rr"]);
}

namespace.importer = importerWas;
Object.assign(REPAIR_RUNS, repairRunsWere);
delete globalThis.foundry;
delete globalThis.ui;
delete globalThis.game;
console.log(`test-import-kinds: ${pass} checks passed.`);
