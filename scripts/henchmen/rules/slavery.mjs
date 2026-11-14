/**
 * Slavery rules (JJ 409-410) — OPTIONAL, gated behind the `enableSlavery`
 * world setting (callers gate). Pure shape access over the imported
 * `slavery` ruledata doc; no book values live here — every number
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

/** The imported `[min%, max%]` of hirelings displaced where slaves are sold, or null. */
export function hirelingDisplacement() {
  return optTable("slavery", "commonSlaves")?.hirelingDisplacement ?? null;
}

/** The imported monthly upkeep for slave soldiers, with an ogre figure where one is imported; null without the table. */
export function slaveUpkeep(race = "man") {
  const rules = optTable("slavery", "soldierRules");
  if (!rules) return null;
  return race === "ogre" ? (rules.ogreUpkeep ?? rules.upkeep) : rules.upkeep;
}

/**
 * The imported loyalty figure for how a slave entered servitude (JJ ~410):
 * the adult-enslavement figure, or the trainer bonus for a child still serving
 * the trainer. Null until imported.
 * @param {object} o - { enslavedAsAdult, servingTrainer }
 */
export function slaveLoyalty({ enslavedAsAdult = true, servingTrainer = false } = {}) {
  const t = optTable("slavery", "slaveLoyalty");
  if (!t) return null;
  if (enslavedAsAdult) return t.enslavedAsAdult ?? null;
  return servingTrainer ? (t.trainerBonus ?? 0) : 0;
}
