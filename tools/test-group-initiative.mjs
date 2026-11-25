/**
 * The group control's patch (scripts/lib/patches/group-initiative.mjs).
 *
 * Two stand-ins for the system's combat share one base whose `setFlag` lands
 * its write one macrotask after it is called and whose `getFlag` reads only what
 * has landed, as a Foundry client does. The defective stand-in's `manageGroup`
 * follows the system's 14.2.0 method: every stored group's bonus comes from the
 * tokens just passed, and the write is neither awaited nor returned. The fixed
 * stand-in computes each bonus from the group's own tokens and awaits its write.
 * What this pins is the correction's fingerprint, that the fixed system's list
 * is written untouched, that the shadow on `setFlag` is confined to one call and
 * to one write, and that the call hands back its write. That the system's real
 * method behaves so is the live recipe's to prove (docs/lib/TESTING.md). A combat
 * holding a combatant with no token is refused before the system's method, which
 * reads every combatant's token and throws on that one, is called.
 */
import assert from "node:assert/strict";

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

const tick = () => new Promise((r) => setTimeout(r, 0));
const warnings = [];
console.warn = (text) => warnings.push(String(text));
/** Every `ui.notifications.warn` text. */
const notices = [];
globalThis.ui = { notifications: { warn: (text) => notices.push(String(text)) } };
globalThis.game = { i18n: { format: (key, data = {}) => `${key} ${JSON.stringify(data)}` } };

/** Calls libWrapper registered, and the layers the fallback or libWrapper put on a prototype. */
const registrations = [];
globalThis.CONFIG = { Combat: { documentClass: null } };
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

/** Every write the base's real `setFlag` received, in order. */
const realWrites = [];

let combatCount = 0;

/** A combat stand-in: its combatants resolve each token id to an actor with an initiative value. */
class Base {
  constructor(inits) {
    this.id = `combat-${++combatCount}`;
    this.flags = {};
    this.combatants = Object.entries(inits).map(([id, value]) => ({ id: `c-${id}`, token: { id }, actor: { system: { initiative: { value } } } }));
  }

  getFlag(scope, key) {
    return structuredClone(this.flags[`${scope}.${key}`]);
  }

  setFlag(scope, key, value) {
    realWrites.push({ scope, key, value });
    return tick().then(() => {
      this.flags[`${scope}.${key}`] = structuredClone(value);
      return this;
    });
  }
}

/** The groups the combat holds once its writes have landed. */
const stored = (combat) => combat.flags["acks.groups"] ?? [];
const tok = (...ids) => ids.map((id) => ({ id }));

/** The system's method for the part both stand-ins share: refuse a token that is no combatant, make the group, take its tokens out of the others. */
function prepare(combat, groupTokens) {
  const present = combat.combatants.map((c) => c.token.id);
  if (groupTokens.some((t) => !present.includes(t.id))) return null;
  let groups = structuredClone(combat.getFlag("acks", "groups") || []);
  const groupId = groups.length;
  groups[groupId] = { initiative: -1, initiativeBonus: 1000, tokens: groupTokens.map((t) => t.id) };
  groups.forEach((groupData, id) => {
    if (id !== groupId) groupData.tokens = groupData.tokens.filter((tokenId) => !groupTokens.some((t) => t.id === tokenId));
  });
  return groups.filter((groupData) => groupData.tokens.length > 1);
}

/** A stand-in for the system's 14.2.0 method: each group's bonus is the lowest among the tokens just passed, and the write is dropped. */
function defectiveClass() {
  return class extends Base {
    manageGroup(groupTokens) {
      const groups = prepare(this, groupTokens);
      if (!groups) return;
      groups.forEach((groupData) => {
        groupData.initiativeBonus = 10000;
        groupTokens.forEach((t) => {
          const combatant = this.combatants.find((c) => c.token.id === t.id);
          if (combatant.actor.system.initiative.value < groupData.initiativeBonus) groupData.initiativeBonus = combatant.actor.system.initiative.value;
        });
      });
      this.setFlag("acks", "groups", groups);
    }
  };
}

/** A stand-in for a system with both fixes: each bonus from the group's own tokens, the write awaited and returned. */
function fixedClass() {
  return class extends Base {
    async manageGroup(groupTokens) {
      const groups = prepare(this, groupTokens);
      if (!groups) return;
      groups.forEach((groupData) => {
        groupData.initiativeBonus = 10000;
        groupData.tokens.forEach((tokenId) => {
          const combatant = this.combatants.find((c) => c.token.id === tokenId);
          if (!combatant?.actor) return;
          if (combatant.actor.system.initiative.value < groupData.initiativeBonus) groupData.initiativeBonus = combatant.actor.system.initiative.value;
        });
      });
      await this.setFlag("acks", "groups", groups);
    }
  };
}

const { installGroupInitiativePatch } = await import("../scripts/lib/patches/group-initiative.mjs");

/** Install the patch on `Cls` as the module does at `ready`. */
function patched(Cls) {
  CONFIG.Combat.documentClass = Cls;
  installGroupInitiativePatch();
  return Cls;
}

const INITS = { a1: 1, a2: 2, b1: 3, b2: 4, c1: 5, c2: 6 };

/** Make two groups the way a caller that waits on each call does, and return the stored list. */
async function twoGroups(Cls) {
  const combat = new Cls(INITS);
  await combat.manageGroup(tok("a1", "a2"));
  await combat.manageGroup(tok("b1", "b2"));
  return stored(combat);
}

await test("the defective stand-in shows both defects without the patch", async () => {
  const Cls = defectiveClass();
  const combat = new Cls(INITS);
  const returned = combat.manageGroup(tok("a1", "a2"));
  assert.equal(returned, undefined, "the call returns nothing to wait on");
  await combat.manageGroup(tok("b1", "b2"));
  await tick();
  await tick();
  assert.deepEqual(stored(combat).map((g) => g.tokens.join("+")), ["b1+b2"], "the second call read a list that lacked the first group");
  const both = new Cls(INITS);
  both.manageGroup(tok("a1", "a2"));
  await tick();
  both.manageGroup(tok("b1", "b2"));
  await tick();
  assert.deepEqual(stored(both).map((g) => g.initiativeBonus), [3, 3], "the first group took the second's lowest value");
});

await test("each group keeps the lowest value among its own tokens, and a caller awaiting each call keeps both groups", async () => {
  const list = await twoGroups(patched(defectiveClass()));
  assert.deepEqual(list.map((g) => [g.tokens.join("+"), g.initiativeBonus]), [["a1+a2", 1], ["b1+b2", 3]]);
});

await test("the call returns a thenable that resolves after the write has landed", async () => {
  const combat = new (patched(defectiveClass()))(INITS);
  const returned = combat.manageGroup(tok("a1", "a2"));
  assert.equal(typeof returned?.then, "function");
  assert.deepEqual(stored(combat), [], "the write has not landed when the call returns");
  await returned;
  assert.deepEqual(stored(combat).map((g) => g.tokens.join("+")), ["a1+a2"]);
});

await test("a third group is made on the two before it, each with its own lowest", async () => {
  const combat = new (patched(defectiveClass()))(INITS);
  for (const ids of [["a1", "a2"], ["b1", "b2"], ["c1", "c2"]]) await combat.manageGroup(tok(...ids));
  assert.deepEqual(stored(combat).map((g) => g.initiativeBonus), [1, 3, 5]);
});

await test("a group whose tokens were taken into the new one is corrected from the tokens it still has", async () => {
  const combat = new (patched(defectiveClass()))(INITS);
  await combat.manageGroup(tok("a1", "a2", "b1"));
  await combat.manageGroup(tok("b1", "b2"));
  const list = stored(combat);
  assert.deepEqual(list.map((g) => [g.tokens.join("+"), g.initiativeBonus]), [["a1+a2", 1], ["b1+b2", 3]]);
});

await test("on a system with both fixes the list written is the one it built, and the promise returned settles after its own", async () => {
  const Fixed = fixedClass();
  const without = await twoGroups(Fixed);
  const withPatch = await twoGroups(patched(fixedClass()));
  assert.deepEqual(withPatch, without);
  assert.deepEqual(withPatch.map((g) => g.initiativeBonus), [1, 3]);
  const combat = new (patched(fixedClass()))(INITS);
  const returned = combat.manageGroup(tok("a1", "a2"));
  assert.equal(typeof returned?.then, "function");
  await returned;
  assert.equal(stored(combat).length, 1);
});

await test("on a system with both fixes the real write receives the list the system built, uncorrected", async () => {
  patched(fixedClass());
  const Cls = CONFIG.Combat.documentClass;
  const combat = new Cls(INITS);
  realWrites.length = 0;
  await combat.manageGroup(tok("a1", "a2"));
  assert.equal(realWrites.length, 1);
  assert.deepEqual(realWrites[0].value.map((g) => g.initiativeBonus), [1]);
});

await test("a stale group whose tokens left the combat keeps the system's figure, and the rest are corrected", async () => {
  const combat = new (patched(defectiveClass()))(INITS);
  combat.flags["acks.groups"] = [{ initiative: -1, initiativeBonus: 3, tokens: ["gone1", "gone2"] }];
  await combat.manageGroup(tok("b1", "b2"));
  const list = stored(combat);
  assert.deepEqual(list.map((g) => [g.tokens.join("+"), g.initiativeBonus]), [["gone1+gone2", 3], ["b1+b2", 3]], "the stale group holds what the system wrote");
  combat.flags["acks.groups"] = [{ initiative: -1, initiativeBonus: 3, tokens: ["gone1", "gone2"] }];
  await combat.manageGroup(tok("a1", "a2"));
  assert.deepEqual(stored(combat).map((g) => g.initiativeBonus), [1, 1], "a stale group is never given a value it has no token for");
});

/** A stand-in whose method makes the writes named by `writes`, then returns what `after` says. */
function writingClass(writes, { throws = false, returns } = {}) {
  return class extends Base {
    manageGroup() {
      for (const [scope, key, value] of writes) this.setFlag(scope, key, value);
      if (throws) throw new Error("the system's method threw");
      return returns;
    }
  };
}

await test("a write of another scope or key, or a value that is no array, goes straight to the real setFlag", async () => {
  const groups = [{ initiative: -1, initiativeBonus: 1, tokens: ["a1", "a2"] }];
  const writes = [["world", "groups", groups], ["acks", "other", groups], ["acks", "groups", "not a list"], ["acks", "groups", { 0: groups[0] }]];
  const combat = new (patched(writingClass(writes)))(INITS);
  realWrites.length = 0;
  const returned = combat.manageGroup(tok("b1", "b2"));
  assert.equal(returned, undefined, "no group write was caught, so the system's own return stands");
  assert.equal(realWrites.length, 4);
  realWrites.forEach((w, i) => assert.equal(w.value, writes[i][2], `write ${i} is the very value the system passed`));
  await tick();
});

await test("a list of an odd shape is written as the system built it", async () => {
  const odd = [null, 5, { initiativeBonus: 1, tokens: "a1" }, { tokens: ["a1", "a2"] }, { initiativeBonus: 4 }, { initiative: -1, initiativeBonus: 9, tokens: ["a1", "a2"] }];
  const combat = new (patched(writingClass([["acks", "groups", odd]])))(INITS);
  realWrites.length = 0;
  await combat.manageGroup(tok("a1", "a2"));
  assert.equal(realWrites.length, 1);
  assert.equal(realWrites[0].value, odd, "nothing matched the fingerprint, so the same array is written");
  assert.deepEqual(stored(combat), odd);
});

await test("the shadow is confined to the call: after it, setFlag is the class's own again", async () => {
  const Cls = patched(defectiveClass());
  const combat = new Cls(INITS);
  const returned = combat.manageGroup(tok("a1", "a2"));
  assert.equal(Object.hasOwn(combat, "setFlag"), false);
  assert.equal(combat.setFlag, Base.prototype.setFlag);
  await returned;
  realWrites.length = 0;
  await combat.setFlag("acks", "groups", [{ initiative: -1, initiativeBonus: 77, tokens: ["a1", "a2"] }]);
  assert.equal(stored(combat)[0].initiativeBonus, 77, "a write of the same scope and key made after the call is not corrected");
});

await test("the shadow is gone after the system's method throws, and the error is the system's", async () => {
  const groups = [{ initiative: -1, initiativeBonus: 1, tokens: ["a1", "a2"] }];
  const Cls = patched(writingClass([["acks", "groups", groups]], { throws: true }));
  const combat = new Cls(INITS);
  assert.throws(() => combat.manageGroup(tok("a1", "a2")), /the system's method threw/);
  assert.equal(Object.hasOwn(combat, "setFlag"), false);
  assert.equal(combat.setFlag, Base.prototype.setFlag);
  await tick();
});

await test("an own setFlag the combat already carried comes back after the call", async () => {
  const Cls = patched(defectiveClass());
  const combat = new Cls(INITS);
  const calls = [];
  const own = function (...args) { calls.push(args[1]); return Base.prototype.setFlag.apply(this, args); };
  combat.setFlag = own;
  await combat.manageGroup(tok("a1", "a2"));
  assert.equal(combat.setFlag, own);
  assert.deepEqual(calls, ["groups"], "the write still went through the combat's own setFlag");
});

await test("a call the system refuses before it writes returns what the system returns", async () => {
  const Cls = patched(defectiveClass());
  const combat = new Cls(INITS);
  realWrites.length = 0;
  assert.equal(combat.manageGroup(tok("a1", "not-a-combatant")), undefined);
  assert.equal(realWrites.length, 0);
  assert.equal(Object.hasOwn(combat, "setFlag"), false);
});

await test("a combatant with no actor is not counted in its group's lowest value", async () => {
  const groups = () => [{ initiative: -1, initiativeBonus: 3, tokens: ["a1", "a2", "x9"] }];
  const Cls = patched(writingClass([["acks", "groups", groups()]]));
  const bare = new Cls(INITS);
  bare.combatants.find((c) => c.token.id === "a1").actor = null;
  await bare.manageGroup(tok("b1", "b2"));
  assert.equal(stored(bare)[0].initiativeBonus, 2, "the combatant with no actor is not counted");
});

/** A system stand-in whose method reads the token of every combatant, as the system's does, and records its calls. */
function readingClass() {
  const calls = [];
  const Cls = class extends fixedClass() {
    async manageGroup(groupTokens) {
      calls.push(groupTokens);
      for (const c of this.combatants) void c.token.id;
      return super.manageGroup(groupTokens);
    }
  };
  return { Cls, calls };
}

await test("a combat holding a tokenless row refuses the group before the system's method, shows its one notice naming the row and does not throw", async () => {
  const { Cls, calls } = readingClass();
  patched(Cls);
  const combat = new Cls(INITS);
  combat.combatants.push({ id: "c-none", name: "Birch", token: null, actor: null });
  notices.length = 0;
  realWrites.length = 0;
  const returned = await combat.manageGroup(tok("a1", "a2"));
  assert.equal(returned, undefined, "returns what the system's own refusals return");
  assert.equal(calls.length, 0, "the system's method is not called");
  assert.equal(realWrites.length, 0, "nothing is written");
  assert.equal(notices.length, 1);
  assert.match(notices[0], /Birch/);
  assert.equal(Object.hasOwn(combat, "setFlag"), false);
  await combat.manageGroup(tok("a1", "a2"));
  assert.equal(notices.length, 1, "the combat is told once, and a second press is refused as quietly");
  assert.equal(calls.length, 0);
});

await test("a combat whose combatants all have tokens is not refused, and is not warned about", async () => {
  const { Cls, calls } = readingClass();
  const combat = new (patched(Cls))(INITS);
  notices.length = 0;
  await combat.manageGroup(tok("a1", "a2"));
  assert.equal(calls.length, 1);
  assert.equal(notices.length, 0);
  assert.deepEqual(stored(combat).map((g) => g.tokens.join("+")), ["a1+a2"]);
});

await test("a second install adds no second layer", async () => {
  const Cls = defectiveClass();
  CONFIG.Combat.documentClass = Cls;
  registrations.length = 0;
  installGroupInitiativePatch();
  installGroupInitiativePatch();
  assert.equal(registrations.length, 1);
  assert.deepEqual(registrations[0], { id: "acks-extras", target: "CONFIG.Combat.documentClass.prototype.manageGroup", type: "WRAPPER" });
  const list = await twoGroups(Cls);
  assert.deepEqual(list.map((g) => g.initiativeBonus), [1, 3]);
});

await test("without libWrapper the method is replaced once, and a second install leaves it as it is", async () => {
  const saved = globalThis.libWrapper;
  delete globalThis.libWrapper;
  try {
    const Cls = defectiveClass();
    CONFIG.Combat.documentClass = Cls;
    installGroupInitiativePatch();
    const first = Cls.prototype.manageGroup;
    installGroupInitiativePatch();
    assert.equal(Cls.prototype.manageGroup, first);
    const list = await twoGroups(Cls);
    assert.deepEqual(list.map((g) => g.initiativeBonus), [1, 3]);
    const combat = new Cls(INITS);
    assert.equal(typeof combat.manageGroup(tok("a1", "a2"))?.then, "function");
    await tick();
  } finally {
    globalThis.libWrapper = saved;
  }
});

await test("a combat class with no manageGroup is warned about and left alone", async () => {
  warnings.length = 0;
  CONFIG.Combat.documentClass = class {};
  installGroupInitiativePatch();
  assert.equal(warnings.length, 1);
  CONFIG.Combat = undefined;
  installGroupInitiativePatch();
  assert.equal(warnings.length, 2);
});

console.log(`\n${passed} passed`);
