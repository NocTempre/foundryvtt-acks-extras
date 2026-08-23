/* global game */
/**
 * Splitting one item out of a stack to equip it, and putting it back.
 *
 * A stack cannot be worn — forty-two coins are not "in hand", three flasks of
 * oil are not all drawn at once. The EQP cell on a stack therefore SPLITS: one
 * item leaves the bundle as its own document, flagged with the stack it came
 * from, and is worn in the slot the stack declares. Clicking again restacks it:
 * the split document is deleted and the bundle's count rises by one. Nothing is
 * lost either way, and the stack's own quantity is the only count that moves.
 */
import { MODULE_ID } from "../constants.mjs";
import { setWorn, slotsOf, siblingsOf } from "../../lib/item-model.mjs";
import { inferGear } from "../profiles.mjs";

/** The flag naming the stack a split item came from. */
export const SPLIT_FROM = "splitFrom";

/** The stack id a split item came from, or null. */
export const splitFromOf = (item) => item?.getFlag?.(MODULE_ID, SPLIT_FROM) ?? null;

/** The slot a split item is worn in: the declared slot first, else the guess. */
function wearSlotFor(item) {
  return slotsOf(item)[0] ?? inferGear(item).slots[0] ?? null;
}

/** Can this stack split one out? A stack with somewhere to wear it, two or more deep. */
export function canSplit(item) {
  const qty = Number(item?.system?.quantity?.value);
  return Number.isFinite(qty) && qty > 1 && !!wearSlotFor(item) && !!siblingsOf(item);
}

/**
 * Split one item out of the stack and wear it.
 * @returns {Promise<Item|null>} the split item, or null when nothing moved
 */
export async function splitOne(item) {
  if (!canSplit(item)) return null;
  const slot = wearSlotFor(item);
  const data = item.toObject();
  delete data._id;
  data.system.quantity.value = 1;
  data.flags = { ...(data.flags ?? {}), [MODULE_ID]: { ...(data.flags?.[MODULE_ID] ?? {}), [SPLIT_FROM]: item.id } };
  // The declared slot travels with the copy, so `setWorn` has a slot to accept.
  data.flags[MODULE_ID].gear = { ...(data.flags[MODULE_ID].gear ?? {}), slots: [slot] };
  const [created] = item.parent
    ? await item.parent.createEmbeddedDocuments("Item", [data])
    : [await getDocumentClass("Item").create(data)];
  if (!created) return null;
  await item.update({ "system.quantity.value": Number(item.system.quantity.value) - 1 });
  await setWorn(created, slot);
  return created;
}

/**
 * Return a split item to its stack. The stack may have been deleted since —
 * then the split item simply stands on its own and stays.
 * @returns {Promise<boolean>} whether it rejoined a stack
 */
export async function restack(split) {
  const stackId = splitFromOf(split);
  if (!stackId) return false;
  const stack = siblingsOf(split)?.get?.(stackId) ?? null;
  if (!stack) {
    await split.unsetFlag(MODULE_ID, SPLIT_FROM);
    return false;
  }
  await stack.update({ "system.quantity.value": Number(stack.system.quantity?.value ?? 0) + Number(split.system.quantity?.value ?? 1) });
  await split.delete();
  return true;
}

/** Foundry's Item class, resolved late so this module imports offline. */
const getDocumentClass = (name) => globalThis.CONFIG?.[name]?.documentClass ?? globalThis.foundry?.documents?.[name];

void game;
