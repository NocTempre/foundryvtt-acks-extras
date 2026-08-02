/**
 * The `ruledata-import` provider (acks-lib contract v1, see acks-lib
 * docs/API.md): persists imported rules-table documents as world data and
 * mirrors them into `acksLib.tables` on every client. Consumers (content
 * import flows) call the contract; sibling modules read the registry —
 * nobody names this module. No table values ship here (extraction-program
 * ruling 1): everything in the store arrived via a GM's own-book import.
 */
import { MODULE_ID } from "./constants.mjs";

const SETTING = "importedTables";

const lib = () => globalThis.acksExtras?.lib;

/** Layers this client has mirrored into the registry, as "docId:priority". */
let _registered = new Set();

/** Mirror the persisted store into the lib registry; drop vanished layers. */
function syncRegistry(store) {
  const next = new Set();
  for (const entry of Object.values(store ?? {})) {
    if (!entry?.doc?.id) continue;
    try {
      lib().tables.registerTable(entry.doc, { priority: entry.priority, source: entry.source ?? MODULE_ID });
      next.add(`${entry.doc.id}:${entry.priority}`);
    } catch (err) {
      console.error(`${MODULE_ID} | failed to register persisted table "${entry.doc.id}"`, err);
    }
  }
  for (const key of _registered) {
    if (next.has(key)) continue;
    const cut = key.lastIndexOf(":");
    lib().tables.unregisterTable(key.slice(0, cut), { priority: Number(key.slice(cut + 1)) });
  }
  _registered = next;
  return next.size;
}

function readStore() {
  return foundry.utils.deepClone(game.settings.get(MODULE_ID, SETTING) ?? {});
}

/** Register the world-scope store; onChange keeps every client mirrored. */
export function registerStoreSetting() {
  game.settings.register(MODULE_ID, SETTING, {
    scope: "world",
    config: false,
    type: Object,
    default: {},
    onChange: (value) => syncRegistry(value),
  });
}

/** Mirror whatever is already persisted (call once at init). */
export function registerPersisted() {
  return syncRegistry(readStore());
}

/** The contract implementation. Writes are GM-only; persistence triggers
 * the setting's onChange, which is what actually updates every registry. */
export const ruledataImport = {
  async importDoc(doc, { priority, source } = {}) {
    if (!game.user.isGM) throw new Error(`${MODULE_ID}: only a GM may import rules tables`);
    if (!doc?.id) throw new Error(`${MODULE_ID}: imported document must carry an id`);
    const p = priority ?? lib().tables.PRIORITY.WORLD;
    const store = readStore();
    store[`${doc.id}:${p}`] = { doc, priority: p, source: source ?? null, importedAt: Date.now() };
    await game.settings.set(MODULE_ID, SETTING, store);
    // Verify the write actually landed in world data. A world DB that loses
    // this write would silently un-import every table on the next reload —
    // fail loudly here instead (seen in the wild 2026-07-19).
    const persisted = game.settings.get(MODULE_ID, SETTING);
    if (!persisted?.[`${doc.id}:${p}`]) {
      ui.notifications.error(`acks-extras | "${doc.id}" did not persist to world data — check the world's storage and re-import.`);
      throw new Error(`acks-location: persist verification failed for "${doc.id}"`);
    }
    // Imported tables become FOUNDRY documents too (prefilled RollTables /
    // JSON journal pages) — the audit-and-tweak surface. Best-effort.
    try {
      const { materializeAll } = await import("./table-docs.mjs");
      await materializeAll();
    } catch (err) {
      console.warn(`${MODULE_ID} | auto-materialize after import failed`, err);
    }
  },

  /** Contract v1.1 (additive): materialize every imported table as a
   *  Foundry document; consumers (cookbook macros) call this by service. */
  async materializeDocs() {
    if (!game.user.isGM) throw new Error(`${MODULE_ID}: GM only`);
    const { materializeAll } = await import("./table-docs.mjs");
    return materializeAll();
  },

  async removeDoc(docId, { priority } = {}) {
    if (!game.user.isGM) throw new Error(`${MODULE_ID}: only a GM may remove rules tables`);
    const p = priority ?? lib().tables.PRIORITY.WORLD;
    const store = readStore();
    delete store[`${docId}:${p}`];
    await game.settings.set(MODULE_ID, SETTING, store);
  },

  listDocs() {
    return Object.values(readStore())
      .map((e) => ({ id: e.doc?.id, priority: e.priority, source: e.source }))
      .sort((a, b) => (a.id ?? "").localeCompare(b.id ?? "") || a.priority - b.priority);
  },

  /**
   * Contract v1.2 (additive): re-mirror the persisted WORLD store into the
   * in-memory registry, and report what is present. The store is already
   * mirrored at `init`, but a consumer can call this to recover when the
   * registry has lost its tables after a reload / GM change / module update —
   * the persisted world data is the source of truth, and this reloads it
   * WITHOUT needing the original book. NOT GM-gated: a player left without a GM
   * can restore their own registry from the world data everyone shares.
   * @returns {{layers:number, docs:string[]}}
   */
  reload() {
    const layers = registerPersisted();
    const docs = [...new Set(Object.values(readStore()).map((e) => e?.doc?.id).filter(Boolean))];
    return { layers, docs };
  },
};

/* ------------------------- override layer (priority 30) ------------------------- */
/**
 * GM tweaks live as PARTIAL docs at OVERRIDE priority in the same store —
 * one entry per docId holding only the overridden tables (the registry
 * layers per table, so the world import shows through underneath).
 * `_meta[tableKey]` records where each override came from (source uuid).
 */

const overrideKey = (docId) => `${docId}:${lib().tables.PRIORITY.OVERRIDE}`;

export function overrideMeta(docId, tableKey) {
  const entry = readStore()[overrideKey(docId)];
  return entry?.doc?._meta?.[tableKey] ?? null;
}

export function hasOverride(docId, tableKey) {
  const entry = readStore()[overrideKey(docId)];
  return !!(entry?.doc?.tables && tableKey in entry.doc.tables);
}

/** Set (or replace) one table's override. tableKey = tableId. */
export async function setOverride(docId, tableId, data, meta = {}) {
  if (!game.user.isGM) throw new Error(`${MODULE_ID}: GM only`);
  const P = lib().tables.PRIORITY.OVERRIDE;
  const store = readStore();
  const entry = store[overrideKey(docId)] ?? { doc: { id: docId, tables: {}, _meta: {} }, priority: P, source: "override" };
  entry.doc.tables = { ...(entry.doc.tables ?? {}), [tableId]: data };
  entry.doc._meta = { ...(entry.doc._meta ?? {}), [tableId]: { ...meta, time: Date.now() } };
  store[overrideKey(docId)] = entry;
  await game.settings.set(MODULE_ID, SETTING, store);
}

/** Remove one table's override; drops the layer when nothing is left. */
export async function clearOverride(docId, tableId) {
  if (!game.user.isGM) throw new Error(`${MODULE_ID}: GM only`);
  const store = readStore();
  const entry = store[overrideKey(docId)];
  if (!entry?.doc) return;
  delete entry.doc.tables?.[tableId];
  delete entry.doc._meta?.[tableId];
  if (!Object.keys(entry.doc.tables ?? {}).length) delete store[overrideKey(docId)];
  await game.settings.set(MODULE_ID, SETTING, store);
}
