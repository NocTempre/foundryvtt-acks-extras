/**
 * The formation's half of the turn plan, as arithmetic: what stops a member
 * locking anything at all, the lock with those stops first, what a move does to
 * the plan, and the order a planned turn runs in (JJ ch. 2, Sequence of Play).
 *
 * Foundry-free. The plan helpers are lib's (`lib/turn-activities.mjs`); this
 * file adds what only the party knows (the clock, the fight, who is down) and
 * takes every effect — the clock's spend, the flag write, the rolls — as a
 * passed-in function, so the order is tested without a world.
 */
import { advanceTurn, lockActivity, partyRest, resolveDue } from "../lib/turn-activities.mjs";

/**
 * The reason ids the party itself refuses a lock with, before any activity is
 * asked. A consumer maps an id it does not know to a generic line.
 */
export const PLAN_REASONS = Object.freeze({
  notMember: "notMember",
  moved: "moved",
  combat: "combat",
  left: "left",
  detached: "detached",
  down: "down",
});

/**
 * Why this member can lock nothing this turn, or null. Checked in this order:
 * not in the party, the party moved this turn, the party is held in a fight,
 * the member was left behind, is out on a detach, or is down.
 * @param {object} state
 * @param {object|null} state.member The formation's member record.
 * @param {boolean} [state.moved] The clock's `movedThisTurn`.
 * @param {boolean} [state.inCombat] The formation's combat is active.
 * @param {boolean} [state.down] The member's own hit points are spent.
 * @returns {string|null}
 */
export function memberBlock({ member, moved = false, inCombat = false, down = false } = {}) {
  if (!member) return PLAN_REASONS.notMember;
  if (moved) return PLAN_REASONS.moved;
  if (inCombat) return PLAN_REASONS.combat;
  if (member.left) return PLAN_REASONS.left;
  if (member.detached) return PLAN_REASONS.detached;
  if (down) return PLAN_REASONS.down;
  return null;
}

/**
 * Lock a member's choice: the party's own stops first, then lib's
 * `lockActivity` with its order (unknown activity, unknown option, the
 * activity's block, already used, not imported).
 * @param {object} plan
 * @param {object} request `lockActivity`'s request.
 * @param {object} state `memberBlock`'s state.
 * @returns {{ok: true, plan: object, entry: object}|{ok: false, reason: string, missing: string[]}}
 */
export function lockForMember(plan, request, state) {
  const block = memberBlock(state);
  if (block) return { ok: false, reason: block, missing: [] };
  return lockActivity(plan, request);
}

/**
 * What a move does to the plan: the party is no longer stationary, so every
 * entry not yet resolved is cancelled, a multi-turn entry's progress with it.
 * An entry stamped this turn is done and stays until the next advance drops it.
 * @param {object} plan
 * @returns {{plan: object, cancelled: {actorId: string, entry: object}[]}}
 */
export function cancelForMove(plan) {
  const next = {};
  const cancelled = [];
  for (const [actorId, entry] of Object.entries(plan ?? {})) {
    if (entry.resolvedTurn != null) next[actorId] = entry;
    else cancelled.push({ actorId, entry });
  }
  return { plan: next, cancelled };
}

/**
 * Queue a member onto a group check, so a check several members chose is
 * rolled once, on one card. Called from an activity's `resolve`; the turn's
 * `flush` rolls each queue.
 * @param {object} ctx The resolution's context, shared by every entry of the turn.
 * @param {string} group The check the members are queued for.
 * @param {string} actorId
 * @returns {{queued: string}}
 */
export function queueGroup(ctx, group, actorId) {
  ctx.groups ??= new Map();
  if (!ctx.groups.has(group)) ctx.groups.set(group, []);
  const ids = ctx.groups.get(group);
  if (!ids.includes(actorId)) ids.push(actorId);
  return { queued: group };
}

/**
 * Run one planned turn, in the one order that spends the clock once and never
 * rolls an entry twice:
 *   1. whether the turn is a party rest, read while the choices are entries;
 *   2. the clock spends one turn (`spendTurn`), the only spend of the turn;
 *   3. the plan counts down at the clock's turn, every due entry stamped, and
 *      the stamped plan is written before anything resolves;
 *   4. the due entries resolve, each through its own activity;
 *   5. each group check queued in step 4 is rolled once (`flush`).
 * A failure after step 3 leaves the reached entries stamped: the next turn
 * drops them, so a retry spends a new turn and re-rolls nothing.
 * @param {object} turn
 * @param {object} turn.plan The plan as stored.
 * @param {string[]} turn.memberIds The members who take part in the rest decision.
 * @param {(actorId: string) => boolean} [turn.endures] Who owes no rest.
 * @param {boolean} [turn.forcedRest] The Judge's own Rest: the turn rests whatever the plan says.
 * @param {(opts: {resting: boolean}) => Promise<*>} turn.spendTurn
 * @param {() => number} turn.turnOf The clock's turn after the spend.
 * @param {(plan: object) => Promise<*>} turn.writePlan
 * @param {(actorId: string) => object|null} turn.actorOf
 * @param {object} [turn.ctx] Passed to every activity; collects `groups`.
 * @param {(groups: Map<string, string[]>, results: object[]) => Promise<*>} [turn.flush]
 * @returns {Promise<{resting: boolean, turn: number, due: object[], progressed: object[], results: object[], flushed: *}>}
 */
export async function runPlanTurn({
  plan, memberIds, endures = () => false, forcedRest = false,
  spendTurn, turnOf, writePlan, actorOf, ctx = {}, flush = null,
} = {}) {
  const rest = partyRest(plan, memberIds, { endures });
  const resting = forcedRest || rest.rests;
  await spendTurn({ resting });
  const turn = await turnOf();
  const counted = advanceTurn(plan, turn);
  await writePlan(counted.plan);
  ctx.groups ??= new Map();
  const results = await resolveDue(counted.due, { actorOf, ctx });
  const flushed = flush ? await flush(ctx.groups, results) : null;
  return { resting, rest, turn, due: counted.due, progressed: counted.progressed, results, flushed };
}
