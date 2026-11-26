/* global Hooks, game, foundry, ui */
/**
 * The Deal block of the fight-over card, the Foundry half of
 * `search-deal-logic.mjs`. The card's render hook draws the block from the
 * message's flag (a chat card's stored content loses attributes and holds no
 * state, so every render builds it again and the flag is the only copy), from
 * the shared options partial the pot's rail uses. A press or a change writes one
 * choice to the flag, which re-renders the card.
 *
 * Who is drawn the block is Foundry's own answer for the message
 * (`canUserModify(user, "update")`: a GM, or the message's author); no role is
 * tested here.
 */
import { makeLoc } from "../lib/util.mjs";
import { armsSource } from "./deal.mjs";
import { DEAL_BLOCK_TEMPLATE, LANG, MODULE_ID, TREASURE_TABLE_DOCS } from "./constants.mjs";
import { canBrowseTables } from "./deal-logic.mjs";
import { styleCite } from "./hoard.mjs";
import { cardDealChoice, dealBlockOf } from "./search-deal-logic.mjs";
import { cardSeed } from "./search.mjs";
import { SEARCH_FLAG } from "./search-logic.mjs";

const loc = makeLoc(LANG);

/** The control a press or change last reached on each card, found again after the card draws itself anew so keyboard focus is not lost to the write. */
const refocus = new Map();
let draws = 0;

/** The card's record as the message holds it now. */
const flagOf = (message) => message?.flags?.[MODULE_ID]?.[SEARCH_FLAG] ?? null;

/**
 * Write one deal choice to a card's record. A seat Foundry does not let write
 * the message, a card whose scene is open and a value the pot would not hold
 * write nothing.
 * @param {ChatMessage} message
 * @param {"style"|"special"|"metInLair"|"armsSetting"} key
 * @param {*} value
 * @returns {Promise<boolean>} whether a write was made
 */
export async function setCardDeal(message, key, value) {
  if (!message?.canUserModify?.(game.user, "update")) return false;
  const next = cardDealChoice(flagOf(message), key, value, cardSeed());
  if (!next) return false;
  await message.update({ [`flags.${MODULE_ID}.${SEARCH_FLAG}.deal`]: next });
  return true;
}

/** The control a press reached, as a selector that finds it again in the next draw. */
function selectorOf(control) {
  if (control.matches("[data-deal-arms]")) return "[data-deal-arms]";
  const action = control.dataset.action;
  return control.dataset.style ? `[data-action="${action}"][data-style="${control.dataset.style}"]` : `[data-action="${action}"]`;
}

/** Draw the block into the card's slot, or leave the slot empty for a seat that is drawn none. */
async function drawBlock(message, slot) {
  const block = dealBlockOf({
    record: flagOf(message),
    canUpdate: message.canUserModify?.(game.user, "update") === true,
    seed: cardSeed(),
    styleCite,
    arms: armsSource(),
    loc,
    canBrowse: canBrowseTables(game.user),
  });
  if (!block) {
    slot.replaceChildren();
    return;
  }
  const context = { partId: `${message.id}-deal-${++draws}`, ...(block.kind === "open" ? { reason: block.reason } : { options: block.options }) };
  slot.innerHTML = await foundry.applications.handlebars.renderTemplate(DEAL_BLOCK_TEMPLATE, context);
  const again = refocus.get(message.id);
  refocus.delete(message.id);
  if (again) slot.querySelector(again)?.focus();
}

/** Write a press or a change of one of the block's controls, and say so on the Judge's screen where it fails. */
function press(message, control) {
  let write = null;
  if (control.matches("[data-deal-arms]")) write = ["armsSetting", control.value];
  else if (control.dataset.action === "dealStyle") write = ["style", control.dataset.style];
  else if (control.dataset.action === "dealSpecial") write = ["special", control.getAttribute("aria-pressed") !== "true"];
  else if (control.dataset.action === "dealLair") write = ["metInLair", control.getAttribute("aria-pressed") !== "true"];
  if (!write) return;
  refocus.set(message.id, selectorOf(control));
  setCardDeal(message, ...write).then(
    (wrote) => wrote || refocus.delete(message.id),
    (err) => {
      refocus.delete(message.id);
      console.error(`${MODULE_ID} | search the fallen could not write a deal choice`, err);
      ui.notifications?.error(loc("search.deal.failed"));
    },
  );
}

/** Open the Ruledata Browser on the treasure tables, for a seat that may modify world settings. */
function openTables() {
  if (!canBrowseTables(game.user)) return;
  globalThis.acksExtras?.location?.openRuledataBrowser?.({ focus: [...TREASURE_TABLE_DOCS] });
}

Hooks.on("renderChatMessageHTML", (message, html) => {
  if (!flagOf(message)) return;
  let slot = html.querySelector('[data-field="deal"]');
  if (!slot) {
    // A card posted before the block existed holds no slot in its stored content: it goes above the Search the scene button.
    const button = html.querySelector('[data-action="searchScene"]');
    if (!button) return;
    slot = button.ownerDocument.createElement("div");
    slot.dataset.field = "deal";
    button.before(slot);
  }
  // An element is told by `nodeType` and a control by `matches`: a card can render in a window of its own, whose nodes are no instance of this one's classes.
  const controlOf = (event) => {
    const node = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
    const control = node?.closest?.("[data-action], [data-deal-arms]") ?? null;
    return control && slot.contains(control) && !control.disabled ? control : null;
  };
  slot.addEventListener("click", (event) => {
    const control = controlOf(event);
    if (!control || control.matches("[data-deal-arms]")) return;
    if (control.dataset.action === "dealTables") openTables();
    else press(message, control);
  });
  slot.addEventListener("change", (event) => {
    const control = controlOf(event);
    if (control?.matches("[data-deal-arms]")) press(message, control);
  });
  drawBlock(message, slot).catch((err) => console.error(`${MODULE_ID} | search the fallen could not draw its deal block`, err));
});
