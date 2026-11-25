/* global fromUuidSync */
/**
 * What a burst hand-on does to a vessel: the structural hit points a burst's
 * rolled figure takes, written through the one lib registration
 * (`registerStructureDamage`) that vehicles fills.
 *
 * A burst that reaches a hull deals its whole figure to structure, the rule's
 * "everything" class (`siege` in `SHARE_SOURCES`, no imported share to read).
 * The write goes through `actor.update` on `system.shp.value`, so the
 * `updateActor` reaction in `module.mjs` (the sinking clock) fires as it does
 * for a hand edit. Who may hand a burst on is decided by the lib before this
 * runs: Foundry's ownership of the vehicle, nothing of this feature's own.
 */
import { VEHICLE_TYPE } from "./constants.mjs";
import { damageToVessel, hullValue } from "./vessel-damage.mjs";

/**
 * Lowers a vehicle's `system.shp.value` by `total`, never below zero.
 *
 * @param {{vehicleUuid: string, total: number}} p a token's uuid or an actor's
 * @param {{resolve?: function}} [o] `resolve` maps a uuid to a document
 *   (`fromUuidSync` by default)
 * @returns {Promise<{ok: true, amount: number, value: number}|{ok: false, reason: string}>}
 *   `amount` is the structural damage dealt and `value` the hull left; a
 *   refusal's `reason` is `gone` (no document), `notVehicle`, or `noHull` (a
 *   blank current value is unknown, not a hull to lower)
 */
export async function writeStructureDamage({ vehicleUuid, total }, { resolve = (uuid) => fromUuidSync(uuid) } = {}) {
  const doc = vehicleUuid ? resolve(vehicleUuid) : null;
  const actor = doc?.actor ?? doc;
  if (!actor) return { ok: false, reason: "gone" };
  if (actor.type !== VEHICLE_TYPE) return { ok: false, reason: "notVehicle" };
  const before = hullValue(actor.system);
  if (before === null) return { ok: false, reason: "noHull" };
  const { dealt } = damageToVessel(total, "siege");
  const value = Math.max(0, before - dealt);
  await actor.update({ "system.shp.value": value });
  return { ok: true, amount: dealt, value };
}
