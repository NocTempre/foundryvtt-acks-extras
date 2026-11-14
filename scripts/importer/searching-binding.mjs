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
 * The cadences are kept as TURNS, the unit both are printed in. Like every
 * binding here, no value ships.
 */
import { MODULE_ID } from "./constants.mjs";
import * as services from "../lib/services.mjs";
import { getLayer, PRIORITY } from "../lib/tables.mjs";
import { numOrNull } from "../lib/util.mjs";
import { assembledDoc } from "./produces.mjs";
import { parseCount } from "./survival-binding.mjs";
import { parseTargetPlus, parseSignedClause } from "./binding-parse.mjs";
import { terrainKeys } from "./terrain-vocab.mjs";

/** The engine doc both halves agree on (`expectTables`). */
export const SEARCHING_DOC_ID = "searching";

/**
 * The engine tables this binding assembles, each with the raw table(s) it is
 * read from: the producer list `tools/validate-producers.mjs` checks readers
 * against, and the map `assembledDoc` cites the assembled tables by.
 */
export const PRODUCES = Object.freeze({
  [SEARCHING_DOC_ID]: {
    targets: "searchLadder",
    specificTarget: "searchProse",
    aerialTurnsPerThrow: "searchProse",
    canopyPenalty: "searchProse",
    canopyTerrains: "searchProse",
    movingQuarry: ["searchProse", "lostSearchProse"],
    trackingBonus: "searchProse",
    turnsPerThrow: "cadenceProse",
    surveyTarget: "surveyProse",
    surveyPerSearch: "surveyProse",
  },
});

/* ------------------------------------------------------------------ */
/*  Parsers                                                            */
/* ------------------------------------------------------------------ */

/**
 * A cadence in TURNS: a throws-per-turn-count clause, or an hour with its turn
 * count in parentheses (RR p. 274). The parenthesised turn count is preferred
 * where the page gives both.
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
 * is the terminator.
 */
export function parseTerrainList(text) {
  const t = String(text ?? "").toLowerCase();
  const m = /([a-z,\s]+?)\s*\bterrain\b/.exec(t);
  if (!m) return null;
  // Everything up to and including "searching" is run-in, wherever it sits: a
  // window can open on the clause itself or one connective word earlier (RR p. 274).
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
 * pair them with their target and put them in order.
 */
export function assembleLadder(rows = {}) {
  const out = [];
  // `numOrNull` reads null and "" as absent, so the open top row keeps a null
  // max instead of becoming a zero.
  for (const cells of Object.values(rows)) {
    if (!cells || cells.__missing) continue;
    const target = parseTargetPlus(cells.target);
    const min = numOrNull(cells.min);
    if (target == null || min == null) continue;
    out.push({ min, max: numOrNull(cells.max), target });
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

  const specific = parseSignedClause(prose.specific);
  if (specific != null) out.specificTarget = specific;

  // A quarry that is itself moving is the lost-party rule, and is printed with
  // the rendezvous rules rather than here.
  const moving = parseSignedClause(prose.moving ?? raw.lostSearchProse?.moving ?? "");
  if (moving != null) out.movingQuarry = moving;

  const tracking = parseSignedClause(prose.tracking);
  if (tracking != null) out.trackingBonus = tracking;

  const hour = parseTurns(raw.cadenceProse?.hour);
  if (hour != null) out.turnsPerThrow = hour;

  const aerial = parseTurns(prose.cadence);
  if (aerial != null) out.aerialTurnsPerThrow = aerial;

  const canopy = parseSignedClause(prose.canopy);
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
  const doc = getLayer(SEARCHING_DOC_ID, PRIORITY.WORLD);
  if (!svc || !doc) return { assembled: [] };
  const engine = assembleSearchingTables(doc.tables ?? {});
  if (!Object.keys(engine).length) return { assembled: [] };
  await svc.importDoc(
    assembledDoc(doc, engine, PRODUCES[SEARCHING_DOC_ID]),
    { priority: PRIORITY.WORLD, source: MODULE_ID },
  );
  return { assembled: Object.keys(engine) };
}
