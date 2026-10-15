/**
 * The system sheets' stored-value inputs (scripts/lib/patches/stored-inputs.mjs).
 *
 * Stand-in elements, hooks and actor: what this pins is which inputs take the
 * stored value — actor fields an effect changes, on a sheet carrying core's
 * base class — and which are left as rendered. That the system's form then
 * submits the stored figure is the live recipe's to prove (docs/lib/TESTING.md).
 */
import assert from "node:assert/strict";

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok   " + name); };

const getProperty = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
const hooks = {};
globalThis.Hooks = { on: (name, fn) => { (hooks[name] ??= []).push(fn); } };
globalThis.game = {
  system: { id: "acks" },
  i18n: { format: (k, d = {}) => `${k}|${Object.values(d).join(",")}` },
};
globalThis.foundry = {
  utils: {
    getProperty,
    hasProperty: (obj, path) => getProperty(obj, path) !== undefined,
    isEmpty: (o) => !o || Object.keys(o).length === 0,
  },
};

/** An input the patch reads: a name, a type, a value, and whether it sits in an item row. */
function input(name, value, { type = "text", inItem = false } = {}) {
  const classes = new Set();
  return {
    nodeType: 1, name, type, value: String(value), checked: !!value, dataset: {},
    classList: { add: (c) => classes.add(c), has: (c) => classes.has(c) },
    closest: (sel) => (inItem && sel.includes("data-item-id") ? {} : null),
  };
}
const root = (inputs) => ({ nodeType: 1, querySelectorAll: () => inputs });

const { installStoredInputs } = await import("../scripts/lib/patches/stored-inputs.mjs");
installStoredInputs();
const render = (app, el) => hooks.renderActorSheetV2.forEach((fn) => fn(app, el));

const actor = {
  _source: { system: { surprise: { avoidsurprise: 0 }, hp: { value: 7 }, retainer: { enabled: false } } },
  system: { surprise: { avoidsurprise: -1 }, hp: { value: 7 }, retainer: { enabled: true } },
  overrides: { system: { surprise: { avoidsurprise: -1 }, retainer: { enabled: true } } },
};
const coreSheet = { actor, options: { classes: ["acks", "actor-v2", "character-v2"] } };

ok("an effect-changed field shows the stored value and names the one in force", () => {
  const avoid = input("system.surprise.avoidsurprise", -1);
  render(coreSheet, root([avoid]));
  assert.equal(avoid.value, 0);
  assert.ok(avoid.classList.has("acks-extras-overridden"));
  assert.equal(avoid.dataset.tooltip, "ACKS-LIB.storedInput.effectiveTip|-1");
});

ok("a field no effect changes is left as rendered", () => {
  const hp = input("system.hp.value", 7);
  render(coreSheet, root([hp]));
  assert.equal(hp.value, "7");
  assert.equal(hp.dataset.tooltip, undefined);
});

ok("a checkbox takes the stored state", () => {
  const box = input("system.retainer.enabled", true, { type: "checkbox" });
  render(coreSheet, root([box]));
  assert.equal(box.checked, false);
});

ok("an input in an item row names the item's field and is left alone", () => {
  const row = input("system.surprise.avoidsurprise", -1, { inItem: true });
  render(coreSheet, root([row]));
  assert.equal(row.value, "-1");
});

ok("a sheet not built on core's base class is left alone", () => {
  const avoid = input("system.surprise.avoidsurprise", -1);
  render({ actor, options: { classes: ["acks-extras", "acks-extras-character-sheet"] } }, root([avoid]));
  assert.equal(avoid.value, "-1");
});

ok("an actor with no effect in force is left alone", () => {
  const avoid = input("system.surprise.avoidsurprise", 0);
  render({ actor: { ...actor, overrides: {} }, options: coreSheet.options }, root([avoid]));
  assert.equal(avoid.dataset.tooltip, undefined);
});

ok("another system's sheet is left alone", () => {
  game.system.id = "dnd5e";
  try {
    const avoid = input("system.surprise.avoidsurprise", -1);
    render(coreSheet, root([avoid]));
    assert.equal(avoid.value, "-1");
  } finally {
    game.system.id = "acks";
  }
});

console.log(`\n${passed} passed`);
