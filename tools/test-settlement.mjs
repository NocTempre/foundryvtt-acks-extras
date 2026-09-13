/**
 * Settlement travel: the pure derivations.
 *
 * Every number here is INVENTED. The real rates, targets and ladders are
 * printed and arrive through the importer, so a committed suite that used
 * them would be shipping book content; these prove the SHAPE — that a pace
 * scales, that a straggling tier picks the deepest rung reached, that a known
 * route suppresses the throw, and that an unimported table degrades to null
 * with a reason instead of a guess.
 */
import assert from "node:assert/strict";
import { registerTable, resetTables, PRIORITY } from "../scripts/lib/tables.mjs";
import {
  SETTLEMENT_DOC, SETTLEMENT_PACES, SETTLEMENT_LOCATIONS, ROUTE_KNOWLEDGE,
  freshSettlement, settlementOf, straggleTier, blocksPerTurn, citySpec,
  strayBlocks, streetCadence, advanceSettlementTurn,
  SETTLEMENT_INTENTS, CONVEYANCES, advanceSettlementDays, settlementEncounter,
  feetPerTurn, carryStay, resolveCityCadence, cadenceAttribution, pickIncidentSource, districtReaction,
  reenterSettlement, effectiveWhere, NAVIGATION_DIE, STREET_DIE, INCIDENT_DIE,
} from "../scripts/formation/settlement.mjs";

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok   " + name); };

/** One registered document, the way the importer would leave it. */
const SAMPLE = {
  id: SETTLEMENT_DOC,
  source: "invented",
  tables: {
    paces: {
      commuting: { blocksPerTurn: 7 },     // invented
      meandering: { blocksPerTurn: 2 },    // invented
    },
    navigation: { target: 9, knownDestination: 3, strayBlocks: "1d6+2" },  // invented
    straggling: { tiers: [{ from: 5, multiplier: 0.5 }, { from: 11, multiplier: 0.25 }] },
    encounters: {
      avenue: { day: { everyTurns: 8, throw: 5 }, night: { everyTurns: 4, throw: 5 } },
      alley: { day: { everyTurns: 4, throw: 5 }, night: { everyTurns: 2, throw: 4 } },
      holedUp: { any: { everyTurns: 100, throw: 4 } },
    },
    encounterIntent: { trouble: 2 },          // invented
    encounterAfterDark: 25,                   // invented
    encounters100: [                          // invented incidents, invented bands
      { min: 1, max: 40, text: "A goat is loose in the forum." },
      { min: 41, max: 80, text: "Two carters are shouting about a wheel." },
      { min: 81, max: 200, text: "Somebody is following you." },
    ],
  },
};

const load = () => registerTable(SAMPLE, { priority: PRIORITY.WORLD, source: "test" });

/** Assert the named fields, ignoring any the reader also returns. */
assert.match2 = (actual, expected) => {
  for (const [k, v] of Object.entries(expected)) assert.deepEqual(actual?.[k], v, k);
};

// ---- structure ships, values do not -------------------------------------
ok("the vocabularies are structural and complete", () => {
  assert.deepEqual(Object.keys(SETTLEMENT_PACES), ["commuting", "meandering"]);
  assert.deepEqual(Object.keys(SETTLEMENT_LOCATIONS), ["avenue", "alley", "holedUp"]);
  assert.deepEqual(Object.keys(ROUTE_KNOWLEDGE), ["unknown", "destination", "route"]);
  // The rule that only a commuting party can lose its way is structural.
  assert.equal(SETTLEMENT_PACES.commuting.throws, true);
  assert.equal(SETTLEMENT_PACES.meandering.throws, false);
  assert.equal(SETTLEMENT_LOCATIONS.holedUp.stationary, true);
  assert.equal(ROUTE_KNOWLEDGE.route.certain, true);
  // No file-level constant may carry a printed rate.
  for (const p of Object.values(SETTLEMENT_PACES)) {
    assert.equal("blocksPerTurn" in p, false, "a pace must not ship a rate");
  }
});

// ---- degradation --------------------------------------------------------
ok("an unimported settlement has no distance and says which table is missing", () => {
  resetTables();
  const r = blocksPerTurn({ pace: "commuting", headcount: 3 });
  assert.equal(r.blocks, null);
  assert.equal(r.missing, "paces");
  assert.equal(citySpec({ pace: "commuting", route: "unknown" }).missing, "navigation");
  assert.equal(strayBlocks(), null);
  assert.equal(streetCadence({ where: "avenue" }), null);
  assert.equal(straggleTier(40, { pace: "commuting" }), null);
});

// ---- paces and straggling ----------------------------------------------
ok("a pace carries its rate and a small party is not slowed", () => {
  resetTables(); load();
  assert.equal(blocksPerTurn({ pace: "commuting", headcount: 4 }).blocks, 7);
  assert.equal(blocksPerTurn({ pace: "meandering", headcount: 4 }).blocks, 2);
});

ok("straggling picks the DEEPEST rung the party has reached", () => {
  resetTables(); load();
  assert.equal(straggleTier(4, { pace: "commuting" }), null);
  assert.equal(straggleTier(5, { pace: "commuting" }).multiplier, 0.5);
  assert.equal(straggleTier(10, { pace: "commuting" }).multiplier, 0.5);
  // 11 clears both rungs; the deeper one wins, not the first matched.
  assert.equal(straggleTier(11, { pace: "commuting" }).from, 11);
  assert.equal(straggleTier(99, { pace: "commuting" }).multiplier, 0.25);
});

ok("straggling bites the commuting pace only", () => {
  resetTables(); load();
  assert.equal(straggleTier(50, { pace: "meandering" }), null);
  // A meandering crowd is already slow; its rate is untouched by headcount.
  assert.equal(blocksPerTurn({ pace: "meandering", headcount: 50 }).blocks, 2);
  assert.equal(blocksPerTurn({ pace: "commuting", headcount: 50 }).blocks, 7 * 0.25);
});

ok("the readout names each factor, the way the march does", () => {
  resetTables(); load();
  const r = blocksPerTurn({ pace: "commuting", headcount: 12 });
  assert.deepEqual(r.parts.map((p) => p.key), ["commuting", "straggling"]);
  assert.equal(r.parts[1].from, 11);
});

// ---- the navigation throw ----------------------------------------------
ok("a known route needs no throw; a known destination earns a modifier", () => {
  resetTables(); load();
  const bare = citySpec({ pace: "commuting", route: "unknown" });
  assert.equal(bare.throws, true);
  assert.equal(bare.target, 9);
  assert.equal(bare.modifier, 0);

  const partial = citySpec({ pace: "commuting", route: "destination" });
  assert.equal(partial.modifier, 3);

  const known = citySpec({ pace: "commuting", route: "route" });
  assert.equal(known.throws, false);
  assert.equal(known.reason, "route");
});

ok("a meandering party never throws, whatever it knows", () => {
  resetTables(); load();
  for (const route of Object.keys(ROUTE_KNOWLEDGE)) {
    const spec = citySpec({ pace: "meandering", route });
    assert.equal(spec.throws, false, "meandering must not throw");
  }
  assert.equal(citySpec({ pace: "meandering", route: "unknown" }).reason, "pace");
});

ok("the stray distance is a registered expression, never a literal", () => {
  resetTables(); load();
  assert.equal(strayBlocks(), "1d6+2");
});

// ---- the street ---------------------------------------------------------
ok("cadence is keyed by where you are and whether it is dark", () => {
  resetTables(); load();
  assert.match2(streetCadence({ where: "avenue", night: false }), { everyTurns: 8, target: 5 });
  assert.match2(streetCadence({ where: "avenue", night: true }), { everyTurns: 4, target: 5 });
  assert.match2(streetCadence({ where: "alley", night: true }), { everyTurns: 2, target: 4 });
  // Holed up keeps one cadence around the clock.
  assert.match2(streetCadence({ where: "holedUp", night: true }), { everyTurns: 100, target: 4 });
  assert.equal(streetCadence({ where: "nowhere" }), null);
});

// ---- the record ---------------------------------------------------------
ok("a junk record normalizes to the fresh board", () => {
  const s = settlementOf({ settlement: { pace: "sprinting", where: "rooftop", route: "psychic", blocks: "x" } });
  const fresh = freshSettlement();
  assert.equal(s.pace, fresh.pace);
  assert.equal(s.where, fresh.where);
  assert.equal(s.route, fresh.route);
  assert.equal(s.blocks, 0);
  assert.equal(s.night, false);
});

/* --- the turn tick: what makes the board's fields live -------------------- */
ok("a turn moves the party and counts itself", () => {
  resetTables(); load();
  const { board } = advanceSettlementTurn(freshSettlement(), { headcount: 2 });
  assert.equal(board.turns, 1);
  assert.equal(board.blocks, 2, "the meandering rate");
});

ok("blocks accumulate across turns", () => {
  resetTables(); load();
  let b = freshSettlement();
  for (let i = 0; i < 3; i++) b = advanceSettlementTurn(b, { headcount: 2 }).board;
  assert.equal(b.turns, 3);
  assert.equal(b.blocks, 6);
});

ok("holed up spends the turn without covering ground", () => {
  resetTables(); load();
  const { board } = advanceSettlementTurn({ ...freshSettlement(), where: "holedUp" }, {});
  assert.equal(board.turns, 1, "time still passes");
  assert.equal(board.blocks, 0, "but no blocks are crossed");
});

ok("an unpriced city says so instead of moving nobody quietly", () => {
  resetTables();
  const { events } = advanceSettlementTurn(freshSettlement(), {});
  assert.ok(events.some((e) => e.kind === "unpriced" && e.what === "paces"));
});

ok("a commuting party that fails its throw strays, and KNOWS it", () => {
  resetTables(); load();
  const commuting = { ...freshSettlement(), pace: "commuting", route: "unknown" };
  const miss = advanceSettlementTurn(commuting, { navRoll: 2 });
  assert.equal(miss.board.lost, true, "a city is not the wild — you notice at once");
  assert.equal(miss.board.lastThrow.kept, false);
  assert.ok(miss.events.some((e) => e.kind === "strayed"));

  const hit = advanceSettlementTurn(commuting, { navRoll: 19 });
  assert.equal(hit.board.lost, false);
  assert.equal(hit.board.lastThrow.kept, true);
  assert.ok(!hit.events.some((e) => e.kind === "strayed"));
});

ok("the known-destination modifier is applied to the throw", () => {
  resetTables(); load();
  const board = { ...freshSettlement(), pace: "commuting", route: "destination" };
  // 6 + 3 clears a target of 9; the same roll bare would not.
  assert.equal(advanceSettlementTurn(board, { navRoll: 6 }).board.lastThrow.kept, true);
  assert.equal(
    advanceSettlementTurn({ ...board, route: "unknown" }, { navRoll: 6 }).board.lastThrow.kept,
    false,
  );
});

ok("a meandering party never strays, whatever it rolls", () => {
  resetTables(); load();
  const { board, events } = advanceSettlementTurn(freshSettlement(), { navRoll: 1 });
  assert.equal(board.lost, false);
  assert.equal(board.lastThrow, null, "no throw was owed, so none is recorded");
  assert.ok(!events.some((e) => e.kind === "strayed"));
});

ok("the street answers on its own cadence, not every turn", () => {
  resetTables(); load();
  let b = freshSettlement();          // avenue by day: every 8 turns
  const owed = [];
  for (let i = 0; i < 16; i++) {
    const step = advanceSettlementTurn(b, {});
    b = step.board;
    if (step.events.some((e) => e.kind === "encounterOwed")) owed.push(b.turns);
  }
  assert.deepEqual(owed, [8, 16], "twice in sixteen turns, not sixteen times");
});

ok("an alley after dark answers far more often", () => {
  resetTables(); load();
  let b = { ...freshSettlement(), where: "alley", night: true };  // every 2 turns
  let count = 0;
  for (let i = 0; i < 8; i++) {
    const step = advanceSettlementTurn(b, {});
    b = step.board;
    if (step.events.some((e) => e.kind === "encounterOwed")) count++;
  }
  assert.equal(count, 4, "four times where the avenue managed one");
});

ok("an encounter roll is judged against the street's own target", () => {
  resetTables(); load();
  let b = { ...freshSettlement(), where: "alley", night: true };
  b = advanceSettlementTurn(b, {}).board;
  const step = advanceSettlementTurn(b, { encounterRoll: 6 });
  const owed = step.events.find((e) => e.kind === "encounterOwed");
  assert.equal(owed.target, 4);
  assert.equal(owed.met, true);
});

/* --- looking for trouble ---------------------------------------------------
   RAW eases the THROW; it does not make the encounter come round sooner. The
   distinction matters: a shorter interval would compound over a long walk. */
ok("the intents are structural and only one of them seeks", () => {
  assert.deepEqual(Object.keys(SETTLEMENT_INTENTS), ["ordinary", "trouble"]);
  assert.ok(SETTLEMENT_INTENTS.trouble.seeks);
  assert.ok(!SETTLEMENT_INTENTS.ordinary.seeks);
});

ok("looking for trouble eases the throw and leaves the cadence alone", () => {
  load();
  const calm = streetCadence({ where: "avenue", intent: "ordinary" });
  const rowdy = streetCadence({ where: "avenue", intent: "trouble" });
  assert.equal(rowdy.everyTurns, calm.everyTurns, "trouble does not come round sooner");
  assert.equal(rowdy.target, calm.target - 2, "it lands on a lower number");
  assert.equal(rowdy.bareTarget, calm.target, "and the ordinary target is still reported");
  assert.equal(rowdy.modifier, 2);
  assert.equal(calm.modifier, 0);
  resetTables();
});

ok("a party seeking trouble with no imported figure is TOLD, not quietly ordinary", () => {
  registerTable({
    id: SETTLEMENT_DOC, source: "invented",
    tables: { ...SAMPLE.tables, encounterIntent: {} },
  }, { priority: PRIORITY.WORLD, source: "test" });
  const c = streetCadence({ where: "avenue", intent: "trouble" });
  assert.equal(c.unpricedIntent, true);
  assert.equal(c.target, c.bareTarget, "and it does not invent a bonus");
  resetTables();
});

/* --- holing up: the one settlement rate measured in days ------------------ */
ok("holing up throws once a day and covers no ground", () => {
  load();
  const board = { ...freshSettlement(), where: "holedUp" };
  const { board: next, events } = advanceSettlementDays(board, { days: 3, rolls: [6, 1, 4] });
  assert.equal(next.days, 3);
  assert.equal(next.blocks, 0, "a party holed up goes nowhere");
  const owed = events.filter((e) => e.kind === "encounterOwed");
  assert.equal(owed.length, 3, "one throw per day, not one per turn");
  assert.deepEqual(owed.map((e) => e.scale), ["day", "day", "day"]);
  assert.deepEqual(owed.map((e) => e.met), [true, false, true]);
  resetTables();
});

ok("a party on the street cannot spend DAYS holed up", () => {
  load();
  const { events } = advanceSettlementDays({ ...freshSettlement(), where: "avenue" }, { days: 2 });
  assert.equal(events[0].kind, "notHoledUp");
  resetTables();
});

ok("zero days is a no-op, and an unimported street says so", () => {
  const board = { ...freshSettlement(), where: "holedUp" };
  assert.deepEqual(advanceSettlementDays(board, { days: 0 }).events, [], "nothing owed");
  const un = advanceSettlementDays(board, { days: 1 });
  assert.equal(un.events[0].kind, "unpriced");
});

/* --- the settlement encounter table --------------------------------------- */
ok("a d100 roll finds its band, and the dark shifts it", () => {
  load();
  const day = settlementEncounter(35, { night: false });
  assert.equal(day.total, 35);
  assert.equal(day.afterDark, 0);
  assert.equal(day.entry, "A goat is loose in the forum.");

  const night = settlementEncounter(35, { night: true });
  assert.equal(night.afterDark, 25, "the printed modifier is added");
  assert.equal(night.total, 60);
  assert.equal(night.entry, "Two carters are shouting about a wheel.", "the dark reaches worse rows");
  resetTables();
});

ok("an unimported table yields no incident rather than an invented one", () => {
  assert.equal(settlementEncounter(35), null);
  load();
  assert.equal(settlementEncounter("nonsense"), null, "and junk is not a roll");
  resetTables();
});

/* --- a conveyance is privacy, never speed --------------------------------- */
ok("the conveyances carry no rate at all", () => {
  assert.deepEqual(Object.keys(CONVEYANCES), ["onFoot", "litter", "wagon"]);
  for (const spec of Object.values(CONVEYANCES)) {
    assert.equal(spec.blocksPerTurn, undefined, "a conveyance must not price movement");
    assert.equal(spec.multiplier, undefined);
  }
  assert.ok(CONVEYANCES.litter.private && CONVEYANCES.wagon.private);
  assert.ok(!CONVEYANCES.onFoot.private);
});

ok("and riding in one changes no distance", () => {
  load();
  const walking = blocksPerTurn({ pace: "commuting", headcount: 3 });
  assert.equal(
    blocksPerTurn({ pace: "commuting", headcount: 3 }).blocks, walking.blocks,
    "a litter is not any faster",
  );
  assert.equal(settlementOf({ settlement: { conveyance: "litter" } }).conveyance, "litter",
    "but the board remembers it");
  assert.equal(settlementOf({ settlement: { conveyance: "palanquin" } }).conveyance, "onFoot",
    "an unknown conveyance falls back rather than inventing one");
  resetTables();
});


ok("an unstamped stay reads as unstamped, not as world time zero", () => {
  // Number(null) is 0, and a stay stamped at the epoch is a stay the clock
  // watcher charges every day since the world began for.
  assert.equal(settlementOf({ settlement: {} }).holeUpSince, null);
  assert.equal(settlementOf({ settlement: { holeUpSince: null } }).holeUpSince, null);
  assert.equal(settlementOf({ settlement: { holeUpSince: "" } }).holeUpSince, null);
  assert.equal(settlementOf({ settlement: { holeUpSince: 86400 } }).holeUpSince, 86400);
  assert.equal(settlementOf({ settlement: { holeUpSince: 0 } }).holeUpSince, 0,
    "but a stay that really began at zero is kept");
});

ok("changing where the party is ends the stay it was on", () => {
  const prev = { ...freshSettlement(), where: "holedUp", holeUpSince: 86400 };
  const stayed = carryStay(prev, { ...prev, night: true });
  assert.equal(stayed.holeUpSince, 86400, "a stay survives a write that did not move them");
  const left = carryStay(prev, { ...prev, where: "alley" });
  assert.equal(left.holeUpSince, null, "and never survives one that did");
});

/* --- the tracker: blocks are turned into the feet a map draws them at ------ */
ok("a turn's distance is the pace's blocks in the map's own feet", () => {
  load();
  const rate = blocksPerTurn({ pace: "commuting", headcount: 1 }).blocks;
  const walk = feetPerTurn({ pace: "commuting", headcount: 1, blockFeet: 120 });
  assert.equal(walk.feet, rate * 120);
  assert.equal(walk.blocks, rate);
  assert.equal(walk.blockFeet, 120);
  resetTables();
});

ok("a straggling party covers fewer feet for the same turn", () => {
  load();
  const small = feetPerTurn({ pace: "commuting", headcount: 2, blockFeet: 120 }).feet;
  const crowd = feetPerTurn({ pace: "commuting", headcount: 12, blockFeet: 120 }).feet;
  assert.ok(crowd < small, "the tiers must reach the tracker, not only the readout");
  resetTables();
});

ok("a map that has not said how big a block is yields no distance, and names the missing half", () => {
  load();
  assert.deepEqual(feetPerTurn({ pace: "commuting", headcount: 1, blockFeet: null }),
    { feet: null, missing: "blockFeet" });
  assert.deepEqual(feetPerTurn({ pace: "commuting", headcount: 1, blockFeet: 0 }),
    { feet: null, missing: "blockFeet" });
  resetTables();
});

ok("and an unimported city yields none either, naming the table instead", () => {
  assert.deepEqual(feetPerTurn({ pace: "commuting", headcount: 1, blockFeet: 120 }),
    { feet: null, missing: "paces" });
});

/* --- a stay is thrown for by the day, and only once ----------------------- */
ok("a holed-up turn owes no street throw - the day tick owns it", () => {
  load();
  const board = { ...freshSettlement(), where: "holedUp", turns: 99 };
  const { board: next, events } = advanceSettlementTurn(board, { headcount: 3, encounterRoll: 6 });
  assert.equal(next.turns, 100, "the turn is still marked off - time passes while holed up");
  assert.equal(next.blocks, 0, "and no ground is covered");
  assert.ok(!events.some((e) => e.kind === "encounterOwed"),
    "a stay thrown for by both clocks is thrown for twice");
  assert.ok(!events.some((e) => e.kind === "unpriced"),
    "nor is the day cadence reported missing when it is merely not this tick's business");
  resetTables();
});

ok("nor does a party staying put throw to find its way", () => {
  load();
  const board = { ...freshSettlement(), where: "holedUp", pace: "commuting", route: "unknown" };
  const { board: next, events } = advanceSettlementTurn(board, { headcount: 3, navRoll: 1 });
  assert.equal(next.lost, false, "there is nowhere it was trying to get to");
  assert.equal(next.lastThrow, null);
  assert.ok(!events.some((e) => e.kind === "strayed"));
  resetTables();
});

ok("but the day tick still throws for that same stay", () => {
  load();
  const board = { ...freshSettlement(), where: "holedUp" };
  const { events } = advanceSettlementDays(board, { days: 2, rolls: [6, 1] });
  const owed = events.filter((e) => e.kind === "encounterOwed");
  assert.equal(owed.length, 2);
  assert.equal(owed[0].met, true);
  assert.equal(owed[1].met, false);
  resetTables();
});


// ---- the dice are structural, and they are not the same die ---------------
ok("the navigation throw and the street throw are made on different dice", () => {
  // Both readers price their targets on their own scale, so one die read
  // against the other's target changes how often the street answers.
  assert.equal(NAVIGATION_DIE, "1d20");
  assert.equal(STREET_DIE, "1d6");
  assert.equal(INCIDENT_DIE, "1d100");
  assert.notEqual(NAVIGATION_DIE, STREET_DIE);
});

// ---- what a Judge draws over the street ----------------------------------
ok("with nothing drawn over it, the street answers for itself", () => {
  load();
  const street = streetCadence({ where: "avenue", night: false });
  const got = resolveCityCadence(street, {});
  assert.match2(got, {
    everyTurns: street.everyTurns, target: street.target,
    everyTurnsSource: "street", targetSource: "street",
  });
  resetTables();
});

ok("a zone overrides the street PER FIELD, and a zero means inherit", () => {
  load();
  const street = streetCadence({ where: "avenue", night: false });
  // Interval only: the target beneath it stands — and is still credited to
  // the street, not to the zone that never stated one.
  const interval = resolveCityCadence(street, { zone: { encounterEvery: 2, encounterTarget: 0 } });
  assert.match2(interval, {
    everyTurns: 2, target: street.target,
    everyTurnsSource: "zone", targetSource: "street",
  });
  // Target only: the interval beneath it stands, credited to the street.
  const target = resolveCityCadence(street, { zone: { encounterEvery: 0, encounterTarget: 3 } });
  assert.match2(target, {
    everyTurns: street.everyTurns, target: 3,
    everyTurnsSource: "street", targetSource: "zone",
  });
  // Neither: a zone that states nothing changes nothing.
  const neither = resolveCityCadence(street, { zone: { encounterEvery: 0, encounterTarget: 0 } });
  assert.match2(neither, {
    everyTurns: street.everyTurns, target: street.target,
    everyTurnsSource: "street", targetSource: "street",
  });
  resetTables();
});

ok("a district beats a zone, which beats the street", () => {
  load();
  const street = streetCadence({ where: "avenue", night: false });
  const got = resolveCityCadence(street, {
    zone: { encounterEvery: 2, encounterTarget: 3 },
    district: { encounterEveryDay: 1, encounterTargetDay: 2 },
  });
  assert.match2(got, {
    everyTurns: 1, target: 2, everyTurnsSource: "district", targetSource: "district",
  });
  // And the district's night pair is the one the dark reads.
  const dark = resolveCityCadence(street, {
    zone: { encounterEvery: 2, encounterTarget: 3 },
    district: { encounterEveryDay: 1, encounterTargetDay: 2, encounterEveryNight: 5, encounterTargetNight: 4 },
    night: true,
  });
  assert.match2(dark, { everyTurns: 5, target: 4 });
  resetTables();
});

ok("a district that prices only the night pair inherits the day figures beneath it", () => {
  load();
  const day = streetCadence({ where: "avenue", night: false });
  const night = streetCadence({ where: "avenue", night: true });
  const district = { encounterEveryNight: 1, encounterTargetNight: 2 };
  // By day the district has said nothing (its day fields are unstated), so
  // the street beneath it answers untouched — the realistic gazetteer case.
  const byDay = resolveCityCadence(day, { district, night: false });
  assert.match2(byDay, {
    everyTurns: day.everyTurns, target: day.target,
    everyTurnsSource: "street", targetSource: "street",
  });
  const afterDark = resolveCityCadence(night, { district, night: true });
  assert.match2(afterDark, {
    everyTurns: 1, target: 2, everyTurnsSource: "district", targetSource: "district",
  });
  resetTables();
});

ok("each FIGURE is credited to the layer that stated it, not the pair to one", () => {
  load();
  const street = streetCadence({ where: "avenue", night: false });
  const zone = { encounterEvery: 2, encounterTarget: 3 };
  // The district states only an interval, so the target is still the ZONE's.
  // Crediting the pair to the district here prints the zone's target under
  // the district's name, which is the defect this pair of fields exists for.
  const intervalOnly = resolveCityCadence(street, { zone, district: { encounterEveryDay: 1 } });
  assert.match2(intervalOnly, {
    everyTurns: 1, target: 3, everyTurnsSource: "district", targetSource: "zone",
  });
  // And the mirror: the interval is the zone's where only a target is stated.
  // 6 rather than a larger figure because the schema caps a 1d6 target at 6;
  // a test value outside the field's own range proves nothing about the field.
  const targetOnly = resolveCityCadence(street, { zone, district: { encounterTargetDay: 6 } });
  assert.match2(targetOnly, {
    everyTurns: 2, target: 6, everyTurnsSource: "zone", targetSource: "district",
  });
  resetTables();
});

ok("the attribution line names one place, or two, or nothing at all", () => {
  load();
  const street = streetCadence({ where: "avenue", night: false });
  const names = { street: "the street", zone: "The Harbour", district: "Thieves' Quarter" };

  // Both the street's: no line is owed, because nothing was overridden.
  assert.equal(cadenceAttribution(resolveCityCadence(street, {}), names), null);

  // One layer owns both figures: one place named.
  const whole = cadenceAttribution(
    resolveCityCadence(street, { district: { encounterEveryDay: 1, encounterTargetDay: 2 } }),
    names,
  );
  assert.equal(whole.key, "ACKS-FORMATION.settlement.cadenceInside");
  assert.equal(whole.data.place, "Thieves' Quarter");

  // Two owners: the SPLIT line, with each figure beside its own owner.
  const split = cadenceAttribution(
    resolveCityCadence(street, {
      zone: { encounterEvery: 2, encounterTarget: 0 },
      district: { encounterEveryDay: 0, encounterTargetDay: 4 },
    }),
    names,
  );
  assert.equal(split.key, "ACKS-FORMATION.settlement.cadenceSplit");
  assert.equal(split.data.turns, 2);
  assert.equal(split.data.turnsFrom, "The Harbour");
  assert.equal(split.data.target, 4);
  assert.equal(split.data.targetFrom, "Thieves' Quarter");

  // A layer with no name to print cannot be attributed, so nothing is said
  // rather than a figure being left hanging under no owner.
  const nameless = cadenceAttribution(
    resolveCityCadence(street, { zone: { encounterEvery: 2, encounterTarget: 0 } }),
    { street: "the street", zone: "" },
  );
  assert.equal(nameless, null);
  assert.equal(cadenceAttribution(null, names), null);
  resetTables();
});

ok("a district whose every cadence field is zero changes nothing beneath it", () => {
  load();
  const street = streetCadence({ where: "avenue", night: false });
  const zone = { encounterEvery: 2, encounterTarget: 3 };
  const allZero = {
    encounterEveryDay: 0, encounterTargetDay: 0, encounterEveryNight: 0, encounterTargetNight: 0,
  };
  const inert = resolveCityCadence(street, { zone, district: allZero });
  assert.match2(inert, {
    everyTurns: 2, target: 3, everyTurnsSource: "zone", targetSource: "zone",
  });
  // And AFTER DARK, which is the only call that reads the two night fields at
  // all: a day-only check leaves half the zeros unexercised.
  const inertDark = resolveCityCadence(street, { zone, district: allZero, night: true });
  assert.match2(inertDark, {
    everyTurns: 2, target: 3, everyTurnsSource: "zone", targetSource: "zone",
  });
  resetTables();
});

ok("resolveCityCadence is null when nothing prices both figures, a district's bare interval included", () => {
  // BOTH halves of the guard, because they fail independently and a street
  // cadence always carries an interval — so passing one hides the first half.
  const onlyInterval = resolveCityCadence(null, { district: { encounterEveryDay: 4, encounterTargetDay: 0 } });
  assert.equal(onlyInterval, null, "an interval with no target anywhere cannot be thrown");
  const onlyTarget = resolveCityCadence(null, { district: { encounterEveryDay: 0, encounterTargetDay: 4 } });
  assert.equal(onlyTarget, null, "a target with no interval anywhere is never reached");
  const acrossLayers = resolveCityCadence(null, {
    zone: { encounterEvery: 0, encounterTarget: 5 },
    district: { encounterEveryDay: 0, encounterTargetDay: 0 },
  });
  assert.equal(acrossLayers, null, "two layers stating only targets still price no throw");
});

ok("looking for trouble eases whichever target answered, and only once", () => {
  load();
  // The intent modifier is the PARTY's: it applies to the zone's target the
  // same way it applies to the street's, and is never subtracted twice by
  // reading a target that already had it taken off.
  const street = streetCadence({ where: "avenue", night: false, intent: "trouble" });
  const got = resolveCityCadence(street, { zone: { encounterEvery: 0, encounterTarget: 6 }, intent: "trouble" });
  assert.match2(got, { bareTarget: 6, modifier: 2, target: 4, seeking: true });
  resetTables();
});

ok("a zone can price a throw the registry never did", () => {
  // Nothing registered: the street has no cadence at all, and a fully stated
  // zone is still an answer — a Judge who typed both figures meant them.
  assert.equal(streetCadence({ where: "avenue" }), null);
  const got = resolveCityCadence(null, { zone: { encounterEvery: 3, encounterTarget: 5 } });
  assert.match2(got, {
    everyTurns: 3, target: 5, everyTurnsSource: "zone", targetSource: "zone",
  });
  // A half-stated one is not: an interval with no target cannot be thrown.
  assert.equal(resolveCityCadence(null, { zone: { encounterEvery: 3, encounterTarget: 0 } }), null);
});

ok("the incident table is picked innermost-first, on its own", () => {
  assert.match2(pickIncidentSource({}), { tableUuid: null, source: "city" });
  assert.match2(pickIncidentSource({ zone: { tableUuid: "RollTable.zone" } }),
    { tableUuid: "RollTable.zone", source: "zone" });
  assert.match2(pickIncidentSource({
    zone: { tableUuid: "RollTable.zone" }, district: { tableUuid: "RollTable.district" },
  }), { tableUuid: "RollTable.district", source: "district" });
  // Being hunted here reads the district's wanted table, and only when there
  // is one — a district with no wanted table falls back to its ordinary one.
  assert.match2(pickIncidentSource({
    district: { tableUuid: "RollTable.district", wantedTableUuid: "RollTable.wanted" }, wanted: true,
  }), { tableUuid: "RollTable.wanted", source: "wanted" });
  assert.match2(pickIncidentSource({ district: { tableUuid: "RollTable.district" }, wanted: true }),
    { tableUuid: "RollTable.district", source: "district" });
});

ok("a district's welcome is owed where its scope names, and district-wide at 'any'", () => {
  const districtWide = { reactionModifier: -4, reactionWhere: "any" };
  assert.deepEqual(districtReaction(districtWide, { where: "avenue" }), { modifier: -4, scope: "any" });
  assert.deepEqual(districtReaction(districtWide, { where: "alley" }), { modifier: -4, scope: "any" });

  const narrowed = { reactionModifier: 3, reactionWhere: "alley" };
  assert.deepEqual(districtReaction(narrowed, { where: "alley" }), { modifier: 3, scope: "alley" });
  assert.equal(districtReaction(narrowed, { where: "avenue" }), null, "named elsewhere, not owed here");
  assert.equal(districtReaction(null, { where: "avenue" }), null, "no district, nothing owed");
});

ok("no reaction figure is owed at zero, and a negative one survives", () => {
  assert.equal(districtReaction({ reactionModifier: 0, reactionWhere: "any" }, { where: "avenue" }), null);
  // reactionModifier is signed and never passes through stated(), whose
  // contract rejects a negative — the whole point of this field is a quarter
  // that makes strangers LESS welcome, and it must still answer.
  const hostile = { reactionModifier: -6, reactionWhere: "any" };
  assert.deepEqual(districtReaction(hostile, { where: "alley" }), { modifier: -6, scope: "any" });
});

ok("the turn throws against the cadence it is HANDED, not the street's", () => {
  load();
  const board = { ...freshSettlement(), where: "avenue", pace: "meandering" };
  const cadence = {
    everyTurns: 1, target: 5, bareTarget: 5, modifier: 0,
    everyTurnsSource: "zone", targetSource: "zone",
  };
  const { events } = advanceSettlementTurn(board, { headcount: 1, encounterRoll: 5, cadence });
  const owed = events.find((e) => e.kind === "encounterOwed");
  assert.match2(owed, {
    target: 5, met: true, everyTurns: 1, everyTurnsSource: "zone", targetSource: "zone",
  });
  resetTables();
});

ok("and a holed-up stay is thrown for at the cadence it is handed too", () => {
  load();
  const board = { ...freshSettlement(), where: "holedUp" };
  const cadence = {
    everyTurns: 1, target: 6, bareTarget: 6, modifier: 0,
    everyTurnsSource: "zone", targetSource: "zone",
  };
  const { events } = advanceSettlementDays(board, { days: 1, rolls: [6], cadence });
  assert.match2(events.find((e) => e.kind === "encounterOwed"), { target: 6, met: true });
  resetTables();
});

// ---- coming back to a city -----------------------------------------------
ok("re-entering a city keeps what the Judge set and drops what the last city counted", () => {
  const previous = {
    ...freshSettlement(),
    pace: "commuting", where: "alley", route: "route", night: true,
    intent: "trouble", conveyance: "litter",
    blocks: 40, turns: 11, days: 3, holeUpSince: 500, lost: true,
    lastThrow: { total: 4, target: 9, kept: false },
  };
  const back = reenterSettlement(previous);
  // What was told stays.
  assert.match2(back, {
    pace: "commuting", where: "alley", route: "route", night: true,
    intent: "trouble", conveyance: "litter",
  });
  // What was counted goes — another city's mileage is not this one's.
  assert.match2(back, { blocks: 0, turns: 0, days: 0, holeUpSince: null, lost: false, lastThrow: null });
});

ok("being hunted starts false, coerces to a boolean, and does not survive re-entry", () => {
  assert.equal(freshSettlement().wanted, false);
  assert.equal(settlementOf({ settlement: { wanted: true } }).wanted, true);
  assert.equal(settlementOf({ settlement: { wanted: 1 } }).wanted, true, "a stored truthy value is coerced");
  assert.equal(settlementOf({ settlement: { wanted: 0 } }).wanted, false);
  assert.equal(settlementOf({ settlement: {} }).wanted, false);
  // A quarter's own powers are not carried to the next one, though the pace
  // and route the Judge told the board are.
  const back = reenterSettlement({ ...freshSettlement(), wanted: true, pace: "commuting" });
  assert.equal(back.wanted, false);
  assert.equal(back.pace, "commuting", "unrelated Judge-told fields still carry");
});

// ---- a figure that never arrived is never a zero -------------------------
ok("a known destination with no imported modifier is TOLD, not quietly bare", () => {
  registerTable({
    id: SETTLEMENT_DOC,
    source: "invented",
    // The target arrived; the modifier's own sentence did not parse.
    tables: { navigation: { target: 9 } },
  }, { priority: PRIORITY.WORLD, source: "test" });
  const spec = citySpec({ pace: "commuting", route: "destination" });
  assert.match2(spec, { throws: true, target: 9, modifier: 0, unpricedRoute: true });
  resetTables();

  load();
  const priced = citySpec({ pace: "commuting", route: "destination" });
  assert.match2(priced, { throws: true, modifier: 3 });
  assert.equal(priced.unpricedRoute, false, "an imported figure is not a gap");
  // A party that has never been there has no modifier to be missing.
  assert.equal(citySpec({ pace: "commuting", route: "unknown" }).unpricedRoute, undefined);
  resetTables();
});

/* -------------------------------------------- */
/*  Where the party is, read off the map        */
/* -------------------------------------------- */

ok("a drawn street answers where the party is, over the picker", () => {
  const board = { where: "avenue" };
  // The road was DRAWN and the picker was typed. A Judge who laid an alley and
  // left the picker on the avenue meant the alley.
  assert.deepEqual(effectiveWhere(board, "alley"), { where: "alley", from: "road" });
  // With no street underfoot there is nothing to override with.
  assert.deepEqual(effectiveWhere(board, null), { where: "avenue", from: "picker" });
  assert.deepEqual(effectiveWhere(board, ""), { where: "avenue", from: "picker" });
});

ok("a party holed up is holed up whatever it is standing on", () => {
  // The room is the answer; the street outside the door is not.
  assert.deepEqual(effectiveWhere({ where: "holedUp" }, "avenue"), { where: "holedUp", from: "picker" });
});

ok("nothing but a street kind can be read off a road", () => {
  const board = { where: "avenue" };
  // A wall flagged as a street is a street, and nobody is hiding inside one.
  assert.deepEqual(effectiveWhere(board, "holedUp"), { where: "avenue", from: "picker" });
  assert.deepEqual(effectiveWhere(board, "sewer"), { where: "avenue", from: "picker" });
});

ok("the board carries the road it was resolved on, and nothing half-stated", () => {
  const kept = settlementOf({ settlement: { road: { name: "Fish Row", surface: "paved", street: "alley" } } });
  assert.deepEqual(kept.road, { name: "Fish Row", surface: "paved", street: "alley" });
  // A snapshot with no surface is not a road: it would print as a street with
  // no kind and be read as one the map had nothing to say about.
  assert.equal(settlementOf({ settlement: { road: { name: "Nowhere" } } }).road, null);
  assert.equal(settlementOf({ settlement: {} }).road, null);
  assert.equal(settlementOf({ settlement: { road: { surface: "earth", street: "lane" } } }).road.street, null);
});

ok("how the last move was measured is remembered, and starts unanswered", () => {
  assert.equal(settlementOf({ settlement: {} }).measuredAlong, null, "until the party has moved");
  assert.equal(settlementOf({ settlement: { measuredAlong: true } }).measuredAlong, true);
  assert.equal(settlementOf({ settlement: { measuredAlong: false } }).measuredAlong, false);
  // Re-entering a city has measured nothing yet, and keeps no road from the
  // last one: both belong to the streets they were read off.
  const again = reenterSettlement({ where: "alley", road: { surface: "paved" }, measuredAlong: true });
  assert.equal(again.road, null);
  assert.equal(again.measuredAlong, null);
});

console.log("\ntest-settlement: all " + passed + " checks passed");
