/**
 * The single global this module exposes.
 *
 * Each feature used to be its own module with its own global — `acksLib`,
 * `acksEquipment`, `acksHenchmen` and so on — and cross-feature calls went
 * through those names. One module now, so there is one global, and each feature
 * attaches itself under its own key:
 *
 *   globalThis.acksExtras?.lib        globalThis.acksExtras?.formation
 *   globalThis.acksExtras?.abilities  globalThis.acksExtras?.henchmen
 *   globalThis.acksExtras?.equipment  globalThis.acksExtras?.influence
 *   globalThis.acksExtras?.location   globalThis.acksExtras?.monsters
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

// module.api IS this namespace — one assignment for all eight features (each
// attaches under its own key on the same object, so attach timing never
// matters). This file is evaluated before any feature body (they all import
// it), so this is the first init callback registered by the module.
Hooks.once("init", () => {
  const module = game.modules.get("acks-extras");
  if (module) module.api = acksExtras;
});

/**
 * The one system boot-gate. True when the running system is acks; otherwise
 * warns with the caller's feature-specific consequence and returns false.
 * Callers keep their own control flow — most abort their ready hook, but
 * formation and influence deliberately warn and carry on.
 */
export function assertAcksSystem(consequence) {
  if (game.system?.id === "acks") return true;
  console.warn(`acks-extras | active system is not "acks"; ${consequence}`);
  return false;
}
