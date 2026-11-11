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
 * A book rebuild names the entry-backed shelves only; a book repair also names
 * a book's own items and the printed tables, and the price list rides the
 * equipment run; neither reaches a creature, a vehicle or a place of a plain
 * book. `viaBook` declares the first of these, and `cookbookRunSet` answers it.
 */
import assert from "node:assert";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ancestorsOf, ownersOf, kindOf, booksOfKind, runSetFor, ADVENTURE_BOOK_RUN,
} from "../../scripts/importer/import-kinds.mjs";
import {
  IMPORT_KINDS, ENTRY_SOURCES, SHELF_REFILL, REPAIR_RUNS, TABLE_BOOKS, cookbookRunSet, cookbookReimportShelf, cookbookReimportBook,
  cookbookReimportAdventure, cookbookReimportEntries, reimportableShelves, initCookbook, loadCookbook,
} from "../../scripts/importer/cookbook.mjs";
import { TABLE_RECIPES } from "../../scripts/importer/table-recipes.mjs";
import { bookIsJudges } from "../../scripts/importer/books.mjs";
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
  const world = { kinds, isAdventureBook: (book) => book === "x", order: { book: ["runB", "runA"], all: ["stepE", "stepD", "stepC", "stepB", "stepA"] } };
  check("two kinds that share a shelf share one run each", runSetFor({ shelf: "S" }, world).runs.map((r) => r.run).join() === "runA,runB");
  check("a shelf no kind files on has no run", runSetFor({ shelf: "none" }, world).runs.length === 0);
  const book = runSetFor({ book: "x" }, world);
  check("a book scope runs what its viaBook kinds name, in the order given", book.runs.map((r) => r.run).join() === "runB,runA,runAdventureBookSteps");
  check("and an adventure book's own rows are one run, not their own", book.runs.at(-1).kinds.join() === "C" &&book.runs.at(-1).book === "x");
  check("a plain book's own rows are not named", runSetFor({ book: "x" }, { ...world, isAdventureBook: () => false }).runs.every((r) => r.run !== ADVENTURE_BOOK_RUN));
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

  // The picker imports the ticked creatures through the same function.
  const picker = source.slice(source.indexOf("async function runEntryReimport"));
  check("the entry picker imports creatures through importMany", /refill\.Monsters = await importMany\(monsters,/.test(picker));
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
  const tail = new Set(["cookbookUpdateAbilities", "importTemplatePackages", "cookbookFillCompanions", "resolveLegacyText"]);
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
  same(
    "a plain book rebuild calls the runs the derivation names, in its order",
    names(made),
    set.runs.map((r) => r.run),
  );
  same(
    "which are the shelves its entries file on, in the refill table's order",
    names(made),
    ["cookbookImportAbilities", "importAllEquipment", "importVariations", "importMerchandise", "importTraps", "importSpells", "importClasses"],
  );
  check("a printed table's row and a vehicle are not named by a book scope", !set.runs.some((r) => r.kinds.some((k) => ["Weapons", "PriceList", "Vehicles", "Monsters"].includes(k))));
  same("each run carries the book's claims of its kinds", set.runs.find((r) => r.run === "importClasses").ids, ["def.class.alpha"]);

  // The adventure book's content is the shelves above; its own rows are one run.
  emptyShelves();
  stockItem("def.class.adv");
  const content = await drive(() => cookbookReimportBook("ax1"));
  const adventure = cookbookRunSet({ book: "ax1" });
  same("an adventure book's content shelves are rebuilt as a plain book's are", names(content), adventure.runs.filter((r) => r.run !== ADVENTURE_BOOK_RUN).map((r) => r.run));
  const last = adventure.runs.at(-1);
  check("and its own rows are the one adventure book run, last", last.run === ADVENTURE_BOOK_RUN && last.book === "ax1");
  same(
    "which names every kind its steps report",
    last.kinds,
    IMPORT_KINDS.filter((k) => k.own && k.bookSteps?.length && booksOfKind(k).includes("ax1")).map((k) => k.key),
  );
  check("a content kind of the book is not also in the adventure run", !adventure.runs.some((r) => r.run !== ADVENTURE_BOOK_RUN && r.kinds.includes("Monsters")));
  check("a plain book has no adventure run", !cookbookRunSet({ book: "rr" }).runs.some((r) => r.run === ADVENTURE_BOOK_RUN));

  // The adventure rebuild walks the steps; each api call it makes is a step kind's run.
  emptyShelves();
  let result = null;
  const walked = await drive(async () => {
    result = await cookbookReimportAdventure("ax1");
  });
  const reported = [...result.steps.map((s) => s.key), ...result.errors.map((e) => e.key)].sort();
  same("the adventure book rebuild reports every step the kinds declare", reported, IMPORT_KINDS.flatMap((k) => k.bookSteps ?? []).sort());
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
  same("the books given the adventure run are the shipped Judge's books", adventure.sort(), index.books.filter((id) => bookIsJudges(id)).sort());
}

namespace.importer = importerWas;
delete globalThis.foundry;
delete globalThis.ui;
delete globalThis.game;
console.log(`test-import-kinds: ${pass} checks passed.`);
