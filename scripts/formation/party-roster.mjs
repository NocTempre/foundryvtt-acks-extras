/* global game, foundry */
/**
 * The `party-roster` service (contract: docs/lib/API.md): the parties this
 * world holds and who is in each, for a tool that works on a whole party at
 * once. Each member is handed over with the document an update reaches them
 * through. A linked member's is the world actor; a deployed unlinked
 * member's is their live token's actor; an unlinked member riding in the
 * party token has none, because their state lives in the stashed token, so
 * that member's hit points are written here, into the stash.
 */
import * as services from "../lib/services.mjs";
import {
  formationForToken,
  getFormation,
  getMemberActor,
  memberHp,
  memberOwnToken,
  patchFormation,
  readFormations,
  realMembers,
} from "./formation-model.mjs";

/** One member, as the contract hands it over. */
function rosterMember(member) {
  const actor = getMemberActor(member);
  if (!actor) return null;
  const own = memberOwnToken(member);
  // A live token is a document; a stash is plain data with no `actor`.
  const live = own?.actor ?? null;
  return {
    actorId: member.actorId,
    actor,
    name: own?.name || actor.name,
    document: own ? live : actor,
    stashed: !member.deployedTokenId && !member.deployedStack,
    unlinked: !!own,
    hp: memberHp(member, actor),
  };
}

/**
 * Write a stashed unlinked member's hit points into their stashed token.
 * `next(hp)` is handed the value found inside the save lock and returns the
 * new value, or null to write nothing.
 * @returns {Promise<{before: number, after: number, max: number|null}|null>}
 *   null when the member is not stashed and unlinked, or `next` declined
 */
async function adjustStashedHp(partyId, actorId, next) {
  if (!game.user?.isGM) return null;
  let done = null;
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
  });
  return done;
}

/** Provide the `party-roster` contract. Called once, at init. */
export function registerPartyRoster() {
  services.register("party-roster", {
    list: () => Object.values(readFormations()).map((f) => ({ id: f.id, name: f.name })),
    partyOf: (tokenDoc) => formationForToken(tokenDoc)?.id ?? null,
    members: (id) => realMembers(getFormation(id)).map(rosterMember).filter(Boolean),
    adjustStashedHp,
  });
}
