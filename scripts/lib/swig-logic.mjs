/**
 * What drinking from a consumable does, as data. Pure and Foundry-free:
 * `swigOutcome` takes the item's `drink` flag (the figures its gear row printed,
 * `FLAG_DRINK`), who drinks and whether that drinker's save is known, and
 * answers what is owed or what happens; the caller that asks the save, heals
 * through `adjustHp` and writes the condition is not here. `drinkerKindOf`
 * reads who drinks off an actor's creature kinds, and `swigStampPlan` says what
 * a consume item does when it lands on an actor. A figure the row left blank is
 * null in the outcome, and the caller writes nothing for a null: no figure is
 * ever substituted.
 */

/**
 * Who drinks, in this module's words: the item's own bearer kind (the kind key
 * its flag's `ownKind` names), or a human or demi-human.
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

/**
 * Who drinks, read off an actor's creature kinds. `kinds` is the Set of kind
 * keys `actor-read.mjs` `creatureKinds` answers and `ownKind` the kind key the
 * item's drink flag names. The bearer's own kind is checked first: a non-blank
 * `ownKind` the set holds is `DRINKER_KIND.bearer`; else a set holding `human`
 * or `demi-human` is `DRINKER_KIND.human`; else null, a drinker whose kind is
 * unknown.
 *
 * @param {Set<string>|Iterable<string>|null|undefined} kinds
 * @param {string|null|undefined} ownKind
 * @returns {"bearer"|"human"|null}
 */
export function drinkerKindOf(kinds, ownKind) {
  const held = kinds instanceof Set ? kinds : new Set(kinds ?? []);
  if (typeof ownKind === "string" && ownKind.trim() !== "" && held.has(ownKind)) return DRINKER_KIND.bearer;
  if (held.has("human") || held.has("demi-human")) return DRINKER_KIND.human;
  return null;
}

/**
 * What a consume item does when it lands on an actor, `{stamp, roll}`. `stamp`
 * is whether the item's `bearerUuid` is written with the actor's: where it is
 * blank or names another actor. `roll` is whether its swig count is rolled into
 * `left`: only on a hand-on (a bearer already named, and another actor) and only
 * while `left` is null, so a part-drunk jug handed on and a count a Judge typed
 * keep their count and the item's first bearer gets none. A blank `actorUuid`
 * answers neither.
 *
 * @param {{bearerUuid?: string|null, left?: number|null, actorUuid?: string|null}} input
 * @returns {{stamp: boolean, roll: boolean}}
 */
export function swigStampPlan({ bearerUuid, left, actorUuid } = {}) {
  const actor = typeof actorUuid === "string" ? actorUuid : "";
  if (!actor) return { stamp: false, roll: false };
  const bearer = typeof bearerUuid === "string" ? bearerUuid : "";
  const handedOn = bearer !== "" && bearer !== actor;
  return { stamp: bearer === "" || handedOn, roll: handedOn && (left === null || left === undefined) };
}
