/**
 * Vehicle speed: the multipliers, the tiers, and the things that stop a
 * vehicle entirely. Pure arithmetic — documents are live-gate territory.
 *
 * COMMITTED half: mechanics only, against INVENTED numbers registered as
 * sample table docs — the printed terrain/road/wind values live in the
 * reader's book, arrive through the registry, and are asserted only by the
 * machine-local suite in `tools/rules-tests/` (gitignored, per run-tests'
 * own header).
 */
import assert from "node:assert/strict";
import {
  WIND, windFor, windSpec, conditionMultiplier, crewFraction, seaSpeeds, landSpeed,
  draftPull, canEnter, cargoRemaining, travelMultiplier, TERRAIN, ROAD_KINDS,
  TRAVEL_DOC, VOYAGES_DOC,
} from "../scripts/vehicles/vehicle-speed.mjs";
import { registerTable, resetTables, PRIORITY } from "../scripts/lib/tables.mjs";

/* --- invented sample tables, registered the way an import would ---------- */
const SAMPLE_TRAVEL = {
  id: TRAVEL_DOC,
  tables: {
    terrainMultipliers: { grassland: 1, barrens: 0.75, forest: 0.5, swamp: 0.25, hills: 0.5, mud: 0.5, snow: 0.5 },
    roads: {
      earth: { multiplier: 2, drivingMultiplier: 3, ineffectiveIf: ["raining"] },
      gravel: { multiplier: 2, ineffectiveIf: ["snowing"] },
      paved: { multiplier: 2 },
    },
  },
};
const SAMPLE_VOYAGES = {
  id: VOYAGES_DOC,
  tables: {
    windStrength: [
      { key: "still", min: 2, max: 4, sail: 0, oar: 1 },
      { key: "gentle", min: 5, max: 6, sail: 0.5, oar: 1 },
      { key: "moderate", min: 7, max: 9, sail: 1, oar: 1 },
      { key: "strong", min: 10, max: 11, sail: 2, oar: 1 },
      { key: "veryStrong", min: 12, max: 13, sail: 0.5, oar: 0.5 },
      { key: "gale", min: 14, max: null, sail: 0.5, oar: 0.5 },
    ],
    tacking: { multiplier: 0.25 },
  },
};
const registerSamples = () => {
  registerTable(SAMPLE_TRAVEL, { priority: PRIORITY.WORLD, source: "test" });
  registerTable(SAMPLE_VOYAGES, { priority: PRIORITY.WORLD, source: "test" });
};
registerSamples();

/* --- wind bands come from the registered rows ---------------------------- */
assert.equal(windFor(2), "still");
assert.equal(windFor(6), "gentle");
assert.equal(windFor(8), "moderate");
assert.equal(windFor(11), "strong");
assert.equal(windFor(13), "veryStrong");
assert.equal(windFor(16), "gale", "an open-ended top row catches the winter +2 pushing past the table");
assert.equal(windSpec("still").sail, 0, "no wind, no sailing");
assert.equal(windSpec("still").oar, 1, "but the oars do not care");
assert.ok(WIND.strong.noTack && WIND.gale.mayDrift, "the band-identity rules are structural and stay in code");

/* --- with NO tables, the wind neither helps nor hinders, and says why ---- */
resetTables();
assert.equal(windFor(2), "moderate", "no table: every roll reads as moderate");
assert.equal(windSpec("gale"), null);
let bare = seaSpeeds({ kind: "sea", speeds: { sail: 200 }, crew: { roles: [] }, condition: {} }, { wind: "gale" });
assert.equal(bare.sail, 200, "absent tables scale nothing");
assert.equal(bare.becalmed, false, "and never fake a calm");
assert.ok(bare.reasons.some((r) => r.key === "tablesMissing"), "one reason line says why the weather is not counting");
registerSamples();

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

/* --- an invented galley under way --------------------------------------- */
const galley = {
  kind: "sea",
  speeds: { oarSprint: 300, oarCruise: 240, oarSlow: 120, sail: 200, voyageOar: 40, voyageSail: 80 },
  crew: { roles: roles(10, 100, 20) },
  condition: {},
};
let s = seaSpeeds(galley);
assert.equal(s.oarSprint, 300, "fully manned, fed, moderate wind: the stated number");
assert.equal(s.sail, 200);
assert.equal(s.voyageSail, 80);

/* becalmed: the sails are useless, the oars are not */
s = seaSpeeds(galley, { wind: "still" });
assert.equal(s.sail, 0);
assert.equal(s.becalmed, true);
assert.equal(s.oarSprint, 300, "a dead calm does not slow the rowers");

/* a favouring wind multiplies sail alone */
s = seaSpeeds(galley, { wind: "strong" });
assert.equal(s.sail, 400, "200 x the row's sail factor");
assert.equal(s.canTack, false, "and strong wind forbids tacking");

/* a wind that costs the oars costs them too */
s = seaSpeeds(galley, { wind: "veryStrong" });
assert.equal(s.oarSprint, 150, "300 x the row's oar factor");

/* half the rowers halves the rowing, and says so */
const half = { ...galley, crew: { roles: roles(10, 50, 20) } };
s = seaSpeeds(half);
assert.equal(s.oarSprint, 150);
assert.equal(s.voyageOar, 20, "and the voyage speed with it");
assert.ok(s.reasons.some((r) => r.key === "shortCrew"), "the sheet can say WHY");

/* a stowed mast comes off BEFORE anything scales */
s = seaSpeeds({ ...galley, mastStowed: true }, { wind: "veryStrong" });
assert.equal(s.oarSprint, 135, "(300 - 30) x 0.5 — the flat loss precedes the factor");
assert.equal(seaSpeeds({ ...galley, mastStowed: true }).oarSlow, 120, "the slow pace is not affected");

/* --- a master mariner tacks where nobody else can ------------------------ */
const crewed = { kind: "sea", speeds: { sail: 180 }, crew: { roles: [] }, condition: {} };
let t = seaSpeeds(crewed, { wind: "strong" });
assert.equal(t.canTack, false, "a strong wind forbids tacking");
assert.equal(t.tackSpeed, null);
t = seaSpeeds({ ...crewed, seafaringRank: 3 }, { wind: "strong" });
assert.equal(t.canTack, true, "unless a master mariner has the helm");
assert.equal(t.tackSpeed, 45, "180 x the registered tacking rate");
assert.equal(seaSpeeds({ ...crewed, seafaringRank: 2 }, { wind: "strong" }).canTack, false,
  "two ranks is a captain, not a master mariner");
assert.equal(seaSpeeds({ ...crewed, seafaringRank: 3 }, { wind: "moderate" }).tackSpeed, null,
  "in a moderate wind everyone tacks normally, so there is no reduced rate to show");

/* --- teams pull as their equivalents sum --------------------------------- */
const team = (...kinds) => ({ team: { animals: kinds.map((kind) => ({ kind, pulling: true })) } });
assert.equal(draftPull(team("heavyHorse")), 1);
assert.equal(draftPull(team("ox")), 1, "one ox substitutes for one heavy horse");
assert.equal(draftPull(team("mule", "mule")), 1, "and two mules do");
assert.equal(draftPull(team("mediumHorse", "mediumHorse")), 1);
assert.equal(draftPull(team("heavyHorse", "ox", "mule")), 2.5, "a mixed team simply adds up");
assert.equal(draftPull({ team: { animals: [{ kind: "heavyHorse", pulling: false }] } }), 0,
  "an animal not pulling contributes nothing");

/* --- passengers ride at the vehicle's own rate --------------------------- */
const hold = cargoRemaining({ cargo: { capacityStone: 1000, passengerStone: 50, passengers: 4 } }, 500);
assert.equal(hold.passengerStone, 200, "four unnamed heads at the vehicle's stated rate");
assert.equal(hold.free, 300, "1000 less 500 aboard less 200 of passengers");

console.log("test-vehicles: OK (wind rows, hunger, manning, invented galley, teams, passengers)");

/* ========================================================================== */
/*  Ground: order, washouts, the driver — all against the registered rows    */
/* ========================================================================== */

/* --- the road multiplies AFTER the terrain ------------------------------- */
assert.equal(travelMultiplier({ terrain: "grassland" }).multiplier, 1);
assert.equal(travelMultiplier({ terrain: "swamp" }).multiplier, 0.25);
assert.equal(travelMultiplier({ terrain: "swamp", road: "earth" }).multiplier, 0.5,
  "0.25 x 2 — a road through a swamp is still a swamp");
assert.equal(travelMultiplier({ terrain: "grassland", road: "earth", driverProficient: true }).multiplier, 3,
  "Driving is worth the row's better rate");
assert.equal(travelMultiplier({ terrain: "forest", driverProficient: true }).multiplier, 0.5,
  "and worth nothing at all off a road");

/* --- a road row's ineffectiveIf conditions null it ----------------------- */
const washed = travelMultiplier({ terrain: "grassland", road: "earth", raining: true });
assert.equal(washed.multiplier, 1, "an earthen road in the rain is worth nothing");
assert.ok(washed.parts.some((p) => p.key === "roadWashedOut" && p.note),
  "and the washed-out road still SAYS so — a note part survives the ×1 filter");
assert.equal(travelMultiplier({ terrain: "grassland", road: "earth", raining: true, driverProficient: true }).multiplier, 1,
  "and no amount of skill re-metals it");
assert.equal(travelMultiplier({ terrain: "grassland", road: "paved", raining: true }).multiplier, 2,
  "a paved road keeps its worth in the wet");
assert.equal(travelMultiplier({ terrain: "grassland", road: "gravel", snowing: true }).multiplier, 1,
  "a row may be nulled by snow instead");
assert.equal(travelMultiplier({ terrain: "grassland", road: true }).multiplier, 2,
  "a legacy boolean road reads as an earth road");

/* --- the parts name what the sheet will say ------------------------------ */
const namedGround = travelMultiplier({ terrain: "swamp", road: "earth", driverProficient: true });
assert.ok(namedGround.parts.some((p) => p.key === "terrain.swamp"), "the ground names itself");
assert.ok(namedGround.parts.some((p) => p.key === "roadDriver"), "and the driver's road");

/* --- no tables: x1, and ONE line that says why --------------------------- */
resetTables();
const dry = travelMultiplier({ terrain: "swamp", road: "earth" });
assert.equal(dry.multiplier, 1);
assert.equal(dry.parts.filter((p) => p.key === "tablesMissing").length, 1, "one tablesMissing line, not one per read");
assert.equal(dry.missing, true);
registerSamples();

/* --- the gating list is STRUCTURE, not a table --------------------------- */
for (const key of ["desert", "mountains", "forest", "swamp"]) {
  assert.equal(TERRAIN[key].wheelsNeedRoad, true, `${key} needs a road for wheels`);
  assert.equal(canEnter({ kind: "land" }, key).ok, false);
  assert.equal(canEnter({ kind: "land" }, key, { road: true }).ok, true);
}
for (const key of ["grassland", "hills", "barrens", "scrubland"]) {
  assert.equal(canEnter({ kind: "land" }, key).ok, true, `${key} is open to a cart`);
}
assert.deepEqual(ROAD_KINDS, ["none", "earth", "gravel", "paved"]);

/* --- the ground reaches landSpeed, and names itself ---------------------- */
const carted = {
  kind: "land", driverProficient: true,
  team: { animals: [{ kind: "heavyHorse", pulling: true }] },
  speeds: { tiers: [{ team: 1, maxLoadStone: 80, feetPerTurn: 60 }] },
  condition: {},
};
assert.equal(landSpeed(carted, 0).feetPerTurn, 60, "no ground given, the stated speed");
assert.equal(landSpeed(carted, 0, { terrain: "grassland", road: "earth" }).feetPerTurn, 180,
  "60 x 1 x 3 for a driver on the sample road");
assert.equal(landSpeed(carted, 0, { terrain: "forest", road: "earth" }).feetPerTurn, 90,
  "60 x 1/2 x 3 through forest on a road");
const named = landSpeed(carted, 0, { terrain: "swamp", road: "earth" });
assert.ok(named.reasons.some((r) => r.key === "terrain.swamp"), "the sheet can name the ground");
assert.ok(named.reasons.some((r) => r.key === "roadDriver"), "and name the driver's road");
resetTables();
const dumb = landSpeed(carted, 0, { terrain: "swamp", road: "earth" });
assert.equal(dumb.feetPerTurn, 60, "no tables: the printed tier stands unscaled");
assert.ok(dumb.reasons.some((r) => r.key === "tablesMissing"), "and the reason list says why");
registerSamples();

console.log("test-vehicles: OK (registry ground, washouts, driver, wheel gates, landSpeed)");

/* ========================================================================== */
/*  The unified team: stated pull, filled buckets, the complement's meaning   */
/* ========================================================================== */
import { fillBuckets, complementMeans, COMPLEMENT_MEANS } from "../scripts/vehicles/berths.mjs";

/* --- landSpeed takes a STATED pull where the caller can see attachments --- */
const rowless = {
  kind: "land",
  team: { animals: [] },
  speeds: { tiers: [{ team: 1, maxLoadStone: 80, feetPerTurn: 60 }] },
  condition: {},
};
assert.equal(landSpeed(rowless, 0).feetPerTurn, 0, "no rows, no stated pull: an unhitched wagon");
assert.equal(landSpeed(rowless, 0, null, { pull: 1 }).feetPerTurn, 60,
  "a harnessed ATTACHMENT reaches the arithmetic as a stated pull");
assert.equal(landSpeed(carted, 0, null, { pull: 0 }).feetPerTurn, 0,
  "a stated pull REPLACES the rows — the caller already summed both halves");

/* --- the draft bucket fills from draft-role occupants --------------------- */
const packWagon = { kind: "land", cargo: { capacityStone: 100, passengerStone: 50, passengers: 0 }, crew: {}, team: {} };
const packAboard = [
  { uuid: "a", name: "Ox", role: "draft", kind: "ox", stone: 0 },
  { uuid: "b", name: "Merchant", role: "passenger", stone: 50 },
  { uuid: "c", name: "Canoe", role: "cargo", stone: 12 },
];
let packed = fillBuckets(packWagon, packAboard, 10);
const bucketOf = (key) => packed.buckets.find((b) => b.key === key);
assert.equal(bucketOf("draft").members.length, 1, "the ox is IN the draft bucket");
assert.equal(bucketOf("cargo").members.length, 1, "actor-shaped freight shows in the cargo bucket");
assert.equal(bucketOf("cargo").stone, 22, "10 of freight plus the 12-stone canoe");
assert.equal(packed.pooled.used, 72, "10 freight + 12 canoe + 50 passenger, one pool on a wagon");

/* --- a vessel berths her passengers but her hold still carries the boat --- */
const packShip = { kind: "sea", cargo: { capacityStone: 100, passengerStone: 50, passengers: 0 }, crew: { roles: [] } };
packed = fillBuckets(packShip, packAboard.filter((o) => o.role !== "draft"), 10);
assert.equal(packed.pooled.used, 22, "berthed passengers do not draw on the hold; lashed cargo does");

/* --- what "crew" means is stated, and blank follows the kind -------------- */
assert.equal(complementMeans({ kind: "land", crew: {} }), "driver");
assert.equal(complementMeans({ kind: "sea", crew: {} }), "crew");
assert.equal(complementMeans({ kind: "land", crew: { means: "passengers" } }), "passengers",
  "a howdah's complement is its passengers, and now the field exists to say so");
assert.deepEqual(Object.keys(COMPLEMENT_MEANS), ["driver", "warriors", "passengers", "crew"],
  "the choices are exactly the readings complementMeans accepts");

console.log("test-vehicles: OK (stated pull, draft and cargo buckets, crew.means)");

/* ========================================================================== */
/*  Stations: the seat-by-seat view, and the effective crew                    */
/* ========================================================================== */
import { stationsFor, stationKeyOf, effectiveCrewRoles, OFFICER_STATIONS } from "../scripts/vehicles/stations.mjs";

/* --- a wagon: team by pull, one driver's seat, passengers ----------------- */
const wagonSys = {
  kind: "land",
  cargo: { passengers: 2, passengerStone: 50 },
  crew: {},
  team: { required: 2, animals: [{ kind: "heavyHorse", count: 1, pulling: true }] },
};
let st = stationsFor(wagonSys, [{ role: "crew", station: "driver", name: "Carter" }], { pull: 1.5 });
assert.deepEqual(st.map((g) => g.key), ["team", "complement", "passengers"]);
assert.equal(st[0].counts, "pull", "the team is counted in pull, not heads");
assert.equal(st[0].short, true, "1.5 of 2 required is short");
assert.equal(st[0].unnamed, 1, "one abstract animal");
assert.equal(st[1].singleton, true, "a wagon's complement is one driver's seat");
assert.equal(st[1].emptySlots, 0, "and Carter fills it");
assert.equal(st[2].filled, 2, "two unnamed passengers");

/* --- the howdah rule: the complement is its passengers, not a seat -------- */
st = stationsFor({ ...wagonSys, crew: { means: "passengers" } }, [], { pull: 2 });
assert.equal(st[1].labelKey, "ACKS-VEHICLES.bucket.passengers");
assert.equal(st[1].singleton, false, "no driver's seat on a howdah");
assert.equal(st[0].short, false, "2 of 2 required is whole");

/* --- a galley: role groups, named + unnamed, officer seats ---------------- */
const galleySys = {
  kind: "sea",
  cargo: { passengers: 0, passengerStone: 50 },
  crew: {
    roles: [
      { key: "sailors", label: "Sailors", required: 3, aboard: 2, motive: true },
      { key: "rowers", label: "Rowers", required: 4, aboard: 0, motive: true },
      { key: "marines", label: "Marines", required: 2, aboard: 1, motive: false },
    ],
  },
};
const crewAboard = [
  { role: "crew", station: "rowers", name: "Aella" },
  { role: "crew", station: "captain", name: "Kyra" },
];
st = stationsFor(galleySys, crewAboard);
const g = (key) => st.find((x) => x.key === key);
assert.equal(g("role:sailors").filled, 2, "typed hands count");
assert.equal(g("role:sailors").short, true);
assert.equal(g("role:rowers").filled, 1, "a named rower adds to the typed nought");
assert.equal(g("role:rowers").emptySlots, 3, "and three seats stand empty");
assert.equal(g("role:marines").short, false, "marines are not motive — no shortfall flag");
assert.equal(g("captain").filled, 1, "the captain's seat is taken");
assert.equal(g("captain").consequenceKey, null);
assert.ok(g("navigator").consequenceKey, "an empty navigator seat states its consequence");
assert.deepEqual(OFFICER_STATIONS, ["captain", "navigator"]);

/* --- station keys survive re-labelling, and honesty when nothing is typed - */
assert.equal(stationKeyOf({ key: "rowers", label: "Oarsmen" }, 0), "rowers");
assert.equal(stationKeyOf({ key: "", label: "Deck Gunners" }, 1), "deck-gunners");
assert.equal(stationKeyOf({ key: "", label: "" }, 2), "role-2");

/* --- the effective crew: what the speed derivations should see ------------ */
let eff = effectiveCrewRoles(galleySys, crewAboard);
assert.equal(eff[1].aboard, 1, "the named rower is a rower, not decoration");
assert.equal(eff[0].aboard, 3, "the captain counts as a SAILOR toward the complement");
assert.equal(eff[2].aboard, 1, "marines unchanged");
assert.equal(crewFraction(eff), 0.25, "the worst-manned motive role — one rower of four — governs");
eff = effectiveCrewRoles(galleySys, []);
assert.deepEqual(eff.map((r) => r.aboard), [2, 0, 1], "no named crew: the typed rows stand as typed");

console.log("test-vehicles: OK (stations, officer seats, effective crew)");

/* ========================================================================== */
/*  True weights, stacks, and the marines rule                                */
/* ========================================================================== */

/* --- a named passenger costs their TRUE mass; the rate prices the unnamed - */
const lightAboard = [{ uuid: "p", name: "Halfling", role: "passenger", stone: 20 }];
packed = fillBuckets(packWagon, lightAboard, 0);
assert.equal(packed.pooled.used, 20, "a specific character has a specific weight — no berth floor");
packed = fillBuckets({ ...packWagon, cargo: { ...packWagon.cargo, passengers: 2 } }, lightAboard, 0);
assert.equal(packed.pooled.used, 20 + 100, "unnamed heads still cost the printed rate, all-in");

/* --- the marines rule: non-motive crew's GEAR is freight, bodies are not.
   Invented numbers, shaped like the printed worked example. --- */
const marines = [
  { uuid: "m", name: "Marine Platoon", role: "crew", station: "marines", bodies: 40, stone: 640, gearStone: 240, cargoGear: true },
  { uuid: "s", name: "Aella", role: "crew", station: "sailors", bodies: 1, stone: 65, gearStone: 0, cargoGear: false },
];
packed = fillBuckets(galleySys, marines, 100);
assert.equal(packed.crewGearStone, 240, "a platoon's arms weigh per body times headcount");
assert.equal(packed.pooled.used, 340, "gear charges the hold; the bodies and the sailor never do");

/* --- stacks count every body they stand for ------------------------------ */
const bench = [{ role: "crew", station: "rowers", name: "Rower Gang", bodies: 3 }];
st = stationsFor(galleySys, bench);
assert.equal(g("role:rowers").filled, 3, "a stack of three rowers is three heads on the bench");
assert.equal(g("role:rowers").emptySlots, 1, "and one seat of four still stands empty");
eff = effectiveCrewRoles(galleySys, bench);
assert.equal(eff[1].aboard, 3, "three hands reach the speed math");
assert.ok(Math.abs(crewFraction(eff) - 2 / 3) < 1e-9,
  "the worst-manned motive role — two sailors of three — governs");
eff = effectiveCrewRoles(galleySys, [{ role: "crew", station: "captain", name: "Twins", bodies: 2 }]);
assert.equal(eff[0].aboard, 4, "a 2-body officer stack counts as two SAILORS toward the complement");
const rowboat = { role: "passenger", name: "Pilgrims", bodies: 5, stone: 100 };
st = stationsFor(
  { ...packWagon, crew: {}, cargo: { ...packWagon.cargo, passengers: 2 } },
  [rowboat],
  { pull: 2 },
);
assert.equal(st[2].filled, 7, "five stacked pilgrims and two unnamed heads are seven passengers");

console.log("test-vehicles: OK (true weights, marines' gear, stacked bodies)");
