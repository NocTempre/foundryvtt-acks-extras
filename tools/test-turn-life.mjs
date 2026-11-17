/**
 * The tracker's turn hooks and the records it lifts by turn count
 * (`lib/turn-life.mjs`, and `lib/status-effects.mjs`'s handling of a turn).
 *
 * The pure half is checked on its own: a record's step at each turn event and
 * which edges a change of the tracker crosses. The tracker's half runs the
 * installed hooks over mock combats: one `turnBegan` and one `turnEnded` per
 * real turn, none on a re-sort or a step back, a round that opens before its
 * initiative is rolled, an end edge and a start edge each lifting where they
 * should, another fight's records left alone, and nothing on a client that is
 * not the primary GM.
 */
import assert from "node:assert/strict";
import { MODULE_ID, FLAG_TURN_LIFE, TURN_BEGAN_HOOK, TURN_ENDED_HOOK } from "../scripts/lib/constants.mjs";
import { readTurnLife, turnLifeStep, turnEdges, TURN_LIFE_EDGES } from "../scripts/lib/turn-life.mjs";

let passed = 0;
const ok = (message) => {
  passed++;
  console.log(`ok   ${message}`);
};

/* --- the pure half: a record's step ----------------------------------------- */

{
  const life = (over = {}) => ({ combatId: "f", combatantId: "c", edge: "start", count: 2, seen: 0, ...over });
  assert.deepEqual(TURN_LIFE_EDGES, ["start", "end"]);
  assert.equal(readTurnLife(null), null);
  assert.equal(readTurnLife("turns"), null);
  assert.equal(readTurnLife(life({ edge: "middle" })), null, "an edge that is neither start nor end is no record");
  assert.equal(readTurnLife(life({ count: 0 })), null, "a count under one is no record");
  assert.equal(readTurnLife(life({ count: "two" })), null);
  assert.equal(readTurnLife(life({ combatId: "" })), null);
  assert.equal(readTurnLife(life({ combatantId: undefined })), null);
  assert.deepEqual(readTurnLife(life({ seen: undefined, count: 2.9 })), life({ seen: 0, count: 2 }), "a count is whole and a missing seen is none");
  assert.deepEqual(readTurnLife(life({ seen: -3 })), life({ seen: 0 }));

  const began = { kind: "began", combatId: "f", combatantId: "c" };
  const ended = { kind: "ended", combatId: "f", combatantId: "c" };
  assert.deepEqual(turnLifeStep(life(), began), { seen: 1, lift: false }, "a turn begun counts");
  assert.deepEqual(turnLifeStep(life({ seen: 1 }), began), { seen: 2, lift: true }, "a start record lifts at the turn that reaches its count");
  assert.deepEqual(turnLifeStep(life({ seen: 5, count: 2 }), began), { seen: 6, lift: true }, "past its count it still lifts");
  assert.deepEqual(turnLifeStep(life({ seen: 1 }), ended), { seen: 1, lift: false }, "a start record never lifts at an end");
  assert.deepEqual(turnLifeStep(life({ edge: "end", count: 1 }), began), { seen: 1, lift: false }, "an end record counts the turn and waits for its end");
  assert.deepEqual(turnLifeStep(life({ edge: "end", count: 1 }), ended), { seen: 0, lift: false }, "a turn that did not begin after the record does not end it");
  assert.deepEqual(turnLifeStep(life({ edge: "end", count: 2, seen: 1 }), ended), { seen: 1, lift: false }, "short of its count");
  assert.deepEqual(turnLifeStep(life({ edge: "end", count: 2, seen: 2 }), ended), { seen: 2, lift: true }, "at its count the end lifts it");
  assert.deepEqual(turnLifeStep(life(), { ...began, combatId: "other" }), { seen: 0, lift: false }, "another fight's event is not this record's");
  assert.deepEqual(turnLifeStep(life(), { ...began, combatantId: "d" }), { seen: 0, lift: false }, "nor another combatant's");
  assert.deepEqual(turnLifeStep(life(), { ...began, kind: "paused" }), { seen: 0, lift: false });
  assert.deepEqual(turnLifeStep({ edge: "start" }, began), { seen: 0, lift: false }, "a malformed flag lifts nothing and counts nothing");
  ok("a record's step: the start edge lifts at its count, the end edge at the end of a counted turn");

  const edges = (prior, current, state) => turnEdges(prior, current, state);
  const at = (round, turn, combatantId) => ({ round, turn, combatantId });
  assert.deepEqual(edges(at(1, 0, "a"), at(1, 1, "b")), { ended: "a", began: true }, "a turn moving forward");
  assert.deepEqual(edges(at(1, 2, "c"), at(2, 0, "a")), { ended: "c", began: true }, "a round advance");
  assert.deepEqual(edges(at(1, 1, "b"), at(1, 0, "a")), { ended: null, began: false }, "a step back");
  assert.deepEqual(edges(at(1, 0, "a"), at(1, 1, "a")), { ended: null, began: false }, "the same combatant's place moving");
  assert.deepEqual(edges(at(2, 0, "a"), at(1, 2, "c")), { ended: null, began: false }, "a step back across a round");
  assert.deepEqual(edges({ round: 0, turn: 0 }, at(1, 0, "a")), { ended: null, began: true }, "a fight's start leaves no turn");
  assert.deepEqual(edges(at(2, 0, "a"), at(3, 0, "a"), { unrolled: 2 }), { ended: null, began: true }, "leaving a round that never began ends no turn");
  assert.deepEqual(edges(at(2, 0, "a"), at(3, 0, "a"), { unrolled: 3 }), { ended: "a", began: true }, "another round's flag does not hold it");
  assert.deepEqual(edges(null, at(1, 0, "a")), { ended: null, began: false });
  ok("which turn edges a change of the tracker crosses");
}

/* --- the tracker's half ------------------------------------------------------- */

const { installConditionRolls } = await import("../scripts/lib/status-effects.mjs");

const log = [];
const hooks = {};
const fire = (name, ...args) => (hooks[name] ?? []).forEach((fn) => fn(...args));
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

class FakeActor {
  constructor(name) {
    this.name = name;
    this.uuid = `Actor.${name}`;
    this.statuses = new Set();
    this.effects = [];
    this.system = {};
  }
  async toggleStatusEffect() {}
  rollSave() {}
  _calculateMovement() {}
  /** What core's embedded delete does to an actor's effects, and what it logs. */
  async deleteEmbeddedDocuments(type, ids) {
    assert.equal(type, "ActiveEffect");
    for (const id of ids) {
      const at = this.effects.findIndex((e) => e.id === id);
      assert.ok(at >= 0, `${id} is on ${this.name}`);
      this.effects.splice(at, 1);
      log.push(`delete ${id}`);
    }
  }
}

/** A record on `actor`: an Active Effect carrying a `turnLife` flag, which logs the writes made to it. */
function record(actor, id, life) {
  const effect = {
    id,
    uuid: `${actor.uuid}.ActiveEffect.${id}`,
    flags: { [MODULE_ID]: { [FLAG_TURN_LIFE]: { seen: 0, ...life } } },
    async setFlag(scope, key, value) {
      this.flags[scope][key] = value;
      log.push(`seen ${id} ${value.seen}`);
    },
  };
  actor.effects.push(effect);
  return effect;
}

/** A mock fight whose members stand in turn order; the tracker starts before round 1. */
function fight(id, members) {
  const list = members.map((m) => ({ ...m }));
  const combat = { id, round: 0, turn: 0, combatant: null, combatants: Object.assign(list, { get: (cid) => list.find((c) => c.id === cid) }) };
  for (const c of list) c.combat = combat;
  return combat;
}

/** The tracker moves to `round`, `turn`, on `who` (by default the member standing there), as core's hook reports it. */
async function move(combat, round, turn, who = combat.combatants[turn]) {
  const prior = { round: combat.round, turn: combat.turn, combatantId: combat.combatant?.id };
  Object.assign(combat, { round, turn, combatant: who });
  fire("combatTurnChange", combat, prior, { round, turn, combatantId: who.id });
  await tick();
}

/** An initiative is rolled; the tracker stays on whoever it was on, at `turn`. */
async function roll(combat, who, initiative, turn = combat.turn) {
  who.initiative = initiative;
  combat.turn = turn;
  fire("updateCombatant", who, { initiative });
  await tick();
}

const seen = () => log.splice(0, log.length);
const trio = (combatId = "bout") => {
  const actors = ["a1", "a2", "a3"].map((name) => new FakeActor(name));
  const combat = fight(combatId, [
    { id: "c1", actor: actors[0], initiative: 9 },
    { id: "c2", actor: actors[1], initiative: 6 },
    { id: "c3", actor: actors[2], initiative: 3 },
  ]);
  return { combat, actors };
};

const was = { CONFIG: globalThis.CONFIG, Hooks: globalThis.Hooks, ui: globalThis.ui, game: globalThis.game };
globalThis.CONFIG = { Actor: { documentClass: FakeActor } };
globalThis.Hooks = {
  on: (name, fn) => void (hooks[name] ??= []).push(fn),
  callAll: (name, ...args) => fire(name, ...args),
};
globalThis.ui = { notifications: { info() {}, warn() {} } };
globalThis.game = {
  i18n: { localize: (k) => k, format: (k) => k },
  user: { id: "me" },
  users: { activeGM: { isSelf: true } },
  combat: null,
};

try {
  installConditionRolls();
  const named = (name) => (combat, combatantId) => {
    assert.ok(combat?.id, "a hook is handed its fight");
    log.push(`${name} ${combatantId}`);
  };
  Hooks.on(TURN_BEGAN_HOOK, named("began"));
  Hooks.on(TURN_ENDED_HOOK, named("ended"));

  // One of each per real turn, in order; the records count and lift at their edges.
  {
    const { combat, actors } = trio();
    const [a1, a2] = actors;
    await move(combat, 1, 0);
    assert.deepEqual(seen(), ["began c1"], "a fight's start begins a turn and ends none");
    // Written during c1's own turn, and a start record that waits for c2's second turn.
    record(a2, "endMine", { combatId: "bout", combatantId: "c1", edge: "end", count: 1 });
    record(a1, "startTwo", { combatId: "bout", combatantId: "c2", edge: "start", count: 2 });
    await move(combat, 1, 1);
    assert.deepEqual(seen(), ["ended c1", "seen startTwo 1", "began c2"], "the turn ends before the next begins; the end record, cast in c1's own turn, outlives it");
    assert.equal(a2.effects.length, 1);
    await move(combat, 1, 2);
    assert.deepEqual(seen(), ["ended c2", "began c3"]);
    await move(combat, 2, 0);
    assert.deepEqual(seen(), ["ended c3", "seen endMine 1", "began c1"], "a round advance ends the last turn, and c1's next turn counts for the end record");
    await move(combat, 2, 1);
    assert.deepEqual(seen(), ["delete endMine", "ended c1", "delete startTwo", "began c2"], "the end record goes at c1's end; the start record before the hook of c2's second turn");
    assert.deepEqual([a1.effects.length, a2.effects.length], [0, 0]);

    await move(combat, 2, 0);
    assert.deepEqual(seen(), [], "stepping back is no turn");
    await move(combat, 2, 1, combat.combatants[0]);
    assert.deepEqual(seen(), [], "the same combatant's place in the order moving is no turn");
    ok("one turnBegan and one turnEnded per real turn; the end and start edges lift where they should");
  }

  // The system clears initiative as a round opens: the last combatant's turn still ends there, and no turn begins until the roll.
  {
    const { combat, actors } = trio("reset");
    const [a1] = actors;
    await move(combat, 1, 0);
    await move(combat, 1, 1);
    await move(combat, 1, 2);
    record(a1, "lastEnd", { combatId: "reset", combatantId: "c3", edge: "end", count: 1, seen: 1 });
    seen();
    for (const c of combat.combatants) c.initiative = null;
    await move(combat, 2, 0);
    assert.deepEqual(seen(), ["delete lastEnd", "ended c3"], "the round advance ends c3's turn and begins none");
    assert.equal(a1.effects.length, 0);

    // Rolled one at a time: the tracker follows the first so far, and none of that is a turn.
    await roll(combat, combat.combatants[1], 4, 0);
    await move(combat, 2, 0, combat.combatants[1]);
    await roll(combat, combat.combatants[2], 2, 0);
    assert.deepEqual(seen(), [], "a roll and the tracker following it begin nothing while a combatant has yet to roll");
    await roll(combat, combat.combatants[0], 6, 1);
    assert.deepEqual(seen(), [], "all rolled, with the tracker not yet on the round's first");
    await move(combat, 2, 0, combat.combatants[0]);
    assert.deepEqual(seen(), ["began c1"], "the round's first turn begins once, when the tracker reaches it");
    await move(combat, 2, 1);
    assert.deepEqual(seen(), ["ended c1", "began c2"]);

    // The last roll lands with the tracker already on the first: no change follows, and the turn begins on the roll.
    const { combat: other } = trio("late");
    await move(other, 1, 0);
    await move(other, 1, 1);
    await move(other, 1, 2);
    seen();
    for (const c of other.combatants) c.initiative = null;
    await move(other, 2, 0);
    seen();
    await roll(other, other.combatants[2], 2, 0);
    await roll(other, other.combatants[1], 3, 0);
    assert.deepEqual(seen(), []);
    await roll(other, other.combatants[0], 9, 0);
    assert.deepEqual(seen(), ["began c1"], "begun by the roll, once");

    // A round that is advanced again without being rolled has no turn to end.
    const { combat: skipped } = trio("skipped");
    await move(skipped, 1, 0);
    await move(skipped, 1, 1);
    await move(skipped, 1, 2);
    seen();
    for (const c of skipped.combatants) c.initiative = null;
    await move(skipped, 2, 0);
    assert.deepEqual(seen(), ["ended c3"]);
    await move(skipped, 3, 0);
    assert.deepEqual(seen(), [], "the round that never began ends no turn");
    ok("a round that opens before its initiative is rolled ends the last turn, begins none, and begins its first when rolled");
  }

  // The Judge moves on without the roll: the turn the tracker passes over begins and ends as it is passed.
  {
    const { combat, actors } = trio("hand");
    const [, a2] = actors;
    await move(combat, 1, 0);
    await move(combat, 1, 1);
    await move(combat, 1, 2);
    for (const c of combat.combatants) c.initiative = null;
    await move(combat, 2, 0);
    seen();
    record(a2, "passedStart", { combatId: "hand", combatantId: "c1", edge: "start", count: 1 });
    await move(combat, 2, 1);
    assert.deepEqual(seen(), ["delete passedStart", "began c1", "ended c1", "began c2"], "the passed turn lifts its start record, then begins and ends, before the next begins");
    ok("a turn passed over by hand in an unrolled round begins and ends once");
  }

  // Records are their own fight's, and one actor behind two combatants is stepped once.
  {
    const { combat, actors } = trio("mine");
    const [a1, a2] = actors;
    await move(combat, 1, 0);
    record(a1, "foreign", { combatId: "elsewhere", combatantId: "c2", edge: "start", count: 1 });
    record(a1, "foreignEnd", { combatId: "elsewhere", combatantId: "c1", edge: "end", count: 1, seen: 1 });
    record(a1, "unreadable", { combatId: "mine", combatantId: "c2", edge: "start", count: 0 });
    a2.effects.push({ id: "plain", uuid: "Actor.a2.ActiveEffect.plain" }, { id: "flagless", flags: {} });
    seen();
    await move(combat, 1, 1);
    await move(combat, 1, 2);
    await move(combat, 2, 0);
    assert.deepEqual(seen(), ["ended c1", "began c2", "ended c2", "began c3", "ended c3", "began c1"], "no record of another fight, no unreadable flag and no plain effect is written");
    assert.deepEqual(a1.effects.map((e) => e.flags[MODULE_ID][FLAG_TURN_LIFE].seen), [0, 1, 0], "the other fight's counts are as they were");

    const shared = new FakeActor("shared");
    const twin = fight("twin", [
      { id: "t1", actor: shared, initiative: 8 },
      { id: "t1b", actor: shared, initiative: 5 },
      { id: "t2", actor: new FakeActor("other"), initiative: 2 },
    ]);
    record(shared, "once", { combatId: "twin", combatantId: "t1", edge: "start", count: 3 });
    await move(twin, 1, 0);
    assert.deepEqual(seen(), ["seen once 1", "began t1"], "one write for one record, with two combatants on its actor");
    ok("another fight's records, unreadable flags and plain effects are left alone; a shared actor's record is written once");
  }

  // A deleted fight leaves its records for their flag clock.
  {
    const { combat, actors } = trio("gone");
    await move(combat, 1, 0);
    record(actors[1], "left", { combatId: "gone", combatantId: "c1", edge: "end", count: 1 });
    seen();
    fire("deleteCombat", combat);
    await tick();
    assert.deepEqual(seen(), []);
    assert.equal(actors[1].effects.length, 1, "the record stays where it is");
    ok("a deleted fight's records are left");
  }

  // A listener that throws costs itself only.
  {
    const quiet = console.error;
    const errors = [];
    console.error = (...args) => errors.push(args);
    const boom = () => {
      throw new Error("listener");
    };
    hooks[TURN_BEGAN_HOOK].push(boom);
    try {
      const { combat, actors } = trio("boom");
      await move(combat, 1, 0);
      assert.deepEqual(seen(), ["began c1"], "the listener ahead of the one that throws ran");
      record(actors[1], "survivor", { combatId: "boom", combatantId: "c2", edge: "start", count: 1 });
      await move(combat, 1, 1);
      assert.deepEqual(seen(), ["ended c1", "delete survivor", "began c2"], "the record is lifted before the hook, and the move completes");
      assert.equal(actors[1].effects.length, 0);
      assert.equal(errors.length, 2, "each failure is logged");
    } finally {
      hooks[TURN_BEGAN_HOOK].pop();
      console.error = quiet;
      seen();
    }
    ok("a listener that throws is logged and the tracker carries on");
  }

  // Only the primary GM's client runs any of it.
  {
    const { combat, actors } = trio("seat");
    await move(combat, 1, 0);
    record(actors[1], "seatRec", { combatId: "seat", combatantId: "c2", edge: "start", count: 1 });
    seen();
    globalThis.game.users.activeGM = { isSelf: false };
    try {
      await move(combat, 1, 1);
      await move(combat, 2, 0);
      for (const c of combat.combatants) c.initiative = null;
      await move(combat, 3, 0);
      await roll(combat, combat.combatants[1], 5, 0);
      assert.deepEqual(seen(), [], "no hook fires on a client that is not the primary GM's");
      assert.equal(actors[1].effects.length, 1, "and no record is touched");
    } finally {
      globalThis.game.users.activeGM = { isSelf: true };
    }
    ok("no hook fires and no record is lifted on a client that is not the primary GM");
  }
} finally {
  Object.assign(globalThis, was);
}

console.log(`\n${passed} turn-life checks passed.`);
