/* global game, foundry, ChatMessage */
import { MODULE_ID, ROLES } from "./constants.mjs";
import {
  formationForToken,
  formationOffset,
  getFormations,
  getMemberActor,
  getPartyToken,
  isDown,
  updateFormation,
} from "./formation-model.mjs";
import { advanceRounds } from "./turn-engine.mjs";

/**
 * Combat integration (runs on the primary GM client):
 *
 * - Adding the party token to a combat deploys the member tokens around it in
 *   marching order and swaps the party combatant for one combatant per member.
 *   Members flagged Non-combatant stay inside the party token and out of the
 *   initiative; the party token hides if nobody stays behind.
 * - When the combat ends the party reforms automatically: member tokens are
 *   re-stashed (with any changes they accrued) — including the fallen, who
 *   are gathered up to be carried (assign the Carrier role) or abandoned by
 *   removing them from the formation.
 * - Combat rounds feed the round-level clock directly (10 = 1 turn).
 */

function gmIds() {
  return game.users.filter((u) => u.isGM).map((u) => u.id);
}

function loc(key, data = {}) {
  return game.i18n.format(`ACKS-FORMATION.${key}`, data);
}

async function announce(formation, text, { whisper = false } = {}) {
  await ChatMessage.create({
    content: `<div class="acks-formation-card"><em>${text}</em></div>`,
    speaker: { alias: formation.name },
    whisper: whisper ? gmIds() : [],
  });
}

/* -------------------------------------------- */
/*  Deploy on joining combat                    */
/* -------------------------------------------- */

/** Handle a new combatant: if it is a party token, deploy the members instead. */
export async function onPartyCombatantCreated(combatant) {
  const tokenDoc = combatant.token;
  const formation = tokenDoc ? formationForToken(tokenDoc) : null;
  if (!formation) return;
  const combat = combatant.parent;

  // Already deployed (e.g. the party token was re-added): just drop the extra
  // combatant. Deployed member tokens count as evidence even without the
  // combat flag — deploying again would duplicate every member on the field.
  if (formation.combat?.active || formation.members.some((m) => m.deployedTokenId)) {
    await combatant.delete();
    return;
  }

  const scene = tokenDoc.parent;
  const gs = scene.grid.size;
  const toCreate = [];
  for (let cell = 0; cell < formation.members.length; cell++) {
    const member = formation.members[cell];
    if (!member || member.blank || !member.actorId) continue;
    if (member.roles?.includes(ROLES.NONCOMBATANT)) continue;
    const actor = getMemberActor(member);
    if (isDown(actor)) continue; // the down are carried, not deployed
    let data = member.tokenData ? foundry.utils.deepClone(member.tokenData) : null;
    if (!data && actor) data = (await actor.getTokenDocument()).toObject();
    if (!data) continue;
    delete data._id;
    // Deploy in marching-order shape — blanks leave real gaps in the line.
    const { dx, dy } = formationOffset(formation, cell);
    data.x = tokenDoc.x + dx * gs;
    data.y = tokenDoc.y + dy * gs;
    data.hidden = false;
    toCreate.push({ member, data });
  }

  if (!toCreate.length) {
    await announce(formation, loc("chat.combatNoCombatants"), { whisper: true });
    return;
  }

  const created = await scene.createEmbeddedDocuments("Token", toCreate.map((c) => c.data));
  const combatants = [];
  created.forEach((token, i) => {
    toCreate[i].member.deployedTokenId = token.id;
    combatants.push({
      tokenId: token.id,
      actorId: token.actorId,
      sceneId: scene.id,
      hidden: combatant.hidden,
    });
  });
  // Record the deployed tokens at once so reform can always gather them,
  // even if combatant creation below fails.
  await updateFormation(formation);

  await combat.createEmbeddedDocuments("Combatant", combatants);
  await combatant.delete();

  // The party token stays only as the camp for non-combatants.
  const staysBehind = formation.members.some((m) => m.roles?.includes(ROLES.NONCOMBATANT));
  if (!staysBehind) await tokenDoc.update({ hidden: true });

  formation.combat = { combatId: combat.id, active: true, roundsCounted: 0 };
  await updateFormation(formation);
  await announce(formation, loc("chat.combatDeployed", { n: created.length }));
}

/* -------------------------------------------- */
/*  Reform when combat ends                     */
/* -------------------------------------------- */

/**
 * Live round ticking: as the combat's round advances, spend the formation's
 * clock in real time — spells, lights, and rest all track DURING the fight
 * rather than catching up afterwards.
 */
export async function onCombatRoundChange(combat) {
  const formations = Object.values(getFormations()).filter(
    (f) => f.combat?.active && f.combat.combatId === combat.id,
  );
  for (const formation of formations) {
    const counted = formation.combat.roundsCounted ?? 0;
    const delta = (combat.round ?? 0) - counted;
    if (delta <= 0) continue; // never rewind on GM round corrections
    formation.combat.roundsCounted = combat.round;
    await advanceRounds(formation, delta, { reason: "combat" });
  }
}

/** When a combat is deleted, reform every formation that deployed into it. */
export async function onCombatEnd(combat) {
  const formations = Object.values(getFormations()).filter(
    (f) =>
      (f.combat?.active && f.combat.combatId === combat.id) ||
      // Self-healing: deployed member tokens are evidence of an unfinished
      // deploy even when the combat flag is missing (a crash, or a stale
      // concurrent write having clobbered it). Reforming on evidence beats
      // stranding the whole party on the field.
      f.members.some((m) => m.deployedTokenId),
  );
  for (const formation of formations) {
    try {
      await reform(formation, combat);
    } catch (err) {
      console.error(`${MODULE_ID} | failed to reform ${formation.name}`, err);
    }
  }
}

async function reform(formation, combat) {
  const partyToken = getPartyToken(formation);
  const scene = partyToken?.parent ?? game.scenes.get(formation.sceneId);

  const fallen = [];
  const toDelete = [];
  let anchor = null;

  for (const member of [...formation.members]) {
    const tokenId = member.deployedTokenId;
    delete member.deployedTokenId;
    if (!tokenId) continue;
    const token = scene?.tokens.get(tokenId);
    if (!token) continue; // token already gone; keep the pre-combat stash

    const hp = token.actor?.system?.hp?.value;
    if (typeof hp === "number" && hp <= 0) {
      // The fallen are gathered up with the party: assign Carriers, or
      // remove them from the formation to abandon the body where it fell.
      fallen.push(token.actor?.name ?? token.name);
    }

    member.tokenData = token.toObject();
    if (!anchor) anchor = { x: token.x, y: token.y };
    toDelete.push(token.id);
  }

  /* --- Any rounds not yet ticked live feed the clock now --- */
  const rounds = Math.max(0, (combat.round ?? 0) - (formation.combat?.roundsCounted ?? 0));

  formation.combat = null;
  // Re-anchor movement tracking at the reform position before the token moves.
  if (anchor) formation.clock.lastPosition = anchor;
  else if (partyToken) formation.clock.lastPosition = { x: partyToken.x, y: partyToken.y };
  // Stash before destroy: the members' token snapshots must be in storage
  // before their canvas tokens are deleted, or a failure loses them.
  await updateFormation(formation);

  if (scene && toDelete.length) await scene.deleteEmbeddedDocuments("Token", toDelete);

  if (partyToken) {
    const update = { hidden: false };
    if (anchor) Object.assign(update, anchor);
    await partyToken.update(update);
  }

  await announce(formation, loc("chat.combatReformed", { rounds }));
  if (fallen.length) {
    await announce(formation, loc("chat.combatFallen", { names: fallen.join(", ") }));
  }
  if (rounds > 0) await advanceRounds(formation, rounds, { reason: "combat" });
}
