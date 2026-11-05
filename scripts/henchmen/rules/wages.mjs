/**
 * Wage rules (RR 166-171). Pure module.
 */
import { getTable, optTable, optCite } from "./tables.mjs";

/** A level rounded and held between a ladder's own lowest and highest rung. */
function onLadder(rungs, level) {
  const levels = rungs.map(Number).filter(Number.isInteger);
  const at = Math.round(Number(level) || 0);
  return levels.length ? Math.max(Math.min(...levels), Math.min(Math.max(...levels), at)) : at;
}

/** Monthly wage in gp for a henchman of a level (HD for monsters, MM 351). */
export function henchmanWage(level) {
  const byLevel = optTable("wages", "henchmanWageByLevel")?.byLevel;
  if (byLevel) return byLevel[String(onLadder(Object.keys(byLevel), level))] ?? 0;
  // Before the wage ladder is imported: the henchman availability table (RR)
  // carries the same per-level monthly wage, so market hiring still works.
  const rows = optTable("availability", "henchmanAvailability")?.rows ?? [];
  const at = onLadder(rows.map((r) => r.level), level);
  return rows.find((r) => r.level === at)?.wage ?? 0;
}

/** True where a table `henchmanWage` reads is imported, so its 0 is a wage and not an absence. */
export function henchmanWageImported() {
  return !!(optTable("wages", "henchmanWageByLevel")?.byLevel || optTable("availability", "henchmanAvailability")?.rows);
}

/** The page of the table `henchmanWage` reads, in the same order it reads them; null where neither is imported or the layer read records none. */
export function henchmanWageCite() {
  if (optTable("wages", "henchmanWageByLevel")?.byLevel) return optCite("wages", "henchmanWageByLevel");
  if (optTable("availability", "henchmanAvailability")?.rows) return optCite("availability", "henchmanAvailability");
  return null;
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

/**
 * The henchman limit's imported base, before the Charisma modifier and the
 * powers (RR 168), or null until the Rules tables are imported. A blank or
 * non-integer figure is unread, never zero.
 */
export function henchmanLimitBase() {
  const base = optTable("wages", "henchmanLimit")?.base;
  return Number.isInteger(base) && base >= 0 ? base : null;
}

/**
 * The permanent morale bonuses a level gain earns (RR 166), as rungs
 * `{level, bonus}` keyed by the level whose reaching earns each. The imported
 * `levelMorale` table names one rung by the level a hireling leaves and one by
 * the level reached. A rung with a blank or non-integer figure is unread and
 * left out, so nothing imported is no rung.
 * @returns {{level: number, bonus: number}[]}
 */
export function levelMoraleRungs() {
  const t = optTable("wages", "levelMorale");
  const level = (v) => Number.isInteger(v) && v >= 0;
  const rungs = [];
  if (level(t?.fromLevel) && Number.isInteger(t?.fromBonus)) rungs.push({ level: t.fromLevel + 1, bonus: t.fromBonus });
  if (level(t?.reachLevel) && Number.isInteger(t?.reachBonus)) rungs.push({ level: t.reachLevel, bonus: t.reachBonus });
  return rungs;
}

/**
 * The rungs a level gain from `known` to `level` crosses, or null while no
 * rung is imported, which a caller tells apart from a gain that crosses none.
 * @returns {{level: number, bonus: number}[]|null}
 */
export function levelMoraleBumps(known, level) {
  const rungs = levelMoraleRungs();
  return rungs.length ? rungs.filter((r) => known < r.level && level >= r.level) : null;
}

/**
 * Max hireable henchman level for an employer level (RR 168), or null where
 * the imported ladder holds no rung for it. A domain ruler may hire any level
 * below their own. Everyone else reads the ladder's rung for their level; the
 * open top rung rises by its `perLevel` for each level past its floor, and
 * without one it answers only at the floor.
 */
export function maxHenchmanLevel(employerLevel, isDomainRuler = false) {
  if (isDomainRuler) return Math.max(0, employerLevel - 1);
  const rungs = optTable("wages", "employerLevelCap")?.rungs;
  const rung = (Array.isArray(rungs) ? rungs : []).find(
    (r) => Number.isInteger(r?.min) && Number.isInteger(r?.cap) && employerLevel >= r.min && (r.max === null || employerLevel <= r.max)
  );
  if (!rung) return null;
  if (rung.max !== null) return rung.cap;
  if (Number.isInteger(rung.perLevel)) return rung.cap + (employerLevel - rung.min) * rung.perLevel;
  return employerLevel === rung.min ? rung.cap : null;
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
  // Pay-period conversion (RAW names the periods, not the math): a week's
  // pay = monthly / 4, a day's = monthly / 30. The influence feature prices
  // bribes through this same function (docs/influence/DECISIONS.md).
  const gp = { day: monthlyWage / 30, week: monthlyWage / 4, month: monthlyWage, year: monthlyWage * 12 }[row.wages];
  return { gp: Math.ceil(gp), wages: row.wages };
}

/** The page the signing bonus ladder was read from, or null where none is recorded. */
export function signingBonusCite() {
  return optCite("wages", "signingBonus");
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
