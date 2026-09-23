/**
 * The Foundry-free half of opening a bundle: what its rows become on an actor.
 * Works on plain item data and returns data; `bundles.mjs` resolves the rows
 * and makes the writes.
 */
import { toNum as num } from "./util.mjs";
import { ITEM_TYPE } from "./vocab.mjs";
import { LIB_ID, STORAGE_KEY, UNPACKED_FROM, planStackMerge, quantityOf } from "./storage-logic.mjs";

/** The equipment feature's container pointer, under the same flag scope. */
const CONTAINED_IN = "containedIn";

/** The journal an embedded bundle carries between its merge write and its creates. */
export const UNPACK_JOURNAL = "unpack";

/**
 * The rows a core bundle lists (`system.itemList`), each counted at least once.
 * @returns {{uuid: string, name: string, type: string, count: number}[]}
 */
export function bundleRows(bundle) {
  const list = bundle?.system?.itemList;
  if (!Array.isArray(list)) return [];
  return list.map((row) => ({
    uuid: String(row?.uuid ?? ""),
    name: String(row?.name ?? ""),
    type: String(row?.type ?? ""),
    count: Math.max(1, Math.floor(num(row?.quantity, 1))),
  }));
}

/**
 * A copy of `sourceData` ready to create on an actor: no id, folder, sort or
 * ownership of its own, unequipped, loose, and attributed to nobody.
 */
export function arrivalOf(sourceData) {
  const copy = structuredClone(sourceData);
  delete copy._id;
  delete copy.folder;
  delete copy.sort;
  delete copy.ownership;
  const sys = copy.system;
  if (sys && "equipped" in sys) sys.equipped = false;
  if (sys && "quantitybank" in sys) sys.quantitybank = 0;
  if (sys && "totalvalue" in sys) sys.totalvalue = 0;
  if (copy.flags?.[LIB_ID]) {
    copy.flags[LIB_ID] = { ...copy.flags[LIB_ID] };
    delete copy.flags[LIB_ID][CONTAINED_IN];
    delete copy.flags[LIB_ID][STORAGE_KEY];
    delete copy.flags[LIB_ID][UNPACKED_FROM];
  }
  return copy;
}

/**
 * What one row delivers, counted as core's own bundle drop counts it: coin
 * arrives as `count` coins, a stackable as one stack of `count` times its own
 * size (an empty source stack counts as one), anything else as `count` copies.
 * @returns {object[]} plain item data, one entry per document to deliver
 */
export function goodsForRow(sourceData, count) {
  const n = Math.max(1, Math.floor(num(count, 1)));
  const one = arrivalOf(sourceData);
  if (one.type === ITEM_TYPE.money) {
    one.system = { ...one.system, quantity: n };
    return [one];
  }
  const q = quantityOf(one);
  if (q) {
    const size = Math.max(1, q.value) * n;
    if (q.path === "system.quantity") one.system.quantity = size;
    else one.system.quantity = { ...one.system.quantity, value: size };
    return [one];
  }
  return Array.from({ length: n }, (_, i) => (i ? structuredClone(one) : one));
}

/** `data` with the bundle it came out of stamped on it. */
function stampFrom(data, bundleId) {
  const copy = structuredClone(data);
  copy.flags = { ...(copy.flags ?? {}), [LIB_ID]: { ...(copy.flags?.[LIB_ID] ?? {}), [UNPACKED_FROM]: bundleId } };
  return copy;
}

/**
 * How far an embedded bundle's unpack got, read from the bundle and the items
 * beside it: `delete` once a copy stamped with its id is on the actor (only the
 * bundle is left to remove), `create` once its journal says the merge landed
 * (the copies are still owed), `fresh` when nothing has been written.
 */
export function unpackStage(bundle, actorItems) {
  const id = bundle?._id ?? bundle?.id;
  if ((actorItems ?? []).some((i) => i?.flags?.[LIB_ID]?.[UNPACKED_FROM] === id)) return "delete";
  if (bundle?.flags?.[LIB_ID]?.[UNPACK_JOURNAL]?.merged) return "create";
  return "fresh";
}

/**
 * The writes that open a bundle embedded on an actor. `updates` folds the
 * stackables into the stacks the actor already carries and writes the
 * bundle's journal in the same call; `creates` are the copies, each stamped
 * with the bundle's id. The caller writes `updates`, then `creates`, then
 * deletes the bundle.
 * @returns {{updates: object[], creates: object[]}}
 */
export function planEmbeddedUnpack(bundleId, goods, actorItems) {
  const { creates, targetUpdates } = planStackMerge(goods, actorItems);
  const stamped = creates.map((c) => stampFrom(c, bundleId));
  const journal = { _id: bundleId, [`flags.${LIB_ID}.${UNPACK_JOURNAL}`]: { merged: true, creates: stamped } };
  return { updates: [...targetUpdates, journal], creates: stamped };
}

/**
 * Whether a bundle has the shape a market purchase gave one before purchases
 * arrived as goods: one row, named for that row and its count.
 */
export function isPurchaseBundle(bundle) {
  const rows = bundleRows(bundle);
  if (rows.length !== 1) return false;
  const name = String(bundle?.name ?? "");
  return !!rows[0].name && name.startsWith(rows[0].name) && name.endsWith(`×${rows[0].count}`);
}
