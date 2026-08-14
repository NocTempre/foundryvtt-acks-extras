/**
 * Vehicle speed: the multipliers, the tiers, and the things that stop a
 * vehicle entirely. Pure arithmetic — documents are live-gate territory.
 */
import assert from "node:assert/strict";
import {
  WIND, windFor, conditionMultiplier, crewFraction, seaSpeeds, landSpeed,
  draftPull, canEnter, cargoRemaining,
} from "../scripts/vehicles/vehicle-speed.mjs";

/* --- wind bands, as the 2d6 table prints them --------------------------- */
assert.equal(windFor(2), "still");
assert.equal(windFor(4), "still");
assert.equal(windFor(5), "gentle");
assert.equal(windFor(8), "moderate");
assert.equal(windFor(10), "strong");
assert.equal(windFor(13), "veryStrong");
assert.equal(windFor(14), "gale");
assert.equal(windFor(16), "gale", "winter's +2 can push past the table's last row");
assert.equal(WIND.still.sail, 0, "no wind, no sailing");
assert.equal(WIND.still.oar, 1, "but the oars do not care");

/* --- a hungry crew ------------------------------------------------------ */
assert.equal(conditionMultiplier({}), 1);
assert.equal(conditionMultiplier({ underfed: true }), 1 / 2);
assert.equal(conditionMultiplier({ starving: true }), 1 / 3);
assert.equal(conditionMultiplier({ underfed: true, starving: true }), 1 / 3,
  "starving outranks underfed — a crew is not both");

/* --- manning: the worst-manned motive role governs, marines excluded ---- */
const roles = (sailors, rowers, marines) => [
  { key: "sailors", required: 10, aboard: sailors, motive: true },
  { key: "rowers", required: 100, aboard: rowers, motive: true },
  { key: "marines", required: 20, aboard: marines, motive: false },
];
assert.equal(crewFraction(roles(10, 100, 20)), 1, "a full complement");
assert.equal(crewFraction(roles(10, 50, 0)), 0.5, "half the rowers, half the speed");
assert.equal(crewFraction(roles(10, 100, 0)), 1, "missing marines cost nothing — they do not row");
assert.equal(crewFraction(roles(5, 100, 20)), 0.5, "the worst-manned role governs");
assert.equal(crewFraction(roles(10, 200, 0)), 1, "extra hands do not make it faster");
assert.equal(crewFraction([]), 1, "a vessel that asks for no crew is a rowboat, not a ghost ship");

/* --- a galley under way ------------------------------------------------- */
const galley = {
  kind: "sea",
  speeds: { oarSprint: 330, oarCruise: 270, oarSlow: 150, sail: 240, voyageOar: 54, voyageSail: 96 },
  crew: { roles: roles(15, 170, 15).map((r, i) => ({ ...r, required: [15, 170, 15][i] })) },
  condition: {},
};
let s = seaSpeeds(galley);
assert.equal(s.oarSprint, 330, "fully manned, fed, moderate wind: the printed number");
assert.equal(s.sail, 240);
assert.equal(s.voyageSail, 96);

/* becalmed: the sails are useless, the oars are not */
s = seaSpeeds(galley, { wind: "still" });
assert.equal(s.sail, 0);
assert.equal(s.becalmed, true);
assert.equal(s.oarSprint, 330, "a dead calm does not slow the rowers");

/* a strong wind is worth half again under sail */
s = seaSpeeds(galley, { wind: "strong" });
assert.equal(s.sail, 360);
assert.equal(s.canTack, false, "and it cannot tack");

/* very strong costs the oars too */
s = seaSpeeds(galley, { wind: "veryStrong" });
assert.equal(s.oarSprint, 220, "330 x 2/3, to the nearest 5");

/* half the rowers halves the rowing, and says so */
const half = { ...galley, crew: { roles: roles(15, 85, 15).map((r, i) => ({ ...r, required: [15, 170, 15][i] })) } };
s = seaSpeeds(half);
assert.equal(s.oarSprint, 165);
assert.equal(s.voyageOar, 27, "and the voyage speed with it");
assert.ok(s.reasons.some((r) => r.key === "shortCrew"), "the sheet can say WHY");

/* a stowed mast comes off before anything scales */
s = seaSpeeds({ ...galley, mastStowed: true });
assert.equal(s.oarSprint, 300, "330 less 30 for the stowed mast");
assert.equal(s.oarSlow, 150, "the slow pace is not affected");

/* --- draft teams: an ox equals a heavy horse, two mules do too ---------- */
const team = (...kinds) => ({ team: { animals: kinds.map((kind) => ({ kind, pulling: true })) } });
assert.equal(draftPull(team("heavyHorse")), 1);
assert.equal(draftPull(team("ox")), 1, "one ox substitutes for one heavy horse");
assert.equal(draftPull(team("mule", "mule")), 1, "and two mules do");
assert.equal(draftPull(team("mediumHorse", "mediumHorse")), 1);
assert.equal(draftPull(team("heavyHorse", "ox", "mule")), 2.5, "a mixed team simply adds up");
assert.equal(draftPull({ team: { animals: [{ kind: "heavyHorse", pulling: false }] } }), 0,
  "a lame horse stays on the roster and stops pulling");

/* --- a cart's speed depends on what is in it ---------------------------- */
const cart = {
  kind: "land",
  ...team("heavyHorse"),
  speeds: { tiers: [
    { team: 1, maxLoadStone: 80, feetPerTurn: 60 },
    { team: 1, maxLoadStone: 120, feetPerTurn: 30 },
  ] },
  condition: {},
};
assert.equal(landSpeed(cart, 0).feetPerTurn, 60, "empty, it makes 60'");
assert.equal(landSpeed(cart, 80).feetPerTurn, 60, "80 stone is still the fast row");
assert.equal(landSpeed(cart, 81).feetPerTurn, 30, "one stone more and the day halves");
assert.equal(landSpeed(cart, 120).feetPerTurn, 30);
const over = landSpeed(cart, 121);
assert.equal(over.feetPerTurn, 0, "past the heaviest row it does not move");
assert.equal(over.overloaded, true);
assert.equal(over.reasons[0].over, 1, "and it says by how much");
assert.ok(landSpeed(cart, 100).reasons.some((r) => r.key === "heavyLoad"), "a slowed cart says why");

/* a bigger team unlocks the rows it can pull */
const wagon = {
  kind: "land",
  ...team("heavyHorse", "heavyHorse"),
  speeds: { tiers: [
    { team: 2, maxLoadStone: 160, feetPerTurn: 60 },
    { team: 2, maxLoadStone: 320, feetPerTurn: 30 },
    { team: 4, maxLoadStone: 320, feetPerTurn: 60 },
    { team: 4, maxLoadStone: 640, feetPerTurn: 30 },
  ] },
  condition: {},
};
assert.equal(landSpeed(wagon, 300).feetPerTurn, 30, "two horses haul 300 stone at half pace");
const four = { ...wagon, ...team("heavyHorse", "heavyHorse", "heavyHorse", "heavyHorse") };
assert.equal(landSpeed(four, 300).feetPerTurn, 60, "four horses take the same load at full pace");
assert.equal(landSpeed({ ...cart, team: { animals: [] } }, 0).reasons[0].key, "noTeam",
  "nothing in harness, nothing moves");

/* a hungry team slows the cart too */
assert.equal(landSpeed({ ...cart, condition: { underfed: true } }, 0).feetPerTurn, 30);

/* --- wheels need a road through the hard country ------------------------ */
assert.equal(canEnter(cart, "grassland").ok, true);
assert.equal(canEnter(cart, "swamp").ok, false);
assert.equal(canEnter(cart, "swamp", { road: true }).ok, true, "a road through the swamp will do");
assert.equal(canEnter(galley, "swamp").ok, true, "a vessel is not asked about roads");

/* --- passengers ride as cargo ------------------------------------------- */
const hold = cargoRemaining({ cargo: { capacityStone: 1000, passengerStone: 50, passengers: 4 } }, 500);
assert.equal(hold.passengerStone, 200, "four passengers ride as 50 stone each");
assert.equal(hold.free, 300, "1000 less 500 aboard less 200 of passengers");

console.log("test-vehicles: OK (wind, hunger, manning, galleys, teams, tiers, terrain, passengers)");

/* ========================================================================== */
/*  Ground, and the proficiencies that answer to it (RR ch. 3 + ch. 6)        */
/* ========================================================================== */
import { travelMultiplier, TERRAIN, ROAD } from "../scripts/vehicles/vehicle-speed.mjs";

/* --- the printed terrain multipliers ------------------------------------ */
assert.equal(TERRAIN.grassland.multiplier, 1);
assert.equal(TERRAIN.forest.multiplier, 2 / 3);
assert.equal(TERRAIN.swamp.multiplier, 1 / 2);
assert.equal(TERRAIN.snow.multiplier, 1 / 2);

/* --- a road is worth half again, and DOUBLE to a driver ----------------- */
assert.equal(ROAD.plain, 3 / 2);
assert.equal(ROAD.driver, 2);
assert.equal(travelMultiplier({ terrain: "grassland", road: true }).multiplier, 3 / 2);
assert.equal(travelMultiplier({ terrain: "grassland", road: true, driverProficient: true }).multiplier, 2,
  "Driving turns the road bonus from 3/2 into 2");

/* --- Driving buys a better ROAD, not better country --------------------- */
assert.equal(travelMultiplier({ terrain: "forest", driverProficient: true }).multiplier, 2 / 3,
  "off a road the proficiency is worth nothing at all");

/* --- the road multiplies AFTER the terrain, as the book says ------------ */
assert.equal(travelMultiplier({ terrain: "swamp", road: true }).multiplier, 1 / 2 * 3 / 2,
  "a road through a swamp is still a swamp");
assert.equal(travelMultiplier({ terrain: "swamp", road: true, driverProficient: true }).multiplier, 1,
  "a driver on a swamp road makes exactly open-country pace");

/* --- heavy rain un-metals an earthen road ------------------------------- */
assert.equal(travelMultiplier({ terrain: "grassland", road: true, raining: true }).multiplier, 1,
  "an earthen road in the rain is worth nothing");
assert.equal(travelMultiplier({ terrain: "grassland", road: true, raining: true, driverProficient: true }).multiplier, 1,
  "and no amount of skill re-metals it");
assert.equal(travelMultiplier({ terrain: "grassland", road: true, raining: true, pavedRoad: true }).multiplier, 3 / 2,
  "a paved road keeps its worth in the wet");

/* --- the gating list is the same table, not a second hardcoded one ------ */
for (const t of ["desert", "mountains", "forest", "swamp"]) {
  assert.equal(TERRAIN[t].wheelsNeedRoad, true, `${t} needs a road for wheels`);
  assert.equal(canEnter({ kind: "land" }, t).ok, false);
  assert.equal(canEnter({ kind: "land" }, t, { road: true }).ok, true);
}
for (const t of ["grassland", "hills", "barrens", "scrubland"]) {
  assert.equal(canEnter({ kind: "land" }, t).ok, true, `${t} is open to a cart`);
}

/* --- the ground reaches landSpeed, and names itself --------------------- */
const carted = {
  kind: "land", driverProficient: true,
  team: { animals: [{ kind: "heavyHorse", pulling: true }] },
  speeds: { tiers: [{ team: 1, maxLoadStone: 80, feetPerTurn: 60 }] },
  condition: {},
};
assert.equal(landSpeed(carted, 0).feetPerTurn, 60, "no ground given, the printed speed");
assert.equal(landSpeed(carted, 0, { terrain: "grassland", road: true }).feetPerTurn, 120,
  "60 x 1 x 2 for a driver on a good road");
assert.equal(landSpeed(carted, 0, { terrain: "forest", road: true }).feetPerTurn, 80,
  "60 x 2/3 x 2 through forest on a road");
const named = landSpeed(carted, 0, { terrain: "swamp", road: true });
assert.ok(named.reasons.some((r) => r.key === "terrain.swamp"), "the sheet can name the ground");
assert.ok(named.reasons.some((r) => r.key === "roadDriver"), "and name the driver's road");

/* --- a master mariner tacks where nobody else can ----------------------- */
const crewed = { kind: "sea", speeds: { sail: 180 }, crew: { roles: [] }, condition: {} };
let t = seaSpeeds(crewed, { wind: "strong" });
assert.equal(t.canTack, false, "a strong wind forbids tacking");
assert.equal(t.tackSpeed, null);
t = seaSpeeds({ ...crewed, seafaringRank: 3 }, { wind: "strong" });
assert.equal(t.canTack, true, "unless a master mariner has the helm");
assert.equal(t.tackSpeed, 40, "180 x 2/9 = 40, the price of beating upwind");
assert.equal(seaSpeeds({ ...crewed, seafaringRank: 2 }, { wind: "strong" }).canTack, false,
  "two ranks is a captain, not a master mariner");
assert.equal(seaSpeeds({ ...crewed, seafaringRank: 3 }, { wind: "moderate" }).tackSpeed, null,
  "in a moderate wind everyone tacks normally, so there is no reduced rate to show");

console.log("test-vehicles: OK (terrain, road, Driving, rain, master mariner tacking)");
