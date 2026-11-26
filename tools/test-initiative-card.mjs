/**
 * The initiative roll's wrap (scripts/lib/patches/initiative-card.mjs).
 *
 * A stand-in for the system's combat follows the 14.2.0 method: it sets the
 * turn-order lock, reads `token.id` of every id it is given (a null token throws
 * a TypeError, as the real loop does), then reads the token of EVERY combatant
 * in the combat (the real pools pass does, and a null token throws there too),
 * writes each number, and sets the lock back last. A stand-in for Foundry's
 * `Combat` rolls whatever it is handed and records the call. What this pins is
 * that a combat holding a combatant with no token sends the whole press to
 * Foundry's method and never to the wrapped one, once-per-combat warning
 * included, that any other combat is the wrapped call as it was, and that a
 * throw from either path leaves the lock false and still reaches the caller.
 * That the real methods behave so is the live recipe's to prove
 * (docs/lib/TESTING.md, steps 12 and 13 of the steps list).
 */
import assert from "node:assert/strict";
import { contractLibWrapper } from "./lib-wrapper-contract.mjs";

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

const warnings = [];
console.warn = (text) => warnings.push(String(text));

/** Registered `preCreateChatMessage` listeners, and every `ChatMessage.create` call. */
const listeners = new Set();
const created = [];
const settings = { initiativeCard: false };
/** Every `ui.notifications.warn` text. */
const notices = [];

globalThis.ui = { notifications: { warn: (text) => notices.push(String(text)) } };
globalThis.CONFIG = { Combat: { documentClass: null } };
globalThis.foundry = { utils: { escapeHTML: (s) => String(s) }, documents: {} };
globalThis.Hooks = { on: (_n, fn) => listeners.add(fn), off: (_n, fn) => listeners.delete(fn) };
globalThis.ChatMessage = { create: async (data) => { created.push(data); } };
globalThis.game = {
  user: { id: "gm-1", isGM: true },
  users: [{ id: "gm-1", isGM: true }],
  settings: { get: (_module, key) => settings[key] },
  i18n: {
    format: (key, data = {}) => (key === "ACKS.roll.individualInit" ? `ROLLS ${data.name}` : `${key} ${JSON.stringify(data)}`),
  },
};
/* libWrapper as the library behaves: a WRAPPER that settles without chaining is unregistered. */
const lib = contractLibWrapper();
globalThis.libWrapper = lib;

/** What each stand-in method was handed, in order. */
const foundryCalls = [];
const systemCalls = [];

/** Foundry's own `Combat`: rolls every id it is handed (one id may be a bare string), the number 4. */
class FoundryCombat {
  async rollInitiative(ids, options) {
    const list = typeof ids === "string" ? [ids] : [...ids];
    foundryCalls.push({ ids: list, options });
    if (this.foundryFailWith) throw this.foundryFailWith;
    for (const id of list) {
      const c = this.combatants.get(id);
      if (c) c.initiative = 4;
    }
    return this;
  }
}
globalThis.foundry.documents.Combat = FoundryCombat;

let combatCount = 0;

/** A subclass the way the system's is: its own `rollInitiative` over Foundry's. */
function makeSystemClass() {
  return class extends FoundryCombat {
    constructor(rows) {
      super();
      this.id = `combat-${++combatCount}`;
      this.flags = {};
      this.failWith = null;
      this.foundryFailWith = null;
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
  notices.length = 0;
  listeners.clear();
  return new Cls(rows);
}

for (const card of [false, true]) {
  const mode = card ? "card on" : "card off";

  await test(`${mode}: a combat holding a tokenless row rolls the whole press by Foundry's method, numbers both rows, posts no card and warns once naming the row`, async () => {
    const combat = patched({ card });
    const options = { formula: null };
    await combat.rollInitiative(["c-none", "c-tok"], options);
    assert.deepEqual(foundryCalls.map((c) => c.ids), [["c-none", "c-tok"]]);
    assert.equal(foundryCalls[0].options, options, "the caller's options go through as given");
    assert.equal(systemCalls.length, 0, "the wrapped method is never called");
    assert.equal(combat.combatants.get("c-none").initiative, 4);
    assert.equal(combat.combatants.get("c-tok").initiative, 4);
    assert.equal(combat.getFlag("acks", "lock-turns"), undefined, "the lock is never set");
    assert.equal(created.length, 0, "no consolidated card for this press");
    assert.equal(notices.length, 1);
    assert.match(notices[0], /Birch/);
    assert.doesNotMatch(notices[0], /Ash/);
    await combat.rollInitiative(["c-none", "c-tok"]);
    assert.equal(foundryCalls.length, 2, "a second press goes the same way");
    assert.equal(notices.length, 1, "and warns no more");
  });

  await test(`${mode}: a press of only the tokened id in that combat is still Foundry's method`, async () => {
    const combat = patched({ card });
    await combat.rollInitiative("c-tok");
    assert.deepEqual(foundryCalls.map((c) => c.ids), [["c-tok"]]);
    assert.equal(systemCalls.length, 0);
    assert.equal(combat.combatants.get("c-tok").initiative, 4);
    assert.equal(notices.length, 1);
  });

  await test(`${mode}: no tokenless combatant leaves the call as it was`, async () => {
    const combat = patched({ card, rows: [TOKENED] });
    const ids = ["c-tok"];
    const options = { formula: null };
    await combat.rollInitiative(ids, options);
    assert.equal(systemCalls.length, 1);
    assert.equal(systemCalls[0].ids[0], "c-tok");
    assert.equal(systemCalls[0].options, options);
    assert.equal(foundryCalls.length, 0);
    assert.equal(notices.length, 0);
    assert.equal(created.length, card ? 1 : 0, "the card is posted only when the setting is on");
  });

  await test(`${mode}: the wrapped method throwing for its own reason reaches the caller and leaves the lock false`, async () => {
    const combat = patched({ card, rows: [TOKENED] });
    combat.failWith = new Error("the roll failed for its own reasons");
    await assert.rejects(combat.rollInitiative(["c-tok"]), /its own reasons/);
    assert.equal(combat.getFlag("acks", "lock-turns"), false);
    assert.equal(listeners.size, 0, "the capture hook is off again");
  });

  await test(`${mode}: Foundry's method throwing reaches the caller and leaves the lock false`, async () => {
    const combat = patched({ card });
    await combat.setFlag("acks", "lock-turns", true);
    combat.foundryFailWith = new Error("Foundry's roll failed");
    await assert.rejects(combat.rollInitiative(["c-none", "c-tok"]), /Foundry's roll failed/);
    assert.equal(combat.getFlag("acks", "lock-turns"), false);
    assert.equal(notices.length, 0, "a press that failed is not announced as rolled");
  });
}

await test("each combat is warned about once, naming every tokenless row", async () => {
  const first = patched({ rows: [TOKENED, TOKENLESS, { id: "c-two", name: "Cedar", token: null }] });
  const second = new first.constructor([TOKENED, TOKENLESS]);
  await first.rollInitiative(["c-tok"]);
  await first.rollInitiative(["c-tok"]);
  await second.rollInitiative(["c-tok"]);
  assert.equal(notices.length, 2);
  assert.match(notices[0], /Birch, Cedar/);
  assert.doesNotMatch(notices[1], /Cedar/);
});

await test("the wrap is registered MIXED and stays on the class across repeated presses in a tokenless combat", async () => {
  lib.errors.length = 0;
  const combat = patched({ rows: [TOKENED, TOKENLESS] });
  assert.equal(lib.registrations.at(-1).type, "MIXED");
  for (let n = 0; n < 3; n++) {
    for (const c of combat.combatants.values()) c.initiative = null;
    await combat.rollInitiative(["c-tok", "c-none"]);
  }
  assert.equal(foundryCalls.length, 3, "every press goes to Foundry's method");
  assert.equal(systemCalls.length, 0);
  assert.deepEqual(lib.errors, []);
});

await test("a lock a system roll left set is cleared before Foundry's roll in a tokenless combat", async () => {
  const combat = patched({ rows: [TOKENED, TOKENLESS] });
  combat.flags["acks.lock-turns"] = true;
  await combat.rollInitiative(["c-none"]);
  assert.equal(combat.getFlag("acks", "lock-turns"), false);
  assert.equal(combat.combatants.get("c-none").initiative, 4);
});

await test("a lock that cannot be released warns and the original error still arrives", async () => {
  const combat = patched({ rows: [TOKENED] });
  combat.failWith = new Error("the roll failed for its own reasons");
  const set = combat.setFlag.bind(combat);
  combat.setFlag = async (scope, key, value) => {
    if (value === false) throw new Error("the flag write failed");
    return set(scope, key, value);
  };
  await assert.rejects(combat.rollInitiative(["c-tok"]), /its own reasons/);
  assert.equal(warnings.length, 1);
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
  assert.equal(notices.length, 0);
});

await test("a class that does not override Foundry's method has nothing to split", async () => {
  // The wrap goes on Foundry's own class: the chain above it never reaches
  // `foundry.documents.Combat`, so every id stays with the wrapped method.
  const original = FoundryCombat.prototype.rollInitiative;
  CONFIG.Combat.documentClass = FoundryCombat;
  installInitiativeCardPatch();
  settings.initiativeCard = false;
  foundryCalls.length = 0;
  notices.length = 0;
  const combat = Object.assign(new FoundryCombat(), {
    combatants: new Map([["c-none", { ...TOKENLESS, initiative: null }]]),
  });
  await combat.rollInitiative(["c-none"]);
  assert.deepEqual(foundryCalls.map((c) => c.ids), [["c-none"]], "rolled once, by the one method there is");
  assert.equal(notices.length, 0, "no warning where no hand-off was made");
  FoundryCombat.prototype.rollInitiative = original;
});

console.log(`\n${passed} passed`);
