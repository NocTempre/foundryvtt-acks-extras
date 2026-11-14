/**
 * The single global this module exposes.
 *
 * One global, with each feature under its own key
 * (`globalThis.acksExtras?.lib`, `?.formation`, `?.abilities`, …).
 *
 * `??=` because import order decides who arrives first and that must not
 * matter: whichever feature lands first creates the object the rest extend.
 *
 * This same object is what `game.modules.get("acks-extras").api` points at, so
 * no feature may assign its own `api`.
 */
export const acksExtras = (globalThis.acksExtras ??= {});

// module.api IS this namespace, assigned once for every feature. This file is
// evaluated before any feature body, so this is the module's first init callback.
// Optional-chained for the Node test harness, which defines no Hooks.
globalThis.Hooks?.once("init", () => {
  const module = game.modules.get("acks-extras");
  if (module) module.api = acksExtras;
});

/**
 * The one system boot-gate. True when the running system is acks; otherwise
 * warns with the caller's feature-specific consequence and returns false.
 * Callers keep their own control flow.
 */
export function assertAcksSystem(consequence) {
  if (game.system?.id === "acks") return true;
  console.warn(`acks-extras | active system is not "acks"; ${consequence}`);
  return false;
}
