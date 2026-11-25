/**
 * What drinking from a beastman's consumable does, as data. Pure and
 * Foundry-free: `swigOutcome` takes the item's `drink` flag (the figures its
 * gear row printed, `equipment/constants.mjs` `ITEM_FLAGS.DRINK`), who drinks
 * and whether that drinker's save is known, and answers what is owed or what
 * happens; the caller that asks the save, heals through `adjustHp` and writes
 * the condition is not here. It moves to lib when the item carrier that
 * consumes it does. A figure the row left blank is null in the outcome, and the
 * caller writes nothing for a null: no figure is ever substituted.
 */

/**
 * Who drinks, in this module's words until a kind reader exists: the item's
 * own bearer kind, or a human or demi-human.
 */
export const DRINKER_KIND = Object.freeze({ bearer: "bearer", human: "human" });

/** What a swig can come to. */
export const SWIG_OUTCOME = Object.freeze({ heal: "heal", save: "save", condition: "condition" });

/** The turn-life record a failed save's condition lasts by: it ends at the end of its bearer's next turn (`lib/turn-life.mjs`). The caller adds the fight and the combatant. */
const CONDITION_LIFE = Object.freeze({ edge: "end", count: 1 });

const orNull = (v) => (v === undefined || v === "" ? null : v);

/**
 * The outcome of one swig, or null where the drinker's kind is unknown, which
 * the caller sends to the Judge (a player is blocked, a Judge is warned).
 *
 *   - the bearer's kind: `{kind: "heal", dice: healDice}`;
 *   - a human or demi-human with `saved` not yet known (anything but true or
 *     false): `{kind: "save", saveKind}`, a save owed;
 *   - `saved` true: `{kind: "heal", dice: successHealDice}`;
 *   - `saved` false: `{kind: "condition", condition, life: {edge: "end",
 *     count: 1}}`, the catalogue id (null where the row's word did not fold).
 *
 * @param {{drinkerKind?: string, drink?: object|null, saved?: boolean|null}} input
 * @returns {{kind: "heal", dice: string|null}|{kind: "save", saveKind: string|null}|{kind: "condition", condition: string|null, life: {edge: string, count: number}}|null}
 */
export function swigOutcome({ drinkerKind, drink, saved } = {}) {
  if (!drink || typeof drink !== "object") return null;
  if (drinkerKind === DRINKER_KIND.bearer) return { kind: SWIG_OUTCOME.heal, dice: orNull(drink.healDice) };
  if (drinkerKind !== DRINKER_KIND.human) return null;
  if (saved === true) return { kind: SWIG_OUTCOME.heal, dice: orNull(drink.successHealDice) };
  if (saved === false) return { kind: SWIG_OUTCOME.condition, condition: orNull(drink.condition), life: { ...CONDITION_LIFE } };
  return { kind: SWIG_OUTCOME.save, saveKind: orNull(drink.saveKind) };
}
