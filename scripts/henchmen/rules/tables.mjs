/**
 * Table access: thin wrappers over the lib subsystem's layered registry
 * (`globalThis.acksExtras.lib.tables`). This feature ships NO tables of its
 * own; book tables are imported per world through the importer (the
 * `ruledata-import` contract, into the registry at world priority). Pure
 * delegation, resolved at call time.
 */
const reg = () => globalThis.acksExtras.lib.tables;

/** @returns {object} the whole ruledata document (highest registry layer) */
export function getDoc(docId) {
  return reg().getDoc(docId);
}

/** @returns {object} one table of a ruledata document */
export function getTable(docId, tableId) {
  return reg().getTable(docId, tableId);
}

/** @returns {object} one throw definition of a ruledata document */
export function getThrowDef(docId, throwId) {
  return reg().getThrowDef(docId, throwId);
}

/** Bracket-table row lookup (null max = open-ended). */
export function bracketRow(rows, value, minKey = "min", maxKey = "max") {
  return reg().bracketRow(rows, value, minKey, maxKey);
}

/** The one die a band table's own edges reach (lib `bandDie`), or null where they reach none. */
export function bandDie(rows, minKey = "min", maxKey = "max") {
  return reg().bandDie(rows, minKey, maxKey);
}

/** True when a ruledata document is present in the registry. */
export function hasDoc(docId) {
  return !!globalThis.acksExtras?.lib?.tables?.hasDoc(docId);
}

/**
 * Table lookup that returns `null` instead of throwing when the document or
 * table has not been imported yet. For callers that degrade gracefully; a
 * feature that requires the table uses `getTable` and surfaces the
 * missing-tables notice.
 */
export function optTable(docId, tableId) {
  const t = globalThis.acksExtras?.lib?.tables;
  if (!t?.hasDoc(docId)) return null;
  try {
    return t.getTable(docId, tableId);
  } catch {
    return null;
  }
}

/** The page a table was read from (lib `citeOf`), or null where none is recorded or no registry is attached. */
export function optCite(docId, tableId) {
  return globalThis.acksExtras?.lib?.tables?.citeOf?.(docId, tableId) ?? null;
}

/**
 * Where a table's figures come from right now: `override` when a Judge's
 * layer holds the table, `imported` with the page it was read from, else
 * `missing`. `citeOf` answers null for both an override and an absent table,
 * so the layer is asked first.
 * @returns {{state: "override"|"imported"|"missing", cite: string|null}}
 */
export function optOrigin(docId, tableId) {
  const t = globalThis.acksExtras?.lib?.tables;
  if (!optTable(docId, tableId)) return { state: "missing", cite: null };
  if (t?.PRIORITY && t.getLayer?.(docId, t.PRIORITY.OVERRIDE)?.tables?.[tableId] != null) return { state: "override", cite: null };
  return { state: "imported", cite: t?.citeOf?.(docId, tableId) ?? null };
}

/** Register a document directly (rarely needed; imports use ruledata-import). */
export function initTables(doc) {
  return reg().registerTable(doc);
}
