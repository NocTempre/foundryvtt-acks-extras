/* global ChatMessage */
import { gmIds } from "../lib/util.mjs";

/**
 * One formation chat card, spoken by the party. `whisper` sends it to the
 * GMs alone, for a result the table is not meant to see yet.
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
