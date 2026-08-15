/**
 * Traps: who meets one first, who it catches, what the disarm throw is, and
 * whether a thief may try again. Pure functions; no Foundry, no world.
 */
import assert from "node:assert/strict";
import {
  CRUDE,
  RESOLUTIONS,
  SCOPES,
  disarmPlan,
  firingPlan,
  isBotch,
  lockAfterFailure,
  pitDamageFormula,
  probeSequence,
  repeatLocked,
  triggerFires,
  victimsOf,
} from "../scripts/formation/trap-rules.mjs";
import { chainWalls, segmentCrossing } from "../scripts/formation/trap-walls.mjs";
import { spread as spreadMarks } from "../scripts/formation/trap-markers.mjs";

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

/* -------------------------------------------- */
/*  Who walks into it                           */
/* -------------------------------------------- */

test("the party meets a trap in marching order, front rank first", () => {
  const probes = probeSequence(column("scout", "fighter", "mage"));
  assert.deepEqual(labels(probes), ["scout@0", "fighter@1", "mage@2"]);
});

test("a pole probes one rank ahead of the man carrying it", () => {
  // The bearer is second in line; his pole meets the plate while he is still
  // a square back, which is the entire reason for carrying one.
  const probes = probeSequence([row("scout", 0, 0), row("bearer", 1, 0, ["pole"])]);
  assert.deepEqual(labels(probes), ["scout@0", "bearer:pole@0", "bearer@1"]);
});

test("a man already standing in the square meets it before a pole waved over it", () => {
  // Both reach rank 0 — the scout on his feet, the pole from the rank behind.
  // The pole still gets its own throw; what it cannot do is arrive first at
  // ground somebody is already walking on.
  const probes = probeSequence([row("scout", 0, 0), row("bearer", 1, 0, ["pole"])]);
  assert.equal(probes[0].kind, "body");
  assert.equal(probes[1].kind, "pole");
});

test("a pole at the front of the column reaches ahead of the column itself", () => {
  const probes = probeSequence([row("bearer", 0, 0, ["pole"])]);
  assert.deepEqual(labels(probes), ["bearer:pole@-1", "bearer@0"]);
});

test("at combat speed there is no pole to probe with", () => {
  // RR p. 263: exploring at combat speed loses the 10' pole, mapping and the
  // hasty search together.
  const probes = probeSequence([row("bearer", 0, 0, ["pole"])], { pole: false });
  assert.deepEqual(labels(probes), ["bearer@0"]);
});

test("men standing abreast meet it in file order", () => {
  const probes = probeSequence([row("right", 0, 1), row("left", 0, 0)]);
  assert.deepEqual(labels(probes), ["left@0", "right@0"]);
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
  const probes = probeSequence([row("bearer", 0, 0, ["pole"])]);
  const poleIndex = probes.findIndex((p) => p.kind === "pole");
  assert.deepEqual(victimsOf(probes, poleIndex, { scope: SCOPES.triggerer }), []);
});

test("an area effect still reaches back past the pole for its bearer", () => {
  // The pole buys distance, not immunity. A 10' blast centred a square ahead
  // of the bearer still has him in it.
  const probes = probeSequence([row("bearer", 0, 0, ["pole"]), row("second", 1, 0)]);
  const poleIndex = probes.findIndex((p) => p.kind === "pole");
  const caught = victimsOf(probes, poleIndex, { scope: SCOPES.area, radiusFeet: 10 });
  assert.deepEqual(caught.map((p) => p.actorId), ["bearer", "second"]);
});

test("a tight area effect sprung on the pole spares even the bearer", () => {
  // 5' of reach from a square ahead of him is the width of the corridor and
  // no more. This is the case where the pole earns its weight.
  const probes = probeSequence([row("bearer", 0, 0, ["pole"]), row("second", 1, 0)]);
  const poleIndex = probes.findIndex((p) => p.kind === "pole");
  const caught = victimsOf(probes, poleIndex, { scope: SCOPES.area, radiusFeet: 0 });
  assert.deepEqual(caught, []);
});

test("a 10' radius catches two ranks either side of where it went off", () => {
  const probes = probeSequence(column("a", "b", "c", "d", "e", "f"));
  const caught = victimsOf(probes, 3, { scope: SCOPES.area, radiusFeet: 10 });
  assert.deepEqual(caught.map((p) => p.actorId), ["b", "c", "d", "e", "f"]);
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

test("the trigger die springs the trap on 1-2 and passes it on 3-6", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((d) => triggerFires(d)), [true, true, false, false, false, false]);
});

test("a Judge may widen or narrow what springs it", () => {
  // "You can adjust the range of success if the trap is particularly hard or
  // easy to set off."
  assert.equal(triggerFires(4, 4), true);
  assert.equal(triggerFires(5, 4), false);
  // A trap set to spring on nothing never springs.
  assert.equal(triggerFires(1, 0), false);
});

/* -------------------------------------------- */
/*  The disarm throw                            */
/* -------------------------------------------- */

test("working methodically is worth four to a skilled thief", () => {
  const plan = disarmPlan({ mode: "methodical", skilled: true });
  assert.equal(plan.bonus, 4);
  assert.equal(plan.repeatable, true);
  assert.equal(plan.adventuringAllowed, true);
});

test("a hasty attempt gets no bonus, cannot be repeated, and bars Adventuring", () => {
  const plan = disarmPlan({ mode: "hasty", skilled: true });
  assert.equal(plan.bonus, 0);
  assert.equal(plan.repeatable, false);
  assert.equal(plan.adventuringAllowed, false);
});

test("a non-thief working methodically gets the attempt but not the thief's four", () => {
  assert.equal(disarmPlan({ mode: "methodical", skilled: false }).bonus, 0);
});

test("a crude trap is four easier to remove, whichever way it is worked", () => {
  assert.equal(disarmPlan({ mode: "hasty", crude: true }).bonus, CRUDE.remove);
  assert.equal(disarmPlan({ mode: "methodical", crude: true, skilled: true }).bonus, 4 + CRUDE.remove);
});

test("a hasty attempt goes wrong on 1-3 and a methodical one only on 1", () => {
  assert.deepEqual([1, 2, 3, 4].map((n) => isBotch(n, "hasty")), [true, true, true, false]);
  assert.deepEqual([1, 2, 3, 4].map((n) => isBotch(n, "methodical")), [true, false, false, false]);
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

test("a pit deals a die per ten feet fallen", () => {
  assert.equal(pitDamageFormula(10), "1d6");
  assert.equal(pitDamageFormula(30), "3d6");
});

test("spikes at the bottom are 1d4 of them at 1d6 each", () => {
  // The nested count is the rule: 1d4 spikes, a d6 apiece. `1d4 * 1d6` would
  // roll ONE d6 and scale it, which is a different distribution wearing the
  // same numbers.
  assert.equal(pitDamageFormula(20, true), "2d6 + (1d4)d6");
});

test("a trap that is not a pit has no pit damage at all", () => {
  // Not zero damage — no such component. A shallow scrape is not a fall.
  assert.equal(pitDamageFormula(0), null);
  assert.equal(pitDamageFormula(5), null);
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
  assert.equal(firingPlan({ resolution: RESOLUTIONS.save, saveKey: "breath" }).saveKey, "breath");
  assert.equal(firingPlan({ resolution: RESOLUTIONS.attack, saveKey: "breath" }).saveKey, null);
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

console.log(
  `test-trap-rules: OK (${passed} checks — probe order, pole reach, victims, trigger band, disarm plan, botch bands, repeat lock, damage, wall chaining, crossings, marker spread)`,
);
