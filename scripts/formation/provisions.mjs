/**
 * Feeding a marching order: the group half of survival.
 *
 * [lib/survival.mjs](../lib/survival.mjs) owns what going without DOES to one
 * body. This owns the party half: supply is pooled across the order and dealt
 * out, under the Judge's sharing policy (`even` or `triage`). Pure: it takes
 * counts and returns an allocation; reading packs and writing conditions belong
 * to the caller. See docs/formation/MODEL.md, "Provisions".
 */
import { stackCountOf } from "../lib/item-model.mjs";
import { MODULE_ID, RATION_PATTERN, WATER_PATTERN } from "./constants.mjs";

/** The kinds of provision an item can be. */
const PROVISION_KINDS = Object.freeze(["food", "water", "hunt"]);

/** Cookbook ids of the imported entries that are food, structure the importer stamps on what it makes. */
const FOOD_IDENTITIES = Object.freeze(["def.equip.rationsIron", "def.equip.rationsStandard"]);

/** Cookbook id of the imported vessel entry (a waterskin, or a wineskin by another name). */
const VESSEL_IDENTITY = "def.equip.waterskinWineskin";

/** One module flag, read through the document API or the raw flags a plain object carries. */
const flagOf = (item, key) => item?.getFlag?.(MODULE_ID, key) ?? item?.flags?.[MODULE_ID]?.[key];

/** A vessel named for wine and not for water holds no water. */
const holdsOnlyWine = (name) => /wine/i.test(name) && !/water/i.test(name);

/**
 * What an item is as a provision, or null when it is none.
 *
 * The ONE reader of supply: the camp's forecast, the day's meal and the
 * Supplies press all ask it, so they can never disagree about what is carried.
 * The first step that answers wins:
 *
 * 1. `declared`: `flags["acks-extras"].provision = {kind, perUnit}`, a Judge's
 *    word. `kind: "none"` declares the item no provision and ends the search;
 *    a kind this reader does not know, or a missing `perUnit`, is ignored.
 * 2. `foraged`: the flag foraging writes, one day a unit.
 * 3. `imported`: the importer's identity on the item, `cookbook.id` for an
 *    entry made from its described row and `skin.base` for a class-kit item
 *    cut from one; a vessel whose own name says wine and not water is no water.
 * 4. `name`: a hand-made item with no identity, by whole word only.
 *
 * A week is seven days a unit by name, anything else one. A unit part eaten
 * (`flags["acks-extras"].uses`, which the press keeps on a multi-day unit)
 * holds that many days fewer, so the forecast and the press agree.
 *
 * @returns {{kind: "food"|"water"|"hunt", units: number, perUnit: number,
 *   days: number, source: "declared"|"foraged"|"imported"|"name"}|null}
 *   `units` is the stack count, `perUnit` the days one unit holds, `days` what
 *   the item still holds.
 */
export function provisionOf(item) {
  if (!item) return null;
  const name = String(item.name ?? "");
  const nameUnit = /week/i.test(name) ? 7 : 1;

  let kind = null;
  let perUnit = nameUnit;
  let source = null;

  const declared = flagOf(item, "provision");
  if (declared?.kind === "none") return null;
  const foraged = flagOf(item, "foraged");
  const stamps = [flagOf(item, "cookbook")?.id, flagOf(item, "skin")?.base];

  if (PROVISION_KINDS.includes(declared?.kind)) {
    kind = declared.kind;
    const given = Number(declared.perUnit);
    perUnit = Number.isFinite(given) && given > 0 ? given : nameUnit;
    source = "declared";
  } else if (PROVISION_KINDS.includes(foraged)) {
    kind = foraged;
    perUnit = 1;
    source = "foraged";
  } else if (stamps.some((id) => FOOD_IDENTITIES.includes(id))) {
    kind = "food";
    source = "imported";
  } else if (stamps.includes(VESSEL_IDENTITY) && !holdsOnlyWine(name)) {
    kind = "water";
    source = "imported";
  } else if (RATION_PATTERN.test(name)) {
    kind = "food";
    source = "name";
  } else if (WATER_PATTERN.test(name)) {
    kind = "water";
    source = "name";
  }
  if (!kind) return null;

  const held = stackCountOf(item) ?? 0;
  const units = Number.isFinite(held) && held > 0 ? held : 0;
  const eaten = perUnit > 1 ? Math.min(Math.max(0, Math.floor(Number(flagOf(item, "uses")) || 0)), perUnit - 1) : 0;
  const days = units > 0 ? units * perUnit - eaten : 0;
  return { kind, units, perUnit, days, source };
}

/**
 * Days of provision an actor carries, over the kinds named: `kind` is one of
 * `food`, `water`, `hunt` or a list of them (`foraged` is the older spelling
 * of the same option). Answers `provisionOf` item by item; the retired name
 * `pattern` is no longer read.
 */
export function daysCarried(actor, { kind = null, foraged = null } = {}) {
  const wanted = [].concat(kind ?? foraged ?? []);
  if (!wanted.length) return 0;
  let days = 0;
  for (const item of actor?.items ?? []) {
    const provision = provisionOf(item);
    if (provision && wanted.includes(provision.kind)) days += provision.days;
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
