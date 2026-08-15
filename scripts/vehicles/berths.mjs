/**
 * What a vehicle has ROOM for, bucket by bucket — and which of those buckets
 * are actually the same room wearing two names.
 *
 * A vehicle is not one pool of space. It has a team in the traces, somebody
 * holding the reins, a crew working it, passengers riding it, and cargo in the
 * back; and which of those a given vehicle HAS, and which of them compete for
 * the same stone, is a property of the vehicle rather than of vehicles in
 * general:
 *
 *  - a **land vehicle** has no berths. A passenger is freight that complains:
 *    they and the cargo come out of one pool, printed as a pair — a small
 *    palanquin carries "one passenger (or up to 15 stone) at 60', or two
 *    passengers (up to 35 stone) at 30'" (RR ch. 4). Note what that pair says:
 *    the exchange is NOT a constant (one berth is 15 stone, two are 17½ each)
 *    and taking a second passenger can cost SPEED as well as room. So the rate
 *    is the vehicle's own `cargo.passengerStone`, never a number assumed here,
 *    and a vehicle whose printed pairs are non-linear states them as speed
 *    tiers like any other load;
 *  - a **vessel** has berths, and her crew is not cargo — but the two TRADE,
 *    at the book's fifty stone per hand (RR ch. 7). Sailing short-handed to
 *    carry more is a real decision, and one this model represents rather than
 *    forbids.
 *
 * WHAT "CREW" MEANS IS PER VEHICLE. Chapter 4 is explicit that the column
 * "indicates the driver, driver and warriors (for chariots), or the passengers
 * (for howdahs)" — so the same field is a driver on a wagon, a fighting
 * complement on a chariot, and the passenger list on a howdah. A sheet that
 * labels it "Crew" everywhere is wrong on two vehicles in three, which is why
 * the bucket carries what it MEANS rather than only what it holds.
 *
 * Collapsing all of this into a single capacity number is what makes a wagon
 * quietly carry a free platoon, so the buckets are derived here and the sheet
 * renders what it is told rather than deciding for itself.
 */

/** The book's berth: what one person costs when nobody has weighed them. */
export const BERTH_STONE = 50;

/**
 * Every bucket a vehicle can have, and what each one holds.
 *
 * `pooled` names the buckets that draw on the cargo hold's stone. `slots`
 * names the ones counted in people rather than weight.
 */
export const BUCKETS = Object.freeze({
  draft: { role: "draft", counts: "animals", pooled: false },
  driver: { role: "crew", counts: "people", pooled: false },
  crew: { role: "crew", counts: "people", pooled: false },
  passengers: { role: "passenger", counts: "people", pooled: true },
  cargo: { role: null, counts: "stone", pooled: true },
});

/**
 * Which buckets THIS vehicle has, in the order a sheet should show them.
 *
 * A land vehicle is pulled and driven; a vessel is crewed. Offering a wagon a
 * crew roster, or a galley a draft team, is how a sheet teaches a Judge the
 * wrong model.
 */
export function bucketsFor(vehicle) {
  const sea = vehicle?.kind === "sea";
  return sea ? ["crew", "passengers", "cargo"] : ["draft", "driver", "passengers", "cargo"];
}

/**
 * What this vehicle's complement actually IS, which decides what to call it.
 *
 * RR ch. 4 gives one column three meanings, so the vehicle says which it
 * carries. Absent a statement, a vessel is crewed and a land vehicle is driven
 * — the common cases, and both wrong loudly rather than quietly if a howdah
 * arrives unlabelled.
 */
export function complementMeans(vehicle) {
  const stated = vehicle?.crew?.means;
  if (stated === "driver" || stated === "warriors" || stated === "passengers" || stated === "crew") return stated;
  return vehicle?.kind === "sea" ? "crew" : "driver";
}

/**
 * Whether passengers and cargo share one pool of stone on this vehicle.
 *
 * They do on anything that is not a vessel: a cart has a bed, not cabins. A
 * vessel prices her passengers in berths instead, which is why she can be full
 * of people and still have a hold to fill.
 */
export const poolsPassengersWithCargo = (vehicle) => vehicle?.kind !== "sea";

/**
 * How much cargo a vessel could carry if she sailed short-handed, and what it
 * costs her: fifty stone for every hand left ashore (RR ch. 7), and the speed
 * that missing hand takes with it.
 *
 * Returns null for anything that is not a vessel — a wagon cannot leave its
 * horses behind to make room.
 */
export function crewCargoTrade(vehicle, handsLeftAshore = 0) {
  if (vehicle?.kind !== "sea") return null;
  const roles = vehicle?.crew?.roles ?? [];
  const required = roles.reduce((sum, r) => sum + (Number(r.required) || 0), 0);
  const hands = Math.max(0, Math.min(Math.floor(Number(handsLeftAshore) || 0), required));
  return { hands, stoneGained: hands * BERTH_STONE, berthStone: BERTH_STONE };
}

/**
 * The buckets of one vehicle, filled in: what is in each, what it costs, and
 * where the shared pool stands.
 *
 * `occupants` is what the attachment layer already knows — one entry per actor
 * aboard, carrying its role and what it actually weighs — so this never
 * re-derives a weight the capacity primitive has already answered.
 *
 * @param {object} vehicle the vehicle's `system` data
 * @param {object[]} occupants [{ id, name, role, stone }]
 * @param {number} cargoStone what the hold's own inventory masses
 * @returns {{buckets: object[], pooled: {capacity, used, free, over}, pools: boolean}}
 */
export function fillBuckets(vehicle, occupants = [], cargoStone = 0) {
  const order = bucketsFor(vehicle);
  const pools = poolsPassengersWithCargo(vehicle);
  const capacity = Number(vehicle?.cargo?.capacityStone) || 0;
  const per = Number(vehicle?.cargo?.passengerStone) || BERTH_STONE;

  const byRole = (role) => occupants.filter((o) => o.role === role);
  const stoneOf = (list) => list.reduce((sum, o) => sum + (Number(o.stone) || 0), 0);

  // Unnamed passengers are the ones nobody has put an actor to; they cost the
  // flat berth, because a passenger takes a passenger's room whether or not
  // anyone has weighed them.
  const namedPassengers = byRole("passenger");
  const unnamed = Math.max(0, Number(vehicle?.cargo?.passengers) || 0);
  const passengerStone = stoneOf(namedPassengers) + unnamed * per;

  const means = complementMeans(vehicle);
  const buckets = order.map((key) => {
    if (key === "cargo") {
      return { key, counts: "stone", stone: cargoStone, pooled: pools };
    }
    if (key === "passengers") {
      return {
        key,
        counts: "people",
        members: namedPassengers,
        unnamed,
        stone: passengerStone,
        // On a vessel this is a berth count, not a claim on the hold.
        pooled: pools,
      };
    }
    if (key === "driver") {
      // The reins are one seat, and only on a vehicle whose complement IS a
      // driver. A chariot's complement is a driver AND warriors, and a howdah's
      // is its passengers — so the whole list shows rather than the first of it.
      const crew = byRole("crew");
      return {
        key,
        means,
        counts: "people",
        members: means === "driver" ? crew.slice(0, 1) : crew,
        proficient: !!vehicle?.driverProficient,
        pooled: false,
      };
    }
    if (key === "crew") {
      return { key, means, counts: "people", members: byRole("crew"), roles: vehicle?.crew?.roles ?? [], pooled: false };
    }
    return { key, counts: "animals", members: byRole("draft"), pooled: false };
  });

  // Only what the pool actually holds. On a vessel the passengers are berthed
  // and the hold is the hold.
  const used = pools ? cargoStone + passengerStone : cargoStone;
  return {
    buckets,
    pools,
    pooled: { capacity, used, free: capacity - used, over: used > capacity },
  };
}
