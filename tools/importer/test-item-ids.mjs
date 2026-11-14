/**
 * A rebuilt Item comes back under the id it stood under.
 *
 * A character's bound class, a journal link and a template part all point at
 * an Item by uuid, so a rebuild that mints a new id leaves every one of them
 * dangling. `itemIds` settles the id each imported Item is written under; the
 * first half pins its choice row by row, and the writes through `createDoc`
 * and `createDocs` that carry it. The shelf mock rejects a whole write that
 * repeats an id it holds, as the server does, so a guard that let one through
 * fails here the way it would fail live.
 *
 * The second half drives the shelf and book repairs over a mocked shelf, with
 * their runs recorded in place of the importers: a repair writes in place, so
 * every document stays under the uuid it had, each run is handed the entries
 * its scope names, and a document of a book the module no longer offers is
 * handed to none and counted. The guard an entry rebuild applies before it
 * deletes (a loaded owner can put the document back, its book is open on the
 * seat and the book is one the module offers) is checked as a pure function
 * (`rebuildVerdict`, `ownerOfClaim`).
 */
import assert from "node:assert";
import {
  itemIds, createDoc, createDocs, cookbookReimportShelf, cookbookReimportBook, initCookbook, loadCookbook, importedActorFor, REPAIR_RUNS,
  cookbookUpdateClasses,
} from "../../scripts/importer/cookbook.mjs";
import { mergedTally } from "../../scripts/importer/refresh.mjs";
import { blockDigest, bookText, sumKey } from "../../scripts/importer/prose.mjs";
import { CLASS_TYPE } from "../../scripts/classes/constants.mjs";
import { ownerOfClaim, rebuildVerdict } from "../../scripts/importer/rebuild-guard.mjs";
import { stableDocId } from "../../scripts/importer/adventure-binding.mjs";
import { libraryPackLabel } from "../../scripts/lib/library.mjs";

let pass = 0;
const check = (label, cond) => {
  assert.ok(cond, label);
  pass++;
};

const MODULE_ID = "acks-extras";
const PACK = "world.acks-cookbook--item";
const claim = (id) => ({ [MODULE_ID]: { cookbook: { id } } });
const row = (id, extra = {}) => ({ name: id, type: "class", flags: claim(id), ...extra });

/* --- the choice, row by row --- */

const none = () => false;
{
  const deleted = new Map([["def.class.alpha", "keptAlpha000001"]]);
  const [a, b] = itemIds([row("def.class.alpha"), row("def.class.beta")], { has: none, deleted });
  check("a row whose document was deleted takes the id it stood under", a._id === "keptAlpha000001");
  check("a row with no record takes the id its cookbook id derives", b._id === stableDocId("def.class.beta"));
  check("the record is taken by the row that used it", !deleted.has("def.class.alpha"));
}
{
  const deleted = new Map([["def.class.alpha", "keptAlpha000001"]]);
  const held = new Set(["keptAlpha000001"]);
  const [a] = itemIds([row("def.class.alpha")], { has: (id) => held.has(id), deleted });
  check("a recorded id the target holds is passed over for the derived one", a._id === stableDocId("def.class.alpha"));
  held.add(stableDocId("def.class.alpha"));
  deleted.set("def.class.alpha", "keptAlpha000001");
  const [b] = itemIds([row("def.class.alpha")], { has: (id) => held.has(id), deleted });
  check("with both held, the row goes bare for core to mint", !("_id" in b));
}
{
  const [a, b] = itemIds([row("def.class.alpha"), row("def.class.alpha")], { has: none, deleted: new Map() });
  check("two rows of one write never share an id", a._id === stableDocId("def.class.alpha") && !("_id" in b));
}
{
  const own = { ...row("def.class.alpha"), _id: stableDocId("def.class.alpha") };
  const [a, b] = itemIds([own, row("def.class.alpha")], { has: none, keepId: true, deleted: new Map() });
  check("a caller's id under its own keepId stands as given", a === own);
  check("and a later row of the write passes over it", !("_id" in b));
}
{
  const stray = { ...row("def.class.alpha"), _id: "fromToObject001" };
  const bare = { name: "loose", type: "item", _id: "fromToObject002" };
  const [a, b] = itemIds([stray, bare], { has: none, deleted: new Map() });
  check("an id the caller did not ask to keep is dropped", a._id === stableDocId("def.class.alpha"));
  check("a row with no cookbook id loses its stray id and gains none", !("_id" in b) && b.name === "loose");
  check("the caller's data is not written to", stray._id === "fromToObject001" && bare._id === "fromToObject002");
}

/* --- the shelf, the funnel and the rebuild --- */

let minted = 0;
const mint = () => `minted${String(++minted).padStart(10, "0")}`;

/** An imported Item as a shelf holds it: what the rebuild and the index read off it. */
const makeDoc = (data, _id) => ({
  id: _id,
  _id,
  name: data.name,
  type: data.type,
  pack: PACK,
  documentName: "Item",
  flags: data.flags ?? {},
  get uuid() {
    return `Compendium.${PACK}.Item.${this.id}`;
  },
  getFlag(scope, key) {
    return this.flags?.[scope]?.[key] ?? null;
  },
});

const shelf = {
  collection: PACK,
  documentName: "Item",
  metadata: { packageType: "world", label: libraryPackLabel("Item"), type: "Item" },
  index: new Map(),
  docs: new Map(),
  async getDocuments() {
    return [...this.docs.values()];
  },
};

/** The server's half of a write: `keepId` keeps a given id, anything else is minted, a held id rejects the write. */
const writes = [];
class ItemMock {
  static documentName = "Item";
  static failBatch = false;
  static land(list, opts) {
    const target = opts.pack === PACK ? shelf : null;
    const ids = list.map((d) => (opts.keepId && d._id ? d._id : mint()));
    if (ids.some((id, n) => target?.index.has(id) || ids.indexOf(id) !== n)) throw new Error("duplicate _id");
    return list.map((d, n) => {
      const doc = makeDoc(d, ids[n]);
      target?.docs.set(doc.id, doc);
      target?.index.set(doc.id, { _id: doc.id });
      return doc;
    });
  }
  static async create(data, opts = {}) {
    writes.push({ how: "one", ids: [data._id], keepId: !!opts.keepId });
    return ItemMock.land([data], opts)[0];
  }
  static async createDocuments(list, opts = {}) {
    writes.push({ how: "batch", ids: list.map((d) => d._id), keepId: !!opts.keepId });
    if (ItemMock.failBatch) throw new Error("rejected");
    return ItemMock.land(list, opts);
  }
  static async deleteDocuments(ids, { pack } = {}) {
    const target = pack === PACK ? shelf : null;
    return ids.map((id) => {
      const doc = target?.docs.get(id);
      target?.docs.delete(id);
      target?.index.delete(id);
      return doc;
    }).filter(Boolean);
  }
}

/** An Actor shelf beside the Item one: every type is written through the same funnel. */
const APACK = "world.acks-cookbook--actor";
const ashelf = {
  collection: APACK,
  documentName: "Actor",
  metadata: { packageType: "world", label: libraryPackLabel("Actor"), type: "Actor" },
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
const actorWrites = [];
class ActorMock {
  static documentName = "Actor";
  static async create(data, opts = {}) {
    actorWrites.push({ ids: [data._id], keepId: !!opts.keepId, pack: opts.pack ?? null });
    const target = opts.pack === APACK ? ashelf : null;
    const _id = opts.keepId && data._id ? data._id : mint();
    if (target?.index.has(_id)) throw new Error("duplicate _id");
    const doc = { ...makeDoc(data, _id), documentName: "Actor", pack: APACK };
    target?.docs.set(_id, doc);
    target?.index.set(_id, { _id });
    return doc;
  }
}

const packs = [shelf, ashelf];
globalThis.game = {
  packs: {
    filter: (fn) => packs.filter(fn),
    find: (fn) => packs.find(fn),
    get: (collection) => packs.find((p) => p.collection === collection) ?? null,
  },
  items: [],
  actors: [],
  collections: new Map([["Item", new Map()], ["Actor", new Map()]]),
  user: { isGM: true },
  i18n: { format: () => "", localize: () => "" },
};
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
/** One loaded content cookbook: two classes of an open book, one of a book the module does not offer. */
const OPEN_BOOK = "rr";
const OFF_BOOK = "zz";
const served = {
  "registers.json": {},
  "index.json": { books: [], content: ["classes"] },
  "classes.json": {
    entries: {
      "def.class.alpha": { kind: "kind.class", name: "Alpha", book: OPEN_BOOK },
      "def.class.beta": { kind: "kind.class", name: "Beta", book: OPEN_BOOK },
      "def.class.offered": { kind: "kind.class", name: "Offered", book: OFF_BOOK },
    },
  },
};
globalThis.foundry = {
  utils: {
    getDocumentClass: () => ItemMock,
    escapeHTML: (x) => x,
    fetchJsonWithTimeout: async (url) => {
      const name = String(url).split("/").pop();
      if (!(name in served)) throw new Error(`not served: ${name}`);
      return served[name];
    },
  },
  applications: { api: { DialogV2: { confirm: async () => true } } },
};

{
  const made = await createDocs(ItemMock, [row("def.class.gamma"), row("def.class.delta")]);
  const last = writes.at(-1);
  check("a batched write is made with keepId", last.how === "batch" && last.keepId);
  check("and each Item lands under its derived id", made.map((d) => d.id).join() === [stableDocId("def.class.gamma"), stableDocId("def.class.delta")].join());
}
{
  const one = await createDoc(ItemMock, row("def.class.epsilon"));
  check("a single write is made with keepId, under the derived id", writes.at(-1).keepId && one.id === stableDocId("def.class.epsilon"));
  const twin = await createDoc(ItemMock, row("def.class.epsilon"));
  check("a second document under a held id is written under core's own, not refused", !!twin && twin.id.startsWith("minted"));
}
{
  // A document created with stamped text records the digest of each block in its stamp,
  // so the first repair reads an edit inside a block against what was written.
  const id = "def.class.sums";
  const text = bookText(["An invented passage."], "ZZ 1", { id, book: "zz", page: 1 });
  const key = sumKey("system.description", id);
  const given = row(id, { system: { description: text } });
  const one = await createDoc(ItemMock, given);
  check("createDoc records the digest of the description block it writes", one.flags[MODULE_ID].cookbook.sums?.[key] === blockDigest(text));
  check("and leaves the caller's data as it was", !("sums" in given.flags[MODULE_ID].cookbook));
  const [batched] = await createDocs(ItemMock, [row("def.class.sums2", { system: { description: bookText(["Another."], "ZZ 1", { id: "def.class.sums2", book: "zz", page: 1 }) } })]);
  check("so does a batched write", !!batched.flags[MODULE_ID].cookbook.sums?.[sumKey("system.description", "def.class.sums2")]);
  const plain = await createDoc(ItemMock, row("def.class.plain", { system: { description: "<p>No block.</p>" } }));
  check("a document with no block gains no digest", plain.flags[MODULE_ID].cookbook.sums === undefined);
}
{
  // A place, a person, a list or a journal is written as an Item is: under
  // the id it stood under, else its derived one, with keepId — a book
  // rebuild keeps the maps that point at them by id.
  const place = { name: "a place", type: "location", flags: claim("zz.district.one") };
  const made = await createDoc(ActorMock, place);
  check("an Actor is written with keepId under its derived id", actorWrites.at(-1).keepId && made.id === stableDocId("zz.district.one"));
  const twin = await createDoc(ActorMock, { ...place });
  check("a second Actor under a held id takes core's own", !!twin && twin.id.startsWith("minted"));
}
{
  ItemMock.failBatch = true;
  const warn = console.warn;
  console.warn = () => {}; // the retry announces itself; the checks below read what it wrote
  const made = await createDocs(ItemMock, [row("def.class.zeta"), row("def.class.eta")]);
  console.warn = warn;
  ItemMock.failBatch = false;
  const singles = writes.slice(-2);
  check("a rejected batch is retried one by one, each with keepId", singles.every((w) => w.how === "one" && w.keepId));
  check("and the retry writes the ids the batch carried", made.map((d) => d.id).join() === [stableDocId("def.class.zeta"), stableDocId("def.class.eta")].join());
}

// The seat holds the open book's cookbook and has that book open; the
// rebuilds below read both.
initCookbook({ sessionDocs: new Map([[OPEN_BOOK, { doc: {} }], [OFF_BOOK, { doc: {} }]]) });
{
  const log = console.log;
  console.log = () => {}; // the load announces itself
  const loaded = await loadCookbook();
  console.log = log;
  check("the content cookbook loaded", loaded === true);
}

// A shelf holding Items under ids core minted, not the ids the import keeps.
shelf.docs.clear();
shelf.index.clear();
for (const [id, _id] of [["def.class.alpha", "legacyAlpha0001"], ["def.class.beta", "legacyBeta00001"]]) {
  const doc = makeDoc(row(id), _id);
  shelf.docs.set(_id, doc);
  shelf.index.set(_id, { _id });
}
// A shelf or book repair writes in place: its runs are recorded here in place
// of the importers, and the documents they would write over stay where they stand.
const namespace = globalThis.acksExtras;
const importerWas = namespace.importer;
const repairRunsWere = { ...REPAIR_RUNS };
const ran = [];
for (const run of Object.keys(REPAIR_RUNS)) {
  REPAIR_RUNS[run] = async (only, tally) => (ran.push({ run, only: [...only].sort(), decision: tally?.decision }), []);
}
// A printed table's repair runs through the api, which answers here with nothing written.
namespace.importer = new Proxy({}, { get: () => async () => [] });
const uuidOf = (id) => [...shelf.docs.values()].find((d) => d.getFlag(MODULE_ID, "cookbook")?.id === id)?.uuid ?? null;
const before = { alpha: uuidOf("def.class.alpha"), beta: uuidOf("def.class.beta") };
const repaired = await cookbookReimportShelf("Classes");
check("the shelf repair deletes nothing", shelf.docs.size === 2 && !("removed" in (repaired ?? {})));
check("each class stays under the uuid it had", uuidOf("def.class.alpha") === before.alpha && uuidOf("def.class.beta") === before.beta);
check("the class run is handed the shelf's loaded entries of offered books, under a keep decision",
  ran.length === 1 && ran[0].run === "importClasses" && ran[0].only.join() === "def.class.alpha,def.class.beta" && ran[0].decision === "keep");

/* --- the guard a rebuild applies before it deletes --- */

{
  const books = { [OPEN_BOOK]: {} };
  const isOpen = (...open) => (book) => open.includes(book);
  const verdict = (claim, ...open) => rebuildVerdict({ ...claim, isOpen: isOpen(...open), books });
  check("a loaded owner, its book open and offered: the delete is allowed", verdict({ owned: true, book: OPEN_BOOK }, OPEN_BOOK) === "rebuild");
  check("a claim nothing loaded owns is refused", verdict({ owned: false, book: null }, OPEN_BOOK) === "unowned");
  check("a book that is not open on the seat is refused", verdict({ owned: true, book: OPEN_BOOK }) === "closed");
  check("a book the module does not offer is refused, though open", verdict({ owned: true, book: OFF_BOOK }, OFF_BOOK) === "withdrawn");
  check("an owner that names no book has none to be closed", verdict({ owned: true, book: null }) === "rebuild");

  const entries = new Map([["def.class.alpha", OPEN_BOOK], ["def.nobook.one", null]]);
  const resolvers = {
    entryBookOf: (id) => (entries.has(id) ? entries.get(id) : undefined),
    groupBookOf: (id) => (id === "zz.group.one" ? OPEN_BOOK : undefined),
    tableBookOf: (id) => (id.startsWith("def.row.") ? OPEN_BOOK : undefined),
  };
  check("an entry owns its own claim", JSON.stringify(ownerOfClaim("def.class.alpha", resolvers)) === JSON.stringify({ owned: true, book: OPEN_BOOK }));
  check("an entry owns a row filed beneath it", ownerOfClaim("def.class.alpha.row.two", resolvers).book === OPEN_BOOK);
  check("an entry that names no book is owned, with no book", JSON.stringify(ownerOfClaim("def.nobook.one", resolvers)) === JSON.stringify({ owned: true, book: null }));
  check("a generator owns its claim through its book", ownerOfClaim("zz.group.one", resolvers).owned);
  check("a table row is owned through the table's book", ownerOfClaim("def.row.sword", resolvers).book === OPEN_BOOK);
  check("a claim no entry, generator or table recipe names has no owner", !ownerOfClaim("def.class.ghost", resolvers).owned);
  check("a claim of one segment is no entry's descendant", !ownerOfClaim("def", resolvers).owned);
}

const sessions = new Map([[OPEN_BOOK, { doc: {} }], [OFF_BOOK, { doc: {} }]]);
initCookbook({ sessionDocs: sessions });
const stock = (...claims) => {
  shelf.docs.clear();
  shelf.index.clear();
  for (const [n, spec] of claims.entries()) {
    const [id, extra] = Array.isArray(spec) ? spec : [spec, {}];
    const _id = `guardrow${String(n).padStart(8, "0")}`;
    const doc = makeDoc(row(id, extra), _id);
    shelf.docs.set(_id, doc);
    shelf.index.set(_id, { _id });
  }
};
const standing = () => [...shelf.docs.values()].map((d) => d.getFlag(MODULE_ID, "cookbook").id).sort();
const stampedWith = (id, book) => ({ flags: { [MODULE_ID]: { cookbook: { id, book } } } });

{
  stock("def.class.alpha", "def.class.offered", "def.class.alpha.row.two", "def.class.ghost");
  ran.length = 0;
  const out = await cookbookReimportShelf("Classes");
  check("a shelf repair leaves an entry's row, an unloaded entry's and an unoffered book's standing",
    standing().join() === "def.class.alpha,def.class.alpha.row.two,def.class.ghost,def.class.offered");
  check("and hands its run loaded entries only, never a claim no entry names", !ran[0].only.includes("def.class.ghost"));
  check("a class of a book the module no longer offers is handed to no run, and counted",
    !ran[0].only.includes("def.class.offered") && out?.notOffered === 1);

  // The class run's own guard, unstubbed: a class of a book not open on this seat is left and counted.
  stock(["def.class.alpha", { type: CLASS_TYPE }]);
  sessions.delete(OPEN_BOOK);
  const repair = mergedTally("keep");
  const wrote = await cookbookUpdateClasses({ only: new Set(["def.class.alpha"]), confirm: false, repair });
  sessions.set(OPEN_BOOK, { doc: {} });
  check("the class run leaves a closed book's class standing and counts it refused",
    wrote === 0 && repair.refused === 1 && standing().join() === "def.class.alpha");
}

{
  stock("def.class.alpha", ["def.class.stray", stampedWith("def.class.stray", OPEN_BOOK)], ["def.class.offered", stampedWith("def.class.offered", OFF_BOOK)]);
  ran.length = 0;
  await cookbookReimportBook(OPEN_BOOK);
  check("a book repair deletes nothing", standing().join() === "def.class.alpha,def.class.offered,def.class.stray");
  const classRun = ran.find((r) => r.run === "importClasses");
  check("and hands the class run that book's entries alone", classRun?.only.join() === "def.class.alpha,def.class.beta");

  ran.length = 0;
  const off = await cookbookReimportBook(OFF_BOOK);
  check("a book the module no longer offers is repaired not at all, though open: no run, nothing written, its documents counted",
    ran.length === 0 && off?.notOffered === 1 && off?.replaced === 0 && standing().join() === "def.class.alpha,def.class.offered,def.class.stray");
}
Object.assign(REPAIR_RUNS, repairRunsWere);

/* --- a copy dragged out of the library answers a link, never a presence or write read --- */

{
  const claimId = "zz.faction.one";
  const copy = {
    name: "copy",
    flags: claim(claimId),
    _stats: { compendiumSource: `Compendium.${APACK}.Actor.libraryactor0001` },
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key] ?? null;
    },
  };
  game.actors.push(copy);
  check("a link read finds the copy", (await importedActorFor(claimId)) === copy);
  check("a presence or write read passes over it", (await importedActorFor(claimId, { copies: false })) === null);
  const library = { ...makeDoc({ name: "body", type: "faction", flags: claim(claimId) }, "libraryactor0001"), documentName: "Actor", pack: APACK };
  ashelf.docs.set(library.id, library);
  check("and finds the library's own document instead", (await importedActorFor(claimId, { copies: false })) === library);
  ashelf.docs.clear();
  game.actors.pop();
}

namespace.importer = importerWas;
delete globalThis.foundry;
delete globalThis.ui;
delete globalThis.game;
console.log(`test-item-ids: ${pass} checks passed.`);
