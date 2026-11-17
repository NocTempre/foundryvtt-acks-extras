/* global Hooks */
/**
 * What a successful identification does to an item's masks: it lifts the
 * disguised NAME after a method that recognizes what the item is, and drops
 * the whole disguise once the identification is `full`. (The `detected` mark
 * is set in the write that records the new state, `lib/item-model.mjs`
 * `markIdentified`.)
 *
 * The hook fires on the client that ran the attempt (`Hooks.callAll`), the
 * one that has just written the item's `identified` state, so that client
 * writes here too and no other does. A method recognizes where its ladder
 * entry says `recognizes` (`identify.mjs` `METHODS`); using, sipping or
 * fighting with an item tells what it does, not what it is called.
 * Which item carries a disguise and a `detected` mark is a treasure deal's
 * doing (docs/markets/DECISIONS.md).
 */
import { MODULE_ID, HOOKS } from "../constants.mjs";
import { METHODS } from "./identify.mjs";
import { revealItem } from "../../equipment/actions.mjs";
import { ITEM_FLAGS } from "../../equipment/constants.mjs";

/**
 * Apply an identification's result to the item's masks. A no-op where the
 * user cannot write the item, and where nothing is masked.
 * @param {{item: Item, method: string, depth: "partial"|"full"}} result the `IDENTIFIED` payload
 */
export async function revealOnIdentify({ item, method, depth } = {}) {
  if (!item || item.isOwner === false) return;

  if (depth === "full") {
    await revealItem(item);
    return;
  }
  const disguise = item.getFlag?.(MODULE_ID, ITEM_FLAGS.DISGUISE);
  if (METHODS[method]?.recognizes && disguise?.true && item.name !== disguise.true.name) {
    await item.update({ name: disguise.true.name });
  }
}

/** Listen for identifications; the one hook handler this feature adds for the masks. */
export function registerIdentifyReveal() {
  Hooks.on(HOOKS.IDENTIFIED, (payload) => {
    revealOnIdentify(payload).catch((err) => console.error(`${MODULE_ID} | lifting an item's mask after identification failed`, err));
  });
}
