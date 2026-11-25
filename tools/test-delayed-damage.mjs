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
 */
import assert from "node:assert/strict";
import { MODULE_ID, FLAG_DELAYED_DAMAGE, FLAG_TURN_LIFE, TURN_BEGAN_HOOK, TURN_ENDED_HOOK } from "../scripts/lib/constants.mjs";
import { turnEdges } from "../scripts/lib/turn-life.mjs";

let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

const hooks = {};
globalThis.Hooks = { on: (name, fn) => { (hooks[name] ??= []).push(fn); }, off() {} };
globalThis.game = { i18n: { localize: (k) => k, format: (k) => k }, user: { isGM: true }, users: { activeGM: null } };
globalThis.ui = { notifications: { warn() {}, info() {} } };

const { readDelayedDamage, delayedDamageStep, delayedDamageEffectData, liftDelayedDamage, installDelayedDamage } = await import("../scripts/lib/delayed-damage.mjs");

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
  assert.equal(typeof hooks[TURN_BEGAN_HOOK][0], "function");
  // This test world has no primary GM seat, so a due record is left alone.
  const f = fight();
  f.effect.flags[MODULE_ID][FLAG_DELAYED_DAMAGE] = record({ seen: 1 });
  hooks[TURN_BEGAN_HOOK][0](f.combat, "c1");
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(f.deleted, [], "a client that is not the primary GM acts on nothing");
});

console.log(`\n${passed} delayed-damage checks passed.`);
