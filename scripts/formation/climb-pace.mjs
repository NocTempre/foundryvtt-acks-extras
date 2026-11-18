/**
 * The faster paces of a proficient climber (RR pp. 269-270): which ways of
 * crossing price a pace, and what each pace costs the throw. A climb, a crawling
 * traverse and a balancing traverse each carry a pair of penalties the importer
 * reads into the `formation` table (`climbPacePenalties`, `crawlPacePenalties`,
 * `balancePacePenalties`), in the order the page prints them: the pace nearer the
 * base one first. A member's pace is the pick on their crossing record
 * (`members.<id>.pace`): absent is the base pace, otherwise a member of `PACES`.
 *
 * Nothing here knows a size. A pair nobody imported answers null, and so does
 * a pace whose size is not a positive number (a Judge's override is free text);
 * the base pace costs nothing and needs no table.
 */
import { formationValue } from "./constants.mjs";

/** The paces a pick may name, the pace nearer the base one first: the order of an imported pair. */
export const PACES = Object.freeze(["faster", "fastest"]);

/**
 * The registered pair each obstacle prices its paces from. A rappel has none,
 * and neither has a jump, a swim or a squeeze; a key absent here prices no pace.
 */
export const PACE_TABLE = Object.freeze({
  easyClimb: "climbPacePenalties",
  sheerClimb: "climbPacePenalties",
  crawl: "crawlPacePenalties",
  narrowLedge: "balancePacePenalties",
  precariousLedge: "balancePacePenalties",
});

/** The registered table an obstacle prices its paces from, or null where it prices none. */
export const paceTableOf = (kind) => PACE_TABLE[kind] ?? null;

/**
 * What each pace costs the throw at this obstacle, as `{faster, fastest}`: a
 * positive magnitude, or null for a pace whose size is not imported. Null for
 * an obstacle that prices no pace at all.
 *
 * @param {string} kind a key of `OBSTACLES`
 * @returns {{faster: number|null, fastest: number|null}|null}
 */
export function pacePrices(kind) {
  const table = paceTableOf(kind);
  if (!table) return null;
  const pair = formationValue(table);
  const size = (i) => {
    const raw = Array.isArray(pair) ? pair[i] : null;
    const n = raw == null || raw === "" ? NaN : Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  return Object.fromEntries(PACES.map((pace, i) => [pace, size(i)]));
}

/** A stored pick as a pace: a member of `PACES`, else null (the base pace). */
export const paceOfPick = (pick) => (PACES.includes(pick) ? pick : null);
