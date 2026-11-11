/**
 * Whose hands are on the mapper's kit, decided from facts handed in (RR ch. 6,
 * "Marching and Mapping"). No Foundry globals and no imports: the world-reading
 * half is `mapper-kit.mjs`, and the offline suite runs this one.
 *
 * Outside a fight the mapper is vulnerable for as long as the role is held.
 * In a fight the kit comes off on the mapper's own initiative turn in the first
 * round the mapper is not surprised: that action is spent stashing it, and the
 * hands stay free for the rest of that combat. The mark that records the stash
 * lives on the Combat, keyed by the member's actor id, so the combat's end
 * takes it away and the role resumes.
 */

/** The Vulnerable effect this feature holds, found by its marker and never by name (`lib/held-condition.mjs`). */
export const KIT_HELD = Object.freeze({ holder: "mapperKit", statusId: "vulnerable", id: "heldMapperKit001" });

/** Flag key under `flags["acks-extras"]` on a Combat: member actor id → true once that member's kit is stashed. */
export const KIT_STASHED_FLAG = "kitStashed";

/** The system's status for a combatant caught unready; the system lifts it. */
export const STATUS_SURPRISED = "surprised";

/**
 * Is the mapper vulnerable now?
 *
 * @param {object} facts
 * @param {boolean} facts.role the member holds the mapper role
 * @param {boolean} [facts.dead]
 * @param {boolean} [facts.left] the party has left the member behind
 * @param {boolean} [facts.stack] the cell is a stack of bodies, not one pair of hands
 * @param {{stashed: boolean}|null} [facts.combat] the combat that holds the member's
 *   combatant, or null when none does (so no turn can have come)
 */
export function kitHeld({ role, dead = false, left = false, stack = false, combat = null }) {
  if (!role || dead || left || stack) return false;
  return !(combat && combat.stashed);
}

/**
 * Does the turn that has just come stash the kit? It does on the mapper's own
 * turn, in a started combat, while the mapper is not surprised, once.
 *
 * @param {object} facts
 * @param {number} facts.round the combat's round (0 before it starts)
 * @param {boolean} facts.mine the active combatant is the mapper's
 * @param {boolean} facts.surprised the mapper carries the surprised status at this moment
 * @param {boolean} facts.stashed the combat already marks this member
 */
export function stashesNow({ round, mine, surprised, stashed }) {
  return round >= 1 && !!mine && !surprised && !stashed;
}

/** Does the combat's stash flag mark this member? */
export function stashedIn(flag, actorId) {
  return !!(actorId && flag && flag[actorId]);
}
