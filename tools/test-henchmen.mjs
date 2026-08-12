/**
 * Pure-data regression tests for the henchmen pack builders.
 * Guards the Active Effect change contract: every change carries a v14 string
 * `type` (a key of ACTIVE_EFFECT_CHANGE_TYPES) and a string value on a
 * flags.acks-extras.* key — never the deprecated numeric `mode`.
 *
 * Run: npm test
 */
import assert from "node:assert";

const CHANGE_TYPES = new Set(["custom", "multiply", "add", "subtract", "downgrade", "upgrade", "override"]);

const { buildProficienciesPowers, buildMacros, packs } = await import(
  new URL("./pack-data/henchmen.mjs", import.meta.url)
);

const items = buildProficienciesPowers();
assert.ok(items.length > 0, "builder yields items");

for (const item of items) {
  assert.match(item._id, /^acksHm[0-9a-f]{10}$/, `${item.name}: prefixed deterministic id`);
  assert.strictEqual(item._key, `!items!${item._id}`, `${item.name}: pack key matches id`);
  for (const eff of item.effects ?? []) {
    assert.strictEqual(eff._key, `!items.effects!${item._id}.${eff._id}`, `${item.name}: effect key nests under item`);
    assert.ok(eff.changes.length > 0, `${item.name}: effect ${eff.name} has changes`);
    for (const change of eff.changes) {
      assert.ok(!("mode" in change), `${item.name}: change ${change.key} carries deprecated numeric mode`);
      assert.ok(CHANGE_TYPES.has(change.type), `${item.name}: change ${change.key} type "${change.type}" is a v14 change type`);
      assert.match(change.key, /^flags\.acks-extras\./, `${item.name}: change key ${change.key} stays in the module flag namespace`);
      assert.strictEqual(typeof change.value, "string", `${item.name}: change ${change.key} value is a string`);
      assert.strictEqual(typeof change.priority, "number", `${item.name}: change ${change.key} has a priority`);
    }
  }
}

const macros = buildMacros();
assert.ok(macros.length > 0, "builder yields macros");
for (const macro of macros) {
  assert.match(macro._id, /^acksHm[0-9a-f]{10}$/, `${macro.name}: prefixed deterministic id`);
}

assert.ok(packs && typeof packs === "object", "packs manifest exported");

console.log(`test-henchmen: OK (${items.length} items, ${macros.length} macros)`);
