/**
 * A combat holding a combatant with no token, across the three patches that meet
 * it (scripts/lib/patches/combat-start.mjs, initiative-card.mjs,
 * group-initiative.mjs, and the helper they share, tokenless-combat.mjs).
 *
 * A stand-in for the system's combat follows the 14.2.0 methods: `startCombat`,
 * `rollInitiative` and `manageGroup` each read the token of every combatant and
 * throw a TypeError on a null one, `rollAll` refuses while `flags.acks.initDone`
 * is unset and otherwise runs Foundry's `rollAll`. A stand-in for Foundry's
 * `Combat` starts the combat (round 1, turn 0), rolls every row it is handed and
 * rolls all rows through `rollInitiative`. What this pins is that Begin Combat,
 * a roll and the group control each go the way the ruling says in such a combat,
 * that the combat is told once across all three, and that a combat with every
 * token present is left to the system's methods. That the real methods behave so
 * is the live recipe's to prove (docs/lib/TESTING.md, step 13 of the steps list).
 */
import assert from "node:assert/strict";

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

const notices = [];
const settings = { initiativeCard: false };
globalThis.ui = { notifications: { warn: (text) => notices.push(String(text)) } };
globalThis.CONFIG = { Combat: { documentClass: null } };
globalThis.Hooks = { on() {}, off() {} };
globalThis.ChatMessage = { create: async () => {} };
globalThis.game = {
  user: { id: "gm-1", isGM: true },
  users: [{ id: "gm-1", isGM: true }],
  combats: new Map(),
  settings: { get: (_module, key) => settings[key] },
  i18n: { format: (key, data = {}) => `${key} ${JSON.stringify(data)}` },
};
globalThis.foundry = { utils: { escapeHTML: (s) => String(s) }, documents: {} };
globalThis.libWrapper = {
  register(_id, target, fn) {
    const path = target.split(".");
    const name = path.pop();
    const owner = path.reduce((at, key) => at[key], globalThis);
    const original = owner[name];
    owner[name] = function (...args) {
      return fn.call(this, (...a) => original.apply(this, a), ...args);
    };
  },
};

/** What each stand-in method was handed, in order. */
const calls = { foundryStart: 0, systemStart: 0, systemRoll: 0, foundryRoll: [], systemGroup: 0, rollAll: 0 };

/** Foundry's own `Combat`. */
class FoundryCombat {
  async startCombat() {
    calls.foundryStart++;
    return this.update({ round: 1, turn: 0 });
  }

  async update(data) { Object.assign(this, data); return this; }

  async rollAll(options) {
    return this.rollInitiative([...this.combatants.keys()], options);
  }

  async rollInitiative(ids, options) {
    const list = typeof ids === "string" ? [ids] : [...ids];
    calls.foundryRoll.push(list);
    for (const id of list) this.combatants.get(id).initiative = 4;
    return this;
  }
}
globalThis.foundry.documents.Combat = FoundryCombat;

let combatCount = 0;
const reads = (combat) => { for (const c of combat.combatants.values()) void c.token.disposition; };

/** The system's subclass: each method reads every combatant's token, as the real ones do. */
function makeSystemClass() {
  return class extends FoundryCombat {
    constructor(rows) {
      super();
      this.id = `combat-${++combatCount}`;
      this.round = 0;
      this.flags = {};
      this.combatants = new Map(rows.map((r) => [r.id, { initiative: null, ...r }]));
      game.combats.set(this.id, this);
    }

    getFlag(scope, key) { return this.flags[`${scope}.${key}`]; }

    async setFlag(scope, key, value) { this.flags[`${scope}.${key}`] = value; return this; }

    async startCombat() { calls.systemStart++; reads(this); }

    async internalStartCombat() { return undefined; }

    async cleanupStatus() {}

    async rollAll(options) {
      if (!this.getFlag("acks", "initDone")) return undefined;
      calls.rollAll++;
      return super.rollAll(options);
    }

    async rollInitiative(ids, options) {
      calls.systemRoll++;
      await this.setFlag("acks", "lock-turns", true);
      reads(this);
      for (const id of ids) this.combatants.get(id).initiative = 9;
      await this.setFlag("acks", "lock-turns", false);
      return this;
    }

    manageGroup() { calls.systemGroup++; reads(this); }
  };
}

const { installCombatStartPatch } = await import("../scripts/lib/patches/combat-start.mjs");
const { installInitiativeCardPatch } = await import("../scripts/lib/patches/initiative-card.mjs");
const { installGroupInitiativePatch } = await import("../scripts/lib/patches/group-initiative.mjs");

const TOKENED = { id: "c-tok", name: "Ash", token: { id: "t-1", name: "Ash", hidden: false } };
const TOKENLESS = { id: "c-none", name: "Birch", token: null };

/** Install the three patches on a fresh class as the module does at `ready`, and make a combat of it. */
function patched(rows) {
  const Cls = makeSystemClass();
  CONFIG.Combat.documentClass = Cls;
  installCombatStartPatch();
  installInitiativeCardPatch();
  installGroupInitiativePatch();
  game.user.isGM = true;
  Object.assign(calls, { foundryStart: 0, systemStart: 0, systemRoll: 0, foundryRoll: [], systemGroup: 0, rollAll: 0 });
  notices.length = 0;
  return new Cls(rows);
}

await test("Begin Combat in a mixed combat starts by Foundry's method, marks the combat begun and numbers every row", async () => {
  const combat = patched([TOKENED, TOKENLESS]);
  await combat.startCombat();
  assert.equal(calls.systemStart, 0, "the system's start is never called");
  assert.equal(calls.foundryStart, 1);
  assert.equal(combat.round, 1);
  assert.equal(combat.getFlag("acks", "initDone"), true);
  assert.equal(calls.rollAll, 1, "the system's rollAll is reached and passes its flag check");
  assert.equal(calls.systemRoll, 0);
  assert.deepEqual(calls.foundryRoll, [["c-tok", "c-none"]]);
  assert.equal(combat.combatants.get("c-tok").initiative, 4);
  assert.equal(combat.combatants.get("c-none").initiative, 4);
  assert.notEqual(combat.getFlag("acks", "lock-turns"), true);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /Birch/);
  assert.doesNotMatch(notices[0], /Ash/);
});

await test("a lock a failed roll left set is released by Begin Combat before it rolls", async () => {
  const combat = patched([TOKENED, TOKENLESS]);
  combat.flags["acks.lock-turns"] = true;
  await combat.startCombat();
  assert.equal(combat.getFlag("acks", "lock-turns"), false);
  assert.equal(combat.combatants.get("c-tok").initiative, 4);
});

await test("Begin Combat, a roll and the group control in one combat show the notice once", async () => {
  const combat = patched([TOKENED, TOKENLESS]);
  await combat.startCombat();
  await combat.rollInitiative(["c-tok"]);
  assert.equal(combat.manageGroup([{ id: "t-1" }, { id: "t-2" }]), undefined);
  await combat.rollAll();
  assert.equal(calls.systemGroup, 0, "the system's group method is never called");
  assert.equal(notices.length, 1);
});

await test("the group control alone shows the notice, and a roll after it shows no second", async () => {
  const combat = patched([TOKENED, TOKENLESS]);
  combat.manageGroup([{ id: "t-1" }]);
  assert.equal(notices.length, 1);
  await combat.rollInitiative(["c-none"]);
  assert.equal(notices.length, 1);
});

await test("a combat whose combatants all have tokens starts by the system's method, as before", async () => {
  const combat = patched([TOKENED, { id: "c-two", name: "Cedar", token: { id: "t-2", name: "Cedar" } }]);
  await combat.startCombat();
  assert.equal(calls.systemStart, 1);
  assert.equal(calls.foundryStart, 0);
  assert.equal(combat.getFlag("acks", "initDone"), undefined, "the system's own start sets it, not this patch");
  assert.equal(notices.length, 0);
  combat.manageGroup([{ id: "t-1" }]);
  assert.equal(calls.systemGroup, 1);
  assert.equal(notices.length, 0);
});

await test("a non-GM seat's Begin Combat goes to the system's method", async () => {
  const combat = patched([TOKENED, TOKENLESS]);
  game.user.isGM = false;
  await assert.rejects(combat.startCombat(), TypeError);
  assert.equal(calls.systemStart, 1);
  assert.equal(calls.foundryStart, 0);
  assert.equal(notices.length, 0);
});

console.log(`\n${passed} passed`);
