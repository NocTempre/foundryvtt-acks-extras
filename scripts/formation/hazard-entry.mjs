/* global game, foundry, ui, Hooks, fromUuid */
/**
 * The entry step: after a party move, the Judges are shown what the party's new
 * places hold. For each place the party newly stands in that holds an obstacle
 * one card goes to the Judges, a row per obstacle with a Begin button and the
 * place's conditions as chips. Begin opens the crossing of that obstacle with
 * its figures and picks and every condition of the places the party stands in
 * at the press, once; nothing re-reads a place afterwards.
 *
 * Places are the places linked to the Regions the party token stands in, by
 * core's `token.regions`. The list the last move left is the party actor's
 * `placesUnder` flag; it is written only when it changes, so a place left and
 * entered again posts again. The card is the move's last act: it runs after
 * the trap check, and a move a wall stopped posts none. Journey and settlement
 * modes begin nothing. What the rows hold, which places post and which crossing
 * a Begin opens are `hazard-entry-logic.mjs`.
 */
import { HAZARD_ITEM_TYPE, MODULE_ID } from "./constants.mjs";
import { beginCrossing, endCrossing, readCrossing } from "./crossing.mjs";
import { getFormation, getPartyActor, getPartyToken } from "./formation-model.mjs";
import { hazardLabelKey } from "./hazard-keys.mjs";
import { entryModel, moveHalted, newlyEntered, refsOf, seedForThing } from "./hazard-entry-logic.mjs";
import { penaltyPicksOf } from "./hazard-logic.mjs";
import { waterPenaltySteps } from "./swimming.mjs";
import { travelOf } from "./travel.mjs";
import { thingsOf } from "../lib/place-things.mjs";
import { postToJudges } from "../lib/roll-audience.mjs";
import { renderRollCard } from "../lib/roll-card.mjs";
import { elementOf, makeLoc } from "../lib/util.mjs";

const LANG_PREFIX = "ACKS-FORMATION.HAZARD_ENTRY";
const loc = makeLoc(LANG_PREFIX);

/** The party actor's flag holding the uuids of the places under the party after the last move. */
export const PLACES_UNDER_FLAG = "placesUnder";

/** A Begin button's `data-action`. */
export const BEGIN_ACTION = "hazardEntryBegin";

/** The lang key of the page each crossing kind's setup already cites for its figures. */
const FIGURE_REFS = Object.freeze({ jump: "jumping", swim: "swimming", squeeze: "squeezing" });
const refOf = (key) => game.i18n.localize(`ACKS-FORMATION.crossing.ref.${FIGURE_REFS[key] ?? "spelunking"}`);

/**
 * The places the party token stands in, as `{uuid, name, things}`: the place
 * linked to each Region core says the token is in, in the scene's Region
 * order, each once. Empty where the token, the location feature or a link is
 * missing.
 */
export function placesUnderParty(formation) {
  const token = getPartyToken(formation);
  const scenes = globalThis.acksExtras?.location?.scenes;
  const standing = token?.regions;
  if (!standing?.size || !scenes?.locationOfRegion) return [];
  const out = [];
  for (const region of token.parent?.regions ?? []) {
    if (!standing.has(region)) continue;
    const place = scenes.locationOfRegion(region);
    if (!place || out.some((p) => p.uuid === place.uuid)) continue;
    out.push({ uuid: place.uuid, name: place.name, things: thingsOf(place) });
  }
  return out;
}

/**
 * A synchronous `hazardKeyOf` over the refs these places name. A ref's hazard is
 * read from the document itself: a compendium index holds no `system.key`.
 * A ref that is gone, is no hazard, or fails to load answers null.
 * @returns {Promise<(ref: string) => string|null>}
 */
export async function hazardKeyResolver(places) {
  const keys = new Map();
  await Promise.all(refsOf(places).map(async (ref) => {
    try {
      const item = await fromUuid(ref);
      keys.set(ref, item?.type === HAZARD_ITEM_TYPE ? (item.system?.key || null) : null);
    } catch (err) {
      console.error(`${MODULE_ID} | a hazard could not be read`, ref, err);
      keys.set(ref, null);
    }
  }));
  return (ref) => keys.get(ref) ?? null;
}

/** The card's one row cell of figures, with its tooltip: each figure's param named, and the page the crossing setup cites for them. */
function figuresOf(obstacle) {
  if (!obstacle.figures.length) return { text: "", tip: "" };
  const name = (param) => loc(`param.${param}`);
  const text = obstacle.figures
    .map(({ param, value }) => (value === null ? loc("figureBlank", { param: name(param) }) : loc("figure", { param: name(param), value })))
    .join(" · ");
  const tip = [loc("figureTip", { params: obstacle.figures.map(({ param }) => name(param)).join(", ") }), refOf(obstacle.key)].join(" · ");
  return { text, tip };
}

/** The card's HTML for a model `entryModel` answered, or "" when it holds no place. */
export function entryCard(formation, model) {
  return renderRollCard({
    title: loc("title"),
    subtitle: loc("audience"),
    note: loc("note"),
    labels: { name: loc("colObstacle"), total: loc("colFigures"), actions: loc("colCrossing") },
    sections: model.map((place) => ({
      title: place.name,
      rows: place.obstacles.map((obstacle) => {
        const figures = figuresOf(obstacle);
        return {
          name: obstacle.shape ? loc(`squeezeAs.${obstacle.shape}`) : game.i18n.localize(hazardLabelKey(obstacle.key)),
          detail: obstacle.hidden ? loc("hidden") : undefined,
          total: figures.text,
          tooltipText: figures.tip || undefined,
          actions: [{
            action: BEGIN_ACTION,
            label: loc("begin"),
            tooltip: loc("beginTip"),
            data: { formationId: formation.id, placeUuid: place.uuid, thingId: obstacle.thingId, placeName: place.name },
          }],
        };
      }),
      chips: place.conditions.map((condition) => ({
        label: game.i18n.localize(hazardLabelKey(condition.key)),
        tooltipText: condition.hidden ? loc("hidden") : undefined,
      })),
    })),
  });
}

/**
 * The entry step of one move, run after its trap check. It always keeps
 * `placesUnder` in step with where the party stands, except after a move a wall
 * stopped, whose pulled-back position is the trap check's to settle: that move
 * posts nothing and writes nothing, so the place it did not reach still counts as
 * entered when the party gets there. Posts at most one card, to the Judges.
 *
 * @param {object} formation the stored record
 * @param {{outcome: string|null, results: object[]}|null} check `runTrapCheck`'s answer
 * @returns {Promise<boolean>} whether a card was posted
 */
export async function runEntryStep(formation, check) {
  const actor = getPartyActor(formation);
  if (!actor || moveHalted(check)) return false;
  const under = placesUnderParty(formation);
  const now = under.map((p) => p.uuid);
  const before = actor.getFlag(MODULE_ID, PLACES_UNDER_FLAG);
  const entered = newlyEntered(now, before);
  const changed = !Array.isArray(before) || before.length !== now.length || before.some((uuid, i) => uuid !== now[i]);
  if (changed) await actor.setFlag(MODULE_ID, PLACES_UNDER_FLAG, now);

  const mode = travelOf(formation).mode;
  if (!entered.length || mode === "journey" || mode === "settlement") return false;
  const model = entryModel(under, await hazardKeyResolver(under), entered);
  const content = model.length ? entryCard(formation, model) : "";
  if (!content) return false;
  await postToJudges({ content, speaker: { alias: formation.name } });
  return true;
}

/**
 * A press on a card's Begin: the crossing that obstacle seeds, from every
 * place the party stands in now. With a crossing open the Judge is asked
 * whether to end it first; the press is refused if that crossing changed while
 * the question stood. A seat that is no GM does nothing, and a party in journey
 * or settlement mode begins no crossing.
 *
 * @returns {Promise<{ok: boolean, refused?: string}>}
 */
export async function pressBegin({ formationId, placeUuid, thingId, placeName = "" }) {
  if (!game.user.isGM) return { ok: false, refused: "seat" };
  const formation = getFormation(formationId);
  if (!formation) return { ok: false, refused: "formation" };

  const mode = travelOf(formation).mode;
  if (mode === "journey" || mode === "settlement") {
    ui.notifications.warn(loc("warn.mode"));
    return { ok: false, refused: "mode" };
  }

  // The places are read as the press is made and again once the question is
  // answered, so what seeds the crossing is where the party stands at the end.
  const seedNow = async () => {
    const under = placesUnderParty(formation);
    if (!under.some((p) => p.uuid === placeUuid)) {
      ui.notifications.warn(loc("warn.left", { place: placeName }));
      return { refused: "left" };
    }
    const entry = seedForThing(under, await hazardKeyResolver(under), placeUuid, thingId, { penaltyPicks: penaltyPicksOf(waterPenaltySteps()) });
    if (!entry) {
      ui.notifications.warn(loc("warn.gone", { place: placeName }));
      return { refused: "gone" };
    }
    return { entry };
  };
  let seeded = await seedNow();
  if (!seeded.entry) return { ok: false, refused: seeded.refused };

  const open = readCrossing(formation);
  if (open) {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
      window: { title: loc("confirm.title") },
      content: `<p>${foundry.utils.escapeHTML(loc("confirm.body", { open: game.i18n.localize(hazardLabelKey(open.kind) ?? ""), next: game.i18n.localize(hazardLabelKey(seeded.entry.kind) ?? "") }))}</p>`,
      yes: { label: loc("confirm.endAndBegin"), callback: () => true },
      no: { label: loc("confirm.cancel"), callback: () => false },
      rejectClose: false,
    }).catch(() => false);
    if (confirmed !== true) return { ok: false, refused: "cancelled" };
    if (readCrossing(getFormation(formationId) ?? formation)?.id !== open.id) {
      ui.notifications.warn(loc("warn.changed"));
      return { ok: false, refused: "changed" };
    }
    seeded = await seedNow();
    if (!seeded.entry) return { ok: false, refused: seeded.refused };
    await endCrossing(getFormation(formationId) ?? formation);
  }

  const fresh = getFormation(formationId) ?? formation;
  const id = await beginCrossing(fresh, seeded.entry.kind, { seed: seeded.entry.setup });
  if (!id) {
    ui.notifications.warn(loc("warn.refused"));
    return { ok: false, refused: "refused" };
  }
  getPartyActor(fresh)?.sheet?.render(true);
  return { ok: true };
}

/** Bind a rendered card's Begin buttons, for a GM's seat only. */
export function bindEntryCard(html) {
  if (!game.user?.isGM) return;
  const root = elementOf(html);
  if (!root) return;
  for (const button of root.querySelectorAll(`[data-action="${BEGIN_ACTION}"]`)) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      button.disabled = true;
      pressBegin({ formationId: button.dataset.formationId, placeUuid: button.dataset.placeUuid, thingId: button.dataset.thingId, placeName: button.dataset.placeName })
        .then(() => { button.disabled = false; })
        .catch((err) => {
          button.disabled = false;
          console.error(`${MODULE_ID} | a crossing could not be begun from the entry card`, err);
        });
    });
  }
}

let registered = false;

/** Register the card's one hook. Once, at `init`. */
export function registerHazardEntry() {
  if (registered) return;
  registered = true;
  Hooks.on("renderChatMessageHTML", (_message, html) => bindEntryCard(html));
}
