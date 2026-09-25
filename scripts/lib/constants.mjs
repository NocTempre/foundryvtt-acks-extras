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
/** The Item sub-type a variation document is — one way an item differs from its plain self. */
export const VARIATION_TYPE = `${MODULE_ID}.variation`;

/** The prefix every custom hook this module fires is named under. */
const NAMESPACE = "acksExtras";

/**
 * Hooks the template generator fires. `RESOLVED` carries `{resolved,
 * template, type, choices}` once a generation's patches, items and flags are
 * merged and before the actor is written, so a feature may add what a
 * generated creature carries — the magic feature draws a repertoire onto a
 * slot block there — by mutating `resolved` in place.
 */
export const TEMPLATE_HOOKS = Object.freeze({
  RESOLVED: `${NAMESPACE}.templateResolved`,
});
