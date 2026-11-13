/* global foundry */
/**
 * Core patch: a compendium read that names no document costs no server read.
 *
 * Before core writes or deletes compendium documents it loads the targets the
 * pack does not already hold (`ClientDatabaseBackend#loadCompendiumDocuments`),
 * and it asks with `getDocuments({_id__in: ids})` even when it holds them all
 * and the list is empty. The server answers every compendium query by scanning
 * the whole shelf, so each write to a large pack pays a full scan for a list
 * core already knows is empty, twice per update. The wrapper answers a query
 * whose only term is an empty `_id__in` with no documents, which is what the
 * scan returns; every other query reaches core unchanged. It holds nothing, so
 * it never answers for a document that has since been deleted. The only owner
 * of the wrapped method.
 */
import { MODULE_ID } from "../constants.mjs";

/** The wrapped method's path, as libWrapper takes it. */
const TARGET = "foundry.documents.collections.CompendiumCollection.prototype.getDocuments";

/** Whether a `getDocuments` query can match nothing: its one term is an empty `_id__in`. */
export function matchesNothing(query) {
  if (!query || typeof query !== "object") return false;
  const keys = Object.keys(query);
  return keys.length === 1 && keys[0] === "_id__in" && Array.isArray(query._id__in) && query._id__in.length === 0;
}

/** MIXED form: an empty id list resolves to no documents; anything else is core's. */
function onGetDocuments(wrapped, query = {}, ...rest) {
  return matchesNothing(query) ? Promise.resolve([]) : wrapped(query, ...rest);
}

/**
 * Install at `init`. Unconditional and settingless: the query it answers
 * matches nothing under any pack or setting.
 */
export function installCompendiumEmptyLoadPatch() {
  const proto = foundry?.documents?.collections?.CompendiumCollection?.prototype;
  if (typeof proto?.getDocuments !== "function") {
    console.warn(`${MODULE_ID} | no CompendiumCollection#getDocuments to wrap; an empty load still reaches the server.`);
    return;
  }
  if (globalThis.libWrapper?.register) {
    globalThis.libWrapper.register(MODULE_ID, TARGET, onGetDocuments, "MIXED");
  } else {
    const original = proto.getDocuments;
    proto.getDocuments = function (...args) {
      return onGetDocuments.call(this, (...a) => original.apply(this, a), ...args);
    };
  }
}
