/* global game, foundry */
import { MODULE_ID } from "../lib/constants.mjs";
import {
  blockOrigin,
  cellPosition,
  cellPositions,
  formationHeading,
  getMemberActor,
  getPartyToken,
  isDown,
  isStackMember,
  patchFormation,
  readFormations,
  updateFormation,
} from "./formation-model.mjs";

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
 * The group lifecycle ops (deploy/recall of a stack's bodies), loaded on demand.
 *
 * Nothing in this file may evaluate a Foundry class at module scope: the leash
 * predicates below are pure geometry and are imported with no Foundry globals at
 * all, while `lib/group.mjs` reaches a data model that subclasses one. Only the
 * stack paths need it, and they run inside Foundry by definition.
 */
function groupOps() {
  return import("../lib/group.mjs");
}

/* -------------------------------------------- */
/*  Who is on the canvas                        */
/* -------------------------------------------- */

/**
 * Is this member out of the party token — standing on the map rather than
 * riding inside it?
 *
 * An individual names the one token it went out as. A stack went out as bodies
 * that belong to the group actor and carry no member token id, so it answers
 * with its own marker. Both are deployed, and everything that asks the question
 * asks it here: either field read on its own is half an answer, and the half it
 * misses is a whole occupant.
 */
export function isMemberDeployed(member) {
  return !!(member?.deployedTokenId || member?.deployedStack);
}

/**
 * Every token on `scene` this member is standing on: one for an individual, one
 * per body for a stack, and none for a member who is inside the party token or
 * whose tokens are already gone.
 *
 * A stack's bodies are found by the group flag the deploy stamped on them — the
 * same reconciliation `groups.recall` gathers them by, so the two can never
 * disagree about which tokens belong to the crowd, and a body orphaned by a
 * crash is still counted.
 *
 * Async because the group flag lives behind the on-demand import above; the
 * individual path never reaches it. Enumeration only: nothing here writes.
 *
 * @param {object} member the formation member record
 * @param {Scene} scene the scene the party is standing on
 * @returns {Promise<TokenDocument[]>} the member's tokens, in placement order
 */
export async function deployedTokens(member, scene) {
  if (!scene || !isMemberDeployed(member)) return [];
  if (member.deployedStack) {
    const actor = getMemberActor(member);
    if (!actor) return [];
    const { GROUP_FLAG } = await groupOps();
    return scene.tokens.filter((t) => t.getFlag(MODULE_ID, GROUP_FLAG) === actor.uuid);
  }
  const token = scene.tokens.get(member.deployedTokenId);
  return token ? [token] : [];
}

/**
 * Create tokens for `members` around the party token, in marching-order shape.
 *
 * Blanks leave real gaps in the line, and the down are carried rather than
 * deployed. Members already on the map are skipped, so a second call cannot
 * duplicate anyone.
 *
 * A STACK goes out as the bodies it holds rather than as the one token that
 * stands for them: each of its stacks is laid into the squares its cell occupies
 * (`cellPositions`), so the occupant behind it starts after the last of them.
 * Those bodies belong to the group actor, not to the cell, so the cell records
 * only THAT it is out and `groups.recall` is what gathers them back.
 *
 * The block points the way the party token faces, so the column trails behind
 * the party rather than always to the south-east, and the scout stays at the end
 * that is walking into the dark.
 *
 * The block is fitted to the scene before anyone is placed: a wide frontage or a
 * deep column is SHIFTED onto the map, never allowed to march its rear ranks off
 * the edge, and never squashed flat against it.
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
  // Read once and passed to every placement below: the origin is clamped for a
  // heading, so a cell laid out against a different one (the token having turned
  // mid-deploy) would fall outside the room the clamp made for it.
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
    // A casualty is normally carried rather than deployed — but one the party
    // has LEFT is exactly a body that belongs on the map, lying where it fell.
    // Marking someone left is the one thing that puts a down member's token on
    // the canvas.
    if (isDown(actor) && !member.left) continue;
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
      // One creation call per stack, whatever its headcount. The last square
      // catches a stack that grew after the squares were measured, so a body
      // never lands at 0,0.
      const bodies = await groups.deploy(actor, scene, {
        stackKey: stack.key,
        count: n,
        place: (k) => spots[first + k] ?? spots.at(-1),
      });
      created.push(...bodies);
      body += n;
    }
    // Marked only once bodies are really on the map: a cell that claims to be
    // out with nothing standing can never be deployed again. There is no token
    // id to keep — the bodies are the group's, and the group recalls them — and
    // no leash anchor, because a crowd has no one square it stepped out from.
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
 * Bring members back inside the party token, keeping everything that happened
 * to them while they were out.
 *
 * A cell that went out as a STACK comes back through the group model, which
 * folds every body's delta home and takes the fallen off the headcount in one
 * write. It reports its losses under its own name, one entry per body, because
 * no body of a stack is named in the marching order.
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
    // Collected while the bodies still stand: the markers naming them are
    // cleared next, and the group recall below (like the batched delete at the
    // end) takes them off the canvas.
    const bodies = await deployedTokens(member, scene);
    const wasStack = member.deployedStack;
    delete member.deployedTokenId;
    delete member.deployedStack;
    delete member.detached;
    delete member.detach;
    // The party re-forms where its people actually stood, whether the first of
    // them out was one character or the front rank of a crowd.
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
 * The same answer, read straight out of storage without copying it.
 *
 * This is what the drag path asks: `preUpdateToken` fires on every step of every
 * token movement, and copying the whole formations blob (a token snapshot per
 * stashed member) to answer "is this one of ours?" is what makes dragging choppy
 * in a large party. The result is READ-ONLY — it is the stored record itself.
 */
export function findDeployedMember(tokenId) {
  return memberForDeployedToken(Object.values(readFormations()), tokenId);
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
 * Would moving this detached member's token to `target` break the leash?
 *
 * The actor is passed in rather than looked up, which keeps this a pure
 * predicate over geometry and one speed — no world state, so the offline tests
 * exercise the real arithmetic instead of a copy of it.
 *
 * A member LEFT IN PLACE has no leash; one that simply cannot move has no
 * licence to move. Those are different answers to a zero speed, and conflating
 * them is what let an immobilised token wander.
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

  // LEFT IN PLACE: no leash at all. This one flag covers everything the party
  // deliberately stops bringing along — a casualty on the floor, a standing
  // camp, the wagons parked at the treeline, the packs dropped before a fight.
  // None of them are following anybody, so tethering them to the party's
  // position is meaningless, and the party walking away is the entire point.
  if (member.left) return null;

  const allowance = oneRoundFeet(actor);
  // Immobile and NOT left in place is a contradiction the leash must not
  // reward: something that cannot move must not thereby become able to move
  // anywhere. Treating a zero allowance as "no limit" is exactly the wrong way
  // round, and is how a member forced to 0 would slip the tether entirely.
  //
  // But a speed that is ABSENT is not a speed of zero — it is a sheet that
  // never said. An unstated speed invents no limit, exactly as before; only a
  // stated zero freezes.
  if (allowance <= 0) {
    if (!statesASpeed(actor)) return null;
    const distance = feetBetween(scene, anchor, target);
    return distance > 0 ? { distance, allowance: 0, immobile: true } : null;
  }

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
