/* global Hooks, foundry */
/**
 * One clothing declaration, whichever path writes it: the rail, core's sheet,
 * the importer, a macro or the API. A create or update that moves the
 * `baseType` flag or core's `system.subtype` gets the other half in the same
 * write (`clothingDeclarationPatch`), so every path ends in the same weight.
 * A write that moves neither is left alone, so an item that already disagrees
 * keeps its data until a Judge settles it.
 */
import { MODULE_ID } from "./constants.mjs";
import { BASE_TYPE_FLAG, clothingDeclarationPatch } from "./base-types.mjs";
import { isUnset, unset } from "../lib/util.mjs";

const FLAG_PATH = `flags.${MODULE_ID}.${BASE_TYPE_FLAG}`;

/** `{baseType?, subtype?}` as one update sets them; a flag it unsets reads as null. */
function writeOf(changes) {
  const { getProperty, hasProperty } = foundry.utils;
  const out = {};
  if (hasProperty(changes, FLAG_PATH)) {
    const value = getProperty(changes, FLAG_PATH);
    out.baseType = isUnset(value) ? null : (value ?? null);
  } else if (hasProperty(changes, `flags.${MODULE_ID}.-=${BASE_TYPE_FLAG}`)) {
    out.baseType = null;
  }
  if (hasProperty(changes, "system.subtype")) out.subtype = getProperty(changes, "system.subtype");
  return out;
}

/** Register the create and update halves (called once, at init). */
export function registerClothingDeclaration() {
  // A create has nothing stored, so it is measured against no flag and core's
  // initial subtype. The pending document is what core persists, so the patch
  // goes on its source.
  Hooks.on("preCreateItem", (item) => {
    try {
      const source = item._source;
      const write = {};
      const flag = source.flags?.[MODULE_ID]?.[BASE_TYPE_FLAG];
      if (flag !== undefined) write.baseType = flag;
      if (source.system?.subtype !== undefined) write.subtype = source.system.subtype;
      const patch = clothingDeclarationPatch({ type: item.type, baseType: null, subtype: "item" }, write);
      if (!patch) return;
      item.updateSource("subtype" in patch ? { system: { subtype: patch.subtype } } : { [FLAG_PATH]: patch.baseType ?? unset() });
    } catch (err) {
      console.error(`${MODULE_ID} | clothing declaration on create failed`, err);
    }
  });

  // An update's changes are re-cleaned after the hook, so the patch joins them.
  Hooks.on("preUpdateItem", (item, changes) => {
    try {
      const source = item._source;
      const patch = clothingDeclarationPatch(
        { type: item.type, baseType: source.flags?.[MODULE_ID]?.[BASE_TYPE_FLAG], subtype: source.system?.subtype },
        writeOf(changes),
      );
      if (!patch) return;
      if ("subtype" in patch) foundry.utils.setProperty(changes, "system.subtype", patch.subtype);
      else foundry.utils.setProperty(changes, FLAG_PATH, patch.baseType ?? unset());
    } catch (err) {
      console.error(`${MODULE_ID} | clothing declaration on update failed`, err);
    }
  });
}
