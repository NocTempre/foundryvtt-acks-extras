/**
 * Experience credited to an actor, wherever the actor keeps it.
 *
 * A character has a field for it and the system's own `getExperience` adds to
 * it (the Actor Tweaks percentage, the chat line and the class hooks all run
 * there), so a character is credited through that call and no other. The
 * system gives a monster no such field — its `details.xp` is what the monster
 * is worth when defeated — and `getExperience` returns without doing anything
 * for it, so a monster or an animal is credited onto a module flag instead:
 * `flags["acks-extras"].experience`, `{ bySource: { <source>: <points> } }`.
 *
 * The store is a tally per source and nothing else. The total is the sum of
 * the tally, so a tooltip that lists the parts always adds up to the figure
 * beside it. Nothing here advances a creature: reading the credit is all a
 * surface does with it.
 *
 * Every function but `creditExperience` is pure; `creditExperience` is the
 * ONE write. It reads then writes, so two credits to one actor must be awaited
 * in turn.
 */
import { MODULE_ID, ANIMAL_TYPE } from "./constants.mjs";
import { ACTOR_TYPE } from "./vocab.mjs";

/** The flag key, under the module's scope, that holds a non-character's credited experience. */
export const EXPERIENCE_FLAG = "experience";

/** The source a credit carries when its caller names none. */
export const DEFAULT_SOURCE = "other";

/** Actor types that keep credited experience on the flag, because the system gives them no field. */
const FLAG_TYPES = new Set([ACTOR_TYPE.monster, ANIMAL_TYPE]);

/** Whether `actor` keeps its credited experience on the module flag rather than the system's field. */
export const keepsExperienceOnFlag = (actor) => FLAG_TYPES.has(actor?.type);

/**
 * The store a flag value holds, cleaned: only finite, positive tallies under a
 * non-empty source survive, so a hand-edited or half-written flag reads as
 * what it can be trusted to say.
 * @param {*} stored the raw flag value
 * @returns {{bySource: Record<string, number>}}
 */
export function normalizeStore(stored) {
  const bySource = {};
  const raw = stored?.bySource;
  if (raw && typeof raw === "object") {
    for (const [source, points] of Object.entries(raw)) {
      const n = Number(points);
      if (source && Number.isFinite(n) && n > 0) bySource[source] = n;
    }
  }
  return { bySource };
}

/**
 * The store with `amount` more points under `source`. Pure; the input is not
 * touched. An amount that is not a positive finite number changes nothing.
 * @param {*} stored the raw flag value
 * @param {number} amount
 * @param {string} [source]
 */
export function addCredit(stored, amount, source = DEFAULT_SOURCE) {
  const store = normalizeStore(stored);
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return store;
  const key = String(source || DEFAULT_SOURCE);
  return { bySource: { ...store.bySource, [key]: (store.bySource[key] ?? 0) + n } };
}

/**
 * What a non-character has been credited: the total and its parts, largest
 * source first. A character, or an actor that keeps nothing here, reads as
 * nothing (a character's experience is its own sheet's field).
 * @param {Actor} actor
 * @returns {{total: number, parts: Array<[string, number]>}}
 */
export function creditedExperience(actor) {
  if (!keepsExperienceOnFlag(actor)) return { total: 0, parts: [] };
  const { bySource } = normalizeStore(actor.getFlag?.(MODULE_ID, EXPERIENCE_FLAG));
  const parts = Object.entries(bySource).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { total: parts.reduce((sum, [, n]) => sum + n, 0), parts };
}

/**
 * Credit `amount` experience to `actor`. A character goes through the
 * system's `getExperience`, so its adjustment and chat line still happen; a
 * monster or an animal is written to the flag under `source`; any other actor
 * is refused. A zero, negative or non-numeric amount is no credit.
 * @param {Actor} actor
 * @param {number} amount
 * @param {{source?: string}} [opts] `source` names where the credit came from (the tooltip lists it)
 * @returns {Promise<{via: "system"|"flag", amount: number}|null>} null when nothing was credited
 */
export async function creditExperience(actor, amount, { source = DEFAULT_SOURCE } = {}) {
  const n = Number(amount);
  if (!actor || !Number.isFinite(n) || n <= 0) return null;
  if (actor.type === ACTOR_TYPE.character) {
    if (typeof actor.getExperience !== "function") return null;
    await actor.getExperience(n);
    return { via: "system", amount: n };
  }
  if (!keepsExperienceOnFlag(actor)) return null;
  await actor.setFlag(MODULE_ID, EXPERIENCE_FLAG, addCredit(actor.getFlag?.(MODULE_ID, EXPERIENCE_FLAG), n, source));
  return { via: "flag", amount: n };
}
