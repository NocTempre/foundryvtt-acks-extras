export const MODULE_ID = "acks-extras";
export const LANG_PREFIX = "ACKS-LIB";

/**
 * Flag key under `flags["acks-extras"]` holding the gear model (slots, worn
 * location, retrieval cost). Declared here rather than beside the DataModel
 * because the pure predicates in `item-model.mjs` read the flag without ever
 * instantiating the model, and both must name it once.
 */
export const FLAG_GEAR = "gear";
