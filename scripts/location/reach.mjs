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
 * reaches it: a token of this character has to stand on that scene. Not the
 * *active* scene — a party split across two maps can still bank at the inn one
 * half of it is sitting in.
 *
 * A place with NO linked scene has no map to be absent from. A personal vault,
 * a chest, a wagon: these are reached by holding them rather than by standing
 * anywhere, so ownership answers, and a place pinned to the character's own
 * sheet answers too.
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
import { getFormations } from "../formation/formation-model.mjs";

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

/** Does a token of this character stand on this scene? */
function standsOn(scene, actor) {
  if (!scene || !actor) return false;
  return (scene.tokens ?? []).some((token) => token.actorId === actor.id || token.actor?.uuid === actor.uuid);
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
 * "you are not there" is a rule the player can act on.
 *
 * @returns {{can: boolean, reason: string|null, scene: object|null}}
 */
export function depositReach(actor, place) {
  if (!actor || !place) return { can: false, reason: "gone", scene: null };

  // A character's own vault is theirs wherever they are — it is the thing the
  // bank column became, and gating it on standing somewhere would strand every
  // balance the sweep moved.
  const api = storage();
  if (api?.vaultOwnerUuid?.(place) === actor.uuid) return { can: true, reason: null, scene: null };

  const scene = sceneOfLocation(place);
  if (scene) {
    return standsOn(scene, actor)
      ? { can: true, reason: null, scene }
      : { can: false, reason: "notHere", scene };
  }

  if (place.isOwner) return { can: true, reason: null, scene: null };
  if (pinnedPlaces(actor).has(place.uuid)) return { can: true, reason: null, scene: null };
  if (companionOwns(actor, place)) return { can: true, reason: null, scene: null };
  return { can: false, reason: "notYours", scene: null };
}

/** Every place in the world this character could deposit at right now. */
export const reachablePlaces = (actor) =>
  (storage()?.providers?.() ?? []).filter((place) => depositReach(actor, place).can);
