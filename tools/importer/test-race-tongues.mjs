/**
 * A race's tongues follow the classes the world HOLDS, not only the ones a run makes.
 *
 * A race Item can land after the classes that name it (the rules tables
 * build it), and a class import that finds every class already present makes
 * nothing. The sync that fills an empty race list therefore reads every held
 * imported class; lending a race's tongues to a class whose own page did not
 * parse gives a slot back on each run, so it still borrows only for the
 * classes the run wrote and takes its lenders from everything held.
 *
 * The world is the bookless suite's shape: a mocked world Item shelf, a GM
 * seat, and an invented cookbook of classes with no fields. Every name and
 * tongue below is invented.
 */
import assert from "node:assert";
import { MODULE_ID } from "../../scripts/importer/constants.mjs";
import { libraryPackLabel } from "../../scripts/lib/library.mjs";
import { CLASS_TYPE, RACE_TYPE } from "../../scripts/classes/constants.mjs";
import { initCookbook, loadCookbook, importClasses, syncHeldRaceTongues, forgetImportedIndex } from "../../scripts/importer/cookbook.mjs";

let pass = 0;
const ok = (label, cond, detail = "") => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ""}`);
  pass++;
};

/* --- the world -------------------------------------------------------------------------- */

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

let serial = 0;
const id16 = (tag) => `${tag}${String(++serial)}`.padEnd(16, "0").slice(0, 16);
const getFlag = function (scope, key) {
  return this.flags?.[scope]?.[key];
};

class MockPack {
  constructor(collection, type, label) {
    this.collection = collection;
    this.documentName = type;
    this.metadata = { packageType: "world", label, type };
    this.docs = new Coll();
    this.folders = new Coll();
  }
  get index() {
    return new Coll(this.docs.map((d) => [d.id, { _id: d.id, type: d.type, flags: d.flags }]));
  }
  async getIndex() {
    return this.index;
  }
  async getDocument(id) {
    return this.docs.get(id) ?? null;
  }
  async getDocuments({ _id__in: ids } = {}) {
    return ids ? ids.map((id) => this.docs.get(id)).filter(Boolean) : [...this.docs.values()];
  }
  has(id) {
    return this.docs.has(id);
  }
  get(id) {
    return this.docs.get(id);
  }
}

const ITEM_PACK = "world.acks-cookbook--item";
const shelf = new MockPack(ITEM_PACK, "Item", libraryPackLabel("Item"));
const packs = new Coll([[ITEM_PACK, shelf]]);

/** Every write a document takes, so "writes nothing" is a count. */
const updates = [];
/** A document as the shelf holds it; `update` takes dotted paths as core does. */
function liveDoc(data, pack) {
  const _id = data._id ?? id16("it");
  return {
    ...structuredClone(data),
    id: _id,
    _id,
    pack: pack ?? null,
    documentName: "Item",
    uuid: pack ? `Compendium.${pack}.Item.${_id}` : `Item.${_id}`,
    getFlag,
    async update(patch) {
      updates.push({ id: this.id, keys: Object.keys(patch) });
      for (const [path, value] of Object.entries(patch)) {
        const parts = path.split(".");
        let at = this;
        for (const p of parts.slice(0, -1)) at = at[p] ??= {};
        at[parts.at(-1)] = structuredClone(value);
      }
      return this;
    },
  };
}

class MockItem {
  static documentName = "Item";
  static async create(data, { pack } = {}) {
    const doc = liveDoc(data, pack);
    (pack ? packs.get(pack).docs : game.items).set(doc.id, doc);
    return doc;
  }
  static async createDocuments(list, opts = {}) {
    return Promise.all(list.map((d) => MockItem.create(d, opts)));
  }
  static async deleteDocuments(ids, { pack } = {}) {
    const target = pack ? packs.get(pack).docs : game.items;
    return ids.map((id) => {
      const doc = target.get(id);
      target.delete(id);
      return doc;
    }).filter(Boolean);
  }
}

globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.game = {
  user: { isGM: true },
  i18n: { localize: (k) => k, format: (k, d) => `${k}|${JSON.stringify(d)}` },
  settings: { get: () => undefined },
  items: new Coll(),
  actors: new Coll(),
  folders: new Coll(),
  collections: new Map([["Item", new Coll()]]),
  packs,
};
globalThis.CONFIG = { Item: { dataModels: { [CLASS_TYPE]: {} } } };
globalThis.Item = MockItem;
globalThis.Folder = {
  async create(data, { pack } = {}) {
    const folder = { ...data, id: id16("fo"), uuid: `Folder.${serial}`, folder: data.folder ? { id: data.folder } : null };
    (pack ? packs.get(pack).folders : game.folders).set(folder.id, folder);
    return folder;
  },
};

/* --- the book --------------------------------------------------------------------------- */

const SCHEMA = "acks-cookbook/2";
const classEntry = (name, race) => ({ kind: "kind.class", name, cite: "ZZ 1", pages: [1], book: "zz", fields: {}, meta: race ? { race } : {} });
const CONTENT = {
  classes: {
    schema: SCHEMA,
    entries: {
      "def.class.held": classEntry("Held Class", "testfolk"),
      "def.class.heldbare": classEntry("Held Bare Class", "testfolk"),
      "def.class.other": classEntry("Other Class", "otherfolk"),
      "def.class.fresh": classEntry("Fresh Class", "testfolk"),
    },
  },
};
globalThis.foundry = {
  utils: {
    fetchJsonWithTimeout: async (url) => {
      const name = String(url).split("/").pop().replace(/\.json$/, "");
      if (name === "registers") return {};
      if (name === "index") return { books: [], content: Object.keys(CONTENT) };
      if (CONTENT[name]) return structuredClone(CONTENT[name]);
      throw new Error(`404 ${url}`);
    },
    getDocumentClass: () => MockItem,
    escapeHTML: (x) => x,
    deepClone: (x) => structuredClone(x),
    mergeObject: (a, b) => ({ ...structuredClone(a), ...structuredClone(b) }),
  },
};

const sessions = new Map();
initCookbook({ sessionDocs: sessions });
ok("the invented cookbook loads", await loadCookbook());

/* --- fixtures: held documents ------------------------------------------------------------ */

const claim = (id) => ({ [MODULE_ID]: { cookbook: { id } } });
/** A held imported class that names a race and carries (or lacks) its own parsed tongues. */
const heldClass = (id, { race, parsed, granted, count }) => {
  const doc = liveDoc({
    name: id,
    type: CLASS_TYPE,
    system: { languages: { granted, count } },
    flags: { [MODULE_ID]: { ...claim(id)[MODULE_ID], tongues: { race, parsed } } },
  }, ITEM_PACK);
  shelf.docs.set(doc.id, doc);
  return doc;
};
const heldRace = (name, key, granted) => {
  const doc = liveDoc({ name, type: RACE_TYPE, system: { key, languages: { granted, count: 0 } }, flags: {} }, ITEM_PACK);
  shelf.docs.set(doc.id, doc);
  return doc;
};

const TONGUES = ["Tongue A", "Tongue B"];
const JUDGE_OWN = ["Tongue Z"];
const lender = heldClass("def.class.held", { race: "testfolk", parsed: true, granted: TONGUES, count: 0 });
const bare = heldClass("def.class.heldbare", { race: "testfolk", parsed: false, granted: [], count: 3 });
const other = heldClass("def.class.other", { race: "otherfolk", parsed: true, granted: ["Tongue Y"], count: 0 });
// The races arrive after their classes, as the rules-tables step builds them.
const testfolk = heldRace("Testfolk", "testfolk", []);
const otherfolk = heldRace("Otherfolk", "otherfolk", JUDGE_OWN);
forgetImportedIndex();

const raceTongues = (race) => (race.system.languages.granted ?? []).join();
const log = console.log;
const run = async () => {
  console.log = () => {}; // the lending pass announces itself
  try {
    return await importClasses({ only: null });
  } finally {
    console.log = log;
  }
};

/* --- a run that makes nothing ------------------------------------------------------------ */
{
  // Every class of the cookbook except the fresh one is held; closing the book keeps the run from making it.
  sessions.delete("zz");
  const made = await run();
  ok("the run makes no class", made.length === 0, `${made.length}`);
  ok("a race with an empty list takes the tongues a held class spreads", raceTongues(testfolk) === TONGUES.join(), raceTongues(testfolk));
  ok("a race that already has a list is left as the Judge had it", raceTongues(otherfolk) === JUDGE_OWN.join(), raceTongues(otherfolk));
  ok("a held class that lent nothing keeps its count", bare.system.languages.count === 3 && !bare.system.languages.granted.length);

  const before = updates.length;
  await run();
  ok("a second run writes nothing", updates.length === before, `${updates.length - before} writes`);
  await syncHeldRaceTongues();
  ok("the exported sync is idempotent too", updates.length === before, `${updates.length - before} writes`);
  void lender;
  void other;
}

/* --- a run that makes a class ------------------------------------------------------------ */
{
  sessions.set("zz", { doc: {} });
  const before = updates.map((u) => u.id);
  const made = await run();
  const fresh = made.find((d) => d.flags?.[MODULE_ID]?.cookbook?.id === "def.class.fresh");
  ok("the run makes the one class the world lacked", made.length === 1 && !!fresh, `${made.length}`);
  ok("an unparsed class made now borrows from a held parsed sibling of its race", (fresh?.system?.languages?.granted ?? []).join() === TONGUES.join(), (fresh?.system?.languages?.granted ?? []).join());
  ok("a held unparsed class outside the run keeps its count and its empty list", bare.system.languages.count === 3 && !bare.system.languages.granted.length);
  ok("the run wrote to the one class it made and to no held class", updates.slice(before.length).every((u) => u.id === fresh.id), JSON.stringify(updates.slice(before.length)));
}

delete globalThis.foundry;
delete globalThis.Folder;
delete globalThis.Item;
delete globalThis.CONFIG;
delete globalThis.ui;
delete globalThis.game;
console.log(`test-race-tongues: ${pass} checks passed.`);
