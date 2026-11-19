/**
 * A repair over a book whose file is gone writes nothing and deletes nothing.
 *
 * The shelved book is a registered `BookHandle` whose fetch answers 404. Three
 * repair entries are driven over it, after the book was imported while its
 * file was there: the book repair (`cookbookReimportBook`), which verifies the
 * book before it asks anything; the entry picker (`cookbookReimportEntries`),
 * whose rebuild is the route that deletes a document and makes it again; and
 * the items step on a repair tally (`cookbookImportAdventureItems`), which
 * also imports an item the world lacks through a reader that hands
 * `executeEntry` the session's document directly. None may write an item from
 * a read that found no file, and none may call a delete. A control run with
 * the file there shows the picker's rebuild does delete and the step does
 * repair. The book is invented, two items with nothing to execute; the world
 * is the item-repair suite's shape.
 */
import assert from "node:assert";
import { MODULE_ID } from "../../scripts/importer/constants.mjs";
import { libraryPackLabel } from "../../scripts/lib/library.mjs";
import { BookHandle } from "../../scripts/importer/book-handle.mjs";
import { repairTally, repairCounts } from "../../scripts/importer/refresh.mjs";
import {
  initCookbook,
  loadCookbook,
  cookbookImportAdventureItems,
  cookbookReimportBook,
  cookbookReimportEntries,
  importedItemFor,
  forgetImportedIndex,
} from "../../scripts/importer/cookbook.mjs";
import { BOOKS } from "../../scripts/importer/books.mjs";

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

const deletes = [];
let serial = 0;
const id16 = (tag) => `${tag}${String(++serial)}`.padEnd(16, "0").slice(0, 16);
const getFlag = function (scope, key) {
  return this.flags?.[scope]?.[key];
};

/** Foundry's update semantics, as far as a repair uses them: a deep merge, `-=key` a deletion. */
function applyUpdate(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (key.startsWith("-=")) {
      delete target[key.slice(2)];
      continue;
    }
    if (key.includes(".")) {
      const parts = key.split(".");
      let at = target;
      for (const part of parts.slice(0, -1)) at = at[part] ??= {};
      applyUpdate(at, { [parts.at(-1)]: value });
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value) && target[key] && typeof target[key] === "object" && !Array.isArray(target[key])) {
      applyUpdate(target[key], value);
    } else target[key] = structuredClone(value);
  }
}

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
const DATA_KEYS = ["name", "type", "img", "folder", "system", "flags"];

class MockItem {
  static documentName = "Item";
  static async create(data, { pack } = {}) {
    const _id = data._id ?? id16("it");
    const doc = {
      ...structuredClone(data),
      id: _id,
      _id,
      pack: pack ?? null,
      documentName: "Item",
      uuid: pack ? `Compendium.${pack}.Item.${_id}` : `Item.${_id}`,
      getFlag,
      toObject() {
        const out = { _id: this._id };
        for (const k of DATA_KEYS) if (this[k] !== undefined) out[k] = structuredClone(this[k]);
        return out;
      },
      async update(patch) {
        applyUpdate(this, patch);
        return this;
      },
    };
    (pack ? packs.get(pack).docs : game.items).set(_id, doc);
    return doc;
  }
  static async createDocuments(list, opts = {}) {
    return Promise.all(list.map((d) => MockItem.create(d, opts)));
  }
  static async deleteDocuments(ids, { pack } = {}) {
    deletes.push(...ids);
    const target = pack ? packs.get(pack).docs : game.items;
    return ids.map((id) => {
      const doc = target.get(id);
      target.delete(id);
      return doc;
    }).filter(Boolean);
  }
}

const notices = [];
globalThis.ui = {
  notifications: {
    info: (m) => notices.push(["info", m]),
    warn: (m) => notices.push(["warn", m]),
    error: (m) => notices.push(["error", m]),
  },
};
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
globalThis.Item = MockItem;
globalThis.Folder = {
  async create(data, { pack } = {}) {
    const folder = { ...data, id: id16("fo"), uuid: `Folder.${serial}`, folder: data.folder ? { id: data.folder } : null };
    (pack ? packs.get(pack).folders : game.folders).set(folder.id, folder);
    return folder;
  },
};
let confirms = 0;
let answer = true;
const asked = [];
const chooserShown = [];
globalThis.foundry = {
  utils: {
    fetchJsonWithTimeout: async (url) => fetched(url),
    getDocumentClass: () => MockItem,
    escapeHTML: (x) => x,
    deepClone: (x) => structuredClone(x),
    mergeObject: (a, b) => ({ ...structuredClone(a), ...structuredClone(b) }),
    setProperty: (obj, path, value) => applyUpdate(obj, { [path]: value }),
  },
  // The repair's choice dialog (`wait`) is closed unanswered, which keeps every edit.
  applications: { api: { DialogV2: { confirm: async (opts) => (confirms++, asked.push(opts), answer), wait: async (opts) => (chooserShown.push(opts), null) } } },
};

/* --- the book --------------------------------------------------------------------------- */

const SCHEMA = "acks-cookbook/2";
const BOOK = "zz";
const ID1 = `${BOOK}.item1`;
const ID2 = `${BOOK}.item2`;
const itemEntry = (n) => ({ kind: "kind.adventureItem", name: `Item ${n}`, cite: `ZZ ${n}`, pages: [n], fields: {} });
const BOOK_FILE = { schema: SCHEMA, book: { id: BOOK, label: "ZZ" }, entries: { [ID1]: itemEntry(1), [ID2]: itemEntry(2) }, scenes: {} };
function fetched(url) {
  const name = String(url).split("/").pop().replace(/\.json$/, "");
  if (name === "registers") return {};
  if (name === "index") return { books: [BOOK], content: [] };
  if (name === BOOK) return structuredClone(BOOK_FILE);
  throw new Error(`404 ${url}`);
}

const sessions = new Map();
initCookbook({ sessionDocs: sessions });
ok("the invented book loads", await loadCookbook());

/* --- the book was imported while its file was there --------------------------------------- */
const mine = (doc) => doc.flags?.[MODULE_ID] ?? {};
BOOKS[BOOK] = { label: "Invented" };
sessions.set(BOOK, { doc: {} });
await cookbookImportAdventureItems({ books: [BOOK], only: new Set([ID1]) });
const one = await importedItemFor(ID1);
ok("the book's first item is on the shelf", !!one && mine(one).cookbook?.id === ID1);
await one.update({ "system.cost": 99 });

/* --- the entry picker's rebuild, the route whose normal path deletes ---------------------- */
// An actor claiming an entry whose kind no in-place run writes is deleted and made
// again by a rebuild (`repairEntries`), after the picker has checked `rebuildable`.
class MockActor {
  static documentName = "Actor";
  static async deleteDocuments(ids) {
    deletes.push(...ids.map((id) => `Actor:${id}`));
    for (const id of ids) game.actors.delete(id);
    return ids;
  }
  static async createDocuments(list) {
    return list.map((d) => ({ ...d, id: id16("ac") }));
  }
}
foundry.utils.getDocumentClass = (type) => (type === "Actor" ? MockActor : MockItem);
const seedActor = () => {
  const _id = id16("ac");
  const actor = { id: _id, _id, name: "Held", type: "npc", documentName: "Actor", pack: null, flags: { [MODULE_ID]: { cookbook: { id: ID1, book: BOOK } } }, getFlag, toObject: () => ({ _id }) };
  game.actors.set(_id, actor);
  return actor;
};
foundry.applications.api.DialogV2.prompt = async (opts) =>
  opts.ok.callback(null, { form: { querySelectorAll: () => [{ value: `Monsters|${ID1}` }] } });
/** Press Rebuild in the picker on the one entry; what a rebuild makes again after its delete is not under test. */
const pickAndRebuild = () => cookbookReimportEntries().catch(() => null);

/* --- then its file goes: a registered handle whose fetch is a 404 ------------------------- */
let files = {};
const fetches = [];
const handle = new BookHandle({
  bookId: BOOK,
  src: "books/zz.pdf",
  numPages: 4,
  title: "Invented",
  fetchImpl: async (path) => (fetches.push(path), files[path] ? { ok: true, status: 200, arrayBuffer: async () => files[path].buffer } : { ok: false, status: 404 }),
  open: async () => ({ doc: { numPages: 4, getPage: async () => ({}), destroy: async () => {} }, numPages: 4, title: "Invented" }),
});
sessions.set(BOOK, { doc: handle });
const quietWarn = console.warn;
console.warn = () => {};
forgetImportedIndex();
const before = JSON.stringify(one.toObject());

const book = await cookbookReimportBook(BOOK);
ok("the book repair over a gone file runs no step", !book?.refill && !book?.mode, JSON.stringify(book));
ok("it says the book is not connected", /reimportNotConnected/.test(notices.at(-1)?.[1] ?? ""), notices.at(-1)?.[1]);
ok("it never asked to rebuild", confirms === 0);
ok("it called no delete and wrote nothing", deletes.length === 0 && JSON.stringify(one.toObject()) === before, JSON.stringify(deletes));
ok("the handle is still unverified", handle.verified === false);

const held = seedActor();
const warnedBefore = notices.length;
await pickAndRebuild();
ok("the picker's rebuild over a gone file calls no delete and keeps the held document", deletes.length === 0 && game.actors.has(held.id), JSON.stringify(deletes));
ok("it says the entry was left", notices.slice(warnedBefore).some(([, m]) => /reimportLeft/.test(m)), JSON.stringify(notices.slice(warnedBefore)));
ok("and the handle is still unverified", handle.verified === false);

forgetImportedIndex();
const tally = repairTally({ force: true });
const step = await cookbookImportAdventureItems({ books: [BOOK], repair: tally });
ok("the items step over a gone file replaces nothing", repairCounts(tally).replaced === 0, JSON.stringify({ step, counts: repairCounts(tally) }));
ok("the held item keeps the price a Judge set", one.system.cost === 99, String(one.system.cost));
ok("and no delete was called", deletes.length === 0 && JSON.stringify(one.toObject()) === before, JSON.stringify(deletes));
forgetImportedIndex();
const fresh = await cookbookImportAdventureItems({ books: [BOOK] });
ok("an item the world lacks is refused, not written blank from a read that found no file", fresh.made === 0 && fresh.refused === 1 && !(await importedItemFor(ID2)), JSON.stringify(fresh));
ok("every read asked for the file and none got it", fetches.length >= 1 && fetches.every((p) => p === "books/zz.pdf") && handle.verified === false);
console.warn = quietWarn;

/* --- control: the file is back and the same step repairs ---------------------------------- */
files = { "books/zz.pdf": new Uint8Array([1]) };
forgetImportedIndex();
const back = repairTally({ force: true });
await cookbookImportAdventureItems({ books: [BOOK], only: new Set([ID1]), repair: back });
ok("with the file back the step replaces the item", repairCounts(back).replaced >= 1 && one.system.cost === 0, JSON.stringify(repairCounts(back)));
ok("and the handle is verified by that read", handle.verified === true);
forgetImportedIndex();
await pickAndRebuild();
ok("control: with the file back the picker's rebuild deletes the held document", deletes.includes(`Actor:${held.id}`) && !game.actors.has(held.id), JSON.stringify(deletes));
forgetImportedIndex();
const made = await cookbookImportAdventureItems({ books: [BOOK] });
ok("and the item the world lacked is imported", made.made === 1 && !!(await importedItemFor(ID2)), JSON.stringify(made));
await handle.destroy();

delete globalThis.foundry;
delete globalThis.Folder;
delete globalThis.Item;
delete globalThis.ui;
delete globalThis.game;
delete BOOKS[BOOK];
console.log(`test-gone-file-repair: ${pass} checks passed.`);
