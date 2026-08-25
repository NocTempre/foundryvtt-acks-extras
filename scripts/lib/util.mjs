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

/** Ids of every GM user — whisper/socket-notify targets. */
export const gmIds = () => game.users.filter((u) => u.isGM).map((u) => u.id);

/** True on exactly one client: the active GM responsible for automation. */
export const isPrimaryGM = () => game.users.activeGM?.isSelf ?? false;

/** The lib feature's storage surface (attached at import time). */
export const libStorage = () => globalThis.acksExtras.lib.storage;

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
