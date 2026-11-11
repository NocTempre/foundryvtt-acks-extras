/* global game, CONFIG, ActiveEffect */
/**
 * A status condition the module holds on a creature on behalf of something it
 * tracks (a role, a posture), kept in step with that thing's state.
 *
 * The effect is the module's, not the user's: it stands under a fixed `_id`
 * and carries a marker under `flags["acks-extras"]` naming its holder. Hold
 * and release read and write only what carries that marker, so the same
 * status set by hand (a token HUD toggle, a spell) is never touched, and a
 * second copy of the marked effect is collapsed to one. A held effect is a
 * managed one (`managed-effects.mjs`): a caller registers `HELD_CONDITION_FLAG`
 * there so a hand-deletion is refused, and every delete here authorizes itself.
 *
 * Both calls are desired-state: asking for what already stands writes nothing.
 */
import { MODULE_ID } from "./constants.mjs";
import { managedDelete } from "./managed-effects.mjs";

/** Flag key under `flags["acks-extras"]` on a held effect; its value names the holder. */
export const HELD_CONDITION_FLAG = "heldCondition";

/**
 * What a holder keeps on a creature.
 *
 * @typedef {object} HeldCondition
 * @property {string} holder   names the thing that keeps it, stored in the marker flag
 * @property {string} statusId a status id of `CONFIG.statusEffects`
 * @property {string} id       the effect's fixed `_id`: 16 letters and digits, unique per holder
 */

/** The effects on `actor` the holder put there, whatever else carries the same status. */
export function heldEffects(actor, { holder }) {
  return [...(actor?.effects ?? [])].filter((e) => e.getFlag?.(MODULE_ID, HELD_CONDITION_FLAG) === holder);
}

/** The effect data for a held status: core's own status effect where it can build one, a plain one where it cannot. */
async function effectData({ statusId, id, holder }, description) {
  let base = null;
  try {
    const made = await ActiveEffect.fromStatusEffect?.(statusId);
    base = made?.toObject?.() ?? null;
  } catch {
    base = null;
  }
  if (!base) {
    const config = CONFIG.statusEffects?.find?.((s) => s.id === statusId);
    base = { name: config?.name ? game.i18n.localize(config.name) : statusId, img: config?.img ?? config?.icon, statuses: [statusId] };
  }
  return {
    ...base,
    _id: id,
    ...(description ? { description } : {}),
    flags: { ...(base.flags ?? {}), [MODULE_ID]: { ...(base.flags?.[MODULE_ID] ?? {}), [HELD_CONDITION_FLAG]: holder } },
  };
}

/**
 * Make `actor` carry the held condition: create the marked effect when none
 * stands, restore its status when an edit dropped it, leave a disabled one
 * disabled, and delete every copy past the first.
 *
 * @param {Actor} actor a world actor, or the actor of an unlinked token
 * @param {HeldCondition} held
 * @param {{description?: string}} [options] the effect's description, for a new one
 * @returns {Promise<boolean>} whether anything was written
 */
export async function holdCondition(actor, held, { description = "" } = {}) {
  if (!actor?.effects) return false;
  const mine = heldEffects(actor, held);
  const keep = mine.find((e) => e.id === held.id) ?? mine[0] ?? null;
  const extras = mine.filter((e) => e !== keep);
  let wrote = false;
  if (extras.length) {
    await actor.deleteEmbeddedDocuments("ActiveEffect", extras.map((e) => e.id), managedDelete());
    wrote = true;
  }
  if (!keep) {
    const data = await effectData(held, description);
    // A free `_id` stands; an id some other effect already holds cannot be
    // claimed, and the effect takes a fresh one.
    if (actor.effects.has?.(held.id)) delete data._id;
    await actor.createEmbeddedDocuments("ActiveEffect", [data], data._id ? { keepId: true } : {});
    return true;
  }
  // A disabled one is a hand's answer ("not on this character"), and stays so.
  if (!keep.disabled && !keep.statuses?.has?.(held.statusId)) {
    await keep.update({ statuses: [held.statusId] });
    wrote = true;
  }
  return wrote;
}

/**
 * Take the held condition off `actor`: delete every effect the holder marked and
 * nothing else.
 *
 * @param {Actor} actor
 * @param {HeldCondition} held
 * @returns {Promise<boolean>} whether anything was deleted
 */
export async function releaseCondition(actor, held) {
  const mine = heldEffects(actor, held);
  if (!mine.length) return false;
  await actor.deleteEmbeddedDocuments("ActiveEffect", mine.map((e) => e.id), managedDelete());
  return true;
}
