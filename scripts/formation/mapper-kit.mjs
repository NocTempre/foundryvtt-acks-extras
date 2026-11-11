/* global game */
import { heldEffects, holdCondition, releaseCondition } from "../lib/held-condition.mjs";
import { MODULE_ID, ROLES } from "./constants.mjs";
import { isMemberDeployed, standsAs } from "./deployment.mjs";
import { getFormations, getMemberActor, isDead, isStackMember, memberOwnToken, realMembers } from "./formation-model.mjs";
import { KIT_HELD, KIT_STASHED_FLAG, STATUS_SURPRISED, kitHeld, stashedIn, stashesNow } from "./mapper-kit-logic.mjs";

/**
 * The mapper's hands, in the world (RR ch. 6, "Marching and Mapping"): the
 * system's Vulnerable condition held on whoever holds the mapper role, and the
 * stash on the mapper's first free turn of a fight that lifts it. The verdicts
 * are `mapper-kit-logic.mjs`; this file reads the formation, the tracker and
 * the actors, and writes the held effect and the Combat's stash mark.
 */

/**
 * Is this combatant the member's body? A member out on the map is its deployed
 * token (`standsAs`); one still inside the party token is no body at all, so
 * only a linked actor's token a Judge added to the tracker stands for them.
 */
function isBody(formation, member, combatant) {
  const token = combatant?.token;
  if (isMemberDeployed(member)) return standsAs(formation, member, token);
  return !!token?.actorLink && combatant.actorId === member.actorId;
}

/** The combat whose tracker holds the member's combatant, or null: no turn can have come in any other. */
function combatOf(formation, member) {
  for (const combat of game.combats ?? []) {
    if ([...(combat.combatants ?? [])].some((c) => isBody(formation, member, c))) return combat;
  }
  return null;
}

/**
 * The actors that carry the member's condition. A linked member's is the world
 * actor; an unlinked member's is its deployed token's actor and nothing else,
 * since the world actor is the template of every token placed from it, and a
 * member whose state sits in the party's stash has no actor to hold anything.
 * A stack has no pair of hands.
 */
function carriersOf(member) {
  if (isStackMember(member)) return [];
  const own = memberOwnToken(member);
  if (own) return own.actor ? [own.actor] : [];
  const actor = getMemberActor(member);
  return actor ? [actor] : [];
}

/**
 * The effect's description: what the module did, not what the rule says.
 * Read at write time so a changed language reaches the next effect made.
 */
const describe = () => game.i18n.localize("ACKS-FORMATION.mapperVulnerable.effectDescription");

/**
 * Reconcile the held Vulnerable across every formation: each mapper-role member
 * that the verdict holds carries it, and anyone else carrying one of this
 * feature's effects (a member who set the role down, was removed, died, was left
 * behind, or an actor no formation holds any more) has it deleted. An effect
 * with no marker is never read, so a hand-set Vulnerable stands.
 *
 * @param {object[]} formations formation records
 * @returns {Promise<{held: number, released: number}>} how many carriers were written to
 */
export async function syncMapperKits(formations) {
  const keep = new Set();
  let held = 0;
  let released = 0;
  for (const formation of formations) {
    for (const member of realMembers(formation)) {
      const role = !!member.roles?.includes(ROLES.MAPPER);
      const combat = role ? combatOf(formation, member) : null;
      const verdict = kitHeld({
        role,
        dead: isDead(getMemberActor(member), member),
        left: !!member.left,
        stack: isStackMember(member),
        combat: combat ? { stashed: stashedIn(combat.getFlag(MODULE_ID, KIT_STASHED_FLAG), member.actorId) } : null,
      });
      for (const body of carriersOf(member)) {
        if (!verdict) continue;
        keep.add(body.uuid);
        if (await holdCondition(body, KIT_HELD, { description: describe() })) held += 1;
      }
    }
  }
  // Everything else that carries the marker lets go: the world's actors, and the
  // unlinked tokens standing on the scenes the formations stand on.
  const stray = [...(game.actors ?? [])];
  for (const sceneId of new Set(formations.map((f) => f.sceneId).filter(Boolean))) {
    for (const token of game.scenes.get(sceneId)?.tokens ?? []) if (!token.actorLink && token.actor) stray.push(token.actor);
  }
  for (const actor of stray) {
    if (keep.has(actor.uuid) || !heldEffects(actor, KIT_HELD).length) continue;
    if (await releaseCondition(actor, KIT_HELD)) released += 1;
  }
  return { held, released };
}

/**
 * The turn that has just come, as far as a mapper's kit goes: when the active
 * combatant is a mapper's body, the mapper is not surprised at this moment and
 * the combat has not yet marked them, the combat marks them stashed. The
 * caller reconciles after a `true`.
 *
 * @param {Combat} combat
 * @returns {Promise<boolean>} whether a mark was written
 */
export async function stashOnTurn(combat) {
  const combatant = combat?.combatant;
  if (!combatant) return false;
  const surprised = !!combatant.actor?.statuses?.has?.(STATUS_SURPRISED);
  let marked = false;
  for (const formation of Object.values(getFormations())) {
    for (const member of realMembers(formation)) {
      if (!member.roles?.includes(ROLES.MAPPER) || isStackMember(member) || !isBody(formation, member, combatant)) continue;
      const stashed = stashedIn(combat.getFlag(MODULE_ID, KIT_STASHED_FLAG), member.actorId);
      if (!stashesNow({ round: combat.round ?? 0, mine: true, surprised, stashed })) continue;
      await combat.update({ [`flags.${MODULE_ID}.${KIT_STASHED_FLAG}.${member.actorId}`]: true });
      marked = true;
    }
  }
  return marked;
}

/** Does this effect carry a status that can change who holds the kit: death, or the surprise the system lifts? */
export function kitStatusChange(effect) {
  const statuses = effect?.statuses;
  return !!(statuses?.has?.("dead") || statuses?.has?.(STATUS_SURPRISED));
}
