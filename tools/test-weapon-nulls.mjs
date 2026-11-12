/**
 * Every weapon reader with no rows imported.
 *
 * The weapon seam answers empty when nothing is registered behind it
 * (`lib/weapons.mjs`), and every reader has to stay safe then: proficiency
 * treats a weapon whose class, size or row is not imported as undecided and
 * penalises nothing, an unknown size is one hand, no figure stands in for a
 * page's, the writers write nothing for a field no row states, and the surfaces
 * say "not imported".
 *
 * Every weapon, size and die here is invented. Each section registers its
 * own source and puts back what was registered before.
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";

globalThis.acksExtras ??= {};
globalThis.game = {
  settings: { get: (_m, k) => (k === "defaultHandBudget" ? 2 : k === "enforceMode" ? "resolve" : undefined) },
  i18n: { has: () => false, localize: (x) => x, format: (k, d) => `${k}${d ? JSON.stringify(d) : ""}` },
  modules: { get: () => ({ active: false }) },
  users: { activeGM: null },
  user: { isGM: false },
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
    api: {
      ApplicationV2: StubApplicationV2,
      HandlebarsApplicationMixin: (Base) => class extends Base {},
      DialogV2: class { static async prompt() { return null; } },
    },
    handlebars: { loadTemplates: () => {} },
    instances: new Map(),
  },
};
globalThis.CONST = { ACTIVE_EFFECT_CHANGE_TYPES: { custom: 0, multiply: 10, add: 20, subtract: 20, downgrade: 30, upgrade: 40, override: 50 } };
globalThis.Hooks = { once: () => {}, on: () => {}, callAll: () => {} };

let pass = 0;
const check = (label, cond) => {
  assert.ok(cond, label);
  pass++;
};

const S = new URL("../scripts/equipment/", import.meta.url);
const seam = await import(new URL("../scripts/lib/weapons.mjs", import.meta.url));
const profiles = await import(new URL("profiles.mjs", S));
const prof = await import(new URL("proficiency.mjs", S));
const training = await import(new URL("training-view.mjs", S));
const actions = await import(new URL("actions.mjs", S));
const containers = await import(new URL("containers.mjs", S));
const figures = await import(new URL("weapon-figures.mjs", S));
const { annotateItem } = await import(new URL("api.mjs", S));
const model = await import(new URL("../scripts/lib/item-model.mjs", import.meta.url));
const { registerWeaponSource, hasWeaponRows } = seam;
const { classifyWeapon, handCost, canOneHand, inferredGrips, isTwoHandedOnly, equipmentClass } = profiles;
const { isWeaponProficient, weaponProficiencyDecided, grantMatches, grantVerdict, weaponProficiency } = prof;

const defaults = registerWeaponSource(null);
check("nothing is registered until equipment registers its source", defaults === null);

/** A weapon document the way a payload carries it; `formula` is its own die. */
const weap = (name, { formula = "", flags = {}, system = {} } = {}) => ({
  id: name.replace(/\W/g, ""),
  name,
  type: "weapon",
  system: { damage: { base: { formula }, alternate: { formula: "" } }, melee: true, missile: false, customTags: [], special: {}, ...system },
  flags: { "acks-extras": flags },
  getFlag: (_m, k) => flags[k],
  effects: [],
});
const actorWith = (weaponProf) => ({
  id: "a1",
  type: "character",
  items: [],
  system: {},
  effects: [],
  appliedEffects: [],
  isOwner: true,
  getFlag: (_m, k) => (k === "weaponProficiency" ? weaponProf : undefined),
});

// --- no rows: the classifier states nothing it was not told -------------------------
check("with no source the table holds no rows", !hasWeaponRows());
const bare = classifyWeapon(weap("Zorgle"));
check("a weapon no row places has no size, no class and no die", bare.size === null && bare.cat === null && bare.damage === "");
check("it keeps no key and still reads as a melee weapon", bare.key === null && bare.melee === true);
check("its own die stands", classifyWeapon(weap("Zorgle", { formula: "7d2" })).damage === "7d2");
check("a size the item declares stands", classifyWeapon(weap("Zorgle", { flags: { size: "large" } })).size === "large");
check("a core size on the item stands", classifyWeapon(weap("Zorgle", { system: { size: "tiny" } })).size === "tiny");
check("a class the item declares stands", classifyWeapon(weap("Zorgle", { flags: { category: "axe" } })).cat === "axe");

// --- hands unknown is one hand -------------------------------------------------------
check("an unknown size costs one hand, with either grip", handCost(bare, { twoHanded: false }) === 1 && handCost(bare, { twoHanded: true }) === 1);
check("it can be held in one hand", canOneHand(bare) === true);
check("it is not two-handed only, and its auto grip is one hand", isTwoHandedOnly(bare) === false && inferredGrips(bare) === "1h");
check("a declared grip still outranks", handCost({ ...bare, grips: "2h" }) === 2 && canOneHand({ ...bare, grips: "2h" }) === false);
check("a forced two-hand weapon stays two hands", canOneHand({ ...bare, twoHandedForced: true }) === false && handCost({ ...bare, twoHandedForced: true }) === 2);
check("a stated size is untouched: large is two hands, small is one", handCost({ ...bare, size: "large" }) === 2 && handCost({ ...bare, size: "small" }, { twoHanded: true }) === 1 && canOneHand({ ...bare, size: "large" }) === false);

// --- undecided never penalises ---------------------------------------------------------
const restricted = actorWith("axe,melee:small,zorgle");
check("a restricted actor reads a weapon of no stated class or size as proficient", isWeaponProficient(restricted, bare) === true);
check("the actor's grants cannot decide it", weaponProficiencyDecided(restricted, bare) === false);
check("the Training pills do not light for it", isWeaponProficient(restricted, bare, undefined, { grantsOnly: true }) === false);
check("no grant matches it", ["axe", "melee:small", "zorgle", "weapon:zorgle"].every((t) => !grantMatches(t, bare)));
check("a class grant, a size grant and a name each say they cannot decide", ["axe", "melee:small", "zorgle", "weapon:zorgle"].every((t) => grantVerdict(t, bare) === null));
check("a grant of all and a missile grant are decided from the profile alone", grantVerdict("all", bare) === true && grantVerdict("missile:all", bare) === false);
check("a missile grant covers a missile weapon that states no size", isWeaponProficient(actorWith("missile:all"), { ...bare, melee: false, missile: true }) === true);
const missileOnly = actorWith("missile:all");
check("and refuses a melee one it can decide", isWeaponProficient(missileOnly, { ...bare, melee: true, missile: false }) === false);
check("a melee size grant refuses a weapon that is not melee, undecided or not", grantVerdict("melee:small", { ...bare, melee: false }) === false);
const declared = classifyWeapon(weap("Zorgle", { flags: { category: "bowCrossbow", size: "tiny" } }));
check("a declared class and size decide it", weaponProficiencyDecided(actorWith("axe,melee:small"), declared) === true && isWeaponProficient(actorWith("axe,melee:small"), declared) === false);
check("a declared class a grant covers is proficient", isWeaponProficient(actorWith("bowcrossbow"), declared) === true && isWeaponProficient(actorWith("melee:tiny"), declared) === true);
check("an actor with no declared list refuses nothing and decides nothing", isWeaponProficient(actorWith(undefined), bare) === true && weaponProficiencyDecided(actorWith(undefined), bare) === true);
check("the kill switch still wins over a decided refusal", (() => {
  const strict = actorWith("axe");
  const refused = isWeaponProficient(strict, declared) === false;
  const saved = game.settings.get;
  game.settings.get = (_m, k) => (k === "proficiencyEnforcement" ? "off" : undefined);
  try {
    return refused && isWeaponProficient(strict, declared) === true;
  } finally {
    game.settings.get = saved;
  }
})());
check("an anyone-throws weapon is still proficient while undecided", isWeaponProficient(restricted, { ...bare, anyoneThrows: true }) === true);
check("weaponProficiency itself is unchanged: a declared list stays a list", weaponProficiency(restricted).all === false);

// The loadout carries the undecided state beside the verdict.
{
  const { getLoadout } = await import(new URL("loadout.mjs", S));
  const held = weap("Zorgle", { system: { equipped: true, cost: 0, weight6: 0, bonus: { attack: 0, damage: 0 } } });
  const lo = getLoadout({ ...actorWith("axe"), items: [held] });
  const entry = lo.weapons.find((w) => w.item === held);
  check("a loadout weapon the grants cannot decide is proficient and says it is undecided", entry?.proficient === true && entry.proficiencyDecided === false);
  check("it costs one hand", entry.handsMin === 1 && lo.handsUsed === 1);
}

// --- rows present: a token outside the grammar is still a refusal -------------------------
const zorgle = { name: "Zorgle", size: "small", melee: true, damage: "9d3", type: "zap", cat: "other", special: [] };
const shell = { name: "Shell", melee: false, missile: false, special: [] };
const noSize = { name: "Quib", missile: true, special: [] };
const blankDie = { name: "Blank", melee: true, damage: "", size: "small", cat: "other", special: [] };
registerWeaponSource({ rows: { zorgle, shell, quib: noSize, blank: blankDie }, aliases: {}, focusGroups: {}, throwsAsAnyone: () => false });
check("with rows imported the source reports them", hasWeaponRows());
const withRows = classifyWeapon(weap("Zorgle"));
check("a row places the weapon: its own size and class", withRows.key === "zorgle" && withRows.size === "small" && withRows.cat === "other" && withRows.damage === "9d3");
check("a token the grammar does not know is still a refusal, never undecided", grantVerdict("pointy stick", withRows) === false && isWeaponProficient(actorWith("pointy stick"), withRows) === false);
check("a weapon the rows do not place states no size, no class and no die, whatever rows are imported", (() => {
  const p = classifyWeapon(weap("Brick"));
  return p.key === null && p.size === null && p.cat === null && p.damage === "";
})());
const partial = classifyWeapon(weap("Quib", { system: { melee: false, missile: true } }));
check("a row that leaves a figure out leaves it unstated: no size, no class, no die", partial.key === "quib" && partial.size === null && partial.cat === null && partial.damage === "");
check("a row that prints a blank die states no die", classifyWeapon(weap("Blank")).damage === "");
check("so the actor's grants cannot decide it and it is proficient", weaponProficiencyDecided(actorWith("axe"), partial) === false && isWeaponProficient(actorWith("axe"), partial) === true);

// --- the training units follow the table -----------------------------------------------
check("units are the rows now: four here", training.weaponUnits().length === 4);
check("the unit list is an array a holder can map and spread", Array.isArray(training.weaponUnits()) && training.weaponUnits().map((u) => u.key).sort().join() === "blank,quib,shell,zorgle" && [...training.weaponUnits()].length === 4);
registerWeaponSource({ rows: { zorgle }, aliases: {}, focusGroups: {} });
check("a change of rows changes the units without a reload", training.weaponUnits().length === 1 && training.weaponUnits()[0].key === "zorgle");
check("a set of every unit is all", training.canonicalGrant(["zorgle"]) === "all");
registerWeaponSource(null);
check("with no rows the units are empty", training.weaponUnits().length === 0);
check("an empty set is no grant, not all", training.canonicalGrant([]) === "");
check("unknown tokens ride alone", training.canonicalGrant([], ["pointy stick"]) === "pointy stick");
check("a grant of all covers no unit", training.coveredUnits(["all"]).units.size === 0);
check("every view places nothing and shows no leftovers", training.TRAINING_VIEWS.every((v) => training.arrangeUnits(v.key).every((g) => g.members.length === 0)) && training.arrangeUnits("category").every((g) => g.key !== "leftovers"));
check("a toggle names no unit and changes nothing", training.toggledGrant("axe", "swordDagger") === null);

// --- the readied torch states only what its row states ------------------------------------
check("with no table nothing is a torch to ready", actions.readiedWeaponData({ name: "Torch", img: "t.png", system: { cost: 1, weight6: 1 } }) === null);
const lit = { name: "Torch", melee: true, missile: false, thrown: true, damage: "9d3", type: "zap", special: ["light"] };
registerWeaponSource({ rows: { torch: lit }, aliases: {}, focusGroups: {} });
const readied = actions.readiedWeaponData({ name: "Torch", img: "t.png", system: { cost: 1, weight6: 1 } });
check("a torch row's die and type are the readied weapon's", readied?.system.damage.base.formula === "9d3" && readied.flags["acks-extras"].damageType === "zap");
registerWeaponSource({ rows: { torch: { name: "Torch", melee: true, special: ["light"] } }, aliases: {}, focusGroups: {} });
const silent = actions.readiedWeaponData({ name: "Torch", img: "t.png", system: { cost: 1, weight6: 1 } });
check("a torch row that states no die or type readies one with neither", silent?.system.damage.base.formula === "" && !("damageType" in silent.flags["acks-extras"]));
check("equipmentClass answers null for a name no row holds", equipmentClass("Lantern") !== null && equipmentClass("Zorgle") === null);

// --- the annotate writer refuses what no row states ----------------------------------------
/** An item with a recorded update. */
const doc = (name, system = {}, flags = {}) => {
  const it = { id: name.replace(/\W/g, ""), name, type: "weapon", system: { cost: 0, weight6: 1, quantity: { value: 1 }, subtype: "item", melee: true, size: "na", ...system }, flags: { "acks-extras": flags }, getFlag: (_m, k) => flags[k], effects: [], writes: [] };
  it.update = async (u) => { it.writes.push(u); };
  return it;
};
const written = (it) => Object.assign({}, ...it.writes);
const P = "flags.acks-extras.";
registerWeaponSource({ rows: { zorgle, shell, quib: noSize }, aliases: {}, focusGroups: {} });
const full = doc("Zorgle");
check("annotate returns the key it stamped", (await annotateItem(full)) === "zorgle");
check("a row that states a use has its identity and the two attack booleans stamped, and no figure of its own", (() => {
  const w = written(full);
  return w[`${P}profileKey`] === "zorgle" && w["system.melee"] === true && w["system.missile"] === false && !(`${P}size` in w) && !(`${P}damageType` in w) && !(`${P}handy` in w) && !(`${P}thrown` in w);
})());
const empty = doc("Shell");
await annotateItem(empty);
check("an empty-shell row writes its identity and nothing it does not state", (() => {
  const w = written(empty);
  return w[`${P}profileKey`] === "shell" && !(`${P}size` in w) && !(`${P}damageType` in w) && !(`${P}handy` in w) && !(`${P}thrown` in w) && !("system.melee" in w) && !("system.missile" in w);
})());
const unsized = doc("Quib", { melee: false, missile: true });
await annotateItem(unsized);
check("a row with no size writes no size, and still reconciles its use", !(`${P}size` in written(unsized)) && written(unsized)["system.missile"] === true);
registerWeaponSource(null);
const nothing = doc("Zorgle");
await annotateItem(nothing);
check("with no rows annotate writes no weapon figure and no identity", (() => {
  const w = written(nothing);
  return !(`${P}profileKey` in w) && !(`${P}size` in w) && !(`${P}damageType` in w) && !(`${P}handy` in w) && !(`${P}thrown` in w) && !("system.melee" in w) && !("system.missile" in w);
})());

// --- a container with no imported capacity is still a container ------------------------------
const holder = (gear) => ({ id: "h1", name: "Zorg sack", type: "item", system: { cost: 0, weight6: 1, quantity: { value: 1 } }, flags: { "acks-extras": { gear } }, getFlag: (_m, k) => (k === "gear" ? gear : undefined), effects: [] });
const holds = holder({ holds: true });
check("an item that declares it holds gear holds gear", model.holdsGear(holds) === true && model.isContainer(holds) === true);
check("it states no capacity and the stated-capacity check says so", model.capacityOf(holds) === null && model.capacityStated(holds) === false);
check("its limit is none: unstated, never over", containers.capacityStone(holds) === 0);
const sized = holder({ capacity: 3 });
check("a stated capacity still makes a container, and is stated", model.holdsGear(sized) === true && model.capacityStated(sized) === true && model.capacityOf(sized) === 3);
check("an item that declares neither holds nothing", model.holdsGear(holder({})) === false && model.holdsGear(holder({ holds: false })) === false);
check("a capacity of zero is stated, not missing", model.capacityStated(holder({ capacity: 0 })) === true);
const carrier = { items: [holds, sized, holder({})] };
const report = containers.containerReport(carrier);
check("the container report lists both and says which capacity is not imported", report.length === 2 && report.find((r) => r.item === holds).capacityUnimported === true && report.find((r) => r.item === sized).capacityUnimported === false);
check("the unsized one is never over", report.find((r) => r.item === holds).over === false);

// --- the tooltip's three states -----------------------------------------------------------------
registerWeaponSource({ rows: { zorgle: { ...zorgle, cite: "Invented p. 4" }, quib: noSize, plain: { name: "Plain", cat: "other" } }, aliases: {}, focusGroups: {} });
const row = figures.figureState({ key: "zorgle", field: "size" });
check("a figure a row states is read from the row, with its page", row.state === figures.FIGURE_STATE.ROW && row.cite === "Invented p. 4" && row.weapon === "Zorgle");
check("its tooltip names the row, the page and the figure", (() => {
  const tip = figures.figureTip(row, "Size");
  return tip.includes("figureFromRow") && tip.includes("Invented p. 4") && tip.includes("Zorgle") && tip.includes("Size");
})());
check("a row with no recorded page says so instead of a page", figures.figureTip(figures.figureState({ key: "plain", field: "cat" }), "Class").includes("figureFromRowNoPage"));
const decl = figures.figureState({ key: "zorgle", field: "size", declared: "large" });
check("a figure the item declares says it outranks the row", decl.state === figures.FIGURE_STATE.DECLARED && figures.figureTip(decl, "Size").includes("figureDeclared"));
const miss = figures.figureState({ key: "quib", field: "size" });
check("a figure the row leaves out is not imported", miss.state === figures.FIGURE_STATE.MISSING && figures.figureTip(miss, "Size").includes("figureMissing"));
check("a weapon no row holds is not imported either, and a blank declaration is none", figures.figureState({ key: null, field: "size" }).state === figures.FIGURE_STATE.MISSING && figures.figureState({ key: "quib", field: "size", declared: "" }).state === figures.FIGURE_STATE.MISSING);
check("the row itself is a figure: present, or missing", figures.figureState({ key: "zorgle", field: null }).state === figures.FIGURE_STATE.ROW && figures.figureState({ key: "nothing", field: null }).state === figures.FIGURE_STATE.MISSING);
check("the tooltip of a missing figure carries no number", !/\d/.test(figures.figureTip(miss, "Size")));

// --- Weapon Finesse with a size that is not imported is undecided, never no ----------------
{
  const { attackThrowRows } = await import(new URL("attack-mods.mjs", S));
  const marker = { id: "fxfinesse", name: "finesse", disabled: false, changes: [{ key: "flags.acks-extras.finesse", value: "1" }], flags: { "acks-extras": {} } };
  const swinger = (item) => {
    const items = [item];
    items.get = (id) => items.find((i) => i.id === id);
    return { ...actorWith(undefined), items, effects: [marker], appliedEffects: [marker], system: { scores: { str: { mod: 1 }, dex: { mod: 3 } } } };
  };
  const brand = (flags) => weap("Brand", { flags, system: { equipped: true } });
  registerWeaponSource({ rows: { brand: { name: "Brand", melee: true, special: [] } }, aliases: {}, focusGroups: {} });
  const unsized = brand({});
  check("a weapon of no known size is not refused Weapon Finesse", attackThrowRows(swinger(unsized), unsized, "melee").some((r) => r.label === "Weapon Finesse" && r.value === 2));
  const big = brand({ size: "large" });
  check("a weapon of a stated size too large for it still is", !attackThrowRows(swinger(big), big, "melee").some((r) => r.label === "Weapon Finesse"));
  const small = brand({ size: "small" });
  check("and one of an eligible stated size gets it", attackThrowRows(swinger(small), small, "melee").some((r) => r.label === "Weapon Finesse"));
}

// --- a launcher with no imported class is no launcher -------------------------------------------
{
  const { launcherAmmoPattern } = await import(new URL("ammo.mjs", S));
  const longbow = weap("Long Bow", { system: { missile: true, melee: false } });
  check("with no class imported a bow is told by nothing, not by its name", launcherAmmoPattern(longbow, classifyWeapon(longbow)) === null);
  const declaredBow = weap("Long Bow", { flags: { category: "bowCrossbow" } });
  check("a class the item declares tells it", launcherAmmoPattern(declaredBow, classifyWeapon(declaredBow))?.test("Arrow") === true);
}

// --- the first sync waits for the rows ---------------------------------------------------------
const moduleSource = readFileSync(new URL("../scripts/equipment/module.mjs", import.meta.url), "utf8");
const readyBody = moduleSource.slice(moduleSource.indexOf('Hooks.once("ready"'));
check("the ready handler awaits rowsReady before it refreshes any loadout", (() => {
  const wait = readyBody.indexOf("await rowsReady()");
  const first = readyBody.indexOf("for (const actor of owned)");
  return wait > 0 && first > wait;
})());

// --- what was registered before comes back ---------------------------------------------------------
registerWeaponSource(defaults);
check("registering the replaced source (none) leaves no rows", !hasWeaponRows() && training.weaponUnits().length === 0);

console.log(`test-weapon-nulls: ${pass} checks passed`);
