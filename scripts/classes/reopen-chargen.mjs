/* global game, Actor, Hooks, foundry, ui */
/**
 * Sending a character back through the Scores Generator.
 *
 * The system offers its generator only while it considers the character new
 * (`system.isNew`), and clears that on the first update that touches the
 * scores. This sets the flag again. Generating replaces the last run of the
 * page, so re-opening it on a character who owns anything is confirmed as a
 * destructive act.
 */
import { LANG_PREFIX } from "./constants.mjs";
import { ACTOR_TYPE } from "../lib/vocab.mjs";
import { elementOf } from "../lib/util.mjs";

/**
 * Mark this character new again, so the system offers its generator.
 *
 * Asks first, naming the actor's item count as what is at stake.
 */
export async function reopenChargen(actor) {
  if (!actor?.isOwner) return false;
  const items = actor.items?.size ?? 0;
  const ok = await foundry.applications.api.DialogV2.confirm({
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
    window: { title: game.i18n.localize(`${LANG_PREFIX}.reopen.title`) },
    content: `<p>${game.i18n.format(`${LANG_PREFIX}.reopen.confirm`, {
      name: foundry.utils.escapeHTML(actor.name),
      items,
    })}</p>`,
  });
  if (!ok) return false;
  await actor.update({ "system.isNew": true });
  ui.notifications.info(game.i18n.format(`${LANG_PREFIX}.reopen.done`, { name: actor.name }));
  return true;
}

/**
 * Offer the control beside the class picker, except on a character the system
 * already offers its generator to.
 */
function onRenderCharacterSheet(app, element) {
  const root = elementOf(element);
  if (!root) return;
  const doc = app.document;
  if (!(doc instanceof Actor) || doc.type !== ACTOR_TYPE.character || !doc.isOwner) return;
  if (doc.system?.isNew) return; // the page is already on offer
  const pick = root.querySelector(".acks-extras-classes-pick");
  if (!pick || pick.parentElement.querySelector(".acks-extras-classes-reopen")) return;

  const btn = document.createElement("a");
  btn.className = "acks-extras-classes-reopen";
  btn.dataset.tooltip = game.i18n.localize(`${LANG_PREFIX}.reopen.tooltip`);
  btn.innerHTML = '<i class="fa-solid fa-dice"></i>';
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    reopenChargen(doc);
  });
  // Placed after the picker and any level-up control: the destructive one is last.
  const row = pick.parentElement;
  row.appendChild(btn);
}

/** Register the sheet control (called once from classes/module.mjs). */
export function registerReopenChargen() {
  Hooks.on("renderApplicationV2", onRenderCharacterSheet);
}
