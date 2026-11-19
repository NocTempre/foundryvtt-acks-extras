/**
 * The Round press for scene search: the one function a screen calls to resolve
 * what the party declared as a round long, `resolveSceneRound`. Close-out's
 * `resolvePlanRound` owns that press once it exists; until `turn-plan.mjs`
 * exports it this resolves the scene's own round-length entries itself, through
 * the activities' own `resolve`, so the checks are the same either way.
 */
import { listTurnActivities, resolveDue } from "../lib/turn-activities.mjs";
import { LAYER_OF_ACTIVITY } from "./constants.mjs";
import { readSession } from "./session.mjs";

/** The plan entries still to resolve that are this feature's and a round long. */
export function dueRoundEntries(plan, activities = listTurnActivities()) {
  const roundKeys = new Set(activities.filter((def) => def.length === "round" && def.key in LAYER_OF_ACTIVITY).map((def) => def.key));
  return Object.entries(plan ?? {})
    .filter(([, entry]) => entry?.resolvedTurn == null && roundKeys.has(entry?.key))
    .map(([actorId, entry]) => ({ actorId, entry }));
}

/** The real dependencies, loaded when first asked for: the turn plan is heavy and nothing else needs it here. */
async function loadDeps() {
  const [plan, model] = await Promise.all([import("../formation/turn-plan.mjs"), import("../formation/formation-model.mjs")]);
  return { plan, actorOf: (formation, id) => model.memberActorById(formation, id), readSession };
}

/**
 * Resolve the checks the party declared as a round long. With
 * `plan.resolvePlanRound` present that is the answer (`via: "plan"`). Without
 * it, this session's round-length entries are taken out of the stored plan
 * first, so the next Turn does not count them down and roll them again, and then
 * resolved one at a time in the plan's order (`via: "scene"`). A party with no
 * session open resolves nothing here.
 *
 * @param {object} formation
 * @param {object} [deps] `{plan: {readPlan, unlockPlan, resolvePlanRound?}, actorOf(formation, actorId), readSession(formation)}`; the real ones by default
 * @returns {Promise<{via: "plan"|"scene", results: object[]}>}
 */
export async function resolveSceneRound(formation, deps = null) {
  const { plan, actorOf, readSession: sessionOf } = deps ?? (await loadDeps());
  if (typeof plan.resolvePlanRound === "function") {
    const answer = await plan.resolvePlanRound(formation);
    return { via: "plan", results: answer?.results ?? [] };
  }
  if (!sessionOf(formation)) return { via: "scene", results: [] };
  const due = dueRoundEntries(plan.readPlan(formation));
  for (const { actorId } of due) await plan.unlockPlan(formation, actorId);
  const results = await resolveDue(due, { actorOf: (id) => actorOf(formation, id), ctx: { formation } });
  return { via: "scene", results };
}
