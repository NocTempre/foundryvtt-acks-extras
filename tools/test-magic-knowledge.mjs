/**
 * What a player may be told of an item's magic: the `detected` mark, the one
 * reader `magicKnowledge`, the item sheet and slot label gated on it while the
 * slot rule still counts the truth, the disguise field rules shared by
 * `disguiseItem` and `disguiseData`, and the identification listener that
 * lifts a name and reveals. All data is invented; no Foundry.
 *
 * Run: npm test
 */
import assert from "node:assert";

globalThis.Hooks = { on() {}, once() {}, callAll() {} };
globalThis.game = {
  user: { isGM: false },
  settings: { get: () => null },
  i18n: { localize: (x) => x, format: (k) => k, has: () => false },
  modules: { get: () => ({ active: false }) },
};
globalThis.foundry = {
  utils: {},
  data: { fields: {} },
  applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (B) => class extends B {}, DialogV2: class {} }, handlebars: {} },
};

const { magicKnowledge, markIdentified, slotUse, isMagical } = await import("../scripts/lib/item-model.mjs");
const T = await import("../scripts/lib/tables.mjs");
const vocab = await import("../scripts/lib/vocab.mjs");
const { buildItemSheetModel } = await import("../scripts/equipment/item-sheet/view-model.mjs");
const { magicSnapshotOf } = await import("../scripts/equipment/item-sheet/snapshot.mjs");
const { disguiseData, disguisePatch, revealPatch } = await import("../scripts/equipment/disguise-logic.mjs");
const { disguiseItem, revealItem, isDisguised } = await import("../scripts/equipment/actions.mjs");
const { revealOnIdentify } = await import("../scripts/markets/engine/identify-reveal.mjs");
const { METHODS } = await import("../scripts/markets/engine/identify.mjs");

let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

/** An item document double: markets flag, disguise flag, source fields, update. */
function mockItem({ type = "weapon", name = "Test Blade", markets = {}, system = {} } = {}) {
  const item = {
    type,
    name,
    img: "icons/svg/sword.svg",
    isOwner: true,
    system: { cost: 100, description: "<p>Plain.</p>", damage: { base: { formula: "1d6" } }, ac: { value: 0 }, ...system },
    flags: { "acks-extras": { markets } },
    getFlag(_m, key) { return this.flags["acks-extras"][key]; },
    async setFlag(_m, key, value) { this.flags["acks-extras"][key] = value; },
    async unsetFlag(_m, key) { delete this.flags["acks-extras"][key]; },
    async update(patch) {
      for (const [path, value] of Object.entries(patch)) {
        const keys = path.split(".");
        let at = this;
        for (const k of keys.slice(0, -1)) at = at[k];
        at[keys.at(-1)] = value;
      }
    },
  };
  return item;
}

const magicFlag = (over = {}) => ({ magic: true, identified: "none", ...over });

/** A minimal item-sheet snapshot, the shape `buildItemSheetModel` reads. */
const snap = (magic) => ({
  id: "i1", name: "Test Blade", img: "x.svg", type: "weapon", baseType: "sword", description: "", tags: [],
  qty: 1, stackable: false, weight6: 1, cost: 5, valueMode: "priced", wearable: false, worn: false, wornSlot: null, slotGuess: null,
  favorite: null, split: false, magic, disguise: { enabled: false, active: false }, named: null, container: null, spellbook: null,
  chart: null, condition: null, rolls: [], effects: { own: [{ id: "e1", label: "Glow", detail: "", when: "" }], inherited: [] },
  price: { lines: [], final: 5, apparent: 5 }, variations: [], acceptKinds: [], pins: [],
});

console.log("magicKnowledge");

await test("an absent detected key counts as known, for a player and for a Judge", () => {
  const item = mockItem({ markets: magicFlag() });
  assert.equal(magicKnowledge(item, { isGM: false }).known, true);
  assert.equal(magicKnowledge(item, { isGM: true }).known, true);
  assert.equal(magicKnowledge(item, { isGM: false }).detected, true);
});

await test("detected:false hides the magic from a player and not from a Judge", () => {
  const item = mockItem({ markets: magicFlag({ detected: false }) });
  assert.deepEqual(magicKnowledge(item, { isGM: false }), { magical: true, detected: false, identified: "none", known: false });
  assert.equal(magicKnowledge(item, { isGM: true }).known, true);
});

await test("a mundane item is never known magic", () => {
  assert.equal(magicKnowledge(mockItem({ markets: {} }), { isGM: true }).known, false);
  assert.equal(magicKnowledge(mockItem({ markets: { detected: false } }), { isGM: false }).known, false);
});

await test("the viewer defaults to the current user's seat", () => {
  const item = mockItem({ markets: magicFlag({ detected: false }) });
  game.user.isGM = true;
  assert.equal(magicKnowledge(item).known, true);
  game.user.isGM = false;
  assert.equal(magicKnowledge(item).known, false);
});

console.log("item sheet gating");

/** What the sheet shows for an item whose markets flag is `markets`, read the way the snapshot reads it. */
const sheetFor = (markets, viewer) => buildItemSheetModel(snap(magicSnapshotOf(mockItem({ markets }), markets)), { editable: true, ...viewer });
const AURA = { aura: "arcane" };

await test("a player sees no identify button, effects note or aura on an undetected magic item", () => {
  const m = sheetFor(magicFlag({ ...AURA, detected: false }), { isGM: false });
  assert.equal(m.details.identifyOffered, false);
  assert.equal(m.effects.hiddenByIdentification, false);
  assert.deepEqual(m.effects.own, []);
  // The aura shows from the second step: the gate, not the step, hides it here.
  const partial = sheetFor(magicFlag({ ...AURA, detected: false, identified: "partial" }), { isGM: false });
  assert.equal(partial.art.aura, null);
});

await test("with detected absent the player's sheet is what it is today", () => {
  const m = sheetFor(magicFlag(AURA), { isGM: false });
  assert.equal(m.details.identifyOffered, true);
  assert.equal(m.effects.hiddenByIdentification, true);
  assert.equal(sheetFor(magicFlag({ ...AURA, identified: "partial" }), { isGM: false }).art.aura, "arcane");
});

await test("a Judge sees the identify state and aura unchanged", () => {
  const gm = sheetFor(magicFlag({ ...AURA, detected: false, identified: "partial" }), { isGM: true });
  assert.equal(gm.art.aura, "arcane");
  assert.equal(gm.appearance.magic, true);
});

await test("a detected item at step one still offers identification and the effects note", () => {
  const m = sheetFor(magicFlag({ ...AURA, detected: true }), { isGM: false });
  assert.equal(m.details.identifyOffered, true);
  assert.equal(m.effects.hiddenByIdentification, true);
});

console.log("slot label vs enforcement");

const ring = (markets) => mockItem({ type: "item", markets });

/** Give the ring place an invented capacity as an import would, run `fn`, withdraw it. */
const withRingCapacity = (capacity, fn) => {
  T.registerTable({ id: vocab.WEAR_SLOTS_DOC, tables: { [vocab.RING_CAPACITY_TABLE]: { capacity } } }, { priority: T.PRIORITY.WORLD, source: "import" });
  try { return fn(); } finally { T.unregisterTable(vocab.WEAR_SLOTS_DOC, { priority: T.PRIORITY.WORLD }); }
};

await test("a player's count leaves an undetected item out while the slot is still full", () => {
  withRingCapacity(1, () => {
    const items = [ring(magicFlag({ detected: false })), ring(magicFlag())];
    const player = slotUse("ring", items, { viewer: { isGM: false } });
    const gm = slotUse("ring", items, { viewer: { isGM: true } });
    assert.equal(slotUse("ring", items).magic, 2);
    assert.equal(player.magic, 1, "the label counts only known magic");
    assert.equal(gm.magic, 2, "a Judge's label counts the truth");
    assert.equal(player.full, true, "enforcement counts the truth: two against a cap of one");
    assert.equal(gm.full, true);
  });
});

await test("a player whose own count is below the cap still meets a full slot", () => {
  withRingCapacity(2, () => {
    const items = [0, 1, 2].map((n) => ring(magicFlag(n ? { detected: false } : {})));
    const player = slotUse("ring", items, { viewer: { isGM: false } });
    assert.equal(player.magic, 1);
    assert.equal(player.used, 1);
    assert.equal(player.full, true, "three magic items against a cap of two, whoever counts");
    assert.equal(items.every(isMagical), true);
  });
});

console.log("markIdentified");

await test("raising identification marks an undetected item detected, in the same write", () => {
  assert.deepEqual(markIdentified({ magic: true, detected: false }, "partial"), { magic: true, detected: true, identified: "partial" });
  assert.deepEqual(markIdentified({ magic: true, detected: false }, "full").detected, true);
});

await test("it leaves the flag alone where nothing was hidden, and never writes detected where it is absent", () => {
  assert.deepEqual(markIdentified({ magic: true }, "partial"), { magic: true, identified: "partial" });
  assert.deepEqual(markIdentified({ magic: true, detected: false }, "none"), { magic: true, detected: false, identified: "none" });
  const flag = { magic: true, detected: false };
  markIdentified(flag, "full");
  assert.equal(flag.detected, false, "the input is not mutated");
});

await test("a player's view follows the write: undetected, then known once identified", () => {
  const flag = magicFlag({ detected: false });
  assert.equal(magicKnowledge(mockItem({ markets: flag }), { isGM: false }).known, false);
  assert.equal(magicKnowledge(mockItem({ markets: markIdentified(flag, "partial") }), { isGM: false }).known, true);
});

console.log("disguiseData");

const weaponSource = () => ({
  name: "Test Blade", img: "icons/svg/sword.svg", type: "weapon", flags: {},
  system: { cost: 500, description: "<p>True.</p>", damage: { base: { formula: "1d8+1" } }, ac: { value: 0 } },
});
const apparent = { name: "Old Sword", cost: 7, damage: "1d6", description: "<p>Plain.</p>", img: "icons/svg/dagger.svg" };

await test("disguiseData never mutates its input", () => {
  const data = weaponSource();
  const before = JSON.stringify(data);
  const out = disguiseData(data, apparent);
  assert.equal(JSON.stringify(data), before);
  assert.notEqual(out, data);
});

await test("it masks the fields and stores the truth under the disguise flag", () => {
  const out = disguiseData(weaponSource(), apparent);
  assert.equal(out.name, "Old Sword");
  assert.equal(out.img, "icons/svg/dagger.svg");
  assert.equal(out.system.cost, 7);
  assert.equal(out.system.damage.base.formula, "1d6");
  assert.equal(out.system.description, "<p>Plain.</p>");
  assert.deepEqual(out.flags["acks-extras"].disguise.true, {
    name: "Test Blade", img: "icons/svg/sword.svg", cost: 500, damage: "1d8+1", ac: 0, description: "<p>True.</p>",
  });
  assert.deepEqual(out.flags["acks-extras"].disguise.apparent, apparent);
});

await test("it writes the same flag shape and fields disguiseItem writes", async () => {
  const doc = mockItem({ name: "Test Blade", system: { cost: 500, description: "<p>True.</p>", damage: { base: { formula: "1d8+1" } } } });
  await disguiseItem(doc, apparent);
  const out = disguiseData({ ...weaponSource(), flags: {} }, apparent);
  assert.deepEqual(doc.flags["acks-extras"].disguise, out.flags["acks-extras"].disguise);
  assert.equal(doc.name, out.name);
  assert.equal(doc.system.cost, out.system.cost);
  assert.equal(doc.system.damage.base.formula, out.system.damage.base.formula);
  assert.equal(doc.system.description, out.system.description);
});

await test("armour masks AC and a weapon's damage is left alone by an armour disguise", () => {
  const armour = { name: "Plate", img: "a.svg", type: "armor", flags: {}, system: { cost: 900, ac: { value: 6 }, description: "" } };
  const out = disguiseData(armour, { name: "Tin", ac: 2 });
  assert.equal(out.system.ac.value, 2);
  assert.equal(out.system.damage, undefined);
  assert.equal(out.flags["acks-extras"].disguise.true.ac, 6);
});

await test("a second mask keeps the first's truth", () => {
  const once = disguiseData(weaponSource(), apparent);
  const twice = disguiseData(once, { name: "Rusty Sword" });
  assert.equal(twice.flags["acks-extras"].disguise.true.name, "Test Blade");
  assert.equal(twice.name, "Rusty Sword");
});

await test("revealItem restores what disguiseData masked, field for field", async () => {
  const masked = disguiseData(weaponSource(), apparent);
  const doc = mockItem({ name: masked.name, system: masked.system });
  doc.flags = masked.flags;
  await revealItem(doc);
  assert.equal(doc.name, "Test Blade");
  assert.equal(doc.system.cost, 500);
  assert.equal(doc.system.damage.base.formula, "1d8+1");
  assert.equal(doc.system.description, "<p>True.</p>");
  assert.equal(isDisguised(doc), false);
});

await test("a field the mask never wrote keeps a later edit through the reveal", () => {
  const out = disguiseData(weaponSource(), { name: "Old Sword" });
  const patch = revealPatch("weapon", out.flags["acks-extras"].disguise);
  assert.deepEqual(Object.keys(patch), ["name"]);
  assert.deepEqual(Object.keys(disguisePatch("weapon", { name: "Old Sword" }, { name: "x" })), ["name"]);
});

console.log("identification listener");

const maskedDoc = (markets) => {
  const masked = disguiseData(weaponSource(), apparent);
  const doc = mockItem({ name: masked.name, markets, system: masked.system });
  doc.flags["acks-extras"].disguise = masked.flags["acks-extras"].disguise;
  return doc;
};

await test("every method that recognizes is a partial-depth one in the ladder", () => {
  const recognizing = Object.entries(METHODS).filter(([, m]) => m.recognizes).map(([k]) => k).sort();
  assert.deepEqual(recognizing, ["loremastery", "magicalEngineering"]);
  assert.ok(recognizing.every((k) => METHODS[k].depth === "partial"));
});

await test("a recognizing method lifts the name and keeps the other masks", async () => {
  const doc = maskedDoc(magicFlag({ detected: false }));
  await revealOnIdentify({ item: doc, method: "loremastery", depth: "partial" });
  assert.equal(doc.name, "Test Blade");
  assert.equal(doc.system.cost, 7, "cost stays masked");
  assert.equal(isDisguised(doc), true, "the disguise flag stays until a full identification");
});

await test("a method that does not recognize (trial by use, Arcane Dabbling) leaves the name", async () => {
  const doc = maskedDoc(magicFlag({ detected: false }));
  for (const method of ["trialUse", "arcaneDabbling"]) await revealOnIdentify({ item: doc, method, depth: "partial" });
  assert.equal(doc.name, "Old Sword");
});

await test("a full identification reveals the item", async () => {
  const doc = maskedDoc(magicFlag({ detected: false, identified: "full" }));
  await revealOnIdentify({ item: doc, method: "magicResearch", depth: "full" });
  assert.equal(doc.name, "Test Blade");
  assert.equal(doc.system.cost, 500);
  assert.equal(isDisguised(doc), false);
});

await test("an item with no mask and no detected mark is left as it was", async () => {
  const doc = mockItem({ markets: magicFlag() });
  const before = JSON.stringify(doc.flags);
  await revealOnIdentify({ item: doc, method: "loremastery", depth: "partial" });
  assert.equal(JSON.stringify(doc.flags), before);
});

await test("a client that cannot write the item writes nothing", async () => {
  const doc = maskedDoc(magicFlag({ detected: false }));
  doc.isOwner = false;
  await revealOnIdentify({ item: doc, method: "magicResearch", depth: "full" });
  assert.equal(doc.name, "Old Sword");
  assert.equal(isDisguised(doc), true);
});

console.log(`magic knowledge: ${passed} checks passed`);
