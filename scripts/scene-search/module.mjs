/* global Hooks */
/**
 * Scene search: wires the feature. Its activities register at init on every
 * client (a player's own refusal reads them), the party-check seams are handed
 * to the resolution, and `acksExtras.sceneSearch` is the api a screen calls. The
 * Round press is `acksExtras.sceneSearch.resolveRound(formation)`.
 */
import { acksExtras } from "../namespace.mjs";
import { requestPartyAction } from "../formation/player-requests.mjs";
import { PARTY_CHECKS, resolveCheck, rollCheckFor } from "../formation/party-rolls.mjs";
import * as turnPlan from "../formation/turn-plan.mjs";
import { configureSceneChecks, registerSceneActivities } from "./activities.mjs";
import { createSceneSearchApi } from "./api.mjs";
import { resolveSceneRound } from "./round.mjs";
import { postRollCard, sceneReasonText } from "./words.mjs";

Hooks.once("init", () => {
  configureSceneChecks({ checks: { PARTY_CHECKS, resolveCheck, rollCheckFor }, postRoll: postRollCard });
  registerSceneActivities();
  acksExtras.sceneSearch = {
    ...createSceneSearchApi({ plan: turnPlan, request: requestPartyAction }),
    resolveRound: resolveSceneRound,
    reasonText: sceneReasonText,
  };
});
