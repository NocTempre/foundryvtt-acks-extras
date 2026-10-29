/**
 * An import with a book closed creates nothing.
 *
 * Every importer that builds a document from one cookbook entry reads the
 * entry off the seat's own copy of its book first (`readForImport`). An entry
 * whose book is not open on the seat is passed over and counted into the
 * run's notice; nothing is built from the entry's shape alone, and a run with
 * the book open imports what the closed run passed over. The three equipment
 * sweeps that delete what the import is trusted to rebuild keep what the
 * import would pass over.
 *
 * The cookbooks here are invented, two books of one entry each per content
 * type, and every entry has no fields, so an open book executes without a page
 * being read: a session is any object. The world is the region suite's shape —
 * a world Item library on a mocked pack, a folder collection, a GM seat.
 */
import assert from "node:assert";
import { MODULE_ID } from "../../scripts/importer/constants.mjs";
import { libraryPackLabel } from "../../scripts/lib/library.mjs";
import { ARMOR_TABLE } from "../../scripts/importer/armor-tables.mjs";
import {
  initCookbook,
  loadCookbook,
  importSpells,
  importEquipment,
  cookbookImportAbilities,
  importedItemFor,
  forgetImportedIndex,
  repairShieldVariations,
} from "../../scripts/importer/cookbook.mjs";

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

/** The server's half of a write: a document on the pack it was written to. */
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
      async update(patch) {
        Object.assign(this, patch);
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
globalThis.foundry = {
  utils: {
    fetchJsonWithTimeout: async (url) => fetched(url),
    getDocumentClass: () => MockItem,
    escapeHTML: (x) => x,
    deepClone: (x) => structuredClone(x),
    mergeObject: (a, b) => ({ ...structuredClone(a), ...structuredClone(b) }),
  },
};

/* --- the books -------------------------------------------------------------------------- */

const SCHEMA = "acks-cookbook/2";
/** One invented entry of a kind, read from one invented book, with nothing to execute. */
const entry = (kind, book, extra = {}) => ({ kind, name: `${kind} of ${book}`, cite: `${book.toUpperCase()} 1`, pages: [1], book, fields: {}, ...extra });
const CONTENT = {
  spells: { schema: SCHEMA, entries: { "def.spell.alpha": entry("kind.spell", "zz"), "def.spell.beta": entry("kind.spell", "yy") } },
  proficiencies: {
    schema: SCHEMA,
    entries: {
      "def.prof.gamma": entry("kind.proficiency", "zz", { meta: { category: "proficiency", general: true } }),
      "def.prof.delta": entry("kind.proficiency", "yy", { meta: { category: "proficiency", general: true } }),
    },
  },
  equipment: { schema: SCHEMA, entries: { "def.equip.epsilon": entry("kind.equipment", "zz", { meta: { group: "gear" } }) } },
};
function fetched(url) {
  const name = String(url).split("/").pop().replace(/\.json$/, "");
  if (name === "registers") return {};
  if (name === "index") return { books: [], content: Object.keys(CONTENT) };
  if (CONTENT[name]) return structuredClone(CONTENT[name]);
  throw new Error(`404 ${url}`);
}

const sessions = new Map();
initCookbook({ sessionDocs: sessions });
ok("the invented cookbooks load", await loadCookbook());

const onShelf = (cbId) => shelf.docs.find((d) => d.getFlag(MODULE_ID, "cookbook")?.id === cbId) ?? null;
const lastNotice = () => notices.at(-1)?.[1] ?? "";
const CLOSED = /passed over — their book is not open on this seat/;

/* --- spells: one book open, one closed --------------------------------------------------- */
{
  sessions.set("zz", { doc: {} });
  const made = await importSpells();
  ok("the open book's spell is imported", made.length === 1 && onShelf("def.spell.alpha"), `${made.length}`);
  ok("the closed book's spell is not", !onShelf("def.spell.beta"));
  ok("the notice counts the one passed over as its book not open", /1 passed over — their book is not open/.test(lastNotice()), lastNotice());
  ok("the shelf holds one document", shelf.docs.size === 1, `${shelf.docs.size}`);

  sessions.set("yy", { doc: {} });
  const again = await importSpells();
  ok("opening the book imports what was passed over", again.length === 1 && onShelf("def.spell.beta"));
  ok("and the notice no longer counts a closed book", !CLOSED.test(lastNotice()), lastNotice());
  sessions.delete("yy");
}

/* --- abilities: the bulk run --------------------------------------------------------------- */
{
  const result = await cookbookImportAbilities();
  ok("the open book's ability is imported and the closed book's counted", result.made === 1 && result.closed === 1, JSON.stringify(result));
  ok("no document stands for the closed book's ability", onShelf("def.prof.gamma") && !onShelf("def.prof.delta"));
  ok("the abilities notice says one was passed over", CLOSED.test(lastNotice()), lastNotice());

  sessions.delete("zz");
  const none = await cookbookImportAbilities();
  ok("with every book closed the run imports nothing and counts the rest", none.made === 0 && none.reused === 1 && none.closed === 1, JSON.stringify(none));
  sessions.set("zz", { doc: {} });
}

/* --- equipment: one entry, the tally the caller passes ------------------------------------- */
{
  sessions.delete("zz");
  const passed = { reasons: [], count(r) { this.reasons.push(r); return null; } };
  const nothing = await importEquipment("def.equip.epsilon", null, { passed });
  ok("a closed book's equipment entry yields no document", nothing === null);
  ok("and the caller's tally hears why", passed.reasons.join() === "book-closed", passed.reasons.join());
  ok("nothing was written to the shelf for it", !onShelf("def.equip.epsilon"));
  sessions.set("zz", { doc: {} });
  forgetImportedIndex();
  ok("the shelf answers that it holds no such item", (await importedItemFor("def.equip.epsilon")) === null);
}

/* --- the shield sweep keeps what the import would pass over ------------------------------- */
{
  const wrong = await MockItem.create(
    { name: "a form", type: "variation", flags: { [MODULE_ID]: { minted: true, cookbook: { id: "def.variation.shieldForm" } } } },
    { pack: ITEM_PACK },
  );
  forgetImportedIndex();
  sessions.delete(ARMOR_TABLE.book);
  ok("with the armour book closed the sweep removes nothing", (await repairShieldVariations()) === 0 && shelf.docs.has(wrong.id));
  sessions.set(ARMOR_TABLE.book, { doc: {} });
  ok("with it open the sweep removes the form", (await repairShieldVariations()) === 1 && !shelf.docs.has(wrong.id));
  sessions.delete(ARMOR_TABLE.book);
}

delete globalThis.foundry;
delete globalThis.Folder;
delete globalThis.Item;
delete globalThis.ui;
delete globalThis.game;
console.log(`test-bookless-import: ${pass} checks passed.`);
