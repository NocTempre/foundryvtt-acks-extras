/**
 * Wage rules (RR 166-171). Pure module.
 */
import { getTable, optTable } from "./tables.mjs";

/** Monthly wage in gp for a henchman of a level (HD for monsters, MM 351). */
export function henchmanWage(level) {
  const capped = Math.max(0, Math.min(14, Math.round(level)));
  const byLevel = optTable("wages", "henchmanWageByLevel")?.byLevel;
  if (byLevel) return byLevel[String(capped)] ?? 0;
  // Before the wage ladder is imported: the henchman availability table (RR)
  // carries the same per-level monthly wage, so market hiring still works.
  const row = optTable("availability", "henchmanAvailability")?.rows?.find((r) => r.level === capped);
  return row?.wage ?? 0;
}

/** Monthly wage for a mercenary troop type and race ("man" default). */
export function mercenaryWage(troopType, race = "man") {
  const row = (optTable("wages", "mercenaryWages")?.rows ?? []).find((r) => r.type === troopType);
  if (!row) return null;
  return row.wages[race] ?? null;
}

/** Base morale for a mercenary troop type (+1 for demi-humans). */
export function mercenaryMorale(troopType, demiHuman = false) {
  const row = (optTable("wages", "mercenaryWages")?.rows ?? []).find((r) => r.type === troopType);
  if (!row) return 0;
  return row.morale + (demiHuman ? 1 : 0);
}

/** Base morale for a specialist type (RR 166 role groups — the imported
 *  prose values; which TYPE keys fall in which group is code glue). */
export function specialistMorale(specialistType) {
  const t = optTable("wages", "baseMorale");
  if (!t) return 0; // neutral until the wages tables are imported
  const k = String(specialistType ?? "");
  if (/^mariner(Rower|Sailor)$/.test(k)) return t.rowersSailors ?? t.specialistDefault ?? 0;
  if (/^(marinerNavigator|marinerCaptain|scout)$/.test(k)) return t.navigatorsCaptainsScouts ?? 0;
  if (/^(marshal|mercOfficer|marinerMaster)/.test(k)) return t.marshalsMastersOfficers ?? 0;
  return t.specialistDefault ?? 0;
}

/** Max hireable henchman level for an employer level (RR 168). */
export function maxHenchmanLevel(employerLevel, isDomainRuler = false) {
  if (isDomainRuler) return Math.max(0, employerLevel - 1);
  if (employerLevel >= 7) return 4 + (employerLevel - 7);
  const rows = optTable("wages", "employerLevelCap")?.rows;
  if (!rows) return Math.max(0, employerLevel - 1); // uncapped-ish until imported
  const row = rows.find((r) => r.employerLevel === employerLevel);
  return row ? row.maxHenchmanLevel : 0;
}

/**
 * Signing bonus gp for a reaction bonus tier (RR 162 + GM screen refinement).
 * @param {number} tier - +1..+3
 * @param {number} monthlyWage - the candidate's monthly wage in gp
 * @param {boolean} briberyProficient
 * @returns {{gp: number, wages: string}|null}
 */
export function signingBonusCost(tier, monthlyWage, briberyProficient) {
  const table = optTable("wages", "signingBonus");
  if (!table) return null; // dialog omits signing-bonus tiers until imported
  const side = briberyProficient ? table.proficient : table.nonProficient;
  // Imported shape is a tier→period map ({"1":"day"…}); the legacy reference
  // shape was an array of {bonus, wages}. Accept both.
  const period = Array.isArray(side) ? side.find((r) => r.bonus === tier)?.wages : side?.[String(tier)];
  if (!period) return null;
  const row = { wages: period };
  // Family-standard pay conversions (RAW names the periods, not the math):
  // a week's pay = monthly / 4, a day's = monthly / 30 — matching the
  // influence module's bribe tiers so both rollers price identically.
  const gp = { day: monthlyWage / 30, week: monthlyWage / 4, month: monthlyWage, year: monthlyWage * 12 }[row.wages];
  return { gp: Math.ceil(gp), wages: row.wages };
}

/** Expected monthly living expenses of an adventurer = same-level henchman wage. */
export function expectedLivingExpenses(level) {
  return henchmanWage(level);
}

/** Apparent level implied by a monthly spend (largest level whose wage ≤ spend). */
export function apparentLevelFromSpend(gpPerMonth) {
  const byLevel = optTable("wages", "henchmanWageByLevel")?.byLevel ?? {};
  let apparent = 0;
  for (const [lvl, wage] of Object.entries(byLevel)) {
    if (gpPerMonth >= wage) apparent = Math.max(apparent, Number(lvl));
  }
  return apparent;
}
