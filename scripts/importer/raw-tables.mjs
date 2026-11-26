/**
 * Which tables of an imported document are the importer's page reads, and
 * which tables the engine reads from them. A binding's `PRODUCES` maps each
 * engine table to the raw table(s) it is assembled from, so the raw tables are
 * that map's values and the answer for one of them is the keys that name it.
 * The Ruledata Browser asks through `acksExtras.importer.rawTablesOf`, so it
 * lists a page read apart and refuses to edit what nothing reads.
 *
 * Only the bindings listed in `BINDINGS` are answered for; any other document
 * has no page reads marked.
 */
import { PRODUCES as TREASURE_PRODUCES } from "./treasure-binding.mjs";
import { PRODUCES as MAGIC_ITEM_PRODUCES } from "./magic-item-binding.mjs";

/** The bindings whose page reads the browser sets apart, each a `PRODUCES` map (`{docId: {engineTable: rawTable|rawTable[]|null}}`). */
const BINDINGS = Object.freeze([TREASURE_PRODUCES, MAGIC_ITEM_PRODUCES]);

/** Append `engine` to the list `raw` keeps in `out`, once. */
function addTo(out, raw, engine) {
  const list = (out[raw] ??= []);
  if (!list.includes(engine)) list.push(engine);
}

/**
 * The page reads of one document in a `PRODUCES` map: `{rawTable: [engineTable, …]}`,
 * each engine table in the map's order. A source of null names no raw table,
 * and a table that is itself an engine table of the document is never a page read.
 *
 * @param {Record<string, Record<string, string|string[]|null>>} produces
 * @param {string} docId
 * @returns {Record<string, string[]>}
 */
export function rawTablesFrom(produces, docId) {
  const map = produces?.[docId];
  if (!map) return {};
  const out = {};
  for (const [engine, from] of Object.entries(map)) {
    for (const raw of [].concat(from ?? [])) {
      if (typeof raw !== "string" || raw in map) continue;
      addTo(out, raw, engine);
    }
  }
  return out;
}

/**
 * The page reads of one imported document, `{rawTable: [engineTable, …]}`; empty
 * for a document no binding here assembles.
 * @param {string} docId
 * @returns {Record<string, string[]>}
 */
export function rawTablesOf(docId) {
  const out = {};
  for (const produces of BINDINGS) {
    for (const [raw, engines] of Object.entries(rawTablesFrom(produces, docId))) {
      for (const engine of engines) addTo(out, raw, engine);
    }
  }
  return out;
}
