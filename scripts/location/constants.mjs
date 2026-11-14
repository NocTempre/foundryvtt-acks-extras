import { MODULE_ID } from "../lib/constants.mjs";
export { MODULE_ID };
/** The root of this feature's lang keys. */
export const LANG_PREFIX = "ACKS-LOCATION";

/** The location actor sub-type this feature adds to the system. */
export const LOCATION_TYPE = `${MODULE_ID}.location`;

/**
 * The roles a place can carry: what a place IS to a city procedure, never what
 * it sells. A `gate` is the point of entry to the market it stands inside
 * (`gate.mjs`, RR 372). Each entry names its lang label and the Font Awesome
 * icon the sheet shows beside it.
 */
export const PLACE_ROLES = Object.freeze({
  gate: { label: `${LANG_PREFIX}.place.role.gate`, icon: "fa-archway" },
});

/** Is `value` one of the keys of {@link PLACE_ROLES}? */
export function isPlaceRole(value) {
  return typeof value === "string" && Object.hasOwn(PLACE_ROLES, value);
}

/** The storage tab injected into the core character sheet. */
export const STORAGE_TAB_ID = "acks-location-storage";

/**
 * The vault sweep's crash ledger: written to a character in the same update
 * that zeroes its banked coin, cleared once the coin has landed in the vault.
 */
export const FLAG_PENDING_DEPOSIT = "pendingVaultDeposit";

/**
 * `scene.flags.acks-extras.location` — the uuid of the place a scene IS.
 * The scene holds the link; the location mirrors it in `system.sceneUuid` so
 * its sheet need not scan every scene.
 * See docs/location/DECISIONS.md, "A location is a PLACE, and a market is an option on one (2026-08-02)".
 */
export const SCENE_LINK_FLAG = "location";

