/**
 * Flight assembly: the raw RR ch. 6 air-movement reads → the engine-shaped
 * `flight` ruledata tables acks-extras declares.
 *
 * Three factors: the day-aloft factor, the wind factor and the heavy-load
 * factor. The page states them in words rather than figures, which is still a
 * printed value, so the words are read here into the factors they name. How
 * wind is treated as a weather condition lives in the flight code, not in this
 * table. No value ships.
 */
import { MODULE_ID } from "./constants.mjs";
import * as services from "../lib/services.mjs";
import { getLayer, PRIORITY } from "../lib/tables.mjs";
import { assembledDoc } from "./produces.mjs";

/** The engine doc both halves agree on (acks-extras `expectTables`). */
export const FLIGHT_DOC_ID = "flight";

/**
 * The engine tables this binding assembles, each with the raw table(s) it is
 * read from: the producer list `tools/validate-producers.mjs` checks readers
 * against, and the map `assembledDoc` cites the assembled tables by.
 */
export const PRODUCES = Object.freeze({
  [FLIGHT_DOC_ID]: { aloftFactor: "airProse", windFactor: "airProse", loadFactors: "loadProse" },
});

/* ------------------------------------------------------------------ */
/*  Parsers                                                            */
/* ------------------------------------------------------------------ */

/**
 * A factor written as a word, a fraction or a percentage, as a number; null
 * when none reads. Word-first: a numeral in these sentences is usually a worked
 * example, which a figure-first reader would take for the rule.
 */
export function parseFactor(text) {
  const t = String(text ?? "").toLowerCase();
  if (/\bdoubled?\b|\btwice\b/.test(t)) return 2;
  if (/\btripled?\b|\bthrice\b/.test(t)) return 3;
  if (/\bhalve[sd]?\b|\bhalf\b/.test(t)) return 0.5;
  if (/\bquarter\b/.test(t)) return 0.25;
  const frac = /(\d+)\s*\/\s*(\d+)/.exec(t);
  if (frac && Number(frac[2]) !== 0) return Number(frac[1]) / Number(frac[2]);
  const pct = /(\d+(?:\.\d+)?)\s*%/.exec(t);
  if (pct) return Number(pct[1]) / 100;
  return null;
}

/**
 * The heavy-load factor. The clause states both the normal and the heavy
 * factor, so it is read from the part after the split word; the whole sentence
 * would read the normal one first.
 */
export function parseHeavyLoadFactor(text) {
  const t = String(text ?? "").toLowerCase();
  const at = t.search(/\band\s+at\b|,\s*and\b|\bbut\b/);
  return parseFactor(at === -1 ? t : t.slice(at));
}

/* ------------------------------------------------------------------ */
/*  Assembly                                                           */
/* ------------------------------------------------------------------ */

/**
 * The engine tables from the raw ones. Pure.
 */
export function assembleFlightTables(raw = {}) {
  const out = {};
  const air = raw.airProse ?? {};

  // The second sentence is the fallback for a drifted first window.
  const aloft = parseFactor(air.aloft) ?? parseFactor(air.partial);
  if (aloft != null) out.aloftFactor = aloft;

  const wind = parseFactor(air.wind);
  if (wind != null) out.windFactor = wind;

  const heavy = parseHeavyLoadFactor(raw.loadProse?.heavy);
  if (heavy != null) out.loadFactors = { heavy };

  return out;
}

/** Assemble and register, or report nothing assembled. */
export async function applyFlightImport() {
  const svc = services.get("ruledata-import");
  const doc = getLayer(FLIGHT_DOC_ID, PRIORITY.WORLD);
  if (!svc || !doc) return { assembled: [] };
  const engine = assembleFlightTables(doc.tables ?? {});
  if (!Object.keys(engine).length) return { assembled: [] };
  await svc.importDoc(
    assembledDoc(doc, engine, PRODUCES[FLIGHT_DOC_ID]),
    { priority: PRIORITY.WORLD, source: MODULE_ID },
  );
  return { assembled: Object.keys(engine) };
}
