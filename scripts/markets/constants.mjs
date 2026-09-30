/**
 * Shared constants for the markets feature. Pure module — importable from
 * Node tooling and tests.
 */
import { MODULE_ID } from "../lib/constants.mjs";
export { MODULE_ID };

/** i18n root for this feature's keys in lang/en.json. */
export const LANG = "ACKS-MARKETS";

/**
 * Book-table document ids this feature reads, named to the GM at `ready` when
 * the tables declared for them are not all readable — so this list must match
 * the `expectTables` declarations in module.mjs, which are what the check
 * reads. The
 * `availability` doc is shared with henchmen and already announced there —
 * only ids no other feature announces belong here.
 */
export const RULEDATA = Object.freeze(["mercantile", "magicItems", "construction", "demand"]);

/** Flag scope on Item documents holding this feature's per-item state. */
export const ITEM_FLAG = "markets";

/** The Item sub-type a merchandise definition is: one good in the trade catalogue. */
export const MERCHANDISE_TYPE = `${MODULE_ID}.merchandise`;

/** The Item sub-type a market report is: what one character believes about one market's demand. */
export const REPORT_TYPE = `${MODULE_ID}.marketReport`;

/** The world setting holding the uuid of the actor that houses every trade Item. */
export const TRADE_HOUSE_SETTING = "marketsTradeHouse";

/** The actor flag a GM sets to give a character the Trade tab (`flags["acks-extras"].markets.trader`). */
export const TRADER_FLAG = "trader";

/** camelCased module id — the namespace custom hooks fire under (TOOLCHAIN §5b). */
const NAMESPACE = "acksExtras";

/** Custom hooks fired by this feature. */
export const HOOKS = Object.freeze({
  PURCHASED: `${NAMESPACE}.marketPurchased`,
  SOLD: `${NAMESPACE}.marketSold`,
  IMPORT_ORDERED: `${NAMESPACE}.marketImportOrdered`,
  IMPORT_RESOLVED: `${NAMESPACE}.marketImportResolved`,
  IDENTIFIED: `${NAMESPACE}.itemIdentified`,
});
