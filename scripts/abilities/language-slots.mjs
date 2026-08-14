/* global game, foundry, ui */
/**
 * The carrier surface: filling an ability's language slots by hand.
 *
 * The slot MODEL lives in classes/languages.mjs (it is a class-grant concept);
 * this is only the sheet's half — the picker, the drop, and the clear. Kept
 * beside the sheet that owns them so the model stays free of UI.
 */
import { MODULE_ID } from "./constants.mjs";
import { slotsOf, fillSlot, clearSlot, freeSlots } from "../classes/languages.mjs";

export { slotsOf };

/** Every language ability the world can offer — the pick list. */
function worldLanguages() {
  const seen = new Map();
  for (const item of game.items ?? []) {
    if (item.type !== "ability") continue;
    if (item.flags?.[MODULE_ID]?.extras?.category !== "language") continue;
    if (!seen.has(item.name.toLowerCase())) seen.set(item.name.toLowerCase(), item);
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Pick a tongue for the next free slot. Offers the world's language abilities
 * when it has any, and always allows a typed name: the setting decides which
 * languages exist, and a world that has imported none must still be playable.
 */
async function pickLanguage() {
  if (!freeSlots(this.item)) return;
  const options = worldLanguages()
    .map((i) => `<option value="${i.uuid}">${foundry.utils.escapeHTML(i.name)}</option>`)
    .join("");
  const form = await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.localize("ACKS-ABILITIES.languages.pickTitle") },
    classes: ["acks-ui", "acks-extras"],
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
  const doc = form.uuid ? await fromUuid(form.uuid).catch(() => null) : null;
  const name = doc?.name || form.typed;
  if (!name) return;
  const r = await fillSlot(this.item, { name, uuid: form.uuid });
  if (!r.ok) ui.notifications?.warn(game.i18n.localize(`ACKS-ABILITIES.languages.refuse.${r.reason}`));
  this.render();
}

/** Empty one slot. */
async function clearLanguage(_event, target) {
  await clearSlot(this.item, Number(target.dataset.index));
  this.render();
}

/**
 * A language ability dropped on the carrier fills a slot. The drop does not
 * MOVE the document — a language is a thing many characters know, so the
 * carrier records it by name and uuid rather than consuming the item.
 */
export async function onDropLanguage(item) {
  if (item?.type !== "ability") return false;
  if (item.flags?.[MODULE_ID]?.extras?.category !== "language") {
    ui.notifications?.warn(game.i18n.localize("ACKS-ABILITIES.languages.refuse.notALanguage"));
    return false;
  }
  const r = await fillSlot(this.item, { name: item.name, uuid: item.uuid });
  if (!r.ok) ui.notifications?.warn(game.i18n.localize(`ACKS-ABILITIES.languages.refuse.${r.reason}`));
  else this.render();
  return true;
}

export const LANGUAGE_ACTIONS = { pickLanguage, clearLanguage };
