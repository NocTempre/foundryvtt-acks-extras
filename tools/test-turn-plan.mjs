/**
 * The formation's turn plan as arithmetic (`formation/turn-plan-logic.mjs`) over
 * lib's registry: the party's own stops, the lock order, a move, and the order a
 * planned turn runs in. Pure; no Foundry. Every activity, length and figure is
 * invented: the suite asserts how often the clock is spent and a roll is made,
 * never what any activity costs.
 *
 * The real resolution, with the real clock, party check and chat cards, is
 * walked offline in `test-formation-flows.mjs` ("turn plan") and live in
 * `tools/live/formation-turn-plan.mjs`.
 */
import assert from "node:assert/strict";

const { registerTurnActivity, cancelForCombat, TURN_REASONS } = await import("../scripts/lib/turn-activities.mjs");
const { PLAN_REASONS, cancelForMove, lockForMember, memberBlock, queueGroup, runPlanTurn } = await import(
  "../scripts/formation/turn-plan-logic.mjs"
);

let passed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    passed++;
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
};

const actors = { a: { id: "a" }, b: { id: "b" }, c: { id: "c" } };
const actorOf = (id) => actors[id] ?? null;
const free = { member: { actorId: "a" } };

const calls = { resolve: [] };
const undo = [
  // A group check: each resolve queues the member, the turn's flush rolls the queue once.
  registerTurnActivity({
    key: "qaLook",
    pace: "methodical",
    options: () => [{}],
    turns: () => 1,
    resolve: (actor, _option, ctx) => queueGroup(ctx, "qaLook", actor.id),
  }),
  // A three-turn job with its own resolve.
  registerTurnActivity({
    key: "qaDig",
    pace: "methodical",
    options: () => [{}],
    turns: () => 3,
    resolve: (actor) => { calls.resolve.push(["qaDig", actor.id]); return "dug"; },
  }),
  // A job the member is blocked from, and one whose length is not imported.
  registerTurnActivity({
    key: "qaShut",
    pace: "hasty",
    options: () => [{}],
    turns: () => 1,
    blocked: () => ({ reason: "qaNoTool", missing: ["tool"] }),
    resolve: () => null,
  }),
  registerTurnActivity({ key: "qaLong", pace: "methodical", options: () => [{}], turns: () => null, resolve: () => null }),
  registerTurnActivity({ key: "rest", pace: "methodical", options: () => [{}], turns: () => 1, resolve: () => "rested" }),
];

/** A turn's effects, counted. `flushThrows` makes the group roll fail after the plan is written. */
function harness({ flushThrows = false } = {}) {
  const log = { spends: [], writes: [], rolls: [], turn: 40 };
  return {
    log,
    effects: {
      spendTurn: async (opts) => { log.spends.push(opts); log.turn += 1; },
      turnOf: () => log.turn,
      writePlan: async (plan) => { log.writes.push(JSON.parse(JSON.stringify(plan))); },
      actorOf,
      flush: async (groups) => {
        if (flushThrows) throw new Error("qa: the roll failed");
        for (const [group, ids] of groups) log.rolls.push([group, [...ids]]);
        return log.rolls.length;
      },
    },
  };
}

const lock = (plan, actorId, key, state = { member: { actorId } }) =>
  lockForMember(plan, { actorId, actor: actorOf(actorId), key }, state);

await test("one turn spends the clock once and rolls a group check once for everyone who chose it", async () => {
  let plan = {};
  plan = lock(plan, "a", "qaLook").plan;
  plan = lock(plan, "b", "qaLook").plan;
  const { log, effects } = harness();
  const out = await runPlanTurn({ plan, memberIds: ["a", "b", "c"], ...effects, ctx: {} });
  assert.equal(log.spends.length, 1, "the clock is spent exactly once");
  assert.deepEqual(log.spends[0], { resting: false });
  assert.deepEqual(log.rolls, [["qaLook", ["a", "b"]]], "one roll for the group, holding both members and nobody else");
  assert.equal(out.due.length, 2);
  assert.ok(out.results.every((r) => r.status === "resolved"));
  assert.equal(log.writes.length, 1, "the plan is written once, before anything resolves");
  assert.ok(Object.values(log.writes[0]).every((e) => e.resolvedTurn === 41), "both entries stamped with the clock's turn");
});

await test("the plan is written stamped before the first entry resolves", async () => {
  let plan = lock({}, "a", "qaDig").plan;
  plan = { a: { ...plan.a, remaining: 1 } };
  const order = [];
  const { effects } = harness();
  await runPlanTurn({
    plan, memberIds: ["a"], ...effects,
    spendTurn: async () => order.push("spend"),
    turnOf: () => 7,
    writePlan: async () => order.push("write"),
    actorOf: (id) => { order.push("resolve"); return actorOf(id); },
  });
  assert.deepEqual(order, ["spend", "write", "resolve"]);
});

await test("a multi-turn entry counts down and holds until its last turn", async () => {
  calls.resolve.length = 0;
  let plan = lock({}, "a", "qaDig").plan;
  assert.equal(plan.a.remaining, 3);
  const { log, effects } = harness();
  for (const left of [2, 1]) {
    const out = await runPlanTurn({ plan, memberIds: ["a"], ...effects });
    plan = log.writes.at(-1);
    assert.equal(plan.a.remaining, left, `after the turn, ${left} left`);
    assert.equal(out.due.length, 0, "nothing due while turns remain");
    assert.equal(out.progressed.length, 1);
    assert.equal(calls.resolve.length, 0, "the job is not resolved early");
  }
  const out = await runPlanTurn({ plan, memberIds: ["a"], ...effects });
  assert.equal(out.due.length, 1);
  assert.deepEqual(calls.resolve, [["qaDig", "a"]], "the job resolves once, on its last turn");
  assert.equal(log.spends.length, 3, "one spend per turn, three turns");
});

await test("a blocked lock is refused and writes nothing", async () => {
  const plan = { b: { key: "qaLook", option: null, remaining: 1, turns: 1, by: null } };
  const cases = [
    [{ member: null }, PLAN_REASONS.notMember],
    [{ member: { actorId: "a" }, moved: true, inCombat: true }, PLAN_REASONS.moved],
    [{ member: { actorId: "a" }, inCombat: true, down: true }, PLAN_REASONS.combat],
    [{ member: { actorId: "a", left: true, detached: true } }, PLAN_REASONS.left],
    [{ member: { actorId: "a", detached: true }, down: true }, PLAN_REASONS.detached],
    [{ member: { actorId: "a" }, down: true }, PLAN_REASONS.down],
  ];
  for (const [state, reason] of cases) {
    const out = lock(plan, "a", "qaLook", state);
    assert.deepEqual(out, { ok: false, reason, missing: [] }, `refused as ${reason}`);
  }
  const own = lock(plan, "a", "qaShut");
  assert.deepEqual(own, { ok: false, reason: "qaNoTool", missing: ["tool"] }, "the activity's own block, verbatim");
  const long = lock(plan, "a", "qaLong");
  assert.deepEqual(long, { ok: false, reason: TURN_REASONS.notImported, missing: ["turns"] }, "a length not imported cannot lock");
  assert.equal(memberBlock(free), null, "a member on their feet, standing still and out of a fight is free");
  assert.equal(lock(plan, "a", "qaLook").ok, true);
  assert.deepEqual(Object.keys(plan), ["b"], "no refusal touched the plan");
});

await test("a retry after a failure part-way rolls nothing twice", async () => {
  let plan = lock({}, "a", "qaLook").plan;
  const first = harness({ flushThrows: true });
  await assert.rejects(runPlanTurn({ plan, memberIds: ["a"], ...first.effects }), /qa: the roll failed/);
  assert.equal(first.log.writes.length, 1, "the stamped plan was written before the roll failed");
  plan = first.log.writes[0];
  assert.equal(plan.a.resolvedTurn, 41);

  // The Judge presses again: the clock spends a new turn, and the stamped entry leaves the plan unrolled.
  const again = harness();
  again.log.turn = first.log.turn;
  const out = await runPlanTurn({ plan, memberIds: ["a"], ...again.effects });
  assert.equal(out.due.length, 0, "nothing is due on the retry");
  assert.deepEqual(again.log.rolls, [], "nothing rolled on the retry");
  assert.deepEqual(again.log.writes.at(-1), {}, "the stamped entry is gone");

  // A repeat on the SAME turn changes nothing either.
  const same = harness();
  same.effects.spendTurn = async () => {};
  same.log.turn = 41;
  const repeat = await runPlanTurn({ plan, memberIds: ["a"], ...same.effects });
  assert.equal(repeat.due.length, 0);
  assert.deepEqual(same.log.rolls, []);
});

await test("a party rest is every member who owes rest choosing Rest, and the Judge's Rest is a rest whatever was chosen", async () => {
  let plan = lock({}, "a", "rest").plan;
  plan = lock(plan, "b", "rest").plan;
  const owes = harness();
  await runPlanTurn({ plan, memberIds: ["a", "b", "c"], ...owes.effects });
  assert.deepEqual(owes.log.spends, [{ resting: false }], "c owes rest and chose nothing: not a rest");

  const endures = harness();
  await runPlanTurn({ plan, memberIds: ["a", "b", "c"], endures: (id) => id === "c", ...endures.effects });
  assert.deepEqual(endures.log.spends, [{ resting: true }], "c owes none: the turn rests");

  const judge = harness();
  await runPlanTurn({ plan: {}, memberIds: ["a"], forcedRest: true, ...judge.effects });
  assert.deepEqual(judge.log.spends, [{ resting: true }]);
});

await test("a move cancels every open entry, a multi-turn one's progress with it", async () => {
  let plan = lock({}, "a", "qaDig").plan;
  plan = lock(plan, "b", "qaLook").plan;
  plan.c = { key: "qaLook", option: null, remaining: 0, turns: 1, by: null, resolvedTurn: 9 };
  const out = cancelForMove(plan);
  assert.deepEqual(out.cancelled.map((c) => c.actorId), ["a", "b"]);
  assert.deepEqual(Object.keys(out.plan), ["c"], "an entry done this turn stays until the next advance");
});

await test("a fight cancels single-turn entries and keeps a multi-turn entry's progress", async () => {
  let plan = lock({}, "a", "qaDig").plan;
  plan = lock(plan, "b", "qaLook").plan;
  const { log, effects } = harness();
  await runPlanTurn({ plan, memberIds: ["a", "b"], ...effects });
  plan = log.writes.at(-1);
  plan.b = { key: "qaLook", option: null, remaining: 1, turns: 1, by: null };
  const out = cancelForCombat(plan);
  assert.deepEqual(out.cancelled.map((c) => c.actorId), ["b"]);
  assert.deepEqual(out.kept.map((k) => k.actorId), ["a"]);
  assert.equal(out.plan.a.remaining, 2, "the dig keeps the turn it had done");
});

for (const u of undo) u();
console.log(`test-turn-plan: ${passed} checks passed`);
