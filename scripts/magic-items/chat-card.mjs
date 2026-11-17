/* global game, ui */
/**
 * Rolling a magic item for the Judges and posting the card: `rollAndPost`, the
 * one entry point the roller window, the macro's `openRoller` and any sheet
 * that wants an item call; and `postChain`, which only posts. The card is
 * always whispered to the Judges, never public and never to a player.
 *
 * Nothing here touches Foundry until it is called, so Node tests import it.
 */
import { renderRollCard } from "../lib/roll-card.mjs";
import { postToJudges } from "../lib/roll-audience.mjs";
import { missingTablesList } from "../lib/ruledata.mjs";
import { makeLoc } from "../lib/util.mjs";
import { LANG_PREFIX, MAGIC_ITEM_DOC } from "./constants.mjs";
import { chainCard } from "./card-model.mjs";
import { rollMagicItem } from "./roll-service.mjs";

const loc = makeLoc(LANG_PREFIX);

/**
 * The notice a refused roll gives, as text. A start that cannot be named, a
 * seat that is not a Judge's and a world with nothing imported each have a
 * line of their own; a world with nothing imported adds what the import still
 * lacks, by document, never a figure. A walk that stopped before its first
 * step names the list it could not roll.
 *
 * @param {{reason?: string, error?: {code: string, list: string}}} result
 * @returns {string}
 */
export function refusalNotice({ reason, error } = {}) {
  if (error) return loc(`card.error.${error.code}`, { list: error.list });
  if (reason === "not-imported") {
    const missing = missingTablesList([MAGIC_ITEM_DOC]);
    return missing.length ? `${loc("refused.not-imported")} ${missing.join(", ")}` : loc("refused.not-imported");
  }
  return loc(`refused.${reason}`);
}

/**
 * Post a rolled item's card to the Judges, with its dice. A result with no
 * steps has nothing to show and posts nothing.
 *
 * @param {object} result a `rollMagicItem` result
 * @param {{style?: string}} [options] `style` heads the card's banner
 * @returns {Promise<ChatMessage|null>} the message, or null when nothing was posted
 */
export async function postChain(result, { style } = {}) {
  const content = renderRollCard(chainCard(result, { loc, style }));
  if (!content) return null;
  return postToJudges({ content, rolls: result.rolls });
}

/**
 * Roll a magic item from the imported tables and whisper the card to the
 * Judges. This is the entry point to call from anything that wants an item
 * (`acksExtras.magicItems.rollAndPost`): the roller window calls it, and a sheet
 * may call it without the window. A seat that is not a Judge's is refused. A
 * roll that cannot begin (nothing imported, no rarity for a heroic or gritty
 * roll, an unknown style) or that stops before its first step posts no card and
 * says why in a notification; a walk that stops later, or an item the chain
 * could not follow to its end, posts the steps it has with a footnote. Nothing
 * here throws on the tables' content or on a failed post.
 *
 * @param {object} [options]
 * @param {"classic"|"heroic"|"gritty"} [options.style]
 * @param {string} [options.category] the classic category list's key; none rolls the type list
 * @param {string} [options.rarity] the heroic or gritty list's key
 * @param {string} [options.from] a list id to begin at, over `style`
 * @param {function} [options.roller] `roll(expr) -> {total, sides}`; the Foundry roller by default
 * @param {object} [options.tables] the document's tables; the registry's by default
 * @returns {Promise<{ok: boolean, reason?: string, result: object|null, message: ChatMessage|null}>}
 *   `result` is the `rollMagicItem` result (null for a seat refused as not a
 *   Judge's) and `message` the posted card (null where none was posted); `reason`
 *   is `gm-only`, a start refusal, the walk's error code or `post-failed`
 */
export async function rollAndPost({ style, category, rarity, from, roller, tables } = {}) {
  if (!game.user?.isGM) {
    ui.notifications?.warn(refusalNotice({ reason: "gm-only" }));
    return { ok: false, reason: "gm-only", result: null, message: null };
  }
  const result = await rollMagicItem({ style, category, rarity, from, roller, tables });
  if (!result.steps.length) {
    ui.notifications?.warn(refusalNotice(result));
    return { ok: false, reason: result.reason, result, message: null };
  }
  try {
    const message = await postChain(result, { style });
    return { ok: result.ok, reason: result.reason, result, message };
  } catch (err) {
    console.error("acks-extras | the magic-item card could not be posted", err);
    ui.notifications?.warn(loc("refused.post-failed"));
    return { ok: false, reason: "post-failed", result, message: null };
  }
}
