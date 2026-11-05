/* global game */
/**
 * Storage at a place is switched on deliberately; nothing turns it on for a
 * location just because the location exists. A world can still hold locations
 * flagged to hold goods with nothing stored on them, and each one stands on the
 * storage manager's list and on every player's list of places to leave goods.
 * Once per world, at the primary GM's ready, every such location has the flag
 * removed. A location holding goods keeps it, and so do a vault, the trade
 * house and a place an actor's coin order names, which hold goods by what they
 * are or what points at them rather than by what is on them.
 * docs/location/DECISIONS.md, "Storage is switched on by intent".
 */
import { MODULE_ID, LOCATION_TYPE } from "./constants.mjs";
import { isProvider, setProvider, storedItems, vaultOwnerUuid } from "../lib/storage.mjs";
import { coinOrderOf, readStoreKey } from "../lib/money-logic.mjs";

/** The hidden world setting recording that this world's locations were cleared. */
export const STORAGE_INTENT_SETTING = "storageByIntent";

/** Register the hidden marker; `init` only. */
export function registerStorageIntentSetting() {
  game.settings.register(MODULE_ID, STORAGE_INTENT_SETTING, {
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
  });
}

/**
 * The locations whose storage the clearing turns off: a location that holds
 * goods for people, holds none, is nobody's vault, and is not one of `keep`.
 * @param {Iterable<Actor>} actors
 * @param {{keep?: Iterable<string>}} [opts] uuids of places that hold goods by what they are
 * @returns {Actor[]}
 */
export function defaultStorageOf(actors, { keep = [] } = {}) {
  const kept = new Set(keep);
  return [...actors].filter(
    (a) => a?.type === LOCATION_TYPE && isProvider(a) && !vaultOwnerUuid(a) && !kept.has(a.uuid) && !storedItems(a).length,
  );
}

/** The uuids of the places the actors' coin orders draw on or pay into. */
export function coinOrderPlaces(actors) {
  return [...actors].flatMap((a) => {
    const order = coinOrderOf(a);
    return [order.payFrom, order.receiveInto].map(readStoreKey).filter((k) => k.kind === "place").map((k) => k.uuid);
  });
}

/**
 * Turn storage off on every location `defaultStorageOf` names in the world,
 * sparing the trade house and every place a coin order names. `dryRun`
 * writes nothing.
 * @returns {Promise<{cleared: number, uuids: string[]}>}
 */
export async function clearDefaultStorage({ dryRun = false } = {}) {
  const actors = game.actors ?? [];
  const house = globalThis.acksExtras?.markets?.tradeObjects?.tradeHouseSync?.()?.uuid;
  const keep = [...(house ? [house] : []), ...coinOrderPlaces(actors)];
  const doomed = defaultStorageOf(actors, { keep });
  const uuids = doomed.map((a) => a.uuid);
  if (dryRun) return { cleared: 0, uuids };
  let cleared = 0;
  for (const actor of doomed) if (await setProvider(actor, false)) cleared++;
  return { cleared, uuids };
}

/**
 * The clearing, once per world: the marker is set after the pass, so a pass
 * that dies part-way runs again at the next ready.
 * @returns {Promise<{cleared: number, uuids: string[]}|null>} null where the world was already cleared
 */
export async function clearDefaultStorageOnce() {
  if (game.settings.get(MODULE_ID, STORAGE_INTENT_SETTING)) return null;
  const result = await clearDefaultStorage();
  await game.settings.set(MODULE_ID, STORAGE_INTENT_SETTING, true);
  if (result.cleared) console.log(`${MODULE_ID} | storage turned off on ${result.cleared} empty location(s) that held goods by default`);
  return result;
}
