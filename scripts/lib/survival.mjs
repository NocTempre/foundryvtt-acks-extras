/**
 * Going without: hunger and thirst as ladders a day at a time, and the cold as
 * a condition by the hour. The formation surface automates this for a marching
 * order; it does not own it.
 *
 * Three pressures of different shapes: food has three rungs, water one, and
 * cold is a condition while heat is a set of modifiers (`heatBurden`). What
 * ships is the ladder (rungs, order, what each forbids, and that a full day's
 * food steps a starving body down a rung rather than clearing it). Every
 * duration, penalty, drain and recovery rate arrives through the `survival`
 * registered document. See docs/lib/MODEL.md, "Survival".
 */
import { getDoc, hasDoc } from "./tables.mjs";
import { numOrNull } from "./util.mjs";

/** The registered document these ladders read. */
export const SURVIVAL_DOC = "survival";

/** How much of a day's ration a creature actually got. */
export const RATION_LEVELS = Object.freeze(["full", "half", "none"]);

/**
 * The hunger ladder, in order. `forbids` is what the rung takes away — the
 * kind of the effect is structural; its size is not.
 */
export const NOURISHMENT = Object.freeze({
  fed: { label: "ACKS-LIB.survival.fed", rung: 0, forbids: [] },
  hungry: { label: "ACKS-LIB.survival.hungry", rung: 1, forbids: ["throws"] },
  underfed: { label: "ACKS-LIB.survival.underfed", rung: 2, forbids: ["forceMarch", "naturalHealing"] },
  starving: {
    label: "ACKS-LIB.survival.starving", rung: 3,
    forbids: ["forceMarch", "naturalHealing"], drains: true,
  },
});

/** The thirst ladder. One rung, and it arrives quickly. */
export const HYDRATION = Object.freeze({
  watered: { label: "ACKS-LIB.survival.watered", rung: 0, forbids: [] },
  dehydrated: {
    label: "ACKS-LIB.survival.dehydrated", rung: 1,
    forbids: ["forceMarch", "naturalHealing"], drains: true,
  },
});

/**
 * What the cold does to a body left in it: hypothermia, a condition that drains
 * by the hour and ends only at a heat source. Heat is not a rung here
 * (`heatBurden`).
 */
export const EXPOSURE = Object.freeze({
  sheltered: { label: "ACKS-LIB.survival.sheltered", rung: 0, forbids: [] },
  hypothermic: {
    label: "ACKS-LIB.survival.hypothermic", rung: 1,
    forbids: ["forceMarch", "naturalHealing"], drains: true,
  },
});

/**
 * One table of the registered `survival` document, or null when the document
 * or the table is not registered. The one reader every body-ladder file shares
 * (`fatigue.mjs` reads its figures through it).
 */
export function survivalTable(key) {
  if (!hasDoc(SURVIVAL_DOC)) return null;
  return getDoc(SURVIVAL_DOC)?.tables?.[key] ?? null;
}

const table = survivalTable;

/** A fresh, fed and watered body. */
export function freshSurvival() {
  return {
    nourishment: "fed",
    hydration: "watered",
    /** Consecutive days with nothing at all, per ladder. */
    noFoodRun: 0,
    noWaterRun: 0,
    /** Consecutive days on short commons, per ladder. */
    shortFoodRun: 0,
    shortWaterRun: 0,
    /** How the cold is treating this body. */
    exposure: "sheltered",
    /** Hours spent unprotected, which is the clock the cold runs on. */
    hoursUnprotected: 0,
    /** Constitution the ladders have taken, and owe back. */
    conLost: 0,
  };
}

/** Normalize whatever a record holds. */
export function survivalOf(state) {
  const s = state ?? {};
  const fresh = freshSurvival();
  const int = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.floor(Number(v)) : 0);
  return {
    nourishment: NOURISHMENT[s.nourishment] ? s.nourishment : fresh.nourishment,
    hydration: HYDRATION[s.hydration] ? s.hydration : fresh.hydration,
    exposure: EXPOSURE[s.exposure] ? s.exposure : fresh.exposure,
    hoursUnprotected: int(s.hoursUnprotected),
    noFoodRun: int(s.noFoodRun),
    noWaterRun: int(s.noWaterRun),
    shortFoodRun: int(s.shortFoodRun),
    shortWaterRun: int(s.shortWaterRun),
    conLost: int(s.conLost),
  };
}

/** Everything a rung takes away, from both ladders at once. */
export function forbidden(state) {
  const s = survivalOf(state);
  return [...new Set([
    ...(NOURISHMENT[s.nourishment]?.forbids ?? []),
    ...(HYDRATION[s.hydration]?.forbids ?? []),
    ...(EXPOSURE[s.exposure]?.forbids ?? []),
  ])];
}

/** Is this body losing Constitution today? */
export function draining(state) {
  const s = survivalOf(state);
  return !!(NOURISHMENT[s.nourishment]?.drains
    || HYDRATION[s.hydration]?.drains
    || EXPOSURE[s.exposure]?.drains);
}

/**
 * Which hunger rung a body has climbed to, given how long it has gone short.
 * The two clocks (no food, short food) run in parallel and the worse answer
 * wins. A threshold that is not imported never advances the body.
 */
export function hungerRung({ noFoodRun = 0, shortFoodRun = 0 } = {}) {
  const t = table("food") ?? {};
  const at = (key) => numOrNull(t[key]);
  const reached = (run, threshold) => threshold != null && run >= threshold;

  if (reached(noFoodRun, at("starvingNoFood")) || reached(shortFoodRun, at("starvingShort"))) return "starving";
  if (reached(noFoodRun, at("underfedNoFood")) || reached(shortFoodRun, at("underfedShort"))) return "underfed";
  if (reached(shortFoodRun, at("hungryAfter"))) return "hungry";
  return "fed";
}

/** The thirst rung. One step, reached by any of three clocks. */
export function thirstRung({ noWaterRun = 0, shortWaterRun = 0 } = {}) {
  const t = table("water") ?? {};
  const at = (key) => numOrNull(t[key]);
  const reached = (run, threshold) => threshold != null && run >= threshold;
  if (reached(noWaterRun, at("dehydratedNoWater")) || reached(shortWaterRun, at("dehydratedShort"))) {
    return "dehydrated";
  }
  return "watered";
}

/** Does this registry cell hold a die rather than a flat figure? */
export function isDiceExpression(v) {
  return typeof v === "string" && /^\s*\d*\s*d\s*\d+/i.test(v);
}

/** The thirst die the registry holds, or null when the toll is flat/unimported. */
export function thirstDie() {
  const cost = table("water")?.conPerDay;
  return isDiceExpression(cost) ? String(cost).replace(/\s+/g, "") : null;
}

/**
 * Does this temperature band run a cold clock at all? A band with no threshold
 * (mild, or nothing imported) costs nothing for hours spent unprotected, so a
 * caller can offer or withhold a control on the answer.
 */
export function exposureBites(band) {
  return numOrNull(table("exposure")?.hoursUnprotected?.[band]) != null;
}

/** The cold's hourly die, on the same terms as the thirst die. */
export function coldDie() {
  const cost = table("exposure")?.conPerHour;
  return isDiceExpression(cost) ? String(cost).replace(/\s+/g, "") : null;
}

/**
 * One day passes, and this is what the body got. A full day's food steps a
 * starving body back to underfed; a full day's water ends dehydration.
 *
 * Returns the next state plus what happened (`drain`, `recovered`, `worsened`,
 * `eased`, `unpriced`, `unrolled`). Pure: the caller owns the dice and passes
 * `thirstRoll`. A rolled cost with no roll supplied is reported as `unrolled`
 * and charged nothing. See docs/lib/DECISIONS.md, "Thirst charges a rolled toll;
 * hunger charges a flat one".
 *
 * @param {object} opts
 * @param {"full"|"half"|"none"} opts.food  what this body ate
 * @param {"full"|"half"|"none"} opts.water what it drank
 * @param {number|null} opts.thirstRoll  a roll of the registry's thirst die
 * @param {number} opts.heat  the band's multiplier on a thirst toll (heatBurden)
 */
export function advanceSurvival(state, {
  food = "full", water = "full", thirstRoll = null, heat = 1,
} = {}) {
  const s = survivalOf(state);
  const next = { ...s };
  const before = { nourishment: s.nourishment, hydration: s.hydration };

  // --- the clocks ---
  next.noFoodRun = food === "none" ? s.noFoodRun + 1 : 0;
  next.shortFoodRun = food === "full" ? 0 : s.shortFoodRun + 1;
  next.noWaterRun = water === "none" ? s.noWaterRun + 1 : 0;
  next.shortWaterRun = water === "full" ? 0 : s.shortWaterRun + 1;

  // --- the rungs ---
  if (food === "full") {
    next.nourishment = s.nourishment === "starving" ? "underfed" : "fed";
  } else {
    const climbed = hungerRung(next);
    // Short rations never step a body down a rung: the clocks only climb.
    next.nourishment = NOURISHMENT[climbed].rung >= NOURISHMENT[s.nourishment].rung
      ? climbed : s.nourishment;
  }

  next.hydration = water === "full" ? "watered" : thirstRung(next);

  // --- the cost, and the debt coming back ---
  const foodDrain = next.nourishment === "starving" ? numOrNull(table("food")?.conPerDay) : null;

  // Thirst's toll is registered flat or as a die; a die needs the caller's roll.
  let waterDrain = null;
  let unrolled = false;
  if (next.hydration === "dehydrated") {
    const cost = table("water")?.conPerDay;
    const flat = numOrNull(cost);
    const mult = Number.isFinite(Number(heat)) && Number(heat) > 0 ? Number(heat) : 1;
    if (flat != null) waterDrain = flat * mult;
    else if (isDiceExpression(cost)) {
      if (thirstRoll != null && Number.isFinite(Number(thirstRoll))) {
        waterDrain = Number(thirstRoll) * mult;
      } else unrolled = true;
    }
  }
  const drain = (foodDrain ?? 0) + (waterDrain ?? 0);

  let recovered = 0;
  if (!drain && s.conLost > 0) {
    const rate = (food === "full" ? numOrNull(table("food")?.recoverPerDay) ?? 0 : 0)
      + (water === "full" ? numOrNull(table("water")?.recoverPerDay) ?? 0 : 0);
    recovered = Math.min(s.conLost, rate);
  }
  next.conLost = Math.max(0, s.conLost + drain - recovered);

  return {
    state: next,
    drain,
    recovered,
    worsened: NOURISHMENT[next.nourishment].rung > NOURISHMENT[before.nourishment].rung
      || HYDRATION[next.hydration].rung > HYDRATION[before.hydration].rung,
    eased: NOURISHMENT[next.nourishment].rung < NOURISHMENT[before.nourishment].rung
      || HYDRATION[next.hydration].rung < HYDRATION[before.hydration].rung,
    unpriced: !survivalReady(),
    unrolled,
  };
}

/**
 * Has the cold taken hold? A wet body is hypothermic at once, with no clock;
 * otherwise it is hours unprotected against the band's limit. Immunity to cold
 * skips all of it.
 */
export function exposureRung({
  band = "", protectedFrom = false, wet = false, hoursUnprotected = 0, immune = false,
} = {}) {
  if (immune) return "sheltered";
  const limits = table("exposure")?.hoursUnprotected;
  const limit = numOrNull(limits?.[band]);
  if (limit == null) return "sheltered";       // this band does not bite, or is unimported
  if (wet) return "hypothermic";               // no clock needed
  if (protectedFrom) return "sheltered";
  return Number(hoursUnprotected) >= limit ? "hypothermic" : "sheltered";
}

/**
 * An hour in the cold, its own step because the cold runs by the hour where
 * hunger runs by the day. Warming at a heat source ends it; a caller passes the
 * hour it has actually spent there.
 */
export function advanceExposureHour(state, {
  band = "", protectedFrom = false, wet = false, atHeatSource = false,
  immune = false, coldRoll = null,
} = {}) {
  const s = survivalOf(state);
  const next = { ...s };

  if (atHeatSource) {
    next.exposure = "sheltered";
    next.hoursUnprotected = 0;
    return { state: next, drain: 0, eased: s.exposure !== "sheltered" };
  }

  next.hoursUnprotected = protectedFrom && !wet ? 0 : s.hoursUnprotected + 1;
  const rung = exposureRung({
    band, protectedFrom, wet, hoursUnprotected: next.hoursUnprotected, immune,
  });
  // The cold only tightens its grip within an hour; it never loosens without a fire.
  next.exposure = EXPOSURE[rung].rung >= EXPOSURE[s.exposure].rung ? rung : s.exposure;

  // As with thirst, the toll is flat or a die and the caller owns the dice.
  let drain = 0;
  let unrolled = false;
  if (next.exposure === "hypothermic") {
    const cost = table("exposure")?.conPerHour;
    const flat = numOrNull(cost);
    if (flat != null) drain = flat;
    else if (isDiceExpression(cost)) {
      if (coldRoll != null && Number.isFinite(Number(coldRoll))) drain = Number(coldRoll);
      else unrolled = true;
    }
  }
  next.conLost = Math.max(0, s.conLost + drain);
  return {
    state: next,
    drain,
    unrolled,
    worsened: EXPOSURE[next.exposure].rung > EXPOSURE[s.exposure].rung,
    owesDeathSave: next.exposure === "hypothermic",
  };
}

/**
 * What the heat asks of a body, as modifiers rather than a condition: the water
 * need, the dehydration drain and whether heavy armour owes a saving throw.
 * Immunity to fire skips all three.
 */
export function heatBurden({ band = "", armourStone = 0, immune = false } = {}) {
  // An unstated band takes the same "not in the table" path a mild band does.
  const row = table("heat")?.[band];
  if (!row || immune) return { waterNeed: 1, dehydrationDrain: 1, armourSave: false };
  const armourAt = numOrNull(row.armourStone);
  return {
    waterNeed: numOrNull(row.waterNeed) ?? 1,
    dehydrationDrain: numOrNull(row.dehydrationDrain) ?? 1,
    armourSave: armourAt != null && Number(armourStone) >= armourAt,
    armourAt,
  };
}

/**
 * What an animal needs in a day, in the units its own sheet uses. The figures
 * arrive with the creature from the importer, so this reads the actor rather
 * than a table. Null for either means unstated, never zero.
 */
export function animalNeeds(actor) {
  const feed = actor?.flags?.["acks-extras"]?.extras?.feed ?? null;
  return {
    food: numOrNull(feed?.food),
    water: numOrNull(feed?.water),
    stated: numOrNull(feed?.food) != null || numOrNull(feed?.water) != null,
  };
}

/**
 * The simplified survival variant: what a party should carry. The registry
 * supplies the figures; water is waived in watered country. Returns null when
 * unimported.
 */
export function simplifiedSupply({ mouths = 0, animals = 0, days = 0, wateredCountry = false } = {}) {
  const row = table("simplified");
  const foodShare = numOrNull(row?.foodShareOfTrip);
  const waterDays = numOrNull(row?.waterDays);
  if (foodShare == null || waterDays == null) return null;
  const people = Math.max(0, Math.floor(Number(mouths) || 0));
  const beasts = Math.max(0, Math.floor(Number(animals) || 0));
  const trip = Math.max(0, Number(days) || 0);
  return {
    food: Math.ceil(people * trip * foodShare),
    // Animals drink too.
    water: wateredCountry ? 0 : Math.ceil((people + beasts) * waterDays),
    wateredCountry,
    confidence: numOrNull(row?.confidence),
  };
}

/** True once the registry can time either ladder. */
export function survivalReady() {
  return numOrNull(table("food")?.hungryAfter) != null
    || numOrNull(table("water")?.dehydratedNoWater) != null;
}
