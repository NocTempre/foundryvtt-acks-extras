import { makeLoc } from "../lib/util.mjs";
import { announce } from "./announce.mjs";
import { MODULE_ID, ROLES } from "./constants.mjs";
import { formationForToken, getFormations, getPartyToken, updateFormation } from "./formation-model.mjs";
import { deployMembers, recallMembers } from "./deployment.mjs";
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


const loc = makeLoc("ACKS-FORMATION");

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
  //
  // A DETACHED member is not that evidence: a scout ahead of the party is
  // exactly who walks into a fight, and treating their token as "already
  // deployed" would leave the rest of the party inside the party token for the
  // whole battle.
  const alreadyFighting = formation.members.some((m) => m.deployedTokenId && !m.detached);
  if (formation.combat?.active || alreadyFighting) {
    await combatant.delete();
    return;
  }

  const scene = tokenDoc.parent;
  // Everyone who can fight goes out; non-combatants stay inside the party token.
  // A member already detached is on the map already and simply joins the fight.
  const fighters = formation.members.filter(
    (m) => m && !m.blank && m.actorId && !m.roles?.includes(ROLES.NONCOMBATANT),
  );
  await deployMembers(formation, { members: fighters });
  const onField = fighters.filter((m) => m.deployedTokenId);

  if (!onField.length) {
    await announce(formation, loc("chat.combatNoCombatants"), { whisper: true });
    return;
  }

  // A detached member is already deployed and already a token: the fight simply
  // takes them over, so combat movement is not held to the one-round leash.
  for (const member of onField) {
    delete member.detached;
    delete member.detach;
  }
  await updateFormation(formation);

  const combatants = onField.map((member) => ({
    tokenId: member.deployedTokenId,
    actorId: scene.tokens.get(member.deployedTokenId)?.actorId,
    sceneId: scene.id,
    hidden: combatant.hidden,
  }));

  await combat.createEmbeddedDocuments("Combatant", combatants);
  await combatant.delete();

  // The party token stays only as the camp for non-combatants.
  const staysBehind = formation.members.some((m) => m.roles?.includes(ROLES.NONCOMBATANT));
  if (!staysBehind) await tokenDoc.update({ hidden: true });

  formation.combat = { combatId: combat.id, active: true, roundsCounted: 0 };
  await updateFormation(formation);
  await announce(formation, loc("chat.combatDeployed", { n: onField.length }));
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

  /* --- Any rounds not yet ticked live feed the clock now --- */
  const rounds = Math.max(0, (combat.round ?? 0) - (formation.combat?.roundsCounted ?? 0));

  formation.combat = null;
  // The fallen come back with the party: assign Carriers, or remove them from
  // the formation to abandon the body where it fell.
  const { fallen, anchor } = await recallMembers(formation);

  // Re-anchor movement tracking at the reform position before the token moves.
  if (anchor) formation.clock.lastPosition = anchor;
  else if (partyToken) formation.clock.lastPosition = { x: partyToken.x, y: partyToken.y };
  await updateFormation(formation);

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
