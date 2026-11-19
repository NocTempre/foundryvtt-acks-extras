/**
 * Book art, the pure half: a book's picture recipe (`books/<id>/book-art.mjs`,
 * exported as `bookArt`) linted, planned into one fetch per picture, and the
 * pictures that came back turned into rows of the `bookArt` registry document
 * lib reads (`scripts/lib/book-art.mjs`). Node-importable, no Foundry; it names
 * no book id, and the treasure feature's pools and band count reach it as
 * arguments. The runtime step is `cookbook/book-art.mjs`.
 *
 * A recipe row is `{n, page, box: {x, y, w, h}, size: {w, h}, uses}`: `n` the
 * census ordinal, `page` the PDF page, `box` the placement in page points,
 * `size` the decoded samples. Each use is `{side, pool, band?, entry?}` for a
 * back or a face (a face's `entry` is a cookbook id of the book, and the row's
 * `kind`), or `{side: "texture", kind, band?, licence?}`, which has no pool and
 * no entry.
 */
import { BOOK_ART_DOC, ART_SIDES, artRowProblems } from "../lib/book-art.mjs";
import { citeFor } from "./books.mjs";
import { joinCites } from "./produces.mjs";
import { BOOK_CODE } from "./books/index.mjs";

/** The books whose manifest entry declares a `bookArt` recipe, in manifest order. */
export const booksWithArt = (manifest = BOOK_CODE) =>
  Object.keys(manifest ?? {}).filter((id) => Array.isArray(manifest[id]?.bookArt));

/** The claim one book's art table answers to in the import kinds: `<book>.bookArt`. */
export const bookArtClaim = (bookId) => `${bookId}.bookArt`;

/** The book a `bookArtClaim` names among the books with art, or null. */
export const bookOfArtClaim = (claim, manifest = BOOK_CODE) =>
  booksWithArt(manifest).find((id) => bookArtClaim(id) === claim) ?? null;

/**
 * The producer map: the `bookArt` document holds one table per manifest book
 * that declares art, written from that book's recipe file.
 */
export const PRODUCES = Object.freeze({
  [BOOK_ART_DOC]: Object.freeze(Object.fromEntries(booksWithArt().map((id) => [id, `books/${id}/book-art.mjs`]))),
});

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const nonEmpty = (v) => typeof v === "string" && v.length > 0;

/** The registry kind a use writes: a face's entry, a texture's kind, null for a back. */
const kindOfUse = (use) => (use.side === "face" ? use.entry ?? null : use.side === "texture" ? use.kind ?? null : null);

/** The lookup key two uses may not share: side, pool, band, kind. */
const lookupKey = (use) =>
  JSON.stringify([use.side, use.side === "texture" ? null : use.pool ?? null, use.band ?? null, kindOfUse(use)]);

/**
 * What is wrong with a book's art recipe, as short messages naming ordinals
 * only; empty when it is sound. A back takes no entry, a face's entry must be a
 * `kind.magicItem` of `cookbook`, a texture takes a kind and neither a pool nor
 * an entry, a pool must be one of `pools`, a band an integer in
 * `0..bandCount-1`, an ordinal is used once, and no two uses share a lookup key.
 *
 * @param {object[]} rows the recipe
 * @param {{cookbook?: {entries?: object}, pools?: string[], bandCount?: number}} [opts]
 * @returns {string[]}
 */
export function bookArtProblems(rows, { cookbook = null, pools = [], bandCount = 0 } = {}) {
  if (!Array.isArray(rows)) return ["the recipe is not an array"];
  const out = [];
  const ordinals = new Set();
  const keys = new Map();
  rows.forEach((row, i) => {
    const at = Number.isInteger(row?.n) ? `art${row.n}` : `row ${i}`;
    if (!row || typeof row !== "object") return out.push(`${at}: not an object`);
    if (!(Number.isInteger(row.n) && row.n > 0)) out.push(`${at}: n must be a positive integer`);
    else if (ordinals.has(row.n)) out.push(`${at}: the ordinal is used twice`);
    else ordinals.add(row.n);
    if (!(Number.isInteger(row.page) && row.page > 0)) out.push(`${at}: page must be a positive integer`);
    if (!["x", "y", "w", "h"].every((k) => isNum(row.box?.[k]))) out.push(`${at}: box needs numbers x, y, w and h`);
    if (!["w", "h"].every((k) => Number.isInteger(row.size?.[k]) && row.size[k] > 0)) out.push(`${at}: size needs positive integers w and h`);
    if (!Array.isArray(row.uses) || !row.uses.length) return out.push(`${at}: uses must be a non-empty array`);
    for (const use of row.uses) {
      if (!use || typeof use !== "object") {
        out.push(`${at}: a use is not an object`);
        continue;
      }
      if (!ART_SIDES.includes(use.side)) {
        out.push(`${at}: side must be one of ${ART_SIDES.join(", ")}`);
        continue;
      }
      if (use.side === "texture") {
        if (use.pool != null) out.push(`${at}: a texture has no pool`);
        if (use.entry != null) out.push(`${at}: a texture has no entry`);
        if (!nonEmpty(use.kind)) out.push(`${at}: a texture needs a kind`);
        if (use.licence != null && !nonEmpty(use.licence)) out.push(`${at}: licence must be a non-empty string`);
      } else {
        if (!pools.includes(use.pool)) out.push(`${at}: unknown pool`);
        if (use.kind != null) out.push(`${at}: a ${use.side} names its kind by entry, never kind`);
        if (use.side === "back" && use.entry != null) out.push(`${at}: a back has no entry`);
        if (use.side === "face" && use.entry != null) {
          const entry = cookbook?.entries?.[use.entry];
          if (!entry) out.push(`${at}: the face's entry is not in the cookbook`);
          else if (entry.kind !== "kind.magicItem") out.push(`${at}: the face's entry is not a magic item`);
        }
      }
      if (use.band != null && !(Number.isInteger(use.band) && use.band >= 0 && use.band < bandCount)) {
        out.push(`${at}: band must be null or an integer from 0 to ${bandCount - 1}`);
      }
      const key = lookupKey(use);
      if (keys.has(key)) out.push(`${at}: the same lookup key as art${keys.get(key)}`);
      else keys.set(key, row.n);
    }
  });
  return out;
}

/**
 * The pictures to fetch for one book, one per recipe row however many uses it
 * has: `{n, id, stem, page, box, size, uses}`. The stem `<book>-art<n>-<w>x<h>`
 * names the world file, so a recipe that points an ordinal at another picture
 * makes a new file.
 *
 * @param {string} bookId
 * @param {object[]} rows the book's recipe
 * @returns {object[]}
 */
export function planBookArt(bookId, rows) {
  return (rows ?? []).map((row) => ({
    n: row.n,
    id: `${bookId}.art${row.n}`,
    stem: `${bookId}-art${row.n}-${row.size?.w}x${row.size?.h}`,
    page: row.page,
    box: row.box,
    size: row.size,
    uses: row.uses ?? [],
  }));
}

/** One picture's result from a Map or a plain object keyed by ordinal. */
const resultOf = (results, n) => (results instanceof Map ? results.get(n) : results?.[n]) ?? null;

/**
 * Registry rows from the pictures that came back: every use of a picture whose
 * result has a `path` becomes `{side, pool, band, kind, src, cite}`, with
 * `licence` where the use gives one. A texture's pool is null and its kind the
 * texture kind; a face's kind is its entry id, a back's null. Band 0 stays 0.
 * The cite is the picture's printed folio (`citeFor`).
 *
 * @param {string} bookId
 * @param {object[]} planned `planBookArt`'s list
 * @param {Map<number, {path?: string}|null>|object} results by ordinal
 * @returns {object[]}
 */
export function bookArtRows(bookId, planned, results) {
  const rows = [];
  for (const pic of planned ?? []) {
    const src = resultOf(results, pic.n)?.path;
    if (!nonEmpty(src)) continue;
    const cite = citeFor(bookId, pic.page);
    for (const use of pic.uses) {
      rows.push({
        side: use.side,
        pool: use.side === "texture" ? null : use.pool ?? null,
        band: use.band ?? null,
        kind: kindOfUse(use),
        src,
        cite,
        ...(use.licence != null ? { licence: use.licence } : {}),
      });
    }
  }
  return rows;
}

/**
 * The WORLD `bookArt` document with one book's table replaced by `rows` and
 * every other book's table and cite kept. With no rows the layer is returned
 * as it is (the same object, or null), so a run that resolved nothing never
 * writes. `cites[<book>]` joins that book's row cites, and `source.pages`
 * every row's.
 *
 * @param {object|null} layer the document's WORLD layer, if any
 * @param {string} bookId
 * @param {object[]} rows
 * @returns {object|null}
 */
export function bookArtDoc(layer, bookId, rows) {
  if (!rows?.length) return layer ?? null;
  const tables = { ...(layer?.tables ?? {}), [bookId]: rows };
  const cites = { ...(layer?.cites ?? {}), [bookId]: joinCites(rows.map((r) => r.cite)) };
  const every = Object.values(tables).flatMap((t) => (Array.isArray(t) ? t.map((r) => r?.cite) : []));
  return { id: BOOK_ART_DOC, source: { ...(layer?.source ?? {}), pages: joinCites(every) }, cites, tables };
}

/** The rows of `rows` that lib's row check refuses, with their problems; empty when all pass. */
export const refusedArtRows = (rows) =>
  (rows ?? []).map((row, i) => ({ i, problems: artRowProblems(row) })).filter((r) => r.problems.length);
