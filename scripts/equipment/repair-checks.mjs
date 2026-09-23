/* global game, fromUuid, CONFIG */
/**
 * Equipment's repair check: a garment declared on one half and not the other.
 * The rail's base type and core's clothing subtype say the same thing, and the
 * declaration hook keeps them together on every write since; this finds the
 * items written before it. Where the two disagree the base type wins, as the
 * hook rules a write that moves both.
 */
import { MODULE_ID } from "./constants.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";
import { fixEach, registerRepairCheck, worldActors } from "../lib/repair.mjs";
import { BASE_TYPE, BASE_TYPE_FLAG, CLOTHING_SUBTYPE, baseTypeAllowed, baseTypeIsDeclared } from "./base-types.mjs";

const loc = (key, data = {}) => game.i18n.format(`ACKS-EQUIPMENT.repair.check.${key}`, data);
const typeName = (baseType) => game.i18n.localize(`ACKS-EQUIPMENT.baseType.${baseType}`);
const documentTypeName = (type) => game.i18n.localize(CONFIG.Item.typeLabels?.[type] ?? type);

/** What one item's two halves say, as a finding, or null when they agree. */
function disagreement(item, label) {
  const declared = baseTypeIsDeclared(item) ? item.getFlag(MODULE_ID, BASE_TYPE_FLAG) : null;
  const subtype = item.system?.subtype ?? null;
  const base = { key: item.uuid, uuid: item.uuid, name: label };
  if (item.type !== ITEM_TYPE.item) {
    return declared === BASE_TYPE.clothing ? { ...base, write: "flag", detail: loc("wrongDocument", { type: documentTypeName(item.type) }) } : null;
  }
  if (declared === BASE_TYPE.clothing && subtype !== CLOTHING_SUBTYPE) {
    return { ...base, write: "subtype", value: CLOTHING_SUBTYPE, detail: loc("flagOnly") };
  }
  if (declared && declared !== BASE_TYPE.clothing && baseTypeAllowed(declared, item.type) && subtype === CLOTHING_SUBTYPE) {
    return { ...base, write: "subtype", value: "item", detail: loc("subtypeOnly", { type: typeName(declared) }) };
  }
  return null;
}

/** Registers the check. Called once, at `init`. */
export function registerEquipmentRepairChecks() {
  registerRepairCheck({
    id: "equipment.railClothing",
    label: "ACKS-EQUIPMENT.repair.check.label",
    hint: "ACKS-EQUIPMENT.repair.check.hint",
    order: 10,
    scan: () => {
      const out = [];
      for (const item of game.items) out.push(disagreement(item, item.name));
      for (const actor of worldActors()) {
        for (const item of actor.items) out.push(disagreement(item, `${actor.name} → ${item.name}`));
      }
      return out.filter(Boolean);
    },
    fix: (findings) =>
      fixEach(findings, async (f) => {
        const item = await fromUuid(f.uuid);
        if (!item) return;
        if (f.write === "flag") await item.unsetFlag(MODULE_ID, BASE_TYPE_FLAG);
        else await item.update({ "system.subtype": f.value });
      }),
  });
}
