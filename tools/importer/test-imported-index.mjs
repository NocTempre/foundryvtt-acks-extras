/**
 * "Have I imported this already?" against a compendium that has gone cold.
 *
 * A CompendiumCollection is a cache with an index behind it: it drops every
 * document it holds 300 seconds after the last access and keeps the index rows.
 * A presence check that asks the loaded documents therefore reports a fully
 * imported library as empty as soon as a session pauses — the failure mode this
 * file pins, because it costs a whole library of twins and nothing about it
 * looks wrong while the pack is warm.
 *
 * The pack mock below is Collection-SHAPED on purpose: `get`/`has`/`size` over
 * a Map, an `index` Map that eviction leaves alone and deletion empties, and a
 * `getDocuments()` that mints FRESH instances the way a real re-read does. A
 * plain-array stand-in would pass while the live pack failed.
 *
 * The last section pins the actor side's other half: a presence check READS.
 * Asked of a world with no shelf for the id's line, it answers null and mints
 * nothing — the shelf it would have opened on the way to reading it is the
 * pack a census left behind in a live world.
 */
import assert from "node:assert";
import { forgetImportedIndex, importedItemFor, importedActorFor, lineOf, bookOfCookbookId } from "../../scripts/importer/cookbook.mjs";
import { libraryPackLabel } from "../../scripts/lib/library.mjs";

let pass = 0;
const check = (label, cond) => {
  assert.ok(cond, label);
  pass++;
};

const MODULE_ID = "acks-extras";
const PACK = "world.acks-cookbook--item";

/**
 * One imported document: what the index reads off it, and nothing more.
 *
 * `collection` resolves to the pack exactly as a real document's does, so a
 * presence check written against the loaded documents runs here the way it runs
 * live — and fails here the way it failed live.
 */
const makeDoc = (id, name, generation) => ({
  id,
  name,
  pack: PACK,
  generation,
  flags: { [MODULE_ID]: { cookbook: { id: `def.class.${id}` } } },
  get collection() {
    return game.packs.get(this.pack);
  },
  getFlag(scope, key) {
    return this.flags?.[scope]?.[key] ?? null;
  },
});

/** A shelf that behaves like the real one: warm, cold, and emptied. */
class PackMock {
  constructor(ids) {
    this.collection = PACK;
    this.documentName = "Item";
    this.metadata = { packageType: "world", label: "ACKS Cookbook — Item", type: "Item" };
    this.index = new Map(ids.map((id) => [id, { _id: id }]));
    this.ids = ids;
    this.generation = 0;
    this.reads = 0;
    this.docs = new Map();
    this.#load();
  }

  #load() {
    this.generation++;
    for (const id of this.ids) this.docs.set(id, makeDoc(id, `Class ${id}`, this.generation));
  }

  get size() {
    return this.docs.size;
  }
  has(id) {
    return this.docs.has(id);
  }
  get(id) {
    return this.docs.get(id) ?? null;
  }
  async getDocuments() {
    this.reads++;
    this.#load();
    return [...this.docs.values()];
  }

  /** What the 300-second debounce does: drop the documents, keep the index. */
  evict() {
    this.docs.clear();
  }
  /** What a real delete does: the row goes with the document. */
  remove(id) {
    this.docs.delete(id);
    this.index.delete(id);
    this.ids = this.ids.filter((x) => x !== id);
  }
}

const pack = new PackMock(["alpha", "beta", "gamma"]);
const packs = [pack];
globalThis.game = {
  packs: {
    filter: (fn) => packs.filter(fn),
    get: (collection) => packs.find((p) => p.collection === collection) ?? null,
  },
  items: [],
};

const idOf = (id) => `def.class.${id}`;

/* --- warm --- */

forgetImportedIndex();
const warm = await importedItemFor(idOf("alpha"));
check("a warm shelf answers with the imported document", warm?.id === "alpha");
check("building the index read the shelf once", pack.reads === 1);

/* --- cold: evicted, not deleted --- */

pack.evict();
check("the eviction dropped the documents", pack.size === 0);
check("the eviction kept the index", pack.index.size === 3);

const cold = await Promise.all([idOf("alpha"), idOf("beta"), idOf("gamma")].map((id) => importedItemFor(id)));
check("an evicted document is still reported as imported", cold.every(Boolean));
check("each answer is the document asked for", cold.map((d) => d.id).join() === "alpha,beta,gamma");
check("the re-read restored the whole shelf in ONE read", pack.reads === 2);
check("the answers come from the re-read", cold.every((d) => d.generation === pack.generation));
check("not from the evicted instances the index was holding", cold[0] !== warm);

/* --- the cached index takes the new instance --- */

const again = await importedItemFor(idOf("alpha"));
check("a second ask needs no further read", pack.reads === 2);
check("and hands back the same live instance", again === cold[0]);

/* --- deleted --- */

pack.remove("beta");
check("a deleted document is reported as gone", (await importedItemFor(idOf("beta"))) === null);
check("its neighbours are untouched", (await importedItemFor(idOf("gamma")))?.id === "gamma");
check("reporting a deletion needs no shelf read", pack.reads === 2);

/* --- deleted while cold: the two states are not confused --- */

pack.evict();
pack.remove("gamma");
check("a document deleted while the shelf was cold is gone", (await importedItemFor(idOf("gamma"))) === null);
check("one still on the shelf survives the same eviction", (await importedItemFor(idOf("alpha")))?.id === "alpha");

/* --- a class template's part never answers for its definition --- */

// A part is a copy that kept the definition's claim, under a name carrying
// one class's specialty; whichever the shelf lists first, the index answers
// with the definition, or with nothing when only parts are held.
const shelfOf = (docs) => ({
  collection: PACK,
  documentName: "Item",
  metadata: { packageType: "world", label: "ACKS Cookbook — Item", type: "Item" },
  index: new Map(docs.map((d) => [d.id, { _id: d.id }])),
  has: (id) => docs.some((d) => d.id === id),
  get: (id) => docs.find((d) => d.id === id) ?? null,
  getDocuments: async () => docs,
});
const itemDoc = (id, name, flags) => ({
  id,
  name,
  pack: PACK,
  flags: { [MODULE_ID]: flags },
  getFlag(scope, key) {
    return this.flags?.[scope]?.[key] ?? null;
  },
});
const defId = "def.prof.invented";
const part = itemDoc("part", "Invented (a specialty)", { cookbook: { id: defId }, templatePart: { classKey: "someClass", kind: "ability" } });
const definition = itemDoc("definition", "Invented", { cookbook: { id: defId } });
packs.splice(0, packs.length, shelfOf([part, definition]));
forgetImportedIndex();
check("a part listed first does not answer for its definition", (await importedItemFor(defId))?.id === "definition");
packs.splice(0, packs.length, shelfOf([part]));
forgetImportedIndex();
check("a definition held only as a part is not imported", (await importedItemFor(defId)) === null);

/* --- the actor presence check reads: no shelf minted, the own shelf asked first --- */

// A shelf of actors on one line, asked through its index like the live one.
const actorShelf = (label, docs) => ({
  collection: `world.${label.toLowerCase().replace(/[^a-z]+/g, "-")}`,
  documentName: "Actor",
  metadata: { packageType: "world", label, type: "Actor" },
  index: new Map(docs.map((d) => [d.id, { _id: d.id }])),
  asked: 0,
  async getIndex() {
    this.asked++;
    return docs.map((d) => ({ _id: d.id, flags: d.flags }));
  },
  async getDocument(id) {
    return docs.find((d) => d.id === id) ?? null;
  },
});
const actorDoc = (id, cookbook) => ({ id, pack: null, flags: { [MODULE_ID]: { cookbook: { id: cookbook } } } });

// A Judge's book, so the own shelf is a LINED one and not the library's own.
const beastId = "cat.invented";
const ownLine = lineOf(bookOfCookbookId(beastId));
check("the id's book has a line of its own", typeof ownLine === "string" && ownLine.length > 0);
const ownLabel = libraryPackLabel("Actor", ownLine);
const otherLabel = libraryPackLabel("Actor", "Invented Line");

// What a write would reach: the pack minter, counted and refused.
let minted = 0;
globalThis.foundry = {
  documents: {
    collections: {
      CompendiumCollection: {
        createCompendium: async () => {
          minted++;
          throw new Error("a presence check reached the pack minter");
        },
      },
    },
  },
};
globalThis.ui = { notifications: { error() {} } };
game.user = { isGM: true };
game.i18n = { format: () => "" };
game.actors = [];
game.packs.find = (fn) => packs.find(fn) ?? undefined;

packs.splice(0, packs.length);
check("a world with no shelf answers null for an actor never imported", (await importedActorFor(beastId)) === null);
check("and holds exactly the packs it held: none minted", minted === 0 && packs.length === 0);

const elsewhere = actorShelf(otherLabel, [actorDoc("re-shelved", beastId)]);
packs.splice(0, packs.length, elsewhere);
check("an actor shelved under another line is still found", (await importedActorFor(beastId))?.id === "re-shelved");
check("with no shelf of its own line minted to look in first", minted === 0 && packs.length === 1 && packs[0] === elsewhere);

const own = actorShelf(ownLabel, [actorDoc("own", beastId)]);
const twin = actorShelf(otherLabel, [actorDoc("twin", beastId)]);
twin.asked = 0;
packs.splice(0, packs.length, twin, own);
check("the own shelf answers first, whatever order the world lists its packs in", (await importedActorFor(beastId))?.id === "own");
check("and the others are not asked once it has", own.asked === 1 && twin.asked === 0);
check("the shelves stayed as they were", minted === 0 && packs.length === 2);

delete globalThis.foundry;
delete globalThis.ui;
delete globalThis.game;
console.log(`test-imported-index: ${pass} checks passed.`);
