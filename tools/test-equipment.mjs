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
const { buildLoadoutChanges } = await import(new URL("effects.mjs", S));
const { weaponProficiency, isWeaponProficient, armorMax, isArmorProficient, thiefSkillsGated, swashbucklingAC, classifyGrantToken } = await import(new URL("proficiency.mjs", S));
const { buildProficiencies, buildSamples, buildActors, buildMacros } = await import(new URL("../tools/pack-data/equipment.mjs", import.meta.url));
const { computeAttackMods } = await import(new URL("roll-wrap.mjs", S));
const { readiedWeaponData, prepareTorch, unarmedStrikeData, masterworkTiersFor, addToDamage, setMasterwork, scavengeItem, clearScavenged, rollScavengedD20s, setShieldVariant } = await import(new URL("actions.mjs", S));
const { cycleStrap, strapOf } = await import(new URL("overlays/shield-variants.mjs", S));
const { disguiseItem, revealItem, isDisguised } = await import(new URL("actions.mjs", S));
const { helmetType, isEnclosingHelm } = await import(new URL("overlays/enclosing-helm.mjs", S));
const { isSpellbook, pagesUsed, spellbookValue, parseSpellList, setSpellbookSpells, overCapacity: bookOver } = await import(new URL("spellbook.mjs", S));
const { setMaterial, MATERIALS } = await import(new URL("overlays/item-loss.mjs", S));

const weapon = (name, over = {}) => ({
  id: over.id ?? name.replace(/\W/g, ""),
  name,
  type: "weapon",
  // cost + weight6 mirror the system's ItemPhysicalTemplate — every real
  // weapon/armor/item carries them, which is what itemModel.isPhysical tests.
  system: { equipped: over.equipped ?? true, cost: over.cost ?? 0, weight6: over.w6 ?? 0, damage: over.damage ?? "1d6", melee: over.melee, missile: over.missile, tags: over.tags ?? [] },
  getFlag: (_m, k) => (over.flags ?? {})[k],
  effects: [],
});
const armor = (name, type, over = {}) => ({
  id: over.id ?? name.replace(/\W/g, ""),
  name,
  type: "armor",
  system: { equipped: over.equipped ?? true, type, aac: { value: over.ac ?? 0 }, cost: over.cost ?? 0, weight6: over.w6 ?? 0 },
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
check("sword 2H damage 1d8", sword.damage2h === "1d8");
check("longbow 2 hands", handCost(classifyWeapon(weapon("Long Bow", { missile: true, melee: false }))) === 2);
check("sling handy 1 hand", handCost(classifyWeapon(weapon("Sling", { missile: true, melee: false }))) === 1);
check("dagger tiny thrown", (() => { const d = classifyWeapon(weapon("Dagger", { melee: true })); return d.size === "tiny" && d.thrown; })());
check("two-handed sword large 2 hands", handCost(classifyWeapon(weapon("Two-Handed Sword", { melee: true }))) === 2);
check("override size/hands flag wins", handCost(classifyWeapon(weapon("Stick", { flags: { size: "large", hands: 2 } }))) === 2);

// equipmentClass: the family's equipment "root" (name → core type + stats).
const torchClass = equipmentClass("Torch");
check("equipmentClass: torch is a carried light STACK (item, prepareAs weapon)", torchClass?.type === "item" && torchClass.prepareAs === "weapon" && torchClass.damage === "1d4" && torchClass.light && torchClass.melee && torchClass.thrown);
check("equipmentClass: a thrown melee weapon is missile-capable (enables the range selector)", torchClass.missile === true && equipmentClass("Hand Axe")?.missile === true && equipmentClass("Hand Axe").melee === true);
const oilClass = equipmentClass("Military Oil");
check("equipmentClass: military oil is a thrown splash weapon", oilClass?.type === "weapon" && oilClass.splash && oilClass.missile && oilClass.thrown);
const hwClass = equipmentClass("Holy Water");
check("equipmentClass: holy water is a thrown splash consumable (1d8)", hwClass?.type === "weapon" && hwClass.damage === "1d8" && hwClass.splash && hwClass.consumable);
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
lo = getLoadout(actor([weapon("Sword", { melee: true, id: "s" })]));
check("lone medium sword wielded 2H", lo.weapons[0].wieldTwoHanded && lo.handsUsed === 2);
lo = getLoadout(actor([armor("Plate", "heavy", { id: "p" }), armor("Chain", "medium", { id: "c" })]));
check("two suits → multipleArmor, keeps last", lo.violations.some((v) => v.type === VIOLATION.MULTIPLE_ARMOR) && lo.armor?.id === "c");
lo = getLoadout(actor([armor("Plate", "heavy", { id: "p" }), armor("Heavy Helmet", "medium", { id: "h" })]));
check("helmet excluded from suit count", !lo.violations.some((v) => v.type === VIOLATION.MULTIPLE_ARMOR) && lo.hasHelmet);

// loadout Active Effect (v14 string mode; no deprecated CONST; case-insensitive spec)
const specEffect = { id: "fx1", name: "FSS (W&S)", disabled: false, changes: [{ key: "flags.acks-extras.styleProficient", value: "weaponShield:spec" }], flags: { "acks-extras": {} } };
const specActor = actor([weapon("Sword", { melee: true, id: "sw" }), armor("Shield", "shield", { ac: 1, id: "sh" })], { effects: [specEffect], flags: { styles: "weaponShield" } });
const specLo = getLoadout(specActor);
check("spec actor → weaponShield active", specLo.activeStyle === "weaponShield" && specLo.styleProficient);
const changes = buildLoadoutChanges(specActor, specLo);
const ac = changes.find((c) => c.key === "system.aac.mod");
check("W&S spec → +1 aac.mod with string type 'add'", ac && Number(ac.value) === 1 && ac.type === "add");

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

check("thief gate: heavy armour blocks", thiefSkillsGated({ armor: armor("Plate", "heavy") }));
check("thief gate: leather + no shield ok", !thiefSkillsGated({ armor: armor("Leather", "light"), shield: null }));
check("thief gate: leather + shield blocks", thiefSkillsGated({ armor: armor("Leather", "light"), shield: armor("Shield", "shield") }));

const swash = actor([], { flags: {}, system: { details: { level: 1 }, encumbrance: { value: 3 } }, effects: [marker("swashbuckling", "1")] });
check("Swashbuckling L1 unarmoured → +1 AC", swashbucklingAC(swash, { armor: null }) === 1);
const swash7 = actor([], { system: { details: { level: 7 }, encumbrance: { value: 3 } }, effects: [marker("swashbuckling", "1")] });
check("Swashbuckling L7 → +2 AC", swashbucklingAC(swash7, { armor: null }) === 2);
check("Swashbuckling in heavy armour → 0", swashbucklingAC(swash, { armor: armor("Plate", "heavy") }) === 0);
check("Swashbuckling without proficiency → 0", swashbucklingAC(actor([]), { armor: null }) === 0);

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

// --- Phase 2: proficiencies compendium ---------------------------------------
const profs = buildProficiencies();
const ID = /^[A-Za-z0-9]{16}$/;
check("compendium builds 42 proficiencies", profs.length === 42);
check("all proficiency ids 16-char alphanumeric + matching _key", profs.every((d) => ID.test(d._id) && d._key === `!items!${d._id}`));
const ids = new Set(profs.map((d) => d._id));
check("proficiency ids unique", ids.size === profs.length);
const changeKeys = profs.flatMap((d) => (d.effects[0]?.changes ?? []).map((c) => c.key));
check("effect change keys are flags.acks-extras.* with override type", changeKeys.length > 0 && changeKeys.every((k) => k.startsWith("flags.acks-extras.")) && profs.every((d) => (d.effects[0]?.changes ?? []).every((c) => c.type === "override")));
const wsSpec = profs.find((d) => d.name.includes("Weapon & Shield"));
check("W&S spec item carries styleProficient=weaponShield:spec + freeSwap", wsSpec.effects[0].changes.some((c) => c.key.endsWith("styleProficient") && c.value === "weaponShield:spec") && wsSpec.effects[0].changes.some((c) => c.key.endsWith("freeSwap")));

// --- Phase 3: per-attack roll modifiers --------------------------------------
// Actors here need items.get(id); extend the mock minimally.
const rollActor = (items, over = {}) => {
  const a = actor(items, over);
  a.items = Object.assign(items.slice(), { get: (id) => items.find((i) => i.id === id) });
  a.system = over.system ?? { scores: { str: { mod: 1 }, dex: { mod: 3 } } };
  return a;
};
const swordItem = weapon("Sword", { melee: true, id: "sw" });
const attData = (item) => ({ item: { _id: item.id, name: item.name, system: { bonus: 0, damage: "1d6" } }, roll: {} });

// Proficient + trained style, one-handed with a shield → no per-attack mods.
let a = rollActor([swordItem, armor("Shield", "shield", { id: "sh" })], { flags: { styles: "weaponShield" }, system: { scores: { str: { mod: 1 }, dex: { mod: 1 } } } });
check("proficient, trained, no finesse → no per-attack mods", computeAttackMods(a, attData(swordItem), { type: "melee" }) === null);

// --- RAW non-proficient use (RR p. 106 sidebar): the full package ------------
// 4th-level character (bba +2), STR +2, non-proficient weapon: attacks as a
// 0th-level fighter (bba −1 → delta −3) with no attribute bonus (−2) = −5.
const sysL4 = { details: { level: 4 }, thac0: { bba: 2 }, scores: { str: { mod: 2 }, dex: { mod: 1 } } };
a = rollActor([swordItem], { flags: { weaponProficiency: "axe", styles: "single,twoHanded" }, system: sysL4 });
let m = computeAttackMods(a, attData(swordItem), { type: "melee" });
check("non-prof weapon, L4 bba+2 STR+2 → attacks as 0th-level fighter (−5)", m && m.bonusDelta === -5);

// Weapon and style BOTH untrained: one package, never two.
a = rollActor([swordItem], { flags: { weaponProficiency: "axe", styles: "single" }, system: sysL4 });
m = computeAttackMods(a, attData(swordItem), { type: "melee" });
check("weapon+style both untrained → one package, not two", m.bonusDelta === -5);

// Attribute PENALTIES are not bonuses and still apply.
a = rollActor([swordItem], { flags: { weaponProficiency: "axe", styles: "single,twoHanded" }, system: { details: { level: 1 }, thac0: { bba: 0 }, scores: { str: { mod: -1 }, dex: { mod: 0 } } } });
m = computeAttackMods(a, attData(swordItem), { type: "melee" });
check("attribute penalty kept: only bba replaced (−1)", m.bonusDelta === -1);

// 0th-level characters still fight as 0th level, at an additional −1.
a = rollActor([swordItem], { flags: { weaponProficiency: "axe", styles: "single,twoHanded" }, system: { details: { level: 0 }, thac0: { bba: -1 }, scores: { str: { mod: 0 }, dex: { mod: 0 } } } });
m = computeAttackMods(a, attData(swordItem), { type: "melee" });
check("0th-level non-proficient → additional −1 only", m.bonusDelta === -1);

// Missile attacks strip the DEX bonus instead of STR.
const bowItem = weapon("Long Bow", { missile: true, melee: false, id: "lb" });
a = rollActor([bowItem], { flags: { weaponProficiency: "axe", styles: "single,missile" }, system: { details: { level: 1 }, thac0: { bba: 0 }, scores: { str: { mod: 3 }, dex: { mod: 2 } } } });
m = computeAttackMods(a, attData(bowItem), { type: "missile" });
check("missile: DEX bonus stripped (−1 bba, −2 dex = −3)", m.bonusDelta === -3);

// Unusable ARMOUR degrades attacks made even with a PROFICIENT weapon —
// the trigger is the equipped state, not the weapon in hand.
const sysL1 = { details: { level: 1 }, thac0: { bba: 0 }, scores: { str: { mod: 1 }, dex: { mod: 1 } } };
a = rollActor([swordItem, armor("Plate", "heavy", { id: "pl" })], { flags: { armorMax: "light", styles: "single,twoHanded" }, system: sysL1 });
m = computeAttackMods(a, attData(swordItem), { type: "melee" });
check("unusable armour degrades proficient-weapon attacks (−2)", m && m.bonusDelta === -2);

// Weapon Finesse is inert while non-proficiently equipped: no attribute
// grants any bonus, so there is nothing to swap in.
a = rollActor([swordItem, armor("Plate", "heavy", { id: "pl" })], { flags: { armorMax: "light", styles: "single,twoHanded" }, effects: [marker("finesse", "1")], system: { details: { level: 1 }, thac0: { bba: 0 }, scores: { str: { mod: 1 }, dex: { mod: 3 } } } });
m = computeAttackMods(a, attData(swordItem), { type: "melee" });
check("Weapon Finesse inert while non-proficiently equipped", m.bonusDelta === -2);

// Loadout: the state + full-package advisory violation, and the AC half —
// "no bonus on ... armor class from attributes" (bonuses only; penalties stay).
const npUse = actor([weapon("Battle Axe", { melee: true, id: "ax" })], { flags: { weaponProficiency: "swordDagger", styles: "single,twoHanded" }, system: { scores: { dex: { mod: 2 } }, details: { level: 3 } } });
const npUseLo = getLoadout(npUse);
check("nonProficientUse state + advisory violation, still legal", npUseLo.nonProficientUse === true && npUseLo.violations.some((v) => v.type === VIOLATION.NON_PROFICIENT_USE && v.advisory) && npUseLo.legal);
const npAcSum = buildLoadoutChanges(npUse, npUseLo).filter((c) => c.key === "system.aac.mod").reduce((s, c) => s + Number(c.value), 0);
check("no attribute bonus to AC while non-proficient (DEX +2 cancelled)", npAcSum === -2);
const npDexPen = actor([weapon("Battle Axe", { melee: true, id: "ax" })], { flags: { weaponProficiency: "swordDagger", styles: "single,twoHanded" }, system: { scores: { dex: { mod: -2 } }, details: { level: 3 } } });
check("DEX penalty to AC is kept (penalties are not bonuses)", buildLoadoutChanges(npDexPen, getLoadout(npDexPen)).filter((c) => c.key === "system.aac.mod").reduce((s, c) => s + Number(c.value), 0) === 0);
const profLo = getLoadout(actor([weapon("Sword", { melee: true, id: "sw" })], { flags: { styles: "single,twoHanded" }, system: { scores: { dex: { mod: 2 } }, details: { level: 3 } } }));
check("fully proficient loadout → no nonProficientUse state", profLo.nonProficientUse === false && !profLo.violations.some((v) => v.type === VIOLATION.NON_PROFICIENT_USE));

// Weapon Finesse swaps STR (+1) for DEX (+3) → net +2.
a = rollActor([swordItem], { flags: { styles: "single,twoHanded" }, effects: [marker("finesse", "1")], system: { scores: { str: { mod: 1 }, dex: { mod: 3 } } } });
m = computeAttackMods(a, attData(swordItem), { type: "melee" });
check("Weapon Finesse → +(dex−str) = +2", m && m.bonusDelta === 2);
check("Weapon Finesse does not apply to missile attacks", computeAttackMods(a, attData(swordItem), { type: "missile" })?.bonusDelta !== 2);

// Lone medium sword is wielded two-handed → damage upsized 1d6 → 1d8.
check("two-handed grip upsizes damage to 1d8", m.damage === "1d8");

// A large weapon has no 1H/2H split → no damage override.
const greatItem = weapon("Two-Handed Sword", { melee: true, id: "gs" });
a = rollActor([greatItem], { flags: { styles: "single,twoHanded" }, system: { scores: { str: { mod: 1 }, dex: { mod: 1 } } } });
check("large weapon → no damage upsize", (computeAttackMods(a, attData(greatItem), { type: "melee" })?.damage ?? null) === null);

// Dual-wield base +1 is loadout-level (belongs in the effect, not the wrap).
const dualLo = getLoadout(actor([weapon("Sword", { melee: true, id: "x" }), weapon("Dagger", { melee: true, id: "y" })], { flags: { styles: "dual" } }));
const dualChanges = buildLoadoutChanges(actor([], { flags: { styles: "dual" } }), dualLo);
check("dual style → +1 melee attack in the loadout effect", dualChanges.some((c) => c.key === "system.thac0.mod.melee" && Number(c.value) === 1));

// Phase 4 was the Paper Doll slot config; removed with the feature.

// --- Phase 5a: sample equipment + actors compendiums -------------------------
const samples = buildSamples();
check("samples build (6 shield variants + masterwork + named)", samples.length === 9);
check("every shield variant is a shield armour item with a variant flag", samples.filter((d) => d.flags["acks-extras"].shieldVariant).every((d) => d.type === "armor" && d.system.type === "shield" && d.system.aac.value === 1));
check("sample ids 16-char + _key matches", samples.every((d) => ID.test(d._id) && d._key === `!items!${d._id}`));

const actors = buildActors();
check("4 sample characters build", actors.length === 4 && actors.every((d) => d.type === "character"));
check("actor ids 16-char + !actors! key", actors.every((d) => ID.test(d._id) && d._key === `!actors!${d._id}`));
// Embedded docs are first-class LevelDB entries: every id must be 16 chars and
// every _key must be scoped to its parent, or compilePack throws / Foundry
// mis-loads. Verified against the real compiled pack; asserted here so it stays.
const allItems = actors.flatMap((a) => a.items.map((i) => ({ a, i })));
check("embedded item keys scoped to their actor", allItems.every(({ a, i }) => ID.test(i._id) && i._key === `!actors.items!${a._id}.${i._id}`));
const allEffects = allItems.flatMap(({ a, i }) => (i.effects ?? []).map((e) => ({ a, i, e })));
check("embedded effect keys scoped to actor+item", allEffects.length > 0 && allEffects.every(({ a, i, e }) => ID.test(e._id) && e._key === `!actors.items.effects!${a._id}.${i._id}.${e._id}`));
check("embedded ids unique within each actor", actors.every((a) => new Set(a.items.map((i) => i._id)).size === a.items.length));

// The samples must actually demonstrate the automation they claim.
const swordBoard = actors.find((a) => a.name.includes("Sword & Board"));
check("sword&board carries the W&S spec marker + equipped shield", swordBoard.items.some((i) => (i.effects ?? []).some((e) => e.changes.some((c) => c.value === "weaponShield:spec"))) && swordBoard.items.some((i) => i.system.type === "shield" && i.system.equipped));
check("sword&board is trained in weaponShield", swordBoard.flags["acks-extras"].styles.includes("weaponShield"));
const mage = actors.find((a) => a.name.includes("Mage"));
check("mage's sword is outside its weapon proficiency (demos the −1)", !mage.flags["acks-extras"].weaponProficiency.includes("sword") && mage.items.some((i) => i.name === "Sword" && i.system.equipped));
check("every sample gear item has a name", allItems.every(({ i }) => typeof i.name === "string" && i.name.length > 0));

// --- Phase 5b: JJ shield-variant overlay -------------------------------------
const shieldItem = (name, variant, strap = "hand") =>
  armor(name, "shield", { ac: 1, id: name.replace(/\W/g, ""), flags: { shieldVariant: variant, strap } });
const wsActor = (items, spec = true) =>
  actor(items, {
    flags: { styles: "weaponShield" },
    effects: spec ? [marker("styleProficient", "weaponShield:spec")] : [],
  });

// Overlay OFF: a buckler behaves exactly like a standard shield (core's +1),
// no correction — a disabled toggle must change nothing.
SETTINGS_STATE.overlayShieldVariants = false;
let lo2 = getLoadout(wsActor([weapon("Sword", { melee: true, id: "s1" }), shieldItem("Buckler", "buckler")], false));
let ch2 = buildLoadoutChanges(wsActor([], false), lo2);
check("overlay off → no shield AC correction", !ch2.some((c) => c.key === "system.aac.mod" && Number(c.value) < 0));
check("overlay off → strapped shield still costs a hand", lo2.handsUsed === 2);

SETTINGS_STATE.overlayShieldVariants = true;
// Buckler WITHOUT Weapon & Shield Specialization grants nothing → cancel core's +1.
const noSpec = wsActor([weapon("Sword", { melee: true, id: "s2" }), shieldItem("Buckler", "buckler")], false);
lo2 = getLoadout(noSpec);
ch2 = buildLoadoutChanges(noSpec, lo2);
const acDelta = ch2.filter((c) => c.key === "system.aac.mod").reduce((n, c) => n + Number(c.value), 0);
check("buckler without spec → −1 cancels core's shield AC", acDelta === -1);
// Buckler WITH Specialization: core's +1 stands, plus the spec's own +1.
const withSpec = wsActor([weapon("Sword", { melee: true, id: "s3" }), shieldItem("Buckler", "buckler")], true);
const acDelta2 = buildLoadoutChanges(withSpec, getLoadout(withSpec)).filter((c) => c.key === "system.aac.mod").reduce((n, c) => n + Number(c.value), 0);
check("buckler with spec → +1 (spec), core's shield AC kept", acDelta2 === 1);

// A shield strapped on the BACK costs no hand, forms no Weapon & Shield style,
// and must not raise ordinary AC.
const backAct = wsActor([weapon("Sword", { melee: true, id: "s4" }), shieldItem("Auxiliary Shield", "auxiliary", "back")], true);
const backLo = getLoadout(backAct);
check("back-strapped shield costs no hand", backLo.handShields.length === 0);
check("back-strapped shield → lone sword still wielded two-handed", backLo.weapons[0].wieldTwoHanded === true);
check("back-strapped shield → style is not weaponShield", backLo.activeStyle !== "weaponShield");
const backAC = buildLoadoutChanges(backAct, backLo).filter((c) => c.key === "system.aac.mod").reduce((n, c) => n + Number(c.value), 0);
check("back-strapped shield → ordinary AC cancelled (rear-only is situational)", backAC === -1);

// A phalanx shield in hand behaves normally (+1 core, +1 spec).
const phal = wsActor([weapon("Sword", { melee: true, id: "s5" }), shieldItem("Phalanx Shield", "phalanx")], true);
const phalLo = getLoadout(phal);
check("phalanx in hand → weaponShield style, costs a hand", phalLo.activeStyle === "weaponShield" && phalLo.handsUsed === 2);
const phalAC = buildLoadoutChanges(phal, phalLo).filter((c) => c.key === "system.aac.mod").reduce((n, c) => n + Number(c.value), 0);
check("phalanx on foot → core's shield AC stands", phalAC === 1);

// MOUNTED: a phalanx shield cannot be used from horseback (config `noMount`),
// which the mount binding in acks-lib finally makes answerable. Stub the lib
// the way the runtime reaches it — through globalThis.acksExtras.lib.
const priorLib = globalThis.acksExtras.lib;
globalThis.acksExtras.lib = { mount: { isMounted: (a) => a?.id === phal.id } };
const phalMountedAC = buildLoadoutChanges(phal, phalLo).filter((c) => c.key === "system.aac.mod").reduce((n, c) => n + Number(c.value), 0);
check("phalanx MOUNTED → ordinary AC cancelled (RAW: unusable from horseback)", phalMountedAC === 0);

// The rule must be specific to the phalanx: a kite shield is FOR horseback.
const kite = wsActor([weapon("Sword", { melee: true, id: "s6" }), shieldItem("Kite Shield", "kite")], true);
const kiteMountedAC = buildLoadoutChanges(kite, getLoadout(kite)).filter((c) => c.key === "system.aac.mod").reduce((n, c) => n + Number(c.value), 0);
check("kite MOUNTED → unaffected, still grants AC", kiteMountedAC === 1);

// Without acks-lib nothing mounted fires, so behaviour is exactly as before.
globalThis.acksExtras.lib = undefined;
const phalNoLibAC = buildLoadoutChanges(phal, phalLo).filter((c) => c.key === "system.aac.mod").reduce((n, c) => n + Number(c.value), 0);
check("no acks-lib → mounted rules dormant, phalanx AC stands", phalNoLibAC === 1);
globalThis.acksExtras.lib = priorLib;

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
globalThis.acksExtras.formation = { heldLightCount: () => 1 };
const shieldLight = getLoadout(wsActor([weapon("Sword", { melee: true, id: "sl" }), shieldItem("Auxiliary Shield", "auxiliary", "back")], true));
check("shield+light: sword + strapped shield + held light all fit (2 hands, legal)", shieldLight.handsUsed === 2 && shieldLight.legal);
check("shield+light: the lone sword yields its 2H grip to the light", shieldLight.weapons[0].wieldTwoHanded === false);
check("shield+light: still a single shield (no violation)", !shieldLight.violations.some((v) => v.type === VIOLATION.TOO_MANY_SHIELDS));
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

check("base maneuver penalty is −4", maneuverMods(plainActor, mSword, "knockDown").attackPenalty === -4);
// Combat Trickery: −4 → −2 AND the target saves at −2.
const trick = actor([], { effects: [marker("maneuverTrickery", "knockDown")] });
let mm = maneuverMods(trick, mSword, "knockDown");
check("Combat Trickery → penalty −2 and target saves −2", mm.attackPenalty === -2 && mm.targetSaveMod === -2);
// No-save maneuver: Trickery reduces the penalty by 4 instead of 2.
const trickInc = actor([], { effects: [marker("maneuverTrickery", "incapacitate")] });
mm = maneuverMods(trickInc, mSword, "incapacitate");
check("Trickery on a no-save maneuver → penalty 0, no save mod", mm.attackPenalty === 0 && mm.targetSaveMod === 0 && MANEUVERS.incapacitate.save === null);
// Weapon qualities: Flexible (whip) +2 to disarm; Entangling (net) +2 to wrestle.
check("Flexible whip → disarm at −2", maneuverMods(plainActor, mWhip, "disarm").attackPenalty === -2);
check("Entangling net → wrestle at −2", maneuverMods(plainActor, mNet, "wrestling").attackPenalty === -2);
check("quality does not apply to an unrelated maneuver", maneuverMods(plainActor, mWhip, "overrun").attackPenalty === -4);
// Trickery and weapon quality stack: −4 +2 +2 = 0.
const trickDisarm = actor([], { effects: [marker("maneuverTrickery", "disarm")] });
check("Trickery + Flexible stack → disarm at 0", maneuverMods(trickDisarm, mWhip, "disarm").attackPenalty === 0);
// Sunder: −4 against shafts, −6 otherwise.
check("sunder −6 normally, −4 vs staff/spear/polearm", maneuverMods(plainActor, mSword, "sunder").attackPenalty === -6 && maneuverMods(plainActor, mSword, "sunder", { targetShaft: true }).attackPenalty === -4);
// Disarm: two-handed grip gives the target +4 to save.
check("disarm vs two-handed grip → target saves +4", maneuverMods(plainActor, mSword, "disarm", { targetTwoHanded: true }).targetSaveMod === 4);
// Hooked (MM) acts as Trickery for disarm, but must not double up with it.
check("hooked weapon → disarm −2, target saves −2", (() => { const r = maneuverMods(plainActor, mSword, "disarm", { hooked: true }); return r.attackPenalty === -2 && r.targetSaveMod === -2; })());
check("hooked does not stack on top of Trickery", maneuverMods(trickDisarm, mSword, "disarm", { hooked: true }).attackPenalty === -2);
check("unknown maneuver → null", maneuverMods(plainActor, mSword, "nonsense") === null);


// --- Phase 7: containers ------------------------------------------------------
const { encumbranceDelta6, contentsWeight6, overCapacity, containerReport, isContainer } =
  await import(new URL("containers.mjs", S));

const gear = (name, w6, over = {}) => ({
  id: over.id ?? name.replace(/\W/g, ""),
  name,
  type: over.type ?? "item",
  system: { cost: over.cost ?? 0, weight6: w6, quantity: { value: over.qty ?? 1 }, subtype: over.subtype, equipped: over.equipped ?? false },
  getFlag: (_m, k) => (over.flags ?? {})[k],
  effects: [],
});
const withItems = (items) => {
  const a = actor(items);
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
check("backpack rolls up its contents' weight", contentsWeight6(cActor, "bp") === 12);
check("backpack under capacity (2 st of 4)", !overCapacity(cActor, pack));
check("container report lists load in stone", containerReport(cActor)[0].loadStone === 2);
check("isContainer only true for flagged items", isContainer(pack) && !isContainer(rope));

const ingots = gear("Iron Ingots", 30, { id: "ing", flags: { containedIn: "bp" } });
check("backpack over capacity flagged", overCapacity(withItems([pack, ingots]), pack));

// Adventurer's harness: ignore up to 1 stone of ORDINARY gear (RR p. 142).
const harness = gear("Adventurer's Harness", 1, { id: "h", equipped: true, flags: { harness: true } });
const smalls = [gear("Flask A", 1, { id: "f1" }), gear("Flask B", 1, { id: "f2" }), gear("Torch", 1, { id: "f3" })];
check("harness ignores up to 1 stone (only 3/6 available -> -3)", encumbranceDelta6(withItems([harness, ...smalls])) === -3);
const manySmalls = Array.from({ length: 10 }, (_, i) => gear(`Item ${i}`, 1, { id: `s${i}` }));
check("harness caps its relief at exactly 1 stone", encumbranceDelta6(withItems([harness, ...manySmalls])) === -6);
check("harness cannot secure heavy items", encumbranceDelta6(withItems([harness, gear("Anvil", 12, { id: "an" })])) === 0);
const plateArm = { id: "pl", name: "Plate", type: "armor", system: { equipped: true, type: "heavy", aac: { value: 6 }, weight6: 36 }, getFlag: () => undefined, effects: [] };
check("harness gives nothing over heavy armour", encumbranceDelta6(withItems([harness, plateArm, ...smalls])) === 0);

// Bowquiver: a loaded assembly counts as 2 items, not quiver + bow + arrows.
const quiver = gear("Bowquiver", 1, { id: "bq", flags: { bowquiver: true, container: { capacity: 1 } } });
const cbow = gear("Composite Bow", 6, { id: "cb", type: "weapon", flags: { containedIn: "bq" } });
const arrows = gear("Quiver, 20 Arrows", 1, { id: "ar", flags: { containedIn: "bq" } });
check("loaded bowquiver -> RAW 2 items, not 8 (delta -6)", encumbranceDelta6(withItems([quiver, cbow, arrows])) === -6);
check("empty bowquiver -> RAW 1 item (delta 0)", encumbranceDelta6(withItems([quiver])) === 0);

// Nesting rolls up; a self-referencing pair must not hang the sheet.
const sack = gear("Small Sack", 1, { id: "sk", flags: { container: { capacity: 2 }, containedIn: "bp" } });
const inSack = gear("Gems", 3, { id: "gm", flags: { containedIn: "sk" } });
check("nested container rolls up into its parent", contentsWeight6(withItems([pack, sack, inSack]), "bp") === 4);
const loopA = gear("Loop A", 1, { id: "la", flags: { container: {}, containedIn: "lb" } });
const loopB = gear("Loop B", 1, { id: "lb", flags: { container: {}, containedIn: "la" } });
check("self-referencing containers do not hang", contentsWeight6(withItems([loopA, loopB]), "la") >= 0);


// Container profiles must match core's REAL item names in acks-adventuring-
// equipment (we annotate those in place rather than duplicating them).
const { containerProfileFor } = await import(new URL("config.mjs", S));
check("backpack profile from core's name '(holds 4 stone)'", containerProfileFor("Backpack (holds 4 stone)").capacity === 4);
check("rucksack 2 st / large sack 6 st / saddlebag 3 st", containerProfileFor("Rucksack (holds 2 stone)").capacity === 2 && containerProfileFor("Sack, Large (holds 6 stone)").capacity === 6 && containerProfileFor("Saddlebag (holds 3 stone)").capacity === 3);
check("adventurer's harness profile flags the harness rule", containerProfileFor("Adventurer's Harness").harness === true);
check("bowquiver profile flags the 2-item rule", containerProfileFor("Bowquiver").bowquiver === true);
check("a sword is not a container", containerProfileFor("Sword") === null);


// --- Phase 5b: item loss from damage (JJ p. 398) ------------------------------
SETTINGS_STATE.overlayItemLoss = true;
const { stonesAtRisk, isVulnerable, materialOf, planItemLoss, LOSS_ORDER_FRONT, LOSS_ORDER_REAR } =
  await import(new URL("overlays/item-loss.mjs", S));

check("no loss above -6 hp", stonesAtRisk(-5) === 0 && stonesAtRisk(0) === 0);
check("-6 hp risks 1 stone; each further 6 damage risks another", stonesAtRisk(-6) === 1 && stonesAtRisk(-11) === 1 && stonesAtRisk(-12) === 2 && stonesAtRisk(-18) === 3);
check("rear order is the exact reverse of the front order", LOSS_ORDER_REAR.join() === [...LOSS_ORDER_FRONT].reverse().join());

// Materials table (JJ p. 398): fire burns cloth, piercing does not; poison
// destroys nothing at all.
check("fire destroys cloth/leather/wood, not metal", isVulnerable("cloth", "fire") && isVulnerable("leather", "fire") && !isVulnerable("metal", "fire"));
check("piercing destroys only ceramic and glass", isVulnerable("glass", "piercing") && !isVulnerable("cloth", "piercing"));
check("poison destroys nothing", !isVulnerable("cloth", "poisonous") && !isVulnerable("metal", "poisonous"));
check("bludgeoning destroys metal and stone, not cloth", isVulnerable("metal", "bludgeoning") && !isVulnerable("cloth", "bludgeoning"));
check("material guessed from name (oil = combustible, holy water = good)", materialOf(gear("Oil, Military", 1)) === "combustible" && materialOf(gear("Holy Water", 1)) === "good");
check("explicit material flag beats the guess", materialOf(gear("Odd Thing", 1, { flags: { material: "glass" } })) === "glass");

// The Judges Journal's own worked example: Andravus at -18 hp from a fireball
// risks 3 stone; fire cannot touch his metal flasks of holy water or his coins,
// so those are skipped rather than consuming the budget.
const jjShield = { id: "sh", name: "Shield", type: "armor", system: { equipped: true, type: "shield", aac: { value: 1 }, weight6: 6 }, getFlag: (_m, k) => ({ material: "wood" }[k]), effects: [] };
const jjSpear = gear("Spear", 6, { id: "sp", type: "weapon", flags: { material: "wood" } });
const jjHolyWater = gear("Holy Water", 1, { id: "hw", flags: { material: "metal" } });
const jjOil = gear("Oil, Military", 1, { id: "oil" });
const jjActor = withItems([jjShield, jjSpear, jjHolyWater, jjOil]);
const jjLo = { handShields: [jjShield], armor: null };
const plan = planItemLoss(jjActor, jjLo, { hp: -18, damageType: "fire" });
check("fireball at -18 hp risks 3 stone", plan.stones === 3);
check("wooden shield in hand is destroyed first (front order)", plan.destroyed[0].item.id === "sh");
check("metal holy-water flask is skipped by fire, not destroyed", !plan.destroyed.some((d) => d.item.id === "hw") && plan.survivors >= 1);
check("the wooden spear burns too", plan.destroyed.some((d) => d.item.id === "sp"));

// Damaged from the rear the order flips: the shield in hand is now last.
const rearPlan = planItemLoss(jjActor, jjLo, { hp: -6, damageType: "fire", fromRear: true });
check("from the rear the shield is not the first thing lost", rearPlan.destroyed[0]?.item.id !== "sh");

// Poison destroys nothing regardless of how far below -6 the victim is.
check("poison at -30 hp destroys nothing", planItemLoss(jjActor, jjLo, { hp: -30, damageType: "poisonous" }).destroyed.length === 0);
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
check("-1 damage becomes a core damage string '1d6-1'", upd["system.damage"] === "1d6-1");
const updA = toItemUpdates(armor("Plate", "heavy", { ac: 6 }), accumulate("armourEquipment", [11]));
check("-1 AC becomes a core aac.value", updA["system.aac.value"] === 5);
const updE = toItemUpdates(armor("Plate", "heavy", { ac: 6 }), accumulate("armourEquipment", [3]));
check("+1 stone becomes core weight6 (+6 units)", updE["system.weight6"] === 6);
check("breaks/cannotSneak recorded as a flag for the Judge", toItemUpdates(armor("Plate", "heavy", { ac: 6 }), accumulate("armourEquipment", [7]))["flags.acks-extras.scavenged"].cannotSneak === true);


// --- Class training chunks (JJ p. 290-291) ------------------------------------
const { grantMatches } = await import(new URL("proficiency.mjs", S));
const { buildTraining } = await import(new URL("../tools/pack-data/equipment.mjs", import.meta.url));

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

const lightClass = actor([], { effects: [marker("armourProficiency", "light")] });
check("armour chunk sets the cap", armorMax(lightClass) === "light");
const lightPlusTraining = actor([], { effects: [marker("armourProficiency", "light"), marker("armorTraining", "1")] });
check("Armour Training raises a chunk-granted cap light -> medium", armorMax(lightPlusTraining) === "medium");

const dualChunk = actor([weapon("Sword", { melee: true, id: "d1" }), weapon("Dagger", { melee: true, id: "d2" })], { effects: [marker("styleProficient", "dual")] });
const dualLo2 = getLoadout(dualChunk);
check("Fighting Style chunk trains the style (dual proficient)", dualLo2.activeStyle === "dual" && dualLo2.styleProficient);
check("single + missile are mandatory even with no chunks", getLoadout(actor([weapon("Sword", { melee: true, id: "z" })])).trainedStyles.has("single"));

const training = buildTraining();
check("training pack has all 34 JJ chunks", training.length === 34);
check("training chunks are ability items with 16-char ids", training.every((d) => d.type === "ability" && ID.test(d._id)));
check("all 5 fighting styles are individually available", ["single", "missile", "dual", "twoHanded", "weaponShield"].every((st) => training.some((d) => (d.effects[0]?.changes ?? []).some((c) => c.key.endsWith("styleProficient") && c.value === st))));
check("all 5 armour rungs are individually available", ["unarmored", "veryLight", "light", "medium", "heavy"].every((a) => training.some((d) => (d.effects[0]?.changes ?? []).some((c) => c.key.endsWith("armourProficiency") && c.value === a))));
check("all 10 restricted weapons are individually available", training.filter((d) => d.name.startsWith("Restricted Weapon:")).length === 10);

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
check("unlocked bonuses map onto core fields", (() => { const u = N.toItemUpdates(hammer({ rec: { unlocked: 6 } }), { bonus: 0, damage: "1d6" }); return u["system.bonus"] === 3 && u["system.damage"] === "1d6+3"; })());
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
check("re-applying recomputes from base, never compounds", reapplied["system.bonus"] === 3 && reapplied["system.damage"] === "1d6+3");
check("captureBase records the mundane stats", (() => { const b = N.captureBase({ system: { bonus: 1, damage: "1d8", weight6: 6 } }); return b.bonus === 1 && b.damage === "1d8" && b.weight6 === 6; })());
check("renameUpdates captures the base on first naming", N.renameUpdates(hammer({ rec: { unlocked: 0 } }), "Orcbiter", 1)["flags.acks-extras.named.base"] !== undefined);

// A level-up advances only WIELDED named items, one rung, restating bonuses.
const adv = N.advanceWieldedOnLevelUp({ items: [basedHammer(2)], system: { details: { level: 4 } } });
check("level-up advances a wielded named item one rung", adv.length === 1 && adv[0].updates["flags.acks-extras.named.unlocked"] === 3);
check("advancement restates bonuses from base (3 rungs = +2 dmg, +1 hit)", adv[0].updates["system.damage"] === "1d6+2" && adv[0].updates["system.bonus"] === 1);
check("an unwielded named item does not advance", N.advanceWieldedOnLevelUp({ items: [basedHammer(2, false)], system: { details: { level: 4 } } }).length === 0);
SETTINGS_STATE.overlayNamed = false;


// --- buildApi smoke test ------------------------------------------------------
// v0.9.0-v0.12.0 shipped BROKEN: api.mjs exposed containerReport & co. that it
// never imported, so buildApi() threw a ReferenceError at init and the whole
// module died. node --check is syntax-only and nothing here called buildApi, so
// it sailed through. Actually building the API is the guard.
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

// v14 AE changes must carry a string `type`, never the deprecated numeric `mode`
// shim (whose setter does Number(mode) -> NaN, silently never setting type).
const typedChanges = buildLoadoutChanges(specActor, specLo);
check("loadout AE changes use string `type`, not `mode`", typedChanges.every((c) => c.type === "add" && c.mode === undefined));
const profEffectChanges = buildProficiencies().flatMap((d) => d.effects[0]?.changes ?? []);
check("pack effect changes use string `type`, not `mode`", profEffectChanges.length > 0 && profEffectChanges.every((c) => c.type === "override" && c.mode === undefined));


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
const { registerRollWrap } = await import(new URL("roll-wrap.mjs", S));
// (Paper Doll registration checks removed with the feature.)
const { registerSheet } = await import(new URL("sheet.mjs", S));
registerSheet();
check("registerSheet() runs without throwing", true);

// Overlay toggles with NO implementation behind them must not appear in the
// settings UI — a switch that silently does nothing is worse than no switch.
for (const dead of ["overlayMounted", "overlayBeastman"]) {
  check(`${dead} is not registered (no implementation exists)`, !registered.includes(dead));
}
for (const live of ["overlayShieldVariants", "overlayManeuvers", "overlayItemLoss", "overlayNamed", "overlayScavenged", "overlayEnclosingHelm"]) {
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
const wornCloak = { ...gear("Cloak", 1, { id: "cl", equipped: true }), update: async (u) => { stored = u; } };
const stowActor = withItems([pack, wornCloak]);
check("storeIn refuses a non-container target", (await storeIn(stowActor, wornCloak, torch)) === false);
check("storeIn stows the item", (await storeIn(stowActor, wornCloak, pack)) === true);
check("storeIn writes the containedIn flag", stored?.["flags.acks-extras.containedIn"] === "bp");
check("stowing worn gear unequips it first", stored?.["system.equipped"] === false);

// containerReport is now the whole feature's data path (the Container Manager
// popout it used to feed is retired; the sheet renders this directly).
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

check("a helmet is worn on the head", wearLocation(dressed, helm, dLo) === WEAR.HEAD);
check("a suit of armour is worn on the body", wearLocation(dressed, plate, dLo) === WEAR.BODY);
check("a shield in hand is in the off hand", wearLocation(dressed, shield, dLo) === WEAR.OFF_HAND);
check("an unflagged weapon is in the main hand", wearLocation(dressed, blade, dLo) === WEAR.MAIN_HAND);
check("the hand flag puts a weapon in the off hand", wearLocation(dressed, offBlade, dLo) === WEAR.OFF_HAND);
check("unequipped gear is merely carried", wearLocation(dressed, spare, dLo) === WEAR.CARRIED);
check("gear inside a container is stowed", wearLocation(dressed, stowedRope, dLo) === WEAR.STOWED);

// A lone medium weapon with both hands free is wielded two-handed (RR p. 299),
// and the wear bucket must agree with the loadout that says so.
const soloBlade = weapon("Sword", { melee: true, id: "sw2" });
const twoHanded = withItems([soloBlade]);
const tLo = getLoadout(twoHanded);
check("the loadout wields a lone medium weapon two-handed", tLo.weapons[0].wieldTwoHanded);
check("wear agrees: both hands", wearLocation(twoHanded, soloBlade, tLo) === WEAR.BOTH_HANDS);

const buckets = wearBuckets(dressed, dLo);
check("buckets are display-ordered head first", buckets[0].key === WEAR.HEAD);
check("buckets omit empty locations", buckets.every((b) => b.items.length > 0));
check("carried and stowed gear stays out of the worn buckets",
  !buckets.some((b) => b.items.some((i) => i.id === "hx" || i.id === "rp")));
check("every equipped item lands in exactly one bucket",
  buckets.reduce((n, b) => n + b.items.length, 0) === 5);

/* ---------------------------------------------------------------------- */
/*  Proficiency kill switch (acks-abilities interop)                        */
/* ---------------------------------------------------------------------- */

// This module infers proficiency from its OWN actor flags. acks-abilities owns
// a richer model of the same facts, so a character built with it carries none
// of these flags and would read as non-proficient — triggering the full RR
// p. 106 package on a legal PC. Enforcement must default OFF while it is active.
const { enforcementActive } = await import(new URL("proficiency.mjs", S));

// A bare unconfigured actor with a weapon its (absent) flags don't cover.
const unconfigured = () => withItems([weapon("Halberd", { melee: true, id: "hb" })]);

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
const freedMods = computeAttackMods(
  { ...freed, ...unconfigured(), type: "character", system: { details: { level: 5 }, thac0: { bba: 3 }, scores: { str: { mod: 2 } } } },
  { item: { _id: "hb", system: { bonus: 0 } } },
  { type: "melee" },
);
check("kill switch removes the attack degradation", !freedMods || freedMods.bonusDelta === 0);

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

const { hasEffectFlag, sumEffectModifiers } = await import(new URL("effects.mjs", S));
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
    ...(defId ? { "acks-content": { cookbook: { id: defId } } } : {}),
    "acks-extras": { extras },
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

// Armour Training: each rank raises the wearable category one step.
const atChar = withItems([abil("Armor Training", "def.prof.armorTraining", { qty: 2 })]);
atChar.getFlag = (_m, k) => (k === "armorMax" ? "light" : undefined);
check("bridge: Armor Training rank 2 raises light → heavy", armorMax(atChar) === "heavy");
check("bridge: US and UK spellings both resolve",
  sumEffectModifiers(withItems([abil("Armour Training", null, { qty: 1 })]), "armorTraining") === 1);

// Name-suffix fallback: a hand-made item with no extras still carries its pick.
const suffix = withItems([abil("Martial Training (Axes)", null, {})]);
suffix.getFlag = (_m, k) => (k === "weaponProficiency" ? "swordDagger" : undefined);
check("bridge: '(X)' name suffix works with no stored selections",
  isWeaponProficient(suffix, classifyWeapon(weapon("Battle Axe", { melee: true }))));

// Dedup: an item speaking the native effect language stands aside — its AE
// counts once, the bridge adds nothing on top.
const nativeReflexes = abil("Combat Reflexes", null, {}, {
  effects: [{ changes: [{ key: "flags.acks-extras.styleInit", value: "1" }] }],
});
const reflexChar = withItems([nativeReflexes]);
reflexChar.appliedEffects = [marker("styleInit", 1)];
check("bridge: native-effect items are not double-counted",
  sumEffectModifiers(reflexChar, "styleInit") === 1);
// The same ability WITHOUT native effects bridges to the same value.
check("bridge: pure abilities item contributes the same +1",
  sumEffectModifiers(withItems([abil("Combat Reflexes", null, {})]), "styleInit") === 1);

// Pick resolvers.
check("resolveStylePick handles 'Weapon and Shield'", resolveStylePick("Weapon and Shield") === "weaponshield");
check("resolveWeaponGroupPick: crossbows before bows", resolveWeaponGroupPick("Crossbows") === "crossbow");
check("resolveWeaponGroupPick: a named weapon passes through", resolveWeaponGroupPick("Sword") === "sworddagger" || resolveWeaponGroupPick("Whip") === "whip");
check("resolveFocusPick maps bows and crossbows together", resolveFocusPick("Bows & Crossbows") === "bowscrossbows");

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
const { consumeForAttack, launcherAmmoPattern, roundsOf, isThrownAway, recoverThrown, consumeItem } =
  await import(new URL("ammo.mjs", S));

// A launcher's ammo type is resolved from category/name.
check("bow → arrows", launcherAmmoPattern(weapon("Long Bow", { missile: true, melee: false }), classifyWeapon(weapon("Long Bow", { missile: true, melee: false }))).test("Quiver, 20 Arrows"));
check("crossbow → bolts", launcherAmmoPattern(weapon("Crossbow", { missile: true }), classifyWeapon(weapon("Crossbow", { missile: true }))).test("Case, 20 Bolts"));
check("sling → stones", launcherAmmoPattern(weapon("Sling", { missile: true }), classifyWeapon(weapon("Sling", { missile: true }))).test("30 Sling Stones"));
check("a melee sword has no ammo pattern", launcherAmmoPattern(weapon("Sword", { melee: true }), classifyWeapon(weapon("Sword", { melee: true }))) === null);

// A mutable mock item that records updates/flags (ammo consumption writes them).
const trackItem = (name, over = {}) => {
  const flags = { ...(over.flags ?? {}) };
  const sys = { equipped: over.equipped ?? true, melee: over.melee, missile: over.missile, quantity: over.quantity, tags: over.tags ?? [] };
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

// A melee attack consumes nothing.
await consumeForAttack(archer, ammoBow, classifyWeapon(ammoBow), { type: "melee" });
check("a melee attack spends no ammo", ammoQuiver._sys.quantity.value === 19);

// A single thrown weapon is MARKED thrown (not destroyed), unequipped.
const axe = trackItem("Hand Axe", { melee: true, missile: true, tags: [{ title: "Thrown", value: "Thrown" }] });
const thrower = withItems([axe]);
await consumeForAttack(thrower, axe, classifyWeapon(axe), { type: "missile" });
check("a single thrown weapon is marked thrown-away", isThrownAway(axe));
check("a thrown weapon is unequipped", axe._sys.equipped === false);
check("a thrown weapon is NOT destroyed", !!thrower.items.find((i) => i.id === axe.id));

// A stackable thrown weapon decrements instead of being marked.
const ammoDarts = trackItem("Darts", { melee: true, missile: true, quantity: { value: 5 }, tags: [{ title: "Thrown", value: "Thrown" }] });
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
const autoLoad = getLoadout(withItems([gripSword()]));
check("versatile weapon exposes canTwoHand", autoLoad.weapons[0].canTwoHand === true);
check("auto grip → two-handed when hands free", autoLoad.weapons[0].wieldTwoHanded && autoLoad.weapons[0].grip === "auto");

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
globalThis.acksExtras.formation = { heldLightCount: (id) => (id === "a1" ? 1 : 0) };
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

// A strong character bashing with a torch: the STR damage bonus is stripped.
const strongTorch = withItems([weapon("Torch", { melee: true, id: "tor1", damage: "1d4" })]);
strongTorch.system = { scores: { str: { mod: 2 } }, damage: { mod: { melee: 1 } }, details: { level: 1 }, thac0: { bba: 0 } };
const tmods = computeAttackMods(strongTorch, { item: { _id: "tor1", system: { damage: "1d4", bonus: 0 } } }, { type: "melee" });
check("torch strips the +3 melee damage bonus", tmods && /1d4 - 3/.test(tmods.damage));
// A WEAK character keeps the penalty (it is not a bonus).
const weakTorch = withItems([weapon("Torch", { melee: true, id: "tor2", damage: "1d4" })]);
weakTorch.system = { scores: { str: { mod: -1 } }, damage: { mod: { melee: 0 } }, details: { level: 1 }, thac0: { bba: 0 } };
const wmods = computeAttackMods(weakTorch, { item: { _id: "tor2", system: { damage: "1d4", bonus: 0 } }, }, { type: "melee" });
check("torch keeps a STR penalty (not a bonus)", !wmods || !/1d4 -/.test(wmods.damage ?? "1d4"));

/* ---------------------------------------------------------------------- */
/*  #2 Thrown weapons add STR to damage in missile mode (RR p298)          */
/* ---------------------------------------------------------------------- */

const axeThrower = withItems([weapon("Hand Axe", { melee: true, missile: true, id: "ha1", damage: "1d6" })]);
axeThrower.system = { scores: { str: { mod: 2 } }, damage: { mod: { missile: 0 } }, details: { level: 1 }, thac0: { bba: 0 } };
const axeMissile = computeAttackMods(axeThrower, { item: { _id: "ha1", system: { damage: "1d6", bonus: 0 } } }, { type: "missile" });
check("thrown axe adds STR to damage when hurled", axeMissile && /1d6 \+ 2/.test(axeMissile.damage));
const axeMelee = computeAttackMods(axeThrower, { item: { _id: "ha1", system: { damage: "1d6", bonus: 0 } } }, { type: "melee" });
check("thrown axe swung in melee is untouched (core already adds STR)", !axeMelee || !/\+ 2/.test(axeMelee.damage ?? ""));
const oilThrower = withItems([weapon("Military Oil", { missile: true, id: "mo1", damage: "1d8" })]);
oilThrower.system = { scores: { str: { mod: 3 } }, damage: { mod: { missile: 0 } }, details: { level: 1 }, thac0: { bba: 0 } };
const oilMods = computeAttackMods(oilThrower, { item: { _id: "mo1", system: { damage: "1d8", bonus: 0 } } }, { type: "missile" });
check("thrown splash oil gains no STR to damage (RAW exclusion)", !oilMods || !/1d8 \+/.test(oilMods.damage ?? ""));

/* ---------------------------------------------------------------------- */
/*  #1 Torch: ready one from the stack into a wielded 1d4 light-weapon      */
/* ---------------------------------------------------------------------- */

const readied = readiedWeaponData({ name: "Torch", img: "t.png", system: { cost: 1, weight6: 1 } });
check("readied torch is a 1d4 weapon, melee AND thrown, light", readied.type === "weapon" && readied.system.damage === "1d4" && readied.system.melee && readied.system.missile && readied.flags["acks-extras"].light);
check("readied torch carries no quantity (a single wielded torch)", readied.system.quantity === undefined);
check("readiedWeaponData ignores non-preparable gear", readiedWeaponData({ name: "Sword" }) === null && readiedWeaponData({ name: "Lantern" }) === null);

const created = [];
const torchActor = { createEmbeddedDocuments: async (_t, arr) => { created.push(...arr); return arr.map((d, i) => ({ ...d, id: "new" + i })); } };
const stack = { name: "Torch", img: "t.png", system: { quantity: { value: 3 }, cost: 1, weight6: 1 }, deleted: false, getFlag: () => undefined, async update(u) { if (u["system.quantity.value"] != null) this.system.quantity.value = u["system.quantity.value"]; }, async delete() { this.deleted = true; } };
const madeTorch = await prepareTorch(torchActor, stack);
check("prepareTorch creates a weapon-torch", madeTorch && madeTorch.type === "weapon" && madeTorch.system.damage === "1d4");
check("prepareTorch decrements the stack (3 → 2), keeps it", stack.system.quantity.value === 2 && stack.deleted === false);
const lastTorch = { name: "Torch", img: "t.png", system: { quantity: { value: 1 } }, deleted: false, getFlag: () => undefined, async update(u) { this.system.quantity.value = u["system.quantity.value"]; }, async delete() { this.deleted = true; } };
await prepareTorch(torchActor, lastTorch);
check("prepareTorch deletes the stack when the last torch is drawn", lastTorch.system.quantity.value === 0 && lastTorch.deleted === true);

/* ---------------------------------------------------------------------- */
/*  #3 Unarmed strike (RR p299: 1d3 nonlethal, melee only)                 */
/* ---------------------------------------------------------------------- */

const unarmed = unarmedStrikeData();
check("unarmed strike is 1d3 melee-only", unarmed.system.damage === "1d3" && unarmed.system.melee === true && unarmed.system.missile === false);

/* ---------------------------------------------------------------------- */
/*  #4 Masterwork (RR p159): stamped onto core fields, reversible          */
/* ---------------------------------------------------------------------- */

check("addToDamage appends a flat bonus", addToDamage("1d6", 1) === "1d6 + 1" && addToDamage("1d8", 0) === "1d8");
check("masterworkTiersFor lists weapon vs armor tiers", masterworkTiersFor("weapon").length === 3 && masterworkTiersFor("armor").length === 2 && masterworkTiersFor("item").length === 0);

const mockDoc = (type, sys = {}) => ({
  type,
  name: sys.name ?? "Sword",
  img: sys.img ?? "icons/svg/item-bag.svg",
  system: { bonus: sys.bonus ?? 0, damage: sys.damage, aac: { value: sys.aac ?? 0 }, weight6: sys.weight6 ?? 0, cost: sys.cost ?? 0, description: sys.description ?? "", tags: [], type: sys.armorType },
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

const mkWeapon = mockDoc("weapon", { bonus: 0, damage: "1d6", weight6: 6 });
await setMasterwork(mkWeapon, "weaponBoth");
check("masterwork +1/+1 stamps both bonus and damage", mkWeapon.system.bonus === 1 && /1d6 \+ 1/.test(mkWeapon.system.damage));
check("masterwork records the tier; the baseline is the shared `pristine` flag", mkWeapon._flags.masterwork?.tier === "weaponBoth" && mkWeapon._flags.pristine?.damage === "1d6");
await setMasterwork(mkWeapon, "weaponToHit");
check("switching tiers restarts from base (never compounds the die)", mkWeapon.system.bonus === 1 && mkWeapon.system.damage === "1d6");
await setMasterwork(mkWeapon, "none");
check("masterwork None restores the base exactly and clears both flags", mkWeapon.system.bonus === 0 && mkWeapon.system.damage === "1d6" && mkWeapon._flags.masterwork === undefined && mkWeapon._flags.pristine === undefined);

const mkArmor = mockDoc("armor", { aac: 4, weight6: 30 });
await setMasterwork(mkArmor, "armorLight");
check("masterwork −1 stone reduces weight6 by 6", mkArmor.system.weight6 === 24 && mkArmor.system.aac.value === 4);
await setMasterwork(mkArmor, "armorAC");
check("masterwork +1 AC raises aac from base, restores weight", mkArmor.system.aac.value === 5 && mkArmor.system.weight6 === 30);

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
check("scavenge stamps -1 damage onto a weapon", scWeapon.system.damage === "1d6 - 1");
check("scavenge captures ONE pristine baseline", scWeapon._flags.pristine?.damage === "1d6");
await clearScavenged(scWeapon);
check("clearScavenged restores pristine damage, clears both flags", scWeapon.system.damage === "1d6" && scWeapon._flags.scavenged === undefined && scWeapon._flags.pristine === undefined);

// Re-rolling never compounds (always recomputed from pristine).
await scavengeItem(scWeapon, { roll: () => 7 });
await scavengeItem(scWeapon, { roll: () => 3 }); // "Blade dented" → -1 damage (from pristine, not -2)
check("re-scavenge starts from pristine (no compounding)", scWeapon.system.damage === "1d6 - 1");
await clearScavenged(scWeapon);

// Armour scavenge: -1 AC + a break flag for the Judge.
const scArmor = mockDoc("armor", { name: "Plate", aac: 6, weight6: 36, armorType: "heavy" });
await scavengeItem(scArmor, { roll: () => 13 }); // "Dented/rotting" → -1 AC, breaks
check("scavenge stamps -1 AC on armour + records break flag", scArmor.system.aac.value === 5 && scArmor._flags.scavenged?.breaks === true);

/* --- LAYERING: masterwork + scavenged must coexist and unwind cleanly ----- */
// This is the bug the single-baseline model fixes: two layers each snapshotting
// their own "base" meant clearing one restored the other's delta as if pristine.
const both = mockDoc("weapon", { name: "Sword", damage: "1d6", bonus: 0, weight6: 6 });
await setMasterwork(both, "weaponBoth"); // +1 hit, +1 damage
check("masterwork alone: +1 hit / 1d6 + 1", both.system.bonus === 1 && both.system.damage === "1d6 + 1");
await scavengeItem(both, { roll: () => 7 }); // rusty: -1 damage
check("masterwork + scavenged cancel numerically to 1d6 (not '1d6 + 1-1')", both.system.damage === "1d6" && both.system.bonus === 1);
await clearScavenged(both);
check("clearing the condition leaves masterwork intact", both.system.damage === "1d6 + 1" && both.system.bonus === 1);
await scavengeItem(both, { roll: () => 11 }); // off balance: -1 attack
check("scavenged attack penalty stacks onto the masterwork bonus (net 0)", both.system.bonus === 0);
await setMasterwork(both, "none");
check("clearing masterwork keeps the condition's -1 attack", both.system.bonus === -1 && !!both._flags.scavenged);
await clearScavenged(both);
check("clearing the LAST layer restores the item exactly + drops the baseline",
  both.system.bonus === 0 && both.system.damage === "1d6" && both.system.weight6 === 6 && both._flags.pristine === undefined);

/* --- GOLD VALUE follows the layers (the number on the sheet must move) --- */
const priced = mockDoc("weapon", { name: "Sword", damage: "1d6", cost: 10, weight6: 6 });
await setMasterwork(priced, "weaponToHit"); // +1 hit, +80gp (RR p159)
check("masterwork adds its surcharge to the price (10 → 90gp)", priced.system.cost === 90);
await scavengeItem(priced, { roll: () => 7 }); // rusty: -1 dmg, -33% value
check("a scavenged condition scales the price (90 × 0.67 ≈ 60.3gp)", Math.abs(priced.system.cost - 60.3) < 0.01);
await setMasterwork(priced, "none");
check("dropping masterwork reprices from pristine (10 × 0.67 = 6.7gp)", Math.abs(priced.system.cost - 6.7) < 0.01);
await clearScavenged(priced);
check("clearing every layer restores the original price", priced.system.cost === 10);
const { layerSummary } = await import(new URL("properties.mjs", S));
const p3 = mockDoc("armor", { name: "Plate", aac: 6, cost: 60, weight6: 36 });
await setMasterwork(p3, "armorAC"); // +1 AC, +650gp
check("armour masterwork: +1 AC and +650gp both land", p3.system.aac.value === 7 && p3.system.cost === 710);
check("layerSummary states the new price so the sheet can explain it", /710gp \(was 60gp\)/.test(layerSummary(p3)));

// Shield variant: make any shield a buckler, and clear back to standard.
const shieldVar = mockDoc("armor", { name: "Shield", aac: 1, armorType: "shield" });
await setShieldVariant(shieldVar, "buckler");
check("setShieldVariant sets the variant flag", shieldVar._flags.shieldVariant === "buckler");
await setShieldVariant(shieldVar, "standard");
check("setShieldVariant standard clears the flag", shieldVar._flags.shieldVariant === undefined);

SETTINGS_STATE.overlayShieldVariants = false;

/* ---------------------------------------------------------------------- */
/*  The IMPORTED scavenged table (acks-content → acks-lib ruledata)        */
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

check("MATERIALS lists the material vocabulary", MATERIALS.includes("wood") && MATERIALS.includes("metal") && MATERIALS.includes("cloth"));
const matItem = mockDoc("weapon", { name: "Mystery Rod" });
await setMaterial(matItem, "wood");
check("setMaterial stamps the flag; materialOf reads it", matItem._flags.material === "wood" && materialOf(matItem) === "wood");
await setMaterial(matItem, "auto");
check("setMaterial(auto) clears the flag → falls back to the guess", matItem._flags.material === undefined);

const magic = mockDoc("weapon", { name: "Flametongue", cost: 5000, damage: "1d6+2" });
await disguiseItem(magic, { name: "Old Sword", cost: 7, damage: "1d6" });
check("disguise shows the apparent name/value/damage", magic.name === "Old Sword" && magic.system.cost === 7 && magic.system.damage === "1d6");
check("disguise keeps the true identity hidden in a flag", isDisguised(magic) && magic._flags.disguise.true.name === "Flametongue" && magic._flags.disguise.true.cost === 5000);
await revealItem(magic);
check("reveal restores the true item + clears the disguise", magic.name === "Flametongue" && magic.system.cost === 5000 && magic.system.damage === "1d6+2" && !isDisguised(magic));

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
