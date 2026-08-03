/* global ui */
/**
 * The Judge's override: what it means for a GM to simply GIVE a character
 * something.
 *
 * The party sheet's gear rules exist to stop a player claiming a torch they
 * never bought or a free hand they do not have. Applied to the Judge they are
 * only in the way — a Judge who assigns the light has already decided the
 * character has one, and being told "Nolan has no torch" is being told a fact
 * they were in the middle of changing. So a GM action does not ask: the gear
 * appears in the pack and a hand is emptied to hold it.
 *
 * PLAYERS ARE STILL GATED, and that asymmetry is the whole point of the file —
 * a declaration relayed from a player carries no override, so nobody conjures a
 * lantern mid-corridor. The two paths meet in `player-requests.mjs`, which
 * passes the DECLARING user's authority rather than the executing client's (a
 * player's request runs on a GM client, so `game.user.isGM` would say yes to
 * everyone).
 *
 * The override NEVER BLOCKS. Where it cannot finish the job — the world has no
 * such item to copy, or the hands are full of lit torches that sheathing cannot
 * empty — it reports what it managed and lets the action through anyway. A Judge
 * who is overriding the rules is not looking for a smaller refusal.
 */
import { MODULE_ID, ROLE_GEAR, ROLE_HAND_COST, lightGear } from "./constants.mjs";
import { makeLoc } from "../lib/util.mjs";

const loc = makeLoc("ACKS-FORMATION");

/**
 * The equipment feature's gear API, or null.
 *
 * Reached through the shared namespace rather than an import so a load order
 * that has not built it yet, or a build without the feature, degrades to "the
 * override supplies nothing" instead of throwing inside a light mutation.
 */
function gearApi() {
  return globalThis.acksExtras?.equipment ?? null;
}

/**
 * Put `specs` in the actor's pack, leave `hands` hands free, and report what
 * that took.
 *
 * Both halves are idempotent, so calling this for a character who already has
 * the kit and a free hand does nothing at all and notifies nobody.
 *
 * @param {Actor} actor
 * @param {object[]} specs GearSpec list (see equipment/grant.mjs)
 * @param {object} [opts]
 * @param {number} [opts.hands] hands that must end up free
 * @returns {Promise<{granted: Item[], released: Item[], handsSpare: number|null}>}
 *   `handsSpare` is null when nothing could count hands.
 */
export async function supplyGear(actor, specs = [], { hands = 0 } = {}) {
  const result = { granted: [], released: [], handsSpare: null };
  const api = gearApi();
  if (!actor || !api) return result;

  try {
    result.granted = (await api.grantGear?.(actor, specs)) ?? [];
  } catch (err) {
    console.error(`${MODULE_ID} | supplying gear to ${actor.name} failed`, err);
  }

  if (hands > 0) {
    try {
      const cleared = await api.clearHands?.(actor, hands);
      if (cleared) {
        result.released = cleared.released ?? [];
        result.handsSpare = cleared.handsSpare ?? null;
      }
    } catch (err) {
      console.error(`${MODULE_ID} | freeing hands for ${actor.name} failed`, err);
    }
  }

  announce(actor, result);
  return result;
}

/** One notification per override, and none when it had nothing to do. */
function announce(actor, { granted, released }) {
  const names = (items) => items.map((i) => i.name).join(", ");
  if (granted.length) {
    ui.notifications?.info?.(loc("notice.supplied", { name: actor.name, items: names(granted) }));
  }
  if (released.length) {
    ui.notifications?.info?.(loc("notice.stowed", { name: actor.name, items: names(released) }));
  }
}

/**
 * Give a character what it takes to burn a light of `type`, and a hand to hold
 * it in. The gear list is the light table's (`lightGear`), so a lantern arrives
 * with its flask of oil and a torch arrives as a bundle.
 *
 * ONE HAND, not two: the light record the caller is about to create is what
 * occupies it — a lit source is held by definition, which is why the formation's
 * light list feeds the hand count directly rather than the source also being
 * equipped as a weapon.
 */
export async function equipForLight(actor, type) {
  return supplyGear(actor, lightGear(type), { hands: 1 });
}

/**
 * Give a character the implement a role needs, and the hands to work it with.
 * A role with no declared gear (scout, rearguard, carrier) is nothing to supply
 * and returns an empty result.
 */
export async function equipForRole(actor, role) {
  return supplyGear(actor, ROLE_GEAR[role] ?? [], { hands: ROLE_HAND_COST[role] ?? 0 });
}
