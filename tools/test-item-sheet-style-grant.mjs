/**
 * The item sheet's Inherited row for the active fighting style: it prints the
 * style's label, never the raw id, and its source tag names what trains the
 * style (the class, an ability, an effect) or says no class grants it. Strings
 * come from the shipped lang file, so a missing key fails here. All data is
 * invented; no Foundry.
 *
 * Run: node tools/test-item-sheet-style-grant.mjs
 */
import assert from "node:assert";
import fs from "node:fs";

const lang = JSON.parse(fs.readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
const flat = {};
const walk = (node, path) => {
  if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
  else flat[path] = node;
};
walk(lang, "");

globalThis.Hooks = { on() {}, once() {}, callAll() {} };
globalThis.game = {
  user: { isGM: false },
  settings: { get: () => null },
  i18n: {
    localize: (k) => flat[k] ?? k,
    format: (k, d = {}) => String(flat[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => d[n] ?? ""),
    has: (k) => k in flat,
  },
  modules: { get: () => ({ active: false }) },
};
globalThis.foundry = {
  utils: {},
  data: { fields: {} },
  applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (B) => class extends B {}, DialogV2: class {} }, handlebars: {} },
};

const { styleGrant } = await import("../scripts/equipment/item-sheet/snapshot.mjs");

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

/** A training effect double: a change on `styleProficient`, stamped from a class or not. */
const effect = ({ fromClass = false, value = "weaponShield", name = "Training" } = {}) => ({
  name,
  disabled: false,
  changes: [{ key: "flags.acks-extras.styleProficient", value }],
  getFlag: (_m, k) => (k === "fromClass" && fromClass ? "Compendium.x.y.Item.cls1" : undefined),
});
const actorWith = (effects = [], className = "Fighter") => ({
  type: "npc",
  system: { details: { class: className } },
  effects,
  items: [],
  getFlag: () => undefined,
});
const loadout = (over = {}) => ({ activeStyle: "weaponShield", styleProficient: true, ...over });

console.log("item sheet: the fighting-style row");
test("the label is the style's name and the raw id is never printed", () => {
  for (const id of ["single", "dual", "twoHanded", "weaponShield", "missile"]) {
    const row = styleGrant(actorWith(), loadout({ activeStyle: id, styleProficient: false }));
    assert.ok(!row.label.includes(id), `${id} leaked into "${row.label}"`);
    assert.ok(row.label.startsWith("Fighting style: "), row.label);
  }
  assert.equal(styleGrant(actorWith(), loadout({ styleProficient: false })).label, "Fighting style: Weapon & Shield");
});
test("a class's training effect names the class", () => {
  const row = styleGrant(actorWith([effect({ fromClass: true })], "Fighter"), loadout());
  assert.deepEqual(row, { label: "Fighting style: Weapon & Shield", detail: "Trained", src: "Fighter" });
});
test("the class is matched on the style's folded id", () => {
  const row = styleGrant(actorWith([effect({ fromClass: true, value: "single, Weapon & Shield" })], "Fighter"), loadout());
  assert.equal(row.src, "Fighter");
});
test("a class that cannot be named keeps the plain Class tag", () => {
  const row = styleGrant(actorWith([effect({ fromClass: true })], ""), loadout());
  assert.equal(row.src, "Class");
});
test("an effect that is not the class's tags Proficiency", () => {
  const row = styleGrant(actorWith([effect({ fromClass: false })]), loadout());
  assert.equal(row.src, "Proficiency");
  assert.equal(row.detail, "Trained");
});
test("a class effect for another style does not grant this one", () => {
  const row = styleGrant(actorWith([effect({ fromClass: true, value: "dual" })]), loadout({ styleProficient: false }));
  assert.equal(row.src, "No class grants it");
});
test("a proficiency item that trains the style tags Ability", () => {
  globalThis.acksExtras = { abilities: { getExtras: () => ({ category: "fightingStyle" }), selectionsOf: () => ["Weapon and Shield"] } };
  try {
    const actor = { ...actorWith(), items: [{ type: "ability", name: "Fighting Style: Weapon and Shield" }] };
    const row = styleGrant(actor, loadout());
    assert.equal(row.src, "Ability");
  } finally {
    delete globalThis.acksExtras;
  }
});
test("a class training outranks an effect that also trains the style", () => {
  const row = styleGrant(actorWith([effect({ fromClass: false }), effect({ fromClass: true })], "Fighter"), loadout());
  assert.equal(row.src, "Fighter");
});
test("an untrained style with nothing granting it says so", () => {
  const row = styleGrant(actorWith(), loadout({ styleProficient: false }));
  assert.deepEqual(row, { label: "Fighting style: Weapon & Shield", detail: "Untrained", src: "No class grants it" });
});
test("a trained style no effect names keeps the plain Class tag", () => {
  const row = styleGrant(actorWith(), loadout({ activeStyle: "single" }));
  assert.equal(row.src, "Class");
  assert.equal(row.detail, "Trained");
});

console.log(`\n${passed} passed`);
