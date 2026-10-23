/**
 * A rebuilt Item comes back under the id it stood under.
 *
 * A character's bound class, a journal link and a template part all point at
 * an Item by uuid, so a rebuild that mints a new id leaves every one of them
 * dangling. `itemIds` settles the id each imported Item is written under; the
 * first half pins its choice row by row. The second half drives the shelf
 * rebuild over a mocked shelf, where `deleteImported` records what each
 * document stood under and the refill writes back through `createDoc` and
 * `createDocs` — the record, the funnel and the write option together, which
 * no check on `itemIds` alone reaches.
 *
 * The shelf mock rejects a whole write that repeats an id it holds, as the
 * server does, so a guard that let one through fails here the way it would
 * fail live.
 */
import assert from "node:assert";
import { itemIds, createDoc, createDocs, cookbookReimportShelf } from "../../scripts/importer/cookbook.mjs";
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

const packs = [shelf];
globalThis.game = {
  packs: {
    filter: (fn) => packs.filter(fn),
    find: (fn) => packs.find(fn),
    get: (collection) => packs.find((p) => p.collection === collection) ?? null,
  },
  items: [],
  actors: [],
  collections: new Map([["Item", new Map()]]),
  user: { isGM: true },
  i18n: { format: () => "", localize: () => "" },
};
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.foundry = {
  utils: { getDocumentClass: () => ItemMock, escapeHTML: (x) => x },
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

// What a world imported before ids were kept: Items under ids core minted.
shelf.docs.clear();
shelf.index.clear();
for (const [id, _id] of [["def.class.alpha", "legacyAlpha0001"], ["def.class.beta", "legacyBeta00001"]]) {
  const doc = makeDoc(row(id), _id);
  shelf.docs.set(_id, doc);
  shelf.index.set(_id, { _id });
}
// The refill writes one class alone and one in a batch: both routes must take
// the record. The module's namespace object is the one its api is read from.
const namespace = globalThis.acksExtras;
const importerWas = namespace.importer;
namespace.importer = {
  importClasses: async () => [await createDoc(ItemMock, row("def.class.alpha")), ...(await createDocs(ItemMock, [row("def.class.beta")]))],
};
const uuidOf = (id) => [...shelf.docs.values()].find((d) => d.getFlag(MODULE_ID, "cookbook")?.id === id)?.uuid ?? null;
const before = { alpha: uuidOf("def.class.alpha"), beta: uuidOf("def.class.beta") };
const rebuilt = await cookbookReimportShelf("Classes");
check("the shelf rebuild deleted both classes", rebuilt?.removed === 2);
check("a class written alone comes back under the uuid it had", uuidOf("def.class.alpha") === before.alpha);
check("a class written in a batch comes back under the uuid it had", uuidOf("def.class.beta") === before.beta);
check("each was written again, not left standing", rebuilt.refill.every((d) => d && shelf.docs.get(d.id) === d));
const again = await cookbookReimportShelf("Classes");
check("a second rebuild keeps them too", again?.removed === 2 && uuidOf("def.class.alpha") === before.alpha && uuidOf("def.class.beta") === before.beta);

namespace.importer = importerWas;
delete globalThis.foundry;
delete globalThis.ui;
delete globalThis.game;
console.log(`test-item-ids: ${pass} checks passed.`);
