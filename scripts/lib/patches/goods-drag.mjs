/* global game, Hooks, foundry, ui */
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
 * transfer. Coin with no actor behind it takes the same road every other
 * arrival does (`deliverDrop`), because core's own credit finds the row by
 * document id and so makes a second row of any coin that has ever travelled.
 *
 * Foundry's own `ActorSheetV2._onDropItem` has the same fault by a shorter
 * road — an item off another actor is created again on this one and the
 * giver's is left alone — and every actor sheet that states no drop handler
 * of its own inherits it. That method is guarded too, so coin is copied by no
 * sheet (`landCoin` is the one statement of where a dropped coin goes). A
 * sheet whose actor is not a creature — a faction's is the one that reaches
 * that method — takes no coin at all: handed over it would leave the giver
 * for an actor no sheet lists goods on.
 * See docs/lib/DECISIONS.md, "Goods the system leaves un-draggable are marked
 * — and only those", "Coin made draggable is guarded against minting
 * itself", and "Currency is one stack with one count, weighed by how many
 * make a stone".
 */
import { isCurrency, isGoods } from "../item-model.mjs";
import { ANIMAL_TYPE, LANG_PREFIX, MODULE_ID } from "../constants.mjs";
import { ACTOR_TYPE } from "../vocab.mjs";
import { landCoin } from "../bundles.mjs";
import { elementOf } from "../util.mjs";

/**
 * The actor types whose sheets list what the actor carries: the system's two
 * creature types and the animal on the monster's chassis.
 */
const CARRIER_TYPES = new Set([ACTOR_TYPE.character, ACTOR_TYPE.monster, ANIMAL_TYPE]);

function markGoodsDraggable(app, element) {
  if (game.system?.id !== "acks") return;
  const actor = app?.actor ?? app?.document;
  if (!actor?.items?.size) return;
  const root = elementOf(element);
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
    if (isCurrency(item)) {
      const source = item.parent;
      if (source?.uuid === this.actor?.uuid) {
        // Exactly what the Foundry base class does for every other type: the
        // drop reorders the row and writes nothing to quantity.
        await this._onSortItem?.(event, item);
        return item;
      }
      await landCoin(this.actor, item);
      return null;
    }
    return inner.call(this, event, item, ...rest);
  };
  dropGuarded = true;
}

/**
 * Close the copy on every sheet that takes Foundry's own drop: the follower
 * card, the faction sheet, and any sheet another module registers. Coin from
 * elsewhere goes where `landCoin` sends it when the sheet's actor is one of
 * `CARRIER_TYPES`, and is refused with a warning — neither moved nor copied —
 * when it is not. A drop within one actor is the base class's own re-sort,
 * which writes no count. Wrapped through libWrapper where it is loaded, so
 * another module's wrapper on the same method composes with this one.
 */
function guardBaseCoinDrop() {
  const base = foundry.applications?.sheets?.ActorSheetV2?.prototype;
  if (typeof base?._onDropItem !== "function") return;
  const guard = async function (wrapped, event, item, ...rest) {
    if (isCurrency(item) && item.parent?.uuid !== this.actor?.uuid) {
      if (CARRIER_TYPES.has(this.actor?.type)) await landCoin(this.actor, item);
      else ui.notifications?.warn(game.i18n.format(`${LANG_PREFIX}.storage.keepsNoGoods`, { name: this.actor?.name ?? "" }));
      return null;
    }
    return wrapped(event, item, ...rest);
  };
  if (globalThis.libWrapper?.register) {
    globalThis.libWrapper.register(MODULE_ID, "foundry.applications.sheets.ActorSheetV2.prototype._onDropItem", guard, "MIXED");
    return;
  }
  const inner = base._onDropItem;
  base._onDropItem = function (...args) {
    return guard.call(this, inner.bind(this), ...args);
  };
}

/** Install the patch. Every actor sheet render is checked; only goods are touched. */
export function installGoodsDrag() {
  try {
    guardBaseCoinDrop();
  } catch (err) {
    console.error(`${MODULE_ID} | coin drop guard failed`, err);
  }
  Hooks.on("renderActorSheetV2", (app, element) => {
    try {
      if (game.system?.id === "acks") guardMoneySelfDrop(app);
      markGoodsDraggable(app, element);
    } catch (err) {
      console.error(`${MODULE_ID} | goods drag patch failed`, err);
    }
  });
}
