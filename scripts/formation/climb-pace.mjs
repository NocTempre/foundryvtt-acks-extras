/**
 * The faster paces of a proficient climber (RR pp. 269-270): which ways of
 * crossing price a pace, and what each pace costs the throw. A climb, a crawling
 * traverse and a balancing traverse each carry a pair of penalties the importer
 * reads into the `formation` table (`climbPacePenalties`, `crawlPacePenalties`,
 * `balancePacePenalties`), in the order the page prints them: the pace nearer the
 * base one first. A member's pace is the pick on their crossing record
 * (`members.<id>.pace`): absent is the base pace, otherwise a member of `PACES`.
 * The same paragraphs print the speed each pace moves at, read into
 * `climbPaceRates`, `crawlPaceRates` and `balancePaceRates` (`paceRates`).
 *
 * Nothing here knows a size or a speed. A pair nobody imported answers null,
 * and so does a pace whose size is not a positive number (a Judge's override is
 * free text); the base pace costs nothing and needs no table.
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

/**
 * The speeds a pace's rate is a share of, the module's names for the speeds a
 * pace paragraph can name (`importer/formation-binding.mjs` `PACE_SPEED_WORDS`):
 * a member's exploration speed, combat speed and running speed.
 */
export const PACE_SPEEDS = Object.freeze(["exploration", "combat", "run"]);

/**
 * The registered table each obstacle reads its paces' rates from, the same
 * grouping as `PACE_TABLE`. A rappel has none: no pace paragraph prints one.
 */
export const PACE_RATE_TABLE = Object.freeze({
  easyClimb: "climbPaceRates",
  sheerClimb: "climbPaceRates",
  crawl: "crawlPaceRates",
  narrowLedge: "balancePaceRates",
  precariousLedge: "balancePaceRates",
});

/**
 * The rate each pace moves at on this obstacle, as `{normal, faster, fastest}`,
 * each `{share, speed}`, a share of one of the member's own speeds
 * (`PACE_SPEEDS`), or null for a pace whose rate is not imported. `normal` is
 * the base pace's exploration-speed branch. A Judge's override is free text, so
 * only a share above zero of a named speed counts, as `progressRate` reads its
 * own. Null for an obstacle that prices no pace at all.
 *
 * @param {string} kind a key of `OBSTACLES`
 * @returns {{normal: object|null, faster: object|null, fastest: object|null}|null}
 */
export function paceRates(kind) {
  const table = PACE_RATE_TABLE[kind];
  if (!table) return null;
  const rates = formationValue(table);
  const read = (pace) => {
    const cell = rates?.[pace];
    const share = typeof cell?.share === "string" && cell.share.trim() !== "" ? Number(cell.share) : cell?.share;
    if (!Number.isFinite(share) || share <= 0 || !PACE_SPEEDS.includes(cell?.speed)) return null;
    return { share, speed: cell.speed };
  };
  return { normal: read("normal"), faster: read("faster"), fastest: read("fastest") };
}
