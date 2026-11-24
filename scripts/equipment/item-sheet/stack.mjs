/* global foundry */
/**
 * Splitting one item out of a stack to equip it, and putting it back.
 *
 * A stack cannot be worn — forty-two coins are not "in hand", three flasks of
 * oil are not all drawn at once. Two shapes of stack, two ways to take one:
 *
 * - A stack of what core cannot equip (a flask, a torch, a garment) SPLITS on
 *   the EQP cell: one item leaves the bundle as its own document, flagged with
 *   the stack it came from, and is worn in the slot the stack declares.
 *   Clicking again restacks it: the split document is deleted and the bundle's
 *   count rises by one.
 * - A stack of what core equips (a weapon, a suit of armour) is divided at the
 *   equip write itself (`divertsEquip`, `takeOneToEquip`): the row that was
 *   clicked keeps its id and ends up equipped holding one, the rest stay a
 *   resting row beside it, and unequipping folds them back (`foldIntoRest`).
 *
 * Nothing is lost either way: the other row is made before the stack is
 * reduced, and the stack's own quantity is the only count that moves.
 */
import { MODULE_ID } from "../constants.mjs";
import { setWorn, siblingsOf, stackCountOf, isEquippable, canDivide, divideStack, oneAtATime } from "../../lib/item-model.mjs";
import { quantityOf, isStackable } from "../../lib/storage-logic.mjs";
import { setPath } from "../../lib/dotted-path.mjs";
import { wearableSlots } from "../profiles.mjs";
import { unstowOnUse } from "../containers.mjs";

/** The flag naming the stack a split item came from. */
export const SPLIT_FROM = "splitFrom";

/** The stack id a split item came from, or null. */
export const splitFromOf = (item) => item?.getFlag?.(MODULE_ID, SPLIT_FROM) ?? null;

/** The slot a split item is worn in: the declared slot, else the guess. */
function wearSlotFor(item) {
  return wearableSlots(item)[0] ?? null;
}

/**
 * Can this stack split one out to be worn? A row `isStackable` accepts that
 * core cannot equip itself, with somewhere to wear it, two or more deep. What
 * core equips is divided at the equip write instead (`divertsEquip`).
 */
export function canSplit(item) {
  const qty = stackCountOf(item);
  return isStackable(item) && !isEquippable(item) && Number.isFinite(qty) && qty > 1 && !!wearSlotFor(item) && !!siblingsOf(item);
}

/**
 * Is this pending write an equip that must take one off its stack first? A row
 * held by an actor, core-equippable and resting, going to equipped, that
 * `canDivide` accepts (two or more, nothing stored inside it), where the write
 * does not touch the count itself: `takeOneToEquip`'s own write carries
 * quantity 1, so it is never diverted again.
 * @param {Item} item the row about to be updated
 * @param {object} changes the pending update, expanded
 */
export function divertsEquip(item, changes) {
  if (item?.parent?.documentName !== "Actor" || !isEquippable(item) || item.system.equipped) return false;
  if (foundry.utils.getProperty(changes, "system.equipped") !== true) return false;
  const q = quantityOf(item);
  if (!q || foundry.utils.hasProperty(changes, q.path)) return false;
  return canDivide(item);
}

/**
 * Take one off a stack to equip it: the rest are made first as a resting row
 * beside it (the same container), then one write on the row the user handled
 * sets its count to one and applies the whole pending change, the unstow of
 * `unstowOnUse` included. A write that is refused or fails deletes the rest
 * again (`divideStack`), so the worst outcome is a duplicate, never a loss.
 * Takes its turn among the holder's other divides and folds (`oneAtATime`), and
 * reads the row again when the turn comes: a second equip of the same stack
 * (a double click) finds the row already drawn and takes nothing.
 * @param {Item} item the stack the user equipped
 * @param {object} changes the pending update that `divertsEquip` cancelled
 * @returns {Promise<Item|null>} the resting row, or null when nothing divided
 */
export function takeOneToEquip(item, changes) {
  if (!item?.parent) return Promise.resolve(null);
  return oneAtATime(item.parent, async () => {
    if (item.system.equipped || !canDivide(item)) return null;
    const pending = foundry.utils.deepClone(changes);
    delete pending._id;
    unstowOnUse(item, pending);
    return divideStack(item, (stackCountOf(item) ?? 0) - 1, { also: pending });
  });
}

/**
 * Split one item out of the stack and wear it.
 * @returns {Promise<Item|null>} the split item, or null when nothing moved
 */
export async function splitOne(item) {
  if (!canSplit(item)) return null;
  const slot = wearSlotFor(item);
  const q = quantityOf(item);
  const data = item.toObject();
  delete data._id;
  setPath(data, q.path, 1);
  data.flags = { ...(data.flags ?? {}), [MODULE_ID]: { ...(data.flags?.[MODULE_ID] ?? {}), [SPLIT_FROM]: item.id } };
  // The declared slot travels with the copy, so `setWorn` has a slot to accept.
  data.flags[MODULE_ID].gear = { ...(data.flags[MODULE_ID].gear ?? {}), slots: [slot] };
  const [created] = item.parent
    ? await item.parent.createEmbeddedDocuments("Item", [data])
    : [await getDocumentClass("Item").create(data)];
  if (!created) return null;
  await item.update({ [q.path]: q.value - 1 });
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
  const into = stack && isStackable(stack) ? quantityOf(stack) : null;
  if (!into) {
    await split.unsetFlag(MODULE_ID, SPLIT_FROM);
    return false;
  }
  await stack.update({ [into.path]: (stackCountOf(stack) ?? 0) + (stackCountOf(split) ?? 1) });
  await split.delete();
  return true;
}

/** Foundry's Item class, resolved late so this module imports offline. */
const getDocumentClass = (name) => globalThis.CONFIG?.[name]?.documentClass ?? globalThis.foundry?.documents?.[name];
