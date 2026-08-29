/* global game, Roll */
/**
 * A day's provisioning, actually applied.
 *
 * [provisions.mjs](./provisions.mjs) deals the pool and
 * [lib/survival.mjs](../lib/survival.mjs) walks the ladder; both are pure. This
 * is the impure half that reads the packs, spends them, and writes each body's
 * state — kept apart so the arithmetic stays testable without a world.
 *
 * A body's hunger belongs to the BODY, not to the marching order it happens to
 * be standing in: the state is a flag on the actor, so a character who leaves
 * the party takes their hunger with them and one who joins arrives with
 * whatever they have been living on.
 *
 * Only the journey calls this. A dungeon delve keeps its own ration
 * bookkeeping, which counts turns rather than days and has no pool.
 */
import { MODULE_ID, RATION_PATTERN } from "./constants.mjs";
import { getMemberActor, realMembers } from "./formation-model.mjs";
import { provisionDay, daysCarried, SETTING_SHARE_POLICY } from "./provisions.mjs";
import {
  advanceSurvival, advanceExposureHour, survivalOf, freshSurvival,
  heatBurden, thirstDie, coldDie,
} from "../lib/survival.mjs";
import { travelOf } from "./travel.mjs";

/** Where a body's hunger lives. On the ACTOR, because it is the body's. */
export const SURVIVAL_FLAG = "survival";

/** Water is carried, not eaten; its items are named for the vessel. */
export const WATER_PATTERN = /water|skin|canteen/i;

/**
 * What the order carries, counting BOTH named provisions and anything foraging
 * deposited. Hunted game feeds a party exactly as rations do.
 */
export const FOOD_SOURCES = Object.freeze({ pattern: RATION_PATTERN, foraged: "food" });
export const WATER_SOURCES = Object.freeze({ pattern: WATER_PATTERN, foraged: "water" });

/** Game counts as food; it is a separate flag only so a Judge can tell them apart. */
function foodDays(actor) {
  return daysCarried(actor, FOOD_SOURCES) + daysCarried(actor, { foraged: "hunt" });
}

/** The sharing policy this world uses, defaulting to the kinder reading. */
function policy() {
  try {
    return game.settings.get(MODULE_ID, SETTING_SHARE_POLICY) ?? "even";
  } catch {
    return "even";
  }
}

/** Clothing that answers the cold. Named for the garment, as the packs name it. */
export const SHELTER_PATTERN = /cloak|fur|parka|blanket|winter|cold weather|protective clothing/i;

/** Does this body carry something to keep the weather off? */
function sheltered(actor) {
  return (actor?.items ?? []).some((i) => SHELTER_PATTERN.test(i?.name ?? ""));
}

/**
 * The cold's hours, applied to one body.
 *
 * Walks the clock an HOUR at a time rather than charging the block at once,
 * because the rung is reached mid-stretch and every hour after it costs: a
 * body that goes six hours past the threshold owes six tolls, not one. Each
 * hour rolls its own die for the same reason a party does not share one.
 */
async function walkExposure(state, { hours, band, protectedFrom, atHeatSource, wet, die }) {
  let s = state;
  let drain = 0;
  let unrolled = false;
  let worsened = false;
  for (let h = 0; h < hours; h++) {
    const coldRoll = die ? (await new Roll(die).evaluate()).total : null;
    const step = advanceExposureHour(s, { band, protectedFrom, atHeatSource, wet, coldRoll });
    s = step.state;
    drain += step.drain;
    unrolled = unrolled || step.unrolled;
    worsened = worsened || step.worsened;
  }
  return { state: s, drain, unrolled, worsened };
}

/**
 * Feed the order for one day and walk every ladder one step.
 *
 * Returns a per-member report — what they got, where it left them, and what it
 * cost — so the panel can say who is suffering without re-deriving any of it.
 * Nothing is written when there is nobody to feed.
 */
export async function runProvisionDay(formation) {
  if (!game.user?.isGM) return null;
  const members = realMembers(formation ?? {});
  const actors = members.map(getMemberActor).filter(Boolean);
  if (!actors.length) return null;

  const food = actors.reduce((n, a) => n + foodDays(a), 0);
  const water = actors.reduce((n, a) => n + daysCarried(a, WATER_SOURCES), 0);
  // The heat asks for more water than a mild day does. The band comes from the
  // day's own weather, so a party crossing a desert feels it without anyone
  // remembering to say so.
  const burden = heatBurden({ band: travelOf(formation).weather?.temperature ?? "" });
  const day = provisionDay({
    mouths: actors.length, food, water, policy: policy(), waterNeed: burden.waterNeed,
  });

  // Thirst charges a rolled toll, and the ladder stays pure, so the dice are
  // thrown here. Each body throws its own — a shared roll would make a party
  // suffer in lockstep, which is a different rule than the one printed.
  const die = thirstDie();
  const cold = coldDie();

  // The weather the order stood in, and for how long. The hours are declared,
  // not inferred: a marching day is not automatically a day unprotected.
  const travel = travelOf(formation);
  const band = travel.weather?.temperature ?? "";
  const exposure = travel.exposure ?? { hours: 0, atHeatSource: false, wet: false };
  const hours = Math.min(24, Math.max(0, Math.floor(Number(exposure.hours) || 0)));

  const report = [];
  for (const [i, actor] of actors.entries()) {
    const meal = day.meals[i] ?? { food: "none", water: "none" };
    const before = survivalOf(actor.getFlag(MODULE_ID, SURVIVAL_FLAG) ?? freshSurvival());
    const thirstRoll = die ? (await new Roll(die).evaluate()).total : null;
    const step = advanceSurvival(before, {
      ...meal, thirstRoll, heat: burden.dehydrationDrain,
    });

    // The cold runs on its own clock, so it is walked after the day's meal
    // rather than folded into it. A body with a cloak is protected; one that
    // got wet is not, however well dressed.
    const warm = sheltered(actor);
    let state = step.state;
    let chill = { drain: 0, unrolled: false, worsened: false };
    if (hours > 0) {
      chill = await walkExposure(state, {
        hours,
        band,
        protectedFrom: warm,
        atHeatSource: !!exposure.atHeatSource,
        wet: !!exposure.wet,
        die: cold,
      });
      state = chill.state;
    }

    await actor.setFlag(MODULE_ID, SURVIVAL_FLAG, state);
    report.push({
      actorId: actor.id,
      name: actor.name,
      meal,
      nourishment: state.nourishment,
      hydration: state.hydration,
      exposure: state.exposure,
      sheltered: warm,
      drain: step.drain + chill.drain,
      unrolled: step.unrolled || chill.unrolled,
      worsened: step.worsened || chill.worsened,
      eased: step.eased,
    });
  }

  return {
    report,
    short: day.short,
    food: day.food,
    water: day.water,
    pooled: { food, water },
    exposure: { hours, band, atHeatSource: !!exposure.atHeatSource, wet: !!exposure.wet },
  };
}

/** One body's state, for a readout. Never throws on an unprovisioned actor. */
export function survivalStateOf(actor) {
  return survivalOf(actor?.getFlag?.(MODULE_ID, SURVIVAL_FLAG) ?? freshSurvival());
}
