/**
 * The one way item-run writes its records (ActiveEffects) on an actor. Two
 * paths end the same record when a reach goes, its exit moment and its
 * teardown, and each reads the actor before the other's delete has come back;
 * the server refuses a delete that names an effect already gone, and the
 * refusal stops whatever the caller does next. Two paths hold the same
 * standing part when a reach is raised, and each reads the actor before the
 * other's create has come back; the server refuses a second create of a fixed
 * id. Writes on one actor therefore run one at a time on this client, and each
 * reads the actor when its turn comes. Module-internal: not on the lib api.
 */

/** The tail of each actor's writes on this client. */
const tails = new WeakMap();

/** Whether an actor still holds an effect, for a collection or a plain list of effects. */
function holds(actor, id) {
  const effects = actor?.effects;
  if (typeof effects?.has === "function") return effects.has(id);
  if (typeof effects?.get === "function" && effects.get(id)) return true;
  return [...(effects ?? [])].some((effect) => effect?.id === id);
}

/**
 * Run `run` on `actor` after every write this client already has in flight on
 * it. A read of the actor that decides a write belongs inside `run`, since the
 * actor is only current once the writes before it have come back. A write that
 * throws leaves the actor's queue running for the next.
 * @param {Actor} actor
 * @param {() => Promise<*>} run
 * @returns {Promise<*>} what `run` answered
 */
export function inTurn(actor, run) {
  const turn = (tails.get(actor) ?? Promise.resolve()).then(run);
  tails.set(actor, turn.catch(() => {}));
  return turn;
}

/**
 * Delete the effects `ids` name from `actor`, after every write this client
 * already has in flight on it, passing over an id it no longer holds.
 * @param {Actor} actor
 * @param {string[]} ids
 * @param {object} [options]  the delete's options, as `deleteEmbeddedDocuments` takes them
 * @returns {Promise<string[]>} the ids this call deleted
 */
export function deleteRecords(actor, ids, options) {
  return inTurn(actor, async () => {
    const present = ids.filter((id) => holds(actor, id));
    if (present.length) await actor.deleteEmbeddedDocuments("ActiveEffect", present, ...(options === undefined ? [] : [options]));
    return present;
  });
}
