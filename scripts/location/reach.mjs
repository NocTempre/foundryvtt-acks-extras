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
 * `standingSpots` is the one reader that answers it. A character RIDING INSIDE a
 * formation has no token of their own on the ground — `addMember`
 * (formation-model.mjs) deletes it the instant they join — so the thing standing
 * on the map is the formation's party token, and it answers for everyone it
 * carries. It answers for them ALONE: a stale token on a map reaches nothing
 * while the formation has a body of its own standing somewhere.
 *
 * `deployMembers` (formation/deployment.mjs) gives a body back: a member sent
 * out AS AN INDIVIDUAL — detached, left where they fell, or deployed for a
 * fight — is standing at the token that deploy created and not at the party
 * token, so a scout beside a market cart reaches the cart their company cannot.
 * A cell deployed as a STACK keeps answering through the party token instead:
 * `groups.deploy` (lib/group.mjs) builds every body from the stack's TEMPLATE
 * actor, so those tokens name the template and not the cell, and the deploy
 * records only THAT the cell is out. With no token of its own named, nothing
 * displaces the party token. A formation with no party token placed anywhere
 * has no body to answer WITH, and its members fall back to their own tokens
 * rather than standing nowhere at all.
 *
 * A character no formation claims stands wherever their own tokens do, on every
 * scene at once — and one token is one body: an unlinked copy of a hireling
 * reaches what IT is beside, never what another copy of the same sheet is.
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
 * THE TWO HALVES ASK ABOUT DIFFERENT SUBJECTS, and the asymmetry is the point.
 * A place IS its world actor, so `placedOn` is keyed on `token.actorId` — every
 * marker naming that actor is a marker of the place. A character is a BODY: a
 * token actor's `id` is its base actor's, and `actorId` is a foreign key to that
 * base actor on unlinked and linked tokens alike, so a subject matched by id
 * collects every copy of itself on every map and lends them all one reach. A
 * token actor is therefore matched by its own token, and only a base actor
 * answers for the tokens that name it.
 *
 * @returns {{mine: Map<string, object[]>, placedOn: Map<string, object[]>}}
 */
export function reachScan(actor) {
  const mine = new Map();
  const placedOn = new Map();
  // Built once, outside the walk: which of the two subjects is being asked about
  // is a property of the actor, not of the token under inspection. A token actor
  // with no token to name matches nothing rather than falling back to its base
  // actor's id, which is the very match that lends one body another's ground.
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
 * The party token answers for a member riding inside it, and answers alone — a
 * stale token on a map grants nothing while the formation has a body of its own
 * standing somewhere. The ground is read instead in the two cases where that
 * body is not where this character is: a formation with no party token placed
 * anywhere, and a member `deployMembers` sent out AS AN INDIVIDUAL. That member
 * stands at the token the deploy made for them and at no other token bearing
 * their name, which is what separates a live detachment from a stale leftover.
 *
 * A cell deployed as a STACK is not the second of those cases: `groups.deploy`
 * builds every body from the stack's template actor and records no token id for
 * the cell, so nothing displaces the party token and the crowd is where the
 * cell is found. It reaches the FIRST case like any other member — a stack
 * whose formation has no party token falls to the ground — and there the only
 * token it can find is a leftover, because a cell never legitimately owns one.
 *
 * Both halves of the rule go through here, so the linked-scene case and the
 * ground-token case can never disagree about whose token is on the map.
 *
 * @returns {Array<{scene: object, point: {x: number, y: number}, elevation: number}>}
 */
function standingSpots(actor, scan) {
  // A synthetic token actor is one BODY of a base actor, not the character a
  // marching order holds: the roster is keyed on the base id, so asking it about
  // an unlinked copy would stand that copy inside the party token.
  const formation = actor?.isToken ? null : getFormationForActor(actor?.id);
  const member = formation?.members?.find((m) => m?.actorId === actor.id) ?? null;
  // The one token this member went out under. `deployedStack` records only THAT
  // a cell is out, so it leaves this null and the party token answers.
  const ownBody = member?.deployedTokenId ?? null;
  if (formation && !ownBody) {
    const at = partyPoint(formation);
    if (at) return [at];
  }
  const out = [];
  const mine = scan?.mine ?? reachScan(actor).mine;
  for (const [sceneId, tokens] of mine) {
    const scene = game.scenes?.get(sceneId);
    if (!scene) continue;
    const gridSize = scene.grid.size;
    for (const token of tokens) {
      // Once a deploy has given this member a body, that body is the only one
      // that counts: any other token naming the same actor is a leftover, and a
      // leftover stands for nobody.
      if (ownBody && token.id !== ownBody) continue;
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

/**
 * Does a user who owns `subject` own `place` as well?
 *
 * Ownership in Foundry is per USER, so every claim of the form "this character
 * can reach that place because it is theirs" is a claim about the users behind
 * the character. Asking the document — `place.isOwner` — asks instead about
 * whoever happens to be looking, and `testUserPermission` hands a GM OWNER on
 * every document in the world, so that question answers differently on every
 * seat and answers yes to all of them on the Judge's.
 *
 * The PLACE's `default` level counts, because a place left open to everyone is
 * open to the subject's owners too. The SUBJECT's does not: the users it stands
 * for are not knowable from the document, and reading it as "everyone" would
 * make any character the world left open reach every place anyone owns.
 */
export function ownersShare(subject, place) {
  for (const [userId, level] of Object.entries(subject?.ownership ?? {})) {
    if (userId === "default" || level < 3) continue;
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

  // Every clause here is about the CHARACTER, ownership included: the answer
  // belongs to the actor on the sheet, not to the client reading it, or a Judge
  // and a player would be told different things about the same sheet.
  if (ownersShare(actor, place)) return { can: true, reason: null, scene: null };
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
