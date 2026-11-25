/**
 * Offline tests for the cast gate (`scripts/magic/cast-gate.mjs`): the claimant
 * on the cast seam that takes a spell the cast window declines, on a class that
 * casts from a list. Foundry-free; every class, list and spell below is
 * invented, so this file carries no book content.
 *
 * Usage: node tools/test-cast-gate.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.foundry = { utils: { escapeHTML: (s) => String(s) } };
globalThis.game = { i18n: { format: (key) => key, localize: (key) => key } };
globalThis.Roll = class {};

const { castGateClaims, castGateRun, castGateClaimant, registerCastGate, CAST_GATE_KEY } = await import("../scripts/magic/cast-gate.mjs");
const { CAST_SPELL_KEY } = await import("../scripts/magic/cast-spell.mjs");
const { listTraditions } = await import("../scripts/magic/cast-capacity.mjs");

const LANG = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));

let n = 0;
const ta = async (name, fn) => {
  await fn();
  n++;
  console.log(`ok - ${name}`);
};

/** An invented class casting from two lists. */
const classItem = (casting = [{ key: "alpha", label: "Alpha", kind: "vancian" }, { key: "beta", label: "Beta", kind: "vancian" }]) => ({ system: { casting } });

/** An invented actor holding one spell standing on the given lists (`[source, level]` pairs). */
function owned(lists, { isOwner = true, coreSpells = {}, spellExtras = {} } = {}) {
  const actor = { isOwner, items: [], system: { details: { level: 5 }, spells: coreSpells }, getFlag: () => undefined };
  const spell = {
    type: "spell",
    name: "Testbolt",
    flags: { "acks-extras": { spell: { lists: lists.map(([source, level]) => ({ source, level })), ...spellExtras } } },
    system: { lvl: lists[0]?.[1] ?? 1, cast: 0 },
    parent: actor,
  };
  actor.items.push(spell);
  return spell;
}

/** The pools of `poolState`'s shape: one slot row per `[tradition, level, max, used]`. */
const poolsOf = (...rows) => {
  const out = [];
  for (const [key, level, max, used] of rows) {
    let entry = out.find((p) => p.key === key);
    if (!entry) out.push((entry = { key, kind: "vancian", slots: [] }));
    entry.slots.push({ n: level, max, used });
  }
  return out;
};

/** The dependencies of a run, recorded. */
function runDeps({ isGM = false, pools = [], klass = classItem(), spent = true } = {}) {
  const calls = { notices: [], spends: 0, pools: [] };
  return {
    calls,
    spend: async () => {
      calls.spends++;
      return spent;
    },
    deps: {
      classFor: () => klass,
      pools: async () => pools,
      adjustPool: async (...args) => calls.pools.push(args.slice(1)),
      isGM: () => isGM,
      notify: (level, key) => calls.notices.push([level, key]),
    },
  };
}

const run = (spell, options, setup) => {
  const made = runDeps(setup);
  return castGateRun(spell, options, made.spend, made.deps).then((result) => ({ result, calls: made.calls }));
};

await ta("the gate takes a spell on an owned actor whose class casts from a list, and declines everything else", () => {
  const classFor = () => classItem();
  const spell = owned([["alpha", 2]]);
  assert.equal(castGateClaims(spell, classFor), true);
  assert.equal(castGateClaims({ ...spell, type: "weapon" }, classFor), false, "a non-spell");
  assert.equal(castGateClaims(owned([["alpha", 2]], { isOwner: false }), classFor), false, "an actor the seat does not own");
  assert.equal(castGateClaims(spell, () => null), false, "no class bound");
  assert.equal(castGateClaims(spell, () => classItem([])), false, "a class that casts from no list");
  assert.equal(castGateClaims(spell, () => classItem([{ label: "Keyless", kind: "vancian" }])), false, "a tradition with no key is no list");
  assert.equal(castGateClaims(spell, null), false, "no lookup");
  assert.equal(castGateClaims({ ...spell, parent: null }, classFor), false, "an unowned item");
  assert.equal(listTraditions(classItem().system.casting).length, 2);
});

await ta("a Player's cast of a spell on none of the class's lists is refused: no spend, no pool write, the blocked notice", async () => {
  const { result, calls } = await run(owned([["gamma", 2]]), {}, { pools: poolsOf(["alpha", 2, 2, 0]) });
  assert.deepEqual(result, { ok: false, reason: "offList" });
  assert.equal(calls.spends, 0);
  assert.deepEqual(calls.pools, []);
  assert.deepEqual(calls.notices, [["warn", "blocked.offList"]]);
});

await ta("a Player's cast at a level whose slots are all used is refused the same way", async () => {
  const { result, calls } = await run(owned([["alpha", 2]]), {}, { pools: poolsOf(["alpha", 2, 2, 2]) });
  assert.deepEqual(result, { ok: false, reason: "noSlot" });
  assert.equal(calls.spends, 0);
  assert.deepEqual(calls.pools, []);
  assert.deepEqual(calls.notices, [["warn", "blocked.noSlot"]]);
});

await ta("a Judge's off-list cast is warned and goes on, and spends no slot", async () => {
  const { result, calls } = await run(owned([["gamma", 2]]), {}, { isGM: true, pools: poolsOf(["alpha", 2, 2, 0]) });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.spends, 1);
  assert.deepEqual(calls.pools, []);
  assert.deepEqual(calls.notices, [["warn", "verdict.offList"]]);
});

await ta("a Judge's cast with the level's slots used is warned, goes on, and raises the list's count as the cast window does", async () => {
  const { result, calls } = await run(owned([["alpha", 2]]), {}, { isGM: true, pools: poolsOf(["alpha", 2, 2, 2]) });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.spends, 1);
  assert.deepEqual(calls.pools, [["alpha", "s2"]]);
  assert.deepEqual(calls.notices, [["warn", "verdict.noSlot"]]);
});

await ta("an ordinary cast with a slot free gives no notice, spends once and raises that list's pool once", async () => {
  for (const isGM of [false, true]) {
    const { result, calls } = await run(owned([["alpha", 2]]), {}, { isGM, pools: poolsOf(["alpha", 2, 2, 1]) });
    assert.deepEqual(result, { ok: true });
    assert.equal(calls.spends, 1);
    assert.deepEqual(calls.pools, [["alpha", "s2"]]);
    assert.deepEqual(calls.notices, []);
  }
});

await ta("a spell on two lists reads the first where the cast names none, and the named list where it does", async () => {
  const pools = poolsOf(["alpha", 2, 2, 1], ["beta", 3, 1, 0]);
  const spell = owned([["alpha", 2], ["beta", 3]]);
  const unnamed = await run(spell, {}, { pools });
  assert.deepEqual(unnamed.calls.pools, [["alpha", "s2"]]);
  const named = await run(spell, { tradition: "beta" }, { pools });
  assert.deepEqual(named.calls.pools, [["beta", "s3"]]);
  assert.deepEqual(named.calls.notices, []);
  const full = await run(spell, { tradition: "beta" }, { pools: poolsOf(["alpha", 2, 2, 0], ["beta", 3, 1, 1]) });
  assert.deepEqual(full.result, { ok: false, reason: "noSlot" }, "the named list's slots decide, not the first's");
  const stray = await run(spell, { tradition: "delta" }, { pools });
  assert.deepEqual(stray.calls.pools, [["alpha", "s2"]], "a list the spell is not on is ignored");
});

await ta("with no slot maximum known nothing blocks and no pool is raised", async () => {
  for (const isGM of [false, true]) {
    const { result, calls } = await run(owned([["alpha", 2]]), {}, { isGM, pools: [] });
    assert.deepEqual(result, { ok: true });
    assert.equal(calls.spends, 1);
    assert.deepEqual(calls.pools, []);
    assert.deepEqual(calls.notices, []);
  }
});

await ta("a spell that names no list on a class caster is cast as today: no notice and no pool", async () => {
  const { result, calls } = await run(owned([]), {}, { pools: poolsOf(["alpha", 2, 2, 2]) });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.spends, 1);
  assert.deepEqual(calls.pools, []);
  assert.deepEqual(calls.notices, []);
});

await ta("the system's own slot count, used up, refuses nothing here: a spell that names no list, and a list with no slot row answering", async () => {
  const full = { 1: { max: 1 } };
  const bare = owned([], { coreSpells: full });
  bare.system.cast = 1;
  const none = await run(bare, {}, { pools: poolsOf(["alpha", 1, 2, 0]) });
  assert.deepEqual([none.result, none.calls.spends, none.calls.pools, none.calls.notices], [{ ok: true }, 1, [], []], "a Player's bare spell is cast with the system's count full");
  const listed = owned([["alpha", 1]], { coreSpells: full });
  listed.system.cast = 1;
  const rowless = await run(listed, {}, { pools: [] });
  assert.deepEqual([rowless.result, rowless.calls.spends, rowless.calls.pools, rowless.calls.notices], [{ ok: true }, 1, [], []], "a listed spell whose list has no slot row is not judged by the system's grid");
});

await ta("a cast the system did not run writes no pool", async () => {
  const { result, calls } = await run(owned([["alpha", 2]]), {}, { pools: poolsOf(["alpha", 2, 2, 0]), spent: false });
  assert.deepEqual(result, { ok: false, reason: "notSpent" });
  assert.equal(calls.spends, 1);
  assert.deepEqual(calls.pools, []);
});

await ta("the claimant answers for the gate's key, claims through the lookup and runs the gate", async () => {
  const made = runDeps({ pools: poolsOf(["alpha", 2, 2, 0]) });
  const claimant = castGateClaimant(made.deps, { classFor: made.deps.classFor });
  assert.equal(claimant.key, CAST_GATE_KEY);
  assert.notEqual(CAST_GATE_KEY, CAST_SPELL_KEY);
  const spell = owned([["alpha", 2]]);
  assert.equal(claimant.claims(spell), true);
  await claimant.cast(spell, {}, made.spend);
  assert.equal(made.calls.spends, 1);
  assert.deepEqual(made.calls.pools, [["alpha", "s2"]]);
  assert.equal(castGateClaimant(made.deps).claims(spell), true, "the lookup rides the deps where the claim gives none");
});

await ta("registering returns a remover that may be called twice", () => {
  const off = registerCastGate({ classFor: () => null });
  assert.equal(typeof off, "function");
  off();
  off();
});

await ta("every notice key the gate shows exists in lang", () => {
  for (const key of ["blocked.noSlot", "blocked.offList", "verdict.noSlot", "verdict.offList"]) assert.ok(LANG[`ACKS-MAGIC.cast.notice.${key}`], key);
});

await ta("module.mjs registers the gate after the cast window's claimant, each in its own try", () => {
  const source = readFileSync(new URL("../scripts/magic/module.mjs", import.meta.url), "utf8");
  const window = source.indexOf("registerCastSpell({");
  const gate = source.indexOf("registerCastGate({");
  assert.ok(window > 0 && gate > window, "the gate is registered after the cast window");
  assert.ok(source.slice(window, gate).includes("catch (err)"), "the cast window's try closes before the gate's");
});

console.log(`\n${n} passed`);
