/**
 * Pure-data regression tests for the henchmen pack builders.
 *
 * The feature's proficiency and power ITEMS retired with the module's shipped
 * library — those definitions come from the Judge's own books now — so what is
 * left to guard is the macro pack: prefixed deterministic ids, so dropping or
 * adding a macro never renumbers the others and no world's imported copy is
 * orphaned.
 *
 * Run: npm test
 */
import assert from "node:assert";

const { buildMacros, packs } = await import(new URL("./pack-data/henchmen.mjs", import.meta.url));

const macros = buildMacros();
assert.ok(macros.length > 0, "builder yields macros");
const ids = new Set();
for (const macro of macros) {
  assert.match(macro._id, /^acksHm[0-9a-f]{10}$/, `${macro.name}: prefixed deterministic id`);
  assert.strictEqual(macro._key, `!macros!${macro._id}`, `${macro.name}: pack key matches id`);
  assert.ok(!ids.has(macro._id), `${macro.name}: id is unique within the pack`);
  ids.add(macro._id);
}

assert.ok(packs && typeof packs === "object", "packs manifest exported");

console.log(`test-henchmen: OK (${macros.length} macros)`);
