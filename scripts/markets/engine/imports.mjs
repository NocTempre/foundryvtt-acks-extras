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
import { quote, toGp, bargainWinner } from "../rules/pricing.mjs";
import { importPlan, dueImports, hubClass } from "../rules/imports.mjs";
import { commissionPlan } from "../rules/commissions.mjs";
import { registerHandler, executeAsGM } from "../../lib/sockets.mjs";
import { ITEM_TYPE } from "../../lib/vocab.mjs";
import { getTable, optTable } from "../../henchmen/rules/tables.mjs";
import { now, onTimeAdvanced } from "../../henchmen/time.mjs";
import { getSetting as henchmenSetting } from "../../henchmen/settings.mjs";
import * as adapter from "../../henchmen/acks-adapter.mjs";
import { effectiveMarketClass } from "../../henchmen/engine/recruitment.mjs";
import { findGearEntry } from "../../equipment/grant.mjs";
import { partyOf } from "./parties.mjs";
import { processVentureActions } from "./ventures.mjs";
import {
  TRADE_TYPES,
  deliverGoods,
  abilityRanks,
  isMasterwork,
  categoryOf,
  demandStepsFor,
  marketMonthStart,
  resolveMonthlyAvailability,
  resolveSearchDayActions,
  goodsOf,
} from "./trade.mjs";

const SECONDS_PER_DAY = 86400;

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
  const rows = optTable("availability", "equipmentAvailability")?.rows;
  if (!rows?.length) return err("tablesMissing");
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
  const paid = await adapter.spendGold(buyer, totalGp, game.i18n.format(`${LANG}.imports.payReason`, { qty, name: itemData.name }), { to: location, at: location });
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
  // Extended-search days resolve FIRST, as their own write, so the rest of
  // the sweep (searches especially) reads the raised caps.
  let resolvedSearchDays = 0;
  try {
    resolvedSearchDays = await resolveSearchDayActions(location, t);
  } catch (e) {
    console.error(`${MODULE_ID} | search-day resolution failed for ${location.name}`, e);
  }
  const log = (location.system.market.marketLog ?? []).map((r) => r.toObject?.() ?? foundry.utils.deepClone(r));
  const updates = {};
  let resolved = resolvedSearchDays;

  // Imports: arrivals deliver, losses reveal, both on their rolled dates.
  const orders = (goods.imports ?? []).map((r) => r.toObject?.() ?? foundry.utils.deepClone(r));
  const due = dueImports(orders, t);
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
        // Nothing to deliver to — leave the record for the Judge rather than
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
  if (due.length) updates["system.market.goods.imports"] = orders;

  // Commissions: finished builds deliver.
  const commissions = (goods.commissions ?? []).map((r) => r.toObject?.() ?? foundry.utils.deepClone(r));
  const built = commissions.filter((o) => o.status === "building" && Number(o.completionTime) <= t);
  for (const order of built) {
    const buyerDoc = await fromUuid(order.buyerUuid).catch(() => null);
    const buyer = buyerDoc?.actor ?? buyerDoc;
    const entry = await findGearEntry(order.itemName);
    order.status = "delivered";
    resolved += 1;
    if (!entry || !buyer) {
      log.push({ time: t, type: "commissionDone", note: `${order.qty}× ${order.itemName}: finished but undeliverable (missing ${buyer ? "source item" : "buyer"})` });
      continue;
    }
    await deliverGoods(buyer, { entry, qty: order.qty, locationName: location.name });
    log.push({ time: t, type: "commissionDone", note: `${buyer.name}: ${order.qty}× ${order.itemName} finished` });
    await postCard(buyer, `<strong>${game.i18n.format(`${LANG}.commissions.doneLine`, { buyer: buyer.name, qty: order.qty, name: order.itemName })}</strong>`);
  }
  if (built.length) updates["system.market.goods.commissions"] = commissions;

  // Venture actions: dedicated days resolve once their day has passed.
  const ventureSweep = await processVentureActions(location, log, t);
  if (ventureSweep) {
    updates["system.market.goods.actions"] = ventureSweep.actions;
    updates["system.market.goods.ventures"] = ventureSweep.ventures;
    updates["system.market.goods.dmKnowledge"] = ventureSweep.dmKnowledge;
    updates["system.market.goods.merchPrices"] = ventureSweep.merchPrices;
    updates["system.market.goods.solicitations"] = ventureSweep.solicitations;
    resolved += 1;
  }

  // Directed searches: a fresh market month gets a fresh look.
  const goodsWrites = { goods: goodsOf(location), dirty: false };
  const searchSweep = await processSearches(location, goodsWrites, log, t);
  if (searchSweep.changed) {
    updates["system.market.goods.searches"] = searchSweep.searches;
    resolved += searchSweep.searches.filter((o) => o.status === "found").length;
  }
  if (goodsWrites.dirty) {
    updates["system.market.goods.ledger"] = goodsWrites.goods.ledger;
    updates["system.market.goods.existenceRolls"] = goodsWrites.goods.existenceRolls;
    updates["system.market.goods.totals"] = goodsWrites.goods.totals;
    updates["system.market.goods.partyMonths"] = goodsWrites.goods.partyMonths;
  }

  if (!Object.keys(updates).length) {
    if (Number(goods.lastProcessedTime ?? 0) < t) {
      await location.update({ "system.market.goods.lastProcessedTime": t });
    }
    return { resolved };
  }
  updates["system.market.goods.lastProcessedTime"] = t;
  updates["system.market.marketLog"] = log.slice(-300);
  await location.update(updates);
  return { resolved };
}

/**
 * Commission an item's construction (RR §IV.11): the item is a project of
 * its base cost, built at the chosen worker's construction rate; the wages
 * for the duration are paid up front and the finished goods deliver at
 * completion through the same due-work sweep as imports.
 */
export async function placeCommission(location, payload) {
  const { buyerUuid, itemName, qty: rawQty, worker, requestUserId = null, resolutionId = "" } = payload;
  const qty = Math.max(1, Math.floor(Number(rawQty) || 1));
  const buyerDoc = await fromUuid(buyerUuid).catch(() => null);
  const buyer = buyerDoc?.actor ?? buyerDoc;
  if (!buyer) return err("noBuyer");
  const goods = location?.system?.market?.goods;
  if (!goods) return err("noMarket");
  if (requestUserId) {
    const user = game.users.get(requestUserId);
    if (!user?.isGM && !buyer.testUserPermission(user, "OWNER")) return err("notYours");
  }
  const existing = (goods.commissions ?? []).map((r) => r.toObject?.() ?? foundry.utils.deepClone(r));
  if (resolutionId && existing.some((o) => o.id === resolutionId)) return err("duplicate");

  const entry = await findGearEntry(itemName);
  if (!entry) return err("noSource");
  const itemData = entry.data;
  if (!TRADE_TYPES.includes(itemData.type) || itemData.type === ITEM_TYPE.bundle) return err("untradeable");
  const costGp = Number(itemData.system?.cost ?? 0);
  if (!(costGp > 0)) return err("untradeable");
  // A masterwork is a grandmaster's work — the same contact gate (RR §IV.6).
  if (isMasterwork(itemData) && !goods.masterworkContact) return err("masterworkGated");

  const rateRow = (optTable("construction", "wageAndConstructionRates")?.rows ?? []).find((r) => r.worker === worker);
  if (!rateRow) return err("noRates");
  const plan = commissionPlan({
    costCp: Math.round(costGp * 100) * qty,
    rateRow,
    daysPerMonth: Number(henchmenSetting("daysPerMonth")) || 28,
  });
  if (!plan) return err("noRates");

  const wagesGp = toGp(plan.wagesCp);
  const paid = await adapter.spendGold(buyer, wagesGp, game.i18n.format(`${LANG}.commissions.payReason`, { qty, name: itemData.name }), { to: location, at: location });
  if (!paid) return err("insufficientGold");

  const t = now();
  const order = {
    id: resolutionId || foundry.utils.randomID(),
    buyerUuid: buyer.uuid,
    itemKey: itemKeyOf(itemData.name),
    itemName: itemData.name,
    qty,
    worker,
    wagesCp: plan.wagesCp,
    placedTime: t,
    completionTime: t + plan.days * SECONDS_PER_DAY,
    status: "building",
    lastResolutionId: "",
  };
  const log = (location.system.market.marketLog ?? []).map((r) => r.toObject?.() ?? foundry.utils.deepClone(r));
  log.push({
    time: t,
    type: "commission",
    note: `${buyer.name}: commissioned ${qty}× ${itemData.name} (${worker}, ${plan.days} days, ${wagesGp}gp wages) [${order.id}]`,
  });
  await location.update({
    "system.market.goods.commissions": [...existing, order],
    "system.market.marketLog": log.slice(-300),
  });
  await postCard(
    buyer,
    `<strong>${game.i18n.format(`${LANG}.commissions.placedLine`, { buyer: buyer.name, qty, name: itemData.name, days: plan.days })}</strong><br>` +
      `${game.i18n.format(`${LANG}.imports.paid`, { total: wagesGp })}`
  );
  return { ok: true, days: plan.days, wagesGp };
}

/**
 * Post a directed search: a standing ask for one specific item the merchant
 * keeps looking for. Re-examined at each new market month's availability by
 * the due-work sweep; a find is announced, never auto-bought.
 */
export async function createItemSearch(location, payload) {
  const { buyerUuid, itemName, qty: rawQty, requestUserId = null, resolutionId = "" } = payload;
  const qty = Math.max(1, Math.floor(Number(rawQty) || 1));
  const buyerDoc = await fromUuid(buyerUuid).catch(() => null);
  const buyer = buyerDoc?.actor ?? buyerDoc;
  if (!buyer) return err("noBuyer");
  const goods = location?.system?.market?.goods;
  if (!goods) return err("noMarket");
  if (requestUserId) {
    const user = game.users.get(requestUserId);
    if (!user?.isGM && !buyer.testUserPermission(user, "OWNER")) return err("notYours");
  }
  const existing = (goods.searches ?? []).map((r) => r.toObject?.() ?? foundry.utils.deepClone(r));
  if (resolutionId && existing.some((o) => o.id === resolutionId)) return err("duplicate");
  const entry = await findGearEntry(itemName);
  if (!entry) return err("noSource");
  const key = itemKeyOf(itemName);
  if (existing.some((o) => o.status === "active" && o.itemKey === key && o.partyId === partyOf(buyer).id)) {
    return err("alreadySearching");
  }
  const t = now();
  const search = {
    id: resolutionId || foundry.utils.randomID(),
    partyId: partyOf(buyer).id,
    buyerUuid: buyer.uuid,
    itemKey: key,
    itemName: entry.data.name,
    qty,
    createdTime: t,
    // This month's shelves were already in view when the search was posted;
    // the first fresh look is next month's roll.
    lastRolledMonth: marketMonthStart(t),
    status: "active",
  };
  const log = (location.system.market.marketLog ?? []).map((r) => r.toObject?.() ?? foundry.utils.deepClone(r));
  log.push({ time: t, type: "search", note: `${buyer.name}: searching for ${qty}× ${entry.data.name} [${search.id}]` });
  await location.update({
    "system.market.goods.searches": [...existing, search],
    "system.market.marketLog": log.slice(-300),
  });
  return { ok: true };
}

/** Cancel a directed search (its owner or the GM). */
export async function cancelItemSearch(location, { searchId, requestUserId = null }) {
  const goods = location?.system?.market?.goods;
  if (!goods) return err("noMarket");
  const searches = (goods.searches ?? []).map((r) => r.toObject?.() ?? foundry.utils.deepClone(r));
  const search = searches.find((o) => o.id === searchId);
  if (!search) return err("noSearch");
  if (requestUserId) {
    const user = game.users.get(requestUserId);
    const buyerDoc = await fromUuid(search.buyerUuid).catch(() => null);
    const buyer = buyerDoc?.actor ?? buyerDoc;
    if (!user?.isGM && !(buyer && buyer.testUserPermission(user, "OWNER"))) return err("notYours");
  }
  search.status = "cancelled";
  await location.update({ "system.market.goods.searches": searches });
  return { ok: true };
}

/**
 * Re-examine active searches against a fresh market month. Rolls land in
 * the shared goods rows (the searcher's own %-find first, then the town's
 * stock), so a find here is the same find the buy flow will honor.
 */
async function processSearches(location, goodsWrites, log, t) {
  const goods = location.system.market.goods;
  const monthStart = marketMonthStart(t);
  const searches = (goods.searches ?? []).map((r) => r.toObject?.() ?? foundry.utils.deepClone(r));
  let changed = false;
  for (const search of searches) {
    if (search.status !== "active" || Number(search.lastRolledMonth) >= monthStart) continue;
    search.lastRolledMonth = monthStart;
    changed = true;
    const buyerDoc = await fromUuid(search.buyerUuid).catch(() => null);
    const buyer = buyerDoc?.actor ?? buyerDoc;
    const entry = buyer ? await findGearEntry(search.itemName) : null;
    if (!entry) continue;
    const state = await resolveMonthlyAvailability(location, goodsWrites.goods, {
      itemData: entry.data,
      bandValueGp: Number(entry.data.system?.cost ?? 0),
      trader: buyer,
      direction: "bought",
    });
    if (state.error) continue;
    goodsWrites.dirty = true;
    if (state.room.remaining >= Math.max(1, search.qty)) {
      search.status = "found";
      log.push({ time: t, type: "searchFound", note: `${search.qty}× ${search.itemName}: found for ${buyer.name}` });
      await postCard(buyer, `<strong>${game.i18n.format(`${LANG}.searches.foundLine`, { qty: search.qty, name: search.itemName, location: location.name })}</strong>`);
    }
  }
  return { searches, changed };
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

registerHandler("marketsCommission", async ({ locationUuid, ...payload }) => {
  const doc = await fromUuid(locationUuid).catch(() => null);
  const location = doc?.actor ?? doc;
  if (!location) return err("noMarket");
  return placeCommission(location, payload);
});

registerHandler("marketsSearch", async ({ locationUuid, ...payload }) => {
  const doc = await fromUuid(locationUuid).catch(() => null);
  const location = doc?.actor ?? doc;
  if (!location) return err("noMarket");
  return createItemSearch(location, payload);
});

registerHandler("marketsSearchCancel", async ({ locationUuid, ...payload }) => {
  const doc = await fromUuid(locationUuid).catch(() => null);
  const location = doc?.actor ?? doc;
  if (!location) return err("noMarket");
  return cancelItemSearch(location, payload);
});

/** Local-first dispatch shared by the buyer-actor order paths. */
async function dispatch(handler, fn, location, payload, buyerUuidField = "buyerUuid") {
  const target = payload[buyerUuidField] ? await fromUuid(payload[buyerUuidField]).catch(() => null) : null;
  const canLocal =
    game.user.isGM ||
    (location.testUserPermission(game.user, "OWNER") && (target == null || target.testUserPermission?.(game.user, "OWNER")));
  if (canLocal) return fn(location, { ...payload, requestUserId: game.user.isGM ? null : game.user.id });
  return executeAsGM(handler, { locationUuid: location.uuid, ...payload, requestUserId: game.user.id });
}

/** Local-first dispatch for placing an import order. */
export async function performImportOrder(location, payload) {
  return dispatch("marketsImportOrder", placeImportOrder, location, payload);
}

/** Local-first dispatch for commissioning an item. */
export async function performCommission(location, payload) {
  return dispatch("marketsCommission", placeCommission, location, payload);
}

/** Local-first dispatch for posting a directed search. */
export async function performItemSearch(location, payload) {
  return dispatch("marketsSearch", createItemSearch, location, payload);
}

/** Local-first dispatch for cancelling a directed search. */
export async function performSearchCancel(location, payload) {
  return dispatch("marketsSearchCancel", cancelItemSearch, location, payload);
}
