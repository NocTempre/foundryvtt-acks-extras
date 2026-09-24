/* global game, foundry, ui */
/**
 * What the class and race sheets share at the DOM edge: the confirm a
 * compound row's delete asks, the highlight a drop zone shows under a drag,
 * opening the document a reference names, the notice a refused drop raises,
 * and the armour select's options.
 */
import { LANG_PREFIX } from "./constants.mjs";
import { ARMOR_LADDER } from "../equipment/config.mjs";
import { findByRef } from "./registry.mjs";

/** Set on the drop zone under the cursor while a drag is over it. */
export const DROPPING_CLASS = "acks-extras-classes-dropping";

/** The armour ladder as select options, a blank first, `current` marked. */
export function armourOptionsFor(current) {
  return [{ key: "", label: "—" }, ...ARMOR_LADDER.map((r) => ({ key: r, label: r }))].map((r) => ({
    ...r,
    selected: (current ?? "") === r.key,
  }));
}

/**
 * Whether a delete control may proceed: a control carrying `data-confirm`
 * asks first, naming what goes with the row (`sheet.what.<kind>`); an award
 * has its own wording, because the awards after it move up the ladder.
 * @returns {Promise<boolean>}
 */
export async function confirmRowDelete(target) {
  const kind = target.dataset.confirm;
  if (!kind) return true;
  const message =
    kind === "award"
      ? game.i18n.localize(`${LANG_PREFIX}.sheet.confirm.award`)
      : game.i18n.format(`${LANG_PREFIX}.sheet.confirm.remove`, {
          what: game.i18n.localize(`${LANG_PREFIX}.sheet.what.${kind}`),
        });
  const ok = await foundry.applications.api.DialogV2.confirm({
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
    window: { title: target.getAttribute("aria-label") ?? "" },
    content: `<p>${foundry.utils.escapeHTML(message)}</p>`,
    modal: true,
    rejectClose: false,
  });
  return ok === true;
}

/**
 * Light the innermost `[data-accept-drop]` under a drag and clear it when the
 * drag leaves or drops. Bound once per sheet element — the frame survives a
 * re-render while its parts are replaced, so the listener is delegated and
 * the element remembers that it has one.
 */
export function bindDropHighlight(element) {
  if (!element || element.dataset.dropHighlight) return;
  element.dataset.dropHighlight = "1";
  let lit = null;
  const light = (zone) => {
    if (zone === lit) return;
    lit?.classList.remove(DROPPING_CLASS);
    lit = zone;
    lit?.classList.add(DROPPING_CLASS);
  };
  element.addEventListener("dragover", (event) => light(event.target.closest?.("[data-accept-drop]") ?? null));
  element.addEventListener("dragleave", (event) => {
    if (!element.contains(event.relatedTarget)) light(null);
  });
  element.addEventListener("drop", () => light(null));
  element.addEventListener("dragend", () => light(null));
}

/** Open the sheet of the document `ref` names, or say that nothing answers it. */
export function openRef(ref) {
  const doc = findByRef(ref);
  if (doc?.sheet) doc.sheet.render(true);
  else ui.notifications?.warn(game.i18n.localize(`${LANG_PREFIX}.sheet.unresolvedRef`));
}

/** The notice a drop this list does not take raises; `whatKey` names what it does take (`sheet.what.<key>`). */
export function rejectDrop(dropped, whatKey) {
  ui.notifications?.warn(
    game.i18n.format(`${LANG_PREFIX}.sheet.dropNotAccepted`, {
      name: dropped?.name ?? "",
      what: game.i18n.localize(`${LANG_PREFIX}.sheet.what.${whatKey}`),
    }),
  );
}
