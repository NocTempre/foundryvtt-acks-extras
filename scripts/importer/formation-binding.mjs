/**
 * Formation assembly: the raw RR ch. 6 delve reads → the engine-shaped
 * `formation` ruledata tables acks-extras declares (the delve clock, the
 * carried-body load and the swimming throw read them through
 * `formationValue`).
 *
 * One page holds all eight figures (RR p. 271). The swimming paragraph gives
 * seven: what each named water condition costs the throw, what the Swimming
 * proficiency is worth, the share of speed a swimmer makes, the sink rate per
 * stone, a breath's base before Constitution, and the load a rescuer hauls —
 * the body's own figure and the share of its kit that comes with it. The rest
 * paragraph gives the turns an unrested party may explore before it is winded.
 *
 * Each figure is read out of a short window of prose and parsed here, once. A
 * window that did not read leaves its key absent, so the reader reports that
 * figure as unknown; nothing is defaulted. Like every binding here, no value
 * ships.
 */
import { MODULE_ID } from "./constants.mjs";
import * as services from "../lib/services.mjs";
import { getLayer, PRIORITY } from "../lib/tables.mjs";
import { assembledDoc } from "./produces.mjs";
import { parseCount, parseShare } from "./survival-binding.mjs";

/** The engine doc both halves agree on (acks-extras `expectTables`). */
export const FORMATION_DOC_ID = "formation";

/**
 * The engine tables this binding assembles, each with the raw table(s) it is
 * read from: the producer list `tools/validate-producers.mjs` checks readers
 * against, and the map `assembledDoc` cites the assembled tables by.
 */
export const PRODUCES = Object.freeze({
  [FORMATION_DOC_ID]: {
    restInterval: "restProse",
    carriedBodyStone: "swimmingProse",
    carriedGearShare: "swimmingProse",
    swimWaterModifiers: "swimmingProse",
    swimmingBonus: "swimmingProse",
    swimSpeedShare: "swimmingProse",
    sinkFeetPerStone: "swimmingProse",
    breathRounds: "swimmingProse",
  },
});

/**
 * The water conditions the swimming throw prices, as the engine names them
 * (`WATER` in formation/swimming.mjs) and as a sentence names them. `calm` is
 * not here: it costs nothing by definition and is never emitted.
 */
export const WATER_KEYS = Object.freeze(["cold", "rough"]);

/* ------------------------------------------------------------------ */
/*  Parsers                                                            */
/* ------------------------------------------------------------------ */

/** A count as prose writes it: digits, or a number word `parseCount` reads. */
const COUNT = "\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty";

/**
 * A share as prose writes it — a word, a fraction or a percentage — captured
 * whole for `parseShare`. Bounded on both sides, so "half" is never read out
 * of a longer word.
 */
const SHARE = /(?<![\w-])(one-half|one half|one-third|two-thirds|one-quarter|half|\d+\s*\/\s*\d+|\d+(?:\.\d+)?\s*%)(?![\w-])/;

/**
 * A window's first sentence, lowercased and whitespace-collapsed. Windows are
 * cut by length, so they run on into whatever follows, and a figure past the
 * full stop belongs to the next rule.
 */
export function firstSentence(window) {
  const t = String(window ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const end = t.search(/\.(?:\s|$)/);
  return end === -1 ? t : t.slice(0, end);
}

/**
 * Every figure printed with a sign, in reading order, as signed numbers. The
 * sign may be a hyphen or a true minus (−).
 */
export function signedFigures(text) {
  return [...String(text ?? "").matchAll(/([-+−])\s?(\d+(?:\.\d+)?)/g)]
    .map((m) => (m[1] === "+" ? 1 : -1) * Number(m[2]));
}

/** The first count a text prints, digits or a number word; null when none. */
export function firstCount(text) {
  const m = new RegExp(`(?<![\\w./-])(${COUNT})(?![\\w/-])`).exec(String(text ?? "").toLowerCase());
  return m ? parseCount(m[1]) : null;
}

/**
 * What each named water condition costs the throw, as `{cold, rough}`: the
 * signed figures of the sentence in printed order, paired with the conditions
 * in the order the sentence names them. Stored negative whatever sign is
 * printed — the reader subtracts a modifier, so a penalty raises the target.
 * A condition the sentence leaves without a figure is left out; null when
 * none pairs.
 */
export function parseWaterModifiers(window) {
  const s = firstSentence(window);
  const named = WATER_KEYS
    .map((key) => ({ key, at: s.search(new RegExp(`\\b${key}\\b`)) }))
    .filter((w) => w.at !== -1)
    .sort((a, b) => a.at - b.at);
  const figures = signedFigures(s);
  const out = {};
  named.forEach(({ key }, i) => {
    if (figures[i] != null) out[key] = -Math.abs(figures[i]);
  });
  return Object.keys(out).length ? out : null;
}

/** A bonus as a magnitude: the first signed figure of the sentence; null when none. */
export function parseBonusMagnitude(window) {
  const [first] = signedFigures(firstSentence(window));
  return first == null ? null : Math.abs(first);
}

/** A share of a whole, between zero and one; null when the sentence prints none. */
export function parseShareOf(window) {
  const share = parseShare(firstSentence(window), SHARE);
  return share != null && share > 0 && share <= 1 ? share : null;
}

/**
 * A distance in feet: the first figure the sentence prints with a feet mark
 * or a feet unit. A figure without one is not read — a rate in some other
 * unit is not this rate.
 */
export function parseFeet(window) {
  const re = new RegExp(`(?<![\\w./-])(${COUNT})\\s*(?:[’'′]|feet\\b|foot\\b|ft\\b)`, "g");
  for (const m of firstSentence(window).matchAll(re)) {
    const n = parseCount(m[1]);
    if (n != null && n > 0) return n;
  }
  return null;
}

/**
 * The load a rescuer hauls: the stone figure the body is weighed at — a whole
 * number, a decimal, or a whole number with a fraction — and the share of its
 * kit, read from AFTER that figure, because the figure itself may be written
 * with a fraction that is not the share.
 *
 * @returns {{stone: number|null, gearShare: number|null}}
 */
export function parseCarriedBody(window) {
  const s = firstSentence(window);
  const m = /(?<![\w./])(\d+(?:\.\d+)?)(?:\s+(\d+)\s*\/\s*(\d+))?\s*stone\b/.exec(s);
  if (!m) return { stone: null, gearShare: null };
  const fraction = m[2] != null && Number(m[3]) > 0 ? Number(m[2]) / Number(m[3]) : 0;
  const stone = Number(m[1]) + fraction;
  return {
    stone: Number.isFinite(stone) && stone > 0 ? stone : null,
    gearShare: parseShareOf(s.slice(m.index + m[0].length)),
  };
}

/**
 * Turns an unrested party may explore before it is winded: the count of
 * turns past which the paragraph winds it — the threshold the clock compares
 * against — else the count its rest cadence is stated per. Whole turns only.
 */
export function parseRestInterval(window) {
  const t = String(window ?? "").toLowerCase().replace(/\s+/g, " ");
  for (const re of [
    new RegExp(`\\bmore\\s+than\\s+(${COUNT})\\s+turns?\\b`),
    new RegExp(`\\bevery\\s+(${COUNT})\\s+turns?\\b`),
  ]) {
    const m = re.exec(t);
    const n = m ? parseCount(m[1]) : null;
    if (Number.isInteger(n) && n > 0) return n;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Assembly                                                           */
/* ------------------------------------------------------------------ */

/**
 * The engine tables from the raw ones. Pure — the committed tests feed it
 * invented prose. Each figure assembles on its own, so a window that drifted
 * costs that figure and nothing beside it.
 */
export function assembleFormationTables(raw = {}) {
  const out = {};
  const swim = raw.swimmingProse ?? {};

  const water = parseWaterModifiers(swim.water);
  if (water) out.swimWaterModifiers = water;

  const bonus = parseBonusMagnitude(swim.proficiency);
  if (bonus != null) out.swimmingBonus = bonus;

  const pace = parseShareOf(swim.pace);
  if (pace != null) out.swimSpeedShare = pace;

  const sink = parseFeet(swim.sink);
  if (sink != null) out.sinkFeetPerStone = sink;

  const breath = firstCount(firstSentence(swim.breath));
  if (breath != null && breath > 0) out.breathRounds = breath;

  const body = parseCarriedBody(swim.rescue);
  if (body.stone != null) out.carriedBodyStone = body.stone;
  if (body.gearShare != null) out.carriedGearShare = body.gearShare;

  const rest = parseRestInterval(raw.restProse?.cadence);
  if (rest != null) out.restInterval = rest;

  return out;
}

/** Assemble and register, or report nothing assembled. */
export async function applyFormationImport() {
  const svc = services.get("ruledata-import");
  const doc = getLayer(FORMATION_DOC_ID, PRIORITY.WORLD);
  if (!svc || !doc) return { assembled: [] };
  const engine = assembleFormationTables(doc.tables ?? {});
  if (!Object.keys(engine).length) return { assembled: [] };
  await svc.importDoc(
    assembledDoc(doc, engine, PRODUCES[FORMATION_DOC_ID]),
    { priority: PRIORITY.WORLD, source: MODULE_ID },
  );
  return { assembled: Object.keys(engine) };
}
