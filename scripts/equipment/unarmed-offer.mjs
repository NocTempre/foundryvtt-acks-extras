/* global foundry, game, ui, Hooks, ChatMessage */
/**
 * The offer forwarded to the Judge: when an owner keeps a die on a character
 * from the Unarmed Strike prompt, a whispered card tells the seats that may
 * modify world settings, and one press writes the same die as the world's.
 * Ignoring the card changes nothing.
 *
 * The card holds no state of its own. What it says is read from the world when
 * it is drawn: the world holds no die (the press is offered), holds this die
 * (it was saved) or holds another (nothing is changed). A seat that cannot
 * write the world sees that the Judge has been offered the die and no button.
 */
import { LANG, MODULE_ID } from "./constants.mjs";
import { makeLoc, escape as esc } from "../lib/util.mjs";
import { unarmedStrikeDie } from "./attack-mods.mjs";
import { keepUnarmedDie, mayKeepUnarmedDie } from "./unarmed-keep.mjs";

const loc = makeLoc(LANG);

/** The flag on the card that holds what was offered: `{die, character}`. */
export const OFFER_FLAG = "unarmedOffer";

const MARK = "data-unarmed-offer";
const PRESS = "data-unarmed-offer-save";
const RESULT = "data-unarmed-offer-result";

/**
 * What the card says now. `sent` is a seat that cannot write the world, `offered`
 * a seat that can with the world holding no die, and the other two are the
 * world holding this die or another.
 * @param {string} die  the die the card offers
 * @param {{worldDie: string|null, mayKeep: boolean}} world
 * @returns {"sent"|"offered"|"saved"|"already"}
 */
export function offerState(die, { worldDie, mayKeep }) {
  if (worldDie !== null && worldDie !== undefined) return worldDie === die ? "saved" : "already";
  return mayKeep ? "offered" : "sent";
}

/** The card's markup: the title, the sentence, the one press and what ignoring it does. */
export function offerContent({ player, character, die }) {
  const fill = { player, character, die };
  return `<div class="acks-ui acks-extras acks-extras-unarmed-offer" ${MARK}>`
    + `<h3>${esc(loc("offer.title"))}</h3>`
    + `<p>${esc(loc("offer.body", fill))}</p>`
    + `<p class="hint" ${RESULT} hidden></p>`
    + `<button type="button" ${PRESS} data-tooltip-text="${esc(loc("offer.saveTip", fill))}">${esc(loc("offer.save"))}</button>`
    + `<p class="hint" data-unarmed-offer-ignore>${esc(loc("offer.ignore", fill))}</p>`
    + `</div>`;
}

/**
 * Whisper the offer to every seat that may modify world settings.
 * @param {Actor} actor  the character the die was kept on
 * @param {string} die
 * @returns {Promise<ChatMessage|null>} null where no seat can be told
 */
export async function offerToJudge(actor, die) {
  const to = [...(game.users ?? [])].filter((user) => user.can?.("SETTINGS_MODIFY") && user.id !== game.user.id).map((user) => user.id);
  if (!to.length) return null;
  try {
    return await ChatMessage.create({
      content: offerContent({ player: game.user.name, character: actor.name, die }),
      whisper: to,
      speaker: ChatMessage.getSpeaker({ actor }),
      flags: { [MODULE_ID]: { [OFFER_FLAG]: { die, character: actor.name } } },
    });
  } catch (err) {
    console.warn(`${MODULE_ID} | the unarmed die offer was not sent`, err);
    return null;
  }
}

/** Draw the card for the world as it is: the press, or the line that replaces it. */
function draw(root, die) {
  const state = offerState(die, { worldDie: unarmedStrikeDie(), mayKeep: mayKeepUnarmedDie() });
  const button = root.querySelector(`[${PRESS}]`);
  const result = root.querySelector(`[${RESULT}]`);
  const ignore = root.querySelector("[data-unarmed-offer-ignore]");
  if (state === "offered") {
    if (button) button.hidden = false;
    if (result) result.hidden = true;
    return;
  }
  if (button) button.hidden = true;
  if (ignore) ignore.hidden = true;
  if (result) {
    result.textContent = loc(`offer.${state}`, { die });
    result.hidden = false;
  }
}

/** Wire the one press. */
function bind(root, die) {
  draw(root, die);
  const button = root.querySelector(`[${PRESS}]`);
  if (!button || button.dataset.bound) return;
  button.dataset.bound = "1";
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    if (!mayKeepUnarmedDie() || unarmedStrikeDie() !== null) return draw(root, die);
    button.disabled = true;
    await keepUnarmedDie(die);
    button.disabled = false;
    draw(root, die);
  });
}

/** Draw every offer card this client renders. */
export function registerUnarmedOffer() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const offer = message?.getFlag?.(MODULE_ID, OFFER_FLAG);
    const root = html?.querySelector?.(`[${MARK}]`);
    if (offer?.die && root) bind(root, offer.die);
  });
}
