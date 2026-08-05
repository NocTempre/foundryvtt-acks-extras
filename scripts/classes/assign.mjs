/* global game, foundry, ui, Hooks, Actor, fromUuid */
/**
 * Binding a character to a class document from the sheet: a picker control
 * injected beside the system's free-text class input.
 *
 * Injection rides `renderApplicationV2` (the base class is always in the
 * render chain, whatever the concrete sheet is called) and is idempotent —
 * the control is only added when absent, so the chain firing once per
 * inheritance level is harmless.
 */
import { LANG_PREFIX } from "./constants.mjs";
import { classItems, classForActor } from "./registry.mjs";
import { applyClass } from "./apply.mjs";

/** Open the class picker for one character and apply the chosen class. */
export async function openClassPicker(actor) {
  const items = classItems().sort((a, b) => a.name.localeCompare(b.name));
  if (!items.length) {
    ui.notifications?.info(game.i18n.localize(`${LANG_PREFIX}.pick.empty`));
    return;
  }
  const bound = classForActor(actor);
  const options = items
    .map(
      (i) =>
        `<option value="${i.uuid}"${bound?.uuid === i.uuid ? " selected" : ""}>${foundry.utils.escapeHTML(i.name)}${
          i.system.isStub ? ` (${game.i18n.localize(`${LANG_PREFIX}.pick.stub`)})` : ""
        }</option>`,
    )
    .join("");
  const level = Math.max(1, Number(actor.system?.details?.level) || 1);
  const content = `
    <div class="form-group">
      <label>${game.i18n.localize(`${LANG_PREFIX}.pick.class`)}</label>
      <select name="uuid">${options}</select>
    </div>
    <div class="form-group">
      <label>${game.i18n.localize(`${LANG_PREFIX}.pick.level`)}</label>
      <input type="number" name="level" value="${level}" min="1" step="1" />
    </div>`;
  const picked = await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.format(`${LANG_PREFIX}.pick.title`, { name: actor.name }) },
    content,
    ok: {
      label: game.i18n.localize(`${LANG_PREFIX}.pick.apply`),
      callback: (_event, button) => {
        const form = button.form;
        return { uuid: form.elements.uuid?.value, level: Number(form.elements.level?.value) || level };
      },
    },
    rejectClose: false,
  });
  if (!picked?.uuid) return;
  const item = await fromUuid(picked.uuid);
  if (!item) return;
  await applyClass(actor, item, { level: picked.level });
}

function onRenderCharacterSheet(app, element) {
  const root = element instanceof HTMLElement ? element : element?.[0];
  if (!root) return;
  const doc = app.document;
  if (!(doc instanceof Actor) || doc.type !== "character" || !doc.isOwner) return;
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
