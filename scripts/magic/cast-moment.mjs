/**
 * Where a cast stands in a fight, and which declared spell it resolves.
 * FOUNDRY-FREE: the combat, the caster's combatant and the caster's records are
 * read by the caller and passed in.
 *
 * A fight has begun when its `started` is set or core's own `acks.initDone`
 * flag is. At the caster's turn (the tracker's current combatant is the
 * caster's, and its initiative is rolled) a cast resolves; at any other moment
 * of a begun fight it is declared; with no begun fight holding the caster it is
 * free, as a cast always was.
 */

/** The three moments a cast can fall at. */
export const MOMENT = Object.freeze({ free: "free", declare: "declare", resolve: "resolve" });

/** Has this fight begun? */
const begun = (combat) => Boolean(combat) && (combat.started === true || combat.flags?.acks?.initDone === true);

/**
 * The moment of a cast.
 *
 * @param {object} from
 * @param {{started?: boolean, flags?: object, combatant?: {id: string}|null}|null} from.combat  the fight holding the caster's combatant
 * @param {{id: string, initiative?: number|null}|null} from.combatant  the caster's combatant in that fight
 * @returns {"free"|"declare"|"resolve"}
 */
export function castMoment({ combat = null, combatant = null } = {}) {
  if (!begun(combat) || !combatant) return MOMENT.free;
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
