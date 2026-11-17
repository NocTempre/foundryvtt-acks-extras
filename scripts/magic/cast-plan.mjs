/**
 * What stands in the way of a cast, before it spends anything. Each finding is
 * a verdict id with a severity: a Player is blocked and a Judge only warned
 * (the repo's automation rule), except `concentrating`, which is always a
 * warning because ending the caster's concentration is the cast's effect and
 * never a refusal. FOUNDRY-FREE.
 */
import { conditionSet, forbiddenBy } from "../lib/conditions.mjs";
import { CAPACITY } from "./cast-capacity.mjs";
import { rowNeedsThrow } from "./cast-rows.mjs";
import { needsBearer } from "./cast-mods.mjs";
import { MOMENT } from "./cast-moment.mjs";

/** The verdict ids. */
export const VERDICT = Object.freeze({
  noSlot: "noSlot",
  severalTargets: "severalTargets",
  forbidden: "forbidden",
  oneBearer: "oneBearer",
  concentrating: "concentrating",
  declarationLost: "declarationLost",
  noDeclaration: "noDeclaration",
  declared: "declared",
  outOfRange: "outOfRange",
  tooManyTargets: "tooManyTargets",
  tooManyInstances: "tooManyInstances",
});

/**
 * The verdicts for one cast.
 *
 * `moment` and `declaration` (`cast-moment.mjs`) say where the cast stands in a
 * fight. A declaration being resolved (`declaration.valid`) spends nothing, so
 * it is never short of a slot; a lost declaration, or none where the turn needs
 * one, blocks a Player and warns a Judge, whose cast then runs fresh with a
 * spend; a second declaration is blocked and warned the same way. A spell
 * declared by hand on the combatant (`declaration.hand`) counts as a
 * declaration for the missing-declaration verdict.
 *
 * @param {object} from
 * @param {{verdict: string}} from.capacity  `castCapacity`'s answer
 * @param {object[]} from.targets  the seat's targeted tokens
 * @param {Array<{row: object}>} from.rows  the rows the cast keeps
 * @param {Iterable<string>} [from.statuses]  the caster's status ids
 * @param {boolean} from.isGM
 * @param {number} [from.bearers]  how many tokens could bear a weapon buff; the targets by default
 * @param {boolean} [from.held]  the caster holds a concentration this cast would end
 * @param {string} [from.moment]  a `MOMENT` value; `free` by default
 * @param {{valid: object|null, lost: object|null, other: object|null, hand: boolean}|null} [from.declaration]  `declarationOf`'s answer
 * @param {{limit: number|null, parts: object[], out: object[]}|null} [from.range]  `rangeVerdicts`' answer; any target out of range is one verdict, carrying the targets, the limit and the range's parts
 * @param {number|null} [from.count]  the target count the import read, a cap; null where it was left blank
 * @param {{counts: Record<string, number|null>, assigned?: Record<string, number>}|null} [from.instances]  by row key, each thrown row's instance count (`cast-instances.mjs`) and how many throws the seat's split assigns; a thrown row with no count here counts as one
 * @returns {Array<{key: string, severity: "block"|"warn", conditions?: string[], out?: object[], limit?: number, parts?: object[], max?: number, over?: number}>}
 */
export function castVerdicts({ capacity, targets = [], rows = [], statuses = [], isGM = false, bearers = targets.length, held = false, moment = MOMENT.free, declaration = null, range = null, count = null, instances = null } = {}) {
  const severity = isGM ? "warn" : "block";
  const out = [];
  const resolving = moment === MOMENT.resolve && Boolean(declaration?.valid);
  if (moment === MOMENT.resolve && !resolving) {
    if (declaration?.lost) out.push({ key: VERDICT.declarationLost, severity });
    else if (!declaration?.hand) out.push({ key: VERDICT.noDeclaration, severity });
  }
  if (moment === MOMENT.declare && (declaration?.valid || declaration?.other)) out.push({ key: VERDICT.declared, severity });
  if (!resolving && capacity?.verdict === CAPACITY.none) out.push({ key: VERDICT.noSlot, severity });
  // One throw is aimed at one target; a count above one is split among targets, so only a count of one or a blank one is left with several.
  const thrown = rows.filter(({ row }) => rowNeedsThrow(row));
  if (targets.length > 1 && thrown.some(({ key }) => !(Number(instances?.counts?.[key]) > 1))) out.push({ key: VERDICT.severalTargets, severity });
  // A split that assigns more throws than the count is a verdict of its own: the first row over names its figures.
  const over = thrown.find(({ key }) => Number(instances?.assigned?.[key]) > Number(instances?.counts?.[key]));
  if (over) out.push({ key: VERDICT.tooManyInstances, severity, max: instances.counts[over.key], over: instances.assigned[over.key] - instances.counts[over.key] });
  // A declared spell takes its targets when it resolves, so neither check belongs to the declaring.
  if (moment !== MOMENT.declare) {
    if (range?.out?.length) out.push({ key: VERDICT.outOfRange, severity, out: range.out, limit: range.limit, parts: range.parts });
    const cap = Number(count);
    if (count != null && count !== "" && Number.isFinite(cap) && cap > 0 && targets.length > cap) out.push({ key: VERDICT.tooManyTargets, severity, max: cap, over: targets.length - cap });
  }
  if (needsBearer(rows) && bearers !== 1) out.push({ key: VERDICT.oneBearer, severity });
  const stopped = forbiddenBy(conditionSet(statuses), "cast");
  if (stopped.length) out.push({ key: VERDICT.forbidden, severity, conditions: stopped });
  if (held) out.push({ key: VERDICT.concentrating, severity: "warn" });
  return out;
}

/** Does any verdict stop this seat's cast? */
export const blocked = (verdicts) => (verdicts ?? []).some((v) => v.severity === "block");
