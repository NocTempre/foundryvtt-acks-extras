/**
 * bindEquipment ↔ the EQUIPMENT ROOT.
 *
 * The equipment feature owns that root (`equipmentClass(name)`, imported
 * statically by the importer); this test checks that bindEquipment consumes
 * it — a torch imports as a carried light STACK (a bundle; it becomes a 1d4
 * weapon only when readied), a flask of holy water as a thrown splash weapon,
 * a lantern as a light-bearing item. The root is the real classifier, so no
 * RAW value is baked here; the root supplies them.
 */
import assert from "node:assert";
import { bindEquipment } from "../../scripts/importer/cookbook.mjs";

let pass = 0;
const check = (label, cond) => { assert.ok(cond, label); pass++; };

const MODULE_ID = "acks-extras";
const mk = (name, group) => ({ name, cite: "p.1", meta: group ? { group } : {} });

// --- The root is the real classifier (scripts/equipment/profiles.mjs) --------

const torch = bindEquipment(mk("Torch"), { fields: {} }, "def.equip.torch");
check("torch imports as a carried STACK (item), not a wielded weapon", torch.type === "item");
check("torch keeps a quantity (a bundle you carry)", torch.system.quantity?.value === 1);
check("torch is a light source (flagged)", torch.flags["acks-extras"].light === true);
// The 1d4 lives on the readied weapon-torch (acks-equipment prepareTorch), never
// on the bundle — a stack is not a weapon and carries no damage die.
check("torch stack carries no damage die", torch.system.damage === undefined);

const hw = bindEquipment(mk("Holy Water"), { fields: {} }, "def.equip.holywater");
check("holy water upgrades to a weapon (1d8)", hw.type === "weapon" && hw.system.damage === "1d8");

const lantern = bindEquipment(mk("Lantern"), { fields: {} }, "def.equip.lantern");
check("a lantern stays an item", lantern.type === "item");
check("a lantern is flagged a light source", lantern.flags["acks-extras"].light === true);

// A page-extracted value still wins over the root's fallback (weapon-class gear).
const hwPaged = bindEquipment(mk("Holy Water"), { fields: { damage: "2d4" } }, "def.equip.holywater");
check("an extracted damage overrides the root fallback", hwPaged.system.damage === "2d4");

// A real weapon-group entry is unaffected by the root (already a weapon).
const sword = bindEquipment(mk("Sword", "weapon"), { fields: { damage: "1d6", melee: true } }, "def.equip.sword");
check("a register weapon still binds as a weapon", sword.type === "weapon" && sword.system.damage === "1d6");

// --- The JJ shield FORMS: base items, not differences applied to one ----------
// Each is a shield you buy, so it carries the ordinary AC and encumbrance its
// own passage states; which carry states that AC applies in is the overlay's,
// and the form it reads is named in the extras scope.
const shield = (name, variant) => ({ name, cite: "JJ p.407", meta: { category: "equipment", group: "shield", shieldVariant: variant } });

const kite = bindEquipment(shield("Kite Shield", "kite"), { fields: { values: [{ field: "aac", amount: 1 }, { field: "weight6.stone", amount: 2 }] } }, "def.equip.shieldKite");
check("a shield form binds as armour of type shield", kite.type === "armor" && kite.system.type === "shield");
check("its AC is the number the page stated", kite.system.aac.value === 1);
check("an encumbrance printed in stone converts to sixths", kite.system.weight6 === 12);
check("the form is named where acks-extras reads it", kite.flags["acks-extras"].shieldVariant === "kite");
check("no price is invented for a form the book does not price", kite.system.cost === undefined);

const buckler = bindEquipment(shield("Buckler", "buckler"), { fields: { values: [{ field: "weight6.item", amount: 1 }] } }, "def.equip.shieldBuckler");
check("an encumbrance printed in ITEMS is already sixths", buckler.system.weight6 === 1);
check("a locator that did not match leaves the field absent", buckler.system.aac === undefined);

console.log(`test-equipment-binding: all ${pass} checks passed`);
