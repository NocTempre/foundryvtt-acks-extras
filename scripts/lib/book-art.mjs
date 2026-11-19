/**
 * Book art: the pictures an import cut from the Judge's own books, read for a
 * treasure card's back, its face, or a texture laid over it (see
 * docs/lib/API.md, "`bookArt`"). Pure module: no Foundry imports.
 *
 * The rows live in one registry document, `bookArt`, one table per book:
 * `{side, pool, band, kind, src, cite, licence?}`. Lib matches pool, band and
 * kind by equality and never interprets them; the pool vocabulary and the band
 * count are the treasure feature's.
 */
import { getDoc, hasDoc, onTablesChanged } from "./tables.mjs";

/** The registry document that holds every book's art rows. */
export const BOOK_ART_DOC = "bookArt";

/** What a row pictures: a card's back, its face, or a texture over it. */
export const ART_SIDES = Object.freeze(["back", "face", "texture"]);

const nonEmpty = (v) => typeof v === "string" && v.length > 0;

/**
 * What is wrong with one art row, as short messages; empty when it is sound.
 * A back and a face need a pool and a texture has none; a back has no kind and
 * a texture needs one. Band is null or an integer of 0 or more, never 1-based.
 *
 * @param {object} row
 * @returns {string[]}
 */
export function artRowProblems(row) {
  if (!row || typeof row !== "object") return ["row is not an object"];
  const out = [];
  if (!ART_SIDES.includes(row.side)) out.push(`side must be one of ${ART_SIDES.join(", ")}`);
  if (row.side === "texture") {
    if (row.pool != null) out.push("a texture has pool null");
    if (!nonEmpty(row.kind)) out.push("a texture needs a kind");
  } else {
    if (!nonEmpty(row.pool)) out.push("pool must be a non-empty string");
    if (row.kind != null && !nonEmpty(row.kind)) out.push("kind must be null or a non-empty string");
    if (row.side === "back" && row.kind != null) out.push("a back has kind null");
  }
  if (row.band != null && !(Number.isInteger(row.band) && row.band >= 0)) out.push("band must be null or an integer of 0 or more");
  if (!nonEmpty(row.src)) out.push("src must be a non-empty string");
  if (row.cite != null && typeof row.cite !== "string") out.push("cite must be a string or null");
  if (row.licence != null && typeof row.licence !== "string") out.push("licence must be a string when present");
  return out;
}

/** A kind folded for matching: accents dropped, lower case, trimmed; null when empty. */
function foldKind(kind) {
  if (kind == null) return null;
  const folded = String(kind).normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();
  return folded || null;
}

/** side → rows `{row, kind}` in book-key then row order; null until first read or after a change. */
let _index = null;
let _subscribed = false;

/** The index, built from the registered document on first need. */
function index() {
  if (_index) return _index;
  _index = new Map(ART_SIDES.map((side) => [side, []]));
  const tables = getDoc(BOOK_ART_DOC).tables ?? {};
  for (const book of Object.keys(tables).sort()) {
    const rows = tables[book];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) _index.get(row?.side)?.push({ row, kind: foldKind(row.kind) });
  }
  return _index;
}

/** An entry's answer: `{src, cite}`, plus `licence` when the row carries one. */
function answer(entry) {
  if (!entry) return null;
  const { src, cite = null, licence } = entry.row;
  return licence != null ? { src, cite, licence } : { src, cite };
}

// Every step that is not the kind step reads kind-null rows only, so a miss
// never answers with a picture keyed to another thing.
const generic = (e) => e.kind === null;
const atPool = (pool) => (e) => e.row.pool === pool;
const atBand = (band) => (e) => e.row.band === band;
const ofKind = (kind) => (e) => e.kind === kind;

/** The first entry of `rows` passing every test. */
const first = (rows, ...tests) => rows.find((e) => tests.every((t) => t(e)));

/** A back: pool at the band, then pool at band null. */
function backSteps(rows, { pool, band }) {
  return [
    () => band != null && first(rows, generic, atPool(pool), atBand(band)),
    () => first(rows, generic, atPool(pool), atBand(null)),
  ];
}

/** A face: the kind at any pool, then the back's two steps, then the pool at its lowest band. */
function faceSteps(rows, { pool, band, kind }) {
  return [
    () => kind != null && first(rows, ofKind(kind)),
    () => band != null && first(rows, generic, atPool(pool), atBand(band)),
    () => first(rows, generic, atPool(pool), atBand(null)),
    () =>
      rows
        .filter((e) => generic(e) && atPool(pool)(e) && e.row.band != null)
        .reduce((low, e) => (low && low.row.band <= e.row.band ? low : e), null),
  ];
}

/** A texture: the kind at the band, then the kind at band null; never another kind. */
function textureSteps(rows, { band, kind }) {
  return [
    () => kind != null && band != null && first(rows, ofKind(kind), atBand(band)),
    () => kind != null && first(rows, ofKind(kind), atBand(null)),
  ];
}

const STEPS = { back: backSteps, face: faceSteps, texture: textureSteps };

/**
 * The picture for one side of a treasure card, or null when no row serves.
 * Synchronous: the index is built on first call and dropped whenever the
 * `bookArt` document changes, so an import, a removal or an override answers
 * with no reload. Band 0 is a band, distinct from null. A face with no kind
 * (a masked face not yet public) never reaches a kind-keyed row.
 *
 * @param {{side: string, pool?: string|null, band?: number|null, kind?: string|null}} query
 * @returns {{src: string, cite: string|null, licence?: string}|null}
 */
export function treasureArt({ side, pool = null, band = null, kind = null } = {}) {
  if (!_subscribed) {
    _subscribed = true;
    onTablesChanged((docId) => {
      if (docId === BOOK_ART_DOC) _index = null;
    });
  }
  const steps = STEPS[side];
  if (!steps || !hasDoc(BOOK_ART_DOC)) return null;
  const rows = index().get(side);
  for (const step of steps(rows, { pool, band, kind: foldKind(kind) })) {
    const hit = step();
    if (hit) return answer(hit);
  }
  return null;
}
