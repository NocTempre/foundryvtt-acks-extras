/**
 * Names this feature owns.
 *
 * The lang root `ACKS-MAGICITEMS` is not defined here: the feature ships no
 * string until its roller window does.
 */
import { MODULE_ID } from "../lib/constants.mjs";
export { MODULE_ID };

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
