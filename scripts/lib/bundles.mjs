/* global foundry, game, ui */
/**
 * Goods handed to an actor, and bundles opened onto one. No actor sheet lists
 * an embedded bundle, so nothing here embeds one: a dropped bundle arrives as
 * the goods it names, and a purchase arrives as goods. A stackable folds into
 * an identical stack the actor already carries (`stackSignature`). A bundle
 * already embedded is opened where it lies by `unpackEmbeddedBundle`.
 */
import { ACTOR_TYPE, ITEM_TYPE } from "./vocab.mjs";
import { ANIMAL_TYPE, LANG_PREFIX } from "./constants.mjs";
import { LIB_ID } from "./storage-logic.mjs";
import { coinContainerOf, handOver, landGoods } from "./storage.mjs";
import { libraryItems, whenReady } from "./library.mjs";
import { UNPACK_JOURNAL, bundleRows, goodsForDrop, goodsForRow, planEmbeddedUnpack, unpackStage } from "./bundles-logic.mjs";

/**
 * The actor types whose sheets list what the actor carries: the system's two
 * creature types and the animal on the monster's chassis.
 */
const CARRIER_TYPES = new Set([ACTOR_TYPE.character, ACTOR_TYPE.monster, ANIMAL_TYPE]);

/**
 * Does this actor's sheet list the goods it carries? Goods handed to one that
 * does not would leave the giver for an actor nothing shows them on, so every
 * hand-over onto a sheet asks this first.
 */
export const listsGoods = (actor) => CARRIER_TYPES.has(actor?.type);

/**
 * Tell the user that `actor`'s sheet lists no goods, so what was dropped on
 * it stays where it was. The one wording every sheet that refuses a drop uses.
 */
export const refuseGoods = (actor) => ui.notifications?.warn(game.i18n.format(`${LANG_PREFIX}.storage.keepsNoGoods`, { name: actor?.name ?? "" }));

/**
 * Create `goods` (arrival-shaped plain item data) on `actor`, folding each
 * stackable into an identical stack it already carries (`landGoods`). Coin
 * among them goes where the actor keeps arriving coin on their person.
 * @returns {Promise<{created: Item[], updated: Item[]}>}
 */
export const deliverItems = (actor, goods) => landGoods(actor, goods, { coinInto: coinContainerOf(actor) });

/** An item's data as a copy made of it would carry it, compendium bookkeeping cleared. */
const copyDataOf = (item) => (item.inCompendium ? game.items.fromCompendium(item, { clearFolder: true }) : item.toObject());

/**
 * What an item dropped from outside any actor — a compendium, the sidebar —
 * delivers: the stack it is (`goodsForDrop`), arrival-shaped.
 * @returns {object[]} plain item data, one entry per document to deliver
 */
export const droppedGoods = (item) => goodsForDrop(copyDataOf(item));

/**
 * An item dropped from outside any actor lands on `actor` as the stack it is,
 * folding into an identical stack the actor already carries rather than
 * making a second row. A place that keeps goods for owners takes the same
 * goods through `stockProvider`, which stamps whose they are.
 * @returns {Promise<{created: Item[], updated: Item[]}>}
 */
export const deliverDrop = (actor, item) => deliverItems(actor, droppedGoods(item));

/**
 * Where coin dropped on `actor`'s sheet from somewhere else goes, for every
 * sheet that carries goods. Off another actor it is handed over: it leaves the
 * giver and joins the receiver's row of its kind. With no actor behind it — a
 * compendium purse, a pile in the sidebar — it is an arrival with nobody to
 * debit, and lands on the row of its own kind where the seat owns the sheet.
 * Coin is never copied.
 */
export async function landCoin(actor, item) {
  const source = item?.parent;
  if (source?.documentName === "Actor") await handOver(source, actor, [{ id: item.id }]);
  else if (actor?.isOwner) await deliverDrop(actor, item);
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
 * The goods every row of `bundle` names, and the rows nothing resolved.
 * @returns {Promise<{goods: object[], missing: string[]}>}
 */
async function goodsOfBundle(bundle) {
  const goods = [];
  const missing = [];
  for (const row of bundleRows(bundle)) {
    const source = await resolveBundleRow(row);
    if (!source) {
      missing.push(row.name || row.uuid);
      continue;
    }
    goods.push(...goodsForRow(copyDataOf(source), row.count));
  }
  return { goods, missing };
}

/**
 * Open `bundle` onto `actor`: every row it lists arrives as the goods it names.
 * The bundle is read, never consumed; one in the sidebar or a compendium stays
 * where it is, as core's own drop leaves it.
 * @returns {Promise<{created: Item[], updated: Item[], missing: string[]}>}
 *   `missing` names the rows nothing resolved; every other row was delivered.
 */
export async function unpackBundle(actor, bundle) {
  const { goods, missing } = await goodsOfBundle(bundle);
  if (!goods.length) return { created: [], updated: [], missing };
  return { ...(await deliverItems(actor, goods)), missing };
}

/**
 * Open a bundle embedded on an actor into the goods it lists, then delete it.
 * The stack merges and a journal on the bundle land in one write, the copies
 * carry the bundle's id, and the bundle goes last, so a run that stops part-way
 * is finished by the next and nothing arrives twice (`unpackStage`). A bundle
 * with a row nothing resolves is left whole.
 * @returns {Promise<{ok: boolean, stage: string|null, created: Item[], missing: string[]}>}
 */
export async function unpackEmbeddedBundle(bundle) {
  const actor = bundle?.parent;
  if (!actor || bundle.type !== ITEM_TYPE.bundle) return { ok: false, stage: null, created: [], missing: [] };
  const held = () => actor.items.map((i) => i.toObject());
  const stage = unpackStage(bundle.toObject(), held());
  let created = [];
  if (stage === "fresh") {
    const { goods, missing } = await goodsOfBundle(bundle);
    if (missing.length) return { ok: false, stage, created, missing };
    const plan = planEmbeddedUnpack(bundle.id, goods, held(), { coinInto: coinContainerOf(actor) });
    await actor.updateEmbeddedDocuments("Item", plan.updates);
    if (plan.creates.length) created = await actor.createEmbeddedDocuments("Item", plan.creates);
  } else if (stage === "create") {
    const creates = bundle.getFlag(LIB_ID, UNPACK_JOURNAL)?.creates;
    if (Array.isArray(creates) && creates.length) created = await actor.createEmbeddedDocuments("Item", creates);
  }
  await actor.deleteEmbeddedDocuments("Item", [bundle.id]);
  return { ok: true, stage, created, missing: [] };
}
