/* global game, Item */
/**
 * The language taxonomy, materialized into a world from the seat's own book.
 *
 * Read and register, not transcribe: the recipe in `table-recipes.mjs` carries
 * a heading, two x-bands and an indent step and no names, so the taxonomy is
 * extracted from the reader's own Revised Rulebook at import time and turned
 * into language items here. Ids are derived from the extracted names at
 * runtime, in the importing world.
 *
 * A language is a `language` item, never an ability: the system owns the type,
 * its sheet section and the Polyglot provider's scan. Find before minting: the
 * world may already hold the tongue under its derived id, under a name a Judge
 * typed, or as the system compendium's document; each is adopted in that order
 * and stamped with the derived id, so re-importing converges on one document
 * per language.
 *
 * See docs/importer/DECISIONS.md, "an imported language is a `language`".
 */

import { ensureItemFolder, importedDocs, itemIds, packOptsFor } from "./cookbook/target.mjs";
import { MODULE_ID } from "./constants.mjs";
import { countRepair, repairWrite, REPAIR, unrepaired } from "./refresh.mjs";

/** The system's own item type for a language. Never `ability`. */
const LANGUAGE_TYPE = "language";

/** Where the system keeps its printed languages, for adoption. */
const SYSTEM_PACK = "acks.acks-languages";

/**
 * The ruledata doc the languages recipe imports into — the recipe's own key in
 * `TABLE_RECIPES`, because `importTables` reports and registers each doc under
 * that key and the binding gate matches against what it reports.
 */
export const LANGUAGES_DOC_ID = "languages";

/**
 * A stable id for one extracted row: `def.language.` plus the name camelCased,
 * the segment `itemShelfFor` keys on to file the item under the Languages
 * shelf. Derived from the seat's own book, so re-importing lands on the same
 * item and two worlds owning the same book agree.
 */
export function languageId(name) {
  const slug = String(name ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .trim()
    .split(/\s+/)
    .map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()))
    .join("");
  return slug ? `def.language.${slug}` : null;
}

/** The cookbook id stamped on a document, or "". */
export const cookbookIdOf = (doc) => String(doc?.flags?.[MODULE_ID]?.cookbook?.id ?? "");

/**
 * Turn extracted rows into language items.
 *
 * Descent is kept as the parent's id, since an index is meaningful only inside
 * one extraction. It rides in flags: the system's language type declares no
 * field for it and drops one it does not declare.
 *
 * @param {{rows: object[]}} table the extracted taxonomy
 * @returns {object[]} item data, ready to create
 */
export function languageItems(table) {
  const rows = table?.rows ?? [];
  const ids = rows.map((r) => languageId(r.name));
  return rows
    .map((row, i) => {
      const id = ids[i];
      if (!id) return null;
      const parentId = row.parent != null ? ids[row.parent] : null;
      return {
        name: row.name,
        type: LANGUAGE_TYPE,
        flags: {
          [MODULE_ID]: {
            cookbook: { id },
            language: {
              // What the book prints beside it, and where it sits in the tree.
              counterpart: row.counterpart ?? "",
              depth: row.depth,
              parent: parentId,
            },
          },
        },
      };
    })
    .filter(Boolean);
}

/**
 * The imported documents that already stand for a language, indexed twice: by
 * the derived id, and by lowercased name.
 *
 * Only `language` items count: a document of any other type is not a tongue.
 */
async function libraryIndex() {
  const byId = new Map();
  const byName = new Map();
  for (const item of await importedDocs("Item")) {
    if (item.type !== LANGUAGE_TYPE) continue;
    const id = cookbookIdOf(item);
    if (id.startsWith("def.language.") && !byId.has(id)) byId.set(id, item);
    const key = item.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, item);
  }
  return { byId, byName };
}

/**
 * The system compendium's languages by lowercased name, or an empty map.
 *
 * Adopting one keeps its description and art. The pack is optional: a world
 * without it mints.
 */
async function systemLanguages() {
  const pack = game.packs?.get(SYSTEM_PACK);
  if (!pack) return new Map();
  const docs = await pack.getDocuments().catch(() => []);
  return new Map(docs.map((d) => [d.name.toLowerCase(), d]));
}

/**
 * Materialize the taxonomy: adopt what the world already has, mint only what
 * is missing. Idempotent on the derived id.
 *
 * `repair`, a tally (`repairTally`), writes each language this world already
 * holds over its document in place: its place in the taxonomy is re-read, and
 * its description, art and name stay as the library or a Judge left them.
 *
 * @param {{rows: object[]}} table the extracted taxonomy
 * @param {{repair?: object|null}} [opts]
 * @returns {Promise<{created: number, present: number, adopted: number}>}
 */
export async function applyLanguageImport(table, { repair = null } = {}) {
  const wanted = languageItems(table);
  if (!wanted.length) return { created: 0, present: 0, adopted: 0 };

  const { byId, byName } = await libraryIndex();
  const fromSystem = await systemLanguages();

  const creates = [];
  const stamps = [];
  let present = 0;
  let adopted = 0;
  let created = 0;

  for (const data of wanted) {
    const id = data.flags[MODULE_ID].cookbook.id;
    const existing = byId.get(id);

    if (existing) {
      present++;
      if (repair && unrepaired(repair, existing)) countRepair(repair, await repairWrite(existing, data, REPAIR.language, repair));
      continue;
    }

    // A tongue the library already holds under this name without the derived
    // id: adopt it and stamp the id so the next run finds it. A Judge's own
    // world language is not adopted; the pack is the library.
    const local = byName.get(data.name.toLowerCase());
    if (local) {
      stamps.push({ _id: local.id, [`flags.${MODULE_ID}`]: data.flags[MODULE_ID] });
      adopted++;
      continue;
    }

    const shipped = fromSystem.get(data.name.toLowerCase());
    if (shipped) {
      const source = shipped.toObject();
      delete source._id;
      creates.push({ ...source, ...data, flags: { ...(source.flags ?? {}), ...data.flags } });
      adopted++;
      continue;
    }

    creates.push(data);
    created++;
  }

  const opts = await packOptsFor("Item");
  if (creates.length) {
    const folder = (await ensureItemFolder(creates[0].flags[MODULE_ID].cookbook.id))?.id ?? null;
    const rows = itemIds(creates.map((d) => ({ ...d, folder })), { pack: opts.pack ?? null });
    await Item.createDocuments(rows, { ...opts, keepId: true });
  }
  if (stamps.length) await Item.updateDocuments(stamps, opts);

  return { created, present, adopted };
}
