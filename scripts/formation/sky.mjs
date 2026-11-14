/* global game */
/**
 * The sky is a function of the day and the ground's climate, cached against
 * `(day, climate, season)` — the calendar day the world clock stands in, or the
 * End-day counter where the clock keeps no calendar. Parties sharing a key
 * share one roll, a day's travel across hexes of one climate keeps it, and
 * yesterday's sky stays addressable for a fronts drift. The cache is bounded,
 * world-scoped and disposable: losing it costs a re-roll.
 * See docs/formation/DECISIONS.md, "Weather is derived from date and climate, not stored on the formation".
 */
import { MODULE_ID } from "../lib/constants.mjs";

/** Where the cache lives. World-scoped, so every seat reads one sky. */
export const SETTING_SKY_CACHE = "skyCache";

/** How many days of sky to keep. */
export const SKY_CACHE_DAYS = 30;

/**
 * The identity of one sky, `day|climate|season`. A blank climate still
 * produces a key, so a world with none declared gets one sky per day.
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
 * Drop every entry older than `keepDays` before `today`, keeping the cache
 * bounded.
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
 * `generate` is called only on a miss.
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
