/**
 * The organisation axes of a beastman template and what generation does with
 * them: the troop, trait and gear axes minted from the imported tables, the
 * canonical axis order and the unions that restore it, the `table` option of
 * Leader figures and its cells, the natural-attack cells, and
 * `applyGeneratedLeaderGrade` / `applyGeneratedOrganisation` writing standing
 * figures and only those. Foundry-free and book-free: every row, breed, label,
 * figure and page reference below is invented. What this pins is procedure.
 * Run: node tools/test-organisation-axes.mjs
 */
import assert from "node:assert/strict";
import { AXIS_ORDER, orderAxes, organisationAxes, unionOrganisationAxes } from "../scripts/importer/organisation-axes.mjs";
import { applyGeneratedLeaderGrade, applyGeneratedOrganisation, naturalAttackItems, GEAR_AXIS, NO_TRAIT, NO_TROOP, TRAIT_AXIS, TROOP_AXIS } from "../scripts/monsters/organisation.mjs";
import { applyGeneratedKit } from "../scripts/monsters/kits.mjs";
import { derivationTips } from "../scripts/monsters/statblock.mjs";
import { SOURCE_AXIS } from "../scripts/importer/leader-roles.mjs";
import { chooseAxes, optionAvailable, ROLL_PIN } from "../scripts/lib/template-logic.mjs";
import { registryBands } from "../scripts/lib/template-bands.mjs";
import { PRIORITY, registerTable, resetTables } from "../scripts/lib/tables.mjs";

const MID = "acks-extras";
let pass = 0;
const check = (label, cond) => {
  assert.ok(cond, label);
  pass++;
};
const eq = (label, a, b) => {
  assert.deepEqual(a, b, label);
  pass++;
};

/* --- invented tables, in the shape importedOrganisation() returns ------------------- */
const band = (min, max) => ({ min, max });
const org = {
  troops: {
    cite: "XX p. 2",
    rows: [
      { key: "ra", label: "Row A", cells: { alba: band(1, 20), brex: null } },
      { key: "rb", label: "Row B", cells: { alba: band(21, 40), brex: band(1, 50) } },
      { key: "rc", label: "Row C", cells: { alba: null, brex: band(51, 100) } },
    ],
  },
  traits: {
    cite: "XX p. 3",
    rows: [
      { key: "ta", label: "Trait A", cells: { alba: band(1, 2), brex: null } },
      { key: "tb", label: "Trait B", cells: { alba: band(3, 6), brex: band(1, 6) } },
      { key: "tc", label: "Trait C", cells: { alba: band(7, 8), brex: band(7, 8) } },
      { key: "td", label: "Trait D", cells: { alba: band(9, 9), brex: band(9, 10) } },
    ],
  },
  leaders: {
    cite: "XX p. 1",
    rows: [
      { key: "champion", label: "Champion", cells: { alba: { ac: 8, armour: "felt", hd: "2", hp: 9, die: "1d8", dmg: 1 }, brex: null } },
      { key: "chieftain", label: "Chieftain", cells: { alba: { ac: 10, armour: "plate", hd: "4+1", hp: 20, die: "1d10", dmg: null }, brex: { ac: 9, armour: "x", hd: "3", hp: 15, die: "1d6", dmg: 2 } } },
    ],
  },
  troopRules: {
    cite: "XX p. 2",
    rows: [
      { key: "ra", label: "Row A", figures: { attack: 2, acReduction: 2, armourBump: 1, opponentSurprise: -2, proficiency: "Quill work" } },
      { key: "rb", label: "Row B", figures: { initiative: 1, avoidSurprise: 1, vulnerableAttack: 4 } },
      { key: "rc", label: "Row C", figures: {} },
    ],
  },
  traitRules: {
    cite: "XX p. 3",
    rows: [
      { key: "ta", label: "Trait A", figures: { damage: { alba: ["1d2-1", "1d2-1", "3"], brex: [] } } },
      { key: "tb", label: "Trait B", figures: { damage: 1, morale: -1, outnumber: [2, 1] } },
      { key: "tc", label: "Trait C", figures: { morale: 2, damage: 1, proficiency: "Quill work", proficiencyRanks: 2 } },
      { key: "td", label: "Trait D", figures: { armourBump: 1 } },
    ],
  },
  equipment: { cite: "XX p. 4", rows: [{ key: "ea", label: "Gear A", figures: { radius: 10 } }, { key: "eb", label: "Gear B", figures: {} }] },
};
const labels = { troopAxis: "Troop", noTroop: "No troop", traitAxis: "Trait", noTrait: "No trait", gearAxis: "Gear", sourceAxis: "Leaders", sourcePrinted: "Printed", sourceTable: "Table (XX p. 1)" };
const variantOptions = () => ["alba", "brex"].map((key) => ({ key, label: key, nameLabel: "", merge: { ac: { value: 5 }, attack: { throw: 11 }, details: { morale: 0 } }, flags: { [MID]: { extras: { hd: { count: 1, bonus: null }, saveAs: { class: "fighter", level: 1 } } } } }));
const fresh = () => {
  const options = variantOptions();
  const axes = [{ key: "variant", label: "Variant", roll: "", derive: { from: "", max: null }, options }];
  return { options, axes, cells: [], out: { nameFormat: "{variant}" } };
};

/* --- axis minting ----------------------------------------------------------------- */
let t = fresh();
const minted = organisationAxes({ ...t, org, labels });
eq("the three axes and the leader source are minted", minted.sort(), [GEAR_AXIS, SOURCE_AXIS, TRAIT_AXIS, TROOP_AXIS].sort());
eq("the axes stand in the canonical order, a role axis added for the table's leaders", t.axes.map((a) => a.key), ["variant", SOURCE_AXIS, "role", TROOP_AXIS, TRAIT_AXIS, GEAR_AXIS]);
const troop = t.axes.find((a) => a.key === TROOP_AXIS);
eq("troop options: the default, then one per row key with its imported label", troop.options.map((o) => `${o.key}:${o.label}`), [`${NO_TROOP}:No troop`, "ra:Row A", "rb:Row B", "rc:Row C"]);
eq("the troop axis takes its bands from the registry by variant, rolls on no die of its own, and defaults to none", [troop.bandsFrom, troop.roll, troop.default], [{ doc: "monsters", table: "beastmanSpecialTroops", by: "variant" }, "", NO_TROOP]);
const trait = t.axes.find((a) => a.key === TRAIT_AXIS);
eq("trait options follow the trait table; its default is no trait", [trait.default, trait.options.length, trait.bandsFrom.table], [NO_TRAIT, 5, "beastmanTraits"]);
const gear = t.axes.find((a) => a.key === GEAR_AXIS);
check("gear is a multi axis, keyed by the equipment rows, with no bands", gear.multi && gear.options.map((o) => o.key).join() === "ea,eb" && !gear.bandsFrom);
eq("the source axis lists As printed, then the table option, whose label names the page", t.axes.find((a) => a.key === SOURCE_AXIS).options.map((o) => `${o.key}:${o.label}`), ["printed:Printed", "table:Table (XX p. 1)"]);
eq("the troop row keys carry a marker flag", troop.options[1].flags[MID].extras.organisation, { troop: "ra" });

t = fresh();
organisationAxes({ ...t, org: { ...org, troops: { rows: [], cite: null }, traits: { rows: [], cite: null }, leaders: { rows: [], cite: null } }, labels });
eq("with no band tables nothing is minted", t.axes.map((a) => a.key), ["variant"]);
t = fresh();
t.options.splice(0, 2, { key: "zeta", label: "zeta", nameLabel: "", merge: {}, flags: {} });
t.axes[0].options = t.options;
eq("a template none of whose variants is a table column gains no axis", organisationAxes({ ...t, org, labels }), []);
t = fresh();
organisationAxes({ ...t, org: { ...org, equipment: { rows: [], cite: null } }, labels });
check("no equipment rows, no gear axis", !t.axes.some((a) => a.key === GEAR_AXIS));

/* --- the cells --------------------------------------------------------------------- */
t = fresh();
organisationAxes({ ...t, org, labels });
const keysOf = (axisKey) => t.cells.filter((c) => c.by.includes(axisKey)).map((c) => c.key).sort();
eq("table cells exist where the leader table has a cell for the breed and the rank", t.cells.filter((c) => c.key.endsWith("|table")).map((c) => c.key).sort(), ["alba|champion|table", "alba|chieftain|table", "brex|chieftain|table"]);
eq("a table cell is keyed by variant, role and source, and marks variant and role only", [t.cells.find((c) => c.key === "alba|champion|table").by, t.cells.find((c) => c.key === "alba|champion|table").flags[MID].extras.organisation.grade, t.cells.find((c) => c.key === "alba|champion|table").merge], [["variant", "role", SOURCE_AXIS], { variant: "alba", role: "champion" }, {}]);
eq("a natural-attack cell exists for the breed whose list is non-empty, and none for the breed with an empty list", keysOf(TRAIT_AXIS), ["alba|ta"]);
eq("the role axis lists the ranks the table prints", t.axes.find((a) => a.key === "role").options.map((o) => o.key), ["standard", "champion", "chieftain"]);
eq("a template naming no role gets the name format of a role", t.out.nameFormat, "{variant} {role}");

/* --- availability: a cell-less trait is not made unavailable by a trait's cell -------- */
resetTables();
registerTable({ id: "monsters", tables: { beastmanSpecialTroops: Object.fromEntries(org.troops.rows.map((r) => [r.key, { label: r.label, ...r.cells }])), beastmanTraits: Object.fromEntries(org.traits.rows.map((r) => [r.key, { label: r.label, ...r.cells }])) } }, { priority: PRIORITY.WORLD });
const system = { axes: t.axes, cells: t.cells };
const bandOf = registryBands();
const avail = (axisKey, optKey, choices) => optionAvailable(system, system.axes.find((a) => a.key === axisKey), system.axes.find((a) => a.key === axisKey).options.find((o) => o.key === optKey), choices, bandOf);
check("a trait with a band stands even though another trait has cells (its marker is a patch)", avail(TRAIT_AXIS, "tb", { variant: "alba" }) && avail(TRAIT_AXIS, "tc", { variant: "alba" }));
check("a trait with no band for the variant is unavailable; the default always stands", !avail(TRAIT_AXIS, "ta", { variant: "brex" }) && avail(TRAIT_AXIS, NO_TRAIT, { variant: "brex" }));
check("a troop with no band for the variant is unavailable", !avail(TROOP_AXIS, "ra", { variant: "brex" }) && avail(TROOP_AXIS, "rb", { variant: "brex" }));
check("with no variant chosen only the default stands", !avail(TROOP_AXIS, "rb", {}) && avail(TROOP_AXIS, NO_TROOP, {}));
check("the table source stands only where a cell matches the variant", avail(SOURCE_AXIS, "table", { variant: "brex" }) && avail(SOURCE_AXIS, "printed", { variant: "brex" }));
let chosen = chooseAxes(system, { pinned: { variant: "alba" }, bandOf });
check("an unpinned generation takes the defaults: no troop, no trait", chosen.choices[TROOP_AXIS] === NO_TROOP && chosen.choices[TRAIT_AXIS] === NO_TRAIT);
chosen = chooseAxes(system, { pinned: { variant: "alba", [TROOP_AXIS]: ROLL_PIN, [TRAIT_AXIS]: ROLL_PIN }, rng: () => 0.5, bandOf });
check("a roll pin rolls the axis over the variant's bands", chosen.choices[TROOP_AXIS] === "rb" && ["tb", "tc", "td", "ta"].includes(chosen.choices[TRAIT_AXIS]) && chosen.log.some((l) => l.axis === TROOP_AXIS && l.source === "rolled"));
chosen = chooseAxes(system, { pinned: { variant: "alba", [GEAR_AXIS]: ["ea", "nope"] }, bandOf });
eq("a gear pin keeps the keys the axis holds", chosen.choices[GEAR_AXIS], ["ea"]);

/* --- order ------------------------------------------------------------------------- */
const keyed = (...ks) => ks.map((key) => ({ key, options: [] }));
eq("orderAxes restores the canonical order", orderAxes(keyed(TRAIT_AXIS, "kit", "role", SOURCE_AXIS, GEAR_AXIS, TROOP_AXIS, "variant")).map((a) => a.key), [...AXIS_ORDER]);
eq("an axis the order does not know keeps its slot", orderAxes(keyed("variant", "custom", GEAR_AXIS, "role")).map((a) => a.key), ["variant", "custom", "role", GEAR_AXIS]);
eq("a held template with none of the new axes: a union of a fresh build's axes gains them in order", unionOrganisationAxes(keyed("variant", "role", "kit"), t.axes, { keys: [SOURCE_AXIS, TROOP_AXIS, TRAIT_AXIS, GEAR_AXIS] }).map((a) => a.key), ["variant", SOURCE_AXIS, "role", TROOP_AXIS, "kit", TRAIT_AXIS, GEAR_AXIS]);
const heldAxes = structuredClone(t.axes);
const rebuilt = structuredClone(t.axes);
rebuilt.find((a) => a.key === TRAIT_AXIS).options.pop();
heldAxes.find((a) => a.key === SOURCE_AXIS).options.push({ key: "axioms", label: "A", nameLabel: "" });
unionOrganisationAxes(rebuilt, heldAxes, { keys: [SOURCE_AXIS, TRAIT_AXIS] });
check("a repair widens the source axis with the held option and leaves a banded axis to the rebuilt table", rebuilt.find((a) => a.key === SOURCE_AXIS).options.some((o) => o.key === "axioms") && rebuilt.find((a) => a.key === TRAIT_AXIS).options.length === 4);
unionOrganisationAxes(rebuilt, heldAxes, { keys: [TRAIT_AXIS], widen: true });
check("a merge widens a banded axis too", rebuilt.find((a) => a.key === TRAIT_AXIS).options.length === 5);
const lacking = t.axes.filter((a) => a.key !== TRAIT_AXIS);
unionOrganisationAxes(lacking, heldAxes, { keys: [TRAIT_AXIS] });
check("an axis the rebuild lacks is carried whole, in its place", lacking.map((a) => a.key).join() === "variant,leaderSource,role,troop,trait,gear");

/* --- the leader grade ---------------------------------------------------------------- */
const ladder = { hd1: { throw: 10 }, hd2: { throw: 9 }, hd3: { throw: 8 }, hd4: { throw: 7 }, hd5: { throw: 6 } };
/** A by-weapon attack as `bindMonster` writes one: the bare marker as its formula, a typed and extraordinary base, both bonuses at 0. */
const weaponItem = (formula = "By weapon") => ({
  name: "Strike",
  type: "weapon",
  system: { damage: { base: { formula, types: ["slashing"], extraordinary: true } }, bonus: { attack: 0, damage: 0 }, melee: true, missile: false, equipped: true },
});
const base = () => ({
  system: { ac: { value: 5 }, attack: { throw: 11 }, details: { morale: 0 }, damage: { mod: { melee: 0, missile: 0 } } },
  flags: { [MID]: { extras: { organisation: { grade: { variant: "alba", role: "champion" } } } } },
  items: [weaponItem()],
});
const alba = variantOptions()[0];
let resolved = base();
let grade = applyGeneratedLeaderGrade(resolved, { variantOption: alba, org, ladder, ladderCite: "XX r" });
check("the grade writes armour class, hit points and rating, the damage total and the throw moved by the ladder", resolved.system.ac.value === 8 && resolved.system.hp.max === 9 && resolved.system.hp.hd === "2d8" && resolved.system.damage.mod.melee === 1 && resolved.system.damage.mod.missile === 1 && resolved.system.attack.throw === 10);
check("its saves move with the rating and its source is recorded with the armour words", resolved.system.saves != null && resolved.flags[MID].extras.derived.leader.source === "table" && resolved.flags[MID].extras.derived.leader.armour === "felt" && resolved.flags[MID].extras.derived.leader.cite === "XX p. 1");
eq("the printed die is recorded on the grade and written as the by-weapon attack's formula, its types and mark kept", [grade.die, resolved.items.length, resolved.items[0].system.damage.base], ["1d8", 1, { formula: "1d8", types: ["slashing"], extraordinary: true }]);
eq("that attack's own damage bonus takes back the grade's modifier while the actor keeps it, so core's sum is the die", [resolved.items[0].system.bonus, resolved.system.damage.mod, resolved.system.damage.mod.melee + resolved.items[0].system.bonus.damage], [{ attack: 0, damage: -1 }, { melee: 1, missile: 1 }, 0]);
eq("the leader record holds the die, the row's label and the modifier", [resolved.flags[MID].extras.derived.leader.die, resolved.flags[MID].extras.derived.leader.row, resolved.flags[MID].extras.derived.leader.damage], ["1d8", "Champion", 1]);
const withCell = (cell) => ({ ...org, leaders: { cite: "XX p. 1", rows: [{ key: "champion", label: "Champion", cells: { alba: { ac: 8, armour: "felt", hd: "2", hp: 9, ...cell } } }] } });
const graded = (cell, items) => {
  const r = base();
  if (items) r.items = items;
  applyGeneratedLeaderGrade(r, { variantOption: alba, org: withCell(cell), ladder });
  return r;
};
resolved = graded({ die: "2d5 + 1", dmg: 4 });
eq("a die a conversion would not give is written as read, spaces stripped, never computed from the modifier", [resolved.items[0].system.damage.base.formula, resolved.items[0].system.bonus.damage], ["2d5+1", -4]);
resolved = graded({ die: "1d6−1", dmg: -2 });
eq("a printed minus sign is made plain and a negative modifier is taken back as a positive bonus", [resolved.items[0].system.damage.base.formula, resolved.items[0].system.bonus.damage], ["1d6-1", 2]);
resolved = graded({ die: "1d8", dmg: null });
eq("a modifier the table does not print takes back nothing", [resolved.items[0].system.damage.base.formula, resolved.items[0].system.bonus.damage], ["1d8", 0]);
resolved = graded({ die: "1d8", dmg: 3 }, [{ ...weaponItem(), system: { ...weaponItem().system, bonus: { attack: 0, damage: 2 } } }]);
eq("a bonus the item already carries is kept, less the modifier", resolved.items[0].system.bonus.damage, -1);
for (const die of [null, "", "By weapon", "1d8 or 2d4", "see text"]) {
  resolved = graded({ die, dmg: 1 });
  eq(`a die that is not dice (${JSON.stringify(die)}) writes nothing: the item is as bound and the record names no die`, [resolved.items[0].system.damage.base.formula, resolved.items[0].system.bonus.damage, resolved.flags[MID].extras.derived.leader.die], ["By weapon", 0, ""]);
}
resolved = graded({ die: "1d8", dmg: 1 }, [weaponItem("By weapon +1"), weaponItem("1d6"), { name: "Bite", type: "weapon", system: { damage: { base: { formula: "1d4" } }, bonus: 0 } }, { name: "Quill", type: "ability", system: {} }]);
eq("only the bare by-weapon marker is written: a modifier of its own, a die and a non-weapon are left, and no item is added", [resolved.items.map((i) => i.system.damage?.base?.formula ?? null), resolved.items.length, resolved.flags[MID].extras.derived.leader.die], [["By weapon +1", "1d6", "1d4", null], 4, ""]);
resolved = graded({ die: "1d8", dmg: 1 }, []);
check("a payload with no by-weapon attack gains none and records no die written", resolved.items.length === 0 && resolved.flags[MID].extras.derived.leader.die === "");
resolved = graded({ die: "1d8", dmg: 1 }, [weaponItem(), { ...weaponItem(), name: "Throw", system: { ...weaponItem().system, damage: { base: { formula: "By weapon" } }, bonus: 0 } }]);
eq("every qualifying attack takes the die, a bonus that is no object becoming one", [resolved.items.map((i) => i.system.damage.base.formula), resolved.items[1].system.bonus], [["1d8", "1d8"], { attack: 0, damage: -1 }]);
resolved = base();
resolved.flags[MID].extras.organisation.grade = { variant: "brex", role: "champion" };
check("a breed and rank the table holds no cell for writes nothing", applyGeneratedLeaderGrade(resolved, { variantOption: alba, org }) === null && resolved.system.ac.value === 5);
resolved = base();
resolved.flags[MID].extras.organisation.grade = { variant: "alba", role: "chieftain" };
applyGeneratedLeaderGrade(resolved, { variantOption: alba, org, ladder });
check("a modifier the table does not print is a total of 0", resolved.system.damage.mod.melee === 0 && resolved.system.hp.hd === "4d8+1");
resolved = base();
resolved.flags = {};
check("a creature with no grade mark is left as it is", applyGeneratedLeaderGrade(resolved, { variantOption: alba, org }) === null);

/* --- the standing figures ------------------------------------------------------------ */
const gen = (choices, over = {}, opts = {}) => {
  const r = { system: { ac: { value: 5 }, attack: { mod: { melee: 0, missile: 0 } }, initiative: { mod: 0 }, surprise: { avoidsurprise: 0 }, details: { morale: 0, biography: "" }, damage: { mod: { melee: 0, missile: 0 } }, ...over }, flags: { [MID]: { extras: { description: {} } } }, items: [] };
  const d = applyGeneratedOrganisation(r, { choices, org, noteLine: ({ kind, label, cite }) => `<p>${kind}|${label}|${cite}</p>`, findProficiency: (w) => (w === "Quill work" ? { _id: "x", name: "Quill", type: "ability" } : null), loc: (k, v) => `${k}:${v.n}`, ...opts });
  return { r, d, ex: r.flags[MID].extras };
};
let g = gen({ troop: "ra", trait: NO_TRAIT, role: "standard" });
check("the troop's attack bonus lands on the attack modifier, melee and missile", g.r.system.attack.mod.melee === 2 && g.r.system.attack.mod.missile === 2 && g.r.system.attack.throw === undefined);
check("its armour reduction and armour bump net into the armour class", g.r.system.ac.value === 5 - 2 + 1 && g.d.ac.troop === -1 && g.d.ac.base === 5);
check("a troop's opponent-surprise figure is recorded and applied nowhere", g.r.system.surprise.avoidsurprise === 0 && g.ex.organisation.troop.figures.opponentSurprise === -2);
eq("the troop's proficiency is granted as one copy of the library's ability, the word recorded", [g.r.items.length, g.r.items[0]?._id, g.ex.organisation.proficiencies], [1, undefined, [{ kind: "troop", word: "Quill work", ranks: 1, found: true }]]);
g = gen({ troop: "rb", role: "champion" });
check("initiative and the avoid-surprise bonus land on the core fields; a gated attack figure is recorded, not written", g.r.system.initiative.mod === 1 && g.r.system.surprise.avoidsurprise === 1 && g.r.system.attack.mod.melee === 0 && g.ex.organisation.troop.figures.vulnerableAttack === 4);
g = gen({ troop: "rc", role: "standard" });
check("a troop row that prints no figure writes nothing", g.d === null && g.r.system.ac.value === 5 && g.ex.organisation.troop.key === "rc");
g = gen({ troop: "ra", role: "drudge" });
check("a dependant takes no troop figure", g.r.system.ac.value === 5 && g.r.system.attack.mod.melee === 0 && g.r.items.length === 0);
let warned = "";
g = gen({ troop: "ra", role: "standard" }, {}, { findProficiency: () => null, warn: (m) => (warned = m) });
check("a proficiency no name answers to writes none and is reported", g.r.items.length === 0 && /no proficiency/.test(warned) && g.ex.organisation.proficiencies[0].found === false);
g = gen({ trait: "tb", role: "standard" });
check("a gated trait writes no damage and no morale, and records its figures", g.r.system.damage.mod.melee === 0 && g.r.system.details.morale === 0 && g.ex.organisation.trait.figures.outnumber.join() === "2,1");
g = gen({ trait: "tc", role: "standard" });
check("an ungated trait writes damage on both modifiers and morale", g.r.system.damage.mod.melee === 1 && g.r.system.damage.mod.missile === 1 && g.r.system.details.morale === 2 && g.d.morale.value === 2);
check("a trait's rank grant reaches a chieftain only", g.r.items.length === 0 && gen({ trait: "tc", role: "chieftain" }).r.items.length === 2);
g = gen({ trait: "tc", role: "standard" }, { details: { morale: 4 } });
check("morale stays inside the core field's bounds", g.r.system.details.morale === 4);
g = gen({ trait: "tc", role: "standard" }, { damage: { mod: { melee: null, missile: null } } });
check("a damage modifier left blank stays blank under a trait's bump", g.r.system.damage.mod.melee === null && g.d.damage === undefined);
g = gen({ trait: "td", role: "subChieftain" });
check("a trait's armour bump reaches a fighting rank", g.r.system.ac.value === 6 && g.d.ac.trait === 1);
check("and no caster", gen({ trait: "td", role: "shaman" }).r.system.ac.value === 5);
g = gen({ troop: "ra", trait: "td", role: "standard" });
check("troop and trait bumps add, each part kept", g.r.system.ac.value === 5 - 1 + 1 && g.d.ac.troop === -1 && g.d.ac.trait === 1);
g = gen({ trait: "td", role: "standard" }, { ac: { value: null } });
check("an armour class that is not a figure is left alone", g.r.system.ac.value === null);
g = gen({ gear: ["ea", "eb"], role: "standard" });
check("gear is recorded with its row's figures and applies nothing", g.ex.organisation.gear.map((x) => x.key).join() === "ea,eb" && g.ex.organisation.gear[0].figures.radius === 10 && g.d === null && g.r.system.ac.value === 5);
check("each piece is named in both prose channels with its page", g.r.system.details.biography.includes("gear|Gear A|XX p. 4") && g.ex.description.notes.includes("gear|Gear B|XX p. 4"));
check("nothing chosen, nothing written", applyGeneratedOrganisation({ system: {} }, { choices: { troop: NO_TROOP, trait: NO_TRAIT, gear: [] }, org }) === null);
check("a table not imported writes nothing", gen({ troop: "ra", role: "standard" }, {}, { org: { ...org, troopRules: { rows: [], cite: null }, troops: { rows: [], cite: null } } }).r.system.ac.value === 5);

/* --- natural attacks ------------------------------------------------------------------ */
eq("one weapon per listed die, a bare number a flat die, a text without a die none", naturalAttackItems(["1d2-1", "x", "3", "1d3 - 1"], (n) => `a${n}`).map((i) => [i.name, i.system.damage.base.formula]), [["a1", "1d2-1"], ["a2", "3"], ["a3", "1d3-1"]]);
const marked = (variant) => ({ system: { ac: { value: 5 }, details: {} }, flags: { [MID]: { extras: { organisation: { naturalAttacks: { variant, trait: "ta" } } } } }, items: [] });
resolved = marked("alba");
applyGeneratedOrganisation(resolved, { choices: { trait: "ta", role: "standard" }, org, loc: (k, v) => `${v.label} ${v.n}` });
eq("a marked cell gives the breed's natural attacks, named from the trait's label", resolved.items.map((i) => [i.name, i.system.damage.base.formula]), [["Trait A 1", "1d2-1"], ["Trait A 2", "1d2-1"], ["Trait A 3", "3"]]);
check("and records how many", resolved.flags[MID].extras.organisation.natural.count === 3);
resolved = marked("brex");
applyGeneratedOrganisation(resolved, { choices: { trait: "ta", role: "standard" }, org });
check("a breed whose list is empty gets no item", resolved.items.length === 0);

/* --- the kit and the trait together; the tooltips ------------------------------------- */
const kitted = { system: { ac: { value: 4 }, damage: { mod: { melee: 0, missile: 0 } }, details: { morale: 0 } }, flags: { [MID]: { extras: { kit: { troop: "k", label: "K", ac: 6, cite: "XX p. 9" } } } }, items: [] };
kitted.system.ac.value = 6;
applyGeneratedOrganisation(kitted, { choices: { troop: "ra", trait: "td", role: "standard" }, org });
const kex = kitted.flags[MID].extras;
check("the bumps stand on the kit's armour class", kitted.system.ac.value === 6 - 2 + 1 + 1);
const loc = (k, d) => `${k}${d ? JSON.stringify(d) : ""}`;
const snap = (over = {}) => ({ derived: kex.derived, kit: kex.kit, ac: kitted.system.ac.value, morale: 0, damageMod: 0, attackMod: kitted.system.attack?.mod?.melee, initiative: 0, surpriseAvoid: 0, ...over });
let tips = derivationTips(snap(), loc);
check("the armour class tip keeps the kit's part and names each organisation part with its page", tips.acTip.includes("statblock.tip.acKit") && tips.acTip.includes("statblock.tip.orgFigure") && tips.acTip.includes("Row A") && tips.acTip.includes("XX p. 3"));
check("the tip is gone once a Judge changes the figure", !derivationTips(snap({ ac: 99 }), loc).acTip.includes("orgFigure"));
check("the attack throw's tip names the troop's bonus while the modifier stands, and not after an edit", derivationTips(snap(), loc).throwTip.includes("orgFigure") && !derivationTips(snap({ attackMod: 9 }), loc).throwTip.includes("orgFigure"));
const sc = gen({ troop: "rb", role: "standard" });
tips = derivationTips({ derived: sc.ex.derived, ac: 5, morale: 0, damageMod: 0, attackMod: 0, initiative: sc.r.system.initiative.mod, surpriseAvoid: sc.r.system.surprise.avoidsurprise }, loc);
check("initiative and the avoid-surprise figure carry their parts and pages", tips.initiativeTip.includes("Row B") && tips.initiativeTip.includes("XX p. 2") && tips.surpriseTip.includes("orgFigure"));
const mc = gen({ trait: "tc", role: "standard" });
tips = derivationTips({ derived: mc.ex.derived, ac: 5, morale: mc.r.system.details.morale, damageMod: mc.r.system.damage.mod.melee, attackMod: 0, initiative: 0, surpriseAvoid: 0 }, loc);
check("morale and damage carry the trait's part", tips.moraleTip.includes("Trait C") && tips.damageTip.includes("Trait C"));
const tableLeader = { derived: { leader: { source: "table", cite: "XX p. 1", ac: 8, armour: "felt" }, throw: { hd: "2" } }, ac: 8, morale: 0, damageMod: 0 };
tips = derivationTips(tableLeader, loc);
check("a table leader's tip names the page and the armour words, and says edited once the armour class moves", tips.leaderTip.includes("leaderTable{") && tips.acTip.includes("acTable") && derivationTips({ ...tableLeader, ac: 9 }, loc).leaderTip.includes("leaderTableEdited"));

/* --- through the kit: the order the listener runs ---------------------------------------- */
const withKit = base();
withKit.system.ac.value = 5;
applyGeneratedLeaderGrade(withKit, { variantOption: alba, org, ladder });
withKit.flags[MID].extras.kit = { troop: "k", label: "K", ac: 4, memberAc: 5, role: "champion", compute: true, cite: "XX p. 9" };
applyGeneratedKit(withKit, {});
check("the kit reads the grade's armour class: the troop row's plus the leader's over its warrior's", withKit.system.ac.value === 4 + (8 - 5));

/* --- the grade's die against a troop kit, the unarmoured kit and the trait ---------------- */
const kitCell = (over = {}) => ({ troop: "k", label: "K", ac: 4, memberAc: 5, damage: 2, memberDamage: 0, role: "champion", compute: true, cite: "XX p. 9", ...over });
const kitFirst = base();
kitFirst.flags[MID].extras.kit = kitCell();
const kitGrade = applyGeneratedLeaderGrade(kitFirst, { variantOption: alba, org, ladder });
eq("under a troop kit the die is recorded and writes nothing: the formula stays the marker and the bonus 0", [kitGrade.die, kitFirst.items[0].system.damage.base.formula, kitFirst.items[0].system.bonus.damage, kitFirst.flags[MID].extras.derived.leader.die], ["1d8", "By weapon", 0, ""]);
applyGeneratedKit(kitFirst, {});
check("the kit still gives the troop row's modifier plus the leader's over its warrior's", kitFirst.system.damage.mod.melee === 2 + (1 - 0) && kitFirst.system.damage.mod.missile === 3);
const bare = base();
bare.flags[MID].extras.kit = kitCell({ troop: "unarmoured", naturalAc: 6, kind: "alba" });
applyGeneratedLeaderGrade(bare, { variantOption: alba, org, ladder });
eq("the unarmoured kit is no troop kit: the die stands", [bare.items[0].system.damage.base.formula, bare.items[0].system.bonus.damage], ["1d8", -1]);
resolved = base();
resolved.flags[MID].extras.organisation.naturalAttacks = { variant: "alba", trait: "ta" };
resolved.items.push(...naturalAttackItems(["1d2-1"], (n) => `pre${n}`));
applyGeneratedLeaderGrade(resolved, { variantOption: alba, org, ladder });
applyGeneratedOrganisation(resolved, { choices: { trait: "ta", role: "champion" }, org, loc: (k, v) => `${v.label} ${v.n}` });
eq("natural attacks, before or after the grade, keep their own dice and bonuses", resolved.items.slice(1).map((i) => [i.system.damage.base.formula, i.system.bonus]), [["1d2-1", 0], ["1d2-1", 0], ["1d2-1", 0], ["3", 0]]);
check("and the by-weapon attack still holds the die", resolved.items[0].system.damage.base.formula === "1d8" && resolved.items[0].system.bonus.damage === -1);
resolved = base();
applyGeneratedLeaderGrade(resolved, { variantOption: alba, org, ladder });
applyGeneratedOrganisation(resolved, { choices: { trait: "tc", role: "champion" }, org });
check("an ungated trait's damage adds to the actor's modifier and nets, with the take-back, to the die plus the trait's figure", resolved.system.damage.mod.melee === 2 && resolved.items[0].system.damage.base.formula === "1d8" && resolved.system.damage.mod.melee + resolved.items[0].system.bonus.damage === 1);

console.log(`test-organisation-axes: ${pass} checks passed.`);
