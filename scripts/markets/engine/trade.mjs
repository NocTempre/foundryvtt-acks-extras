/* global game, ui, foundry, ChatMessage, Roll, fromUuid */
/**
 * The goods-trade engine: the ONLY writer of `system.market.goods`.
 *
 * One atomic entry point per action (purchase, extended search day), run
 * LOCAL-FIRST like the recruitment engine: a seat that can write both the
 * location and the trader acts directly; other seats relay through the GM
 * socket. Every action re-derives band, caps and price from current data —
 * a dialog's numbers are a preview, never an input to the ledger.
 */
import { MODULE_ID, LANG, HOOKS, ITEM_FLAG } from "../constants.mjs";
import { getSetting } from "../settings.mjs";
import {
  priceBandOf,
  cellFor,
  remainingFor,
  pctMarketStock,
  itemKeyOf,
} from "../rules/availability.mjs";
import { quote, bargainWinner, toGp } from "../rules/pricing.mjs";
import { registerHandler, executeAsGM } from "../../lib/sockets.mjs";
import { ITEM_TYPE, slug } from "../../lib/vocab.mjs";
import { getTable } from "../../henchmen/rules/tables.mjs";
import { now, calendarMonthStart, secondsPerMonth } from "../../henchmen/time.mjs";
import * as adapter from "../../henchmen/acks-adapter.mjs";
import { effectiveMarketClass } from "../../henchmen/engine/recruitment.mjs";
import { findGearEntry } from "../../equipment/grant.mjs";
import { partyOf, partySize } from "./parties.mjs";

/** Item types the goods market trades. */
export const TRADE_TYPES = Object.freeze([ITEM_TYPE.weapon, ITEM_TYPE.armor, ITEM_TYPE.item, ITEM_TYPE.bundle]);

/** Start of the market month containing `t` (calendar-aware, henchmen clock). */
export function marketMonthStart(t = now()) {
  return calendarMonthStart(t) ?? Math.floor(t / secondsPerMonth()) * secondsPerMonth();
}

/** Deep-cloned goods arrays, ready to mutate and write back. */
function goodsOf(location) {
  const goods = location.system.market?.goods;
  const arr = (v) => (v ?? []).map((r) => r.toObject?.() ?? foundry.utils.deepClone(r));
  return {
    ledger: arr(goods?.ledger),
    existenceRolls: arr(goods?.existenceRolls),
    totals: arr(goods?.totals),
    partyMonths: arr(goods?.partyMonths),
    demand: arr(goods?.demand),
    imports: arr(goods?.imports),
  };
}

/** Drop rows from months other than `monthStart` (the ledger is monthly). */
const thisMonth = (rows, monthStart) => rows.filter((r) => Number(r.monthStartTime) === monthStart);

/** Find-or-append a row. */
function ensureRow(rows, pred, blank) {
  let row = rows.find(pred);
  if (!row) rows.push((row = blank));
  return row;
}

/** Rank count of a named general proficiency on an actor (abilities model:
 *  rank = count of same-named ability items). */
export function abilityRanks(actor, name) {
  const wanted = slug(name);
  return (actor?.items ?? []).filter((i) => i.type === ITEM_TYPE.ability && slug(i.name) === wanted).length;
}

/** Masterwork gear is Judge-gated (RR §IV.6), never on the open table. */
export function isMasterwork(itemData) {
  if (itemData?.flags?.[MODULE_ID]?.[ITEM_FLAG]?.masterwork != null) {
    return !!itemData.flags[MODULE_ID][ITEM_FLAG].masterwork;
  }
  return /masterwork/i.test(String(itemData?.name ?? ""));
}

/**
 * Merchandise category for demand pricing: explicit per-item flag override,
 * else weapons and armor are the book's "armor & weapons"; clothing subtype
 * maps to clothing; other mundane gear has no category and no demand step.
 */
export function categoryOf(itemData) {
  const flagged = itemData?.flags?.[MODULE_ID]?.[ITEM_FLAG]?.category;
  if (flagged) return flagged;
  if (itemData?.type === ITEM_TYPE.weapon || itemData?.type === ITEM_TYPE.armor) return "armorWeapons";
  if (itemData?.type === ITEM_TYPE.item && itemData?.system?.subtype === "clothing") return "clothing";
  return null;
}

/** Signed demand steps for a category on this market (0 when unset). */
export function demandStepsFor(goods, category) {
  if (!category) return 0;
  return Number(goods.demand?.find?.((d) => d.category === category)?.modifier ?? 0) || 0;
}

const d100 = async () => (await new Roll("1d100").evaluate()).total;

/**
 * Opposed Bargaining reaction rolls (2d6 + CHA + 2 per rank each side);
 * higher takes the discount, a tie moves nothing. Natural 2/12 need no
 * special floors here — only the comparison matters.
 */
async function opposedBargain({ trader, partyRanks, merchantRanks, merchantCha }) {
  const mine = (await new Roll("2d6").evaluate()).total + adapter.getChaMod(trader) + 2 * partyRanks;
  const theirs = (await new Roll("2d6").evaluate()).total + Number(merchantCha ?? 0) + 2 * merchantRanks;
  const winner = mine > theirs ? "party" : theirs > mine ? "merchant" : null;
  return { winner, detail: `opposed Bargaining ${mine} vs ${theirs}` };
}

/** Whispered trade receipt to the GM and the trader's owners. */
async function postReceipt({ location, trader, html }) {
  const whisper = [
    ...game.users.filter((u) => u.isGM).map((u) => u.id),
    ...game.users.filter((u) => !u.isGM && trader.testUserPermission(u, "OWNER")).map((u) => u.id),
  ];
  await ChatMessage.create({
    content: `<div class="acks-extras-markets-receipt">${html}</div>`,
    whisper,
    speaker: ChatMessage.getSpeaker({ actor: trader }),
  });
}

/** Append a market-log line, capped to the recent past. */
function appendLog(logRows, entry) {
  logRows.push(entry);
  return logRows.slice(-300);
}

const err = (error, data = {}) => ({ error, ...data });

/**
 * Availability snapshot for one named item, for display and for the
 * pre-purchase check. Read-only: unrolled %-cells report `pending` rather
 * than rolling.
 */
export function availabilityFor(location, { itemName, costGp, trader = null, direction = "bought" }) {
  const goods = location.system.market?.goods;
  if (!goods) return { status: "noMarket" };
  const rows = getTable("availability", "equipmentAvailability").rows ?? [];
  const band = priceBandOf(costGp, rows);
  if (!band) return { status: "untradeable" };
  const marketClass = trader ? effectiveMarketClass(location, trader) : location.system.marketClass;
  if (marketClass == null) return { status: "noMarket" };
  const cell = cellFor(band, marketClass);
  if (cell.kind === "none") return { status: "unavailable", band: band.band };

  const monthStart = marketMonthStart();
  const key = itemKeyOf(itemName);
  const party = partyOf(trader);
  const ledgerRow = (goods.ledger ?? []).find(
    (r) => r.partyId === party.id && r.itemKey === key && Number(r.monthStartTime) === monthStart
  );
  const totalsRow = (goods.totals ?? []).find((r) => r.itemKey === key && Number(r.monthStartTime) === monthStart);
  const partyMonth = (goods.partyMonths ?? []).find(
    (r) => r.partyId === party.id && Number(r.monthStartTime) === monthStart
  );
  const existRow = (goods.existenceRolls ?? []).find(
    (r) => r.partyId === party.id && r.itemKey === key && Number(r.monthStartTime) === monthStart
  );
  if (cell.kind === "pct" && !existRow) return { status: "pending", band: band.band, chance: cell.chance };

  const { remaining, capParty, capMarket } = remainingFor({
    cell,
    direction,
    ledgerRow,
    totalsRow,
    doubled: !!partyMonth?.dedicated,
    extraSearchDays: Number(partyMonth?.searchDays ?? 0),
    exists: !!existRow?.exists,
    pctStock: Number(totalsRow?.pctStock ?? 0),
  });
  return { status: remaining > 0 ? "available" : "exhausted", band: band.band, remaining, capParty, capMarket };
}

/**
 * The purchasable catalog: every distinct tradeable item this world knows —
 * world items first (a Judge's customisation wins), then every Item
 * compendium — priced above zero, masterwork gated behind the market's
 * contact. One row per distinct item key, the identity the ledger caps on.
 */
export async function buildCatalog(location) {
  const contact = !!location.system.market?.goods?.masterworkContact;
  const byKey = new Map();
  const consider = (data) => {
    if (!TRADE_TYPES.includes(data.type) || data.type === ITEM_TYPE.bundle) return;
    const costGp = Number(data.system?.cost ?? 0);
    if (!(costGp > 0)) return;
    if (isMasterwork(data) && !contact) return;
    const key = itemKeyOf(data.name);
    if (byKey.has(key)) return;
    byKey.set(key, {
      key,
      name: data.name,
      img: data.img,
      type: data.type,
      costGp,
      system: { cost: costGp, subtype: data.system?.subtype },
      flags: data.flags ?? {},
    });
  };
  for (const item of game.items) consider(item.toObject());
  for (const pack of game.packs) {
    if (pack.documentName !== "Item") continue;
    try {
      const index = await pack.getIndex({ fields: ["system.cost", "system.subtype", "flags"] });
      for (const e of index) consider(e);
    } catch (e) {
      console.warn(`${MODULE_ID} | catalog index failed for ${pack.collection}`, e);
    }
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The atomic purchase. Runs on a seat that can write the location AND the
 * buyer (players hold OWNER on both by default); other seats relay via the
 * "marketsPurchase" socket. Deliveries stack: quantity-bearing items merge
 * into the buyer's existing stack; a multi-unit purchase of unit items
 * (thirty swords) delivers ONE bundle document pointing at the source.
 */
export async function purchase(location, payload) {
  const {
    buyerUuid,
    itemName,
    qty: rawQty,
    dedicated = false,
    merchantRanks = 0,
    merchantCha = 1,
    requestUserId = null,
    resolutionId = "",
  } = payload;

  const qty = Math.max(1, Math.floor(Number(rawQty) || 1));
  const buyerDoc = await fromUuid(buyerUuid).catch(() => null);
  const buyer = buyerDoc?.actor ?? buyerDoc;
  if (!buyer) return err("noBuyer");
  if (!location?.system?.market?.goods) return err("noMarket");

  // A relayed request acts for its user: they must own the buyer.
  if (requestUserId) {
    const user = game.users.get(requestUserId);
    if (!user?.isGM && !buyer.testUserPermission(user, "OWNER")) return err("notYours");
  }

  // Idempotency: a resolution delivered twice (two GM windows) applies once.
  const log = (location.system.market.marketLog ?? []).map((r) => r.toObject?.() ?? foundry.utils.deepClone(r));
  if (resolutionId && log.some((l) => l.note?.includes(resolutionId))) return err("duplicate");

  const entry = await findGearEntry(itemName);
  if (!entry) return err("noSource");
  const itemData = entry.data;
  if (!TRADE_TYPES.includes(itemData.type)) return err("untradeable");
  const costGp = Number(itemData.system?.cost ?? 0);
  if (!(costGp > 0)) return err("untradeable");

  // Masterwork needs the Judge's contact at this market (RR §IV.6).
  if (isMasterwork(itemData) && !location.system.market.goods.masterworkContact) return err("masterworkGated");

  const rows = getTable("availability", "equipmentAvailability").rows ?? [];
  const band = priceBandOf(costGp, rows);
  if (!band) return err("untradeable");
  const marketClass = effectiveMarketClass(location, buyer);
  if (marketClass == null) return err("noMarket");
  const cell = cellFor(band, marketClass);
  if (cell.kind === "none") return err("unavailable");

  const monthStart = marketMonthStart();
  const key = itemKeyOf(itemName);
  const party = partyOf(buyer);
  const goods = goodsOf(location);

  // Monthly rows: stale months prune on this write.
  goods.ledger = thisMonth(goods.ledger, monthStart);
  goods.existenceRolls = thisMonth(goods.existenceRolls, monthStart);
  goods.totals = thisMonth(goods.totals, monthStart);
  goods.partyMonths = thisMonth(goods.partyMonths, monthStart);

  const partyMonth = ensureRow(
    goods.partyMonths,
    (r) => r.partyId === party.id,
    { partyId: party.id, monthStartTime: monthStart, searchDays: 0, dedicated: false }
  );

  // The 12+-adventurer dedicated-shopping claim, checked against head-count.
  if (dedicated && !partyMonth.dedicated) {
    if (partySize(party.id) < 12) return err("partyTooSmall");
    partyMonth.dedicated = true;
  }

  const totalsRow = ensureRow(
    goods.totals,
    (r) => r.itemKey === key,
    { itemKey: key, band: band.band, monthStartTime: monthStart, bought: 0, sold: 0, pctStock: 0, pctStockRolled: false, pctStockDetail: "" }
  );
  const ledgerRow = ensureRow(
    goods.ledger,
    (r) => r.partyId === party.id && r.itemKey === key,
    { partyId: party.id, itemKey: key, band: band.band, monthStartTime: monthStart, bought: 0, sold: 0 }
  );

  // %-cells: the party's own find, then the market's tenfold stock — both
  // rolled once per month and cached so a re-ask can never re-roll.
  let existRow = null;
  if (cell.kind === "pct") {
    existRow = ensureRow(
      goods.existenceRolls,
      (r) => r.partyId === party.id && r.itemKey === key,
      { partyId: party.id, itemKey: key, monthStartTime: monthStart, exists: false, detail: "" }
    );
    if (!existRow.detail) {
      const roll = await d100();
      existRow.exists = roll <= cell.chance;
      existRow.detail = `d100 ${roll} vs ${cell.chance}%`;
    }
    if (!totalsRow.pctStockRolled) {
      const roll = await d100();
      const { stock, detail } = pctMarketStock(cell.chance, () => (roll - 1) / 100);
      totalsRow.pctStock = stock;
      totalsRow.pctStockRolled = true;
      totalsRow.pctStockDetail = detail;
    }
  }

  const room = remainingFor({
    cell,
    direction: "bought",
    ledgerRow,
    totalsRow,
    doubled: !!partyMonth.dedicated,
    extraSearchDays: Number(partyMonth.searchDays ?? 0),
    exists: !!existRow?.exists,
    pctStock: Number(totalsRow.pctStock ?? 0),
  });
  if (qty > room.remaining) {
    if (getSetting("marketsEnforceCaps")) return err("capExceeded", { remaining: room.remaining });
    ui?.notifications?.warn(game.i18n.format(`${LANG}.trade.capWaived`, { remaining: room.remaining }));
  }

  // Price: demand steps by category, Bargaining swing by winner.
  const partyRanks = abilityRanks(buyer, "Bargaining");
  let opposed = null;
  if (partyRanks > 0 && merchantRanks > 0) {
    opposed = await opposedBargain({ trader: buyer, partyRanks, merchantRanks, merchantCha });
  }
  const bargain = bargainWinner({ partyRanks, merchantRanks, opposedWinner: opposed?.winner ?? null });
  const priced = quote({
    costGp,
    direction: "buy",
    demandSteps: demandStepsFor(goods, categoryOf(itemData)),
    bargain,
  });
  const totalGp = toGp(priced.unitCp * qty);

  const paid = await adapter.spendGold(buyer, totalGp, game.i18n.format(`${LANG}.trade.buyReason`, { qty, name: itemData.name }));
  if (!paid) return err("insufficientGold");

  // Delivery. Stackables merge; unit items above one unit arrive as one
  // bundle document pointing at the source (core explodes it on drop when
  // the owner distributes).
  if (itemData.type === ITEM_TYPE.item) {
    const carried = buyer.items.find((i) => i.type === ITEM_TYPE.item && itemKeyOf(i.name) === key);
    if (carried) {
      await carried.update({ "system.quantity.value": Number(carried.system.quantity?.value ?? 0) + qty });
    } else {
      const data = foundry.utils.deepClone(itemData);
      foundry.utils.setProperty(data, "system.quantity.value", qty);
      await buyer.createEmbeddedDocuments("Item", [data]);
    }
  } else if (qty === 1) {
    await buyer.createEmbeddedDocuments("Item", [itemData]);
  } else {
    await buyer.createEmbeddedDocuments("Item", [
      {
        name: game.i18n.format(`${LANG}.trade.bundleName`, { name: itemData.name, qty }),
        type: ITEM_TYPE.bundle,
        img: itemData.img,
        system: {
          description: game.i18n.format(`${LANG}.trade.bundleDescription`, { qty, name: itemData.name, location: location.name }),
          itemList: [
            {
              id: itemData._id ?? foundry.utils.randomID(),
              uuid: entry.uuid,
              quantity: qty,
              name: itemData.name,
              img: itemData.img,
              type: itemData.type,
              inCompendium: entry.inCompendium,
            },
          ],
        },
      },
    ]);
  }

  ledgerRow.bought += qty;
  totalsRow.bought += qty;
  const stamp = resolutionId ? ` [${resolutionId}]` : "";
  const newLog = appendLog(log, {
    time: now(),
    type: "purchase",
    note: `${buyer.name}: ${qty}× ${itemData.name} @ ${toGp(priced.unitCp)}gp = ${totalGp}gp${stamp}`,
  });

  await location.update({
    "system.market.goods.ledger": goods.ledger,
    "system.market.goods.existenceRolls": goods.existenceRolls,
    "system.market.goods.totals": goods.totals,
    "system.market.goods.partyMonths": goods.partyMonths,
    "system.market.marketLog": newLog,
  });

  const lines = [
    `<strong>${game.i18n.format(`${LANG}.trade.boughtLine`, { buyer: buyer.name, qty, name: itemData.name, location: location.name })}</strong>`,
    ...priced.breakdown.map((b) => `${game.i18n.localize(`${LANG}.trade.stage.${b.label}`)}: ${toGp(b.cp)}gp`),
    opposed ? opposed.detail : null,
    existRow ? `${game.i18n.localize(`${LANG}.trade.existence`)}: ${existRow.detail}` : null,
    `<strong>${game.i18n.format(`${LANG}.trade.totalLine`, { total: totalGp })}</strong>`,
  ].filter(Boolean);
  await postReceipt({ location, trader: buyer, html: lines.join("<br>") });

  Hooks.callAll(HOOKS.PURCHASED, { location, buyer, itemName: itemData.name, qty, totalGp });
  return { ok: true, qty, unitGp: toGp(priced.unitCp), totalGp };
}

/**
 * Spend one further dedicated day searching the market (setting-gated house
 * extension recorded in DECISIONS): raises this party's per-item cap by one
 * base increment and grants a fresh existence roll on %-cells.
 */
export async function spendSearchDay(location, { actorUuid, requestUserId = null }) {
  if (!getSetting("marketsExtendedSearch")) return err("searchDisabled");
  if (!location?.system?.market?.goods) return err("noMarket");
  const traderDoc = await fromUuid(actorUuid).catch(() => null);
  const trader = traderDoc?.actor ?? traderDoc;
  if (!trader) return err("noBuyer");
  if (requestUserId) {
    const user = game.users.get(requestUserId);
    if (!user?.isGM && !trader.testUserPermission(user, "OWNER")) return err("notYours");
  }
  const monthStart = marketMonthStart();
  const party = partyOf(trader);
  const goods = goodsOf(location);
  goods.partyMonths = thisMonth(goods.partyMonths, monthStart);
  const partyMonth = ensureRow(
    goods.partyMonths,
    (r) => r.partyId === party.id,
    { partyId: party.id, monthStartTime: monthStart, searchDays: 0, dedicated: false }
  );
  partyMonth.searchDays += 1;
  // A fresh look at the shelves: clear the party's failed %-finds so the
  // next ask re-rolls (successes stay found).
  goods.existenceRolls = thisMonth(goods.existenceRolls, monthStart).filter(
    (r) => r.partyId !== party.id || r.exists
  );
  const log = (location.system.market.marketLog ?? []).map((r) => r.toObject?.() ?? foundry.utils.deepClone(r));
  const newLog = appendLog(log, {
    time: now(),
    type: "extraSearch",
    note: game.i18n.format(`${LANG}.trade.searchDayLog`, { party: party.name || party.id, days: partyMonth.searchDays }),
  });
  await location.update({
    "system.market.goods.partyMonths": goods.partyMonths,
    "system.market.goods.existenceRolls": goods.existenceRolls,
    "system.market.marketLog": newLog,
  });
  return { ok: true, days: partyMonth.searchDays };
}

/* ------------------------- socket relays ------------------------- */

registerHandler("marketsPurchase", async ({ locationUuid, ...payload }) => {
  const doc = await fromUuid(locationUuid).catch(() => null);
  const location = doc?.actor ?? doc;
  if (!location) return err("noMarket");
  return purchase(location, payload);
});

registerHandler("marketsSearchDay", async ({ locationUuid, ...payload }) => {
  const doc = await fromUuid(locationUuid).catch(() => null);
  const location = doc?.actor ?? doc;
  if (!location) return err("noMarket");
  return spendSearchDay(location, payload);
});

/** Local-first dispatch: write directly when this seat can, else relay. */
export async function performPurchase(location, payload) {
  const canLocal =
    game.user.isGM ||
    (location.testUserPermission(game.user, "OWNER") &&
      (await fromUuid(payload.buyerUuid).catch(() => null))?.testUserPermission?.(game.user, "OWNER"));
  if (canLocal) return purchase(location, { ...payload, requestUserId: game.user.isGM ? null : game.user.id });
  return executeAsGM("marketsPurchase", { locationUuid: location.uuid, ...payload, requestUserId: game.user.id });
}

/** Local-first dispatch for the extended-search day. */
export async function performSearchDay(location, payload) {
  const canLocal = game.user.isGM || location.testUserPermission(game.user, "OWNER");
  if (canLocal) return spendSearchDay(location, { ...payload, requestUserId: game.user.isGM ? null : game.user.id });
  return executeAsGM("marketsSearchDay", { locationUuid: location.uuid, ...payload, requestUserId: game.user.id });
}
