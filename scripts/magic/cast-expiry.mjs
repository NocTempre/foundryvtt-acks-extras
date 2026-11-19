/* global game, ChatMessage, Hooks, fromUuidSync */
/**
 * When a summoning's cast runs out. A cast leaves a record on its caster
 * (`spell-effect.mjs`) whose duration is the spell's imported one
 * (`cast-duration.mjs`); once the world clock passes the record's end, the
 * caster's owners and the GMs get one whispered card saying so, with a Judge's
 * Dismiss button for the creatures that cast left standing. What becomes of
 * the creatures is the spell's row's word (`cast-control.mjs`), applied by the
 * clock's window: creatures that go are removed by the cast's own recorded
 * tokens and no card is posted; creatures that stay or turn hostile stay until
 * a Judge presses Dismiss.
 *
 * The end is this file's own reading of the record, start time plus duration
 * on the world clock, never core's `duration.expired`. A `rounds` record counts
 * its rounds at `ROUND_SECONDS`; a record with no duration never ends here.
 * Only a step of the clock decides, read on the one window that runs the
 * automation (`onWorldTimeAdvanced`).
 *
 * The record is stamped `ended` before the card is made, so a second step of
 * the clock, a reload or a second GM window finds it closed; a record whose
 * creatures were all dismissed already is stamped and posts nothing.
 *
 * A record the engine timed itself (`spell-effect.mjs`: its duration and start
 * ride in the flag) is not announced: when the clock reaches its end the record
 * is deleted by id, whichever actor or unlinked token carries it, so a status
 * it held ends with it and a second record of the same cast keeps its own.
 *
 * See docs/magic/DECISIONS.md, "A cast's end is told on a card, read from the
 * module's own clock math".
 */
import { MODULE_ID, LANG_PREFIX, FLAG_SPELL_EFFECT } from "./constants.mjs";
import { spellEffectOf } from "./spell-effect.mjs";
import { TURN_SECONDS, ROUNDS_PER_TURN } from "../lib/constants.mjs";
import { summonerOf, summonRecordOf, summonOwnership } from "../lib/summons-logic.mjs";
import { onWorldTimeAdvanced } from "../lib/world-time.mjs";
import { castSummons } from "../lib/summons.mjs";
import { worldActors } from "../lib/repair.mjs";
import { docOf, escape as esc } from "../lib/util.mjs";

/** Seconds in one combat round on the world clock: a dungeon turn's seconds over its rounds, both structural. */
export const ROUND_SECONDS = TURN_SECONDS / ROUNDS_PER_TURN;

/** The chat-message flag a cast-ended card carries: `{casterUuid, castId}`. */
export const CAST_ENDED_FLAG = "castEnded";

/** The attribute the card's Dismiss button carries. */
const DISMISS_ATTR = "data-acks-extras-cast-dismiss";

/**
 * The world time a cast record's duration ends at, or null when the clock
 * cannot reach it: no start, no finite duration, or a unit `secondsOf` does not
 * answer for. A record the engine timed carries its own duration and start in
 * its flag, and those are read first; any other reads core's stored duration,
 * never its prepared one.
 * @param {object} effect  the record, an Active Effect document or its plain data
 * @param {(value: number, units: string) => number|null} secondsOf  a calendar
 *   duration in seconds, by the world's calendar
 * @returns {number|null}
 */
export function castRecordEnd(effect, secondsOf) {
  const mark = effect?.flags?.[MODULE_ID]?.[FLAG_SPELL_EFFECT];
  const own = mark?.duration && mark?.startTime != null;
  const time = own ? mark.startTime : (effect?._source?.start ?? effect?.start)?.time;
  const start = Number(time);
  const { value, units } = own ? mark.duration : (effect?._source?.duration ?? effect?.duration ?? {});
  const n = Number(value);
  if (time == null || time === "" || !Number.isFinite(start) || value == null || !Number.isFinite(n) || !units) return null;
  const seconds = units === "rounds" ? n * ROUND_SECONDS : units === "turns" ? null : secondsOf?.(n, units);
  return Number.isFinite(seconds) ? start + seconds : null;
}

/**
 * Has this record's cast run out and not yet been announced? Only a caster's
 * record is announced; a recipient's carries the same cast and would say it
 * twice.
 * @param {object} effect
 * @param {{worldTime: number, secondsOf: Function}} o
 */
export function castEnded(effect, { worldTime, secondsOf }) {
  const record = spellEffectOf(effect);
  if (record?.role !== "caster" || record.ended != null) return false;
  const end = castRecordEnd(effect, secondsOf);
  return end != null && Number(worldTime) >= end;
}

/**
 * What the clock does to a record whose cast has run out: `announce` for a
 * caster's record that core times (a summoning's, told on a card), `delete` for
 * a record the engine timed itself, and null for a record still running, one
 * already stamped and one no cast made.
 * @param {object} effect
 * @param {{worldTime: number, secondsOf: Function}} o
 * @returns {"announce"|"delete"|null}
 */
export function endAction(effect, { worldTime, secondsOf }) {
  const record = spellEffectOf(effect);
  if (!record || record.ended != null) return null;
  const end = castRecordEnd(effect, secondsOf);
  if (end == null || !(Number(worldTime) >= end)) return null;
  if (record.duration && record.startTime != null) return "delete";
  return record.role === "caster" ? "announce" : null;
}

/**
 * The tokens one cast left standing, on every scene given: those whose actor
 * names the caster as summoner and whose record carries the cast's id.
 * @param {Iterable<{tokens: Iterable<object>}>} scenes
 * @param {string} casterUuid
 * @param {string} castId
 * @returns {object[]} the token documents
 */
export function castTokens(scenes, casterUuid, castId) {
  const out = [];
  for (const scene of scenes ?? []) {
    for (const t of scene?.tokens ?? []) if (summonerOf(t.actor) === casterUuid && summonRecordOf(t.actor)?.castId === castId) out.push(t);
  }
  return out;
}

/**
 * Who the card is whispered to: every GM, and every other user who owns the
 * caster (`summonOwnership`, the same set that owns the summons).
 * @param {object} ownership  the caster's ownership map
 * @param {string[]} gmIds
 * @param {(id: string) => boolean} isGM
 * @returns {string[]} user ids
 */
export function castEndedRecipients(ownership, gmIds, isGM) {
  return [...new Set([...(gmIds ?? []), ...Object.keys(summonOwnership(ownership, [], isGM))])];
}

/** Records being announced on this window, by uuid: a second step of the clock before the stamp lands passes them by. */
const announcing = new Set();

/**
 * Announce one record's end: stamp it, then, where its cast still has
 * creatures standing, end their control as the spell's row says (`control`)
 * and post the card. Creatures that went with it leave nothing to announce, so
 * no card is posted for them; creatures that stay or turned hostile keep their
 * card. Answers what it did.
 * @param {object} effect  the caster's record
 * @param {object} deps
 * @param {number} deps.worldTime
 * @param {(effect: object, worldTime: number) => Promise<unknown>} deps.stamp
 * @param {(record: object) => object[]|{tokens: object[], held?: object[]}} deps.standing  what the cast
 *   left standing: its tokens, or its tokens and its held summons (those riding in a party token)
 * @param {(o: {effect: object, record: object, tokens: object[], held: object[], outcome: string|null}) => Promise<unknown>} deps.post
 * @param {(record: object) => Promise<{ok: boolean, outcome?: string}|null>} [deps.control]  the GM's client ends the
 *   creatures' control as the spell's row says, answering the outcome it applied; null where nothing was applied
 * @returns {Promise<{posted: boolean, reason?: string, n?: number, outcome?: string}>}
 */
export async function announceEndedCast(effect, { worldTime, stamp, standing, post, control }) {
  const record = spellEffectOf(effect);
  if (record?.role !== "caster" || record.ended != null) return { posted: false, reason: "closed" };
  const key = effect.uuid ?? effect.id ?? record.castId;
  if (announcing.has(key)) return { posted: false, reason: "closed" };
  announcing.add(key);
  try {
    await stamp(effect, worldTime);
    const found = standing(record);
    const tokens = Array.isArray(found) ? found : (found?.tokens ?? []);
    const held = Array.isArray(found) ? [] : (found?.held ?? []);
    const n = tokens.length + held.length;
    if (!n) return { posted: false, reason: "noneStanding" };
    const done = await control?.(record);
    const outcome = done?.ok ? done.outcome : null;
    // Creatures that went leave nothing to announce, unless some could not be removed (a stash with no roster release): those keep the card.
    if (outcome === "gone" && !(done.unapplied > 0)) return { posted: false, reason: "gone", n, outcome };
    await post({ effect, record, tokens, held, outcome });
    return { posted: true, n, ...(outcome ? { outcome } : {}) };
  } finally {
    announcing.delete(key);
  }
}

/**
 * Settle every record of the given actors whose cast has run out: announce a
 * caster's core-timed record, delete an engine-timed one by id through
 * `deps.remove`. A record that fails is logged and the rest go on.
 * @param {Iterable<object>} actors
 * @param {object} deps  `announceEndedCast`'s, with `secondsOf` and `remove(effect)`
 * @returns {Promise<Array<{posted: boolean, reason?: string, n?: number}|{deleted: true, uuid: string}>>}
 */
export async function sweepEndedCasts(actors, deps) {
  const out = [];
  for (const actor of actors ?? []) {
    for (const effect of actor?.effects ?? []) {
      const action = endAction(effect, deps);
      if (!action) continue;
      try {
        if (action === "delete") {
          await deps.remove?.(effect);
          out.push({ deleted: true, uuid: effect.uuid });
        } else out.push(await announceEndedCast(effect, deps));
      } catch (err) {
        console.error(`${MODULE_ID} | a cast's end could not be announced`, err);
      }
    }
  }
  return out;
}

/* -------------------------------------------- */
/*  Foundry                                      */
/* -------------------------------------------- */

/** A string of this file's lang group. */
const loc = (key, data) => game.i18n.format(`${LANG_PREFIX}.castEnded.${key}`, data ?? {});

/** Core's own singular for each calendar unit an effect duration stores. */
const SINGULAR = Object.freeze({ seconds: "second", minutes: "minute", hours: "hour", days: "day", years: "year" });

/**
 * A calendar duration in seconds, as core converts one for an effect: a month
 * is the calendar's year over its months, in whole days rounded up.
 */
function calendarSeconds(value, units) {
  const calendar = game.time?.calendar;
  if (!calendar) return null;
  if (units === "months") {
    const months = calendar.months?.values?.length;
    if (!months) return null;
    return calendar.componentsToTime({ day: Math.ceil((value * calendar.days.daysPerYear) / months) });
  }
  const unit = SINGULAR[units];
  return unit ? calendar.componentsToTime({ [unit]: value }) : null;
}

/** The record's stamp, written by the GM's own window. */
const stampEnded = (effect, worldTime) => effect.update({ [`flags.${MODULE_ID}.${FLAG_SPELL_EFFECT}.ended`]: worldTime });

/** The whispered card: the spell, the count still standing, a line where they turned hostile, and Dismiss, which only a GM seat is shown (`bindCard`). */
async function postEnded({ effect, record, tokens, held = [], outcome = null }) {
  const caster = effect.parent;
  // A spell since deleted reads by the name its record was made with.
  const spellName = docOf(record.spellUuid)?.name ?? effect.name;
  const isGM = (id) => !!game.users.get(id)?.isGM;
  const content =
    `<div class="acks-extras-cast-ended"><p>${esc(loc("text", { spell: spellName, name: caster?.name ?? "", n: tokens.length + held.length }))}</p>` +
    (outcome === "hostile" ? `<p>${esc(loc("hostile"))}</p>` : "") +
    `<button type="button" ${DISMISS_ATTR}><i class="fa-solid fa-ghost" inert></i> ${esc(loc("dismiss"))}</button></div>`;
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: caster }),
    whisper: castEndedRecipients(caster?.ownership, game.users.filter((u) => u.isGM).map((u) => u.id), isGM),
    content,
    flags: { [MODULE_ID]: { [CAST_ENDED_FLAG]: { casterUuid: record.casterUuid || caster?.uuid, castId: record.castId } } },
  });
}

/**
 * A record deleted by its id, from the actor or unlinked token that carries it.
 * The delete names its cause, so a held caster record that runs out reads as
 * time on the client that deletes it (`cast-held.mjs`).
 */
const removeRecord = (effect) => effect.parent?.deleteEmbeddedDocuments("ActiveEffect", [effect.id], { [MODULE_ID]: { endCause: "time" } });

/** What one cast of this caster left standing: its scene tokens and its held summons. */
const standingOf = (caster, castId) => (caster ? castSummons(caster, castId, { scenes: game.scenes }) : { tokens: [], held: [] });

/** The live dependencies of a sweep. */
const liveDeps = (worldTime) => ({
  worldTime,
  secondsOf: calendarSeconds,
  stamp: stampEnded,
  remove: removeRecord,
  standing: (record) => standingOf(fromUuidSync(record.casterUuid), record.castId),
  control: async (record) => (await import("./cast-control.mjs")).applyCastControl({ casterUuid: record.casterUuid, castId: record.castId }),
  post: postEnded,
});

/** Wire a cast-ended card's Dismiss: the cast's creatures on every scene, through the summons dismissal. It is drawn for a GM seat only, since a creature whose control ended is the Judge's to remove. */
function bindCard(message, html) {
  const flag = message?.getFlag?.(MODULE_ID, CAST_ENDED_FLAG);
  if (!flag?.castId) return;
  for (const button of html?.querySelectorAll?.(`[${DISMISS_ATTR}]`) ?? []) {
    if (!game.user?.isGM) {
      button.remove();
      continue;
    }
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      const caster = fromUuidSync(flag.casterUuid);
      if (!caster) return;
      const { promptDismiss } = await import("../lib/summons.mjs");
      await promptDismiss(caster, { ...standingOf(caster, flag.castId), castId: flag.castId });
    });
  }
}

let registered = false;

/** Register the clock watch and the card's button. Once, at `init`. */
export function registerCastExpiry() {
  if (registered) return;
  registered = true;
  onWorldTimeAdvanced((worldTime) => {
    sweepEndedCasts(worldActors(), liveDeps(worldTime)).catch((err) => console.error(`${MODULE_ID} | the cast-end sweep failed`, err));
  });
  Hooks.on("renderChatMessageHTML", bindCard);
}
