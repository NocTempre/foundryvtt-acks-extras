/**
 * A spell's damage on the attack seam (scripts/lib/patches/attack-throw.mjs):
 * the carrier known by identity, the fourth attack kind, the contributors that
 * opt in, the damage a spell makes with no throw, and the attack card a cast
 * owns.
 *
 * Stand-in libWrapper, Hooks, items and models: what this pins is which
 * questions the wrappers answer for a carrier and which for every other
 * weapon, and in what order. That core's dialog and card carry the same
 * object through is the live recipe's to prove (docs/magic/TESTING.md). Every
 * spell, formula and figure below is invented.
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
const hooks = {};
globalThis.game = {
  system: { id: "acks" },
  user: { targets: [] },
  i18n: { format: (k) => k, localize: (k) => (k === "ACKS-LIB.attack.type.magic" ? "Magic" : k), has: () => false, translations: {} },
};
globalThis.libWrapper = { register: (_id, path, fn) => { registered[path] = fn; } };
globalThis.Hooks = { callAll: noop, on: (name, fn) => void (hooks[name] ??= []).push(fn) };
globalThis.ui = { notifications: { warn: noop } };
globalThis.Roll = { validate: () => true };
globalThis.ChatMessage = { getSpeakerActor: (speaker) => speaker?.actorRef ?? null };

/** A weapon item as core builds one: a document holding a system model that answers the weapon questions. */
class FakeItem {
  constructor(data, { parent } = {}) {
    this.name = data.name;
    this.img = data.img;
    this.type = data.type;
    this.parent = parent;
    this.system = {
      parent: this,
      ...data.system,
      getDamageFormula() { return this.damage.base.formula; },
      getDamageModifiers() { return [{ label: "Weapon", value: 0 }]; },
    };
  }
}
globalThis.CONFIG = {
  Actor: {
    documentClass: { prototype: { makeAttackThrow: noop } },
    dataModels: { character: { prototype: { getAttackThrowModifiers: noop, getDamageModifiers: noop } } },
  },
  Item: {
    documentClass: FakeItem,
    dataModels: { weapon: { prototype: { getAttackTypes: noop, getDamageModes: noop, getDamageFormula: noop } } },
  },
};

const seam = await import("../scripts/lib/patches/attack-throw.mjs");
const {
  MAGIC_ATTACK_TYPE, MAGIC_ATTACK_FLAG, addAttackContributor, attackInFlight, carrierCardMatch, carrierData, carrierOf,
  installAttackThrowPatch, isSpellCarrier, magicDamageSpec, modifiedFormula, spellCarrier, stripApplyDamage,
} = seam;
installAttackThrowPatch();

const makeAttackThrow = registered["CONFIG.Actor.documentClass.prototype.makeAttackThrow"];
const actorAttack = registered["CONFIG.Actor.dataModels.character.prototype.getAttackThrowModifiers"];
const actorDamage = registered["CONFIG.Actor.dataModels.character.prototype.getDamageModifiers"];
const weaponTypes = registered["CONFIG.Item.dataModels.weapon.prototype.getAttackTypes"];
const weaponModes = registered["CONFIG.Item.dataModels.weapon.prototype.getDamageModes"];
const weaponFormula = registered["CONFIG.Item.dataModels.weapon.prototype.getDamageFormula"];

/** An actor whose model asks the seam as core's builder would. */
const makeActor = (uuid = "Actor.caster") => {
  const actor = { uuid, name: "Caster", system: { attack: { throw: 10 }, parent: null }, getRollData: () => ({ lvl: 3 }) };
  actor.system.parent = actor;
  return actor;
};
const SCORCH = { key: "scorch", type: "damage", roll: "2d4", damage: ["fire", "varies", "nonesuch", "fire"], extraordinary: true, delivery: "missile" };
const spell = { name: "Test Scorch", img: "scorch.webp", uuid: "Item.testScorch" };

// Contributors: one answers everything and never opted in, one opted in for the throw only.
const asked = { plain: [], opted: [], damage: [] };
addAttackContributor({
  attack: (ctx, type, rows) => { asked.plain.push({ type, ctxType: ctx.type }); return [...rows, { label: "plain", value: 1 }]; },
  damage: (ctx, type, rows) => { asked.plain.push({ damage: type }); return [...rows, { label: "plainDamage", value: 1 }]; },
  attackTypes: (_item, types) => [...types, "never"],
  damageFormula: () => "9d9",
});
addAttackContributor({
  carriers: ["attack"],
  attack: (ctx, type, rows) => { asked.opted.push({ type, ctxType: ctx.type }); return [...rows, { label: "opted", value: 2 }]; },
  damage: () => { asked.damage.push("asked"); return [{ label: "never", value: 5 }]; },
});
addAttackContributor({
  carriers: ["damage"],
  damage: (ctx, type, rows) => { asked.damage.push({ type, ctxType: ctx.type }); return [...rows, { label: "optedDamage", value: 3 }]; },
});

await ok("carrierData writes a weapon named and drawn as the spell, its damage the row's own", () => {
  const data = carrierData(SCORCH, { spell });
  assert.deepEqual(data, {
    name: "Test Scorch",
    img: "scorch.webp",
    type: "weapon",
    system: { melee: false, missile: true, damage: { base: { formula: "2d4", types: ["fire", "variesByWeapon"], extraordinary: true } } },
  });
});

await ok("carrierData reads a delivery given beside the row, falls back to melee and writes a blank formula", () => {
  const melee = carrierData({ type: "damage", extraordinary: null }, { spell, delivery: "melee" });
  assert.equal(melee.system.melee, true);
  assert.equal(melee.system.missile, false);
  assert.equal(melee.system.damage.base.formula, "", "a row with no dice still writes the formula");
  assert.deepEqual(melee.system.damage.base.types, []);
  assert.equal(melee.system.damage.base.extraordinary, false, "only a true mark is extraordinary; unset is not");
  assert.equal(carrierData({ delivery: "none" }, { spell }).system.melee, true, "a delivery that is no throw reads as the first kind");
  assert.equal(carrierData({ delivery: "missile" }, { spell, delivery: "melee" }).system.missile, false, "the caller's delivery wins");
});

await ok("a carrier is known by identity: a forged flag, a copy and a plain weapon are not carriers", () => {
  const actor = makeActor();
  const carrier = spellCarrier(actor, SCORCH, { spell, castId: "c1", rowKey: "scorch" });
  assert.equal(isSpellCarrier(carrier), true);
  assert.deepEqual({ ...carrierOf(carrier), row: undefined }, { castId: "c1", rowKey: "scorch", spellUuid: "Item.testScorch", delivery: "missile", row: undefined });
  assert.equal(carrier.parent, actor, "unsaved, parented to the caster");
  const forged = new FakeItem(carrierData(SCORCH, { spell }), { parent: actor });
  forged.flags = { "acks-extras": { spellCarrier: true, magicAttack: true } };
  assert.equal(isSpellCarrier(forged), false, "a flag makes no carrier");
  assert.equal(isSpellCarrier({ ...carrier }), false, "a copy of one is not one");
  assert.equal(isSpellCarrier(null), false);
  assert.equal(isSpellCarrier("Item.x"), false);
  assert.equal(carrierOf(forged), null);
  assert.equal(Object.isFrozen(carrierOf(carrier)), true, "what it was made for cannot be edited");
});

await ok("a carrier's weapon answers the one kind, calling the system's answer once and asking no contributor", () => {
  const carrier = spellCarrier(makeActor(), SCORCH, { spell });
  let calls = 0;
  const types = weaponTypes.call(carrier.system, () => { calls++; return ["melee"]; });
  assert.deepEqual(types, [MAGIC_ATTACK_TYPE]);
  assert.equal(calls, 1);
  assert.deepEqual(weaponModes.call(carrier.system, () => ["base"], MAGIC_ATTACK_TYPE), ["base"]);
  assert.equal(weaponFormula.call(carrier.system, () => "2d4"), "2d4", "the formula is the system's answer, never a contributor's");
});

await ok("any other weapon is still every contributor's to answer", () => {
  const plain = new FakeItem({ name: "Pole", type: "weapon", system: {} }, { parent: makeActor() });
  assert.deepEqual(weaponTypes.call(plain.system, () => ["melee"]), ["melee", "never"]);
  assert.equal(weaponFormula.call(plain.system, () => "1d6"), "9d9");
});

await ok("the formula guard holds for a carrier: a formula that does not parse is answered as none", () => {
  const carrier = spellCarrier(makeActor(), { ...SCORCH, roll: "x y" }, { spell });
  globalThis.Roll = { validate: () => false };
  try {
    assert.equal(weaponFormula.call(carrier.system, () => "x y"), "");
  } finally {
    globalThis.Roll = { validate: () => true };
  }
});

await ok("a carrier's attack: the base is the system's answer for the delivery, only an opted contributor is asked, with the delivery, and ctx.type stays magic", async () => {
  const actor = makeActor();
  const carrier = spellCarrier(actor, SCORCH, { spell, castId: "c2", rowKey: "scorch" });
  asked.plain.length = asked.opted.length = asked.damage.length = 0;
  const seen = { actorCalls: [], damageCalls: [], ctxType: null, rows: null, damageRows: null };
  const outcome = await makeAttackThrow.call(
    actor,
    async (options) => {
      seen.options = options;
      const ctx = attackInFlight(actor);
      seen.ctxType = ctx.type;
      seen.rows = actorAttack.call(actor.system, (t) => { seen.actorCalls.push(t); return [{ label: "core", value: 4 }]; }, MAGIC_ATTACK_TYPE);
      seen.damageRows = actorDamage.call(actor.system, (t) => { seen.damageCalls.push(t); return [{ label: "coreDamage", value: 9 }]; }, MAGIC_ATTACK_TYPE);
      seen.ctxTypeAfter = ctx.type;
      return { ok: true };
    },
    { item: carrier, acksLib: { terms: [{ label: "asked", value: 1 }], damageTerms: [{ label: "extra", value: "1d4" }] } },
  );
  assert.deepEqual(outcome, { ok: true });
  assert.equal(seen.options.attackType, MAGIC_ATTACK_TYPE, "core is asked for the one kind");
  assert.equal(seen.options.item, carrier, "and handed the same object");
  assert.deepEqual(seen.actorCalls, ["missile"], "the attack base is the system's answer for the delivery");
  assert.deepEqual(seen.rows, [{ label: "core", value: 4 }, { label: "opted", value: 2 }, { label: "asked", value: 1 }]);
  assert.deepEqual(asked.opted, [{ type: "missile", ctxType: "magic" }], "an opted contributor is asked with the delivery, and sees magic");
  assert.deepEqual(asked.plain, [], "a contributor that did not opt in is never asked");
  assert.equal(seen.ctxType, MAGIC_ATTACK_TYPE);
  assert.equal(seen.ctxTypeAfter, MAGIC_ATTACK_TYPE, "asking never moves the type off magic");
  assert.deepEqual(seen.damageCalls, [MAGIC_ATTACK_TYPE], "the system is still asked its damage question");
  assert.deepEqual(
    seen.damageRows,
    [{ label: "optedDamage", value: 3 }, { label: "extra", value: "1d4" }],
    "the damage base is nothing: the opted damage contributor's row and the caller's rows only",
  );
  assert.deepEqual(asked.damage, [{ type: MAGIC_ATTACK_TYPE, ctxType: "magic" }]);
  assert.equal(attackInFlight(actor), null, "nothing is held once the throw resolves");
});

await ok("an ordinary attack is every contributor's: the type moves and nothing is skipped", async () => {
  const actor = makeActor("Actor.fighter");
  asked.plain.length = asked.opted.length = 0;
  await makeAttackThrow.call(actor, async () => {
    const rows = actorAttack.call(actor.system, () => [{ label: "core", value: 1 }], "melee");
    assert.deepEqual(rows.map((r) => r.label), ["core", "plain", "opted"]);
    assert.equal(attackInFlight(actor).type, "melee");
    return null;
  }, {});
  assert.deepEqual(asked.plain, [{ type: "melee", ctxType: "melee" }]);
  assert.deepEqual(asked.opted, [{ type: "melee", ctxType: "melee" }]);
});

await ok("magicDamageSpec rolls the damage with no throw: modifiers from the caster and the carrier, the carrier's types, no floor", async () => {
  const actor = makeActor();
  actor.system.getDamageModifiers = function (type) {
    const ctx = attackInFlight(actor);
    return [{ label: "Caster", value: type === MAGIC_ATTACK_TYPE && ctx?.target === null ? 1 : 100 }, { label: "Zero", value: 0 }];
  };
  const carrier = spellCarrier(actor, SCORCH, { spell });
  carrier.system.getDamageModifiers = () => [{ label: "Weapon", value: 0 }, { label: "Bonus", value: -2 }];
  carrier.system.damage.base.types = ["fire", "variesByWeapon"];
  const spec = await magicDamageSpec(actor, carrier, { terms: [{ label: "Situational", value: "1d4" }] });
  assert.equal(spec.formula, "2d4 + 1 - 2");
  assert.deepEqual(spec.modifiers, [{ label: "Caster", value: "+1" }, { label: "Bonus", value: "-2" }]);
  assert.deepEqual(spec.types, ["fire", "variesByWeapon"]);
  assert.equal(spec.extraordinary, true);
  assert.deepEqual(spec.data, { lvl: 3 });
  assert.equal(attackInFlight(actor), null, "the held context is released");
});

await ok("magicDamageSpec asks the same question a throw asks, so an opted contributor answers it, and restores an attack already in flight", async () => {
  const actor = makeActor("Actor.busy");
  const carrier = spellCarrier(actor, SCORCH, { spell });
  let inside;
  actor.system.getDamageModifiers = function (type) {
    const rows = damageModifiersThroughSeam(this, type);
    inside = attackInFlight(actor);
    return rows;
  };
  const damageModifiersThroughSeam = (system, type) => actorDamage.call(system, () => [{ label: "core", value: 9 }], type);
  asked.damage.length = 0;
  let prior;
  await makeAttackThrow.call(actor, async () => {
    prior = attackInFlight(actor);
    const spec = await magicDamageSpec(actor, carrier, { terms: [{ label: "term", value: 2 }] });
    assert.deepEqual(spec.modifiers.map((m) => m.label), ["optedDamage", "term"], "core's answer for magic is left out, the opted contributor's row and the term stay");
    assert.equal(attackInFlight(actor), prior, "the attack in flight comes back");
    return null;
  }, {});
  assert.equal(inside.item, carrier);
  assert.equal(inside.target, null, "no target is held for a no-throw damage");
  assert.equal(inside.conditionsTold, true, "nothing is reported to the table");
  assert.equal(attackInFlight(actor), null);
});

await ok("magicDamageSpec answers null for a carrier with no formula, a plain weapon and no caster", async () => {
  const actor = makeActor();
  assert.equal(await magicDamageSpec(actor, spellCarrier(actor, { type: "damage" }, { spell })), null);
  assert.equal(await magicDamageSpec(actor, new FakeItem({ name: "Pole", type: "weapon", system: { damage: { base: { formula: "1d6" } } } }, { parent: actor })), null);
  assert.equal(await magicDamageSpec(null, spellCarrier(actor, SCORCH, { spell })), null);
  assert.equal(attackInFlight(actor), null);
});

await ok("modifiedFormula signs each figure, drops a zero and keeps a formula fragment, as the system's own does", () => {
  assert.deepEqual(modifiedFormula("1d8", []), { formula: "1d8", modifiers: [] });
  assert.equal(modifiedFormula("1d8", [{ label: "a", value: 2 }, { label: "b", value: -1 }, { label: "c", value: 0 }]).formula, "1d8 + 2 - 1");
  assert.equal(modifiedFormula("1d8", [{ label: "a", value: "1d4" }, { label: "b", value: "-@str" }, { label: "c", value: "+0" }, { label: "d", value: "-0" }]).formula, "1d8 + 1d4 - @str");
  assert.equal(modifiedFormula("1d8", [{ label: "a", value: "" }, { label: "b", value: null }, { label: "c", value: undefined }, { label: "d", value: "  " }]).formula, "1d8");
  assert.deepEqual(modifiedFormula("1d8", [{ label: "a", value: " 3 " }]).modifiers, [{ label: "a", value: "+3" }], "a bare value takes a plus");
  assert.equal(modifiedFormula("1d8", [{ label: "a", value: "+ 2" }]).formula, "1d8 + 2", "a sign and its figure are re-spaced");
});

await ok("carrierCardMatch finds only the attack card of a carrier attack in flight, by the speaker's actor", () => {
  const map = new Map([["Actor.caster", { castId: "c3", rowKey: "scorch", spellUuid: "Item.testScorch" }]]);
  const card = '<section class="acksii chat-card attack-throw-card"></section>';
  assert.deepEqual(carrierCardMatch({ actorUuids: ["Actor.caster"], content: card }, map), { castId: "c3", rowKey: "scorch", spellUuid: "Item.testScorch" });
  assert.equal(carrierCardMatch({ actorUuids: ["Actor.other"], content: card }, map), null, "another actor's card");
  assert.equal(carrierCardMatch({ actorUuids: ["Actor.caster"], content: "<p>hello</p>" }, map), null, "another kind of message");
  assert.equal(carrierCardMatch({ actorUuids: [], content: card }, map), null, "no actor");
  assert.equal(carrierCardMatch({ actorUuids: [null], content: card }, map), null, "a null entry");
  assert.equal(carrierCardMatch({ actorUuids: ["Actor.caster"], content: card }, new Map()), null, "nothing in flight");
  assert.equal(carrierCardMatch({}, map), null);
});

await ok("carrierCardMatch finds a cast held under the world actor from its unlinked token's speaker, and the exact uuid wins", () => {
  const card = '<section class="acksii chat-card attack-throw-card"></section>';
  const world = { castId: "cW", rowKey: "scorch", spellUuid: "Item.testScorch" };
  const synthetic = { castId: "cT", rowKey: "scorch", spellUuid: "Item.testScorch" };
  const speaker = ["Scene.s.Token.t.Actor.a", "Actor.a"];
  assert.deepEqual(carrierCardMatch({ actorUuids: speaker, content: card }, new Map([["Actor.a", world]])), world, "held under the world actor");
  assert.deepEqual(carrierCardMatch({ actorUuids: speaker, content: card }, new Map([["Actor.a", world], ["Scene.s.Token.t.Actor.a", synthetic]])), synthetic, "the exact uuid wins");
  assert.equal(carrierCardMatch({ actorUuids: ["Scene.s.Token.t.Actor.b", "Actor.b"], content: card }, new Map([["Actor.a", world]])), null, "another actor");
});

await ok("speakerActorUuids lists the speaker's uuid, then its base actor's when it is a token's, without nulls or repeats", () => {
  assert.deepEqual(seam.speakerActorUuids({ uuid: "Actor.a" }), ["Actor.a"]);
  assert.deepEqual(seam.speakerActorUuids({ uuid: "Scene.s.Token.t.Actor.a", isToken: true, token: { baseActor: { uuid: "Actor.a" } } }), ["Scene.s.Token.t.Actor.a", "Actor.a"]);
  assert.deepEqual(seam.speakerActorUuids({ uuid: "Scene.s.Token.t.Actor.a", isToken: true, token: { baseActor: null } }), ["Scene.s.Token.t.Actor.a"], "no base actor");
  assert.deepEqual(seam.speakerActorUuids({ uuid: "Actor.a", isToken: true, token: { baseActor: { uuid: "Actor.a" } } }), ["Actor.a"], "no repeat");
  assert.deepEqual(seam.speakerActorUuids(null), []);
});

await ok("stripApplyDamage removes the apply button and the group it empties, and leaves every other button alone", () => {
  const card = `<section class="attack-throw-card"><div class="card-buttons">
      <button type="button" data-action="applyDamage" data-damage="7" data-target-uuid="Actor.t">
        <i class="fa-solid fa-droplet" inert></i>
        <span>Apply 7</span>
      </button>
    </div><footer>after</footer></section>`;
  assert.equal(stripApplyDamage(card), '<section class="attack-throw-card"><footer>after</footer></section>');
  const shared = '<div class="card-buttons"><button type="button" data-action="other">x</button><button data-target-uuid="a" data-action="applyDamage">y</button></div>';
  assert.equal(stripApplyDamage(shared), '<div class="card-buttons"><button type="button" data-action="other">x</button></div>', "a group with another button stays");
  assert.equal(stripApplyDamage("<p>none</p>"), "<p>none</p>");
  assert.equal(stripApplyDamage(null), "");
});

await ok("a carrier attack's card is stripped and marked before it is stored, and only while that attack is in flight", async () => {
  const hook = hooks.preCreateChatMessage?.at(-1);
  assert.equal(typeof hook, "function", "the seam listens before a message is created");
  const actor = makeActor("Actor.hurler");
  const carrier = spellCarrier(actor, SCORCH, { spell, castId: "c4", rowKey: "scorch" });
  const content = '<section class="attack-throw-card"><div class="card-buttons"><button data-action="applyDamage">x</button></div></section>';
  const message = () => {
    const m = { speaker: { actorRef: actor }, content, updates: [], updateSource(u) { this.updates.push(u); } };
    return m;
  };
  const during = message();
  await makeAttackThrow.call(actor, async () => { hook(during); return null; }, { item: carrier });
  assert.equal(during.updates.length, 1);
  assert.equal(during.updates[0].content, '<section class="attack-throw-card"></section>');
  assert.deepEqual(during.updates[0][`flags.acks-extras.${MAGIC_ATTACK_FLAG}`], { castId: "c4", rowKey: "scorch", spellUuid: "Item.testScorch" });
  const after = message();
  hook(after);
  assert.deepEqual(after.updates, [], "once the attack has resolved nothing is marked");
  const ordinary = message();
  await makeAttackThrow.call(actor, async () => { hook(ordinary); return null; }, { item: new FakeItem({ name: "Pole", type: "weapon", system: {} }, { parent: actor }) });
  assert.deepEqual(ordinary.updates, [], "a card whose apply button names no figure or target (this fixture's) is left as it is, whoever the weapon is");
  const failing = message();
  failing.updateSource = () => { throw new Error("refused"); };
  const quiet = console.error;
  console.error = noop;
  try {
    await makeAttackThrow.call(actor, async () => { hook(failing); return null; }, { item: carrier });
  } finally {
    console.error = quiet;
  }
});

await ok("a carrier attack in flight is released when the attack throws", async () => {
  const actor = makeActor("Actor.thrower");
  const carrier = spellCarrier(actor, SCORCH, { spell });
  await assert.rejects(makeAttackThrow.call(actor, async () => { throw new Error("dialog failed"); }, { item: carrier }), /dialog failed/);
  assert.equal(attackInFlight(actor), null);
  const hook = hooks.preCreateChatMessage.at(-1);
  const m = { speaker: { actorRef: actor }, content: '<div class="attack-throw-card"></div>', updates: [], updateSource(u) { this.updates.push(u); } };
  hook(m);
  assert.deepEqual(m.updates, []);
});

/** An attack card as core's template writes one, with its Apply button. */
const hitCard = ({ damage = "11", target = "Scene.s1.Token.t9" } = {}) =>
  `<section class="acksii chat-card attack-throw-card"><div class="card-buttons"><button type="button" data-action="applyDamage" data-damage="${damage}" data-target-uuid="${target}"><i inert></i><span>Apply</span></button></div><footer>after</footer></section>`;
const sword = (actor, { types = ["slashing", "variesByWeapon"], extraordinary = false, silver = false } = {}) =>
  new FakeItem({ name: "Test Blade", type: "weapon", system: { damage: { base: { formula: "1d8", types: new Set(types), extraordinary } }, special: { silver } } }, { parent: actor });

await ok("attackDamageOf reads the weapon's base damage and core's silver field, and an attack with no weapon has no type", () => {
  const actor = makeActor("Actor.reader");
  assert.deepEqual(seam.attackDamageOf(sword(actor, { types: ["fire", "slashing"], extraordinary: true, silver: true })), { types: ["fire", "slashing"], extraordinary: true, silver: true });
  assert.deepEqual(seam.attackDamageOf(sword(actor)), { types: ["slashing", "variesByWeapon"], extraordinary: false, silver: false });
  assert.deepEqual(seam.attackDamageOf(null), { types: [], extraordinary: false, silver: false });
  assert.equal(seam.attackDamageOf({ system: { silver: true } }).silver, false, "the field is special.silver, not silver");
});

await ok("attackApplyMatch reads the figure and the target off the apply button, and nothing it cannot read whole", () => {
  const map = new Map([["Actor.a", { types: ["cold"], extraordinary: true, silver: false }]]);
  assert.deepEqual(seam.attackApplyMatch({ actorUuids: ["Actor.a"], content: hitCard() }, map), {
    targetUuid: "Scene.s1.Token.t9", rolled: 11, types: ["cold"], extraordinary: true, silver: false,
  });
  assert.equal(seam.attackApplyMatch({ actorUuids: ["Actor.a"], content: hitCard({ damage: "0" }) }, map).rolled, 0, "a floor of 0 is still a hit");
  assert.equal(seam.attackApplyMatch({ actorUuids: ["Actor.a"], content: hitCard({ damage: "x" }) }, map), null, "no figure");
  assert.equal(seam.attackApplyMatch({ actorUuids: ["Actor.a"], content: hitCard({ damage: "" }) }, map), null, "a blank figure is not zero");
  assert.equal(seam.attackApplyMatch({ actorUuids: ["Actor.a"], content: hitCard({ damage: "-3" }) }, map), null);
  assert.equal(seam.attackApplyMatch({ actorUuids: ["Actor.a"], content: hitCard({ target: "" }) }, map), null, "no target");
  assert.equal(seam.attackApplyMatch({ actorUuids: ["Actor.a"], content: '<section class="attack-throw-card"><button data-action="applyDamage">x</button></section>' }, map), null, "a button with neither attribute");
  assert.equal(seam.attackApplyMatch({ actorUuids: ["Actor.a"], content: '<section class="attack-throw-card">a miss</section>' }, map), null, "a miss has no button");
  assert.equal(seam.attackApplyMatch({ actorUuids: ["Actor.b"], content: hitCard() }, map), null, "another actor");
  assert.equal(seam.attackApplyMatch({ actorUuids: ["Actor.a"], content: "<p>hello</p>" }, map), null, "another kind of message");
  assert.equal(seam.attackApplyMatch({ actorUuids: ["Actor.a"], content: hitCard() }, new Map()), null, "nothing in flight");
  assert.equal(seam.attackApplyMatch({}, map), null);
});

await ok("attackApplyMatch finds an attack held under the world actor from its unlinked token's speaker, and the exact uuid wins", () => {
  const world = { types: ["cold"], extraordinary: false, silver: false };
  const synthetic = { types: ["fire"], extraordinary: false, silver: false };
  const speaker = ["Scene.s.Token.t.Actor.a", "Actor.a"];
  assert.deepEqual(seam.attackApplyMatch({ actorUuids: speaker, content: hitCard() }, new Map([["Actor.a", world]])).types, ["cold"], "held under the world actor");
  assert.deepEqual(seam.attackApplyMatch({ actorUuids: speaker, content: hitCard() }, new Map([["Actor.a", world], ["Scene.s.Token.t.Actor.a", synthetic]])).types, ["fire"], "the exact uuid wins");
  assert.equal(seam.attackApplyMatch({ actorUuids: ["Scene.s.Token.t.Actor.b", "Actor.b"], content: hitCard() }, new Map([["Actor.a", world]])), null, "another actor");
});

await ok("a card spoken by a world actor's unlinked token is stamped, for a weapon attack and for a cast, through the hook", async () => {
  const hook = hooks.preCreateChatMessage.at(-1);
  const world = makeActor("Actor.sidebar");
  const tokenActor = { uuid: "Scene.s.Token.t.Actor.sidebar", isToken: true, token: { baseActor: world } };
  const message = (content = hitCard()) => ({ speaker: { actorRef: tokenActor }, content, updates: [], updateSource(u) { this.updates.push(u); } });
  const swing = message();
  await makeAttackThrow.call(world, async () => { hook(swing); return null; }, { item: sword(world, { types: ["slashing"] }) });
  assert.equal(swing.updates.length, 1, "the weapon card is stamped though the speaker is the token's actor");
  assert.ok(`flags.acks-extras.${seam.ATTACK_APPLY_FLAG}` in swing.updates[0]);
  const cast = message();
  await makeAttackThrow.call(world, async () => { hook(cast); return null; }, { item: spellCarrier(world, SCORCH, { spell, castId: "c9", rowKey: "scorch" }) });
  assert.ok(`flags.acks-extras.${MAGIC_ATTACK_FLAG}` in cast.updates[0], "the cast card carries the carrier mark");
  const elsewhere = { speaker: { actorRef: { uuid: "Scene.s.Token.t.Actor.other", isToken: true, token: { baseActor: { uuid: "Actor.other" } } } }, content: hitCard(), updates: [], updateSource(u) { this.updates.push(u); } };
  await makeAttackThrow.call(world, async () => { hook(elsewhere); return null; }, { item: sword(world) });
  assert.deepEqual(elsewhere.updates, [], "another actor's token is untouched");
});

await ok("a weapon attack's card loses its Apply and gains the stamp in one update, only while that attack is in flight", async () => {
  const hook = hooks.preCreateChatMessage.at(-1);
  const actor = makeActor("Actor.smith");
  const blade = sword(actor, { types: ["slashing"], extraordinary: false, silver: true });
  const message = (content = hitCard()) => ({ speaker: { actorRef: actor }, content, updates: [], updateSource(u) { this.updates.push(u); } });
  const during = message();
  await makeAttackThrow.call(actor, async () => { hook(during); return null; }, { item: blade });
  assert.equal(during.updates.length, 1, "one update: a card is never stripped without its stamp");
  assert.equal(during.updates[0].content, '<section class="acksii chat-card attack-throw-card"><footer>after</footer></section>');
  assert.deepEqual(during.updates[0][`flags.acks-extras.${seam.ATTACK_APPLY_FLAG}`], {
    targetUuid: "Scene.s1.Token.t9", rolled: 11, types: ["slashing"], extraordinary: false, silver: true,
  });
  assert.equal(`flags.acks-extras.${MAGIC_ATTACK_FLAG}` in during.updates[0], false, "it is no cast's card");
  const after = message();
  hook(after);
  assert.deepEqual(after.updates, [], "once the attack has resolved nothing is marked");
  const unreadable = message(hitCard({ damage: "x" }));
  await makeAttackThrow.call(actor, async () => { hook(unreadable); return null; }, { item: blade });
  assert.deepEqual(unreadable.updates, [], "a card it cannot read keeps its Apply");
  const bare = message();
  await makeAttackThrow.call(actor, async () => { hook(bare); return null; }, {});
  assert.deepEqual(bare.updates[0][`flags.acks-extras.${seam.ATTACK_APPLY_FLAG}`].types, [], "an attack with no weapon is stamped with no type");
  const carrier = spellCarrier(actor, SCORCH, { spell, castId: "c5", rowKey: "scorch" });
  const cast = message();
  await makeAttackThrow.call(actor, async () => { hook(cast); return null; }, { item: carrier });
  assert.equal(`flags.acks-extras.${seam.ATTACK_APPLY_FLAG}` in cast.updates[0], false, "a carrier's card is marked as a cast's, not stamped");
  assert.ok(`flags.acks-extras.${MAGIC_ATTACK_FLAG}` in cast.updates[0]);
});

await ok("a nested attack of one actor restores the outer one's damage, and a thrown attack leaves none behind", async () => {
  const hook = hooks.preCreateChatMessage.at(-1);
  const actor = makeActor("Actor.nest");
  const outer = sword(actor, { types: ["cold"] });
  const inner = sword(actor, { types: ["fire"] });
  const stamped = async () => {
    const m = { speaker: { actorRef: actor }, content: hitCard(), updates: [], updateSource(u) { this.updates.push(u); } };
    hook(m);
    return m.updates[0]?.[`flags.acks-extras.${seam.ATTACK_APPLY_FLAG}`]?.types ?? null;
  };
  await makeAttackThrow.call(actor, async () => {
    await makeAttackThrow.call(actor, async () => null, { item: inner });
    assert.deepEqual(await stamped(), ["cold"], "the outer attack's damage is back");
    return null;
  }, { item: outer });
  assert.equal(await stamped(), null, "nothing is left in flight");
  await assert.rejects(makeAttackThrow.call(actor, async () => { throw new Error("dialog failed"); }, { item: outer }), /dialog failed/);
  assert.equal(await stamped(), null, "a throw releases it");
});

await ok("core gets a label for the magic kind at its own key, unless it already has one", () => {
  assert.equal(globalThis.game.i18n.translations.ACKS.throw.attackType.magic, "Magic");
  const had = { has: () => true, localize: () => "Mine", translations: { ACKS: { throw: { attackType: { magic: "Theirs" } } } } };
  globalThis.game.i18n = had;
  installAttackThrowPatch();
  assert.equal(had.translations.ACKS.throw.attackType.magic, "Theirs", "the system's own label stays");
  const blocked = { has: () => false, localize: () => "Mine", translations: { ACKS: "a string, not a branch" } };
  globalThis.game.i18n = blocked;
  installAttackThrowPatch();
  assert.equal(blocked.translations.ACKS, "a string, not a branch", "a path that is not a branch is left alone");
  globalThis.game.i18n = { format: (k) => k };
  assert.doesNotThrow(() => installAttackThrowPatch(), "no translations, nothing to write");
});

console.log(`\n${passed} passed`);
