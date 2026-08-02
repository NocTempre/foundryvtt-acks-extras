/* global game, Hooks */
/**
 * Time helpers — all recruitment/wage state is anchored on
 * `game.time.worldTime` seconds so any worldTime-driven clock (the core
 * combat tracker, Simple Timekeeping, manual advance buttons) moves it.
 * Month length is the `daysPerMonth` world setting (v14's calendar month
 * component advances 0 seconds — acks-domains module/time.mjs documents the
 * bug — so months are day-counted here).
 */
import { SECONDS_PER_DAY, SECONDS_PER_WEEK } from "./constants.mjs";
import { getSetting } from "./settings.mjs";

export function now() {
  return Math.floor(game.time.worldTime);
}

export function secondsPerMonth() {
  // No-calendar fallback: 4 weeks (28 days), per RAW's weekly market cadence.
  return (Number(getSetting("daysPerMonth")) || 28) * SECONDS_PER_DAY;
}

/* ------------------------- calendar alignment ------------------------- */
/**
 * When the world runs a calendar (core v13+ CalendarData), market months
 * LINE UP WITH IT: the month rolls over when the calendar month changes and
 * anchors at the calendar month's first second (so week-1 arrivals land in
 * the month's first week). Without a usable calendar, months stay
 * day-counted via the `daysPerMonth` setting.
 *
 * All reads go through timeToComponents/month lengths — NEVER
 * componentsToTime, which ignores the month component (family-documented
 * v14 bug, see acks-domains module/time.mjs).
 */

function calendarOf() {
  try {
    const cal = game.time?.calendar;
    if (!cal?.months?.values?.length || typeof cal.timeToComponents !== "function") return null;
    const d = cal.days;
    if (!d?.hoursPerDay || !d?.minutesPerHour || !d?.secondsPerMinute) return null;
    return cal;
  } catch {
    return null;
  }
}

/** `"year:month"` bucket for a worldTime, or null when no usable calendar. */
export function calendarMonthKey(t) {
  const cal = calendarOf();
  if (!cal) return null;
  try {
    const c = cal.timeToComponents(t);
    if (c?.year == null || c?.month == null) return null;
    return `${c.year}:${c.month}`;
  } catch {
    return null;
  }
}

/**
 * First second of the calendar month containing `t` (null without a
 * calendar). Derived by subtracting the elapsed-in-month components — day
 * numbering base is read off the components themselves (day-of-month is
 * 0-based in core v13+; tolerate 1-based by probing the month start).
 */
export function calendarMonthStart(t) {
  const cal = calendarOf();
  if (!cal) return null;
  try {
    const c = cal.timeToComponents(t);
    const spd = cal.days.hoursPerDay * cal.days.minutesPerHour * cal.days.secondsPerMinute;
    const dayOfMonth = c.dayOfMonth ?? c.day;
    if (dayOfMonth == null) return null;
    const sph = cal.days.minutesPerHour * cal.days.secondsPerMinute;
    let start = t - ((c.second ?? 0) + (c.minute ?? 0) * cal.days.secondsPerMinute + (c.hour ?? 0) * sph + dayOfMonth * spd);
    // 1-based day numbering leaves the start one day late — detect by
    // checking the previous second still lies in the same month.
    if (start > 0 && calendarMonthKey(start - 1) === calendarMonthKey(t)) start -= spd;
    return Math.max(0, Math.floor(start));
  } catch {
    return null;
  }
}

/** True when t0 and t1 fall in the same market month (calendar-aware). */
export function sameMarketMonth(t0, t1) {
  const k0 = calendarMonthKey(t0);
  const k1 = calendarMonthKey(t1);
  if (k0 != null && k1 != null) return k0 === k1;
  return Math.floor(t0 / secondsPerMonth()) === Math.floor(t1 / secondsPerMonth());
}

/**
 * When the NEXT market month begins (the next whole-market roll), given the
 * current anchor. Calendar worlds: the next calendar month's first second
 * (variable month lengths probed day by day); day-counted: anchor + month.
 */
export function nextMarketRollTime(monthAnchorTime, t = now()) {
  const key = calendarMonthKey(t);
  if (key != null) {
    const spd = SECONDS_PER_DAY;
    let probe = t;
    for (let i = 0; i < 64; i++) {
      probe += spd;
      if (calendarMonthKey(probe) !== key) return calendarMonthStart(probe) ?? probe;
    }
    return null;
  }
  if (!monthAnchorTime) return null;
  return monthAnchorTime + secondsPerMonth();
}

export function daysBetween(t0, t1) {
  return Math.floor((t1 - t0) / SECONDS_PER_DAY);
}

export function weeksBetween(t0, t1) {
  return Math.floor((t1 - t0) / SECONDS_PER_WEEK);
}

export function monthsBetween(t0, t1) {
  return Math.floor((t1 - t0) / secondsPerMonth());
}

/** GM convenience: advance the shared world clock (gated by setting). */
export async function advanceDays(days) {
  if (!game.user.isGM) return;
  if (!getSetting("advanceWorldTime")) {
    ui.notifications.info(game.i18n.localize("ACKS-HENCHMEN.time.advanceDisabled"));
    return;
  }
  await game.time.advance(days * SECONDS_PER_DAY);
}

/**
 * Register a due-processing callback fired on the GM client whenever world
 * time moves forward. Processing must be idempotent — each consumer keeps its
 * own `lastProcessedTime` watermark.
 */
export function onTimeAdvanced(callback) {
  Hooks.on("updateWorldTime", (worldTime, dt) => {
    if (!game.users.activeGM || game.user !== game.users.activeGM) return;
    if (dt <= 0) return;
    callback(Math.floor(worldTime), dt);
  });
}
