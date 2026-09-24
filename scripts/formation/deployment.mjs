/* global game, foundry */
import { deployedBodies } from "../lib/group-logic.mjs";
import {
  blockOrigin,
  cellPosition,
  cellPositions,
  formationHeading,
  getMemberActor,
  getPartyToken,
  isDown,
  isStackMember,
  MEMBER_TOKEN_OPTION,
  patchFormation,
  readFormations,
  updateFormation,
} from "./formation-model.mjs";

/**
 * Putting members on the map and gathering them back in: the combat deploy,
 * the deliberate detach, and the movement leash on a detached member. A
 * member never leaves the formation while deployed — only which token
 * carries their vision and torch changes. See docs/formation/MODEL.md,
 * "Detaching a member".
 *
 * Write ordering matters on both paths: deployed token ids are recorded
 * before anything else can fail, and a member's token snapshot is stashed
 * before the canvas token is destroyed.
 */

/**
 * The group lifecycle ops (deploy/recall of a stack's bodies), loaded on
 * demand: `lib/group.mjs` reaches a data model that subclasses a Foundry
 * class, and this file's leash predicates must stay importable with no
 * Foundry globals at all.
 */
function groupOps() {
  return import("../lib/group.mjs");
}

/* -------------------------------------------- */
/*  Who is on the canvas                        */
/* -------------------------------------------- */

/**
 * Is this member out of the party token — standing on the map rather than
 * riding inside it? An individual names its own token; a stack carries no
 * member token id and answers via its own marker instead. The one place
 * both are checked.
 */
export function isMemberDeployed(member) {
  return !!(member?.deployedTokenId || member?.deployedStack);
}

/**
 * Every token on `scene` this member is standing on: one for an individual,
 * one per body for a stack, none for a member inside the party token or
 * already gone. A stack's bodies are found by `deployedBodies`, the read
 * `groups.recall` gathers them by. Enumeration only: nothing here writes.
 *
 * @param {object} member the formation member record
 * @param {Scene} scene the scene the party is standing on
 * @returns {Promise<TokenDocument[]>} the member's tokens, in placement order
 */
export async function deployedTokens(member, scene) {
  if (!scene || !isMemberDeployed(member)) return [];
  if (member.deployedStack) return deployedBodies(getMemberActor(member), [scene]);
  const token = scene.tokens.get(member.deployedTokenId);
  return token ? [token] : [];
}

/**
 * Create tokens for `members` around the party token, in marching-order
 * shape. Blanks leave gaps; the down are carried rather than deployed;
 * members already on the map are skipped. A stack goes out as the bodies
 * it holds, laid into the squares its cell occupies; those bodies belong
 * to the group actor, and the cell only records that it is out. The block
 * is oriented to the party token's heading and fitted (shifted, never
 * squashed) onto the scene before anyone is placed.
 *
 * @param {object} formation
 * @param {object[]} members  which members to send out (default: all of them)
 * @param {boolean} [detached] mark these as a deliberate detach rather than a
 *   combat deploy — this is what arms the movement leash
 * @returns {Promise<TokenDocument[]>} the tokens created
 */
export async function deployMembers(formation, { members = formation.members, detached = false } = {}) {
  const partyToken = getPartyToken(formation);
  const scene = partyToken?.parent;
  if (!scene) return [];
  const wanted = new Set(members.filter(Boolean));
  // Read once and passed to every placement below — see docs/formation/MODEL.md,
  // "Which way the block points".
  const heading = formationHeading(formation);
  const origin = blockOrigin(formation, scene, { x: partyToken.x, y: partyToken.y }, { heading });

  const toCreate = [];
  const stacked = [];
  for (let cell = 0; cell < formation.members.length; cell++) {
    const member = formation.members[cell];
    if (!member || member.blank || !member.actorId) continue;
    if (!wanted.has(member)) continue;
    if (isMemberDeployed(member)) continue; // already out
    const actor = getMemberActor(member);
    // A casualty is carried rather than deployed, unless the party left them.
    if (isDown(actor, member) && !member.left) continue;
    if (isStackMember(member)) {
      // Held out of the individuals' batch: the group model does its own batched
      // creation, once per stack, after theirs.
      stacked.push({ member, actor, cell });
      continue;
    }
    let data = member.tokenData ? foundry.utils.deepClone(member.tokenData) : null;
    if (!data && actor) data = (await actor.getTokenDocument()).toObject();
    if (!data) continue;
    delete data._id;
    const { x, y } = cellPosition(formation, scene, origin, cell, heading);
    data.x = x;
    data.y = y;
    data.hidden = false;
    toCreate.push({ member, data });
  }
  if (!toCreate.length && !stacked.length) return [];

  const created = [];
  if (toCreate.length) {
    const tokens = await scene.createEmbeddedDocuments(
      "Token",
      toCreate.map((c) => c.data),
      { [MEMBER_TOKEN_OPTION]: true },
    );
    tokens.forEach((token, i) => {
      const member = toCreate[i].member;
      member.deployedTokenId = token.id;
      if (detached) {
        member.detached = true;
        // The leash measures from where they stood when they stepped out.
        member.detach = { anchor: { x: token.x, y: token.y } };
      }
    });
    created.push(...tokens);
  }

  const groups = stacked.length ? await groupOps() : null;
  for (const { member, actor, cell } of stacked) {
    const spots = cellPositions(formation, scene, origin, cell, heading);
    const before = created.length;
    let body = 0;
    for (const stack of actor.system.stacks ?? []) {
      const n = stack.size?.current ?? 0;
      if (n <= 0) continue;
      const first = body;
      // One creation call per stack. The last square catches a stack that
      // grew after the squares were measured.
      const bodies = await groups.deploy(actor, scene, {
        stackKey: stack.key,
        count: n,
        place: (k) => spots[first + k] ?? spots.at(-1),
      });
      created.push(...bodies);
      body += n;
    }
    // Marked only once bodies are really on the map. No token id to keep —
    // the bodies belong to the group — and no leash anchor for a crowd.
    if (created.length > before) {
      member.deployedStack = true;
      if (detached) member.detached = true;
    }
  }
  // Record the deployed tokens at once so a recall can always gather them,
  // even if whatever the caller does next fails.
  await updateFormation(formation);
  return created;
}

/**
 * Bring members back inside the party token, keeping everything that
 * happened to them while they were out. A cell that went out as a stack
 * comes back through the group model, which folds every body's delta home
 * and reports losses under the actor's own name, one entry per body.
 *
 * @returns {Promise<{fallen: string[], anchor: {x, y}|null}>} the names of any
 *   who came back at 0 hp (to be carried or abandoned), and the position to
 *   re-anchor the party token and its movement tracking at.
 */
export async function recallMembers(formation, { members = formation.members } = {}) {
  const partyToken = getPartyToken(formation);
  const scene = partyToken?.parent ?? game.scenes.get(formation.sceneId);
  const wanted = new Set(members.filter(Boolean));

  const fallen = [];
  const toDelete = [];
  let anchor = null;

  for (const member of formation.members) {
    if (!wanted.has(member)) continue;
    // Collected while the bodies still stand, before the markers naming them
    // are cleared below.
    const bodies = await deployedTokens(member, scene);
    const wasStack = member.deployedStack;
    delete member.deployedTokenId;
    delete member.deployedStack;
    delete member.detached;
    delete member.detach;
    // The party re-forms where its people actually stood.
    if (!anchor && bodies.length) anchor = { x: bodies[0].x, y: bodies[0].y };
    if (wasStack) {
      const actor = getMemberActor(member);
      if (!actor) continue; // the stack's sheet is gone; the marker is cleared regardless
      const groups = await groupOps();
      const { casualties } = await groups.recall(actor, { scene });
      for (let i = 0; i < casualties; i++) fallen.push(actor.name);
      continue;
    }
    const [token] = bodies;
    if (!token) continue; // token already gone; keep the pre-deploy stash

    const hp = token.actor?.system?.hp?.value;
    if (typeof hp === "number" && hp <= 0) fallen.push(token.actor?.name ?? token.name);

    member.tokenData = token.toObject();
    toDelete.push(token.id);
  }

  // Stash before destroy: the snapshots must be in storage before the canvas
  // tokens are deleted, or a failure loses them.
  await updateFormation(formation);
  if (scene && toDelete.length) await scene.deleteEmbeddedDocuments("Token", toDelete);
  return { fallen, anchor };
}

/**
 * Send one member out, or bring them back — the single entry point behind
 * the party sheet's detach button and a player's declaration. Refuses
 * mid-combat, and refuses to recall a member deployed by a combat rather
 * than by a detach.
 *
 * @returns {Promise<"detached"|"recalled"|null>} what happened, or null if the
 *   request was declined.
 */
export async function toggleDetachMember(formation, actorId) {
  const member = formation.members.find((m) => m?.actorId === actorId);
  if (!member) return null;
  if (formation.combat?.active) return null;

  if (isMemberDeployed(member)) {
    if (!member.detached) return null; // deployed by a combat, not by a detach
    await recallMembers(formation, { members: [member] });
    return "recalled";
  }
  const created = await deployMembers(formation, { members: [member], detached: true });
  return created.length ? "detached" : null;
}

/** Is any member currently out of the party token? */
export function anyDeployed(formation) {
  return formation.members.some(isMemberDeployed);
}

/** The members currently out on a deliberate detach (not a combat deploy). */
export function detachedMembers(formation) {
  return formation.members.filter((m) => m?.detached && m.deployedTokenId);
}

/** The formation and member owning a deployed token, or null. */
export function memberForDeployedToken(formations, tokenId) {
  for (const formation of formations) {
    const member = formation.members?.find((m) => m?.deployedTokenId === tokenId);
    if (member) return { formation, member };
  }
  return null;
}

/**
 * The same answer as `memberForDeployedToken`, read straight out of storage
 * without copying it — what the `preUpdateToken` drag path asks on every
 * step. The result is read-only: it is the stored record itself.
 */
export function findDeployedMember(tokenId) {
  return memberForDeployedToken(Object.values(readFormations()), tokenId);
}

/* -------------------------------------------- */
/*  The leash                                   */
/* -------------------------------------------- */

// See docs/formation/MODEL.md, "The leash".

/** One round of movement in feet: the system derives combat = exploration ÷ 3. */
export function oneRoundFeet(actor) {
  const combat = Number(actor?.system?.movementacks?.combat);
  if (Number.isFinite(combat) && combat > 0) return combat;
  const exploration = Number(actor?.system?.movementacks?.exploration);
  return Number.isFinite(exploration) && exploration > 0 ? exploration / 3 : 0;
}

/**
 * Does this sheet state a speed at all? A stated zero is immobility; nothing
 * stated is a gap in the data, and the two must not be read alike.
 */
function statesASpeed(actor) {
  const m = actor?.system?.movementacks;
  return Number.isFinite(Number(m?.combat)) || Number.isFinite(Number(m?.exploration));
}

/** Distance in scene units between two token positions. */
function feetBetween(scene, a, b) {
  return (Math.hypot(b.x - a.x, b.y - a.y) / scene.grid.size) * scene.grid.distance;
}

/**
 * Would moving this detached member's token to `target` break the leash? The
 * actor is passed in rather than looked up, keeping this a pure predicate
 * over geometry and one speed — no world state, so offline tests exercise
 * the real arithmetic. A member left in place has no leash; one that simply
 * cannot move has no licence to — those are different answers to a zero
 * speed.
 *
 * @param {object} member the formation member record (carries `detach.anchor`
 *   and `left`)
 * @param {TokenDocument} tokenDoc the token being moved (for its scene grid)
 * @param {{x: number, y: number}} target where it is being moved to
 * @param {Actor} actor the member's actor, for its per-round speed
 * @returns {{distance: number, allowance: number}|null} the breach, or null when
 *   the move is fine — and whenever there is nothing to enforce: no anchor, no
 *   scene, or a speed we cannot read. Never invent a limit.
 */
export function leashBreach(member, tokenDoc, target, actor) {
  const anchor = member?.detach?.anchor;
  const scene = tokenDoc?.parent;
  if (!anchor || !scene) return null;

  // Left in place: no leash at all — nothing is following anybody.
  if (member.left) return null;

  const allowance = oneRoundFeet(actor);
  // A stated zero speed freezes the member (no limit would let it slip the
  // tether); an unstated speed invents no limit at all.
  if (allowance <= 0) {
    if (!statesASpeed(actor)) return null;
    const distance = feetBetween(scene, anchor, target);
    return distance > 0 ? { distance, allowance: 0, immobile: true } : null;
  }

  const distance = feetBetween(scene, anchor, target);
  return distance > allowance ? { distance, allowance } : null;
}

/**
 * The party moved: every detached member may range a fresh round from
 * wherever they now stand. Goes through `patchFormation`, not
 * `updateFormation`, because this fires from the same `updateToken` hook as
 * the clock's own movement processing and a whole-record write from a stale
 * copy would race it.
 */
export async function reanchorDetached(formationId) {
  await patchFormation(formationId, (record) => {
    const scene = getPartyToken(record)?.parent ?? game.scenes.get(record.sceneId);
    let dirty = false;
    for (const member of detachedMembers(record)) {
      const token = scene?.tokens.get(member.deployedTokenId);
      if (!token) continue;
      const anchor = member.detach?.anchor;
      if (anchor?.x === token.x && anchor?.y === token.y) continue;
      member.detach = { anchor: { x: token.x, y: token.y } };
      dirty = true;
    }
    return dirty ? undefined : false; // false declines the write
  });
}
