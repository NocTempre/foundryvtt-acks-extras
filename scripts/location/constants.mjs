import { MODULE_ID } from "../lib/constants.mjs";
export { MODULE_ID };
export const LANG_PREFIX = "ACKS-LOCATION";

/** The location actor sub-type this feature adds to the system. */
export const LOCATION_TYPE = `${MODULE_ID}.location`;

/** The storage tab injected into the core character sheet. */
export const STORAGE_TAB_ID = "acks-location-storage";

/**
 * The vault sweep's crash ledger: written to a character in the same update
 * that zeroes its banked coin, cleared once the coin has landed in the vault.
 */
export const FLAG_PENDING_DEPOSIT = "pendingVaultDeposit";

/**
 * `scene.flags.acks-extras.location` — the uuid of the place a scene IS.
 *
 * THE SCENE HOLDS THE LINK, and the location mirrors it in `system.sceneUuid`.
 * One direction has to be canonical or the two drift, and the scene's is: a
 * scene can be duplicated, imported and deleted by hands that never touch the
 * actor directory, so the flag travelling with the scene is what survives those.
 * The mirror exists purely so the location sheet can offer "open the map"
 * without scanning every scene in the world on each render.
 */
export const SCENE_LINK_FLAG = "location";

