/* global game, ChatMessage */
/**
 * The crossing's prompt card: what the swim crossing posts at a swimmer's turn in
 * a fight, with one Throw button, and what it keeps once the throw is made.
 *
 * The card is whispered to the member's owners and the Judges. It carries the
 * crossing, the member and the turn it was posted for under
 * `flags["acks-extras"].crossingPrompt`, so a throw made from the card or from
 * the row finds it again (`settlePrompts`) and takes the button off: the card
 * keeps the result and nothing on it rolls by itself. This file draws and finds
 * cards and imports nothing of the crossing's state; `crossing-driver.mjs` binds
 * the button.
 */
import { MODULE_ID } from "./constants.mjs";
import { renderRollCard } from "../lib/roll-card.mjs";
import { judgesAndOwners, makeLoc } from "../lib/util.mjs";

const loc = makeLoc("ACKS-FORMATION");

/** The flag on a prompt card, under the module's scope. */
export const PROMPT_FLAG = "crossingPrompt";

/** The `data-action` of the card's Throw button. */
export const PROMPT_ACTION = "crossingPromptThrow";

/**
 * The prompt card's HTML for a member's turn. With `result` the button is gone
 * and the line states the throw.
 *
 * @param {object} o
 * @param {string} o.name the member
 * @param {string} o.formationId
 * @param {string} o.crossingId
 * @param {string} o.actorId
 * @param {number|null} o.target the throw's target, null where none is known
 * @param {string} o.targetTip the target's provenance, assembled at render
 * @param {string|null} [o.result] the settled line, such as "14 vs 6+ stays afloat"
 */
export function promptCard({ name, formationId, crossingId, actorId, target, targetTip, result = null }) {
  return renderRollCard({
    title: loc("crossing.prompt.title", { name }),
    note: target === null ? "" : loc("crossing.prompt.target", { target }),
    noteTooltip: targetTip,
    empty: result ?? loc("crossing.prompt.waiting"),
    footnote: loc("crossing.prompt.meta", { name }),
    buttons: result === null
      ? [{
        action: PROMPT_ACTION,
        label: loc("crossing.throw"),
        icon: "fa-solid fa-dice-d20",
        data: { formationId, crossingId, actorId },
        tooltip: loc("crossing.throwFor", { name }),
      }]
      : [],
  });
}

/**
 * Post a member's prompt card to their owners and the Judges.
 *
 * @param {object} o the same fields as `promptCard`, and:
 * @param {object} o.actor the member's actor, whose owners are addressed
 * @param {string} o.combatId the fight the turn belongs to
 * @param {number} o.round the round of that turn
 * @param {string} o.alias the speaker's name on the card
 * @returns {Promise<ChatMessage>}
 */
export async function postPrompt({ actor, combatId, round, alias, ...card }) {
  return ChatMessage.create({
    content: promptCard({ name: actor.name, ...card }),
    whisper: judgesAndOwners(actor),
    speaker: { alias },
    flags: { [MODULE_ID]: { [PROMPT_FLAG]: { formationId: card.formationId, crossingId: card.crossingId, actorId: card.actorId, combatId, round, target: card.target, targetTip: card.targetTip } } },
  });
}

/** The prompt cards of a crossing for a member that are still waiting for their throw. */
export function openPrompts(crossingId, actorId) {
  return [...(game.messages ?? [])].filter((message) => {
    const flag = message.flags?.[MODULE_ID]?.[PROMPT_FLAG];
    return flag && flag.crossingId === crossingId && flag.actorId === actorId && !flag.settled;
  });
}

/**
 * Take the button off a member's waiting prompt cards and keep the result on
 * them. A GM client's work: a player cannot update a whispered card.
 *
 * @param {string} crossingId
 * @param {string} actorId
 * @param {string} result the line the card keeps
 * @returns {Promise<number>} how many cards were settled
 */
export async function settlePrompts(crossingId, actorId, result) {
  let settled = 0;
  for (const message of openPrompts(crossingId, actorId)) {
    const flag = message.flags[MODULE_ID][PROMPT_FLAG];
    const name = game.actors?.get?.(actorId)?.name ?? "";
    await message.update({
      content: promptCard({ name, formationId: flag.formationId, crossingId, actorId, target: flag.target ?? null, targetTip: flag.targetTip ?? "", result }),
      [`flags.${MODULE_ID}.${PROMPT_FLAG}.settled`]: true,
    });
    settled += 1;
  }
  return settled;
}
