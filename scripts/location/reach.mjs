/* global game */
/**
 * Whether a character can leave something at a place.
 *
 * Storage answered one question — do you own this place — and offered every
 * place that said yes, so a character standing in a dungeon was invited to put
 * a chest into a warehouse three hundred miles away. Retrieval is deliberately
 * NOT gated the same way: taking your own goods back is a bookkeeping act, and
 * a player who cannot reach their belongings at all is a worse failure than one
 * who can withdraw from a distance.
 *
 * THE RULE HAS TWO HALVES, because places do.
 *
 * A place with a LINKED SCENE is somewhere on the map, so being there is what
 * reaches it: the character has to be standing on that scene. Not the *active*
 * scene — a party split across two maps can still bank at the inn one half of
 * it is sitting in.
 *
 * A place with NO linked scene has no map to be absent from by default:
 * ownership answers, and a place pinned to the character's own sheet answers
 * too. But a place can still stand ON a map without BEING one — a market cart
 * or a shrine token dropped into a town scene that is a place of its own — and
 * there presence answers instead: standing within reach of the place's own
 * token, on whatever scene it sits in (see `here.mjs`).
 *
 * WHERE A CHARACTER IS STANDING is one question for both halves, and
 * `standingSpots` is the one reader that answers it. A character in a FORMATION
 * has no token of their own on the ground — `addMember` (formation-model.mjs)
 * deletes it the instant they join — so the thing standing on the map is the
 * formation's party token, and it answers for every member. A character no
 * formation claims stands wherever their own tokens do, on every scene at once.
 *
 * A COMPANION reaches what their fellows reach, and the FORMATION says who
 * those are. Foundry's party actor is deprecated in this family: where a
 * formation holds this character, it is the whole answer and the party actor
 * is not consulted, so one roster cannot quietly widen another's reach. The
 * party actor still answers for a character no formation holds, which is what
 * a world that has not built its formations yet needs.
 *
 * The `acks-extras.group` actor is neither of them: it is a troop stack, not a
 * company of player characters.
 */
import { MODULE_ID } from "./constants.mjs";
import { sceneOfLocation } from "./scene-link.mjs";
import { libStorage as storage } from "../lib/util.mjs";
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
 * A storage surface asks `depositReach` about every place in the world on each
 * render, and both questions underneath it — where does this character stand,
 * and is this place on a map anywhere — are answered from the same token walk.
 * Scanning once per render instead of once per place is the difference between
 * one sweep of `game.scenes` and one per provider.
 *
 * `mine` is this character's own ground tokens by scene id. `placedOn` maps an
 * actor id to the scenes it has a VISIBLE token on, which is what separates
 * "you are not there" from "this is not yours".
 *
 * @returns {{mine: Map<string, object[]>, placedOn: Map<string, object[]>}}
 */
export function reachScan(actor) {
  const mine = new Map();
  const placedOn = new Map();
  for (const scene of game.scenes ?? []) {
    const ours = [];
    for (const token of scene.tokens ?? []) {
      if (actor && (token.actorId === actor.id || token.actor?.uuid === actor.uuid)) ours.push(token);
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
 * The formation answers alone when it answers at all — see this file's header
 * for why the member's own token is not consulted. Both halves of the rule go
 * through here, so the linked-scene case and the ground-token case can never
 * disagree about whose token is on the map.
 *
 * @returns {Array<{scene: object, point: {x: number, y: number}, elevation: number}>}
 */
function standingSpots(actor, scan) {
  const formation = getFormationForActor(actor.id);
  if (formation) {
    const at = partyPoint(formation);
    return at ? [at] : [];
  }
  const out = [];
  const mine = scan?.mine ?? reachScan(actor).mine;
  for (const [sceneId, tokens] of mine) {
    const scene = game.scenes?.get(sceneId);
    if (!scene) continue;
    const gridSize = scene.grid.size;
    for (const token of tokens) {
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
 * Everyone this character travels with, by actor id.
 *
 * The marching order answers first and, when it answers at all, alone: a
 * character in a formation travels with that formation and with nobody else.
 * Falling through to the party actor as well would union two rosters, so a
 * character left in a stale party actor would keep reaching a company they
 * are no longer marching with.
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
  // defensively, because the shape is core's and this module does not own it.
  // Consulted ONLY for a character no formation claims — a world mid-migration,
  // or one that never built a formation at all.
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

/** Does anyone this character travels with own this place? */
function companionOwns(actor, place) {
  const ids = companionIds(actor);
  if (!ids.size) return false;
  for (const id of ids) {
    const mate = game.actors?.get(id);
    if (!mate) continue;
    // Ownership is per USER, so "their owner can reach it" is asked of the
    // users who own the companion, not of the companion document itself.
    for (const [userId, level] of Object.entries(mate.ownership ?? {})) {
      if (userId === "default" || level < 3) continue;
      if ((place.ownership?.[userId] ?? place.ownership?.default ?? 0) >= 3) return true;
    }
  }
  return false;
}

/**
 * Can this character leave something at this place, and if not, why not?
 *
 * The REASON is returned rather than a bare false, because the Storage tab
 * shows it: a control that has quietly vanished reads as a broken module, and
 * "you are not there" is a rule the player can act on. `notHere` names a scene
 * and is only ever given about a place that IS on a map — a place standing on
 * no map at all is one this character has no claim on, and sending them out to
 * look for it is a worse answer than saying so.
 *
 * @param {object} [opts]
 * @param {{mine: Map, placedOn: Map}} [opts.scan] one world token pass
 *   (`reachScan`) shared by a caller testing many places for the same actor.
 *   Built fresh when omitted.
 * @returns {{can: boolean, reason: string|null, scene: object|null}}
 */
export function depositReach(actor, place, { scan } = {}) {
  if (!actor || !place) return { can: false, reason: "gone", scene: null };

  // A character's own vault is theirs wherever they are — it is the thing the
  // bank column became, and gating it on standing somewhere would strand every
  // balance the sweep moved.
  const api = storage();
  if (api?.vaultOwnerUuid?.(place) === actor.uuid) return { can: true, reason: null, scene: null };

  const linked = sceneOfLocation(place);
  if (linked) {
    const there = standingSpots(actor, scan).some((spot) => spot.scene.id === linked.id);
    return there ? { can: true, reason: null, scene: linked } : { can: false, reason: "notHere", scene: linked };
  }

  if (place.isOwner) return { can: true, reason: null, scene: null };
  if (pinnedPlaces(actor).has(place.uuid)) return { can: true, reason: null, scene: null };
  if (companionOwns(actor, place)) return { can: true, reason: null, scene: null };

  // Ground presence: a place's own token, on whatever map it was dropped into.
  // Checked across every scene the character stands on — a location's marker is
  // not required to live on only one map, and neither is a party.
  for (const spot of standingSpots(actor, scan)) {
    if (placeReachesSpot(place, spot)) return { can: true, reason: null, scene: spot.scene };
  }

  // Out of reach. Naming a map the place is actually on turns the refusal into
  // somewhere to walk; with a marker on several maps the first one is named,
  // because a blank scene in that message is worse than an incomplete one.
  const [somewhere] = groundScenesOf(place, scan);
  return somewhere
    ? { can: false, reason: "notHere", scene: somewhere }
    : { can: false, reason: "notYours", scene: null };
}

/**
 * Every place in the world this character could deposit at right now.
 *
 * Builds the world's token index once and hands it to every `depositReach`
 * call rather than each one rescanning `game.scenes` — see `reachScan`.
 */
export const reachablePlaces = (actor) => {
  const scan = reachScan(actor);
  return (storage()?.providers?.() ?? []).filter((place) => depositReach(actor, place, { scan }).can);
};
