/**
 * Cookbook runtime: a book's magic items (`kind.magicItem`), each a core item
 * built from its page.
 *
 * The category vocabulary and the core type it maps to are plain constants the
 * register lint imports; the rest is the import step (`cookbookImportMagicItems`)
 * and the creation data of one item (`magicItemData`). The facade ../cookbook.mjs
 * re-exports what the rest of the module imports by name.
 */
import { MODULE_ID, LANG_PREFIX, DEFAULT_IMG } from "../constants.mjs";
import { entryText } from "../prose.mjs";
import { REPAIR, countRepair, unrepaired } from "../refresh.mjs";
import { printedNameOf } from "../printed-name.mjs";
import { executeEntry } from "../executor.mjs";
import { progressBar } from "../progress.mjs";
import { data, ctx, cookbookEntry } from "./state.mjs";
import { repairFromEntry } from "./read.mjs";
import { createDoc, claimImport, importedItem, targetFolder } from "./target.mjs";

/**
 * The magic-item categories a register row's `meta.category` names: the keys of
 * the engine's classic item lists, which ship already.
 */
export const MAGIC_CATEGORIES = Object.freeze(["potions", "rings", "scrolls", "implements", "misc", "swords", "weapons", "armors"]);

/** The core item type each category is built as; every category not listed is a plain item. */
export const CATEGORY_CORE_TYPE = Object.freeze({ swords: "weapon", weapons: "weapon", armors: "armor" });

/** The core item type of a category (`item` for any not mapped). */
export const coreTypeOf = (category) => CATEGORY_CORE_TYPE[category] ?? "item";

/** The two figures a header line prints, as the kind's locators name them: the located leaf of the markets flag. */
export const MARKET_FIGURES = Object.freeze(["baseCostGp", "apparentValueGp"]);

/** Every magic item the open or closed books introduce, as `[id, entry]` rows: a source of the entry picker. */
export function magicItemEntries() {
  const rows = [];
  for (const cb of data.books.values()) {
    for (const [id, e] of Object.entries(cb.entries ?? {})) if (e.kind === "kind.magicItem") rows.push([id, e]);
  }
  return rows;
}

/**
 * The creation data of one magic item, from its executed page. The whitelist is
 * the name (read from the page, else the row's label), the description and the
 * two located figures; whatever else the executor's scans produced for the
 * entry (`effects`, `defenses`, `rolls`, a derived key) is never read. The
 * markets flag holds `magic: true` and only the figures the page's locators
 * found, so a figure not read is absent and never 0. The figures are also
 * recorded in the cookbook stamp (`read.markets`), where a repair finds what the
 * import last wrote. The core type comes from the row's `meta.category`; the
 * rarity, the cursed mark and the play marks are not built here. `folder` is
 * the created item's; a repair writes none. Exported for the offline suite;
 * Foundry-free.
 */
export function magicItemData(bookId, id, entry, node, folder = null) {
  const located = {};
  for (const spec of node.fields?.values ?? []) {
    if (MARKET_FIGURES.includes(spec?.field) && Number.isFinite(spec.amount)) located[spec.field] = spec.amount;
  }
  const flags = {
    cookbook: {
      id, book: bookId, kind: entry.kind, cite: entry.cite, unaudited: !entry.audited,
      ...(Object.keys(located).length ? { read: { markets: { ...located } } } : {}),
    },
    markets: { magic: true, ...located },
  };
  return {
    name: printedNameOf(node, entry.name),
    type: coreTypeOf(entry.meta?.category),
    img: DEFAULT_IMG.ITEM,
    folder,
    system: { description: entryText(node, id, entry.cite), subtype: "item", quantity: { value: 1, max: 0 }, cost: 0, weight: 0, weight6: 0 },
    flags: { [MODULE_ID]: flags },
  };
}

/**
 * Magic items a book prints (`kind.magicItem`): each becomes a core item named
 * and described from the page, filed in its book's folder of its category in
 * the book's line's Item pack. `books` narrows the run to the open books it
 * names; without it every open book's items are imported; `only` narrows it to
 * a set of ids. An item the world holds is passed as already present, and
 * written over in place where a `repair` tally is given (`REPAIR.magicItem`).
 * Quiet when no open book prints any, since the step runs in every Import
 * Everything.
 * @returns {Promise<{made: number, already: number, refused: number, created: {items: string[]}}>}
 */
export async function cookbookImportMagicItems({ books = null, only = null, repair = null } = {}) {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only.`);
  const wanted = books ? new Set(books) : null;
  const openBooks = [...data.books.keys()].filter((b) => ctx.sessionDocs.has(b) && (!wanted || wanted.has(b)));
  const jobs = [];
  for (const bookId of openBooks) {
    for (const [id, entry] of Object.entries(data.books.get(bookId).entries ?? {})) {
      if (entry.kind === "kind.magicItem" && (!only || only.has(id))) jobs.push({ bookId, id, entry });
    }
  }
  const counts = { made: 0, already: 0, refused: 0, created: { items: [] } };
  if (!jobs.length) return counts;
  const bar = progressBar(game.i18n.localize(`${LANG_PREFIX}.ui.progressMagicItems`), jobs.length);
  try {
    for (const { bookId, id, entry } of jobs) {
      bar.step(entry.name);
      const have = await importedItem(id);
      if (have) {
        counts.already++;
        if (unrepaired(repair, have)) {
          countRepair(repair, await repairFromEntry(have, id, (node) => magicItemData(bookId, id, entry, node), REPAIR.magicItem, repair));
        }
        continue;
      }
      const doc = await claimImport(id, () => importMagicItem(bookId, id, entry)).catch((err) => {
        console.error(`${MODULE_ID} | magic item ${id} failed`, err);
        return null;
      });
      if (doc) {
        counts.made++;
        counts.created.items.push(doc.uuid);
      } else counts.refused++;
    }
  } finally {
    bar.finish();
  }
  ui.notifications[counts.refused ? "warn" : "info"](
    `${MODULE_ID} | magic items: ${counts.made} imported, ${counts.already} already present${repair ? ", repaired in place" : ""}${counts.refused ? `, ${counts.refused} refused (the page did not match the cookbook)` : ""}.`,
  );
  return counts;
}

/** One magic item created from its page (`magicItemData`), or null when the page did not match. */
async function importMagicItem(bookId, id, entry) {
  const found = cookbookEntry(id);
  const session = ctx.sessionDocs.get(bookId);
  const node = await executeEntry(session.doc, found.cb, data.registers, id);
  if (!node.ok) {
    ui.notifications.warn(`${MODULE_ID} | ${entry.name}: page did not match the cookbook (different printing?) — skipped.`);
    return null;
  }
  const category = game.i18n.localize(`${LANG_PREFIX}.magicItems.category.${entry.meta?.category}`);
  const folder = (await targetFolder("Item", bookId, category))?.id ?? null;
  return createDoc(Item, magicItemData(bookId, id, entry, node, folder));
}
