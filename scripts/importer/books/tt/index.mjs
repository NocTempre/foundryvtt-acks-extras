/**
 * The Treasure Tome's contribution to the importer: what the seam
 * (`books/index.mjs`) collects. `tableRecipes` is merged after the shared table
 * recipes; `magicItemLists` is the list map `magic-item-binding.mjs` places the
 * Tome's item-generation lists by. A file here never imports another book's
 * folder or `table-recipes.mjs`.
 */
import { tableRecipes } from "./table-recipes.mjs";
import { ALSO_KEYS, MAGIC_ITEM_LISTS } from "./magic-item-lists.mjs";

export { tableRecipes };

/** The Tome's list map: `{lists, alsoKeys}`. */
export const magicItemLists = Object.freeze({ lists: MAGIC_ITEM_LISTS, alsoKeys: ALSO_KEYS });
