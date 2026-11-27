/* global game */
/**
 * The monsters feature's seat at the attack seam: a monster whose Judge entered
 * a Strength score adds a labelled row to the attack throw and the damage roll
 * of the attack it makes, where the system's own monster model adds none.
 *
 * The rows mirror the system's character model: the throw takes a row for a
 * melee attack, the damage roll for a melee or a thrown one, and a missile
 * attack neither. A spell carrier's attack is never asked (the contributor
 * declares no `carriers`).
 *
 * Which figure the row carries follows the weapon's natural-weapon mark. A
 * weapon marked `weapon` is a wielded arm and takes the modifier the system
 * gives a character of that score (`abilityMod`). Any other mark, or none, is a
 * natural attack and takes the Strength table's cell for the score and the
 * average of the weapon's base damage formula (`strengthAttackBonus`). Where
 * the average cannot be read (a formula such as "By weapon") or the table
 * gives no figure, no row is added.
 *
 * A sheet drawing its attack boxes asks the seam's questions with no attack in
 * flight, and the seam asks no contributor then, so a monster sheet's own
 * attack figures never include these rows.
 */
import { MODULE_ID } from "./constants.mjs";
import { strengthAttackBonus } from "./strength-attack.mjs";
import { abilityMod, enteredScore } from "../lib/actor-read.mjs";
import { formulaAverage } from "../lib/dice-bounds.mjs";
import { addAttackContributor } from "../lib/patches/attack-throw.mjs";

/** The system's attack kinds, as its `ATTACK_TYPE` spells them. */
const MELEE = "melee";
const THROWN = "thrown";

/** The `naturalWeapon` mark of an arm a monster wields. */
const WIELDED = "weapon";

/** A number as text without a float tail (`3.5`, `7`). */
const figure = (n) => String(Math.round(n * 100) / 100);

/**
 * The row Strength adds to one attack, or null: `{label, value}` for an
 * attacker that is a monster with a Strength entered, a weapon in hand and a
 * figure the table or the system gives.
 */
function rowFor(ctx) {
  const actor = ctx?.actor;
  const weapon = ctx?.weapon;
  const score = enteredScore(actor, "str");
  if (score === null || !weapon) return null;
  const mark = weapon.getFlag?.(MODULE_ID, "naturalWeapon") ?? weapon.flags?.[MODULE_ID]?.naturalWeapon ?? "";
  if (mark === WIELDED) {
    const value = abilityMod(actor, "str");
    if (!Number.isFinite(value)) return null;
    return { label: game.i18n.format("ACKS-MONSTERS.strength.wielded", { score, cite: game.i18n.localize("ACKS-MONSTERS.strength.page") }), value };
  }
  const average = formulaAverage(weapon.system?.damage?.base?.formula);
  if (average === null) return null;
  const bonus = strengthAttackBonus(score, average);
  if (!bonus || !Number.isFinite(bonus.value)) return null;
  const cite = bonus.cite ?? game.i18n.localize("ACKS-MONSTERS.strength.page");
  return { label: game.i18n.format("ACKS-MONSTERS.strength.natural", { score, average: figure(average), cite }), value: bonus.value };
}

/**
 * The attack seam's contributor for a monster's Strength. Each answer fails
 * safe to the list it was given.
 */
export const strengthContributor = Object.freeze({
  attack(ctx, attackType, modifiers) {
    if (attackType !== MELEE) return modifiers;
    const row = rowFor(ctx);
    return row ? [...modifiers, row] : modifiers;
  },
  damage(ctx, attackType, modifiers) {
    if (attackType !== MELEE && attackType !== THROWN) return modifiers;
    const row = rowFor(ctx);
    return row ? [...modifiers, row] : modifiers;
  },
});

/** Take the seat at the attack seam. It answers to no setting. */
export function registerStrengthContributor() {
  addAttackContributor(strengthContributor);
}
