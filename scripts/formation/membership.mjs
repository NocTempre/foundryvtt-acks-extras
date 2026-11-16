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
import { addSummonMembers, getFormation, getFormations, getMemberActor, getPartyToken, isPerson, isSummonMember } from "./formation-model.mjs";
import { isGroupActor } from "../lib/group-logic.mjs";
import { isMarkerActor } from "../lib/place.mjs";
import { summonOfData } from "../lib/summons-logic.mjs";

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
  const theirs = here.find((f) => f.members.some((m) => getMemberActor(m ?? {})?.testUserPermission(user, "OWNER")));
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

/* -------------------------------------------- */
/*  Gathering summons                           */
/* -------------------------------------------- */

/** A gather's tail per formation: gathers for one party run one after another. */
const gatherTails = new Map();

/** The scene tokens a gather has claimed and not yet finished with, as `scene.token`. */
const claimed = new Set();

const claimKey = (token) => `${token.parent?.id}.${token.id}`;

/**
 * The actor uuids of the members that may take summons in: a real person's
 * record (never a summon's own) that is inside the party token, since a summoner
 * out on the map keeps its creatures out with it until it is recalled.
 */
function gatheringSummoners(formation, actorIds) {
  const wanted = new Set(actorIds);
  const uuids = new Set();
  for (const m of formation.members ?? []) {
    if (!m?.actorId || m.blank || isSummonMember(m) || !wanted.has(m.actorId)) continue;
    if (m.deployedTokenId || m.deployedStack) continue;
    uuids.add(`Actor.${m.actorId}`);
  }
  return uuids;
}

/** Does any party's member stand as this scene token? A deployed summon's token is no new arrival. */
const heldByAMember = (token) =>
  Object.values(getFormations()).some((f) => f.members.some((m) => m?.deployedTokenId === token.id && m.deployedSceneId === token.parent?.id));

/**
 * Bring the summoned creatures of these summoners into a party as members.
 * A creature joins only while its summoner is a real member inside the party
 * token, the party token stands on its scene, and its token carries a cast
 * record (a creature bound by hand has none and never joins). Runs on a GM
 * client, once per event, so it takes nothing while a fight holds the party
 * deployed. Each token is claimed on the spot, so a second call for the same
 * creature, made before the first has finished, finds it taken; gathers for one
 * party then run one after another.
 *
 * @param {object} formation the caller's copy of the party. The record is re-read when the gather runs;
 *   the copy is brought into line with the members it stores, so a write of it afterwards keeps them
 * @param {string[]} summonerIds row `actorId`s of the members whose creatures to take
 * @returns {Promise<number>} how many creatures joined
 */
export function gatherSummons(formation, summonerIds) {
  const id = formation?.id;
  const current = id ? getFormation(id) : null;
  if (!game.user?.isGM || !current || current.combat?.active) return Promise.resolve(0);
  const scene = getPartyToken(current)?.parent;
  const summoners = gatheringSummoners(current, summonerIds ?? []);
  if (!scene || !summoners.size) return Promise.resolve(0);
  const tokens = scene.tokens.filter((token) => {
    const { summonedBy, summon } = summonOfData(token.toObject());
    return summon && summoners.has(summonedBy) && !claimed.has(claimKey(token)) && !heldByAMember(token);
  });
  if (!tokens.length) return Promise.resolve(0);
  for (const token of tokens) claimed.add(claimKey(token));
  const run = (gatherTails.get(id) ?? Promise.resolve()).then(async () => {
    // The record as it stands now: a summoner may have left or gone out meanwhile.
    const fresh = getFormation(id);
    const still = fresh ? gatheringSummoners(fresh, summonerIds ?? []) : new Set();
    const joining = tokens.filter((token) => still.has(summonOfData(token.toObject()).summonedBy));
    if (!joining.length) return 0;
    await addSummonMembers(id, joining, formation);
    return joining.length;
  });
  const settled = run.finally(() => {
    for (const token of tokens) claimed.delete(claimKey(token));
  });
  gatherTails.set(id, settled.catch(() => 0));
  return settled;
}
