/**
 * The squeeze (RR ch. 6, Squeezing): a throw each round to pass a narrowing,
 * the stuck state a botched one leaves, and the two ways out.
 *
 * It is derived here, beside the Spelunking table and not in it: the throw's
 * target is the member's encumbrance in stone, and a stuck member's two escapes
 * carry that encumbrance and every failed push as a penalty. The file owns the
 * procedure. Every magnitude (Contortionism's bonus, the length that makes a
 * narrowing a chokepoint, the distance an escape carries, the penalty each
 * failed push adds, the botch band) arrives registered through
 * `formationValue`, and each reads as unknown until it does.
 *
 * Contortionism's figure is the squeeze's own and the push's own; the wiggle
 * back is a saving throw, and the ability's effect modifies a saving throw
 * through the save's own path, so `wiggleShift` never reads the figure.
 * See docs/formation/DECISIONS.md, "The squeeze's rows and the two escapes".
 */
import { hasCapability } from "../lib/capabilities.mjs";
import { formationValue } from "./constants.mjs";
import { bashStrBonus } from "./doors.mjs";
import { hasAbility } from "./formation-model.mjs";

const CONTORTIONISM = /contortionism/i;

/** What Contortionism adds to the squeeze and the push, or null until it is imported. */
export const contortionismBonus = () => formationValue("contortionismBonus");

/** The length a narrowing must stay under to be a chokepoint, or null until imported. */
export const chokepointFeet = () => formationValue("chokepointFeet");

/** The distance a successful escape carries, either way, or null until imported. */
export const escapeFeet = () => formationValue("escapeFeet");

/** What each failed push adds to the next attempt, or null until imported. */
export const escapePenaltyStep = () => formationValue("escapePenaltyStep");

/**
 * The unmodified results that botch a squeezing throw, as the highest face of
 * the band (the band starts at the die's lowest), or null until it is imported.
 * With none a failed throw never leaves a member stuck.
 */
export const squeezeBotchBand = () => formationValue("squeezeBotchBand");

/** Does this actor hold Contortionism: by the capability an imported entry answers to, or by a hand-made ability of that name. */
export const holdsContortionism = (actor) => !!actor && (hasCapability(actor, "kw:contortionism") || hasAbility(actor, CONTORTIONISM));

/** A finite number, else null. */
const figure = (value) => (Number.isFinite(Number(value)) && value !== null && value !== "" ? Number(value) : null);

/**
 * The squeezing throw one member needs this round: their encumbrance in stone
 * is the target, a holder of Contortionism lowers it by the imported bonus,
 * and the Judge's modifier moves it on top. A holder whose bonus is not
 * imported has no target (`unknown` names the figure), never a guess.
 *
 * @param {object} o
 * @param {number} o.encumbrance what they are carrying, in stone
 * @param {boolean} [o.proficient] holds Contortionism
 * @param {number} [o.judgeMod] the Judge's modifier; positive lowers the target
 * @returns {{target: number|null, parts: Array<{key: string, value: number}>, unknown: string[]}}
 *   `parts` are `{key, value}` pairs the surface names; each value is what the part adds to the number to roll
 */
export function squeezingThrow({ encumbrance = 0, proficient = false, judgeMod = 0 } = {}) {
  const stone = Math.max(0, Number(encumbrance) || 0);
  const parts = [{ key: "encumbrance", value: stone }];
  const unknown = [];
  const bonus = proficient ? contortionismBonus() : 0;
  if (proficient) {
    if (bonus == null) unknown.push("contortionismBonus");
    else parts.push({ key: "contortionism", value: -bonus });
  }
  const mod = Number(judgeMod) || 0;
  if (mod) parts.push({ key: "judge", value: -mod });
  if (unknown.length) return { target: null, parts, unknown };
  return { target: stone - bonus - mod, parts, unknown };
}

/**
 * The penalty a stuck member's escapes carry from failed pushes: the imported
 * step for each. With no failed push nothing is owed and no figure is needed.
 *
 * @param {number} plight failed pushes so far
 * @returns {{value: number|null, unknown: string[]}} null with the step named where one is owed and not imported
 */
export function plightPenalty(plight = 0) {
  const count = Math.max(0, Number(plight) || 0);
  if (!count) return { value: 0, unknown: [] };
  const step = escapePenaltyStep();
  return step == null ? { value: null, unknown: ["escapePenaltyStep"] } : { value: count * step, unknown: [] };
}

/**
 * What raises the number a stuck member's wiggle back rolls against: their
 * encumbrance, the failed pushes' penalty, less the Judge's modifier. The
 * save's own target (the actor's stored figure with its conditions and
 * effects) is the caller's to add to; Contortionism is not in it, since the
 * ability's effect reaches a saving throw by its own route.
 *
 * @returns {{shift: number|null, parts: Array<{key: string, value: number}>, unknown: string[]}}
 */
export function wiggleShift({ encumbrance = 0, plight = 0, judgeMod = 0 } = {}) {
  const stone = Math.max(0, Number(encumbrance) || 0);
  const owed = plightPenalty(plight);
  const mod = Number(judgeMod) || 0;
  const parts = [{ key: "encumbrance", value: stone }];
  if (owed.value) parts.push({ key: "plight", value: owed.value });
  if (mod) parts.push({ key: "judge", value: -mod });
  if (owed.unknown.length) return { shift: null, parts, unknown: owed.unknown };
  return { shift: stone + owed.value - mod, parts, unknown: [] };
}

/**
 * The push forward's target: the member's Dungeonbashing figure
 * (`resolveCheck`), raised by their encumbrance and the failed pushes'
 * penalty, lowered by Contortionism's bonus for a holder, by Strength and by
 * the Judge's modifier. The figure's own parts never name Contortionism or
 * Strength, so each is counted here once; Strength is `bashStrBonus`, the one
 * definition of what it is worth on a Dungeonbashing throw (docs/formation/
 * DECISIONS.md, "Strength on a Dungeonbashing throw has one owner").
 *
 * @param {object} o
 * @param {{target: number|null, parts?: object[]}|null} o.figure the member's `resolveCheck` result
 * @param {number} o.encumbrance stone carried
 * @param {boolean} [o.proficient] holds Contortionism
 * @param {number} [o.plight] failed pushes so far
 * @param {number} [o.strMod] the member's Strength modifier; 0 for a creature with none
 * @param {number} [o.judgeMod]
 * @returns {{target: number|null, parts: Array<{key: string, value: number, mod?: number}>, unknown: string[]}}
 *   a `strength` part also carries the modifier it was read from
 */
export function pushThrow({ figure = null, encumbrance = 0, proficient = false, plight = 0, strMod = 0, judgeMod = 0 } = {}) {
  const stone = Math.max(0, Number(encumbrance) || 0);
  const base = figure && Number.isFinite(figure.target) ? figure.target : null;
  const owed = plightPenalty(plight);
  const bonus = proficient ? contortionismBonus() : 0;
  const mod = Number(judgeMod) || 0;
  const strength = bashStrBonus(strMod);
  const parts = [{ key: "encumbrance", value: stone }];
  if (owed.value) parts.push({ key: "plight", value: owed.value });
  if (proficient && bonus != null) parts.push({ key: "contortionism", value: -bonus });
  if (strength) parts.push({ key: "strength", value: -strength, mod: Number(strMod) });
  if (mod) parts.push({ key: "judge", value: -mod });
  const unknown = [...(base === null ? ["figure"] : []), ...owed.unknown, ...(proficient && bonus == null ? ["contortionismBonus"] : [])];
  if (unknown.length) return { target: null, parts, unknown };
  return { target: base + stone + owed.value - bonus - strength - mod, parts, unknown };
}

/**
 * Whether a squeeze's length makes it a chokepoint. A length blank, or a
 * chokepoint length not imported, answers null (nothing to compare).
 *
 * @param {number|string|null} length the narrowing's length in feet
 * @returns {boolean|null}
 */
export function isChokepointLength(length) {
  const feet = figure(length);
  const limit = chokepointFeet();
  return feet === null || limit == null ? null : feet < limit;
}

/**
 * What one made squeezing throw carries a member along a squeeze, in feet. The
 * page prints what a miss costs and no distance for a success, so nothing
 * stands here: the answer is null until a ruling names one, and this is the
 * one place it changes. A chokepoint is not measured in feet; one made throw
 * clears it. With no advance a made throw on a squeeze leaves the member where
 * they are.
 *
 * @returns {number|null}
 */
export const squeezeAdvance = () => null;

/**
 * Whether an unmodified result botches the squeezing throw: it falls inside the
 * imported band, which starts at the die's lowest face. With no band imported
 * nothing botches, so no throw leaves a member stuck.
 *
 * @param {number|null} natural the die's face
 * @returns {boolean}
 */
export function squeezeBotched(natural) {
  const band = squeezeBotchBand();
  return band != null && Number.isFinite(natural) && natural >= 1 && natural <= band;
}
