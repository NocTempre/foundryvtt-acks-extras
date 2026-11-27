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
export const VESSEL_IDENTITY = "def.equip.waterskinWineskin";

/** Days in a week: a calendar concept an item's name may count in, not a printed value. */
const DAYS_PER_WEEK = 7;

/** One module flag, read through the document API or the raw flags a plain object carries. */
const flagOf = (item, key) => item?.getFlag?.(MODULE_ID, key) ?? item?.flags?.[MODULE_ID]?.[key];

/** A vessel named for wine and not for water holds no water. */
const holdsOnlyWine = (name) => /wine/i.test(name) && !/water/i.test(name);

/** A figure as a finite number, or null for anything unset: `Number(null)` and `Number("")` are 0, which is a figure. */
export const figureOf = (raw) => {
  if (raw === null || raw === undefined || raw === "" || typeof raw === "boolean") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

/** A size in days: a figure above nothing, or null. */
export const sizeFigure = (raw) => {
  const n = figureOf(raw);
  return n !== null && n > 0 ? n : null;
};

/**
 * The days a duration in an item's own name states: an optional whole count,
 * then a whole word "week" or "day" ("1 week's iron rations", "Rations (2
 * weeks)", "Day Rations"). A bare "week" is one week. Null when the name
 * states none.
 */
function nameDays(name) {
  const m = /(?:\b(\d+)\s*[- ]?\s*)?\b(weeks?|days?)\b/i.exec(name);
  if (!m) return null;
  const count = m[1] ? Number(m[1]) : 1;
  if (!(count > 0)) return null;
  return /^week/i.test(m[2]) ? count * DAYS_PER_WEEK : count;
}

/**
 * The size the import read off the page, in days a unit: a ration's stated
 * duration, or for a vessel one share of the vessels the page counts to a
 * person's day (`perDay`), else what it holds as a fraction of that day (both
 * read in one unit). A class-kit copy carries the figures under its `skin`
 * flag, since the copy sheds the importer's own stamp.
 */
export function pageDays(item, kind) {
  const read = flagOf(item, "cookbook")?.read ?? flagOf(item, "skin")?.read;
  if (!read) return null;
  if (kind === "food") return sizeFigure(read.days);
  if (kind === "water") {
    const perDay = sizeFigure(read.perDay);
    if (perDay !== null) return 1 / perDay;
    const holds = sizeFigure(read.holds?.amount);
    const daily = sizeFigure(read.daily);
    return holds !== null && daily !== null ? holds / daily : null;
  }
  return null;
}

/**
 * What an item is as a provision, or null when it is none.
 *
 * The ONE reader of supply: the camp's forecast, the day's meal and the
 * Supplies press all ask it, so they can never disagree about what is carried.
 *
 * The KIND comes from the first step that answers:
 *
 * 1. `declared`: `flags["acks-extras"].provision = {kind, perUnit, left}`, a
 *    Judge's word. `kind: "none"` declares the item no provision and ends the
 *    search; a kind this reader does not know is ignored.
 * 2. `foraged`: the flag foraging writes.
 * 3. `imported`: the importer's identity on the item, `cookbook.id` for an
 *    entry made from its described row and `skin.base` for a class-kit item
 *    cut from one; a vessel whose own name says wine and not water is no water.
 * 4. `name`: a hand-made item with no identity, by whole word only.
 *
 * The SIZE, the days one unit holds, is read apart from the kind, from the
 * first step that answers: a declared `perUnit` (whatever gave the kind), a
 * foraged unit (one person-day), the page (`cookbook.read`: a ration's
 * duration, a vessel's holding over a person's day), a duration in the item's
 * own name. Where none answers the item is UNSIZED: `perUnit` and `days` are
 * null and no figure stands in, so the count leaves it out.
 *
 * A food unit part eaten (`flags["acks-extras"].uses`, which the press keeps
 * on a multi-day unit) holds that many days fewer, so the forecast and the
 * press agree. Water is kept as what is left (`provision.left`, days across
 * the stack), clamped to what the stack holds and full where never set.
 *
 * @returns {{kind: "food"|"water"|"hunt", units: number, perUnit: number|null,
 *   days: number|null, source: "declared"|"foraged"|"imported"|"name",
 *   sized: boolean, sizeSource: "declared"|"foraged"|"page"|"name"|null,
 *   left: number|null}|null}
 *   `units` is the stack count, `perUnit` the days one unit holds, `days` what
 *   the item still holds, `source` where the kind came from, `sizeSource`
 *   where the size did, `left` a water item's days now (null for the rest).
 */
export function provisionOf(item) {
  if (!item) return null;
  const name = String(item.name ?? "");

  let kind = null;
  let source = null;

  const declared = flagOf(item, "provision");
  if (declared?.kind === "none") return null;
  const foraged = flagOf(item, "foraged");
  const stamps = [flagOf(item, "cookbook")?.id, flagOf(item, "skin")?.base];

  if (PROVISION_KINDS.includes(declared?.kind)) {
    kind = declared.kind;
    source = "declared";
  } else if (PROVISION_KINDS.includes(foraged)) {
    kind = foraged;
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

  let perUnit = sizeFigure(declared?.perUnit);
  let sizeSource = perUnit !== null ? "declared" : null;
  if (perUnit === null && source === "foraged") {
    perUnit = 1;
    sizeSource = "foraged";
  }
  if (perUnit === null) {
    perUnit = pageDays(item, kind);
    if (perUnit !== null) sizeSource = "page";
  }
  if (perUnit === null) {
    perUnit = nameDays(name);
    if (perUnit !== null) sizeSource = "name";
  }

  const held = stackCountOf(item) ?? 0;
  const units = Number.isFinite(held) && held > 0 ? held : 0;
  if (perUnit === null) return { kind, units, perUnit: null, days: null, source, sized: false, sizeSource: null, left: null };

  if (kind === "water") {
    const full = units * perUnit;
    const stored = figureOf(declared?.left);
    const left = stored === null ? full : Math.min(Math.max(stored, 0), full);
    return { kind, units, perUnit, days: left, source, sized: true, sizeSource, left };
  }
  const eaten = perUnit > 1 ? Math.min(Math.max(0, Math.floor(Number(flagOf(item, "uses")) || 0)), perUnit - 1) : 0;
  const days = units > 0 ? units * perUnit - eaten : 0;
  return { kind, units, perUnit, days, source, sized: true, sizeSource, left: null };
}

/**
 * Days of provision an actor carries, over the kinds named: `kind` is one of
 * `food`, `water`, `hunt` or a list of them (`foraged` is the older spelling
 * of the same option). Answers `provisionOf` item by item and sums the SIZED
 * items only; an unsized one adds nothing (`unsizedProvisions` names them).
 * The retired name `pattern` is no longer read.
 */
export function daysCarried(actor, { kind = null, foraged = null } = {}) {
  const wanted = [].concat(kind ?? foraged ?? []);
  if (!wanted.length) return 0;
  let days = 0;
  for (const item of actor?.items ?? []) {
    const provision = provisionOf(item);
    if (provision?.sized && wanted.includes(provision.kind)) days += provision.days;
  }
  return days;
}

/**
 * The items an actor carries that read as the kinds named but have no size, so
 * `daysCarried` leaves them out: `[{item, kind}]`, only those still holding a
 * unit. `kind` is as for `daysCarried`.
 */
export function unsizedProvisions(actor, { kind = null, foraged = null } = {}) {
  const wanted = [].concat(kind ?? foraged ?? []);
  const out = [];
  if (!wanted.length) return out;
  for (const item of actor?.items ?? []) {
    const provision = provisionOf(item);
    if (provision && !provision.sized && provision.units > 0 && wanted.includes(provision.kind)) out.push({ item, kind: provision.kind });
  }
  return out;
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
