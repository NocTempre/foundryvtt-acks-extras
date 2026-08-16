/* global game, foundry, ui */
/**
 * The carrier surface: spending an ability's open language slots by hand.
 *
 * The slot MODEL lives in classes/languages.mjs (it is a class-grant concept);
 * this is only the sheet's half — the picker, the drop, and the clear. Kept
 * beside the sheet that owns them so the model stays free of UI.
 *
 * A pick does not record a name here: it asks the model for the language
 * DOCUMENT on the actor, which is what the system's own sheet section and the
 * Polyglot provider both read.
 */
import { slotsOf, fillSlot, clearSlot, freeSlots, worldLanguages, LANGUAGE_TYPE } from "../classes/languages.mjs";

export { slotsOf };

/**
 * Pick a tongue for the next free slot. Offers the world's languages when it
 * has any, and always allows a typed name: the setting decides which languages
 * exist, and a world that has imported none must still be playable — the model
 * finds or builds the document either way.
 */
async function pickLanguage() {
  if (!freeSlots(this.item)) return;
  const options = worldLanguages()
    .map((i) => `<option value="${i.uuid}">${foundry.utils.escapeHTML(i.name)}</option>`)
    .join("");
  const form = await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.localize("ACKS-ABILITIES.languages.pickTitle") },
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
    content: `${options ? `<div class="form-group"><label>${game.i18n.localize("ACKS-ABILITIES.languages.known")}</label>
        <select name="uuid"><option value="">—</option>${options}</select></div>` : ""}
      <div class="form-group"><label>${game.i18n.localize("ACKS-ABILITIES.languages.orType")}</label>
        <input type="text" name="typed" /></div>`,
    ok: {
      callback: (_e, button) => ({
        uuid: button.form.elements.uuid?.value ?? "",
        typed: button.form.elements.typed.value.trim(),
      }),
    },
  }).catch(() => null);
  if (!form) return;
  if (!form.uuid && !form.typed) return;
  const r = await fillSlot(this.item, { name: form.typed, uuid: form.uuid });
  if (!r.ok) ui.notifications?.warn(game.i18n.localize(`ACKS-ABILITIES.languages.refuse.${r.reason}`));
  this.render();
}

/** Empty one slot, and with it the language it bought. */
async function clearLanguage(_event, target) {
  await clearSlot(this.item, Number(target.dataset.index));
  this.render();
}

/**
 * A language dropped on the carrier spends a slot. The drop does not MOVE the
 * document — a language is a thing many characters know, so the world's copy
 * stays where it is and the character gets their own.
 */
export async function onDropLanguage(item) {
  if (item?.type !== LANGUAGE_TYPE) {
    // An ability is the mistake worth naming: languages used to BE abilities,
    // so a world's older copy still looks droppable. Anything else declines
    // quietly and goes to the sheet's normal drop handling.
    if (item?.type === "ability") {
      ui.notifications?.warn(game.i18n.localize("ACKS-ABILITIES.languages.refuse.notALanguage"));
      return true;
    }
    return false;
  }
  const r = await fillSlot(this.item, { name: item.name, uuid: item.uuid });
  if (!r.ok) ui.notifications?.warn(game.i18n.localize(`ACKS-ABILITIES.languages.refuse.${r.reason}`));
  else this.render();
  return true;
}

export const LANGUAGE_ACTIONS = { pickLanguage, clearLanguage };
