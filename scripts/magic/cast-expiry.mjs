/* global game, ChatMessage, Hooks, fromUuidSync */
/**
 * When a summoning's cast runs out. A cast leaves a record on its caster
 * (`spell-effect.mjs`) whose duration is the spell's imported one
 * (`cast-duration.mjs`); once the world clock passes the record's end, the
 * caster's owners and the GMs get one whispered card saying so, with a Dismiss
 * button for the creatures that cast left standing. The creatures stay until
 * someone presses it: the card tells, it does not remove.
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
 * See docs/magic/DECISIONS.md, "A cast's end is told on a card, read from the
 * module's own clock math".
 */
import { MODULE_ID, LANG_PREFIX, FLAG_SPELL_EFFECT } from "./constants.mjs";
import { spellEffectOf } from "./spell-effect.mjs";
import { TURN_SECONDS, ROUNDS_PER_TURN } from "../lib/constants.mjs";
import { summonerOf, summonRecordOf, summonOwnership } from "../lib/summons-logic.mjs";
import { onWorldTimeAdvanced } from "../lib/world-time.mjs";
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
 * answer for. Reads the stored duration, never core's prepared one.
 * @param {object} effect  the record, an Active Effect document or its plain data
 * @param {(value: number, units: string) => number|null} secondsOf  a calendar
 *   duration in seconds, by the world's calendar
 * @returns {number|null}
 */
export function castRecordEnd(effect, secondsOf) {
  const time = (effect?._source?.start ?? effect?.start)?.time;
  const start = Number(time);
  const { value, units } = effect?._source?.duration ?? effect?.duration ?? {};
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
 * creatures standing, post the card. Answers what it did.
 * @param {object} effect  the caster's record
 * @param {object} deps
 * @param {number} deps.worldTime
 * @param {(effect: object, worldTime: number) => Promise<unknown>} deps.stamp
 * @param {(record: object) => object[]} deps.standing  the cast's tokens
 * @param {(o: {effect: object, record: object, tokens: object[]}) => Promise<unknown>} deps.post
 * @returns {Promise<{posted: boolean, reason?: string, n?: number}>}
 */
export async function announceEndedCast(effect, { worldTime, stamp, standing, post }) {
  const record = spellEffectOf(effect);
  if (record?.role !== "caster" || record.ended != null) return { posted: false, reason: "closed" };
  const key = effect.uuid ?? effect.id ?? record.castId;
  if (announcing.has(key)) return { posted: false, reason: "closed" };
  announcing.add(key);
  try {
    await stamp(effect, worldTime);
    const tokens = standing(record);
    if (!tokens.length) return { posted: false, reason: "noneStanding" };
    await post({ effect, record, tokens });
    return { posted: true, n: tokens.length };
  } finally {
    announcing.delete(key);
  }
}

/**
 * Announce every record of the given actors whose cast has run out. A record
 * that fails is logged and the rest go on.
 * @param {Iterable<object>} actors
 * @param {object} deps  `announceEndedCast`'s, with `secondsOf`
 * @returns {Promise<{posted: boolean, reason?: string, n?: number}[]>}
 */
export async function sweepEndedCasts(actors, deps) {
  const out = [];
  for (const actor of actors ?? []) {
    for (const effect of actor?.effects ?? []) {
      if (!castEnded(effect, deps)) continue;
      try {
        out.push(await announceEndedCast(effect, deps));
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

/** The whispered card: the spell, the count still standing, and Dismiss. */
async function postEnded({ effect, record, tokens }) {
  const caster = effect.parent;
  // A spell since deleted reads by the name its record was made with.
  const spellName = docOf(record.spellUuid)?.name ?? effect.name;
  const isGM = (id) => !!game.users.get(id)?.isGM;
  const content =
    `<div class="acks-extras-cast-ended"><p>${esc(loc("text", { spell: spellName, name: caster?.name ?? "", n: tokens.length }))}</p>` +
    `<button type="button" ${DISMISS_ATTR}><i class="fa-solid fa-ghost" inert></i> ${esc(loc("dismiss"))}</button></div>`;
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: caster }),
    whisper: castEndedRecipients(caster?.ownership, game.users.filter((u) => u.isGM).map((u) => u.id), isGM),
    content,
    flags: { [MODULE_ID]: { [CAST_ENDED_FLAG]: { casterUuid: record.casterUuid || caster?.uuid, castId: record.castId } } },
  });
}

/** The live dependencies of a sweep. */
const liveDeps = (worldTime) => ({
  worldTime,
  secondsOf: calendarSeconds,
  stamp: stampEnded,
  standing: (record) => castTokens(game.scenes, record.casterUuid, record.castId),
  post: postEnded,
});

/** Wire a cast-ended card's Dismiss: the cast's creatures on every scene, through the summons dismissal. */
function bindCard(message, html) {
  const flag = message?.getFlag?.(MODULE_ID, CAST_ENDED_FLAG);
  if (!flag?.castId) return;
  for (const button of html?.querySelectorAll?.(`[${DISMISS_ATTR}]`) ?? []) {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      const caster = fromUuidSync(flag.casterUuid);
      if (!caster) return;
      const { promptDismiss } = await import("../lib/summons.mjs");
      await promptDismiss(caster, { tokens: castTokens(game.scenes, caster.uuid, flag.castId) });
    });
  }
}

let registered = false;

/** Register the clock watch and the card's button. Once, at `init`. */
export function registerCastExpiry() {
  if (registered) return;
  registered = true;
  onWorldTimeAdvanced((worldTime) => {
    const casters = game.actors.filter((a) => a.type === "character");
    sweepEndedCasts(casters, liveDeps(worldTime)).catch((err) => console.error(`${MODULE_ID} | the cast-end sweep failed`, err));
  });
  Hooks.on("renderChatMessageHTML", bindCard);
}
