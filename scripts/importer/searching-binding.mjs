/**
 * Searching-table assembly: the raw RR ch. 6 reads → the engine-shaped
 * `searching` ruledata tables acks-extras declares (its search throw, aerial
 * cadence and land-survey derivations read them via `expectTables`).
 *
 * The ladder is a real grid — target by expedition speed — and arrives as
 * labelled bands; everything that MOVES that target is prose. This step turns
 * the bands into the bracketed rows the engine looks up in, and the prose into
 * the four modifiers that shift the throw and the two cadences that decide how
 * often it is made.
 *
 * The cadences are kept as TURNS rather than hours because that is the unit
 * both are printed in, and because the aerial exception is three turns where
 * the ordinary case is six — expressed in hours, one of them is a fraction for
 * no reason. Like every binding here, no value ships.
 */
import { MODULE_ID } from "./constants.mjs";
import * as services from "../lib/services.mjs";
import { hasDoc, getDoc, PRIORITY } from "../lib/tables.mjs";
import { parseCount } from "./survival-binding.mjs";
import { terrainKeys } from "./terrain-vocab.mjs";

/** The engine doc both halves agree on (acks-extras `expectTables`). */
export const SEARCHING_DOC_ID = "searching";

/* ------------------------------------------------------------------ */
/*  Parsers                                                            */
/* ------------------------------------------------------------------ */

/** "18+" anywhere in a window → 18. */
export function parseTargetPlus(text) {
  const m = /(\d+)\s*\+/.exec(String(text ?? ""));
  return m ? Number(m[1]) : null;
}

/** The first signed modifier, sign preserved ("-8 penalty" → -8). */
export function parseSigned(text) {
  const m = /([+-]\s*\d+)/.exec(String(text ?? ""));
  return m ? Number(m[1].replace(/\s+/g, "")) : null;
}

/**
 * A cadence in TURNS: "one searching throw per three turns", "each hour (six
 * turns)". The parenthesised turn count is preferred where the page gives both,
 * because it is the exact figure and the hour is its round description.
 */
export function parseTurns(text) {
  const t = String(text ?? "").toLowerCase();
  const paren = /\((\d+|[a-z-]+)\s*turns?\)/.exec(t);
  if (paren) {
    const n = parseCount(paren[1]);
    if (n != null) return n;
  }
  const bare = /per\s+(\d+|[a-z-]+)\s*turns?/.exec(t);
  if (bare) {
    const n = parseCount(bare[1]);
    if (n != null) return n;
  }
  return null;
}

/**
 * The terrains named in a clause, up to the word "terrain".
 *
 * Both clauses on this page are a comma list ending in that noun, so the noun
 * is the terminator rather than punctuation — which a terrain list is full of.
 */
export function parseTerrainList(text) {
  const t = String(text ?? "").toLowerCase();
  const m = /([a-z,\s]+?)\s*\bterrain\b/.exec(t);
  if (!m) return null;
  // Everything up to and including "searching" is run-in, wherever it sits: a
  // window can open on the clause ("when searching forest…") or one word
  // earlier ("however, when searching…"), and an anchored strip only handles
  // whichever of the two it was written against.
  const list = m[1]
    .replace(/^.*\bsearching\s+/s, "")
    .replace(/^[^a-z]+/, "")
    .split(/,|\bor\b|\band\b/)
    .map((w) => w.trim())
    .filter(Boolean);
  return list.length ? list : null;
}

/**
 * The ladder's rows, bracketed.
 *
 * The recipe reads each row's label as a `milesBand` — `{min, max}` with a null
 * max on the open top row — so the bounds ride the row and this only has to
 * pair them with their target and put them in order. An unbounded row that
 * sorts anywhere but last would silently swallow the ladder.
 */
export function assembleLadder(rows = {}) {
  const out = [];
  // `Number(null)` is 0 and 0 is finite, so a finiteness test alone turns the
  // open top row into one that ends at zero miles — a ladder that then covers
  // nothing above its last bounded band.
  const num = (v) => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  for (const cells of Object.values(rows)) {
    if (!cells || cells.__missing) continue;
    const target = parseTargetPlus(cells.target);
    const min = num(cells.min);
    if (target == null || min == null) continue;
    out.push({ min, max: num(cells.max), target });
  }
  if (!out.length) return null;
  out.sort((a, b) => a.min - b.min);
  return out;
}

/* ------------------------------------------------------------------ */
/*  Assembly                                                           */
/* ------------------------------------------------------------------ */

/**
 * The engine tables from the raw ones. Pure — the committed tests feed it
 * invented bands and prose.
 */
export function assembleSearchingTables(raw = {}) {
  const out = {};

  const ladder = assembleLadder(raw.searchLadder ?? {});
  if (ladder) out.targets = ladder;

  const prose = raw.searchProse ?? {};

  const specific = parseSigned(prose.specific);
  if (specific != null) out.specificTarget = specific;

  // A quarry that is itself moving is the lost-party rule, and is printed with
  // the rendezvous rules rather than here.
  const moving = parseSigned(prose.moving ?? raw.lostSearchProse?.moving ?? "");
  if (moving != null) out.movingQuarry = moving;

  const hour = parseTurns(raw.cadenceProse?.hour);
  if (hour != null) out.turnsPerThrow = hour;

  const aerial = parseTurns(prose.cadence);
  if (aerial != null) out.aerialTurnsPerThrow = aerial;

  const canopy = parseSigned(prose.canopy);
  if (canopy != null) out.canopyPenalty = canopy;
  const closed = parseTerrainList(prose.canopy);
  if (closed) out.canopyTerrains = terrainKeys(closed);

  const survey = raw.surveyProse ?? {};
  const surveyTarget = parseTargetPlus(survey.target);
  if (surveyTarget != null) out.surveyTarget = surveyTarget;
  const per = /([+-]\s*\d+)\s*bonus\s+for\s+each/i.exec(String(survey.target ?? ""));
  if (per) out.surveyPerSearch = Number(per[1].replace(/\s+/g, ""));

  return out;
}

/** Assemble and register, or report nothing assembled. */
export async function applySearchingImport() {
  const svc = services.get("ruledata-import");
  if (!svc || !hasDoc(SEARCHING_DOC_ID)) return { assembled: [] };
  const doc = getDoc(SEARCHING_DOC_ID);
  const engine = assembleSearchingTables(doc.tables ?? {});
  if (!Object.keys(engine).length) return { assembled: [] };
  await svc.importDoc(
    { id: SEARCHING_DOC_ID, source: doc.source, tables: { ...(doc.tables ?? {}), ...engine } },
    { priority: PRIORITY.WORLD, source: MODULE_ID },
  );
  return { assembled: Object.keys(engine) };
}
