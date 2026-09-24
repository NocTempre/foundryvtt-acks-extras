/**
 * Hit-point arithmetic and reads, Foundry-free. `planHpChange` computes what
 * core's `AcksActor#applyDamage` would write, so a preview states the write
 * exactly; `hpEligibility` says whose hit points a Judge may adjust; and the
 * token reads find an unlinked token's own hit points and statuses, on a live
 * token or in token data kept off the canvas.
 */
import { GROUP_TYPE, MODULE_ID, TEMPLATE_TYPE } from "./constants.mjs";

/** The three things done to hit points. */
export const HP_MODE = Object.freeze({ damage: "damage", heal: "heal", set: "set" });

/**
 * Why an actor's hit points are not adjusted here. Each key is also the last
 * part of its label's lang key, hp.reason.<key> under lib's root.
 */
export const HP_REASON = Object.freeze({
  missing: "missing",
  stack: "stack",
  template: "template",
  vehicle: "vehicle",
  noHp: "noHp",
});

/** The lowest value core's `applyDamage` stores. Core's clamp, not a rule. */
const CORE_FLOOR = -99;

const VEHICLE_TYPE = `${MODULE_ID}.vehicle`;

const isNumber = (n) => typeof n === "number" && Number.isFinite(n);

/**
 * What a change would do to `hp`, computed the way core's `applyDamage`
 * computes it: the amount times the multiplier, rounded up, taken off the
 * value, and the result held between core's floor and the maximum. Healing is
 * core's damage with the sign reversed. `set` makes the amount the new value,
 * held the same way. `floorAtZero` stops damage at 0 and never raises a value
 * that is already below it.
 *
 * @param {{value: number, max: number}} hp
 * @param {{mode?: string, amount?: number|string, multiplier?: number, floorAtZero?: boolean}} [change]
 * @returns {{before: number, after: number, max: number, delta: number,
 *   crossedDown: boolean, crossedUp: boolean, clamped: boolean}|null}
 *   null when the hit points or the amount are not numbers
 */
export function planHpChange(hp, { mode = HP_MODE.damage, amount = 0, multiplier = 1, floorAtZero = false } = {}) {
  const before = Number(hp?.value);
  const max = Number(hp?.max);
  if (!Number.isFinite(before) || !Number.isFinite(max)) return null;
  const n = parseInt(amount, 10);
  const factor = Number(multiplier);
  if (!Number.isFinite(n) || !Number.isFinite(factor)) return null;

  let raw;
  if (mode === HP_MODE.set) raw = n;
  else raw = before - Math.ceil((mode === HP_MODE.heal ? -n : n) * factor);
  let after = Math.min(Math.max(raw, CORE_FLOOR), max);
  if (floorAtZero && mode === HP_MODE.damage) after = Math.max(after, Math.min(before, 0));

  return {
    before,
    after,
    max,
    delta: after - before,
    crossedDown: before > 0 && after <= 0,
    crossedUp: before <= 0 && after > 0,
    clamped: after !== raw,
  };
}

/**
 * Why this actor's hit points are not adjusted here, or null when they are.
 * A group holds a representative body rather than the stack's own, a template
 * is a generator, and a vehicle's hit points are kept on a field of its own.
 * An actor with no numeric value and maximum has no hit points.
 * @returns {string|null} a key of `HP_REASON`
 */
export function hpEligibility(actor) {
  if (!actor) return HP_REASON.missing;
  if (actor.type === GROUP_TYPE) return HP_REASON.stack;
  if (actor.type === TEMPLATE_TYPE) return HP_REASON.template;
  if (actor.type === VEHICLE_TYPE) return HP_REASON.vehicle;
  const hp = actor.system?.hp;
  return isNumber(hp?.value) && isNumber(hp?.max) ? null : HP_REASON.noHp;
}

/**
 * The hit points a token holds for itself. A live token's are its synthetic
 * actor's. For token data kept off the canvas, each figure comes from the
 * delta, else from the base actor. A linked token's are the base actor's.
 * @param {object} token a TokenDocument, or plain token data
 * @param {object} [baseActor] the actor the token was made from
 * @returns {{value: number, max: number|null}|null} null when no value is known
 */
export function tokenHitPoints(token, baseActor = null) {
  const base = baseActor?.system?.hp;
  let value;
  let max;
  if (!token || token.actorLink) {
    value = base?.value;
    max = base?.max;
  } else if (isNumber(token.actor?.system?.hp?.value)) {
    ({ value, max } = token.actor.system.hp);
  } else {
    const delta = token.delta?.toObject?.() ?? token.delta;
    const own = delta?.system?.hp;
    value = isNumber(own?.value) ? own.value : base?.value;
    max = isNumber(own?.max) ? own.max : base?.max;
  }
  return isNumber(value) ? { value, max: isNumber(max) ? max : null } : null;
}

/**
 * The delta patch that puts token data's own hit points (`tokenHitPoints`)
 * onto a token being created from it: `{system: {hp: {value, max}}}`, or null
 * for a linked token or one with no hit points to read.
 */
export function ownHitPointsPatch(data, baseActor = null) {
  if (!data || data.actorLink) return null;
  const hp = tokenHitPoints(data, baseActor);
  if (!hp) return null;
  return { system: { hp: hp.max === null ? { value: hp.value } : { value: hp.value, max: hp.max } } };
}

/** Does an effect's `statuses` (a Set on a document, an array in data) hold `status`? */
const holds = (statuses, status) =>
  statuses instanceof Set ? statuses.has(status) : Array.isArray(statuses) && statuses.includes(status);

/**
 * Does this token carry `status` for itself? A live token answers through
 * its synthetic actor. For token data kept off the canvas, the delta's
 * effects replace the base actor's of the same id and add to the rest, as
 * Foundry merges them. A linked token answers through the base actor.
 * @param {object} token a TokenDocument, or plain token data
 * @param {object} [baseActor]
 * @param {string} status a status id, such as "dead"
 */
export function tokenHasStatus(token, baseActor, status) {
  if (!token || token.actorLink) return !!baseActor?.statuses?.has?.(status);
  if (token.actor) return !!token.actor.statuses?.has?.(status);
  const merged = new Map();
  for (const e of baseActor?.effects ?? []) merged.set(e.id ?? e._id, e);
  const delta = token.delta?.toObject?.() ?? token.delta;
  for (const e of delta?.effects ?? []) merged.set(e._id, e);
  for (const e of merged.values()) if (!e.disabled && holds(e.statuses, status)) return true;
  return false;
}
