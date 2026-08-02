/**
 * Availability rules (RR 162-165, JJ 118-119). Pure module — dice arrive via
 * an injected async roller so Node tests stay deterministic.
 */
import { getTable, optTable, bracketRow } from "./tables.mjs";
import { rollAvailability, arrivalSplit } from "./dice.mjs";
import { RARITY_TIERS } from "../config.mjs";

/** Clamp a market class to the legal 1..6 range (1 is the largest market). */
export function clampMarketClass(mc) {
  return Math.min(6, Math.max(1, Math.round(mc)));
}

/**
 * Derive market class from urban families (RR 352). Below the smallest
 * bracket → Class 6 (per the local settlement table's default).
 */
export function marketClassFromFamilies(urbanFamilies) {
  const rows = getTable("settlement", "marketClassByFamilies").rows;
  const row = bracketRow(rows, Number(urbanFamilies) || 0);
  return row ? row.marketClass : 6;
}

/**
 * Apply an effect shift (Mercantile Network: previously-entered markets count
 * one class larger; Class 1 stays Class 1).
 */
export function shiftMarketClass(marketClass, shift) {
  if (!shift) return clampMarketClass(marketClass);
  return clampMarketClass(marketClass - shift);
}

/** The weekly market search fee formula for a market class (dice string). */
export function searchFeeFormula(marketClass) {
  return getTable("availability", "searchFees").byMarketClass[String(clampMarketClass(marketClass))];
}

/** Availability expression for henchmen of a level in a market class. */
export function henchmanExpr(level, marketClass) {
  const row = getTable("availability", "henchmanAvailability").rows.find((r) => r.level === level);
  return row ? { expr: row.byMarketClass[clampMarketClass(marketClass) - 1], wage: row.wage } : null;
}

/** Availability expression for a mercenary troop type. */
export function mercenaryExpr(type, marketClass) {
  const row = getTable("availability", "mercenaryAvailability").rows.find((r) => r.type === type);
  return row ? { expr: row.byMarketClass[clampMarketClass(marketClass) - 1], row } : null;
}

/** Availability expression + wage for a specialist type. */
export function specialistExpr(type, marketClass) {
  const row = getTable("availability", "specialistAvailability").rows.find((r) => r.type === type);
  return row
    ? { expr: row.byMarketClass[clampMarketClass(marketClass) - 1], wage: row.wage, wageUnit: row.wageUnit }
    : null;
}

/** Rarity tier of a class name within a rarity table variant. */
export function classRarity(className, variant = "default") {
  const variants = optTable("rarity", "classRarityTables")?.variants;
  const tiers = (variants?.[variant] ?? variants?.default)?.tiers;
  if (!tiers) return null;
  const wanted = String(className).toLowerCase().trim();
  for (const [tier, classes] of Object.entries(tiers)) {
    if (classes.some((c) => c.toLowerCase() === wanted)) return tier;
  }
  return null;
}

/**
 * Shift a rarity tier N steps toward Legendary (JJ: +1 per level above 1st,
 * +1 per proficiency rank, −1 for commissioning). Returns null when shifted
 * past Legendary (not findable by this method).
 */
export function shiftRarity(tier, shift) {
  const idx = RARITY_TIERS.indexOf(tier);
  if (idx < 0) return null;
  const next = idx + shift;
  if (next >= RARITY_TIERS.length) return null;
  return RARITY_TIERS[Math.max(0, next)];
}

/** Availability expression for a rarity tier in a market class (JJ 118). */
export function rarityExpr(tier, marketClass) {
  const row = (optTable("rarity", "rarityAvailability")?.rows ?? []).find((r) => r.rarity === tier);
  return row ? row.byMarketClass[clampMarketClass(marketClass) - 1] : null;
}

/**
 * Roll the month's candidate pool for a posting specification.
 * @param {object} spec - { kind, level?, classKey?, rarityOverride?, troopType?,
 *                          specialistType?, proficiencyRanks?, commissioned? }
 * @param {number} marketClass - effective market class (already shifted)
 * @param {(f: string) => Promise<number>} rollDice
 * @param {() => number} [rand]
 * @param {string} [rarityVariant="default"]
 * @returns {Promise<{quantity:number, detail:string, capExpr?:string, rarity?:string}|{error:string}>}
 */
export async function rollMonthlyPool(spec, marketClass, rollDice, rand = Math.random, rarityVariant = "default") {
  const mc = clampMarketClass(marketClass);
  switch (spec.kind) {
    case "henchman": {
      const found = henchmanExpr(spec.level ?? 0, mc);
      if (!found) return { error: "unknown-level" };
      const rolled = await rollAvailability(found.expr, rollDice, rand);
      return { ...rolled, wage: found.wage };
    }
    case "mercenary": {
      const found = mercenaryExpr(spec.troopType, mc);
      if (!found) return { error: "unknown-troop-type" };
      return rollAvailability(found.expr, rollDice, rand);
    }
    case "specialist": {
      const found = specialistExpr(spec.specialistType, mc);
      if (!found) return { error: "unknown-specialist" };
      const rolled = await rollAvailability(found.expr, rollDice, rand);
      return { ...rolled, wage: found.wage, wageUnit: found.wageUnit };
    }
    case "henchmanByClass": {
      let tier = spec.rarityOverride ?? classRarity(spec.classKey, rarityVariant);
      if (!tier) return { error: "unknown-class" };
      if (spec.levelShift) tier = shiftRarity(tier, spec.levelShift);
      // Alignment openness: recruiting an opposed-alignment class openly is
      // harder (chaotic warlocks in a lawful town) — shift per the table.
      if (spec.alignmentShift) tier = tier ? shiftRarity(tier, spec.alignmentShift) : tier;
      if (spec.commissioned) tier = shiftRarity(tier, -1) ?? tier;
      if (!tier) return { error: "past-legendary" };
      const expr = rarityExpr(tier, mc);
      if (!expr) return { error: "unknown-rarity" };
      const rolled = await rollAvailability(expr, rollDice, rand);
      // JJ: capped by the total henchmen available in the market (all levels).
      return { ...rolled, rarity: tier };
    }
    case "henchmanByProficiency": {
      // GENERAL proficiency search: rarity from the ranks ladder (JJ 119).
      const ranks = Math.min(3, Math.max(1, spec.proficiencyRanks ?? 1));
      const sqm = optTable("rarity", "specificQualificationMods");
      const map = sqm ? { 1: sqm.gpRank1, 2: sqm.gpRank2, 3: sqm.gpRank3 } : null;
      if (!map) return { error: "tables-missing" };
      let tier = map[ranks];
      if (!tier) return { error: "past-legendary" };
      if (spec.commissioned) tier = shiftRarity(tier, -1) ?? tier;
      const expr = rarityExpr(tier, mc);
      if (!expr) return { error: "unknown-rarity" };
      const rolled = await rollAvailability(expr, rollDice, rand);
      return { ...rolled, rarity: tier };
    }
    case "henchmanByClassProficiency": {
      // CLASS proficiency search: base rarity of the qualifying class the
      // recruiter names, shifted per additional rank (JJ 119).
      let tier = classRarity(spec.classKey, rarityVariant);
      if (!tier) return { error: "unknown-class" };
      // JJ 119: "equal to the base class, plus one for EACH rank" — rank 1
      // already shifts (a Common class's rank-1 class prof is Uncommon).
      const ranks = Math.min(3, Math.max(1, spec.proficiencyRanks ?? 1));
      const perRank = optTable("rarity", "specificQualificationMods")?.cpPerRank ?? 1;
      tier = shiftRarity(tier, ranks * perRank);
      if (spec.alignmentShift) tier = tier ? shiftRarity(tier, spec.alignmentShift) : tier;
      if (spec.commissioned && tier) tier = shiftRarity(tier, -1) ?? tier;
      if (!tier) return { error: "past-legendary" };
      const expr = rarityExpr(tier, mc);
      if (!expr) return { error: "unknown-rarity" };
      const rolled = await rollAvailability(expr, rollDice, rand);
      return { ...rolled, rarity: tier };
    }
    default:
      return { error: "unknown-kind" };
  }
}

export { arrivalSplit };
