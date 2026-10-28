/**
 * A weapon damage that is not dice (scripts/lib/patches/attack-throw.mjs,
 * the `getDamageFormula` wrapper).
 *
 * Stand-in libWrapper, Roll and notices: what this pins is that a formula
 * that does not parse is answered as none, so the system's builder makes no
 * damage roll, and that the Judge is told once per weapon and text. That a hit
 * then posts its card without damage is the live recipe's to prove
 * (docs/lib/TESTING.md).
 */
import assert from "node:assert/strict";

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok   " + name); };

const registered = {};
const warnings = [];
const noop = function () {};
globalThis.game = { system: { id: "acks" }, i18n: { format: (k, d = {}) => `${k}|${Object.values(d).join(",")}` } };
globalThis.libWrapper = { register: (_id, path, fn) => { registered[path] = fn; } };
globalThis.CONFIG = {
  Actor: { documentClass: { prototype: { makeAttackThrow: noop } }, dataModels: {} },
  Item: { dataModels: { weapon: { prototype: { getAttackTypes: noop, getDamageModes: noop, getDamageFormula: noop } } } },
};
// Core's `Roll.validate` parses the formula; here, the one text it refuses.
globalThis.Roll = { validate: (f) => f !== "x y" };
globalThis.ui = { notifications: { warn: (m) => warnings.push(m) } };

const { installAttackThrowPatch } = await import("../scripts/lib/patches/attack-throw.mjs");
installAttackThrowPatch();
const damageFormula = registered["CONFIG.Item.dataModels.weapon.prototype.getDamageFormula"];
const weapon = (name, formula) => ({ model: { parent: { name, uuid: `Item.${name}` } }, core: () => formula });
const ask = ({ model, core }, mode = "base") => damageFormula.call(model, core, mode);

ok("a dice formula is answered as it stands", () => {
  assert.equal(ask(weapon("sword", "1d8+@str")), "1d8+@str");
  assert.deepEqual(warnings, []);
});

ok("an empty formula is left empty, with nothing said", () => {
  assert.equal(ask(weapon("fist", "")), "");
  assert.deepEqual(warnings, []);
});

ok("a formula that does not parse is answered as none, and the Judge is told once", () => {
  const club = weapon("club", "x y");
  assert.equal(ask(club), "");
  assert.equal(ask(club), "");
  assert.deepEqual(warnings, ["ACKS-LIB.attack.badDamage|club,x y"]);
});

ok("another weapon with the same text is told about on its own", () => {
  assert.equal(ask(weapon("spear", "x y")), "");
  assert.equal(warnings.length, 2);
});

console.log(`\n${passed} passed`);
