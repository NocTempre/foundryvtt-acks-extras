/* global game, ui, foundry, Hooks, Roll, ChatMessage, fromUuidSync */
/**
 * A hex's stock, read and written: the half of the hex stock that touches the
 * map, the dice and the Judge. The procedure is [hex-stock.mjs](./hex-stock.mjs);
 * this file finds the hex, keeps the record on the scene, rolls the survey and
 * talks through dialogs and chat cards.
 *
 * The stock lives in one scene flag, `flags["acks-extras"].hexStock`, keyed by
 * `hexStockKey`. Every write names exactly one key of it, so two hexes never
 * share an update. The record under a key is written as a forced replacement
 * and cleared with a forced deletion: an ordinary update merges, which keeps a
 * restocked hex's old finds and search credit standing.
 *
 * The hex is the TRUE hex. A party that is lost is standing somewhere other
 * than its marker, and a stock read at the believed position would hand the
 * Judge's map the wrong cell: the position comes from the party's true-position
 * token when an episode keeps one, else from its own token.
 */
import { MODULE_ID } from "./constants.mjs";
import { makeLoc, gmIds, elementOf, unset } from "../lib/util.mjs";
import { hexLabelFromOffset, isHexScene, paintedTerrainAt } from "../battlemap/terrain-paint.mjs";
import { readTable } from "../vehicles/vehicle-speed.mjs";
import { getFormation, getPartyScene, hasAbility, realMembers } from "./formation-model.mjs";
import { hasCapability } from "./ability-bridge.mjs";
import { TERRITORY_KEYS, travelOf } from "./travel.mjs";
import { lostOf } from "./lost.mjs";
import { episodeScene } from "./lost-episode.mjs";
import { truePositionToken } from "./shadow.mjs";
import { ENCOUNTERS_DOC, ENCOUNTER_TERRAINS, encounterTerrainFor } from "./encounters.mjs";
import { surveyOutcome, surveySpec } from "./searching.mjs";
import { announce } from "./announce.mjs";
import { placeTokenAt } from "./poi.mjs";
import {
  creditSearch, falseCount, hexStockKey, markFound, recordAssessment, stockHex, stockSummary, unfoundPoints,
} from "./hex-stock.mjs";

const loc = makeLoc("ACKS-FORMATION");

/** The scene flag every hex's stock is kept under. */
export const STOCK_FLAG = "hexStock";

/** The template the stocking dialog renders. */
const DIALOG_TEMPLATE = `modules/${MODULE_ID}/templates/formation/hex-stock-dialog.hbs`;

const worldNow = () => Number(game.time?.worldTime) || 0;
const hasOwn = (obj, key) => !!obj && Object.hasOwn(obj, key);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const flagPath = (key) => `flags.${MODULE_ID}.${STOCK_FLAG}.${key}`;

/* -------------------------------------------- */
/*  Where the party really is                   */
/* -------------------------------------------- */

/**
 * The hex the party really stands in: `{ scene, key, label, center, offset,
 * astray }`, or null when there is no scene or no key to file a stock under.
 *
 * On a hex scene the cell comes from the true-position token's centre; on any
 * other scene, or with no token, the key is the journey's typed hex label and
 * `center` and `offset` are null. `astray` is true while a lost episode is
 * walking the party somewhere its marker does not say.
 */
export function trueHexOf(formation) {
  const scene = episodeScene(formation) ?? getPartyScene(formation);
  if (!scene) return null;
  const astray = lostOf(travelOf(formation)).active;
  const token = truePositionToken(scene, formation);
  if (token && isHexScene(scene)) {
    const gs = scene.grid.size;
    const center = { x: token.x + (token.width * gs) / 2, y: token.y + (token.height * gs) / 2 };
    const offset = scene.grid.getOffset(center);
    const key = hexStockKey({ offset });
    if (key) return { scene, key, label: hexLabelFromOffset(offset), center, offset, astray };
  }
  const label = travelOf(formation).hex.label;
  const key = hexStockKey({ label });
  return key ? { scene, key, label, center: null, offset: null, astray } : null;
}

/* -------------------------------------------- */
/*  The record on the scene                     */
/* -------------------------------------------- */

/** The stock record under `key` on `scene`, or null. */
export function readStock(scene, key) {
  return scene?.getFlag?.(MODULE_ID, STOCK_FLAG)?.[key] ?? null;
}

/** Write one hex's record, replacing whatever stood under its key. */
export function writeStock(scene, key, record) {
  return scene.update({ [flagPath(key)]: foundry.data.operators.ForcedReplacement.create(record) });
}

/** Delete one hex's record and nothing else under the flag. */
export function clearStock(scene, key) {
  return scene.update({ [flagPath(key)]: unset() });
}

/** Read the record, run `edit` over it, write the result back; null when the hex is not stocked. */
async function amendStock(formation, edit) {
  const here = trueHexOf(formation);
  const record = here ? readStock(here.scene, here.key) : null;
  if (!record?.stocked) return null;
  const next = edit(record, here);
  if (!next) return null;
  await writeStock(here.scene, here.key, next);
  return next;
}

/* -------------------------------------------- */
/*  Stocking                                    */
/* -------------------------------------------- */

/**
 * Roll a stock for the formation's true hex from dialog inputs and keep it.
 * `terrain` is an encounter-terrain pick (its lairs row is resolved here),
 * `judgeCount` a count typed by the Judge, and `rng` an optional [0, 1)
 * source. Resolves `{ ok: true, record, key }` once written, `{ ok: false,
 * noScene: true }` with no hex to file it under, or the pure procedure's
 * refusal untouched (`needsCount`, `needsSubstitution`).
 */
export async function stockFromInputs(formation, { terrain, territory, substitute, judgeCount, rng } = {}) {
  const here = trueHexOf(formation);
  if (!here) return { ok: false, noScene: true };
  const result = stockHex({
    row: ENCOUNTER_TERRAINS[terrain]?.lairs ?? null,
    terrain, territory, substitute, judgeCount,
    ...(rng ? { rng } : {}),
    now: worldNow(),
    mintId: foundry.utils.randomID,
    label: here.label,
  });
  if (!result.ok) return result;
  await writeStock(here.scene, here.key, result.record);
  return { ok: true, record: result.record, key: here.key };
}

/**
 * The pick the dialog opens on: the journey's own, else what the TRUE hex is
 * painted (its own pick at the book's grain, or the one its ground answers
 * for), else the one the journey's ground answers for.
 */
function defaultTerrain(formation, here) {
  const t = travelOf(formation);
  if (ENCOUNTER_TERRAINS[t.encounterTerrain]) return t.encounterTerrain;
  const painted = here.center ? paintedTerrainAt(here.scene, here.center) : null;
  if (painted?.encounterTerrain) return painted.encounterTerrain;
  return encounterTerrainFor(painted?.ground ?? t.ground);
}

/** The dialog's template context for the given field values. */
function dialogContext(values, needs) {
  const dice = readTable(ENCOUNTERS_DOC, "lairsPerHex");
  const rowDice = (key) => {
    const row = ENCOUNTER_TERRAINS[key]?.lairs ?? null;
    return row == null ? null : (dice?.[row] ?? null);
  };
  const dicePicked = rowDice(values.terrain);
  return {
    seed: foundry.utils.randomID(),
    terrains: Object.entries(ENCOUNTER_TERRAINS).map(([key, cfg]) => ({
      key,
      label: rowDice(key) ? `${game.i18n.localize(cfg.label)} (${rowDice(key)})` : game.i18n.localize(cfg.label),
      selected: key === values.terrain,
    })),
    territories: TERRITORY_KEYS.map((key) => ({
      key, label: loc(`travel.territory.${key}`), selected: key === values.territory,
    })),
    substitute: !!values.substitute,
    count: values.judgeCount ?? "",
    dice: dicePicked,
    countRequired: !!needs || dicePicked == null,
    needsCount: !!needs?.needsCount,
  };
}

/** One pass of the stocking dialog; the picked inputs, or `false` on cancel. */
async function askStockInputs(values, needs) {
  const content = await foundry.applications.handlebars.renderTemplate(DIALOG_TEMPLATE, dialogContext(values, needs));
  return foundry.applications.api.DialogV2.wait({
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
    window: { title: loc("hexStock.dialog.title"), icon: "fa-solid fa-map-location-dot" },
    content,
    buttons: [
      {
        action: "stock", label: loc("hexStock.dialog.submit"), default: true,
        callback: (_event, button) => {
          const f = button.form.elements;
          const typed = String(f.judgeCount?.value ?? "").trim();
          return {
            terrain: f.terrain.value,
            territory: f.territory.value,
            substitute: !!f.substitute?.checked,
            judgeCount: typed === "" ? null : Number(typed),
          };
        },
      },
      // `false`, never null: core resolves a nullish callback result to the button's action string.
      { action: "cancel", label: loc("hexStock.dialog.cancel"), callback: () => false },
    ],
    rejectClose: false,
  }).catch(() => null);
}

/**
 * The Judge stocks the party's hex: a confirm first when it is already
 * stocked, then the dialog, asked again for a count when the table cannot give
 * one. Resolves the `stockFromInputs` result, or null on a cancel.
 */
export async function openStockDialog(formation) {
  if (!game.user?.isGM) return null;
  const here = trueHexOf(formation);
  if (!here) {
    ui.notifications?.warn(loc("hexStock.noScene"));
    return null;
  }
  if (readStock(here.scene, here.key)?.stocked) {
    const replace = await foundry.applications.api.DialogV2.confirm({
      window: { title: loc("hexStock.restock") },
      content: `<p>${esc(loc("hexStock.restockConfirm", { hex: here.label }))}</p>`,
      rejectClose: false,
    }).catch(() => null);
    if (!replace) return null;
  }
  const t = travelOf(formation);
  let values = { terrain: defaultTerrain(formation, here), territory: t.territory, substitute: false, judgeCount: null };
  let needs = null;
  for (;;) {
    const picked = await askStockInputs(values, needs);
    if (!picked) return null;
    const result = await stockFromInputs(formation, picked);
    if (result.ok || !(result.needsCount || result.needsSubstitution)) return result;
    ui.notifications?.warn(result.needsCount
      ? loc("hexStock.dialog.needsCount")
      : loc("hexStock.unpriced", { what: result.reason }));
    values = picked;
    needs = result;
  }
}

/* -------------------------------------------- */
/*  Points                                      */
/* -------------------------------------------- */

/** Add a point the Judge placed by hand to the party's stocked hex. Resolves the record, or null. */
export function addPlacedPoint(formation, { name = "", note = "" } = {}) {
  return amendStock(formation, (record) => ({
    ...record,
    points: [...record.points, {
      id: foundry.utils.randomID(), kind: "placed", name: String(name ?? ""), sub: null, rarity: null,
      creature: null, draw: null, found: {}, placeUuid: null, note: String(note ?? ""),
    }],
  }));
}

/** Take one point out of the party's stocked hex. Resolves the record, or null. */
export function removePoint(formation, pointId) {
  return amendStock(formation, (record) => ({ ...record, points: record.points.filter((p) => p.id !== pointId) }));
}

/** Mark a point found by this formation, now. Resolves the record, or null. */
export function markPointFound(formation, pointId) {
  return amendStock(formation, (record) => markFound(record, pointId, formation.id, worldNow()));
}

/** Credit this formation with a search throw that beat the target in the party's hex. Resolves the record, or null. */
export function creditSearchHere(formation) {
  return amendStock(formation, (record) => creditSearch(record, formation.id));
}

/**
 * Make a point a place: a location actor with its token at the hex centre,
 * hidden while no formation has found the point. Refused while the party is
 * astray (the centre read is the true hex, and a place made there would
 * announce where the party really is) and when the hex has no centre.
 * Resolves the actor, or null.
 */
export async function placeFromPoint(formation, pointId) {
  if (!game.user?.isGM) return null;
  const here = trueHexOf(formation);
  const record = here ? readStock(here.scene, here.key) : null;
  const point = record?.points?.find((p) => p.id === pointId);
  if (!point) return null;
  if (here.astray) {
    ui.notifications?.warn(loc("hexStock.astray"));
    return null;
  }
  if (!here.center) {
    ui.notifications?.warn(loc("hexStock.noScene"));
    return null;
  }
  if (point.placeUuid && fromUuidSync(point.placeUuid)) {
    ui.notifications?.warn(loc("hexStock.alreadyPlaced"));
    return null;
  }
  const parent = globalThis.acksExtras?.location?.scenes?.locationOfScene?.(here.scene) ?? null;
  const actor = await placeTokenAt({
    scene: here.scene, x: here.center.x, y: here.center.y,
    name: point.name || loc(`hexStock.kinds.${point.kind}`),
    text: point.note ?? "",
    parentUuid: parent?.uuid ?? "",
    hidden: !Object.keys(point.found ?? {}).length,
  });
  if (!actor) return null;
  await writeStock(here.scene, here.key, {
    ...record, points: record.points.map((p) => (p.id === pointId ? { ...p, placeUuid: actor.uuid } : p)),
  });
  return actor;
}

/* -------------------------------------------- */
/*  Land surveying                              */
/* -------------------------------------------- */

/** The first member of the order whose actor holds Land Surveying, or null. */
function surveyorOf(formation) {
  for (const member of realMembers(formation)) {
    const actor = game.actors?.get(member.actorId);
    if (actor && (hasCapability(actor, "kw:landsurveying") || hasAbility(actor, /land\s*surveying/i))) return actor;
  }
  return null;
}

/** A whispered Judge card: a heading, bullet lines, and trailing markup (already escaped). */
function whisperCard(lines, tail = "") {
  return ChatMessage.create({
    speaker: { alias: loc("hexStock.survey.speaker") },
    whisper: gmIds(),
    content: `<div class="acks-extras-search-card"><h3>${esc(loc("hexStock.survey.title"))}</h3>`
      + `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>${tail}</div>`,
  });
}

/** The unmodified die of an evaluated 1d20 roll. */
function naturalOf(roll, modifier) {
  const die = roll.dice?.[0]?.total ?? roll.dice?.[0]?.results?.[0]?.result;
  return Number.isFinite(Number(die)) ? Number(die) : Number(roll.total) - modifier;
}

/**
 * One Land Surveying attempt on the party's stocked hex, whispered to the
 * Judge. The surveyor is the first member of the order with the proficiency
 * and the throw carries the bonus earned by this formation's own successful
 * searches here. A natural 1 reads wrong (`falseCount`; the card asks the
 * Judge when no false count can be rolled), a success reads true, anything
 * else tells nothing and leaves no assessment, so a later hour tries again.
 * With `auto` the attempt is skipped when this formation already holds an
 * assessment. Resolves `{ outcome, told, trustworthy }`, or null when nothing
 * was thrown.
 */
export async function surveyHex(formation, { auto = false } = {}) {
  if (!game.user?.isGM) return null;
  const here = trueHexOf(formation);
  const record = here ? readStock(here.scene, here.key) : null;
  if (!record?.stocked) return null;
  if (auto && record.assessments?.[formation.id]) return null;

  if (!surveyorOf(formation)) {
    await whisperCard([loc("hexStock.noSurveyor")]);
    return null;
  }
  const spec = surveySpec({ priorSuccesses: record.searches?.[formation.id] ?? 0 });
  if (!spec.ok) {
    await whisperCard([loc("hexStock.unpriced", { what: spec.missing })]);
    return null;
  }

  const roll = await new Roll(spec.bonus ? `1d20 + ${spec.bonus}` : "1d20").evaluate();
  const outcome = surveyOutcome({ natural: naturalOf(roll, spec.bonus), total: roll.total, target: spec.target });
  const truth = Array.isArray(record.points) ? record.points.length : (Number(record.count) || 0);

  let told = null;
  let trustworthy = null;
  if (outcome.state === "assessed") {
    told = truth;
    trustworthy = true;
  } else if (outcome.state === "misread") {
    told = falseCount({ record, truth }).n ?? null;
    trustworthy = false;
  }

  const lines = [
    loc("hexStock.survey.throw", { total: roll.total, target: spec.target }),
    loc(`hexStock.survey.${outcome.state}`),
  ];
  let tail = "";
  if (outcome.reveals) {
    lines.push(loc("hexStock.survey.truth", { count: truth }));
    if (told == null) {
      lines.push(loc("hexStock.survey.askJudge"));
    } else {
      lines.push(loc("hexStock.survey.told", { count: told }));
      tail = `<button type="button" class="acks-extras-hex-tell" data-formation-id="${esc(formation.id)}" data-told="${esc(told)}">`
        + `${esc(loc("hexStock.survey.tell"))}</button>`;
    }
    await writeStock(here.scene, here.key, recordAssessment(record, formation.id, { told, trustworthy, at: worldNow() }));
  }
  await whisperCard(lines, tail);
  return { outcome: outcome.state, told, trustworthy };
}

/**
 * Tell the party what the surveyor reckons: one public line, the same shape
 * whether the count is true or false. Resolves true once posted, false when
 * the formation is gone.
 */
export async function tellParty(formationId, told) {
  const formation = getFormation(formationId);
  if (!formation) return false;
  await announce(formation, loc("hexStock.survey.public", { count: Number(told) }));
  return true;
}

/* -------------------------------------------- */
/*  Chat-card buttons                           */
/* -------------------------------------------- */

/**
 * Bind the survey card's Tell the party button and a candidate list's Found
 * button on render. GM only, because both write the map. Bound on render
 * rather than inline: chat content is markup, and a handler has to be
 * attached to the element core builds from it.
 */
export function installHexStockCardActions() {
  Hooks.on("renderChatMessageHTML", (_message, html) => {
    const root = elementOf(html);
    if (!root || !game.user?.isGM) return;
    const bind = (selector, run) => {
      for (const button of root.querySelectorAll(selector)) {
        button.addEventListener("click", (event) => {
          event.preventDefault();
          Promise.resolve(run(button))
            .then(() => { button.disabled = true; })
            .catch((err) => console.error(`${MODULE_ID} | hex stock card action failed`, err));
        });
      }
    };
    bind(".acks-extras-hex-tell", (button) => tellParty(button.dataset.formationId, button.dataset.told));
    bind(".acks-extras-hex-found", (button) => {
      const formation = getFormation(button.dataset.formationId);
      return formation ? markPointFound(formation, button.dataset.pointId) : null;
    });
  });
}

/* -------------------------------------------- */
/*  The panel's view                            */
/* -------------------------------------------- */

/**
 * The "This hex" block's view model, or null for a player. `points` carry
 * `found` for THIS formation and `foundByAny` for any; a hex with no scene or
 * no key reads `noScene` and an empty summary.
 */
export function hexStockView(formation) {
  if (!game.user?.isGM) return null;
  const here = trueHexOf(formation);
  const record = here ? readStock(here.scene, here.key) : null;
  const points = (record?.points ?? []).map((p) => ({
    id: p.id,
    kind: p.kind,
    kindLabel: loc(`hexStock.kinds.${p.kind}`),
    name: p.name ?? "",
    found: hasOwn(p.found, formation.id),
    foundByAny: Object.keys(p.found ?? {}).length > 0,
    placeUuid: p.placeUuid ?? null,
    note: p.note ?? "",
  }));
  return {
    key: here?.key ?? null,
    label: here?.label ?? "",
    noScene: !here,
    astray: here?.astray ?? lostOf(travelOf(formation)).active,
    summary: stockSummary(record),
    stocked: record?.stocked === true,
    points,
    unfound: unfoundPoints(record, formation.id).length,
    canSurvey: !!surveyorOf(formation),
    assessed: record?.assessments?.[formation.id] ?? null,
  };
}
