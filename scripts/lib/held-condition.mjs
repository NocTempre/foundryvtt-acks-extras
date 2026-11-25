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

/**
 * The data an Active Effect for status `statusId` takes from Foundry: what
 * `ActiveEffect.fromStatusEffect` builds from the registered entry (its name,
 * image, statuses with the ones the entry brings, and its `system.changes`),
 * or, where that method is absent or throws, the registered entry read the same
 * way. An id with no entry still yields its own status. The entry's static
 * `_id` is never handed out: the effect a caller writes is its own document,
 * not the one a token toggle looks for. Every writer of a status effect takes
 * its status data from here, so that what stands for a condition carries the
 * figures the system gives it; the one-count rule is `countsOnce`'s
 * (`roll-mods.mjs`), applied where Foundry applies a change, never by a writer
 * leaving a change out.
 *
 * @param {string} statusId  a status id of `CONFIG.statusEffects`
 * @returns {Promise<{name: string, img?: string, statuses: string[], system?: {changes?: object[]}}>}
 */
export async function statusEffectData(statusId) {
  let base = null;
  try {
    const made = await ActiveEffect.fromStatusEffect?.(statusId);
    base = made?.toObject?.() ?? null;
  } catch {
    base = null;
  }
  if (!base) {
    const config = CONFIG.statusEffects?.find?.((s) => s.id === statusId);
    base = {
      name: config?.name ? game.i18n.localize(config.name) : statusId,
      img: config?.img ?? config?.icon,
      statuses: [...new Set([statusId, ...(config?.statuses ?? [])])],
      ...(config?.system ? { system: structuredClone(config.system) } : {}),
    };
  }
  const { _id: _static, ...data } = base;
  return data;
}

/**
 * The statuses the registered entry for `statusId` brings along with it (its
 * implicit statuses), without the id itself. Read from `CONFIG.statusEffects`;
 * empty for an id with no entry or an entry that brings none.
 *
 * @param {string} statusId
 * @returns {string[]}
 */
export function impliedStatuses(statusId) {
  const config = CONFIG.statusEffects?.find?.((s) => s.id === statusId);
  return Array.from(config?.statuses ?? []).filter((id) => id !== statusId);
}

/** The effect data for a held status: `statusEffectData` under the holder's fixed id and marker. */
async function effectData({ statusId, id, holder }, description) {
  const base = await statusEffectData(statusId);
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
  // A disabled one is a hand's answer ("not on this character"), and stays so. The restore writes the
  // status list the entry builds, the statuses it brings included.
  if (!keep.disabled && !keep.statuses?.has?.(held.statusId)) {
    await keep.update({ statuses: (await statusEffectData(held.statusId)).statuses });
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
