/**
 * A weapon with no damage formula: how it is told, what answer fills it, and
 * what saving that answer writes. Foundry-free; the prompt that asks is
 * `damage-prompt.mjs`.
 *
 * No die stands in for a missing formula anywhere in the module. The field
 * stays blank until the first attack with the weapon asks for one, and the
 * answer is saved to the weapon as its base formula. Where a layer was
 * captured over the blank (the property layers' `pristine` snapshot, a named
 * item's `base`), the answer becomes that captured base too, so the layers
 * apply over it once and a later recompute does not compound them.
 */
import { MODULE_ID, ITEM_FLAGS } from "./constants.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";
import { damageFormulaOf, PRISTINE } from "./properties.mjs";

/** The base damage formula's document field. */
export const DAMAGE_FIELD = "system.damage.base.formula";

const blank = (v) => !String(v ?? "").trim();
const flagOf = (item, key) => item?.getFlag?.(MODULE_ID, key) ?? item?.flags?.[MODULE_ID]?.[key] ?? null;

/** A formula that is only a signed flat figure ("-1", "+ 2"): what a layer leaves over a blank die. */
const bareFlat = (v) => /^[+-]\s*\d+$/.test(String(v ?? "").trim());

/**
 * Whether this item is a weapon whose damage formula was never stated: its
 * base formula is blank, or the property layers' snapshot holds a blank one
 * and the field carries only the flat figure a layer wrote over it.
 */
export function needsDamageFormula(item) {
  if (item?.type !== ITEM_TYPE.weapon) return false;
  const now = damageFormulaOf(item);
  if (blank(now)) return true;
  const pristine = flagOf(item, PRISTINE);
  return !!pristine && blank(pristine.damage) && bareFlat(now);
}

/**
 * The answer typed into the prompt, trimmed, when it is a formula the dice
 * roller parses; null otherwise.
 * @param {string} text what was typed
 * @param {(formula: string) => boolean} validate the roller's own check (`Roll.validate`)
 * @returns {string|null}
 */
export function damageAnswer(text, validate) {
  const formula = String(text ?? "").trim();
  if (!formula) return null;
  try {
    return validate(formula) ? formula : null;
  } catch {
    return null;
  }
}

/**
 * What saving `formula` onto a blank weapon writes: the base formula itself,
 * and the same formula as the captured base of each layer that captured a
 * blank one. `layers` says which layers must then be applied again over it.
 * @returns {{update: object, layers: {pristine: boolean, named: boolean}}}
 */
export function savedFormulaUpdates(item, formula) {
  const update = { [DAMAGE_FIELD]: formula };
  const pristine = flagOf(item, PRISTINE);
  const named = flagOf(item, ITEM_FLAGS.NAMED);
  const layers = { pristine: false, named: false };
  if (pristine && blank(pristine.damage)) {
    update[`flags.${MODULE_ID}.${PRISTINE}.damage`] = formula;
    layers.pristine = true;
  }
  if (named?.base && blank(named.base.damage)) {
    update[`flags.${MODULE_ID}.${ITEM_FLAGS.NAMED}.base.damage`] = formula;
    layers.named = true;
  }
  return { update, layers };
}
