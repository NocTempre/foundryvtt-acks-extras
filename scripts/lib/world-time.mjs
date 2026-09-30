/* global game, Hooks */
/**
 * The module's world-clock policy — the one switch deciding whether this module
 * writes to `game.time`, the one place features WATCH it from, and the one
 * reading of what hour the clock says it is.
 *
 * Two features move the clock: formation's dungeon turns (a minute per
 * bookkeeping round) and the location sheet's "Advance 1 week" fallback. They
 * differ only in step size — both write the same shared resource through the
 * same `game.time.advance` contract — so a GM is answering one question, not
 * two: does this module drive the clock, or does another module own it? The key
 * is registered once (module.mjs) and read from here by both features, because a
 * per-feature answer would give the same toggle two labels and two defaults.
 *
 * Whether it is DARK is read here for the same reason: the calendar keeps no
 * sunrise, so the two hours that bound the dark are the world's settings, and a
 * feature asking the clock asks `clockReading()` rather than keeping a boundary
 * of its own.
 */
import { MODULE_ID } from "./constants.mjs";

/** World setting gating every `game.time.advance` this module performs. */
export const SETTING_ADVANCE_WORLD_TIME = "advanceWorldTime";

/** True when this module may move the world clock. */
export const mayAdvanceWorldTime = () => game.settings.get(MODULE_ID, SETTING_ADVANCE_WORLD_TIME);

/**
 * World settings naming the hour it gets light and the hour it gets dark, on
 * the calendar's own clock. Either left blank stands at the day's quarter
 * points (`darkBounds`).
 */
export const SETTING_DAWN_HOUR = "dawnHour";
export const SETTING_DUSK_HOUR = "duskHour";

/**
 * Where the dark begins and ends on a day of `hoursPerDay` hours: the two
 * stated hours, a blank one standing at a quarter or three quarters of the
 * day. A stated hour is kept inside the day.
 * @returns {{dawn: number, dusk: number}}
 */
export function darkBounds(hoursPerDay, { dawn = null, dusk = null } = {}) {
  const day = Number(hoursPerDay) || 24;
  const stated = (value, fallback) => {
    const n = Number(value);
    return value == null || value === "" || !Number.isFinite(n) ? fallback : Math.min(Math.max(n, 0), day);
  };
  return { dawn: stated(dawn, day / 4), dusk: stated(dusk, (day * 3) / 4) };
}

/**
 * Whether an hour of the clock falls after dark. Light runs from `dawn` up to
 * `dusk`; a dusk before its dawn runs the light over midnight instead, which is
 * what a Judge who stated them that way round meant. Equal figures make a day
 * with no dark. Null for anything that is not an hour.
 */
export function isDarkAt(hour, { dawn, dusk }) {
  const h = Number(hour);
  if (![h, dawn, dusk].every(Number.isFinite)) return null;
  if (dawn === dusk) return false;
  const light = dawn < dusk ? h >= dawn && h < dusk : h >= dawn || h < dusk;
  return !light;
}

/**
 * What the world clock says: the hour and minute, the day's length, the dark's
 * bounds from the settings, and whether it is dark now. Null when the clock
 * keeps no calendar to read an hour from.
 * @returns {{hour: number, minute: number, hoursPerDay: number, dawn: number,
 *   dusk: number, dark: boolean}|null}
 */
export function clockReading() {
  const hoursPerDay = Number(game.time?.calendar?.days?.hoursPerDay);
  const components = game.time?.components ?? null;
  const hour = Number(components?.hour);
  if (!Number.isFinite(hoursPerDay) || !Number.isFinite(hour)) return null;
  const bounds = darkBounds(hoursPerDay, {
    dawn: game.settings.get(MODULE_ID, SETTING_DAWN_HOUR),
    dusk: game.settings.get(MODULE_ID, SETTING_DUSK_HOUR),
  });
  return { hour, minute: Number(components?.minute) || 0, hoursPerDay, ...bounds, dark: !!isDarkAt(hour, bounds) };
}

/**
 * Register a callback fired when world time moves forward, on the one GM
 * client that is responsible for acting on it.
 *
 * Every feature that reacts to the calendar shares this registrar rather than
 * guarding a hook of its own: the "am I the active GM" test is what stops a
 * two-GM table processing the same day twice, and one copy of it is the only
 * way it stays one answer. Callbacks must be idempotent — each keeps its own
 * watermark, because the hook also fires for a clock the Judge dragged.
 *
 * @param {(worldTime: number, dt: number) => void} callback  seconds, and the
 *   forward step that produced them.
 */
export function onWorldTimeAdvanced(callback) {
  Hooks.on("updateWorldTime", (worldTime, dt) => {
    if (!game.users.activeGM || game.user !== game.users.activeGM) return;
    if (dt <= 0) return;
    callback(Math.floor(worldTime), dt);
  });
}
