/* global canvas, game */
/**
 * The throws of a cast's thrown rows. Each instance is one core attack throw on
 * the spell's carrier (`lib/patches/attack-throw.mjs`), made in turn, never in
 * parallel: the seat's targets and the carrier attack in flight are per-actor
 * state.
 *
 * Core aims a throw at the seat's targeted tokens, so the cast takes the seat's
 * targets around each throw (`withOnlyTarget`): exactly the one token the
 * instance is for, and whatever the seat had targeted before back afterwards,
 * whether the throw returns, is cancelled or throws.
 *
 * An entry holds `instances: [{state, throw, rolled, critical}]`, one per throw
 * the target was allotted. An instance waits (`throw`), missed or hit
 * (`pending` until its damage is applied); the entry waits for as long as any
 * instance does and so is applied whole. A request to apply an entry carries
 * the hits (`requestOf`). Foundry is reached only through `liveTargeting`, so
 * the rest is testable without it.
 */
import { allocate, wholeSplit } from "./cast-instances.mjs";

/** What a throw answers when its token is not on the scene in view: the instance stays at Throw. */
export const OFF_SCENE = Object.freeze({ offScene: true });

/** The token layer and the user's targets, as the live world gives them. */
export function liveTargeting() {
  return {
    viewed: (token) => Boolean(token?.id && canvas?.scene && token.parent?.id === canvas.scene.id && canvas.tokens?.get?.(token.id)),
    current: () => Array.from(game.user?.targets ?? [], (t) => t.id),
    set: (ids) => canvas.tokens.setTargets(ids, { mode: "replace" }),
  };
}

/**
 * Run a throw with the seat's targets narrowed to one token, and restore them.
 * A token that is not on the viewed scene is not thrown at: `{ok: false,
 * reason: "offScene"}` and `run` is never called.
 *
 * @param {{id: string}} token  the token document the throw is for
 * @param {() => Promise<unknown>} run
 * @param {{viewed: Function, current: Function, set: Function}} [env]
 * @returns {Promise<{ok: true, value: unknown}|{ok: false, reason: string}>}
 */
export async function withOnlyTarget(token, run, env = liveTargeting()) {
  if (!env.viewed(token)) return { ok: false, reason: "offScene" };
  const prior = env.current();
  env.set([token.id]);
  try {
    return { ok: true, value: await run() };
  } finally {
    try {
      env.set(prior);
    } catch (err) {
      console.error("acks-extras | the seat's targets were not restored", err);
    }
  }
}

/**
 * One instance as its throw leaves it, and the damage it rolled where it hit;
 * null where the throw did not resolve (cancelled, or the token is off the
 * scene) and the instance stays at Throw.
 */
export function instanceOfOutcome(outcome) {
  if (!outcome || outcome.offScene) return null;
  const resolution = outcome.resolution ?? {};
  const figures = { total: Number(outcome.attackRoll?.total), target: Number(resolution.targetValue), hit: resolution.isHit === true, critical: resolution.isCritical === true };
  if (!figures.hit) return { instance: { state: "missed", throw: figures }, damage: null };
  const damage = outcome.damageRoll;
  return {
    instance: { state: "pending", rolled: outcome.damageTotal, critical: figures.critical, throw: figures },
    damage: { formula: damage?.formula ?? "", total: outcome.damageTotal, detail: String(damage?.result ?? outcome.damageTotal) },
  };
}

/** `count` instances waiting for their throw. */
export const waitingInstances = (count) => Array.from({ length: Math.max(1, Number(count) || 1) }, () => ({ state: "throw" }));

/** An entry's state from its instances: waiting while any instance waits, pending while any hit is unapplied, missed when none hit. */
export function instancesState(instances) {
  if (instances.some((i) => i.state === "throw")) return "throw";
  return instances.some((i) => i.state === "pending") ? "pending" : "missed";
}

/**
 * Throw every instance that still waits, in order. The sequence stops at the
 * first throw that does not resolve and leaves it and the rest waiting.
 *
 * @param {Array<{state: string}>} instances
 * @param {(index: number) => Promise<unknown>} throwOne  makes the throw of one instance and answers core's outcome, or `OFF_SCENE`
 * @returns {Promise<{instances: object[], damage: {formula: string, total: number, detail: string}|null, stopped: "cancelled"|"offScene"|null}>}  `damage` is the first hit's roll
 */
export async function throwInstances(instances, throwOne) {
  const out = instances.map((i) => ({ ...i }));
  let damage = null;
  for (let i = 0; i < out.length; i++) {
    if (out[i].state !== "throw") continue;
    const outcome = await throwOne(i);
    const made = instanceOfOutcome(outcome);
    if (!made) return { instances: out, damage, stopped: outcome?.offScene ? "offScene" : "cancelled" };
    out[i] = made.instance;
    damage ??= made.damage;
  }
  return { instances: out, damage, stopped: null };
}

/**
 * The split of a throw row's count among the card's targets, by target key. A
 * seat's typed split is read for a count above one, each figure under the
 * identity of the creature it was typed for (`ids`, the token uuid the dialog
 * keys it by; positions where the caller names none); otherwise, and for any
 * count of one, the default round-robin.
 *
 * @param {number} count
 * @param {string[]} targetKeys  the card's targets, in the dialog's order
 * @param {Record<string, unknown>|null} [typed]
 * @param {string[]} [ids]  the identity of each target key, parallel to `targetKeys`
 * @returns {Record<string, number>}
 */
export function splitFor(count, targetKeys, typed = null, ids = targetKeys.map((_, i) => String(i))) {
  if (!(count > 1) || !typed || typeof typed !== "object") return allocate(count, targetKeys);
  const whole = wholeSplit(typed);
  return Object.fromEntries(targetKeys.map((key, i) => [key, whole[ids[i]] ?? 0]));
}

/**
 * One entry's request to apply: the hits of an entry with instances, else the
 * single rolled figure of an entry that has none, with the rolled rounds of a
 * condition entry that lasts a number of them.
 *
 * @param {string} rowKey
 * @param {object|undefined} entry
 * @param {object} card
 * @returns {{rowKey: string, instances: Array<{rolled: number, critical: boolean}>}|{rowKey: string, rolled: number, critical: boolean}}
 */
export function requestOf(rowKey, entry, card) {
  if (Array.isArray(entry?.instances)) {
    return { rowKey, instances: entry.instances.filter((i) => i.state === "pending").map((i) => ({ rolled: i.rolled, critical: i.critical === true })) };
  }
  // A condition that lasts rounds carries the count its entry was opened with.
  const rounds = Number.isFinite(entry?.life?.count) ? { rounds: entry.life.count } : {};
  return { rowKey, rolled: entry?.rolled ?? card.rows?.[rowKey]?.total, critical: entry?.critical === true, ...rounds };
}

/** The requests for a target's pending entries. */
export const pendingRequests = (card, targetKey) =>
  Object.entries(card.entries ?? {})
    .filter(([id, entry]) => id.startsWith(`${targetKey}_`) && entry.state === "pending")
    .map(([id, entry]) => requestOf(id.slice(targetKey.length + 1), entry, card));
