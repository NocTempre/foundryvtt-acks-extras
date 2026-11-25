/**
 * Delayed damage (`scripts/lib/delayed-damage.mjs`): a record on the struck
 * creature's effect that lands its amount a count of the bearer's turns later.
 *
 * Every figure, name and page below is INVENTED: the real ones arrive on an
 * imported carrier. What this pins is the structure: due on the right edge and
 * not before; once; a re-sort or a step back crosses no edge (the tracker's
 * `turnEdges` and the hooks that follow it); a bearer that is gone or down gets
 * nothing; a record that is not its own flag's is not read; and the real hooks
 * act on the primary GM's client alone.
 *
 * The world clock is pinned beside it: a fight that ends before a record is due
 * moves it onto `dueAt`, at the invented round length of
 * `time-unit-fixture.mjs`; the clock lifts it once, in the same order; a world
 * with no round length deletes it and warns the Judge once; and a fight whose
 * combatants are gone still releases the record its actor holds.
 */
import assert from "node:assert/strict";
import { MODULE_ID, FLAG_DELAYED_DAMAGE, FLAG_TURN_LIFE, TURN_BEGAN_HOOK, TURN_ENDED_HOOK } from "../scripts/lib/constants.mjs";
import { turnEdges } from "../scripts/lib/turn-life.mjs";
import { INVENTED_ROUND_SECONDS, registerInventedTime, removeInventedTime } from "./time-unit-fixture.mjs";

let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

const hooks = {};
globalThis.Hooks = { on: (name, fn) => { (hooks[name] ??= []).push(fn); }, off() {} };
globalThis.foundry = { data: { operators: { ForcedDeletion: class {} } } };
globalThis.game = { i18n: { localize: (k) => k, format: (k) => k }, user: { isGM: true }, users: { activeGM: null } };
globalThis.ui = { notifications: { warn() {}, info() {} } };

const { readDelayedDamage, delayedDamageStep, delayedDamageDue, delayedDamageToWorld, delayedDamageEffectData, liftDelayedDamage, liftWorldDelayedDamage, convertDelayedDamage, installDelayedDamage } = await import("../scripts/lib/delayed-damage.mjs");

const record = (over = {}) => ({ combatId: "f", combatantId: "c1", edge: "start", count: 2, seen: 0, amount: 7, source: "Venom", cite: "Pg 3", ...over });
const began = { kind: "began", combatId: "f", combatantId: "c1" };
const ended = { kind: "ended", combatId: "f", combatantId: "c1" };

await ok("a record is a clock and a damage, each well formed, or nothing", () => {
  assert.deepEqual(readDelayedDamage(record()), { combatId: "f", combatantId: "c1", edge: "start", count: 2, seen: 0, amount: 7, formula: "", source: "Venom", cite: "Pg 3" });
  assert.equal(readDelayedDamage(record({ amount: null, formula: " 2d4 " })).formula, "2d4", "a formula in place of an amount");
  assert.equal(readDelayedDamage(record({ amount: 0 })).amount, 0, "a flat zero is a damage");
  assert.equal(readDelayedDamage(record({ amount: null })), null, "no amount and no formula");
  assert.equal(readDelayedDamage(record({ amount: -2 })), null, "a negative amount");
  assert.equal(readDelayedDamage(record({ count: 0 })), null, "no clock");
  assert.equal(readDelayedDamage(record({ edge: "middle" })), null);
  assert.equal(readDelayedDamage(null), null);
  assert.equal(readDelayedDamage(record({ cite: undefined })).cite, "", "a page the carrier did not read is blank");
});

await ok("it comes due on the edge and not before, and counts the turns that pass", () => {
  assert.deepEqual(delayedDamageStep(record(), began), { act: "count", seen: 1, record: readDelayedDamage(record()) }, "the first turn counts");
  assert.equal(delayedDamageStep(record({ seen: 1 }), began).act, "apply", "the second turn reaches the count");
  assert.equal(delayedDamageStep(record({ seen: 1 }), ended).act, "none", "a start record is not due at an end");
  assert.equal(delayedDamageStep(record({ edge: "end", seen: 2 }), ended).act, "apply", "an end record is due at the end of a counted turn");
  assert.equal(delayedDamageStep(record({ edge: "end", seen: 1 }), ended).act, "none", "not before its count");
  assert.equal(delayedDamageStep(record({ seen: 1 }), { ...began, combatantId: "c2" }).act, "none", "another combatant's turn");
  assert.equal(delayedDamageStep(record({ seen: 1 }), { ...began, combatId: "g" }).act, "none", "another fight's");
  assert.equal(delayedDamageStep(record({ amount: null }), began).act, "none", "an ill-formed record");
  assert.equal(delayedDamageStep(record({ seen: 1 }), began, { gone: true }).act, "drop", "a bearer that is gone");
  assert.equal(delayedDamageStep(record({ seen: 1 }), began, { down: true }).act, "drop", "a bearer that is down");
  assert.equal(delayedDamageStep(record(), began, { down: true }).act, "count", "a count is a count whatever the bearer is");
});

await ok("a re-sort or a step back crosses no edge, so none counts", () => {
  const at = (round, turn, combatantId) => ({ round, turn, combatantId });
  assert.deepEqual(turnEdges(at(1, 1, "b"), at(1, 0, "a")), { ended: null, began: false });
  assert.deepEqual(turnEdges(at(1, 0, "a"), at(1, 1, "a")), { ended: null, began: false });
  assert.deepEqual(turnEdges(at(1, 0, "a"), at(1, 1, "b")), { ended: "a", began: true }, "a turn forward does");
});

await ok("an effect carries the record under its own flag and never the turn-life one", () => {
  const data = delayedDamageEffectData({ amount: 4, source: "Venom", cite: "Pg 3", combatId: "f", combatantId: "c1", count: 3 });
  assert.deepEqual(data.flags[MODULE_ID][FLAG_DELAYED_DAMAGE], { combatId: "f", combatantId: "c1", edge: "start", count: 3, seen: 0, amount: 4, formula: "", source: "Venom", cite: "Pg 3" });
  assert.equal(data.flags[MODULE_ID][FLAG_TURN_LIFE], undefined, "the tracker would delete it before it could land");
  assert.equal(data.name, "Venom");
  assert.equal(delayedDamageEffectData({ source: "x", combatId: "f", combatantId: "c1", count: 3 }), null, "no damage");
  assert.equal(delayedDamageEffectData({ amount: 1, source: "x", combatId: "f", combatantId: "c1", count: 0 }), null, "no clock");
});

/** A fight of two combatants whose effects are plain objects with the document methods the reader uses. */
function fight({ bearerDown = false, orphan = false, deleteFails = false } = {}) {
  const deleted = [];
  const flags = [];
  const effect = { id: "e1", uuid: "Actor.a.ActiveEffect.e1", flags: { [MODULE_ID]: { [FLAG_DELAYED_DAMAGE]: record() } }, setFlag: async (_s, _k, v) => { flags.push(v); effect.flags[MODULE_ID][FLAG_DELAYED_DAMAGE] = v; } };
  const actor = { name: "Bearer", statuses: new Set(), effects: [effect], deleteEmbeddedDocuments: async (_t, ids) => { if (deleteFails) throw new Error("gone"); deleted.push(...ids); effect.gone = true; } };
  const c1 = { id: "c1", name: "Bearer", actor, isDefeated: bearerDown };
  const c2 = { id: "c2", name: "Other", actor: { name: "Other", statuses: new Set(), effects: [] } };
  // An orphan's combatant is no longer in the fight; its effect stays on an actor the fight still holds.
  if (orphan) c2.actor = actor;
  const list = orphan ? [c2] : [c1, c2];
  list.get = (id) => list.find((c) => c.id === id);
  return { combat: { id: "f", combatants: list }, c1, actor, deleted, flags, effect };
}
const hands = () => {
  const log = { rolled: [], damage: [], posted: [] };
  return {
    log,
    deps: {
      roll: async (formula) => { log.rolled.push(formula); return 5; },
      damage: async ({ amount }) => { log.damage.push(amount); return { ok: true, before: 10, after: 10 - amount }; },
      post: async (entry) => { log.posted.push(entry); },
    },
  };
};

await ok("the reader counts a turn, then at the due turn deletes the record first and deals it once with a card naming source, page and amount", async () => {
  const f = fight();
  const { deps, log } = hands();
  assert.deepEqual(await liftDelayedDamage(f.combat, "c1", "began", deps), [], "the first turn only counts");
  assert.equal(f.flags.at(-1).seen, 1);
  assert.deepEqual(f.deleted, []);
  const landed = await liftDelayedDamage(f.combat, "c1", "began", deps);
  assert.deepEqual(f.deleted, ["e1"], "the record is gone");
  assert.deepEqual(log.damage, [7]);
  assert.equal(landed.length, 1);
  assert.deepEqual(log.posted.map((p) => [p.name, p.source, p.cite, p.amount]), [["Bearer", "Venom", "Pg 3", 7]]);
  assert.deepEqual(await liftDelayedDamage(f.combat, "c2", "began", deps), [], "another combatant's turn does nothing");
  assert.equal(log.damage.length, 1, "once");
});

await ok("a formula is rolled when it lands, and a record whose delete fails deals nothing", async () => {
  const f = fight();
  f.effect.flags[MODULE_ID][FLAG_DELAYED_DAMAGE] = record({ amount: null, formula: "1d6", seen: 1 });
  const { deps, log } = hands();
  await liftDelayedDamage(f.combat, "c1", "began", deps);
  assert.deepEqual(log.rolled, ["1d6"]);
  assert.deepEqual(log.damage, [5]);
  const lost = fight({ deleteFails: true });
  lost.effect.flags[MODULE_ID][FLAG_DELAYED_DAMAGE] = record({ seen: 1 });
  const second = hands();
  const quiet = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(await liftDelayedDamage(lost.combat, "c1", "began", second.deps), []);
  } finally {
    console.error = quiet;
  }
  assert.deepEqual(second.log.damage, [], "another client holds it");
});

await ok("a bearer that is down, or whose combatant is gone, gets no damage and no card, and its record goes", async () => {
  const down = fight({ bearerDown: true });
  down.effect.flags[MODULE_ID][FLAG_DELAYED_DAMAGE] = record({ seen: 1 });
  const a = hands();
  assert.deepEqual(await liftDelayedDamage(down.combat, "c1", "began", a.deps), []);
  assert.deepEqual([a.log.damage, a.log.posted, down.deleted], [[], [], ["e1"]]);
  const dead = fight();
  dead.actor.statuses.add("dead");
  dead.effect.flags[MODULE_ID][FLAG_DELAYED_DAMAGE] = record({ seen: 1 });
  const b = hands();
  await liftDelayedDamage(dead.combat, "c1", "began", b.deps);
  assert.deepEqual([b.log.damage, dead.deleted], [[], ["e1"]], "an actor marked dead");
  const stranger = fight();
  stranger.effect.flags[MODULE_ID][FLAG_DELAYED_DAMAGE] = record({ seen: 1, combatId: "g" });
  const c = hands();
  await liftDelayedDamage(stranger.combat, "c1", "began", c.deps);
  assert.deepEqual([c.log.damage, stranger.deleted], [[], []], "another fight's record is left as it is");
  const orphan = fight({ orphan: true });
  orphan.effect.flags[MODULE_ID][FLAG_DELAYED_DAMAGE] = record({ seen: 1 });
  const d = hands();
  await liftDelayedDamage(orphan.combat, "c1", "began", d.deps);
  assert.deepEqual([d.log.damage, d.log.posted, orphan.deleted], [[], [], ["e1"]], "a bearer no longer in the fight");
  const absent = hands();
  assert.deepEqual(await liftDelayedDamage({ id: "f", combatants: [] }, "c1", "began", absent.deps), []);
  assert.deepEqual(await liftDelayedDamage(null, "c1", "began", absent.deps), []);
});

await ok("the hooks are installed once", async () => {
  installDelayedDamage();
  installDelayedDamage();
  assert.equal(hooks[TURN_BEGAN_HOOK].length, 1, "installed once");
  assert.equal(hooks[TURN_ENDED_HOOK].length, 1);
  assert.equal(hooks.deleteCombat.length, 1, "the fight's end is heard once");
  assert.equal(hooks.updateWorldTime.length, 1, "the world clock is heard once");
  assert.equal(typeof hooks[TURN_BEGAN_HOOK][0], "function");
  // This test world has no primary GM seat, so a due record is left alone.
  const f = fight();
  f.effect.flags[MODULE_ID][FLAG_DELAYED_DAMAGE] = record({ seen: 1 });
  hooks[TURN_BEGAN_HOOK][0](f.combat, "c1");
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(f.deleted, [], "a client that is not the primary GM acts on nothing");
  const g = fight();
  g.effect.flags[MODULE_ID][FLAG_DELAYED_DAMAGE] = { dueAt: 10, amount: 1, source: "x" };
  let clockReads = 0;
  Object.defineProperty(game, "time", { configurable: true, get: () => { clockReads++; return { worldTime: 50 }; } });
  hooks.deleteCombat[0](g.combat);
  hooks.updateWorldTime[0](50, 10);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual([g.deleted, g.effect.flags[MODULE_ID][FLAG_DELAYED_DAMAGE].dueAt], [[], 10], "nor on the fight's end or the clock");
  assert.equal(clockReads, 0, "the fight's end reads nothing on a client that is not the primary GM");
  delete game.time;
});


/* -------------------------------------------- */
/*  The world clock                              */
/* -------------------------------------------- */

const { roundSeconds } = await import("../scripts/lib/time-unit.mjs");
const world = (over = {}) => ({ dueAt: 100, amount: 7, source: "Venom", cite: "Pg 3", ...over });
const Unset = globalThis.foundry.data.operators.ForcedDeletion;

/** An actor holding one effect, with the document methods the world readers use (a delete removes the effect). */
function holder({ raw, dead = false, deleteFails = false, name = "Bearer" } = {}) {
  const deleted = [];
  const effect = { id: "e1", uuid: `Actor.${name}.ActiveEffect.e1`, flags: { [MODULE_ID]: { [FLAG_DELAYED_DAMAGE]: raw } } };
  // A write merges objects and removes a forced deletion, as the document update does.
  effect.update = async (changes) => {
    for (const [path, value] of Object.entries(changes)) {
      const key = path.split(".").at(-1);
      const next = { ...effect.flags[MODULE_ID][key] };
      for (const [k, v] of Object.entries(value)) { if (v instanceof Unset) delete next[k]; else next[k] = v; }
      effect.flags[MODULE_ID][key] = next;
    }
  };
  const actor = {
    name, statuses: new Set(dead ? ["dead"] : []), effects: [effect],
    deleteEmbeddedDocuments: async (_t, ids) => {
      if (deleteFails) throw new Error("gone");
      deleted.push(...ids);
      actor.effects = actor.effects.filter((e) => !ids.includes(e.id));
    },
  };
  return { actor, effect, deleted, flag: () => effect.flags[MODULE_ID][FLAG_DELAYED_DAMAGE] };
}

await ok("a world-clock record reads as its own shape, and a dueAt that is present wins", () => {
  assert.deepEqual(readDelayedDamage(world()), { dueAt: 100, amount: 7, formula: "", source: "Venom", cite: "Pg 3" });
  assert.deepEqual(readDelayedDamage({ ...record(), dueAt: 100 }), { dueAt: 100, amount: 7, formula: "", source: "Venom", cite: "Pg 3" }, "a flag that still holds both clocks reads as the world's");
  assert.equal(readDelayedDamage(world({ amount: null })), null, "no damage");
  assert.equal(readDelayedDamage(world({ dueAt: "soon" })), null, "no clock of either kind");
  assert.equal(readDelayedDamage(world({ dueAt: 0 })).dueAt, 0, "the clock's own zero is a time");
  const data = delayedDamageEffectData({ amount: 4, source: "Venom", cite: "Pg 3", dueAt: 250 });
  assert.deepEqual(data.flags[MODULE_ID][FLAG_DELAYED_DAMAGE], { dueAt: 250, amount: 4, formula: "", source: "Venom", cite: "Pg 3" }, "made outside a fight, it starts on the world clock");
  assert.equal(delayedDamageEffectData({ source: "x", dueAt: 250 }), null, "no damage");
  assert.equal(delayedDamageStep(world(), began).act, "none", "a turn never counts a world-clock record");
  assert.equal(delayedDamageStep({ ...record({ seen: 1 }), dueAt: 100 }, began).act, "none", "nor one that still holds both");
});

await ok("the world clock brings a record due at its reading and not before, and a down bearer gets nothing", () => {
  assert.equal(delayedDamageDue(world(), 99).act, "none");
  assert.equal(delayedDamageDue(world(), 100).act, "apply", "the reading that reaches it");
  assert.equal(delayedDamageDue(world(), 5000).act, "apply", "a clock that jumped past it");
  assert.equal(delayedDamageDue(world(), 100, { down: true }).act, "drop");
  assert.equal(delayedDamageDue(record({ seen: 1 }), 100).act, "none", "a combat-clock record waits for its turns");
  assert.equal(delayedDamageDue(world(), null).act, "none", "no reading");
  assert.equal(delayedDamageDue(world({ dueAt: 0 }), 0).act, "apply");
});

await ok("a fight's end turns the rounds still to run into seconds at the round length", () => {
  const at = { now: 1000, roundSeconds: INVENTED_ROUND_SECONDS };
  const moved = delayedDamageToWorld(record({ count: 4, seen: 1 }), "f", at);
  assert.equal(moved.act, "convert");
  assert.deepEqual(moved.record, { dueAt: 1000 + 3 * INVENTED_ROUND_SECONDS, amount: 7, formula: "", source: "Venom", cite: "Pg 3" }, "three rounds to run, and no combat key left");
  assert.equal(delayedDamageToWorld(record({ count: 2, seen: 5 }), "f", at).record.dueAt, 1000, "a count already reached is due now");
  assert.equal(delayedDamageToWorld(record({ edge: "end", count: 2, seen: 2 }), "f", at).record.dueAt, 1000, "an end record waiting on its turn's end is due now");
  assert.equal(delayedDamageToWorld(record({ count: 2 }), "f", { now: 1000, roundSeconds: 0.4 }).record.dueAt, 1001, "a part of a second is a whole one");
  assert.equal(delayedDamageToWorld(record(), "g", at).act, "none", "another fight's");
  assert.equal(delayedDamageToWorld(world(), "f", at).act, "none", "already on the world clock");
  assert.equal(delayedDamageToWorld(record(), "f", { ...at, down: true }).act, "drop", "a bearer that is down is owed nothing");
  for (const blank of [null, undefined, 0, -3, "x"]) assert.equal(delayedDamageToWorld(record(), "f", { now: 1000, roundSeconds: blank }).act, "owed", `a round length of ${String(blank)} cannot convert`);
  assert.equal(delayedDamageToWorld(record(), "f", { now: null, roundSeconds: INVENTED_ROUND_SECONDS }).act, "owed", "no clock reading");
});

await ok("the round length is read from the imported figures at the moment, and is null with none", () => {
  removeInventedTime();
  assert.equal(roundSeconds(), null, "nothing imported");
  registerInventedTime();
  try {
    assert.equal(roundSeconds(), INVENTED_ROUND_SECONDS);
  } finally {
    removeInventedTime();
  }
});

/** A fight with the bearer's combatant and one other; `bearer` is the actor the combatant stands for. */
const fightEnd = (bearer, over = {}) => {
  const list = [{ id: "c1", name: "Bearer", actor: bearer, isDefeated: false, ...over }];
  list.get = (id) => list.find((c) => c.id === id);
  return { id: "f", combatants: list };
};
const warnings = () => { const log = []; return { log, deps: { warn: (entry) => log.push(entry) } }; };

await ok("a fight that ends before the record is due moves it to the world clock in one write, and the clock lands it once after", async () => {
  const h = holder({ raw: record({ count: 3, seen: 1 }) });
  const w = warnings();
  const before = { ...h.flag() };
  const done = await convertDelayedDamage(fightEnd(h.actor), [h.actor], { now: 1000, roundSeconds: INVENTED_ROUND_SECONDS }, w.deps);
  assert.deepEqual(done, [{ name: "Bearer", act: "convert" }]);
  assert.equal(before.combatId, "f", "before: a combat clock");
  assert.deepEqual(h.flag(), { dueAt: 1000 + 2 * INVENTED_ROUND_SECONDS, amount: 7, formula: "", source: "Venom", cite: "Pg 3" }, "after: a world clock and nothing of the fight");
  assert.deepEqual([h.deleted, w.log], [[], []], "the record stays, and nobody is warned");
  const { deps, log } = hands();
  const order = [];
  const traced = { roll: deps.roll, damage: async (a) => { order.push("damage"); return deps.damage(a); }, post: async (e) => { order.push("post"); return deps.post(e); } };
  const gone = h.actor.deleteEmbeddedDocuments;
  h.actor.deleteEmbeddedDocuments = async (...args) => { order.push("delete"); return gone(...args); };
  assert.deepEqual(await liftWorldDelayedDamage([h.actor], 1000 + 2 * INVENTED_ROUND_SECONDS - 1, traced), [], "not before");
  const landed = await liftWorldDelayedDamage([h.actor], 1000 + 2 * INVENTED_ROUND_SECONDS, traced);
  assert.deepEqual(order, ["delete", "damage", "post"], "delete first, then the hit points, then the card");
  assert.equal(landed.length, 1);
  assert.deepEqual(log.damage, [7]);
  assert.deepEqual(log.posted.map((p) => [p.name, p.source, p.cite, p.amount]), [["Bearer", "Venom", "Pg 3", 7]]);
  assert.deepEqual(await liftWorldDelayedDamage([h.actor], 99999, traced), [], "once");
  assert.equal(log.damage.length, 1);
});

await ok("a record due at the fight's end is due at once, and a bearer that left the fight is still struck", async () => {
  const h = holder({ raw: record({ count: 2, seen: 2 }) });
  const stranger = { id: "f", combatants: Object.assign([], { get: () => undefined }) };
  assert.equal((await convertDelayedDamage(stranger, [h.actor], { now: 500, roundSeconds: INVENTED_ROUND_SECONDS }, warnings().deps))[0].act, "convert", "no combatant in the fight, the actor still holds it");
  assert.equal(h.flag().dueAt, 500);
  const { deps, log } = hands();
  await liftWorldDelayedDamage([h.actor], 500, deps);
  assert.deepEqual(log.damage, [7]);
});

await ok("a fight's end leaves another fight's record and a world-clock record as they are, and a down bearer's goes unpaid", async () => {
  const other = holder({ raw: record({ combatId: "g" }), name: "Other" });
  const already = holder({ raw: world(), name: "Already" });
  const w = warnings();
  const at = { now: 1000, roundSeconds: INVENTED_ROUND_SECONDS };
  assert.deepEqual(await convertDelayedDamage(fightEnd(other.actor), [other.actor, already.actor], at, w.deps), []);
  assert.equal(other.flag().combatId, "g");
  assert.equal(already.flag().dueAt, 100);
  const defeated = holder({ raw: record(), name: "Defeated" });
  assert.deepEqual(await convertDelayedDamage(fightEnd(defeated.actor, { isDefeated: true }), [defeated.actor], at, w.deps), [{ name: "Bearer", act: "drop" }]);
  const dead = holder({ raw: record(), dead: true, name: "Dead" });
  await convertDelayedDamage(fightEnd(dead.actor), [dead.actor], at, w.deps);
  assert.deepEqual([defeated.deleted, dead.deleted, w.log], [["e1"], ["e1"], []], "both deleted, nothing owed, nobody warned");
  const twice = holder({ raw: record() });
  const fightOf = fightEnd(twice.actor);
  assert.equal((await convertDelayedDamage(fightOf, [twice.actor, twice.actor], at, w.deps)).length, 1, "an actor listed twice holds its record once");
});

await ok("a world with no round length deletes the record and warns the Judge once, naming bearer, amount, source and page", async () => {
  const flat = holder({ raw: record() });
  const w = warnings();
  const done = await convertDelayedDamage(fightEnd(flat.actor), [flat.actor], { now: 1000, roundSeconds: roundSeconds() }, w.deps);
  assert.equal(roundSeconds(), null, "nothing is imported in this check");
  assert.deepEqual(done, [{ name: "Bearer", act: "owed" }]);
  assert.deepEqual(flat.deleted, ["e1"], "the record is deleted, never converted");
  assert.deepEqual(w.log, [{ name: "Bearer", amount: 7, source: "Venom", cite: "Pg 3" }], "one warning, with what is owed");
  const rolled = holder({ raw: record({ amount: null, formula: "1d6" }) });
  const second = warnings();
  await convertDelayedDamage(fightEnd(rolled.actor), [rolled.actor], { now: 1000, roundSeconds: null }, second.deps);
  assert.deepEqual(second.log.map((e) => e.amount), ["1d6"], "a formula is named, never rolled");
  const lost = holder({ raw: record(), deleteFails: true });
  const third = warnings();
  const quiet = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(await convertDelayedDamage(fightEnd(lost.actor), [lost.actor], { now: 1000, roundSeconds: null }, third.deps), []);
  } finally {
    console.error = quiet;
  }
  assert.deepEqual(third.log, [], "a delete that fails warns nothing: another client holds it");
});

await ok("the world reader rolls a formula, skips a bearer marked dead, and a failed delete deals nothing", async () => {
  const rolled = holder({ raw: world({ amount: null, formula: "1d6" }) });
  const a = hands();
  await liftWorldDelayedDamage([rolled.actor], 100, a.deps);
  assert.deepEqual([a.log.rolled, a.log.damage], [["1d6"], [5]]);
  const dead = holder({ raw: world(), dead: true });
  const b = hands();
  assert.deepEqual(await liftWorldDelayedDamage([dead.actor], 100, b.deps), []);
  assert.deepEqual([b.log.damage, b.log.posted, dead.deleted], [[], [], ["e1"]]);
  const lost = holder({ raw: world(), deleteFails: true });
  const c = hands();
  const quiet = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(await liftWorldDelayedDamage([lost.actor], 100, c.deps), []);
  } finally {
    console.error = quiet;
  }
  assert.deepEqual(c.log.damage, [], "another client holds it");
  const early = holder({ raw: world() });
  const d = hands();
  await liftWorldDelayedDamage([early.actor, null], 99, d.deps);
  assert.deepEqual([d.log.damage, early.deleted], [[], []], "a record not yet due is left");
});
console.log(`\n${passed} delayed-damage checks passed.`);
