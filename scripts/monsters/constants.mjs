/**
 * Static identifiers for the ACKS II Full Monster Sheet module.
 *
 * Kept free of any `foundry` references so this file (and config.mjs, which it
 * pairs with) can be imported by the Node build tooling as well as at runtime.
 */

export const MODULE_ID = "acks-monsters";

/** Localization key prefix. */
export const LANG = "ACKS-MONSTERS";

/** The core ACKS actor type this module enhances (we do NOT invent a new one). */
export const MONSTER_TYPE = "monster";

/** Flag scope + the single object holding all extended stat-block data. */
export const FLAG_EXTRAS = "extras";

/**
 * `system._schemaVersion` written into sample documents so the acks system's
 * migration runner treats them as current. Keep in sync with the system's
 * CURRENT_SCHEMA_VERSION (migration/migration.mjs).
 */
export const ACKS_SCHEMA_VERSION = 3;
