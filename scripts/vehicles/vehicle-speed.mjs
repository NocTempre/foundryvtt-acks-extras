/**
 * How fast a vehicle actually goes today — the question with the most inputs
 * in the whole ruleset, and the reason vehicles are not just containers.
 *
 * A galley's printed speed is the speed of a galley with every oar manned, a
 * fed crew, a stepped mast and a moderate wind. Take any of those away and the
 * number changes, and the rules for each live in a different section of the
 * book. This module gathers them into one derivation so a sheet can show the
 * real number and say what reduced it.
 *
 * WHAT MOVES A VESSEL (RR ch. 7):
 *  - **missing rowers** reduce rowing speed IN PROPORTION to the shortfall —
 *    half the rowers is half the speed, not a step on a table;
 *  - **an underfed crew** moves at ½ speed under oar or sail; a starving or
 *    dehydrated one at ⅓ (and starts rolling morale, which is a mutiny problem
 *    rather than a speed one);
 *  - **wind** multiplies sail speed from ×0 in a dead calm through ×3/2 in a
 *    strong wind, and above that it starts costing the oars too;
 *  - **a stowed mast** costs the bigger galleys 30' of oar sprint and cruise,
 *    because there is no room to work the oars.
 *
 * WHAT MOVES A CART is simpler and stranger: the printed rows pair a LOAD with
 * a SPEED — "up to 80 stone at 60', or up to 120 stone at 30'" — so a cart
 * does not have a speed and a capacity, it has a speed that depends on how
 * much it is carrying. Loading one more sack can halve the day's travel.
 *
 * Every function here is arithmetic over plain objects: no documents, no dice.
 */

/**
 * Ground, and what it does to a day's travel (RR ch. 6). The road row is the
 * one a proficiency touches: a road is worth half again to anyone, and DOUBLE
 * to a driver with the Driving proficiency.
 */
export const TERRAIN = Object.freeze({
  grassland: { label: "ACKS-VEHICLES.terrain.grassland", multiplier: 1 },
  scrubland: { label: "ACKS-VEHICLES.terrain.scrubland", multiplier: 1 },
  barrens: { label: "ACKS-VEHICLES.terrain.barrens", multiplier: 2 / 3 },
  desert: { label: "ACKS-VEHICLES.terrain.desert", multiplier: 2 / 3, wheelsNeedRoad: true },
  hills: { label: "ACKS-VEHICLES.terrain.hills", multiplier: 2 / 3 },
  forest: { label: "ACKS-VEHICLES.terrain.forest", multiplier: 2 / 3, wheelsNeedRoad: true },
  jungle: { label: "ACKS-VEHICLES.terrain.jungle", multiplier: 1 / 2 },
  mountains: { label: "ACKS-VEHICLES.terrain.mountains", multiplier: 1 / 2, wheelsNeedRoad: true },
  swamp: { label: "ACKS-VEHICLES.terrain.swamp", multiplier: 1 / 2, wheelsNeedRoad: true },
  mud: { label: "ACKS-VEHICLES.terrain.mud", multiplier: 1 / 2 },
  snow: { label: "ACKS-VEHICLES.terrain.snow", multiplier: 1 / 2 },
});

/** A road is worth this much, and this much again to a proficient driver. */
export const ROAD = Object.freeze({ plain: 3 / 2, driver: 2 });

/**
 * What the ground does to a vehicle's speed.
 *
 * ORDER MATTERS and the book says so: the road multiplier is applied AFTER the
 * terrain it passes through, so a road through a swamp is ½ × 3⁄2, not the
 * road rate outright — the road makes bad country passable, it does not make
 * it good country.
 *
 * Rain is the exception that proves the road: an earthen road in heavy rain is
 * worth nothing at all, which is exactly when a caravan wishes it were.
 *
 * @param {object} o
 * @param {string} o.terrain          a key of TERRAIN
 * @param {boolean} o.road            travelling on a road or trail
 * @param {boolean} o.driverProficient the reins are held by someone with Driving
 * @param {boolean} o.raining         heavy rain, which un-metals an earthen road
 * @param {boolean} o.pavedRoad       a paved road keeps its worth in the wet
 */
export function travelMultiplier({ terrain = "grassland", road = false, driverProficient = false, raining = false, pavedRoad = false } = {}) {
  const ground = TERRAIN[terrain] ?? TERRAIN.grassland;
  const parts = [{ key: `terrain.${terrain}`, factor: ground.multiplier }];
  let multiplier = ground.multiplier;

  if (road) {
    const washedOut = raining && !pavedRoad;
    const roadFactor = washedOut ? 1 : driverProficient ? ROAD.driver : ROAD.plain;
    multiplier *= roadFactor;
    parts.push({ key: washedOut ? "roadWashedOut" : driverProficient ? "roadDriver" : "road", factor: roadFactor });
  }
  return { multiplier, parts, ground };
}

/** Wind strengths, their sail and oar multipliers, and the 2d6 bands. */
export const WIND = Object.freeze({
  still: { label: "ACKS-VEHICLES.wind.still", band: [2, 4], sail: 0, oar: 1, nextDay: -2 },
  gentle: { label: "ACKS-VEHICLES.wind.gentle", band: [5, 6], sail: 1 / 2, oar: 1, nextDay: -1 },
  moderate: { label: "ACKS-VEHICLES.wind.moderate", band: [7, 9], sail: 1, oar: 1, nextDay: 0 },
  strong: { label: "ACKS-VEHICLES.wind.strong", band: [10, 11], sail: 3 / 2, oar: 1, nextDay: +1, noTack: true },
  veryStrong: { label: "ACKS-VEHICLES.wind.veryStrong", band: [12, 13], sail: 2 / 3, oar: 2 / 3, nextDay: +2, noTack: true },
  gale: { label: "ACKS-VEHICLES.wind.gale", band: [14, 99], sail: 2 / 3, oar: 2 / 3, nextDay: +4, noTack: true, mayDrift: true },
});

/** The wind a 2d6 (plus a winter +2) landed on. */
export function windFor(roll) {
  const n = Number(roll) || 0;
  return Object.entries(WIND).find(([, w]) => n >= w.band[0] && n <= w.band[1])?.[0] ?? "moderate";
}

/**
 * What the crew's belly does to every speed. Starving outranks underfed — a
 * crew is not both a half and a third.
 */
export function conditionMultiplier({ underfed = false, starving = false } = {}) {
  if (starving) return 1 / 3;
  if (underfed) return 1 / 2;
  return 1;
}

/**
 * How completely a vessel is manned, as a fraction, counting only the roles
 * that actually drive it. Marines do not row.
 *
 * A vessel with no motive role defined at all is treated as fully manned:
 * absence of a crew requirement is a rowboat, not a ghost ship.
 */
export function crewFraction(roles = []) {
  const motive = roles.filter((r) => r.motive && Number(r.required) > 0);
  if (!motive.length) return 1;
  // The WORST-manned role governs. A galley with every sailor and half its
  // rowers is a half-speed galley; the full sail crew cannot row for them.
  return motive.reduce((worst, r) => {
    const have = Math.min(Number(r.aboard) || 0, Number(r.required) || 0);
    return Math.min(worst, have / Number(r.required));
  }, 1);
}

/**
 * A sea vessel's speeds as they actually are right now.
 *
 * @param {object} vehicle the vehicle's `system` data
 * @param {object} [o]
 * @param {string} [o.wind] a key of WIND; omitted means moderate (the printed case)
 * @returns {{oarSprint, oarCruise, oarSlow, sail, voyageOar, voyageSail, reasons: object[]}}
 */
export function seaSpeeds(vehicle, { wind = "moderate" } = {}) {
  // Seafaring taken three times is a master mariner (RR ch. 3), and that is
  // the rank the wind rules care about.
  const masterMariner = (Number(vehicle?.seafaringRank) || 0) >= 3;
  const s = vehicle?.speeds ?? {};
  const w = WIND[wind] ?? WIND.moderate;
  const crew = crewFraction(vehicle?.crew?.roles ?? []);
  const cond = conditionMultiplier(vehicle?.condition);
  const reasons = [];
  if (crew < 1) reasons.push({ key: "shortCrew", factor: crew });
  if (cond < 1) reasons.push({ key: vehicle?.condition?.starving ? "starving" : "underfed", factor: cond });
  if (w.sail !== 1) reasons.push({ key: `wind.${wind}`, factor: w.sail, appliesTo: "sail" });
  if (w.oar !== 1) reasons.push({ key: `wind.${wind}`, factor: w.oar, appliesTo: "oar" });

  // A stowed mast leaves the rowers no room: a flat 30' off sprint and cruise
  // rather than a multiplier, so it comes off before anything scales.
  const stow = vehicle?.mastStowed ? 30 : 0;
  const oar = (base) => Math.max(0, ((Number(base) || 0) - stow)) * crew * cond * w.oar;
  const plain = (base) => Math.max(0, Number(base) || 0) * crew * cond * w.oar;

  return {
    oarSprint: round5(oar(s.oarSprint)),
    oarCruise: round5(oar(s.oarCruise)),
    oarSlow: round5(plain(s.oarSlow)),
    sail: round5((Number(s.sail) || 0) * cond * w.sail),
    // Voyage speed under oar takes the crew shortfall the same way; under sail
    // the wind governs and the rowers are irrelevant.
    voyageOar: round1((Number(s.voyageOar) || 0) * crew * cond * w.oar),
    voyageSail: round1((Number(s.voyageSail) || 0) * cond * w.sail),
    reasons,
    becalmed: w.sail === 0,
    // Strong and very strong winds forbid tacking to everyone EXCEPT a master
    // mariner, who manages it at two-ninths speed. That is not a small thing:
    // it is the difference between beating upwind slowly and not at all.
    canTack: !w.noTack || masterMariner,
    tackSpeed: w.noTack && masterMariner ? round5((Number(s.sail) || 0) * cond * (2 / 9)) : null,
    masterMariner,
  };
}

/**
 * A land vehicle's speed for the load it is carrying.
 *
 * The printed tiers are pairs of (load, speed) for a given team. The vehicle
 * moves at the speed of the FASTEST tier whose load it is still under — carry
 * 80 stone on a one-horse cart and it makes 60'; add a stone and it drops to
 * the 120-stone row at 30'; pass 120 and it does not move at all.
 *
 * @param {object} vehicle the vehicle's `system` data
 * @param {number} loadStone what is aboard right now
 * @returns {{feetPerTurn, tier, overloaded, pull, reasons: object[]}}
 */
export function landSpeed(vehicle, loadStone = 0, ground = null) {
  const pull = draftPull(vehicle);
  const reasons = [];
  // Only the rows this team can actually pull are on the table.
  const usable = (vehicle?.speeds?.tiers ?? [])
    .filter((t) => (Number(t.team) || 0) <= pull + 1e-9)
    .sort((a, b) => (Number(b.feetPerTurn) || 0) - (Number(a.feetPerTurn) || 0));

  if (!pull) return { feetPerTurn: 0, tier: null, overloaded: false, pull, reasons: [{ key: "noTeam" }] };
  if (!usable.length) return { feetPerTurn: 0, tier: null, overloaded: false, pull, reasons: [{ key: "noTier" }] };

  // Fastest row whose load limit still covers what is aboard.
  const tier = usable.find((t) => loadStone <= (Number(t.maxLoadStone) || 0)) ?? null;
  if (!tier) {
    const heaviest = usable.reduce((m, t) => Math.max(m, Number(t.maxLoadStone) || 0), 0);
    return { feetPerTurn: 0, tier: null, overloaded: true, pull, reasons: [{ key: "overloaded", over: loadStone - heaviest }] };
  }
  if (usable[0] !== tier) reasons.push({ key: "heavyLoad", factor: (Number(tier.feetPerTurn) || 0) / (Number(usable[0].feetPerTurn) || 1) });

  const cond = conditionMultiplier(vehicle?.condition);
  if (cond < 1) reasons.push({ key: vehicle?.condition?.starving ? "starving" : "underfed", factor: cond });

  // The ground, and whoever is holding the reins. Driving is worth nothing off
  // a road — it buys a better road, not better country.
  const terrain = ground
    ? travelMultiplier({ ...ground, driverProficient: !!vehicle?.driverProficient })
    : { multiplier: 1, parts: [] };
  for (const p of terrain.parts) if (p.factor !== 1) reasons.push({ key: p.key, factor: p.factor });

  return {
    feetPerTurn: round5((Number(tier.feetPerTurn) || 0) * cond * terrain.multiplier),
    tier,
    overloaded: false,
    pull,
    terrain: terrain.multiplier,
    reasons,
  };
}

/** Heavy-horse equivalents in harness, from plain data (no document needed). */
export function draftPull(vehicle, equivalents = null) {
  const table = equivalents ?? { heavyHorse: 1, ox: 1, mediumHorse: 0.5, mule: 0.5, donkey: 0.5 };
  return (vehicle?.team?.animals ?? [])
    .filter((a) => a.pulling !== false)
    .reduce((sum, a) => sum + (table[a.kind] ?? 0), 0);
}

/**
 * Whether this vehicle can enter a terrain at all. Wheels need a road through
 * desert, mountains, forest and swamp; a vessel is not asked.
 */
export function canEnter(vehicle, terrain, { road = false } = {}) {
  if (vehicle?.kind !== "land") return { ok: true };
  const gated = !!TERRAIN[String(terrain)]?.wheelsNeedRoad;
  if (gated && !road) return { ok: false, reason: "needsRoad" };
  return { ok: true };
}

/**
 * Cargo left, in stone, once passengers have taken their share. A passenger
 * rides as 50 stone — and the same rate runs the other way, so a vessel may
 * carry 50 stone more for each crew member it does without.
 */
export function cargoRemaining(vehicle, loadStone = 0, namedStone = 0) {
  const cap = Number(vehicle?.cargo?.capacityStone) || 0;
  const per = Number(vehicle?.cargo?.passengerStone) || 50;
  // Unnamed passengers cost the book's flat berth; named ones cost what they
  // actually cost, which the caller has already weighed.
  const riders = (Number(vehicle?.cargo?.passengers) || 0) * per + Math.max(0, Number(namedStone) || 0);
  return { capacity: cap, used: loadStone + riders, free: cap - loadStone - riders, passengerStone: riders };
}

/* Speeds in feet are always printed in fives; miles per day in whole numbers. */
const round5 = (n) => Math.max(0, Math.round(n / 5) * 5);
const round1 = (n) => Math.max(0, Math.round(n));
