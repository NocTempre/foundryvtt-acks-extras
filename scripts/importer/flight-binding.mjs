/**
 * Flight assembly: the raw RR ch. 6 air-movement reads → the engine-shaped
 * `flight` ruledata tables acks-extras declares.
 *
 * Three factors and one exception. A creature that can stay up all day covers
 * twice the ground; wind costs half of that; a flier carrying more than its
 * normal load moves at half speed. The exception — that wind is the ONE
 * weather condition air movement does not take in the ordinary way — is the
 * rule's own shape and lives in the flight code, not in this table.
 *
 * The page states all three in words rather than figures ("doubled", "halve",
 * "at half speed"), which is still a printed value: it is the size of the
 * effect, and the reader must not assume it. So the words are read into the
 * factors they name, here, once. Like every binding here, no value ships.
 */
import { MODULE_ID } from "./constants.mjs";
import * as services from "../lib/services.mjs";
import { hasDoc, getDoc, PRIORITY } from "../lib/tables.mjs";

/** The engine doc both halves agree on (acks-extras `expectTables`). */
export const FLIGHT_DOC_ID = "flight";

/* ------------------------------------------------------------------ */
/*  Parsers                                                            */
/* ------------------------------------------------------------------ */

/**
 * A factor written as a word or a figure: "doubled" → 2, "halve"/"half" →
 * 0.5, "×1/3" → 1/3, "25%" → 0.25.
 *
 * Deliberately word-first. On these pages the numeral in the sentence is
 * usually an EXAMPLE ("an exploration speed of 120’… would have an air speed
 * of 48 miles"), and a figure-first reader takes the example for the rule.
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
 * The load clause states BOTH factors in one sentence — full speed under the
 * normal load, half speed above it — so the half is read from the part after
 * the comma. Reading the whole sentence would find "full" first and price a
 * heavy flier as an unburdened one.
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
 * The engine tables from the raw ones. Pure — the committed tests feed it
 * invented prose.
 */
export function assembleFlightTables(raw = {}) {
  const out = {};
  const air = raw.airProse ?? {};

  // Either sentence names the day-aloft factor; the second exists so a drifted
  // first window does not cost the table.
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
  if (!svc || !hasDoc(FLIGHT_DOC_ID)) return { assembled: [] };
  const doc = getDoc(FLIGHT_DOC_ID);
  const engine = assembleFlightTables(doc.tables ?? {});
  if (!Object.keys(engine).length) return { assembled: [] };
  await svc.importDoc(
    { id: FLIGHT_DOC_ID, source: doc.source, tables: { ...(doc.tables ?? {}), ...engine } },
    { priority: PRIORITY.WORLD, source: MODULE_ID },
  );
  return { assembled: Object.keys(engine) };
}
