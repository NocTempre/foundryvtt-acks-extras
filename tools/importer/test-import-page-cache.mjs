/**
 * A bulk import reads each PDF page once.
 *
 * `importTables` locates every table by scanning pages for its anchor, and
 * `cookbookUpdateAbilities` re-executes each ability definition against its
 * book. Reading a page is the expensive step (`getTextContent`), so both keep a
 * page cache for exactly as long as one call: a page is extracted once however
 * many recipes or definitions print on it, and is read afresh by the next call.
 *
 * The books here are invented: a page is one text run, counted when it is
 * extracted, and a table recipe is any shipped recipe whose anchor the invented
 * pages never print, so a locate scans the whole book. The world is the
 * bookless-import suite's shape.
 */
import assert from "node:assert";
import { libraryPackLabel } from "../../scripts/lib/library.mjs";
import { pageItems } from "../../scripts/importer/extract.mjs";
import { importTables, tableRecipeBooks } from "../../scripts/importer/tables-binding.mjs";
import { TABLE_RECIPES } from "../../scripts/importer/table-recipes.mjs";
import { pdfGuess } from "../../scripts/importer/table-extract.mjs";
import * as services from "../../scripts/lib/services.mjs";
import { initCookbook, loadCookbook, cookbookImportAbilities, cookbookUpdateAbilities } from "../../scripts/importer/cookbook.mjs";

let pass = 0;
const ok = (label, cond, detail = "") => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ""}`);
  pass++;
};

/* --- an invented book that counts its page reads ------------------------------------------ */

const H = 792;
/**
 * A book of `numPages` one-run pages. `reads` counts `getTextContent` per page
 * since the last `settle()`; `failOnce` makes the next read of that page throw.
 */
function countingBook(numPages) {
  const reads = new Map();
  const doc = {
    numPages,
    reads,
    failOnce: null,
    async getPage(n) {
      return {
        getViewport: () => ({ width: 612, height: H }),
        getTextContent: async () => {
          reads.set(n, (reads.get(n) ?? 0) + 1);
          if (doc.failOnce === n) {
            doc.failOnce = null;
            throw new Error("read failed");
          }
          return { items: [{ str: `page ${n}`, transform: [1, 0, 0, 1, 100, H - 100], width: 40, height: 10, fontName: "F1" }] };
        },
        getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
      };
    },
    /** Warm the document's furniture profile, then zero the counters. */
    async settle() {
      await pageItems(doc, 1);
      reads.clear();
    },
  };
  return doc;
}
const total = (doc) => [...doc.reads.values()].reduce((a, b) => a + b, 0);
const most = (doc) => Math.max(0, ...doc.reads.values());

/* --- importTables: one cache per call --------------------------------------------------- */
{
  const imported = [];
  services.register("ruledata-import", { async importDoc(doc) { imported.push(doc.id); } });

  // A ruledata document of several plain recipes in one book: each recipe's
  // locate scans every page of that book, and the invented pages print nothing
  // it looks for.
  const plain = (r) => !r.valueBlocks && !r.blocks && !r.subTables;
  const docId = Object.keys(TABLE_RECIPES).find((id) => {
    const recipes = Object.values(TABLE_RECIPES[id].tables);
    return recipes.length >= 3 && recipes.every(plain) && new Set(recipes.map((r) => r.book)).size === 1;
  });
  ok("a ruledata document of several plain recipes in one book exists to drive", !!docId);
  const book = Object.values(TABLE_RECIPES[docId].tables)[0].book;
  // Long enough that every page a recipe's search radius reaches exists.
  const PAGES = Math.max(...Object.values(TABLE_RECIPES[docId].tables).map((r) => pdfGuess(r) + (r.searchRadius ?? 12))) + 1;

  const bookDocs = new Map();
  const open = async () => {
    const sessions = new Map();
    for (const b of tableRecipeBooks()) {
      const doc = countingBook(PAGES);
      await doc.settle();
      bookDocs.set(b, doc);
      sessions.set(b, { doc });
    }
    return sessions;
  };

  const sessions = await open();
  const doc = bookDocs.get(book);
  const first = await importTables(sessions, { only: [docId] });
  ok("a locate that finds nothing reports each recipe as not found", first.missingTables.length >= 3, `${first.missingTables.length}`);
  ok("every page of the book was extracted", doc.reads.size === PAGES, `${doc.reads.size}`);
  ok("each page was extracted once for the whole call, not once per recipe", most(doc) === 1 && total(doc) === PAGES, `max ${most(doc)}, total ${total(doc)}`);

  doc.reads.clear();
  await importTables(sessions, { only: [docId] });
  ok("the next call reads the pages afresh", most(doc) === 1 && total(doc) === PAGES, `max ${most(doc)}, total ${total(doc)}`);

  // A read that fails is not remembered: the next locate in the same call tries again.
  doc.reads.clear();
  doc.failOnce = 1;
  const failed = await importTables(sessions, { only: [docId] });
  ok("a failed read lands in the report", failed.missingTables.some((m) => /read failed/.test(m)), failed.missingTables.join("|"));
  ok("and is retried by the next recipe, then cached", doc.reads.get(1) === 2 && doc.reads.get(2) === 1, `page 1 ${doc.reads.get(1)}, page 2 ${doc.reads.get(2)}`);
  ok("a document nothing was found for is never handed to the store", !imported.length, imported.join());
}

/* --- cookbookUpdateAbilities: one cache per run -------------------------------------------- */

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
  data: { operators: { ForcedDeletion: class ForcedDeletion {} } },
  utils: {
    fetchJsonWithTimeout: async (url) => fetched(url),
    getDocumentClass: () => MockItem,
    escapeHTML: (x) => x,
    deepClone: (x) => structuredClone(x),
    mergeObject: (a, b) => ({ ...structuredClone(a), ...structuredClone(b) }),
  },
};

const SCHEMA = "acks-cookbook/2";
/** One invented ability that reads one box of page 2; two entries share the page. */
const reading = (name, book) => ({
  kind: "kind.proficiency",
  name,
  cite: `${book.toUpperCase()} 2`,
  pages: [2],
  book,
  meta: { category: "proficiency", general: true },
  fields: { note: { op: "value", page: 2, box: { x0: 0, x1: 400, y0: 50, y1: 150 }, pattern: "raw" } },
});
const CONTENT = {
  proficiencies: {
    schema: SCHEMA,
    entries: { "def.prof.gamma": reading("Gamma", "zz"), "def.prof.delta": reading("Delta", "zz") },
  },
};
function fetched(url) {
  const name = String(url).split("/").pop().replace(/\.json$/, "");
  if (name === "registers") return {};
  if (name === "index") return { books: [], content: Object.keys(CONTENT) };
  if (CONTENT[name]) return structuredClone(CONTENT[name]);
  throw new Error(`404 ${url}`);
}

{
  const sessions = new Map();
  initCookbook({ sessionDocs: sessions });
  ok("the invented cookbook loads", await loadCookbook());
  const abilityBook = countingBook(4);
  await abilityBook.settle();
  sessions.set("zz", { doc: abilityBook });

  const made = await cookbookImportAbilities();
  ok("both abilities are on the shelf to update", made.made === 2, JSON.stringify(made));

  abilityBook.reads.clear();
  const result = await cookbookUpdateAbilities();
  ok("both abilities are rewritten", result.updated === 2 && result.unread === 0, JSON.stringify(result));
  ok("the page both print on is extracted once for the run", abilityBook.reads.get(2) === 1, `${abilityBook.reads.get(2)}`);
  ok("and no other page is read", total(abilityBook) === 1, `${total(abilityBook)}`);

  abilityBook.reads.clear();
  await cookbookUpdateAbilities();
  ok("the next run reads the page afresh", abilityBook.reads.get(2) === 1, `${abilityBook.reads.get(2)}`);
}

delete globalThis.foundry;
delete globalThis.Folder;
delete globalThis.Item;
delete globalThis.ui;
delete globalThis.game;
console.log(`test-import-page-cache: ${pass} checks passed.`);
