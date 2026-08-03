/* global game, foundry */
import { formationOffset, getMemberActor, getPartyToken, isDown, patchFormation, updateFormation } from "./formation-model.mjs";

/**
 * Putting members on the map and gathering them back in.
 *
 * A formation normally travels as one token. Two things take a member out of it:
 * a combat, which deploys everyone who can fight, and a **detach**, which sends
 * one member out deliberately — the scout easing down the corridor while the
 * party waits. Both need the same three careful steps, so both call this file.
 *
 * The member never leaves the formation. Marching order, roles, lights, rest and
 * the turn clock all keep counting them; what changes is which token carries
 * their vision and their torch. That is the whole point of a detach: the scout
 * is out front in the dark, and what they can see is their own business.
 *
 * ## The order matters
 *
 * On the way out, the deployed token ids are recorded BEFORE anything else can
 * fail, so a recall can always find every token it created. On the way back, the
 * member's token snapshot is stashed BEFORE the canvas token is destroyed — a
 * failure between the two would otherwise lose the character's accrued damage,
 * effects and inventory outright.
 */

/**
 * Create tokens for `members` around the party token, in marching-order shape.
 *
 * Blanks leave real gaps in the line, and the down are carried rather than
 * deployed. Members already on the map are skipped, so a second call cannot
 * duplicate anyone.
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
  const gs = scene.grid.size;
  const wanted = new Set(members.filter(Boolean));

  const toCreate = [];
  for (let cell = 0; cell < formation.members.length; cell++) {
    const member = formation.members[cell];
    if (!member || member.blank || !member.actorId) continue;
    if (!wanted.has(member)) continue;
    if (member.deployedTokenId) continue; // already out
    const actor = getMemberActor(member);
    if (isDown(actor)) continue; // the down are carried, not deployed
    let data = member.tokenData ? foundry.utils.deepClone(member.tokenData) : null;
    if (!data && actor) data = (await actor.getTokenDocument()).toObject();
    if (!data) continue;
    delete data._id;
    const { dx, dy } = formationOffset(formation, cell);
    data.x = partyToken.x + dx * gs;
    data.y = partyToken.y + dy * gs;
    data.hidden = false;
    toCreate.push({ member, data });
  }
  if (!toCreate.length) return [];

  const created = await scene.createEmbeddedDocuments(
    "Token",
    toCreate.map((c) => c.data),
  );
  created.forEach((token, i) => {
    const member = toCreate[i].member;
    member.deployedTokenId = token.id;
    if (detached) {
      member.detached = true;
      // The leash measures from where they stood when they stepped out.
      member.detach = { anchor: { x: token.x, y: token.y } };
    }
  });
  // Record the deployed tokens at once so a recall can always gather them,
  // even if whatever the caller does next fails.
  await updateFormation(formation);
  return created;
}

/**
 * Bring members back inside the party token, keeping everything that happened
 * to them while they were out.
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
    const tokenId = member.deployedTokenId;
    delete member.deployedTokenId;
    delete member.detached;
    delete member.detach;
    if (!tokenId) continue;
    const token = scene?.tokens.get(tokenId);
    if (!token) continue; // token already gone; keep the pre-deploy stash

    const hp = token.actor?.system?.hp?.value;
    if (typeof hp === "number" && hp <= 0) fallen.push(token.actor?.name ?? token.name);

    member.tokenData = token.toObject();
    if (!anchor) anchor = { x: token.x, y: token.y };
    toDelete.push(token.id);
  }

  // Stash before destroy: the snapshots must be in storage before the canvas
  // tokens are deleted, or a failure loses them.
  await updateFormation(formation);
  if (scene && toDelete.length) await scene.deleteEmbeddedDocuments("Token", toDelete);
  return { fallen, anchor };
}

/**
 * Send one member out, or bring them back — the single entry point behind the
 * party sheet's detach button and a player's declaration.
 *
 * Refuses mid-combat (the fight owns who is on the field) and refuses to recall
 * a member deployed BY a combat: pulling a fighter back into the party token
 * while the battle runs would take them out of the initiative they are in.
 *
 * @returns {Promise<"detached"|"recalled"|null>} what happened, or null if the
 *   request was declined.
 */
export async function toggleDetachMember(formation, actorId) {
  const member = formation.members.find((m) => m?.actorId === actorId);
  if (!member) return null;
  if (formation.combat?.active) return null;

  if (member.deployedTokenId) {
    if (!member.detached) return null; // deployed by a combat, not by a detach
    await recallMembers(formation, { members: [member] });
    return "recalled";
  }
  const created = await deployMembers(formation, { members: [member], detached: true });
  return created.length ? "detached" : null;
}

/** Is any member currently out of the party token? */
export function anyDeployed(formation) {
  return formation.members.some((m) => m?.deployedTokenId);
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

/* -------------------------------------------- */
/*  The leash                                   */
/* -------------------------------------------- */

/**
 * A detached member may not get further than ONE ROUND'S MOVEMENT from where
 * they stood the last time the party moved. Reaching that limit, they wait: the
 * party has to catch up (or pass them) before they can push on again.
 *
 * This is what lets a scout exist at all without breaking the clock. Dungeon
 * turns are driven by the party token's movement, and a scout free to range the
 * whole level would spend hours of game time that nothing counted. Tethered to a
 * round, the point man is where the rules put them — just ahead of the party,
 * within earshot — and the party token remains the only thing that spends time.
 *
 * The limit is a DISTANCE from the anchor, not a spent budget: pacing back and
 * forth inside the circle is free, because it gets you no further ahead. It also
 * means any client can evaluate the leash from state it already has, with no
 * running total that only a GM could write.
 */

/** One round of movement in feet: the system derives combat = exploration ÷ 3. */
export function oneRoundFeet(actor) {
  const combat = Number(actor?.system?.movementacks?.combat);
  if (Number.isFinite(combat) && combat > 0) return combat;
  const exploration = Number(actor?.system?.movementacks?.exploration);
  return Number.isFinite(exploration) && exploration > 0 ? exploration / 3 : 0;
}

/** Distance in scene units between two token positions. */
function feetBetween(scene, a, b) {
  return (Math.hypot(b.x - a.x, b.y - a.y) / scene.grid.size) * scene.grid.distance;
}

/**
 * Would moving this detached member's token to `target` break the leash?
 *
 * The actor is passed in rather than looked up, which keeps this a pure
 * predicate over geometry and one speed — no world state, so the offline tests
 * exercise the real arithmetic instead of a copy of it.
 *
 * @param {object} member the formation member record (carries `detach.anchor`)
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
  const allowance = oneRoundFeet(actor);
  if (allowance <= 0) return null;
  const distance = feetBetween(scene, anchor, target);
  return distance > allowance ? { distance, allowance } : null;
}

/**
 * The party moved: every detached member may range a fresh round from wherever
 * they now stand.
 *
 * Goes through `patchFormation`, not `updateFormation`. This fires from the
 * same `updateToken` hook as the clock's own movement processing, and a
 * whole-record write from a copy read before that flow's save would erase it —
 * the exact race that once wiped deploy's combat flag. Declining when nothing
 * moved also means a party with nobody detached costs no write at all.
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
