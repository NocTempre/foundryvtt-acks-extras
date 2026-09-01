/* global game, Item */
/**
 * The language taxonomy, materialized into a world from the seat's own book.
 *
 * READ AND REGISTER, not transcribe. The recipe in `table-recipes.mjs` carries
 * a heading, two x-bands and an indent step — no names — so the taxonomy is
 * extracted from the reader's own Revised Rulebook at import time and turned
 * into language items here. Nothing about which languages exist, or what each
 * descends from, is in this repo.
 *
 * That is the whole reason a language does not get one register entry apiece
 * like a power or a proficiency. Those entries anchor on a printed name
 * because they have a MECHANIC to bind to and the name is an index into it. A
 * language has no mechanic: its entry would be a name and nothing else, and
 * fifty-eight of those is not a way of finding the list, it is the list.
 *
 * The ids are derived from the extracted names at RUNTIME, in the world doing
 * the importing. A derived id is not shipped content.
 *
 * A LANGUAGE IS A `language`, NOT AN ABILITY. The system owns the type — it
 * declares it, gives it an icon and a details template, files it in its own
 * section of the character sheet, and reads it in the Polyglot provider it
 * registers (`getUserLanguages` scans an actor for `type === "language"` and
 * nothing else). Minting abilities here put every imported tongue outside all
 * of that at once.
 *
 * FIND BEFORE MINTING. The world may already hold the tongue — under its
 * derived id from a previous import, under a name a Judge typed, or as the
 * system compendium's own document. Each is adopted in that order and stamped
 * with the derived id, so re-importing converges on ONE document per language
 * instead of laying a fresh twin beside every one that was already there.
 */

import { ensureItemFolder, importedDocs, packOptsFor } from "./cookbook.mjs";
import { MODULE_ID } from "./constants.mjs";

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
 * A stable id for one extracted row: `def.language.` plus the name camelCased
 * — the segment `itemShelfFor` keys on, so the items file under the Languages
 * shelf like every other imported document (`def.lang.*` would lint clean and
 * land all of them in the unsorted root).
 *
 * Derived in the seat's own world from the seat's own book, so re-importing
 * lands on the same item rather than minting a twin, and two worlds owning the
 * same book agree without either of them having been told the answer.
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

/** Is this document one of the taxonomy's, whatever type it was minted as? */
export const isImportedLanguage = (doc) => cookbookIdOf(doc).startsWith("def.language.");

/**
 * Turn extracted rows into language items.
 *
 * Descent is kept as the PARENT'S ID rather than as an index, because indices
 * are meaningful only inside one extraction and a world may re-import against
 * a differently-paginated printing. It rides in flags rather than in `system`:
 * the system's language type carries a description and nothing else, and a
 * field it does not declare is dropped on the way in.
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
 * Both indexes span EVERY type, not just `language`. An earlier import minted
 * these as abilities, and a library holding those must be recognised as already
 * having the tongue — otherwise the fix that switches the type is also the
 * change that doubles everyone's language list.
 */
async function libraryIndex() {
  const byId = new Map();
  const byName = new Map();
  for (const item of await importedDocs("Item")) {
    const id = cookbookIdOf(item);
    if (id.startsWith("def.language.") && !byId.has(id)) byId.set(id, item);
    if (item.type === LANGUAGE_TYPE) {
      const key = item.name.toLowerCase();
      if (!byName.has(key)) byName.set(key, item);
    }
  }
  return { byId, byName };
}

/**
 * The system compendium's languages by lowercased name, or an empty map.
 *
 * Adopting one keeps whatever the system wrote on it — its description and its
 * art — instead of replacing a furnished document with a bare name. The pack
 * is optional: a world without it simply mints, and the import does not care.
 */
async function systemLanguages() {
  const pack = game.packs?.get(SYSTEM_PACK);
  if (!pack) return new Map();
  const docs = await pack.getDocuments().catch(() => []);
  return new Map(docs.map((d) => [d.name.toLowerCase(), d]));
}

/**
 * Materialize the taxonomy: adopt what the world already has, mint only what
 * is genuinely missing, and retype anything an earlier import left as an
 * ability.
 *
 * Idempotent on the derived id, so importing twice does not double the world's
 * languages — the same guard every other importer path uses.
 *
 * THE RETYPE DELETES, so it is ordered to survive a failure at any point: the
 * replacement is created first and the stale ability is removed only once its
 * successor exists. A run that dies halfway leaves a duplicate, which the next
 * run adopts — never a world that has lost a language.
 *
 * @returns {Promise<{created: number, present: number, adopted: number, retyped: number}>}
 */
export async function applyLanguageImport(table) {
  const wanted = languageItems(table);
  if (!wanted.length) return { created: 0, present: 0, adopted: 0, retyped: 0 };

  const { byId, byName } = await libraryIndex();
  const fromSystem = await systemLanguages();

  const creates = [];
  const stamps = [];
  const retyped = [];
  let present = 0;
  let adopted = 0;
  let created = 0;

  for (const data of wanted) {
    const id = data.flags[MODULE_ID].cookbook.id;
    const existing = byId.get(id);

    if (existing?.type === LANGUAGE_TYPE) {
      present++;
      continue;
    }

    if (existing) {
      // An earlier import's ability. A document's type cannot be updated, so
      // the language is re-created carrying the ability's own description and
      // the ability is retired once the replacement is in hand.
      creates.push({ ...data, system: { description: existing.system?.description ?? "" } });
      retyped.push(existing);
      continue;
    }

    // A tongue the LIBRARY already knows under this name — an earlier import
    // that predates the derived id. Adopt it and stamp the id so the next run
    // finds it. A Judge's own world language is deliberately not adopted: the
    // pack is the library, and stamping a sidebar document into it would leave
    // the taxonomy with a hole the pack's ownership does not cover.
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
    await Item.createDocuments(creates.map((d) => ({ ...d, folder })), opts);
  }
  if (stamps.length) await Item.updateDocuments(stamps, opts);
  // Only now — every replacement is committed, so nothing is lost by removing
  // what it replaced.
  if (retyped.length) await Item.deleteDocuments(retyped.map((i) => i.id), opts);

  return { created, present, adopted, retyped: retyped.length };
}
