/* global game, foundry */
/**
 * The market's till: the coin float a market keeps on hand, refreshed to its
 * market level each market month.
 *
 * The target is a STORED FIELD (`system.market.tillTargetGp`), not a buried
 * derivation — it is a knob other systems turn (trade routes will raise and
 * drain it). When the field is null the first refresh derives it — urban
 * families × monthly family income — and WRITES IT BACK, so from then on the
 * number on the sheet is the truth and the formula is only ever a default.
 *
 * Sourcing honours the no-book-values rule: family income comes from an
 * imported `economy` ruledata table when the GM's books have supplied one,
 * else from a world setting whose default is an explicit round PLACEHOLDER —
 * not the printed figure. Families likewise: the stated `urbanFamilies` wins;
 * without one, a deliberately-invented round ladder stands in per class until
 * real numbers are entered.
 */
import { MODULE_ID } from "../constants.mjs";
import { getSetting } from "../settings.mjs";
import { optTable } from "../../henchmen/rules/tables.mjs";
import { creditCoin, HOUSE_OWNER } from "../../lib/money.mjs";
import { STORAGE_KEY } from "../../lib/storage-logic.mjs";
import { ITEM_TYPE } from "../../lib/vocab.mjs";
import { marketMonthStart } from "./trade.mjs";
import { now } from "../../henchmen/time.mjs";

/** Placeholder families per market class — a round invented ladder, NOT the
 * book's settlement bands; it exists only until `urbanFamilies` is entered. */
const PLACEHOLDER_FAMILIES = { 1: 20000, 2: 5000, 3: 1250, 4: 300, 5: 75, 6: 20 };

/** The market's monthly family income in gp: imported RAW when present. */
export function familyIncomeGp() {
  const table = optTable("economy", "familyIncome");
  const raw = Number(table?.rows?.[0]?.gpPerMonth);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return Number(getSetting("marketsFamilyIncomeGp")) || 10;
}

/** The till target in gp — the stored field, deriving (and persisting) once
 * when unset. Returns 0 for a place with no market. */
export async function tillTargetGp(location) {
  const market = location.system?.market;
  if (!market || location.system?.marketClass == null) return 0;
  const stored = Number(market.tillTargetGp);
  if (Number.isFinite(stored) && stored >= 0 && market.tillTargetGp !== null) return stored;
  const families = Number(market.urbanFamilies) > 0
    ? Number(market.urbanFamilies)
    : PLACEHOLDER_FAMILIES[location.system.marketClass] ?? 100;
  const target = Math.round(families * familyIncomeGp());
  await location.update({ "system.market.tillTargetGp": target });
  return target;
}

/** The house-owned coin currently in the till, in copper. */
export function tillCoinCp(location) {
  let cp = 0;
  for (const item of location.items) {
    if (item.type !== ITEM_TYPE.money) continue;
    if ((item.getFlag(MODULE_ID, STORAGE_KEY)?.ownerUuid ?? HOUSE_OWNER) !== HOUSE_OWNER) continue;
    cp += Number(item.system?.coppervalue ?? 0) * Number(item.system?.quantity ?? 0);
  }
  return cp;
}

/**
 * Top the till up to its target, once per market month (watermarked). A till
 * ABOVE target is left alone — trade drains and gluts are real state, and
 * next month's refresh is the economy replenishing, not a reset.
 * @returns {{refreshed: boolean, addedGp?: number}}
 */
export async function refreshTill(location, { force = false } = {}) {
  const market = location.system?.market;
  if (!market || location.system?.marketClass == null) return { refreshed: false };
  const monthStart = marketMonthStart(now());
  if (!force && Number(market.tillRefreshTime) >= monthStart) return { refreshed: false };
  const targetGp = await tillTargetGp(location);
  const shortCp = targetGp * 100 - tillCoinCp(location);
  if (shortCp > 0) {
    const credits = [];
    let owed = shortCp;
    for (const d of [
      { name: game.i18n.localize("ACKS-LIB.money.gpName"), cv: 100 },
      { name: game.i18n.localize("ACKS-LIB.money.spName"), cv: 10 },
      { name: game.i18n.localize("ACKS-LIB.money.cpName"), cv: 1 },
    ]) {
      const count = Math.floor(owed / d.cv);
      if (count > 0) { credits.push({ ...d, count }); owed -= count * d.cv; }
    }
    await creditCoin(location, credits);
  }
  await location.update({ "system.market.tillRefreshTime": monthStart });
  return { refreshed: true, addedGp: Math.max(0, shortCp) / 100 };
}
