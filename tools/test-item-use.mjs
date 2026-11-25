/**
 * The seam on the system's `Item#use` (`patches/item-use.mjs`) and the carrier's
 * claimant on it (`item-run.mjs`), offline: the wrapper's contract (no claimant
 * leaves the system's method untouched, the first claimant to answer exactly
 * `true` runs the use, `system` runs the system's use once and only while the
 * run is open, a throwing claimant is contained, a second install adds no
 * layer), and the carrier's claim: it takes only an item whose activation kind
 * has a runner, and declines every spell (so `_useSpell` and the cast engine's
 * claimant are reached as before), every ability with no activation and every
 * unflagged item. Foundry-free with stand-ins; every name is invented.
 *
 * Usage: node tools/test-item-use.mjs
 */
import assert from "node:assert/strict";

globalThis.Hooks = { once() {}, on() {}, callAll() {} };
globalThis.foundry = { utils: { randomID: () => "rid" }, data: {} };
globalThis.game = { i18n: { format: (key) => key, localize: (key) => key }, users: [], user: { isGM: true } };
globalThis.ui = { notifications: { warn() {}, error() {} } };

const seam = await import("../scripts/lib/patches/item-use.mjs");
const spellSeam = await import("../scripts/lib/patches/spell-use.mjs");
const itemRun = await import("../scripts/lib/item-run.mjs");

let passed = 0;
const t = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

const wrapCalls = [];
/** libWrapper's MIXED shape: the wrapper gets the wrapped method first, then the call's arguments. */
const libWrapper = {
  register(id, target, fn, type) {
    wrapCalls.push([id, target, type]);
    const path = target.split(".");
    const prop = path.pop();
    const owner = path.reduce((o, k) => o[k], globalThis);
    const original = owner[prop];
    owner[prop] = function (...args) {
      return fn.call(this, (...a) => original.apply(this, a), ...args);
    };
  },
};

/** A stand-in for the system's Item: `use` records the system's own run and reaches `_useSpell` for a spell, as core's does. */
const makeItemClass = () =>
  class FakeItem {
    constructor(type = "item", flags = {}) {
      this.type = type;
      this.flags = { "acks-extras": flags };
      this.systemRuns = [];
      this.spellRuns = [];
    }
    async use(options) {
      this.systemRuns.push(options);
      if (this.type === "spell") await this._useSpell(options);
    }
    async _useSpell(options) {
      this.spellRuns.push(options);
    }
  };

const logged = [];
const priorError = console.error;
const claimed = [];
/** Stand the globals in, install on a fresh class, run `fn(FakeItem)`, and put everything back. */
const run = async (fn) => {
  const FakeItem = makeItemClass();
  const prior = { CONFIG: globalThis.CONFIG, libWrapper: globalThis.libWrapper };
  globalThis.CONFIG = { Item: { documentClass: FakeItem } };
  globalThis.libWrapper = libWrapper;
  console.error = (...args) => logged.push(args.map(String).join(" "));
  try {
    spellSeam.installSpellUsePatch();
    seam.installItemUsePatch();
    await fn(FakeItem);
  } finally {
    console.error = priorError;
    for (const key of claimed.splice(0)) seam.removeItemUseClaimant(key);
    seam.removeItemUseClaimant("itemRun");
    spellSeam.removeSpellUseClaimant("probe");
    globalThis.CONFIG = prior.CONFIG;
    globalThis.libWrapper = prior.libWrapper;
  }
};
const claimant = (key, spec) => {
  claimed.push(key);
  seam.addItemUseClaimant({ key, claims: () => true, run: async () => {}, ...spec });
};

await t("with no claimant the system's use runs untouched, with the options it was given", async () => {
  await run(async (FakeItem) => {
    const item = new FakeItem();
    await item.use({ a: 1 });
    assert.deepEqual(item.systemRuns, [{ a: 1 }]);
    await item.use();
    assert.deepEqual(item.systemRuns[1], {}, "absent options reach the system as an empty bag");
    assert.deepEqual(wrapCalls.at(-1).slice(1), ["CONFIG.Item.documentClass.prototype.use", "MIXED"]);
  });
});

await t("a claimant that answers exactly true takes the use; any other answer declines", async () => {
  for (const answer of [1, "yes", Promise.resolve(true), undefined, false]) {
    await run(async (FakeItem) => {
      const ran = [];
      claimant("x", { claims: () => answer, run: async () => ran.push(1) });
      const item = new FakeItem();
      await item.use({});
      assert.deepEqual(ran, [], `${String(answer)} declines`);
      assert.equal(item.systemRuns.length, 1);
    });
  }
  await run(async (FakeItem) => {
    const ran = [];
    claimant("x", { run: async () => ran.push(1) });
    const item = new FakeItem();
    await item.use({});
    assert.deepEqual(ran, [1]);
    assert.equal(item.systemRuns.length, 0, "the system's use does not run unless the claimant asks");
  });
});

await t("claimants are offered in registration order; a replaced key keeps its place; a claims that throws is passed over", async () => {
  await run(async (FakeItem) => {
    const order = [];
    claimant("a", { claims: () => (order.push("a"), false) });
    claimant("b", { claims: () => { order.push("b"); throw new Error("boom"); } });
    claimant("c", { claims: () => (order.push("c"), true), run: async () => order.push("run-c") });
    claimant("a", { claims: () => (order.push("a2"), false) });
    await new FakeItem().use({});
    assert.deepEqual(order, ["a2", "b", "c", "run-c"]);
    assert.ok(logged.some((line) => line.includes('"b" threw in claims')));
  });
});

await t("system() runs the system's use once, returns true, and is a logged no-op after the run returns", async () => {
  await run(async (FakeItem) => {
    let late;
    claimant("x", {
      run: async (item, options, system) => {
        assert.equal(await system(), true);
        await system();
        late = system;
      },
    });
    const item = new FakeItem();
    await item.use({ n: 1 });
    assert.deepEqual(item.systemRuns, [{ n: 1 }], "once, though called twice");
    logged.length = 0;
    assert.equal(await late(), false);
    assert.equal(item.systemRuns.length, 1);
    assert.ok(logged.some((line) => line.includes("after its run returned")));
  });
});

await t("a run that throws is contained: nothing escapes the use and nothing counts unasked", async () => {
  await run(async (FakeItem) => {
    claimant("x", { run: async () => { throw new Error("boom"); } });
    const item = new FakeItem();
    await item.use({});
    assert.equal(item.systemRuns.length, 0);
  });
});

await t("a second install on one class adds no second layer, and a claimant needs a key and both functions", async () => {
  await run(async (FakeItem) => {
    const before = wrapCalls.length;
    seam.installItemUsePatch();
    assert.equal(wrapCalls.length, before);
    const ran = [];
    claimant("x", { run: async () => ran.push(1) });
    await new FakeItem().use({});
    assert.deepEqual(ran, [1], "one layer, one run");
  });
  assert.throws(() => seam.addItemUseClaimant({ key: "", claims: () => true, run: async () => {} }), TypeError);
  assert.throws(() => seam.addItemUseClaimant({ key: "k", claims: () => true }), TypeError);
  assert.equal(seam.removeItemUseClaimant("never"), false);
});

await t("without libWrapper the method is wrapped directly", async () => {
  const FakeItem = makeItemClass();
  const prior = { CONFIG: globalThis.CONFIG, libWrapper: globalThis.libWrapper };
  globalThis.CONFIG = { Item: { documentClass: FakeItem } };
  delete globalThis.libWrapper;
  try {
    seam.installItemUsePatch();
    const ran = [];
    claimant("x", { run: async () => ran.push(1) });
    await new FakeItem().use({});
    assert.deepEqual(ran, [1]);
  } finally {
    for (const key of claimed.splice(0)) seam.removeItemUseClaimant(key);
    globalThis.CONFIG = prior.CONFIG;
    globalThis.libWrapper = prior.libWrapper;
  }
});

/* --- the carrier's claim --- */
const activation = (kind) => ({ itemRun: { activation: { kind }, rows: [] } });

await t("the carrier takes only an item whose activation kind has a runner", async () => {
  await run(async (FakeItem) => {
    const ran = [];
    itemRun.registerActivationRunner("once", async () => ran.push("once"));
    itemRun.registerItemRunClaimant();
    try {
      const flagged = new FakeItem("item", activation("once"));
      assert.equal((await Promise.all([flagged.use({})])).length, 1);
      // The carrier's run asks the item's actor, which the stand-in lacks: it is refused with a line, and the system's card is not shown.
      assert.equal(flagged.systemRuns.length, 0, "a claimed item no longer shows the system's card");
      for (const kind of ["fuse", "consume"]) {
        const item = new FakeItem("item", activation(kind));
        await item.use({});
        assert.equal(item.systemRuns.length, 1, `${kind} has no runner yet, so the system's use runs`);
      }
      const unknown = new FakeItem("item", activation("nonsense"));
      await unknown.use({});
      assert.equal(unknown.systemRuns.length, 1, "an unknown kind is no activation");
    } finally {
      itemRun.registerActivationRunner("once", null);
    }
  });
});

await t("the carrier declines every spell, every ability with no activation and every unflagged item", async () => {
  await run(async (FakeItem) => {
    const cast = [];
    spellSeam.addSpellUseClaimant({ key: "probe", claims: () => true, cast: async (item, options) => cast.push(item.type) });
    itemRun.registerActivationRunner("once", async () => { throw new Error("the carrier ran"); });
    itemRun.registerActivationRunner("toggle", async () => { throw new Error("the carrier ran"); });
    itemRun.registerItemRunClaimant();
    try {
      const spell = new FakeItem("spell", activation("once"));
      await spell.use({});
      assert.deepEqual(cast, ["spell"], "a spell carrying an activation still reaches _useSpell and its claimant");
      assert.equal(spell.systemRuns.length, 1);
      const ability = new FakeItem("ability", { extras: { effects: [{ key: "k" }] } });
      await ability.use({});
      assert.equal(ability.systemRuns.length, 1, "an ability with no activation is the system's");
      const plain = new FakeItem("item", {});
      await plain.use({});
      assert.equal(plain.systemRuns.length, 1);
      const noRows = new FakeItem("weapon", { itemRun: { rows: [] } });
      await noRows.use({});
      assert.equal(noRows.systemRuns.length, 1, "rows with no activation are not claimed");
      assert.deepEqual(logged.filter((line) => line.includes("the carrier ran")), []);
    } finally {
      itemRun.registerActivationRunner("once", null);
      itemRun.registerActivationRunner("toggle", null);
    }
  });
});

console.log(`\ntest-item-use: ${passed} checks passed.`);
