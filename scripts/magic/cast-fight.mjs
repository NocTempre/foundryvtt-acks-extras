/**
 * The begun fight that holds a caster or a bearer, read from the world: the
 * scenes the creature stands on, and the fights `fightHolding` (`cast-moment.mjs`)
 * scans with them. Every cast site that asks "is this creature in a fight" asks
 * here, so they agree.
 */
import { fightHolding } from "./cast-moment.mjs";

/**
 * The ids of the scenes a creature's tokens stand on, read from the scenes'
 * documents and never from the canvas in view, so the answer does not depend on
 * which scene a seat is looking at. A given token answers with its own scene; a
 * synthetic actor with its token's; any other actor with every scene holding a
 * linked token of it. No token anywhere answers an empty list.
 *
 * @param {object} actor
 * @param {{parent?: {id?: string}}|null} [token]  the bearer's token document, where the caller knows it
 * @returns {string[]}
 */
export function casterSceneIds(actor, token = null) {
  const own = token?.parent?.id ?? token?.document?.parent?.id;
  if (own) return [String(own)];
  if (actor?.isToken || actor?.token) {
    const id = actor.token?.parent?.id;
    return id ? [String(id)] : [];
  }
  const found = new Set();
  if (!actor?.id) return [];
  for (const scene of game.scenes ?? []) {
    for (const stand of scene?.tokens ?? []) if (stand.actorLink && stand.actorId === actor.id) found.add(String(scene.id));
  }
  return [...found];
}

/**
 * The begun fight that holds this creature on a scene it stands on, with its
 * combatant in it, as `fightHolding` answers; null where none does. The viewed
 * fight is scanned first, then every other.
 *
 * @param {object} actor
 * @param {{token?: object|null}} [of]  the bearer's token document, where the caller knows it
 * @returns {{combat: object, combatant: object}|null}
 */
export function heldFight(actor, { token = null } = {}) {
  return fightHolding([game.combat, ...(game.combats ?? [])], { actor, token, scenes: casterSceneIds(actor, token) });
}
