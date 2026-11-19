/* global game, foundry */
/**
 * The Foundry half of a place's THINGS: read the list off a place actor and
 * write it back. The list is one flag, `flags["acks-extras"].things`, written
 * whole by a GM client as a `ForcedReplacement` so a removed thing is gone
 * rather than merged back; its shape and every pure operation on it live in
 * `place-things-logic.mjs`.
 */
import { MODULE_ID } from "./constants.mjs";
import { addThing, normalizeThings, patchThing, removeThing, resetThing, reviseThings } from "./place-things-logic.mjs";

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

/**
 * Patch one thing of a place (`patchThing`) and write the whole list back. The
 * list is read at the moment of the write and the thing is found by id, so a
 * caller holding an older snapshot overwrites only the keys it names. A GM
 * client is the only writer; any other seat, a missing place or an id the place
 * no longer holds writes nothing.
 *
 * @param {Actor} place the location actor
 * @param {string} id the thing's id
 * @param {{hidden?: boolean, state?: object}} patch as `patchThing` takes it
 * @returns {Promise<object[]|null>} the written list, or null when nothing was written
 */
export async function updateThingOn(place, id, patch) {
  if (!place || !game.user?.isGM) return null;
  const held = thingsOf(place);
  if (!held.some((thing) => thing.id === id)) return null;
  const next = patchThing(held, id, patch);
  await place.update({ [`flags.${MODULE_ID}.${THINGS_FLAG}`]: foundry.data.operators.ForcedReplacement.create(next) });
  return next;
}

/** Write a list whole, replacing what the flag held rather than merging into it. */
function writeThings(place, list) {
  return place.update({ [`flags.${MODULE_ID}.${THINGS_FLAG}`]: foundry.data.operators.ForcedReplacement.create(list) });
}

/**
 * Change the authored half of some of a place's things (`reviseThings`) and
 * write the whole list back. `revise` is handed the list as read at the moment
 * of the write and answers the edits to make, so what an edit keeps is what the
 * place holds now and never a caller's older snapshot or an overlaid view of it.
 * A GM client is the only writer; any other seat, a missing place, or no edit
 * writes nothing.
 *
 * @param {Actor} place the location actor
 * @param {(list: object[]) => Array<{id: string, patch: object}>} revise the edits, from the list as stored
 * @returns {Promise<object[]|null>} the written list, or null when nothing was written
 */
export async function reviseThingsOn(place, revise) {
  if (!place || !game.user?.isGM) return null;
  const held = thingsOf(place);
  const edits = revise(held);
  if (!Array.isArray(edits) || !edits.length) return null;
  const next = reviseThings(held, edits);
  await writeThings(place, next);
  return next;
}

/* -------------------------------------------- */
/*  Removing and resetting                       */
/* -------------------------------------------- */

/**
 * Remove one thing from a place and write the whole list back. The list is read
 * at the moment of the write. A GM client is the only writer; any other seat, a
 * missing place or an id the place no longer holds writes nothing.
 *
 * @param {Actor} place the location actor
 * @param {string} id the thing's id
 * @returns {Promise<object[]|null>} the written list, or null when nothing was written
 */
export async function removeThingFrom(place, id) {
  if (!place || !game.user?.isGM) return null;
  const held = thingsOf(place);
  if (!held.some((thing) => thing.id === id)) return null;
  const next = removeThing(held, id);
  await writeThings(place, next);
  return next;
}

/**
 * Reset one thing of a place: its `state` is cleared and nothing else changes
 * (`resetThing`). `patchThing` only ever sets keys, so a Reset is its own write.
 * A GM client is the only writer; any other seat, a missing place or an id the
 * place no longer holds writes nothing.
 *
 * @param {Actor} place the location actor
 * @param {string} id the thing's id
 * @returns {Promise<object[]|null>} the written list, or null when nothing was written
 */
export async function resetThingIn(place, id) {
  if (!place || !game.user?.isGM) return null;
  const held = thingsOf(place);
  if (!held.some((thing) => thing.id === id)) return null;
  const next = resetThing(held, id);
  await writeThings(place, next);
  return next;
}
