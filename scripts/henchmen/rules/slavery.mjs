/**
 * Slavery rules (JJ 409-410) — OPTIONAL, gated behind the `enableSlavery`
 * world setting (callers gate; this module is pure shape access over the
 * imported `slavery` ruledata doc). No book values live here — every number
 * comes from the world's imported tables; absent tables read as null.
 */
import { optTable } from "./tables.mjs";

/** Purchase cost + upkeep + loyalty/morale presets for a common slave type. */
export function commonSlave(type) {
  const t = optTable("slavery", "commonSlaves");
  if (!t) return null;
  const shapes = {
    laborer: {
      cost: t.laborerCost,
      upkeep: t.laborerUpkeep,
      baseLoyalty: t.laborerLoyalty,
      constructionSpPerDay: t.laborerConstructionSp,
      perPeasantFamily: t.laborersPerFamily,
    },
    household: { cost: t.householdCost, upkeep: t.householdUpkeep, baseLoyalty: t.householdLoyalty },
    pleasure: {
      costMin: t.pleasureCost?.min,
      costMax: t.pleasureCost?.max,
      upkeep: t.pleasureUpkeep,
      baseMorale: t.pleasureMorale,
    },
    professional: {
      wageMult: t.professionalWageMult,
      wageLess: t.professionalLess,
      upkeep: t.professionalUpkeep,
      baseLoyalty: t.professionalLoyalty,
    },
  };
  const row = shapes[type];
  return row && Object.values(row).some((v) => v != null) ? { type, ...row } : null;
}

/** Professional slave price from the free professional's monthly wage. */
export function professionalSlaveCost(freeMonthlyWage) {
  const p = commonSlave("professional");
  if (!p || p.wageMult == null || !(freeMonthlyWage > 0)) return null;
  return p.wageMult * freeMonthlyWage - (p.wageLess ?? 0);
}

/** [min%, max%] of hirelings displaced where slaves are sold. */
export function hirelingDisplacement() {
  return optTable("slavery", "commonSlaves")?.hirelingDisplacement ?? null;
}

/** Domain-morale penalty tiers for slave-labor population shares. */
export function domainMoraleTiers() {
  const t = optTable("slavery", "commonSlaves");
  if (!t) return [];
  return [
    { populationPct: t.domainMoralePct1, penalty: t.domainMoralePenalty1 },
    { populationPct: t.domainMoralePct2, penalty: t.domainMoralePenalty2 },
    { populationPct: t.domainMoralePct3, penalty: t.domainMoralePenalty3 },
  ].filter((x) => x.populationPct != null && x.penalty != null);
}

/** Purchase cost for a slave soldier of a troop type and race. */
export function slaveTroopCost(troopType, race = "man") {
  const row = (optTable("slavery", "slaveTroopCosts")?.rows ?? []).find((r) => r.type === troopType);
  return row?.costs?.[race] ?? null;
}

/** All slave troop rows (sparse per-race costs, as printed). */
export function slaveTroopRows() {
  return optTable("slavery", "slaveTroopCosts")?.rows ?? [];
}

/** Monthly upkeep for slave soldiers (ogres cost more; missing it = calamity). */
export function slaveUpkeep(race = "man") {
  const rules = optTable("slavery", "soldierRules");
  if (!rules) return null;
  return race === "ogre" ? (rules.ogreUpkeep ?? rules.upkeep) : rules.upkeep;
}

/** Indoctrination pipeline numbers (years, upkeep/candidate, marshals). */
export function indoctrinationRules() {
  const r = optTable("slavery", "soldierRules");
  if (!r) return null;
  return {
    years: r.indoctrinationYears ?? null,
    upkeepPerCandidate: r.indoctrinationUpkeep ?? null,
    marshalWage: r.marshalWage ?? null,
    candidatesPerMarshal: r.marshalPer ?? null,
  };
}

/**
 * Loyalty for how a slave entered servitude (JJ ~410, imported prose):
 * enslaved as an adult carries the book's penalty; enslaved as a child and
 * still serving the trainer carries its bonus. Null until imported —
 * never a hardcoded stand-in.
 * @param {object} o - { enslavedAsAdult, servingTrainer }
 */
export function slaveLoyalty({ enslavedAsAdult = true, servingTrainer = false } = {}) {
  const t = optTable("slavery", "slaveLoyalty");
  if (!t) return null;
  if (enslavedAsAdult) return t.enslavedAsAdult ?? null;
  return servingTrainer ? (t.trainerBonus ?? 0) : 0;
}

/**
 * The liberation rule (JJ ~410, "Mother of Dragons Memorial Rule"): a
 * fanatic-loyalty result on liberation by a BUYER (not their enslaver)
 * sets base loyalty and reduces pay to basic upkeep.
 */
export function liberationTerms() {
  const t = optTable("slavery", "slaveLoyalty");
  if (!t) return null;
  return { fanaticLoyalty: t.liberatedFanaticLoyalty ?? null, upkeep: t.liberatedUpkeep ?? null };
}
