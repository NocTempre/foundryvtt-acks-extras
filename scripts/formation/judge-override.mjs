/* global ui */
/**
 * The Judge's override: what it means for a GM to simply give a character
 * something — the gear appears in the pack and a hand empties to hold it,
 * never blocking. Players are still gated. See docs/formation/MODEL.md,
 * "The Judge's override".
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
 * Give a character what it takes to burn a light of `type`, and one hand
 * to hold it in. The gear list is the light table's (`lightGear`), so a
 * lantern arrives with its flask of oil and a torch arrives as a bundle.
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
