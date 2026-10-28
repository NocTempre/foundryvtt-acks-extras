/**
 * The Surprise Matrix's pools and its failed roll (scripts/lib/patches/surprise-card.mjs).
 *
 * Stand-in hooks, notices and matrix: what this pins is that a combatant with
 * no surprise figures is taken out of the matrix's own pools before core
 * rolls, that a roll core throws out of is caught and named rather than lost,
 * and which side the notice names. That core's matrix then rolls and starts
 * the combat is the live recipe's to prove (docs/lib/TESTING.md).
 */
import assert from "node:assert/strict";

let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

const hooks = {};
const notices = { info: [], error: [] };
globalThis.Hooks = {
  on: (name, fn) => { (hooks[name] ??= []).push(fn); },
  off: (name, fn) => { hooks[name] = (hooks[name] ?? []).filter((f) => f !== fn); },
};
globalThis.game = {
  settings: { get: () => false },
  i18n: { localize: (k) => k, format: (k, d = {}) => (Object.keys(d).length ? `${k}|${Object.values(d).join(",")}` : k), has: () => true },
};
globalThis.ui = { notifications: { info: (m) => notices.info.push(m), error: (m) => notices.error.push(m) } };
const quiet = console.error;

const { installSurpriseCardPatch, leaveOutUnrollable, emptySides } = await import("../scripts/lib/patches/surprise-card.mjs");
installSurpriseCardPatch();

const combatant = (name, surprise = { surpriseothers: 0, avoidsurprise: 0 }) => ({ name, actor: { name, system: surprise ? { surprise } : {} } });
const pools = () => ({
  friendly: [combatant("Fighter"), combatant("Party", null)],
  hostile: [combatant("Orc"), { name: "Ghost", actor: null }],
  neutral: [],
  secret: [],
});

/** A matrix whose core action reads every combatant's figures, as core's does. */
function matrix(poolSet) {
  const reached = [];
  const core = async function () {
    const all = Object.values(this.options.pools).flat();
    for (const c of all) void c.actor.system.surprise.avoidsurprise;
    if (!this.options.pools.friendly.length) throw new Error("Unresolved StringTerm -Infinity requested for evaluation");
    reached.push(all.map((c) => c.name));
  };
  const app = { options: { classes: ["surprise-matrix-app"], actions: { rollSurprise: core }, pools: poolSet } };
  hooks.renderApplicationV2.forEach((fn) => fn(app));
  return { app, reached };
}
const click = (app) => app.options.actions.rollSurprise.call(app, {}, {});

await ok("a combatant with no actor or no surprise figures leaves the pools; the rest stay", () => {
  const p = pools();
  assert.deepEqual(leaveOutUnrollable(p), ["Party", "Ghost"]);
  assert.deepEqual(p.friendly.map((c) => c.name), ["Fighter"]);
  assert.deepEqual(p.hostile.map((c) => c.name), ["Orc"]);
});

await ok("a side with nothing left is named", () => {
  assert.deepEqual(emptySides({ friendly: [], hostile: [combatant("Orc")] }), ["adventurers"]);
  assert.deepEqual(emptySides({ friendly: [combatant("Fighter")], neutral: [combatant("Orc")] }), []);
});

await ok("core rolls the pools with the unrollable combatants left out, and the user is told who", async () => {
  notices.info.length = notices.error.length = 0;
  const { app, reached } = matrix(pools());
  await click(app);
  assert.deepEqual(reached, [["Fighter", "Orc"]]);
  assert.deepEqual(notices.info, ["ACKS-LIB.surprise.leftOut|Party, Ghost"]);
  assert.deepEqual(notices.error, []);
});

await ok("a roll core throws out of is caught, and the notice names the side left empty", async () => {
  notices.info.length = notices.error.length = 0;
  console.error = () => {};
  try {
    const { app, reached } = matrix({ friendly: [combatant("Party", null)], hostile: [combatant("Orc")], neutral: [], secret: [] });
    await click(app);
    assert.deepEqual(reached, []);
  } finally {
    console.error = quiet;
  }
  assert.deepEqual(notices.error, ["ACKS-LIB.surprise.sideEmpty|ACKS-LIB.surprise.adventurers"]);
});

await ok("any other throw is caught with the general notice", async () => {
  notices.error.length = 0;
  const app = { options: { classes: ["surprise-matrix-app"], actions: { rollSurprise: async () => { throw new Error("boom"); } }, pools: pools() } };
  hooks.renderApplicationV2.forEach((fn) => fn(app));
  console.error = () => {};
  try {
    await click(app);
  } finally {
    console.error = quiet;
  }
  assert.deepEqual(notices.error, ["ACKS-LIB.surprise.failed"]);
});

console.log(`\n${passed} passed`);
