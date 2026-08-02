export const MODULE_ID = "acks-lib";
export const LANG_PREFIX = "ACKS-LIB";

/**
 * Namespacing (see acks-module-template docs/TOOLCHAIN.md — enforced by
 * tools/validate.mjs): identifiers in shared registries carry the module key.
 * MODULE_KEY prefixes pack document _ids (declared in module.json
 * flags.acks-lib.idPrefix); NAMESPACE prefixes globalThis exposures,
 * custom hook names, and Handlebars helpers.
 */
export const MODULE_KEY = "acksLib";
export const NAMESPACE = "acksLib";
