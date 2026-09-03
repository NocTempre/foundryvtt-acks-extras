/* global game, Hooks */
/**
 * Tiny cross-feature helpers. Everything here used to exist as N identical
 * copies across the merged features (loc ×11, num ×5, gmIds ×4, …); the
 * copies now import the one implementation. Nothing in this file touches
 * Foundry before it is called, so it is safe to import from anywhere.
 */

/** Prefix-bound i18n formatter: `makeLoc("ACKS-FORMATION")` → `loc(key, data)`. */
export const makeLoc = (prefix) => (key, data = {}) => game.i18n.format(`${prefix}.${key}`, data);

/**
 * Localize a FULL key, falling back to a supplied string when the key is not
 * in the active translation. Distinct from `makeLoc`, which binds a prefix and
 * formats: this is for vocabularies that ship a readable English fallback
 * beside each key, so a missing translation degrades to a word rather than to
 * the key itself on screen.
 */
export const locOr = (key, fallback) => (game.i18n?.has?.(key) ? game.i18n.localize(key) : fallback);

/** The value as a number, or `fallback` when it is not finite. */
export const toNum = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/**
 * The value as a number, or **null when it was never stated**.
 *
 * Use this for anything that may be absent — a registry cell, an optional
 * field, a caller's `= null` default — and never hand-roll
 * `Number.isFinite(Number(x))` for the same job. `Number(undefined)` is NaN and
 * behaves, but **`Number(null)` and `Number("")` are both 0, and 0 is finite**,
 * so the hand-rolled test reports an unstated value as a confident zero. That
 * has produced three separate shipped defects: a blank load rendering as "0",
 * an unpriced flight silently multiplying by zero, and an absent maximum load
 * grounding every mount.
 *
 * Zero and "unstated" are different answers. This is the helper that keeps them
 * different.
 */
export const numOrNull = (v) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Ids of every GM user — whisper/socket-notify targets. */
export const gmIds = () => game.users.filter((u) => u.isGM).map((u) => u.id);

/** True on exactly one client: the active GM responsible for automation. */
export const isPrimaryGM = () => game.users.activeGM?.isSelf ?? false;

/** The lib feature's storage surface (attached at import time). */
export const libStorage = () => globalThis.acksExtras.lib.storage;

/**
 * Is this application a sheet this module draws itself? An injector dresses
 * the SYSTEM's sheet; a sheet of this module's own asks each feature for what
 * it wants and places the result, so the injectors stand down on it. The
 * declared classes carry the answer: every window this module draws declares
 * `acks-extras` on its root.
 */
export const ownsSheet = (app) => !!app?.options?.classes?.includes?.("acks-extras");

/**
 * 0.6667 → "2/3", because that is how the book says it. Whole numbers stay
 * whole ("2", not "200%"), so a row of factors reads in one idiom rather than
 * mixing fractions and percentages. The vehicle sheet's speed reasons and the
 * travel panel's multiplier chain both print through this.
 */
export function fractionLabel(f) {
  if (Math.abs(f - Math.round(f)) < 0.001) return String(Math.round(f));
  const known = [
    [1 / 3, "1/3"], [1 / 2, "1/2"], [2 / 3, "2/3"], [3 / 2, "3/2"],
    [2 / 9, "2/9"], [1 / 4, "1/4"], [3 / 4, "3/4"],
  ];
  const hit = known.find(([v]) => Math.abs(v - f) < 0.001);
  return hit ? hit[1] : `${Math.round(f * 100)}%`;
}

/**
 * Fire one of the family's own hooks without letting a listener take the caller
 * down with it. Announcing a change is always the LAST thing a mutation does, so
 * a sibling feature throwing in its handler must not undo the write that already
 * landed — it gets logged and the mutation still succeeded.
 */
export function announceChange(hook, ...args) {
  try {
    Hooks.callAll(hook, ...args);
  } catch (err) {
    console.error(`acks-extras | ${hook} listener failed`, err);
  }
}
