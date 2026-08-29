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
  },
};

const load = () => registerTable(SAMPLE, { priority: PRIORITY.WORLD, source: "test" });

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
  assert.deepEqual(streetCadence({ where: "avenue", night: false }), { everyTurns: 8, target: 5 });
  assert.deepEqual(streetCadence({ where: "avenue", night: true }), { everyTurns: 4, target: 5 });
  assert.deepEqual(streetCadence({ where: "alley", night: true }), { everyTurns: 2, target: 4 });
  // Holed up keeps one cadence around the clock.
  assert.deepEqual(streetCadence({ where: "holedUp", night: true }), { everyTurns: 100, target: 4 });
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

console.log("\ntest-settlement: all " + passed + " checks passed");
