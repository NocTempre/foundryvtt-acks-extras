/* global game, foundry */
/**
 * The Foundry half of a place's THINGS: read the list off a place actor and
 * write it back. The list is one flag, `flags["acks-extras"].things`, written
 * whole by a GM client as a `ForcedReplacement` so a removed thing is gone
 * rather than merged back; its shape and every pure operation on it live in
 * `place-things-logic.mjs`.
 */
import { MODULE_ID } from "./constants.mjs";
import { addThing, normalizeThings } from "./place-things-logic.mjs";

/** The flag key, under the module's scope, holding a place's list of things. */
export const THINGS_FLAG = "things";

/** A place's things in their signed shape: a new list, empty when the place has none. */
export function thingsOf(place) {
  return normalizeThings(place?.getFlag?.(MODULE_ID, THINGS_FLAG));
}

/**
 * Add one thing to a place and write the whole list back. The list is read at
 * the moment of the write, so two drops in a row both land. A GM client is the
 * only writer: any other seat is refused and nothing is written.
 *
 * @param {Actor} place the location actor
 * @param {object} thing a thing without an id, as `addThing` takes it
 * @returns {Promise<object[]|null>} the written list, or null when refused
 */
export async function addThingTo(place, thing) {
  if (!place || !game.user?.isGM) return null;
  const next = addThing(thingsOf(place), thing);
  await place.update({ [`flags.${MODULE_ID}.${THINGS_FLAG}`]: foundry.data.operators.ForcedReplacement.create(next) });
  return next;
}
