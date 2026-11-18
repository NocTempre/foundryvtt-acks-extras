/**
 * The caster's abilities as the cast reads them: gathering an actor's
 * `spellcastingMod` rows and matching them to the spell being cast
 * (`cast-abilities.mjs`), and the three places the matched parts land. The
 * caster level takes the `casterLevel` parts (`cast-level.mjs`'s level, with
 * the deltas on it), a target's saving throw takes the `save` parts as parts on
 * its roll, and the spell's damage takes the `damage` parts through an attack
 * contributor that asks for a spell carrier's damage. Per-day uses and slots are
 * never read here: an ability changes a cast's level, save and damage only.
 *
 * Every site gathers live from the caster, so the casting client, the presses
 * and the GM's relay each read one answer from one actor.
 */
import { matchAbilities, perDieTotal } from "./cast-abilities.mjs";
import { byCookbookId } from "../lib/library.mjs";
import { abilityRefs } from "../lib/capabilities.mjs";
import { carrierOf } from "../lib/patches/attack-throw.mjs";
import { spellcastingRows } from "../lib/typed-modifiers.mjs";

/** What a cast with no matching ability reads: an empty bucket for each thing an ability can change. */
export const NO_ABILITIES = Object.freeze({ casterLevel: [], save: [], damage: [] });

/** The world lookups the spell's library twin needs. */
const liveLookups = () => ({ byCookbookId, fromUuidSync: (uuid) => globalThis.fromUuidSync?.(uuid) });

/**
 * The parts of the caster's abilities that apply to one spell, per bucket
 * (`matchAbilities`): `{casterLevel, save, damage}`, each a list of parts. A
 * caster with no abilities, no spell, or no row that matches gets empty buckets.
 *
 * @param {object} caster  the casting actor
 * @param {object} spell
 * @param {{byCookbookId: Function, fromUuidSync: Function}} [lookups]
 */
export function castAbilitiesOf(caster, spell, lookups = liveLookups()) {
  if (!caster?.items || !spell) return NO_ABILITIES;
  const rows = spellcastingRows(caster);
  if (!rows.length) return NO_ABILITIES;
  return matchAbilities(rows, spell, { has: abilityRefs(caster), lookups });
}

/**
 * The parts a target's saving throw takes for the caster's abilities: each part
 * that applies, as a part on the roll (`lib/saves.mjs` `saveSpec`'s `parts`). The
 * figure is added to the target's die as written, so a penalty is negative.
 *
 * @param {{save?: object[]}} matched  `castAbilitiesOf`'s answer
 * @returns {Array<{key: string, label: string, value: number}>}
 */
export function castSaveParts(matched) {
  return (matched?.save ?? []).filter((p) => p.applies && Number.isFinite(p.value)).map((p) => ({ key: `ability:${p.key}`, label: p.label, value: p.value }));
}

/**
 * The rows the spell's damage roll takes for the caster's abilities, as the
 * attack seam's `{label, value}`: a `perDie` part is its figure times the dice
 * the scaled formula rolls. A part of zero is not a row.
 *
 * @param {{damage?: object[]}} matched
 * @param {string} formula  the scaled damage formula
 * @returns {Array<{label: string, value: number}>}
 */
export function castDamageRows(matched, formula) {
  return (matched?.damage ?? [])
    .filter((p) => p.applies)
    .map((p) => ({ label: p.label, value: perDieTotal(p, formula) }))
    .filter((row) => row.value !== 0);
}

/**
 * The attack contributor for a spell's damage. Only a spell carrier's damage is
 * asked (`carriers`), and a weapon's own attack is never touched: the answer for
 * a carrier is the caster's matched `damage` parts for the spell the carrier was
 * made for, read on the carrier's own formula.
 */
export const abilityDamageContributor = {
  carriers: ["damage"],
  damage(ctx, _attackType, modifiers) {
    const carried = carrierOf(ctx?.item);
    if (!carried) return modifiers;
    const spell = carried.spellUuid ? globalThis.fromUuidSync?.(carried.spellUuid) : null;
    const rows = castDamageRows(castAbilitiesOf(ctx.actor, spell), String(ctx.item?.system?.getDamageFormula?.("base") ?? ""));
    return rows.length ? [...modifiers, ...rows] : modifiers;
  },
};
