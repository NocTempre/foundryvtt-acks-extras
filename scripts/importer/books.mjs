/**
 * Book registry: every PDF the streamer can read, with edition fingerprints.
 * A fingerprint is page count plus metadata title, never a file hash (the
 * retailer watermarks each customer's copy, so bytes differ per person).
 *
 * A book id is a promise that connecting that PDF unlocks something; a book
 * that unlocks nothing is not registered.
 * See docs/importer/DECISIONS-through-v11.14.5.md, "Withdrawn surface".
 *
 * `line` names the series a book belongs to, and is what its imports are
 * shelved under: a book declaring one goes to that line's own compendia, and a
 * book declaring none goes to the ACKS ones. Only books from outside the ACKS
 * library carry it.
 *
 * `judge` marks a book whose own rows are the Judge's — an adventure, a
 * gazetteer, a supplement that prints a keyed place: every document its ids
 * name (its places, people, organisations, lists, maps, monsters and its
 * Adventure) is shelved where no player seat is shown them (`lineOf` in
 * `cookbook.mjs`). What such a book contributes to the library's own lists —
 * a class, a power, a proficiency — carries a `def.` id and files on its
 * line's OPEN shelf (`lineOfClaim`): the series' own for a book with a
 * `line`, the ACKS library's for one without; a mixed book is marked by its
 * Judge's half.
 *
 * `form` marks a fillable form rather than a book: nothing imports from it,
 * and connecting it unlocks the official-sheet export, which writes a character
 * into it. It is read through its fields, so a copy that is not the fillable
 * form is refused when opened, and its shelf journal is shared with every
 * player, whose exports read it too.
 *
 * `published` is the copyright year the registered printing carries on its
 * credits page, and `laterBook` orders by it first. Only the ACKS line carries
 * it: a pair never crosses lines.
 *
 * `seriesOrder` orders books whose years tie: the later number is the later
 * printing. Only the AX series carries it, as its own number, so a year tie
 * between two books that do not both carry one stays unordered.
 *
 * `supersedes` lists the books whose printing of an item this one's replaces,
 * where the year and the series cannot order the pair: `laterBook` answers the
 * book that names the other, whichever way round it is asked.
 */

/**
 * `printedOffset`: printed folio = PDF page - offset. Register pages and every
 * compiled instruction address the PDF page; `citeFor` applies the offset where
 * a page number is shown to a reader. Every book carries one.
 *
 * `REGISTRY` is every book this file knows, the answer to a question about an
 * id a world, a flag or a citation already holds. `BOOKS` names the books the
 * module offers.
 */
export const REGISTRY = {
  rr: {
    label: "ACKS II Revised Rulebook",
    short: "RR",
    published: 2024,
    pages: 553,
    titleRe: /Revised Rulebook/i,
    printedOffset: 2,
  },
  jj: {
    label: "ACKS II Judges Journal",
    short: "JJ",
    published: 2024,
    pages: 489,
    titleRe: /Judges Journal/i,
    printedOffset: 2,
    judge: true,
  },
  bta: {
    label: "By This Axe: The Cyclopedia of Dwarven Civilization",
    short: "BTA",
    published: 2022,
    pages: 273,
    titleRe: /By This Axe/i,
    printedOffset: 1,
  },
  mm: {
    label: "ACKS II Monstrous Manual",
    short: "MM",
    published: 2024,
    pages: 441,
    titleRe: /Monstrous Manual/i,
    printedOffset: 2,
  },
  tt: {
    label: "ACKS II Treasure Tome",
    short: "TT",
    published: 2024,
    pages: 346,
    titleRe: /Treasure Tome/i,
    printedOffset: 2,
    supersedes: ["jj"],
  },
  // ACKS I adventures (AX line). Metadata titles are EMPTY in these printings,
  // so the fingerprint gates on page count alone; titleRe stays for printings
  // that do carry one, and must also match the stock download's filename as
  // `book-match.mjs` spaces it.
  ax1: {
    label: "AX1 The Sinister Stone of Sakkara",
    short: "AX1",
    published: 2015,
    seriesOrder: 1,
    pages: 80,
    titleRe: /Sinister Stone of Sakkara/i,
    printedOffset: 1,
    judge: true,
  },
  ax2: {
    label: "AX2 Secrets of the Nethercity",
    short: "AX2",
    published: 2018,
    seriesOrder: 2,
    pages: 186,
    titleRe: /Secrets of the Nethercity/i,
    printedOffset: 2,
    judge: true,
  },
  ax3: {
    label: "AX3 Capital of the Borderlands",
    short: "AX3",
    published: 2018,
    seriesOrder: 3,
    pages: 226,
    titleRe: /Capital of the Borderlands/i,
    printedOffset: 2,
    judge: true,
  },
  ax4: {
    label: "AX4 Ruined City of Cyfandir",
    short: "AX4",
    published: 2018,
    seriesOrder: 4,
    pages: 30,
    titleRe: /Ruined City of Cyfandir/i,
    printedOffset: 2,
    judge: true,
  },
  ax5: {
    label: "AX5 Eyrie of the Dread Eye",
    short: "AX5",
    published: 2018,
    seriesOrder: 5,
    pages: 59,
    // The stock filename welds and misspells the title ("EyrireDreadEye");
    // the pattern tolerates both it and the printed form.
    titleRe: /Eyri\w*\s*(?:of the\s*)?Dread\s*Eye/i,
    printedOffset: 2,
    judge: true,
  },
  ax6: {
    label: "AX6 Sepulcher of the Sorceress-Queen",
    short: "AX6",
    published: 2018,
    seriesOrder: 6,
    pages: 58,
    titleRe: /Sepulcher of the Sorceress[\s-]*Queen/i,
    printedOffset: 2,
    judge: true,
  },
  // An ACKS I supplement that prints keyed lairs and a plate for some of them.
  // Its printing carries no metadata title, so the count alone names
  // it; the pattern matches the stock filename. No `line`, as for the AX books.
  le: {
    label: "Lairs & Encounters",
    short: "LE",
    published: 2016,
    pages: 229,
    titleRe: /Lairs\s*(?:and|&)\s*Encounters/i,
    printedOffset: 0,
    judge: true,
  },
  // An ACKS-compatible community title, authored. The printing carries no
  // metadata title, so the fingerprint gates on the page count; the pattern
  // matches the stock filename. Set in word-processor body type: `typography`
  // reads it on the engine's size ladder and puts back the five ligatures (ti,
  // tt, tf, tti, ft) its text layer encodes as Latin Extended-B letters, and the
  // Symbol-font bullet its lists use.
  cat: {
    label: "The OSR Catgirl: Nine Lives of Adventure",
    line: "The OSR Catgirl",
    short: "CAT",
    pages: 32,
    titleRe: /OSR\s*Catgirl/i,
    judge: true,
    printedOffset: 4,
    typography: {
      bodyPt: 12,
      // Page points, not scaled: the baseline pitch of body type, the smallest
      // gap that opens a paragraph, and the y above which nothing is body.
      leading: 18,
      paraGap: 22,
      bodyTop: 40,
      // A stat label sits on the first line of its value, never centred on it.
      wrapAlign: "top",
      glyphs: { "\u019F": "ti", "\u01A9": "tt", "\u019E": "tf", "\u01AB": "tti", "\u014C": "ft", "\uF0B7": "\u2022" },
      ligatureRuns: true,
      labelColon: true,
    },
  },
  // The conversion instrument. The metadata title carries a misspelling of
  // "Compatibility", so the regex gates on the stem both spellings share.
  scg: {
    label: "ACKS II System Compatibility Guide",
    short: "SCG",
    published: 2024,
    pages: 12,
    titleRe: /System Compat/i,
    printedOffset: 4,
  },
  // Both printings (colour and monochrome) carry no metadata title and the
  // same count; the stock filename carries the title.
  sheet: {
    label: "ACKS II Character Sheet",
    short: "SHEET",
    pages: 5,
    titleRe: /Character\s*Sheet/i,
    printedOffset: 0,
    form: true,
  },
  // The AXIOMS compendium of issues 1-8, registered as one book: one PDF, one
  // fingerprint, one folio offset. The printing carries no metadata title, so
  // the count alone names it; the regex matches the stock filename. It unlocks
  // the beastman leader tables (`monsters` registry document). One copyright
  // year cannot order its issues against each other.
  axc: {
    label: "AXIOMS Compendium, Issues 1-8",
    short: "AXIOMS",
    published: 2018,
    pages: 266,
    titleRe: /Axioms\s*Compendium/i,
    printedOffset: 2,
  },
};

/**
 * The books the module offers: a copy of `REGISTRY`, so withdrawing a book is a
 * deletion here that leaves `REGISTRY` answering for its id. Enumerations that
 * offer, connect or import a book read this; a fact about an id already held by
 * a world, a flag or a citation reads `REGISTRY`.
 */
export const BOOKS = { ...REGISTRY };

/**
 * The per-book cookbook files to fetch: the ids a compiled index lists, in the
 * index's order, minus each book the module has withdrawn (known to `registry`,
 * absent from `books`), so a withdrawn book's file is never requested. An id
 * `registry` does not know is kept, as a claim naming no known book is offered
 * (`registryBookOf`). With no index (`listed` null) every offered book is
 * probed. Pure.
 *
 * @param {string[]|null|undefined} listed the index's `books`, when it has one
 * @param {Record<string, object>} books the offered books (`BOOKS`)
 * @param {Record<string, object>} [registry] every known book; defaults to `REGISTRY`
 * @returns {string[]} book ids
 */
export const offeredBookFiles = (listed, books, registry = REGISTRY) =>
  (listed ?? Object.keys(books)).filter((id) => Object.hasOwn(books, id) || !Object.hasOwn(registry, id));

/**
 * The book a cookbook id names by its first segment, when `registry` knows
 * that book, else null. It reads `REGISTRY`, not `BOOKS`, so a withdrawn book
 * still answers and a claim naming one is told apart from a claim naming no
 * book. Pure.
 *
 * @param {string} id a cookbook id such as `<book>.<entry>`
 * @param {Record<string, object>} [registry] defaults to `REGISTRY`
 * @returns {string|null}
 */
export const registryBookOf = (id, registry = REGISTRY) => {
  const first = String(id ?? "").split(".")[0];
  return first && Object.hasOwn(registry, first) ? first : null;
};

/**
 * The citation a reader is shown for one PDF page of one book.
 *
 * The one place a PDF page number becomes a printed folio: register entries,
 * compiled instructions and art pointers address the PDF page, and a citation
 * names the folio on the paper. Compose a citation here, never by interpolating
 * the raw page.
 * See docs/importer/DECISIONS-through-v11.14.5.md, "A citation names the printed folio; everything else names the PDF page (2026-08-27)".
 */
export const citeFor = (bookId, page) => `${REGISTRY[bookId]?.short ?? bookId} p.${page - (REGISTRY[bookId]?.printedOffset ?? 0)}`;

/**
 * The inverse of `citeFor`: the book id and PDF page a citation names, or null
 * when it names no book this build knows. Reads the short label and the folio
 * and puts the offset back; a citation marked `PDF` already names the PDF page
 * and takes no offset.
 * @returns {{book: string, page: number}|null}
 */
export function parseCite(text) {
  const m = /^\s*([A-Za-z][A-Za-z0-9]*)\s+(PDF\s+)?pp?\.?\s*(\d+)/i.exec(String(text ?? ""));
  if (!m) return null;
  const short = m[1].toUpperCase();
  const bookId = Object.keys(REGISTRY).find((id) => String(REGISTRY[id].short ?? "").toUpperCase() === short);
  if (!bookId) return null;
  const printed = Number(m[3]);
  return { book: bookId, page: m[2] ? printed : printed + (REGISTRY[bookId].printedOffset ?? 0) };
}

/** Human-readable fingerprint check; returns null when OK, else a warning. */
export function fingerprintWarning(bookId, numPages, title) {
  const book = REGISTRY[bookId];
  if (!book) return `unknown book id "${bookId}"`;
  const problems = [];
  if (numPages !== book.pages) problems.push(`page count ${numPages} (expected ${book.pages})`);
  if (title && !book.titleRe.test(title)) problems.push(`title "${title}"`);
  return problems.length ? `${book.label}: ${problems.join(", ")} — different edition/printing? Extraction may miss.` : null;
}

/**
 * Which book an opened PDF is, or null when the fingerprint names no one book.
 * It reads the evidence `fingerprintWarning` reads, but asks whose file this is
 * rather than whether it fits a given slot.
 *
 * A book is named only when the whole fingerprint fits it and nothing else.
 * Registry page counts are distinct, so an untitled printing is identified by
 * count alone; a title, where the printing carries one, must match too. A file
 * that fits no book names nobody, so edition drift stays a warning.
 */
export function identifyBook(numPages, title) {
  const hits = Object.entries(REGISTRY).filter(
    ([, book]) => book.pages === numPages && (!title || book.titleRe.test(title)),
  );
  return hits.length === 1 ? hits[0][0] : null;
}

/**
 * The series a book's imports are shelved under, or null for the ACKS library.
 *
 * A pure lookup over the shipped registry; a Judge-registered source carries its
 * line on its own world record, and `cookbook.mjs` asks both.
 */
export const bookLine = (bookId) => REGISTRY[bookId]?.line ?? null;

/** Whether a shipped book is the Judge's alone (`judge` in the registry). */
export const bookIsJudges = (bookId) => REGISTRY[bookId]?.judge === true;

/** Whether a registry entry is a fillable form rather than a book (`form`). */
export const bookIsForm = (bookId) => REGISTRY[bookId]?.form === true;

/**
 * The shelved books a seat opens at join: each one the registry knows, not
 * open here already, whose shelf record `observes` passes for this seat. A
 * book and a form answer to the same test, because the journal is what the
 * Judge shares.
 *
 * @param {Record<string, object>} staged the shelf, book id → shelf record
 * @param {(record: object) => boolean} observes whether this seat may read the record's page
 * @param {(bookId: string) => boolean} isOpen whether the book is open on this seat
 * @returns {string[]} book ids, in shelf order
 */
export const shelfBooksToOpen = (staged, observes, isOpen) =>
  Object.entries(staged)
    .filter(([id, record]) => BOOKS[id] && !isOpen(id) && observes(record))
    .map(([id]) => id);

/**
 * The later of two books by the year their printings carry (`published`), or
 * null when either book has none. A tie in year is broken by `seriesOrder`
 * where both books carry one, then by `supersedes`, and is otherwise null. Declaration order never
 * breaks a tie, so a caller that needs an answer refuses or falls back on a
 * rule of its own.
 * See docs/importer/DECISIONS.md, "Same-year adventures are ordered by their place in the series (K9)".
 */
export function laterBook(a, b) {
  const ya = REGISTRY[a]?.published;
  const yb = REGISTRY[b]?.published;
  if (!Number.isInteger(ya) || !Number.isInteger(yb)) return null;
  if (ya !== yb) return ya > yb ? a : b;
  const oa = REGISTRY[a]?.seriesOrder;
  const ob = REGISTRY[b]?.seriesOrder;
  if (Number.isInteger(oa) && Number.isInteger(ob) && oa !== ob) return oa > ob ? a : b;
  // A pair the year and the series leave tied: the book that supersedes the other.
  const aOver = !!REGISTRY[a]?.supersedes?.includes(b);
  const bOver = !!REGISTRY[b]?.supersedes?.includes(a);
  if (aOver !== bOver) return aOver ? a : b;
  return null;
}

/**
 * Which of two books' printings of one item the library keeps when an import
 * finds the other already held (`b`): the later (`laterBook`), else the book
 * declared first in `REGISTRY`, else the held one when neither is declared.
 * Only items fall back so; a place's pair refuses.
 * See docs/importer/DECISIONS-through-v11.14.5.md, "An item two books print is the later printing's".
 */
export function keptBook(a, b) {
  const later = laterBook(a, b);
  if (later) return later;
  const rank = (id) => {
    const i = Object.keys(REGISTRY).indexOf(id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return rank(a) < rank(b) ? a : b;
}
