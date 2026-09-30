/* global game, foundry */
/**
 * The market's till: the coin float a market keeps on hand, refreshed to its
 * market level each market month.
 *
 * The target is a stored field (`system.market.tillTargetGp`), not a buried
 * derivation. When unset, the first refresh derives it — urban families ×
 * monthly family income — and writes it back, so the sheet's number becomes
 * the truth and the formula is only ever a default. A market with no stated
 * `urbanFamilies` has nothing to derive from: its target reads 0 and nothing
 * is written, so the derivation happens once the families are entered.
 *
 * Family income comes from an imported `economy` table when the GM's books
 * have supplied one, else a placeholder world setting.
 */
import { MODULE_ID } from "../constants.mjs";
import { getSetting } from "../settings.mjs";
import { optTable } from "../../henchmen/rules/tables.mjs";
import { creditCoin, HOUSE_OWNER } from "../../lib/money.mjs";
import { STORAGE_KEY } from "../../lib/storage-logic.mjs";
import { ITEM_TYPE } from "../../lib/vocab.mjs";
import { marketMonthStart } from "./trade.mjs";
import { now } from "../../henchmen/time.mjs";

/** The market's monthly family income in gp: imported RAW when present. */
export function familyIncomeGp() {
  const table = optTable("economy", "familyIncome");
  const raw = Number(table?.rows?.[0]?.gpPerMonth);
  if (Number.isFinite(raw) && raw > 0) return raw;
  const set = Number(getSetting("marketsFamilyIncomeGp"));
  return Number.isFinite(set) && set > 0 ? set : 0;
}

/** Whether the till target is a stored field, as opposed to still waiting to be derived. */
const hasStoredTarget = (market) => {
  const stored = Number(market.tillTargetGp);
  return Number.isFinite(stored) && stored >= 0 && market.tillTargetGp !== null;
};

/** The till target in gp — the stored field, deriving (and persisting) once
 * when unset and the market's urban families are stated. Returns 0, writing
 * nothing, for a place with no market or no stated families to derive from. */
export async function tillTargetGp(location) {
  const market = location.system?.market;
  if (!market || location.system?.marketClass == null) return 0;
  if (hasStoredTarget(market)) return Number(market.tillTargetGp);
  const families = Number(market.urbanFamilies);
  const income = familyIncomeGp();
  if (!(families > 0) || !(income > 0)) return 0;
  const target = Math.round(families * income);
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
  // No target and nothing to derive one from: leave the month unwatermarked so the
  // refresh runs as soon as the families are entered.
  if (!hasStoredTarget(market) && !(Number(market.urbanFamilies) > 0)) return { refreshed: false };
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
