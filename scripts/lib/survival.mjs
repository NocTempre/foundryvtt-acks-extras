/**
 * Going without: hunger and thirst as ladders a day at a time.
 *
 * Its own subsystem rather than part of travel, because starving reaches well
 * past a march — a besieged stronghold starves, and so does a prisoner. The
 * formation surface AUTOMATES this for a marching order; it does not own it.
 *
 * Three pressures, deliberately different shapes because the rules make them
 * different:
 *
 *  - **Food has three rungs** and climbs slowly. Short rations bite first as a
 *    penalty on every throw; going without long enough stops a body healing
 *    and forbids a forced march; longer still and it begins costing
 *    Constitution, to death.
 *  - **Water has one rung** and arrives fast. There is no thirsty-but-fine
 *    step: you are watered, or you are in the condition that drains you.
 *  - **The weather is not one thing.** Cold makes a CONDITION that ticks by the
 *    hour and ends only at a fire; heat makes MODIFIERS — more water needed, a
 *    worse drain when it runs out, a saving throw under heavy armour. Forcing
 *    them into a matching ladder would misstate both.
 *
 * What ships is the LADDER — the rungs, their order, what each forbids, and
 * that eating a full day steps you back down rather than clearing you outright
 * once you are at the bottom. Every duration, penalty, drain and recovery rate
 * is printed, and arrives through the `survival` registered document.
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
 * What the cold does to a body left in it.
 *
 * Deliberately NOT symmetric with heat, because the rules are not. Cold
 * produces a CONDITION a body carries — hypothermia, which drains by the hour
 * and ends only at a heat source. Heat produces MODIFIERS instead: more water
 * needed, a worse drain if that water runs out, and a saving throw for anyone
 * in heavy armour. Forcing the two into one ladder would misstate both.
 */
export const EXPOSURE = Object.freeze({
  sheltered: { label: "ACKS-LIB.survival.sheltered", rung: 0, forbids: [] },
  hypothermic: {
    label: "ACKS-LIB.survival.hypothermic", rung: 1,
    forbids: ["forceMarch", "naturalHealing"], drains: true,
  },
});

function table(key) {
  if (!hasDoc(SURVIVAL_DOC)) return null;
  return getDoc(SURVIVAL_DOC)?.tables?.[key] ?? null;
}

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
 *
 * The two clocks run in parallel and the WORSE answer wins: going entirely
 * without is fast, and half rations is the slow road to the same place. Absent
 * thresholds leave the body where it is rather than advancing it on invented
 * timing — a subsystem that starved a party because nothing was imported would
 * be worse than one that did nothing.
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
 * Does this temperature band run a cold clock at all?
 *
 * Distinguishes "mild enough that nothing happens" from "nothing imported" for
 * a caller that wants to offer or withhold a control: a band with no threshold
 * is one where hours spent unprotected cost nothing, whichever reason applies.
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
 * One day passes, and this is what the body got.
 *
 * A full day's food does NOT clear the bottom rung outright — it steps a
 * starving body back to underfed, which is the rule's own shape and the reason
 * a rescued party is not instantly well. A full day's water, by contrast, ends
 * dehydration entirely; thirst has only the one rung to fall from.
 *
 * Returns the next state plus what happened, so a caller can narrate a change
 * without diffing two objects.
 *
 * Hunger and thirst charge differently, and the shapes are not interchangeable:
 * starvation takes a FLAT toll each day, while thirst takes a ROLLED one that
 * the heat can multiply. This function stays pure, so — as with a settlement
 * turn — the caller owns the dice: it passes `thirstRoll` and this decides
 * whether the day calls for it. A rolled cost with no roll supplied is
 * reported as `unrolled` rather than charged at zero, because a dehydrated
 * body that quietly costs nothing is the subsystem not running at all.
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
    // Stepping DOWN, not clearing: a full meal takes a starving body to
    // underfed and an underfed or hungry one to fed.
    next.nourishment = s.nourishment === "starving" ? "underfed" : "fed";
  } else {
    const climbed = hungerRung(next);
    // Never step a body DOWN a rung on short commons — the clocks only climb.
    next.nourishment = NOURISHMENT[climbed].rung >= NOURISHMENT[s.nourishment].rung
      ? climbed : s.nourishment;
  }

  next.hydration = water === "full" ? "watered" : thirstRung(next);

  // --- the cost, and the debt coming back ---
  const foodDrain = next.nourishment === "starving" ? numOrNull(table("food")?.conPerDay) : null;

  // Thirst's toll may be registered flat or as a die. A die needs the caller's
  // roll; without one the day is reported unrolled and charges nothing, so the
  // gap is visible instead of looking like a body that got off free.
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
 * Has the cold taken hold?
 *
 * Two ways in, and getting WET is the one that needs no clock at all — a
 * soaked body is hypothermic at once, however well dressed. Otherwise it is a
 * matter of how long the body has gone unprotected, and how cold it is: the
 * colder band gives less time. Immunity to cold skips all of it.
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
 * An hour in the cold.
 *
 * Hourly rather than daily, which is why it is its own step: hunger is a
 * matter of days and the cold is a matter of hours, and running them on one
 * clock would make one of them wrong.
 *
 * Warming at a heat source ends it — the rule asks for an hour there, so a
 * caller passes the hour it has actually spent.
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

  // The cold charges by the hour and the toll may be registered flat or as a
  // die. As with thirst, the caller owns the dice: a die with no roll costs
  // nothing and says so, rather than reading as an hour that did no harm.
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
 * What the heat asks of a body, as modifiers rather than a condition.
 *
 * A thirsty body in the heat dies faster, everyone drinks more, and anyone
 * under a heavy load of armour is making saving throws by the hour. Immunity
 * to fire skips all three.
 */
export function heatBurden({ band = "", armourStone = 0, immune = false } = {}) {
  // An unstated band is not a mild one under another name: the weather's own
  // vocabulary runs frigid..sweltering with nothing called "moderate", and a
  // default naming a band that cannot be chosen reads as a real setting.
  // Unstated falls through the same "not in the table" path a mild band does.
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
 * What an animal needs in a day, in the units its own sheet uses.
 *
 * A pack train eats and drinks, and a party that provisioned only its people
 * discovers the mules have opinions. The figures are the creature's own — they
 * arrive with it from the importer, beside the load it can carry — so this is
 * a read rather than a table lookup: nothing here is printed in a general
 * table, it is printed per animal.
 *
 * Null for either means unstated, never zero: an animal nobody has priced does
 * not eat for free, it simply has no figure yet.
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
 * The simplified survival variant: what a party should CARRY to be safe.
 *
 * The book's own shortcut for tables that would rather not track a sack at a
 * time. Its arithmetic is printed — a fraction of the expected trip in food, a
 * few days of water — so this shapes the answer and the registry supplies the
 * figures. Water is waived entirely in country with rivers and lakes to hand.
 *
 * Returns null when unimported, because a recommendation built on invented
 * numbers is worse than none.
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
    // Foraging covers roughly the rest, which is the whole point of the shortcut.
    food: Math.ceil(people * trip * foodShare),
    // Animals drink too, and in watered country nobody carries any of it.
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
