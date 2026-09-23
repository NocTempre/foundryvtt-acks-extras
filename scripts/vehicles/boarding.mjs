/* global game, ui */
/**
 * Loading a party into a wagon, and putting them back where they were —
 * both directions in one action, since mass boarding by hand is twelve
 * clicks a Judge repeats at every ford.
 *
 * **Board for best pace**: aboard everyone the vehicle carries faster than
 * their own legs, slowest first, until the hold is full.
 *
 * **Re-board as before**: restores the arrangement snapshotted just before
 * the last change that boarded or moved anyone.
 */
import { MODULE_ID, LANG_PREFIX, VEHICLE_TYPE } from "./constants.mjs";
import { attach, detach, attachedTo, snapshotArrangement, restoreArrangement } from "../lib/attachment.mjs";
import { borneBy6, load6 } from "../lib/capacity.mjs";
import { STONE } from "../lib/item-model.mjs";
import { landSpeed, cargoRemaining } from "./vehicle-speed.mjs";
import { draftPullOf } from "./occupants.mjs";

/** Where the last arrangement is kept, so it can be put back. */
export const ARRANGEMENT_FLAG = "lastArrangement";

/**
 * What one actor costs a hold: their TRUE mass — body (or bodies, for a
 * stack) plus what they carry. `_vehicle` stays for API compatibility and
 * is no longer read. See docs/vehicles/DECISIONS.md, "Weights are true;
 * the printed rate prices the unnamed head."
 */
export function passengerCost(actor, _vehicle) {
  return borneBy6(actor) / STONE;
}

/**
 * Put aboard everyone who would travel faster for it.
 *
 * @param {Actor} vehicle
 * @param {Actor[]} candidates the party's members, on foot or not
 * @param {object} [o]
 * @param {object} [o.ground] terrain the vehicle is crossing, for its pace
 * @param {(a: Actor) => number} [o.speedOf] each candidate's own pace
 */
export async function boardForBestPace(vehicle, candidates = [], { ground = null, speedOf = null } = {}) {
  if (vehicle?.type !== VEHICLE_TYPE || vehicle.system?.kind !== "land") {
    return { ok: false, reason: "notALandVehicle" };
  }
  const ownSpeed = speedOf ?? ((a) => Number(a?.system?.movement?.base) || 0);

  // Remember where everyone was BEFORE this, so it can be undone.
  await vehicle.setFlag(MODULE_ID, ARRANGEMENT_FLAG, snapshotArrangement(candidates));

  const aboardStone = () => load6(vehicle) / STONE;
  // The real team, harnessed attachments included, stated to the arithmetic.
  const paceNow = () => landSpeed(vehicle.system, aboardStone(), ground, { pull: draftPullOf(vehicle) }).feetPerTurn;

  // Slowest first: that member is the one holding the party back.
  const walking = candidates
    .filter((a) => a && !attachedTo(vehicle, "passenger").some((p) => p.uuid === a.uuid))
    .sort((a, b) => ownSpeed(a) - ownSpeed(b));

  const boarded = [];
  for (const actor of walking) {
    const pace = paceNow();
    // Riding must be an improvement for THIS member, or they walk.
    if (ownSpeed(actor) >= pace) continue;
    const named = attachedTo(vehicle, "passenger").reduce((sum, p) => sum + passengerCost(p, vehicle), 0);
    const hold = cargoRemaining(vehicle.system, aboardStone(), named);
    if (hold.free < passengerCost(actor, vehicle)) break; // the hold is full
    await attach(actor, vehicle, "passenger");
    boarded.push(actor.name);
  }

  const speed = paceNow();
  if (!boarded.length) {
    ui.notifications?.info(game.i18n.format(`${LANG_PREFIX}.board.nobody`, { name: vehicle.name }));
  } else {
    ui.notifications?.info(game.i18n.format(`${LANG_PREFIX}.board.boarded`, {
      n: boarded.length, name: vehicle.name, speed,
    }));
  }
  return { ok: true, boarded, speed };
}

/** Put everyone back where the last change found them. */
export async function reboardLast(vehicle) {
  const snapshot = vehicle?.getFlag?.(MODULE_ID, ARRANGEMENT_FLAG);
  if (!Array.isArray(snapshot)) {
    ui.notifications?.warn(game.i18n.localize(`${LANG_PREFIX}.board.nothingToRestore`));
    return { ok: false, reason: "nothing" };
  }
  // Any PASSENGER aboard now who was not aboard then gets off — restoring an
  // empty arrangement must not leave them stranded. Passengers only: boarding
  // never touched the team or crew, so this must not unharness the horses.
  const remembered = new Set(snapshot.map((r) => r.actor));
  for (const p of attachedTo(vehicle, "passenger")) if (!remembered.has(p.uuid)) await detach(p);

  const n = await restoreArrangement(snapshot);
  ui.notifications?.info(game.i18n.format(`${LANG_PREFIX}.board.restored`, { n }));
  return { ok: true, restored: n };
}
