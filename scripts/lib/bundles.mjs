/* global foundry, game */
/**
 * Goods handed to an actor, and bundles opened onto one. No actor sheet lists
 * an embedded bundle, so nothing here embeds one: a dropped bundle arrives as
 * the goods it names, and a purchase arrives as goods. A stackable folds into
 * an identical stack the actor already carries (`stackSignature`).
 */
import { ITEM_TYPE } from "./vocab.mjs";
import { planStackMerge } from "./storage-logic.mjs";
import { libraryItems, whenReady } from "./library.mjs";
import { bundleRows, goodsForRow } from "./bundles-logic.mjs";

/**
 * Create `goods` (arrival-shaped plain item data) on `actor`, folding each
 * stackable into an identical stack it already carries.
 * @returns {Promise<{created: Item[], updated: Item[]}>}
 */
export async function deliverItems(actor, goods) {
  const { creates, targetUpdates } = planStackMerge(goods, actor.items.map((i) => i.toObject()));
  const updated = targetUpdates.length ? await actor.updateEmbeddedDocuments("Item", targetUpdates) : [];
  const created = creates.length ? await actor.createEmbeddedDocuments("Item", creates) : [];
  return { created, updated };
}

/**
 * The item a bundle row names: its uuid, else the library item of the same
 * name and type (a shelf re-imported under new ids), else null. A bundle is
 * never the answer; core refuses to nest one.
 */
export async function resolveBundleRow(row) {
  const byUuid = row.uuid ? await foundry.utils.fromUuid(row.uuid).catch(() => null) : null;
  if (byUuid?.documentName === "Item" && byUuid.type !== ITEM_TYPE.bundle) return byUuid;
  if (!row.name || row.type === ITEM_TYPE.bundle) return null;
  await whenReady();
  return libraryItems().find((d) => d.type === row.type && d.name === row.name) ?? null;
}

/**
 * Open `bundle` onto `actor`: every row it lists arrives as the goods it names.
 * The bundle is read, never consumed; one in the sidebar or a compendium stays
 * where it is, as core's own drop leaves it.
 * @returns {Promise<{created: Item[], updated: Item[], missing: string[]}>}
 *   `missing` names the rows nothing resolved; every other row was delivered.
 */
export async function unpackBundle(actor, bundle) {
  const goods = [];
  const missing = [];
  for (const row of bundleRows(bundle)) {
    const source = await resolveBundleRow(row);
    if (!source) {
      missing.push(row.name || row.uuid);
      continue;
    }
    const data = source.inCompendium ? game.items.fromCompendium(source, { clearFolder: true }) : source.toObject();
    goods.push(...goodsForRow(data, row.count));
  }
  if (!goods.length) return { created: [], updated: [], missing };
  return { ...(await deliverItems(actor, goods)), missing };
}
