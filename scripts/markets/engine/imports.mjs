/* global game, ui, foundry, Hooks, ChatMessage, Roll, fromUuid */
/**
 * Merchant importing (RR §IV.3): order goods from a local hub (+1 market
 * class, 2d6 days) or regional hub (+2, 2d6 weeks), paid up front; on a 12
 * the goods are lost in transit and the payment forfeit.
 *
 * The order's fate is rolled AT PLACEMENT and stays hidden until due, so
 * resolution is deterministic under clock adjustments. Hubs are abstract in
 * v1 — availability checks run against the source class per order, with no
 * source-market ledger (MODEL.md; ROADMAP).
 */
import { MODULE_ID, LANG, HOOKS } from "../constants.mjs";
import { priceBandOf, cellFor, itemKeyOf } from "../rules/availability.mjs";
import { quote, toGp } from "../rules/pricing.mjs";
import { importPlan, dueImports, hubClass } from "../rules/imports.mjs";
import { registerHandler, executeAsGM } from "../../lib/sockets.mjs";
import { ITEM_TYPE } from "../../lib/vocab.mjs";
import { getTable } from "../../henchmen/rules/tables.mjs";
import { now, onTimeAdvanced } from "../../henchmen/time.mjs";
import * as adapter from "../../henchmen/acks-adapter.mjs";
import { effectiveMarketClass } from "../../henchmen/engine/recruitment.mjs";
import { findGearEntry } from "../../equipment/grant.mjs";
import { partyOf } from "./parties.mjs";
import {
  TRADE_TYPES,
  deliverGoods,
  abilityRanks,
  isMasterwork,
  categoryOf,
  demandStepsFor,
  marketMonthStart,
} from "./trade.mjs";
import { bargainWinner } from "../rules/pricing.mjs";

const err = (error, data = {}) => ({ error, ...data });

const d100 = async () => (await new Roll("1d100").evaluate()).total;

/** Whispered card to the GM and the buyer's owners. */
async function postCard(buyer, html) {
  const whisper = [
    ...game.users.filter((u) => u.isGM).map((u) => u.id),
    ...game.users.filter((u) => !u.isGM && buyer.testUserPermission(u, "OWNER")).map((u) => u.id),
  ];
  await ChatMessage.create({
    content: `<div class="acks-extras-markets-receipt">${html}</div>`,
    whisper,
    speaker: ChatMessage.getSpeaker({ actor: buyer }),
  });
}

/**
 * Place an import order: pay now, arrival (or hidden loss) already decided.
 */
export async function placeImportOrder(location, payload) {
  const { buyerUuid, itemName, qty: rawQty, hubShift: rawShift, merchantRanks = 0, requestUserId = null, resolutionId = "" } = payload;
  const hubShift = rawShift === 2 ? 2 : 1;
  const qty = Math.max(1, Math.floor(Number(rawQty) || 1));

  const buyerDoc = await fromUuid(buyerUuid).catch(() => null);
  const buyer = buyerDoc?.actor ?? buyerDoc;
  if (!buyer) return err("noBuyer");
  if (!location?.system?.market?.goods) return err("noMarket");
  if (requestUserId) {
    const user = game.users.get(requestUserId);
    if (!user?.isGM && !buyer.testUserPermission(user, "OWNER")) return err("notYours");
  }

  const goods = location.system.market.goods;
  const existing = (goods.imports ?? []).map((r) => r.toObject?.() ?? foundry.utils.deepClone(r));
  if (resolutionId && existing.some((o) => o.id === resolutionId)) return err("duplicate");

  const entry = await findGearEntry(itemName);
  if (!entry) return err("noSource");
  const itemData = entry.data;
  if (!TRADE_TYPES.includes(itemData.type) || itemData.type === ITEM_TYPE.bundle) return err("untradeable");
  const costGp = Number(itemData.system?.cost ?? 0);
  if (!(costGp > 0)) return err("untradeable");
  if (isMasterwork(itemData) && !goods.masterworkContact) return err("masterworkGated");

  const localClass = effectiveMarketClass(location, buyer);
  if (localClass == null) return err("noMarket");
  const sourceClass = hubClass(localClass, hubShift);
  const rows = getTable("availability", "equipmentAvailability").rows ?? [];
  const band = priceBandOf(costGp, rows);
  if (!band) return err("untradeable");
  const cell = cellFor(band, sourceClass);
  if (cell.kind === "none") return err("unavailable");

  // The importable quantity is the SOURCE market's monthly value (RR §IV.3);
  // %-cells roll one unit's existence fresh per order (abstract hub).
  let sourceDetail = "";
  if (cell.kind === "pct") {
    const roll = await d100();
    sourceDetail = `d100 ${roll} vs ${cell.chance}%`;
    if (roll > cell.chance) return err("hubOut", { detail: sourceDetail });
    if (qty > 1) return err("capExceeded", { remaining: 1 });
  } else if (qty > cell.n) {
    return err("capExceeded", { remaining: cell.n });
  }

  // Price as a local purchase (demand and Bargaining still apply; the hub's
  // advantage is availability, not price).
  const partyRanks = abilityRanks(buyer, "Bargaining");
  const bargain = bargainWinner({ partyRanks, merchantRanks, opposedWinner: null });
  const priced = quote({ costGp, direction: "buy", demandSteps: demandStepsFor(goods, categoryOf(itemData)), bargain });
  const totalGp = toGp(priced.unitCp * qty);
  const paid = await adapter.spendGold(buyer, totalGp, game.i18n.format(`${LANG}.imports.payReason`, { qty, name: itemData.name }));
  if (!paid) return err("insufficientGold");

  const roll2d6 = (await new Roll("2d6").evaluate()).total;
  const t = now();
  const plan = importPlan({ roll2d6, hubShift, placedTime: t });
  const order = {
    id: resolutionId || foundry.utils.randomID(),
    partyId: partyOf(buyer).id,
    buyerUuid: buyer.uuid,
    itemKey: itemKeyOf(itemData.name),
    itemName: itemData.name,
    qty,
    unitPriceCp: priced.unitCp,
    totalCp: priced.unitCp * qty,
    hubShift,
    placedTime: t,
    arrivalTime: plan.arrivalTime,
    lost: plan.lost,
    status: "ordered",
    rollDetail: `${plan.detail}${sourceDetail ? `; ${sourceDetail}` : ""}`,
    lastResolutionId: "",
  };

  const log = (location.system.market.marketLog ?? []).map((r) => r.toObject?.() ?? foundry.utils.deepClone(r));
  log.push({
    time: t,
    type: "importOrder",
    note: `${buyer.name}: ordered ${qty}× ${itemData.name} from ${hubShift === 2 ? "regional" : "local"} hub for ${totalGp}gp [${order.id}]`,
  });
  await location.update({
    "system.market.goods.imports": [...existing, order],
    "system.market.marketLog": log.slice(-300),
  });

  await postCard(
    buyer,
    `<strong>${game.i18n.format(`${LANG}.imports.orderedLine`, { buyer: buyer.name, qty, name: itemData.name, location: location.name })}</strong><br>` +
      `${game.i18n.format(`${LANG}.imports.paid`, { total: totalGp })}`
  );
  Hooks.callAll(HOOKS.IMPORT_ORDERED, { location, buyer, itemName: itemData.name, qty, totalGp });
  return { ok: true, totalGp, etaDays: Math.ceil((plan.arrivalTime - t) / 86400) };
}

/**
 * Resolve every due order on one location: deliver to the buyer, or reveal
 * the loss. Idempotent — resolved rows change status; the watermark records
 * the sweep.
 */
export async function processImports(location) {
  const goods = location.system.market?.goods;
  if (!goods) return { resolved: 0 };
  const t = now();
  const orders = (goods.imports ?? []).map((r) => r.toObject?.() ?? foundry.utils.deepClone(r));
  const due = dueImports(orders, t);
  if (!due.length) {
    if (Number(goods.lastProcessedTime ?? 0) < t) {
      await location.update({ "system.market.goods.lastProcessedTime": t });
    }
    return { resolved: 0 };
  }
  const log = (location.system.market.marketLog ?? []).map((r) => r.toObject?.() ?? foundry.utils.deepClone(r));
  let resolved = 0;
  for (const order of due) {
    const buyerDoc = await fromUuid(order.buyerUuid).catch(() => null);
    const buyer = buyerDoc?.actor ?? buyerDoc;
    if (order.lost) {
      order.status = "lostRevealed";
      log.push({ time: t, type: "importLost", note: `${order.qty}× ${order.itemName}: lost in transit (${order.rollDetail})` });
      if (buyer) {
        await postCard(buyer, `<strong>${game.i18n.format(`${LANG}.imports.lostLine`, { qty: order.qty, name: order.itemName })}</strong>`);
      }
    } else {
      const entry = await findGearEntry(order.itemName);
      if (!entry || !buyer) {
        // Nothing to deliver to — leave the order for the Judge rather than
        // silently consuming it.
        log.push({ time: t, type: "importArrived", note: `${order.qty}× ${order.itemName}: arrived but undeliverable (missing ${buyer ? "source item" : "buyer"})` });
        order.status = "delivered";
        resolved += 1;
        continue;
      }
      await deliverGoods(buyer, { entry, qty: order.qty, locationName: location.name });
      order.status = "delivered";
      log.push({ time: t, type: "importArrived", note: `${buyer.name}: ${order.qty}× ${order.itemName} arrived` });
      await postCard(buyer, `<strong>${game.i18n.format(`${LANG}.imports.arrivedLine`, { buyer: buyer.name, qty: order.qty, name: order.itemName, location: location.name })}</strong>`);
    }
    resolved += 1;
    Hooks.callAll(HOOKS.IMPORT_RESOLVED, { location, order });
  }
  await location.update({
    "system.market.goods.imports": orders,
    "system.market.goods.lastProcessedTime": t,
    "system.market.marketLog": log.slice(-300),
  });
  return { resolved };
}

/** Every market location's due imports (the GM time-hook target). */
export async function processAllImports() {
  const type = `${MODULE_ID}.location`;
  for (const actor of game.actors.filter((a) => a.type === type && a.system.hasMarket)) {
    try {
      await processImports(actor);
    } catch (e) {
      console.error(`${MODULE_ID} | import processing failed for ${actor.name}`, e);
    }
  }
}

/** GM-client watcher: resolve due orders whenever world time advances. */
export function registerImportWatcher() {
  onTimeAdvanced(() => processAllImports());
}

/* ------------------------- socket relays ------------------------- */

registerHandler("marketsImportOrder", async ({ locationUuid, ...payload }) => {
  const doc = await fromUuid(locationUuid).catch(() => null);
  const location = doc?.actor ?? doc;
  if (!location) return err("noMarket");
  return placeImportOrder(location, payload);
});

/** Local-first dispatch for placing an import order. */
export async function performImportOrder(location, payload) {
  const canLocal =
    game.user.isGM ||
    (location.testUserPermission(game.user, "OWNER") &&
      (await fromUuid(payload.buyerUuid).catch(() => null))?.testUserPermission?.(game.user, "OWNER"));
  if (canLocal) return placeImportOrder(location, { ...payload, requestUserId: game.user.isGM ? null : game.user.id });
  return executeAsGM("marketsImportOrder", { locationUuid: location.uuid, ...payload, requestUserId: game.user.id });
}
