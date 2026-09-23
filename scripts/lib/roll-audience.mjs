/* global game, foundry, ChatMessage, Hooks */
/**
 * Who sees which part of a roll this module posts: the card meant for the
 * Judges alone, the one Dice So Nice call, and the attack card's private math.
 *
 * Foundry shows every seat a whispered message that carries rolls, as a
 * "privately rolled some dice" placeholder naming the roller. A card meant for
 * the Judges alone therefore never attaches its rolls: the dice are written
 * into its content where Foundry would have drawn them, and Dice So Nice is
 * shown to the Judges explicitly.
 *
 * The math section is Foundry's own secret section. `ChatMessage#renderHTML`
 * keeps it for the owners of the speaking actor and for the GMs, strips it for
 * every other reader, and gives the kept block a Reveal button that writes the
 * section open for everyone. See docs/lib/DECISIONS.md, "Public results,
 * private math".
 */
import { MODULE_ID } from "./constants.mjs";
import { gmIds } from "./util.mjs";

/** The world setting choosing who reads an attack card's math. */
export const ROLL_MATH_SETTING = "rollMath";

/** Its values: the speaking actor's owners and the GMs, or every reader. */
export const ROLL_MATH = Object.freeze({ owners: "owners", everyone: "everyone" });

/** The class the math's inner wrapper carries; the section itself may carry only `class` and `id`. */
const MATH_CLASS = "acks-extras-roll-math";

/** Is an attack card's math private? True unless the world chose everyone, or before settings exist. */
export function mathIsPrivate() {
  try {
    return game.settings.get(MODULE_ID, ROLL_MATH_SETTING) !== ROLL_MATH.everyone;
  } catch {
    return true;
  }
}

/**
 * Wrap a card's math so only the speaking actor's owners and the GMs read it,
 * or return it bare when the world shows it to everyone. The section carries
 * only `class` and `id` because Foundry's reveal toggle matches and rewrites
 * the opening tag with those two alone; styling goes on the inner div.
 */
export function mathSection(html) {
  if (!html) return "";
  if (!mathIsPrivate()) return html;
  return `<section class="secret" id="${foundry.utils.randomID()}"><div class="${MATH_CLASS}">${html}</div></section>`;
}

/**
 * Offer a math section's Reveal only to the message's author and the GMs.
 * Revealing rewrites the message, which an owner who did not post it has no
 * right to do, so the button would fail for them.
 */
export function installMathReveal() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    for (const block of html?.querySelectorAll?.("secret-block") ?? []) {
      if (!block.querySelector(`.${MATH_CLASS}`)) continue;
      block.revealable = !!(message.isAuthor || game.user.isGM);
    }
  });
}

/**
 * Show rolls through Dice So Nice, when it is active. `whisper` limits who
 * sees them; an empty or missing list means every seat, because Dice So Nice
 * reads an empty list as nobody.
 *
 * @param {Roll|Roll[]} rolls
 * @param {{whisper?: string[]|null, blind?: boolean}} [opts]
 */
export async function showDice(rolls, { whisper = null, blind = false } = {}) {
  const dice3d = game.dice3d;
  if (!dice3d?.showForRoll) return;
  const viewers = whisper?.length ? whisper : null;
  for (const roll of [rolls].flat().filter(Boolean)) {
    try {
      await dice3d.showForRoll(roll, game.user, true, viewers, !!blind);
    } catch (err) {
      console.warn(`${MODULE_ID} | Dice So Nice could not show a roll`, err);
    }
  }
}

/**
 * Does this HTML hold an element of its own? Foundry draws a roll's box only
 * where it does not. A tag opening is an element; text, entities and comments
 * are not.
 */
const hasMarkup = (html) => /<[a-z][\w-]*[\s/>]/i.test(String(html ?? ""));

/**
 * Post a card only the GMs see: whispered to every GM with no rolls attached.
 * Where the content has no markup of its own the rolls' boxes become the
 * content, as Foundry would have drawn them; a card that states its own totals
 * keeps its content. The dice show through Dice So Nice to the GMs.
 *
 * @param {object} data ChatMessage data; `rolls` is taken off it and `whisper` is set
 * @returns {Promise<ChatMessage>}
 */
export async function postToJudges({ rolls = [], ...data } = {}) {
  const dice = [rolls].flat().filter(Boolean);
  const whisper = gmIds();
  const message = { ...data, whisper, rolls: [] };
  if (dice.length && !hasMarkup(data.content)) {
    message.content = (await Promise.all(dice.map((r) => r.render()))).join("");
  }
  await showDice(dice, { whisper });
  return ChatMessage.create(message);
}

/**
 * Draw from a table for the GMs alone: Foundry's own result card, whispered
 * to them, with the roll taken off the message before it is created. The
 * card's own dice box stays in its content.
 *
 * @param {RollTable} table
 * @param {object} [options] passed to `table.draw`
 * @returns {Promise<{roll: Roll, results: TableResult[]}>}
 */
export async function drawForJudges(table, options = {}) {
  const drawn = await table.draw({ ...options, displayChat: false });
  if (!drawn?.results?.length) return drawn;
  const strip = (doc, _data, _options, userId) => {
    if (userId !== game.user.id || doc.getFlag?.("core", "RollTable") !== table.id) return;
    doc.updateSource({ rolls: [], sound: null });
  };
  await showDice(drawn.roll, { whisper: gmIds() });
  Hooks.on("preCreateChatMessage", strip);
  try {
    await table.toMessage(drawn.results, { roll: drawn.roll, messageOptions: { messageMode: "gm" } });
  } finally {
    Hooks.off("preCreateChatMessage", strip);
  }
  return drawn;
}
