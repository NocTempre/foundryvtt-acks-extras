/**
 * The tied-initiative order (scripts/lib/patches/turn-order.mjs).
 *
 * A stand-in for the system's `sortCombatantsACKS`, transcribed in shape, shows
 * the defect: two combatants of one side compare the same sign both ways, so
 * the order of a tied set depends on the engine's sort and on the sequence the
 * combatants arrive in. What this pins is the wrapper's contract: one order
 * for every permutation under three different sort algorithms, the system's
 * answer kept wherever the system's comparator is itself consistent and
 * wherever initiative differs, a comparator that is antisymmetric and
 * transitive, no dependence on `this`, and the install paths with and without
 * libWrapper. That two real clients then agree on who is up is the live
 * recipe's to prove (docs/lib/TESTING.md).
 */
import assert from "node:assert/strict";

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

const HOSTILE = -1;
const FRIENDLY = 1;

/** A combatant as the comparators read one: initiative, id, name, token disposition, the system's flags. */
function combatant(id, initiative, disposition, outnumbering = false) {
  return {
    id,
    name: "Goblin",
    initiative,
    token: { disposition },
    flags: { acks: { outnumbering } },
  };
}

/** The system's comparator, as `AcksCombat#sortCombatantsACKS` reads. */
function systemCompare(a, b) {
  if (a.initiative === b.initiative) {
    if (!a.flags.acks.outnumbering && !b.flags.acks.outnumbering) {
      if (a.token.disposition == -1) return -1;
      return 1;
    }
    if (a.flags.acks.outnumbering) return 1;
    if (b.flags.acks.outnumbering) return -1;
    return a.name.localeCompare(b.name);
  }
  return b.initiative - a.initiative;
}

class Combat {
  /** The system's comparator, a prototype method as core defines it. */
  sortCombatantsACKS(a, b) {
    return systemCompare(a, b);
  }
}

const calls = [];
const warnings = [];
const rendered = [];
const origWarn = console.warn;
console.warn = (...args) => warnings.push(args.join(" "));
globalThis.CONFIG = { Combat: { documentClass: Combat } };
globalThis.game = { combats: [], i18n: { localize: (key) => key } };
globalThis.ui = { combat: { render: () => rendered.push("render") } };
/** Registrations a stand-in libWrapper received. */
const registered = [];
globalThis.libWrapper = {
  register: (...args) => {
    registered.push(args);
    const [, , fn, type] = args;
    const proto = Combat.prototype;
    const original = proto.sortCombatantsACKS;
    assert.equal(type, "MIXED");
    proto.sortCombatantsACKS = function (...a) { return fn.call(this, (...b) => original.apply(this, b), ...a); };
  },
};

const { installTurnOrderPatch, compareTied, resortCombats } = await import("../scripts/lib/patches/turn-order.mjs");

/** Insertion sort: a different algorithm from the engine's, to stand for a seat on another one. */
function insertionSort(list, compare) {
  const out = [];
  for (const item of list) {
    let i = out.length;
    while (i > 0 && compare(out[i - 1], item) > 0) i--;
    out.splice(i, 0, item);
  }
  return out;
}

/** Top-down merge sort, taking from the left run on a zero. */
function mergeSort(list, compare) {
  if (list.length < 2) return list.slice();
  const mid = list.length >> 1;
  const left = mergeSort(list.slice(0, mid), compare);
  const right = mergeSort(list.slice(mid), compare);
  const out = [];
  while (left.length && right.length) out.push(compare(left[0], right[0]) <= 0 ? left.shift() : right.shift());
  return out.concat(left, right);
}

const SORTS = {
  engine: (list, compare) => list.slice().sort(compare),
  insertion: insertionSort,
  merge: mergeSort,
};

/** Every permutation of `list`. */
function permutations(list) {
  if (list.length < 2) return [list];
  return list.flatMap((item, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((rest) => [item, ...rest]));
}

/** The order a sort gives, as ids. */
const orderOf = (sort, list, compare) => sort(list, compare).map((c) => c.id).join(",");

/** Every order `sort` gives across every permutation of `list`. */
const ordersAcross = (sort, list, compare) => new Set(permutations(list).map((p) => orderOf(sort, p, compare)));

// A tied set: two hostile, two friendly, one outnumbering friendly, one outnumbering hostile.
const TIED = [
  combatant("k3", 4, HOSTILE),
  combatant("a1", 4, HOSTILE),
  combatant("m9", 4, FRIENDLY),
  combatant("c2", 4, FRIENDLY),
  combatant("z7", 4, FRIENDLY, true),
  combatant("b5", 4, HOSTILE, true),
];

// Initiative 2 and 5, both dispositions, both outnumbering states, two ids each.
const GENERATED = [];
for (const init of [2, 5]) {
  for (const disposition of [HOSTILE, FRIENDLY]) {
    for (const out of [false, true]) {
      for (const copy of ["p", "q"]) GENERATED.push(combatant(`${copy}${init}${disposition}${out ? 1 : 0}`, init, disposition, out));
    }
  }
}

const sign = (n) => Math.sign(n);

await test("the system's comparator orders a tied set by the engine and the input sequence", () => {
  const a = TIED[0], b = TIED[1];
  assert.equal(systemCompare(a, b), -1);
  assert.equal(systemCompare(b, a), -1, "two hostiles compare -1 both ways");
  assert.equal(systemCompare(TIED[2], TIED[3]), 1);
  assert.equal(systemCompare(TIED[3], TIED[2]), 1, "two non-hostiles compare +1 both ways");
  for (const [name, sort] of Object.entries(SORTS)) {
    assert.ok(ordersAcross(sort, TIED, systemCompare).size > 1, `${name}: the system gives more than one order`);
  }
});

await test("the wrapper gives one order for every permutation, under every sort", () => {
  installTurnOrderPatch();
  const compare = Combat.prototype.sortCombatantsACKS;
  const all = new Set();
  for (const [name, sort] of Object.entries(SORTS)) {
    const orders = ordersAcross(sort, TIED, compare);
    assert.equal(orders.size, 1, `${name}: ${[...orders].join(" | ")}`);
    orders.forEach((o) => all.add(o));
  }
  assert.equal(all.size, 1, "and the same one under all three sorts");
  // Not outnumbering first, hostile before friendly, then id; outnumbering last.
  assert.equal([...all][0], "a1,k3,c2,m9,b5,z7");
});

await test("the comparator is called unbound, as setupTurns calls it", () => {
  const compare = Combat.prototype.sortCombatantsACKS;
  assert.doesNotThrow(() => TIED.slice().sort(compare));
  assert.equal(compare(TIED[0], TIED[1]), compareTied(TIED[0], TIED[1]));
});

await test("different initiative is the system's answer, untouched", () => {
  const compare = Combat.prototype.sortCombatantsACKS;
  for (const a of GENERATED) {
    for (const b of GENERATED) {
      if (a.initiative === b.initiative) continue;
      assert.equal(compare(a, b), systemCompare(a, b));
    }
  }
  assert.equal(compare(combatant("x", 6, HOSTILE), combatant("y", 3, FRIENDLY)), systemCompare(combatant("x", 6, HOSTILE), combatant("y", 3, FRIENDLY)));
  const mixed = [combatant("a", 3, HOSTILE), combatant("b", 9, FRIENDLY), combatant("c", 6, HOSTILE)];
  assert.deepEqual(mixed.slice().sort(compare).map((c) => c.id), ["b", "c", "a"]);
});

await test("a tie the system answers consistently keeps the system's sign", () => {
  let checked = 0;
  for (const a of GENERATED) {
    for (const b of GENERATED) {
      if (a === b || a.initiative !== b.initiative) continue;
      const ab = systemCompare(a, b), ba = systemCompare(b, a);
      if (sign(ab) !== -sign(ba)) continue;
      checked++;
      assert.equal(sign(compareTied(a, b)), sign(ab), `${a.id} vs ${b.id}`);
    }
  }
  assert.ok(checked > 40, `only ${checked} consistent pairs were compared`);
});

await test("the tied comparator is antisymmetric, transitive and zero only on itself", () => {
  for (const a of GENERATED) {
    assert.equal(compareTied(a, a), 0);
    for (const b of GENERATED) {
      if (a === b) continue;
      assert.notEqual(compareTied(a, b), 0, `${a.id} vs ${b.id}`);
      assert.equal(sign(compareTied(a, b)), -sign(compareTied(b, a)));
      for (const c of GENERATED) {
        if (compareTied(a, b) < 0 && compareTied(b, c) < 0) assert.ok(compareTied(a, c) < 0, `${a.id} ${b.id} ${c.id}`);
      }
    }
  }
});

await test("the whole comparator, tied and not, orders a mixed set the same under every sort", () => {
  const compare = Combat.prototype.sortCombatantsACKS;
  const sample = GENERATED.filter((_, i) => i % 3 === 0).slice(0, 7);
  const orders = new Set();
  for (const sort of Object.values(SORTS)) for (const o of ordersAcross(sort, sample, compare)) orders.add(o);
  assert.equal(orders.size, 1);
  // Initiative 5 before 2, and the tied rows in the tied order within each.
  const ids = [...orders][0].split(",");
  const inits = ids.map((id) => GENERATED.find((c) => c.id === id).initiative);
  assert.deepEqual(inits, inits.slice().sort((x, y) => y - x));
});

await test("the wrapper registered with libWrapper as MIXED on the system's method", () => {
  assert.equal(registered.length, 1);
  assert.equal(registered[0][0], "acks-extras");
  assert.equal(registered[0][1], "CONFIG.Combat.documentClass.prototype.sortCombatantsACKS");
});

await test("without libWrapper the prototype method is wrapped in place", () => {
  class Bare { sortCombatantsACKS(a, b) { return systemCompare(a, b); } }
  globalThis.CONFIG = { Combat: { documentClass: Bare } };
  delete globalThis.libWrapper;
  const before = Bare.prototype.sortCombatantsACKS;
  installTurnOrderPatch();
  assert.notEqual(Bare.prototype.sortCombatantsACKS, before);
  const compare = Bare.prototype.sortCombatantsACKS;
  assert.equal(ordersAcross(SORTS.insertion, TIED, compare).size, 1);
  assert.equal(compare(combatant("x", 6, HOSTILE), combatant("y", 3, FRIENDLY)), -3);
});

await test("a combat class with no such method warns and wraps nothing", () => {
  class Odd {}
  globalThis.CONFIG = { Combat: { documentClass: Odd } };
  warnings.length = 0;
  installTurnOrderPatch();
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /sortCombatantsACKS/);
  assert.equal(Odd.prototype.sortCombatantsACKS, undefined);
});

await test("resortCombats sets up every loaded combat, writes nothing, and redraws the tracker", () => {
  const make = (id, fail = false) => ({
    id,
    setupTurns: () => { calls.push(id); if (fail) throw new Error("locked"); },
    update: () => assert.fail("a sort again must not write"),
    setFlag: () => assert.fail("a sort again must not write"),
  });
  game.combats = [make("one"), make("two", true), make("three")];
  calls.length = 0;
  warnings.length = 0;
  rendered.length = 0;
  resortCombats();
  assert.deepEqual(calls, ["one", "two", "three"], "a combat that throws does not stop the rest");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /two/);
  assert.equal(rendered.length, 1);
  game.combats = [];
  ui.combat = null;
  assert.doesNotThrow(() => resortCombats(), "no tracker is not an error");
});

console.warn = origWarn;
console.log(`\n${passed} passed`);
