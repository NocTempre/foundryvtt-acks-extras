/* global game */
import { makeLoc } from "../lib/util.mjs";
import { announce } from "./announce.mjs";
import { MODULE_ID, ROLES } from "./constants.mjs";
import {
  formationForToken,
  getFormations,
  getPartyToken,
  patchDeployments,
  updateFormation,
} from "./formation-model.mjs";
import { deployMembers, deployedTokens, isMemberDeployed, recallMembers, standsElsewhere } from "./deployment.mjs";
import { advanceRounds, storedPosition } from "./turn-engine.mjs";

/**
 * Combat integration (runs on the primary GM client): adding the party token
 * to a combat deploys the members in marching order, one combatant per body
 * on the field; a Non-combatant member stays inside the party token. Ending
 * the combat reforms the party — member tokens re-stashed, the fallen
 * gathered as Carrier cargo or left behind. Combat rounds feed the
 * round-level clock (10 rounds = 1 turn).
 */


const loc = makeLoc("ACKS-FORMATION");

/**
 * A member a combat on the party's scene leaves alone: one the party left
 * behind, or one out on a detach and standing on another scene
 * (`standsElsewhere`). The deploy does not take them over.
 */
const outOfTheFight = (formation, member, scene) =>
  !!member?.left || (!!member?.detached && standsElsewhere(formation, member, scene));

/**
 * The id of the combat that took this member over (`deployedCombatId`), or
 * null when none did. A record from before the takeover was kept reads a member
 * on the map with no detach and no leave as the party's running combat's, or,
 * with that flag lost too, as one already gone (`""`).
 */
function takeoverOf(formation, member) {
  if (!isMemberDeployed(member)) return null;
  if (member.deployedCombatId) return member.deployedCombatId;
  if (member.detached || member.left) return null;
  return formation.combat?.combatId ?? "";
}

/**
 * Does `combat`'s end gather this member? Only one a combat took over: this
 * one, or one already gone, whose end no client heard.
 */
function gatheredBy(formation, member, combat) {
  const takenBy = takeoverOf(formation, member);
  return takenBy !== null && (takenBy === combat.id || !game.combats.has(takenBy));
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

  // Already deployed (e.g. the party token was re-added): drop the extra
  // combatant rather than duplicate every member on the field. Only a member
  // a running combat took over counts; a scout ahead of the party or a member
  // left behind is on the map for reasons of their own.
  const alreadyFighting = formation.members.some((m) => {
    const takenBy = takeoverOf(formation, m);
    return !!takenBy && game.combats.has(takenBy);
  });
  if (formation.combat?.active || alreadyFighting) {
    await combatant.delete();
    return;
  }

  const scene = tokenDoc.parent;
  // Everyone who can fight goes out; non-combatants stay inside the party token.
  // A member already detached is on the map already and simply joins the fight,
  // unless they stand on another scene.
  const fighters = formation.members.filter(
    (m) => m && !m.blank && m.actorId && !m.roles?.includes(ROLES.NONCOMBATANT) && !outOfTheFight(formation, m, scene),
  );
  await deployMembers(formation, { members: fighters, combatId: combat.id });
  const onField = fighters.filter(isMemberDeployed);

  if (!onField.length) {
    await announce(formation, loc("chat.combatNoCombatants"), { whisper: true });
    return;
  }

  // A detached member is already deployed and already a token: the fight simply
  // takes them over, so combat movement is not held to the one-round leash.
  // Every member on the field is recorded as this combat's, which is what its
  // end gathers.
  for (const member of onField) {
    delete member.detached;
    delete member.detach;
    member.deployedCombatId = combat.id;
  }
  await patchDeployments(formation, onField);

  // Every body its own combatant, gathered per member and created in ONE call:
  // a stack of forty rolls forty initiatives at the cost of one document write.
  const combatants = [];
  for (const member of onField) {
    for (const token of await deployedTokens(member, scene)) {
      combatants.push({
        tokenId: token.id,
        actorId: token.actorId,
        sceneId: scene.id,
        hidden: combatant.hidden,
      });
    }
  }

  await combat.createEmbeddedDocuments("Combatant", combatants);
  await combatant.delete();

  // The party token stays only as the camp for non-combatants.
  const staysBehind = formation.members.some((m) => m.roles?.includes(ROLES.NONCOMBATANT));
  if (!staysBehind) await tokenDoc.update({ hidden: true });

  formation.combat = { combatId: combat.id, active: true, roundsCounted: 0 };
  await updateFormation(formation);
  await announce(formation, loc("chat.combatDeployed", { n: combatants.length }));
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
      // A member the combat took over is evidence of its deploy even when the
      // combat flag is missing.
      f.members.some((m) => gatheredBy(f, m, combat)),
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

  // Read while the flag still stands: an old record's takeover is read off it.
  const takenOver = formation.members.filter((m) => gatheredBy(formation, m, combat));
  formation.combat = null;
  // The fallen come back with the party: assign Carriers, or remove them from
  // the formation to abandon the body where it fell.
  const { fallen, anchor } = await recallMembers(formation, { members: takenOver });

  // Re-anchor movement tracking at the reform position before the token moves.
  if (anchor) formation.clock.lastPosition = anchor;
  // At the stored corner: a move this client is still drawing has its
  // prepared corner part way along.
  else if (partyToken) formation.clock.lastPosition = storedPosition(partyToken);
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
