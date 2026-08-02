export const MODULE_ID = "acks-location";
export const LANG_PREFIX = "ACKS-LOCATION";

/**
 * Namespacing (see acks-module-template docs/TOOLCHAIN.md — enforced by
 * tools/validate.mjs): identifiers in shared registries carry the module key.
 * MODULE_KEY prefixes pack document _ids (declared in module.json
 * flags.acks-location.idPrefix); NAMESPACE prefixes globalThis exposures,
 * custom hook names, and Handlebars helpers.
 */
export const MODULE_KEY = "acksl";
export const NAMESPACE = "acksLocation";

/** The location actor sub-type this module adds to the system. */
export const LOCATION_TYPE = `${MODULE_ID}.location`;

/** The storage tab injected into the core character sheet. */
export const STORAGE_TAB_ID = "acks-location-storage";

/**
 * The vault sweep's crash ledger: written to a character in the same update
 * that zeroes its banked coin, cleared once the coin has landed in the vault.
 */
export const FLAG_PENDING_DEPOSIT = "pendingVaultDeposit";

/** acks-lib apiVersion that first carried `acksLib.storage` (lib 0.39.0). */
export const REQUIRED_LIB_API = 11;
