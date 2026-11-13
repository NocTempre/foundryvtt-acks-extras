/**
 * Which reader produced an imported ability's `effects`.
 *
 * A register recipe (`fields.effects.specs`) replaces the vocabulary scan
 * outright, so an entry's origin is "recipe" exactly when it carries specs.
 */

/** "recipe" when a cookbook entry ships a register recipe for its effects, else "scan". */
export const effectsOriginOf = (entry) => (entry?.fields?.effects?.specs?.length ? "recipe" : "scan");
