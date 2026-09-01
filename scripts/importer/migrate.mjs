/* global game, ui, console, localStorage, foundry */
/**
 * The legacy-scope migration: a world that imported under the separate
 * acks-importer module holds every stamp in a flag scope no module owns any
 * more. `getFlag`/`setFlag` refuse an unregistered scope, so those stamps are
 * unreachable through the API while the raw `flags` object still carries
 * them — which is exactly what makes a one-shot copy possible.
 *
 * What moves, once, on the primary GM's seat:
 *
 *   - every document carrying `flags["acks-importer"]` — the world's own
 *     collections (actors, items, journals, roll tables, folders), each
 *     document's embedded children at any depth (a monster's minted attacks,
 *     a journal's pages, a table's results), and the `ACKS Cookbook — *`
 *     world compendiums with their folders. Each key is copied into this
 *     module's scope (`generated` becomes `minted`; this module already uses
 *     `generated` for template-generator provenance) and the legacy scope is
 *     removed in the same write;
 *   - the three world settings (the shelf of server-held books, the
 *     Judge-registered OSE sources, the dynamic recipes), read raw from the
 *     world settings collection — the retired namespace cannot be registered,
 *     so `game.settings.get` cannot see them — and deleted after the copy;
 *   - world macros still calling `globalThis.acksImporter`, rewritten to the
 *     feature key (their `_id`s stay, so a hotbar keeps working).
 *
 * The two client settings (refresh-bridge seconds, the first-run dismissal)
 * move per seat, from localStorage, on every seat's ready.
 *
 * Idempotent: a world setting records completion, and a run that finds nothing
 * to move records it too. A failure leaves the setting unset, so the next
 * load tries again, and says so.
 */
import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import { LEGACY_ID } from "./legacy.mjs";
import { isPrimaryGM } from "../lib/util.mjs";

/** World setting: the document-side pass has completed for this world. */
export const SETTING_MIGRATED = "importerScopeMigrated";

/** How the importer labels its world compendiums — the prefix every one shares. */
const PACK_LABEL_PREFIX = "ACKS Cookbook — ";

/** World settings the retired module registered, in its namespace. */
const WORLD_SETTINGS = ["shelf", "oseSources", "dynamicRecipes"];

/** Client settings the retired module registered, in its namespace. */
const CLIENT_SETTINGS = ["refreshCacheSeconds", "gettingStartedDismissed"];

/** Document classes by name, without the deprecated globals. */
const docClass = (name) => foundry.documents?.[name] ?? globalThis[name];

/** The one key whose name changes on the way across. */
const RENAMED = { generated: "minted" };

/** Delete a whole flag scope in one write — the v14 operator form. */
const deleteScope = () => new foundry.data.operators.ForcedDeletion();

/**
 * The update that moves one document's legacy stamp, or null when it has
 * none. Children are visited through the document's own hierarchy so a stamp
 * on an embedded document at any depth is found without naming the types.
 *
 * @returns {{own: object|null, children: Map<string, object[]>}} `own` is
 *   the document's update (without `_id`); `children` maps an embedded
 *   document name to the updates of the children that need one.
 */
function planDocument(doc) {
  const legacy = doc.flags?.[LEGACY_ID];
  let own = null;
  if (legacy && typeof legacy === "object") {
    own = { [`flags.${LEGACY_ID}`]: deleteScope() };
    for (const [key, value] of Object.entries(legacy)) own[`flags.${MODULE_ID}.${RENAMED[key] ?? key}`] = value;
  }
  const children = new Map();
  for (const [fieldName, field] of Object.entries(doc.constructor.hierarchy ?? {})) {
    const collection = doc[fieldName];
    if (!collection?.size) continue;
    const childName = field.model?.documentName ?? field.element?.documentName;
    if (!childName) continue;
    const updates = [];
    for (const child of collection) {
      const plan = planDocument(child);
      // A child's own children are applied through the child after its own
      // update lands (see applyChildren) — carried here as a nested plan.
      if (plan.own || plan.children.size) updates.push({ child, plan });
    }
    if (updates.length) children.set(childName, updates);
  }
  return { own, children };
}

/** Apply a document's nested child plans, depth-first through the parent. */
async function applyChildren(doc, children, stats) {
  for (const [childName, entries] of children) {
    const updates = entries.filter((e) => e.plan.own).map((e) => ({ _id: e.child.id, ...e.plan.own }));
    if (updates.length) {
      await doc.updateEmbeddedDocuments(childName, updates);
      stats.documents += updates.length;
    }
    for (const { child, plan } of entries) {
      if (plan.children.size) await applyChildren(child, plan.children, stats);
    }
  }
}

/**
 * Migrate every document of one collection, world or compendium. Top-level
 * updates go in one batch per collection; children follow through their
 * parents, which is the only route to an embedded document.
 */
async function migrateCollection(docs, cls, { pack = null } = {}) {
  const stats = { documents: 0 };
  const plans = [];
  for (const doc of docs) {
    const plan = planDocument(doc);
    if (plan.own || plan.children.size) plans.push({ doc, plan });
  }
  const updates = plans.filter((p) => p.plan.own).map((p) => ({ _id: p.doc.id, ...p.plan.own }));
  if (updates.length) {
    await cls.updateDocuments(updates, pack ? { pack } : {});
    stats.documents += updates.length;
  }
  for (const { doc, plan } of plans) {
    if (plan.children.size) await applyChildren(doc, plan.children, stats);
  }
  return stats.documents;
}

/** The importer's world compendiums, whatever series they hold. */
const libraryPacks = () =>
  game.packs.filter((p) => p.metadata.packageType === "world" && String(p.metadata.label).startsWith(PACK_LABEL_PREFIX));

/**
 * World settings, read raw and re-set in this module's namespace. The three
 * the importer still registers are copied; every other document left in the
 * retired namespace (a setting the old module itself had already dropped) is
 * residue nothing can read, and goes with them.
 */
async function migrateWorldSettings() {
  const storage = game.settings.storage.get("world");
  let moved = 0;
  for (const key of WORLD_SETTINGS) {
    const setting = storage.getSetting(`${LEGACY_ID}.${key}`);
    if (!setting) continue;
    // A Setting document's `value` arrives parsed on this core; older data can
    // still hold the serialized string.
    let value = setting.value;
    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch (err) {
        console.warn(`${MODULE_ID} | legacy world setting ${key} does not parse; left in place`, err);
        continue;
      }
    }
    if (value != null) await game.settings.set(MODULE_ID, key, value);
    await setting.delete();
    moved++;
  }
  const residue = storage.filter((s) => String(s.key).startsWith(`${LEGACY_ID}.`));
  for (const setting of residue) await setting.delete();
  return moved + residue.length;
}

/** Client settings: this seat's localStorage, this seat's namespace. */
async function migrateClientSettings() {
  let moved = 0;
  for (const key of CLIENT_SETTINGS) {
    const legacyKey = `${LEGACY_ID}.${key}`;
    const raw = localStorage.getItem(legacyKey);
    if (raw === null) continue;
    try {
      await game.settings.set(MODULE_ID, key, JSON.parse(raw));
      moved++;
    } catch (err) {
      console.warn(`${MODULE_ID} | legacy client setting ${key} could not be carried over`, err);
    }
    localStorage.removeItem(legacyKey);
  }
  if (moved) console.log(`${MODULE_ID} | carried ${moved} importer setting(s) over to this seat.`);
}

/**
 * Rewrite world macros that still address the retired global. Only the
 * shipped prelude and prefix strings are touched; a Judge's own code around
 * them is left as written.
 */
async function migrateMacros() {
  const updates = [];
  for (const macro of game.macros) {
    const command = macro.command ?? "";
    if (!command.includes("acksImporter")) continue;
    const rewritten = command
      .replaceAll("globalThis.acksImporter", "globalThis.acksExtras?.importer")
      .replaceAll("acksImporter.", "acksExtras.importer.")
      .replaceAll(`"${LEGACY_ID} | module not ready (is it enabled?)."`, '"ACKS Extras | the importer is not ready (is the module enabled?)."')
      .replaceAll(`"${LEGACY_ID} | `, '"ACKS Extras | ');
    if (rewritten !== command) updates.push({ _id: macro.id, command: rewritten });
  }
  if (updates.length) await docClass("Macro").updateDocuments(updates);
  return updates.length;
}

/**
 * Run the migration for this seat: client settings on every seat, the
 * world-side pass on the primary GM once. Awaited by the importer's ready
 * hook before anything reads the shelf or the library.
 */
export async function migrateLegacyScope() {
  game.settings.register(MODULE_ID, SETTING_MIGRATED, { scope: "world", config: false, type: Boolean, default: false });
  await migrateClientSettings();
  if (game.settings.get(MODULE_ID, SETTING_MIGRATED)) return;
  if (!isPrimaryGM()) return;

  const report = { documents: 0, packs: 0, settings: 0, macros: 0 };
  try {
    report.settings = await migrateWorldSettings();
    const world = [
      [game.actors, game.actors.documentClass],
      [game.items, game.items.documentClass],
      [game.journal, game.journal.documentClass],
      [game.tables, game.tables.documentClass],
      [game.folders, docClass("Folder")],
    ];
    for (const [collection, cls] of world) report.documents += await migrateCollection(collection.contents, cls);
    for (const pack of libraryPacks()) {
      const docs = await pack.getDocuments();
      const before = report.documents;
      report.documents += await migrateCollection(docs, pack.documentClass, { pack: pack.collection });
      report.documents += await migrateCollection(pack.folders?.contents ?? [], docClass("Folder"), { pack: pack.collection });
      if (report.documents > before) report.packs++;
    }
    report.macros = await migrateMacros();
  } catch (err) {
    console.error(`${MODULE_ID} | the importer's legacy-scope migration did not finish; it runs again on the next load.`, err);
    ui.notifications.error(game.i18n.localize(`${LANG_PREFIX}.ui.migrationFailed`), { permanent: true });
    return;
  }

  await game.settings.set(MODULE_ID, SETTING_MIGRATED, true);
  const moved = report.documents + report.settings + report.macros;
  console.log(`${MODULE_ID} | importer legacy scope: ${report.documents} document(s) across ${report.packs} compendium(s), ${report.settings} world setting(s), ${report.macros} macro(s) carried over.`);
  if (moved) ui.notifications.info(game.i18n.format(`${LANG_PREFIX}.ui.migrated`, report));
}
