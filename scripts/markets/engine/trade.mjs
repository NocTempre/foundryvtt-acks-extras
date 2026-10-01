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
import { trueDemand } from "../rules/demand.mjs";
import { marketsFlagOf, isMasterwork, isTemplateCopy, magicBasisOf, capVerdict } from "../rules/goods.mjs";
import { registerHandler, executeAsGM } from "../../lib/sockets.mjs";
import { ITEM_TYPE, slug } from "../../lib/vocab.mjs";
import { judgesAndOwners, gmIds } from "../../lib/util.mjs";
import { ownerOf } from "../../lib/storage.mjs";
import { getTable, optTable } from "../../henchmen/rules/tables.mjs";
import { now, calendarMonthStart, secondsPerMonth } from "../../henchmen/time.mjs";
import * as adapter from "../../henchmen/acks-adapter.mjs";
import { effectiveMarketClass } from "../../henchmen/engine/recruitment.mjs";
import { findGearEntry } from "../../equipment/grant.mjs";
import { deliverItems } from "../../lib/bundles.mjs";
import { goodsForRow } from "../../lib/bundles-logic.mjs";
import { quantityOf } from "../../lib/storage-logic.mjs";
import { partyOf, partySize } from "./parties.mjs";
import { marketRules, bargaining, magicPrices, stepFractionFor, printedError } from "./printed.mjs";

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
    demandOverrides: arr(goods?.demandOverrides),
    demandDerived: arr(goods?.demandDerived),
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

/** Masterwork gear is Judge-gated (RR §IV.6); the rule reads in `rules/goods.mjs`. */
export { isMasterwork };

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

/** Signed demand steps for a category on this market (0 when unset): its true demand. */
export function demandStepsFor(goods, category) {
  return trueDemand(goods, category);
}

/**
 * The unit price of buying one item: the printed Tower price for a magic
 * item, else base cost with the category's demand steps and the Bargaining
 * swing (`bargain` names the winner). A price whose printed figures are not
 * imported comes back `{error: "printedMissing", table}`; nothing is guessed.
 *
 * @param {object} o
 * @param {object} o.itemData - the item's plain data (its category prices demand)
 * @param {number} o.costGp - the item's cost
 * @param {boolean} o.magic - whether it trades as magic stock
 * @param {number} o.magicBaseGp - base cost of a magic item
 * @param {object} o.goods - the market's goods (its demand layers, read by `trueDemand`)
 * @param {"party"|"merchant"|null} [o.bargain]
 * @returns {{unitCp:number, breakdown:{label:string, cp:number}[]}|{error:string, table:string}}
 */
export function buyQuote({ itemData, costGp, magic, magicBaseGp, goods, bargain = null }) {
  if (magic) {
    const prices = magicPrices(["buyPct"]);
    if (!prices) return printedError("priceProse");
    const m = magicQuote({ baseCostGp: magicBaseGp, identified: "full", direction: "buy", buyPct: prices.buyPct });
    return { unitCp: m.unitCp, breakdown: [{ label: m.basis, cp: m.unitCp }] };
  }
  const swing = bargain ? bargaining() : null;
  if (bargain && !swing) return printedError("bargainingProse");
  const category = categoryOf(itemData);
  return quote({
    costGp,
    direction: "buy",
    demandSteps: demandStepsFor(goods, category),
    stepFraction: stepFractionFor(category),
    bargain,
    bargainPct: swing ? { buy: swing.buyPct, sell: swing.sellPct } : null,
  });
}

const d100 = async () => (await new Roll("1d100").evaluate()).total;

/**
 * Opposed Bargaining reaction rolls (2d6 + CHA + the printed per-rank bonus
 * for each side's ranks); higher takes the discount, a tie moves nothing.
 * Natural extremes need no special floors here — only the comparison matters.
 */
async function opposedBargain({ trader, partyRanks, merchantRanks, merchantCha, rankBonus }) {
  const mine = (await new Roll("2d6").evaluate()).total + adapter.getChaMod(trader) + rankBonus * partyRanks;
  const theirs = (await new Roll("2d6").evaluate()).total + Number(merchantCha ?? 0) + rankBonus * merchantRanks;
  const winner = mine > theirs ? "party" : theirs > mine ? "merchant" : null;
  return { winner, detail: `opposed Bargaining ${mine} vs ${theirs}` };
}

/** Whispered trade receipt to the GM and the trader's owners. */
async function postReceipt({ location, trader, html }) {
  const whisper = judgesAndOwners(trader);
  await ChatMessage.create({
    content: `<div class="acks-extras-markets-receipt">${html}</div>`,
    whisper,
    speaker: ChatMessage.getSpeaker({ actor: trader }),
  });
}

/** A whisper for the GM alone: roll records and diagnostics a receipt must not carry. */
async function postGmNote({ trader, html }) {
  await ChatMessage.create({
    content: `<div class="acks-extras-markets-receipt">${html}</div>`,
    whisper: gmIds(),
    speaker: ChatMessage.getSpeaker({ actor: trader }),
  });
}

/** The GM-only lines behind a receipt: the scarce-goods roll record and the grid-fallback note. */
const gmDetailLines = ({ existRow, gridFallback }) =>
  [
    existRow ? `${game.i18n.localize(`${LANG}.trade.existence`)}: ${existRow.detail}` : null,
    gridFallback ? game.i18n.localize(`${LANG}.trade.gridFallbackNote`) : null,
  ].filter(Boolean);

/** Append a market-log line, capped to the recent past. */
function appendLog(logRows, entry) {
  logRows.push(entry);
  return logRows.slice(-300);
}

const err = (error, data = {}) => ({ error, ...data });

/**
 * Availability snapshot for one named item, for display and for the
 * pre-purchase check. Read-only: unrolled %-cells report `pending` rather
 * than rolling. A magic item passes `magic` and the value that picks its band
 * as `magicBaseGp` (base cost when buying, apparent-or-base value when selling,
 * as `salePlan` reports it); it reads the magic grid, and the result carries
 * `gridFallback` when only the equipment grid was available.
 */
export function availabilityFor(location, { itemName, costGp, trader = null, direction = "bought", magic = false, magicBaseGp = null }) {
  const goods = location.system.market?.goods;
  if (!goods) return { status: "noMarket" };
  const grid = bandGridFor(magic);
  const rules = marketRules(["marketTotalMultiplier"]);
  if (!grid || !rules) return { status: "tablesMissing" };
  const tag = (result) => (grid.fallback ? { ...result, gridFallback: true } : result);
  const band = priceBandOf(magic ? magicBaseGp ?? costGp : costGp, grid.rows);
  if (!band) return tag({ status: "untradeable" });
  const trueClass = location.system.marketClass;
  const marketClass = trader ? effectiveMarketClass(location, trader) : trueClass;
  if (marketClass == null) return { status: "noMarket" };
  const cell = cellFor(band, marketClass);
  const marketCell = cellFor(band, trueClass ?? marketClass);
  if (cell.kind === "none") return tag({ status: "unavailable", band: band.band });

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
  if (cell.kind === "pct" && !existRow) return tag({ status: "pending", band: band.band, chance: cell.chance });

  // A party that claimed the dedicated-shopping month reads its printed multiple.
  const crowd = partyMonth?.dedicated ? marketRules(["crowdMultiplier"]) : null;
  if (partyMonth?.dedicated && !crowd) return { status: "tablesMissing" };

  const { remaining, capParty, capMarket } = remainingFor({
    cell,
    marketCell,
    direction,
    ledgerRow,
    totalsRow,
    doubled: !!partyMonth?.dedicated,
    crowdMultiplier: crowd?.crowdMultiplier,
    marketTotalMultiplier: rules.marketTotalMultiplier,
    extraSearchDays: Number(partyMonth?.searchDays ?? 0),
    exists: cell.kind === "qty" ? marketCell.kind !== "qty" : !!existRow?.exists,
    pctStock: Number(totalsRow?.pctStock ?? 0),
  });
  return tag({ status: remaining > 0 ? "available" : "exhausted", band: band.band, remaining, capParty, capMarket });
}

/**
 * The purchasable catalog: every distinct tradeable item this world knows —
 * world items first (a Judge's customisation wins), then every Item
 * compendium — priced above zero, masterwork gated behind the market's
 * contact, class-template copies (starting-kit skins) left to their base.
 * One row per distinct item key, the identity the ledger caps on.
 * Every row says whether it trades as magic stock (`magic`, with the
 * `magicBaseGp` its band and price read; 0 when mundane). The market's own
 * holdings follow: each magic item a sale left embedded on the location is a
 * row of its own (`held`, `heldItemId`, `heldQty`), bought by moving that
 * item rather than copying a source.
 */
export async function buildCatalog(location) {
  const contact = !!location.system.market?.goods?.masterworkContact;
  const byKey = new Map();
  const rowOf = (data, costGp, extra = {}) => {
    const { magic, baseGp } = magicBasisOf(data);
    return {
      key: itemKeyOf(data.name),
      name: data.name,
      img: data.img,
      type: data.type,
      costGp,
      system: { cost: costGp, subtype: data.system?.subtype },
      flags: data.flags ?? {},
      magic,
      magicBaseGp: baseGp,
      ...extra,
    };
  };
  const tradeable = (data) => {
    if (!TRADE_TYPES.includes(data.type) || data.type === ITEM_TYPE.bundle) return 0;
    const costGp = Number(data.system?.cost ?? 0);
    if (!(costGp > 0)) return 0;
    if (isMasterwork(data) && !contact) return 0;
    return costGp;
  };
  const consider = (data) => {
    if (isTemplateCopy(data)) return;
    const costGp = tradeable(data);
    if (!costGp) return;
    const key = itemKeyOf(data.name);
    if (byKey.has(key)) return;
    byKey.set(key, rowOf(data, costGp));
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
  const held = [];
  for (const item of location.items ?? []) {
    if (ownerOf(item)) continue; // stored for a character: never the market's to sell
    const data = item.toObject();
    if (!magicBasisOf(data).magic) continue;
    const costGp = tradeable(data);
    if (!costGp) continue;
    held.push(rowOf(data, costGp, { held: true, heldItemId: item.id, heldQty: quantityOf(data)?.value ?? 1 }));
  }
  return [...byKey.values(), ...held].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The atomic purchase. Runs on a seat that can write the location AND the
 * buyer (players hold OWNER on both by default); other seats relay via the
 * "marketsPurchase" socket. Delivery is `deliverGoods`: quantity-bearing items
 * merge into the buyer's existing stack, unit items arrive one copy per unit.
 * A `heldItemId` payload buys one of the market's own holdings (a magic item a
 * sale left on the location): the embedded item MOVES to the buyer, priced as
 * magic stock and outside the monthly grid — it is a physical thing on the
 * shelf, not a roll of the market.
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
    heldItemId = null,
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

  // A held row names an item already on the location: it must still be there
  // and never a character's stored goods.
  const held = heldItemId ? location.items.get(heldItemId) ?? null : null;
  if (heldItemId && (!held || ownerOf(held) || !magicBasisOf(held.toObject()).magic)) return err("heldGone");
  const entry = held ? { data: held.toObject(), uuid: held.uuid, inCompendium: false } : await findGearEntry(itemName);
  if (!entry) return err("noSource");
  const itemData = entry.data;
  if (!TRADE_TYPES.includes(itemData.type)) return err("untradeable");
  const costGp = Number(itemData.system?.cost ?? 0);
  if (!(costGp > 0)) return err("untradeable");
  const heldQty = held ? quantityOf(itemData)?.value ?? 1 : Infinity;
  if (qty > heldQty) return err("heldShort", { remaining: heldQty });

  // Masterwork needs the Judge's contact at this market (RR §IV.6).
  if (isMasterwork(itemData) && !location.system.market.goods.masterworkContact) return err("masterworkGated");

  // A magic item buys as Tower stock (JJ ch.4): banded by base cost on the
  // transaction grid, priced at the printed share of base, no demand or Bargaining.
  const { magic, baseGp: magicBaseGp } = magicBasisOf(itemData);
  const goods = goodsOf(location);
  let monthState = null;
  if (!held) {
    monthState = await resolveMonthlyAvailability(location, goods, {
      itemData,
      bandValueGp: magic ? magicBaseGp : costGp,
      magic,
      trader: buyer,
      direction: "bought",
      claimDedicated: dedicated,
    });
    if (monthState.error) return monthState;
    const { remaining } = monthState.room;
    const verdict = capVerdict({ qty, remaining, enforce: !!getSetting("marketsEnforceCaps") });
    if (verdict === "exceeded") return err("capExceeded", { remaining });
    if (verdict === "waived") ui?.notifications?.warn(game.i18n.format(`${LANG}.trade.capWaived`, { remaining }));
  }

  // Price: demand steps by category and the Bargaining swing — or, for a
  // magic item, the flat Tower price.
  const partyRanks = abilityRanks(buyer, "Bargaining");
  const swing = !magic && (partyRanks > 0 || merchantRanks > 0) ? bargaining() : null;
  if (!magic && (partyRanks > 0 || merchantRanks > 0) && !swing) return printedError("bargainingProse");
  let opposed = null;
  if (swing && partyRanks > 0 && merchantRanks > 0) {
    opposed = await opposedBargain({ trader: buyer, partyRanks, merchantRanks, merchantCha, rankBonus: swing.rankBonus });
  }
  const bargain = magic ? null : bargainWinner({ partyRanks, merchantRanks, opposedWinner: opposed?.winner ?? null });
  const priced = buyQuote({ itemData, costGp, magic, magicBaseGp, goods, bargain });
  if (priced.error) return priced;
  const totalGp = toGp(priced.unitCp * qty);

  // A purchase is paid at this market: with coin on hand, or coin it keeps.
  const paid = await adapter.spendGold(buyer, totalGp, game.i18n.format(`${LANG}.trade.buyReason`, { qty, name: itemData.name }), { to: location, at: location, within: location });
  if (!paid) return err("insufficientGold");

  await deliverGoods(buyer, { entry, qty });
  if (held) await takeHeld(held, qty);
  else {
    monthState.ledgerRow.bought += qty;
    monthState.totalsRow.bought += qty;
  }
  const stamp = resolutionId ? ` [${resolutionId}]` : "";
  const newLog = appendLog(log, {
    time: now(),
    type: "purchase",
    note: `${buyer.name}: ${qty}× ${itemData.name} @ ${toGp(priced.unitCp)}gp = ${totalGp}gp${stamp}`,
    actorUuid: buyer.uuid,
    gp: -totalGp,
  });

  await location.update(
    held
      ? { "system.market.marketLog": newLog }
      : {
          "system.market.goods.ledger": goods.ledger,
          "system.market.goods.existenceRolls": goods.existenceRolls,
          "system.market.goods.totals": goods.totals,
          "system.market.goods.partyMonths": goods.partyMonths,
          "system.market.marketLog": newLog,
        }
  );

  // The receipt reaches the buyer's owners, so it carries prices only; the
  // scarce-goods roll record and any grid diagnostic go to the GM alone.
  const lines = [
    `<strong>${game.i18n.format(`${LANG}.trade.boughtLine`, { buyer: buyer.name, qty, name: itemData.name, location: location.name })}</strong>`,
    ...priced.breakdown.map((b) => `${game.i18n.localize(`${LANG}.trade.stage.${b.label}`)}: ${toGp(b.cp)}gp`),
    opposed ? opposed.detail : null,
    `<strong>${game.i18n.format(`${LANG}.trade.totalLine`, { total: totalGp })}</strong>`,
  ].filter(Boolean);
  await postReceipt({ location, trader: buyer, html: lines.join("<br>") });
  const gridFallback = !!monthState?.gridFallback;
  const gmLines = gmDetailLines({ existRow: monthState?.existRow, gridFallback });
  if (gmLines.length) await postGmNote({ trader: buyer, html: gmLines.join("<br>") });

  Hooks.callAll(HOOKS.PURCHASED, { location, buyer, itemName: itemData.name, qty, totalGp });
  return { ok: true, qty, unitGp: toGp(priced.unitCp), totalGp, ...(gridFallback ? { gridFallback } : {}) };
}

/**
 * Remove `qty` units of a held item from the location: a stack loses the
 * units, anything else (or the whole stack) is deleted.
 */
async function takeHeld(held, qty) {
  const stack = quantityOf(held.toObject());
  if (stack && stack.value > qty) await held.update({ [stack.path]: stack.value - qty });
  else await held.delete();
}

/**
 * Hand purchased goods to their buyer through `lib/bundles.mjs`: `qty` counts
 * units, so a stackable arrives as one stack of `qty` and folds into an
 * identical stack the buyer carries, and a unit item (thirty swords) arrives
 * as `qty` copies. Never as a bundle: no actor sheet lists an embedded one.
 */
export async function deliverGoods(buyer, { entry, qty }) {
  const data = foundry.utils.deepClone(entry.data);
  const unit = quantityOf(data);
  if (unit) foundry.utils.setProperty(data, unit.path, 1);
  return deliverItems(buyer, goodsForRow(data, qty));
}


/**
 * Resolve one item's monthly market state — band, party/market cells at
 * effective vs true class, this month's rows (stale months pruned), the
 * cached %-rolls (party find first, then the town's stock), and the room
 * left in `direction`. Shared by purchases, sales, and directed searches;
 * mutates `goods` in place so the caller's write persists what was rolled.
 * `gridFallback` is true when a magic item was banded on the equipment grid
 * because the magic transaction grid is not imported.
 */
export async function resolveMonthlyAvailability(location, goods, { itemData, bandValueGp, magic = false, trader, direction, claimDedicated = false }) {
  const grid = bandGridFor(magic);
  if (!grid) return err("tablesMissing");
  const rules = marketRules(["marketTotalMultiplier"]);
  if (!rules) return printedError("marketRulesProse");
  const band = priceBandOf(bandValueGp, grid.rows);
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

  // The dedicated-shopping claim, checked against the printed head-count; a
  // month that holds the claim reads the printed multiple it earns.
  let crowdMultiplier;
  if ((claimDedicated && !partyMonth.dedicated) || partyMonth.dedicated) {
    const crowd = marketRules(["crowdSize", "crowdMultiplier"]);
    if (!crowd) return printedError("marketRulesProse");
    if (claimDedicated && !partyMonth.dedicated) {
      if (partySize(party.id) < crowd.crowdSize) return err("partyTooSmall", { crowd: crowd.crowdSize });
      partyMonth.dedicated = true;
    }
    crowdMultiplier = crowd.crowdMultiplier;
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
  // all-parties stock (true class) — both rolled once per month and cached so a
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
    const { marketTotalMultiplier } = rules;
    let plan = pctMarketStock(marketCell.chance, { marketTotalMultiplier, partyFound });
    if (!plan) plan = pctMarketStock(marketCell.chance, { marketTotalMultiplier, partyFound, d100: await d100() });
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
    crowdMultiplier,
    marketTotalMultiplier: rules.marketTotalMultiplier,
    extraSearchDays: Number(partyMonth.searchDays ?? 0),
    exists: cell.kind === "qty" ? marketCell.kind !== "qty" : !!existRow?.exists,
    pctStock: Number(totalsRow.pctStock ?? 0),
  });
  return { band, cell, marketCell, monthStart, key, party, partyMonth, totalsRow, ledgerRow, existRow, room, gridFallback: grid.fallback };
}

const marketsFlag = marketsFlagOf;

/**
 * Sale pricing and band placement for one owned item. Mundane gear sells at
 * its condition-reduced value (the reduced value also picks its availability
 * band, RR §IV.7) with demand and Bargaining applied; a magic item trades by
 * identification — apparent value short of full identification, base cost
 * (a printed multiple if self-made) at full — on the JJ transaction grid,
 * which prints the equipment availability cells and substitutes for them when
 * a world has not imported it separately. The printed figures are read here;
 * `missing` names the imported table (`printedError`'s id) a price could not
 * be worked without, and the price is then zero.
 * @returns {{unitCp:number, basis:string, bandValueGp:number, magic:boolean, breakdown:object[], missing:string|null}}
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
      selfMadeTimes: magicPrices(["selfMadeTimes"])?.selfMadeTimes ?? null,
    });
    return {
      unitCp: m.unitCp,
      basis: m.basis,
      bandValueGp: magicBandValueGp({ baseCostGp: flag.baseCostGp ?? costGp, apparentValueGp: flag.apparentValueGp ?? 0, identified: flag.identified ?? "none" }),
      magic: true,
      breakdown: [{ label: m.basis, cp: m.unitCp }],
      missing: m.unpriced ? "priceProse" : null,
    };
  }
  const valueMult = Number(itemData.flags?.[MODULE_ID]?.scavenged?.valueMultiplier ?? 1) || 1;
  const swing = bargain ? bargaining() : null;
  const category = categoryOf(itemData);
  const priced = quote({
    costGp,
    direction: "sell",
    valueMult,
    demandSteps,
    stepFraction: stepFractionFor(category),
    bargain: swing ? bargain : null,
    bargainPct: swing ? { buy: swing.buyPct, sell: swing.sellPct } : null,
  });
  return {
    unitCp: priced.unitCp,
    basis: "base",
    bandValueGp: costGp * valueMult,
    magic: false,
    breakdown: priced.breakdown,
    missing: bargain && !swing ? "bargainingProse" : null,
  };
}

let gridFallbackWarned = false;

/**
 * The availability grid a trade prices volume on — `{rows, fallback}` — or
 * null when the world has not imported it: a market without its tables must
 * degrade to a message, never break the sheet. A magic trade whose own grid is
 * missing falls back to the equipment grid (`fallback: true`) and the GM is
 * told once per session.
 */
export function bandGridFor(magic) {
  if (magic) {
    const t = optTable("magicItems", "transactionsByMarketClass");
    if (t?.rows?.length) return { rows: t.rows, fallback: false };
  }
  const rows = optTable("availability", "equipmentAvailability")?.rows;
  if (!rows?.length) return null;
  if (magic) noteGridFallback();
  return { rows, fallback: !!magic };
}

/** Warn the console, and the GM's screen, once per session that magic trades are on the equipment grid. */
function noteGridFallback() {
  if (gridFallbackWarned) return;
  gridFallbackWarned = true;
  console.warn(`${MODULE_ID} | the magic-item transaction grid is not imported; magic trades use the equipment availability grid`);
  if (game.user?.isGM) ui?.notifications?.warn(game.i18n.localize(`${LANG}.trade.gridFallback`));
}

/**
 * The atomic sale: same monthly cells as buying, charged to the independent
 * `sold` counters. The sold document is destroyed. See
 * docs/markets/DECISIONS.md, "a sale destroys the sold item document
 * (quantity decrement for stacks); only a purchase creates one."
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
  const swing = !flag.magic && (partyRanks > 0 || merchantRanks > 0) ? bargaining() : null;
  if (!flag.magic && (partyRanks > 0 || merchantRanks > 0) && !swing) return printedError("bargainingProse");
  let opposed = null;
  if (swing && partyRanks > 0 && merchantRanks > 0) {
    opposed = await opposedBargain({ trader: seller, partyRanks, merchantRanks, merchantCha, rankBonus: swing.rankBonus });
  }
  const bargain = flag.magic ? null : bargainWinner({ partyRanks, merchantRanks, opposedWinner: opposed?.winner ?? null });
  const plan = salePlan(itemData, { demandSteps: demandStepsFor(goods, categoryOf(itemData)), bargain });
  if (plan.missing) return printedError(plan.missing);
  if (!(plan.unitCp > 0) || !(plan.bandValueGp > 0)) return err("untradeable");

  const monthState = await resolveMonthlyAvailability(location, goods, {
    itemData,
    bandValueGp: plan.bandValueGp,
    magic: plan.magic,
    trader: seller,
    direction: "sold",
  });
  if (monthState.error) return monthState;
  const { existRow, ledgerRow, totalsRow, room, gridFallback } = monthState;
  const verdict = capVerdict({ qty, remaining: room.remaining, enforce: !!getSetting("marketsEnforceCaps") });
  if (verdict === "exceeded") return err("capExceeded", { remaining: room.remaining });
  if (verdict === "waived") ui?.notifications?.warn(game.i18n.format(`${LANG}.trade.capWaived`, { remaining: room.remaining }));

  const totalGp = toGp(plan.unitCp * qty);
  // The proceeds are paid out here: onto the seller, or into coin this market keeps for them.
  await adapter.grantGold(seller, totalGp, { from: location, at: location, allowMint: true, within: location });

  // Sold mundane goods leave play. A MAGIC item is the exception: it is a
  // unique physical thing, so it passes into the market's own holdings —
  // embedded on the location actor, markets flag intact — where it remains a
  // real object a party could buy back or steal.
  if (plan.magic) {
    const kept = item.toObject();
    delete kept._id;
    const stack = quantityOf(kept);
    if (stack) foundry.utils.setProperty(kept, stack.path, qty);
    await location.createEmbeddedDocuments("Item", [kept]);
  }
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
    actorUuid: seller.uuid,
    gp: totalGp,
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
    `<strong>${game.i18n.format(`${LANG}.trade.earnedLine`, { total: totalGp })}</strong>`,
  ].filter(Boolean);
  await postReceipt({ location, trader: seller, html: lines.join("<br>") });
  const gmLines = gmDetailLines({ existRow, gridFallback });
  if (gmLines.length) await postGmNote({ trader: seller, html: gmLines.join("<br>") });

  Hooks.callAll(HOOKS.SOLD, { location, seller, itemName: itemData.name, qty, totalGp });
  return { ok: true, qty, unitGp: toGp(plan.unitCp), totalGp, ...(gridFallback ? { gridFallback } : {}) };
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
  const newLog = appendLog(log, { time: t, type: "extraSearch", note: `${trader.name}: extended search day posted`, actorUuid: trader.uuid, gp: 0 });
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
