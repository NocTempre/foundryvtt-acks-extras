/* global game */
import { makeLoc } from "../lib/util.mjs";
import { announce } from "./announce.mjs";
import { MODULE_ID, ROLES } from "./constants.mjs";
import {
  formationForToken,
  getFormation,
  getFormations,
  getPartyToken,
  patchDeployments,
  readFormations,
  updateFormation,
} from "./formation-model.mjs";
import {
  deployMembers,
  deployedTokens,
  isMemberDeployed,
  recallMembers,
  standsAs,
  standsElsewhere,
} from "./deployment.mjs";
import { advanceRounds, storedPosition } from "./turn-engine.mjs";

/**
 * Combat integration (runs on the primary GM client): adding the party token
 * to a combat deploys the members in marching order, one combatant per body
 * on the field; a Non-combatant member stays inside the party token. Ending
 * the combat reforms the party — member tokens re-stashed, the fallen
 * gathered as Carrier cargo or left behind. A fight no combat in the world
 * still holds a body of is over too, and the party's next drag or deploy
 * reforms it (`reformIfOver`). Combat rounds feed the round-level clock
 * (10 rounds = 1 turn).
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

/** Does `combat`'s end reform this party: its flag names it, or it took a member over. */
const endsFor = (combat) => (f) =>
  (f.combat?.active && f.combat.combatId === combat.id) ||
  // A member the combat took over is evidence of its deploy even when the
  // combat flag is missing.
  f.members.some((m) => gatheredBy(f, m, combat));

/**
 * The combats the record ties the party to: the one its flag names, and every
 * one that took a member over. An old record's takeover with no combat to name
 * (`""`) ties nothing.
 */
function partyCombats(formation) {
  const ids = new Set();
  if (formation.combat?.active && formation.combat.combatId) ids.add(formation.combat.combatId);
  for (const member of formation.members ?? []) {
    const id = takeoverOf(formation, member);
    if (id) ids.add(id);
  }
  return ids;
}

/**
 * The combat the party is fighting in, or null: any combat in the world, not
 * only the record's, holding a combatant whose token is a body of a member a
 * combat took over. The party token's own combatant is no member's body, and a
 * scout or a member left behind whose token the Judge adds keeps no fight.
 */
function fightingIn(formation) {
  const taken = formation.members.filter((m) => takeoverOf(formation, m) !== null);
  if (!taken.length) return null;
  for (const combat of game.combats ?? []) {
    for (const combatant of combat.combatants ?? []) {
      const token = combatant.token;
      if (token && taken.some((m) => standsAs(formation, m, token))) return combat;
    }
  }
  return null;
}

/** The turn each formation's combat work is in, so the next waits for it. */
const combatQueues = new Map();

/**
 * Run `work` once the formation's earlier combat work has settled: a deploy, a
 * heard end and a heal each read the record fresh and finish before the next
 * starts. A deploy records its takeover before its combatants exist, which a
 * heal running beside it reads as a fight already over; two reforms of one
 * party recall the same bodies. Not reentrant: work already in the turn calls
 * `healIfOver`, never `reformIfOver`. Resolves with `work`'s answer; work that
 * throws rejects without holding the next.
 */
function oneAtATime(formationId, work) {
  const prior = combatQueues.get(formationId) ?? Promise.resolve();
  const next = prior.then(work);
  const settled = next.then(() => undefined, () => undefined);
  combatQueues.set(formationId, settled);
  settled.then(() => {
    if (combatQueues.get(formationId) === settled) combatQueues.delete(formationId);
  });
  return next;
}

/**
 * Reform a party tied to a fight it is no longer fighting in, as that combat's
 * end would have. The combat is the flag's when it names one, else any that
 * took a member over; one no longer in the world is passed as `{id}`.
 * @returns {Promise<boolean>} whether it reformed
 */
async function healIfOver(formation, { inPlace = false } = {}) {
  const ids = partyCombats(formation);
  if (!ids.size || fightingIn(formation)) return false;
  const id = formation.combat?.active && formation.combat.combatId ? formation.combat.combatId : ids.values().next().value;
  await reform(formation, game.combats.get(id) ?? { id }, { inPlace });
  return true;
}

/**
 * Reform the party now if the fight it is tied to is over: every combat that
 * took it over emptied of its bodies, or gone from the world unheard. Null at
 * once, with nothing awaited, for a party tied to no fight; otherwise resolves
 * with whether it reformed. `inPlace` leaves the party token where it stands
 * and the clock's baseline where it was, for a move about to be spent.
 * @param {string} formationId
 * @param {{inPlace?: boolean}} [options]
 * @returns {Promise<boolean>|null}
 */
export function reformIfOver(formationId, options) {
  const stored = readFormations()[formationId];
  if (!stored || !partyCombats(stored).size) return null;
  return oneAtATime(formationId, async () => {
    const formation = getFormation(formationId);
    return formation ? healIfOver(formation, options) : false;
  });
}

/**
 * What the GM calls `combat`: its name, else its place among the encounters on
 * the party's scene, in the order core lists them, else the scene it is on.
 */
function encounterLabel(combat, scene) {
  if (combat.name) return combat.name;
  const sceneOf = (c) => c.scene?.id ?? c.scene ?? null;
  const here = [...(game.combats ?? [])]
    .filter((c) => !sceneOf(c) || sceneOf(c) === scene?.id)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.id).localeCompare(String(b.id)));
  const n = here.indexOf(combat) + 1;
  return n ? loc("chat.combatEncounterN", { n }) : loc("chat.combatEncounterOn", { scene: scene?.name ?? "" });
}

/* -------------------------------------------- */
/*  Deploy on joining combat                    */
/* -------------------------------------------- */

/** Handle a new combatant: if it is a party token, deploy the members instead. */
export async function onPartyCombatantCreated(combatant) {
  const tokenDoc = combatant.token;
  const formationId = tokenDoc ? formationForToken(tokenDoc)?.id : null;
  if (!formationId) return;
  await oneAtATime(formationId, () => deployFor(combatant, tokenDoc, formationId));
}

/** The deploy itself, in the formation's turn and on a fresh read of its record. */
async function deployFor(combatant, tokenDoc, formationId) {
  let formation = getFormation(formationId);
  if (!formation) return;
  const combat = combatant.parent;

  // Already fighting (e.g. the party token was re-added): drop the extra
  // combatant rather than duplicate every member on the field, and say where
  // the fight is.
  const running = fightingIn(formation);
  if (running) {
    await combatant.delete();
    const encounter = encounterLabel(running, tokenDoc.parent);
    await announce(formation, loc("chat.combatAlreadyFighting", { encounter }), { whisper: true });
    return;
  }
  // A fight no combat still holds is over: reform as its end would have, then
  // deploy afresh.
  if (await healIfOver(formation)) {
    formation = getFormation(formationId);
    if (!formation) return;
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

  // A combat already under way has spent its rounds before the party joined.
  formation.combat = { combatId: combat.id, active: true, roundsCounted: combat.round ?? 0 };
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

/**
 * When a combat is deleted, reform every formation that deployed into it,
 * each in its formation's turn and on a fresh read.
 */
export async function onCombatEnd(combat) {
  const ids = Object.values(getFormations()).filter(endsFor(combat)).map((f) => f.id);
  for (const id of ids) {
    await oneAtATime(id, async () => {
      const formation = getFormation(id);
      if (!formation || !endsFor(combat)(formation)) return;
      try {
        await reform(formation, combat);
      } catch (err) {
        console.error(`${MODULE_ID} | failed to reform ${formation.name}`, err);
      }
    });
  }
}

/**
 * Gather the members `combat` took over and stand the party up again.
 * `combat` is the Combat, or `{id}` for one no longer in the world. `inPlace`
 * leaves the party token and the clock's baseline where they are; otherwise
 * both go where the first gathered body stood.
 */
async function reform(formation, combat, { inPlace = false } = {}) {
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
  // In place, the move being spent measures from the baseline as it stands.
  if (!inPlace) {
    if (anchor) formation.clock.lastPosition = anchor;
    // At the stored corner: a move this client is still drawing has its
    // prepared corner part way along.
    else if (partyToken) formation.clock.lastPosition = storedPosition(partyToken);
  }
  await updateFormation(formation);

  if (partyToken) {
    const update = { hidden: false };
    if (anchor && !inPlace) Object.assign(update, anchor);
    await partyToken.update(update);
  }

  await announce(formation, loc("chat.combatReformed", { rounds }));
  if (fallen.length) {
    await announce(formation, loc("chat.combatFallen", { names: fallen.join(", ") }));
  }
  if (rounds > 0) await advanceRounds(formation, rounds, { reason: "combat" });
}
