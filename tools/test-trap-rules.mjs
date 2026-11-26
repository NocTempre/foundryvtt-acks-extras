/**
 * Traps: who meets one first, who it catches, what the disarm throw is, and
 * whether a thief may try again. Pure functions; no Foundry, no world.
 */
import assert from "node:assert/strict";
import {
  CRUDE,
  ON_SUCCESS,
  RESOLUTIONS,
  SCOPES,
  autoSearchers,
  damageTaken,
  disarmPlan,
  firingPlan,
  isBotch,
  lockAfterFailure,
  pitDamage,
  pitDamageFormula,
  poleLeadRanks,
  probeSequence,
  rankDepth,
  repeatLocked,
  searcherReachFeet,
  trapFigures,
  triggerFires,
  victimsOf,
  TRAP_LEVELS,
  emptyTier,
  mergeTierSubmit,
} from "../scripts/formation/trap-rules.mjs";
import { FORMATION_DOC, MODULE_ID, TRAP_ITEM_TYPE } from "../scripts/formation/constants.mjs";
import * as tables from "../scripts/lib/tables.mjs";
import { regionOutlines } from "../scripts/formation/zones.mjs";
import { regionDistance } from "../scripts/lib/regions.mjs";
import { mockRegion, rect } from "./region-fixture.mjs";

// The wall and marker modules reach the module-wide socket registry, which hooks `socketlib.ready` as it loads.
globalThis.Hooks = { on() {}, once() {} };
const { canTrapWall, chainWalls, installTrapDrop, pointSegmentDistance, segmentCrossing, segmentDistance } = await import("../scripts/formation/trap-walls.mjs");
const { spread: spreadMarks } = await import("../scripts/formation/trap-markers.mjs");

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

/** A marching-order row as `marchingOrder()` hands it over. */
const row = (actorId, rank, file, roles = []) => ({ actorId, name: actorId, rank, file, roles });

/** Single file: one per rank, front to back. */
const column = (...ids) => ids.map((id, i) => row(id, i, 0));

const labels = (probes) => probes.map((p) => `${p.actorId}${p.kind === "pole" ? ":pole" : ""}@${p.reach}`);

/**
 * Invented figures, none a book's: a search reaches 3, a pole's search 7, a
 * pole probes 2.5 ahead, a rank stands 1.5 deep, the secret die has 8 faces
 * and springs on 3 or less, the dice of a fall are 1d4 per 6, the spikes are 1d3
 * of 1d5, a hasty throw goes wrong at 2 or less and a methodical one at 1,
 * and the methodical bonus is 3.
 */
const SEARCH = { searchFeet: 3, poleSearchFeet: 7 };
const DEPTH = 1.5;
const LEAD = 2.5;
const POLE_RANKS = LEAD / DEPTH;
const FIG = {
  searchFeet: 3,
  poleSearchFeet: 7,
  poleLeadFeet: LEAD,
  triggerFaces: 8,
  triggerOn: 3,
  trapbreakReachFeet: 4,
  botch: { hasty: 2, methodical: 1 },
  methodicalBonus: 3,
};
const PIT = { fall: { count: 1, faces: 4, feetPerDie: 6 }, spike: { count: "1d3", faces: 5 } };

/* -------------------------------------------- */
/*  Who walks into it                           */
/* -------------------------------------------- */

test("the party meets a trap in marching order, front rank first", () => {
  const probes = probeSequence(column("scout", "fighter", "mage"));
  assert.deepEqual(labels(probes), ["scout@0", "fighter@1", "mage@2"]);
});

test("a pole probes its lead ahead of the man carrying it", () => {
  // The bearer is second in line; his pole meets the plate while he is still
  // back, which is the entire reason for carrying one. A lead of one rank puts
  // it on the rank in front.
  const probes = probeSequence([row("scout", 0, 0), row("bearer", 1, 0, ["pole"])], { poleRanks: 1 });
  assert.deepEqual(labels(probes), ["scout@0", "bearer:pole@0", "bearer@1"]);
});

test("a man already standing in the square meets it before a pole waved over it", () => {
  // Both reach rank 0 — the scout on his feet, the pole from the rank behind.
  // The pole still gets its own throw; what it cannot do is arrive first at
  // ground somebody is already walking on.
  const probes = probeSequence([row("scout", 0, 0), row("bearer", 1, 0, ["pole"])], { poleRanks: 1 });
  assert.equal(probes[0].kind, "body");
  assert.equal(probes[1].kind, "pole");
});

test("a pole at the front of the column reaches ahead of the column itself", () => {
  const probes = probeSequence([row("bearer", 0, 0, ["pole"])], { poleRanks: 1 });
  assert.deepEqual(labels(probes), ["bearer:pole@-1", "bearer@0"]);
});

test("the pole's lead is the imported feet over a rank's depth, a part of a rank where they do not divide", () => {
  assert.equal(poleLeadRanks(LEAD, DEPTH), POLE_RANKS);
  const probes = probeSequence([row("bearer", 0, 0, ["pole"])], { poleRanks: poleLeadRanks(LEAD, DEPTH) });
  assert.equal(probes[0].kind, "pole");
  assert.equal(probes[0].reach, -POLE_RANKS);
});

test("with no lead imported, or no depth to measure it in, no pole probes", () => {
  const order = [row("bearer", 0, 0, ["pole"])];
  for (const [lead, depth] of [[null, DEPTH], [LEAD, null], [0, DEPTH], [LEAD, 0], [undefined, undefined], ["x", DEPTH]]) {
    assert.equal(poleLeadRanks(lead, depth), null, `${lead}/${depth}`);
    assert.deepEqual(labels(probeSequence(order, { poleRanks: poleLeadRanks(lead, depth) })), ["bearer@0"]);
  }
  assert.deepEqual(labels(probeSequence(order)), ["bearer@0"], "poleRanks omitted");
});

test("at combat speed there is no pole to probe with", () => {
  // RR p. 263: exploring at combat speed loses pole probing, mapping and the
  // hasty search together.
  const probes = probeSequence([row("bearer", 0, 0, ["pole"])], { pole: false, poleRanks: 1 });
  assert.deepEqual(labels(probes), ["bearer@0"]);
});

test("men standing abreast are met in a shuffled order, not always leftmost first", () => {
  // Per-adventurer throws are the book's; deciding that file 0 always throws
  // FIRST is not, and since the sequence ends at the throw that springs the
  // trap it would make one man spring every trap in the dungeon.
  const abreast = [row("left", 0, 0), row("middle", 0, 1), row("right", 0, 2)];
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(probeSequence(abreast).map((p) => p.actorId).join(","));
  assert.ok(seen.size > 1, "the rank always came out in the same order");
  // Everyone still throws exactly once, however it is shuffled.
  for (const order of seen) assert.equal(order.split(",").length, 3);
});

test("the shuffle stays inside a rank — ranks are still met front to back", () => {
  const two = [row("front", 0, 0), row("frontB", 0, 1), row("back", 1, 0), row("backB", 1, 1)];
  for (let i = 0; i < 50; i++) {
    const ranks = probeSequence(two).map((p) => p.rank);
    assert.deepEqual(ranks, [0, 0, 1, 1]);
  }
});

test("the shuffle can be pinned, so a test never has to re-fix the bias", () => {
  const abreast = [row("a", 0, 0), row("b", 0, 1), row("c", 0, 2)];
  const fixed = () => 0; // always pick index 0 in the Fisher-Yates swap
  const once = probeSequence(abreast, { random: fixed }).map((p) => p.actorId);
  const twice = probeSequence(abreast, { random: fixed }).map((p) => p.actorId);
  assert.deepEqual(once, twice);
});

/* -------------------------------------------- */
/*  Who it catches                              */
/* -------------------------------------------- */

test("a needle takes the man who touched it and nobody else", () => {
  const probes = probeSequence(column("scout", "fighter", "mage"));
  const caught = victimsOf(probes, 1, { scope: SCOPES.triggerer });
  assert.deepEqual(caught.map((p) => p.actorId), ["fighter"]);
});

test("a pole-sprung trap catches nobody: it fires into empty corridor", () => {
  const probes = probeSequence([row("bearer", 0, 0, ["pole"])], { poleRanks: POLE_RANKS });
  const poleIndex = probes.findIndex((p) => p.kind === "pole");
  assert.deepEqual(victimsOf(probes, poleIndex, { scope: SCOPES.triggerer }), []);
});

test("an area effect still reaches back past the pole for its bearer", () => {
  // The pole buys distance, not immunity. A blast centred at the pole's lead
  // ahead of the bearer still has him in it when its radius is long enough:
  // the bearer stands 2.5 off and the second rank 4.
  const probes = probeSequence([row("bearer", 0, 0, ["pole"]), row("second", 1, 0)], { poleRanks: POLE_RANKS });
  const poleIndex = probes.findIndex((p) => p.kind === "pole");
  const caught = victimsOf(probes, poleIndex, { scope: SCOPES.area, radiusFeet: 4, rankFeet: DEPTH });
  assert.deepEqual(caught.map((p) => p.actorId), ["bearer", "second"]);
  assert.deepEqual(victimsOf(probes, poleIndex, { scope: SCOPES.area, radiusFeet: 3, rankFeet: DEPTH }).map((p) => p.actorId), ["bearer"], "a radius short of the second rank spares it");
});

test("a tight area effect sprung on the pole spares even the bearer", () => {
  // A radius shorter than the pole's lead from the bearer leaves him out. This
  // is the case where the pole earns its weight.
  const probes = probeSequence([row("bearer", 0, 0, ["pole"]), row("second", 1, 0)], { poleRanks: POLE_RANKS });
  const poleIndex = probes.findIndex((p) => p.kind === "pole");
  assert.deepEqual(victimsOf(probes, poleIndex, { scope: SCOPES.area, radiusFeet: 0, rankFeet: DEPTH }), []);
  assert.deepEqual(victimsOf(probes, poleIndex, { scope: SCOPES.area, radiusFeet: 2, rankFeet: DEPTH }), []);
});

test("a radius catches the ranks within it either side of where it went off", () => {
  // Invented: ranks 1.5 deep, so a radius of 3 spans two ranks either side.
  const probes = probeSequence(column("a", "b", "c", "d", "e", "f"));
  const caught = victimsOf(probes, 3, { scope: SCOPES.area, radiusFeet: 3, rankFeet: DEPTH });
  assert.deepEqual(caught.map((p) => p.actorId), ["b", "c", "d", "e", "f"]);
});

test("a rank's depth sets how many ranks a radius spans", () => {
  const probes = probeSequence(column("a", "b", "c", "d", "e", "f"));
  assert.deepEqual(victimsOf(probes, 3, { scope: SCOPES.area, radiusFeet: 4, rankFeet: DEPTH }).map((p) => p.actorId), ["b", "c", "d", "e", "f"], "four feet spans two ranks of 1.5 either side");
  assert.deepEqual(victimsOf(probes, 3, { scope: SCOPES.area, radiusFeet: 4, rankFeet: 4 }).map((p) => p.actorId), ["c", "d", "e"], "a deeper rank spans one either side");
  assert.deepEqual(victimsOf(probes, 3, { scope: SCOPES.area, radiusFeet: 1, rankFeet: DEPTH }).map((p) => p.actorId), ["d"], "a radius short of one rank stays on the sprung rank");
});

test("a rank with no depth leaves an area effect on the rank it sprang in", () => {
  const probes = probeSequence(column("a", "b", "c", "d", "e", "f"));
  for (const rankFeet of [0, -2, NaN, null, undefined, "x"]) {
    assert.equal(rankDepth(rankFeet), null, String(rankFeet));
    assert.deepEqual(victimsOf(probes, 3, { scope: SCOPES.area, radiusFeet: 30, rankFeet }).map((p) => p.actorId), ["d"], String(rankFeet));
  }
  assert.deepEqual(victimsOf(probes, 3, { scope: SCOPES.area, radiusFeet: 30 }).map((p) => p.actorId), ["d"], "rankFeet omitted");
});

test("an area effect with no radius still takes the man who sprang it", () => {
  const probes = probeSequence(column("a", "b", "c"));
  const caught = victimsOf(probes, 1, { scope: SCOPES.area, radiusFeet: 0 });
  assert.deepEqual(caught.map((p) => p.actorId), ["b"]);
});

test("a probe index naming nobody catches nobody", () => {
  assert.deepEqual(victimsOf(probeSequence(column("a")), 9, {}), []);
});

/* -------------------------------------------- */
/*  The trigger die                             */
/* -------------------------------------------- */

test("the trigger die springs the trap at or under the band and passes it above", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map((d) => triggerFires(d, FIG.triggerOn)), [true, true, true, false, false, false, false, false]);
});

test("a Judge may widen or narrow what springs it", () => {
  assert.equal(triggerFires(4, 4), true);
  assert.equal(triggerFires(5, 4), false);
  // A trap set to spring on nothing never springs.
  assert.equal(triggerFires(1, 0), false);
});

test("a band that is not a number springs nothing", () => {
  for (const band of [null, undefined, ""]) assert.equal(triggerFires(1, band), false, String(band));
});

/* -------------------------------------------- */
/*  The disarm throw                            */
/* -------------------------------------------- */

test("working methodically is worth the imported bonus to a skilled thief", () => {
  const plan = disarmPlan({ mode: "methodical", skilled: true, figures: FIG });
  assert.equal(plan.bonus, FIG.methodicalBonus);
  assert.equal(plan.repeatable, true);
  assert.equal(plan.adventuringAllowed, true);
});

test("with no bonus imported, working methodically adds nothing", () => {
  assert.equal(disarmPlan({ mode: "methodical", skilled: true, figures: { ...FIG, methodicalBonus: null } }).bonus, 0);
});

test("a hasty attempt gets no bonus, cannot be repeated, and bars Adventuring", () => {
  const plan = disarmPlan({ mode: "hasty", skilled: true, figures: FIG });
  assert.equal(plan.bonus, 0);
  assert.equal(plan.repeatable, false);
  assert.equal(plan.adventuringAllowed, false);
});

test("a non-thief working methodically gets the attempt but not the thief's bonus", () => {
  assert.equal(disarmPlan({ mode: "methodical", skilled: false, figures: FIG }).bonus, 0);
});

test("a crude trap is easier to remove, whichever way it is worked", () => {
  assert.equal(disarmPlan({ mode: "hasty", crude: true, figures: FIG }).bonus, CRUDE.remove);
  assert.equal(disarmPlan({ mode: "methodical", crude: true, skilled: true, figures: FIG }).bonus, FIG.methodicalBonus + CRUDE.remove);
});

test("each mode goes wrong at or under its own imported band", () => {
  assert.deepEqual([1, 2, 3, 4].map((n) => isBotch(n, "hasty", FIG)), [true, true, false, false]);
  assert.deepEqual([1, 2, 3, 4].map((n) => isBotch(n, "methodical", FIG)), [true, false, false, false]);
  assert.equal(disarmPlan({ mode: "hasty", figures: FIG }).botchBand, FIG.botch.hasty);
  assert.equal(disarmPlan({ mode: "methodical", figures: FIG }).botchBand, FIG.botch.methodical);
});

test("a band that is not imported never botches", () => {
  const none = { ...FIG, botch: { hasty: null, methodical: null } };
  assert.deepEqual([1, 2, 3].map((n) => isBotch(n, "hasty", none)), [false, false, false]);
  assert.deepEqual([1, 2, 3].map((n) => isBotch(n, "methodical", none)), [false, false, false]);
  assert.equal(disarmPlan({ mode: "hasty", figures: none }).botchBand, null);
});

test("an unimported world reads every trap figure as null", () => {
  const figures = trapFigures();
  assert.deepEqual(
    [figures.searchFeet, figures.poleSearchFeet, figures.poleLeadFeet, figures.triggerFaces, figures.triggerOn, figures.trapbreakReachFeet, figures.botch.hasty, figures.botch.methodical, figures.methodicalBonus],
    Array(9).fill(null),
  );
});

/* -------------------------------------------- */
/*  Trying again                                */
/* -------------------------------------------- */

test("a thief who failed hastily may not try this trap again at the same level", () => {
  const lock = lockAfterFailure({}, "thief", 3);
  assert.equal(repeatLocked(lock, "thief", 3), true);
});

test("gaining a level reopens the attempt", () => {
  // The rule is "until higher level", so both answers matter and both are
  // asserted: the lock has to release, or it is a permanent bar.
  const lock = lockAfterFailure({}, "thief", 3);
  assert.equal(repeatLocked(lock, "thief", 4), false);
});

test("a thief who never failed here is not locked out by someone else's failure", () => {
  const lock = lockAfterFailure({}, "thief", 5);
  assert.equal(repeatLocked(lock, "otherThief", 1), false);
});

test("the lock keeps the highest level failed at", () => {
  let lock = lockAfterFailure({}, "thief", 5);
  lock = lockAfterFailure(lock, "thief", 2);
  assert.equal(repeatLocked(lock, "thief", 5), true);
});

test("recording a failure does not edit the lock it was given", () => {
  const before = {};
  lockAfterFailure(before, "thief", 3);
  assert.deepEqual(before, {});
});

/* -------------------------------------------- */
/*  What it does                                */
/* -------------------------------------------- */

test("a pit deals the imported fall's die for each stretch of its feet fallen", () => {
  assert.equal(pitDamageFormula(6, false, PIT), "1d4");
  assert.equal(pitDamageFormula(18, false, PIT), "3d4");
  assert.equal(pitDamageFormula(18, false, { fall: { count: 2, faces: 4, feetPerDie: 6 }, spike: null }), "6d4", "a fall that deals more than one die per stretch");
});

test("spikes at the bottom are the imported count of them, each its own die", () => {
  // The nested count is the rule: a rolled number of spikes, a die apiece.
  // `1d3 * 1d5` would roll ONE die and scale it, which is a different
  // distribution wearing the same numbers.
  assert.equal(pitDamageFormula(12, true, PIT), "2d4 + (1d3)d5");
});

test("a trap that is not a pit has no pit damage at all", () => {
  // Not zero damage — no such component. A shallow scrape is not a fall.
  assert.equal(pitDamageFormula(0, false, PIT), null);
  assert.equal(pitDamageFormula(5, false, PIT), null);
  assert.deepEqual(pitDamage(0, true, PIT), { formula: null, unknown: [] });
});

test("a pit with no fall imported has no formula and names the fall as unknown", () => {
  assert.deepEqual(pitDamage(12, false, { fall: null, spike: PIT.spike }), { formula: null, unknown: ["fall"] });
  assert.deepEqual(pitDamage(12, true, { fall: null, spike: PIT.spike }), { formula: null, unknown: ["fall"] });
});

test("a spiked pit with no spike dice imported deals the fall alone and names the spikes as unknown", () => {
  assert.deepEqual(pitDamage(12, true, { fall: PIT.fall, spike: null }), { formula: "2d4", unknown: ["spikes"] });
  assert.deepEqual(pitDamage(12, false, { fall: PIT.fall, spike: null }), { formula: "2d4", unknown: [] }, "an unspiked pit owes no spike dice");
});

test("an unimported world answers no pit figures", () => {
  assert.deepEqual(pitDamage(12, true), { formula: null, unknown: ["fall"] });
});

test("a firing plan carries what its pit lacks, and only where the pit derives the damage", () => {
  const noSpikes = { fall: PIT.fall, spike: null };
  assert.deepEqual(firingPlan({ pitDepthFeet: 12, spiked: true, pit: noSpikes }).pitUnknown, ["spikes"]);
  assert.equal(firingPlan({ pitDepthFeet: 12, spiked: true, pit: PIT }).formula, "2d4 + (1d3)d5");
  assert.deepEqual(firingPlan({ damageFormula: "5d6", pitDepthFeet: 12, spiked: true, pit: noSpikes }).pitUnknown, [], "a typed formula owes nothing");
});

/* -------------------------------------------- */
/*  Who searches, and how far                   */
/* -------------------------------------------- */

test("a searcher's reach is its own, less the ground between it and the front of the party", () => {
  const front = row("a", 0, 0);
  const second = row("b", 1, 0);
  const pole = row("c", 1, 0, ["pole"]);
  assert.equal(searcherReachFeet(front, { ...SEARCH, rankFeet: DEPTH }), 3);
  assert.equal(searcherReachFeet(second, { ...SEARCH, rankFeet: DEPTH }), 1.5);
  assert.equal(searcherReachFeet(pole, { ...SEARCH, rankFeet: DEPTH }), 5.5);
  assert.equal(searcherReachFeet(row("d", 0, 0, ["pole"]), { ...SEARCH, rankFeet: DEPTH }), 7);
});

test("a pole with no reach of its own searches as the bare reach does", () => {
  assert.equal(searcherReachFeet(row("c", 1, 0, ["pole"]), { searchFeet: 3, poleSearchFeet: null, rankFeet: DEPTH }), 1.5);
});

test("with no search reach imported nobody's reach is stated", () => {
  assert.equal(searcherReachFeet(row("a", 0, 0), { searchFeet: null, poleSearchFeet: 7, rankFeet: DEPTH }), null);
});

test("a searcher behind the front rank has no stated reach where no depth is known", () => {
  assert.equal(searcherReachFeet(row("b", 1, 0), { ...SEARCH, rankFeet: null }), null);
  assert.equal(searcherReachFeet(row("a", 0, 0), { ...SEARCH, rankFeet: null }), 3, "the front rank needs no depth");
});

test("the searchers are those whose reach passes the front of the party", () => {
  const order = [row("a", 0, 0), row("b", 1, 0), row("c", 2, 0), row("d", 2, 1, ["pole"]), row("e", 4, 0, ["pole"])];
  const who = (figures) => autoSearchers(order, figures).map((r) => r.actorId);
  // Reach 3 or 7 against ranks 1.5 deep: b has 1.5 left, c none, d's pole 4, e's 1.
  assert.deepEqual(who({ ...SEARCH, rankFeet: DEPTH }), ["a", "b", "d", "e"]);
  assert.deepEqual(who({ ...SEARCH, rankFeet: 3 }), ["a", "d"], "deeper ranks leave fewer in reach");
});

test("with no search reach imported only the front rank searches", () => {
  const order = [row("a", 0, 0), row("b", 1, 0), row("c", 1, 0, ["pole"])];
  assert.deepEqual(autoSearchers(order, { searchFeet: null, poleSearchFeet: 7, rankFeet: DEPTH }).map((r) => r.actorId), ["a"]);
});

test("with no rank depth only the front rank searches", () => {
  const order = [row("a", 0, 0), row("b", 1, 0), row("c", 1, 0, ["pole"])];
  assert.deepEqual(autoSearchers(order, { ...SEARCH, rankFeet: null }).map((r) => r.actorId), ["a"]);
});

test("a crude trap attacks at -2 and lets its victim save at +2", () => {
  const plan = firingPlan({ resolution: RESOLUTIONS.attack, attackThrow: 10, crude: true });
  assert.equal(plan.attackModifier, CRUDE.attack);
  assert.equal(plan.saveBonus, CRUDE.save);
  assert.equal(plan.attackThrow, 10);
});

test("a typed formula is the Judge's own trap and beats the pit derivation", () => {
  const plan = firingPlan({ damageFormula: "5d6", pitDepthFeet: 30 });
  assert.equal(plan.formula, "5d6");
});

test("a save key is only carried by a trap that resolves as a save", () => {
  assert.equal(firingPlan({ resolution: RESOLUTIONS.save, saveKey: "blast" }).saveKey, "blast");
  assert.equal(firingPlan({ resolution: RESOLUTIONS.attack, saveKey: "blast" }).saveKey, null);
});

/* -------------------------------------------- */
/*  Walls: chaining a loop, crossing a line     */
/* -------------------------------------------- */

const wall = (x1, y1, x2, y2) => ({ c: [x1, y1, x2, y2] });

test("four walls drawn in order chain into the square they draw", () => {
  const { points, closed } = chainWalls([
    wall(0, 0, 100, 0),
    wall(100, 0, 100, 100),
    wall(100, 100, 0, 100),
    wall(0, 100, 0, 0),
  ]);
  assert.equal(closed, true);
  assert.deepEqual(points, [0, 0, 100, 0, 100, 100, 0, 100]);
});

test("walls drawn in any order still chain, because nobody draws a loop in sequence", () => {
  const { points, closed } = chainWalls([
    wall(100, 100, 0, 100),
    wall(0, 0, 100, 0),
    wall(0, 100, 0, 0),
    wall(100, 0, 100, 100),
  ]);
  assert.equal(closed, true);
  assert.equal(points.length, 8);
});

test("a wall drawn back-to-front still joins the chain", () => {
  // The second segment's endpoints are reversed relative to the first's tail.
  const { closed } = chainWalls([
    wall(0, 0, 100, 0),
    wall(100, 100, 100, 0),
    wall(100, 100, 0, 100),
    wall(0, 100, 0, 0),
  ]);
  assert.equal(closed, true);
});

test("a loop closed by eye rather than exactly is still closed", () => {
  const { closed } = chainWalls([
    wall(0, 0, 100, 0),
    wall(100, 0, 100, 100),
    wall(100, 100, 0, 100),
    wall(0, 100, 2, 3),
  ]);
  assert.equal(closed, true);
});

test("an open run of walls is reported open, not quietly closed", () => {
  const { closed } = chainWalls([wall(0, 0, 100, 0), wall(100, 0, 100, 100)]);
  assert.equal(closed, false);
});

test("a stray wall in the selection does not defeat the loop it is beside", () => {
  // The trap tool leaves the wall it drew selected, so reaching straight for
  // "enclose these" hands this the room plus one leftover tripwire. Answering
  // "not a shape" is true of the whole set and useless.
  const { points, closed } = chainWalls([
    wall(500, 500, 600, 500), // the stray, connected to nothing
    wall(0, 0, 100, 0),
    wall(100, 0, 100, 100),
    wall(100, 100, 0, 100),
    wall(0, 100, 0, 0),
  ]);
  assert.equal(closed, true);
  assert.deepEqual(points, [0, 0, 100, 0, 100, 100, 0, 100]);
});

test("with two closed loops selected, the bigger one wins", () => {
  const { points, closed } = chainWalls([
    // a triangle
    wall(0, 0, 50, 0), wall(50, 0, 25, 40), wall(25, 40, 0, 0),
    // and a square, which has more corners
    wall(200, 200, 400, 200), wall(400, 200, 400, 400),
    wall(400, 400, 200, 400), wall(200, 400, 200, 200),
  ]);
  assert.equal(closed, true);
  assert.equal(points.length, 8);
});

test("a path that crosses a line reports where it crossed", () => {
  const at = segmentCrossing({ x: 50, y: -50 }, { x: 50, y: 50 }, [0, 0, 100, 0]);
  assert.equal(at.x, 50);
  assert.equal(at.y, 0);
});

test("a path that stops short of the line does not cross it", () => {
  assert.equal(segmentCrossing({ x: 50, y: -50 }, { x: 50, y: -10 }, [0, 0, 100, 0]), null);
});

test("a path running alongside a line never crosses it", () => {
  assert.equal(segmentCrossing({ x: 0, y: 10 }, { x: 100, y: 10 }, [0, 0, 100, 0]), null);
});

test("a party standing ON the line has not crossed it by stepping away", () => {
  // The halt leaves the party at the trap. Counting the departure as a crossing
  // springs the trap again on the way out, in either direction, forever.
  assert.equal(segmentCrossing({ x: 50, y: 0 }, { x: 50, y: -100 }, [0, 0, 100, 0]), null);
  assert.equal(segmentCrossing({ x: 50, y: 0 }, { x: 50, y: 100 }, [0, 0, 100, 0]), null);
});

test("arriving exactly on the line still counts as crossing it", () => {
  // Walking INTO the tripwire and stopping dead on it is a crossing; only
  // starting there is not.
  const at = segmentCrossing({ x: 50, y: -50 }, { x: 50, y: 0 }, [0, 0, 100, 0]);
  assert.equal(at.t, 1);
});

test("a path missing the line's extent does not cross it", () => {
  // Passes through y=0, but beyond the far end of the segment.
  assert.equal(segmentCrossing({ x: 300, y: -50 }, { x: 300, y: 50 }, [0, 0, 100, 0]), null);
});

test("the crossing carries how far along the move it happened", () => {
  // `t` is what orders several crossings so the party stops at the first.
  const near = segmentCrossing({ x: 0, y: 0 }, { x: 0, y: 100 }, [-10, 25, 10, 25]);
  const far = segmentCrossing({ x: 0, y: 0 }, { x: 0, y: 100 }, [-10, 75, 10, 75]);
  assert.ok(near.t < far.t);
});

/* -------------------------------------------- */
/*  What the throw was worth                    */
/* -------------------------------------------- */

test("a trap that offered no throw at all deals its damage whole", () => {
  assert.deepEqual(damageTaken(9, null), { taken: 9, mitigated: false });
});

test("failing the save takes all of it", () => {
  assert.deepEqual(damageTaken(9, false, ON_SUCCESS.half), { taken: 9, mitigated: false });
});

test("making the save halves it, rounding down", () => {
  assert.deepEqual(damageTaken(9, true, ON_SUCCESS.half), { taken: 4, mitigated: true });
});

test("a trap you can dodge outright deals nothing when dodged", () => {
  assert.deepEqual(damageTaken(9, true, ON_SUCCESS.none), { taken: 0, mitigated: true });
});

test("a trap whose save buys only a rider still deals full damage", () => {
  // The portcullis: making the save chooses which side you land on, and the
  // damage is unaffected. Reporting it as mitigated would be a lie.
  assert.deepEqual(damageTaken(9, true, ON_SUCCESS.full), { taken: 9, mitigated: false });
});

test("an attack that missed deals nothing, whatever the trap says about saves", () => {
  // `firingPlan` forces onSuccess to `none` for an attack trap, because a bolt
  // that did not hit cannot deal half.
  const plan = firingPlan({ resolution: RESOLUTIONS.attack, attackThrow: 10, onSuccess: ON_SUCCESS.half });
  assert.equal(plan.onSuccess, ON_SUCCESS.none);
  assert.deepEqual(damageTaken(7, true, plan.onSuccess), { taken: 0, mitigated: true });
});

/* -------------------------------------------- */
/*  Markers do not stack                        */
/* -------------------------------------------- */

test("two traps on the same spot are laid out in a row, centred on it", () => {
  // A trapped door shares its midpoint with core's own door control, and two
  // segments can share one outright. Stacked glyphs read as a single trap.
  const out = spreadMarks([
    { x: 100, y: 100, state: "armed" },
    { x: 100, y: 100, state: "disarmed" },
  ]);
  assert.equal(out.length, 2);
  assert.notEqual(out[0].x, out[1].x);
  // Still centred on the thing being marked.
  assert.equal((out[0].x + out[1].x) / 2, 100);
  assert.deepEqual(out.map((m) => m.y), [100, 100]);
});

test("a lone marker is not nudged off its own spot", () => {
  const [only] = spreadMarks([{ x: 250, y: 75, state: "armed" }]);
  assert.deepEqual([only.x, only.y], [250, 75]);
});

test("traps far apart are left where they are", () => {
  const out = spreadMarks([
    { x: 0, y: 0, state: "armed" },
    { x: 500, y: 500, state: "armed" },
  ]);
  assert.deepEqual(out.map((m) => [m.x, m.y]), [[0, 0], [500, 500]]);
});

test("near-misses group too, because they still overlap on screen", () => {
  // Two wall midpoints a pixel apart collide visually; exact-tie grouping
  // would leave them stacked.
  const out = spreadMarks([
    { x: 100, y: 100, state: "armed" },
    { x: 101, y: 100, state: "armed" },
  ]);
  assert.notEqual(out[0].x, out[1].x);
});

/* -------------------------------------------------------------- */
/*  One level edited must not replace the other five                */
/* -------------------------------------------------------------- */

/** Six rows as an imported trap holds them. */
const sixRows = () =>
  Array.from({ length: TRAP_LEVELS }, (_, i) => ({ ...emptyTier(), text: `level ${i + 1}`, damageFormula: `${i + 1}d6` }));

/**
 * What Foundry hands the sheet back when the form rendered only row `i`: an
 * ARRAY, empty defaults below the edited row and nothing at all above it.
 *
 * The edited row carries the text too, because the form renders that field —
 * this is the shape that would overwrite the whole trap.
 */
const submitFor = (i, edit) => {
  const out = [];
  for (let n = 0; n < i; n++) out.push(emptyTier());
  out.push({ ...emptyTier(), text: `level ${i + 1}`, ...edit });
  return out;
};

test("editing the fourth level leaves the other five standing", () => {
  const merged = mergeTierSubmit(sixRows(), submitFor(3, { damageFormula: "9d9" }), 4);
  assert.equal(merged.length, TRAP_LEVELS);
  assert.equal(merged[3].damageFormula, "9d9");
  assert.deepEqual(
    merged.map((r) => r.damageFormula),
    ["1d6", "2d6", "3d6", "9d9", "5d6", "6d6"],
  );
});

test("the rows the form never showed keep their text", () => {
  const merged = mergeTierSubmit(sixRows(), submitFor(3, { damageFormula: "9d9" }), 4);
  assert.deepEqual(merged.map((r) => r.text), ["level 1", "level 2", "level 3", "level 4", "level 5", "level 6"]);
});

test("editing the first level does not truncate the array", () => {
  const merged = mergeTierSubmit(sixRows(), submitFor(0, { damageFormula: "1d1" }), 1);
  assert.equal(merged.length, TRAP_LEVELS);
  assert.equal(merged[5].damageFormula, "6d6");
});

test("a submit shaped as a numeric-keyed object is read the same way", () => {
  const merged = mergeTierSubmit(sixRows(), { 2: { damageFormula: "8d8" } }, 3);
  assert.equal(merged[2].damageFormula, "8d8");
  assert.equal(merged[4].damageFormula, "5d6");
});

test("a level outside 1-6 is clamped rather than writing off the end", () => {
  assert.equal(mergeTierSubmit(sixRows(), submitFor(0, { damageFormula: "x" }), 99).length, TRAP_LEVELS);
  assert.equal(mergeTierSubmit(sixRows(), submitFor(0, { damageFormula: "x" }), 0).length, TRAP_LEVELS);
});

test("a trap with no stored rows still comes back with six", () => {
  const merged = mergeTierSubmit(undefined, submitFor(1, { damageFormula: "2d2" }), 2);
  assert.equal(merged.length, TRAP_LEVELS);
  assert.equal(merged[1].damageFormula, "2d2");
  assert.equal(merged[0].damageFormula, "");
});

/* -------------------------------------------- */
/*  Reaching a trap                             */
/* -------------------------------------------- */

/** Run `fn` with the invented figures registered the way an import registers them. */
const withFormation = (figures, fn) => {
  tables.registerTable({ id: FORMATION_DOC, tables: figures }, { priority: tables.PRIORITY.WORLD });
  try {
    return fn();
  } finally {
    tables.unregisterTable(FORMATION_DOC);
  }
};

test("the trap figures are read from the registered formation document", () => {
  const imported = {
    searchReachFeet: 3,
    poleSearchReachFeet: 7,
    poleLeadFeet: LEAD,
    trapTriggerDie: "1d8",
    trapTriggerOn: 3,
    trapbreakReachFeet: 4,
    trapbreakHastyBotch: 2,
    trapbreakMethodicalBotch: 1,
    trapbreakMethodicalBonus: 3,
    fall: { die: "1d4", feetPerDie: 6 },
    pitSpikeCount: "1d3",
    pitSpikeDie: "1d5",
  };
  withFormation(imported, () => {
    assert.deepEqual(trapFigures(), FIG);
    assert.deepEqual(pitDamage(12, true), { formula: "2d4 + (1d3)d5", unknown: [] });
  });
});

test("a figure that is not a usable number or die reads as not imported", () => {
  withFormation(
    { searchReachFeet: 0, poleSearchReachFeet: "x", poleLeadFeet: -2, trapTriggerDie: "2d6", trapTriggerOn: "", trapbreakReachFeet: null, trapbreakHastyBotch: 0, trapbreakMethodicalBonus: 1.5, pitSpikeCount: "1d3", pitSpikeDie: "2d5", fall: { die: "1d4", feetPerDie: 6 } },
    () => {
      const figures = trapFigures();
      assert.equal(figures.searchFeet, null);
      assert.equal(figures.poleSearchFeet, null);
      assert.equal(figures.poleLeadFeet, null);
      assert.equal(figures.triggerFaces, null, "a die that is not a single die has no faces to roll");
      assert.equal(figures.triggerOn, null);
      assert.equal(figures.trapbreakReachFeet, null);
      assert.equal(figures.botch.hasty, null);
      assert.equal(figures.methodicalBonus, null);
      assert.deepEqual(pitDamage(12, true), { formula: "2d4", unknown: ["spikes"] }, "a spike die that is not a single die is not imported");
    },
  );
});

test("a Judge's band of nothing is read, not mistaken for no figure", () => {
  withFormation({ trapTriggerOn: 0 }, () => assert.equal(trapFigures().triggerOn, 0));
});

test("a point measures to a segment's nearer END, not to its infinite line", () => {
  const seg = [0, 0, 100, 0];
  assert.equal(pointSegmentDistance(50, 30, seg), 30); // beside it
  assert.equal(pointSegmentDistance(-40, 0, seg), 40); // off past one end
  assert.equal(pointSegmentDistance(140, 0, seg), 40); // and the other
});

test("crossing segments are no distance apart", () => {
  assert.equal(segmentDistance([50, -50, 50, 50], [0, 0, 100, 0]), 0);
});

test("a walked path measures to a trap it passed but never reached", () => {
  // The party walks along y=0; a tripwire sits one square north of the line and
  // is never crossed. The automatic search is owed against it all the same, so
  // the distance must be the perpendicular one — not the gap to where the party
  // happened to stop.
  const path = [0, 0, 500, 0];
  const tripwire = [200, -100, 300, -100];
  assert.equal(segmentDistance(path, tripwire), 100);
});

test("a region's outline is its ring", () => {
  const square = mockRegion({ rings: [[0, 0, 100, 0, 100, 100, 0, 100]] });
  assert.deepEqual(regionOutlines(square), [[0, 0, 100, 0, 100, 100, 0, 100]]);
});

/* -------------------------------------------- */
/*  The sweep's distance to a zone              */
/* -------------------------------------------- */

/** A party standing still at `(x, y)`: the zero-length segment the sweep measures. */
const standing = (x, y) => [x, y, x, y];

test("a party standing on a zone is no distance from it; one beside it is the gap to the nearest edge", () => {
  const zone = mockRegion({ rings: [rect(100, 100, 200, 200)] });
  assert.equal(regionDistance(zone, standing(200, 200)), 0);
  assert.equal(regionDistance(zone, standing(500, 200)), 200);
  // Off a corner the nearest ground is the corner itself.
  assert.equal(regionDistance(zone, standing(400, 400)), Math.hypot(100, 100));
});

test("a party standing in a zone's hole measures to the hole's rim, not zero", () => {
  // The ring alone would hold the whole 400-square, the party in its middle.
  const zone = mockRegion({ rings: [rect(0, 0, 400, 400)], holes: [rect(100, 100, 200, 200)] });
  assert.equal(regionDistance(zone, standing(200, 200)), 100);
  assert.equal(regionDistance(zone, standing(120, 200)), 20);
  assert.equal(regionDistance(zone, standing(50, 200)), 0, "the solid band around the hole");
});

test("an island standing inside a hole is ground again", () => {
  const zone = mockRegion({
    rings: [rect(0, 0, 400, 400), rect(180, 180, 40, 40)],
    holes: [rect(100, 100, 200, 200)],
  });
  assert.equal(regionDistance(zone, standing(200, 200)), 0, "on the island");
  assert.equal(regionDistance(zone, standing(120, 200)), 20, "the hole's rim is nearer than the island");
  assert.equal(regionDistance(zone, standing(170, 200)), 10, "the island is nearer than the hole's rim");
});

test("a zone with no ring and a missing region are out of reach", () => {
  assert.equal(regionDistance(mockRegion(), standing(0, 0)), Infinity);
  assert.equal(regionDistance({}, standing(0, 0)), Infinity);
  assert.equal(regionDistance(undefined, [0, 0, 50, 0]), Infinity);
});

test("a walked path measures to a zone it passed but never reached", () => {
  // Both ends are well clear of the zone, which the line passes 30 px above.
  const zone = mockRegion({ rings: [rect(200, 30, 100, 100)] });
  assert.equal(regionDistance(zone, [0, 0, 500, 0]), 30);
});

test("a walked path through a zone, both ends outside it, is no distance from it", () => {
  const zone = mockRegion({ rings: [rect(200, -50, 100, 100)] });
  assert.equal(regionDistance(zone, [0, 0, 500, 0]), 0);
});

test("a walked path ending on a zone is no distance from it; one inside a hole stays clear of the rim", () => {
  const zone = mockRegion({ rings: [rect(0, 0, 400, 400)], holes: [rect(100, 100, 200, 200)] });
  assert.equal(regionDistance(zone, [-100, 200, 50, 200]), 0, "ends on the solid band");
  // Walked within the hole, off the middle: the hole's rim is the nearest ground.
  assert.equal(regionDistance(zone, [150, 150, 250, 150]), 50);
});

test("a grid shape's merged outline is measured as the one ring it is", () => {
  // A grid shape's merged outline is an L: two squares, as core's tree would hold it.
  const zone = mockRegion({
    shapes: [{ type: "grid", hole: false, offsets: [{ i: 0, j: 0 }, { i: 1, j: 0 }, { i: 0, j: 1 }] }],
    rings: [[0, 0, 200, 0, 200, 100, 100, 100, 100, 200, 0, 200]],
  });
  assert.equal(regionDistance(zone, standing(50, 150)), 0);
  assert.equal(regionDistance(zone, standing(150, 150)), 50, "the notch");
});

test("the fixture's tree answers core's testPoint tolerance as core defines it", () => {
  const { polygonTree: tree } = mockRegion({ rings: [rect(0, 0, 100, 100)], holes: [rect(40, 40, 20, 20)] });
  assert.equal(tree.testPoint({ x: 10, y: 10 }), true);
  assert.equal(tree.testPoint({ x: 50, y: 50 }), false, "in the hole");
  assert.equal(tree.testPoint({ x: 50, y: 50 }, 10), true, "a circle of 10 reaches the hole's rim");
  assert.equal(tree.testPoint({ x: 150, y: 50 }, 40), false);
  assert.equal(tree.testPoint({ x: 150, y: 50 }, 50), true);
  assert.equal(tree.testPoint({ x: 10, y: 10 }, -10), true, "a circle of 10 fits");
  assert.equal(tree.testPoint({ x: 10, y: 10 }, -11), false, "a circle of 11 crosses the rim");
});

test("a region's outline is its solid rings; a hole contributes none", () => {
  const region = mockRegion({ rings: [rect(10, 20, 40, 30)], holes: [[15, 25, 20, 25, 20, 30]] });
  assert.deepEqual(regionOutlines(region), [[10, 20, 50, 20, 50, 50, 10, 50]]);
});

test("a grid shape's outline is core's merged polygon tree, its solid nodes only", () => {
  // The shape's cells are already one outline by the time the Region reports it.
  const region = mockRegion({
    shapes: [{ type: "grid", hole: false, offsets: [{ i: 0, j: 0 }] }],
    rings: [rect(0, 0, 300, 200)],
    holes: [rect(100, 50, 100, 100)],
  });
  assert.deepEqual(regionOutlines(region), [[0, 0, 300, 0, 300, 200, 0, 200]]);
  // A Region with no geometry outlines nothing rather than throwing.
  assert.deepEqual(regionOutlines(mockRegion()), []);
  assert.deepEqual(regionOutlines({}), []);
});

/* -------------------------------------------- */
/*  The drop row on a wall's own sheet          */
/* -------------------------------------------- */

/**
 * The smallest stand-ins the drop row's render hook touches: a GM, a localizer
 * that answers every key as itself, and a sheet root whose field list records
 * what is appended to it.
 *
 * @returns {{appended: object[], created: object[], render: (wall: object) => void}}
 */
const wallSheetHarness = () => {
  const appended = [];
  const created = [];
  globalThis.game = { user: { isGM: true }, i18n: { localize: (k) => k, format: (k) => k } };
  globalThis.document = {
    createElement: () => {
      const el = {
        className: "",
        innerHTML: "",
        listeners: [],
        addEventListener(event, fn) {
          this.listeners.push([event, fn]);
        },
      };
      created.push(el);
      return el;
    },
  };
  const rendered = [];
  globalThis.Hooks = { on: (name, fn) => (name === "renderApplicationV2" ? rendered.push(fn) : null) };
  installTrapDrop();
  const root = {
    nodeType: 1,
    querySelector: (sel) =>
      (sel === ".window-content .standard-form" ? { append: (r) => appended.push(r) } : null),
  };
  return { appended, created, render: (wall) => rendered.forEach((fn) => fn({ document: wall, render() {} }, root)) };
};

test("the wall palette's id-less preview gets no trap row, so no assignment can be attempted", () => {
  const h = wallSheetHarness();
  // The palette renders a WallConfig over an UNSAVED preview — the shape of the
  // next wall to be drawn — whose id is null. A trap assigned to that has no
  // document to land on, so the row that accepts the drop is never built and
  // the write it would start is unreachable.
  h.render({ documentName: "Wall", id: null, flags: {} });
  assert.equal(h.created.length, 0, "no row is built for the preview");
  assert.equal(h.appended.length, 0, "and nothing is appended to the palette's form");

  // A wall that is ON the scene still gets the row: the guard is a filter, not
  // a switch that turned the feature off.
  h.render({ documentName: "Wall", id: "Wall.1", flags: {}, canUserModify: () => true });
  assert.equal(h.appended.length, 1, "a placed wall gets the drop row");
  assert.ok(h.created[0].className.includes("acks-extras-trap-drop"), "and it is the trap row");
  assert.ok(h.created[0].listeners.some(([event]) => event === "drop"), "listening for the drop that assigns");
});

test("the wall sheet's trap row follows Foundry's own answer for the user, not the Judge's role", () => {
  const h = wallSheetHarness();
  const asked = [];
  const wallFor = (allow) => ({ documentName: "Wall", id: "Wall.1", flags: {}, canUserModify: (user, action, data) => (asked.push([user, action, data]), allow) });
  // A Player who may modify the wall gets the row.
  game.user = { id: "u1", isGM: false };
  h.render(wallFor(true));
  assert.equal(h.appended.length, 1, "a Player Foundry lets write the wall gets the row");
  assert.deepEqual(asked.at(-1), [game.user, "update", { flags: { [MODULE_ID]: { trap: {} } } }], "asked as an update carrying the trap layer's own data");
  // A Player who may not gets none.
  h.render(wallFor(false));
  assert.equal(h.appended.length, 1, "a Player Foundry refuses gets no row");
  // A Judge passes wherever Foundry says so.
  game.user = { id: "gm", isGM: true };
  h.render(wallFor(true));
  assert.equal(h.appended.length, 2, "a Judge gets the row");
});

test("a sheet that is not a wall's gets no trap row either", () => {
  const h = wallSheetHarness();
  h.render({ documentName: "Item", id: "Item.1" });
  assert.equal(h.created.length, 0);
  assert.equal(h.appended.length, 0);
});

/* -------------------------------------------- */
/*  Whose wall a trap drop may write            */
/* -------------------------------------------- */

{
  const asks = [];
  const wallOf = (allow, extra = {}) => ({
    c: [0, 0, 200, 0],
    flags: {},
    canUserModify(user, action, data) {
      asks.push([user, action, data]);
      return allow;
    },
    getFlag: () => undefined,
    written: [],
    async setFlag(scope, key, value) {
      this.written.push([scope, key, value]);
    },
    ...extra,
  });
  const player = { id: "u1", isGM: false };
  const judge = { id: "gm", isGM: true };
  const warned = [];
  globalThis.ui = { notifications: { warn: (m) => warned.push(m), info() {} } };
  globalThis.foundry = { data: { operators: { ForcedReplacement: { create: (v) => v } } } };
  globalThis.fromUuid = async () => ({ type: TRAP_ITEM_TYPE, uuid: "Item.t1", name: "A trap" });
  const hooks = {};
  globalThis.Hooks = { on: (name, fn) => (hooks[name] = fn) };
  installTrapDrop();

  const shape = { flags: { [MODULE_ID]: { trap: {} } } };
  assert.equal(canTrapWall(wallOf(true), player), true, "a wall Foundry lets the user write passes");
  assert.deepEqual(asks.at(-1), [player, "update", shape], "and Foundry is asked as an update carrying the trap layer's own data, since an update with no data answers true for a Player");
  assert.equal(canTrapWall(wallOf(false), player), false, "a wall Foundry refuses fails");
  assert.equal(canTrapWall({}, player), false, "a wall that cannot answer fails");
  assert.equal(canTrapWall(null, player), false, "no wall fails");
  passed += 5;

  const drop = async (user, wall) => {
    globalThis.game = { user, i18n: { localize: (k) => k, format: (k) => k } };
    warned.length = 0;
    hooks.dropCanvasData({ scene: { grid: { size: 100 }, walls: wall ? [wall] : [] } }, { type: "Item", uuid: "Item.t1", x: 100, y: 10 });
    await new Promise((resolve) => setTimeout(resolve, 5));
  };
  const near = wallOf(true);
  await drop(player, near);
  assert.deepEqual([near.written.length, warned], [1, []], "a wall the Player may write takes the trap");
  assert.equal(near.written[0][2].trapUuid, "Item.t1", "as the dropped trap");
  const barred = wallOf(false);
  await drop(player, barred);
  assert.deepEqual([barred.written.length, warned], [0, ["ACKS-FORMATION.traps.dropNoWall"]], "a wall the Player may not write is not written, and the drop goes to the place path, which says so with none under it");
  await drop(judge, wallOf(true, { written: near.written }));
  assert.equal(near.written.length, 2, "a Judge's drop on a wall still assigns it");
  await drop(player, null);
  assert.deepEqual(warned, ["ACKS-FORMATION.traps.dropNoWall"], "with no wall near the place path answers as before");
  passed += 6;
}

console.log(
  `test-trap-rules: OK (${passed} checks — probe order, pole reach, victims, trigger band, disarm plan, botch bands, repeat lock, damage, wall chaining, crossings, marker spread, tier submit merge, reaches, path distance, region outlines, wall-sheet drop row, whose wall a trap drop may write)`,
);
