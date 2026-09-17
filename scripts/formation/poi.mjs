/* global game, ui, foundry, fromUuidSync, Hooks, Actor, ChatMessage */
/**
 * Points of interest — the half that needs a scene.
 *
 * Static points are place tokens and belong to the location feature; what
 * lives here is what the CITY does with them: the marker an incident leaves
 * behind, its expiry on the world clock, its promotion into a place, and the
 * hop from the party's spot to a point of interest priced by the imported
 * district-travel figures instead of by the drag. The decisions are
 * [poi-logic.mjs](./poi-logic.mjs)'s; this file finds the scene, writes the
 * documents and talks to the Judge.
 *
 * The location feature is reached through its api rather than imported: it
 * publishes at ready, everything here runs later, and an import in this
 * direction would close a cycle the module graph already carries the other
 * way (`location/here.mjs` reads this feature's `partyPoint`).
 */
import { MODULE_ID, TURN_SECONDS } from "./constants.mjs";
import { makeLoc, gmIds } from "../lib/util.mjs";
import { getDoc, hasDoc } from "../lib/tables.mjs";
import { getFormation, patchFormation } from "./formation-model.mjs";
import { partyPoint, regionOutlines } from "./zones.mjs";
import { districtAt } from "./district-zone.mjs";
import { SETTLEMENT_DOC, SETTLEMENT_PACES, settlementOf } from "./settlement.mjs";
import { travelOf } from "./travel.mjs";
import { joinTolerance } from "../battlemap/roads.mjs";
import { LOCATION_TYPE } from "../location/constants.mjs";
import {
  districtRelation, expiredNoteIds, noteLabel, poiTravelTurns, promotedPlaceData,
  ringsTouch, transientNoteData, transientOf,
} from "./poi-logic.mjs";

const loc = makeLoc("ACKS-FORMATION");

/** World setting: how many city turns an incident marker outlives its turn. 0 drops none. */
export const SETTING_TRANSIENT_TURNS = "transientIncidentTurns";

/**
 * The token-update option marking a move THIS feature made. The movement hook
 * skips it: the hop was priced by the printed figure before the token moved,
 * and pricing the drag as well would charge the walk twice.
 */
export const TRAVEL_OPTION = `${MODULE_ID}.poiTravel`;

/** Core's own glyphs: the hazard for a marker, the house for a place made from one. */
const INCIDENT_ICON = "icons/svg/hazard.svg";
const PLACE_ICON = "icons/svg/house.svg";

const worldNow = () => Math.floor(Number(game.time?.worldTime) || 0);

/** The location feature's api, read late — see the file header. */
const locationApi = () => globalThis.acksExtras?.location ?? null;

/* -------------------------------------------- */
/*  Transient markers                           */
/* -------------------------------------------- */

/**
 * Drop a Judge-only marker where the party stands, for an incident the street
 * just produced. Silent when the setting is off, when the incident has no
 * text, or when the party has no token to stand anywhere.
 * @returns {Promise<NoteDocument|null>}
 */
export async function dropIncidentNote(formation, { text, source = "city", table = "" } = {}, { regionUuid = null } = {}) {
  const turns = Math.floor(Number(game.settings.get(MODULE_ID, SETTING_TRANSIENT_TURNS)) || 0);
  if (turns <= 0 || !text) return null;
  const at = partyPoint(formation);
  if (!at) return null;
  const data = transientNoteData({
    x: at.point.x, y: at.point.y, text, now: worldNow(), turns, turnSeconds: TURN_SECONDS, icon: INCIDENT_ICON,
    source, table, formationId: formation.id, regionUuid,
  });
  const [note] = await at.scene.createEmbeddedDocuments("Note", [data]);
  return note ?? null;
}

/**
 * Every transient marker in the world whose time is up, removed. Registered on
 * the world-clock watcher, so it runs on the one GM client that owns the
 * calendar; idempotent, because a marker deleted once is not there twice.
 * @returns {Promise<number>} how many were removed
 */
export async function expireTransientNotes(now = worldNow()) {
  let removed = 0;
  for (const scene of game.scenes ?? []) {
    const ids = expiredNoteIds([...(scene.notes ?? [])], now);
    if (!ids.length) continue;
    await scene.deleteEmbeddedDocuments("Note", ids);
    removed += ids.length;
  }
  return removed;
}

/** The transient markers on a scene. */
export const transientNotesOn = (scene) => [...(scene?.notes ?? [])].filter((n) => transientOf(n));

/**
 * Turn a marker into a place: a location actor under the quarter's place
 * (else the city's, else nothing), its token where the marker stood, and the
 * marker gone. The marker's own text becomes the place's notes.
 * @returns {Promise<Actor|null>}
 */
export async function promoteIncident(note, { name = "" } = {}) {
  const t = transientOf(note);
  const scene = note?.parent;
  if (!t || !scene || !game.user.isGM) return null;
  const scenes = locationApi()?.scenes;
  const region = t.regionUuid ? fromUuidSync(t.regionUuid) : null;
  const parent = (region ? scenes?.locationOfRegion?.(region) : null) ?? scenes?.locationOfScene?.(scene) ?? null;
  const actor = await Actor.create(promotedPlaceData({
    name: name || noteLabel(t.text) || loc("settlement.poi.promotedDefault"),
    text: t.text,
    parentUuid: parent?.uuid ?? "",
    img: PLACE_ICON,
  }));
  if (!actor) return null;
  // A note's x/y is its centre; a token's is its top-left corner.
  const gs = scene.grid.size;
  const tokenDoc = await actor.getTokenDocument({ x: note.x - gs / 2, y: note.y - gs / 2 });
  await scene.createEmbeddedDocuments("Token", [tokenDoc.toObject()]);
  await note.delete();
  return actor;
}

/**
 * The card's one button. Bound on render rather than inline, because chat
 * content is markup and a handler has to be attached to the element core
 * builds from it.
 */
export function installIncidentCardActions() {
  Hooks.on("renderChatMessageHTML", (_message, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root || !game.user?.isGM) return;
    for (const button of root.querySelectorAll(".acks-extras-poi-promote")) {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        promoteFromCard(button).catch((err) => console.error(`${MODULE_ID} | promote incident failed`, err));
      });
    }
  });
}

async function promoteFromCard(button) {
  const note = fromUuidSync(button.dataset.noteUuid ?? "");
  const t = transientOf(note);
  if (!t) return void ui.notifications.warn(loc("settlement.poi.markerGone"));
  const name = await askName(noteLabel(t.text));
  if (name == null) return;
  const actor = await promoteIncident(note, { name });
  if (!actor) return;
  button.disabled = true;
  ui.notifications.info(loc("settlement.poi.promoted", { name: actor.name }));
  actor.sheet?.render(true);
}

async function askName(initial) {
  const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
  const name = await foundry.applications.api.DialogV2.prompt({
    window: { title: loc("settlement.poi.promoteTitle") },
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
    content: `<div class="form-group"><label>${esc(loc("settlement.poi.promoteName"))}
      <input type="text" name="name" value="${esc(initial)}"></label></div>`,
    ok: { callback: (_event, button) => button.form.elements.name.value.trim() },
  }).catch(() => null);
  return name ?? null;
}

/* -------------------------------------------- */
/*  Going to a point of interest                */
/* -------------------------------------------- */

/** The place tokens on the party's map: what a hop can be made to. */
export function poiTargets(formation) {
  const at = partyPoint(formation);
  if (!at) return [];
  return (locationApi()?.here?.placesOnScene?.(at.scene) ?? []).filter((t) => t.id !== at.token.id);
}

/** Do two regions meet along a boundary, at the scene's own join tolerance? */
export const regionsTouch = (a, b, scene) => ringsTouch(regionOutlines(a), regionOutlines(b), joinTolerance(scene));

/**
 * Walk the party to a point of interest for the printed price.
 *
 * The clock is spent FIRST, through the ordinary tick — a hop of two turns is
 * two street turns, thrown for as any two are — and only then is the token
 * moved, with the option the movement hook skips, so the drag is not priced a
 * second time by distance. The clock's baseline moves with the token for the
 * same reason: the next real drag must measure from where the party now
 * stands, not from where it was before the hop.
 *
 * @returns {Promise<{moved: boolean, reason?: string, relation?: string,
 *   turns?: number, place?: string}>} `reason` names what refused: no such
 *   target, an unpriced relation, or a missing figure.
 */
export async function travelToPlace(formationId, tokenId) {
  const formation = getFormation(formationId);
  const at = formation ? partyPoint(formation) : null;
  const target = at?.scene.tokens.get(tokenId) ?? null;
  if (!at || !target || target.actor?.type !== LOCATION_TYPE) return { moved: false, reason: "noTarget" };

  const gs = at.scene.grid.size;
  const to = { x: target.x + (target.width * gs) / 2, y: target.y + (target.height * gs) / 2 };
  const from = districtAt(at.scene, at.point, at.elevation);
  const dest = districtAt(at.scene, to, target.elevation ?? 0);
  const relation = districtRelation(from?.region ?? null, dest?.region ?? null, {
    touch: (a, b) => regionsTouch(a, b, at.scene),
  });
  const board = settlementOf(travelOf(formation));
  const pace = SETTLEMENT_PACES[board.pace] ? board.pace : "meandering";
  const figures = hasDoc(SETTLEMENT_DOC) ? (getDoc(SETTLEMENT_DOC)?.tables?.districtTravel ?? null) : null;
  const cost = poiTravelTurns(figures, relation, pace);
  if (cost.turns == null) return { moved: false, reason: cost.missing, relation };

  if (cost.turns > 0) {
    // Loaded late: the turn engine imports the city tick, which will import
    // the marker drop above, and a static edge here would close that loop.
    const { advanceTurns } = await import("./turn-engine.mjs");
    await advanceTurns(formation, cost.turns, { reason: "action" });
  }
  // Re-read after the tick: it wrote the record, and may have resized the token.
  const after = getFormation(formationId);
  const party = after ? partyPoint(after)?.token : null;
  if (!party) return { moved: false, reason: "noTarget", relation };
  // Whole pixels: a token's position is stored as integers, and the baseline
  // must be the position the token actually holds, or the next drag starts
  // half a pixel from where the party stands.
  const x = Math.round(to.x - (party.width * gs) / 2);
  const y = Math.round(to.y - (party.height * gs) / 2);
  await party.update({ x, y }, { animate: false, [TRAVEL_OPTION]: true });
  await patchFormation(formationId, (rec) => {
    rec.clock = { ...(rec.clock ?? {}), lastPosition: { x: party.x, y: party.y } };
  });
  return { moved: true, turns: cost.turns, relation, place: target.name };
}

/**
 * The Judge picks a point of interest on the party's map; the hop is made and
 * reported — a whispered line for a walk that happened, a warning for one
 * that could not be priced.
 */
export async function pickAndTravel(formationId) {
  const formation = getFormation(formationId);
  const targets = formation ? poiTargets(formation) : [];
  if (!targets.length) return void ui.notifications.warn(loc("settlement.poi.noTargets"));
  const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
  const options = targets.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("");
  const tokenId = await foundry.applications.api.DialogV2.prompt({
    window: { title: loc("settlement.poi.travelTitle") },
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
    content: `<div class="form-group"><label>${esc(loc("settlement.poi.travelPick"))}
      <select name="tokenId">${options}</select></label>
      <p class="hint">${esc(loc("settlement.poi.travelHint"))}</p></div>`,
    ok: { callback: (_event, button) => button.form.elements.tokenId.value },
  }).catch(() => null);
  if (!tokenId) return null;
  const result = await travelToPlace(formationId, tokenId);
  await reportHop(result);
  return result;
}

async function reportHop(result) {
  if (!result.moved) {
    const key = { noTarget: "noTarget", table: "unpriced", pace: "unpricedPace" }[result.reason] ?? result.relation ?? "noTarget";
    ui.notifications.warn(loc(`settlement.poi.refused.${key}`));
    return;
  }
  const line = loc(result.turns > 0 ? "settlement.poi.arrived" : "settlement.poi.arrivedFree", {
    place: result.place, turns: result.turns, relation: loc(`settlement.poi.relation.${result.relation}`),
  });
  await ChatMessage.create({
    speaker: { alias: loc("settlement.card.speaker") },
    whisper: gmIds(),
    content: `<div class="acks-extras-settlement-card"><ul><li>${line}</li></ul></div>`,
  });
}
