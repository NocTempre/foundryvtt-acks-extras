/* global game */
/**
 * Who is riding in what.
 *
 * The same shape as `mount.mjs`, and deliberately so: the binding is a flag on
 * the PASSENGER naming the vehicle, not a list on the vehicle naming its
 * passengers. One writer per fact means a passenger can only be aboard one
 * thing, and a vehicle deleted out from under them leaves a dangling uuid that
 * reads as "not aboard" rather than a roster entry pointing at nothing.
 *
 * It lives in lib because two features need it and neither owns it: vehicles
 * charges passengers against its hold, and formation stops a passenger's own
 * legs from setting the party's pace. A carter walking beside the wagon and a
 * merchant sitting in it are the same distance along the road, and the party
 * moves at the wagon's speed rather than the merchant's.
 */
import { MODULE_ID } from "./constants.mjs";

/** The flag a passenger carries naming the vehicle they are in. */
export const ABOARD_FLAG = "aboard";

/** RR ch. 7: a passenger rides as fifty stone of cargo. */
export const PASSENGER_STONE = 50;

const uuidOf = (doc) => doc?.uuid ?? null;

/** The vehicle this actor is riding in, or null. */
export function vehicleOf(actor) {
  const uuid = actor?.getFlag?.(MODULE_ID, ABOARD_FLAG);
  if (!uuid) return null;
  return game.actors?.find?.((a) => a.uuid === uuid) ?? null;
}

/** Is this actor riding in anything? */
export const isAboard = (actor) => !!actor?.getFlag?.(MODULE_ID, ABOARD_FLAG);

/**
 * Everyone riding in this vehicle. Derived by asking the passengers rather
 * than stored on the vehicle, so the two can never disagree.
 */
export function passengersOf(vehicle) {
  const uuid = uuidOf(vehicle);
  if (!uuid) return [];
  return (game.actors ?? []).filter((a) => a.getFlag?.(MODULE_ID, ABOARD_FLAG) === uuid);
}

/** Put someone aboard. Boarding a second vehicle simply moves them. */
export async function board(actor, vehicle) {
  const uuid = uuidOf(vehicle);
  if (!actor || !uuid) return { ok: false, reason: "missing" };
  if (actor.uuid === uuid) return { ok: false, reason: "itself" };
  await actor.setFlag(MODULE_ID, ABOARD_FLAG, uuid);
  return { ok: true };
}

/** Take someone off. */
export async function disembark(actor) {
  if (!isAboard(actor)) return { ok: false, reason: "notAboard" };
  await actor.unsetFlag(MODULE_ID, ABOARD_FLAG);
  return { ok: true };
}

/**
 * What the people aboard weigh against the hold, in stone.
 *
 * Named passengers and the anonymous count are added, not maxed: a Judge who
 * types "12 pilgrims" and then drops two player characters aboard has
 * fourteen people in the cart, not twelve.
 */
export function passengerStone(vehicle, { perPassenger = PASSENGER_STONE } = {}) {
  const named = passengersOf(vehicle).length;
  const anonymous = Math.max(0, Number(vehicle?.system?.cargo?.passengers) || 0);
  return (named + anonymous) * perPassenger;
}
