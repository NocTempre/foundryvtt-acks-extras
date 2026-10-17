/**
 * The domains feature's vocabulary: the actor sub-type, the classifications a
 * domain can hold, the roles a held place plays, and the revenue and expense
 * lines a domain's month is reckoned in. Every key is the module's own; what
 * each line is worth is printed, and arrives through the importer or the
 * Judge's word.
 */
import { MODULE_ID } from "../lib/constants.mjs";
import { TERRITORY_KEYS } from "../formation/country-keys.mjs";
export { MODULE_ID };

/** Lang root for this feature's own keys. */
export const LANG_PREFIX = "ACKS-DOMAINS";

/** The domain actor sub-type this feature adds to the system. */
export const DOMAIN_TYPE = `${MODULE_ID}.domain`;

/**
 * What a domain can be classified as: the country keys a journey reads, less
 * the one no domain stands in. Blank on a domain means not yet classified.
 */
export const CLASSIFICATIONS = Object.freeze(TERRITORY_KEYS.filter((k) => k !== "unsettled"));

/** What a held place is to the domain. */
export const HOLDING_ROLES = Object.freeze(["settlement", "stronghold", "other"]);

/** The revenue lines a domain reckons by family. Tribute in is summed from the vassals and is not one. */
export const REVENUE_LINES = Object.freeze(["land", "service", "tax", "trade"]);

/** The expense lines a domain reckons by family. Tribute out is its own figure and is not one. */
export const EXPENSE_LINES = Object.freeze(["garrison", "liturgy", "upkeep", "tithe"]);

/** The four figures and the note every revenue and expense line carries. */
export const LINE_FIELDS = Object.freeze(["peasantPer", "urbanPer", "peasantGp", "urbanGp"]);
