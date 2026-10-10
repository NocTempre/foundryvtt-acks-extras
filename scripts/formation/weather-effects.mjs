/**
 * What today's sky does to the throws, the eye and the body: the weather's
 * printed effects, merged for the day's conditions and the ground under them.
 *
 * `weather.mjs` says WHICH conditions a sky produces; `vehicle-speed.mjs`
 * prices what each costs the march. This reads the rest of a condition's
 * entry — the penalty on a search or a survey, the ceiling on how far anyone
 * can see, what a night's rest needs, the week's disease risk — out of the
 * registered `conditionEffects` table (RR 277-279) and merges it across the
 * conditions a day holds at once. Every figure is imported; what ships is
 * which effects exist, how two conditions combine, and the dust rule's shape:
 * a wind's worse clause applies only on the grounds the page names for it.
 *
 * Merging: throw and forage penalties from distinct conditions SUM — fog and
 * a dust-laden wind are two causes, and the rules stack modifiers that are
 * not the same modifier twice. The visibility ceiling takes the lowest, the
 * visibility factor the product, the air-speed factor the lowest. A night's
 * rest takes the strictest need. Disease keeps every condition's own risk,
 * because each is thrown on its own week.
 */
import { numOrNull } from "../lib/util.mjs";
import { readTable, WEATHER_DOC } from "../vehicles/vehicle-speed.mjs";

/** The throws a condition can tax, as the table keys them. */
export const WEATHER_THROWS = Object.freeze([
  "searching", "landSurveying", "navigation", "tracking", "trackingPerHour", "listening", "missile",
]);

/** The forage kinds a condition can tax. */
export const WEATHER_FORAGE = Object.freeze(["firewood", "water"]);

/** The table this reads; declared on the `weather` document by `module.mjs`. */
export const CONDITION_EFFECTS_TABLE = "conditionEffects";

const emptyEffects = (ok) => ({
  ok,
  throws: {},
  forage: {},
  visibility: { feet: null, factor: 1, parts: [] },
  airSpeed: null,
  dust: null,
  sunburn: null,
  rest: null,
  disease: [],
  frostbite: null,
  lines: [],
});

/** Add one signed figure to a keyed bucket, keeping where it came from. */
function addPenalty(bucket, kind, key, value) {
  const v = numOrNull(value);
  if (v == null || v === 0) return;
  const slot = bucket[kind] ?? (bucket[kind] = { value: 0, parts: [] });
  slot.value += v;
  slot.parts.push({ key, value: v });
}

/** Lower a ceiling, or set it where none stood. */
function lowerCeiling(visibility, key, feet) {
  const f = numOrNull(feet);
  if (f == null || f <= 0) return;
  visibility.feet = visibility.feet == null ? f : Math.min(visibility.feet, f);
  visibility.parts.push({ key, feet: f });
}

/** The stricter of two rest needs: needing both a fire and clothing beats either. */
function stricterRest(a, b, key) {
  const fire = !!(a?.fire || b?.fire);
  const clothing = !!(a?.clothing || b?.clothing);
  const both = !!(a?.both || b?.both);
  return { fire, clothing, both, keys: [...(a?.keys ?? []), key] };
}

/**
 * The merged effects of `conditions` (keys of `CONDITIONS` in weather.mjs)
 * on ground `terrain` (a `TERRAIN` key: barrens, desert, …).
 *
 * @returns {{ok: boolean, throws: Record<string, {value: number, parts: object[]}>,
 *   forage: Record<string, {value: number, parts: object[]}>,
 *   visibility: {feet: number|null, factor: number, parts: object[]},
 *   airSpeed: number|null, dust: {key: string, speed: number|null}|null,
 *   sunburn: object|null, rest: {fire: boolean, clothing: boolean, both: boolean, keys: string[]}|null,
 *   disease: Array<{key: string, days: number|null, pct: number|null}>,
 *   frostbite: object|null, lines: Array<{key: string, value: number|string|null}>}}
 *   `ok` is false while the table is unimported: every field then reads as
 *   nothing stated, and a consumer adds nothing.
 */
export function weatherEffects(conditions = [], { terrain = "" } = {}) {
  const table = readTable(WEATHER_DOC, "conditionEffects");
  const out = emptyEffects(!!table);
  if (!table) return out;

  for (const key of conditions ?? []) {
    const row = table?.[key];
    if (!row || typeof row !== "object") continue;

    for (const kind of WEATHER_THROWS) addPenalty(out.throws, kind, key, row.throws?.[kind]);
    for (const kind of WEATHER_FORAGE) addPenalty(out.forage, kind, key, row.forage?.[kind]);

    lowerCeiling(out.visibility, key, row.visibilityFeet);
    const factor = numOrNull(row.visibilityFactor);
    if (factor != null && factor > 0 && factor !== 1) {
      out.visibility.factor *= factor;
      out.visibility.parts.push({ key, factor });
    }

    const air = numOrNull(row.airSpeed);
    if (air != null && air > 0) out.airSpeed = out.airSpeed == null ? air : Math.min(out.airSpeed, air);

    // The dust clause: a wind over bare ground. It is the same wind, so its
    // figures join the wind's own under a key that says which clause spoke.
    const dust = row.dust;
    if (dust && terrain && (dust.terrains ?? []).includes(terrain)) {
      const dustKey = `${key}.dust`;
      for (const kind of WEATHER_THROWS) addPenalty(out.throws, kind, dustKey, dust.throws?.[kind]);
      lowerCeiling(out.visibility, dustKey, dust.visibilityFeet);
      out.dust = { key, speed: numOrNull(dust.speed) };
    }

    if (row.sunburn && !out.sunburn) out.sunburn = { key, ...row.sunburn };
    if (row.rest) out.rest = stricterRest(out.rest, row.rest, key);
    if (row.disease) {
      out.disease.push({ key, days: numOrNull(row.disease.days), pct: numOrNull(row.disease.pct) });
    }
    if (row.frostbite && !out.frostbite) out.frostbite = { key, ...row.frostbite };
  }

  out.lines = linesOf(out);
  return out;
}

/**
 * The readout: one line per stated effect, keyed for a label and carrying
 * the figure. Pure, so the view localizes.
 */
export function linesOf(effects) {
  const lines = [];
  for (const kind of WEATHER_THROWS) {
    const slot = effects.throws?.[kind];
    if (slot && slot.value) lines.push({ key: `throw.${kind}`, value: slot.value });
  }
  for (const kind of WEATHER_FORAGE) {
    const slot = effects.forage?.[kind];
    if (slot && slot.value) lines.push({ key: `forage.${kind}`, value: slot.value });
  }
  if (effects.visibility?.feet != null) lines.push({ key: "visibility.feet", value: effects.visibility.feet });
  if (effects.visibility && effects.visibility.factor !== 1) lines.push({ key: "visibility.factor", value: effects.visibility.factor });
  if (effects.airSpeed != null) lines.push({ key: "airSpeed", value: effects.airSpeed });
  if (effects.dust) lines.push({ key: "dust", value: effects.dust.speed });
  if (effects.sunburn) lines.push({ key: "sunburn", value: numOrNull(effects.sunburn.hours) });
  if (effects.rest) lines.push({ key: "rest", value: effects.rest.both ? "both" : "either" });
  for (const d of effects.disease ?? []) lines.push({ key: "disease", value: d.pct, condition: d.key });
  if (effects.frostbite) lines.push({ key: "frostbite", value: null });
  return lines;
}

/** The merged penalty on one throw kind; 0 when nothing is stated. */
export function throwPenalty(effects, kind) {
  return numOrNull(effects?.throws?.[kind]?.value) ?? 0;
}

/** The merged penalty on one forage kind; 0 when nothing is stated. */
export function foragePenalty(effects, kind) {
  return numOrNull(effects?.forage?.[kind]?.value) ?? 0;
}

/** True once the registry holds the table at all. */
export function weatherEffectsReady() {
  return !!readTable(WEATHER_DOC, "conditionEffects");
}
