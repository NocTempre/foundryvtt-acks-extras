/**
 * Item commissions (RR §IV.11 Construction Projects): an item is a
 * construction project of its base cost, built by a craftsman at their
 * construction rate and paid their wage for the duration. Pure module —
 * the imported Wage and Construction Rates rows arrive as printed money
 * strings; this parses and plans.
 */

/**
 * Printed money to integer copper: "3gp" → 300, "2sp" → 20, "1gp, 33cp" →
 * 133. Dual-rate cells print alternatives ("10gp / 15gp†") — the PRIMARY
 * (solo-work) variant before the slash is the one a lone commission uses.
 */
export function parseMoneyCp(text) {
  const primary = String(text ?? "").split("/")[0];
  let cp = 0;
  for (const m of primary.matchAll(/([\d,]+(?:\.\d+)?)\s*(gp|sp|cp)/gi)) {
    const n = Number(m[1].replace(/,/g, ""));
    cp += Math.round(n * (m[2].toLowerCase() === "gp" ? 100 : m[2].toLowerCase() === "sp" ? 10 : 1));
  }
  return cp;
}

/**
 * Plan a commission: how long the build takes and what the wages come to.
 *
 * @param {object} o
 * @param {number} o.costCp - the item's base cost × quantity, in copper
 * @param {object} o.rateRow - imported row {ratePerDay, wagePerMonth}
 * @param {number} [o.daysPerMonth] - the world's month length
 * @returns {{days:number, wagesCp:number}|null} null when the rate is unreadable
 */
export function commissionPlan({ costCp, rateRow, daysPerMonth = 28 }) {
  const rateCpDay = parseMoneyCp(rateRow?.ratePerDay);
  const wageCpMonth = parseMoneyCp(rateRow?.wagePerMonth);
  if (!(rateCpDay > 0) || !(costCp > 0)) return null;
  const days = Math.max(1, Math.ceil(costCp / rateCpDay));
  const wagesCp = Math.round((wageCpMonth / Math.max(1, daysPerMonth)) * days);
  return { days, wagesCp };
}
