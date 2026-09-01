/**
 * Book registry: every PDF the streamer can read, with edition fingerprints.
 * Fingerprints use page count + metadata title — NEVER file hashes (DTRPG
 * watermarks each customer's copy, so bytes differ per person).
 *
 * A book id is a promise that connecting that PDF unlocks something. Do not add
 * one that unlocks nothing — see docs/importer/DECISIONS.md § Withdrawn surface.
 *
 * `line` names the series a book belongs to, and is what its imports are
 * shelved under: a book declaring one goes to that line's own compendia, and a
 * book declaring none goes to the ACKS ones. Only books from outside the ACKS
 * library carry it — the ACKS line is the default, not a name in this file.
 */

/**
 * `printedOffset`: printed folio = PDF page - offset. Register pages and every
 * compiled instruction always address the PDF page; the offset is applied at
 * the ONE point a page number is shown to a reader, so a citation names the
 * number printed on the page they turn to. Every book carries one, because
 * every book has front matter: a reader handed a raw PDF page is sent two
 * pages past what they were looking for.
 */
export const BOOKS = {
  rr: {
    label: "ACKS II Revised Rulebook",
    short: "RR",
    pages: 553,
    titleRe: /Revised Rulebook/i,
    printedOffset: 2,
  },
  jj: {
    label: "ACKS II Judges Journal",
    short: "JJ",
    pages: 489,
    titleRe: /Judges Journal/i,
    printedOffset: 2,
  },
  bta: {
    label: "By This Axe: The Cyclopedia of Dwarven Civilization",
    short: "BTA",
    pages: 273,
    titleRe: /By This Axe/i,
    printedOffset: 1,
  },
  mm: {
    label: "ACKS II Monstrous Manual",
    short: "MM",
    pages: 441,
    titleRe: /Monstrous Manual/i,
    printedOffset: 2,
  },
  tt: {
    label: "ACKS II Treasure Tome",
    short: "TT",
    pages: 346,
    titleRe: /Treasure Tome/i,
    printedOffset: 2,
  },
  // ACKS I adventures (AX line). Metadata titles are EMPTY in these printings,
  // so the fingerprint gates on page count alone; titleRe stays for printings
  // that do carry one.
  ax2: {
    label: "AX2 Secrets of the Nethercity",
    short: "AX2",
    pages: 186,
    titleRe: /Secrets of the Nethercity/i,
    printedOffset: 2,
  },
  ax3: {
    label: "AX3 Capital of the Borderlands",
    short: "AX3",
    pages: 226,
    titleRe: /Capital of the Borderlands/i,
    printedOffset: 2,
  },
  // Authored third-party titles (DECISIONS: "Third-party books get shipped
  // cookbooks"). Everything else in the OSE library is registered per world and
  // never shipped; these are the named exceptions.
  qd1: {
    label: "Quick Delve #1: Milk",
    line: "Quick Delve",
    short: "QD1",
    pages: 20,
    titleRe: /^Milk$/i,
  },
  qd2: {
    label: "Quick Delve #2: The Grotesques' Grotto",
    line: "Quick Delve",
    short: "QD2",
    pages: 20,
    titleRe: /Grotesques/i,
  },
  qd3: {
    label: "Quick Delve #3: Against the Horselord",
    line: "Quick Delve",
    short: "QD3",
    pages: 24,
    titleRe: /Against the Horselord/i,
  },
  aft: {
    label: "OSE Advanced Fantasy Referee's Tome",
    line: "Old-School Essentials",
    short: "AFT",
    pages: 257,
    titleRe: /Referee/i,
  },
  dmb: {
    label: "Dolmenwood Monster Book",
    line: "Dolmenwood",
    short: "DMB",
    pages: 137,
    titleRe: /Dolmenwood/i,
    // Not OSE, despite the shelf it sits on: ascending armour class printed
    // alone, hit points as a die expression, a label per movement mode, and
    // "Morale"/"Enc"/"Hoard" for ML/NA/TT. Read as OSE, a bare "AC 14" converts
    // as descending and lands five points of armour from the page.
    profile: "ose.dolmenwood",
    lineage: "dolmenwood",
  },
  wld1: {
    label: "Wicked Little Delves, vol 1",
    line: "Wicked Little Delves",
    short: "WLD1",
    pages: 25,
    titleRe: /Wickedv1/i,
  },
  wld2: {
    label: "Wicked Little Delves, vol 2",
    line: "Wicked Little Delves",
    short: "WLD2",
    pages: 25,
    titleRe: /Wickedv2/i,
  },
  wld3: {
    label: "Wicked Little Delves, vol 3",
    line: "Wicked Little Delves",
    short: "WLD3",
    pages: 29,
    titleRe: /Wickedv3/i,
  },
  pc1: {
    label: "Planar Compass, Issue 1",
    line: "Planar Compass",
    short: "PC1",
    pages: 60,
    titleRe: /Planar\s*Compass\s*1/i,
  },
  pc2: {
    label: "Planar Compass, Issue 2",
    line: "Planar Compass",
    short: "PC2",
    pages: 72,
    titleRe: /Planar\s*Compass\s*2/i,
  },
  pc3: {
    label: "Planar Compass, Issue 3",
    line: "Planar Compass",
    short: "PC3",
    pages: 72,
    titleRe: /Planar\s*Compass\s*3/i,
  },
  // The conversion instrument. It unlocks the OSE import path: the constants
  // that turn a foreign stat block into ACKS II values are printed here, so
  // they are read from the reader's own copy rather than shipped. The metadata
  // title carries the publisher's own spelling ("Compatability"), so the regex
  // gates on the stem both spellings share.
  scg: {
    label: "ACKS II System Compatibility Guide",
    short: "SCG",
    pages: 12,
    titleRe: /System Compat/i,
    printedOffset: 4,
  },
};


/**
 * The citation a reader is shown for one PDF page of one book.
 *
 * THE ONE PLACE A PAGE NUMBER IS TRANSLATED. Everything upstream — register
 * entries, compiled instructions, art pointers — addresses the PDF page,
 * because that is what the reader hands the extractor. A citation is the
 * opposite direction: it is read by a person holding the book, so it names the
 * folio printed on the paper. Composing one by interpolating the raw page is
 * how six of the seven call sites came to cite two pages past the entry.
 */
export const citeFor = (bookId, page) => `${BOOKS[bookId]?.short ?? bookId} p.${page - (BOOKS[bookId]?.printedOffset ?? 0)}`;

/** Human-readable fingerprint check; returns null when OK, else a warning. */
export function fingerprintWarning(bookId, numPages, title) {
  const book = BOOKS[bookId];
  if (!book) return `unknown book id "${bookId}"`;
  const problems = [];
  if (numPages !== book.pages) problems.push(`page count ${numPages} (expected ${book.pages})`);
  if (title && !book.titleRe.test(title)) problems.push(`title "${title}"`);
  return problems.length ? `${book.label}: ${problems.join(", ")} — different edition/printing? Extraction may miss.` : null;
}

/**
 * Which book an opened PDF actually is, or null when the fingerprint names no
 * one book. This is the same evidence `fingerprintWarning` reads, asked the
 * other way round: not "does this file fit the slot it was put in" but "whose
 * file is this".
 *
 * A book is named only when the whole fingerprint fits it and fits nothing
 * else. The page counts in the registry are distinct, so an untitled printing
 * — which is every AX book — is still identified by count alone; a title, where
 * the printing carries one, must match too. A file that fits no book (a
 * printing this build has never seen) names nobody, which is what keeps edition
 * drift a warning rather than a refusal.
 */
export function identifyBook(numPages, title) {
  const hits = Object.entries(BOOKS).filter(
    ([, book]) => book.pages === numPages && (!title || book.titleRe.test(title)),
  );
  return hits.length === 1 ? hits[0][0] : null;
}

/**
 * The series a book's imports are shelved under, or null for the ACKS library.
 *
 * A pure lookup over the shipped registry. Judge-registered sources are not in
 * it — those carry their line on their own world record, and `cookbook.mjs`
 * asks both.
 */
export const bookLine = (bookId) => BOOKS[bookId]?.line ?? null;
