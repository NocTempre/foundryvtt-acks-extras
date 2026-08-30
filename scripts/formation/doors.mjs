/* global game, canvas, ui, ChatMessage, Roll */
/**
 * Doors, and the four ways past one (RR ch. 6 §"Doors").
 *
 * A door in this module is a WALL on the scene — Foundry's own door, with its
 * own open/closed/locked state — and everything ACKS adds to it is a flag
 * beside that state. Nothing here replaces the door: a Judge who just wants to
 * click it open still clicks it open.
 *
 * THE FOUR WAYS, as the book prints them:
 *  - **use a key** (one action, no throw) — Foundry's own door control;
 *  - **pick the lock**, hastily (1 round, a Lockpicking throw, and a broken
 *    pick on an unmodified 1–3 jams the lock FOREVER) or methodically (1 turn,
 *    +4, jammed only on a natural 1);
 *  - **batter it down** with an axe — no throw at all, just time: 1 turn for a
 *    plain wooden door, 3 for an iron-banded one, and stone or solid metal not
 *    at all without something that deals structural damage;
 *  - **bash it open** in one round on a Dungeonbashing throw of 18+.
 *
 * THE BASH MODIFIERS are the interesting part, and they are why this exists
 * rather than a bare party check: ±4 per point of Strength adjustment, +4 more
 * when a PAIR heaves together (using the stronger one's adjustment), +2 for a
 * crowbar, ±8 per size category away from man-sized, and −4 for every spike
 * after the first. An unmodified 1 bounces the basher off for 1 bludgeoning
 * damage. Failure is never final — the book says try again.
 *
 * SPIKES are the reason a door needs stored state at all. A spike takes one
 * round to hammer home, a door holds at most four, and each one after the
 * first costs −4 to force the door. They are also what makes an EVIL door —
 * one that swings shut when released and opens for monsters regardless —
 * stayable at all.
 */
import { MODULE_ID } from "./constants.mjs";
import { abilityMod } from "../lib/actor-read.mjs";

const LANG_PREFIX = "ACKS-FORMATION.doors";

/** The door's ACKS state, stored beside Foundry's own door flags. */
export const DOOR_FLAG = "door";

/** A door holds no more than four spikes (RR ch. 6). */
export const MAX_SPIKES = 4;

/** The Dungeonbashing throw a door asks for. */
export const BASH_TARGET = 18;

/**
 * What Strength is worth on a Dungeonbashing throw, per point of modifier.
 *
 * THE definition for this module. The factor belongs to the THROW, not to the
 * Adventuring proficiency that makes the best-known one: a character bashes a
 * door, breaks out of a grab, shoves forward while stuck and tears free of
 * webbing on the same throw, and Strength is worth the same on all of them. So
 * every surface that resolves a Dungeonbashing throw reads it here rather than
 * restating it — the party sheet's bash column did restate it, and a rule with
 * two copies is a rule that drifts.
 */
export const BASH_STR_FACTOR = 4;

/** Strength's contribution to a Dungeonbashing throw for a given modifier. */
export const bashStrBonus = (strMod) => (Number(strMod) || 0) * BASH_STR_FACTOR;

/**
 * Door constructions from the book's table, with what each implies. `batter`
 * is the turns an axe needs; null means an axe will not do it at all and
 * something that deals structural damage must.
 */
export const DOOR_KINDS = Object.freeze({
  wood: { label: `${LANG_PREFIX}.kind.wood`, ac: 1, shp: 1, batter: 1 },
  ironBanded: { label: `${LANG_PREFIX}.kind.ironBanded`, ac: 3, shp: 1, batter: 3 },
  iron: { label: `${LANG_PREFIX}.kind.iron`, ac: 6, shp: 1, batter: null },
  stone: { label: `${LANG_PREFIX}.kind.stone`, ac: 6, shp: 2, batter: null },
  portcullis: { label: `${LANG_PREFIX}.kind.portcullis`, ac: 6, shp: 25, batter: null },
});

/** Read a door's ACKS state. Absent flags read as a plain, unspiked door. */
export function doorState(wall) {
  const f = wall?.getFlag?.(MODULE_ID, DOOR_FLAG) ?? wall?.flags?.[MODULE_ID]?.[DOOR_FLAG] ?? {};
  return {
    spikes: Math.max(0, Math.min(MAX_SPIKES, Number(f.spikes) || 0)),
    wedged: !!f.wedged,
    evil: !!f.evil,
    kind: f.kind && DOOR_KINDS[f.kind] ? f.kind : "ironBanded", // the book's standard dungeon door
    jammed: !!f.jammed, // a pick broken off in the lock
    batteredTurns: Math.max(0, Number(f.batteredTurns) || 0),
  };
}

/** Is this wall a door at all? (Foundry: 1 = door, 2 = secret door.) */
export const isDoor = (wall) => Number(wall?.door) > 0;

/**
 * The bash throw, as arithmetic — no dice, no documents, so the rule can be
 * tested and shown to a player before anyone commits a round to it.
 *
 * @param {object} o
 * @param {number} o.strMod      Strength adjustment of the basher (the STRONGER, if a pair)
 * @param {boolean} o.pair       two adventurers heaving together
 * @param {boolean} o.crowbar    someone has a crowbar in hand
 * @param {number} o.sizeSteps   size categories away from man-sized (+1 large, −1 small)
 * @param {number} o.spikes      spikes currently holding the door
 * @param {number} o.extra       the Judge's own modifier for an unusual door
 * @returns {{target: number, modifier: number, parts: object[], hopeless: boolean}}
 */
export function bashPlan({ strMod = 0, pair = false, crowbar = false, sizeSteps = 0, spikes = 0, extra = 0 } = {}) {
  const parts = [];
  const push = (value, key) => { if (value) parts.push({ value, key }); };
  // Strength moves the ROLL by BASH_STR_FACTOR per point — the book's own
  // example has an 18 Strength opening doors on a 6+, which is 18 less 12.
  push(bashStrBonus(strMod), "str");
  push(pair ? 4 : 0, "pair");
  push(crowbar ? 2 : 0, "crowbar");
  push(sizeSteps * 8, "size");
  // The FIRST spike is free of penalty; each one after it costs four.
  push(Math.max(0, Math.min(MAX_SPIKES, spikes) - 1) * -4, "spikes");
  push(extra, "judge");
  const modifier = parts.reduce((sum, p) => sum + p.value, 0);
  return {
    target: BASH_TARGET,
    modifier,
    parts,
    // A natural 20 plus the modifiers still short of 18 cannot be forced by
    // heaving at all — worth SAYING rather than letting a table roll for it.
    hopeless: 20 + modifier < BASH_TARGET,
  };
}

/** Write door state, merging over what is there. */
async function setDoorState(wall, patch) {
  return wall.setFlag(MODULE_ID, DOOR_FLAG, { ...doorState(wall), ...patch });
}

/**
 * Hammer one spike home. A round per spike, four at most — and a spiked door
 * is the only thing that keeps an evil door from opening for whatever is on
 * the other side.
 */
export async function spikeDoor(wall, actor = null) {
  if (!isDoor(wall)) return { ok: false, reason: "notADoor" };
  const state = doorState(wall);
  if (state.spikes >= MAX_SPIKES) return { ok: false, reason: "full" };
  await setDoorState(wall, { spikes: state.spikes + 1 });
  await announce(wall, "spiked", { name: actor?.name ?? game.i18n.localize(`${LANG_PREFIX}.someone`), n: state.spikes + 1 });
  return { ok: true, spikes: state.spikes + 1 };
}

/** Pull a spike back out — a Judge's correction, or a party recovering its iron. */
export async function unspikeDoor(wall) {
  const state = doorState(wall);
  if (!state.spikes) return { ok: false, reason: "none" };
  await setDoorState(wall, { spikes: state.spikes - 1 });
  return { ok: true, spikes: state.spikes - 1 };
}

/**
 * Heave at the door. Rolls, applies the RAW outcome — the door opens at once
 * on a success, and an unmodified 1 costs the basher a point — and says what
 * happened. Never consumes the spikes: forcing a spiked door tears it open,
 * so the spikes go with it.
 */
export async function bashDoor(wall, { actor = null, partner = null, crowbar = false, sizeSteps = 0, extra = 0 } = {}) {
  if (!isDoor(wall)) return { ok: false, reason: "notADoor" };
  const state = doorState(wall);
  const pair = !!partner;
  // A pair heaves with the STRONGER adjustment, not the sum of the two.
  const strMod = Math.max(actor ? abilityMod(actor, "str") : 0, partner ? abilityMod(partner, "str") : 0);
  const plan = bashPlan({ strMod, pair, crowbar, sizeSteps, spikes: state.spikes, extra });

  const roll = await new Roll(`1d20 + ${plan.modifier}`).evaluate();
  const natural = roll.dice[0]?.results?.[0]?.result ?? roll.total - plan.modifier;
  const success = roll.total >= plan.target;
  const botch = natural === 1;

  if (success) {
    // Forced open: Foundry's own door state opens, and the spikes tore out
    // with it. A door held shut by nothing is no longer locked either.
    await wall.update({ ds: 1 });
    await setDoorState(wall, { spikes: 0, wedged: false });
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: game.i18n.localize(`${LANG_PREFIX}.bashFlavor`),
    content: `<p>${game.i18n.format(`${LANG_PREFIX}.bashResult`, {
      name: actor?.name ?? game.i18n.localize(`${LANG_PREFIX}.someone`),
      total: roll.total,
      target: plan.target,
      outcome: game.i18n.localize(`${LANG_PREFIX}.${success ? "opened" : botch ? "botched" : "held"}`),
    })}</p>`,
    rolls: [roll],
  });

  return { ok: true, success, botch, total: roll.total, plan, damage: botch ? 1 : 0 };
}

/**
 * Battering a door down with an axe asks no throw at all — only time, and only
 * if an axe will do it. Returns the turns it costs so the turn engine can
 * spend them; a construction an axe cannot beat says so instead.
 */
export function batterPlan(wall) {
  const kind = DOOR_KINDS[doorState(wall).kind];
  return kind.batter == null
    ? { ok: false, reason: "tooSolid", kind }
    : { ok: true, turns: kind.batter, kind };
}

/** A one-line note in chat, for the things that are not rolls. */
async function announce(wall, key, data) {
  await ChatMessage.create({
    content: `<p>${game.i18n.format(`${LANG_PREFIX}.${key}`, data)}</p>`,
    whisper: ChatMessage.getWhisperRecipients("GM").map((u) => u.id),
  });
}

/** The door the Judge means: the one selected on the Walls layer. */
export function selectedDoor() {
  const walls = canvas?.walls?.controlled ?? [];
  const doors = walls.map((w) => w.document).filter(isDoor);
  if (!doors.length) {
    ui.notifications?.warn(game.i18n.localize(`${LANG_PREFIX}.selectADoor`));
    return null;
  }
  return doors[0];
}
