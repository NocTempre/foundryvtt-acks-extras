/* global game, foundry, Folder, console */
/**
 * Where a library document is WRITTEN — the shelves `library.mjs` reads.
 *
 * Three writers put documents on the library's shelves: the importer, which
 * materializes a world's books; the classes feature, whose template packages
 * are derived from an imported class; and the location feature, which
 * materializes the rules tables a world imported. The first used to own the
 * shelf entirely, and the other two wrote to the sidebar — so a Judge found
 * half of "everything imported" in a compendium and the rest loose in a
 * directory, and one ownership setting reached only the first half. Every
 * writer now opens its shelf here.
 *
 * A shelf is created on first use and filed under the line's sidebar folder
 * the moment it exists (`fileImportedPack`), so a pack made by any writer
 * sits where the others sit. Nothing is cached: the importer keeps its own
 * confirmed cache in front of this, and the two feature writers open a shelf
 * once per run.
 */
import { MODULE_ID } from "./constants.mjs";
import { libraryPackLabel, findLibraryPack } from "./library.mjs";
import { fileImportedPack } from "./compendium-folders.mjs";

/**
 * A pack can hold folders two deep and no deeper; a third level is refused
 * by Foundry, so a path is cut to what a pack accepts.
 */
const PACK_FOLDER_DEPTH = 2;

/**
 * The shelf for one type and line, created and filed when the world has none.
 * @returns {Promise<object|null>} the CompendiumCollection, or null when a
 *   pack could not be made — the caller decides what the sidebar means then.
 */
export async function ensureLibraryPack(type, line = null) {
  const found = findLibraryPack(type, line);
  if (found) return found;
  if (!game.user?.isGM) return null;
  const CC = foundry.documents?.collections?.CompendiumCollection ?? globalThis.CompendiumCollection;
  try {
    const made = await CC.createCompendium({ label: libraryPackLabel(type, line), type });
    await fileImportedPack(made.collection, line).catch((err) =>
      console.warn(`${MODULE_ID} | could not shelve the ${made.metadata.label} compendium`, err),
    );
    return made;
  } catch (err) {
    console.error(`${MODULE_ID} | could not open the ${libraryPackLabel(type, line)} compendium`, err);
    return null;
  }
}

/**
 * A folder path inside ONE shelf, made where missing — the same find-or-create
 * the importer's own tree does, without its promise cache: the feature writers
 * run one pass at a time. A path deeper than a pack allows is cut, so the
 * document lands one level up rather than nowhere.
 *
 * Folders made here carry the importer's cookbook stamp, as its own do: a
 * folder that outlives its shelf (a world upgraded from a sidebar-writing
 * release) is then still recognised by Remove Imports.
 *
 * @param {object} pack the CompendiumCollection to file inside
 * @param {string} type the document type the folders file
 * @param {string[]} names the path, root first
 * @returns {Promise<object|null>} the deepest folder made or found
 */
export async function ensureFolderIn(pack, type, names) {
  const path = (names ?? [])
    .filter(Boolean)
    .map((n) => String(n).trim())
    .filter(Boolean)
    .slice(0, PACK_FOLDER_DEPTH);
  let parent = null;
  for (const name of path) {
    const parentId = parent?.id ?? null;
    parent =
      pack.folders.find((f) => f.type === type && f.name === name && (f.folder?.id ?? null) === parentId) ??
      (await Folder.create(
        { name, type, folder: parentId, sorting: "a", flags: { [MODULE_ID]: { cookbook: { id: `folder.${type}.${name}` } } } },
        { pack: pack.collection },
      ));
  }
  return parent;
}
