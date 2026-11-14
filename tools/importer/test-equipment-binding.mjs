/**
 * bindEquipment ↔ the EQUIPMENT ROOT.
 *
 * The equipment feature owns that root (`equipmentClass(name)`, imported
 * statically by the importer); this test checks that bindEquipment consumes
 * it — a torch imports as a carried light STACK (a bundle; it becomes a
 * weapon only when readied), a flask of holy water as a thrown splash weapon,
 * a lantern as a light-bearing item. The root is the real classifier, so no
 * RAW value is baked here; the root supplies them.
 */
import assert from "node:assert";
import { bindEquipment, pricedDoc, withCapacity } from "../../scripts/importer/cookbook.mjs";
import { useWeaponFixture, FIXTURE_ROWS } from "../weapon-fixture.mjs";

// The equipment root reads the weapon rows through the seam; these are invented.
useWeaponFixture();

let pass = 0;
const check = (label, cond) => { assert.ok(cond, label); pass++; };

const MODULE_ID = "acks-extras";
const mk = (name, group) => ({ name, cite: "p.1", meta: group ? { group } : {} });

// --- The root is the real classifier (scripts/equipment/profiles.mjs) --------

const torch = bindEquipment(mk("Torch"), { fields: {} }, "def.equip.torch");
check("torch imports as a carried STACK (item), not a wielded weapon", torch.type === "item");
check("torch keeps a quantity (a bundle you carry)", torch.system.quantity?.value === 1);
check("torch is a light source (flagged)", torch.flags["acks-extras"].light === true);
// The 1d4 lives on the readied weapon-torch (the equipment feature's prepareTorch), never
// on the bundle — a stack is not a weapon and carries no damage die.
check("torch stack carries no damage die", torch.system.damage === undefined);

const hw = bindEquipment(mk("Holy Water"), { fields: {} }, "def.equip.holywater");
check("holy water upgrades to a weapon of the row's die", hw.type === "weapon" && hw.system.damage.base.formula === FIXTURE_ROWS.holywater.damage);

const lantern = bindEquipment(mk("Lantern"), { fields: {} }, "def.equip.lantern");
check("a lantern stays an item", lantern.type === "item");
check("a lantern is flagged a light source", lantern.flags["acks-extras"].light === true);

// A page-extracted value still wins over the root's fallback (weapon-class gear).
const hwPaged = bindEquipment(mk("Holy Water"), { fields: { damage: "2d4" } }, "def.equip.holywater");
check("an extracted damage overrides the root fallback", hwPaged.system.damage.base.formula === "2d4");

// A real weapon-group entry is unaffected by the root (already a weapon).
const sword = bindEquipment(mk("Sword", "weapon"), { fields: { damage: "1d6", melee: true } }, "def.equip.sword");
check("a register weapon still binds as a weapon", sword.type === "weapon" && sword.system.damage.base.formula === "1d6");

// --- The JJ shield FORMS: base items, not differences applied to one ----------
// Each is a shield you buy, so it carries the ordinary AC and encumbrance its
// own passage states; which carry states that AC applies in is the overlay's,
// and the form it reads is named in the extras scope.
const shield = (name, variant) => ({ name, cite: "JJ p.407", meta: { category: "equipment", group: "shield", shieldVariant: variant } });

const kite = bindEquipment(shield("Kite Shield", "kite"), { fields: { values: [{ field: "aac", amount: 1 }, { field: "weight6.stone", amount: 2 }] } }, "def.equip.shieldKite");
check("a shield form binds as armour of type shield", kite.type === "armor" && kite.system.type === "shield");
check("its AC is the number the page stated", kite.system.ac.value === 1);
check("an encumbrance printed in stone converts to sixths", kite.system.weight6 === 12);
check("the form is named where acks-extras reads it", kite.flags["acks-extras"].shieldVariant === "kite");
check("no price is invented for a form the book does not price", kite.system.cost === undefined);

const buckler = bindEquipment(shield("Buckler", "buckler"), { fields: { values: [{ field: "weight6.item", amount: 1 }] } }, "def.equip.shieldBuckler");
check("an encumbrance printed in ITEMS is already sixths", buckler.system.weight6 === 1);
check("a locator that did not match leaves the field absent", buckler.system.ac === undefined);

// --- A container's capacity: the grid row's label states it, the import writes it --
// A price row no entry claims becomes an item; the capacity its label states
// (INVENTED figures here) rides the item's gear flag, and the import's stamp
// records the figure the page gave so a surface can tell it from a typed one.
const crate = pricedDoc({ name: "Crate (holds 9 stone)", cost: 1, weight6: 6, section: "", capacity: 9 }, "def.priced.crate", "RR p. 1");
check("a priced row that states a capacity writes it to the gear flag", crate.flags[MODULE_ID].gear.capacity === 9);
check("and records the figure the page gave in the import's stamp", crate.flags[MODULE_ID].cookbook.read.capacity === 9);
const rope = pricedDoc({ name: "Rope", cost: 1, weight6: 6, section: "", capacity: null }, "def.priced.rope", "RR p. 1");
check("a row that states none writes no gear flag and no read stamp", rope.flags[MODULE_ID].gear === undefined && rope.flags[MODULE_ID].cookbook.read === undefined);
const nothing = pricedDoc({ name: "Crate (holds 0 stone)", cost: 1, weight6: 6, section: "", capacity: 0 }, "def.priced.crate0", "RR p. 1");
check("a row that states a capacity of nothing writes it: nothing is a figure, not an absence", nothing.flags[MODULE_ID].gear.capacity === 0 && nothing.flags[MODULE_ID].cookbook.read.capacity === 0);
// A rebuild writes the page's capacity back onto an item the importer made, under the id it holds.
const { REPAIR } = await import("../../scripts/importer/refresh.mjs");
check("a rebuild repairs the gear flag of an imported equipment entry and of a price row's item", REPAIR.equipment.flags.includes("gear") && REPAIR.priced.flags.includes("gear"));
const sized = { flags: { [MODULE_ID]: { cookbook: { id: "x" }, gear: { slots: ["back"] } } } };
withCapacity(sized, 4);
const sizedFlags = sized.flags[MODULE_ID];
check("a capacity joins the gear flag's other keys and the stamp's identity",
  sizedFlags.gear.capacity === 4 && sizedFlags.gear.slots[0] === "back" && sizedFlags.cookbook.id === "x" && sizedFlags.cookbook.read.capacity === 4);
// The plan a rebuild writes: the page's figure over a stored one, the stored declaration's other keys untouched.
const { refreshPlan } = await import("../../scripts/importer/refresh.mjs");
const stored = { type: "item", name: "Crate", system: {}, flags: { [MODULE_ID]: { cookbook: { id: "x", read: { capacity: 9 } }, gear: { slots: ["back"], holds: true, capacity: 99 } } } };
const rebuilt = { type: "item", name: "Crate", system: {}, flags: { [MODULE_ID]: { cookbook: { id: "x", read: { capacity: 4 } }, gear: { holds: true, capacity: 4 } } } };
const written = refreshPlan(stored, rebuilt, REPAIR.priced).update.flags?.[MODULE_ID];
check("a rebuild writes the page's capacity over a stored one and leaves the declaration's other keys out of the write", written?.gear?.capacity === 4 && written.cookbook.read.capacity === 4 && !("slots" in written.gear));
const nothingStated = { type: "item", name: "Crate", system: {}, flags: { [MODULE_ID]: { cookbook: { id: "x" } } } };
check("a build that states none writes none over what a hand typed", Object.keys(refreshPlan(stored, nothingStated, REPAIR.priced).update).length === 0);

console.log(`test-equipment-binding: all ${pass} checks passed`);
