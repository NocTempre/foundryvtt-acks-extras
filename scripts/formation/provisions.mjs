/**
 * Feeding a marching order: the group half of survival.
 *
 * [lib/survival.mjs](../lib/survival.mjs) owns what going without DOES to one
 * body. This owns the party half: supply is pooled across the order and dealt
 * out, under the Judge's sharing policy (`even` or `triage`). Pure: it takes
 * counts and returns an allocation; reading packs and writing conditions belong
 * to the caller. See docs/formation/MODEL.md, "Provisions".
 */

/**
 * Days of a provision an actor is carrying: items whose NAME matches `pattern`
 * plus items this module flagged `foraged` with the given kind; a week's worth
 * counts as seven. The ONE reader of supply; nothing else counts it.
 */
export function daysCarried(actor, { pattern, foraged = null } = {}) {
  let days = 0;
  for (const item of actor?.items ?? []) {
    const named = pattern ? pattern.test(item.name ?? "") : false;
    const tagged = foraged ? item.getFlag?.("acks-extras", "foraged") === foraged : false;
    if (!named && !tagged) continue;
    const qty = Number(item.system?.quantity?.value ?? 0);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    days += qty * (/week/i.test(item.name ?? "") ? 7 : 1);
  }
  return days;
}

/** How a shortfall is spread across the order. */
export const SHARE_POLICIES = Object.freeze({
  even: { label: "ACKS-FORMATION.provisions.policy.even" },
  triage: { label: "ACKS-FORMATION.provisions.policy.triage" },
});

/** The world setting naming the policy. */
export const SETTING_SHARE_POLICY = "provisionSharing";

/**
 * Deal `supply` days of one provision across `mouths`.
 *
 * Returns a ration level per mouth in the order given, plus what the pool has
 * left. Levels are survival's own vocabulary, so the result feeds straight into
 * `advanceSurvival`. `even` deals full, half or nothing, the ladder's three
 * levels.
 */
export function dealProvisions({ mouths = 0, supply = 0, policy = "even", need = 1 } = {}) {
  const n = Math.max(0, Math.floor(Number(mouths) || 0));
  const have = Math.max(0, Number(supply) || 0);
  if (!n) return { levels: [], remaining: have, short: false };

  // `need` is what ONE mouth costs today.
  const per = Number(need) > 0 ? Number(need) : 1;
  const wanted = n * per;

  if (have >= wanted) {
    return { levels: Array(n).fill("full"), remaining: have - wanted, short: false };
  }

  if (policy === "triage") {
    // Feed as many as can be fed properly; the rest get nothing.
    const fed = Math.floor(have / per);
    const levels = Array.from({ length: n }, (_, i) => (i < fed ? "full" : "none"));
    return { levels, remaining: have - (fed * per), short: true, fed };
  }

  // Even: everyone takes the same cut, rounded DOWN to a level the ladder recognises.
  const each = have / n / per;
  const level = each >= 1 ? "full" : each >= 0.5 ? "half" : "none";
  const spent = level === "full" ? wanted : level === "half" ? wanted * 0.5 : 0;
  return { levels: Array(n).fill(level), remaining: Math.max(0, have - spent), short: true, level };
}

/**
 * A day's provisioning for the whole order, both provisions at once.
 *
 * Food and water are dealt independently, each with its own pool and shortfall.
 */
export function provisionDay({ mouths = 0, food = 0, water = 0, policy = "even", waterNeed = 1 } = {}) {
  const f = dealProvisions({ mouths, supply: food, policy });
  const w = dealProvisions({ mouths, supply: water, policy, need: waterNeed });
  return {
    meals: f.levels.map((level, i) => ({ food: level, water: w.levels[i] ?? "none" })),
    food: f,
    water: w,
    short: f.short || w.short,
  };
}

/**
 * How many days the order's food and water cover, for the forecast.
 */
export function provisionForecast({ mouths = 0, food = 0, water = 0, waterNeed = 1 } = {}) {
  const n = Math.max(0, Math.floor(Number(mouths) || 0));
  const per = Number(waterNeed) > 0 ? Number(waterNeed) : 1;
  return {
    mouths: n,
    foodDays: n > 0 ? Math.floor(Number(food) / n) : null,
    waterDays: n > 0 ? Math.floor(Number(water) / (n * per)) : null,
    waterNeed: per,
  };
}
