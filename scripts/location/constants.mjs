export const MODULE_ID = "acks-extras";
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

