/**
 * The combat start's patch (scripts/lib/patches/combat-start.mjs).
 *
 * A stand-in for the system's combat follows the 14.2.0 methods: `internalStartCombat`
 * stores the started flag, asks a declaration prompt this suite answers by hand, and
 * on a Yes begins round 1, on a No returns with nothing undone; `startCombat` opens
 * the matrix, which the stand-in only records. `cleanupStatus` lifts a status from
 * every combatant's actor. What this pins is when the patch cleans (a fulfilled
 * start at round 0 on a GM seat, the last of the starts in flight, the combat still
 * in the world), when it does not, and that no error of the cleanup leaves the
 * wrapper. That the system's real methods behave so is the live recipe's to prove
 * (docs/lib/TESTING.md, "A cancelled declaration").
 */
import assert from "node:assert/strict";

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

const tick = () => new Promise((r) => setTimeout(r, 0));
const warnings = [];
console.warn = (text) => warnings.push(String(text));

/** Calls libWrapper registered, and the layers it put on a prototype. */
const registrations = [];
globalThis.CONFIG = { Combat: { documentClass: null } };
globalThis.game = { user: { isGM: true }, combats: new Map() };
globalThis.libWrapper = {
  register(id, target, fn, type) {
    registrations.push({ id, target, type });
    const path = target.split(".");
    const name = path.pop();
    const owner = path.reduce((at, key) => at[key], globalThis);
    const original = owner[name];
    owner[name] = function (...args) {
      return fn.call(this, (...a) => original.apply(this, a), ...args);
    };
  },
};

/** What each stand-in did, in order: `flag:unset`, `status:surprised`, `matrix`. */
const log = [];
let nextId = 0;

/** A combat stand-in with two combatants, each carrying a Surprised status. */
function makeClass() {
  return class {
    constructor() {
      this.id = `combat-${++nextId}`;
      this.round = 0;
      this.flags = {};
      this.prompts = [];
      this.combatants = [0, 1].map(() => ({ token: {}, actor: { statuses: new Set(["surprised", "other"]) } }));
      this.cleanupFails = false;
      this.unsetFails = false;
      game.combats.set(this.id, this);
    }

    getFlag(scope, key) { return this.flags[`${scope}.${key}`]; }

    async setFlag(scope, key, value) { await tick(); this.flags[`${scope}.${key}`] = value; return this; }

    async unsetFlag(scope, key) {
      log.push("flag:unset");
      if (this.unsetFails) throw new Error("the flag write failed");
      await tick();
      delete this.flags[`${scope}.${key}`];
      return this;
    }

    async cleanupStatus(status) {
      log.push(`status:${status}`);
      if (this.cleanupFails) throw new Error("the status lift failed");
      for (const c of this.combatants) c.actor.statuses.delete(status);
    }

    /** The system's 14.2.0 method: the flag first, then the prompt; a No returns with the flag and the round untouched. */
    async internalStartCombat() {
      await this.setFlag("acks", "initDone", true);
      const ready = await new Promise((resolve, reject) => this.prompts.push({ resolve, reject }));
      if (!ready) return undefined;
      this.round = 1;
      return "started";
    }

    async startCombat() { log.push("matrix"); }

    /** Answer the oldest prompt still open. */
    answer(value) { this.prompts.shift().resolve(value); }
  };
}

const { installCombatStartPatch } = await import("../scripts/lib/patches/combat-start.mjs");

/** Install the patch on a fresh class as the module does at `ready`, and make a combat of it. */
function patched() {
  const Cls = makeClass();
  CONFIG.Combat.documentClass = Cls;
  installCombatStartPatch();
  game.user.isGM = true;
  log.length = 0;
  warnings.length = 0;
  return new Cls();
}

const surprised = (combat) => combat.combatants.map((c) => c.actor.statuses.has("surprised"));
const flagged = (combat) => combat.getFlag("acks", "initDone") === true;

/** Start `combat` and wait until its prompt is open. */
async function startAndWait(combat) {
  const done = combat.internalStartCombat();
  await tick();
  await tick();
  return done;
}

await test("a cancelled declaration unsets the flag and lifts Surprised from every combatant, then returns the original's result", async () => {
  const combat = patched();
  const done = startAndWait(combat);
  await tick();
  await tick();
  assert.equal(flagged(combat), true, "the system stored the flag before it asked");
  combat.answer(false);
  assert.equal(await done, undefined);
  assert.equal(flagged(combat), false);
  assert.deepEqual(surprised(combat), [false, false]);
  assert.deepEqual(log, ["flag:unset", "status:surprised"]);
  assert.equal(combat.round, 0);
  assert.equal(combat.combatants[0].actor.statuses.has("other"), true, "only Surprised is lifted");
});

await test("a confirmed declaration begins round 1 and the patch clears nothing", async () => {
  const combat = patched();
  const done = startAndWait(combat);
  await tick();
  await tick();
  combat.answer(true);
  assert.equal(await done, "started");
  assert.equal(combat.round, 1);
  assert.equal(flagged(combat), true);
  assert.deepEqual(surprised(combat), [true, true]);
  assert.deepEqual(log, []);
});

await test("a seat that is not a GM's does nothing", async () => {
  const combat = patched();
  game.user.isGM = false;
  const done = startAndWait(combat);
  await tick();
  await tick();
  combat.answer(false);
  await done;
  assert.equal(flagged(combat), true);
  assert.deepEqual(surprised(combat), [true, true]);
  assert.deepEqual(log, []);
  await combat.startCombat();
  assert.deepEqual(log, ["matrix"], "a non-GM's Begin Combat is not pre-cleaned either");
});

await test("a combat deleted while the prompt was open is not written to", async () => {
  const combat = patched();
  const done = startAndWait(combat);
  await tick();
  await tick();
  game.combats.delete(combat.id);
  combat.answer(false);
  await done;
  assert.deepEqual(log, []);
  assert.deepEqual(warnings, []);
});

await test("of two starts in flight only the last to finish cleans, and Begin Combat does not pre-clean meanwhile", async () => {
  const combat = patched();
  const first = combat.internalStartCombat();
  const second = combat.internalStartCombat();
  await tick();
  await tick();
  assert.equal(combat.prompts.length, 2);
  await combat.startCombat();
  assert.deepEqual(log, ["matrix"], "a start is in flight: its prompt may be open, so nothing is cleaned");
  combat.answer(false);
  await first;
  assert.deepEqual(log, ["matrix"], "the other start is still in flight");
  assert.equal(flagged(combat), true);
  combat.answer(false);
  await second;
  assert.deepEqual(log, ["matrix", "flag:unset", "status:surprised"]);
  assert.equal(flagged(combat), false);
});

await test("of two starts the last to finish does not clean when the combat began", async () => {
  const combat = patched();
  const first = combat.internalStartCombat();
  const second = combat.internalStartCombat();
  await tick();
  await tick();
  combat.answer(true);
  await first;
  combat.answer(true);
  await second;
  assert.equal(combat.round, 1);
  assert.deepEqual(log, []);
});

await test("an abandoned start (round 0, flag set, none in flight) is cleaned before Begin Combat goes through", async () => {
  const combat = patched();
  await combat.setFlag("acks", "initDone", true);
  await combat.startCombat();
  assert.deepEqual(log, ["flag:unset", "status:surprised", "matrix"]);
  assert.equal(flagged(combat), false);
  assert.deepEqual(surprised(combat), [false, false]);
});

await test("Begin Combat on a combat with no flag, or past round 0, cleans nothing", async () => {
  const fresh = patched();
  await fresh.startCombat();
  assert.deepEqual(log, ["matrix"]);
  const running = patched();
  await running.setFlag("acks", "initDone", true);
  running.round = 2;
  await running.startCombat();
  assert.deepEqual(log, ["matrix"]);
  assert.deepEqual(surprised(running), [true, true]);
});

await test("a rejected original is rethrown untouched, with no cleanup, and its start no longer counts as in flight", async () => {
  const combat = patched();
  const done = combat.internalStartCombat();
  await tick();
  await tick();
  combat.prompts.shift().reject(new Error("the prompt failed"));
  await assert.rejects(done, /the prompt failed/);
  assert.deepEqual(log, []);
  assert.equal(flagged(combat), true);
  await combat.startCombat();
  assert.deepEqual(log, ["flag:unset", "status:surprised", "matrix"], "the count came back down, so the leaving is abandoned and cleaned");
});

await test("an error of the status lift is warned and not thrown, and the original's result is returned", async () => {
  const combat = patched();
  combat.cleanupFails = true;
  const done = startAndWait(combat);
  await tick();
  await tick();
  combat.answer(false);
  assert.equal(await done, undefined);
  assert.equal(warnings.length, 1);
  assert.equal(flagged(combat), false, "the flag step ran before the failing one");
});

await test("an error of the flag write is warned, and the status is still lifted", async () => {
  const combat = patched();
  combat.unsetFails = true;
  const done = startAndWait(combat);
  await tick();
  await tick();
  combat.answer(false);
  await done;
  assert.equal(warnings.length, 1);
  assert.deepEqual(surprised(combat), [false, false]);
});

await test("an error of the pre-clean is warned and Begin Combat goes through", async () => {
  const combat = patched();
  combat.cleanupFails = true;
  await combat.setFlag("acks", "initDone", true);
  await combat.startCombat();
  assert.equal(warnings.length, 1);
  assert.deepEqual(log, ["flag:unset", "status:surprised", "matrix"]);
});

await test("two combats are counted apart", async () => {
  const Cls = makeClass();
  CONFIG.Combat.documentClass = Cls;
  installCombatStartPatch();
  log.length = 0;
  const a = new Cls();
  const b = new Cls();
  const first = a.internalStartCombat();
  await tick();
  await tick();
  await b.setFlag("acks", "initDone", true);
  await b.startCombat();
  assert.deepEqual(log, ["flag:unset", "status:surprised", "matrix"], "b's abandoned start is cleaned while a's prompt is open");
  assert.equal(a.getFlag("acks", "initDone"), true);
  a.answer(true);
  await first;
});

await test("a second install adds no second layer", async () => {
  const Cls = makeClass();
  CONFIG.Combat.documentClass = Cls;
  registrations.length = 0;
  installCombatStartPatch();
  installCombatStartPatch();
  assert.deepEqual(registrations, [
    { id: "acks-extras", target: "CONFIG.Combat.documentClass.prototype.internalStartCombat", type: "WRAPPER" },
    { id: "acks-extras", target: "CONFIG.Combat.documentClass.prototype.startCombat", type: "WRAPPER" },
  ]);
  log.length = 0;
  const combat = new Cls();
  const done = combat.internalStartCombat();
  await tick();
  await tick();
  combat.answer(false);
  await done;
  assert.deepEqual(log, ["flag:unset", "status:surprised"], "one layer: the cleanup ran once");
});

await test("without libWrapper both methods are replaced once, and a second install leaves them as they are", async () => {
  const saved = globalThis.libWrapper;
  delete globalThis.libWrapper;
  try {
    const Cls = makeClass();
    CONFIG.Combat.documentClass = Cls;
    installCombatStartPatch();
    const first = [Cls.prototype.internalStartCombat, Cls.prototype.startCombat];
    installCombatStartPatch();
    assert.deepEqual([Cls.prototype.internalStartCombat, Cls.prototype.startCombat], first);
    log.length = 0;
    const combat = new Cls();
    const done = combat.internalStartCombat();
    await tick();
    await tick();
    combat.answer(false);
    await done;
    assert.deepEqual(log, ["flag:unset", "status:surprised"]);
    await combat.setFlag("acks", "initDone", true);
    await combat.startCombat();
    assert.deepEqual(log.slice(2), ["flag:unset", "status:surprised", "matrix"]);
  } finally {
    globalThis.libWrapper = saved;
  }
});

await test("a combat class missing either method is warned about and left alone", async () => {
  warnings.length = 0;
  registrations.length = 0;
  CONFIG.Combat.documentClass = class { startCombat() {} };
  installCombatStartPatch();
  CONFIG.Combat.documentClass = class { internalStartCombat() {} };
  installCombatStartPatch();
  assert.equal(warnings.length, 2);
  CONFIG.Combat = undefined;
  installCombatStartPatch();
  assert.equal(warnings.length, 3);
  assert.equal(registrations.length, 0);
});

console.log(`\n${passed} passed`);
