/**
 * An item a book introduces is repaired in place.
 *
 * The items step (`cookbookImportAdventureItems`) passes a held item as
 * already present and, given a repair tally, writes the fresh build over it
 * under `REPAIR.adventureItem`: the slot, the magic mark and the cost return,
 * the quantity a Judge set and a description a Judge wrote stay. The book
 * repair (`cookbookReimportBook`, mode repair) reaches the same run for the
 * book's own items.
 *
 * The book here is invented, two items with nothing to execute, so an open
 * book executes without a page being read; the builder is exercised apart on
 * an invented paragraph. The world is the bookless suite's shape with the two
 * halves a repair needs: `toObject` and an update that merges and deletes.
 */
import assert from "node:assert";
import { MODULE_ID } from "../../scripts/importer/constants.mjs";
import { libraryPackLabel } from "../../scripts/lib/library.mjs";
import { bookText } from "../../scripts/importer/prose.mjs";
import { REPAIR, refreshPlan, repairTally, repairCounts } from "../../scripts/importer/refresh.mjs";
import {
  initCookbook,
  loadCookbook,
  adventureItemData,
  cookbookImportAdventureItems,
  cookbookReimportBook,
  importedItemFor,
  forgetImportedIndex,
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
globalThis.foundry = {
  utils: {
    fetchJsonWithTimeout: async (url) => fetched(url),
    getDocumentClass: () => MockItem,
    escapeHTML: (x) => x,
    deepClone: (x) => structuredClone(x),
    mergeObject: (a, b) => ({ ...structuredClone(a), ...structuredClone(b) }),
    setProperty: (obj, path, value) => applyUpdate(obj, { [path]: value }),
  },
  applications: { api: { DialogV2: { confirm: async () => (confirms++, true) } } },
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

const lastNotice = () => notices.at(-1)?.[1] ?? "";
const mine = (doc) => doc.flags?.[MODULE_ID] ?? {};

/* --- the builder, on an invented paragraph ----------------------------------------------- */
{
  const node = (text, title = null) => ({
    ok: true,
    book: BOOK,
    page: 7,
    fields: { name: title ? { title, caps: true } : undefined, description: [{ text }] },
  });
  const worn = adventureItemData(BOOK, ID1, itemEntry(1), node("Worn around the wrists, these bands steady the hands. Cost: 40 gp and 1 week to craft.", "BANDS OF ZZ"));
  ok("a worn, priced, crafted paragraph yields its slot", worn.flags[MODULE_ID].gear?.slots?.join() === "hands", JSON.stringify(worn.flags));
  ok("its magic mark", worn.flags[MODULE_ID].markets?.magic === true);
  ok("and its cost", worn.system.cost === 40, String(worn.system.cost));
  ok("the name is the page's, set as a title", worn.name === "Bands of Zz", worn.name);
  ok("the description is the stamped block of the entry", worn.system.description.includes(`data-acks-entry="${ID1}"`) && /<p>Worn around/.test(worn.system.description));
  ok("the cookbook stamp names the entry, the book, its kind and its page", JSON.stringify(worn.flags[MODULE_ID].cookbook) === JSON.stringify({ id: ID1, book: BOOK, kind: "kind.adventureItem", cite: "ZZ 1" }));
  ok("no folder unless one is given", worn.folder === null && adventureItemData(BOOK, ID1, itemEntry(1), node("x"), "fo1").folder === "fo1");

  const dose = adventureItemData(BOOK, ID2, itemEntry(2), node("A dose drunk at dawn. Cost: 5 sp."));
  ok("a dose has no slot and no mark", !mine(dose).gear && !mine(dose).markets);
  ok("and a price in silver reads in gold", dose.system.cost === 0.5, String(dose.system.cost));
  ok("a dose carries one, with no quantity cap", dose.system.quantity.value === 1 && dose.system.quantity.max === 0);
  ok("a paragraph with no price costs 0, never null", adventureItemData(BOOK, ID2, itemEntry(2), node("A cord.")).system.cost === 0);
  ok("a page that gave no name keeps the entry's label", dose.name === "Item 2", dose.name);

  /* --- the policy, on the stripped shape a world imported before the binding holds ------- */
  const stripped = {
    type: "item",
    system: { description: worn.system.description, subtype: "item", quantity: { value: 3, max: 0 }, cost: 0, weight: 0, weight6: 0 },
    flags: { [MODULE_ID]: { cookbook: { id: ID1, book: BOOK, kind: "kind.adventureItem", cite: "ZZ 1" } } },
  };
  const plan = refreshPlan(stripped, worn, REPAIR.adventureItem);
  ok("the plan writes the slot and the mark", plan.update.flags[MODULE_ID].gear.slots.join() === "hands" && plan.update.flags[MODULE_ID].markets.magic === true, JSON.stringify(plan.update.flags));
  ok("and the cost", plan.update.system.cost === 40);
  ok("the quantity is left as the Judge's", plan.update.system.quantity === undefined);
  ok("the stamp is refreshed around its identity", plan.update.flags[MODULE_ID].cookbook.id === undefined && plan.update.flags[MODULE_ID].cookbook.cite === "ZZ 1");
  ok("a stamped description is the module's and is rewritten", plan.update.system.description !== undefined && plan.keptProse.length === 0);
  const judged = structuredClone(stripped);
  judged.system.description = `${worn.system.description}<p>Found in the well.</p>`;
  const kept = refreshPlan(judged, worn, REPAIR.adventureItem);
  ok("a description a Judge wrote in stays, and the plan says so", kept.update.system.description === undefined && kept.keptProse.join() === "description");
  ok("while its slot, mark and cost are still written", kept.update.flags[MODULE_ID].gear.slots.join() === "hands" && kept.update.system.cost === 40);
  const other = refreshPlan({ ...stripped, type: "weapon" }, worn, REPAIR.adventureItem);
  ok("a document of another type is refused", other.refused === "type");
}

/* --- the step: a held item is passed over, and repaired on request ---------------------- */
const onShelf = (cbId) => shelf.docs.find((d) => d.getFlag(MODULE_ID, "cookbook")?.id === cbId) ?? null;
{
  ok("with the book closed the step has no jobs", JSON.stringify(await cookbookImportAdventureItems({ books: [BOOK] })) === JSON.stringify({ made: 0, already: 0, refused: 0, created: { items: [] } }));

  sessions.set(BOOK, { doc: {} });
  const first = await cookbookImportAdventureItems({ books: [BOOK] });
  ok("the open book's two items are imported", first.made === 2 && first.already === 0 && first.refused === 0 && first.created.items.length === 2, JSON.stringify(first));
  const one = onShelf(ID1);
  const two = onShelf(ID2);
  ok("each stands on the shelf under its id, in the book's folder", !!one && !!two && !!one.folder, JSON.stringify({ one: !!one, two: !!two, folder: one?.folder }));
  ok("an item built from an empty page costs 0 and carries no slot", one.system.cost === 0 && !mine(one).gear);
  ok("the notice does not claim a repair", /2 imported, 0 already present\./.test(lastNotice()), lastNotice());

  // The world's hand on them: a price, a slot, a quantity, a Judge's note on the second.
  await one.update({ "system.cost": 99, "system.quantity.value": 3, [`flags.${MODULE_ID}.gear`]: { slots: ["belt"] } });
  await two.update({ "system.description": `${two.system.description}<p>Kept by the smith.</p>`, "system.cost": 7 });
  forgetImportedIndex();
  const plain = await cookbookImportAdventureItems({ books: [BOOK] });
  ok("a plain run passes both as already present and imports nothing", plain.made === 0 && plain.already === 2 && plain.refused === 0, JSON.stringify(plain));
  ok("and rewrites neither", one.system.cost === 99 && mine(one).gear.slots.join() === "belt" && two.system.cost === 7);
  ok("the notice still does not claim a repair", /0 imported, 2 already present\./.test(lastNotice()), lastNotice());

  const tally = repairTally();
  const repaired = await cookbookImportAdventureItems({ books: [BOOK], repair: tally });
  ok("a run with a tally passes both as already present", repaired.made === 0 && repaired.already === 2 && repaired.refused === 0, JSON.stringify(repaired));
  ok("and the tally replaced both, one keeping the Judge's prose", JSON.stringify(repairCounts(tally)) === JSON.stringify({ replaced: 2, keptProse: 1, refused: 0 }), JSON.stringify(repairCounts(tally)));
  ok("the first's cost is written back to its build's", one.system.cost === 0, String(one.system.cost));
  // A flag the build does not carry is not retracted: the binder writes its
  // own answers over the document and leaves what it has no answer for.
  ok("a slot a hand set where the page gave none is left", mine(one).gear?.slots?.join() === "belt", JSON.stringify(mine(one).gear));
  ok("its quantity of 3 is the Judge's and stays", one.system.quantity.value === 3, String(one.system.quantity.value));
  ok("the second's note stays while its cost is rewritten", /Kept by the smith/.test(two.system.description) && two.system.cost === 0);
  ok("the identity stamp survives the repair", mine(one).cookbook.id === ID1 && mine(one).cookbook.book === BOOK);
  ok("the notice says repaired in place", /already present, repaired in place\./.test(lastNotice()), lastNotice());

  const again = await cookbookImportAdventureItems({ books: [BOOK], repair: tally });
  ok("the same tally meets each document once", again.already === 2 && repairCounts(tally).replaced === 2, JSON.stringify(repairCounts(tally)));

  await one.update({ "system.cost": 99 });
  await two.update({ "system.cost": 99 });
  const narrow = repairTally();
  const only = await cookbookImportAdventureItems({ books: [BOOK], only: new Set([ID1]), repair: narrow });
  ok("`only` narrows the run to the one entry", only.already === 1 && repairCounts(narrow).replaced === 1, JSON.stringify(only));
  ok("which is repaired while the other is left", one.system.cost === 0 && two.system.cost === 99);

  /* --- the book repair reaches the book's own items ------------------------------------- */
  await one.update({ "system.cost": 99 });
  confirms = 0;
  const byBook = await cookbookReimportBook(BOOK, { mode: "repair" });
  ok("the book repair asks once and runs the items step", confirms === 1 && !!byBook?.refill?.cookbookImportAdventureItems, JSON.stringify(byBook));
  ok("it replaced both items and refused none", byBook.mode === "repair" && byBook.replaced === 2 && byBook.refused === 0, JSON.stringify(byBook));
  ok("and the price is the build's again", one.system.cost === 0 && two.system.cost === 0);

  ok("the shelf still holds the two documents and no more", shelf.docs.size === 2 && (await importedItemFor(ID1)) === one, String(shelf.docs.size));
}

delete globalThis.foundry;
delete globalThis.Folder;
delete globalThis.Item;
delete globalThis.ui;
delete globalThis.game;
console.log(`test-adventure-item-repair: ${pass} checks passed.`);
