/* global game */
/**
 * The sky is a function of the day and the ground's climate, not a value a
 * party carries around.
 *
 * Weather used to live on the formation and refresh when a Judge pressed End
 * day. Three things follow from that and all three are wrong: advancing the
 * calendar any other way leaves yesterday's sky standing; two parties in the
 * same weather roll independently; and there is no per-day identity at all, so
 * nothing can ask "what was the sky like when we were there".
 *
 * Here the sky is CACHED against `(day, climate, season)`. Everything falls out
 * of that key:
 *
 *  - Two parties in the same climate on the same day read one roll, because
 *    they compute the same key.
 *  - The book's fast-travel allowance — crossing several hexes in a day keeps
 *    the roll unless the climate changed — is the key changing, or not, on its
 *    own. No rule needed.
 *  - Yesterday's sky is still addressable, which is what a fronts drift needs
 *    to shift toward.
 *
 * The cache is world state, bounded, and disposable: losing it costs a re-roll
 * and nothing else.
 */
import { MODULE_ID } from "../lib/constants.mjs";

/** Where the cache lives. World-scoped, so every seat reads one sky. */
export const SETTING_SKY_CACHE = "skyCache";

/** How many days of sky to keep. Old weather is history, not state. */
export const SKY_CACHE_DAYS = 30;

/**
 * The identity of one sky. A blank climate deliberately still produces a key —
 * a world with no climate declared gets one consistent sky per day rather than
 * a fresh roll per party.
 */
export function skyKey({ day, climate = "", season = "" } = {}) {
  const d = Number(day);
  return `${Number.isFinite(d) ? d : 0}|${climate}|${season}`;
}

/** The day a key belongs to, for pruning. */
export function dayOfKey(key) {
  const n = Number(String(key).split("|")[0]);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Drop everything older than the window, keeping the cache bounded without
 * touching anything a fronts drift might still reach back for.
 */
export function pruneSky(cache, today, { keepDays = SKY_CACHE_DAYS } = {}) {
  const now = Number(today);
  if (!Number.isFinite(now)) return { ...cache };
  const out = {};
  for (const [key, value] of Object.entries(cache ?? {})) {
    if (now - dayOfKey(key) <= keepDays) out[key] = value;
  }
  return out;
}

/**
 * Read a cached sky, or record a freshly generated one.
 *
 * `generate` is called ONLY on a miss, which is what makes two parties in one
 * climate share a roll rather than race to overwrite each other's.
 */
export function skyFrom(cache, params, generate) {
  const key = skyKey(params);
  const hit = cache?.[key];
  if (hit) return { sky: hit, key, cached: true, cache };
  const sky = generate();
  if (!sky || sky.ok === false) return { sky, key, cached: false, cache };
  return { sky, key, cached: false, cache: { ...(cache ?? {}), [key]: sky } };
}

/** Yesterday's sky for the same ground, which a fronts drift shifts toward. */
export function priorSky(cache, { day, climate, season } = {}) {
  const d = Number(day);
  if (!Number.isFinite(d)) return null;
  return cache?.[skyKey({ day: d - 1, climate, season })] ?? null;
}

/* -------------------------------------------------------------------- */
/*  The world-backed store                                              */
/* -------------------------------------------------------------------- */

/** The cache as the world holds it. Never throws — an absent setting is `{}`. */
export function readSkyCache() {
  try {
    return game.settings.get(MODULE_ID, SETTING_SKY_CACHE) ?? {};
  } catch {
    return {};
  }
}

/** Persist the cache, pruned. GM-only: players read the sky, never write it. */
export async function writeSkyCache(cache, today) {
  if (!game.user?.isGM) return false;
  try {
    await game.settings.set(MODULE_ID, SETTING_SKY_CACHE, pruneSky(cache, today));
    return true;
  } catch {
    return false;
  }
}

/**
 * The one call a caller wants: the sky for this day and this ground, generated
 * once and shared by everyone standing in it.
 */
export async function skyFor(params, generate) {
  const cache = readSkyCache();
  const result = skyFrom(cache, params, generate);
  if (!result.cached && result.cache !== cache) await writeSkyCache(result.cache, params?.day);
  return result;
}
