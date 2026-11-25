/**
 * What reads a fuse bearer's proficiency for lib's item runner
 * (`lib/item-run.mjs` `setProficiencyReader`, registered at `init`): the
 * activation's proficiency word is folded to the ability the bearer holds
 * (`organisation.mjs` `matchProficiency`) and that ability's standing throw
 * modifiers are read (`abilities/ability-rolls.mjs` `targetModifiers`), loaded
 * on first use. A bearer without the proficiency answers `{proficient: false,
 * bonus: 0, parts: []}`.
 */
import { matchProficiency } from "./organisation.mjs";
import { proficiencyBonus } from "../lib/item-run-logic.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";

/**
 * The bearer's proficiency as the light reads it: `{proficient, bonus, parts}`.
 *
 * @param {object} actor the bearer's actor
 * @param {string|null} word the activation's proficiency word, null where blank
 */
export async function readBearerProficiency(actor, word) {
  const held = word ? matchProficiency(String(word), [...(actor?.items ?? [])].filter((i) => i.type === ITEM_TYPE.ability)) : null;
  if (!held) return { proficient: false, bonus: 0, parts: [] };
  const { targetModifiers } = await import("../abilities/ability-rolls.mjs");
  return { proficient: true, ...proficiencyBonus(targetModifiers({ rollType: "above" }, actor, held)) };
}
