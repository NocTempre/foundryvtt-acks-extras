/**
 * The Foundry-free half of opening a bundle: what its rows become on an actor.
 * Works on plain item data and returns data; `bundles.mjs` resolves the rows
 * and makes the writes.
 */
import { toNum as num } from "./util.mjs";
import { ITEM_TYPE } from "./vocab.mjs";
import { LIB_ID, STORAGE_KEY, quantityOf } from "./storage-logic.mjs";

/** The equipment feature's container pointer, under the same flag scope. */
const CONTAINED_IN = "containedIn";

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
