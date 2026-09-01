export const MODULE_ID = "acks-extras";
export const LANG_PREFIX = "ACKS-LIB";

/**
 * Flag key under `flags["acks-extras"]` holding the gear model (slots, worn
 * location, retrieval cost). Declared here rather than beside the DataModel
 * because the pure predicates in `item-model.mjs` read the flag without ever
 * instantiating the model, and both must name it once.
 */
export const FLAG_GEAR = "gear";

/**
 * The actor sub-types this library adds to the system. Named here, in the
 * one Foundry-free constants file, so a pure-logic module (and the Node test
 * harness that loads it) can import them without pulling in the sheets and
 * models that register them.
 */
export const ANIMAL_TYPE = `${MODULE_ID}.animal`;
export const GROUP_TYPE = `${MODULE_ID}.group`;
export const TEMPLATE_TYPE = `${MODULE_ID}.template`;
