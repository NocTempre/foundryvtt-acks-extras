/* global game, foundry, ChatMessage, ui, fromUuid, fromUuidSync */
import { makeLoc } from "../lib/util.mjs";
import { addMember, getFormation, getFrontage, getMemberActor, getPartyScene, removeMember, swapCells, toggleRole } from "./formation-model.mjs";
import { ROLE_LABELS, LIGHT_SOURCES } from "./constants.mjs";
import { anchorMap } from "./map-items.mjs";
import { toggleDetachMember, toggleMemberLeft } from "./deployment.mjs";
import { chooseConveyance, rideLabel } from "./conveyance.mjs";
import { bringInRefusal, refusalText, takeOutRefusal } from "./membership.mjs";
import { executeAsGM, registerHandler } from "../lib/sockets.mjs";
import { rollPartyCheck, PARTY_CHECKS } from "./party-rolls.mjs";
import { attemptDisarm, attemptRearm } from "./trap-zone.mjs";
import {
  JUMP_KIND, SQUEEZE_KIND, SWIM_KIND, crossingMembers, jumpFor, jumpPressRefusal, readCrossing, relayRefusalWords, rescueCheck, rescueRefusalWords, rowFor, setPace, setRescuer, squeezePress, throwFor,
} from "./crossing.mjs";
import { paceStep } from "./crossing-logic.mjs";
import { PACES } from "./climb-pace.mjs";
import { OBSTACLES } from "./obstacles.mjs";
import { addLight, addSpell, toggleLight, toggleShield } from "./turn-engine.mjs";
import { activityLabel, lockPlan, reasonText, resolvePlanTurn, unlockPlan } from "./turn-plan.mjs";
import { turnActivity } from "../lib/turn-activities.mjs";

/**
 * Player-declared party actions. All formation state lives in a world setting
 * only GMs can write, so member-owning players declare actions from the party
 * sheet and the primary GM's client validates and executes them. The request
 * types are the `case`s of `executeRequest`: lights, spells, a rest turn, party
 * checks, the turn plan, a Round or a turn asked of the Judge, a search declared,
 * the marching order, roles, detaching, leaving a member behind, conveyance,
 * bringing an actor in or out, light discipline, anchoring a map, trapbreaking
 * and a crossing's throw.
 *
 * Ownership is validated HERE, on the executing GM client, against the sender
 * Foundry's server attests (`lib/sockets.mjs` `runRelayed`); nothing the
 * requesting client writes names who asked. Every executed request is
 * announced publicly; check results still go to the GM.
 */

const REQUEST_HANDLER = "partyRequest";

const loc = makeLoc("ACKS-FORMATION");

function userOwnsMember(formation, user, actorId = null) {
  const members = actorId ? formation.members.filter((m) => m.actorId === actorId) : formation.members;
  return members.some((m) => {
    const actor = getMemberActor(m);
    return actor?.testUserPermission(user, "OWNER") ?? false;
  });
}

async function announceDeclaration(formation, user, text) {
  await ChatMessage.create({
    content: `<div class="acks-formation-card"><em>${loc("request.declared", {
      user: foundry.utils.escapeHTML(user.name),
      action: text,
    })}</em></div>`,
    speaker: { alias: formation.name },
  });
}

/**
 * Tell the requesting user, and nobody else, why their crossing throw was not
 * made. A reason with no words (an absence refusal) is not whispered.
 */
async function whisperCrossingRefusal(formation, user, reason, actor, words = relayRefusalWords) {
  const said = words(reason, actor);
  if (!said) return;
  await ChatMessage.create({
    content: foundry.utils.escapeHTML(said),
    whisper: [user.id],
    speaker: { alias: formation.name ?? "" },
  });
}

/** The presses a relayed crossing request may name: the jump itself, a hanging jumper's climb up, a swimmer's rescuer, a squeezer's ways out and a climber's pace. */
const CROSSING_STEPS = Object.freeze(["attempt", "climbUp", "rescue", "wiggle", "push", "pace"]);

/** The relayed steps that are a jump's; a squeezer's two escapes are thrown as the crossing's own throw. */
const JUMP_STEPS = Object.freeze(["attempt", "climbUp"]);

/**
 * A rescuer named, or cleared, on a drowning member, for a seat that owns the
 * rescuer (`actor`: the one named, or the one now named when the request
 * clears). The drowning member is a separate field the request carries; a
 * player may not replace a rescuer another seat owns. The declaration is made
 * once `setRescuer` has taken the change.
 */
async function rescueStep(formation, user, actor, payload, crossingId) {
  const refuse = async (reason) => {
    await whisperCrossingRefusal(formation, user, reason, actor, rescueRefusalWords);
    return { ok: false, refused: reason };
  };
  const drownedId = typeof payload.drownedId === "string" ? payload.drownedId : "";
  const named = readCrossing(formation)?.members?.[drownedId]?.rescuer ?? null;
  const clear = payload.clear === true;
  if (!user.isGM) {
    if (clear && named !== actor?.id) return refuse("notOwner");
    if (named && named !== actor?.id && !userOwnsMember(formation, user, named)) return refuse("notOwner");
  }
  const out = await setRescuer(formation, drownedId, clear ? "" : actor.id, { crossingId, player: !user.isGM });
  if (!out.ok) return refuse(out.refused);
  await announceDeclaration(formation, user, loc(clear ? "request.crossingRescueClear" : "request.crossingRescue", {
    name: foundry.utils.escapeHTML(actor.name),
    drowned: foundry.utils.escapeHTML(game.actors.get(drownedId)?.name ?? "?"),
  }));
  return { ok: true };
}

/**
 * A climber's pace set, or put back to the base pace, for a member the seat owns.
 * The pick is checked against the closed set of paces on the GM client by
 * `setPace`, which refuses a player for a member who cannot be moved on (down,
 * detached, left behind, stalled) and warns a Judge. The declaration is made once
 * `setPace` has taken the change.
 */
async function paceRelay(formation, user, actor, payload, crossingId) {
  const pick = typeof payload.pace === "string" ? payload.pace : "";
  const out = await setPace(formation, actor.id, pick, { player: !user.isGM, crossingId });
  if (!out.ok) {
    await whisperCrossingRefusal(formation, user, out.refused, actor);
    return { ok: false, refused: out.refused };
  }
  await announceDeclaration(formation, user, loc("request.crossingPace", {
    name: foundry.utils.escapeHTML(actor.name),
    pace: game.i18n.localize(`ACKS-FORMATION.crossing.pace.${PACES.includes(pick) ? pick : "normal"}`),
  }));
  return { ok: true };
}

/**
 * Execute a validated request on the GM client. A crossing request answers
 * `{ok, refused?}`, which the relay carries back to the requesting seat; every
 * other kind answers nothing.
 */
async function executeRequest(formation, user, type, payload) {
  switch (type) {
    case "light": {
      if (!userOwnsMember(formation, user, payload.bearerId)) return;
      // The light type becomes a localization KEY: only known sources may pass,
      // or a crafted payload string would surface raw in chat on lookup miss.
      if (!(payload.lightType in LIGHT_SOURCES)) return;
      await announceDeclaration(formation, user, loc("request.light", {
        light: game.i18n.localize(`ACKS-LIB.light.${payload.lightType}`),
        bearer: foundry.utils.escapeHTML(game.actors.get(payload.bearerId)?.name ?? "?"),
      }));
      // The DECLARING user's authority, not this client's: `game.user.isGM` is
      // true on every GM-executed player request.
      await addLight(formation, payload.lightType, payload.bearerId, { override: user.isGM });
      break;
    }
    case "spell": {
      if (!userOwnsMember(formation, user, payload.casterId)) return;
      if (!payload.name || !(payload.turns > 0)) return;
      await announceDeclaration(formation, user, loc("request.spell", {
        spell: foundry.utils.escapeHTML(payload.name),
        caster: foundry.utils.escapeHTML(game.actors.get(payload.casterId)?.name ?? "?"),
        turns: payload.turns,
      }));
      await addSpell(formation, { name: payload.name, casterId: payload.casterId, turns: payload.turns });
      break;
    }
    case "rest": {
      if (!userOwnsMember(formation, user)) return;
      await announceDeclaration(formation, user, loc("request.rest"));
      await resolvePlanTurn(formation, { resting: true });
      break;
    }

    /* --- The turn plan: a player chooses for their own character --- */
    case "plan": {
      if (!userOwnsMember(formation, user, payload.actorId)) return;
      const name = foundry.utils.escapeHTML(game.actors.get(payload.actorId)?.name ?? "?");
      if (payload.unlock) {
        if (await unlockPlan(formation, payload.actorId)) {
          await announceDeclaration(formation, user, loc("plan.request.unlock", { name }));
        }
        return;
      }
      // Only a registered activity passes: its key names a lang entry and a roll route.
      if (typeof payload.key !== "string" || !turnActivity(payload.key)) return;
      const option = typeof payload.option === "string" && payload.option ? payload.option : null;
      const result = await lockPlan(formation, { actorId: payload.actorId, key: payload.key, option, by: user.id });
      if (!result.ok) {
        // The party changed since the declaring seat checked; tell it, unless
        // the refusal has no words (a length nobody imported).
        const said = reasonText(result.reason, game.actors.get(payload.actorId));
        if (said) {
          await ChatMessage.create({
            content: foundry.utils.escapeHTML(said),
            whisper: [user.id],
            speaker: { alias: formation.name ?? "" },
          });
        }
        return;
      }
      await announceDeclaration(formation, user, loc("plan.request.lock", {
        name,
        activity: foundry.utils.escapeHTML(activityLabel(payload.key)),
      }));
      break;
    }
    case "check": {
      if (!userOwnsMember(formation, user)) return;
      // Closed set: the key names both a localization entry and a roll route.
      if (!(payload.key in PARTY_CHECKS)) return;
      // A solo check is not a party roll and has no party-roll route to take.
      if (PARTY_CHECKS[payload.key].solo) return;
      const label = game.i18n.localize(`ACKS-FORMATION.rolls.${payload.key}`);
      await announceDeclaration(formation, user, loc("request.check", { check: label }));
      await rollPartyCheck(formation, payload.key);
      break;
    }

    /* --- A player asks the Judge for a Round or a turn: declared, nothing more --- */
    case "askPress": {
      if (!userOwnsMember(formation, user)) return;
      // Closed set. The ask is announced and moves no clock and resolves no plan:
      // only the Judge's own press does either.
      const key = { round: "request.askRound", turn: "request.askTurn" }[payload.press];
      if (!key) return;
      await announceDeclaration(formation, user, loc(key));
      break;
    }

    /* --- A player declares the party searches here: announced, and the Judge opens the scene --- */
    case "declareSearch": {
      if (!userOwnsMember(formation, user)) return;
      // Nothing in the payload is read. The declaration opens no session, deals
      // nothing and moves no clock: only the Judge's own press does any of them.
      await announceDeclaration(formation, user, loc("request.searchHere"));
      break;
    }

    /* --- Marching order: a player moves THEIR OWN character --- */
    case "reorder": {
      if (!userOwnsMember(formation, user, payload.actorId)) return;
      // Recompute position from live state: the requesting client's view may
      // be stale, the actor id never is.
      const index = formation.members.findIndex((m) => m.actorId === payload.actorId);
      if (index < 0) return;
      const frontage = getFrontage(formation);
      let delta;
      switch (payload.dir) {
        case "up":
          delta = -frontage;
          break;
        case "down":
          delta = frontage;
          break;
        case "left":
          if (index % frontage === 0) return; // already on the left edge
          delta = -1;
          break;
        case "right":
          if (index % frontage === frontage - 1) return; // right edge
          delta = 1;
          break;
        default:
          return;
      }
      await swapCells(formation, index, delta); // bounds-checked inside
      break;
    }

    /* --- Roles: a player declares their own character's job --- */
    case "role": {
      if (!userOwnsMember(formation, user, payload.actorId)) return;
      // Closed set: a crafted role string never reaches the announcement.
      if (!(payload.role in ROLE_LABELS)) return;
      const had = formation.members.find((m) => m.actorId === payload.actorId)?.roles?.includes(payload.role) ?? false;
      const after = await toggleRole(formation, payload.actorId, payload.role, { override: user.isGM }); // kit gate inside
      const holds = after.members.find((m) => m.actorId === payload.actorId)?.roles?.includes(payload.role) ?? false;
      // Announce what HAPPENED: the kit gate can decline the request.
      if (holds === had) return;
      await announceDeclaration(formation, user, loc(holds ? "request.roleOn" : "request.roleOff", {
        name: foundry.utils.escapeHTML(game.actors.get(payload.actorId)?.name ?? "?"),
        role: game.i18n.localize(ROLE_LABELS[payload.role] ?? payload.role),
      }));
      break;
    }

    /* --- Step out of the party token to scout ahead, or step back in --- */
    case "detach": {
      if (!userOwnsMember(formation, user, payload.actorId)) return;
      const result = await toggleDetachMember(formation, payload.actorId);
      // Declined GM-side (mid-combat, not theirs to recall, no party token): the
      // declaring seat is told, since it believes the request is in flight.
      if (!result) {
        await ChatMessage.create({
          content: loc("request.detachDeclined"),
          whisper: [user.id],
          speaker: { alias: formation?.name ?? "" },
        });
        return;
      }
      await announceDeclaration(formation, user, loc(`request.${result}`, {
        name: foundry.utils.escapeHTML(game.actors.get(payload.actorId)?.name ?? "?"),
      }));
      break;
    }

    /* --- Leave a casualty where they fell, or go back for them --- */
    case "leftBehind": {
      if (!userOwnsMember(formation, user, payload.actorId)) return;
      if (!formation.members.some((m) => m?.actorId === payload.actorId)) return;
      // The sheet's own GM path records the decision mid-combat; a relayed
      // declaration is refused there, and the declaring seat is told so.
      if (formation.combat?.active) {
        await ChatMessage.create({
          content: loc("request.leftBehindDeclined"),
          whisper: [user.id],
          speaker: { alias: formation.name ?? "" },
        });
        return;
      }
      const leaving = await toggleMemberLeft(formation, payload.actorId);
      if (leaving === null) return;
      await announceDeclaration(formation, user, loc(leaving ? "request.leftBehind" : "request.wentBackFor", {
        name: foundry.utils.escapeHTML(game.actors.get(payload.actorId)?.name ?? "?"),
      }));
      break;
    }

    /* --- How the player's own character travels --- */
    case "conveyance": {
      if (!userOwnsMember(formation, user, payload.actorId)) return;
      if (typeof payload.pick !== "string") return;
      const landed = await chooseConveyance(formation.id, payload.actorId, payload.pick);
      if (!landed) return;
      await announceDeclaration(formation, user, loc("request.conveyance", {
        name: foundry.utils.escapeHTML(game.actors.get(payload.actorId)?.name ?? "?"),
        how: foundry.utils.escapeHTML(rideLabel(landed.pick)),
      }));
      break;
    }

    /* --- Who stands in the party: a player's own actors, in or out --- */
    case "bringIn": {
      const token = payload.tokenUuid ? fromUuidSync(payload.tokenUuid) : null;
      const actor = token?.actor ?? game.actors.get(payload.actorId);
      if (bringInRefusal(formation, actor, user, token)) return;
      await addMember(formation, actor, token, { scene: getPartyScene(formation) });
      await announceDeclaration(formation, user, loc("request.bringIn", { name: foundry.utils.escapeHTML(actor.name) }));
      break;
    }
    case "takeOut": {
      if (takeOutRefusal(formation, payload.actorId, user)) return;
      const name = game.actors.get(payload.actorId)?.name ?? "?";
      await removeMember(formation, payload.actorId);
      await announceDeclaration(formation, user, loc("request.takeOut", { name: foundry.utils.escapeHTML(name) }));
      break;
    }

    /* --- Light discipline on a light the player's character carries --- */
    case "lightToggle":
    case "lightShield": {
      const light = formation.lights.find((l) => l.id === payload.lightId);
      if (!light || !userOwnsMember(formation, user, light.bearerId)) return;
      const bearer = foundry.utils.escapeHTML(game.actors.get(light.bearerId)?.name ?? "?");
      if (type === "lightShield") {
        await announceDeclaration(formation, user, loc(light.shielded ? "request.unshield" : "request.shield", { bearer }));
        await toggleShield(formation, payload.lightId);
      } else {
        await announceDeclaration(formation, user, loc(light.lit ? "request.douse" : "request.relight", { bearer }));
        await toggleLight(formation, payload.lightId);
      }
      break;
    }

    /* --- Trapbreaking: one character, one found trap, one column --- */
    case "trapbreak":
    case "trapRearm": {
      if (!userOwnsMember(formation, user, payload.actorId)) return;
      const actor = game.actors.get(payload.actorId);
      if (!actor) return;
      // A declaring client names the character, the trap and the column, and
      // nothing else about the throw; `attemptDisarm` re-reads the trap and
      // refuses a uuid the party is not standing at.
      const mode = payload.mode === "hasty" ? "hasty" : "methodical";
      await announceDeclaration(formation, user, loc(type === "trapRearm" ? "request.trapRearm" : "request.trapbreak", {
        name: foundry.utils.escapeHTML(actor.name),
      }));
      if (type === "trapRearm") await attemptRearm(formation, actor, { targetUuid: payload.targetUuid });
      else await attemptDisarm(formation, actor, { mode, targetUuid: payload.targetUuid });
      break;
    }

    /* --- A crossing: one stretch thrown, or a rescuer named, for a member the player owns --- */
    case "crossing": {
      // A payload with no actor id must not fall through to "owns any member".
      const actorId = typeof payload.actorId === "string" ? payload.actorId : null;
      const actor = actorId ? game.actors.get(actorId) : null;
      // The answer names only the reason: it travels back to the requesting seat.
      const step = CROSSING_STEPS.includes(payload.step) ? payload.step : null;
      const refuse = async (reason) => {
        await whisperCrossingRefusal(formation, user, reason, actor, step === "rescue" ? rescueRefusalWords : relayRefusalWords);
        return { ok: false, refused: reason };
      };
      if (!actorId) return refuse("notOwner");
      // An actor the player owns that the party no longer holds is told so, not
      // called someone else's; an actor they do not own learns nothing more.
      if (!userOwnsMember(formation, user, actorId)) {
        return refuse(actor?.testUserPermission?.(user, "OWNER") ? "member" : "notOwner");
      }
      // The crossing id the requester saw, or "" for none, which matches no crossing.
      const crossingId = typeof payload.crossingId === "string" ? payload.crossingId : "";
      // A swimmer's rescuer is named or cleared; nothing is thrown.
      if (step === "rescue") return rescueStep(formation, user, actor, payload, crossingId);
      // A climber's pace is set or cleared; nothing is thrown.
      if (step === "pace") return paceRelay(formation, user, actor, payload, crossingId);
      // The declaration is made once every check has passed and the member's
      // throw is claimed, so a refused or busy request declares nothing. A press
      // over a gap names its step; anything else is a stretch thrown.
      const beforeRoll = () => announceDeclaration(formation, user, loc({ attempt: "request.crossingJump", climbUp: "request.crossingClimbUp", wiggle: "request.crossingWiggle", push: "request.crossingPush" }[step] ?? "request.crossing", {
        name: foundry.utils.escapeHTML(actor?.name ?? "?"),
      }));
      const out = JUMP_STEPS.includes(step)
        ? await jumpFor(formation, actorId, { step, player: !user.isGM, crossingId, beforeRoll })
        : await throwFor(formation, actorId, { player: !user.isGM, crossingId, beforeRoll, step });
      if (!out.ok) return refuse(out.refused);
      return { ok: true };
    }

    /* --- Consult (anchor) a map the player's character holds --- */
    case "anchorMap": {
      const item = await fromUuid(payload.itemUuid);
      const holderId = item?.parent?.id;
      if (!holderId || !userOwnsMember(formation, user, holderId)) return;
      await announceDeclaration(formation, user, loc("request.anchor", {
        map: foundry.utils.escapeHTML(item.name),
      }));
      await anchorMap(formation, payload.itemUuid);
      break;
    }
  }
}

/**
 * Relay handler, on the active GM: acts for the attested sender
 * (`requestUserId`, null when a GM sent it). Returns the executed request's
 * answer, so a result-bearing relay reaches the requesting seat.
 */
async function handlePartyRequest({ formationId, type, payload, requestUserId } = {}) {
  const formation = getFormation(formationId);
  const user = requestUserId ? game.users.get(requestUserId) : game.user;
  if (!formation || !user) return;
  return executeRequest(formation, user, type, payload ?? {});
}

/**
 * Declare a party action. GMs execute directly; players relay to the active
 * GM (executeAsGM routes to exactly one GM client). A player's seat is told
 * "sent" only when the GM client did not answer with a refusal: a request kind
 * that answers `{ok: false}` (a crossing's throw) is not announced as declared.
 * @returns {Promise<{ok: boolean, refused?: string}|undefined>} the executing
 *   client's answer, where the request kind gives one
 */
export async function requestPartyAction(formationId, type, payload = {}) {
  const formation = getFormation(formationId);
  if (!formation) return;
  if (game.user.isGM) return executeRequest(formation, game.user, type, payload);
  if (!game.users.activeGM) {
    ui.notifications.warn(game.i18n.localize("ACKS-FORMATION.request.noGM"));
    return;
  }
  const answer = await executeAsGM(REQUEST_HANDLER, { formationId, type, payload });
  if (answer?.ok !== false) ui.notifications.info(game.i18n.localize("ACKS-FORMATION.request.sent"));
  return answer;
}

/** A player's own actor into the party, refused here with the reason where the GM client would refuse it silently. */
export async function requestBringIn(formation, actor, token = null) {
  const refused = bringInRefusal(formation, actor, game.user, token);
  if (refused) return void ui.notifications.warn(refusalText(refused, actor));
  await requestPartyAction(formation.id, "bringIn", { actorId: actor.id, tokenUuid: token?.uuid ?? null });
}

/** A player's own actor out of the party, refused the same way. */
export async function requestTakeOut(formation, actorId) {
  const refused = takeOutRefusal(formation, actorId, game.user);
  if (refused) return void ui.notifications.warn(refusalText(refused, game.actors.get(actorId)));
  await requestPartyAction(formation.id, "takeOut", { actorId });
}

/**
 * A seat's press on a member's crossing throw. The row is read for this seat
 * first and a refusal is said here, so a press that cannot succeed is never
 * sent; the GM client reads the row again and is the one that rolls, writes
 * and posts. The request names the formation, the crossing the seat saw, the
 * member and, over a gap, the step pressed (`attempt` or `climbUp`) or, for a stuck
 * squeezer, the way out (`wiggle` or `push`), and nothing else.
 * @returns {Promise<{ok: boolean, refused?: string}>} whether the request was
 *   sent and the GM client took it, or why not
 */
export async function requestCrossingThrow(formation, actorId, step = null) {
  const crossing = readCrossing(formation);
  const entry = crossingMembers(formation).find((e) => e.member.actorId === actorId);
  let refused = null;
  if (!crossing) refused = "closed";
  else if (!entry) refused = "member";
  else if (crossing.kind === JUMP_KIND) refused = step ? jumpPressRefusal(formation, crossing, entry, step) : JUMP_KIND;
  else if (crossing.kind === SQUEEZE_KIND) refused = squeezePress({ ...entry, ...rowFor(formation, crossing, entry) }, step).refused;
  else if (step) refused = "stale";
  else {
    const { row } = rowFor(formation, crossing, entry);
    if (!row.can) refused = row.refusal?.reason ?? "member";
  }
  if (refused) {
    const said = relayRefusalWords(refused, entry?.actor ?? game.actors.get(actorId));
    if (said) ui.notifications.warn(said);
    return { ok: false, refused };
  }
  const answer = await requestPartyAction(formation.id, "crossing", { crossingId: crossing.id, actorId, ...(step ? { step } : {}) });
  return answer?.ok === false ? { ok: false, refused: answer.refused } : { ok: true };
}

/**
 * A seat's choice of rescuer for a drowning member: the seat names a member it
 * owns as the rescuer, or clears the rescuer it owns. The choice is checked for
 * this seat first and a refusal said here; the GM client checks it again and is
 * the one that writes. `rescuerId` "" clears.
 * @returns {Promise<{ok: boolean, refused?: string}>}
 */
export async function requestCrossingRescue(formation, drownedId, rescuerId) {
  const crossing = readCrossing(formation);
  const named = crossing?.members?.[drownedId]?.rescuer ?? null;
  const actorId = rescuerId || named;
  let refused = null;
  if (!crossing) refused = "closed";
  else if (crossing.kind !== SWIM_KIND) refused = "notSwim";
  else if (!actorId) return { ok: true };
  else refused = rescueCheck(formation, crossing, drownedId, rescuerId);
  if (refused) {
    const said = rescueRefusalWords(refused, game.actors.get(actorId));
    if (said) ui.notifications.warn(said);
    return { ok: false, refused };
  }
  const answer = await requestPartyAction(formation.id, "crossing", {
    crossingId: crossing.id, actorId, drownedId, step: "rescue", ...(rescuerId ? {} : { clear: true }),
  });
  return answer?.ok === false ? { ok: false, refused: answer.refused } : { ok: true };
}

/**
 * A seat's pick of a pace for a member it owns: the base pace for "". The pick is
 * checked for this seat first and a refusal said here; the GM client checks it
 * again and is the one that writes.
 * @returns {Promise<{ok: boolean, refused?: string}>}
 */
export async function requestCrossingPace(formation, actorId, pick) {
  const crossing = readCrossing(formation);
  const entry = crossingMembers(formation).find((e) => e.member.actorId === actorId);
  let refused = null;
  if (!crossing) refused = "closed";
  else if (!Object.hasOwn(OBSTACLES, crossing.kind)) refused = "notClimb";
  else if (!entry) refused = "member";
  else refused = paceStep(rowFor(formation, crossing, entry).row.pace, pick).refusal?.reason ?? null;
  if (refused) {
    const said = relayRefusalWords(refused, entry?.actor ?? game.actors.get(actorId));
    if (said) ui.notifications.warn(said);
    return { ok: false, refused };
  }
  const answer = await requestPartyAction(formation.id, "crossing", { crossingId: crossing.id, actorId, step: "pace", pace: pick });
  return answer?.ok === false ? { ok: false, refused: answer.refused } : { ok: true };
}

/** Register the GM-side request handler with socketlib. */
export function registerRequestSocket() {
  registerHandler(REQUEST_HANDLER, handlePartyRequest);
}
