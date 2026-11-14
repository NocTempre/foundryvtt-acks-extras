/**
 * Beastman kits (scripts/monsters/kits.mjs) and the Kit axis built from them
 * (scripts/importer/kit-presets.mjs): a troop row's damage cell read, the
 * imported tables read through the registry with their citations, a row
 * dressing only the kind and Hit Dice it is printed for, rank-and-file cells
 * writing the row's stat cells and no item, a leader's and an unarmoured
 * creature's armour class and a leader's damage modifier worked out at
 * generation with their parts, the axis
 * defaulting to the stat block, the kit hidden where a role has no cell, the
 * die conversion read through its header, and the tooltips naming each
 * figure's row only while the actor holds it.
 *
 * Every kind, row, figure and citation is invented: kinds no book prints and
 * figures chosen so a result can only come from what is passed in. The
 * pages' own rows are the live recipe's (docs/monsters/TESTING.md).
 */
import assert from "node:assert/strict";
import {
  troopDamage,
  importedKits,
  kitArmourClass,
  kitDamage,
  damageModOf,
  applyGeneratedKit,
  convertedDie,
  KIT_DOC,
  KIT_TABLES,
  KIT_AXIS,
  OWN_KIT,
  UNARMOURED,
} from "../scripts/monsters/kits.mjs";
import { kitPresets, unionKitAxis } from "../scripts/importer/kit-presets.mjs";
import { proseLeaderRoles, entryLeaderTemplate, STANDARD_ROLE } from "../scripts/importer/leader-roles.mjs";
import { chooseAxes, optionAvailable, resolveActor } from "../scripts/lib/template-logic.mjs";
import { PRIORITY, registerTable, resetTables } from "../scripts/lib/tables.mjs";
import { applyCellPattern } from "../scripts/importer/table-extract.mjs";
import { derivationTips } from "../scripts/monsters/statblock.mjs";

const MID = "acks-extras";
let passed = 0;
const ok = (name, fn) => {
  fn();
  passed++;
  console.log("ok   " + name);
};

ok("a troop row's damage cell reads as the creature's own modifier", () => {
  assert.equal(troopDamage("BW"), 0);
  assert.equal(troopDamage("BW-2"), -2);
  assert.equal(troopDamage("BW +4"), 4);
  assert.equal(troopDamage("BW+3/d5, d7"), 3, "a natural figure after the slash is not the weapon's");
  assert.equal(troopDamage("BW−1"), -1, "a typeset minus reads as one");
  assert.equal(troopDamage("2d7"), null);
  assert.equal(troopDamage(""), null);
});

ok("a label's bracketed note reads off as the row's note", () => {
  assert.deepEqual(applyCellPattern("Light Infantry (a pike,  a buckler)", "parenthetical"), { note: "a pike, a buckler" });
  assert.deepEqual(applyCellPattern("Bowmen (a long string", "parenthetical"), { note: "a long string" }, "a bracket the line cut off still reads");
  assert.equal(applyCellPattern("Bowmen", "parenthetical"), null);
});

const TROOPS = {
  printerLightInfantry: { kind: "printer", troop: "lightInfantry", ac: 5, move: 70, hd: "2+1", damage: "BW+2", morale: 3, note: "a pike, a buckler" },
  printerBowmen: { kind: "printer", troop: "bowmen", ac: 4, move: 70, hd: "2+1", damage: "BW", morale: 3, note: "a long string" },
  printerHeavyInfantry: { kind: "printer", troop: "heavyInfantry", ac: 7, move: 70, hd: "3", damage: "BW+1", morale: 3, note: "a wall" },
  stampSlingers: { kind: "stamp", troop: "slingers", ac: 6, move: 70, hd: "2+1", damage: "BW", morale: 0, note: "a sling" },
  binderLightInfantry: { kind: "binder", troop: "lightInfantry", ac: 2, move: 40, hd: "1/2", damage: "BW-1", morale: -1, note: "a reed" },
  broken: { kind: "printer", troop: "slingers", ac: null, damage: "BW" },
  gone: { __missing: true },
};
const BYTYPE = { printer: { kind: "printer", naturalAc: 2 }, binder: { kind: "binder", naturalAc: 0 } };
const DICE = {
  header: { col1: "-2", col2: "0", col3: "+2" },
  d5: { die: "1d5", col1: "1d3", col2: "1d5", col3: "1d9 or 2d5" },
};
const register = () => {
  resetTables();
  registerTable(
    {
      id: KIT_DOC,
      cites: { [KIT_TABLES.troops]: "QQ p.41", [KIT_TABLES.byType]: "WW p.4", [KIT_TABLES.dice]: "WW p.4" },
      tables: { [KIT_TABLES.troops]: TROOPS, [KIT_TABLES.byType]: BYTYPE, [KIT_TABLES.dice]: DICE },
    },
    { priority: PRIORITY.WORLD },
  );
};

ok("the kits are read from the registry with their citations, and nothing without them", () => {
  resetTables();
  const none = importedKits();
  assert.deepEqual(none.troops, []);
  assert.deepEqual(none.byType, {});
  assert.equal(none.troopsCite, null);
  register();
  const k = importedKits();
  assert.equal(k.troops.length, 5, "a row missing its armour class and a row marked missing are left out");
  const li = k.troops.find((t) => t.kind === "printer" && t.troop === "lightInfantry");
  assert.deepEqual(li, { kind: "printer", troop: "lightInfantry", ac: 5, move: 70, hd: "2+1", damage: 2, morale: 3, note: "a pike, a buckler" });
  assert.deepEqual(k.byType.printer, { naturalAc: 2 });
  assert.equal(k.troopsCite, "QQ p.41");
  assert.equal(k.byTypeCite, "WW p.4");
});

const member = (key, { count, bonus = null, ac, mod = 0 }) => ({
  key,
  label: key,
  merge: {
    ac: { value: ac },
    hp: { hd: "1d8", value: 4, max: 4 },
    attack: { throw: 9 },
    details: { morale: 0 },
    ...(mod ? { damage: { mod: { melee: mod, missile: mod } } } : {}),
  },
  items: [],
  flags: { [MID]: { cookbook: { id: `b.${key}`, cite: "ZZ p.3" }, extras: { hd: { count, bonus }, saveAs: { class: "fighter", level: Math.floor(count) } } } },
});

const family = ({ roles = true } = {}) => {
  register();
  const options = [member("printer", { count: 2, bonus: 1, ac: 3, mod: 1 }), member("binder", { count: 0.5, ac: 1 }), member("stray", { count: 2, ac: 2 })];
  const axes = [{ key: "variant", label: "Variant", roll: "", options }];
  const cells = [];
  const out = { nameFormat: "{variant}" };
  if (roles) {
    const memberText = new Map([["printer", "Each printer gang will be led by a champion with 6 AC, 4 HD, 20 hp, and a +3 damage bonus. Its drudges have Spd 30', AC 1, 2 hp, ML -2."]]);
    proseLeaderRoles({ options, memberText, axes, cells, out });
  }
  kitPresets({ options, axes, cells, kits: importedKits() });
  return { axes, cells, system: { axes, cells, output: { nameFormat: out.nameFormat } } };
};

ok("a troop row dresses only its own kind, and only at the Hit Dice it prints", () => {
  const { cells } = family();
  const kits = cells.filter((c) => (c.by ?? []).includes(KIT_AXIS)).map((c) => c.key).sort();
  assert.ok(kits.includes(`printer|${STANDARD_ROLE}|lightInfantry`));
  assert.ok(kits.includes(`printer|${STANDARD_ROLE}|bowmen`));
  assert.ok(!kits.some((k) => k.endsWith("|heavyInfantry")), "a row printing other Hit Dice than the member's dresses nobody");
  assert.ok(kits.includes(`binder|${STANDARD_ROLE}|lightInfantry`), "a fraction of a die matches its row");
  assert.ok(!kits.some((k) => k.startsWith("stray|")), "a variant whose kind no table names gets no kit");
  assert.ok(!kits.some((k) => k.endsWith("|slingers")), "another kind's row at the same Hit Dice dresses nobody");
  assert.ok(!kits.some((k) => k.includes("|drudge|")), "a dependant takes no kit");
  assert.ok(cells.some((c) => c.key === "printer|drudge"), "the dependant's own cell is there to be dressed");
  assert.ok(kits.includes(`printer|${STANDARD_ROLE}|${UNARMOURED}`) && kits.includes(`binder|${STANDARD_ROLE}|${UNARMOURED}`));
});

ok("the rank and file in a kit takes the row's stat cells and no item", () => {
  const { system } = family();
  const r = resolveActor(system, { variant: "printer", role: STANDARD_ROLE, [KIT_AXIS]: "lightInfantry" }, { templateName: "T" });
  assert.equal(r.system.ac.value, 5);
  assert.deepEqual(r.system.damage.mod, { melee: 2, missile: 2 });
  assert.equal(r.system.movement.base, 70);
  assert.equal(r.system.details.morale, 3);
  assert.equal(r.items.length, 0);
  const kit = r.flags[MID].extras.kit;
  assert.equal(kit.note, "a pike, a buckler");
  assert.equal(kit.cite, "QQ p.41");
  assert.equal(kit.compute, undefined, "a printed row is not worked out");
  applyGeneratedKit(r);
  assert.equal(r.system.ac.value, 5);
  assert.equal(r.flags[MID].extras.derived, undefined, "a printed kit records no derivation");
});

ok("the kit axis is chosen last, defaults to the stat block, and leaves a creature as it is unpicked", () => {
  const { axes, system } = family();
  const kit = axes.find((a) => a.key === KIT_AXIS);
  assert.equal(axes[axes.length - 1], kit);
  assert.equal(kit.default, OWN_KIT);
  assert.deepEqual(kit.options.map((o) => o.key), [OWN_KIT, "lightInfantry", "bowmen", UNARMOURED]);
  const { choices } = chooseAxes(system, { pinned: { variant: "printer", role: STANDARD_ROLE } });
  assert.equal(choices[KIT_AXIS], OWN_KIT);
  const r = resolveActor(system, choices, { templateName: "T" });
  assert.equal(r.system.ac.value, 3);
  assert.equal(r.flags[MID].extras.kit, undefined);
});

ok("a kit is offered only where a cell matches the chosen variant and role", () => {
  const { axes, system } = family();
  const kit = axes.find((a) => a.key === KIT_AXIS);
  const bowmen = kit.options.find((o) => o.key === "bowmen");
  assert.equal(optionAvailable(system, kit, bowmen, { variant: "printer", role: STANDARD_ROLE }), true);
  assert.equal(optionAvailable(system, kit, bowmen, { variant: "binder", role: STANDARD_ROLE }), false, "a kind that fields no bowmen is not offered them");
  assert.equal(optionAvailable(system, kit, bowmen, { variant: "printer", role: "champion" }), true, "a leader of the kind may take the kit");
  assert.equal(optionAvailable(system, kit, bowmen, { variant: "binder", role: "champion" }), false);
});

ok("a dependant is offered the stat block alone: no troop kit, no unarmoured", () => {
  const { axes, system } = family();
  const kit = axes.find((a) => a.key === KIT_AXIS);
  const pinned = { variant: "printer", role: "drudge" };
  const offered = kit.options.filter((o) => optionAvailable(system, kit, o, pinned)).map((o) => o.key);
  assert.deepEqual(offered, [OWN_KIT]);
  const { choices } = chooseAxes(system, { pinned: { ...pinned, [KIT_AXIS]: "bowmen" } });
  assert.equal(choices[KIT_AXIS], OWN_KIT, "a pin the dependant is not offered falls back to the stat block");
});

ok("a creature outside a family takes its kind's kits on its leaders template, the lone variant no choice", () => {
  register();
  const text = "Each printer gang will be led by a champion with 6 AC, 4 HD, 20 hp, and a +3 damage bonus.";
  const option = { ...member("printer", { count: 2, bonus: 1, ac: 3, mod: 1 }), nameLabel: "printer", html: "", token: {} };
  const built = entryLeaderTemplate({ option, text });
  assert.ok(built);
  kitPresets({ options: [option], axes: built.axes, cells: built.cells, kits: importedKits() });
  const kit = built.axes.find((a) => a.key === KIT_AXIS);
  assert.equal(built.axes.at(-1), kit, "the kit is chosen last");
  assert.deepEqual(kit.options.map((o) => o.key), [OWN_KIT, "lightInfantry", "bowmen", UNARMOURED]);
  const system = { axes: built.axes, cells: built.cells, output: { nameFormat: built.out.nameFormat } };
  const { choices } = chooseAxes(system, {});
  assert.deepEqual(choices, { variant: "printer", role: STANDARD_ROLE, [KIT_AXIS]: OWN_KIT }, "nothing pinned: the creature as printed");
  const trooper = resolveActor(system, { ...choices, [KIT_AXIS]: "lightInfantry" }, { templateName: "T" });
  assert.equal(trooper.system.ac.value, 5);
  assert.equal(trooper.flags[MID].extras.kit.troop, "lightInfantry");
  const leader = resolveActor(system, { variant: "printer", role: "champion", [KIT_AXIS]: "lightInfantry" }, { templateName: "T" });
  applyGeneratedKit(leader);
  assert.equal(leader.system.ac.value, 8, "the row's 5 plus the leader's 6 over its warrior's 3");
  assert.deepEqual(leader.system.damage.mod, { melee: 4, missile: 4 }, "the row's 2 plus the leader's 3 over its warrior's 1");
});

ok("a leader in a troop's kit takes the row's armour class and damage plus its own over its warrior's, at generation", () => {
  const { system } = family();
  const r = resolveActor(system, { variant: "printer", role: "champion", [KIT_AXIS]: "lightInfantry" }, { templateName: "T" });
  assert.equal(r.system.ac.value, 6, "the cells leave the leader's own armour class for generation to replace");
  assert.deepEqual(r.system.damage.mod, { melee: 3, missile: 3 }, "and its own damage modifier, likewise");
  assert.equal(r.flags[MID].extras.kit.memberDamage, 1, "the cell carries its warrior's modifier");
  assert.equal(r.system.movement.base, 70);
  assert.equal(r.system.details.morale, 3);
  const derived = applyGeneratedKit(r);
  // The row's 5, plus the leader's 6 over its warrior's 3.
  assert.equal(r.system.ac.value, 8);
  assert.deepEqual(derived, { value: 8, base: 5, step: 3, from: "troop", leaderAc: 6 });
  // The row's +2 prints more than the warrior's +1: the leader's +3 over it is a step of 2.
  assert.deepEqual(r.system.damage.mod, { melee: 4, missile: 4 });
  const dk = r.flags[MID].extras.derived.kit;
  assert.equal(dk.memberAc, 3);
  assert.equal(dk.cite, "QQ p.41");
  assert.equal(dk.troop, "lightInfantry");
  assert.deepEqual(dk.damage, { value: 4, base: 2, step: 2, leaderDamage: 3, memberDamage: 1 });
});

ok("a leader's kit damage follows the row below the warrior's, over a warrior with none, and to nothing", () => {
  const { system } = family();
  const bow = resolveActor(system, { variant: "printer", role: "champion", [KIT_AXIS]: "bowmen" }, { templateName: "T" });
  applyGeneratedKit(bow);
  assert.deepEqual(bow.system.damage.mod, { melee: 2, missile: 2 }, "a row printing none, under the warrior's +1: 0 plus 3 less 1");
  assert.deepEqual(bow.flags[MID].extras.derived.kit.damage, { value: 2, base: 0, step: 2, leaderDamage: 3, memberDamage: 1 });
  // A warrior whose stat line prints no modifier has none.
  register();
  const bare = { ...member("printer", { count: 2, bonus: 1, ac: 3 }), nameLabel: "printer", html: "", token: {} };
  const built = entryLeaderTemplate({ option: bare, text: "Each printer gang will be led by a champion with 6 AC, 4 HD, 20 hp, and a +3 damage bonus." });
  kitPresets({ options: [bare], axes: built.axes, cells: built.cells, kits: importedKits() });
  const sys = { axes: built.axes, cells: built.cells, output: { nameFormat: built.out.nameFormat } };
  const lead = resolveActor(sys, { variant: "printer", role: "champion", [KIT_AXIS]: "lightInfantry" }, { templateName: "T" });
  applyGeneratedKit(lead);
  assert.deepEqual(lead.system.damage.mod, { melee: 5, missile: 5 }, "the row's 2 plus the leader's 3 over none");
  assert.equal(lead.flags[MID].extras.derived.kit.damage.memberDamage, 0);
  // A leader below its warrior takes the row down: the sum may be negative or none.
  assert.deepEqual(kitDamage({ troop: "bowmen", role: "champion", damage: 0, memberDamage: 4 }, 1), { value: -3, base: 0, step: -3, leaderDamage: 1, memberDamage: 4 });
  assert.equal(kitDamage({ troop: "bowmen", role: "champion", damage: 2, memberDamage: 3 }, 1).value, 0);
  const none = { system: { damage: { mod: { melee: 1, missile: 1 } } }, flags: { [MID]: { extras: { kit: { troop: "bowmen", role: "champion", damage: 2, memberDamage: 3, compute: true } } } } };
  applyGeneratedKit(none);
  assert.deepEqual(none.system.damage.mod, { melee: 0, missile: 0 });
  assert.equal(none.flags[MID].extras.derived.kit.damage.value, 0, "a sum of none is worked out, not missing");
  assert.equal(none.flags[MID].extras.derived.kit.damage.missing, undefined);
});

ok("a kit damage part that is not a number leaves the modifier blank (null), never 0 and never the leader's own total", () => {
  assert.equal(kitDamage({ troop: "bowmen", role: STANDARD_ROLE, damage: 2, memberDamage: 1 }, 3), null, "a rank and file has none to work out");
  assert.equal(kitDamage({ troop: UNARMOURED, role: "champion", damage: 2, memberDamage: 1 }, 3), null, "unarmoured changes the armour class alone");
  assert.equal(kitDamage(null, 3), null);
  assert.deepEqual(kitDamage({ troop: "bowmen", role: "champion", damage: 2, memberDamage: null }, 3), { missing: true }, "a cell that recorded no warrior");
  assert.deepEqual(kitDamage({ troop: "bowmen", role: "champion", damage: 2 }, 3), { missing: true }, "a cell made before the field existed");
  assert.deepEqual(kitDamage({ troop: "bowmen", role: "champion", damage: null, memberDamage: 1 }, 3), { missing: true });
  assert.deepEqual(kitDamage({ troop: "bowmen", role: "champion", damage: 2, memberDamage: 1 }, "x"), { missing: true }, "a leader's modifier that is not a number");
  assert.equal(damageModOf(undefined), 0);
  assert.equal(damageModOf("x"), null);
  assert.equal(damageModOf(-2), -2);
  const r = { system: { damage: { mod: { melee: 3, missile: 3 } } }, flags: { [MID]: { extras: { kit: { troop: "bowmen", label: "Bowmen", role: "champion", damage: 2, compute: true, cite: "QQ p.41" } } } } };
  applyGeneratedKit(r);
  assert.deepEqual(r.system.damage.mod, { melee: null, missile: null }, "the leader's own 3 does not stand in the kit's place, and no 0 does either");
  assert.strictEqual(r.system.damage.mod.melee, null);
  assert.strictEqual(r.system.damage.mod.missile, null);
  const dk = r.flags[MID].extras.derived.kit;
  assert.deepEqual(dk.damage, { missing: true });
  assert.equal(dk.cite, "QQ p.41");
  assert.equal(dk.value, undefined, "the armour class, missing its warrior's, was not worked out either");
});

ok("unarmoured is the kind's natural armour class, a leader's own advantage added", () => {
  const { system } = family();
  const plain = resolveActor(system, { variant: "printer", role: STANDARD_ROLE, [KIT_AXIS]: UNARMOURED }, { templateName: "T" });
  assert.equal(plain.system.ac.value, 3, "unarmoured writes no printed figure");
  assert.deepEqual(plain.system.damage.mod, { melee: 1, missile: 1 }, "the stat block's damage is kept");
  applyGeneratedKit(plain);
  assert.equal(plain.system.ac.value, 2);
  assert.equal(plain.flags[MID].extras.derived.kit.from, "natural");
  const champ = resolveActor(system, { variant: "printer", role: "champion", [KIT_AXIS]: UNARMOURED }, { templateName: "T" });
  applyGeneratedKit(champ);
  assert.equal(champ.system.ac.value, 5, "the natural 2 plus the leader's 6 over its warrior's 3");
});

ok("unarmoured reads the kind's natural armour class from the world's tables at generation, not from the cell", () => {
  const { system } = family();
  const gen = (kits) => {
    const r = resolveActor(system, { variant: "printer", role: STANDARD_ROLE, [KIT_AXIS]: UNARMOURED }, { templateName: "T" });
    applyGeneratedKit(r, { kits });
    return r;
  };
  const edited = gen({ byType: { printer: { naturalAc: 7 } }, byTypeCite: "WW p.9" });
  assert.equal(edited.system.ac.value, 7, "a Judge's edit to the table counts without a rebuild");
  assert.equal(edited.flags[MID].extras.derived.kit.cite, "WW p.9");
  const blanked = gen({ byType: {}, byTypeCite: null });
  assert.equal(blanked.system.ac.value, 3, "a kind the table no longer holds keeps the stat block's armour class");
  assert.equal(blanked.flags[MID].extras.derived?.kit, undefined, "and names no kit part");
});

ok("a kit missing a part leaves the armour class the cells wrote", () => {
  assert.equal(kitArmourClass({ troop: "lightInfantry", role: "champion", ac: 5, memberAc: null }, 6), null);
  assert.equal(kitArmourClass({ troop: "lightInfantry", role: "champion", ac: 5, memberAc: 3 }, null), null);
  assert.equal(kitArmourClass({ troop: UNARMOURED, role: STANDARD_ROLE, naturalAc: null }, 3), null);
  assert.equal(kitArmourClass({ troop: UNARMOURED, role: STANDARD_ROLE, naturalAc: 1, ac: 9 }, 3).value, 1, "unarmoured reads the natural figure, never a troop's");
  assert.deepEqual(kitArmourClass({ troop: "lightInfantry", role: STANDARD_ROLE, ac: 4 }, 9), { value: 4, base: 4, step: 0, from: "troop", leaderAc: null });
  const r = { system: { ac: { value: 6 } }, flags: { [MID]: { extras: { kit: { troop: "lightInfantry", role: "champion", ac: 5, memberAc: null, compute: true } } } } };
  assert.equal(applyGeneratedKit(r), null);
  assert.equal(r.system.ac.value, 6);
  assert.equal(r.flags[MID].extras.derived.kit.value, undefined, "no armour class was worked out");
  assert.equal(r.flags[MID].extras.derived.kit.damage.missing, true, "the row's damage, with no warrior's recorded, is blank");
  assert.equal(applyGeneratedKit({ system: {}, flags: {} }), null, "a creature with no kit is left as it is");
});

ok("the kit's own words reach both prose channels", () => {
  const { system } = family();
  const r = resolveActor(system, { variant: "printer", role: STANDARD_ROLE, [KIT_AXIS]: "bowmen" }, { templateName: "T" });
  r.system.details.biography = "<p>own</p>";
  applyGeneratedKit(r, { noteLine: (kit) => `<p>${kit.label}: ${kit.note}</p>` });
  assert.equal(r.system.details.biography, "<p>own</p><p>Bowmen: a long string</p>");
  assert.equal(r.flags[MID].extras.description.notes, "<p>Bowmen: a long string</p>");
});

ok("a template with no role axis keys its kits by variant alone", () => {
  const { cells, system } = family({ roles: false });
  const kits = cells.filter((c) => (c.by ?? []).includes(KIT_AXIS));
  assert.ok(kits.length && kits.every((c) => c.by.length === 2));
  const r = resolveActor(system, { variant: "binder", [KIT_AXIS]: "lightInfantry" }, { templateName: "T" });
  assert.equal(r.system.ac.value, 2);
  assert.deepEqual(r.system.damage.mod, { melee: -1, missile: -1 });
});

ok("no kit table, no kit axis", () => {
  resetTables();
  const options = [member("printer", { count: 2, bonus: 1, ac: 3 })];
  const axes = [{ key: "variant", options }];
  const cells = [];
  kitPresets({ options, axes, cells, kits: importedKits() });
  assert.equal(cells.length, 0);
  assert.ok(!axes.some((a) => a.key === KIT_AXIS));
});

ok("a merged template keeps a kit axis for the kits it carries", () => {
  const { axes } = family();
  const to = [{ key: "variant", options: [] }, { key: "role", options: [] }];
  unionKitAxis(to, axes);
  assert.equal(to[to.length - 1].key, KIT_AXIS);
  assert.deepEqual(to[2].options.map((o) => o.key), [OWN_KIT, "lightInfantry", "bowmen", UNARMOURED]);
  unionKitAxis(to, []);
  assert.equal(to.length, 3);
});

ok("the conversion table gives a die for a die and a modifier, by its header", () => {
  assert.equal(convertedDie(DICE, "1d5", 2), "1d9 or 2d5");
  assert.equal(convertedDie(DICE, "1D5", -2), "1d3");
  assert.equal(convertedDie(DICE, "1d5", 1), null, "a modifier no column stands for");
  assert.equal(convertedDie(DICE, "1d11", 2), null);
  assert.equal(convertedDie({ d5: DICE.d5 }, "1d5", 2), null, "no header, no reading");
  assert.equal(convertedDie(null, "1d5", 2), null);
});

ok("the tooltips name the kit's row only while the actor holds its figure", () => {
  const loc = (k, d = {}) => `${k}|${Object.entries(d).map(([a, b]) => `${a}=${b}`).join(",")}`;
  const kit = { troop: "bowmen", label: "Bowmen", ac: 4, morale: 3, damage: 0, cite: "QQ p.41" };
  const tips = derivationTips({ kit, ac: 4, morale: 3, damageMod: 0 }, loc);
  assert.equal(tips.acTip, "statblock.tip.acKit|ac=4,label=Bowmen,cite=QQ p.41");
  assert.equal(tips.moraleTip, "statblock.tip.kitFigure|label=Bowmen,cite=QQ p.41");
  assert.equal(tips.damageTip, "statblock.tip.kitFigure|label=Bowmen,cite=QQ p.41");
  const edited = derivationTips({ kit, ac: 5, morale: 1, damageMod: 2 }, loc);
  assert.equal(edited.acTip, "");
  assert.equal(edited.moraleTip, "");
  assert.equal(edited.damageTip, "");
  const leaderKit = { ...kit, role: "champion", compute: true };
  const dk = { value: 8, base: 5, step: 3, from: "troop", leaderAc: 6, memberAc: 3, label: "Bowmen", cite: "QQ p.41" };
  assert.equal(
    derivationTips({ kit: leaderKit, derived: { kit: dk }, ac: 8 }, loc).acTip,
    "statblock.tip.acKitLeader|ac=8,base=5,label=Bowmen,cite=QQ p.41,step=+3,leaderAc=6,memberAc=3",
  );
  assert.equal(derivationTips({ kit: leaderKit, derived: { kit: dk }, ac: 7 }, loc).acTip, "");
  const leader = { source: "axioms", cite: "YY p.7", ac: 6, damage: 3, baseAc: 3, acAdd: 3 };
  assert.match(
    derivationTips({ kit: leaderKit, derived: { kit: dk, leader }, ac: 8, damageMod: 3 }, loc).leaderTip,
    /^statblock\.tip\.leaderDerived\|/,
    "a derived leader in a kit is not reported as edited",
  );
  assert.match(derivationTips({ kit: leaderKit, derived: { kit: dk, leader }, ac: 9, damageMod: 3 }, loc).leaderTip, /^statblock\.tip\.leaderDerivedEdited\|/);
  const nat = { value: 2, base: 2, step: 0, from: "natural", leaderAc: null, memberAc: 3, label: "Unarmoured", cite: "WW p.4" };
  assert.match(derivationTips({ kit: { troop: UNARMOURED, label: "Unarmoured", compute: true }, derived: { kit: nat }, ac: 2 }, loc).acTip, /^statblock\.tip\.acKitNatural\|/);
  // A leader's kit damage: its parts while the actor holds the figure, and the leader reads intact.
  const dd = { value: 4, base: 2, step: 2, leaderDamage: 3, memberDamage: 1 };
  const dkd = { ...dk, damage: dd };
  const held = { kit: leaderKit, derived: { kit: dkd, leader }, ac: 8, damageMod: 4 };
  assert.equal(
    derivationTips(held, loc).damageTip,
    "statblock.tip.damageKitLeader|damage=+4,base=+2,label=Bowmen,cite=QQ p.41,step=+2,leaderDamage=+3,memberDamage=+1",
  );
  assert.match(derivationTips(held, loc).leaderTip, /^statblock\.tip\.leaderDerived\|/, "a generated leader whose kit changed its damage is not reported as edited");
  assert.equal(derivationTips({ ...held, damageMod: 5 }, loc).damageTip, "", "an edited modifier is not explained by parts it no longer comes from");
  assert.match(derivationTips({ ...held, damageMod: 5 }, loc).leaderTip, /^statblock\.tip\.leaderDerivedEdited\|/, "and the leader reads as edited");
  const sharp = { ...leader, damage: 4 };
  assert.match(derivationTips({ ...held, derived: { kit: dkd, leader: sharp } }, loc).leaderTip, /^statblock\.tip\.leaderDerivedEdited\|/, "the kit's figure is not the leader record's own");
  // A modifier worked out to none still names its parts; an empty schema record names nothing.
  const zero = { value: 0, base: 2, step: -2, leaderDamage: 1, memberDamage: 3 };
  assert.match(derivationTips({ kit: leaderKit, derived: { kit: { ...dk, damage: zero } }, ac: 8, damageMod: 0 }, loc).damageTip, /^statblock\.tip\.damageKitLeader\|damage=\+0,/);
  const blank = { missing: true, value: null };
  const heldBlank = { kit: leaderKit, derived: { kit: { ...dk, damage: blank }, leader }, ac: 8, damageMod: 0 };
  assert.equal(derivationTips(heldBlank, loc).damageTip, "QQ p.41", "a part not a number: the row's page alone");
  assert.match(derivationTips(heldBlank, loc).leaderTip, /^statblock\.tip\.leaderDerived\|/, "the blank the kit left is not an edit");
  const heldNull = { ...heldBlank, damageMod: null };
  assert.equal(derivationTips(heldNull, loc).damageTip, "QQ p.41", "a stored blank reads as none held: the row's page alone");
  assert.match(derivationTips(heldNull, loc).leaderTip, /^statblock\.tip\.leaderDerived\|/, "and the blank the kit left is not an edit");
  assert.equal(derivationTips({ ...heldBlank, damageMod: 2 }, loc).damageTip, "");
  assert.match(derivationTips({ ...heldBlank, damageMod: 2 }, loc).leaderTip, /^statblock\.tip\.leaderDerivedEdited\|/);
  const emptyRecord = { value: null, base: null, step: null, leaderDamage: null, memberDamage: null, missing: false };
  assert.equal(derivationTips({ kit: leaderKit, derived: { kit: { ...dk, damage: emptyRecord } }, ac: 8, damageMod: 0 }, loc).damageTip, "");
  const empty = derivationTips({ kit: { troop: "", ac: 4, morale: 3 }, ac: 4, morale: 3 }, loc);
  assert.equal(empty.acTip, "", "an empty kit record names nothing");
  assert.equal(empty.moraleTip, "");
});

console.log(`\n${passed} passed`);
