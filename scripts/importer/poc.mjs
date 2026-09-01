/**
 * World-document creation for browse-loaded recipes.
 *
 * The text the browse pass just extracted is written into the document it
 * creates, page reference last; nothing is resolved again at render time.
 */
/**
 * Where browse-loaded documents land, beside the cookbook's "ACKS Cookbook".
 * Named for the module the reader installed, never for a development phase —
 * a folder in someone's world is a shipped surface.
 */
import { MODULE_ID } from "./constants.mjs";
import { bookText } from "./prose.mjs";

const FOLDER_NAME = "ACKS Extras — Browsed";

/**
 * Where a monster's description prose belongs, matching applyStats:
 * the Full Monster Sheet's visible APPEARANCE field, which enriches its own
 * description fields. Kept in one place so a monster never ends up with the
 * prose in BOTH fields.
 */
function monsterDescData(html) {
  return { flags: { [MODULE_ID]: { extras: { description: { appearance: html } } } } };
}

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
 * same page a second time asks for the same id — and without this the reader
 * got a second copy of everything they had already loaded, with nothing on
 * either document saying which was which.
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
  const html = bookText(prose ? [prose] : [], recipe.cite, { id: recipe.id });
  const flags = { [MODULE_ID]: { browsed: { id: recipe.id, cite: recipe.cite } } };
  if (recipe.kind === "monster") {
    const folder = await ensureFolder("Actor");
    // MERGED at the flag-scope level, not spread over: monsterDescData's
    // extras and this function's own browsed-recipe id share one flag scope,
    // so spreading one flags object over the other would drop whichever key
    // — browsed or extras — lands second.
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

