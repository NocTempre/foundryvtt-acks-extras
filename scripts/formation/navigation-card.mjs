/* global ChatMessage, Hooks, game, ui */
/**
 * The day's navigation throw (RR 275) as a card whispered to the Judges, and
 * the lost episode a failure opens. The whisper guards the throw's one
 * secret: a party that failed does not know it, and nothing on the card
 * reaches a player until the Judge acts.
 *
 * A failure with no episode open opens one at once (`beginEpisode`) at the
 * belief: the shadow starts on the party token's own hex, and the Judge
 * shifts the truth from the Judge tab as the party walks on. The opening
 * needs the Judge viewing the party's scene, so a refusal is said on the card
 * beside a Begin button that opens the episode the same way, at the belief,
 * once the Judge is there (`beginFromCard`). A throw made while an episode is
 * open opens and closes nothing: a success offers "They realise they are
 * lost" (`discoverEpisode`), which stays the Judge's press.
 */
import { MODULE_ID } from "../lib/constants.mjs";
import { makeLoc, gmIds, elementOf } from "../lib/util.mjs";
import { getFormation } from "./formation-model.mjs";
import { recordNavigationThrow, rollLandNavigation, travelOf } from "./travel.mjs";
import { beginEpisode } from "./lost-episode.mjs";
import { confirmDiscovery } from "./lost-dialog.mjs";

const loc = makeLoc("ACKS-FORMATION");

/** A card button bound by `installNavigationCardActions`, naming its formation. */
const cardButton = (cls, formationId, icon, label) =>
  `<button type="button" class="${cls}" data-formation-id="${formationId}"><i class="${icon}" inert></i> ${label}</button>`;

/**
 * The hex the belief stands in, where an episode can open: the party token's
 * traced hex on its scene, as `beginEpisode` takes it; null with no scene or
 * no hex traced.
 */
function beliefHex(formation, t) {
  if (!formation?.sceneId || t.hex.i == null || t.hex.j == null) return null;
  return { i: t.hex.i, j: t.hex.j };
}

/**
 * Open the lost episode at the belief: the shadow on the party token's own
 * hex, the truth and the belief one hex until the Judge shifts it. What a
 * failed throw does by itself, and what the card's Begin does for the Judge
 * who was elsewhere when it failed. Null, with a warning, while an episode is
 * open or the party stands on no traced hex; `beginEpisode` refuses and warns
 * for itself where the Judge is not viewing the scene.
 */
export async function beginFromCard(formation, { begin = beginEpisode } = {}) {
  const t = travelOf(formation);
  if (t.lost.phase) return null;
  const here = beliefHex(formation, t);
  if (!here) {
    ui.notifications?.warn(loc("lost.needHex"));
    return null;
  }
  return begin(formation, { day: t.dayCount, anchor: here, trueOffset: here });
}

/**
 * Roll the day's navigation, record it, act on a failure, and whisper the
 * result.
 *
 * `by` names who threw (`NAVIGATION_BY`): the day's first step off a road, or
 * the Judge's Throw now. `day` is the key the throw counts for, the record's
 * own today where none is handed in. `begin` is the episode opener a failure
 * calls, `beginEpisode`'s shape. Nothing is rolled, recorded or posted where
 * no throw is owed — a party on a road or beside a river does not get lost. A
 * throw whose target was never imported is recorded and carded as one that
 * could not be made.
 *
 * @returns {Promise<{result: object, entry: object|null, opened: boolean, refused: boolean}>}
 *   `entry` is the record's row, null where nothing was thrown; `opened` and
 *   `refused` say what a failure did about the episode
 */
export async function postNavigationThrow(formation, { by = "step", begin = beginEpisode, day = null } = {}) {
  const result = await rollLandNavigation(formation);
  if (!result.throws) return { result, entry: null, opened: false, refused: false };

  const t = travelOf(formation);
  const entry = await recordNavigationThrow(formation.id, result, { by, hexLabel: t.hex.label, day });
  const phase = t.lost.phase;
  const failed = result.rolled && !result.success;
  const here = beliefHex(formation, t);
  let opened = false;
  let refused = false;
  if (failed && !phase) {
    const began = here ? await begin(formation, { day: t.dayCount, anchor: here, trueOffset: here }) : null;
    opened = !!began;
    refused = !began;
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
    if (result.weather) {
      rows.push(`<li>${loc("nav.weather", { value: result.weather > 0 ? `+${result.weather}` : `${result.weather}` })}</li>`);
    }
    rows.push(`<li>${loc("nav.result", { total: result.total, target: result.target })}</li>`);
    if (result.botched) rows.push(`<li><strong>${loc("nav.botched")}</strong></li>`);
  }

  let verdict;
  const notes = [];
  const buttons = [];
  if (result.target == null) {
    verdict = loc("nav.cannotTest");
  } else if (phase === "aware") {
    verdict = loc("nav.aware");
  } else if (phase === "astray") {
    verdict = loc(result.success ? "nav.astrayKept" : "nav.astrayLost");
    if (result.success) buttons.push(cardButton("acks-extras-nav-realise", formation.id, "fa-solid fa-eye", loc("nav.realise")));
  } else if (result.success) {
    verdict = loc("nav.kept");
  } else {
    verdict = loc("nav.lost");
    if (opened) {
      notes.push(loc("nav.opened"));
    } else {
      // Two refusals: the Judge was not viewing the party's scene, or the
      // party stands on no traced hex of a map. Begin is offered for both:
      // it reads the record afresh when pressed.
      notes.push(loc(here ? "nav.notOpened" : "nav.noHex"));
      buttons.push(cardButton("acks-extras-nav-begin", formation.id, "fa-solid fa-compass-drafting", loc("nav.begin")));
      notes.push(loc("nav.judgeChooses"));
    }
  }

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
      + notes.map((note) => `<p class="hint">${note}</p>`).join("")
      + (buttons.length ? `<div class="acks-extras-nav-actions">${buttons.join("")}</div>` : "")
      + `</div>`,
  });

  return { result, entry, opened, refused };
}

/**
 * Bind the navigation card's buttons on render: Begin opens the episode at
 * the belief (`beginFromCard`) while no episode is open, and They realise
 * they are lost asks `confirmDiscovery` while one is astray. GM only, because
 * both write the episode. A press on a card whose moment has passed — an
 * episode opened since, or one no longer astray — does nothing.
 */
export function installNavigationCardActions() {
  Hooks.on("renderChatMessageHTML", (_message, html) => {
    const root = elementOf(html);
    if (!root || !game.user?.isGM) return;
    const bind = (selector, run) => {
      for (const button of root.querySelectorAll(selector)) {
        button.addEventListener("click", (event) => {
          event.preventDefault();
          const formation = getFormation(button.dataset.formationId);
          if (!formation) return;
          Promise.resolve(run(formation))
            .then((done) => { if (done) button.disabled = true; })
            .catch((err) => console.error(`${MODULE_ID} | navigation card action failed`, err));
        });
      }
    };
    bind(".acks-extras-nav-begin", (formation) => beginFromCard(formation));
    bind(".acks-extras-nav-realise", (formation) => (travelOf(formation).lost.active ? confirmDiscovery(formation) : null));
  });
}
