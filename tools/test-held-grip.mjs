/**
 * The grip a weapon is held in, and the die it deals there (`heldGrip`): the
 * one answer the Rolls row's shown die, the damage mode `rollById` sends, the
 * first mode `damageModesFor` offers and the Follower Card's option all read.
 *
 * Every figure is INVENTED (`tools/weapon-fixture.mjs`) and read from no book;
 * a check pins the fixture's dice and never a printed one.
 */
import assert from "node:assert";

globalThis.acksExtras ??= {};
const SETTINGS_STATE = { overlayShieldVariants: false, overlayManeuvers: true };
globalThis.game = {
  settings: { get: (_m, k) => (k === "defaultHandBudget" ? 2 : k === "enforceMode" ? "resolve" : SETTINGS_STATE[k]) },
  i18n: { has: () => false, localize: (x) => x, format: (k) => k },
  modules: { get: () => ({ active: false }) },
  users: { activeGM: null },
};
class StubApplicationV2 {
  constructor(options = {}) { this.options = options; }
  render() { return this; }
  close() { return this; }
  _onRender() {}
  _onFirstRender() {}
  _onClose() {}
}
globalThis.foundry = {
  utils: {
    deepClone: (x) => JSON.parse(JSON.stringify(x)),
    randomID: () => "rand0000",
    hasProperty: (o, p) => p.split(".").reduce((a, k) => (a == null ? a : a[k]), o) !== undefined,
    getProperty: (o, p) => p.split(".").reduce((a, k) => (a == null ? a : a[k]), o),
    mergeObject: (a, b) => ({ ...a, ...b }),
  },
  data: { operators: { ForcedDeletion: class ForcedDeletion {} } },
  applications: {
    api: { ApplicationV2: StubApplicationV2, HandlebarsApplicationMixin: (Base) => class extends Base {}, DialogV2: class { static async prompt() { return null; } } },
    handlebars: { loadTemplates: () => {} },
    instances: new Map(),
  },
};
globalThis.CONST = { ACTIVE_EFFECT_CHANGE_TYPES: { custom: 0, multiply: 10, add: 20, subtract: 20, downgrade: 30, upgrade: 40, override: 50 } };

const S = new URL("../scripts/equipment/", import.meta.url);
const { heldGrip, damageModesFor, DAMAGE_MODE } = await import(new URL("attack-mods.mjs", S));
const { rollGroups, rollById } = await import(new URL("item-sheet/rolls.mjs", S));
const { heldDieTip } = await import(new URL("weapon-figures.mjs", S));
const { attackOptionsFor } = await import(new URL("../lib/damage-type.mjs", S));
const { useWeaponFixture, FIXTURE_ROWS } = await import(new URL("../../tools/weapon-fixture.mjs", S));
useWeaponFixture();

let pass = 0;
const check = (label, cond) => {
  assert.ok(cond, label);
  pass++;
};
const eq = (label, got, want) => {
  assert.deepStrictEqual(got, want, label);
  pass++;
};

const ROW = FIXTURE_ROWS.sword;
const OWN_ALTERNATE = "1d12";

const weapon = (name, over = {}) => ({
  id: over.id ?? name.replace(/\W/g, ""),
  name,
  type: "weapon",
  system: {
    equipped: over.equipped ?? true,
    cost: 0,
    weight6: 0,
    damage: { base: { formula: over.damage ?? ROW.damage }, alternate: { formula: over.alternate ?? "" } },
    bonus: { attack: 0, damage: 0 },
    melee: over.melee ?? true,
    missile: over.missile,
    customTags: [],
    special: {},
  },
  getFlag: (_m, k) => (over.flags ?? {})[k],
  effects: [],
});
const shield = () => ({
  id: "shield",
  name: "Shield",
  type: "armor",
  system: { equipped: true, type: "shield", ac: { value: 0 }, cost: 0, weight6: 0 },
  getFlag: () => undefined,
  effects: [],
});
const actorOf = (items, over = {}) => {
  const a = {
    id: "a1",
    type: over.type ?? "character",
    items,
    system: { scores: { str: { mod: 0 }, dex: { mod: 0 } }, attack: { throw: 10 } },
    effects: [],
    appliedEffects: [],
    isOwner: true,
    getFlag: (_m, k) => (over.flags ?? {})[k],
    attackCalls: [],
    async makeAttackThrow(args) {
      this.attackCalls.push(args);
    },
  };
  a.items = Object.assign(items.slice(), {
    filter: (f) => items.filter(f),
    find: (f) => items.find(f),
    get: (id) => items.find((i) => i.id === id),
    size: items.length,
  });
  for (const i of items) i.parent = a;
  return a;
};
// A trained two-handed style makes the auto grip take the second hand.
const TRAINED = { flags: { styles: "twoHanded" } };
const rowOf = (item, actor) => rollGroups(item, actor).find((g) => g.key === "attackModes").rows.find((r) => r.id === "atk:melee");
const sent = async (item, actor) => {
  actor.attackCalls.length = 0;
  await rollById(item, "atk:melee");
  return actor.attackCalls[0].acksLib.damageMode;
};
const MODES = [DAMAGE_MODE.base, DAMAGE_MODE.alternate];

/** The four readers of one grip: the answer, the shown die, the mode sent, the mode offered first. */
async function readers(item, actor) {
  const held = heldGrip(actor, item);
  return { held, shown: rowOf(item, actor).v, sent: await sent(item, actor), first: damageModesFor(actor, item, "melee", MODES)[0] };
}

// A versatile sword held in both hands: the row shows the larger die, and the roll is sent in the mode that deals it.
{
  const sw = weapon("Sword");
  const a = actorOf([sw], TRAINED);
  const r = await readers(sw, a);
  eq("held in both hands, the alternate mode answers", [r.held.mode, r.held.twoHanded, r.held.versatile], [DAMAGE_MODE.alternate, true, true]);
  eq("the die dealt is the row's larger die, not stated by the item", [r.held.formula, r.held.declared], [ROW.damage2h, false]);
  eq("the row shows the die the roll deals, and sends its mode", [r.shown, r.sent, r.first], [ROW.damage2h, DAMAGE_MODE.alternate, DAMAGE_MODE.alternate]);
  const row = rowOf(sw, a);
  check("the row names the two-handed grip and carries the shield note", row.twoHanded === true && row.m === "2H" && row.label.endsWith("row.twoHanded") && row.mods.some((m) => m.endsWith("mod.noShield")));
  check("a single melee row is listed", rollGroups(sw, a).find((g) => g.key === "attackModes").rows.filter((x) => x.id.startsWith("atk:melee")).length === 1);
}

// The grip the player chose governs: one hand shows and sends the base die.
{
  const sw = weapon("Sword", { flags: { grip: "1h" } });
  const a = actorOf([sw], TRAINED);
  const r = await readers(sw, a);
  eq("a one-handed grip answers the base die", [r.held.mode, r.held.twoHanded, r.held.formula], [DAMAGE_MODE.base, false, ROW.damage]);
  eq("shown, sent and first agree on base", [r.shown, r.sent, r.first], [ROW.damage, DAMAGE_MODE.base, DAMAGE_MODE.base]);
  check("the row is the one-handed row", rowOf(sw, a).twoHanded === false && rowOf(sw, a).m === "1H");
}

// The auto grip stays one-handed while the style is untrained.
{
  const sw = weapon("Sword");
  const r = await readers(sw, actorOf([sw]));
  eq("untrained, the auto grip is one-handed everywhere", [r.held.mode, r.shown, r.sent, r.first], [DAMAGE_MODE.base, ROW.damage, DAMAGE_MODE.base, DAMAGE_MODE.base]);
}

// A grip that cannot be had (a shield holds the off hand) answers the base die.
{
  const sw = weapon("Sword", { flags: { grip: "2h" } });
  const a = actorOf([sw, shield()], TRAINED);
  const r = await readers(sw, a);
  eq("a blocked two-handed grip deals the base die, and every reader agrees", [r.held.mode, r.shown, r.sent, r.first], [DAMAGE_MODE.base, ROW.damage, DAMAGE_MODE.base, DAMAGE_MODE.base]);
}

// The auto grip yields to a second weapon in hand.
{
  const sw = weapon("Sword");
  const dg = weapon("Dagger", { damage: FIXTURE_ROWS.dagger.damage });
  const a = actorOf([sw, dg], TRAINED);
  const r = await readers(sw, a);
  eq("beside another weapon the auto grip yields to one hand", [r.held.twoHanded, r.held.mode, r.shown, r.sent, r.first], [false, DAMAGE_MODE.base, ROW.damage, DAMAGE_MODE.base, DAMAGE_MODE.base]);
}

// An alternate die the item states is the die dealt, and it is the item's own.
{
  const sw = weapon("Sword", { alternate: OWN_ALTERNATE });
  const a = actorOf([sw], TRAINED);
  const r = await readers(sw, a);
  eq("an item's own alternate die is dealt in the alternate mode", [r.held.formula, r.held.declared, r.shown, r.sent], [OWN_ALTERNATE, true, OWN_ALTERNATE, DAMAGE_MODE.alternate]);
  check("its tooltip says the item set it", heldDieTip(r.held).endsWith("figureDeclared"));
  check("a row's die is told from the item's", heldDieTip(heldGrip(actorOf([weapon("Sword")], TRAINED), weapon("Sword"))).length > 0);
}

// Where the item's die is not the row's, a two-handed hold has no larger die: the weapon deals its own.
{
  const sw = weapon("Sword", { damage: "1d20" });
  const a = actorOf([sw], TRAINED);
  const r = await readers(sw, a);
  eq("a two-handed hold with no larger die deals the base die", [r.held.twoHanded, r.held.mode, r.held.formula, r.shown, r.sent], [true, DAMAGE_MODE.base, "1d20", "1d20", DAMAGE_MODE.base]);
  check("the row is not the two-handed row", rowOf(sw, a).twoHanded === false);
}

// A weapon that needs both hands has no choice of grip and no larger die.
{
  const gs = weapon("Two-Handed Sword", { damage: FIXTURE_ROWS.twohandedsword.damage });
  const a = actorOf([gs]);
  const held = heldGrip(a, gs);
  eq("a forced two-handed weapon is held in both hands and deals its own die", [held.twoHanded, held.versatile, held.mode, held.formula], [true, false, DAMAGE_MODE.base, FIXTURE_ROWS.twohandedsword.damage]);
  check("its tooltip names no grip", !heldDieTip(held).includes("dieTwoHanded"));
}

// The answer is the base die for a weapon not drawn, for any attack but a melee swing, and for a non-character.
{
  const sw = weapon("Sword", { equipped: false });
  eq("an undrawn weapon answers the base die", heldGrip(actorOf([sw], TRAINED), sw).mode, DAMAGE_MODE.base);
  const drawn = weapon("Sword");
  const a = actorOf([drawn], TRAINED);
  eq("a thrown or shot attack answers the base die", [heldGrip(a, drawn, "thrown").mode, heldGrip(a, drawn, "missile").mode], [DAMAGE_MODE.base, DAMAGE_MODE.base]);
  const monster = actorOf([drawn], { ...TRAINED, type: "monster" });
  eq("a monster is not asked", heldGrip(monster, drawn).mode, DAMAGE_MODE.base);
  eq("no actor, no hold", heldGrip(null, drawn).twoHanded, false);
}

// A caller that names a mode is obeyed; one that names none gets the held grip.
{
  const sw = weapon("Sword");
  const a = actorOf([sw], TRAINED);
  eq("an asked-for mode opens first", damageModesFor(a, sw, "melee", MODES, DAMAGE_MODE.base)[0], DAMAGE_MODE.base);
  eq("no mode asked: the held grip opens first, the other follows", damageModesFor(a, sw, "melee", MODES), [DAMAGE_MODE.alternate, DAMAGE_MODE.base]);
}

// The Follower Card's melee option reads the same answer through the equipment API.
{
  const sw = weapon("Sword");
  const a = actorOf([sw], TRAINED);
  a.items.contents = a.items.slice();
  globalThis.acksExtras.equipment = { heldGrip, heldDieTip };
  const [opt] = attackOptionsFor(a);
  eq("the card's option carries the held die and mode, and keeps the base die for editing", [opt.heldDamage, opt.damageMode, opt.damage], [ROW.damage2h, DAMAGE_MODE.alternate, ROW.damage]);
  check("and its tooltip", typeof opt.dmgTip === "string" && opt.dmgTip.length > 0);
  delete globalThis.acksExtras.equipment;
  const [bare] = attackOptionsFor(a);
  check("without the equipment feature the option is the item's base die alone", bare.heldDamage === undefined && bare.damage === ROW.damage);
}

console.log(`test-held-grip: ${pass} checks passed`);
