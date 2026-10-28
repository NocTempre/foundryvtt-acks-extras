/**
 * The stamped-record rescue (scripts/lib/patches/legacy-source.mjs).
 *
 * A stand-in for the system's data model: a `migrateData` that, like the
 * system's, renames nothing once the record carries the current stamp. What
 * this pins is that the wrap fills the new fields from the old ones ahead of
 * it, leaves a record already on the new names as it is, and touches nothing
 * else. That the system's own model then builds the actor from them is the
 * live recipe's to prove (docs/lib/TESTING.md).
 */
import assert from "node:assert/strict";

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok   " + name); };

/** A model whose `migrateData` skips its renames on a current stamp, as the system's does. */
function stampedModel() {
  return class {
    static migrateData(source) {
      if ((source?._schemaVersion ?? 0) >= 5) return source;
      source.attack ??= { throw: source.thac0?.throw };
      return source;
    }
  };
}
const character = stampedModel();
const monster = stampedModel();
globalThis.CONFIG = { Actor: { dataModels: { character, monster } } };

const { installLegacyCombatRescue } = await import("../scripts/lib/patches/legacy-source.mjs");
installLegacyCombatRescue();

ok("a stamped record holding only the old fields loads their values under the new names", () => {
  const source = {
    _schemaVersion: 5,
    thac0: { throw: 9, mod: { melee: 1, missile: 0 } },
    aac: { value: 4, mod: 0 },
    saves: { paralysis: { value: 13 }, breath: { value: 14 }, wand: { value: 15 } },
  };
  const out = character.migrateData(source);
  assert.equal(out.attack.throw, 9);
  assert.deepEqual(out.attack.mod, { melee: 1, missile: 0 });
  assert.equal(out.ac.value, 4);
  assert.equal(out.saves.blast.value, 14);
  assert.equal(out.saves.implements.value, 15);
  assert.equal(out.saves.paralysis.value, 13);
});

ok("a record carrying both keeps the new fields", () => {
  const out = monster.migrateData({
    _schemaVersion: 5,
    thac0: { throw: 9 },
    attack: { throw: 8 },
    saves: { breath: { value: 14 }, blast: { value: 12 } },
  });
  assert.equal(out.attack.throw, 8);
  assert.equal(out.saves.blast.value, 12);
});

ok("a record with no old fields is left as it is", () => {
  const source = { _schemaVersion: 5, attack: { throw: 8 }, saves: { blast: { value: 12 } } };
  const before = structuredClone(source);
  assert.deepEqual(character.migrateData(source), before);
});

ok("an unstamped record still reaches the system's own method", () => {
  const out = character.migrateData({ thac0: { throw: 9 } });
  assert.equal(out.attack.throw, 9);
});

console.log(`\n${passed} passed`);
