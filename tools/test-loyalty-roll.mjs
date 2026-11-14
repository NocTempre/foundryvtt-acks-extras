/**
 * The loyalty roll's one wrapper (scripts/lib/patches/loyalty-roll.mjs).
 *
 * Stand-in actor class and notifications: what this pins is which loyalty rolls
 * leave core's method and which are refused, the warning a refusal posts, and
 * that the wrapper installs through libWrapper where it is present and by
 * replacing the method where it is not. That Foundry's own header button and
 * every module button reach the wrapper is the live recipe's to prove
 * (docs/henchmen/TESTING.md).
 */
import assert from "node:assert/strict";

let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

const warned = [];
const warnings = { notifications: { warn: (m) => warned.push(m), info() {}, error() {} } };
globalThis.ui = warnings;
globalThis.game = { i18n: { localize: (k) => k, format: (k, d = {}) => `${k}|${Object.values(d).join(",")}` } };

/** The system's actor class: its own roll records the call and answers a marker. */
const coreCalls = [];
class CoreActor {
  constructor(loyalty, name = "Tester") {
    this.name = name;
    this.system = { retainer: { loyalty } };
  }
  rollLoyalty(options) {
    coreCalls.push({ options, loyalty: this.system.retainer.loyalty });
    return "core-roll";
  }
}
globalThis.CONFIG = { Actor: { documentClass: CoreActor } };

const { installLoyaltyRollPatch } = await import("../scripts/lib/patches/loyalty-roll.mjs");
const reset = () => { coreCalls.length = 0; warned.length = 0; };

// Without libWrapper the method is replaced in place.
installLoyaltyRollPatch();

await ok("a hireling with a score rolls core's roll, with its arguments and its answer", () => {
  reset();
  const options = { event: { shiftKey: true } };
  assert.equal(new CoreActor(2).rollLoyalty(options), "core-roll");
  assert.equal(coreCalls.length, 1);
  assert.equal(coreCalls[0].options, options);
  assert.deepEqual(warned, []);
});

await ok("a score of zero is a score and rolls", () => {
  reset();
  assert.equal(new CoreActor(0).rollLoyalty({}), "core-roll");
  assert.equal(coreCalls.length, 1);
});

await ok("an empty field is refused with a warning naming the hireling, and core's roll is never called", () => {
  for (const blank of [null, undefined, NaN, "", "2"]) {
    reset();
    assert.equal(new CoreActor(blank, "Wren").rollLoyalty({}), undefined, `${JSON.stringify(blank)} rolls nothing`);
    assert.equal(coreCalls.length, 0, "core's roll is not reached");
    assert.deepEqual(warned, ["ACKS-LIB.loyaltyRoll.blank|Wren"]);
  }
});

await ok("an actor with no retainer block is refused too", () => {
  reset();
  const bare = new CoreActor(1);
  bare.system = {};
  assert.equal(bare.rollLoyalty({}), undefined);
  assert.equal(coreCalls.length, 0);
});

await ok("with libWrapper present the wrapper is registered MIXED on the method and runs the same way", () => {
  class Fresh {
    constructor(loyalty) { this.name = "Fresh"; this.system = { retainer: { loyalty } }; }
    rollLoyalty() { return "fresh-core"; }
  }
  globalThis.CONFIG = { Actor: { documentClass: Fresh } };
  const registered = [];
  globalThis.libWrapper = { register: (...args) => registered.push(args) };
  installLoyaltyRollPatch();
  delete globalThis.libWrapper;
  assert.equal(registered.length, 1);
  const [, target, wrapper, mode] = registered[0];
  assert.equal(target, "CONFIG.Actor.documentClass.prototype.rollLoyalty");
  assert.equal(mode, "MIXED", "the wrapper refuses without calling core's method");
  reset();
  assert.equal(wrapper.call(new Fresh(3), () => "wrapped", {}), "wrapped");
  assert.equal(wrapper.call(new Fresh(null), () => "wrapped", {}), undefined);
  assert.equal(warned.length, 1);
});

await ok("a system with no rollLoyalty is left alone and nothing throws", () => {
  globalThis.CONFIG = { Actor: { documentClass: class {} } };
  const warn = console.warn;
  const said = [];
  console.warn = (...a) => said.push(a.join(" "));
  try {
    installLoyaltyRollPatch();
  } finally {
    console.warn = warn;
  }
  assert.equal(said.length, 1);
});

console.log(`test-loyalty-roll: ${passed} passed`);
