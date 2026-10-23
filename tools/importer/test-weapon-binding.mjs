/**
 * The weapon binder writes the system's own fields: the size the type cell
 * prints, the special properties the "Special" cell names, a blank die where
 * the page prints none, and a count on every ammunition stack. Synthetic rows
 * in the extractor's own shape, so the check runs without the reference PDF;
 * the real page is `test-weapon-tables.mjs`. Every value here is invented.
 */
import assert from "node:assert";
import { bindWeaponRow, bindAmmoRow, sizeOf, settleQualities } from "../../scripts/importer/weapon-tables.mjs";

let pass = 0;
const check = (label, cond) => { assert.ok(cond, label); pass++; };

const row = (name, { melee = false, missile = false, size = null, damage = "", special = "", enc = "1/6", cost = "1gp", short = "", med = "", long = "" } = {}) =>
  ({ name, label: name, melee, missile, ammunition: false, size, cells: { damage, special, enc, cost, short, med, long } });

// --- the size printed before the use, through the page's abbreviations and a dropped first letter
check("a full size word", sizeOf("Thing Medium Melee") === "medium");
check("an abbreviated size", sizeOf("Thing Med. Melee/Missile") === "medium");
check("the small abbreviation", sizeOf("Thing Sm. Melee/Missile") === "small");
check("a small-caps drop of the first letter", sizeOf("Thing edium Melee") === "medium" && sizeOf("Thing iny Melee") === "tiny");
check("a size welded onto the name", sizeOf("SwordMedium Melee") === "medium" && sizeOf("daggeriny Melee/Missile") === "tiny" && sizeOf("JavelinSmall Melee/Missile") === "small");
check("large", sizeOf("Thing Large Melee") === "large");
check("a missile weapon prints no size", sizeOf("Thing Missile") === null);
check("ammunition prints no size", sizeOf("Case Ammunition") === null);

// --- the qualities land as the system's own properties
const q = settleQualities("Cleave 2, Handy, Slow");
check("a plain word lights its property", q.special.handy === true && q.special.slow === true);
check("a cleave word lights cleave with its limit", q.special.cleave === true && q.cleaveLimit.numeric === 2 && q.cleaveLimit.addStrMod === false);
const str = settleQualities("Cleave 3 + STR mod");
check("the Strength rider is read", str.special.cleave === true && str.cleaveLimit.numeric === 3 && str.cleaveLimit.addStrMod === true);
check("a bare cleave word carries no limit of its own", settleQualities("Cleave").cleaveLimit.numeric === undefined);
check("a dash is no quality", Object.keys(settleQualities("—").special).length === 0 && settleQualities("-").customTags.length === 0);
check("a word with no property is kept as a custom tag", settleQualities("Two Handed").customTags.join() === "Two Handed");

// --- a bound weapon
const dagger = bindWeaponRow(row("Dagger", { melee: true, missile: true, size: "tiny", damage: "1d4", special: "Thrown", short: "15'", med: "30'", long: "45'" }), "x", "y");
check("the size is the system's", dagger.system.size === "tiny");
check("thrown is the system's special property", dagger.system.special.thrown === true);
check("no legacy tags are written", dagger.system.tags === undefined);
check("melee and missile are the system's booleans", dagger.system.melee === true && dagger.system.missile === true);
check("the range lands", dagger.system.range.short === 15 && dagger.system.range.long === 45);

const sword = bindWeaponRow(row("Sword", { melee: true, size: "medium", damage: "1d6/1d8" }), "x", "y");
check("a versatile row writes the base and the alternate die", sword.system.damage.base.formula === "1d6" && sword.system.damage.alternate.formula === "1d8");
check("a row with no quality writes an empty special object", Object.keys(sword.system.special).length === 0 && sword.system.customTags === undefined);

const unsized = bindWeaponRow(row("Sling", { missile: true, damage: "1d4", special: "Handy" }), "x", "y");
check("a row that prints no size leaves the system's default", unsized.system.size === undefined);

const net = bindWeaponRow(row("Net", { melee: true, missile: true, size: "medium", damage: "—", special: "Entangling, Thrown" }), "x", "y");
check("a row that prints no die writes a blank formula, not the system's default die", net.system.damage.base.formula === "" && net.system.damage.alternate.formula === "");
check("and still lights its qualities", net.system.special.entangling === true && net.system.special.thrown === true);
check("and keeps its modes without a die", net.flags["acks-extras"].weapon.modes.every((m) => m.damage === null));

// --- ammunition: a stack whose quantity is the printed count
const ammo = (name, enc) => ({ name, label: name, melee: false, missile: false, ammunition: true, size: null, cells: { damage: "—", enc, cost: "1gp" } });
const quiver = bindAmmoRow(ammo("Quiver, 20 Arrows", "1/6"), "x", "y", { device: true });
check("a loaded device counts its load as quantity", quiver.system.quantity.value === 20);
check("and carries the printed encumbrance whole", quiver.system.weight6 === 1);
check("and no load flag", quiver.flags["acks-extras"].ammo === undefined);
const stones = bindAmmoRow(ammo("30 Sling Stones", "1/6"), "x", "y", { device: false });
check("a bare stack counts its units", stones.system.quantity.value === 30);
check("and divides the printed weight across them", Math.abs(stones.system.quantity.value * stones.system.weight6 - 1) < 1e-9);

console.log(`test-weapon-binding: all ${pass} checks passed`);
