/**
 * The sea half of the vehicle rules: what damages a hull, what that costs her,
 * what a crew can put back, and the clock she keeps.
 *
 * Pure functions only — no Foundry, no world. The book's own worked examples
 * are used where it prints them, because a rule reproduced from its example is
 * a rule read correctly rather than a rule guessed at.
 */
import assert from "node:assert";
import {
  DAMAGE_SHARE,
  damageToVessel,
  spellAreaFactor,
  isSinking,
  speedFactor,
  repairPlan,
  roundVoyage,
  roundCombat,
  CREW_PER_POINT,
} from "../scripts/vehicles/vessel-damage.mjs";
import {
  NAVIGATION_TARGETS,
  navigationThrow,
  hazardThrow,
  HAZARDS,
  kelpHours,
  lightenChance,
} from "../scripts/vehicles/navigation.mjs";
import { VOYAGE_HOURS, milesPerHour, canSailRoundTheClock, voyageDay, compareToMarch } from "../scripts/vehicles/voyage.mjs";
import { bucketsFor, complementMeans, fillBuckets, crewCargoTrade } from "../scripts/vehicles/berths.mjs";

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
};

/* ------------------------------ damage ------------------------------ */

test("a man-sized attacker cannot hurt a hull at all", () => {
  const hit = damageToVessel(30, "personal");
  assert.equal(hit.dealt, 0);
  assert.equal(hit.ignored, true);
});

test("artillery reaches a hull by its own class", () => {
  assert.equal(damageToVessel(30, "lightArtillery").dealt, 3); // 1/10
  assert.equal(damageToVessel(30, "heavyArtillery").dealt, 10); // 1/3
  assert.equal(damageToVessel(30, "siege").dealt, 30); // full
});

test("a tenth of a small hit is nothing, and that is the rule working", () => {
  assert.equal(damageToVessel(9, "lightArtillery").dealt, 0);
});

test("a spell's footprint multiplies what it does to timber", () => {
  assert.equal(spellAreaFactor(0), 1); // no area: the bare tenth
  assert.equal(spellAreaFactor(25), 1);
  assert.equal(spellAreaFactor(250), 10);
  // 40 damage, a tenth, times ten for a 250 sq ft area = 40 again.
  assert.equal(damageToVessel(40, "spell", { areaSquareFeet: 250 }).dealt, 40);
  assert.equal(damageToVessel(40, "spell").dealt, 4);
});

test("a hull at or below zero is sinking; one that never had any is not", () => {
  assert.equal(isSinking({ shp: { value: 0, max: 40 } }), true);
  assert.equal(isSinking({ shp: { value: -5, max: 40 } }), true);
  assert.equal(isSinking({ shp: { value: 1, max: 40 } }), false);
  // A cart has no structural hit points; it is not perpetually sinking.
  assert.equal(isSinking({ shp: { value: 0, max: 0 } }), false);
});

/* --------------------- speed: the worse of two ---------------------- */

test("crew loss and hull damage are not cumulative — the worse governs", () => {
  const roles = [{ motive: true, required: 60, aboard: 40 }]; // 2/3 crewed
  const half = speedFactor({ crew: { roles }, shp: { value: 20, max: 40 } }); // 1/2 hull
  assert.equal(half.factor, 0.5);
  assert.equal(half.worst, "hull");

  const scratched = speedFactor({ crew: { roles }, shp: { value: 38, max: 40 } });
  assert.equal(Math.round(scratched.factor * 1000) / 1000, 0.667);
  assert.equal(scratched.worst, "crew");
});

test("an undamaged, fully manned vessel keeps all of her speed", () => {
  assert.equal(speedFactor({ crew: { roles: [] }, shp: { value: 40, max: 40 } }).factor, 1);
});

test("speeds round to the intervals the rule names", () => {
  assert.equal(roundVoyage(20), 18); // nearest six miles
  assert.equal(roundVoyage(21), 24);
  assert.equal(roundCombat(95), 90); // nearest thirty feet
  assert.equal(roundCombat(105), 120);
});

/* ------------------------------ repair ------------------------------ */

test("five hands put back one point in a turn", () => {
  assert.equal(CREW_PER_POINT, 5);
  const plan = repairPlan(20, 20, { atSea: true });
  assert.equal(plan.repairable, 10); // only half of it, at sea
  assert.equal(plan.dockOnly, 10);
  assert.equal(plan.turns, 3); // four gangs of five, ten points -> 3 turns
});

test("a dock repairs what the sea cannot", () => {
  const plan = repairPlan(20, 20, { atSea: false });
  assert.equal(plan.repairable, 20);
  assert.equal(plan.dockOnly, 0);
});

test("too few hands to make a gang never finishes", () => {
  assert.equal(repairPlan(10, 4).turns, Infinity);
});

/* ---------------------------- navigation ---------------------------- */

test("staying on course is easy on a river and hard at sea", () => {
  assert.equal(NAVIGATION_TARGETS.lakeOrRiver, 4);
  assert.equal(NAVIGATION_TARGETS.coast, 7);
  assert.equal(NAVIGATION_TARGETS.openSea, 11);
});

test("one art is worth four, both together are worth eight — not four plus four", () => {
  assert.equal(navigationThrow({ terrain: "openSea" }).effective, 11);
  assert.equal(navigationThrow({ terrain: "openSea", navigation: true }).effective, 7);
  assert.equal(navigationThrow({ terrain: "openSea", pathfinding: true }).effective, 7);
  const both = navigationThrow({ terrain: "openSea", pathfinding: true, navigation: true });
  assert.equal(both.bonus, 8);
  assert.equal(both.effective, 3);
});

test("a master mariner reads the water four better than a captain", () => {
  assert.equal(hazardThrow({}).target, 11);
  assert.equal(hazardThrow({ masterMariner: true }).target, 7);
});

test("slowing down helps twice: the throw, and the damage if she strikes anyway", () => {
  const careful = hazardThrow({ halfSpeed: true });
  assert.equal(careful.effective, 7);
  // A galley picking her way over a shoal gets both bonuses.
  assert.equal(hazardThrow({ halfSpeed: true, shallowDraft: true }).effective, 3);
});

test("the hazards carry the dice the book gives them", () => {
  assert.equal(HAZARDS.rockReefWreck.damage, "8d10");
  assert.equal(HAZARDS.rockReefWreck.damageType, "piercing");
  assert.equal(HAZARDS.sandbarShoal.damage, "4d10");
  assert.equal(HAZARDS.sandbarShoal.damageType, "bludgeoning");
  assert.equal(HAZARDS.kelpForest.damage, null); // kelp holds; it does not hole
});

test("kelp holds a big ship longer than a small one", () => {
  assert.equal(kelpHours(2, 0), 2);
  assert.equal(kelpHours(2, 120), 4); // two extra hours for 120 tons
});

test("throwing cargo over the side buys a cumulative chance, capped at certainty", () => {
  assert.equal(Math.round(lightenChance(200) * 100), 5);
  assert.equal(Math.round(lightenChance(800) * 100), 20);
  assert.equal(lightenChance(999999), 1);
});

/* ------------------------------ the clock --------------------------- */

test("a voyage day is twelve hours, not the eight a party marches", () => {
  assert.equal(VOYAGE_HOURS, 12);
  // The book's own example: 72 miles a day is 6 miles an hour.
  assert.equal(milesPerHour(72), 6);
});

test("sailing through the night needs all four conditions", () => {
  const none = canSailRoundTheClock({});
  assert.equal(none.allowed, false);
  assert.deepEqual(none.missing, ["underSail", "openSea", "navigator", "fullCrew"]);
  assert.equal(canSailRoundTheClock({ underSail: true, openSea: true, navigator: true, fullCrew: true }).allowed, true);
  // Under oar it is never allowed, however well found she is.
  assert.equal(canSailRoundTheClock({ openSea: true, navigator: true, fullCrew: true }).allowed, false);
});

test("a day round the clock is twice the distance at the same speed", () => {
  const ship = {
    speeds: { voyageSail: 72, voyageOar: 30, sail: 90, oarCruise: 60 },
    crew: { roles: [] },
    shp: { value: 40, max: 40 },
  };
  const day = voyageDay(ship, { underSail: true });
  const night = voyageDay(ship, { underSail: true, roundTheClock: true });
  assert.equal(day.milesPerDay, 72);
  assert.equal(night.milesPerDay, 144);
  // She is not going any faster — only longer.
  assert.equal(day.milesPerHour, night.milesPerHour);
  assert.equal(night.hours, 24);
});

test("a holed hull slows the day, and says the hull is why", () => {
  const ship = {
    speeds: { voyageSail: 72, voyageOar: 30, sail: 90, oarCruise: 60 },
    crew: { roles: [] },
    shp: { value: 20, max: 40 },
  };
  const day = voyageDay(ship, { underSail: true });
  assert.equal(day.factor, 0.5);
  assert.equal(day.worst, "hull");
  assert.equal(day.milesPerDay, 36);
  assert.ok(day.reasons.some((r) => r.key === "hullDamage"));
});

test("the crew shortfall is applied once, not squared", () => {
  // seaSpeeds already scales by the crew fraction; voyageDay must not do it again.
  const ship = {
    speeds: { voyageOar: 30, voyageSail: 90, sail: 90, oarCruise: 60 },
    crew: { roles: [{ motive: true, required: 60, aboard: 30 }] }, // half
    shp: { value: 40, max: 40 },
  };
  const day = voyageDay(ship, { underSail: false });
  // Half of 30 is 15, which rounds to the nearest six: 18.
  assert.equal(day.milesPerDay, 18);
});

test("a ship and a marching party are only comparable per hour", () => {
  const cmp = compareToMarch(72, 24);
  assert.equal(cmp.vesselPerHour, 6);
  assert.equal(cmp.partyPerHour, 3);
  assert.equal(cmp.marchHours, 8);
  assert.equal(cmp.voyageHours, 12);
  assert.equal(cmp.faster, "vessel");
});

/* ------------------------------ buckets ----------------------------- */

test('a land vehicle is pulled and driven; a vessel is crewed', () => {
  assert.deepEqual(bucketsFor({ kind: 'land' }), ['draft', 'driver', 'passengers', 'cargo']);
  assert.deepEqual(bucketsFor({ kind: 'sea' }), ['crew', 'passengers', 'cargo']);
});

test('one column, three meanings — the vehicle says which', () => {
  assert.equal(complementMeans({ kind: 'land' }), 'driver');
  assert.equal(complementMeans({ kind: 'sea' }), 'crew');
  assert.equal(complementMeans({ kind: 'land', crew: { means: 'warriors' } }), 'warriors');
  assert.equal(complementMeans({ kind: 'land', crew: { means: 'passengers' } }), 'passengers');
});

test('a land vehicle pools passengers with cargo; a vessel berths them apart', () => {
  const wagon = { kind: 'land', cargo: { capacityStone: 400, passengerStone: 50, passengers: 4 } };
  const filled = fillBuckets(wagon, [], 100);
  assert.equal(filled.pools, true);
  assert.equal(filled.pooled.used, 300);
  assert.equal(filled.pooled.free, 100);

  const ship = { kind: 'sea', cargo: { capacityStone: 400, passengerStone: 50, passengers: 4 } };
  const berthed = fillBuckets(ship, [], 100);
  assert.equal(berthed.pools, false);
  assert.equal(berthed.pooled.used, 100);
});

test('the passenger rate is the vehicle own, never a constant assumed here', () => {
  const palanquin = { kind: 'land', cargo: { capacityStone: 15, passengerStone: 15, passengers: 1 } };
  const filled = fillBuckets(palanquin, [], 0);
  assert.equal(filled.pooled.used, 15);
  assert.equal(filled.pooled.free, 0);
  assert.equal(filled.pooled.over, false);
});

test('a named passenger is charged what they weigh, beside the unnamed berths', () => {
  const wagon = { kind: 'land', cargo: { capacityStone: 400, passengerStone: 50, passengers: 2 } };
  const filled = fillBuckets(wagon, [{ id: 'a', name: 'Aldric', role: 'passenger', stone: 22 }], 0);
  const seats = filled.buckets.find((b) => b.key === 'passengers');
  assert.equal(seats.unnamed, 2);
  assert.equal(seats.stone, 122);
});

test('a chariot shows its warriors, not just whoever holds the reins', () => {
  const crew = [
    { id: 'd', name: 'Driver', role: 'crew', stone: 20 },
    { id: 'w', name: 'Warrior', role: 'crew', stone: 20 },
  ];
  const wagon = fillBuckets({ kind: 'land' }, crew, 0).buckets.find((b) => b.key === 'driver');
  assert.equal(wagon.members.length, 1);

  const chariot = fillBuckets({ kind: 'land', crew: { means: 'warriors' } }, crew, 0).buckets.find((b) => b.key === 'driver');
  assert.equal(chariot.members.length, 2);
});

test('a vessel can trade hands for hold; a wagon cannot trade its horses', () => {
  const ship = { kind: 'sea', crew: { roles: [{ required: 30, aboard: 30, motive: true }] } };
  assert.equal(crewCargoTrade(ship, 4).stoneGained, 200);
  assert.equal(crewCargoTrade(ship, 999).hands, 30);
  assert.equal(crewCargoTrade({ kind: 'land' }, 4), null);
});

console.log(`test-vessels: OK (${passed} checks — damage, sinking, repair, navigation, hazards, the voyage clock)`);
