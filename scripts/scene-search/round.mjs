/**
 * The Round press for scene search: the one function a screen calls to resolve
 * what the party declared as a round long, `resolveSceneRound`. It is the
 * Dungeon tab's own Round press: one bookkeeping round on the party's clock,
 * then the turn plan's `resolvePlanRound`, which resolves every round-length
 * entry still due (the scene's hasty checks among them) and spends no time of
 * its own.
 */

/** The real dependencies, loaded when first asked for: the turn plan and the clock are heavy and nothing else needs them here. */
async function loadDeps() {
  const [plan, engine] = await Promise.all([import("../formation/turn-plan.mjs"), import("../formation/turn-engine.mjs")]);
  return {
    resolvePlanRound: plan.resolvePlanRound,
    spendRound: (formation) => engine.advanceRounds(formation, 1, { reason: "manual" }),
  };
}

/**
 * Spend one round on the party's clock, then resolve the round-length plan
 * entries due. The clock moves first, as the Dungeon tab's press moves it, so
 * the round the checks take is the round just spent.
 * @param {object} formation
 * @param {object} [deps] `{resolvePlanRound(formation), spendRound(formation)}`; the real ones by default
 * @returns {Promise<{results: object[]}>}
 */
export async function resolveSceneRound(formation, deps = null) {
  const { resolvePlanRound, spendRound } = deps ?? (await loadDeps());
  await spendRound(formation);
  const answer = await resolvePlanRound(formation);
  return { results: answer?.results ?? [] };
}
