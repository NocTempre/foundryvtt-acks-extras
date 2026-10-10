/**
 * The body's night: fatigue as a ladder walked a day at a time, and what makes
 * a night's rest restful (RR 277-279).
 *
 * Beside [survival.mjs](./survival.mjs), for the same reason: a besieged
 * garrison tires, and so does a party on the road, so the ladder is not the
 * marching order's. Pure, no Foundry globals; the caller owns the dice (the
 * armoured sleeper's throw is passed in) and the writes.
 *
 * What ships is the SHAPE: which things tire a body (a forced march, nights
 * without restful sleep, a run of days of activity), that a labourer is exempt
 * from the last and nobody from the first, that a fatigued body only recovers
 * on a dedicated rest day that is also restful, and that Endurance buys more
 * nights without. Every day count, every allowance and every per-stone figure
 * arrives through the registered `survival` document (`fatigue` and `sleep`
 * tables). A figure nobody imported means its trigger cannot fire, and the
 * step says so in `unpriced` rather than tiring a body on invented timing.
 */
import { numOrNull } from "./util.mjs";
import { survivalTable } from "./survival.mjs";

/** The `survival` document's table of fatigue thresholds. */
export const FATIGUE_TABLE = "fatigue";

/** The `survival` document's table of sleeping-in-armour figures. */
export const SLEEP_TABLE = "sleep";

const figure = (table, key) => numOrNull(survivalTable(table)?.[key]);

const wholeDays = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.floor(Number(v)) : 0);

/** A rested body: no days of activity, no sleepless nights and no forced marches behind it. */
export function freshFatigue() {
  return { activityDays: 0, sleeplessDays: 0, forcedDays: 0 };
}

/** Normalize whatever a record holds. */
export function fatigueOf(state) {
  const s = state ?? {};
  return {
    activityDays: wholeDays(s.activityDays),
    sleeplessDays: wholeDays(s.sleeplessDays),
    forcedDays: wholeDays(s.forcedDays),
  };
}

/**
 * The extra nights a body may go without restful sleep.
 *
 * Zero without Endurance. With it, the imported base, plus the imported rate
 * per point of Constitution bonus, plus the imported extra for a body that is
 * also a labourer. Null when the base itself is unimported: Endurance then buys
 * nothing the module can state, and a caller treats null as zero.
 */
export function enduranceAllowance({ endurance = false, labor = false, conBonus = 0 } = {}) {
  if (!endurance) return 0;
  const base = figure(FATIGUE_TABLE, "enduranceDays");
  if (base == null) return null;
  const perPoint = figure(FATIGUE_TABLE, "endurancePerConPoint") ?? 0;
  const laborExtra = labor ? figure(FATIGUE_TABLE, "enduranceLaborExtra") ?? 0 : 0;
  return base + perPoint * Math.max(0, Number(conBonus) || 0) + laborExtra;
}

/**
 * The throw a sleeper in armour makes: restful only when the roll is over the
 * armour's weight in stone. Pure; the caller rolls the die.
 */
export function armourSleepThrow({ stone = 0, roll = 0 } = {}) {
  return { restful: Number(roll) > Number(stone), stone: Number(stone), roll: Number(roll) };
}

/**
 * Rounds a body needs to put its armour back on, from the imported rounds per
 * stone. Whole rounds, rounded up. Null when unimported.
 */
export function donRounds(stone) {
  const per = figure(SLEEP_TABLE, "donRoundsPerStone");
  if (per == null) return null;
  return Math.ceil(per * Math.max(0, Number(stone) || 0));
}

/**
 * Was the night restful, and if not, every reason why.
 *
 * Reasons, in the order they are tested: `noSleep` (the night was not slept),
 * `cold` (the sky asks for a heat source, clothing, or both, and the body had
 * less), `armour` (it slept in its kit and the throw did not clear its weight).
 *
 * @param {object} opts
 * @param {boolean} [opts.noSleep]  the Judge declared the night unslept
 * @param {{fire?: boolean, clothing?: boolean, both?: boolean}|null} [opts.rest]
 *   what the day's weather asks of a night (`weatherEffects(...).rest`)
 * @param {boolean} [opts.atHeatSource]  the camp had a fire
 * @param {boolean} [opts.sheltered]  the body carries clothing for the cold
 * @param {{stone: number, roll: number}|null} [opts.armour]  the throw of a
 *   sleeper who kept their kit on
 * @returns {{restful: boolean, reasons: string[]}}
 */
export function restfulNight({
  noSleep = false, rest = null, atHeatSource = false, sheltered = false, armour = null,
} = {}) {
  const reasons = [];
  if (noSleep) reasons.push("noSleep");
  if (rest) {
    if (rest.both) {
      if (!(atHeatSource && sheltered)) reasons.push("cold");
    } else {
      const options = [rest.fire && atHeatSource, rest.clothing && sheltered];
      const asked = !!(rest.fire || rest.clothing);
      if (asked && !options.some(Boolean)) reasons.push("cold");
    }
  }
  if (armour && !armourSleepThrow(armour).restful) reasons.push("armour");
  return { restful: reasons.length === 0, reasons };
}

/**
 * One day passes and the night closes. Returns the body's next ladder state,
 * the fatigue stacks it now carries and why they moved.
 *
 * `dayKind` is the day's kind (`march`, `camp`, `forced`). A dedicated rest day
 * is a `camp` day with no forced march; any other day counts as activity.
 *
 * Triggers, each a reason: `forcedMarch` (consecutive days of forced march
 * reach the imported count; nobody is exempt), `sleepless` (nights without
 * restful sleep reach the imported count plus the body's Endurance allowance),
 * `run` (days of activity reach the imported count; a labourer is exempt). A
 * fatigued body gains a stack on every day it stays fatigued, and the
 * condition ends only on a dedicated rest day with a restful night.
 *
 * @returns {{state: {activityDays: number, sleeplessDays: number, forcedDays: number}, stacks: number,
 *   reasons: string[], unpriced: boolean}} `reasons` also carries `rested` when
 *   the condition ended and `lingers` when a fatigued body stayed so with no
 *   fresh trigger. `unpriced` is true when none of the three thresholds is imported.
 */
export function fatigueStep(state, {
  dayKind = "march", restful = true, forcedMarch = false, labor = false, allowance = 0, stacks = 0,
} = {}) {
  const prior = fatigueOf(state);
  const held = wholeDays(stacks);
  const restDay = dayKind === "camp" && !forcedMarch;
  const next = {
    activityDays: restDay ? 0 : prior.activityDays + 1,
    sleeplessDays: restful ? 0 : prior.sleeplessDays + 1,
    forcedDays: forcedMarch ? prior.forcedDays + 1 : 0,
  };

  const forcedAt = figure(FATIGUE_TABLE, "forcedMarchDays");
  const sleeplessAt = figure(FATIGUE_TABLE, "sleeplessDays");
  const activityAt = figure(FATIGUE_TABLE, "activityDays");
  const extra = numOrNull(allowance) ?? 0;

  const triggers = [];
  if (forcedAt != null && next.forcedDays >= forcedAt) triggers.push("forcedMarch");
  if (sleeplessAt != null && next.sleeplessDays >= sleeplessAt + extra) triggers.push("sleepless");
  if (!labor && activityAt != null && next.activityDays >= activityAt) triggers.push("run");

  const ends = restDay && restful;
  const reasons = [...triggers];
  let count;
  if (ends) {
    count = 0;
    if (held > 0) reasons.push("rested");
  } else if (held > 0 || triggers.length) {
    count = held + 1;
    if (held > 0 && !triggers.length) reasons.push("lingers");
  } else {
    count = 0;
  }

  return {
    state: next,
    stacks: count,
    reasons,
    unpriced: forcedAt == null && sleeplessAt == null && activityAt == null,
  };
}
