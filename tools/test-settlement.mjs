/**
 * Settlement travel: the pure derivations.
 *
 * Every number here is INVENTED. The real rates, targets and ladders are
 * printed and arrive through acks-importer, so a committed suite that used
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
  strayBlocks, streetCadence, settlementReady, advanceSettlementTurn,
  SETTLEMENT_INTENTS, CONVEYANCES, advanceSettlementDays, settlementEncounter,
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
  assert.equal(settlementReady(), false);
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
  assert.equal(settlementReady(), true);
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


console.log("\ntest-settlement: all " + passed + " checks passed");
