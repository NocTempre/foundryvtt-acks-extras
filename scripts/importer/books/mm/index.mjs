/**
 * The Monstrous Manual's contribution to the importer: what the seam
 * (`books/index.mjs`) collects. `tableRecipes` is merged after the shared table
 * recipes. A file here never imports another book's folder or
 * `table-recipes.mjs`.
 */
import { tableRecipes } from "./table-recipes.mjs";

export { tableRecipes };
