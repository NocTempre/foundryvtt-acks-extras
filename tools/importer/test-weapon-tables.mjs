/**
 * LOCAL-ONLY test: run the weapon-table extractor against the real RR PDF and
 * assert it materializes real weapons. Skips cleanly without the reference lib
 * (so CI, which has no PDFs, does not fail on it). Never committed.
 */
import assert from "node:assert";
import fs from "node:fs";
import { openBook, pageItems } from "../../scripts/importer/extract.mjs";
import { FILES, referenceComplete } from "./reference-lib.mjs";
import { WEAPON_TABLE, WEAPON_NAMES, extractWeapons, bindWeaponRow, bindAmmoRow, ammoLoad } from "../../scripts/importer/weapon-tables.mjs";

if (!referenceComplete()) {
  console.log("test-weapon-tables: reference PDFs absent — skipped.");
  process.exit(0);
}

const { doc } = await openBook(fs.readFileSync(FILES.rr));
const { items } = await pageItems(doc, WEAPON_TABLE.page);
const rows = extractWeapons(items, WEAPON_TABLE);

const byName = Object.fromEntries(rows.map((r) => [r.name.toLowerCase(), r]));

let pass = 0;
const check = (label, cond) => { assert.ok(cond, label); pass++; };

// Every canonical weapon must attach to a row on the real page.
check(`matched every canonical weapon (${rows.length}/${WEAPON_NAMES.length})`, rows.length === WEAPON_NAMES.length);

// Clean names — no small-caps drops, no type-text bleed.
check("names are the clean canonical forms", !!byName["two-handed sword"] && !!byName["net"] && !!byName["sword"]);

// Sword: melee, 1d6, has a cost — and damage is NOT the type text.
const swItem = byName["sword"] && bindWeaponRow(byName["sword"], "def.weapon.sword", "RR PDF p. 128");
check("Sword is melee", swItem?.system.melee === true);
check("Sword has a gp cost", Number.isFinite(swItem?.system.cost));

// Composite Bow: missile with range.
const bowItem = byName["composite bow"] && bindWeaponRow(byName["composite bow"], "x", "y");
check("Composite Bow is missile", bowItem?.system.missile === true);
check("Composite Bow has a range", (bowItem?.system.range?.short ?? 0) > 0);

// Side-tab bleed must not corrupt the axe rows.
const axeItem = byName["battle axe"] && bindWeaponRow(byName["battle axe"], "x", "y");
check("Battle Axe melee with a die", axeItem?.system.melee === true && /\dd\d/.test(axeItem.system.damage ?? ""));

// Every bound item is the core weapon shape, and every value row got a die.
const weaponRows = rows.filter((r) => !r.ammunition);
let withDie = 0;
for (const r of weaponRows) {
  const it = bindWeaponRow(r, "def.weapon.x", "cite");
  assert.ok(it.type === "weapon" && it.name, `bound weapon shape: ${r.name}`);
  assert.ok(Array.isArray(it.system.tags), `tags array: ${r.name}`);
  if (/\dd\d/.test(it.system.damage ?? "")) withDie++;
}
pass++;
check(`most weapons carry a damage die (${withDie}/${weaponRows.length})`, withDie >= weaponRows.length - 8);

/* --- the grid's third type ------------------------------------------- */

// The page files four rows as Ammunition, and none of them is a weapon.
const ammoRows = rows.filter((r) => r.ammunition);
check(`the page's Ammunition rows are read as such (${ammoRows.length})`, ammoRows.length === 4);
check("a case of bolts is ammunition, not a missile weapon",
  ammoRows.some((r) => /bolts/i.test(r.name)) && !ammoRows.some((r) => r.melee || r.missile));

// The load is read off the seat's own label — count and thing counted.
const boltRow = ammoRows.find((r) => /bolts/i.test(r.name));
check("the printed load is read off the label", ammoLoad(boltRow)?.count === 20);
check("and so is what it is a load of", /bolts/i.test(ammoLoad(boltRow)?.of ?? ""));

// A loaded device: inventory, one of it, the load on the flag, printed weight whole.
const caseItem = bindAmmoRow(boltRow, "def.weapon.case20Bolts", "cite", { device: true });
check("a loaded device is inventory, not a weapon", caseItem.type === "item");
check("it carries no damage die", caseItem.system.damage === undefined);
check("there is one of it", caseItem.system.quantity.value === 1);
check("its load rides on the flag", caseItem.flags["acks-extras"].ammo?.load === 20);
check("and it carries the printed encumbrance whole",
  caseItem.system.weight6 === bindWeaponRow(boltRow, "x", "y").system.weight6);

// A bare stack: quantity is the count, and quantity × weight6 is what the page printed.
const stoneRow = ammoRows.find((r) => /stone/i.test(r.name));
if (stoneRow) {
  const stack = bindAmmoRow(stoneRow, "def.weapon.slingStones", "cite", { device: false });
  const load = ammoLoad(stoneRow);
  check("a bare stack counts its units", stack.system.quantity.value === load.count);
  check("and quantity × weight6 is the printed encumbrance",
    Math.abs(stack.system.quantity.value * (stack.system.weight6 ?? 0) - bindWeaponRow(stoneRow, "x", "y").system.weight6) < 1e-9);
  check("a bare stack carries no load flag", stack.flags["acks-extras"].ammo === undefined);
}

// Multiple roll types — the capture the compendium lacked.
const modesOf = (n) => bindWeaponRow(byName[n], "x", "y").flags["acks-extras"].weapon.modes;
// Battle Axe: versatile melee → one-handed AND two-handed damage modes.
const axeModes = modesOf("battle axe");
check("versatile weapon captures both grip modes",
  axeModes.some((m) => m.grip === "one-handed") && axeModes.some((m) => m.grip === "two-handed"));
check("the two grips carry different dice",
  new Set(axeModes.filter((m) => m.attack === "melee").map((m) => m.damage)).size === 2);
// Hand Axe: melee AND missile (thrown) → an attack mode of each.
const handModes = modesOf("hand axe");
check("thrown weapon captures melee + missile modes",
  handModes.some((m) => m.attack === "melee") && handModes.some((m) => m.attack === "missile"));
// A plain weapon has exactly one mode.
check("a single-die melee weapon has one mode", modesOf("club").length === 1);
// A missile mode never carries the two-handed melee die.
check("missile modes are never two-handed", handModes.every((m) => !(m.attack === "missile" && m.grip === "two-handed")));

console.log(`\nExtracted weapons (${weaponRows.length}):`);
for (const r of weaponRows) {
  const it = bindWeaponRow(r, "x", "y");
  console.log(`  ${r.name.padEnd(22)} dmg=${it.system.damage ?? "-"} enc6=${it.system.weight6 ?? "-"} cost=${it.system.cost ?? "-"} ${it.system.missile ? "[missile]" : it.system.melee ? "[melee]" : ""} ${it.system.tags.map((t) => t.title).join("/")}`);
}
console.log(`\nExtracted ammunition (${ammoRows.length}):`);
for (const r of ammoRows) {
  const load = ammoLoad(r);
  const it = bindAmmoRow(r, "x", "y", { device: /case|quiver/i.test(r.name) });
  console.log(`  ${r.name.padEnd(22)} qty=${it.system.quantity.value} enc6=${it.system.weight6 ?? "-"} cost=${it.system.cost ?? "-"} load=${load ? `${load.count} ${load.of}` : "-"}`);
}
console.log(`\ntest-weapon-tables: all ${pass} checks passed`);
