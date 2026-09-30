/* global foundry */
/**
 * What a party carries as merchandise, and what it is worth here: the loads a
 * character's packs or a vehicle's hold hold, one row per stack with its
 * stones and its value at this month's market price (or its base cost where
 * the market has no current price for the category). Other features — the
 * city's gate action, the syndicate's smuggling service — read and draw loads
 * through this file; the load flag is the markets feature's, so the flag shape
 * stays here and nobody else reads or writes it.
 *
 * `manifestRows` and `manifestTotals` are pure over plain item data;
 * `manifestOf` and `removeLoads` are the document-facing halves.
 */
import { marketsFlagOf } from "../rules/goods.mjs";
import { planLoadDraw } from "../rules/arbitrage.mjs";
import { ITEM_TYPE } from "../../lib/vocab.mjs";
import { storageFlagOf } from "../../lib/storage-logic.mjs";
import { loadStacks } from "./ventures.mjs";
import { marketMonthStart } from "./trade.mjs";
import { merchandiseFor } from "./merchandise.mjs";

const gpRound = (n) => Math.round(n * 100) / 100;
const stonesOf = (item) => Math.max(0, Number(item?.system?.quantity?.value ?? 0) || 0);

/**
 * The merchandise loads among one holder's plain items, priced.
 *
 * A load is an item-type row whose markets flag says `merchandise` with a
 * `category`, carrying more than zero stones (one unit per stone), and either
 * unstamped or stamped for `traderUuid` — goods kept for another owner are
 * that owner's and never listed. `unitGp` is the `prices` row
 * (`{category, monthStartTime, priceCp}`) for the category at `monthStart`
 * (`priced: "market"`), else the item's own `system.cost` (`priced: "base"`).
 * `merchFor(category)` supplies the catalogue row whose `label` names the load.
 * @returns {{holderUuid: string, holderName: string, itemId: string, category: string, label: string, stones: number, unitGp: number, valueGp: number, priced: "market"|"base"}[]}
 */
export function manifestRows(plainItems, { holderUuid = "", holderName = "", traderUuid = null, prices = [], monthStart = null, merchFor = () => null } = {}) {
  const rows = [];
  for (const item of plainItems ?? []) {
    if (item?.type !== ITEM_TYPE.item) continue;
    const { merchandise, category } = marketsFlagOf(item);
    if (!merchandise || !category) continue;
    const stones = stonesOf(item);
    if (stones <= 0) continue;
    const owner = storageFlagOf(item)?.ownerUuid;
    if (owner && owner !== traderUuid) continue;
    const price = monthStart == null ? null : (prices ?? []).find((p) => p.category === category && Number(p.monthStartTime) === Number(monthStart));
    const priced = price ? "market" : "base";
    const unitGp = price ? Number(price.priceCp) / 100 : Number(item.system?.cost) || 0;
    rows.push({
      holderUuid,
      holderName,
      itemId: item._id,
      category,
      label: merchFor(category)?.label ?? item.name,
      stones,
      unitGp,
      valueGp: gpRound(stones * unitGp),
      priced,
    });
  }
  return rows;
}

/** The stones and gold value a set of manifest rows add up to. */
export function manifestTotals(rows) {
  const list = rows ?? [];
  return {
    stones: list.reduce((sum, r) => sum + (Number(r.stones) || 0), 0),
    valueGp: gpRound(list.reduce((sum, r) => sum + (Number(r.valueGp) || 0), 0)),
  };
}

/**
 * Every load the given holder actors carry (characters, vehicles), priced at
 * `market`'s current month where that location's goods hold a price for the
 * category. `traderUuid` admits goods stamped for that owner as well as
 * unstamped ones.
 * @returns {{rows: object[], stones: number, valueGp: number}} rows as `manifestRows`, then their totals
 */
export function manifestOf(holders, { market = null, traderUuid = null } = {}) {
  const prices = market?.system?.market?.goods?.merchPrices ?? [];
  const monthStart = marketMonthStart();
  const rows = [];
  for (const holder of holders ?? []) {
    const plainItems = [...(holder?.items ?? [])].map((i) => i.toObject());
    rows.push(
      ...manifestRows(plainItems, {
        holderUuid: holder?.uuid ?? "",
        holderName: holder?.name ?? "",
        traderUuid,
        prices,
        monthStart,
        merchFor: merchandiseFor,
      }),
    );
  }
  return { rows, ...manifestTotals(rows) };
}

/**
 * Take `stones` of one category's loads out of a holder, drawn across its
 * stacks in the order a sale draws them. Whole loads only; a draw the stacks
 * cannot meet takes nothing and answers `{ok: false, reason: "noLoads", held}`.
 * On success `removed` holds one detached plain copy per stack drawn from —
 * `_id` dropped, `system.quantity.value` set to the stones taken from it — so
 * the goods can be re-created later with `createEmbeddedDocuments` by a
 * caller that knows nothing of the load flag.
 * @returns {Promise<{ok: true, removed: object[]}|{ok: false, reason: "noLoads", held: number}>}
 */
export async function removeLoads(holder, category, stones, { traderUuid = null } = {}) {
  const stacks = loadStacks(holder, category, traderUuid);
  const draw = planLoadDraw(stacks.map((i) => ({ id: i.id, qty: i.system?.quantity?.value })), stones);
  if (draw.short) return { ok: false, reason: "noLoads", held: draw.held };

  const left = new Map(draw.updates.map((u) => [u.id, u.qty]));
  const removed = [];
  for (const stack of stacks) {
    const gone = draw.deletes.includes(stack.id);
    if (!gone && !left.has(stack.id)) continue;
    const taken = Math.round((stonesOf(stack) - (gone ? 0 : left.get(stack.id))) * 1e6) / 1e6;
    const copy = foundry.utils.deepClone(stack.toObject());
    delete copy._id;
    copy.system.quantity.value = taken;
    removed.push(copy);
  }

  if (draw.updates.length) {
    await holder.updateEmbeddedDocuments("Item", draw.updates.map((u) => ({ _id: u.id, "system.quantity.value": u.qty })));
  }
  if (draw.deletes.length) await holder.deleteEmbeddedDocuments("Item", draw.deletes);
  return { ok: true, removed };
}
