/* global Hooks */
/**
 * Scene search: wires the feature. Its activities register at init on every
 * client (a player's own refusal reads them), the party-check seams are handed
 * to the resolution, and `acksExtras.sceneSearch` is the api a screen calls. The
 * Round press is `acksExtras.sceneSearch.resolveRound(formation)`; the screen the
 * session is read and assigned on is `acksExtras.sceneSearch.openScreen(partyId)`.
 * The two ways in, the fight-over card's Search the scene and the Dungeon tab's
 * Search here, are `acksExtras.sceneSearch.searchHere`.
 */
import { acksExtras } from "../namespace.mjs";
import { requestPartyAction } from "../formation/player-requests.mjs";
import { PARTY_CHECKS, resolveCheck, rollCheckFor } from "../formation/party-rolls.mjs";
import { citeOf } from "../abilities/ability-rolls.mjs";
import * as turnPlan from "../formation/turn-plan.mjs";
import { drawFallenTable, markCardOpened, recordOfMessage } from "../treasure/search.mjs";
import { configureSceneChecks, registerSceneActivities } from "./activities.mjs";
import {
  askScenePress,
  assignSceneCheck,
  configureSceneSearchApi,
  endSceneSearch,
  openSceneSearch,
  readSceneSearch,
  sceneAssignments,
  sceneOptions,
  showSceneSearch,
  unassignSceneCheck,
} from "./api.mjs";
import { resolveSceneRound } from "./round.mjs";
import { loadKeyingTemplates } from "./keying.mjs";
import { announceSceneShown, openSceneScreen, registerSceneScreen } from "./screen.mjs";
import { configureWaysIn, searchSceneHere } from "./ways-in-live.mjs";
import { postRollCard, sceneReasonText } from "./words.mjs";

Hooks.once("init", () => {
  configureSceneChecks({
    checks: { PARTY_CHECKS, resolveCheck, rollCheckFor, citeOf },
    postRoll: postRollCard,
    planBy: (formation, actorId) => turnPlan.readPlan(formation)?.[actorId]?.by ?? null,
  });
  registerSceneActivities();
  registerSceneScreen();
  loadKeyingTemplates();
  configureSceneSearchApi({ plan: turnPlan, request: requestPartyAction, announce: announceSceneShown, drawTable: drawFallenTable });
  configureWaysIn({ open: openSceneSearch, openScreen: openSceneScreen, stamp: markCardOpened, record: recordOfMessage });
  acksExtras.sceneSearch = {
    open: openSceneSearch,
    searchHere: searchSceneHere,
    end: endSceneSearch,
    show: showSceneSearch,
    openScreen: openSceneScreen,
    assign: assignSceneCheck,
    unassign: unassignSceneCheck,
    ask: askScenePress,
    read: readSceneSearch,
    assignments: sceneAssignments,
    options: sceneOptions,
    resolveRound: resolveSceneRound,
    reasonText: sceneReasonText,
  };
});
