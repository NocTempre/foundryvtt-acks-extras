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
 * The sky's toll on the body is applied here too, after each body's meal and
 * exposure walk: the sun's burn, the heat's armour save, the cold's mark and
 * the week's disease (RR 277-279). The runs of consecutive days that disease
 * counts belong to the party's weather, so they live on the formation record.
 * Every outcome is told on one whispered card, and only on a day that has one.
 *
 * Only the journey calls this. A dungeon delve keeps its own ration
 * bookkeeping, which counts turns rather than days and has no pool.
 */
import { MODULE_ID, RATION_PATTERN } from "./constants.mjs";
import { getMemberActor, hasAbility, patchFormation, realMembers } from "./formation-model.mjs";
import { provisionDay, daysCarried, SETTING_SHARE_POLICY } from "./provisions.mjs";
import {
  advanceSurvival, advanceExposureHour, survivalOf, freshSurvival,
  heatBurden, thirstDie, coldDie, isDiceExpression,
} from "../lib/survival.mjs";
import { travelOf } from "./travel.mjs";
import { conditionsOf } from "./weather.mjs";
import { weatherEffects } from "./weather-effects.mjs";
import { hasCapability } from "../lib/capabilities.mjs";
import { adjustHp, resolveTargets } from "../lib/hp.mjs";
import { HP_MODE } from "../lib/hp-logic.mjs";
import { STONE, isWorn, sumWeight6, weight6Of } from "../lib/item-model.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";
import { conditionStacksOf, setConditionStacks } from "../lib/status-effects.mjs";
import { renderRollCard } from "../lib/roll-card.mjs";
import { postToJudges } from "../lib/roll-audience.mjs";
import { makeLoc, numOrNull } from "../lib/util.mjs";

const loc = makeLoc("ACKS-FORMATION");

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
export function sheltered(actor) {
  return (actor?.items ?? []).some((i) => SHELTER_PATTERN.test(i?.name ?? ""));
}

/**
 * The armour this body has on, in stone: the sum of its worn armour items. The
 * figure the heat's armour save and a night slept in kit are both measured by.
 * Items are spread first: an embedded collection is not an array.
 */
export function wornArmourStone(actor) {
  const worn = [...(actor?.items ?? [])].filter((i) => i?.type === ITEM_TYPE.armor && isWorn(i));
  return sumWeight6(worn, weight6Of) / STONE;
}

/** The ability that keeps the sun's burn off a body. */
const SAVAGE_RESILIENCE = /savage resilience/i;

/** One roll's total. */
async function throwDie(formula) {
  return (await new Roll(formula).evaluate()).total;
}

/** The target a death save is rolled against, or null when the sheet states none. */
const deathTarget = (actor) => numOrNull(actor?.system?.saves?.death?.value);

/** The weather's runs of consecutive days on the record, as whole numbers keyed by condition. */
function weatherRunsOf(formation) {
  const raw = travelOf(formation).weatherRuns ?? formation?.travel?.weatherRuns ?? {};
  const runs = {};
  for (const [key, n] of Object.entries(raw)) runs[key] = Math.max(0, Math.floor(Number(n) || 0));
  return runs;
}

/**
 * Advance the weather's disease runs by one day. A condition in `diseaseFx`
 * with both figures imported climbs by one; every other key drops, because a
 * run that breaks starts over. A run that reaches its count is due and resets.
 *
 * @returns {{runs: Record<string, number>, due: Array<{key: string, days: number, pct: number}>}}
 */
function advanceWeatherRuns(prior, diseaseFx) {
  const runs = {};
  const due = [];
  for (const entry of diseaseFx ?? []) {
    if (entry.days == null || entry.pct == null || entry.days <= 0) continue;
    const run = (prior[entry.key] ?? 0) + 1;
    if (run >= entry.days) {
      due.push({ key: entry.key, days: entry.days, pct: entry.pct });
      runs[entry.key] = 0;
    } else runs[entry.key] = run;
  }
  return { runs, due };
}

/** The sun's damage: a rolled die or a flat figure; null when unimported. */
async function sunburnDamage(sunburn) {
  if (isDiceExpression(sunburn.damage)) return throwDie(String(sunburn.damage).replace(/\s+/g, ""));
  const flat = numOrNull(sunburn.damage);
  return flat != null && flat > 0 ? flat : null;
}

/** Write damage to one actor through the hit-point tool; the amount that landed, or 0. */
async function damageActor(actor, amount) {
  const target = resolveTargets({ actors: [actor] }).find((t) => !t.reason && t.hp);
  if (!target) return 0;
  const [result] = await adjustHp([{ target, amount }], { mode: HP_MODE.damage });
  return result?.ok ? amount : 0;
}

/**
 * What the sky does to one body beyond its meals: the sun's burn, the heat's
 * armour save, the cold's mark and the week's disease. Each outcome is a field
 * on the returned object only when it happened.
 */
async function weatherToll(actor, { fx, band, hours, warm, state, dueDiseases }) {
  const toll = {};

  const sun = fx.sunburn;
  const sunHours = numOrNull(sun?.hours);
  const resilient = hasCapability(actor, "kw:savageResilience") || hasAbility(actor, SAVAGE_RESILIENCE);
  if (sun && sunHours != null && hours >= sunHours && !warm && !resilient) {
    const damage = await sunburnDamage(sun);
    if (damage != null) {
      await damageActor(actor, damage);
      toll.sunburn = { damage, type: sun.type ?? null };
    }
  }

  // The heat's armour save is measured against the armour this body wears, not
  // the band's average: each hour of exposure in too much of it is a throw.
  const burden = heatBurden({ band, armourStone: wornArmourStone(actor) });
  const death = deathTarget(actor);
  if (burden.armourSave && hours > 0 && death != null) {
    let failedAt = null;
    let thrown = 0;
    let last = null;
    for (let h = 1; h <= hours && failedAt == null; h++) {
      last = await throwDie("1d20");
      thrown = h;
      if (last < death) failedAt = h;
    }
    if (failedAt != null) {
      await setConditionStacks(actor, "fatigued", conditionStacksOf(actor, "fatigued") + 1);
    }
    toll.heatSaves = { hours: thrown, failedAt, total: last, target: death };
  }

  if (fx.frostbite && state.exposure === "hypothermic" && death != null) {
    const total = await throwDie("1d20");
    const failed = total < death;
    if (failed) await actor.toggleStatusEffect("frostbitten", { active: true });
    toll.frostbite = { total, target: death, failed, die: fx.frostbite.die ?? null, row: fx.frostbite.row ?? null };
  }

  if (dueDiseases.length) {
    const throws = [];
    for (const due of dueDiseases) {
      const total = await throwDie("1d100");
      const caught = total <= due.pct;
      if (caught) await actor.toggleStatusEffect("diseased", { active: true });
      throws.push({ key: due.key, total, pct: due.pct, caught });
    }
    toll.diseaseThrows = throws;
    toll.disease = throws.find((t) => t.caught) ?? throws[0];
  }
  return toll;
}

/** The "weather's toll" rows of a day's report, one section per kind of harm. */
function tollSections(report) {
  const rowsFor = (pick) => report.filter((r) => pick(r)).map((r) => ({ name: r.name, ...pick(r) }));
  const sections = [];
  const add = (key, rows) => rows.length && sections.push({ title: loc(`toll.${key}.title`), rows });

  add("sunburn", rowsFor((r) => r.sunburn && {
    total: r.sunburn.damage, outcome: loc("toll.sunburn.outcome"), emphasis: "failure",
  }));
  add("heat", rowsFor((r) => r.heatSaves && {
    total: r.heatSaves.total ?? "", target: r.heatSaves.target,
    detail: loc("toll.heat.detail", { hours: r.heatSaves.hours }),
    outcome: loc(r.heatSaves.failedAt == null ? "toll.saved" : "toll.heat.failed", { hour: r.heatSaves.failedAt }),
    emphasis: r.heatSaves.failedAt == null ? "success" : "failure",
  }));
  add("frostbite", rowsFor((r) => r.frostbite && {
    total: r.frostbite.total, target: r.frostbite.target,
    detail: r.frostbite.failed && (r.frostbite.die || r.frostbite.row)
      ? loc("toll.frostbite.detail", { die: r.frostbite.die ?? "", row: r.frostbite.row ?? "" }) : undefined,
    outcome: loc(r.frostbite.failed ? "toll.frostbite.failed" : "toll.saved"),
    emphasis: r.frostbite.failed ? "failure" : "success",
  }));
  add("disease", report.flatMap((r) => (r.diseaseThrows ?? []).map((t) => ({
    name: r.name, total: t.total, detail: loc("toll.disease.detail", { pct: t.pct }),
    outcome: loc(t.caught ? "toll.disease.caught" : "toll.disease.escaped"),
    emphasis: t.caught ? "failure" : "success",
  }))));
  return sections;
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

  // What the sky does beyond the meals. Disease runs live on the formation,
  // because a run of days is the party's weather, not one body's; they are
  // advanced once for the day, and a run that comes due is thrown per member.
  const fx = weatherEffects(conditionsOf(travel.weather), { terrain: travel.ground });
  const prior = weatherRunsOf(formation);
  const { runs, due } = advanceWeatherRuns(prior, fx.disease);
  if (formation?.id && JSON.stringify(runs) !== JSON.stringify(prior)) {
    await patchFormation(formation.id, (rec) => {
      rec.travel = { ...rec.travel, weatherRuns: runs };
    });
  }

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
    const toll = await weatherToll(actor, { fx, band, hours, warm, state, dueDiseases: due });
    report.push({
      ...toll,
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

  // The toll is told only on a day something was thrown or dealt; the day's
  // own log already carries hunger.
  const sections = tollSections(report);
  if (sections.length) {
    try {
      await postToJudges({
        speaker: { alias: loc("toll.speaker") },
        content: renderRollCard({
          title: loc("toll.title"),
          subtitle: formation?.name ?? "",
          sections,
          footnote: loc("toll.footnote"),
        }),
      });
    } catch (err) {
      console.error(`${MODULE_ID} | the weather's toll could not be posted; the day still ends`, err);
    }
  }

  return {
    report,
    weatherRuns: runs,
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
