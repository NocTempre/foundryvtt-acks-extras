/* global game, ui, foundry, Folder */
/**
 * Where every compendium sits in the sidebar.
 *
 * Foundry files a package's packs from its manifest `packFolders`, and does it
 * ONCE. Three rules, each reasonable alone: the initializer runs only when the
 * world's pack set changes; it matches a folder by its hierarchy NAME, so two
 * packages naming the same folder share it; and it skips any pack whose
 * `core.compendiumConfiguration` entry already names a folder. What they add up
 * to is a library that drifts and cannot right itself — a folder deleted years
 * ago leaves every pack that named it stranded at the root permanently, because
 * the slot is full of a dead id.
 *
 * This file answers that in two strengths, and the difference between them is
 * the whole design:
 *
 *  - `organizeCompendiumFolders()` runs at `ready` and only FILLS. A pack with
 *    no folder, or one naming a folder that no longer exists, is filed where
 *    its own package's manifest says it goes. A reference that resolves is a
 *    Judge's arrangement and is never touched.
 *  - `restoreCompendiumLibrary()` is the macro, and it OVERRULES. Every ACKS
 *    pack goes back to its declared place and its per-pack configuration is
 *    reset to the package's defaults. Overwriting a Judge's arrangement is what
 *    "restore" means, which is why nothing calls it but a GM who asked for it.
 *
 * THE SYSTEM'S TREE IS THE SYSTEM'S. Both strengths read the SYSTEM's own
 * declaration for the system's packs and this module's for this module's;
 * neither states a folder name belonging to the other. The declaration is read
 * live from `game.system.packFolders`, so a system release that re-shelves its
 * own compendiums re-shelves them here too, with nothing here to update.
 */
import { MODULE_ID } from "./constants.mjs";
import { importedPacks } from "./library.mjs";

/**
 * The sub-folder the importer's world packs are shelved under, inside this
 * module's own declared folder.
 *
 * A LITERAL rather than a lang key, exactly like the names in a manifest's
 * `packFolders`: a compendium folder is world state matched by NAME, so a
 * translated one would mint a second folder the day a Judge changes language
 * and leave the library split across both.
 */
const IMPORT_FOLDER = "From your books";

/* -------------------------------------------- */
/*  Reading the declarations                     */
/* -------------------------------------------- */

/** The packages whose declared trees this module maintains. */
const declaringPackages = () => [game.system, game.modules?.get(MODULE_ID)].filter(Boolean);

/** This module's declared top-level folder — the root everything hangs off. */
const declaredRoot = () => [...(game.modules?.get(MODULE_ID)?.packFolders ?? [])][0] ?? null;

/** A pack this world actually has, by the package that ships it and its name. */
const livePack = (packageId, name) =>
  game.packs?.find((p) => p.metadata.packageName === packageId && p.metadata.name === name) ?? null;

/**
 * Does this declared node, or anything under it, name a pack this world has?
 *
 * The pruning test. A manifest may declare a shelf for content the package has
 * not shipped yet — the system declares five and two of them stand empty — and
 * Foundry's own initializer prunes those rather than leaving bare folders in
 * the sidebar. So does this.
 */
const declaresLivePack = (packageId, node) =>
  [...(node?.packs ?? [])].some((name) => livePack(packageId, name)) ||
  [...(node?.folders ?? [])].some((child) => declaresLivePack(packageId, child));

/* -------------------------------------------- */
/*  Planning                                     */
/* -------------------------------------------- */

/**
 * Walk a declared subtree and answer, for each of its packs, the FOLDER PATH it
 * belongs at — root first, leaf last. Nothing is created here.
 *
 * Planning before building is what keeps the sidebar from growing a second,
 * empty copy of the whole tree at every load: the gentle pass leaves most packs
 * exactly where they are, and a walk that made folders as it went would build
 * the shelf and then decline to move anything into it. A folder comes into
 * existence only where a pack is actually being written to it.
 */
function walkDeclared(packageId, nodes, prefix, targets) {
  for (const node of nodes ?? []) {
    if (!declaresLivePack(packageId, node)) continue;
    const path = [
      ...prefix,
      { name: node.name, color: node.color ? String(node.color) : null, sorting: node.sorting ?? "m" },
    ];
    for (const name of node.packs ?? []) {
      const pack = livePack(packageId, name);
      if (pack) targets.set(pack.collection, path);
    }
    walkDeclared(packageId, node.folders, path, targets);
  }
}

/**
 * Where an imported pack belongs: this module's own declared folder, then "From
 * your books", then — only for a pack holding another game's line — a folder
 * named after that line.
 *
 * The ACKS library carries no line in its pack label and gets none in the
 * sidebar either; it is the default shelf. A LINE's folder is only described
 * here and is built by the first pack that needs it, so a world that never
 * imported Dolmenwood has no Dolmenwood shelf standing empty, and one that
 * imports it tomorrow gets the shelf together with the pack.
 */
function importPath(line, root) {
  const path = [
    { name: root.name, color: root.color ? String(root.color) : null, sorting: root.sorting ?? "m" },
    { name: IMPORT_FOLDER, color: null, sorting: "a" },
  ];
  return line ? [...path, { name: line, color: null, sorting: "a" }] : path;
}

/**
 * Every placement this module maintains: pack collection id → folder path.
 *
 * Reading the declarations creates nothing, so both strengths plan alike and
 * differ only in what they then write.
 */
function plan() {
  const targets = new Map();
  for (const pkg of declaringPackages()) walkDeclared(pkg.id, [...(pkg.packFolders ?? [])], [], targets);
  const root = declaredRoot();
  // No declared root means no manifest to hang the imported shelf off, and
  // inventing one here would be this file stating a folder name the manifest
  // owns.
  if (root) for (const { pack, line } of importedPacks()) targets.set(pack.collection, importPath(line, root));
  return targets;
}

/* -------------------------------------------- */
/*  Building and writing                         */
/* -------------------------------------------- */

/**
 * A Compendium folder of this name under this parent, made if it is missing.
 *
 * Matched by name WITHIN ITS PARENT, which is how Foundry's initializer
 * matches: two packages declaring "Equipment" under different books get a
 * folder each, and two declaring it under the same book share one.
 */
async function ensureFolder(name, parentId, { color = null, sorting = "m" } = {}) {
  const found = game.folders?.find(
    (f) => f.type === "Compendium" && f.name === name && (f.folder?.id ?? null) === parentId,
  );
  if (found) return found;
  return Folder.create({ name, type: "Compendium", folder: parentId, color, sorting }).catch((err) => {
    console.error(`${MODULE_ID} | could not create the "${name}" compendium folder`, err);
    return null;
  });
}

/** Build a planned path, creating only what is missing. Answers the leaf id. */
async function materialize(path) {
  let parent = null;
  for (const spec of path) {
    const folder = await ensureFolder(spec.name, parent, spec);
    if (!folder) return null;
    parent = folder.id;
  }
  return parent;
}

/**
 * Does this pack's entry need writing, given the strength of the pass?
 *
 * The gentle pass claims only an EMPTY or DANGLING slot — a folder reference
 * that resolves is a Judge's arrangement, honoured. A restore claims every
 * slot, because dropping the per-pack overrides is half of what it does.
 */
const needsWrite = (entry, reset) =>
  reset || !entry.folder || !game.folders.get(entry.folder);

/**
 * Write the folder assignments and answer what changed.
 *
 * `reset` is the difference between the two strengths. A restore rewrites each
 * entry down to `{folder}` alone, dropping every per-pack override a world
 * accumulated — a custom sort, a lock, an ownership grant — back to the
 * package's own defaults. Clearing `locked` is not the same as unlocking it:
 * with no entry Foundry reads a package's pack as locked and a world pack as
 * writable, which is what each of them is for, and the importer needs its own
 * packs writable to refill them.
 */
async function filePacks(targets, { reset }) {
  const config = foundry.utils.deepClone(game.settings.get("core", "compendiumConfiguration") ?? {});
  const vacated = new Set();
  const built = new Map();
  let moved = 0;
  let folders = 0;
  const countFolders = () => game.folders.filter((f) => f.type === "Compendium").length;
  for (const [collection, path] of targets) {
    const entry = config[collection] ?? {};
    if (!needsWrite(entry, reset)) continue;
    const key = path.map((p) => p.name).join(" ");
    if (!built.has(key)) {
      const before = countFolders();
      built.set(key, await materialize(path));
      folders += countFolders() - before;
    }
    const folderId = built.get(key);
    if (!folderId) continue;
    const current = entry.folder ?? null;
    if (current === folderId && (!reset || Object.keys(entry).length === 1)) continue;
    if (current && current !== folderId) vacated.add(current);
    config[collection] = reset ? { folder: folderId } : { ...entry, folder: folderId };
    moved++;
  }
  if (moved) {
    await game.settings.set("core", "compendiumConfiguration", config);
    ui.compendium?.render();
  }
  return { moved, folders, vacated };
}

/**
 * Remove the folders this pass emptied, and the ancestors they emptied in turn.
 *
 * Only ones it emptied: a folder goes when it has just lost a pack, holds no
 * other pack and no sub-folder. That is narrow on purpose — an empty folder a
 * Judge made for their own use is not ours to tidy.
 *
 * The ancestor walk is what makes a rename come out clean rather than doubled.
 * Renaming a shelf moves the packs to new folders and leaves the old tree
 * standing: the line folder is empty, its parent holds only that empty folder,
 * and its parent only THAT — so a sweep looking no further than the folder a
 * pack left would delete the leaf and leave two empty shelves above it. Passes
 * repeat until one changes nothing, which collapses the chain from the bottom
 * without needing to know how deep it went.
 */
async function sweepVacated(vacated, { withinOwnTree = false } = {}) {
  const candidates = new Set();
  for (const id of vacated) {
    for (let f = game.folders.get(id); f?.type === "Compendium"; f = f.folder) candidates.add(f.id);
  }
  // A restore also collapses the empty shelves inside THIS MODULE'S OWN tree,
  // which no pack ever vacated: deleting an imported pack leaves its line's
  // folder standing, and nothing else would ever take it down. Scoped to our
  // own root and to folders that end up holding nothing, so a Judge's shelf
  // elsewhere is never a candidate however empty it is.
  const root = withinOwnTree ? declaredRoot() : null;
  const ownRoot = root
    ? game.folders?.find((f) => f.type === "Compendium" && f.name === root.name && !f.folder)
    : null;
  if (ownRoot) {
    for (const f of game.folders.filter((f) => f.type === "Compendium")) {
      for (let a = f.folder; a; a = a.folder) if (a.id === ownRoot.id) candidates.add(f.id);
    }
  }
  let removed = 0;
  let changed = true;
  const orphaned = new Set();
  while (changed) {
    changed = false;
    const config = game.settings.get("core", "compendiumConfiguration") ?? {};
    for (const id of [...candidates]) {
      const folder = game.folders.get(id);
      if (!folder || folder.type !== "Compendium") {
        candidates.delete(id);
        continue;
      }
      if (game.folders.some((f) => f.type === "Compendium" && f.folder?.id === id)) continue;
      // A configuration entry only holds a folder open while its PACK still
      // exists. A world keeps the entry of every pack it has ever had — a
      // module uninstalled, a pack this release stopped shipping — and those
      // dead entries would otherwise pin an empty shelf open forever, which is
      // precisely the state this whole file exists to end. They are dropped
      // along with the folder they named: they point at nothing either way, and
      // an empty slot is what lets Foundry re-file the pack if it ever returns.
      if (Object.entries(config).some(([c, entry]) => entry?.folder === id && game.packs.get(c))) continue;
      if (await folder.delete().then(() => true).catch(() => false)) {
        for (const [c, entry] of Object.entries(config)) if (entry?.folder === id) orphaned.add(c);
        candidates.delete(id);
        removed++;
        changed = true;
      }
    }
  }
  if (orphaned.size) {
    const config = foundry.utils.deepClone(game.settings.get("core", "compendiumConfiguration") ?? {});
    for (const c of orphaned) delete config[c];
    await game.settings.set("core", "compendiumConfiguration", config);
  }
  return removed;
}

/* -------------------------------------------- */
/*  The two strengths                            */
/* -------------------------------------------- */

/**
 * The `ready` pass: file what is unfiled, repair what dangles, leave the rest.
 *
 * @returns {Promise<number>} how many packs were filed.
 */
export async function organizeCompendiumFolders() {
  if (!game.user?.isGM) return 0;
  const { moved } = await filePacks(plan(), { reset: false });
  return moved;
}

/**
 * The macro: put the whole ACKS library back where it belongs.
 *
 * Rebuilds the system's declared tree and this module's, re-files every pack of
 * both into it, shelves the importer's world packs under this module's folder,
 * resets each pack's configuration to its package's defaults, and removes the
 * folders that fall empty in the process.
 *
 * @param {object} [options]
 * @param {boolean} [options.confirm] show the GM what will change and ask first
 * @returns {Promise<{packs:number, folders:number, removed:number}|null>} null
 *   if the GM declined, or is not a GM.
 */
export async function restoreCompendiumLibrary({ confirm = true } = {}) {
  if (!game.user?.isGM) {
    ui.notifications?.warn(game.i18n.localize("ACKS-LIB.library.gmOnly"));
    return null;
  }
  const targets = plan();
  if (confirm) {
    const shelves = new Set([...targets.values()].map((path) => path.map((p) => p.name).join(" / ")));
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("ACKS-LIB.library.restoreTitle") },
      classes: ["acks-extras"],
      content:
        `<p>${game.i18n.format("ACKS-LIB.library.restoreBody", { packs: targets.size, folders: shelves.size })}</p>` +
        `<p>${game.i18n.localize("ACKS-LIB.library.restoreCost")}</p>`,
      yes: { label: game.i18n.localize("ACKS-LIB.library.restoreGo") },
      no: { label: game.i18n.localize("ACKS-LIB.library.restoreCancel"), default: true },
      rejectClose: false,
    });
    if (!ok) return null;
  }
  const { moved, folders, vacated } = await filePacks(targets, { reset: true });
  const removed = await sweepVacated(vacated, { withinOwnTree: true });
  ui.notifications?.info(game.i18n.format("ACKS-LIB.library.restoreDone", { packs: moved, folders, removed }));
  return { packs: moved, folders, removed };
}

/**
 * File a pack the importer has just minted, without disturbing anything else.
 *
 * Called from the importer's own `packFor` at the moment of creation: a pack
 * made through `CompendiumCollection.createCompendium` carries no folder at all
 * and lands loose at the sidebar root, which is where every imported library
 * sat before this. The `line` is the one the label was built from, so the shelf
 * and the label can never disagree about which books a pack holds.
 */
export async function fileImportedPack(collection, line = null) {
  if (!game.user?.isGM) return false;
  const root = declaredRoot();
  if (!root) return false;
  const { moved } = await filePacks(new Map([[collection, importPath(line, root)]]), { reset: false });
  return moved > 0;
}
