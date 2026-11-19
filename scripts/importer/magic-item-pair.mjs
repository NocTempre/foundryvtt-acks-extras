/**
 * A magic item two books print, kept as one item document — the Foundry-free half.
 *
 * The earlier book's row names the later book's (`meta.revisedBy`; the register
 * lint holds that the target is a magic item of a later printing built as the
 * same core type, and named by one row only). Whichever book lands second meets
 * the document the other made: the later book takes it over (`takeoverPatch`),
 * the earlier one binds onto it (`bindPatch`). Both orders end in the same
 * document: the later book's id and book, its build, and the earlier id among
 * those the document answers for. The earlier printing's text is never added;
 * the later printing's entry is the one kept (docs/importer/DECISIONS.md, "An
 * item two books print is the later printing's"). Where a place pair keeps the
 * earlier printing's unique paragraphs, an item pair keeps none.
 */
import { MODULE_ID } from "./constants.mjs";
import { answersFor, claimIds } from "./place-pair.mjs";

/** The book a cookbook id belongs to: the part before its first dot. */
const bookOf = (id) => String(id ?? "").split(".")[0];

/**
 * The item pairs the cookbooks declare, reachable from either row's id. A pair
 * is declared on the earlier book's row, so the later row's cookbook need not
 * be loaded for its own side to be found.
 * @param {Iterable<[string, {entries?: object}]>} books each book's compiled cookbook, by book id
 * @returns {Map<string, {earlier: string, later: string}>}
 */
export function magicItemPairs(books) {
  const out = new Map();
  for (const [, cb] of books) {
    for (const [id, e] of Object.entries(cb?.entries ?? {})) {
      const later = e?.kind === "kind.magicItem" ? e.meta?.revisedBy : null;
      if (!later) continue;
      const pair = Object.freeze({ earlier: id, later });
      out.set(id, pair);
      out.set(later, pair);
    }
  }
  return out;
}

/**
 * What the later book writes onto the item the earlier book made: its id and
 * book become the document's, the earlier id joins `merged` so a lookup by it
 * still finds the item, and the folder follows the later book's only while the
 * item still stands in the folder the earlier build filed it in (a Judge's move
 * stays). The build itself is written over the document in place by the
 * caller (`REPAIR.magicItem`), which keeps the uuid, a Judge's edits and play's
 * fields; this patch writes none of them.
 *
 * @param {object} source the held item's stored data (`toObject()`)
 * @param {{id: string, book: string, folder?: string|null}} later the later row, and the folder its build files into
 * @param {{id: string, folder?: string|null}} earlier the earlier row, and the folder its build filed into
 * @returns {object} an update payload, empty when nothing is owed
 */
export function takeoverPatch(source, later, earlier) {
  const flag = source?.flags?.[MODULE_ID]?.cookbook ?? {};
  const merged = [...new Set([...claimIds(flag), earlier.id])].filter((id) => id !== later.id);
  const patch = {};
  if (flag.id !== later.id) patch[`flags.${MODULE_ID}.cookbook.id`] = later.id;
  if (flag.book !== later.book) patch[`flags.${MODULE_ID}.cookbook.book`] = later.book;
  if (JSON.stringify(merged) !== JSON.stringify(flag.merged ?? [])) patch[`flags.${MODULE_ID}.cookbook.merged`] = merged;
  if (later.folder && later.folder !== source?.folder && (source?.folder ?? null) === (earlier.folder ?? null)) patch.folder = later.folder;
  return patch;
}

/**
 * What the earlier book writes onto the item the later book made: its id joins
 * `merged`, and nothing else is written over. A second run adds nothing.
 *
 * @param {object} target the held item's stored data (`toObject()`)
 * @param {{id: string}} earlier the earlier row
 * @returns {object} an update payload, empty when nothing is owed
 */
export function bindPatch(target, earlier) {
  const flag = target?.flags?.[MODULE_ID]?.cookbook ?? {};
  return answersFor(flag, earlier.id) ? {} : { [`flags.${MODULE_ID}.cookbook.merged`]: [...(flag.merged ?? []), earlier.id] };
}

/**
 * What an import of row `id` does about its pair, given what the library holds.
 *
 * - `own`: no pair, or the pair's other side is neither held nor open: the row is built as its own.
 * - `present`: a held document already answers for `id`, merged or its own.
 * - `takeover` (the later row): the earlier row's document stands, so the later build is written over it.
 * - `bind` (the earlier row): the later row's document stands; `id` joins it and nothing is built.
 * - `defer` (the earlier row): no document stands, and the later book is open here, so the later row is imported and `id` joins it.
 *
 * Deleting the document leaves neither side held, so the next import starts again from `defer` or `own`.
 * @param {Map<string, {earlier: string, later: string}>} pairs `magicItemPairs`
 * @param {string} id the arriving row
 * @param {{held: (id: string) => object|null, open: (bookId: string) => boolean}} lib the held document's stored data by an id it answers for, and whether a book is open
 * @returns {{step: "own"|"present"|"takeover"|"bind"|"defer", from?: string, to?: string}}
 */
export function pairStep(pairs, id, { held, open }) {
  const flagOf = (doc) => doc?.flags?.[MODULE_ID]?.cookbook;
  if (answersFor(flagOf(held(id)), id)) return { step: "present" };
  const pair = pairs.get(id);
  if (!pair) return { step: "own" };
  if (pair.later === id) return flagOf(held(pair.earlier))?.id === pair.earlier ? { step: "takeover", from: pair.earlier } : { step: "own" };
  if (flagOf(held(pair.later))?.id === pair.later) return { step: "bind", to: pair.later };
  return open(bookOf(pair.later)) ? { step: "defer", to: pair.later } : { step: "own" };
}

/**
 * Whether a repair or a forced rewrite of row `id` may write over the held
 * document `doc` (its stored data). Only a document standing under `id` is
 * the row's to write: a document the row answers for as a merged id stands under
 * the later printing's claim and is that row's to write. So a forced rebuild of
 * the earlier book leaves it alone, and an unpaired row, or a row's own
 * document, is written.
 * @param {object|null} doc the held document's stored data
 * @param {string} id the row being written
 */
export const writesOver = (doc, id) => !!doc && doc.flags?.[MODULE_ID]?.cookbook?.id === id;
