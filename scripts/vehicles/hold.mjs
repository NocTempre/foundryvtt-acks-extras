/**
 * What a vehicle's hold is carrying and how much room is left in it — the one
 * answer the sheet's bar, boarding, the land speed tiers and a market's
 * loading all read, so a load a market sells into a wagon is refused at the
 * same line the sheet's bar turns red.
 *
 * The weights are the occupant feeder's: a named actor costs its true mass,
 * and the vehicle's per-head rate prices only the unnamed. Passengers draw on
 * the hold on every vehicle (RR ch. 4 on land, ch. 7 at sea), crew bodies
 * never do, a non-motive role's gear does, and hands short of a vessel's
 * complement free their berths for cargo (berths.mjs owns that judgment).
 *
 * `holdFrom` is the pure arithmetic over plain data; `holdOf` reads the
 * documents.
 */
import { load6 } from "../lib/capacity.mjs";
import { STONE } from "../lib/item-model.mjs";
import { occupantsOf } from "./occupants.mjs";
import { cargoRemaining } from "./vehicle-speed.mjs";
import { crewTradeCredit, unnamedCrewGearStone } from "./berths.mjs";

/** Heads in a list of occupant rows: a stack counts every body it stands for. */
const headsOf = (rows) => rows.reduce((n, o) => n + Math.max(0, o.bodies ?? 1), 0);

/** A column of occupant rows, summed. */
const sumOf = (rows, key) => rows.reduce((n, o) => n + (Number(o[key]) || 0), 0);

/**
 * The hold of one vehicle, from plain data.
 *
 * @param {object} sys the vehicle's `system` data
 * @param {object} [o]
 * @param {number} [o.aboardStone] what the vehicle's own inventory weighs
 * @param {object[]} [o.occupants] occupants.mjs rows
 * @returns {{capacity: number, used: number, free: number, over: boolean,
 *   aboardStone: number, passengerStone: number, cargoActorStone: number,
 *   marineGear: number, trade: object|null, pct: number}} `used` is the whole
 *   load the vehicle bears — the figure a land vehicle's speed tiers are
 *   priced against; `trade` is the crew-for-cargo credit already folded into
 *   `capacity`.
 */
export function holdFrom(sys, { aboardStone = 0, occupants = [] } = {}) {
  const namedPassengerStone = sumOf(occupants.filter((o) => o.role === "passenger"), "stone");
  const cargoActorStone = sumOf(occupants.filter((o) => o.role === "cargo"), "stone");
  const marineGear = sumOf(occupants.filter((o) => o.cargoGear), "gearStone") + unnamedCrewGearStone(sys);
  const base = cargoRemaining(sys, aboardStone + cargoActorStone + marineGear, namedPassengerStone);
  const trade = crewTradeCredit(sys, headsOf(occupants.filter((o) => o.role === "crew")));
  const capacity = base.capacity + (trade?.stone ?? 0);
  const free = capacity - base.used;
  return {
    capacity,
    used: base.used,
    free,
    over: free < 0,
    aboardStone,
    passengerStone: base.passengerStone,
    cargoActorStone,
    marineGear,
    trade,
    // A bar reads faster than two numbers when the answer is "nearly full".
    pct: capacity > 0 ? Math.min(100, Math.round((base.used / capacity) * 100)) : 0,
  };
}

/**
 * The hold of a vehicle document: its own inventory weighed by the capacity
 * primitive, and everyone attached to it.
 */
export function holdOf(vehicle) {
  if (!vehicle) return null;
  return holdFrom(vehicle.system, { aboardStone: load6(vehicle) / STONE, occupants: occupantsOf(vehicle) });
}
