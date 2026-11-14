/**
 * World-document creation for browse-loaded recipes.
 *
 * The text the browse pass just extracted is written into the document it
 * creates, page reference last; nothing is resolved again at render time.
 */
import { MODULE_ID } from "./constants.mjs";
import { bookText } from "./prose.mjs";

/** The folder name browse-loaded documents land under, beside the cookbook's folder. */
const FOLDER_NAME = "ACKS Extras — Browsed";

/**
 * Where a monster's description prose belongs, matching applyStats: the Full
 * Monster Sheet's appearance field, so the prose lands in one field only.
 */
function monsterDescData(html) {
  return { flags: { [MODULE_ID]: { extras: { description: { appearance: html } } } } };
}

/** The browse folder for a document type: the existing one, else a newly created one. */
export async function ensureFolder(type) {
  return (
    game.folders.find((f) => f.type === type && f.name === FOLDER_NAME) ??
    Folder.create({ name: FOLDER_NAME, type })
  );
}

/**
 * The document already loaded for a browse recipe, or null.
 *
 * A browse recipe id is derived from book, page and heading, so loading the
 * same page again asks for the same id and finds the document by it.
 */
const loadedFor = (recipe) => {
  const collection = recipe.kind === "monster" ? game.actors : game.items;
  return collection.find((d) => d.getFlag(MODULE_ID, "browsed")?.id === recipe.id) ?? null;
};

/**
 * Create — or REUSE — the world document for one recipe (dynamic browse-loads).
 * The recipe id rides on the document so a re-load finds it.
 *
 * @param prose the passage the browse pass read for this heading
 */
export async function createDocFor(recipe, prose = "") {
  const existing = loadedFor(recipe);
  if (existing) return existing;
  const html = bookText(prose ? [prose] : [], recipe.cite, { id: recipe.id, book: recipe.book, page: recipe.page });
  const flags = { [MODULE_ID]: { browsed: { id: recipe.id, cite: recipe.cite } } };
  if (recipe.kind === "monster") {
    const folder = await ensureFolder("Actor");
    // Merged at the flag-scope level: the `extras` and `browsed` keys share one
    // scope, and spreading one flags object over the other drops the second.
    const desc = monsterDescData(html);
    return Actor.create({
      name: recipe.name,
      type: "monster",
      folder: folder.id,
      ...desc,
      flags: { [MODULE_ID]: { ...flags[MODULE_ID], ...(desc.flags?.[MODULE_ID] ?? {}) } },
    });
  }
  const folder = await ensureFolder("Item");
  return Item.create({
    name: recipe.name,
    type: recipe.kind === "ability" ? "ability" : "item",
    folder: folder.id,
    flags,
    system: { description: html },
  });
}

