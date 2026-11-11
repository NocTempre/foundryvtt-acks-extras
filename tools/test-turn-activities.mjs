/**
 * The turn-activity registry and the plan helpers over it. Pure functions; no
 * Foundry, no world. Every activity, option and length below is invented: the
 * suite asserts how the helpers count and refuse, never what any activity costs.
 *
 * `TURN_ACTIVITIES_MODULE` points the suite at another copy of the module, so a
 * mutated copy can be run against the same assertions.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const target = process.env.TURN_ACTIVITIES_MODULE
  ? pathToFileURL(path.resolve(process.env.TURN_ACTIVITIES_MODULE)).href
  : new URL("../scripts/lib/turn-activities.mjs", import.meta.url).href;
const {
  REST_KEY, TURN_PACES, TURN_REASONS, advanceTurn, cancelForCombat, listTurnActivities, lockActivity,
  offeredActivities, partyRest, registerTurnActivity, resolveDue, turnActivity, unlockActivity,
} = await import(target);

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

/** Run a body with some registrations, unregistering them after. */
async function withRegistry(defs, body) {
  const undo = defs.map((d) => registerTurnActivity(d));
  try {
    return await body();
  } finally {
    for (const u of undo) u();
  }
}

const calls = [];
const quiet = async (fn) => {
  const original = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);
  try {
    return [await fn(), logged];
  } finally {
    console.error = original;
  }
};

/** A minimal activity: one option, a stated length, a resolve that logs. */
const probe = (over = {}) => ({
  key: "probe",
  pace: "methodical",
  options: () => [{}],
  turns: () => 1,
  resolve: (actor, option) => { calls.push(["probe", actor.id, option.id ?? null]); return "done"; },
  ...over,
});
const dig = (over = {}) => ({
  key: "dig",
  pace: "methodical",
  options: () => [{ id: "shallow", label: "Shallow" }, { id: "deep", confirm: "judge" }],
  turns: (actor, option) => (option.id === "deep" ? 3 : 2),
  resolve: (actor, option) => { calls.push(["dig", actor.id, option.id]); },
  ...over,
});
const a = { id: "A" };
const b = { id: "B" };
const c = { id: "C" };

/* -------------------------------------------- */
/*  Registration                                */
/* -------------------------------------------- */

await test("registration validates the declaration", () => {
  assert.throws(() => registerTurnActivity({ ...probe(), key: "" }), TypeError);
  assert.throws(() => registerTurnActivity({ ...probe(), pace: "slow" }), TypeError);
  assert.throws(() => registerTurnActivity({ ...probe(), options: null }), TypeError);
  assert.throws(() => registerTurnActivity({ ...probe(), turns: 3 }), TypeError);
  assert.throws(() => registerTurnActivity({ ...probe(), resolve: undefined }), TypeError);
  assert.throws(() => registerTurnActivity({ ...probe(), blocked: "no" }), TypeError);
  assert.throws(() => registerTurnActivity(), TypeError);
  assert.deepEqual([...TURN_PACES], ["hasty", "methodical"]);
  assert.equal(listTurnActivities().length, 0);
});

await test("unregister removes its own declaration only", async () => {
  const undo = registerTurnActivity(probe());
  assert.equal(turnActivity("probe").key, "probe");
  const undoReplacement = registerTurnActivity(probe({ pace: "hasty" }));
  assert.equal(undo(), false);
  assert.equal(turnActivity("probe").pace, "hasty");
  assert.equal(undoReplacement(), true);
  assert.equal(turnActivity("probe"), null);
  assert.equal(undoReplacement(), false);
});

await test("a replaced key keeps its place in the order", async () => {
  await withRegistry([probe(), dig()], () => {
    registerTurnActivity(probe({ pace: "hasty" }));
    assert.deepEqual(listTurnActivities().map((d) => d.key), ["probe", "dig"]);
    assert.equal(listTurnActivities()[0].pace, "hasty");
  });
});

await test("fields the registry does not name ride along untouched", async () => {
  const extra = { x: 1 };
  await withRegistry([probe({ extra })], () => {
    assert.equal(turnActivity("probe").extra, extra);
    assert.equal(turnActivity("probe").oncePerTurn, false);
  });
});

/* -------------------------------------------- */
/*  What is offered                             */
/* -------------------------------------------- */

await test("offered rows carry each option whole, its length and its block", async () => {
  await withRegistry([probe(), dig({ blocked: (_actor, option) => (option.id === "deep" ? { reason: "noTools", missing: ["spade", "rope"] } : null) })], () => {
    const rows = offeredActivities(a);
    assert.deepEqual(rows.map((r) => [r.key, r.option.id ?? null, r.turns]), [["probe", null, 1], ["dig", "shallow", 2], ["dig", "deep", 3]]);
    assert.equal(rows[2].option.confirm, "judge");
    assert.equal(rows[1].option.label, "Shallow");
    assert.deepEqual(rows[2].blocked, { reason: "noTools", missing: ["spade", "rope"] });
    assert.equal(rows[1].blocked, null);
    assert.equal(rows[0].pace, "methodical");
  });
});

await test("a registrant that throws is contained, never opening a gate", async () => {
  await withRegistry([
    probe({ key: "badOptions", options: () => { throw new Error("x"); } }),
    probe({ key: "badTurns", turns: () => { throw new Error("x"); } }),
    probe({ key: "badBlocked", blocked: () => { throw new Error("x"); } }),
    probe({ key: "garbage", blocked: () => ({ nope: true }) }),
    probe({ key: "notAnArray", options: () => "x" }),
  ], async () => {
    const [rows, logged] = await quiet(() => offeredActivities(a));
    assert.deepEqual(rows.map((r) => r.key), ["badTurns", "badBlocked", "garbage"]);
    assert.deepEqual(rows.map((r) => r.blocked?.reason), ["faulted", "faulted", "faulted"]);
    assert.equal(rows[0].turns, null);
    assert.equal(logged.length, 3);
    const [locked] = await quiet(() => lockActivity({}, { actorId: "A", actor: a, key: "badBlocked" }));
    assert.equal(locked.ok, false);
    assert.equal(locked.reason, "faulted");
  });
});

/* -------------------------------------------- */
/*  Locking                                     */
/* -------------------------------------------- */

await test("lock writes the entry and leaves the old plan alone", async () => {
  await withRegistry([probe(), dig()], () => {
    const plan = {};
    const r = lockActivity(plan, { actorId: "A", actor: a, key: "dig", option: "deep", by: "u1" });
    assert.equal(r.ok, true);
    assert.deepEqual(r.entry, { key: "dig", option: "deep", remaining: 3, turns: 3, by: "u1" });
    assert.deepEqual(r.plan, { A: r.entry });
    assert.deepEqual(plan, {});
    const again = lockActivity(r.plan, { actorId: "A", actor: a, key: "probe" });
    assert.deepEqual(Object.keys(again.plan), ["A"]);
    assert.equal(again.plan.A.key, "probe");
    assert.equal(again.plan.A.option, null);
  });
});

await test("lock refuses an unknown activity and an option not offered", async () => {
  await withRegistry([dig()], () => {
    assert.deepEqual(lockActivity({}, { actorId: "A", actor: a, key: "nope" }), { ok: false, reason: TURN_REASONS.unknownActivity, missing: [] });
    assert.equal(lockActivity({}, { actorId: "A", actor: a, key: "dig", option: "elsewhere" }).reason, TURN_REASONS.unknownOption);
    assert.equal(lockActivity({}, { actorId: "A", actor: a, key: "dig" }).reason, TURN_REASONS.unknownOption);
  });
});

await test("lock refuses a blocked choice with what is missing, before once-per-turn", async () => {
  await withRegistry([dig({ oncePerTurn: true, blocked: () => ({ reason: "noTools", missing: ["spade"] }) })], () => {
    const r = lockActivity({}, { actorId: "A", actor: a, key: "dig", option: "deep", usedThisTurn: () => true });
    assert.deepEqual(r, { ok: false, reason: "noTools", missing: ["spade"] });
  });
});

await test("a blocked reason may be a bare id", async () => {
  await withRegistry([probe({ blocked: (actor) => (actor.id === "A" ? "moved" : null) })], () => {
    assert.deepEqual(lockActivity({}, { actorId: "A", actor: a, key: "probe" }), { ok: false, reason: "moved", missing: [] });
    assert.equal(lockActivity({}, { actorId: "B", actor: b, key: "probe" }).ok, true);
  });
});

await test("a length that is not imported cannot be locked, and says so", async () => {
  await withRegistry([dig({ turns: (_actor, option) => (option.id === "deep" ? null : 2) })], () => {
    const r = lockActivity({}, { actorId: "A", actor: a, key: "dig", option: "deep" });
    assert.deepEqual(r, { ok: false, reason: TURN_REASONS.notImported, missing: ["turns"] });
    assert.equal(offeredActivities(a)[1].turns, null);
    assert.equal(lockActivity({}, { actorId: "A", actor: a, key: "dig", option: "shallow" }).ok, true);
  });
});

await test("a length that is not a positive whole number is not imported", async () => {
  for (const bad of [0, -1, 0.4, 2.5, NaN, Infinity, "2", undefined]) {
    await withRegistry([probe({ turns: () => bad })], () => {
      assert.equal(lockActivity({}, { actorId: "A", actor: a, key: "probe" }).reason, TURN_REASONS.notImported);
      assert.equal(offeredActivities(a)[0].turns, null);
    });
  }
  await withRegistry([probe({ turns: () => 4 })], () => {
    assert.equal(lockActivity({}, { actorId: "A", actor: a, key: "probe" }).entry.remaining, 4);
  });
});

await test("once-per-turn asks the owner who used the activity this turn", async () => {
  await withRegistry([probe({ oncePerTurn: true }), dig()], () => {
    const asked = [];
    const used = (id, key) => { asked.push([id, key]); return id === "A"; };
    const refused = lockActivity({}, { actorId: "A", actor: a, key: "probe", usedThisTurn: used });
    assert.deepEqual(refused, { ok: false, reason: TURN_REASONS.alreadyUsed, missing: [] });
    assert.equal(lockActivity({}, { actorId: "B", actor: b, key: "probe", usedThisTurn: used }).ok, true);
    assert.deepEqual(asked, [["A", "probe"], ["B", "probe"]]);
    assert.equal(lockActivity({}, { actorId: "A", actor: a, key: "dig", option: "shallow", usedThisTurn: used }).ok, true);
    assert.equal(asked.length, 2);
    assert.equal(lockActivity({}, { actorId: "A", actor: a, key: "probe" }).ok, true);
  });
});

await test("once-per-turn over a real sequence: lock, advance, relock in the turn and in the next", async () => {
  await withRegistry([probe({ oncePerTurn: true })], () => {
    let plan = {};
    let reading = 7;
    const usedThisTurn = (id, key) => plan[id]?.key === key && plan[id].resolvedTurn === reading;
    const first = lockActivity(plan, { actorId: "A", actor: a, key: "probe", usedThisTurn });
    assert.equal(first.ok, true);
    plan = advanceTurn(first.plan, reading).plan;
    assert.equal(plan.A.resolvedTurn, 7);
    assert.equal(lockActivity(plan, { actorId: "A", actor: a, key: "probe", usedThisTurn }).reason, TURN_REASONS.alreadyUsed);
    reading = 8;
    const next = lockActivity(plan, { actorId: "A", actor: a, key: "probe", usedThisTurn });
    assert.equal(next.ok, true);
    assert.equal(next.plan.A.resolvedTurn, undefined);
  });
});

await test("advance needs a finite turn, so an omitted one cannot freeze the plan", () => {
  const plan = { A: { key: "dig", option: "deep", remaining: 2, turns: 3, by: "u" } };
  for (const bad of [undefined, null, NaN, Infinity, "5"]) assert.throws(() => advanceTurn(plan, bad), TypeError);
  assert.equal(advanceTurn(plan, 0).plan.A.remaining, 1);
});

await test("a new lock replaces an entry in progress, progress and all", async () => {
  await withRegistry([probe(), dig()], () => {
    const progress = { A: { key: "dig", option: "deep", remaining: 1, turns: 3, by: "u" } };
    const r = lockActivity(progress, { actorId: "A", actor: a, key: "dig", option: "deep", by: "u2" });
    assert.deepEqual(r.plan.A, { key: "dig", option: "deep", remaining: 3, turns: 3, by: "u2" });
    assert.equal(progress.A.remaining, 1);
  });
});

await test("unlock removes one entry and hands back the same plan when there is none", () => {
  const plan = { A: { key: "probe" }, B: { key: "dig" } };
  assert.deepEqual(unlockActivity(plan, "A"), { B: { key: "dig" } });
  assert.deepEqual(plan.A, { key: "probe" });
  assert.equal(unlockActivity(plan, "Z"), plan);
  assert.deepEqual(unlockActivity(undefined, "A"), {});
});

/* -------------------------------------------- */
/*  Counting down                               */
/* -------------------------------------------- */

const entry = (over = {}) => ({ key: "dig", option: "deep", remaining: 3, turns: 3, by: "u", ...over });

await test("advance decrements once per turn, and a zero entry is due and stamped", () => {
  const plan = { A: entry({ remaining: 3 }), B: entry({ remaining: 1, turns: 1, key: "probe", option: null }) };
  const r = advanceTurn(plan, 5);
  assert.deepEqual(r.due.map((d) => d.actorId), ["B"]);
  assert.deepEqual(r.progressed.map((d) => d.actorId), ["A"]);
  assert.equal(r.plan.A.remaining, 2);
  assert.equal(r.plan.A.resolvedTurn, undefined);
  assert.equal(r.plan.B.remaining, 0);
  assert.equal(r.plan.B.resolvedTurn, 5);
  assert.equal(r.due[0].entry.resolvedTurn, 5);
  assert.equal(plan.A.remaining, 3);
  assert.equal(plan.B.resolvedTurn, undefined);
});

await test("a multi-turn entry runs its length and is due on the last turn only", () => {
  let plan = { A: entry({ remaining: 3 }) };
  const seen = [];
  for (let turn = 1; turn <= 3; turn++) {
    const r = advanceTurn(plan, turn);
    seen.push([r.plan.A.remaining, r.due.length, r.progressed.length]);
    plan = r.plan;
  }
  assert.deepEqual(seen, [[2, 0, 1], [1, 0, 1], [0, 1, 0]]);
  assert.equal(plan.A.resolvedTurn, 3);
});

await test("advancing the same turn twice changes nothing the second time", () => {
  const plan = { A: entry({ remaining: 3 }), B: entry({ remaining: 1, turns: 1 }) };
  const first = advanceTurn(plan, 5);
  const second = advanceTurn(first.plan, 5);
  assert.deepEqual(second.plan, first.plan);
  assert.equal(second.due.length, 0);
  assert.equal(second.progressed.length, 0);
});

await test("a stamped entry is finished in a later turn and leaves the plan", () => {
  const plan = { A: entry({ remaining: 0, resolvedTurn: 5 }), B: entry({ remaining: 2 }) };
  const r = advanceTurn(plan, 6);
  assert.deepEqual(Object.keys(r.plan), ["B"]);
  assert.equal(r.plan.B.remaining, 1);
  assert.deepEqual(advanceTurn(undefined, 1), { plan: {}, due: [], progressed: [] });
});

/* -------------------------------------------- */
/*  Resolution                                  */
/* -------------------------------------------- */

await test("resolve runs each due entry in order and reports each", async () => {
  calls.length = 0;
  await withRegistry([probe(), dig()], async () => {
    const plan = { A: entry({ remaining: 1, option: "deep" }), B: { key: "probe", option: null, remaining: 1, turns: 1, by: "u" } };
    const { due, plan: next } = advanceTurn(plan, 2);
    const actors = { A: a, B: b };
    const out = await resolveDue(due, { actorOf: (id) => actors[id] });
    assert.deepEqual(out.map((o) => [o.actorId, o.status]), [["A", "resolved"], ["B", "resolved"]]);
    assert.deepEqual(calls, [["dig", "A", "deep"], ["probe", "B", null]]);
    assert.equal(out[1].result, "done");
    assert.equal(next.A.resolvedTurn, 2);
  });
});

await test("resolve passes the registrant's option object through untouched", async () => {
  let seen = null;
  await withRegistry([dig({ resolve: (_actor, option) => { seen = option; } })], async () => {
    const { due } = advanceTurn({ A: entry({ remaining: 1 }) }, 2);
    await resolveDue(due, { actorOf: () => a });
    assert.equal(seen.confirm, "judge");
    assert.equal(seen.id, "deep");
  });
});

await test("an entry whose activity, option or member is gone is dropped, not failed", async () => {
  calls.length = 0;
  let offered = true;
  await withRegistry([dig({ options: () => (offered ? [{ id: "deep" }] : [{ id: "shallow" }]) })], async () => {
    const due = [
      { actorId: "A", entry: entry({ key: "vanished" }) },
      { actorId: "B", entry: entry() },
      { actorId: "Z", entry: entry() },
    ];
    offered = false;
    const out = await resolveDue(due, { actorOf: (id) => ({ A: a, B: b })[id] });
    assert.deepEqual(out.map((o) => [o.status, o.reason]), [
      ["dropped", TURN_REASONS.unknownActivity],
      ["dropped", TURN_REASONS.unknownOption],
      ["dropped", TURN_REASONS.unknownActor],
    ]);
    assert.equal(calls.length, 0);
  });
});

await test("a resolve that throws is reported failed and the rest still run", async () => {
  calls.length = 0;
  await withRegistry([
    probe({ key: "boom", resolve: () => { throw new Error("x"); } }),
    probe(),
  ], async () => {
    const due = [
      { actorId: "A", entry: { key: "boom", option: null, remaining: 0, turns: 1, by: "u" } },
      { actorId: "B", entry: { key: "probe", option: null, remaining: 0, turns: 1, by: "u" } },
    ];
    const [out, logged] = await quiet(() => resolveDue(due, { actorOf: (id) => ({ A: a, B: b })[id] }));
    assert.deepEqual(out.map((o) => o.status), ["failed", "resolved"]);
    assert.equal(out[0].error.message, "x");
    assert.equal(logged.length, 1);
  });
});

await test("a retry after a stamped failure does not resolve the entry again", async () => {
  calls.length = 0;
  await withRegistry([probe()], async () => {
    const plan = { A: { key: "probe", option: null, remaining: 1, turns: 1, by: "u" } };
    const first = advanceTurn(plan, 9);
    assert.equal(first.due.length, 1);
    const retry = advanceTurn(first.plan, 9);
    assert.equal(retry.due.length, 0);
    await resolveDue(retry.due, { actorOf: () => a });
    assert.equal(calls.length, 0);
  });
});

/* -------------------------------------------- */
/*  Combat                                      */
/* -------------------------------------------- */

await test("combat cancels unresolved single-turn entries and keeps multi-turn progress", () => {
  const plan = {
    A: entry({ remaining: 1, turns: 1, key: "probe", option: null }),
    B: entry({ remaining: 2, turns: 3 }),
    C: entry({ remaining: 1, turns: 3 }),
    D: entry({ remaining: 0, turns: 1, resolvedTurn: 4 }),
  };
  const r = cancelForCombat(plan);
  assert.deepEqual(r.cancelled.map((e) => e.actorId), ["A"]);
  assert.deepEqual(r.kept.map((e) => e.actorId), ["B", "C"]);
  assert.deepEqual(Object.keys(r.plan), ["B", "C", "D"]);
  assert.equal(r.plan.B.remaining, 2);
  assert.equal(r.plan.C.remaining, 1);
  assert.equal(r.cancelled[0].entry.key, "probe");
  assert.equal(plan.A.remaining, 1);
});

await test("combat on an empty plan names nothing", () => {
  assert.deepEqual(cancelForCombat(undefined), { plan: {}, cancelled: [], kept: [] });
  assert.deepEqual(cancelForCombat({}), { plan: {}, cancelled: [], kept: [] });
});

/* -------------------------------------------- */
/*  Rest                                        */
/* -------------------------------------------- */

const rester = (over = {}) => ({ key: REST_KEY, option: null, remaining: 1, turns: 1, by: "u", ...over });

await test("a party rests when every member who owes rest chose it", () => {
  const plan = { A: rester(), B: rester(), C: entry() };
  const none = () => false;
  assert.equal(partyRest(plan, ["A", "B"], { endures: none }).rests, true);
  const withC = partyRest(plan, ["A", "B", "C"], { endures: none });
  assert.equal(withC.rests, false);
  assert.deepEqual(withC.missing, ["C"]);
  assert.deepEqual(withC.owing, ["A", "B", "C"]);
  assert.deepEqual(withC.chose, ["A", "B"]);
});

await test("a member keeping watch owes rest, and idleness is the default", () => {
  const r = partyRest({ A: rester() }, ["A", "B"]);
  assert.equal(r.rests, false);
  assert.deepEqual(r.missing, ["B"]);
});

await test("a member with the capability owes none; the party still needs someone to choose it", () => {
  const endures = (id) => id === "C";
  const plan = { A: rester(), B: rester() };
  const r = partyRest(plan, ["A", "B", "C"], { endures });
  assert.equal(r.rests, true);
  assert.deepEqual(r.owing, ["A", "B"]);
  assert.equal(partyRest({}, ["C"], { endures }).rests, false);
  assert.equal(partyRest({ C: rester() }, ["C"], { endures }).rests, true);
  assert.equal(partyRest({ A: entry(), B: rester() }, ["A", "B", "C"], { endures }).rests, false);
});

await test("an enduring member who chose rest counts as choosing it", () => {
  const r = partyRest({ A: rester(), C: rester() }, ["A", "C"], { endures: (id) => id === "C" });
  assert.deepEqual(r.chose, ["A", "C"]);
  assert.equal(r.rests, true);
});

await test("an empty party does not rest, and a different rest key is honoured", () => {
  assert.equal(partyRest({}, []).rests, false);
  assert.equal(partyRest(undefined, undefined).rests, false);
  assert.equal(partyRest({ A: rester({ key: "camp" }) }, ["A"], { restKey: "camp" }).rests, true);
  assert.equal(partyRest({ A: rester({ key: "camp" }) }, ["A"]).rests, false);
});

await test("a stamped rest entry is no longer a choice", () => {
  assert.equal(partyRest({ A: rester({ remaining: 0, resolvedTurn: 3 }) }, ["A"]).rests, false);
});

/* -------------------------------------------- */
/*  End to end                                  */
/* -------------------------------------------- */

await test("a harvest-shaped activity can say what it lacks and ask the Judge to confirm", async () => {
  const have = new Set();
  const gather = {
    key: "gather", pace: "methodical", oncePerTurn: false,
    options: () => [{ id: "pelt", confirm: "judge" }],
    turns: () => 2,
    blocked: (_actor, option) => {
      const missing = ["tools", "identified"].filter((need) => !have.has(need));
      return missing.length ? { reason: "gateOpen", missing } : null;
    },
    resolve: () => "gathered",
  };
  await withRegistry([gather], async () => {
    const row = offeredActivities(a)[0];
    assert.equal(row.option.confirm, "judge");
    assert.deepEqual(row.blocked, { reason: "gateOpen", missing: ["tools", "identified"] });
    have.add("tools");
    assert.deepEqual(lockActivity({}, { actorId: "A", actor: a, key: "gather", option: "pelt" }).missing, ["identified"]);
    have.add("identified");
    let plan = lockActivity({}, { actorId: "A", actor: a, key: "gather", option: "pelt" }).plan;
    let step = advanceTurn(plan, 1);
    assert.equal(step.due.length, 0);
    step = advanceTurn(step.plan, 2);
    const out = await resolveDue(step.due, { actorOf: () => a });
    assert.equal(out[0].status, "resolved");
    assert.equal(out[0].result, "gathered");
  });
});

console.log(
  `test-turn-activities: OK (${passed} checks — registration and unregister, offered rows, lock refusal order, not-imported lengths, once-per-turn, advance and stamp, retry, resolution containment, combat cancel, party rest)`,
);
