/* global game, ChatMessage, Hooks */
/**
 * Who sees which part of a roll this module posts: the card meant for the
 * Judges alone, and the one Dice So Nice call.
 *
 * Foundry shows every seat a whispered message that carries rolls, as a
 * "privately rolled some dice" placeholder naming the roller. A card meant for
 * the Judges alone therefore never attaches its rolls: the dice are written
 * into its content where Foundry would have drawn them, and Dice So Nice is
 * shown to the Judges explicitly.
 */
import { MODULE_ID } from "./constants.mjs";
import { gmIds } from "./util.mjs";

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
 * Draw from a table without posting anything: the caller shows the results on
 * a card of its own. A draw that lands on rows shows its dice to the GMs
 * through Dice So Nice; a draw that lands on none shows nothing.
 *
 * @param {RollTable} table
 * @param {object} [options] passed to `table.draw`; `displayChat` is always false
 * @returns {Promise<{roll: Roll, results: TableResult[]}>}
 */
export async function drawQuietly(table, options = {}) {
  const drawn = await table.draw({ ...options, displayChat: false });
  if (drawn?.results?.length) await showDice(drawn.roll, { whisper: gmIds() });
  return drawn;
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
  const drawn = await drawQuietly(table, options);
  if (!drawn?.results?.length) return drawn;
  const strip = (doc, _data, _options, userId) => {
    if (userId !== game.user.id || doc.getFlag?.("core", "RollTable") !== table.id) return;
    doc.updateSource({ rolls: [], sound: null });
  };
  Hooks.on("preCreateChatMessage", strip);
  try {
    await table.toMessage(drawn.results, { roll: drawn.roll, messageOptions: { messageMode: "gm" } });
  } finally {
    Hooks.off("preCreateChatMessage", strip);
  }
  return drawn;
}
