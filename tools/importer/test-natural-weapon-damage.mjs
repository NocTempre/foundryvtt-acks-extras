/**
 * What a monster's natural attacks take from the Judge's import: the damage
 * type each natural weapon is listed against (`naturalWeaponDamage`) and the
 * edges of the extraordinary-damage rule (`extraordinaryRule`), both of the
 * `monsters` registry document.
 *
 * Foundry-free and book-free. Every figure, pairing and run below is invented:
 * a weapon is filed under a type the page does not file it under, and an edge
 * is a figure no page prints, so nothing here reproduces a table. What this
 * pins is the procedure: the stat block's icon outranks the table, a weapon
 * the table does not list gets no type, an edge not imported leaves the
 * extraordinary mark unwritten where a monster's type needs one, and a
 * Judge's override layer is read like the import.
 * Run: node tools/importer/test-natural-weapon-damage.mjs
 */
import assert from "node:assert/strict";
import { extractTable } from "../../scripts/importer/table-extract.mjs";
import { TABLE_RECIPES } from "../../scripts/importer/table-recipes.mjs";
import { mapPairs } from "../../scripts/importer/stats-map.mjs";
import { extraordinaryEdges, naturalWeaponDamageMap, NATURAL_DOC } from "../../scripts/monsters/natural-weapons.mjs";
import { NATURAL_WEAPONS } from "../../scripts/lib/vocab.mjs";
import { PRIORITY, registerTable, resetTables } from "../../scripts/lib/tables.mjs";

let pass = 0;
const check = (label, cond) => {
  assert.ok(cond, label);
  pass++;
};

const FIRE_ICON = String.fromCodePoint(0xe906);
const run = (str, x, y, w = str.length * 5) => ({ str, x, y, w, h: 9 });
const RECIPES = TABLE_RECIPES.monsters.tables;

/* --- the read, on invented runs ---------------------------------------------- */
{
  // A label split by a drop-cap, a cell split likewise, and a legend below the
  // grid that repeats a type word and must not be read.
  const recipe = RECIPES.naturalWeaponDamage;
  const runs = [
    run("damage type", 50, 368), run("natural weapon", 124, 368),
    run("c", 49, 381, 5), run("old", 55, 381), run("z", 124, 381, 5), run("ork, blip", 129, 381),
    run("Fire", 49, 392), run("Qux", 124, 392),
    run("Cold", 49, 440), run("legend cell", 124, 440),
  ];
  const out = extractTable(runs, recipe);
  check("a row is read for each type the page prints and no other", Object.keys(out).join() === "cold,fire");
  check("a cell is the list of words, a split initial rejoined", JSON.stringify(out.cold) === '{"weapons":["zork","blip"]}' && JSON.stringify(out.fire) === '{"weapons":["qux"]}');
  check("the legend below the grid is not read", !JSON.stringify(out).includes("legend"));
}
{
  const recipe = { ...RECIPES.extraordinaryRule, column: { xMin: 20, xMax: 600 } };
  const lines = [
    "Rules for the sorting of damage by origin:",
    "If a beast is an animal with more than 7+2 HD and of gigantic size or larger,",
    "its attacks are marked. If a beast is a golem, ghoul, or vermin with more than 6 HD, they are too.",
  ];
  const out = extractTable(lines.map((str, i) => run(str, 100, 100 + i * 12)), recipe);
  check("a hit-dice edge reads its count and its bonus", JSON.stringify(out.animalHd) === '{"count":7,"bonus":2}');
  check("a hit-dice edge with no bonus reads a bonus of none", JSON.stringify(out.otherHd) === '{"count":6,"bonus":0}');
  check("the size edge reads the category word the anchor leads to", out.animalSize === "gigantic");
}

/* --- the consumer ------------------------------------------------------------- */
resetTables();
check("nothing imported: no damage map", naturalWeaponDamageMap() === null);
check("nothing imported: every edge null", Object.values(extraordinaryEdges()).every((v) => v === null));

registerTable(
  { id: NATURAL_DOC, tables: { naturalWeaponDamage: { cold: { weapons: ["Bite", "zork"] }, fire: { weapons: ["bite", "claw"] }, notAType: { weapons: ["tail"] }, slashing: { weapons: "claw" } } } },
  { priority: PRIORITY.WORLD },
);
check("a weapon word maps to its listed type, the first row's winning", naturalWeaponDamageMap().bite === "cold" && naturalWeaponDamageMap().claw === "fire");
check("a row that is no damage type, or holds no list, adds nothing", !("tail" in naturalWeaponDamageMap()));

registerTable({ id: NATURAL_DOC, tables: { extraordinaryRule: { animalHd: { count: 7, bonus: 2 }, animalSize: "gigantic", otherHd: { count: "six", bonus: 0 } } } }, { priority: PRIORITY.WORLD });
check("an edge reads as the page's figure", JSON.stringify(extraordinaryEdges().animalHd) === '{"count":7,"bonus":2}' && extraordinaryEdges().animalSize === "gigantic");
check("an edge that is no whole figure reads null", extraordinaryEdges().otherHd === null);
registerTable({ id: NATURAL_DOC, tables: { naturalWeaponDamage: { fire: { weapons: ["claw"] } } } }, { priority: PRIORITY.OVERRIDE });
check("a Judge's override is read in place of the import", naturalWeaponDamageMap().claw === "fire" && naturalWeaponDamageMap().bite === undefined);
resetTables();

/* --- the stat-block mapping --------------------------------------------------- */
const attack = (list, damage, extra, options) => mapPairs([{ label: "Attacks", value: `2 (${list} 5+)` }, { label: "Damage", value: damage }, ...extra], options).items.filter((i) => i.type === "weapon");
const flagsOf = (item) => item.flags["acks-extras"];

{
  const items = attack("bite, claw", "1d6 / 1d4", [], { naturalDamage: { bite: "cold" } });
  check("a listed weapon takes the imported type", flagsOf(items[0]).damageType === "cold" && flagsOf(items[0]).naturalWeapon === "bite");
  check("a weapon the table does not list carries no type", !("damageType" in flagsOf(items[1])) && flagsOf(items[1]).naturalWeapon === "claw");
}
{
  const items = attack("bite, claw", `1d6${FIRE_ICON} / 1d4`, [], { naturalDamage: { bite: "cold", claw: "cold" } });
  check("the stat block's own icon outranks the table", flagsOf(items[0]).damageType === "fire" && flagsOf(items[1]).damageType === "cold");
}
{
  const items = attack("bite, claw", "1d6 / 1d4", [], {});
  check("with no table imported no natural weapon carries a type", items.every((i) => !("damageType" in flagsOf(i))));
}

const typed = (type, hd, size, options) => attack("bite", "1d6", [{ label: "Type", value: type }, { label: "Hit Dice", value: hd }, { label: "Size", value: size }], options)[0];
const EDGES = { animalHd: { count: 7, bonus: 2 }, animalSize: "gigantic", otherHd: { count: 6, bonus: 0 } };
{
  check("an animal past the hit-dice edge and at the size edge is marked", flagsOf(typed("Animal", "7+3", "Gigantic", { extraordinaryEdges: EDGES })).extraordinary === true);
  check("the same animal below the size edge is unmarked", flagsOf(typed("Animal", "7+3", "Large", { extraordinaryEdges: EDGES })).extraordinary === false);
  check("an animal at the hit-dice edge is unmarked, bonus included", flagsOf(typed("Animal", "7+2", "Colossal", { extraordinaryEdges: EDGES })).extraordinary === false);
  check("an animal past the edge with no size read is not marked either way", !("extraordinary" in flagsOf(typed("Animal", "9", "", { extraordinaryEdges: EDGES }))));
  check("another listed type is held to the other hit-dice edge", flagsOf(typed("Undead", "7", "Man", { extraordinaryEdges: EDGES })).extraordinary === true && flagsOf(typed("Undead", "6", "Man", { extraordinaryEdges: EDGES })).extraordinary === false);
  check("a type the rule does not list is unmarked", flagsOf(typed("Plant", "20", "Colossal", { extraordinaryEdges: EDGES })).extraordinary === false);
}
{
  check("with no edges an animal's mark is left unwritten", !("extraordinary" in flagsOf(typed("Animal", "9", "Gigantic", {}))));
  check("with no edges another listed type's mark is left unwritten", !("extraordinary" in flagsOf(typed("Undead", "9", "Man", {}))));
  check("a humanoid is unmarked and an incarnation marked without any edge", flagsOf(typed("Humanoid", "9", "Man", {})).extraordinary === false && flagsOf(typed("Incarnation", "1", "Man", {})).extraordinary === true);
  check("an edge half imported answers only for what it covers", !("extraordinary" in flagsOf(typed("Animal", "9", "Gigantic", { extraordinaryEdges: { ...EDGES, animalSize: null } }))) && flagsOf(typed("Undead", "9", "Man", { extraordinaryEdges: { ...EDGES, animalSize: null } })).extraordinary === true);
}
{
  const sword = mapPairs([{ label: "Attacks", value: "1 (sword 5+)" }, { label: "Damage", value: "1d8" }, { label: "Type", value: "Animal" }], {}).items.find((i) => i.type === "weapon");
  check("an attack that is no natural weapon is unmarked and untyped", flagsOf(sword).extraordinary === false && !("damageType" in flagsOf(sword)) && !("naturalWeapon" in flagsOf(sword)));
}

/* --- the vocabulary ------------------------------------------------------------ */
check("no natural weapon in the vocabulary states a damage type", Object.values(NATURAL_WEAPONS).every((w) => Object.keys(w).join() === "label"));

console.log(`test-natural-weapon-damage: ${pass} passed`);
