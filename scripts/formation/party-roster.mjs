/* global game, foundry */
/**
 * The `party-roster` service (contract: docs/lib/API.md): the parties this
 * world holds and who is in each, for a tool that works on a whole party at
 * once. Each member is handed over with the document an update reaches them
 * through. A linked member's is the world actor; a deployed unlinked
 * member's is their live token's actor; an unlinked member riding in the
 * party token has none, because their state lives in the stashed token, so
 * that member's hit points are written here, into the stash. A member made
 * from a summoning cast is read for its summoner and cast record
 * (`summonOfData`), and one of them is let go by `release`.
 */
import * as services from "../lib/services.mjs";
import { summonOfData } from "../lib/summons-logic.mjs";
import { findDeployedMember } from "./deployment.mjs";
import {
  formationForToken,
  getFormation,
  getMemberActor,
  isSummonMember,
  memberHp,
  memberOwnToken,
  patchFormation,
  readFormations,
  realMembers,
  syncPartyActorSpeed,
} from "./formation-model.mjs";

/** One member, as the contract hands it over. */
function rosterMember(member) {
  const actor = getMemberActor(member);
  if (!actor) return null;
  const own = memberOwnToken(member);
  // A live token is a document; a stash is plain data with no `actor`.
  const live = own?.actor ?? null;
  // A live token holds its delta as a document, a stash as plain data.
  const { summonedBy, summon } = summonOfData(own?.toObject?.() ?? own);
  return {
    actorId: member.actorId,
    actor,
    name: own?.name || actor.name,
    document: own ? live : actor,
    stashed: !member.deployedTokenId && !member.deployedStack,
    unlinked: !!own,
    hp: memberHp(member, actor),
    summonedBy,
    summon,
  };
}

/**
 * Write a stashed unlinked member's hit points into their stashed token.
 * `next(hp)` is handed the value found inside the save lock and returns the
 * new value, or null to write nothing. A summon member left at zero or below
 * ends there, as a dismissal ends it (`release`): it is no person to be carried.
 * @returns {Promise<{before: number, after: number, max: number|null}|null>}
 *   null when the member is not stashed and unlinked, or `next` declined
 */
async function adjustStashedHp(partyId, actorId, next) {
  if (!game.user?.isGM) return null;
  let done = null;
  let summon = false;
  await patchFormation(partyId, (record) => {
    const member = record.members?.find((m) => m?.actorId === actorId);
    // Deployed or linked, the member is written through a document instead.
    if (!member || member.deployedTokenId || member.deployedStack) return false;
    const stashed = member.tokenData;
    if (!stashed || stashed.actorLink) return false;
    const hp = memberHp(member);
    const after = hp ? next(hp) : null;
    if (typeof after !== "number" || !Number.isFinite(after)) return false;
    // A token that matches its actor stashes its delta as null, which
    // `setProperty` will not build through.
    stashed.delta ??= {};
    foundry.utils.setProperty(stashed, "delta.system.hp.value", after);
    done = { before: hp.value, after, max: hp.max };
    summon = isSummonMember(member);
  });
  if (done && summon && done.after <= 0) await release(partyId, [actorId]);
  return done;
}

/**
 * The member a live scene token is, as the party and the row id it is listed
 * under, or null for a token no member holds.
 */
function memberOfToken(tokenDoc) {
  const found = tokenDoc ? findDeployedMember(tokenDoc) : null;
  return found?.member?.actorId ? { partyId: found.formation.id, actorId: found.member.actorId } : null;
}

/**
 * End the named members' membership, stashed or deployed. The records go in
 * one patch first, taking the deployed tokens' ids with them, and those
 * tokens are deleted after it: a recall then has no record to restore a
 * deleted creature from, and the token's deletion finds no record left
 * behind. GM only.
 * @param {string} partyId
 * @param {string[]} ids  row `actorId`s
 * @returns {Promise<{released: number}>}
 */
async function release(partyId, ids) {
  if (!game.user?.isGM) return { released: 0 };
  const leaving = new Set((ids ?? []).filter(Boolean));
  const tokens = [];
  let released = 0;
  const record = leaving.size
    ? await patchFormation(partyId, (stored) => {
        const gone = (stored.members ?? []).filter((m) => m?.actorId && leaving.has(m.actorId));
        if (!gone.length) return false;
        for (const m of gone) {
          if (m.deployedTokenId && m.deployedSceneId) tokens.push({ sceneId: m.deployedSceneId, id: m.deployedTokenId });
        }
        stored.members = stored.members.filter((m) => !gone.includes(m));
        released = gone.length;
      })
    : null;
  if (!released) return { released: 0 };
  const perScene = new Map();
  for (const { sceneId, id } of tokens) perScene.set(sceneId, [...(perScene.get(sceneId) ?? []), id]);
  for (const [sceneId, tokenIds] of perScene) {
    const scene = game.scenes?.get?.(sceneId);
    const present = tokenIds.filter((id) => scene?.tokens?.get?.(id));
    if (present.length) await scene.deleteEmbeddedDocuments("Token", present);
  }
  await syncPartyActorSpeed(record);
  return { released };
}

/**
 * End a summon member whose deployed token's creature stands at zero hit
 * points or below: the record goes first and then the token, as a dismissal
 * removes it. Only a summon member ends; a person's token at zero is a
 * casualty, not an end. GM only.
 * @param {Actor} actor the token's actor, as core hands it to `updateActor`
 * @returns {Promise<boolean>} whether a member ended
 */
export async function endFallenSummon(actor) {
  const hp = actor?.system?.hp?.value;
  const token = actor?.isToken ? actor.token : null;
  if (!token || typeof hp !== "number" || hp > 0) return false;
  const found = findDeployedMember(token);
  if (!isSummonMember(found?.member) || !found.member.actorId) return false;
  return (await release(found.formation.id, [found.member.actorId])).released > 0;
}

/** Provide the `party-roster` contract. Called once, at init. */
export function registerPartyRoster() {
  services.register("party-roster", {
    list: () => Object.values(readFormations()).map((f) => ({ id: f.id, name: f.name })),
    partyOf: (tokenDoc) => formationForToken(tokenDoc)?.id ?? null,
    members: (id) => realMembers(getFormation(id)).map(rosterMember).filter(Boolean),
    adjustStashedHp,
    memberOfToken,
    release,
  });
}
