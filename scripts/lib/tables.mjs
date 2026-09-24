/**
 * Layered rules-table registry (see docs/lib/API.md; adopted by the table
 * extraction program — ruling in acks-module-template docs/DECISIONS.md).
 * Pure module: no Foundry imports; Node tooling and tests import it directly.
 *
 * Documents are plain JSON objects carrying `id` (the henchmen ruledata
 * shape: `{ id, source, tables: {…}, throws?: {…} }`). Each id holds at most
 * one document PER PRIORITY LAYER; reads resolve the highest layer present:
 *
 *   0  SAMPLE   — module-shipped automation config, never a book value
 *                 (henchmen's `throws` and its partial `rarity`)
 *   10 CATALOG  — premium/companion content module
 *   20 WORLD    — per-world imported tables (importer import via the
 *                 `ruledata-import` service; persisted by its provider)
 *   30 OVERRIDE — GM tweaks parsed from world documents (RollTables /
 *                 journals); usually a PARTIAL doc carrying only the
 *                 tweaked tables
 *
 * Re-registering at the same layer replaces that layer (idempotent
 * re-import); unregistering a layer falls back to the next-highest.
 *
 * Reads LAYER PER TABLE: getDoc merges `tables`/`throws` maps ascending by
 * priority (higher layers win per key; scalar fields come from the highest
 * layer that defines them), so a partial override never hides the rest of
 * the world doc beneath it. Full-doc layers behave exactly as before.
 */

export const PRIORITY = Object.freeze({ SAMPLE: 0, CATALOG: 10, WORLD: 20, OVERRIDE: 30 });

/** docId → Map<priority, doc> */
const _layers = new Map();

/** Register one parsed ruledata document (must carry `id`). */
export function registerTable(doc, { priority = PRIORITY.SAMPLE, source } = {}) {
  if (!doc?.id) throw new Error("registerTable: document must carry `id`");
  let layers = _layers.get(doc.id);
  if (!layers) _layers.set(doc.id, (layers = new Map()));
  layers.set(priority, source ? { ...doc, _registeredBy: source } : doc);
}

/** Drop-in alias for the historical per-module registry call. */
export function initTables(doc) {
  registerTable(doc);
}

/** Remove one layer of a document (or every layer when no priority given). */
export function unregisterTable(docId, { priority } = {}) {
  const layers = _layers.get(docId);
  if (!layers) return false;
  if (priority == null) return _layers.delete(docId);
  const had = layers.delete(priority);
  if (!layers.size) _layers.delete(docId);
  return had;
}

/** Remove all registered ruledata (tests). */
export function resetTables() {
  _layers.clear();
  _expected.clear();
}

/* ------------------------- expectations ------------------------- */
/** docId → Set<tableId> that consumer modules declare they will read. */
const _expected = new Map();

/**
 * Declare tables a consumer expects a document to carry. Import/materialize
 * UX uses this to name what is missing and to generate EMPTY placeholder
 * tables (first of their kind) that a GM can fill or replace by drag-drop.
 */
export function expectTables(docId, tableIds = []) {
  if (!docId) return;
  let set = _expected.get(docId);
  if (!set) _expected.set(docId, (set = new Set()));
  for (const id of tableIds) set.add(id);
}

/** Everything declared via expectTables: [{docId, tableIds}]. */
export function expectedTables() {
  return [..._expected.entries()].map(([docId, set]) => ({ docId, tableIds: [...set] }));
}

/**
 * Which of the documents a feature reads are NOT fully supplied: one entry per
 * incomplete document, `{docId, expected, present, missing}` (table ids).
 *
 * Registration of an ID is not presence of its tables, so a missing-tables
 * notice asks THIS and never `hasDoc`: a module's own automation layer claims
 * an id while supplying none of the tables consumers declared — henchmen
 * registers a `rarity` doc holding one inferred table — and a doc-presence
 * check reads that as imported forever.
 *
 * A document nothing declared through `expectTables` can only be judged on its
 * id, and is reported with empty table lists when no layer holds it.
 */
export function missingCoverage(docIds = []) {
  const out = [];
  for (const docId of docIds) {
    const expected = [...(_expected.get(docId) ?? [])];
    if (!expected.length) {
      if (!hasDoc(docId)) out.push({ docId, expected, present: [], missing: [] });
      continue;
    }
    let tables = {};
    try {
      tables = getDoc(docId).tables ?? {};
    } catch {
      tables = {}; // unregistered: every expected table is missing
    }
    const present = expected.filter((id) => tables[id] != null);
    if (present.length === expected.length) continue;
    out.push({ docId, expected, present, missing: expected.filter((id) => tables[id] == null) });
  }
  return out;
}

/** @returns {boolean} whether any layer of `docId` is registered */
export function hasDoc(docId) {
  return _layers.has(docId);
}

/** Every registered layer, for missing-tables UX and diagnostics. */
export function docInfo() {
  const out = [];
  for (const [id, layers] of _layers)
    for (const [priority, doc] of layers)
      out.push({ id, priority, source: doc._registeredBy ?? doc.source?.book ?? null });
  return out.sort((a, b) => a.id.localeCompare(b.id) || a.priority - b.priority);
}

/** @returns {object} the ruledata document, layered per table (see header) */
export function getDoc(docId) {
  const layers = _layers.get(docId);
  if (!layers?.size) throw new Error(`getDoc: ruledata "${docId}" not registered`);
  const priorities = [...layers.keys()].sort((a, b) => a - b);
  if (priorities.length === 1) return layers.get(priorities[0]);
  const out = { tables: {}, throws: {} };
  for (const p of priorities) {
    const doc = layers.get(p);
    for (const [k, v] of Object.entries(doc)) {
      if (k === "tables" || k === "throws") Object.assign(out[k], v ?? {});
      else out[k] = v;
    }
  }
  if (!Object.keys(out.throws).length) delete out.throws;
  return out;
}

/**
 * One layer of a document exactly as registered, or null; never merged. An
 * import that merges into what it imported before reads its own layer this
 * way: `getDoc` would carry a GM's override, or a shipped sample, down into the
 * import, where clearing the override or updating the sample no longer shows.
 */
export function getLayer(docId, priority) {
  return _layers.get(docId)?.get(priority) ?? null;
}

/** @returns {object} one table of a ruledata document */
export function getTable(docId, tableId) {
  const doc = getDoc(docId);
  const table = doc.tables?.[tableId];
  if (!table) throw new Error(`getTable: no table "${tableId}" in ruledata "${docId}"`);
  return table;
}

/** @returns {object} one throw definition of a ruledata document */
export function getThrowDef(docId, throwId) {
  const doc = getDoc(docId);
  const def = doc.throws?.[throwId];
  if (!def) throw new Error(`getThrowDef: no throw "${throwId}" in ruledata "${docId}"`);
  return def;
}

/**
 * Find the row of a bracket table whose [min, max] contains `value`.
 * Rows with a null/undefined max are open-ended.
 */
export function bracketRow(rows, value, minKey = "min", maxKey = "max") {
  return rows.find((r) => value >= (r[minKey] ?? -Infinity) && (r[maxKey] == null || value <= r[maxKey]));
}

/* ------------------------- where a table was read ------------------------- */

/**
 * The page a table was read from, as its importer recorded it in the
 * document's `cites` (`{tableId: "RR p. 505"}`), else the document's own
 * `source.pages`. Answers for the layer a read takes the table from, and null
 * when that layer is a Judge's override or a module's sample: neither holds a
 * page's rows, so neither has a page to point at.
 */
export function citeOf(docId, tableId) {
  const layers = _layers.get(docId);
  if (!layers?.size) return null;
  const top = [...layers.keys()].sort((a, b) => b - a).find((p) => layers.get(p)?.tables?.[tableId] != null);
  if (top == null || top === PRIORITY.OVERRIDE || top === PRIORITY.SAMPLE) return null;
  const doc = layers.get(top);
  return doc.cites?.[tableId] ?? doc.source?.pages ?? null;
}

/* ------------------------- a printed quantity ------------------------- */

/**
 * A printed quantity in its one stored shape, `{value, atLeast, per}`, from
 * either form a table holds it in: a bare number, or that object. `atLeast`
 * marks a floor, met by the value or anything more; `per` names the unit the
 * value is counted out in, once per unit. Null for anything holding no
 * number, so a reader refuses instead of reading 0.
 *
 * @returns {{value: number, atLeast: boolean, per: string|null}|null}
 */
export function quantity(x) {
  if (typeof x === "number") return Number.isFinite(x) ? { value: x, atLeast: false, per: null } : null;
  if (x == null || typeof x !== "object" || x.value == null || x.value === "") return null;
  const value = Number(x.value);
  if (!Number.isFinite(value)) return null;
  const per = typeof x.per === "string" && x.per.trim() ? x.per.trim() : null;
  return { value, atLeast: x.atLeast === true, per };
}

/**
 * Whether `amount` meets a quantity read as a threshold: its value or more
 * when it is a floor, exactly its value otherwise. False when either side
 * holds no number.
 */
export function meetsQuantity(q, amount) {
  const n = quantity(q);
  const a = typeof amount === "number" ? amount : Number.NaN;
  if (!n || !Number.isFinite(a)) return false;
  return n.atLeast ? a >= n.value : a === n.value;
}

/**
 * A quantity counted out: its value once per unit of `count` when it names a
 * `per` unit, its value alone when it does not. Null when it holds no number,
 * or names a unit and `count` is not a number.
 */
export function scaleQuantity(q, count = 1) {
  const n = quantity(q);
  if (!n) return null;
  if (!n.per) return n.value;
  return typeof count === "number" && Number.isFinite(count) ? n.value * count : null;
}
