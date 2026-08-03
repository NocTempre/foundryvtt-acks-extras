/* global game, foundry, ChatMessage, ui, fromUuid */
import { makeLoc } from "../lib/util.mjs";
import { getFormation, getFrontage, swapCells, toggleRole } from "./formation-model.mjs";
import { ROLE_LABELS } from "./constants.mjs";
import { anchorMap } from "./map-items.mjs";
import { toggleDetachMember } from "./deployment.mjs";
import { getSocket, registerHandler } from "../lib/sockets.mjs";
import { rollPartyCheck } from "./party-rolls.mjs";
import { addLight, addSpell, advanceTurns, toggleLight, toggleShield } from "./turn-engine.mjs";

/**
 * Player-declared party actions. All formation state lives in a world setting
 * only GMs can write, so member-owning players declare actions from the party
 * sheet and the primary GM's client validates and executes them:
 *
 * - light a torch/lantern/candle borne by a member they own;
 * - track a spell they cast (from an owned member's spellbook);
 * - declare a rest turn, or a listen/search/bash/track check;
 * - move their own character in the marching order (reorder);
 * - take up or set down a role for their own character (role);
 * - step their own character out of the party token to scout, or back in
 *   (detach);
 * - douse/relight or shutter a light their character carries (lightToggle /
 *   lightShield);
 * - consult — anchor — a map their character holds (anchorMap).
 *
 * Ownership is validated HERE, on the executing GM client, against the passed
 * user id — never trusted from the requesting client. Every executed request
 * is announced publicly so the table sees who declared what; check results
 * still go to the GM per the usual secrecy rules.
 */

const REQUEST_HANDLER = "partyRequest";

const loc = makeLoc("ACKS-FORMATION");

function userOwnsMember(formation, user, actorId = null) {
  const members = actorId ? formation.members.filter((m) => m.actorId === actorId) : formation.members;
  return members.some((m) => {
    const actor = game.actors.get(m.actorId);
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

/** Execute a validated request on the GM client. */
async function executeRequest(formation, user, type, payload) {
  switch (type) {
    case "light": {
      if (!userOwnsMember(formation, user, payload.bearerId)) return;
      await announceDeclaration(formation, user, loc("request.light", {
        light: game.i18n.localize(`ACKS-LIB.light.${payload.lightType}`),
        bearer: game.actors.get(payload.bearerId)?.name ?? "?",
      }));
      // The DECLARING user's authority, not this client's: every player request
      // executes on a GM client, so `game.user.isGM` would hand the override to
      // everyone. A GM declaring from the same panel still gets it.
      await addLight(formation, payload.lightType, payload.bearerId, { override: user.isGM });
      break;
    }
    case "spell": {
      if (!userOwnsMember(formation, user, payload.casterId)) return;
      if (!payload.name || !(payload.turns > 0)) return;
      await announceDeclaration(formation, user, loc("request.spell", {
        spell: foundry.utils.escapeHTML(payload.name),
        caster: game.actors.get(payload.casterId)?.name ?? "?",
        turns: payload.turns,
      }));
      await addSpell(formation, { name: payload.name, casterId: payload.casterId, turns: payload.turns });
      break;
    }
    case "rest": {
      if (!userOwnsMember(formation, user)) return;
      await announceDeclaration(formation, user, loc("request.rest"));
      await advanceTurns(formation, 1, { resting: true });
      break;
    }
    case "check": {
      if (!userOwnsMember(formation, user)) return;
      const label = game.i18n.localize(`ACKS-FORMATION.rolls.${payload.key}`);
      await announceDeclaration(formation, user, loc("request.check", { check: label }));
      await rollPartyCheck(formation, payload.key);
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
      const had = formation.members.find((m) => m.actorId === payload.actorId)?.roles?.includes(payload.role) ?? false;
      const after = await toggleRole(formation, payload.actorId, payload.role, { override: user.isGM }); // kit gate inside
      const holds = after.members.find((m) => m.actorId === payload.actorId)?.roles?.includes(payload.role) ?? false;
      // Announce what HAPPENED, not what was asked for: the kit gate can decline
      // a player's request, and the table should not be told they took the job.
      if (holds === had) return;
      await announceDeclaration(formation, user, loc(holds ? "request.roleOn" : "request.roleOff", {
        name: game.actors.get(payload.actorId)?.name ?? "?",
        role: game.i18n.localize(ROLE_LABELS[payload.role] ?? payload.role),
      }));
      break;
    }

    /* --- Step out of the party token to scout ahead, or step back in --- */
    case "detach": {
      if (!userOwnsMember(formation, user, payload.actorId)) return;
      const result = await toggleDetachMember(formation, payload.actorId);
      if (!result) return; // declined GM-side (mid-combat, or not theirs to recall)
      await announceDeclaration(formation, user, loc(`request.${result}`, {
        name: game.actors.get(payload.actorId)?.name ?? "?",
      }));
      break;
    }

    /* --- Light discipline on a light the player's character carries --- */
    case "lightToggle":
    case "lightShield": {
      const light = formation.lights.find((l) => l.id === payload.lightId);
      if (!light || !userOwnsMember(formation, user, light.bearerId)) return;
      const bearer = game.actors.get(light.bearerId)?.name ?? "?";
      if (type === "lightShield") {
        await announceDeclaration(formation, user, loc(light.shielded ? "request.unshield" : "request.shield", { bearer }));
        await toggleShield(formation, payload.lightId);
      } else {
        await announceDeclaration(formation, user, loc(light.lit ? "request.douse" : "request.relight", { bearer }));
        await toggleLight(formation, payload.lightId);
      }
      break;
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

/** socketlib handler: runs on the active GM with the declaring user's id. */
async function handlePartyRequest(formationId, type, payload, userId) {
  const formation = getFormation(formationId);
  const user = game.users.get(userId);
  if (!formation || !user) return;
  await executeRequest(formation, user, type, payload ?? {});
}

/**
 * Declare a party action. GMs execute directly; players relay to the active
 * GM via socketlib (executeAsGM routes to exactly one GM client).
 */
export async function requestPartyAction(formationId, type, payload = {}) {
  const formation = getFormation(formationId);
  if (!formation) return;
  if (game.user.isGM) {
    await executeRequest(formation, game.user, type, payload);
    return;
  }
  const socket = getSocket();
  if (!socket || !game.users.activeGM) {
    ui.notifications.warn(game.i18n.localize("ACKS-FORMATION.request.noGM"));
    return;
  }
  await socket.executeAsGM(REQUEST_HANDLER, formationId, type, payload, game.user.id);
  ui.notifications.info(game.i18n.localize("ACKS-FORMATION.request.sent"));
}

/** Register the GM-side request handler with socketlib. */
export function registerRequestSocket() {
  registerHandler(REQUEST_HANDLER, handlePartyRequest);
}
