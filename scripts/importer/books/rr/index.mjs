/**
 * The Revised Rulebook's contribution to the importer: what the seam
 * (`books/index.mjs`) collects. `tableRecipes` is merged after the shared table
 * recipes. A file here never imports another book's folder or
 * `table-recipes.mjs`.
 */
import { tableRecipes as formationRecipes } from "./table-recipes.mjs";
import { researchRecipes } from "./table-recipes-research.mjs";
import { throwsRecipes } from "./table-recipes-throws.mjs";

/** The formation, magic research and throws documents' recipes, each under its own document id. */
export const tableRecipes = { ...formationRecipes, ...researchRecipes, ...throwsRecipes };
