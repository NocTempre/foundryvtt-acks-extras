/* global game */
/**
 * The point of entry to a market.
 *
 * A place carrying the `gate` role (`PLACE_ROLES`) is the point of entry to the
 * market it stands inside: the nearest ancestor, by `system.parentUuid`, whose
 * `system.hasMarket` is true. The place itself never counts, so a gate that has
 * a market of its own still answers to the one above it. `reach.mjs` reads
 * `gatesByMarket` to let standing at a gate stand for standing at its market.
 *
 * Both readers take the place index (`lib/place.mjs` `placeIndex`, uuid to node)
 * and read the ancestors' documents through `resolvePlaceSync`, since a node
 * carries no market flag. The walk is `ancestorUuids`, so a parent loop ends it.
 */
import { LOCATION_TYPE } from "./constants.mjs";
import { ancestorUuids, placeIndex, resolvePlaceSync } from "../lib/place.mjs";

/** The `system.role` value that marks a gate. A key of `PLACE_ROLES`. */
export const GATE_ROLE = "gate";

/** Is this actor a location carrying the gate role? */
export const isGate = (actor) => actor?.type === LOCATION_TYPE && actor.system?.role === GATE_ROLE;

/**
 * The market a gate is the point of entry to: the nearest ancestor of `place`
 * with a market, or null when none above it has one.
 *
 * @param {object} place the gate's actor
 * @param {Map<string, object>} index uuid to place node (`placeIndex`)
 * @returns {object|null} the market's actor
 */
export function gateMarketOf(place, index) {
  if (!place?.uuid) return null;
  for (const uuid of ancestorUuids(place.uuid, index)) {
    const ancestor = resolvePlaceSync(uuid);
    if (ancestor?.system?.hasMarket) return ancestor;
  }
  return null;
}

/**
 * Every gate in the world, filed under the market it opens onto: market uuid to
 * the gate actors. A gate with no market above it is in no list.
 *
 * The index is built only when the world holds a gate, so a world without one
 * pays for a scan of its actors and nothing more.
 *
 * @param {Map<string, object>} [index] uuid to place node; built when omitted
 * @returns {Map<string, object[]>}
 */
export function gatesByMarket(index) {
  const out = new Map();
  let nodes = index;
  for (const actor of game.actors ?? []) {
    if (!isGate(actor)) continue;
    nodes ??= placeIndex();
    const market = gateMarketOf(actor, nodes);
    if (!market) continue;
    const list = out.get(market.uuid);
    if (list) list.push(actor);
    else out.set(market.uuid, [actor]);
  }
  return out;
}
