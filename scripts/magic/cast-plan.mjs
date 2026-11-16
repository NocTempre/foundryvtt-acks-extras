/**
 * What stands in the way of a cast, before it spends anything. Each finding is
 * a verdict id with a severity: a Player is blocked and a Judge only warned
 * (the repo's automation rule). FOUNDRY-FREE.
 */
import { conditionSet, forbiddenBy } from "../lib/conditions.mjs";
import { CAPACITY } from "./cast-capacity.mjs";
import { rowNeedsThrow } from "./cast-rows.mjs";

/** The verdict ids. */
export const VERDICT = Object.freeze({ noSlot: "noSlot", severalTargets: "severalTargets", forbidden: "forbidden" });

/**
 * The verdicts for one cast.
 *
 * @param {object} from
 * @param {{verdict: string}} from.capacity  `castCapacity`'s answer
 * @param {object[]} from.targets  the seat's targeted tokens
 * @param {Array<{row: object}>} from.rows  the rows the cast keeps
 * @param {Iterable<string>} [from.statuses]  the caster's status ids
 * @param {boolean} from.isGM
 * @returns {Array<{key: string, severity: "block"|"warn", conditions?: string[]}>}
 */
export function castVerdicts({ capacity, targets = [], rows = [], statuses = [], isGM = false } = {}) {
  const severity = isGM ? "warn" : "block";
  const out = [];
  if (capacity?.verdict === CAPACITY.none) out.push({ key: VERDICT.noSlot, severity });
  if (targets.length > 1 && rows.some(({ row }) => rowNeedsThrow(row))) out.push({ key: VERDICT.severalTargets, severity });
  const stopped = forbiddenBy(conditionSet(statuses), "cast");
  if (stopped.length) out.push({ key: VERDICT.forbidden, severity, conditions: stopped });
  return out;
}

/** Does any verdict stop this seat's cast? */
export const blocked = (verdicts) => (verdicts ?? []).some((v) => v.severity === "block");
