/* global game, Actor, Hooks, foundry, ui */
/**
 * Sending a character back through the Scores Generator.
 *
 * The system offers its generator only while it considers the character NEW
 * (`system.isNew`), and it clears that on the first update that touches the
 * scores. That is the right default — a played character should not meet a
 * "roll your attributes" page every time they open their sheet — but it means
 * a character built by hand, or one generated wrongly, can never be sent back.
 * The page itself works perfectly; nothing could reach it.
 *
 * So the flag is set again, deliberately, by someone who has been told what it
 * costs. It is NOT a quiet toggle: generating a character replaces the last
 * run of the page, so re-opening it on a character who owns anything is a
 * destructive act and is confirmed as one.
 */
import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import { ACTOR_TYPE } from "../lib/vocab.mjs";

/**
 * Mark this character new again, so the system offers its generator.
 *
 * Asks first, and the question names what is actually at stake — the item
 * count, because "this will replace your equipment" means nothing next to
 * "this will replace your 23 items".
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
 * Offer the control beside the class picker — and only on a character the
 * system is NOT already offering its generator to, since a new character has
 * the page in front of them already.
 */
function onRenderCharacterSheet(app, element) {
  const root = element instanceof HTMLElement ? element : element?.[0];
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
  // After the picker and any level-up control, so the destructive one is last
  // in a row a player clicks through left to right.
  const row = pick.parentElement;
  row.appendChild(btn);
}

/** Register the sheet control (called once from classes/module.mjs). */
export function registerReopenChargen() {
  Hooks.on("renderApplicationV2", onRenderCharacterSheet);
}

/** Published so a macro can send a character back without the sheet. */
export const CHARGEN_FLAG = `${MODULE_ID}.reopen`;
