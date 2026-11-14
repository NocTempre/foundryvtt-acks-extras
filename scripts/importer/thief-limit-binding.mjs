/* global game */
/**
 * Armour-limit binding: the imported `thiefLimits` table (JJ ch. 12, p. 292) →
 * one `limitation` row on each skill it names. The row is
 * `equipment/armour-limits.mjs` `importedLimitRow`: it names no figure, and the
 * consumer reads the rung and the shield rule from the table itself, so this
 * binding decides only WHICH abilities carry it.
 *
 * Skills resolve by folded name among the imported `def.skill.*` abilities, in
 * the library and on the world's actors; an ability with no cookbook id is a
 * Judge's own and is never touched. A skill the table no longer names loses the
 * row; a gone table leaves the rows standing, which the consumer reports as
 * "not imported". `bindAbility` appends the same row as a skill is built, so
 * import order does not matter.
 */
import { importedDocs } from "./cookbook.mjs";
import { MODULE_ID } from "./constants.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";
import { armourLimitsOf, isSkillId, limitsSkill, withImportedLimit } from "../equipment/armour-limits.mjs";

/** Whether two effect lists are the same rows in the same order. */
const sameEffects = (a, b) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

/** The imported skill abilities among `items`: ability type, a `def.skill.*` cookbook id. */
const importedSkills = (items) =>
  items.filter((item) => item.type === ITEM_TYPE.ability && isSkillId(item.getFlag?.(MODULE_ID, "cookbook")?.id));

/**
 * Stamp or clear the limit row on every imported skill the library and the
 * world's actors hold.
 * @returns {Promise<{stamped: number, cleared: number, skills: number}>}
 */
export async function applyThiefLimitImport() {
  const report = { stamped: 0, cleared: 0, skills: 0 };
  const limits = armourLimitsOf();
  if (!limits) return report;
  const held = [
    ...(await importedDocs("Item")),
    ...[...(game.actors ?? [])].flatMap((actor) => [...actor.items]),
  ];
  for (const item of importedSkills(held)) {
    report.skills++;
    const restricted = limitsSkill(item.name, limits);
    const extras = item.getFlag(MODULE_ID, "extras") ?? {};
    const next = withImportedLimit(extras.effects, restricted);
    if (sameEffects(extras.effects, next)) continue;
    await item.update({ [`flags.${MODULE_ID}.extras.effects`]: next });
    if (restricted) report.stamped++;
    else report.cleared++;
  }
  return report;
}
