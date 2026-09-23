/* global game, Hooks */
/**
 * Core patch: the goods rows core leaves un-draggable, and the mint bug that
 * opens once they are.
 *
 * `ActorSheetV2` binds its drag sources with `dragSelector: ".draggable"`, and
 * core's inventory template marks every row with that class except money. A
 * coin row is therefore never bound as a drag source, silently: no `dragstart`
 * fires and nothing of ours runs to explain why. The system is a read-only
 * reference, so the class is added after render and the sheet's own DragDrop
 * is re-bound — `DragDrop.bind` assigns `ondragstart` element by element, so a
 * class added afterwards stays inert until that pass runs again; binding twice
 * is safe because those handlers are assigned, not stacked.
 *
 * Which rows qualify is read from the DATA, never a type name: a row is a drag
 * source when its `data-item-id` resolves to goods on this actor, via the same
 * `isGoods` storage and containers already gate on.
 *
 * Making coin draggable at all opens two core paths that must not run once it
 * is: `_onDropItem`'s money branch adds one to the row's quantity on a same-
 * actor drop (a re-sort for every other type), and does the same to the
 * receiver on a cross-actor drop without debiting the giver. Both are guarded
 * here, beside the class that opened them: a same-actor money drop is routed
 * to a plain sort, and a cross-actor one to `handOver`, the family's existing
 * transfer. See docs/lib/DECISIONS.md, "Goods the system leaves un-draggable
 * are marked — and only those", and "Coin made draggable is guarded against
 * minting itself".
 */
import { isGoods } from "../item-model.mjs";
import { MODULE_ID } from "../constants.mjs";
import { handOver } from "../storage.mjs";

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
    if (item?.type === MONEY_TYPE) {
      const source = item.parent;
      if (source?.uuid === this.actor?.uuid) {
        // Exactly what the Foundry base class does for every other type: the
        // drop reorders the row and writes nothing to quantity.
        await this._onSortItem?.(event, item);
        return item;
      }
      // Coin off another ACTOR is a hand-over. Coin with no actor behind it —
      // a compendium purse, a bundle's payout — is an arrival with nobody to
      // debit, and keeps the system's credit.
      if (source?.documentName === "Actor") {
        await handOver(source, this.actor, [{ id: item.id }]);
        return null;
      }
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
