/* global game */
/**
 * Whether a character can leave something at a place.
 *
 * Retrieval is not gated by reach.
 * See docs/location/DECISIONS.md, "Leaving something at a place needs reach; taking it back does not (2026-08-06)".
 *
 * The rule has two halves. A place with a LINKED SCENE is reached by standing
 * on that scene (not only the active one). A place with NO linked scene is
 * reached by ownership, by a pin on the character's sheet, by a companion's
 * ownership, or by standing within reach of the place's own token (`here.mjs`).
 *
 * `standingSpots` is the one reader of where a character stands, for both
 * halves: the formation's party token answers alone for the members riding
 * inside it; a member deployed as an individual stands at the token the deploy
 * made; a formation with no party token, and a character no formation claims,
 * stand at their own tokens. A cell deployed as a STACK answers through the
 * party token. A COMPANION reaches what the formation's members reach, and the
 * party actor answers only for a character no formation holds. A character
 * ABOARD a place (`lib/attachment.mjs` carrier chain) is there.
 * A place with a market is also reached from any of its GATES (`gate.mjs`, a
 * place with the gate role standing inside it), by the same presence test the
 * gate itself would pass: the gate is the point of entry to the market (RR 372).
 * See docs/location/DECISIONS.md, "Reach asks about the character, and about one body at a time".
 */
import { MODULE_ID } from "./constants.mjs";
import { gatesByMarket } from "./gate.mjs";
import { sceneOfLocation } from "./scene-link.mjs";
import { libStorage as storage } from "../lib/util.mjs";
import { carrierChain } from "../lib/attachment.mjs";
import { getFormations, getFormationForActor } from "../formation/formation-model.mjs";
import { partyPoint } from "../formation/zones.mjs";
import { tokenCenter, placeReachesSpot, placeStandsOn } from "./here.mjs";

/** Flag on a CHARACTER: places they have pinned to their own sheet. */
export const PINNED_PLACES_FLAG = "places";

/** The place uuids a character has pinned, as a set. */
export const pinnedPlaces = (actor) => new Set(actor?.getFlag?.(MODULE_ID, PINNED_PLACES_FLAG) ?? []);

/** Pin (or unpin) a place on a character's sheet. Returns the new state. */
export async function setPinnedPlace(actor, placeUuid, pinned = true) {
  if (!actor?.isOwner || !placeUuid) return false;
  const current = pinnedPlaces(actor);
  if (pinned === current.has(placeUuid)) return pinned;
  if (pinned) current.add(placeUuid);
  else current.delete(placeUuid);
  await actor.setFlag(MODULE_ID, PINNED_PLACES_FLAG, [...current]);
  return pinned;
}

/**
 * One pass over the world's tokens, reused by every reach test in a sweep.
 *
 * `mine` is this character's own ground tokens by scene id. `placedOn` maps an
 * actor id to the scenes it has a VISIBLE token on, which is what separates
 * "you are not there" from "this is not yours".
 *
 * `placedOn` is keyed on `token.actorId` (a place IS its world actor); a token
 * actor is matched by its own token, and only a base actor answers for the
 * tokens that name it.
 *
 * `gates` maps a market's uuid to the gate actors that open onto it
 * (`gatesByMarket`), read once here so a sweep never rebuilds it per place.
 *
 * @returns {{mine: Map<string, object[]>, placedOn: Map<string, object[]>, gates: Map<string, object[]>}}
 */
export function reachScan(actor) {
  return { ...tokenPass(actor), gates: gatesByMarket() };
}

/** The token half of `reachScan`, for a reader that has no use for the gates. */
function tokenPass(actor) {
  const mine = new Map();
  const placedOn = new Map();
  // A token actor with no token to name matches nothing, never its base actor's id.
  const ownTokenUuid = actor?.isToken ? (actor.token?.uuid ?? null) : null;
  const isOurs = actor?.isToken
    ? (token) => !!ownTokenUuid && token.uuid === ownTokenUuid
    : (token) => !!actor && token.actorId === actor.id;
  for (const scene of game.scenes ?? []) {
    const ours = [];
    for (const token of scene.tokens ?? []) {
      if (isOurs(token)) ours.push(token);
      if (token.hidden || !token.actorId) continue;
      let scenes = placedOn.get(token.actorId);
      if (!scenes) placedOn.set(token.actorId, (scenes = []));
      if (scenes.at(-1) !== scene) scenes.push(scene);
    }
    if (ours.length) mine.set(scene.id, ours);
  }
  return { mine, placedOn };
}

/**
 * Everywhere this character is physically standing, as spots `here.mjs` can
 * test a place's token against.
 *
 * The party token answers alone for a member riding inside it. The ground is
 * read instead for a formation with no party token placed anywhere, and for a
 * member `deployMembers` sent out AS AN INDIVIDUAL, who stands at the token the
 * deploy made and at no other token bearing their name. Both halves of the rule
 * go through here.
 *
 * @returns {Array<{scene: object, point: {x: number, y: number}, elevation: number}>}
 */
function standingSpots(actor, scan) {
  // A synthetic token actor is a body, not what the roster (keyed on the base id) holds.
  const formation = actor?.isToken ? null : getFormationForActor(actor?.id);
  const member = formation?.members?.find((m) => m?.actorId === actor.id) ?? null;
  // The one token this member went out under; null for a stack cell, so the
  // party token answers.
  const ownBody = member?.deployedTokenId ?? null;
  // Its scene too, where the record names one: the id alone also names a token
  // on a scene duplicated from that one.
  const ownScene = ownBody ? (member.deployedSceneId ?? null) : null;
  if (formation && !ownBody) {
    const at = partyPoint(formation);
    if (at) return [at];
  }
  const out = [];
  const mine = scan?.mine ?? tokenPass(actor).mine;
  for (const [sceneId, tokens] of mine) {
    const scene = game.scenes?.get(sceneId);
    if (!scene) continue;
    const gridSize = scene.grid.size;
    for (const token of tokens) {
      // Once a deploy has given this member a body, any other token naming
      // the actor is a leftover and stands for nobody.
      if (ownBody && (token.id !== ownBody || (ownScene && sceneId !== ownScene))) continue;
      out.push({ scene, point: tokenCenter(token, gridSize), elevation: token.elevation ?? 0 });
    }
  }
  return out;
}

/** The scenes this place has a visible token on. */
function groundScenesOf(place, scan) {
  if (scan) return scan.placedOn.get(place.id) ?? [];
  const out = [];
  for (const scene of game.scenes ?? []) if (placeStandsOn(scene, place)) out.push(scene);
  return out;
}

/**
 * Everyone this character travels with, by actor id. The marching order
 * answers first and, when it answers at all, alone; the party actor answers
 * only for a character no formation claims.
 * See docs/location/DECISIONS.md, "The formation is the party; core's is deprecated (2026-08-15)."
 */
export function companionIds(actor) {
  const out = new Set();
  if (!actor?.id) return out;

  let inFormation = false;
  try {
    for (const formation of Object.values(getFormations() ?? {})) {
      const members = formation?.members ?? [];
      if (!members.some((m) => m?.actorId === actor.id)) continue;
      inFormation = true;
      for (const m of members) if (m?.actorId) out.add(m.actorId);
    }
  } catch {
    /* no formations readable — the party actor below still answers */
  }

  // Foundry's party actor (v13+): a `group` actor listing its members. Read
  // defensively, because the shape is core's. Consulted only for a character
  // no formation claims.
  if (!inFormation) {
    for (const candidate of game.actors ?? []) {
      if (candidate.type !== "group") continue;
      const ids = Object.keys(candidate.system?.members ?? {});
      if (!ids.includes(actor.id)) continue;
      for (const id of ids) out.add(id);
    }
  }

  out.delete(actor.id);
  return out;
}

/**
 * Does a user who owns `subject` own `place` as well?
 *
 * Asked of the users the ownership maps name, never `place.isOwner`, so the
 * answer is the same on every seat. The PLACE's `default` level counts; the
 * SUBJECT's does not. A Judge named as an owner is not counted, and an id that
 * names no user counts for nobody.
 * See docs/location/DECISIONS.md, "A Judge named as an owner is not one".
 */
export function ownersShare(subject, place) {
  for (const [userId, level] of Object.entries(subject?.ownership ?? {})) {
    if (userId === "default" || level < 3) continue;
    if (game.users?.get(userId)?.isGM !== false) continue;
    if ((place?.ownership?.[userId] ?? place?.ownership?.default ?? 0) >= 3) return true;
  }
  return false;
}

/** Does anyone this character travels with own this place? */
function companionOwns(actor, place) {
  for (const id of companionIds(actor)) {
    const mate = game.actors?.get(id);
    if (mate && ownersShare(mate, place)) return true;
  }
  return false;
}

/**
 * Is this character carried by this place, directly or through a chain of
 * carriers? Matched by the place's base actor id, the id every one of its
 * markers carries.
 */
export function aboard(actor, place) {
  if (!actor || !place?.id) return false;
  return carrierChain(actor).some((carrier) => carrier?.id === place.id);
}

/**
 * Is the character at this one place itself: aboard it, standing on its linked
 * scene, or within reach of its own token? A place's gates are not asked here.
 */
function presentAt(actor, place, scan) {
  if (!actor || !place) return false;
  if (aboard(actor, place)) return true;
  const spots = standingSpots(actor, scan);
  const linked = sceneOfLocation(place);
  if (linked) return spots.some((spot) => spot.scene.id === linked.id);
  return spots.some((spot) => placeReachesSpot(place, spot));
}

/** Is the character at any gate that opens onto this place's market? False for a place with no market. */
function atAGate(actor, place, scan) {
  if (!place?.system?.hasMarket) return false;
  const gates = (scan?.gates ?? gatesByMarket()).get(place.uuid) ?? [];
  return gates.some((gate) => presentAt(actor, gate, scan));
}

/**
 * Is this place where the character is standing?
 *
 * The presence half of `depositReach` alone, without the claim half: the
 * character is at the place (aboard it, on its linked scene, or within reach of
 * its own token), or, where the place has a market, at one of its gates.
 *
 * @param {object} [opts]
 * @param {{mine: Map, placedOn: Map, gates: Map}} [opts.scan] one world token
 *   pass (`reachScan`) shared across a sweep.
 */
export function standingAt(actor, place, { scan } = {}) {
  if (!actor || !place) return false;
  return presentAt(actor, place, scan) || atAGate(actor, place, scan);
}

/**
 * Does a place holding nothing of this character's still belong on their list
 * of places? Three grounds, each about this character alone: their own vault,
 * a place they PINNED, and a place they are standing at right now. Places
 * where they keep goods are listed regardless.
 * See docs/location/DECISIONS.md, "A sheet LISTS a place it is standing at; reach decides only whether it accepts a deposit (2026-09-20)".
 *
 * @param {object} [opts]
 * @param {{mine: Map, placedOn: Map}} [opts.scan] one world token pass.
 * @param {Set<string>} [opts.pinned] this character's pins, read once per sweep.
 */
export function listsWhenEmpty(actor, place, { scan, pinned } = {}) {
  if (!actor || !place) return false;
  if (storage()?.vaultOwnerUuid?.(place) === actor.uuid) return true;
  if ((pinned ?? pinnedPlaces(actor)).has(place.uuid)) return true;
  return standingAt(actor, place, { scan });
}

/**
 * Can this character leave something at this place, and if not, why not?
 *
 * The reason is returned because the Storage tab shows it. `notHere` names a
 * scene and is only given about a place that IS on a map; otherwise `notYours`.
 *
 * @param {object} [opts]
 * @param {{mine: Map, placedOn: Map}} [opts.scan] one world token pass
 *   (`reachScan`) shared by a caller testing many places for the same actor.
 *   Built fresh when omitted.
 * @returns {{can: boolean, reason: string|null, scene: object|null}}
 */
export function depositReach(actor, place, { scan } = {}) {
  if (!actor || !place) return { can: false, reason: "gone", scene: null };

  // A character's own vault is theirs wherever they are.
  const api = storage();
  if (api?.vaultOwnerUuid?.(place) === actor.uuid) return { can: true, reason: null, scene: null };

  // Riding in it is being there, whatever map it is or is not on.
  if (aboard(actor, place)) return { can: true, reason: null, scene: null };

  // A gate is the point of entry to the market it stands inside, linked scene or not.
  if (atAGate(actor, place, scan)) return { can: true, reason: null, scene: null };

  const linked = sceneOfLocation(place);
  if (linked) {
    const there = standingSpots(actor, scan).some((spot) => spot.scene.id === linked.id);
    return there ? { can: true, reason: null, scene: linked } : { can: false, reason: "notHere", scene: linked };
  }

  // Every clause here is about the CHARACTER, ownership included, not the client reading it.
  if (ownersShare(actor, place)) return { can: true, reason: null, scene: null };
  if (pinnedPlaces(actor).has(place.uuid)) return { can: true, reason: null, scene: null };
  if (companionOwns(actor, place)) return { can: true, reason: null, scene: null };

  // Ground presence: a place's own token, on any scene the character stands on.
  for (const spot of standingSpots(actor, scan)) {
    if (placeReachesSpot(place, spot)) return { can: true, reason: null, scene: spot.scene };
  }

  // Out of reach: name a map the place is on; with markers on several, the first.
  const [somewhere] = groundScenesOf(place, scan);
  return somewhere
    ? { can: false, reason: "notHere", scene: somewhere }
    : { can: false, reason: "notYours", scene: null };
}

/**
 * Every place in the world this character could deposit at right now.
 *
 * Builds the world's token index once (`reachScan`) and hands it to every
 * `depositReach` call.
 */
export const reachablePlaces = (actor) => {
  const scan = reachScan(actor);
  return (storage()?.providers?.() ?? []).filter((place) => depositReach(actor, place, { scan }).can);
};
