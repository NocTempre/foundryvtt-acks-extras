/* global game, foundry, Hooks, Actor, fromUuidSync */
/**
 * Reaching the class picker from a character sheet: a control injected beside
 * the system's free-text class input, and a drop target for a class document
 * dragged onto the sheet. The picker itself is a window of its own
 * (assign-app.mjs); this file is only the two ways in.
 *
 * Injection rides `renderApplicationV2` (the base class is always in the
 * render chain, whatever the concrete sheet is called) and is idempotent —
 * the control is only added when absent, so the chain firing once per
 * inheritance level is harmless.
 */
import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import { openClassPicker, openClassPickerFor } from "./assign-app.mjs";
import { ACTOR_TYPE } from "../lib/vocab.mjs";

export { offeredClasses, openClassPicker } from "./assign-app.mjs";

/** Our marker on a character sheet, so this module's rules have something of
 *  its own to hang off a surface whose classes belong to the system. */
const SHEET_CLASS = "acks-extras-classes-charsheet";

function onRenderCharacterSheet(app, element) {
  const root = element instanceof HTMLElement ? element : element?.[0];
  if (!root) return;
  const doc = app.document;
  if (!(doc instanceof Actor) || doc.type !== ACTOR_TYPE.character || !doc.isOwner) return;
  root.classList.add(SHEET_CLASS);

  // A class document DRAGGED onto the sheet opens the picker on it instead of
  // embedding as an owned item. Capture phase, so the core sheet's own drop
  // handler never sees the class item.
  if (!root.dataset.acksClassesDrop) {
    root.dataset.acksClassesDrop = "1";
    root.addEventListener(
      "drop",
      (event) => {
        let data;
        try {
          data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
        } catch {
          return;
        }
        if (data?.type !== "Item" || !data.uuid) return;
        const dropped = fromUuidSync(data.uuid);
        if (dropped?.type !== `${MODULE_ID}.class`) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        // The same window the picker opens, on the class that was dropped —
        // a drop is a choice of class, not a choice to skip every question
        // binding one asks.
        openClassPickerFor(doc, dropped);
      },
      { capture: true },
    );
  }

  const input = root.querySelector('input[name="system.details.class"]');
  if (!input || input.parentElement?.querySelector(".acks-extras-classes-pick")) return;
  const btn = document.createElement("a");
  btn.className = "acks-extras-classes-pick";
  btn.dataset.tooltip = game.i18n.localize(`${LANG_PREFIX}.pick.tooltip`);
  btn.innerHTML = '<i class="fa-solid fa-graduation-cap"></i>';
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    openClassPicker(doc);
  });
  input.insertAdjacentElement("afterend", btn);
}

/** Register the sheet-injection hook (called once from classes/module.mjs). */
export function registerAssignUi() {
  Hooks.on("renderApplicationV2", onRenderCharacterSheet);
}
