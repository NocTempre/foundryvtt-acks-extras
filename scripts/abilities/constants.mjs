export const MODULE_ID = "acks-abilities";
export const LANG_PREFIX = "ACKS-ABILITIES";

/**
 * Namespacing (see acks-module-template docs/TOOLCHAIN.md — enforced by
 * tools/validate.mjs): identifiers in shared registries carry the module key.
 * MODULE_KEY prefixes pack document _ids (declared in module.json
 * flags.acks-abilities.idPrefix); NAMESPACE prefixes globalThis exposures,
 * custom hook names, and Handlebars helpers.
 */
export const MODULE_KEY = "acksAbil";
export const NAMESPACE = "acksAbilities";

/** The core `ability` item type this module extends (proficiencies/powers/skills). */
export const ABILITY_TYPE = "ability";
/** Flag key under flags["acks-abilities"] holding the extended effect model. */
export const FLAG_EXTRAS = "extras";
