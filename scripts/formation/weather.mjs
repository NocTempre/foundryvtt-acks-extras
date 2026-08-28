/**
 * The sky over the march: the daily weather generator, the condition
 * vocabulary, and the footing (mud and snow) that weather leaves behind.
 *
 * STRUCTURE ships here; the printed numbers do not. What ships: the
 * procedure (three 2d6 throws a day — temperature, precipitation, wind —
 * each adjusted by the hex's climate and the season; the same temperature
 * roll read twice, day and night, under two modifiers; the temperature
 * COLUMN chosen by the sign of the day modifier), the combination rules
 * (freezing air turns drizzle to flurries and rain to snow; still air turns
 * drizzle to mist and rain to fog — freezing looked at first, so snow is
 * never re-read as fog), the optional weather-fronts drift (each roll slides
 * one step toward yesterday's, natural extremes standing), the condition
 * vocabulary, and the footing state machine's TRANSITIONS. What is imported
 * (the `weather` registered document, from the reader's own book): the band
 * edges each modified total lands in, the climate/season modifier grid,
 * every condition's speed factor, and every accumulation threshold. The
 * Köppen climate codes themselves are public science and ship as keys.
 *
 * Everything here is arithmetic over plain objects plus registry reads —
 * Node-evaluable, no documents, no Foundry.
 */

import { bracketRow } from "../lib/tables.mjs";
import { readTable, WEATHER_DOC, WIND, TERRAIN } from "../vehicles/vehicle-speed.mjs";

export { WEATHER_DOC };

/** The wind ladder is the vehicles feature's; one vocabulary, land and sea. */
export const WIND_BANDS = WIND;

/**
 * The temperature ladder (JJ ch. 2). `freezing` marks the bands that turn
 * rain to snow and can freeze mud; `condition` names the mechanical weather
 * condition a band imposes — the middle of the ladder is narration only.
 */
export const TEMPERATURE_BANDS = Object.freeze({
  frigid: { label: "ACKS-FORMATION.travel.weather.temp.frigid", freezing: true, condition: "frigid" },
  cold: { label: "ACKS-FORMATION.travel.weather.temp.cold", freezing: true, condition: "cold" },
  veryChilly: { label: "ACKS-FORMATION.travel.weather.temp.veryChilly" },
  chilly: { label: "ACKS-FORMATION.travel.weather.temp.chilly" },
  brisk: { label: "ACKS-FORMATION.travel.weather.temp.brisk" },
  balmy: { label: "ACKS-FORMATION.travel.weather.temp.balmy" },
  warm: { label: "ACKS-FORMATION.travel.weather.temp.warm" },
  hot: { label: "ACKS-FORMATION.travel.weather.temp.hot" },
  sweltering: { label: "ACKS-FORMATION.travel.weather.temp.sweltering", condition: "sweltering" },
});

/**
 * The precipitation ladder, rolled kinds and the four DERIVED kinds the
 * combination rules produce (never rolled directly). `condition` marks the
 * kinds that are mechanical weather conditions; `raining`/`snowing` feed the
 * road-washout vocabulary; `wet` feeds the footing counters; `fair` is the
 * book's own drying classification — everything not wet, foggy or sunbaked.
 */
export const PRECIPITATION_KINDS = Object.freeze({
  sunbaked: { label: "ACKS-FORMATION.travel.weather.precip.sunbaked", condition: true },
  clear: { label: "ACKS-FORMATION.travel.weather.precip.clear", fair: true },
  partlyCloudy: { label: "ACKS-FORMATION.travel.weather.precip.partlyCloudy", fair: true },
  mostlyCloudy: { label: "ACKS-FORMATION.travel.weather.precip.mostlyCloudy", fair: true },
  overcast: { label: "ACKS-FORMATION.travel.weather.precip.overcast", fair: true },
  drizzly: { label: "ACKS-FORMATION.travel.weather.precip.drizzly", condition: true, wet: true },
  rainy: { label: "ACKS-FORMATION.travel.weather.precip.rainy", condition: true, wet: true, raining: true },
  misty: { label: "ACKS-FORMATION.travel.weather.precip.misty", derived: true, fair: true },
  foggy: { label: "ACKS-FORMATION.travel.weather.precip.foggy", derived: true, condition: true },
  flurry: { label: "ACKS-FORMATION.travel.weather.precip.flurry", derived: true, condition: true, wet: true },
  snowy: { label: "ACKS-FORMATION.travel.weather.precip.snowy", derived: true, condition: true, wet: true, snowing: true },
});

/** The four seasons the modifier grid is keyed by. */
export const SEASONS = Object.freeze(["winter", "spring", "summer", "fall"]);

/**
 * The Köppen climate codes the generator accepts — public science, shipped
 * as keys with their standard climatological names. What each code is WORTH
 * per season is the book's and arrives with the `climateModifiers` table.
 * `group` drives the picker's optgroups (A tropical … E polar).
 */
export const CLIMATES = Object.freeze({
  Af: { label: "ACKS-FORMATION.travel.weather.climates.Af", group: "A" },
  Am: { label: "ACKS-FORMATION.travel.weather.climates.Am", group: "A" },
  Aw: { label: "ACKS-FORMATION.travel.weather.climates.Aw", group: "A" },
  As: { label: "ACKS-FORMATION.travel.weather.climates.As", group: "A" },
  BWh: { label: "ACKS-FORMATION.travel.weather.climates.BWh", group: "B" },
  BWk: { label: "ACKS-FORMATION.travel.weather.climates.BWk", group: "B" },
  BSh: { label: "ACKS-FORMATION.travel.weather.climates.BSh", group: "B" },
  BSk: { label: "ACKS-FORMATION.travel.weather.climates.BSk", group: "B" },
  Csa: { label: "ACKS-FORMATION.travel.weather.climates.Csa", group: "C" },
  Csb: { label: "ACKS-FORMATION.travel.weather.climates.Csb", group: "C" },
  Csc: { label: "ACKS-FORMATION.travel.weather.climates.Csc", group: "C" },
  Cwa: { label: "ACKS-FORMATION.travel.weather.climates.Cwa", group: "C" },
  Cwb: { label: "ACKS-FORMATION.travel.weather.climates.Cwb", group: "C" },
  Cwc: { label: "ACKS-FORMATION.travel.weather.climates.Cwc", group: "C" },
  Cfa: { label: "ACKS-FORMATION.travel.weather.climates.Cfa", group: "C" },
  Cfb: { label: "ACKS-FORMATION.travel.weather.climates.Cfb", group: "C" },
  Cfc: { label: "ACKS-FORMATION.travel.weather.climates.Cfc", group: "C" },
  Dsa: { label: "ACKS-FORMATION.travel.weather.climates.Dsa", group: "D" },
  Dsb: { label: "ACKS-FORMATION.travel.weather.climates.Dsb", group: "D" },
  Dsc: { label: "ACKS-FORMATION.travel.weather.climates.Dsc", group: "D" },
  Dwa: { label: "ACKS-FORMATION.travel.weather.climates.Dwa", group: "D" },
  Dwb: { label: "ACKS-FORMATION.travel.weather.climates.Dwb", group: "D" },
  Dwc: { label: "ACKS-FORMATION.travel.weather.climates.Dwc", group: "D" },
  Dwd: { label: "ACKS-FORMATION.travel.weather.climates.Dwd", group: "D" },
  Dfa: { label: "ACKS-FORMATION.travel.weather.climates.Dfa", group: "D" },
  Dfb: { label: "ACKS-FORMATION.travel.weather.climates.Dfb", group: "D" },
  Dfc: { label: "ACKS-FORMATION.travel.weather.climates.Dfc", group: "D" },
  Dfd: { label: "ACKS-FORMATION.travel.weather.climates.Dfd", group: "D" },
  ET: { label: "ACKS-FORMATION.travel.weather.climates.ET", group: "E" },
  EF: { label: "ACKS-FORMATION.travel.weather.climates.EF", group: "E" },
});

/**
 * The thirteen mechanical weather conditions (RR ch. 6). What each is worth
 * — a speed factor, a visibility floor, a throw penalty — is printed; the
 * speed factors are the `conditionSpeed` table and the rest arrive with the
 * features that consume them. Effects of several at once stack.
 */
export const CONDITIONS = Object.freeze({
  frigid: { label: "ACKS-FORMATION.travel.weather.cond.frigid" },
  cold: { label: "ACKS-FORMATION.travel.weather.cond.cold" },
  sweltering: { label: "ACKS-FORMATION.travel.weather.cond.sweltering" },
  drizzly: { label: "ACKS-FORMATION.travel.weather.cond.drizzly" },
  flurry: { label: "ACKS-FORMATION.travel.weather.cond.flurry" },
  foggy: { label: "ACKS-FORMATION.travel.weather.cond.foggy" },
  rainy: { label: "ACKS-FORMATION.travel.weather.cond.rainy" },
  snowy: { label: "ACKS-FORMATION.travel.weather.cond.snowy" },
  sunbaked: { label: "ACKS-FORMATION.travel.weather.cond.sunbaked" },
  windy: { label: "ACKS-FORMATION.travel.weather.cond.windy" },
  stormy: { label: "ACKS-FORMATION.travel.weather.cond.stormy" },
  muddy: { label: "ACKS-FORMATION.travel.weather.cond.muddy" },
  snowbound: { label: "ACKS-FORMATION.travel.weather.cond.snowbound" },
});

/** The footing before any weather has touched it. */
export function freshFooting() {
  return { mud: "none", snow: false, runs: {} };
}

/**
 * The active condition keys for a day's sky and ground, in CONDITIONS order
 * — the derivation every consumer (chips, factors, the log) shares.
 */
export function conditionsOf({ temperature = "", precipitation = "", wind = "", footing = null } = {}) {
  const set = new Set();
  const t = TEMPERATURE_BANDS[temperature];
  if (t?.condition) set.add(t.condition);
  if (PRECIPITATION_KINDS[precipitation]?.condition) set.add(precipitation);
  const w = WIND_BANDS[wind];
  if (w?.condition) set.add(w.condition);
  if (footing?.mud === "muddy") set.add("muddy");
  if (footing?.snow) set.add("snowbound");
  return Object.keys(CONDITIONS).filter((k) => set.has(k));
}

/**
 * The combination rules, applied to a rolled precipitation: freezing air
 * first (drizzle to flurries, rain to snow), then — only when nothing froze
 * — still air (drizzle to mist, rain to fog). Day temperature governs.
 */
export function applyRewrites({ temperature = "", precipitation = "", wind = "" } = {}) {
  let p = precipitation;
  if (TEMPERATURE_BANDS[temperature]?.freezing) {
    if (p === "drizzly") p = "flurry";
    else if (p === "rainy") p = "snowy";
  } else if (WIND_BANDS[wind]?.stills) {
    if (p === "drizzly") p = "misty";
    else if (p === "rainy") p = "foggy";
  }
  return p;
}

/** One 2d6, from an injectable uniform rng. */
const roll2d6 = (rng) => 2 + Math.floor(rng() * 6) + Math.floor(rng() * 6);

/**
 * The weather-fronts drift: today's roll slides one step toward yesterday's.
 * A natural 2 or 12 stands — the book exempts the unmodified extremes.
 */
export function frontShift(natural, prior) {
  if (natural === 2 || natural === 12) return natural;
  if (!Number.isFinite(prior) || prior === natural) return natural;
  return natural + Math.sign(prior - natural);
}

/**
 * A day's weather from the registered tables.
 *
 * @param {object} o
 * @param {string} o.climate a CLIMATES key
 * @param {string} o.season a SEASONS entry
 * @param {{t,p,w}} [o.prior] yesterday's naturals, for the fronts drift
 * @param {boolean} [o.fronts] apply the drift
 * @param {function} [o.rng] uniform [0,1) source, injectable for tests
 * @param {{t,p,w}} [o.rolls] fixed naturals instead of rolling (tests)
 * @returns {{ok, missing: string[], temperature, temperatureNight,
 *   precipitation, wind, rolls: {t,p,w}}} — `ok: false` names what the
 *   registry lacks, and the caller leaves the manual picks standing.
 */
export function generateDay({ climate = "", season = "spring", prior = null, fronts = false, rng = Math.random, rolls = null } = {}) {
  const missing = [];
  if (!CLIMATES[climate]) missing.push("climate");
  const mods = readTable(WEATHER_DOC, "climateModifiers")?.[climate]?.[season];
  if (!missing.length && !mods) missing.push("climateModifiers");

  const tempTableId = Number(mods?.tDay) <= 0 ? "dailyTemperatureLow" : "dailyTemperatureHigh";
  const tempTable = readTable(WEATHER_DOC, tempTableId);
  const precipTable = readTable(WEATHER_DOC, "dailyPrecipitation");
  const windTable = readTable(WEATHER_DOC, "dailyWind");
  if (mods && !Array.isArray(tempTable)) missing.push(tempTableId);
  if (!Array.isArray(precipTable)) missing.push("dailyPrecipitation");
  if (!Array.isArray(windTable)) missing.push("dailyWind");
  if (missing.length) return { ok: false, missing };

  let n = rolls ?? { t: roll2d6(rng), p: roll2d6(rng), w: roll2d6(rng) };
  if (fronts && prior) {
    n = { t: frontShift(n.t, prior.t), p: frontShift(n.p, prior.p), w: frontShift(n.w, prior.w) };
  }

  const band = (table, total, vocab) => {
    const key = bracketRow(table, total)?.key;
    return vocab[key] ? key : "";
  };
  const temperature = band(tempTable, n.t + Number(mods.tDay || 0), TEMPERATURE_BANDS);
  const temperatureNight = band(tempTable, n.t + Number(mods.tNight || 0), TEMPERATURE_BANDS);
  const wind = band(windTable, n.w + Number(mods.w || 0), WIND_BANDS);
  const rolled = band(precipTable, n.p + Number(mods.p || 0), PRECIPITATION_KINDS);
  const precipitation = applyRewrites({ temperature, precipitation: rolled, wind });

  return { ok: true, missing: [], temperature, temperatureNight, precipitation, wind, rolls: n };
}

/**
 * A finished day settles onto the ground: the footing state machine.
 *
 * The TRANSITIONS ship — snow lies after enough snowy or flurry days; snow
 * leaves under warm days, and its melt-water is mud; rain muds the terrains
 * that take mud; a freezing fair day hardens mud and a thaw softens it
 * again (the thaw is this module's reading — the book freezes mud and says
 * no more); fair days dry it. Every THRESHOLD is printed and read from the
 * `accumulation` table (day counts, keyed by transition); absent, the
 * footing holds still and the Judge's manual controls are the weather.
 *
 * Consecutive-day counters live in `runs` and reset the day their
 * condition breaks.
 */
export function advanceGround(footing, { temperature = "", precipitation = "", mudProne = true } = {}) {
  const th = readTable(WEATHER_DOC, "accumulation");
  const f = { ...freshFooting(), ...(footing ?? {}) };
  if (!th) return { ...f, missing: true };

  const p = PRECIPITATION_KINDS[precipitation] ?? {};
  const t = TEMPERATURE_BANDS[temperature] ?? {};
  const fair = !!p.fair;
  const freezing = !!t.freezing;
  const sweltering = temperature === "sweltering";
  const moderate = !freezing && !sweltering && !!temperature;

  const r = { ...(f.runs ?? {}) };
  const step = (key, on) => { r[key] = on ? Math.min(999, (Number(r[key]) || 0) + 1) : 0; };
  step("drizzly", precipitation === "drizzly");
  step("rainy", precipitation === "rainy");
  step("flurry", precipitation === "flurry");
  step("snowy", precipitation === "snowy");
  step("fairModerate", fair && moderate);
  step("fairSweltering", fair && sweltering);
  step("fairFreezing", fair && freezing);
  step("tempModerate", moderate);
  step("tempSweltering", sweltering);

  const met = (run, key) => Number.isFinite(Number(th[key])) && run >= Number(th[key]);
  let { mud, snow } = f;

  // A transition that CREATES mud starts its drying clock at zero — the day
  // the melt-water arrived is not also its first drying day.
  const freshMud = () => {
    mud = "muddy";
    r.fairModerate = 0;
    r.fairSweltering = 0;
  };
  if (!snow && (met(r.snowy, "snowFromSnowy") || met(r.flurry, "snowFromFlurry"))) snow = true;
  if (snow && (met(r.tempSweltering, "snowMeltSweltering") || met(r.tempModerate, "snowMeltModerate"))) {
    snow = false;
    freshMud();
    r.tempModerate = 0;
    r.tempSweltering = 0;
  }
  if (mud === "none" && mudProne && (met(r.rainy, "mudFromRainy") || met(r.drizzly, "mudFromDrizzly"))) mud = "muddy";
  if (mud === "frozen" && !freezing) freshMud();
  if (mud === "muddy" && met(r.fairFreezing, "mudFreeze")) mud = "frozen";
  if (mud === "muddy" && (met(r.fairSweltering, "mudDrySweltering") || met(r.fairModerate, "mudDryModerate"))) mud = "none";

  return { mud, snow, runs: r };
}

/** Whether the terrain under the march takes mud at all. */
export function terrainMudProne(terrain) {
  return !!TERRAIN[String(terrain)]?.mudProne;
}

/** Whether the registry holds enough of the `weather` document to generate. */
export function generatorReady() {
  return !!(
    readTable(WEATHER_DOC, "climateModifiers") &&
    readTable(WEATHER_DOC, "dailyPrecipitation") &&
    readTable(WEATHER_DOC, "dailyWind") &&
    (readTable(WEATHER_DOC, "dailyTemperatureLow") || readTable(WEATHER_DOC, "dailyTemperatureHigh"))
  );
}
