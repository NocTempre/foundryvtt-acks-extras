/**
 * Layered rules-table registry (FAMILY.md §3a, pulled forward by the table
 * extraction program — see acks-module-template docs/CONTENT-EXTRACTION.md).
 * Pure module: no Foundry imports; Node tooling and tests import it directly.
 *
 * Documents are plain JSON objects carrying `id` (the henchmen ruledata
 * shape: `{ id, source, tables: {…}, throws?: {…} }`). Each id holds at most
 * one document PER PRIORITY LAYER; reads resolve the highest layer present:
 *
 *   0  SAMPLE   — module-shipped default (none ship today: extraction-program
 *                 ruling 1 — no book values, no fallback samples)
 *   10 CATALOG  — premium/companion content module
 *   20 WORLD    — per-world imported tables (acks-content import via the
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
