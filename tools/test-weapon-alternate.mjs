/**
 * The core patch that starts a weapon's alternate damage blank
 * (scripts/lib/patches/weapon-alternate.mjs). A stand-in schema mirrors the
 * system's shape: a `damage` object holding `base` and `alternate`, each built
 * from its own copy of one damage definition, whose `formula` is a blankable
 * string with a die as its initial. Cleaning fills an absent key from the
 * field's `initial`, as core's data fields do.
 */
import assert from "node:assert/strict";

let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

const warnings = [];
console.warn = (...args) => warnings.push(args.join(" "));

class StringField {
  constructor({ blank = true, initial = "" } = {}) { this.blank = blank; this.initial = initial; }
  getInitialValue() { return this.initial; }
  clean(value) { return value === undefined ? this.getInitialValue() : value; }
}
/** A field whose initial is read once, so a later change to `initial` cannot reach it. */
class FrozenStringField extends StringField {
  constructor(options) { super(options); this.fixed = this.initial; }
  getInitialValue() { return this.fixed; }
}
class SchemaField {
  constructor(fields) { this.fields = fields; }
  clean(value) {
    const out = { ...(value ?? {}) };
    for (const [name, field] of Object.entries(this.fields)) out[name] = field.clean(out[name]);
    return out;
  }
  getField(path) {
    const [name, ...rest] = Array.isArray(path) ? path : path.split(".");
    const field = this.fields[name];
    return rest.length ? field?.getField?.(rest) : field;
  }
}
/** The system's damage definition, built fresh each call: base and alternate never share a field. */
const damageField = (Formula = StringField, options = { blank: true, initial: "1d6" }) => new SchemaField({ formula: new Formula(options) });
const weaponModel = (alternate = damageField()) => ({ schema: new SchemaField({ damage: new SchemaField({ base: damageField(), alternate }) }) });

globalThis.foundry = { data: { fields: { StringField } } };
const install = (model) => {
  globalThis.CONFIG = { Item: { dataModels: model ? { weapon: model } : {} } };
  warnings.length = 0;
  installWeaponAlternatePatch();
};
const { installWeaponAlternatePatch, alternateCleansBlank } = await import("../scripts/lib/patches/weapon-alternate.mjs");

const stored = (model) => model.schema.getField("damage").clean({ base: { formula: "1d7" } });

await ok("a weapon with no alternate stores the system's die before the patch and none after", async () => {
  const model = weaponModel();
  assert.equal(stored(model).alternate.formula, "1d6");
  assert.equal(alternateCleansBlank(model), false);
  install(model);
  assert.equal(alternateCleansBlank(model), true);
  assert.equal(stored(model).alternate.formula, "");
  assert.equal(model.schema.getField("damage").clean({ base: { formula: "1d7" }, alternate: {} }).alternate.formula, "");
  assert.deepEqual(warnings, []);
});

await ok("the base die keeps its default and a stated alternate is untouched", async () => {
  const model = weaponModel();
  install(model);
  assert.equal(model.schema.getField("damage.base.formula").initial, "1d6");
  assert.equal(stored(model).base.formula, "1d7");
  assert.equal(model.schema.getField("damage").clean({ base: { formula: "1d7" } }).base.formula, "1d7");
  assert.equal(model.schema.getField("damage").clean({ base: { formula: "1d7" }, alternate: { formula: "1d9" } }).alternate.formula, "1d9");
  assert.equal(model.schema.getField("damage").clean({ base: { formula: "1d7" }, alternate: { formula: "1d6" } }).alternate.formula, "1d6");
});

await ok("a model that already cleans blank is left alone, with no warning", async () => {
  const model = weaponModel(damageField(StringField, { blank: true, initial: "" }));
  const field = model.schema.getField("damage.alternate.formula");
  install(model);
  assert.equal(field.initial, "");
  assert.deepEqual(warnings, []);
});

await ok("a missing model, damage path or string field returns without throwing and warns once", async () => {
  install(null);
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].startsWith("acks-extras |"), warnings[0]);
  globalThis.CONFIG = undefined;
  warnings.length = 0;
  installWeaponAlternatePatch();
  assert.equal(warnings.length, 1);
  for (const model of [{}, { schema: {} }, { schema: new SchemaField({}) }, { schema: new SchemaField({ damage: new SchemaField({ base: damageField() }) }) }]) {
    install(model);
    assert.equal(warnings.length, 1, JSON.stringify(Object.keys(model)));
  }
  install({ schema: new SchemaField({ damage: new SchemaField({ base: damageField(), alternate: new SchemaField({ formula: { initial: "1d6", blank: true } }) }) }) });
  assert.equal(warnings.length, 1);
  assert.equal(alternateCleansBlank(null), null);
  assert.equal(alternateCleansBlank({ schema: { getField: () => ({ clean() { throw new Error("x"); } }) } }), null);
});

await ok("a field that is not blankable is left alone and warns once", async () => {
  const model = weaponModel(damageField(StringField, { blank: false, initial: "1d6" }));
  const field = model.schema.getField("damage.alternate.formula");
  install(model);
  assert.equal(field.initial, "1d6");
  assert.equal(warnings.length, 1);
});

await ok("a second install changes nothing", async () => {
  const model = weaponModel();
  install(model);
  const field = model.schema.getField("damage.alternate.formula");
  const snapshot = JSON.stringify({ alternate: field, base: model.schema.getField("damage.base.formula") });
  install(model);
  assert.equal(JSON.stringify({ alternate: field, base: model.schema.getField("damage.base.formula") }), snapshot);
  assert.deepEqual(warnings, []);
});

await ok("a change that does not take is restored, with one warning", async () => {
  const model = weaponModel(damageField(FrozenStringField));
  const field = model.schema.getField("damage.alternate.formula");
  install(model);
  assert.equal(field.initial, "1d6");
  assert.equal(stored(model).alternate.formula, "1d6");
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].startsWith("acks-extras |"), warnings[0]);
});

console.log(`\n${passed} passed`);
