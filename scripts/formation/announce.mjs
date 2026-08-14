/* global ChatMessage */
import { gmIds } from "../lib/util.mjs";

/**
 * One formation chat card, spoken by the party.
 *
 * `whisper` sends it to the GMs alone — for the things the table is not supposed
 * to know yet (a deploy that found nobody to deploy, a secret throw's outcome).
 * Everything else is public on purpose: a change in the party's posture is
 * exactly what the other players need to see.
 */
export async function announce(formation, text, { whisper = false } = {}) {
  // `text` is composed from localized strings carrying document names players
  // can edit; escape here, at the one sink, rather than trusting every caller.
  await ChatMessage.create({
    content: `<div class="acks-formation-card"><em>${foundry.utils.escapeHTML(text)}</em></div>`,
    speaker: { alias: formation.name },
    whisper: whisper ? gmIds() : [],
  });
}
