/**
 * lib/roll-gates.mjs on the attack seam: a gated `damage` row reaches the damage
 * roll's modifiers, a gated `damageDice` row multiplies the dice of the formula
 * the system builds, under the delivery the throw's answer recorded, and the
 * table is told once per attack.
 *
 * Stand-in libWrapper and notices drive a fake build the way core's builder does
 * (the actor's throw modifiers for the chosen type, then the weapon's formula,
 * then the actor's damage modifiers). Every figure, name and page is invented.
 * Run: node tools/test-roll-gates-dice.mjs
 */
import assert from "node:assert/strict";

let passed = 0;
const ok = async (name, fn) => {
  await fn();
  passed++;
  console.log("ok   " + name);
};

const registered = {};
const noop = function () {};
const told = [];
globalThis.game = { system: { id: "acks" }, user: { targets: new Set() }, i18n: { has: () => false, localize: (k) => k, format: (k) => k } };
globalThis.libWrapper = { register: (_id, path, fn) => { registered[path] = fn; } };
globalThis.CONFIG = {
  Actor: { documentClass: { prototype: { makeAttackThrow: noop } }, dataModels: { monster: { prototype: { getAttackThrowModifiers: noop, getDamageModifiers: noop } } } },
  Item: { dataModels: { weapon: { prototype: { getAttackTypes: noop, getDamageModes: noop, getDamageFormula: noop } } } },
};
globalThis.Roll = { validate: () => true };
globalThis.Hooks = { callAll: () => {}, on: () => {} };
globalThis.ui = { notifications: { warn: () => {}, info: (m) => told.push(m) } };
globalThis.acksExtras = {};

const { installAttackThrowPatch } = await import("../scripts/lib/patches/attack-throw.mjs");
const { installRollGates } = await import("../scripts/lib/roll-gates.mjs");
installAttackThrowPatch();
installRollGates();

const makeAttackThrow = registered["CONFIG.Actor.documentClass.prototype.makeAttackThrow"];
const throwMods = registered["CONFIG.Actor.dataModels.monster.prototype.getAttackThrowModifiers"];
const damageMods = registered["CONFIG.Actor.dataModels.monster.prototype.getDamageModifiers"];
const formulaOf = registered["CONFIG.Item.dataModels.weapon.prototype.getDamageFormula"];

/** A scene whose grid measures straight lines in feet, 100px a 10ft square. */
const scene = { id: "s1", grid: { size: 100, distance: 10, units: "ft", measurePath: ([a, b]) => ({ distance: (Math.hypot(b.x - a.x, b.y - a.y) / 100) * 10 }) }, tokens: [] };
const tokenAt = (id, cell, disposition) => ({ id, x: cell * 100, y: 0, width: 1, height: 1, parent: scene, disposition });

const wanted = { kind: "allOf", of: [{ kind: "targetCondition", condition: "webbed" }, { kind: "rangeBand", band: ["melee", "short"] }] };
const specs = (extra = []) => [
  { type: "modifier", target: "damageDice", value: 2, gate: wanted },
  { type: "modifier", target: "damage", value: 1, gate: { kind: "targetCondition", condition: "webbed" } },
  ...extra,
];
const attacker = (effects = specs()) => ({
  type: "monster",
  name: "Attacker",
  uuid: "Actor.a",
  items: [{ id: "i1", name: "Twice", type: "ability", flags: { "acks-extras": { cookbook: { cite: "XX p. 1" }, extras: { effects } } } }],
  system: { attack: { throw: 10 }, details: { level: 1 } },
});
const bow = { system: { range: { short: 20, medium: 40, long: 60 } } };

/**
 * One attack as core builds it: the throw modifiers for `type`, the weapon's
 * formula, the damage modifiers. `skipThrow` leaves the first out. Returns
 * what each answered and the notices the attack raised.
 */
async function attack({ actor = attacker(), statuses = [], cell = 1, type = "melee", formula = "1d6 + 2", asks = 1, skipThrow = false } = {}) {
  const self = tokenAt("me", 0, -1);
  actor.token = self;
  const target = tokenAt("foe", cell, 1);
  target.actor = { statuses: new Set(statuses) };
  globalThis.game.user.targets = new Set([{ document: target }]);
  const weapon = { name: "weapon", type: "weapon", uuid: "Item.w", parent: actor, ...bow };
  weapon.system = bow.system;
  told.length = 0;
  const out = { formulas: [] };
  await makeAttackThrow.call(actor, async () => {
    if (!skipThrow) out.throw = throwMods.call({ parent: actor }, () => [], type);
    for (let i = 0; i < asks; i++) out.formulas.push(formulaOf.call({ parent: weapon }, () => formula, "base"));
    out.damage = damageMods.call({ parent: actor }, () => [], type);
    return { hit: true };
  }, { item: weapon, attackType: type });
  out.told = [...told];
  return out;
}

await ok("a gated multiple doubles the dice and a gated damage row joins the roll, in melee against a target in the condition", async () => {
  const r = await attack({ statuses: ["webbed"], type: "melee" });
  assert.deepEqual(r.formulas, ["2d6 + 2"]);
  assert.deepEqual(r.damage, [{ label: "Twice · against a target that is Webbed (XX p. 1)", value: 1 }]);
});

await ok("the table is told once per attack which part multiplied, however often the formula is asked", async () => {
  const r = await attack({ statuses: ["webbed"], asks: 3 });
  assert.deepEqual(r.formulas, ["2d6 + 2", "2d6 + 2", "2d6 + 2"]);
  assert.equal(r.told.length, 1);
  assert.match(r.told[0], /^Damage dice ×2: Twice · against a target that is Webbed, at melee, short range \(XX p\. 1\)$/);
  const next = await attack({ statuses: ["webbed"] });
  assert.equal(next.told.length, 1, "the next attack is told again");
});

await ok("a short-band missile multiplies and a long-band one does not", async () => {
  assert.deepEqual((await attack({ statuses: ["webbed"], type: "missile", cell: 2 })).formulas, ["2d6 + 2"]);
  const far = await attack({ statuses: ["webbed"], type: "missile", cell: 6 });
  assert.deepEqual(far.formulas, ["1d6 + 2"]);
  assert.deepEqual(far.told, []);
});

await ok("with the target out of the condition neither the dice nor the damage row apply, and nobody is told", async () => {
  const r = await attack({ statuses: [], type: "melee" });
  assert.deepEqual(r.formulas, ["1d6 + 2"]);
  assert.deepEqual(r.damage, []);
  assert.deepEqual(r.told, []);
});

await ok("with no delivery recorded nothing multiplies", async () => {
  const r = await attack({ statuses: ["webbed"], skipThrow: true });
  assert.deepEqual(r.formulas, ["1d6 + 2"]);
  assert.deepEqual(r.told, []);
});

await ok("a formula with no dice term comes back unchanged with no notice", async () => {
  const r = await attack({ statuses: ["webbed"], formula: "By weapon" });
  assert.deepEqual(r.formulas, ["By weapon"]);
  assert.deepEqual(r.told, []);
});

await ok("with no attack in flight the formula is the system's", () => {
  const actor = attacker();
  const weapon = { name: "weapon", type: "weapon", uuid: "Item.w", parent: actor, system: bow.system };
  assert.equal(formulaOf.call({ parent: weapon }, () => "1d6 + 2", "base"), "1d6 + 2");
  assert.equal(damageMods.call({ parent: actor }, () => [], "melee").length, 0);
});

await ok("two multiplier rows multiply once, by the largest", async () => {
  const actor = attacker(specs([{ type: "modifier", target: "damageDice", value: 3, gate: wanted }]));
  const r = await attack({ actor, statuses: ["webbed"] });
  assert.deepEqual(r.formulas, ["3d6 + 2"]);
});

console.log(`test-roll-gates-dice: all ${passed} checks passed.`);
