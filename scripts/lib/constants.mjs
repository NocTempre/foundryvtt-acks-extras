/** This module's id, the key of its flag scope and the prefix of its sub-types. */
export const MODULE_ID = "acks-extras";

/** The root of the lib subsystem's lang keys. */
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

/** The actor sub-type of a group, a stack of creatures kept on one actor. */
export const GROUP_TYPE = `${MODULE_ID}.group`;

/** The actor sub-type of a template, the generator that stamps out creatures. */
export const TEMPLATE_TYPE = `${MODULE_ID}.template`;

/** The lang root of the group actor's strings. */
export const GROUP_LANG_PREFIX = `${LANG_PREFIX}.group`;
/** The lang root of a lair's strings. */
export const LAIR_LANG_PREFIX = `${LANG_PREFIX}.lair`;
/** The Item sub-type a variation document is — one way an item differs from its plain self. */
export const VARIATION_TYPE = `${MODULE_ID}.variation`;

/**
 * The token create option that keeps the hit points the token's data carries
 * over the roll the system gives an unlinked monster token as it is created
 * (hp-logic.mjs, `keepsOwnHitPoints`). A caller making a token for a creature
 * it already holds passes it.
 */
export const KEEP_HIT_POINTS_OPTION = `${MODULE_ID}.keepHitPoints`;

/**
 * Seconds in one dungeon turn, the module's own unit of game time. An ACKS
 * `turns` duration is this many seconds on the world clock, never a Foundry
 * combat turn.
 */
export const TURN_SECONDS = 600;

/** Combat rounds per dungeon turn for time-keeping (RR p. 263). */
export const ROUNDS_PER_TURN = 10;

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
