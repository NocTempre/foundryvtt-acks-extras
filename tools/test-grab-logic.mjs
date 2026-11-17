/**
 * Quick grab's planner (`scripts/treasure/grab-logic.mjs`), on plain data. Every
 * pace step here is this file's own invention: `stepped` builds a `paceWith`
 * whose rank rises by one for every `size` weight a member bears, so the tests
 * prove the machinery and never a movement figure.
 *
 * Run: node tools/test-grab-logic.mjs
 */
import assert from "node:assert/strict";
import { EXACT_LOT_LIMIT, GRAB_NOTE, planGrab } from "../scripts/treasure/grab-logic.mjs";

const checks = [];
const t = (name, fn) => {
  fn();
  checks.push(name);
  console.log(`ok   ${name}`);
};

/** A member with room `room` beyond a load of `load`. */
const member = (id, room, load = 0, extra = {}) => ({ id, capacity6: room + load, load6: load, hasDocument: true, ...extra });
/** A paceWith whose rank is the floor of (load + adding) over a step size, per member. */
const stepped = (members, size) => {
  const load = Object.fromEntries(members.map((m) => [m.id, m.load6 ?? 0]));
  return (id, adding) => Math.floor((load[id] + adding) / (typeof size === "object" ? size[id] : size));
};
const flat = () => 0;
const lot = (id, weight6) => ({ id, weight6 });
const coinLot = (id, count, weight6) => ({ id, weight6, coin: { name: "QQ coin", cv: 1, count } });

/** What each member ends up carrying, in weight, from a plan. */
const loadsOf = (plan, lots) => {
  const byId = new Map(lots.map((l) => [l.id, l]));
  const out = {};
  for (const a of plan.assignments) {
    const l = byId.get(a.lotId);
    out[a.memberId] = (out[a.memberId] ?? 0) + (a.count ? (l.weight6 * a.count) / l.coin.count : l.weight6);
  }
  return out;
};

t("everything is placed at the fastest pace that carries it", () => {
  const members = [member("a", 100), member("b", 100)];
  const lots = [lot("x", 30), lot("y", 30)];
  const plan = planGrab({ members, lots, paceWith: stepped(members, 37) });
  assert.equal(plan.pace, 0, "one lot each keeps both under the step");
  assert.deepEqual(plan.assignments.map((a) => a.memberId).sort(), ["a", "b"]);
  assert.deepEqual(plan.leftover, []);

  const three = [...lots, lot("z", 30)];
  const slower = planGrab({ members, lots: three, paceWith: stepped(members, 37) });
  assert.equal(slower.pace, 1, "a third lot cannot be carried at the first pace, so the party takes the next");
  assert.equal(slower.assignments.length, 3);
  assert.deepEqual(slower.leftover, []);
});

t("a pace that carries less is not taken while a faster one carries it all", () => {
  const members = [member("a", 100), member("b", 100)];
  const lots = [lot("x", 20), lot("y", 20), lot("z", 10), lot("w", 10)];
  const plan = planGrab({ members, lots, paceWith: stepped(members, 37) });
  assert.equal(plan.pace, 0);
  for (const w of Object.values(loadsOf(plan, lots))) assert.ok(w < 37);
});

t("members step at their own sizes, and a heavier base load counts", () => {
  const members = [member("a", 100, 5), member("b", 100, 0)];
  const paceWith = stepped(members, { a: 37, b: 25 });
  const lots = [lot("x", 30), lot("y", 20)];
  const plan = planGrab({ members, lots, paceWith });
  assert.equal(plan.pace, 0);
  assert.equal(plan.assignments.find((a) => a.lotId === "x").memberId, "a", "the lot that only the larger step carries goes there");
  const heavy = planGrab({ members, lots: [lot("x", 30), lot("y", 30)], paceWith });
  assert.equal(heavy.pace, 1, "the larger step carries 30 and the smaller does not, so the slower pace");
});

t("the first pace that places everything wins even where a looser one would also place it", () => {
  // Loosely, best fit stacks both lots on the member whose step is large and the
  // worst-fit re-pack gives the big lot to the roomy member whose step is small:
  // neither is as fast as the split that only the tightest pace finds.
  const members = [member("a", 50), member("b", 200)];
  const paceWith = stepped(members, { a: 37, b: 10 });
  const plan = planGrab({ members, lots: [lot("big", 36), lot("small", 9)], paceWith });
  assert.equal(plan.pace, 0);
  assert.deepEqual(plan.assignments, [{ lotId: "big", memberId: "a" }, { lotId: "small", memberId: "b" }]);
});

t("a lot too heavy for anyone stays, with a note, and the rest still goes at its best pace", () => {
  const members = [member("a", 50), member("b", 50)];
  const lots = [lot("big", 500), lot("x", 20), lot("y", 20)];
  const plan = planGrab({ members, lots, paceWith: stepped(members, 37) });
  assert.deepEqual(plan.leftover, [{ lotId: "big" }]);
  assert.deepEqual(plan.notes.filter((n) => n.lotId), [{ code: GRAB_NOTE.tooHeavy, lotId: "big" }]);
  assert.equal(plan.pace, 0);
  assert.equal(plan.assignments.length, 2);
});

t("when the party's room runs out, what fits stays placed and the rest is noted", () => {
  const members = [member("a", 10), member("b", 10)];
  const lots = [lot("x", 8), lot("y", 8), lot("z", 8)];
  const plan = planGrab({ members, lots, paceWith: flat });
  assert.equal(plan.assignments.length, 2);
  assert.equal(plan.leftover.length, 1);
  assert.equal(plan.notes.at(-1).code, GRAB_NOTE.noRoom);
});

t("coin is poured by whole coins and split across members", () => {
  const members = [member("a", 20), member("b", 40)];
  const lots = [coinLot("c", 100, 50)];
  const plan = planGrab({ members, lots, paceWith: flat });
  const counts = Object.fromEntries(plan.assignments.map((a) => [a.memberId, a.count]));
  assert.equal(counts.a + counts.b, 100, "all of it is placed");
  assert.ok(Number.isInteger(counts.a) && Number.isInteger(counts.b));
  assert.ok(counts.a * 0.5 <= 20 && counts.b * 0.5 <= 40);
  assert.deepEqual(plan.leftover, []);
});

t("coin past the party's room leaves the whole coins that do not fit", () => {
  const members = [member("a", 20), member("b", 40)];
  const lots = [coinLot("c", 100, 100)];
  const plan = planGrab({ members, lots, paceWith: flat });
  const placed = plan.assignments.reduce((n, a) => n + a.count, 0);
  assert.equal(placed, 60);
  assert.deepEqual(plan.leftover, [{ lotId: "c", count: 40 }]);
  assert.equal(plan.notes.at(-1).code, GRAB_NOTE.noRoom);
});

t("coin is held to the pace as well as the capacity", () => {
  const members = [member("a", 100), member("b", 100)];
  const lots = [coinLot("c", 100, 60)];
  const plan = planGrab({ members, lots, paceWith: stepped(members, 37) });
  assert.equal(plan.pace, 0, "60 over two members stays under 37 each");
  for (const w of Object.values(loadsOf(plan, lots))) assert.ok(w < 37);
});

t("a casualty, a member with no capacity, no load or no document takes nothing", () => {
  const members = [
    member("a", 100),
    member("down", 100, 0, { casualty: true }),
    { id: "nocap", capacity6: null, load6: 0, hasDocument: true },
    { id: "noload", capacity6: 50, load6: null, hasDocument: true },
    member("nodoc", 100, 0, { hasDocument: false }),
  ];
  const lots = [lot("x", 10), lot("y", 10), lot("z", 10)];
  const plan = planGrab({ members, lots, paceWith: flat });
  assert.deepEqual([...new Set(plan.assignments.map((a) => a.memberId))], ["a"]);
  const why = Object.fromEntries(plan.notes.filter((n) => n.code === GRAB_NOTE.excluded).map((n) => [n.memberId, n.why]));
  assert.deepEqual(why, { down: "casualty", nocap: "noCapacity", noload: "noLoad", nodoc: "noDocument" });
});

t("a member whose pace has no figure takes nothing", () => {
  const members = [member("a", 100), member("b", 100)];
  const paceWith = (id, w) => (id === "b" ? null : Math.floor(w / 37));
  const plan = planGrab({ members, lots: [lot("x", 10)], paceWith });
  assert.deepEqual(plan.assignments, [{ lotId: "x", memberId: "a" }]);
  assert.equal(plan.notes.find((n) => n.memberId === "b").why, "noFigure");
});

t("with nobody able to take anything, every lot stays and one note says so", () => {
  const plan = planGrab({ members: [member("down", 100, 0, { casualty: true })], lots: [lot("x", 1), coinLot("c", 5, 1)], paceWith: flat });
  assert.deepEqual(plan.assignments, []);
  assert.deepEqual(plan.leftover, [{ lotId: "x" }, { lotId: "c", count: 5 }]);
  assert.ok(plan.notes.some((n) => n.code === GRAB_NOTE.noMembers));
  assert.equal(plan.pace, null);
});

t("exact search places what heaviest-first best fit strands, up to the lot limit", () => {
  const members = [member("a", 10), member("b", 10)];
  const lots = [lot("l4a", 4), lot("l4b", 4), lot("l3a", 3), lot("l3b", 3), lot("l3c", 3), lot("l3d", 3)];
  const exact = planGrab({ members, lots, paceWith: flat });
  assert.deepEqual(exact.leftover, [], "4+3+3 on each");
  assert.deepEqual(Object.values(loadsOf(exact, lots)).sort(), [10, 10]);

  // Weightless lots past the limit turn the search off, and best fit strands a 3.
  const filler = Array.from({ length: EXACT_LOT_LIMIT - lots.length + 1 }, (_, i) => lot(`z${i}`, 0));
  const best = planGrab({ members, lots: [...lots, ...filler], paceWith: flat });
  assert.equal(best.leftover.length, 1);
  assert.equal(best.leftover[0].lotId.startsWith("l3"), true);
});

t("a worst-fit re-pack evens the loads without slowing the pace", () => {
  const members = [member("a", 100), member("b", 100), member("c", 100)];
  const lots = [lot("w", 10), lot("x", 10), lot("y", 10), lot("z", 10), lot("v", 10), lot("u", 10)];
  const plan = planGrab({ members, lots, paceWith: flat });
  assert.deepEqual(Object.values(loadsOf(plan, lots)), [20, 20, 20], "best fit alone would stack them on one member");

  const stepsMembers = [member("a", 100), member("b", 100)];
  const paced = planGrab({ members: stepsMembers, lots: [lot("x", 12), lot("y", 12), lot("z", 12)], paceWith: stepped(stepsMembers, 37) });
  assert.equal(paced.pace, 0);
  assert.deepEqual(Object.values(loadsOf(paced, [lot("x", 12), lot("y", 12), lot("z", 12)])).sort(), [12, 24]);
});

t("ranks may be negative: the provider's are the negative of a speed", () => {
  const members = [member("a", 100), member("b", 100)];
  const paceWith = (id, w) => -(w < 37 ? 113 : w < 74 ? 71 : 29);
  const plan = planGrab({ members, lots: [lot("x", 30), lot("y", 30)], paceWith });
  assert.equal(plan.pace, -113, "one lot each stays on the fastest step");
  assert.deepEqual(plan.assignments.map((a) => a.memberId).sort(), ["a", "b"]);
  const three = planGrab({ members, lots: [lot("x", 30), lot("y", 30), lot("z", 30)], paceWith });
  assert.equal(three.pace, -71);
  assert.deepEqual(three.leftover, []);
});

t("a load at which paceWith gives no figure is never taken, whatever the sign of the ranks", () => {
  const members = [member("a", 100)];
  for (const sign of [1, -1]) {
    const paceWith = (id, w) => (w > 50 ? null : sign * Math.floor(w / 37));
    const plan = planGrab({ members, lots: [lot("x", 30), lot("y", 30)], paceWith });
    assert.deepEqual(plan.assignments, [{ lotId: "x", memberId: "a" }], `sign ${sign}`);
    assert.deepEqual(plan.leftover, [{ lotId: "y" }]);
  }
});

t("capacity is never exceeded, nothing is placed twice, and coin is conserved", () => {
  let seed = 7;
  const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (let run = 0; run < 60; run++) {
    const members = Array.from({ length: 1 + Math.floor(rand() * 4) }, (_, i) => member(`m${i}`, Math.floor(rand() * 60), Math.floor(rand() * 20)));
    const lots = Array.from({ length: Math.floor(rand() * 16) }, (_, i) => (rand() < 0.3
      ? coinLot(`c${i}`, 1 + Math.floor(rand() * 200), 1 + Math.floor(rand() * 90))
      : lot(`l${i}`, Math.floor(rand() * 40))));
    const sizes = Object.fromEntries(members.map((m, i) => [m.id, 20 + i * 11]));
    const paceWith = stepped(members, sizes);
    const plan = planGrab({ members, lots, paceWith });
    const loads = loadsOf(plan, lots);
    for (const m of members) {
      assert.ok((loads[m.id] ?? 0) <= m.capacity6 - m.load6 + 1e-6, `run ${run}: ${m.id} within capacity`);
    }
    for (const l of lots) {
      const placed = plan.assignments.filter((a) => a.lotId === l.id);
      const left = plan.leftover.find((x) => x.lotId === l.id);
      if (l.coin) {
        assert.equal(placed.reduce((n, a) => n + a.count, 0) + (left?.count ?? 0), l.coin.count, `run ${run}: ${l.id} conserved`);
      } else {
        assert.equal(placed.length + (left ? 1 : 0), 1, `run ${run}: ${l.id} once`);
      }
    }
    const recomputed = plan.pace === null ? null : Math.max(...members.map((m) => paceWith(m.id, loads[m.id] ?? 0)));
    assert.equal(plan.pace, recomputed, `run ${run}: the pace is read off the final loads`);
    assert.deepEqual(planGrab({ members, lots, paceWith }), plan, `run ${run}: equal input, equal plan`);
  }
});

console.log(`\n${checks.length} checks passed`);
