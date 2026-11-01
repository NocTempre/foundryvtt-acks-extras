/**
 * Offline tests for a stack's move between groups (scripts/lib/group.mjs,
 * `moveStack`, and its decisions in scripts/lib/group-logic.mjs): what crosses,
 * what it joins, who is refused, and what two writes leave behind when one fails.
 * Every creature, count and hit point in here is invented.
 *
 * Run: node tools/test-group-move.mjs
 */
import assert from "node:assert/strict";

/* -------------------------------------------- */
/*  Foundry mock                                */
/* -------------------------------------------- */

let nextId = 0;
const uid = (p) => `${p}${(++nextId).toString().padStart(4, "0")}`;

globalThis.Hooks = { on() {}, call: () => true, callAll() {} };
globalThis.foundry = {
  abstract: { TypeDataModel: class {} },
  data: { fields: new Proxy({}, { get: () => class {} }) },
  utils: {
    deepClone: (v) => structuredClone(v),
    getProperty: (o, p) => p.split(".").reduce((a, k) => a?.[k], o),
    randomID: () => uid("rnd"),
  },
};

const docs = new Map();
globalThis.game = { scenes: [], users: { activeGM: { isSelf: true } }, i18n: { localize: (k) => k } };
globalThis.fromUuid = async (uuid) => docs.get(uuid) ?? null;
globalThis.fromUuidSync = (uuid) => docs.get(uuid) ?? null;

const MODULE_ID = "acks-extras";

const { default: GroupData } = await import("../scripts/lib/data/group-data.mjs");
const { moveStack, moveRefusal } = await import("../scripts/lib/group.mjs");
const { matchingStack, mergeStack, receiveStack } = await import("../scripts/lib/group-logic.mjs");
const { countOrigin, stackHeld } = await import("../scripts/lib/group-encounter-logic.mjs");

/** The order documents were written in, across every group of a test. */
let writes = [];

/** A group holding the stacks given, an Owner's unless told otherwise. */
function groupActor(name, stacks, { isOwner = true, isToken = false, compendium, refuse = false } = {}) {
  const id = uid("act");
  const system = Object.assign(Object.create(GroupData.prototype), {
    stacks: structuredClone(stacks),
    toObject() {
      return { stacks: structuredClone(this.stacks) };
    },
  });
  const actor = {
    id,
    name,
    uuid: `Actor.${id}`,
    type: `${MODULE_ID}.group`,
    isOwner,
    isToken,
    compendium,
    system,
    refuse,
    mirrored: null,
    async update(changes) {
      if (this.refuse) throw new Error(`${name} refused the write`);
      writes.push(name);
      const { "system.stacks": next, ...mirror } = changes;
      if (next) system.stacks = structuredClone(next);
      if (Object.keys(mirror).length) this.mirrored = mirror;
    },
  };
  docs.set(actor.uuid, actor);
  return actor;
}

const stackOf = (key, uuid, current, initial = current, more = {}) => ({
  key,
  template: { uuid, type: "monster", label: "QA Knot", snapshot: { system: { hp: { hd: "1d3", value: 2, max: 2 } } } },
  size: { current, initial, formula: "1d3" },
  rolled: { total: null, state: "", context: "", noun: "" },
  mounted: false,
  baseMorale: 0,
  roster: [],
  ...more,
});

const record = (key, ordinal, state = "materialized", more = {}) => ({
  key,
  ordinal,
  name: "",
  delta: { system: { hp: { value: ordinal, max: 9 } } },
  state,
  tokenUuid: "",
  actorUuid: "",
  note: "",
  ...more,
});

const keys = (stack) => stack.roster.map((m) => m.key);

/* -------------------------------------------- */
/*  Scenarios                                   */
/* -------------------------------------------- */

const tests = [];
const t = (name, fn) => tests.push([name, fn]);

t("the same base matches; a shared label and a missing base do not", () => {
  const here = [stackOf("a", "Actor.other", 1), stackOf("b", "Actor.base", 1)];
  assert.equal(matchingStack(here, stackOf("c", "Actor.base", 1)), here[1]);
  assert.equal(matchingStack(here, stackOf("c", "Actor.third", 1)), null, "every stack here reads QA Knot");
  assert.equal(matchingStack([stackOf("a", null, 1)], stackOf("c", null, 1)), null);
});

t("a merge gives each record the next number in its own order, and takes nothing else from it", () => {
  const into = stackOf("a", "Actor.base", 3, 3, { roster: [record("m1", 1), record("m2", 7)] });
  const crossing = stackOf("b", "Actor.base", 2, 2, {
    roster: [record("x3", 3, "dead", { note: "gone" }), record("x1", 1, "materialized", { name: "Named" })],
  });
  mergeStack(into, crossing);
  assert.deepEqual(into.roster.map((m) => [m.key, m.ordinal]), [["m1", 1], ["m2", 7], ["x1", 8], ["x3", 9]]);
  const [named, fallen] = into.roster.slice(2);
  assert.equal(named.name, "Named");
  assert.deepEqual(named.delta, crossing.roster[1].delta);
  assert.equal(fallen.state, "dead");
  assert.equal(fallen.note, "gone");
  assert.equal(crossing.roster[0].ordinal, 3, "the source's plain copy is left as it was");
});

t("a merge adds both counts, so bodies that fell stay counted as fallen", () => {
  const into = stackOf("a", "Actor.base", 4, 5);
  mergeStack(into, stackOf("b", "Actor.base", 3, 6));
  assert.deepEqual([into.size.current, into.size.initial], [7, 11]);
  assert.equal(stackHeld(into), true);
});

t("a roll stays with the stack it sized, and an empty stack takes the one that fills it", () => {
  const rolled = { total: 3, state: "lair", context: "dungeon", noun: "knot" };
  const sized = stackOf("a", "Actor.base", 3, 3, { rolled, size: { current: 3, initial: 3, formula: "1d4" } });
  const empty = stackOf("b", "Actor.base", 0, 0, { size: { current: 0, initial: 0, formula: "9d9" } });
  mergeStack(empty, sized);
  assert.deepEqual(empty.rolled, rolled);
  assert.equal(empty.size.formula, "1d4", "the tooltip reads the formula the roll threw");
  assert.equal(countOrigin(empty).kind, "rolled");

  const hand = stackOf("c", "Actor.base", 2);
  mergeStack(hand, sized);
  assert.equal(hand.rolled.total, null, "a count a hand set stays a hand's");
  assert.equal(countOrigin(hand).kind, "hand");

  const other = stackOf("d", "Actor.base", 3, 3, { rolled: { total: 3, state: "wandering", context: "wilderness", noun: "" } });
  mergeStack(other, stackOf("e", "Actor.base", 2));
  assert.equal(other.rolled.state, "wandering");
  assert.equal(countOrigin(other).kind, "edited");
});

t("a stack with no match stands whole under a new key", () => {
  const stacks = [stackOf("a", "Actor.other", 1)];
  const crossing = stackOf("b", "Actor.base", 2, 3, { mounted: true, baseMorale: 2, roster: [record("x4", 4)] });
  const { stack, merged } = receiveStack(stacks, crossing, "fresh");
  assert.equal(merged, false);
  assert.equal(stack.key, "fresh");
  assert.equal(stacks.length, 2);
  assert.deepEqual({ ...stack, key: "b" }, crossing);
});

t("the whole row crosses: pristine, resting, fallen and detached, and the source row goes", async () => {
  const roster = [record("m1", 1), record("m2", 2, "dead"), record("m3", 3, "detached", { actorUuid: "Actor.left" })];
  const rolled = { total: 6, state: "lair", context: "wilderness", noun: "knot" };
  const from = groupActor("Source", [stackOf("s", "Actor.base", 4, 6, { rolled, mounted: true, baseMorale: 1, roster })]);
  const to = groupActor("Target", [stackOf("t", "Actor.other", 2)]);
  const result = await moveStack(from, to, "s");
  assert.equal(result.ok, true);
  assert.equal(result.merged, false);
  assert.equal(result.name, "QA Knot");
  assert.deepEqual(from.system.stacks, []);
  const landed = to.system.stackOf(result.into);
  assert.notEqual(result.into, "s");
  assert.deepEqual(keys(landed), ["m1", "m2", "m3"]);
  assert.deepEqual(landed.rolled, rolled);
  assert.deepEqual([landed.mounted, landed.baseMorale], [true, 1]);
  assert.equal(landed.roster[2].actorUuid, "Actor.left");
  assert.equal(landed.roster[0].delta.system.hp.value, 1);
  assert.deepEqual([to.system.totalCurrent, to.system.totalPristine, to.system.totalDead], [6, 5, 1]);
  assert.equal(to.system.invariantHolds, true);
});

t("a row joins the stack over the same base, and both sheets' totals hold", async () => {
  const from = groupActor("Source", [
    stackOf("s", "Actor.base", 3, 3, { roster: [record("m1", 1)] }),
    stackOf("k", "Actor.kept", 2),
  ]);
  const to = groupActor("Target", [stackOf("t", "Actor.base", 5, 5, { roster: [record("n1", 1), record("n2", 2)] })]);
  const before = from.system.totalCurrent + to.system.totalCurrent;
  const result = await moveStack(from, to, "s");
  assert.deepEqual([result.ok, result.merged, result.into], [true, true, "t"]);
  assert.equal(to.system.stacks.length, 1);
  assert.deepEqual([to.system.totalCurrent, to.system.totalPristine], [8, 5]);
  assert.deepEqual(to.system.stacks[0].roster.map((m) => m.ordinal), [1, 2, 3]);
  assert.deepEqual(from.system.stacks.map((s) => s.key), ["k"]);
  assert.equal(from.system.totalCurrent + to.system.totalCurrent, before);
  assert.equal(from.system.invariantHolds && to.system.invariantHolds, true);
});

t("a body on the map refuses the whole row and nothing is written", async () => {
  docs.set("Scene.a.Token.out", { documentName: "Token" });
  const roster = [record("m1", 1), record("m2", 2, "deployed", { tokenUuid: "Scene.a.Token.out" }), record("m3", 3, "deployed", { tokenUuid: "Scene.a.Token.out" })];
  const from = groupActor("Source", [stackOf("s", "Actor.base", 9, 9, { roster })]);
  const to = groupActor("Target", []);
  writes = [];
  const result = await moveStack(from, to, "s");
  assert.deepEqual(result, { ok: false, reason: "deployed", name: "QA Knot", n: 2 });
  assert.deepEqual(writes, []);
  assert.equal(from.system.stacks[0].size.current, 9);
});

t("a resting record, a fallen one and a detached one refuse nothing, where the Roll's stackHeld would", async () => {
  const stack = stackOf("s", "Actor.base", 2, 4, { roster: [record("m1", 1), record("m2", 2, "dead"), record("m3", 3, "detached")] });
  assert.equal(stackHeld(stack), true);
  assert.equal((await moveStack(groupActor("Source", [stack]), groupActor("Target", []), "s")).ok, true);
});

t("a record whose token is gone crosses at rest", async () => {
  const roster = [record("m1", 1, "deployed", { tokenUuid: "Scene.a.Token.gone" })];
  const to = groupActor("Target", []);
  const result = await moveStack(groupActor("Source", [stackOf("s", "Actor.base", 1, 1, { roster })]), to, "s");
  assert.equal(result.ok, true);
  const [body] = to.system.stackOf(result.into).roster;
  assert.deepEqual([body.state, body.tokenUuid], ["materialized", ""]);
});

t("a seat refused either side is told which, nothing is written, and the map is not its business", async () => {
  docs.set("Scene.a.Token.out", { documentName: "Token" });
  const stacks = [stackOf("s", "Actor.base", 1, 1, { roster: [record("m1", 1, "deployed", { tokenUuid: "Scene.a.Token.out" })] })];
  writes = [];
  const fromShut = await moveStack(groupActor("Theirs", stacks, { isOwner: false }), groupActor("Mine", []), "s");
  assert.deepEqual(fromShut, { ok: false, reason: "notOwner", name: "Theirs" });
  const toShut = await moveStack(groupActor("Mine", stacks), groupActor("Theirs", [], { isOwner: false }), "s");
  assert.deepEqual(toShut, { ok: false, reason: "notOwner", name: "Theirs" });
  const locked = await moveStack(groupActor("Mine", stacks), groupActor("Shelf", [], { compendium: { locked: true } }), "s");
  assert.deepEqual(locked, { ok: false, reason: "notOwner", name: "Shelf" });
  assert.deepEqual(writes, []);
});

t("an unlocked compendium is no refusal", () => {
  const from = groupActor("Mine", []);
  const to = groupActor("Shelf", [], { compendium: { locked: false } });
  assert.equal(moveRefusal(from, to, stackOf("s", "Actor.base", 1)), null);
});

t("a token's own copy on either side refuses", async () => {
  const stacks = [stackOf("s", "Actor.base", 1)];
  const copy = await moveStack(groupActor("Copy", stacks, { isToken: true }), groupActor("Target", []), "s");
  assert.deepEqual(copy, { ok: false, reason: "unlinked" });
  const into = await moveStack(groupActor("Source", stacks), groupActor("Copy", [], { isToken: true }), "s");
  assert.deepEqual(into, { ok: false, reason: "unlinked" });
});

t("a row that already left, a group that is gone and a group's own row are refused", async () => {
  const from = groupActor("Source", [stackOf("s", "Actor.base", 2)]);
  const to = groupActor("Target", []);
  assert.equal((await moveStack(from, to, "s")).ok, true);
  assert.deepEqual(await moveStack(from, to, "s"), { ok: false, reason: "gone" });
  assert.deepEqual(await moveStack(null, to, "s"), { ok: false, reason: "gone" });
  const own = groupActor("Own", [stackOf("o", "Actor.base", 2)]);
  assert.deepEqual(await moveStack(own, own, "o"), { ok: false, reason: "same" });
  assert.equal(own.system.stacks.length, 1);
});

t("the target is written first, so bodies between the writes stand twice and never nowhere", async () => {
  const from = groupActor("Source", [stackOf("s", "Actor.base", 2)]);
  const to = groupActor("Target", []);
  writes = [];
  await moveStack(from, to, "s");
  assert.deepEqual(writes, ["Target", "Source"]);
});

t("a target that refuses the write leaves the source alone", async () => {
  const from = groupActor("Source", [stackOf("s", "Actor.base", 2)]);
  const to = groupActor("Target", [], { refuse: true });
  writes = [];
  assert.deepEqual(await moveStack(from, to, "s"), { ok: false, reason: "failed" });
  assert.deepEqual(writes, []);
  assert.equal(from.system.stacks.length, 1);
});

t("a source that refuses the write takes the target back to what it held", async () => {
  const from = groupActor("Source", [stackOf("s", "Actor.base", 2, 2, { roster: [record("m1", 1)] })], { refuse: true });
  const to = groupActor("Target", [stackOf("t", "Actor.base", 5, 5, { roster: [record("n1", 1)] })]);
  const held = structuredClone(to.system.stacks);
  assert.deepEqual(await moveStack(from, to, "s"), { ok: false, reason: "failed" });
  assert.deepEqual(to.system.stacks, held);
  assert.equal(from.system.stacks.length, 1);
});

t("a group's first stack seeds its representative block, and a later one does not", async () => {
  const empty = groupActor("Target", []);
  await moveStack(groupActor("Source", [stackOf("s", "Actor.base", 2)]), empty, "s");
  assert.equal(empty.mirrored?.["system.hp"]?.hd, "1d3");

  const held = groupActor("Target", [stackOf("t", "Actor.other", 1)]);
  await moveStack(groupActor("Source", [stackOf("s", "Actor.base", 2)]), held, "s");
  assert.equal(held.mirrored, null);
});

t("a group losing its first stack reseeds from the next, and losing another does not", async () => {
  const next = stackOf("n", "Actor.next", 1);
  next.template.snapshot.system.hp.hd = "2d3";
  const lead = groupActor("Source", [stackOf("s", "Actor.base", 2), next]);
  await moveStack(lead, groupActor("Target", []), "s");
  assert.equal(lead.mirrored?.["system.hp"]?.hd, "2d3");

  const tail = groupActor("Source", [next, stackOf("s", "Actor.base", 2)]);
  await moveStack(tail, groupActor("Target", []), "s");
  assert.equal(tail.mirrored, null);

  const alone = groupActor("Source", [stackOf("s", "Actor.base", 2)]);
  await moveStack(alone, groupActor("Target", []), "s");
  assert.equal(alone.mirrored, null, "an emptied group keeps what it showed");
});

let failures = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`ok    ${name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL  ${name}\n      ${err.message}`);
  }
}
console.log(`\ntest-group-move: ${tests.length - failures}/${tests.length} passed`);
if (failures) process.exit(1);
