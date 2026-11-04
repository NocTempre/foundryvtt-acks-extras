/**
 * The stamped-record rescue (scripts/lib/patches/legacy-source.mjs) and the
 * field test it reads (scripts/lib/actor-compat.mjs `legacyItemFields`).
 *
 * Stand-ins for the system's data models: a `migrateData` that, like the
 * system's, renames nothing once the record carries the current stamp. What
 * this pins is that the wrap fills the new fields from the old ones ahead of
 * it, or lets the system's own renames run on an item, leaves a record already
 * on the new names as it is, records what it rescued, and touches nothing
 * else. That the system's own models then build the documents from them, and
 * that the check's write lands on the record, is the live recipe's to prove
 * (docs/lib/TESTING.md).
 */
import assert from "node:assert/strict";

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok   " + name); };

const current = (source) => (source?._schemaVersion ?? 0) >= 5;

/** An actor model whose `migrateData` skips its renames on a current stamp, as the system's does. */
function stampedModel() {
  return class {
    static migrateData(source) {
      if (current(source)) return source;
      source.attack ??= { throw: source.thac0?.throw };
      return source;
    }
  };
}

/** An item model doing the system's renames below current, each under the system's own guard. */
function stampedItemModel() {
  return class {
    static calls = 0;
    static migrateData(source) {
      this.calls++;
      if (source.boom) throw new Error("boom");
      if (current(source)) return source;
      if (source.save === "breath") source.save = "blast";
      if (source.weight !== undefined && (source.weight6 === undefined || source.weight6 < 0) && source.weight >= 0) {
        source.weight6 = Math.ceil(source.weight / 166.66);
      }
      if (typeof source.damage === "string") {
        source.damage = { base: { formula: source.damage }, alternate: { formula: "" } };
      }
      if (Object.hasOwn(source, "bonus") && (typeof source.bonus !== "object" || source.bonus === null)) {
        source.bonus = { attack: Number(source.bonus) || 0, damage: 0 };
      }
      if (Array.isArray(source.tags)) source.customTags = source.tags.map((t) => t.value);
      if (Object.hasOwn(source, "aac") && !Object.hasOwn(source, "ac")) source.ac = source.aac;
      return source;
    }
  };
}

const character = stampedModel();
const monster = stampedModel();
const weapon = stampedItemModel();
const armor = stampedItemModel();
const item = stampedItemModel();
const ability = stampedItemModel();
const spell = stampedItemModel();
globalThis.CONFIG = {
  Actor: { dataModels: { character, monster } },
  Item: { dataModels: { weapon, armor, item, ability, spell } },
};

const { installLegacyCombatRescue, rescuedFields, forgetRescue } = await import("../scripts/lib/patches/legacy-source.mjs");
const { legacyItemFields } = await import("../scripts/lib/actor-compat.mjs");
installLegacyCombatRescue();

const WHOLE = { partial: false };
const PARTIAL = { partial: true };

ok("a stamped record holding only the old fields loads their values under the new names", () => {
  const source = {
    _schemaVersion: 5,
    thac0: { throw: 9, mod: { melee: 1, missile: 0 } },
    aac: { value: 4, mod: 0 },
    saves: { paralysis: { value: 13 }, breath: { value: 14 }, wand: { value: 15 } },
  };
  const out = character.migrateData(source, WHOLE);
  assert.equal(out.attack.throw, 9);
  assert.deepEqual(out.attack.mod, { melee: 1, missile: 0 });
  assert.equal(out.ac.value, 4);
  assert.equal(out.saves.blast.value, 14);
  assert.equal(out.saves.implements.value, 15);
  assert.equal(out.saves.paralysis.value, 13);
  assert.deepEqual(rescuedFields(out), ["attack", "ac", "saves.blast", "saves.implements"]);
});

ok("a record carrying both keeps the new fields and records no rescue", () => {
  const out = monster.migrateData({
    _schemaVersion: 5,
    thac0: { throw: 9 },
    attack: { throw: 8 },
    saves: { breath: { value: 14 }, blast: { value: 12 } },
  }, WHOLE);
  assert.equal(out.attack.throw, 8);
  assert.equal(out.saves.blast.value, 12);
  assert.equal(rescuedFields(out), null);
});

ok("a record with no old fields is left as it is", () => {
  const source = { _schemaVersion: 5, attack: { throw: 8 }, saves: { blast: { value: 12 } } };
  const before = structuredClone(source);
  assert.deepEqual(character.migrateData(source, WHOLE), before);
  assert.equal(rescuedFields(source), null);
});

ok("an unstamped record still reaches the system's own method", () => {
  const out = character.migrateData({ thac0: { throw: 9 } }, WHOLE);
  assert.equal(out.attack.throw, 9);
});

ok("an actor's change set is left to the system", () => {
  const changes = { thac0: { throw: 9 } };
  const out = character.migrateData(changes, PARTIAL);
  assert.equal(rescuedFields(out), null);
});

ok("a stamped weapon's string damage, numeric bonus and tag list load through the system's own renames", () => {
  const source = { _schemaVersion: 5, damage: "1d10", bonus: 2, tags: [{ value: "Slow" }] };
  const out = weapon.migrateData(source, WHOLE);
  assert.deepEqual(out.damage, { base: { formula: "1d10" }, alternate: { formula: "" } });
  assert.deepEqual(out.bonus, { attack: 2, damage: 0 });
  assert.deepEqual(out.customTags, ["Slow"]);
  assert.equal(out._schemaVersion, 5, "the stamp comes back");
  assert.deepEqual(rescuedFields(out), ["damage", "bonus", "tags"]);
});

ok("a stamped armour's aac loads as its Armor Class", () => {
  const out = armor.migrateData({ _schemaVersion: 5, aac: { value: 2 }, weight: 250 }, WHOLE);
  assert.deepEqual(out.ac, { value: 2 });
  assert.equal(out.weight6, 2);
  assert.equal(out._schemaVersion, 5);
  assert.deepEqual(rescuedFields(out), ["weight", "aac"]);
});

ok("an armour holding both aac and ac is left as it is", () => {
  const source = { _schemaVersion: 5, aac: { value: 3 }, ac: { value: 3 } };
  const out = armor.migrateData(source, WHOLE);
  assert.deepEqual(out.ac, { value: 3 });
  assert.equal(rescuedFields(out), null);
});

ok("a weapon whose damage names no alternate loads with a blank one", () => {
  const out = weapon.migrateData({ _schemaVersion: 5, damage: { base: { formula: "1d10" } }, bonus: { attack: 0, damage: 0 } }, WHOLE);
  assert.equal(out.damage.alternate.formula, "");
  assert.equal(out.damage.base.formula, "1d10");
  assert.deepEqual(rescuedFields(out), ["alternate"]);
});

ok("a stored alternate, blank or not, is never touched", () => {
  for (const formula of ["", "1d8", "1d6"]) {
    const out = weapon.migrateData({ _schemaVersion: 5, damage: { base: { formula: "1d6" }, alternate: { formula } } }, WHOLE);
    assert.equal(out.damage.alternate.formula, formula);
    assert.equal(rescuedFields(out), null);
  }
});

ok("an old save key on an ability, a spell and a weapon loads under its new name", () => {
  for (const model of [ability, spell, weapon]) {
    const out = model.migrateData({ _schemaVersion: 5, save: "breath" }, WHOLE);
    assert.equal(out.save, "blast");
    assert.deepEqual(rescuedFields(out), ["save"]);
  }
});

ok("an item's change set and creation data are left to the system", () => {
  const changes = weapon.migrateData({ damage: "1d8" }, PARTIAL);
  assert.equal(rescuedFields(changes), null);
  const created = weapon.migrateData({ damage: { base: { formula: "1d8" } } }, WHOLE);
  assert.equal(created.damage.alternate, undefined, "no stamp: creation data keeps the system's own default");
  assert.equal(rescuedFields(created), null);
});

ok("a record on the current shape runs the system's method once and is not recorded", () => {
  const before = weapon.calls;
  const source = { _schemaVersion: 5, damage: { base: { formula: "1d6" }, alternate: { formula: "" } }, bonus: { attack: 1, damage: 0 }, customTags: [] };
  weapon.migrateData(source, WHOLE);
  assert.equal(weapon.calls, before + 1);
  assert.equal(rescuedFields(source), null);
});

ok("the stamp comes back when the system's method throws", () => {
  const source = { _schemaVersion: 5, damage: "1d6", boom: true };
  assert.throws(() => weapon.migrateData(source, WHOLE), /boom/);
  assert.equal(source._schemaVersion, 5);
  assert.equal(rescuedFields(source), null);
});

ok("a source migrated twice, as an embedded item's is, keeps every field the first pass rescued", () => {
  const source = { _schemaVersion: 5, damage: "1d10", bonus: 2, tags: [{ value: "Slow" }], weight: 100 };
  weapon.migrateData(source, WHOLE);
  weapon.migrateData(source, WHOLE);
  assert.deepEqual(rescuedFields(source), ["weight", "damage", "bonus", "tags"]);
});

ok("forgetting a rescue clears it", () => {
  const out = armor.migrateData({ _schemaVersion: 5, aac: { value: 4 } }, WHOLE);
  assert.ok(rescuedFields(out));
  forgetRescue(out);
  assert.equal(rescuedFields(out), null);
});

ok("legacyItemFields names nothing for a type the system does not rename", () => {
  assert.deepEqual(legacyItemFields("money", { _schemaVersion: 5, weight: 10 }), []);
  assert.deepEqual(legacyItemFields("weapon", null), []);
});

console.log(`\n${passed} passed`);
