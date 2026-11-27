/**
 * A stand-in for one of the importer's shelves (a world compendium), faithful to
 * the parts of core's compendium collection the library's readers touch:
 *
 * - the startup index holds core fields only (`_id`, `name`, `type`); the first
 *   `getIndex()` rebuilds it with `CONFIG.Item.compendiumIndexFields`, and a
 *   field nobody declared stays absent;
 * - `getIndex(...)` records its arguments, so a test can say it was asked with none;
 * - `getDocuments(query)` answers in the SERVER's order (the reverse of the
 *   index's), takes `_id__in`, instantiates new documents, and sets only the ones
 *   it did not already hold;
 * - a row carries `img` when its document has one (core's Actor and Item index fields hold it), and the
 *   shelf answers `getUuid(id)`, which an instance's `uuid` equals; a row has no `uuid` of its own;
 * - `indexed` is true once the first `getIndex()` has run with every declared
 *   field (or when nothing beyond core fields is declared), as core's is;
 * - `size` counts held documents and `index.size` every row, which is how the
 *   library tells a shelf is cold.
 *
 * Every call is recorded on `calls`. Used by the suites that read the library.
 */
import { libraryPackLabel } from "../scripts/lib/library.mjs";

/** Core answers a server call on a later tick; so does the stand-in, so a load kicked and not awaited has not landed. */
const later = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The fields core's startup index holds: the document class's core index fields, nothing a module declared. */
const CORE_FIELDS = ["_id", "name", "type"];

const pathOf =(obj, path) => path.split(".").reduce((at, key) => at?.[key], obj);
const putPath = (obj, path, value) => {
  const keys = path.split(".");
  let at = obj;
  for (const key of keys.slice(0, -1)) at = at[key] ??= {};
  at[keys.at(-1)] = value;
};

/**
 * One server-side document: a stamped row when `mint` is set, else an unstamped one.
 * @param {string} id
 * @param {string} name
 * @param {string} type
 * @param {string|null} [mint] the cookbook id the importer would stamp
 * @param {object} [system]
 * @param {string|null} [img] the picture, which the core index fields carry
 */
export const sourceDoc = (id, name, type, mint = null, system = { marker: `body of ${id}` }, img = null) => ({
  _id: id,
  name,
  type,
  ...(img ? { img } : {}),
  flags: mint ? { "acks-extras": { cookbook: { id: mint } } } : {},
  system,
});

/**
 * Build a shelf. `docs` are the server's documents in index order; `held` names
 * the ids already instantiated; `failIndex` / `failLoad` make that call reject;
 * `extraIndex` is merged into every index row (a field another module declared).
 * @param {object} options
 * @param {string|null} [options.line] the line the shelf holds; the ACKS shelf has none
 * @param {object[]} options.docs
 * @param {string[]} [options.held]
 * @param {boolean} [options.visible]
 * @param {boolean} [options.failIndex]
 * @param {boolean} [options.failLoad]
 * @param {object} [options.extraIndex]
 * @param {string} [options.type] the document type; Item by default
 */
export function shelfMock({ line = null, docs, held = [], visible = true, failIndex = false, failLoad = false, extraIndex = {}, type = "Item" }) {
  const stored = new Map();
  const calls = { getIndex: [], getDocuments: [] };
  const instance = (d) => ({ id: d._id, name: d.name, type: d.type, ...(d.img ? { img: d.img } : {}), flags: structuredClone(d.flags), system: structuredClone(d.system), uuid: `Compendium.${d._id}` });
  const coreRow = (d) => ({ _id: d._id, name: d.name, type: d.type, ...(d.img ? { img: d.img } : {}) });
  let indexed = false;
  let indexedFields = new Set(CORE_FIELDS);
  const label = libraryPackLabel(type, line);
  const pack = {
    collection: `world.${label.replace(/\W+/g, "-")}`,
    documentName: type,
    visible,
    metadata: { packageType: "world", label },
    calls,
    /** Make the next index reads / loads reject (or stop rejecting): a shelf that fails after it has answered. */
    failIndex,
    failLoad,
    index: new Map(docs.map((d) => [d._id, coreRow(d)])),
    /** Core's `indexFields.isSubsetOf(#indexedFields)`: every field declared now is one the index was built with. */
    get indexed() {
      return (globalThis.CONFIG?.[type]?.compendiumIndexFields ?? []).every((field) => indexedFields.has(field));
    },
    getUuid: (id) => `Compendium.${id}`,
    has: (id) => stored.has(id),
    get: (id) => stored.get(id),
    get size() {
      return stored.size;
    },
    get contents() {
      return [...stored.values()];
    },
    /** Core's `Collection#clear` of a shelf the cache lifetime evicted: the documents go, the index stays whole. */
    evict() {
      stored.clear();
    },
    async getIndex(...args) {
      calls.getIndex.push(args);
      await later();
      if (pack.failIndex) throw new Error("index refused");
      if (!indexed) {
        const declared = globalThis.CONFIG?.[type]?.compendiumIndexFields ?? [];
        indexedFields = new Set([...CORE_FIELDS, ...declared]);
        for (const d of docs) {
          const row = coreRow(d);
          for (const field of declared) {
            const value = pathOf(d, field);
            if (value !== undefined) putPath(row, field, value);
          }
          Object.assign(row, extraIndex);
          pack.index.set(d._id, row);
        }
        indexed = true;
      }
      return pack.index;
    },
    async getDocuments(query) {
      calls.getDocuments.push(query);
      await later();
      if (pack.failLoad) throw new Error("load refused");
      const ids = query?._id__in ? new Set(query._id__in) : null;
      const found = docs.filter((d) => !ids || ids.has(d._id)).reverse().map(instance);
      for (const doc of found) if (!stored.has(doc.id)) stored.set(doc.id, doc);
      return found;
    },
  };
  for (const id of held) stored.set(id, instance(docs.find((d) => d._id === id)));
  return pack;
}
