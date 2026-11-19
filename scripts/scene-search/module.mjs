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
import {
  assignSceneCheck,
  configureSceneSearchApi,
  endSceneSearch,
  openSceneSearch,
  readSceneSearch,
  sceneAssignments,
  sceneOptions,
  unassignSceneCheck,
} from "./api.mjs";
import { resolveSceneRound } from "./round.mjs";
import { postRollCard, sceneReasonText } from "./words.mjs";

Hooks.once("init", () => {
  configureSceneChecks({ checks: { PARTY_CHECKS, resolveCheck, rollCheckFor }, postRoll: postRollCard });
  registerSceneActivities();
  configureSceneSearchApi({ plan: turnPlan, request: requestPartyAction });
  acksExtras.sceneSearch = {
    open: openSceneSearch,
    end: endSceneSearch,
    assign: assignSceneCheck,
    unassign: unassignSceneCheck,
    read: readSceneSearch,
    assignments: sceneAssignments,
    options: sceneOptions,
    resolveRound: resolveSceneRound,
    reasonText: sceneReasonText,
  };
});
