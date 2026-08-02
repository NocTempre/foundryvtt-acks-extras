/**
 * Table access — delegates to the acks-lib layered registry
 * (`globalThis.acksLib.tables`). This module ships NO tables of its own: book
 * tables are imported per world through acks-content extraction
 * (→ the `ruledata-import` contract → acks-lib at world priority). These thin
 * wrappers keep the ~14 rules call sites (getTable/getDoc/getThrowDef/
 * bracketRow) unchanged, so a table read is identical whether the data came
 * from an import, a premium catalog, or (future) a sample layer.
 *
 * Pure delegation, resolved at call time — acks-lib is `requires`d and sets
 * `globalThis.acksLib` at module evaluation, before any of these run.
 */
function reg() {
  const t = globalThis.acksLib?.tables;
  if (!t) throw new Error("acks-henchmen: acks-lib (>=0.7.0) is required but not active");
  return t;
}

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

/** True when a ruledata document is present in the registry. */
export function hasDoc(docId) {
  return !!globalThis.acksLib?.tables?.hasDoc(docId);
}

/**
 * Table lookup that returns `null` instead of throwing when the document or
 * table has not been imported yet. Callers that can degrade gracefully (a
 * candidate's age, appearance, occupation, or class-distribution roll) use
 * this so a market still rolls on partial coverage — as more of the book is
 * imported, candidates simply gain detail. Features that truly require a
 * table keep using getTable and surface the missing-tables notice.
 */
export function optTable(docId, tableId) {
  const t = globalThis.acksLib?.tables;
  if (!t?.hasDoc(docId)) return null;
  try {
    return t.getTable(docId, tableId);
  } catch {
    return null;
  }
}

/** Register a document directly (rarely needed; imports use ruledata-import). */
export function initTables(doc) {
  return reg().registerTable(doc);
}
