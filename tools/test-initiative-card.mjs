/**
 * The initiative roll's wrap (scripts/lib/patches/initiative-card.mjs).
 *
 * A stand-in for the system's combat follows the 14.2.0 method: it sets the
 * turn-order lock, reads `token.id` of every id it is given (a null token throws
 * a TypeError, as the real loop does), then reads the token of EVERY combatant
 * in the combat (the real pools pass does, and a null token throws there too),
 * writes each number, and sets the lock back last. `readsEveryToken = false`
 * stands for a system that no longer reads them. A stand-in for Foundry's
 * `Combat` rolls whatever it is handed and records the call. What this pins is
 * which ids reach which method, that the card gathers only the wrapped method's
 * ids, and that a throw leaves the lock false and still reaches the caller. That
 * the real methods behave so is the live recipe's to prove (docs/lib/TESTING.md,
 * steps 12 and 13 of the steps list).
 */
import assert from "node:assert/strict";

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

const warnings = [];
console.warn = (text) => warnings.push(String(text));

/** Registered `preCreateChatMessage` listeners, and every `ChatMessage.create` call. */
const listeners = new Set();
const created = [];
const settings = { initiativeCard: false };

globalThis.CONFIG = { Combat: { documentClass: null } };
globalThis.foundry = { utils: { escapeHTML: (s) => String(s) }, documents: {} };
globalThis.Hooks = { on: (_n, fn) => listeners.add(fn), off: (_n, fn) => listeners.delete(fn) };
globalThis.ChatMessage = { create: async (data) => { created.push(data); } };
globalThis.game = {
  user: { id: "gm-1", isGM: true },
  users: [{ id: "gm-1", isGM: true }],
  settings: { get: (_module, key) => settings[key] },
  i18n: {
    format: (key, data = {}) => (key === "ACKS.roll.individualInit" ? `ROLLS ${data.name}` : key),
  },
};
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
const foundryCalls = [];
const systemCalls = [];

/** Foundry's own `Combat`: rolls every id it is handed, the number 4. */
class FoundryCombat {
  async rollInitiative(ids, options) {
    foundryCalls.push({ ids: [...ids], options });
    for (const id of ids) {
      const c = this.combatants.get(id);
      if (c) c.initiative = 4;
    }
    return this;
  }
}
globalThis.foundry.documents.Combat = FoundryCombat;

/** A subclass the way the system's is: its own `rollInitiative` over Foundry's. */
function makeSystemClass() {
  return class extends FoundryCombat {
    constructor(rows) {
      super();
      this.flags = {};
      this.failWith = null;
      this.readsEveryToken = true;
      this.combatants = new Map(rows.map((r) => [r.id, { initiative: null, hidden: false, ...r }]));
    }

    getFlag(scope, key) { return this.flags[`${scope}.${key}`]; }

    async setFlag(scope, key, value) { this.flags[`${scope}.${key}`] = value; return this; }

    async rollInitiative(ids, options) {
      systemCalls.push({ ids: [...ids], options });
      await this.setFlag("acks", "lock-turns", true);
      const updates = [];
      for (const id of ids) {
        const c = this.combatants.get(id);
        const tokenId = c.token.id;
        if (this.failWith) throw this.failWith;
        updates.push([c, 9]);
        const data = { author: "gm-1", speaker: { token: tokenId }, flavor: `ROLLS ${c.token.name}` };
        for (const fn of [...listeners]) fn({}, data);
      }
      // The pools and out-numbering passes read the disposition of EVERY combatant's token,
      // not only of the ids rolled, and run before the numbers are written.
      if (this.readsEveryToken) for (const c of this.combatants.values()) void c.token.disposition;
      for (const [c, value] of updates) c.initiative = value;
      await this.setFlag("acks", "lock-turns", false);
      return this;
    }
  };
}

const { installInitiativeCardPatch } = await import("../scripts/lib/patches/initiative-card.mjs");

const TOKENED = { id: "c-tok", name: "Ash", token: { id: "t-1", name: "Ash", hidden: false } };
const TOKENLESS = { id: "c-none", name: "Birch", token: null };

/** Install the wrap on a fresh class as the module does at `ready`, and make a combat of two rows. */
function patched({ card = false, rows = [TOKENED, TOKENLESS] } = {}) {
  const Cls = makeSystemClass();
  CONFIG.Combat.documentClass = Cls;
  installInitiativeCardPatch();
  settings.initiativeCard = card;
  game.user.isGM = true;
  foundryCalls.length = 0;
  systemCalls.length = 0;
  created.length = 0;
  warnings.length = 0;
  listeners.clear();
  return new Cls(rows);
}

for (const card of [false, true]) {
  const mode = card ? "card on" : "card off";

  await test(`${mode}: the system's pools pass over every token still throws in a combat holding a tokenless row; the tokenless row is rolled, the lock is released, the error arrives`, async () => {
    const combat = patched({ card });
    await assert.rejects(combat.rollInitiative(["c-none", "c-tok"]), TypeError);
    assert.deepEqual(foundryCalls.map((c) => c.ids), [["c-none"]]);
    assert.deepEqual(systemCalls.map((c) => c.ids), [["c-tok"]]);
    assert.equal(combat.combatants.get("c-none").initiative, 4);
    assert.equal(combat.combatants.get("c-tok").initiative, null, "the system wrote nothing");
    assert.equal(combat.getFlag("acks", "lock-turns"), false);
    assert.equal(created.length, 0, "no card where the roll threw");
  });

  await test(`${mode}: a system that reads no other token rolls both rows, each from its own method`, async () => {
    const combat = patched({ card });
    combat.readsEveryToken = false;
    const options = { formula: null };
    await combat.rollInitiative(["c-none", "c-tok"], options);
    assert.deepEqual(systemCalls.map((c) => c.ids), [["c-tok"]], "the system's method receives only the tokened id");
    assert.deepEqual(foundryCalls.map((c) => c.ids), [["c-none"]], "Foundry's receives only the tokenless one");
    assert.equal(foundryCalls[0].options.updateTurn, false);
    assert.equal(combat.combatants.get("c-tok").initiative, 9);
    assert.equal(combat.combatants.get("c-none").initiative, 4);
    assert.equal(combat.getFlag("acks", "lock-turns"), false);
    if (card) {
      assert.equal(created.length, 1, "one card, for the wrapped method's rows");
      assert.match(created[0].content, /Ash/);
      assert.doesNotMatch(created[0].content, /Birch/);
    } else {
      assert.equal(created.length, 0);
    }
  });

  await test(`${mode}: only tokenless ids never call the wrapped method`, async () => {
    const combat = patched({ card });
    const result = await combat.rollInitiative("c-none");
    assert.equal(systemCalls.length, 0);
    assert.deepEqual(foundryCalls.map((c) => c.ids), [["c-none"]]);
    assert.equal(combat.combatants.get("c-none").initiative, 4);
    assert.equal(result, combat);
    assert.equal(created.length, 0);
  });

  await test(`${mode}: no tokenless id leaves the call unchanged`, async () => {
    const combat = patched({ card, rows: [TOKENED] });
    const ids = ["c-tok"];
    const options = { formula: null };
    await combat.rollInitiative(ids, options);
    assert.equal(systemCalls.length, 1);
    assert.equal(systemCalls[0].ids[0], "c-tok");
    assert.equal(systemCalls[0].options, options);
    assert.equal(foundryCalls.length, 0);
  });

  await test(`${mode}: a throw for another reason reaches the caller and leaves the lock false`, async () => {
    const combat = patched({ card });
    combat.failWith = new Error("the roll failed for its own reasons");
    await assert.rejects(combat.rollInitiative(["c-tok"]), /its own reasons/);
    assert.equal(combat.getFlag("acks", "lock-turns"), false);
    assert.equal(listeners.size, 0, "the capture hook is off again");
  });
}

await test("a tokenless row rolled beside a failing tokened one: the error still arrives, the lock ends false", async () => {
  const combat = patched();
  combat.failWith = new Error("the roll failed for its own reasons");
  await assert.rejects(combat.rollInitiative(["c-none", "c-tok"]), /its own reasons/);
  assert.equal(combat.getFlag("acks", "lock-turns"), false);
  assert.equal(combat.combatants.get("c-none").initiative, 4);
});

await test("a lock that cannot be released warns and the original error still arrives", async () => {
  const combat = patched();
  combat.failWith = new Error("the roll failed for its own reasons");
  const set = combat.setFlag.bind(combat);
  combat.setFlag = async (scope, key, value) => {
    if (value === false) throw new Error("the flag write failed");
    return set(scope, key, value);
  };
  await assert.rejects(combat.rollInitiative(["c-tok"]), /its own reasons/);
  assert.equal(warnings.length, 1);
});

await test("an id with no combatant is Foundry's to skip, and does not abort the rest", async () => {
  const combat = patched({ rows: [TOKENED] });
  await combat.rollInitiative(["gone", "c-tok"]);
  assert.deepEqual(foundryCalls.map((c) => c.ids), [["gone"]]);
  assert.deepEqual(systemCalls.map((c) => c.ids), [["c-tok"]]);
});

await test("a non-GM caller is passed straight through", async () => {
  const combat = patched({ card: true });
  game.user.isGM = false;
  const options = { formula: null };
  await combat.rollInitiative(["c-none", "c-tok"], options).catch(() => {});
  assert.equal(foundryCalls.length, 0);
  assert.equal(systemCalls.length, 1);
  assert.deepEqual(systemCalls[0].ids, ["c-none", "c-tok"]);
  assert.equal(systemCalls[0].options, options);
});

await test("a class that does not override Foundry's method has nothing to split", async () => {
  // The wrap goes on Foundry's own class: the chain above it never reaches
  // `foundry.documents.Combat`, so every id stays with the wrapped method.
  const original = FoundryCombat.prototype.rollInitiative;
  CONFIG.Combat.documentClass = FoundryCombat;
  installInitiativeCardPatch();
  settings.initiativeCard = false;
  foundryCalls.length = 0;
  const combat = Object.assign(new FoundryCombat(), {
    combatants: new Map([["c-none", { ...TOKENLESS, initiative: null }]]),
  });
  await combat.rollInitiative(["c-none"]);
  assert.deepEqual(foundryCalls.map((c) => c.ids), [["c-none"]], "rolled once, by the one method there is");
  FoundryCombat.prototype.rollInitiative = original;
});

console.log(`\n${passed} passed`);
