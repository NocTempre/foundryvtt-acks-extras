/* global ChatMessage */
/**
 * The day's navigation throw, as a card only the Judge sees.
 *
 * Whispered, always, and never acted on automatically. RAW is explicit that a
 * failed throw leaves the STRAY DIRECTION to the Judge — "based on the
 * landmarks and terrain, or randomly" — so a module that silently walked the
 * party sideways would be taking a decision the rules hand to a person. The
 * card reports, and offers the blind roll for a Judge who would rather not
 * choose.
 *
 * The other reason it whispers: a party that has just failed does not know it.
 * A public card would tell the table the one thing the rule spends its whole
 * length keeping from them.
 */
import { makeLoc, gmIds } from "../lib/util.mjs";
import { rollLandNavigation } from "./travel.mjs";

const loc = makeLoc("ACKS-FORMATION");

/**
 * Roll the day's navigation and whisper the result.
 *
 * Returns the throw so a caller can act on it, or null when no throw was owed
 * — a party on a road or a river does not get lost, and one whose target was
 * never imported cannot be tested at all.
 */
export async function postNavigationThrow(formation) {
  const result = await rollLandNavigation(formation);

  if (!result.throws) {
    // Nothing owed. Silent on purpose: a card every day saying "you followed
    // the road" is noise the Judge will learn to skip past.
    return result;
  }

  const rows = [];
  if (result.target == null) {
    rows.push(`<li>${loc("nav.unpriced")}</li>`);
  } else {
    rows.push(`<li>${loc("nav.terrain", { terrain: result.terrain })}</li>`);
    const c = result.competence ?? {};
    if (c.navigation || c.pathfinding) {
      rows.push(`<li>${loc(c.navigation && c.pathfinding ? "nav.both" : "nav.one")}</li>`);
    }
    if (c.unpriced) rows.push(`<li>${loc("nav.bonusUnpriced")}</li>`);
    rows.push(`<li>${loc("nav.result", { total: result.total, target: result.target })}</li>`);
    if (result.botched) rows.push(`<li><strong>${loc("nav.botched")}</strong></li>`);
  }

  const verdict = result.target == null
    ? loc("nav.cannotTest")
    : result.success ? loc("nav.kept") : loc("nav.lost");

  // No `type` and no `rolls`: in v12+ `type` is a document SUBTYPE, and passing
  // the old numeric style there makes creation fail without throwing — the
  // message simply never appears. The sibling encounter card sets neither, and
  // the throw's own total is already in the card's text.
  await ChatMessage.create({
    speaker: { alias: loc("nav.speaker") },
    whisper: gmIds(),
    content: `<div class="acks-extras-nav-card">`
      + `<h3>${loc("nav.title")}</h3><ul>${rows.join("")}</ul>`
      + `<p class="acks-extras-nav-verdict">${verdict}</p>`
      + (result.success === false && result.target != null
        ? `<p class="hint">${loc("nav.judgeChooses")}</p>` : "")
      + `</div>`,
  });

  return result;
}
