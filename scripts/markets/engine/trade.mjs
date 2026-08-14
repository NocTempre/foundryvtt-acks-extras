/* global game, ui, foundry, Hooks, ChatMessage, Roll, fromUuid */
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
import { quote, magicQuote, magicBandValueGp, bargainWinner, toGp } from "../rules/pricing.mjs";
import { registerHandler, executeAsGM } from "../../lib/sockets.mjs";
import { ITEM_TYPE, slug } from "../../lib/vocab.mjs";
import { getTable, optTable } from "../../henchmen/rules/tables.mjs";
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
export function goodsOf(location) {
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
  const rows = bandRowsFor(false);
  if (!rows) return { status: "tablesMissing" };
  const band = priceBandOf(costGp, rows);
  if (!band) return { status: "untradeable" };
  const trueClass = location.system.marketClass;
  const marketClass = trader ? effectiveMarketClass(location, trader) : trueClass;
  if (marketClass == null) return { status: "noMarket" };
  const cell = cellFor(band, marketClass);
  const marketCell = cellFor(band, trueClass ?? marketClass);
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
    marketCell,
    direction,
    ledgerRow,
    totalsRow,
    doubled: !!partyMonth?.dedicated,
    extraSearchDays: Number(partyMonth?.searchDays ?? 0),
    exists: cell.kind === "qty" ? marketCell.kind !== "qty" : !!existRow?.exists,
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

  // A magic item buys as Tower stock (JJ ch.4): banded by base cost on the
  // transaction grid, priced at 225% of base, no demand or Bargaining.
  const mflag = marketsFlag(itemData);
  const magic = !!mflag.magic;
  const magicBaseGp = magic ? Number(mflag.baseCostGp ?? costGp) : 0;
  const goods = goodsOf(location);
  const monthState = await resolveMonthlyAvailability(location, goods, {
    itemData,
    bandValueGp: magic ? magicBaseGp : costGp,
    magic,
    trader: buyer,
    direction: "bought",
    claimDedicated: dedicated,
  });
  if (monthState.error) return monthState;
  const { existRow, ledgerRow, totalsRow, room } = monthState;
  if (qty > room.remaining) {
    if (getSetting("marketsEnforceCaps")) return err("capExceeded", { remaining: room.remaining });
    ui?.notifications?.warn(game.i18n.format(`${LANG}.trade.capWaived`, { remaining: room.remaining }));
  }

  // Price: demand steps by category and the Bargaining swing — or, for a
  // magic item, the flat 225%-of-base Tower premium.
  const partyRanks = abilityRanks(buyer, "Bargaining");
  let opposed = null;
  if (!magic && partyRanks > 0 && merchantRanks > 0) {
    opposed = await opposedBargain({ trader: buyer, partyRanks, merchantRanks, merchantCha });
  }
  const bargain = magic ? null : bargainWinner({ partyRanks, merchantRanks, opposedWinner: opposed?.winner ?? null });
  const priced = magic
    ? (() => {
        const m = magicQuote({ baseCostGp: magicBaseGp, identified: "full", direction: "buy" });
        return { unitCp: m.unitCp, breakdown: [{ label: m.basis, cp: m.unitCp }] };
      })()
    : quote({
        costGp,
        direction: "buy",
        demandSteps: demandStepsFor(goods, categoryOf(itemData)),
        bargain,
      });
  const totalGp = toGp(priced.unitCp * qty);

  const paid = await adapter.spendGold(buyer, totalGp, game.i18n.format(`${LANG}.trade.buyReason`, { qty, name: itemData.name }));
  if (!paid) return err("insufficientGold");

  await deliverGoods(buyer, { entry, qty, locationName: location.name });

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
 * Hand purchased goods to their buyer. Stackables merge into the buyer's
 * existing stack; a multi-unit purchase of unit items (thirty swords)
 * arrives as ONE bundle document pointing at the source — core explodes it
 * on drop when the owner distributes.
 */
export async function deliverGoods(buyer, { entry, qty, locationName = "" }) {
  const itemData = entry.data;
  const key = itemKeyOf(itemData.name);
  if (itemData.type === ITEM_TYPE.item) {
    const carried = buyer.items.find((i) => i.type === ITEM_TYPE.item && itemKeyOf(i.name) === key);
    if (carried) {
      await carried.update({ "system.quantity.value": Number(carried.system.quantity?.value ?? 0) + qty });
    } else {
      const data = foundry.utils.deepClone(itemData);
      foundry.utils.setProperty(data, "system.quantity.value", qty);
      await buyer.createEmbeddedDocuments("Item", [data]);
    }
    return;
  }
  if (qty === 1) {
    await buyer.createEmbeddedDocuments("Item", [itemData]);
    return;
  }
  await buyer.createEmbeddedDocuments("Item", [
    {
      name: game.i18n.format(`${LANG}.trade.bundleName`, { name: itemData.name, qty }),
      type: ITEM_TYPE.bundle,
      img: itemData.img,
      system: {
        description: game.i18n.format(`${LANG}.trade.bundleDescription`, { qty, name: itemData.name, location: locationName }),
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


/**
 * Resolve one item's monthly market state — band, party/market cells at
 * effective vs true class, this month's rows (stale months pruned), the
 * cached %-rolls (party find first, then the town's stock), and the room
 * left in `direction`. Shared by purchases, sales, and directed searches;
 * mutates `goods` in place so the caller's write persists what was rolled.
 */
export async function resolveMonthlyAvailability(location, goods, { itemData, bandValueGp, magic = false, trader, direction, claimDedicated = false }) {
  const rows = bandRowsFor(magic);
  if (!rows) return err("tablesMissing");
  const band = priceBandOf(bandValueGp, rows);
  if (!band) return err("untradeable");
  // The party reads its cell at its EFFECTIVE class (mercantile networks);
  // the market total stays the town's TRUE class — a bigger share, not a
  // bigger market.
  const trueClass = location.system.marketClass;
  const marketClass = effectiveMarketClass(location, trader);
  if (marketClass == null) return err("noMarket");
  const cell = cellFor(band, marketClass);
  const marketCell = cellFor(band, trueClass ?? marketClass);
  if (cell.kind === "none") return err("unavailable");

  const monthStart = marketMonthStart();
  const key = itemKeyOf(itemData.name);
  const party = partyOf(trader);

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
  if (claimDedicated && !partyMonth.dedicated) {
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

  // %-cells: the party's own find (effective class), then the market's
  // tenfold stock (true class) — both rolled once per month and cached so a
  // re-ask can never re-roll.
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
  }
  if (marketCell.kind === "pct" && !totalsRow.pctStockRolled) {
    // Party roll first (above): it floors the stock, and when the floor
    // already decides the answer no market roll is spent.
    const partyFound = !!existRow?.exists;
    let plan = pctMarketStock(marketCell.chance, { partyFound });
    if (!plan) plan = pctMarketStock(marketCell.chance, { partyFound, d100: await d100() });
    totalsRow.pctStock = plan.stock;
    totalsRow.pctStockRolled = true;
    totalsRow.pctStockDetail = plan.detail;
  }

  const room = remainingFor({
    cell,
    marketCell,
    direction,
    ledgerRow,
    totalsRow,
    doubled: !!partyMonth.dedicated,
    extraSearchDays: Number(partyMonth.searchDays ?? 0),
    exists: cell.kind === "qty" ? marketCell.kind !== "qty" : !!existRow?.exists,
    pctStock: Number(totalsRow.pctStock ?? 0),
  });
  return { band, cell, marketCell, monthStart, key, party, partyMonth, totalsRow, ledgerRow, existRow, room };
}

/** The markets flag bag on an item ({magic, apparentValueGp, identified…}). */
const marketsFlag = (itemData) => itemData?.flags?.[MODULE_ID]?.[ITEM_FLAG] ?? {};

/**
 * Sale pricing and band placement for one owned item. Mundane gear sells at
 * its condition-reduced value (the reduced value also picks its availability
 * band, RR §IV.7) with demand and Bargaining applied; a magic item trades by
 * identification — apparent value short of full identification, base cost
 * (twice if self-made) at full — on the JJ transaction grid, which prints
 * the equipment availability cells and substitutes for them when a world
 * has not imported it separately.
 */
export function salePlan(itemData, { demandSteps = 0, bargain = null } = {}) {
  const costGp = Number(itemData.system?.cost ?? 0);
  const flag = marketsFlag(itemData);
  if (flag.magic) {
    const m = magicQuote({
      baseCostGp: flag.baseCostGp ?? costGp,
      apparentValueGp: flag.apparentValueGp ?? 0,
      identified: flag.identified ?? "none",
      selfMade: !!flag.selfMade,
      direction: "sell",
    });
    return {
      unitCp: m.unitCp,
      basis: m.basis,
      bandValueGp: magicBandValueGp({ baseCostGp: flag.baseCostGp ?? costGp, apparentValueGp: flag.apparentValueGp ?? 0, identified: flag.identified ?? "none" }),
      magic: true,
      breakdown: [{ label: m.basis, cp: m.unitCp }],
    };
  }
  const valueMult = Number(itemData.flags?.[MODULE_ID]?.scavenged?.valueMultiplier ?? 1) || 1;
  const priced = quote({ costGp, direction: "sell", valueMult, demandSteps, bargain });
  return { unitCp: priced.unitCp, basis: "base", bandValueGp: costGp * valueMult, magic: false, breakdown: priced.breakdown };
}

/**
 * The availability grid a trade prices volume on, or null when the world
 * has not imported it — a market without its tables must degrade to a
 * message, never break the sheet.
 */
function bandRowsFor(magic) {
  if (magic) {
    const t = optTable("magicItems", "transactionsByMarketClass");
    if (t?.rows?.length) return t.rows;
  }
  const rows = optTable("availability", "equipmentAvailability")?.rows;
  return rows?.length ? rows : null;
}

/**
 * The atomic sale: same monthly cells as buying, charged to the independent
 * `sold` counters. The sold document is DESTROYED — a quantity stack
 * decrements, anything else leaves play (user ruling; the JJ removes items
 * sold to the Tower from play).
 */
export async function sell(location, payload) {
  const {
    sellerUuid,
    itemId,
    qty: rawQty,
    merchantRanks = 0,
    merchantCha = 1,
    requestUserId = null,
    resolutionId = "",
  } = payload;

  const sellerDoc = await fromUuid(sellerUuid).catch(() => null);
  const seller = sellerDoc?.actor ?? sellerDoc;
  if (!seller) return err("noBuyer");
  if (!location?.system?.market?.goods) return err("noMarket");
  if (requestUserId) {
    const user = game.users.get(requestUserId);
    if (!user?.isGM && !seller.testUserPermission(user, "OWNER")) return err("notYours");
  }
  const item = seller.items.get(itemId);
  if (!item) return err("noItem");
  const itemData = item.toObject();
  if (![ITEM_TYPE.weapon, ITEM_TYPE.armor, ITEM_TYPE.item].includes(itemData.type)) return err("untradeable");
  // Merchandise loads trade as stones through the venture engine, never here.
  if (marketsFlag(itemData).merchandise) return err("untradeable");

  const log = (location.system.market.marketLog ?? []).map((r) => r.toObject?.() ?? foundry.utils.deepClone(r));
  if (resolutionId && log.some((l) => l.note?.includes(resolutionId))) return err("duplicate");

  const stackable = itemData.type === ITEM_TYPE.item;
  const carried = stackable ? Number(itemData.system?.quantity?.value ?? 1) : 1;
  const qty = Math.min(Math.max(1, Math.floor(Number(rawQty) || 1)), Math.max(1, carried));

  // Price first (the plan also names the band value), then availability.
  const goods = goodsOf(location);
  const partyRanks = abilityRanks(seller, "Bargaining");
  const flag = marketsFlag(itemData);
  let opposed = null;
  if (!flag.magic && partyRanks > 0 && merchantRanks > 0) {
    opposed = await opposedBargain({ trader: seller, partyRanks, merchantRanks, merchantCha });
  }
  const bargain = flag.magic ? null : bargainWinner({ partyRanks, merchantRanks, opposedWinner: opposed?.winner ?? null });
  const plan = salePlan(itemData, { demandSteps: demandStepsFor(goods, categoryOf(itemData)), bargain });
  if (!(plan.unitCp > 0) || !(plan.bandValueGp > 0)) return err("untradeable");

  const monthState = await resolveMonthlyAvailability(location, goods, {
    itemData,
    bandValueGp: plan.bandValueGp,
    magic: plan.magic,
    trader: seller,
    direction: "sold",
  });
  if (monthState.error) return monthState;
  const { existRow, ledgerRow, totalsRow, room } = monthState;
  if (qty > room.remaining) {
    if (getSetting("marketsEnforceCaps")) return err("capExceeded", { remaining: room.remaining });
    ui?.notifications?.warn(game.i18n.format(`${LANG}.trade.capWaived`, { remaining: room.remaining }));
  }

  const totalGp = toGp(plan.unitCp * qty);
  await adapter.grantGold(seller, totalGp);

  // The sold goods leave play.
  if (stackable && carried > qty) {
    await item.update({ "system.quantity.value": carried - qty });
  } else {
    await item.delete();
  }

  ledgerRow.sold += qty;
  totalsRow.sold += qty;
  const stamp = resolutionId ? ` [${resolutionId}]` : "";
  const newLog = appendLog(log, {
    time: now(),
    type: "sale",
    note: `${seller.name}: sold ${qty}× ${itemData.name} @ ${toGp(plan.unitCp)}gp = ${totalGp}gp${stamp}`,
  });
  await location.update({
    "system.market.goods.ledger": goods.ledger,
    "system.market.goods.existenceRolls": goods.existenceRolls,
    "system.market.goods.totals": goods.totals,
    "system.market.goods.partyMonths": goods.partyMonths,
    "system.market.marketLog": newLog,
  });

  const lines = [
    `<strong>${game.i18n.format(`${LANG}.trade.soldLine`, { seller: seller.name, qty, name: itemData.name, location: location.name })}</strong>`,
    ...plan.breakdown.map((b) => `${game.i18n.localize(`${LANG}.trade.stage.${b.label}`)}: ${toGp(b.cp)}gp`),
    opposed ? opposed.detail : null,
    existRow ? `${game.i18n.localize(`${LANG}.trade.existence`)}: ${existRow.detail}` : null,
    `<strong>${game.i18n.format(`${LANG}.trade.earnedLine`, { total: totalGp })}</strong>`,
  ].filter(Boolean);
  await postReceipt({ location, trader: seller, html: lines.join("<br>") });

  Hooks.callAll(HOOKS.SOLD, { location, seller, itemName: itemData.name, qty, totalGp });
  return { ok: true, qty, unitGp: toGp(plan.unitCp), totalGp };
}

/**
 * Post one further dedicated day of searching the market (RR §VIII.6:
 * soliciting is a dedicated activity repeatable each day, setting-gated
 * here). Like every dedicated day it POSTS now and RESOLVES when its day
 * has passed — the due-work sweep then raises the party's per-item cap by
 * one base increment and takes a fresh look for scarce goods.
 */
export async function postSearchDay(location, { actorUuid, requestUserId = null, resolutionId = "" }) {
  if (!getSetting("marketsExtendedSearch")) return err("searchDisabled");
  if (!location?.system?.market?.goods) return err("noMarket");
  const traderDoc = await fromUuid(actorUuid).catch(() => null);
  const trader = traderDoc?.actor ?? traderDoc;
  if (!trader) return err("noBuyer");
  if (requestUserId) {
    const user = game.users.get(requestUserId);
    if (!user?.isGM && !trader.testUserPermission(user, "OWNER")) return err("notYours");
  }
  const goods = location.system.market.goods;
  const actions = (goods.actions ?? []).map((r) => r.toObject?.() ?? foundry.utils.deepClone(r));
  if (resolutionId && actions.some((a) => a.id === resolutionId)) return err("duplicate");
  const t = now();
  const party = partyOf(trader);
  actions.push({
    id: resolutionId || foundry.utils.randomID(),
    kind: "extraSearch",
    partyId: party.id,
    actorUuid: trader.uuid,
    category: "",
    cargoSt: 0,
    postedTime: t,
    resolveTime: t + 86400,
    status: "pending",
    detail: "",
  });
  const log = (location.system.market.marketLog ?? []).map((r) => r.toObject?.() ?? foundry.utils.deepClone(r));
  const newLog = appendLog(log, { time: t, type: "extraSearch", note: `${trader.name}: extended search day posted` });
  await location.update({ "system.market.goods.actions": actions, "system.market.marketLog": newLog });
  return { ok: true, resolveTime: t + 86400 };
}

/**
 * Resolve due extended-search days (called FIRST in the due-work sweep, as
 * its own write, so the rest of the sweep reads the raised caps). Each one
 * adds a base increment to the party's month and clears its failed %-finds
 * so the next ask re-rolls — successes stay found.
 */
export async function resolveSearchDayActions(location, t = now()) {
  const goodsRaw = location.system.market?.goods;
  if (!goodsRaw) return 0;
  const actions = (goodsRaw.actions ?? []).map((r) => r.toObject?.() ?? foundry.utils.deepClone(r));
  const due = actions.filter((a) => a.kind === "extraSearch" && a.status === "pending" && Number(a.resolveTime) <= t);
  if (!due.length) return 0;
  const monthStart = marketMonthStart(t);
  const goods = goodsOf(location);
  goods.partyMonths = thisMonth(goods.partyMonths, monthStart);
  goods.existenceRolls = thisMonth(goods.existenceRolls, monthStart);
  const log = (location.system.market.marketLog ?? []).map((r) => r.toObject?.() ?? foundry.utils.deepClone(r));
  for (const action of due) {
    action.status = "done";
    const partyMonth = ensureRow(
      goods.partyMonths,
      (r) => r.partyId === action.partyId,
      { partyId: action.partyId, monthStartTime: monthStart, searchDays: 0, dedicated: false }
    );
    partyMonth.searchDays += 1;
    goods.existenceRolls = goods.existenceRolls.filter((r) => r.partyId !== action.partyId || r.exists);
    log.push({ time: t, type: "extraSearch", note: game.i18n.format(`${LANG}.trade.searchDayLog`, { party: action.partyId, days: partyMonth.searchDays }) });
    const traderDoc = await fromUuid(action.actorUuid).catch(() => null);
    const trader = traderDoc?.actor ?? traderDoc;
    if (trader) {
      await postReceipt({ location, trader, html: `<strong>${game.i18n.format(`${LANG}.trade.searchDayDone`, { name: trader.name, days: partyMonth.searchDays })}</strong>` });
    }
  }
  await location.update({
    "system.market.goods.actions": actions,
    "system.market.goods.partyMonths": goods.partyMonths,
    "system.market.goods.existenceRolls": goods.existenceRolls,
    "system.market.marketLog": log.slice(-300),
  });
  return due.length;
}

/* ------------------------- socket relays ------------------------- */

registerHandler("marketsPurchase", async ({ locationUuid, ...payload }) => {
  const doc = await fromUuid(locationUuid).catch(() => null);
  const location = doc?.actor ?? doc;
  if (!location) return err("noMarket");
  return purchase(location, payload);
});

registerHandler("marketsSale", async ({ locationUuid, ...payload }) => {
  const doc = await fromUuid(locationUuid).catch(() => null);
  const location = doc?.actor ?? doc;
  if (!location) return err("noMarket");
  return sell(location, payload);
});

registerHandler("marketsSearchDay", async ({ locationUuid, ...payload }) => {
  const doc = await fromUuid(locationUuid).catch(() => null);
  const location = doc?.actor ?? doc;
  if (!location) return err("noMarket");
  return postSearchDay(location, payload);
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

/** Local-first dispatch for a sale. */
export async function performSell(location, payload) {
  const canLocal =
    game.user.isGM ||
    (location.testUserPermission(game.user, "OWNER") &&
      (await fromUuid(payload.sellerUuid).catch(() => null))?.testUserPermission?.(game.user, "OWNER"));
  if (canLocal) return sell(location, { ...payload, requestUserId: game.user.isGM ? null : game.user.id });
  return executeAsGM("marketsSale", { locationUuid: location.uuid, ...payload, requestUserId: game.user.id });
}

/** Local-first dispatch for the extended-search day. */
export async function performSearchDay(location, payload) {
  const canLocal = game.user.isGM || location.testUserPermission(game.user, "OWNER");
  if (canLocal) return postSearchDay(location, { ...payload, requestUserId: game.user.isGM ? null : game.user.id });
  return executeAsGM("marketsSearchDay", { locationUuid: location.uuid, ...payload, requestUserId: game.user.id });
}
