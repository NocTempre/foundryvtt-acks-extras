/**
 * Pure-logic regression tests for the loadout model and effect builder.
 * Mocks the minimal Foundry globals and imports the real scripts, so bugs that
 * a running Foundry would surface (deprecated globals, case mismatches, wrong
 * hand costs, mis-detected violations) fail the release instead.
 *
 * Run: npm test
 */
import assert from "node:assert";

// One namespace now, not eight globals; stubs below hang off it.
globalThis.acksExtras ??= {};

// Overlay toggles are read through game.settings; tests flip this to prove the
// overlay is inert when disabled and correct when enabled.
const SETTINGS_STATE = { overlayShieldVariants: false, overlayManeuvers: true };
globalThis.game = {
  settings: {
    get: (_m, k) => (k === "defaultHandBudget" ? 2 : k === "enforceMode" ? "resolve" : SETTINGS_STATE[k]),
  },
  i18n: { has: () => false, localize: (x) => x, format: (k) => k },
  modules: { get: () => ({ active: false }) },
  users: { activeGM: null },
};
// ApplicationV2 stubs. Modules that destructure `foundry.applications.api` at
// module scope die at IMPORT time if these are missing — the same class of
// failure as the v0.12.1 "module dead at init" bug — so the harness provides
// just enough shape for the files to load and be constructed.
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
    api: {
      ApplicationV2: StubApplicationV2,
      HandlebarsApplicationMixin: (Base) => class extends Base {},
      DialogV2: class { static async prompt() { return null; } },
    },
    handlebars: { loadTemplates: () => {} },
    instances: new Map(),
  },
};
// v14: an AE change carries a string `type` (a key of ACTIVE_EFFECT_CHANGE_TYPES;
// the enum numbers are default priorities). Numeric `mode` is a deprecated shim —
// make the getter THROW so any access fails the test.
globalThis.CONST = {
  ACTIVE_EFFECT_CHANGE_TYPES: { custom: 0, multiply: 10, add: 20, subtract: 20, downgrade: 30, upgrade: 40, override: 50 },
};
Object.defineProperty(globalThis.CONST, "ACTIVE_EFFECT_MODES", {
  get() { throw new Error("accessed deprecated CONST.ACTIVE_EFFECT_MODES"); },
});

const S = new URL("../scripts/equipment/", import.meta.url);
const { classifyWeapon, handCost, equipmentClass } = await import(new URL("profiles.mjs", S));
const { getLoadout, VIOLATION } = await import(new URL("loadout.mjs", S));
const { buildLoadoutChanges, dualStyleFigure } = await import(new URL("effects.mjs", S));
const { weaponProficiency, isWeaponProficient, armorMax, isArmorProficient, armourCeiling, lightlyEquipped, classifyGrantToken } = await import(new URL("proficiency.mjs", S));
const { buildMacros } = await import(new URL("../tools/pack-data/equipment.mjs", import.meta.url));
const { MASTERWORK, SILVER } = await import(new URL("config.mjs", S));
const { readiedWeaponData, prepareTorch, unarmedStrikeData, masterworkTiersFor, addToDamage, setMasterwork, scavengeItem, clearScavenged, rollScavengedD20s, setShieldVariant } = await import(new URL("actions.mjs", S));
const { cycleStrap, strapOf } = await import(new URL("overlays/shield-variants.mjs", S));
const { disguiseItem, revealItem, isDisguised } = await import(new URL("actions.mjs", S));
const { helmetType, isEnclosingHelm, helmFigures } = await import(new URL("overlays/enclosing-helm.mjs", S));
const { isSpellbook, pagesUsed, spellbookValue, parseSpellList, setSpellbookSpells, overCapacity: bookOver } = await import(new URL("spellbook.mjs", S));
const { setMaterial, materialVocabulary } = await import(new URL("overlays/item-loss.mjs", S));
// The weapon rows are invented (tools/weapon-fixture.mjs); the module ships none.
const { useWeaponFixture, FIXTURE_ROWS } = await import(new URL("weapon-fixture.mjs", import.meta.url));
useWeaponFixture();

const weapon = (name, over = {}) => ({
  id: over.id ?? name.replace(/\W/g, ""),
  name,
  type: "weapon",
  // cost + weight6 mirror the system's ItemPhysicalTemplate — every real
  // weapon/armor/item carries them, which is what itemModel.isPhysical tests.
  system: {
    equipped: over.equipped ?? true, cost: over.cost ?? 0, weight6: over.w6 ?? 0,
    damage: { base: { formula: over.damage ?? FIXTURE_ROWS.sword.damage }, alternate: { formula: over.alternate ?? "" } },
    bonus: { attack: 0, damage: 0 }, melee: over.melee, missile: over.missile,
    customTags: over.tags ?? [], special: over.special ?? {},
  },
  getFlag: (_m, k) => (over.flags ?? {})[k],
  effects: [],
});
const armor = (name, type, over = {}) => ({
  id: over.id ?? name.replace(/\W/g, ""),
  name,
  type: "armor",
  system: { equipped: over.equipped ?? true, type, ac: { value: over.ac ?? 0 }, cost: over.cost ?? 0, weight6: over.w6 ?? 0 },
  getFlag: (_m, k) => (over.flags ?? {})[k],
  effects: [],
});
const actor = (items, over = {}) => ({
  id: "a1",
  type: "character",
  items,
  system: over.system ?? {},
  effects: over.effects ?? [],
  appliedEffects: over.effects ?? [],
  isOwner: true,
  getFlag: (_m, k) => (over.flags ?? {})[k],
});
const marker = (domain, value) => ({ id: "fx" + domain, name: domain, disabled: false, changes: [{ key: `flags.acks-extras.${domain}`, value: String(value) }], flags: { "acks-extras": {} } });

let pass = 0;
const check = (label, cond) => { assert.ok(cond, label); pass++; };

// classify + hand cost
const sword = classifyWeapon(weapon("Sword", { melee: true }));
check("sword medium melee", sword.size === "medium" && sword.melee);
check("sword 1H=1 / 2H=2", handCost(sword, { twoHanded: false }) === 1 && handCost(sword, { twoHanded: true }) === 2);
check("the sword's two-handed die is the row's", sword.damage2h === FIXTURE_ROWS.sword.damage2h);
check("a flat modifier on the row's die carries onto the two-handed die", classifyWeapon(weapon("Sword", { melee: true, damage: `${FIXTURE_ROWS.sword.damage} + 1` })).damage2h === `${FIXTURE_ROWS.sword.damage2h} + 1`);
check("a penalty carries too, and the die is read without case or spaces", classifyWeapon(weapon("Sword", { melee: true, damage: `${FIXTURE_ROWS.sword.damage.toUpperCase()}-1` })).damage2h === `${FIXTURE_ROWS.sword.damage2h} - 1`);
check("a die the row does not print has no two-handed figure", classifyWeapon(weapon("Sword", { melee: true, damage: "1d10" })).damage2h === null);
// A medium melee weapon the system tags two-handed needs both hands whatever its size says.
const tagged2h = classifyWeapon(weapon("Sword", { melee: true, tags: ["Two-handed"] }));
check("the core two-handed tag forces both hands on a medium melee row", tagged2h.twoHandedForced === true && handCost(tagged2h, { twoHanded: false }) === 2);
check("a row that states two hands forces them without the tag", classifyWeapon(weapon("Net", { melee: true })).twoHandedForced === true && sword.twoHandedForced === false);
check("longbow 2 hands", handCost(classifyWeapon(weapon("Long Bow", { missile: true, melee: false }))) === 2);
check("sling handy 1 hand", handCost(classifyWeapon(weapon("Sling", { missile: true, melee: false }))) === 1);
check("dagger tiny thrown", (() => { const d = classifyWeapon(weapon("Dagger", { melee: true })); return d.size === "tiny" && d.thrown; })());
check("two-handed sword large 2 hands", handCost(classifyWeapon(weapon("Two-Handed Sword", { melee: true }))) === 2);
check("override size/hands flag wins", handCost(classifyWeapon(weapon("Stick", { flags: { size: "large", hands: 2 } }))) === 2);

// equipmentClass: the family's equipment "root" (name → core type + stats).
const torchClass = equipmentClass("Torch");
check("equipmentClass: torch is a carried light STACK (item, prepareAs weapon)", torchClass?.type === "item" && torchClass.prepareAs === "weapon" && torchClass.damage === FIXTURE_ROWS.torch.damage && torchClass.light && torchClass.melee && torchClass.thrown);
check("equipmentClass: a thrown melee weapon is missile-capable (enables the range selector)", torchClass.missile === true && equipmentClass("Hand Axe")?.missile === true && equipmentClass("Hand Axe").melee === true);
const oilClass = equipmentClass("Military Oil");
check("equipmentClass: military oil is a thrown splash weapon", oilClass?.type === "weapon" && oilClass.splash && oilClass.missile && oilClass.thrown);
const hwClass = equipmentClass("Holy Water");
check("equipmentClass: holy water is a thrown splash consumable", hwClass?.type === "weapon" && hwClass.damage === FIXTURE_ROWS.holywater.damage && hwClass.splash && hwClass.consumable);
check("equipmentClass: a lantern stays a light-bearing item", equipmentClass("Lantern")?.type === "item" && equipmentClass("Lantern").light === true);
check("equipmentClass: a candle stays a light-bearing item", equipmentClass("Candle")?.type === "item" && equipmentClass("Candle").light === true);
check("equipmentClass: plain oil (lantern fuel) is NOT a weapon", equipmentClass("Oil") === null);
check("equipmentClass: ordinary gear is unrecognised (no fuzzy hit)", equipmentClass("Grappling Hook") === null && equipmentClass("Waterskin") === null);

// loadout scenarios
let lo = getLoadout(actor([weapon("Sword", { melee: true, id: "sw" }), armor("Shield", "shield", { ac: 1, id: "sh" })]));
check("sword+shield 2 hands, weaponShield, legal", lo.handsUsed === 2 && lo.activeStyle === "weaponShield" && lo.legal);
lo = getLoadout(actor([weapon("Sword", { melee: true, id: "a" }), weapon("Short Sword", { melee: true, id: "b" }), armor("Shield", "shield", { id: "s" })]));
check("3 one-handers → hand overflow, illegal", lo.violations.some((v) => v.type === VIOLATION.HAND_OVERFLOW) && !lo.legal);
lo = getLoadout(actor([weapon("Sword", { melee: true, id: "a" }), weapon("Dagger", { melee: true, id: "b" })]));
check("two weapons → dual", lo.activeStyle === "dual" && lo.handsUsed === 2 && lo.legal);
lo = getLoadout(actor([weapon("Two-Handed Sword", { melee: true, id: "t" })]));
check("great sword → twoHanded, 2 hands", lo.activeStyle === "twoHanded" && lo.handsUsed === 2);
// A weapon whose minimum is both hands is HELD in both, whatever else is
// carried — a drawn bow is not a one-handed weapon with an empty off hand, and
// it offers no grip choice.
lo = getLoadout(actor([weapon("Long Bow", { missile: true, melee: false, id: "lb" })]));
check("a lone bow is held in both hands, with no grip choice", lo.weapons[0].wieldTwoHanded === true && lo.weapons[0].canTwoHand === false && lo.handsUsed === 2 && lo.legal);
lo = getLoadout(actor([weapon("Long Bow", { missile: true, melee: false, id: "lb2" }), weapon("Dagger", { melee: true, id: "dg" })]));
check("a bow beside a dagger is still in both hands, and the hands overflow", lo.weapons[0].wieldTwoHanded === true && lo.violations.some((v) => v.type === VIOLATION.HAND_OVERFLOW));
lo = getLoadout(actor([weapon("Two-Handed Sword", { melee: true, id: "t2" }), armor("Shield", "shield", { id: "s2" })]));
check("a great sword beside a shield in hand is still in both hands", lo.weapons[0].wieldTwoHanded === true && lo.handsUsed === 3 && !lo.legal);
lo = getLoadout(actor([weapon("Sword", { melee: true, id: "s" })], { flags: { styles: "twoHanded" } }));
check("lone medium sword wielded 2H when the style is trained", lo.weapons[0].wieldTwoHanded && lo.handsUsed === 2);
// The auto grip never volunteers a character for a style they lack: the
// default would carry the whole non-proficient package for holding one sword.
lo = getLoadout(actor([weapon("Sword", { melee: true, id: "s" })], { flags: { styles: "single" } }));
check("untrained in the two-handed style, the auto grip stays one-handed", lo.weapons[0].wieldTwoHanded === false && lo.handsUsed === 1 && lo.activeStyle === "single" && lo.styleProficient);
lo = getLoadout(actor([armor("Plate", "heavy", { id: "p" }), armor("Chain", "medium", { id: "c" })]));
check("two suits → multipleArmor, keeps last", lo.violations.some((v) => v.type === VIOLATION.MULTIPLE_ARMOR) && lo.armor?.id === "c");
lo = getLoadout(actor([armor("Plate", "heavy", { id: "p" }), armor("Heavy Helmet", "medium", { id: "h" })]));
check("helmet excluded from suit count", !lo.violations.some((v) => v.type === VIOLATION.MULTIPLE_ARMOR) && lo.hasHelmet);

// loadout Active Effect (v14 string mode; no deprecated CONST; case-insensitive spec)
// Fighting Style Specialization's bonuses are the proficiency's own typed
// modifiers, one per style, gated `specializedStyle`; the figures here are
// invented, as an import would have read them off the page.
const styleSpecs = () => [
  { type: "modifier", target: "attackThrow", forWhat: "missile", mode: "add", gate: { kind: "specializedStyle", style: "missile" }, value: { kind: "flat", flat: 4 } },
  { type: "modifier", target: "initiative", mode: "add", gate: { kind: "specializedStyle", style: "single" }, value: { kind: "flat", flat: 5 } },
  { type: "modifier", target: "attackThrow", forWhat: "melee", mode: "add", gate: { kind: "specializedStyle", style: "dual" }, value: { kind: "flat", flat: 6 } },
  { type: "modifier", target: "damage", forWhat: "melee", mode: "add", gate: { kind: "specializedStyle", style: "twoHanded" }, value: { kind: "flat", flat: 7 } },
  { type: "modifier", target: "ac", mode: "add", gate: { kind: "specializedStyle", style: "weaponShield" }, value: { kind: "flat", flat: 3 } },
];
const styleTraining = (id = "fss") => {
  const flags = { "acks-extras": { extras: { effects: styleSpecs() } } };
  return { id, name: "Style Training", type: "ability", system: {}, flags, getFlag: (m, k) => flags[m]?.[k], effects: [] };
};
const specEffect = { id: "fx1", name: "FSS (W&S)", disabled: false, changes: [{ key: "flags.acks-extras.styleProficient", value: "weaponShield:spec" }], flags: { "acks-extras": {} } };
const specActor = actor([weapon("Sword", { melee: true, id: "sw" }), armor("Shield", "shield", { ac: 1, id: "sh" }), styleTraining()], { effects: [specEffect], flags: { styles: "weaponShield" } });
const specLo = getLoadout(specActor);
check("spec actor → weaponShield active", specLo.activeStyle === "weaponShield" && specLo.styleProficient);
const changes = buildLoadoutChanges(specActor, specLo);
const ac = changes.find((c) => c.key === "system.ac.mod");
check("W&S spec → the recipe's figure on ac.mod with string type 'add'", ac && Number(ac.value) === 3 && ac.type === "add");
check("W&S spec → only the active style's bonus applies", changes.every((c) => c.key === "system.ac.mod" || ![4, 5, 6, 7].includes(Number(c.value))));
{
  // The style's bonus stands only while that style is the active one, and only
  // for a character specialized in it.
  const missileSpec = { ...specEffect, changes: [{ key: "flags.acks-extras.styleProficient", value: "missile:spec" }] };
  const notInStyle = actor([weapon("Sword", { melee: true, id: "sw" }), armor("Shield", "shield", { ac: 1, id: "sh" }), styleTraining()], { effects: [missileSpec], flags: { styles: "weaponShield" } });
  const off = buildLoadoutChanges(notInStyle, getLoadout(notInStyle));
  check("specialized in another style → no bonus in this one", !off.some((c) => [3, 4, 5, 6, 7].includes(Number(c.value))));
  const bow = actor([weapon("Short Bow", { missile: true, melee: false, id: "bw" }), styleTraining()], { effects: [missileSpec] });
  const bowLo = getLoadout(bow);
  const on = buildLoadoutChanges(bow, bowLo);
  check("specialized in the active missile style → its bonus on missile attack", bowLo.activeStyle === "missile" && on.some((c) => c.key === "system.attack.mod.missile" && Number(c.value) === 4));
  const untrained = actor([weapon("Short Bow", { missile: true, melee: false, id: "bw" })], { effects: [missileSpec] });
  check("a spec token with no proficiency carrying the bonus → nothing", !buildLoadoutChanges(untrained, getLoadout(untrained)).some((c) => c.key === "system.attack.mod.missile"));
}

// --- Phase 2: proficiency resolution -----------------------------------------
const swordP = classifyWeapon(weapon("Sword", { melee: true }));
const axeP = classifyWeapon(weapon("Battle Axe", { melee: true }));
check("default weapon proficiency = all", isWeaponProficient(actor([]), swordP));
const restricted = actor([], { flags: { weaponProficiency: "swordDagger" } });
check("restricted: sword proficient, axe not", isWeaponProficient(restricted, swordP) && !isWeaponProficient(restricted, axeP));
const martial = actor([], { flags: { weaponProficiency: "swordDagger" }, effects: [marker("martialWeapons", "axe")] });
check("Martial Training adds axe category", isWeaponProficient(martial, axeP));

check("default armorMax = heavy", armorMax(actor([])) === "heavy");
const lightOnly = actor([], { flags: { armorMax: "light" } });
check("armorMax light: leather ok, plate not", isArmorProficient(lightOnly, armor("Leather", "light")) && !isArmorProficient(lightOnly, armor("Plate", "heavy")));
const trained = actor([], { flags: { armorMax: "light" }, effects: [marker("armorTraining", "1")] });
check("Armour Training light→medium", armorMax(trained) === "medium" && isArmorProficient(trained, armor("Chain", "medium")));

// The armour ceiling decides by the rung and shield rule it is handed; an
// ability's own page supplies them at import. Figures are invented.
const ceiling = { armourMax: "light", noShield: true };
check("armour ceiling: armour over the rung breaks it", armourCeiling({ armor: armor("Plate", "heavy") }, ceiling) === true);
check("armour ceiling: armour at the rung, no shield, holds", armourCeiling({ armor: armor("Leather", "light"), shield: null }, ceiling) === false);
check("armour ceiling: a shield a limit refuses breaks it", armourCeiling({ armor: armor("Leather", "light"), shield: armor("Shield", "shield") }, ceiling) === true);
check("armour ceiling: no rung read leaves it undecided", armourCeiling({ armor: armor("Plate", "heavy") }, {}) === null);

// The lightly-equipped gate decides by the arguments its import read, and an
// argument it did not read leaves it undecided. Figures are invented.
const carrying = (stone) => actor([], { system: { details: { level: 1 }, encumbrance: { value: stone } } });
const lightGate = { armourMax: "light", loadMax: 4 };
check("lightly equipped: unarmoured under the load cap", lightlyEquipped(carrying(3), { armor: null }, lightGate) === true);
check("lightly equipped: at the load cap still counts", lightlyEquipped(carrying(4), { armor: null }, lightGate) === true);
check("lightly equipped: over the load cap does not", lightlyEquipped(carrying(5), { armor: null }, lightGate) === false);
check("lightly equipped: heavier armour than the gate does not", lightlyEquipped(carrying(1), { armor: armor("Plate", "heavy") }, lightGate) === false);
check("lightly equipped: the gate's own armour rung counts", lightlyEquipped(carrying(1), { armor: armor("Leather", "light") }, lightGate) === true);
check("lightly equipped: no load figure imported → undecided", lightlyEquipped(carrying(1), { armor: null }, { armourMax: "light", loadMax: null }) === null);
check("lightly equipped: no armour rung → undecided", lightlyEquipped(carrying(1), { armor: null }, { loadMax: 4 }) === null);

// non-proficient weapon surfaces an advisory (never blocks)
const npLoadout = getLoadout(actor([weapon("Battle Axe", { melee: true, id: "ax" })], { flags: { weaponProficiency: "swordDagger" } }));
check("non-proficient weapon → advisory, still legal", npLoadout.violations.some((v) => v.type === VIOLATION.WEAPON_NOT_PROFICIENT && v.advisory) && npLoadout.legal);

// --- grant-token grammar (JJ p. 290) -----------------------------------------
const daggerP = classifyWeapon(weapon("Dagger", { melee: true }));
const greatP = classifyWeapon(weapon("Two-Handed Sword", { melee: true }));
const sbowP = classifyWeapon(weapon("Short Bow", { missile: true, melee: false }));
// The book writes broad choices i-ii as sizes ("any tiny, small, or medium melee
// weapons"), so a bare size is what a Judge types. It means melee:<size>.
const bySize = actor([], { flags: { weaponProficiency: "tiny,small,medium" } });
check("bare sizes grant melee weapons of that size", isWeaponProficient(bySize, daggerP) && isWeaponProficient(bySize, swordP));
check("bare sizes stop at the sizes listed", !isWeaponProficient(bySize, greatP));
check("a melee size grant never covers a missile weapon", !isWeaponProficient(bySize, sbowP));
check("melee:<size> long form still matches", isWeaponProficient(actor([], { flags: { weaponProficiency: "melee:tiny" } }), daggerP));
const missileOnly = actor([], { flags: { weaponProficiency: "missile:all" } });
check("missile:all covers a bow, not a sword", isWeaponProficient(missileOnly, sbowP) && !isWeaponProficient(missileOnly, swordP));
check("category token tolerates spacing", isWeaponProficient(actor([], { flags: { weaponProficiency: "sword dagger" } }), swordP));
check("named weapon resolves through an alias", isWeaponProficient(actor([], { flags: { weaponProficiency: "great sword" } }), greatP));
check("token kinds are reported", classifyGrantToken("tiny") === "meleeSize" && classifyGrantToken("swordDagger") === "category"
  && classifyGrantToken("missile:all") === "missile" && classifyGrantToken("all") === "all"
  && classifyGrantToken("Great Sword") === "weapon" && classifyGrantToken("pointy stick") === "unknown");
// A profile that parses to nothing is not a profile granting nothing: reading it
// that way left characters silently non-proficient with every weapon they owned.
check("a profile that parses to no tokens stays permissive", isWeaponProficient(actor([], { flags: { weaponProficiency: " , " } }), swordP));

const ID = /^[A-Za-z0-9]{16}$/;

// --- Phase 3: per-attack roll modifiers --------------------------------------
// The rows this feature adds to the system's attack throw and damage roll
// through the lib's attack seam. Actors here need items.get(id); extend the
// mock minimally.
const { attackThrowRows, damageRows, damageModesFor, damageFormulaFor, attackTypesFor } = await import(new URL("attack-mods.mjs", S));
const rollActor = (items, over = {}) => {
  const a = actor(items, over);
  a.items = Object.assign(items.slice(), { get: (id) => items.find((i) => i.id === id) });
  a.system = over.system ?? { scores: { str: { mod: 1 }, dex: { mod: 3 } } };
  return a;
};
const swordItem = weapon("Sword", { melee: true, id: "sw" });
const sumRows = (rows) => rows.reduce((n, r) => n + Number(r.value), 0);

// Proficient + trained style, one-handed with a shield → no per-attack rows.
let a = rollActor([swordItem, armor("Shield", "shield", { id: "sh" })], { flags: { styles: "weaponShield" }, system: { scores: { str: { mod: 1 }, dex: { mod: 1 } } } });
check("proficient, trained, no finesse → no per-attack rows", attackThrowRows(a, swordItem, "melee").length === 0);

// --- RAW non-proficient use (RR p. 15): the full package ---------------------
// The package's two figures are imported (the equipment document's
// `zeroLevelAttackThrow` and `nonProficientUse` tables); the sizes below are
// INVENTED. Before the import only the structural half applies: the
// attribute bonus is cancelled and the throw is left alone.
const sysL4 = { details: { level: 4 }, attack: { throw: 8 }, scores: { str: { mod: 2 }, dex: { mod: 1 } } };
a = rollActor([swordItem], { flags: { weaponProficiency: "axe", styles: "single,twoHanded" }, system: sysL4 });
let rows = attackThrowRows(a, swordItem, "melee");
check("unimported: the attribute bonus is cancelled and the throw is left alone (−2)", rows.length === 1 && sumRows(rows) === -2);
const { registerTable, unregisterTable, PRIORITY } = await import(new URL("../lib/tables.mjs", S));
const FIGURES = { id: "equipment", tables: { zeroLevelAttackThrow: { attackThrow: 12 }, nonProficientUse: { zeroLevelPenalty: -2 } } };
registerTable(FIGURES, { priority: PRIORITY.WORLD, source: "test" });

// A 4th-level character whose own throw is 8, STR +2, non-proficient weapon:
// attacks with the imported throw (8 → 12 is −4) and no attribute bonus
// (−2) = −6.
rows = attackThrowRows(a, swordItem, "melee");
check("non-prof weapon, L4 throw 8 STR+2 → attacks with the imported throw (−6)", sumRows(rows) === -6);
// The package is its own labelled row, so the roll reads "−6 Non-proficient"
// and never as a penalty the weapon carries.
check("the package is named as one row of its own", rows.length === 1 && rows[0].label === "Non-proficient" && rows[0].value === -6);

// Weapon and style BOTH untrained: one package, never two.
a = rollActor([swordItem], { flags: { weaponProficiency: "axe", styles: "single" }, system: sysL4 });
rows = attackThrowRows(a, swordItem, "melee");
check("weapon+style both untrained → one package, not two", rows.length === 1 && sumRows(rows) === -6);

// Attribute PENALTIES are not bonuses and still apply.
a = rollActor([swordItem], { flags: { weaponProficiency: "axe", styles: "single,twoHanded" }, system: { details: { level: 1 }, attack: { throw: 10 }, scores: { str: { mod: -1 }, dex: { mod: 0 } } } });
check("attribute penalty kept: only the throw is replaced (−2)", sumRows(attackThrowRows(a, swordItem, "melee")) === -2);

// 0th-level characters still fight as 0th level, at the imported further penalty.
a = rollActor([swordItem], { flags: { weaponProficiency: "axe", styles: "single,twoHanded" }, system: { details: { level: 0 }, attack: { throw: 12 }, scores: { str: { mod: 0 }, dex: { mod: 0 } } } });
check("0th-level non-proficient → the further penalty only (−2)", sumRows(attackThrowRows(a, swordItem, "melee")) === -2);

// Missile attacks strip the DEX bonus instead of STR.
const bowItem = weapon("Long Bow", { missile: true, melee: false, id: "lb" });
a = rollActor([bowItem], { flags: { weaponProficiency: "axe", styles: "single,missile" }, system: { details: { level: 1 }, attack: { throw: 10 }, scores: { str: { mod: 3 }, dex: { mod: 2 } } } });
check("missile: DEX bonus stripped (−2 throw, −2 dex = −4)", sumRows(attackThrowRows(a, bowItem, "missile")) === -4);

// Unusable ARMOUR degrades attacks made even with a PROFICIENT weapon —
// the trigger is the equipped state, not the weapon in hand.
const sysL1 = { details: { level: 1 }, attack: { throw: 10 }, scores: { str: { mod: 1 }, dex: { mod: 1 } } };
a = rollActor([swordItem, armor("Plate", "heavy", { id: "pl" })], { flags: { armorMax: "light", styles: "single,twoHanded" }, system: sysL1 });
check("unusable armour degrades proficient-weapon attacks (−3)", sumRows(attackThrowRows(a, swordItem, "melee")) === -3);

// Weapon Finesse is inert while non-proficiently equipped: no attribute
// grants any bonus, so there is nothing to swap in.
a = rollActor([swordItem, armor("Plate", "heavy", { id: "pl" })], { flags: { armorMax: "light", styles: "single,twoHanded" }, effects: [marker("finesse", "1")], system: { details: { level: 1 }, attack: { throw: 10 }, scores: { str: { mod: 1 }, dex: { mod: 3 } } } });
check("Weapon Finesse inert while non-proficiently equipped", sumRows(attackThrowRows(a, swordItem, "melee")) === -3);
unregisterTable(FIGURES.id, { priority: PRIORITY.WORLD });

// Loadout: the state + full-package advisory violation, and the AC half —
// "no bonus on ... armor class from attributes" (bonuses only; penalties stay).
const npUse = actor([weapon("Battle Axe", { melee: true, id: "ax" })], { flags: { weaponProficiency: "swordDagger", styles: "single,twoHanded" }, system: { scores: { dex: { mod: 2 } }, details: { level: 3 } } });
const npUseLo = getLoadout(npUse);
check("nonProficientUse state + advisory violation, still legal", npUseLo.nonProficientUse === true && npUseLo.violations.some((v) => v.type === VIOLATION.NON_PROFICIENT_USE && v.advisory) && npUseLo.legal);
const npAcSum = buildLoadoutChanges(npUse, npUseLo).filter((c) => c.key === "system.ac.mod").reduce((s, c) => s + Number(c.value), 0);
check("no attribute bonus to AC while non-proficient (DEX +2 cancelled)", npAcSum === -2);
const npDexPen = actor([weapon("Battle Axe", { melee: true, id: "ax" })], { flags: { weaponProficiency: "swordDagger", styles: "single,twoHanded" }, system: { scores: { dex: { mod: -2 } }, details: { level: 3 } } });
check("DEX penalty to AC is kept (penalties are not bonuses)", buildLoadoutChanges(npDexPen, getLoadout(npDexPen)).filter((c) => c.key === "system.ac.mod").reduce((s, c) => s + Number(c.value), 0) === 0);
// Core's AC base is the last equipped non-shield armour; a helmet after the suit
// must not stand in for it, and a helmet's own stated AC adds.
const acModOf = (items) => { const a = actor(items, { flags: { armorMax: "heavy" }, system: { scores: { dex: { mod: 0 } }, details: { level: 3 } } }); return buildLoadoutChanges(a, getLoadout(a)).filter((c) => c.key === "system.ac.mod").reduce((s, c) => s + Number(c.value), 0); };
const suitAC = armor("Chain Mail", "medium", { id: "cm", ac: 4 });
check("helmet worn after the suit → the suit's AC is put back over core's helmet base", acModOf([suitAC, armor("Heavy Helmet", "medium", { id: "hh" })]) === 4);
check("helmet worn before the suit → core already reads the suit, nothing written", acModOf([armor("Heavy Helmet", "medium", { id: "hh" }), suitAC]) === 0);
check("a helmet stating AC after the suit → suit plus helmet", acModOf([suitAC, armor("Heavy Helmet", "medium", { id: "hh", ac: 1 })]) === 4);
check("a helmet stating AC before the suit → its AC added to core's suit base", acModOf([armor("Heavy Helmet", "medium", { id: "hh", ac: 1 }), suitAC]) === 1);
check("a helmet alone → core's own base stands", acModOf([armor("Heavy Helmet", "medium", { id: "hh" })]) === 0);
const profLo = getLoadout(actor([weapon("Sword", { melee: true, id: "sw" })], { flags: { styles: "single,twoHanded" }, system: { scores: { dex: { mod: 2 } }, details: { level: 3 } } }));
check("fully proficient loadout → no nonProficientUse state", profLo.nonProficientUse === false && !profLo.violations.some((v) => v.type === VIOLATION.NON_PROFICIENT_USE));

// Every class throws a flask, a bottle, a rock or a torch proficiently (RR ch.
// 1, Weapon Proficiency). A dart is the control: thrown, missile-only,
// category `other` and granted by name to some classes, so a rule keyed on
// "thrown missile" would wrongly light it too.
const swordsOnly = actor([], { flags: { weaponProficiency: "swordDagger" } });
const oilP = classifyWeapon(weapon("Military Oil", { missile: true, melee: false }));
const holyP = classifyWeapon(weapon("Flask of holy water", { missile: true, melee: false }));
const rockP = classifyWeapon(weapon("Rock", { missile: true, melee: false }));
const dartP = classifyWeapon(weapon("Dart", { missile: true, melee: false }));
check("military oil, holy water and a rock are everyone's to throw", [oilP, holyP, rockP].every((p) => isWeaponProficient(swordsOnly, p)));
check("a dart still needs its grant", !isWeaponProficient(swordsOnly, dartP));
const torchP = classifyWeapon(weapon("Torch", { melee: true, missile: true }));
check("a torch is everyone's thrown, and carried", isWeaponProficient(swordsOnly, torchP, undefined, { attack: "thrown" }) && isWeaponProficient(swordsOnly, torchP));
check("a torch swung in melee needs its grant", !isWeaponProficient(swordsOnly, torchP, undefined, { attack: "melee" }));
// Beyond the table: anything that bursts, and a thrown thing the table
// cannot place that its name calls a flask or a bottle, and a tagged grenade.
const acidP = classifyWeapon(weapon("Flask of acid", { missile: true, melee: false }));
const brickP = classifyWeapon(weapon("Brick", { missile: true, melee: false }));
const taggedP = classifyWeapon(weapon("Smoke charge", { missile: true, melee: false, tags: ["Grenade"] }));
check("an unplaced thrown flask is everyone's", isWeaponProficient(swordsOnly, acidP));
check("a grenade-tagged weapon is everyone's", isWeaponProficient(swordsOnly, taggedP));
check("an unplaced throwable its name does not place is not everyone's", brickP.anyoneThrows === false);
check("and with no class imported for it, its proficiency is undecided, not refused", isWeaponProficient(swordsOnly, brickP));
check("a table-placed weapon is never read by name", classifyWeapon(weapon("Stick-handled mace", { melee: true, missile: true })).anyoneThrows === false);
check("the Training pills read grants alone", !isWeaponProficient(swordsOnly, oilP, undefined, { grantsOnly: true }));
const oilOnly = getLoadout(actor([weapon("Military Oil", { missile: true, melee: false, id: "oil" })], { flags: { weaponProficiency: "swordDagger" } }));
check("military oil drawn by a sword-trained character is no non-proficient use", oilOnly.nonProficientUse === false);
const torchHeld = weapon("Torch", { melee: true, missile: true, id: "tch" });
a = rollActor([torchHeld], { flags: { weaponProficiency: "swordDagger" }, system: { details: { level: 1 }, attack: { throw: 10 }, scores: { str: { mod: 2 }, dex: { mod: 1 } } } });
check("a torch thrown takes no package; swung, it does", attackThrowRows(a, torchHeld, "thrown").length === 0 && sumRows(attackThrowRows(a, torchHeld, "melee")) === -2);
{
  const { rollGroups } = await import("../scripts/equipment/item-sheet/rolls.mjs");
  const modes = rollGroups(torchHeld, a).find((g) => g.key === "attackModes")?.rows ?? [];
  const tagged = (id) => (modes.find((r) => r.id === id)?.mods ?? []).some((m) => /nonProficient$/.test(m));
  check("the Rolls tag agrees: a torch's swing is marked, its throw is not", tagged("atk:melee") && !tagged("atk:missile"));
}

// Weapon Finesse swaps STR (+1) for DEX (+3) → net +2.
a = rollActor([swordItem], { flags: { styles: "single,twoHanded" }, effects: [marker("finesse", "1")], system: { scores: { str: { mod: 1 }, dex: { mod: 3 } } } });
rows = attackThrowRows(a, swordItem, "melee");
check("Weapon Finesse → +(dex−str) = +2", sumRows(rows) === 2);
check("Weapon Finesse is named as its own row, so the roll shows the swap", rows.length === 1 && rows[0].label === "Weapon Finesse" && rows[0].value === 2);
check("Weapon Finesse does not apply to missile attacks", attackThrowRows(a, swordItem, "missile").length === 0);

// The sizes Weapon Finesse takes are imported (the equipment document's
// `weaponFinesse` table); the lists below are INVENTED. Only a listed table, a
// known size and a size the table does not name refuses: the sword here is a
// medium weapon.
{
  const { registerTable: reg, unregisterTable: unreg, PRIORITY: P } = await import(new URL("../lib/tables.mjs", S));
  const { finesseTakes, finesseSizesImported } = await import(new URL("attack-mods.mjs", S));
  const withSizes = (sizes) => ({ id: "equipment", tables: { weaponFinesse: { sizes } } });
  check("no list imported: no size is decided and the list reads as not imported", finesseTakes("medium") === null && finesseTakes("large") === null && finesseSizesImported() === false);
  reg(withSizes(["tiny", "small"]), { priority: P.WORLD, source: "test" });
  check("an imported list names a size: true; omits a known size: false; leaves an unknown size undecided",
    finesseTakes("small") === true && finesseTakes("medium") === false && finesseTakes(null) === null && finesseSizesImported() === true);
  check("a medium sword is refused the swap when the list omits medium", attackThrowRows(a, swordItem, "melee").length === 0);
  unreg("equipment", { priority: P.WORLD });
  reg(withSizes(["medium"]), { priority: P.WORLD, source: "test" });
  check("a list that names medium gives the swap back", sumRows(attackThrowRows(a, swordItem, "melee")) === 2);
  unreg("equipment", { priority: P.WORLD });
  reg(withSizes("small"), { priority: P.WORLD, source: "test" });
  check("an override that is not a list counts as not imported and refuses nothing", finesseTakes("large") === null && sumRows(attackThrowRows(a, swordItem, "melee")) === 2);
  unreg("equipment", { priority: P.WORLD });
  reg(withSizes([]), { priority: P.WORLD, source: "test" });
  check("an empty list counts as not imported", finesseTakes("small") === null);
  unreg("equipment", { priority: P.WORLD });
  reg(withSizes([5, null, ""]), { priority: P.WORLD, source: "test" });
  check("a list of things that are not size words counts as not imported", finesseTakes("small") === null && finesseSizesImported() === false);
  unreg("equipment", { priority: P.WORLD });
}

// Lone medium sword is wielded two-handed → the two-handed die is the system's
// ALTERNATE damage mode, offered first; the alternate the item leaves blank
// reads the table's two-handed die.
check("two-handed grip offers the alternate mode first", damageModesFor(a, swordItem, "melee", ["base"]).join() === "alternate,base");
check("the alternate the item leaves blank is the table's two-handed die", damageFormulaFor(swordItem, "alternate", "") === FIXTURE_ROWS.sword.damage2h && damageFormulaFor(swordItem, "base", "1d6") === "1d6");
check("an alternate the item states is left alone", damageFormulaFor(swordItem, "alternate", "1d10") === "1d10");
check("a one-handed grip still offers the alternate, after the base",
  damageModesFor(rollActor([swordItem, armor("Shield", "shield", { id: "sh" })], { flags: { styles: "weaponShield" } }), swordItem, "melee", ["base"]).join() === "base,alternate");
check("a caller's asked-for mode goes first", damageModesFor(a, swordItem, "melee", ["base"], "base").join() === "base,alternate");
check("a missile attack offers no grip", damageModesFor(a, swordItem, "missile", ["base"]).join() === "base");

/* --- Strength of Faith: WIS in place of STR on damage ---------------------- */
//
// The system puts STR on the damage roll itself, so this feature contributes
// the DIFFERENCE as a row of its own, on every roll STR modifies.
const strRow = (n) => [{ label: "Strength", value: n }];
const faith = { scores: { str: { mod: 1 }, wis: { mod: 3 } } };
a = rollActor([swordItem], { flags: { styles: "single,twoHanded" }, effects: [marker("damageAttribute", "wis")], system: faith });
rows = damageRows(a, swordItem, "melee", strRow(1));
check("WIS (+3) replaces STR (+1) on melee damage → a +2 row beside STR's", rows.length === 2 && rows[1].value === 2);
check("the substitution is named in the roll", /WIS/.test(rows[1].label));
check("a thrown weapon's damage takes the substitution too", damageRows(a, swordItem, "thrown", strRow(1)).length === 2);
check("a missile shot, which STR never modifies, takes none", damageRows(a, swordItem, "missile", []).length === 0);

// Equal modifiers cancel to nothing — no row, no phantom "+0".
a = rollActor([swordItem], { flags: { styles: "single,twoHanded" }, effects: [marker("damageAttribute", "wis")], system: { scores: { str: { mod: 2 }, wis: { mod: 2 } } } });
check("an equal substitute changes no damage", damageRows(a, swordItem, "melee", strRow(2)).length === 1);

// A WORSE substitute still applies: the rule is a replacement, not a bonus.
a = rollActor([swordItem], { flags: { styles: "single,twoHanded" }, effects: [marker("damageAttribute", "wis")], system: { scores: { str: { mod: 2 }, wis: { mod: 0 } } } });
check("a weaker substitute still replaces STR", sumRows(damageRows(a, swordItem, "melee", strRow(2))) === 0);

// An attribute the actor does not carry is a typo in somebody's ability, not a
// substitution: leave Strength alone rather than swap in a zero.
a = rollActor([swordItem], { flags: { styles: "single,twoHanded" }, effects: [marker("damageAttribute", "cha")], system: faith });
check("an attribute the actor lacks leaves STR alone", damageRows(a, swordItem, "melee", strRow(1)).length === 1);

// A torch takes no damage bonus at all: the body's bonuses are left off its die.
const torchItem = weapon("Torch", { melee: true, id: "to", damage: "1d4" });
a = rollActor([torchItem], { flags: { styles: "single,twoHanded" }, effects: [marker("damageAttribute", "wis")], system: faith });
check("a no-damage-bonus weapon gains nothing from the substitution or from STR", damageRows(a, torchItem, "melee", strRow(1)).length === 0);

// A large weapon has no 1H/2H split → no alternate mode.
const greatItem = weapon("Two-Handed Sword", { melee: true, id: "gs" });
a = rollActor([greatItem], { flags: { styles: "single,twoHanded" }, system: { scores: { str: { mod: 1 }, dex: { mod: 1 } } } });
check("large weapon → no alternate damage mode", damageModesFor(a, greatItem, "melee", ["base"]).join() === "base");

// The dual weapon style's own attack modifier is loadout-level (belongs in the
// effect, not the wrap), at the figure the import holds and never before; a
// Judge's override of the table wins. Figures invented.
{
  const dualLo = getLoadout(actor([weapon("Sword", { melee: true, id: "x" }), weapon("Dagger", { melee: true, id: "y" })], { flags: { styles: "dual" } }));
  const meleeOf = () => buildLoadoutChanges(actor([], { flags: { styles: "dual" } }), dualLo).filter((c) => c.key === "system.attack.mod.melee").map((c) => Number(c.value));
  check("dual style, nothing imported → no melee attack figure", dualLo.activeStyle === "dual" && meleeOf().length === 0);
  check("dual style, nothing imported → the reader says null", dualStyleFigure() === null);
  registerTable({ id: "equipment", tables: { dualWeaponStyle: { attack: 2 } } }, { priority: PRIORITY.WORLD });
  check("dual style → the imported figure on melee attack", meleeOf().join() === "2" && dualStyleFigure() === 2);
  registerTable({ id: "equipment", tables: { dualWeaponStyle: { attack: 5 } } }, { priority: PRIORITY.OVERRIDE });
  check("dual style → the Judge's override wins over the import", meleeOf().join() === "5");
  unregisterTable("equipment", { priority: PRIORITY.OVERRIDE });
  unregisterTable("equipment", { priority: PRIORITY.WORLD });
}
// The heavy helmet's figures: read from the table, overridden by the Judge,
// null when not imported. Figures invented.
{
  check("helm figures, nothing imported → every one null", Object.values(helmFigures()).every((v) => v === null));
  registerTable({ id: "equipment", tables: { heavyHelm: { surprise: -3, listening: -6, mortalWounds: 4 } } }, { priority: PRIORITY.WORLD });
  check("helm figures → read from the imported table", JSON.stringify(helmFigures()) === JSON.stringify({ surprise: -3, listening: -6, mortalWounds: 4 }));
  registerTable({ id: "equipment", tables: { heavyHelm: { surprise: -2, listening: -6, mortalWounds: 4 } } }, { priority: PRIORITY.OVERRIDE });
  check("helm figures → the Judge's override wins", helmFigures().surprise === -2);
  unregisterTable("equipment", { priority: PRIORITY.OVERRIDE });
  unregisterTable("equipment", { priority: PRIORITY.WORLD });
}

// The overlays and the effect model are the mechanics under test below,
// exercised against constructed items rather than a shipped content pack.

// --- Phase 5b: JJ shield-variant overlay -------------------------------------
const shieldItem = (name, variant, strap = "hand") =>
  armor(name, "shield", { ac: 1, id: name.replace(/\W/g, ""), flags: { shieldVariant: variant, strap } });
// Trained two-handed as well, so a sword left alone by a back-strapped shield
// keeps its two-handed grip.
// A specialized actor carries the proficiency whose Weapon & Shield spec adds
// WS_SPEC (styleSpecs above) while the style is active.
const WS_SPEC = 3;
const wsActor = (items, spec = true) =>
  actor(spec ? [...items, styleTraining("fss-ws")] : items, {
    flags: { styles: "weaponShield,twoHanded" },
    effects: spec ? [marker("styleProficient", "weaponShield:spec")] : [],
  });

// Overlay OFF: a buckler behaves exactly like a standard shield (core's +1),
// no correction — a disabled toggle must change nothing.
SETTINGS_STATE.overlayShieldVariants = false;
let lo2 = getLoadout(wsActor([weapon("Sword", { melee: true, id: "s1" }), shieldItem("Buckler", "buckler")], false));
let ch2 = buildLoadoutChanges(wsActor([], false), lo2);
check("overlay off → no shield AC correction", !ch2.some((c) => c.key === "system.ac.mod" && Number(c.value) < 0));
check("overlay off → strapped shield still costs a hand", lo2.handsUsed === 2);

SETTINGS_STATE.overlayShieldVariants = true;
// Buckler WITHOUT Weapon & Shield Specialization grants nothing → cancel core's +1.
const noSpec = wsActor([weapon("Sword", { melee: true, id: "s2" }), shieldItem("Buckler", "buckler")], false);
lo2 = getLoadout(noSpec);
ch2 = buildLoadoutChanges(noSpec, lo2);
const acDelta = ch2.filter((c) => c.key === "system.ac.mod").reduce((n, c) => n + Number(c.value), 0);
check("buckler without spec → −1 cancels core's shield AC", acDelta === -1);
// Buckler WITH Specialization: core's shield AC stands, plus the spec's own figure.
const withSpec = wsActor([weapon("Sword", { melee: true, id: "s3" }), shieldItem("Buckler", "buckler")], true);
const acDelta2 = buildLoadoutChanges(withSpec, getLoadout(withSpec)).filter((c) => c.key === "system.ac.mod").reduce((n, c) => n + Number(c.value), 0);
check("buckler with spec → the spec's figure, core's shield AC kept", acDelta2 === WS_SPEC);

// A shield strapped on the BACK costs no hand, forms no Weapon & Shield style,
// and must not raise ordinary AC.
const backAct = wsActor([weapon("Sword", { melee: true, id: "s4" }), shieldItem("Auxiliary Shield", "auxiliary", "back")], true);
const backLo = getLoadout(backAct);
check("back-strapped shield costs no hand", backLo.handShields.length === 0);
check("back-strapped shield → lone sword still wielded two-handed", backLo.weapons[0].wieldTwoHanded === true);
check("back-strapped shield → style is not weaponShield", backLo.activeStyle !== "weaponShield");
const backAC = buildLoadoutChanges(backAct, backLo).filter((c) => c.key === "system.ac.mod").reduce((n, c) => n + Number(c.value), 0);
check("back-strapped shield → ordinary AC cancelled (rear-only is situational)", backAC === -1);

// A phalanx shield in hand behaves normally (core's shield AC, plus the spec).
const phal = wsActor([weapon("Sword", { melee: true, id: "s5" }), shieldItem("Phalanx Shield", "phalanx")], true);
const phalLo = getLoadout(phal);
check("phalanx in hand → weaponShield style, costs a hand", phalLo.activeStyle === "weaponShield" && phalLo.handsUsed === 2);
const phalAC = buildLoadoutChanges(phal, phalLo).filter((c) => c.key === "system.ac.mod").reduce((n, c) => n + Number(c.value), 0);
check("phalanx on foot → core's shield AC stands", phalAC === WS_SPEC);

// MOUNTED: a phalanx shield cannot be used from horseback (config `noMount`),
// which the mount binding in acks-lib finally makes answerable. Stub the lib
// the way the runtime reaches it — through globalThis.acksExtras.lib.
const priorLib = globalThis.acksExtras.lib;
globalThis.acksExtras.lib = { mount: { isMounted: (a) => a?.id === phal.id } };
const phalMountedAC = buildLoadoutChanges(phal, phalLo).filter((c) => c.key === "system.ac.mod").reduce((n, c) => n + Number(c.value), 0);
check("phalanx MOUNTED → ordinary AC cancelled (RAW: unusable from horseback)", phalMountedAC === WS_SPEC - 1);

// The rule must be specific to the phalanx: a kite shield is FOR horseback.
const kite = wsActor([weapon("Sword", { melee: true, id: "s6" }), shieldItem("Kite Shield", "kite")], true);
const kiteMountedAC = buildLoadoutChanges(kite, getLoadout(kite)).filter((c) => c.key === "system.ac.mod").reduce((n, c) => n + Number(c.value), 0);
check("kite MOUNTED → unaffected, still grants AC", kiteMountedAC === WS_SPEC);

// Without acks-lib nothing mounted fires, so behaviour is exactly as before.
globalThis.acksExtras.lib = undefined;
const phalNoLibAC = buildLoadoutChanges(phal, phalLo).filter((c) => c.key === "system.ac.mod").reduce((n, c) => n + Number(c.value), 0);
check("no acks-lib → mounted rules dormant, phalanx AC stands", phalNoLibAC === WS_SPEC);
globalThis.acksExtras.lib = priorLib;

// --- no style, no shield (RR ch.3) -------------------------------------------
// Core adds a shield's AC unconditionally; a character without the Weapon &
// Shield style gains nothing from one, so the loadout says so and the effect
// cancels the addition — once, however many rules would cancel it.
const noStyle = actor([weapon("Sword", { melee: true, id: "s7" }), armor("Shield", "shield", { ac: 1, id: "sh7" })], { flags: { styles: "single" } });
const noStyleLo = getLoadout(noStyle);
check("shield without the style → shieldStyled false, advisory raised",
  noStyleLo.shieldStyled === false && noStyleLo.violations.some((v) => v.type === VIOLATION.SHIELD_NO_STYLE && v.advisory));
const noStyleAC = buildLoadoutChanges(noStyle, noStyleLo).filter((c) => c.key === "system.ac.mod").reduce((n, c) => n + Number(c.value), 0);
check("shield without the style → −1 cancels core's shield AC", noStyleAC === -1);
const styled = wsActor([weapon("Sword", { melee: true, id: "s8" }), armor("Shield", "shield", { ac: 1, id: "sh8" })], false);
const styledLo = getLoadout(styled);
check("shield with the style → shieldStyled, core's shield AC stands untouched",
  styledLo.shieldStyled === true && !styledLo.violations.some((v) => v.type === VIOLATION.SHIELD_NO_STYLE)
  && !buildLoadoutChanges(styled, styledLo).some((c) => c.key === "system.ac.mod"));
const noStyleBuckler = actor([weapon("Sword", { melee: true, id: "s9" }), shieldItem("Buckler", "buckler")], { flags: { styles: "single" } });
const noStyleBucklerAC = buildLoadoutChanges(noStyleBuckler, getLoadout(noStyleBuckler)).filter((c) => c.key === "system.ac.mod").reduce((n, c) => n + Number(c.value), 0);
check("buckler without style or spec → −1 once, never −2", noStyleBucklerAC === -1);
const bigShield = actor([weapon("Sword", { melee: true, id: "s10" }), armor("Tower Shield", "shield", { ac: 2, id: "sh10" })], { flags: { styles: "single" } });
const bigShieldAC = buildLoadoutChanges(bigShield, getLoadout(bigShield)).filter((c) => c.key === "system.ac.mod").reduce((n, c) => n + Number(c.value), 0);
check("the cut is the shield's own value, whatever it is", bigShieldAC === -2);
check("no shield in hand → nothing to cut", getLoadout(actor([weapon("Sword", { melee: true, id: "s11" })], { flags: { styles: "single" } })).shieldStyled === true);

// --- single-shield rule (RR p141) + shield-frees-a-hand-for-a-light -----------
// A character benefits from only ONE shield, however carried. Two in hand:
check(
  "two shields → TOO_MANY_SHIELDS (single-shield rule)",
  getLoadout(wsActor([shieldItem("Shield", "standard", "hand"), shieldItem("Buckler", "buckler", "hand")], true))
    .violations.some((v) => v.type === VIOLATION.TOO_MANY_SHIELDS),
);
// One in hand PLUS one strapped on the back is STILL two shields — the strapped
// one costing no hand must not become a loophole for a second shield.
check(
  "in-hand + back-strapped is still two shields",
  getLoadout(wsActor([shieldItem("Phalanx Shield", "phalanx", "hand"), shieldItem("Auxiliary Shield", "auxiliary", "back")], true))
    .violations.some((v) => v.type === VIOLATION.TOO_MANY_SHIELDS),
);
// The legitimate shield+light case: hold a light (formation) in one hand, a
// one-handed weapon in the other, and a shield strapped on the back. All three
// coexist — the strapped shield frees the hand the light needs — and it is still
// a single shield. Mock formation's held-light count for this actor.
const priorFormation = globalThis.acksExtras.formation;
const partySheetHands = (lights, mapping = 0) => ({
  handsOccupied: () => ({ lights, mapping, total: lights + mapping }),
  // The burning records the loadout reads through lib's bearerLights.
  lightsForBearer: (id) => Array.from({ length: lights }, (_, i) => ({ id: `l${i}`, type: "torch", lit: true, bearerId: id })),
});
globalThis.acksExtras.formation = partySheetHands(1);
const shieldLight = getLoadout(wsActor([weapon("Sword", { melee: true, id: "sl" }), shieldItem("Auxiliary Shield", "auxiliary", "back")], true));
check("shield+light: sword + strapped shield + held light all fit (2 hands, legal)", shieldLight.handsUsed === 2 && shieldLight.legal);
check("shield+light: the lone sword yields its 2H grip to the light", shieldLight.weapons[0].wieldTwoHanded === false);
check("shield+light: still a single shield (no violation)", !shieldLight.violations.some((v) => v.type === VIOLATION.TOO_MANY_SHIELDS));

// The mapper's kit fills BOTH hands (RR p266), so a mapper cannot also hold a
// weapon — the same accounting the light uses, from the same single call.
globalThis.acksExtras.formation = partySheetHands(0, 2);
const mapperIdle = getLoadout(actor([]));
check("the mapper's kit takes both hands", mapperIdle.handsUsed === 2 && mapperIdle.handsFree === 0);
check("the loadout reports WHY the hands are full", mapperIdle.mappingHands === 2 && mapperIdle.heldLights === 0);
const mapperArmed = getLoadout(actor([weapon("Sword", { melee: true, id: "ms" })]));
check("a mapper with a drawn sword overflows the hand budget",
  mapperArmed.violations.some((v) => v.type === VIOLATION.HAND_OVERFLOW));
globalThis.acksExtras.formation = priorFormation;

// --- shield ENCUMBRANCE (enc / encItem / frontEnc / mountEnc) -----------------
// The variant table carried these from the start with nothing reading them, so
// every shield weighed whatever its item said. Values are in STONE; the module
// contributes the difference from core's flat sum, in weight6.
const { shieldEnc6, shieldEncumbranceDelta6 } = await import(new URL("overlays/shield-variants.mjs", S));
const shieldOf = (name, variant, strap) =>
  armor(name, "shield", { ac: 1, id: "e" + name.replace(/\W/g, ""), flags: { shieldVariant: variant, strap }, equipped: true });

check("standard shield → 1 stone", shieldEnc6(shieldOf("Shield", "standard")) === 6);
check("kite shield → 2 stone on foot", shieldEnc6(shieldOf("Kite", "kite")) === 12);
check("buckler is rated as one ITEM, not one stone", shieldEnc6(shieldOf("Buckler", "buckler")) === 1);
// Front-strapping a crescent makes it HEAVIER — the table says 2 against 1.
check("crescent slung → 1 stone", shieldEnc6(shieldOf("Crescent", "crescent")) === 6);
check("crescent front-strapped → 2 stone", shieldEnc6(shieldOf("Crescent", "crescent", "front")) === 12);

const kiteRider = wsActor([shieldOf("Kite", "kite")], false);
globalThis.acksExtras.lib = { mount: { isMounted: (a) => a?.id === kiteRider.id } };
check("kite shield rides lighter mounted (2 stone → 1)", shieldEnc6(shieldOf("Kite", "kite"), kiteRider) === 6);
globalThis.acksExtras.lib = priorLib;

// The correction is the DIFFERENCE from the item's own weight, so core keeps
// counting each item once and only the disagreement is contributed.
const heavyKite = armor("Kite", "shield", { ac: 1, id: "hk", w6: 6, flags: { shieldVariant: "kite" }, equipped: true });
check("correction is the difference from the item's own weight6",
  shieldEncumbranceDelta6(wsActor([heavyKite])) === 6); // RAW 2 stone (12) − item 1 stone (6)
check("an UNEQUIPPED shield is cargo and keeps its item weight",
  shieldEncumbranceDelta6(wsActor([armor("Kite", "shield", { ac: 1, id: "uk", w6: 6, flags: { shieldVariant: "kite" }, equipped: false })])) === 0);

SETTINGS_STATE.overlayShieldVariants = false; // leave global state clean
check("overlay off → shields weigh what the item says", shieldEncumbranceDelta6(wsActor([heavyKite])) === 0);
check("overlay off → shieldEnc6 defers to core", shieldEnc6(shieldOf("Kite", "kite")) === null);

// --- Phase 5b: special maneuvers overlay -------------------------------------
const { maneuverMods, MANEUVERS } = await import(new URL("overlays/maneuvers.mjs", S));
const plainActor = actor([]);
const mWhip = classifyWeapon(weapon("Whip", { melee: true }));
const mNet = classifyWeapon(weapon("Net", { melee: true }));
const mSword = classifyWeapon(weapon("Sword", { melee: true }));

// Every figure is the Judge's import, so each case registers its own INVENTED
// ones (none of them a printed value); nothing imported answers null, and the
// attack throw goes out without a manoeuvre row.
const MAN_FIG = {
  id: "equipment",
  tables: {
    maneuverDisarm: { disarm: -7, twoHandedSave: 3 },
    maneuverPenalties: { forceBack: -8, incapacitate: -9, knockDown: -11, overrun: -12, wrestling: -13, sunder: -15, sunderShaft: -10 },
    combatTrickery: { reduction: 3, noSaveReduction: 6, saveMod: -5 },
    maneuverQualities: { entangling: 8, flexible: 10, incapacitating: 12 },
    hookedWeapon: { reduction: 5, saveMod: -7 },
  },
};
const manActor = rollActor([swordItem, armor("Shield", "shield", { id: "sh" })], { flags: { styles: "weaponShield" }, system: { scores: { str: { mod: 1 }, dex: { mod: 1 } } } });
const trick = actor([], { effects: [marker("maneuverTrickery", "knockDown")] });
const trickInc = actor([], { effects: [marker("maneuverTrickery", "incapacitate")] });
const trickDisarm = actor([], { effects: [marker("maneuverTrickery", "disarm")] });

// Nothing imported: no penalty, no sum of the parts that would have read, and
// the missing field named.
let mm = maneuverMods(plainActor, mSword, "knockDown");
check("nothing imported → the penalty is null, not 0", mm.attackPenalty === null && mm.missing.join() === "maneuverPenalties.knockDown" && mm.parts.length === 0);
check("nothing imported → Trickery's reduction and save modifier are named too", maneuverMods(trick, mSword, "knockDown").missing.join() === "maneuverPenalties.knockDown,combatTrickery.reduction,combatTrickery.saveMod");
check("nothing imported → a no-save maneuver names the no-save reduction", maneuverMods(trickInc, mSword, "incapacitate").missing.includes("combatTrickery.noSaveReduction"));
check("nothing imported → the attack throw carries no manoeuvre row", attackThrowRows(manActor, swordItem, "melee", { maneuver: "knockDown" }).length === 0);
check("nothing imported → a MANEUVERS entry states no penalty", Object.values(MANEUVERS).every((m) => !("penalty" in m) && !("penaltyVsShaft" in m)));
check("unknown maneuver → null", maneuverMods(plainActor, mSword, "nonsense") === null);

registerTable(MAN_FIG, { priority: PRIORITY.WORLD, source: "test" });
const base = (key, o) => maneuverMods(plainActor, mSword, key, o);
check("each maneuver's penalty is the imported one", [["disarm", -7], ["forceBack", -8], ["incapacitate", -9], ["knockDown", -11], ["overrun", -12], ["wrestling", -13]].every(([k, v]) => base(k).attackPenalty === v));
check("a read penalty names its part and table", (() => { const r = base("knockDown"); return r.missing.length === 0 && r.parts.length === 1 && r.parts[0].part === "base" && r.parts[0].table === "maneuverPenalties"; })());
check("disarm reads its own table", base("disarm").parts[0].table === "maneuverDisarm");
// The attack throw's row is the penalty, labelled as the manoeuvre.
{
  const rows = attackThrowRows(manActor, swordItem, "melee", { maneuver: "knockDown" });
  check("the attack throw carries the manoeuvre's penalty row", rows.length === 1 && rows[0].label === MANEUVERS.knockDown.label && rows[0].value === -11);
}
// Combat Trickery: the penalty is reduced AND the target saves worse.
mm = maneuverMods(trick, mSword, "knockDown");
check("Combat Trickery → penalty reduced and the save modifier imposed", mm.attackPenalty === -11 + 3 && mm.targetSaveMod === -5);
// No-save maneuver: the other reduction, and no save modifier.
mm = maneuverMods(trickInc, mSword, "incapacitate");
check("Trickery on a no-save maneuver → the no-save reduction, no save mod", mm.attackPenalty === -9 + 6 && mm.targetSaveMod === 0 && MANEUVERS.incapacitate.save === null);
// Weapon qualities: Flexible (whip) to disarm; Entangling (net) to wrestle.
check("Flexible whip → disarm carries the quality's bonus", base("disarm").attackPenalty === -7 && maneuverMods(plainActor, mWhip, "disarm").attackPenalty === -7 + 10);
check("Entangling net → wrestle carries the quality's bonus", maneuverMods(plainActor, mNet, "wrestling").attackPenalty === -13 + 8);
check("quality does not apply to an unrelated maneuver", maneuverMods(plainActor, mWhip, "overrun").attackPenalty === -12);
// Trickery and a weapon quality stack.
check("Trickery + Flexible stack on disarm", maneuverMods(trickDisarm, mWhip, "disarm").attackPenalty === -7 + 3 + 10);
// Sunder: its own figure, and another against a shaft.
check("sunder reads one figure normally and another against a shaft", base("sunder").attackPenalty === -15 && base("sunder", { targetShaft: true }).attackPenalty === -10);
check("targetShaft changes no other manoeuvre", base("knockDown", { targetShaft: true }).attackPenalty === -11);
// Disarm: the two-handed grip changes the target's save.
check("disarm vs two-handed grip → the imported save bonus", base("disarm", { targetTwoHanded: true }).targetSaveMod === 3);
// Hooked (MM) acts as Trickery for disarm, but must not double up with it.
check("hooked weapon → disarm reduced and the save modifier imposed", (() => { const r = base("disarm", { hooked: true }); return r.attackPenalty === -7 + 5 && r.targetSaveMod === -7; })());
check("hooked does not stack on top of Trickery", maneuverMods(trickDisarm, mSword, "disarm", { hooked: true }).attackPenalty === -7 + 3);

// One table of the five absent: only the figures that need it go null.
unregisterTable("equipment", { priority: PRIORITY.WORLD });
registerTable({ id: "equipment", tables: { ...MAN_FIG.tables, combatTrickery: undefined } }, { priority: PRIORITY.WORLD, source: "test" });
check("Combat Trickery not imported → its manoeuvre's penalty is null, another's is not", maneuverMods(trick, mSword, "knockDown").attackPenalty === null && base("knockDown").attackPenalty === -11);
unregisterTable("equipment", { priority: PRIORITY.WORLD });
registerTable({ id: "equipment", tables: { ...MAN_FIG.tables, maneuverQualities: undefined, hookedWeapon: undefined, maneuverDisarm: { disarm: -7 } } }, { priority: PRIORITY.WORLD, source: "test" });
check("weapon qualities not imported → a Flexible whip's disarm penalty is null, a sword's is not", maneuverMods(plainActor, mWhip, "disarm").attackPenalty === null && base("disarm").attackPenalty === -7);
check("hooked not imported → disarm's penalty and save modifier are null", (() => { const r = base("disarm", { hooked: true }); return r.attackPenalty === null && r.targetSaveMod === null; })());
check("the two-handed bonus not imported → the save modifier is null, the penalty is not", (() => { const r = base("disarm", { targetTwoHanded: true }); return r.targetSaveMod === null && r.attackPenalty === -7; })());
// A Judge's override of one field wins, and a blank field reads as not imported.
unregisterTable("equipment", { priority: PRIORITY.WORLD });
registerTable(MAN_FIG, { priority: PRIORITY.WORLD, source: "test" });
registerTable({ id: "equipment", tables: { maneuverPenalties: { ...MAN_FIG.tables.maneuverPenalties, knockDown: -20, overrun: "" } } }, { priority: PRIORITY.OVERRIDE });
check("an override changes the figure; a blank one is not imported", base("knockDown").attackPenalty === -20 && base("overrun").attackPenalty === null);
unregisterTable("equipment", { priority: PRIORITY.OVERRIDE });
// The Rolls tab: the row shows the penalty the throw will carry, with its
// tooltip; nothing imported shows no figure and still lists the roll.
{
  const { rollGroups } = await import("../scripts/equipment/item-sheet/rolls.mjs");
  const manRow = (key) => rollGroups(swordItem, manActor).find((g) => g.key === "maneuvers")?.rows.find((r) => r.id === `man:${key}`);
  const read = manRow("knockDown");
  check("imported: the Rolls row shows the penalty and a provenance tooltip", read.v === "−11" && read.line.startsWith("−11 ") && /maneuver\.tip$/.test(read.tip));
  unregisterTable("equipment", { priority: PRIORITY.WORLD });
  const none = manRow("knockDown");
  check("not imported: the Rolls row says so, shows no figure, names the tables in its tooltip and still rolls",
    none.v === "—" && /maneuver\.notImported$/.test(none.line.split(" · ")[0]) && /maneuver\.notImportedTip$/.test(none.tip) && none.rollable === true);
}


// --- Phase 7: containers ------------------------------------------------------
const { encumbranceDelta6, contentsWeight6, overCapacity, containerReport, isContainer } =
  await import(new URL("containers.mjs", S));

const gear = (name, w6, over = {}) => {
  const type = over.type ?? "item";
  const system = { cost: over.cost ?? 0, weight6: w6, quantity: { value: over.qty ?? 1 }, subtype: over.subtype };
  // Core declares `equipped` on weapon and armor ONLY, and Foundry prunes keys
  // outside a type's schema — so a fixture carrying it on a plain `item` claims
  // a field the system cannot store. That lie is exactly how the adventurer's
  // harness rule stayed dead through a green suite: it gated on
  // `system.equipped`, the fixture supplied one, and no real world ever could.
  // Worn gear that is not a weapon or armour declares a slot instead.
  if (type === "weapon" || type === "armor") system.equipped = over.equipped ?? false;
  const flags = { ...(over.flags ?? {}) };
  if (over.slots || over.wornAt) {
    flags.gear = { ...(flags.gear ?? {}), slots: over.slots ?? [over.wornAt], wornAt: over.wornAt ?? "" };
  }
  return {
    id: over.id ?? name.replace(/\W/g, ""),
    name,
    type,
    system,
    getFlag: (_m, k) => flags[k],
    effects: [],
  };
};
const withItems = (items, over = {}) => {
  const a = actor(items, over);
  a.items = Object.assign(items.slice(), {
    filter: (f) => items.filter(f),
    find: (f) => items.find(f),
    // containerChain walks by id and bounds itself by the collection size.
    get: (id) => items.find((i) => i.id === id),
    size: items.length,
  });
  return a;
};

// Contents stay real items, so core's flat sum is ALREADY right for a plain
// backpack — the correction must be zero, or we'd silently change every actor.
const pack = gear("Backpack", 1, { id: "bp", flags: { container: { capacity: 4 } } });
const rope = gear("Rope", 6, { id: "rope", flags: { containedIn: "bp" } });
const rations = gear("Rations", 6, { id: "rat", flags: { containedIn: "bp" } });
const cActor = withItems([pack, rope, rations]);
check("plain backpack -> no encumbrance correction (core's flat sum is RAW)", encumbranceDelta6(cActor) === 0);

// --- bundles: a stated weight may cover N units ------------------------------
// The books rate a quiver of arrows or a set of spikes as ONE item however many
// it holds. Core multiplies weight6 by the whole quantity and cannot be
// changed, so the correction is contributed here — and the two sums must agree,
// or the item sheet and the character sheet print different numbers.
const { weight6Of: w6Of, bundleSizeOf, coreWeight6Of } = await import(new URL("../lib/item-model.mjs", S));
const bundleQuiver = (over = {}) => gear("Quiver, 20 Arrows", 1, { id: "qv", qty: over.qty ?? 20, flags: { gear: { per: over.per ?? 20 } } });

check("no bundle declared → per is 1", bundleSizeOf(gear("Rope", 6)) === 1);
check("a bundle counts its weight once, not once per unit", w6Of(bundleQuiver()) === 1);
check("core's own sum is what over-counted it", coreWeight6Of(bundleQuiver()) === 20);
check("the correction closes exactly that gap", encumbranceDelta6(withItems([bundleQuiver()])) === -19);
// A part-used bundle is still one item — this is the ceil ruling, and it is
// what distinguishes a bundle from a linear per-unit fraction.
check("21 of a 20-bundle weighs two bundles, not 1.05", w6Of(bundleQuiver({ qty: 21 })) === 2);
check("1 of a 20-bundle still weighs a whole bundle", w6Of(bundleQuiver({ qty: 1 })) === 1);
check("an emptied bundle weighs nothing", w6Of(bundleQuiver({ qty: 0 })) === 0);
check("per below 1 cannot divide a weight away", bundleSizeOf(gear("Odd", 6, { flags: { gear: { per: 0 } } })) === 1);
check("a bundled stack inside a container rolls up bundled",
  contentsWeight6(withItems([gear("Pack", 1, { id: "bp2", flags: { container: { capacity: 4 } } }),
    gear("Quiver, 20 Arrows", 1, { id: "q2", qty: 20, flags: { gear: { per: 20 }, containedIn: "bp2" } })]), "bp2") === 1);
// Clothing is outside core's multiplied branch, so it must contribute no
// correction however its bundle reads.
check("clothing declares no bundle correction",
  encumbranceDelta6(withItems([gear("Robes", 6, { qty: 4, subtype: "clothing", flags: { gear: { per: 4 } } })])) === 0);
check("backpack rolls up its contents' weight", contentsWeight6(cActor, "bp") === 12);
check("backpack under capacity (2 st of 4)", !overCapacity(cActor, pack));
check("container report lists load in stone", containerReport(cActor)[0].loadStone === 2);
check("isContainer only true for flagged items", isContainer(pack) && !isContainer(rope));

const ingots = gear("Iron Ingots", 30, { id: "ing", flags: { containedIn: "bp" } });
check("backpack over capacity flagged", overCapacity(withItems([pack, ingots]), pack));

// --- coin: a stack weighed by how many make a stone ---------------------------
// Core lumps every coin on the actor into one purse and counts it in WHOLE
// stones; the correction takes that figure back out and puts in what the purse
// weighs. Every rate here is this file's own — what a coin weighs is a printed
// figure, and none is stated in the repo.
const coinRow = (name, qty, over = {}) => {
  const flags = { ...(over.flags ?? {}), ...(over.perStone === undefined ? {} : { gear: { perStone: over.perStone } }) };
  return {
    id: over.id ?? name.replace(/\W/g, ""),
    name,
    type: "money",
    system: { coppervalue: 1, quantity: qty, quantitybank: over.bank ?? 0, description: over.description ?? "" },
    getFlag: (_m, k) => flags[k],
    effects: [],
  };
};
// The system's stand-in: whole stones, at forty coins to the stone.
const withPurse = (items) => {
  const a = withItems(items);
  const coins = items.filter((i) => i.type === "money").reduce((n, i) => n + i.system.quantity, 0);
  a.getTotalMoneyEncumbrance = () => ({ stone: Math.floor(coins / 40), item: 0 });
  return a;
};
check("no coin → no correction", encumbranceDelta6(withPurse([gear("Rope", 6)])) === 0);
check("whole stones of coin are what core already counted", encumbranceDelta6(withPurse([coinRow("Gold", 80, { perStone: 40 })])) === 0);
check("the part-stone core dropped is put back", encumbranceDelta6(withPurse([coinRow("Gold", 100, { perStone: 40 })])) === 3);
check("a purse under a stone still weighs", encumbranceDelta6(withPurse([coinRow("Gold", 10, { perStone: 40 })])) === 1.5);
check("two rows weigh what one stack of the same coins would",
  encumbranceDelta6(withPurse([coinRow("Gold", 13, { id: "g1", perStone: 40 }), coinRow("Silver", 7, { id: "s1", perStone: 40 })])) === 3);
check("a coin weighed at a rate of its own replaces core's figure for it", encumbranceDelta6(withPurse([coinRow("Trade Bar", 80, { perStone: 20 })])) === 24 - 12);
check("a banked balance weighs nothing", encumbranceDelta6(withPurse([coinRow("Gold", 80, { perStone: 40, bank: 4000 })])) === 0);
check("a coin nothing weighs leaves core's figure standing", encumbranceDelta6(withPurse([coinRow("Gold", 100)])) === 0);
check("one unweighed row leaves the whole purse to core",
  encumbranceDelta6(withPurse([coinRow("Gold", 100, { id: "g2", perStone: 40 }), coinRow("Token", 100, { id: "t2" })])) === 0);
check("coin in a container loads it, part-stones kept",
  contentsWeight6(withItems([pack, coinRow("Gold", 60, { perStone: 40, flags: { containedIn: "bp" } })]), "bp") === 9);

// The annotate pass reads a coin's rate off the coin's own sentence.
const { perStoneStated } = await import(new URL("profiles.mjs", S));
const coinSays = (description, name = "Coin") => perStoneStated({ name, system: { description } });
check("a coin's own sentence states how many make a stone", coinSays("<p>60 coins weigh one stone.</p>") === 60);
check("a thousands separator and a weight other than one stone are read", coinSays("1,200 gold pieces equal 2 stone") === 600);
check("the stone may stand bare, and the sentence may be the name", perStoneStated({ name: "Trade Token (25 pieces per stone)", system: {} }) === 25);
check("\"to the stone\" reads as one stone", coinSays("Struck at 90 coins to the stone.") === 90);
check("a coin that does not say states nothing", coinSays("<p>Stamped with a crowned head.</p>") === null);
check("a count against no stone is not a rate", coinSays("Worth 10 silver pieces.") === null);

// Adventurer's harness: relieves the wearer of the weight its own text states,
// drawn from ORDINARY gear (RR p. 142). The figure rides the item as
// `gear.relief`; the fixture states one stone. WORN VIA THE SLOT, because a
// harness is a plain `item` and core gives it no `equipped` field to be worn by.
const harness = gear("Adventurer's Harness", 1, { id: "h", wornAt: "belt", flags: { harness: true, gear: { relief: 1 } } });
const smalls = [gear("Flask A", 1, { id: "f1" }), gear("Flask B", 1, { id: "f2" }), gear("Torch", 1, { id: "f3" })];
check("harness ignores up to 1 stone (only 3/6 available -> -3)", encumbranceDelta6(withItems([harness, ...smalls])) === -3);
const manySmalls = Array.from({ length: 10 }, (_, i) => gear(`Item ${i}`, 1, { id: `s${i}` }));
check("harness caps its relief at exactly 1 stone", encumbranceDelta6(withItems([harness, ...manySmalls])) === -6);
check("harness cannot secure heavy items", encumbranceDelta6(withItems([harness, gear("Anvil", 12, { id: "an" })])) === 0);
const plateArm = { id: "pl", name: "Plate", type: "armor", system: { cost: 0, equipped: true, type: "heavy", ac: { value: 6 }, weight6: 36 }, getFlag: () => undefined, effects: [] };
check("harness gives nothing over heavy armour", encumbranceDelta6(withItems([harness, plateArm, ...smalls])) === 0);
// A light weapon hangs from the harness like any other small piece; a large
// one is heavy gear. A thrown weapon has left the body and is not relieved twice.
check("harness secures a light weapon", encumbranceDelta6(withItems([harness, weapon("Dagger", { melee: true, id: "dg", w6: 1 })])) === -1);
check("harness cannot secure a two-handed sword", encumbranceDelta6(withItems([harness, weapon("Two-Handed Sword", { melee: true, id: "ths0", w6: 6 })])) === 0);
check("harness does not count a thrown-away weapon", encumbranceDelta6(withItems([harness, weapon("Dagger", { melee: true, id: "dg2", w6: 1, flags: { thrownAway: true } })])) === -1);
// The figure is the item's, never a constant: unstated secures nothing, and a
// half-stone harness caps at its own half.
const mute = gear("Adventurer's Harness", 1, { id: "h0", wornAt: "belt", flags: { harness: true } });
check("a harness with no stated relief secures nothing", encumbranceDelta6(withItems([mute, ...smalls])) === 0);
const half = gear("Adventurer's Harness", 1, { id: "h5", wornAt: "belt", flags: { harness: true, gear: { relief: 0.5 } } });
check("the relief is the item's own figure", encumbranceDelta6(withItems([half, ...manySmalls])) === -3);

// Bowquiver: a loaded assembly counts as the figure its own text states
// (`gear.loaded6`; INVENTED here), not quiver + bow + arrows. An empty one is
// its own weight, and one that states no figure stays the plain sum.
const quiver = gear("Bowquiver", 1, { id: "bq", flags: { bowquiver: true, container: { capacity: 1 }, gear: { loaded6: 3 } } });
const cbow = gear("Composite Bow", 6, { id: "cb", type: "weapon", flags: { containedIn: "bq" } });
const arrows = gear("Quiver, 20 Arrows", 1, { id: "ar", flags: { containedIn: "bq" } });
check("loaded bowquiver counts as its stated figure, not the sum (delta 3 - 8)", encumbranceDelta6(withItems([quiver, cbow, arrows])) === -5);
check("empty bowquiver is its own weight (delta 0)", encumbranceDelta6(withItems([quiver])) === 0);
const mutedQuiver = gear("Bowquiver", 1, { id: "bq0", flags: { bowquiver: true, container: { capacity: 1 } } });
const cbow0 = gear("Composite Bow", 6, { id: "cb0", type: "weapon", flags: { containedIn: "bq0" } });
check("a loaded bowquiver whose text states no figure stays the plain sum", encumbranceDelta6(withItems([mutedQuiver, cbow0])) === 0);

// Nesting rolls up; a self-referencing pair must not hang the sheet.
const sack = gear("Small Sack", 1, { id: "sk", flags: { container: { capacity: 2 }, containedIn: "bp" } });
const inSack = gear("Gems", 3, { id: "gm", flags: { containedIn: "sk" } });
check("nested container rolls up into its parent", contentsWeight6(withItems([pack, sack, inSack]), "bp") === 4);
const loopA = gear("Loop A", 1, { id: "la", flags: { container: {}, containedIn: "lb" } });
const loopB = gear("Loop B", 1, { id: "lb", flags: { container: {}, containedIn: "la" } });
check("self-referencing containers do not hang", contentsWeight6(withItems([loopA, loopB]), "la") >= 0);


// Container profiles must match core's REAL item names in acks-adventuring-
// equipment (we annotate those in place rather than duplicating them).
const { gearProfileFor } = await import(new URL("config.mjs", S));
// The names below state INVENTED capacities: a profile never reads one.
check("backpack profile from core's name, which states a capacity the profile never reads", gearProfileFor("Backpack (holds 11 stone)").holds === true && !("capacity" in gearProfileFor("Backpack (holds 11 stone)")));
check("rucksack, large sack and saddlebag hold gear and carry no figure", ["Rucksack (holds 12 stone)", "Sack, Large (holds 13 stone)", "Saddlebag (holds 14 stone)"].every((n) => gearProfileFor(n).holds === true && !("capacity" in gearProfileFor(n))));
check("adventurer's harness profile flags the harness rule", gearProfileFor("Adventurer's Harness").harness === true);
check("bowquiver profile flags the 2-item rule", gearProfileFor("Bowquiver").bowquiver === true);
check("a sword is not a container", gearProfileFor("Sword") === null);

// Where gear sits. RAW gives a slot one job — you cannot wear two of the same
// (TT Miscellaneous Magic Item Form) — so these are guesses the item sheet can
// correct, and the test pins the ones that carry a rule.
const { inferGear, inferredGearFlag } = await import(new URL("profiles.mjs", S));
const clothing = (name) => ({ name, type: "item", system: { cost: 0, weight6: 0, subtype: "clothing" }, getFlag: () => undefined });
const goods = (name) => ({ name, type: "item", system: { cost: 0, weight6: 1, subtype: "item" }, getFlag: () => undefined });
check("the harness rides the belt and is free to reach (RR pp293-294)", inferGear(goods("Adventurer's Harness")).slots.join() === "belt" && inferGear(goods("Adventurer's Harness")).access === "free");
check("a backpack rides the back and costs an action to open", inferGear(goods("Backpack (holds 11 stone)")).slots.join() === "back" && inferGear(goods("Backpack (holds 11 stone)")).access === "action");
check("a belt pouch and a quiver are free; a sack is not", inferGear(goods("Pouch/Purse (holds 1/3 stone)")).access === "free" && inferGear(goods("Quiver, 20 Arrows")).access === "free" && inferGear(goods("Sack, Small (holds 12 stone)")).access === "action");
check("a belt pouch by the name a Judge types is the pouch, not a belt — and does not hold gear on its own",
  inferGear(goods("Belt Pouch")).slots.join() === "belt" && inferGear(goods("Belt Pouch")).access === "free"
  && inferGear(goods("Belt Pouch")).holds === false && !gearProfileFor("Purse").holds);
// What a harness secures is read off the item's own text, in stone, fractions
// included; a harness that says nothing states nothing.
const described = (text) => ({ ...goods("Adventurer's Harness"), system: { ...goods("").system, description: text } });
check("a harness states its relief in its own description", inferGear(described("<p>Straps and sheaths. Wearing it you may ignore 1 stone of small gear.</p>")).relief === 1);
check("a fractional relief reads as a fraction", inferGear(described("Light rigging: ignores 1/2 stone of gear.")).relief === 0.5);
// A bowquiver's loaded count is read the same way, from the sentence that sets
// the assembly against a count of items; the digit here is INVENTED.
const bowText = (text) => ({ ...goods("Bowquiver"), system: { ...goods("").system, description: text } });
check("a bowquiver states what a loaded assembly counts as, from its description", inferGear(bowText("<p>It rests securely with its bow. An empty one counts as 1 item, while one with a bow and arrows counts as 5 items.</p>")).loaded6 === 5);
check("a bowquiver that says nothing states no loaded count; a pack never does",
  inferGear(goods("Bowquiver")).loaded6 === null && inferGear(bowText("An empty one counts as 1 item for encumbrance.")).loaded6 === null && inferGear({ ...goods("Backpack (holds 11 stone)"), system: { ...goods("").system, description: "with a bow counts as 5 items" } }).loaded6 === null);
check("a silent harness states no relief", inferGear(goods("Adventurer's Harness")).relief === null && inferGear(goods("Backpack (holds 11 stone)")).relief === null);
check("a barrel holds things but is worn nowhere", inferGear(goods("Barrel (19 gallon)")).slots.length === 0 && gearProfileFor("Barrel (19 gallon)").holds === true);
check("inference says a container holds gear and never how much", inferGear(goods("Backpack (holds 11 stone)")).holds === true && !("capacity" in inferGear(goods("Backpack (holds 11 stone)"))) && inferGear(goods("Rope, 50'")).holds === false);
check("inferred flag declares holds and no capacity", JSON.stringify(inferredGearFlag(goods("Backpack (holds 11 stone)"))) === JSON.stringify({ slots: ["back"], access: "action", holds: true }));
// A garment gets NO capacity guessed for it: whether a coat has usable pockets
// is a ruling about that coat, not something its name can be read for.
check("no capacity is invented for a garment", inferGear(clothing("Cloak, Silk, Hooded")).holds === false && !("capacity" in inferGear(clothing("Cloak, Silk, Hooded"))));

// A device sold WITH its load is the ammunition, not somewhere to put it. It
// keeps where it rides and what it costs to draw from — both facts about the
// quiver — and loses the capacity that showed a full one as "0 / 1 st, empty".
const { bundledAmmoCount } = await import(new URL("config.mjs", S));
check("a loaded quiver keeps its belt slot and free draw",
  inferGear(goods("Quiver, 20 Arrows")).slots.join() === "belt" && inferGear(goods("Quiver, 20 Arrows")).access === "free");
check("a loaded quiver is not a container", inferGear(goods("Quiver, 20 Arrows")).holds === false);
check("a loaded bolt case is not a container", inferGear(goods("Case, 20 Bolts")).holds === false);
check("the load is read off the name so the tracker can spend it",
  bundledAmmoCount("Quiver, 20 Arrows") === 20 && bundledAmmoCount("Case, 20 Bolts") === 20 && bundledAmmoCount("30 Sling Stones") === 30);
// "holds N stone" is a capacity, and `stone` is also what a sling throws — the
// packs must not read as bundles of shot and stop being containers.
check("a pack that HOLDS stone is still a container",
  bundledAmmoCount("Backpack (holds 11 stone)") === null && inferGear(goods("Backpack (holds 11 stone)")).holds === true);
check("an ordinary item carries no load", bundledAmmoCount("Rope, 50'") === null);

// Clothing that no named slot claims is still worn. The structural test reads
// `system.subtype`, which nothing sets on an item built from a book's starting
// equipment list — so a robe was unwearable while boots from the same printed
// line were fine, purely on which words had patterns.
check("a robe is worn", inferGear(goods("Blue robe with crescents")).slots.join() === "worn");
check("a tunic is worn", inferGear(goods("Homespun tunic")).slots.join() === "worn");
check("boots still beat the garment rule to the feet", inferGear(goods("Low boots")).slots.join() === "feet");
check("a leather belt is still belt-worn", inferGear(goods("Leather belt")).slots.join() === "belt");
check("goods that are not garments are worn nowhere",
  inferGear(goods("Waterskin")).slots.length === 0 && inferGear(goods("1 week's iron rations")).slots.length === 0);

// Capacity is a property of gear, so a coat with hidden pockets is a container
// exactly as a sack is — which is the whole point of moving it off the
// container record.
const { capacityStone } = await import(new URL("containers.mjs", S));
const { encumbering6 } = await import(new URL("../lib/item-model.mjs", S));
const pocketCoat = gear("Coat, Travelling", 1, { id: "coat", subtype: "clothing", flags: { gear: { slots: ["worn"], wornAt: "worn", capacity: 0.5 } } });
const hiddenBlade = gear("Knife", 1, { id: "kn", flags: { containedIn: "coat" } });
const coatActor = withItems([pocketCoat, hiddenBlade]);
check("a coat with pockets is a container", isContainer(pocketCoat) === true);
check("...with a real capacity", capacityStone(pocketCoat) === 0.5);
check("...and reports its load", contentsWeight6(coatActor, "coat") === 1);
// The garment itself is weightless to core (clothing is excluded from
// encumbrance) but WHAT IS IN IT is not — contents are ordinary items on the
// actor, so acks-formation keeps reading a load that includes them.
check("gear in a pocket still weighs on the carrier", encumbering6(hiddenBlade) === 1 && encumbering6(pocketCoat) === 0);
check("a plain garment is still not a container", isContainer(gear("Chiton", 1, { id: "ch", subtype: "clothing" })) === false);
check("garments land on the body part they name", inferGear(clothing("Cloak, Silk, Hooded")).slots.join() === "shoulders" && inferGear(clothing("Boots, Leather, High")).slots.join() === "feet" && inferGear(clothing("Gloves, Leather or Wool, Long")).slots.join() === "hands" && inferGear(clothing("Belt/Sash, Leather")).slots.join() === "belt" && inferGear(clothing("Skullcap")).slots.join() === "head");
check("unpatterned clothing is simply worn", inferGear(clothing("Chiton, Linen or Wool")).slots.join() === "worn" && inferGear(clothing("Loincloth")).slots.join() === "worn");
check("a plural names its place too", inferGear(clothing("Belts")).slots.join() === "belt" && inferGear(clothing("Silk sashes")).slots.join() === "belt");
check("a cap, a turban and a head dress go on the head",
  ["Cap", "Turban", "Gossamer head dress"].every((n) => inferGear(clothing(n)).slots.join() === "head"));
check("a garment named with what it carries is that garment",
  inferGear(clothing("Grey cassock with hood")).slots.join() === "worn" && inferGear(clothing("Cloak with hood")).slots.join() === "shoulders"
  && inferGear(clothing("Belt embossed with tooth marks")).slots.join() === "belt");

// Gear nobody annotated declares nothing, and the Wear control and the wear
// action read the inferred place for it; a declaration, even of nowhere, wins.
const { wearableSlots } = await import(new URL("profiles.mjs", S));
const { wearItem } = await import(new URL("actions.mjs", S));
const wearable = (name, gearFlag) => {
  const writes = [];
  const flags = gearFlag ? { "acks-extras": { gear: gearFlag } } : {};
  return { name, type: "item", system: { cost: 0, weight6: 0, subtype: "clothing" }, flags, getFlag: (_m, k) => flags["acks-extras"]?.[k], update: async (d) => void writes.push(d), writes };
};
check("an unannotated leather belt is wearable at the belt", wearableSlots(wearable("Leather belt")).join() === "belt");
check("a declaration of nowhere stays nowhere", wearableSlots(wearable("Leather belt", { slots: [] })).length === 0);
check("a declared place outranks the name", wearableSlots(wearable("Leather belt", { slots: ["worn"] })).join() === "worn");
const bareBelt = wearable("Leather belt");
check("wearing an unannotated belt declares it and puts it on in one write",
  (await wearItem(bareBelt, "belt")) === true && bareBelt.writes.length === 1
  && JSON.stringify(bareBelt.writes[0]["flags.acks-extras.gear"]) === JSON.stringify({ slots: ["belt"], access: "", wornAt: "belt" }));
const misplaced = wearable("Leather belt");
check("a place the name does not give is refused, and nothing is written", (await wearItem(misplaced, "head")) === false && misplaced.writes.length === 0);
const typedCapacity = wearable("Leather belt", { capacity: 0.5 });
await wearItem(typedCapacity, "belt");
check("a capacity already on the flag survives the declaration", typedCapacity.writes[0]?.["flags.acks-extras.gear"]?.capacity === 0.5);
check("cloth sold by the pound is goods, not a garment", inferGear(clothing("Linen, Cheap (1 lb)")).slots.length === 0 && inferGear(clothing("Silk (1 lb)")).slots.length === 0);
check("rations, tools and rope are worn nowhere", inferGear(goods("Rations, Standard (one week)")).slots.length === 0 && inferGear(goods("Thieves' Tools")).slots.length === 0 && inferGear(goods("Rope, 50'")).slots.length === 0);
const gearHelm = { name: "Great Helm", type: "armor", system: { cost: 0, weight6: 1, type: "medium" }, getFlag: () => undefined };
const gearSuit = { name: "Plate", type: "armor", system: { cost: 0, weight6: 36, type: "heavy" }, getFlag: () => undefined };
const gearShield = { name: "Shield", type: "armor", system: { cost: 0, weight6: 6, type: "shield" }, getFlag: () => undefined };
check("a helmet goes on the head and a suit on the body", inferGear(gearHelm).slots.join() === "head" && inferGear(gearSuit).slots.join() === "body");
check("a shield declares both of its RAW places", inferGear(gearShield).slots.join() === "offHand,strapped");
check("a weapon declares the hands", inferGear({ name: "Sword", type: "weapon", system: { cost: 0, weight6: 6 }, getFlag: () => undefined }).slots.join() === "mainHand,offHand,bothHands");


// --- Phase 5b: item loss from damage (JJ p. 398) ------------------------------
SETTINGS_STATE.overlayItemLoss = true;
const { stonesAtRisk, isVulnerable, materialOf, planItemLoss, itemLossFigures, itemLossMaterials, itemLossFact, lossClassOf, LOSS_ORDER_FRONT, LOSS_ORDER_REAR } =
  await import(new URL("overlays/item-loss.mjs", S));
const { applyItemLoss, planMarkup, ITEM_LOSS_DAMAGE_TYPES } = await import(new URL("item-loss-flow.mjs", S));
const { DAMAGE_TYPES: VOCAB_DAMAGE_TYPES } = await import(new URL("../lib/vocab.mjs", S));

// Every figure below is INVENTED; nothing here is a printed value. The
// threshold is -7 with a step of 5, a layer of clothing counts 3 stone, light
// ends at 2 stone and heavy begins at 4, and a full stone costs 2 AC.
const LOSS_FIGURES = { threshold: -7, step: 5, clothingStones: 3, lightMax: 2, heavyMin: 4, acPerStone: 2 };
const LOSS_MATERIALS = {
  fire: ["cloth", "leather", "wood", "combustibles"],
  piercing: ["glass"],
  poisonous: [],
  electrical: ["metal", "combustibles"],
};
const lossTables = { id: "equipment", tables: { itemLoss: LOSS_FIGURES, itemLossMaterials: Object.fromEntries(Object.entries(LOSS_MATERIALS).map(([k, v]) => [k, { materials: v }])) } };
const lossActor = () => withItems([]);

// Nothing imported: every reader answers null and the plan does nothing.
check("without the import every figure reads null", Object.values(itemLossFigures()).every((v) => v === null) && itemLossMaterials() === null);
check("without the import the loss count is null, not zero", stonesAtRisk(-40, itemLossFigures()) === null);
check("without the import a material's fate is null, not 'unharmed'", isVulnerable("cloth", "fire") === null);
const unreadPlan = planItemLoss(lossActor(), { handShields: [], armor: null }, { hp: -40, damageType: "fire" });
check("without the import the plan is not ready, destroys and damages nothing, and names what to import",
  unreadPlan.ready === false && unreadPlan.destroyed.length === 0 && unreadPlan.damaged.length === 0 && unreadPlan.stones === 0
  && ["threshold", "step", "clothingStones", "lightMax", "heavyMin", "acPerStone", "itemLossMaterials"].every((m) => unreadPlan.missing.includes(m)));
check("without the import the Durability tab's item-loss fact says not imported", itemLossFact(gear("Spear", 6))?.state === "notImported");
SETTINGS_STATE.overlayItemLoss = false;
check("with the overlay off the Durability tab shows no item-loss fact", itemLossFact(gear("Spear", 6)) === null);
SETTINGS_STATE.overlayItemLoss = true;

registerTable(lossTables, { priority: PRIORITY.WORLD, source: "test" });
check("the figures read back from the imported table", JSON.stringify(itemLossFigures()) === JSON.stringify(LOSS_FIGURES));
check("no loss above the imported threshold", stonesAtRisk(-6, LOSS_FIGURES) === 0 && stonesAtRisk(0, LOSS_FIGURES) === 0);
check("the threshold risks 1 stone; each further step risks another", stonesAtRisk(-7, LOSS_FIGURES) === 1 && stonesAtRisk(-11, LOSS_FIGURES) === 1 && stonesAtRisk(-12, LOSS_FIGURES) === 2 && stonesAtRisk(-17, LOSS_FIGURES) === 3);
check("rear order is the exact reverse of the front order", LOSS_ORDER_REAR.join() === [...LOSS_ORDER_FRONT].reverse().join());
check("the Durability fact classes an item against the imported bounds", lossClassOf(12, LOSS_FIGURES) === "destroyed" && lossClassOf(24, LOSS_FIGURES) === "damaged" && lossClassOf(18, LOSS_FIGURES) === "unplaced" && lossClassOf(6, {}) === null);
check("an item's item-loss fact is its class against the weights", itemLossFact(gear("Spear", 6)).state === "destroyed" && itemLossFact(gear("Wall", 30)).state === "damaged" && itemLossFact(gear("Odd Chest", 18)).state === "unplaced");

// The materials table is the import's: a fire row burns cloth and combustibles
// (plural, folded), a poisonous row that read empty harms nothing, and a type
// whose row did not read answers null.
check("the imported fire row harms cloth and leather, not metal", isVulnerable("cloth", "fire") === true && isVulnerable("leather", "fire") === true && isVulnerable("metal", "fire") === false);
check("a printed plural is one word with the singular", isVulnerable("combustible", "fire") === true && isVulnerable("combustible", "piercing") === false);
check("a row that read empty harms nothing, which is not the same as unread", isVulnerable("cloth", "poisonous") === false && isVulnerable("cloth", "seismic") === null);
check("the electrical key is the vocabulary's", isVulnerable("metal", "electrical") === true && isVulnerable("metal", "electric") === null);
check("the damage types the flow asks about are the vocabulary's, less the one that defers to the weapon",
  ITEM_LOSS_DAMAGE_TYPES.includes("electrical") && !ITEM_LOSS_DAMAGE_TYPES.includes("electric") && !ITEM_LOSS_DAMAGE_TYPES.includes("varies")
  && ITEM_LOSS_DAMAGE_TYPES.length === Object.keys(VOCAB_DAMAGE_TYPES).length - 1);
check("material guessed from name (oil = combustible, holy water = good)", materialOf(gear("Oil, Military", 1)) === "combustible" && materialOf(gear("Holy Water", 1)) === "good");
check("explicit material flag beats the guess", materialOf(gear("Odd Thing", 1, { flags: { material: "glass" } })) === "glass");

// A fireball at the invented -17 hp risks 3 stone; fire cannot touch a metal
// flask, so it is skipped rather than consuming the budget.
const jjShield ={ id: "sh", name: "Shield", type: "armor", system: { cost: 0, equipped: true, type: "shield", ac: { value: 1 }, weight6: 6 }, getFlag: (_m, k) => ({ material: "wood" }[k]), effects: [] };
const jjSpear = gear("Spear", 6, { id: "sp", type: "weapon", flags: { material: "wood" } });
const jjHolyWater = gear("Holy Water", 1, { id: "hw", flags: { material: "metal" } });
const jjOil = gear("Oil, Military", 1, { id: "oil" });
const jjActor = withItems([jjShield, jjSpear, jjHolyWater, jjOil]);
const jjLo = { handShields: [jjShield], armor: null };
const plan = planItemLoss(jjActor, jjLo, { hp: -17, damageType: "fire" });
check("a fireball at -17 hp risks 3 stone", plan.ready && plan.stones === 3);
check("wooden shield in hand is destroyed first (front order)", plan.destroyed[0].item.id === "sh");
check("metal holy-water flask is skipped by fire, not destroyed", !plan.destroyed.some((d) => d.item.id === "hw") && plan.survivors >= 1);
check("the wooden spear burns too", plan.destroyed.some((d) => d.item.id === "sp"));

// Damaged from the rear the order flips: the shield in hand is now last.
const rearPlan = planItemLoss(jjActor, jjLo, { hp: -7, damageType: "fire", fromRear: true });
check("from the rear the shield is not the first thing lost", rearPlan.destroyed[0]?.item.id !== "sh");

// Poison destroys nothing regardless of how far below the threshold the victim is.
check("poison at -30 hp destroys nothing", planItemLoss(jjActor, jjLo, { hp: -30, damageType: "poisonous" }).destroyed.length === 0);

// The split: a light item (<= 2 st) is destroyed, a heavy one (>= 4 st) takes
// the budget that is left, up to its own weight, and loses AC per full stone.
const heavyMail = armor("Mail", "medium", { id: "mail", ac: 5, w6: 24, flags: { material: "leather" } });
const splitActor = withItems([jjShield, jjSpear, heavyMail]);
const splitLo = { handShields: [jjShield], armor: heavyMail };
const split = planItemLoss(splitActor, splitLo, { hp: -22, damageType: "fire" });
check("a light item lands in destroyed and a heavy one in damaged", split.destroyed.map((d) => d.item.id).join() === "sh,sp" && split.damaged.length === 1 && split.damaged[0].item.id === "mail");
check("the heavy item takes what the light ones left of 4 stone: 2 full stones, 4 AC at 2 per stone", split.stones === 4 && split.damaged[0].damage6 === 12 && split.damaged[0].stones === 2 && split.damaged[0].acLost === 4);
const flask = gear("Oil, Military", 1, { id: "oilFlask" });
const sub = planItemLoss(withItems([flask, heavyMail]), { handShields: [], armor: heavyMail }, { hp: -7, damageType: "fire" });
check("a part of a stone of damage costs the heavy item no AC", sub.destroyed.length === 1 && sub.damaged[0].damage6 === 5 && sub.damaged[0].stones === 0 && sub.damaged[0].acLost === 0);
const shallow = planItemLoss(withItems([heavyMail]), { handShields: [], armor: heavyMail }, { hp: -7, damageType: "fire" });
check("a full stone of damage costs the imported AC per stone", shallow.damaged[0].stones === 1 && shallow.damaged[0].acLost === 2);
const partial = planItemLoss(withItems([heavyMail]), { handShields: [], armor: heavyMail }, { hp: -7, damageType: "fire", figures: { ...LOSS_FIGURES, lightMax: 1, heavyMin: 2 }, materials: { fire: ["leather"] } });
check("a plan takes its figures and table as arguments", partial.ready && partial.damaged[0].item.id === "mail");
const oddChest = gear("Odd Chest", 18, { id: "chest", flags: { material: "wood" } });
const between = planItemLoss(withItems([oddChest]), { handShields: [], armor: null }, { hp: -7, damageType: "fire" });
check("a weight between the bounds is unplaced, spends nothing and changes nothing", between.unplaced.length === 1 && between.destroyed.length === 0 && between.damaged.length === 0);
const garment = gear("Tunic", 1, { id: "tn", subtype: "clothing", flags: { material: "cloth" } });
const clothed = planItemLoss(withItems([garment]), { handShields: [], armor: null }, { hp: -7, damageType: "fire" });
check("a layer of clothing counts as the imported number of stone, whatever its listed weight", clothed.destroyed.length + clothed.unplaced.length + clothed.damaged.length === 1 && (clothed.destroyed[0] ?? clothed.damaged[0] ?? clothed.unplaced[0]).weight6 === 18);
const hook = gear("Hook", 6, { id: "hook", flags: { material: "metal" } });
const electrical = planItemLoss(withItems([heavyMail, oddChest, hook]), { handShields: [], armor: heavyMail }, { hp: -7, damageType: "electrical" });
check("electrical reaches metal and not leather or wood", electrical.ready && electrical.survivors === 1 && electrical.damaged.length === 0 && electrical.destroyed.map((d) => d.item.id).join() === "hook");
check("a damage type whose row is unread plans nothing and names the row", planItemLoss(splitActor, splitLo, { hp: -22, damageType: "seismic" }).missing.join() === "itemLossMaterials.seismic");

// Applying the plan writes the item's own condition: a light item is marked
// destroyed, a heavy armour loses AC on its one condition record.
const lossDoc = (name, ac, weight6) => ({
  id: name, type: "armor", name, system: { ac: { value: ac }, weight6, cost: 0 }, _flags: {},
  getFlag(_m, k) { return this._flags[k]; },
  async setFlag(_m, k, v) { this._flags[k] = v; },
  async unsetFlag(_m, k) { delete this._flags[k]; },
  async update(u) {
    for (const [path, v] of Object.entries(u)) {
      if (path.startsWith("flags.acks-extras.")) this._flags[path.slice("flags.acks-extras.".length)] = v;
      else if (path === "system.ac.value") this.system.ac.value = v;
      else if (path === "system.weight6") this.system.weight6 = v;
      else if (path === "system.cost") this.system.cost = v;
    }
  },
});
const wornMail = lossDoc("Mail", 5, 24);
const wornShield = lossDoc("Shield", 1, 6);
const applied = await applyItemLoss({ ready: true, destroyed: [{ item: wornShield }], damaged: [{ item: wornMail, acLost: 4 }, { item: wornShield, acLost: 0 }] });
check("applying marks a light item destroyed", wornShield._flags.destroyed === true && applied.destroyed === 1);
check("applying takes AC off the heavy armour into its own item-loss layer", wornMail.system.ac.value === 1 && wornMail._flags.itemLossAc === 4 && wornMail._flags.scavenged === undefined && applied.acLost === 4 && applied.damaged === 1);
await applyItemLoss({ ready: true, destroyed: [], damaged: [{ item: wornMail, acLost: 2 }] });
check("a second loss adds to the same layer rather than replacing it", wornMail._flags.itemLossAc === 6 && wornMail.system.ac.value === 0);
await clearScavenged(wornMail);
check("clearing the scavenged condition leaves the item-loss AC", wornMail.system.ac.value === 0 && wornMail._flags.itemLossAc === 6);
check("an unready plan writes nothing", (await applyItemLoss({ ready: false, destroyed: [{ item: wornMail }], damaged: [] })).applied === false && wornMail._flags.destroyed === undefined);
SETTINGS_STATE.overlayItemLoss = false;
check("with the overlay off applying refuses", (await applyItemLoss({ ready: true, destroyed: [{ item: wornMail }], damaged: [] })).reason === "off" && wornMail._flags.destroyed === undefined);
SETTINGS_STATE.overlayItemLoss = true;

const card = planMarkup(split, { damageType: "electrical", fromRear: false, figures: LOSS_FIGURES });
check("the card names every item and carries a tooltip per figure", /Spear/.test(card) && /Mail/.test(card) && (card.match(/data-tooltip-text/g) ?? []).length >= 4);
unregisterTable("equipment", { priority: PRIORITY.WORLD });
check("with the import removed the plan is not ready again", planItemLoss(splitActor, splitLo, { hp: -22, damageType: "fire" }).ready === false);
SETTINGS_STATE.overlayItemLoss = false;


// --- Phase 5b: scavenged equipment (RR p. 160) --------------------------------
const { tableFor, lookup, accumulate, needsReroll, toItemUpdates, SCAVENGED_CAPS } =
  await import(new URL("overlays/scavenged.mjs", S));

check("bludgeoning weapons use their own table", tableFor(weapon("Mace", { melee: true }), { type: "bludgeoning" }) === "bludgeoning");
check("swords use the piercing/slashing table", tableFor(weapon("Sword", { melee: true }), { type: "slashing" }) === "piercingSlashing");
check("armour uses the armour/equipment table", tableFor(armor("Plate", "heavy"), {}) === "armourEquipment");
check("1-2 is serviceable at full value", lookup("piercingSlashing", 1).value === 1);
check("19-20 means roll again twice", needsReroll("piercingSlashing", 19) && needsReroll("piercingSlashing", 20) && !needsReroll("piercingSlashing", 5));

// RR's worked example: a scavenged sword rolls 19 (reroll), then 7 and 15 —
// rusty blade (-1 damage) and loose hilt (-1 initiative), value 66% of normal.
const ex = accumulate("piercingSlashing", [19, 7, 15]);
check("RR example: rusty + loose hilt -> -1 damage, -1 initiative", ex.damage === -1 && ex.initiative === -1);
check("RR example: value falls to ~66% (0.67 x 0.67)", Math.round(ex.valueMultiplier * 100) === 45 || Math.round((1 - ex.valueMultiplier) * 100) >= 33);
check("the reroll row itself contributes no penalty", !ex.labels.includes("Roll again twice"));

// Effects are cumulative but capped: attack/AC never worse than -5.
const stacked = accumulate("piercingSlashing", [11, 11, 11, 11, 11, 11, 11]);
check("attack penalty capped at -5", stacked.attack === SCAVENGED_CAPS.attack);

// Reuse first: results become updates to fields CORE already owns.
const upd = toItemUpdates(weapon("Sword", { melee: true, damage: "1d6" }), accumulate("piercingSlashing", [7]));
check("-1 damage becomes a core damage string '1d6-1'", upd["system.damage.base.formula"] === "1d6-1");
const updA = toItemUpdates(armor("Plate", "heavy", { ac: 6 }), accumulate("armourEquipment", [11]));
check("-1 AC becomes a core aac.value", updA["system.ac.value"] === 5);
const updE = toItemUpdates(armor("Plate", "heavy", { ac: 6 }), accumulate("armourEquipment", [3]));
check("+1 stone becomes core weight6 (+6 units)", updE["system.weight6"] === 6);
check("breaks/cannotSneak recorded as a flag for the Judge", toItemUpdates(armor("Plate", "heavy", { ac: 6 }), accumulate("armourEquipment", [7]))["flags.acks-extras.scavenged"].cannotSneak === true);


// --- Class training chunks (JJ p. 290-291) ------------------------------------
const { grantMatches } = await import(new URL("proficiency.mjs", S));

const pAxe = classifyWeapon(weapon("Battle Axe", { melee: true }));
const pSword = classifyWeapon(weapon("Sword", { melee: true }));
const pGreat = classifyWeapon(weapon("Two-Handed Sword", { melee: true }));
const pBow = classifyWeapon(weapon("Long Bow", { missile: true, melee: false }));
const pDagger = classifyWeapon(weapon("Dagger", { melee: true }));

check("token 'all' grants everything", grantMatches("all", pAxe) && grantMatches("all", pBow));
check("category token matches its category only", grantMatches("axe", pAxe) && !grantMatches("axe", pSword));
check("broad (v) missile:all grants every missile weapon", grantMatches("missile:all", pBow) && !grantMatches("missile:all", pSword));
check("broad (i) melee:medium matches a sword, not a great sword", grantMatches("melee:medium", pSword) && !grantMatches("melee:medium", pGreat));
check("broad (ii) melee:large matches a great sword", grantMatches("melee:large", pGreat));
check("restricted list grants a single named weapon", grantMatches("dagger", pDagger) && !grantMatches("dagger", pSword));

const narrowAxes = actor([], { effects: [marker("weaponProf", "axe")] });
check("a training chunk alone drives proficiency (axe yes, sword no)", isWeaponProficient(narrowAxes, pAxe) && !isWeaponProficient(narrowAxes, pSword));
check("un-configured character stays permissive", isWeaponProficient(actor([]), pAxe));
const broadThief = actor([], { effects: [marker("weaponProf", "melee:tiny,melee:small,melee:medium"), marker("weaponProf", "missile:all")] });
check("JJ thief broad selection: medium melee + all missile, not great swords", isWeaponProficient(broadThief, pSword) && isWeaponProficient(broadThief, pBow) && !isWeaponProficient(broadThief, pGreat));

// The abilities sheet's weapon-proficiency boxes STORE these tokens: every key
// it offers (Unarmed aside, which is no weapon grant) must be a kind this
// grammar resolves, or a ticked box would be a pick that grants nothing.
const { SELECTION_VOCAB, selectionOptions } = await import(new URL("../scripts/lib/vocab.mjs", import.meta.url));
const boxKinds = selectionOptions(SELECTION_VOCAB.weaponProficiency).filter(([k]) => k !== "unarmed").map(([k]) => classifyGrantToken(k));
check("every weapon-proficiency box is a grant token this grammar resolves",
  boxKinds.length >= 12 && boxKinds.every((k) => k && k !== "unknown" && k !== "weapon"));

// The strips read the same picks at class granularity, through one resolver.
const { profileStrips, weaponTokenClasses } = await import(new URL("../scripts/lib/proficiency-strip.mjs", import.meta.url));
check("weaponTokenClasses: missile:all lights the missile classes only",
  (() => { const c = weaponTokenClasses("missile:all"); return c.includes("bowcrossbow") && c.includes("other") && !c.includes("axe"); })());
check("weaponTokenClasses: a size clause lights every melee class",
  (() => { const c = weaponTokenClasses("melee:small"); return c.includes("axe") && c.includes("sworddagger") && c.includes("other") && !c.includes("bowcrossbow"); })());
check("weaponTokenClasses: a named weapon lights the class it is filed under",
  weaponTokenClasses("dagger")[0] === "sworddagger" && weaponTokenClasses("dart")[0] === "spearpolearm");
check("weaponTokenClasses: a token nothing recognises covers no class", weaponTokenClasses("pointy stick").length === 0);

const savedAbilities = globalThis.acksExtras.abilities;
const savedEquipment = globalThis.acksExtras.equipment;
globalThis.acksExtras.abilities = {
  getExtras: (item) => item.flags?.["acks-extras"]?.extras ?? {},
  selectionsOf: (item) => item.flags?.["acks-extras"]?.extras?.selections ?? [],
};
try {
  const weaponsAbility = (selections) => ({
    id: "wp", name: "Weapons", type: "ability", system: {}, effects: [], getFlag: () => undefined,
    flags: { "acks-extras": { cookbook: { id: "def.prof.weaponProficiency" }, extras: { category: "weaponProficiency", selections } } },
  });
  const lit = (picks) => new Set(profileStrips(actor([weaponsAbility(picks)])).weapons.filter((w) => w.on).map((w) => w.key));
  check("strip: a broad missile + small-melee training lights every class", lit(["missile:all", "melee:tiny", "melee:small", "melee:medium"]).size === 7);
  const missile = lit(["all missile weapons", "dagger"]);
  check("strip: missile picks light the missile classes, a dagger its own, unarmed always",
    missile.has("bowcrossbow") && missile.has("other") && missile.has("sworddagger") && missile.has("unarmed")
    && !missile.has("axe") && !missile.has("flailhammermace") && !missile.has("spearpolearm"));
  const restricted = lit(["club", "dagger", "dart", "staff"]);
  check("strip: a restricted list lights the classes its weapons are filed under",
    restricted.has("other") && restricted.has("sworddagger") && restricted.has("spearpolearm") && !restricted.has("axe") && !restricted.has("bowcrossbow"));
  check("strip: an unrestricted pick lights everything", lit(["all"]).size === 7);

  // The proficiency gate honours the training an imported proficiency
  // states, read the way the pills read it: what the pill lights, the gate
  // passes, on top of a declared list; with no list it declares nothing.
  const proficiencyItem = (category, selections) => ({
    id: `p-${category}`, name: category, type: "ability", system: {}, effects: [], getFlag: () => undefined,
    flags: { "acks-extras": { extras: { category, selections } } },
  });
  const axeChunk = marker("weaponProf", "axe");
  const swordP2 = classifyWeapon(weapon("Sword", { melee: true }));
  const daggerP2 = classifyWeapon(weapon("Dagger", { melee: true }));
  const axeP2 = classifyWeapon(weapon("Battle Axe", { melee: true }));
  const withSwords = actor([proficiencyItem("weaponProficiency", ["swords"])], { effects: [axeChunk] });
  check("gate: a class pick the pill lights passes beside a declared list", isWeaponProficient(withSwords, swordP2) && isWeaponProficient(withSwords, daggerP2) && isWeaponProficient(withSwords, axeP2));
  check("gate: every weapon filed under a lit pill passes",
    lit(["swords"]).has("sworddagger") && Object.entries(FIXTURE_ROWS).filter(([, w]) => w.cat === "swordDagger").every(([k]) => isWeaponProficient(withSwords, classifyWeapon(weapon(k, { melee: true })))));
  const withDagger = actor([proficiencyItem("weaponProficiency", ["dagger"])], { effects: [axeChunk] });
  check("gate: a named weapon pick passes that weapon, not its whole class", isWeaponProficient(withDagger, daggerP2) && !isWeaponProficient(withDagger, swordP2));
  check("gate: without the imported pick the declared list alone refuses the sword", !isWeaponProficient(actor([], { effects: [axeChunk] }), swordP2));
  const onlyAbility = actor([proficiencyItem("weaponProficiency", ["axe"])]);
  check("gate: an imported pick with no declared list declares none", weaponProficiency(onlyAbility).all && isWeaponProficient(onlyAbility, swordP2));
  const swordHeld = weapon("Sword", { melee: true, id: "gs" });
  check("gate: the non-proficient use package is absent with the imported pick, present without",
    !getLoadout(actor([swordHeld, proficiencyItem("weaponProficiency", ["swords"])], { effects: [axeChunk] })).nonProficientUse
    && getLoadout(actor([swordHeld], { effects: [axeChunk] })).nonProficientUse);
  check("gate: imported armour training raises a declared cap",
    armorMax(actor([proficiencyItem("armorProficiency", ["medium"])], { effects: [marker("armourProficiency", "light")] })) === "medium");
  check("gate: imported armour training alone declares no cap", armorMax(actor([proficiencyItem("armorProficiency", ["light"])])) === "heavy");
  const { trainedStyles: stylesOf } = await import(new URL("loadout.mjs", S));
  check("gate: an imported fighting style trains that style",
    stylesOf(actor([proficiencyItem("fightingStyle", ["two-handed"])])).has("twohanded") && !stylesOf(actor([])).has("twohanded"));
} finally {
  globalThis.acksExtras.abilities = savedAbilities;
  globalThis.acksExtras.equipment = savedEquipment;
}

const lightClass = actor([], { effects: [marker("armourProficiency", "light")] });
check("armour chunk sets the cap", armorMax(lightClass) === "light");
const lightPlusTraining = actor([], { effects: [marker("armourProficiency", "light"), marker("armorTraining", "1")] });
check("Armour Training raises a chunk-granted cap light -> medium", armorMax(lightPlusTraining) === "medium");

const dualChunk = actor([weapon("Sword", { melee: true, id: "d1" }), weapon("Dagger", { melee: true, id: "d2" })], { effects: [marker("styleProficient", "dual")] });
const dualLo2 = getLoadout(dualChunk);
check("Fighting Style chunk trains the style (dual proficient)", dualLo2.activeStyle === "dual" && dualLo2.styleProficient);
check("single + missile are mandatory even with no chunks", getLoadout(actor([weapon("Sword", { melee: true, id: "z" })])).trainedStyles.has("single"));

// --- Named items (JJ p. 399) --------------------------------------------------
SETTINGS_STATE.overlayNamed = true;
const N = await import(new URL("overlays/named.mjs", S));
const namedRec = (over = {}) => ({
  trueName: "Fist of Iron", givenName: "Tooth-Breaker",
  ladder: ["damage", "hit", "damage", "hit", "damage", "hit"],
  unlocked: 1, revealed: false, guesses: {}, ...over,
});
const hammer = (over = {}) => ({
  id: "tb", name: over.name ?? "Tooth-Breaker", type: "weapon",
  system: { damage: "1d6", bonus: 0, equipped: true, weight6: 1 },
  getFlag: (_m, k) => (k === "named" ? namedRec(over.rec ?? {}) : undefined),
  effects: [],
});
const lvl = (n) => ({ id: "m", system: { details: { level: n } } });

check("first naming unlocks exactly one rung (+1 damage)", (() => { const b = N.unlockedBonuses(hammer()); return b.damage === 1 && b.hit === 0; })());
check("2nd rung follows the Judge ladder (+1 hit and damage)", (() => { const b = N.unlockedBonuses(hammer({ rec: { unlocked: 2 } })); return b.damage === 1 && b.hit === 1; })());
check("Tooth-Breaker at 6 rungs is the full +3/+3", (() => { const b = N.unlockedBonuses(hammer({ rec: { unlocked: 6 } })); return b.damage === 3 && b.hit === 3; })());
check("unlocked never exceeds the ladder length", N.unlockedCount(hammer({ rec: { unlocked: 99 } })) === 6);
check("revealed true name -> full power regardless of unlocked", (() => { const b = N.unlockedBonuses(hammer({ rec: { unlocked: 1, revealed: true } })); return b.damage === 3 && b.hit === 3; })());
check("true name match is case/space-insensitive", N.nameMatches(hammer(), "  fist of iron ") && !N.nameMatches(hammer(), "Tooth-Breaker"));
check("a character may guess once", N.canGuess(hammer(), lvl(3)));
check("a wrong guess locks that character out at their level", (() => { const r = N.resolveGuess(hammer(), lvl(3), "Wrong Name"); return r.allowed && !r.correct && r.updates["flags.acks-extras.named.guesses"].m === 3; })());
check("cannot guess again at the same level", !N.canGuess(hammer({ rec: { guesses: { m: 3 } } }), lvl(3)));
check("gaining a level allows another guess", N.canGuess(hammer({ rec: { guesses: { m: 3 } } }), lvl(4)));
check("correct guess reveals and renames the item to its true name", (() => { const r = N.resolveGuess(hammer(), lvl(3), "Fist of Iron"); return r.correct && r.updates.name === "Fist of Iron" && r.updates["flags.acks-extras.named.revealed"] === true; })());
check("re-naming renames the item and unlocks one rung", (() => { const u = N.renameUpdates(hammer({ rec: { unlocked: 0 } }), "Orcbiter", 1); return u.name === "Orcbiter" && u["flags.acks-extras.named.unlocked"] === 1; })());
check("level-up advances exactly one rung", N.advanceOnLevelUp(hammer({ rec: { unlocked: 2 } }))["flags.acks-extras.named.unlocked"] === 3);
check("a fully unlocked item does not advance further", N.advanceOnLevelUp(hammer({ rec: { unlocked: 6 } })) === null);
check("a revealed item does not advance (already full)", N.advanceOnLevelUp(hammer({ rec: { revealed: true } })) === null);
check("unlocked bonuses map onto core fields", (() => { const u = N.toItemUpdates(hammer({ rec: { unlocked: 6 } }), { bonus: 0, damage: "1d6" }); return u["system.bonus.attack"] === 3 && u["system.damage.base.formula"] === "1d6+3"; })());
SETTINGS_STATE.overlayNamed = false;


// Applying unlocked bonuses must be IDEMPOTENT: recomputed from the captured
// mundane base, so repeated level-ups cannot compound (+3 must never become +6).
SETTINGS_STATE.overlayNamed = true;
const basedHammer = (unlocked, equipped = true) => ({
  id: "tb2", name: "Tooth-Breaker", type: "weapon",
  system: { damage: "1d6+3", bonus: 3, equipped, weight6: 1 }, // already-modified values
  getFlag: (_m, k) => (k === "named" ? { trueName: "Fist of Iron", ladder: ["damage", "hit", "damage", "hit", "damage", "hit"], unlocked, revealed: false, guesses: {}, base: { bonus: 0, damage: "1d6", aac: 0, weight6: 1 } } : undefined),
  effects: [],
});
const reapplied = N.applyUpdates(basedHammer(6));
check("re-applying recomputes from base, never compounds", reapplied["system.bonus.attack"] === 3 && reapplied["system.damage.base.formula"] === "1d6+3");
check("captureBase records the mundane stats", (() => { const b = N.captureBase({ system: { bonus: 1, damage: "1d8", weight6: 6 } }); return b.bonus === 1 && b.damage === "1d8" && b.weight6 === 6; })());
check("renameUpdates captures the base on first naming", N.renameUpdates(hammer({ rec: { unlocked: 0 } }), "Orcbiter", 1)["flags.acks-extras.named.base"] !== undefined);

// A level-up advances only WIELDED named items, one rung, restating bonuses.
const adv = N.advanceWieldedOnLevelUp({ items: [basedHammer(2)], system: { details: { level: 4 } } });
check("level-up advances a wielded named item one rung", adv.length === 1 && adv[0].updates["flags.acks-extras.named.unlocked"] === 3);
check("advancement restates bonuses from base (3 rungs = +2 dmg, +1 hit)", adv[0].updates["system.damage.base.formula"] === "1d6+2" && adv[0].updates["system.bonus.attack"] === 1);
check("an unwielded named item does not advance", N.advanceWieldedOnLevelUp({ items: [basedHammer(2, false)], system: { details: { level: 4 } } }).length === 0);
SETTINGS_STATE.overlayNamed = false;


/* Weapon rows (keying, fields, readiness, the change hook): tools/test-weapon-rows.mjs */

// --- buildApi smoke test ------------------------------------------------------
// Actually building the api is the guard: `node --check` is syntax-only, and a
// name exposed but never imported throws only when buildApi() actually runs.
// namespace.mjs registers the single module.api assignment on init; capture
// the callbacks so the test can fire them the way Foundry would.
const initCallbacks = [];
globalThis.Hooks = globalThis.Hooks ?? {
  once: (name, fn) => {
    if (name === "init") initCallbacks.push(fn);
  },
  on: () => {},
  callAll: () => {},
};
const moduleStub = {};
globalThis.game.modules = { get: (id) => (id === "acks-extras" ? moduleStub : { active: false }) };
const { buildApi } = await import(new URL("api.mjs", S));
const api = buildApi();
check("buildApi() runs without throwing (every exposed symbol is imported)", !!api);
// module.api is the whole acksExtras namespace, not this one feature's api:
// eight features assigning their own would have left only the last visible.
// The assignment lives in namespace.mjs's init hook — fire it as Foundry would.
for (const fn of initCallbacks) fn();
check("buildApi attaches the feature to the shared namespace", globalThis.acksExtras.equipment === api);
check("module.api is the shared namespace, and the feature is on it", moduleStub.api === globalThis.acksExtras && moduleStub.api.equipment === api);
for (const fn of ["getLoadout", "containerReport", "contentsOf", "contentsWeight6", "overCapacity", "isContainer", "encumbranceDelta6", "planItemLoss", "maneuverMods", "annotateItem", "refreshLoadout"]) {
  check(`api.${fn} is defined`, typeof api[fn] === "function");
}
check("api.named namespace is present", typeof api.named?.resolveGuess === "function");

// Annotate declares a bundle it reads off the name and never touches the count:
// core initialises every count, so there is no blank one to fill, and a count
// written here would refill a half-spent quiver on the next pass.
{
  const GEAR_KEY = "flags.acks-extras.gear";
  const bundled = (qty, gearFlag) => {
    const flags = gearFlag ? { gear: { ...gearFlag } } : {};
    const it = { id: "qv" + qty, name: "Quiver, 20 Arrows", type: "item", system: { cost: 0, weight6: 1, quantity: { value: qty }, subtype: "item" }, flags: { "acks-extras": flags }, getFlag: (_m, k) => flags[k], effects: [], writes: [] };
    it.update = async (u) => { it.writes.push(u); };
    return it;
  };
  const wrote = (it, path) => it.writes.some((u) => path in u);
  const fresh = bundled(1);
  const freshKey = await api.annotateItem(fresh);
  check("a fresh bundle annotates to its bundle size", freshKey === "gear" && fresh.writes[0]?.[`${GEAR_KEY}.per`] === 20);
  check("annotate leaves a fresh bundle's count to core", !wrote(fresh, "system.quantity.value"));
  const spent = bundled(7, { slots: ["belt"], access: "free", capacity: null, per: 20 });
  await api.annotateItem(spent);
  check("a half-spent bundle keeps its count", !wrote(spent, "system.quantity.value"));
  check("a declared bundle size survives re-annotation",
    !wrote(spent, `${GEAR_KEY}.per`) && spent.writes.every((u) => u[GEAR_KEY]?.per === undefined));

  // Annotate fills only what an item leaves blank: a Judge's slots, capacity,
  // access and a weapon's size stand, since a later pass cannot tell its own
  // earlier answer from theirs.
  const doc = (name, type, gearFlag, system = {}) => {
    const flags = gearFlag ? { gear: { ...gearFlag } } : {};
    const it = { id: name.replace(/\W/g, ""), name, type, system: { cost: 0, weight6: 1, quantity: { value: 1 }, subtype: "item", ...system }, flags: { "acks-extras": flags }, getFlag: (_m, k) => flags[k], effects: [], writes: [] };
    it.update = async (u) => { it.writes.push(u); };
    return it;
  };
  const write = (it) => Object.assign({}, ...it.writes);
  const pack = doc("Backpack", "item", { slots: ["back"], capacity: 3 });
  await api.annotateItem(pack);
  check("annotate keeps a Judge's capacity and slots on a backpack", !(`${GEAR_KEY}.capacity` in write(pack)) && !(`${GEAR_KEY}.slots` in write(pack)) && !(GEAR_KEY in write(pack)));
  const cloak = doc("Cloak", "item", { slots: ["back"], capacity: 0.5, wornAt: "back" }, { subtype: "clothing" });
  await api.annotateItem(cloak);
  check("annotate keeps a garment's pockets and the place it is worn", !(`${GEAR_KEY}.capacity` in write(cloak)) && !(`${GEAR_KEY}.slots` in write(cloak)));
  const belt = doc("Leather belt", "item", null, { subtype: "clothing" });
  await api.annotateItem(belt);
  check("annotate still gives an unannotated belt its place", JSON.stringify(write(belt)[`${GEAR_KEY}.slots`]) === '["belt"]');
  const loaded = doc("Quiver, 20 Arrows", "item", { slots: ["belt"], capacity: 1 });
  await api.annotateItem(loaded);
  check("a loaded quiver has its capacity cleared and keeps its slots", write(loaded)[`${GEAR_KEY}.capacity`] === null && !(`${GEAR_KEY}.slots` in write(loaded)));
  // A container is declared as one and never given a size: how much it holds is
  // the page's (the importer writes it), so annotate stamps `holds` only.
  const bare = doc("Backpack (holds 11 stone)", "item", null);
  await api.annotateItem(bare);
  check("annotate declares a backpack holds gear and states no capacity", write(bare)[`${GEAR_KEY}.holds`] === true && !(`${GEAR_KEY}.capacity` in write(bare)));
  const statedPack = doc("Backpack", "item", { capacity: 5 });
  await api.annotateItem(statedPack);
  check("a backpack that states a capacity keeps it", !(`${GEAR_KEY}.capacity` in write(statedPack)));
  const refused = doc("Backpack", "item", { holds: false });
  await api.annotateItem(refused);
  check("a Judge's holds: false on a backpack stands against a later annotate", !(`${GEAR_KEY}.holds` in write(refused)));
  const staleHolds = doc("Quiver, 20 Arrows", "item", { slots: ["belt"], holds: true });
  await api.annotateItem(staleHolds);
  check("a loaded quiver has its holds declaration taken back", write(staleHolds)[`${GEAR_KEY}.holds`] === false);
  const bowq = doc("Bowquiver", "item", null, { description: "A bowquiver with a bow and arrows counts as 5 items." });
  await api.annotateItem(bowq);
  check("annotate stamps a bowquiver's stated loaded count, and the flag that marks it", write(bowq)[`${GEAR_KEY}.loaded6`] === 5 && write(bowq)["flags.acks-extras.bowquiver"] === true);
  const setBow = doc("Bowquiver", "item", { loaded6: 9 }, { description: "A bowquiver with a bow and arrows counts as 5 items." });
  await api.annotateItem(setBow);
  check("annotate leaves a loaded count a Judge or an earlier pass set", !(`${GEAR_KEY}.loaded6` in write(setBow)));
  // The Holds toggle declares and never sizes: it writes `holds` alone, and clears the capacity on its way off.
  const { setGearHolds } = await import(new URL("actions.mjs", S));
  const toggled = doc("Sack", "item", null);
  await setGearHolds(toggled, true);
  check("ticking Holds writes the declaration and no capacity", write(toggled)[`${GEAR_KEY}.holds`] === true && !(`${GEAR_KEY}.capacity` in write(toggled)));
  const untoggled = doc("Sack", "item", { holds: true, capacity: 4 });
  await setGearHolds(untoggled, false);
  check("unticking Holds writes holds false and clears the capacity", write(untoggled)[`${GEAR_KEY}.holds`] === false && write(untoggled)[`${GEAR_KEY}.capacity`] === null);
  // Untick against every shape a container record takes: the keys that say what
  // goes in leave with the declaration, the lock and its keys never do.
  const REC = "flags.acks-extras.container";
  const LOCK = { locked: true, opened: false, lockMod: -2, quality: "Invented", keys: [{ uuid: "Item.k", name: "Key" }], fragile: true, concealed: true };
  const withRecord = (gearFlag, record) => {
    const it = doc("Chest", "item", gearFlag);
    if (record) it.flags["acks-extras"].container = structuredClone(record);
    return it;
  };
  const untick = async (gearFlag, record) => {
    const it = withRecord(gearFlag, record);
    await setGearHolds(it, false);
    const w = write(it);
    const recWrites = Object.keys(w).filter((k) => k === REC || k.startsWith(`${REC}.`));
    return { w, recWrites, unset: (k) => w[k] instanceof foundry.data.operators.ForcedDeletion };
  };
  const touchesLock = (recWrites) => recWrites.some((k) => k === REC || Object.keys(LOCK).some((key) => k === `${REC}.${key}`));
  for (const [label, gearFlag] of [["a plain sack", null], ["gear.holds alone", { holds: true }], ["gear.capacity alone", { capacity: 2 }]]) {
    const r = await untick(gearFlag, null);
    check(`untick on ${label}: the declaration and the capacity go, no record is written`, r.w[`${GEAR_KEY}.holds`] === false && r.w[`${GEAR_KEY}.capacity`] === null && r.recWrites.length === 0, r.recWrites);
  }
  const legacy = await untick(null, { capacity: 3 });
  check("untick on a capacity stated only on the old record: the record, holding nothing else, goes", legacy.unset(REC) && legacy.recWrites.length === 1, legacy.recWrites);
  const acceptsOnly = await untick({ holds: true }, { accepts: ["weapon"], refusal: "Invented refusal" });
  check("untick after the accept chips were set: the record, holding only what goes in, goes", acceptsOnly.unset(REC) && acceptsOnly.recWrites.length === 1, acceptsOnly.recWrites);
  const lockedDeclared = await untick({ holds: true }, { ...LOCK, accepts: ["tool"], refusal: "Invented", capacity: 1 });
  check("untick on a declared container with a lock: what goes in is cleared key by key, the lock and its keys are untouched",
    ["accepts", "refusal", "capacity"].every((k) => lockedDeclared.unset(`${REC}.${k}`)) && !touchesLock(lockedDeclared.recWrites), lockedDeclared.recWrites);
  const lockOnly = await untick(null, LOCK);
  check("untick on a lock record alone writes nothing to the record", lockOnly.recWrites.length === 0 && lockOnly.w[`${GEAR_KEY}.holds`] === false, lockOnly.recWrites);
  const ticked = withRecord(null, LOCK);
  await setGearHolds(ticked, true);
  check("tick on a lock record alone declares the gear and leaves the record alone", write(ticked)[`${GEAR_KEY}.holds`] === true && !Object.keys(write(ticked)).some((k) => k.startsWith(REC)));
  // A sheet submit carries the record's fields as drawn; only one of them firing writes them.
  const { containerFieldsOnlyWhenFired } = await import(new URL("actions.mjs", S));
  const drawn = () => ({ name: "Chest", flags: { "acks-extras": { container: { fragile: false, lockMod: 0, quality: "", refusal: "" }, gear: { capacity: null } } } });
  const byToggle = containerFieldsOnlyWhenFired(drawn(), undefined);
  check("a submit no record field fired drops the record and keeps the rest of the form", !("container" in byToggle.flags["acks-extras"]) && byToggle.name === "Chest" && "gear" in byToggle.flags["acks-extras"]);
  const byName = containerFieldsOnlyWhenFired(drawn(), "name");
  check("a submit another named field fired drops the record too", !("container" in byName.flags["acks-extras"]));
  const byQuality = containerFieldsOnlyWhenFired(drawn(), `${REC}.quality`);
  check("a submit a record field fired writes the record as drawn", JSON.stringify(byQuality.flags["acks-extras"].container) === JSON.stringify(drawn().flags["acks-extras"].container));
  check("a submit with no flags at all passes through", JSON.stringify(containerFieldsOnlyWhenFired({ name: "x" }, "name")) === '{"name":"x"}');
  const sizedAxe = doc("Battle Axe", "weapon", null, { size: "large", melee: true });
  await api.annotateItem(sizedAxe);
  check("annotate stamps no size on a weapon that declares one", !("flags.acks-extras.size" in write(sizedAxe)));
  const bareAxe = doc("Battle Axe", "weapon", null, { size: "na", melee: true });
  await api.annotateItem(bareAxe);
  check("annotate stamps no size on one that states none: the row is read at use", !("flags.acks-extras.size" in write(bareAxe)) && write(bareAxe)["flags.acks-extras.profileKey"] === "battleaxe");
}

// v14 AE changes must carry a string `type`, never the deprecated numeric `mode`
// shim (whose setter does Number(mode) -> NaN, silently never setting type).
const typedChanges = buildLoadoutChanges(specActor, specLo);
check("loadout AE changes use string `type`, not `mode`", typedChanges.every((c) => c.type === "add" && c.mode === undefined));


// Every register* entry point runs too. These have function-body references
// that node --check cannot see — exactly how the buildApi ReferenceError hid.
const registered = [];
globalThis.game.settings.register = (_m, k) => registered.push(k);
globalThis.game.user = { isGM: false };
globalThis.libWrapper = { register: () => {} };
globalThis.CONFIG = { Actor: { documentClass: { prototype: {} } } };
const { registerSettings } = await import(new URL("settings.mjs", S));
registerSettings();
check("registerSettings() runs and registers the settings", registered.includes("enforceMode") && registered.includes("overlayNamed"));
// The load is weighed whatever the roll setting says, so the two wrappers
// register apart: the encumbrance one names core's method, the attack one is
// composed by the lib's own patch and registers nothing with libWrapper.
{
  const { registerRollWrap, registerEncumbranceWrap } = await import(new URL("roll-wrap.mjs", S));
  const wrapped = [];
  globalThis.libWrapper = { register: (_m, path) => wrapped.push(path) };
  registerEncumbranceWrap();
  check("the encumbrance wrapper registers on its own", wrapped.length === 1 && wrapped[0].endsWith(".computeEncumbrance"));
  registerRollWrap();
  check("the attack wrapper registers nothing more with libWrapper", wrapped.length === 1);
  globalThis.libWrapper = { register: () => {} };
}
// (Paper Doll registration checks removed with the feature.)
const { registerSheet } = await import(new URL("sheet.mjs", S));
registerSheet();
check("registerSheet() runs without throwing", true);

// Overlay toggles with NO implementation behind them must not appear in the
// settings UI — a switch that silently does nothing is worse than no switch.
for (const dead of ["overlayBeastman"]) {
  check(`${dead} is not registered (no implementation exists)`, !registered.includes(dead));
}
for (const live of ["overlayShieldVariants", "overlayManeuvers", "overlayItemLoss", "overlayNamed", "overlayScavenged", "overlayEnclosingHelm", "overlayMounted"]) {
  check(`${live} is registered and gates real code`, registered.includes(live));
}

/* ---------------------------------------------------------------------- */
/*  Containers + wear locations                                            */
/* ---------------------------------------------------------------------- */

globalThis.ui = globalThis.ui ?? { notifications: { warn: () => {}, info: () => {} } };

// (the read-only container maths — roll-up, capacity, harness, bowquiver — are
// already covered above; these cover the new MUTATION and placement layer.)
const { contentsOf, looseItems, containerChain, canStore, storeIn, isLocked, canSeeInside } =
  await import(new URL("containers.mjs", S));
const { wearLocation, wearBuckets } = await import(new URL("wear.mjs", S));
const { WEAR } = await import(new URL("config.mjs", S));

const torch = gear("Torch", 1, { id: "tor" });
const packed = withItems([pack, rope, rations, torch]);

check("contentsOf finds the stowed gear", contentsOf(packed, "bp").length === 2);
check("looseItems excludes stowed gear", looseItems(packed).map((i) => i.id).sort().join() === "bp,tor");

// Over capacity is a WARNING, never a block — RAW capacity does not alter weight.
check("canStore still allows overfilling (capacity warns, never blocks)",
  canStore(withItems([pack, ingots]), torch, pack).ok);

// Nesting: a chest holding a backpack holding rations rolls all the way up.
const chest = gear("Chest", 6, { id: "ch", flags: { container: { capacity: 20 } } });
const innerPack = gear("Backpack", 1, { id: "bp2", flags: { container: { capacity: 4 }, containedIn: "ch" } });
const inRations = gear("Rations", 6, { id: "r2", flags: { containedIn: "bp2" } });
const nested = withItems([chest, innerPack, inRations]);
check("nested contents roll up through the chain", contentsWeight6(nested, "ch") === 7);
check("containerChain walks outward", containerChain(nested, inRations).map((c) => c.id).join() === "bp2,ch");
check("a container may not go inside its own contents", !canStore(nested, innerPack, innerPack).ok);
check("cycles are refused", !canStore(nested, chest, innerPack).ok);
check("a legal nesting is allowed", canStore(nested, torch, innerPack).ok);
check("an item cannot be put inside itself", !canStore(packed, pack, pack).ok);
check("a non-container is not a valid target", !canStore(packed, torch, rope).ok);

// The roll-up already guards against a data cycle (above); the chain walk needs
// its own bound, or a sheet with corrupt flags would hang the client.
check("containerChain terminates on a cycle", containerChain(withItems([loopA, loopB]), loopA).length <= 2);

// storeIn: refuses the impossible, and takes worn gear off before stowing it.
let stored = null;
const wornCloak = { ...gear("Cloak", 1, { id: "cl", wornAt: "shoulders" }), update: async (u) => { stored = u; } };
const stowActor = withItems([pack, wornCloak]);
check("a coat with pockets accepts gear", canStore(coatActor, hiddenBlade, pocketCoat).ok === true);
check("storeIn refuses a non-container target", (await storeIn(stowActor, wornCloak, torch)) === false);
check("storeIn stows the item", (await storeIn(stowActor, wornCloak, pack)) === true);
check("storeIn writes the containedIn flag", stored?.["flags.acks-extras.containedIn"] === "bp");
// A cloak is worn through the gear model, so THAT is the store stowing must
// clear — clearing `system.equipped` alone would leave it worn and stowed.
check("stowing worn gear takes it off first", stored?.["flags.acks-extras.gear.wornAt"] === "");
const wornBlade = { ...gear("Sword", 6, { id: "swx", type: "weapon", equipped: true }), update: async (u) => { stored = u; } };
check("stowing a wielded weapon clears core's own field", (await storeIn(withItems([pack, wornBlade]), wornBlade, pack)) === true && stored?.["system.equipped"] === false);

// containerReport is the whole feature's data path; the sheet renders it
// directly. See docs/equipment/DECISIONS.md, "The Container Manager popout
// is retired".
globalThis.game.user = { isGM: false };
const report = containerReport(packed);
check("containerReport lists the containers", report.length === 1);
check("containerReport carries the load", report[0].load6 === 12 && report[0].capacityStone === 4);
check("containerReport lists the contents", report[0].contents.length === 2);
check("an unlocked container is visible", report[0].visible === true);

// --- locks: visibility is inherited from ownership, gated by the lock ---
const lockedPack = gear("Strongbox", 1, { id: "sb", flags: { container: { capacity: 2, locked: true } } });
const coin = gear("Gems", 1, { id: "gm", flags: { containedIn: "sb" } });
const lockedActor = withItems([lockedPack, coin]);

check("a locked container reads as locked", isLocked(lockedPack) === true);
check("a player cannot see inside a locked container", canSeeInside(lockedPack) === false);
const lockedReport = containerReport(lockedActor);
check("a locked container hides its contents", lockedReport[0].contents.length === 0);
// You cannot see what is in the strongbox; you can feel that it is not empty.
// Hiding the load would make the encumbrance number on the sheet unexplainable.
check("...but NOT its weight — encumbrance must stay explicable",
  lockedReport[0].contents.length === 0 && lockedReport[0].load6 === 1);
check("a locked container refuses new items", canStore(lockedActor, gear("Rope", 6, { id: "r9" }), lockedPack).ok === false);
check("...and says why", canStore(lockedActor, gear("Rope", 6, { id: "r8" }), lockedPack).reason === "locked");

globalThis.game.user = { isGM: true };
check("the GM always sees inside", canSeeInside(lockedPack) === true);
check("...and the report shows the contents for them", containerReport(lockedActor)[0].contents.length === 1);
globalThis.game.user = { isGM: false };

// `opened` records a defeated lock without removing it, so it can be shut again.
const pickedPack = gear("Strongbox", 1, { id: "sb2", flags: { container: { capacity: 2, locked: true, opened: true } } });
check("a defeated lock is no longer shut", isLocked(pickedPack) === false);
check("...so its contents are visible again", canSeeInside(pickedPack) === true);

// Concealment is display-only: it must never hide anything from the maths.
const hiddenPack = gear("Sack", 1, { id: "sk", flags: { container: { capacity: 6, concealed: true } } });
const sackGrain = gear("Grain", 6, { id: "gr", flags: { containedIn: "sk" } });
const concealedActor = withItems([hiddenPack, sackGrain]);
check("concealed is not locked", isLocked(hiddenPack) === false);
check("a concealed container still reports its contents", containerReport(concealedActor)[0].contents.length === 1);
check("a concealed container still weighs", contentsWeight6(concealedActor, "sk") === 6);

// --- wear locations ---
const helm = armor("Helmet", "light", { id: "hm" });
const plate = armor("Plate Mail", "heavy", { id: "pm" });
const shield = armor("Shield", "shield", { id: "sd" });
const blade = weapon("Sword", { melee: true, id: "sw" });
const offBlade = weapon("Dagger", { melee: true, id: "dg", flags: { hand: "off" } });
const spare = weapon("Handaxe", { melee: true, id: "hx", equipped: false });
const stowedRope = gear("Rope", 6, { id: "rp", flags: { containedIn: "bp" } });
const dressed = withItems([helm, plate, shield, blade, offBlade, spare, pack, stowedRope]);
const dLo = getLoadout(dressed);

check("a helmet is worn on the head", wearLocation(dressed, helm, dLo) === WEAR.head);
check("a suit of armour is worn on the body", wearLocation(dressed, plate, dLo) === WEAR.body);
check("a shield in hand is in the off hand", wearLocation(dressed, shield, dLo) === WEAR.offHand);
check("an unflagged weapon is in the main hand", wearLocation(dressed, blade, dLo) === WEAR.mainHand);
check("the hand flag puts a weapon in the off hand", wearLocation(dressed, offBlade, dLo) === WEAR.offHand);
check("unequipped gear is merely carried", wearLocation(dressed, spare, dLo) === WEAR.carried);
check("gear inside a container is stowed", wearLocation(dressed, stowedRope, dLo) === WEAR.stowed);

// A lone medium weapon with both hands free is wielded two-handed (RR p. 299)
// by a character trained to, and the wear bucket must agree with the loadout
// that says so.
const soloBlade = weapon("Sword", { melee: true, id: "sw2" });
const twoHanded = withItems([soloBlade], { flags: { styles: "twoHanded" } });
const tLo = getLoadout(twoHanded);
check("the loadout wields a lone medium weapon two-handed", tLo.weapons[0].wieldTwoHanded);
check("wear agrees: both hands", wearLocation(twoHanded, soloBlade, tLo) === WEAR.bothHands);
// A bow needs both hands however it is held, so it sits in both — not in the
// main hand with the off hand shown empty for a torch the hand count refuses.
const drawnBow = weapon("Long Bow", { missile: true, melee: false, id: "bw" });
const bowman = withItems([drawnBow]);
check("wear agrees: a drawn bow is in both hands", wearLocation(bowman, drawnBow, getLoadout(bowman)) === WEAR.bothHands);

// Two one-hand weapons drawn with no hand named: the first holds the main
// hand, so the second lists in the off hand — never both under one hand.
const fang = weapon("Dagger", { melee: true, id: "d1" });
const bite = weapon("Dagger", { melee: true, id: "d2" });
const dualist = withItems([fang, bite]);
const duLo = getLoadout(dualist);
check("two unnamed one-hand weapons list main, then off", wearLocation(dualist, fang, duLo) === WEAR.mainHand && wearLocation(dualist, bite, duLo) === WEAR.offHand);
// Drawn INTO the main hand by name, a weapon takes it; the unnamed one shifts.
const namedMain = weapon("Dagger", { melee: true, id: "d3", flags: { hand: "main" } });
const shifted = withItems([fang, namedMain]);
const shLo = getLoadout(shifted);
check("a named main hand takes it and the unnamed weapon shifts to the off hand", wearLocation(shifted, namedMain, shLo) === WEAR.mainHand && wearLocation(shifted, fang, shLo) === WEAR.offHand);
// A shield in hand keeps the off hand: the second weapon stays in the main
// hand, which is the overflow the count reports.
const guarded = withItems([shield, fang, bite]);
const gLo = getLoadout(guarded);
check("beside a shield in hand a second weapon lists in the main hand", wearLocation(guarded, bite, gLo) === WEAR.mainHand && gLo.handsUsed === 3);
// The draw into a hand and the sheathe are one write each; sheathing forgets the hand.
const { drawInto, sheatheItem } = await import(new URL("actions.mjs", S));
const handWrites = [];
const mockBlade = { async update(u) { handWrites.push(u); } };
await drawInto(mockBlade, "off");
await drawInto(mockBlade, "belt");
await sheatheItem(mockBlade);
check("drawInto draws and names the hand in one write", handWrites[0]["system.equipped"] === true && handWrites[0]["flags.acks-extras.hand"] === "off");
check("drawInto with no such hand is a plain draw", handWrites[1]["system.equipped"] === true && !("flags.acks-extras.hand" in handWrites[1]));
check("sheatheItem clears the hand with the draw", handWrites[2]["system.equipped"] === false && handWrites[2]["flags.acks-extras.hand"] instanceof foundry.data.operators.ForcedDeletion);

const buckets = wearBuckets(dressed, dLo);
check("buckets are display-ordered head first", buckets[0].key === WEAR.head);
check("buckets omit empty locations", buckets.every((b) => b.items.length > 0));
check("carried and stowed gear stays out of the worn buckets",
  !buckets.some((b) => b.items.some((i) => i.id === "hx" || i.id === "rp")));
check("every equipped item lands in exactly one bucket",
  buckets.reduce((n, b) => n + b.items.length, 0) === 5);

// --- the three rules that could not fire before gear declared a slot ---------
// Each of these gated on `system.equipped`, which core declares on weapon and
// armor alone. Every one of the items below is a plain `item`.
const wornCloakDoc = gear("Cloak, Silk, Hooded", 1, { id: "cl2", wornAt: "shoulders" });
const carriedCloak = gear("Cloak, Wool", 1, { id: "cl3", slots: ["shoulders"] });
const cloaked = withItems([wornCloakDoc, carriedCloak]);
const cLo = getLoadout(cloaked);
check("a worn cloak reaches its slot instead of reading as carried",
  wearLocation(cloaked, wornCloakDoc, cLo) === WEAR.shoulders);
check("...and one merely owned is still carried",
  wearLocation(cloaked, carriedCloak, cLo) === WEAR.carried);
check("the shoulders bucket is now reachable at all",
  wearBuckets(cloaked, cLo).some((b) => b.key === WEAR.shoulders));

// --- the two stores must not drift ------------------------------------------
//
// Core's own equip toggle writes `system.equipped` and knows nothing of the
// slot flag, so an armour unequipped that way can still keep a `wornAt`
// naming where it sat — a stale slot must not read as worn.
const staleArmor = gear("Arena Armor, Heavy", 24, { type: "armor", id: "aa", equipped: false, wornAt: "body", slots: ["body"] });
const drifted = withItems([staleArmor]);
const dfLo = getLoadout(drifted);
check("a stale slot does not make an unequipped armour worn",
  wearLocation(drifted, staleArmor, dfLo) === WEAR.carried);
check("and it reaches no worn bucket", !wearBuckets(drifted, dfLo).some((b) => b.items.some((i) => i.id === "aa")));
// The declaration still decides WHERE, for anything actually worn.
const strapped = gear("Shield", 6, { type: "armor", id: "sd2", equipped: true, wornAt: "strapped", slots: ["offHand", "strapped"] });
const slung = withItems([strapped]);
check("a worn item still sits where it declares",
  wearLocation(slung, strapped, getLoadout(slung)) === WEAR.strapped);

// Gloves block lockpicking (RR p. 145) — dead while it asked for an `equipped`
// field gloves cannot have.
const { wearingGloves } = await import(new URL("locks.mjs", S));
const gloves = gear("Gloves, Leather or Wool, Long", 0, { id: "gv", wornAt: "hands" });
const spareGloves = gear("Gloves, Leather or Wool, Short", 0, { id: "gv2", slots: ["hands"] });
const unnamedMitts = gear("Handwear of the Deft", 0, { id: "gv3", wornAt: "hands" });
check("worn gloves are detected", wearingGloves(withItems([gloves])) === true);
check("gloves merely owned are not", wearingGloves(withItems([spareGloves])) === false);
check("the slot answers it even when the name would not", wearingGloves(withItems([unnamedMitts])) === true);

// A Judge who declares a Great Helm sits nowhere must not have the name test
// put it back on the head — which is why "declared nowhere" and "never
// annotated" are different states.
const { isHelmet: isHelmetOf } = await import(new URL("profiles.mjs", S));
const namedHelm = armor("Great Helm", "medium", { id: "gh" });
const disownedHelm = { ...namedHelm, getFlag: (_m, k) => (k === "gear" ? { slots: [] } : undefined) };
check("an un-annotated helm falls back to its name", isHelmetOf(namedHelm) === true);
check("a helm declared to sit nowhere stays nowhere", isHelmetOf(disownedHelm) === false);

/* ---------------------------------------------------------------------- */
/*  Proficiency kill switch (acks-abilities interop)                        */
/* ---------------------------------------------------------------------- */

// This module infers proficiency from its OWN actor flags. acks-abilities owns
// a richer model of the same facts, so a character built with it carries none
// of these flags and would read as non-proficient — triggering the full RR
// p. 15 package on a legal PC. Enforcement must default OFF while it is active.
const { enforcementActive } = await import(new URL("proficiency.mjs", S));

// A bare unconfigured actor with a weapon its (absent) flags don't cover: a
// weapon that is two-handed by nature, since the default training covers the
// one-handed styles and the auto grip never elects a style that is untrained.
const unconfigured = () => withItems([weapon("Two-Handed Sword", { melee: true, id: "hb" })]);

// "auto" reads the abilities feature off the namespace (the way the runtime
// reaches it), so the toggle is the acksExtras.abilities stub itself.
const priorAbilities = globalThis.acksExtras.abilities;
const setAbilities = (present) => {
  globalThis.acksExtras.abilities = present ? (priorAbilities ?? {}) : undefined;
};
const setMode = (mode) => {
  const base = globalThis.game.settings.get;
  globalThis.game.settings.get = (m, k) =>
    k === "proficiencyEnforcement" ? mode : base(m, k);
};

// Baseline: abilities feature absent → enforcement live, penalties as before.
setAbilities(false);
setMode("auto");
check("auto + abilities absent → enforcement LIVE", enforcementActive());
check("baseline: unconfigured actor is still gated", getLoadout(unconfigured()).nonProficientUse);

// The hotfix: abilities feature present → penalties off, no silent 0th-level hit.
setAbilities(true);
check("auto + abilities ACTIVE → enforcement OFF", !enforcementActive());
const freed = getLoadout(unconfigured());
check("kill switch clears nonProficientUse", !freed.nonProficientUse);
check("kill switch reports weapons proficient", freed.weapons.every((w) => w.proficient));
check("kill switch reports the style trained", freed.styleProficient);
check("kill switch raises no proficiency violations",
  !freed.violations.some((v) => ["weaponNotProficient", "armorNotProficient", "styleNotProficient", "nonProficientUse"].includes(v.type)));
// The attack package is what actually hurt a PC — prove it is gone.
const freedActor = { ...freed, ...unconfigured(), type: "character", system: { details: { level: 5 }, attack: { throw: 7 }, scores: { str: { mod: 2 } } } };
check("kill switch removes the attack degradation", attackThrowRows(freedActor, freedActor.items.get("hb"), "melee").length === 0);

// Equip limits are NOT proficiency — they must survive the kill switch.
const overloaded2 = withItems([weapon("Sword", { melee: true, id: "s1" }), weapon("Axe", { melee: true, id: "s2" }), weapon("Mace", { melee: true, id: "s3" })]);
check("kill switch does NOT disable hand-limit enforcement",
  getLoadout(overloaded2).violations.some((v) => v.type === "handOverflow"));

// Explicit overrides win in both directions.
setMode("on");
check("mode 'on' enforces even with abilities active", enforcementActive());
setAbilities(false);
setMode("off");
check("mode 'off' disables even with abilities absent", !enforcementActive());

// Restore defaults for anything that runs later.
setMode("auto");
globalThis.acksExtras.abilities = priorAbilities;

/* ---------------------------------------------------------------------- */
/*  Abilities bridge — proficiency facts FROM the acks-abilities model      */
/* ---------------------------------------------------------------------- */

const { hasEffectFlag, sumEffectModifiers, collectStringFlags, stringFlagValue } = await import(new URL("effects.mjs", S));
const { trainedStyles, specializedStyles } = await import(new URL("loadout.mjs", S));
const { resolveStylePick, resolveWeaponGroupPick, resolveFocusPick } =
  await import(new URL("abilities-bridge.mjs", S));

/** An abilities-modelled ability item: cookbook id + extras, NO native AEs. */
const abil = (name, defId, extras = {}, over = {}) => ({
  id: over.id ?? name.replace(/\W/g, ""),
  name,
  type: "ability",
  system: {},
  flags: {
    "acks-extras": { ...(defId ? { cookbook: { id: defId } } : {}), extras },
  },
  getFlag: () => undefined,
  effects: over.effects ?? [],
});

// Presence via cookbook id → boolean domain (no equipment flags anywhere).
const finesseChar = withItems([abil("Weapon Finesse", "def.prof.weaponFinesse")]);
check("bridge: cookbook id flips the finesse domain", hasEffectFlag(finesseChar, "finesse"));
check("bridge: absent ability, absent domain", !hasEffectFlag(withItems([]), "finesse"));

// FSS with a stored pick → trained AND specialized in that style, without any
// flags.acks-extras.* data — the exact character the kill switch protected.
const fss = abil("Fighting Style Specialization", "def.prof.fightingStyleSpecialization", { selections: ["Two-Handed"] });
const fssChar = withItems([fss, weapon("Sword", { melee: true, id: "fsw" })]);
check("bridge: FSS pick trains the style", trainedStyles(fssChar).has("twohanded"));
check("bridge: FSS pick specializes the style", specializedStyles(fssChar).has("twohanded"));
check("bridge: FSS character is styleProficient under FULL enforcement",
  getLoadout(fssChar).styleProficient && getLoadout(fssChar).nonProficientUse === false);

// Martial Training pick widens weapon proficiency under full enforcement.
// (Actor narrowed to swords so the test cannot pass vacuously.)
const mtChar = withItems([abil("Martial Training", "def.prof.martialTraining", { selections: ["Axes"] })]);
mtChar.getFlag = (_m, k) => (k === "weaponProficiency" ? "swordDagger" : undefined);
check("bridge: Martial Training (Axes) grants the axe category",
  isWeaponProficient(mtChar, classifyWeapon(weapon("Battle Axe", { melee: true }))));
const noMt = withItems([]);
noMt.getFlag = (_m, k) => (k === "weaponProficiency" ? "swordDagger" : undefined);
check("bridge: without it the axe stays non-proficient",
  !isWeaponProficient(noMt, classifyWeapon(weapon("Battle Axe", { melee: true }))));

// Armour Training: each rank raises the wearable category by the step its
// typed `modifies` row carries, read off the page at import. The steps are
// invented and vary by case, so a hard-coded step cannot pass.
const { armourTrainingRows } = await import(new URL("abilities-bridge.mjs", S));
const armourRow = (value) => ({ type: "modifies", refs: ["kw:armorproficiency"], domain: "armor", value, mode: "add" });
const atOf = (name, defId, value, qty) => {
  const a = withItems([abil(name, defId, { qty, ...(value === undefined ? {} : { effects: [armourRow(value)] }) })]);
  a.getFlag = (_m, k) => (k === "armorMax" ? "veryLight" : undefined);
  return a;
};
const stepTwo = atOf("Armor Training", "def.prof.armorTraining", { kind: "flat", flat: 2 }, 1);
check("bridge: an imported step of 2 at rank 1 raises very light → medium", armorMax(stepTwo) === "medium");
check("bridge: the step is the typed row's value times the rank",
  sumEffectModifiers(atOf("Armor Training", "def.prof.armorTraining", { kind: "flat", flat: 2 }, 3), "armorTraining") === 6);
check("bridge: a step imported before the LevelValue shape (a bare number) still applies",
  sumEffectModifiers(atOf("Armor Training", "def.prof.armorTraining", 4, 2), "armorTraining") === 8);
check("bridge: US and UK spellings both resolve when the row is present",
  sumEffectModifiers(atOf("Armour Training", null, { kind: "flat", flat: 2 }, 1), "armorTraining") === 2 &&
  sumEffectModifiers(atOf("Armor Training", null, { kind: "flat", flat: 2 }, 1), "armorTraining") === 2);
check("bridge: a power of another name carrying the row raises the category too",
  sumEffectModifiers(atOf("Ironclad Drill", "def.power.ironcladDrill", { kind: "flat", flat: 2 }, 1), "armorTraining") === 2);
const handTrained = atOf("Armour Training", null, undefined, 2);
check("bridge: a hand-made Armour Training with no row contributes no step",
  sumEffectModifiers(handTrained, "armorTraining") === 0 && armorMax(handTrained) === "veryLight");
const handRows = armourTrainingRows(handTrained);
check("bridge: the hand-made copy is reported as not imported",
  handRows.length === 1 && handRows[0].step === null && handRows[0].steps === null && handRows[0].rank === 2);
check("bridge: both spellings are reported when no step is imported",
  armourTrainingRows(atOf("Armor Training", null, undefined, 1))[0]?.step === null);
const blanked = atOf("Armor Training", "def.prof.armorTraining", { kind: "flat", flat: null }, 1);
check("bridge: a row whose step a Judge blanked adds nothing and is reported",
  sumEffectModifiers(blanked, "armorTraining") === 0 && armourTrainingRows(blanked)[0]?.step === null);
const readRows = armourTrainingRows(atOf("Armor Training", "def.prof.armorTraining", { kind: "flat", flat: 2 }, 3));
check("bridge: an imported row is reported with its step, rank and total",
  readRows[0]?.step === 2 && readRows[0]?.rank === 3 && readRows[0]?.steps === 6);
check("bridge: an ability neither named nor carrying the row is not reported",
  armourTrainingRows(withItems([abil("Weapon Finesse", "def.prof.weaponFinesse")])).length === 0);

// Dedup: an item speaking the native effect language stands aside — its AE
// counts once, the bridge adds nothing on top.
const nativeReflexes = abil("Combat Reflexes", null, {}, {
  effects: [{ changes: [{ key: "flags.acks-extras.styleInit", value: "1" }] }],
});
const reflexChar = withItems([nativeReflexes]);
reflexChar.appliedEffects = [marker("styleInit", 1)];
check("bridge: native-effect items are not double-counted",
  sumEffectModifiers(reflexChar, "styleInit") === 1);
// The bridge keys no number on a name: an ability with no typed spec adds
// nothing to initiative, whatever it is called.
check("bridge: a named ability with no typed spec contributes nothing",
  sumEffectModifiers(withItems([abil("Combat Reflexes", null, {})]), "styleInit") === 0);

/* --- The typed effect model: a CLASS POWER granting a proficiency's rule --- */
//
// The slug tables key on the definition id's last segment, which carries the
// owning class for a power: `def.power.bladedancerWeaponFinesse` reaches no
// table entry and never will. The bladedancer's three combat powers reached no
// roll at all until the bridge read what the abilities model already says.
//
// The importer stamps its provenance under this module's own scope, so these
// use it — a test written against the wrong scope passes on the name fallback
// and proves nothing about the id.
const power = (name, defId, effects) => ({
  id: name.replace(/\W/g, ""),
  name,
  type: "ability",
  system: {},
  flags: { "acks-extras": { cookbook: { id: defId }, extras: { effects } } },
  getFlag: () => undefined,
  effects: [],
});

const bdFinesse = power("Weapon Finesse", "def.power.bladedancerWeaponFinesse", [
  { type: "attributeSubstitution", attribute: "dex", insteadOf: "str", target: "attackThrow" },
]);
check("typed model: a class power flips the finesse domain",
  hasEffectFlag(withItems([bdFinesse]), "finesse"));

const bdFaith = power("Strength of Faith", "def.power.bladedancerStrengthOfFaith", [
  { type: "attributeSubstitution", attribute: "wis", insteadOf: "str", target: "damage" },
]);
check("typed model: a damage substitution names the attribute that replaces STR",
  collectStringFlags(withItems([bdFaith]), "damageAttribute").has("wis"));

// Only a swap AWAY from Strength is expressible — Strength is the only
// attribute core pushes onto an attack throw or a damage roll.
const notStr = power("Odd Power", "def.power.oddPower", [
  { type: "attributeSubstitution", attribute: "wis", insteadOf: "int", target: "damage" },
]);
check("typed model: a substitution for something other than STR is left alone",
  collectStringFlags(withItems([notStr]), "damageAttribute").size === 0);

// damageAttribute holds ONE attribute: the highest-priced Active Effect, else
// the bridge's. A set read by position would take the lowest-priced one.
const attrFx = (type, value) => ({ id: `fx${type}${value}`, name: value, disabled: false, changes: [{ key: "flags.acks-extras.damageAttribute", type, value }], flags: { "acks-extras": {} } });
check("damageAttribute: an override beats an add, whatever their order",
  stringFlagValue(withItems([], { effects: [attrFx("override", "con"), attrFx("add", "dex")] }), "damageAttribute") === "con");
check("damageAttribute: an Active Effect beats the bridge; the bridge answers alone",
  stringFlagValue(withItems([bdFaith], { effects: [attrFx("add", "dex")] }), "damageAttribute") === "dex"
  && stringFlagValue(withItems([bdFaith]), "damageAttribute") === "wis"
  && stringFlagValue(withItems([]), "damageAttribute") === null);
// Grants written as overrides (a retired pack's shape) each still grant, and
// leave a class grant written as an add standing.
const grantFx = (value) => ({ id: `g${value}`, name: value, disabled: false, changes: [{ key: "flags.acks-extras.weaponProf", type: "override", value, priority: 50 }], flags: { "acks-extras": {} } });
const classFx = { id: "gclass", name: "class", disabled: false, changes: [{ key: "flags.acks-extras.weaponProf", type: "add", value: "bow" }], flags: { "acks-extras": {} } };
const granted = collectStringFlags(withItems([], { effects: [classFx, grantFx("axe"), grantFx("swordDagger")] }), "weaponProf");
check("weaponProf: two override grants and the class add all count", ["bow", "axe", "sworddagger"].every((t) => granted.has(t)));

// Typed modifiers reach the loadout effect through lib/typed-modifiers.mjs,
// one change per ability, each named in the ledger. Figures are invented.
const sumOf = (ch, key) =>
  buildLoadoutChanges(ch, getLoadout(ch))
    .filter((c) => c.key === key)
    .reduce((s, c) => s + (c.type === "subtract" ? -1 : 1) * Number(c.value), 0);
const initOf = (ch) => sumOf(ch, "system.initiative.mod");
const sworded = (items, over = {}) => {
  const ch = withItems([...items, weapon("Sword", { melee: true, id: "gsw" })], over);
  ch.getFlag = (_m, k) => (k === "styles" ? "single,twoHanded" : k === "armorMax" ? "heavy" : undefined);
  return ch;
};
check("typed model: an ungated initiative bonus is always on",
  initOf(sworded([power("Quick", "def.power.quick", [{ type: "modifier", target: "initiative", mode: "add", value: 2 }])])) === 2);
check("typed model: a bonus to own surprise rolls lands on avoid surprise",
  sumOf(sworded([power("Wary", "def.power.wary", [{ type: "modifier", target: "surprise", value: 3 }])]), "system.surprise.avoidsurprise") === 3);
check("typed model: a value that does not resolve contributes nothing",
  initOf(sworded([power("Ladder", "def.power.ladder",
    [{ type: "modifier", target: "initiative", mode: "add", value: { kind: "progression", as: "thief" } }])])) === 0);
check("typed model: a flat-shaped value resolves",
  initOf(sworded([power("Flat", "def.power.flat", [{ type: "modifier", target: "initiative", value: { kind: "flat", flat: 3 } }])])) === 3);

// A ladder resolves at the character's level: lib's resolver while nothing
// else is live, the classes resolver once it is. F1: the level moves it.
const initLadder = { kind: "breakpoints", breakpoints: [{ atLevel: 1, value: 1 }, { atLevel: 6, value: 4 }] };
const leveled = (level) => sworded([power("Ladder", "def.power.ladder",
  [{ type: "modifier", target: "initiative", mode: "add", value: initLadder }])], { system: { details: { level } } });
const priorAbilitiesApi = globalThis.acksExtras.abilities;
const priorClassesApi = globalThis.acksExtras.classes;
globalThis.acksExtras.abilities = undefined;
globalThis.acksExtras.classes = undefined;
check("typed model: a level ladder resolves at the character's level",
  initOf(leveled(3)) === 1 && initOf(leveled(6)) === 4);
globalThis.acksExtras.classes = { resolveLevelValue: () => 5 };
check("typed model: the classes resolver answers when live", initOf(leveled(1)) === 5);
globalThis.acksExtras.abilities = priorAbilitiesApi;
globalThis.acksExtras.classes = priorClassesApi;

// A gated modifier stands while the loadout answers its gate, by the arguments
// its import read (invented here: light armour or less, 4 stone or less).
const gate = { kind: "lightlyEquipped", armourMax: "light", loadMax: 4 };
const bdGraceful = power("Graceful Fighting", "def.power.bladedancerGracefulFighting", [
  { type: "modifier", target: "initiative", mode: "add", value: 2, gate },
]);
check("a gated initiative bonus stands unarmoured", initOf(sworded([bdGraceful])) === 2);
check("a gated initiative bonus drops in heavier armour",
  initOf(sworded([bdGraceful, armor("Plate", "heavy", { id: "gpl" })])) === 0);
check("a gated initiative bonus drops over the load cap",
  initOf(sworded([bdGraceful], { system: { encumbrance: { value: 6 } } })) === 0);
const unread = power("Unread", "def.power.unread", [{ type: "modifier", target: "initiative", value: 2, gate: { kind: "lightlyEquipped", armourMax: "light", loadMax: null } }]);
check("a gate whose figure was not imported applies nothing", initOf(sworded([unread])) === 0);
const prose = power("Prose", "def.power.prose", [{ type: "modifier", target: "initiative", value: 2, condition: "situational" }]);
check("a free-text condition applies nothing", initOf(sworded([prose])) === 0);

// Each change is named in the ledger, index for index.
const { buildLoadoutParts } = await import(new URL("effects.mjs", S));
const ledgerChar = sworded([power("Quick", "def.power.quick", [{ type: "modifier", target: "initiative", value: 2 }])]);
const built = buildLoadoutParts(ledgerChar, getLoadout(ledgerChar));
const at = built.changes.findIndex((c) => c.key === "system.initiative.mod");
check("the ledger names the ability beside its change", at >= 0 && built.parts[at].label === "Quick" && built.parts.length === built.changes.length);

// An item whose own Active Effect writes the field stands aside for it.
const handMade = power("Hand", "def.power.hand", [{ type: "modifier", target: "ac", value: 2 }]);
handMade.effects = [{ disabled: false, changes: [{ key: "system.ac.mod", type: "add", value: "2" }] }];
check("a hand-made effect on the ability is not doubled", sumOf(sworded([handMade]), "system.ac.mod") === 0);
handMade.effects = [{ disabled: true, changes: [{ key: "system.ac.mod", type: "add", value: "2" }] }];
check("a disabled hand-made effect does not stand in", sumOf(sworded([handMade]), "system.ac.mod") === 2);

// The bridge no longer reads a typed initiative modifier into a domain.
check("the bridge leaves typed initiative to the loadout",
  sumEffectModifiers(withItems([power("Quick", "def.power.quick", [{ type: "modifier", target: "initiative", value: 2 }])]), "styleInit") === 0);

// Pick resolvers.
check("resolveStylePick handles 'Weapon and Shield'", resolveStylePick("Weapon and Shield") === "weaponshield");
check("resolveWeaponGroupPick: bows and crossbows are one category", resolveWeaponGroupPick("Crossbows").join() === "bowcrossbow" && resolveWeaponGroupPick("Bows").join() === "bowcrossbow");
check("resolveWeaponGroupPick: a named weapon is that weapon alone, not its category", resolveWeaponGroupPick("Sword").join() === "sword" && resolveWeaponGroupPick("Whip").join() === "whip");
check("resolveFocusPick maps bows and crossbows together", resolveFocusPick("Bows & Crossbows") === "bowscrossbows");
check("resolveFocusPick answers null for a pick no imported focus names", resolveFocusPick("Zorgle") === null && resolveFocusPick("") === null);
check("resolveFocusPick takes an imported focus key as written", resolveFocusPick("axes") === "axes");
check("resolveWeaponGroupPick reads a category by its own name when the lists do not place the pick", resolveWeaponGroupPick("Thrown Spears and Polearms").join() === "spearpolearm" && resolveWeaponGroupPick("Zorgle").join() === "zorgle" && resolveWeaponGroupPick("").length === 0);

// A Martial Training pick grants its option's own weapons, built through the real
// path: the grid and the lists registered, the rows placed by the resolver. The
// nouns and names are invented; the category tokens are the module's own. Rows
// outside every option keep each size and use bucket from covering a whole option.
{
  const { registerWeaponSource: useSource } = await import(new URL("../lib/weapons.mjs", S));
  const { librarySource, WEAPONS_DOC, WEAPONS_TABLE } = await import(new URL("weapon-source.mjs", S));
  const row = (name, size, use) => ({ name, block: null, size, melee: use === "m", missile: use === "r" });
  const GRID = {
    zorg: row("Zorg", "small", "m"), greatzorg: row("Great Zorg", "large", "m"), blorp: row("Blorp", "medium", "r"), flib: row("Flib", "small", "r"),
    hurl: row("Hurl", "small", "r"), quux: row("Quux", "tiny", "m"), dorb: row("Dorb", "medium", "m"), stray: row("Stray", "medium", "m"),
    plain: row("Plain", "large", "m"), filler: row("Filler", "small", "m"), speck: row("Speck", "tiny", "m"),
  };
  const CATEGORY = { axe: ["zorgs"], bowCrossbow: ["blorps"], swordDagger: ["flibs"], other: ["quuxes", "dorbs", "hurls", "strays"] };
  const MARTIAL = {
    martial: {
      options: [
        { n: 1, marker: "1", label: "zorgs", nouns: ["zorgs"] },
        { n: 2, marker: "2", label: "blorps, flibs", nouns: ["blorps", "flibs"] },
        { n: 3, marker: "3", label: "any combination of 2", any: 2 },
        { n: 4, marker: "4", label: "quuxes, dorbs, hurls", nouns: ["quuxes", "dorbs", "hurls"] },
      ],
    },
  };
  const layer = { priority: PRIORITY.OVERRIDE, source: "martial-test" };
  const previous = useSource(librarySource);
  registerTable({ id: WEAPONS_DOC, tables: { [WEAPONS_TABLE]: GRID } }, layer);
  registerTable({ id: "weaponLists", tables: { category: CATEGORY, options: MARTIAL } }, layer);
  const pick = (p) => resolveWeaponGroupPick(p).join();
  try {
    check("an option's id resolves to its own weapons", pick("martial.4") === "dorb,hurl,quux");
    check("a phrase naming one option's nouns resolves the same way", pick("quuxes and dorbs") === "dorb,hurl,quux" && pick("Hurl") === "dorb,hurl,quux");
    check("an option holding a whole category collapses to its category token", pick("martial.1") === "axe" && pick("zorgs") === "axe");
    check("an option over two categories is both tokens", pick("martial.2") === "sworddagger,bowcrossbow" && pick("blorps") === "sworddagger,bowcrossbow");
    check("a legacy category key resolves through the one option whose weapons all carry it, and never to the category's other weapons", pick("other") === "dorb,hurl,quux" && pick("axe") === "axe");
    check("a legacy key no single option holds stays the key itself", pick("bowcrossbow") === "bowcrossbow" && pick("crossbow") === "bowcrossbow" && pick("sworddagger") === "sworddagger");
    check("a combination grants nothing, and so does an id no option has", pick("martial.3") === "" && pick("martial.9") === "" && resolveWeaponGroupPick("martial.3").length === 0);
    check("a pick no option names is the weapon, else the category named, else the pick", pick("Stray") === "stray" && pick("Crossbows") === "bowcrossbow" && pick("Zorgle") === "zorgle");
    const grants = (...selections) => [...collectStringFlags(withItems([abil("Martial Training", "def.prof.martialTraining", { selections })]), "martialWeapons")].sort().join();
    check("the bridge writes every token of every pick", grants("martial.4", "martial.1") === "axe,dorb,hurl,quux");
    const swordish = withItems([abil("Martial Training", "def.prof.martialTraining", { selections: ["martial.4"] })]);
    swordish.getFlag = (_m, k) => (k === "weaponProficiency" ? "axe" : undefined);
    const covered = (name, flags) => isWeaponProficient(swordish, classifyWeapon(weapon(name, flags)));
    check("a pick covers its own weapons and not the rest of the category it shares", covered("Hurl", { missile: true }) === true && covered("Stray", { melee: true }) === false);
    // A hand-made copy with no stored picks carries one in its name's "(X)" only
    // where X names an option of the imported list; any other trailing
    // parenthetical is no pick.
    const named = (name) => [...collectStringFlags(withItems([abil(name, null, {})]), "martialWeapons")].sort().join();
    check("a name's \"(X)\" that names an imported option is read as its pick", named("Martial Training (zorgs)") === "axe");
    check("a name's trailing parenthetical that names no option grants nothing", named("Martial Training (variant words)") === "");
  } finally {
    unregisterTable("weaponLists", layer);
    unregisterTable(WEAPONS_DOC, layer);
    useSource(previous);
  }
  check("nothing imported, the pick falls back without throwing", pick("martial.4") === "" && pick("other") === "other" && pick("Crossbows") === "bowcrossbow" && pick("axes") === "axe");
}

/* ---------------------------------------------------------------------- */
/*  Paper Doll placement planner (sheet → doll mirror)                      */
// (Paper Doll checks removed with the feature.)
/* ---------------------------------------------------------------------- */
/*  Paper Doll header button: WHERE it may be injected                      */
/*                                                                          */
/*  We are offered every ApplicationV2 render, and other modules' windows    */
/*  carry an `.actor` too — the doll's own window is one. Injecting there    */
/*  once re-fired core's header-controls hook with a document-less app,      */
/*  which threw inside another module's listener and could spawn dolls       */
/*  recursively. The gate is the DOCUMENT, and no core hook is ever re-fired.*/
// (Paper Doll checks removed with the feature.)

/* ---------------------------------------------------------------------- */
/*  Ammunition consumption + thrown-weapon state                            */
/* ---------------------------------------------------------------------- */

SETTINGS_STATE.ammoTracking = true;
globalThis.ui = globalThis.ui ?? { notifications: { info: () => {}, warn: () => {}, error: () => {} } };
const { consumeForAttack, launcherAmmoPattern, roundsOf, isThrownAway, recoverThrown, consumeItem, nockAmmo } =
  await import(new URL("ammo.mjs", S));

// A launcher's ammo type is resolved from category/name.
check("bow → arrows", launcherAmmoPattern(weapon("Long Bow", { missile: true, melee: false }), classifyWeapon(weapon("Long Bow", { missile: true, melee: false }))).test("Quiver, 20 Arrows"));
check("crossbow → bolts", launcherAmmoPattern(weapon("Crossbow", { missile: true }), classifyWeapon(weapon("Crossbow", { missile: true }))).test("Case, 20 Bolts"));
{
  // One category holds both kinds, so the ammunition is read from the weapon's own name.
  const patternOf = (name) => launcherAmmoPattern(weapon(name, { missile: true }), classifyWeapon(weapon(name, { missile: true })));
  check("a bow takes no bolts and a crossbow no arrows", !patternOf("Long Bow").test("Case, 20 Bolts") && !patternOf("Crossbow").test("Quiver, 20 Arrows"));
  check("an arbalest is a crossbow: bolts, no arrows", patternOf("Arbalest").test("Case, 20 Bolts") && !patternOf("Arbalest").test("Quiver, 20 Arrows"));
  // A Judge's own launcher: no row places an invented name, so its class is declared.
  const zorbler = weapon("Zorbler", { missile: true, flags: { category: "bowCrossbow" } });
  const either = launcherAmmoPattern(zorbler, classifyWeapon(zorbler));
  check("a launcher of the pair whose name says neither takes either", !!either && ["Quiver, 20 Arrows", "Case, 20 Bolts"].every((n) => either.test(n)));
}
check("sling → stones", launcherAmmoPattern(weapon("Sling", { missile: true }), classifyWeapon(weapon("Sling", { missile: true }))).test("30 Sling Stones"));
check("a launcher is told by its imported class, never by its name", launcherAmmoPattern(weapon("Long Bow", { missile: true }), classifyWeapon(weapon("Zorgle Bow", { missile: true }))) === null);
check("a melee sword has no ammo pattern", launcherAmmoPattern(weapon("Sword", { melee: true }), classifyWeapon(weapon("Sword", { melee: true }))) === null);

// A mutable mock item that records updates/flags (ammo consumption writes them).
const trackItem = (name, over = {}) => {
  const flags = { ...(over.flags ?? {}) };
  const sys = { equipped: over.equipped ?? true, melee: over.melee, missile: over.missile, quantity: over.quantity, customTags: [], special: over.special ?? {} };
  return {
    id: over.id ?? name.replace(/\W/g, ""), name, type: "weapon", system: sys,
    getFlag: (_m, k) => flags[k],
    setFlag: async (_m, k, v) => { flags[k] = v; },
    unsetFlag: async (_m, k) => { delete flags[k]; },
    update: async (u) => { for (const [p, v] of Object.entries(u)) { if (p === "system.quantity.value") sys.quantity = { ...sys.quantity, value: v }; else if (p.startsWith("flags.")) flags[p.split(".").pop()] = v; else if (p === "system.equipped") sys.equipped = v; } },
    _flags: flags, _sys: sys,
  };
};

// Firing a ammoBow decrements the matching ammoQuiver, not other ammo.
const ammoQuiver = trackItem("Quiver, 20 Arrows", { quantity: { value: 20 }, equipped: false });
const ammoBolts = trackItem("Case, 20 Bolts", { quantity: { value: 20 }, equipped: false });
const ammoBow = trackItem("Long Bow", { missile: true, melee: false });
const archer = withItems([ammoBow, ammoQuiver, ammoBolts]);
await consumeForAttack(archer, ammoBow, classifyWeapon(ammoBow), { type: "missile" });
check("firing a ammoBow spends one arrow", ammoQuiver._sys.quantity.value === 19);
check("firing a ammoBow leaves the ammoBolts alone", ammoBolts._sys.quantity.value === 20);

// --- Declaring which stack to fire (the `nocked` flag over plain-first) ---
{
  const plain = trackItem("Quiver, 20 Arrows", { id: "plain", quantity: { value: 20 }, equipped: false });
  const silver = trackItem("Quiver, 20 Arrows (Silver)", { id: "silver", quantity: { value: 20 }, equipped: false, flags: { silvered: true } });
  const bow = trackItem("Long Bow", { missile: true, melee: false });
  const arch = withItems([bow, plain, silver]);
  arch.updateEmbeddedDocuments = async (_t, updates) => {
    for (const u of updates) {
      const item = arch.items.get(u._id);
      for (const [path, value] of Object.entries(u)) {
        if (path === "_id") continue;
        const key = path.split(".").pop();
        if (value instanceof foundry.data.operators.ForcedDeletion) delete item._flags[key];
        else item._flags[key] = value;
      }
    }
  };
  await consumeForAttack(arch, bow, classifyWeapon(bow), { type: "missile" });
  check("plain arrows spend first by default", plain._sys.quantity.value === 19 && silver._sys.quantity.value === 20);

  const on = await nockAmmo(arch, silver);
  check("nocking a stack reports it on", on === true && silver._flags.nocked === true);
  await consumeForAttack(arch, bow, classifyWeapon(bow), { type: "missile" });
  check("a declared stack fires ahead of plain", silver._sys.quantity.value === 19 && plain._sys.quantity.value === 19);

  await nockAmmo(arch, plain);
  check("declaring another stack un-declares the first", plain._flags.nocked === true && silver._flags.nocked === undefined);

  const off = await nockAmmo(arch, plain);
  check("nocking the declared stack again clears it", off === false && plain._flags.nocked === undefined);

  // A declaration dies with its stack.
  await nockAmmo(arch, silver);
  silver._sys.quantity = { value: 1 };
  await consumeItem(silver, 1);
  check("an emptied stack drops its declaration", silver._flags.nocked === undefined);
}

// A melee attack consumes nothing.
await consumeForAttack(archer, ammoBow, classifyWeapon(ammoBow), { type: "melee" });
check("a melee attack spends no ammo", ammoQuiver._sys.quantity.value === 19);

// A single thrown weapon is MARKED thrown (not destroyed), unequipped.
const axe = trackItem("Hand Axe", { melee: true, missile: true, special: { thrown: true } });
const thrower = withItems([axe]);
await consumeForAttack(thrower, axe, classifyWeapon(axe), { type: "missile" });
check("a single thrown weapon is marked thrown-away", isThrownAway(axe));
check("a thrown weapon is unequipped", axe._sys.equipped === false);
check("a thrown weapon is NOT destroyed", !!thrower.items.find((i) => i.id === axe.id));

// A stackable thrown weapon decrements instead of being marked.
const ammoDarts = trackItem("Darts", { melee: true, missile: true, quantity: { value: 5 }, special: { thrown: true } });
await consumeForAttack(withItems([ammoDarts]), ammoDarts, classifyWeapon(ammoDarts), { type: "missile" });
check("a stackable thrown weapon decrements", ammoDarts._sys.quantity.value === 4);
check("a stackable thrown weapon is not marked thrown-away", !isThrownAway(ammoDarts));

// A pure-thrown SPLASH consumable (military oil) SHATTERS — spent, not marked
// for recovery (you cannot pick up a broken flask). This is the gap the old
// `profile.melee` gate left open: oil is missile-only, so it was never consumed.
const oilFlask = trackItem("Military Oil", { missile: true, melee: false, quantity: { value: 1 } });
await consumeForAttack(withItems([oilFlask]), oilFlask, classifyWeapon(oilFlask), { type: "missile" });
check("a single splash flask is spent (0), not thrown-away", oilFlask._sys.quantity.value === 0 && !isThrownAway(oilFlask));

const oilStack = trackItem("Military Oil", { missile: true, melee: false, quantity: { value: 3 } });
await consumeForAttack(withItems([oilStack]), oilStack, classifyWeapon(oilStack), { type: "missile" });
check("a stack of splash flasks decrements", oilStack._sys.quantity.value === 2);

// A pure-thrown REUSABLE weapon (bola) is recoverable, unlike a splash flask.
const bola = trackItem("Bola", { missile: true, melee: false, quantity: { value: 1 } });
await consumeForAttack(withItems([bola]), bola, classifyWeapon(bola), { type: "missile" });
check("a single reusable thrown weapon (bola) is marked thrown-away", isThrownAway(bola));

// consumeItem: the shared decrement primitive acks-formation reuses.
const torchStack = trackItem("Torch", { quantity: { value: 6 } });
check("consumeItem decrements a stack and returns the remainder", (await consumeItem(torchStack, 1)) === 5 && torchStack._sys.quantity.value === 5);
check("consumeItem clamps at zero", (await consumeItem(trackItem("Torch", { quantity: { value: 0 } }), 1)) === 0);

// A thrown-away weapon's weight leaves the encumbrance total until recovered.
const heavyAxe = { ...trackItem("Hand Axe", { flags: { thrownAway: true } }), type: "weapon", system: { weight6: 6, cost: 5, quantity: { value: 1 } } };
heavyAxe.getFlag = (_m, k) => (k === "thrownAway" ? true : undefined);
const encActor = withItems([heavyAxe]);
check("a thrown-away weapon subtracts its weight from encumbrance", encumbranceDelta6(encActor) === -6);

// Recover clears the thrown state.
const recovered = await recoverThrown(thrower);
check("recover clears the thrown state", !isThrownAway(axe) && recovered.includes("Hand Axe"));

// Off by setting.
SETTINGS_STATE.ammoTracking = false;
const q2 = trackItem("Quiver, 20 Arrows", { quantity: { value: 20 }, equipped: false });
await consumeForAttack(withItems([ammoBow, q2]), ammoBow, classifyWeapon(ammoBow), { type: "missile" });
check("ammo tracking off → nothing consumed", q2._sys.quantity.value === 20);
SETTINGS_STATE.ammoTracking = true;

/* ---------------------------------------------------------------------- */
/*  Grip switching (1H / 2H, hand-aware)                                     */
/* ---------------------------------------------------------------------- */

const { weaponGrip } = await import(new URL("loadout.mjs", S));

// A versatile weapon (medium melee, Sword) offers a grip choice.
const gripSword = () => weapon("Sword", { melee: true, id: "gs" });
const autoLoad = getLoadout(withItems([gripSword()], { flags: { styles: "twoHanded" } }));
check("versatile weapon exposes canTwoHand", autoLoad.weapons[0].canTwoHand === true);
check("auto grip → two-handed when hands free and the style is trained", autoLoad.weapons[0].wieldTwoHanded && autoLoad.weapons[0].grip === "auto");
const autoUntrained = getLoadout(withItems([gripSword()]));
check("auto grip → one-handed when the two-handed style is untrained", autoUntrained.weapons[0].wieldTwoHanded === false && autoUntrained.handsUsed === 1 && autoUntrained.weapons[0].gripBlocked !== true);

// Explicit 1H keeps it one-handed even with hands free.
const oneH = getLoadout(withItems([{ ...gripSword(), getFlag: (_m, k) => (k === "grip" ? "1h" : undefined) }]));
check("grip 1h → one-handed", oneH.weapons[0].wieldTwoHanded === false && oneH.handsUsed === 1);

// Explicit 2H two-hands it.
const twoH = getLoadout(withItems([{ ...gripSword(), getFlag: (_m, k) => (k === "grip" ? "2h" : undefined) }]));
check("grip 2h → two-handed, 2 hands", twoH.weapons[0].wieldTwoHanded === true && twoH.handsUsed === 2);

// 2H requested but a shield occupies the off hand → BLOCKED, stays one-handed.
const swordFlag2h = { ...gripSword(), getFlag: (_m, k) => (k === "grip" ? "2h" : undefined) };
const withShield = withItems([swordFlag2h, armor("Shield", "shield", { id: "gsh" })]);
const blockedLo = getLoadout(withShield);
const swEntry = blockedLo.weapons.find((w) => w.item.id === "gs");
check("grip 2h blocked when a shield holds the off hand", swEntry.gripBlocked === true && swEntry.wieldTwoHanded === false);

// A forced-two-handed weapon (great sword / two-handed sword) has no grip choice.
const gsword = getLoadout(withItems([weapon("Two-Handed Sword", { melee: true, id: "ths" })]));
check("forced-2H weapon is two-handed with no grip choice", gsword.weapons[0].wieldTwoHanded === true && gsword.weapons[0].canTwoHand === false);

// weaponGrip reads/normalises the flag.
check("weaponGrip defaults to auto", weaponGrip({ getFlag: () => undefined }) === "auto");
check("weaponGrip reads 2h", weaponGrip({ getFlag: (_m, k) => (k === "grip" ? "2h" : undefined) }) === "2h");

/* ---------------------------------------------------------------------- */
/*  Held-light hand cost (acks-formation two-way hook)                       */
/* ---------------------------------------------------------------------- */

// No formation module → held lights are 0, loadout unaffected.
delete globalThis.acksExtras.formation;
const noLight = getLoadout(withItems([weapon("Sword", { melee: true, id: "hl1" })]));
check("no formation → heldLights 0", noLight.heldLights === 0);

// A lit light the actor bears occupies a hand: a 2-hand actor holding a torch
// and a sword uses both hands, and a second weapon would overflow.
const litFor = (wanted) => ({
  handsOccupied: (id) => ({ lights: id === wanted ? 1 : 0, mapping: 0, total: id === wanted ? 1 : 0 }),
  lightsForBearer: (id) => (id === wanted ? [{ id: "lit1", type: "torch", lit: true, bearerId: id }] : null),
});
globalThis.acksExtras.formation = litFor("a1");
const oneLight = getLoadout(withItems([weapon("Sword", { melee: true, id: "hl2" })]));
check("held light counts as a used hand", oneLight.heldLights === 1 && oneLight.handsUsed === 2);
check("held light leaves no free hand for a 2-hand actor", oneLight.handsFree === 0);
// The sword no longer auto-two-hands: the torch holds the other hand.
check("a held light blocks the two-handed grip", oneLight.weapons[0].wieldTwoHanded === false);
// Torch + two weapons → hand overflow.
const overHand = getLoadout(withItems([weapon("Sword", { melee: true, id: "hl3" }), weapon("Dagger", { melee: true, id: "hl4" })]));
check("torch + two weapons overflows hands", overHand.violations.some((v) => v.type === "handOverflow"));
delete globalThis.acksExtras.formation;

/* ---------------------------------------------------------------------- */
/*  Torch as a weapon (RR p148/p300): 1d4, no damage bonus                   */
/* ---------------------------------------------------------------------- */

const torchProfile = classifyWeapon(weapon("Torch", { melee: true, damage: "1d4" }));
check("torch classifies as a 1d4 weapon", torchProfile.damage === "1d4");
check("torch is flagged no-damage-bonus", torchProfile.special?.includes("noDamageBonus"));
check("torch is throwable", torchProfile.thrown === true);

// A strong character bashing with a torch: the body's damage bonuses are
// left off the die.
const strongTorch = withItems([weapon("Torch", { melee: true, id: "tor1", damage: "1d4" })]);
strongTorch.system = { scores: { str: { mod: 2 } }, damage: { mod: { melee: 1 } }, details: { level: 1 }, attack: { throw: 10 } };
check("torch strips the melee damage bonuses", damageRows(strongTorch, strongTorch.items.get("tor1"), "melee", [{ label: "Strength", value: 2 }, { label: "Melee", value: 1 }]).length === 0);
// A WEAK character keeps the penalty (it is not a bonus).
const weakTorch = withItems([weapon("Torch", { melee: true, id: "tor2", damage: "1d4" })]);
weakTorch.system = { scores: { str: { mod: -1 } }, damage: { mod: { melee: 0 } }, details: { level: 1 }, attack: { throw: 10 } };
check("torch keeps a STR penalty (not a bonus)", damageRows(weakTorch, weakTorch.items.get("tor2"), "melee", [{ label: "Strength", value: -1 }]).length === 1);

/* ---------------------------------------------------------------------- */
/*  #2 Thrown weapons: the throw is offered, and STR on it is the system's  */
/* ---------------------------------------------------------------------- */

const axeThrower = withItems([weapon("Hand Axe", { melee: true, missile: true, id: "ha1", damage: "1d6" })]);
axeThrower.system = { scores: { str: { mod: 2 } }, damage: { mod: { missile: 0 } }, details: { level: 1 }, attack: { throw: 10 } };
const thrownAxe = axeThrower.items.get("ha1");
check("a hand axe offers the thrown attack beside its own", attackTypesFor(thrownAxe, ["melee", "missile"]).join() === "melee,missile,thrown");
check("a weapon that already offers the throw is not offered it twice", attackTypesFor(thrownAxe, ["melee", "thrown"]).join() === "melee,thrown");
check("a sword offers no throw", attackTypesFor(swordItem, ["melee"]).join() === "melee");
check("a hurled axe's STR is the system's; this feature adds no row", damageRows(axeThrower, thrownAxe, "thrown", [{ label: "Strength", value: 2 }]).length === 1);
const oilThrower = withItems([weapon("Military Oil", { missile: true, id: "mo1", damage: "1d8" })]);
oilThrower.system = { scores: { str: { mod: 3 } }, damage: { mod: { missile: 0 } }, details: { level: 1 }, attack: { throw: 10 } };
check("thrown splash oil gains no STR to damage (RAW exclusion)", damageRows(oilThrower, oilThrower.items.get("mo1"), "thrown", [{ label: "Strength", value: 3 }]).length === 0);

/* ---------------------------------------------------------------------- */
/*  #1 Torch: ready one from the stack into a wielded 1d4 light-weapon      */
/* ---------------------------------------------------------------------- */

const readied = readiedWeaponData({ name: "Torch", img: "t.png", system: { cost: 1, weight6: 1 } });
check("readied torch is a weapon of the row's die, melee AND thrown, light", readied.type === "weapon" && readied.system.damage.base.formula === FIXTURE_ROWS.torch.damage && readied.system.melee && readied.system.missile && readied.flags["acks-extras"].light);
check("readied torch carries no quantity (a single wielded torch)", readied.system.quantity === undefined);
check("readiedWeaponData ignores non-preparable gear", readiedWeaponData({ name: "Sword" }) === null && readiedWeaponData({ name: "Lantern" }) === null);
// Core's own compendium stack is named "Torches (6)": it readies as the
// table's torch, under the torch's name so the readied weapon classifies as one.
const coreStack = readiedWeaponData({ name: "Torches (6)", img: "t.png", system: { cost: 1, weight6: 1, quantity: { value: 6 } } });
check("core's torch stack readies under the torch's own name", coreStack?.type === "weapon" && coreStack.system.damage.base.formula === FIXTURE_ROWS.torch.damage && coreStack.name === "Torch" && coreStack.flags["acks-extras"].light);

const created = [];
const torchActor = { createEmbeddedDocuments: async (_t, arr) => { created.push(...arr); return arr.map((d, i) => ({ ...d, id: "new" + i })); } };
const stack = { name: "Torch", img: "t.png", system: { quantity: { value: 3 }, cost: 1, weight6: 1 }, deleted: false, getFlag: () => undefined, async update(u) { if (u["system.quantity.value"] != null) this.system.quantity.value = u["system.quantity.value"]; }, async delete() { this.deleted = true; } };
const madeTorch = await prepareTorch(torchActor, stack);
check("prepareTorch creates a weapon-torch", madeTorch && madeTorch.type === "weapon" && madeTorch.system.damage.base.formula === FIXTURE_ROWS.torch.damage);
check("prepareTorch decrements the stack (3 → 2), keeps it", stack.system.quantity.value === 2 && stack.deleted === false);
const lastTorch = { name: "Torch", img: "t.png", system: { quantity: { value: 1 } }, deleted: false, getFlag: () => undefined, async update(u) { this.system.quantity.value = u["system.quantity.value"]; }, async delete() { this.deleted = true; } };
await prepareTorch(torchActor, lastTorch);
check("prepareTorch deletes the stack when the last torch is drawn", lastTorch.system.quantity.value === 0 && lastTorch.deleted === true);
check("a readied torch is carried, not drawn, unless asked", created.every((d) => d.system.equipped === false));
// A stack dropped on a hand place, or its Equip pressed, readies one torch INTO
// the hand: the stack is never held, so "equip a torch" is ready-and-draw.
const drawn = [];
const handActor = { createEmbeddedDocuments: async (_t, arr) => arr.map((d, i) => ({ ...d, id: "hand" + i, async update(u) { drawn.push(u); } })) };
const handStack = { name: "Torches (6)", img: "t.png", system: { quantity: { value: 2 }, cost: 1, weight6: 1 }, deleted: false, getFlag: () => undefined, async update(u) { this.system.quantity.value = u["system.quantity.value"]; }, async delete() { this.deleted = true; } };
const inHand = await prepareTorch(handActor, handStack, { draw: true });
check("prepareTorch {draw} readies a torch and draws it", inHand?.name === "Torch" && drawn.length === 1 && drawn[0]["system.equipped"] === true && handStack.system.quantity.value === 1);

/* ---------------------------------------------------------------------- */
/*  #3 Unarmed strike (RR p299: melee only, its die imported)               */
/* ---------------------------------------------------------------------- */

// The die is the imported one (the equipment document's `unarmedStrike` table;
// the figure here is INVENTED). With none the weapon states no formula.
{
  const { registerTable: reg, unregisterTable: unreg, PRIORITY: P } = await import(new URL("../lib/tables.mjs", S));
  const bare = unarmedStrikeData();
  check("no die imported: the unarmed strike is melee-only and states no damage formula", bare.system.damage.base.formula === "" && bare.system.melee === true && bare.system.missile === false);
  reg({ id: "equipment", tables: { unarmedStrike: { damage: "1d7" } } }, { priority: P.WORLD, source: "test" });
  check("an imported die is the strike's formula", unarmedStrikeData().system.damage.base.formula === "1d7");
  unreg("equipment", { priority: P.WORLD });
  reg({ id: "equipment", tables: { unarmedStrike: { damage: "lots" } } }, { priority: P.WORLD, source: "test" });
  check("an override that is not a die counts as not imported", unarmedStrikeData().system.damage.base.formula === "");
  unreg("equipment", { priority: P.WORLD });

  // The throw is made either way; with no die it says the die is not imported.
  const { rollUnarmed } = await import(new URL("actions.mjs", S));
  const said = [];
  const prevInfo = globalThis.ui.notifications.info;
  const prevConfig = globalThis.CONFIG;
  globalThis.ui.notifications.info = (m) => said.push(String(m));
  globalThis.CONFIG = { ...(prevConfig ?? {}), Item: { documentClass: class { constructor(data) { this.data = data; } } } };
  const throws = [];
  const striker = { makeAttackThrow: (o) => { throws.push(o); return true; } };
  try {
    rollUnarmed(striker, { skipDialog: true });
    check("no die imported: the throw is made and the notice says the die is not imported", throws.length === 1 && said.length === 1 && said[0].includes("unarmedNoDie"));
    reg({ id: "equipment", tables: { unarmedStrike: { damage: "1d7" } } }, { priority: P.WORLD, source: "test" });
    said.length = 0;
    rollUnarmed(striker, { skipDialog: true });
    check("a die imported: the throw is made and nothing is said", throws.length === 2 && said.length === 0);
    unreg("equipment", { priority: P.WORLD });
  } finally {
    globalThis.ui.notifications.info = prevInfo;
    globalThis.CONFIG = prevConfig;
  }
}

/* ---------------------------------------------------------------------- */
/*  #4 Masterwork (RR p159): stamped onto core fields, reversible          */
/* ---------------------------------------------------------------------- */

check("addToDamage appends a flat bonus", addToDamage("1d6", 1) === "1d6 + 1" && addToDamage("1d8", 0) === "1d8");
check("masterworkTiersFor lists weapon vs armor tiers", masterworkTiersFor("weapon").length === 3 && masterworkTiersFor("armor").length === 2 && masterworkTiersFor("item").length === 0);

const mockDoc = (type, sys = {}) => ({
  type,
  name: sys.name ?? "Sword",
  img: sys.img ?? "icons/svg/item-bag.svg",
  system: {
    bonus: { attack: sys.bonus ?? 0, damage: 0 },
    damage: { base: { formula: sys.damage }, alternate: { formula: "" } },
    ac: { value: sys.aac ?? 0 }, weight6: sys.weight6 ?? 0, cost: sys.cost ?? 0, description: sys.description ?? "", customTags: [], special: {}, type: sys.armorType,
  },
  _flags: {},
  getFlag(_m, k) { return this._flags[k]; },
  async setFlag(_m, k, v) { this._flags[k] = v; },
  async unsetFlag(_m, k) { delete this._flags[k]; },
  async update(u) {
    for (const [path, v] of Object.entries(u)) {
      // Foundry routes a flags.<module>.<key> update to the flag store; mirror that.
      if (path.startsWith("flags.acks-extras.")) {
        this._flags[path.slice("flags.acks-extras.".length)] = v;
        continue;
      }
      if (!path.includes(".")) { this[path] = v; continue; } // top-level doc field (name, img)
      const parts = path.replace(/^system\./, "").split(".");
      let o = this.system;
      while (parts.length > 1) o = o[parts.shift()] ??= {};
      o[parts[0]] = v;
    }
  },
});

/*
 * The silver plating and each masterwork tier read the library's variation
 * documents. These stand in for what the importer mints, carrying INVENTED
 * figures (none is a printed one), so every assertion below is against the
 * document's number and never a constant of the module's.
 */
const { VARIATION_ITEM_TYPE } = await import(new URL("constants.mjs", S));
const variationItem = (key, { deltas = {}, cost = {}, cite = "Invented p. 1", minted = true } = {}) => ({
  id: `var-${key}`,
  type: VARIATION_ITEM_TYPE,
  name: `Invented ${key}`,
  flags: { "acks-extras": minted ? { cookbook: { id: `def.variation.${key}`, cite } } : {} },
  system: {
    key,
    deltas: { bonus: 0, damage: 0, ac: 0, weight6: 0, ...deltas },
    cost: { baseMul: 1, add: 0, mul: 1, ...cost },
    source: { cite: minted ? cite : "" },
  },
});
const FIG = {
  hit: { bonus: 3, add: 7 },
  dmg: { damage: 2, add: 7 },
  both: { bonus: 3, damage: 2, add: 11 },
  light: { weight6: -12, add: 5 },
  ac: { ac: 2, add: 13 },
  silver: 4,
};
const IMPORTED_VARIATIONS = [
  variationItem("masterwork.weaponToHit", { deltas: { bonus: FIG.hit.bonus }, cost: { add: FIG.hit.add } }),
  variationItem("masterwork.weaponDamage", { deltas: { damage: FIG.dmg.damage }, cost: { add: FIG.dmg.add } }),
  variationItem("masterwork.weaponBoth", { deltas: { bonus: FIG.both.bonus, damage: FIG.both.damage }, cost: { add: FIG.both.add } }),
  variationItem("masterwork.armorLight", { deltas: { weight6: FIG.light.weight6 }, cost: { add: FIG.light.add } }),
  variationItem("masterwork.armorAC", { deltas: { ac: FIG.ac.ac }, cost: { add: FIG.ac.add } }),
  variationItem("material.silver", { cost: { baseMul: FIG.silver } }),
];
const useLibrary = (items) => { game.items = items; };
const libraryAbsent = () => { delete game.items; };
useLibrary(IMPORTED_VARIATIONS);

const mkWeapon = mockDoc("weapon", { bonus: 0, damage: "1d6", weight6: 6 });
await setMasterwork(mkWeapon, "weaponBoth");
check("a masterwork tier stamps the imported bonus and damage", mkWeapon.system.bonus.attack === FIG.both.bonus && mkWeapon.system.damage.base.formula === `1d6 + ${FIG.both.damage}`);
check("masterwork records the tier; the baseline is the shared `pristine` flag", mkWeapon._flags.masterwork?.tier === "weaponBoth" && mkWeapon._flags.pristine?.damage === "1d6");
await setMasterwork(mkWeapon, "weaponToHit");
check("switching tiers restarts from base (never compounds the die)", mkWeapon.system.bonus.attack === FIG.hit.bonus && mkWeapon.system.damage.base.formula === "1d6");
await setMasterwork(mkWeapon, "weaponToDamage");
check("the damage tier reads the document registered under the damage key", mkWeapon.system.bonus.attack === 0 && mkWeapon.system.damage.base.formula === `1d6 + ${FIG.dmg.damage}`);
await setMasterwork(mkWeapon, "none");
check("masterwork None restores the base exactly and clears both flags", mkWeapon.system.bonus.attack === 0 && mkWeapon.system.damage.base.formula === "1d6" && mkWeapon._flags.masterwork === undefined && mkWeapon._flags.pristine === undefined);

const mkArmor = mockDoc("armor", { aac: 4, weight6: 30 });
await setMasterwork(mkArmor, "armorLight");
check("an armour tier moves the weight by the document's sixths", mkArmor.system.weight6 === 30 + FIG.light.weight6 && mkArmor.system.ac.value === 4);
await setMasterwork(mkArmor, "armorAC");
check("an armour tier raises aac from base and restores the weight", mkArmor.system.ac.value === 4 + FIG.ac.ac && mkArmor.system.weight6 === 30);

/* ---------------------------------------------------------------------- */
/*  #5 Shield strap cycle — free a hand by slinging (overlay on)           */
/* ---------------------------------------------------------------------- */

SETTINGS_STATE.overlayShieldVariants = true;
const strapMock = (variant) => ({ type: "armor", system: { type: "shield" }, _flags: variant ? { shieldVariant: variant } : {}, getFlag(_m, k) { return this._flags[k]; }, async setFlag(_m, k, v) { this._flags[k] = v; }, async unsetFlag(_m, k) { delete this._flags[k]; } });
const shieldDoc = strapMock();
check("strap starts in hand", strapOf(shieldDoc) === "hand");
check("cycle hand → back", (await cycleStrap(shieldDoc)) === "back" && shieldDoc._flags.strap === "back");
check("cycle back → front", (await cycleStrap(shieldDoc)) === "front");
check("cycle front → hand clears the flag", (await cycleStrap(shieldDoc)) === "hand" && shieldDoc._flags.strap === undefined);
check("a kite shield skips the back (no-back): hand → front", (await cycleStrap(strapMock("kite"))) === "front");

/* ---------------------------------------------------------------------- */
/*  Apply-to-any-item: scavenge condition + shield variant (UI actions)    */
/* ---------------------------------------------------------------------- */

// rollScavengedD20s expands each 19-20 into two more rolls, in order.
const seq = (arr) => { let i = 0; return () => arr[i++]; };
check("scavenge 19-20 expands into two more d20s", JSON.stringify(rollScavengedD20s("piercingSlashing", seq([19, 7, 15]))) === JSON.stringify([19, 7, 15]));
check("scavenge single non-reroll result = one d20", JSON.stringify(rollScavengedD20s("piercingSlashing", () => 7)) === JSON.stringify([7]));

// Scavenge stamps a condition onto a real-shaped weapon, reversibly. Fields are
// recomputed from ONE pristine baseline (properties.mjs), so the damage string
// is normalised ("1d6 - 1") and the snapshot lives under `pristine`.
const scWeapon = mockDoc("weapon", { name: "Sword", damage: "1d6", bonus: 0 });
await scavengeItem(scWeapon, { roll: () => 7 }); // "Blade rusty" → -1 damage
check("scavenge stamps -1 damage onto a weapon", scWeapon.system.damage.base.formula === "1d6 - 1");
check("scavenge captures ONE pristine baseline", scWeapon._flags.pristine?.damage === "1d6");
await clearScavenged(scWeapon);
check("clearScavenged restores pristine damage, clears both flags", scWeapon.system.damage.base.formula === "1d6" && scWeapon._flags.scavenged === undefined && scWeapon._flags.pristine === undefined);

// Re-rolling never compounds (always recomputed from pristine).
await scavengeItem(scWeapon, { roll: () => 7 });
await scavengeItem(scWeapon, { roll: () => 3 }); // "Blade dented" → -1 damage (from pristine, not -2)
check("re-scavenge starts from pristine (no compounding)", scWeapon.system.damage.base.formula === "1d6 - 1");
await clearScavenged(scWeapon);

// Armour scavenge: -1 AC + a break flag for the Judge.
const scArmor = mockDoc("armor", { name: "Plate", aac: 6, weight6: 36, armorType: "heavy" });
await scavengeItem(scArmor, { roll: () => 13 }); // "Dented/rotting" → -1 AC, breaks
check("scavenge stamps -1 AC on armour + records break flag", scArmor.system.ac.value === 5 && scArmor._flags.scavenged?.breaks === true);

/* --- LAYERING: masterwork + scavenged must coexist and unwind cleanly ----- */
// A single baseline, never a per-layer snapshot: two layers snapshotting their
// own "base" would let clearing one restore the other's delta as if pristine.
const both = mockDoc("weapon", { name: "Sword", damage: "1d6", bonus: 0, weight6: 6 });
await setMasterwork(both, "weaponBoth");
check("masterwork alone: the document's bonus and damage", both.system.bonus.attack === FIG.both.bonus && both.system.damage.base.formula === `1d6 + ${FIG.both.damage}`);
await scavengeItem(both, { roll: () => 7 }); // rusty: -1 damage
check("masterwork + scavenged combine numerically (not '1d6 + 2-1')", both.system.damage.base.formula === `1d6 + ${FIG.both.damage - 1}` && both.system.bonus.attack === FIG.both.bonus);
await clearScavenged(both);
check("clearing the condition leaves masterwork intact", both.system.damage.base.formula === `1d6 + ${FIG.both.damage}` && both.system.bonus.attack === FIG.both.bonus);
await scavengeItem(both, { roll: () => 11 }); // off balance: -1 attack
check("scavenged attack penalty stacks onto the masterwork bonus", both.system.bonus.attack === FIG.both.bonus - 1);
await setMasterwork(both, "none");
check("clearing masterwork keeps the condition's -1 attack", both.system.bonus.attack === -1 && !!both._flags.scavenged);
await clearScavenged(both);
check("clearing the LAST layer restores the item exactly + drops the baseline",
  both.system.bonus.attack === 0 && both.system.damage.base.formula === "1d6" && both.system.weight6 === 6 && both._flags.pristine === undefined);

// A field typed onto a layered item moves the baseline, so the next layer
// change keeps it (the item sheet routes a typed layered field through here).
const { baseForTyped, layerDeltas: deltasOf, recomputeItemFields } = await import(new URL("properties.mjs", S));
const typed = mockDoc("weapon", { name: "Sword", damage: "1d6", bonus: 0, weight6: 6 });
await setMasterwork(typed, "weaponBoth");
const typedDamage = baseForTyped("damage", `1d8 + ${FIG.both.damage}`, deltasOf(typed));
check("a typed damage backs the layers' delta out of the baseline", typedDamage === "1d8");
const typedBonus = 9;
typed._flags.pristine = { ...typed._flags.pristine, damage: typedDamage, bonus: baseForTyped("bonus", typedBonus, deltasOf(typed)) };
await recomputeItemFields(typed);
check("the recompute writes back exactly what was typed", typed.system.damage.base.formula === `1d8 + ${FIG.both.damage}` && typed.system.bonus.attack === typedBonus);
await setMasterwork(typed, "none");
check("a later layer change keeps the typed values", typed.system.damage.base.formula === "1d8" && typed.system.bonus.attack === typedBonus - FIG.both.bonus);
check("a blank damage stays blank; a number that is not one is refused",
  baseForTyped("damage", " ", { damage: 1 }) === "" && baseForTyped("bonus", "x", { bonus: 1 }) === null);

/* --- GOLD VALUE follows the layers (the number on the sheet must move) --- */
const priced = mockDoc("weapon", { name: "Sword", damage: "1d6", cost: 10, weight6: 6 });
await setMasterwork(priced, "weaponToHit");
check("masterwork adds the document's surcharge to the price", priced.system.cost === 10 + FIG.hit.add);
await scavengeItem(priced, { roll: () => 7 }); // rusty: -1 dmg, resale fraction
const resale = priced._flags.scavenged.valueMultiplier;
check("a scavenged condition scales the whole price", Math.abs(priced.system.cost - (10 + FIG.hit.add) * resale) < 0.01);
await setMasterwork(priced, "none");
check("dropping masterwork reprices from pristine", Math.abs(priced.system.cost - 10 * resale) < 0.01);
await clearScavenged(priced);
check("clearing every layer restores the original price", priced.system.cost === 10);
const { layerSummary, layerProvenance, unstatedLayers } = await import(new URL("properties.mjs", S));
const p3 = mockDoc("armor", { name: "Plate", aac: 6, cost: 60, weight6: 36 });
await setMasterwork(p3, "armorAC");
check("armour masterwork: the document's AC and surcharge both land", p3.system.ac.value === 6 + FIG.ac.ac && p3.system.cost === 60 + FIG.ac.add);
check("layerSummary states the new price so the sheet can explain it", layerSummary(p3).includes(`${60 + FIG.ac.add}gp (was 60gp)`));

/* --- NOT IMPORTED: a layer with no document applies nothing and says so --- */
const printedLayers = await import(new URL("printed-layers.mjs", S));
libraryAbsent();
const bareMw = mockDoc("weapon", { name: "Sword", damage: "1d6", bonus: 0, cost: 10, weight6: 6 });
await setMasterwork(bareMw, "weaponBoth");
check("a masterwork tier with no imported document stamps nothing", bareMw.system.bonus.attack === 0 && bareMw.system.damage.base.formula === "1d6" && bareMw.system.cost === 10);
check("the tier is still recorded, so the layer survives an import", bareMw._flags.masterwork?.tier === "weaponBoth");
check("masterworkFigure answers null with no document", printedLayers.masterworkFigure("weaponBoth") === null && printedLayers.silverFigure() === null);
const bareUnstated = unstatedLayers(bareMw);
check("the layer is listed as not imported, naming the key to import", bareUnstated.length === 1 && bareUnstated[0].layer === "masterwork" && bareUnstated[0].key === MASTERWORK.weaponBoth);
check("layerSummary says it is not imported and shows no figure", layerSummary(bareMw).includes("ACKS-EQUIPMENT.printed.layerNotImported"));
const platedMock = (flags = {}) => ({ name: "Sword", type: "weapon", system: { cost: 10, weight6: 1, damage: "1d4" }, getFlag: (_m, k) => flags[k] });
const barePlated = platedMock({ silvered: true });
check("a plated blade with no document is scaled by nothing", deltasOf(barePlated, { silvered: true, masterwork: null, scavenged: null }).costBaseMul === 1);
check("and is listed as not imported", unstatedLayers(barePlated).some((u) => u.layer === "silver" && u.key === SILVER.variation));
check("an item set to neither layer lists nothing", unstatedLayers(platedMock()).length === 0);

// A document the import could not fill holds the schema's neutral figures, which is not a figure.
useLibrary([
  variationItem("masterwork.weaponToHit"),
  variationItem("material.silver"),
]);
check("a document carrying only neutral figures counts as not imported", printedLayers.masterworkFigure("weaponToHit") === null && printedLayers.silverFigure() === null);
check("a tier the module does not know has no figure", printedLayers.masterworkFigure("noSuchTier") === null);

// An applied variation is not the library's copy: it never answers for the key.
useLibrary([{ ...variationItem("material.silver", { cost: { baseMul: FIG.silver } }), flags: { "acks-extras": { containedIn: "item1" } } }]);
check("a variation applied to an item is not read as the library's document", printedLayers.silverFigure() === null);

/* --- PROVENANCE: the page, the hand, or not imported --- */
const fmt = game.i18n.format;
game.i18n.format = (k, d) => `${k}|${JSON.stringify(d ?? {})}`;
useLibrary(IMPORTED_VARIATIONS);
const tipOf = (figure) => printedLayers.provenanceTip(figure.source);
check("a minted document's tooltip names its page", tipOf(printedLayers.silverFigure()).startsWith("ACKS-EQUIPMENT.printed.fromPage") && tipOf(printedLayers.silverFigure()).includes("Invented p. 1"));
useLibrary([variationItem("material.silver", { cost: { baseMul: FIG.silver }, minted: false })]);
check("a hand-made document's tooltip says it was set by hand", tipOf(printedLayers.silverFigure()).startsWith("ACKS-EQUIPMENT.printed.byHand"));
const stampedRead = (key, read, now) => {
  const doc = variationItem(key, now);
  doc.flags["acks-extras"].cookbook.read = read;
  return doc;
};
useLibrary([stampedRead("material.silver", { deltas: {}, cost: { baseMul: FIG.silver } }, { cost: { baseMul: FIG.silver } })]);
check("a minted document still holding the figures its import read cites its page", tipOf(printedLayers.silverFigure()).startsWith("ACKS-EQUIPMENT.printed.fromPage"));
useLibrary([stampedRead("material.silver", { deltas: {}, cost: { baseMul: FIG.silver } }, { cost: { baseMul: FIG.silver + 1 } })]);
check("a minted document a Judge edited says so, and names the page the import read", tipOf(printedLayers.silverFigure()).startsWith("ACKS-EQUIPMENT.printed.editedByHand") && tipOf(printedLayers.silverFigure()).includes("Invented p. 1"));
useLibrary([stampedRead("masterwork.weaponToHit", { deltas: { bonus: FIG.hit.bonus }, cost: { add: FIG.hit.add } }, { deltas: { bonus: FIG.hit.bonus }, cost: { add: FIG.hit.add + 1 } })]);
check("an edit to one slot of a tier is an edit", tipOf(printedLayers.masterworkFigure("weaponToHit")).startsWith("ACKS-EQUIPMENT.printed.editedByHand"));
useLibrary([variationItem("material.silver", { cost: { baseMul: FIG.silver }, cite: "" })]);
check("a minted document with no page still names the document", tipOf(printedLayers.silverFigure()).startsWith("ACKS-EQUIPMENT.printed.fromDocument"));
check("the not-imported tooltip names the key", printedLayers.notImportedTip(SILVER.variation).includes(SILVER.variation));
// A container's stated capacity wears the same three states: the page the import
// read it from, an edit to that figure, or a hand; none stated is "not imported".
const capItem = (capacity, cookbook) => ({ name: "Crate", flags: { "acks-extras": { gear: capacity == null ? {} : { capacity }, ...(cookbook ? { cookbook } : {}) } } });
const capTip = (item) => printedLayers.capacityTip(item);
check("a capacity equal to the figure its import read cites the page", capTip(capItem(9, { cite: "Invented p. 2", read: { capacity: 9 } })).startsWith("ACKS-EQUIPMENT.printed.fromPage") && capTip(capItem(9, { cite: "Invented p. 2", read: { capacity: 9 } })).includes("Invented p. 2"));
check("a capacity a Judge changed says so and names the page the import read", capTip(capItem(12, { cite: "Invented p. 2", read: { capacity: 9 } })).startsWith("ACKS-EQUIPMENT.printed.editedByHand") && capTip(capItem(12, { cite: "Invented p. 2", read: { capacity: 9 } })).includes("Invented p. 2"));
check("a capacity the import did not read is set by hand, stamp or no stamp", capTip(capItem(3, { cite: "Invented p. 2" })).startsWith("ACKS-EQUIPMENT.printed.byHand") && capTip(capItem(3)).startsWith("ACKS-EQUIPMENT.printed.byHand"));
check("a capacity of zero is stated and cites its source", capTip(capItem(0)).startsWith("ACKS-EQUIPMENT.printed.byHand"));
check("no stated capacity says not imported and cites nothing", capTip(capItem(null, { cite: "Invented p. 2" })).includes("capacityNotImportedTip") && !capTip(capItem(null)).includes("Invented"));
useLibrary(IMPORTED_VARIATIONS);
const provenanceItem = mockDoc("weapon", { name: "Sword", damage: "1d6" });
provenanceItem._flags.masterwork = { tier: "weaponToHit" };
provenanceItem._flags.silvered = true;
check("layerProvenance joins one clause per layer the item carries", layerProvenance(provenanceItem).split(" · ").length === 2);
check("and is empty for an item with neither", layerProvenance(mockDoc("weapon", { name: "Sword", damage: "1d6" })) === "");
const { priceLedger } = await import(new URL("item-sheet/price-ledger.mjs", S));
const led = priceLedger({
  base: 10,
  silverMul: FIG.silver,
  silverTip: "tip-silver",
  masterwork: { label: "M", add: FIG.hit.add, tip: "tip-mw" },
  unstated: [{ key: "masterwork", label: "U", tip: "tip-missing" }],
});
const ledLine = (key) => led.lines.find((l) => l.key === key);
check("a ledger line carries the tooltip of the figure it shows", ledLine("silver").tip === "tip-silver" && ledLine("masterwork").tip === "tip-mw");
check("a layer not imported is a line with no amount and its own tooltip", ledLine("unstated:masterwork").notImported === true && ledLine("unstated:masterwork").amount === 0 && ledLine("unstated:masterwork").tip === "tip-missing");
check("a layer not imported moves no price", led.final === 10 * FIG.silver + FIG.hit.add && ledLine("unstated:masterwork").running === 10);
game.i18n.format = fmt;
libraryAbsent();

// Shield variant: make any shield a buckler, and clear back to standard.
const shieldVar = mockDoc("armor", { name: "Shield", aac: 1, armorType: "shield" });
await setShieldVariant(shieldVar, "buckler");
check("setShieldVariant sets the variant flag", shieldVar._flags.shieldVariant === "buckler");
await setShieldVariant(shieldVar, "standard");
check("setShieldVariant standard clears the flag", shieldVar._flags.shieldVariant === undefined);

SETTINGS_STATE.overlayShieldVariants = false;

/* ---------------------------------------------------------------------- */
/*  The IMPORTED scavenged table (the importer → acks-lib ruledata)        */
/* ---------------------------------------------------------------------- */

const { rowToEffects, importedTable, accumulateImported } = await import(new URL("overlays/scavenged.mjs", S));
const { scavengedOptions } = await import(new URL("actions.mjs", S));

// rowToEffects parses the READER'S OWN printed words into mechanics.
const rte = (category, effect, value) => rowToEffects({ category, effect, value });
check("imported row: '-1 damage' → damage -1, value 67%", (() => { const e = rte("Blade rusty", "-1 damage", "-33%"); return e.damage === -1 && Math.abs(e.value - 0.67) < 0.001; })());
check("imported row: '-1 to attacks' → attack -1", rte("Off balance", "-1 to attacks", "-33%").attack === -1);
check("imported row: '-1 to initiative' → initiative -1", rte("Loose hilt/haft", "-1 to initiative", "-33%").initiative === -1);
check("imported row: '+1 stone encumbrance' → encumbrance +1", rte("Broken straps", "+1 stone encumbrance", "-33%").encumbrance === 1);
check("imported row: 'cannot sneak' → cannotSneak", rte("Rattles if moved", "cannot sneak", "-33%").cannotSneak === true);
check("imported row: small-caps '-1 Ac/ breaks' → ac -1 AND breaks", (() => { const e = rte("Dented/rotting", "-1 Ac/ breaks", "-33%"); return e.ac === -1 && e.breaks === true; })());
check("imported row: 'Serviceable' at 100% → no effects, full value", (() => { const e = rte("Serviceable", "-", "100%"); return e.value === 1 && !e.damage && !e.breaks; })());
check("imported row: 'Roll again twice' flags a reroll", rte("Roll again twice", "-", "-").reroll === true);
check("imported row: an unrecognised effect is kept as a note (vessels)", rte("Faulty", "-30’ max speed", "-33%").notes[0] === "-30’ max speed");

// With no acks-lib registry present the module falls back to the baked table.
check("importedTable is null without the ruledata registry", importedTable("piercingSlashing") === null);
check("scavengedOptions falls back to the built-in rows", scavengedOptions("piercingSlashing").length === 6);

// A stub registry standing in for an imported RR p160 grid.
globalThis.acksExtras.lib = {
  tables: {
    hasDoc: (d) => d === "equipment",
    getTable: (d, t) => (d === "equipment" && t === "scavengedPiercingSlashing"
      ? {
          2: { category: "Serviceable", effect: "-", value: "100%", min: 1, max: 2 },
          6: { category: "Blade dented", effect: "-1 damage", value: "-33%", min: 3, max: 6 },
          20: { category: "Roll again twice", effect: "-", value: "-", min: 19, max: 20 },
        }
      : {}),
    bracketRow: (rows, v) => rows.find((r) => v >= Number(r.min) && v <= Number(r.max)) ?? null,
  },
};
check("importedTable resolves through the ruledata registry", !!importedTable("piercingSlashing"));
check("scavengedOptions lists the IMPORTED categories (reroll row excluded)", (() => { const o = scavengedOptions("piercingSlashing"); return o.length === 2 && o[1].label === "Blade dented"; })());
check("accumulateImported applies the imported row's mechanics", (() => { const c = accumulateImported("piercingSlashing", [4]); return c.damage === -1 && c.labels[0] === "Blade dented"; })());
check("accumulateImported: the reroll row itself contributes nothing", accumulateImported("piercingSlashing", [19]).labels.length === 0);
delete globalThis.acksExtras.lib;

/* ---------------------------------------------------------------------- */
/*  Named-item tracker display (ladder + legacy unlocked/max records)      */
/* ---------------------------------------------------------------------- */

const namedMod = await import(new URL("overlays/named.mjs", S));
const namedDoc = (rec) => ({ type: "weapon", system: { bonus: 0, damage: "1d6", weight6: 1 }, getFlag: (_m, k) => (k === "named" ? rec : undefined) });
// A modern record: ladder drives both mechanics and display.
const ladderRec = { trueName: "X", ladder: ["damage", "hit", "damage"], unlocked: 2 };
check("named maxOf reads the ladder length", namedMod.maxOf(namedDoc(ladderRec)) === 3);
check("named unlockedDisplay matches mechanics on a ladder record", namedMod.unlockedDisplay(namedDoc(ladderRec)) === 2);
// A LEGACY record (unlocked/max, no ladder) must still DISPLAY its progress.
const legacyRec = { trueName: "X", unlocked: 1, max: 3 };
check("legacy record: maxOf falls back to max", namedMod.maxOf(namedDoc(legacyRec)) === 3);
check("legacy record: unlockedDisplay shows 1/3 (mechanics stay 0 without a ladder)", namedMod.unlockedDisplay(namedDoc(legacyRec)) === 1 && namedMod.unlockedCount(namedDoc(legacyRec)) === 0);
check("legacy record: no bonuses apply without a ladder", Object.values(namedMod.unlockedBonuses(namedDoc(legacyRec))).every((v) => v === 0));
// Revealed → full power on a ladder record.
check("revealed ladder record displays full", namedMod.unlockedDisplay(namedDoc({ ...ladderRec, revealed: true })) === 3);

/* --- Tracker visibility: disguise hides named status from players ------- */
const tv = namedMod.trackerVisible;
check("named + undisguised: visible to players", tv({ isNamed: true, disguised: false, isGM: false, overlayOn: false }) === true);
check("named + DISGUISED: hidden from players", tv({ isNamed: true, disguised: true, isGM: false, overlayOn: true }) === false);
check("named + disguised: GM still sees it", tv({ isNamed: true, disguised: true, isGM: true, overlayOn: false }) === true);
check("unnamed: GM offered the badge only with the overlay on", tv({ isNamed: false, disguised: false, isGM: true, overlayOn: true }) === true && tv({ isNamed: false, disguised: false, isGM: true, overlayOn: false }) === false);
check("unnamed: players never see a badge", tv({ isNamed: false, disguised: false, isGM: false, overlayOn: true }) === false);

/* --- Re-name (JJ p399): a state edit, never overlay-gated ---------------- */
const rn = namedMod.renameUpdates(namedDoc(ladderRec), "Doom of Giants", 4);
check("rename sets the document name and givenName", rn.name === "Doom of Giants" && rn["flags.acks-extras.named.givenName"] === "Doom of Giants");
check("rename guarantees at least one unlocked rung", rn["flags.acks-extras.named.unlocked"] >= 1);
const fresh = namedMod.renameUpdates(namedDoc({ trueName: "X" }), "New Name", 2);
check("first naming captures the mundane base", !!fresh["flags.acks-extras.named.base"]);

/* ---------------------------------------------------------------------- */
/*  Enclosing helm (RR p140) — light/heavy detection                       */
/* ---------------------------------------------------------------------- */

check("helmetType: a 'Heavy Helmet' reads heavy (enclosing)", helmetType(mockDoc("armor", { name: "Heavy Helmet" })) === "heavy");
check("helmetType: a 'Light Helmet' reads light", helmetType(mockDoc("armor", { name: "Light Helmet" })) === "light");
check("helmetType: a 'Great Helm' reads heavy by name", helmetType(mockDoc("armor", { name: "Great Helm" })) === "heavy");
check("helmetType: an explicit flag wins over the name", (() => { const h = mockDoc("armor", { name: "Great Helm" }); h._flags.helmet = "light"; return helmetType(h) === "light"; })());
check("helmetType: a non-helmet is null", helmetType(mockDoc("armor", { name: "Plate" })) === null && helmetType(mockDoc("weapon", { name: "Sword" })) === null);
check("isEnclosingHelm true only for a heavy helm", isEnclosingHelm(mockDoc("armor", { name: "Heavy Helmet" })) && !isEnclosingHelm(mockDoc("armor", { name: "Light Helmet" })));

/* ---------------------------------------------------------------------- */
/*  Spellbook (RR p145 pages, p390 value)                                  */
/* ---------------------------------------------------------------------- */

check("parseSpellList reads name + trailing level in three shapes", (() => {
  const p = parseSpellList("Fireball, 3\nMagic Missile 1\nShield (1)");
  return p.length === 3 && p[0].name === "Fireball" && p[0].lvl === 3 && p[1].name === "Magic Missile" && p[1].lvl === 1 && p[2].name === "Shield" && p[2].lvl === 1;
})());
// A spell book is a RECOGNISED item class (the RR "Spell Book"), not a toggle
// switched on for arbitrary gear.
check("isSpellbook recognises the RR Spell Book / grimoire by name", isSpellbook(mockDoc("item", { name: "Spell Book" })) && isSpellbook(mockDoc("item", { name: "Grimoire" })));
check("isSpellbook is false for ordinary gear and for non-items", !isSpellbook(mockDoc("item", { name: "Backpack" })) && !isSpellbook(mockDoc("weapon", { name: "Spell Book" })));
const book = mockDoc("item", { name: "Spell Book" });
await setSpellbookSpells(book, [{ name: "A", lvl: 1 }, { name: "B", lvl: 3 }]);
check("spellbook pages used = sum of levels (1+3)", pagesUsed(book) === 4);
check("spellbook value = 20 + 1000×(1+3)", spellbookValue(book) === 4020);
check("spellbook under 100 pages is not over capacity", !bookOver(book));
await setSpellbookSpells(book, Array.from({ length: 20 }, (_, i) => ({ name: `S${i}`, lvl: 6 })));
check("spellbook over 100 pages flags over capacity (120 > 100)", bookOver(book));
// A stored spell list keeps a renamed book recognised (identity survives rename).
const renamed = mockDoc("item", { name: "Old Tome" });
check("a non-matching name is not a spell book yet", !isSpellbook(renamed));
await setSpellbookSpells(renamed, [{ name: "X", lvl: 2 }]);
check("a stored spell list keeps a renamed book recognised", isSpellbook(renamed));

/* ---------------------------------------------------------------------- */
/*  Material picker + apparent-value disguise (GM tool)                    */
/* ---------------------------------------------------------------------- */

check("the material vocabulary is the imported table's words, and empty without one", materialVocabulary(null).length === 0 && materialVocabulary({ zork: ["wood", "metal"], quux: ["cloth"] }).join() === "cloth,metal,wood");
const matItem = mockDoc("weapon", { name: "Mystery Rod" });
await setMaterial(matItem, "wood");
check("setMaterial stamps the flag; materialOf reads it", matItem._flags.material === "wood" && materialOf(matItem) === "wood");
await setMaterial(matItem, "auto");
check("setMaterial(auto) clears the flag → falls back to the guess", matItem._flags.material === undefined);

const magic = mockDoc("weapon", { name: "Flametongue", cost: 5000, damage: "1d6+2" });
await disguiseItem(magic, { name: "Old Sword", cost: 7, damage: "1d6" });
check("disguise shows the apparent name/value/damage", magic.name === "Old Sword" && magic.system.cost === 7 && magic.system.damage.base.formula === "1d6");
check("disguise keeps the true identity hidden in a flag", isDisguised(magic) && magic._flags.disguise.true.name === "Flametongue" && magic._flags.disguise.true.cost === 5000);
await revealItem(magic);
check("reveal restores the true item + clears the disguise", magic.name === "Flametongue" && magic.system.cost === 5000 && magic.system.damage.base.formula === "1d6+2" && !isDisguised(magic));

/* ---------------------------------------------------------------------- */
/*  The Judge's override: granting gear, and clearing hands to hold it     */
/* ---------------------------------------------------------------------- */

const { grantGear, clearHands, findGearSource, findGearEntry } = await import(new URL("grant.mjs", S));

/** An actor that can be given items — enough shape for grantGear/clearHands. */
const grantee = (items = []) => {
  const a = {
    id: "g1",
    type: "character",
    name: "Nolan",
    items,
    system: {},
    effects: [],
    appliedEffects: [],
    isOwner: true,
    getFlag: () => undefined,
    async createEmbeddedDocuments(_type, data) {
      const made = data.map((d, n) => ({
        ...d,
        id: `new${n}`,
        getFlag: () => undefined,
        async update(u) { for (const [k, v] of Object.entries(u)) if (k === "system.equipped") this.system.equipped = v; },
      }));
      a.items.push(...made);
      return made;
    },
  };
  a.items.find ??= Array.prototype.find;
  return a;
};

const QUILL = { pattern: /quill/i, name: "Quill, writing", label: "kit.quill" };
const PARCHMENT = {
  pattern: /parchment/i,
  name: "Parchment",
  label: "kit.parchment",
  fallback: { system: { quantity: { value: 1, max: 0 }, cost: 1, weight6: 0 } },
};

// No world items and no compendia in this harness, so every grant falls back to
// the synthesized stand-in — which is the path a world without the system's
// equipment pack takes too.
check("findGearSource returns null when nothing in the world carries the name", (await findGearSource("Parchment")) === null);

const empty = grantee();
const madeBoth = await grantGear(empty, [QUILL, PARCHMENT]);
check("grantGear creates every missing piece", madeBoth.length === 2 && empty.items.length === 2);
check("granted gear is physical, so the pattern that wanted it now finds it",
  empty.items.every((i) => i.system.cost !== undefined && i.system.weight6 !== undefined));
check("the fallback price rides on the spec, not on the grant helper",
  empty.items.find((i) => i.name === "Parchment").system.cost === 1);

const again = await grantGear(empty, [QUILL, PARCHMENT]);
check("granting twice is a no-op — gear already carried is left alone", again.length === 0 && empty.items.length === 2);

const halfKitted = grantee([{ id: "q", name: "Swan Quill", type: "item", system: { cost: 1, weight6: 0 } }]);
await grantGear(halfKitted, [QUILL, PARCHMENT]);
check("only the missing half is supplied", halfKitted.items.length === 2 && halfKitted.items.filter((i) => /quill/i.test(i.name)).length === 1);

// A narrowed search (the markets' shop sources) skips what it is told to; the
// default, which every grant takes, searches the world and every Item pack.
{
  const saved = { items: globalThis.game.items, packs: globalThis.game.packs };
  const quillDoc = (uuid) => ({ uuid, name: "Quill, writing", toObject: () => ({ name: "Quill, writing", type: "item", system: { cost: 1 } }) });
  const packOf = (collection, id) => ({
    collection,
    documentName: "Item",
    index: [{ _id: id, name: "Quill, writing" }],
    getDocument: async () => quillDoc(`Compendium.${collection}.Item.${id}`),
  });
  globalThis.game.items = [quillDoc("Item.w1")];
  globalThis.game.packs = [packOf("mod.alpha", "a1"), packOf("mod.beta", "b1")];
  check("by default the world's item answers first", (await findGearEntry("Quill, writing"))?.uuid === "Item.w1");
  check("world: false searches the packs only", (await findGearEntry("Quill, writing", { world: false }))?.uuid === "Compendium.mod.alpha.Item.a1");
  check("a pack the scope refuses is not searched", (await findGearEntry("Quill, writing", { world: false, pack: (p) => p.collection !== "mod.alpha" }))?.uuid === "Compendium.mod.beta.Item.b1");
  check("a scope refusing everything finds nothing", (await findGearEntry("Quill, writing", { world: false, pack: () => false })) === null);
  const kitted = grantee();
  await grantGear(kitted, [QUILL]);
  check("a grant is never narrowed: it takes the world's item", kitted.items.length === 1 && kitted.items[0].system.cost === 1);
  globalThis.game.items = saved.items;
  globalThis.game.packs = saved.packs;
}

// Gear known by what it is, not by a name: the grant hands over the stack the
// pattern matches that holds the most. Names and counts invented.
{
  const saved = { items: globalThis.game.items, packs: globalThis.game.packs };
  const doc = (name, qty) => ({ name, toObject: () => ({ name, type: "item", system: { quantity: { value: qty }, cost: 2 } }) });
  const packOf = (collection, rows) => ({
    collection,
    documentName: "Item",
    getIndex: async () => rows.map(([id, name, qty]) => ({ _id: id, name, system: qty == null ? {} : { quantity: { value: qty } } })),
    getDocument: async (id) => { const [, name, qty] = rows.find(([rid]) => rid === id); return doc(name, qty ?? 1); },
  });
  const { findGearByPattern } = await import(new URL("grant.mjs", S));
  const STICK = { pattern: /glowstick/i, label: "kit.glowstick" };
  globalThis.game.items = [];
  globalThis.game.packs = [
    packOf("mod.alpha", [["a1", "Glowstick", 1], ["a2", "Rope"]]),
    packOf("mod.beta", [["b1", "Glowsticks, bundle", 9], ["b2", "Glowstick spare", null]]),
  ];
  check("the largest matching stack across the packs answers", (await findGearByPattern(STICK.pattern))?.name === "Glowsticks, bundle");
  const lit = grantee();
  await grantGear(lit, [STICK]);
  check("a nameless spec grants that stack", lit.items.length === 1 && lit.items[0].system.quantity.value === 9);
  globalThis.game.items = [doc("Glowstick, the Judge's", 2)];
  check("the world's items answer first, a Judge's own over any pack", (await findGearByPattern(STICK.pattern))?.name === "Glowstick, the Judge's");
  globalThis.game.items = [];
  globalThis.game.packs = [];
  check("nothing matching, nothing found", (await findGearByPattern(STICK.pattern)) === null);
  const bare = grantee();
  await grantGear(bare, [STICK]);
  check("with no source, the stand-in is named by its label", bare.items.length === 1 && bare.items[0].name === "kit.glowstick");
  globalThis.game.items = saved.items;
  globalThis.game.packs = saved.packs;
}

// clearHands: shields go first, then weapons newest-first, and it stops as soon
// as there is room rather than stripping the character bare. The fixtures need a
// real `update`, since sheathing is a write.
const writable = (item) => ({
  ...item,
  async update(u) { for (const [k, v] of Object.entries(u)) if (k === "system.equipped") this.system.equipped = v; },
});
const armed = grantee([
  writable(weapon("Sword", { melee: true, id: "sw" })),
  writable(armor("Shield", "shield", { ac: 1, id: "sh" })),
]);
check("both hands start full", getLoadout(armed).handsFree === 0);
const cleared = await clearHands(armed, 1);
check("clearHands frees exactly one hand", cleared.handsSpare === 1 && cleared.released.length === 1);
check("the shield is what gives way first", cleared.released[0].id === "sh");
check("the sword stays in hand", armed.items.find((i) => i.id === "sw").system.equipped === true);

const greatsworder = grantee([writable(weapon("Two-Handed Sword", { melee: true, id: "ths" }))]);
const bigClear = await clearHands(greatsworder, 2);
check("a two-handed weapon buys both hands in one release", bigClear.handsSpare === 2 && bigClear.released.length === 1);

const alreadyFree = grantee([]);
const noop = await clearHands(alreadyFree, 1);
check("clearHands disturbs nothing when a hand is already free", noop.released.length === 0 && noop.handsSpare === 2);

/* ---------------------------------------------------------------------- */
/*  Silver (RR ch.4) — the one material that changes what a weapon counts as */
/* ---------------------------------------------------------------------- */

const { isSilvered, canBeSilvered, dealsExtraordinaryDamage } = await import(new URL("silver.mjs", S));
const { layerDeltas } = await import(new URL("properties.mjs", S));
const { weaponKey } = await import(new URL("profiles.mjs", S));
const weaponKeyOf = (name) => weaponKey({ name });

/** An item whose silver flag (and any other) is whatever the caller states. */
const silverItem = (name, type = "weapon", flags = {}) => ({
  name, type,
  system: { cost: 10, weight6: 1, damage: "1d4" },
  getFlag: (_m, k) => flags[k],
});

// The table entry. Silver Dagger is the one RAW weapon carrying the quality.
check("the RAW Silver Dagger counts as silver", isSilvered(silverItem("Silver Dagger")));
check("an ordinary dagger does not", !isSilvered(silverItem("Dagger")));

// The name, for the silvered version of any other common weapon RAW allows.
check("a silvered sword counts as silver", isSilvered(silverItem("Silvered Sword")));
check("a silver-coated spear counts as silver", isSilvered(silverItem("Silver-Coated Spear")));

// An explicit answer overrules both. `false` is a real answer, not an absence:
// it is how a reader denies a name that says silver when the item is not.
check("an explicit yes silvers an ordinary blade", isSilvered(silverItem("Sword", "weapon", { silvered: true })));
check("an explicit no overrules the name", !isSilvered(silverItem("Silver Dagger", "weapon", { silvered: false })));

// Silver is a WEAPON quality. Armour and ordinary gear cannot carry it however
// they are named, so nothing downstream reads silver off a silver ring.
check("armour cannot be silvered", !canBeSilvered(silverItem("Silvered Plate", "armor")));
check("a silver ring is not a silver weapon", !isSilvered(silverItem("Silver Ring", "item")));
check("ammunition can be silvered", isSilvered(silverItem("Silver Arrow", "item")));

// The three rulings collapse into one question, which the monsters feature's
// own weapon flag already asks.
check("silver deals extraordinary damage", dealsExtraordinaryDamage(silverItem("Silver Dagger")));
check("an already-extraordinary weapon still does", dealsExtraordinaryDamage(silverItem("Sword", "weapon", { extraordinary: true })));
check("an ordinary sword does not", !dealsExtraordinaryDamage(silverItem("Sword")));

// PRICE. Plating scales the weapon's own listed price by the imported
// document's multiplier; a masterwork surcharge is a flat addition and must
// not be scaled with it. The figures are the invented ones registered above.
useLibrary(IMPORTED_VARIATIONS);
const silverOnly = layerDeltas(silverItem("Sword"), { silvered: true, masterwork: null, scavenged: null });
check("silver scales the listed price by the document's multiplier", silverOnly.costBaseMul === FIG.silver && silverOnly.costAdd === 0);
check("silver moves no other number", !silverOnly.bonus && !silverOnly.damage && !silverOnly.ac && !silverOnly.weight6);
const silverMw = layerDeltas(silverItem("Sword"), { silvered: true, masterwork: "weaponToHit", scavenged: null });
const silverMwPrice = 10 * silverMw.costBaseMul + silverMw.costAdd;
check("a masterwork surcharge is added after plating, never scaled by it", silverMwPrice === 10 * FIG.silver + FIG.hit.add);
libraryAbsent();

// The quality survives a decorated name. `dagger` is declared before
// `silverdagger` in the weapon table, so table order alone answered "dagger".
check("a decorated Silver Dagger keeps its quality", weaponKeyOf("Silver Dagger, masterwork") === "silverdagger");
check("an ordinary decorated dagger is still a dagger", weaponKeyOf("Dagger, masterwork") === "dagger");

/* ---------------------------------------------------------------------- */
/*  Weapon identity — a declaration outranks the name                       */
/* ---------------------------------------------------------------------- */
//
// The name is the only source that can be wrong about an item everything else
// describes correctly: a starting template renames the gear it grants to the
// words its own page printed, so a hand axe arrives called "Francisca" and a
// two-handed sword called "Two-handed iron sword".

const { weaponIdentity, isUnidentifiedWeapon, classifyWeapon: classify, handCost: cost, inferredGrips: guessGrips } =
  await import(new URL("profiles.mjs", S));
/** A weapon document as a plain object — the shape a build payload has. */
const weap = (name, mine = {}) => ({ name, type: "weapon", system: { damage: "1d6", melee: true }, flags: { "acks-extras": mine } });

check("a name nothing matches identifies nothing",
  weaponIdentity(weap("Francisca")).key === null && isUnidentifiedWeapon(weap("Francisca")));
check("a skinned base identifies the weapon its descriptor hid",
  weaponIdentity(weap("Francisca", { skin: { base: "def.weapon.handAxe", baseName: "Hand Axe" } })).key === "handaxe");
check("the skinned base is reported as the source",
  weaponIdentity(weap("Francisca", { skin: { baseName: "Hand Axe" } })).source === "skin");
check("a recorded base beats the LOOSE name match that was wrong",
  weaponIdentity(weap("Two-handed iron sword", { skin: { base: "def.weapon.twoHandedSword" } })).key === "twohandedsword");
check("without it, the loose match still answers as it always did",
  weaponIdentity(weap("Two-handed iron sword")).key === "sword");
// A catalogue name printed head-first is the weapon it names, not a loose
// match: read only as written it contains the one-handed sword, and the item
// took that row's grip choice and its dice.
const headFirst = weap("Sword, Two-Handed");
check("a head-first catalogue name identifies by name",
  weaponIdentity(headFirst).key === "twohandedsword" && weaponIdentity(headFirst).source === "name");
check("so it costs both hands and offers no second grip row",
  cost(classify(headFirst), { twoHanded: false }) === 2 && classify(headFirst).damage2h === null);
check("a head-first skinned base reads the same way",
  weaponIdentity(weap("Two-handed iron sword", { skin: { baseName: "Sword, Two-Handed" } })).key === "twohandedsword");
check("an importer-minted row identifies by its cookbook id",
  weaponIdentity(weap("Hachereau", { cookbook: { id: "def.weapon.battleAxe" } })).source === "mint");
check("an exact name outranks the base it was cut from",
  weaponIdentity(weap("Silver Dagger", { skin: { base: "def.weapon.dagger" } })).key === "silverdagger");
check("a declared type outranks every inference",
  weaponIdentity(weap("Francisca", { profileKey: "greataxe", skin: { base: "def.weapon.handAxe" } })).key === "greataxe");
check("ignoreDeclared reports what the ladder would say without it",
  weaponIdentity(weap("Francisca", { profileKey: "greataxe", skin: { base: "def.weapon.handAxe" } }), { ignoreDeclared: true }).key === "handaxe");
check("a cookbook id outside the weapon table names nothing",
  weaponIdentity(weap("Case", { cookbook: { id: "def.weapon.case20Bolts" } })).key === null);
// An unidentified weapon has no class: nothing imported places it.
check("an identified Francisca carries the axe category",
  classify(weap("Francisca", { skin: { base: "def.weapon.handAxe" } })).cat === "axe");
check("an unidentified one has no class", classify(weap("Francisca")).cat === null);

// GRIPS: the declaration answers ahead of the size derivation, both ways.
const gripped = (grips) => classify(weap("Hand Axe", grips ? { grips } : {}));
check("a small weapon takes one hand by the table", cost(gripped(null), { twoHanded: true }) === 1);
check("declaring two-handed makes it cost two", cost(gripped("2h"), { twoHanded: false }) === 2);
check("declaring versatile costs one or two", cost(gripped("versatile"), { twoHanded: false }) === 1 && cost(gripped("versatile"), { twoHanded: true }) === 2);
check("a junk grip value is ignored rather than obeyed", gripped("three-handed").grips === null);
check("the inferred grip set is what the control shows beside Auto",
  guessGrips(classify(weap("Hand Axe"))) === "1h" && guessGrips(classify(weap("Sword"))) === "versatile" && guessGrips(classify(weap("Two-Handed Sword"))) === "2h");
check("only weapons can be unidentified", !isUnidentifiedWeapon({ name: "Rope", type: "item" }));

/* ---------------------------------------------------------------------- */
/*  One loadout effect, however many syncs ask for it                       */
/* ---------------------------------------------------------------------- */
//
// `syncLoadoutEffect` is read-modify-write. Every route into it is an async
// hook, and one user action routinely fires several at once — creating a
// character's items is ONE `createEmbeddedDocuments` call and one `createItem`
// hook PER ITEM, which is what importing a character does. Run concurrently
// they all read "no effect yet" before any has finished writing, and the actor
// ends up wearing four copies of its own loadout effect with every bonus
// multiplied by four. Caught live on a bladedancer: +4 initiative for a +1
// power.
const { syncLoadoutEffect: syncLE } = await import(new URL("effects.mjs", S));
const { refreshLoadout: refreshLO } = await import(new URL("enforce.mjs", S));

/** An actor whose embedded-document writes settle asynchronously, as real ones do. */
const effectActor = (items) => {
  const a = withItems(items);
  a.uuid = "Actor.race";
  a.isOwner = true;
  a.effects = [];
  a.effects.find = Array.prototype.find.bind(a.effects);
  a.effects.filter = Array.prototype.filter.bind(a.effects);
  a.createEmbeddedDocuments = async (_t, docs) => {
    await new Promise((r) => setTimeout(r, 5)); // the write is not instant
    for (const d of docs) {
      a.effects.push({
        id: `fx${a.effects.length}`,
        ...d,
        getFlag: (_m, k) => (k === "loadout" ? true : undefined),
        update: async (patch) => Object.assign(a.effects.find((e) => e.id === `fx${0}`) ?? {}, patch),
        delete: async () => { a.effects.splice(a.effects.findIndex((e) => e.id === `fx${0}`), 1); },
      });
    }
    return docs;
  };
  a.deleteEmbeddedDocuments = async (_t, ids) => {
    await new Promise((r) => setTimeout(r, 5));
    for (const id of ids) {
      const i = a.effects.findIndex((e) => e.id === id);
      if (i >= 0) a.effects.splice(i, 1);
    }
    return ids;
  };
  return a;
};

const managedCount = (a) => a.effects.filter((e) => e.getFlag?.("acks-extras", "loadout") === true).length;

// Four hooks firing at once is the ordinary case, not a stress test. The
// ability's one typed initiative modifier is the bonus a duplicate would multiply.
const quick = () => abil("Quick", "def.power.quick", { effects: [{ type: "modifier", target: "initiative", value: 1 }] });
const racer = effectActor([quick(), weapon("Sword", { melee: true, id: "rsw" })]);
racer.getFlag = (_m, k) => (k === "styles" ? "single,twoHanded" : undefined);
await Promise.all([refreshLO(racer), refreshLO(racer), refreshLO(racer), refreshLO(racer)]);
check("four concurrent syncs leave exactly one loadout effect", managedCount(racer) === 1);
check("and it carries the bonus once, not four times",
  racer.effects[0].changes.filter((c) => c.key === "system.initiative.mod").reduce((s, c) => s + Number(c.value), 0) === 1);

// A world that already has duplicates is repaired on the next ordinary sync,
// so nobody has to be told to go looking for them.
const dupes = effectActor([quick(), weapon("Sword", { melee: true, id: "dsw" })]);
dupes.getFlag = (_m, k) => (k === "styles" ? "single,twoHanded" : undefined);
await dupes.createEmbeddedDocuments("ActiveEffect", [
  { changes: [{ key: "system.initiative.mod", type: "add", value: "1" }], flags: { "acks-extras": { loadout: true } } },
  { changes: [{ key: "system.initiative.mod", type: "add", value: "1" }], flags: { "acks-extras": { loadout: true } } },
  { changes: [{ key: "system.initiative.mod", type: "add", value: "1" }], flags: { "acks-extras": { loadout: true } } },
]);
check("three duplicates exist before the repair", managedCount(dupes) === 3);
await syncLE(dupes, getLoadout(dupes));
check("an ordinary sync collapses them to one", managedCount(dupes) === 1);

// Two connections of the active GM user both pass `primaryResponder`, and
// `queueSync` serialises one client's writes, never two clients'. Both read "no
// effect yet"; the fixed `_id` turns the second create into a refusal the
// server enforces (docs/equipment/DECISIONS.md, "One loadout effect per actor,
// whoever writes it (2026-10-15)").
const { LOADOUT_EFFECT_ID: LOADOUT_ID } = await import(new URL("constants.mjs", S));
/** One world's stored effects and the clients viewing it; a create of an `_id` it holds is refused, as the server refuses one. */
const sharedWorld = (items) => {
  const stored = [];
  const views = [];
  const view = (doc) => ({ ...doc, id: doc._id, getFlag: (_m, k) => (k === "loadout" ? true : undefined) });
  const client = () => {
    const a = withItems(items);
    a.uuid = "Actor.shared";
    a.isOwner = true;
    a.getFlag = (_m, k) => (k === "styles" ? "single,twoHanded" : undefined);
    a.effects = stored.map(view);
    a.effects.has = (id) => a.effects.some((e) => e.id === id);
    a.createEmbeddedDocuments = async (_t, docs, { keepId = false } = {}) => {
      await new Promise((r) => setTimeout(r, 5));
      for (const d of docs) {
        const id = keepId && d._id ? d._id : `fx${stored.length}`;
        if (stored.some((s) => s._id === id)) throw new Error(`The _id [${id}] already exists within the parent collection`);
        stored.push({ ...d, _id: id });
        for (const v of views) v.effects.push(view({ ...d, _id: id }));
      }
      return docs;
    };
    views.push(a);
    return a;
  };
  return { stored, client };
};
const world = sharedWorld([quick(), weapon("Sword", { melee: true, id: "ssw" })]);
const [tabA, tabB] = [world.client(), world.client()];
let raced = null;
try {
  await Promise.all([syncLE(tabA, getLoadout(tabA)), syncLE(tabB, getLoadout(tabB))]);
} catch (err) {
  raced = err;
}
check("two clients of one GM user leave one loadout effect between them", world.stored.length === 1 && world.stored[0]._id === LOADOUT_ID);
check("and the refused create is not an error", raced === null);
check("and each client sees that one", tabA.effects.length === 1 && tabB.effects.length === 1);

/* ---------------------------------------------------------------------- */
/*  Shipped macros compile                                                 */
/* ---------------------------------------------------------------------- */

// A macro is a STRING built inside a template literal, so a mis-escaped `${` or
// backtick produces a document that only fails when a player clicks it. Compile
// each command exactly the way Macro#execute does — an async function whose body
// is the command wrapped in a BLOCK, which is what makes top-level `await`,
// `return`, and re-declaring `actor` legal — so a broken one fails here instead.
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const macros = buildMacros();
check("macros compile as Foundry runs them (async function bodies)", macros.every((m) => {
  try {
    new AsyncFunction("speaker", "actor", "token", "character", "scope", "event", `{${m.command}\n}`);
    return true;
  } catch (err) {
    console.error(`  macro "${m.name}" does not compile: ${err.message}`);
    return false;
  }
}));

console.log(`test-logic: all ${pass} checks passed`);

/* ========================================================================== */
/*  Mounted combat overlay: the pure rules shapes                             */
/* ========================================================================== */
import {
  whoMayAct,
  vehicleTransportersMayAct,
  attackSaveDue,
  damageSaveDue,
  sizeRankOf,
  heightAdvantage,
  looksWarTrained,
  SIZE_ORDER,
  registerMountedOverlay,
} from "../scripts/equipment/overlays/mounted.mjs";

/* --- war training: explicit kind wins, the default falls to the name ------ */
assert.equal(looksWarTrained({ name: "QA War Steed", system: { animal: { training: "untrained" } } }), true,
  "the schema-initial 'untrained' reads as unstated, so the name decides");
assert.equal(looksWarTrained({ name: "QA War Steed", system: { animal: { training: "riding" } } }), false,
  "an explicit non-war kind is authoritative over the name");
assert.equal(looksWarTrained({ name: "QA Pony", system: { animal: { training: "war" } } }), true,
  "an explicit war kind needs no name");
assert.equal(looksWarTrained({ name: "Horse, War", system: {} }), true,
  "a mount with no training field at all reads its name");
assert.equal(looksWarTrained({ name: "Dwarf Pony", system: {} }), false,
  "the name read wants the word, never the substring");

/* --- the action economy, by what the mount did ---------------------------- */
assert.equal(whoMayAct("moved").kind, "oneOf", "a moved mount: one of the three acts");
assert.equal(whoMayAct("stationary").kind, "mountOr", "stationary: the mount, or the riders");
const charge = whoMayAct("charged", { warTrained: false });
assert.ok(charge.kind === "charge" && charge.rider && charge.passengers && !charge.mount,
  "on a charge the riders attack; an untrained mount does not");
assert.ok(whoMayAct("charged", { warTrained: true }).mount, "a war-trained mount joins the charge");

/* --- the vehicle mirror discriminates on HOW it is carried ---------------- */
assert.equal(vehicleTransportersMayAct({ carriage: "backCarried", charged: false }), true,
  "a back-carrier fights even without a charge");
assert.equal(vehicleTransportersMayAct({ carriage: "pulled", charged: false }), false,
  "a puller does not");
assert.equal(vehicleTransportersMayAct({ carriage: "pulled", charged: true }), true,
  "unless the vehicle charged");
assert.equal(vehicleTransportersMayAct({ carriage: "handCarried", charged: true }), false,
  "a palanquin's bearers never fight");

/* --- the save triggers ---------------------------------------------------- */
assert.equal(attackSaveDue({ hasWaiver: false }), true, "no Riding, no Mounted Combat: save after every attack");
assert.equal(attackSaveDue({ hasWaiver: true }), false, "either proficiency holds the seat");
assert.equal(damageSaveDue({ militarySaddle: false, hasBothProficiencies: false }), true,
  "damage without a military saddle owes the save");
assert.equal(damageSaveDue({ militarySaddle: true, hasBothProficiencies: false }), false,
  "the saddle waives it");
assert.equal(damageSaveDue({ militarySaddle: false, hasBothProficiencies: true }), false,
  "so does holding BOTH proficiencies");

/* --- the size ladder and height advantage --------------------------------- */
assert.ok(SIZE_ORDER.indexOf("man") < SIZE_ORDER.indexOf("large"), "the ladder rises");
assert.equal(sizeRankOf("nonsense"), sizeRankOf("man"), "an unstated size is man-sized");
assert.equal(heightAdvantage({ attackerMountSize: "large", defenderSize: "man" }), true,
  "a large mount stands over a footman");
assert.equal(heightAdvantage({ attackerMountSize: "large", defenderSize: "man", defenderMountSize: "huge" }), false,
  "but not over a rider on something bigger — the TARGET'S mount is what counts");
assert.equal(heightAdvantage({ attackerMountSize: "large", defenderSize: "man", defenderMountSize: "large" }), false,
  "equal mounts confer nothing");

console.log("test-equipment: OK (mounted economy, vehicle mirror, save triggers, height)");

/* --- the damage prompt: said once, by the primary GM, whoever dealt it ---- */
// A pre-update hook runs only on the client making the change, and an update
// hook on every client. Each "client" below is the same hooks fired with a
// different seat marked as self.
{
  const handlers = {};
  const said = [];
  const saved = { Hooks: globalThis.Hooks, ChatMessage: globalThis.ChatMessage, users: game.users, actors: game.actors, scenes: game.scenes };
  globalThis.Hooks = { on: (name, fn) => (handlers[name] ??= []).push(fn), once: () => {}, callAll: () => {} };
  globalThis.ChatMessage = { create: async (data) => said.push(data) };
  const fire = (name, ...args) => (handlers[name] ?? []).forEach((fn) => fn(...args));
  const settle = () => new Promise((r) => setTimeout(r, 0));

  const primary = { id: "gm", isGM: true, isSelf: false };
  const assistant = { id: "agm", isGM: true, isSelf: false };
  const player = { id: "player", isGM: false, isSelf: false };
  game.users = Object.assign([primary, assistant, player], { activeGM: primary });
  const clients = [player, assistant, primary];
  const on = (seat) => clients.forEach((u) => (u.isSelf = u === seat));
  const everywhere = async (...args) => {
    for (const seat of clients) {
      on(seat);
      fire("updateActor", ...args);
    }
    await settle();
  };

  const actor = (id, { uuid = `Actor.${id}`, rides = null } = {}) => ({
    id, uuid, name: id, items: [], system: { hp: { value: 10 } },
    flags: rides ? { "acks-extras": { attachedTo: { uuid: `Actor.${rides}`, role: "rider" } } } : {},
    getFlag(scope, key) { return this.flags[scope]?.[key]; },
    testUserPermission: (u) => u.isGM || (id === "rider" && u.id === "player"),
  });
  const steed = actor("steed");
  const rider = actor("rider", { rides: "steed" });
  const steed2 = actor("steed2");
  const loner = actor("loner");
  const world = [steed, rider, steed2, loner];
  game.actors = Object.assign([...world], { get: (id) => world.find((a) => a.id === id) });
  // An unlinked token's actor: not in the world collection, riding a world
  // mount by a binding in the token's own delta.
  const cavalier = actor("cavalier", { uuid: "Scene.s.Token.t.Actor.cavalier", rides: "steed2" });
  const placed = { uuid: "Scene.s.Token.t", actorId: "cavalier", actorLink: false, _source: { delta: { flags: cavalier.flags } }, actor: cavalier };
  const scene = { tokens: Object.assign([placed], { get: (id) => (id === "t" ? placed : undefined) }) };
  game.scenes = Object.assign([scene], { get: (id) => (id === "s" ? scene : undefined) });

  registerMountedOverlay();
  SETTINGS_STATE.overlayMounted = true;
  const hurt = { system: { hp: { value: 4 } } };
  const MARK = { "acks-extras": { mountedHpFell: true } };

  // The Player lowers their own rider: only the Player's client runs the pre-update.
  on(player);
  const byPlayer = {};
  fire("preUpdateActor", rider, hurt, byPlayer);
  assert.deepEqual(byPlayer, MARK, "the pre-update marks the fall on the client that makes it, GM or not");
  await everywhere(rider, hurt, byPlayer, "player");
  assert.equal(said.length, 1, "every client hears the update, and exactly one speaks");
  assert.deepEqual(said[0].whisper, ["gm", "agm", "player"], "to every GM and the rider's player");
  const shared = { "acks-extras": { hpFell: true } };
  fire("preUpdateActor", rider, hurt, shared);
  assert.deepEqual(shared, { "acks-extras": { hpFell: true, mountedHpFell: true } }, "the mark joins the module's other operation keys");

  // The assistant GM's damage, the same.
  said.length = 0;
  on(assistant);
  const byAssistant = {};
  fire("preUpdateActor", steed, hurt, byAssistant);
  await settle();
  assert.equal(said.length, 0, "nothing is said before the update lands");
  await everywhere(steed, hurt, byAssistant, "agm");
  assert.equal(said.length, 1, "damage to the mount prompts its rider, once");

  // A write to an unlinked token's delta has the delta's own pre-update.
  said.length = 0;
  on(primary);
  const byDelta = {};
  fire("preUpdateActorDelta", { syntheticActor: cavalier }, { system: { hp: { value: 2 } } }, byDelta);
  assert.deepEqual(byDelta, MARK, "a delta's fall is marked through its synthetic actor");
  await everywhere(cavalier, {}, byDelta, "gm");
  assert.equal(said.length, 1);

  // The world mount under that token: its rider is found from the mount's side.
  said.length = 0;
  await everywhere(steed2, hurt, MARK, "player");
  assert.equal(said.length, 1, "damage to a world mount prompts its unlinked token rider, once");
  assert.deepEqual(said[0].whisper, ["gm", "agm"], "to the GMs, who own the token");

  // What is not a fall, or not this overlay's to answer.
  said.length = 0;
  for (const [why, who, changed] of [
    ["healing", rider, { system: { hp: { value: 12 } } }],
    ["no change of hit points", rider, { name: "Renamed" }],
  ]) {
    const options = {};
    fire("preUpdateActor", who, changed, options);
    assert.deepEqual(options, {}, why);
  }
  await everywhere(loner, hurt, MARK, "gm");
  await everywhere(rider, hurt, {}, "gm");
  steed.items = [{ name: "Military Saddle" }];
  await everywhere(rider, hurt, MARK, "player");
  steed.items = [];
  assert.equal(said.length, 0, "nobody riding, an unmarked update, a saddled mount: silence");
  SETTINGS_STATE.overlayMounted = false;
  const off = {};
  fire("preUpdateActor", rider, hurt, off);
  await everywhere(rider, hurt, MARK, "player");
  assert.deepEqual(off, {}, "the overlay off marks nothing");
  assert.equal(said.length, 0, "and says nothing for a mark already made");

  delete SETTINGS_STATE.overlayMounted;
  Object.assign(globalThis, { Hooks: saved.Hooks, ChatMessage: saved.ChatMessage });
  game.users = saved.users;
  game.actors = saved.actors;
  game.scenes = saved.scenes;
  console.log("test-equipment: OK (the damage prompt, once, whoever deals it)");
}

/* ---------------------------------------------------------------------- */
/*  A light burns in the hand that holds it, and the kit is listed at the   */
/*  hands (docs/equipment/DECISIONS.md, 2026-10-29)                         */
/* ---------------------------------------------------------------------- */
{
  const { roomForLight, unlitInHand, heldHandsClause: clauseOf } = await import(new URL("loadout.mjs", S));
  const priorFormation = globalThis.acksExtras.formation;
  const burning = (type, id = "L1") => ({ id, type, lit: true, bearerId: "a1" });
  const party = ({ lights = [], mapping = 0, kit = [] } = {}) => ({
    handsOccupied: () => ({ lights: lights.length, mapping, total: lights.length + mapping }),
    lightsForBearer: () => lights,
    kitInHand: () => kit,
  });
  // A readied torch is a weapon flagged `light`, under the torch's own name.
  const torchW = (over = {}) => weapon("Torch", { melee: true, missile: true, damage: "1d4", id: "tw", flags: { light: true }, ...over });
  const dagger = (over = {}) => weapon("Dagger", { melee: true, id: "dg", ...over });

  // The torch in hand absorbs the record burning in it: one hand, no clause.
  globalThis.acksExtras.formation = party({ lights: [burning("torch")] });
  const held = getLoadout(withItems([torchW(), dagger()]));
  check("a lit torch in hand is one hand, not two", held.handsUsed === 2 && held.heldLights === 0 && held.legal);
  check("the drawn torch carries the record it absorbed", held.lightsInHand.length === 1 && held.lightsInHand[0].lit === true && held.lightsInHand[0].light.id === "L1");
  check("the torch row explains the light, so the clause names nothing", clauseOf(held) === "");

  // The record outlives the sheathe: a light burning in no drawn source holds its hand.
  const sheathed = getLoadout(withItems([torchW({ equipped: false }), dagger()]));
  check("a burning record whose torch is sheathed still holds a hand", sheathed.handsUsed === 2 && sheathed.heldLights === 1 && sheathed.lightsInHand.length === 0);
  check("and the clause names it", clauseOf(sheathed) === "1 handsLights");

  // Only a record of the torch's own type is absorbed.
  globalThis.acksExtras.formation = party({ lights: [burning("lantern")] });
  const lamp = getLoadout(withItems([torchW()]));
  check("a lantern burning beside an unlit torch is a hand of its own", lamp.handsUsed === 2 && lamp.heldLights === 1 && lamp.lightsInHand[0].lit === false);

  // Room for a light: the torch already in hand is lit where it is.
  globalThis.acksExtras.formation = party();
  const bearer = withItems([torchW(), dagger()]);
  check("a drawn, unlit torch beside a dagger has room to be lit", roomForLight(bearer, "torch") === true);
  check("the same hands have no room for a lantern", roomForLight(bearer, "lantern") === false);
  check("empty hands have room for either", roomForLight(withItems([]), "torch") && roomForLight(withItems([]), "lantern"));
  // The source a flame is struck on: the drawn unlit torch, and nothing once it burns.
  check("the drawn unlit torch is the source in hand", unlitInHand(bearer, "torch")?.id === "tw" && unlitInHand(bearer, "lantern") === null);
  globalThis.acksExtras.formation = party({ lights: [burning("torch")] });
  check("a torch already burning is no longer one", unlitInHand(withItems([torchW(), dagger()]), "torch") === null);

  // A lone actor's own flag lights count like a member's.
  globalThis.acksExtras.formation = { handsOccupied: () => ({ lights: 0, mapping: 0, total: 0 }), lightsForBearer: () => null, kitInHand: () => [] };
  const alone = getLoadout(withItems([dagger()], { flags: { lights: [burning("torch", "own1")] } }));
  check("a lone actor's lit torch holds a hand", alone.handsUsed === 2 && alone.heldLights === 1);
  const aloneHeld = getLoadout(withItems([torchW(), dagger()], { flags: { lights: [burning("torch", "own1")] } }));
  check("and the torch they hold absorbs it", aloneHeld.handsUsed === 2 && aloneHeld.heldLights === 0);

  // The mapper's kit is listed at the hands, quill in the main hand and
  // parchment in the off hand, and the clause then names nothing.
  const quill = gear("Quill, writing", 0, { id: "q1" });
  const parchment = gear("Parchment", 0, { id: "p1" });
  globalThis.acksExtras.formation = party({ mapping: 2, kit: ["q1", "p1"] });
  const scribe = withItems([quill, parchment, dagger({ equipped: false })]);
  const sLo = getLoadout(scribe);
  check("the kit takes both hands", sLo.handsUsed === 2 && sLo.mappingHands === 2 && sLo.mappingKit.map((k) => k.id).join() === "q1,p1");
  check("the quill is listed in the main hand", wearLocation(scribe, quill, sLo) === WEAR.mainHand);
  check("the parchment in the off hand", wearLocation(scribe, parchment, sLo) === WEAR.offHand);
  check("both listed, the clause names nothing", sLo.mappingUnlisted === 0 && clauseOf(sLo) === "");
  check("the core inventory buckets agree", wearBuckets(scribe, sLo).map((b) => `${b.key}:${b.items.map((i) => i.id)}`).join(" ") === "mainHand:q1 offHand:p1");

  // A piece stowed in a container is still counted, and the clause says so.
  const stowedParchment = gear("Parchment", 0, { id: "p1", flags: { containedIn: "sack" } });
  const sack = gear("Sack", 0, { id: "sack", flags: { container: { capacity: 2 } } });
  const packed = withItems([quill, stowedParchment, sack]);
  const pLo = getLoadout(packed);
  check("a stowed parchment is counted but not listed", pLo.handsUsed === 2 && pLo.mappingKit.length === 1 && pLo.mappingUnlisted === 1 && clauseOf(pLo) === "1 handsMapping");
  check("and it stays stowed", wearLocation(packed, stowedParchment, pLo) === WEAR.stowed);

  // No kit carried at all: both hands named, as before.
  globalThis.acksExtras.formation = party({ mapping: 2, kit: [] });
  const bare = getLoadout(withItems([]));
  check("a mapper carrying no kit still has both hands named", bare.handsUsed === 2 && clauseOf(bare) === "2 handsMapping");

  // The overflow detail carries the unlisted count the notice reads.
  globalThis.acksExtras.formation = party({ mapping: 2, kit: ["q1", "p1"] });
  const armedScribe = getLoadout(withItems([quill, parchment, dagger()]));
  const overflow = armedScribe.violations.find((v) => v.type === VIOLATION.HAND_OVERFLOW);
  check("a mapper with a drawn dagger overflows, and the detail names no unlisted hand", !!overflow && overflow.detail.handsUsed === 3 && overflow.detail.mappingUnlisted === 0 && clauseOf(overflow.detail) === "");

  globalThis.acksExtras.formation = priorFormation;
  console.log("test-equipment: OK (a light burns in the hand that holds it; the kit is listed at the hands)");
}
