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
 */
import { isGoods } from "../item-model.mjs";
import { MODULE_ID } from "../constants.mjs";

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

/** Install the patch. Every actor sheet render is checked; only goods are touched. */
export function installGoodsDrag() {
  Hooks.on("renderActorSheetV2", (app, element) => {
    try {
      markGoodsDraggable(app, element);
    } catch (err) {
      console.error(`${MODULE_ID} | goods drag patch failed`, err);
    }
  });
}
