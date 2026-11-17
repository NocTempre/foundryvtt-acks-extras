/**
 * Names this feature owns.
 */
import { MODULE_ID } from "../lib/constants.mjs";
export { MODULE_ID };

/** Lang root for this feature's own keys. */
export const LANG_PREFIX = "ACKS-MAGICITEMS";

/** The roller window's template. */
export const ROLLER_TEMPLATE = `modules/${MODULE_ID}/templates/magic-items/roll-dialog.hbs`;

/** The styles a roll offers: the classic chain, and the heroic and gritty rarity lists. */
export const STYLES = Object.freeze(["classic", "heroic", "gritty"]);

/**
 * The registry document the item-generation tables are read into. The importer
 * (`scripts/importer/magic-item-binding.mjs`, `MAGIC_ITEM_DOC_ID`) writes it;
 * the same id is repeated here so this feature never imports the importer, and
 * `tools/test-magic-item-roll.mjs` pins the two together.
 */
export const MAGIC_ITEM_DOC = "magicItemTables";

/** The `services` contract name the roll is offered under (docs/lib/API.md). */
export const MAGIC_ITEM_ROLL_CONTRACT = "magic-item-roll";

/** The tables the feature reads from the document, declared for the missing-tables notice. */
export const EXPECTED_TABLES = Object.freeze(["classicType", "classic", "heroic", "captions"]);
