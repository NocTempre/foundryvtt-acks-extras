/* global game, ui, foundry, Folder */
/**
 * Where every compendium sits in the sidebar, in two strengths —
 * `organizeCompendiumFolders()` (fills only) and `restoreCompendiumLibrary()`
 * (overrules). See docs/lib/MODEL.md, "The compendium sidebar".
 *
 * THE SYSTEM'S TREE IS THE SYSTEM'S. Both strengths read the SYSTEM's own
 * declaration for the system's packs and this module's for this module's;
 * neither states a folder name belonging to the other.
 */
import { MODULE_ID } from "./constants.mjs";
import { importedPacks, isJudgeLine, JUDGE_SHELF_OWNERSHIP } from "./library.mjs";

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
 * belongs at — root first, leaf last. Nothing is created here; planning is
 * separate from building (docs/lib/MODEL.md, "The compendium sidebar").
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
 * named after that line. The ACKS library gets no line folder; it is the
 * default shelf. See docs/lib/MODEL.md, "The compendium sidebar".
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
 * `reset` is the difference between the two strengths (docs/lib/MODEL.md,
 * "The compendium sidebar"): a restore rewrites each entry down to `{folder}`
 * alone, dropping every per-pack override back to the package's own defaults.
 * Clearing `locked` is not the same as unlocking it: with no entry Foundry
 * reads a package's pack as locked and a world pack as writable.
 */
async function filePacks(targets, { reset }) {
  const config = foundry.utils.deepClone(game.settings.get("core", "compendiumConfiguration") ?? {});
  const vacated = new Set();
  const built = new Map();
  let moved = 0;
  let folders = 0;
  const countFolders = () => game.folders.filter((f) => f.type === "Compendium").length;
  const judges = new Set(importedPacks().filter(({ line }) => isJudgeLine(line)).map(({ pack }) => pack.collection));
  for (const [collection, path] of targets) {
    const entry = config[collection] ?? {};
    if (!needsWrite(entry, reset)) continue;
    // JSON, not a joined string: a separator is a guess about what a folder
    // name cannot contain, and there is no such character.
    const key = JSON.stringify(path.map((p) => p.name));
    if (!built.has(key)) {
      const before = countFolders();
      built.set(key, await materialize(path));
      folders += countFolders() - before;
    }
    const folderId = built.get(key);
    if (!folderId) continue;
    const current = entry.folder ?? null;
    const restored = judges.has(collection) ? { folder: folderId, ownership: { ...JUDGE_SHELF_OWNERSHIP } } : { folder: folderId };
    const next = reset ? restored : { ...entry, folder: folderId };
    if (current === folderId && foundry.utils.objectsEqual(entry, next)) continue;
    if (current && current !== folderId) vacated.add(current);
    config[collection] = next;
    moved++;
  }
  if (moved) {
    await game.settings.set("core", "compendiumConfiguration", config);
    ui.compendium?.render();
  }
  return { moved, folders, vacated };
}

/**
 * Remove the folders this pass emptied, and the ancestors they emptied in
 * turn — narrowly, a folder goes only once it holds no other pack and no
 * sub-folder, so a Judge's own empty folder is never a candidate. Passes
 * repeat until one changes nothing, collapsing a renamed shelf's whole empty
 * chain without needing to know how deep it went.
 */
async function sweepVacated(vacated, { withinOwnTree = false } = {}) {
  const candidates = new Set();
  for (const id of vacated) {
    for (let f = game.folders.get(id); f?.type === "Compendium"; f = f.folder) candidates.add(f.id);
  }
  // A restore also collapses empty shelves inside this module's own tree,
  // which no pack ever vacated (deleting an imported pack leaves its line's
  // folder standing).
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
      // A configuration entry only holds a folder open while its pack still
      // exists (docs/lib/MODEL.md, "The compendium sidebar"); a dead entry is
      // dropped along with the folder it named.
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
      classes: ["acks-extras", "acks-extras-scroll"],
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
 * Called from the importer's own `packFor` at the moment of creation, since a
 * pack made through `CompendiumCollection.createCompendium` carries no folder
 * at all. `line` is the one the label was built from, so the shelf and the
 * label can never disagree about which books a pack holds.
 */
export async function fileImportedPack(collection, line = null) {
  if (!game.user?.isGM) return false;
  const root = declaredRoot();
  if (!root) return false;
  const { moved } = await filePacks(new Map([[collection, importPath(line, root)]]), { reset: false });
  return moved > 0;
}
