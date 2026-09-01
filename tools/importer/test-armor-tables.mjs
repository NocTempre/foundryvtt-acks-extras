/** LOCAL-ONLY: armour extractor vs the real RR PDF. Skips without the ref lib. */
import assert from "node:assert";
import fs from "node:fs";
import { openBook, pageItems } from "../../scripts/importer/extract.mjs";
import { FILES, referenceComplete } from "./reference-lib.mjs";
import { ARMOR_TABLE, ARMOR_NAMES, extractArmor, bindArmorRow } from "../../scripts/importer/armor-tables.mjs";

if (!referenceComplete()) {
  console.log("test-armor-tables: reference PDFs absent — skipped.");
  process.exit(0);
}

const { doc } = await openBook(fs.readFileSync(FILES.rr));
const { items } = await pageItems(doc, ARMOR_TABLE.page);
const rows = extractArmor(items, ARMOR_TABLE);
const byName = Object.fromEntries(rows.map((r) => [r.name.toLowerCase(), r]));

let pass = 0;
const check = (label, cond) => { assert.ok(cond, label); pass++; };

check(`matched every canonical armour row (${rows.length}/${ARMOR_NAMES.length})`, rows.length === ARMOR_NAMES.length);

const plate = byName["plate armor"] && bindArmorRow(byName["plate armor"], "def.armor.plateArmor", "RR p. 130");
check("Plate Armor is heavy", plate?.system.type === "heavy");
check("Plate Armor AC 6", plate?.system.aac.value === 6);
check("Plate Armor has a cost", Number.isFinite(plate?.system.cost));

const chain = byName["chain mail armor"] && bindArmorRow(byName["chain mail armor"], "x", "y");
check("Chain Mail is medium (not core's 'light' bug)", chain?.system.type === "medium");
check("Chain Mail AC 4", chain?.system.aac.value === 4);

const shield = byName["shield"] && bindArmorRow(byName["shield"], "x", "y");
check("Shield type is shield", shield?.system.type === "shield");
check("Shield grants +1 AC", shield?.system.aac.value === 1);

const helm = byName["helmet, heavy"] && bindArmorRow(byName["helmet, heavy"], "x", "y");
check("Heavy Helmet flagged as helmet", helm?.flags["acks-extras"].armor.helmet === true);
check("Heavy Helmet grants no AC (RAW)", helm?.system.aac.value === 0);

const barding = byName["barding, plate"] && bindArmorRow(byName["barding, plate"], "x", "y");
check("Plate Barding flagged as barding", barding?.flags["acks-extras"].armor.barding === true);
check("Plate Barding maps to a heavy type", barding?.system.type === "heavy");
check("Plate Barding models size scaling, not a fake number", barding?.flags["acks-extras"].armor.sizeScales === true && barding?.system.cost === undefined);
check("Plate Barding names its material", barding?.flags["acks-extras"].armor.material === "plate");
check("Plate Barding description states the scaling rule", /vary by the mount/i.test(barding?.system.description ?? ""));
const spiked = byName["barding, spiked"] && bindArmorRow(byName["barding, spiked"], "x", "y");
check("Spiked Barding is a modifier, not a base suit", spiked?.flags["acks-extras"].armor.modifier === true && spiked?.flags["acks-extras"].armor.costMultiplier === 1.5);

// Every bound item is the core armour shape.
for (const r of rows) {
  const it = bindArmorRow(r, "x", "y");
  assert.ok(it.type === "armor" && it.name && typeof it.system.aac.value === "number", `armour shape: ${r.name}`);
}
pass++;

console.log(`\nExtracted armour (${rows.length}):`);
for (const r of rows) {
  const it = bindArmorRow(r, "x", "y");
  console.log(`  ${r.name.padEnd(22)} type=${it.system.type.padEnd(10)} AC=${it.system.aac.value} enc6=${it.system.weight6 ?? "-"} cost=${it.system.cost ?? "-"}`);
}
console.log(`\ntest-armor-tables: all ${pass} checks passed`);
