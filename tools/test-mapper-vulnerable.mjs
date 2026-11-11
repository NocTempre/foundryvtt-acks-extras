/**
 * The mapper's hands (scripts/formation/mapper-kit-logic.mjs, scripts/lib/held-condition.mjs).
 *
 * The verdicts are pure and are run over a fight's timeline the way the world
 * reads it: the role held outside a fight, a surprised round, the first free
 * round before and after the mapper's own turn, a mapper with no combatant, a
 * combat that ended, and the members the condition never lands on. The held
 * effect runs against a stand-in actor: created once under its fixed id and
 * marker, written never when it already stands, collapsed from duplicates, and
 * the same status set by hand left alone by both calls. That the tracker,
 * the system's surprise lift and a real token carry any of it is the live
 * recipe's (docs/formation/TESTING.md, "The mapper is vulnerable").
 */
import assert from "node:assert/strict";
import { KIT_HELD as HELD, KIT_STASHED_FLAG, kitHeld, stashedIn, stashesNow } from "../scripts/formation/mapper-kit-logic.mjs";

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

globalThis.CONFIG = { statusEffects: [{ id: "vulnerable", name: "EFFECT.Vulnerable", img: "icons/svg/hazard.svg" }] };
globalThis.game = { i18n: { localize: (key) => key } };
const { HELD_CONDITION_FLAG, heldEffects, holdCondition, releaseCondition } = await import("../scripts/lib/held-condition.mjs");

/* ------------------------------------------------------------------ */
/*  The verdicts                                                        */
/* ------------------------------------------------------------------ */

await test("the fixed effect id is the 16 letters and digits Foundry takes", () => {
  assert.match(HELD.id, /^[A-Za-z0-9]{16}$/);
});

await test("the role held, with no fight, is vulnerable; the role not held is not", () => {
  assert.equal(kitHeld({ role: true }), true);
  assert.equal(kitHeld({ role: false }), false);
});

await test("a dead, left-behind or stacked member is never vulnerable", () => {
  assert.equal(kitHeld({ role: true, dead: true }), false);
  assert.equal(kitHeld({ role: true, left: true }), false);
  assert.equal(kitHeld({ role: true, stack: true }), false);
});

await test("a combat that holds the mapper but has not marked the stash holds the condition", () => {
  assert.equal(kitHeld({ role: true, combat: { stashed: false } }), true);
});

await test("a combat that marked the stash lifts the condition, and only for that member", () => {
  assert.equal(kitHeld({ role: true, combat: { stashed: true } }), false);
  assert.equal(stashedIn({ a: true }, "a"), true);
  assert.equal(stashedIn({ a: true }, "b"), false);
  assert.equal(stashedIn(undefined, "a"), false);
  assert.equal(stashedIn({ a: true }, undefined), false);
});

await test("the stash lands on the mapper's own turn in a started combat when not surprised", () => {
  assert.equal(stashesNow({ round: 1, mine: true, surprised: false, stashed: false }), true);
});

await test("it never lands before the combat starts, off the mapper's turn, while surprised, or twice", () => {
  assert.equal(stashesNow({ round: 0, mine: true, surprised: false, stashed: false }), false);
  assert.equal(stashesNow({ round: 1, mine: false, surprised: false, stashed: false }), false);
  assert.equal(stashesNow({ round: 1, mine: true, surprised: true, stashed: false }), false);
  assert.equal(stashesNow({ round: 1, mine: true, surprised: false, stashed: true }), false);
});

/**
 * One combat as the world reads it, a turn at a time. `turns` are the active
 * combatants in order, each `[round, whoseTurn, mapperSurprised]`; the mapper
 * is `"m"`. Returns the verdict after every turn, folding the mark the way the
 * updateCombat hook does.
 */
function play(turns, { hasCombatant = true } = {}) {
  const combat = { flag: {} };
  const seen = [];
  for (const [round, who, surprised] of turns) {
    if (hasCombatant && stashesNow({ round, mine: who === "m", surprised, stashed: stashedIn(combat.flag, "m") })) combat.flag.m = true;
    seen.push(kitHeld({ role: true, combat: hasCombatant ? { stashed: stashedIn(combat.flag, "m") } : null }));
  }
  return seen;
}

await test("a surprised mapper holds the condition through the surprised round and lifts on their first free turn", () => {
  // Round 1: the mapper is surprised and is skipped. Round 2: the surprise is gone.
  const seen = play([[1, "x", true], [1, "y", true], [2, "x", false], [2, "m", false], [2, "y", false]]);
  assert.deepEqual(seen, [true, true, true, false, false]);
});

await test("an unsurprised mapper keeps it until their own turn, and the earlier turns of that round are held", () => {
  const seen = play([[1, "x", false], [1, "y", false], [1, "m", false], [1, "z", false], [2, "m", false]]);
  assert.deepEqual(seen, [true, true, false, false, false]);
});

await test("a mapper still surprised on their turn is not lifted, and the next free turn does it", () => {
  const seen = play([[2, "m", true], [2, "x", false], [3, "m", false]]);
  assert.deepEqual(seen, [true, true, false]);
});

await test("a mapper with no combatant never gets a turn: held for the whole combat", () => {
  const seen = play([[1, "x", false], [1, "y", false], [2, "x", false]], { hasCombatant: false });
  assert.deepEqual(seen, [true, true, true]);
});

await test("when the combat ends the mark goes with it and the role resumes", () => {
  const during = play([[1, "m", false]]);
  assert.deepEqual(during, [false]);
  assert.equal(kitHeld({ role: true, combat: null }), true);
});

await test("the mark's flag key is the module's own and stays a plain word", () => {
  assert.match(KIT_STASHED_FLAG, /^[a-zA-Z]+$/);
});

/* ------------------------------------------------------------------ */
/*  The held effect                                                     */
/* ------------------------------------------------------------------ */

let nextId = 0;
/** An actor as hold and release read one: a collection of effects, three writes. */
function actor() {
  const rows = new Map();
  const log = { created: 0, deleted: 0, updated: 0 };
  const make = (data) => {
    const id = data._id ?? `fx${(++nextId).toString().padStart(14, "0")}`;
    const effect = {
      id,
      name: data.name,
      disabled: !!data.disabled,
      statuses: new Set(data.statuses ?? []),
      flags: data.flags ?? {},
      getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
      async update(patch) { log.updated += 1; if (patch.statuses) this.statuses = new Set(patch.statuses); },
    };
    rows.set(id, effect);
    return effect;
  };
  return {
    rows,
    log,
    effects: {
      has: (id) => rows.has(id),
      get: (id) => rows.get(id),
      [Symbol.iterator]: () => rows.values(),
    },
    seed: make,
    async createEmbeddedDocuments(type, list, options = {}) {
      assert.equal(type, "ActiveEffect");
      log.created += list.length;
      return list.map((d) => make(options.keepId ? d : { ...d, _id: undefined }));
    },
    async deleteEmbeddedDocuments(type, ids, options) {
      assert.equal(type, "ActiveEffect");
      assert.equal(options?.["acks-extras"]?.managedDelete, true, "the delete authorizes itself");
      for (const id of ids) rows.delete(id);
      log.deleted += ids.length;
    },
  };
}

const handToggled = () => ({ name: "Vulnerable", statuses: ["vulnerable"] });

await test("holding creates one marked effect under the fixed id, and a second ask writes nothing", async () => {
  const a = actor();
  assert.equal(await holdCondition(a, HELD), true);
  const mine = heldEffects(a, HELD);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].id, HELD.id);
  assert.equal(mine[0].statuses.has("vulnerable"), true);
  assert.equal(mine[0].getFlag("acks-extras", HELD_CONDITION_FLAG), HELD.holder);
  assert.equal(await holdCondition(a, HELD), false);
  assert.deepEqual(a.log, { created: 1, deleted: 0, updated: 0 });
});

await test("duplicates collapse to one, the fixed id kept", async () => {
  const a = actor();
  const marked = { name: "Vulnerable", statuses: ["vulnerable"], flags: { "acks-extras": { [HELD_CONDITION_FLAG]: HELD.holder } } };
  a.seed({ ...marked, _id: "aaaaaaaaaaaaaaaa" });
  a.seed({ ...marked, _id: HELD.id });
  a.seed({ ...marked, _id: "bbbbbbbbbbbbbbbb" });
  assert.equal(await holdCondition(a, HELD), true);
  assert.deepEqual(heldEffects(a, HELD).map((e) => e.id), [HELD.id]);
  assert.equal(a.log.deleted, 2);
});

await test("a Vulnerable set by hand is left alone by hold and by release", async () => {
  const a = actor();
  const hand = a.seed(handToggled());
  await holdCondition(a, HELD);
  assert.equal(a.rows.has(hand.id), true);
  assert.equal(heldEffects(a, HELD).length, 1);
  assert.equal(await releaseCondition(a, HELD), true);
  assert.equal(a.rows.has(hand.id), true, "the hand's effect survives the release");
  assert.equal(heldEffects(a, HELD).length, 0);
  assert.equal(await releaseCondition(a, HELD), false, "nothing marked, nothing written");
});

await test("releasing an actor the holder never touched writes nothing", async () => {
  const a = actor();
  a.seed(handToggled());
  assert.equal(await releaseCondition(a, HELD), false);
  assert.deepEqual(a.log, { created: 0, deleted: 0, updated: 0 });
});

await test("a held effect whose status an edit dropped gets it back; a disabled one stays disabled", async () => {
  const a = actor();
  await holdCondition(a, HELD);
  heldEffects(a, HELD)[0].statuses = new Set();
  assert.equal(await holdCondition(a, HELD), true);
  assert.equal(heldEffects(a, HELD)[0].statuses.has("vulnerable"), true);
  heldEffects(a, HELD)[0].disabled = true;
  heldEffects(a, HELD)[0].statuses = new Set();
  assert.equal(await holdCondition(a, HELD), false);
});

await test("another effect already on the fixed id keeps it, and the held effect takes a fresh one", async () => {
  const a = actor();
  const squatter = a.seed({ ...handToggled(), _id: HELD.id });
  await holdCondition(a, HELD);
  assert.equal(a.rows.get(HELD.id), squatter);
  assert.equal(heldEffects(a, HELD).length, 1);
  assert.notEqual(heldEffects(a, HELD)[0].id, HELD.id);
});

await test("an actor with no effects collection is not an error", async () => {
  assert.equal(await holdCondition(null, HELD), false);
  assert.equal(await releaseCondition(undefined, HELD), false);
});

console.log(`\n${passed} passed`);
