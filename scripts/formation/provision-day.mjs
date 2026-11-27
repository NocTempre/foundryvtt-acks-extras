/* global game, Roll */
/**
 * A day's provisioning, actually applied.
 *
 * [provisions.mjs](./provisions.mjs) deals the pool and
 * [lib/survival.mjs](../lib/survival.mjs) walks the ladder; both are pure. This
 * is the impure half that reads the packs, spends them, and writes each body's
 * state, a flag on the actor.
 *
 * The sky's toll is applied here too, after each body's meal and exposure walk:
 * the sun's burn, the heat's armour save, the cold's mark and the week's
 * disease (RR 277-279). The runs of consecutive days that disease counts live
 * on the formation record. Every outcome is told on one whispered card.
 *
 * Only the journey calls this; a dungeon delve keeps its own ration bookkeeping.
 * See docs/formation/MODEL.md, "The weather's toll".
 */
import { MODULE_ID, WATER_PATTERN } from "./constants.mjs";
import { getMemberActor, hasAbility, patchFormation, realMembers } from "./formation-model.mjs";
import {
  LEVEL_SHARE, SETTING_SHARE_POLICY, daysCarried, provisionDay, provisionOf, tidy, unsizedProvisions,
} from "./provisions.mjs";
import {
  FED_FLAG, FOOD_AND_GAME, fedDayOf, refillActor, spendFood, spendShares, spendWater,
} from "./provision-spend.mjs";
import {
  HELD, advanceSurvival, advanceExposureHour, survivalOf, freshSurvival,
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

/** The actor flag holding a body's hunger state: it travels with the actor, not the party. */
export const SURVIVAL_FLAG = "survival";

export { WATER_PATTERN };

/** What counts as food: whatever `provisionOf` reads as food, foraged deposits included. */
export const FOOD_SOURCES = Object.freeze({ kind: "food" });

/** What counts as water: whatever `provisionOf` reads as water, foraged deposits included. */
export const WATER_SOURCES = Object.freeze({ kind: "water" });

/** Food days an actor carries: provisions plus hunted game, which is its own kind. An unsized item adds none. */
export function foodDaysOf(actor) {
  return daysCarried(actor, FOOD_SOURCES) + daysCarried(actor, { kind: "hunt" });
}

/** Water days an actor carries: what its vessels hold now. An unsized vessel adds none. */
export function waterDaysOf(actor) {
  return daysCarried(actor, WATER_SOURCES);
}

/** The sharing policy this world uses, `even` when unset or unreadable. */
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
 * The armour this body has on, in stone: the sum of its worn armour items, the
 * figure the heat's armour save and a night slept in kit are measured by.
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

  // Each hour of exposure in too much armour is a throw.
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
  add("held", report.filter((r) => r.held).map((r) => ({
    name: r.name,
    total: "",
    detail: Object.entries(r.held).map(([ladder, names]) => loc("toll.held.item", {
      kind: game.i18n.localize(`ACKS-EQUIPMENT.itemSheet.provision.kind.${ladder}`),
      items: names.join(", "),
      cite: game.i18n.localize(`ACKS-EQUIPMENT.itemSheet.provision.cite.${ladder}`),
    })).join(" · "),
    outcome: loc("toll.held.outcome"),
    outcomeTooltip: loc("toll.held.hint"),
    emphasis: "neutral",
  })));
  return sections;
}

/** `Name ×count` for each item of the kinds named that an actor holds with no size. */
function unsizedNames(actor, kinds) {
  return unsizedProvisions(actor, { kind: kinds }).map(({ item }) => `${item.name} ×${provisionOf(item)?.units ?? 0}`);
}

/**
 * Fill every sized water vessel the members carry, for the members `only`
 * accepts (a predicate over a member's actor; every member where null). What
 * is left is unset on each vessel, which reads as full. There is no Judge-only
 * gate: who may press it is the caller's `only`, by Foundry ownership.
 *
 * @returns {Promise<{filled: Array<{actor: object, item: object}>, skipped: Array<{actor: object, item: object}>}>}
 *   the vessels filled, and the unsized ones skipped.
 */
export async function refillVessels(formation, { only = null } = {}) {
  const filled = [];
  const skipped = [];
  for (const member of realMembers(formation ?? {})) {
    const actor = getMemberActor(member);
    if (!actor || (only && !only(actor))) continue;
    const got = await refillActor(actor);
    filled.push(...got.filled.map((item) => ({ actor, item })));
    skipped.push(...got.skipped.map((item) => ({ actor, item })));
  }
  return { filled, skipped };
}

/**
 * The cold's hours, applied to one body.
 *
 * Walks the clock an HOUR at a time: the rung is reached mid-stretch and every
 * hour after it costs, each hour rolling its own die.
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
 * Feed the order for one day, spend what was dealt and walk every ladder one
 * step.
 *
 * The pool is every member's sized food and water. It is dealt under the
 * sharing policy, then taken out of the packs through `spendShares`: each
 * member's share from their own pack first, then from the rest of the order's,
 * in member order, so the food and water spent are exactly what was dealt. A
 * member the Supplies press fed for the day being ended (`FED_FLAG` holds the
 * formation's End-day counter, `fedDayOf`) is counted fed in full and neither
 * dealt nor spent for.
 * A member dealt less than full of a kind while carrying an item of that kind
 * with no size has that ladder held: left as it was, and named on the card.
 *
 * Returns a per-member report: what they got, what was drawn for them, where
 * it left them, and what it cost. Nothing is written when there is nobody to
 * feed.
 *
 * @returns {Promise<object|null>} `{report, weatherRuns, short, food, water,
 *   pooled, spent: {food, water}, exposure}`; `spent` is the days drawn, and
 *   each report row's `spent` is `{food: {days, from}, water: {days, from}}`,
 *   `from` listing `{name, owner, days}`. A row's `held` is `{food?, water?}`,
 *   the unsized items named, where a ladder was held.
 */
export async function runProvisionDay(formation) {
  if (!game.user?.isGM) return null;
  const members = realMembers(formation ?? {});
  const actors = members.map(getMemberActor).filter(Boolean);
  if (!actors.length) return null;

  const travel = travelOf(formation);
  const closing = fedDayOf(formation);
  const fedToday = actors.map((a) => a.getFlag(MODULE_ID, FED_FLAG) === closing);

  const food = actors.reduce((n, a) => n + foodDaysOf(a), 0);
  const water = actors.reduce((n, a) => n + waterDaysOf(a), 0);
  // The band comes from the day's own weather.
  const burden = heatBurden({ band: travel.weather?.temperature ?? "" });
  const day = provisionDay({
    mouths: actors.length,
    foodMouths: fedToday.filter((fed) => !fed).length,
    food, water, policy: policy(), waterNeed: burden.waterNeed,
  });

  // The levels dealt, by member: a member fed already is full and takes no share.
  let nextFood = 0;
  const meals = actors.map((_, i) => ({
    food: fedToday[i] ? "full" : (day.food.levels[nextFood++] ?? "none"),
    water: day.water.levels[i] ?? "none",
  }));

  // What the levels cost, drawn from the packs and vessels.
  const foodDrawn = await spendShares(
    actors,
    meals.map((m, i) => (fedToday[i] ? 0 : LEVEL_SHARE[m.food])),
    (actor, days) => spendFood(actor, days, { kinds: FOOD_AND_GAME }),
  );
  const waterDrawn = await spendShares(actors, meals.map((m) => LEVEL_SHARE[m.water] * burden.waterNeed), spendWater);
  const sum = (rows) => tidy(rows.reduce((n, r) => n + r.days, 0));

  // The ladder is pure, so the dice are thrown here, one per body.
  const die = thirstDie();
  const cold = coldDie();

  // The exposure hours are declared, not inferred from the march.
  const band = travel.weather?.temperature ?? "";
  const exposure = travel.exposure ?? { hours: 0, atHeatSource: false, wet: false };
  const hours = Math.min(24, Math.max(0, Math.floor(Number(exposure.hours) || 0)));

  // Disease runs are the party's weather, advanced once for the day; a run
  // that comes due is thrown per member.
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
    const meal = meals[i];
    const before = survivalOf(actor.getFlag(MODULE_ID, SURVIVAL_FLAG) ?? freshSurvival());
    const thirstRoll = die ? (await new Roll(die).evaluate()).total : null;
    // A ladder short of its day, with food or water on the body that has no
    // size, is held: the day it would count is not known.
    const held = {};
    const foodUnsized = meal.food === "full" ? [] : unsizedNames(actor, FOOD_AND_GAME);
    const waterUnsized = meal.water === "full" ? [] : unsizedNames(actor, "water");
    if (foodUnsized.length) held.food = foodUnsized;
    if (waterUnsized.length) held.water = waterUnsized;
    const step = advanceSurvival(before, {
      food: held.food ? HELD : meal.food,
      water: held.water ? HELD : meal.water,
      thirstRoll,
      heat: burden.dehydrationDrain,
    });

    // The cold runs on its own clock, walked after the day's meal.
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
      spent: {
        food: { days: foodDrawn[i].days, from: foodDrawn[i].from },
        water: { days: waterDrawn[i].days, from: waterDrawn[i].from },
      },
      ...(Object.keys(held).length ? { held } : {}),
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

  // The toll card posts only on a day something was thrown or dealt.
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
    spent: { food: sum(foodDrawn), water: sum(waterDrawn) },
    exposure: { hours, band, atHeatSource: !!exposure.atHeatSource, wet: !!exposure.wet },
  };
}

/** One body's state, for a readout. Never throws on an unprovisioned actor. */
export function survivalStateOf(actor) {
  return survivalOf(actor?.getFlag?.(MODULE_ID, SURVIVAL_FLAG) ?? freshSurvival());
}
