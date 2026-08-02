/**
 * The single global this module exposes.
 *
 * Each feature used to be its own module with its own global — `acksLib`,
 * `acksEquipment`, `acksHenchmen` and so on — and cross-feature calls went
 * through those names. One module now, so there is one global, and each feature
 * attaches itself under its own key:
 *
 *   globalThis.acksExtras.lib        globalThis.acksExtras.formation
 *   globalThis.acksExtras.abilities  globalThis.acksExtras.henchmen
 *   globalThis.acksExtras.equipment  globalThis.acksExtras.influence
 *   globalThis.acksExtras.location   globalThis.acksExtras.monsters
 *
 * `??=` rather than `=` because import order decides who gets here first and it
 * must not matter: every feature that attaches imports this, and the first one
 * in creates the object the rest extend.
 *
 * This same object is what `game.modules.get("acks-extras").api` points at.
 * Eight features each assigning their own `api` would have left only the last
 * one visible.
 */
export const acksExtras = (globalThis.acksExtras ??= {});
