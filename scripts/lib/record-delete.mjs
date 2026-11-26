/**
 * The one way item-run deletes its records (ActiveEffects) from an actor. Two
 * paths end the same record when a reach goes, its exit moment and its
 * teardown, and each reads the actor before the other's delete has come back;
 * the server refuses a delete that names an effect already gone, and the
 * refusal stops whatever the caller does next. Deletes on one actor therefore
 * run one at a time on this client, and each names only the ids the actor still
 * holds when its turn comes. Module-internal: not on the lib api.
 */

/** The tail of each actor's deletes on this client. */
const tails = new WeakMap();

/** Whether an actor still holds an effect, for a collection or a plain list of effects. */
function holds(actor, id) {
  const effects = actor?.effects;
  if (typeof effects?.has === "function") return effects.has(id);
  if (typeof effects?.get === "function" && effects.get(id)) return true;
  return [...(effects ?? [])].some((effect) => effect?.id === id);
}

/**
 * Delete the effects `ids` name from `actor`, after every delete this client
 * already has in flight on it, passing over an id it no longer holds.
 * @param {Actor} actor
 * @param {string[]} ids
 * @param {object} [options]  the delete's options, as `deleteEmbeddedDocuments` takes them
 * @returns {Promise<string[]>} the ids this call deleted
 */
export function deleteRecords(actor, ids, options) {
  const run = async () => {
    const present = ids.filter((id) => holds(actor, id));
    if (present.length) await actor.deleteEmbeddedDocuments("ActiveEffect", present, ...(options === undefined ? [] : [options]));
    return present;
  };
  const turn = (tails.get(actor) ?? Promise.resolve()).then(run);
  tails.set(actor, turn.catch(() => {}));
  return turn;
}
