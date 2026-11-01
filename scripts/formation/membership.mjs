/* global game */
/**
 * Who stands in a party, as a player decides it: which of their own actors
 * they may bring in or take out, and the list the Order tab offers. The writes
 * are `addMember` and `removeMember`, on the GM client, reached through
 * `player-requests.mjs`.
 *
 * A refusal is read twice. The requesting client reads it to say why, because
 * the relay carries no answer back; the GM client reads it again, against the
 * sender the server attests, because only that reading is authority. The
 * Judge's own drop, HUD button and remove control pass through none of this.
 */
import { MODULE_ID, FLAG_FORMATION_ID, PARTY_TYPE } from "./constants.mjs";
import { getFormations, isPerson } from "./formation-model.mjs";
import { isGroupActor } from "../lib/group-logic.mjs";
import { isMarkerActor } from "../lib/place.mjs";

/** Can this actor stand in a party at all? A party cannot, and a marker's body marks a place. */
export const canMarch = (actor) => !!actor && actor.type !== PARTY_TYPE && !isMarkerActor(actor);

/** Can this token join a party? Not when it already is one of a party's own. */
export const canJoin = (tokenDoc) => canMarch(tokenDoc?.actor) && !tokenDoc.getFlag(MODULE_ID, FLAG_FORMATION_ID);

/** The party this actor stands in, or null. */
export const partyHolding = (actorId) =>
  Object.values(getFormations()).find((f) => f.members.some((m) => m?.actorId === actorId)) ?? null;

/**
 * Why this user may not bring this actor into this party, or null where they
 * may.
 * @param {object} formation
 * @param {Actor|null} actor
 * @param {User} user
 * @param {TokenDocument|null} [token]  the token they would step off the map from
 * @returns {{key: string, party?: string}|null} what `refusalText` words
 */
export function bringInRefusal(formation, actor, user, token = null) {
  if (!canMarch(actor) || (token && !canJoin(token))) return { key: "cannotMarch" };
  if (!actor.testUserPermission(user, "OWNER")) return { key: "notYours" };
  if (formation.combat?.active) return { key: "inCombat" };
  const holding = partyHolding(actor.id);
  if (holding) return { key: "inParty", party: holding.name };
  // A forged token on another map would be stepped off it into this party.
  if (token && token.parent?.id !== formation.sceneId) return { key: "elsewhere" };
  return null;
}

/**
 * Why this user may not take this actor out of this party, or null where they
 * may.
 * @param {object} formation
 * @param {string} actorId
 * @param {User} user
 * @returns {{key: string}|null}
 */
export function takeOutRefusal(formation, actorId, user) {
  if (!formation.members.some((m) => m?.actorId === actorId)) return { key: "notMember" };
  if (!game.actors.get(actorId)?.testUserPermission(user, "OWNER")) return { key: "notYours" };
  if (formation.combat?.active) return { key: "inCombat" };
  return null;
}

/** A refusal in words, for the player who pressed. */
export function refusalText({ key, party }, actor) {
  return game.i18n.format(`ACKS-FORMATION.membership.refused.${key}`, { name: actor?.name ?? "?", party: party ?? "" });
}

/**
 * The party a token of this user's on this scene would join: one where they
 * already have a member, else the first whose token stands here. Null where no
 * party stands here, and a player never starts one.
 */
export function partyOnScene(scene, user) {
  const here = Object.values(getFormations()).filter((f) => f.sceneId === scene?.id && f.tokenId && scene.tokens.get(f.tokenId));
  const theirs = here.find((f) => f.members.some((m) => game.actors.get(m?.actorId)?.testUserPermission(user, "OWNER")));
  return theirs ?? here[0] ?? null;
}

/**
 * The Order tab's list for a player: their own people and companies who stand
 * in no party, by name. A mount or a wagon is left off, since it carries
 * members without being one; a drop still takes it.
 * @returns {{id: string, name: string, img: string}[]}
 */
export function bringableActors(user) {
  const taken = new Set(Object.values(getFormations()).flatMap((f) => f.members.map((m) => m?.actorId)));
  return game.actors.contents
    .filter((a) => (isPerson(a) || isGroupActor(a)) && !taken.has(a.id) && a.testUserPermission(user, "OWNER"))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((a) => ({ id: a.id, name: a.name, img: a.img }));
}
