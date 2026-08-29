/**
 * Feeding a marching order: the group half of survival.
 *
 * [lib/survival.mjs](../lib/survival.mjs) owns what going without DOES to one
 * body. This owns the part that is a party problem — who has the food, who
 * needs it, and what happens when there is not enough to go round.
 *
 * The rule the whole file exists for: **a party shares.** Rations sit in
 * whichever packs happen to hold them, and a marching order does not let one
 * character starve beside another's full sack. So supply is pooled across the
 * order and dealt out, and only when the pool cannot cover everyone does anyone
 * go short.
 *
 * How the shortfall is spread is a JUDGE'S call, not ours, so the two honest
 * policies both ship: `even` puts everybody on the same reduced ration, and
 * `triage` feeds as many as can be fed fully and leaves the remainder empty.
 * Neither is in the book — the book prices what a hungry body suffers, not who
 * a captain chooses to feed — so this is a setting, and it defaults to even.
 *
 * Pure: it takes counts and returns an allocation. Reading packs and writing
 * conditions belong to the caller.
 */

/**
 * Days of a provision an actor is carrying.
 *
 * The ONE reader, because a second one is a second answer to "how much food is
 * there" and the two disagree the moment anything is added by a path the other
 * does not know about — which is exactly what happened when foraging began
 * depositing items the ration pattern did not match.
 *
 * It counts two things: items whose NAME says what they are, and items this
 * module flagged when it put them there. A week's worth counts as a week.
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
 * `advanceSurvival`.
 *
 * `even` is deliberately coarse: a pool that cannot feed everyone fully but can
 * feed everyone halfway does exactly that, and one that cannot manage even half
 * leaves the whole order empty rather than pretending a sip is a meal. That
 * coarseness is the ladder's, not ours — it only knows three levels.
 */
export function dealProvisions({ mouths = 0, supply = 0, policy = "even", need = 1 } = {}) {
  const n = Math.max(0, Math.floor(Number(mouths) || 0));
  const have = Math.max(0, Number(supply) || 0);
  if (!n) return { levels: [], remaining: have, short: false };

  // `need` is what ONE mouth costs today. The heat asks for more water than a
  // mild day does, and a pool that would have covered everyone yesterday does
  // not stretch — which is the whole point of the rule.
  const per = Number(need) > 0 ? Number(need) : 1;
  const wanted = n * per;

  if (have >= wanted) {
    return { levels: Array(n).fill("full"), remaining: have - wanted, short: false };
  }

  if (policy === "triage") {
    // Feed as many as can be fed properly; the rest get nothing. A captain's
    // choice, and the reason it is not the default.
    const fed = Math.floor(have / per);
    const levels = Array.from({ length: n }, (_, i) => (i < fed ? "full" : "none"));
    return { levels, remaining: have - (fed * per), short: true, fed };
  }

  // Even: everyone takes the same cut, rounded DOWN to a level the ladder
  // recognises. Half a ration each, or nothing each.
  const each = have / n / per;
  const level = each >= 1 ? "full" : each >= 0.5 ? "half" : "none";
  const spent = level === "full" ? wanted : level === "half" ? wanted * 0.5 : 0;
  return { levels: Array(n).fill(level), remaining: Math.max(0, have - spent), short: true, level };
}

/**
 * A day's provisioning for the whole order, both provisions at once.
 *
 * Food and water are dealt independently — a party can be well fed and parched,
 * and in a desert usually is — so they get their own pools and their own
 * shortfalls rather than one combined verdict.
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
 * What the order needs for one more day, so a Judge can see the gap before
 * walking into it rather than after.
 */
export function provisionForecast({ mouths = 0, food = 0, water = 0, waterNeed = 1 } = {}) {
  const n = Math.max(0, Math.floor(Number(mouths) || 0));
  const per = Number(waterNeed) > 0 ? Number(waterNeed) : 1;
  return {
    mouths: n,
    foodDays: n > 0 ? Math.floor(Number(food) / n) : null,
    // The heat shortens the water forecast without anyone drinking faster.
    waterDays: n > 0 ? Math.floor(Number(water) / (n * per)) : null,
    waterNeed: per,
  };
}
