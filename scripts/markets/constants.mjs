/**
 * Shared constants for the markets feature. Pure module — importable from
 * Node tooling and tests.
 */
export const MODULE_ID = "acks-extras";

/** i18n root for this feature's keys in lang/en.json. */
export const LANG = "ACKS-MARKETS";

/**
 * Book-table document ids this feature reads, named to the GM at `ready`
 * when absent (matches the `expectTables` declarations in module.mjs). The
 * `availability` doc is shared with henchmen and already announced there —
 * only ids no other feature announces belong here.
 */
export const RULEDATA = Object.freeze(["mercantile", "magicItems"]);

/** Flag scope on Item documents holding this feature's per-item state. */
export const ITEM_FLAG = "markets";

/** camelCased module id — the namespace custom hooks fire under (TOOLCHAIN §5b). */
const NAMESPACE = MODULE_ID.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase()); // "acksExtras"

/** Custom hooks fired by this feature. */
export const HOOKS = Object.freeze({
  PURCHASED: `${NAMESPACE}.marketPurchased`,
  SOLD: `${NAMESPACE}.marketSold`,
  IMPORT_ORDERED: `${NAMESPACE}.marketImportOrdered`,
  IMPORT_RESOLVED: `${NAMESPACE}.marketImportResolved`,
  IDENTIFIED: `${NAMESPACE}.itemIdentified`,
});
