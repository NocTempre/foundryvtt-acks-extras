/**
 * Where a cast stands in a fight, and which declared spell it resolves.
 * FOUNDRY-FREE: the combat, the caster's combatant and the caster's records are
 * read by the caller and passed in.
 *
 * A fight has begun when its `started` is set or core's own `acks.initDone`
 * flag is. At the caster's turn (the tracker's current combatant is the
 * caster's, and its initiative is rolled) a cast resolves; at any other moment
 * of a begun fight it is declared; with no begun fight holding the caster it is
 * free, as a cast always was. A casting time longer than a round, in a begun
 * fight, is a fourth moment, `long`: it is never declared, and the plan decides
 * whether the seat may cast it at all.
 */
import { TIME_UNITS } from "../lib/magic-vocab.mjs";

/** The moments a cast can fall at. */
export const MOMENT = Object.freeze({ free: "free", declare: "declare", resolve: "resolve", long: "long" });

/**
 * Is a casting time longer than a round? Judged by its unit, with no conversion
 * figure: a stated time of more than one round, or of any other unit of time.
 * A time with no unit, or one that is not a stated time, is not.
 *
 * @param {{shape?: string, value?: number|null, unit?: string}|null} [time]  a casting time as the spell's flag holds one
 */
export function longerThanRound(time) {
  if (time?.shape !== "timed" || !Object.hasOwn(TIME_UNITS, time.unit)) return false;
  return time.unit === "rounds" ? Number(time.value) > 1 : true;
}

/** Has this fight begun? */
export const begun = (combat) => Boolean(combat) && (combat.started === true || combat.flags?.acks?.initDone === true);

/**
 * The begun fight that holds a creature, with its combatant in it, or null where
 * no begun fight does. A token, where one is given, is matched to a combatant by
 * its own id first, since one linked actor can stand in a fight as two tokens;
 * otherwise the actor is, by identity or by uuid. The first begun fight to hold
 * it answers.
 *
 * @param {Iterable<object|null>} combats  the fights to look in, the viewed one first
 * @param {{actor: object, token?: {id?: string}|null}} of
 * @returns {{combat: object, combatant: object}|null}
 */
export function fightHolding(combats, { actor, token = null } = {}) {
  for (const combat of combats ?? []) {
    if (!begun(combat)) continue;
    const all = Array.from(combat.combatants ?? []);
    const combatant =
      (token?.id ? all.find((c) => (c.tokenId ?? c.token?.id) === token.id) : null) ?? all.find((c) => c.actor === actor || (c.actor?.uuid && c.actor.uuid === actor?.uuid));
    if (combatant) return { combat, combatant };
  }
  return null;
}

/**
 * The moment of a cast.
 *
 * @param {object} from
 * @param {{started?: boolean, flags?: object, combatant?: {id: string}|null}|null} from.combat  the fight holding the caster's combatant
 * @param {{id: string, initiative?: number|null}|null} from.combatant  the caster's combatant in that fight
 * @param {{shape?: string, value?: number|null, unit?: string}|null} [from.castingTime]  the time the cast takes (the procedure's, else the spell's); one longer than a round makes the moment `long`
 * @returns {"free"|"declare"|"resolve"|"long"}
 */
export function castMoment({ combat = null, combatant = null, castingTime = null } = {}) {
  if (!begun(combat) || !combatant) return MOMENT.free;
  if (longerThanRound(castingTime)) return MOMENT.long;
  const acting = combat.combatant?.id === combatant.id && combatant.initiative != null;
  return acting ? MOMENT.resolve : MOMENT.declare;
}

/**
 * The caster's declarations that bear on one cast: among the records carrying a
 * pending declaration for this fight, the one for this spell and still good
 * (`valid`), the one for this spell that was lost (`lost`), and any other still
 * good (`other`, a different spell declared). `hand` is true when the combatant
 * carries a hand-set `prepareSpell` with no record of the module's to explain it.
 *
 * @param {Array<{castId: string, pending?: {spellUuid: string, combatId: string, lost?: object}}>} records  the caster's records, as `spellEffectOf` reads them
 * @param {{spellUuid: string, combatId?: string|null, prepareSpell?: boolean}} of
 * @returns {{valid: object|null, lost: object|null, other: object|null, hand: boolean}}
 */
export function declarationOf(records, { spellUuid, combatId = null, prepareSpell = false } = {}) {
  const here = (records ?? []).filter((r) => r?.pending && combatId != null && r.pending.combatId === combatId);
  const mine = here.filter((r) => r.pending.spellUuid === spellUuid);
  const valid = mine.find((r) => !r.pending.lost) ?? null;
  const lost = mine.find((r) => r.pending.lost) ?? null;
  const other = here.find((r) => r.pending.spellUuid !== spellUuid && !r.pending.lost) ?? null;
  return { valid, lost, other, hand: Boolean(prepareSpell) && !valid && !lost && !other };
}
