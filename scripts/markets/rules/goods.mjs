/**
 * Item-level facts the goods market reads off an item's own data: the markets
 * flag bag, the masterwork gate, the magic-item basis, and the cap verdict.
 * Pure module — plain item data in, plain answers out, so the catalog, the
 * purchase and import paths, and the tests all read an item the same way.
 */
import { MODULE_ID, ITEM_FLAG } from "../constants.mjs";
import { ITEM_FLAGS } from "../../equipment/constants.mjs";

/** The markets flag bag on plain item data ({magic, apparentValueGp, identified…}). */
export const marketsFlagOf = (itemData) => itemData?.flags?.[MODULE_ID]?.[ITEM_FLAG] ?? {};

/**
 * Masterwork gear is Judge-gated (RR §IV.6). Three readers, most specific
 * first: the markets flag's explicit override, the equipment sheet's
 * masterwork tier (any tier but "none"), then the item's name.
 */
export function isMasterwork(itemData) {
  const explicit = marketsFlagOf(itemData).masterwork;
  if (explicit != null) return !!explicit;
  const tier = itemData?.flags?.[MODULE_ID]?.[ITEM_FLAGS.MASTERWORK]?.tier;
  if (tier && tier !== "none") return true;
  return /masterwork/i.test(String(itemData?.name ?? ""));
}

/**
 * Whether an item trades as Tower magic stock, and the base cost its
 * availability band and price read (the flag's `baseCostGp`, else the item's
 * own cost). A mundane item reports a zero base.
 * @returns {{magic: boolean, baseGp: number}}
 */
export function magicBasisOf(itemData) {
  const flag = marketsFlagOf(itemData);
  if (!flag.magic) return { magic: false, baseGp: 0 };
  return { magic: true, baseGp: Number(flag.baseCostGp ?? itemData?.system?.cost ?? 0) };
}

/**
 * How a requested quantity stands against the room left: `ok` (fits), `waived`
 * (over, but the world does not enforce caps) or `exceeded` (over, enforced).
 * @param {{qty: number, remaining: number, enforce: boolean}} o
 * @returns {"ok"|"waived"|"exceeded"}
 */
export function capVerdict({ qty, remaining, enforce }) {
  if (qty <= remaining) return "ok";
  return enforce ? "exceeded" : "waived";
}
