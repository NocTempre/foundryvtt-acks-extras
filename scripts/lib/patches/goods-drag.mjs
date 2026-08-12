/* global game, Hooks */
/**
 * Core patch: the goods rows core leaves un-draggable.
 *
 * `ActorSheetV2` binds its drag sources with `dragSelector: ".draggable"`, and
 * core's inventory marks every row with that class EXCEPT money
 * (`templates/actors/v2/inventory.hbs`). A coin row is therefore never bound as
 * a drag source: no `dragstart` fires, no payload is produced, and every drop
 * target in the family — a container item, a place's storage — waits on a drag
 * that cannot begin. The failure is silent by construction, because no code of
 * ours ever runs; nothing reaches the console to explain it.
 *
 * The system is a read-only reference, so the class is added after render and
 * the sheet's own DragDrop is re-bound. THE RE-BIND IS THE FIX, not a tidy-up:
 * `DragDrop.bind` assigns `ondragstart` element by element, so a class added
 * afterwards stays inert until that pass runs again. Binding twice is safe
 * because those handlers are ASSIGNED rather than added — a second pass replaces
 * them instead of stacking a duplicate.
 *
 * Which rows qualify is read from the DATA, never from a type name: a row is a
 * drag source when its `data-item-id` resolves to GOODS on this actor — the same
 * `isGoods` that storage and containers already gate on. That covers coin today
 * and anything the system forgets tomorrow, while leaving rows that are not
 * goods (the favourites panel, the languages list) exactly as core renders them.
 *
 * SECOND HALF: a coin row dropped back on its own sheet must never MINT coin.
 * Foundry's `ActorSheetV2._onDropItem` treats a drop whose item already belongs
 * to this actor as a re-SORT. The system's override switches on item type before
 * it ever reaches that guard, so money is routed to `_onDropItemMoney`, which
 * finds the row already on the actor and adds one to its quantity. Making the
 * row draggable at all is what puts that path within a player's reach, so the
 * guard belongs here beside the class that opened it — the two halves are one
 * change. Money, and only money: a BUNDLE dropped on its owner unpacks by
 * design, and a blanket same-actor guard would silently take that away.
 */
import { isGoods } from "../item-model.mjs";
import { MODULE_ID } from "../constants.mjs";

/** The system's item type for coin. Matches `isGoods`'s own rider. */
const MONEY_TYPE = "money";

function markGoodsDraggable(app, element) {
  if (game.system?.id !== "acks") return;
  const actor = app?.actor ?? app?.document;
  if (!actor?.items?.size) return;
  const root = element instanceof HTMLElement ? element : element?.[0];
  if (!root) return;

  let marked = false;
  for (const row of root.querySelectorAll("[data-item-id]:not(.draggable)")) {
    const item = actor.items.get(row.dataset.itemId);
    if (!item || !isGoods(item)) continue;
    row.classList.add("draggable");
    marked = true;
  }
  // Re-bind only when a row actually changed: bind() re-walks the whole subtree.
  if (marked) app._dragDrop?.bind?.(root);
}

let dropGuarded = false;

/**
 * Close the self-drop credit on the sheet class the rendered app inherits from.
 *
 * The system's sheet classes are module-private — there is no global path for
 * libWrapper to name — so the prototype is reached through a live instance. It
 * is found by asking WHO OWNS `_onDropItemMoney`, never by walking a fixed
 * number of links: the character and monster sheets both subclass the shared
 * base, and the depth is the system's business, not ours.
 */
function guardMoneySelfDrop(app) {
  if (dropGuarded) return;
  let proto = Object.getPrototypeOf(app);
  while (proto && !Object.hasOwn(proto, "_onDropItemMoney")) proto = Object.getPrototypeOf(proto);
  if (typeof proto?._onDropItem !== "function") return;

  const inner = proto._onDropItem;
  proto._onDropItem = async function (event, item, ...rest) {
    if (item?.type === MONEY_TYPE && item.parent?.uuid === this.actor?.uuid) {
      // Exactly what the Foundry base class does for every other type: the drop
      // reorders the row and writes nothing to quantity.
      await this._onSortItem?.(event, item);
      return item;
    }
    return inner.call(this, event, item, ...rest);
  };
  dropGuarded = true;
}

/** Install the patch. Every actor sheet render is checked; only goods are touched. */
export function installGoodsDrag() {
  Hooks.on("renderActorSheetV2", (app, element) => {
    try {
      if (game.system?.id === "acks") guardMoneySelfDrop(app);
      markGoodsDraggable(app, element);
    } catch (err) {
      console.error(`${MODULE_ID} | goods drag patch failed`, err);
    }
  });
}
